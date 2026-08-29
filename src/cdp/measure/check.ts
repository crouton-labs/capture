import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';

import type { SnapRef, Rect } from '../../output/artifact.js';
import { artifactExists, artifactPath, readAnimation, readForms, readGeometry, readHittest, readMeta, readText, unstableRegionsFor, annotateUnstableFacts } from '../../output/artifact.js';
import { writeBinaryPrivate } from '../../session/artifacts.js';

export const CHECK_NAMES = ['overlap', 'offscreen', 'overflow', 'tap-targets', 'contrast', 'hit-test', 'truncation', 'forms', 'media', 'animation'] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

export interface CheckFinding {
  readonly kind: CheckName;
  readonly elementId?: string;
  readonly backendNodeId?: number;
  readonly selector?: string;
  readonly rect?: Rect;
  readonly detail: string;
  readonly provenance?: string;
  readonly crop?: string;
  readonly caveats: readonly { readonly regionId: string; readonly selector?: string; readonly reason?: string }[];
}

interface GeometryElement {
  id: string;
  selector?: string;
  domPath?: string;
  tag?: string;
  backendNodeId?: number | null;
  rect: { x: number; y: number; width: number; height: number };
  visibility?: { visible?: boolean; opacity?: number };
  zIndex?: string;
  stackingContext?: { creates?: boolean; reasons?: string[] };
  clipping?: { clippedBy?: string; clippedFraction?: number } | null;
  layout?: { scrollWidth?: number; clientWidth?: number; scrollHeight?: number; clientHeight?: number; position?: string; overflowX?: string };
}

function rectOf(r: { x: number; y: number; width: number; height: number }): Rect { return { x: r.x, y: r.y, w: r.width, h: r.height }; }
function intersects(a: GeometryElement['rect'], b: GeometryElement['rect']): boolean { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
function label(e: { selector?: string; id?: string }): string { return e.selector || e.id || '(unidentified element)'; }

// --- Overlap: opaque direct-sibling intersection detection ------------------
// The naive all-pairs intersection reports every ancestor–descendant pair
// (a child rect sits inside its parent rect) AND every cousin/descendant-of-
// sibling pair, flooding the report. A meaningful overlap is between two
// DIRECT DOM siblings (same parent) whose rects intersect and whose actual
// top painter — resolved from the artifact's authoritative paint order — is
// effectively opaque, i.e. a real visual occlusion, per the design contract's
// "opaque sibling intersections".

/** The parent domPath of an element: everything before the final `/` segment.
 * `body[0]/div[1]/span[0]` → `body[0]/div[1]`; a root-level `body[0]` → `''`.
 * Undefined when domPath is absent (sibling relationship unprovable). */
function parentPath(domPath?: string): string | undefined {
  if (domPath == null) return undefined;
  const i = domPath.lastIndexOf('/');
  return i < 0 ? '' : domPath.slice(0, i);
}

/** True when `a` and `b` are DIRECT DOM siblings — same parent domPath,
 * distinct elements. Requires both domPaths: without them the sibling
 * relationship cannot be proven, so the pair is not reported. This alone
 * excludes ancestor–descendant containment (an ancestor and descendant never
 * share a parent) and cousin / descendant-of-sibling pairs (different
 * parents), collapsing what were previously many noisy cross-subtree findings
 * to the single direct-sibling intersection that actually occludes. */
function areDirectSiblings(a: GeometryElement, b: GeometryElement): boolean {
  const pa = parentPath(a.domPath), pb = parentPath(b.domPath);
  return pa !== undefined && pb !== undefined && pa === pb && a.domPath !== b.domPath;
}

/** Parse a CSS alpha token — a bare number (`0.8`) or a percentage (`50%`). */
function parseAlphaToken(token: string): number {
  const t = token.trim();
  return t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t);
}

/** Alpha of a CSS color string across the syntaxes a real browser computes:
 * legacy comma `rgba(r,g,b,a)`/`hsla(...)` (fourth channel), hex (`#RGBA`/
 * `#RRGGBBAA` alpha nibble/byte, else 1), and modern space-separated color
 * functions — `rgb(r g b / a)`, `oklch(l c h / a)`, `oklab(l a b / a)`,
 * `hsl`, `hwb`, `lab`, `lch`, `color(...)` — whose optional alpha follows a
 * `/`. A recognized color with no alpha component is opaque (1);
 * `transparent`/empty is 0. Undefined when the value is unrecognized so the
 * caller can treat opacity as unknown. */
