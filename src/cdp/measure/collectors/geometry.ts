/**
 * `geometry.json` collector — element rects, quads, box-model detail,
 * layout provenance (flex/grid/clipping/stacking-context), and (on an
 * unsettled `--capture-unsettled` capture) the unstable-region markers.
 *
 * Architecture: ONE `Runtime.evaluate` walks the whole reachable tree
 * (document body, open shadow roots, and same-origin iframe
 * `contentDocument`s) and returns page-side FACTS (selector, computed-style
 * provenance, frame/shadow context) keyed by `idx` — never geometry. The
 * walk never assigns anything to `window` or any other page-observable
 * location: its return value is a plain in-memory `{ facts, elements }`
 * object, read back purely through CDP's own remote-object identity —
 * `Runtime.evaluate({returnByValue: false})` hands back an `objectId` for
 * that held object with zero page visibility into it, `Runtime.getProperties`
 * resolves `facts`'/`elements`'s own `objectId`s ({@link ownPropertyObjectIds}),
 * `Runtime.callFunctionOn({returnByValue: true})` reads `facts` out by value
 * ({@link readHeldValue}), and a second `Runtime.getProperties` on the held
 * `elements` objectId resolves each matched element's own `objectId` in one
 * round trip ({@link resolveIndexedObjectIds}) — no N separate evaluates,
 * and no page-observable global for a page to define a setter against. From
 * there, `DOM.describeNode` (backendNodeId) is fetched per element, and
 * `DOM.getContentQuads`/`DOM.getBoxModel` are read through this file's own
 * {@link readContentQuads}/{@link readBoxModel} — deliberately NOT
 * `../../coordinates.js`'s combined `getContentQuadBox`, because Chrome
 * throws `DOM.getBoxModel` for EVERY node with no layout box (the identical
 * throw a genuinely invalid/detached node reference produces), so a
 * combined one-catch read would make a real `display:none`/no-box element
 * indistinguishable from an actual failed read. `readContentQuads` is
 * called first and alone; only a THROW from it — never a successful empty
 * result — counts as a per-element geometry read failure (I-4/I-5,
 * {@link GeometryElementRecord.geometryUnavailable}). `readBoxModel` is
 * only attempted once real (non-empty) quads prove a box exists, so its own
 * throw can only mean the detail read failed, not that the box never
 * existed. Every held container/facts/elements
 * `objectId` is released via `Runtime.releaseObject` in `finally`
 * (unconditionally), so a later capture on the same tab never collides with
 * anything this run held — a release failure is recorded as the factual
 * `bridgeCleanupFailed`, but can never imply a contaminated baseline: there
 * is no page-observable state left to leak, only CDP-session-scoped
 * remote-object memory freed when the tab closes.
 *
 * Coordinate space: every reported `rect`/`quads`/`boxModel` comes from
 * real CDP `DOM.getContentQuads`/`DOM.getBoxModel` calls — never from JS
 * `getBoundingClientRect()` math. Empirically confirmed (see U07's final
 * report) that CDP already returns these quads in TOP-VIEWPORT space for
 * same-process (non-OOPIF) nested iframes over one un-sessioned CDP
 * connection — including correct vertical margin-collapse behavior — so no
 * `composeFrameTransform`/`toTopViewportQuad` stitching is needed here.
 * `getBoundingClientRect()` is used ONLY for same-document-local math
 * (visibility/zero-size flags, the clipping-ancestor ratio calc) — never
 * reported as final geometry.
 *
 * U07 note: this file keeps spreading `ctx.unstableRegions` into the
 * written object's `unstableRegions` field exactly as the original stub
 * did; it is NOT recomputed here. The orchestrator (`snapshot.ts`) already
 * computed and passed it in via `ctx` — this is what makes
 * "`--capture-unsettled` writes geometry.json with unstable-region ids"
 * true regardless of which unit last touched this file.
 */

import type { CDPClient } from '../../client.js';
import { axisAlignedRectFromQuad, type Quad, type Rect } from '../../coordinates.js';
import { capArray, sanitizeString } from '../redaction.js';
import type { Collector, ElementRecord } from '../types.js';

/** Defensive cap on how many elements one geometry walk will record for a single snapshot. */
const MAX_ELEMENTS = 1200;

// ============================================================================
// Shared JS helpers — inlined (by string concatenation) into BOTH this
// file's walk script and hittest.ts's walk/sample script. Exported so
// hittest.ts imports rather than duplicates. NONE of these cap in-page:
// every page-controlled string they build is returned at full length and
// is capped node-side through redaction.ts `sanitizeString` (the single
// cap authority).
// ============================================================================

export const SELECTOR_HELPER_JS = `
function __selectorOf(el) {
  try {
    if (!el || el.nodeType !== 1) return undefined;
    if (el.id) return '#' + el.id;
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      var part = node.tagName.toLowerCase();
      if (node.id) {
        part += '#' + node.id;
        parts.unshift(part);
        break;
      }
      if (node.classList && node.classList.length) {
        part += '.' + Array.prototype.slice.call(node.classList).slice(0, 3).join('.');
      }
      var parent = node.parentElement;
      if (parent) {
        var siblings = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
      depth += 1;
    }
    return parts.join(' > ');
  } catch (e) { return undefined; }
}
function __domPathOf(el) {
  try {
    var parts = [];
    var node = el;
    var hops = 0;
    while (node && node.nodeType === 1 && hops < 200) {
      var idx = 0;
      var sib = node;
      while ((sib = sib.previousElementSibling)) idx += 1;
      parts.unshift(node.tagName.toLowerCase() + '[' + idx + ']');
      var parentEl = node.parentElement;
      if (!parentEl) {
        var root = node.getRootNode ? node.getRootNode() : null;
        parentEl = root && root.host ? root.host : null;
      }
      node = parentEl;
      hops += 1;
    }
    return parts.join('/') || '';
  } catch (e) { return ''; }
}
`;

