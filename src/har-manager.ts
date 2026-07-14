/**
 * HAR schema authority — the sole owner of the HAR TypeScript types and their
 * strict runtime validators.
 *
 * `validateHarFile` and `validateHarAppendBatch` are the only sanctioned way to
 * turn parsed JSON into a `HarFile`/`HarAppendBatch`; every consumer (append
 * input, live reads, final `har.json` reads, recorder output, and the
 * pre-commit snapshot at session stop) runs the same validators and never casts
 * parsed JSON to these types. The validators enforce closed schemas: they
 * reject unknown keys, non-plain objects, sparse arrays, non-finite numbers,
 * unknown discriminants, and any value outside the declared domains — no field
 * is ever defaulted or coerced.
 *
 * The `HAR_DIR`/`createHarRecording`/`readHarRecording`/`appendToHarRecording`/
 * `deleteHarRecording` store functions below are the schema-conformant
 * private-artifact implementation for active session and command-owned HAR
 * files. The live store is an append-only NDJSON log below the private session
 * tree: one header record identifying the store format and creator, then one
 * validated `HarAppendBatch` record per append. Each append is a single
 * `O_APPEND` no-follow write of one newline-terminated record — there is no
 * lock and no read-modify-write, so concurrent writers (a command-side append
 * and the recorder's streaming path) interleave whole records instead of
 * contending for a lock. Reads parse the whole log fail-closed through the
 * same validators: an empty store, an unterminated trailing record, a corrupt
 * line, or an unknown shape throws and is never rewritten or recreated.
 */

import crypto from 'node:crypto';
import * as path from 'path';

import {
  appendPrivateFile,
  assertUnderCaptureRoot,
  CAPTURE_ROOT,
  createPrivateFile,
  ensurePrivateDir,
  readPrivateFile,
  unlinkPrivateFile,
} from './session/artifacts.js';

// ── Exported TypeScript schema ───────────────────────────────────────────────

export interface Header {
  name: string;
  value: string;
}

export interface PostData {
  mimeType: string;
  text: string;
}

export interface HarRequest {
  method: string;
  url: string;
  headers: Header[];
  postData?: PostData;
}

export interface HarResponseContent {
  text?: string;
  encoding?: 'base64';
}

export interface HarResponse {
  status: number;
  headers: Header[];
  content: HarResponseContent;
}

export type CaptureTerminal =
  | { kind: 'finished'; encodedDataLength: number }
  | { kind: 'redirect' }
  | {
      kind: 'failed';
      errorText: string;
      canceled: boolean;
      blockedReason: string | null;
      resourceType: string | null;
    };

export interface CaptureClocks {
  requestWallTime: number;
  requestMonotonic: number;
  responseMonotonic: number | null;
  terminalMonotonic: number;
}

export type CaptureResponseState = { state: 'received' } | { state: 'unavailable' };

export type BodyProvenance =
  | {
      state: 'captured';
      sourceEncoding: 'text';
      decodedByteLength: number;
      capturedByteLength: number;
      truncated: boolean;
    }
  | {
      state: 'captured';
      sourceEncoding: 'base64';
      decodedByteLength: number;
      capturedByteLength: number;
      truncated: boolean;
    }
  | { state: 'fetch_failed'; error: string }
  | { state: 'not_applicable'; reason: 'redirect' | 'no_response' | 'network_failed' };

export interface CaptureMeta {
  schemaVersion: 1;
  requestId: string;
  generation: number;
  clocks: CaptureClocks;
  terminal: CaptureTerminal;
  response: CaptureResponseState;
  body: BodyProvenance;
}

export interface HttpHAREntry {
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  _capture: CaptureMeta;
}

/** One WebSocket frame (Chrome DevTools HAR convention): send/receive + payload. */
export interface WebSocketMessage {
  type: 'send' | 'receive';
  time: number;
  opcode: number;
  data: string;
}

/**
 * A WebSocket connection captured as a HAR entry (Chrome DevTools convention):
 * the handshake as request/response (status 0 when the handshake response was
 * never observed) and the frames in `_webSocketMessages`. WebSocket entries
 * carry no HTTP timing and no `_capture` provenance — their lifecycle is the
 * socket's, not a request/terminal pair.
 */
export interface WebSocketHAREntry {
  startedDateTime: string;
  request: HarRequest;
  response: HarResponse;
  _resourceType: 'websocket';
  _webSocketMessages: WebSocketMessage[];
}

export type HAREntry = HttpHAREntry | WebSocketHAREntry;

export type IncompleteLifecycle =
  | {
      kind: 'stopped_before_terminal';
      requestId: string;
      generation: number;
      startedDateTime: string;
      request: HarRequest;
      _capture: {
        schemaVersion: 1;
        requestWallTime: number;
        requestMonotonic: number;
        response: null | { status: number; headers: Header[]; responseMonotonic: number };
      };
    }
  | {
      kind: 'invalid_clock_order';
      requestId: string;
      generation: number;
      startedDateTime: string;
      request: HarRequest;
      response: null | { status: number; headers: Header[]; responseMonotonic: number | null };
      terminal:
        | { kind: 'finished'; terminalMonotonic: number; encodedDataLength: number }
        | { kind: 'redirect'; terminalMonotonic: number }
        | {
            kind: 'failed';
            terminalMonotonic: number;
            errorText: string;
            canceled: boolean;
            blockedReason: string | null;
            resourceType: string | null;
          };
      _capture: { schemaVersion: 1; requestWallTime: number; requestMonotonic: number };
      violation: 'response_before_request' | 'terminal_before_request' | 'terminal_before_response';
    }
  | {
      kind: 'stopped_during_body';
      requestId: string;
      generation: number;
      startedDateTime: string;
      request: HarRequest;
      response: { status: number; headers: Header[] };
      _capture: {
        schemaVersion: 1;
        requestWallTime: number;
        requestMonotonic: number;
        responseMonotonic: number;
        terminalMonotonic: number;
        encodedDataLength: number;
      };
    };

