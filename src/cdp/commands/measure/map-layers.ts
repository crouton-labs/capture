import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, type RenderableResult } from '../../../output/render.js';

const USAGE = `Usage: capture measure map layers [url|snap]

Paint/compositor layer map recorded in a snapshot's layers.json: layers,
bounds, compositing reasons, paint order, per-node membership, and source
provenance for layer-affecting declarations. A URL target creates a snap
first.

Not yet implemented.`;

export async function cmdMeasureMapLayers(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'measure map layers', status: 'not_implemented' },
    summary: fact`\`measure map layers\` is not implemented yet.`,
  };
  emitResult(result, { json: parsed.json });
  process.exit(1);
}
