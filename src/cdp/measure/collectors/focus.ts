/**
 * `focus.json` collector — the keyboard traversal recorded during capture:
 * forward Tab sequence and reverse Shift+Tab, per-step active element
 * identity/role/name/rect, scroll offset changes, focus-visible style
 * facts, DOM-order-vs-tab-order divergence, and focusable-but-unreached /
 * clickable-but-unfocusable elements.
 *
 * The walk is browser-driven (real `Input.dispatchKeyEvent` Tab/Shift+Tab
 * presses, sampled via `document.activeElement`) rather than a JS-computed
 * approximation — the design calls this out as the authoritative
 * measurement (a JS query can enumerate *candidates* but cannot reliably
 * predict native tab-order edge cases).
 *
 * ## Identity join key
 * Each element-bearing record (forward/reverse stops with a real active
 * element, `domOrderDivergence` entries, `unreachedFocusable` candidates, and
 * `clickableUnfocusable` elements) carries `backendNodeId: number | null`
 * (resolved via `DOM.describeNode` off the temporary
 * `data-capture-focus-id`/`data-capture-focus-clickable-id` markers) plus an
 * `identityUnresolved: true` marker — never a silently omitted field — when
 * that resolution fails, mirroring `hittest.ts`'s honest per-record identity
 * shape (I-3/I-5). Whether a stop is element-bearing is decided from the
 * SAMPLE's `document.activeElement !== document.body` fact
 * (`FocusStop`/`WalkResult.hasActiveElement`), NEVER from `id`: `id` is set
 * only when `FOCUS_INIT_SCRIPT` happened to stamp a
 * `data-capture-focus-id` marker on the active element, so a real
 * native-focusable element the candidate selector does not match (e.g. a
 * `contenteditable` form outside `[contenteditable="true"]`'s exact
 * attribute form) can be tab-reached with `id === null` while still being a
 * genuine element — that stop IS element-bearing and, having no marker to
 * resolve, correctly carries `backendNodeId: null` + `identityUnresolved:
 * true`. Only a stop whose active element genuinely IS `document.body`
 * (nothing focused) carries `backendNodeId: null` WITHOUT
 * `identityUnresolved` — there is no element to have failed to resolve. So a
 * logical DOM node joins across `focus.json`/`geometry.json`/`hittest.json`
 * by `backendNodeId` wherever it resolved. The `focus-<n>`/`click-<n>` ids
 * are collector-local artifact handles, not cross-artifact keys.
 *
 * ## Scope
 * Top document, light DOM only — the traversal walks
 * `document.querySelectorAll` and does not descend into iframes or shadow
 * roots. `focus.json`'s `scope` field states this boundary as a fact
 * (including counts of the iframes/open shadow hosts NOT traversed) so a
 * downstream reader cannot mistake omission for a negative finding.
 *
 * ## Restoration
 * The true original scroll offset and "did anything have focus" fact are
 * captured FIRST, by a dedicated non-mutating read (`__captureFocusOrigin`)
 * that runs before any marker is stamped — so if the marker-stamping init
 * (`__captureFocusInit`, which tags candidates/clickable elements and the
 * original active element live in the DOM) throws partway through tagging
 * a large candidate set, the values used to build every restore call still
 * reflect the REAL page state rather than silently falling back to "no
 * focus, scroll (0,0)". The whole window — origin capture, marker
 * stamping, the traversal, and restore — runs inside a `try`/`finally`, so
 * an init that stamped markers then threw still reaches the finally
 * cleanup rather than leaking markers into the baseline `dom.html`.
 *
 * Restore is gated on two independently tracked facts, never on the
 * (possibly-empty) `origin` value alone: whether the origin read itself
 * genuinely returned a value (`originCaptured`), and whether the mutating
 * init script was ever invoked (`mutationStarted`, set immediately before
 * that call — a real browser may partially tag candidates before an init
 * throw reaches Node). A destructive focus/scroll restore (re-focusing the
 * REAL original active element via its dedicated `data-capture-focus-original`
 * marker, tagged FIRST within the init script before any candidate
 * mutation so a programmatically focused `tabindex="-1"` element the
 * candidate filter skips is still restored; blur only when the origin read
 * found no active element; and `window.scrollTo` to the origin-captured
 * coordinates) runs ONLY when `originCaptured` is true. When the origin was
 * never proven — its evaluate returned no value or threw — restore never
 * blurs real focus or scrolls to a stale (0,0) default on the strength of
 * `EMPTY_ORIGIN`: if mutation had already started, only temporary
 * `data-capture-focus-id`/`data-capture-focus-clickable-id`/`-original`
 * markers are stripped; if mutation never started either (the origin read
 * threw before the init call), restore is skipped entirely — there is
 * nothing to clean up and nothing proven to restore. The outcome is
 * recorded factually in `focus.json`'s `restoration` field
 * (`attempted`/`focusRestored`/`markersCleared`/`scrollRestored`, a
 * sanitized `error` when the window threw, and `markerCleanupFailed: true`
 * when the restore evaluate itself threw) — never as prose advice.
 */

import type { CDPClient } from '../../client.js';
import type { Collector } from '../types.js';
import { sanitizeString } from '../redaction.js';

// ============================================================================
// Injected scripts
// ============================================================================

const SHARED_HELPERS = `
  function __rectOf(el) {
    try {
      var r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    } catch (e) { return null; }
  }
  function __selectorOf(el) {
    try {
      if (!el || el.nodeType !== 1) return null;
      var tag = el.tagName.toLowerCase();
      var id = el.id ? ('#' + el.id) : '';
      var cls = (el.className && typeof el.className === 'string' && el.className.trim())
        ? ('.' + el.className.trim().split(/\\s+/).filter(Boolean).join('.'))
        : '';
      return tag + id + cls;
    } catch (e) { return null; }
  }
  function __isVisible(el) {
    try {
      if (el.offsetParent !== null) return true;
      var rects = el.getClientRects();
      return !!(rects && rects.length > 0);
    } catch (e) { return false; }
  }
`;

/**
 * Non-mutating read of the true original focus/scroll state, run BEFORE any
 * marker is stamped anywhere. This is the value every restore call in
 * {@link collectFocus} is built from — never `FOCUS_INIT_SCRIPT`'s return
 * value — so a throw partway through that script's candidate-tagging loop
 * (after it has already mutated some elements) can never cause restoration
 * to fall back to a wrong "no focus, scroll (0,0)" default: this call
 * already captured the real answer first, and it performs no mutation of
 * its own that could itself be left partially applied.
 */
const FOCUS_ORIGIN_SCRIPT = `/* __captureFocusOrigin */
(function() {
  var active = document.activeElement;
  return {
    hadOriginalFocus: !!(active && active !== document.body),
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
})();`;

