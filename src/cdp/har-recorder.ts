import {
  type BodyProvenance,
  type HarAppendBatch,
  type HarFile,
  type HAREntry,
  type HarRequest,
  type HarResponse,
  type Header,
  type IncompleteLifecycle,
  type WebSocketHAREntry,
  type WebSocketMessage,
  validateHarAppendBatch,
  validateHarFile,
} from '../har-manager.js';
import { type CDPClient } from './client.js';

const MAX_BODY_SIZE = 256 * 1024;

type Terminal =
  | { kind: 'finished'; timestamp: number; encodedDataLength: number }
  | { kind: 'redirect'; timestamp: number }
  | { kind: 'failed'; timestamp: number; errorText: string; canceled: boolean; blockedReason: string | null; resourceType: string | null };
type ObservedResponse = { status: number; headers: Header[]; timestamp: number };
type RedirectResponse = { status: number; headers: Header[] };
type Generation = {
  key: string;
  order: number;
  requestId: string;
  generation: number;
  startedDateTime: string;
  requestWallTime: number;
  requestMonotonic: number;
  request: HarRequest;
  response?: ObservedResponse;
  redirectResponse?: RedirectResponse;
  terminal?: Terminal;
  bodyPending: boolean;
};
type Materialized = { order: number; value: HAREntry | IncompleteLifecycle };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

// ── WebSocket capture (DevTools convention) ────────────────────────────────────

const MAX_WS_FRAMES = 200; // per socket; further frames are counted, not stored
const MAX_WS_FRAME_SIZE = 4 * 1024; // 4KB per frame payload in HAR

type WebSocketConnection = {
  requestId: string;
  url: string;
  wallTime?: number;
  monotonicTime?: number;
  requestHeaders: Header[];
  status?: number;
  responseHeaders: Header[];
  messages: WebSocketMessage[];
  droppedFrames: number;
};

function truncateWebSocketData(data: string): string {
  const size = Buffer.byteLength(data, 'utf8');
  if (size <= MAX_WS_FRAME_SIZE) return data;
  let end = Math.min(data.length, MAX_WS_FRAME_SIZE);
  while (end > 0 && Buffer.byteLength(data.slice(0, end), 'utf8') > MAX_WS_FRAME_SIZE) end--;
  return data.slice(0, end) + `…[truncated: ${size} bytes]`;
}

function fail(message: string): never {
  throw new Error(`Malformed owned Network event: ${message}`);
}

function nonempty(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(name);
  return value;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(name);
  return value;
}

function headers(value: unknown, name: string): Header[] {
  if (!isPlainObject(value)) fail(name);
  return Object.entries(value).map(([headerName, headerValue]) => {
    if (typeof headerValue !== 'string') fail(`${name}.${headerName}`);
    return { name: headerName, value: headerValue };
  });
}

function wallTime(value: unknown): { seconds: number; iso: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('wallTime');
  try {
    return { seconds: value, iso: new Date(value * 1000).toISOString() };
  } catch {
    fail('wallTime is outside the ISO date range');
  }
}

function captureVersion(): string {
  const version = (globalThis as { __CAPTURE_VERSION__?: unknown }).__CAPTURE_VERSION__;
  return typeof version === 'string' && version.length > 0 ? version : 'development';
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function textPrefix(text: string): { text: string; bytes: number } {
  let bytes = 0;
  let end = 0;
  for (const scalar of text) {
    const size = Buffer.byteLength(scalar, 'utf8');
    if (bytes + size > MAX_BODY_SIZE) break;
    bytes += size;
    end += scalar.length;
  }
  return { text: text.slice(0, end), bytes };
}

function strictBase64(text: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error('Network.getResponseBody returned malformed base64');
  }
  return Buffer.from(text, 'base64');
}

/**
 * A streaming recorder's append authority: receives each materialized value
 * exactly once as a single-value validated batch. The recorder serializes
 * calls (never two in flight) and latches the first rejection as its fatal
 * store error — it never retries or re-emits a batch.
 */
export type HarSink = (batch: HarAppendBatch) => Promise<void>;

