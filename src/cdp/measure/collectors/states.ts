/**
 * `states.json` collector — the interaction-state matrix substrate behind
 * `snap --state` (`diff --full`/`explain` read this file for the per-state
 * style/geometry/hittest deltas; there is no separate top-level command).
 * Written ONLY when at least one `--state` was requested (`ctx.state.length
 * > 0`); otherwise this is a no-op (no file written). Owned by U12.
 *
 * Independent of the other 13 collectors (they all fan out via
 * `Promise.all` in `snapshot.ts` — there is no cross-collector read
 * ordering, and `geometry.json`/`styles.json`/`hittest.json` may not exist
 * yet when this runs), so this collector drives its own minimal
 * geometry/style/hittest re-capture per forced element rather than reading
 * those files. Scope: top-frame light DOM only — elements inside an
 * iframe or a shadow root are out of reach of `DOM.querySelectorAll`'s
 * plain (non-piercing) subtree walk and are not visited here; frame/shadow
 * stitching is `geometry.json`'s concern, not this collector's.
 *
 * ## `--state` grammar (`ctx.state`, each entry `<name>` or `<name>:<selector>`)
 *  - `name` is one of `normal|hover|focus|active|checked|open|disabled|invalid|all`.
 *  - With a `:<selector>` suffix, the state is scoped to the (capped) CSS
 *    matches of that selector. Without one, it's applied to a capped,
 *    independently-derived "eligible" element set per state (interactive
 *    elements for hover/focus/active/normal; native checkbox/radio inputs
 *    for checked; `details`/`dialog` for open; native disable-able form
 *    controls for disabled; constraint-validation-capable controls for
 *    invalid).
 *  - `all` expands to all 7 concrete states (not `normal`) against the
 *    same selector (or each state's own eligible set, if bare).
 *  - An unrecognized `name` is reported as one unsupported fact — never
 *    thrown.
 *
 * ## Forcing mechanism
 *  - `hover`/`focus`/`active` use `CSS.forcePseudoState` (U05's
 *    `forcePseudoStateForNode`) — `focus` forces both `focus` and
 *    `focus-visible` together so pages that key off either selector show
 *    the state change. Restored by forcing `[]` afterward.
 *  - `checked`/`disabled`/`open`/`invalid` are not real CSS pseudo-classes
 *    in this sense; they're forced via reversible, capped IDL-property
 *    writes in-page (`el.checked`, `el.disabled`, `el.open`,
 *    `el.setCustomValidity(...)`), gated on the element actually exposing
 *    that property/method live (never assumed from tag name alone) and
 *    restored to the pre-forced value afterward. An element that doesn't
 *    expose the property is an unsupported fact, not an error.
 *  - Every forced element's original value is restored in a `finally`
 *    block, even when the post-force capture throws. The native-state force
 *    expression itself is ALSO self-contained: it records what it is about
 *    to mutate (a marker id, a radio peer, an IDL property's previous value)
 *    BEFORE the call that applies it, then wraps the mutation in an in-page
 *    `try`/`catch` whose rollback is built entirely out of non-throwing
 *    (best-effort) primitives — so a throw partway through (e.g. a hostile
 *    element whose `setAttribute` or property setter mutates and THEN
 *    throws, or whose rollback call itself throws) can never leave a marker
 *    or a flipped property behind unrecorded, and can never let the
 *    rollback failure itself escape the expression uncaught. The response
 *    always resolves to `{ supported: false, reason }` on that path (`reason`
 *    says "rollback incomplete" if a rollback step itself failed) — so the
 *    Node-side `finally` never needs to guess: it only installs a
 *    `restoreFn` when the force response reports `supported: true`.
 *
 * ## `states.json` shape
 * ```
 * {
 *   requested: string[];        // ctx.state, verbatim
 *   truncatedRequests: Array<{  // one entry per --state request whose match count exceeded its cap (MAX_SELECTOR_MATCHES/MAX_AUTO_ELEMENTS) — never silent (I-5)
 *     state: string; selector?: string; matched: number; kept: number;
 *   }>;
 *   elements: Array<{
 *     id: string;                // "state-<n>", sequential within this file
 *     state: string;             // concrete state name, or "normal", or the raw unrecognized name
 *     selector?: string;         // requested selector, or a best-effort tag#id.class for an auto-discovered element
 *     backendNodeId?: number | null;  // present (never omitted) once an element was resolved: the real id, or null when DOM.describeNode failed — see identityUnresolved
 *     identityUnresolved?: true;      // true only alongside a null backendNodeId
 *     axName?: string;           // aria-label, when present (capped)
 *     text?: string;             // trimmed textContent (capped)
 *     supported: boolean;
 *     reason?: string;           // present when supported is false
 *     forced?: { applied: boolean; restored?: boolean; restorationUnknown?: true };  // restorationUnknown true only when applied:false alongside forceReadUnavailable — a mutation may have partially applied before the force's own result became unreadable
 *     geometry?: { before: Rect; after: Rect; delta: {dx,dy,dwidth,dheight}; changed: boolean };
 *     style?: { changed: string[]; before: Record<string,string>; after: Record<string,string> };
 *     hittest?: { before: {isTarget,topTag}; after: {isTarget,topTag}; changed: boolean };
 *     factsUnavailable?: true;        // the pre/post evalFacts read itself failed — distinct from a genuine not-found
 *     factsUnavailableReason?: 'facts-evaluate-threw' | 'facts-evaluate-returned-no-value';
 *     resolutionUnavailable?: true;    // `resolveNodeIds` itself threw for this request — distinct from a genuine zero-match selector (I-5)
 *     forceReadUnavailable?: true;     // the IDL-state force Runtime.evaluate resolved with no/malformed result.value — distinct from a genuine in-page `{supported:false}` (I-5)
 *     forceReadUnavailableReason?: 'force-evaluate-returned-no-value' | 'force-evaluate-returned-malformed-value';
 *   }>;
 * }
 * ```
 * `normal` entries always have `supported: true` and a zero delta (before
 * === after) — a baseline row for the matrix, not a forced capture.
 */

