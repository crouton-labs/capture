/**
 * `page click <target>` — dispatch one real click on exactly one live-resolved
 * element (design D3).
 *
 * This file also owns the small substrate the three input-dispatching page
 * verbs (`click`, `type`, `scroll`) share: the test-injectable dependency
 * seam, the active-session-keyed settle defaults (Resolved 2), and the
 * structured rendering of `resolveLiveTarget` failures (candidate list +
 * `backend:<id>` recovery, `text:` prefix rejection). `type.ts` and
 * `scroll.ts` import these rather than duplicating them.
 */
import { type ParsedArgs } from '../../types.js';
import { withConnection } from '../../connection.js';
import { autoScreenshot } from '../../screenshot.js';
import { getActiveSession } from '../../../session-context.js';
import {
  resolveLiveTarget,
  clickResolved,
  type LiveClient,
  type ResolutionFailure,
} from '../../../interact.js';
import {
  emitResult,
  fact,
  line,
  lineList,
  text,
  data,
  type FactLine,
} from '../../../output/render.js';

// ---------------------------------------------------------------------------
// Shared substrate for the three input-dispatching page verbs
// ---------------------------------------------------------------------------

export interface PageInputDeps {
  withConnection: typeof withConnection;
  getActiveSession: typeof getActiveSession;
  autoScreenshot: typeof autoScreenshot;
}

let deps: PageInputDeps = { withConnection, getActiveSession, autoScreenshot };

/** Swap the connection/session/screenshot seams for the CDP-stub tests. */
export function __setPageInputDepsForTest(overrides: Partial<PageInputDeps>): () => void {
  const previous = deps;
  deps = { ...deps, ...overrides };
  return () => { deps = previous; };
}

export function pageInputDeps(): PageInputDeps {
  return deps;
}

/**
 * The verb's settle window: `--settle <ms>` (including 0) wins outright;
 * otherwise the default is keyed off active-session presence (the in-session
 * bump exists so the session HAR captures the network the action triggers).
 */
export function effectiveSettle(
  parsed: ParsedArgs,
  defaults: { standalone: number; session: number },
): number {
  if (parsed.settle !== undefined) return parsed.settle;
  return deps.getActiveSession() !== null ? defaults.session : defaults.standalone;
}

/** Structured `<error>` for a plain invalid-invocation case (exit 1). */
export function emitInvalidInput(parsed: ParsedArgs, command: string, summary: FactLine, followUp?: FactLine): void {
  emitResult(
    { tag: 'error', attrs: { command, code: 'invalid_input' }, summary, followUp },
    { json: parsed.json },
  );
  process.exitCode = 1;
}

/**
 * Structured `<error>` for a live-resolution failure (exit 1): zero/many
 * matches carry the candidate list (role, name, `backend:<id>`) as the
 * recovery payload; a `text:` target names the accepted prefixes.
 */
export function emitResolutionError(parsed: ParsedArgs, command: string, failure: ResolutionFailure): void {
  if (failure.code === 'unsupported-prefix') {
    emitResult(
      {
        tag: 'error',
        attrs: { command, code: 'unsupported_prefix' },
        summary: fact`received: target \`${failure.input}\` — the \`text:\` prefix is not accepted by live driving verbs; expected one of: bare CSS selector, ax:<name>, axid:<id>, backend:<id>.`,
        followUp: fact`Retry \`${command}\` with \`ax:<name>\` (accessible-name substring) or a CSS selector; \`text:\` matching exists only on the query leaves.`,
      },
      { json: parsed.json },
    );
    process.exitCode = 1;
    return;
  }

  const code = failure.code === 'no-match' ? 'no_match' : 'ambiguous_target';
  const candidateRows: FactLine[] = failure.candidates.map((c) =>
    line(data(c.role ?? 'unknown'), text` "`, data(c.name ?? ''), text`" — backend:`, data(c.backendNodeId)),
  );
  const sections: FactLine[] = [];
  if (candidateRows.length > 0) {
    const shown =
      failure.matchCount > failure.candidates.length
        ? fact`candidates (first ${failure.candidates.length} of ${failure.matchCount}):`
        : text`candidates:`;
    sections.push(lineList([shown, ...candidateRows]));
  }
  emitResult(
    {
      tag: 'error',
      attrs: { command, code },
      summary: fact`received: target \`${failure.input}\` matched ${failure.matchCount} live elements; expected exactly one.`,
      sections,
      followUp:
        failure.code === 'no-match'
          ? text`Run \`capture page elements\` to list live targets with their backend:<id> keys.`
          : fact`Retry \`${command}\` with \`backend:<id>\` from the candidate list.`,
    },
    { json: parsed.json },
  );
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// page click
// ---------------------------------------------------------------------------

const USAGE = `capture page click <target> — dispatch one real click on exactly one resolved element

input:
  <target>          resolved against the LIVE page: bare CSS selector, ax:<name> (case-insensitive substring over accessible names), axid:<id>, backend:<id>. text: is not accepted. Exactly one match required — zero or many matches is a structured error listing candidates with backend:<id> retry keys.
  --settle <ms>     network-settle window applied after the click (default: 1000; 2500 with an active session; 0 disables)
  --no-screenshot   skip the auto-screenshot
output:
  <clicked backend-node-id=… role=… name=…> — resolved identity, dispatched coordinates, settle applied, screenshot artifact path; --json mirrors the same fields
effects:
  scrolls the target into view, then dispatches a real mouse press/release at its center; writes one screenshot into the active session's shots/ sequence unless --no-screenshot`;

export async function cmdPageClick(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  const target = parsed.positional[0];
  if (!target || parsed.positional.length !== 1) {
    return emitInvalidInput(
      parsed,
      'page click',
      fact`received: ${parsed.positional.length} positional arguments; expected exactly one target (CSS selector, ax:<name>, axid:<id>, or backend:<id>).`,
    );
  }

  const settle = effectiveSettle(parsed, { standalone: 1000, session: 2500 });
  // connection.ts derives the recorder landmark label from parsed.command,
  // which the router leaves as the branch token 'page' — restore the verb so
  // a routed click's landmark stays `click:<target>`.
  const outcome = await deps.withConnection(
    { ...parsed, command: 'click' },
    async (client) => {
      const live = client as unknown as LiveClient;
      const resolved = await resolveLiveTarget(live, target);
      if (!resolved.ok) return { failure: resolved } as const;
      const dispatch = await clickResolved(live, resolved);
      const screenshot = await deps.autoScreenshot(client, 'click', target, parsed.noScreenshot);
      return { dispatch, screenshot } as const;
    },
    { settle },
  );

  if ('failure' in outcome) {
    return emitResolutionError(parsed, 'page click', outcome.failure);
  }

  const { dispatch, screenshot } = outcome;
  const rows: FactLine[] = [
    fact`clicked ${dispatch.role ?? 'unknown'} "${dispatch.name ?? ''}" (backend:${dispatch.backendNodeId}) at x=${dispatch.x} y=${dispatch.y}`,
    fact`settle: ${settle}ms`,
  ];
  if (screenshot) rows.push(fact`screenshot: ${screenshot}`);

  emitResult(
    {
      tag: 'clicked',
      attrs: {
        'backend-node-id': dispatch.backendNodeId,
        role: dispatch.role ?? undefined,
        name: dispatch.name ?? undefined,
      },
      summary: lineList(rows),
    },
    { json: parsed.json },
  );
}
