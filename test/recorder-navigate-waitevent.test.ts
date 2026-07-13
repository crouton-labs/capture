import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { spawn } from 'node:child_process';

import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate } from '../src/session/artifacts.js';
import { listenNdjsonSocket, closeNdjsonSocket } from '../src/cdp/bridge/server.js';
import { recorderSocketPath } from '../src/cdp/bridge/spawn.js';
import { setActiveSession, setActiveRecId, clearActiveSession } from '../src/session-context.js';
import { recDirFor, type RecorderJson } from '../src/cdp/motion/recorder.js';
import { RecorderHeldClient } from '../src/cdp/recorder-client.js';
import { type RecorderRequest, type RecorderResponse, type RecorderClockBaselines } from '../src/cdp/bridge/protocol.js';
import { type ParsedArgs } from '../src/cdp/types.js';
import { RecorderSession, handleRecorderRequest, type RecorderCdpClient } from '../src/cdp/recorder-bridge.js';

// Isolates this file's active-session pointer from any other concurrent
// `capture` usage on the machine (session-context.ts scopes its pointer
// file by CRTR_NODE_ID) — same convention as motion-rec-lifecycle.test.ts.
process.env.CRTR_NODE_ID = `u14f-navwait-test-${process.pid}-${Date.now()}`;

const PENDING_MARKERS: RecorderClockBaselines = {
  performanceNowMs: 1,
  wallClockMs: 1_700_000_000_000,
  firstScreencastTimestampSec: null,
  firstTraceEventTsUs: null,
  baselinesPending: true,
};

