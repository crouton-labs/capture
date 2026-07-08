import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, type RenderableResult } from '../../../output/render.js';

const USAGE = `Usage: capture measure snap [url|snap] [--freeze-animations] [--settle-timeout <ms>] [--capture-unsettled] [--pixels] [--state <state[:selector]>]... [--viewport <WxH>]...

Drive the page (or re-capture states over a base snapshot) and write one
settled snapshot substrate directory: geometry, styles, hit-test, text,
forms, animation, ax, queries, focus, scroll, layers, and (with --pixels)
per-element crops. Every other measure/motion query leaf reads this
artifact instead of re-driving the browser.

Options:
  --freeze-animations         Pause CSS/WAAPI animation before capture
  --settle-timeout <ms>       Override the default 5000ms settle wait
  --capture-unsettled         Write full substrate despite non-settlement,
                               marking unstable regions
  --pixels                    Also write per-element raster crops
  --state <state[:selector]>  Force a pseudo-state or real control state
                               (repeatable)
  --viewport <WxH>            Viewport to snap at (repeatable)

Not yet implemented.`;

export async function cmdMeasureSnap(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'measure snap', status: 'not_implemented' },
    summary: fact`\`measure snap\` is not implemented yet.`,
  };
  emitResult(result, { json: parsed.json });
  process.exit(1);
}
