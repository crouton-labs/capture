import {
  readEvents,
  readMarkers,
  readMeta,
  readRects,
  type RecRef,
} from '../../output/artifact.js';

export interface TimelineRect {
  readonly tag?: unknown;
  readonly id?: unknown;
  readonly classes?: unknown;
  readonly backendNodeId?: unknown;
  readonly identityUnresolved?: unknown;
  readonly x?: unknown;
  readonly y?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly scrollTop?: unknown;
  readonly scrollLeft?: unknown;
  readonly properties?: unknown;
  readonly computed?: unknown;
  readonly [key: string]: unknown;
}

export interface TimelineFrameRecord {
  readonly frame?: unknown;
  readonly screencastTimestamp?: unknown;
  readonly elements?: unknown;
}

interface MarkerRecord {
  readonly firstScreencastTimestampSec?: unknown;
  readonly performanceNowMs?: unknown;
}

export interface TimelinePoint {
  readonly frame: number;
  /** Milliseconds from the recording's first sampled frame, in its screencast clock. */
  readonly timeMs: number | null;
  readonly timestampUncertainty: '±frame';
  readonly elementId: number | null;
  readonly tag: string | null;
  readonly id: string | null;
  readonly classes: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scrollTop?: number;
  readonly scrollLeft?: number;
  readonly property?: { readonly name: string; readonly value: string | number | boolean | null };
}

