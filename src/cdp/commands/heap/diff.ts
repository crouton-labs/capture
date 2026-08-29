import { type ParsedArgs } from '../../types.js';
import { runStub } from '../stub.js';

const HELP = `capture heap diff --before <snapshot> --after <snapshot> [--limit <N>] — what changed between two heap snapshots

input:
  --before <snapshot>   required. Heap snapshot id in the active session or an absolute snapshot path
  --after <snapshot>    required. Heap snapshot id in the active session or an absolute snapshot path
  --limit <N>           render the top N constructors by added retained bytes; default 25, --json always carries every constructor
output: <heap-diff …> — per constructor, the nodes added, removed, and grown between the two snapshots, with retained-byte totals for each; --json mirrors
effects: read-only — reads both finalized snapshot artifacts, never drives the browser`;

export function cmdHeapDiff(parsed: ParsedArgs): void {
  runStub(parsed, HELP, 'heap diff');
}