import type { CDPClient } from '../../client.js';
import type { Rect } from '../../coordinates.js';
import { forcePseudoStateForNode, type ForcedPseudoClass } from '../../domains.js';
import type { Collector } from '../types.js';
import { sanitizeString } from '../redaction.js';

// ============================================================================
// Constants
// ============================================================================

/** Defensive cap on how many elements a single explicit `state:selector` request will process. */
const MAX_SELECTOR_MATCHES = 10;
/** Defensive cap on how many auto-discovered elements a bare (no-selector) state request will process — smaller than the selector cap since it has a wider blast radius. */
const MAX_AUTO_ELEMENTS = 8;
/** Per-field length cap applied NODE-SIDE to page-controlled strings (text, aria-label). Passed to {@link sanitizeString} as `{ max }` — a tighter bound than the shared default. */
const MAX_STRING_LEN = 200;

const CONCRETE_STATES = ['hover', 'focus', 'active', 'checked', 'open', 'disabled', 'invalid'] as const;
type ConcreteState = (typeof CONCRETE_STATES)[number];
type RequestedStateName = 'normal' | ConcreteState | 'all';

const CONCRETE_STATE_SET: ReadonlySet<string> = new Set(CONCRETE_STATES);

const INTERACTIVE_SELECTOR =
  'a[href], button, input, select, textarea, summary, [tabindex], [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"], [contenteditable="true"]';

/** Eligible-element CSS selector per state, used only when a request has no `:selector` suffix. */
const ELIGIBLE_SELECTORS: Record<Exclude<RequestedStateName, 'all'>, string> = {
  normal: INTERACTIVE_SELECTOR,
  hover: INTERACTIVE_SELECTOR,
  focus: INTERACTIVE_SELECTOR,
  active: INTERACTIVE_SELECTOR,
  checked: 'input[type="checkbox"], input[type="radio"]',
  open: 'details, dialog',
  disabled: 'button, input, select, textarea, fieldset, optgroup, option',
  invalid: 'input, select, textarea',
};

/** CSS pseudo-classes forced per pseudo-state — `focus` forces both `focus` and `focus-visible` so either selector form shows the delta. */
const PSEUDO_CLASS_MAP: Record<'hover' | 'focus' | 'active', ForcedPseudoClass[]> = {
  hover: ['hover'],
  focus: ['focus', 'focus-visible'],
  active: ['active'],
};

/** Curated computed-style properties most commonly affected by interaction states. */
const STYLE_PROPS = [
  'color',
  'background-color',
  'border-color',
  'border-width',
  'border-style',
  'outline-color',
  'outline-width',
  'outline-style',
  'outline-offset',
  'box-shadow',
  'opacity',
  'cursor',
  'text-decoration-line',
  'transform',
  'filter',
  'font-weight',
  'visibility',
  'display',
  'pointer-events',
] as const;

// ============================================================================
// Types
// ============================================================================

interface HitFacts {
  readonly isTarget: boolean;
  readonly topTag: string | null;
}

/** Fixed, factual reason a facts read itself could not be obtained (never a raw exception message, which is unbounded/page-influenced) — present only when {@link ElementFacts.factsUnavailable} is `true`. */
export type FactsUnavailableReason = 'facts-evaluate-threw' | 'facts-evaluate-returned-no-value';

/**
 * Fixed, factual reason the IDL-state FORCE `Runtime.evaluate` call's own
 * result could not be read — distinct from `Runtime.evaluate` throwing
 * (handled by the outer `catch` as a generic capture error) and distinct
 * from a genuine in-page `{ supported: false, reason }` the force expression
 * itself returned (that IS a real, honest determination — never marked with
 * this reason). Present only when a record's `forceReadUnavailable` is `true`.
 */
export type ForceReadUnavailableReason = 'force-evaluate-returned-no-value' | 'force-evaluate-returned-malformed-value';

interface ElementFacts {
  readonly exists: boolean;
  readonly tag?: string;
  readonly rect?: Rect;
  readonly style?: Record<string, string>;
  readonly hit?: HitFacts;
  readonly text?: string | null;
  readonly axName?: string | null;
  /** `true` when this facts read itself failed (`Runtime.evaluate` threw, or resolved with no `value`) — set only by {@link evalFacts}'s own failure wrapping, never by the in-page expression. Distinguishes "could not read" from a genuine `exists:false` measured value (I-5); `exists` is always `false` alongside this marker but must not be read as a measured not-found. */
  readonly factsUnavailable?: true;
  readonly factsUnavailableReason?: FactsUnavailableReason;
}

interface GeometryDelta {
  readonly before: Rect;
  readonly after: Rect;
  readonly delta: { dx: number; dy: number; dwidth: number; dheight: number };
  readonly changed: boolean;
}

interface StyleDelta {
  readonly changed: string[];
  readonly before: Record<string, string>;
  readonly after: Record<string, string>;
}

interface HittestDelta {
  readonly before: HitFacts;
  readonly after: HitFacts;
  readonly changed: boolean;
}

