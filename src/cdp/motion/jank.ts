import type { RecRef } from '../../output/artifact.js';
import { readEvents, readMarkers, readMeta, readRects } from '../../output/artifact.js';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface JankFrame {
  readonly frame: number;
  readonly tMs: number;
}

export interface DroppedFrameFact {
  readonly afterFrame: number;
  readonly beforeFrame: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly intervalMs: number;
  readonly estimatedDroppedFrames: number;
}

export type LongTaskTimingDomain = 'recorder-performance' | 'trace-relative-first-event' | 'unavailable';

export interface LongTaskFact {
  readonly source: 'observer' | 'trace';
  readonly timingDomain: LongTaskTimingDomain;
  /** Null when no synchronized recorder-relative observer baseline was retained. */
  readonly startMs: number | null;
  readonly durationMs: number;
  /** Null when no synchronized recorder-relative observer baseline was retained. */
  readonly endMs: number | null;
  /** Null when task/frame timing is incomparable or unavailable. */
  readonly overlapsDroppedFrames: readonly number[] | null;
}

export interface LayoutShiftRectFact {
  readonly elementId?: string;
  readonly rect?: Rect;
  readonly previousRect?: Rect;
  readonly delta?: Rect;
}

export type LayoutShiftAttribution = 'observer-sources' | 'frame-diff-inferred' | 'unavailable';

export interface LayoutShiftFact {
  /** Null when no synchronized recorder-relative observer baseline was retained. */
  readonly tMs: number | null;
  readonly value: number;
  readonly hadRecentInput?: boolean;
  readonly attribution: LayoutShiftAttribution;
  /** The two recorder-relative frame times used by a frame-diff inference. */
  readonly beforeFrameMs?: number;
  readonly afterFrameMs?: number;
  readonly rects: readonly LayoutShiftRectFact[];
}

export type JankCount = 'dropped-frames' | 'long-task-records' | 'layout-shift-records';

export interface ArtifactLossFact {
  readonly kind: string;
  readonly count?: number;
  readonly reason?: string;
  readonly message?: string;
  readonly affectedCounts: readonly JankCount[];
}

export interface MotionJankAnalysis {
  readonly frameCount: number;
  readonly cadenceMs: number | null;
  readonly missingFrameSampleCount: number;
  readonly droppedFrames: readonly DroppedFrameFact[];
  readonly droppedFrameCount: number;
  readonly droppedFramesIncomplete: boolean;
  readonly longTasks: readonly LongTaskFact[];
  readonly longTasksIncomplete: boolean;
  readonly layoutShifts: readonly LayoutShiftFact[];
  readonly layoutShiftsIncomplete: boolean;
  readonly artifactLoss: readonly ArtifactLossFact[];
  readonly frameTimestampUncertainty: '±frame' | 'unavailable';
  readonly timingNote: string;
}