export interface TimelineAnalysis {
  readonly points: readonly TimelinePoint[];
  readonly selectedBackendNodeId: number | null;
  readonly selectionMethod: 'backend-node-id' | 'sample-label';
  readonly frameCount: number;
  readonly eventsRead: number;
  readonly propertyAvailable: boolean;
  readonly timingDomain: 'screencast-relative' | 'frame-order-only';
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function classTokens(value: unknown): string[] {
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [];
}

/**
 * Recorder samples preserve tag/id/class labels and, where the identity
 * bridge resolves it, backendNodeId. They do not preserve a DOM tree, so a
 * full CSS selector cannot be evaluated after recording. This intentionally
 * supports the label grammar that can be measured from that artifact and
 * refuses unsupported combinators/attributes rather than pretending an
 * arbitrary selector was matched.
 */
export function matchesRecordedSelector(element: TimelineRect, selector: string): boolean {
  const trimmed = selector.trim();
  if (!trimmed || /[\s>+~\[\]:,*]/.test(trimmed)) return false;

  const match = /^(?<tag>[A-Za-z][A-Za-z0-9-]*)?(?<id>#[A-Za-z_][A-Za-z0-9_-]*)?(?<classes>(?:\.[A-Za-z_][A-Za-z0-9_-]*)*)$/.exec(trimmed);
  if (!match?.groups) return false;
  const tag = match.groups.tag;
  const requestedId = match.groups.id?.slice(1);
  const requestedClasses = [...(match.groups.classes?.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g) ?? [])].map((m) => m[1]);
  if (!tag && !requestedId && requestedClasses.length === 0) return false;

  if (tag && stringOrNull(element.tag)?.toLowerCase() !== tag.toLowerCase()) return false;
  if (requestedId && stringOrNull(element.id) !== requestedId) return false;
  const classes = new Set(classTokens(element.classes));
  return requestedClasses.every((name) => classes.has(name));
}

function elementLabel(element: TimelineRect): string {
  return [stringOrNull(element.tag) ?? '', stringOrNull(element.id) ?? '', stringOrNull(element.classes) ?? ''].join('\u0000');
}

function propertyValue(element: TimelineRect, property: string): string | number | boolean | null | undefined {
  const geometry: Record<string, unknown> = {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    left: element.x,
    top: element.y,
    right: finiteNumber(element.x) !== null && finiteNumber(element.width) !== null ? finiteNumber(element.x)! + finiteNumber(element.width)! : undefined,
    bottom: finiteNumber(element.y) !== null && finiteNumber(element.height) !== null ? finiteNumber(element.y)! + finiteNumber(element.height)! : undefined,
    scrollTop: element.scrollTop,
    scrollLeft: element.scrollLeft,
  };
  const direct = geometry[property];
  if (typeof direct === 'string' || typeof direct === 'number' || typeof direct === 'boolean' || direct === null) return direct;
  for (const container of [element.properties, element.computed]) {
    if (container && typeof container === 'object') {
      const value = (container as Record<string, unknown>)[property];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
    }
  }
  return undefined;
}

/** Reads the finalized recording's sampled bounding boxes and produces the
 * narrow, read-only timeline substrate used by the command leaf. */
export function analyzeMotionTimeline(ref: RecRef, selector: string, property?: string): TimelineAnalysis {
  const records = readRects<TimelineFrameRecord>(ref);
  // events.jsonl is a required finalized-recording artifact. Reading it here
  // makes a missing/corrupt event stream a structured resolver error instead
  // of silently treating a partial recording as complete.
  const events = readEvents<Record<string, unknown>>(ref);
  const markers = readMarkers<MarkerRecord>(ref);

  const frames = records
    .map((record, index) => ({
      frame: finiteNumber(record.frame) ?? index,
      timestamp: finiteNumber(record.screencastTimestamp),
      elements: Array.isArray(record.elements) ? record.elements.filter((e): e is TimelineRect => typeof e === 'object' && e !== null) : [],
    }))
    .sort((a, b) => a.frame - b.frame);

  let selected: TimelineRect | undefined;
  for (const frame of frames) {
    selected = frame.elements.find((element) => matchesRecordedSelector(element, selector));
    if (selected) break;
  }
  if (!selected) {
    throw new MotionTimelineSelectionError(selector, frames.length);
  }

  const selectedBackendNodeId = finiteNumber(selected.backendNodeId);
  const selectionMethod: TimelineAnalysis['selectionMethod'] = selectedBackendNodeId === null ? 'sample-label' : 'backend-node-id';
  const selectedLabel = elementLabel(selected);
  const baseline = finiteNumber(markers.firstScreencastTimestampSec)
    ?? frames.find((frame) => frame.timestamp !== null)?.timestamp
    ?? null;
  const timingDomain: TimelineAnalysis['timingDomain'] = baseline === null ? 'frame-order-only' : 'screencast-relative';
  let propertyAvailable = property === undefined;

  const points: TimelinePoint[] = [];
  for (const frame of frames) {
    const element = selectedBackendNodeId !== null
      ? frame.elements.find((candidate) => finiteNumber(candidate.backendNodeId) === selectedBackendNodeId)
      : frame.elements.find((candidate) => elementLabel(candidate) === selectedLabel);
    if (!element) continue;
    const x = finiteNumber(element.x);
    const y = finiteNumber(element.y);
    const width = finiteNumber(element.width);
    const height = finiteNumber(element.height);
    if (x === null || y === null || width === null || height === null) continue;

    const value = property === undefined ? undefined : propertyValue(element, property);
    if (property !== undefined && value !== undefined) propertyAvailable = true;
    points.push({
      frame: frame.frame,
      timeMs: baseline !== null && frame.timestamp !== null ? roundMilliseconds((frame.timestamp - baseline) * 1000) : null,
      timestampUncertainty: '±frame',
      elementId: finiteNumber(element.backendNodeId),
      tag: stringOrNull(element.tag),
      id: stringOrNull(element.id),
      classes: stringOrNull(element.classes),
      x,
      y,
      width,
      height,
      ...(finiteNumber(element.scrollTop) !== null ? { scrollTop: finiteNumber(element.scrollTop)! } : {}),
      ...(finiteNumber(element.scrollLeft) !== null ? { scrollLeft: finiteNumber(element.scrollLeft)! } : {}),
      ...(property !== undefined && value !== undefined ? { property: { name: property, value } } : {}),
    });
  }

  return { points, selectedBackendNodeId, selectionMethod, frameCount: frames.length, eventsRead: events.length, propertyAvailable, timingDomain };
}

export class MotionTimelineSelectionError extends Error {
  constructor(readonly selector: string, readonly frameCount: number) {
    super(`No sampled element matched ${JSON.stringify(selector)} across ${frameCount} frame(s). Recorder timeline matching supports a tag, #id, .class, or their simple combination because rects.jsonl does not retain a DOM tree.`);
    this.name = 'MotionTimelineSelectionError';
  }
}

export function readTimelineMeta(ref: RecRef): { state: string; durationMs: number | null } {
  const meta = readMeta<{ state?: unknown; durationMs?: unknown }>(ref);
  return { state: typeof meta.state === 'string' ? meta.state : 'unknown', durationMs: finiteNumber(meta.durationMs) };
}
