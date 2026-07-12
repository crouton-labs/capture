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
      if (req.method === 'Page.getNavigationHistory') {
        // Default "no useful history" fixture for tests that don't care about
        // same-document-vs-cross-document prediction: a plain distinct URL, so
        // `isSameDocumentTarget` predicts cross-document against any target
        // used by the existing (non-fragment) tests.
        return {
          reqId: req.reqId,
          ok: true,
          type: 'cdp',
          result: { currentIndex: 0, entries: [{ url: 'https://example.com' }] },
        };
      }
      return { reqId: req.reqId, ok: true, type: 'cdp', result: {} };
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
    url: 'https://example.com',
    startedAt: new Date().toISOString(),
    state: 'recording',
    markers: PENDING_MARKERS,
  };
  writeJsonPrivate(path.join(recDir, 'recorder.json'), recorderJson);
  setActiveSession({ sessionId: `s-${label}`, dir: sessionDir, harId: null, targetId: 'target-abc', stepCount: 0 });
  setActiveRecId(recId);

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

// ---------------------------------------------------------------------------
// Routed `capture page navigate` marks Page.navigate through the active
// recorder, and the fragment-fix bounce only fires when the fake server
// reports no loaderId.
// ---------------------------------------------------------------------------

test('cmdPageNavigate sends ONE combined marked Page.navigate+wait-event request through the active recorder and does NOT bounce through about:blank for a predicted cross-document nav', async () => {
  const armed = await armActiveRecording('nav-marked', {
    cdp: (req) => {
      if (req.type === 'cdp' && req.method === 'Page.navigate') {
        assert.equal(req.waitEvent, 'Page.loadEventFired', 'a predicted cross-document nav must bundle the load-event wait atomically onto the navigate call');
        return { reqId: req.reqId, ok: true, type: 'cdp', result: { loaderId: 'loader-1' }, event: { name: 'loadEventFired' } };
      }
      return defaultResponseFor(req);
    },
  });
  // cmdPageNavigate emits through render.ts's emitResult (process.stdout.write),
  // so the capture TEES the stream write — node's test runner shares this
  // same stdout for its own child-process protocol, so the original write
  // must keep flowing; the emitted result is recovered as the one captured
  // chunk that is a JSON object (emitResult writes it as a single chunk).
  const originalWrite = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    const { cmdPageNavigate } = await import('../src/cdp/commands/page/navigate.js');
    const parsed = minimalParsedArgs('page', { positional: ['https://example.com/dest'], json: true });
    await cmdPageNavigate(parsed, []);

    // Exercises cmdPageNavigate itself end-to-end (not
    // tryNavigateViaActiveRecorder directly) so a regression in the leaf's
    // routing call or its emitted output shape actually fails this test.
    const resultChunk = chunks.find((c) => c.trimStart().startsWith('{'));
    assert.ok(resultChunk, `expected one emitted JSON result chunk on stdout; got: ${JSON.stringify(chunks)}`);
    const output = JSON.parse(resultChunk) as { tag: string; attrs: Record<string, unknown> };
    assert.equal(output.tag, 'navigated');
    assert.equal(output.attrs.url, 'https://example.com/dest');
    assert.equal(output.attrs.routed, true, 'a routed navigate must carry the routed dispatch fact');
    assert.equal(output.attrs['timed-out'], false);
    assert.equal(output.attrs.settle, 2000, 'the default 2000ms settle must be reported as applied');

    const navigateCalls = armed.fakeServer.received.filter(
      (r): r is Extract<RecorderRequest, { type: 'cdp' }> => r.type === 'cdp' && r.method === 'Page.navigate',
    );
    assert.equal(navigateCalls.length, 1, 'predicted cross-document + loaderId present -> no about:blank bounce, exactly ONE combined Page.navigate request');
    assert.equal(navigateCalls[0].params?.url, 'https://example.com/dest');
    assert.equal(navigateCalls[0].mark, 'navigate:https://example.com/dest');
    assert.equal(navigateCalls[0].waitEvent, 'Page.loadEventFired', 'the wait must be bundled on the SAME request, not a separate one');
  } finally {
    process.stdout.write = originalWrite;
    armed.cleanup();
  }
});

