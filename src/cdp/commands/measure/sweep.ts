import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, type RenderableResult } from '../../../output/render.js';

const USAGE = `Usage: capture measure sweep [url] --axis <axis> [--from <val>] [--to <val>] [--viewport-height <val>]

Responsive/environment sampling: repeated snap captures across an axis
(width, dpr, zoom, color-scheme, reduced-motion, ...), binary-searched to
find transition points and piecewise-stable ranges.

Options:
  --axis <axis>             The sampled axis (default: width)
  --from <val>              Range start (axis-dependent: width px, dpr, zoom, ...)
  --to <val>                Range end (axis-dependent)
  --viewport-height <val>   Fixed viewport height while sweeping width/dpr/zoom

Not yet implemented.`;

export async function cmdMeasureSweep(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'measure sweep', status: 'not_implemented' },
    summary: fact`\`measure sweep\` is not implemented yet.`,
  };
  emitResult(result, { json: parsed.json });
  process.exit(1);
}