interface Markers {
  performanceNowMs?: unknown;
  wallClockMs?: unknown;
  firstTraceEventTsUs?: unknown;
  /** An explicit synchronized trace/performance marker, if the recorder retained one. */
  traceTimestampUs?: unknown;
  tracePerformanceNowMs?: unknown;
  baselinesPending?: unknown;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function rect(value: unknown): Rect | undefined {
  const item = record(value);
  if (!item) return undefined;
  const x = finite(item.x ?? item.left);
  const y = finite(item.y ?? item.top);
  const w = finite(item.w ?? item.width);
  const h = finite(item.h ?? item.height);
  return x === undefined || y === undefined || w === undefined || h === undefined ? undefined : { x, y, w, h };
}

function delta(previous: Rect, current: Rect): Rect {
  return { x: current.x - previous.x, y: current.y - previous.y, w: current.w - previous.w, h: current.h - previous.h };
}

/** Converts a native screencast timestamp into recorder-relative performance.now() milliseconds. */
export function screencastToPerformanceMs(timestampSec: number, markers: Markers): number | null {
  const wallClockMs = finite(markers.wallClockMs);
  if (wallClockMs === undefined) return null;
  return timestampSec * 1000 - wallClockMs;
}

function observerToPerformanceMs(value: UnknownRecord, markers: Markers): number | null {
  const performanceNow = finite(value.startTime ?? value.performanceNowMs ?? value.performanceNow);
  const baseline = finite(markers.performanceNowMs);
  if (performanceNow === undefined || baseline === undefined) return null;
  return performanceNow - baseline;
}

function frameTime(value: UnknownRecord, markers: Markers): number | null {
  const screencast = finite(value.screencastTimestamp ?? value.timestamp);
  if (screencast !== undefined) return screencastToPerformanceMs(screencast, markers);
  return observerToPerformanceMs(value, markers);
}

function flattenTraceEvents(events: readonly unknown[]): UnknownRecord[] {
  const flattened: UnknownRecord[] = [];
  for (const event of events) {
    const item = record(event);
    if (!item || item.kind !== 'trace' || !Array.isArray(item.events)) continue;
    for (const traceEvent of item.events) {
      const trace = record(traceEvent);
      if (trace) flattened.push(trace);
    }
  }
  return flattened;
}

function traceTime(timestampUs: number, markers: Markers, fallbackBaselineUs: number | undefined): { tMs: number; domain: LongTaskTimingDomain } | null {
  const traceTimestampUs = finite(markers.traceTimestampUs);
  const tracePerformanceNowMs = finite(markers.tracePerformanceNowMs);
  const performanceNowMs = finite(markers.performanceNowMs);
  if (traceTimestampUs !== undefined && tracePerformanceNowMs !== undefined && performanceNowMs !== undefined) {
    return { tMs: (timestampUs - traceTimestampUs) / 1000 + tracePerformanceNowMs - performanceNowMs, domain: 'recorder-performance' };
  }
  const relativeBaselineUs = finite(markers.firstTraceEventTsUs) ?? fallbackBaselineUs;
  return relativeBaselineUs === undefined ? null : { tMs: (timestampUs - relativeBaselineUs) / 1000, domain: 'trace-relative-first-event' };
}

function rectFactsFromObserverSources(event: UnknownRecord): LayoutShiftRectFact[] {
  // Only PerformanceObserver LayoutShift.sources is element attribution. Other
  // similarly-shaped event fields are not promoted to a source record.
  if (!Array.isArray(event.sources)) return [];
  const facts: LayoutShiftRectFact[] = [];
  for (const raw of event.sources) {
    const item = record(raw);
    if (!item) continue;
    const previousRect = rect(item.previousRect);
    const currentRect = rect(item.currentRect);
    const elementId = typeof item.backendNodeId === 'number' || typeof item.backendNodeId === 'string'
      ? String(item.backendNodeId)
      : undefined;
    if (previousRect || currentRect || elementId) facts.push({ elementId, rect: currentRect, previousRect, delta: previousRect && currentRect ? delta(previousRect, currentRect) : undefined });
  }
  return facts;
}

function inferredRectFacts(shiftAtMs: number, frames: readonly { tMs: number; elements: UnknownRecord[] }[]): { rects: LayoutShiftRectFact[]; beforeFrameMs?: number; afterFrameMs?: number } {
  const before = [...frames].reverse().find((frame) => frame.tMs < shiftAtMs);
  const after = frames.find((frame) => frame.tMs > shiftAtMs);
  if (!before || !after) return { rects: [] };
  const previousById = new Map<string, Rect>();
  for (const element of before.elements) {
    const id = element.backendNodeId ?? element.elementId;
    const box = rect(element);
    if ((typeof id === 'string' || typeof id === 'number') && box) previousById.set(String(id), box);
  }
  const rects: LayoutShiftRectFact[] = [];
  for (const element of after.elements) {
    const id = element.backendNodeId ?? element.elementId;
    const currentRect = rect(element);
    if ((typeof id !== 'string' && typeof id !== 'number') || !currentRect) continue;
    const previousRect = previousById.get(String(id));
    if (!previousRect) continue;
    const changed = previousRect.x !== currentRect.x || previousRect.y !== currentRect.y || previousRect.w !== currentRect.w || previousRect.h !== currentRect.h;
    if (changed) rects.push({ elementId: String(id), previousRect, rect: currentRect, delta: delta(previousRect, currentRect) });
  }
  return { rects, beforeFrameMs: before.tMs, afterFrameMs: after.tMs };
}

/** The lower quartile keeps a frequent long interval from redefining the nominal frame cadence. */
function stableLowCadence(intervals: readonly number[]): number | null {
  if (intervals.length < 2) return null;
  const sorted = [...intervals].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * 0.25)] ?? null;
}

