/**
 * `hittest.json` collector — point-sampled hit-test results (what element
 * actually receives a click at a given coordinate): a 9-point lattice
 * (center + 4 corners + 4 edge-midpoints) per walked element, plus a
 * coarse whole-viewport grid independent of any element.
 *
 * The ENTIRE walk + sampling happens inside ONE `Runtime.evaluate` script
 * (no per-point CDP round trip — `document.elementsFromPoint` runs natively
 * in the same evaluate call that also does the tree walk). Same-origin
 * iframe retargeting (a point whose topmost hit is an `<iframe>` gets
 * re-queried inside that iframe's own document) and shadow-DOM detection
 * both happen in-browser too — Chrome's `elementsFromPoint` already
 * flattens open shadow DOM automatically. Point coordinates are computed
 * via local `getBoundingClientRect()`/`elementsFromPoint` math (the one
 * exception the design allows JS geometry for — see `geometry.ts`'s module
 * doc), converted to top-viewport space via a JS-accumulated per-frame
 * offset (each nested same-origin iframe's own `getBoundingClientRect()`
 * within its parent, summed on the way down).
 *
 * Only `backendNodeId` resolution needs a Node-side round trip afterward.
 * EVERY element-bearing stack member this collector emits (each point's
 * full `stack[]`, not just `stack[0]`/`topReceiver`, plus each PRIMARY
 * sampled element) gets a bridge index and is resolved to a `backendNodeId`
 * where resolvable, so no emitted element record is selector-only. The
 * page-side walk dedupes by DOM identity (a `WeakMap` keyed on the live
 * element, scoped to one `Runtime.evaluate` invocation) so the same element
 * hit at many sample points/stack depths is bridged exactly once, and a
 * hard cap (`MAX_BRIDGE_ELEMENTS`) bounds the total unique element count so
 * a pathologically deep/wide walk can't blow up CDP round-trip cost — past
 * the cap, further NEW elements are simply left unbridged. Unbridged is
 * never silent: every element-bearing record's `backendNodeId` is always
 * present as `number | null` (never an omitted key), and a record whose
 * identity did not resolve — whether because the bridge cap turned it away
 * or because `DOM.describeNode` itself failed — carries `backendNodeId:
 * null` alongside `identityUnresolved: true`, so a downstream join can
 * never mistake it for a resolved node. The root-level `bridgeTruncated`
 * count says how many distinct elements the bridge cap turned away in
 * total; `elementsTruncated`/`samplesTruncated` report the same for the
 * candidate-element cap (`MAX_ELEMENTS`) and the whole-viewport lattice cap
 * (`LATTICE_MAX_POINTS`) respectively — all three are exact counts (the
 * walk keeps counting past each cap, never a guess), but `MAX_ELEMENTS`
 * bounds only the retained-candidate set and its 9-point lattice sampling:
 * every walked element still pays `getComputedStyle()`/
 * `getBoundingClientRect()`, because that read is what DEFINES eligibility
 * (`display !== none`, non-zero size) in the first place — the cap cannot
 * skip it without losing the exact count.
 *
 * The walk never assigns anything to `window` or any other page-observable
 * location: its return value is a plain in-memory `{ facts, elements }`
 * object (`facts` the JSON-safe per-point/per-element data, `elements` the
 * live dedup-bridged element handles), read back purely through CDP's own
 * remote-object identity — the exact same CDP-only identity bridge
 * `geometry.ts` uses and exports (`ownPropertyObjectIds`/`readHeldValue`/
 * `resolveIndexedObjectIds`/`describeBackendNodeId`), reused here rather
 * than duplicated. A page can predefine a setter for any global name it can
 * guess; it can observe nothing here, because nothing is ever set on it.
 * For the bounded set of PRIMARY elements specifically, their `rect` is
 * additionally upgraded from JS-local math to a real top-viewport CDP quad
 * (`DOM.getContentQuads`/`getBoxModel`, same as `geometry.ts`) — per the
 * design, ordinary (non-primary) stack members keep their JS-computed rect
 * since they are supplementary identification, not the primary geometry
 * source, and upgrading every one of them to a CDP quad would be needless
 * CDP round-trip cost; only their identity (`backendNodeId`) is bridged,
 * not their rect. So `backendNodeId` (the cross-artifact join key) is
 * present on every element sample and every stack member (at every depth)
 * where the underlying element resolved within the bridge cap.
 *
 * Two factual scope markers guard against silent omission: a point's
 * `opaqueFrame` is `true` when the topmost element hit there is an
 * `<iframe>` whose `contentDocument` is null (cross-origin/opaque —
 * otherwise indistinguishable from an empty same-origin frame), and the
 * artifact-root `bridgeCleanupFailed` is `true` when the try/finally
 * release of a held CDP object threw — unlike the old page-observable
 * global this replaces, a release failure can never imply a contaminated
 * baseline: there is no page-observable state left to leak, only
 * CDP-session-scoped remote-object memory freed when the tab closes. A
 * member/point's `frameId` (`'iframe-'+idx`) is a run-scoped ARTIFACT-LOCAL
 * id — it deliberately resembles a CDP Page frameId but is not one;
 * nothing downstream may join on it (join on `backendNodeId`).
 */