const FOCUS_INIT_SCRIPT = `/* __captureFocusInit */
(function() {
  ${SHARED_HELPERS}
  // Tag the REAL current active element FIRST, before any candidate/clickable
  // mutation below — so a throw partway through those loops still leaves this
  // marker in place for restore-by-marker to re-find the exact original
  // element. (The scroll/hadOriginalFocus VALUES restore actually restores to
  // are captured separately, before this script even runs, by a dedicated
  // non-mutating origin read — this marker only needs to survive long enough
  // to support refocusing the precise element at the end of the walk.)
  var active = document.activeElement;
  if (active && active !== document.body && active.setAttribute) {
    active.setAttribute('data-capture-focus-original', '1');
  }
  var FOCUSABLE_SELECTOR = 'a[href],area[href],input:not([type="hidden"]),select,textarea,button,iframe,[tabindex],[contenteditable="true"],audio[controls],video[controls],summary';
  var all = Array.prototype.slice.call(document.querySelectorAll(FOCUSABLE_SELECTOR));
  var candidates = [];
  var nextId = 1;
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    if (el.hasAttribute('disabled')) continue;
    var tabindexAttr = el.getAttribute('tabindex');
    if (tabindexAttr !== null && parseInt(tabindexAttr, 10) < 0) continue;
    if (tabindexAttr === null && el.tabIndex < 0) continue;
    var id = 'focus-' + (nextId++);
    el.setAttribute('data-capture-focus-id', id);
    candidates.push({
      id: id,
      selector: __selectorOf(el),
      tabIndex: el.tabIndex,
      rect: __rectOf(el),
      visible: __isVisible(el),
      domIndex: i,
    });
  }
  var clickable = [];
  var clickNextId = 1;
  var shadowHosts = 0;
  var allEls = document.querySelectorAll('*');
  for (var j = 0; j < allEls.length; j++) {
    var e2 = allEls[j];
    if (e2.shadowRoot) shadowHosts++;
    if (clickable.length >= 50) continue;
    if (e2.hasAttribute('data-capture-focus-id')) continue;
    var hasOnclick = e2.hasAttribute('onclick') || typeof e2.onclick === 'function';
    var cursorPointer = false;
    var cursorReadUnavailable = false;
    try { cursorPointer = window.getComputedStyle(e2).cursor === 'pointer'; } catch (err) { cursorReadUnavailable = true; }
    // A failed cursor read must NOT be reported as "not clickable": when
    // getComputedStyle throws, cursorPointer stays false by construction, so
    // without this OR-branch an element whose only clickable evidence would
    // have been cursor:pointer is silently dropped from clickableUnfocusable
    // entirely -- indistinguishable from a genuine non-clickable element. Tag
    // and emit it instead, carrying cursorReadUnavailable: true so the
    // element's clickable status reads as unknown, not negative (I-4/I-5).
    if (hasOnclick || cursorPointer || cursorReadUnavailable) {
      var cid = 'click-' + (clickNextId++);
      e2.setAttribute('data-capture-focus-clickable-id', cid);
      clickable.push({ id: cid, selector: __selectorOf(e2), rect: __rectOf(e2), cursorReadUnavailable: cursorReadUnavailable });
    }
  }
  return {
    candidates: candidates,
    clickableUnfocusable: clickable,
    // The scan stops adding NEW candidates once the cap is reached (see
    // above), so whether more matches exist beyond it is genuinely unknown
    // without redoing the expensive computed-style check for every
    // remaining element — this is an honest "cap reached" boolean, not a
    // dropped-item count.
    clickableTruncated: clickable.length >= 50,
    iframesPresent: document.querySelectorAll('iframe').length,
    shadowHostsPresent: shadowHosts,
  };
})();`;

/** Exported for the script-unit regression that proves the sample reads no page attribute/global for identity. */
export const FOCUS_SAMPLE_SCRIPT = `/* __captureFocusSample */
(function() {
  ${SHARED_HELPERS}
  var active = document.activeElement;
  var id = (active && active.getAttribute) ? active.getAttribute('data-capture-focus-id') : null;
  // Identity for a real-but-untagged active element (id === null &&
  // hasActiveElement, e.g. a contenteditable div outside the candidate
  // selector) is NOT derived in this script. This sample must never stamp a
  // page-visible marker, assign or read a page-reachable global, or trust a
  // page-authored attribute as node identity (I-2): all three are
  // page-controlled and collide/preseed trivially. The collector resolves
  // such a node's stable backendNodeId out of band via a private CDP
  // objectId -> DOM.describeNode bridge on document.activeElement (see
  // resolveActiveElementBackendId), which the page cannot observe or forge.
  // So this read touches no attribute/global for cycle identity and leaves
  // page state exactly as found.
  var focusVisibleStyle = null;
  try {
    var computed = window.getComputedStyle(active);
    focusVisibleStyle = {
      outline: (computed.outlineStyle + ' ' + computed.outlineWidth + ' ' + computed.outlineColor),
      boxShadow: computed.boxShadow,
    };
  } catch (e) {}
  var role = (active && active.getAttribute) ? active.getAttribute('role') : null;
  var name = null;
  if (active) {
    name = active.getAttribute && (active.getAttribute('aria-label') || active.getAttribute('alt') || active.getAttribute('placeholder'));
    if (!name) {
      var text = (active.textContent || '').trim();
      name = text || null;
    }
  }
  return {
    id: id,
    selector: __selectorOf(active),
    role: role || null,
    name: name || null,
    rect: active ? __rectOf(active) : null,
    tabIndex: active ? active.tabIndex : null,
    focusVisibleStyle: focusVisibleStyle,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    isBody: active === document.body,
    // The true element-bearing fact: a real, non-body active element. NOT
    // !isBody -- document.activeElement can be null (a genuine no-active
    // sample), and null === document.body is false, so !isBody alone would
    // misclassify a null active element as element-bearing. hasActiveElement
    // is false for BOTH document.body AND null.
    hasActiveElement: !!(active && active !== document.body),
  };
})();`;

/**
 * Non-destructive marker-only cleanup, used when the true original
 * focus/scroll was never proven (the origin read returned no value or threw)
 * but the mutating init DID start tagging the page — so there ARE temporary
 * markers to strip, but no proven origin to justify a blur or a scroll to a
 * possibly-wrong `(0,0)`. Touches nothing but the `data-capture-focus-*`
 * marker attributes this collector itself stamped.
 */
/** Exported for the script-unit regression that proves cleanup preserves page-owned attributes/globals. */
export const MARKER_CLEANUP_SCRIPT = `/* __captureFocusMarkerCleanup */
(function() {
  var origMarkers = document.querySelectorAll('[data-capture-focus-original]');
  for (var m = 0; m < origMarkers.length; m++) { origMarkers[m].removeAttribute('data-capture-focus-original'); }
  var tagged = document.querySelectorAll('[data-capture-focus-id]');
  for (var i = 0; i < tagged.length; i++) { tagged[i].removeAttribute('data-capture-focus-id'); }
  var clk = document.querySelectorAll('[data-capture-focus-clickable-id]');
  for (var k = 0; k < clk.length; k++) { clk[k].removeAttribute('data-capture-focus-clickable-id'); }
  // Only markers this collector stamped are removed -- never a
  // page-authored attribute. Identity is resolved via CDP, so there is no
  // walk marker to strip and no page-owned attribute/global to disturb.
  var markersRemoved = document.querySelectorAll('[data-capture-focus-id],[data-capture-focus-clickable-id],[data-capture-focus-original]').length === 0;
  return { markersRemoved: markersRemoved };
})();`;