// ============================================================================
// The page-side walk. Runs once via `Runtime.evaluate({returnByValue: false})`
// -- the return value is held as a remote object (see the module doc's
// CDP-only identity bridge), never read back by value directly.
// ============================================================================

function buildGeometryWalkScript(maxElements: number): string {
  return `(function () {
    var MAX_ELEMENTS = ${maxElements};
    var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, HEAD: 1, META: 1, LINK: 1, TITLE: 1, BASE: 1, NOSCRIPT: 1 };
    var facts = [];
    var elements = [];
    var frameCounter = 0;
    // Exact count of elements the MAX_ELEMENTS cap chose not to record --
    // real elements the walk visited (recursed into) but skipped the
    // expensive per-element fact-building for, never a page-observable value.
    var elementsOverflowCount = 0;

    function stackingReasons(style) {
      var reasons = [];
      if (style.position !== 'static' && style.zIndex !== 'auto') reasons.push('position+z-index');
      var op = parseFloat(style.opacity);
      if (!isNaN(op) && op < 1) reasons.push('opacity<1');
      if (style.transform && style.transform !== 'none') reasons.push('transform');
      if (style.filter && style.filter !== 'none') reasons.push('filter');
      if (style.perspective && style.perspective !== 'none') reasons.push('perspective');
      if (style.mixBlendMode && style.mixBlendMode !== 'normal') reasons.push('mix-blend-mode');
      if (style.isolation === 'isolate') reasons.push('isolate');
      if (style.willChange && /transform|opacity|filter/.test(style.willChange)) reasons.push('will-change');
      if (style.contain && /layout|paint|strict|content/.test(style.contain)) reasons.push('contain');
      if (style.position === 'fixed') reasons.push('fixed');
      if (style.position === 'sticky') reasons.push('sticky');
      return reasons;
    }

    function clippingInfo(el, rect) {
      try {
        if (rect.width === 0 && rect.height === 0) return null;
        var node = el.parentElement;
        var hops = 0;
        var docEl = el.ownerDocument.documentElement;
        while (node && node.nodeType === 1 && node !== docEl && hops < 50) {
          var s = getComputedStyle(node);
          var clipX = /hidden|auto|scroll|clip/.test(s.overflowX);
          var clipY = /hidden|auto|scroll|clip/.test(s.overflowY);
          if (clipX || clipY) {
            var ar = node.getBoundingClientRect();
            var ix1 = Math.max(rect.left, ar.left);
            var iy1 = Math.max(rect.top, ar.top);
            var ix2 = Math.min(rect.right, ar.right);
            var iy2 = Math.min(rect.bottom, ar.bottom);
            var iw = Math.max(0, ix2 - ix1);
            var ih = Math.max(0, iy2 - iy1);
            var selfArea = rect.width * rect.height;
            var fraction = selfArea > 0 ? (iw * ih) / selfArea : 0;
            if (fraction < 0.999) {
              return { clippedBy: __selectorOf(node), clippedFraction: Math.round(fraction * 1000) / 1000 };
            }
          }
          node = node.parentElement;
          hops += 1;
        }
        return null;
      } catch (e) { return null; }
    }

    function flexFactsFor(el, parentStyle) {
      try {
        var style = getComputedStyle(el);
        return {
          grow: parseFloat(style.flexGrow) || 0,
          shrink: parseFloat(style.flexShrink) || 0,
          basis: style.flexBasis,
          alignSelf: style.alignSelf,
          order: parseInt(style.order, 10) || 0,
          container: {
            direction: parentStyle.flexDirection,
            wrap: parentStyle.flexWrap,
            justifyContent: parentStyle.justifyContent,
            alignItems: parentStyle.alignItems,
            gap: parentStyle.gap,
          },
        };
      } catch (e) { return null; }
    }

    function gridFactsFor(el, parentStyle) {
      try {
        var style = getComputedStyle(el);
        return {
          columnStart: style.gridColumnStart,
          columnEnd: style.gridColumnEnd,
          rowStart: style.gridRowStart,
          rowEnd: style.gridRowEnd,
          container: {
            templateColumns: parentStyle.gridTemplateColumns.split(' ').filter(Boolean),
            templateRows: parentStyle.gridTemplateRows.split(' ').filter(Boolean),
            columnGap: parentStyle.columnGap,
            rowGap: parentStyle.rowGap,
          },
        };
      } catch (e) { return null; }
    }

    function directText(el) {
      var out = '';
      for (var i = 0; i < el.childNodes.length; i++) {
        var n = el.childNodes[i];
        if (n.nodeType === 3 && n.textContent) out += n.textContent;
      }
      out = out.replace(/\\s+/g, ' ').trim();
      return out || undefined;
    }

    function walk(el, frameId, isTop, ancestorFrameIds, shadowCtx) {
      if (!el || el.nodeType !== 1) return;
      var tag = el.tagName;
      if (SKIP_TAGS[tag]) return;

      // The MAX_ELEMENTS cap bounds only the EXPENSIVE per-element work below
      // (getComputedStyle/rect/clip-ancestor-walk facts) -- recursion into
      // shadow roots, same-origin iframes, and children always continues
      // past the cap so elementsTruncated below is an EXACT count of the
      // real elements this walk chose not to record, not a guess.
      // Captures the fact object THIS call pushed (if any) so the IFRAME
      // branch below can attach an honest failure marker directly to it --
      // stays null when this element's own record was skipped by the
      // MAX_ELEMENTS cap (recursion still continues past the cap, so a
      // capped IFRAME's contentDocument read failure has no record to mark,
      // same limitation geometryUnavailable already accepts for capped
      // elements).
      var pushedFact = null;
      if (facts.length >= MAX_ELEMENTS) {
        elementsOverflowCount += 1;
      } else {
        var style = getComputedStyle(el);
        var rect = el.getBoundingClientRect();
        var displayNone = style.display === 'none';
        var visibilityHidden = style.visibility === 'hidden';
        var opacity = parseFloat(style.opacity);
        if (isNaN(opacity)) opacity = 1;
        var zeroSize = rect.width === 0 && rect.height === 0;
        var visible = !displayNone && !visibilityHidden && opacity > 0 && !zeroSize;

        var parent = el.parentElement;
        var parentStyle = parent ? getComputedStyle(parent) : null;
        var isFlexChild = parentStyle && (parentStyle.display === 'flex' || parentStyle.display === 'inline-flex');
        var isGridChild = parentStyle && (parentStyle.display === 'grid' || parentStyle.display === 'inline-grid');

        var idx = facts.length;
        elements.push(el);
        var reasons = stackingReasons(style);
        var factObj = {
          idx: idx,
          tag: tag.toLowerCase(),
          selector: __selectorOf(el),
          domPath: __domPathOf(el),
          text: directText(el),
          frame: { frameId: frameId, isTopFrame: isTop, ancestorFrameIds: ancestorFrameIds.slice() },
          shadow: shadowCtx,
          zIndex: style.zIndex || 'auto',
          stackingContext: { creates: reasons.length > 0, reasons: reasons },
          visibility: { visible: visible, opacity: opacity, displayNone: displayNone, visibilityHidden: visibilityHidden, zeroSize: zeroSize },
          clipping: clippingInfo(el, rect),
          layout: {
            boxSizing: style.boxSizing,
            position: style.position,
            display: style.display,
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            scrollWidth: el.scrollWidth,
            scrollHeight: el.scrollHeight,
            clientWidth: el.clientWidth,
            clientHeight: el.clientHeight,
            contributesOverflowX: el.scrollWidth > el.clientWidth,
            contributesOverflowY: el.scrollHeight > el.clientHeight,
            minWidth: style.minWidth,
            maxWidth: style.maxWidth,
            minHeight: style.minHeight,
            maxHeight: style.maxHeight,
            aspectRatio: style.aspectRatio,
            flex: isFlexChild ? flexFactsFor(el, parentStyle) : null,
            grid: isGridChild ? gridFactsFor(el, parentStyle) : null,
          },
        };
        facts.push(factObj);
        pushedFact = factObj;
      }

      if (el.shadowRoot) {
        var hostSel = __selectorOf(el);
        var newDepth = (shadowCtx ? shadowCtx.chainDepth : 0) + 1;
        var shadowKids = el.shadowRoot.children;
        for (var si = 0; si < shadowKids.length; si++) {
          walk(shadowKids[si], frameId, isTop, ancestorFrameIds, { inShadowDom: true, hostSelector: hostSel, chainDepth: newDepth });
        }
      }

      if (tag === 'IFRAME') {
        var innerDoc = null;
        var contentDocumentReadThrew = false;
        try { innerDoc = el.contentDocument; } catch (e) { innerDoc = null; contentDocumentReadThrew = true; }
        // G6: a THROWN contentDocument read (a genuine failure, e.g. a
        // hostile/broken page patching the accessor) is distinct from a
        // clean null (the ordinary cross-origin-iframe case, which throws
        // nothing and is not a read failure) -- only the throw gets an
        // honest unavailable marker, attached directly to the iframe's own
        // already-pushed fact record so a same-origin subtree that silently
        // went unwalked is never indistinguishable from a genuinely childless
        // or cross-origin iframe.
        if (contentDocumentReadThrew && pushedFact) {
          pushedFact.iframeContentUnavailable = true;
          pushedFact.iframeContentUnavailableReason = 'content-document-read-threw';
        }
        if (innerDoc && innerDoc.body) {
          frameCounter += 1;
          var childFrameId = 'frame-' + frameCounter;
          var childAncestors = ancestorFrameIds.concat([frameId]);
          var innerKids = innerDoc.body.children;
          for (var ii = 0; ii < innerKids.length; ii++) {
            walk(innerKids[ii], childFrameId, false, childAncestors, null);
          }
        }
        return;
      }

      var children = el.children;
      for (var c = 0; c < children.length; c++) {
        walk(children[c], frameId, isTop, ancestorFrameIds, shadowCtx);
      }
    }

    var bodyKids = document.body ? document.body.children : [];
    for (var bi = 0; bi < bodyKids.length; bi++) {
      walk(bodyKids[bi], 'frame-0', true, [], null);
    }

    return { facts: facts, elements: elements, meta: { elementsTruncated: elementsOverflowCount } };
  })()`;
}

