import {
  annotateUnstableFacts,
  readAnimation,
  readAx,
  readGeometry,
  readMedia,
  readMeta,
  readQueries,
  readStyles,
  readText,
  unstableRegionsFor,
  type SnapRef,
} from '../../output/artifact.js';
import { fact, line, lineList, text, type FactLine } from '../../output/render.js';

export const CENSUS_AXES = ['color', 'font', 'spacing', 'radius', 'shadow', 'animation', 'geometry', 'media', 'queries'] as const;
export type CensusAxis = (typeof CENSUS_AXES)[number];

interface Rect { x: number; y: number; width?: number; height?: number; w?: number; h?: number }
interface GeometryElement { id: string; selector?: string; rect?: Rect; layout?: Record<string, unknown> }
interface GeometryReport { elements: GeometryElement[] }
interface StyleElement { id: string; selector?: string; computed?: Record<string, string | null>; winningDeclarations?: Array<Record<string, unknown>> }
interface StylesReport { elements: StyleElement[] }
interface TextElement { id: string; selector?: string; rect?: Rect; font?: { family?: string; size?: string; weight?: string; lineHeight?: string }; platformFonts?: Array<{ familyName?: string }>; lines?: Array<{ baseline?: number | null; rect?: Rect }> }
interface TextReport { elements: TextElement[] }
interface AnimationReport { animations: Array<{ id: string; selector?: string | null; animationName?: string | null; durationMs?: number | null; iterationCount?: number | string | null; infinite?: boolean; playState?: string }> }
interface QueryReport { environment?: Record<string, unknown>; mediaQueries?: Array<Record<string, unknown>>; containerQueries?: Array<Record<string, unknown>> }

export interface CensusReport {
  readonly axis: CensusAxis;
  readonly snapshots: readonly SnapRef[];
  readonly distinct: number;
  readonly lines: readonly FactLine[];
}

function count(values: Iterable<string>): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function distribution(label: string, values: Iterable<string>): FactLine {
  const entries = count(values);
  const body = entries.length ? entries.map(([value, n]) => `${value} ×${n}`).join(' · ') : '(none recorded)';
  return fact`${label}: ${body}`;
}

function numeric(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(-?(?:\d+\.?\d*|\.\d+))px$/.exec(value.trim());
  return match ? Number(match[1]) : undefined;
}

