/**
 * `media.json` collector — `<img>`/`<video>`/`<canvas>`/`<svg>`/`<iframe>`
 * element facts: intrinsic vs rendered size, current source, load/decode
 * state, and (for `object-fit`-bearing elements) computed crop/letterbox
 * facts. One `Runtime.evaluate` gathers raw per-element facts in-page;
 * `backendNodeId` correlation reuses `resolveNodeIds` from `./styles.js`
 * (this file issues its own `DOM.getDocument` call — collectors run
 * concurrently, so no CDP call is shared across files).
 *
 * This is a `phase: 'baseline'` collector, so it must not create or pin
 * any page-observable state: `canvas.getContext(...)` is deliberately NOT
 * called here — the first call to it on a given canvas creates and
 * permanently pins that canvas to the requested context type (a page can
 * observe this), which a baseline read is not allowed to do. `contextType`
 * is therefore always `null` — an honest "not probed", not a measured
 * absence — rather than a probed value.
 */

import { resolveNodeIds } from './styles.js';
import { sanitizeString } from '../redaction.js';
import type { Collector } from '../types.js';

const MEDIA_MAX_ELEMENTS = 200;

// ============================================================================
// Output shape
// ============================================================================

export interface CropFactCover {
  mode: 'cover';
  croppedLeftPx: number;
  croppedRightPx: number;
  croppedTopPx: number;
  croppedBottomPx: number;
}

export interface CropFactContain {
  mode: 'contain';
  letterboxTopPx: number;
  letterboxBottomPx: number;
  pillarboxLeftPx: number;
  pillarboxRightPx: number;
}

export interface CropFactFill {
  mode: 'fill';
  distorted: boolean;
}

export interface CropFactOther {
  mode: string;
}

export type CropFact = CropFactCover | CropFactContain | CropFactFill | CropFactOther;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MediaElementRecord {
  id: string;
  selector: string;
  /** `null` when this element's identity could not be resolved (see {@link identityUnresolved}) — never simply omitted (I-3), even when {@link MediaReport.identity} is otherwise `available:true`. */
  backendNodeId: number | null;
  /** `true` when {@link backendNodeId} is `null` because this element's `cssPath` selector did not resolve to a CDP node — absent (not `false`) when resolved, matching hittest.ts's convention. */
  identityUnresolved?: true;
  tag: string;
  rect: Rect;
  /** `null` when {@link styleUnavailable} is `true` — a thrown `getComputedStyle` read means visibility genuinely could not be determined, distinct from `false` ("we read the style and it is hidden") or `true` ("we read the style and it is not hidden"). */
  visible: boolean | null;
  naturalWidth: number | null;
  naturalHeight: number | null;
  renderedWidth: number;
  renderedHeight: number;
  devicePixelRatio: number;
  currentSrc: string | null;
  /** `img`: `'complete' | 'loading'`; `video`: a `readyState` label; `canvas`/`svg`/`iframe`: `null`. */
  decodeState: string | null;
  intrinsicAspectRatio: number | null;
  objectFit: string | null;
  objectPosition: string | null;
  crop: CropFact | null;
  /** MARK #62 (I-4/I-5): `true` when the in-page `getComputedStyle(el)` call threw — {@link visible}, {@link objectFit}, {@link objectPosition}, and {@link crop} are then all unavailable-not-observed (never fabricated from rect geometry alone), never simply omitted. Absent (not `false`) on a successful style read. */
  styleUnavailable?: true;
  /** MARK #63 (I-4/I-5): `true` (svg only) when the in-page `el.viewBox.baseVal` read threw — {@link naturalWidth}/{@link naturalHeight} staying `null` is then "could not read", distinguishable from a genuinely absent/unset `viewBox`. Absent (not `false`) on a successful read (or for non-svg tags). */
  intrinsicDimsUnavailable?: true;
  /** Canvas only. Always `null` — baseline collection never probes `getContext` (see file header); this is an honest "not probed" fact, not a measured absence. */
  contextType: string | null;
  backingWidth: number | null;
  backingHeight: number | null;
  /** Video only. */
  poster?: string | null;
  /** Iframe only. */
  src?: string | null;
  crossOrigin?: boolean | null;
}

