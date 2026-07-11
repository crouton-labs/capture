/**
 * focus.json cycle-detection + identity contract. Two things are proven here
 * without a real browser:
 *
 * A. Both Tab walks terminate after ONE full ring, and cycle detection
 *    identifies a repeated stop by TRUE per-node identity — never by the stop's
 *    geometry or content, and never by a page-authored attribute or a page
 *    global. For a real-but-untagged active element that identity is the
 *    node's CDP `backendNodeId`, resolved out of band via the private
 *    objectId -> `DOM.describeNode` bridge on `document.activeElement`. Two
 *    distinct untagged nodes that share selector/rect/role/name (a
 *    geometry/content collision) get distinct backendNodeIds and are BOTH
 *    retained — the exact dropped-stop failure a geometry/content key would
 *    cause. The strongest adversary is also covered: two distinct real active
 *    elements carrying the SAME page-authored `data-capture-focus-id`
 *    (`raw.id` collision) are still told apart by their private backendNodeId,
 *    so a page cannot control cycle identity by stamping its own marker
 *    attributes. This is driven through the real `collectFocus` sampling path
 *    (walk + CDP), not by injecting stop keys directly.
 *
 * B. The production sample/cleanup/restore scripts neither derive identity
 *    from, nor mutate, page-owned state. Running the real script strings
 *    against a minimal DOM proves: the sample stamps no marker, reads no
 *    `data-capture-focus-walk-id` attribute and no `window.__captureFocusWalkSeq`
 *    global for identity, and emits no `walkId`; and cleanup/restore strip
 *    ONLY collector-stamped markers, leaving a page-authored
 *    `data-capture-focus-walk-id` attribute and any page global exactly as
 *    found (I-2/I-6).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  collectFocus,
  FOCUS_SAMPLE_SCRIPT,
  MARKER_CLEANUP_SCRIPT,
  buildRestoreScript,
  type FocusReport,
} from '../src/cdp/measure/collectors/focus.js';
import type { SnapshotContext, SnapshotWriter } from '../src/cdp/measure/types.js';
import type { CDPClient } from '../src/cdp/client.js';

interface Sample {
  id: string | null;
  selector: string | null;
  isBody: boolean;
  hasActiveElement: boolean;
  /** The stable node identity a real browser would return from the objectId -> DOM.describeNode bridge for a real-but-untagged active element; irrelevant for tagged/body samples. */
  backendNodeId?: number;
}

const BODY: Sample = { id: null, selector: null, isBody: true, hasActiveElement: false };
// Tagged candidates. Cycle identity now keys on the private backendNodeId for
// EVERY real active element (tagged or not), never on the marker `id`, so even
// a tagged element resolves a per-node backendNodeId through the objectId
// bridge — exactly as a real browser always would.
const A: Sample = { id: 'focus-1', selector: 'button#a', isBody: false, hasActiveElement: true, backendNodeId: 1 };
const B: Sample = { id: 'focus-2', selector: 'button#b', isBody: false, hasActiveElement: true, backendNodeId: 2 };

// Two DISTINCT untagged focusable nodes deliberately sharing selector, rect,
// role, and name — separable ONLY by their per-node CDP backendNodeId. A
// geometry/content cycle key (or a shared page-authored attribute) would treat
// them as one stop and drop the second.
const UNTAGGED_X: Sample = { id: null, selector: 'div', isBody: false, hasActiveElement: true, backendNodeId: 101 };
const UNTAGGED_Y: Sample = { id: null, selector: 'div', isBody: false, hasActiveElement: true, backendNodeId: 102 };

// Two DISTINCT real active elements that both carry the SAME page-authored
// `data-capture-focus-id` value (`raw.id === 'collide'` on both) — the exact
// adversary a page controls by stamping its own `data-capture-focus-id`
// attributes (or colliding one with a collector `focus-N` marker). If cycle
// identity trusted the marker `id`, both would key on `id:collide`, the second
// would be dropped as a false cycle, and the walk would end after ONE stop.
// They are separable ONLY by their per-node CDP backendNodeId (201 vs 202).
const COLLIDE_X: Sample = { id: 'collide', selector: 'div.dup', isBody: false, hasActiveElement: true, backendNodeId: 201 };
const COLLIDE_Y: Sample = { id: 'collide', selector: 'div.dup', isBody: false, hasActiveElement: true, backendNodeId: 202 };

