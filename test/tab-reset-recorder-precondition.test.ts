import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { spawn } from 'node:child_process';

import {
  CAPTURE_ROOT,
  ensurePrivateDir,
  writeJsonPrivate,
  acquirePrivateLock,
  processPidBirthProvider,
  type PidBirth,
  type PidBirthProvider,
} from '../src/session/artifacts.js';
import { listenNdjsonSocket, closeNdjsonSocket } from '../src/cdp/bridge/server.js';
import { recorderSocketPath } from '../src/cdp/bridge/spawn.js';
import {
  setActiveSession,
  setActiveRecId,
  getActiveRecId,
  getActiveSession,
  clearActiveSession,
} from '../src/session-context.js';
import {
  startComposedRecorder,
  recDirFor,
  readRecorderJson,
} from '../src/cdp/motion/recorder.js';
import { cmdTabReset, __setTabResetDepsForTest } from '../src/cdp/commands/tab/reset.js';
import { RECORDER_NONCE_BOOT_FILE } from '../src/cdp/recorder-bridge.js';
import { CaptureError } from '../src/errors.js';
import { type CDPTarget, type ParsedArgs } from '../src/cdp/types.js';
import { type RecorderRequest, type RecorderResponse, type RecorderClockBaselines } from '../src/cdp/bridge/protocol.js';

// Isolates this file's active-session pointer from any other concurrent
// `capture` usage on the machine (session-context.ts scopes its pointer file
// by CRTR_NODE_ID).
process.env.CRTR_NODE_ID = `u09-reset-precond-${process.pid}-${Date.now()}`;