// ============================================================================
// Bridge helpers — exported for hittest.ts to reuse. NONE of these ever
// assigns to `window` or any other page-observable location: they only
// ever read a held CDP `RemoteObject` back through its own `objectId`, so a
// page that predefines a setter for a guessed global name has nothing to
// observe.
// ============================================================================

/** Resolves each own-property `objectId` of a held CDP object (e.g. the walk's `{ facts, elements }` return-value container) in one `Runtime.getProperties` round trip — how `facts`/`elements` are found inside a held reference rather than a page-observable global. */
export async function ownPropertyObjectIds(client: CDPClient, objectId: string): Promise<Map<string, string>> {
  const propsResult = (await client.send('Runtime.getProperties', {
    objectId,
    ownProperties: true,
  })) as { result?: Array<{ name: string; value?: { objectId?: string } }> };
  const out = new Map<string, string>();
  for (const prop of propsResult.result ?? []) {
    if (prop.value?.objectId) out.set(prop.name, prop.value.objectId);
  }
  return out;
}

/** Reads a held CDP object out by value via one `Runtime.callFunctionOn({returnByValue:true})` round trip on its OWN `objectId` — the only way a by-value JSON-safe blob (rects/strings/numbers, no DOM handles) leaves a held reference without ever touching a page-observable global. */
export async function readHeldValue<T>(client: CDPClient, objectId: string): Promise<T | undefined> {
  const res = (await client.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function() { return this; }',
    returnByValue: true,
  })) as { result?: { value?: T } };
  return res.result?.value;
}

