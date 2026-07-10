import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { spawn } from 'node:child_process';

import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate } from '../src/session/artifacts.js';
import { listenNdjsonSocket, closeNdjsonSocket } from '../src/cdp/bridge/server.js';
import { recorderSocketPath } from '../src/cdp/bridge/spawn.js';
import {
  setActiveSession,
  setActiveRecId,
  getActiveRecId,
  clearActiveSession,
} from '../src/session-context.js';
import {
  startComposedRecorder,
  stopComposedRecorder,
  recDirFor,
  readRecorderJson,
  isPidAlive,
  type RecorderJson,
} from '../src/cdp/motion/recorder.js';
import { connectForCommand } from '../src/cdp/connection.js';
import { isRecorderHeldClient } from '../src/cdp/recorder-client.js';
import { type RecorderRequest, type RecorderResponse, type RecorderClockBaselines } from '../src/cdp/bridge/protocol.js';
import { type ParsedArgs } from '../src/cdp/types.js';

// Isolates this file's active-session pointer from any other concurrent
// `capture` usage on the machine (session-context.ts scopes its pointer
// file by CRTR_NODE_ID).
process.env.CRTR_NODE_ID = `u14-lifecycle-test-${process.pid}-${Date.now()}`;

function freshSessionDir(label: string): string {
  const dir = path.join(
    CAPTURE_ROOT,
    `u14-session-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  ensurePrivateDir(dir);
  return dir;
}

function minimalParsedArgs(command: string, overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command, positional: [], ...overrides };
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
        frameCount: 0,
        eventCount: 0,
        durationMs: 0,
        markers: PENDING_MARKERS,
      };
    case 'cdp':
      return { reqId: req.reqId, ok: true, type: 'cdp', result: {} };
  }
}

/** A fake recorder-bridge NDJSON socket server -- answers rec-start/rec-stop/cdp
 * requests with scripted (or default) responses and records every request it received,
 * mirroring the stub-socket pattern in test/recorder-bridge.test.ts's own wire-level test. */
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

/** Spawns a real, trivially-exiting child process and waits for it to exit -- hands back
 * a pid that was real a moment ago but is now guaranteed dead, for the stale/orphan-recorder
 * test paths (far more deterministic than guessing an improbably large pid). */
async function spawnAndWaitDead(): Promise<number> {
  const child = spawn(process.execPath, ['-e', '0']);
  const pid = child.pid!;
  await new Promise<void>((resolve) => child.on('exit', () => resolve()));
  return pid;
}

/** Spawns a real, long-lived, harmless child process to stand in for a live
 * recorder-bridge process's pid -- NEVER the test's own process.pid, because
 * a graceful stop path (stopComposedRecorder/teardownAnyLiveRecorderAtSessionStop)
 * sends a real SIGTERM to the pid it's given via stopBridge(); using the test
 * process's own pid there would kill the test runner itself mid-test. */
function spawnPlaceholderChild(): { pid: number; kill: () => void } {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  const pid = child.pid!;
  return { pid, kill: () => { try { child.kill(); } catch { /* already dead */ } } };
}

test('startComposedRecorder writes recorder.json + frames/, arms activeRecId, returns recDir/state', async () => {
  const sessionDir = freshSessionDir('start');
  setActiveSession({ sessionId: 's-start', dir: sessionDir, harId: null, targetId: 'target-abc', stepCount: 0 });
  const placeholder = spawnPlaceholderChild();

  let fakeServer: Awaited<ReturnType<typeof startFakeRecorderServer>> | null = null;
  try {
    const result = await startComposedRecorder(
      { sessionDir, targetId: 'target-abc' },
      {
        detectPort: async () => 9222,
        spawnRecorderBridge: async (socketPath) => {
          fakeServer = await startFakeRecorderServer(socketPath);
          return { socketPath, pid: placeholder.pid };
        },
      },
    );

    assert.equal(result.state, 'recording');
    assert.equal(result.reapedStale, null);
    assert.ok(result.recId.startsWith('rec-'));
    assert.equal(result.recDir, recDirFor(sessionDir, result.recId));
    assert.ok(fs.statSync(path.join(result.recDir, 'frames')).isDirectory());

    const rj = readRecorderJson(result.recDir);
    assert.ok(rj);
    assert.equal(rj!.state, 'recording');
    assert.equal(rj!.recId, result.recId);
    assert.equal(rj!.targetId, 'target-abc');
    assert.equal(typeof rj!.markers.performanceNowMs, 'number');

    assert.equal(getActiveRecId(), result.recId);
  } finally {
    fakeServer?.close();
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('connectForCommand routes through the active recorder, marking Input.dispatch* calls and leaving others unmarked', async () => {
  const sessionDir = freshSessionDir('routed');
  const recId = 'rec-routed1';
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
  setActiveSession({ sessionId: 's-routed', dir: sessionDir, harId: null, targetId: 'target-abc', stepCount: 0 });
  setActiveRecId(recId);

  const fakeServer = await startFakeRecorderServer(socketPath);
  try {
    const parsed = minimalParsedArgs('click', { positional: ['Send'] });
    const { client, tab } = await connectForCommand(parsed);

    assert.equal(tab.id, 'target-abc');
    assert.ok(isRecorderHeldClient(client));

    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 2 });
    await client.send('DOM.getDocument', {});

    const marked = fakeServer.received.find((r) => r.type === 'cdp' && r.method === 'Input.dispatchMouseEvent');
    assert.ok(marked);
    assert.equal((marked as { mark?: string }).mark, 'click:Send');

    const unmarked = fakeServer.received.find((r) => r.type === 'cdp' && r.method === 'DOM.getDocument');
    assert.ok(unmarked);
    assert.equal((unmarked as { mark?: string }).mark, undefined);
  } finally {
    fakeServer.close();
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('connectForCommand routes a `type` call, marks Input.insertText with the action label, and never leaks the typed text into the mark', async () => {
  const sessionDir = freshSessionDir('routed-type');
  const recId = 'rec-routed-type1';
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
  setActiveSession({ sessionId: 's-routed-type', dir: sessionDir, harId: null, targetId: 'target-abc', stepCount: 0 });
  setActiveRecId(recId);

  const secretText = 'hunter2-super-secret-password';
  const fakeServer = await startFakeRecorderServer(socketPath);
  try {
    // `capture type "<secret>" --into "Password"` -- positional[0] is the
    // raw typed text (never safe to expose), --into names the field.
    const parsed = minimalParsedArgs('type', { positional: [secretText], into: 'Password' });
    const { client } = await connectForCommand(parsed);
    assert.ok(isRecorderHeldClient(client));

    await client.send('Input.insertText', { text: secretText });

    const marked = fakeServer.received.find((r) => r.type === 'cdp' && r.method === 'Input.insertText');
    assert.ok(marked, 'Input.insertText must be routed through the recorder');
    const mark = (marked as { mark?: string }).mark;
    assert.equal(mark, 'type:Password', 'the mark must be the action label (command:field), not the typed text');
    assert.notEqual(mark, secretText, 'the mark must never be the raw typed text');
    assert.ok(!String(mark).includes(secretText), 'the mark must not embed the typed text at all');
  } finally {
    fakeServer.close();
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('connectForCommand derives a safe `type` mark even without --into (never falls back to the typed text)', async () => {
  const sessionDir = freshSessionDir('routed-type-noninto');
  const recId = 'rec-routed-type2';
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
  setActiveSession({ sessionId: 's-routed-type-noninto', dir: sessionDir, harId: null, targetId: 'target-abc', stepCount: 0 });
  setActiveRecId(recId);

  const secretText = 'another-secret-token';
  const fakeServer = await startFakeRecorderServer(socketPath);
  try {
    const parsed = minimalParsedArgs('type', { positional: [secretText] });
    const { client } = await connectForCommand(parsed);

    await client.send('Input.insertText', { text: secretText });

    const marked = fakeServer.received.find((r) => r.type === 'cdp' && r.method === 'Input.insertText');
    assert.ok(marked);
    const mark = (marked as { mark?: string }).mark;
    assert.ok(mark, 'Input.insertText must still be marked without --into');
    assert.notEqual(mark, secretText);
    assert.ok(!String(mark).includes(secretText));
  } finally {
    fakeServer.close();
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('stopComposedRecorder finalizes: writes markers.json/meta.json from the rec-stop response verbatim, removes recorder.json, clears activeRecId', async () => {
  const sessionDir = freshSessionDir('stop');
  const recId = 'rec-stop1';
  const recDir = recDirFor(sessionDir, recId);
  ensurePrivateDir(recDir);
  const socketPath = recorderSocketPath(recDir);
  const placeholder = spawnPlaceholderChild();

  const stopMarkers: RecorderClockBaselines = {
    performanceNowMs: 10,
    wallClockMs: 1_700_000_000_000,
    firstScreencastTimestampSec: 0.42,
    firstTraceEventTsUs: 900,
    baselinesPending: false,
  };

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
  setActiveSession({ sessionId: 's-stop', dir: sessionDir, harId: null, targetId: 'target-abc', stepCount: 0 });
  setActiveRecId(recId);

  const fakeServer = await startFakeRecorderServer(socketPath, {
    'rec-stop': (req) => ({
      reqId: req.reqId,
      ok: true,
      type: 'rec-stop',
      frameCount: 7,
      eventCount: 12,
      durationMs: 3400,
      markers: stopMarkers,
    }),
  });

  try {
    const result = await stopComposedRecorder({ sessionDir, recId });

    assert.equal(result.state, 'finalized');
    assert.equal(result.frames, 7);
    assert.equal(result.durationMs, 3400);
    assert.equal(result.fps, Math.round((7 / (3400 / 1000)) * 10) / 10);

    // Live-file removal: recorder.json is gone once finalized.
    assert.equal(fs.existsSync(path.join(recDir, 'recorder.json')), false);

    const markers = JSON.parse(fs.readFileSync(path.join(recDir, 'markers.json'), 'utf-8'));
    assert.deepEqual(markers, stopMarkers);

    const meta = JSON.parse(fs.readFileSync(path.join(recDir, 'meta.json'), 'utf-8'));
    assert.equal(meta.id, recId);
    assert.equal(meta.frames, 7);
    assert.equal(meta.durationMs, 3400);
    assert.equal(meta.state, 'finalized');
    assert.equal(meta.url, 'https://example.com');

    assert.equal(getActiveRecId(), null);
  } finally {
    fakeServer.close();
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('startComposedRecorder reaps a stale (dead-pid) recorder.json before arming a new one', async () => {
  const sessionDir = freshSessionDir('reap');
  const staleRecId = 'rec-stale1';
  const staleRecDir = recDirFor(sessionDir, staleRecId);
  ensurePrivateDir(staleRecDir);
  ensurePrivateDir(path.join(staleRecDir, 'frames'));

  const deadPid = await spawnAndWaitDead();
  const staleRecorderJson: RecorderJson = {
    recId: staleRecId,
    pid: deadPid,
    socketPath: recorderSocketPath(staleRecDir),
    targetId: 'target-abc',
    url: 'https://stale.example',
    startedAt: new Date(Date.now() - 5000).toISOString(),
    state: 'recording',
    markers: PENDING_MARKERS,
  };
  writeJsonPrivate(path.join(staleRecDir, 'recorder.json'), staleRecorderJson);
  setActiveSession({ sessionId: 's-reap', dir: sessionDir, harId: null, targetId: 'target-abc', stepCount: 0 });
  setActiveRecId(staleRecId);

  let fakeServer: Awaited<ReturnType<typeof startFakeRecorderServer>> | null = null;
  const placeholder = spawnPlaceholderChild();
  try {
    const result = await startComposedRecorder(
      { sessionDir, targetId: 'target-abc' },
      {
        detectPort: async () => 9222,
        spawnRecorderBridge: async (socketPath) => {
          fakeServer = await startFakeRecorderServer(socketPath);
          return { socketPath, pid: placeholder.pid };
        },
      },
    );

    assert.ok(result.reapedStale);
    assert.equal(result.reapedStale!.recId, staleRecId);
    assert.equal(result.reapedStale!.state, 'orphaned-finalized');

    const staleMeta = JSON.parse(fs.readFileSync(path.join(staleRecDir, 'meta.json'), 'utf-8'));
    assert.equal(staleMeta.state, 'orphaned-finalized');
    assert.equal(fs.existsSync(path.join(staleRecDir, 'recorder.json')), false);

    // The new recording still armed cleanly after the reap.
    assert.equal(getActiveRecId(), result.recId);
    assert.notEqual(result.recId, staleRecId);
  } finally {
    fakeServer?.close();
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('stopComposedRecorder best-effort finalizes an orphaned (dead-pid) recording with no live socket', async () => {
  const sessionDir = freshSessionDir('orphan-stop');
  const recId = 'rec-orphan1';
  const recDir = recDirFor(sessionDir, recId);
  ensurePrivateDir(recDir);
  ensurePrivateDir(path.join(recDir, 'frames'));
  // One frame already flushed to disk before the process died.
  fs.writeFileSync(path.join(recDir, 'frames', 'frame-000000.png'), Buffer.from([0]));

  const deadPid = await spawnAndWaitDead();
  const markers: RecorderClockBaselines = {
    performanceNowMs: 1,
    wallClockMs: Date.now() - 2000,
    firstScreencastTimestampSec: 0.1,
    firstTraceEventTsUs: 100,
    baselinesPending: false,
  };
  const recorderJson: RecorderJson = {
    recId,
    pid: deadPid,
    socketPath: recorderSocketPath(recDir),
    targetId: 'target-abc',
    url: 'https://orphan.example',
    startedAt: new Date(Date.now() - 2000).toISOString(),
    state: 'recording',
    markers,
  };
  writeJsonPrivate(path.join(recDir, 'recorder.json'), recorderJson);
  setActiveSession({ sessionId: 's-orphan-stop', dir: sessionDir, harId: null, targetId: 'target-abc', stepCount: 0 });
  setActiveRecId(recId);

  try {
    const result = await stopComposedRecorder({ sessionDir, recId });

    assert.equal(result.state, 'orphaned-finalized');
    assert.equal(result.frames, 1);
    assert.equal(fs.existsSync(path.join(recDir, 'recorder.json')), false);

    const meta = JSON.parse(fs.readFileSync(path.join(recDir, 'meta.json'), 'utf-8'));
    assert.equal(meta.state, 'orphaned-finalized');
    assert.equal(meta.frames, 1);

    assert.equal(getActiveRecId(), null);
  } finally {
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fix 7 — the session url is redacted at the single boundary (`readSessionUrl`)
// where it enters recorder artifacts, so a secret in `.session.json`'s url
// never reaches `recorder.json.url` or (via finalize) `meta.json.url`.
// ---------------------------------------------------------------------------

test('Fix 7: a secret-shaped .session.json url is redacted in recorder.json.url and stays redacted through to meta.json.url', async () => {
  const sessionDir = freshSessionDir('url-redaction');
  const secretUrl = 'https://example.com/?token=github_pat_' + '1'.repeat(40);
  fs.writeFileSync(path.join(sessionDir, '.session.json'), JSON.stringify({ url: secretUrl }));
  setActiveSession({ sessionId: 's-url-redaction', dir: sessionDir, harId: null, targetId: 'target-abc', stepCount: 0 });
  const placeholder = spawnPlaceholderChild();

  let fakeServer: Awaited<ReturnType<typeof startFakeRecorderServer>> | null = null;
  try {
    const result = await startComposedRecorder(
      { sessionDir, targetId: 'target-abc' },
      {
        detectPort: async () => 9222,
        spawnRecorderBridge: async (socketPath) => {
          fakeServer = await startFakeRecorderServer(socketPath);
          return { socketPath, pid: placeholder.pid };
        },
      },
    );

    const rj = readRecorderJson(result.recDir);
    assert.ok(rj);
    assert.ok(rj!.url, 'expected a redacted-but-present url');
    assert.ok(!rj!.url!.includes('github_pat_'), 'the raw secret must never reach recorder.json.url');
    assert.ok(rj!.url!.includes('[REDACTED]'));

    const stopResult = await stopComposedRecorder({ sessionDir, recId: result.recId });
    const metaRaw = fs.readFileSync(path.join(stopResult.recDir, 'meta.json'), 'utf-8');
    assert.ok(!metaRaw.includes('github_pat_'), 'the raw secret must never reach meta.json.url');
    const meta = JSON.parse(metaRaw) as { url: string | null };
    assert.ok(meta.url?.includes('[REDACTED]'));
  } finally {
    fakeServer?.close();
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Finding 1 (SECURITY) -- an explicit --rec-id is validated as a safe path
// basename, and the directory it resolves to is asserted to stay under this
// session's motion/recs root, before it is ever joined into a filesystem
// path -- closing a path-traversal escape via a crafted `--rec-id`.
// ---------------------------------------------------------------------------

test('stopComposedRecorder rejects a path-traversal --rec-id and never touches anything outside motion/recs', async () => {
  const sessionDir = freshSessionDir('rec-id-traversal');

  const badRecIds = ['..', '../../etc/evil', '/etc/passwd', 'good/../../evil', 'a/b', '.hidden'];
  for (const bad of badRecIds) {
    await assert.rejects(
      () => stopComposedRecorder({ sessionDir, recId: bad }),
      /Invalid --rec-id/,
      `expected recId ${JSON.stringify(bad)} to be rejected`,
    );
  }

  // Nothing was ever created under motion/recs for any of these rejected attempts.
  assert.equal(fs.existsSync(path.join(sessionDir, 'motion', 'recs')), false);

  fs.rmSync(sessionDir, { recursive: true, force: true });
});

test('stopComposedRecorder still accepts a normal safe --rec-id (regression: validateRecId does not break the happy path)', async () => {
  const sessionDir = freshSessionDir('rec-id-safe');
  const recId = 'rec-abc1';
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
  setActiveSession({ sessionId: 's-rec-id-safe', dir: sessionDir, harId: null, targetId: 'target-abc', stepCount: 0 });
  setActiveRecId(recId);

  const fakeServer = await startFakeRecorderServer(socketPath);
  try {
    const result = await stopComposedRecorder({ sessionDir, recId });
    assert.equal(result.state, 'finalized');
    assert.equal(result.recId, recId);
  } finally {
    fakeServer.close();
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Finding 2 -- startComposedRecorder's duplicate-recorder race: the
// directory scan (not just the activeRecId pointer) is authoritative, and a
// `.start.lock` closes the check-then-spawn window between two concurrent
// `--start` calls.
// ---------------------------------------------------------------------------

test('startComposedRecorder rejects when a live recorder.json exists on disk but activeRecId is unset (directory scan is authoritative, not just the pointer)', async () => {
  const sessionDir = freshSessionDir('missing-pointer');
  const existingRecId = 'rec-existing1';
  const existingRecDir = recDirFor(sessionDir, existingRecId);
  ensurePrivateDir(existingRecDir);
  ensurePrivateDir(path.join(existingRecDir, 'frames'));
  const placeholder = spawnPlaceholderChild();

  const existingRecorderJson: RecorderJson = {
    recId: existingRecId,
    pid: placeholder.pid,
    socketPath: recorderSocketPath(existingRecDir),
    targetId: 'target-abc',
    url: 'https://example.com',
    startedAt: new Date().toISOString(),
    state: 'recording',
    markers: PENDING_MARKERS,
  };
  writeJsonPrivate(path.join(existingRecDir, 'recorder.json'), existingRecorderJson);
  setActiveSession({ sessionId: 's-missing-pointer', dir: sessionDir, harId: null, targetId: 'target-abc', stepCount: 0 });
  // Deliberately never call setActiveRecId -- the pointer is unset even though a live recorder.json exists on disk.
  assert.equal(getActiveRecId(), null);

  try {
    await assert.rejects(
      () => startComposedRecorder({ sessionDir, targetId: 'target-abc' }),
      /already active/,
    );

    // No second recording was spawned -- only the pre-existing one remains.
    const recsRoot = path.join(sessionDir, 'motion', 'recs');
    const entries = fs.readdirSync(recsRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, existingRecId);
  } finally {
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('two concurrent startComposedRecorder calls against the same session: exactly one succeeds, the other is rejected as already-active', async () => {
  const sessionDir = freshSessionDir('concurrent-start');
  setActiveSession({ sessionId: 's-concurrent-start', dir: sessionDir, harId: null, targetId: 'target-abc', stepCount: 0 });

  const placeholders: Array<{ pid: number; kill: () => void }> = [];
  const fakeServers: Array<Awaited<ReturnType<typeof startFakeRecorderServer>>> = [];

  const makeDeps = () => ({
    detectPort: async () => 9222,
    spawnRecorderBridge: async (socketPath: string) => {
      const placeholder = spawnPlaceholderChild();
      placeholders.push(placeholder);
      const fakeServer = await startFakeRecorderServer(socketPath);
      fakeServers.push(fakeServer);
      return { socketPath, pid: placeholder.pid };
    },
  });

  try {
    const results = await Promise.allSettled([
      startComposedRecorder({ sessionDir, targetId: 'target-abc' }, makeDeps()),
      startComposedRecorder({ sessionDir, targetId: 'target-abc' }, makeDeps()),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'exactly one concurrent start must succeed');
    assert.equal(rejected.length, 1, 'exactly one concurrent start must be rejected');
    assert.match((rejected[0] as PromiseRejectedResult).reason.message, /already active/);

    // Exactly one recorder.json end state exists on disk -- the loser never got as far as spawning.
    const recsRoot = path.join(sessionDir, 'motion', 'recs');
    const entries = fs.readdirSync(recsRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
    assert.equal(entries.length, 1, "only the winner's recDir should exist -- the loser must never have spawned");

    const winner = fulfilled[0] as PromiseFulfilledResult<{ recId: string }>;
    assert.equal(getActiveRecId(), winner.value.recId);

    // No dangling start lock left behind.
    assert.equal(fs.existsSync(path.join(recsRoot, '.start.lock')), false);
  } finally {
    fakeServers.forEach((s) => s.close());
    placeholders.forEach((p) => p.kill());
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('a requestRecStart failure during startComposedRecorder leaves no dangling lock/recorder.json, and a subsequent start succeeds cleanly', async () => {
  const sessionDir = freshSessionDir('start-failure-rollback');
  setActiveSession({ sessionId: 's-start-failure', dir: sessionDir, harId: null, targetId: 'target-abc', stepCount: 0 });

  const failingPlaceholder = spawnPlaceholderChild();
  let failingFakeServer: Awaited<ReturnType<typeof startFakeRecorderServer>> | null = null;
  try {
    await assert.rejects(
      () =>
        startComposedRecorder(
          { sessionDir, targetId: 'target-abc' },
          {
            detectPort: async () => 9222,
            spawnRecorderBridge: async (socketPath) => {
              failingFakeServer = await startFakeRecorderServer(socketPath, {
                'rec-start': (req) => ({ reqId: req.reqId, ok: false, type: 'rec-start', error: 'boom' }),
              });
              return { socketPath, pid: failingPlaceholder.pid };
            },
          },
        ),
      /rec-start failed: boom/,
    );

    // No dangling lock file, no leftover recDir, no activeRecId set.
    const recsRoot = path.join(sessionDir, 'motion', 'recs');
    assert.equal(fs.existsSync(path.join(recsRoot, '.start.lock')), false);
    assert.equal(getActiveRecId(), null);
    const remainingDirs = fs.existsSync(recsRoot)
      ? fs.readdirSync(recsRoot, { withFileTypes: true }).filter((e) => e.isDirectory())
      : [];
    assert.equal(remainingDirs.length, 0, 'the failed recDir must be rolled back');

    // A subsequent start succeeds cleanly.
    const placeholder = spawnPlaceholderChild();
    let fakeServer: Awaited<ReturnType<typeof startFakeRecorderServer>> | null = null;
    try {
      const result = await startComposedRecorder(
        { sessionDir, targetId: 'target-abc' },
        {
          detectPort: async () => 9222,
          spawnRecorderBridge: async (socketPath) => {
            fakeServer = await startFakeRecorderServer(socketPath);
            return { socketPath, pid: placeholder.pid };
          },
        },
      );
      assert.equal(result.state, 'recording');
      assert.equal(getActiveRecId(), result.recId);
    } finally {
      fakeServer?.close();
      placeholder.kill();
    }
  } finally {
    failingFakeServer?.close();
    failingPlaceholder.kill();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Finding 3 -- stopComposedRecorder falls back to a best-effort orphan
// finalize (killing the known-live pid) when the socket round trip itself
// fails, mirroring teardownAnyLiveRecorderAtSessionStop's existing pattern,
// instead of throwing and leaving recorder.json/pid/activeRecId all intact.
// ---------------------------------------------------------------------------

test('stopComposedRecorder falls back to orphan-finalizing (and kills the pid) when a known-live recorder\'s socket round trip fails (wedged/missing bridge)', async () => {
  const sessionDir = freshSessionDir('wedged-stop');
  const recId = 'rec-wedged1';
  const recDir = recDirFor(sessionDir, recId);
  ensurePrivateDir(recDir);
  ensurePrivateDir(path.join(recDir, 'frames'));
  const socketPath = recorderSocketPath(recDir);
  const placeholder = spawnPlaceholderChild();

  // Deliberately never start a socket server at this path -- the pid is
  // alive (isPidAlive() sees it) but nothing is listening on its NDJSON
  // socket, so requestRecStop()'s connection attempt fails immediately,
  // forcing stopComposedRecorder into its fallback path (mirrors
  // test/session-stop-recorder-teardown.test.ts's analogous regression test
  // for teardownAnyLiveRecorderAtSessionStop).
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
  setActiveSession({ sessionId: 's-wedged-stop', dir: sessionDir, harId: null, targetId: 'target-abc', stepCount: 0 });
  setActiveRecId(recId);

  try {
    assert.ok(isPidAlive(placeholder.pid), 'placeholder pid must be alive before stop');

    const result = await stopComposedRecorder({ sessionDir, recId });

    assert.equal(result.state, 'orphaned-finalized');
    assert.equal(fs.existsSync(path.join(recDir, 'recorder.json')), false);
    assert.ok(fs.existsSync(path.join(recDir, 'meta.json')));
    assert.equal(getActiveRecId(), null);

    // SIGTERM delivery/exit is async -- poll for the known-live pid to actually die.
    const deadline = Date.now() + 3000;
    while (isPidAlive(placeholder.pid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(isPidAlive(placeholder.pid), false, 'the known-live pid must be killed, not left orphaned as a zombie process');
  } finally {
    placeholder.kill();
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});