interface StateElementRecord {
  readonly id: string;
  readonly state: string;
  readonly selector?: string;
  /** `number | null` (never omitted) on every record emitted from {@link captureOneElement} — i.e. every record backed by a `DOM.querySelectorAll`-resolved node. `null` when identity resolution itself failed (`DOM.describeNode` threw or returned no `backendNodeId`) — see {@link identityUnresolved}. Omitted entirely on the two record shapes that precede element resolution (an unrecognized `--state` name, or a request whose selector/eligible-set matched zero elements), since no element was ever identified there. */
  readonly backendNodeId?: number | null;
  /** `true` when {@link backendNodeId} is `null` because identity resolution failed — never omit this alongside a `null` backendNodeId. Absent (not `false`) when identity resolved or the record predates element resolution. */
  readonly identityUnresolved?: true;
  readonly axName?: string;
  readonly text?: string;
  readonly supported: boolean;
  readonly reason?: string;
  /** `true` when this request's `resolveNodeIds` call itself threw (`DOM.getDocument`/`DOM.querySelectorAll` failed) — distinguishes "the selector could not even be resolved" from a genuine `reason: 'selector matched no elements'`/`'no eligible element found for this state'` result, which implies resolution succeeded and simply found zero matches (I-5). Never set alongside a resolved `nodeIds` list. */
  readonly resolutionUnavailable?: true;
  /** `true` when the IDL-state FORCE `Runtime.evaluate` resolved with no `result.value` at all, or with a value missing/mistyping the `supported` field — i.e. the force expression's own outcome could never be read, distinct from a genuine in-page `{ supported: false }` determination (I-5). Never set alongside a genuinely-read `value.supported`. */
  readonly forceReadUnavailable?: true;
  readonly forceReadUnavailableReason?: ForceReadUnavailableReason;
  /** Restoration fact for a non-`normal` state: whether a reversible force was applied, and (when it was) whether the page was restored afterward. Present on unsupported/error branches too so restoration is never silently omitted. When {@link forceReadUnavailable} is `true`, whether the in-page force script actually mutated the element before its result became unreadable cannot be determined — `applied` is reported as the conservative `false` but `restorationUnknown: true` marks that this is NOT a confirmed non-mutation (I-6): a genuinely-uncertain restoration state must never read identically to a confirmed no-op. */
  readonly forced?: { readonly applied: boolean; readonly restored?: boolean; readonly restorationUnknown?: true };
  readonly geometry?: GeometryDelta;
  readonly style?: StyleDelta;
  readonly hittest?: HittestDelta;
  /** `true` when the pre- or post-force `evalFacts` read itself failed (evaluate threw, or resolved with no `value`) — distinguishes "could not read" from a genuine `{exists:false}`/"not found" measured outcome (I-5). Present only on that failure path. */
  readonly factsUnavailable?: true;
  readonly factsUnavailableReason?: FactsUnavailableReason;
}

interface ParsedSpec {
  readonly name: RequestedStateName;
  readonly selector: string | null;
}

/** One `--state` request that matched more elements than its cap allowed — emitted so the cap's drop is never silent (I-5). One entry per over-capped request, not per dropped element. */
interface StatesTruncatedRequest {
  readonly state: string;
  readonly selector?: string;
  readonly matched: number;
  readonly kept: number;
}

interface WorkItem {
  readonly state: Exclude<RequestedStateName, 'all'>;
  readonly selector: string | null;
}

// ============================================================================
// Spec parsing / expansion
// ============================================================================

function parseStateSpec(raw: string): ParsedSpec | null {
  const idx = raw.indexOf(':');
  const name = (idx === -1 ? raw : raw.slice(0, idx)).trim();
  const selector = idx === -1 ? null : raw.slice(idx + 1).trim() || null;
  if (name !== 'normal' && name !== 'all' && !CONCRETE_STATE_SET.has(name)) {
    return null;
  }
  return { name: name as RequestedStateName, selector };
}

function expandSpecs(raw: readonly string[]): { items: WorkItem[]; invalidRaw: string[] } {
  const items: WorkItem[] = [];
  const invalidRaw: string[] = [];
  for (const entry of raw) {
    const parsed = parseStateSpec(entry);
    if (!parsed) {
      invalidRaw.push(entry);
      continue;
    }
    if (parsed.name === 'all') {
      for (const state of CONCRETE_STATES) items.push({ state, selector: parsed.selector });
    } else {
      items.push({ state: parsed.name, selector: parsed.selector });
    }
  }
  return { items, invalidRaw };
}

// ============================================================================
// Small page-controlled-string hygiene — `sanitizeToken` keeps a best-effort
// selector CSS-safe; the assembled selector (and every other page-controlled
// string this collector emits) is then routed through the shared
// `sanitizeString` length cap.
// ============================================================================

function sanitizeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Caps every emitted computed-style VALUE (page-controlled — `cursor` and
 * `filter` carry author-controlled `url(...)` of unbounded length).
 * Property NAMES come from the fixed {@link STYLE_PROPS} list and are never
 * page-controlled, so they pass through unchanged; only the values are
 * routed through the shared {@link sanitizeString} cap.
 */
function sanitizeStyleValues(style: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [prop, value] of Object.entries(style)) {
    out[prop] = sanitizeString(value);
  }
  return out;
}

function flattenAttributes(attributes: readonly string[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!attributes) return map;
  for (let i = 0; i + 1 < attributes.length; i += 2) {
    map.set(attributes[i], attributes[i + 1]);
  }
  return map;
}

