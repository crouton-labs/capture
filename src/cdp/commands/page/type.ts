/**
 * `page type <text> [--into <target>]` — type agent-supplied text into the
 * focused element, or into exactly one live-resolved field (design D3).
 *
 * The block echoes only the agent-supplied text (I-7); the screenshot label
 * and any recorder landmark never carry the typed content (it may be a
 * secret) — they identify the FIELD instead, matching `connection.ts`'s
 * `deriveActionLabel` posture.
 */
import { type ParsedArgs } from '../../types.js';
import {
  resolveLiveTarget,
  typeText,
  focusAndType,
  type LiveClient,
  type ClickDispatch,
} from '../../../interact.js';
import { emitResult, fact, lineList, type FactLine } from '../../../output/render.js';
import {
  pageInputDeps,
  effectiveSettle,
  emitInvalidInput,
  emitResolutionError,
} from './click.js';

const USAGE = `capture page type <text> [--into <target>] — type text into the focused element or one resolved field

input:
  <text>            the text to insert (agent-supplied; echoed back in the result block)
  --into <target>   focus this field first — resolved against the LIVE page: bare CSS selector, ax:<name> (case-insensitive substring), axid:<id>, backend:<id>; text: is not accepted; exactly one match required
  --settle <ms>     network-settle window applied after typing (default: 500; 1500 with an active session; 0 disables)
  --no-screenshot   skip the auto-screenshot
output:
  <typed> — the typed text, the resolved field identity (backend-node-id, role, name) and focus-click coordinates when --into was given, settle applied, screenshot artifact path; --json mirrors the same fields
effects:
  dispatches a real focus click (when --into) followed by real text insertion; writes one screenshot into the active session's shots/ sequence unless --no-screenshot`;

export async function cmdPageType(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  const textArg = parsed.positional[0];
  if (textArg === undefined || parsed.positional.length !== 1) {
    return emitInvalidInput(
      parsed,
      'page type',
      fact`received: ${parsed.positional.length} positional arguments; expected exactly one — the text to type (use --into <target> to focus a field first).`,
    );
  }

  const deps = pageInputDeps();
  const settle = effectiveSettle(parsed, { standalone: 500, session: 1500 });
  // connection.ts derives the recorder landmark label from parsed.command —
  // restoring the verb here is what engages deriveActionLabel's type-guard,
  // so a routed type's landmark is `type:<field>` and NEVER the typed text
  // (positional[0], which the generic label branch would otherwise use).
  const outcome = await deps.withConnection(
    { ...parsed, command: 'type' },
    async (client) => {
      const live = client as unknown as LiveClient;
      let dispatch: ClickDispatch | null = null;
      if (parsed.into) {
        const resolved = await resolveLiveTarget(live, parsed.into);
        if (!resolved.ok) return { failure: resolved } as const;
        dispatch = await focusAndType(live, resolved, textArg);
      } else {
        await typeText(live, textArg);
      }
      // Screenshot label identifies the field, never the typed content.
      const screenshot = await deps.autoScreenshot(client, 'type', parsed.into ?? 'focused element', parsed.noScreenshot);
      return { dispatch, screenshot } as const;
    },
    { settle },
  );

  if ('failure' in outcome) {
    return emitResolutionError(parsed, 'page type', outcome.failure);
  }

  const { dispatch, screenshot } = outcome;
  const rows: FactLine[] = [
    dispatch
      ? fact`typed "${textArg}" into ${dispatch.role ?? 'unknown'} "${dispatch.name ?? ''}" (backend:${dispatch.backendNodeId}), focus click at x=${dispatch.x} y=${dispatch.y}`
      : fact`typed "${textArg}" into the focused element`,
    fact`settle: ${settle}ms`,
  ];
  if (screenshot) rows.push(fact`screenshot: ${screenshot}`);

  emitResult(
    {
      tag: 'typed',
      attrs: dispatch
        ? {
            'backend-node-id': dispatch.backendNodeId,
            role: dispatch.role ?? undefined,
            name: dispatch.name ?? undefined,
          }
        : {},
      summary: lineList(rows),
    },
    { json: parsed.json },
  );
}
