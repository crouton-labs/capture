import * as fs from 'node:fs';
import * as path from 'node:path';
import { PNG } from 'pngjs';

import { getActiveSession } from '../../session-context.js';
import { createOneshotSession } from '../../session/commands.js';
import { writeBinaryPrivate } from '../../session/artifacts.js';
import { artifactPath, readGeometry, readMeta, readQueries, readStyles, readText, type SnapRef } from '../../output/artifact.js';
import { explainSnapshot, type ExplainAmbiguousSelector, type ExplainMissingSelector } from './explain.js';
import { measureElementContrast } from './check.js';

interface TextRecord {
  readonly id?: string;
  readonly geometryId?: string;
  readonly backendNodeId?: number | null;
  readonly selector?: string;
  readonly text?: string;
  readonly textLength?: number;
  readonly lineCount?: number;
  readonly truncated?: boolean;
  readonly truncationStyle?: string;
  readonly scrollWidth?: number;
  readonly clientWidth?: number;
  readonly writingMode?: string;
  readonly direction?: string;
  readonly fallbackUsed?: boolean;
  readonly font?: { readonly family?: string; readonly size?: string; readonly weight?: string; readonly lineHeight?: string };
  readonly platformFontsAvailable?: boolean;
  readonly platformFonts?: readonly { readonly familyName?: string }[];
  readonly lines?: readonly { readonly index?: number; readonly rect?: { readonly x?: number; readonly y?: number; readonly width?: number; readonly height?: number; readonly w?: number; readonly h?: number }; readonly baseline?: number; readonly baselineApproximate?: boolean; readonly wrapAfterChar?: number; readonly wrapAfterCharUnavailable?: boolean }[];
}

interface StyleRecord {
  readonly id?: string;
  readonly geometryId?: string;
  readonly backendNodeId?: number | null;
  readonly selector?: string;
  readonly provenanceUnavailable?: boolean;
  readonly winningDeclarations?: readonly { readonly property?: string; readonly value?: string | null; readonly selector?: string | null; readonly specificity?: string | null; readonly important?: boolean; readonly authored?: { readonly file?: string; readonly line?: number; readonly column?: number }; readonly generated?: { readonly sourceURL?: string; readonly line?: number; readonly column?: number }; readonly sourceStyleSheetUrl?: string; readonly winnerApproximate?: boolean; readonly winnerApproximateReason?: string }[];
}

interface GeometryRecord {
  readonly id: string;
  readonly selector?: string;
  readonly backendNodeId?: number | null;
  readonly domPath?: string;
}

interface TextArtifact {
  readonly elements?: TextRecord[];
  readonly available?: boolean;
  readonly unavailableReason?: string;
}

interface QueriesArtifact {
  readonly available?: boolean;
  readonly unavailableReason?: string;
  readonly environment?: { readonly width?: number; readonly height?: number };
}

export interface TextStyleProvenance {
  readonly element: string;
  readonly property: string;
  readonly value: string;
  readonly selector: string;
  readonly specificity: string;
  readonly source: string;
  readonly uncertainty?: string;
}

interface TextStyleProvenanceReport {
  readonly styles: readonly TextStyleProvenance[];
  readonly unavailableFor: readonly string[];
}

export interface TextCrop {
  readonly path: string;
  readonly requested: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly delivered: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly scale: { readonly x: number; readonly y: number };
}

export interface TextMeasurement {
  readonly kind: 'measurement';
  readonly ref: SnapRef;
  readonly selector: string;
  readonly matchCount: number;
  readonly element: { readonly id: string; readonly selector?: string; readonly backendNodeId?: number | null; readonly rect?: { readonly x: number; readonly y: number; readonly width?: number; readonly height?: number } | null };
  readonly text?: TextRecord;
  readonly textAvailable: boolean;
  readonly textUnavailableReason?: string;
  readonly contrast: ReturnType<typeof measureElementContrast>;
  readonly styles: readonly TextStyleProvenance[];
  readonly styleProvenanceUnavailableFor: readonly string[];
  readonly meta: { readonly settled?: boolean; readonly settleMs?: number; readonly viewport?: string | null };
}