function buildSelector(nodeName: string | undefined, attributes: readonly string[] | undefined): string | undefined {
  if (!nodeName) return undefined;
  const tag = nodeName.toLowerCase();
  const attrs = flattenAttributes(attributes);
  let selector = tag;
  const idAttr = attrs.get('id');
  if (idAttr) {
    const cleaned = sanitizeToken(idAttr);
    if (cleaned) selector += `#${cleaned}`;
  }
  const classAttr = attrs.get('class');
  if (classAttr) {
    for (const cls of classAttr.split(/\s+/).filter(Boolean).slice(0, 3)) {
      const cleaned = sanitizeToken(cls);
      if (cleaned) selector += `.${cleaned}`;
    }
  }
  return sanitizeString(selector);
}

// ============================================================================
// In-page expression builders — every expression is self-contained and
// re-selects `document.querySelectorAll(selector)[index]` fresh each call.
// That re-selection assumes the DOM was not mutated structurally between
// calls within one element's capture — an assumption that is NOT trusted
// blindly: `identityStillMatches` (below) independently re-resolves the
// element's `backendNodeId` after the post-force facts capture and compares
// it to the identity resolved before forcing, catching a synchronous
// reorder/replace that would otherwise let `selector[index]` silently
// reselect a different element. Every expression also carries a
// `__captureState*` marker in its function name so tests can pattern-match
// reliably, mirroring `settle.ts`'s `__captureSettle*` markers.
// ============================================================================

function buildFactsExpression(selector: string, index: number): string {
  return `(function __captureStateFacts() {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!el) return { exists: false };
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const style = {};
    for (const p of ${JSON.stringify(STYLE_PROPS)}) { style[p] = cs.getPropertyValue(p); }
    let topTag = null;
    let isTarget = false;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (rect.width > 0 && rect.height > 0 && cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight) {
      const stack = document.elementsFromPoint(cx, cy);
      const top = stack.length > 0 ? stack[0] : null;
      topTag = top ? top.tagName : null;
      isTarget = top === el;
    }
    return {
      exists: true,
      tag: el.tagName,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      style: style,
      hit: { isTarget: isTarget, topTag: topTag },
      text: (el.textContent || '').trim(),
      axName: el.getAttribute('aria-label'),
    };
  })()`;
}

type IdlState = Exclude<ConcreteState, 'hover' | 'focus' | 'active'>;

/**
 * Forces one reversible IDL-property state. The element is located by
 * `selector[index]` and immediately tagged with a unique
 * `data-capture-state-id` marker (its record id) so restoration can
 * re-find THAT element by a stable handle rather than a positional
 * `selector[index]` that could resolve differently if the force triggered
 * a re-render. The captured `prev` carries everything restoration needs to
 * put the page back exactly: for `checked` radios, each peer of the radio
 * group is tagged with a stable `data-capture-state-radio-id` handle and its
 * pre-force checked value is recorded (forcing one radio unchecks its
 * peers), so restoration reapplies each peer's state by that stable handle
 * rather than a fragile `querySelectorAll` re-query order that a
 * force-triggered DOM insert/reorder could misalign; for `invalid`, whether
 * a pre-existing custom-validity message was set and its text (so it is
 * preserved rather than wiped to '').
 *
 * Every case wraps its mutation in an in-page `try`/`catch`. The record of
 * WHAT to roll back is written BEFORE the call that might apply it — e.g.
 * `tagged = true` is set before the marker `setAttribute` call, and each
 * radio peer is pushed onto `radioGroup` before that peer's own
 * `setAttribute` call — so a page-hostile setter/method that applies its
 * mutation and THEN throws still leaves an accurate rollback record
 * behind, rather than an unrecorded (and therefore un-rolled-back) mutation.
 * The `catch` itself is then built ENTIRELY out of non-throwing rollback
 * primitives (`safeRemoveAttr`/`safeRestore`, both defined per-case via the
 * shared `helpers` string): every individual rollback step — attribute
 * removal, radio-peer restoration, the IDL property/validity restore — is
 * independently guarded, so one rollback step throwing (e.g. a hostile
 * `removeAttribute`) can never abort the rest of the rollback or escape the
 * IIFE. The `catch` therefore ALWAYS returns `{ supported: false, reason }`
 * — never lets an exception reach `Runtime.evaluate` — and when a rollback
 * step itself failed, `reason` says so ("rollback incomplete: ...") instead
 * of silently under-reporting a best-effort (not perfect) cleanup. The
 * calling `Runtime.evaluate` therefore never needs a Node-side `restoreFn`
 * for the failure branch: by the time the response comes back, the page is
 * already back to how it was (or as close as a hostile page allowed), or
 * the force fully succeeded and `prev` carries what restoration needs. This
 * is what makes `captureOneElement`'s pattern of "only install `restoreFn`
 * when `supported: true`" safe.
 */