import type { CDPClient } from '../../client.js';
import { getContentQuadBox, axisAlignedRectFromQuad, type Quad, type Rect } from '../../coordinates.js';
import type { Collector } from '../types.js';
import { SELECTOR_HELPER_JS, ownPropertyObjectIds, readHeldValue, resolveIndexedObjectIds, describeBackendNodeId } from './geometry.js';
import { sanitizeString } from '../redaction.js';

/** Defensive cap on how many elements this collector will build a 9-point lattice for. */
const MAX_ELEMENTS = 500;
/** Defensive cap on the total number of UNIQUE (deduped-by-identity) elements this collector will bridge to a `backendNodeId` across the whole walk (every stack member at every depth, plus every primary element). Past this cap, newly-seen elements are simply left unbridged rather than uncapping the CDP round-trip cost. */
const MAX_BRIDGE_ELEMENTS = 3000;
/** Coarse whole-viewport lattice spacing, in CSS px. */
const LATTICE_STEP = 80;
/** Defensive cap on the whole-viewport lattice's total point count. */
const LATTICE_MAX_POINTS = 200;

// ============================================================================
// The page-side walk + sample. Runs once via `Runtime.evaluate({returnByValue: false})`
// -- the return value is held as a remote object (see the module doc's
// CDP-only identity bridge), never read back by value directly.
// ============================================================================