/**
 * Resolves each numeric-index own property of a held live-array `objectId`
 * to that element's own `objectId`, in exactly ONE `Runtime.getProperties`
 * round trip. `count` bounds the returned array's length (indices outside
 * `[0, count)` are ignored even if present). This is the primitive every
 * collector's CDP-only identity bridge (geometry, hittest, animation)
 * shares — each resolves the `elements` array of its held
 * `{ facts, elements }` container through this, with no page-observable
 * global anywhere.
 */
export async function resolveIndexedObjectIds(
  client: CDPClient,
  arrayObjectId: string,
  count: number,
): Promise<Array<string | undefined>> {
  const out = new Array<string | undefined>(count).fill(undefined);
  if (count <= 0) return out;

  const propsResult = (await client.send('Runtime.getProperties', {
    objectId: arrayObjectId,
    ownProperties: true,
  })) as { result?: Array<{ name: string; value?: { objectId?: string } }> };

  for (const prop of propsResult.result ?? []) {
    if (!/^\d+$/.test(prop.name)) continue;
    const idx = Number(prop.name);
    if (idx < 0 || idx >= count) continue;
    out[idx] = prop.value?.objectId;
  }
  return out;
}

/** Resolves one element's `backendNodeId` from its `objectId` via `DOM.describeNode`. Best-effort — returns `undefined` (never throws) if CDP can't describe the node. */
export async function describeBackendNodeId(client: CDPClient, objectId: string): Promise<number | undefined> {
  try {
    const res = (await client.send('DOM.describeNode', { objectId })) as { node?: { backendNodeId?: number } };
    return res.node?.backendNodeId;
  } catch {
    return undefined;
  }
}

/** Same 8-number validation as `../../coordinates.js`'s private `asQuad` — reimplemented locally because this file needs `DOM.getContentQuads`'s raw quads read independently of `DOM.getBoxModel` (see {@link readContentQuads}/{@link readBoxModel}'s doc comments for why). */
function quadFromPoints(points: number[]): Quad {
  if (points.length !== 8) {
    throw new Error(`Expected an 8-number quad (x1,y1,x2,y2,x3,y3,x4,y4), got ${points.length} numbers`);
  }
  return points as Quad;
}

/**
 * Reads ONLY `DOM.getContentQuads` for one element — deliberately NOT
 * bundled with `DOM.getBoxModel` (unlike `../../coordinates.js`'s
 * `getContentQuadBox`). Empirically confirmed against real Chrome: a
 * `display:none` (or otherwise boxless) element makes
 * `DOM.getContentQuads` resolve normally with a real, honest empty array —
 * never throw — while `DOM.getBoxModel` throws "Could not compute box
 * model" for that SAME element. So this call's own throw can only mean the
 * quad read itself failed (invalid/detached node reference, a protocol
 * error) — never that the element has no layout box, which always surfaces
 * as a clean empty array here instead. Callers must let a throw here
 * propagate as a genuine per-element geometry failure (I-4/I-5), not
 * degrade it to the same shape a real empty result produces.
 */
async function readContentQuads(client: CDPClient, objectId: string): Promise<Quad[]> {
  const res = (await client.send('DOM.getContentQuads', { objectId })) as { quads: number[][] };
  return res.quads.map(quadFromPoints);
}

/**
 * Reads `DOM.getBoxModel` for one element. Callers must only invoke this
 * once {@link readContentQuads} has already proven a real (non-empty) box —
 * see {@link readContentQuads}'s doc comment for why calling this
 * unconditionally would make a genuinely boxless element indistinguishable
 * from an actual box-model read failure.
 */
async function readBoxModel(client: CDPClient, objectId: string): Promise<GeometryBoxModel> {
  const res = (await client.send('DOM.getBoxModel', { objectId })) as {
    model: { content: number[]; padding: number[]; border: number[]; margin: number[]; width: number; height: number };
  };
  const model = res.model;
  return {
    content: quadFromPoints(model.content),
    padding: quadFromPoints(model.padding),
    border: quadFromPoints(model.border),
    margin: quadFromPoints(model.margin),
    width: model.width,
    height: model.height,
  };
}

/** Union AABB of every quad in `quads`, via `axisAlignedRectFromQuad`. Multi-fragment elements (inline runs wrapped across lines) can return more than one quad — this unions them rather than taking `quads[0]`. */
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

// ============================================================================
// Record shapes
// ============================================================================

interface RawFrameFact {
  readonly frameId: string;
  readonly isTopFrame: boolean;
  readonly ancestorFrameIds: string[];
}

interface RawShadowFact {
  readonly inShadowDom: boolean;
  readonly hostSelector?: string;
  readonly chainDepth: number;
}

interface RawStackingContextFact {
  readonly creates: boolean;
  readonly reasons: string[];
}

interface RawVisibilityFact {
  readonly visible: boolean;
  readonly opacity: number;
  readonly displayNone: boolean;
  readonly visibilityHidden: boolean;
  readonly zeroSize: boolean;
}

interface RawClippingFact {
  readonly clippedBy?: string;
  readonly clippedFraction?: number;
}

interface RawFlexFact {
  readonly grow: number;
  readonly shrink: number;
  readonly basis: string;
  readonly alignSelf: string;
  readonly order: number;
  readonly container: {
    readonly direction: string;
    readonly wrap: string;
    readonly justifyContent: string;
    readonly alignItems: string;
    readonly gap: string;
  };
}

interface RawGridFact {
  readonly columnStart: string;
  readonly columnEnd: string;
  readonly rowStart: string;
  readonly rowEnd: string;
  readonly container: {
    readonly templateColumns: string[];
    readonly templateRows: string[];
    readonly columnGap: string;
    readonly rowGap: string;
  };
}