function colorAlpha(value: string | null | undefined): number | undefined {
  if (value == null) return undefined;
  const v = value.trim().toLowerCase();
  if (v === 'transparent' || v === '') return 0;
  const hex = /^#([0-9a-f]+)$/.exec(v);
  if (hex) {
    const h = hex[1];
    if (h.length === 4) return parseInt(h[3] + h[3], 16) / 255;
    if (h.length === 8) return parseInt(h.slice(6, 8), 16) / 255;
    if (h.length === 3 || h.length === 6) return 1;
    return undefined;
  }
  const fn = /^[a-z-]+\((.*)\)$/.exec(v);
  if (fn) {
    const inner = fn[1];
    if (inner.includes(',')) {
      // Legacy comma form: rgba/hsla carry alpha as the fourth channel.
      const parts = inner.split(',');
      if (parts.length >= 4) { const a = parseAlphaToken(parts[3]); return Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : undefined; }
      return 1;
    }
    // Modern space form: alpha, when present, follows a `/`.
    const slash = inner.split('/');
    if (slash.length >= 2) { const a = parseAlphaToken(slash[slash.length - 1]); return Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : undefined; }
    return 1;
  }
  if (/^[a-z]+$/.test(v)) return 1;
  return undefined;
}

interface BackgroundMap { byNode: Map<number, number>; bySelector: Map<string, number> }

/** Per-element background alpha, keyed by backendNodeId and selector, read
 * from styles.json. Empty when styles.json is unavailable (overlap then
 * reports nothing rather than flooding — an opaque occluder cannot be proven
 * without the computed background). */
function backgroundAlphaMap(ref: SnapRef): BackgroundMap {
  const byNode = new Map<number, number>();
  const bySelector = new Map<string, number>();
  try {
    const styles = readRequired<{ elements?: Array<{ selector?: string; backendNodeId?: number | null; computed?: Record<string, string | null> }> }>(ref, 'styles.json');
    for (const s of styles.elements ?? []) {
      const alpha = colorAlpha(s.computed?.backgroundColor ?? s.computed?.['background-color']);
      if (alpha === undefined) continue;
      if (s.backendNodeId != null) byNode.set(s.backendNodeId, alpha);
      if (s.selector) bySelector.set(s.selector, alpha);
    }
  } catch { /* styles.json unavailable — leave maps empty */ }
  return { byNode, bySelector };
}

/** Effective opacity of an element: its own `opacity` multiplied by that of
 * every DOM ancestor (opacity establishes a group whose transparency applies
 * to the whole subtree). Walks the ancestor chain by domPath prefix. An
 * element is only a full occluder when its effective opacity is 1. */
function effectiveOpacity(e: GeometryElement, byPath: Map<string, GeometryElement>): number {
  let opacity = e.visibility?.opacity ?? 1;
  let p = parentPath(e.domPath);
  while (p) {
    const ancestor = byPath.get(p);
    if (!ancestor) break;
    opacity *= ancestor.visibility?.opacity ?? 1;
    p = parentPath(ancestor.domPath);
  }
  return opacity;
}

/** An element occludes what it overlaps only when it is effectively fully
 * opaque (own + ancestor opacity all 1) AND paints an opaque background. */
function isOpaque(e: GeometryElement, bg: BackgroundMap, byPath: Map<string, GeometryElement>): boolean {
  if (effectiveOpacity(e, byPath) < 1) return false;
  const alpha = (e.backendNodeId != null ? bg.byNode.get(e.backendNodeId) : undefined) ?? (e.selector ? bg.bySelector.get(e.selector) : undefined);
  return alpha !== undefined && alpha >= 1;
}

/** The artifact's AUTHORITATIVE paint order (`layers.json.paintOrder`): a
 * back-to-front list of backendNodeIds, mapped to their paint index (higher =
 * painted later = on top). This is Chrome's real DOMSnapshot paint order,
 * sound across stacking contexts and CSS paint phases — unlike a global
 * z-index guess. Empty when layers.json lacks a resolved paint order, in which
 * case no occlusion can be proven and overlap reports nothing. */