/**
 * Assembles validated Network events into HAR evidence. It owns no file or
 * bridge lifecycle, and admits every request — there is no URL, extension, or
 * domain filtering.
 *
 * Two exclusive modes, chosen at construction:
 * - **Snapshot** (no sink): values accumulate internally; `finish()` /
 *   `finishPartial()` return one immutable validated `HarFile`.
 * - **Streaming** (sink provided): each completed entry or incomplete
 *   lifecycle is emitted exactly once, in completion order, through the sink;
 *   nothing accumulates. `flush()` is the health/completion barrier and
 *   `drain()` is the finalizer whose first synchronous line cuts admission.
 */
export class HARRecorder {
  private phase: 'new' | 'starting' | 'recording' | 'finalizing' | 'finalized' | 'failed' = 'new';
  private admissionOpen = false;
  private readonly nextGenerationByRequestId = new Map<string, number>();
  private readonly activeByRequestId = new Map<string, Generation>();
  /** Exactly-once guard for both modes: a key is recorded at most once. */
  private readonly recordedKeys = new Set<string>();
  /** Snapshot mode only — streaming mode retains no materialized values. */
  private readonly materializedByKey = new Map<string, Materialized>();
  /** Last terminal remains comparable until this CDP id opens its next generation. */
  private readonly closedTerminals = new Map<string, Terminal>();
  /** Sockets opened while this recorder is attached — CDP does not replay creation events for pre-existing sockets. */
  private readonly webSockets = new Map<string, WebSocketConnection>();
  private readonly bodyTasks = new Set<Promise<void>>();
  private nextOrder = 0;
  private entryCount = 0;
  private fatalError: Error | null = null;
  private finalResult: HarFile | null = null;
  private finalizing: Promise<HarFile> | null = null;
  /** Streaming mode: serialized sink appends, in emission order. */
  private sinkChain: Promise<void> = Promise.resolve();
  private draining: Promise<void> | null = null;

  constructor(
    private readonly client: CDPClient,
    private readonly sink?: HarSink,
  ) {}

  get responseCount(): number {
    return this.entryCount;
  }

  async start(): Promise<void> {
    if (this.phase !== 'new') throw new Error('HAR recorder has already been started');
    this.phase = 'starting';
    try {
      await this.client.send('Network.enable');
      if (this.phase !== 'starting') return;
      this.client.on('Network.requestWillBeSent', (params) => this.admit(() => this.onRequest(params)));
      this.client.on('Network.responseReceived', (params) => this.admit(() => this.onResponse(params)));
      this.client.on('Network.loadingFinished', (params) => this.admit(() => this.onFinished(params)));
      this.client.on('Network.loadingFailed', (params) => this.admit(() => this.onFailed(params)));
      this.client.on('Network.webSocketCreated', (params) => this.admit(() => this.onWebSocketCreated(params)));
      this.client.on('Network.webSocketWillSendHandshakeRequest', (params) => this.admit(() => this.onWebSocketHandshakeRequest(params)));
      this.client.on('Network.webSocketHandshakeResponseReceived', (params) => this.admit(() => this.onWebSocketHandshakeResponse(params)));
      this.client.on('Network.webSocketFrameSent', (params) => this.admit(() => this.onWebSocketFrame('send', params)));
      this.client.on('Network.webSocketFrameReceived', (params) => this.admit(() => this.onWebSocketFrame('receive', params)));
      this.phase = 'recording';
      this.admissionOpen = true;
    } catch (error) {
      if (this.phase === 'starting') throw this.latchFatal(error);
    }
  }

  private admit(fn: () => void): void {
    if (!this.admissionOpen || this.fatalError) return;
    try {
      fn();
    } catch (error) {
      this.latchFatal(error);
    }
  }

  private latchFatal(error: unknown): Error {
    if (!this.fatalError) this.fatalError = error instanceof Error ? error : new Error(String(error));
    this.admissionOpen = false;
    this.phase = 'failed';
    return this.fatalError;
  }

