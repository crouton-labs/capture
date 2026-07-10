import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { CDPClient } from '../client.js';
import { ensurePrivateDir, writeJsonPrivate } from '../../session/artifacts.js';
import type { SnapshotMeta } from './types.js';

export const SWEEP_AXES = ['width', 'dpr', 'zoom', 'color-scheme', 'reduced-motion'] as const;
export type SweepAxis = (typeof SWEEP_AXES)[number];

export interface SweepSample {
  readonly value: number | string;
  readonly snapId: string;
  readonly snapDir: string;
  readonly fingerprint: string;
  readonly settled: boolean;
  readonly unstableRegions: readonly { id: string; selector?: string; reason?: string }[];
}

export interface SweepTransition {
  readonly bracket: { readonly from: number | string; readonly to: number | string };
  readonly before: string;
  readonly after: string;
  readonly changes: readonly SweepChange[];
}

export interface SweepChange {
  readonly selector: string;
  readonly property: string;
  readonly before: string | null;
  readonly after: string | null;
  readonly provenance?: {
    readonly selector?: string;
    readonly specificity?: string;
    readonly source?: string;
  };
}

/** Adjacent observed samples with matching fingerprints; this is not a claim about unobserved values between them. */
export interface SweepRange {
  readonly from: number | string;
  readonly to: number | string;
  readonly snapId: string;
  readonly fingerprint: string;
}

export interface SweepUncertainty {
  readonly from: number;
  readonly to: number;
  readonly reason: 'sampling_limit' | 'resolution_limit';
}

export interface SweepArtifact {
  readonly axis: SweepAxis;
  readonly from: number | string;
  readonly to: number | string;
  readonly capturedAt: string;
  readonly samples: readonly SweepSample[];
  readonly transitions: readonly SweepTransition[];
  readonly ranges: readonly SweepRange[];
  readonly uncertainties: readonly SweepUncertainty[];
  readonly sampleLimit?: number;
  /** Effective environment facts captured before sampling; CDP does not expose arbitrary pre-existing override configuration. */
  readonly environmentRestoration?: {
    readonly observed: readonly string[];
    readonly unobservable: readonly string[];
  };
}

export interface SweepRecovery {
  readonly axis: SweepAxis;
  readonly capturedAt: string;
  readonly reason: 'evidence_only' | 'capture_failed';
  /** Whether restoration was not reached, completed, or threw while handling the failed sweep. */
  readonly environmentRestoration: 'not_attempted' | 'restored' | 'failed';
  readonly samples: readonly {
    value: number | string;
    snapId: string;
    snapDir: string;
    /** The capture lifecycle state known by the orchestrator; failed records may contain artifacts written before the throw. */
    status: 'pending' | 'captured' | 'evidence_only' | 'failed';
    captured: boolean;
    settled: boolean;
    unstableRegions: readonly { id: string; selector?: string; reason?: string }[];
    artifacts: readonly string[];
    failure?: 'capture_threw';
  }[];
}

interface StylesElement {
  readonly id?: string;
  readonly selector?: string;
  readonly computed?: Record<string, string | null>;
  readonly winningDeclarations?: readonly {
    readonly property?: string;
    readonly selector?: string | null;
    readonly specificity?: string | null;
    readonly authored?: { readonly file?: string; readonly line?: number; readonly column?: number };
    readonly generated?: { readonly sourceURL?: string; readonly line?: number; readonly column?: number };
  }[];
}

interface StylesReport {
  readonly elements?: readonly StylesElement[];
}

interface GeometryReport {
  readonly elements?: readonly { readonly id?: string; readonly selector?: string; readonly visible?: boolean; readonly display?: string }[];
}

interface TextElement {
  readonly id?: string;
  readonly selector?: string;
  readonly backendNodeId?: number | null;
  readonly lines?: readonly unknown[];
  readonly wrapOffsets?: readonly number[];
}

interface TextReport {
  readonly elements?: readonly TextElement[];
  readonly nodes?: readonly TextElement[];
}