export interface MediaReport {
  elements: MediaElementRecord[];
  /** Present only when {@link totalCount} is `available:true` AND the page had more `img`/`video`/`canvas`/`svg`/`iframe` elements than {@link MEDIA_MAX_ELEMENTS} — the count dropped past the cap. Absent when `totalCount.available` is `false` too: an unknown total means truncation is unknown, NOT "none" (I-5) — check {@link totalCount} before reading absence here as "not truncated". */
  elementsTruncated?: number;
  /** Explicit total-count availability fact (I-5), DISTINCT from {@link identity}: `available:false` means either the companion `MEDIA_TOTAL_SCRIPT` read failed/returned a non-number, or (when the primary inventory itself was unavailable) it was never attempted at all — either way, whether the kept `elements`/`elementsTruncated` are an exhaustive enumeration is unknown, never coerced to `elements.length` (which would falsely claim no truncation). */
  totalCount: { available: true; total: number } | { available: false; reason: MediaTotalCountUnavailableReason };
  /** Explicit scope fact (D5): the in-page walk queries the top document only — media inside iframes / shadow roots is absent, a stated scope boundary rather than a negative fact. */
  coverage: { scope: 'top-document' };
  /** Explicit identity-resolution availability fact (I-4): `available:false` means `backendNodeId` was never attempted for ANY element this run (`DOM.getDocument`/`resolveNodeIds` failed) — distinct from a per-element `backendNodeId` simply being `null` because that one element's selector didn't resolve while the system was healthy. */
  identity: { available: true } | { available: false; reason: string };
  /** `false` when the `MEDIA_SCRIPT` inventory `Runtime.evaluate` itself failed (threw, or returned no `value`) — `elements: []` is then "could not collect", not "genuinely no media elements" (I-5). Always `true` on a normal run. DISTINCT from {@link identity}, which is about `backendNodeId` resolution, not the inventory read itself. */
  available: boolean;
  /** Present only when `available` is `false`. */
  unavailableReason?: MediaUnavailableReason;
}

/** Fixed, factual reason `MEDIA_SCRIPT`'s `Runtime.evaluate` could not be read (never a raw exception message, which is unbounded/page-influenced) — present only when {@link MediaReport.available} is `false`. */
export type MediaUnavailableReason = 'media-evaluate-returned-no-value' | 'media-evaluate-threw';

/** Fixed, factual reason `MEDIA_TOTAL_SCRIPT`'s cap-count read could not be trusted — present only when {@link MediaReport.totalCount}'s `available` is `false`. `media-total-not-attempted-primary-unavailable` covers the short-circuit case: the primary `MEDIA_SCRIPT` inventory itself failed, so `MEDIA_TOTAL_SCRIPT` was never even sent — distinct from `media-total-evaluate-returned-non-number`, where the read was sent but its result was unusable. */
export type MediaTotalCountUnavailableReason =
  | 'media-total-evaluate-returned-non-number'
  | 'media-total-not-attempted-primary-unavailable';

// ============================================================================
// computeObjectFitCrop — pure, directly unit-testable
// ============================================================================

function parsePercent(token: string | undefined): number | undefined {
  if (!token) return undefined;
  const match = /^(-?[\d.]+)%$/.exec(token);
  if (!match) return undefined;
  return Number(match[1]);
}

/**
 * Parses a CSS `object-position` value into `{posX, posY}` percentages, AXIS-AWARE: `left`/`right` only
 * ever set the horizontal axis and `top`/`bottom` only ever set the vertical axis, regardless of token
 * order, so `bottom left` and `left bottom` both resolve the same way. `center` and bare
 * percentage/length tokens fill whichever axis is still unassigned, in order (matches the common 1-2
 * token forms; the full 4-value `<edge-offset>` syntax isn't modeled). An axis left unspecified by any
 * token — including a single bare keyword like `left` (horizontal only) — defaults to 50%.
 */
