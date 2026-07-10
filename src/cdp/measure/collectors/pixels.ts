/**
 * `pixels.json` collector — per-element raster crops, written ONLY when
 * `--pixels` was requested (`ctx.pixels`); otherwise this is a no-op (no
 * file written). Owned by U11. A `mutating`-phase collector: it forces the
 * page background transparent (and restores it) for its alpha sample, so
 * `snapshot.ts` runs it serialized, AFTER the baseline `screenshot.png` +
 * `dom.html` are already captured.
 *
 * Drives its own quad-derived element geometry by reading `DOM.getContentQuads`
 * directly (see `readContentQuads`) rather than reading `geometry.json`, which
 * may not exist when this collector runs. Clipping always derives from real CDP
 * content quads, never `getBoundingClientRect()`.
 *
 * Rather than one `Page.captureScreenshot` CDP round-trip per element, this
 * takes exactly two full-page screenshots — one with the page's normal
 * background (source of the crop pixels + color/hash facts) and one with
 * `Emulation.setDefaultBackgroundColorOverride` forced fully transparent
 * (source of the alpha/visible-pixel facts, since only truly-unpainted
 * pixels come back transparent) — then crops both raster buffers in memory
 * per element. The transparent override is always restored: on the normal
 * success path after the transparent capture, and on the failure path in a
 * `catch` that restores the override and still emits `pixels.json` carrying
 * the `backgroundOverrideRestored` fact (with `captureFailed: true`) BEFORE
 * re-throwing, so a screenshot failure never propagates with the override
 * left set and the restoration outcome silently lost. The baseline
 * `screenshot.png` is captured BEFORE this collector runs, so that artifact
 * is already isolated from this collector's background override.
 *
 * Enumeration scope: this collector walks ONLY the top document's light DOM
 * (`DOM.getDocument({pierce:false})` + `querySelectorAll('*')`). Iframe and
 * shadow-DOM subtrees are not enumerated, so their elements are absent from
 * `elements` — an absence of coverage, not a measured absence of pixels.
 * This is emitted as the explicit `scope` fact on `pixels.json` so a reader
 * treats those omissions as out-of-scope rather than as negative findings.
 *
 * Off-quad masking: an element's crop rect is the axis-aligned union of its
 * content quads, but the pixels between/around rotated or disjoint quads do
 * NOT belong to the element. Every derived fact (hash/color/alpha/visible)
 * is computed over ONLY the pixels whose center falls inside a content quad,
 * and off-mask pixels are written transparent in the crop PNG, so a rotated
 * or multi-fragment element's facts are not contaminated by the background
 * or neighbors sitting inside its bounding box.
 *
 * Ancestor-clip masking: an element's own content quads are its full layout
 * box regardless of visual clipping — a child inside an `overflow:hidden` /
 * `clip`/`clip-path` ancestor still reports its whole unclipped quad via
 * `DOM.getContentQuads`. Before any metric or crop pixel is derived, each
 * element's crop rect is intersected with its effective ANCESTOR CLIP BOUNDING
 * RECT, and its per-pixel mask is further constrained by any exact ancestor
 * CLIP SHAPES — both computed page-side, per element, by
 * {@link computeAncestorClip} walking the live ancestor chain. Every
 * clipping ancestor (`overflow-x`/`overflow-y` clipping, or a `clip-path`)
 * contributes to a running bounding-rect intersection; in addition:
 *   - `clip-path: inset(...)` resolves to an exact rect (folded into the
 *     bounding rect directly — no separate shape needed).
 *   - `clip-path: circle(...)` / `ellipse(...)` / `polygon(...)` resolve to
 *     an exact shape (reference box, %/px/keyword radii,
 *     `closest-side`/`farthest-side`, polygon vertices — nonzero/evenodd
 *     fill rule) that every candidate pixel is tested against in
 *     {@link pointInClipShape}, in addition to the bounding-rect
 *     intersection (which uses the shape's own bbox as a fast pre-filter).
 *   - Every length/percentage token fed into the shape math above — `inset()`
 *     edges, `circle()`/`ellipse()` radii and center positions, `polygon()`
 *     vertices — is resolved through a single `calc()`-aware evaluator
 *     (`resolveLength`/`evalCalcExpr`), because computed style does not
 *     preserve authored edge-offset keywords: e.g. authored
 *     `circle(20px at right 10px bottom 10px)` computes to
 *     `circle(20px at calc(100% - 10px) calc(100% - 10px))`, and only a
 *     `calc()`-aware parse resolves that back to exact geometry.
 *   - `clip-path: path(...)` / `url(...)` (any other clip-path form this
 *     collector doesn't recognize), OR a recognized `inset()`/`circle()`/
 *     `ellipse()`/`polygon()` whose arguments contain a token the evaluator
 *     genuinely cannot resolve (e.g. `var()`, viewport units, or any other
 *     `calc()` operand outside the plain px/%/number grammar), CANNOT be
 *     resolved to exact per-pixel geometry. Rather than silently treating
 *     the ancestor's full bounding box as the clip, or silently defaulting
 *     an unresolvable token to a guessed value (contaminating every derived
 *     fact with wrong or unclipped pixels — the bug this masking scheme
 *     replaces), every such case is handled explicitly and honestly through
 *     the SAME single fallback: the ancestor's own bounding rect is still
 *     used as a conservative bound, but `approximate: true` is threaded
 *     through to the element's `ancestorClipApproximate` fact, and
 *     `ancestorClipped` is forced `true` regardless of whether the bounding
 *     rect actually shrank — so a reader is told the mask for that element
 *     is a best-effort bound, never mistaken for an exact one. There is no
 *     second/lenient parser: a token either resolves exactly through this
 *     one evaluator, or the whole ancestor clip is marked approximate.
 *
 * This all runs BEFORE `clampRectToPixels` and `buildQuadMask`, so pixels
 * outside the visible clip never enter the crop, the mask, or any derived
 * fact — they are excluded, not merely masked transparent after the fact.
 * `ancestorClipped` states whether any ancestor clip constrains this
 * element at all (bounding-rect shrink, an exact shape, OR an approximate
 * clip) — note a circle/ellipse/polygon inscribed entirely within its own
 * ancestor's bounding box leaves the bounding rect UNCHANGED even though it
 * removes real pixels, so `ancestorClipped` must NOT be inferred from rect
 * shrinkage alone.
 */

import { PNG } from 'pngjs';

import type { CDPClient } from '../../client.js';
import { axisAlignedRectFromQuad, type Rect, type Quad } from '../../coordinates.js';
import { sanitizeString, sanitizeFilenameSlug } from '../redaction.js';
import type { Collector } from '../types.js';

/**
 * Defensive cap on how many elements this collector will crop for a single
 * snapshot. Never silent (I-5): `pixels.json` always carries `elementsTotal`
 * (the full enumerated count, before slicing — already known for free) and
 * `elementsTruncated` (`true` when the cap actually dropped elements).
 * Separately, `elementsSkipped` counts enumerated-but-uncroppable elements
 * dropped by the 4 per-element `continue` sites below (no layout box, a
 * fully ancestor-clipped rect, an off-viewport pixel rect, or a fully
 * off-mask element) — a distinct concern from the enumeration cap. And
 * separately again, `elementsReadFailed` counts a DIFFERENT thing from both:
 * a per-element `DOM.getContentQuads` read that genuinely THREW (a real CDP
 * protocol failure), which is never folded into `elementsSkipped` — a real
 * no-layout-box element resolves that same call cleanly with an honest empty
 * array (see {@link readContentQuads}), so a throw can only mean the read
 * itself failed, and coercing it into the same silent skip a genuinely
 * uncroppable element gets would hide a real failure as "nothing to crop
 * here" (I-5).
 */
const MAX_ELEMENTS = 2000;

/**
 * Factual enumeration-scope descriptor emitted on `pixels.json`. States, in
 * measurement-only terms, exactly what this collector's element walk did and
 * did not cover: the top document's light DOM only, no iframe content and no
 * shadow-DOM subtrees (`DOM.getDocument({pierce:false})`). Absent iframe /
 * shadow-DOM elements are therefore out-of-scope, not measured-absent.
 */
const PIXELS_SCOPE = {
  enumeration: 'top-document-light-dom',
  pierce: false,
  includesIframeContent: false,
  includesShadowDom: false,
} as const;

/** Fixed, factual reason the page-side viewport CSS-size read could not be used as the pixel-scale basis — present only when {@link ViewportScaleFact.available} is `false`. */
type ViewportScaleUnavailableReason = 'viewport-read-unavailable' | 'capture-failed';