/** Exported for the script-unit regression that proves restore preserves page-owned attributes/globals. */
export function buildRestoreScript(hadOriginalFocus: boolean, scrollX: number, scrollY: number): string {
  return `/* __captureFocusRestore */
(function() {
  var hadOriginalFocus = ${JSON.stringify(Boolean(hadOriginalFocus))};
  var scrollX = ${JSON.stringify(scrollX)};
  var scrollY = ${JSON.stringify(scrollY)};
  var focusRestored = false;
  // Restore the REAL original active element by its stable marker (covers a
  // programmatically focused tabindex="-1" element the candidate filter
  // skipped). Blur ONLY when there genuinely was no original active element.
  var originalEl = document.querySelector('[data-capture-focus-original]');
  if (originalEl && originalEl.focus) {
    try { originalEl.focus({ preventScroll: true }); focusRestored = document.activeElement === originalEl; } catch (e) {}
  } else if (!hadOriginalFocus) {
    try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); focusRestored = true; } catch (e) {}
  }
  var origMarkers = document.querySelectorAll('[data-capture-focus-original]');
  for (var m = 0; m < origMarkers.length; m++) { origMarkers[m].removeAttribute('data-capture-focus-original'); }
  var tagged = document.querySelectorAll('[data-capture-focus-id]');
  for (var i = 0; i < tagged.length; i++) { tagged[i].removeAttribute('data-capture-focus-id'); }
  var clk = document.querySelectorAll('[data-capture-focus-clickable-id]');
  for (var k = 0; k < clk.length; k++) { clk[k].removeAttribute('data-capture-focus-clickable-id'); }
  // Only collector-stamped markers are removed; no page-authored attribute
  // (identity is CDP-resolved, so no walk marker exists to strip).
  var markersRemoved = document.querySelectorAll('[data-capture-focus-id],[data-capture-focus-clickable-id],[data-capture-focus-original]').length === 0;
  window.scrollTo(scrollX, scrollY);
  var scrollRestored = window.scrollX === scrollX && window.scrollY === scrollY;
  return { focusRestored: focusRestored, markersRemoved: markersRemoved, scrollRestored: scrollRestored };
})();`;
}

// ============================================================================
// Types
// ============================================================================

interface FocusCandidate {
  readonly id: string;
  readonly selector: string | null;
  readonly tabIndex: number;
  readonly rect: { x: number; y: number; width: number; height: number } | null;
  readonly visible: boolean;
  readonly domIndex: number;
}

interface FocusInitResult {
  readonly candidates: FocusCandidate[];
  /** `cursorReadUnavailable` is `true` when this element's `getComputedStyle(...).cursor` read threw during the clickable scan — the element was tagged and emitted anyway (I-4/I-5) precisely because a failed read must not silently omit an element whose only clickable evidence might have been `cursor:pointer`. */
  readonly clickableUnfocusable: Array<{ id: string; selector: string | null; rect: { x: number; y: number; width: number; height: number } | null; cursorReadUnavailable?: boolean }>;
  /** `true` when the 50-candidate cap on `clickableUnfocusable` was reached — the scan may not have visited every element on the page. Optional (rather than `boolean`) because this is untrusted page-returned JSON, not a TS-enforced guarantee — a malformed init result can omit it even though the in-page script always sets it (see {@link FocusReport.clickableUnfocusableTruncationUnavailable}). */
  readonly clickableTruncated?: boolean;
  readonly iframesPresent: number;
  readonly shadowHostsPresent: number;
}

/** Result of the non-mutating {@link FOCUS_ORIGIN_SCRIPT} read — the values every restore call is built from. */
interface FocusOriginResult {
  readonly hadOriginalFocus: boolean;
  readonly scrollX: number;
  readonly scrollY: number;
}

interface FocusSampleRaw {
  readonly id: string | null;
  readonly selector: string | null;
  readonly role: string | null;
  readonly name: string | null;
  readonly rect: { x: number; y: number; width: number; height: number } | null;
  readonly tabIndex: number | null;
  readonly focusVisibleStyle: { outline: string; boxShadow: string } | null;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly isBody: boolean;
  /** `true` only for a real, non-body active element (`document.activeElement && document.activeElement !== document.body`) — false for BOTH `document.body` and a `null` active element. This, not `!isBody`, is the element-bearing classifier: `document.activeElement` can genuinely be `null`, and `null === document.body` is false, so `isBody` alone cannot distinguish "nothing focused (null)" from "a real element". */
  readonly hasActiveElement: boolean;
}

interface FocusRestoreResult {
  readonly focusRestored: boolean;
  readonly markersRemoved: boolean;
  readonly scrollRestored: boolean;
}

export interface FocusStop {
  readonly step: number;
  readonly id: string | null;
  /** `null` (never an omitted key) either because this stop is not element-bearing (the sampled active element genuinely WAS `document.body` — nothing was focused) or because it IS element-bearing but identity resolution failed — see {@link identityUnresolved} to tell the two apart. Whether a stop is element-bearing is decided from `document.activeElement !== document.body` at capture time, NEVER from {@link id}: `id` reflects only whether `FOCUS_INIT_SCRIPT` stamped a marker on the active element, so a real element outside the candidate selector can be active with `id === null` and still be element-bearing. */
  readonly backendNodeId: number | null;
  /** `true` only when this stop IS element-bearing (a real element — tagged or not — was active) but the identity did not resolve: either there was no marker to resolve (untagged active element) or the marker→backendNodeId lookup failed. Absent (not `false`) when identity resolved OR when the stop is not element-bearing (`document.body`). */
  readonly identityUnresolved?: true;
  readonly selector: string | null;
  readonly role: string | null;
  readonly name: string | null;
  readonly rect: { x: number; y: number; width: number; height: number } | null;
  readonly tabIndex: number | null;
  readonly focusVisibleStyle: { outline: string; boxShadow: string } | null;
  readonly domIndex: number | null;
  readonly scrollBefore: { x: number; y: number };
  readonly scrollAfter: { x: number; y: number };
  readonly scrollJump: boolean;
}

/** Factual boundary of what `focus.json` measured — top document, light DOM only. */
export interface FocusScope {
  readonly root: 'top-document';
  readonly shadowDom: 'light-only';
  readonly iframesPresent: number;
  readonly shadowHostsPresent: number;
}