export interface HarFile {
  log: {
    version: '1.2';
    creator: { name: 'capture'; version: string };
    entries: HAREntry[];
  };
  incompleteLifecycles: IncompleteLifecycle[];
}

export interface HarAppendBatch {
  entries: HAREntry[];
  incompleteLifecycles: IncompleteLifecycle[];
}

const MAX_BODY_BYTES = 262144;

// ── Validation primitives ────────────────────────────────────────────────────

function fail(source: string, path: string, message: string): never {
  throw new Error(`HAR validation failed [${source}] at ${path}: ${message}`);
}

function hasOwn(o: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function vObject(v: unknown, source: string, path: string): Record<string, unknown> {
  if (!isPlainObject(v)) fail(source, path, 'must be a plain object');
  return v;
}

function exactKeys(
  o: Record<string, unknown>,
  allowed: readonly string[],
  source: string,
  path: string,
): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) fail(source, `${path}.${k}`, 'is an unknown key');
  }
}

function vArray(v: unknown, source: string, path: string): unknown[] {
  if (!Array.isArray(v)) fail(source, path, 'must be an array');
  for (let i = 0; i < v.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(v, i)) {
      fail(source, `${path}[${i}]`, 'is a sparse-array hole');
    }
  }
  return v;
}

function vString(v: unknown, source: string, path: string): string {
  if (typeof v !== 'string') fail(source, path, 'must be a string');
  return v;
}

function vNonEmptyString(v: unknown, source: string, path: string): string {
  const s = vString(v, source, path);
  if (s.length === 0) fail(source, path, 'must be a nonempty string');
  return s;
}

function vNullableString(v: unknown, source: string, path: string): string | null {
  if (v === null) return null;
  return vString(v, source, path);
}

function vBoolean(v: unknown, source: string, path: string): boolean {
  if (typeof v !== 'boolean') fail(source, path, 'must be a boolean');
  return v;
}

function vLiteral<T extends string | number>(
  v: unknown,
  expected: T,
  source: string,
  path: string,
): T {
  if (v !== expected) fail(source, path, `must equal ${JSON.stringify(expected)}`);
  return expected;
}

function vFinite(v: unknown, source: string, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(source, path, 'must be a finite number');
  return v;
}

function vFiniteMin(v: unknown, min: number, source: string, path: string): number {
  const n = vFinite(v, source, path);
  if (n < min) fail(source, path, `must be >= ${min}`);
  return n;
}

function vIntInRange(v: unknown, lo: number, hi: number, source: string, path: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(source, path, 'must be an integer');
  if (v < lo || v > hi) fail(source, path, `must be an integer in ${lo}..${hi}`);
  return v;
}

function vSafeIntMin(v: unknown, min: number, source: string, path: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) fail(source, path, 'must be a safe integer');
  if (v < min) fail(source, path, `must be a safe integer >= ${min}`);
  return v;
}

function vSafeIntInRange(v: unknown, lo: number, hi: number, source: string, path: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) fail(source, path, 'must be a safe integer');
  if (v < lo || v > hi) fail(source, path, `must be a safe integer in ${lo}..${hi}`);
  return v;
}

/** Canonical UTC ISO instant equal to `new Date(requestWallTime * 1000).toISOString()`. */
function assertStartedDateTime(
  startedDateTime: string,
  requestWallTime: number,
  source: string,
  wallPath: string,
  startedPath: string,
): void {
  const d = new Date(requestWallTime * 1000);
  if (Number.isNaN(d.getTime())) {
    fail(source, wallPath, 'is outside the representable ISO date range');
  }
  if (startedDateTime !== d.toISOString()) {
    fail(source, startedPath, 'must equal new Date(requestWallTime * 1000).toISOString()');
  }
}

// ── Shared shape validators ──────────────────────────────────────────────────

function vHeader(v: unknown, source: string, path: string): Header {
  const o = vObject(v, source, path);
  exactKeys(o, ['name', 'value'], source, path);
  return {
    name: vString(o.name, source, `${path}.name`),
    value: vString(o.value, source, `${path}.value`),
  };
}

function vHeaders(v: unknown, source: string, path: string): Header[] {
  return vArray(v, source, path).map((h, i) => vHeader(h, source, `${path}[${i}]`));
}

function vPostData(v: unknown, source: string, path: string): PostData {
  const o = vObject(v, source, path);
  exactKeys(o, ['mimeType', 'text'], source, path);
  return {
    mimeType: vString(o.mimeType, source, `${path}.mimeType`),
    text: vString(o.text, source, `${path}.text`),
  };
}

function vRequest(v: unknown, source: string, path: string): HarRequest {
  const o = vObject(v, source, path);
  const withPost = hasOwn(o, 'postData');
  exactKeys(o, withPost ? ['method', 'url', 'headers', 'postData'] : ['method', 'url', 'headers'], source, path);
  const req: HarRequest = {
    method: vNonEmptyString(o.method, source, `${path}.method`),
    url: vNonEmptyString(o.url, source, `${path}.url`),
    headers: vHeaders(o.headers, source, `${path}.headers`),
  };
  if (withPost) {
    req.postData = vPostData(o.postData, source, `${path}.postData`);
  }
  return req;
}

