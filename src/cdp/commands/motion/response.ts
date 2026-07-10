import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, type RenderableResult } from '../../../output/render.js';
import { rejectUnsupportedGate } from '../gate-guard.js';

const USAGE = `Usage: capture motion response <rec> [--action <action>]

Input-to-settled response timeline over a finalized recording:
input -> mutation -> layout -> paint -> network -> settle.

Options:
  --action <action>   Narrow to one recorded action

Not yet implemented.`;

export async function cmdMotionResponse(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (rejectUnsupportedGate(parsed, 'motion response')) return;
  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'motion response', status: 'not_implemented' },
    summary: fact`\`motion response\` is not implemented yet.`,
  };
  emitResult(result, { json: parsed.json });
  process.exit(1);
}
