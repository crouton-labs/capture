import { type ParsedArgs } from '../../types.js';
import { runStub } from '../stub.js';

const HELP = `capture perf trace [url] [--do <action>] [--duration <seconds>] | --start | --stop — record a Chrome performance trace

input:
  [url]                  navigate to this URL and trace the load until it settles; without a URL the active session tab is traced in place (mutually exclusive with --start/--stop)
  --do <action>          trace across one action on the current page (same action grammar as \`motion rec --do\`), for an interaction trace INP can be read from
  --duration <seconds>   stop tracing this long after the action; default 3
  --start                open a trace window and return; requires an active session, and the trace stays live across intervening commands until --stop
  --stop                 close the live trace window and finalize its artifact; the session's one live trace is selected without an id
output: <trace …> — the finalized trace artifact, its recorded window, event count, and completion state; --json mirrors
effects: drives the browser and records; spawns or joins the session's collector host, which holds the tab connection until the trace is stopped. Claims \`tracing\`, which is browser-global: refused while \`motion rec\` or another trace is live anywhere in the browser, and the refusal names the claim and the collector holding it.`;

export function cmdPerfTrace(parsed: ParsedArgs): void {
  runStub(parsed, HELP, 'perf trace');
}
