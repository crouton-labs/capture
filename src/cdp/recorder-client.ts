/**
 * Client side of the recorder-bridge protocol (`./bridge/protocol.ts`'s
 * `RecorderRequest`/`RecorderResponse` union) — the counterpart to
 * `./bridge/client.ts`'s `sendBridgeRequest` for the plain held bridge, but
 * typed against the recorder-mode wire shapes instead. Same convention: one
 * Unix-socket connection per request, one response line, then the socket
 * closes.
 *
 * This file also owns `RecorderHeldClient` — the `CDPClient`-compatible
 * adapter `../connection.ts` hands to command leaves when a recording is
 * active on the session's tab (see U14's routing decision there). A leaf
 * that receives one behaves exactly as if it had opened its own tab
 * websocket: `.send()` round-trips a CDP call through the recorder's held
 * connection, `.close()` is a no-op (the recorder owns the connection until
 * `motion rec --stop`, not the leaf command that borrowed it), and
 * `.on()`/`.onDisconnect()` are documented no-ops — the recorder's own event
 * subscriptions (screencast/tracing/observers, see `../recorder-bridge.ts`)
 * are already the authoritative live-event record for an active recording,
 * written incrementally to `events.jsonl`; a routed command's own
 * `ConsoleRecorder`/`HARRecorder` would only ever see zero events through
 * this adapter (nothing pushes unsolicited events back over the
 * one-request-one-response socket), so `../connection.ts`'s `withConnection`
 * skips wiring them entirely when routed, rather than silently reporting an
 * empty console/HAR summary as if it were real.
 */

import * as net from 'net';
import {
  type RecorderRequest,
  type RecorderResponse,
  type RecStartResponseOk,
  type RecStopResponseOk,
} from './bridge/protocol.js';

let reqCounter = 0;

