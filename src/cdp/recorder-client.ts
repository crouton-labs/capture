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

/** Arms the recorder (`rec-start`). `nonce` is the recording's control-socket
 * admission token (see `protocol.ts`'s `RecStartRequest`); every request must
 * carry it. Throws with the recorder's own error message on failure. */
export async function requestRecStart(socketPath: string, nonce: string): Promise<RecStartResponseOk> {
  const resp = await sendRecorderRequest(socketPath, { type: 'rec-start', nonce });
  if (!resp.ok) throw new Error(`rec-start failed: ${resp.error}`);
  return resp;
}

/**
 * Thrown by `requestRecStop` when the bridge actually answered with an
 * authenticated `ok:false` response — an explicit, terminal recorder-stop
 * failure (fatal HAR drain, or any other authoritative rejection the bridge
 * itself produced), as opposed to a transport/no-response failure (socket
 * connect/timeout error), which `sendRecorderRequest` still rejects with a
 * plain `Error`. Callers that only read `.message` see the exact same
 * `rec-stop failed: ${error}` text as before this type existed; callers that
 * need to distinguish "the bridge answered and refused" from "the bridge
 * never answered" (`../motion/recorder.ts`'s terminal-vs-transport
 * classification) narrow with `instanceof RecStopBridgeFailure` and read
 * `.responseError` for the bridge's raw, unwrapped error string.
 */
export class RecStopBridgeFailure extends Error {
  readonly responseError: string;
  constructor(responseError: string) {
    super(`rec-stop failed: ${responseError}`);
    this.name = 'RecStopBridgeFailure';
    this.responseError = responseError;
  }
}

/** Finalizes the recorder (`rec-stop`). Throws `RecStopBridgeFailure` (preserving the recorder's own error message) when the bridge answers `ok:false`; a transport/no-response failure still throws a plain `Error`. */
export async function requestRecStop(socketPath: string, nonce: string): Promise<RecStopResponseOk> {
  const resp = await sendRecorderRequest(socketPath, { type: 'rec-stop', nonce });
  if (!resp.ok) throw new RecStopBridgeFailure(resp.error);
  return resp;
}

/** CDP method names the recorder bridge's `mark` mechanism is meant for —
 * see `../recorder-bridge.ts`'s `handleCdp()`: a `mark`-bearing request is
 * bracketed with two `performance.now()` reads and records a labeled
 * input-landmark entry straight to `events.jsonl` (host-side only — the
 * label never touches the page, see `../timing.ts`'s
 * `withDocumentPerformanceNow`), so it must only be set on the CDP calls that
 * actually dispatch a distinct, landmark-worthy ACTION, not on every
 * incidental call a higher-level helper (`resolveLiveTarget`, `focusAndType`, ...)
 * happens to make while resolving a selector/name (`Accessibility.*`,
 * `DOM.*`, `Runtime.evaluate`, `Page.captureScreenshot`, ...). Every
 * `Input.dispatch*` method (mouse/key/touch) is covered by the prefix;
 * `Input.insertText` is NOT a `dispatch*` method but IS the actual mutator
 * `../../interact.ts`'s `typeText()`/`focusAndType()` issue for `capture
 * page type`, so it is listed explicitly: routed typing needs one input
 * landmark in `events.jsonl` for `motion response` to anchor. `Page.navigate`
 * is likewise the action landmark for `capture page navigate`; the
 * recorder-routed path in `../commands/page/navigate.ts` sends it through
 * this client just like click and type. */
const MARKABLE_EXACT_METHODS = new Set(['Input.insertText', 'Page.navigate']);

function isMarkableActionMethod(method: string, params: Record<string, unknown>): boolean {
  if (MARKABLE_EXACT_METHODS.has(method)) return true;
  // A logical input may require several low-level dispatches. Mark its
  // initiating edge only: e.g. clickResolved emits press + release, which is
  // one landmark rather than two identically-labelled observations.
  if (method === 'Input.dispatchMouseEvent') return params.type === 'mousePressed';
  if (method === 'Input.dispatchKeyEvent') return params.type === 'keyDown' || params.type === 'rawKeyDown';
  if (method === 'Input.dispatchTouchEvent') return params.type === 'touchStart';
  return false;
}

export interface RecorderHeldClientOptions {
  /** The active recording's socket path (`recorderSocketPath(recDir)`). */
  socketPath: string;
  /** The recording's control-socket admission token, read from the persisted
   * recorder handle (`recorder.json.nonce`) — required on every request this
   * adapter sends; the bridge rejects anything without it. */
  nonce: string;
  /** Label attached to every marked (`Input.dispatch*`) call from this
   * client instance — one per routed capture command invocation, e.g.
   * `click:Send` or `type:ax:Message`, matching the labeled input landmark
   * shape in `events.jsonl` without recording typed content. */
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
  private readonly nonce: string;
  private readonly actionLabel: string;
  private readonly defaultTimeoutMs: number;
  private suppressNextMousePressMark = false;

  constructor(opts: RecorderHeldClientOptions) {
    this.socketPath = opts.socketPath;
    this.nonce = opts.nonce;
    this.actionLabel = opts.actionLabel;
    this.defaultTimeoutMs = opts.timeoutMs ?? 60000;
  }

  /** Suppresses the focus click's initiating edge so a routed `type --into`
   * has one landmark on its actual text insertion. */
  suppressNextFocusClickMark(): void {
    this.suppressNextMousePressMark = true;
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

  /** Marked lane for a mutating call the auto-markable set above doesn't
   * cover — `Runtime.callFunctionOn` in `../../interact.ts`'s
   * `scrollResolved`, whose caller supplies the landmark label explicitly
   * (`LiveClient.sendMarked`). Rides the same bridge `mark` mechanism as
   * every auto-marked call. */
  async sendMarked(method: string, params: Record<string, unknown>, mark: string): Promise<unknown> {
    const resp = await sendRecorderRequest(this.socketPath, {
      type: 'cdp',
      nonce: this.nonce,
      method,
      params,
      mark,
      timeoutMs: this.defaultTimeoutMs,
    });
    if (!resp.ok) throw new Error(`recorder-routed marked CDP call "${method}" failed: ${resp.error}`);
    return resp.result;
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
      nonce: this.nonce,
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
   * When `method` and `waitEvent` are BOTH set, a successful dispatch is
   * preserved even if the paired wait times out: the bridge's `handleCdp`
   * returns the method `result` plus a `waitOutcome` of `'observed'` (the
   * event fired within the deadline, `event` populated) or `'bounded-timeout'`
   * (the event did not fire in time — the method still succeeded). Only a
   * FAILURE of the dispatched method itself yields `ok:false`. A wait-event-
   * only request (`method` omitted) keeps the older semantics: a wait timeout
   * is itself the failure and surfaces as `ok:false`, with no `waitOutcome`.
   */
  async dispatch(
    method: string,
    params: Record<string, unknown> = {},
    waitEvent?: string,
    timeoutMs?: number,
  ): Promise<{ result: unknown; event?: unknown; waitOutcome?: 'observed' | 'bounded-timeout' }> {
    const suppressMousePress = method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed' && this.suppressNextMousePressMark;
    if (suppressMousePress) this.suppressNextMousePressMark = false;
    const mark = !suppressMousePress && isMarkableActionMethod(method, params) ? this.actionLabel : undefined;
    const resp = await sendRecorderRequest(this.socketPath, {
      type: 'cdp',
      nonce: this.nonce,
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
    return { result: resp.result, event: resp.event, waitOutcome: resp.waitOutcome };
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