/**
 * The scale basis (`scaleX`/`scaleY` = screenshot px / CSS px) used to turn
 * every element's CSS-pixel rect into the crop/mask pixel geometry that
 * every color/hash/alpha fact in `elements` is derived from. Normally
 * `scaleX`/`scaleY` come from a genuine `window.innerWidth`/`innerHeight`
 * page-side read (`available: true`). When that read resolves without a
 * usable value (missing/zero/non-numeric — see `readViewportCssSize`), the
 * screenshot's own pixel dimensions are used as a same-size stand-in so the
 * collector can still produce crops — but that stand-in is only a correct
 * scale basis when `devicePixelRatio` happens to be 1. Silently presenting
 * it as a resolved CSS size would fabricate an exact-looking scale for
 * every downstream measurement (I-4) with no signal that it never happened
 * (I-5); `available: false` + `unavailableReason` is that signal, always
 * present alongside the (now explicitly approximate) `scaleX`/`scaleY` a
 * reader would otherwise trust as exact.
 */
interface ViewportScaleFact {
  readonly available: boolean;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly scaleX: number;
  readonly scaleY: number;
  /** Present only when `available` is `false`. */
  readonly unavailableReason?: ViewportScaleUnavailableReason;
}

/** Perceptual-hash grid size (8x8 -> 64-bit average hash). */
const HASH_GRID = 8;
/** Color-quantization bucket width (0-255) used to find the dominant color. */
const DOMINANT_BUCKET = 16;

interface RGBColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** A raw, already-cropped RGBA pixel buffer (row-major, 4 bytes/pixel). */
interface RawImage {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
}

interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A per-pixel inclusion mask over a crop, in the crop's own row-major pixel
 * order (`data[row * width + col]`): `1` where the pixel center lies inside
 * one of the element's content quads, `0` where it does not. `count` is the
 * number of on-mask pixels — the denominator for every masked metric.
 */
interface Mask {
  readonly data: Uint8Array;
  readonly count: number;
}

interface PixelElementRecord {
  readonly id: string;
  /** `null` (never an omitted key) when this element's identity did not resolve — see {@link identityUnresolved}. Mirrors `hittest.ts`'s `HitTestElementSample.backendNodeId` shape (I-3). */
  readonly backendNodeId: number | null;
  /** `true` when {@link backendNodeId} is `null` because `DOM.describeNode` failed/omitted it for this element. Absent (not `false`) when identity resolved. */
  readonly identityUnresolved?: boolean;
  readonly selector?: string;
  /** Effective crop rect: the axis-aligned union of the content quads, intersected with the element's ancestor clip rect (if any) — in top-viewport CSS-pixel space (same space as `geometry.json` rects). Equal to the unclipped quad union when no ancestor clips this element. */
  readonly rect: Rect;
  /** `true` when any ancestor `overflow`/`clip-path` clip constrains this element at all — a bounding-rect shrink, an exact circle/ellipse/polygon shape (which can clip real pixels without changing the bounding rect), or an approximate (`path()`/`url()`) clip. See the module doc for why this is not just "did the rect shrink". */
  readonly ancestorClipped: boolean;
  /** `true` when an ancestor's `clip-path` uses a shape this collector cannot resolve to exact per-pixel geometry (`path()`, `url()`, or any other unrecognized form) — the emitted rect/mask are only a conservative bounding-box approximation for that ancestor, not an exact clip. Always `false` when `ancestorClipped` is `false`. */
  readonly ancestorClipApproximate: boolean;
  /**
   * `true` when the per-element ancestor-clip walk (`DOM.resolveNode` +
   * `Runtime.callFunctionOn`) genuinely failed to run for this element —
   * see {@link AncestorClipInfo.unavailable}. When set, `ancestorClipped`/
   * `ancestorClipApproximate` above read `false` ONLY because the walk
   * never produced a result, not because ancestors were checked and found
   * not to clip — a reader must not treat this element as provably
   * unclipped. Absent (not `false`) when the walk ran.
   */
  readonly ancestorClipUnavailable?: true;
  /** Present only when {@link ancestorClipUnavailable} is `true`. */
  readonly ancestorClipUnavailableReason?: AncestorClipUnavailableReason;
  /** Id-relative crop path: `{snapId}/crops/<file>.png` — same grammar as `check`'s `{snapId}/findings/<file>.png`. */
  readonly crop: string;
  /** Fraction (0-1) of the crop's bounding-box pixels that actually fall inside a content quad (the rest are masked out of every fact below and written transparent). */
  readonly maskedPixelFraction: number;
  /** 64-bit average-hash (aHash) of the on-mask crop pixels, as 16 hex chars — a stable perceptual hash. */
  readonly hash: string;
  readonly avgColor: RGBColor;
  readonly medianColor: RGBColor;
  readonly dominantColor: RGBColor;
  /** Mean alpha (0-1) over the on-mask pixels, sampled with the page background forced transparent. */
  readonly alphaFraction: number;
  /** Fraction (0-1) of on-mask pixels with any paint at all (alpha > 0), same transparent sample. */
  readonly visiblePixelFraction: number;
}

export const collectPixels: Collector = async (ctx) => {
  if (!ctx.pixels) return;

  const { client } = ctx;

  const normalPng = await captureFullPagePng(client);

  await client.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  let backgroundOverrideRestored = false;
  const restoreBackgroundOverride = async (): Promise<void> => {
    try {
      await client.send('Emulation.setDefaultBackgroundColorOverride', {});
      backgroundOverrideRestored = true;
    } catch {
      backgroundOverrideRestored = false;
    }
  };

  let transparentPng: PNG;
  try {
    transparentPng = await captureFullPagePng(client);
  } catch (err) {
    // The transparent screenshot (or its decode) failed. Restore the
    // override regardless, then emit `pixels.json` carrying the restoration
    // fact BEFORE re-throwing — otherwise the failure would propagate with
    // no artifact and the restoration outcome would be silently lost.
    // `captureFailed` records that no per-element crops were produced.
    await restoreBackgroundOverride();
    ctx.write.json('pixels.json', {
      scope: PIXELS_SCOPE,
      elements: [],
      backgroundOverrideRestored,
      captureFailed: true,
      elementsTotal: 0,
      elementsTruncated: false,
      elementsSkipped: 0,
      elementsReadFailed: 0,
      // The capture failed before the viewport-scale read was even
      // attempted — there is no scale basis to report, honest or otherwise.
      viewportScale: { available: false, innerWidth: 0, innerHeight: 0, scaleX: 1, scaleY: 1, unavailableReason: 'capture-failed' },
    });
    throw err;
  }
  await restoreBackgroundOverride();

  const viewportRead = await readViewportCssSize(client, normalPng.width, normalPng.height);
  const { innerWidth, innerHeight } = viewportRead;
  const scaleX = innerWidth > 0 ? normalPng.width / innerWidth : 1;
  const scaleY = innerHeight > 0 ? normalPng.height / innerHeight : 1;
  // Surfaces the scale basis honestly (I-4/I-5): when the page-side read
  // returned no usable value, `scaleX`/`scaleY` above are only a same-size
  // (devicePixelRatio-1) approximation — `available: false` tells a reader
  // every crop-geometry/color fact below rests on that approximation rather
  // than a genuine measured CSS viewport size.
  const viewportScale: ViewportScaleFact = {
    available: viewportRead.available,
    innerWidth,
    innerHeight,
    scaleX: round3(scaleX),
    scaleY: round3(scaleY),
    ...(viewportRead.available ? {} : { unavailableReason: 'viewport-read-unavailable' as const }),
  };

  const allNodeIds = await enumerateElementNodeIds(client);
  const nodeIds = allNodeIds.slice(0, MAX_ELEMENTS);
  const elementsTotal = allNodeIds.length;
  const elementsTruncated = elementsTotal > nodeIds.length;
  const described = await Promise.all(nodeIds.map((nodeId) => describeElementForCrop(client, nodeId)));

  const elements: PixelElementRecord[] = [];
  let index = 0;
  let elementsSkipped = 0;
  let elementsReadFailed = 0;

  for (const outcome of described) {
    if (outcome.kind === 'read-failed') {
      elementsReadFailed += 1;
      continue;
    }
    if (outcome.kind === 'uncroppable') {
      elementsSkipped += 1;
      continue;
    }
    const entry = outcome.element;
    const clipRect = entry.clipInfo.rect;
    const effectiveRect = clipRect ? intersectRect(entry.rect, clipRect) : entry.rect;
    if (effectiveRect.width <= 0 || effectiveRect.height <= 0) {
      elementsSkipped += 1;
      continue;
    }
    const rectShrunk =
      clipRect !== null &&
      (effectiveRect.x !== entry.rect.x ||
        effectiveRect.y !== entry.rect.y ||
        effectiveRect.width !== entry.rect.width ||
        effectiveRect.height !== entry.rect.height);
    // A circle/ellipse/polygon shape (or an approximate path()/url() clip)
    // can remove real pixels without ever shrinking the bounding rect (e.g.
    // a circle inscribed entirely within its own ancestor's box) — so
    // `ancestorClipped` must also fire on those, not just on rect shrinkage.
    const ancestorClipped = rectShrunk || entry.clipInfo.shapes.length > 0 || entry.clipInfo.approximate;

    const pixelRect = clampRectToPixels(effectiveRect, scaleX, scaleY, normalPng.width, normalPng.height);
    if (!pixelRect) {
      elementsSkipped += 1;
      continue;
    }

    const mask = buildQuadMask(pixelRect, entry.quads, scaleX, scaleY, entry.clipInfo.shapes);
    if (mask.count === 0) {
      elementsSkipped += 1;
      continue;
    }

    const normalCrop = cropPixels(normalPng, pixelRect);
    const transparentCrop = cropPixels(transparentPng, pixelRect);

    const cropFilename = `crops/${cropFileBase(index, entry)}.png`;
    ctx.write.binary(cropFilename, encodePng(applyMaskTransparent(normalCrop, mask)));

    elements.push({
      id: `px-${index}`,
      backendNodeId: entry.backendNodeId,
      ...(entry.identityUnresolved ? { identityUnresolved: true as const } : {}),
      ...(entry.selector !== undefined ? { selector: entry.selector } : {}),
      rect: effectiveRect,
      ancestorClipped,
      ancestorClipApproximate: entry.clipInfo.approximate,
      ...(entry.clipInfo.unavailable
        ? { ancestorClipUnavailable: true as const, ancestorClipUnavailableReason: entry.clipInfo.unavailableReason }
        : {}),
      crop: `${ctx.snapId}/${cropFilename}`,
      maskedPixelFraction: round3(mask.count / (pixelRect.width * pixelRect.height)),
      hash: averageHash(normalCrop, mask),
      avgColor: averageColor(normalCrop, mask),
      medianColor: medianColor(normalCrop, mask),
      dominantColor: dominantColor(normalCrop, mask),
      alphaFraction: alphaFraction(transparentCrop, mask),
      visiblePixelFraction: visiblePixelFraction(transparentCrop, mask),
    });
    index += 1;
  }

  ctx.write.json('pixels.json', {
    scope: PIXELS_SCOPE,
    elements,
    backgroundOverrideRestored,
    captureFailed: false,
    elementsTotal,
    elementsTruncated,
    elementsSkipped,
    elementsReadFailed,
    viewportScale,
  });
};

