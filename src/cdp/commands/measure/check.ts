import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, type RenderableResult } from '../../../output/render.js';

const USAGE = `Usage: capture measure check [url|snap] [--for <checks>] [--viewport <WxH>]... [--gate]

Threshold/fact checks over a settled snapshot's substrate: overlap,
offscreen, overflow, tap-target size, contrast, hit-test receiver,
truncation, form visibility, media/replaced anomalies, and animation
facts. A URL target creates a one-shot snap first.

Options:
  --for <checks>    Comma-separated check names (e.g.
                    overlap,offscreen,overflow,tap-targets,contrast,
                    hit-test,truncation) or a category
                    (geometry|content|targetability|forms|animation|all).
                    Omit for every check.
  --viewport <WxH>  Viewport to check at (repeatable, for a discrete
                    multi-viewport sweep)
  --gate            Exit 2 if any check finds something (default: exit 0)

Not yet implemented.`;

export async function cmdMeasureCheck(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'measure check', status: 'not_implemented' },
    summary: fact`\`measure check\` is not implemented yet.`,
  };
  emitResult(result, { json: parsed.json });
  process.exit(1);
}