export type TextSnapshotResult = TextMeasurement | ExplainMissingSelector | ExplainAmbiguousSelector;

function sameTarget(record: { backendNodeId?: number | null; id?: string; geometryId?: string }, element: { backendNodeId?: number | null; id: string }): boolean {
  return (typeof element.backendNodeId === 'number' && record.backendNodeId === element.backendNodeId) || record.id === element.id || record.geometryId === element.id;
}

function sourceOf(declaration: NonNullable<StyleRecord['winningDeclarations']>[number]): string {
  if (declaration.authored?.file) return `${declaration.authored.file}:${declaration.authored.line ?? 0}:${declaration.authored.column ?? 0} (authored)`;
  if (declaration.generated?.sourceURL) return `${declaration.generated.sourceURL}:${declaration.generated.line ?? 0}:${declaration.generated.column ?? 0} (generated)`;
  if (declaration.sourceStyleSheetUrl) return `${declaration.sourceStyleSheetUrl} (generated source)`;
  return 'selector-only provenance';
}

function parentPath(domPath: string | undefined): string | undefined {
  if (domPath === undefined) return undefined;
  const index = domPath.lastIndexOf('/');
  return index < 0 ? '' : domPath.slice(0, index);
}

function elementLabel(element: { id: string; selector?: string }): string {
  return element.selector ?? element.id;
}

function styleProvenance(ref: SnapRef, element: GeometryRecord, contrast: ReturnType<typeof measureElementContrast>): TextStyleProvenanceReport {
  const records = readStyles<{ elements?: StyleRecord[] }>(ref).elements ?? [];
  const geometry = readGeometry<{ elements?: GeometryRecord[] }>(ref).elements ?? [];
  const byPath = new Map(geometry.filter((candidate) => candidate.domPath !== undefined).map((candidate) => [candidate.domPath!, candidate]));
  const backgroundElements: GeometryRecord[] = [];
  let candidate: GeometryRecord | undefined = element;
  while (candidate) {
    backgroundElements.push(candidate);
    if (contrast.available && candidate.id === contrast.backgroundSourceElementId) break;
    candidate = byPath.get(parentPath(candidate.domPath) ?? '');
  }
  const targets = new Map<string, { element: GeometryRecord; properties: ReadonlySet<string> }>();
  targets.set(element.id, { element, properties: new Set(['color', 'background-color', 'backgroundColor']) });
  for (const ancestor of backgroundElements) {
    const existing = targets.get(ancestor.id);
    targets.set(ancestor.id, { element: ancestor, properties: existing ? new Set([...existing.properties, 'background-color', 'backgroundColor']) : new Set(['background-color', 'backgroundColor']) });
  }
  const styles: TextStyleProvenance[] = [];
  const unavailableFor: string[] = [];
  for (const { element: target, properties } of targets.values()) {
    const record = records.find((candidate) => sameTarget(candidate, target));
    if (!record || record.provenanceUnavailable) {
      unavailableFor.push(elementLabel(target));
      continue;
    }
    for (const declaration of record.winningDeclarations ?? []) {
      if (!declaration.property || !properties.has(declaration.property)) continue;
      styles.push({
        element: elementLabel(target),
        property: declaration.property,
        value: declaration.value ?? '(no computed value)',
        selector: declaration.selector ?? '(no author declaration)',
        specificity: declaration.specificity ?? (declaration.selector === 'inline' ? 'inline' : 'none'),
        source: sourceOf(declaration),
        ...(declaration.winnerApproximate ? { uncertainty: declaration.winnerApproximateReason ?? 'simplified cascade model' } : {}),
      });
    }
  }
  return { styles, unavailableFor };
}

