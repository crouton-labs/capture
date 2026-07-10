/**
 * `scroll.json` collector — the scroll-container topology sampled during
 * capture: each container's rect, extents, current/max offsets, overflow
 * styles, scrollbar-gutter, snap points, sticky/fixed descendants, which
 * children become visible at sampled offsets, nested-scroll ancestry, and
 * visual-vs-layout viewport.
 *
 * ## Identity join key
 * Every container/sticky/snap/visible-child record carries a
 * `backendNodeId` (resolved via `DOM.describeNode` off the temporary
 * `data-capture-scroll-id` markers the topology script stamps) wherever CDP
 * can resolve one, so a logical DOM node joins across
 * `scroll.json`/`geometry.json`/`hittest.json` by that stable id.
 *
 * ## Scope
 * Top document, light DOM only — the walk uses `document.querySelectorAll`
 * and does not descend into iframes or shadow roots. `scroll.json`'s
 * `scope` field states this boundary as a fact (with counts of the
 * iframes/open shadow hosts NOT traversed) so downstream cannot read
 * omission as a negative finding.
 *
 * ## Restoration
 * Every temporary `scrollTop`/`scrollLeft` write is restored inside an
 * in-page `try`/`finally` before the topology script returns (so a throw
 * mid-sampling can't leave a container scrolled), and the temporary
 * `data-capture-scroll-id` markers are stripped node-side afterward. Both
 * outcomes are recorded factually in `scroll.json`'s `restoration` field
 * (`offsetsRestored`/`markersCleared`) — never as prose advice.
 *
 * ## Truncation facts
 * Four caps bound this collector's page walk, each surfaced as an explicit
 * fact rather than a silently short array. The scroll-container scan (cap
 * 60) counts every real match regardless of the cap — cheap, since it
 * already visits every element to count shadow hosts — so `ScrollReport`
 * carries an exact `scrollContainersTotal`/`scrollContainersTruncated` pair
 * at its top level, deliberately NOT nested inside `scope` (whose own exact
 * 4-key shape — `root`/`shadowDom`/`iframesPresent`/`shadowHostsPresent` —
 * is asserted verbatim by shared restoration tests). The
 * per-container sticky/fixed-descendant and snap-descendant scans (cap 30
 * each) and the per-sample visible-children scan (cap 30) stop enumerating
 * the instant they hit their cap, so an exact total would require redoing
 * the expensive part (a `getComputedStyle`/`getBoundingClientRect` call per
 * remaining descendant) the cap exists to avoid — those three instead carry
 * an honest `*Truncated` boolean (the cap was reached; more may exist)
 * alongside their array, on the same record the array itself lives on.
 */

import type { CDPClient } from '../../client.js';
import type { Collector } from '../types.js';
import { sanitizeString } from '../redaction.js';

// ============================================================================
// Injected script — one round trip: discover containers, sample reachable
// content at bracketed offsets, then restore every container's original
// scroll position before returning (offset writes are wrapped in an in-page
// try/finally so a throw mid-sampling still restores). Temporary
// `data-capture-scroll-id` markers are stamped here and cleaned up
// node-side after the identity join is resolved.
// ============================================================================