function buildHittestScript(maxElements: number, latticeStep: number, latticeMaxPoints: number, maxBridgeElements: number): string {
  return `(function () {
    var MAX_ELEMENTS = ${maxElements};
    var LATTICE_STEP = ${latticeStep};
    var LATTICE_MAX_POINTS = ${latticeMaxPoints};
    var MAX_BRIDGE_ELEMENTS = ${maxBridgeElements};
    var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, HEAD: 1, META: 1, LINK: 1, TITLE: 1, BASE: 1, NOSCRIPT: 1 };
    var bridgeEls = [];
    // Dedupe table for repeat elements seen across multiple sample points
    // within THIS SINGLE walk. Deliberately a WeakMap scoped to this one
    // (function () { ... })() invocation (a brand-new closure every
    // Runtime.evaluate call) rather than an expando written onto the
    // element itself -- an expando would persist on the live DOM after this
    // script returns, so a SECOND collectHittest() against the same page
    // would see a stale index left by the first run and skip re-pushing the
    // element into the new bridgeEls array. Nothing is ever written to any
    // page element; the map (and its keys) are garbage-collected with this
    // closure once Runtime.evaluate returns.
    var bridgeMap = new WeakMap();
    // Exact count of DISTINCT elements the MAX_BRIDGE_ELEMENTS cap turned
    // away (never a guess): a rejected element is recorded in bridgeMap as
    // undefined too, so re-encountering it at another sample point/stack
    // depth resolves the SAME 'unbridged' answer without recounting it.
    var bridgeOverflowCount = 0;

    function bridgeIndexOf(el) {
      if (!el) return undefined;
      if (bridgeMap.has(el)) return bridgeMap.get(el);
      if (bridgeEls.length >= MAX_BRIDGE_ELEMENTS) {
        bridgeMap.set(el, undefined);
        bridgeOverflowCount += 1;
        return undefined;
      }
      var idx = bridgeEls.length;
      bridgeEls.push(el);
      bridgeMap.set(el, idx);
      return idx;
    }

    // Builds a same-origin iframe's artifact-local frameId from its bridge
    // index -- returns undefined (never a bogus 'iframe-undefined' string)
    // when the bridge cap already turned the iframe element away, so a
    // cap-exhausted iframe context is honestly withheld rather than
    // collapsed onto a fake stable-looking id shared with every other
    // capped iframe.
    function iframeFrameId(bridgeIdx) {
      return bridgeIdx === undefined ? undefined : 'iframe-' + bridgeIdx;
    }

    function directTextOf(el) {
      var out = '';
      for (var i = 0; i < el.childNodes.length; i++) {
        var n = el.childNodes[i];
        if (n.nodeType === 3 && n.textContent) out += n.textContent;
      }
      out = out.replace(/\\s+/g, ' ').trim();
      return out || undefined;
    }

    function isInShadow(el) {
      try {
        var root = el.getRootNode ? el.getRootNode() : null;
        return !!(root && root.host);
      } catch (e) { return false; }
    }

    function isClipped(el, rect) {
      try {
        var node = el.parentElement;
        var hops = 0;
        var docEl = el.ownerDocument.documentElement;
        while (node && node.nodeType === 1 && node !== docEl && hops < 50) {
          var s = getComputedStyle(node);
          if (/hidden|auto|scroll|clip/.test(s.overflowX) || /hidden|auto|scroll|clip/.test(s.overflowY)) {
            var ar = node.getBoundingClientRect();
            if (rect.left < ar.left - 0.5 || rect.right > ar.right + 0.5 || rect.top < ar.top - 0.5 || rect.bottom > ar.bottom + 0.5) {
              return true;
            }
          }
          node = node.parentElement;
          hops += 1;
        }
        return false;
      } catch (e) { return false; }
    }

    function makeStackMember(el, frameOffset) {
      var r = el.getBoundingClientRect();
      var style = getComputedStyle(el);
      var disabled = false;
      try { disabled = !!(el.matches && el.matches(':disabled')); } catch (e) {}
      var ariaDisabled = !!(el.getAttribute && el.getAttribute('aria-disabled') === 'true');
      var inert = false;
      try { inert = !!(el.closest && el.closest('[inert]')); } catch (e) {}
      var opacity = parseFloat(style.opacity);
      if (isNaN(opacity)) opacity = 1;
      var member = {
        // EVERY emitted stack member is bridged (deduped by DOM identity,
        // bounded by MAX_BRIDGE_ELEMENTS) so backendNodeId resolution
        // below covers deeper stack entries too, not just the top receiver.
        bridgeIdx: bridgeIndexOf(el),
        selector: __selectorOf(el),
        tag: el.tagName ? el.tagName.toLowerCase() : '',
        rect: { x: r.x + frameOffset.dx, y: r.y + frameOffset.dy, width: r.width, height: r.height },
        zIndex: style.zIndex || 'auto',
        pointerEvents: style.pointerEvents,
        cursor: style.cursor,
        opacity: opacity,
        disabled: disabled,
        ariaDisabled: ariaDisabled,
        inert: inert,
        clipped: isClipped(el, r),
        inShadowDom: isInShadow(el),
        inIframe: frameOffset.frameId !== 'frame-0',
        frameId: frameOffset.frameId,
      };
      return { member: member, el: el };
    }

    function sampleStackAt(doc, localX, localY, frameOffset, depth) {
      var raw = [];
      // H5: a THROW is a genuine hit-test read failure; a nullish return
      // (elementsFromPoint should never do this per spec, but a
      // hostile/broken page can still patch the method) is the same fact --
      // either way stackUnavailable distinguishes "the read failed" from a
      // real empty stack (topReceiver genuinely nothing at this point),
      // which the bare '|| []' coercion made indistinguishable before.
      var stackUnavailable = false;
      try {
        var elementsFromPointResult = doc.elementsFromPoint(localX, localY);
        if (elementsFromPointResult) {
          raw = elementsFromPointResult;
        } else {
          stackUnavailable = true;
        }
      } catch (e) {
        raw = [];
        stackUnavailable = true;
      }
      var built = [];
      for (var i = 0; i < raw.length; i++) built.push(makeStackMember(raw[i], frameOffset));
      var members = built.map(function (b) { return b.member; });

      var retargetedShadow = false;
      for (var j = 0; j < members.length; j++) { if (members[j].inShadowDom) { retargetedShadow = true; break; } }

      var opaqueFrame = false;
      var topEl = raw.length ? raw[0] : null;
      if (topEl && topEl.tagName === 'IFRAME' && depth < 5) {
        var innerDoc = null;
        try { innerDoc = topEl.contentDocument; } catch (e) { innerDoc = null; }
        if (innerDoc) {
          var ir = topEl.getBoundingClientRect();
          var childFrameOffset = {
            dx: frameOffset.dx + ir.left,
            dy: frameOffset.dy + ir.top,
            // Artifact-local, run-scoped id -- 'iframe-' + this run's bridge
            // index for the iframe element (undefined, never a bogus
            // 'iframe-undefined', when the bridge cap already turned this
            // iframe away). It deliberately LOOKS like a CDP Page frameId but
            // is NOT one; nothing downstream may join on it.
            frameId: iframeFrameId(bridgeIndexOf(topEl)),
          };
          var inner = sampleStackAt(innerDoc, localX - ir.left, localY - ir.top, childFrameOffset, depth + 1);
          return {
            members: members.concat(inner.members),
            topReceiverMember: inner.topReceiverMember,
            topReceiverEl: inner.topReceiverEl,
            retargetedIframe: true,
            retargetedShadow: retargetedShadow || inner.retargetedShadow,
            opaqueFrame: inner.opaqueFrame,
            // stackUnavailable is always false on THIS level here -- reaching
            // this branch required a real topEl, which only exists when the
            // outer elementsFromPoint read succeeded -- so the retargeted
            // point's honesty is entirely the inner (retargeted) read's.
            stackUnavailable: inner.stackUnavailable,
          };
        }
        // contentDocument was null on a topmost IFRAME hit -> the frame is
        // cross-origin/opaque, indistinguishable in the stack from an empty
        // same-origin frame without this explicit fact.
        opaqueFrame = true;
      }

      // topReceiverMember is members[0] (or null for an empty stack) --
      // already bridged above in makeStackMember(), same as every other
      // stack member, so no separate bridging step is needed here.
      var topReceiverMember = members.length ? members[0] : null;
      return {
        members: members,
        topReceiverMember: topReceiverMember,
        topReceiverEl: topEl,
        retargetedIframe: false,
        retargetedShadow: retargetedShadow,
        opaqueFrame: opaqueFrame,
        stackUnavailable: stackUnavailable,
      };
    }

    function buildPointResult(doc, localX, localY, frameOffset, depth) {
      var res = sampleStackAt(doc, localX, localY, frameOffset, depth);
      return {
        x: localX + frameOffset.dx,
        y: localY + frameOffset.dy,
        stack: res.members,
        topReceiver: res.topReceiverMember,
        topReceiverEl: res.topReceiverEl,
        retargetedThroughIframe: res.retargetedIframe,
        retargetedThroughShadow: res.retargetedShadow,
        opaqueFrame: res.opaqueFrame,
        stackUnavailable: res.stackUnavailable,
      };
    }

    function stripPoint(pr) {
      return {
        x: pr.x,
        y: pr.y,
        stack: pr.stack,
        topReceiver: pr.topReceiver,
        retargetedThroughIframe: pr.retargetedThroughIframe,
        retargetedThroughShadow: pr.retargetedThroughShadow,
        opaqueFrame: pr.opaqueFrame,
        stackUnavailable: pr.stackUnavailable,
      };
    }

    function pointLabelsFor(rect) {
      var cx = rect.x + rect.width / 2;
      var cy = rect.y + rect.height / 2;
      return [
        { label: 'center', x: cx, y: cy },
        { label: 'top-left', x: rect.x, y: rect.y },
        { label: 'top-right', x: rect.x + rect.width, y: rect.y },
        { label: 'bottom-left', x: rect.x, y: rect.y + rect.height },
        { label: 'bottom-right', x: rect.x + rect.width, y: rect.y + rect.height },
        { label: 'top-mid', x: cx, y: rect.y },
        { label: 'bottom-mid', x: cx, y: rect.y + rect.height },
        { label: 'left-mid', x: rect.x, y: cy },
        { label: 'right-mid', x: rect.x + rect.width, y: cy },
      ];
    }

    var candidates = [];
    // Exact count of real candidate elements the MAX_ELEMENTS cap chose not
    // to keep (0 when every eligible element fit). MAX_ELEMENTS bounds the
    // EXPENSIVE per-candidate work: the 9-point lattice sampling below (only
    // retained candidates entries get sampled) and the retained-candidate
    // set itself. It does NOT and cannot bound the single getComputedStyle()
    // + getBoundingClientRect() read every walked element gets, because that
    // read is what DEFINES an eligible candidate (display!==none, non-zero
    // size) in the first place -- an exact eligible-candidate count requires
    // making it. So this count is real (the walk keeps checking eligibility
    // past the cap), never a guess.
    var candidatesOverflowCount = 0;
    // H7: exact count of same-origin <iframe> elements whose contentDocument
    // read THREW during the candidate walk (a genuine failure, distinct from
    // an ordinary cross-origin/childless iframe which returns null without
    // throwing) -- an aggregate rather than a per-record marker, since the
    // failing iframe element itself may never become a retained candidate
    // (zero-size, or turned away by MAX_ELEMENTS) and so may have no record
    // of its own to attach a marker to.
    var candidateIframeReadFailures = 0;
    function walkCandidates(el, frameOffset, ownerDoc) {
      if (!el || el.nodeType !== 1) return;
      var tag = el.tagName;
      if (SKIP_TAGS[tag]) return;
      var style = getComputedStyle(el);
      if (style.display === 'none') return;
      var rect = el.getBoundingClientRect();
      if (!(rect.width === 0 && rect.height === 0)) {
        if (candidates.length < MAX_ELEMENTS) {
          candidates.push({ el: el, frameOffset: frameOffset, rect: rect, ownerDoc: ownerDoc });
        } else {
          candidatesOverflowCount += 1;
        }
      }

      if (el.shadowRoot) {
        var shadowKids = el.shadowRoot.children;
        for (var si = 0; si < shadowKids.length; si++) walkCandidates(shadowKids[si], frameOffset, ownerDoc);
      }

      if (tag === 'IFRAME') {
        var innerDoc = null;
        var candidateContentDocumentThrew = false;
        try { innerDoc = el.contentDocument; } catch (e) { innerDoc = null; candidateContentDocumentThrew = true; }
        if (candidateContentDocumentThrew) candidateIframeReadFailures += 1;
        if (innerDoc && innerDoc.body) {
          var ir = el.getBoundingClientRect();
          var childOffset = { dx: frameOffset.dx + ir.left, dy: frameOffset.dy + ir.top, frameId: iframeFrameId(bridgeIndexOf(el)) };
          var innerKids = innerDoc.body.children;
          for (var ii = 0; ii < innerKids.length; ii++) walkCandidates(innerKids[ii], childOffset, innerDoc);
        }
        return;
      }

      var children = el.children;
      for (var c = 0; c < children.length; c++) walkCandidates(children[c], frameOffset, ownerDoc);
    }

    var topKids = document.body ? document.body.children : [];
    for (var bi = 0; bi < topKids.length; bi++) {
      walkCandidates(topKids[bi], { dx: 0, dy: 0, frameId: 'frame-0' }, document);
    }

    var results = [];
    for (var ci = 0; ci < candidates.length; ci++) {
      var cand = candidates[ci];
      var pts = pointLabelsFor(cand.rect);
      var pointEntries = [];
      var selfHitCount = 0;
      for (var pi = 0; pi < pts.length; pi++) {
        var p = pts[pi];
        var raw2 = buildPointResult(cand.ownerDoc, p.x, p.y, cand.frameOffset, 0);
        if (raw2.topReceiverEl === cand.el) selfHitCount += 1;
        pointEntries.push({ label: p.label, result: stripPoint(raw2) });
      }
      results.push({
        markIdx: ci,
        bridgeIdx: bridgeIndexOf(cand.el),
        selector: __selectorOf(cand.el),
        text: directTextOf(cand.el),
        points: pointEntries,
        selfHitCount: selfHitCount,
        selfHitTotal: pts.length,
      });
    }

    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var samplePoints = [];
    // Exact count of real lattice points the LATTICE_MAX_POINTS cap dropped
    // -- the double loop always finishes (no early break), it just stops
    // pushing once the cap is hit, so this is a real count, never a guess.
    var latticeOverflowCount = 0;
    for (var y = LATTICE_STEP / 2; y < vh; y += LATTICE_STEP) {
      for (var x = LATTICE_STEP / 2; x < vw; x += LATTICE_STEP) {
        if (samplePoints.length < LATTICE_MAX_POINTS) {
          samplePoints.push({ x: x, y: y });
        } else {
          latticeOverflowCount += 1;
        }
      }
    }
    var samples = [];
    for (var spi = 0; spi < samplePoints.length; spi++) {
      var sp = samplePoints[spi];
      var raw3 = buildPointResult(document, sp.x, sp.y, { dx: 0, dy: 0, frameId: 'frame-0' }, 0);
      samples.push(stripPoint(raw3));
    }

    return {
      facts: {
        bridgeCount: bridgeEls.length,
        elements: results,
        samples: samples,
        elementsTruncated: candidatesOverflowCount,
        samplesTruncated: latticeOverflowCount,
        bridgeTruncated: bridgeOverflowCount,
        candidateIframesUnavailable: candidateIframeReadFailures,
      },
      elements: bridgeEls,
    };
  })()`;
}

