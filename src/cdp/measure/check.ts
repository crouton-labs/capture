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
  tag?: string;
  backendNodeId?: number | null;
  rect: { x: number; y: number; width: number; height: number };
  visibility?: { visible?: boolean };
  zIndex?: string;
  clipping?: { clippedBy?: string; clippedFraction?: number } | null;
  layout?: { scrollWidth?: number; clientWidth?: number; scrollHeight?: number; clientHeight?: number; position?: string; overflowX?: string };
}

function rectOf(r: { x: number; y: number; width: number; height: number }): Rect { return { x: r.x, y: r.y, w: r.width, h: r.height }; }
function intersects(a: GeometryElement['rect'], b: GeometryElement['rect']): boolean { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
function label(e: { selector?: string; id?: string }): string { return e.selector || e.id || '(unidentified element)'; }

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

  if (selected.has('overlap')) for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
    const a = visible[i], b = visible[j];
    if (intersects(a.rect, b.rect)) findings.push(finding('overlap', a, `${label(a)} intersects ${label(b)}; rects x=${a.rect.x} y=${a.rect.y} w=${a.rect.width} h=${a.rect.height} and x=${b.rect.x} y=${b.rect.y} w=${b.rect.width} h=${b.rect.height}`, `z-index ${a.zIndex ?? 'auto'} and ${b.zIndex ?? 'auto'}`));
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
