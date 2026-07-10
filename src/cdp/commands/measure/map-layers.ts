import { type ParsedArgs } from '../../types.js';
import { captureMeasureSnap } from './snap.js';
import { buildMeasureMapLayersResult } from '../../measure/map-layers.js';
import { resolveSnapRef } from '../../../output/artifact.js';
import { emitResult, fact, text, type RenderableResult } from '../../../output/render.js';
import { rejectUnsupportedGate } from '../gate-guard.js';

const USAGE = `Usage: capture measure map layers [url|snap]

Render paint/compositor facts recorded in a snapshot's layers.json: layer
bounds, compositing reasons, DOMSnapshot paint order, per-node membership,
and available source provenance for layer-affecting declarations. A URL target
creates a snapshot first.

The command reads existing snapshot artifacts and does not re-drive the page
unless its target is a URL.`;

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
  if (rejectUnsupportedGate(parsed, 'measure map layers')) return;
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
