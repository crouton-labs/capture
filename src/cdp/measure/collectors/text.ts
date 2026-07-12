/**
 * `text.json` collector — per-text-bearing-element line boxes (from
 * `Range.getClientRects`), binary-searched wrap points, baseline metrics,
 * writing-mode/bidi rect order, truncation facts, and platform font
 * fallback facts (`CSS.getPlatformFontsForNode`). Text content is preserved
 * up to the shared structural output cap.
 *
 * All measurement happens inside one `Runtime.evaluate` walk of the live
 * page (line boxes via native `Range.getClientRects`, baselines
 * approximated via an offscreen `<canvas>` `measureText` per the design's
 * "canvas measureText only as a supplemental metric, not the rendered
 * truth" — the line rects themselves ARE the rendered truth). The walk
 * never mutates the DOM AND never assigns anything to `window` or any
 * other page-observable location: its return value (a plain in-memory
 * `{ facts, elements }` object, never a global) is read back purely
 * through CDP's own remote-object identity — `Runtime.evaluate({
 * returnByValue: false})` hands back an `objectId` for that object with
 * zero page visibility into it, `Runtime.getProperties` resolves each of
 * `facts`'/`elements`'s own `objectId`s, `Runtime.callFunctionOn({
 * returnByValue: true})` reads `facts` out by value, and a second
 * `Runtime.getProperties` on `elements` resolves each matched element's
 * own `objectId` (the CDP identity bridge). A page can predefine a setter
 * for any global name it can guess; it can observe nothing here, because
 * nothing is ever set on it. Each element's stable CDP `backendNodeId`
 * (the cross-artifact join key) is then resolved via one
 * `DOM.describeNode` per resolved element for both `nodeId` — the only
 * identifier `CSS.getPlatformFontsForNode` accepts — and `backendNodeId`.
 * No `setAttribute`/`removeAttribute` pair and no page-observable global
 * either, so nothing in the emitted `screenshot.png`/`dom.html`/any other
 * baseline collector running concurrently in the same `Promise.all` (see
 * `snapshot.ts`) can ever observe this collector having run.
 */

import type { CDPClient } from '../../client.js';
import type { Collector, ElementRecord } from '../types.js';
import { capArray, capString, sanitizeString } from '../redaction.js';

/** Hard cap on line boxes emitted per text element — `Range.getClientRects` is bounded by real layout, but the array is page-shaped, so this caps it for parity with geometry's track cap; the overflow is a factual `linesTruncated` count. */
const MAX_TEXT_LINES = 500;

/** Hard cap on text-bearing elements emitted per snapshot — the single source of truth for the page-side walk's own `MAX_ELEMENTS` (interpolated into `TEXT_WALK_EXPRESSION` below) and for the host-side `elementsTruncated` fact, so the two can never drift apart. */
const MAX_TEXT_ELEMENTS = 800;

/** CSS `direction` computed-style values — never anything else. */
const DIRECTION_ALLOWLIST = new Set(['ltr', 'rtl', 'auto']);
/** CSS `writing-mode` keyword set (modern values; legacy `lr-tb`/`rl-tb`/`tb-rl` deliberately excluded — not emitted by any current browser's `getComputedStyle`). */
const WRITING_MODE_ALLOWLIST = new Set(['horizontal-tb', 'vertical-rl', 'vertical-lr', 'sideways-rl', 'sideways-lr']);
/** `bidiOrder` is derived page-side from computed `direction`; it is still a page-controlled value that must be pinned to a known keyword rather than trusted raw. */
const BIDI_ORDER_ALLOWLIST = new Set(['ltr', 'rtl', 'mixed']);
/** The three truncation-facts this collector reports; any other page-controlled value normalizes to `'unknown'`. */
const TRUNCATION_STYLE_ALLOWLIST = new Set(['ellipsis', 'clip', 'none']);

/** Normalizes a page-controlled enum-ish computed-style string to a known value, else `'unknown'` — never preserves an arbitrary raw string for a field that should only ever hold one of a fixed set of CSS keywords. */
function normalizeEnum(value: string, allowlist: ReadonlySet<string>): string {
  return allowlist.has(value) ? value : 'unknown';
}

