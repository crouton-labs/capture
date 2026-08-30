import { invalidInput } from '../../../errors.js';
import { type ParsedArgs } from '../../types.js';
import { cmdPerfTrace } from './trace.js';
import { cmdPerfVitals } from './vitals.js';
import { cmdPerfInsights } from './insights.js';

export const COMMAND_BLOCK = `<command name="perf">
the Chrome performance-trace substrate — \`trace\` records one, \`vitals\` and \`insights\` are read-only queries over it
use for Core Web Vitals and DevTools insights over a page load or one interaction, timed from trace events
</command>`;

const HELP = `<command name="perf" description="the Chrome performance-trace substrate">
<model>\`trace\` drives (and records) the browser, one-shot or composed across intervening commands; the other leaves are cheap reads over the finalized trace artifact. Findings exit 0 — a report, not a failure; input/precondition errors exit 1. No leaf accepts --gate.</model>
<subcommand name="trace" description="record a Chrome performance trace" whenToUse="Use to record the substrate that vitals and insights read — a page load, one interaction, or a window you open and close."/>
<subcommand name="vitals" description="Core Web Vitals from a recorded trace" whenToUse="Use for LCP, INP, and CLS with their subparts and attribution."/>
<subcommand name="insights" description="the DevTools insight set from a recorded trace" whenToUse="Use for the engine's computed insights — render-blocking requests, forced reflow, layout-shift culprits, and the rest of the set."/>
</command>`;

export async function perfMain(parsed: ParsedArgs, _args: string[]): Promise<void> {
  const leaf = parsed.positional[0];
  const rest: ParsedArgs = { ...parsed, positional: parsed.positional.slice(1) };
  switch (leaf) {
    case 'trace': return cmdPerfTrace(rest);
    case 'vitals': return cmdPerfVitals(rest);
    case 'insights': return cmdPerfInsights(rest);
    case undefined:
      console.log(HELP);
      return;
    default:
      throw invalidInput(`Unknown perf leaf: ${leaf}.`, 'unknown_command');
  }
}
