/**
 * `capture tab` branch router — tab and connection plumbing: endpoint/tab
 * discovery, tab lifecycle, connection-level network emulation.
 *
 * Shifts the consumed leaf token out of `parsed.positional` before handing
 * off, so every leaf command still finds its own primary target (a URL, an
 * offline/online token, ...) at `positional[0]` exactly as every other
 * capture command does — leaf commands never need to know they're nested
 * under a branch.
 */
import { invalidInput } from '../../../errors.js';
import { type ParsedArgs } from '../../types.js';
import { cmdTabList } from './list.js';
import { cmdTabOpen } from './open.js';
import { cmdTabReset } from './reset.js';
import { cmdTabNetwork } from './network.js';

/** Root-help representation of this branch, assembled by `src/capture.ts`. */
export const COMMAND_BLOCK = `<command name="tab">
tab and connection plumbing — endpoint/tab discovery, open/reset tabs, connection-level network emulation
use when finding a CDP endpoint or tab, opening/replacing a tab, or toggling connectivity; \`tab list\` is the probe for a running browser
  list · open · reset · network — \`capture tab -h\`
</command>`;

export const TAB_USAGE = `capture tab — tab and connection plumbing: discovery, lifecycle, network emulation.

\`tab list\` with no --port performs full endpoint discovery and is the probe
for whether a CDP-enabled browser is running at all. \`tab reset\` replaces a
stuck tab with a fresh one and updates the active session's target.

<subcommand name="list" args="[--port <port>]" whenToUse="discover CDP endpoints and the tabs open on them"/>
<subcommand name="open" args="<url> [--new] [--port <port>]" whenToUse="open a URL and get its tab id"/>
<subcommand name="reset" args="<url> [--port <port>]" whenToUse="abandon a stuck tab and open a fresh one (updates the active session's target)"/>
<subcommand name="network" args="<offline|online>" whenToUse="toggle connection-level network emulation for a tab"/>

capture tab <leaf> -h    Per-leaf usage`;

export async function tabMain(parsed: ParsedArgs, args: string[]): Promise<void> {
  const leaf = parsed.positional[0];
  const rest: ParsedArgs = { ...parsed, positional: parsed.positional.slice(1) };

  switch (leaf) {
    case 'list':
      return cmdTabList(rest, args);
    case 'open':
      return cmdTabOpen(rest, args);
    case 'reset':
      return cmdTabReset(rest, args);
    case 'network':
      return cmdTabNetwork(rest, args);
    case undefined:
      console.log(TAB_USAGE);
      return;
    default:
      throw invalidInput(`Unknown tab leaf: ${leaf}.`, 'unknown_command');
  }
}
