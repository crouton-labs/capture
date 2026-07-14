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
facts over a recording — recorder lifecycle plus read-only queries over a finalized recording
use when recording an interaction (one-shot or composed) and reading motion facts: diffs, timelines, jank, input response
  rec · mask · timeline · jank · response — \`capture motion -h\`
</command>`;

export const MOTION_USAGE = `capture motion — recorder lifecycle + read-only queries over a finalized recording.

\`rec\` drives (and records) the browser, one-shot or composed across
intervening commands; every other leaf below is a cheap read over the
finalized recording artifact. Every leaf defaults to rendered prose; --json
mirrors the same result. Findings exit 0 — a report, not a failure;
input/precondition errors exit 1. No leaf accepts --gate.

<subcommand name="rec" args="[url] --do <action> [--duration <seconds>] | --start | --stop" whenToUse="record an interaction — one-shot action, or composed across commands with --start/--stop (needs an active session)"/>
<subcommand name="mask" args="<rec> [--limit <N>]" whenToUse="motion-diff composite image + per-region facts"/>
<subcommand name="timeline" args="<rec> --element <sel> [--prop <prop>]" whenToUse="per-frame geometry/scroll/property timeline for one element"/>
<subcommand name="jank" args="<rec>" whenToUse="dropped-frame/long-task/layout-shift facts"/>
<subcommand name="response" args="<rec> [--action <action>] [--occurrence <n>]" whenToUse="input-to-settled response timeline"/>

capture motion <leaf> -h    Per-leaf usage`;

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
