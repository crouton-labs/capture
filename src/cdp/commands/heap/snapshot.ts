import { type ParsedArgs } from '../../types.js';
import { runStub } from '../stub.js';

const HELP = `capture heap snapshot [url] — take a V8 heap snapshot of the tab's JavaScript heap

input:
  [url]   navigate to this URL and snapshot it in a one-shot session; without a URL the active session tab is snapshotted in place
output: <heap-snapshot …> — the finalized snapshot artifact, its node and edge counts, on-disk bytes, and completion state; --json mirrors
effects: drives the browser and writes a large artifact; spawns or joins the session's collector host for the duration of one snapshot and releases it immediately. Claims \`heap-snapshot\`; refused while another heap snapshot is streaming, and the refusal names the claim and its holder. Composes with a live trace and with a live mock.`;

export function cmdHeapSnapshot(parsed: ParsedArgs): void {
  runStub(parsed, HELP, 'heap snapshot');
}