function sampleToRaw(s: Sample): unknown {
  return {
    id: s.id,
    selector: s.selector,
    role: null,
    name: null,
    rect: s.isBody ? null : { x: 10, y: 10, width: 60, height: 24 },
    tabIndex: s.isBody ? null : 0,
    focusVisibleStyle: null,
    scrollX: 0,
    scrollY: 0,
    isBody: s.isBody,
    hasActiveElement: s.hasActiveElement,
  };
}

/**
 * A stub CDP client that models a keyboard tab ring. `Input.dispatchKeyEvent`
 * with the Shift modifier (bit 8) flips into reverse mode; each subsequent
 * `__captureFocusSample` evaluate returns the next stop from the active
 * direction's ring, cycling indefinitely — so a walk that fails to detect
 * completion would run to the 300-step hard cap. For a real-but-untagged
 * active element the collector resolves identity by evaluating
 * `document.activeElement` as a held RemoteObject and calling `DOM.describeNode`
 * off its objectId; this stub models that bridge, mapping the current ring
 * stop to a distinct objectId/backendNodeId so distinct untagged nodes stay
 * distinct. The forward/reverse rings are supplied per test.
 */
class TabRingStubCdpClient extends EventEmitter {
  private reverse = false;
  private forwardStep = 0;
  private reverseStep = 0;
  /** Every objectId the collector asked us to release, so a test can assert the transient handle was cleaned up. */
  readonly released: string[] = [];

  constructor(
    private readonly forwardRing: Sample[],
    private readonly reverseRing: Sample[],
  ) {
    super();
  }

  private currentSample(): Sample {
    const ring = this.reverse ? this.reverseRing : this.forwardRing;
    const step = this.reverse ? this.reverseStep : this.forwardStep;
    return ring[(step - 1) % ring.length];
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Input.dispatchKeyEvent') {
      // The keyUp of each Tab press advances the ring; rawKeyDown is ignored
      // so a single Tab (down+up) advances exactly one stop.
      if (params.type === 'keyUp') {
        this.reverse = (params.modifiers as number) === 8;
        if (this.reverse) this.reverseStep += 1;
        else this.forwardStep += 1;
      }
      return {};
    }
    if (method === 'Runtime.evaluate') {
      const expr = String(params.expression ?? '');
      // The collector-private identity bridge: `document.activeElement` as a
      // held RemoteObject (returnByValue:false). Map the current untagged stop
      // to a distinct objectId — the page has no way to influence this.
      if (expr.trim() === 'document.activeElement' && params.returnByValue === false) {
        const s = this.currentSample();
        if (s.backendNodeId === undefined) return { result: {} };
        return { result: { objectId: `obj-${s.backendNodeId}` } };
      }
      if (expr.includes('__captureFocusOrigin')) {
        return { result: { value: { hadOriginalFocus: false, scrollX: 0, scrollY: 0 } } };
      }
      if (expr.includes('__captureFocusInit')) {
        return {
          result: {
            value: {
              candidates: [
                { id: 'focus-1', selector: 'button#a', tabIndex: 0, rect: { x: 10, y: 10, width: 60, height: 24 }, visible: true, domIndex: 0 },
                { id: 'focus-2', selector: 'button#b', tabIndex: 0, rect: { x: 10, y: 50, width: 60, height: 24 }, visible: true, domIndex: 1 },
              ],
              clickableUnfocusable: [],
              clickableTruncated: false,
              iframesPresent: 0,
              shadowHostsPresent: 0,
            },
          },
        };
      }
      if (expr.includes('__captureFocusSample')) {
        // step is 1-indexed (incremented by the preceding Tab keyUp); cycle
        // through the ring forever so a broken walk would never terminate.
        return { result: { value: sampleToRaw(this.currentSample()) } };
      }
      if (expr.includes('__captureFocusRestore') || expr.includes('__captureFocusMarkerCleanup')) {
        return { result: { value: { focusRestored: true, markersRemoved: true, scrollRestored: true } } };
      }
      return { result: { value: {} } };
    }
    // Identity resolution off the objectId bridge — decode the backendNodeId
    // the objectId encodes. Marker-based tagged resolution returns nothing
    // resolvable (the tagged stops key on their marker id, not backendNodeId).
    if (method === 'DOM.describeNode') {
      const objectId = String(params.objectId ?? '');
      const m = objectId.match(/^obj-(\d+)$/);
      if (m) return { node: { backendNodeId: Number(m[1]) } };
      return { node: {} };
    }
    if (method === 'Runtime.releaseObject') {
      this.released.push(String(params.objectId ?? ''));
      return {};
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') return { nodeIds: [] };
    return {};
  }
}