test('F2: tryNavigateViaActiveRecorder bounces through about:blank and re-navigates when the current tab URL predicts a same-document (fragment-only) target, bundling the wait only on the final re-navigate', async () => {
  const armed = await armActiveRecording('nav-bounce', {
    cdp: (req) => {
      if (req.type === 'cdp' && req.method === 'Page.getNavigationHistory') {
        // Predicts same-document: the current URL already matches the target minus its fragment.
        return {
          reqId: req.reqId,
          ok: true,
          type: 'cdp',
          result: { currentIndex: 0, entries: [{ url: 'https://example.com/dest' }] },
        };
      }
      if (req.type === 'cdp' && req.method === 'Page.navigate') {
        return { reqId: req.reqId, ok: true, type: 'cdp', result: {}, event: req.waitEvent ? { name: 'loadEventFired' } : undefined };
      }
      return defaultResponseFor(req);
    },
  });
  try {
    const { tryNavigateViaActiveRecorder } = await import('../src/cdp/commands/page/navigate.js');
    const parsed = minimalParsedArgs('page', { positional: ['https://example.com/dest#frag'] });
    const routed = await tryNavigateViaActiveRecorder(parsed, 'https://example.com/dest#frag');

    assert.deepEqual(routed, {
      entryCount: 0,
      harPath: undefined,
      tabUrl: 'https://example.com/dest#frag',
      timedOut: false,
    });

    const navigateCalls = armed.fakeServer.received.filter(
      (r): r is Extract<RecorderRequest, { type: 'cdp' }> => r.type === 'cdp' && r.method === 'Page.navigate',
    );
    assert.equal(navigateCalls.length, 3, 'predicted same-document -> navigate, about:blank bounce, re-navigate (3 total)');
    assert.equal(navigateCalls[0].params?.url, 'https://example.com/dest#frag');
    assert.equal(navigateCalls[0].waitEvent, undefined, 'the exploratory first navigate must NOT bundle the wait (it never fires a fresh load event)');
    assert.equal(navigateCalls[1].params?.url, 'about:blank');
    assert.equal(navigateCalls[1].waitEvent, undefined);
    assert.equal(navigateCalls[2].params?.url, 'https://example.com/dest#frag');
    assert.equal(navigateCalls[2].waitEvent, 'Page.loadEventFired', 'the wait must be bundled only on the definite final re-navigate');
  } finally {
    armed.cleanup();
  }
});

test('F2: tryNavigateViaActiveRecorder tolerates a failed/timed-out load-event wait on the predicted same-document final re-navigate rather than rejecting the whole call', async () => {
  const armed = await armActiveRecording('nav-bounce-timeout', {
    cdp: (req) => {
      if (req.type === 'cdp' && req.method === 'Page.getNavigationHistory') {
        // Predicts same-document: the current URL already matches the target minus its fragment.
        return {
          reqId: req.reqId,
          ok: true,
          type: 'cdp',
          result: { currentIndex: 0, entries: [{ url: 'https://example.com/dest' }] },
        };
      }
      if (req.type === 'cdp' && req.method === 'Page.navigate' && req.waitEvent) {
        // The final same-document re-navigate's bundled load-event wait times
        // out server-side (handleCdp's this.events.wait(...) rejecting) —
        // handleRecorderRequest's catch turns the WHOLE response into
        // ok:false, same as any other cdp failure.
        return { reqId: req.reqId, ok: false, type: 'cdp', error: 'Timed out after 10000ms waiting for event "Page.loadEventFired"' };
      }
      if (req.type === 'cdp' && req.method === 'Page.navigate') {
        return { reqId: req.reqId, ok: true, type: 'cdp', result: {} };
      }
      return defaultResponseFor(req);
    },
  });
  try {
    const { tryNavigateViaActiveRecorder } = await import('../src/cdp/commands/page/navigate.js');
    const parsed = minimalParsedArgs('page', { positional: ['https://example.com/dest#frag'] });
    const routed = await tryNavigateViaActiveRecorder(parsed, 'https://example.com/dest#frag');

    assert.deepEqual(
      routed,
      {
        entryCount: 0,
        harPath: undefined,
        tabUrl: 'https://example.com/dest#frag',
        timedOut: false,
      },
      'a failed load-event wait on the final same-document re-navigate must not reject/throw the whole routed navigate — same tolerance as the cross-document recovery path',
    );

    const navigateCalls = armed.fakeServer.received.filter(
      (r): r is Extract<RecorderRequest, { type: 'cdp' }> => r.type === 'cdp' && r.method === 'Page.navigate',
    );
    assert.equal(navigateCalls.length, 3, 'predicted same-document -> navigate, about:blank bounce, re-navigate (3 total), even though the final one times out');
    assert.equal(navigateCalls[2].waitEvent, 'Page.loadEventFired');
  } finally {
    armed.cleanup();
  }
});