function parseObjectPosition(objectPosition: string | null | undefined): { posX: number; posY: number } {
  const raw = (objectPosition ?? '').trim();
  const tokens = raw.split(/\s+/).filter(Boolean);

  let posX: number | undefined;
  let posY: number | undefined;
  const unassigned: string[] = [];

  for (const token of tokens) {
    if (token === 'left') posX = 0;
    else if (token === 'right') posX = 100;
    else if (token === 'top') posY = 0;
    else if (token === 'bottom') posY = 100;
    else unassigned.push(token);
  }

  for (const token of unassigned) {
    const pct = token === 'center' ? 50 : parsePercent(token);
    if (pct === undefined) continue;
    if (posX === undefined) posX = pct;
    else if (posY === undefined) posY = pct;
  }

  return { posX: posX ?? 50, posY: posY ?? 50 };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Computes `object-fit` crop/letterbox facts from natural (intrinsic) and
 * rendered (box) dimensions. Pure — no DOM, no CDP — directly testable.
 * Returns `null` when natural dimensions are unknown or zero (nothing to
 * compute a crop against).
 */
export function computeObjectFitCrop(
  natural: { w: number; h: number } | null,
  rendered: { w: number; h: number },
  objectFit: string | null | undefined,
  objectPosition: string | null | undefined,
): CropFact | null {
  if (!natural || !natural.w || !natural.h || !rendered.w || !rendered.h) return null;

  const fit = objectFit || 'fill';
  const effectiveMode =
    fit === 'scale-down' ? (natural.w <= rendered.w && natural.h <= rendered.h ? 'none' : 'contain') : fit;

  const { posX, posY } = parseObjectPosition(objectPosition);

  if (effectiveMode === 'cover') {
    const scale = Math.max(rendered.w / natural.w, rendered.h / natural.h);
    const scaledW = natural.w * scale;
    const scaledH = natural.h * scale;
    const cropW = (scaledW - rendered.w) / scale;
    const cropH = (scaledH - rendered.h) / scale;
    const cropLeft = cropW * (posX / 100);
    const cropTop = cropH * (posY / 100);
    return {
      mode: 'cover',
      croppedLeftPx: round(cropLeft),
      croppedRightPx: round(cropW - cropLeft),
      croppedTopPx: round(cropTop),
      croppedBottomPx: round(cropH - cropTop),
    };
  }

  if (effectiveMode === 'contain') {
    const scale = Math.min(rendered.w / natural.w, rendered.h / natural.h);
    const scaledW = natural.w * scale;
    const scaledH = natural.h * scale;
    const padW = rendered.w - scaledW;
    const padH = rendered.h - scaledH;
    const pillarLeft = padW * (posX / 100);
    const letterTop = padH * (posY / 100);
    return {
      mode: 'contain',
      letterboxTopPx: round(letterTop),
      letterboxBottomPx: round(padH - letterTop),
      pillarboxLeftPx: round(pillarLeft),
      pillarboxRightPx: round(padW - pillarLeft),
    };
  }

  if (effectiveMode === 'fill') {
    const naturalRatio = natural.w / natural.h;
    const renderedRatio = rendered.w / rendered.h;
    return { mode: 'fill', distorted: Math.abs(naturalRatio - renderedRatio) > 0.01 };
  }

  // 'none' (literal, or scale-down decided it behaves like none). No crop
  // numbers — reporting the effective behavior, not the raw CSS keyword,
  // is the more useful measurement fact here.
  return { mode: effectiveMode };
}

// ============================================================================
// In-page script
// ============================================================================

interface MediaFact {
  tag: string;
  cssPath: string;
  rect: Rect;
  visible: boolean | null;
  naturalWidth: number | null;
  naturalHeight: number | null;
  currentSrc: string | null;
  decodeState: string | null;
  poster: string | null;
  objectFit: string | null;
  objectPosition: string | null;
  /** MARK #62: `true` when the in-page `getComputedStyle(el)` call threw for this element. */
  styleUnavailable: boolean;
  /** MARK #63: `true` (svg only) when the in-page `el.viewBox.baseVal` read threw for this element. Absent (not set) for non-svg tags, mirroring how the in-page script only ever assigns it inside the `svg` branch. */
  intrinsicDimsUnavailable?: boolean;
  contextType: string | null;
  backingWidth: number | null;
  backingHeight: number | null;
  src: string | null;
  crossOrigin: boolean | null;
  dpr: number;
}

const MEDIA_SCRIPT = `/* __captureMediaInventory */
(function() {
  function cssPathFromBody(el) {
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth < 40) {
      var parent = node.parentElement;
      if (!parent) { parts.unshift(node.tagName.toLowerCase()); break; }
      var same = Array.prototype.filter.call(parent.children, function(c) { return c.tagName === node.tagName; });
      var idx = same.indexOf(node) + 1;
      parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + idx + ')');
      node = parent;
      depth++;
    }
    return parts.join(' > ');
  }

  var READY_STATE_LABELS = ['HAVE_NOTHING', 'HAVE_METADATA', 'HAVE_CURRENT_DATA', 'HAVE_FUTURE_DATA', 'HAVE_ENOUGH_DATA'];
  var dpr = window.devicePixelRatio;
  var els = document.querySelectorAll('img, video, canvas, svg, iframe');
  var out = [];

  for (var i = 0; i < els.length && out.length < ${MEDIA_MAX_ELEMENTS}; i++) {
    var el = els[i];
    var tag = el.tagName.toLowerCase();
    var rect = el.getBoundingClientRect();
    var cs = null;
    var styleUnavailable = false;
    try { cs = getComputedStyle(el); } catch (e) { styleUnavailable = true; }
    // MARK #62 (I-4/I-5): a failed getComputedStyle read must NOT be silently treated as "style
    // did not hide this element" -- that fabricates a visible/crop observation the style read never
    // actually produced. visible/objectFit/objectPosition/crop all go unavailable together, paired
    // with the explicit styleUnavailable marker below, rather than falling back to a rect-only guess.
    var visible = styleUnavailable ? null : (rect.width > 0 && rect.height > 0 && (!cs || (cs.visibility !== 'hidden' && cs.display !== 'none')));

    var record = {
      tag: tag,
      cssPath: cssPathFromBody(el),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      visible: visible,
      naturalWidth: null,
      naturalHeight: null,
      currentSrc: null,
      decodeState: null,
      poster: null,
      objectFit: cs ? cs.objectFit : null,
      objectPosition: cs ? cs.objectPosition : null,
      styleUnavailable: styleUnavailable,
      contextType: null,
      backingWidth: null,
      backingHeight: null,
      src: null,
      crossOrigin: null,
      dpr: dpr,
    };

    if (tag === 'img') {
      record.naturalWidth = el.naturalWidth || null;
      record.naturalHeight = el.naturalHeight || null;
      record.currentSrc = el.currentSrc || null;
      record.decodeState = el.complete ? 'complete' : 'loading';
    } else if (tag === 'video') {
      record.naturalWidth = el.videoWidth || null;
      record.naturalHeight = el.videoHeight || null;
      record.currentSrc = el.currentSrc || null;
      record.decodeState = READY_STATE_LABELS[el.readyState] || null;
      record.poster = el.poster || null;
    } else if (tag === 'canvas') {
      // No getContext(...) probe: the first call on a canvas creates and
      // permanently pins its context type, a page-observable side effect a
      // baseline collector must not cause (I-1/I-6). contextType stays null.
      record.backingWidth = el.width || null;
      record.backingHeight = el.height || null;
    } else if (tag === 'svg') {
      try {
        if (el.viewBox && el.viewBox.baseVal && (el.viewBox.baseVal.width || el.viewBox.baseVal.height)) {
          record.naturalWidth = el.viewBox.baseVal.width || null;
          record.naturalHeight = el.viewBox.baseVal.height || null;
        }
      } catch (e) {
        // MARK #63 (I-4/I-5): a thrown viewBox.baseVal read must not be indistinguishable from a
        // genuinely absent viewBox (naturalWidth/Height staying null either way) -- flag it explicitly.
        record.intrinsicDimsUnavailable = true;
      }
    } else if (tag === 'iframe') {
      record.src = el.getAttribute('src') || null;
      try {
        record.crossOrigin = el.contentDocument ? false : true;
      } catch (e) {
        record.crossOrigin = true;
      }
    }

    out.push(record);
  }
  return out;
})();`;

/** Cheap companion script: just the total match count, so the collector can report whether {@link MEDIA_MAX_ELEMENTS} truncated `MEDIA_SCRIPT`'s output without re-walking every element's box/computed-style. */
const MEDIA_TOTAL_SCRIPT = `/* __captureMediaTotal */
document.querySelectorAll('img, video, canvas, svg, iframe').length;`;

// ============================================================================
// Collector
// ============================================================================

/** Caps an optional page-controlled string (URL/selector/CSS keyword) through the shared `sanitizeString` length cap, preserving `null`. */
function sanitizeOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return sanitizeString(value);
}

