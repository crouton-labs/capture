import * as fs from 'node:fs';
import * as path from 'node:path';
import { type ParsedArgs } from '../../types.js';
import { analyzeChromeTrace, type TraceInsight, type TraceInsightSet } from '../../trace-analysis.js';
import { resolveTraceRef } from '../../../output/artifact.js';
import { capped, emitResult, fact, lineList, text, type FactLine, type RenderableResult } from '../../../output/render.js';

const HELP = `capture perf insights <trace> [--name <insight>] — the DevTools insight set computed from a recorded trace

input:
  <trace>          trace id in the active session or an absolute trace path (required; the trace must be finalized)
  --name <insight> render only this insight's records, by the engine's own insight name (see the names in the unfiltered output)
output: <insights …> — one record per insight the engine computed for each navigation, with the engine's own name and the attribution fields it attached (request URLs, node ids, durations); capture reports these records and does not convert an insight's presence into an assessment of the page; --json mirrors
effects: read-only — reads the finalized trace artifact, never drives the browser`;

function error(parsed: ParsedArgs, status: string, message: string): void {
  emitResult({ tag: 'error', attrs: { command: 'perf insights', status }, summary: fact`${message}` }, { json: parsed.json });
  process.exitCode = 1;
}

function recordLine(insight: TraceInsight): FactLine {
  return fact`${insight.name}: ${capped(JSON.stringify(insight.fields), 12_000)}`;
}

function section(set: TraceInsightSet, insights: readonly TraceInsight[]): FactLine {
  return lineList([fact`Insight set ${set.id} for ${set.url}`, ...(insights.length ? insights.map(recordLine) : [text`No engine records matched the requested insight name.`])]);
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
    const result: RenderableResult = {
      tag: 'insights',
      attestation: { kind: 'trace', id: trace.id, path: trace.dir },
      attrs: { completion: trace.completion, ...(trace.reason ? { reason: trace.reason } : {}), engine: analysis.source.engine, 'insight-sets': selected.length, insights: selected.reduce((count, set) => count + set.insights.length, 0), ...(parsed.name ? { name: parsed.name } : {}) },
      summary: fact`Insight names and their fields are computed by the DevTools trace engine (${analysis.source.engine}, an unstable upstream API pinned by capture). Field shapes are the engine's and are reported unnormalized.`,
      sections: selected.length ? selected.map(set => section(set, set.insights)) : [text`No DevTools insight set was produced for this trace.`],
      jsonSections: selected.map(set => ({ set: set.id, url: set.url, insights: set.insights })),
    };
    emitResult(result, { json: parsed.json });
  } catch (cause) { error(parsed, 'artifact_unavailable', cause instanceof Error ? cause.message : String(cause)); }
}