function vClocks(v: unknown, source: string, path: string): CaptureClocks {
  const o = vObject(v, source, path);
  exactKeys(o, ['requestWallTime', 'requestMonotonic', 'responseMonotonic', 'terminalMonotonic'], source, path);
  const requestMonotonic = vFiniteMin(o.requestMonotonic, 0, source, `${path}.requestMonotonic`);
  const terminalMonotonic = vFiniteMin(o.terminalMonotonic, 0, source, `${path}.terminalMonotonic`);
  const responseMonotonic =
    o.responseMonotonic === null
      ? null
      : vFiniteMin(o.responseMonotonic, 0, source, `${path}.responseMonotonic`);
  if (terminalMonotonic < requestMonotonic) {
    fail(source, `${path}.terminalMonotonic`, 'must be >= requestMonotonic');
  }
  if (responseMonotonic !== null) {
    if (responseMonotonic < requestMonotonic) {
      fail(source, `${path}.responseMonotonic`, 'must be >= requestMonotonic');
    }
    if (responseMonotonic > terminalMonotonic) {
      fail(source, `${path}.responseMonotonic`, 'must be <= terminalMonotonic');
    }
  }
  return {
    requestWallTime: vFinite(o.requestWallTime, source, `${path}.requestWallTime`),
    requestMonotonic,
    responseMonotonic,
    terminalMonotonic,
  };
}

function vEntryTerminal(v: unknown, source: string, path: string): CaptureTerminal {
  const o = vObject(v, source, path);
  if (o.kind === 'finished') {
    exactKeys(o, ['kind', 'encodedDataLength'], source, path);
    return { kind: 'finished', encodedDataLength: vFiniteMin(o.encodedDataLength, 0, source, `${path}.encodedDataLength`) };
  }
  if (o.kind === 'redirect') {
    exactKeys(o, ['kind'], source, path);
    return { kind: 'redirect' };
  }
  if (o.kind === 'failed') {
    exactKeys(o, ['kind', 'errorText', 'canceled', 'blockedReason', 'resourceType'], source, path);
    return {
      kind: 'failed',
      errorText: vString(o.errorText, source, `${path}.errorText`),
      canceled: vBoolean(o.canceled, source, `${path}.canceled`),
      blockedReason: vNullableString(o.blockedReason, source, `${path}.blockedReason`),
      resourceType: vNullableString(o.resourceType, source, `${path}.resourceType`),
    };
  }
  return fail(source, `${path}.kind`, 'must be "finished", "redirect", or "failed"');
}

function vCaptureResponseState(v: unknown, source: string, path: string): CaptureResponseState {
  const o = vObject(v, source, path);
  exactKeys(o, ['state'], source, path);
  if (o.state === 'received') return { state: 'received' };
  if (o.state === 'unavailable') return { state: 'unavailable' };
  return fail(source, `${path}.state`, 'must be "received" or "unavailable"');
}

function vBodyProvenance(v: unknown, source: string, path: string): BodyProvenance {
  const o = vObject(v, source, path);
  if (o.state === 'captured') {
    if (o.sourceEncoding !== 'text' && o.sourceEncoding !== 'base64') {
      fail(source, `${path}.sourceEncoding`, 'must be "text" or "base64"');
    }
    exactKeys(o, ['state', 'sourceEncoding', 'decodedByteLength', 'capturedByteLength', 'truncated'], source, path);
    const decodedByteLength = vSafeIntMin(o.decodedByteLength, 0, source, `${path}.decodedByteLength`);
    const capturedByteLength = vSafeIntInRange(o.capturedByteLength, 0, MAX_BODY_BYTES, source, `${path}.capturedByteLength`);
    const truncated = vBoolean(o.truncated, source, `${path}.truncated`);
    if (capturedByteLength > decodedByteLength) {
      fail(source, `${path}.capturedByteLength`, 'must not exceed decodedByteLength');
    }
    if (truncated !== capturedByteLength < decodedByteLength) {
      fail(source, `${path}.truncated`, 'must equal (capturedByteLength < decodedByteLength)');
    }
    return { state: 'captured', sourceEncoding: o.sourceEncoding, decodedByteLength, capturedByteLength, truncated };
  }
  if (o.state === 'fetch_failed') {
    exactKeys(o, ['state', 'error'], source, path);
    return { state: 'fetch_failed', error: vNonEmptyString(o.error, source, `${path}.error`) };
  }
  if (o.state === 'not_applicable') {
    exactKeys(o, ['state', 'reason'], source, path);
    if (o.reason !== 'redirect' && o.reason !== 'no_response' && o.reason !== 'network_failed') {
      fail(source, `${path}.reason`, 'must be "redirect", "no_response", or "network_failed"');
    }
    return { state: 'not_applicable', reason: o.reason };
  }
  return fail(source, `${path}.state`, 'must be "captured", "fetch_failed", or "not_applicable"');
}

// ── WebSocket entries (DevTools convention) ──────────────────────────────────

function vWebSocketMessage(v: unknown, source: string, path: string): WebSocketMessage {
  const o = vObject(v, source, path);
  exactKeys(o, ['type', 'time', 'opcode', 'data'], source, path);
  if (o.type !== 'send' && o.type !== 'receive') {
    fail(source, `${path}.type`, 'must be "send" or "receive"');
  }
  return {
    type: o.type,
    time: vFinite(o.time, source, `${path}.time`),
    opcode: vIntInRange(o.opcode, 0, 15, source, `${path}.opcode`),
    data: vString(o.data, source, `${path}.data`),
  };
}

