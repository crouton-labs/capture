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
import { cmdMeasureText } from './text.js';
import { cmdMeasureSweep } from './sweep.js';
import { cmdMeasureMapFocus } from './map-focus.js';
import { cmdMeasureMapScroll } from './map-scroll.js';
import { cmdMeasureMapLayers } from './map-layers.js';
import { cmdMeasureMapAx } from './map-ax.js';
import { cmdMeasureMapPaint } from './map-paint.js';

/** Root-help representation of this branch, assembled by `src/capture.ts`. */
export const COMMAND_BLOCK = `<command name="measure">
static page measurement — \`snap\` waits for the page to settle, then records its layout, styles, text, and accessibility into one artifact; every other leaf answers questions from that artifact without re-driving the browser
use when a claim depends on what is rendered right now: element geometry, overflow, clipping, stacking, computed style and where it came from, text and contrast, focus order, scroll containers, paint coverage, or the difference between two snapshots
</command>`;

export const MEASURE_USAGE = `<command name="measure" description="enriched snapshot substrate and read-only queries">
<model>\`snap\` drives the page (or a base snapshot) and writes one settled artifact directory; every other leaf below reads that artifact and never re-drives the browser unless its target is a URL, which first creates a snapshot. Findings exit 0 — a report, not a failure. \`--gate\` (exit 2 on findings or changes) is accepted only by check and diff.</model>
<subcommand name="snap" description="settled snapshot artifact" whenToUse="Use to capture the static rendered-page substrate that measure queries read."/>
<subcommand name="check" description="snapshot threshold measurements" whenToUse="Use to measure selected layout and content thresholds from one snapshot."/>
<subcommand name="diff" description="snapshot delta" whenToUse="Use to compare the measured facts from two snapshots."/>
<subcommand name="census" description="snapshot value distributions" whenToUse="Use to count values across one or more snapshots."/>
<subcommand name="explain" description="element rendering explanation" whenToUse="Use to inspect cascade, stacking, clipping, size, text, or form facts for one element."/>
<subcommand name="text" description="targeted DOM-content text measurement" whenToUse="Use to read one element's direct DOM content text, font, recorded color-model values, contrast ratio, and provenance from a snapshot."/>
<subcommand name="sweep" description="responsive environment sampling" whenToUse="Use to compare snapshot facts across values on one environment axis."/>
<subcommand name="map" description="one snapshot facet" whenToUse="Use to read focus, scroll, layer, accessibility, or paint facts from a snapshot."/>
</command>`;

export const MEASURE_MAP_USAGE = `<command name="map" description="one facet of a snapshot's substrate">
<model>Focus, scroll, layers, and ax accept a URL target and create a snapshot first; paint requires an existing snapshot and reads it without browser driving.</model>
<subcommand name="focus" description="keyboard traversal order" whenToUse="Use to inspect focus order from a snapshot."/>
<subcommand name="scroll" description="scroll-container topology" whenToUse="Use to inspect scroll containers and their relationships."/>
<subcommand name="layers" description="paint and compositor layers" whenToUse="Use to inspect layer allocation and paint order."/>
<subcommand name="ax" description="accessibility and layout map" whenToUse="Use to relate accessibility-tree nodes to layout geometry."/>
<subcommand name="paint" description="coverage above one target" whenToUse="Use to inspect elements painted above a target and their recorded coverage."/>
</command>`;

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
    case 'text':
      return cmdMeasureText(rest, args);
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
    case 'paint':
      return cmdMeasureMapPaint(rest, args);
    case undefined:
      console.log(MEASURE_MAP_USAGE);
      return;
    default:
      throw invalidInput(`Unknown measure map leaf: ${sub}.`, 'unknown_command');
  }
}
