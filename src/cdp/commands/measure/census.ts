import * as fs from 'fs';

import { type ParsedArgs } from '../../types.js';
import { captureMeasureSnap } from './snap.js';
import { ArtifactResolutionError, resolveSnapRef, type SnapRef } from '../../../output/artifact.js';
import { emitResult, fact, formatArtifactList, text, type RenderableResult } from '../../../output/render.js';
import { buildCensus, CENSUS_AXES, censusResultLines, type CensusAxis } from '../../measure/census.js';

const USAGE = `capture measure census --axis <axis> — value distributions and token-audit facts across one or more settled snapshots

input:
  --axis <axis>       color|font|spacing|radius|shadow|animation|geometry|media|queries (required)
  --snap <id|path>    existing snapshot id or absolute artifact path (repeatable)
  --url <url>         URL to snap first (repeatable)
  --set-file <path>   file listing one snapshot id/path or URL per line
output: <census axis=… snapshots=… distinct=…> — distributions with provenance where recorded, and per-region nondeterminism caveats for facts touching an unsettled capture; --json mirrors
effects: read-only over existing snapshot artifacts; each --url writes one one-shot snapshot first`;

function targetsFromFile(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
}

function isAxis(value: string | undefined): value is CensusAxis {
  return value !== undefined && (CENSUS_AXES as readonly string[]).includes(value);
}

async function resolveTargets(parsed: ParsedArgs): Promise<SnapRef[]> {
  const targetRefs = [...(parsed.snap ?? []), ...(parsed.urls ?? [])];
  if (parsed.setFile) targetRefs.push(...targetsFromFile(parsed.setFile));
  if (!targetRefs.length) throw new Error('census needs at least one --snap, --url, or --set-file target');

  const snaps: SnapRef[] = [];
  for (const target of targetRefs) {
    snaps.push(await resolveSnapRef(target, {
      onUrl: async (url) => {
        const captured = await captureMeasureSnap({ ...parsed, positional: [], url, target: undefined }, url);
        return captured;
      },
    }));
  }
  return snaps;
}

function errorResult(message: string, status: string): RenderableResult {
  return {
    tag: 'error',
    attrs: { command: 'measure census', status },
    summary: fact`Census could not read the requested measurement artifacts: ${message}`,
    followUp: text`Create a settled snapshot with capture measure snap, then pass its id or absolute artifact path.`,
  };
}

export async function cmdMeasureCensus(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (parsed.positional.length) {
    emitResult(errorResult('this leaf takes targets only through repeatable --snap and --url flags.', 'invalid_input'), { json: parsed.json });
    process.exitCode = 1;
    return;
  }
  if (!isAxis(parsed.axis)) {
    emitResult(errorResult(`--axis must be one of ${CENSUS_AXES.join('|')}; received ${parsed.axis ?? '(missing)'}.`, 'invalid_axis'), { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  try {
    const snapshots = await resolveTargets(parsed);
    const report = buildCensus(parsed.axis, snapshots);
    const result: RenderableResult = {
      tag: 'census',
      attrs: { axis: report.axis, snapshots: snapshots.length, distinct: report.distinct },
      summary: fact`Distribution facts were measured from ${snapshots.length} snapshot artifact(s).`,
      artifacts: formatArtifactList(snapshots.map((snap) => ({ name: snap.dir, note: snap.id }))),
      sections: [censusResultLines(report)],
      followUp: fact`Use capture measure explain ${snapshots[0].id} --selector <selector> for one element's recorded provenance.`,
    };
    emitResult(result, { json: parsed.json });
  } catch (err) {
    const detail = err instanceof ArtifactResolutionError || err instanceof Error ? err.message : String(err);
    emitResult(errorResult(detail, 'artifact_unavailable'), { json: parsed.json });
    process.exitCode = 1;
  }
}