interface RawLineBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly baseline: number | null;
  /** `true` when `baseline` came from the crude `rect.height * 0.2` heuristic (no real per-font descent metric available) rather than the canvas `TextMetrics.actualBoundingBoxDescent` reading — the honest I-4 marker so a derived guess is never mistaken for a font-metric-backed value. Meaningless when `baseline` is `null` (already an honest "unavailable", not an estimate). */
  readonly baselineApproximate: boolean;
}

interface RawTextRecord {
  readonly markId: string;
  readonly selector: string;
  readonly text: string;
  readonly lines: RawLineBox[];
  /** One entry per line boundary (`lineRects.length - 1` entries). A `number` is a measured wrap offset; `null` means the binary search's `Range.setStart`/`setEnd` failed mid-search for that boundary — the search invariant broke, so no offset is emitted at all rather than an exact-looking but unverified guess (I-4). An index past the end of this array (never `null`) means there is no such boundary, i.e. the last line. */
  readonly wrapOffsets: Array<number | null>;
  readonly writingMode: string;
  readonly direction: string;
  readonly bidiOrder: 'ltr' | 'rtl' | 'mixed';
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontWeight: string;
  readonly lineHeight: string;
  readonly isContentEditable: boolean;
  readonly truncated: boolean;
  readonly truncationStyle: 'ellipsis' | 'clip' | 'none';
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

/**
 * The page-side walk. Runs once via `Runtime.evaluate({returnByValue:
 * true})`. Finds every visible element whose DIRECT (non-descendant-owned)
 * text-node children carry non-whitespace text — i.e. text-bearing leaf
 * runs, not every ancestor that merely contains text somewhere inside it —
 * so each rendered text run is reported once, not once per ancestor.
 */
const TEXT_WALK_EXPRESSION = `(() => {
  const MAX_ELEMENTS = ${MAX_TEXT_ELEMENTS};
  const results = [];
  const elements = [];
  let counter = 0;

  function cssSelector(el) {
    if (el.id) return '#' + el.id;
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      let part = node.tagName.toLowerCase();
      if (node.classList && node.classList.length) {
        part += '.' + Array.from(node.classList).slice(0, 3).join('.');
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
      depth += 1;
    }
    return parts.join(' > ');
  }

  function isVisible(el) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function directTextNodes(el) {
    const out = [];
    for (const child of el.childNodes) {
      if (child.nodeType === 3 && child.textContent && child.textContent.trim().length > 0) {
        out.push(child);
      }
    }
    return out;
  }

  let __canvas = null;
  function baselineFor(rect, fontString) {
    if (!__canvas) __canvas = document.createElement('canvas');
    const ctx = __canvas.getContext('2d');
    if (!ctx) return { value: null, approximate: false };
    try {
      ctx.font = fontString;
      const m = ctx.measureText('Hg');
      const hasExactDescent = typeof m.actualBoundingBoxDescent === 'number' && m.actualBoundingBoxDescent > 0;
      const descent = hasExactDescent ? m.actualBoundingBoxDescent : rect.height * 0.2;
      return { value: rect.bottom - descent, approximate: !hasExactDescent };
    } catch (e) {
      return { value: null, approximate: false };
    }
  }

  function findWrapOffsets(textNode, fullText, lineRects) {
    if (lineRects.length <= 1) return [];
    const offsets = [];
    let searchStart = 0;
    for (let i = 0; i < lineRects.length - 1; i++) {
      const nextTop = lineRects[i + 1].y;
      let lo = searchStart;
      let hi = fullText.length;
      let rangeOpFailed = false;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const r = document.createRange();
        try {
          r.setStart(textNode, mid);
          r.setEnd(textNode, Math.min(mid + 1, fullText.length));
        } catch (e) {
          // A Range.setStart/setEnd failure mid-binary-search breaks the
          // search invariant — any lo/hi bound the loop would still produce
          // is an unverified guess, not a measured wrap point. Abandon the
          // search for THIS boundary rather than mutating hi=mid and
          // continuing, which previously emitted an exact-looking but
          // silently corrupted offset (I-4).
          rangeOpFailed = true;
          break;
        }
        const rects = r.getClientRects();
        const top = rects.length ? rects[0].y : null;
        if (top !== null && top >= nextTop - 1) hi = mid;
        else lo = mid + 1;
      }
      if (rangeOpFailed) {
        // null (never a number) marks this boundary's wrap offset as
        // honestly unavailable — distinct from an out-of-range array index
        // (which means "no such boundary", i.e. the last line), so the host
        // side can tell a corrupted-search boundary apart from a normal one.
        offsets.push(null);
        // searchStart intentionally NOT advanced to a corrupted bound — the
        // next boundary's search must not be seeded from an unverified lo.
      } else {
        offsets.push(lo);
        searchStart = lo;
      }
    }
    return offsets;
  }

  const candidates = document.querySelectorAll('body, body *');
  // D-C: elementsTotal counts every visible, text-bearing candidate this
  // walk finds — including those past MAX_ELEMENTS, cheaply (no Range/rect
  // work for them) — so the host can report an honest total-vs-kept
  // truncation fact instead of a silent MAX_ELEMENTS drop.
  let elementsTotal = 0;
  for (const el of candidates) {
    if (!(el instanceof Element)) continue;
    if (!isVisible(el)) continue;
    const textNodes = directTextNodes(el);
    if (!textNodes.length) continue;
    elementsTotal += 1;
    if (results.length >= MAX_ELEMENTS) continue;

    const range = document.createRange();
    range.setStart(textNodes[0], 0);
    const lastNode = textNodes[textNodes.length - 1];
    range.setEnd(lastNode, lastNode.textContent.length);
    const clientRects = Array.from(range.getClientRects());
    if (!clientRects.length) continue;

    const style = getComputedStyle(el);
    const fontString = style.fontStyle + ' ' + style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
    const fullText = textNodes.map((n) => n.textContent).join('');

    const lines = clientRects.map((r) => {
      const b = baselineFor(r, fontString);
      return { x: r.x, y: r.y, width: r.width, height: r.height, baseline: b.value, baselineApproximate: b.approximate };
    });

    const wrapOffsets = textNodes.length === 1 ? findWrapOffsets(textNodes[0], fullText, clientRects) : [];

    const dir = style.direction === 'rtl' ? 'rtl' : 'ltr';
    const scrollWidth = el.scrollWidth;
    const clientWidth = el.clientWidth;
    const overflowClip = scrollWidth > clientWidth;
    const truncationStyle = !overflowClip ? 'none' : style.textOverflow === 'ellipsis' ? 'ellipsis' : 'clip';

    const markId = 'txt-' + (counter++);
    elements.push(el);

    results.push({
      markId: markId,
      selector: cssSelector(el),
      text: fullText,
      lines: lines,
      wrapOffsets: wrapOffsets,
      writingMode: style.writingMode,
      direction: style.direction,
      bidiOrder: dir,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      isContentEditable: !!el.isContentEditable,
      truncated: overflowClip,
      truncationStyle: truncationStyle,
      scrollWidth: scrollWidth,
      clientWidth: clientWidth,
    });
  }

  // Frame/shadow scope facts (D5): the walk is top-document, non-piercing,
  // so iframe and shadow-DOM text is absent from this artifact. Count them
  // so downstream reads omission as an explicit scope fact, not a negative.
  const iframesNotWalked = document.querySelectorAll('iframe').length;
  let shadowRootsNotWalked = 0;
  const allEls = document.querySelectorAll('*');
  for (const e of allEls) { if (e.shadowRoot) shadowRootsNotWalked++; }
  return {
    facts: { records: results, iframesNotWalked: iframesNotWalked, shadowRootsNotWalked: shadowRootsNotWalked, elementsTotal: elementsTotal },
    elements: elements,
  };
})()`;

interface PlatformFontFact {
  readonly familyName: string;
  readonly isCustomFont: boolean;
  readonly glyphCount?: number;
}

interface TextWalkResult {
  readonly records: RawTextRecord[];
  readonly iframesNotWalked: number;
  readonly shadowRootsNotWalked: number;
  /** Total visible, text-bearing candidates the walk found, BEFORE the `MAX_ELEMENTS` cap — always `>= records.length`; the gap is what `elementsTruncated` (I-5) reports rather than silently dropping. */
  readonly elementsTotal: number;
}

/** Fixed, factual reason the walk evaluate/bridge could not be read (never a raw exception message, which is unbounded/page-influenced) — present only when {@link TextJson.available} is `false`. `walk-evaluate-threw` covers `Runtime.evaluate`, the held-container `Runtime.getProperties`, or the held-`facts` `Runtime.callFunctionOn` rejecting outright. `walk-facts-unavailable` covers BOTH a missing `facts` objectId on the held container and a `readHeldValue()` that resolves without throwing but returns `undefined` — either way the required read did not happen, so it collapses to one reason rather than two indistinguishable-in-practice ones (mirrors `hittest.ts`). */
export type TextUnavailableReason =
  | 'walk-evaluate-threw'
  | 'walk-evaluate-returned-no-object'
  | 'walk-facts-unavailable'
  /** T11 (I-4/I-5, Layer 2): the held facts object read back fine, but its `records` field was missing/malformed — distinct from `walk-facts-unavailable` (the facts read never happened at all). */
  | 'walk-records-malformed';

interface DescribedNodeIds {
  readonly nodeId?: number;
  readonly backendNodeId?: number;
}

/**
 * Resolves both the CDP `nodeId` (the only identifier
 * `CSS.getPlatformFontsForNode` accepts — it has no `backendNodeId`/
 * `objectId` variant) and the stable `backendNodeId` (the cross-artifact
 * join key) from one element's `objectId`, via a single `DOM.describeNode`
 * call — no live-DOM marker attribute, no `DOM.getDocument` tree walk.
 * Best-effort: returns `{}` (never throws) if CDP can't describe the node.
 */
async function describeNodeIds(client: CDPClient, objectId: string): Promise<DescribedNodeIds> {
  try {
    const res = (await client.send('DOM.describeNode', { objectId })) as {
      node?: { nodeId?: number; backendNodeId?: number };
    };
    return { nodeId: res.node?.nodeId, backendNodeId: res.node?.backendNodeId };
  } catch {
    return {};
  }
}

/** Fixed, factual reason the per-element platform-font source (`CSS.getPlatformFontsForNode`) could not be read — never a raw exception message. `platform-fonts-node-id-unresolved` covers both "no bridged `objectId`" and "`DOM.describeNode` didn't return a `nodeId`" (the CDP call was never even attempted); `platform-fonts-read-threw` covers `CSS.getPlatformFontsForNode` itself rejecting. Present only when {@link TextElementRecord.platformFontsAvailable} is `false`. */
export type PlatformFontsUnavailableReason =
  | 'platform-fonts-node-id-unresolved'
  | 'platform-fonts-read-threw'
  /** T14 (I-4/I-5, Layer 2): `CSS.getPlatformFontsForNode` resolved without throwing, but its `fonts` field was missing/malformed — distinct from a genuine successful read that legitimately found zero fonts. */
  | 'platform-fonts-malformed';

/** `text.json` per-element record shape — mirrors {@link ElementRecord} but requires `backendNodeId: number | null` (never omitted) plus an honest `identityUnresolved` marker when identity resolution failed, the same shape `hittest.ts` already uses (I-3/I-5). */
interface TextElementRecord extends Omit<ElementRecord, 'backendNodeId'> {
  readonly backendNodeId: number | null;
  /** `true` when {@link backendNodeId} is `null` because identity resolution failed (no bridged `objectId`, or `DOM.describeNode` threw/returned nothing) — never omit this alongside a `null` backendNodeId, so a downstream join can never mistake an unresolved record for a resolved one. Absent (not `false`) when identity resolved. */
  readonly identityUnresolved?: true;
  /** `false` only when the platform-font source read could not be attempted or threw — NEVER when the browser genuinely reported zero platform fonts for this element (that is a real `platformFonts: []` with `platformFontsAvailable: true`). Always present (I-5) so "could not read" and "read, genuinely empty" are never the same shape. */
  readonly platformFontsAvailable: boolean;
  /** Present only when {@link platformFontsAvailable} is `false`. */
  readonly platformFontsUnavailableReason?: PlatformFontsUnavailableReason;
}

/** Builds the honest `{ backendNodeId, identityUnresolved }` pair every text-bearing record carries — `null` (never an omitted key) when identity did not resolve, mirroring `hittest.ts`'s `resolvedIdentity` (I-3/I-5). */
function resolvedIdentity(backendNodeId: number | undefined): { backendNodeId: number | null; identityUnresolved?: true } {
  return backendNodeId === undefined ? { backendNodeId: null, identityUnresolved: true } : { backendNodeId };
}

/** `text.json`'s on-disk shape. */
export interface TextJson {
  readonly elements: TextElementRecord[];
  readonly coverage: Record<string, unknown>;
  /** `false` when the walk's held `facts` could not be read — `elements: []` with an all-zero `coverage` is then "could not collect", not "genuinely no text on the page" (I-4/I-5). Always `true` on a normal run, including one where the page really has no text-bearing elements. */
  readonly available: boolean;
  /** Present only when `available` is `false`. */
  readonly unavailableReason?: TextUnavailableReason;
  readonly bridgeCleanupFailed?: boolean;
}

// ============================================================================
// CDP-only identity bridge — reads the walk's held return value (a plain
// `{ facts, elements }` object CDP hands back as a `RemoteObject`) purely
// through `Runtime.getProperties`/`Runtime.callFunctionOn`/
// `Runtime.releaseObject`. NONE of these ever assigns to `window` or any
// other page-observable location, so a page that predefines a setter for
// a guessed global name (the exact reported attack) has nothing to
// observe: this collector never sets a property on anything the page can
// see.
// ============================================================================

/** Resolves each own-property `objectId` of a held CDP object in one `Runtime.getProperties` round trip — how `facts`/`elements` are found inside the walk's held result container. */
async function ownPropertyObjectIds(client: CDPClient, objectId: string): Promise<Map<string, string>> {
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

/** Reads a held CDP object out by value via one `Runtime.callFunctionOn({returnByValue:true})` round trip on its OWN `objectId` — the only way the by-value `facts` blob (JSON-safe: rects/strings/numbers, no DOM handles) leaves the held reference without ever touching a page-observable global. */
async function readHeldValue<T>(client: CDPClient, objectId: string): Promise<T | undefined> {
  const res = (await client.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function() { return this; }',
    returnByValue: true,
  })) as { result?: { value?: T } };
  return res.result?.value;
}