function vWebSocketEntry(o: Record<string, unknown>, source: string, path: string): WebSocketHAREntry {
  exactKeys(o, ['startedDateTime', 'request', 'response', '_resourceType', '_webSocketMessages'], source, path);
  vLiteral(o._resourceType, 'websocket', source, `${path}._resourceType`);
  const startedDateTime = vNonEmptyString(o.startedDateTime, source, `${path}.startedDateTime`);
  const parsed = new Date(startedDateTime);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== startedDateTime) {
    fail(source, `${path}.startedDateTime`, 'must be a canonical UTC ISO instant');
  }
  const request = vRequest(o.request, source, `${path}.request`);
  const respObj = vObject(o.response, source, `${path}.response`);
  exactKeys(respObj, ['status', 'headers', 'content'], source, `${path}.response`);
  const status = vIntInRange(respObj.status, 0, 599, source, `${path}.response.status`);
  if (status !== 0 && status < 100) {
    fail(source, `${path}.response.status`, 'must be 0 (handshake response never observed) or 100..599');
  }
  const respHeaders = vHeaders(respObj.headers, source, `${path}.response.headers`);
  const contentObj = vObject(respObj.content, source, `${path}.response.content`);
  exactKeys(contentObj, [], source, `${path}.response.content`);
  const messages = vArray(o._webSocketMessages, source, `${path}._webSocketMessages`).map((m, i) =>
    vWebSocketMessage(m, source, `${path}._webSocketMessages[${i}]`),
  );
  return {
    startedDateTime,
    request,
    response: { status, headers: respHeaders, content: {} },
    _resourceType: 'websocket',
    _webSocketMessages: messages,
  };
}

// ── HAREntry ─────────────────────────────────────────────────────────────────

function vEntry(v: unknown, source: string, path: string): HAREntry {
  const o = vObject(v, source, path);
  if (hasOwn(o, '_resourceType')) return vWebSocketEntry(o, source, path);
  exactKeys(o, ['startedDateTime', 'time', 'request', 'response', '_capture'], source, path);

  const startedDateTime = vString(o.startedDateTime, source, `${path}.startedDateTime`);
  const time = vFiniteMin(o.time, 0, source, `${path}.time`);
  const request = vRequest(o.request, source, `${path}.request`);

  // Response — structure only; content keys/values are coupled to body below.
  const respObj = vObject(o.response, source, `${path}.response`);
  exactKeys(respObj, ['status', 'headers', 'content'], source, `${path}.response`);
  const status = vIntInRange(respObj.status, 0, 599, source, `${path}.response.status`);
  const respHeaders = vHeaders(respObj.headers, source, `${path}.response.headers`);
  const contentObj = vObject(respObj.content, source, `${path}.response.content`);

  // _capture
  const capObj = vObject(o._capture, source, `${path}._capture`);
  exactKeys(capObj, ['schemaVersion', 'requestId', 'generation', 'clocks', 'terminal', 'response', 'body'], source, `${path}._capture`);
  vLiteral(capObj.schemaVersion, 1, source, `${path}._capture.schemaVersion`);
  const requestId = vNonEmptyString(capObj.requestId, source, `${path}._capture.requestId`);
  const generation = vSafeIntMin(capObj.generation, 1, source, `${path}._capture.generation`);
  const clocks = vClocks(capObj.clocks, source, `${path}._capture.clocks`);
  const terminal = vEntryTerminal(capObj.terminal, source, `${path}._capture.terminal`);
  const capResponse = vCaptureResponseState(capObj.response, source, `${path}._capture.response`);
  const body = vBodyProvenance(capObj.body, source, `${path}._capture.body`);

  // startedDateTime is derived only from request wall time.
  assertStartedDateTime(startedDateTime, clocks.requestWallTime, source, `${path}._capture.clocks.requestWallTime`, `${path}.startedDateTime`);

  // time is derived only from request→terminal monotonic clocks.
  const expectedTime = (clocks.terminalMonotonic - clocks.requestMonotonic) * 1000;
  if (time !== expectedTime) {
    fail(source, `${path}.time`, 'must equal (terminalMonotonic - requestMonotonic) * 1000');
  }

  // Response-state ⇄ status coupling.
  if (capResponse.state === 'received') {
    if (status < 100 || status > 599) {
      fail(source, `${path}.response.status`, 'a received response requires status 100..599');
    }
  } else {
    // unavailable
    if (terminal.kind !== 'failed') {
      fail(source, `${path}._capture.response.state`, '"unavailable" is permitted only for terminal kind "failed"');
    }
    if (status !== 0) fail(source, `${path}.response.status`, 'an unavailable response requires status 0');
    if (respHeaders.length !== 0) fail(source, `${path}.response.headers`, 'an unavailable response requires empty headers');
    if (clocks.responseMonotonic !== null) {
      fail(source, `${path}._capture.clocks.responseMonotonic`, 'must be null when no response was received');
    }
  }
  if (status === 0 && capResponse.state !== 'unavailable') {
    fail(source, `${path}.response.status`, 'status 0 is permitted only when _capture.response.state is "unavailable"');
  }

  // Terminal ⇄ response/status/body coupling.
  if (terminal.kind === 'finished') {
    if (capResponse.state !== 'received') {
      fail(source, `${path}._capture.response.state`, 'a finished terminal requires a received response');
    }
    if (body.state !== 'captured' && body.state !== 'fetch_failed') {
      fail(source, `${path}._capture.body.state`, 'a finished terminal requires body "captured" or "fetch_failed"');
    }
  } else if (terminal.kind === 'redirect') {
    if (capResponse.state !== 'received') {
      fail(source, `${path}._capture.response.state`, 'a redirect requires a received response');
    }
    if (status < 300 || status > 399) {
      fail(source, `${path}.response.status`, 'a redirect requires status 300..399');
    }
    if (body.state !== 'not_applicable' || body.reason !== 'redirect') {
      fail(source, `${path}._capture.body`, 'a redirect requires body not_applicable/redirect');
    }
    if (clocks.responseMonotonic !== null) {
      fail(source, `${path}._capture.clocks.responseMonotonic`, 'must be null for a redirect entry');
    }
  } else {
    // failed
    if (body.state !== 'not_applicable' || (body.reason !== 'no_response' && body.reason !== 'network_failed')) {
      fail(source, `${path}._capture.body`, 'a failed terminal requires body not_applicable/no_response or not_applicable/network_failed');
    }
    if (capResponse.state === 'unavailable' && body.reason !== 'no_response') {
      fail(source, `${path}._capture.body.reason`, 'a failed terminal without a response requires reason "no_response"');
    }
    if (capResponse.state === 'received' && body.reason !== 'network_failed') {
      fail(source, `${path}._capture.body.reason`, 'a failed terminal with a received response requires reason "network_failed"');
    }
  }

  // Content ⇄ body coupling (content.text/encoding are controlled solely by body.state).
  const content: HarResponseContent = {};
  if (body.state === 'captured' && body.sourceEncoding === 'text') {
    exactKeys(contentObj, ['text'], source, `${path}.response.content`);
    const text = vString(contentObj.text, source, `${path}.response.content.text`);
    if (Buffer.byteLength(text, 'utf8') !== body.capturedByteLength) {
      fail(source, `${path}.response.content.text`, 'UTF-8 byte length must equal body.capturedByteLength');
    }
    content.text = text;
  } else if (body.state === 'captured' && body.sourceEncoding === 'base64') {
    exactKeys(contentObj, ['text', 'encoding'], source, `${path}.response.content`);
    const text = vString(contentObj.text, source, `${path}.response.content.text`);
    vLiteral(contentObj.encoding, 'base64', source, `${path}.response.content.encoding`);
    const decoded = Buffer.from(text, 'base64');
    if (decoded.toString('base64') !== text) {
      fail(source, `${path}.response.content.text`, 'must be canonical base64');
    }
    if (decoded.length !== body.capturedByteLength) {
      fail(source, `${path}.response.content.text`, 'decoded byte length must equal body.capturedByteLength');
    }
    if (body.capturedByteLength !== Math.min(body.decodedByteLength, MAX_BODY_BYTES)) {
      fail(source, `${path}._capture.body.capturedByteLength`, 'must equal min(decodedByteLength, 262144) for base64 bodies');
    }
    content.text = text;
    content.encoding = 'base64';
  } else {
    // fetch_failed or not_applicable: both content.text and content.encoding absent.
    exactKeys(contentObj, [], source, `${path}.response.content`);
  }

  return {
    startedDateTime,
    time,
    request,
    response: { status, headers: respHeaders, content },
    _capture: { schemaVersion: 1, requestId, generation, clocks, terminal, response: capResponse, body },
  };
}

