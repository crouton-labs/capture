import * as fs from 'node:fs';
import * as path from 'node:path';
import { type ParsedArgs } from '../../types.js';
import { analyzeChromeTrace, type TraceInsight, type TraceInsightField, type TraceInsightSet } from '../../trace-analysis.js';
import { resolveTraceRef } from '../../../output/artifact.js';
import { data, emitResult, fact, line, lineList, text, type FactLine, type RenderableResult } from '../../../output/render.js';
import { selectRecords } from '../../../output/selection.js';

const HELP = `capture perf insights <trace> [--name <insight> --full] [--limit <N>] — the DevTools insight set computed from a recorded trace

input:
  <trace>          trace id in the active session or an absolute trace path (required; the trace must be finalized)
  --name <insight> select one engine insight by name from the default aggregation
  --limit <N>      return at most N selected insight records in prose and JSON; default 25
  --full            with --name, include up to 50 related events across the result as a bounded drill-down; each insight states how many events remain
output: <insights …> — default output is a bounded aggregation of engine insight names, scalar metrics, and related-event counts; --name adds top stack and duration-distribution facts for that insight, and --name with --full adds a bounded related-event drill-down; capture reports engine facts without converting an insight's presence into an assessment of the page; --json mirrors
effects: read-only — reads the finalized trace artifact, never drives the browser`;

function error(parsed: ParsedArgs, status: string, message: string): void {
  emitResult({ tag: 'error', attrs: { command: 'perf insights', status }, summary: fact`${message}` }, { json: parsed.json });
  process.exitCode = 1;
}

function relatedEventCount(fields: Readonly<Record<string, TraceInsightField>>): number {
  const related = fields.relatedEvents;
  if (Array.isArray(related)) return related.length;
  if (related !== null && typeof related === 'object' && !Array.isArray(related)) {
    const entries = related.entries;
    if (Array.isArray(entries)) return entries.length;
  }
  return 0;
}

function scalarMetrics(fields: Readonly<Record<string, TraceInsightField>>): Record<string, number | boolean> {
  return Object.fromEntries(Object.entries(fields).flatMap(([name, value]) => typeof value === 'number' || typeof value === 'boolean' ? [[name, value]] : []));
}

function aggregate(insight: TraceInsight): { name: string; relatedEventCount: number; scalarMetrics: Record<string, number | boolean> } {
  return { name: insight.name, relatedEventCount: relatedEventCount(insight.fields), scalarMetrics: scalarMetrics(insight.fields) };
}

function aggregateLine(insight: TraceInsight): FactLine {
  const summary = aggregate(insight);
  const metrics = Object.entries(summary.scalarMetrics).map(([name, value]) => `${name}=${value}`);
  return fact`${summary.name}: ${summary.relatedEventCount} related event(s); scalar metrics: ${metrics.length ? metrics.join(', ') : 'none'}.`;
}

const FULL_EVENT_LIMIT = 50;
const FULL_BYTE_LIMIT = 48_000;

type RelatedEvent = Record<string, unknown>;

interface FullFields {
  scalarMetrics: Record<string, number | boolean>;
  relatedEvents: { events: RelatedEvent[]; omitted: number };
}

interface FullBudget {
  remainingEvents: number;
  remainingBytes: number;
}

interface NamedFields {
  relatedEventCount: number;
  durationDistribution: string;
  topStack: { label: string; count: number } | null;
}

function relatedEvents(fields: Readonly<Record<string, TraceInsightField>>): RelatedEvent[] {
  const related = fields.relatedEvents;
  if (Array.isArray(related)) return related.filter((event): event is RelatedEvent => event !== null && typeof event === 'object' && !Array.isArray(event));
  if (related !== null && typeof related === 'object' && !Array.isArray(related) && Array.isArray(related.entries)) {
    return related.entries.filter((event): event is RelatedEvent => event !== null && typeof event === 'object' && !Array.isArray(event));
  }
  return [];
}

function durationDistribution(events: readonly RelatedEvent[]): string {
  const durations = events.map(event => event.dur).filter((duration): duration is number => typeof duration === 'number' && Number.isFinite(duration)).sort((a, b) => a - b);
  if (durations.length === 0) return 'unavailable (no related event carried a finite dur)';
  const at = (percentile: number) => durations[Math.min(durations.length - 1, Math.floor((durations.length - 1) * percentile))]! / 1000;
  return `n=${durations.length}, min=${at(0)}ms, p50=${at(0.5)}ms, p95=${at(0.95)}ms, max=${at(1)}ms`;
}

