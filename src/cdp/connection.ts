import * as fs from 'fs';
import { CDPClient } from './client.js';
import { findTabByIdAcrossEndpoints, findTabByUrlAcrossEndpoints } from './targets.js';
import { type CDPTarget, type ParsedArgs } from './types.js';
import { ConsoleRecorder, printConsoleSummary } from './console-recorder.js';
import { HARRecorder } from './har-recorder.js';
import {
  harFilePath,
  appendToHarRecording as appendToHar,
} from '../har-manager.js';
import { getActiveSession, updateActiveSession, type ActiveSessionState } from '../session-context.js';
import { RecorderHeldClient, isRecorderHeldClient } from './recorder-client.js';
import { recDirFor, readRecorderJson } from './motion/recorder.js';

function getPortFromWebSocketDebuggerUrl(url?: string): number | null {
  if (!url) return null;
  try {
    return Number(new URL(url).port);
  } catch {
    return null;
  }
}

/**
 * CDP network emulation belongs to a connection. Reissue the active
 * session's requested state whenever a command opens a fresh connection to
 * that session's target so `network offline` remains true until `online`.
 */
export async function applyActiveSessionNetworkConditions(
  client: Pick<CDPClient, 'send'>,
  session: ActiveSessionState | null,
  targetId: string,
): Promise<void> {
  if (!session || session.targetId !== targetId || session.networkOffline === undefined) return;
  const offline = session.networkOffline;
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline,
    latency: offline ? -1 : 0,
    downloadThroughput: offline ? 0 : -1,
    uploadThroughput: offline ? 0 : -1,
  });
}

/**
 * Builds a short, human-readable label for this command invocation, used to
 * tag every marked (`Input.dispatch*`) CDP call the recorder-held adapter
 * makes on its behalf — e.g. `click:Send`, `type:another message`,
 * `navigate:https://...` — matching the design's "labeled input landmark"
 * shape in `events.jsonl`. Derived generically from the command name plus
 * its primary target rather than per-leaf, so this stays a `connection.ts`
 * concern instead of every intervening command having to supply one.
 */
function deriveActionLabel(parsed: ParsedArgs): string {
  // `type`'s positional[0] is the raw text being typed (often a password,
  // token, or other secret) — it must never flow into the mark label, which
  // lands verbatim in events.jsonl as a host-side input-landmark record (it
  // no longer ever touches the page — see `../timing.ts`'s
  // `withDocumentPerformanceNow`). Use the --into field name when given (the
  // actual target of the action), otherwise a generic placeholder — never
  // the typed content itself.
  if (parsed.command === 'type') {
    return `type:${parsed.into ?? 'focused element'}`;
  }
  const target = parsed.positional[0] ?? parsed.into ?? parsed.url ?? '';
  return target ? `${parsed.command}:${target}` : parsed.command;
}

/**
 * Routes a command's connection through an ACTIVE composed recording
 * (`motion rec --start` ... `--stop`) instead of opening a fresh tab
 * websocket — the "session-tab commands route through the recorder's held
 * socket" mechanism the design calls for. Returns `null` (falling back to
 * the plain path below) when there is no active recording, an explicit
 * `--url` names a different (parallel) tab, an explicit `--target` names a
 * tab other than the recorder's own, or the recorder's live-state handle
 * (`recorder.json`) is missing/not currently `recording` (already reaped or
 * mid-teardown — fall back rather than fail the whole command).
 */
function connectToActiveRecorder(
  session: ActiveSessionState,
  parsed: ParsedArgs,
): { client: CDPClient; tab: CDPTarget } | null {
  const recId = session.activeRecId;
  if (!recId) return null;
  if (parsed.url) return null;
  if (parsed.target && parsed.target !== session.targetId) return null;

  const recDir = recDirFor(session.dir, recId);
  const rj = readRecorderJson(recDir);
  if (!rj || rj.state !== 'recording') return null;

  const actionLabel = deriveActionLabel(parsed);
  const client = new RecorderHeldClient({ socketPath: rj.socketPath, actionLabel });
  const tab: CDPTarget = {
    id: rj.targetId,
    title: '',
    url: rj.url ?? '',
    type: 'page',
    webSocketDebuggerUrl: undefined,
  };

  console.error(`Routing via active recorder ${recId} (recorder-held tab connection, action "${actionLabel}")`);

  // Documented cast — RecorderHeldClient only ever needs to satisfy the
  // structural send/on/onDisconnect/close surface every command leaf calls;
  // see recorder-client.ts's own header for why this mirrors
  // recorder-bridge.ts's `asCDPClient()`.
  return { client: client as unknown as CDPClient, tab };
}

