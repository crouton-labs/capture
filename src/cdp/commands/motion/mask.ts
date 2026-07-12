import { type ParsedArgs } from '../../types.js';
import { createMotionMask } from '../../motion/mask.js';
import { readMeta, resolveRecRef } from '../../../output/artifact.js';
import { emitResult, fact, formatArtifactList, line, lineList, text, type FactLine, type RenderableResult } from '../../../output/render.js';
import { rejectUnsupportedGate } from '../gate-guard.js';

const DEFAULT_REGION_LIMIT = 20;

const USAGE = `Usage: capture motion mask <rec> [--limit <N>]

Motion-diff composite image over a finalized recording, plus per-region
area, distance, velocity, and element attribution where recorded rects overlap.

<rec> is a recording id in the active session or an absolute recording path.

Options:
  --limit <N>  Render at most N size-sorted region rows (default: ${DEFAULT_REGION_LIMIT}).
               --json always contains every region row.`;

export async function cmdMotionMask(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (rejectUnsupportedGate(parsed, 'motion mask')) return;
  if (parsed.positional.length !== 1) {
    return emitCommandError(parsed, 'invalid_target', 'motion mask requires exactly one recording id or absolute recording path. Create one with `capture motion rec`.');
  }

  try {
    const ref = resolveRecRef(parsed.positional[0]);
    const meta = readMeta<{ state?: unknown }>(ref);
    const state = typeof meta.state === 'string' ? meta.state : 'unknown';
    if (state !== 'finalized' && state !== 'orphaned-finalized') {
      return emitCommandError(parsed, 'recording_not_finalized', `Recording ${ref.id} has state ${state}; finalize it with \`capture motion rec --stop\` before creating a mask.`);
    }
    const mask = createMotionMask(ref);
    // A recording can have many isolated changed-pixel components. Limit the
    // human/agent prose view, while JSON keeps the complete size-sorted list.
    const proseLimit = parsed.limit ?? DEFAULT_REGION_LIMIT;
    const reportedRegions = parsed.json ? mask.regions : mask.regions.slice(0, proseLimit);
    const regionLines = reportedRegions.length
      ? reportedRegions.map((region) => formatRegion(region))
      : [text`No changed pixels were measured across the recorded frame pairs.`];
    const result: RenderableResult = {
      tag: 'motion-mask',
      attestation: {
        kind: 'recording',
        id: ref.id,
        path: ref.dir,
        note: text`Frame-derived onset, distance, and velocity times carry ±1 frame uncertainty; timestamps use screencast-frame timing when available.`,
      },
      attrs: {
        state,
        regions: mask.regions.length,
        'prose-regions': Math.min(mask.regions.length, proseLimit),
        image: `${ref.id}/motion-mask.png`,
        'timestamp-uncertainty': '±1 frame',
        ...(mask.caveat ? { window: 'partial (viewport resize)' } : {}),
      },
      summary: fact`Composite written: motion-mask.png (${mask.width}×${mask.height}, ${mask.comparedFramePairs} adjacent frame pair(s)); transparent pixels did not differ and hue runs blue (early) to red (late).`,
      artifacts: formatArtifactList([{ name: 'motion-mask.png', note: 'motion-diff composite' }]),
      sections: [
        ...(mask.caveat ? [line(text`${mask.caveat}`)] : []),
        ...(mask.regions.length > proseLimit && !parsed.json
          ? [fact`Showing ${reportedRegions.length} of ${mask.regions.length} size-sorted changed-pixel regions; --json contains all region rows.`]
          : []),
        lineList(regionLines),
      ],
      followUp: mask.regions[0]?.element
        ? line(text`Per-frame geometry for region 1: \`capture motion timeline `, fact`${ref.id}`, text` --element `, fact`${mask.regions[0].element.label}\`.`)
        : undefined,
    };
    emitResult(result, { json: parsed.json });
  } catch (err) {
    emitCommandError(parsed, 'artifact_unavailable', err instanceof Error ? err.message : String(err));
  }
}

function formatRegion(region: ReturnType<typeof createMotionMask>['regions'][number]): FactLine {
  const attribution = region.element
    ? fact` · attributed rect: \`${region.element.label}\`${region.element.backendNodeId === undefined ? '' : ` (backend ${region.element.backendNodeId})`}`
    : text` · no recorded element rect overlapped this region`;
  return line(
    fact`${region.index}. x=${region.x} y=${region.y} w=${region.width} h=${region.height} — area ${region.areaPixels} changed px; distance ${region.distancePx}px; velocity ${region.velocityPxPerSecond}px/s; frame-time ${region.startMs}–${region.endMs}ms`,
    attribution,
  );
}

function emitCommandError(parsed: ParsedArgs, status: string, message: string): void {
  emitResult({
    tag: 'error',
    attrs: { command: 'motion mask', status },
    summary: fact`${message}`,
  }, { json: parsed.json });
  process.exitCode = 1;
}
