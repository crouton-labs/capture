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
import { tabMockMain } from './mock/index.js';

/** Root-help representation of this branch, assembled by `src/capture.ts`. */
export const COMMAND_BLOCK = `<command name="tab">
browser and tab plumbing — the existence of a browser capture owns, endpoint/tab discovery, tab lifecycle, and the conditions the tab's network runs under (connectivity, mocked responses)
use when nothing is running yet, when finding or changing a tab, or when changing what the tab's requests do; \`tab\` never reads traffic — \`session har\` does — and never measures anything
</command>`;

export const TAB_USAGE = `<command name="tab" description="browser and tab lifecycle">
<model>\`list\` with no --port performs full endpoint discovery and is the probe for whether a CDP-enabled browser is running; when nothing is running, \`launch\` starts one Capture owns — never hand-roll a detached browser, since nothing reaps that. Capture signals only browsers it launched itself (verified by process-birth identity): an endpoint you reach with --port stays untouched. \`reset\` replaces a stuck tab with a fresh one; under an active session it refuses while a recording is active, reaps dead recorder handles, and updates the session's {target, port} pair together.</model>
<subcommand name="launch" description="start a Capture-owned browser" whenToUse="Use when no CDP-enabled browser is running."/>
<subcommand name="quit" description="stop a Capture-owned browser" whenToUse="Use to stop a browser that Capture launched."/>
<subcommand name="list" description="CDP endpoints and open tabs" whenToUse="Use to find a browser endpoint or tab before targeting it."/>
<subcommand name="open" description="open a URL in a tab" whenToUse="Use to navigate the current tab or create a tab for a URL."/>
<subcommand name="close" description="close one tab" whenToUse="Use to close an explicitly identified background tab."/>
<subcommand name="reset" description="replace a tab" whenToUse="Use to discard a stuck tab and update the active session to a fresh one."/>
<subcommand name="network" description="tab network emulation" whenToUse="Use to change online connectivity for a tab held by an active session."/>
<subcommand name="mock" description="network response mocking" whenToUse="Use to intercept the tab's requests and answer them from an ordered rule document."/>
</command>`;

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
    case 'mock':
      return tabMockMain(rest, args);
    case undefined:
      console.log(TAB_USAGE);
      return;
    default:
      throw invalidInput(`Unknown tab leaf: ${leaf}.`, 'unknown_command');
  }
}