function buildForceExpression(selector: string, index: number, state: IdlState, markerId: string): string {
  const base = `const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return { supported: false, reason: 'element no longer present' };`;
  const tag = `el.setAttribute('data-capture-state-id', ${JSON.stringify(markerId)});`;
  // Shared in-page rollback machinery, textually inlined into every case
  // below (each `buildForceExpression` call produces one self-contained IIFE
  // string with its own scope — there is no runtime module to share this
  // through, so it is duplicated per-case at the TS-source level instead).
  // `rollbackErrors` collects the message of any THROW a rollback operation
  // itself raises; `safeRemoveAttr`/`safeRestore` never let such a throw
  // propagate, so the surrounding `catch` body — and therefore the whole
  // IIFE — can never itself throw, no matter which individual rollback step
  // fails. `describeError` additionally guards against a hostile
  // `Error`-like object whose own `.message` getter throws.
  const helpers = `
        function describeError(e) { try { return (e && e.message) ? String(e.message) : String(e); } catch (de) { return 'unknown error'; } }
        var rollbackErrors = [];
        function safeRemoveAttr(node, name) { try { node.removeAttribute(name); } catch (re) { rollbackErrors.push(describeError(re)); } }
        function safeRestore(fn) { try { fn(); } catch (re) { rollbackErrors.push(describeError(re)); } }
        function rolledBackReason(e) { return 'force failed (rolled back' + (rollbackErrors.length ? ', rollback incomplete: ' + rollbackErrors.join('; ') : '') + '): ' + describeError(e); }`;
  switch (state) {
    case 'checked':
      // `tagged` is set to true BEFORE the marker `setAttribute` call (not
      // after it returns), and each radio peer is pushed onto `radioGroup`
      // BEFORE that peer's own `setAttribute` call — so a hostile
      // setter/method that applies its mutation and THEN throws still leaves
      // an accurate rollback record behind: the `catch` below always knows
      // what to (best-effort) undo, even for the exact call that threw.
      return `(function __captureStateForce_checked() { ${base}
        if (!('checked' in el)) return { supported: false, reason: 'element has no checked property' };${helpers}
        var tagged = false;
        var radioGroup = [];
        var prevChecked = el.checked;
        try {
          tagged = true;
          ${tag}
          if (el.type === 'radio' && el.name) {
            var scope = el.form || document;
            var peers = Array.prototype.slice.call(scope.querySelectorAll('input[type="radio"]')).filter(function(r){ return r.name === el.name; });
            for (var ri = 0; ri < peers.length; ri++) {
              var p = peers[ri];
              var rid = ${JSON.stringify(markerId)} + '-radio-' + ri;
              radioGroup.push({ rid: rid, checked: !!p.checked, el: p });
              p.setAttribute('data-capture-state-radio-id', rid);
            }
          }
          el.checked = true;
          return { supported: true, prev: { checked: !!prevChecked, radioGroup: radioGroup.length ? radioGroup.map(function(r){ return { rid: r.rid, checked: r.checked }; }) : null } };
        } catch (e) {
          if (tagged) safeRemoveAttr(el, 'data-capture-state-id');
          for (var rj = 0; rj < radioGroup.length; rj++) {
            var peerEntry = radioGroup[rj];
            safeRemoveAttr(peerEntry.el, 'data-capture-state-radio-id');
            safeRestore(function() { peerEntry.el.checked = peerEntry.checked; });
          }
          safeRestore(function() { el.checked = prevChecked; });
          return { supported: false, reason: rolledBackReason(e) };
        }
      })()`;
    case 'disabled':
      return `(function __captureStateForce_disabled() { ${base}
        if (!('disabled' in el)) return { supported: false, reason: 'element has no disabled property' };${helpers}
        var tagged = false;
        var prev = el.disabled;
        try {
          tagged = true;
          ${tag}
          el.disabled = true;
          return { supported: true, prev: { value: !!prev } };
        } catch (e) {
          if (tagged) safeRemoveAttr(el, 'data-capture-state-id');
          safeRestore(function() { el.disabled = prev; });
          return { supported: false, reason: rolledBackReason(e) };
        }
      })()`;
    case 'open':
      return `(function __captureStateForce_open() { ${base}
        if (!('open' in el) || typeof el.open !== 'boolean') return { supported: false, reason: 'element has no boolean open property' };${helpers}
        var tagged = false;
        var prev = el.open;
        try {
          tagged = true;
          ${tag}
          el.open = true;
          return { supported: true, prev: { value: !!prev } };
        } catch (e) {
          if (tagged) safeRemoveAttr(el, 'data-capture-state-id');
          safeRestore(function() { el.open = prev; });
          return { supported: false, reason: rolledBackReason(e) };
        }
      })()`;
    case 'invalid':
      return `(function __captureStateForce_invalid() { ${base}
        if (typeof el.setCustomValidity !== 'function') return { supported: false, reason: 'element has no constraint-validation API' };${helpers}
        var tagged = false;
        var hadCustom = !!(el.validity && el.validity.customError);
        var prevMsg = hadCustom ? (el.validationMessage || '') : '';
        try {
          tagged = true;
          ${tag}
          el.setCustomValidity('capture-forced-invalid');
          return { supported: true, prev: { hadCustom: hadCustom, prevMsg: prevMsg } };
        } catch (e) {
          if (tagged) safeRemoveAttr(el, 'data-capture-state-id');
          safeRestore(function() { el.setCustomValidity(hadCustom ? prevMsg : ''); });
          return { supported: false, reason: rolledBackReason(e) };
        }
      })()`;
  }
}

/**
 * Restores one forced IDL-property state, re-finding the element by its
 * stable `data-capture-state-id` marker (NOT `selector[index]`). Every
 * mutation step — the primary property write, each radio peer's `checked`
 * write and its own marker removal, and the final `data-capture-state-id`
 * removal — is wrapped in a non-throwing `__safe(fn)` guard, so a hostile
 * setter/`removeAttribute` throwing on ANY one step does not abort the rest:
 * restoration is best-effort PER STEP, not all-or-nothing. `__restoreOk`
 * starts `true` and flips to `false` the instant any `__safe` call catches,
 * so the returned `{ restored: boolean }` is `true` only when every step
 * genuinely succeeded — never a false claim of clean restoration when one
 * step silently failed. `checked` restores every radio-group peer's
 * original checked state by its stable `data-capture-state-radio-id` handle
 * (NOT re-query order). The recorded `prev.radioGroup` (the `rid` handles
 * tagged at force time) is the sole authority for which peers to restore —
 * the loop runs whenever `prev.radioGroup` is present, INDEPENDENT of the
 * restore-time target's current `type`/`name` (which the page may have
 * mutated between force and restore); a recorded peer that cannot be found,
 * have its `checked` restored, or have its marker cleared flips
 * `__restoreOk` to `false` rather than being silently skipped. `invalid`
 * restores the pre-existing custom-validity message exactly (or clears it
 * if there was none).
 */
