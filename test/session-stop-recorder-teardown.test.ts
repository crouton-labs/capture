import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { spawn } from 'node:child_process';

import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate } from '../src/session/artifacts.js';
import { listenNdjsonSocket, closeNdjsonSocket } from '../src/cdp/bridge/server.js';
import { recorderSocketPath } from '../src/cdp/bridge/spawn.js';
import { setActiveSession, setActiveRecId, getActiveRecId, getActiveSession, clearActiveSession } from '../src/session-context.js';
import {
  recDirFor,
  teardownAnyLiveRecorderAtSessionStop,
  isPidAlive,
  type RecorderJson,
} from '../src/cdp/motion/recorder.js';
import { sessionMain } from '../src/session/commands.js';
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
    markers: PENDING_MARKERS,
  };
  writeJsonPrivate(path.join(recDir, 'recorder.json'), recorderJson);
  await setActiveSession({ sessionId: id, dir, harId: null, targetId: 'target-abc', stepCount: 0 });
  await setActiveRecId(recId);

  const fakeServer = await startFakeRecorderServer(socketPath);
  try {
    const result = await teardownAnyLiveRecorderAtSessionStop(dir);

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
    markers: PENDING_MARKERS,
  };
  writeJsonPrivate(path.join(recDir, 'recorder.json'), recorderJson);
  await setActiveSession({ sessionId: id, dir, harId: null, targetId: 'target-abc', stepCount: 0 });
  await setActiveRecId(recId);

  try {
    const result = await teardownAnyLiveRecorderAtSessionStop(dir);

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
  // isPidAlive() but its socket round trip (rec-stop) fails (e.g. the bridge
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
  // (isPidAlive() sees it) but nothing is listening on its NDJSON socket, so
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
    markers: PENDING_MARKERS,
  };
  writeJsonPrivate(path.join(recDir, 'recorder.json'), recorderJson);
  await setActiveSession({ sessionId: id, dir, harId: null, targetId: 'target-abc', stepCount: 0 });
  await setActiveRecId(recId);

  try {
    assert.ok(isPidAlive(placeholder.pid), 'placeholder pid must be alive before teardown');

    const result = await teardownAnyLiveRecorderAtSessionStop(dir);

    assert.ok(result);
    assert.equal(result!.state, 'orphaned-finalized');
    assert.equal(fs.existsSync(path.join(recDir, 'recorder.json')), false, 'recorder.json must be removed');
    assert.ok(fs.existsSync(path.join(recDir, 'meta.json')), 'meta.json must be written');
    assert.equal(getActiveRecId(), null);

    // The regression itself: the known-live-but-unresponsive pid must
    // actually be SIGTERM'd, not merely finalized on disk while the process
    // leaks on as a zombie recorder. SIGTERM delivery/exit is async, so poll.
    const deadline = Date.now() + 3000;
    while (isPidAlive(placeholder.pid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(isPidAlive(placeholder.pid), false, 'the known-live pid must be killed, not leaked as a zombie recorder process');
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
    const result = await teardownAnyLiveRecorderAtSessionStop(dir);
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
    markers: PENDING_MARKERS,
  };
  writeJsonPrivate(path.join(recDir, 'recorder.json'), recorderJson);
  // Deliberately NO setActiveSession/setActiveRecId -- there is no active
  // pointer naming this recorder at all (this caller scope has no active
  // session pointer). Teardown must still discover and finalize it by
  // scanning the session directory.
  clearActiveSession();

  const fakeServer = await startFakeRecorderServer(socketPath);
  try {
    const result = await teardownAnyLiveRecorderAtSessionStop(dir);

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
    markers: PENDING_MARKERS,
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
    const result = await teardownAnyLiveRecorderAtSessionStop(dirA);

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
    markers: PENDING_MARKERS,
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