/**
 * Resolves each numeric-index own property of a held live-array `objectId`
 * (the walk's `elements` handle array) to that element's own `objectId` —
 * the CDP identity bridge every `backendNodeId` resolution in this file
 * depends on, sourced from the walk's held return value rather than a
 * page-observable global. `count` bounds the returned array (indices
 * outside `[0, count)` are ignored even if present).
 */
async function resolveIndexedObjectIds(
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

export const collectText: Collector = async (ctx) => {
  // The walk's return value is a plain in-memory `{ facts, elements }`
  // object — never a `window` global, never a live-DOM attribute — so
  // nothing another baseline collector or the `screenshot.png`/`dom.html`
  // capture running concurrently in the same `Promise.all` (see
  // `snapshot.ts`) could ever observe. `Runtime.evaluate({returnByValue:
  // false})` hands that object back as a CDP `RemoteObject` (an `objectId`
  // with zero page visibility into it); every held `objectId` (the
  // container, `facts`, `elements`) is released via `Runtime.releaseObject`
  // in `finally`, unconditionally, so cleanup still runs even when the
  // walk or the bridge rejects. A release failure is recorded as the
  // factual `bridgeCleanupFailed` rather than swallowed, but — unlike the
  // old window-global side channel — it can NEVER imply a contaminated
  // baseline: there is no page-observable state left to leak, only
  // CDP-session-scoped remote-object memory that is freed when the tab
  // closes. A thrown top-level evaluate/bridge read (`Runtime.evaluate`,
  // the held-container `Runtime.getProperties`, or the held-`facts`
  // `Runtime.callFunctionOn`) is caught below and turned into an honest
  // `available: false` artifact rather than propagating — cleanup still
  // runs unconditionally via `finally`. The per-element object-id bridge
  // (identity resolution for each already-read record) is separately
  // best-effort: its own failure still emits the record, with identity
  // encoded explicitly as `backendNodeId: null` + `identityUnresolved: true`
  // (never an omitted key — see `resolvedIdentity`).
  let bridgeCleanupFailed = false;
  let walkValue: TextWalkResult | undefined;
  let objectIds: Array<string | undefined> = [];
  const heldObjectIds: string[] = [];
  // I-4/I-5: distinguishes "the walk's held `facts` could not be read" from
  // "the page really has zero text-bearing elements" — both would otherwise
  // collapse to the same `elements: []` with an all-zero coverage, falsely
  // claiming a genuinely-empty read when in fact the required facts read
  // never happened. Mirrors `hittest.ts`'s `available`/`unavailableReason`.
  let available = true;
  let unavailableReason: TextUnavailableReason | undefined;
  try {
    const walkEval = (await ctx.client.send('Runtime.evaluate', {
      expression: TEXT_WALK_EXPRESSION,
      returnByValue: false,
    })) as { result?: { objectId?: string } };
    const resultObjectId = walkEval.result?.objectId;

    if (resultObjectId) {
      heldObjectIds.push(resultObjectId);
      const containerIds = await ownPropertyObjectIds(ctx.client, resultObjectId);
      const factsObjectId = containerIds.get('facts');
      const elementsObjectId = containerIds.get('elements');

      if (factsObjectId) {
        heldObjectIds.push(factsObjectId);
        walkValue = await readHeldValue<TextWalkResult>(ctx.client, factsObjectId);
      }

      // A missing `facts` objectId on the held container and a
      // `readHeldValue()` that resolves to `undefined` without throwing are
      // BOTH "the required facts read did not happen" — neither may fall
      // through to the initialized-empty `raw`/`coverage` defaults below
      // looking identical to a genuinely empty page.
      if (walkValue === undefined) {
        available = false;
        unavailableReason = 'walk-facts-unavailable';
      } else if (!Array.isArray(walkValue.records)) {
        // T11 (I-4/I-5, Layer 2): the held facts object itself read back
        // fine, but its `records` field is missing/malformed on an
        // otherwise-present object — a broken facts contract, NOT "the page
        // has zero text-bearing elements". `walkValue?.records ?? []`
        // would silently coerce this into a fabricated empty-success
        // result; treat the whole read as unavailable instead (reusing the
        // same all-zero/empty shape as walk-facts-unavailable below).
        available = false;
        unavailableReason = 'walk-records-malformed';
        walkValue = undefined;
      }

      const rawLength = walkValue?.records?.length ?? 0;
      if (elementsObjectId && rawLength > 0) {
        heldObjectIds.push(elementsObjectId);
        try {
          objectIds = await resolveIndexedObjectIds(ctx.client, elementsObjectId, rawLength);
        } catch {
          // Best-effort — records are still written, with identity encoded
          // explicitly as backendNodeId: null + identityUnresolved: true
          // (never an omitted key — see resolvedIdentity).
        }
      }
    } else {
      available = false;
      unavailableReason = 'walk-evaluate-returned-no-object';
    }
  } catch {
    // `Runtime.evaluate`, the held-container `Runtime.getProperties`
    // (`ownPropertyObjectIds`), or the held-`facts` `Runtime.callFunctionOn`
    // (`readHeldValue`) rejected outright — reset to the honest-empty state
    // rather than letting the collector crash without ever writing an
    // unavailable artifact (mirrors `hittest.ts`).
    walkValue = undefined;
    objectIds = [];
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

  const raw = walkValue?.records ?? [];

  // T12 (I-4/I-5, Layer 2): each coverage field is validated independently
  // of `records` — a malformed/non-number `elementsTotal`/`iframesNotWalked`/
  // `shadowRootsNotWalked` on an otherwise-valid facts object must surface a
  // malformed marker, not silently coerce into a genuine zero/uncapped fact
  // via `?? 0`/`?? raw.length`. Only evaluated when `walkValue` itself is
  // defined (records valid) — when the whole read failed, the top-level
  // `available`/`unavailableReason` already covers it and these per-field
  // markers would be redundant noise.
  const elementsTotalValid = walkValue !== undefined && typeof walkValue.elementsTotal === 'number';
  const elementsTotal = elementsTotalValid ? (walkValue as TextWalkResult).elementsTotal : raw.length;
  const iframesNotWalkedValid = walkValue !== undefined && typeof walkValue.iframesNotWalked === 'number';
  const shadowRootsNotWalkedValid = walkValue !== undefined && typeof walkValue.shadowRootsNotWalked === 'number';

  const coverage = {
    scope: 'top-document' as const,
    iframesNotWalked: iframesNotWalkedValid ? (walkValue as TextWalkResult).iframesNotWalked : 0,
    ...(walkValue !== undefined && !iframesNotWalkedValid ? { iframesNotWalkedUnavailable: true } : {}),
    shadowRootsNotWalked: shadowRootsNotWalkedValid ? (walkValue as TextWalkResult).shadowRootsNotWalked : 0,
    ...(walkValue !== undefined && !shadowRootsNotWalkedValid ? { shadowRootsNotWalkedUnavailable: true } : {}),
    ...(walkValue !== undefined && !elementsTotalValid ? { elementsTotalUnavailable: true } : {}),
    // I-5: the top-level MAX_ELEMENTS cap silently dropped excess elements
    // before this fact existed. Same convention as the per-element
    // `linesTruncated` count below — present only when the cap actually
    // dropped something and elementsTotal itself is a valid measured number,
    // so an uncapped snapshot's coverage stays exactly as before.
    ...(elementsTotalValid && elementsTotal > raw.length ? { elementsTotal, elementsTruncated: elementsTotal - raw.length } : {}),
  };

  const elements: TextElementRecord[] = [];
  // Per-element object IDs (`objectIds`, resolved above) are a SEPARATE
  // remote-object handle per element, distinct from the container/facts/
  // elements-array handles the earlier `finally` already released — each
  // is released here once the loop is done reading through it (unconditionally,
  // even on a mid-loop throw), so no per-element CDP remote-object handle
  // outlives this collector.
  try {
    for (let i = 0; i < raw.length; i += 1) {
      const rec = raw[i];
      const objectId = objectIds[i];

      let backendNodeId: number | undefined;
      let platformFonts: PlatformFontFact[] = [];
      // Raw (pre-cap) platform font family names, kept only for the
      // `fallbackUsed` comparison below. A capped family name could otherwise
      // turn a real substring match against the raw CSS `fontFamily` into a
      // false fallback report. Only the bounded `platformFonts` facts leave
      // this function.
      let rawPlatformFontFamilies: string[] = [];
      // I-4/I-5: `platformFontsAvailable` distinguishes "the platform-font
      // source was never actually read" (no bridged identity, `nodeId`
      // unresolved, or `CSS.getPlatformFontsForNode` threw) from "it was read
      // and genuinely returned zero fonts" — both would otherwise collapse to
      // the same empty `platformFonts: []` / `fallbackUsed: false` shape,
      // over-claiming a fallback-font observation the read never made.
      let platformFontsAvailable = false;
      let platformFontsUnavailableReason: PlatformFontsUnavailableReason | undefined =
        'platform-fonts-node-id-unresolved';
      if (objectId) {
        const described = await describeNodeIds(ctx.client, objectId);
        backendNodeId = described.backendNodeId;
        if (described.nodeId !== undefined) {
          try {
            const fontsResult = (await ctx.client.send('CSS.getPlatformFontsForNode', {
              nodeId: described.nodeId,
            })) as { fonts?: PlatformFontFact[] };
            if (!Array.isArray(fontsResult.fonts)) {
              // T14 (I-4/I-5, Layer 2): a missing/malformed `fonts` field on an
              // otherwise-successful CDP response is NOT the same fact as
              // "genuinely read, zero platform fonts" — `fonts ?? []` would
              // silently fabricate a zero-font observation while still
              // claiming platformFontsAvailable:true. Mark it malformed
              // instead of coercing to the benign empty-array default.
              platformFontsUnavailableReason = 'platform-fonts-malformed';
            } else {
              rawPlatformFontFamilies = fontsResult.fonts.map((font) => font.familyName ?? '');
              // Explicit allowlisted object — never spread the page-shaped font
              // fact (D8b); only the three known keys are surfaced.
              platformFonts = fontsResult.fonts.map((font) => {
                const fact: PlatformFontFact = {
                  familyName: sanitizeString(font.familyName),
                  isCustomFont: !!font.isCustomFont,
                };
                return typeof font.glyphCount === 'number' ? { ...fact, glyphCount: font.glyphCount } : fact;
              });
              platformFontsAvailable = true;
              platformFontsUnavailableReason = undefined;
            }
          } catch {
            // Platform font inventory read failed — leave platformFontsAvailable
            // false with the read-threw reason rather than silently keeping the
            // initialized-empty platformFonts/rawPlatformFontFamilies looking
            // like a genuine zero-fonts observation.
            platformFontsUnavailableReason = 'platform-fonts-read-threw';
          }
        }
      }

      const cappedText = capString(rec.text);
      const selector = sanitizeString(rec.selector);
      // Raw-to-raw: compares each uncapped platform font family name
      // against the raw CSS `fontFamily` string — never the bounded
      // `platformFonts` facts, so capping a font name can never turn a real
      // match into a false fallback report. `null` (never
      // `false`) when the platform-font source itself was never read —
      // otherwise a read failure is indistinguishable from a genuine
      // "no fallback font was used" observation (I-4/I-5).
      const fallbackUsed = platformFontsAvailable
        ? rawPlatformFontFamilies.some(
            (familyName) => familyName && !rec.fontFamily.toLowerCase().includes(familyName.toLowerCase()),
          )
        : null;

      const { items: cappedLines, truncated: linesTruncated } = capArray(rec.lines, MAX_TEXT_LINES);

      const record: TextElementRecord = {
        id: rec.markId,
        selector,
        // objectId missing (no bridge slot) or DOM.describeNode failing to
        // resolve a backendNodeId are BOTH "identity did not resolve" —
        // resolvedIdentity() turns either case into the same honest
        // `backendNodeId: null` + `identityUnresolved: true` shape (I-3/I-5).
        ...resolvedIdentity(backendNodeId),
        text: cappedText.value,
        textLength: rec.text.length,
        ...(cappedText.capped ? { capped: true } : {}),
        lines: cappedLines.map((line, index) => {
          const wrapOffset = rec.wrapOffsets[index];
          return {
            index,
            rect: { x: line.x, y: line.y, width: line.width, height: line.height },
            baseline: line.baseline,
            baselineApproximate: !!line.baselineApproximate,
            wrapAfterChar: typeof wrapOffset === 'number' ? wrapOffset : undefined,
            // I-4: `null` (as opposed to an out-of-range/absent index) means
            // the Range-op binary search for THIS boundary failed mid-search
            // — the offset is honestly unavailable, never a corrupted guess
            // stamped exact. Omitted entirely when there is no such boundary.
            ...(wrapOffset === null ? { wrapAfterCharUnavailable: true } : {}),
          };
        }),
        lineCount: rec.lines.length,
        ...(linesTruncated ? { linesTruncated } : {}),
        writingMode: normalizeEnum(rec.writingMode, WRITING_MODE_ALLOWLIST),
        direction: normalizeEnum(rec.direction, DIRECTION_ALLOWLIST),
        bidiOrder: normalizeEnum(rec.bidiOrder, BIDI_ORDER_ALLOWLIST),
        font: {
          family: sanitizeString(rec.fontFamily),
          size: sanitizeString(rec.fontSize),
          weight: sanitizeString(rec.fontWeight),
          lineHeight: sanitizeString(rec.lineHeight),
        },
        platformFonts,
        platformFontsAvailable,
        ...(platformFontsUnavailableReason ? { platformFontsUnavailableReason } : {}),
        fallbackUsed,
        isContentEditable: rec.isContentEditable,
        truncated: rec.truncated,
        truncationStyle: normalizeEnum(rec.truncationStyle, TRUNCATION_STYLE_ALLOWLIST),
        scrollWidth: rec.scrollWidth,
        clientWidth: rec.clientWidth,
      };
      elements.push(record);
    }
  } finally {
    for (const objectId of objectIds) {
      if (!objectId) continue;
      try {
        await ctx.client.send('Runtime.releaseObject', { objectId });
      } catch {
        bridgeCleanupFailed = true;
      }
    }
  }

  ctx.write.json('text.json', {
    elements,
    coverage,
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
    ...(bridgeCleanupFailed ? { bridgeCleanupFailed: true } : {}),
  } satisfies TextJson);
};