function missingFrameSamples(frames: readonly JankFrame[]): number {
  let missing = 0;
  for (let i = 1; i < frames.length; i++) {
    missing += Math.max(0, frames[i].frame - frames[i - 1].frame - 1);
  }
  return missing;
}

/** PerformanceObserver timestamps reset to a new document time origin after a navigation. Without a fresh synchronized baseline, records after the first navigation gap are deliberately withheld from the recorder-relative timeline. */
function observerRecords(events: readonly unknown[]): Array<{ item: UnknownRecord; timingAvailable: boolean }> {
  const records: Array<{ item: UnknownRecord; timingAvailable: boolean }> = [];
  let crossedNavigationGap = false;
  for (const value of events) {
    const item = record(value);
    if (!item) continue;
    if (item.kind === 'navigation-gap') {
      crossedNavigationGap = true;
      continue;
    }
    if (item.kind === 'performance') records.push({ item, timingAvailable: !crossedNavigationGap });
  }
  return records;
}

function artifactLoss(events: readonly unknown[]): ArtifactLossFact[] {
  const facts: ArtifactLossFact[] = [];
  for (const value of events) {
    const event = record(value);
    if (!event || typeof event.kind !== 'string') continue;
    const count = finite(event.count);
    const reason = typeof event.reason === 'string' ? event.reason : undefined;
    const message = typeof event.message === 'string' ? event.message : undefined;
    switch (event.kind) {
      case 'trace-dropped':
        facts.push({ kind: event.kind, count, reason, affectedCounts: ['long-task-records'] });
        break;
      case 'rect-sample-dropped':
        // This is a count of rejected/truncated element facts within retained
        // rect records, not a count of missing screencast frames or timestamps.
        facts.push({ kind: event.kind, count, reason, affectedCounts: [] });
        break;
      case 'binding-dropped':
      case 'navigation-gap':
        facts.push({ kind: event.kind, count, reason, message, affectedCounts: ['long-task-records', 'layout-shift-records'] });
        break;
      case 'error': {
        const lower = (message ?? '').toLowerCase();
        const affectedCounts: JankCount[] = lower.includes('rect sample')
          ? ['dropped-frames']
          : lower.includes('observer')
            ? ['long-task-records', 'layout-shift-records']
            : lower.includes('trace')
              ? ['long-task-records']
              : ['dropped-frames', 'long-task-records', 'layout-shift-records'];
        facts.push({ kind: event.kind, count, reason, message, affectedCounts });
        break;
      }
    }
  }
  return facts;
}

