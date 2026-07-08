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
