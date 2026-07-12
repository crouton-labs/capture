/**
 * `capture tab reset <url> [--port <port>]` — abandon a stuck/unresponsive
 * tab by opening a fresh one at the URL, and repoint the active session's
 * target at it so subsequent session-targeted commands drive the new tab.
 * Emits a `<tab-reset>` block; page-derived strings flow through `data()`
 * (I-9), and "no active session to update" is stated as a fact rather than
 * silently skipped (I-5).
 */
import { detectCdpPort } from '../../detect.js';
import { openTab } from '../../targets.js';
import { CDPClient } from '../../client.js';
import { updateActiveSession } from '../../../session-context.js';
import { type CDPTarget, type ParsedArgs } from '../../types.js';
import {
  data,
  emitResult,
  fact,
  line,
  text,
  type RenderableResult,
} from '../../../output/render.js';

const USAGE = `capture tab reset — abandon a stuck tab and open a fresh one at the URL.

input:
  <url>           required — the URL the fresh tab opens at
  --port <port>   CDP endpoint (default: the auto-discovered preferred endpoint)

output: <tab-reset port=… target=…> — the fresh tab's target id and url, plus whether the active session's target was repointed at it.
effects: opens a new background browser tab (the old tab is left behind, not closed), waits up to 10s for its load event, and updates the active session's target when a session is active.`;

/** Pure `<tab-reset>` result builder — exported for tests. */
export function buildTabResetResult(
  tab: CDPTarget,
  port: number,
  sessionUpdated: boolean,
): RenderableResult {
  return {
    tag: 'tab-reset',
    attrs: { port, target: tab.id },
    summary: line(text`fresh tab `, data(tab.id.slice(0, 8)), text` opened at `, data(tab.url, 300), text`.`),
    sections: [
      sessionUpdated
        ? text`active session target updated: session-targeted commands now drive the fresh tab.`
        : text`no active session; no session target to update.`,
    ],
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function cmdTabReset(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  const url = parsed.positional[0];
  if (!url) {
    emitResult(
      {
        tag: 'error',
        attrs: { command: 'tab reset', code: 'missing_argument' },
        summary: text`received: no URL; expected: capture tab reset <url> [--port <port>].`,
      },
      { json: parsed.json },
    );
    process.exit(1);
  }

  let port: number;
  try {
    port = parsed.port ?? (await detectCdpPort());
  } catch {
    emitResult(
      {
        tag: 'error',
        attrs: { command: 'tab reset', code: 'no_cdp_endpoint' },
        summary: text`received: no --port, and no CDP endpoint was discovered on localhost; expected: a running CDP-enabled browser (or an explicit --port <port>).`,
        followUp: text`capture tab list probes every localhost CDP endpoint.`,
      },
      { json: parsed.json },
    );
    process.exit(1);
  }

  let tab: CDPTarget;
  try {
    tab = await openTab(port, url);
  } catch (err) {
    emitResult(
      {
        tag: 'error',
        attrs: { command: 'tab reset', code: 'open_failed', port },
        summary: fact`received: \`${url}\`; opening a fresh tab on port ${port} failed: ${errorMessage(err)}`,
      },
      { json: parsed.json },
    );
    process.exit(1);
  }

  // Wait (bounded) for the fresh tab's load event before repointing anything
  // at it — same 10s tolerance the old reset-tab path used.
  if (tab.webSocketDebuggerUrl) {
    const client = new CDPClient(tab.webSocketDebuggerUrl);
    await client.waitReady();
    await client.send('Page.enable');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 10000);
      client.on('Page.loadEventFired', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    client.close();
  }

  const sessionUpdated = updateActiveSession({ targetId: tab.id }) !== null;

  emitResult(buildTabResetResult(tab, port, sessionUpdated), { json: parsed.json });
}