// ── IncompleteLifecycle ──────────────────────────────────────────────────────

type IncompleteResponse = { status: number; headers: Header[]; responseMonotonic: number | null };

function vIncompleteResponse(
  v: unknown,
  source: string,
  path: string,
  minResponseMonotonic: number,
): { status: number; headers: Header[]; responseMonotonic: number };
function vIncompleteResponse(
  v: unknown,
  source: string,
  path: string,
  minResponseMonotonic: number,
  allowUnknownClock: true,
): IncompleteResponse;
function vIncompleteResponse(
  v: unknown,
  source: string,
  path: string,
  minResponseMonotonic: number,
  allowUnknownClock = false,
): IncompleteResponse {
  const o = vObject(v, source, path);
  exactKeys(o, ['status', 'headers', 'responseMonotonic'], source, path);
  const responseMonotonic = o.responseMonotonic === null
    ? allowUnknownClock ? null : fail(source, `${path}.responseMonotonic`, 'must be a finite number')
    : vFiniteMin(o.responseMonotonic, minResponseMonotonic, source, `${path}.responseMonotonic`);
  return {
    status: vIntInRange(o.status, 100, 599, source, `${path}.status`),
    headers: vHeaders(o.headers, source, `${path}.headers`),
    responseMonotonic,
  };
}

function vStoppedBeforeTerminal(
  o: Record<string, unknown>,
  source: string,
  path: string,
): Extract<IncompleteLifecycle, { kind: 'stopped_before_terminal' }> {
  exactKeys(o, ['kind', 'requestId', 'generation', 'startedDateTime', 'request', '_capture'], source, path);
  const requestId = vNonEmptyString(o.requestId, source, `${path}.requestId`);
  const generation = vSafeIntMin(o.generation, 1, source, `${path}.generation`);
  const startedDateTime = vString(o.startedDateTime, source, `${path}.startedDateTime`);
  const request = vRequest(o.request, source, `${path}.request`);

  const cap = vObject(o._capture, source, `${path}._capture`);
  exactKeys(cap, ['schemaVersion', 'requestWallTime', 'requestMonotonic', 'response'], source, `${path}._capture`);
  vLiteral(cap.schemaVersion, 1, source, `${path}._capture.schemaVersion`);
  const requestWallTime = vFinite(cap.requestWallTime, source, `${path}._capture.requestWallTime`);
  const requestMonotonic = vFiniteMin(cap.requestMonotonic, 0, source, `${path}._capture.requestMonotonic`);
  const response =
    cap.response === null
      ? null
      : vIncompleteResponse(cap.response, source, `${path}._capture.response`, requestMonotonic);

  assertStartedDateTime(startedDateTime, requestWallTime, source, `${path}._capture.requestWallTime`, `${path}.startedDateTime`);

  return {
    kind: 'stopped_before_terminal',
    requestId,
    generation,
    startedDateTime,
    request,
    _capture: { schemaVersion: 1, requestWallTime, requestMonotonic, response },
  };
}