/** Raw one-shot request/response round trip over a recorder bridge's socket. */
export function sendRecorderRequest(
  socketPath: string,
  req: Omit<RecorderRequest, 'reqId'>,
): Promise<RecorderResponse> {
  const timeoutMsField = (req as { timeoutMs?: number }).timeoutMs;
  const wireTimeoutMs = (timeoutMsField ?? 10000) + 5000;

  return new Promise((resolve, reject) => {
    const reqId = ++reqCounter;
    const socket = net.createConnection(socketPath);
    let buffer = '';

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Recorder request timed out after ${wireTimeoutMs}ms (socket: ${socketPath})`));
    }, wireTimeoutMs);

    socket.on('connect', () => {
      socket.write(JSON.stringify({ ...req, reqId } as RecorderRequest) + '\n');
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const idx = buffer.indexOf('\n');
      if (idx < 0) return;
      clearTimeout(timer);
      const line = buffer.slice(0, idx);
      socket.end();
      try {
        resolve(JSON.parse(line) as RecorderResponse);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Arms the recorder (`rec-start`). Throws with the recorder's own error message on failure. */
export async function requestRecStart(socketPath: string): Promise<RecStartResponseOk> {
  const resp = await sendRecorderRequest(socketPath, { type: 'rec-start' });
  if (!resp.ok) throw new Error(`rec-start failed: ${resp.error}`);
  return resp;
}

/** Finalizes the recorder (`rec-stop`). Throws with the recorder's own error message on failure. */
export async function requestRecStop(socketPath: string): Promise<RecStopResponseOk> {
  const resp = await sendRecorderRequest(socketPath, { type: 'rec-stop' });
  if (!resp.ok) throw new Error(`rec-stop failed: ${resp.error}`);
  return resp;
}

/** CDP method names the recorder bridge's `mark` mechanism is meant for —
 * see `../recorder-bridge.ts`'s `handleCdp()`: a `mark`-bearing request is
 * bracketed with two `performance.now()` reads and records a labeled
 * input-landmark entry straight to `events.jsonl` (host-side only — the
 * label never touches the page, see `../timing.ts`'s
 * `withDocumentPerformanceNow`), so it must only be set on the CDP calls that
 * actually dispatch a distinct, landmark-worthy ACTION, not on every
 * incidental call a higher-level helper (`clickByName`, `focusAndType`, ...)
 * happens to make while resolving a selector/name (`Accessibility.*`,
 * `DOM.*`, `Runtime.evaluate`, `Page.captureScreenshot`, ...). Every
 * `Input.dispatch*` method (mouse/key/touch) is covered by the prefix;
 * `Input.insertText` is NOT a `dispatch*` method but IS the actual mutator
 * `../../interact.ts`'s `typeText()`/`focusAndType()` issue for `capture
 * type` (see `Input.insertText` at `../../interact.ts`), so it's listed
 * explicitly — without it, a routed `type` lands no input landmark in
 * `events.jsonl` and `motion response` cannot anchor it. `Page.navigate` is
 * F2's action landmark: an intervening `capture navigate` mid-recording
 * (`../record.ts`'s `navigateWithFragmentFix`, routed via `../commands/
 * traffic.ts`'s `cmdNavigate`) is a landmark-worthy action same as a click
 * or type, not incidental navigation resolution. */
const MARKABLE_EXACT_METHODS = new Set(['Input.insertText', 'Page.navigate']);

function isMarkableActionMethod(method: string): boolean {
  return method.startsWith('Input.dispatch') || MARKABLE_EXACT_METHODS.has(method);
}

export interface RecorderHeldClientOptions {
  /** The active recording's socket path (`recorderSocketPath(recDir)`). */
  socketPath: string;
  /** Label attached to every marked (`Input.dispatch*`) call from this
   * client instance — one per routed capture command invocation, e.g.
   * `click:Send` or `type:another message`, matching the design's
   * "labeled input landmark" shape in `events.jsonl`. */
  actionLabel: string;
  timeoutMs?: number;
}

/**
 * `CDPClient`-compatible adapter over a live recorder connection. Structural
 * subset (`send`/`on`/`onDisconnect`/`close`) rather than a subclass — see
 * `../connection.ts`'s `connectToActiveRecorder()`, which is the only
 * caller, and which casts the result to `CDPClient` the same documented way
 * `../recorder-bridge.ts`'s `asCDPClient()` does, so every existing command
 * leaf keeps working against the same type it always has.
 */
export class RecorderHeldClient {
  private readonly socketPath: string;
  private readonly actionLabel: string;
  private readonly defaultTimeoutMs: number;

  constructor(opts: RecorderHeldClientOptions) {
    this.socketPath = opts.socketPath;
    this.actionLabel = opts.actionLabel;
    this.defaultTimeoutMs = opts.timeoutMs ?? 60000;
  }

  async send(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
    _sessionId?: string,
  ): Promise<unknown> {
    const { result } = await this.dispatch(method, params, undefined, timeoutMs);
    return result;
  }

  /**
   * Blocks on the recorder bridge's own event broker for the next
   * occurrence of `eventName`, via a wait-event-ONLY request (`method`
   * omitted — see `RecCdpWaitEventRequest`). This is the real event-wait
   * surface for adapter users, distinct from `.on()` above. `capture cdp
   * --wait-event` is the primary caller (`../commands/cdp.ts`) when no
   * method is also being dispatched.
   */
  async waitEvent(eventName: string, timeoutMs?: number): Promise<unknown> {
    const resp = await sendRecorderRequest(this.socketPath, {
      type: 'cdp',
      waitEvent: eventName,
      timeoutMs: timeoutMs ?? this.defaultTimeoutMs,
    });
    if (!resp.ok) {
      throw new Error(`recorder-routed wait-event "${eventName}" failed: ${resp.error}`);
    }
    return resp.event;
  }

  /**
   * Dispatches `method` and, when `waitEvent` is given, arms the wait for it
   * in the SAME `sendRecorderRequest` call — one unix-socket connection, one
   * request line carrying `method`, `params`, `mark`, and (optionally)
   * `waitEvent` together. The bridge's own `RecorderSession.handleCdp()`
   * registers the event wait BEFORE dispatching the CDP call within that
   * one request, so this is race-free against a fast action-caused event —
   * unlike `.send()` followed by `.waitEvent()`, which are two SEPARATE
   * connections/requests with no ordering guarantee between them. `.send()`
   * above is just this method with `waitEvent` omitted; every caller that
   * needs to dispatch a method and observe an event it may itself trigger
   * should call this directly instead.
   *
   * NOTE (`../commands/traffic.ts`'s `navigateAtomicWithFragmentFix`): if
   * `waitEvent` is set and the bridge's wait rejects (times out), the
   * bridge's `handleRecorderRequest` catch turns the ENTIRE response into
   * `ok:false` — `result` (e.g. `Page.navigate`'s `loaderId`) is silently
   * discarded along with it, not just `event`. A caller that needs the
   * dispatch's `result` even when the paired wait might time out must not
   * bundle the two; see that file for the worked-out routing around this.
   */
  async dispatch(
    method: string,
    params: Record<string, unknown> = {},
    waitEvent?: string,
    timeoutMs?: number,
  ): Promise<{ result: unknown; event?: unknown }> {
    const mark = isMarkableActionMethod(method) ? this.actionLabel : undefined;
    const resp = await sendRecorderRequest(this.socketPath, {
      type: 'cdp',
      method,
      params,
      mark,
      waitEvent,
      timeoutMs: timeoutMs ?? this.defaultTimeoutMs,
    });
    if (!resp.ok) {
      throw new Error(
        `recorder-routed CDP call "${method}"${waitEvent ? ` with wait-event "${waitEvent}"` : ''} failed: ${resp.error}`,
      );
    }
    return { result: resp.result, event: resp.event };
  }

  /** Documented no-op — see this file's header comment. */
  on(_event: string, _handler: (params: unknown) => void): void {
    // Intentionally does nothing: nothing pushes unsolicited events back
    // over the recorder's one-request-one-response socket. The recorder's
    // own subscriptions are the live-event record (events.jsonl).
  }

  /** Documented no-op — the recorder owns the connection's lifetime, not this borrowed handle. */
  onDisconnect(_handler: () => void): void {}

  /** Documented no-op — closing would tear down the leaf's OWN (nonexistent) socket, never the recorder's held connection. `motion rec --stop` is what ends the recording. */
  close(): void {}
}

/** Type guard used by `../connection.ts`'s `withConnection()` to skip wiring
 * `ConsoleRecorder`/`HARRecorder` (which would otherwise silently report an
 * empty summary — see this file's header) when the command's client is
 * actually a recorder-routed adapter underneath its `CDPClient` cast. */
export function isRecorderHeldClient(client: unknown): client is RecorderHeldClient {
  return client instanceof RecorderHeldClient;
}
