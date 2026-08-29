import { type ParsedArgs } from '../../types.js';
import { runStub } from '../stub.js';

const HELP = `capture perf vitals <trace> — Core Web Vitals measured from a recorded trace

input:
  <trace>   trace id in the active session or an absolute trace path (required; the trace must be finalized)
output: <vitals …> — LCP with its ttfb/load-delay/load-duration/render-delay subparts and element attribution, INP with its input-delay/main-thread-handling/presentation breakdown, and CLS with its session-window clusters and per-cluster culprits, one set per navigation in the trace; a metric with no occurrence in the recording reports not-observed, never 0, and a subpart the engine did not attribute is omitted rather than shown as 0; --json mirrors
effects: read-only — reads the finalized trace artifact, never drives the browser`;

export function cmdPerfVitals(parsed: ParsedArgs): void {
  runStub(parsed, HELP, 'perf vitals');
}
