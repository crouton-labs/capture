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
  return { kind, elementId: element?.id, selector: element?.selector, rect: element ? rectOf(element.rect) : undefined, detail, provenance };
}

function rgb(value: string | null | undefined): [number, number, number] | undefined {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
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
    const styles = readRequired<{ elements?: Array<{ selector?: string; backendNodeId?: number | null; computed?: Record<string, string | null> }> }>(ref, 'styles.json');
    for (const style of styles.elements ?? []) {
      const foreground = rgb(style.computed?.color);
      const background = rgb(style.computed?.backgroundColor ?? style.computed?.['background-color']);
      if (!foreground || !background) continue;
      const ratio = contrastRatio(foreground, background);
      if (ratio < 4.5) {
        const e = elements.find((x) => (style.backendNodeId != null && x.backendNodeId === style.backendNodeId) || x.selector === style.selector);
        findings.push(finding('contrast', e, `${style.selector ?? label(e ?? {})} foreground ${style.computed?.color} against background ${style.computed?.backgroundColor ?? style.computed?.['background-color']} has contrast ratio ${ratio.toFixed(2)}:1`, 'computed color and background-color'));
      }
    }
  }
  if (selected.has('hit-test')) {
    const hit = readHittest<{ elements?: Array<{ selector?: string; backendNodeId?: number | null; selfHitCount?: number; selfHitTotal?: number; points?: Array<{ result?: { topReceiver?: { selector?: string } | null; x?: number; y?: number; stack?: Array<{ selector?: string; pointerEvents?: string; opacity?: number }> } }> }> }>(ref);
    for (const sample of hit.elements ?? []) if ((sample.selfHitCount ?? 0) < (sample.selfHitTotal ?? 0)) {
      const e = elements.find((x) => (sample.backendNodeId != null && x.backendNodeId === sample.backendNodeId) || (sample.selector && x.selector === sample.selector));
      const point = sample.points?.find((p) => p.result?.topReceiver?.selector !== sample.selector)?.result;
      findings.push(finding('hit-test', e, `${label(e ?? sample)} resolves ${sample.selfHitCount ?? 0} of ${sample.selfHitTotal ?? 0} sampled points to itself${point ? `; sampled point (${point.x},${point.y}) receiver ${point.topReceiver?.selector ?? 'none'}` : ''}`, point?.stack?.map((x) => `${x.selector ?? x.pointerEvents ?? 'element'}${x.opacity === 0 ? ' opacity 0' : ''}`).join(', ')));
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