interface RawLayoutFact {
  readonly boxSizing: string;
  readonly position: string;
  readonly display: string;
  readonly overflowX: string;
  readonly overflowY: string;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly contributesOverflowX: boolean;
  readonly contributesOverflowY: boolean;
  readonly minWidth: string;
  readonly maxWidth: string;
  readonly minHeight: string;
  readonly maxHeight: string;
  readonly aspectRatio: string;
  readonly flex: RawFlexFact | null;
  readonly grid: RawGridFact | null;
}

/** Post-cap `grid` fact ({@link capGridFact}'s output) — same shape as {@link RawGridFact} except its track arrays are bounded and carry an explicit dropped-track count per axis, per I-5. */
interface GridFact extends Omit<RawGridFact, 'container'> {
  readonly container: RawGridFact['container'] & {
    /** Count of real `grid-template-columns` tracks the {@link MAX_GRID_TRACKS} cap dropped (0 when nothing was dropped). */
    readonly columnTracksTruncated: number;
    /** Count of real `grid-template-rows` tracks the {@link MAX_GRID_TRACKS} cap dropped (0 when nothing was dropped). */
    readonly rowTracksTruncated: number;
  };
}

/** Post-cap `layout` fact ({@link capLayoutFact}'s output) — same shape as {@link RawLayoutFact} except `grid` is the post-cap {@link GridFact}. */
interface LayoutFact extends Omit<RawLayoutFact, 'grid'> {
  readonly grid: GridFact | null;
}

interface RawGeometryFact {
  readonly idx: number;
  readonly tag: string;
  readonly selector?: string;
  readonly domPath: string;
  readonly text?: string;
  readonly frame: RawFrameFact;
  readonly shadow: RawShadowFact | null;
  readonly zIndex: string;
  readonly stackingContext: RawStackingContextFact;
  readonly visibility: RawVisibilityFact;
  readonly clipping: RawClippingFact | null;
  readonly layout: RawLayoutFact;
  /** Present only on an `<iframe>` element's own fact when its `contentDocument` read threw (G6) -- see {@link GeometryElementRecord.iframeContentUnavailable}. */
  readonly iframeContentUnavailable?: boolean;
  readonly iframeContentUnavailableReason?: GeometryIframeUnavailableReason;
}

/** Fixed, factual reason an `<iframe>` element's same-origin subtree was not walked because reading its `contentDocument` itself failed -- never a raw exception message. A clean `null` (the ordinary cross-origin-iframe case) is NOT this: it throws nothing and is not a read failure, so it carries no marker. */
export type GeometryIframeUnavailableReason = 'content-document-read-threw';

export interface GeometryBoxModel {
  readonly content: Quad;
  readonly padding: Quad;
  readonly border: Quad;
  readonly margin: Quad;
  readonly width: number;
  readonly height: number;
}

/** `geometry.json` per-element record shape — mirrors {@link ElementRecord} but requires `backendNodeId: number | null` (never omitted) plus an honest `identityUnresolved` marker when identity resolution failed, the same shape `hittest.ts`/`text.ts` already use (I-3/I-5). */
export interface GeometryElementRecord extends Omit<ElementRecord, 'backendNodeId'> {
  readonly id: string;
  readonly tag: string;
  readonly domPath: string;
  readonly frame: RawFrameFact;
  readonly shadow: RawShadowFact | null;
  readonly rect: Rect;
  readonly quads: Quad[];
  readonly boxModel: GeometryBoxModel | null;
  readonly zIndex: string;
  readonly stackingContext: RawStackingContextFact;
  readonly visibility: RawVisibilityFact;
  readonly clipping: RawClippingFact | null;
  readonly layout: LayoutFact;
  /** `null` (never an omitted key) when this record's identity did not resolve — see {@link identityUnresolved}. */
  readonly backendNodeId: number | null;
  /** `true` when {@link backendNodeId} is `null` because identity resolution failed (no bridged `objectId`, or `DOM.describeNode` threw/returned nothing) — never omit this alongside a `null` backendNodeId, so a downstream join can never mistake an unresolved record for a resolved one. Absent (not `false`) when identity resolved. */
  readonly identityUnresolved?: true;
  /**
   * `true` when this record's per-element CDP geometry read did not fully
   * succeed — see {@link geometryUnavailableReason} for which read failed.
   * When `true`:
   *  - `quads-read-threw`/`no-element-object-id`: `DOM.getContentQuads`
   *    never ran (no bridged `objectId`) or threw (a genuine read failure,
   *    NOT proof of "no layout box" — a real no-box element resolves
   *    `DOM.getContentQuads` with a clean empty array instead of throwing).
   *    `rect` stays the placeholder zero rect, `quads` stays `[]`,
   *    `boxModel` stays `null`, and `visibility.zeroSize`/`visibility.visible`
   *    fall back to the JS-side (`getBoundingClientRect()`) facts alone —
   *    NEVER the CDP-quad-derived zero-size/invisible shape a genuine
   *    empty-quads result earns (I-4/I-5).
   *  - `box-model-read-threw`: `DOM.getContentQuads` succeeded with a real
   *    (non-empty) box, so `rect`/`quads`/`visibility.zeroSize`/`visibility.visible`
   *    ARE a proven observation and are computed normally — only `boxModel`
   *    (padding/border/margin detail) stays `null`, honestly marked as an
   *    unread detail rather than "this element genuinely has no box".
   *
   * Absent (not `false`) when the per-element geometry read fully succeeded.
   */
  readonly geometryUnavailable?: true;
  /** Present only when {@link geometryUnavailable} is `true`. */
  readonly geometryUnavailableReason?: GeometryElementUnavailableReason;
  /** `true` on an `<iframe>` element's own record when its `contentDocument` read THREW (G6) — its same-origin subtree was never walked because the read itself failed, not because the frame is genuinely cross-origin/childless (that case throws nothing and carries no marker). Absent (not `false`) otherwise, including for a non-iframe element or an iframe whose subtree walked normally or was genuinely cross-origin/empty. */
  readonly iframeContentUnavailable?: true;
  /** Present only when {@link iframeContentUnavailable} is `true`. */
  readonly iframeContentUnavailableReason?: GeometryIframeUnavailableReason;
}