function vInvalidClockTerminal(
  v: unknown,
  source: string,
  path: string,
): Extract<IncompleteLifecycle, { kind: 'invalid_clock_order' }>['terminal'] {
  const o = vObject(v, source, path);
  if (o.kind === 'finished') {
    exactKeys(o, ['kind', 'terminalMonotonic', 'encodedDataLength'], source, path);
    return {
      kind: 'finished',
      terminalMonotonic: vFiniteMin(o.terminalMonotonic, 0, source, `${path}.terminalMonotonic`),
      encodedDataLength: vFiniteMin(o.encodedDataLength, 0, source, `${path}.encodedDataLength`),
    };
  }
  if (o.kind === 'redirect') {
    exactKeys(o, ['kind', 'terminalMonotonic'], source, path);
    return { kind: 'redirect', terminalMonotonic: vFiniteMin(o.terminalMonotonic, 0, source, `${path}.terminalMonotonic`) };
  }
  if (o.kind === 'failed') {
    exactKeys(o, ['kind', 'terminalMonotonic', 'errorText', 'canceled', 'blockedReason', 'resourceType'], source, path);
    return {
      kind: 'failed',
      terminalMonotonic: vFiniteMin(o.terminalMonotonic, 0, source, `${path}.terminalMonotonic`),
      errorText: vString(o.errorText, source, `${path}.errorText`),
      canceled: vBoolean(o.canceled, source, `${path}.canceled`),
      blockedReason: vNullableString(o.blockedReason, source, `${path}.blockedReason`),
      resourceType: vNullableString(o.resourceType, source, `${path}.resourceType`),
    };
  }
  return fail(source, `${path}.kind`, 'must be "finished", "redirect", or "failed"');
}

function vInvalidClockOrder(
  o: Record<string, unknown>,
  source: string,
  path: string,
): Extract<IncompleteLifecycle, { kind: 'invalid_clock_order' }> {
  exactKeys(o, ['kind', 'requestId', 'generation', 'startedDateTime', 'request', 'response', 'terminal', '_capture', 'violation'], source, path);
  const requestId = vNonEmptyString(o.requestId, source, `${path}.requestId`);
  const generation = vSafeIntMin(o.generation, 1, source, `${path}.generation`);
  const startedDateTime = vString(o.startedDateTime, source, `${path}.startedDateTime`);
  const request = vRequest(o.request, source, `${path}.request`);
  const response =
    o.response === null ? null : vIncompleteResponse(o.response, source, `${path}.response`, 0, true);
  const terminal = vInvalidClockTerminal(o.terminal, source, `${path}.terminal`);

  const cap = vObject(o._capture, source, `${path}._capture`);
  exactKeys(cap, ['schemaVersion', 'requestWallTime', 'requestMonotonic'], source, `${path}._capture`);
  vLiteral(cap.schemaVersion, 1, source, `${path}._capture.schemaVersion`);
  const requestWallTime = vFinite(cap.requestWallTime, source, `${path}._capture.requestWallTime`);
  const requestMonotonic = vFiniteMin(cap.requestMonotonic, 0, source, `${path}._capture.requestMonotonic`);

  let violation: Extract<IncompleteLifecycle, { kind: 'invalid_clock_order' }>['violation'];
  if (o.violation === 'response_before_request') violation = 'response_before_request';
  else if (o.violation === 'terminal_before_request') violation = 'terminal_before_request';
  else if (o.violation === 'terminal_before_response') violation = 'terminal_before_response';
  else return fail(source, `${path}.violation`, 'must be "response_before_request", "terminal_before_request", or "terminal_before_response"');

  assertStartedDateTime(startedDateTime, requestWallTime, source, `${path}._capture.requestWallTime`, `${path}.startedDateTime`);

  // CDP redirectResponse preserves redirect facts but has no independently observed response clock.
  if (terminal.kind === 'redirect') {
    if (response === null) fail(source, `${path}.response`, 'a redirect terminal requires an observed response');
    if (response.status < 300 || response.status > 399) {
      fail(source, `${path}.response.status`, 'a redirect terminal requires status 300..399');
    }
    if (response.responseMonotonic !== null) {
      fail(source, `${path}.response.responseMonotonic`, 'must be null for a redirect terminal');
    }
  } else if (response?.responseMonotonic === null) {
    fail(source, `${path}.response.responseMonotonic`, 'may be null only for a redirect terminal');
  }
  if (violation === 'response_before_request') {
    if (response === null || response.responseMonotonic === null) fail(source, `${path}.violation`, '"response_before_request" requires an observed response clock');
    else if (!(response.responseMonotonic < requestMonotonic)) {
      fail(source, `${path}.violation`, '"response_before_request" requires response.responseMonotonic < requestMonotonic');
    }
  } else if (violation === 'terminal_before_request') {
    if (!(terminal.terminalMonotonic < requestMonotonic)) {
      fail(source, `${path}.violation`, '"terminal_before_request" requires terminal.terminalMonotonic < requestMonotonic');
    }
  } else {
    if (response === null || response.responseMonotonic === null) fail(source, `${path}.violation`, '"terminal_before_response" requires an observed response clock');
    else if (!(terminal.terminalMonotonic < response.responseMonotonic)) {
      fail(source, `${path}.violation`, '"terminal_before_response" requires terminal.terminalMonotonic < response.responseMonotonic');
    }
  }

  return { kind: 'invalid_clock_order', requestId, generation, startedDateTime, request, response, terminal, _capture: { schemaVersion: 1, requestWallTime, requestMonotonic }, violation };
}

