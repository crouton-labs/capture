import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

// U12: the recorder HAR flush/health barrier in the action lifecycle.
//
// Bridge side (real `runRecorderBridge` boot over a real unix control socket,
// same scaffolding style as test/recorder-har-integration.test.ts): the
// `har-flush` request waits for entry/body/append work completed at request
// time, answers health only (no counts), is nonce-gated, tolerates concurrent
// flushes without duplicating entries or creating a second collector, reports
// a latched fatal store error as `ok:false` without tearing the bridge down,
// and is deterministically rejected once the terminal rec-stop latch owns HAR
// finalization.
//
// Wrapper side (injected connection seams, zero wall-time waits): the action
// wrapper invokes the barrier only on recorder-held actions, after the settle
// and before success output; a flush failure fails the command with the
// distinct `recorder_har_flush_failed` code while a primary action failure
// propagates untouched with no flush request at all.

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
import {
  withPageAction,
  __setConnectionSeamsForTest,
  type ConnectionSeams,
} from '../src/cdp/connection.js';
import { CaptureError } from '../src/errors.js';
import { isRecorderHeldClient } from '../src/cdp/recorder-client.js';
import { recDirFor } from '../src/cdp/motion/recorder.js';
import type { ParsedArgs, CDPTarget } from '../src/cdp/types.js';
import type { ActiveSessionState } from '../src/session-context.js';

// ---------------------------------------------------------------------------
// Bridge-side scaffolding (trimmed from test/recorder-har-integration.test.ts
// — those helpers are unexported; the duplication is test-only and accepted).
// ---------------------------------------------------------------------------