function makeCtx(client: unknown): { ctx: SnapshotContext; written: Map<string, unknown> } {
  const written = new Map<string, unknown>();
  const writer: SnapshotWriter = {
    json(filename, value) {
      written.set(filename, value);
    },
    binary(filename, data) {
      written.set(filename, data);
    },
  };
  const ctx: SnapshotContext = {
    client: client as CDPClient,
    dir: '/tmp/measure-focus-cycle-test',
    snapId: 'snap-focus-cycle',
    url: 'http://example.test',
    viewport: '390x844',
    settled: true,
    freezeAnimations: false,
    captureUnsettled: false,
    pixels: false,
    state: [],
    unstableRegions: [],
    write: writer,
  };
  return { ctx, written };
}

test('collectFocus: the forward walk terminates after one full cycle even when the wraparound passes through an untagged document.body gap (id === null)', async () => {
  // Forward ring: wraparound passes through the untagged body gap FIRST — the
  // shape that never keys on a marker id. Reverse enters on a real tagged
  // element (the control that always terminated).
  const { ctx, written } = makeCtx(new TabRingStubCdpClient([BODY, A, B], [B, A]));
  await collectFocus(ctx);
  const focus = written.get('focus.json') as FocusReport;

  assert.equal(focus.available, true, 'the traversal completed');

  // The core fix: 3 stops (body, #a, #b), NOT the 300-step hard cap.
  assert.equal(focus.forward.length, 3, `expected the forward walk to stop after one cycle (3 stops), got ${focus.forward.length} — a 300 here is the wraparound-to-cap bug`);
  assert.equal(focus.forwardTruncated, false, 'the forward walk reached a NATURAL stop (a return to the body gap), not the hard cap');

  // The wraparound stop is genuinely present and untagged, proving this
  // exercises the real body-gap failure mode.
  assert.equal(focus.forward[0].id, null, 'step 1 is the untagged document.body gap (id === null)');
  assert.equal(focus.forward[0].identityUnresolved, undefined, 'a genuine document.body stop is not identityUnresolved');
  assert.deepEqual(focus.forward.map((s) => s.selector), [null, 'button#a', 'button#b'], 'the ring visited body, then both real focusable elements, once each');

  // The reverse walk (control) also terminates naturally — it always did.
  assert.equal(focus.reverse.length, 2, 'the reverse walk stops after its 2-element cycle');
  assert.equal(focus.reverseTruncated, false, 'the reverse walk reached a natural stop');
});

