import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { CAPTURE_ROOT } from '../src/session/artifacts.js';
import { listenNdjsonSocket, closeNdjsonSocket } from '../src/cdp/bridge/server.js';
import {
  RecorderSession,
  handleRecorderRequest,
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

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    switch (method) {
      case 'Runtime.evaluate': {
        const expression = String((params as { expression?: unknown }).expression ?? '');
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
        // Observer-injection script and the stop-time teardown call.
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

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
}

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
    assert.equal(inputEvents[0].mark, 'input_click');
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

    client.fire('Tracing.dataCollected', { value: [{ name: 'Layout', ts: 1000 }, { name: 'Paint', ts: 1010 }] });
    client.fire('Runtime.bindingCalled', {
      name: 'captureRecorderEmit',
      payload: JSON.stringify({ kind: 'mutation', performanceNowMs: 55, count: 3 }),
    });
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