// ============================================================================
// Raw (pre-bridge-resolution) shapes returned by the page-side script.
// ============================================================================

interface RawStackMember {
  readonly bridgeIdx?: number;
  readonly selector?: string;
  readonly tag: string;
  readonly rect: Rect;
  readonly zIndex: string;
  readonly pointerEvents: string;
  readonly cursor: string;
  readonly opacity: number;
  readonly disabled: boolean;
  readonly ariaDisabled: boolean;
  readonly inert: boolean;
  readonly clipped: boolean;
  readonly inShadowDom: boolean;
  readonly inIframe: boolean;
  readonly frameId?: string;
}

interface RawPointResult {
  readonly x: number;
  readonly y: number;
  readonly stack: RawStackMember[];
  readonly topReceiver: RawStackMember | null;
  readonly retargetedThroughIframe: boolean;
  readonly retargetedThroughShadow: boolean;
  readonly opaqueFrame: boolean;
  /** H5: `true` when `document.elementsFromPoint()` threw or returned a nullish result at this point — `stack`/`topReceiver` are then a forced empty read, not a proven "nothing here" observation. */
  readonly stackUnavailable: boolean;
}

interface RawElementSample {
  readonly markIdx: number;
  readonly bridgeIdx?: number;
  readonly selector?: string;
  readonly text?: string;
  readonly points: Array<{ label: string; result: RawPointResult }>;
  readonly selfHitCount: number;
  readonly selfHitTotal: number;
}

