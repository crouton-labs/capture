import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate, processPidBirthProvider, type PidBirth } from '../src/session/artifacts.js';
import { listenNdjsonSocket, closeNdjsonSocket } from '../src/cdp/bridge/server.js';
import { recorderSocketPath } from '../src/cdp/bridge/spawn.js';
import { setActiveSession, setActiveRecId, getActiveRecId, getActiveSession, clearActiveSession } from '../src/session-context.js';
import {
  recDirFor,
  startComposedRecorder,
  teardownAnyLiveRecorderAtSessionStop,
  type RecorderJson,
} from '../src/cdp/motion/recorder.js';
import {
  RECORDER_NONCE_BOOT_FILE,
  runRecorderBridge,
  __setRecorderBridgeDepsForTest,
  OBSERVER_INSTALLED_SENTINEL,
  type RecorderCdpClient,
} from '../src/cdp/recorder-bridge.js';
import { sessionMain } from '../src/session/commands.js';
import { createHarRecording, readHarRecording, deleteHarRecording } from '../src/har-manager.js';
import { type CDPClient } from '../src/cdp/client.js';
import { type findTabByIdAcrossEndpoints } from '../src/cdp/targets.js';
import { type ParsedArgs } from '../src/cdp/types.js';
import { type RecorderRequest, type RecorderResponse, type RecorderClockBaselines } from '../src/cdp/bridge/protocol.js';

// Isolates this file's active-session pointer from any other concurrent
// `capture` usage on the machine (node's test runner process-isolates each
// test file by default, so this only scopes THIS file's process).
process.env.CRTR_NODE_ID = `u14-teardown-test-${process.pid}-${Date.now()}`;