function hexRgb(value: string): [number, number, number] | undefined {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const s = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [Number.parseInt(s.slice(0, 2), 16), Number.parseInt(s.slice(2, 4), 16), Number.parseInt(s.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(value.trim());
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : undefined;
}

function colorDistance(a: string, b: string): number | undefined {
  const aa = hexRgb(a); const bb = hexRgb(b);
  if (!aa || !bb) return undefined;
  return Math.sqrt((aa[0] - bb[0]) ** 2 + (aa[1] - bb[1]) ** 2 + (aa[2] - bb[2]) ** 2) / 255 * 100;
}

function caveated(lines: Array<{ elementId?: string; rect?: { x: number; y: number; w: number; h: number }; line: FactLine }>, snap: SnapRef): FactLine[] {
  return annotateUnstableFacts(lines, unstableRegionsFor(snap)).map(({ fact: item, caveats }) =>
    caveats.length
      ? line(item.line, fact` — nondeterminism caveat: unstable region ${caveats.map((c) => c.regionId).join(', ')}`)
      : item.line,
  );
}

function rectOf(rect: Rect | undefined): { x: number; y: number; w: number; h: number } | undefined {
  if (!rect) return undefined;
  const w = rect.w ?? rect.width; const h = rect.h ?? rect.height;
  return typeof w === 'number' && typeof h === 'number' ? { x: rect.x, y: rect.y, w, h } : undefined;
}

function provenanceLines(styles: StylesReport): FactLine[] {
  const sources: string[] = [];
  for (const element of styles.elements) for (const declaration of element.winningDeclarations ?? []) {
    const authored = declaration.authored as { file?: string; line?: number; column?: number } | undefined;
    const generated = declaration.generated as { sourceURL?: string; line?: number; column?: number } | undefined;
    const source = authored?.file ? `${authored.file}:${authored.line ?? 0}:${authored.column ?? 0}` : generated?.sourceURL ? `${generated.sourceURL}:${generated.line ?? 0}:${generated.column ?? 0}` : declaration.sourceStyleSheetUrl ?? declaration.selector;
    if (typeof source === 'string') sources.push(source);
  }
  return sources.length ? [distribution('Winning declaration provenance', sources)] : [];
}

function nearDuplicateLines(colors: readonly string[]): FactLine[] {
  const distinct = [...new Set(colors)];
  const near: FactLine[] = [];
  for (let i = 0; i < distinct.length; i++) for (let j = i + 1; j < distinct.length; j++) {
    const delta = colorDistance(distinct[i], distinct[j]);
    if (delta !== undefined && delta < 1) near.push(fact`Near-duplicate: ${distinct[i]} and ${distinct[j]} (ΔE-like RGB distance ${delta.toFixed(2)})`);
  }
  return near;
}

function geometryIdentity(element: StyleElement, geometry: GeometryReport): { elementId?: string; rect?: { x: number; y: number; w: number; h: number } } {
  const match = geometry.elements.find((candidate) => candidate.selector && candidate.selector === element.selector);
  return match ? { elementId: match.id, rect: rectOf(match.rect) } : { elementId: element.id };
}

function colorLines(snap: SnapRef, styles: StylesReport, geometry: GeometryReport): FactLine[] {
  const facts: Array<{ elementId?: string; rect?: { x: number; y: number; w: number; h: number }; line: FactLine }> = [];
  const colors: string[] = [];
  for (const e of styles.elements) for (const prop of ['color', 'background-color'] as const) {
    const value = e.computed?.[prop];
    if (value) { colors.push(value); facts.push({ ...geometryIdentity(e, geometry), line: fact`${prop} ${value}` }); }
  }
  return [distribution('Color values', colors), ...nearDuplicateLines(colors), ...caveated(facts.slice(0, 20), snap), ...provenanceLines(styles)];
}

function styleValueLines(snap: SnapRef, styles: StylesReport, geometry: GeometryReport, axis: 'font' | 'spacing' | 'radius' | 'shadow'): FactLine[] {
  const props = axis === 'font' ? ['font-family', 'font-size', 'font-weight', 'line-height'] : axis === 'spacing'
    ? ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left']
    : axis === 'radius' ? ['border-radius'] : ['box-shadow', 'text-shadow'];
  const values: string[] = [];
  const facts: Array<{ elementId?: string; line: FactLine }> = [];
  for (const e of styles.elements) for (const prop of props) {
    const value = e.computed?.[prop];
    if (value) { values.push(`${prop}: ${value}`); facts.push({ ...geometryIdentity(e, geometry), line: fact`${prop}: ${value}` }); }
  }
  return [distribution(`${axis} values`, values), ...caveated(facts.slice(0, 20), snap), ...provenanceLines(styles)];
}

function geometryLines(snap: SnapRef, geometry: GeometryReport, textReport: TextReport): FactLine[] {
  const edges = geometry.elements.flatMap((e) => e.rect ? [String(e.rect.x), String(e.rect.y)] : []);
  const sorted = geometry.elements.map((e) => ({ e, r: rectOf(e.rect) })).filter((x): x is { e: GeometryElement; r: { x: number; y: number; w: number; h: number } } => !!x.r).sort((a, b) => a.r.y - b.r.y);
  const gaps: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].r.y - (sorted[i - 1].r.y + sorted[i - 1].r.h);
    if (gap >= 0) gaps.push(`${Math.round(gap)}px`);
  }
  const baselines = textReport.elements.flatMap((e) => e.lines?.map((l) => l.baseline).filter((v): v is number => typeof v === 'number') ?? []).map((v) => `${Math.round(v)}px`);
  const grid = geometry.elements.filter((e) => !!(e.layout?.grid)).length;
  const area = sorted.reduce((total, { r }) => total + r.w * r.h, 0);
  const repeated = count(geometry.elements.map((e) => e.selector ?? e.id).filter(Boolean)).filter(([, n]) => n > 1);
  const repeatedLine = repeated.length
    ? fact`Repeated-component selector counts: ${repeated.map(([selector, n]) => `${selector} ×${n}`).join(' · ')}.`
    : text`Repeated-component selector counts: no repeated recorded selectors.`;
  const lines = [distribution('Edge clusters', edges), distribution('Vertical gap distribution', gaps), distribution('Baseline clusters', baselines), fact`Grid occupancy: ${grid} grid-item record(s); summed element box area: ${Math.round(area)}px² (overlapping boxes are counted independently).`, repeatedLine, text`Whitespace/ink: raster coverage is not recorded unless this snapshot includes pixel substrate; geometry reports box-area coverage only.`];
  return [...lines, ...caveated(sorted.slice(0, 20).map(({ e, r }) => ({ elementId: e.id, rect: r, line: fact`Geometry record ${e.selector ?? e.id}: x=${r.x} y=${r.y} w=${r.w} h=${r.h}` })), snap)];
}

