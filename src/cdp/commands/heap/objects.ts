import { type ParsedArgs } from '../../types.js';
import { runStub } from '../stub.js';

const HELP = `capture heap objects <snapshot> --constructor <name> [--limit <N>] [--sort retained|self] — the individual objects of one constructor

input:
  <snapshot>            heap snapshot id in the active session or an absolute snapshot path (required)
  --constructor <name>  required. Exact constructor name as reported by \`capture heap census\` — the id source for \`capture heap retainers\`
  --limit <N>           render the top N objects; default 25, --json always carries every object
  --sort <key>          retained (default) or self
output: <heap-objects …> — one row per object with its Chrome snapshot object id, node type, self bytes, and retained bytes, carrying the same retained-size qualification as \`census\`; --json mirrors
effects: read-only — reads the finalized snapshot artifact, never drives the browser`;

export function cmdHeapObjects(parsed: ParsedArgs): void {
  runStub(parsed, HELP, 'heap objects');
}
