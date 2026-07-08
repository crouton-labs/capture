import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, type RenderableResult } from '../../../output/render.js';

const USAGE = `Usage: capture motion timeline <rec> --element <sel> [--prop <prop>]

Per-frame geometry/scroll/property values for one element across a
finalized recording.

Options:
  --element <sel>   Element selector to track (required)
  --prop <prop>     Additional CSS/computed property to sample per frame

Not yet implemented.`;

export async function cmdMotionTimeline(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'motion timeline', status: 'not_implemented' },
    summary: fact`\`motion timeline\` is not implemented yet.`,
  };
  emitResult(result, { json: parsed.json });
  process.exit(1);
}
