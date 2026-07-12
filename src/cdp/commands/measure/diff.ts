import { type ParsedArgs } from '../../types.js';
import { resolveSnapRef, ArtifactResolutionError } from '../../../output/artifact.js';
import { diffSnapshots, type ElementDiff } from '../../measure/diff.js';
import { emitResult, fact, lineList, text, type FactLine, type RenderableResult } from '../../../output/render.js';

const USAGE = `capture measure diff — structured before/after diff over two settled snapshots

input:
  --before <snap>   earlier snapshot id or absolute path (required; no positional target — both snapshots must already exist)
  --after <snap>    later snapshot id or absolute path (required)
  --pixels          write and report a full-raster PNG diff
  --full            include state-matrix and unchanged per-element records
  --gate            exit 2 if a measured delta exists (default: exit 0)
output: <diff …> — style, geometry, text, form, and media deltas, cascade provenance, and geometry movement/size facts; --json mirrors
effects: read-only over the two snapshot artifacts; --pixels additionally writes the reported raster-diff PNG`;

function caveatLine(caveats: readonly { regionId: string; selector?: string; reason?: string; snapshot: 'before' | 'after' }[]): FactLine | undefined {
  if (!caveats.length) return undefined;
  return fact`nondeterminism caveat: ${caveats.map((caveat) => `${caveat.snapshot} snapshot ${caveat.regionId}${caveat.selector ? ` (${caveat.selector})` : ''}${caveat.reason ? `: ${caveat.reason}` : ''}`).join('; ')}`;
}

function recordLine(record: ElementDiff, full: boolean): FactLine {
  const selector = record.selector ?? record.key;
  const facts: string[] = [];
  if (record.styleDeltas.length) facts.push(`style properties ${record.styleDeltas.map((delta) => `${delta.property} ${String(delta.before)}→${String(delta.after)}`).join(', ')}`);
  if (record.geometryChanged) facts.push(`geometry changed${record.reflow ? ' (position/size delta)' : ''}`);
  if (record.textChanged) facts.push('text facts changed');
  if (record.formChanged) facts.push('form facts changed');
  if (record.mediaChanged) facts.push('media facts changed');
  if (!facts.length && full) facts.push('no compared delta');
  return fact`${selector} — ${facts.join('; ')}`;
}

function provenanceLines(records: readonly ElementDiff[]): FactLine[] {
  const lines: FactLine[] = [];
  for (const record of records) {
    for (const provenance of record.provenance) {
      lines.push(fact`${record.selector ?? record.key} ${provenance.property}: cascade provenance before=${JSON.stringify(provenance.beforeProvenance ?? null)} after=${JSON.stringify(provenance.afterProvenance ?? null)}${provenance.changed ? '' : provenance.declarationChanged ? ' (unchanged computed value; winning declaration changed)' : ' (unchanged value)'}`);
    }
  }
  return lines;
}

export async function cmdMeasureDiff(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (parsed.positional.length > 0 || !parsed.before || !parsed.after) {
    const result: RenderableResult = {
      tag: 'error',
      attrs: { command: 'measure diff', status: 'invalid_input' },
      summary: text`This command requires --before SNAP and --after SNAP and accepts no positional target.`,
      followUp: text`Use capture measure diff --before SNAP --after SNAP.`,
    };
    emitResult(result, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  try {
    const before = await resolveSnapRef(parsed.before);
    const after = await resolveSnapRef(parsed.after);
    const report = diffSnapshots(before, after, { pixels: parsed.pixels, full: parsed.full });
    const changedRecords = report.changes.filter((record) => record.geometryChanged || record.textChanged || record.formChanged || record.mediaChanged || record.styleDeltas.length > 0);
    const recordLines = report.changes
      .filter((record) => Boolean(parsed.full) || record.geometryChanged || record.textChanged || record.formChanged || record.mediaChanged || record.styleDeltas.length > 0)
      .map((record) => recordLine(record, Boolean(parsed.full)));
    const caveats = report.changes.flatMap((record) => record.caveats);
    const sections: FactLine[] = [];
    if (recordLines.length) sections.push(lineList(recordLines));
    const provenance = provenanceLines(report.changes);
    if (provenance.length) sections.push(lineList(provenance));
    if (parsed.full) {
      sections.push(fact`state-matrix records: ${report.stateDeltas.length}; changed state records: ${report.stateDeltas.filter((state) => state.changed).length}.`);
      if (report.stateDeltas.length) sections.push(lineList(report.stateDeltas.map((state) => fact`${state.key} — ${state.changed ? 'state delta' : 'no state delta'}`)));
    }
    if (report.raster) {
      const raster = report.raster.outcome;
      sections.push(raster.ok
        ? fact`Raster diff: ${raster.diffPixelCount} changed pixels across ${raster.width}×${raster.height}; diff artifact ${report.raster.path}. Raster regions without a geometry delta: ${report.raster.unexplainedRegions}.`
        : fact`Raster diff was not computed: ${raster.message}.`);
      if (raster.ok && report.raster.regions.length) {
        sections.push(lineList(report.raster.regions.map((region) => fact`raster region x=${region.x} y=${region.y} w=${region.w} h=${region.h} changed-pixels=${region.changedPixels} explained-by-geometry=${String(region.explainedByGeometry)}`)));
      }
    }
    const caveat = caveatLine(caveats);
    if (caveat) sections.push(caveat);

    const result: RenderableResult = {
      tag: 'diff',
      attestation: {
        kind: 'snapshot',
        id: after.id,
        path: after.dir,
        note: fact`Compared before snapshot ${before.id} (settled=${String(report.beforeMeta.settled ?? 'unknown')}) with after snapshot ${after.id} (settled=${String(report.afterMeta.settled ?? 'unknown')}).`,
      },
      attrs: { before: before.id, after: after.id, 'changed-elements': changedRecords.length, ...(report.raster?.outcome.ok ? { 'raster-regions': report.raster.unexplainedRegions } : {}) },
      summary: report.changed
        ? fact`${changedRecords.length} element record(s) contain measured style, geometry, text, form, or media deltas.`
        : text`No measured style, geometry, text, form, media, state, or requested raster delta was recorded.`,
      sections,
      followUp: parsed.full
        ? fact`Inspect a changed element with capture measure explain ${after.id} --selector SELECTOR.`
        : fact`Use --full for state-matrix and unchanged per-element provenance records.`,
    };
    emitResult(result, { json: parsed.json });
    if (parsed.gate && report.changed) process.exitCode = 2;
  } catch (error) {
    const detail = error instanceof ArtifactResolutionError ? error.message : error instanceof Error ? error.message : String(error);
    const result: RenderableResult = {
      tag: 'error',
      attrs: { command: 'measure diff', status: 'artifact_unavailable' },
      summary: fact`The requested snapshot comparison could not be read: ${detail}`,
      followUp: text`Create settled snapshots with capture measure snap, then pass their ids or absolute artifact paths.`,
    };
    emitResult(result, { json: parsed.json });
    process.exitCode = 1;
  }
}
