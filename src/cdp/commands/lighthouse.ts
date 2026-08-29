import { type ParsedArgs } from '../types.js';
import { runStub } from './stub.js';

export const COMMAND_BLOCK = `<command name="lighthouse">
a third-party scored report — capture runs Lighthouse against a URL and stores its report unmodified
use when the caller wants Lighthouse's own categories, scores, and audits; capture scores nothing itself, so every number capture measures lives in \`measure\`, \`motion\`, \`perf\`, or \`heap\`
</command>`;

const HELP = `capture lighthouse <url> [--categories <list>] [--preset mobile|desktop] [--limit <N>] [--out <path>] — run Lighthouse against a URL and store its report

input:
  <url>                 required. The URL Lighthouse navigates to. Lighthouse drives the browser destructively — it clears state and reloads — so it will not run against a tab another collector is recording
  --categories <list>   comma-separated Lighthouse categories; default performance. Any category Lighthouse ships (performance, accessibility, best-practices, seo)
  --preset <preset>     mobile (default, Lighthouse's mobile emulation and simulated throttling) or desktop
  --limit <N>           render at most N failing nodes per audit; default 25, --json always carries every node
  --out <path>          also write Lighthouse's HTML report to this path
output: <lighthouse …> — Lighthouse's own category scores, its audit pass/fail counts, one row per failing audit, and for each failing node that audit's DOM path with its selector, snippet, and Lighthouse's own explanation; plus the absolute path to the unmodified JSON report; capture adds no assessment of its own; --json mirrors
effects: drives the browser destructively — Lighthouse clears storage and cache and performs its own navigations on the target tab, and runs its own trace. Refused while anything holds the browser-global \`tracing\` claim, and refused while any collector is live on the target tab; both refusals name the holder.`;

export function cmdLighthouse(parsed: ParsedArgs, _args: string[]): void {
  runStub(parsed, HELP, 'lighthouse');
}