test('F2: with no active session/activeRecId, the routing helper returns null without opening a recorder connection', async () => {
  clearActiveSession();
  const { tryNavigateViaActiveRecorder } = await import('../src/cdp/commands/page/navigate.js');
  const parsed = minimalParsedArgs('page', { positional: ['https://example.com/no-session'] });
  const routed = await tryNavigateViaActiveRecorder(parsed, 'https://example.com/no-session');
  assert.equal(routed, null);
});

test('a stale activeRecId with no routable recorder falls back to null instead of connectForCommand() throwing', async () => {
  // A stale active-session pointer can carry an activeRecId with no
  // recorder.json at all (stopped/reaped and the pointer wasn't cleared
  // yet, or never existed). isRecorderRoutable() checks for a live,
  // 'recording'-state recorder.json before tryNavigateViaActiveRecorder ever
  // calls connectForCommand() — without that check, connectForCommand()
  // would find no routable recorder and fall through to its "Use --target
  // <tabId> or --url <pattern>..." throw, because navigate's URL is
  // positional, not parsed.url/parsed.target.
  const sessionDir = freshSessionDir('stale-recid');
  const recId = 'rec-stale-does-not-exist';
  setActiveSession({ sessionId: 's-stale', dir: sessionDir, harId: null, targetId: null, stepCount: 0 });
  setActiveRecId(recId);
  try {
    const { tryNavigateViaActiveRecorder } = await import('../src/cdp/commands/page/navigate.js');
    const parsed = minimalParsedArgs('page', { positional: ['https://example.com/stale'] });
    const routed = await tryNavigateViaActiveRecorder(parsed, 'https://example.com/stale');
    assert.equal(routed, null, 'a non-routable recorder must fall back to null, not throw');
  } finally {
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F2 Major fix — routed navigate must honor the SAME load/settle/timeout
// semantics as the non-routed path (review Major #1): it must not return as
// soon as Page.navigate resolves; it must await Page.loadEventFired (via
// the recorder's wait-event path) THEN settle, and it must tolerate a
// stalled/failed load-event wait rather than hanging.
// ---------------------------------------------------------------------------

test('F2 (Major fix): tryNavigateViaActiveRecorder awaits Page.loadEventFired bundled atomically onto the combined Page.navigate request, THEN applies --settle, before returning', async () => {
  const loadEventDelayMs = 150;
  const settleMs = 80;
  const armed = await armActiveRecording('nav-load-settle', {
    cdp: async (req) => {
      if (req.type === 'cdp' && req.method === 'Page.navigate') {
        assert.equal(req.waitEvent, 'Page.loadEventFired', 'a predicted cross-document navigate must bundle the wait on the SAME request');
        // Delay the response so a premature return (before this resolves)
        // would make the assertions below fail.
        await new Promise((r) => setTimeout(r, loadEventDelayMs));
        return { reqId: req.reqId, ok: true, type: 'cdp', result: { loaderId: 'loader-1' }, event: { name: 'loadEventFired' } };
      }
      return defaultResponseFor(req);
    },
  });
  try {
    const { tryNavigateViaActiveRecorder } = await import('../src/cdp/commands/page/navigate.js');
    const parsed = minimalParsedArgs('page', {
      positional: ['https://example.com/dest'],
      settle: settleMs,
    });
    const t0 = Date.now();
    const routed = await tryNavigateViaActiveRecorder(parsed, 'https://example.com/dest');
    const elapsed = Date.now() - t0;

    assert.deepEqual(routed, {
      entryCount: 0,
      harPath: undefined,
      tabUrl: 'https://example.com/dest',
      timedOut: false,
    });
    assert.ok(
      elapsed >= loadEventDelayMs + settleMs - 10,
      `expected routed navigate to await the load wait (${loadEventDelayMs}ms) then settle ` +
        `(${settleMs}ms) before returning; got elapsed=${elapsed}ms`,
    );

    const navigateCalls = armed.fakeServer.received.filter((r) => r.type === 'cdp' && r.method === 'Page.navigate');
    assert.equal(navigateCalls.length, 1, 'a single combined request must carry both the navigate and the load-event wait — no separate wait-only request');
  } finally {
    armed.cleanup();
  }
});

test('F2 (Major fix): tryNavigateViaActiveRecorder tolerates a failed/timed-out load-event wait — the combined request\'s ok:false response (which also loses `loaderId`, per the bridge\'s known swallow-on-timeout behavior) recovers via a plain re-navigate rather than hanging, rejecting, or spuriously bouncing', async () => {
  const settleMs = 30;
  const armed = await armActiveRecording('nav-load-wait-fails', {
    cdp: (req) => {
      if (req.type === 'cdp' && req.method === 'Page.navigate' && req.waitEvent) {
        // Simulates the recorder bridge's own event-wait timing out server-side
        // (handleCdp's this.events.wait(...) rejecting) — handleRecorderRequest's
        // catch turns the WHOLE response into ok:false, discarding `loaderId`
        // along with the event, same shape as any other cdp failure.
        return { reqId: req.reqId, ok: false, type: 'cdp', error: 'Timed out after 10000ms waiting for event "Page.loadEventFired"' };
      }
      if (req.type === 'cdp' && req.method === 'Page.navigate') {
        // The recovery path's plain (no-wait) re-navigate: a real load did
        // complete server-side even though the bundled wait above timed out.
        return { reqId: req.reqId, ok: true, type: 'cdp', result: { loaderId: 'loader-1' } };
      }
      return defaultResponseFor(req);
    },
  });
  try {
    const { tryNavigateViaActiveRecorder } = await import('../src/cdp/commands/page/navigate.js');
    const parsed = minimalParsedArgs('page', {
      positional: ['https://example.com/dest'],
      settle: settleMs,
    });
    const routed = await tryNavigateViaActiveRecorder(parsed, 'https://example.com/dest');

    assert.deepEqual(
      routed,
      { entryCount: 0, harPath: undefined, tabUrl: 'https://example.com/dest', timedOut: false },
      'a failed load-event wait must not fail the whole navigate — same tolerance as the non-routed path\'s own 10s inner timer',
    );

    const navigateCalls = armed.fakeServer.received.filter((r) => r.type === 'cdp' && r.method === 'Page.navigate');
    assert.equal(
      navigateCalls.length,
      2,
      'the timed-out combined attempt plus one plain recovery re-navigate that reports a real loaderId — no spurious about:blank bounce',
    );
  } finally {
    armed.cleanup();
  }
});

test('F2 (Major fix): waitForLoadAndSettle (the shared helper backing both navigate paths) reports timedOut when the OUTER deadline elapses', async () => {
  const { waitForLoadAndSettle } = await import('../src/cdp/record.js');
  const neverResolves = (): Promise<void> => new Promise<void>(() => {});
  const t0 = Date.now();
  const result = await waitForLoadAndSettle(neverResolves, 5000, 60);
  const elapsed = Date.now() - t0;

  assert.deepEqual(result, { timedOut: true });
  assert.ok(elapsed < 5000, 'the outer deadline (60ms) must win over the (deliberately never-resolving) inner wait');
});

// ---------------------------------------------------------------------------
// Re-review regression fix — the non-routed path's HAR finalization
// (`recorder.finish()`) must be covered by the SAME 60s deadline as
// load-wait + settle (it was pulled OUTSIDE the raced region by the U14b
// refactor), and non-routed navigate must emit exactly one timeout line
// (the refactor had briefly caused both the shared helper's own line AND
// navigateAndRecord()'s pre-existing line to print).
// ---------------------------------------------------------------------------

test('waitForLoadAndSettle: afterSettle (standing in for navigateAndRecord()\'s recorder.finish()) runs INSIDE the raced region, so a slow finalization alone can trip the outer deadline', async () => {
  const { waitForLoadAndSettle } = await import('../src/cdp/record.js');
  const instantLoad = (): Promise<void> => Promise.resolve();

  // Load-wait and settle both resolve immediately, leaving the whole 80ms
  // deadline budget unspent — only a slow `afterSettle` (the recorder.finish()
  // stand-in) can push elapsed time past it. Pre-refactor, this HAR
  // finalization step ran inside the same raced branch as load-wait/settle;
  // if `afterSettle` ran OUTSIDE the deadline race (the regression), this
  // would return `timedOut: false` no matter how slow it is.
  const slowHarFinalization = (): Promise<void> => new Promise((r) => setTimeout(r, 200));

  const result = await waitForLoadAndSettle(instantLoad, 0, 80, slowHarFinalization, false);

  assert.deepEqual(result, { timedOut: true }, 'a slow HAR finalization inside afterSettle must be covered by the outer deadline');
});

test('waitForLoadAndSettle: logTimeout:false (the flag navigateAndRecord() passes) suppresses the helper\'s own "Navigate timeout" line so the non-routed path logs exactly one timeout line, not two', async () => {
  const { waitForLoadAndSettle } = await import('../src/cdp/record.js');
  const neverResolves = (): Promise<void> => new Promise<void>(() => {});

  const restoreError = console.error;
  const errors: string[] = [];
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => String(a)).join(' '));
  };
  let result;
  try {
    result = await waitForLoadAndSettle(neverResolves, 5000, 60, undefined, false);
    // Mirrors navigateAndRecord()'s own post-timeout log line exactly, so the
    // full simulated output below matches navigateAndRecord()'s real output.
    if (result.timedOut) {
      console.error('Navigate timeout (60s) — returning partial HAR');
    }
  } finally {
    console.error = restoreError;
  }

  assert.deepEqual(result, { timedOut: true });
  const timeoutLines = errors.filter((line) => line.startsWith('Navigate timeout'));
  assert.equal(timeoutLines.length, 1, `expected exactly one timeout line, got: ${JSON.stringify(errors)}`);
  assert.equal(timeoutLines[0], 'Navigate timeout (60s) — returning partial HAR');
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
        return { reqId: req.reqId, ok: true, type: 'cdp', result: { reloaded: true }, event: eventFixture };
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

    // runPageScope emits through render.ts's emitResult (process.stdout.write)
    // — tee the stream (node's test runner shares it for its own protocol) and
    // recover the emitted JSON mirror chunk.
    const originalWrite = process.stdout.write.bind(process.stdout);
    const chunks: string[] = [];
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      chunks.push(String(chunk));
      return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof process.stdout.write;
    try {
      await runPageScope('Page.reload', {}, { ...parsed, json: true }, 2000);
    } finally {
      process.stdout.write = originalWrite;
    }

    const resultChunk = chunks.find((c) => c.trimStart().startsWith('{'));
    assert.ok(resultChunk, `expected one emitted JSON result chunk on stdout; got: ${JSON.stringify(chunks)}`);
    const output = JSON.parse(resultChunk) as { tag: string; attrs: Record<string, unknown>; sections: string[] };
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
// F4 — RecorderSession.handleCdp unit-level: a wait-event-only request must
// never call client.send with an undefined method.
// ---------------------------------------------------------------------------

class StubCdpClient extends EventEmitter implements RecorderCdpClient {
  calls: Array<{ method: unknown; params?: Record<string, unknown> }> = [];

  async send(method: unknown, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    return {};
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

test('F4: RecorderSession.handleCdp on a wait-event-only request never calls client.send with an undefined method, and resolves { event } once the event fires', async () => {
  const recDir = freshRecDir('handlecdp-waitevent');
  const client = new StubCdpClient();
  const session = new RecorderSession({ client, recDir });
  session.state = 'recording';

  try {
    const pending = session.handleCdp({ reqId: 1, type: 'cdp', waitEvent: 'Foo.bar', timeoutMs: 2000 });

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