/** Reads one target's recorded text, font, color, and cascade facts without driving a browser. */
export function measureTextSnapshot(ref: SnapRef, selector: string): TextSnapshotResult {
  const textArtifact = readText<TextArtifact>(ref);
  if (textArtifact.available === false && selector.startsWith('text:')) throw new Error(`text collection is unavailable${textArtifact.unavailableReason ? `: ${textArtifact.unavailableReason}` : ''}; cannot resolve a text: selector`);
  const selection = explainSnapshot(ref, selector, { text: true });
  if (selection.kind !== 'explanation') return selection;
  const element = selection.element;
  const textAvailable = textArtifact.available !== false;
  const text = textAvailable ? (textArtifact.elements ?? []).find((record) => sameTarget(record, element)) : undefined;
  const contrast = measureElementContrast(ref, element.id);
  const provenance = styleProvenance(ref, element, contrast);
  return {
    kind: 'measurement',
    ref,
    selector,
    matchCount: selection.matchCount,
    element,
    text,
    textAvailable,
    ...(textArtifact.available === false ? { textUnavailableReason: textArtifact.unavailableReason ?? 'no reason was recorded' } : {}),
    contrast,
    styles: provenance.styles,
    styleProvenanceUnavailableFor: provenance.unavailableFor,
    meta: { ...selection.meta, viewport: readMeta<{ viewport?: string | null }>(ref).viewport },
  };
}

function capturedCssViewport(ref: SnapRef): { width: number; height: number } {
  const queries = readQueries<QueriesArtifact>(ref);
  if (queries.available === false) throw new Error(`the snapshot query environment is unavailable${queries.unavailableReason ? `: ${queries.unavailableReason}` : ''}; cannot map CSS geometry to screenshot pixels`);
  const width = queries.environment?.width;
  const height = queries.environment?.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width! <= 0 || height! <= 0) throw new Error('the snapshot has no positive recorded CSS viewport in queries.json; cannot map CSS geometry to screenshot pixels');
  return { width: width!, height: height! };
}

/** Writes a crop into the active session or a fresh measure one-shot bundle, never into the source snapshot. */
export function writeTextCrop(measurement: TextMeasurement, artifactDir?: string): TextCrop {
  const rect = measurement.element.rect;
  const width = rect?.width;
  const height = rect?.height;
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(width) || !Number.isFinite(height) || width! <= 0 || height! <= 0) throw new Error('the selected element has no positive recorded geometry for a crop');
  const source = PNG.sync.read(fs.readFileSync(artifactPath(measurement.ref, 'screenshot.png')));
  const capturedViewport = capturedCssViewport(measurement.ref);
  const scaleX = source.width / capturedViewport.width;
  const scaleY = source.height / capturedViewport.height;
  const requested = { x: rect.x, y: rect.y, w: width!, h: height! };
  const x = Math.max(0, Math.floor(requested.x * scaleX));
  const y = Math.max(0, Math.floor(requested.y * scaleY));
  const right = Math.min(source.width, Math.ceil((requested.x + requested.w) * scaleX));
  const bottom = Math.min(source.height, Math.ceil((requested.y + requested.h) * scaleY));
  if (right <= x || bottom <= y) throw new Error('the selected element has no recorded intersection with screenshot.png');
  const crop = new PNG({ width: right - x, height: bottom - y });
  PNG.bitblt(source, crop, x, y, crop.width, crop.height, 0, 0);
  const active = getActiveSession();
  const root = active?.dir ?? createOneshotSession('measure', artifactDir).dir;
  const filename = `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.png`;
  const output = path.join(root, 'measure', 'text', filename);
  writeBinaryPrivate(output, PNG.sync.write(crop));
  return {
    path: output,
    requested,
    delivered: { x, y, w: crop.width, h: crop.height },
    scale: { x: scaleX, y: scaleY },
  };
}