export async function connectForCommand(
  parsed: ParsedArgs,
): Promise<{ client: CDPClient; tab: CDPTarget }> {
  const activeSession = getActiveSession();
  if (activeSession?.activeRecId) {
    const routed = connectToActiveRecorder(activeSession, parsed);
    if (routed) {
      // The recorder bridge owns its own persistent target connection, so
      // the persisted offline/online state must be reissued here too — the
      // ephemeral connection that ran `network offline` has since closed.
      await applyActiveSessionNetworkConditions(routed.client, activeSession, routed.tab.id);
      return routed;
    }
  }

  if (!parsed.target && !parsed.url) {
    throw new Error('Use --target <tabId> or --url <pattern> to target a tab. Run "capture list" to see available tabs.');
  }

  const resolved = parsed.target
    ? await findTabByIdAcrossEndpoints(parsed.target, parsed.port)
    : await findTabByUrlAcrossEndpoints(parsed.url!, parsed.port);
  const tab = resolved?.tab ?? null;

  if (!tab) {
    const query = parsed.target ?? parsed.url;
    throw new Error(
      `No tab found for ${parsed.target ? 'target' : 'URL pattern'} "${query}". Run "capture list" to see available tabs.`,
    );
  }

  if (!tab.webSocketDebuggerUrl) {
    throw new Error('Tab has no WebSocket debugger URL');
  }

  // Lazy-populate targetId in active session if not yet set
  if (activeSession && !activeSession.targetId) {
    updateActiveSession({ targetId: tab.id });
  }

  const port = resolved?.port ?? getPortFromWebSocketDebuggerUrl(tab.webSocketDebuggerUrl);
  console.error(
    `Using target ${tab.id.slice(0, 8)}${port ? ` on port ${port}` : ''}${tab.url ? ` (${tab.url})` : ''}`,
  );

  const client = new CDPClient(tab.webSocketDebuggerUrl);
  try {
    await client.waitReady();
    await applyActiveSessionNetworkConditions(client, getActiveSession(), tab.id);
    return { client, tab };
  } catch (err) {
    client.close();
    throw err;
  }
}

export async function withConnection<T>(
  parsed: ParsedArgs,
  fn: (client: CDPClient, tab: CDPTarget) => Promise<T>,
  opts: { settle?: number } = {},
): Promise<T> {
  const { client, tab } = await connectForCommand(parsed);
  const routed = isRecorderHeldClient(client);

  let consoleRecorder: ConsoleRecorder | undefined;
  if (!routed) {
    consoleRecorder = new ConsoleRecorder(client);
    await consoleRecorder.start();
  }

  let harRecorder: HARRecorder | undefined;
  if (parsed.har && !routed) {
    // Validate HAR ID exists before starting recording
    const harPath = harFilePath(parsed.har);
    if (!fs.existsSync(harPath)) {
      console.error(
        `ERROR: No HAR recording found for --har "${parsed.har}". Run 'har create' first.`,
      );
      process.exit(1);
    }
    harRecorder = new HARRecorder(client);
    await harRecorder.start();
  }

  if (routed) {
    console.error(
      '  [recorder] console/HAR live capture skipped while routed through the active recording \u2014 see events.jsonl for the equivalent record.',
    );
  }

  try {
    const result = await fn(client, tab);

    // Wait for network activity triggered by the action, then append to HAR
    if (harRecorder && parsed.har) {
      const settle = opts.settle !== undefined ? opts.settle : 3000;
      if (settle > 0) {
        await new Promise((r) => setTimeout(r, settle));
      }
      const har = await harRecorder.finish();
      if (har.log.entries.length > 0) {
        appendToHar(parsed.har, har.log.entries);
        console.error(
          `  [har:${parsed.har}] +${har.log.entries.length} entries`,
        );
      }
    }

    if (consoleRecorder) {
      printConsoleSummary(consoleRecorder.finish());
    }

    return result;
  } finally {
    client.close();
  }
}
