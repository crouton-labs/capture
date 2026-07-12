import { type ParsedArgs } from '../../types.js';
import { captureMeasureSnap } from './snap.js';
import { mapFocus } from '../../measure/map-focus.js';
import { ArtifactResolutionError, resolveSnapRef } from '../../../output/artifact.js';
import { emitResult, fact, type RenderableResult } from '../../../output/render.js';

const USAGE = `capture measure map focus [url|snap] — keyboard traversal facts recorded in a snapshot's focus.json

input:
  [url|snap]   required target: a URL creates a settled snapshot first; a snapshot id or absolute path is read without re-driving the browser
output: <focus-map …> — forward and reverse Tab sequences, top-viewport rects, scroll jumps, focus-visible style facts, and unreached focusable elements; --json mirrors
effects: read-only over an existing snapshot artifact; a URL target writes one settled snapshot first`;

function recoveryResult(err: unknown): RenderableResult {
  const detail = err instanceof ArtifactResolutionError || err instanceof Error
    ? err.message
    : 'The focus artifact could not be resolved.';
  return {
    tag: 'error',
    attrs: { command: 'measure map focus', status: 'artifact_unavailable' },
    summary: fact`Focus-map facts could not be read: ${detail}`,
    followUp: fact`Create a settled snapshot with \`capture measure snap <url>\`, then run \`capture measure map focus <snap>\`.`,
  };
}

export async function cmdMeasureMapFocus(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (parsed.positional.length !== 1) {
    emitResult({
      tag: 'error',
      attrs: { command: 'measure map focus', status: 'invalid_target' },
      summary: fact`Expected exactly one URL or snapshot target; received ${parsed.positional.length} positional target(s).`,
      followUp: fact`Run \`capture measure map focus <snap>\` or \`capture measure map focus <url>\`.`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  try {
    const target = parsed.positional[0]!;
    const ref = await resolveSnapRef(target, {
      onUrl: async (url) => captureMeasureSnap({ ...parsed, positional: [url] }, url),
    });
    emitResult(mapFocus(ref), { json: parsed.json });
  } catch (err) {
    emitResult(recoveryResult(err), { json: parsed.json });
    process.exitCode = 1;
  }
}