const DISCRETE_COMPUTED_PROPERTIES = new Set([
  'display', 'visibility', 'position', 'float', 'clear', 'overflow', 'overflow-x', 'overflow-y',
  'flex-direction', 'flex-wrap', 'grid-auto-flow', 'justify-content', 'align-items', 'align-content',
  'white-space', 'word-break', 'overflow-wrap', 'text-overflow', 'content-visibility', 'pointer-events',
  'writing-mode', 'direction', 'font-style', 'color', 'background-color',
  'grid-template-areas', 'color-scheme', 'mix-blend-mode', 'isolation',
]);

function readJson<T>(filePath: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function gridTrackCount(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const repeat = /^repeat\(\s*(\d+)\s*,/.exec(value);
  if (repeat) return Number(repeat[1]);
  const tracks = value.trim().split(/\s+/).filter(Boolean);
  return tracks.length || undefined;
}

function colorCategory(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value);
  if (!rgb) return 'other';
  const [red, green, blue, alpha] = rgb.slice(1).map(Number);
  if (alpha !== undefined && alpha === 0) return 'transparent';
  const maximum = Math.max(red, green, blue);
  const dominant = `${red === maximum ? 'r' : ''}${green === maximum ? 'g' : ''}${blue === maximum ? 'b' : ''}`;
  return `${dominant}-${maximum + Math.min(red, green, blue) >= 255 ? 'light' : 'dark'}`;
}

function fingerprintComputed(property: string, value: string | null): string | null | undefined {
  if (property === 'color' || property === 'background-color') return colorCategory(value);
  return value;
}

/** A deterministic signature containing only categorical rendered-state facts. Fluid geometry, numeric styles, collector identities, and CSS provenance are deliberately excluded. Each collector's document-order records stay ordered so anonymous elements retain their structural association. */
export function fingerprintSnapshotDir(snapDir: string): string {
  const geometry = readJson<GeometryReport>(path.join(snapDir, 'geometry.json'));
  const styles = readJson<StylesReport>(path.join(snapDir, 'styles.json'));
  const text = readJson<TextReport>(path.join(snapDir, 'text.json'));
  const substrate = {
    geometry: geometry?.elements?.map((element) => ({ visible: element.visible, display: element.display })) ?? { missing: 'geometry.json' },
    styles: styles?.elements?.map((element) => ({
      computed: Object.fromEntries(Object.entries(element.computed ?? {}).filter(([property]) => DISCRETE_COMPUTED_PROPERTIES.has(property)).sort(([a], [b]) => a.localeCompare(b)).map(([property, value]) => [property, fingerprintComputed(property, value)])),
      gridTrackCount: gridTrackCount(element.computed?.['grid-template-columns']),
    })) ?? { missing: 'styles.json' },
    text: (text?.elements ?? text?.nodes)?.map((element) => ({ lineCount: element.lines?.length, wrapOffsets: element.wrapOffsets })) ?? { missing: 'text.json' },
  };
  return crypto.createHash('sha256').update(JSON.stringify(substrate)).digest('hex');
}

interface SweepDeclaration {
  readonly property?: string;
  readonly selector?: string | null;
  readonly specificity?: string | null;
  readonly authored?: { readonly file?: string; readonly line?: number; readonly column?: number };
  readonly generated?: { readonly sourceURL?: string; readonly line?: number; readonly column?: number };
}

function sourceFor(declaration: SweepDeclaration): SweepChange['provenance'] | undefined {
  const authored = declaration.authored;
  const generated = declaration.generated;
  const source = authored?.file ? `${authored.file}${authored.line === undefined ? '' : `:${authored.line}${authored.column === undefined ? '' : `:${authored.column}`}`}` : generated?.sourceURL ? `${generated.sourceURL}${generated.line === undefined ? '' : `:${generated.line}${generated.column === undefined ? '' : `:${generated.column}`}`}` : undefined;
  if (!declaration.selector && !declaration.specificity && !source) return undefined;
  return { selector: declaration.selector ?? undefined, specificity: declaration.specificity ?? undefined, source };
}

/** Extracts changed computed values and the winning declaration for the new value, when captured. */
export function changesBetweenSnapshots(beforeDir: string, afterDir: string): SweepChange[] {
  const before = readJson<StylesReport>(path.join(beforeDir, 'styles.json'));
  const after = readJson<StylesReport>(path.join(afterDir, 'styles.json'));
  if (!before?.elements || !after?.elements) return [];
  const prior = new Map(before.elements.map((element) => [element.id ?? element.selector ?? '', element]));
  const changes: SweepChange[] = [];
  for (const next of after.elements) {
    const key = next.id ?? next.selector ?? '';
    const old = prior.get(key);
    if (!old) continue;
    const properties = new Set([...Object.keys(old.computed ?? {}), ...Object.keys(next.computed ?? {})]);
    for (const property of properties) {
      const beforeValue = old.computed?.[property] ?? null;
      const afterValue = next.computed?.[property] ?? null;
      if (beforeValue === afterValue) continue;
      const declaration = next.winningDeclarations?.find((candidate) => candidate.property === property);
      changes.push({ selector: next.selector ?? key, property, before: beforeValue, after: afterValue, ...(declaration ? { provenance: sourceFor(declaration) } : {}) });
    }
  }
  return changes;
}

/** Builds adjacent observed changes and matching-fingerprint spans; neither denotes unobserved values as stable. */
export function analyzeSweepSamples(axis: SweepAxis, _from: number | string, _to: number | string, samples: readonly SweepSample[]): Pick<SweepArtifact, 'transitions' | 'ranges'> {
  const transitions: SweepTransition[] = [];
  const ranges: SweepRange[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    const previous = samples[i - 1];
    const current = samples[i];
    if (previous.fingerprint === current.fingerprint) {
      ranges.push({ from: previous.value, to: current.value, snapId: previous.snapId, fingerprint: previous.fingerprint });
      continue;
    }
    transitions.push({ bracket: { from: previous.value, to: current.value }, before: previous.snapId, after: current.snapId, changes: changesBetweenSnapshots(previous.snapDir, current.snapDir) });
  }
  return { transitions, ranges };
}

export async function refineNumericSweep(samples: readonly SweepSample[], tolerance: number, capture: (value: number) => Promise<SweepSample>, sampleLimit = 96): Promise<{ samples: SweepSample[]; uncertainties: SweepUncertainty[] }> {
  const byValue = new Map(samples.map((sample) => [Number(sample.value), sample]));
  const uncertainties: SweepUncertainty[] = [];
  const ordered = [...byValue.keys()].sort((a, b) => a - b);
  const pending: Array<{ from: number; to: number }> = [];
  for (let i = 1; i < ordered.length; i += 1) pending.push({ from: ordered[i - 1], to: ordered[i] });
  // Breadth-first subdivision gives every coarse interval a sampled midpoint before spending the budget on finer detail in any one interval.
  while (pending.length) {
    const { from, to } = pending.shift()!;
    if (to - from <= tolerance) {
      uncertainties.push({ from, to, reason: 'resolution_limit' });
      continue;
    }
    if (byValue.size >= sampleLimit) {
      uncertainties.push({ from, to, reason: 'sampling_limit' });
      continue;
    }
    const middle = tolerance >= 1 ? Math.floor((from + to) / 2) : Number(((from + to) / 2).toFixed(4));
    if (middle <= from || middle >= to) {
      uncertainties.push({ from, to, reason: 'resolution_limit' });
      continue;
    }
    if (!byValue.has(middle)) byValue.set(middle, await capture(middle));
    pending.push({ from, to: middle }, { from: middle, to });
  }
  return { samples: [...byValue.values()].sort((a, b) => Number(a.value) - Number(b.value)), uncertainties };
}

export function isSweepAxis(value: string | undefined): value is SweepAxis {
  return value !== undefined && (SWEEP_AXES as readonly string[]).includes(value);
}

export function numericSweepValues(from: number, to: number, axis: Extract<SweepAxis, 'width' | 'dpr' | 'zoom'>): number[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) throw new Error(`--from must be smaller than --to for ${axis}`);
  const step = axis === 'width' ? Math.max(1, Math.ceil((to - from) / 8)) : (to - from) / 8;
  const values = [from];
  for (let value = from + step; value < to; value += step) values.push(axis === 'width' ? Math.round(value) : Number(value.toFixed(4)));
  values.push(to);
  return [...new Set(values)].sort((a, b) => a - b);
}

