import * as fs from 'fs';
import * as path from 'path';

import { diffPngs } from '../../output/diff.js';
import { artifactPath, readEvents, readMarkers, readMeta, readRects, resolveRecRef, type RecRef } from '../../output/artifact.js';
import { ensurePrivateDir } from '../../session/artifacts.js';
import { sanitizeString } from '../measure/redaction.js';

export type ResponseStage = 'input' | 'mutation' | 'layout' | 'paint' | 'network' | 'longtask' | 'settle';
export type TimestampPrecision = 'exact' | 'frame';

export interface ResponsePoint {
  readonly stage: ResponseStage;
  /** Milliseconds in the recording-relative performance.now() domain. */
  readonly timestampMs: number;
  /** Delta from the selected input's start. */
  readonly deltaMs: number;
  readonly precision: TimestampPrecision;
  /** Fixed, sanitized label for the evidence source. */
  readonly source: string;
}

export interface ResponseTimeline {
  readonly action: string;
  readonly inputStartMs: number;
  readonly inputEndMs: number;
  readonly actionWindowEndMs: number | null;
  readonly points: readonly ResponsePoint[];
  readonly unavailableStages: readonly string[];
  readonly caveats: readonly string[];
  readonly state: string;
  readonly timingNote: string;
}

interface Markers {
  performanceNowMs: number;
  wallClockMs?: number;
  firstScreencastTimestampSec?: number | null;
  firstTraceEventTsUs?: number | null;
  tracePerformanceNowMs?: number | null;
  traceTimestampUs?: number | null;
  baselinesPending?: boolean;
}

interface EventRecord {
  kind?: unknown;
  mark?: unknown;
  startPerformanceNow?: unknown;
  endPerformanceNow?: unknown;
  performanceNowMs?: unknown;
  performanceNow?: unknown;
  startTime?: unknown;
  duration?: unknown;
  entryType?: unknown;
  name?: unknown;
  events?: unknown;
  timestamp?: unknown;
  reason?: unknown;
  count?: unknown;
}

interface FrameRecord {
  frame?: unknown;
  file?: unknown;
  screencastTimestamp?: unknown;
  timestamp?: unknown;
  diffPixelCount?: unknown;
}

interface ActionMark {
  readonly label: string;
  readonly occurrence: number;
  readonly startMs: number;
  readonly endMs: number;
}

interface CandidatePoint extends Omit<ResponsePoint, 'deltaMs'> {}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function count(value: unknown): number | null {
  return finite(value) && value >= 0 ? value : null;
}

function relativePerformance(timestamp: number, markers: Markers): number {
  return timestamp - markers.performanceNowMs;
}

function observerPerformance(event: EventRecord, markers: Markers): number | null {
  const timestamp = event.kind === 'performance'
    ? event.startTime ?? event.performanceNowMs ?? event.performanceNow
    : event.performanceNowMs ?? event.performanceNow ?? event.startTime;
  return finite(timestamp) ? relativePerformance(timestamp, markers) : null;
}

function tracePerformance(timestampUs: number, markers: Markers): number | null {
  const traceAnchorUs = finite(markers.traceTimestampUs) ? markers.traceTimestampUs : null;
  const traceAnchorPerf = finite(markers.tracePerformanceNowMs) ? markers.tracePerformanceNowMs : null;
  if (traceAnchorUs !== null && traceAnchorPerf !== null) return (timestampUs - traceAnchorUs) / 1000 + relativePerformance(traceAnchorPerf, markers);
  return null;
}

function framePerformance(timestampSec: number, markers: Markers): number | null {
  if (!finite(markers.wallClockMs)) return null;
  return timestampSec * 1000 - markers.wallClockMs;
}

function inWindow(point: CandidatePoint, startMs: number, endMs: number | null): boolean {
  return point.timestampMs >= startMs && (endMs === null || point.timestampMs < endMs);
}

function traceEvents(events: readonly EventRecord[], markers: Markers, caveats: string[]): Array<{ name: string; timestampMs: number; durationMs?: number }> {
  const output: Array<{ name: string; timestampMs: number; durationMs?: number }> = [];
  for (const event of events) {
    if (event.kind !== 'trace' || !Array.isArray(event.events)) continue;
    for (const raw of event.events) {
      if (!raw || typeof raw !== 'object') continue;
      const trace = raw as { name?: unknown; ts?: unknown; dur?: unknown };
      if (!finite(trace.ts) || typeof trace.name !== 'string') continue;
      const timestampMs = tracePerformance(trace.ts, markers);
      if (timestampMs === null) continue;
      output.push({ name: sanitizeString(trace.name, { max: 100 }), timestampMs, durationMs: finite(trace.dur) ? trace.dur / 1000 : undefined });
    }
  }
  if (events.some((event) => event.kind === 'trace') && output.length === 0) {
    caveats.push('trace timing unavailable: markers.json has no real trace timestamp/performance alignment marker; trace-derived response rows are omitted.');
  }
  return output;
}