function buildRestoreExpression(state: IdlState, prev: unknown, markerId: string): string {
  const find = `var el = document.querySelector(${JSON.stringify(`[data-capture-state-id="${markerId}"]`)}); if (!el) return { restored: false, reason: 'element no longer present' };`;
  const prevLit = JSON.stringify(prev ?? null);
  const helpers = `var __restoreOk = true; function __safe(fn) { try { fn(); } catch (re) { __restoreOk = false; } }`;
  switch (state) {
    case 'checked':
      return `(function __captureStateRestore_checked() { ${find}
        var prev = ${prevLit}; ${helpers}
        __safe(function() { el.checked = !!(prev && prev.checked); });
        if (prev && prev.radioGroup) {
          for (var i = 0; i < prev.radioGroup.length; i++) {
            var entry = prev.radioGroup[i];
            if (!entry || !entry.rid) { __restoreOk = false; continue; }
            var peer = document.querySelector('[data-capture-state-radio-id="' + entry.rid + '"]');
            if (peer) {
              __safe(function() { peer.checked = !!entry.checked; });
              __safe(function() { peer.removeAttribute('data-capture-state-radio-id'); });
            } else {
              __restoreOk = false;
            }
          }
        }
        __safe(function() { el.removeAttribute('data-capture-state-id'); });
        return { restored: __restoreOk };
      })()`;
    case 'disabled':
      return `(function __captureStateRestore_disabled() { ${find}
        var prev = ${prevLit}; ${helpers}
        __safe(function() { el.disabled = !!(prev && prev.value); });
        __safe(function() { el.removeAttribute('data-capture-state-id'); });
        return { restored: __restoreOk };
      })()`;
    case 'open':
      return `(function __captureStateRestore_open() { ${find}
        var prev = ${prevLit}; ${helpers}
        __safe(function() { el.open = !!(prev && prev.value); });
        __safe(function() { el.removeAttribute('data-capture-state-id'); });
        return { restored: __restoreOk };
      })()`;
    case 'invalid':
      return `(function __captureStateRestore_invalid() { ${find}
        var prev = ${prevLit}; ${helpers}
        __safe(function() { el.setCustomValidity(prev && prev.hadCustom ? prev.prevMsg : ''); });
        __safe(function() { el.removeAttribute('data-capture-state-id'); });
        return { restored: __restoreOk };
      })()`;
  }
}

// ============================================================================
// CDP-facing helpers
// ============================================================================

async function resolveNodeIds(client: CDPClient, selector: string, limit: number): Promise<{ nodeIds: number[]; total: number }> {
  const doc = (await client.send('DOM.getDocument', { depth: -1, pierce: false })) as { root: { nodeId: number } };
  const result = (await client.send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector })) as { nodeIds: number[] };
  return { nodeIds: result.nodeIds.slice(0, limit), total: result.nodeIds.length };
}

async function describeNode(client: CDPClient, nodeId: number): Promise<{ backendNodeId?: number; selector?: string }> {
  try {
    const described = (await client.send('DOM.describeNode', { nodeId })) as {
      node?: { nodeName?: string; backendNodeId?: number; attributes?: string[] };
    };
    return {
      backendNodeId: described.node?.backendNodeId,
      selector: buildSelector(described.node?.nodeName, described.node?.attributes),
    };
  } catch {
    return {};
  }
}

/**
 * Re-resolves `selector[index]`'s CURRENT `backendNodeId` via a fresh
 * `DOM.querySelectorAll` + `DOM.describeNode` round trip and compares it to
 * the `backendNodeId` this element was identified by BEFORE forcing —
 * catching the case where a synchronous DOM reorder/replace between the
 * pre-force and post-force capture makes the page-side
 * `document.querySelectorAll(selector)[index]` reselection resolve to a
 * DIFFERENT element than the one `before`/force operated on (I-3). Returns
 * `true` when nothing can be verified (`expectedBackendNodeId` was never
 * resolved in the first place) — best-effort, never a block on identity
 * that was already missing elsewhere in the pipeline; `false` on any CDP
 * failure or an actual mismatch.
 */
async function identityStillMatches(
  client: CDPClient,
  selector: string,
  index: number,
  expectedBackendNodeId: number | undefined,
): Promise<boolean> {
  if (expectedBackendNodeId === undefined) return true;
  try {
    const { nodeIds } = await resolveNodeIds(client, selector, index + 1);
    const nodeId = nodeIds[index];
    if (nodeId === undefined) return false;
    const described = await describeNode(client, nodeId);
    return described.backendNodeId === expectedBackendNodeId;
  } catch {
    return false;
  }
}

/** Reads pre/post-force facts for one element. A FAILED read — the evaluate throws, or resolves without a `value` — is wrapped as an explicit `factsUnavailable` fact rather than coerced to `{exists:false}` (I-5): a genuinely-absent element and a read that could not happen must stay distinguishable to every caller. */
async function evalFacts(client: CDPClient, selector: string, index: number): Promise<ElementFacts> {
  let response: { result?: { value?: ElementFacts } };
  try {
    response = (await client.send('Runtime.evaluate', {
      expression: buildFactsExpression(selector, index),
      returnByValue: true,
    })) as { result?: { value?: ElementFacts } };
  } catch {
    return { exists: false, factsUnavailable: true, factsUnavailableReason: 'facts-evaluate-threw' };
  }
  const value = response.result?.value;
  if (value === undefined) {
    return { exists: false, factsUnavailable: true, factsUnavailableReason: 'facts-evaluate-returned-no-value' };
  }
  return value;
}