interface RawHittestResult {
  readonly bridgeCount: number;
  readonly elements: RawElementSample[];
  readonly samples: RawPointResult[];
  /** Exact count of real candidate elements the {@link MAX_ELEMENTS} cap dropped (0 when everything fit). */
  readonly elementsTruncated: number;
  /** Exact count of real whole-viewport lattice points the {@link LATTICE_MAX_POINTS} cap dropped (0 when everything fit). */
  readonly samplesTruncated: number;
  /** Exact count of distinct elements the {@link MAX_BRIDGE_ELEMENTS} cap turned away from identity resolution (0 when everything fit). */
  readonly bridgeTruncated: number;
  /** H7: exact count of same-origin `<iframe>` elements whose `contentDocument` read THREW during the candidate walk (0 when everything fit or every iframe was genuinely cross-origin/childless, which throws nothing). */
  readonly candidateIframesUnavailable: number;
}

// ============================================================================
// Public record shapes
// ============================================================================

export interface HitTestStackMember {
  /** `null` (never an omitted key) when this record's identity did not resolve — see {@link identityUnresolved}. */
  readonly backendNodeId: number | null;
  /** `true` when {@link backendNodeId} is `null` because identity resolution was capped or failed — never omit this alongside a `null` backendNodeId, so a downstream join can never mistake an unresolved record for a resolved one. Absent (not `false`) when identity resolved. */
  readonly identityUnresolved?: boolean;
  readonly selector?: string;
  readonly tag: string;
  readonly rect: Rect;
  /** `true` when {@link rect} is the JS-local `getBoundingClientRect()` approximation because the CDP rect upgrade (`DOM.getContentQuads`/`DOM.getBoxModel`, attempted only for PRIMARY elements — see the module doc) rejected. A rejected upgrade covers both a genuine no-layout-box element and an actual protocol/read failure (the two are indistinguishable from this shared `coordinates.ts` helper alone — see {@link BridgeInfo}), so this marks EITHER, but a rejection must never be silently absorbed into the same unmarked shape a real CDP-derived rect produces. Absent when `rect` is the real CDP-derived quad-union rect, or when this member is not a primary element (the upgrade is never attempted for those, by design, not a failure). */
  readonly rectCdpUpgradeFailed?: true;
  readonly zIndex: string;
  readonly pointerEvents: string;
  readonly cursor: string;
  readonly opacity: number;
  readonly disabled: boolean;
  readonly ariaDisabled: boolean;
  readonly inert: boolean;
  readonly clipped: boolean;
  readonly inShadowDom: boolean;
  readonly inIframe: boolean;
  readonly frameId?: string;
}