/** Honest `{ backendNodeId, identityUnresolved }` pair for an element-bearing record — mirrors hittest.ts's `resolvedIdentity` helper (I-3/I-5, inlined locally per collector rather than imported/shared): a resolved identity carries just `backendNodeId`; an unresolved one carries `backendNodeId: null` + `identityUnresolved: true`, never a silently-omitted field. */
function resolvedIdentity(backendNodeId: number | undefined): { backendNodeId: number | null; identityUnresolved?: true } {
  return backendNodeId === undefined ? { backendNodeId: null, identityUnresolved: true } : { backendNodeId };
}

export const collectMedia: Collector = async (ctx) => {
  const { client } = ctx;

  // I-5: a missing `value` (the eval failed/returned nothing) is currently coerced into an empty
  // inventory, indistinguishable from a genuinely media-free page unless the failure itself is
  // surfaced as an explicit report-level fact. DISTINCT from `identity` below, which is about
  // backendNodeId resolution, not this inventory read.
  let facts: MediaFact[];
  let available = true;
  let unavailableReason: MediaUnavailableReason | undefined;
  try {
    const evalResponse = (await client.send('Runtime.evaluate', {
      expression: MEDIA_SCRIPT,
      returnByValue: true,
    })) as { result?: { value?: MediaFact[] } };
    const value = evalResponse.result?.value;
    if (value === undefined) {
      facts = [];
      available = false;
      unavailableReason = 'media-evaluate-returned-no-value';
    } else {
      facts = value;
    }
  } catch {
    facts = [];
    available = false;
    unavailableReason = 'media-evaluate-threw';
  }

  let elementsTruncated: number | undefined;
  let documentNodeId: number | undefined;
  let identity: MediaReport['identity'] = { available: true };
  // I-5: a missing/non-numeric `MEDIA_TOTAL_SCRIPT` result is a FAILED cap-count read, not the
  // fact "the page had exactly `facts.length` elements" — coercing it to `facts.length` would
  // silently suppress `elementsTruncated` and over-claim the kept elements as an exhaustive
  // enumeration. Surface the failure explicitly instead (mirrors `identity` below). Defaults to
  // unavailable/not-attempted here: when `available` is false the `if (available)` block below
  // never runs and this default is what ships, so it must NOT be a success-shaped `facts.length`
  // guess (facts is already the synthetic empty-failure array in that case) — every path that
  // actually reads `MEDIA_TOTAL_SCRIPT` overwrites this before the report is written.
  let totalCount: MediaReport['totalCount'] = {
    available: false,
    reason: 'media-total-not-attempted-primary-unavailable',
  };
  let resolved: Array<{ backendNodeId?: number } | undefined> = [];

  // The primary inventory read failed — short-circuit to the unavailable report rather than
  // spending further CDP round trips (total count, identity resolution) on an already-empty facts set.
  if (available) {
    const totalResponse = (await client.send('Runtime.evaluate', {
      expression: MEDIA_TOTAL_SCRIPT,
      returnByValue: true,
    })) as { result?: { value?: number } };
    const totalValue = totalResponse.result?.value;
    if (typeof totalValue === 'number') {
      totalCount = { available: true, total: totalValue };
      elementsTruncated = totalValue > MEDIA_MAX_ELEMENTS ? totalValue - MEDIA_MAX_ELEMENTS : undefined;
    } else {
      totalCount = { available: false, reason: 'media-total-evaluate-returned-non-number' };
      // elementsTruncated stays undefined here too — but that now means "unknown", not "none",
      // because `totalCount.available === false` tells a downstream reader not to trust the absence.
    }

    try {
      const docResponse = (await client.send('DOM.getDocument', { depth: 0 })) as { root?: { nodeId: number } };
      documentNodeId = docResponse.root?.nodeId;
      if (documentNodeId === undefined) {
        identity = { available: false, reason: 'dom-getdocument-unavailable' };
      }
    } catch {
      documentNodeId = undefined;
      identity = { available: false, reason: 'dom-getdocument-unavailable' };
    }

    if (documentNodeId !== undefined) {
      try {
        resolved = await resolveNodeIds(client, documentNodeId, facts.map((f) => f.cssPath));
      } catch {
        resolved = facts.map(() => undefined);
        identity = { available: false, reason: 'resolve-node-ids-failed' };
      }
    } else {
      resolved = facts.map(() => undefined);
    }
  }

  const elements: MediaElementRecord[] = facts.map((fact, index) => {
    const natural =
      fact.naturalWidth !== null && fact.naturalHeight !== null ? { w: fact.naturalWidth, h: fact.naturalHeight } : null;
    const intrinsicAspectRatio = natural && natural.w > 0 && natural.h > 0 ? natural.w / natural.h : null;
    // MARK #62: when the style read failed, objectFit/objectPosition are unknown (not "unset, so
    // treat as fill") -- computeObjectFitCrop's `objectFit || 'fill'` fallback would otherwise
    // fabricate a 'fill' crop from real intrinsic/rendered dimensions using a guessed mode never
    // actually observed. Withhold the crop entirely rather than guess.
    const crop = fact.styleUnavailable
      ? null
      : computeObjectFitCrop(natural, { w: fact.rect.width, h: fact.rect.height }, fact.objectFit, fact.objectPosition);

    return {
      id: `m-${index}`,
      selector: fact.cssPath ? sanitizeString(fact.cssPath) : '',
      ...resolvedIdentity(resolved[index]?.backendNodeId),
      tag: fact.tag,
      rect: fact.rect,
      visible: fact.visible,
      naturalWidth: fact.naturalWidth,
      naturalHeight: fact.naturalHeight,
      renderedWidth: fact.rect.width,
      renderedHeight: fact.rect.height,
      devicePixelRatio: fact.dpr,
      currentSrc: sanitizeOptional(fact.currentSrc),
      decodeState: fact.decodeState,
      intrinsicAspectRatio,
      objectFit: sanitizeOptional(fact.objectFit),
      objectPosition: sanitizeOptional(fact.objectPosition),
      crop,
      styleUnavailable: fact.styleUnavailable || undefined,
      intrinsicDimsUnavailable: fact.intrinsicDimsUnavailable || undefined,
      contextType: fact.contextType,
      backingWidth: fact.backingWidth,
      backingHeight: fact.backingHeight,
      poster: fact.tag === 'video' ? sanitizeOptional(fact.poster) : undefined,
      src: fact.tag === 'iframe' ? sanitizeOptional(fact.src) : undefined,
      crossOrigin: fact.tag === 'iframe' ? fact.crossOrigin : undefined,
    };
  });

  ctx.write.json('media.json', {
    elements,
    elementsTruncated,
    totalCount,
    coverage: { scope: 'top-document' },
    identity,
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
  } satisfies MediaReport);
};
