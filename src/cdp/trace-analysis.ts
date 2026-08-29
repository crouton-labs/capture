import * as TraceEngine from '@paulirish/trace_engine';

export type RawChromeTrace = readonly object[] | { readonly traceEvents: readonly object[] };

export interface MetricProvenance {
  /** Trace-derived measurements are lab data, never field percentiles. */
  readonly origin: 'lab';
  readonly producer: 'Chrome performance trace analyzed by DevTools Trace Engine';
  readonly scope: 'recording-window';
  readonly limitations: readonly string[];
}

export interface ObservedMetric<Value, Attribution = never> {
  readonly status: 'observed';
  readonly value: Value;
  readonly provenance: MetricProvenance;
  readonly attribution?: Attribution;
}

export interface UnobservedMetric {
  readonly status: 'not-observed';
  readonly reason: 'not-present-in-recording';
  readonly provenance: MetricProvenance;
}

export interface LargestContentfulPaint {
  readonly durationMs: number;
  readonly subpartsMs: Readonly<Partial<Record<'ttfb' | 'loadDelay' | 'loadDuration' | 'renderDelay', number>>>;
}

export interface LargestContentfulPaintAttribution {
  /** The node description emitted by Chrome, such as `IMG id='hero'`; it is not a selector. */
  readonly element?: string;
  readonly nodeId?: number;
  readonly resourceUrl?: string;
}

export interface InteractionToNextPaint {
  readonly durationMs: number;
  readonly interactionType: string;
  readonly interactionId: number;
  readonly inputDelayMs: number;
  /** Time the trace engine attributed to main-thread handling for this interaction. */
  readonly mainThreadHandlingMs: number;
  readonly presentationDelayMs: number;
}

export interface InteractionAttribution {
  readonly targetNodeId?: number;
}

export type LayoutShiftCulpritKind = 'web-font' | 'iframe' | 'non-composited-animation' | 'unsized-image' | 'engine-reported';

export interface LayoutShiftCulprit {
  readonly kind: LayoutShiftCulpritKind;
  readonly url?: string;
  readonly nodeId?: number;
  /** Engine-provided culprit description. */
  readonly description?: string;
}

export interface LayoutShiftCluster {
  readonly value: number;
  readonly shiftCount: number;
  readonly culprits: readonly LayoutShiftCulprit[];
}

export interface CumulativeLayoutShift {
  readonly value: number;
  readonly clusters: readonly LayoutShiftCluster[];
}

export type TraceInsightField = string | number | boolean | null | readonly TraceInsightField[] | Readonly<Record<string, TraceInsightField>>;

export interface TraceInsight {
  /** The engine's insight key. */
  readonly name: string;
  /** Factual engine fields, made JSON-safe without adding capture judgments. */
  readonly fields: Readonly<Record<string, TraceInsightField>>;
}

export interface TraceInsightSet {
  /** DevTools' navigation or no-navigation insight-set identifier. */
  readonly id: string;
  readonly url: string;
  /** Engine-computed records. The adapter deliberately does not turn insight states into judgments. */
  readonly insights: readonly TraceInsight[];
  readonly metrics: {
    readonly lcp: ObservedMetric<LargestContentfulPaint, LargestContentfulPaintAttribution> | UnobservedMetric;
    readonly inp: ObservedMetric<InteractionToNextPaint, InteractionAttribution> | UnobservedMetric;
    readonly cls: ObservedMetric<CumulativeLayoutShift> | UnobservedMetric;
  };
}