/** Pure artifact analysis, deliberately accepting the recorder's NDJSON records directly for fixture use. */
export function analyzeMotionJank(input: { rects: readonly unknown[]; events: readonly unknown[]; markers: Markers; state?: string }): MotionJankAnalysis {
  const frameRecords = input.rects
    .map(record)
    .filter((item): item is UnknownRecord => item !== null)
    .map((item) => ({ item, tMs: frameTime(item, input.markers) }))
    .filter((item): item is { item: UnknownRecord; tMs: number } => item.tMs !== null)
    .sort((a, b) => a.tMs - b.tMs);
  const frames: JankFrame[] = frameRecords.map(({ item, tMs }, index) => ({ frame: finite(item.frame) ?? index, tMs }));
  const intervals = frames.slice(1).map((frame, index) => frame.tMs - frames[index].tMs).filter((interval) => interval > 0);
  const cadenceMs = stableLowCadence(intervals);
  const missingFrameSampleCount = missingFrameSamples(frames);
  const droppedFrames: DroppedFrameFact[] = [];
  if (cadenceMs !== null && cadenceMs > 0) {
    for (let i = 1; i < frames.length; i++) {
      const intervalMs = frames[i].tMs - frames[i - 1].tMs;
      const estimatedDroppedFrames = Math.max(0, Math.round(intervalMs / cadenceMs) - 1);
      if (estimatedDroppedFrames > 0) droppedFrames.push({ afterFrame: frames[i].frame, beforeFrame: frames[i - 1].frame, startMs: frames[i - 1].tMs, endMs: frames[i].tMs, intervalMs, estimatedDroppedFrames });
    }
  }

  const traceEvents = flattenTraceEvents(input.events);
  const observedTraceBaselineUs = traceEvents.map((event) => finite(event.ts)).filter((ts): ts is number => ts !== undefined).sort((a, b) => a - b)[0];
  const observerEntries = observerRecords(input.events);
  const longTasks: LongTaskFact[] = [];
  for (const { item, timingAvailable } of observerEntries) {
    if (item.entryType !== 'longtask') continue;
    const durationMs = finite(item.duration);
    if (durationMs === undefined) continue;
    if (!timingAvailable) {
      longTasks.push({ source: 'observer', timingDomain: 'unavailable', startMs: null, durationMs, endMs: null, overlapsDroppedFrames: null });
      continue;
    }
    const startMs = observerToPerformanceMs(item, input.markers);
    if (startMs !== null) longTasks.push(longTask('observer', 'recorder-performance', startMs, durationMs, droppedFrames));
  }
  for (const trace of traceEvents) {
    const name = typeof trace.name === 'string' ? trace.name : '';
    const durationMs = finite(trace.dur);
    const timestampUs = finite(trace.ts);
    if (!/(longtask|run(task|microtasks)|task)/i.test(name) || durationMs === undefined || durationMs < 50_000 || timestampUs === undefined) continue;
    const timing = traceTime(timestampUs, input.markers, observedTraceBaselineUs);
    if (timing !== null) longTasks.push(longTask('trace', timing.domain, timing.tMs, durationMs / 1000, droppedFrames));
  }

  const frameElementRecords = frameRecords.map(({ item, tMs }) => ({ tMs, elements: (Array.isArray(item.elements) ? item.elements : []).map(record).filter((v): v is UnknownRecord => v !== null) }));
  const layoutShifts: LayoutShiftFact[] = [];
  for (const { item, timingAvailable } of observerEntries) {
    if (item.entryType !== 'layout-shift') continue;
    const value = finite(item.value);
    if (value === undefined) continue;
    if (!timingAvailable) {
      layoutShifts.push({
        tMs: null,
        value,
        hadRecentInput: typeof item.hadRecentInput === 'boolean' ? item.hadRecentInput : undefined,
        attribution: 'unavailable',
        rects: [],
      });
      continue;
    }
    const tMs = observerToPerformanceMs(item, input.markers);
    if (tMs === null) continue;
    const explicit = rectFactsFromObserverSources(item);
    const inferred = explicit.length ? undefined : inferredRectFacts(tMs, frameElementRecords);
    layoutShifts.push({
      tMs,
      value,
      hadRecentInput: typeof item.hadRecentInput === 'boolean' ? item.hadRecentInput : undefined,
      attribution: explicit.length ? 'observer-sources' : inferred?.rects.length ? 'frame-diff-inferred' : 'unavailable',
      beforeFrameMs: inferred?.beforeFrameMs,
      afterFrameMs: inferred?.afterFrameMs,
      rects: explicit.length ? explicit : inferred?.rects ?? [],
    });
  }

  const losses = artifactLoss(input.events);
  if (input.state === 'orphaned-finalized') {
    losses.push({
      kind: 'orphaned-finalized',
      message: 'recorder was finalized best-effort from artifacts already flushed to disk',
      affectedCounts: ['dropped-frames', 'long-task-records', 'layout-shift-records'],
    });
  }
  const incomplete = new Set<JankCount>(losses.flatMap((loss) => loss.affectedCounts));
  if (missingFrameSampleCount > 0 || cadenceMs === null) incomplete.add('dropped-frames');
  const traceAligned = longTasks.some((task) => task.source === 'trace' && task.timingDomain === 'recorder-performance');
  const traceRelative = longTasks.some((task) => task.source === 'trace' && task.timingDomain === 'trace-relative-first-event');
  const postNavigationObserverTimingUnavailable = longTasks.some((task) => task.source === 'observer' && task.timingDomain === 'unavailable') || layoutShifts.some((shift) => shift.tMs === null);
  const frameTimestampUncertainty: '±frame' | 'unavailable' = frames.length ? '±frame' : 'unavailable';
  const observerTiming = postNavigationObserverTimingUnavailable
    ? 'Observer entries after a navigation gap have no synchronized recorder-relative baseline; their timing, dropped-frame overlap, and frame-diff attribution are unavailable.'
    : 'Observer and screencast timestamps are recorder-relative performance.now() milliseconds.';
  const timingNote = traceRelative
    ? `${observerTiming} Frame-derived intervals have ±frame uncertainty. Trace timestamps are relative to the first trace event because no explicit trace/performance baseline marker was retained.`
    : traceAligned
      ? `${observerTiming} Explicitly-baselined trace and screencast timestamps are recorder-relative performance.now() milliseconds; frame-derived intervals have ±frame uncertainty.`
      : frames.length
        ? `${observerTiming} Frame-derived intervals have ±frame uncertainty.`
        : `${observerTiming} No frame timestamps were available; screencast-derived timing is unavailable.`;

  return {
    frameCount: frames.length,
    cadenceMs,
    missingFrameSampleCount,
    droppedFrames,
    droppedFrameCount: droppedFrames.reduce((count, item) => count + item.estimatedDroppedFrames, 0),
    droppedFramesIncomplete: incomplete.has('dropped-frames'),
    longTasks,
    longTasksIncomplete: incomplete.has('long-task-records'),
    layoutShifts,
    layoutShiftsIncomplete: incomplete.has('layout-shift-records'),
    artifactLoss: losses,
    frameTimestampUncertainty,
    timingNote,
  };
}

function longTask(source: 'observer' | 'trace', timingDomain: LongTaskTimingDomain, startMs: number, durationMs: number, droppedFrames: readonly DroppedFrameFact[]): LongTaskFact {
  const endMs = startMs + durationMs;
  return {
    source,
    timingDomain,
    startMs,
    durationMs,
    endMs,
    overlapsDroppedFrames: timingDomain === 'recorder-performance'
      ? droppedFrames.filter((drop) => startMs < drop.endMs && endMs > drop.startMs).map((drop) => drop.afterFrame)
      : null,
  };
}

export function readMotionJank(ref: RecRef): { analysis: MotionJankAnalysis; meta: Record<string, unknown> } {
  const meta = readMeta<Record<string, unknown>>(ref);
  const state = typeof meta.state === 'string' ? meta.state : undefined;
  if (state !== 'finalized' && state !== 'orphaned-finalized') {
    throw new Error(`recording ${JSON.stringify(ref.id)} is state ${JSON.stringify(state ?? 'unknown')}, not finalized; finalize it with: capture motion rec --stop`);
  }
  return { analysis: analyzeMotionJank({ rects: readRects(ref), events: readEvents(ref), markers: readMarkers<Markers>(ref), state }), meta };
}
