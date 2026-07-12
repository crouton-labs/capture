/**
 * `page scroll <target> --to <top|bottom|px>` — scroll exactly one
 * live-resolved container to a destination (design D3).
 *
 * Drives through `interact.ts`'s shared `scrollResolved` helper, passing a
 * landmark label so a recorder-routed scroll's one mutating call
 * (`Runtime.callFunctionOn`) lands the same labeled input landmark
 * `motion rec --do scroll:` records.
 */
import { type ParsedArgs } from '../../types.js';
import { resolveLiveTarget, scrollResolved, type LiveClient } from '../../../interact.js';
import { emitResult, fact, lineList, type FactLine } from '../../../output/render.js';
import {
  pageInputDeps,
  effectiveSettle,
  emitInvalidInput,
  emitResolutionError,
} from './click.js';

const USAGE = `capture page scroll <target> --to <top|bottom|px> — scroll one resolved container to a position

input:
  <target>          resolved against the LIVE page: bare CSS selector, ax:<name> (case-insensitive substring), axid:<id>, backend:<id>; text: is not accepted; exactly one match required — zero or many matches is a structured error listing candidates
  --to <dest>       required destination: top, bottom, or a pixel offset (scrollTop value)
  --settle <ms>     network-settle window applied after the scroll (default: 1000; 2500 with an active session; 0 disables)
  --no-screenshot   skip the auto-screenshot
output:
  <scrolled backend-node-id=… role=… name=…> — resolved identity, destination, the container's resulting scrollTop, settle applied, screenshot artifact path; --json mirrors the same fields
effects:
  assigns the container's scrollTop in-page (may trigger lazy-load network); writes one screenshot into the active session's shots/ sequence unless --no-screenshot`;

function isValidDestination(to: string): boolean {
  return to === 'top' || to === 'bottom' || Number.isFinite(Number(to));
}

export async function cmdPageScroll(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  const target = parsed.positional[0];
  if (!target || parsed.positional.length !== 1) {
    return emitInvalidInput(
      parsed,
      'page scroll',
      fact`received: ${parsed.positional.length} positional arguments; expected exactly one target (CSS selector, ax:<name>, axid:<id>, or backend:<id>) plus --to <top|bottom|px>.`,
    );
  }
  if (parsed.to === undefined) {
    return emitInvalidInput(
      parsed,
      'page scroll',
      fact`received: no --to destination; expected --to <top|bottom|px>.`,
    );
  }
  const to = parsed.to;
  if (!isValidDestination(to)) {
    return emitInvalidInput(
      parsed,
      'page scroll',
      fact`received: --to \`${to}\`; expected top, bottom, or a pixel offset.`,
    );
  }

  const deps = pageInputDeps();
  const settle = effectiveSettle(parsed, { standalone: 1000, session: 2500 });
  const outcome = await deps.withConnection(
    parsed,
    async (client) => {
      const live = client as unknown as LiveClient;
      const resolved = await resolveLiveTarget(live, target);
      if (!resolved.ok) return { failure: resolved } as const;
      // Same landmark shape `motion rec --do scroll:` records; carried by
      // the one mutating call when the transport records landmarks.
      const dispatch = await scrollResolved(live, resolved, to, { mark: `scroll:${target},to=${to}` });
      const screenshot = await deps.autoScreenshot(client, 'scroll', target, parsed.noScreenshot);
      return { dispatch, screenshot } as const;
    },
    { settle },
  );

  if ('failure' in outcome) {
    return emitResolutionError(parsed, 'page scroll', outcome.failure);
  }

  const { dispatch, screenshot } = outcome;
  const rows: FactLine[] = [
    fact`scrolled ${dispatch.role ?? 'unknown'} "${dispatch.name ?? ''}" (backend:${dispatch.backendNodeId}) to ${dispatch.to} — scrollTop now ${dispatch.scrollTop}`,
    fact`settle: ${settle}ms`,
  ];
  if (screenshot) rows.push(fact`screenshot: ${screenshot}`);

  emitResult(
    {
      tag: 'scrolled',
      attrs: {
        'backend-node-id': dispatch.backendNodeId,
        role: dispatch.role ?? undefined,
        name: dispatch.name ?? undefined,
        to: dispatch.to,
        'scroll-top': dispatch.scrollTop,
      },
      summary: lineList(rows),
    },
    { json: parsed.json },
  );
}