export interface TraceAnalysis {
  readonly source: {
    readonly format: 'chrome-performance-trace';
    readonly engine: '@paulirish/trace_engine@0.0.65';
  };
  readonly insightSets: readonly TraceInsightSet[];
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function traceEvents(trace: RawChromeTrace): readonly object[] {
  if (!('traceEvents' in trace)) return trace;
  if (!Array.isArray(trace.traceEvents)) throw new Error('Chrome trace must be an event array or an object with a traceEvents array.');
  return trace.traceEvents;
}

function lcpProvenance(): MetricProvenance {
  return {
    origin: 'lab',
    producer: 'Chrome performance trace analyzed by DevTools Trace Engine',
    scope: 'recording-window',
    limitations: ['Records the largest contentful paint observed during this trace, not a real-user field percentile.'],
  };
}

function inpProvenance(): MetricProvenance {
  return {
    origin: 'lab',
    producer: 'Chrome performance trace analyzed by DevTools Trace Engine',
    scope: 'recording-window',
    limitations: ['Only interactions that occurred during this trace can be measured.', 'No recorded interaction is not a zero-millisecond interaction.', 'This is not a real-user field percentile.'],
  };
}

function clsProvenance(): MetricProvenance {
  return {
    origin: 'lab',
    producer: 'Chrome performance trace analyzed by DevTools Trace Engine',
    scope: 'recording-window',
    limitations: ['Only layout shifts observed during this trace contribute to this value.', 'This is not a real-user field percentile.'],
  };
}

function unobserved(provenance: MetricProvenance): UnobservedMetric {
  return { status: 'not-observed', reason: 'not-present-in-recording', provenance };
}

function lcpFrom(model: UnknownRecord): TraceInsightSet['metrics']['lcp'] {
  const insight = record(model.LCPBreakdown);
  const durationMs = finite(insight?.lcpMs);
  if (durationMs === undefined) return unobserved(lcpProvenance());

  const event = record(insight?.lcpEvent);
  const eventData = record(record(event?.args)?.data);
  const requestData = record(record(record(insight?.lcpRequest)?.args)?.data);
  const subparts = record(insight?.subparts);
  const subpartsMs: Partial<Record<'ttfb' | 'loadDelay' | 'loadDuration' | 'renderDelay', number>> = {};
  for (const name of ['ttfb', 'loadDelay', 'loadDuration', 'renderDelay'] as const) {
    const rangeUs = finite(record(subparts?.[name])?.range);
    if (rangeUs !== undefined) subpartsMs[name] = rangeUs / 1000;
  }
  const attribution: LargestContentfulPaintAttribution = {
    ...(string(eventData?.nodeName) === undefined ? {} : { element: string(eventData?.nodeName) }),
    ...(finite(eventData?.nodeId) === undefined ? {} : { nodeId: finite(eventData?.nodeId) }),
    ...(string(requestData?.url) === undefined ? {} : { resourceUrl: string(requestData?.url) }),
  };
  return {
    status: 'observed',
    value: { durationMs, subpartsMs },
    provenance: lcpProvenance(),
    ...(Object.keys(attribution).length === 0 ? {} : { attribution }),
  };
}

function inpFrom(model: UnknownRecord): TraceInsightSet['metrics']['inp'] {
  const interaction = record(record(model.INPBreakdown)?.highPercentileInteractionEvent);
  const durationUs = finite(interaction?.dur);
  const interactionId = finite(interaction?.interactionId);
  const interactionType = string(interaction?.type);
  if (durationUs === undefined || interactionId === undefined || interactionType === undefined) return unobserved(inpProvenance());
  const sourceData = record(record(record(interaction.rawSourceEvent)?.args)?.data);
  const targetNodeId = finite(sourceData?.nodeId);
  return {
    status: 'observed',
    value: {
      durationMs: durationUs / 1000,
      interactionType,
      interactionId,
      inputDelayMs: (finite(interaction.inputDelay) ?? 0) / 1000,
      mainThreadHandlingMs: (finite(interaction.mainThreadHandling) ?? 0) / 1000,
      presentationDelayMs: (finite(interaction.presentationDelay) ?? 0) / 1000,
    },
    provenance: inpProvenance(),
    ...(targetNodeId === undefined ? {} : { attribution: { targetNodeId } }),
  };
}

function culpritFrom(value: unknown): LayoutShiftCulprit {
  const culprit = record(value);
  const type = finite(culprit?.type);
  const kind: LayoutShiftCulpritKind = type === 0 ? 'web-font'
    : type === 1 ? 'iframe'
      : type === 2 ? 'non-composited-animation'
        : type === 3 ? 'unsized-image'
          : 'engine-reported';
  const url = string(culprit?.url);
  const nodeId = finite(culprit?.backendNodeId);
  const description = string(record(culprit?.description)?.formattedDefault);
  return { kind, ...(url === undefined ? {} : { url }), ...(nodeId === undefined ? {} : { nodeId }), ...(description === undefined ? {} : { description }) };
}

function clsFrom(model: UnknownRecord): TraceInsightSet['metrics']['cls'] {
  const insight = record(model.CLSCulprits);
  const clusters = Array.isArray(insight?.clusters) ? insight.clusters : [];
  if (clusters.length === 0) return unobserved(clsProvenance());
  const culpritsByCluster = insight?.topCulpritsByCluster instanceof Map ? insight.topCulpritsByCluster : new Map();
  const values: LayoutShiftCluster[] = clusters.map((cluster) => {
    const item = record(cluster);
    const rawCulprits = culpritsByCluster.get(cluster);
    return {
      value: finite(item?.clusterCumulativeScore) ?? 0,
      shiftCount: Array.isArray(item?.events) ? item.events.length : 0,
      culprits: Array.isArray(rawCulprits) ? rawCulprits.map(culpritFrom) : [],
    };
  });
  return {
    status: 'observed',
    value: { value: Math.max(...values.map((cluster) => cluster.value)), clusters: values },
    provenance: clsProvenance(),
  };
}

const PRESENTATION_FIELDS = new Set([
  'insightKey', 'strings', 'title', 'description', 'docs', 'category', 'state', 'fail', 'warnings', 'createOverlays', 'label', 'preconnectCandidates', 'checklist',
]);

function presentationField(name: string): boolean {
  return PRESENTATION_FIELDS.has(name) || /saving|wasted|score/i.test(name);
}

function reportableField(value: unknown, ancestors = new Set<object>()): TraceInsightField | undefined {
  const text = string(value);
  if (text !== undefined) return text;
  const number = finite(value);
  if (number !== undefined) return number;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.flatMap((item) => {
    const field = reportableField(item, ancestors);
    return field === undefined ? [] : [field];
  });
  if (value instanceof Map) {
    if (ancestors.has(value)) return undefined;
    ancestors.add(value);
    const entries = [...value].flatMap(([key, item]) => {
      const reportableKey = reportableField(key, ancestors);
      const reportableValue = reportableField(item, ancestors);
      return reportableKey === undefined || reportableValue === undefined ? [] : [{ key: reportableKey, value: reportableValue }];
    });
    ancestors.delete(value);
    return { entries };
  }
  if (value instanceof Set) {
    if (ancestors.has(value)) return undefined;
    ancestors.add(value);
    const values = [...value].flatMap((item) => {
      const field = reportableField(item, ancestors);
      return field === undefined ? [] : [field];
    });
    ancestors.delete(value);
    return { values };
  }
  const fields = record(value);
  if (fields === null || ancestors.has(fields)) return undefined;
  ancestors.add(fields);
  const result: Record<string, TraceInsightField> = {};
  for (const [key, item] of Object.entries(fields)) {
    if (presentationField(key)) continue;
    const field = reportableField(item, ancestors);
    if (field !== undefined) result[key] = field;
  }
  ancestors.delete(fields);
  return result;
}

function insightsFrom(model: UnknownRecord): readonly TraceInsight[] {
  return Object.values(model).flatMap((value) => {
    const fields = record(value);
    const name = string(fields?.insightKey);
    if (name === undefined) return [];
    const details = reportableField(fields);
    return details === undefined || Array.isArray(details) ? [] : [{ name, fields: details }];
  });
}

/** Parses an in-memory Chrome performance trace without reading files, controlling Chrome, or assigning quality verdicts. */
export async function analyzeChromeTrace(trace: RawChromeTrace): Promise<TraceAnalysis> {
  const processor = TraceEngine.Processor.TraceProcessor.createWithAllHandlers();
  await processor.parse(traceEvents(trace) as readonly TraceEngine.Types.Events.Event[], { isFreshRecording: true });
  const insightSets = processor.insights;
  if (!insightSets) throw new Error('DevTools Trace Engine produced no insight sets for this trace.');

  return {
    source: { format: 'chrome-performance-trace', engine: '@paulirish/trace_engine@0.0.65' },
    insightSets: [...insightSets.values()].map((set) => {
      const model = set.model as unknown as UnknownRecord;
      return {
        id: String(set.id),
        url: set.url.toString(),
        insights: insightsFrom(model),
        metrics: { lcp: lcpFrom(model), inp: inpFrom(model), cls: clsFrom(model) },
      };
    }),
  };
}
