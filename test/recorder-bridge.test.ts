import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { CAPTURE_ROOT } from '../src/session/artifacts.js';
import { listenNdjsonSocket, closeNdjsonSocket } from '../src/cdp/bridge/server.js';
import { recorderSocketPath } from '../src/cdp/bridge/spawn.js';
import {
  RecorderSession,
  handleRecorderRequest,
  OBSERVER_INSTALLED_SENTINEL,
  type RecorderCdpClient,
} from '../src/cdp/recorder-bridge.js';
import { type RecorderRequest, type RecorderResponse } from '../src/cdp/bridge/protocol.js';

// A 1x1 transparent PNG, base64-encoded — stands in for a screencast frame's `data`.
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/**
 * Stands in for `CDPClient` — implements exactly the surface
 * `RecorderCdpClient` needs (`send`/`on`/`onDisconnect`/`close`) and lets
 * the test fire fake CDP events (`fire()`) the way a real websocket would
 * dispatch them. No real Chrome, no real websocket.
 */
class StubCdpClient extends EventEmitter implements RecorderCdpClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  private perfNow = 100;
  private nextIsolatedWorldContextId = 1000;
  /** The execution context id of the MOST RECENT isolated world `Page.createIsolatedWorld` handed
   * out — the origin a legitimate `Runtime.bindingCalled` must carry (the recorder scopes the
   * binding to that world and rejects foreign-origin calls). `fireBinding` defaults to it. */
  lastIsolatedWorldContextId = 0;

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    switch (method) {
      case 'Page.getFrameTree':
        return { frameTree: { frame: { id: 'stub-frame-1' } } };
      case 'Page.createIsolatedWorld':
        this.lastIsolatedWorldContextId = this.nextIsolatedWorldContextId;
        return { executionContextId: this.nextIsolatedWorldContextId++ };
      case 'Runtime.evaluate': {
        const expression = String((params as { expression?: unknown }).expression ?? '');
        if (expression.includes('MutationObserver')) {
          // The observer-injection script confirms a clean install by returning the sentinel the
          // recorder validates before publishing the isolated world's context id. Checked before
          // the clock-baseline branch below because the injected script's own emit() closure also
          // contains the substring `performanceNowMs: performance.now()`.
          return { result: { value: OBSERVER_INSTALLED_SENTINEL } };
        }
        if (expression.includes('performanceNowMs: performance.now()')) {
          this.perfNow += 1;
          return { result: { value: { performanceNowMs: this.perfNow, wallClockMs: 1_700_000_000_000 + this.perfNow } } };
        }
        if (expression === 'performance.now()') {
          this.perfNow += 1;
          return { result: { value: this.perfNow } };
        }
        if (expression.includes('querySelectorAll')) {
          return {
            result: {
              value: [{ tag: 'div', id: null, classes: 'box', x: 1, y: 2, width: 30, height: 40 }],
            },
          };
        }
        // The stop-time teardown call and other bridge drains.
        return { result: {} };
      }
      case 'Tracing.end':
        // Emit synchronously, before this resolves \u2014 RecorderSession.stop()
        // registers its EventBroker listener before awaiting this call.
        this.emit('Tracing.tracingComplete', {});
        return {};
      default:
        return {};
    }
  }

  on(event: string, handler: (params: unknown) => void): void {
    super.on(event, handler);
  }

  onDisconnect(handler: () => void): void {
    super.on('__disconnect', handler);
  }

  close(): void {
    // No-op for the stub \u2014 nothing to tear down.
  }

  fire(event: string, params: unknown): void {
    this.emit(event, params);
  }

  /** Fires a `Runtime.bindingCalled` the way the recorder's scoped binding would deliver one —
   * carrying the isolated world's execution context id as its origin (defaulting to the most
   * recently created world). A test proving the origin gate overrides `executionContextId` with a
   * foreign value. */
  fireBinding(payload: string, opts: { executionContextId?: number } = {}): void {
    this.emit('Runtime.bindingCalled', {
      name: 'captureRecorderEmit',
      payload,
      executionContextId: opts.executionContextId ?? this.lastIsolatedWorldContextId,
    });
  }

  callsFor(method: string): Array<{ method: string; params?: Record<string, unknown> }> {
    return this.calls.filter((c) => c.method === method);
  }
}