/** Factual outcome of restoring page state after the (mutating) traversal. */
export interface FocusRestoration {
  readonly attempted: boolean;
  readonly focusRestored: boolean;
  readonly markersCleared: boolean;
  readonly scrollRestored: boolean;
  readonly error?: string;
  /** `true` when the final restore/cleanup evaluate ITSELF threw — markers may remain in the (baseline) DOM. Present only on failure. */
  readonly markerCleanupFailed?: boolean;
}

/**
 * Fixed, factual reason the traversal (origin read → init → forward walk →
 * reverse walk) did not complete — never a raw exception message, which is
 * unbounded/page-influenced. Present only when {@link FocusReport.available}
 * is `false`.
 */
export type FocusUnavailableReason =
  | 'origin-read-threw'
  | 'init-unavailable'
  | 'forward-walk-threw'
  | 'reverse-walk-threw';

export interface FocusReport {
  /**
   * `false` when the origin read, the candidate/clickable init, the forward
   * walk, or the reverse walk failed to complete (a CDP throw, or an
   * evaluate that returned no value at all — see {@link evaluate}'s doc).
   * Read this FIRST: when `false`, EVERY other field below — `forward`/
   * `reverse`/their truncation flags, `domOrderDivergence`,
   * `unreachedFocusable`, `clickableUnfocusable`(Truncated), `candidateCount`,
   * `scope` — reflects only whatever this run happened to capture before the
   * failure (possibly nothing at all, or a stale/partial `init` the forward
   * walk never got to visit). None of it is a genuine "no focus order"/"no
   * candidates"/"cap not reached" observation, and must not be read as one
   * (I-4/I-5).
   */
  readonly available: boolean;
  /** Present only when `available` is `false`. */
  readonly unavailableReason?: FocusUnavailableReason;
  readonly forward: FocusStop[];
  /** `true` only when the forward walk exhausted {@link MAX_STEPS_HARD_CAP} steps without reaching a natural stop — the real forward tab order may extend beyond `forward`. Meaningless when `available` is `false` — read `available` first. */
  readonly forwardTruncated: boolean;
  readonly reverse: FocusStop[];
  /** Same meaning as {@link forwardTruncated}, for the reverse (Shift+Tab) walk. Meaningless when `available` is `false` — read `available` first. */
  readonly reverseTruncated: boolean;
  /** Every entry's `id` is non-null (see {@link FocusStop.domIndex} — only set for a matched candidate), so every entry is element-bearing: `backendNodeId` is `number | null` and `identityUnresolved` follows the same rule as {@link FocusStop}. */
  readonly domOrderDivergence: Array<{ step: number; id: string | null; backendNodeId: number | null; identityUnresolved?: true; domIndex: number; previousDomIndex: number }>;
  /** Every entry is a real tagged focusable candidate (element-bearing) — `backendNodeId` is `number | null`, `identityUnresolved: true` when the marker→backendNodeId resolution failed. */
  readonly unreachedFocusable: Array<{ id: string; backendNodeId: number | null; identityUnresolved?: true; selector: string | null; rect: { x: number; y: number; width: number; height: number } | null; visible: boolean }>;
  /** Every entry is a real clickable element the scan tagged (element-bearing) — `backendNodeId` is `number | null`, `identityUnresolved: true` when the marker→backendNodeId resolution failed. `cursorReadUnavailable: true` (present only on failure, per I-4/I-5) marks an entry whose `getComputedStyle(...).cursor` read threw during the in-page scan — its clickable status could not be confirmed by cursor alone (it may still have `hasOnclick` evidence), so it is reported as unresolved rather than silently dropped as "not clickable". */
  readonly clickableUnfocusable: Array<{ backendNodeId: number | null; identityUnresolved?: true; selector: string | null; rect: { x: number; y: number; width: number; height: number } | null; cursorReadUnavailable?: true }>;
  /** `true` when the 50-candidate cap on `clickableUnfocusable` was reached — see the module doc's Truncation facts section. Meaningless when `available` is `false` — read `available` first. */
  readonly clickableUnfocusableTruncated: boolean;
  /** `true` (Layer 2, I-4/I-5) when the init evaluate itself succeeded (`available` is `true`) but the otherwise-valid returned value was MISSING or non-boolean `clickableTruncated` — a malformed successful init, distinct from a genuinely-computed `clickableTruncated: false`. When `true`, `clickableUnfocusableTruncated` above falls back to `false`, which is not a real measurement. Absent (not `false`) on a normal run; meaningless (and never set) when {@link available} is `false`, since that failure is already reported by `available`/`unavailableReason`. */
  readonly clickableUnfocusableTruncationUnavailable?: true;
  /** Meaningless (always `0` when the init step never completed) when `available` is `false` — read `available` first. */
  readonly candidateCount: number;
  /** `iframesPresent`/`shadowHostsPresent` are meaningless (always `0`) when `available` is `false` — read `available` first. */
  readonly scope: FocusScope;
  readonly restoration: FocusRestoration;
}

// ============================================================================
// CDP driving
// ============================================================================

const MAX_STEPS_HARD_CAP = 300;

/** Returns `undefined` (rather than throwing) when the CDP response carries no value at all — a foreign/degenerate `Runtime.evaluate` response we can't act on, not a legitimate "no active element" sample (which the scripts represent with `{id: null, ...}`, a well-formed value). */
async function evaluate<T>(client: CDPClient, expression: string): Promise<T | undefined> {
  const response = (await client.send('Runtime.evaluate', { expression, returnByValue: true })) as {
    result?: { value?: T };
  };
  return response.result?.value;
}

/**
 * Resolves a `<markerAttr> → backendNodeId` map off the temporary marker
 * attributes the init script stamped, following `states.ts`'s
 * `DOM.describeNode` pattern. Best-effort: any CDP hiccup yields an empty
 * map (the join key is simply absent from those records), never a throw
 * that would abort the traversal.
 */
async function resolveMarkerBackendIds(client: CDPClient, markerAttr: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const doc = (await client.send('DOM.getDocument', { depth: -1, pierce: false })) as { root?: { nodeId?: number } };
    const rootId = doc.root?.nodeId;
    if (rootId === undefined) return map;
    const res = (await client.send('DOM.querySelectorAll', { nodeId: rootId, selector: `[${markerAttr}]` })) as { nodeIds?: number[] };
    for (const nodeId of res.nodeIds ?? []) {
      const described = (await client.send('DOM.describeNode', { nodeId })) as { node?: { backendNodeId?: number; attributes?: string[] } };
      const backendNodeId = described.node?.backendNodeId;
      const attrs = described.node?.attributes ?? [];
      if (backendNodeId === undefined) continue;
      for (let i = 0; i + 1 < attrs.length; i += 2) {
        if (attrs[i] === markerAttr) {
          map.set(attrs[i + 1], backendNodeId);
          break;
        }
      }
    }
  } catch {
    // Best-effort identity resolution — leave the map empty on any failure.
  }
  return map;
}

