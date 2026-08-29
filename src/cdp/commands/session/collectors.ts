import { type ParsedArgs } from '../../types.js';
import { runStub } from '../stub.js';

const HELP = `capture session collectors — what is collecting in the active session right now

input:
  (none)   reads the active session's collector host; pass --session <id> to read a named session
output: <collectors …> — one row per live collector with its kind, id, artifact directory, held claims, and start time, plus the host's process state; --json mirrors
effects: read-only — reads the session's collector-host handle and asks the host for its roster, never drives the browser`;

export function cmdSessionCollectors(parsed: ParsedArgs): void {
  runStub(parsed, HELP, 'session collectors');
}
