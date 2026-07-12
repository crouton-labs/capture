import { type ParsedArgs } from '../../types.js';
import { captureMeasureSnap } from './snap.js';
import { buildMeasureMapAxResult } from '../../measure/map-ax.js';
import { ArtifactResolutionError, resolveSnapRef } from '../../../output/artifact.js';
import { emitResult, fact, type RenderableResult } from '../../../output/render.js';
import { rejectUnsupportedGate } from '../gate-guard.js';

const USAGE = `Usage: capture measure map ax [url|snap]

Render the accessibility-tree facts recorded in a snapshot's ax.json joined
against geometry.json: non-ignored AX nodes with role, name, states,
backendNodeId, and top-viewport rect; ignored AX nodes with their
ignored-reasons; DOM elements with rendered boxes but no non-ignored AX
node; and AX nodes whose rect is offscreen, clipped, or zero-size. A URL
target creates a settled snapshot first; a snapshot id or absolute path is
read without re-driving the browser.

A snapshot target is required. Use capture measure snap <url> to create one.`;

function recoveryResult(err: unknown): RenderableResult {
  const detail = err instanceof ArtifactResolutionError || err instanceof Error
    ? err.message
    : 'The snapshot artifacts could not be resolved.';
  return {
    tag: 'error',
    attrs: { command: 'measure map ax', status: 'artifact_unavailable' },
    summary: fact`AX-map facts could not be read: ${detail}`,
    followUp: fact`Create a settled snapshot with \`capture measure snap <url>\`, then run \`capture measure map ax <snap>\`.`,
  };
}

export async function cmdMeasureMapAx(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (rejectUnsupportedGate(parsed, 'measure map ax')) return;
  if (parsed.positional.length !== 1) {
    emitResult({
      tag: 'error',
      attrs: { command: 'measure map ax', status: 'invalid_target' },
      summary: fact`Expected exactly one URL or snapshot target; received ${parsed.positional.length} positional target(s).`,
      followUp: fact`Run \`capture measure map ax <snap>\` or \`capture measure map ax <url>\`.`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  try {
    const target = parsed.positional[0]!;
    const ref = await resolveSnapRef(target, {
      onUrl: async (url) => captureMeasureSnap({ ...parsed, positional: [url] }, url),
    });
    emitResult(buildMeasureMapAxResult(ref), { json: parsed.json });
  } catch (err) {
    emitResult(recoveryResult(err), { json: parsed.json });
    process.exitCode = 1;
  }
}