const EMPTY_INIT: FocusInitResult = {
  candidates: [],
  clickableUnfocusable: [],
  clickableTruncated: false,
  iframesPresent: 0,
  shadowHostsPresent: 0,
};

const EMPTY_ORIGIN: FocusOriginResult = { hadOriginalFocus: false, scrollX: 0, scrollY: 0 };

async function dispatchTab(client: CDPClient, reverse: boolean): Promise<void> {
  const modifiers = reverse ? 8 : 0; // CDP modifier bit for Shift
  const base = {
    modifiers,
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
  };
  await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

/** Builds the honest `{ backendNodeId, identityUnresolved }` pair shared by every element-bearing focus record — mirrors hittest.ts's `resolvedIdentity` (per I-3/I-5). Callers must confirm the record IS element-bearing (via `hasActiveElement`/`document.activeElement !== document.body`, NEVER via `id !== null` — see the module doc's Identity join key section) before calling this; a genuinely non-element record (the active element WAS `document.body`) must NOT use this helper — it emits `{ backendNodeId: null }` directly, with no `identityUnresolved`. */
function resolvedIdentity(backendNodeId: number | undefined): { backendNodeId: number | null; identityUnresolved?: true } {
  return backendNodeId === undefined ? { backendNodeId: null, identityUnresolved: true } : { backendNodeId };
}

function toStop(step: number, raw: FocusSampleRaw, domIndex: number | null, scrollBefore: { x: number; y: number }): FocusStop {
  const scrollAfter = { x: raw.scrollX, y: raw.scrollY };
  return {
    step,
    id: raw.id,
    // Placeholder — overwritten by `decorate()` once `focusBackendById` is
    // resolved. Present here only so this object satisfies FocusStop's
    // required (never-omitted) `backendNodeId` field.
    backendNodeId: null,
    selector: raw.selector,
    role: raw.role,
    name: raw.name,
    rect: raw.rect,
    tabIndex: raw.tabIndex,
    focusVisibleStyle: raw.focusVisibleStyle,
    domIndex,
    scrollBefore,
    scrollAfter,
    scrollJump: scrollBefore.x !== scrollAfter.x || scrollBefore.y !== scrollAfter.y,
  };
}

/** {@link walk}'s result: the recorded stops, plus whether the hard step cap cut the walk short. */
interface WalkResult {
  readonly stops: FocusStop[];
  /**
   * Parallel to {@link stops} (same index, same length) — copied directly from
   * that sample's {@link FocusSampleRaw.hasActiveElement}: `true` only for a
   * real, non-body active element, `false` when nothing was focused
   * (`document.activeElement` was `document.body` OR genuinely `null`). This
   * is the element-bearing fact `decorate()` must use for
   * {@link FocusStop.identityUnresolved} — NEVER `stop.id !== null` (that
   * reflects only whether `FOCUS_INIT_SCRIPT` stamped a marker — a real
   * untagged element has `id === null` too) and NEVER `!isBody` alone (`null
   * === document.body` is false, so `!isBody` would misclassify a genuinely
   * unfocused `null` active element as element-bearing).
   */
  readonly hasActiveElement: boolean[];
  /** `true` only when the walk exhausted {@link MAX_STEPS_HARD_CAP} steps without ever reaching a natural stop (a return to any already-visited stop — the ring wrapping back to a prior stop, or a non-advancing Tab repeating the same element; see {@link stopKey}) — the real tab order may extend further than `stops` records. */
  readonly truncated: boolean;
}

/**
 * A stable per-stop cycle-detection key that identifies the SAME focus stop
 * across a full tab ring by true per-node identity — never by geometry or
 * content, which two distinct DOM nodes can share, and NEVER by `raw.id`,
 * which is a page-authorable `data-capture-focus-id` attribute value the
 * collector reads back verbatim. Keying on `id` would let a page control
 * cycle identity: two distinct real active elements carrying the same
 * page-authored `data-capture-focus-id` (or one colliding with a collector
 * `focus-N` marker) would compare equal and the second would be dropped as a
 * false cycle. So identity for EVERY element-bearing stop comes only from the
 * collector-private CDP `backendNodeId`, never from the marker.
 *
 * - A genuinely unfocused stop (`!hasActiveElement`: `document.body` or
 *   `null`) keys on a single `body` sentinel — the ring passes through this
 *   gap once per cycle, so its second occurrence marks one full cycle. (This
 *   is what lets a forward walk whose wraparound passes through the
 *   `document.body` gap between a ring's last and first element detect
 *   completion instead of running to the {@link MAX_STEPS_HARD_CAP} cap.)
 * - Every real active element — tagged candidate or untagged focusable alike
 *   — keys on its CDP-resolved `backendNodeId` (`sampledBackendNodeId`,
 *   resolved via the private objectId -> `DOM.describeNode` bridge on
 *   `document.activeElement`, NOT any page attribute/global). This
 *   backendNodeId is a COLLECTOR-PRIVATE cycle key only — it is never emitted
 *   into `FocusStop` JSON (an untagged stop still reports `backendNodeId:
 *   null` + `identityUnresolved: true`, since it has no marker the
 *   cross-artifact identity path resolved). It is genuine,
 *   page-uncontrollable node identity: two distinct nodes that happen to
 *   share selector, rect, role, name, AND page-authored
 *   `data-capture-focus-id` get distinct backendNodeIds and are BOTH
 *   retained, and the same node revisited on the next lap resolves the same
 *   backendNodeId regardless of a scroll shift.
 *
 * Returns `null` for the rare real element whose backendNodeId could not be
 * resolved (the objectId bridge failed): identity is unknown, so {@link walk}
 * must treat it as never-a-repeat rather than collapse it against another stop.
 */
function stopKey(raw: FocusSampleRaw, sampledBackendNodeId: number | undefined): string | null {
  if (!raw.hasActiveElement) return 'body';
  if (sampledBackendNodeId !== undefined) return `backend:${sampledBackendNodeId}`;
  return null;
}

/**
 * Resolves the stable `backendNodeId` of the current `document.activeElement`
 * through a collector-private CDP bridge — evaluate `document.activeElement`
 * as a held RemoteObject (never `returnByValue`), `DOM.describeNode` off its
 * `objectId`, then release the handle. This is the ONLY identity source for a
 * real-but-untagged active element: it is invisible to the page (no marker
 * stamped, no global touched, no page-authored attribute trusted) and stable
 * across CDP calls, so a revisit of the same node resolves the same id.
 * Best-effort: any CDP hiccup yields `undefined` (identity unknown), never a
 * throw that would abort the walk.
 */
async function resolveActiveElementBackendId(client: CDPClient): Promise<number | undefined> {
  let objectId: string | undefined;
  try {
    const evalRes = (await client.send('Runtime.evaluate', {
      expression: 'document.activeElement',
      returnByValue: false,
    })) as { result?: { objectId?: string } };
    objectId = evalRes.result?.objectId;
    if (objectId === undefined) return undefined;
    const described = (await client.send('DOM.describeNode', { objectId })) as { node?: { backendNodeId?: number } };
    return described.node?.backendNodeId;
  } catch {
    return undefined;
  } finally {
    if (objectId !== undefined) {
      try {
        await client.send('Runtime.releaseObject', { objectId });
      } catch {
        // Releasing the transient handle is best-effort; a failure here does
        // not affect the resolved identity.
      }
    }
  }
}

/**
 * Drives one direction's Tab walk starting from whatever currently has
 * focus, stopping when a step returns to an already-visited stop (a full
 * cycle back to a prior stop, OR a non-advancing Tab that repeats the same
 * element) or at the hard cap. `originScroll` seeds the first step's
 * `scrollBefore` with the real pre-walk scroll offset (the non-mutating
 * {@link FOCUS_ORIGIN_SCRIPT} read, or the origin the reverse walk was just
 * restored to) — never `{x:0,y:0}`, which would report a false scroll jump
 * on step 1 of a page that was already scrolled before this collector ran.
 */
async function walk(
  client: CDPClient,
  reverse: boolean,
  candidatesById: Map<string, FocusCandidate>,
  originScroll: { x: number; y: number },
): Promise<WalkResult> {
  const stops: FocusStop[] = [];
  const hasActiveElement: boolean[] = [];
  // Every stop's cycle key (see {@link stopKey}) seen so far. The FIRST
  // repeat of any key — the ring wrapping back to a prior stop, or a
  // non-advancing Tab repeating the same element — completes the walk.
  const seen = new Set<string>();
  let scrollBefore = { x: originScroll.x, y: originScroll.y };
  // Defaults to "the cap was hit"; the natural-stop branch below flips this
  // to false right before its break, so it survives to the end of the loop
  // ONLY when all MAX_STEPS_HARD_CAP iterations ran without one.
  let truncated = true;

  for (let step = 1; step <= MAX_STEPS_HARD_CAP; step++) {
    await dispatchTab(client, reverse);
    const raw = await evaluate<FocusSampleRaw>(client, FOCUS_SAMPLE_SCRIPT);
    if (raw === undefined) {
      // Per `evaluate`'s doc, `undefined` means the CDP response carried no
      // value at all (a foreign/degenerate response) — a genuine failure,
      // NEVER a legitimate "nothing focused" sample (that's a well-formed
      // `{ hasActiveElement: false, ... }` value). Coercing this into a quiet
      // walk-complete would report a false natural stop / false truncation
      // fact; throw so the caller can mark the whole traversal unavailable
      // instead (I-5).
      throw new Error('focus sample evaluate returned no value');
    }
    const domIndex = raw.id ? (candidatesById.get(raw.id)?.domIndex ?? null) : null;
    // EVERY element-bearing active element — tagged or untagged — is
    // identified for cycle detection ONLY by its CDP-resolved backendNodeId,
    // resolved here out of band with no page-visible side effect. The
    // page-authorable marker `id` is never a cycle key (see {@link stopKey}),
    // so identity is resolved regardless of `raw.id`; only genuinely-unfocused
    // (body/null) samples skip it.
    const sampledBackendNodeId =
      raw.hasActiveElement ? await resolveActiveElementBackendId(client) : undefined;
    const stop = toStop(step, raw, domIndex, scrollBefore);
    scrollBefore = { x: raw.scrollX, y: raw.scrollY };

    const key = stopKey(raw, sampledBackendNodeId);
    if (key !== null && seen.has(key)) {
      // Returned to an already-visited stop, matched by stable identity — the
      // single `body` sentinel, or a real active element's CDP-resolved
      // backendNodeId (never the page-authorable marker `id`). The walk is complete
      // (the ring wrapped back to a prior stop, or Tab stopped advancing and
      // repeated the same element). Do NOT record the repeated wraparound
      // stop. This fires even when the repeated stop is untagged (`id ===
      // null`) — the `document.body` ring gap or an untagged focusable — so
      // the forward walk terminates after one cycle instead of running to the
      // hard cap.
      truncated = false;
      break;
    }
    // A `null` key is a real element whose backendNodeId could not be
    // resolved via the objectId bridge — identity is unknown, so it is never
    // treated as a repeat: keep walking (honest truncation at the cap if no
    // keyable stop is ever reached) rather than risk dropping a legitimate
    // distinct stop by guessing it is a cycle.
    if (key !== null) seen.add(key);

    stops.push(stop);
    // `raw.hasActiveElement` (not `raw.id`, and not `!raw.isBody` —
    // `document.activeElement` can genuinely be `null`, which is neither
    // `document.body` nor a real element) is the true element-bearing fact
    // — see {@link WalkResult.hasActiveElement}.
    hasActiveElement.push(raw.hasActiveElement);
  }

  return { stops, hasActiveElement, truncated };
}

// ============================================================================
// Collector
// ============================================================================

/** Node-side redact-then-cap of a page-controlled string; `max` overrides the default 2000 cap (redaction always runs on the full value first). */
const sanitizeOrNull = (value: string | null, max?: number): string | null =>
  value === null ? null : sanitizeString(value, max === undefined ? undefined : { max });

/** Node-side cap for a focus stop's accessible name, applied AFTER redaction so a boundary-straddling secret is redacted before capping rather than truncated mid-token. */
const MAX_FOCUS_NAME_LEN = 200;

export const collectFocus: Collector = async (ctx) => {
  const { client } = ctx;

  let origin: FocusOriginResult = EMPTY_ORIGIN;
  let init: FocusInitResult = EMPTY_INIT;
  let candidatesById = new Map<string, FocusCandidate>();
  let focusBackendById = new Map<string, number>();
  let clickableBackendById = new Map<string, number>();
  let forward: FocusStop[] = [];
  let forwardHasActiveElement: boolean[] = [];
  let forwardTruncated = false;
  let reverse: FocusStop[] = [];
  let reverseHasActiveElement: boolean[] = [];
  let reverseTruncated = false;
  let caughtError: string | undefined;
  let restoreResult: FocusRestoreResult | undefined;
  let markerCleanupFailed = false;
  // Whether the traversal (origin read → init → forward walk → reverse
  // walk) completed without an unrecoverable failure — the report-level
  // I-5 fact. `stage` tracks which step is CURRENTLY running so that if the
  // catch below fires, the attributed reason reflects where it actually
  // failed rather than a single generic label.
  let available = true;
  let stage: FocusUnavailableReason = 'origin-read-threw';
  let unavailableReason: FocusUnavailableReason | undefined;
  // Whether the non-mutating origin read genuinely returned a value (as
  // opposed to `origin` merely holding the EMPTY_ORIGIN default because that
  // read returned nothing or threw before assigning it). Restoring focus/
  // scroll from `origin` is sound ONLY when this is true — EMPTY_ORIGIN is
  // not a real fact about the page, just "we don't know".
  let originCaptured = false;
  // Whether the mutating init script was ever invoked, set immediately
  // before that call (not after) — a real browser may partially tag
  // candidates before an init throw reaches Node, so "invoked" (not
  // "returned") is what determines whether temporary markers may exist.
  let mutationStarted = false;

  try {
    // Stamp candidate/clickable/original markers, resolve the cross-artifact
    // join keys, and run both walks — ALL inside the try. The init script
    // stamps page-side markers, so if anything after it throws, the finally
    // below must still run to strip them (an init that stamped then failed
    // otherwise leaks markers into the baseline dom.html and skips restore).
    // Capture the TRUE original focus/scroll FIRST, via a non-mutating read
    // that cannot itself be left partially applied. Every restore call below
    // is built from `origin`, never from `init` — `init`'s evaluate can throw
    // AFTER it has already tagged some candidates, in which case `init` stays
    // EMPTY_INIT but the page has still been partially mutated; using `init`
    // for restore params in that case would restore to a false "no focus,
    // scroll (0,0)" default instead of the real original.
    const originRaw = await evaluate<FocusOriginResult>(client, FOCUS_ORIGIN_SCRIPT);
    if (originRaw === undefined) {
      // Per `evaluate`'s doc, `undefined` is a genuine CDP-read failure, not
      // a legitimate "nothing focused, scroll (0,0)" origin. Silently
      // proceeding with `EMPTY_ORIGIN` would let a real-but-unrecorded
      // scroll position leak into the forward walk's first `scrollBefore`
      // as a fabricated `{x:0,y:0}` fact (I-4/I-5) — throw before any
      // mutation starts so the traversal is honestly marked unavailable
      // instead (mirrors `FocusRestoration`'s already-documented handling of
      // "the origin read threw before the init call": nothing is proven,
      // nothing has been mutated yet, so there is nothing dishonest to clean
      // up either).
      throw new Error('focus origin evaluate returned no value');
    }
    origin = originRaw;
    originCaptured = true;

    // Join keys are resolved while the temporary markers are still live
    // (before any restore strips them). `mutationStarted` flips BEFORE this
    // call so a throw from inside it (after real partial tagging) is still
    // recorded as "there may be markers to clean up".
    mutationStarted = true;
    stage = 'init-unavailable';
    const initRaw = await evaluate<FocusInitResult>(client, FOCUS_INIT_SCRIPT);
    if (initRaw === undefined) {
      // Per `evaluate`'s doc, `undefined` is a genuine CDP-read failure, not
      // a legitimate empty init result. Coercing this to `EMPTY_INIT` would
      // report "0 candidates, no iframes, no shadow hosts" as an observed
      // fact about the page rather than "init never completed" (I-5) —
      // throw so the traversal is honestly marked unavailable instead.
      throw new Error('focus init evaluate returned no value');
    }
    init = initRaw;
    candidatesById = new Map(init.candidates.map((c) => [c.id, c]));
    focusBackendById = await resolveMarkerBackendIds(client, 'data-capture-focus-id');
    clickableBackendById = await resolveMarkerBackendIds(client, 'data-capture-focus-clickable-id');

    stage = 'forward-walk-threw';
    const forwardResult = await walk(client, false, candidatesById, originCaptured ? { x: origin.scrollX, y: origin.scrollY } : { x: 0, y: 0 });
    forward = forwardResult.stops;
    forwardHasActiveElement = forwardResult.hasActiveElement;
    forwardTruncated = forwardResult.truncated;

    // Refocus the original element before walking in reverse so the reverse
    // walk starts from the same place the forward walk did, independently
    // driven rather than derived by reversing `forward` in code. Re-running
    // init re-stamps the markers the mid-walk restore just cleared. Gated on
    // `originCaptured` for the same reason as the finally restore below — an
    // unproven origin must never blur real focus or scroll to (0,0).
    stage = 'reverse-walk-threw';
    // Both the mid-walk restore-or-cleanup evaluate and the re-stamp evaluate
    // below are real CDP reads through the same `evaluate()` helper as every
    // other step — a degenerate no-value response here is a genuine failure
    // too (I-5), not a legitimate "nothing to report" result: silently
    // ignoring it (the pre-fix behavior) could leave the reverse walk
    // starting from an unrestored focus/scroll state or without re-stamped
    // markers while the report still claimed `available: true`.
    const reverseSetupResult = originCaptured
      ? await evaluate<FocusRestoreResult>(client, buildRestoreScript(origin.hadOriginalFocus, origin.scrollX, origin.scrollY))
      : await evaluate<{ markersRemoved: boolean }>(client, MARKER_CLEANUP_SCRIPT);
    if (reverseSetupResult === undefined) {
      throw new Error('focus reverse-walk restore/cleanup evaluate returned no value');
    }
    const reverseReinit = await evaluate<FocusInitResult>(client, FOCUS_INIT_SCRIPT);
    if (reverseReinit === undefined) {
      throw new Error('focus reverse-walk re-init evaluate returned no value');
    }
    // When `originCaptured`, the restore just above scrolled the page back to
    // `origin` before the reverse walk begins, so that's the real pre-step-1
    // scroll. When origin was never proven, the marker-only cleanup above
    // touches no scroll, so the true pre-walk position is wherever the
    // forward walk left it (its last stop's `scrollAfter`), not a fabricated
    // (0,0).
    const reverseOriginScroll = originCaptured
      ? { x: origin.scrollX, y: origin.scrollY }
      : (forward.length > 0 ? forward[forward.length - 1].scrollAfter : { x: 0, y: 0 });
    const reverseResult = await walk(client, true, candidatesById, reverseOriginScroll);
    reverse = reverseResult.stops;
    reverseHasActiveElement = reverseResult.hasActiveElement;
    reverseTruncated = reverseResult.truncated;
  } catch (err) {
    caughtError = sanitizeString(err instanceof Error ? err.message : String(err));
    available = false;
    unavailableReason = stage;
  } finally {
    // Restoration is gated on two independently tracked facts, never on the
    // (possibly-empty) `origin` value alone:
    //  - `originCaptured`: the true focus/scroll IS proven, so a full
    //    destructive restore (refocus-or-blur + scrollTo) is sound.
    //  - `mutationStarted` (and NOT originCaptured): nothing is proven about
    //    the original state, but the init call was invoked and may have
    //    already tagged real candidates — strip those markers WITHOUT
    //    touching focus or scroll.
    //  - neither: the origin read threw before mutation ever began — there
    //    is nothing to clean up and nothing proven to restore, so restore is
    //    skipped entirely.
    // If the restore/cleanup evaluate ITSELF throws, markers may remain in
    // the (baseline) DOM — record that as a fact rather than swallowing it.
    if (originCaptured) {
      try {
        restoreResult = await evaluate<FocusRestoreResult>(client, buildRestoreScript(origin.hadOriginalFocus, origin.scrollX, origin.scrollY));
      } catch {
        markerCleanupFailed = true;
      }
    } else if (mutationStarted) {
      try {
        const cleanup = await evaluate<{ markersRemoved: boolean }>(client, MARKER_CLEANUP_SCRIPT);
        restoreResult = { focusRestored: false, markersRemoved: cleanup?.markersRemoved ?? false, scrollRestored: false };
      } catch {
        markerCleanupFailed = true;
      }
    }
  }

  // The element-bearing fact is `hasActiveElement[i]`, copied straight from
  // the page-side sample's own `hasActiveElement` (a genuine
  // `document.activeElement && document.activeElement !== document.body`).
  // NEVER `s.id !== null` (id reflects only whether `FOCUS_INIT_SCRIPT`
  // stamped a marker) and NEVER `!raw.isBody` (document.activeElement can be
  // genuinely `null`, and `null === document.body` is false, so `!isBody`
  // alone would misclassify a no-active sample as element-bearing).
  // `hasActiveElement[i] === false` means the sampled active element
  // genuinely was `document.body` OR `null` (nothing focused): it emits
  // `backendNodeId: null` with no `identityUnresolved`, since there is no
  // element whose identity could have failed to resolve. A real
  // native-focusable element outside the candidate selector (e.g. a
  // `contenteditable` form not matched by `[contenteditable="true"]`'s exact
  // attribute form) can be tab-reached with `id === null` while still being a
  // genuine element — `hasActiveElement[i]` is `true` there, so
  // `resolvedIdentity` correctly emits `backendNodeId: null` +
  // `identityUnresolved: true` (no marker to resolve). When the stop IS
  // element-bearing, `resolvedIdentity` emits `backendNodeId: null` +
  // `identityUnresolved: true` whenever there is no marker to resolve OR the
  // marker→backendNodeId lookup came back empty (per I-3/I-5, never silently
  // omitted) — `s.id !== null ? focusBackendById.get(s.id) : undefined`
  // naturally yields `undefined` (unresolved) for an untagged element. The
  // objectId-bridge backendNodeId `walk` resolves is a collector-private cycle
  // key only and is deliberately NOT threaded here: the emitted FocusStop
  // identity contract is unchanged — an untagged stop reports `backendNodeId:
  // null` + `identityUnresolved: true` (no marker the cross-artifact join
  // resolved), never a value derived from a per-sample handle.
  const decorate = (stops: FocusStop[], hasActiveElement: boolean[]): FocusStop[] =>
    stops.map((s, i) => ({
      ...s,
      selector: sanitizeOrNull(s.selector),
      role: sanitizeOrNull(s.role),
      name: sanitizeOrNull(s.name, MAX_FOCUS_NAME_LEN),
      ...(hasActiveElement[i] ? resolvedIdentity(s.id !== null ? focusBackendById.get(s.id) : undefined) : { backendNodeId: null }),
    }));

  forward = decorate(forward, forwardHasActiveElement);
  reverse = decorate(reverse, reverseHasActiveElement);

  // `forward` is already decorated (see `decorate` above) with the honest
  // `backendNodeId`/`identityUnresolved` pair resolved off this collector's
  // marker/`DOM.describeNode` bridge, so each divergence entry carries the
  // same stable join key (and the same identity-failure marker) its stop
  // does — a downstream reader can join a divergence entry to `geometry.json`'s
  // record for the same DOM node. Every divergence entry's stop has a
  // non-null `domIndex`, which only a non-null `id` (a real tagged
  // candidate) can produce, so every entry here is element-bearing.
  const domOrderDivergence: FocusReport['domOrderDivergence'] = [];
  let previousDomIndex: number | null = null;
  for (const stop of forward) {
    if (stop.domIndex !== null && previousDomIndex !== null && stop.domIndex < previousDomIndex) {
      domOrderDivergence.push({
        step: stop.step,
        id: stop.id,
        backendNodeId: stop.backendNodeId,
        ...(stop.identityUnresolved ? { identityUnresolved: true as const } : {}),
        domIndex: stop.domIndex,
        previousDomIndex,
      });
    }
    if (stop.domIndex !== null) previousDomIndex = stop.domIndex;
  }

  const visitedIds = new Set(forward.map((s) => s.id).filter((id): id is string => id !== null));
  // Every `init.candidates` entry is a real element the init script tagged
  // (element-bearing) — `resolvedIdentity` is always the right call, never
  // the non-element `{ backendNodeId: null }` branch.
  const unreachedFocusable = init.candidates
    .filter((c) => !visitedIds.has(c.id))
    .map((c) => ({ id: c.id, ...resolvedIdentity(focusBackendById.get(c.id)), selector: sanitizeOrNull(c.selector), rect: c.rect, visible: c.visible }));

  // Every `init.clickableUnfocusable` entry is a real element the init
  // script tagged (element-bearing) — same reasoning as `unreachedFocusable`.
  const clickableUnfocusable = init.clickableUnfocusable.map((cl) => ({
    ...resolvedIdentity(clickableBackendById.get(cl.id)),
    selector: sanitizeOrNull(cl.selector),
    rect: cl.rect,
    ...(cl.cursorReadUnavailable ? { cursorReadUnavailable: true as const } : {}),
  }));

  // I-4/I-5 (Layer 2): `init` here is the value the init evaluate ITSELF
  // returned (a well-formed value, per the `available`/`unavailableReason`
  // gate above) -- so a MISSING or non-boolean `clickableTruncated` on it is
  // a malformed successful response, not a genuine "cap not reached"
  // observation. Gated on `available` for the same reason as scroll.ts's
  // `scrollContainersCountUnavailable`: when the traversal itself failed,
  // `init` is left at `EMPTY_INIT` and `clickableTruncated` is "missing" by
  // construction -- that failure is already fully reported via
  // `available`/`unavailableReason`, so flagging this on top of it would be
  // redundant noise, not a new fact.
  const clickableUnfocusableTruncationUnavailable = available && typeof init.clickableTruncated !== 'boolean';

  const report: FocusReport = {
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
    forward,
    forwardTruncated,
    reverse,
    reverseTruncated,
    domOrderDivergence,
    unreachedFocusable,
    clickableUnfocusable,
    clickableUnfocusableTruncated: init.clickableTruncated ?? false,
    ...(clickableUnfocusableTruncationUnavailable ? { clickableUnfocusableTruncationUnavailable: true as const } : {}),
    candidateCount: init.candidates.length,
    scope: {
      root: 'top-document',
      shadowDom: 'light-only',
      iframesPresent: init.iframesPresent,
      shadowHostsPresent: init.shadowHostsPresent,
    },
    restoration: {
      attempted: originCaptured || mutationStarted,
      focusRestored: restoreResult?.focusRestored ?? false,
      markersCleared: restoreResult?.markersRemoved ?? false,
      scrollRestored: restoreResult?.scrollRestored ?? false,
      ...(caughtError ? { error: caughtError } : {}),
      ...(markerCleanupFailed ? { markerCleanupFailed: true } : {}),
    },
  };

  ctx.write.json('focus.json', report);
};