function freshSessionDir(label: string): string {
  const dir = path.join(
    CAPTURE_ROOT,
    `u09-reset-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  ensurePrivateDir(dir);
  return dir;
}

/** A structurally valid 64-hex recorder control nonce shared by every fixture
 * in this file — parseRecorderHandle requires it on every recorder.json (a
 * handle without one classifies malformed), and the fake spawn seams hand it
 * to the starter via the recorder-nonce.json boot file exactly the way the
 * real bridge does. Mirrors test/motion-rec-lifecycle.test.ts. */
const TEST_NONCE = 'ab'.repeat(32);

/** The M5 refusal proofs assert the specific `recorder_active` code — a loose
 * /active|recorder/i regex also matches the malformed-handle lane
 * (`recorder_unavailable`), which would make the live-recorder proofs vacuous. */
function recorderActiveRefusal(err: unknown): boolean {
  return err instanceof CaptureError
    && err.descriptor.kind === 'precondition'
    && err.descriptor.code === 'recorder_active';
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
      return { reqId: req.reqId, ok: true, type: 'rec-stop', frameCount: 0, eventCount: 0, durationMs: 0, markers: PENDING_MARKERS };
    case 'cdp':
      return { reqId: req.reqId, ok: true, type: 'cdp', result: {} };
  }
}

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

function spawnPlaceholderChild(): { pid: number; kill: () => void } {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  const pid = child.pid!;
  return { pid, kill: () => { try { child.kill(); } catch { /* already dead */ } } };
}

function birthOf(pid: number): PidBirth {
  const r = processPidBirthProvider.read(pid);
  if (r.status !== 'found') throw new Error('no birth for pid ' + pid);
  return r.identity;
}

function pidLive(pid: number): boolean {
  return processPidBirthProvider.read(pid).status === 'found';
}

function mutateBirth(b: PidBirth): PidBirth {
  return b.provider === 'linux-proc-v1'
    ? { ...b, startTicks: String(BigInt(b.startTicks) + 1n) }
    : { ...b, startSec: String(BigInt(b.startSec) + 1n) };
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** A createClient() stand-in whose Page.loadEventFired fires immediately, so
 * reset's bounded load wait resolves at once without a real browser. */
function makeFakeClient() {
  return {
    waitReady: async () => {},
    send: async () => ({}),
    on: (event: string, cb: () => void) => { if (event === 'Page.loadEventFired') setImmediate(cb); },
    close: () => {},
  } as never;
}

/** Runs cmdTabReset with console output suppressed (it emits a rendered block). */
async function runReset(parsed: Partial<ParsedArgs> & { command: string; positional: string[] }): Promise<void> {
  const orig = console.log;
  console.log = () => {};
  try {
    return await cmdTabReset(parsed as ParsedArgs, []);
  } finally {
    console.log = orig;
  }
}

function fakeTarget(id: string, url: string): CDPTarget {
  return { id, url, title: '', type: 'page', webSocketDebuggerUrl: 'ws://' + id };
}

function writeLiveRecorderJson(recDir: string, recId: string, pid: number, birth: PidBirth): void {
  ensurePrivateDir(recDir);
  writeJsonPrivate(path.join(recDir, 'recorder.json'), {
    recId,
    pid,
    socketPath: recorderSocketPath(recDir),
    targetId: 'target-abc',
    url: null,
    startedAt: new Date().toISOString(),
    state: 'recording',
    birth,
    markers: PENDING_MARKERS,
    nonce: TEST_NONCE,
  });
}

// ---------------------------------------------------------------------------
// Proofs 1-2: a live recorder is bound to the old target, so reset REFUSES
// (directory-scan authoritative, not the activeRecId pointer) and never opens
// a fresh tab or repoints the session.
// ---------------------------------------------------------------------------

test('proof 1: reset refuses while a live recorder + activeRecId are present, opening no tab and leaving .session.json unchanged', async () => {
  const sessionDir = freshSessionDir('live-active');
  const url = 'https://reset.example/new';
  await setActiveSession({ sessionId: 's-live-active', dir: sessionDir, harId: null, targetId: 'target-abc', port: 9222, stepCount: 0 });
  const recId = 'rec-live-1';
  // Every line after the spawn lives inside the try, so no fixture failure
  // can leak a live placeholder child (which would hang the runner forever
  // under --test-timeout=0).
  const placeholder = spawnPlaceholderChild();
  let restore: (() => void) | null = null;
  try {
    writeLiveRecorderJson(recDirFor(sessionDir, recId), recId, placeholder.pid, birthOf(placeholder.pid));
    await setActiveRecId(recId);
    const before = fs.readFileSync(path.join(sessionDir, '.session.json'));
    const spy = { calls: 0 };
    restore = __setTabResetDepsForTest({
      detectCdpPort: async () => 9222,
      openTab: async () => { spy.calls++; return fakeTarget('target-new', url); },
      createClient: () => makeFakeClient(),
      lifecycle: {},
    });
    await assert.rejects(() => runReset({ command: 'tab', positional: [url] }), recorderActiveRefusal);
    assert.equal(spy.calls, 0, 'reset must not open a fresh tab while a recorder is live');
    assert.ok(before.equals(fs.readFileSync(path.join(sessionDir, '.session.json'))), '.session.json must be byte-identical');
  } finally {
    restore?.();
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('proof 2: reset refuses on a live recorder even with activeRecId UNSET (directory scan is authoritative)', async () => {
  const sessionDir = freshSessionDir('live-no-pointer');
  const url = 'https://reset.example/new';
  await setActiveSession({ sessionId: 's-live-no-pointer', dir: sessionDir, harId: null, targetId: 'target-abc', port: 9222, stepCount: 0 });
  const recId = 'rec-live-2';
  const placeholder = spawnPlaceholderChild();
  let restore: (() => void) | null = null;
  try {
    writeLiveRecorderJson(recDirFor(sessionDir, recId), recId, placeholder.pid, birthOf(placeholder.pid));
    // Deliberately NO setActiveRecId -- the pointer is unset even though a live
    // recorder.json exists on disk.
    assert.equal(getActiveRecId(), null);
    const spy = { calls: 0 };
    restore = __setTabResetDepsForTest({
      detectCdpPort: async () => 9222,
      openTab: async () => { spy.calls++; return fakeTarget('target-new', url); },
      createClient: () => makeFakeClient(),
      lifecycle: {},
    });
    await assert.rejects(() => runReset({ command: 'tab', positional: [url] }), recorderActiveRefusal);
    assert.equal(spy.calls, 0);
  } finally {
    restore?.();
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Proof 3: a DEAD recorder handle (absent pid, or a live foreign pid whose
// birth no longer matches) is PRESERVED -- reset proceeds and repoints the
// session, but leaves the dead handle intact (recorder.json + frames survive)
// so the next stop/start orphan-finalizes it, and reset NEVER signals the
// foreign pid.
// ---------------------------------------------------------------------------

test('proof 3a: reset preserves an absent-pid dead handle and repoints the session', async () => {
  const sessionDir = freshSessionDir('dead-absent');
  const url = 'https://reset.example/new';
  await setActiveSession({ sessionId: 's-dead-absent', dir: sessionDir, harId: null, targetId: 'target-abc', port: 9222, stepCount: 0 });
  const recId = 'rec-dead-absent';
  const recDir = recDirFor(sessionDir, recId);
  const deadPid = await spawnAndWaitDead();
  writeLiveRecorderJson(recDir, recId, deadPid, birthOf(process.pid));
  const restore = __setTabResetDepsForTest({
    detectCdpPort: async () => 9222,
    openTab: async () => fakeTarget('target-new', url),
    createClient: () => makeFakeClient(),
    lifecycle: {},
  });
  try {
    await runReset({ command: 'tab', positional: [url] });
    assert.equal(fs.existsSync(path.join(recDir, 'recorder.json')), true, 'the dead handle must be preserved for the next stop/start to finalize');
    assert.equal(getActiveSession()!.targetId, 'target-new');
  } finally {
    restore();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('proof 3b: reset preserves a live-foreign-pid dead handle (mismatched birth) without signaling that pid', async () => {
  const sessionDir = freshSessionDir('dead-foreign');
  const url = 'https://reset.example/new';
  await setActiveSession({ sessionId: 's-dead-foreign', dir: sessionDir, harId: null, targetId: 'target-abc', port: 9222, stepCount: 0 });
  const recId = 'rec-dead-foreign';
  const recDir = recDirFor(sessionDir, recId);
  const foreign = spawnPlaceholderChild();
  let restore: (() => void) | null = null;
  try {
    // A wrong birth (this process's, not the foreign pid's) makes the still-live
    // foreign pid classify DEAD -- reset must preserve the handle and never signal it.
    writeLiveRecorderJson(recDir, recId, foreign.pid, birthOf(process.pid));
    restore = __setTabResetDepsForTest({
      detectCdpPort: async () => 9222,
      openTab: async () => fakeTarget('target-new', url),
      createClient: () => makeFakeClient(),
      lifecycle: {},
    });
    await runReset({ command: 'tab', positional: [url] });
    assert.equal(fs.existsSync(path.join(recDir, 'recorder.json')), true, 'the dead handle must be preserved, not removed');
    assert.equal(getActiveSession()!.targetId, 'target-new');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(pidLive(foreign.pid), true, 'the live foreign pid must never be signaled by reset');
  } finally {
    restore?.();
    foreign.kill();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Proof 4: a dangling activeRecId (pointer set, no on-disk handle) is
// compare-cleared, and reset proceeds.
// ---------------------------------------------------------------------------

test('proof 4: reset clears a dangling activeRecId with no on-disk handle and proceeds', async () => {
  const sessionDir = freshSessionDir('dangling-pointer');
  const url = 'https://reset.example/new';
  await setActiveSession({ sessionId: 's-dangling', dir: sessionDir, harId: null, targetId: 'target-abc', port: 9222, stepCount: 0 });
  await setActiveRecId('rec-ghost'); // no recorder.json dir for it
  const restore = __setTabResetDepsForTest({
    detectCdpPort: async () => 9222,
    openTab: async () => fakeTarget('target-new', url),
    createClient: () => makeFakeClient(),
    lifecycle: {},
  });
  try {
    await runReset({ command: 'tab', positional: [url] });
    assert.equal(getActiveRecId(), null, 'the dangling pointer must be compare-cleared');
    assert.equal(getActiveSession()!.targetId, 'target-new');
  } finally {
    restore();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Proof 5: an accepted reset publishes {targetId, port} together atomically.
// ---------------------------------------------------------------------------

test('proof 5: an accepted reset publishes the {targetId, port} pair together', async () => {
  const sessionDir = freshSessionDir('atomic-publish');
  const url = 'https://reset.example/new';
  await setActiveSession({ sessionId: 's-atomic', dir: sessionDir, harId: null, targetId: 'target-old', port: 9222, stepCount: 0 });
  const restore = __setTabResetDepsForTest({
    detectCdpPort: async () => 9222,
    openTab: async () => fakeTarget('target-new', url),
    createClient: () => makeFakeClient(),
    lifecycle: {},
  });
  try {
    await runReset({ command: 'tab', positional: [url] });
    const active = getActiveSession()!;
    assert.equal(active.targetId, 'target-new');
    assert.equal(active.port, 9222);
  } finally {
    restore();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Proof 6: a concurrent recorder-start and reset serialize under the session's
// .lifecycle.lock -- the loser observes the winner's committed state, never a
// torn endpoint-B-with-recorder-bound-A outcome.
// ---------------------------------------------------------------------------

test('proof 6a: reset-wins -- a recorder start launched while reset holds the lock binds reset\'s committed target', async () => {
  const sessionDir = freshSessionDir('race-reset-wins');
  const url = 'https://reset.example/new';
  await setActiveSession({ sessionId: 's-race-reset', dir: sessionDir, harId: 'har-test-6a', targetId: 'target-old', port: 9222, stepCount: 0 });
  const insideReset = deferred();
  const release = deferred();
  const restore = __setTabResetDepsForTest({
    detectCdpPort: async () => 9222,
    openTab: async () => { insideReset.resolve(); await release.promise; return fakeTarget('target-new', url); },
    createClient: () => makeFakeClient(),
    lifecycle: {},
  });
  const placeholder = spawnPlaceholderChild();
  let fakeServer: Awaited<ReturnType<typeof startFakeRecorderServer>> | null = null;
  try {
    const resetPromise = runReset({ command: 'tab', positional: [url] });
    // Race against resetPromise: if reset rejects before reaching openTab, the
    // test fails fast instead of hanging forever on a deferred nothing will
    // ever resolve (which would leak the placeholder under --test-timeout=0).
    await Promise.race([insideReset.promise, resetPromise]); // reset now holds .lifecycle.lock
    const startPromise = startComposedRecorder({ sessionDir }, {
      detectPort: async () => 9222,
      spawnRecorderBridge: async (sp, _port, _targetId, recDir) => {
        writeJsonPrivate(path.join(recDir, RECORDER_NONCE_BOOT_FILE), { nonce: TEST_NONCE });
        fakeServer = await startFakeRecorderServer(sp);
        return { socketPath: sp, pid: placeholder.pid };
      },
    });
    startPromise.catch(() => {}); // re-observed at the await below; never unhandled mid-wait
    await new Promise((r) => setTimeout(r, 50)); // start blocks on the lock
    release.resolve();
    await resetPromise;
    const sr = await startPromise;
    assert.equal(getActiveSession()!.targetId, 'target-new');
    assert.equal(readRecorderJson(sr.recDir)!.targetId, 'target-new', 'start observed reset\'s committed target under the lock');
    assert.equal(getActiveRecId(), sr.recId);
  } finally {
    restore();
    fakeServer?.close();
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('proof 6b: start-wins -- a reset launched while a recorder start holds the lock is refused as recorder-active', async () => {
  const sessionDir = freshSessionDir('race-start-wins');
  const url = 'https://reset.example/new';
  await setActiveSession({ sessionId: 's-race-start', dir: sessionDir, harId: 'har-test-6b', targetId: 'target-old', port: 9222, stepCount: 0 });
  const insideStart = deferred();
  const release = deferred();
  const openTabSpy = { calls: 0 };
  const restore = __setTabResetDepsForTest({
    detectCdpPort: async () => 9222,
    openTab: async () => { openTabSpy.calls++; return fakeTarget('target-new', url); },
    createClient: () => makeFakeClient(),
    lifecycle: {},
  });
  const placeholder = spawnPlaceholderChild();
  let fakeServer: Awaited<ReturnType<typeof startFakeRecorderServer>> | null = null;
  try {
    const startPromise = startComposedRecorder({ sessionDir }, {
      detectPort: async () => 9222,
      spawnRecorderBridge: async (sp, _port, _targetId, recDir) => {
        writeJsonPrivate(path.join(recDir, RECORDER_NONCE_BOOT_FILE), { nonce: TEST_NONCE });
        fakeServer = await startFakeRecorderServer(sp);
        insideStart.resolve();
        await release.promise;
        return { socketPath: sp, pid: placeholder.pid };
      },
    });
    // Race against startPromise: if start rejects before its spawn seam runs
    // (e.g. a precondition failure), the test fails fast instead of hanging
    // forever on insideStart under --test-timeout=0 and leaking the placeholder.
    await Promise.race([insideStart.promise, startPromise]); // start now holds .lifecycle.lock
    const resetPromise = runReset({ command: 'tab', positional: [url] });
    resetPromise.catch(() => {}); // its rejection is asserted below; never unhandled mid-wait
    await new Promise((r) => setTimeout(r, 50)); // reset blocks on the lock
    release.resolve();
    const sr = await startPromise;
    await assert.rejects(() => resetPromise, recorderActiveRefusal);
    assert.equal(openTabSpy.calls, 0, 'reset refused before opening a tab');
    assert.equal(getActiveSession()!.targetId, 'target-old');
    assert.equal(readRecorderJson(sr.recDir)!.targetId, 'target-old');
  } finally {
    restore();
    fakeServer?.close();
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Proof 7: reset retires a dead .lifecycle.lock owner (expired lease + a lock
// owner whose birth no longer matches) and proceeds.
// ---------------------------------------------------------------------------

test('proof 7: reset retires a dead .lifecycle.lock owner and proceeds', async () => {
  const sessionDir = freshSessionDir('killed-holder-reset');
  const url = 'https://reset.example/new';
  await setActiveSession({ sessionId: 's-killed-reset', dir: sessionDir, harId: null, targetId: 'target-old', port: 9222, stepCount: 0 });
  const realBirth = birthOf(process.pid);
  const birthB = mutateBirth(realBirth);
  let phase: 'A' | 'B' = 'A';
  let nowNsValue = 0n;
  const provider: PidBirthProvider = { read: (pid) => pid === process.pid ? { status: 'found', identity: phase === 'A' ? realBirth : birthB } : processPidBirthProvider.read(pid) };
  const nowNs = () => nowNsValue;
  const holder = await acquirePrivateLock(path.join(sessionDir, '.lifecycle.lock'), { acquireTimeoutMs: 30_000, leaseMs: 10, pidBirthProvider: provider, nowNs });
  phase = 'B';
  nowNsValue = 20_000_000n;
  const restore = __setTabResetDepsForTest({
    detectCdpPort: async () => 9222,
    openTab: async () => fakeTarget('target-new', url),
    createClient: () => makeFakeClient(),
    lifecycle: { pidBirthProvider: provider, nowNs },
  });
  try {
    await runReset({ command: 'tab', positional: [url] });
    assert.equal(getActiveSession()!.targetId, 'target-new');
  } finally {
    restore();
    try { holder.release(); } catch { /* already retired */ }
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});
