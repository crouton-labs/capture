/**
 * `capture measure` branch router.
 *
 * Shifts the consumed leaf token(s) out of `parsed.positional` before
 * handing off, so every leaf command still finds its own primary target
 * (a URL, a snap id, ...) at `positional[0]` exactly as every other capture
 * command does — leaf commands never need to know they're nested under a
 * branch.
 */
import { type ParsedArgs } from '../../types.js';
import { rejectUnsupportedGate } from '../gate-guard.js';
import { cmdMeasureSnap } from './snap.js';
import { cmdMeasureCheck } from './check.js';
import { cmdMeasureDiff } from './diff.js';
import { cmdMeasureCensus } from './census.js';
import { cmdMeasureExplain } from './explain.js';
import { cmdMeasureSweep } from './sweep.js';
import { cmdMeasureMapFocus } from './map-focus.js';
import { cmdMeasureMapScroll } from './map-scroll.js';
import { cmdMeasureMapLayers } from './map-layers.js';
import { cmdMeasureMapAx } from './map-ax.js';

/** Root-help representation of this branch, assembled by `src/capture.ts`. */
export const COMMAND_BLOCK = `<command name="measure">
static facts over a settled snapshot — \`snap\` writes the substrate, every other leaf is a read-only query over it
use when measuring layout/content/targetability facts, diffing snapshots, or reading one facet (focus, scroll, layers) of the substrate
  snap · check · diff · census · explain · sweep · map — \`capture measure -h\`
</command>`;

export const MEASURE_USAGE = `capture measure — enriched snapshot substrate + read-only queries over it.

\`snap\` drives the page (or a base snapshot) and writes one settled artifact
directory; every other leaf below is a cheap read over that artifact and
never re-drives the browser unless it explicitly accepts a URL target.

Leaves:
  snap [url|snap]                          Drive + write a settled snapshot substrate
    [--freeze-animations] [--settle-timeout <ms>] [--capture-unsettled]
    [--pixels] [--state <state[:selector]>]...

  check [url|snap] [--for <checks>] [--viewport <WxH>]... [--gate]
                                            Threshold/fact checks over a snapshot

  diff --before <snap> --after <snap> [--pixels] [--full] [--gate]
                                            Structured before/after snapshot diff

  census [--snap <id>]... [--url <url>]... [--set-file <path>] --axis <axis>
                                            Value distributions across one or more snapshots
                                            (--snap/--url repeatable)

  explain <snap> --selector <sel> [--size] [--text] [--form]
                                            Per-element cascade/stacking/clipping/size/text/form explanation

  sweep [url] --axis <axis> [--from <val>] [--to <val>] [--viewport-height <val>]
                                            Responsive/environment sampling

  map focus|scroll|layers|ax [url|snap]    Read one facet of a snapshot's substrate
                                            (see \`capture measure map --help\`)

Every leaf defaults to rendered prose; --json mirrors the same result as JSON.
Exit codes: 0 by default — findings are a report, not a failure.
--gate exits 2 on findings/changes; only \`check\` and \`diff\` accept it.

capture measure <leaf> --help    Per-leaf usage`;

export const MEASURE_MAP_USAGE = `capture measure map — read one facet of a snapshot's substrate (no browser re-drive).

Leaves:
  focus  [url|snap]      Keyboard traversal order (focus.json)
  scroll [url|snap]      Scroll-container topology (scroll.json)
  layers [url|snap]      Paint/compositor layer map (layers.json)
  ax     [url|snap]      AX-tree ↔ layout map (ax.json + geometry.json)

A URL target first creates a snap; a snap target reads its existing artifact.

capture measure map <leaf> --help    Per-leaf usage`;

export async function measureMain(parsed: ParsedArgs, args: string[]): Promise<void> {
  const leaf = parsed.positional[0];
  const rest: ParsedArgs = { ...parsed, positional: parsed.positional.slice(1) };

  switch (leaf) {
    case 'snap':
      return cmdMeasureSnap(rest, args);
    case 'check':
      return cmdMeasureCheck(rest, args);
    case 'diff':
      return cmdMeasureDiff(rest, args);
    case 'census':
      return cmdMeasureCensus(rest, args);
    case 'explain':
      return cmdMeasureExplain(rest, args);
    case 'sweep':
      return cmdMeasureSweep(rest, args);
    case 'map':
      return measureMapMain(rest, args);
    case undefined:
      if (rejectUnsupportedGate(parsed, 'measure')) return;
      console.log(MEASURE_USAGE);
      return;
    default:
      console.error(`Unknown measure leaf: ${leaf}\n\n${MEASURE_USAGE}`);
      process.exit(1);
  }
}

async function measureMapMain(parsed: ParsedArgs, args: string[]): Promise<void> {
  const sub = parsed.positional[0];
  const rest: ParsedArgs = { ...parsed, positional: parsed.positional.slice(1) };

  switch (sub) {
    case 'focus':
      return cmdMeasureMapFocus(rest, args);
    case 'scroll':
      return cmdMeasureMapScroll(rest, args);
    case 'layers':
      return cmdMeasureMapLayers(rest, args);
    case 'ax':
      return cmdMeasureMapAx(rest, args);
    case undefined:
      if (rejectUnsupportedGate(parsed, 'measure map')) return;
      console.log(MEASURE_MAP_USAGE);
      return;
    default:
      console.error(`Unknown measure map leaf: ${sub}\n\n${MEASURE_MAP_USAGE}`);
      process.exit(1);
  }
}
