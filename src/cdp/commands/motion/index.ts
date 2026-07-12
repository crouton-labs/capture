/**
 * `capture motion` branch router.
 *
 * Shifts the consumed leaf token out of `parsed.positional` before handing
 * off, so every leaf command still finds its own primary target (a URL, a
 * recording id, ...) at `positional[0]` exactly as every other capture
 * command does.
 */
import { type ParsedArgs } from '../../types.js';
import { rejectUnsupportedGate } from '../gate-guard.js';
import { cmdMotionRec } from './rec.js';
import { cmdMotionMask } from './mask.js';
import { cmdMotionTimeline } from './timeline.js';
import { cmdMotionJank } from './jank.js';
import { cmdMotionResponse } from './response.js';

export const MOTION_USAGE = `capture motion — recorder lifecycle + read-only queries over a finalized recording.

\`rec\` drives (and records) the browser, one-shot or composed across
intervening commands; every other leaf below is a cheap read over the
finalized recording artifact.

Leaves:
  rec [url] --do <action> [--duration <ms>]   One-shot: drive one action, record it
  rec --start                                 Composed: arm the recorder (needs an active session)
  rec --stop                                  Composed: finalize the recorder

  mask <rec> [--limit <N>]                    Motion-diff composite image + per-region facts
  timeline <rec> --element <sel> [--prop <prop>]
                                               Per-frame geometry/scroll/property timeline
  jank <rec>                                  Dropped-frame/long-task/layout-shift facts
  response <rec> [--action <action>]          Input-to-settled response timeline

Every leaf defaults to rendered prose; --json mirrors the same result as JSON.
\`mask\` is the one exception: default prose caps region rows (\`--limit\`, default
20) while \`--json\` always carries every region.
Exit codes: findings exit 0 — a report, not a failure. Input/precondition
errors — a bad or missing recording target, an unfinalized recording, an
unusable artifact — exit 1. No leaf accepts --gate.

capture motion <leaf> --help    Per-leaf usage`;

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
      if (rejectUnsupportedGate(parsed, 'motion')) return;
      console.log(MOTION_USAGE);
      return;
    default:
      console.error(`Unknown motion leaf: ${leaf}\n\n${MOTION_USAGE}`);
      process.exit(1);
  }
}