export type SweepMedia = 'screen' | 'print' | 'speech';

export interface SweepEnvironment {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly pageScale: number;
  /** An effective media type observable through CSS media queries; omitted when the prior CDP type cannot be determined. */
  readonly media?: SweepMedia;
  readonly colorScheme: 'light' | 'dark';
  readonly reducedMotion: 'reduce' | 'no-preference';
}

export async function readSweepEnvironment(client: CDPClient): Promise<SweepEnvironment> {
  const response = await client.send('Runtime.evaluate', { expression: '({width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio, pageScale: window.visualViewport?.scale || 1, media: matchMedia("print").matches ? "print" : matchMedia("speech").matches ? "speech" : matchMedia("screen").matches ? "screen" : null, colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light", reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduce" : "no-preference"})', returnByValue: true }) as { result?: { value?: Partial<SweepEnvironment> } };
  const value = response.result?.value;
  if (!value || !Number.isFinite(value.width) || !Number.isFinite(value.height) || !Number.isFinite(value.dpr) || !Number.isFinite(value.pageScale) || (value.media !== undefined && value.media !== 'screen' && value.media !== 'print' && value.media !== 'speech' && value.media !== null) || (value.colorScheme !== 'light' && value.colorScheme !== 'dark') || (value.reducedMotion !== 'reduce' && value.reducedMotion !== 'no-preference')) throw new Error('could not read the page emulation environment before sampling');
  return { width: Math.round(value.width), height: Math.round(value.height), dpr: value.dpr, pageScale: value.pageScale, ...(value.media ? { media: value.media } : {}), colorScheme: value.colorScheme, reducedMotion: value.reducedMotion };
}