const SCROLL_TOPOLOGY_SCRIPT = `/* __captureScrollTopology */
(function() {
  var scrollNextId = 1;
  function tagId(el) {
    try {
      if (!el || el.nodeType !== 1) return null;
      var existing = el.getAttribute('data-capture-scroll-id');
      if (existing) return existing;
      var id = 'scroll-' + (scrollNextId++);
      el.setAttribute('data-capture-scroll-id', id);
      return id;
    } catch (e) { return null; }
  }
  function selectorOf(el) {
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
  function rectOf(el) {
    try {
      var r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    } catch (e) { return null; }
  }
  function isScrollContainer(el) {
    try {
      return (el.scrollHeight - el.clientHeight > 1) || (el.scrollWidth - el.clientWidth > 1);
    } catch (e) { return false; }
  }
  function stickyOrFixedDescendants(el) {
    var out = [];
    var kids = el.querySelectorAll('*');
    var i;
    for (i = 0; i < kids.length && out.length < 30; i++) {
      var cs;
      try { cs = window.getComputedStyle(kids[i]); } catch (e) { continue; }
      if (cs.position === 'sticky' || cs.position === 'fixed') {
        out.push({ scrollId: tagId(kids[i]), selector: selectorOf(kids[i]), position: cs.position, rect: rectOf(kids[i]) });
      }
    }
    // The scan stops the instant the cap is hit, so i < kids.length means
    // real descendants past this point were never even checked.
    return { items: out, truncated: i < kids.length };
  }
  function snapDescendants(el) {
    var out = [];
    var kids = el.querySelectorAll('*');
    var i;
    for (i = 0; i < kids.length && out.length < 30; i++) {
      var cs;
      try { cs = window.getComputedStyle(kids[i]); } catch (e) { continue; }
      if (cs.scrollSnapAlign && cs.scrollSnapAlign !== 'none') {
        out.push({ scrollId: tagId(kids[i]), selector: selectorOf(kids[i]), scrollSnapAlign: cs.scrollSnapAlign });
      }
    }
    return { items: out, truncated: i < kids.length };
  }
  function visibleChildren(el) {
    var band = el.getBoundingClientRect();
    var out = [];
    var kids = el.children;
    var i;
    for (i = 0; i < kids.length && out.length < 30; i++) {
      var r = kids[i].getBoundingClientRect();
      var intersects = r.bottom > band.top && r.top < band.bottom && r.right > band.left && r.left < band.right;
      if (intersects) out.push({ scrollId: tagId(kids[i]), selector: selectorOf(kids[i]), rect: rectOf(kids[i]) });
    }
    return { items: out, truncated: i < kids.length };
  }

  var root = document.scrollingElement || document.documentElement;
  var found = [root];
  var all = document.querySelectorAll('*');
  var shadowHosts = 0;
  // root is unconditionally EMITTED into found/containers below regardless
  // of whether it genuinely scrolls (it always carries useful rect/overflow
  // facts for the top-level viewport) -- but the total this fact claims must
  // count root as a genuine scroll container ONLY when it actually is one
  // (isScrollContainer(root)), exactly like every other candidate below.
  // rootMatches mirrors what the loop's own isScrollContainer check would
  // have found for root had it not been excluded from the loop by the
  // all[i] !== root guard.
  var rootMatches = isScrollContainer(root) ? 1 : 0;
  // Counted regardless of the 60-container cap — this loop already visits
  // every element to count shadow hosts, so an exact total costs nothing
  // extra (unlike the per-container descendant scans below).
  var nonRootMatches = 0;
  for (var i = 0; i < all.length; i++) {
    if (all[i].shadowRoot) shadowHosts++;
    if (all[i] !== root && isScrollContainer(all[i])) {
      nonRootMatches++;
      if (found.length < 60) found.push(all[i]);
    }
  }
  var scrollContainerMatches = rootMatches + nonRootMatches;

  // Snapshot every container's original offset up front so restoration in
  // the finally is complete even if sampling throws midway through.
  var originalOffsets = [];
  for (var o = 0; o < found.length; o++) {
    originalOffsets.push({ el: found[o], top: found[o].scrollTop, left: found[o].scrollLeft });
  }

  var containers = [];
  var offsetsRestored = true;
  var scriptError = null;
  try {
    for (var c = 0; c < found.length; c++) {
      var el = found[c];
      var isRoot = el === root;
      var cs = window.getComputedStyle(el);
      var maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
      var maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
      var originalTop = el.scrollTop;
      var originalLeft = el.scrollLeft;

      var samples = [];
      var offsetsToSample = [];
      var seen = {};
      [originalTop, 0, maxTop].forEach(function(v) { if (!(v in seen)) { seen[v] = true; offsetsToSample.push(v); } });
      for (var s = 0; s < offsetsToSample.length; s++) {
        var top = offsetsToSample[s];
        el.scrollTop = top;
        var vc = isRoot ? { items: [], truncated: false } : visibleChildren(el);
        samples.push({ offsetTop: top, visibleChildren: vc.items, visibleChildrenTruncated: vc.truncated });
      }
      el.scrollTop = originalTop;
      el.scrollLeft = originalLeft;

      var snapResult = isRoot ? { items: [], truncated: false } : snapDescendants(el);
      var stickyResult = stickyOrFixedDescendants(el);

      containers.push({
        scrollId: tagId(el),
        selector: isRoot ? '(document)' : selectorOf(el),
        isRoot: isRoot,
        rect: isRoot ? { x: 0, y: 0, width: document.documentElement.clientWidth, height: document.documentElement.clientHeight } : rectOf(el),
        scrollWidth: el.scrollWidth,
        scrollHeight: el.scrollHeight,
        clientWidth: el.clientWidth,
        clientHeight: el.clientHeight,
        scrollTop: originalTop,
        scrollLeft: originalLeft,
        maxScrollTop: maxTop,
        maxScrollLeft: maxLeft,
        overflowX: cs.overflowX,
        overflowY: cs.overflowY,
        scrollbarGutter: cs.scrollbarGutter || null,
        scrollSnapType: cs.scrollSnapType || null,
        snapDescendants: snapResult.items,
        snapDescendantsTruncated: snapResult.truncated,
        stickyFixedDescendants: stickyResult.items,
        stickyFixedDescendantsTruncated: stickyResult.truncated,
        samples: samples,
      });
    }

    // Nested-scroll ancestry: for each non-root container, which OTHER
    // container selectors are its DOM ancestors (nearest first).
    for (var n = 0; n < found.length; n++) {
      if (found[n] === root) continue;
      var chain = [];
      var walker = found[n].parentElement;
      while (walker) {
        for (var k = 0; k < found.length; k++) {
          if (found[k] === walker) { chain.push(containers[k].selector); break; }
        }
        walker = walker.parentElement;
      }
      chain.push(containers[0].selector);
      containers[n].nestedAncestry = chain;
    }
    if (containers.length > 0) containers[0].nestedAncestry = [];
  } catch (e) {
    scriptError = String((e && e.message) || e);
  } finally {
    // Restore every sampled container's original scroll position.
    for (var r2 = 0; r2 < originalOffsets.length; r2++) {
      try {
        originalOffsets[r2].el.scrollTop = originalOffsets[r2].top;
        originalOffsets[r2].el.scrollLeft = originalOffsets[r2].left;
        if (originalOffsets[r2].el.scrollTop !== originalOffsets[r2].top || originalOffsets[r2].el.scrollLeft !== originalOffsets[r2].left) {
          offsetsRestored = false;
        }
      } catch (e2) { offsetsRestored = false; }
    }
  }

  return {
    containers: containers,
    documentScrollHeight: document.documentElement.scrollHeight,
    documentScrollWidth: document.documentElement.scrollWidth,
    offsetsRestored: offsetsRestored,
    iframesPresent: document.querySelectorAll('iframe').length,
    shadowHostsPresent: shadowHosts,
    // scrollContainerMatches already folds rootMatches in (see above), so a
    // page whose ONLY scroll container is the root itself (no other div
    // scrolls) now reports scrollContainersTotal === 1, matching the single
    // emitted root container, instead of the pre-fix 0 (root was always
    // emitted but never counted toward the total). Truncation still compares
    // only the non-root portion against the non-root cap -- root is never
    // subject to the 60-container cap (it is pushed into found before the
    // cap check even runs), so it must not participate in that comparison.
    scrollContainersTotal: scrollContainerMatches,
    scrollContainersTruncated: nonRootMatches > (found.length - 1),
    scriptError: scriptError,
  };
})();`;

