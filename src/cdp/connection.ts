import * as fs from 'fs';
import { performance } from 'node:perf_hooks';
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
import { captureError } from '../errors.js';

function getPortFromWebSocketDebuggerUrl(url?: string): number | null {
  if (!url) return null;
  try {
    return Number(new URL(url).port);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Injectable seams — the external effects `connectForCommand`/`withConnection`/
// `withPageAction` depend on, gathered into one module-level object so the
// deterministic tests (`test/connection-settle-har.test.ts`) can drive the
// full lifecycle against fake clocks, a spy metadata writer, and a stub CDP
// client without any wall-time waits or real sockets. Production uses the
// defaults; only tests call `__setConnectionSeamsForTest`.
// ---------------------------------------------------------------------------

export interface ConnectionSeams {
  getActiveSession: () => ActiveSessionState | null;
  updateActiveSession: (patch: Partial<ActiveSessionState>) => Promise<ActiveSessionState | null>;
  resolveTab: (parsed: ParsedArgs) => Promise<{ port: number; tab: CDPTarget } | null>;
  createClient: (wsUrl: string) => CDPClient;
  appendHar: typeof appendToHar;
  /** Monotonic clock (ms) — measured settle facts derive from it, never from wall time. */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

function defaultResolveTab(parsed: ParsedArgs): Promise<{ port: number; tab: CDPTarget } | null> {
  return parsed.target
    ? findTabByIdAcrossEndpoints(parsed.target, parsed.port)
    : findTabByUrlAcrossEndpoints(parsed.url!, parsed.port);
}

let seams: ConnectionSeams = {
  getActiveSession: () => getActiveSession(),
  updateActiveSession,
  resolveTab: defaultResolveTab,
  createClient: (wsUrl) => new CDPClient(wsUrl),
  appendHar: appendToHar,
  now: () => performance.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export function __setConnectionSeamsForTest(overrides: Partial<ConnectionSeams>): () => void {
  const previous = seams;
  seams = { ...seams, ...overrides };
  return () => { seams = previous; };
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
 * Does this command MUST route through the session's active composed
 * recording (`motion rec --start` ... `--stop`)? True when the session has a
 * live recording AND the caller did not explicitly divert to a parallel tab
 * (`--url`) or a distinct target (`--target` naming a tab other than the
 * recorder's own). When true, `connectToActiveRecorder` is authoritative and
 * NEVER falls back to a fresh direct connection — a missing/malformed/
 * wrong-state recorder handle is a structured `recorder_unavailable`, not a
 * silent direct-CDP substitution (A2).
 */
function shouldRouteToRecorder(session: ActiveSessionState, parsed: ParsedArgs): boolean {
  if (!session.activeRecId) return false;
  if (parsed.url) return false;
  if (parsed.target && parsed.target !== session.targetId) return false;
  return true;
}

/**
 * Connects a must-route command through the ACTIVE recording's held socket.
 * The caller (`connectForCommand`) has already decided this command must
 * route (`shouldRouteToRecorder`), so any failure to obtain a usable
 * recorder handle is surfaced as `recorder_unavailable` and the command is
 * refused — it is NEVER answered by a direct CDP connection that would
 * silently escape the recording.
 */
function connectToActiveRecorder(
  session: ActiveSessionState,
  parsed: ParsedArgs,
): { client: CDPClient; tab: CDPTarget } {
  const recId = session.activeRecId!;
  const recDir = recDirFor(session.dir, recId);
  const rj = readRecorderJson(recDir);

  if (!rj) {
    throw captureError(
      'precondition',
      'recorder_unavailable',
      `The active session claims recording "${recId}" but its live-recorder handle (recorder.json) is missing — it was already finalized or reaped. Recover with: capture motion rec --stop.`,
    );
  }
  if (
    typeof rj.socketPath !== 'string' || rj.socketPath.length === 0
    || typeof rj.targetId !== 'string' || rj.targetId.length === 0
    || typeof rj.nonce !== 'string' || !/^[0-9a-f]{64}$/.test(rj.nonce)
  ) {
    throw captureError(
      'precondition',
      'recorder_unavailable',
      `The active session's recorder handle for "${recId}" is malformed (missing or invalid socketPath/targetId/nonce). Recover with: capture motion rec --stop.`,
    );
  }
  if (rj.state !== 'recording') {
    throw captureError(
      'precondition',
      'recorder_unavailable',
      `The active session's recorder "${recId}" is not currently recording (state: ${rj.state}) — it is finalized or mid-teardown. Recover with: capture motion rec --stop.`,
    );
  }

  const actionLabel = deriveActionLabel(parsed);
  const client = new RecorderHeldClient({ socketPath: rj.socketPath, nonce: rj.nonce, actionLabel });
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
  const activeSession = seams.getActiveSession();
  if (activeSession && shouldRouteToRecorder(activeSession, parsed)) {
    const routed = connectToActiveRecorder(activeSession, parsed);
    // The recorder bridge owns its own persistent target connection, so
    // the persisted offline/online state must be reissued here too — the
    // ephemeral connection that ran `network offline` has since closed.
    await applyActiveSessionNetworkConditions(routed.client, activeSession, routed.tab.id);
    return routed;
  }

  if (!parsed.target && !parsed.url) {
    throw new Error('Use --target <tabId> or --url <pattern> to target a tab. Run "capture tab list" to see available tabs.');
  }

  const resolved = await seams.resolveTab(parsed);
  const tab = resolved?.tab ?? null;

  if (!tab) {
    const query = parsed.target ?? parsed.url;
    throw new Error(
      `No tab found for ${parsed.target ? 'target' : 'URL pattern'} "${query}". Run "capture tab list" to see available tabs.`,
    );
  }

  if (!tab.webSocketDebuggerUrl) {
    throw new Error('Tab has no WebSocket debugger URL');
  }

  // Derive the endpoint port once, from the authoritative resolution result
  // (falling back to the debugger URL) — never from ambient env, which
  // endpoint precedence already resolved before this leaf ran.
  const port = resolved?.port ?? getPortFromWebSocketDebuggerUrl(tab.webSocketDebuggerUrl);

  // Lazy target establishment: publish `{targetId, port}` as one atomic pair
  // through U03's metadata helper so a subsequent command finds both together.
  if (activeSession && !activeSession.targetId) {
    await seams.updateActiveSession({ targetId: tab.id, port: port ?? null });
  }

  console.error(
    `Using target ${tab.id.slice(0, 8)}${port ? ` on port ${port}` : ''}${tab.url ? ` (${tab.url})` : ''}`,
  );

  const client = seams.createClient(tab.webSocketDebuggerUrl);
  try {
    await client.waitReady();
    // Reissue the session's persisted offline/online state on this fresh
    // connection — network emulation belongs to a connection, not the tab.
    await applyActiveSessionNetworkConditions(client, seams.getActiveSession(), tab.id);
    return { client, tab };
  } catch (err) {
    client.close();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Shared collector plumbing — the console/local-HAR capture both the
// observational wrapper (`withConnection`) and the action wrapper
// (`withPageAction`) start and finish. Extracted so there is exactly one
// implementation of each concern (no duplicate wrapper logic).
// ---------------------------------------------------------------------------

interface Collectors {
  routed: boolean;
  consoleRecorder?: ConsoleRecorder;
  harRecorder?: HARRecorder;
}

async function startCollectors(parsed: ParsedArgs, client: CDPClient): Promise<Collectors> {
  const routed = isRecorderHeldClient(client);

  let consoleRecorder: ConsoleRecorder | undefined;
  if (!routed) {
    consoleRecorder = new ConsoleRecorder(client);
    await consoleRecorder.start();
  }

  let harRecorder: HARRecorder | undefined;
  if (parsed.har && !routed) {
    // Validate the local HAR recording file exists before starting capture —
    // a missing file is a structured precondition failure the root boundary
    // renders, never a process-wide exit.
    const harPath = harFilePath(parsed.har);
    if (!fs.existsSync(harPath)) {
      throw captureError(
        'precondition',
        'har_missing',
        `The active session's HAR recording file ("${parsed.har}") is missing on disk — traffic cannot be appended.`,
      );
    }
    harRecorder = new HARRecorder(client);
    await harRecorder.start();
  }

  if (routed) {
    console.error(
      '  [recorder] console/HAR live capture skipped while routed through the active recording.',
    );
  }

  return { routed, consoleRecorder, harRecorder };
}

/** Finishes and appends this action's own local HAR, when it owns one. */
async function finishLocalHar(parsed: ParsedArgs, collectors: Collectors): Promise<void> {
  if (!collectors.harRecorder || !parsed.har) return;
  const har = await collectors.harRecorder.finish();
  const batch = { entries: har.log.entries, incompleteLifecycles: har.incompleteLifecycles };
  if (batch.entries.length > 0 || batch.incompleteLifecycles.length > 0) {
    await seams.appendHar(parsed.har, batch);
    console.error(
      `  [har:${parsed.har}] +${batch.entries.length} entries +${batch.incompleteLifecycles.length} incomplete`,
    );
  }
}

function finishConsole(collectors: Collectors): void {
  if (collectors.consoleRecorder) {
    printConsoleSummary(collectors.consoleRecorder.finish());
  }
}

/**
 * Observational connection wrapper — used by the read-only commands
 * (`page elements`/`page shot`, `measure snap`/`sweep`, `tab network`). These
 * never settle on their own account (each passes `{ settle: 0 }`); the only
 * network wait here is the HAR-branch drain when a caller explicitly holds a
 * local HAR recording open across the observation.
 */
export async function withConnection<T>(
  parsed: ParsedArgs,
  fn: (client: CDPClient, tab: CDPTarget) => Promise<T>,
  opts: { settle?: number } = {},
): Promise<T> {
  const { client, tab } = await connectForCommand(parsed);
  const collectors = await startCollectors(parsed, client);

  try {
    const result = await fn(client, tab);

    if (collectors.harRecorder && parsed.har) {
      const settle = opts.settle !== undefined ? opts.settle : 3000;
      if (settle > 0) {
        await new Promise((r) => setTimeout(r, settle));
      }
      await finishLocalHar(parsed, collectors);
    }

    finishConsole(collectors);
    return result;
  } finally {
    client.close();
  }
}

// ---------------------------------------------------------------------------
// Action lifecycle wrapper — the ONE settle/HAR lifecycle, used solely by the
// four mutating page verbs (`click`, `type`, `scroll`, `exec`).
// ---------------------------------------------------------------------------

/** Measured settle provenance returned to the leaf — requested is what the
 * caller asked for, waited is what the injected monotonic clock actually
 * observed elapsing, completed marks that the settle ran to completion. */
export interface SettleFacts {
  requestedMs: number;
  waitedMs: number;
  completed: boolean;
}

/**
 * Runs one mutating page action with its settle/HAR lifecycle. Success
 * ordering is exact and tested: connect → start collectors → action callback
 * → unconditional injected settle → local HAR finish/append (when this action
 * owns local HAR) → console summary → return.
 *
 * The settle is measured, not echoed: `requestedMs` is the caller's window,
 * `waitedMs` is what the injected `now()`/`sleep()` observed. A callback
 * rejection propagates WITHOUT any settle, HAR finish, or settle claim — the
 * action failed, so there is no settle to report. Zero settle skips the sleep
 * but still reports a measured (`0`) wait, keeping the fact ordered and
 * truthful.
 */
export async function withPageAction<T>(
  parsed: ParsedArgs,
  opts: { settleMs: number },
  fn: (client: CDPClient, tab: CDPTarget) => Promise<T>,
): Promise<{ result: T; settle: SettleFacts }> {
  const { client, tab } = await connectForCommand(parsed);
  const collectors = await startCollectors(parsed, client);

  try {
    // Action callback first — a rejection here claims no settle.
    const result = await fn(client, tab);

    // Unconditional, measured settle.
    const requestedMs = opts.settleMs;
    const t0 = seams.now();
    if (requestedMs > 0) {
      await seams.sleep(requestedMs);
    }
    const waitedMs = seams.now() - t0;
    const settle: SettleFacts = { requestedMs, waitedMs, completed: true };

    // Local HAR drain happens AFTER settle so the settle window's traffic is
    // captured (only when this action owns a local HAR recording; a routed
    // action owns none — its traffic lands in the recording's own stream).
    await finishLocalHar(parsed, collectors);
    finishConsole(collectors);

    return { result, settle };
  } finally {
    client.close();
  }
}
