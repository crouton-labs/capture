/**
 * `capture page` branch router — every verb against the live session tab:
 * driving (click, type, scroll, navigate, exec) and looking (shot,
 * elements).
 *
 * Shifts the consumed leaf token out of `parsed.positional` before handing
 * off, so every leaf command still finds its own primary target (a target
 * selector, a URL, code, ...) at `positional[0]` exactly as every other
 * capture command does — leaf commands never need to know they're nested
 * under a branch.
 */
import { invalidInput } from '../../../errors.js';
import { type ParsedArgs } from '../../types.js';
import { cmdPageClick } from './click.js';
import { cmdPageType } from './type.js';
import { cmdPageScroll } from './scroll.js';
import { cmdPageNavigate } from './navigate.js';
import { cmdPageExec } from './exec.js';
import { cmdPageShot } from './shot.js';
import { cmdPageElements } from './elements.js';

/** Root-help representation of this branch, assembled by `src/capture.ts`. */
export const COMMAND_BLOCK = `<command name="page">
verbs against the live session tab — act (click, type, scroll, navigate, exec) and look (shot, elements)
use when driving or inspecting the page a session opened; all verbs auto-target the active session tab, --target/--url override
  click · type · scroll · navigate · exec · shot · elements — \`capture page -h\`
</command>`;

export const PAGE_USAGE = `capture page — verbs against the live session tab: driving, looking, targeting.

All verbs auto-target the active session tab; --target/--url override. The
driving verbs (click, type, scroll) resolve exactly one element via the
unified target grammar — bare CSS selector, ax:<name>, axid:<id>,
backend:<id> — and reject an ambiguous target with the candidate list.
During a live composed recording every verb routes through the recorder.

<subcommand name="click" args="<target> [--no-screenshot] [--settle <ms>]" whenToUse="dispatch a real click on one resolved element"/>
<subcommand name="type" args="<text> [--into <target>] [--no-screenshot] [--settle <ms>]" whenToUse="type text into the focused element or one resolved field"/>
<subcommand name="scroll" args="<target> --to <top|bottom|px> [--no-screenshot]" whenToUse="scroll one resolved container to a position"/>
<subcommand name="navigate" args="<url> [--settle <ms>]" whenToUse="navigate the tab and wait for load + settle"/>
<subcommand name="exec" args="<code> | --file <path>" whenToUse="run arbitrary JS in the tab (expressions, return, await)"/>
<subcommand name="shot" args="[--viewport <WxH>] [--full-page] [--out <path>]" whenToUse="look at the page right now without acting"/>
<subcommand name="elements" args="[--all] [--limit <n>]" whenToUse="list what can be acted on — role, name, backend:<id> per element"/>

capture page <leaf> -h    Per-leaf usage`;

export async function pageMain(parsed: ParsedArgs, args: string[]): Promise<void> {
  const leaf = parsed.positional[0];
  const rest: ParsedArgs = { ...parsed, positional: parsed.positional.slice(1) };

  switch (leaf) {
    case 'click':
      return cmdPageClick(rest, args);
    case 'type':
      return cmdPageType(rest, args);
    case 'scroll':
      return cmdPageScroll(rest, args);
    case 'navigate':
      return cmdPageNavigate(rest, args);
    case 'exec':
      return cmdPageExec(rest, args);
    case 'shot':
      return cmdPageShot(rest, args);
    case 'elements':
      return cmdPageElements(rest, args);
    case undefined:
      console.log(PAGE_USAGE);
      return;
    default:
      throw invalidInput(`Unknown page leaf: ${leaf}.`, 'unknown_command');
  }
}
