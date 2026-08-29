import { type ParsedArgs } from '../../types.js';
import { runStub } from '../stub.js';

const HELP = `capture perf insights <trace> [--name <insight>] — the DevTools insight set computed from a recorded trace

input:
  <trace>          trace id in the active session or an absolute trace path (required; the trace must be finalized)
  --name <insight> render only this insight's records, by the engine's own insight name (see the names in the unfiltered output)
output: <insights …> — one record per insight the engine computed for each navigation, with the engine's own name and the attribution fields it attached (request URLs, node ids, durations); capture reports these records and does not convert an insight's presence into an assessment of the page; --json mirrors
effects: read-only — reads the finalized trace artifact, never drives the browser`;

export function cmdPerfInsights(parsed: ParsedArgs): void {
  runStub(parsed, HELP, 'perf insights');
}