  private onRequest(params: unknown): void {
    if (!isPlainObject(params) || !isPlainObject(params.request)) fail('requestWillBeSent');
    const requestId = nonempty(params.requestId, 'requestId');
    const requestPayload = params.request;
    const request: HarRequest = {
      method: nonempty(requestPayload.method, 'request.method'),
      url: nonempty(requestPayload.url, 'request.url'),
      headers: headers(requestPayload.headers, 'request.headers'),
    };
    if ('postData' in requestPayload) {
      if (typeof requestPayload.postData !== 'string') fail('request.postData');
      const contentType = request.headers.find((header) => header.name.toLowerCase() === 'content-type');
      request.postData = { mimeType: contentType?.value ?? '', text: requestPayload.postData };
    }
    const monotonic = finite(params.timestamp, 'timestamp');
    const wall = wallTime(params.wallTime);
    const previous = this.activeByRequestId.get(requestId);
    const hasRedirect = 'redirectResponse' in params && params.redirectResponse !== undefined;
    if (previous && !hasRedirect) fail('duplicate active requestId without redirectResponse');
    if (hasRedirect && previous) {
      const redirect = this.parseResponse(params.redirectResponse, 'redirectResponse');
      if (redirect.status < 300 || redirect.status > 399) fail('redirectResponse.status');
      this.assignTerminal(previous, { kind: 'redirect', timestamp: monotonic }, redirect);
    }
    this.closedTerminals.delete(requestId);
    const generation = this.nextGenerationByRequestId.get(requestId) ?? 1;
    this.nextGenerationByRequestId.set(requestId, generation + 1);
    this.activeByRequestId.set(requestId, {
      key: `${requestId}:${generation}`,
      order: this.nextOrder++,
      requestId,
      generation,
      startedDateTime: wall.iso,
      requestWallTime: wall.seconds,
      requestMonotonic: monotonic,
      request,
      bodyPending: false,
    });
  }

  // WebSocket lifecycle — ported local-main capture, admitted like every other
  // owned Network event. Only sockets OPENED while this recorder is attached
  // are visible (CDP does not replay creation events for pre-existing
  // sockets), so events for unknown sockets are ignored rather than fatal.
  private onWebSocketCreated(params: unknown): void {
    if (!isPlainObject(params)) fail('webSocketCreated');
    const requestId = nonempty(params.requestId, 'requestId');
    const url = nonempty(params.url, 'url');
    this.webSockets.set(requestId, { requestId, url, requestHeaders: [], responseHeaders: [], messages: [], droppedFrames: 0 });
  }

  private onWebSocketHandshakeRequest(params: unknown): void {
    if (!isPlainObject(params)) fail('webSocketWillSendHandshakeRequest');
    const ws = this.webSockets.get(nonempty(params.requestId, 'requestId'));
    if (!ws) return;
    if (!isPlainObject(params.request)) fail('webSocketWillSendHandshakeRequest.request');
    ws.wallTime = finite(params.wallTime, 'wallTime');
    ws.monotonicTime = finite(params.timestamp, 'timestamp');
    ws.requestHeaders = headers(params.request.headers, 'request.headers');
  }

  private onWebSocketHandshakeResponse(params: unknown): void {
    if (!isPlainObject(params)) fail('webSocketHandshakeResponseReceived');
    const ws = this.webSockets.get(nonempty(params.requestId, 'requestId'));
    if (!ws) return;
    if (!isPlainObject(params.response)) fail('webSocketHandshakeResponseReceived.response');
    const status = finite(params.response.status, 'response.status');
    if (!Number.isInteger(status) || status < 100 || status > 599) fail('response.status');
    ws.status = status;
    ws.responseHeaders = headers(params.response.headers, 'response.headers');
  }

  private onWebSocketFrame(type: 'send' | 'receive', params: unknown): void {
    if (!isPlainObject(params)) fail('webSocketFrame');
    const ws = this.webSockets.get(nonempty(params.requestId, 'requestId'));
    if (!ws) return;
    if (ws.messages.length >= MAX_WS_FRAMES) {
      ws.droppedFrames++;
      return;
    }
    if (!isPlainObject(params.response)) fail('webSocketFrame.response');
    const timestamp = finite(params.timestamp, 'timestamp');
    const opcode = finite(params.response.opcode, 'response.opcode');
    if (!Number.isInteger(opcode)) fail('response.opcode');
    const data = typeof params.response.payloadData === 'string' ? params.response.payloadData : fail('response.payloadData');
    const time = ws.wallTime !== undefined && ws.monotonicTime !== undefined
      ? ws.wallTime + (timestamp - ws.monotonicTime)
      : timestamp;
    ws.messages.push({ type, time, opcode, data: truncateWebSocketData(data) });
  }