function freshSessionId(label: string): string {
  return `u14-teardown-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sessionDirFor(id: string): string {
  return path.join(CAPTURE_ROOT, id);
}

/** Writes a minimal on-disk `.session.json` fixture that `readSession` accepts
 * (mirrors test/session-measure-motion-bundle.test.ts's own fixture helper). */
function writeSessionFixture(id: string, dir: string): void {
  writeJsonPrivate(path.join(dir, '.session.json'), {
    id,
    dir,
    harId: null,
    startedAt: new Date().toISOString(),
    url: 'https://example.com',
    targetId: 'target-abc',
    stepCount: 0,
    logPids: [],
    bridgeSocket: null,
    bridgePid: null,
  });
}

function captureStdout(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(' '));
  };
  return { logs, restore: () => { console.log = originalLog; } };
}

/** The one recorder-control nonce every fixture in this file uses — 64 hex
 * chars, matching coordinator.ts's RECORDER_NONCE authority shape. */
const TEST_NONCE = 'ab'.repeat(32);

const PENDING_MARKERS: RecorderClockBaselines = {
  performanceNowMs: 1,
  wallClockMs: 1_700_000_000_000,
  firstScreencastTimestampSec: null,
  firstTraceEventTsUs: null,
  baselinesPending: true,
};

function defaultResponseFor(req: RecorderRequest): RecorderResponse {
  switch (req.type) {
    case 'rec-start':
      return { reqId: req.reqId, ok: true, type: 'rec-start', markers: PENDING_MARKERS };
    case 'rec-stop':
      return {
        reqId: req.reqId,
        ok: true,
        type: 'rec-stop',
        frameCount: 4,
        eventCount: 6,
        durationMs: 2200,
        markers: { ...PENDING_MARKERS, firstScreencastTimestampSec: 0.2, firstTraceEventTsUs: 200, baselinesPending: false },
      };
    case 'cdp':
      return { reqId: req.reqId, ok: true, type: 'cdp', result: {} };
  }
}

/** Same fake recorder-bridge NDJSON socket server as test/motion-rec-lifecycle.test.ts. */
async function startFakeRecorderServer(
  socketPath: string,
  handlers: Partial<Record<RecorderRequest['type'], (req: RecorderRequest) => RecorderResponse>> = {},
): Promise<{ received: RecorderRequest[]; close: () => void }> {
  const received: RecorderRequest[] = [];
  const server: net.Server = await listenNdjsonSocket(socketPath, (line, socket) => {
    const req = JSON.parse(line) as RecorderRequest;
    received.push(req);
    const handler = handlers[req.type];
    const resp = handler ? handler(req) : defaultResponseFor(req);
    socket.write(JSON.stringify(resp) + '\n');
  });
  return { received, close: () => closeNdjsonSocket(server, socketPath) };
}

async function spawnAndWaitDead(): Promise<number> {
  const child = spawn(process.execPath, ['-e', '0']);
  const pid = child.pid!;
  await new Promise<void>((resolve) => child.on('exit', () => resolve()));
  return pid;
}

/** Spawns a real, long-lived, harmless child process to stand in for a live
 * recorder-bridge process's pid -- NEVER the test's own process.pid, because
 * the graceful teardown path sends a real SIGTERM to the pid it's given via
 * stopBridge(); using the test process's own pid there would kill the test
 * runner itself mid-test. */
function spawnPlaceholderChild(): { pid: number; kill: () => void } {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  const pid = child.pid!;
  return { pid, kill: () => { try { child.kill(); } catch { /* already dead */ } } };
}

/** Reads the real pid-birth identity for a live pid -- every hand-written
 * recorder.json fixture MUST carry a structurally-valid `birth`, or the scan
 * classifies it malformed and teardown misbehaves. */
function birthOf(pid: number): PidBirth {
  const r = processPidBirthProvider.read(pid);
  if (r.status !== 'found') throw new Error('no birth for pid ' + pid);
  return r.identity;
}

/** Local liveness probe (the deleted bare-pid liveness export's replacement). */
function pidLive(pid: number): boolean {
  return processPidBirthProvider.read(pid).status === 'found';
}

// ---------------------------------------------------------------------------
// Unit-level: teardownAnyLiveRecorderAtSessionStop against hand-constructed
// live and dead-pid recorders.
// ---------------------------------------------------------------------------

test('teardownAnyLiveRecorderAtSessionStop gracefully stops a live (socket-reachable) recorder', async () => {
  const id = freshSessionId('live');
  const dir = sessionDirFor(id);
  ensurePrivateDir(dir);
  const recId = 'rec-live1';
  const recDir = recDirFor(dir, recId);
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
    birth: birthOf(placeholder.pid),
    markers: PENDING_MARKERS,
    nonce: TEST_NONCE,
  };
  writeJsonPrivate(path.join(recDir, 'recorder.json'), recorderJson);
  await setActiveSession({ sessionId: id, dir, harId: null, targetId: 'target-abc', stepCount: 0 });
  await setActiveRecId(recId);

  const fakeServer = await startFakeRecorderServer(socketPath);
  try {
    const result = await teardownAnyLiveRecorderAtSessionStop(dir, { stopExitTimeoutMs: 50 });

    assert.ok(result);
    assert.equal(result!.state, 'finalized');
    assert.equal(result!.frames, 4);
    assert.equal(fs.existsSync(path.join(recDir, 'recorder.json')), false);
    assert.ok(fs.existsSync(path.join(recDir, 'markers.json')));
    assert.ok(fs.existsSync(path.join(recDir, 'meta.json')));
    assert.equal(getActiveRecId(), null);
  } finally {
    fakeServer.close();
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('teardownAnyLiveRecorderAtSessionStop best-effort finalizes an orphaned (dead-pid) recorder', async () => {
  const id = freshSessionId('dead');
  const dir = sessionDirFor(id);
  ensurePrivateDir(dir);
  const recId = 'rec-dead1';
  const recDir = recDirFor(dir, recId);
  ensurePrivateDir(recDir);
  ensurePrivateDir(path.join(recDir, 'frames'));

  const deadPid = await spawnAndWaitDead();
  const recorderJson: RecorderJson = {
    recId,
    pid: deadPid,
    socketPath: recorderSocketPath(recDir),
    targetId: 'target-abc',
    url: 'https://example.com',
    startedAt: new Date(Date.now() - 1000).toISOString(),
    state: 'recording',
    birth: birthOf(process.pid),
    markers: PENDING_MARKERS,
    nonce: TEST_NONCE,
  };
  writeJsonPrivate(path.join(recDir, 'recorder.json'), recorderJson);
  await setActiveSession({ sessionId: id, dir, harId: null, targetId: 'target-abc', stepCount: 0 });
  await setActiveRecId(recId);

  try {
    const result = await teardownAnyLiveRecorderAtSessionStop(dir, { stopExitTimeoutMs: 50 });

    assert.ok(result);
    assert.equal(result!.state, 'orphaned-finalized');
    assert.equal(fs.existsSync(path.join(recDir, 'recorder.json')), false);
    assert.equal(getActiveRecId(), null);
  } finally {
    clearActiveSession();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('teardownAnyLiveRecorderAtSessionStop kills a known-live-but-unresponsive recorder pid before orphan-finalizing it on disk', async () => {
  // Regression for the U14 re-review "Minor teardown leak": the pid answers
  // pidLive() but its socket round trip (rec-stop) fails (e.g. the bridge
  // process wedged/crashed while its OS process lingers) -- teardown must
  // still SIGTERM the known-live pid while orphan-finalizing on disk, not
  // route it through the null-pid cleanup path and leak it as a zombie.
  const id = freshSessionId('unresponsive');
  const dir = sessionDirFor(id);
  ensurePrivateDir(dir);
  const recId = 'rec-unresponsive1';
  const recDir = recDirFor(dir, recId);
  ensurePrivateDir(recDir);
  // Deliberately NEVER start a socket server at this path: the pid is alive
  // (pidLive() sees it) but nothing is listening on its NDJSON socket, so
  // requestRecStop()'s connection attempt errors immediately (ENOENT) --
  // forcing teardownAnyLiveRecorderAtSessionStop() into its catch path.
  const socketPath = recorderSocketPath(recDir);
  const placeholder = spawnPlaceholderChild();

  const recorderJson: RecorderJson = {
    recId,
    pid: placeholder.pid,
    socketPath,
    targetId: 'target-abc',
    url: 'https://example.com',
    startedAt: new Date(Date.now() - 1000).toISOString(),
    state: 'recording',
    birth: birthOf(placeholder.pid),
    markers: PENDING_MARKERS,
    nonce: TEST_NONCE,
  };
  writeJsonPrivate(path.join(recDir, 'recorder.json'), recorderJson);
  await setActiveSession({ sessionId: id, dir, harId: null, targetId: 'target-abc', stepCount: 0 });
  await setActiveRecId(recId);

  try {
    assert.ok(pidLive(placeholder.pid), 'placeholder pid must be alive before teardown');

    const result = await teardownAnyLiveRecorderAtSessionStop(dir, { stopExitTimeoutMs: 50 });

    assert.ok(result);
    assert.equal(result!.state, 'orphaned-finalized');
    assert.equal(fs.existsSync(path.join(recDir, 'recorder.json')), false, 'recorder.json must be removed');
    assert.ok(fs.existsSync(path.join(recDir, 'meta.json')), 'meta.json must be written');
    assert.equal(getActiveRecId(), null);

    // The regression itself: the known-live-but-unresponsive pid must
    // actually be SIGTERM'd, not merely finalized on disk while the process
    // leaks on as a zombie recorder. SIGTERM delivery/exit is async, so poll.
    const deadline = Date.now() + 3000;
    while (pidLive(placeholder.pid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(pidLive(placeholder.pid), false, 'the known-live pid must be killed, not leaked as a zombie recorder process');
  } finally {
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('teardownAnyLiveRecorderAtSessionStop is a no-op when there is no active recording', async () => {
  const id = freshSessionId('none');
  const dir = sessionDirFor(id);
  ensurePrivateDir(dir);
  clearActiveSession();

  try {
    const result = await teardownAnyLiveRecorderAtSessionStop(dir, { stopExitTimeoutMs: 50 });
    assert.equal(result, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Directory-authoritative reap/teardown (finding 1 of the U14 review):
// teardown must not depend on the active-session pointer still naming the
// recorder -- it must discover a live-recorder handle by scanning
// `motion/recs/*/recorder.json` directly.
// ---------------------------------------------------------------------------

test('teardownAnyLiveRecorderAtSessionStop finalizes an on-disk recorder.json even when NO activeRecId is set', async () => {
  const id = freshSessionId('no-pointer');
  const dir = sessionDirFor(id);
  ensurePrivateDir(dir);
  const recId = 'rec-no-pointer1';
  const recDir = recDirFor(dir, recId);
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
    birth: birthOf(placeholder.pid),
    markers: PENDING_MARKERS,
    nonce: TEST_NONCE,
  };
  writeJsonPrivate(path.join(recDir, 'recorder.json'), recorderJson);
  // Deliberately NO setActiveSession/setActiveRecId -- there is no active
  // pointer naming this recorder at all (this caller scope has no active
  // session pointer). Teardown must still discover and finalize it by
  // scanning the session directory.
  clearActiveSession();

  const fakeServer = await startFakeRecorderServer(socketPath);
  try {
    const result = await teardownAnyLiveRecorderAtSessionStop(dir, { stopExitTimeoutMs: 50 });

    assert.ok(result, 'a recorder.json on disk with no activeRecId must still be finalized');
    assert.equal(result!.recId, recId);
    assert.equal(result!.state, 'finalized');
    assert.equal(fs.existsSync(path.join(recDir, 'recorder.json')), false, 'recorder.json must be removed');
    assert.ok(fs.existsSync(path.join(recDir, 'meta.json')), 'meta.json must be written');
  } finally {
    fakeServer.close();
    placeholder.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('teardownAnyLiveRecorderAtSessionStop finalizes session A\'s on-disk recorder without touching session B\'s active pointer', async () => {
  const idA = freshSessionId('scope-a');
  const dirA = sessionDirFor(idA);
  ensurePrivateDir(dirA);
  const recIdA = 'rec-scope-a1';
  const recDirA = recDirFor(dirA, recIdA);
  ensurePrivateDir(recDirA);
  const socketPathA = recorderSocketPath(recDirA);
  const placeholderA = spawnPlaceholderChild();

  const recorderJsonA: RecorderJson = {
    recId: recIdA,
    pid: placeholderA.pid,
    socketPath: socketPathA,
    targetId: 'target-a',
    url: 'https://a.example.com',
    startedAt: new Date().toISOString(),
    state: 'recording',
    birth: birthOf(placeholderA.pid),
    markers: PENDING_MARKERS,
    nonce: TEST_NONCE,
  };
  writeJsonPrivate(path.join(recDirA, 'recorder.json'), recorderJsonA);

  // Session B is the CURRENTLY ACTIVE session for this caller scope --
  // its own activeRecId names a recording that has nothing to do with A.
  const idB = freshSessionId('scope-b');
  const dirB = sessionDirFor(idB);
  ensurePrivateDir(dirB);
  await setActiveSession({ sessionId: idB, dir: dirB, harId: null, targetId: 'target-b', stepCount: 0 });
  await setActiveRecId('rec-scope-b1');

  const fakeServerA = await startFakeRecorderServer(socketPathA);
  try {
    const result = await teardownAnyLiveRecorderAtSessionStop(dirA, { stopExitTimeoutMs: 50 });

    assert.ok(result, 'session A\'s on-disk recorder must still be finalized');
    assert.equal(result!.recId, recIdA);
    assert.equal(result!.state, 'finalized');
    assert.equal(fs.existsSync(path.join(recDirA, 'recorder.json')), false);

    // Session B's pointer -- dir AND activeRecId -- must be completely
    // untouched by tearing down session A.
    const stillActive = getActiveSession();
    assert.ok(stillActive);
    assert.equal(stillActive!.dir, dirB);
    assert.equal(stillActive!.sessionId, idB);
    assert.equal(stillActive!.activeRecId, 'rec-scope-b1');
  } finally {
    fakeServerA.close();
    placeholderA.kill();
    clearActiveSession();
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Integration: `session stop <id>` must finalize the live recorder BEFORE
// bundle collection, so bundle.json's `recs[]` entry reflects the just-
// finalized recording -- proving the ordering, not just that the teardown
// function exists in isolation.
// ---------------------------------------------------------------------------

test('session stop finalizes an active recording before collecting the bundle, so bundle.json.recs reflects it', async () => {
  const id = freshSessionId('bundle');
  const dir = sessionDirFor(id);
  ensurePrivateDir(dir);
  writeSessionFixture(id, dir);

  const recId = 'rec-bundle1';
  const recDir = recDirFor(dir, recId);
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
    birth: birthOf(placeholder.pid),
    markers: PENDING_MARKERS,
    nonce: TEST_NONCE,
  };
  writeJsonPrivate(path.join(recDir, 'recorder.json'), recorderJson);
  await setActiveSession({ sessionId: id, dir, harId: null, targetId: 'target-abc', stepCount: 0 });
  await setActiveRecId(recId);

  const fakeServer = await startFakeRecorderServer(socketPath);
  const out = captureStdout();
  try {
    await sessionMain({ command: 'session', positional: ['stop', id], json: false } as ParsedArgs, []);
  } finally {
    out.restore();
    fakeServer.close();
    placeholder.kill();
  }

  try {
    const bundlePath = path.join(dir, 'bundle.json');
    assert.ok(fs.existsSync(bundlePath), 'bundle.json must be written');
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));

    assert.equal(bundle.recs.length, 1);
    assert.equal(bundle.recs[0].id, recId);
    assert.equal(bundle.recs[0].state, 'finalized');
    assert.equal(bundle.recs[0].frames, 4);

    // The recorder was torn down (recorder.json gone, activeRecId cleared)
    // by the SAME `session stop` call, before the bundle was written.
    assert.equal(fs.existsSync(path.join(recDir, 'recorder.json')), false);
    assert.equal(getActiveRecId(), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// U11b deterministic race proof: a start that WINS admission against a
// concurrent `session stop` holds its operation token until the recorder
// handle is atomically published, so the stop's token-drain barrier
// deterministically waits for it — and the stop's own teardown then finalizes
// the just-published recorder BEFORE the bundle commits. Two windows, both
// proved: (1) while the admitted start is paused mid-spawn, the stop has
// marked `.operations.json` stopping but CANNOT proceed; (2) once the start
// publishes and releases, the stop drains, tears the recorder down, and the
// finalized bundle contains no live recorder.
// ---------------------------------------------------------------------------

test('U11b: an admitted start racing a concurrent session stop never leaves a live recorder in the finalized bundle', async () => {
  const id = freshSessionId('race');
  const dir = sessionDirFor(id);
  ensurePrivateDir(dir);
  writeSessionFixture(id, dir);

  const placeholder = spawnPlaceholderChild();
  let fakeServer: Awaited<ReturnType<typeof startFakeRecorderServer>> | null = null;

  // The start path reads harId/targetId from the active-session pointer under
  // its lifecycle lock, and setActiveSession also rewrites .session.json with
  // this same state — which the stop path then reads to collect har.json — so
  // the harId must name a REAL live HAR store, exactly as `session start`
  // would have created.
  const { id: harId } = await createHarRecording(dir);
  await setActiveSession({ sessionId: id, dir, harId, targetId: 'target-abc', stepCount: 0 });

  // Window 1: the start wins admission, then pauses INSIDE its spawn seam —
  // its operation token held, no recorder handle published yet.
  let releaseSpawn!: () => void;
  const spawnGate = new Promise<void>((r) => { releaseSpawn = r; });
  let spawnEntered!: () => void;
  const spawnEnteredGate = new Promise<void>((r) => { spawnEntered = r; });

  const startPromise = startComposedRecorder({ sessionDir: dir }, {
    detectPort: async () => 9222,
    spawnRecorderBridge: async (socketPath, _port, _targetId, recDir) => {
      spawnEntered();
      await spawnGate;
      writeJsonPrivate(path.join(recDir, RECORDER_NONCE_BOOT_FILE), { nonce: TEST_NONCE });
      fakeServer = await startFakeRecorderServer(socketPath);
      return { socketPath, pid: placeholder.pid };
    },
  });

  const out = captureStdout();
  try {
    await spawnEnteredGate;

    // Window 2: the REAL session-stop path (`session stop <id>` through
    // sessionMain — the admission barrier lives in session/commands.ts's
    // beginSessionStop call) starts concurrently.
    let stopResolved = false;
    const stopPromise = sessionMain(
      { command: 'session', positional: ['stop', id], json: false } as ParsedArgs,
      [],
    ).then(() => { stopResolved = true; });

    // While the admitted start is paused: the stop has marked
    // `.operations.json` stopping=true (rejecting any LATER admissions)…
    const opsPath = path.join(dir, '.operations.json');
    const deadline = Date.now() + 3000;
    for (;;) {
      const ops = fs.existsSync(opsPath)
        ? (JSON.parse(fs.readFileSync(opsPath, 'utf-8')) as { stopping?: unknown })
        : null;
      if (ops?.stopping === true) break;
      if (Date.now() > deadline) throw new Error('timed out waiting for .operations.json stopping=true');
      await new Promise((r) => setTimeout(r, 20));
    }
    // …but deterministically CANNOT proceed past its token-drain barrier while
    // the admitted start still holds its token.
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(stopResolved, false, 'session stop must stay pending on its token-drain barrier while the admitted start holds its token');

    // Unblock the spawn: the start completes, atomically publishes its
    // recorder handle, and releases its token; the stop then drains, tears the
    // recorder down, and commits the bundle.
    releaseSpawn();
    const startResult = await startPromise;
    assert.equal(startResult.state, 'recording');
    await stopPromise;
    assert.equal(stopResolved, true);

    // The finalized bundle contains NO live recorder: the handle the admitted
    // start published was gracefully stopped and finalized by the stop's own
    // teardown, before the bundle committed.
    const bundlePath = path.join(dir, 'bundle.json');
    assert.ok(fs.existsSync(bundlePath), `bundle.json must be committed by the stop — stop output: ${out.logs.join(' | ')}`);
    const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf-8')) as {
      recs: Array<{ id: string; state: string }>;
    };
    assert.equal(bundle.recs.length, 1, 'the raced start\'s recording must appear in the bundle');
    assert.equal(bundle.recs[0].id, startResult.recId);
    assert.equal(bundle.recs[0].state, 'finalized', 'the recording must be finalized, never live, in the committed bundle');

    const recDir = recDirFor(dir, startResult.recId);
    assert.equal(fs.existsSync(path.join(recDir, 'recorder.json')), false, 'no live-recorder handle may survive into the finalized session');
    assert.ok(fs.existsSync(path.join(recDir, 'meta.json')), 'the recording must be finalized on disk');
    assert.equal(getActiveRecId(), null, 'no active-recording pointer may survive the stop');
  } finally {
    out.restore();
    fakeServer?.close();
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// U11c: a terminal (authenticated `ok:false`) rec-stop during `session stop`
// must escape the warn-and-continue teardown catch and reach the outer
// `stop_failed` lane -- no bundle commit, live HAR/handle intact, `stopping`
// reset, admission released. This is the session-level counterpart to
// `test/motion-rec-lifecycle.test.ts`'s `stopComposedRecorder`-level proof.
// ---------------------------------------------------------------------------

test('U11c: a terminal (authenticated ok:false) rec-stop during session stop reaches the outer stop_failed lane -- no bundle commit, live HAR/handle intact, stopping reset, admission released', async () => {
  const id = freshSessionId('terminal-fail');
  const dir = sessionDirFor(id);
  ensurePrivateDir(dir);
  writeSessionFixture(id, dir);

  const recId = 'rec-terminal-fail';
  const recDir = recDirFor(dir, recId);
  ensurePrivateDir(recDir);
  const socketPath = recorderSocketPath(recDir);
  const placeholder = spawnPlaceholderChild();
  const { id: harId } = await createHarRecording(dir);

  const recorderJson: RecorderJson = {
    recId, pid: placeholder.pid, socketPath, targetId: 'target-abc', url: 'https://example.com',
    startedAt: new Date().toISOString(), state: 'recording', birth: birthOf(placeholder.pid),
    markers: PENDING_MARKERS, nonce: TEST_NONCE,
  };
  writeJsonPrivate(path.join(recDir, 'recorder.json'), recorderJson);
  await setActiveSession({ sessionId: id, dir, harId, targetId: 'target-abc', stepCount: 0 });
  await setActiveRecId(recId);

  const fakeServer = await startFakeRecorderServer(socketPath, {
    'rec-stop': (req) => {
      placeholder.kill();
      return { reqId: req.reqId, ok: false, type: 'rec-stop', error: 'Malformed owned Network event: timestamp' };
    },
  });
  const out = captureStdout();
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await sessionMain({ command: 'session', positional: ['stop', id], json: false } as ParsedArgs, []);
    assert.equal(process.exitCode, 1, `a terminal rec-stop failure must fail the whole session stop (exit code 1) -- stop output: ${out.logs.join(' | ')}`);
  } finally {
    process.exitCode = originalExitCode;
    out.restore();
    fakeServer.close();
    placeholder.kill();
  }

  try {
    assert.equal(fs.existsSync(path.join(dir, 'bundle.json')), false, 'no bundle may be committed when the recorder teardown fails terminally');
    assert.equal(fs.existsSync(path.join(recDir, 'recorder.json')), true, 'the live recorder handle must survive -- never deleted as finalized');
    assert.equal(fs.existsSync(path.join(recDir, 'meta.json')), false, 'no finalized meta.json may be written on a terminal failure');

    const harAfter = await readHarRecording(harId);
    assert.ok(harAfter, 'the live HAR recording must survive -- never deleted on a terminal teardown failure');

    const sessionRaw = JSON.parse(fs.readFileSync(path.join(dir, '.session.json'), 'utf-8')) as { stopping?: unknown; stoppedAt?: unknown };
    assert.equal(sessionRaw.stopping, false, 'stopping must reset back to false after the failed stop');
    assert.equal(sessionRaw.stoppedAt, undefined, 'a failed stop must never mark the session stopped');

    const opsRaw = JSON.parse(fs.readFileSync(path.join(dir, '.operations.json'), 'utf-8')) as { stopping?: unknown };
    assert.equal(opsRaw.stopping, false, 'admission must release (committed === false) after a failed stop, so a later operation can be admitted again');

    assert.equal(getActiveRecId(), recId, 'the active-recording pointer must survive -- never cleared on a terminal teardown failure');
  } finally {
    await deleteHarRecording(harId).catch(() => {});
    clearActiveSession();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// U11c: session-bundle-ordering proof against a REAL recorder bridge (the
// fake NDJSON server above cannot own a real HARRecorder, so it cannot prove
// append-settlement ordering). Boots `runRecorderBridge` in-process (same
// pattern as `test/recorder-har-integration.test.ts`'s `bootBridge`), wires a
// real session dir + real `recorder.json` handle at it, gates a body fetch so
// a pre-cut append is still pending, and proves `session stop` cannot resolve
// -- and therefore cannot read/commit the bundle -- until that gated append
// settles.
// ---------------------------------------------------------------------------

/** Minimal `RecorderCdpClient` stub for a REAL in-process `runRecorderBridge`
 * -- trimmed to exactly what one gated Network lifecycle over one rec-start/
 * rec-stop round trip needs. Mirrors `recorder-har-integration.test.ts`'s
 * `StubCdpClient`, duplicated here (test-only) rather than imported, since
 * that file does not export it. */
class GatedStubCdpClient extends EventEmitter implements RecorderCdpClient {
  private perfNow = 100;
  private nextIsolatedWorldContextId = 1000;
  /** When set, `Network.getResponseBody` awaits this before resolving -- a
   * deterministic barrier for proving the session-stop path blocks through a
   * pending body fetch/append, with no wall-clock race. */
  bodyGate: Promise<void> | null = null;

  async waitReady(): Promise<void> {
    // The real client resolves once its websocket is open; the stub is born ready.
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
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
        if (expression.includes('MutationObserver')) return { result: { value: OBSERVER_INSTALLED_SENTINEL } };
        if (expression.includes('performanceNowMs: performance.now()')) {
          this.perfNow += 1;
          return { result: { value: { performanceNowMs: this.perfNow, wallClockMs: 1_700_000_000_000 + this.perfNow } } };
        }
        if (expression === 'performance.now()') {
          this.perfNow += 1;
          return { result: { value: this.perfNow } };
        }
        if (expression.includes('querySelectorAll')) return { result: { value: [] } };
        return { result: {} };
      }
      case 'Tracing.end':
        this.emit('Tracing.tracingComplete', {});
        return {};
      default:
        return {};
    }
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
}