function paintOrderMap(ref: SnapRef): Map<number, number> {
  try {
    const layers = readRequired<{ paintOrder?: { available?: boolean; backendNodeIds?: number[] } }>(ref, 'layers.json');
    const po = layers.paintOrder;
    const index = new Map<number, number>();
    if (po?.available && Array.isArray(po.backendNodeIds)) po.backendNodeIds.forEach((id, i) => index.set(id, i));
    return index;
  } catch { return new Map(); }
}

/** Whether `a` paints above `b`, resolved SOLELY from the artifact's
 * authoritative paint order. Returns undefined when either element is absent
 * from that order: DOM order is not paint order for positioned/z-indexed
 * elements or stacking contexts, so without authoritative evidence for both
 * the top painter is unknowable and the tool must not claim an occlusion. */
function paintsAbove(a: GeometryElement, b: GeometryElement, paint: Map<number, number>): boolean | undefined {
  const ia = a.backendNodeId != null ? paint.get(a.backendNodeId) : undefined;
  const ib = b.backendNodeId != null ? paint.get(b.backendNodeId) : undefined;
  if (ia === undefined || ib === undefined) return undefined;
  return ia > ib;
}

export function parseChecks(value?: string): CheckName[] {
  if (!value || value === 'all') return [...CHECK_NAMES];
  const categories: Record<string, CheckName[]> = {
    geometry: ['overlap', 'offscreen', 'overflow', 'tap-targets'],
    content: ['truncation', 'media'],
    targetability: ['tap-targets', 'contrast', 'hit-test'],
    forms: ['forms'],
    animation: ['animation'],
  };
  const selected = new Set<CheckName>();
  for (const part of value.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (part in categories) categories[part].forEach((check) => selected.add(check));
    else if ((CHECK_NAMES as readonly string[]).includes(part)) selected.add(part as CheckName);
    else throw new Error(`unknown check ${JSON.stringify(part)}; use geometry, content, targetability, forms, animation, all, or ${CHECK_NAMES.join(', ')}`);
  }
  return [...selected];
}

function viewport(meta: { viewport?: string | null }, elements: GeometryElement[]): { width: number; height: number } {
  const match = /^\s*(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)\s*$/i.exec(meta.viewport ?? '');
  if (match) return { width: Number(match[1]), height: Number(match[2]) };
  return { width: Math.max(0, ...elements.map((e) => e.rect.x + e.rect.width)), height: Math.max(0, ...elements.map((e) => e.rect.y + e.rect.height)) };
}

function readRequired<T>(ref: SnapRef, filename: string): T {
  return JSON.parse(fs.readFileSync(artifactPath(ref, filename), 'utf8')) as T;
}

function finding(kind: CheckName, element: GeometryElement | undefined, detail: string, provenance?: string): Omit<CheckFinding, 'caveats'> {
  return { kind, elementId: element?.id, backendNodeId: element?.backendNodeId ?? undefined, selector: element?.selector, rect: element ? rectOf(element.rect) : undefined, detail, provenance };
}

function isSelfOrDescendant(target: GeometryElement, receiver: GeometryElement): boolean {
  if (target.backendNodeId != null && target.backendNodeId === receiver.backendNodeId) return true;
  return target.domPath !== undefined && receiver.domPath !== undefined && receiver.domPath.startsWith(`${target.domPath}/`);
}

interface Rgba { readonly red: number; readonly green: number; readonly blue: number; readonly alpha: number }
interface StyleElement { readonly selector?: string; readonly backendNodeId?: number | null; readonly computed?: Record<string, string | null> }

function bounded(value: number): number { return Math.min(1, Math.max(0, value)); }

function rgbChannel(token: string): number {
  const value = token.trim();
  return value.endsWith('%') ? Number(value.slice(0, -1)) * 2.55 : Number(value);
}

function fromOklab(lightness: number, a: number, b: number, alpha: number): Rgba | undefined {
  if (![lightness, a, b, alpha].every(Number.isFinite) || alpha < 0 || alpha > 1) return undefined;
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const linear = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  const channel = (value: number): number => 255 * (value <= 0.0031308 ? 12.92 * bounded(value) : 1.055 * bounded(value) ** (1 / 2.4) - 0.055);
  return { red: channel(linear[0]!), green: channel(linear[1]!), blue: channel(linear[2]!), alpha };
}

