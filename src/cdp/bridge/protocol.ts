/**
 * Wire protocol between `capture cdp --browser` and the held bridge process
 * (`capture __bridge-serve`). Newline-delimited JSON over a Unix domain
 * socket — one request per connection, one response, then the socket closes.
 */

export interface BridgeRequest {
  reqId: number;
  /** CDP method, e.g. "Browser.grantPermissions". Omit when only waiting for an event. */
  method?: string;
  params?: Record<string, unknown>;
  /**
   * Target (page or worker) to scope this call to, via a flattened
   * `Target.attachToTarget` session on the SAME held browser websocket.
   * Required for domains that live on a target rather than the browser
   * itself (`ServiceWorker.*`, `Page.*`, ...) — omit for pure browser-level
   * domains (`Browser.*`, `Target.*`).
   */
  targetId?: string;
  /** CDP event name to wait for (consumes the next occurrence, FIFO, buffered if it already fired). */
  waitEvent?: string;
  timeoutMs?: number;
}

export interface BridgeResponseOk {
  reqId: number;
  ok: true;
  result?: unknown;
  event?: unknown;
}

export interface BridgeResponseErr {
  reqId: number;
  ok: false;
  error: string;
}

export type BridgeResponse = BridgeResponseOk | BridgeResponseErr;

// ---------------------------------------------------------------------------
// Recorder-mode protocol — the SAME NDJSON-over-unix-socket wire format as
// above, specialized for `capture motion rec` (see ../recorder-bridge.ts).
// The generic `BridgeRequest`/`BridgeResponse` are unchanged and still
// govern `capture cdp --browser` / `session start --hold`; a recorder-mode
// bridge process (spawned in recorder mode, see ../bridge/spawn.ts) speaks
// this union instead, one request per connection, one response, same as
// the plain bridge.
// ---------------------------------------------------------------------------

/**
 * The three-way clock baseline the design's "Recorder timing model" requires to convert
 * screencast-frame and Tracing timestamps into the authoritative `performance.now()` domain.
 * `performanceNowMs`/`wallClockMs` are read synchronously when the recorder arms (`rec-start`);
 * `firstScreencastTimestampSec`/`firstTraceEventTsUs` cannot be — no frame or trace batch has
 * necessarily arrived yet at that instant — so they are filled in opportunistically as the
 * recorder's own screencast/tracing handlers observe the first occurrence of each, and stay
 * `null` (with `baselinesPending: true`) until then. `rec-stop`'s response carries the same
 * object read again at stop time — the flush path a caller uses to get the completed baselines
 * for `markers.json` even when `rec-start`'s own response returned it still pending.
 */
export interface RecorderClockBaselines {
  performanceNowMs: number;
  wallClockMs: number;
  /** First `Page.screencastFrame`'s `metadata.timestamp` (wall-clock seconds), or `null` if none had arrived yet at the moment this snapshot was taken. */
  firstScreencastTimestampSec: number | null;
  /** First `Tracing.dataCollected` batch's earliest event `ts` (trace-clock microseconds), or `null` if none had arrived yet at the moment this snapshot was taken. */
  firstTraceEventTsUs: number | null;
  /** `true` while either timestamp above is still `null`. */
  baselinesPending: boolean;
}

/**
 * Arms the recorder on its held tab connection: enables the motion-rec CDP
 * domains, starts `Page.startScreencast` + `Tracing`, injects the
 * Mutation/Resize/Performance observers, and captures the clock baseline.
 * A recorder process only accepts one `rec-start` while `state==="idle"`.
 */
export interface RecStartRequest {
  reqId: number;
  type: 'rec-start';
}

export interface RecStartResponseOk {
  reqId: number;
  ok: true;
  type: 'rec-start';
  /** Returned for the caller to persist into `markers.json` — the recorder itself does not write that file. */
  markers: RecorderClockBaselines;
}

/**
 * Stops screencast + tracing, flushes the injected observers, and tears
 * down the recorder's subscriptions (not the socket — the caller closes
 * the bridge process once it has read the response). Returns counts for
 * the caller's `meta.json`; the recorder itself does not write that file.
 */
export interface RecStopRequest {
  reqId: number;
  type: 'rec-stop';
}

export interface RecStopResponseOk {
  reqId: number;
  ok: true;
  type: 'rec-stop';
  frameCount: number;
  eventCount: number;
  durationMs: number;
  /** The clock baselines re-read at stop time — the flush path for a `rec-start` response whose baselines were still pending. */
  markers: RecorderClockBaselines;
}

/**
 * A CDP request routed through the recorder's held tab connection — the
 * mechanism intervening session commands (`click`, `type`, `navigate`, ...)
 * use during a composed recording. Setting `mark` brackets the dispatch
 * with two performance.now() reads taken in the page's execution context
 * (`../timing.ts`'s `withDocumentPerformanceNow`) and appends a labeled
 * input-landmark record to `events.jsonl`, tying the action to the frame
 * timeline — this is the "marked CDP request message" the protocol
 * supports. Omit `mark` for a plain passthrough call (still observed
 * natively by the recorder's own event subscriptions, just not logged as a
 * distinct input landmark). Omit `method` for a wait-event-only request;
 * the bridge will block on its existing event broker and return the matched
 * event in one response.
 */
export interface RecCdpDispatchRequest {
  reqId: number;
  type: 'cdp';
  method: string;
  params?: Record<string, unknown>;
  mark?: string;
  waitEvent?: string;
  timeoutMs?: number;
}

export interface RecCdpWaitEventRequest {
  reqId: number;
  type: 'cdp';
  method?: undefined;
  waitEvent: string;
  timeoutMs?: number;
}

export type RecCdpRequest = RecCdpDispatchRequest | RecCdpWaitEventRequest;

export interface RecCdpResponseOk {
  reqId: number;
  ok: true;
  type: 'cdp';
  result?: unknown;
  event?: unknown;
}

export type RecorderRequest = RecStartRequest | RecStopRequest | RecCdpRequest;

export interface RecorderResponseErr {
  reqId: number;
  ok: false;
  type: RecorderRequest['type'];
  error: string;
}

export type RecStartResponse = RecStartResponseOk | RecorderResponseErr;
export type RecStopResponse = RecStopResponseOk | RecorderResponseErr;
export type RecCdpResponse = RecCdpResponseOk | RecorderResponseErr;
export type RecorderResponse = RecStartResponse | RecStopResponse | RecCdpResponse;
