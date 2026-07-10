import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, type RenderableResult } from '../../../output/render.js';
import { rejectUnsupportedGate } from '../gate-guard.js';

const USAGE = `Usage: capture measure map scroll [url|snap]

Scroll-container topology recorded in a snapshot's scroll.json: containers,
ranges, current/max offsets, sticky/fixed occupancy, snap points, and
visual/layout viewport facts. A URL target creates a snap first.

Not yet implemented.`;

export async function cmdMeasureMapScroll(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (rejectUnsupportedGate(parsed, 'measure map scroll')) return;
  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'measure map scroll', status: 'not_implemented' },
    summary: fact`\`measure map scroll\` is not implemented yet.`,
  };
  emitResult(result, { json: parsed.json });
  process.exit(1);
}