export interface HitTestPointResult {
  readonly x: number;
  readonly y: number;
  readonly stack: HitTestStackMember[];
  readonly topReceiver: HitTestStackMember | null;
  readonly retargetedThroughIframe: boolean;
  readonly retargetedThroughShadow: boolean;
  /** True when the topmost element hit at this point is an `<iframe>` whose `contentDocument` is null — a cross-origin/opaque frame. A factual scope marker so an opaque frame is not silently indistinguishable from an empty same-origin one. */
  readonly opaqueFrame: boolean;
  /** `true` when `document.elementsFromPoint()` itself threw or returned a nullish result at this point (H5) — `stack: []`/`topReceiver: null` is then a forced-empty read, not a proven "nothing receives a hit here" observation. Always present (never omitted), so a genuinely empty stack is distinguishable from a failed read. */
  readonly stackUnavailable: boolean;
}

export interface HitTestElementSample {
  readonly id: string;
  /** `null` (never an omitted key) when this record's identity did not resolve — see {@link identityUnresolved}. */
  readonly backendNodeId: number | null;
  /** `true` when {@link backendNodeId} is `null` because identity resolution was capped or failed. Absent (not `false`) when identity resolved. */
  readonly identityUnresolved?: boolean;
  readonly selector?: string;
  readonly text?: string;
  readonly points: Array<{ label: string; result: HitTestPointResult }>;
  readonly selfHitCount: number;
  readonly selfHitTotal: number;
}

/** Fixed, factual reason the walk evaluate/bridge could not be read (never a raw exception message, which is unbounded/page-influenced) — present only when {@link HittestJson.available} is `false`. `walk-facts-unavailable` covers BOTH a missing `facts` objectId on the held container and a `readHeldValue()` that resolves without throwing but returns `undefined` — either way the required `facts` read did not happen, so it collapses to the one reason rather than two indistinguishable-in-practice ones. */
export type HittestUnavailableReason = 'walk-evaluate-threw' | 'walk-evaluate-returned-no-object' | 'walk-facts-unavailable';

export interface HittestJson {
  readonly elements: HitTestElementSample[];
  readonly samples: HitTestPointResult[];
  /** Exact count of real candidate elements the {@link MAX_ELEMENTS} cap dropped — always present (0 when everything fit), per I-5. */
  readonly elementsTruncated: number;
  /** Exact count of real whole-viewport lattice points the {@link LATTICE_MAX_POINTS} cap dropped — always present (0 when everything fit), per I-5. */
  readonly samplesTruncated: number;
  /** Exact count of distinct elements the {@link MAX_BRIDGE_ELEMENTS} cap turned away from identity resolution — always present (0 when everything fit), per I-5. Every affected record still carries `backendNodeId: null` + `identityUnresolved: true` (see {@link HitTestStackMember}), so this is an aggregate on top of, never a substitute for, the per-record honesty marker. */
  readonly bridgeTruncated: number;
  /** Exact count of same-origin `<iframe>` elements whose `contentDocument` read THREW during the candidate walk (H7) — always present (0 when everything fit or every iframe was genuinely cross-origin/childless), per I-5. That iframe's own subtree was never walked for candidates, but (unlike G6 in geometry.ts) the failing iframe element may have no retained candidate record of its own to mark, so this is an aggregate rather than a per-record honesty field. */
  readonly candidateIframesUnavailable: number;
  /** `false` when the walk evaluate/bridge itself failed — `elements: []`/`samples: []` with every truncation count at `0` is then "could not collect", not "genuinely empty page" (I-4/I-5). Always `true` on a normal run, including one where the page really has no elements/samples. */
  readonly available: boolean;
  /** Present only when `available` is `false`. */
  readonly unavailableReason?: HittestUnavailableReason;
  /** True when the try/finally release of a held CDP bridge object threw — a factual marker that CDP-session-scoped remote-object memory may not have been freed early, never a diagnosis and never page-observable state. Absent when release succeeded. */
  readonly bridgeCleanupFailed?: boolean;
}

