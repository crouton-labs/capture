import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, type RenderableResult } from '../../../output/render.js';

const USAGE = `Usage: capture motion rec [url] --do <action> [--duration <ms>]
       capture motion rec --start
       capture motion rec --stop [--rec-id <id>]

One-shot (\`--do\`): drives one scripted action and records it end to end.
Composed (\`--start\` ... intervening commands ... \`--stop\`): records
whatever the active session does across multiple independent commands.

Options:
  --do <action>      One-shot action to drive and record (e.g. click:SEL)
  --duration <ms>    Recording duration override
  --start            Arm the composed recorder (requires an active session)
  --stop             Finalize the composed recorder
  --rec-id <id>      Explicit recording id (default: the session's active recording)

Not yet implemented.`;

export async function cmdMotionRec(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'motion rec', status: 'not_implemented' },
    summary: fact`\`motion rec\` is not implemented yet.`,
  };
  emitResult(result, { json: parsed.json });
  process.exit(1);
}
