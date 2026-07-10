import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CAPTURE_ROOT, ensurePrivateDir, removeArtifactTree, writeJsonPrivate, writeBinaryPrivate } from '../src/session/artifacts.js';
import type { CDPClient } from '../src/cdp/client.js';
import type { SnapshotContext, SnapshotWriter } from '../src/cdp/measure/types.js';
import { collectStates } from '../src/cdp/measure/collectors/states.js';

// ============================================================================
// Stub CDP client — no real Chrome. Models a small fixed set of "virtual
// elements" keyed by the literal CSS selector string `states.ts` queries
// with (via `DOM.querySelectorAll` and, independently, the
// `document.querySelectorAll(selector)[index]` re-selection baked into
// every `Runtime.evaluate` expression it sends). Mirrors
// `snapshot-settledness.test.ts`'s marker-matching convention
// (`expression.includes('__captureState...')`) and `measure-pixels.test.ts`'s
// `DOM.querySelectorAll`/`DOM.describeNode` shapes.
// ============================================================================

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface HitFacts {
  isTarget: boolean;
  topTag: string | null;
}

interface FixtureElement {
  nodeId: number;
  nodeName: string;
  attributes: string[];
  rect: Rect;
  /** Alternate rect used when the state that reveals more content (`open`) is forced — models a real layout change. */
  forcedRect?: Rect;
  baseStyle: Record<string, string>;
  hoverStyle?: Record<string, string>;
  focusStyle?: Record<string, string>;
  activeStyle?: Record<string, string>;
  checkedStyle?: Record<string, string>;
  openStyle?: Record<string, string>;
  hit: HitFacts;
  hasChecked?: boolean;
  hasDisabled?: boolean;
  hasOpen?: boolean;
  hasValidity?: boolean;
  /** Radio-group identity, so the checked-force models the native "forcing one radio unchecks its peers" semantics and peer restoration by stable handle. */
  type?: string;
  name?: string;
  /** Mutable live state the stub toggles on force/restore, to prove restoration round-trips correctly. */
  checked?: boolean;
  disabled?: boolean;
  open?: boolean;
  /** Live custom-validity state, so the invalid-force models preserving/restoring a pre-existing app-set message. */
  hadCustom?: boolean;
  customMessage?: string;
  /** Forces the SECOND `__captureStateFacts` call (the post-force "after" capture) to throw — proves restoration still runs on a captur e error. */
  throwOnSecondFacts?: boolean;
  /** Forces the FIRST `__captureStateFacts` call (the pre-force "before" capture) to resolve with no `value` at all — models `Runtime.evaluate` returning `{ result: {} }` (no `value` key), the honest-failed-read case I-5 requires be distinguished from a genuine `{exists:false}`. */
  noValueOnFirstFacts?: boolean;
  /** Makes `DOM.describeNode` for this node resolve WITHOUT a `backendNodeId` (the node itself is described, but identity resolution fails) — models the `describeNode()` `{}`-on-failure path in states.ts. */
  identityFails?: boolean;
  /** Makes the IDL-state FORCE `__captureStateForce_*` evaluate resolve with no `value` at all — models a `Runtime.evaluate` response that never produced a result value for the force call specifically (distinct from the facts-read no-value fixtures above). */
  noValueOnForce?: boolean;
  /** Makes the IDL-state FORCE `__captureStateForce_*` evaluate resolve with a value that is missing/mistyping the `supported` field entirely — models a malformed (not merely `supported:false`) response shape. */
  malformedForceValue?: boolean;
}

class StubCdpClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];

  private readonly selectorToNodeIds = new Map<string, number[]>();
  private readonly nodesById = new Map<number, FixtureElement>();
  private readonly forcedPseudo = new Map<number, Set<string>>();
  private readonly factsCallCount = new Map<number, number>();
  private readonly markerToNodeId = new Map<string, number>();
  private readonly radioMarkerToNodeId = new Map<string, number>();

  constructor(elements: FixtureElement[], selectorMap: Record<string, number[]>) {
    for (const el of elements) this.nodesById.set(el.nodeId, el);
    for (const [selector, nodeIds] of Object.entries(selectorMap)) this.selectorToNodeIds.set(selector, nodeIds);
  }

  private radioGroup(el: FixtureElement): FixtureElement[] {
    return [...this.nodesById.values()].filter((e) => e.type === 'radio' && e.name === el.name);
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params: { ...params } });

    if (method === 'DOM.getDocument') {
      return { root: { nodeId: 1 } };
    }

    if (method === 'DOM.querySelectorAll') {
      const selector = String((params as { selector?: unknown }).selector ?? '');
      return { nodeIds: this.selectorToNodeIds.get(selector) ?? [] };
    }

    if (method === 'DOM.describeNode') {
      const nodeId = (params as { nodeId: number }).nodeId;
      const el = this.nodesById.get(nodeId);
      if (el?.identityFails) {
        return { node: { nodeName: el?.nodeName ?? 'DIV', attributes: el?.attributes ?? [] } };
      }
      return { node: { nodeName: el?.nodeName ?? 'DIV', backendNodeId: nodeId * 100, attributes: el?.attributes ?? [] } };
    }

    if (method === 'CSS.forcePseudoState') {
      const nodeId = (params as { nodeId: number }).nodeId;
      const classes = (params as { forcedPseudoClasses: string[] }).forcedPseudoClasses;
      this.forcedPseudo.set(nodeId, new Set(classes));
      return {};
    }

    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      return { result: { value: this.evalExpression(expression) } };
    }

    return {};
  }

  private resolveElement(expression: string): { el: FixtureElement | undefined; nodeId: number | undefined } {
    const match = expression.match(/document\.querySelectorAll\((".*?")\)\[(\d+)\]/);
    if (!match) return { el: undefined, nodeId: undefined };
    const selector = JSON.parse(match[1]) as string;
    const index = Number(match[2]);
    const nodeId = this.selectorToNodeIds.get(selector)?.[index];
    if (nodeId === undefined) return { el: undefined, nodeId: undefined };
    return { el: this.nodesById.get(nodeId), nodeId };
  }

  private evalExpression(expression: string): unknown {
    // Restore expressions re-find the element by its stable
    // `data-capture-state-id` marker (NOT `selector[index]`), thread the
    // captured `prev` back through, and strip the marker — so the fixture's
    // final state proves the collector round-tripped the pre-force snapshot.
    if (expression.includes('__captureStateRestore_')) {
      const el = this.resolveByMarker(expression);
      if (!el) return { restored: false, reason: 'element no longer present' };
      const prev = this.parsePrev(expression) as any;
      if (expression.includes('__captureStateRestore_checked')) {
        el.checked = !!(prev && prev.checked);
        if (prev && prev.radioGroup && el.type === 'radio') {
          for (const entry of prev.radioGroup) {
            if (!entry || !entry.rid) continue;
            // Resolve each peer by its STABLE data-capture-state-radio-id handle,
            // NOT by re-running querySelectorAll('input[type=radio]') order.
            const peerId = this.radioMarkerToNodeId.get(entry.rid);
            const peer = peerId === undefined ? undefined : this.nodesById.get(peerId);
            if (peer) {
              peer.checked = !!entry.checked;
              this.radioMarkerToNodeId.delete(entry.rid);
            }
          }
        }
      } else if (expression.includes('__captureStateRestore_disabled')) el.disabled = !!(prev && prev.value);
      else if (expression.includes('__captureStateRestore_open')) el.open = !!(prev && prev.value);
      else if (expression.includes('__captureStateRestore_invalid')) {
        el.hadCustom = !!(prev && prev.hadCustom);
        el.customMessage = prev && prev.hadCustom ? prev.prevMsg : '';
      }
      this.removeMarker(expression);
      return { restored: true };
    }

    const { el, nodeId } = this.resolveElement(expression);
    if (!el || nodeId === undefined) return { exists: false, supported: false, reason: 'element not found' };

    if (expression.includes('__captureStateFacts')) {
      const count = (this.factsCallCount.get(nodeId) ?? 0) + 1;
      this.factsCallCount.set(nodeId, count);
      if (el.throwOnSecondFacts && count === 2) {
        throw new Error('simulated CDP failure during post-force capture');
      }
      if (el.noValueOnFirstFacts && count === 1) {
        return undefined;
      }
      return this.computeFacts(el, nodeId);
    }

    if (expression.includes('__captureStateForce_') && el.noValueOnForce) {
      return undefined;
    }
    if (expression.includes('__captureStateForce_') && el.malformedForceValue) {
      // Missing the `supported` field entirely — a malformed response shape,
      // distinct from a genuine `{ supported: false, reason }` determination.
      return { prev: null };
    }

    if (expression.includes('__captureStateForce_checked')) {
      if (!el.hasChecked) return { supported: false, reason: 'element has no checked property' };
      this.tagMarker(expression, nodeId);
      const markerId = expression.match(/data-capture-state-id',\s*"([^"]+)"/)?.[1];
      const prevChecked = !!el.checked;
      let radioGroup: Array<{ rid: string; checked: boolean }> | null = null;
      if (el.type === 'radio' && el.name) {
        const peers = this.radioGroup(el);
        // NEW shape: each peer gets a STABLE handle, and its pre-force value is
        // snapshotted against that handle (Array<{rid,checked}>).
        radioGroup = peers.map((p, i) => {
          const rid = `${markerId}-radio-${i}`;
          this.radioMarkerToNodeId.set(rid, p.nodeId);
          return { rid, checked: !!p.checked };
        });
        for (const p of peers) p.checked = p === el; // real radio semantics: forcing one unchecks its peers
      }
      el.checked = true;
      return { supported: true, prev: { checked: prevChecked, radioGroup } };
    }

    if (expression.includes('__captureStateForce_disabled')) {
      if (!el.hasDisabled) return { supported: false, reason: 'element has no disabled property' };
      this.tagMarker(expression, nodeId);
      const prev = { value: !!el.disabled };
      el.disabled = true;
      return { supported: true, prev };
    }

    if (expression.includes('__captureStateForce_open')) {
      if (!el.hasOpen) return { supported: false, reason: 'element has no boolean open property' };
      this.tagMarker(expression, nodeId);
      const prev = { value: !!el.open };
      el.open = true;
      return { supported: true, prev };
    }

    if (expression.includes('__captureStateForce_invalid')) {
      if (!el.hasValidity) return { supported: false, reason: 'element has no constraint-validation API' };
      this.tagMarker(expression, nodeId);
      const prev = { hadCustom: !!el.hadCustom, prevMsg: el.hadCustom ? (el.customMessage ?? '') : '' };
      el.hadCustom = true;
      el.customMessage = 'capture-forced-invalid';
      return { supported: true, prev };
    }

    return {};
  }

  /** Registers the `data-capture-state-id` marker the force expression stamps, so the later marker-keyed restore resolves back to this node. */
  private tagMarker(expression: string, nodeId: number): void {
    const markerId = expression.match(/data-capture-state-id',\s*"([^"]+)"/)?.[1];
    if (markerId !== undefined) this.markerToNodeId.set(markerId, nodeId);
  }

  private resolveByMarker(expression: string): FixtureElement | undefined {
    const markerId = expression.match(/data-capture-state-id=\\?"([A-Za-z0-9_-]+)/)?.[1];
    if (markerId === undefined) return undefined;
    const nodeId = this.markerToNodeId.get(markerId);
    return nodeId === undefined ? undefined : this.nodesById.get(nodeId);
  }

  private removeMarker(expression: string): void {
    const markerId = expression.match(/data-capture-state-id=\\?"([A-Za-z0-9_-]+)/)?.[1];
    if (markerId !== undefined) this.markerToNodeId.delete(markerId);
  }

  // Balanced-brace extraction of the `var prev = <JSON>;` literal the real
  // restore expression embeds. The naive /\{[\s\S]*?\}/ match stops at the first
  // `}`, which now sits INSIDE the nested `radioGroup: [{rid,checked}]` array —
  // scan matching braces instead so the new nested shape round-trips.
  private parsePrev(expression: string): any {
    const marker = 'var prev = ';
    const start = expression.indexOf(marker);
    if (start === -1) return null;
    let i = start + marker.length;
    if (expression[i] !== '{') return null;
    const from = i;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (; i < expression.length; i++) {
      const ch = expression[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    try {
      return JSON.parse(expression.slice(from, i));
    } catch {
      return null;
    }
  }

  private computeFacts(el: FixtureElement, nodeId: number): unknown {
    const forced = this.forcedPseudo.get(nodeId) ?? new Set<string>();
    const style: Record<string, string> = { ...el.baseStyle };
    if (forced.has('hover') && el.hoverStyle) Object.assign(style, el.hoverStyle);
    if (forced.has('focus') && el.focusStyle) Object.assign(style, el.focusStyle);
    if (forced.has('active') && el.activeStyle) Object.assign(style, el.activeStyle);
    if (el.checked && el.checkedStyle) Object.assign(style, el.checkedStyle);
    if (el.open && el.openStyle) Object.assign(style, el.openStyle);

    const rect = el.open && el.forcedRect ? el.forcedRect : el.rect;

    return {
      exists: true,
      tag: el.nodeName,
      rect,
      style,
      hit: el.hit,
      text: '',
      axName: null,
    };
  }
}

function asClient(stub: StubCdpClient): CDPClient {
  return stub as unknown as CDPClient;
}

// ============================================================================
// Snap-dir / context plumbing — mirrors `measure-pixels.test.ts`.
// ============================================================================

function makeTestWriter(dir: string): SnapshotWriter {
  return {
    json(filename, value) {
      writeJsonPrivate(resolveScoped(dir, filename), value);
    },
    binary(filename, data) {
      writeBinaryPrivate(resolveScoped(dir, filename), data);
    },
  };
}

function resolveScoped(dir: string, filename: string): string {
  const target = path.resolve(dir, filename);
  const rel = path.relative(dir, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`escaping artifact filename: ${filename}`);
  }
  return target;
}

function makeSnapDir(label: string): string {
  const dir = path.join(CAPTURE_ROOT, `test-states-${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, 'measure', 'snaps', 'snap-test');
  return ensurePrivateDir(dir);
}

function makeCtx(dir: string, client: CDPClient, state: readonly string[]): SnapshotContext {
  return {
    client,
    dir,
    snapId: 'snap-test',
    url: null,
    viewport: '390x844',
    settled: true,
    freezeAnimations: false,
    captureUnsettled: false,
    pixels: false,
    state,
    unstableRegions: [],
    write: makeTestWriter(dir),
  };
}

interface StatesElementJson {
  id: string;
  state: string;
  selector?: string;
  backendNodeId?: number | null;
  identityUnresolved?: true;
  supported: boolean;
  reason?: string;
  resolutionUnavailable?: true;
  forceReadUnavailable?: true;
  forceReadUnavailableReason?: string;
  forced?: { applied: boolean; restored?: boolean; restorationUnknown?: true };
  geometry?: { before: Rect; after: Rect; delta: { dx: number; dy: number; dwidth: number; dheight: number }; changed: boolean };
  style?: { changed: string[]; before: Record<string, string>; after: Record<string, string> };
  hittest?: { before: HitFacts; after: HitFacts; changed: boolean };
  factsUnavailable?: true;
  factsUnavailableReason?: string;
}

interface StatesJson {
  requested: string[];
  scope: { root: string; shadowDom: string };
  elements: StatesElementJson[];
}

function readStatesJson(dir: string): StatesJson {
  return JSON.parse(fs.readFileSync(path.join(dir, 'states.json'), 'utf-8')) as StatesJson;
}

const BUTTON: FixtureElement = {
  nodeId: 10,
  nodeName: 'BUTTON',
  attributes: ['class', 'send-btn'],
  rect: { x: 10, y: 10, width: 80, height: 30 },
  baseStyle: { color: 'rgb(0, 0, 0)' },
  hoverStyle: { color: 'rgb(255, 0, 0)' },
  hit: { isTarget: true, topTag: 'BUTTON' },
};

const SEARCH_INPUT: FixtureElement = {
  nodeId: 11,
  nodeName: 'INPUT',
  attributes: ['class', 'search'],
  rect: { x: 5, y: 5, width: 120, height: 24 },
  baseStyle: { 'outline-width': '0px' },
  focusStyle: { 'outline-width': '2px' },
  hit: { isTarget: true, topTag: 'INPUT' },
};

const SUBMIT_BUTTON: FixtureElement = {
  nodeId: 13,
  nodeName: 'BUTTON',
  attributes: ['class', 'submit'],
  rect: { x: 20, y: 60, width: 90, height: 32 },
  baseStyle: { transform: 'none' },
  activeStyle: { transform: 'scale(0.98)' },
  hit: { isTarget: true, topTag: 'BUTTON' },
};

const NOTIFY_TOGGLE: FixtureElement = {
  nodeId: 12,
  nodeName: 'INPUT',
  attributes: ['class', 'notify-toggle', 'type', 'checkbox'],
  rect: { x: 30, y: 40, width: 18, height: 18 },
  baseStyle: { 'background-color': 'rgb(255, 255, 255)' },
  checkedStyle: { 'background-color': 'rgb(0, 128, 0)' },
  hit: { isTarget: true, topTag: 'INPUT' },
  hasChecked: true,
  hasDisabled: true,
  hasValidity: true,
  checked: false,
};

const DETAILS_PANEL: FixtureElement = {
  nodeId: 14,
  nodeName: 'DETAILS',
  attributes: ['class', 'panel'],
  rect: { x: 0, y: 0, width: 200, height: 20 },
  forcedRect: { x: 0, y: 0, width: 200, height: 120 },
  baseStyle: {},
  hit: { isTarget: true, topTag: 'DETAILS' },
  hasOpen: true,
  open: false,
};

// ============================================================================
// Real-expression execution harness — for proving `buildForceExpression`'s
// in-page incremental rollback. Unlike `StubCdpClient` above (which
// hand-simulates force semantics in TS and therefore cannot prove anything
// about the actual generated JS), `RealForceExpressionStub` captures the
// literal `__captureStateForce_*` expression string `states.ts` sends over
// `Runtime.evaluate` and executes it for real, via `new Function`, against a
// tiny fake DOM. The result fed back into `collectStates` is therefore
// exactly what the real shipped template computed, including any in-page
// `try`/`catch` rollback it performed — not a stand-in.
// ============================================================================

interface FakeTaggableEl {
  setAttribute(attrName: string, value: string): void;
  removeAttribute(attrName: string): void;
  hasAttribute(attrName: string): boolean;
  getAttribute(attrName: string): string | null;
}

function attachAttributeMethods(target: Record<string, unknown>): FakeTaggableEl {
  const attrs = new Map<string, string>();
  return Object.assign(target, {
    setAttribute(attrName: string, value: string) {
      attrs.set(attrName, value);
    },
    removeAttribute(attrName: string) {
      attrs.delete(attrName);
    },
    hasAttribute(attrName: string) {
      return attrs.has(attrName);
    },
    getAttribute(attrName: string) {
      return attrs.has(attrName) ? (attrs.get(attrName) as string) : null;
    },
  }) as unknown as FakeTaggableEl;
}

/** A fake radio input. `throwOnRadioTag` makes `setAttribute` throw ONLY when called with `data-capture-state-radio-id` (never `data-capture-state-id`), modeling a hostile peer whose native attribute write fails partway through the peer-tagging loop. */
function makeFakeRadio(initialChecked: boolean, throwOnRadioTag = false) {
  const attrs = new Map<string, string>();
  const el = {
    type: 'radio',
    name: 'plan',
    checked: initialChecked,
    form: undefined as undefined,
    setAttribute(attrName: string, value: string) {
      if (throwOnRadioTag && attrName === 'data-capture-state-radio-id') {
        throw new Error('simulated hostile setAttribute failure');
      }
      attrs.set(attrName, value);
    },
    removeAttribute(attrName: string) {
      attrs.delete(attrName);
    },
    hasAttribute(attrName: string) {
      return attrs.has(attrName);
    },
    getAttribute(attrName: string) {
      return attrs.has(attrName) ? (attrs.get(attrName) as string) : null;
    },
  };
  return el;
}

/**
 * A real radio-GROUP peer whose `.checked` setter genuinely MODELS NATIVE
 * radio semantics for real (not hand-simulated in the test's assertions):
 * setting any one peer's `.checked = true` immediately flips every OTHER
 * peer sharing the same `group` array to `false`, exactly like a real
 * browser `<input type="radio">` group — this is what lets `el.checked =
 * true` in the real generated template genuinely un-check a sibling as a
 * side effect, unlike `makeFakeRadio` (a plain data property with no side
 * effect). `throwOnSetTrue`, when set, makes the setter throw AFTER it has
 * already applied its own value AND unchecked its siblings — mirroring
 * `makeFakeIdlToggle`'s mutate-then-throw pattern, but for the radio-group
 * native-uncheck side effect specifically.
 */
function makeFakeRadioGroupPeer(group: Array<{ checked: boolean }>, initialChecked: boolean, throwOnSetTrue = false): FakeTaggableEl & { type: string; name: string; form: undefined; checked: boolean } {
  const attrs = new Map<string, string>();
  const self: Record<string, unknown> = {
    type: 'radio',
    name: 'plan',
    form: undefined,
    setAttribute(attrName: string, v: string) {
      attrs.set(attrName, v);
    },
    removeAttribute(attrName: string) {
      attrs.delete(attrName);
    },
    hasAttribute(attrName: string) {
      return attrs.has(attrName);
    },
    getAttribute(attrName: string) {
      return attrs.has(attrName) ? (attrs.get(attrName) as string) : null;
    },
  };
  let value = initialChecked;
  Object.defineProperty(self, 'checked', {
    get() {
      return value;
    },
    set(v: boolean) {
      value = v; // the mutation genuinely lands...
      if (v === true) {
        // ...and native radio-group semantics apply as a genuine side effect: every OTHER peer in the group is unchecked.
        for (const p of group) if (p !== self) (p as { checked: boolean }).checked = false;
      }
      if (throwOnSetTrue && v === true) {
        throw new Error('simulated hostile checked setter failure (radio peer, after native uncheck side effect)'); // ...before the hostile setter throws
      }
    },
    enumerable: true,
    configurable: true,
  });
  group.push(self as unknown as { checked: boolean });
  return self as unknown as FakeTaggableEl & { type: string; name: string; form: undefined; checked: boolean };
}

/** A fake constraint-validation-capable element. `throwOnFirstCall` makes `setCustomValidity` throw only on its FIRST invocation (the forcing call) — a subsequent rollback call from inside the script's own `catch` still succeeds, mirroring a one-shot hostile setter. */
function makeFakeInvalidatable(throwOnFirstCall = true) {
  const calls: string[] = [];
  let hadCustom = false;
  let customMessage = '';
  const el = {
    get validity() {
      return { customError: hadCustom };
    },
    get validationMessage() {
      return customMessage;
    },
    setCustomValidity(msg: string) {
      calls.push(msg);
      if (throwOnFirstCall && calls.length === 1) {
        throw new Error('simulated hostile setCustomValidity failure');
      }
      hadCustom = msg !== '';
      customMessage = msg;
    },
    calls,
  };
  return attachAttributeMethods(el as unknown as Record<string, unknown>) as unknown as typeof el & FakeTaggableEl;
}

/**
 * A fake boolean-IDL-property element (`checked`/`disabled`/`open`) whose
 * property setter GENUINELY applies the incoming value to an internal slot
 * before optionally throwing (`throwOnSetTrue`) — modeling a hostile or
 * framework setter that mutates state as a side effect before validating
 * and throwing, so a throw here proves a REAL mutation landed, not a no-op.
 * `throwOnRemoveMarker`, when set, additionally makes
 * `removeAttribute('data-capture-state-id')` throw EVERY time — modeling a
 * rollback operation that itself fails, so a test using it can assert the
 * script's OWN catch swallows that failure and still finishes the rest of
 * its rollback (the property restore) instead of letting the failure
 * escape the IIFE.
 */
function makeFakeIdlToggle(propName: string, initialValue: boolean, opts: { throwOnSetTrue?: boolean; throwOnRemoveMarker?: boolean } = {}) {
  const attrs = new Map<string, string>();
  let value = initialValue;
  const el: Record<string, unknown> = {
    setAttribute(attrName: string, v: string) {
      attrs.set(attrName, v);
    },
    removeAttribute(attrName: string) {
      if (opts.throwOnRemoveMarker && attrName === 'data-capture-state-id') {
        throw new Error('simulated hostile removeAttribute failure');
      }
      attrs.delete(attrName);
    },
    hasAttribute(attrName: string) {
      return attrs.has(attrName);
    },
    getAttribute(attrName: string) {
      return attrs.has(attrName) ? (attrs.get(attrName) as string) : null;
    },
  };
  Object.defineProperty(el, propName, {
    get() {
      return value;
    },
    set(v: boolean) {
      value = v; // the mutation genuinely lands...
      if (opts.throwOnSetTrue && v === true) {
        throw new Error(`simulated hostile ${propName} setter failure`); // ...before the hostile setter throws
      }
    },
    enumerable: true,
    configurable: true,
  });
  return el as unknown as FakeTaggableEl & Record<string, boolean>;
}

/**
 * A fake element whose `setAttribute('data-capture-state-id', ...)` call
 * GENUINELY applies the attribute to its internal store before throwing —
 * modeling a hostile/observed attribute reflection that mutates then
 * throws. Proves the marker-recording gap: if a script only remembers
 * "I tagged this element" AFTER the `setAttribute` call returns, this
 * mutate-then-throw leaves the marker applied but unrecorded, so a naive
 * rollback skips removing it and the marker leaks in the page. The boolean
 * IDL property (`propName`) is a plain, non-hostile pass-through here —
 * this fake exists to isolate the marker-tagging failure mode, not the
 * property-write one (that is `makeFakeIdlToggle`'s job).
 */
function makeFakeElementHostileMarkerTag(propName: string, initialValue: boolean) {
  const attrs = new Map<string, string>();
  let value = initialValue;
  const el: Record<string, unknown> = {
    setAttribute(attrName: string, v: string) {
      attrs.set(attrName, v); // the mutation genuinely lands...
      if (attrName === 'data-capture-state-id') {
        throw new Error('simulated hostile setAttribute failure (mutates then throws)'); // ...before the hostile call throws
      }
    },
    removeAttribute(attrName: string) {
      attrs.delete(attrName);
    },
    hasAttribute(attrName: string) {
      return attrs.has(attrName);
    },
    getAttribute(attrName: string) {
      return attrs.has(attrName) ? (attrs.get(attrName) as string) : null;
    },
  };
  Object.defineProperty(el, propName, {
    get() {
      return value;
    },
    set(v: boolean) {
      value = v;
    },
    enumerable: true,
    configurable: true,
  });
  return el as unknown as FakeTaggableEl & Record<string, boolean>;
}

/**
 * Like {@link makeFakeInvalidatable}, but the FIRST `setCustomValidity` call
 * GENUINELY applies the custom-validity state (`hadCustom`/`customMessage`)
 * before throwing — modeling a hostile setter that mutates then throws,
 * rather than throwing before any state changes (which is what
 * `makeFakeInvalidatable`'s `throwOnFirstCall` models). `throwOnRemoveMarker`,
 * when set, additionally makes `removeAttribute('data-capture-state-id')`
 * throw every time, to exercise the script's own rollback failing on the
 * marker-cleanup step while still restoring validity state via its own
 * already-guarded `setCustomValidity` rollback call.
 */
function makeFakeInvalidatableMutateThenThrow(opts: { throwOnRemoveMarker?: boolean } = {}) {
  const calls: string[] = [];
  let hadCustom = false;
  let customMessage = '';
  const el = {
    get validity() {
      return { customError: hadCustom };
    },
    get validationMessage() {
      return customMessage;
    },
    setCustomValidity(msg: string) {
      calls.push(msg);
      hadCustom = msg !== '';
      customMessage = msg; // the mutation genuinely lands...
      if (calls.length === 1) {
        throw new Error('simulated hostile setCustomValidity failure (mutates then throws)'); // ...before the FIRST call throws
      }
    },
    calls,
  };
  const attrs = new Map<string, string>();
  return Object.assign(el, {
    setAttribute(attrName: string, v: string) {
      attrs.set(attrName, v);
    },
    removeAttribute(attrName: string) {
      if (opts.throwOnRemoveMarker && attrName === 'data-capture-state-id') {
        throw new Error('simulated hostile removeAttribute failure');
      }
      attrs.delete(attrName);
    },
    hasAttribute(attrName: string) {
      return attrs.has(attrName);
    },
    getAttribute(attrName: string) {
      return attrs.has(attrName) ? (attrs.get(attrName) as string) : null;
    },
  }) as unknown as typeof el & FakeTaggableEl;
}

class RealForceExpressionStub {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  /** Set true if the executed `__captureStateForce_*` expression itself threw synchronously instead of swallowing its own error and returning `{ supported: false, ... }` — a template regression that would defeat the whole point of the in-page catch. */
  forceExpressionEscaped = false;

  constructor(
    private readonly fakeDocument: { querySelectorAll(sel: string): unknown[] },
    private readonly describedNode: { nodeName: string; backendNodeId: number; attributes: string[] },
  ) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params: { ...params } });

    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') return { nodeIds: [1] };
    if (method === 'DOM.describeNode') return { node: this.describedNode };

    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureStateFacts')) {
        return {
          result: {
            value: {
              exists: true,
              tag: this.describedNode.nodeName,
              rect: { x: 0, y: 0, width: 16, height: 16 },
              style: {},
              hit: { isTarget: true, topTag: this.describedNode.nodeName },
              text: '',
              axName: null,
            },
          },
        };
      }
      if (expression.includes('__captureStateForce_')) {
        let value: unknown;
        try {
          // eslint-disable-next-line no-new-func -- executing the REAL generated template is the whole point of this stub.
          value = new Function('document', 'return (' + expression + ');')(this.fakeDocument);
        } catch (e) {
          this.forceExpressionEscaped = true;
          throw e;
        }
        return { result: { value } };
      }
      // Restore expressions are not expected to be reached in these rollback
      // scenarios (`supported: false` means `captureOneElement` never installs a
      // restoreFn) — handled defensively so a template regression that DID
      // report `supported: true` fails loudly on the assertions below instead
      // of crashing this stub first.
      return { result: { value: { restored: true } } };
    }

    return {};
  }
}

// ============================================================================
// Tests
// ============================================================================

test('collectStates is a no-op when ctx.state is empty', async () => {
  const dir = makeSnapDir('noop');
  try {
    const client = new StubCdpClient([], {});
    const ctx = makeCtx(dir, asClient(client), []);

    await collectStates(ctx);

    assert.equal(client.calls.length, 0, 'no CDP calls when no --state was requested');
    assert.equal(fs.existsSync(path.join(dir, 'states.json')), false);
  } finally {
    removeArtifactTree(dir);
  }
});

test('hover:selector records a real style delta and restores the forced pseudo-class', async () => {
  const dir = makeSnapDir('hover');
  try {
    const client = new StubCdpClient([BUTTON], { 'button.send-btn': [10] });
    const ctx = makeCtx(dir, asClient(client), ['hover:button.send-btn']);

    await collectStates(ctx);

    const json = readStatesJson(dir);
    assert.equal(json.elements.length, 1);
    assert.deepEqual(json.scope, { root: 'top-document', shadowDom: 'light-only' });
    const el = json.elements[0];
    assert.equal(el.state, 'hover');
    assert.equal(el.supported, true);
    assert.deepEqual(el.style?.changed, ['color']);
    assert.equal(el.style?.before.color, 'rgb(0, 0, 0)');
    assert.equal(el.style?.after.color, 'rgb(255, 0, 0)');
    assert.equal(el.geometry?.changed, false);
    assert.equal(el.forced?.applied, true);
    assert.equal(el.forced?.restored, true);

    const forceCalls = client.calls.filter((c) => c.method === 'CSS.forcePseudoState');
    assert.equal(forceCalls.length, 2, 'forces once, restores once');
    assert.deepEqual(forceCalls[0].params, { nodeId: 10, forcedPseudoClasses: ['hover'] });
    assert.deepEqual(forceCalls[1].params, { nodeId: 10, forcedPseudoClasses: [] });
  } finally {
    removeArtifactTree(dir);
  }
});

test('focus:selector forces both focus and focus-visible and records the outline delta', async () => {
  const dir = makeSnapDir('focus');
  try {
    const client = new StubCdpClient([SEARCH_INPUT], { 'input.search': [11] });
    const ctx = makeCtx(dir, asClient(client), ['focus:input.search']);

    await collectStates(ctx);

    const json = readStatesJson(dir);
    const el = json.elements[0];
    assert.equal(el.state, 'focus');
    assert.equal(el.supported, true);
    assert.deepEqual(el.style?.changed, ['outline-width']);
    assert.equal(el.style?.before['outline-width'], '0px');
    assert.equal(el.style?.after['outline-width'], '2px');

    const forceCalls = client.calls.filter((c) => c.method === 'CSS.forcePseudoState');
    assert.deepEqual(forceCalls[0].params, { nodeId: 11, forcedPseudoClasses: ['focus', 'focus-visible'] });
    assert.deepEqual(forceCalls[1].params, { nodeId: 11, forcedPseudoClasses: [] });
  } finally {
    removeArtifactTree(dir);
  }
});

test('active:selector records a real transform delta and restores', async () => {
  const dir = makeSnapDir('active');
  try {
    const client = new StubCdpClient([SUBMIT_BUTTON], { 'button.submit': [13] });
    const ctx = makeCtx(dir, asClient(client), ['active:button.submit']);

    await collectStates(ctx);

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'active');
    assert.equal(el.supported, true);
    assert.deepEqual(el.style?.changed, ['transform']);
    assert.equal(el.style?.before.transform, 'none');
    assert.equal(el.style?.after.transform, 'scale(0.98)');
    assert.equal(el.forced?.restored, true);
  } finally {
    removeArtifactTree(dir);
  }
});

test('checked:selector forces the native checked property, records the delta, and restores it to false', async () => {
  const dir = makeSnapDir('checked');
  try {
    const client = new StubCdpClient([NOTIFY_TOGGLE], { 'input.notify-toggle': [12] });
    const ctx = makeCtx(dir, asClient(client), ['checked:input.notify-toggle']);

    await collectStates(ctx);

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'checked');
    assert.equal(el.supported, true);
    assert.deepEqual(el.style?.changed, ['background-color']);
    assert.equal(el.style?.after['background-color'], 'rgb(0, 128, 0)');
    assert.equal(el.forced?.applied, true);
    assert.equal(el.forced?.restored, true);

    const restoreCall = client.calls.find((c) => c.method === 'Runtime.evaluate' && String((c.params as { expression?: unknown }).expression).includes('__captureStateRestore_checked'));
    assert.ok(restoreCall, 'a restore expression was sent');
    // Restoration re-finds the element by its stable data-capture-state-id marker (not selector+index).
    assert.match(String((restoreCall!.params as { expression: string }).expression), /data-capture-state-id/);

    // The stub round-trips the captured `prev` back through the marker-keyed restore: forced true mid-capture, restored to its original false.
    assert.equal(NOTIFY_TOGGLE.checked, false);
  } finally {
    removeArtifactTree(dir);
  }
});

test('open:selector forces the native open property, records the geometry delta, and restores it', async () => {
  const dir = makeSnapDir('open');
  try {
    const client = new StubCdpClient([DETAILS_PANEL], { 'details.panel': [14] });
    const ctx = makeCtx(dir, asClient(client), ['open:details.panel']);

    await collectStates(ctx);

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'open');
    assert.equal(el.supported, true);
    assert.equal(el.geometry?.changed, true);
    assert.equal(el.geometry?.delta.dheight, 100);
    assert.equal(el.forced?.restored, true);

    const restoreCall = client.calls.find((c) => c.method === 'Runtime.evaluate' && String((c.params as { expression?: unknown }).expression).includes('__captureStateRestore_open'));
    assert.ok(restoreCall, 'a restore expression was sent');
    // Restoration re-finds the element by its stable data-capture-state-id marker (not selector+index).
    assert.match(String((restoreCall!.params as { expression: string }).expression), /data-capture-state-id/);
    assert.equal(DETAILS_PANEL.open, false);
  } finally {
    removeArtifactTree(dir);
  }
});

test('checked requested against an element with no checked property is reported unsupported, not thrown', async () => {
  const dir = makeSnapDir('unsupported-checked');
  try {
    const client = new StubCdpClient([BUTTON], { 'button.send-btn': [10] });
    const ctx = makeCtx(dir, asClient(client), ['checked:button.send-btn']);

    await collectStates(ctx);

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.supported, false);
    assert.equal(el.reason, 'element has no checked property');
    assert.equal(el.style, undefined);
    // Positive control: a genuine in-page `{ supported: false, reason }`
    // determination is NOT a force-read failure — no forceReadUnavailable
    // fact, and `forced` reports a confirmed (not uncertain) non-application.
    assert.strictEqual(el.forceReadUnavailable, undefined);
    assert.strictEqual(el.forceReadUnavailableReason, undefined);
    assert.deepEqual(el.forced, { applied: false });
  } finally {
    removeArtifactTree(dir);
  }
});

test('a force-read failure (Runtime.evaluate returns no result.value for the IDL-state force) is honestly distinguished from a genuine supported:false, with restoration marked unknown (I-5/I-6)', async () => {
  const dir = makeSnapDir('force-no-value');
  try {
    // The element genuinely supports the `disabled` IDL property (so a
    // pre-fix run would have no OTHER reason to report unsupported) — only
    // the FORCE evaluate itself resolves with no `value`, modeling a
    // `Runtime.evaluate` response that never produced a result for the force
    // call specifically (not a throw, not a genuine in-page determination).
    const flaky: FixtureElement = { ...NOTIFY_TOGGLE, nodeId: 902, checked: false, noValueOnForce: true };
    const client = new StubCdpClient([flaky], { 'input.notify-toggle': [902] });
    const ctx = makeCtx(dir, asClient(client), ['disabled:input.notify-toggle']);

    await collectStates(ctx);

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.supported, false, 'a force read that never resolved a value cannot be reported as a supported capture');
    // RED (pre-fix): `!value?.supported` was true for BOTH a missing value and a
    // genuine `{supported:false}`, and `value?.reason` was undefined either way,
    // so this collapsed to the exact same `reason: 'unsupported'` as a real
    // unsupported determination — indistinguishable (I-5).
    assert.strictEqual(el.forceReadUnavailable, true, 'RED pre-fix: no forceReadUnavailable fact was ever emitted');
    assert.strictEqual(el.forceReadUnavailableReason, 'force-evaluate-returned-no-value');
    assert.notStrictEqual(el.reason, 'unsupported', 'RED pre-fix: a failed force read must not read identically to a genuine unsupported determination');
    // I-6: whether the force script partially mutated the page before its
    // result became unreadable cannot be known — `forced` must not claim a
    // confirmed `{ applied: false }` (that would assert nothing happened).
    assert.deepEqual(el.forced, { applied: false, restorationUnknown: true }, 'RED pre-fix: forced was the confirmed-no-op { applied: false } with no restoration-uncertainty marker');
  } finally {
    removeArtifactTree(dir);
  }
});

test('a force-read failure (Runtime.evaluate returns a malformed value for the IDL-state force) is honestly distinguished from a genuine supported:false, with restoration marked unknown (I-5/I-6)', async () => {
  const dir = makeSnapDir('force-malformed-value');
  try {
    const flaky: FixtureElement = { ...NOTIFY_TOGGLE, nodeId: 903, checked: false, malformedForceValue: true };
    const client = new StubCdpClient([flaky], { 'input.notify-toggle': [903] });
    const ctx = makeCtx(dir, asClient(client), ['disabled:input.notify-toggle']);

    await collectStates(ctx);

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.supported, false, 'a malformed force-read value cannot be reported as a supported capture');
    assert.strictEqual(el.forceReadUnavailable, true, 'RED pre-fix: no forceReadUnavailable fact was ever emitted for a malformed (non-boolean-supported) value');
    assert.strictEqual(el.forceReadUnavailableReason, 'force-evaluate-returned-malformed-value');
    assert.notStrictEqual(el.reason, 'unsupported', 'RED pre-fix: a malformed force-read must not read identically to a genuine unsupported determination');
    assert.deepEqual(el.forced, { applied: false, restorationUnknown: true }, 'RED pre-fix: forced was the confirmed-no-op { applied: false } with no restoration-uncertainty marker');
  } finally {
    removeArtifactTree(dir);
  }
});

test('D9: a secret-shaped token planted in a page element\'s id is redacted out of the describeNode-derived selector', async () => {
  const dir = makeSnapDir('redaction-sentinel');
  try {
    // The token is page-controlled: it rides in the DOM node's `id` attribute,
    // which the collector reads via DOM.describeNode and turns into the emitted
    // `selector`. The requested `--state` value stays innocuous.
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';
    const leaky: FixtureElement = {
      nodeId: 60,
      nodeName: 'BUTTON',
      attributes: ['id', secret, 'class', 'go'],
      rect: { x: 0, y: 0, width: 40, height: 20 },
      baseStyle: { color: 'rgb(0, 0, 0)' },
      hit: { isTarget: true, topTag: 'BUTTON' },
    };
    const client = new StubCdpClient([leaky], { 'button.go': [60] });
    const ctx = makeCtx(dir, asClient(client), ['normal:button.go']);

    await collectStates(ctx);

    const raw = fs.readFileSync(path.join(dir, 'states.json'), 'utf-8');
    assert.ok(!raw.includes(secret), 'the page-planted secret token must not appear anywhere in states.json');
    const el = readStatesJson(dir).elements[0];
    assert.ok(!(el.selector ?? '').includes(secret));
    assert.match(el.selector ?? '', /\[REDACTED\]/, 'the token in the derived selector is replaced by the redaction marker');
  } finally {
    removeArtifactTree(dir);
  }
});

test('R1: a secret-shaped token planted in a computed-style value (cursor url) is redacted out of both style branches', async () => {
  const dir = makeSnapDir('redaction-style-value');
  try {
    // The token is page-controlled: it rides inside an author-set
    // `cursor: url(...)` computed-style value, which the collector copies
    // verbatim into states.json's before/after style objects. Property
    // NAMES come from the fixed STYLE_PROPS list and are never redacted;
    // only the VALUES must be. Requesting both `normal` (normal emit
    // branch) and `hover` (forced emit branch) exercises BOTH sites.
    const secret = 'github_pat_11ABCDE0000ABCDE0000abcdefghijklmnop';
    const cursed: FixtureElement = {
      nodeId: 70,
      nodeName: 'BUTTON',
      attributes: ['class', 'cursed'],
      rect: { x: 0, y: 0, width: 40, height: 20 },
      baseStyle: { cursor: `url("https://cdn.example.com/c.svg?t=${secret}"), auto`, color: 'rgb(0, 0, 0)' },
      hoverStyle: { color: 'rgb(255, 0, 0)' },
      hit: { isTarget: true, topTag: 'BUTTON' },
    };
    const client = new StubCdpClient([cursed], { 'button.cursed': [70] });
    const ctx = makeCtx(dir, asClient(client), ['normal:button.cursed', 'hover:button.cursed']);

    await collectStates(ctx);

    const raw = fs.readFileSync(path.join(dir, 'states.json'), 'utf-8');
    assert.ok(!raw.includes(secret), 'the page-planted token must not appear anywhere in states.json');
    const json = readStatesJson(dir);
    const normalEl = json.elements.find((e) => e.state === 'normal')!;
    const hoverEl = json.elements.find((e) => e.state === 'hover')!;
    // Normal emit branch: before === after, both redacted.
    assert.ok(!(normalEl.style?.before.cursor ?? '').includes(secret));
    assert.match(normalEl.style?.before.cursor ?? '', /\[REDACTED\]/);
    assert.match(normalEl.style?.after.cursor ?? '', /\[REDACTED\]/);
    // Forced emit branch: before/after style values both redacted.
    assert.ok(!(hoverEl.style?.before.cursor ?? '').includes(secret));
    assert.match(hoverEl.style?.before.cursor ?? '', /\[REDACTED\]/);
    assert.match(hoverEl.style?.after.cursor ?? '', /\[REDACTED\]/);
    // The non-secret property NAME survives and the color delta is still measured.
    assert.deepEqual(hoverEl.style?.changed, ['color']);
  } finally {
    removeArtifactTree(dir);
  }
});

test('a selector matching no elements is reported unsupported with a distinct reason', async () => {
  const dir = makeSnapDir('no-match');
  try {
    const client = new StubCdpClient([], {});
    const ctx = makeCtx(dir, asClient(client), ['hover:button.ghost']);

    await collectStates(ctx);

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'hover');
    assert.equal(el.selector, 'button.ghost');
    assert.equal(el.supported, false);
    assert.equal(el.reason, 'selector matched no elements');
    assert.equal(el.resolutionUnavailable, undefined, 'a genuine zero-match resolve must never be flagged as a resolution failure');
  } finally {
    removeArtifactTree(dir);
  }
});

test('a resolveNodeIds THROW is reported as an explicit resolution failure, never coerced into a benign no-match (I-5)', async () => {
  const dir = makeSnapDir('resolve-throws');
  try {
    // Models `DOM.getDocument`/`DOM.querySelectorAll` itself failing (CDP
    // connection hiccup, target navigated mid-call, etc.) — NOT a selector
    // that legitimately matched zero elements. A stub that only overrides
    // `DOM.getDocument` to throw proves the failure is caught at the real
    // call site inside `resolveNodeIds`, not simulated by pre-seeding an
    // empty selector map (which is what the no-match test above already
    // covers and must stay distinguishable from this).
    const inner = new StubCdpClient([], {});
    const throwing: CDPClient = {
      async send(method: string, params?: Record<string, unknown>) {
        if (method === 'DOM.getDocument') throw new Error('simulated CDP failure: target closed');
        return inner.send(method, params);
      },
    } as unknown as CDPClient;
    const ctx = makeCtx(dir, throwing, ['hover:button.ghost']);

    await collectStates(ctx);

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'hover');
    assert.equal(el.selector, 'button.ghost');
    assert.equal(el.supported, false);
    assert.equal(el.reason, 'selector resolution failed', 'must be distinct from the genuine no-match reason string');
    assert.notEqual(el.reason, 'selector matched no elements');
    assert.equal(el.resolutionUnavailable, true, 'the explicit I-5 unavailable marker must be set so a reader need not string-match `reason`');
  } finally {
    removeArtifactTree(dir);
  }
});

test('an unrecognized state name is reported unsupported, not thrown', async () => {
  const dir = makeSnapDir('bogus-state');
  try {
    const client = new StubCdpClient([BUTTON], { 'button.send-btn': [10] });
    const ctx = makeCtx(dir, asClient(client), ['bogus:button.send-btn']);

    await collectStates(ctx);

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'bogus:button.send-btn', 'the full raw spec is reported, since it could not be parsed into a state+selector pair');
    assert.equal(el.supported, false);
    assert.match(el.reason ?? '', /unrecognized state name/);
  } finally {
    removeArtifactTree(dir);
  }
});

test('all:selector expands into all 7 concrete states, each reported independently', async () => {
  const dir = makeSnapDir('all');
  try {
    // Fresh copy: NOTIFY_TOGGLE has checked/disabled/invalid support but no `open`.
    const el: FixtureElement = { ...NOTIFY_TOGGLE, checked: false };
    const client = new StubCdpClient([el], { 'input.notify-toggle': [12] });
    const ctx = makeCtx(dir, asClient(client), ['all:input.notify-toggle']);

    await collectStates(ctx);

    const elements = readStatesJson(dir).elements;
    assert.equal(elements.length, 7);
    const byState = new Map(elements.map((e) => [e.state, e]));
    assert.deepEqual([...byState.keys()].sort(), ['active', 'checked', 'disabled', 'focus', 'hover', 'invalid', 'open'].sort());

    assert.equal(byState.get('hover')?.supported, true);
    assert.equal(byState.get('focus')?.supported, true);
    assert.equal(byState.get('active')?.supported, true);
    assert.equal(byState.get('checked')?.supported, true);
    assert.equal(byState.get('disabled')?.supported, true);
    assert.equal(byState.get('invalid')?.supported, true);
    assert.equal(byState.get('open')?.supported, false);
    assert.equal(byState.get('open')?.reason, 'element has no boolean open property');
  } finally {
    removeArtifactTree(dir);
  }
});

test('a normal request captures a zero-delta baseline without forcing anything', async () => {
  const dir = makeSnapDir('normal');
  try {
    const client = new StubCdpClient([BUTTON], { 'button.send-btn': [10] });
    const ctx = makeCtx(dir, asClient(client), ['normal:button.send-btn']);

    await collectStates(ctx);

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'normal');
    assert.equal(el.supported, true);
    assert.equal(el.geometry?.changed, false);
    assert.deepEqual(el.style?.changed, []);
    assert.equal(client.calls.filter((c) => c.method === 'CSS.forcePseudoState').length, 0, 'normal never forces a pseudo-class');
  } finally {
    removeArtifactTree(dir);
  }
});

// ============================================================================
// Phase 3 honesty fixes — Class A (I-5) and Class B (I-3). Adversarial,
// RED-before-fix: each stub forces the specific failure the fix must
// distinguish, on an element that genuinely EXISTS, so the assertion cannot
// be satisfied by the pre-fix code's silent coercion.
// ============================================================================

test('Class A (I-5): a failed pre-force facts read (no value) is honestly distinguished from a genuine not-found', async () => {
  const dir = makeSnapDir('facts-no-value');
  try {
    // The element genuinely exists (registered under its selector, resolvable
    // via DOM.describeNode) — only the FIRST `__captureStateFacts` evaluate
    // resolves with no `value`, modeling a `Runtime.evaluate` response that
    // came back without ever producing a value (not a throw).
    const flaky: FixtureElement = { ...BUTTON, nodeId: 900, noValueOnFirstFacts: true };
    const client = new StubCdpClient([flaky], { 'button.send-btn': [900] });
    const ctx = makeCtx(dir, asClient(client), ['normal:button.send-btn']);

    await collectStates(ctx);

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.supported, false, 'a read that never resolved a value cannot be reported as a supported capture');
    // RED (pre-fix): `evalFacts` coerced the missing value to `{ exists: false }`,
    // so the record read as a genuine not-found with no failed-read fact at all.
    assert.strictEqual(el.factsUnavailable, true, 'RED pre-fix: no factsUnavailable fact was ever emitted');
    assert.strictEqual(el.factsUnavailableReason, 'facts-evaluate-returned-no-value');
    assert.notStrictEqual(
      el.reason,
      'element not found at capture time',
      'RED pre-fix: a failed read must not read identically to a genuinely-absent element',
    );
    // Identity resolution itself succeeded here — only the facts read failed — so
    // the record still carries a real backendNodeId, proving the two honesty facts
    // (Class A / Class B) are independent.
    assert.strictEqual(el.backendNodeId, 900 * 100);
    assert.strictEqual(el.identityUnresolved, undefined);
  } finally {
    removeArtifactTree(dir);
  }
});

test('Class B (I-3): a per-record identity resolution failure emits backendNodeId:null + identityUnresolved:true, never an omitted field', async () => {
  const dir = makeSnapDir('identity-unresolved');
  try {
    // The element genuinely exists and its facts read succeeds normally — only
    // DOM.describeNode fails to resolve a backendNodeId for it.
    const flaky: FixtureElement = { ...BUTTON, nodeId: 901, identityFails: true };
    const client = new StubCdpClient([flaky], { 'button.send-btn': [901] });
    const ctx = makeCtx(dir, asClient(client), ['normal:button.send-btn']);

    await collectStates(ctx);

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.supported, true, 'the facts read itself succeeded — only identity resolution failed');
    // RED (pre-fix): `backendNodeId: identity.backendNodeId` was `undefined`, and
    // JSON.stringify silently DROPS an undefined property — so the key was omitted
    // from states.json entirely, indistinguishable from "not element-bearing".
    assert.ok(Object.prototype.hasOwnProperty.call(el, 'backendNodeId'), 'RED pre-fix: the key was omitted from the emitted record entirely');
    assert.strictEqual(el.backendNodeId, null, 'RED pre-fix: this was undefined (omitted), never an explicit null');
    assert.strictEqual(el.identityUnresolved, true);
  } finally {
    removeArtifactTree(dir);
  }
});

test('the forced pseudo-class is still restored when the post-force capture throws', async () => {
  const dir = makeSnapDir('restore-on-error');
  try {
    const flaky: FixtureElement = { ...BUTTON, throwOnSecondFacts: true };
    const client = new StubCdpClient([flaky], { 'button.send-btn': [10] });
    const ctx = makeCtx(dir, asClient(client), ['hover:button.send-btn']);

    await collectStates(ctx);

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.supported, false);
    assert.match(el.reason ?? '', /facts read failed after forcing state/);
    assert.equal(el.factsUnavailable, true, 'the post-force facts read is honestly marked unavailable, not a generic capture error');
    assert.equal(el.factsUnavailableReason, 'facts-evaluate-threw');

    const forceCalls = client.calls.filter((c) => c.method === 'CSS.forcePseudoState');
    assert.equal(forceCalls.length, 2, 'restore still runs after the thrown error');
    assert.deepEqual(forceCalls[1].params, { nodeId: 10, forcedPseudoClasses: [] });
  } finally {
    removeArtifactTree(dir);
  }
});

test('the native invalid force restores a pre-existing customValidity even when the post-force capture throws', async () => {
  const dir = makeSnapDir('invalid-restore-on-error');
  try {
    // Native constraint-validation path (NOT a pseudo-state) with a pre-existing
    // app-set validity message, plus a mid-capture failure on the post-force capture.
    const emailInput: FixtureElement = {
      nodeId: 70,
      nodeName: 'INPUT',
      attributes: ['class', 'email'],
      rect: { x: 0, y: 0, width: 120, height: 24 },
      baseStyle: { color: 'rgb(0, 0, 0)' },
      hit: { isTarget: true, topTag: 'INPUT' },
      hasValidity: true,
      hadCustom: true,
      customMessage: 'pre-existing app error',
      throwOnSecondFacts: true,
    };
    const client = new StubCdpClient([emailInput], { 'input.email': [70] });
    const ctx = makeCtx(dir, asClient(client), ['invalid:input.email']);

    await collectStates(ctx);

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'invalid');
    assert.equal(el.supported, false, 'the injected mid-capture failure marks the record unsupported');
    assert.match(el.reason ?? '', /facts read failed after forcing state/);
    assert.equal(el.factsUnavailable, true);
    assert.deepEqual(el.forced, { applied: true, restored: true }, 'restoration ran in the finally window despite the failure');

    // The forced 'capture-forced-invalid' message is rolled back to the pre-existing
    // app-set validity EXACTLY — not wiped to '' and not left forced.
    assert.equal(emailInput.hadCustom, true);
    assert.equal(emailInput.customMessage, 'pre-existing app error');
  } finally {
    removeArtifactTree(dir);
  }
});

test('the native checked (radio) force restores every peer by its stable handle even when the post-force capture throws', async () => {
  const dir = makeSnapDir('radio-restore-on-error');
  try {
    // Three radios in one group: r1 initially checked. Forcing r2 checked unchecks
    // its peers mid-capture; a post-force failure must still restore the whole group.
    const r1: FixtureElement = { nodeId: 81, nodeName: 'INPUT', attributes: ['class', 'r1'], rect: { x: 0, y: 0, width: 16, height: 16 }, baseStyle: {}, hit: { isTarget: true, topTag: 'INPUT' }, hasChecked: true, type: 'radio', name: 'plan', checked: true };
    const r2: FixtureElement = { nodeId: 82, nodeName: 'INPUT', attributes: ['class', 'r2'], rect: { x: 0, y: 0, width: 16, height: 16 }, baseStyle: {}, hit: { isTarget: true, topTag: 'INPUT' }, hasChecked: true, type: 'radio', name: 'plan', checked: false, throwOnSecondFacts: true };
    const r3: FixtureElement = { nodeId: 83, nodeName: 'INPUT', attributes: ['class', 'r3'], rect: { x: 0, y: 0, width: 16, height: 16 }, baseStyle: {}, hit: { isTarget: true, topTag: 'INPUT' }, hasChecked: true, type: 'radio', name: 'plan', checked: false };
    const client = new StubCdpClient([r1, r2, r3], { 'input.r2': [82] });
    const ctx = makeCtx(dir, asClient(client), ['checked:input.r2']);

    await collectStates(ctx);

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'checked');
    assert.equal(el.supported, false, 'the injected mid-capture failure marks the record unsupported');
    assert.match(el.reason ?? '', /facts read failed after forcing state/);
    assert.equal(el.factsUnavailable, true);
    assert.deepEqual(el.forced, { applied: true, restored: true });

    // The whole group is restored to its pre-force state despite the failure.
    assert.equal(r1.checked, true, 'the originally-checked peer is restored');
    assert.equal(r2.checked, false, 'the forced radio is restored to unchecked');
    assert.equal(r3.checked, false);

    // Restoration resolves each peer by its stable data-capture-state-radio-id handle,
    // not by re-running querySelectorAll('input[type=radio]') order.
    const restoreExpr = String(
      (client.calls.find(
        (c) => c.method === 'Runtime.evaluate' && String((c.params as { expression?: unknown }).expression).includes('__captureStateRestore_checked'),
      )!.params as { expression: string }).expression,
    );
    assert.match(restoreExpr, /data-capture-state-radio-id/);
  } finally {
    removeArtifactTree(dir);
  }
});

test('the REAL generated buildForceExpression `checked` JS rolls back an in-page partial mutation when a radio peer throws partway (executed against a fake DOM, not hand-simulated)', async () => {
  const dir = makeSnapDir('real-force-rollback-checked');
  try {
    // Three real radios in one group, executed through the ACTUAL
    // __captureStateForce_checked template string, not StubCdpClient's
    // hand-simulated TS. r1 starts checked (the pre-existing selection);
    // r2 is the element being forced; r3's setAttribute throws ONLY for the
    // radio-peer tag, AFTER r1 and r2 (el itself, also a peer of its own
    // group) have already been tagged successfully — modeling a throw
    // partway through the incremental peer-tagging loop.
    const r1 = makeFakeRadio(true);
    const r2 = makeFakeRadio(false);
    const r3 = makeFakeRadio(false, /* throwOnRadioTag */ true);

    const fakeDocument = {
      querySelectorAll(sel: string): unknown[] {
        if (sel === 'input.r2') return [r2];
        if (sel === 'input[type="radio"]') return [r1, r2, r3];
        return [];
      },
    };

    const client = new RealForceExpressionStub(fakeDocument, { nodeName: 'INPUT', backendNodeId: 8200, attributes: ['class', 'r2'] });
    const ctx = makeCtx(dir, client as unknown as CDPClient, ['checked:input.r2']);

    await collectStates(ctx);

    assert.equal(
      client.forceExpressionEscaped,
      false,
      'the real force expression must swallow its own throw internally (in-page try/catch) and never let it escape the IIFE',
    );

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'checked');
    assert.equal(el.supported, false, 'the in-page throw during peer-tagging must surface as an unsupported (rolled back) result, not a false positive');
    assert.match(el.reason ?? '', /force failed \(rolled back\)/, "the real script reports its OWN rollback reason, not a generic Node-side 'capture error'");
    assert.deepEqual(
      el.forced,
      { applied: false },
      'no Node-side restoreFn is installed — the real script already rolled everything back in-page before the CDP response returned',
    );

    // No marker leak on ANY of the three REAL fake elements — proves the
    // incremental rollback undid exactly what had been applied so far,
    // including the peer (r2/el itself) that was successfully tagged
    // BEFORE r3 threw.
    assert.equal(r1.hasAttribute('data-capture-state-radio-id'), false, 'r1 was tagged before the throw and must be untagged by the in-page catch');
    assert.equal(r2.hasAttribute('data-capture-state-id'), false, "the forced element's own marker must be untagged");
    assert.equal(r2.hasAttribute('data-capture-state-radio-id'), false, 'r2 (el) was also tagged as its own peer before the throw and must be untagged');
    assert.equal(r3.hasAttribute('data-capture-state-radio-id'), false, 'r3 never got tagged since its own setAttribute call is what threw');

    // `el.checked = true` sits textually AFTER the peers loop and never
    // executes; the originally-checked peer is never touched.
    assert.equal(r1.checked, true, 'the originally-checked peer must remain checked');
    assert.equal(r2.checked, false, 'the forced element is rolled back to its pre-force checked value');
    assert.equal(r3.checked, false);
  } finally {
    removeArtifactTree(dir);
  }
});

test('the REAL generated buildForceExpression `invalid` JS rolls back an in-page mutation when setCustomValidity throws (executed against a fake DOM, not hand-simulated)', async () => {
  const dir = makeSnapDir('real-force-rollback-invalid');
  try {
    // A single element whose setCustomValidity throws on the forcing call
    // (the FIRST invocation) but succeeds on the rollback call the script's
    // own catch makes afterward — modeling a one-shot hostile setter.
    const email = makeFakeInvalidatable(/* throwOnFirstCall */ true);

    const fakeDocument = {
      querySelectorAll(sel: string): unknown[] {
        if (sel === 'input.email') return [email];
        return [];
      },
    };

    const client = new RealForceExpressionStub(fakeDocument, { nodeName: 'INPUT', backendNodeId: 7000, attributes: ['class', 'email'] });
    const ctx = makeCtx(dir, client as unknown as CDPClient, ['invalid:input.email']);

    await collectStates(ctx);

    assert.equal(client.forceExpressionEscaped, false, 'the real force expression must swallow its own throw internally and never let it escape the IIFE');

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'invalid');
    assert.equal(el.supported, false);
    assert.match(el.reason ?? '', /force failed \(rolled back\)/);
    assert.deepEqual(el.forced, { applied: false });

    // The marker is untagged by the in-page catch, and the script attempted
    // its own rollback call (setCustomValidity('') since there was no
    // pre-existing custom message) even though the forcing call itself threw.
    assert.equal(email.hasAttribute('data-capture-state-id'), false, "the element's marker must be untagged after the rollback");
    assert.deepEqual(email.calls, ['capture-forced-invalid', ''], 'the script attempted the forcing call, then its own rollback call, after the throw');
  } finally {
    removeArtifactTree(dir);
  }
});

test('the REAL generated buildForceExpression `checked` JS rolls back AFTER the checked property was genuinely flipped, and stays resolved (does not escape) even when the marker-removal rollback op itself throws (executed against a fake DOM, not hand-simulated)', async () => {
  const dir = makeSnapDir('real-force-rollback-checked-mutate-then-throw');
  try {
    // Unlike the peer-tagging rollback test above (which throws BEFORE
    // `el.checked = true` ever runs), this element's `checked` SETTER itself
    // genuinely applies the value (mutation lands) and THEN throws — proving
    // rollback after a real property mutation, not a no-op. Its
    // `removeAttribute` is ALSO hostile for the marker attribute specifically,
    // so the script's own rollback has to survive ONE of its OWN rollback
    // steps throwing — the Major-A "rollback op itself throws" case.
    const toggle = makeFakeIdlToggle('checked', /* initialValue */ false, { throwOnSetTrue: true, throwOnRemoveMarker: true });

    const fakeDocument = {
      querySelectorAll(sel: string): unknown[] {
        if (sel === 'input.plain-checkbox') return [toggle];
        return [];
      },
    };

    const client = new RealForceExpressionStub(fakeDocument, { nodeName: 'INPUT', backendNodeId: 8300, attributes: ['class', 'plain-checkbox'] });
    const ctx = makeCtx(dir, client as unknown as CDPClient, ['checked:input.plain-checkbox']);

    await collectStates(ctx);

    assert.equal(
      client.forceExpressionEscaped,
      false,
      'a rollback step (marker removeAttribute) throwing must NOT escape the IIFE — the script must still resolve to a value',
    );

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'checked');
    assert.equal(el.supported, false);
    assert.match(el.reason ?? '', /force failed \(rolled back/, 'the script reports its OWN rollback reason, not a generic Node-side capture error');
    assert.match(el.reason ?? '', /rollback incomplete/, 'the reason must surface that a rollback step itself failed, as a restoration fact');
    assert.deepEqual(el.forced, { applied: false });

    // The property mutation genuinely happened (the setter set `value = true`
    // before throwing) and is genuinely restored afterward, despite the
    // marker cleanup itself failing — proving best-effort rollback of
    // everything ELSE even when one specific step cannot succeed.
    assert.equal(toggle.checked, false, 'the checked property must be restored to its original value even though marker removal failed');
    assert.equal(toggle.hasAttribute('data-capture-state-id'), true, 'the marker itself is the one rollback step that is hostile here and is honestly left in place, not silently claimed as removed');
  } finally {
    removeArtifactTree(dir);
  }
});

test('the REAL generated buildForceExpression `checked` JS restores every radio PEER after el.checked = true genuinely applied native auto-uncheck semantics and then threw (executed against a fake DOM, not hand-simulated)', async () => {
  const dir = makeSnapDir('real-force-rollback-checked-radio-peer-native-uncheck');
  try {
    // Unlike the peer-TAGGING rollback test above (which throws during the
    // peer-tagging loop, BEFORE `el.checked = true` ever runs, so no peer is
    // ever actually unchecked), this scenario lets `el.checked = true` run
    // for real: r2 (the forced element)'s own `checked` setter genuinely
    // applies NATIVE radio-group semantics as a side effect — unchecking its
    // previously-checked peer r1 — and only THEN throws, mirroring a hostile
    // setter that mutates (including the native group side effect) before
    // failing. This is the exact gap the reviewer flagged: the in-page catch
    // must roll back r1's checked value too, not just `el`'s own.
    const group: Array<{ checked: boolean }> = [];
    const r1 = makeFakeRadioGroupPeer(group, /* initialChecked */ true);
    const r2 = makeFakeRadioGroupPeer(group, /* initialChecked */ false, /* throwOnSetTrue */ true);
    const r3 = makeFakeRadioGroupPeer(group, /* initialChecked */ false);

    const fakeDocument = {
      querySelectorAll(sel: string): unknown[] {
        if (sel === 'input.r2') return [r2];
        if (sel === 'input[type="radio"]') return [r1, r2, r3];
        return [];
      },
    };

    const client = new RealForceExpressionStub(fakeDocument, { nodeName: 'INPUT', backendNodeId: 8900, attributes: ['class', 'r2'] });
    const ctx = makeCtx(dir, client as unknown as CDPClient, ['checked:input.r2']);

    await collectStates(ctx);

    assert.equal(
      client.forceExpressionEscaped,
      false,
      'the real force expression must swallow its own throw internally (in-page try/catch) and never let it escape the IIFE',
    );

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'checked');
    assert.equal(el.supported, false, 'the throw from the hostile checked setter must surface as an unsupported (rolled back) result');
    assert.match(el.reason ?? '', /force failed \(rolled back/, 'the script reports its OWN rollback reason, not a generic Node-side capture error');
    assert.deepEqual(el.forced, { applied: false }, 'no Node-side restoreFn is installed — the real script already rolled everything back in-page');

    // r1 was genuinely auto-unchecked as a native side effect of `el.checked =
    // true` running (NOT of the script's own peer-tagging loop, which never
    // writes `.checked`) before the throw — proving this test actually
    // exercises the native-uncheck-then-throw path, not the earlier
    // peer-tagging-throws-before-any-uncheck path.
    assert.equal(r1.checked, true, "the previously-checked peer's checked value must be restored to its recorded original (true)");
    assert.equal(r2.checked, false, 'the forced element itself is restored to its pre-force checked value (false)');
    assert.equal(r3.checked, false, 'the never-checked peer remains false');

    // Every peer's radio-id marker was removed, and the forced element's own marker too.
    assert.equal(r1.hasAttribute('data-capture-state-radio-id'), false);
    assert.equal(r2.hasAttribute('data-capture-state-radio-id'), false);
    assert.equal(r2.hasAttribute('data-capture-state-id'), false, "the forced element's own marker must be untagged");
    assert.equal(r3.hasAttribute('data-capture-state-radio-id'), false);
  } finally {
    removeArtifactTree(dir);
  }
});

test('the REAL generated buildForceExpression `invalid` JS rolls back AFTER validity state was genuinely mutated, and stays resolved (does not escape) even when the marker-removal rollback op itself throws (executed against a fake DOM, not hand-simulated)', async () => {
  const dir = makeSnapDir('real-force-rollback-invalid-mutate-then-throw');
  try {
    // Unlike the existing invalid rollback test above (whose fake throws
    // BEFORE changing validity state), this fake's setCustomValidity call
    // genuinely sets `hadCustom`/`customMessage` and THEN throws on its first
    // invocation — proving rollback after validity state was truly mutated.
    // Its `removeAttribute` is also hostile for the marker, exercising the
    // same "a rollback step itself throws" case as the checked test above.
    const email = makeFakeInvalidatableMutateThenThrow({ throwOnRemoveMarker: true });

    const fakeDocument = {
      querySelectorAll(sel: string): unknown[] {
        if (sel === 'input.email2') return [email];
        return [];
      },
    };

    const client = new RealForceExpressionStub(fakeDocument, { nodeName: 'INPUT', backendNodeId: 8400, attributes: ['class', 'email2'] });
    const ctx = makeCtx(dir, client as unknown as CDPClient, ['invalid:input.email2']);

    await collectStates(ctx);

    assert.equal(client.forceExpressionEscaped, false, 'a rollback step (marker removeAttribute) throwing must NOT escape the IIFE');

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'invalid');
    assert.equal(el.supported, false);
    assert.match(el.reason ?? '', /force failed \(rolled back/);
    assert.match(el.reason ?? '', /rollback incomplete/);
    assert.deepEqual(el.forced, { applied: false });

    // Validity state genuinely flipped (hadCustom -> true) then genuinely
    // reverted by the script's own already-guarded setCustomValidity rollback
    // call (its second invocation, which does not throw) — even though the
    // marker cleanup step failed.
    assert.equal(email.validity.customError, false, 'validity state must be restored to its original (non-custom) value even though marker removal failed');
    assert.deepEqual(email.calls, ['capture-forced-invalid', ''], 'the script attempted the forcing call, then its own validity rollback call, after the throw');
    assert.equal(email.hasAttribute('data-capture-state-id'), true, 'the marker itself is the one rollback step that is hostile here and is honestly left in place');
  } finally {
    removeArtifactTree(dir);
  }
});

test('the REAL generated buildForceExpression `disabled` JS rolls back a marker that was applied by a hostile setAttribute call moments before it threw (proves the marker-recording gap is closed, executed against a fake DOM, not hand-simulated)', async () => {
  const dir = makeSnapDir('real-force-rollback-disabled-marker-gap');
  try {
    // This element's setAttribute call for the `data-capture-state-id`
    // marker itself genuinely APPLIES the attribute and THEN throws —
    // modeling a hostile attribute-reflection observer. If the script only
    // records "I tagged this element" AFTER that call returns, the applied
    // marker is never recorded and a naive rollback skips removing it,
    // leaking the marker in the page even though the force is reported
    // unsupported.
    const control = makeFakeElementHostileMarkerTag('disabled', /* initialValue */ false);

    const fakeDocument = {
      querySelectorAll(sel: string): unknown[] {
        if (sel === 'button.submit-btn') return [control];
        return [];
      },
    };

    const client = new RealForceExpressionStub(fakeDocument, { nodeName: 'BUTTON', backendNodeId: 8500, attributes: ['class', 'submit-btn'] });
    const ctx = makeCtx(dir, client as unknown as CDPClient, ['disabled:button.submit-btn']);

    await collectStates(ctx);

    assert.equal(client.forceExpressionEscaped, false, 'the real force expression must swallow its own throw internally and never let it escape the IIFE');

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'disabled');
    assert.equal(el.supported, false);
    assert.match(el.reason ?? '', /force failed \(rolled back\)/);
    assert.deepEqual(el.forced, { applied: false });

    // The marker attribute WAS genuinely applied by the hostile setAttribute
    // call before it threw — the fix must still remove it, proving the
    // rollback record was written before (not after) the throwing call.
    assert.equal(control.hasAttribute('data-capture-state-id'), false, 'the marker applied by the mutate-then-throw setAttribute call must still be removed by rollback');
    assert.equal(control.disabled, false, 'the disabled property was never actually reached (the throw happened at the marker-tagging step) and remains at its original value');
  } finally {
    removeArtifactTree(dir);
  }
});

test('the REAL generated buildForceExpression `open` JS rolls back a marker that was applied by a hostile setAttribute call moments before it threw (proves the marker-recording gap is closed, executed against a fake DOM, not hand-simulated)', async () => {
  const dir = makeSnapDir('real-force-rollback-open-marker-gap');
  try {
    // Same marker-recording-gap scenario as the `disabled` test above, applied
    // to `open` — the other native state the reviewer flagged as having NO
    // rollback-failure injection at all.
    const control = makeFakeElementHostileMarkerTag('open', /* initialValue */ false);

    const fakeDocument = {
      querySelectorAll(sel: string): unknown[] {
        if (sel === 'details.accordion') return [control];
        return [];
      },
    };

    const client = new RealForceExpressionStub(fakeDocument, { nodeName: 'DETAILS', backendNodeId: 8600, attributes: ['class', 'accordion'] });
    const ctx = makeCtx(dir, client as unknown as CDPClient, ['open:details.accordion']);

    await collectStates(ctx);

    assert.equal(client.forceExpressionEscaped, false, 'the real force expression must swallow its own throw internally and never let it escape the IIFE');

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'open');
    assert.equal(el.supported, false);
    assert.match(el.reason ?? '', /force failed \(rolled back\)/);
    assert.deepEqual(el.forced, { applied: false });

    assert.equal(control.hasAttribute('data-capture-state-id'), false, 'the marker applied by the mutate-then-throw setAttribute call must still be removed by rollback');
    assert.equal(control.open, false, 'the open property was never actually reached (the throw happened at the marker-tagging step) and remains at its original value');
  } finally {
    removeArtifactTree(dir);
  }
});

test('the REAL generated buildForceExpression `disabled` JS rolls back AFTER the disabled property was genuinely flipped, and stays resolved (does not escape) even when the marker-removal rollback op itself throws (executed against a fake DOM, not hand-simulated)', async () => {
  const dir = makeSnapDir('real-force-rollback-disabled-mutate-then-throw');
  try {
    // Unlike the marker-gap test above (which throws at the marker-tagging
    // step, before `el.disabled = true` ever runs), this element's `disabled`
    // SETTER itself genuinely applies the value (mutation lands) and THEN
    // throws — proving rollback after a real property mutation, not a no-op.
    // Its `removeAttribute` is ALSO hostile for the marker attribute
    // specifically, so the script's own rollback has to survive ONE of its
    // OWN rollback steps throwing — the Major-A "rollback op itself throws"
    // case, for the one native state that previously had zero rollback
    // injection of either kind.
    const toggle = makeFakeIdlToggle('disabled', /* initialValue */ false, { throwOnSetTrue: true, throwOnRemoveMarker: true });

    const fakeDocument = {
      querySelectorAll(sel: string): unknown[] {
        if (sel === 'button.submit-btn2') return [toggle];
        return [];
      },
    };

    const client = new RealForceExpressionStub(fakeDocument, { nodeName: 'BUTTON', backendNodeId: 8700, attributes: ['class', 'submit-btn2'] });
    const ctx = makeCtx(dir, client as unknown as CDPClient, ['disabled:button.submit-btn2']);

    await collectStates(ctx);

    assert.equal(
      client.forceExpressionEscaped,
      false,
      'a rollback step (marker removeAttribute) throwing must NOT escape the IIFE — the script must still resolve to a value',
    );

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'disabled');
    assert.equal(el.supported, false);
    assert.match(el.reason ?? '', /force failed \(rolled back/, 'the script reports its OWN rollback reason, not a generic Node-side capture error');
    assert.match(el.reason ?? '', /rollback incomplete/, 'the reason must surface that a rollback step itself failed, as a restoration fact');
    assert.deepEqual(el.forced, { applied: false });

    // The property mutation genuinely happened (the setter set `value = true`
    // before throwing) and is genuinely restored afterward, despite the
    // marker cleanup itself failing — proving best-effort rollback of
    // everything ELSE even when one specific step cannot succeed.
    assert.equal(toggle.disabled, false, 'the disabled property must be restored to its original value even though marker removal failed');
    assert.equal(toggle.hasAttribute('data-capture-state-id'), true, 'the marker itself is the one rollback step that is hostile here and is honestly left in place, not silently claimed as removed');
  } finally {
    removeArtifactTree(dir);
  }
});

test('the REAL generated buildForceExpression `open` JS rolls back AFTER the open property was genuinely flipped, and stays resolved (does not escape) even when the marker-removal rollback op itself throws (executed against a fake DOM, not hand-simulated)', async () => {
  const dir = makeSnapDir('real-force-rollback-open-mutate-then-throw');
  try {
    // Same mutate-then-throw + rollback-op-itself-throws scenario as the
    // `disabled` test above, applied to `open` — closing out the last native
    // state that previously had only marker-gap coverage.
    const toggle = makeFakeIdlToggle('open', /* initialValue */ false, { throwOnSetTrue: true, throwOnRemoveMarker: true });

    const fakeDocument = {
      querySelectorAll(sel: string): unknown[] {
        if (sel === 'details.accordion2') return [toggle];
        return [];
      },
    };

    const client = new RealForceExpressionStub(fakeDocument, { nodeName: 'DETAILS', backendNodeId: 8800, attributes: ['class', 'accordion2'] });
    const ctx = makeCtx(dir, client as unknown as CDPClient, ['open:details.accordion2']);

    await collectStates(ctx);

    assert.equal(
      client.forceExpressionEscaped,
      false,
      'a rollback step (marker removeAttribute) throwing must NOT escape the IIFE — the script must still resolve to a value',
    );

    const el = readStatesJson(dir).elements[0];
    assert.equal(el.state, 'open');
    assert.equal(el.supported, false);
    assert.match(el.reason ?? '', /force failed \(rolled back/, 'the script reports its OWN rollback reason, not a generic Node-side capture error');
    assert.match(el.reason ?? '', /rollback incomplete/, 'the reason must surface that a rollback step itself failed, as a restoration fact');
    assert.deepEqual(el.forced, { applied: false });

    assert.equal(toggle.open, false, 'the open property must be restored to its original value even though marker removal failed');
    assert.equal(toggle.hasAttribute('data-capture-state-id'), true, 'the marker itself is the one rollback step that is hostile here and is honestly left in place, not silently claimed as removed');
  } finally {
    removeArtifactTree(dir);
  }
});