/** Strips every temporary `data-capture-scroll-id` marker and reports whether the DOM was left clean. Run node-side AFTER the identity join is resolved. */
const SCROLL_CLEANUP_SCRIPT = `/* __captureScrollCleanup */
(function() {
  var m = document.querySelectorAll('[data-capture-scroll-id]');
  for (var i = 0; i < m.length; i++) { m[i].removeAttribute('data-capture-scroll-id'); }
  return { cleared: document.querySelectorAll('[data-capture-scroll-id]').length === 0 };
})();`;

// ============================================================================
// Types
// ============================================================================

type RectVal = { x: number; y: number; width: number; height: number } | null;

interface ScrollSampleRaw {
  readonly offsetTop: number;
  readonly visibleChildren: Array<{ scrollId?: string | null; selector: string | null; rect: RectVal }>;
  /** `true` when the 30-child cap on `visibleChildren` stopped the scan before it checked every child — more may intersect the sampled band but were never tested. */
  readonly visibleChildrenTruncated: boolean;
}

interface ScrollContainerRaw {
  readonly scrollId?: string | null;
  readonly selector: string | null;
  readonly isRoot: boolean;
  readonly rect: RectVal;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly maxScrollTop: number;
  readonly maxScrollLeft: number;
  readonly overflowX: string;
  readonly overflowY: string;
  readonly scrollbarGutter: string | null;
  readonly scrollSnapType: string | null;
  readonly snapDescendants: Array<{ scrollId?: string | null; selector: string | null; scrollSnapAlign: string }>;
  /** `true` when the 30-descendant cap stopped the snap-descendant scan before it visited every descendant. */
  readonly snapDescendantsTruncated: boolean;
  readonly stickyFixedDescendants: Array<{ scrollId?: string | null; selector: string | null; position: string; rect: RectVal }>;
  /** `true` when the 30-descendant cap stopped the sticky/fixed scan before it visited every descendant. */
  readonly stickyFixedDescendantsTruncated: boolean;
  readonly samples: ScrollSampleRaw[];
  readonly nestedAncestry?: string[];
}