function vStoppedDuringBody(
  o: Record<string, unknown>,
  source: string,
  path: string,
): Extract<IncompleteLifecycle, { kind: 'stopped_during_body' }> {
  exactKeys(o, ['kind', 'requestId', 'generation', 'startedDateTime', 'request', 'response', '_capture'], source, path);
  const requestId = vNonEmptyString(o.requestId, source, `${path}.requestId`);
  const generation = vSafeIntMin(o.generation, 1, source, `${path}.generation`);
  const startedDateTime = vString(o.startedDateTime, source, `${path}.startedDateTime`);
  const request = vRequest(o.request, source, `${path}.request`);

  const respObj = vObject(o.response, source, `${path}.response`);
  exactKeys(respObj, ['status', 'headers'], source, `${path}.response`);
  const response = {
    status: vIntInRange(respObj.status, 100, 599, source, `${path}.response.status`),
    headers: vHeaders(respObj.headers, source, `${path}.response.headers`),
  };

  const cap = vObject(o._capture, source, `${path}._capture`);
  exactKeys(cap, ['schemaVersion', 'requestWallTime', 'requestMonotonic', 'responseMonotonic', 'terminalMonotonic', 'encodedDataLength'], source, `${path}._capture`);
  vLiteral(cap.schemaVersion, 1, source, `${path}._capture.schemaVersion`);
  const requestWallTime = vFinite(cap.requestWallTime, source, `${path}._capture.requestWallTime`);
  const requestMonotonic = vFiniteMin(cap.requestMonotonic, 0, source, `${path}._capture.requestMonotonic`);
  const responseMonotonic = vFiniteMin(cap.responseMonotonic, requestMonotonic, source, `${path}._capture.responseMonotonic`);
  const terminalMonotonic = vFiniteMin(cap.terminalMonotonic, responseMonotonic, source, `${path}._capture.terminalMonotonic`);
  const encodedDataLength = vFiniteMin(cap.encodedDataLength, 0, source, `${path}._capture.encodedDataLength`);

  assertStartedDateTime(startedDateTime, requestWallTime, source, `${path}._capture.requestWallTime`, `${path}.startedDateTime`);

  return {
    kind: 'stopped_during_body',
    requestId,
    generation,
    startedDateTime,
    request,
    response,
    _capture: { schemaVersion: 1, requestWallTime, requestMonotonic, responseMonotonic, terminalMonotonic, encodedDataLength },
  };
}

function vIncomplete(v: unknown, source: string, path: string): IncompleteLifecycle {
  const o = vObject(v, source, path);
  if (o.kind === 'stopped_before_terminal') return vStoppedBeforeTerminal(o, source, path);
  if (o.kind === 'invalid_clock_order') return vInvalidClockOrder(o, source, path);
  if (o.kind === 'stopped_during_body') return vStoppedDuringBody(o, source, path);
  return fail(source, `${path}.kind`, 'must be "stopped_before_terminal", "invalid_clock_order", or "stopped_during_body"');
}

// ── Top-level validators ─────────────────────────────────────────────────────

export function validateHarFile(value: unknown, source: string): HarFile {
  const o = vObject(value, source, 'harFile');
  exactKeys(o, ['log', 'incompleteLifecycles'], source, 'harFile');

  const log = vObject(o.log, source, 'harFile.log');
  exactKeys(log, ['version', 'creator', 'entries'], source, 'harFile.log');
  vLiteral(log.version, '1.2', source, 'harFile.log.version');

  const creator = vObject(log.creator, source, 'harFile.log.creator');
  exactKeys(creator, ['name', 'version'], source, 'harFile.log.creator');
  vLiteral(creator.name, 'capture', source, 'harFile.log.creator.name');
  const creatorVersion = vNonEmptyString(creator.version, source, 'harFile.log.creator.version');

  const entries = vArray(log.entries, source, 'harFile.log.entries').map((e, i) => vEntry(e, source, `harFile.log.entries[${i}]`));
  const incompleteLifecycles = vArray(o.incompleteLifecycles, source, 'harFile.incompleteLifecycles').map((c, i) =>
    vIncomplete(c, source, `harFile.incompleteLifecycles[${i}]`),
  );

  return {
    log: { version: '1.2', creator: { name: 'capture', version: creatorVersion }, entries },
    incompleteLifecycles,
  };
}

export function validateHarAppendBatch(value: unknown, source: string): HarAppendBatch {
  const o = vObject(value, source, 'harAppendBatch');
  exactKeys(o, ['entries', 'incompleteLifecycles'], source, 'harAppendBatch');
  const entries = vArray(o.entries, source, 'harAppendBatch.entries').map((e, i) => vEntry(e, source, `harAppendBatch.entries[${i}]`));
  const incompleteLifecycles = vArray(o.incompleteLifecycles, source, 'harAppendBatch.incompleteLifecycles').map((c, i) =>
    vIncomplete(c, source, `harAppendBatch.incompleteLifecycles[${i}]`),
  );
  return { entries, incompleteLifecycles };
}

