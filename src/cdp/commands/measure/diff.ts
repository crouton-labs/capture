import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, type RenderableResult } from '../../../output/render.js';

const USAGE = `Usage: capture measure diff --before <snap> --after <snap> [--pixels] [--full] [--gate]

Structured before/after diff over two snapshots: style/geometry/text/form/
media deltas, cascade provenance, and reflow attribution. No positional
target — both snapshots must already exist.

Options:
  --before <snap>   Earlier snapshot id/path (required)
  --after <snap>    Later snapshot id/path (required)
  --pixels          Also report raster regions not explained by geometry
  --full            Expand to state-matrix deltas and complete per-element
                     change records
  --gate            Exit 2 if any element changed (default: exit 0)

Not yet implemented.`;

export async function cmdMeasureDiff(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'measure diff', status: 'not_implemented' },
    summary: fact`\`measure diff\` is not implemented yet.`,
  };
  emitResult(result, { json: parsed.json });
  process.exit(1);
}
