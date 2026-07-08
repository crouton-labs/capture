import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, type RenderableResult } from '../../../output/render.js';

const USAGE = `Usage: capture measure map focus [url|snap]

Keyboard traversal order recorded in a snapshot's focus.json: forward and
reverse Tab sequence, rects, scroll jumps, focus-visible facts, and
unreached focusable elements. A URL target creates a snap first.

Not yet implemented.`;

export async function cmdMeasureMapFocus(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'measure map focus', status: 'not_implemented' },
    summary: fact`\`measure map focus\` is not implemented yet.`,
  };
  emitResult(result, { json: parsed.json });
  process.exit(1);
}
