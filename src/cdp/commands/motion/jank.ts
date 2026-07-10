import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, type RenderableResult } from '../../../output/render.js';
import { rejectUnsupportedGate } from '../gate-guard.js';

const USAGE = `Usage: capture motion jank <rec>

Dropped-frame/long-task/layout-shift facts over a finalized recording.

Not yet implemented.`;

export async function cmdMotionJank(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (rejectUnsupportedGate(parsed, 'motion jank')) return;
  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'motion jank', status: 'not_implemented' },
    summary: fact`\`motion jank\` is not implemented yet.`,
  };
  emitResult(result, { json: parsed.json });
  process.exit(1);
}