function inputMarks(events: readonly EventRecord[], markers: Markers): ActionMark[] {
  const seen = new Map<string, number>();
  const marks: ActionMark[] = [];
  for (const event of events) {
    if (event.kind !== 'input' || typeof event.mark !== 'string' || !finite(event.startPerformanceNow)) continue;
    const label = sanitizeString(event.mark, { max: 200 });
    const occurrence = (seen.get(label) ?? 0) + 1;
    seen.set(label, occurrence);
    const startMs = relativePerformance(event.startPerformanceNow, markers);
    const endMs = finite(event.endPerformanceNow) ? relativePerformance(event.endPerformanceNow, markers) : startMs;
    marks.push({ label, occurrence, startMs, endMs });
  }
  return marks.sort((a, b) => a.startMs - b.startMs || a.occurrence - b.occurrence);
}

function selectAction(actions: readonly ActionMark[], action: string): ActionMark {
  const sanitized = sanitizeString(action, { max: 200 });
  const matches = actions.filter((item) => item.label === sanitized);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new ResponseActionSelectionError(actions, `Action ${JSON.stringify(sanitized)} appears ${matches.length} times; select a recording with a unique action label or inspect occurrences individually.`);
  throw new Error(`No input mark exists for action ${JSON.stringify(sanitized)}.`);
}

function eventDropCaveats(events: readonly EventRecord[]): string[] {
  const caveats: string[] = [];
  for (const event of events) {
    if (event.kind !== 'trace-dropped' && event.kind !== 'binding-dropped' && event.kind !== 'rect-sample-dropped') continue;
    const dropped = count(event.count);
    const reason = typeof event.reason === 'string' ? sanitizeString(event.reason, { max: 80 }) : 'unknown reason';
    caveats.push(`${event.kind}: ${dropped ?? 'unknown'} record(s) dropped (${reason}); response evidence may be truncated.`);
  }
  return caveats;
}

interface FrameDelta {
  readonly timestampMs: number;
  readonly diffPixelCount: number;
  readonly source: string;
}

function frameRecordTime(frame: FrameRecord, markers: Markers): number | null {
  const native = finite(frame.screencastTimestamp) ? frame.screencastTimestamp : finite(frame.timestamp) ? frame.timestamp : null;
  return native === null ? null : framePerformance(native, markers);
}