/**
 * Fixed, factual reason a single element's `DOM.getContentQuads`/
 * `DOM.getBoxModel` read did not complete — never a raw exception message.
 * Present only on {@link GeometryElementRecord.geometryUnavailable}.
 *
 * - `no-element-object-id`: this element's index never resolved to a
 *   bridged `objectId` at all (the `elements` bridge array had no entry for
 *   it), so the quad/box read was never even attempted.
 * - `quads-read-threw`: a bridged `objectId` existed, but `DOM.getContentQuads`
 *   itself threw — a genuine failure (invalid/detached node reference, a
 *   protocol error), distinct from the clean empty array a real
 *   no-layout-box element (e.g. `display:none`) returns without throwing.
 * - `box-model-read-threw`: `DOM.getContentQuads` succeeded with a real,
 *   non-empty box, but the follow-up `DOM.getBoxModel` detail read threw —
 *   `rect`/`quads`/visibility are still trustworthy; only `boxModel` is
 *   unavailable.
 */
export type GeometryElementUnavailableReason = 'no-element-object-id' | 'quads-read-threw' | 'box-model-read-threw';

/** Builds the honest `{ backendNodeId, identityUnresolved }` pair every geometry element-bearing record carries — `null` (never an omitted key) when identity did not resolve, mirroring `hittest.ts`'s/`text.ts`'s `resolvedIdentity` (I-3/I-5). */
function resolvedIdentity(backendNodeId: number | undefined): { backendNodeId: number | null; identityUnresolved?: true } {
  return backendNodeId === undefined ? { backendNodeId: null, identityUnresolved: true } : { backendNodeId };
}

// ============================================================================
// String-sanitizing — `layout` (and its nested `flex`/`grid` facts) is a
// page-controlled bag of computed-CSS-value strings, exactly like
// selector/domPath/text above. Each string is routed through the single
// redaction.ts `sanitizeString` authority (capped at CSS_VALUE_MAX),
// never a private capper. `capTrackList` additionally
// bounds the grid template-track ARRAY itself (a pathological
// `grid-template-columns: repeat(100000, 1fr)` would otherwise emit an
// unbounded array of per-track strings) through the one authoritative
// array-capper (`capArray`, `redaction.ts`), reporting how many real tracks
// it dropped rather than silently slicing them away.
// ============================================================================

/** Cap for ordinary computed-CSS-value strings (position/display/min-max sizes/flex+grid provenance). */
const CSS_VALUE_MAX = 200;
/** Cap on how many grid template-track strings are kept per axis. */
const MAX_GRID_TRACKS = 64;

function capTrackList(values: readonly string[]): { items: string[]; truncated: number } {
  const { items, truncated } = capArray(values, MAX_GRID_TRACKS);
  return { items: items.map((v) => sanitizeString(v, { max: CSS_VALUE_MAX })), truncated };
}

function capFlexFact(flex: RawFlexFact): RawFlexFact {
  return {
    ...flex,
    basis: sanitizeString(flex.basis, { max: CSS_VALUE_MAX }),
    alignSelf: sanitizeString(flex.alignSelf, { max: CSS_VALUE_MAX }),
    container: {
      ...flex.container,
      direction: sanitizeString(flex.container.direction, { max: CSS_VALUE_MAX }),
      wrap: sanitizeString(flex.container.wrap, { max: CSS_VALUE_MAX }),
      justifyContent: sanitizeString(flex.container.justifyContent, { max: CSS_VALUE_MAX }),
      alignItems: sanitizeString(flex.container.alignItems, { max: CSS_VALUE_MAX }),
      gap: sanitizeString(flex.container.gap, { max: CSS_VALUE_MAX }),
    },
  };
}

function capGridFact(grid: RawGridFact): GridFact {
  const columns = capTrackList(grid.container.templateColumns);
  const rows = capTrackList(grid.container.templateRows);
  return {
    ...grid,
    columnStart: sanitizeString(grid.columnStart, { max: CSS_VALUE_MAX }),
    columnEnd: sanitizeString(grid.columnEnd, { max: CSS_VALUE_MAX }),
    rowStart: sanitizeString(grid.rowStart, { max: CSS_VALUE_MAX }),
    rowEnd: sanitizeString(grid.rowEnd, { max: CSS_VALUE_MAX }),
    container: {
      ...grid.container,
      templateColumns: columns.items,
      templateRows: rows.items,
      columnTracksTruncated: columns.truncated,
      rowTracksTruncated: rows.truncated,
      columnGap: sanitizeString(grid.container.columnGap, { max: CSS_VALUE_MAX }),
      rowGap: sanitizeString(grid.container.rowGap, { max: CSS_VALUE_MAX }),
    },
  };
}

function capLayoutFact(layout: RawLayoutFact): LayoutFact {
  return {
    ...layout,
    boxSizing: sanitizeString(layout.boxSizing, { max: CSS_VALUE_MAX }),
    position: sanitizeString(layout.position, { max: CSS_VALUE_MAX }),
    display: sanitizeString(layout.display, { max: CSS_VALUE_MAX }),
    overflowX: sanitizeString(layout.overflowX, { max: CSS_VALUE_MAX }),
    overflowY: sanitizeString(layout.overflowY, { max: CSS_VALUE_MAX }),
    minWidth: sanitizeString(layout.minWidth, { max: CSS_VALUE_MAX }),
    maxWidth: sanitizeString(layout.maxWidth, { max: CSS_VALUE_MAX }),
    minHeight: sanitizeString(layout.minHeight, { max: CSS_VALUE_MAX }),
    maxHeight: sanitizeString(layout.maxHeight, { max: CSS_VALUE_MAX }),
    aspectRatio: sanitizeString(layout.aspectRatio, { max: CSS_VALUE_MAX }),
    flex: layout.flex ? capFlexFact(layout.flex) : null,
    grid: layout.grid ? capGridFact(layout.grid) : null,
  };
}