/** One request per connection over the real unix control socket -- the exact
 * wire shape production `recorder-client.ts` speaks. Duplicated locally (this
 * file has no such helper; `recorder-har-integration.test.ts` does not export
 * its own copy). */
function sendOverRealBridgeSocket(socketPath: string, req: Record<string, unknown>): Promise<Record<string, unknown>> {
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

function readRealBridgeBootNonce(recDir: string): string {
  const raw = JSON.parse(fs.readFileSync(path.join(recDir, RECORDER_NONCE_BOOT_FILE), 'utf-8')) as { nonce?: unknown };
  assert.equal(typeof raw.nonce, 'string');
  return raw.nonce as string;
}

/** Fires one complete request/response/finished Network lifecycle -- exactly
 * what the held connection would deliver from a live tab. */
function fireGatedNetworkLifecycle(stub: GatedStubCdpClient, requestId: string, url: string): void {
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

test('U11c: session stop blocks the whole bundle commit through a deferred pre-cut append settling on the REAL recorder bridge -- bundle.json/har.json are never read while an admitted append is still pending', async () => {
  const id = freshSessionId('bundle-order-real-bridge');
  const dir = sessionDirFor(id);
  ensurePrivateDir(dir);
  writeSessionFixture(id, dir);

  const recId = 'rec-bundle-order1';
  const recDir = recDirFor(dir, recId);
  ensurePrivateDir(recDir);
  const socketPath = recorderSocketPath(recDir);

  const { id: harId } = await createHarRecording(dir);
  await setActiveSession({ sessionId: id, dir, harId, targetId: 'target-abc', stepCount: 0 });

  // A real, live, harmless process stands in for the bridge's OS pid (the
  // identity the teardown path's liveness/exit checks operate on) -- the
  // NDJSON socket itself is served by the REAL `runRecorderBridge`, IN this
  // test process, via the injected CDP-client/exit seams below (decoupling
  // "the pid recorded" from "who answers the socket", same as
  // `recorder-har-integration.test.ts`'s bridge tests).
  const placeholder = spawnPlaceholderChild();
  const stub = new GatedStubCdpClient();
  const restoreDeps = __setRecorderBridgeDepsForTest({
    createClient: () => stub as unknown as CDPClient,
    findTab: (async () => ({
      port: 9222,
      tab: { id: 'target-abc', webSocketDebuggerUrl: 'ws://stub' },
    })) as unknown as typeof findTabByIdAcrossEndpoints,
    // The real bridge process would exit at this point; here it kills the
    // placeholder pid instead, so `waitForRecorderExit`'s identity-verified
    // poll observes a genuine process death at the same logical moment,
    // rather than idling out to its multi-second escalation timeout.
    exit: () => { placeholder.kill(); },
  });

  try {
    await runRecorderBridge({ socketPath, targetId: 'target-abc', recDir, harId, port: 9222 });

    const nonce = readRealBridgeBootNonce(recDir);
    const started = await sendOverRealBridgeSocket(socketPath, { reqId: 1, type: 'rec-start', nonce });
    assert.equal(started.ok, true, 'the real bridge must accept the authenticated rec-start');

    const recorderJson: RecorderJson = {
      recId, pid: placeholder.pid, socketPath, targetId: 'target-abc', url: 'https://example.com',
      startedAt: new Date().toISOString(), state: 'recording', birth: birthOf(placeholder.pid),
      markers: PENDING_MARKERS, nonce,
    };
    writeJsonPrivate(path.join(recDir, 'recorder.json'), recorderJson);
    await setActiveRecId(recId);

    let releaseGate!: () => void;
    stub.bodyGate = new Promise((resolve) => { releaseGate = resolve; });

    // Pre-cut lifecycle whose body fetch is deliberately held open -- an
    // admitted append that must still be pending when `session stop` fires.
    fireGatedNetworkLifecycle(stub, 'gated', 'https://example.com/gated');

    const out = captureStdout();
    let stopResolved = false;
    const stopPromise = sessionMain({ command: 'session', positional: ['stop', id], json: false } as ParsedArgs, [])
      .then(() => { stopResolved = true; });

    // The stop command has ample time to reach the real bridge's rec-stop
    // handler, trip the synchronous admission cut, and start draining -- but
    // it must not resolve (and therefore must not have read/committed the
    // bundle) while the gate is closed.
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(stopResolved, false, 'session stop must not resolve while a pre-cut admitted append is still pending on the real bridge');
    assert.equal(fs.existsSync(path.join(dir, 'bundle.json')), false, 'bundle.json must not exist while the gated append is still pending');

    releaseGate();
    await stopPromise;
    out.restore();
    assert.equal(stopResolved, true);

    assert.ok(fs.existsSync(path.join(dir, 'bundle.json')), 'bundle.json must be written once the gated append settles and the stop resolves');
    const bundle = JSON.parse(fs.readFileSync(path.join(dir, 'bundle.json'), 'utf-8')) as { har: { entryCount: number } | null };
    assert.equal(bundle.har?.entryCount, 1);

    const harOnDisk = JSON.parse(fs.readFileSync(path.join(dir, 'har.json'), 'utf-8')) as { log: { entries: Array<{ request: { url: string }; response: { content: { text?: string } } }> } };
    assert.equal(harOnDisk.log.entries.length, 1);
    assert.equal(harOnDisk.log.entries[0].request.url, 'https://example.com/gated');
    assert.equal(harOnDisk.log.entries[0].response.content.text, 'stub-response-body', 'the gated body must settle with its real content before the bundle read, not fetch_failed');
  } finally {
    restoreDeps();
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(dir, { recursive: true, force: true });
    await deleteHarRecording(harId).catch(() => {});
  }
});