interface ScrollTopologyRaw {
  readonly containers: ScrollContainerRaw[];
  readonly documentScrollHeight: number;
  readonly documentScrollWidth: number;
  readonly offsetsRestored?: boolean;
  readonly iframesPresent?: number;
  readonly shadowHostsPresent?: number;
  /** Exact count of real scroll containers found on the page, regardless of the 60-container cap on `containers` (cheap to compute — see the module doc). */
  readonly scrollContainersTotal?: number;
  /** `true` when `scrollContainersTotal` exceeds `containers.length` — real containers exist beyond the cap. */
  readonly scrollContainersTruncated?: boolean;
  readonly scriptError?: string | null;
}

// ----- output (sanitized, identity-joined) shapes -----

export interface ScrollContainerOut {
  /** `null` (never an omitted key) when this record's identity did not resolve — see {@link identityUnresolved}. Mirrors hittest.ts's per-record identity shape (I-3). */
  readonly backendNodeId: number | null;
  /** `true` when {@link backendNodeId} is `null` because marker→backendNodeId resolution failed. Absent (not `false`) when identity resolved. */
  readonly identityUnresolved?: true;
  readonly selector: string | null;
  readonly isRoot: boolean;
  readonly rect: RectVal;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollTop: number;
  readonly scrollLeft: number;
  readonly maxScrollTop: number;
  readonly maxScrollLeft: number;
  readonly overflowX: string;
  readonly overflowY: string;
  readonly scrollbarGutter: string | null;
  readonly scrollSnapType: string | null;
  readonly snapDescendants: Array<{ backendNodeId: number | null; identityUnresolved?: true; selector: string | null; scrollSnapAlign: string }>;
  readonly snapDescendantsTruncated: boolean;
  readonly stickyFixedDescendants: Array<{ backendNodeId: number | null; identityUnresolved?: true; selector: string | null; position: string; rect: RectVal }>;
  readonly stickyFixedDescendantsTruncated: boolean;
  readonly samples: Array<{ offsetTop: number; visibleChildren: Array<{ backendNodeId: number | null; identityUnresolved?: true; selector: string | null; rect: RectVal }>; visibleChildrenTruncated: boolean }>;
  readonly nestedAncestry: string[];
  /** `true` (Layer 2, I-4/I-5) when this record's `nestedAncestry` field was MISSING from an otherwise-present container in the topology's return value — e.g. a script throw mid-way through the in-page nested-ancestry loop (after `containers` was already fully populated but before every entry's `nestedAncestry` was assigned; `scriptError`/`restoration.error` carries the in-page exception text for that same failure). `nestedAncestry` above then falls back to `[]`, which is NOT a genuine "no nested scrollable ancestors" observation. Absent on a normal run. */
  readonly nestedAncestryUnavailable?: true;
}

