/**
 * `capture motion` branch router.
 *
 * Shifts the consumed leaf token out of `parsed.positional` before handing
 * off, so every leaf command still finds its own primary target (a URL, a
 * recording id, ...) at `positional[0]` exactly as every other capture
 * command does.
 */
import { invalidInput } from '../../../errors.js';
import { type ParsedArgs } from '../../types.js';
import { cmdMotionRec } from './rec.js';
import { cmdMotionMask } from './mask.js';
import { cmdMotionTimeline } from './timeline.js';
import { cmdMotionJank } from './jank.js';
import { cmdMotionResponse } from './response.js';

/** Root-help representation of this branch, assembled by `src/capture.ts`. */
export const COMMAND_BLOCK = `<command name="motion">
facts over a recording — recording lifecycle and read-only queries over finalized interactions
use when recording an interaction and reading change, timing, or input-response facts; use measure for static snapshot facts
</command>`;

export const MOTION_USAGE = `capture motion — recording lifecycle and read-only queries over a finalized recording.

\`rec\` drives and records the browser, one-shot or composed across intervening commands; every other leaf below reads the finalized recording artifact. Findings exit 0 — a report, not a failure; input and precondition errors exit 1. No leaf accepts --gate.

<subcommand name="rec" description="interaction recording" whenToUse="Use to record an interaction in one command or across a held session."/>
<subcommand name="mask" description="motion-difference image and regions" whenToUse="Use to inspect where a recording changed across frames."/>
<subcommand name="timeline" description="element timeline" whenToUse="Use to inspect one element's geometry, scroll, or property values over time."/>
<subcommand name="jank" description="long-task and layout-shift facts" whenToUse="Use to inspect rendering interruption and layout instability in a recording."/>
<subcommand name="response" description="input-to-settled timeline" whenToUse="Use to measure the response from one recorded input to settled rendering."/>

capture motion <leaf> -h    Full input, output, and effects contract.`;

export async function motionMain(parsed: ParsedArgs, args: string[]): Promise<void> {
  const leaf = parsed.positional[0];
  const rest: ParsedArgs = { ...parsed, positional: parsed.positional.slice(1) };

  switch (leaf) {
    case 'rec':
      return cmdMotionRec(rest, args);
    case 'mask':
      return cmdMotionMask(rest, args);
    case 'timeline':
      return cmdMotionTimeline(rest, args);
    case 'jank':
      return cmdMotionJank(rest, args);
    case 'response':
      return cmdMotionResponse(rest, args);
    case undefined:
      console.log(MOTION_USAGE);
      return;
    default:
      throw invalidInput(`Unknown motion leaf: ${leaf}.`, 'unknown_command');
  }
}