  /** WebSocket entries materialize only at snapshot time — a socket has no
   * request/terminal lifecycle, so it is never part of the generation maps. */
  private buildWebSocketEntries(): WebSocketHAREntry[] {
    return [...this.webSockets.values()].map((ws) => {
      const messages = ws.droppedFrames > 0
        ? [...ws.messages, {
            type: 'receive' as const,
            time: 0,
            opcode: 1,
            data: `[${ws.droppedFrames} further frames not recorded — per-socket cap of ${MAX_WS_FRAMES}]`,
          }]
        : ws.messages;
      return {
        startedDateTime: new Date(ws.wallTime !== undefined ? ws.wallTime * 1000 : Date.now()).toISOString(),
        request: { method: 'GET', url: ws.url, headers: ws.requestHeaders },
        response: { status: ws.status ?? 0, headers: ws.responseHeaders, content: {} },
        _resourceType: 'websocket' as const,
        _webSocketMessages: messages,
      };
    });
  }

  private parseResponse(value: unknown, name: string): RedirectResponse {
    if (!isPlainObject(value)) fail(name);
    nonempty(value.url, `${name}.url`);
    const status = finite(value.status, `${name}.status`);
    if (!Number.isInteger(status) || status < 100 || status > 599) fail(`${name}.status`);
    return { status, headers: headers(value.headers, `${name}.headers`) };
  }

  private eventRequestId(params: unknown): string | null {
    return isPlainObject(params) && typeof params.requestId === 'string' && params.requestId.length > 0 ? params.requestId : null;
  }

  private onResponse(params: unknown): void {
    const requestId = this.eventRequestId(params);
    if (!requestId) return;
    const current = this.activeByRequestId.get(requestId);
    if (!current) return;
    const event = params as Record<string, unknown>;
    const parsed = this.parseResponse(event.response, 'response');
    const next: ObservedResponse = { ...parsed, timestamp: finite(event.timestamp, 'timestamp') };
    if (current.response && !same(current.response, next)) fail('conflicting responseReceived');
    current.response ??= next;
  }

  private onFinished(params: unknown): void {
    const requestId = this.eventRequestId(params);
    if (!requestId) return;
    const current = this.activeByRequestId.get(requestId);
    const closed = this.closedTerminals.has(requestId);
    if (!current && !closed) return;
    const event = params as Record<string, unknown>;
    const terminal: Terminal = { kind: 'finished', timestamp: finite(event.timestamp, 'timestamp'), encodedDataLength: finite(event.encodedDataLength, 'encodedDataLength') };
    if (!current) return this.compareClosedTerminal(requestId, terminal);
    if (!current.response) fail('loadingFinished without responseReceived');
    this.assignTerminal(current, terminal);
  }

  private onFailed(params: unknown): void {
    const requestId = this.eventRequestId(params);
    if (!requestId) return;
    const current = this.activeByRequestId.get(requestId);
    const closed = this.closedTerminals.has(requestId);
    if (!current && !closed) return;
    const event = params as Record<string, unknown>;
    const terminal: Terminal = {
      kind: 'failed',
      timestamp: finite(event.timestamp, 'timestamp'),
      errorText: typeof event.errorText === 'string' ? event.errorText : fail('errorText'),
      canceled: event.canceled === undefined ? false : typeof event.canceled === 'boolean' ? event.canceled : fail('canceled'),
      blockedReason: event.blockedReason === undefined ? null : typeof event.blockedReason === 'string' ? event.blockedReason : fail('blockedReason'),
      resourceType: event.type === undefined ? null : typeof event.type === 'string' ? event.type : fail('type'),
    };
    if (!current) return this.compareClosedTerminal(requestId, terminal);
    this.assignTerminal(current, terminal);
  }

  private compareClosedTerminal(requestId: string, terminal: Terminal): void {
    const previous = this.closedTerminals.get(requestId);
    if (previous && !same(previous, terminal)) fail('conflicting terminal event');
  }

  private assignTerminal(current: Generation, terminal: Terminal, redirectResponse?: RedirectResponse): void {
    if (current.terminal) {
      if (!same(current.terminal, terminal)) fail('conflicting terminal event');
      return;
    }
    current.terminal = terminal;
    this.closedTerminals.set(current.requestId, terminal);
    if (redirectResponse) {
      current.redirectResponse = redirectResponse;
      this.materialize(current, { state: 'not_applicable', reason: 'redirect' });
    } else if (terminal.kind === 'finished') {
      current.bodyPending = true;
      const task = this.fetchBody(current);
      this.bodyTasks.add(task);
      void task.finally(() => this.bodyTasks.delete(task));
    } else {
      this.materialize(current, current.response ? { state: 'not_applicable', reason: 'network_failed' } : { state: 'not_applicable', reason: 'no_response' });
    }
  }

