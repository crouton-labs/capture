import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';

import { CAPTURE_ROOT } from '../src/session/artifacts.js';
import { createHarRecording, deleteHarRecording, readHarRecording } from '../src/har-manager.js';
import { recorderSocketPath } from '../src/cdp/bridge/spawn.js';
import { type CDPClient } from '../src/cdp/client.js';
import { findTabByIdAcrossEndpoints } from '../src/cdp/targets.js';
import {
  runRecorderBridge,
  __setRecorderBridgeDepsForTest,
  RECORDER_NONCE_BOOT_FILE,
  OBSERVER_INSTALLED_SENTINEL,
  type RecorderCdpClient,
} from '../src/cdp/recorder-bridge.js';

/**
 * Stands in for `CDPClient` in a REAL `runRecorderBridge` process body —
 * implements the `RecorderCdpClient` surface plus the two extra touches the
 * bridge itself makes (`waitReady()` at boot; `Network.getResponseBody`
 * issued by the streaming HARRecorder installed on the held connection).
 * Adapted from `recorder-bridge.test.ts`'s stub.
 */
class StubCdpClient extends EventEmitter implements RecorderCdpClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  private perfNow = 100;
  private nextIsolatedWorldContextId = 1000;
  lastIsolatedWorldContextId = 0;

  async waitReady(): Promise<void> {
    // The real client resolves once its websocket is open; the stub is born ready.
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    switch (method) {
      case 'Page.getFrameTree':
        return { frameTree: { frame: { id: 'stub-frame-1' } } };
      case 'Page.createIsolatedWorld':
        this.lastIsolatedWorldContextId = this.nextIsolatedWorldContextId;
        return { executionContextId: this.nextIsolatedWorldContextId++ };
      case 'Network.getResponseBody':
        return { body: 'stub-response-body', base64Encoded: false };
      case 'Runtime.evaluate': {
        const expression = String((params as { expression?: unknown }).expression ?? '');
        if (expression.includes('MutationObserver')) {
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
          return { result: { value: [] } };
        }
        return { result: {} };
      }
      case 'Tracing.end':
        this.emit('Tracing.tracingComplete', {});
        return {};
      default:
        return {};
    }
  }

  on(event: string, handler: (params: unknown, sessionId?: string) => void): void {
    super.on(event, handler);
  }

  onDisconnect(handler: () => void): void {
    super.on('__disconnect', handler);
  }

  close(): void {
    // No-op for the stub.
  }

  fire(event: string, params: unknown, sessionId?: string): void {
    this.emit(event, params, sessionId);
  }

  callsFor(method: string): Array<{ method: string; params?: Record<string, unknown> }> {
    return this.calls.filter((c) => c.method === method);
  }
}