function freshSessionDir(label: string): string {
  const dir = path.join(
    CAPTURE_ROOT,
    `u14f-session-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  ensurePrivateDir(dir);
  return dir;
}

function minimalParsedArgs(command: string, overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command, positional: [], ...overrides };
}

function defaultResponseFor(req: RecorderRequest): RecorderResponse {
  switch (req.type) {
    case 'rec-start':
      return { reqId: req.reqId, ok: true, type: 'rec-start', markers: PENDING_MARKERS };
    case 'rec-stop':
      return {
        reqId: req.reqId,
        ok: true,
        type: 'rec-stop',
        frameCount: 0,
        eventCount: 0,
        durationMs: 0,
        markers: PENDING_MARKERS,
      };
    case 'cdp':
      return { reqId: req.reqId, ok: true, type: 'cdp', result: {} };
    case 'har-flush':
      return { reqId: req.reqId, ok: true, type: 'har-flush' };
  }
}

/** Same fake recorder-bridge NDJSON socket server pattern as
 * test/motion-rec-lifecycle.test.ts / test/session-stop-recorder-teardown.test.ts. */
async function startFakeRecorderServer(
  socketPath: string,
  handlers: Partial<
    Record<RecorderRequest['type'], (req: RecorderRequest) => RecorderResponse | Promise<RecorderResponse>>
  > = {},
): Promise<{ received: RecorderRequest[]; close: () => void }> {
  const received: RecorderRequest[] = [];
  const server: net.Server = await listenNdjsonSocket(socketPath, async (line, socket) => {
    const req = JSON.parse(line) as RecorderRequest;
    received.push(req);
    const handler = handlers[req.type];
    const resp = handler ? await handler(req) : defaultResponseFor(req);
    socket.write(JSON.stringify(resp) + '\n');
  });
  return { received, close: () => closeNdjsonSocket(server, socketPath) };
}

/** Spawns a real, long-lived, harmless child process to stand in for a live
 * recorder-bridge process's pid — see the sibling lifecycle test files for
 * why this must never be the test's own process.pid. */
function spawnPlaceholderChild(): { pid: number; kill: () => void } {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  const pid = child.pid!;
  return { pid, kill: () => { try { child.kill(); } catch { /* already dead */ } } };
}

/** Arms an active recording (recorder.json + activeSession/activeRecId pointers) for
 * a fresh session dir, and starts a fake recorder-bridge NDJSON socket server for it. */
async function armActiveRecording(
  label: string,
  handlers: Partial<
    Record<RecorderRequest['type'], (req: RecorderRequest) => RecorderResponse | Promise<RecorderResponse>>
  > = {},
): Promise<{
  sessionDir: string;
  recId: string;
  fakeServer: { received: RecorderRequest[]; close: () => void };
  placeholder: { pid: number; kill: () => void };
  cleanup: () => void;
}> {
  const sessionDir = freshSessionDir(label);
  const recId = `rec-${label}`;
  const recDir = recDirFor(sessionDir, recId);
  ensurePrivateDir(recDir);
  const socketPath = recorderSocketPath(recDir);
  const placeholder = spawnPlaceholderChild();

  const recorderJson: RecorderJson = {
    recId,
    pid: placeholder.pid,
    socketPath,
    targetId: 'target-abc',
    nonce: 'a'.repeat(64), // valid 64-hex control nonce
    url: 'https://example.com',
    startedAt: new Date().toISOString(),
    state: 'recording',
    markers: PENDING_MARKERS,
  };
  writeJsonPrivate(path.join(recDir, 'recorder.json'), recorderJson);
  await setActiveSession({ sessionId: `s-${label}`, dir: sessionDir, harId: null, targetId: 'target-abc', stepCount: 0 });
  await setActiveRecId(recId);

  const fakeServer = await startFakeRecorderServer(socketPath, handlers);

  return {
    sessionDir,
    recId,
    fakeServer,
    placeholder,
    cleanup: () => {
      fakeServer.close();
      placeholder.kill();
      clearActiveSession();
      fs.rmSync(sessionDir, { recursive: true, force: true });
    },
  };
}

/** Tees process.stdout.write while `fn` runs, returning the emitted JSON
 * result chunk (emitResult writes the rendered result as one chunk). The
 * original write must keep flowing — node's test runner shares this stdout
 * for its own child-process protocol. */
async function captureEmittedJson(fn: () => Promise<void>): Promise<{ tag: string; attrs: Record<string, unknown>; sections?: string[] }> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  const resultChunk = chunks.find((c) => c.trimStart().startsWith('{'));
  assert.ok(resultChunk, `expected one emitted JSON result chunk on stdout; got: ${JSON.stringify(chunks)}`);
  return JSON.parse(resultChunk);
}

function navigateCallsOf(received: RecorderRequest[]): Array<Extract<RecorderRequest, { type: 'cdp' }>> {
  return received.filter(
    (r): r is Extract<RecorderRequest, { type: 'cdp' }> => r.type === 'cdp' && r.method === 'Page.navigate',
  );
}

// ---------------------------------------------------------------------------
// Routed `capture page navigate` — single-dispatch destination navigation
// through the active recorder, with the load-event wait bundled atomically
// onto the destination Page.navigate and the load outcome reported as a
// fact separate from the method result. A same-document (no-loaderId) target
// bounces dest→about:blank→dest.
// ---------------------------------------------------------------------------

test('routed navigate sends ONE combined marked Page.navigate+wait-event and reports load-outcome=observed with no about:blank bounce for a cross-document target', async () => {
  const armed = await armActiveRecording('nav-observed', {
    cdp: (req) => {
      if (req.type === 'cdp' && req.method === 'Page.navigate') {
        assert.equal(req.waitEvent, 'Page.loadEventFired', 'the destination navigate must bundle the load-event wait atomically onto the same request');
        return { reqId: req.reqId, ok: true, type: 'cdp', result: { loaderId: 'loader-1' }, event: { name: 'loadEventFired' }, waitOutcome: 'observed' };
      }
      return defaultResponseFor(req);
    },
  });
  try {
    const { cmdPageNavigate } = await import('../src/cdp/commands/page/navigate.js');
    const parsed = minimalParsedArgs('page', { positional: ['https://example.com/dest'], json: true, settle: 0 });
    const output = await captureEmittedJson(() => cmdPageNavigate(parsed, []));

    assert.equal(output.tag, 'navigated');
    assert.equal(output.attrs.url, 'https://example.com/dest');
    assert.equal(output.attrs.routed, true, 'a routed navigate must carry the routed dispatch fact');
    assert.equal(output.attrs['load-outcome'], 'observed');
    assert.equal(output.attrs['deadline-exceeded'], undefined, 'a completed navigation must not report deadline-exceeded');
    assert.equal(output.attrs.settle, 0);

    const navigateCalls = navigateCallsOf(armed.fakeServer.received);
    assert.equal(navigateCalls.length, 1, 'loaderId present -> no about:blank bounce, exactly ONE combined Page.navigate request');
    assert.equal(navigateCalls[0].params?.url, 'https://example.com/dest');
    assert.equal(navigateCalls[0].mark, 'navigate:https://example.com/dest');
    assert.equal(navigateCalls[0].waitEvent, 'Page.loadEventFired', 'the wait must be bundled on the SAME request, not a separate one');
  } finally {
    armed.cleanup();
  }
});

test('routed navigate preserves the loaderId and reports load-outcome=bounded-timeout when the load wait times out — no redispatch', async () => {
  const armed = await armActiveRecording('nav-bounded', {
    cdp: (req) => {
      if (req.type === 'cdp' && req.method === 'Page.navigate') {
        // Real cross-document nav whose load event did not fire inside the
        // load-wait window: the bridge preserves the method result (loaderId)
        // and tags waitOutcome:'bounded-timeout' with no event.
        return { reqId: req.reqId, ok: true, type: 'cdp', result: { loaderId: 'loader-1' }, waitOutcome: 'bounded-timeout' };
      }
      return defaultResponseFor(req);
    },
  });
  try {
    const { cmdPageNavigate } = await import('../src/cdp/commands/page/navigate.js');
    const parsed = minimalParsedArgs('page', { positional: ['https://example.com/slow'], json: true, settle: 0 });
    const output = await captureEmittedJson(() => cmdPageNavigate(parsed, []));

    assert.equal(output.tag, 'navigated');
    assert.equal(output.attrs['load-outcome'], 'bounded-timeout', 'a load-wait timeout with a present loaderId is bounded-timeout, not a failure');
    assert.equal(output.attrs['deadline-exceeded'], undefined);

    const navigateCalls = navigateCallsOf(armed.fakeServer.received);
    assert.equal(navigateCalls.length, 1, 'a bounded-timeout with loaderId present must NOT redispatch — exactly one Page.navigate');
    assert.equal(navigateCalls[0].params?.url, 'https://example.com/slow');
  } finally {
    armed.cleanup();
  }
});

test('routed navigate propagates a method dispatch failure without retrying (zero extra navigates)', async () => {
  const armed = await armActiveRecording('nav-method-fail', {
    cdp: (req) => {
      if (req.type === 'cdp' && req.method === 'Page.navigate') {
        // Method dispatch itself failed (distinct from a wait timeout) -> ok:false.
        return { reqId: req.reqId, ok: false, type: 'cdp', error: 'Cannot navigate to invalid URL' };
      }
      return defaultResponseFor(req);
    },
  });
  try {
    const { cmdPageNavigate } = await import('../src/cdp/commands/page/navigate.js');
    const parsed = minimalParsedArgs('page', { positional: ['https://example.com/boom'], settle: 0 });
    await assert.rejects(() => cmdPageNavigate(parsed, []), /Cannot navigate to invalid URL|navigate/i, 'a method dispatch failure must surface, not be swallowed or retried');

    const navigateCalls = navigateCallsOf(armed.fakeServer.received);
    assert.equal(navigateCalls.length, 1, 'a failed Page.navigate must not be retried — exactly one attempt');
  } finally {
    armed.cleanup();
  }
});

test('routed navigate to a same-document (no-loaderId) target bounces dest->about:blank->dest, with the wait bundled on each destination send but not the bounce', async () => {
  let destCount = 0;
  const armed = await armActiveRecording('nav-samedoc', {
    cdp: (req) => {
      if (req.type === 'cdp' && req.method === 'Page.navigate') {
        if (req.params?.url === 'about:blank') {
          return { reqId: req.reqId, ok: true, type: 'cdp', result: { loaderId: 'blank' } };
        }
        destCount += 1;
        if (destCount === 1) {
          // First destination attempt: same-document, no loaderId, load wait
          // times out (no fresh load event fires for a fragment change).
          return { reqId: req.reqId, ok: true, type: 'cdp', result: {}, waitOutcome: 'bounded-timeout' };
        }
        // Final re-navigate after the bounce delivers a real cross-document load.
        return { reqId: req.reqId, ok: true, type: 'cdp', result: { loaderId: 'loader-2' }, event: { name: 'loadEventFired' }, waitOutcome: 'observed' };
      }
      return defaultResponseFor(req);
    },
  });
  try {
    const { cmdPageNavigate } = await import('../src/cdp/commands/page/navigate.js');
    const parsed = minimalParsedArgs('page', { positional: ['https://example.com/app#frag'], json: true, settle: 0 });
    const output = await captureEmittedJson(() => cmdPageNavigate(parsed, []));

    assert.equal(output.attrs['load-outcome'], 'observed', 'the reported outcome comes from the final re-navigate after the bounce');

    const navigateCalls = navigateCallsOf(armed.fakeServer.received);
    assert.equal(navigateCalls.length, 3, 'same-document target -> dest, about:blank bounce, re-navigate (3 total)');
    assert.equal(navigateCalls[0].params?.url, 'https://example.com/app#frag');
    assert.equal(navigateCalls[0].waitEvent, 'Page.loadEventFired', 'the destination send always arms the wait (single-dispatch)');
    assert.equal(navigateCalls[1].params?.url, 'about:blank');
    assert.equal(navigateCalls[1].waitEvent, undefined, 'the about:blank bounce is a plain navigate with no wait');
    assert.equal(navigateCalls[2].params?.url, 'https://example.com/app#frag');
    assert.equal(navigateCalls[2].waitEvent, 'Page.loadEventFired', 'the final re-navigate arms the wait');
  } finally {
    armed.cleanup();
  }
});

// ---------------------------------------------------------------------------
// F4 — `cdp --wait-event` under an active recording resolves via the
// recorder's own event broker (RecorderHeldClient.waitEvent), not `.on()`.
// ---------------------------------------------------------------------------

test('F4: RecorderHeldClient.waitEvent resolves immediately from a fake server that answers the wait-event-only request', async () => {
  const eventFixture = { frameId: 'main', url: 'https://example.com/loaded' };
  const armed = await armActiveRecording('waitevent-ok', {
    cdp: (req) => {
      assert.equal(req.type, 'cdp');
      if (req.type === 'cdp' && !req.method) {
        assert.equal(req.waitEvent, 'Page.loadEventFired');
        return { reqId: req.reqId, ok: true, type: 'cdp', event: eventFixture };
      }
      return defaultResponseFor(req);
    },
  });
  try {
    const client = new RecorderHeldClient({
      socketPath: recorderSocketPath(recDirFor(armed.sessionDir, armed.recId)),
      actionLabel: 'cdp:wait',
    });
    const event = await client.waitEvent('Page.loadEventFired', 2000);
    assert.deepEqual(event, eventFixture);

    const waitReq = armed.fakeServer.received.find((r) => r.type === 'cdp' && !r.method);
    assert.ok(waitReq, 'the wire request must omit `method` entirely for a wait-event-only call');
  } finally {
    armed.cleanup();
  }
});

test('F4: RecorderHeldClient.waitEvent surfaces a real timeout (not a silent hang) when the fake server never answers', async () => {
  const sessionDir = freshSessionDir('waitevent-timeout');
  const recId = 'rec-waitevent-timeout';
  const recDir = recDirFor(sessionDir, recId);
  ensurePrivateDir(recDir);
  const socketPath = recorderSocketPath(recDir);

  // A server that accepts the connection but never writes a response line —
  // sendRecorderRequest's own wire-level timeout (timeoutMs + 5000ms) must fire.
  const server = net.createServer((socket) => {
    socket.on('data', () => {
      /* deliberately never respond */
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(socketPath, () => resolve());
  });

  try {
    const client = new RecorderHeldClient({ socketPath, actionLabel: 'cdp:wait', timeoutMs: 200 });
    await assert.rejects(
      () => client.waitEvent('Page.loadEventFired', 200),
      /timed out/i,
      'a recorder-routed wait-event must surface a real timeout error, not hang forever',
    );
  } finally {
    try {
      server.close();
    } catch {
      // Already closed.
    }
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // Already gone.
    }
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F4 — cmdCdp/runPageScope command-level: a combined method + --wait-event
// call under an active recording must actually drive the recorder-held
// branch (client.waitEvent()), not just RecorderHeldClient.waitEvent() in
// isolation — this is the wiring in src/cdp/commands/cdp.ts:158-166 itself.
// ---------------------------------------------------------------------------

test('F4: runPageScope (the cmdCdp page-scope path) issues ONE combined recorder request carrying method + --wait-event together and resolves { result, event } under an active recording', async () => {
  const eventFixture = { frameId: 'main', url: 'https://example.com/loaded' };
  const armed = await armActiveRecording('cdp-runpagescope', {
    cdp: (req) => {
      if (req.type === 'cdp' && req.method === 'Page.reload') {
        assert.equal(req.waitEvent, 'Page.loadEventFired', 'the combined request must carry both method and waitEvent together');
        return { reqId: req.reqId, ok: true, type: 'cdp', result: { reloaded: true }, event: eventFixture, waitOutcome: 'observed' };
      }
      return defaultResponseFor(req);
    },
  });
  try {
    const { runPageScope } = await import('../src/cdp/commands/cdp.js');
    const parsed = minimalParsedArgs('cdp', {
      positional: ['Page.reload'],
      waitEvent: 'Page.loadEventFired',
      timeoutMs: 2000,
    });

    const output = await captureEmittedJson(() => runPageScope('Page.reload', {}, { ...parsed, json: true }, 2000)) as { tag: string; attrs: Record<string, unknown>; sections: string[] };
    assert.equal(output.tag, 'cdp-result');
    assert.equal(output.attrs.method, 'Page.reload');
    assert.equal(output.attrs['wait-event'], 'Page.loadEventFired');
    assert.ok(
      output.sections.some((s) => s === `event: ${JSON.stringify(eventFixture)}`),
      'the resolved event must reach stdout via client.dispatch(), not a hung/no-op .on()',
    );
    assert.ok(output.sections.some((s) => s === `result: ${JSON.stringify({ reloaded: true })}`));

    const cdpRequests = armed.fakeServer.received.filter(
      (r): r is Extract<RecorderRequest, { type: 'cdp' }> => r.type === 'cdp',
    );
    assert.equal(cdpRequests.length, 1, 'a combined method+wait-event call must be issued as ONE recorder request, not two separate ones');
    assert.equal(cdpRequests[0].method, 'Page.reload');
    assert.equal(cdpRequests[0].waitEvent, 'Page.loadEventFired');
  } finally {
    armed.cleanup();
  }
});

// ---------------------------------------------------------------------------
// RecorderSession.handleCdp unit-level: method + wait-event outcome
// semantics (the root fix backing single-dispatch navigate) and the
// wait-event-only shape guards.
// ---------------------------------------------------------------------------

class StubCdpClient extends EventEmitter implements RecorderCdpClient {
  calls: Array<{ method: unknown; params?: Record<string, unknown> }> = [];

  async send(method: unknown, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    return { loaderId: 'stub-loader' };
  }

  on(event: string, handler: (params: unknown) => void): void {
    super.on(event, handler);
  }

  onDisconnect(handler: () => void): void {
    super.on('__disconnect', handler);
  }

  close(): void {
    // No-op.
  }

  fire(event: string, params: unknown): void {
    this.emit(event, params);
  }
}

function freshRecDir(label: string): string {
  fs.mkdirSync(CAPTURE_ROOT, { recursive: true });
  return path.join(CAPTURE_ROOT, `nav-waitevent-bridge-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

test('handleCdp: method + armed wait that observes its event returns ok:true with result, event, and waitOutcome:observed', async () => {
  const recDir = freshRecDir('handlecdp-observed');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });
  session.state = 'recording';

  try {
    const pending = session.handleCdp({ reqId: 1, type: 'cdp', method: 'Page.navigate', params: { url: 'https://example.com' }, waitEvent: 'Page.loadEventFired', timeoutMs: 2000 });
    await new Promise((r) => setTimeout(r, 10));
    client.fire('Page.loadEventFired', { frameId: 'main' });

    const outcome = await pending;
    assert.deepEqual(outcome.result, { loaderId: 'stub-loader' }, 'the method result must be preserved');
    assert.deepEqual(outcome.event, { frameId: 'main' });
    assert.equal(outcome.waitOutcome, 'observed');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('handleCdp: method + armed wait that TIMES OUT preserves the method result and reports waitOutcome:bounded-timeout (never destroys the result)', async () => {
  const recDir = freshRecDir('handlecdp-bounded');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });
  session.state = 'recording';

  try {
    // Never fire the event; a tiny timeoutMs makes the armed wait elapse fast.
    const outcome = await session.handleCdp({ reqId: 2, type: 'cdp', method: 'Page.navigate', params: { url: 'https://example.com' }, waitEvent: 'Page.loadEventFired', timeoutMs: 20 });

    assert.deepEqual(outcome.result, { loaderId: 'stub-loader' }, 'a wait timeout must NOT discard the method result (the root fix)');
    assert.equal(outcome.event, undefined, 'no event was observed');
    assert.equal(outcome.waitOutcome, 'bounded-timeout');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('handleRecorderRequest: a wait-event-ONLY request that times out is still ok:false (no method result to preserve)', async () => {
  const recDir = freshRecDir('handlecdp-waitonly-timeout');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });
  session.state = 'recording';

  try {
    const resp = await handleRecorderRequest(session, { reqId: 3, type: 'cdp', waitEvent: 'Never.fires', timeoutMs: 20 });
    assert.equal(resp.ok, false, 'a wait-event-only timeout is a genuine failure — there is no method result to preserve');
    assert.equal(resp.type, 'cdp');
    assert.equal(client.calls.length, 0, 'a wait-event-only request must never call client.send');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('F4: RecorderSession.handleCdp on a wait-event-only request never calls client.send with an undefined method, and resolves { event } once the event fires', async () => {
  const recDir = freshRecDir('handlecdp-waitevent');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });
  session.state = 'recording';

  try {
    const pending = session.handleCdp({ reqId: 4, type: 'cdp', waitEvent: 'Foo.bar', timeoutMs: 2000 });

    // Give the wait registration a tick to attach its listener before firing.
    await new Promise((r) => setTimeout(r, 10));
    client.fire('Foo.bar', { hello: 'world' });

    const outcome = await pending;
    assert.deepEqual(outcome, { event: { hello: 'world' } });
    assert.equal(outcome.result, undefined, 'a wait-event-only request must not carry a result');

    assert.ok(
      client.calls.every((c) => c.method !== undefined),
      'client.send must never be called with an undefined method',
    );
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// A `cdp` request that is neither a valid dispatch (nonempty string
// `method`) nor a valid wait-event-only request (nonempty string
// `waitEvent`) is rejected with an explicit protocol error, not silently
// treated as wait-event-only with `waitEvent` also missing/empty.
// ---------------------------------------------------------------------------

test('handleRecorderRequest rejects a cdp request with neither method nor waitEvent as an explicit ok:false protocol error', async () => {
  const recDir = freshRecDir('handlecdp-invalid-shape');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });
  session.state = 'recording';

  try {
    // Simulates the untyped-JSON case the review flagged: `runRecorderBridge`
    // casts arbitrary parsed JSON to `RecorderRequest`, so a wire payload
    // missing BOTH `method` and `waitEvent` reaches here despite
    // `RecCdpWaitEventRequest`'s type-level `waitEvent: string` requirement.
    const resp = await handleRecorderRequest(session, {
      reqId: 7,
      type: 'cdp',
    } as unknown as RecorderRequest);

    assert.equal(resp.ok, false, 'a cdp request with neither method nor waitEvent must not be treated as ok');
    assert.equal(resp.type, 'cdp');
    assert.equal(resp.reqId, 7);
    if (!resp.ok) {
      assert.match(resp.error, /method.*waitEvent|waitEvent.*method/i);
    }

    assert.equal(
      client.calls.length,
      0,
      'an invalid-shape request must be rejected before any CDP call is dispatched',
    );
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});

test('handleRecorderRequest rejects a cdp request with an empty-string waitEvent (and no method) rather than treating it as wait-event-only', async () => {
  const recDir = freshRecDir('handlecdp-empty-waitevent');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });
  session.state = 'recording';

  try {
    const resp = await handleRecorderRequest(session, {
      reqId: 8,
      type: 'cdp',
      waitEvent: '',
    } as unknown as RecorderRequest);

    assert.equal(resp.ok, false, 'an empty-string waitEvent (and no method) must not be treated as a valid wait-event-only request');
    assert.equal(resp.type, 'cdp');
  } finally {
    fs.rmSync(recDir, { recursive: true, force: true });
  }
});