  private async fetchBody(current: Generation): Promise<void> {
    let body: BodyProvenance;
    let content: HarResponse['content'] = {};
    try {
      const result = await this.client.send('Network.getResponseBody', { requestId: current.requestId }, 5000);
      if (!isPlainObject(result) || typeof result.body !== 'string' || typeof result.base64Encoded !== 'boolean') throw new Error('Network.getResponseBody returned malformed payload');
      if (result.base64Encoded) {
        const decoded = strictBase64(result.body);
        const prefix = decoded.subarray(0, MAX_BODY_SIZE);
        content = { text: prefix.toString('base64'), encoding: 'base64' };
        body = { state: 'captured', sourceEncoding: 'base64', decodedByteLength: decoded.length, capturedByteLength: prefix.length, truncated: prefix.length < decoded.length };
      } else {
        const decodedByteLength = Buffer.byteLength(result.body, 'utf8');
        const prefix = textPrefix(result.body);
        content = { text: prefix.text };
        body = { state: 'captured', sourceEncoding: 'text', decodedByteLength, capturedByteLength: prefix.bytes, truncated: prefix.bytes < decodedByteLength };
      }
    } catch (error) {
      body = { state: 'fetch_failed', error: error instanceof Error && error.message ? error.message : String(error) };
    }
    if (this.finalResult) return;
    current.bodyPending = false;
    this.materialize(current, body, content);
  }

  private deleteActive(current: Generation): void {
    if (this.activeByRequestId.get(current.requestId) === current) this.activeByRequestId.delete(current.requestId);
  }

  private install(current: Generation, value: HAREntry | IncompleteLifecycle): void {
    if (!this.recordedKeys.has(current.key)) {
      this.recordedKeys.add(current.key);
      if (!('kind' in value)) this.entryCount++;
      if (this.sink) this.emit(value);
      else this.materializedByKey.set(current.key, { order: current.order, value });
    }
    this.deleteActive(current);
  }

  /**
   * Streaming mode: queue one exactly-once single-value batch onto the
   * serialized sink chain. The batch is validated and frozen before the sink
   * sees it; a validation or sink failure latches as the fatal store error and
   * stops all later sink calls — the store is never reset or retried.
   */
  private emit(value: HAREntry | IncompleteLifecycle): void {
    let batch: HarAppendBatch;
    try {
      batch = deepFreeze(
        validateHarAppendBatch(
          'kind' in value
            ? { entries: [], incompleteLifecycles: [value] }
            : { entries: [value], incompleteLifecycles: [] },
          'HARRecorder stream batch',
        ),
      );
    } catch (error) {
      this.latchFatal(error);
      return;
    }
    const sink = this.sink!;
    this.sinkChain = this.sinkChain
      .then(async () => {
        if (this.fatalError) return;
        await sink(batch);
      })
      .catch((error) => {
        this.latchFatal(error);
      });
  }

  private materialize(current: Generation, body: BodyProvenance, content: HarResponse['content'] = {}): void {
    if (!current.terminal || this.recordedKeys.has(current.key)) return;
    const response = current.redirectResponse ?? current.response;
    const invalid = this.clockViolation(current, current.redirectResponse ? null : current.response?.timestamp ?? null);
    if (invalid) this.install(current, this.invalidClock(current, invalid));
    else {
      const terminal = current.terminal;
      const received = response !== undefined;
      this.install(current, {
        startedDateTime: current.startedDateTime,
        time: (terminal.timestamp - current.requestMonotonic) * 1000,
        request: current.request,
        response: received ? { status: response.status, headers: response.headers, content } : { status: 0, headers: [], content: {} },
        _capture: {
          schemaVersion: 1,
          requestId: current.requestId,
          generation: current.generation,
          clocks: { requestWallTime: current.requestWallTime, requestMonotonic: current.requestMonotonic, responseMonotonic: current.redirectResponse ? null : current.response?.timestamp ?? null, terminalMonotonic: terminal.timestamp },
          terminal: terminal.kind === 'finished' ? { kind: 'finished', encodedDataLength: terminal.encodedDataLength } : terminal.kind === 'redirect' ? { kind: 'redirect' } : { kind: 'failed', errorText: terminal.errorText, canceled: terminal.canceled, blockedReason: terminal.blockedReason, resourceType: terminal.resourceType },
          response: received ? { state: 'received' } : { state: 'unavailable' },
          body,
        },
      });
    }
  }

