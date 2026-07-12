import { type ParsedArgs } from '../../types.js';
import { captureMeasureSnap } from './snap.js';
import { ArtifactResolutionError, resolveSnapRef, type SnapUrlResult } from '../../../output/artifact.js';
import { emitResult, fact, lineList, text, type FactLine, type RenderableResult } from '../../../output/render.js';
import { measureMapScroll } from '../../measure/map-scroll.js';

const USAGE = `capture measure map scroll [url|snap] — scroll-container topology recorded in a snapshot's scroll.json

input:
  [url|snap]   required target: a URL creates a settled snapshot first; a snapshot id from the active session or an absolute snapshot artifact path is read without re-driving the browser
output: <scroll-map …> — containers, ranges, current/max offsets, sticky/fixed occupancy, snap points, visual/layout viewport facts, and reachable-content samples; --json mirrors
effects: read-only over an existing snapshot artifact; a URL target writes one settled snapshot first`;

type CaptureSnap = (parsed: ParsedArgs, target: string) => Promise<SnapUrlResult>;
type Emit = typeof emitResult;

interface MapScrollDeps {
  readonly captureSnap?: CaptureSnap;
  readonly emit?: Emit;
}

function artifactRecovery(err: ArtifactResolutionError): FactLine[] {
  return [
    fact`artifact resolution error: ${err.message}`,
    fact`received ref: ${err.ref}`,
    fact`searched path count: ${err.searched.length}`,
    ...err.searched.map((candidate) => fact`searched path: ${candidate}`),
    fact`creating command: ${err.creatingCommand ?? 'capture measure snap'}`,
  ];
}

export async function runMeasureMapScroll(parsed: ParsedArgs, deps: MapScrollDeps = {}): Promise<void> {
  const captureSnap = deps.captureSnap ?? captureMeasureSnap;
  const emit = deps.emit ?? emitResult;

  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  if (parsed.positional.length > 1) {
    const result: RenderableResult = {
      tag: 'error',
      attrs: { command: 'measure map scroll', status: 'invalid_target' },
      summary: text`Measure map scroll accepts one URL, snapshot id, or absolute snapshot path.`,
      followUp: text`Pass one target, for example: \`capture measure map scroll snap-a3f2\`.`,
    };
    emit(result, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  const target = parsed.positional[0] ?? parsed.url;
  if (!target) {
    const result: RenderableResult = {
      tag: 'error',
      attrs: { command: 'measure map scroll', status: 'missing_target' },
      summary: text`No snapshot or URL target was received.`,
      followUp: text`Create a snapshot with \`capture measure snap <url>\`, then pass its id or absolute path to \`capture measure map scroll\`.`,
    };
    emit(result, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  try {
    const ref = await resolveSnapRef(target, {
      onUrl: async (url) => captureSnap({ ...parsed, positional: [url] }, url),
    });
    emit(measureMapScroll(ref), { json: parsed.json });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const recovery = err instanceof ArtifactResolutionError ? artifactRecovery(err) : [];
    const result: RenderableResult = {
      tag: 'error',
      attrs: {
        command: 'measure map scroll',
        status: 'artifact_unavailable',
        recovery: err instanceof ArtifactResolutionError ? 'artifact-resolution-error' : undefined,
        'searched-paths': err instanceof ArtifactResolutionError ? err.searched.length : undefined,
        'creating-command': err instanceof ArtifactResolutionError ? (err.creatingCommand ?? 'capture measure snap') : undefined,
      },
      summary: fact`Scroll topology could not be read: ${detail}`,
      sections: recovery.length ? [lineList(recovery)] : undefined,
      followUp: text`Create a settled snapshot with \`capture measure snap <url>\`; it writes scroll.json for this query.`,
    };
    emit(result, { json: parsed.json });
    process.exitCode = 1;
  }
}

export async function cmdMeasureMapScroll(parsed: ParsedArgs, _args: string[]): Promise<void> {
  await runMeasureMapScroll(parsed);
}