function animationLines(snap: SnapRef, report: AnimationReport): FactLine[] {
  const values = report.animations.map((a) => `${a.animationName ?? '(unnamed)'} ${a.durationMs ?? 'unknown'}ms ${a.iterationCount ?? 'unknown'} iterations ${a.playState ?? 'unknown'}`);
  return [fact`Animations: ${report.animations.length}; infinite: ${report.animations.filter((a) => a.infinite).length}.`, distribution('Animation distribution', values), ...caveated(report.animations.map((a) => ({ elementId: a.id, line: fact`${a.selector ?? a.id}: ${a.animationName ?? '(unnamed)'}` })), snap)];
}

function mediaLines(snap: SnapRef): FactLine[] {
  const media = readMedia<{ elements: Array<{ id: string; tag?: string; selector?: string; naturalWidth?: number | null; naturalHeight?: number | null; renderedWidth?: number; renderedHeight?: number; currentSrc?: string | null; rect?: Rect }> }>(snap);
  const values = media.elements.map((m) => `${m.tag ?? 'media'} ${m.naturalWidth ?? '?'}×${m.naturalHeight ?? '?'} → ${m.renderedWidth ?? '?'}×${m.renderedHeight ?? '?'}`);
  return [fact`Replaced-element records: ${media.elements.length}.`, distribution('Media dimensions', values), ...caveated(media.elements.map((m) => ({ elementId: m.id, rect: rectOf(m.rect), line: fact`${m.selector ?? m.id}: ${m.currentSrc ?? '(no current source)'}` })), snap)];
}

function queryLines(report: QueryReport): FactLine[] {
  const media = report.mediaQueries ?? []; const containers = report.containerQueries ?? [];
  return [fact`Environment: ${JSON.stringify(report.environment ?? {})}`, fact`Active media-query records: ${media.length}; container-query records: ${containers.length}.`, distribution('Media query conditions', media.map((q) => String(q.query ?? q.error ?? 'unknown'))), distribution('Container query conditions', containers.map((q) => String(q.query ?? 'unknown')))];
}

function roleLines(snap: SnapRef): FactLine[] {
  const ax = readAx<{ nodes?: Array<{ role?: { value?: string } | string; ignored?: boolean }>; axNodes?: Array<{ role?: { value?: string } | string; ignored?: boolean }> }>(snap);
  const nodes = ax.nodes ?? ax.axNodes ?? [];
  const roles = nodes.filter((node) => !node.ignored).map((node) => typeof node.role === 'string' ? node.role : node.role?.value ?? 'unknown');
  return [distribution('Accessibility role instances', roles)];
}

/** Builds a factual census from already-resolved snapshot artifacts. */
export function buildCensus(axis: CensusAxis, snapshots: readonly SnapRef[]): CensusReport {
  const lines: FactLine[] = [];
  // A multi-snapshot census has an explicit set-level distribution in addition
  // to the per-page measurements below; page summaries retain route context.
  if (axis === 'color') {
    const values = snapshots.flatMap((snap) => readStyles<StylesReport>(snap).elements.flatMap((e) => ['color', 'background-color'].map((prop) => e.computed?.[prop]).filter((v): v is string => !!v)));
    lines.push(distribution('Color values across snapshots', values), ...nearDuplicateLines(values));
  }
  for (const snap of snapshots) {
    const geometry = readGeometry<GeometryReport>(snap);
    const styles = readStyles<StylesReport>(snap);
    const textReport = readText<TextReport>(snap);
    const meta = readMeta<{ settled?: boolean }>(snap);
    lines.push(fact`Snapshot ${snap.id}: ${geometry.elements.length} geometry records; settled=${meta.settled === true ? 'true' : 'false'}.`);
    if (axis === 'color') lines.push(...colorLines(snap, styles, geometry));
    else if (axis === 'font' || axis === 'spacing' || axis === 'radius' || axis === 'shadow') lines.push(...styleValueLines(snap, styles, geometry, axis));
    else if (axis === 'geometry') lines.push(...geometryLines(snap, geometry, textReport), ...roleLines(snap));
    else if (axis === 'animation') lines.push(...animationLines(snap, readAnimation<AnimationReport>(snap)));
    else if (axis === 'queries') lines.push(...queryLines(readQueries<QueryReport>(snap)));
    else if (axis === 'media') lines.push(...mediaLines(snap));
  }
  const distinct = new Set(lines.map((l) => JSON.stringify(l))).size;
  return { axis, snapshots, distinct, lines };
}

export function censusResultLines(report: CensusReport): FactLine {
  return lineList(report.lines.length ? report.lines : [text`No census facts were recorded.`]);
}
