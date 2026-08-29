import { type ParsedArgs } from '../../types.js';
import { runStub } from '../stub.js';

const HELP = `capture heap retainers <snapshot> --node <object-id> [--paths <N>] — what is keeping one object alive

input:
  <snapshot>          heap snapshot id in the active session or an absolute snapshot path (required)
  --node <object-id>  required. Chrome snapshot object id from \`capture heap objects\`
  --paths <N>         return up to N paths; default 1
output: <retainers …> — each path from the object back to the snapshot root as an alternating node/edge chain, with each edge's kind and property name, and each node's self bytes under the same size qualification as \`census\`; --json mirrors
effects: read-only — reads the finalized snapshot artifact, never drives the browser`;

export function cmdHeapRetainers(parsed: ParsedArgs): void {
  runStub(parsed, HELP, 'heap retainers');
}
