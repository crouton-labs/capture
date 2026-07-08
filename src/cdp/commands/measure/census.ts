import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, type RenderableResult } from '../../../output/render.js';

const USAGE = `Usage: capture measure census [--snap <id>]... [--url <url>]... [--set-file <path>] --axis <axis>

Value distributions and token audits across one or more snapshots. Each
--snap/--url is repeatable to build a cross-page distribution; a --url
target creates a one-shot snap first.

Options:
  --snap <id>          Existing snapshot id/path (repeatable)
  --url <url>          URL to snap first (repeatable)
  --set-file <path>    File listing additional snap/url targets, one per line
  --viewport <WxH>     Viewport to snap at (repeatable)
  --axis <axis>        color|font|spacing|radius|shadow|animation|geometry|media|queries

Not yet implemented.`;

export async function cmdMeasureCensus(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'measure census', status: 'not_implemented' },
    summary: fact`\`measure census\` is not implemented yet.`,
  };
  emitResult(result, { json: parsed.json });
  process.exit(1);
}