// ============================================================================
// Bridge resolution — EVERY element-bearing record gets a bridge index and
// is resolved to a backendNodeId here: every stack member at every depth
// (`makeStackMember`), each point's topReceiver (already one of those stack
// members), and every primary sampled element. Only primary elements
// additionally get their `rect` upgraded from JS-local math to a real
// top-viewport CDP quad (see module doc) — ordinary stack members keep
// their JS-computed rect but are bridged for identity exactly like primary
// elements are.
// ============================================================================

interface BridgeInfo {
  readonly backendNodeId?: number;
  readonly rect?: Rect;
  /** `true` when this bridge entry is a PRIMARY element (see {@link resolveBridge}'s `primaryIdxSet` param) whose CDP rect upgrade (`DOM.getContentQuads`/`DOM.getBoxModel` via `coordinates.ts`'s `getContentQuadBox`) rejected — {@link rect} is absent, so `patchMember` falls back to the JS-local `member.rect`, but that fallback must be marked (see {@link HitTestStackMember.rectCdpUpgradeFailed}) so a protocol/read failure can never be indistinguishable from a rect that is deliberately JS-local (e.g. an ordinary, non-primary stack member — see the module doc). Absent when the upgrade succeeded or was never attempted (non-primary element). */
  readonly rectCdpUpgradeFailed?: true;
}