/** Unchanged 4-key shape (asserted verbatim by shared restoration tests) — the scroll-container cap fact lives on {@link ScrollReport} instead, not here. */
export interface ScrollScope {
  readonly root: 'top-document';
  readonly shadowDom: 'light-only';
  readonly iframesPresent: number;
  readonly shadowHostsPresent: number;
}

export interface ScrollRestoration {
  readonly attempted: boolean;
  readonly offsetsRestored: boolean;
  readonly markersCleared: boolean;
  readonly error?: string;
}

/** Fixed, factual reason the topology `Runtime.evaluate` itself could not be read (never a raw exception message, which is unbounded/page-influenced) — present only when {@link ScrollReport.available} is `false`. Mirrors hittest.ts's `HittestUnavailableReason` discipline. */
export type ScrollUnavailableReason = 'topology-evaluate-threw' | 'topology-evaluate-returned-no-value';

export interface ScrollReport {
  readonly containers: ScrollContainerOut[];
  /** Exact count of real scroll containers found on the page (see the module doc's Truncation facts section), counting the root ONLY when it genuinely scrolls (same `isScrollContainer` test as every other candidate) — root is unconditionally present in `containers` regardless, so `containers.length` can exceed this by exactly one on a page whose root does not itself scroll; `>` only when the 60-container cap dropped real (non-root) containers beyond it. */
  readonly scrollContainersTotal: number;
  /** `true` when real scroll containers exist beyond the 60-container cap. */
  readonly scrollContainersTruncated: boolean;
  /** `true` (Layer 2, I-4/I-5) when the topology evaluate itself succeeded (a value came back) but that otherwise-valid value was MISSING `scrollContainersTotal`/`scrollContainersTruncated` — a malformed successful topology, distinct from a genuinely-computed `scrollContainersTotal: 0`/`scrollContainersTruncated: false`. When `true`, `scrollContainersTotal` above falls back to `containers.length` and `scrollContainersTruncated` falls back to a same-length comparison — neither is a real measurement. Absent (not `false`) on a normal run; meaningless (and never set) when {@link available} is `false`, since that failure is already reported by `available`/`reason`. */
  readonly scrollContainersCountUnavailable?: true;
  readonly documentScrollHeight: number;
  readonly documentScrollWidth: number;
  readonly visualViewport: unknown;
  /** `true` (Layer 2, I-4/I-5) when `Page.getLayoutMetrics` returned neither `cssVisualViewport` nor `visualViewport` — {@link visualViewport} is then `null` because the read failed, not because the browser genuinely reported an empty viewport. Absent on a normal run. */
  readonly visualViewportUnavailable?: true;
  readonly layoutViewport: unknown;
  /** Same meaning as {@link visualViewportUnavailable}, for {@link layoutViewport} (`cssLayoutViewport`/`layoutViewport`). */
  readonly layoutViewportUnavailable?: true;
  readonly scope: ScrollScope;
  /** `true` (Layer 2, I-4/I-5) when the topology evaluate itself succeeded but the otherwise-valid value was MISSING `iframesPresent`/`shadowHostsPresent` — the counts surfaced on {@link scope} then fall back to `0`, a malformed successful topology rather than a genuine "no iframes/shadow hosts" observation. Kept off `scope` itself (rather than nested inside it) so `scope`'s 4-key shape stays exactly what the shared restoration tests assert — same reasoning as `scrollContainersTotal`/`scrollContainersTruncated` living on `ScrollReport` instead of `scope` (see the module doc's Truncation facts section). Absent on a normal run. */
  readonly scopeCountsUnavailable?: true;
  readonly restoration: ScrollRestoration;
  /** `false` when the topology `Runtime.evaluate` itself failed (threw, or resolved with no `value`) — `containers: []` with `scrollContainersTotal: 0` is then "could not collect", not "genuinely no scroll containers" (I-4/I-5). Always `true` on a normal run, including one where the page really has no scroll containers other than a non-scrolling root. */
  readonly available: boolean;
  /** Present only when `available` is `false`. */
  readonly reason?: ScrollUnavailableReason;
}

// ============================================================================
// Node-side identity join + sanitization
// ============================================================================