// ============================================================================
// CDP-facing helpers
// ============================================================================

async function captureFullPagePng(client: CDPClient): Promise<PNG> {
  const shot = (await client.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
  return PNG.sync.read(Buffer.from(shot.data, 'base64'));
}

async function readViewportCssSize(
  client: CDPClient,
  fallbackWidth: number,
  fallbackHeight: number,
): Promise<{ innerWidth: number; innerHeight: number; available: boolean }> {
  const response = (await client.send('Runtime.evaluate', {
    expression: '({w: window.innerWidth, h: window.innerHeight})',
    returnByValue: true,
  })) as { result?: { value?: { w?: number; h?: number } } };
  const w = response.result?.value?.w;
  const h = response.result?.value?.h;
  if (typeof w === 'number' && w > 0 && typeof h === 'number' && h > 0) {
    return { innerWidth: w, innerHeight: h, available: true };
  }
  // The page-side read resolved but returned no usable value (missing,
  // zero, or non-numeric). The screenshot's own pixel dimensions are
  // returned as a same-size stand-in so the caller can still produce crops,
  // but `available: false` tells the caller this is NOT a measured CSS
  // size — it must not be presented as an exact scale basis (I-4/I-5).
  return { innerWidth: fallbackWidth, innerHeight: fallbackHeight, available: false };
}

async function enumerateElementNodeIds(client: CDPClient): Promise<number[]> {
  const doc = (await client.send('DOM.getDocument', { depth: -1, pierce: false })) as { root: { nodeId: number } };
  const result = (await client.send('DOM.querySelectorAll', {
    nodeId: doc.root.nodeId,
    selector: '*',
  })) as { nodeIds: number[] };
  return result.nodeIds;
}

interface DescribedElement {
  /** Axis-aligned union of the content quads, in top-viewport CSS-pixel space (unclipped by ancestors). */
  readonly rect: Rect;
  /** The original content quads (preserved, not collapsed to `rect`), used to mask off-quad pixels. */
  readonly quads: readonly Quad[];
  readonly selector?: string;
  readonly tag?: string;
  /** `null` (never an omitted key) when `DOM.describeNode` failed to resolve this element's identity — see {@link identityUnresolved}. */
  readonly backendNodeId: number | null;
  /** `true` when {@link backendNodeId} is `null` because `DOM.describeNode` threw or omitted `backendNodeId` from its response. Absent (not `false`) when identity resolved. */
  readonly identityUnresolved?: boolean;
  /** Ancestor-clip info (viewport CSS-pixel space): bounding-rect intersection, exact shapes, and the honest approximate flag. See {@link computeAncestorClip}. */
  readonly clipInfo: AncestorClipInfo;
}

/** A circle resolved from `clip-path: circle(...)`, in absolute viewport CSS-pixel space. */
interface ClipShapeCircle {
  readonly type: 'circle';
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** An ellipse resolved from `clip-path: ellipse(...)`, in absolute viewport CSS-pixel space. */
interface ClipShapeEllipse {
  readonly type: 'ellipse';
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

/** A polygon resolved from `clip-path: polygon(...)`: a flat `[x1,y1,x2,y2,...]` vertex list in absolute viewport CSS-pixel space, plus its fill rule. */
interface ClipShapePolygon {
  readonly type: 'polygon';
  readonly points: readonly number[];
  readonly fillRule: 'nonzero' | 'evenodd';
}

type ClipShape = ClipShapeCircle | ClipShapeEllipse | ClipShapePolygon;

/** Fixed, factual reason the per-element ancestor-clip walk (`DOM.resolveNode` + `Runtime.callFunctionOn`) genuinely failed to run — present only when {@link AncestorClipInfo.unavailable} is `true`. */
type AncestorClipUnavailableReason = 'resolve-node-no-object-id' | 'call-function-no-value' | 'resolve-or-call-threw';

/**
 * Everything {@link computeAncestorClip}'s page-side ancestor walk resolves
 * for one element:
 *  - `rect`: the running intersection of every clipping ancestor's own
 *    bounding rect (`overflow` clips, exact `inset()` rects, and — as a
 *    conservative pre-filter, never a substitute for the shape test below —
 *    each circle/ellipse/polygon's own bbox and each approximate clip's
 *    ancestor box). `null` when no ancestor clips this element at all.
 *  - `shapes`: exact circle/ellipse/polygon constraints a candidate pixel
 *    must ALSO satisfy (in addition to `rect` and the element's own quads).
 *    Multiple ancestors each contribute their own shape; a pixel must fall
 *    inside every one (nested clips intersect).
 *  - `approximate`: `true` if any ancestor's `clip-path` could not be
 *    resolved to exact geometry (`path()`, `url()`, or any other
 *    unrecognized clip-path form) — that ancestor's contribution to `rect`
 *    is only a conservative bound, never exact.
 *  - `unavailable`/`unavailableReason`: `true` when {@link computeAncestorClip}
 *    could NOT complete the walk at all (`DOM.resolveNode` resolved without
 *    an `objectId`, `Runtime.callFunctionOn` resolved without `result.value`,
 *    or either call threw) — distinct from a genuine "no ancestor clips this
 *    element" result, which reaches this SAME `{rect:null,shapes:[],
 *    approximate:false}` shape through a walk that actually ran and found
 *    nothing. Absent (not `false`) when the walk ran (successfully or not).
 */
interface AncestorClipInfo {
  readonly rect: Rect | null;
  readonly shapes: readonly ClipShape[];
  readonly approximate: boolean;
  readonly unavailable?: true;
  /** Present only when {@link unavailable} is `true`. */
  readonly unavailableReason?: AncestorClipUnavailableReason;
}

/**
 * Fixed, factual reason {@link describeElementForCrop} could not produce a
 * croppable element — the discriminant every caller must branch on instead
 * of collapsing both cases into the same `null`/skip:
 *  - `'described'`: the element has a real layout box and identity/clip
 *    resolution ran (possibly with their own honest per-field failure
 *    markers — see {@link DescribedElement}).
 *  - `'uncroppable'`: the per-element `DOM.getContentQuads` read
 *    genuinely SUCCEEDED and reported nothing to crop — a real
 *    no-layout-box node (`display:none`, `<head>`/`<script>`/`<style>`, a
 *    detached node) resolves that call cleanly with an honest empty quad
 *    array (see {@link readContentQuads}), or the quads it did return
 *    union to a zero-area rect. This is a genuine observation, not a
 *    failure — no marker is warranted.
 *  - `'read-failed'`: the `DOM.getContentQuads` read itself THREW — a real
 *    CDP protocol failure, never the shape a genuinely boxless element
 *    produces. Coercing this into the same silent skip as `'uncroppable'`
 *    would hide a real read failure as "nothing to crop here" (I-5); the
 *    caller counts this into the distinct `elementsReadFailed` fact.
 */
type DescribeOutcome =
  | { readonly kind: 'described'; readonly element: DescribedElement }
  | { readonly kind: 'uncroppable' }
  | { readonly kind: 'read-failed' };

/** Same 8-number validation as `../../coordinates.js`'s private `asQuad` — reimplemented locally because this file needs `DOM.getContentQuads`'s raw quads read independently of `DOM.getBoxModel` (see {@link readContentQuads}'s doc comment for why, and note `../../coordinates.js`'s combined `getContentQuadBox` is deliberately NOT used here). */
function quadFromPoints(points: number[]): Quad {
  if (points.length !== 8) {
    throw new Error(`Expected an 8-number quad (x1,y1,x2,y2,x3,y3,x4,y4), got ${points.length} numbers`);
  }
  return points as Quad;
}

/**
 * Reads ONLY `DOM.getContentQuads` for one node — deliberately NOT the
 * combined `getContentQuadBox` from `../../coordinates.js` (whose
 * `DOM.getBoxModel` half this collector never uses anyway: only the quads
 * feed `rect`/masking here). Empirically confirmed against real Chrome
 * (the identical finding `geometry.ts`'s `readContentQuads` documents): a
 * genuinely boxless node (`display:none`, `<head>`/`<script>`/`<style>`, a
 * detached node) makes `DOM.getContentQuads` resolve normally with a real,
 * honest EMPTY array — never throw — while `DOM.getBoxModel` throws
 * "Could not compute box model" for that SAME node. Had this collector kept
 * reading both together (the pre-fix behavior), every genuinely boxless
 * element would throw via the `getBoxModel` half and be indistinguishable
 * from an actual quads-read failure. Calling `DOM.getContentQuads` alone
 * means a throw here can only mean the quad read itself genuinely failed
 * (invalid/detached node reference, a protocol error) — never that the
 * element has no layout box, which always surfaces as a clean empty array
 * instead. Callers must let a throw here propagate as a genuine per-element
 * read failure (`DescribeOutcome.kind === 'read-failed'`, I-4/I-5), not
 * degrade it to the same shape a real empty result produces.
 */
async function readContentQuads(client: CDPClient, nodeId: number): Promise<Quad[]> {
  const res = (await client.send('DOM.getContentQuads', { nodeId })) as { quads: number[][] };
  return res.quads.map(quadFromPoints);
}

/**
 * Fetches one node's content quads, a best-effort selector, and identity
 * (`backendNodeId`). Returns a {@link DescribeOutcome} distinguishing three
 * cases (see its own doc comment): a real described element, a genuinely
 * uncroppable one (no layout box / zero-area union — an honest observation,
 * silently skipped by the caller), or a genuine `DOM.getContentQuads` read
 * failure (marked, never silently skipped). Identity resolution never
 * drops the element on its own failure: a `DOM.describeNode`
 * failure/omission just leaves `backendNodeId: null` + `identityUnresolved:
 * true` on the returned record instead of silently omitting the field
 * (I-3).
 */
async function describeElementForCrop(client: CDPClient, nodeId: number): Promise<DescribeOutcome> {
  let quads: Quad[];
  try {
    quads = await readContentQuads(client, nodeId);
  } catch {
    return { kind: 'read-failed' };
  }
  if (quads.length === 0) return { kind: 'uncroppable' };

  const rect = unionRect(quads.map(axisAlignedRectFromQuad));
  if (rect.width <= 0 || rect.height <= 0) return { kind: 'uncroppable' };

  let selector: string | undefined;
  let tag: string | undefined;
  let backendNodeId: number | null = null;
  let identityUnresolved = false;
  try {
    const described = (await client.send('DOM.describeNode', { nodeId })) as {
      node?: { nodeName?: string; backendNodeId?: number; attributes?: string[] };
    };
    if (typeof described.node?.backendNodeId === 'number') {
      backendNodeId = described.node.backendNodeId;
    } else {
      // `DOM.describeNode` resolved but the response omitted `backendNodeId` —
      // identity did not resolve even though nothing threw. Never let this
      // fall through as a silently-omitted field (I-3): mark it explicitly.
      identityUnresolved = true;
    }
    tag = described.node?.nodeName?.toLowerCase();
    selector = buildSelector(described.node?.nodeName, described.node?.attributes);
  } catch {
    // `DOM.describeNode` failure means identity could not be resolved for
    // this element. The rect/crop are still valid without a selector, but
    // `backendNodeId` stays `null` (never omitted) and `identityUnresolved`
    // is set so a downstream join never mistakes this for a resolved record
    // (I-3, mirroring hittest.ts's `identityUnresolved` shape).
    identityUnresolved = true;
  }

  const clipInfo = await computeAncestorClip(client, nodeId);

  return { kind: 'described', element: { rect, quads, selector, tag, backendNodeId, identityUnresolved, clipInfo } };
}

/**
 * Page-side JS run per element via `Runtime.callFunctionOn` (`this` bound to
 * the target node): walks the live ancestor chain (starting at the parent —
 * an element's own `overflow`/`clip-path` clips its CHILDREN, never itself)
 * and, for every ancestor that clips (`overflow-x`/`overflow-y` matching
 * hidden/auto/scroll/clip, or a `clip-path` other than `none`), intersects a
 * running bounding-rect clip with that ancestor's own `getBoundingClientRect()`
 * AND, for `clip-path`, resolves the shape itself where possible:
 *   - `inset(...)` resolves to an exact rect (folded straight into the
 *     bounding-rect intersection).
 *   - `circle(...)` / `ellipse(...)` / `polygon(...)` resolve to an exact
 *     shape (pushed onto `shapes`, in absolute viewport-px terms) — percentage
 *     radii, `closest-side`/`farthest-side` keywords, the CSS `<position>`
 *     syntax for `at <position>`, polygon vertex lists (with `nonzero`/
 *     `evenodd` fill rule), and the `<geometry-box>` keyword (border-box
 *     default; padding-box/content-box resolved via computed border/padding;
 *     margin-box via computed margin; fill-box/stroke-box/view-box — SVG
 *     reference boxes with no meaningful DOM analog here — fall back to
 *     border-box, a documented simplification, not the `approximate` escape
 *     hatch below since it's still an exact shape test on a nearby box). The
 *     shape's own bbox also feeds the running bounding-rect intersection, as
 *     a fast pre-filter only — real exclusion happens per-pixel later via
 *     {@link pointInClipShape}.
 *   - Anything else (`path()`, `url()`, or an unrecognized clip-path form)
 *     cannot be resolved to exact geometry at all. This is handled
 *     explicitly rather than silently treated as unclipped: `approximate` is
 *     set `true`, and the ancestor's own bounding rect is folded into the
 *     running bounding-rect intersection as a conservative (non-exact, but
 *     never under-clipping in the common "shape sits within its box" case)
 *     bound — the caller uses `approximate` to flag this honestly rather
 *     than presenting it as an exact mask.
 * Returns `{ rect, shapes, approximate }` — `rect` is `null` when no ancestor
 * clips at all, else `{x,y,width,height}` in the same viewport CSS-pixel
 * space as `DOM.getContentQuads`; `shapes` accumulates every resolved
 * circle/ellipse/polygon across all ancestors (a pixel must satisfy all of
 * them — nested clips intersect).
 */
const ANCESTOR_CLIP_FUNCTION = `function () {
  // Splits a CSS value list on whitespace, but ONLY at paren-depth 0 — so a
  // \`calc(100% - 10px)\` argument (which contains internal spaces) survives
  // as one token instead of being torn apart by a naive \\s+ split. Every
  // multi-token value this file parses (a <position>'s two axes, an
  // ellipse's two radii, a polygon vertex's x/y pair) goes through this.
  function splitTopLevel(str) {
    var tokens = [];
    var current = '';
    var depth = 0;
    for (var i = 0; i < str.length; i += 1) {
      var ch = str[i];
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (/\\s/.test(ch) && depth === 0) {
        if (current) tokens.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current) tokens.push(current);
    return tokens;
  }

  // Resolves a single <length-percentage> token — \`10px\`, \`50%\`, a bare
  // number, or a \`calc(...)\` expression of those — against \`refPx\` (the
  // percentage basis). Returns \`null\` when the token is not one of these
  // forms (e.g. \`var(...)\`, an unsupported calc() operand) — the SOLE
  // signal every caller uses to mark its shape/rect unresolvable rather than
  // silently guessing a value. This is the ONE parsing path for every
  // length/percentage this file resolves (inset() edges, circle()/ellipse()
  // radii and positions, polygon() vertices) — there is no second, more
  // lenient parser.
  function resolveLength(token, refPx) {
    token = (token || '').trim();
    if (!token) return null;
    if (/^calc\\(/.test(token) && token.charAt(token.length - 1) === ')') {
      return evalCalcExpr(token.slice(5, -1), refPx);
    }
    var pctMatch = /^(-?[\\d.]+)%$/.exec(token);
    if (pctMatch) return (parseFloat(pctMatch[1]) / 100) * refPx;
    var pxMatch = /^(-?[\\d.]+)px$/.exec(token);
    if (pxMatch) return parseFloat(pxMatch[1]);
    var numMatch = /^(-?[\\d.]+)$/.exec(token);
    if (numMatch) return parseFloat(numMatch[1]);
    return null;
  }

  // Evaluates the inside of a \`calc(...)\` as a sum of +/- terms — the only
  // shape computed style ever emits for an edge-offset <position> (e.g.
  // \`right 10px\` computes to \`calc(100% - 10px)\`). Per the CSS calc()
  // grammar, a binary +/- operator MUST have whitespace on both sides (so
  // \`-10px\` alone is a signed term, never mistaken for an operator); a
  // nested \`calc(...)\` term is resolved recursively via \`resolveLength\`.
  // Returns \`null\` — propagated by every caller — the moment any term or
  // operator falls outside this grammar (multiplication, division, \`var()\`,
  // viewport units, ...): there is no fallback guess, only an honest
  // "cannot resolve this token" signal.
  function evalCalcExpr(inner, refPx) {
    var tokens = [];
    var current = '';
    var depth = 0;
    for (var i = 0; i < inner.length; i += 1) {
      var ch = inner[i];
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      var isOperator =
        (ch === '+' || ch === '-') && depth === 0 && i > 0 && inner[i - 1] === ' ' && i + 1 < inner.length && inner[i + 1] === ' ';
      if (isOperator) {
        tokens.push(current.trim());
        tokens.push(ch);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim() !== '') tokens.push(current.trim());
    if (tokens.length === 0) return null;
    var result = 0;
    var op = '+';
    for (var t = 0; t < tokens.length; t += 1) {
      var tok = tokens[t];
      if (tok === '+' || tok === '-') {
        op = tok;
        continue;
      }
      var val = resolveLength(tok, refPx);
      if (val === null) return null;
      result += op === '-' ? -val : val;
    }
    return result;
  }
  // \`argsStr\` is the already-extracted, paren-balanced inset() argument
  // list (see \`extractFunctionArgs\` below) — this does NOT re-match against
  // the raw clip-path string, so a \`calc(...)\` edge value (which itself
  // contains parens) can never truncate the extraction.
  function parseInsetRect(argsStr, box) {
    var tokens = splitTopLevel(argsStr.trim());
    var nums = [];
    for (var i = 0; i < tokens.length; i += 1) {
      if (/^-?[\\d.]/.test(tokens[i]) || /^calc\\(/.test(tokens[i])) nums.push(tokens[i]);
      else break;
    }
    if (nums.length === 0) return null;
    var top = nums[0];
    var right = nums.length > 1 ? nums[1] : nums[0];
    var bottom = nums.length > 2 ? nums[2] : nums[0];
    var left = nums.length > 3 ? nums[3] : right;
    var leftVal = resolveLength(left, box.width);
    var topVal = resolveLength(top, box.height);
    var rightVal = resolveLength(right, box.width);
    var bottomVal = resolveLength(bottom, box.height);
    if (leftVal === null || topVal === null || rightVal === null || bottomVal === null) return null;
    return {
      left: box.left + leftVal,
      top: box.top + topVal,
      right: box.right - rightVal,
      bottom: box.bottom - bottomVal,
    };
  }
  function intersectBox(a, b) {
    if (!a) return b;
    if (!b) return a;
    return {
      left: Math.max(a.left, b.left),
      top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.right),
      bottom: Math.min(a.bottom, b.bottom),
    };
  }

  // <geometry-box> keyword resolution: defaults to border-box. Only
  // border/padding/content/margin are resolved exactly (the DOM boxes this
  // collector already reasons about elsewhere); fill-box/stroke-box/view-box
  // are SVG-specific reference boxes with no meaningful analog against a
  // plain HTML ancestor chain, so they fall back to border-box too — a
  // documented simplification, distinct from the path()/url() "approximate"
  // escape hatch since the shape math itself is still exact.
  function computeReferenceBox(node, clipPath) {
    var rect = node.getBoundingClientRect();
    var boxMatch = /(border-box|padding-box|content-box|margin-box|fill-box|stroke-box|view-box)/.exec(clipPath);
    var boxKeyword = boxMatch ? boxMatch[1] : 'border-box';
    if (boxKeyword === 'border-box' || boxKeyword === 'fill-box' || boxKeyword === 'stroke-box' || boxKeyword === 'view-box') {
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    }
    var style = getComputedStyle(node);
    var bl = parseFloat(style.borderLeftWidth) || 0;
    var br = parseFloat(style.borderRightWidth) || 0;
    var bt = parseFloat(style.borderTopWidth) || 0;
    var bb = parseFloat(style.borderBottomWidth) || 0;
    if (boxKeyword === 'padding-box') {
      return {
        left: rect.left + bl, top: rect.top + bt, right: rect.right - br, bottom: rect.bottom - bb,
        width: rect.width - bl - br, height: rect.height - bt - bb,
      };
    }
    if (boxKeyword === 'margin-box') {
      var ml = parseFloat(style.marginLeft) || 0;
      var mr = parseFloat(style.marginRight) || 0;
      var mt = parseFloat(style.marginTop) || 0;
      var mb = parseFloat(style.marginBottom) || 0;
      return {
        left: rect.left - ml, top: rect.top - mt, right: rect.right + mr, bottom: rect.bottom + mb,
        width: rect.width + ml + mr, height: rect.height + mt + mb,
      };
    }
    // content-box
    var pl = parseFloat(style.paddingLeft) || 0;
    var pr = parseFloat(style.paddingRight) || 0;
    var pt = parseFloat(style.paddingTop) || 0;
    var pb = parseFloat(style.paddingBottom) || 0;
    return {
      left: rect.left + bl + pl, top: rect.top + bt + pt, right: rect.right - br - pr, bottom: rect.bottom - bb - pb,
      width: rect.width - bl - br - pl - pr, height: rect.height - bt - bb - pt - pb,
    };
  }

  // CSS <position> (2-value subset: keywords/lengths/percentages/calc(),
  // standard left-then-top order, with "top left"/"bottom right"
  // keyword-order swap handled). Does NOT itself tokenize the AUTHORED
  // 4-value edge-offset syntax ("right 10px bottom 20px") — but computed
  // style never preserves that syntax anyway: the browser always resolves
  // it to this 2-value \`calc(100% - 10px)\`-style form first, which
  // \`resolveLength\`'s calc() support DOES parse exactly. Returns \`null\`
  // (never a guessed center) the moment either axis token is unresolvable.
  function parsePosition(str, w, h) {
    str = (str || '').trim();
    if (!str) return { x: w / 2, y: h / 2 };
    var tokens = splitTopLevel(str);
    function axisValue(token, dim, isX) {
      if (token === 'center') return dim / 2;
      if (isX && token === 'left') return 0;
      if (isX && token === 'right') return dim;
      if (!isX && token === 'top') return 0;
      if (!isX && token === 'bottom') return dim;
      return resolveLength(token, dim);
    }
    if (tokens.length === 1) {
      var t = tokens[0];
      if (t === 'top' || t === 'bottom') {
        var yOnly = axisValue(t, h, false);
        return yOnly === null ? null : { x: w / 2, y: yOnly };
      }
      var xOnly = axisValue(t, w, true);
      return xOnly === null ? null : { x: xOnly, y: h / 2 };
    }
    var first = tokens[0];
    var second = tokens[1];
    var x, y;
    if (first === 'top' || first === 'bottom') {
      x = axisValue(second, w, true);
      y = axisValue(first, h, false);
    } else {
      x = axisValue(first, w, true);
      y = axisValue(second, h, false);
    }
    if (x === null || y === null) return null;
    return { x: x, y: y };
  }

  // Single-axis radius: closest-side/farthest-side (distances to the two
  // opposing edges along this axis) / percentage (of dim) / length /
  // calc(). Returns \`null\` (never a guessed closest-side default) the
  // moment the token is not one of these forms.
  function resolveAxisRadius(token, centerRel, dim) {
    token = (token || '').trim();
    if (!token || token === 'closest-side') return Math.min(centerRel, dim - centerRel);
    if (token === 'farthest-side') return Math.max(centerRel, dim - centerRel);
    return resolveLength(token, dim);
  }

  // circle()'s single radius uses the CSS Shapes diagonal formula for '%'
  // (sqrt(w^2+h^2)/sqrt(2)), not a per-axis percentage; a calc() radius
  // resolves its own '%' terms against that same diagonal basis. Returns
  // \`null\` (never a guessed closest-side default) when unresolvable.
  function resolveCircleRadius(token, cx, cy, w, h) {
    token = (token || '').trim();
    if (!token || token === 'closest-side') return Math.min(cx, w - cx, cy, h - cy);
    if (token === 'farthest-side') return Math.max(cx, w - cx, cy, h - cy);
    var pctMatch = /^(-?[\\d.]+)%$/.exec(token);
    if (pctMatch) return (parseFloat(pctMatch[1]) / 100) * (Math.sqrt(w * w + h * h) / Math.SQRT2);
    var pxMatch = /^(-?[\\d.]+)px$/.exec(token);
    if (pxMatch) return parseFloat(pxMatch[1]);
    var numMatch = /^(-?[\\d.]+)$/.exec(token);
    if (numMatch) return parseFloat(numMatch[1]);
    if (/^calc\\(/.test(token) && token.charAt(token.length - 1) === ')') {
      return evalCalcExpr(token.slice(5, -1), Math.sqrt(w * w + h * h) / Math.SQRT2);
    }
    return null;
  }

  function splitShapeArgs(argsStr) {
    var trimmed = argsStr.trim();
    // Radius/axes are entirely optional ("circle(at 40px 40px)" is valid
    // CSS — no leading space before "at" in that case), so check for a
    // leading "at " separately from the more common "<radius> at <pos>" form.
    if (/^at\s+/.test(trimmed)) {
      return { radiusPart: '', posPart: trimmed.replace(/^at\s+/, '').trim() };
    }
    var atIdx = trimmed.indexOf(' at ');
    return {
      radiusPart: (atIdx >= 0 ? trimmed.slice(0, atIdx) : trimmed).trim(),
      posPart: atIdx >= 0 ? trimmed.slice(atIdx + 4).trim() : '',
    };
  }

  // Returns \`null\` (never a shape built from guessed coordinates) the
  // moment the position or radius contains an unresolvable token.
  function parseCircle(argsStr, box) {
    var parts = splitShapeArgs(argsStr);
    var pos = parsePosition(parts.posPart, box.width, box.height);
    if (!pos) return null;
    var r = resolveCircleRadius(parts.radiusPart, pos.x, pos.y, box.width, box.height);
    if (r === null) return null;
    return { type: 'circle', cx: box.left + pos.x, cy: box.top + pos.y, r: Math.max(0, r) };
  }

  function parseEllipse(argsStr, box) {
    var parts = splitShapeArgs(argsStr);
    var pos = parsePosition(parts.posPart, box.width, box.height);
    if (!pos) return null;
    var radiusTokens = splitTopLevel(parts.radiusPart);
    var rx = resolveAxisRadius(radiusTokens[0], pos.x, box.width);
    var ry = resolveAxisRadius(radiusTokens[1], pos.y, box.height);
    if (rx === null || ry === null) return null;
    return { type: 'ellipse', cx: box.left + pos.x, cy: box.top + pos.y, rx: Math.max(0, rx), ry: Math.max(0, ry) };
  }

  function parsePolygon(argsStr, box) {
    var fillRule = 'nonzero';
    var body = argsStr;
    var fillMatch = /^\\s*(nonzero|evenodd)\\s*,/.exec(argsStr);
    if (fillMatch) {
      fillRule = fillMatch[1];
      body = argsStr.slice(fillMatch[0].length);
    }
    var pairs = body.split(',');
    var points = [];
    for (var i = 0; i < pairs.length; i += 1) {
      var tokens = splitTopLevel(pairs[i].trim());
      if (tokens.length < 2) continue;
      var xVal = resolveLength(tokens[0], box.width);
      var yVal = resolveLength(tokens[1], box.height);
      if (xVal === null || yVal === null) return null;
      points.push(box.left + xVal, box.top + yVal);
    }
    return { type: 'polygon', points: points, fillRule: fillRule };
  }

  // Extracts the argument list of \`name(...)\` from a clip-path value —
  // but ONLY when \`name(\` opens a top-level function in the value, never
  // a bare substring match anywhere in the string. A clip-path value is
  // (per the CSS grammar this collector supports) either a single
  // \`<basic-shape>\` function optionally paired with a \`<geometry-box>\`
  // keyword — so splitting the value on TOP-LEVEL whitespace (via
  // \`splitTopLevel\`, the same depth-aware splitter used for a shape's own
  // arguments) yields at most one shape-function token; every other token
  // is a box keyword. Checking that token's own PREFIX (not an \`indexOf\`
  // anywhere in the raw string) is what keeps this from matching shape
  // text that only appears nested inside an unrelated top-level function's
  // arguments — most importantly \`url(\"#circle(20px at 50px 50px)\")\`, a
  // valid but UNSUPPORTED \`<clip-source>\` reference whose fragment text
  // merely resembles a circle() call. Once the matching token is found,
  // argument extraction still walks paren depth from \`name(\`'s opening
  // paren to its OWN matching close — never the naive \`[^)]*\` regex this
  // replaces, which truncates at the first \`)\` it sees and silently hands
  // a mangled/truncated argument string to the shape parser the moment an
  // argument itself contains parens (every computed \`calc(...)\`
  // edge-offset position does). Returns \`null\` when no top-level token
  // starts with \`name(\` or that token's parens never close.
  function extractFunctionArgs(str, name) {
    var prefix = name + '(';
    var tokens = splitTopLevel(str.trim());
    var target = null;
    for (var t = 0; t < tokens.length; t += 1) {
      if (tokens[t].indexOf(prefix) === 0) {
        target = tokens[t];
        break;
      }
    }
    if (target === null) return null;
    var start = prefix.length;
    var depth = 1;
    var i = start;
    for (; i < target.length; i += 1) {
      if (target[i] === '(') depth += 1;
      else if (target[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) return null;
    return target.slice(start, i);
  }

  function shapeBboxRect(shape) {
    if (shape.type === 'circle') {
      return { left: shape.cx - shape.r, top: shape.cy - shape.r, right: shape.cx + shape.r, bottom: shape.cy + shape.r };
    }
    if (shape.type === 'ellipse') {
      return { left: shape.cx - shape.rx, top: shape.cy - shape.ry, right: shape.cx + shape.rx, bottom: shape.cy + shape.ry };
    }
    var xs = [];
    var ys = [];
    for (var i = 0; i < shape.points.length; i += 2) {
      xs.push(shape.points[i]);
      ys.push(shape.points[i + 1]);
    }
    return { left: Math.min.apply(null, xs), top: Math.min.apply(null, ys), right: Math.max.apply(null, xs), bottom: Math.max.apply(null, ys) };
  }

  var node = this.parentElement;
  var docEl = this.ownerDocument ? this.ownerDocument.documentElement : null;
  var clip = null;
  var shapes = [];
  var approximate = false;
  var hops = 0;
  while (node && node.nodeType === 1 && node !== docEl && hops < 100) {
    var style = getComputedStyle(node);
    var overflowClips = /hidden|auto|scroll|clip/.test(style.overflowX) || /hidden|auto|scroll|clip/.test(style.overflowY);
    var clipPath = style.clipPath;
    var hasClipPath = !!clipPath && clipPath !== 'none';
    if (overflowClips) {
      var ar = node.getBoundingClientRect();
      clip = intersectBox(clip, { left: ar.left, top: ar.top, right: ar.right, bottom: ar.bottom });
    }
    if (hasClipPath) {
      var refBox = computeReferenceBox(node, clipPath);
      // Paren-balanced argument extraction (not a naive \`[^)]*\` regex) —
      // required because a \`calc(...)\` argument (the form computed style
      // always uses for an edge-offset position) itself contains parens.
      var insetArgs = extractFunctionArgs(clipPath, 'inset');
      var circleArgs = extractFunctionArgs(clipPath, 'circle');
      var ellipseArgs = extractFunctionArgs(clipPath, 'ellipse');
      var polygonArgs = extractFunctionArgs(clipPath, 'polygon');
      var refBoxRect = { left: refBox.left, top: refBox.top, right: refBox.right, bottom: refBox.bottom };
      if (insetArgs !== null) {
        var insetBox = parseInsetRect(insetArgs, refBox);
        if (insetBox) {
          clip = intersectBox(clip, insetBox);
        } else {
          // A recognized inset() whose edge tokens this evaluator cannot
          // resolve (e.g. an operand outside the calc() px/%/number
          // grammar): do NOT silently fall back to guessed edges — mark
          // this ancestor's contribution approximate, same as path()/url().
          approximate = true;
          clip = intersectBox(clip, refBoxRect);
        }
      } else if (circleArgs !== null) {
        var circleShape = parseCircle(circleArgs, refBox);
        if (circleShape) {
          shapes.push(circleShape);
          clip = intersectBox(clip, shapeBboxRect(circleShape));
        } else {
          // A recognized circle() whose radius/position tokens this
          // evaluator cannot resolve (e.g. a computed calc() position term
          // outside the supported grammar): do NOT silently compute a
          // wrong shape from guessed coordinates — mark approximate.
          approximate = true;
          clip = intersectBox(clip, refBoxRect);
        }
      } else if (ellipseArgs !== null) {
        var ellipseShape = parseEllipse(ellipseArgs, refBox);
        if (ellipseShape) {
          shapes.push(ellipseShape);
          clip = intersectBox(clip, shapeBboxRect(ellipseShape));
        } else {
          approximate = true;
          clip = intersectBox(clip, refBoxRect);
        }
      } else if (polygonArgs !== null) {
        var polygonShape = parsePolygon(polygonArgs, refBox);
        if (polygonShape) {
          shapes.push(polygonShape);
          clip = intersectBox(clip, shapeBboxRect(polygonShape));
        } else {
          approximate = true;
          clip = intersectBox(clip, refBoxRect);
        }
      } else {
        // path() / url() / any other unrecognized clip-path form: cannot be
        // resolved to exact geometry. Do NOT silently treat this as
        // unclipped — fall back to the ancestor's own box as a conservative
        // bound (same as before) but flag it as approximate so the caller
        // never mistakes this for an exact mask.
        approximate = true;
        clip = intersectBox(clip, refBoxRect);
      }
    }
    node = node.parentElement;
    hops += 1;
  }
  if (!clip) return { rect: null, shapes: shapes, approximate: approximate };
  var width = Math.max(0, clip.right - clip.left);
  var height = Math.max(0, clip.bottom - clip.top);
  return { rect: { x: clip.left, y: clip.top, width: width, height: height }, shapes: shapes, approximate: approximate };
}`;

/**
 * Resolves `nodeId` to a live `objectId` (`DOM.resolveNode`) and runs
 * {@link ANCESTOR_CLIP_FUNCTION} on it. Never throws overall, but a
 * resolve/call failure that genuinely prevents the walk from running
 * (`DOM.resolveNode` resolving without an `objectId`, `Runtime.callFunctionOn`
 * resolving without `result.value`, or either call throwing — detached
 * node, CDP hiccup) is marked honestly via {@link AncestorClipInfo.unavailable}
 * + `unavailableReason`, NOT silently coerced into the same
 * `{rect:null,shapes:[],approximate:false}` shape a genuine "no ancestor
 * clips this element" result produces (I-4/I-5) — that shape is reserved
 * for a walk that actually ran and found nothing to clip. This mirrors
 * `backendNodeId`'s `identityUnresolved: true` marker rather than a silent
 * default: clip info gets the same honesty treatment identity does.
 * The `DOM.resolveNode`-held `objectId` is released via
 * `Runtime.releaseObject` in a `finally` (unconditionally, mirroring
 * `animation.ts`'s held-object cleanup) so a per-element remote handle never
 * outlives this call.
 */
async function computeAncestorClip(client: CDPClient, nodeId: number): Promise<AncestorClipInfo> {
  const unavailable = (reason: AncestorClipUnavailableReason): AncestorClipInfo => ({
    rect: null,
    shapes: [],
    approximate: false,
    unavailable: true,
    unavailableReason: reason,
  });
  let objectId: string | undefined;
  try {
    const resolved = (await client.send('DOM.resolveNode', { nodeId })) as { object?: { objectId?: string } };
    objectId = resolved.object?.objectId;
    if (!objectId) return unavailable('resolve-node-no-object-id');
    const called = (await client.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: ANCESTOR_CLIP_FUNCTION,
      returnByValue: true,
    })) as { result?: { value?: AncestorClipInfo } };
    if (!called.result?.value) return unavailable('call-function-no-value');
    return called.result.value;
  } catch {
    return unavailable('resolve-or-call-threw');
  } finally {
    if (objectId) {
      try {
        await client.send('Runtime.releaseObject', { objectId });
      } catch {
        // Best-effort release — a failure here doesn't invalidate the clip
        // info already computed/returned above.
      }
    }
  }
}

// ============================================================================
// Pure geometry/selector helpers
// ============================================================================

function unionRect(rects: readonly Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Axis-aligned rect intersection; zero width/height (never negative) when `a` and `b` don't overlap. */
function intersectRect(a: Rect, b: Rect): Rect {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

function clampRectToPixels(
  rect: Rect,
  scaleX: number,
  scaleY: number,
  imgWidth: number,
  imgHeight: number,
): PixelRect | null {
  const x0 = Math.max(0, Math.floor(rect.x * scaleX));
  const y0 = Math.max(0, Math.floor(rect.y * scaleY));
  const x1 = Math.min(imgWidth, Math.ceil((rect.x + rect.width) * scaleX));
  const y1 = Math.min(imgHeight, Math.ceil((rect.y + rect.height) * scaleY));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Rasterizes a polygon mask over the clamped crop rect: a crop pixel is
 * on-mask iff its center — mapped back from screenshot-pixel space into CSS
 * viewport space via the same `scaleX`/`scaleY` used to derive the rect —
 * lies inside any of the element's content quads AND inside every ancestor
 * clip shape (`clipShapes`; an empty array is always satisfied — the
 * pre-existing behavior when no ancestor imposes an exact circle/ellipse/
 * polygon constraint). The 0.5 pixel-center offset keeps integer-aligned
 * axis-aligned quads (the common case) from hitting the point-in-polygon
 * boundary ambiguously.
 */
function buildQuadMask(
  pixelRect: PixelRect,
  quads: readonly Quad[],
  scaleX: number,
  scaleY: number,
  clipShapes: readonly ClipShape[],
): Mask {
  const data = new Uint8Array(pixelRect.width * pixelRect.height);
  let count = 0;
  for (let row = 0; row < pixelRect.height; row += 1) {
    const cssY = (pixelRect.y + row + 0.5) / scaleY;
    for (let col = 0; col < pixelRect.width; col += 1) {
      const cssX = (pixelRect.x + col + 0.5) / scaleX;
      const inQuad = quads.some((quad) => pointInQuad(quad, cssX, cssY));
      const inClipShapes = clipShapes.every((shape) => pointInClipShape(shape, cssX, cssY));
      if (inQuad && inClipShapes) {
        data[row * pixelRect.width + col] = 1;
        count += 1;
      }
    }
  }
  return { data, count };
}

/** Even-odd ray-cast point-in-polygon over a quad's four corners. */
function pointInQuad(quad: Quad, px: number, py: number): boolean {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i, i += 1) {
    const xi = xs[i];
    const yi = ys[i];
    const xj = xs[j];
    const yj = ys[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Dispatches a point-in-shape test to the exact geometry for the given ancestor clip-path shape. */
function pointInClipShape(shape: ClipShape, x: number, y: number): boolean {
  switch (shape.type) {
    case 'circle': {
      const dx = x - shape.cx;
      const dy = y - shape.cy;
      return dx * dx + dy * dy <= shape.r * shape.r;
    }
    case 'ellipse': {
      if (shape.rx <= 0 || shape.ry <= 0) return false;
      const dx = (x - shape.cx) / shape.rx;
      const dy = (y - shape.cy) / shape.ry;
      return dx * dx + dy * dy <= 1;
    }
    case 'polygon':
      return pointInPolygon(shape.points, shape.fillRule, x, y);
    default:
      return true;
  }
}

/**
 * Point-in-polygon over an arbitrary vertex list, honoring the CSS
 * `clip-path: polygon()` fill rule: `evenodd` (the same even-odd ray-cast
 * used for content quads) or `nonzero` (the default — a standard nonzero
 * winding-number test, needed because a self-intersecting or
 * differently-wound polygon can disagree with even-odd on which regions
 * are "inside").
 */
function pointInPolygon(points: readonly number[], fillRule: 'nonzero' | 'evenodd', px: number, py: number): boolean {
  const n = points.length / 2;
  if (n < 3) return false;
  if (fillRule === 'evenodd') {
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
      const xi = points[i * 2];
      const yi = points[i * 2 + 1];
      const xj = points[j * 2];
      const yj = points[j * 2 + 1];
      const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }
  let winding = 0;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = points[i * 2];
    const yi = points[i * 2 + 1];
    const xj = points[j * 2];
    const yj = points[j * 2 + 1];
    if (yi <= py) {
      if (yj > py && isLeftOfEdge(xi, yi, xj, yj, px, py) > 0) winding += 1;
    } else if (yj <= py && isLeftOfEdge(xi, yi, xj, yj, px, py) < 0) {
      winding -= 1;
    }
  }
  return winding !== 0;
}

/** Signed area (cross product) test: >0 when `(px,py)` is left of the directed edge `(x0,y0)->(x1,y1)`. */
function isLeftOfEdge(x0: number, y0: number, x1: number, y1: number, px: number, py: number): number {
  return (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0);
}

function flattenAttributes(attributes: readonly string[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!attributes) return map;
  for (let i = 0; i + 1 < attributes.length; i += 2) {
    map.set(attributes[i], attributes[i + 1]);
  }
  return map;
}

/**
 * Best-effort `tag#id.class1.class2` selector. Structure is built from the
 * raw page-controlled attributes, then the whole string is routed through
 * the shared {@link sanitizeString} (secret-substring redaction + length
 * cap) — the single authority every collector uses for page-controlled
 * strings, so a token withheld in one artifact can't leak raw here.
 */
function buildSelector(nodeName: string | undefined, attributes: readonly string[] | undefined): string | undefined {
  if (!nodeName) return undefined;
  const attrs = flattenAttributes(attributes);

  let selector = nodeName.toLowerCase();
  const idAttr = attrs.get('id');
  if (idAttr) selector += `#${idAttr}`;
  const classAttr = attrs.get('class');
  if (classAttr) {
    for (const cls of classAttr.split(/\s+/).filter(Boolean).slice(0, 3)) {
      selector += `.${cls}`;
    }
  }
  return sanitizeString(selector);
}

/**
 * Stable, collision-free crop filename base: `index` guarantees uniqueness,
 * `backendNodeId ?? tag` is a stable identifier under our control, and the
 * shared {@link sanitizeFilenameSlug} redacts secret substrings BEFORE
 * filename-safe slugging — so a secret-shaped id/class in a page attribute
 * can never reach a crop filename. Never derived from raw page attributes.
 */
function cropFileBase(index: number, entry: DescribedElement): string {
  const stableId = typeof entry.backendNodeId === 'number' ? String(entry.backendNodeId) : (entry.tag ?? 'el');
  const slug = entry.selector !== undefined ? sanitizeFilenameSlug(entry.selector) : '';
  return slug ? `${index}-${stableId}-${slug}` : `${index}-${stableId}`;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// ============================================================================
// Raster helpers — crop, mask, encode, and derive per-crop facts
// ============================================================================

function cropPixels(png: PNG, rect: PixelRect): RawImage {
  const out = Buffer.alloc(rect.width * rect.height * 4);
  for (let row = 0; row < rect.height; row += 1) {
    const srcStart = ((rect.y + row) * png.width + rect.x) * 4;
    const destStart = row * rect.width * 4;
    png.data.copy(out, destStart, srcStart, srcStart + rect.width * 4);
  }
  return { width: rect.width, height: rect.height, data: out };
}

/** Returns a copy of `img` with every off-mask pixel zeroed to fully-transparent (0,0,0,0). */
function applyMaskTransparent(img: RawImage, mask: Mask): RawImage {
  const out = Buffer.from(img.data);
  const n = pixelCount(img);
  for (let i = 0; i < n; i += 1) {
    if (mask.data[i] === 0) {
      const o = i * 4;
      out[o] = 0;
      out[o + 1] = 0;
      out[o + 2] = 0;
      out[o + 3] = 0;
    }
  }
  return { width: img.width, height: img.height, data: out };
}

function encodePng(img: RawImage): Buffer {
  const png = new PNG({ width: img.width, height: img.height });
  img.data.copy(png.data);
  return PNG.sync.write(png);
}

function pixelCount(img: RawImage): number {
  return img.width * img.height;
}

function averageColor(img: RawImage, mask: Mask): RGBColor {
  if (mask.count === 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  const n = pixelCount(img);
  for (let i = 0; i < n; i += 1) {
    if (mask.data[i] === 0) continue;
    const o = i * 4;
    r += img.data[o];
    g += img.data[o + 1];
    b += img.data[o + 2];
  }
  return { r: Math.round(r / mask.count), g: Math.round(g / mask.count), b: Math.round(b / mask.count) };
}

function medianColor(img: RawImage, mask: Mask): RGBColor {
  if (mask.count === 0) return { r: 0, g: 0, b: 0 };
  const rs = new Array<number>(mask.count);
  const gs = new Array<number>(mask.count);
  const bs = new Array<number>(mask.count);
  const n = pixelCount(img);
  let k = 0;
  for (let i = 0; i < n; i += 1) {
    if (mask.data[i] === 0) continue;
    const o = i * 4;
    rs[k] = img.data[o];
    gs[k] = img.data[o + 1];
    bs[k] = img.data[o + 2];
    k += 1;
  }
  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = Math.floor(mask.count / 2);
  return { r: rs[mid], g: gs[mid], b: bs[mid] };
}

/** Most-frequent color after quantizing to `DOMINANT_BUCKET`-wide buckets, reported as that bucket's own average. */
function dominantColor(img: RawImage, mask: Mask): RGBColor {
  if (mask.count === 0) return { r: 0, g: 0, b: 0 };
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  const n = pixelCount(img);
  for (let i = 0; i < n; i += 1) {
    if (mask.data[i] === 0) continue;
    const o = i * 4;
    const r = img.data[o];
    const g = img.data[o + 1];
    const b = img.data[o + 2];
    const key = `${Math.floor(r / DOMINANT_BUCKET)},${Math.floor(g / DOMINANT_BUCKET)},${Math.floor(b / DOMINANT_BUCKET)}`;
    const entry = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    entry.count += 1;
    entry.r += r;
    entry.g += g;
    entry.b += b;
    buckets.set(key, entry);
  }
  let best: { count: number; r: number; g: number; b: number } | null = null;
  for (const entry of buckets.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  if (!best) return { r: 0, g: 0, b: 0 };
  return { r: Math.round(best.r / best.count), g: Math.round(best.g / best.count), b: Math.round(best.b / best.count) };
}

function alphaFraction(img: RawImage, mask: Mask): number {
  if (mask.count === 0) return 0;
  let sum = 0;
  const n = pixelCount(img);
  for (let i = 0; i < n; i += 1) {
    if (mask.data[i] === 0) continue;
    sum += img.data[i * 4 + 3];
  }
  return sum / (mask.count * 255);
}

function visiblePixelFraction(img: RawImage, mask: Mask): number {
  if (mask.count === 0) return 0;
  let visible = 0;
  const n = pixelCount(img);
  for (let i = 0; i < n; i += 1) {
    if (mask.data[i] === 0) continue;
    if (img.data[i * 4 + 3] > 0) visible += 1;
  }
  return visible / mask.count;
}

/**
 * 8x8 average-hash (aHash): downsamples the ON-MASK crop pixels to a
 * `HASH_GRID`x`HASH_GRID` luminance grid, compares each cell to the grid
 * mean, and packs the resulting 64 bits into 16 hex chars. Off-mask pixels
 * are excluded from every cell's luminance so a rotated/disjoint element's
 * hash reflects only its own content. Deterministic for identical on-mask
 * pixel content — the "stable hash" this collector reports.
 */
function averageHash(img: RawImage, mask: Mask): string {
  const cells = new Array<number>(HASH_GRID * HASH_GRID).fill(0);
  const counts = new Array<number>(HASH_GRID * HASH_GRID).fill(0);

  for (let y = 0; y < img.height; y += 1) {
    const cellY = Math.min(HASH_GRID - 1, Math.floor((y / img.height) * HASH_GRID));
    for (let x = 0; x < img.width; x += 1) {
      if (mask.data[y * img.width + x] === 0) continue;
      const cellX = Math.min(HASH_GRID - 1, Math.floor((x / img.width) * HASH_GRID));
      const o = (y * img.width + x) * 4;
      const lum = 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2];
      const idx = cellY * HASH_GRID + cellX;
      cells[idx] += lum;
      counts[idx] += 1;
    }
  }

  const values = cells.map((sum, i) => (counts[i] > 0 ? sum / counts[i] : 0));
  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  const bytes: number[] = [];
  let byte = 0;
  let bitCount = 0;
  for (const value of values) {
    byte = (byte << 1) | (value >= mean ? 1 : 0);
    bitCount += 1;
    if (bitCount === 8) {
      bytes.push(byte);
      byte = 0;
      bitCount = 0;
    }
  }
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}