test('collectFocus: two distinct untagged focus stops that share selector/rect/role/name are both retained, told apart by the collector-private CDP backendNodeId cycle key (never geometry/content or a page attribute/global)', async () => {
  // Forward ring: two DIFFERENT nodes with identical selector/rect/role/name,
  // separable only by the backendNodeId the CDP objectId bridge resolves. A
  // geometry/content key (or a shared page-authored attribute) would collapse Y
  // into X and terminate after one stop, silently dropping the second
  // legitimate stop. Reverse walks the same two nodes in the other order (also
  // both retained) as an independent control.
  const client = new TabRingStubCdpClient([UNTAGGED_X, UNTAGGED_Y], [UNTAGGED_Y, UNTAGGED_X]);
  const { ctx, written } = makeCtx(client);
  await collectFocus(ctx);
  const focus = written.get('focus.json') as FocusReport;

  assert.equal(focus.available, true, 'the traversal completed');

  // The regression guard: BOTH untagged stops are recorded before the ring
  // wraps. A geometry/content key drops the second (forward.length === 1).
  assert.equal(focus.forward.length, 2, `expected both distinct untagged stops retained (2 stops), got ${focus.forward.length} — a 1 here is the geometry-key (or shared-attribute) collision dropping the second legitimate stop`);
  assert.equal(focus.forwardTruncated, false, 'the forward walk reached a NATURAL stop (the ring wrapping back to the first node), not the hard cap');

  // The two nodes are told apart by the COLLECTOR-PRIVATE CDP backendNodeId
  // cycle key (resolved via the objectId bridge, distinct 101 vs 102) — which
  // is why both survive. That private key is NOT emitted: the FocusStop
  // identity contract is unchanged, so each untagged stop still reports
  // backendNodeId: null + identityUnresolved: true (no marker the
  // cross-artifact join resolved), never a page attribute/global.
  for (const stop of focus.forward) {
    assert.equal(stop.id, null, 'each stop is untagged (id === null)');
    assert.equal(stop.backendNodeId, null, 'the private cycle key is never leaked into emitted JSON — untagged stops still emit backendNodeId: null');
    assert.equal(stop.identityUnresolved, true, 'each untagged stop honestly reports identityUnresolved (no marker resolved in the cross-artifact join)');
    assert.equal(stop.selector, 'div', 'both stops share the same selector');
    assert.deepEqual(stop.rect, { x: 10, y: 10, width: 60, height: 24 }, 'both stops share the same rect');
    assert.equal(stop.role, null, 'both stops share the same (absent) role');
    assert.equal(stop.name, null, 'both stops share the same (absent) name');
  }

  // The transient RemoteObject handles opened to resolve the private cycle key
  // were released (no leaked CDP handles) — proving the objectId bridge, not a
  // page marker, is what distinguished the two stops.
  assert.ok(client.released.includes('obj-101') && client.released.includes('obj-102'), 'both objectId handles were released after identity resolution');

  // The reverse walk (control) likewise retains both distinct nodes.
  assert.equal(focus.reverse.length, 2, 'the reverse walk retains both distinct untagged stops too');
  assert.equal(focus.reverseTruncated, false, 'the reverse walk reached a natural stop');
});

test('collectFocus: two distinct real active elements carrying the SAME page-authored data-capture-focus-id are both retained — cycle identity keys on the private CDP backendNodeId, never on the page-controllable marker id', async () => {
  // The adversary the U29 review demanded: a page stamps identical
  // `data-capture-focus-id` values on two genuinely different focused nodes
  // (raw.id === 'collide' on both). The OLD stopKey returned `id:collide` for
  // both, so the second stop matched a "seen" key and was dropped as a false
  // cycle — the page directly controlled cycle identity and silenced a real
  // stop. With identity now resolved from the collector-private backendNodeId
  // (201 vs 202) regardless of raw.id, both stops survive. Reverse walks the
  // same colliding pair in the other order as an independent control.
  const client = new TabRingStubCdpClient([COLLIDE_X, COLLIDE_Y], [COLLIDE_Y, COLLIDE_X]);
  const { ctx, written } = makeCtx(client);
  await collectFocus(ctx);
  const focus = written.get('focus.json') as FocusReport;

  assert.equal(focus.available, true, 'the traversal completed');

  // The regression guard: BOTH colliding-id stops are recorded. A marker-id
  // cycle key drops the second (forward.length === 1) — the page-controlled
  // identity bug this test locks out.
  assert.equal(focus.forward.length, 2, `expected both distinct nodes retained despite the shared page-authored data-capture-focus-id (2 stops), got ${focus.forward.length} — a 1 here is the page controlling cycle identity via the marker id`);
  assert.equal(focus.forwardTruncated, false, 'the forward walk reached a NATURAL stop (the ring wrapping back to the first node), not the hard cap');

  // Both stops carry the identical page-authored marker id, yet were told
  // apart by the private backendNodeId the objectId bridge resolved (201 vs
  // 202) — proving the marker id is NOT the cycle key.
  assert.deepEqual(focus.forward.map((s) => s.id), ['collide', 'collide'], 'both retained stops carry the identical page-authored data-capture-focus-id');
  assert.ok(client.released.includes('obj-201') && client.released.includes('obj-202'), 'both distinct backendNodeId handles were resolved and released — the private identity source, not the shared marker, distinguished the stops');

  // The reverse walk (control) likewise retains both colliding-id nodes.
  assert.equal(focus.reverse.length, 2, 'the reverse walk retains both colliding-id stops too');
  assert.equal(focus.reverseTruncated, false, 'the reverse walk reached a natural stop');
});

