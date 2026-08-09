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
import { cmdTabLaunch } from './launch.js';
import { cmdTabQuit } from './quit.js';
import { cmdTabList } from './list.js';
import { cmdTabOpen } from './open.js';
import { cmdTabClose } from './close.js';
import { cmdTabReset } from './reset.js';
import { cmdTabNetwork } from './network.js';

/** Root-help representation of this branch, assembled by `src/capture.ts`. */
export const COMMAND_BLOCK = `<command name="tab">
browser and tab plumbing — starting/stopping a browser capture owns, endpoint/tab discovery, tab lifecycle, connection-level network emulation
use when nothing is running yet (\`tab launch\` starts a browser capture owns and reaps), when finding a CDP endpoint or tab, opening/closing/replacing a tab, or toggling connectivity; \`tab list\` is the probe for a running browser
  launch · quit · list · open · close · reset · network — \`capture tab -h\`
</command>`;

export const TAB_USAGE = `capture tab — browser and tab plumbing: browser lifecycle, discovery, tab lifecycle, network emulation.

\`tab list\` with no --port performs full endpoint discovery and is the probe
for whether a CDP-enabled browser is running at all; when nothing is running,
\`tab launch\` starts one capture owns — never hand-roll a detached browser,
since nothing reaps that. Capture signals only browsers it launched itself
(verified by process-birth identity): an endpoint you reach with --port stays
untouched. \`tab reset\` replaces a stuck tab with a fresh one; under an active
session it refuses while a recording is active (stop it first), reaps dead
recorder handles, and updates the session's {target, port} pair together.

<subcommand name="launch" args="[--url <url>] [--port <port>] [--headed]" whenToUse="start a browser capture owns (and reaps) when none is running"/>
<subcommand name="quit" args="[<port>] [--all]" whenToUse="stop a browser capture launched; never touches a browser capture did not start"/>
<subcommand name="list" args="[--port <port>]" whenToUse="discover CDP endpoints and the tabs open on them"/>
<subcommand name="open" args="<url> [--new] [--port <port>]" whenToUse="open a URL and get its tab id"/>
<subcommand name="close" args="<target> [--port <port>]" whenToUse="close one explicitly identified background tab"/>
<subcommand name="reset" args="<url> [--port <port>]" whenToUse="abandon a stuck tab and open a fresh one (refuses while a recording is active; reaps dead recorder handles; updates the active session's {target, port} together)"/>
<subcommand name="network" args="<offline|online>" whenToUse="toggle connection-level network emulation for a tab"/>

capture tab <leaf> -h    Per-leaf usage`;

export async function tabMain(parsed: ParsedArgs, args: string[]): Promise<void> {
  const leaf = parsed.positional[0];
  const rest: ParsedArgs = { ...parsed, positional: parsed.positional.slice(1) };

  switch (leaf) {
    case 'launch':
      return cmdTabLaunch(rest, args);
    case 'quit':
      return cmdTabQuit(rest, args);
    case 'list':
      return cmdTabList(rest, args);
    case 'open':
      return cmdTabOpen(rest, args);
    case 'close':
      return cmdTabClose(rest, args);
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
