import { type ParsedArgs } from '../../types.js';
import {
  ArtifactResolutionError,
  resolveRecRef,
} from '../../../output/artifact.js';
import {
  MotionTimelineSelectionError,
  analyzeMotionTimeline,
  readTimelineMeta,
} from '../../motion/timeline.js';
import {
  emitResult,
  fact,
  formatArtifactList,
  line,
  lineList,
  text,
  type FactLine,
  type RenderableResult,
} from '../../../output/render.js';

const USAGE = `capture motion timeline <rec> --element <sel> — per-frame geometry/scroll/property timeline for one element across a finalized recording

input:
  <rec>             recording id in the active session or an absolute recording path (required; the recording must be finalized)
  --element <sel>   element selector to track (required): a tag, #id, .class, or their simple combination; descendant/child/sibling combinators, pseudo-classes, and attribute selectors are not supported — the recording retains no DOM tree, so the selector is matched against sampled bounding boxes only
  --prop <prop>     report one sampled geometry, scroll, or recorded property per frame
output: <timeline …> — per-frame bounding-box geometry, sampled scroll offsets, and optional sampled property values; the recorder samples bounding boxes, not DOM quads, and frame-derived timestamps carry ±1-frame uncertainty; --json mirrors
effects: read-only — reads the finalized recording artifact, never drives the browser`;

export async function cmdMotionTimeline(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  const recArg = parsed.positional[0];
  if (!recArg || parsed.positional.length !== 1 || !parsed.element?.trim()) {
    return emitCommandError(
      parsed,
      'invalid_input',
      'Expected exactly one recording id/path and a non-empty --element selector.',
      'capture motion timeline <rec> --element <sel> [--prop <prop>]',
    );
  }

  try {
    const ref = resolveRecRef(recArg);
    const meta = readTimelineMeta(ref);
    const timeline = analyzeMotionTimeline(ref, parsed.element, parsed.prop);
    if (parsed.prop && !timeline.propertyAvailable) {
      return emitCommandError(
        parsed,
        'property_unavailable',
        `The recording has no sampled value for property ${JSON.stringify(parsed.prop)} on the selected element. rects.jsonl records bounding boxes and only includes scroll/property values when the recorder sampled them.`,
        `Re-run without --prop for bounding-box geometry, or record with a substrate that samples ${JSON.stringify(parsed.prop)}.`,
        ref,
        meta.state,
      );
    }

    const rows = timeline.points.map((point) => formatPoint(point, parsed.prop));
    const result: RenderableResult = {
      tag: 'timeline',
      attestation: {
        kind: 'recording',
        id: ref.id,
        path: ref.dir,
        note: timeline.timingDomain === 'screencast-relative'
          ? text`Times are milliseconds from the first screencast frame; each is frame-derived (±1 frame), not an exact performance.now() timestamp.`
          : text`Screencast timestamps were unavailable; rows are ordered by sampled frame and have frame-derived timing uncertainty.`,
      },
      attrs: {
        state: meta.state,
        frames: timeline.frameCount,
        samples: timeline.points.length,
        element: parsed.element,
        prop: parsed.prop,
        'timestamp-uncertainty': '±1 frame',
        geometry: 'bounding-box',
      },
      summary: fact`${timeline.points.length} sampled frame(s) matched selector ${parsed.element}; identity continuity uses ${timeline.selectionMethod}. ${timeline.eventsRead} event record(s) were read with the recording.`,
      artifacts: formatArtifactList([
        { name: 'rects.jsonl', note: 'per-frame sampled bounding boxes and optional scroll/property values' },
        { name: 'events.jsonl', note: `${timeline.eventsRead} recording event records read` },
        { name: 'markers.json', note: 'clock baseline provenance' },
        { name: 'meta.json', note: `recording state ${meta.state}` },
      ]),
      sections: rows.length ? [lineList(rows)] : [text`The selected element had no complete bounding-box samples.`],
      followUp: text`Use \`capture motion jank <rec>\` for dropped-frame and observer-event facts, or \`capture motion response <rec>\` for input-to-settle timing facts.`,
    };
    emitResult(result, { json: parsed.json });
  } catch (err) {
    if (err instanceof MotionTimelineSelectionError) {
      return emitCommandError(
        parsed,
        'element_not_found',
        err.message,
        'Pass a tag, #id, .class, or simple tag/id/class combination that appears in rects.jsonl.',
      );
    }
    if (err instanceof ArtifactResolutionError) {
      return emitCommandError(parsed, 'artifact_unavailable', err.message, err.creatingCommand ?? 'Create a finalized recording, then re-run this query.');
    }
    return emitCommandError(parsed, 'timeline_failed', err instanceof Error ? err.message : String(err), 'Inspect the finalized recording artifacts and re-run the query.');
  }
}

function formatPoint(
  point: ReturnType<typeof analyzeMotionTimeline>['points'][number],
  requestedProp?: string,
): FactLine {
  const time = point.timeMs === null ? fact`frame=${point.frame}` : fact`t=${point.timeMs.toFixed(1)}ms frame=${point.frame}`;
  const geometry = fact`x=${point.x} y=${point.y} w=${point.width} h=${point.height}`;
  const scroll: FactLine[] = [];
  if (point.scrollTop !== undefined) scroll.push(fact`scrollTop=${point.scrollTop}`);
  if (point.scrollLeft !== undefined) scroll.push(fact`scrollLeft=${point.scrollLeft}`);
  const prop = point.property
    ? fact`${point.property.name}=${String(point.property.value)}`
    : requestedProp
      ? text`property=not-sampled`
      : text``;
  return line(time, text` · `, geometry, ...(scroll.length ? [text` · `, line(...joinWithSeparator(scroll))] : []), text` · `, prop, text` · timestamp uncertainty ±1 frame`);
}

function joinWithSeparator(parts: readonly FactLine[]): FactLine[] {
  const out: FactLine[] = [];
  parts.forEach((part, index) => {
    if (index) out.push(text` `);
    out.push(part);
  });
  return out;
}

function emitCommandError(
  parsed: ParsedArgs,
  status: string,
  message: string,
  recovery: string,
  ref?: { id: string; dir: string },
  state?: string,
): void {
  const result: RenderableResult = {
    tag: 'error',
    ...(ref ? { attestation: { kind: 'recording' as const, id: ref.id, path: ref.dir } } : {}),
    attrs: { command: 'motion timeline', status, state },
    summary: fact`${message}`,
    sections: [fact`Recovery: ${recovery}`],
  };
  emitResult(result, { json: parsed.json });
  process.exitCode = 1;
}