// ---------------------------------------------------------------------------
// B. The production scripts neither derive identity from nor mutate page state.
// ---------------------------------------------------------------------------

/** A minimal fake element that tracks its attributes and every mutation. */
function makeEl(initial: Record<string, string>) {
  const attrs: Record<string, string> = { ...initial };
  const setCalls: Array<[string, string]> = [];
  const removeCalls: string[] = [];
  return {
    nodeType: 1,
    tagName: 'DIV',
    id: '',
    className: '',
    tabIndex: 0,
    textContent: 'hello world',
    getBoundingClientRect: () => ({ x: 1, y: 2, width: 3, height: 4 }),
    getClientRects: () => [{}],
    offsetParent: {},
    getAttribute: (k: string) => (Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null),
    hasAttribute: (k: string) => Object.prototype.hasOwnProperty.call(attrs, k),
    setAttribute: (k: string, v: string) => { attrs[k] = String(v); setCalls.push([k, String(v)]); },
    removeAttribute: (k: string) => { delete attrs[k]; removeCalls.push(k); },
    focus: undefined as undefined | (() => void),
    _attrs: attrs,
    _setCalls: setCalls,
    _removeCalls: removeCalls,
  };
}
type FakeEl = ReturnType<typeof makeEl>;

/** A minimal fake document whose querySelectorAll/querySelector match `[attr]` selectors (single or comma-separated) over a fixed element list. */
function makeDoc(els: FakeEl[], body: object) {
  const match = (sel: string) => {
    const names = sel.split(',').map((s) => s.trim().replace(/^\[/, '').replace(/\]$/, ''));
    return els.filter((el) => names.some((n) => el.hasAttribute(n)));
  };
  return {
    activeElement: null as FakeEl | null,
    body,
    querySelectorAll: (sel: string) => match(sel),
    querySelector: (sel: string) => match(sel)[0] ?? null,
  };
}

function runScript(script: string, win: object, doc: object): unknown {
  // The production script string is `/* comment */\n(function(){...})();` — an
  // expression statement ending in `;`. Assign it to a local (no ASI hazard,
  // unlike a bare `return`) to capture the IIFE's value.
  return new Function('window', 'document', `const __r = ${script}\nreturn __r;`)(win, doc);
}

test('FOCUS_SAMPLE_SCRIPT derives no identity from — and never mutates — page-authored attributes or globals', () => {
  // The active element carries a PAGE-authored data-capture-focus-walk-id (the
  // exact attribute name the old, page-controllable approach used) and the page
  // has preseeded window.__captureFocusWalkSeq. Neither may influence the sample
  // or be touched by it.
  const activeEl = makeEl({ 'data-capture-focus-walk-id': 'page-owned-collide' });
  const win = {
    __captureFocusWalkSeq: 999,
    scrollX: 5,
    scrollY: 6,
    getComputedStyle: () => ({ outlineStyle: 'solid', outlineWidth: '1px', outlineColor: 'red', boxShadow: 'none' }),
  };
  const doc = { activeElement: activeEl, body: {} };

  const sample = runScript(FOCUS_SAMPLE_SCRIPT, win, doc) as Record<string, unknown>;

  // The sample emits no walkId at all — identity is resolved out of band via CDP.
  assert.equal('walkId' in sample, false, 'the sample carries no walkId field');
  assert.equal(sample.id, null, 'the active element is untagged (no data-capture-focus-id)');
  assert.equal(sample.hasActiveElement, true, 'a real non-body active element is element-bearing');

  // No marker was stamped and no page state was mutated for identity.
  assert.deepEqual(activeEl._setCalls, [], 'the sample stamps no attribute on the active element');
  assert.equal(activeEl._attrs['data-capture-focus-walk-id'], 'page-owned-collide', 'the page-authored attribute is left exactly as found');
  assert.equal(win.__captureFocusWalkSeq, 999, 'the page global is never read-for-identity or mutated');
});

