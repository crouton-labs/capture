import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, type RenderableResult } from '../../../output/render.js';

const USAGE = `Usage: capture motion mask <rec>

Motion-diff composite image over a finalized recording, plus per-region
area/distance/velocity facts and element attribution where resolvable.

Not yet implemented.`;

export async function cmdMotionMask(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'motion mask', status: 'not_implemented' },
    summary: fact`\`motion mask\` is not implemented yet.`,
  };
  emitResult(result, { json: parsed.json });
  process.exit(1);
}