function rgba(value: string | null | undefined): Rgba | undefined {
  const input = value?.trim().toLowerCase();
  if (!input) return undefined;
  if (input === 'transparent') return { red: 0, green: 0, blue: 0, alpha: 0 };
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(input);
  if (hex) {
    const digits = hex[1]!.length <= 4 ? hex[1]!.split('').map((digit) => digit + digit).join('') : hex[1]!;
    return { red: parseInt(digits.slice(0, 2), 16), green: parseInt(digits.slice(2, 4), 16), blue: parseInt(digits.slice(4, 6), 16), alpha: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([^,\s]+)(?:\s*,\s*|\s+)([^,\s]+)(?:\s*,\s*|\s+)([^,\s]+)(?:\s*(?:,|\/)\s*([^\s)]+))?\s*\)$/i.exec(input);
  if (rgb) {
    const channels = [rgbChannel(rgb[1]!), rgbChannel(rgb[2]!), rgbChannel(rgb[3]!)];
    const alpha = rgb[4] === undefined ? 1 : parseAlphaToken(rgb[4]);
    return channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255) || !Number.isFinite(alpha) || alpha < 0 || alpha > 1 ? undefined : { red: channels[0]!, green: channels[1]!, blue: channels[2]!, alpha };
  }
  const oklab = /^oklab\(\s*([\d.]+)(?:\s*,\s*|\s+)([-\d.]+)(?:\s*,\s*|\s+)([-\d.]+)(?:\s*(?:,|\/)\s*([^\s)]+))?\s*\)$/i.exec(input);
  if (oklab) return fromOklab(Number(oklab[1]), Number(oklab[2]), Number(oklab[3]), oklab[4] === undefined ? 1 : parseAlphaToken(oklab[4]));
  const oklch = /^oklch\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([-\d.]+)(?:\s*(?:,|\/)\s*([^\s)]+))?\s*\)$/i.exec(input);
  if (oklch) {
    const chroma = Number(oklch[2]);
    const hue = Number(oklch[3]) * Math.PI / 180;
    return fromOklab(Number(oklch[1]), chroma * Math.cos(hue), chroma * Math.sin(hue), oklch[4] === undefined ? 1 : parseAlphaToken(oklch[4]));
  }
  return undefined;
}

function composite(over: Rgba, under: Rgba): Rgba {
  const alpha = over.alpha + under.alpha * (1 - over.alpha);
  if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 };
  return {
    red: (over.red * over.alpha + under.red * under.alpha * (1 - over.alpha)) / alpha,
    green: (over.green * over.alpha + under.green * under.alpha * (1 - over.alpha)) / alpha,
    blue: (over.blue * over.alpha + under.blue * under.alpha * (1 - over.alpha)) / alpha,
    alpha,
  };
}

function applyOpacity(paint: Rgba, opacity: number): Rgba {
  return { ...paint, alpha: paint.alpha * opacity };
}

function styleFor(element: GeometryElement, stylesByNode: Map<number, StyleElement>, stylesBySelector: Map<string, StyleElement>): StyleElement | undefined {
  return (element.backendNodeId === null || element.backendNodeId === undefined ? undefined : stylesByNode.get(element.backendNodeId)) ?? (element.selector === undefined ? undefined : stylesBySelector.get(element.selector)) ?? (element.tag === undefined ? undefined : stylesBySelector.get(element.tag));
}

function remainingOpacityIsOne(element: GeometryElement, byPath: Map<string, GeometryElement>): boolean {
  let ancestor = element.domPath === undefined ? undefined : byPath.get(parentPath(element.domPath) ?? '');
  while (ancestor) {
    if ((ancestor.visibility?.opacity ?? 1) !== 1) return false;
    ancestor = ancestor.domPath === undefined ? undefined : byPath.get(parentPath(ancestor.domPath) ?? '');
  }
  return true;
}

function effectiveBackground(target: GeometryElement, byPath: Map<string, GeometryElement>, stylesByNode: Map<number, StyleElement>, stylesBySelector: Map<string, StyleElement>): { readonly color: [number, number, number]; readonly source: GeometryElement } | undefined {
  let element: GeometryElement | undefined = target;
  let background: Rgba = { red: 0, green: 0, blue: 0, alpha: 0 };
  let source: GeometryElement | undefined;
  while (element) {
    const style = styleFor(element, stylesByNode, stylesBySelector);
    const paint = rgba(style?.computed?.backgroundColor ?? style?.computed?.['background-color']);
    if (!paint) return undefined;
    const wasOpaque = background.alpha === 1;
    background = applyOpacity(composite(background, paint), element.visibility?.opacity ?? 1);
    if (!wasOpaque && background.alpha === 1) source = element;
    else if (background.alpha < 1) source = undefined;
    if (background.alpha === 1 && source && remainingOpacityIsOne(element, byPath)) return { color: [Math.round(background.red), Math.round(background.green), Math.round(background.blue)], source };
    element = element.domPath === undefined ? undefined : byPath.get(parentPath(element.domPath) ?? '');
  }
  return undefined;
}

