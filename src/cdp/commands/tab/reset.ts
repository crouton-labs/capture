/**
 * `capture tab reset <url> [--port <port>]` — abandon a stuck/unresponsive
 * tab by opening a fresh one at the URL, and repoint the active session's
 * target at it so subsequent session-targeted commands drive the new tab.
 *
 * Under an active session this is a session-lifecycle transition: it admits
 * as a session operation, runs under the session's `.lifecycle.lock`, and
 * REFUSES while a recording is live (a recorder is bound to the old target;
 * reset never rebinds a live recorder). Reset only clears a dangling recorder
 * pointer; dead recorders are left for the next stop/start to finalize (their
 * frames are preserved). The session's `{targetId, port}` pair is published
 * atomically under the lock.
 *
 * Emits a `<tab-reset>` block; page-derived strings flow through `data()`
 * (I-9), and "no active session to update" is stated as a fact rather than
 * silently skipped (I-5).
 */
import { detectCdpPort } from '../../detect.js';
import { openTab } from '../../targets.js';
import { CDPClient } from '../../client.js';
import { getActiveSession, updateSessionState } from '../../../session-context.js';
import {
  admitSessionOperation,
  withSessionLifecycle,
  withSessionScopeLifecycle,
  scanRecorderHandles,
  clearDanglingRecorderPointer,
  type LifecycleSeams,
} from '../../../session/coordinator.js';
import { captureError, invalidInput } from '../../../errors.js';
import { type CDPTarget, type ParsedArgs } from '../../types.js';
import {
  data,
  emitResult,
  line,
  text,
  type RenderableResult,
} from '../../../output/render.js';

const USAGE = `capture tab reset — abandon a stuck tab and open a fresh one at the URL.

input:
  <url>           required — the URL the fresh tab opens at
  --port <port>   CDP endpoint (default: the active session's port, else the auto-discovered preferred endpoint)

output: <tab-reset port=… target=…> — the fresh tab's target id and url, plus whether the active session's target was repointed at it.
effects: opens a new background browser tab (the old tab is left behind, not closed) and waits up to 10s for its load event. Under an active session it refuses while a recording is live (stop it first: \`capture motion rec --stop\`), clears a dangling recorder pointer (dead recorders are left for the next stop/start to finalize; their frames are preserved), and updates the session's {target, port} pair together.`;

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

interface TabResetDeps {
  openTab: typeof openTab;
  detectCdpPort: typeof detectCdpPort;
  createClient: (webSocketDebuggerUrl: string) => CDPClient;
  lifecycle: LifecycleSeams;
}

let deps: TabResetDeps = {
  openTab,
  detectCdpPort,
  createClient: (webSocketDebuggerUrl) => new CDPClient(webSocketDebuggerUrl),
  lifecycle: {},
};

export function __setTabResetDepsForTest(overrides: Partial<TabResetDeps>): () => void {
  const previous = deps;
  deps = { ...deps, ...overrides };
  return () => { deps = previous; };
}

async function openTabOrThrow(port: number, url: string): Promise<CDPTarget> {
  try {
    return await deps.openTab(port, url);
  } catch (err) {
    throw captureError('world', 'open_failed', `received: \`${url}\`; opening a fresh tab on port ${port} failed: ${errorMessage(err)}`);
  }
}

/** Wait (bounded, 10s) for the fresh tab's load event before repointing anything at it. */
async function boundedLoadWait(tab: CDPTarget): Promise<void> {
  if (!tab.webSocketDebuggerUrl) return;
  const client = deps.createClient(tab.webSocketDebuggerUrl);
  try {
    await client.waitReady();
    await client.send('Page.enable');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 10000);
      client.on('Page.loadEventFired', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  } finally {
    client.close();
  }
}

export async function cmdTabReset(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  const url = parsed.positional[0];
  if (!url) throw invalidInput('received: no URL; expected: capture tab reset <url> [--port <port>].', 'missing_argument');

  return withSessionScopeLifecycle(async () => {
    const session = getActiveSession();
    if (!session) {
      let port: number;
      try {
        port = parsed.port ?? (await deps.detectCdpPort());
      } catch {
        throw captureError('world', 'no_cdp_endpoint', 'received: no --port, and no CDP endpoint was discovered on localhost; expected: a running CDP-enabled browser (or an explicit --port <port>).');
      }
      const tab = await openTabOrThrow(port, url);
      await boundedLoadWait(tab);
      emitResult(buildTabResetResult(tab, port, false), { json: parsed.json });
      return;
    }

    const op = await admitSessionOperation(session.dir);
    try {
      const result = await withSessionLifecycle(session.dir, async () => {
        const fresh = getActiveSession();
        if (!fresh || fresh.dir !== session.dir) throw captureError('precondition', 'session_unavailable', 'The active capture session is no longer available.');
        const scan = scanRecorderHandles(session.dir, deps.lifecycle);
        if (scan.some(h => h.classification === 'unknown')) throw captureError('world', 'recorder_liveness_unknown', 'Cannot determine recorder liveness; refusing to reset.');
        if (scan.some(h => h.classification === 'malformed')) throw captureError('precondition', 'recorder_unavailable', 'A malformed recorder handle exists on this session; resolve it before resetting.');
        if (scan.some(h => h.classification === 'live')) throw captureError('precondition', 'recorder_active', 'A recording is active on this session; stop it first: `capture motion rec --stop`. Reset never rebinds a live recorder.');
        await clearDanglingRecorderPointer(session.dir, scan);
        const port = fresh.port ?? parsed.port ?? (await deps.detectCdpPort());
        const tab = await openTabOrThrow(port, url);
        await boundedLoadWait(tab);
        await updateSessionState(session.dir, { targetId: tab.id, port });
        return buildTabResetResult(tab, port, true);
      }, deps.lifecycle);
      emitResult(result, { json: parsed.json });
    } finally {
      await op.release();
    }
  });
}