// ── HAR recording file API (session-owned, private, append-only NDJSON) ─────

export const HAR_DIR = path.join(CAPTURE_ROOT, '.har');

function captureVersion(): string {
  const version = (globalThis as { __CAPTURE_VERSION__?: unknown }).__CAPTURE_VERSION__;
  return typeof version === 'string' && version.length > 0 ? version : 'development';
}

function token(): string {
  return crypto.randomBytes(6).toString('hex');
}

/** The store's first NDJSON record — written once at creation; every read
 * requires it, so any file that is not a capture live-HAR append log (including
 * an empty file) fails closed at the header. */
interface HarStoreHeader {
  format: 'capture-live-har-ndjson';
  version: 1;
  creator: { name: 'capture'; version: string };
}

function vStoreHeader(value: unknown, source: string): HarStoreHeader {
  const o = vObject(value, source, 'harStoreHeader');
  exactKeys(o, ['format', 'version', 'creator'], source, 'harStoreHeader');
  vLiteral(o.format, 'capture-live-har-ndjson', source, 'harStoreHeader.format');
  vLiteral(o.version, 1, source, 'harStoreHeader.version');
  const creator = vObject(o.creator, source, 'harStoreHeader.creator');
  exactKeys(creator, ['name', 'version'], source, 'harStoreHeader.creator');
  vLiteral(creator.name, 'capture', source, 'harStoreHeader.creator.name');
  const version = vNonEmptyString(creator.version, source, 'harStoreHeader.creator.version');
  return { format: 'capture-live-har-ndjson', version: 1, creator: { name: 'capture', version } };
}

/**
 * Resolves an identifier or absolute path to the canonical HAR JSON path.
 * Identifiers without separators are also treated as absolute paths for legacy
 * callers that only persist a token.
 */
export function harFilePath(id: string): string {
  if (path.isAbsolute(id)) return assertUnderCaptureRoot(id);
  if (path.basename(id) === id) return assertUnderCaptureRoot(path.resolve(CAPTURE_ROOT, id));
  if (id.endsWith('.json') && id.includes(path.sep)) return assertUnderCaptureRoot(id);
  return assertUnderCaptureRoot(path.resolve(id));
}

export async function createHarRecording(sessionDir: string = CAPTURE_ROOT): Promise<{ id: string; path: string }> {
  const sessionAbsolute = path.resolve(sessionDir);
  assertUnderCaptureRoot(sessionAbsolute);
  const harDir = path.join(sessionAbsolute, '.har');
  ensurePrivateDir(harDir);

  const header: HarStoreHeader = {
    format: 'capture-live-har-ndjson',
    version: 1,
    creator: { name: 'capture', version: captureVersion() },
  };
  const headerLine = `${JSON.stringify(header)}\n`;
  for (;;) {
    const candidate = path.join(harDir, `${token()}.json`);
    // O_EXCL creation: a token collision loses to the existing store instead of
    // replacing it.
    try {
      createPrivateFile(candidate, headerLine);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
    return { id: candidate, path: candidate };
  }
}

export async function readHarRecording(id: string): Promise<HarFile> {
  const target = harFilePath(id);
  const source = `live HAR recording ${target}`;
  let raw: string;
  try {
    raw = readPrivateFile(target).toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`live HAR recording is missing — cannot read: ${target}`, { cause: error });
    }
    throw error;
  }
  if (raw.length === 0) fail(source, 'store', 'is empty — a live HAR store always begins with its header record');
  if (!raw.endsWith('\n')) fail(source, 'store', 'ends with an unterminated record — the store is corrupt');
  const lines = raw.slice(0, -1).split('\n');
  const parseLine = (line: string, index: number): unknown => {
    if (line.length === 0) fail(source, `store line ${index + 1}`, 'is empty');
    try {
      return JSON.parse(line);
    } catch {
      return fail(source, `store line ${index + 1}`, 'is not valid JSON');
    }
  };

  const header = vStoreHeader(parseLine(lines[0], 0), source);
  const entries: HAREntry[] = [];
  const incompleteLifecycles: IncompleteLifecycle[] = [];
  for (let i = 1; i < lines.length; i++) {
    const batch = validateHarAppendBatch(parseLine(lines[i], i), `${source} line ${i + 1}`);
    entries.push(...batch.entries);
    incompleteLifecycles.push(...batch.incompleteLifecycles);
  }
  return {
    log: { version: '1.2', creator: header.creator, entries },
    incompleteLifecycles,
  };
}

export async function appendToHarRecording(id: string, batch: HarAppendBatch): Promise<void> {
  if (batch.entries.length === 0 && batch.incompleteLifecycles.length === 0) return;

  const safeBatch = validateHarAppendBatch(batch, `har append batch ${id}`);
  const target = harFilePath(id);
  try {
    // One O_APPEND no-follow write of one newline-terminated record. The file
    // is opened without O_CREAT: appending to a missing (deleted) store fails
    // explicitly and never recreates it.
    appendPrivateFile(target, `${JSON.stringify(safeBatch)}\n`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`live HAR recording is missing — cannot append: ${target}`, { cause: error });
    }
    throw error;
  }
}

export async function deleteHarRecording(id: string): Promise<void> {
  unlinkPrivateFile(harFilePath(id));
}
