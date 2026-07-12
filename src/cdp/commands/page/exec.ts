/** Routing stub for `page exec` — emits a structured not_implemented
 * error so the branch routing is testable before the real leaf is ported. */
import { type ParsedArgs } from '../../types.js';
import { emitResult, text } from '../../../output/render.js';

export async function cmdPageExec(parsed: ParsedArgs, _args: string[]): Promise<void> {
  emitResult(
    {
      tag: 'error',
      attrs: { command: 'page exec', code: 'not_implemented' },
      summary: text`received: \`page exec\`; this leaf is routed but not yet implemented.`,
    },
    { json: parsed.json },
  );
  process.exit(1);
}