  private clockViolation(current: Generation, responseTimestamp: number | null): Extract<IncompleteLifecycle, { kind: 'invalid_clock_order' }>['violation'] | null {
    const terminal = current.terminal!;
    if (responseTimestamp !== null && responseTimestamp < current.requestMonotonic) return 'response_before_request';
    if (terminal.timestamp < current.requestMonotonic) return 'terminal_before_request';
    if (responseTimestamp !== null && terminal.timestamp < responseTimestamp) return 'terminal_before_response';
    return null;
  }

  private invalidClock(current: Generation, violation: Extract<IncompleteLifecycle, { kind: 'invalid_clock_order' }>['violation']): IncompleteLifecycle {
    const terminal = current.terminal!;
    const observedResponse = current.redirectResponse ?? current.response;
    return {
      kind: 'invalid_clock_order',
      requestId: current.requestId,
      generation: current.generation,
      startedDateTime: current.startedDateTime,
      request: current.request,
      response: observedResponse ? { status: observedResponse.status, headers: observedResponse.headers, responseMonotonic: current.redirectResponse ? null : current.response!.timestamp } : null,
      terminal: terminal.kind === 'finished' ? { kind: 'finished', terminalMonotonic: terminal.timestamp, encodedDataLength: terminal.encodedDataLength } : terminal.kind === 'redirect' ? { kind: 'redirect', terminalMonotonic: terminal.timestamp } : { kind: 'failed', terminalMonotonic: terminal.timestamp, errorText: terminal.errorText, canceled: terminal.canceled, blockedReason: terminal.blockedReason, resourceType: terminal.resourceType },
      _capture: { schemaVersion: 1, requestWallTime: current.requestWallTime, requestMonotonic: current.requestMonotonic },
      violation,
    };
  }

  private stopped(current: Generation): IncompleteLifecycle {
    return {
      kind: 'stopped_before_terminal', requestId: current.requestId, generation: current.generation, startedDateTime: current.startedDateTime, request: current.request,
      _capture: { schemaVersion: 1, requestWallTime: current.requestWallTime, requestMonotonic: current.requestMonotonic, response: current.response ? { status: current.response.status, headers: current.response.headers, responseMonotonic: current.response.timestamp } : null },
    };
  }

  private stoppedDuringBody(current: Generation): IncompleteLifecycle {
    // Sole call site guards `terminal.kind === 'finished'` — only a finished
    // terminal carries a pending body fetch.
    const terminal = current.terminal as Extract<Terminal, { kind: 'finished' }>;
    const response = current.response!;
    return {
      kind: 'stopped_during_body', requestId: current.requestId, generation: current.generation, startedDateTime: current.startedDateTime, request: current.request,
      response: { status: response.status, headers: response.headers },
      _capture: { schemaVersion: 1, requestWallTime: current.requestWallTime, requestMonotonic: current.requestMonotonic, responseMonotonic: response.timestamp, terminalMonotonic: terminal.timestamp, encodedDataLength: terminal.encodedDataLength },
    };
  }

  private snapshot(partial: boolean): HarFile {
    const ordered = [...this.materializedByKey.values()];
    for (const current of this.activeByRequestId.values()) {
      const invalid = current.terminal ? this.clockViolation(current, current.response?.timestamp ?? null) : null;
      const value = partial && current.bodyPending && current.terminal?.kind === 'finished' && current.response && !invalid
        ? this.stoppedDuringBody(current)
        : current.terminal && invalid
          ? this.invalidClock(current, invalid)
          : this.stopped(current);
      ordered.push({ order: current.order, value });
    }
    ordered.sort((a, b) => a.order - b.order);
    const entries: HAREntry[] = [];
    const incompleteLifecycles: IncompleteLifecycle[] = [];
    for (const { value } of ordered) ('kind' in value ? incompleteLifecycles : entries).push(value as never);
    entries.push(...this.buildWebSocketEntries());
    return { log: { version: '1.2', creator: { name: 'capture', version: captureVersion() }, entries }, incompleteLifecycles };
  }