class StubCdpClient extends EventEmitter implements RecorderCdpClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  private perfNow = 100;
  private nextIsolatedWorldContextId = 1000;
  /** When set, `Network.getResponseBody` awaits this before resolving — the
   * deterministic barrier for proving flush/drain wait through a pending
   * body fetch, with no wall-clock race. */
  bodyGate: Promise<void> | null = null;

  async waitReady(): Promise<void> {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    switch (method) {
      case 'Page.getFrameTree':
        return { frameTree: { frame: { id: 'stub-frame-1' } } };
      case 'Page.createIsolatedWorld':
        return { executionContextId: this.nextIsolatedWorldContextId++ };
      case 'Network.getResponseBody':
        if (this.bodyGate) await this.bodyGate;
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

  close(): void {}

  fire(event: string, params: unknown): void {
    this.emit(event, params);
  }

  callsFor(method: string): Array<{ method: string; params?: Record<string, unknown> }> {
    return this.calls.filter((c) => c.method === method);
  }
}

function freshRecDir(label: string): string {
  fs.mkdirSync(CAPTURE_ROOT, { recursive: true });
  return path.join(
    CAPTURE_ROOT,
    `recorder-har-flush-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

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
  restore: () => void;
}

async function bootBridge(label: string): Promise<BootedBridge> {
  const recDir = freshRecDir(label);
  const { id: harId } = await createHarRecording(recDir);
  const socketPath = recorderSocketPath(recDir);
  const stub = new StubCdpClient();
  const exitCalls: number[] = [];
  const booted: BootedBridge = { stub, recDir, socketPath, harId, exitCalls, restore: () => {} };
  booted.restore = __setRecorderBridgeDepsForTest({
    createClient: () => stub as unknown as CDPClient,
    findTab: (async () => ({
      port: 9222,
      tab: { id: 'stub-tab', webSocketDebuggerUrl: 'ws://stub' },
    })) as unknown as typeof findTabByIdAcrossEndpoints,
    exit: (code) => {
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

// ---------------------------------------------------------------------------
// Bridge side — the har-flush wire barrier
// ---------------------------------------------------------------------------

test('U12: har-flush waits for a body fetch in flight at request time — the response arrives only after the completed entry (with its real body) is durably in the session HAR, and carries health only, no counts', async () => {
  const booted = await bootBridge('body-barrier');
  let releaseBody: (() => void) | undefined;
  try {
    const nonce = readBootNonce(booted.recDir);
    await sendOverSocket(booted.socketPath, { reqId: 1, type: 'rec-start', nonce });

    booted.stub.bodyGate = new Promise<void>((r) => { releaseBody = r; });
    fireNetworkLifecycle(booted.stub, 'req-1', 'https://example.com/routed-action');

    let flushSettled = false;
    const flush = sendOverSocket(booted.socketPath, { reqId: 2, type: 'har-flush', nonce }).then((resp) => {
      flushSettled = true;
      return resp;
    });
    // The gated body fetch was already in flight when the flush request
    // arrived, so the barrier must not settle while it is pending.
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(flushSettled, false, 'har-flush must wait for body/append work in flight at request time');

    releaseBody!();
    const resp = await flush;
    // Health only — the exact success envelope, never an entry/action count.
    assert.deepEqual(resp, { reqId: 2, ok: true, type: 'har-flush' });

    // The completed entry is already durably readable — no polling needed.
    const har = await readHarRecording(booted.harId);
    assert.equal(har.log.entries.length, 1);
    assert.equal(har.log.entries[0].request.url, 'https://example.com/routed-action');
    assert.equal(har.log.entries[0].response.content.text, 'stub-response-body');

    booted.stub.bodyGate = null;
    await teardownBridge(booted);
  } catch (error) {
    // Release the gate even on assertion failure — teardown's rec-stop drain
    // would otherwise block forever on the still-pending body fetch.
    releaseBody?.();
    booted.stub.bodyGate = null;
    await teardownBridge(booted);
    throw error;
  }
});

test('U12: har-flush is nonce-gated like every other recorder request — a nonce-less flush is unauthorized with zero side effects, and its type is echoed, not coerced', async () => {
  const booted = await bootBridge('nonce-gate');
  try {
    const rejected = await sendOverSocket(booted.socketPath, { reqId: 7, type: 'har-flush' });
    assert.deepEqual(rejected, { reqId: 7, ok: false, type: 'har-flush', error: 'unauthorized' });
    await teardownBridge(booted);
  } catch (error) {
    await teardownBridge(booted);
    throw error;
  }
});

test('U12: concurrent har-flushes both succeed, duplicate nothing, and never create a second collector — the one streaming HARRecorder survives every flush socket open/close', async () => {
  const booted = await bootBridge('concurrent');
  try {
    const nonce = readBootNonce(booted.recDir);
    await sendOverSocket(booted.socketPath, { reqId: 1, type: 'rec-start', nonce });
    // The collector's own Network.enable (bridge boot) plus rec-start's
    // motion-rec domain enable have both run by now; flushes must add none.
    const enablesBeforeFlushes = booted.stub.callsFor('Network.enable').length;

    fireNetworkLifecycle(booted.stub, 'req-1', 'https://example.com/first');
    const [a, b] = await Promise.all([
      sendOverSocket(booted.socketPath, { reqId: 2, type: 'har-flush', nonce }),
      sendOverSocket(booted.socketPath, { reqId: 3, type: 'har-flush', nonce }),
    ]);
    assert.deepEqual(a, { reqId: 2, ok: true, type: 'har-flush' });
    assert.deepEqual(b, { reqId: 3, ok: true, type: 'har-flush' });

    const afterConcurrent = await readHarRecording(booted.harId);
    assert.equal(afterConcurrent.log.entries.length, 1, 'concurrent flushes must not duplicate the one completed entry');

    // Ownership survives the flush sockets closing: traffic fired AFTER both
    // flush connections ended still streams through the SAME collector.
    fireNetworkLifecycle(booted.stub, 'req-2', 'https://example.com/second');
    await sendOverSocket(booted.socketPath, { reqId: 4, type: 'har-flush', nonce });
    const afterSecond = await readHarRecording(booted.harId);
    assert.equal(afterSecond.log.entries.length, 2, 'the collector must keep streaming after flush sockets close');
    assert.equal(
      booted.stub.callsFor('Network.enable').length,
      enablesBeforeFlushes,
      'no flush may issue another Network.enable — a second collector would re-enable',
    );
    await teardownBridge(booted);
  } catch (error) {
    await teardownBridge(booted);
    throw error;
  }
});

test('U12: a latched fatal store failure makes har-flush answer ok:false with the exact primary error — without resetting the store, tearing the bridge down, or pre-empting the terminal rec-stop\u2019s ownership', async () => {
  const booted = await bootBridge('fatal');
  try {
    const nonce = readBootNonce(booted.recDir);
    await sendOverSocket(booted.socketPath, { reqId: 1, type: 'rec-start', nonce });

    fireNetworkLifecycle(booted.stub, 'good', 'https://example.com/good');
    await pollUntil('the pre-fatal entry to land', () => readHarRecording(booted.harId), (h) => h.log.entries.length >= 1);

    // A malformed OWNED terminal event latches the fatal store error inside
    // admit() without surfacing at this call site (same technique as
    // test/recorder-har-integration.test.ts's fatal-drain case).
    booted.stub.fire('Network.requestWillBeSent', {
      requestId: 'malformed',
      request: { method: 'GET', url: 'https://example.com/malformed', headers: {} },
      timestamp: 12.0,
      wallTime: 1_700_000_050,
    });
    booted.stub.fire('Network.loadingFinished', { requestId: 'malformed', timestamp: 'bad', encodedDataLength: 1 });

    const flush = await sendOverSocket(booted.socketPath, { reqId: 2, type: 'har-flush', nonce });
    assert.equal(flush.ok, false, 'a fatal store error must prevent a healthy flush');
    assert.equal(flush.type, 'har-flush');
    assert.match(String(flush.error), /Malformed owned Network event/);

    // The flush reported health; it did NOT exit the bridge, reset the store,
    // or claim terminal authority — those remain the rec-stop latch's alone.
    assert.deepEqual(booted.exitCalls, [], 'har-flush must never drive the bridge exit');
    assert.ok(fs.existsSync(booted.socketPath), 'the control socket must still be up after a fatal flush');
    const preserved = await readHarRecording(booted.harId);
    assert.equal(preserved.log.entries.length, 1, 'the pre-fatal entry must survive — the store is never reset');

    const stopped = await sendOverSocket(booted.socketPath, { reqId: 3, type: 'rec-stop', nonce });
    assert.equal(stopped.ok, false, 'the terminal rec-stop still owns and reports the fatal drain');
    assert.match(String(stopped.error), /Malformed owned Network event/);
    await pollUntil('the injected exit seam to fire', async () => booted.exitCalls.length, (n) => n >= 1, 1000);
    assert.deepEqual(booted.exitCalls, [1], 'exactly one exit, non-zero, from the terminal owner');
    await teardownBridge(booted, { alreadyStopped: true });
  } catch (error) {
    await teardownBridge(booted);
    throw error;
  }
});

test('U12: a har-flush arriving after the terminal rec-stop latch is claimed gets a deterministic rejection — it never shares, re-drives, or duplicates the drain/exit', async () => {
  const booted = await bootBridge('post-latch');
  let releaseBody: (() => void) | undefined;
  try {
    const nonce = readBootNonce(booted.recDir);
    await sendOverSocket(booted.socketPath, { reqId: 1, type: 'rec-start', nonce });

    // Hold the drain open through a gated in-flight body fetch, so the
    // terminal rec-stop claims the latch but cannot finish.
    booted.stub.bodyGate = new Promise<void>((r) => { releaseBody = r; });
    fireNetworkLifecycle(booted.stub, 'req-1', 'https://example.com/held');

    const stopPending = sendOverSocket(booted.socketPath, { reqId: 2, type: 'rec-stop', nonce });
    // The latch is claimed synchronously when the rec-stop line is handled;
    // Page.stopScreencast (issued inside RecorderSession.stop(), strictly
    // after the latch) is the observable proof it has been.
    await pollUntil('the terminal rec-stop to claim the latch', async () => booted.stub.callsFor('Page.stopScreencast').length, (n) => n >= 1, 1000);

    const flush = await sendOverSocket(booted.socketPath, { reqId: 3, type: 'har-flush', nonce });
    assert.deepEqual(flush, {
      reqId: 3,
      ok: false,
      type: 'har-flush',
      error: 'recorder is stopping — HAR finalization is owned by the terminal rec-stop',
    });
    assert.deepEqual(booted.exitCalls, [], 'the rejected flush must not have driven any exit');

    releaseBody!();
    const stopped = await stopPending;
    assert.equal(stopped.ok, true, 'the terminal rec-stop still completes normally after the rejected flush');
    await pollUntil('the injected exit seam to fire', async () => booted.exitCalls.length, (n) => n >= 1, 1000);
    assert.deepEqual(booted.exitCalls, [0], 'exactly one drain/exit — the terminal owner\u2019s');
    booted.stub.bodyGate = null;
    await teardownBridge(booted, { alreadyStopped: true });
  } catch (error) {
    // Release the gate even on assertion failure — the in-flight terminal
    // rec-stop (and teardown's own) would otherwise block forever.
    releaseBody?.();
    booted.stub.bodyGate = null;
    await teardownBridge(booted);
    throw error;
  }
});

// ---------------------------------------------------------------------------
// Wrapper side — withPageAction invokes the barrier only for recorder-held
// actions (deterministic injected seams; scaffolding mirrors
// test/connection-settle-har.test.ts's unexported helpers).
// ---------------------------------------------------------------------------

const FAKE_TAB: CDPTarget = {
  id: 'tab-new',
  title: '',
  url: 'https://fixture.test/',
  type: 'page',
  webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/tab-new',
};

function makeWrapperStubClient(): { waitReady(): Promise<void>; on(): void; onDisconnect(): void; send(): Promise<unknown>; close(): void } {
  return {
    async waitReady() {},
    on() {},
    onDisconnect() {},
    async send() {
      return {};
    },
    close() {},
  };
}

interface WrapperHarness {
  log: string[];
  flushCalls: number;
  restore: () => void;
}

function installWrapperSeams(overrides: Partial<ConnectionSeams> = {}): WrapperHarness {
  const log: string[] = [];
  const h: WrapperHarness = { log, flushCalls: 0, restore: () => {} };
  let clock = 0;
  h.restore = __setConnectionSeamsForTest({
    getActiveSession: () => null,
    resolveTab: async () => ({ port: 9223, tab: FAKE_TAB }),
    createClient: () => {
      log.push('connect');
      return makeWrapperStubClient() as never;
    },
    updateActiveSession: async () => null,
    appendHar: (async () => {
      log.push('append');
    }) as never,
    flushRecorderHar: async () => {
      h.flushCalls++;
      log.push('har-flush');
    },
    now: () => clock,
    sleep: async (ms: number) => {
      log.push(`sleep:${ms}`);
      clock += ms;
    },
    ...overrides,
  });
  return h;
}

function parsedFor(flags: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command: 'click', positional: [], target: 'tab-new', ...flags } as ParsedArgs;
}

function sessionState(overrides: Partial<ActiveSessionState>): ActiveSessionState {
  return {
    sessionId: 'sess-u12',
    dir: '/tmp/does-not-matter',
    harId: null,
    targetId: 'tab-new',
    stepCount: 0,
    ...overrides,
  };
}

function makeRoutedSessionDir(recId: string): string {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u12-sess-'));
  const recDir = recDirFor(sessionDir, recId);
  fs.mkdirSync(recDir, { recursive: true });
  fs.writeFileSync(
    path.join(recDir, 'recorder.json'),
    JSON.stringify({
      recId,
      pid: process.pid,
      socketPath: path.join(sessionDir, 'rec.sock'),
      targetId: 'tab-rec',
      url: null,
      nonce: 'a'.repeat(64),
      startedAt: new Date().toISOString(),
      state: 'recording',
      markers: {},
    }),
  );
  return sessionDir;
}

test('U12: a recorder-routed action whose har-flush fails rejects with the distinct recorder_har_flush_failed code — the primary action itself had already succeeded and settled', async () => {
  const sessionDir = makeRoutedSessionDir('rec-live');
  const h = installWrapperSeams({
    getActiveSession: () => sessionState({ dir: sessionDir, activeRecId: 'rec-live' }),
    flushRecorderHar: async () => {
      h.log.push('har-flush');
      throw new Error('recorder har-flush failed: sink append rejected');
    },
  });
  try {
    await assert.rejects(
      withPageAction(parsedFor({ target: undefined }), { settleMs: 2500 }, async (client) => {
        assert.ok(isRecorderHeldClient(client));
        h.log.push('callback');
        return 'action-ok';
      }),
      (err: unknown) => {
        assert.ok(err instanceof CaptureError, 'a flush failure must cross the boundary as a structured CaptureError');
        assert.equal(err.descriptor.code, 'recorder_har_flush_failed');
        assert.equal(err.descriptor.kind, 'artifact');
        // The message preserves the distinction: action completed, HAR flush failed.
        assert.match(err.message, /page action completed/);
        assert.match(err.message, /sink append rejected/);
        return true;
      },
    );
    // The action and its settle both ran — only the flush failed, after them.
    assert.deepEqual(h.log, ['callback', 'sleep:2500', 'har-flush']);
  } finally {
    h.restore();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('U12: a primary action failure on a routed action propagates untouched and sends NO har-flush request', async () => {
  const sessionDir = makeRoutedSessionDir('rec-live');
  const h = installWrapperSeams({
    getActiveSession: () => sessionState({ dir: sessionDir, activeRecId: 'rec-live' }),
  });
  try {
    await assert.rejects(
      withPageAction(parsedFor({ target: undefined }), { settleMs: 2500 }, async () => {
        h.log.push('callback');
        throw new Error('the action itself failed');
      }),
      /the action itself failed/,
    );
    assert.equal(h.flushCalls, 0, 'a failed action must not reach the flush barrier');
    assert.deepEqual(h.log, ['callback'], 'no settle and no flush after a primary action failure');
  } finally {
    h.restore();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('U12: a non-recorder action never sends the har-flush request', async () => {
  const h = installWrapperSeams();
  try {
    const { result } = await withPageAction(parsedFor(), { settleMs: 1000 }, async () => 'ok');
    assert.equal(result, 'ok');
    assert.equal(h.flushCalls, 0, 'the barrier is recorder-held-only');
    assert.deepEqual(h.log, ['connect', 'sleep:1000']);
  } finally {
    h.restore();
  }
});