const sanitizeOrNull = (value: string | null): string | null => (value === null ? null : sanitizeString(value));
const backendOf = (scrollId: string | null | undefined, backendById: Map<string, number>): number | undefined =>
  scrollId ? backendById.get(scrollId) : undefined;

/** `null` (never omitted) when the marker→backendNodeId join failed for this element-bearing record — see {@link ScrollContainerOut.identityUnresolved}. Mirrors hittest.ts's `resolvedIdentity` (I-3). */
function resolvedIdentity(backendNodeId: number | undefined): { backendNodeId: number | null; identityUnresolved?: true } {
  return backendNodeId === undefined ? { backendNodeId: null, identityUnresolved: true } : { backendNodeId };
}

function toContainerOut(c: ScrollContainerRaw, backendById: Map<string, number>): ScrollContainerOut {
  return {
    ...resolvedIdentity(backendOf(c.scrollId, backendById)),
    selector: sanitizeOrNull(c.selector),
    isRoot: c.isRoot,
    rect: c.rect,
    scrollWidth: c.scrollWidth,
    scrollHeight: c.scrollHeight,
    clientWidth: c.clientWidth,
    clientHeight: c.clientHeight,
    scrollTop: c.scrollTop,
    scrollLeft: c.scrollLeft,
    maxScrollTop: c.maxScrollTop,
    maxScrollLeft: c.maxScrollLeft,
    overflowX: c.overflowX,
    overflowY: c.overflowY,
    scrollbarGutter: c.scrollbarGutter,
    scrollSnapType: c.scrollSnapType,
    snapDescendants: c.snapDescendants.map((d) => ({ ...resolvedIdentity(backendOf(d.scrollId, backendById)), selector: sanitizeOrNull(d.selector), scrollSnapAlign: d.scrollSnapAlign })),
    snapDescendantsTruncated: c.snapDescendantsTruncated,
    stickyFixedDescendants: c.stickyFixedDescendants.map((d) => ({ ...resolvedIdentity(backendOf(d.scrollId, backendById)), selector: sanitizeOrNull(d.selector), position: d.position, rect: d.rect })),
    stickyFixedDescendantsTruncated: c.stickyFixedDescendantsTruncated,
    samples: c.samples.map((s) => ({ offsetTop: s.offsetTop, visibleChildren: s.visibleChildren.map((v) => ({ ...resolvedIdentity(backendOf(v.scrollId, backendById)), selector: sanitizeOrNull(v.selector), rect: v.rect })), visibleChildrenTruncated: s.visibleChildrenTruncated })),
    nestedAncestry: (c.nestedAncestry ?? []).map((sel) => sanitizeString(sel)),
    ...(c.nestedAncestry === undefined ? { nestedAncestryUnavailable: true as const } : {}),
  };
}

