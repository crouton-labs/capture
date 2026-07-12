/**
 * `capture measure` branch router.
 *
 * Shifts the consumed leaf token(s) out of `parsed.positional` before
 * handing off, so every leaf command still finds its own primary target
 * (a URL, a snap id, ...) at `positional[0]` exactly as every other capture
 * command does — leaf commands never need to know they're nested under a
 * branch.
 */
import { invalidInput } from '../../../errors.js';
import { type ParsedArgs } from '../../types.js';
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
use when measuring layout/content/targetability facts, diffing snapshots, or reading one facet (focus, scroll, layers, ax) of the substrate
  snap · check · diff · census · explain · sweep · map — \`capture measure -h\`
</command>`;

export const MEASURE_USAGE = `capture measure — enriched snapshot substrate + read-only queries over it.

\`snap\` drives the page (or a base snapshot) and writes one settled artifact
directory; every other leaf below is a cheap read over that artifact and
never re-drives the browser unless its target is a URL (which snaps first).
Every leaf defaults to rendered prose; --json mirrors the same result.
Findings exit 0 — a report, not a failure.
\`--gate\` (exit 2 on findings/changes) is accepted only by check and diff.

<subcommand name="snap" args="[url|snap] [--freeze-animations] [--settle-timeout <ms>] [--capture-unsettled] [--pixels] [--state <state[:selector]>]... [--viewport <WxH>]..." whenToUse="drive + write the settled snapshot substrate every other leaf reads"/>
<subcommand name="check" args="[url|snap] [--for <checks>] [--gate]" whenToUse="read threshold/fact measurements from one snapshot"/>
<subcommand name="diff" args="--before <snap> --after <snap> [--pixels] [--full] [--gate]" whenToUse="structured before/after delta between two snapshots"/>
<subcommand name="census" args="[--snap <id>]... [--url <url>]... [--set-file <path>] --axis <axis>" whenToUse="value distributions across one or more snapshots"/>
<subcommand name="explain" args="<snap> --selector <sel> [--size] [--text] [--form]" whenToUse="per-element cascade/stacking/clipping/size/text/form explanation"/>
<subcommand name="sweep" args="[url] --axis <axis> [--from <val>] [--to <val>] [--viewport-height <val>]" whenToUse="responsive/environment sampling across an axis"/>
<subcommand name="map" args="focus|scroll|layers|ax [url|snap]" whenToUse="read one facet of a snapshot's substrate — capture measure map -h"/>

capture measure <leaf> -h    Per-leaf usage`;

export const MEASURE_MAP_USAGE = `capture measure map — read one facet of a snapshot's substrate (no browser re-drive).

A URL target first creates a snap; a snap target reads its existing artifact.

<subcommand name="focus" args="[url|snap]" whenToUse="keyboard traversal order (focus.json)"/>
<subcommand name="scroll" args="[url|snap]" whenToUse="scroll-container topology (scroll.json)"/>
<subcommand name="layers" args="[url|snap]" whenToUse="paint/compositor layer map (layers.json)"/>
<subcommand name="ax" args="[url|snap]" whenToUse="AX-tree ↔ layout map (ax.json + geometry.json)"/>

capture measure map <leaf> -h    Per-leaf usage`;

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
      console.log(MEASURE_USAGE);
      return;
    default:
      throw invalidInput(`Unknown measure leaf: ${leaf}.`, 'unknown_command');
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
      console.log(MEASURE_MAP_USAGE);
      return;
    default:
      throw invalidInput(`Unknown measure map leaf: ${sub}.`, 'unknown_command');
  }
}