function zeroDelta(before: Rect): GeometryDelta {
  return { before, after: before, delta: { dx: 0, dy: 0, dwidth: 0, dheight: 0 }, changed: false };
}

/** Captures one requested state on one already-resolved node: baseline facts, force (when not `normal`), post-force facts, delta, and — always, even on error — restoration. */
async function captureOneElement(
  client: CDPClient,
  selector: string,
  index: number,
  nodeId: number,
  identity: { backendNodeId?: number; selector?: string },
  state: Exclude<RequestedStateName, 'all'>,
  id: string,
): Promise<StateElementRecord> {
  const resolvedSelector = identity.selector ?? undefined;
  // `identity.backendNodeId` came from `describeNode`, which returns `{}` on
  // failure — `undefined` here means identity resolution failed, never that
  // resolution wasn't attempted (every `captureOneElement` caller resolves a
  // node first). Emit `null` + `identityUnresolved: true` per I-3, never omit.
  const backendNodeId = identity.backendNodeId ?? null;
  const identityUnresolved: true | undefined = identity.backendNodeId === undefined ? true : undefined;

  const before = await evalFacts(client, selector, index);
  if (before.factsUnavailable) {
    return {
      id,
      state,
      selector: resolvedSelector,
      backendNodeId,
      identityUnresolved,
      supported: false,
      reason: 'facts read failed at capture time',
      factsUnavailable: true,
      factsUnavailableReason: before.factsUnavailableReason,
    };
  }
  if (!before.exists) {
    return { id, state, selector: resolvedSelector, backendNodeId, identityUnresolved, supported: false, reason: 'element not found at capture time' };
  }

  const axName = before.axName ? sanitizeString(before.axName, { max: MAX_STRING_LEN }) : undefined;
  const text = before.text ? sanitizeString(before.text, { max: MAX_STRING_LEN }) : undefined;

  if (state === 'normal') {
    const rect = before.rect!;
    const style = sanitizeStyleValues(before.style!);
    const hit = before.hit!;
    return {
      id,
      state,
      selector: resolvedSelector,
      backendNodeId,
      identityUnresolved,
      axName,
      text,
      supported: true,
      geometry: zeroDelta(rect),
      style: { changed: [], before: style, after: style },
      hittest: { before: hit, after: hit, changed: false },
    };
  }

  const isPseudo = state === 'hover' || state === 'focus' || state === 'active';
  let restoreFn: (() => Promise<void>) | null = null;
  let supported = true;
  let didForce = false;
  let reason: string | undefined;
  let after: ElementFacts | undefined;
  let captureErrorReason: string | undefined;
  let restored = true;
  let afterFactsUnavailableReason: FactsUnavailableReason | undefined;
  let forceReadUnavailableReason: ForceReadUnavailableReason | undefined;

  try {
    if (isPseudo) {
      const classes = PSEUDO_CLASS_MAP[state];
      await forcePseudoStateForNode(client, nodeId, classes);
      didForce = true;
      restoreFn = () => forcePseudoStateForNode(client, nodeId, []);
    } else {
      const forceResponse = (await client.send('Runtime.evaluate', {
        expression: buildForceExpression(selector, index, state, id),
        returnByValue: true,
      })) as { result?: { value?: { supported: unknown; reason?: string; prev?: unknown } } };
      const value = forceResponse.result?.value;
      // A missing `result.value` (evaluate resolved without ever producing a
      // value) or a value that doesn't even carry a boolean `supported` field
      // (malformed) is a FAILED READ of the force outcome — never the same fact
      // as the in-page expression genuinely determining `{ supported: false }`.
      // The in-page expression (`buildForceExpression`) is self-contained and
      // ALWAYS resolves to a well-formed `{ supported, reason? }`/`{ supported,
      // prev }` on every path it controls, including its own rollback failures
      // (see the builder's doc comment) — so a value that fails this shape
      // check did not come from that contract being exercised honestly; it came
      // from the read itself failing. And because the force expression may have
      // partially executed a page mutation before the response became
      // unreadable, whether anything was actually applied cannot be determined
      // either (I-6) — that uncertainty is carried through to the returned
      // record below via `forced.restorationUnknown`, never silently reported
      // as a confirmed `{ applied: false }`.
      if (value === undefined) {
        supported = false;
        forceReadUnavailableReason = 'force-evaluate-returned-no-value';
        reason = 'force read failed: Runtime.evaluate returned no result value';
      } else if (typeof value.supported !== 'boolean') {
        supported = false;
        forceReadUnavailableReason = 'force-evaluate-returned-malformed-value';
        reason = 'force read failed: Runtime.evaluate returned a malformed value';
      } else if (!value.supported) {
        supported = false;
        reason = value.reason ? sanitizeString(value.reason) : 'unsupported';
      } else {
        didForce = true;
        const prev = value.prev;
        restoreFn = async () => {
          const restoreResponse = (await client.send('Runtime.evaluate', {
            expression: buildRestoreExpression(state, prev, id),
            returnByValue: true,
          })) as { result?: { value?: { restored?: boolean } } };
          if (restoreResponse.result?.value?.restored !== true) restored = false;
        };
      }
    }

    if (supported) {
      after = await evalFacts(client, selector, index);
      if (after.factsUnavailable) {
        supported = false;
        afterFactsUnavailableReason = after.factsUnavailableReason;
        reason = 'facts read failed after forcing state';
      } else if (!after.exists) {
        supported = false;
        reason = 'element no longer present after forcing state';
      } else if (!(await identityStillMatches(client, selector, index, identity.backendNodeId))) {
        supported = false;
        reason = 'post-force facts no longer resolve to the original element (identity check failed)';
      }
    }
  } catch (err) {
    supported = false;
    captureErrorReason = sanitizeString(`capture error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (restoreFn) {
      try {
        await restoreFn();
      } catch {
        restored = false;
      }
    }
  }

  if (!supported) {
    return {
      id,
      state,
      selector: resolvedSelector,
      backendNodeId,
      identityUnresolved,
      axName,
      text,
      supported: false,
      reason: captureErrorReason ?? reason,
      forced: didForce
        ? { applied: true, restored }
        : forceReadUnavailableReason
          ? { applied: false, restorationUnknown: true as const }
          : { applied: false },
      ...(afterFactsUnavailableReason ? { factsUnavailable: true as const, factsUnavailableReason: afterFactsUnavailableReason } : {}),
      ...(forceReadUnavailableReason ? { forceReadUnavailable: true as const, forceReadUnavailableReason } : {}),
    };
  }

  const beforeRect = before.rect!;
  const afterRect = after!.rect!;
  const rawBeforeStyle = before.style!;
  const rawAfterStyle = after!.style!;
  const beforeStyle = sanitizeStyleValues(rawBeforeStyle);
  const afterStyle = sanitizeStyleValues(rawAfterStyle);
  const beforeHit = before.hit!;
  const afterHit = after!.hit!;

  const geomChanged =
    beforeRect.x !== afterRect.x || beforeRect.y !== afterRect.y || beforeRect.width !== afterRect.width || beforeRect.height !== afterRect.height;
  const changedStyleProps = STYLE_PROPS.filter((p) => rawBeforeStyle[p] !== rawAfterStyle[p]);
  const hitChanged = beforeHit.isTarget !== afterHit.isTarget || beforeHit.topTag !== afterHit.topTag;

  return {
    id,
    state,
    selector: resolvedSelector,
    backendNodeId,
    identityUnresolved,
    axName,
    text,
    supported: true,
    forced: { applied: true, restored },
    geometry: {
      before: beforeRect,
      after: afterRect,
      delta: {
        dx: afterRect.x - beforeRect.x,
        dy: afterRect.y - beforeRect.y,
        dwidth: afterRect.width - beforeRect.width,
        dheight: afterRect.height - beforeRect.height,
      },
      changed: geomChanged,
    },
    style: { changed: changedStyleProps, before: beforeStyle, after: afterStyle },
    hittest: { before: beforeHit, after: afterHit, changed: hitChanged },
  };
}

// ============================================================================
// Collector entry point
// ============================================================================

export const collectStates: Collector = async (ctx) => {
  if (ctx.state.length === 0) return;
  const { client } = ctx;

  const { items, invalidRaw } = expandSpecs(ctx.state);
  const elements: StateElementRecord[] = [];
  const truncatedRequests: StatesTruncatedRequest[] = [];
  let seq = 0;

  for (const raw of invalidRaw) {
    elements.push({
      id: `state-${seq}`,
      state: sanitizeString(raw),
      supported: false,
      reason: `unrecognized state name (expected one of ${CONCRETE_STATES.join('|')}, normal, or all)`,
    });
    seq += 1;
  }

  for (const item of items) {
    const selector = item.selector ?? ELIGIBLE_SELECTORS[item.state];
    const limit = item.selector ? MAX_SELECTOR_MATCHES : MAX_AUTO_ELEMENTS;

    let nodeIds: number[];
    let total = 0;
    // I-5: a `resolveNodeIds` THROW (DOM.getDocument/DOM.querySelectorAll failed) must stay
    // distinguishable from a genuine zero-match resolve — both would otherwise collapse to the
    // same empty `nodeIds`/`total:0` and read as "the selector matched nothing", silently
    // coercing a failed read into a benign no-match result.
    let resolutionFailed = false;
    try {
      const resolved = await resolveNodeIds(client, selector, limit);
      nodeIds = resolved.nodeIds;
      total = resolved.total;
    } catch {
      nodeIds = [];
      resolutionFailed = true;
    }

    if (total > nodeIds.length) {
      truncatedRequests.push({
        state: item.state,
        selector: item.selector ? sanitizeString(item.selector) : undefined,
        matched: total,
        kept: nodeIds.length,
      });
    }

    if (nodeIds.length === 0) {
      elements.push({
        id: `state-${seq}`,
        state: item.state,
        selector: item.selector ? sanitizeString(item.selector) : undefined,
        supported: false,
        reason: resolutionFailed
          ? 'selector resolution failed'
          : item.selector
            ? 'selector matched no elements'
            : 'no eligible element found for this state',
        ...(resolutionFailed ? { resolutionUnavailable: true as const } : {}),
      });
      seq += 1;
      continue;
    }

    for (let i = 0; i < nodeIds.length; i += 1) {
      const nodeId = nodeIds[i];
      const identity = await describeNode(client, nodeId);
      const record = await captureOneElement(
        client,
        selector,
        i,
        nodeId,
        { backendNodeId: identity.backendNodeId, selector: identity.selector ?? (item.selector ? sanitizeString(item.selector) : undefined) },
        item.state,
        `state-${seq}`,
      );
      elements.push(record);
      seq += 1;
    }
  }

  ctx.write.json('states.json', {
    requested: ctx.state.map((s) => sanitizeString(s)),
    scope: { root: 'top-document', shadowDom: 'light-only' },
    elements,
    truncatedRequests,
  });
};