/**
 * Resolves a `data-capture-scroll-id → backendNodeId` map off the temporary
 * markers the topology script stamped, following `states.ts`'s
 * `DOM.describeNode` pattern. Best-effort: any CDP hiccup yields an empty
 * map, never a throw.
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

// ============================================================================
// Collector
// ============================================================================

export const collectScroll: Collector = async (ctx) => {
  const { client } = ctx;

  let topology: ScrollTopologyRaw = { containers: [], documentScrollHeight: 0, documentScrollWidth: 0 };
  // I-4/I-5: distinguishes "the topology evaluate itself failed" from "the
  // page really has zero scroll containers" — both would otherwise collapse
  // to the same empty containers/scrollContainersTotal:0, falsely claiming a
  // genuinely-measured-empty page when in fact the topology was never read.
  let available = true;
  let reason: ScrollUnavailableReason | undefined;
  try {
    const evalResponse = (await client.send('Runtime.evaluate', {
      expression: SCROLL_TOPOLOGY_SCRIPT,
      returnByValue: true,
    })) as { result?: { value?: ScrollTopologyRaw } };
    if (evalResponse.result?.value !== undefined) {
      topology = evalResponse.result.value;
    } else {
      available = false;
      reason = 'topology-evaluate-returned-no-value';
    }
  } catch {
    // Topology eval failed outright — fall through with the empty topology
    // (marker cleanup below still runs to leave the DOM clean), but the
    // failure itself must be reported, never silently coerced to success.
    available = false;
    reason = 'topology-evaluate-threw';
  }

  // Resolve the cross-artifact join keys, then strip the temporary markers.
  const backendById = await resolveMarkerBackendIds(client, 'data-capture-scroll-id');
  let markersCleared = false;
  try {
    const cleanup = (await client.send('Runtime.evaluate', {
      expression: SCROLL_CLEANUP_SCRIPT,
      returnByValue: true,
    })) as { result?: { value?: { cleared?: boolean } } };
    markersCleared = cleanup.result?.value?.cleared ?? false;
  } catch {
    markersCleared = false;
  }

  const metrics = (await client.send('Page.getLayoutMetrics')) as {
    visualViewport?: unknown;
    layoutViewport?: unknown;
    cssVisualViewport?: unknown;
    cssLayoutViewport?: unknown;
  };

  const containersOut = topology.containers.map((c) => toContainerOut(c, backendById));

  // I-4/I-5 (Layer 2): `topology` here is the value the topology evaluate
  // ITSELF returned (a well-formed value, per the `available`/`reason` gate
  // above) -- so a MISSING named field on it (as opposed to `available`
  // being false) is a malformed successful response, not a genuine "zero"
  // observation. `available` gates whether these malformed markers are even
  // meaningful to compute: when the topology evaluate itself failed,
  // `topology` is left at its `{ containers: [], documentScrollHeight: 0,
  // documentScrollWidth: 0 }` default and every optional field is "missing"
  // by construction -- that failure is already fully reported via
  // `available`/`reason`, so flagging every field malformed on top of it
  // would be redundant noise, not a new fact.
  const scrollContainersCountUnavailable = available && (topology.scrollContainersTotal === undefined || topology.scrollContainersTruncated === undefined);
  const scrollContainersTotal = topology.scrollContainersTotal ?? containersOut.length;
  const scrollContainersTruncated = topology.scrollContainersTruncated ?? scrollContainersTotal > containersOut.length;
  const scopeCountsUnavailable = available && (topology.iframesPresent === undefined || topology.shadowHostsPresent === undefined);

  // Page.getLayoutMetrics's `css*` fields are a genuinely newer/optional
  // addition (older Chrome CDP builds only ever populate the non-`css`
  // pair) -- falling back from `cssVisualViewport` to `visualViewport` is a
  // legitimate version fallback, not a malformed read. It IS a malformed
  // read (Layer 2) when BOTH members of a pair are missing: the metrics
  // call itself succeeded (this line has no catch -- see the module doc /
  // audit row 36 -- so a throw here already propagates honestly), yet
  // neither viewport shape came back.
  const visualViewportRaw = metrics.cssVisualViewport ?? metrics.visualViewport;
  const layoutViewportRaw = metrics.cssLayoutViewport ?? metrics.layoutViewport;
  const visualViewportUnavailable = visualViewportRaw === undefined;
  const layoutViewportUnavailable = layoutViewportRaw === undefined;

  const report: ScrollReport = {
    containers: containersOut,
    scrollContainersTotal,
    scrollContainersTruncated,
    ...(scrollContainersCountUnavailable ? { scrollContainersCountUnavailable: true as const } : {}),
    documentScrollHeight: topology.documentScrollHeight,
    documentScrollWidth: topology.documentScrollWidth,
    visualViewport: visualViewportRaw ?? null,
    ...(visualViewportUnavailable ? { visualViewportUnavailable: true as const } : {}),
    layoutViewport: layoutViewportRaw ?? null,
    ...(layoutViewportUnavailable ? { layoutViewportUnavailable: true as const } : {}),
    available,
    ...(reason ? { reason } : {}),
    scope: {
      root: 'top-document',
      shadowDom: 'light-only',
      iframesPresent: topology.iframesPresent ?? 0,
      shadowHostsPresent: topology.shadowHostsPresent ?? 0,
    },
    ...(scopeCountsUnavailable ? { scopeCountsUnavailable: true as const } : {}),
    restoration: {
      attempted: true,
      offsetsRestored: topology.offsetsRestored ?? false,
      markersCleared,
      ...(topology.scriptError ? { error: sanitizeString(topology.scriptError) } : {}),
    },
  };

  ctx.write.json('scroll.json', report);
};