function freshRecDir(label: string): string {
  fs.mkdirSync(CAPTURE_ROOT, { recursive: true });
  return path.join(CAPTURE_ROOT, `recorder-bridge-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function readNdjson(filePath: string): unknown[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

async function tick(ms = 20): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * The recorder's per-recording binding nonce is private — not exported for tests to read
 * directly. It IS embedded, in plaintext, in the `Runtime.evaluate` call that injects the
 * observer script (`var NONCE = "...";`), exactly as a real browser would receive it. Extracting
 * it from the stub's recorded call args is how a test fabricates a valid `Runtime.bindingCalled`
 * payload without a testing-only backdoor on `RecorderSession`.
 */
function extractBindingNonce(client: StubCdpClient): string {
  const evaluateCalls = client.callsFor('Runtime.evaluate');
  for (const call of evaluateCalls) {
    const expression = String(call.params?.expression ?? '');
    const match = expression.match(/var NONCE = "([0-9a-f]+)";/);
    if (match) return match[1];
  }
  throw new Error('observer script injection call not found — was session.start() called?');
}

/** Same as `extractBindingNonce`, but scans from the MOST RECENT `Runtime.evaluate` call
 * backwards — used when a test shares one `StubCdpClient` (one "world") across two
 * `RecorderSession` start/stop cycles and needs THIS cycle's nonce, not the first one ever
 * injected. */
function extractLatestBindingNonce(client: StubCdpClient): string {
  const evaluateCalls = client.callsFor('Runtime.evaluate');
  for (let i = evaluateCalls.length - 1; i >= 0; i--) {
    const expression = String(evaluateCalls[i].params?.expression ?? '');
    const match = expression.match(/var NONCE = "([0-9a-f]+)";/);
    if (match) return match[1];
  }
  throw new Error('observer script injection call not found — was session.start() called?');
}

/** A GitHub fine-grained PAT shape — matches the shared redactor's `GH_PAT_RE`/`GH_PAT_EMBEDDED_RE`, long enough to clear the 16-char secret-shape floor. */
const SECRET_TOKEN = 'github_pat_' + '1'.repeat(40);

test('rec-start enables motion-rec domains, arms screencast/tracing/observers, returns clock baselines', async () => {
  const recDir = freshRecDir('start');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    const markers = await session.start();

    assert.equal(session.state, 'recording');
    assert.equal(typeof markers.performanceNowMs, 'number');
    assert.equal(typeof markers.wallClockMs, 'number');

    const methods = client.calls.map((c) => c.method);
    assert.ok(methods.includes('Page.enable'));
    assert.ok(methods.includes('DOM.enable'));
    assert.ok(methods.includes('Runtime.enable'));
    assert.ok(methods.includes('Network.enable'));
    assert.ok(methods.includes('Animation.enable'));
    assert.ok(methods.includes('Runtime.addBinding'));
    assert.ok(methods.includes('Page.startScreencast'));
    assert.ok(methods.includes('Tracing.start'));

    // frames/ dir exists, private mode, no frames yet.
    assert.ok(fs.statSync(session.framesDir).isDirectory());
    assert.equal(fs.statSync(session.framesDir).mode & 0o777, 0o700);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('rec-start twice from the same session rejects instead of re-arming', async () => {
  const recDir = freshRecDir('double-start');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });
  try {
    await session.start();
    await assert.rejects(() => session.start(), /cannot start/i);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('screencast frames write frame PNGs and rects.jsonl incrementally, and are acked', async () => {
  const recDir = freshRecDir('frames');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();

    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 12.5 }, sessionId: 7 });
    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 12.6 }, sessionId: 8 });
    await tick();

    const frameFiles = fs.readdirSync(session.framesDir).sort();
    assert.deepEqual(frameFiles, ['frame-000000.png', 'frame-000001.png']);
    assert.equal(fs.statSync(path.join(session.framesDir, 'frame-000000.png')).mode & 0o777, 0o600);
    const written = fs.readFileSync(path.join(session.framesDir, 'frame-000000.png'));
    assert.deepEqual(written, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'));

    const rects = readNdjson(session.rectsPath) as Array<{
      frame: number;
      file: string;
      screencastTimestamp: number | null;
      elements: Array<{ tag: string; width: number; height: number }>;
    }>;
    assert.equal(rects.length, 2);
    assert.equal(rects[0].frame, 0);
    assert.equal(rects[0].file, 'frame-000000.png');
    assert.equal(rects[0].screencastTimestamp, 12.5);
    assert.equal(rects[0].elements.length, 1);
    assert.equal(rects[0].elements[0].tag, 'div');
    assert.equal(rects[1].screencastTimestamp, 12.6);

    const acks = client.callsFor('Page.screencastFrameAck');
    assert.equal(acks.length, 2);
    assert.equal(acks[0].params?.sessionId, 7);
    assert.equal(acks[1].params?.sessionId, 8);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a marked cdp request brackets the dispatch and appends an input landmark to events.jsonl', async () => {
  const recDir = freshRecDir('marked-cdp');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();

    const { result } = await session.handleCdp({
      reqId: 1,
      type: 'cdp',
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mousePressed', x: 10, y: 20 },
      mark: 'input_click',
    });
    // The stub's default branch echoes {} for unrecognized methods.
    assert.deepEqual(result, {});

    const events = readNdjson(session.eventsPath) as Array<{
      kind: string;
      mark?: string;
      method?: string;
      startPerformanceNow?: number;
      endPerformanceNow?: number;
    }>;
    const inputEvents = events.filter((e) => e.kind === 'input');
    assert.equal(inputEvents.length, 1);
    assert.equal(inputEvents[0].action, 'input_click');
    assert.match(String(inputEvents[0].mark), /^mark-[a-f0-9]{64}$/);
    assert.equal(inputEvents[0].method, 'Input.dispatchMouseEvent');
    assert.equal(typeof inputEvents[0].startPerformanceNow, 'number');
    assert.equal(typeof inputEvents[0].endPerformanceNow, 'number');
    assert.ok(inputEvents[0].endPerformanceNow! >= inputEvents[0].startPerformanceNow!);

    // An unmarked cdp request does NOT get logged as an input landmark.
    await session.handleCdp({ reqId: 2, type: 'cdp', method: 'DOM.enable' });
    const afterUnmarked = readNdjson(session.eventsPath).filter((e) => (e as { kind: string }).kind === 'input');
    assert.equal(afterUnmarked.length, 1);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('Tracing.dataCollected batches and injected-observer bindingCalled entries append to events.jsonl', async () => {
  const recDir = freshRecDir('observer-events');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();

    const nonce = extractBindingNonce(client);
    client.fire('Tracing.dataCollected', { value: [{ name: 'Layout', ts: 1000 }, { name: 'Paint', ts: 1010 }] });
    client.fireBinding(JSON.stringify({ kind: 'mutation', performanceNowMs: 55, count: 3, nonce }));
    // A bindingCalled from an unrelated binding name must be ignored.
    client.fire('Runtime.bindingCalled', { name: 'someOtherBinding', payload: '{}' });
    await tick();

    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    const trace = events.find((e) => e.kind === 'trace');
    assert.ok(trace, 'expected a trace-kind event');
    assert.equal((trace!.events as unknown[]).length, 2);

    const mutation = events.find((e) => e.kind === 'mutation');
    assert.ok(mutation, 'expected a mutation-kind event from the injected observer');
    assert.equal(mutation!.count, 3);
    assert.equal(mutation!.performanceNowMs, 55);
    assert.equal(typeof mutation!.recordedAtWallClockMs, 'number');

    assert.equal(events.length, 2, 'the unrelated binding name must not produce a third event');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('rec-stop stops screencast/tracing, tears down observers, and returns frame/event counts', async () => {
  const recDir = freshRecDir('stop');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 1 }, sessionId: 1 });
    await tick();
    await session.handleCdp({ reqId: 1, type: 'cdp', method: 'Input.dispatchMouseEvent', mark: 'input_click' });

    const summary = await session.stop();

    assert.equal(session.state, 'stopped');
    assert.equal(summary.frameCount, 1);
    assert.equal(summary.eventCount, 1, 'one marked input landmark logged before stop');
    assert.equal(typeof summary.durationMs, 'number');
    assert.ok(summary.durationMs >= 0);

    const methods = client.calls.map((c) => c.method);
    assert.ok(methods.includes('Page.stopScreencast'));
    assert.ok(methods.includes('Tracing.end'));
    assert.ok(methods.includes('Runtime.removeBinding'));

    // Graceful: stopping again (or starting again) is a clean error, not a throw/crash.
    await assert.rejects(() => session.stop(), /cannot stop/i);
    await assert.rejects(() => session.start(), /cannot start/i);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('stop is best-effort against a dying tab \u2014 CDP calls throwing does not throw stop() itself', async () => {
  const recDir = freshRecDir('stop-best-effort');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  let dying = false;
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    if (dying && (method === 'Page.stopScreencast' || method === 'Runtime.evaluate' || method === 'Runtime.removeBinding')) {
      throw new Error('tab is gone');
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    dying = true;
    const summary = await session.stop();
    assert.equal(session.state, 'stopped');
    assert.equal(summary.frameCount, 0);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('handleRecorderRequest dispatches rec-start/cdp/rec-stop with matching reqId + type, and turns a bad rec-stop into an ok:false response', async () => {
  const recDir = freshRecDir('dispatch');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    const badStop = await handleRecorderRequest(session, { reqId: 9, type: 'rec-stop' });
    assert.equal(badStop.ok, false);
    assert.equal(badStop.type, 'rec-stop');
    assert.equal(badStop.reqId, 9);
    assert.match((badStop as { error: string }).error, /cannot stop/i);

    const started = await handleRecorderRequest(session, { reqId: 1, type: 'rec-start' });
    assert.equal(started.ok, true);
    assert.equal(started.type, 'rec-start');
    assert.equal(started.reqId, 1);
    assert.ok('markers' in started && typeof started.markers.performanceNowMs === 'number');

    const cdp = await handleRecorderRequest(session, {
      reqId: 2,
      type: 'cdp',
      method: 'DOM.enable',
    });
    assert.equal(cdp.ok, true);
    assert.equal(cdp.type, 'cdp');
    assert.equal(cdp.reqId, 2);

    const stopped = await handleRecorderRequest(session, { reqId: 3, type: 'rec-stop' });
    assert.equal(stopped.ok, true);
    assert.equal(stopped.type, 'rec-stop');
    assert.ok('frameCount' in stopped);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('the recorder speaks the same one-request-per-connection NDJSON wire shape over a real unix socket', async () => {
  const recDir = freshRecDir('wire');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });
  // Unix socket paths are capped (~104 chars on macOS) — bind under the
  // system tmp root directly rather than nesting under the (longer) recDir,
  // which is how production code (`recorderSocketPath`) would still be fine
  // for its own, shorter, recDir names.
  const socketPath = path.join(os.tmpdir(), `rb-${process.pid}-${Math.random().toString(36).slice(2, 8)}.sock`);

  async function handleLine(line: string, socket: net.Socket): Promise<void> {
    const req = JSON.parse(line) as RecorderRequest;
    const resp = await handleRecorderRequest(session, req);
    socket.write(JSON.stringify(resp) + '\n');
  }

  const server = await listenNdjsonSocket(socketPath, handleLine);

  function sendOverSocket(req: RecorderRequest): Promise<RecorderResponse> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath);
      let buffer = '';
      socket.on('connect', () => socket.write(JSON.stringify(req) + '\n'));
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf-8');
        const idx = buffer.indexOf('\n');
        if (idx < 0) return;
        socket.end();
        resolve(JSON.parse(buffer.slice(0, idx)) as RecorderResponse);
      });
      socket.on('error', reject);
    });
  }

  try {
    const startResp = await sendOverSocket({ reqId: 1, type: 'rec-start' });
    assert.equal(startResp.ok, true);
    assert.equal(startResp.type, 'rec-start');
    assert.equal(startResp.reqId, 1);

    const cdpResp = await sendOverSocket({
      reqId: 2,
      type: 'cdp',
      method: 'Input.dispatchMouseEvent',
      mark: 'input_click',
    });
    assert.equal(cdpResp.ok, true);
    assert.equal(cdpResp.type, 'cdp');
    assert.equal(cdpResp.reqId, 2);

    const stopResp = await sendOverSocket({ reqId: 3, type: 'rec-stop' });
    assert.equal(stopResp.ok, true);
    assert.equal(stopResp.type, 'rec-stop');
    assert.equal(stopResp.reqId, 3);
    assert.ok('eventCount' in stopResp && stopResp.eventCount === 1);
  } finally {
    closeNdjsonSocket(server, socketPath);
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Socket path length: `recorderSocketPath()` itself, not a hand-rolled short
// path under `os.tmpdir()`, must produce a bindable socket even for a
// realistic, deep session recording directory.
// ---------------------------------------------------------------------------

test('recorderSocketPath() stays short and bindable for a realistic, deep session rec path', async () => {
  // Mirrors the real production shape (`{CAPTURE_ROOT}/{session}/motion/recs/{recId}`) with
  // generously long session/recId segments \u2014 long enough that naively nesting the socket
  // inside this directory would risk exceeding the ~104-byte macOS AF_UNIX pathname limit
  // once combined with a real (often long) `os.tmpdir()` prefix, which is exactly why the
  // socket path below is derived independently of recDir.
  const session = `cap-${'a'.repeat(24)}`;
  const recId = `rec-${'b'.repeat(24)}`;
  const recDir = path.join(CAPTURE_ROOT, session, 'motion', 'recs', recId);
  fs.mkdirSync(recDir, { recursive: true });

  const socketPath = recorderSocketPath(recDir);
  try {
    assert.ok(
      Buffer.byteLength(socketPath, 'utf-8') <= 100,
      `socket path should stay well under the AF_UNIX length limit, got ${socketPath.length} bytes: ${socketPath}`,
    );
    // The socket must NOT be nested inside recDir \u2014 recDir's own length/depth must not affect
    // the socket path (that's the whole point of separating them).
    assert.ok(!socketPath.startsWith(recDir), 'socket path must not be nested under recDir');

    async function handleLine(line: string, socket: net.Socket): Promise<void> {
      socket.write(line);
    }
    const server = await listenNdjsonSocket(socketPath, handleLine);
    try {
      assert.equal(fs.statSync(path.dirname(socketPath)).mode & 0o777, 0o700);
    } finally {
      closeNdjsonSocket(server, socketPath);
    }
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('recorderSocketPath() is deterministic per recDir and distinct across different recDirs', () => {
  const recDirA = path.join(CAPTURE_ROOT, 'cap-aaa', 'motion', 'recs', 'rec-aaa');
  const recDirB = path.join(CAPTURE_ROOT, 'cap-bbb', 'motion', 'recs', 'rec-bbb');
  assert.equal(recorderSocketPath(recDirA), recorderSocketPath(recDirA));
  assert.notEqual(recorderSocketPath(recDirA), recorderSocketPath(recDirB));
});

// ---------------------------------------------------------------------------
// rec-start's clock baselines start pending (no screencast frame or trace
// event can possibly exist yet); rec-stop's response is the flush path that
// returns the completed triple.
// ---------------------------------------------------------------------------

test('markers start pending at rec-start and flush complete at rec-stop once a frame/trace event arrived', async () => {
  const recDir = freshRecDir('markers-flush');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    const startMarkers = await session.start();
    assert.equal(startMarkers.firstScreencastTimestampSec, null);
    assert.equal(startMarkers.firstTraceEventTsUs, null);
    assert.equal(startMarkers.baselinesPending, true);

    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 42.5 }, sessionId: 1 });
    client.fire('Tracing.dataCollected', { value: [{ name: 'Layout', ts: 9000 }] });
    await tick();

    const summary = await session.stop();
    assert.equal(summary.markers.firstScreencastTimestampSec, 42.5);
    assert.equal(summary.markers.firstTraceEventTsUs, 9000);
    assert.equal(summary.markers.baselinesPending, false);
    // The performance.now/wall-clock anchor from rec-start is preserved through to the flush.
    assert.equal(summary.markers.performanceNowMs, startMarkers.performanceNowMs);
    assert.equal(summary.markers.wallClockMs, startMarkers.wallClockMs);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// First-baseline race \u2014 `Page.screencastFrame`/`Tracing.dataCollected` can only
// fire after `Page.startScreencast`/`Tracing.start` are issued, so the first-frame/
// first-trace latch storage (`this.baselines`) must exist BEFORE those two sends,
// not after. A frame/trace firing from inside the still-awaited `start()` sequence
// must still latch, not be discarded by a `this.baselines === null` window.
// ---------------------------------------------------------------------------

test('the first screencast frame/trace batch firing during the awaited start() sequence still latches (no pre-baseline race window)', async () => {
  const recDir = freshRecDir('start-race');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    // Simulate Chrome emitting the very first screencast frame / trace batch
    // synchronously, from inside the still-awaited `start()` sequence, immediately
    // after each stream is armed \u2014 before `start()` itself has returned.
    if (method === 'Page.startScreencast') {
      client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 777.5 }, sessionId: 1 });
    }
    if (method === 'Tracing.start') {
      client.fire('Tracing.dataCollected', { value: [{ name: 'Layout', ts: 5555 }] });
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    await tick();
    const summary = await session.stop();

    assert.equal(
      summary.markers.firstScreencastTimestampSec,
      777.5,
      'the first frame fired mid-start must latch, not be discarded by a null-baseline race',
    );
    assert.equal(
      summary.markers.firstTraceEventTsUs,
      5555,
      'the first trace batch fired mid-start must latch, not be discarded by a null-baseline race',
    );
    assert.equal(summary.markers.baselinesPending, false);
    assert.equal(summary.frameCount, 1);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The binding channel is untrusted: nonce, kind whitelist, field caps,
// payload size, and rate all get enforced, with drops summarized (not
// silently discarded, not written verbatim) into events.jsonl.
// ---------------------------------------------------------------------------

test('binding payloads without the recording nonce, with an unknown kind, or oversized are dropped and summarized at stop', async () => {
  const recDir = freshRecDir('binding-hardening');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    const nonce = extractBindingNonce(client);

    // Valid: accepted.
    client.fireBinding(JSON.stringify({ kind: 'mutation', performanceNowMs: 1, count: 1, types: ['childList'], evilField: 'x'.repeat(10), nonce }));
    // Wrong/missing nonce: dropped.
    client.fireBinding(JSON.stringify({ kind: 'mutation', performanceNowMs: 2, count: 1, nonce: 'not-the-real-nonce' }));
    // Unknown kind (not one of the observer's own whitelisted kinds \u2014 in particular a
    // host-only kind like 'input'/'error' must not be forgeable from the page): dropped.
    client.fireBinding(JSON.stringify({ kind: 'input', performanceNowMs: 3, mark: 'forged', nonce }));
    // Oversized payload: dropped before JSON.parse even runs.
    client.fireBinding(JSON.stringify({ kind: 'mutation', nonce, count: 1, types: ['x'.repeat(20000)] }));
    await tick();

    const summary = await session.stop();
    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;

    const accepted = events.filter((e) => e.kind === 'mutation');
    assert.equal(accepted.length, 1, 'only the correctly-nonced, whitelisted payload is accepted');
    assert.equal(accepted[0].count, 1);
    assert.deepEqual(accepted[0].types, ['childList']);
    assert.equal('evilField' in accepted[0], false, 'fields outside the kind\'s whitelist are stripped');

    const drops = events.filter((e) => e.kind === 'binding-dropped');
    assert.ok(drops.length > 0, 'drops are summarized into events.jsonl, not silently discarded');
    const reasons = drops.map((d) => d.reason);
    assert.ok(reasons.includes('bad-nonce'));
    assert.ok(reasons.includes('unknown-kind'));
    assert.ok(reasons.includes('oversized-payload'));
    assert.ok(summary.eventCount >= 1 + drops.length);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('the binding channel rate-caps events per second, dropping the excess and summarizing it', async () => {
  const recDir = freshRecDir('binding-rate-limit');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    const nonce = extractBindingNonce(client);

    const fired = 400;
    for (let i = 0; i < fired; i++) {
      client.fireBinding(JSON.stringify({ kind: 'mutation', performanceNowMs: i, count: 1, nonce }));
    }
    await tick();

    const summary = await session.stop();
    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    const accepted = events.filter((e) => e.kind === 'mutation');
    assert.ok(accepted.length < fired, 'the rate cap must drop some of a burst well above any reasonable per-second budget');

    const rateLimitDrop = events.find((e) => e.kind === 'binding-dropped' && e.reason === 'rate-limited');
    assert.ok(rateLimitDrop, 'a rate-limited drop summary must be written');
    assert.ok((rateLimitDrop!.count as number) > 0);
    assert.equal(summary.eventCount, events.length);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('an oversized binding payload is measured by UTF-8 byte length, not UTF-16 .length, so a multi-byte payload under the .length cap is still dropped', async () => {
  const recDir = freshRecDir('binding-byte-length');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    // Each '\u3042' is 1 UTF-16 code unit (`.length`) but 3 UTF-8 bytes. 3000 of them: `.length`
    // is 3000 (comfortably under the 8192-byte cap by a `.length`-only check) while
    // `Buffer.byteLength(..., 'utf8')` is 9000 (over the cap) — exactly the gap a `.length`
    // check misses and measuring real UTF-8 bytes catches.
    const oversizedMultiByte = '\u3042'.repeat(3000);
    assert.ok(oversizedMultiByte.length < 8 * 1024, 'sanity: .length must stay under the byte cap');
    assert.ok(Buffer.byteLength(oversizedMultiByte, 'utf8') > 8 * 1024, 'sanity: the UTF-8 byte length must exceed the cap');

    client.fireBinding(oversizedMultiByte);
    await tick();

    const summary = await session.stop();
    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    const oversizedDrop = events.find((e) => e.kind === 'binding-dropped' && e.reason === 'oversized-payload');
    assert.ok(oversizedDrop, 'a multi-byte payload over the UTF-8 byte cap must be dropped and summarized as oversized-payload');
    assert.equal(
      events.filter((e) => e.kind !== 'binding-dropped' && e.kind !== 'trace-dropped' && e.kind !== 'rect-sample-dropped').length,
      0,
      'the oversized payload must never reach JSON.parse or be written verbatim as any other event kind',
    );
    assert.ok(summary.eventCount >= 1);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Rect-sampling hardening \u2014 the SAME hostile-page threat class as the binding
// channel above, via a different path: `sampleRects()`'s `Runtime.evaluate` result
// is page-controlled DOM data read in the isolated world and must be re-validated host-side
// (element-count cap, finite-coordinate checks, tag/id/class string caps, total byte budget),
// not just trusted because the injected script has its own cap.
// ---------------------------------------------------------------------------

test('a hostile rect sample is capped/sanitized host-side before it reaches rects.jsonl, with drops summarized', async () => {
  const recDir = freshRecDir('rect-hardening');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    const expression = String((params as { expression?: unknown }).expression ?? '');
    if (method === 'Runtime.evaluate' && expression.includes('querySelectorAll')) {
      const hostile: unknown[] = [];
      // A non-object entry \u2014 must be dropped, not crash the sanitizer.
      hostile.push('not-an-object');
      // Non-finite coordinates \u2014 must be dropped, not written as Infinity/NaN.
      hostile.push({ tag: 'div', id: null, classes: null, x: Infinity, y: NaN, width: 1, height: 1 });
      // A flood of otherwise-well-shaped elements with grossly oversized id/className
      // strings, far beyond both the element-count cap and the serialized-byte budget \u2014
      // simulates a hostile page forcing a huge CDP return payload + rects.jsonl write.
      for (let i = 0; i < 3000; i++) {
        hostile.push({
          tag: 'div',
          // A hyphen embedded mid-string keeps this from accidentally matching the shared
          // redactor's base64/hex secret-shape test (a pure run of one repeated letter DOES
          // match that shape) — this fixture is testing the byte-budget cap, not redaction.
          id: 'x'.repeat(1000) + '-' + 'x'.repeat(999),
          classes: 'y'.repeat(1000) + '-' + 'y'.repeat(999),
          x: i,
          y: i,
          width: 10,
          height: 10,
        });
      }
      return { result: { value: hostile } };
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 1 }, sessionId: 1 });
    await tick();

    const rects = readNdjson(session.rectsPath) as Array<{
      elements: Array<{ id: string | null; classes: string | null; x: number; y: number }>;
    }>;
    assert.equal(rects.length, 1);
    const elements = rects[0].elements;

    // The 3000-plus hostile elements must not all land \u2014 the host enforces its own
    // element-count cap and byte budget regardless of what the page returned.
    assert.ok(elements.length < 3000, `expected the host guard to cap the sample, got ${elements.length} elements`);
    assert.ok(elements.length <= 2000, 'the element-count cap must hold host-side');
    for (const el of elements) {
      assert.ok((el.id?.length ?? 0) <= 256, 'id must be length-capped host-side, not written verbatim');
      assert.ok((el.classes?.length ?? 0) <= 256, 'classes must be length-capped host-side, not written verbatim');
      assert.ok(Number.isFinite(el.x) && Number.isFinite(el.y), 'kept elements must have finite coordinates');
    }

    const summary = await session.stop();
    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    const drops = events.filter((e) => e.kind === 'rect-sample-dropped');
    assert.ok(drops.length > 0, 'drops/truncation are summarized into events.jsonl, not silently discarded');
    const reasons = drops.map((d) => d.reason);
    assert.ok(reasons.includes('invalid-shape'), 'the non-object entry must be tallied as invalid-shape');
    assert.ok(reasons.includes('non-finite-coords'), 'the Infinity/NaN entry must be tallied as non-finite-coords');
    assert.ok(reasons.includes('byte-budget'), 'the oversized flood must trip the serialized-byte budget');
    assert.equal(summary.eventCount, events.length);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// stop() must await in-flight screencast-frame handling (the PNG write + its
// rect sample) rather than returning while it's still fire-and-forget in
// flight.
// ---------------------------------------------------------------------------

test('stop() awaits an in-flight screencast frame handler (including its rect sample) before returning', async () => {
  const recDir = freshRecDir('flush-frames');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  let delayNextRectSample = false;
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    if (delayNextRectSample && method === 'Runtime.evaluate' && String((params as { expression?: unknown }).expression ?? '').includes('querySelectorAll')) {
      delayNextRectSample = false;
      await new Promise((r) => setTimeout(r, 40));
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    delayNextRectSample = true;
    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 1 }, sessionId: 1 });
    // No tick() here \u2014 stop() is called immediately, racing the still-in-flight frame handler
    // (whose promise was already registered synchronously by the `Page.screencastFrame` listener).
    const summary = await session.stop();

    assert.equal(summary.frameCount, 1);
    const rects = readNdjson(session.rectsPath);
    assert.equal(rects.length, 1, "the in-flight frame's rect sample must be flushed before stop() resolves");
    assert.equal(fs.readdirSync(session.framesDir).length, 1);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// A mid-recording main-frame navigation destroys the page's JS world; the
// recorder recreates the isolated world, reinjects the observer script, and
// records a navigation-gap marker — issuing no new binding request, because the
// name-scoped binding auto-reattaches to the recreated world.
// ---------------------------------------------------------------------------

test('a main-frame navigation mid-recording re-injects the observer script (without re-issuing Runtime.addBinding) and records a navigation-gap marker', async () => {
  const recDir = freshRecDir('nav-rearm');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    const addBindingCallsBefore = client.callsFor('Runtime.addBinding').length;
    const evaluateCallsBefore = client.callsFor('Runtime.evaluate').length;

    client.fire('Page.frameNavigated', { frame: { id: 'main', url: 'https://example.com/next' } });
    await tick();

    assert.equal(
      client.callsFor('Runtime.addBinding').length,
      addBindingCallsBefore,
      'the rearm must not re-issue Runtime.addBinding — the binding survives navigation, only the JS world does not',
    );
    assert.ok(client.callsFor('Runtime.evaluate').length > evaluateCallsBefore);

    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    const gap = events.find((e) => e.kind === 'navigation-gap');
    assert.ok(gap, 'a navigation-gap marker must be recorded');
    assert.equal(gap!.url, 'https://example.com/next');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a post-navigation rearm reinjects the observer into a fresh isolated world and never issues a second Runtime.addBinding', async () => {
  const recDir = freshRecDir('nav-rearm-single-binding');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    assert.equal(
      client.callsFor('Runtime.addBinding').length,
      1,
      'start() issues exactly one Runtime.addBinding',
    );
    const createWorldCallsBeforeNav = client.callsFor('Page.createIsolatedWorld').length;
    const evaluateCallsBeforeNav = client.callsFor('Runtime.evaluate').length;

    client.fire('Page.frameNavigated', { frame: { id: 'main', url: 'https://example.com/next' } });
    await tick();

    assert.equal(
      client.callsFor('Runtime.addBinding').length,
      1,
      'the rearm reinjects the observer into a fresh world without a second Runtime.addBinding — the name-scoped binding auto-reattaches to the recreated world',
    );
    assert.ok(
      client.callsFor('Page.createIsolatedWorld').length > createWorldCallsBeforeNav,
      'the rearm creates a fresh isolated world',
    );
    assert.ok(
      client.callsFor('Runtime.evaluate').length > evaluateCallsBeforeNav,
      'the observer script is re-injected into the fresh world',
    );
    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    assert.equal(
      events.filter((e) => e.kind === 'error').length,
      0,
      'a clean rearm surfaces no error',
    );
    const gap = events.find((e) => e.kind === 'navigation-gap');
    assert.ok(gap, 'a navigation-gap marker must still be recorded');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a sub-frame navigation does not re-arm the binding/observer or record a gap', async () => {
  const recDir = freshRecDir('nav-subframe');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    const addBindingCallsBefore = client.callsFor('Runtime.addBinding').length;

    client.fire('Page.frameNavigated', { frame: { id: 'iframe-1', parentId: 'main', url: 'https://example.com/iframe' } });
    await tick();

    assert.equal(client.callsFor('Runtime.addBinding').length, addBindingCallsBefore);
    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    assert.equal(events.filter((e) => e.kind === 'navigation-gap').length, 0);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// stop() finalization race — state flips to 'stopping' at the very top of
// stop(), before any await, so a routed cdp request or a navigation arriving
// mid-teardown is rejected/ignored rather than racing the teardown sends;
// trace/binding data is discarded only once fully 'stopped', not while merely
// 'stopping' (a batch/emission can legitimately still land in that window).
// ---------------------------------------------------------------------------

test('a routed cdp request arriving after stop() has flipped state is rejected, not dispatched', async () => {
  const recDir = freshRecDir('stop-race-cdp');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  let delayStopScreencast = false;
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    if (delayStopScreencast && method === 'Page.stopScreencast') {
      delayStopScreencast = false;
      await new Promise((r) => setTimeout(r, 30));
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    delayStopScreencast = true;
    const stopPromise = session.stop();
    // stop() flips state synchronously, before its first await resolves.
    assert.equal(session.state, 'stopping');

    await assert.rejects(
      () => session.handleCdp({ reqId: 1, type: 'cdp', method: 'DOM.enable' }),
      /cannot dispatch cdp/i,
      'a cdp request arriving once the recorder has left "recording" must be rejected, not dispatched against a connection mid-teardown',
    );
    await stopPromise;
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('handleCdp on an idle (unstarted) session proceeds to protocol/wait handling, not a state rejection — the teardown guard only fires once stop() has begun', async () => {
  const recDir = freshRecDir('idle-handlecdp');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    assert.equal(session.state, 'idle');

    // A wait-event-only request on an idle session registers and resolves once the event
    // fires — it must reach wait-registration, not throw a state error first.
    const pending = session.handleCdp({ reqId: 1, type: 'cdp', waitEvent: 'Foo.bar', timeoutMs: 2000 });
    await tick(10);
    client.fire('Foo.bar', { hello: 'world' });
    const outcome = await pending;
    assert.deepEqual(outcome, { event: { hello: 'world' } });

    // A request with neither method nor waitEvent on an idle session yields the protocol-shape
    // error — the teardown-window guard only rejects once stop() has begun, so an idle session
    // reaches shape validation instead of a state rejection.
    await assert.rejects(
      () => session.handleCdp({ reqId: 2, type: 'cdp' }),
      /requires a nonempty string "method".*or "waitEvent"/i,
      'an idle session must reach protocol/shape validation, not a state rejection',
    );
    assert.equal(session.state, 'idle', 'handleCdp must not itself change session state');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a routed cdp request dispatched once stop() has flipped state to "stopped" is still rejected', async () => {
  const recDir = freshRecDir('stopped-handlecdp');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    await session.stop();
    assert.equal(session.state, 'stopped');

    await assert.rejects(
      () => session.handleCdp({ reqId: 1, type: 'cdp', method: 'DOM.enable' }),
      /cannot dispatch cdp/i,
      'a cdp request dispatched once the recorder is fully stopped must still be rejected by the narrowed teardown-window guard',
    );
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a Page.frameNavigated event arriving after stop() has flipped state does not trigger a rearm, and stop()\'s eventCount matches events.jsonl', async () => {
  const recDir = freshRecDir('stop-race-nav');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  let delayStopScreencast = false;
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    if (delayStopScreencast && method === 'Page.stopScreencast') {
      delayStopScreencast = false;
      await new Promise((r) => setTimeout(r, 30));
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    const observerEvaluateCallsBefore = client
      .callsFor('Runtime.evaluate')
      .filter((c) => String(c.params?.expression ?? '').includes('MutationObserver')).length;

    delayStopScreencast = true;
    const stopPromise = session.stop();
    client.fire('Page.frameNavigated', { frame: { id: 'main', url: 'https://example.com/mid-stop' } });
    const summary = await stopPromise;

    const observerEvaluateCallsAfter = client
      .callsFor('Runtime.evaluate')
      .filter((c) => String(c.params?.expression ?? '').includes('MutationObserver')).length;
    assert.equal(
      observerEvaluateCallsAfter,
      observerEvaluateCallsBefore,
      'a navigation arriving mid-stop must not re-inject the observer script',
    );

    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    assert.equal(
      events.filter((e) => e.kind === 'navigation-gap').length,
      0,
      'a navigation arriving mid-stop must not record a navigation-gap either — the recorder is no longer recording',
    );
    assert.equal(summary.eventCount, events.length, "stop()'s reported eventCount must match the actual line count written to events.jsonl");
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('stop() awaits ALL overlapping pre-stop rearms, not just the most recently fired one', async () => {
  const recDir = freshRecDir('overlapping-rearms');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  // Gates every post-start observer-script re-injection (`Runtime.evaluate` containing
  // `MutationObserver`) behind a manually-released promise, so two overlapping
  // `Page.frameNavigated` rearms can be proven both still in flight at once, and released in
  // whichever order the test needs.
  let gateRearms = false;
  const releases: Array<() => void> = [];
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    const expression = String((params as { expression?: unknown }).expression ?? '');
    if (gateRearms && method === 'Runtime.evaluate' && expression.includes('MutationObserver')) {
      await new Promise<void>((resolve) => releases.push(resolve));
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    gateRearms = true;

    // Two main-frame navigations fire while neither rearm's observer-script evaluate has
    // resolved yet — both must be tracked as in-flight simultaneously.
    client.fire('Page.frameNavigated', { frame: { id: 'main', url: 'https://example.com/first' } });
    client.fire('Page.frameNavigated', { frame: { id: 'main', url: 'https://example.com/second' } });
    await tick(5);
    assert.equal(releases.length, 2, 'both overlapping rearms must have reached their gated Runtime.evaluate before either resolves');

    // Settle the SECOND-fired rearm first, before stop() is even called — the interleaving a
    // single last-write-wins slot gets wrong: it forgets about the still-pending FIRST rearm the
    // instant the second one (the one occupying the slot) settles.
    releases[1]();
    await tick(20);

    let stopSettled = false;
    const stopPromise = session.stop().then((summary) => {
      stopSettled = true;
      return summary;
    });

    await tick(20);
    assert.equal(
      stopSettled,
      false,
      'stop() must still be waiting on the first rearm, which has not settled yet, even though the second (more recently fired) rearm already has',
    );

    releases[0]();
    await stopPromise;
    assert.equal(stopSettled, true, 'stop() completes only once every in-flight rearm has settled');
    assert.equal(session.state, 'stopped');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('trace/binding events arriving after the recorder is fully stopped are discarded, not appended', async () => {
  const recDir = freshRecDir('stop-discard-late');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    const nonce = extractBindingNonce(client);
    await session.stop();
    assert.equal(session.state, 'stopped');
    const eventsBefore = readNdjson(session.eventsPath).length;

    client.fire('Tracing.dataCollected', { value: [{ name: 'Late', ts: 9999 }] });
    client.fireBinding(JSON.stringify({ kind: 'mutation', performanceNowMs: 1, count: 1, nonce }));
    await tick();

    const eventsAfter = readNdjson(session.eventsPath);
    assert.equal(eventsAfter.length, eventsBefore, 'no new events must be appended once the recorder is fully stopped');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('trace/binding events arriving during the stopping window (before full stop resolves) are still captured', async () => {
  const recDir = freshRecDir('stopping-still-captures');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  let delayTracingEnd = false;
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    if (delayTracingEnd && method === 'Tracing.end') {
      delayTracingEnd = false;
      await new Promise((r) => setTimeout(r, 30));
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    const nonce = extractBindingNonce(client);
    delayTracingEnd = true;
    const stopPromise = session.stop();
    // 'stopping', not yet 'stopped' — a batch/emission legitimately landing in this window
    // (e.g. between Tracing.end and tracingComplete) must still be captured.
    client.fire('Tracing.dataCollected', { value: [{ name: 'DuringStop', ts: 500 }] });
    client.fireBinding(JSON.stringify({ kind: 'mutation', performanceNowMs: 1, count: 2, nonce }));
    await stopPromise;

    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    assert.ok(
      events.some((e) => e.kind === 'trace' && (e.events as Array<{ name?: string }>).some((ev) => ev.name === 'DuringStop')),
      'a trace batch arriving during the stopping window must still be captured',
    );
    assert.ok(
      events.some((e) => e.kind === 'mutation' && e.count === 2),
      'a binding-channel emission arriving during the stopping window must still be captured',
    );
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Every recorder page-controlled string routes through the shared
// secret-redaction authority (redact-then-cap), not a length-only sanitizer.
// ---------------------------------------------------------------------------

test('a secret-shaped rect id/classes is redacted (not just length-capped) before it reaches rects.jsonl', async () => {
  const recDir = freshRecDir('rect-id-classes-secret-redaction');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    const expression = String((params as { expression?: unknown }).expression ?? '');
    if (method === 'Runtime.evaluate' && expression.includes('querySelectorAll')) {
      return {
        result: {
          value: [{ tag: 'div', id: SECRET_TOKEN, classes: `box ${SECRET_TOKEN} active`, x: 1, y: 2, width: 10, height: 10 }],
        },
      };
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 1 }, sessionId: 1 });
    await tick();

    const rectsRaw = fs.readFileSync(session.rectsPath, 'utf-8');
    assert.ok(rectsRaw.includes(SECRET_TOKEN), 'browser evidence is retained verbatim in rects.jsonl');

    const rects = readNdjson(session.rectsPath) as Array<{ elements: Array<{ id: string | null; classes: string | null }> }>;
    assert.equal(rects[0].elements[0].id, SECRET_TOKEN);
    assert.equal(rects[0].elements[0].classes, `box ${SECRET_TOKEN} active`);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a secret-shaped performance-entry name from the observer binding is redacted before it reaches events.jsonl', async () => {
  const recDir = freshRecDir('perf-name-secret-redaction');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    const nonce = extractBindingNonce(client);

    client.fireBinding(JSON.stringify({
      kind: 'performance',
      performanceNowMs: 1,
      entryType: 'mark',
      name: SECRET_TOKEN,
      startTime: 1,
      duration: 0,
      nonce,
    }));
    await tick();

    const eventsRaw = fs.readFileSync(session.eventsPath, 'utf-8');
    assert.ok(eventsRaw.includes(SECRET_TOKEN), 'browser evidence is retained verbatim in events.jsonl');

    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    const perf = events.find((e) => e.kind === 'performance');
    assert.ok(perf, 'expected a performance-kind event');
    assert.equal(perf!.name, SECRET_TOKEN);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a secret-shaped navigation-gap URL is redacted before it reaches events.jsonl', async () => {
  const recDir = freshRecDir('navgap-url-secret-redaction');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();

    client.fire('Page.frameNavigated', { frame: { id: 'main', url: `https://example.com/next?token=${SECRET_TOKEN}` } });
    await tick();

    const eventsRaw = fs.readFileSync(session.eventsPath, 'utf-8');
    assert.ok(eventsRaw.includes(SECRET_TOKEN), 'browser evidence is retained verbatim in events.jsonl');

    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    const gap = events.find((e) => e.kind === 'navigation-gap');
    assert.ok(gap);
    assert.ok(String(gap!.url).includes(SECRET_TOKEN));
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a secret-shaped mark label is redacted before the input landmark is written to events.jsonl', async () => {
  const recDir = freshRecDir('mark-label-secret-redaction');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    await session.handleCdp({
      reqId: 1,
      type: 'cdp',
      method: 'Input.dispatchMouseEvent',
      mark: SECRET_TOKEN,
    });

    const eventsRaw = fs.readFileSync(session.eventsPath, 'utf-8');
    assert.ok(eventsRaw.includes(SECRET_TOKEN), 'the original action is retained verbatim in events.jsonl');

    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    const input = events.find((e) => e.kind === 'input');
    assert.ok(input);
    assert.equal(input!.action, SECRET_TOKEN);
    assert.notEqual(input!.mark, SECRET_TOKEN);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a mark label secret that straddles the truncation boundary is fully redacted, not sliced into a raw partial fragment', async () => {
  const recDir = freshRecDir('mark-boundary-secret');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });
  // MAX_MARK_LABEL_LENGTH is 128. A 120-char run + a space puts the following SECRET_TOKEN
  // (51 chars, `github_pat_` + 40 digits) starting at index 121 — straddling the 128 boundary,
  // so a slice-then-redact order would cut the token mid-string and leave its first 7 raw
  // characters ("github_") past the redaction check's 16-char minimum run length.
  const prefix = 'x'.repeat(120);
  const boundaryStraddlingMark = `${prefix} ${SECRET_TOKEN}`;

  try {
    await session.start();
    await session.handleCdp({
      reqId: 1,
      type: 'cdp',
      method: 'Input.dispatchMouseEvent',
      mark: boundaryStraddlingMark,
    });

    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    const input = events.find((e) => e.kind === 'input');
    assert.ok(input, 'expected an input landmark');
    assert.equal(input!.action, boundaryStraddlingMark, 'the original action remains verbatim evidence');
    assert.match(String(input!.mark), /^mark-[a-f0-9]{64}$/, 'the internal structural mark remains distinct');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Trace batches are whitelisted (no `args`), redacted+capped, and bounded by
// event count + serialized bytes, with drops summarized.
// ---------------------------------------------------------------------------

test('an appended trace event drops args entirely and redacts+caps name, so no secret in args can reach events.jsonl', async () => {
  const recDir = freshRecDir('trace-args-dropped-name-redaction');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();

    client.fire('Tracing.dataCollected', {
      value: [
        {
          name: 'x'.repeat(400),
          cat: 'devtools.timeline',
          ph: 'X',
          ts: 1000,
          dur: 5,
          pid: 1,
          tid: 2,
          args: { data: { url: `https://example.com/?token=${SECRET_TOKEN}`, secret: SECRET_TOKEN } },
        },
      ],
    });
    await tick();

    const eventsRaw = fs.readFileSync(session.eventsPath, 'utf-8');
    assert.ok(!eventsRaw.includes(SECRET_TOKEN), 'no secret from a trace event\'s args can reach events.jsonl');

    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    const trace = events.find((e) => e.kind === 'trace') as { events: Array<Record<string, unknown>> } | undefined;
    assert.ok(trace);
    assert.equal(trace!.events.length, 1);
    const sanitizedEvent = trace!.events[0];
    assert.equal('args' in sanitizedEvent, false, 'args must be dropped outright, not whitelisted through');
    assert.ok((sanitizedEvent.name as string).length <= 256, 'name must be capped');
    assert.equal(sanitizedEvent.ts, 1000);
    assert.equal(sanitizedEvent.pid, 1);
    assert.equal(sanitizedEvent.tid, 2);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a trace batch exceeding the event cap is truncated with a trace-dropped summary, while still capturing the baseline ts', async () => {
  const recDir = freshRecDir('trace-event-cap');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();

    const totalEvents = 600;
    const batch = Array.from({ length: totalEvents }, (_, i) => ({ name: `evt-${i}`, ts: 1000 + i }));
    client.fire('Tracing.dataCollected', { value: batch });
    await tick();

    const summary = await session.stop();
    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    const trace = events.find((e) => e.kind === 'trace') as { events: unknown[] } | undefined;
    assert.ok(trace);
    assert.ok(trace!.events.length <= 500, 'the per-batch event cap must be enforced');

    const drop = events.find((e) => e.kind === 'trace-dropped' && e.reason === 'event-cap');
    assert.ok(drop, 'an event-cap trace-dropped summary must be written, not a silent truncation');
    assert.equal((drop!.count as number), totalEvents - trace!.events.length);

    assert.equal(summary.markers.firstTraceEventTsUs, 1000, 'the baseline ts is still captured from the RAW batch, unaffected by the cap');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The injected observer's page-global identity is nonce-scoped, so a page
// cannot preseed/trap a fixed name to skip install, and a fresh recording
// (new nonce) always installs regardless of a leftover prior one.
// ---------------------------------------------------------------------------

test('the injected observer script keys its global off the nonce, never the bare fixed name a page could preseed/trap', async () => {
  const recDir = freshRecDir('nonce-scoped-observer-inject');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    const nonce = extractBindingNonce(client);

    const injectCall = client
      .callsFor('Runtime.evaluate')
      .find((c) => String(c.params?.expression ?? '').includes('MutationObserver'));
    assert.ok(injectCall, 'expected the observer-injection Runtime.evaluate call');
    const expression = String(injectCall!.params?.expression ?? '');

    assert.ok(expression.includes("KEY = '__captureRecorder_' + NONCE"), 'the global key must be built from this recording\'s nonce');
    assert.ok(expression.includes(`"${nonce}"`), 'the nonce must be embedded verbatim');
    assert.ok(!expression.includes('window.__captureRecorder ='), 'must never assign a page-guessable bare fixed-name global');
    assert.ok(!expression.includes('if (window.__captureRecorder)'), 'the idempotency guard must not check a page-guessable bare fixed name');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('rec-stop\'s teardown evaluate targets the nonce-scoped key, never the bare fixed name a page could trap', async () => {
  const recDir = freshRecDir('nonce-scoped-teardown');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    const nonce = extractBindingNonce(client);
    await session.stop();

    const teardownCall = client
      .callsFor('Runtime.evaluate')
      .find((c) => String(c.params?.expression ?? '').includes('.teardown()'));
    assert.ok(teardownCall, 'expected a teardown Runtime.evaluate call at stop()');
    const expression = String(teardownCall!.params?.expression ?? '');

    assert.ok(expression.includes(nonce), 'teardown must target THIS recording\'s nonce-scoped key');
    assert.ok(!expression.includes('window.__captureRecorder &&'), 'teardown must never trust a page-reachable bare fixed-name global');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('two recordings on the same world use distinct nonce-scoped keys, so a leftover prior-cycle global cannot block the next install', async () => {
  const recDir1 = freshRecDir('nonce-scoped-cycle-1');
  const recDir2 = freshRecDir('nonce-scoped-cycle-2');
  // Deliberately the SAME StubCdpClient ("world"/page) across both recordings — exactly the
  // scenario where a fixed-name global would leak state from cycle 1 into cycle 2.
  const client = new StubCdpClient();
  const session1 = new RecorderSession({ client, recDir: recDir1 });
  const session2 = new RecorderSession({ client, recDir: recDir2 });

  try {
    await session1.start();
    const nonce1 = extractLatestBindingNonce(client);
    await session1.stop();

    await session2.start();
    const nonce2 = extractLatestBindingNonce(client);

    assert.notEqual(nonce1, nonce2, 'each recording must mint its own nonce, scoping a distinct global key');

    const secondInject = client
      .callsFor('Runtime.evaluate')
      .filter((c) => String(c.params?.expression ?? '').includes('MutationObserver'))
      .at(-1);
    assert.ok(secondInject);
    assert.ok(
      String(secondInject!.params?.expression ?? '').includes(`"${nonce2}"`),
      "the second recording's inject script must embed its own nonce, not the first's",
    );
  } finally {
    fs.rmSync(recDir1, { recursive: true, force: true });
    fs.rmSync(recDir2, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Element identity: every rect-sample element and resize target carries a real
// backendNodeId resolved via the nonce-scoped identity bridge, or an honest
// backendNodeId: null + identityUnresolved: true when that bridge is unavailable
// or capped — never a fabricated id, never a silently-omitted field.
// ---------------------------------------------------------------------------

test('a rects.jsonl element carries backendNodeId: null + identityUnresolved: true when the identity bridge is unavailable', async () => {
  const recDir = freshRecDir('i3-rect-unresolved');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 1 }, sessionId: 1 });
    await tick();

    const rects = readNdjson(session.rectsPath) as Array<{ elements: Array<Record<string, unknown>> }>;
    assert.equal(rects.length, 1);
    assert.equal(rects[0].elements.length, 1);
    assert.equal(rects[0].elements[0].backendNodeId, null);
    assert.equal(rects[0].elements[0].identityUnresolved, true);
    assert.equal('elementIdentity' in rects[0], false, 'no elementIdentity field is present on a rects.jsonl element');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a rects.jsonl element carries a real backendNodeId when the identity bridge resolves', async () => {
  const recDir = freshRecDir('i3-rect-resolved');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    const expression = String((params as { expression?: unknown }).expression ?? '');
    if (method === 'Runtime.evaluate' && expression.includes('h.takeRectElements(')) {
      return { result: { objectId: 'rect-array-1' } };
    }
    if (method === 'Runtime.getProperties' && params.objectId === 'rect-array-1') {
      return { result: [{ name: '0', value: { objectId: 'rect-el-0' } }] };
    }
    if (method === 'DOM.describeNode' && params.objectId === 'rect-el-0') {
      return { node: { backendNodeId: 4242 } };
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 1 }, sessionId: 1 });
    await tick();

    const rects = readNdjson(session.rectsPath) as Array<{ elements: Array<Record<string, unknown>> }>;
    assert.equal(rects[0].elements[0].backendNodeId, 4242);
    assert.equal('identityUnresolved' in rects[0].elements[0], false);
    assert.ok(client.callsFor('Runtime.releaseObject').some((c) => c.params?.objectId === 'rect-array-1'), 'the array handle must be released');
    assert.ok(client.callsFor('Runtime.releaseObject').some((c) => c.params?.objectId === 'rect-el-0'), 'the per-element handle must be released');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a resize target carries backendNodeId: null + identityUnresolved: true when the identity bridge is unavailable', async () => {
  const recDir = freshRecDir('i3-resize-unresolved');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    const nonce = extractBindingNonce(client);

    client.fireBinding(JSON.stringify({
      kind: 'resize',
      performanceNowMs: 1,
      seq: 1,
      count: 1,
      targets: [{ tag: 'DIV', width: 10, height: 20 }],
      nonce,
    }));
    await tick();

    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    const resize = events.find((e) => e.kind === 'resize');
    assert.ok(resize, 'expected a resize-kind event');
    const target = (resize!.targets as Array<Record<string, unknown>>)[0];
    assert.equal(target.backendNodeId, null);
    assert.equal(target.identityUnresolved, true);
    assert.equal('targetsJoinable' in resize!, false, 'no targetsJoinable field is present on a resize event');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a resize target carries a real backendNodeId when the identity bridge resolves', async () => {
  const recDir = freshRecDir('i3-resize-resolved');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    const expression = String((params as { expression?: unknown }).expression ?? '');
    if (method === 'Runtime.evaluate' && expression.includes('h.takeResizeTargets(')) {
      return { result: { objectId: 'resize-array-1' } };
    }
    if (method === 'Runtime.getProperties' && params.objectId === 'resize-array-1') {
      return { result: [{ name: '0', value: { objectId: 'resize-el-0' } }] };
    }
    if (method === 'DOM.describeNode' && params.objectId === 'resize-el-0') {
      return { node: { backendNodeId: 7777 } };
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    const nonce = extractBindingNonce(client);

    client.fireBinding(JSON.stringify({
      kind: 'resize',
      performanceNowMs: 1,
      seq: 9,
      count: 1,
      targets: [{ tag: 'DIV', width: 10, height: 20 }],
      nonce,
    }));
    await tick();

    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    const resize = events.find((e) => e.kind === 'resize');
    const target = (resize!.targets as Array<Record<string, unknown>>)[0];
    assert.equal(target.backendNodeId, 7777);
    assert.equal('identityUnresolved' in target, false);
    assert.ok(client.callsFor('Runtime.releaseObject').some((c) => c.params?.objectId === 'resize-array-1'));
    assert.ok(client.callsFor('Runtime.releaseObject').some((c) => c.params?.objectId === 'resize-el-0'));
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Honest screencast-timestamp precision: the raw wall-clock value carries an
// explicit "this is frame-cadence-bounded, not sub-ms exact" fact.
// ---------------------------------------------------------------------------

test('every rects.jsonl record carries screencastTimestampPrecision: frame-metadata alongside the raw nullable screencastTimestamp', async () => {
  const recDir = freshRecDir('screencast-timestamp-precision');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 12.5 }, sessionId: 1 });
    // A frame whose metadata carries no timestamp — screencastTimestamp is null, but the
    // precision fact is still present (it describes the FIELD, not a particular value).
    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: {}, sessionId: 2 });
    await tick();

    const rects = readNdjson(session.rectsPath) as Array<{ screencastTimestamp: number | null; screencastTimestampPrecision?: string }>;
    assert.equal(rects.length, 2);
    for (const rec of rects) {
      assert.equal(rec.screencastTimestampPrecision, 'frame-metadata');
    }
    assert.equal(rects[0].screencastTimestamp, 12.5);
    assert.equal(rects[1].screencastTimestamp, null);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The marked-CDP-request mechanism brackets with performance.now() reads
// only; it must never evaluate a page-visible performance.mark(...).
// ---------------------------------------------------------------------------

test('a marked cdp request never evaluates performance.mark(...) into the page, but still appends the host-side input landmark', async () => {
  const recDir = freshRecDir('no-page-visible-mark');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    await session.handleCdp({
      reqId: 1,
      type: 'cdp',
      method: 'Input.dispatchMouseEvent',
      params: { type: 'mousePressed', x: 1, y: 2 },
      mark: 'input_click',
    });

    const markCalls = client.callsFor('Runtime.evaluate').filter((c) => String(c.params?.expression ?? '').includes('performance.mark('));
    assert.equal(markCalls.length, 0, 'no Runtime.evaluate call may ever contain performance.mark(');

    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    const input = events.find((e) => e.kind === 'input');
    assert.ok(input, 'the host-side input landmark must still be recorded');
    assert.equal(input!.action, 'input_click');
    assert.match(String(input!.mark), /^mark-[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Recorder identity and teardown invariants: bridge state is isolated from the
// page main world, stop closes asynchronous resize admission before quiescence,
// and each rect-identity property walk releases every materialized remote handle.
// ---------------------------------------------------------------------------

test('the entire recorder bridge (observer script, rect/resize identity drains, teardown) runs scoped to a CDP isolated world, not the page main world', async () => {
  const recDir = freshRecDir('i3-isolated-world');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  let isolatedContextId: number | undefined;
  const bridgeExpressionPattern = /__captureRecorder_|takeRectElements|takeResizeTargets|MutationObserver/;

  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    if (method === 'Page.createIsolatedWorld') {
      assert.equal(params.frameId, 'stub-frame-1', "the isolated world must be created against the resolved main frameId (from the stub's Page.getFrameTree)");
      assert.equal(params.grantUniveralAccess, false, 'grantUniveralAccess must be explicitly false (least-privilege) — note the real CDP field is missing the r in "Universal"');
      assert.ok(
        typeof params.worldName === 'string' && /^captureRecorder_[0-9a-f]+$/.test(params.worldName as string),
        'worldName must embed this recording\'s nonce, not a fixed guessable name',
      );
      const result = (await originalSend(method, params)) as { executionContextId?: number };
      isolatedContextId = result.executionContextId;
      return result;
    }
    if (method === 'Runtime.addBinding') {
      assert.equal(
        (params as { executionContextId?: unknown }).executionContextId,
        undefined,
        'the binding must not use the deprecated per-context executionContextId form',
      );
      assert.ok(
        typeof params.executionContextName === 'string' &&
          /^captureRecorder_[0-9a-f]+$/.test(params.executionContextName as string),
        'the binding must be scoped to the nonce-named isolated world via executionContextName, so window.captureRecorderEmit is exposed only inside that world and never to the page main world',
      );
    }
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (bridgeExpressionPattern.test(expression)) {
        assert.equal(
          typeof params.contextId,
          'number',
          `expected a bridge-touching evaluate to carry a numeric contextId (page-unreachable context): ${expression.slice(0, 80)}`,
        );
        if (isolatedContextId !== undefined) {
          assert.equal(
            params.contextId,
            isolatedContextId,
            "a bridge-touching evaluate must be scoped to the SAME isolated world Page.createIsolatedWorld most recently created",
          );
        }
      }
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    assert.ok(isolatedContextId !== undefined, 'Page.createIsolatedWorld must have been called by start()');

    const nonce = extractBindingNonce(client);
    assert.ok(
      client.callsFor('Page.createIsolatedWorld').some((c) => c.params?.worldName === `captureRecorder_${nonce}`),
      "worldName must embed THIS recording's actual nonce",
    );

    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 1 }, sessionId: 1 });
    await tick();

    client.fireBinding(JSON.stringify({
      kind: 'resize',
      performanceNowMs: 1,
      seq: 1,
      count: 1,
      targets: [{ tag: 'DIV', width: 10, height: 20 }],
      nonce,
    }));
    await tick();

    await session.stop();

    assert.ok(
      client.callsFor('Runtime.evaluate').some((c) => bridgeExpressionPattern.test(String(c.params?.expression ?? ''))),
      'sanity: at least one bridge-touching evaluate actually happened during this test',
    );
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a resize binding call landing after the final drain, during the rest of stop() teardown, is dropped and tallied instead of appending post-stop', async () => {
  const recDir = freshRecDir('i3-post-stop-resize');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  let firedLateResize = false;
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    const expression = String((params as { expression?: unknown }).expression ?? '');
    if (method === 'Runtime.evaluate' && expression.includes('.teardown()') && !firedLateResize) {
      firedLateResize = true;
      const nonce = extractLatestBindingNonce(client);
      client.fireBinding(JSON.stringify({
        kind: 'resize',
        performanceNowMs: 999,
        seq: 999,
        count: 1,
        targets: [{ tag: 'SPAN', width: 1, height: 1 }],
        nonce,
      }));
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    const summary = await session.stop();
    await tick();

    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    const lateResize = events.find(
      (e) =>
        e.kind === 'resize' &&
        Array.isArray(e.targets) &&
        (e.targets as Array<Record<string, unknown>>).some((t) => t.tag === 'SPAN'),
    );
    assert.equal(lateResize, undefined, 'a resize binding landing after the final drain has started must never append to events.jsonl');
    assert.equal(
      summary.eventCount,
      events.length,
      "stop()'s reported eventCount must equal the actual events.jsonl line count — the sharpest single post-stop-append check",
    );
    const dropped = events.find((e) => e.kind === 'binding-dropped' && e.reason === 'resize-resolution-closed');
    assert.ok(dropped, 'the late resize must be tallied honestly as resize-resolution-closed, not silently lost');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a rect-identity property walk that materializes more than the cap still gets every objectId released, not just the resolved slice', async () => {
  const recDir = freshRecDir('i3-rect-overcap-leak');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  const overCapCount = 305;
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    const expression = String((params as { expression?: unknown }).expression ?? '');
    if (method === 'Runtime.evaluate' && expression.includes('querySelectorAll')) {
      client.calls.push({ method, params });
      const facts = Array.from({ length: overCapCount }, (_, i) => ({
        tag: 'div',
        id: null,
        classes: null,
        x: i,
        y: i,
        width: 10,
        height: 10,
      }));
      return { result: { value: facts } };
    }
    if (method === 'Runtime.evaluate' && expression.includes('h.takeRectElements(')) {
      client.calls.push({ method, params });
      return { result: { objectId: 'rect-array-overcap' } };
    }
    if (method === 'Runtime.getProperties' && params.objectId === 'rect-array-overcap') {
      client.calls.push({ method, params });
      return {
        result: [
          ...Array.from({ length: overCapCount }, (_, i) => ({
            name: String(i),
            value: { objectId: `rect-el-overcap-${i}` },
          })),
          {
            name: 'accessor',
            get: { objectId: 'rect-accessor-getter' },
            set: { objectId: 'rect-accessor-setter' },
            symbol: { objectId: 'rect-accessor-symbol' },
          },
        ],
        internalProperties: [{ name: '[[Prototype]]', value: { objectId: 'rect-array-prototype' } }],
        privateProperties: [{ name: '#private', value: { objectId: 'rect-private-value' } }],
      };
    }
    if (
      method === 'DOM.describeNode' &&
      typeof params.objectId === 'string' &&
      (params.objectId as string).startsWith('rect-el-overcap-')
    ) {
      client.calls.push({ method, params });
      const idx = Number((params.objectId as string).slice('rect-el-overcap-'.length));
      return { node: { backendNodeId: 10000 + idx } };
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 1 }, sessionId: 1 });
    await tick();

    const rects = readNdjson(session.rectsPath) as Array<{
      elements: Array<{ backendNodeId: number | null; identityUnresolved?: true }>;
    }>;
    assert.equal(rects.length, 1);
    const elements = rects[0].elements;
    assert.equal(
      elements.length,
      overCapCount,
      'MAX_RECT_ELEMENTS (2000) is a separate, much higher cap — all 305 elements must still land in rects.jsonl',
    );

    const resolved = elements.filter((el) => el.backendNodeId !== null);
    const unresolved = elements.filter((el) => el.backendNodeId === null);
    assert.equal(resolved.length, 300, 'exactly MAX_RECT_IDENTITY_RESOLUTIONS (300) elements must have a real backendNodeId');
    assert.equal(unresolved.length, 5, 'the remaining 5 over-cap elements must be identityUnresolved, never fabricated');
    for (const el of unresolved) assert.equal(el.identityUnresolved, true);

    const describeCalls = client.callsFor('DOM.describeNode');
    assert.equal(describeCalls.length, 300, 'DOM.describeNode must never be called for more than the identity cap');

    const releaseCalls = client.callsFor('Runtime.releaseObject').map((c) => c.params?.objectId);
    assert.ok(releaseCalls.includes('rect-array-overcap'), 'the array container objectId must be released');
    for (let i = 0; i < overCapCount; i++) {
      assert.ok(
        releaseCalls.includes(`rect-el-overcap-${i}`),
        `element objectId rect-el-overcap-${i} must be released even though it was past the resolution cap`,
      );
    }
    for (const descriptorObjectId of [
      'rect-accessor-getter',
      'rect-accessor-setter',
      'rect-accessor-symbol',
      'rect-array-prototype',
      'rect-private-value',
    ]) {
      assert.ok(
        releaseCalls.includes(descriptorObjectId),
        `descriptor objectId ${descriptorObjectId} materialized by Runtime.getProperties must be released`,
      );
    }
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The page->host binding is scoped to the recorder's isolated world, so
// window.captureRecorderEmit is absent from the page main world; and a
// foreign-origin / bad-nonce flood is rejected before it can consume the shared
// rate-limit budget, so it can never starve legitimate isolated-world events
// (I-2: no page-observable, page-controllable side channel).
// ---------------------------------------------------------------------------

test('the recorder binding is scoped to its isolated world via executionContextName, absent from the page main world', async () => {
  const recDir = freshRecDir('binding-scoped-to-isolated-world');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    const nonce = extractBindingNonce(client);

    const addBindingCalls = client.callsFor('Runtime.addBinding');
    assert.equal(addBindingCalls.length, 1, 'the binding is installed exactly once, in start()');
    const params = addBindingCalls[0].params ?? {};
    assert.equal(
      params.executionContextName,
      `captureRecorder_${nonce}`,
      'the binding must be scoped to the nonce-named isolated world, so window.captureRecorderEmit is exposed only there and never in the page main world',
    );
    assert.equal(
      params.executionContextId,
      undefined,
      'the binding must not use the deprecated per-context executionContextId form',
    );

    // A navigation recreates the same-named world; the executionContextName scope auto-reattaches
    // the binding, so it is never re-issued.
    client.fire('Page.frameNavigated', { frame: { id: 'main', url: 'https://example.com/next' } });
    await tick();
    assert.equal(
      client.callsFor('Runtime.addBinding').length,
      1,
      'the scoped binding auto-reattaches to the recreated world and is never re-added',
    );
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a foreign-origin or bad-nonce binding flood is rejected before consuming the rate-limit budget, so it cannot starve legitimate isolated-world events', async () => {
  const recDir = freshRecDir('binding-origin-gate-before-rate-limit');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    const nonce = extractBindingNonce(client);
    const foreignContextId = client.lastIsolatedWorldContextId + 987654;

    // A main-world / foreign-context flood far above the 200/s budget. Each payload is otherwise
    // valid, but originates from the wrong execution context — the page main world, where a scoped
    // binding is absent, is exactly such a foreign origin.
    for (let i = 0; i < 500; i++) {
      client.fireBinding(JSON.stringify({ kind: 'mutation', performanceNowMs: i, count: 1, nonce }), {
        executionContextId: foreignContextId,
      });
    }
    // A same-origin flood but with the wrong nonce — the second origin proof, also gated before the
    // rate limit.
    for (let i = 0; i < 500; i++) {
      client.fireBinding(JSON.stringify({ kind: 'mutation', performanceNowMs: i, count: 1, nonce: 'wrong-nonce' }));
    }

    // One legitimate event from the real isolated world, AFTER both floods, in the same rate
    // window. Both floods are >200; if either had consumed the shared budget this would be dropped
    // as rate-limited. Its acceptance proves the floods never touched the budget.
    client.fireBinding(JSON.stringify({ kind: 'mutation', performanceNowMs: 999, count: 7, nonce }));
    await tick();

    const summary = await session.stop();
    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;

    const accepted = events.filter((e) => e.kind === 'mutation');
    assert.equal(accepted.length, 1, 'exactly the one legitimate isolated-world event is accepted');
    assert.equal(accepted[0].count, 7, 'and it is the real event, not a flood payload');

    const reasons = (events.filter((e) => e.kind === 'binding-dropped') as Array<Record<string, unknown>>).map((d) => d.reason);
    assert.ok(reasons.includes('wrong-origin'), 'foreign-origin calls are dropped as wrong-origin');
    assert.ok(reasons.includes('bad-nonce'), 'same-origin wrong-nonce calls are dropped as bad-nonce');
    assert.ok(
      !reasons.includes('rate-limited'),
      'no legitimate event was ever rate-limited — the origin/nonce floods never consumed the budget',
    );
    assert.equal(summary.eventCount, events.length);
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Runtime.evaluate resolves (does not reject) when the injected JS throws,
// reporting it in exceptionDetails. The recorder must treat that as an install
// failure — never publishing a usable-looking context with no bridge behind it.
// ---------------------------------------------------------------------------

test('an observer-script injection that reports exceptionDetails fails start() and never starts the streams against a bridgeless context', async () => {
  const recDir = freshRecDir('inject-exception-fails-start');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    const expression = String((params as { expression?: unknown }).expression ?? '');
    if (method === 'Runtime.evaluate' && expression.includes('MutationObserver')) {
      // Runtime.evaluate RESOLVES with exceptionDetails (it does not reject) when the injected JS
      // throws — e.g. ResizeObserver.observe throwing before window[KEY] is installed.
      return { exceptionDetails: { text: 'Uncaught', exception: { description: 'ResizeObserver.observe threw' } }, result: {} };
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await assert.rejects(
      () => session.start(),
      /observer script install threw/i,
      'an injection whose JS throws must fail start(), not be treated as a successful install',
    );
    assert.notEqual(session.state, 'recording', 'a failed install must never leave the recorder recording');
    assert.equal(
      client.callsFor('Page.startScreencast').length,
      0,
      'the streams must never start against a context with no bridge installed behind it',
    );
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('an observer-script re-injection that reports exceptionDetails on navigation emits an honest error marker, not a silent success', async () => {
  const recDir = freshRecDir('inject-exception-fails-rearm');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  let failNextInject = false;
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    const expression = String((params as { expression?: unknown }).expression ?? '');
    if (method === 'Runtime.evaluate' && expression.includes('MutationObserver') && failNextInject) {
      failNextInject = false;
      return { exceptionDetails: { text: 'Uncaught', exception: { description: 'observe threw on rearm' } }, result: {} };
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    failNextInject = true;
    client.fire('Page.frameNavigated', { frame: { id: 'main', url: 'https://example.com/next' } });
    await tick();

    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    const error = events.find((e) => e.kind === 'error');
    assert.ok(error, 'a failed rearm install must surface as an honest error marker, never a silent success');
    assert.ok(
      String(error!.message).includes('observer re-arm after navigation failed'),
      'the error marker names the rearm failure',
    );
    assert.ok(
      events.some((e) => e.kind === 'navigation-gap'),
      'the navigation-gap marker is still recorded — the observer stream genuinely has a gap here',
    );
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// A main-frame navigation DURING start() initialization must recreate the
// isolated world in the latest context and land the observer there before
// start() returns — never leaving the recording bound to the world the
// startup navigation destroyed.
// ---------------------------------------------------------------------------

test('a main-frame navigation during start() initialization installs the observer in the latest context before start() returns', async () => {
  const recDir = freshRecDir('navigation-during-start');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);

  let injectCount = 0;
  let releaseFirstInject: () => void = () => {};
  const firstInjectGate = new Promise<void>((resolve) => {
    releaseFirstInject = resolve;
  });
  let markFirstInjectReached: () => void = () => {};
  const firstInjectReached = new Promise<void>((resolve) => {
    markFirstInjectReached = resolve;
  });

  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    const expression = String((params as { expression?: unknown }).expression ?? '');
    if (method === 'Runtime.evaluate' && expression.includes('MutationObserver')) {
      injectCount++;
      if (injectCount === 1) {
        // Park start()'s own observer install so a navigation can destroy its world before it
        // completes — the exact window a startup navigation would otherwise be lost in.
        markFirstInjectReached();
        await firstInjectGate;
      }
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    const startPromise = session.start();
    await firstInjectReached; // start()'s first observer install is now parked mid-flight

    // A self-navigation / meta-refresh lands during initialization, destroying the first isolated
    // world. It must be handled (state is 'starting'), recreating the world in the latest context.
    client.fire('Page.frameNavigated', { frame: { id: 'main', url: 'https://example.com/during-start' } });
    await tick(20); // let the (ungated) rearm run to completion and publish the newest context

    releaseFirstInject(); // release the now-stale first install; it must NOT clobber the newest context
    await startPromise;

    assert.equal(session.state, 'recording', 'start() completes into recording');

    const isolatedWorlds = client.callsFor('Page.createIsolatedWorld');
    assert.equal(isolatedWorlds.length, 2, 'the startup navigation recreated the isolated world');
    const latestContextId = client.lastIsolatedWorldContextId;

    // Every subsequent bridge evaluate must target the LATEST world, not the destroyed first one.
    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 1 }, sessionId: 1 });
    await tick();
    const sampleCall = client
      .callsFor('Runtime.evaluate')
      .find((c) => String(c.params?.expression ?? '').includes('querySelectorAll'));
    assert.ok(sampleCall, 'a rect sample evaluate happened after start()');
    assert.equal(
      sampleCall!.params?.contextId,
      latestContextId,
      'the rect sampler must target the latest isolated world, never the one the startup navigation destroyed',
    );

    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    assert.ok(events.some((e) => e.kind === 'navigation-gap'), 'the startup navigation is recorded as a navigation-gap');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The failure path of a post-navigation rearm: a navigation destroys the
// isolated world, so its context id is dropped the instant the navigation is
// accepted. If the rearm install then fails, no live context is republished and
// the bridge must REFUSE to sample rather than target the destroyed context or
// fall into the page main world with an undefined contextId.
// ---------------------------------------------------------------------------

test('a recording-time failed rearm never targets the destroyed isolated world context', async () => {
  const recDir = freshRecDir('recording-rearm-fail-no-dead-context');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  let failNextInject = false;
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    const expression = String((params as { expression?: unknown }).expression ?? '');
    if (method === 'Runtime.evaluate' && expression.includes('MutationObserver') && failNextInject) {
      failNextInject = false;
      return { exceptionDetails: { text: 'Uncaught', exception: { description: 'observe threw on rearm' } }, result: {} };
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    const destroyedContextId = client.lastIsolatedWorldContextId; // the world start() installed

    // A navigation destroys the current isolated world; the rearm creates a fresh world but its
    // observer install throws, so no live context is ever republished.
    failNextInject = true;
    client.fire('Page.frameNavigated', { frame: { id: 'main', url: 'https://example.com/next' } });
    await tick();

    // A screencast frame arrives while no isolated world is live. The rect sampler must refuse to
    // evaluate rather than target the destroyed context (or send an undefined contextId, which CDP
    // would run in the page main world).
    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 1 }, sessionId: 1 });
    await tick();

    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    assert.ok(
      events.some((e) => e.kind === 'error' && String(e.message).includes('observer re-arm after navigation failed')),
      'the failed rearm surfaces an honest error marker',
    );
    assert.ok(
      events.some((e) => e.kind === 'error' && String(e.message).includes('rect sample failed')),
      'the rect sample fails honestly instead of sampling a dead context',
    );

    const sampleCalls = client
      .callsFor('Runtime.evaluate')
      .filter((c) => String(c.params?.expression ?? '').includes('querySelectorAll'));
    for (const call of sampleCalls) {
      assert.notEqual(
        call.params?.contextId,
        destroyedContextId,
        'no rect-sample evaluate may target the destroyed isolated world context',
      );
      assert.equal(
        typeof call.params?.contextId,
        'number',
        'no rect-sample evaluate may be sent with an undefined contextId (which would run in the page main world)',
      );
    }
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('a startup navigation whose rearm fails aborts start() and never samples with an undefined isolated-world context', async () => {
  const recDir = freshRecDir('startup-overtake-rearm-fail');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);

  let injectCount = 0;
  let releaseFirstInject: () => void = () => {};
  const firstInjectGate = new Promise<void>((resolve) => {
    releaseFirstInject = resolve;
  });
  let markFirstInjectReached: () => void = () => {};
  const firstInjectReached = new Promise<void>((resolve) => {
    markFirstInjectReached = resolve;
  });

  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    const expression = String((params as { expression?: unknown }).expression ?? '');
    if (method === 'Runtime.evaluate' && expression.includes('MutationObserver')) {
      injectCount++;
      if (injectCount === 1) {
        // Park start()'s gen-0 install so a navigation can overtake it mid-flight.
        markFirstInjectReached();
        await firstInjectGate;
      } else if (injectCount === 2) {
        // The overtaking navigation's gen-1 rearm install throws — no live context is ever
        // published for the latest generation.
        return {
          exceptionDetails: { text: 'Uncaught', exception: { description: 'observe threw on startup rearm' } },
          result: {},
        };
      }
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    const startPromise = session.start();
    await firstInjectReached; // start()'s gen-0 install is now parked mid-flight

    // A navigation lands during initialization (state 'starting'), overtaking the parked gen-0
    // install; its gen-1 rearm install then fails, leaving no live isolated world.
    client.fire('Page.frameNavigated', { frame: { id: 'main', url: 'https://example.com/during-start' } });
    await tick(); // let the gen-1 rearm run and fail

    releaseFirstInject(); // release the stale gen-0 install; it is overtaken and must not publish

    await assert.rejects(
      () => startPromise,
      /latest main-frame context/i,
      'start() must abort when the latest generation installed no isolated world',
    );
    assert.notEqual(session.state, 'recording', 'an aborted start() must never reach recording');

    // A screencast frame arriving after the aborted start must not sample: with no live context,
    // the rect sampler refuses rather than sending an undefined contextId.
    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 1 }, sessionId: 1 });
    await tick();
    assert.ok(
      client
        .callsFor('Runtime.evaluate')
        .filter((c) => String(c.params?.expression ?? '').includes('querySelectorAll'))
        .every((c) => typeof c.params?.contextId === 'number'),
      'no rect-sample evaluate may ever be sent with an undefined contextId (which would run in the page main world)',
    );
    const events = readNdjson(session.eventsPath) as Array<Record<string, unknown>>;
    assert.ok(
      events.some((e) => e.kind === 'error'),
      'the failed startup rearm surfaces an honest error marker',
    );
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The in-page rect-sample expression caps the identity-handle array it stashes
// at MAX_RECT_IDENTITY_RESOLUTIONS (300) while still returning every descriptive
// fact — bounding the real CDP property walk, not just the host-side release loop.
// ---------------------------------------------------------------------------

test('the production rect-sample expression caps its stashed identity-handle array at 300 while still returning every descriptive fact', async () => {
  const recDir = freshRecDir('rect-sample-expression-identity-cap');
  const client = new StubCdpClient();
  const originalSend = client.send.bind(client);
  let capturedExpression: string | undefined;
  client.send = async (method: string, params: Record<string, unknown> = {}) => {
    const expression = String((params as { expression?: unknown }).expression ?? '');
    if (method === 'Runtime.evaluate' && expression.includes('querySelectorAll')) {
      capturedExpression = expression; // the EXACT bytes the recorder sends to Chrome this frame
    }
    return originalSend(method, params);
  };
  const session = new RecorderSession({ client, recDir });

  try {
    await session.start();
    client.fire('Page.screencastFrame', { data: ONE_PIXEL_PNG_BASE64, metadata: { timestamp: 1 }, sessionId: 1 });
    await tick();
    assert.ok(capturedExpression, 'the recorder sent a rect-sample evaluate');

    const nonce = extractBindingNonce(client);
    const overCap = 305;

    // Execute the REAL production expression against a faithful DOM of >300 visible elements,
    // capturing what it stashes for the identity bridge — proving the in-page identity cap holds,
    // not merely that the host-side release loop cleans up afterward.
    const stashed: unknown[][] = [];
    const fakeEls = Array.from({ length: overCap }, (_, i) => ({
      tagName: 'DIV',
      id: '',
      className: 'box',
      getBoundingClientRect: () => ({ x: i + 1, y: i + 1, width: 10, height: 10 }),
    }));
    const fakeDocument = { querySelectorAll: () => fakeEls };
    const fakeWindow: Record<string, unknown> = {};
    fakeWindow['__captureRecorder_' + nonce] = {
      stashRectElements: (_frameIndex: number, els: unknown[]) => {
        stashed.push(els);
      },
    };
    const runExpr = new Function('window', 'document', `return ${capturedExpression};`);
    const out = runExpr(fakeWindow, fakeDocument) as { elements: unknown[] };

    assert.equal(out.elements.length, overCap, 'all 305 descriptive facts are returned (MAX_RECT_ELEMENTS is a far higher 2000 cap)');
    assert.equal(stashed.length, 1, 'the expression stashed exactly one identity-handle array for this frame');
    assert.equal(
      stashed[0].length,
      300,
      'the stashed identity-bridge handle array is capped at MAX_RECT_IDENTITY_RESOLUTIONS (300), bounding the real CDP property walk',
    );
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});