// ============================================================================
// Collector
// ============================================================================

/**
 * Fixed, factual reason the walk evaluate/bridge could not be read (never a
 * raw exception message, which is unbounded/page-influenced) — present
 * only when {@link GeometryJson.available} is `false`.
 *
 * - `walk-facts-unavailable`: the held container came back without a
 *   `facts` objectId, OR `readHeldValue()` resolved (without throwing) to
 *   `undefined` — either way the required `facts` read did not happen, so
 *   both collapse to the one reason rather than two indistinguishable
 *   ones.
 * - `walk-meta-unavailable`: `facts` read successfully, but the held
 *   container's `meta` objectId was absent or its `readHeldValue()` also
 *   resolved to `undefined`. Since `meta` rides the SAME returned object
 *   literal as `facts` (`{ facts, elements, meta }`, one evaluate), `meta`
 *   going missing right after `facts` succeeded signals a broken bridge
 *   read, not "nothing was truncated" — so this collapses the whole
 *   collection to unavailable rather than silently stamping
 *   `elementsTruncated: 0`.
 */
export type GeometryUnavailableReason =
  | 'walk-evaluate-threw'
  | 'walk-evaluate-returned-no-object'
  | 'walk-facts-unavailable'
  | 'walk-meta-unavailable';

export interface GeometryJson {
  readonly elements: GeometryElementRecord[];
  /** Exact count of real elements the {@link MAX_ELEMENTS} cap chose not to record — always present (0 when the whole reachable tree fit), per I-5. When {@link elementsTruncatedUnknown} is `true` this is a `0` placeholder, not a proven count — see that field. */
  readonly elementsTruncated: number;
  /** `true` when the held `meta` object read successfully (so `available` stays `true`) but its `elementsTruncated` field was missing or not a number — a malformed named field on an otherwise-vouched-for object (Layer 2, I-4/I-5). `elementsTruncated` is then `0` as a placeholder, never a proven observation of "nothing was truncated". Absent (not `false`) when `elementsTruncated` read as a real number. */
  readonly elementsTruncatedUnknown?: true;
  /** `false` when the walk evaluate/bridge itself failed — `elements: []` + `elementsTruncated: 0` is then "could not collect", not "genuinely empty page" (I-4/I-5). Always `true` on a normal run, including one where the page really has zero elements. */
  readonly available: boolean;
  /** Present only when `available` is `false`. */
  readonly unavailableReason?: GeometryUnavailableReason;
  readonly unstableRegions?: string[];
  /** True when the try/finally release of a held CDP bridge object threw — never a diagnosis, never page-observable state. Absent when release succeeded. */
  readonly bridgeCleanupFailed?: boolean;
}