function freshRecDir(label: string): string {
  fs.mkdirSync(CAPTURE_ROOT, { recursive: true });
  return path.join(
    CAPTURE_ROOT,
    `recorder-har-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

/** One request per connection over the real unix control socket — the exact
 * wire shape production `recorder-client.ts` speaks. Typed loose so tests can
 * send deliberately malformed (nonce-less) request lines. */
function sendOverSocket(socketPath: string, req: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    socket.on('connect', () => socket.write(JSON.stringify(req) + '\n'));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const idx = buffer.indexOf('\n');
      if (idx < 0) return;
      socket.end();
      resolve(JSON.parse(buffer.slice(0, idx)) as Record<string, unknown>);
    });
    socket.on('error', reject);
  });
}

function readBootNonce(recDir: string): string {
  const raw = JSON.parse(fs.readFileSync(path.join(recDir, RECORDER_NONCE_BOOT_FILE), 'utf-8')) as { nonce?: unknown };
  assert.equal(typeof raw.nonce, 'string');
  assert.match(raw.nonce as string, /^[0-9a-f]{64}$/, 'boot-file nonce must be 64 lowercase hex chars');
  return raw.nonce as string;
}

async function pollUntil<T>(label: string, read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

interface BootedBridge {
  stub: StubCdpClient;
  recDir: string;
  socketPath: string;
  harId: string;
  exitCalls: number[];
  /** `fs.existsSync(socketPath)` observed at the instant the injected exit ran — cleanup-before-exit proof. */
  socketAliveAtExit: boolean | null;
  restore: () => void;
}

/** Boots a REAL `runRecorderBridge` (real HAR store, real unix control
 * socket, real nonce boot file) around the stub CDP client. */
async function bootBridge(label: string): Promise<BootedBridge> {
  const recDir = freshRecDir(label);
  // `createHarRecording` requires a session dir strictly UNDER the capture
  // root (the root itself is rejected) — the recDir doubles as one here.
  const { id: harId } = await createHarRecording(recDir);
  const socketPath = recorderSocketPath(recDir);
  const stub = new StubCdpClient();
  const exitCalls: number[] = [];
  const booted: BootedBridge = { stub, recDir, socketPath, harId, exitCalls, socketAliveAtExit: null, restore: () => {} };
  booted.restore = __setRecorderBridgeDepsForTest({
    createClient: () => stub as unknown as CDPClient,
    findTab: (async () => ({
      port: 9222,
      tab: { id: 'stub-tab', webSocketDebuggerUrl: 'ws://stub' },
    })) as unknown as typeof findTabByIdAcrossEndpoints,
    exit: (code) => {
      booted.socketAliveAtExit = fs.existsSync(socketPath);
      exitCalls.push(code);
    },
  });
  try {
    await runRecorderBridge({ socketPath, targetId: 'stub-tab', recDir, harId, port: 9222 });
  } catch (error) {
    booted.restore();
    throw error;
  }
  return booted;
}

async function teardownBridge(booted: BootedBridge, opts: { alreadyStopped?: boolean } = {}): Promise<void> {
  try {
    if (!opts.alreadyStopped && fs.existsSync(booted.socketPath)) {
      // The only sanctioned shutdown: an authenticated rec-start + rec-stop
      // drives the bridge's own cleanup/self-exit path (exit itself is the
      // injected capture above, so the test runner survives).
      const nonce = readBootNonce(booted.recDir);
      await sendOverSocket(booted.socketPath, { reqId: 9001, type: 'rec-start', nonce });
      await sendOverSocket(booted.socketPath, { reqId: 9002, type: 'rec-stop', nonce });
    }
  } finally {
    booted.restore();
    fs.rmSync(booted.recDir, { recursive: true, force: true });
    await deleteHarRecording(booted.harId).catch(() => {});
  }
}

/** Fires one complete request/response/finished Network lifecycle on the stub
 * — exactly what the held connection would deliver from a live tab. */
function fireNetworkLifecycle(stub: StubCdpClient, requestId: string, url: string): void {
  stub.fire('Network.requestWillBeSent', {
    requestId,
    request: { method: 'GET', url, headers: { accept: 'text/html' } },
    timestamp: 10.0,
    wallTime: 1_700_000_000,
  });
  stub.fire('Network.responseReceived', {
    requestId,
    response: { url, status: 200, headers: { 'content-type': 'text/html' } },
    timestamp: 10.5,
  });
  stub.fire('Network.loadingFinished', { requestId, timestamp: 11.0, encodedDataLength: 1234 });
}

test('U11b: the streaming HARRecorder is installed before the control socket — traffic on the held connection BEFORE any rec-start lands in the HAR store exactly once', async () => {
  const booted = await bootBridge('pre-start-traffic');
  try {
    // The bridge is listening (runRecorderBridge resolved) and NO rec-start
    // has been issued. Traffic arriving now must already be captured.
    assert.ok(fs.existsSync(booted.socketPath), 'control socket must be bound');
    assert.equal(booted.stub.callsFor('Page.startScreencast').length, 0, 'sanity: no rec-start has armed the recorder');

    fireNetworkLifecycle(booted.stub, 'req-1', 'https://example.com/pre-rec-start');

    const har = await pollUntil(
      'the pre-rec-start entry to stream into the HAR store',
      () => readHarRecording(booted.harId),
      (h) => h.log.entries.length >= 1,
    );
    assert.equal(har.log.entries.length, 1);
    assert.equal(har.log.entries[0].request.url, 'https://example.com/pre-rec-start');
    assert.equal(har.log.entries[0].request.method, 'GET');
    assert.equal(har.log.entries[0].response.status, 200);
    assert.equal(har.log.entries[0].response.content.text, 'stub-response-body');

    // Exactly-once: settle, re-read — the single lifecycle must not have been
    // appended a second time by any duplicate subscription or re-emission.
    await new Promise((r) => setTimeout(r, 100));
    const settled = await readHarRecording(booted.harId);
    assert.equal(settled.log.entries.length, 1, 'the one Network lifecycle must produce exactly one HAR entry');
    assert.equal(settled.incompleteLifecycles.length, 0);
  } finally {
    await teardownBridge(booted);
  }
});

test('U11b: nonce gate — a missing or wrong nonce is answered unauthorized with zero side effects; the correct boot-file nonce dispatches', async () => {
  const booted = await bootBridge('nonce-gate');
  try {
    // Missing nonce.
    const missing = await sendOverSocket(booted.socketPath, { reqId: 1, type: 'rec-start' });
    assert.deepEqual(missing, { reqId: 1, ok: false, type: 'rec-start', error: 'unauthorized' });

    // Wrong (but well-formed 64-hex) nonce.
    const wrong = await sendOverSocket(booted.socketPath, { reqId: 2, type: 'rec-start', nonce: 'f'.repeat(64) });
    assert.deepEqual(wrong, { reqId: 2, ok: false, type: 'rec-start', error: 'unauthorized' });

    // Unknown/garbage type + no nonce: reqId/type are coerced defensively, still unauthorized.
    const garbage = await sendOverSocket(booted.socketPath, { reqId: 'nope', type: 'evil' });
    assert.deepEqual(garbage, { reqId: 0, ok: false, type: 'cdp', error: 'unauthorized' });

    // Zero side effects: no rejected request reached a handler — the recorder
    // session was never armed (no motion-rec domain enables, no screencast).
    assert.equal(booted.stub.callsFor('Page.enable').length, 0);
    assert.equal(booted.stub.callsFor('Page.startScreencast').length, 0);

    // The correct nonce (read from the boot file the bridge wrote before
    // binding the socket — production's starter consumes it; this test drives
    // the wire itself) is dispatched: rec-start succeeds, proving the earlier
    // unauthorized attempts left session state fully idle.
    const nonce = readBootNonce(booted.recDir);
    const started = await sendOverSocket(booted.socketPath, { reqId: 3, type: 'rec-start', nonce });
    assert.equal(started.ok, true);
    assert.equal(started.type, 'rec-start');
    assert.equal(started.reqId, 3);
    assert.ok(booted.stub.callsFor('Page.startScreencast').length === 1, 'the authenticated rec-start must arm the recorder');

    // A wrong-nonce rec-stop mid-recording is unauthorized AND effect-free:
    // no self-exit, socket still up, and a subsequent authenticated rec-stop
    // completes normally.
    const badStop = await sendOverSocket(booted.socketPath, { reqId: 4, type: 'rec-stop', nonce: 'e'.repeat(64) });
    assert.deepEqual(badStop, { reqId: 4, ok: false, type: 'rec-stop', error: 'unauthorized' });
    assert.deepEqual(booted.exitCalls, [], 'an unauthorized rec-stop must not trigger the self-exit path');
    assert.ok(fs.existsSync(booted.socketPath), 'an unauthorized rec-stop must not tear down the control socket');

    const stopped = await sendOverSocket(booted.socketPath, { reqId: 5, type: 'rec-stop', nonce });
    assert.equal(stopped.ok, true);
    assert.equal(stopped.type, 'rec-stop');
    await teardownBridge(booted, { alreadyStopped: true });
  } catch (error) {
    await teardownBridge(booted);
    throw error;
  }
});

test('U11b: an authenticated rec-stop flushes its response, cleans up, and self-exits with code 0', async () => {
  const booted = await bootBridge('self-exit');
  try {
    const nonce = readBootNonce(booted.recDir);
    const started = await sendOverSocket(booted.socketPath, { reqId: 1, type: 'rec-start', nonce });
    assert.equal(started.ok, true);

    const stopped = await sendOverSocket(booted.socketPath, { reqId: 2, type: 'rec-stop', nonce });
    // The full response line was received by the caller — production writes
    // it with a completion callback and only then ends the socket, cleans up,
    // and exits, so a real process's death cannot truncate the response.
    assert.equal(stopped.ok, true);
    assert.equal(stopped.type, 'rec-stop');
    assert.equal(stopped.reqId, 2);
    assert.equal(typeof stopped.frameCount, 'number');
    assert.equal(typeof stopped.eventCount, 'number');

    await pollUntil('the injected exit seam to fire', async () => booted.exitCalls.length, (n) => n >= 1, 1000);
    assert.deepEqual(booted.exitCalls, [0], 'the bridge must self-exit exactly once, with code 0');
    assert.equal(
      booted.socketAliveAtExit,
      false,
      'cleanup (socket unlink) must have completed before exit was invoked — response flush → cleanup → exit',
    );
    assert.ok(!fs.existsSync(booted.socketPath), 'the control socket must be gone after self-exit');
    await teardownBridge(booted, { alreadyStopped: true });
  } catch (error) {
    await teardownBridge(booted);
    throw error;
  }
});

test('U11b fix: a JSON `null` (or other scalar) line is dropped rather than crashing the bridge — the socket stays up, no unhandled rejection escapes, and a subsequent correctly-nonced request is still answered', async () => {
  const booted = await bootBridge('null-line-guard');
  // `handleLine` runs as `void handleLine(...)` in `listenNdjsonSocket` (src/cdp/bridge/server.ts)
  // — a rejection inside it is a genuine unhandled promise rejection in THIS process, not a
  // per-request test failure. Attaching a listener here both (a) prevents Node's default
  // fatal-crash-the-process behavior for an unhandled rejection so the failure is observable
  // instead of taking the whole test file down, and (b) lets the assertion below distinguish
  // "guarded, nothing happened" from "crashed silently into a listener".
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    rejections.push(reason);
  };
  process.on('unhandledRejection', onRejection);
  try {
    for (const line of ['null', '42', '"just a string"', 'true', '[]']) {
      const socket = net.createConnection(booted.socketPath);
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => {
          socket.write(line + '\n');
          resolve();
        });
        socket.on('error', reject);
      });
      // Give the fire-and-forget `handleLine` promise a turn to run/reject before probing.
      await new Promise((r) => setTimeout(r, 30));
      socket.destroy();
    }

    assert.deepEqual(
      rejections,
      [],
      'a syntactically-valid-JSON but non-object line (null/number/string/boolean/array) must not throw an unhandled rejection inside the fire-and-forget handleLine',
    );
    assert.ok(fs.existsSync(booted.socketPath), 'the control socket must still be bound after every non-object line');

    // The bridge process (in-proc here, but this is the same code path a real detached process
    // runs) must still be fully functional: a correctly-nonced request is still answered.
    const nonce = readBootNonce(booted.recDir);
    const started = await sendOverSocket(booted.socketPath, { reqId: 99, type: 'rec-start', nonce });
    assert.equal(started.ok, true, 'a correctly-nonced rec-start must still be answered after the non-object lines');
    const stopped = await sendOverSocket(booted.socketPath, { reqId: 100, type: 'rec-stop', nonce });
    assert.equal(stopped.ok, true);
    await teardownBridge(booted, { alreadyStopped: true });
  } catch (error) {
    await teardownBridge(booted);
    throw error;
  } finally {
    process.off('unhandledRejection', onRejection);
  }
});
