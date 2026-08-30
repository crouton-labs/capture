import * as fs from 'node:fs';
import * as path from 'node:path';
import { type ParsedArgs } from '../../types.js';
import { analyzeChromeTrace, type TraceInsight, type TraceInsightField, type TraceInsightSet } from '../../trace-analysis.js';
import { resolveTraceRef } from '../../../output/artifact.js';
import { capped, data, emitResult, fact, line, lineList, text, type FactLine, type RenderableResult } from '../../../output/render.js';

const HELP = `capture perf insights <trace> [--name <insight> --full] — the DevTools insight set computed from a recorded trace

input:
  <trace>          trace id in the active session or an absolute trace path (required; the trace must be finalized)
  --name <insight> select one engine insight by name from the default aggregation
  --full            with --name, render that insight's full engine fields and related-event corpus
output: <insights …> — default output is a bounded aggregation of engine insight names, scalar metrics, and related-event counts; --name narrows that aggregation, and --name with --full exposes the selected insight's complete engine fields; capture reports engine facts without converting an insight's presence into an assessment of the page; --json mirrors
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

function fullRecordLine(insight: TraceInsight): FactLine {
  const serialized = JSON.stringify(insight.fields);
  return line(fact`${insight.name}: `, data(capped(serialized, serialized.length)));
}

function section(set: TraceInsightSet, insights: readonly TraceInsight[], full: boolean): FactLine {
  const records = insights.length ? insights.map(full ? fullRecordLine : aggregateLine) : [text`No engine records matched the requested insight name.`];
  return lineList([fact`Insight set ${set.id} for ${set.url}`, ...records]);
}

function noInsightSet(events: readonly object[]): { section: FactLine; json: Record<string, string | number> } {
  const navigations = events.filter((event) => (event as { name?: unknown }).name === 'navigationStart').length;
  return navigations === 0
    ? { section: text`No DevTools insight set was produced: this trace contains no navigation, and the engine produced no no-navigation insight set (including ForcedReflow), so this recording cannot yield DevTools insights.`, json: { status: 'no-insight-set', navigations, reason: 'no-navigation-engine-produced-no-no-navigation-insight-set-including-ForcedReflow' } }
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
    const selected = analysis.insightSets.map(set => ({ ...set, insights: parsed.name === undefined ? set.insights : set.insights.filter(insight => insight.name === parsed.name) }));
    const noSet = selected.length === 0 ? noInsightSet(raw.traceEvents) : undefined;
    const result: RenderableResult = {
      tag: 'insights',
      attestation: { kind: 'trace', id: trace.id, path: trace.dir },
      attrs: { completion: trace.completion, ...(trace.reason ? { reason: trace.reason } : {}), engine: analysis.source.engine, 'insight-sets': selected.length, insights: selected.reduce((count, set) => count + set.insights.length, 0), ...(parsed.name ? { name: parsed.name } : {}), ...(parsed.full ? { detail: 'full' } : { detail: 'aggregation' }) },
      summary: parsed.full
        ? fact`Full engine fields and related events are rendered only for the selected insight.`
        : fact`Insight names, scalar metrics, and related-event counts are computed by the DevTools trace engine (${analysis.source.engine}, an unstable upstream API pinned by capture). Use \`--name <insight> --full\` to render one insight's complete engine fields and related events.`,
      sections: selected.length ? selected.map(set => section(set, set.insights, parsed.full === true)) : [noSet!.section],
      jsonSections: selected.length ? selected.map(set => ({ set: set.id, url: set.url, insights: parsed.full ? set.insights : set.insights.map(aggregate) })) : [noSet!.json],
    };
    emitResult(result, { json: parsed.json });
  } catch (cause) { error(parsed, 'artifact_unavailable', cause instanceof Error ? cause.message : String(cause)); }
}
