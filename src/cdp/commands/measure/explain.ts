import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, type RenderableResult } from '../../../output/render.js';

const USAGE = `Usage: capture measure explain <snap> --selector <sel> [--size] [--text] [--form]

Per-element cascade/stacking/clipping explanation over one snapshot, plus
optional detail sections.

Options:
  --selector <sel>   Element selector (required)
  --size             Include size/layout provenance (flex/grid/intrinsic)
  --text             Include text/line-box/wrap detail
  --form             Include form/caret/selection/autofill detail (redacted)

With no detail flag, returns the standard compact element explanation.

Not yet implemented.`;

export async function cmdMeasureExplain(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'measure explain', status: 'not_implemented' },
    summary: fact`\`measure explain\` is not implemented yet.`,
  };
  emitResult(result, { json: parsed.json });
  process.exit(1);
}
