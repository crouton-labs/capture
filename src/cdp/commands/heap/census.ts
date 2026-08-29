import { type ParsedArgs } from '../../types.js';
import { runStub } from '../stub.js';

const HELP = `capture heap census <snapshot> [--axis constructor|string] [--limit <N>] — what the heap is made of

input:
  <snapshot>       heap snapshot id in the active session or an absolute snapshot path (required)
  --axis <axis>    constructor (default) groups every node by constructor name with node count and retained bytes; string groups equal-content strings with their instance count and estimated duplicate bytes
  --limit <N>      render the top N groups by retained bytes; default 25, --json always carries every group
output: <heap-census …> — one row per group with its counts and sizes, plus the size qualification for the chosen axis; --json mirrors
effects: read-only — reads the finalized snapshot artifact, never drives the browser`;

export function cmdHeapCensus(parsed: ParsedArgs): void {
  runStub(parsed, HELP, 'heap census');
}
