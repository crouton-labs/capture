import * as fs from 'node:fs';
import * as path from 'node:path';
import { type ParsedArgs } from '../../types.js';
import { analyzeChromeTrace, type MetricProvenance, type TraceInsightSet } from '../../trace-analysis.js';
import { resolveTraceRef } from '../../../output/artifact.js';
import { emitResult, fact, lineList, text, type FactLine, type RenderableResult } from '../../../output/render.js';

const HELP = `capture perf vitals <trace> — Core Web Vitals measured from a recorded trace

input:
  <trace>   trace id in the active session or an absolute trace path (required; the trace must be finalized)
output: <vitals …> — LCP with its ttfb/load-delay/load-duration/render-delay subparts and element attribution, INP with its input-delay/main-thread-handling/presentation breakdown, and CLS with its session-window clusters and per-cluster culprits, one set per navigation in the trace; a metric with no occurrence in the recording reports not-observed, never 0, and a subpart the engine did not attribute is omitted rather than shown as 0; --json mirrors
effects: read-only — reads the finalized trace artifact, never drives the browser`;

function error(parsed: ParsedArgs, status: string, message: string): void {
  emitResult({ tag: 'error', attrs: { command: 'perf vitals', status }, summary: fact`${message}` }, { json: parsed.json });
  process.exitCode = 1;
}

function provenanceLines(provenance: MetricProvenance): FactLine[] {
  return provenance.limitations.map(limit => fact`${limit}`);
}

function lcpLine(set: TraceInsightSet): FactLine[] {
  const value = set.metrics.lcp;
  const scope = fact`LCP is the largest contentful paint observed in this recording window, not a real-user field percentile.`;
  if (value.status === 'not-observed') return [fact`LCP: not-observed (${value.reason}).`, scope, ...provenanceLines(value.provenance)];
  const parts = Object.entries(value.value.subpartsMs).map(([name, duration]) => `${name}=${duration}ms`).join(', ');
  const attribution = value.attribution ? `; attribution ${[value.attribution.element, value.attribution.nodeId === undefined ? undefined : `node ${value.attribution.nodeId}`, value.attribution.resourceUrl].filter(Boolean).join(', ')}` : '';
  return [fact`LCP: ${value.value.durationMs}ms${parts ? `; subparts ${parts}` : ''}${attribution}.`, scope, ...provenanceLines(value.provenance)];
}

function inpLine(set: TraceInsightSet): FactLine[] {
  const value = set.metrics.inp;
  const scope = fact`INP is the single longest interaction in this window, not a distribution across interactions.`;
  if (value.status === 'not-observed') return [fact`INP: not-observed (${value.reason}).`, scope, ...provenanceLines(value.provenance)];
  const attribution = value.attribution?.targetNodeId === undefined ? '' : `; target node ${value.attribution.targetNodeId}`;
  return [fact`INP: ${value.value.durationMs}ms; input-delay=${value.value.inputDelayMs}ms, main-thread-handling=${value.value.mainThreadHandlingMs}ms, presentation=${value.value.presentationDelayMs}ms; interaction ${value.value.interactionType} id ${value.value.interactionId}${attribution}.`, scope, ...provenanceLines(value.provenance)];
}

function clsLine(set: TraceInsightSet): FactLine[] {
  const value = set.metrics.cls;
  const scope = fact`CLS is the largest session-window cluster inside this window; a shorter recording measures less shift than a longer one.`;
  if (value.status === 'not-observed') return [fact`CLS: not-observed (${value.reason}).`, scope, ...provenanceLines(value.provenance)];
  const clusters = value.value.clusters.map((cluster, index) => `cluster ${index + 1}: value=${cluster.value}, shifts=${cluster.shiftCount}${cluster.culprits.length ? `, culprits=${JSON.stringify(cluster.culprits)}` : ''}`);
  return [fact`CLS: ${value.value.value}; ${clusters.join('; ')}.`, scope, ...provenanceLines(value.provenance)];
}

function section(set: TraceInsightSet): FactLine {
  return lineList([fact`Insight set ${set.id} for ${set.url}`, ...lcpLine(set), ...inpLine(set), ...clsLine(set)]);
}

function jsonSet(set: TraceInsightSet): Record<string, unknown> {
  return { set: set.id, url: set.url, lcp: set.metrics.lcp, inp: set.metrics.inp, cls: set.metrics.cls };
}

export async function cmdPerfVitals(parsed: ParsedArgs): Promise<void> {
  if (parsed.help) { console.log(HELP); return; }
  const input = parsed.positional[0];
  if (!input) return error(parsed, 'invalid_target', 'perf vitals requires one finalized trace id or absolute trace path.');
  try {
    const trace = resolveTraceRef(input);
    const raw = JSON.parse(fs.readFileSync(path.join(trace.dir, 'trace.json'), 'utf8')) as { traceEvents?: object[] };
    if (!Array.isArray(raw.traceEvents)) throw new Error('trace.json is not a Chrome trace with a traceEvents array');
    const analysis = await analyzeChromeTrace({ traceEvents: raw.traceEvents });
    const result: RenderableResult = {
      tag: 'vitals',
      attestation: { kind: 'trace', id: trace.id, path: trace.dir },
      attrs: { completion: trace.completion, ...(trace.reason ? { reason: trace.reason } : {}), 'insight-sets': analysis.insightSets.length, engine: analysis.source.engine, origin: 'lab' },
      summary: fact`Core Web Vitals are trace-derived lab measurements.`,
      sections: analysis.insightSets.length ? analysis.insightSets.map(section) : [text`No DevTools insight set was produced for this trace.`],
      jsonSections: analysis.insightSets.map(jsonSet),
    };
    emitResult(result, { json: parsed.json });
  } catch (cause) { error(parsed, 'artifact_unavailable', cause instanceof Error ? cause.message : String(cause)); }
}