export const collectGeometry: Collector = async (ctx) => {
  let raw: RawGeometryFact[] = [];
  let objectIds: Array<string | undefined> = [];
  let elementsTruncated = 0;
  let elementsTruncatedUnknown = false;
  let bridgeCleanupFailed = false;
  // I-5/I-4: distinguishes "the walk evaluate/bridge failed" from "the page
  // really has zero elements" -- both would otherwise collapse to the same
  // empty `elements` array with elementsTruncated:0, falsely claiming
  // nothing was dropped when in fact nothing was ever read.
  let available = true;
  let unavailableReason: GeometryUnavailableReason | undefined;
  const heldObjectIds: string[] = [];
  try {
    const walkEval = (await ctx.client.send('Runtime.evaluate', {
      expression: SELECTOR_HELPER_JS + buildGeometryWalkScript(MAX_ELEMENTS),
      returnByValue: false,
    })) as { result?: { objectId?: string } };
    const resultObjectId = walkEval.result?.objectId;

    if (resultObjectId) {
      heldObjectIds.push(resultObjectId);
      const containerIds = await ownPropertyObjectIds(ctx.client, resultObjectId);
      const factsObjectId = containerIds.get('facts');
      const elementsObjectId = containerIds.get('elements');
      const metaObjectId = containerIds.get('meta');

      // I-4: a missing objectId for a required held property, OR a
      // readHeldValue() that resolves (without throwing) to `undefined`, is
      // the SAME fact as a thrown read -- the property was never actually
      // read. Read both before deciding success/failure so neither can
      // silently fall through to the initialized empty/default artifact.
      let factsValue: RawGeometryFact[] | undefined;
      if (factsObjectId) {
        heldObjectIds.push(factsObjectId);
        factsValue = await readHeldValue<RawGeometryFact[]>(ctx.client, factsObjectId);
      }

      let metaValue: { elementsTruncated?: unknown } | undefined;
      if (metaObjectId) {
        heldObjectIds.push(metaObjectId);
        metaValue = await readHeldValue<{ elementsTruncated?: unknown }>(ctx.client, metaObjectId);
      }

      if (factsValue === undefined) {
        available = false;
        unavailableReason = 'walk-facts-unavailable';
      } else if (metaValue === undefined) {
        // `meta` rides the same returned object literal as `facts` -- its
        // absence right after a successful `facts` read signals a broken
        // bridge read, not "the walk truncated nothing". Treat the whole
        // collection as unavailable rather than stamping elementsTruncated:0.
        available = false;
        unavailableReason = 'walk-meta-unavailable';
      } else {
        raw = factsValue;
        // G17 (Layer 2): `meta` itself vouched for (its objectId resolved and
        // readHeldValue() returned a real object above), but its named
        // `elementsTruncated` FIELD may still be malformed (missing, or not a
        // number) -- `?? 0` would silently treat that as a proven "nothing
        // truncated" observation. Only a genuine number is trusted; anything
        // else marks elementsTruncatedUnknown rather than defaulting mute.
        if (typeof metaValue.elementsTruncated === 'number') {
          elementsTruncated = metaValue.elementsTruncated;
        } else {
          elementsTruncated = 0;
          elementsTruncatedUnknown = true;
        }

        if (elementsObjectId && raw.length > 0) {
          heldObjectIds.push(elementsObjectId);
          objectIds = await resolveIndexedObjectIds(ctx.client, elementsObjectId, raw.length);
        }
      }
    } else {
      available = false;
      unavailableReason = 'walk-evaluate-returned-no-object';
    }
  } catch {
    raw = [];
    available = false;
    unavailableReason = 'walk-evaluate-threw';
  } finally {
    for (const id of heldObjectIds) {
      try {
        await ctx.client.send('Runtime.releaseObject', { objectId: id });
      } catch {
        bridgeCleanupFailed = true;
      }
    }
  }

  const elements: GeometryElementRecord[] = [];
  if (raw.length > 0) {
    const resolved = await Promise.all(
        raw.map(async (fact): Promise<GeometryElementRecord> => {
          const objectId = objectIds[fact.idx];
          let backendNodeId: number | undefined;
          let quads: Quad[] = [];
          let boxModel: GeometryBoxModel | null = null;
          // I-4/I-5: `quadsUnavailable` drives whether zeroSize/visible below
          // fall back to the JS-side facts alone -- true only when the
          // per-element DOM.getContentQuads read itself never proved
          // anything (never ran, or threw). A DOM.getBoxModel-only failure
          // (quadsUnavailable stays false) does NOT trigger that fallback,
          // since real quads already proved rect/visibility honestly.
          let quadsUnavailable = false;
          let geometryUnavailableReason: GeometryElementUnavailableReason | undefined;

          if (objectId) {
            backendNodeId = await describeBackendNodeId(ctx.client, objectId);
            try {
              quads = await readContentQuads(ctx.client, objectId);
            } catch {
              // A thrown DOM.getContentQuads read is a genuine failure, NOT
              // proof of "no layout box" -- Chrome resolves that case with a
              // real, non-throwing empty array instead (see readContentQuads's
              // doc comment). Surface it honestly rather than degrading to
              // the same zero-size/invisible shape a real empty result earns.
              quadsUnavailable = true;
              geometryUnavailableReason = 'quads-read-threw';
            }

            if (!quadsUnavailable && quads.length > 0) {
              // Only attempt DOM.getBoxModel once real quads proved a box
              // exists -- Chrome throws "Could not compute box model" for
              // EVERY boxless node (the identical throw an actual failed
              // read produces), so calling it unconditionally would make a
              // genuine no-layout-box element indistinguishable from a real
              // box-model read failure.
              try {
                boxModel = await readBoxModel(ctx.client, objectId);
              } catch {
                geometryUnavailableReason = 'box-model-read-threw';
              }
            }
          } else {
            // No bridged objectId at all for this element -- the quad/box
            // read was never even attempted, so it must not silently degrade
            // into the same zero-size/invisible shape a genuine no-layout-box
            // element gets.
            quadsUnavailable = true;
            geometryUnavailableReason = 'no-element-object-id';
          }

          const geometryUnavailable = geometryUnavailableReason !== undefined;
          const rect = quads.length > 0 ? unionRect(quads) : { x: 0, y: 0, width: 0, height: 0 };
          // Only a REAL (non-throwing) quads read can strengthen zeroSize/visible
          // beyond the JS-side facts -- when the quads read itself never proved
          // anything, fall back to fact.visibility (getBoundingClientRect())
          // alone rather than a fabricated CDP-derived zero-size/invisible claim.
          const zeroSize = quadsUnavailable ? fact.visibility.zeroSize : fact.visibility.zeroSize || quads.length === 0;
          const visible = quadsUnavailable ? fact.visibility.visible : fact.visibility.visible && quads.length > 0;

          return {
            id: `el-${fact.idx}`,
            tag: sanitizeString(fact.tag, { max: 64 }),
            selector: fact.selector !== undefined ? sanitizeString(fact.selector, { max: 300 }) : undefined,
            domPath: sanitizeString(fact.domPath, { max: 500 }),
            ...resolvedIdentity(backendNodeId),
            text: fact.text !== undefined ? sanitizeString(fact.text, { max: 200 }) : undefined,
            frame: fact.frame,
            shadow: fact.shadow
              ? {
                  ...fact.shadow,
                  hostSelector:
                    fact.shadow.hostSelector !== undefined ? sanitizeString(fact.shadow.hostSelector, { max: 300 }) : undefined,
                }
              : null,
            rect,
            quads,
            boxModel,
            zIndex: sanitizeString(fact.zIndex, { max: 20 }),
            stackingContext: fact.stackingContext,
            visibility: { ...fact.visibility, visible, zeroSize },
            clipping: fact.clipping
              ? {
                  clippedBy:
                    fact.clipping.clippedBy !== undefined ? sanitizeString(fact.clipping.clippedBy, { max: 300 }) : undefined,
                  clippedFraction: fact.clipping.clippedFraction,
                }
              : null,
            layout: capLayoutFact(fact.layout),
            ...(geometryUnavailable ? { geometryUnavailable: true as const, geometryUnavailableReason } : {}),
            ...(fact.iframeContentUnavailable
              ? { iframeContentUnavailable: true as const, iframeContentUnavailableReason: fact.iframeContentUnavailableReason }
              : {}),
          };
      }),
    );
    elements.push(...resolved);
  }

  ctx.write.json('geometry.json', {
    elements,
    // Exact count of real elements the MAX_ELEMENTS cap chose not to record
    // (0 when the whole reachable tree fit) -- always present, never a
    // silently-omitted field, per I-5.
    elementsTruncated,
    ...(elementsTruncatedUnknown ? { elementsTruncatedUnknown: true } : {}),
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
    ...(ctx.unstableRegions.length ? { unstableRegions: [...ctx.unstableRegions] } : {}),
    ...(bridgeCleanupFailed ? { bridgeCleanupFailed: true } : {}),
  } satisfies GeometryJson);
};