function frameDeltasFromRecords(frames: readonly FrameRecord[], markers: Markers): FrameDelta[] {
  return frames
    .map((frame, index) => ({ frame, index, timestampMs: frameRecordTime(frame, markers), diffPixelCount: count(frame.diffPixelCount) }))
    .filter((item): item is { frame: FrameRecord; index: number; timestampMs: number; diffPixelCount: number } => item.timestampMs !== null && item.diffPixelCount !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .map((item) => ({ timestampMs: item.timestampMs, diffPixelCount: item.diffPixelCount, source: `frame delta ${item.index}` }));
}

function firstPaintDelta(frameDeltas: readonly FrameDelta[], startMs: number, endMs: number | null): CandidatePoint | null {
  const delta = frameDeltas.find((item) => item.diffPixelCount > 0 && item.timestampMs >= startMs && (endMs === null || item.timestampMs < endMs));
  return delta ? { stage: 'paint', timestampMs: delta.timestampMs, precision: 'frame', source: `${delta.source} (${delta.diffPixelCount} changed pixel(s))` } : null;
}

function settlePoint(frameDeltas: readonly FrameDelta[], candidates: readonly CandidatePoint[], startMs: number, endMs: number | null): CandidatePoint | null {
  const lastSignalMs = Math.max(startMs, ...candidates.filter((point) => inWindow(point, startMs, endMs)).map((point) => point.timestampMs));
  let consecutiveIdentical = 0;
  for (const delta of frameDeltas) {
    if (delta.timestampMs < lastSignalMs || (endMs !== null && delta.timestampMs >= endMs)) continue;
    if (delta.diffPixelCount === 0) consecutiveIdentical += 1;
    else consecutiveIdentical = 0;
    if (consecutiveIdentical >= 2 && delta.timestampMs - lastSignalMs >= 300) {
      return { stage: 'settle', timestampMs: delta.timestampMs, precision: 'frame', source: 'two consecutive identical frame deltas; no scoped DOM/network/layout/paint signal for ≥300ms' };
    }
  }
  return null;
}

function firstStage(candidates: readonly CandidatePoint[], stage: ResponseStage, startMs: number, endMs: number | null): CandidatePoint | null {
  return candidates.filter((point) => point.stage === stage && inWindow(point, startMs, endMs)).sort((a, b) => a.timestampMs - b.timestampMs)[0] ?? null;
}

/**
 * Reduces recorder artifacts into response facts. It never invents a stage:
 * absent/unusable evidence is reported as unavailable, and settle is emitted
 * only from action-scoped identical-frame + quiet-window evidence.
 */
export function responseTimelineFromArtifacts(
  action: string,
  events: readonly EventRecord[],
  frames: readonly FrameRecord[],
  markers: Markers,
  state: string,
): ResponseTimeline {
  if (!finite(markers.performanceNowMs)) throw new Error('markers.json has no finite performanceNowMs baseline; re-record with `capture motion rec`.');
  const caveats = eventDropCaveats(events);
  if (markers.baselinesPending) caveats.push('markers.json still has baselinesPending=true; timing sources without anchors are omitted rather than aligned approximately.');
  if (state === 'orphaned-finalized') caveats.push('recording state is orphaned-finalized; artifacts are a partial best-effort recording from data flushed before recorder exit.');
  if (!finite(markers.wallClockMs)) caveats.push('screencast wall-clock anchor unavailable; frame-derived paint and settle timing are unavailable.');

  const actions = inputMarks(events, markers);
  const selected = selectAction(actions, action);
  const nextAction = actions.find((item) => item.startMs > selected.startMs);
  const actionWindowEndMs = nextAction?.startMs ?? null;

  const candidates: CandidatePoint[] = [];
  for (const event of events) {
    const timestampMs = observerPerformance(event, markers);
    if (timestampMs === null) continue;
    if (event.kind === 'mutation') candidates.push({ stage: 'mutation', timestampMs, precision: 'exact', source: 'MutationObserver' });
    if (event.kind === 'resize' || (event.kind === 'performance' && event.entryType === 'layout')) candidates.push({ stage: 'layout', timestampMs, precision: 'exact', source: event.kind === 'resize' ? 'ResizeObserver' : 'PerformanceObserver layout entry' });
    if (event.kind === 'performance' && event.entryType === 'paint') candidates.push({ stage: 'paint', timestampMs, precision: 'exact', source: 'PerformanceObserver paint entry' });
    if (event.kind === 'network') candidates.push({ stage: 'network', timestampMs, precision: 'exact', source: 'network event' });
    if (event.kind === 'performance' && event.entryType === 'longtask') candidates.push({ stage: 'longtask', timestampMs, precision: 'exact', source: 'PerformanceObserver longtask entry' });
  }

  for (const trace of traceEvents(events, markers, caveats)) {
    if (/layout|updatelayouttree/i.test(trace.name)) candidates.push({ stage: 'layout', timestampMs: trace.timestampMs, precision: 'exact', source: `Tracing ${trace.name}` });
    else if (/paint|composite|drawframe/i.test(trace.name)) candidates.push({ stage: 'paint', timestampMs: trace.timestampMs, precision: 'exact', source: `Tracing ${trace.name}` });
    else if (/network|resource(send|receive|finish)|load/i.test(trace.name)) candidates.push({ stage: 'network', timestampMs: trace.timestampMs, precision: 'exact', source: `Tracing ${trace.name}` });
    else if (/(longtask|run(task|microtasks)|task)/i.test(trace.name) && (trace.durationMs ?? 0) >= 50) candidates.push({ stage: 'longtask', timestampMs: trace.timestampMs, precision: 'exact', source: `Tracing ${trace.name}` });
  }

  const frameDeltas = frameDeltasFromRecords(frames, markers);
  const paintFromFrames = firstPaintDelta(frameDeltas, selected.startMs, actionWindowEndMs);
  if (paintFromFrames) candidates.push(paintFromFrames);

  const points: ResponsePoint[] = [{ stage: 'input', timestampMs: selected.startMs, deltaMs: 0, precision: 'exact', source: `input dispatch mark (occurrence ${selected.occurrence})` }];
  for (const stage of ['mutation', 'layout', 'paint', 'network', 'longtask'] as const) {
    const point = firstStage(candidates, stage, selected.startMs, actionWindowEndMs);
    if (point) points.push({ ...point, deltaMs: point.timestampMs - selected.startMs });
  }
  const settle = settlePoint(frameDeltas, candidates, selected.startMs, actionWindowEndMs);
  if (settle) points.push({ ...settle, deltaMs: settle.timestampMs - selected.startMs });

  points.sort((a, b) => a.timestampMs - b.timestampMs || a.stage.localeCompare(b.stage));

  const present = new Set(points.map((point) => point.stage));
  const unavailableStages = ['mutation', 'layout', 'paint', 'network', 'settle'].filter((stage) => !present.has(stage as ResponseStage));
  if (unavailableStages.includes('paint') && frameDeltas.length === 0) caveats.push('paint-different frame unavailable: no readable adjacent frame deltas with wall-clock-aligned timestamps.');
  if (unavailableStages.includes('settle')) caveats.push('settle unavailable: this action window has no two consecutive identical frame deltas after ≥300ms without scoped response signals.');

  return {
    action: selected.label,
    inputStartMs: selected.startMs,
    inputEndMs: selected.endMs,
    actionWindowEndMs,
    points,
    unavailableStages,
    caveats,
    state: sanitizeString(state, { max: 80 }),
    timingNote: 'Timestamps use performance.now() relative to recorder arm; observer points use PerformanceEntry.startTime when present, trace points require a real trace alignment marker, and frame-derived points use the screencast wall-clock anchor with ±1 frame uncertainty.',
  };
}

export interface LoadedResponseTimeline {
  readonly ref: RecRef;
  readonly timeline: ResponseTimeline;
  readonly availableActions: readonly string[];
}

function withFrameDeltas(ref: RecRef, rects: readonly FrameRecord[], markers: Markers): FrameRecord[] {
  const framesDir = artifactPath(ref, 'frames', { mustExist: false });
  if (!fs.existsSync(framesDir) || !fs.statSync(framesDir).isDirectory()) return [...rects];
  const files = fs.readdirSync(framesDir).filter((name) => name.endsWith('.png')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (files.length < 2) return [...rects];
  const byFile = new Map(rects.filter((record) => typeof record.file === 'string').map((record) => [record.file as string, record]));
  const workDir = path.join(ref.dir, '.response-diff-work');
  ensurePrivateDir(workDir);
  try {
    const output: FrameRecord[] = [...rects];
    for (let i = 0; i < files.length - 1; i++) {
      const before = path.join(framesDir, files[i]);
      const after = path.join(framesDir, files[i + 1]);
      const diffPath = path.join(workDir, `pair-${String(i).padStart(6, '0')}.png`);
      const diff = diffPngs(before, after, diffPath, { diffMask: true });
      if (!diff.ok) continue;
      const afterRecord = byFile.get(files[i + 1]);
      if (afterRecord) output.push({ ...afterRecord, diffPixelCount: diff.diffPixelCount });
      else output.push({ file: files[i + 1], screencastTimestamp: undefined, timestamp: undefined, frame: i + 1, diffPixelCount: diff.diffPixelCount });
    }
    return output;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** Resolves and validates a finalized recording before reading its response artifacts. */
export function loadResponseTimeline(rec: string, action?: string): LoadedResponseTimeline {
  const ref = resolveRecRef(rec);
  const meta = readMeta<{ state?: unknown }>(ref);
  const state = typeof meta.state === 'string' ? meta.state : 'unknown';
  if (state !== 'finalized' && state !== 'orphaned-finalized') {
    throw new Error(`Recording ${JSON.stringify(ref.id)} is state ${JSON.stringify(state)}; finalize it with \`capture motion rec --stop\` before querying response.`);
  }
  const events = readEvents<EventRecord>(ref);
  const markers = readMarkers<Markers>(ref);
  if (!finite(markers.performanceNowMs)) throw new Error('markers.json has no finite performanceNowMs baseline; re-record with `capture motion rec`.');
  const actions = inputMarks(events, markers);
  if (!action && actions.length !== 1) throw new ResponseActionSelectionError(actions);
  const selected = action ?? actions[0]?.label;
  if (!selected) throw new ResponseActionSelectionError(actions);
  const rects = readRects<FrameRecord>(ref);
  const frames = withFrameDeltas(ref, rects, markers);
  return { ref, timeline: responseTimelineFromArtifacts(selected, events, frames, markers, state), availableActions: actions.map((item) => actionOccurrenceLabel(item)) };
}

function actionOccurrenceLabel(action: ActionMark): string {
  return `${action.label} (occurrence ${action.occurrence}, t=${action.startMs.toFixed(2)}ms)`;
}

export class ResponseActionSelectionError extends Error {
  readonly actions: readonly string[];
  constructor(actions: readonly ActionMark[] | readonly string[], message?: string) {
    const labels = actions.map((action) => typeof action === 'string' ? action : actionOccurrenceLabel(action));
    super(message ?? (labels.length === 0 ? 'Recording has no injected input marks.' : 'Recording has multiple input marks; pass --action <unique action>.'));
    this.name = 'ResponseActionSelectionError';
    this.actions = labels;
  }
}