function stackLabel(event: RelatedEvent): string | null {
  const args = event.args && typeof event.args === 'object' ? event.args as { data?: unknown; beginData?: unknown } : undefined;
  const data = args?.data ?? args?.beginData;
  const stack = data && typeof data === 'object' ? (data as { stackTrace?: unknown; stack?: unknown }).stackTrace ?? (data as { stack?: unknown }).stack : undefined;
  const frame = Array.isArray(stack) ? stack[0] : stack && typeof stack === 'object' ? stack : undefined;
  if (!frame || typeof frame !== 'object') return null;
  const value = frame as { functionName?: unknown; url?: unknown; lineNumber?: unknown; columnNumber?: unknown };
  const name = typeof value.functionName === 'string' && value.functionName ? value.functionName : '(anonymous)';
  const location = typeof value.url === 'string' ? `${value.url}:${typeof value.lineNumber === 'number' ? value.lineNumber + 1 : '?'}` : null;
  return location ? `${name} at ${location}` : name;
}

function namedFields(insight: TraceInsight): NamedFields {
  const events = relatedEvents(insight.fields);
  const stacks = new Map<string, number>();
  for (const event of events) {
    const label = stackLabel(event);
    if (label) stacks.set(label, (stacks.get(label) ?? 0) + 1);
  }
  const topStack = [...stacks.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return {
    relatedEventCount: relatedEventCount(insight.fields),
    durationDistribution: durationDistribution(events),
    topStack: topStack ? { label: topStack[0], count: topStack[1] } : null,
  };
}

function namedRecordLine(insight: TraceInsight): FactLine {
  const details = namedFields(insight);
  return fact`${insight.name}: ${details.relatedEventCount} related event(s); duration distribution ${details.durationDistribution}; top stack ${details.topStack ? `${details.topStack.label} (${details.topStack.count} event(s))` : 'unavailable'}.`;
}

function fullFields(insight: TraceInsight, budget: FullBudget): FullFields {
  const events = relatedEvents(insight.fields);
  const retained: RelatedEvent[] = [];
  for (const event of events) {
    const bytes = Buffer.byteLength(JSON.stringify(event));
    if (budget.remainingEvents === 0 || bytes > budget.remainingBytes) break;
    retained.push(event);
    budget.remainingEvents--;
    budget.remainingBytes -= bytes;
  }
  return {
    scalarMetrics: scalarMetrics(insight.fields),
    relatedEvents: { events: retained, omitted: events.length - retained.length },
  };
}

function fullRecordLine(insight: TraceInsight, fields: FullFields): FactLine {
  return line(fact`${insight.name}: ${relatedEventCount(insight.fields)} related event(s), ${fields.relatedEvents.omitted} omitted from the shared ${FULL_EVENT_LIMIT}-event/${FULL_BYTE_LIMIT}-byte drill-down budget; fields: `, data(JSON.stringify(fields)));
}

function section(set: TraceInsightSet, insights: readonly TraceInsight[], full: boolean, named: boolean, fullByInsight: ReadonlyMap<TraceInsight, FullFields>): FactLine {
  const records = insights.length ? insights.map(insight => full ? fullRecordLine(insight, fullByInsight.get(insight)!) : named ? namedRecordLine(insight) : aggregateLine(insight)) : [text`No engine records matched the requested insight name.`];
  return lineList([fact`Insight set ${set.id} for ${set.url}`, ...records]);
}

function noInsightSet(events: readonly object[], completion: string): { section: FactLine; json: Record<string, string | number> } {
  const navigations = events.filter((event) => (event as { name?: unknown }).name === 'navigationStart').length;
  const recording = completion === 'complete'
    ? `The trace was recorded successfully and finalized (completion=${completion}).`
    : `The trace artifact was finalized with completion=${completion}.`;
  return navigations === 0
    ? { section: fact`${recording} This trace-engine analysis emitted 0 navigation-scoped insight set(s) because the trace contains no navigation. That engine scope does not describe the other performance evidence recorded in trace.json.`, json: { status: 'no-insight-set', navigations, 'trace-recording': `finalized:${completion}`, 'engine-analysis-scope': 'navigation-scoped-insight-sets', 'navigation-insight-sets': 0, reason: 'no-navigation' } }
    : { section: text`No DevTools insight set was produced for the ${navigations} recorded navigation(s), so this recording cannot yield DevTools insights.`, json: { status: 'no-insight-set', navigations, reason: 'engine-produced-no-insight-set' } };
}

export async function cmdPerfInsights(parsed: ParsedArgs): Promise<void> {
  if (parsed.help) { console.log(HELP); return; }
  const input = parsed.positional[0];
  if (!input) return error(parsed, 'invalid_target', 'perf insights requires one finalized trace id or absolute trace path.');
  try {
    const trace = resolveTraceRef(input);
    const raw = JSON.parse(fs.readFileSync(path.join(trace.dir, 'trace.json'), 'utf8')) as { traceEvents?: object[] };
    if (!Array.isArray(raw.traceEvents)) throw new Error('trace.json is not a Chrome trace with a traceEvents array');
    const analysis = await analyzeChromeTrace({ traceEvents: raw.traceEvents });
    let remaining = parsed.limit ?? 25;
    const selected = analysis.insightSets.map((set) => {
      const filtered = parsed.name === undefined ? set.insights : set.insights.filter(insight => insight.name === parsed.name);
      const insights = selectRecords(filtered, { limit: remaining }, remaining);
      remaining -= insights.length;
      return { ...set, insights };
    });
    const fullBudget: FullBudget = { remainingEvents: FULL_EVENT_LIMIT, remainingBytes: FULL_BYTE_LIMIT };
    const fullByInsight = new Map<TraceInsight, FullFields>();
    if (parsed.full) {
      for (const set of selected) {
        for (const insight of set.insights) fullByInsight.set(insight, fullFields(insight, fullBudget));
      }
    }
    const relatedEventsTotal = selected.reduce((total, set) => total + set.insights.reduce((count, insight) => count + relatedEvents(insight.fields).length, 0), 0);
    const relatedEventsRetained = [...fullByInsight.values()].reduce((total, fields) => total + fields.relatedEvents.events.length, 0);
    const noSet = selected.length === 0 ? noInsightSet(raw.traceEvents, trace.completion) : undefined;
    const result: RenderableResult = {
      tag: 'insights',
      attestation: { kind: 'trace', id: trace.id, path: trace.dir },
      attrs: { completion: trace.completion, ...(trace.reason ? { reason: trace.reason } : {}), engine: analysis.source.engine, 'insight-sets': selected.length, insights: selected.reduce((count, set) => count + set.insights.length, 0), limit: parsed.limit ?? 25, ...(parsed.name ? { name: parsed.name } : {}), ...(parsed.full ? { detail: 'full', 'events-retained': relatedEventsRetained, 'events-omitted': relatedEventsTotal - relatedEventsRetained, 'event-bytes-retained': FULL_BYTE_LIMIT - fullBudget.remainingBytes } : { detail: 'aggregation' }) },
      summary: parsed.full
        ? fact`The selected related-event drill-down is capped across this result at ${FULL_EVENT_LIMIT} events and ${FULL_BYTE_LIMIT} bytes; each insight states its omitted count.`
        : parsed.name
          ? fact`The selected insight reports its related-event count, duration distribution, and most frequent reported stack without emitting the event corpus.`
          : fact`Insight names, scalar metrics, and related-event counts are computed by the DevTools trace engine (${analysis.source.engine}, an unstable upstream API pinned by capture). Use \`--name <insight>\` for stack and duration facts, or add \`--full\` for a bounded related-event drill-down.`,
      sections: selected.length ? selected.map(set => section(set, set.insights, parsed.full === true, parsed.name !== undefined, fullByInsight)) : [noSet!.section],
      jsonSections: selected.length ? selected.map(set => ({ set: set.id, url: set.url, insights: parsed.full ? set.insights.map(insight => ({ name: insight.name, fields: fullByInsight.get(insight)! })) : parsed.name ? set.insights.map(insight => ({ ...aggregate(insight), ...namedFields(insight) })) : set.insights.map(aggregate) })) : [noSet!.json],
    };
    emitResult(result, { json: parsed.json });
  } catch (cause) { error(parsed, 'artifact_unavailable', cause instanceof Error ? cause.message : String(cause)); }
}
