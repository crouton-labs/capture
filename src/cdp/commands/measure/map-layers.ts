import { type ParsedArgs } from '../../types.js';
import { captureMeasureSnap } from './snap.js';
import { buildMeasureMapLayersResult } from '../../measure/map-layers.js';
import { resolveSnapRef } from '../../../output/artifact.js';
import { emitResult, fact, text, type RenderableResult } from '../../../output/render.js';

const USAGE = `capture measure map layers [url|snap] — paint/compositor facts recorded in a snapshot's layers.json

input:
  [url|snap]   required target: a URL creates a settled snapshot first; a snapshot id or absolute path is read without re-driving the browser
output: <layer-map …> — layer bounds, compositing reasons, DOMSnapshot paint order, per-node membership, and available source provenance for layer-affecting declarations; --json mirrors
effects: read-only over an existing snapshot artifact; a URL target writes one settled snapshot first`;

function errorResult(err: unknown): RenderableResult {
  const detail = err instanceof Error ? err.message : String(err);
  return {
    tag: 'error',
    attrs: { command: 'measure map layers', status: 'artifact_unavailable' },
    summary: fact`Layer-map facts could not be read: ${detail}`,
    followUp: text`Pass a settled snapshot id or its absolute artifact path, or pass a URL to create a snapshot first with capture measure snap.`,
  };
}

export async function cmdMeasureMapLayers(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (parsed.positional.length > 1) {
    emitResult({
      tag: 'error',
      attrs: { command: 'measure map layers', status: 'invalid_target' },
      summary: text`measure map layers accepts at most one URL, snapshot id, or absolute snapshot artifact path.`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }
  const target = parsed.positional[0];
  if (!target) {
    emitResult({
      tag: 'error',
      attrs: { command: 'measure map layers', status: 'missing_target' },
      summary: text`A URL, snapshot id, or absolute snapshot artifact path is required to read layer-map facts.`,
      followUp: text`Capture one with capture measure snap <url>, then pass its snapshot id or artifact path.`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  try {
    const ref = await resolveSnapRef(target, {
      onUrl: async (url) => captureMeasureSnap(parsed, url),
    });
    emitResult(buildMeasureMapLayersResult(ref), { json: parsed.json });
  } catch (err) {
    emitResult(errorResult(err), { json: parsed.json });
    process.exitCode = 1;
  }
}