function mediaParams(baseline: SweepEnvironment): { media?: SweepMedia } {
  return baseline.media === undefined ? {} : { media: baseline.media };
}

export async function applySweepEmulation(client: CDPClient, axis: SweepAxis, value: number | string, baseline: SweepEnvironment): Promise<void> {
  if (axis === 'width') await client.send('Emulation.setDeviceMetricsOverride', { width: Math.round(Number(value)), height: baseline.height, deviceScaleFactor: baseline.dpr, mobile: false });
  else if (axis === 'dpr') await client.send('Emulation.setDeviceMetricsOverride', { width: baseline.width, height: baseline.height, deviceScaleFactor: Number(value), mobile: false });
  else if (axis === 'zoom') await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: Number(value) });
  else await client.send('Emulation.setEmulatedMedia', { ...mediaParams(baseline), features: [{ name: 'prefers-color-scheme', value: axis === 'color-scheme' ? String(value) : baseline.colorScheme }, { name: 'prefers-reduced-motion', value: axis === 'reduced-motion' ? String(value) : baseline.reducedMotion }] });
}

/** Restores the observed pre-sweep viewport, scale, and supported media settings; an unobservable media type is never replaced with an invented one. */
export async function restoreSweepEnvironment(client: CDPClient, baseline: SweepEnvironment): Promise<void> {
  await client.send('Emulation.setDeviceMetricsOverride', { width: baseline.width, height: baseline.height, deviceScaleFactor: baseline.dpr, mobile: false });
  await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: baseline.pageScale });
  await client.send('Emulation.setEmulatedMedia', { ...mediaParams(baseline), features: [{ name: 'prefers-color-scheme', value: baseline.colorScheme }, { name: 'prefers-reduced-motion', value: baseline.reducedMotion }] });
}

export function readSweepSnapshot(snapId: string, snapDir: string, value: number | string, unstableRegions: SweepSample['unstableRegions'] = [], capturedSettled?: boolean): SweepSample {
  const meta = readJson<SnapshotMeta>(path.join(snapDir, 'meta.json'));
  return { value, snapId, snapDir, fingerprint: fingerprintSnapshotDir(snapDir), settled: capturedSettled ?? (meta?.settled === true), unstableRegions };
}

export function writeSweepArtifact(dir: string, artifact: SweepArtifact): string {
  const artifactPath = path.join(ensurePrivateDir(dir), 'sweep.json');
  writeJsonPrivate(artifactPath, artifact);
  return artifactPath;
}

export function writeSweepRecoveryArtifact(dir: string, recovery: SweepRecovery): string {
  const artifactPath = path.join(ensurePrivateDir(dir), 'sweep-recovery.json');
  writeJsonPrivate(artifactPath, recovery);
  return artifactPath;
}