function unionRect(quads: Quad[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const quad of quads) {
    const r = axisAlignedRectFromQuad(quad);
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Resolves each already-bridged `objectId` (sourced from the held `elements` array — see {@link collectHittest}, never a page-observable global) to its `backendNodeId`, plus (for PRIMARY elements only) an upgraded top-viewport CDP quad rect. */
async function resolveBridge(
  client: CDPClient,
  objectIds: ReadonlyArray<string | undefined>,
  primaryIdxSet: ReadonlySet<number>,
): Promise<Map<number, BridgeInfo>> {
  const map = new Map<number, BridgeInfo>();
  await Promise.all(
    objectIds.map(async (objectId, idx) => {
      if (!objectId) return;
      const backendNodeId = await describeBackendNodeId(client, objectId);
      let rect: Rect | undefined;
      let rectCdpUpgradeFailed: true | undefined;
      if (primaryIdxSet.has(idx)) {
        try {
          const box = await getContentQuadBox(client, { objectId });
          if (box.quads.length > 0) rect = unionRect(box.quads);
        } catch {
          // The CDP rect upgrade rejected -- getContentQuadBox bundles
          // DOM.getContentQuads + DOM.getBoxModel behind one reject (see
          // coordinates.ts's own doc comment), so this covers a genuine
          // no-layout-box element (display:none, zero-size) AND an actual
          // protocol/read failure alike -- coordinates.ts is a shared
          // helper used by geometry.ts/pixels.ts too, so this call site
          // cannot split those apart without changing that shared contract
          // (out of scope here). Either way `rect` stays the JS-local
          // `member.rect` fallback below, but that fallback must never be
          // indistinguishable from a genuinely CDP-upgraded rect, so mark
          // it explicitly (I-4/I-5) rather than silently keeping it mute.
          rectCdpUpgradeFailed = true;
        }
      }
      map.set(idx, { backendNodeId, rect, ...(rectCdpUpgradeFailed ? { rectCdpUpgradeFailed } : {}) });
    }),
  );
  return map;
}

/** Builds the honest `{ backendNodeId, identityUnresolved }` pair shared by every element-bearing hittest record — one authoritative shape, reused for stack members, topReceivers, and primary elements, so "identity did not resolve" is expressed identically everywhere it can happen (per I-3/I-5). */
function resolvedIdentity(backendNodeId: number | undefined): { backendNodeId: number | null; identityUnresolved?: true } {
  return backendNodeId === undefined ? { backendNodeId: null, identityUnresolved: true } : { backendNodeId };
}

function patchMember(member: RawStackMember, resolved: Map<number, BridgeInfo>): HitTestStackMember {
  const info = member.bridgeIdx !== undefined ? resolved.get(member.bridgeIdx) : undefined;
  return {
    ...resolvedIdentity(info?.backendNodeId),
    selector: member.selector !== undefined ? sanitizeString(member.selector, { max: 300 }) : undefined,
    tag: sanitizeString(member.tag, { max: 64 }),
    rect: info?.rect ?? member.rect,
    ...(info?.rectCdpUpgradeFailed ? { rectCdpUpgradeFailed: true as const } : {}),
    zIndex: sanitizeString(member.zIndex, { max: 20 }),
    pointerEvents: sanitizeString(member.pointerEvents, { max: 100 }),
    cursor: sanitizeString(member.cursor, { max: 300 }),
    opacity: member.opacity,
    disabled: member.disabled,
    ariaDisabled: member.ariaDisabled,
    inert: member.inert,
    clipped: member.clipped,
    inShadowDom: member.inShadowDom,
    inIframe: member.inIframe,
    frameId: member.frameId,
  };
}

function patchPoint(pr: RawPointResult, resolved: Map<number, BridgeInfo>): HitTestPointResult {
  return {
    x: pr.x,
    y: pr.y,
    stack: pr.stack.map((m) => patchMember(m, resolved)),
    topReceiver: pr.topReceiver ? patchMember(pr.topReceiver, resolved) : null,
    retargetedThroughIframe: pr.retargetedThroughIframe,
    retargetedThroughShadow: pr.retargetedThroughShadow,
    opaqueFrame: pr.opaqueFrame,
    stackUnavailable: pr.stackUnavailable,
  };
}

// ============================================================================
// Collector
// ============================================================================

export const collectHittest: Collector = async (ctx) => {
  let raw: RawHittestResult = {
    bridgeCount: 0,
    elements: [],
    samples: [],
    elementsTruncated: 0,
    samplesTruncated: 0,
    bridgeTruncated: 0,
    candidateIframesUnavailable: 0,
  };
  let objectIds: Array<string | undefined> = [];
  let bridgeCleanupFailed = false;
  // I-5/I-4: distinguishes "the walk evaluate/bridge failed" from "the page
  // really has zero candidates/samples" -- both would otherwise collapse to
  // the same empty elements/samples with every truncation count at 0,
  // falsely claiming nothing was dropped when in fact nothing was ever read.
  let available = true;
  let unavailableReason: HittestUnavailableReason | undefined;
  const heldObjectIds: string[] = [];
  try {
    const walkEval = (await ctx.client.send('Runtime.evaluate', {
      expression: SELECTOR_HELPER_JS + buildHittestScript(MAX_ELEMENTS, LATTICE_STEP, LATTICE_MAX_POINTS, MAX_BRIDGE_ELEMENTS),
      returnByValue: false,
    })) as { result?: { objectId?: string } };
    const resultObjectId = walkEval.result?.objectId;

    if (resultObjectId) {
      heldObjectIds.push(resultObjectId);
      const containerIds = await ownPropertyObjectIds(ctx.client, resultObjectId);
      const factsObjectId = containerIds.get('facts');
      const elementsObjectId = containerIds.get('elements');

      // I-4: a missing `facts` objectId (the container came back without
      // it) and a `readHeldValue()` that resolves to `undefined` without
      // throwing are BOTH "the required facts read did not happen" -- both
      // must fall to available:false, never quietly fall through to `raw`'s
      // initialized-empty default (which would look identical to a
      // genuinely empty page).
      let factsValue: RawHittestResult | undefined;
      if (factsObjectId) {
        heldObjectIds.push(factsObjectId);
        factsValue = await readHeldValue<RawHittestResult>(ctx.client, factsObjectId);
      }

      if (factsValue === undefined) {
        available = false;
        unavailableReason = 'walk-facts-unavailable';
      } else {
        raw = factsValue;
        if (elementsObjectId && raw.bridgeCount > 0) {
          heldObjectIds.push(elementsObjectId);
          objectIds = await resolveIndexedObjectIds(ctx.client, elementsObjectId, raw.bridgeCount);
        }
      }
    } else {
      available = false;
      unavailableReason = 'walk-evaluate-returned-no-object';
    }
  } catch {
    raw = {
      bridgeCount: 0,
      elements: [],
      samples: [],
      elementsTruncated: 0,
      samplesTruncated: 0,
      bridgeTruncated: 0,
      candidateIframesUnavailable: 0,
    };
    available = false;
    unavailableReason = 'walk-evaluate-threw';
  } finally {
    // Runs UNCONDITIONALLY: every held container/facts/elements objectId must
    // be released even when a step above throws, so a later capture on the
    // same tab never collides with anything this run held.
    for (const id of heldObjectIds) {
      try {
        await ctx.client.send('Runtime.releaseObject', { objectId: id });
      } catch {
        // Cleanup failing shouldn't fail the whole capture — but it IS a fact
        // downstream should see, recorded below as bridgeCleanupFailed.
        bridgeCleanupFailed = true;
      }
    }
  }

  const primaryIdxSet = new Set<number>();
  for (const e of raw.elements) {
    if (e.bridgeIdx !== undefined) primaryIdxSet.add(e.bridgeIdx);
  }

  const resolved = await resolveBridge(ctx.client, objectIds, primaryIdxSet);

  const elements: HitTestElementSample[] = raw.elements.map((e) => {
    const primaryInfo = e.bridgeIdx !== undefined ? resolved.get(e.bridgeIdx) : undefined;
    return {
      id: `hit-${e.markIdx}`,
      ...resolvedIdentity(primaryInfo?.backendNodeId),
      selector: e.selector !== undefined ? sanitizeString(e.selector, { max: 300 }) : undefined,
      text: e.text !== undefined ? sanitizeString(e.text, { max: 200 }) : undefined,
      points: e.points.map((p) => ({ label: p.label, result: patchPoint(p.result, resolved) })),
      selfHitCount: e.selfHitCount,
      selfHitTotal: e.selfHitTotal,
    };
  });
  const samples: HitTestPointResult[] = raw.samples.map((s) => patchPoint(s, resolved));

  ctx.write.json('hittest.json', {
    elements,
    samples,
    elementsTruncated: raw.elementsTruncated,
    samplesTruncated: raw.samplesTruncated,
    bridgeTruncated: raw.bridgeTruncated,
    candidateIframesUnavailable: raw.candidateIframesUnavailable,
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
    ...(bridgeCleanupFailed ? { bridgeCleanupFailed: true } : {}),
  } satisfies HittestJson);
};