  private freezeValidated(snapshot: HarFile): HarFile {
    return deepFreeze(validateHarFile(snapshot, 'HARRecorder output'));
  }

  private throwFatal(): void {
    if (this.fatalError) throw this.fatalError;
  }

  /**
   * Streaming health/completion barrier: waits for every body fetch in flight
   * at call time, then for every sink append queued through that point, and
   * throws the latched fatal store error if any work has failed. Work admitted
   * after the call is deliberately not awaited, so the barrier terminates
   * under continuous traffic.
   */
  async flush(): Promise<void> {
    if (!this.sink) throw new Error('flush() requires a streaming HAR recorder (constructed with a sink)');
    this.throwFatal();
    const pending = [...this.bodyTasks];
    if (pending.length > 0) await Promise.all(pending);
    await this.sinkChain;
    this.throwFatal();
  }

  /**
   * Streaming finalizer. Its first synchronous line closes Network-event
   * admission — events arriving after the call cannot allocate, mutate, or
   * append. It then drains pre-cut body work, finalizes the frozen active map
   * exactly once as incomplete lifecycle evidence through the sink, drains
   * those appends, and rejects with the fatal store error if any append or
   * assembly failed. Idempotent: repeat calls settle with the first outcome.
   */
  async drain(): Promise<void> {
    if (!this.sink) throw new Error('drain() requires a streaming HAR recorder (constructed with a sink)');
    this.admissionOpen = false;
    if (this.draining) return this.draining;
    this.throwFatal();
    this.phase = 'finalizing';
    this.draining = (async () => {
      try {
        while (this.bodyTasks.size > 0) await Promise.all([...this.bodyTasks]);
        this.throwFatal();
        for (const current of [...this.activeByRequestId.values()]) {
          if (!current.terminal) this.install(current, this.stopped(current));
          else if (!this.recordedKeys.has(current.key)) this.install(current, this.invalidClock(current, this.clockViolation(current, current.response?.timestamp ?? null)!));
        }
        // WebSocket evidence is finalized exactly once, here — snapshot()
        // covers the snapshot-mode finalizers, so the streaming finalizer
        // must emit each socket's entry through the sink itself.
        for (const entry of this.buildWebSocketEntries()) this.emit(entry);
        await this.sinkChain;
        this.throwFatal();
        this.phase = 'finalized';
      } catch (error) {
        throw this.latchFatal(error);
      }
    })();
    return this.draining;
  }

  async finish(): Promise<HarFile> {
    if (this.sink) throw new Error('finish() is snapshot-only — a streaming HAR recorder finalizes with drain()');
    if (this.finalResult) return this.finalResult;
    this.admissionOpen = false;
    this.throwFatal();
    if (this.finalizing) return this.finalizing;
    this.phase = 'finalizing';
    this.finalizing = (async () => {
      try {
        while (this.bodyTasks.size > 0) await Promise.all([...this.bodyTasks]);
        this.throwFatal();
        for (const current of [...this.activeByRequestId.values()]) {
          if (!current.terminal) this.install(current, this.stopped(current));
          else if (!this.recordedKeys.has(current.key)) this.install(current, this.invalidClock(current, this.clockViolation(current, current.response?.timestamp ?? null)!));
        }
        this.finalResult = this.freezeValidated(this.snapshot(false));
        this.phase = 'finalized';
        return this.finalResult;
      } catch (error) {
        throw this.latchFatal(error);
      }
    })();
    return this.finalizing;
  }

  finishPartial(): HarFile {
    if (this.sink) throw new Error('finishPartial() is snapshot-only — a streaming HAR recorder finalizes with drain()');
    if (this.finalResult) return this.finalResult;
    this.admissionOpen = false;
    this.throwFatal();
    if (this.finalizing) throw new Error('HAR recorder is finalizing with finish()');
    try {
      this.finalResult = this.freezeValidated(this.snapshot(true));
      this.phase = 'finalized';
      return this.finalResult;
    } catch (error) {
      throw this.latchFatal(error);
    }
  }
}