function effectiveForeground(foreground: Rgba, target: GeometryElement, byPath: Map<string, GeometryElement>, stylesByNode: Map<number, StyleElement>, stylesBySelector: Map<string, StyleElement>): [number, number, number] | undefined {
  let element: GeometryElement | undefined = target;
  let background: Rgba = { red: 0, green: 0, blue: 0, alpha: 0 };
  let rendered = foreground;
  while (element) {
    const style = styleFor(element, stylesByNode, stylesBySelector);
    const paint = rgba(style?.computed?.backgroundColor ?? style?.computed?.['background-color']);
    if (!paint) return undefined;
    const opacity = element.visibility?.opacity ?? 1;
    background = applyOpacity(composite(background, paint), opacity);
    rendered = applyOpacity(composite(rendered, paint), opacity);
    if (background.alpha === 1 && remainingOpacityIsOne(element, byPath)) return [Math.round(rendered.red), Math.round(rendered.green), Math.round(rendered.blue)];
    element = element.domPath === undefined ? undefined : byPath.get(parentPath(element.domPath) ?? '');
  }
  return undefined;
}

function contrastRatio(foreground: [number, number, number], background: [number, number, number]): number {
  const lum = (channels: [number, number, number]) => channels.reduce((sum, channel, index) => { const v = channel / 255; return sum + (v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]; }, 0);
  const a = lum(foreground), b = lum(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

/** Read-only analysis over a completed snapshot. Browser driving belongs solely to measure snap. */
export function checkSnapshot(ref: SnapRef, requested: readonly CheckName[]): { findings: CheckFinding[]; elementCount: number; settled: boolean; viewport: { width: number; height: number } } {
  const geometry = readGeometry<{ elements: GeometryElement[] }>(ref);
  const elements = geometry.elements ?? [];
  const meta = readMeta<{ settled: boolean; viewport?: string | null }>(ref);
  const selected = new Set(requested);
  const findings: Array<Omit<CheckFinding, 'caveats'>> = [];
  const vp = viewport(meta, elements);
  const visible = elements.filter((e) => e.visibility?.visible !== false && e.rect.width > 0 && e.rect.height > 0);

  if (selected.has('overlap')) {
    const bg = backgroundAlphaMap(ref);
    const paint = paintOrderMap(ref);
    const byPath = new Map<string, GeometryElement>();
    for (const e of elements) if (e.domPath) byPath.set(e.domPath, e);
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i], b = visible[j];
      if (!intersects(a.rect, b.rect)) continue;
      if (!areDirectSiblings(a, b)) continue;                       // only direct-sibling intersections are reported; cousins/descendants are noise
      const above = paintsAbove(a, b, paint);
      if (above === undefined) continue;                            // top painter unprovable without authoritative paint order for BOTH — never infer occlusion from DOM order
      const [over, under] = above ? [a, b] : [b, a];
      if (!isOpaque(over, bg, byPath)) continue;                    // the actual TOP painter must be opaque to occlude what is under it
      const ix = Math.max(a.rect.x, b.rect.x), iy = Math.max(a.rect.y, b.rect.y);
      const iw = Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) - ix;
      const ih = Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) - iy;
      const underArea = under.rect.width * under.rect.height;
      const pct = underArea > 0 ? Math.round((iw * ih) / underArea * 100) : 0;
      const stacking = over.stackingContext?.creates ? `; ${label(over)} creates a stacking context` : '';
      findings.push(finding('overlap', under,
        `${label(under)} ${pct}% occluded by ${label(over)}; ${label(under)} x=${under.rect.x} y=${under.rect.y} w=${under.rect.width} h=${under.rect.height} and ${label(over)} x=${over.rect.x} y=${over.rect.y} w=${over.rect.width} h=${over.rect.height}; overlap ${iw}×${ih}px`,
        `${label(over)} paints above ${label(under)} in DOMSnapshot paint order${stacking}`));
    }
  }
  if (selected.has('offscreen')) for (const e of visible) {
    const insideW = Math.max(0, Math.min(e.rect.x + e.rect.width, vp.width) - Math.max(e.rect.x, 0));
    const insideH = Math.max(0, Math.min(e.rect.y + e.rect.height, vp.height) - Math.max(e.rect.y, 0));
    if (insideW < e.rect.width || insideH < e.rect.height) findings.push(finding('offscreen', e, `${label(e)} has ${insideW}×${insideH}px inside viewport ${vp.width}×${vp.height}; rect x=${e.rect.x} y=${e.rect.y} w=${e.rect.width} h=${e.rect.height}`));
  }
  if (selected.has('overflow')) for (const e of elements) if ((e.layout?.scrollWidth ?? 0) > (e.layout?.clientWidth ?? 0)) findings.push(finding('overflow', e, `${label(e)} scrollWidth ${e.layout!.scrollWidth}px > clientWidth ${e.layout!.clientWidth}px`, `overflow-x ${e.layout?.overflowX ?? 'unavailable'}`));
  if (selected.has('tap-targets')) for (const e of visible) if (/^(button|a|input|select|textarea)$/i.test((e as { tag?: string }).tag ?? '') && (e.rect.width < 44 || e.rect.height < 44)) findings.push(finding('tap-targets', e, `${label(e)} measures ${e.rect.width}×${e.rect.height}px; threshold is 44×44px`));

  if (selected.has('contrast')) {
    const styles = readRequired<{ elements?: StyleElement[] }>(ref, 'styles.json').elements ?? [];
    const stylesByNode = new Map<number, StyleElement>();
    const stylesBySelector = new Map<string, StyleElement>();
    const byPath = new Map<string, GeometryElement>();
    for (const element of elements) if (element.domPath) byPath.set(element.domPath, element);
    for (const style of styles) {
      if (style.backendNodeId != null) stylesByNode.set(style.backendNodeId, style);
      if (style.selector) stylesBySelector.set(style.selector, style);
    }
    for (const style of styles) {
      const foreground = rgba(style.computed?.color);
      const element = elements.find((candidate) => (style.backendNodeId != null && candidate.backendNodeId === style.backendNodeId) || candidate.selector === style.selector);
      if (!foreground || !element) continue;
      const background = effectiveBackground(element, byPath, stylesByNode, stylesBySelector);
      const renderedForeground = effectiveForeground(foreground, element, byPath, stylesByNode, stylesBySelector);
      if (!background || !renderedForeground) continue;
      const ratio = contrastRatio(renderedForeground, background.color);
      if (ratio < 4.5) {
        const source = label(background.source);
        findings.push(finding('contrast', element, `contrast ratio ${ratio.toFixed(2)}:1 — ${style.selector ?? label(element)} foreground ${style.computed?.color} against composited background rgb(${background.color.join(', ')})`, `computed color; effective background supplied by ${source}'s opaque paint after compositing recorded descendant backgrounds`));
      }
    }
  }
  if (selected.has('hit-test')) {
    const hit = readHittest<{ elements?: Array<{ selector?: string; backendNodeId?: number | null; points?: Array<{ result?: { topReceiver?: { selector?: string; backendNodeId?: number | null } | null; x?: number; y?: number; stack?: Array<{ selector?: string; pointerEvents?: string; opacity?: number }> } }> }> }>(ref);
    for (const sample of hit.elements ?? []) {
      const e = elements.find((x) => (sample.backendNodeId != null && x.backendNodeId === sample.backendNodeId) || (sample.selector && x.selector === sample.selector));
      if (!e) continue;
      const point = sample.points?.find((p) => {
        const receiver = p.result?.topReceiver;
        const receiverElement = receiver && elements.find((x) => receiver.backendNodeId != null && x.backendNodeId === receiver.backendNodeId);
        return receiverElement !== undefined && !isSelfOrDescendant(e, receiverElement);
      })?.result;
      if (!point?.topReceiver) continue;
      findings.push(finding('hit-test', e, `${label(e)} sampled point (${point.x},${point.y}) resolves to non-descendant receiver ${point.topReceiver.selector ?? 'unidentified element'}`, point.stack?.map((x) => `${x.selector ?? x.pointerEvents ?? 'element'}${x.opacity === 0 ? ' opacity 0' : ''}`).join(', ')));
    }
  }
  if (selected.has('truncation')) for (const t of readText<{ elements?: Array<{ selector?: string; backendNodeId?: number | null; truncated?: boolean; scrollWidth?: number; clientWidth?: number }> }>(ref).elements ?? []) if (t.truncated) {
    const e = elements.find((x) => (t.backendNodeId != null && x.backendNodeId === t.backendNodeId) || x.selector === t.selector);
    findings.push(finding('truncation', e, `${t.selector ?? label(e ?? {})} scrollWidth ${t.scrollWidth ?? 0}px > clientWidth ${t.clientWidth ?? 0}px`));
  }
  if (selected.has('forms')) for (const control of readForms<{ controls?: Array<{ selector?: string; rect?: { x: number; y: number; width: number; height: number }; disabled?: boolean }> }>(ref).controls ?? []) if (control.rect && (control.rect.width === 0 || control.rect.height === 0 || control.rect.x + control.rect.width < 0 || control.rect.y + control.rect.height < 0 || control.rect.x > vp.width || control.rect.y > vp.height)) findings.push({ kind: 'forms', selector: control.selector, rect: rectOf(control.rect), detail: `${control.selector ?? 'form control'} rect x=${control.rect.x} y=${control.rect.y} w=${control.rect.width} h=${control.rect.height} is outside or zero-sized in viewport ${vp.width}×${vp.height}` });
  if (selected.has('media')) for (const media of readRequired<{ elements?: Array<{ selector?: string; id?: string; rect: { x: number; y: number; width: number; height: number }; visible?: boolean | null; naturalWidth?: number | null; naturalHeight?: number | null; renderedWidth?: number; renderedHeight?: number; decodeState?: string | null; crop?: unknown }> }>(ref, 'media.json').elements ?? []) if (media.visible === false || (media.naturalWidth === 0 || media.naturalHeight === 0) || media.decodeState === 'loading') findings.push({ kind: 'media', elementId: media.id, selector: media.selector, rect: rectOf(media.rect), detail: `${media.selector ?? media.id ?? 'media element'} visible=${String(media.visible)} natural=${media.naturalWidth ?? 'unavailable'}×${media.naturalHeight ?? 'unavailable'} rendered=${media.renderedWidth ?? media.rect.width}×${media.renderedHeight ?? media.rect.height} decode=${media.decodeState ?? 'unavailable'}` });
  if (selected.has('animation')) for (const animation of readAnimation<{ animations?: Array<{ id?: string; selector?: string | null; infinite?: boolean; durationMs?: number | null; iterationCount?: number | string | null; playState?: string }> }>(ref).animations ?? []) if (animation.infinite) findings.push({ kind: 'animation', elementId: animation.id, selector: animation.selector ?? undefined, detail: `${animation.selector ?? animation.id ?? 'animation'} duration ${animation.durationMs ?? 'unavailable'}ms, iteration-count ${animation.iterationCount ?? 'unavailable'}, playState ${animation.playState ?? 'unavailable'}` });

  const regions = unstableRegionsFor(ref);
  const annotated = annotateUnstableFacts(findings.map((f) => ({ ...f, elementId: f.elementId, rect: f.rect })), regions);
  return { findings: annotated.map(({ fact, caveats }) => ({ ...fact, caveats })), elementCount: elements.length, settled: meta.settled, viewport: vp };
}

/** Writes a bounded screenshot crop for a finding and returns its id-relative path. */
export function writeFindingCrop(ref: SnapRef, finding: CheckFinding, index: number): string | undefined {
  if (!finding.rect || !artifactExists(ref, 'screenshot.png')) return undefined;
  const source = PNG.sync.read(fs.readFileSync(artifactPath(ref, 'screenshot.png')));
  const x = Math.max(0, Math.floor(finding.rect.x)); const y = Math.max(0, Math.floor(finding.rect.y));
  const w = Math.max(1, Math.min(source.width - x, Math.ceil(finding.rect.w))); const h = Math.max(1, Math.min(source.height - y, Math.ceil(finding.rect.h)));
  if (x >= source.width || y >= source.height || w <= 0 || h <= 0) return undefined;
  const crop = new PNG({ width: w, height: h });
  PNG.bitblt(source, crop, x, y, w, h, 0, 0);
  const name = `${index + 1}-${finding.kind}.png`;
  writeBinaryPrivate(path.join(ref.dir, 'findings', name), PNG.sync.write(crop));
  return `${ref.id}/findings/${name}`;
}
