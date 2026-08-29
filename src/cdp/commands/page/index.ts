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
operations against the live session tab — interact with it or inspect its current state
use when driving or inspecting the tab a session opened or adopted; use tab for browser and tab lifecycle
</command>`;

export const PAGE_USAGE = `capture page — operations against the live session tab.

All verbs auto-target the active session tab; --target/--url override. Driving verbs resolve exactly one element via the unified target grammar — bare CSS selector (which takes precedence) or exact accessible name when CSS finds none, ax:<name>, axid:<id>, backend:<id> — and reject an ambiguous target with the candidate list. During a live composed recording every verb routes through the recorder.

<subcommand name="click" description="real click on one element" whenToUse="Use to activate a control through the page's normal click handling."/>
<subcommand name="type" description="text entry into an element" whenToUse="Use to enter text into the focused element or a resolved field."/>
<subcommand name="scroll" description="scroll one container" whenToUse="Use to move a resolved scrollable container to a position."/>
<subcommand name="navigate" description="navigate the tab" whenToUse="Use to load a URL in the current tab and wait for it to settle."/>
<subcommand name="exec" description="arbitrary JavaScript in the tab" whenToUse="Use when no named page command exposes the needed page operation."/>
<subcommand name="shot" description="current-page screenshot" whenToUse="Use to inspect the rendered page without interacting with it."/>
<subcommand name="elements" description="actionable page elements" whenToUse="Use to discover targets for page interactions."/>

capture page <leaf> -h    Full input, output, and effects contract.`;

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