test('MARKER_CLEANUP_SCRIPT and buildRestoreScript strip only collector-stamped markers, preserving page-owned attributes and globals', () => {
  // --- cleanup ---
  const tagged = makeEl({ 'data-capture-focus-id': 'focus-1' });
  const clickable = makeEl({ 'data-capture-focus-clickable-id': 'click-1' });
  const original = makeEl({ 'data-capture-focus-original': '1' });
  // A page's OWN attribute that collides with the retired marker name — must survive.
  const pageOwned = makeEl({ 'data-capture-focus-walk-id': 'page-owned' });
  const win = { __captureFocusWalkSeq: 42 };
  const doc = makeDoc([tagged, clickable, original, pageOwned], {});

  const cleanup = runScript(MARKER_CLEANUP_SCRIPT, win, doc) as { markersRemoved: boolean };

  assert.equal(tagged._attrs['data-capture-focus-id'], undefined, 'the collector-stamped candidate marker was removed');
  assert.equal(clickable._attrs['data-capture-focus-clickable-id'], undefined, 'the collector-stamped clickable marker was removed');
  assert.equal(original._attrs['data-capture-focus-original'], undefined, 'the collector-stamped original marker was removed');
  assert.equal(pageOwned._attrs['data-capture-focus-walk-id'], 'page-owned', 'the page-authored attribute is preserved (cleanup never queries or removes it)');
  assert.equal(win.__captureFocusWalkSeq, 42, 'the page global is left untouched by cleanup');
  assert.equal(cleanup.markersRemoved, true, 'all collector markers are gone');

  // --- restore ---
  const rOriginal = makeEl({ 'data-capture-focus-original': '1' });
  const rTagged = makeEl({ 'data-capture-focus-id': 'focus-1' });
  const rPageOwned = makeEl({ 'data-capture-focus-walk-id': 'page-owned' });
  const rDoc = makeDoc([rOriginal, rTagged, rPageOwned], {});
  rOriginal.focus = () => { rDoc.activeElement = rOriginal; };
  const rWin = {
    __captureFocusWalkSeq: 7,
    scrollX: 0,
    scrollY: 0,
    scrollTo(x: number, y: number) { this.scrollX = x; this.scrollY = y; },
  };

  const restore = runScript(buildRestoreScript(true, 5, 6), rWin, rDoc) as {
    focusRestored: boolean;
    markersRemoved: boolean;
    scrollRestored: boolean;
  };

  assert.equal(restore.focusRestored, true, 'the original active element was refocused by its marker');
  assert.equal(rTagged._attrs['data-capture-focus-id'], undefined, 'restore removed the collector candidate marker');
  assert.equal(rOriginal._attrs['data-capture-focus-original'], undefined, 'restore removed the collector original marker');
  assert.equal(rPageOwned._attrs['data-capture-focus-walk-id'], 'page-owned', 'restore preserves the page-authored attribute');
  assert.equal(rWin.__captureFocusWalkSeq, 7, 'restore leaves the page global untouched');
  assert.equal(restore.markersRemoved, true, 'all collector markers are gone after restore');
  assert.equal(restore.scrollRestored, true, 'scroll was restored to the captured origin (5,6)');
  assert.deepEqual([rWin.scrollX, rWin.scrollY], [5, 6], 'restore scrolled to the origin coordinates');
});
