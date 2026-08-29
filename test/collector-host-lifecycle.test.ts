import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import * as net from 'node:net';
import { closeNdjsonSocket, listenNdjsonSocket, prepareSocketPath } from '../src/cdp/bridge/server.js';
import { collectorHostSocketPath } from '../src/cdp/bridge/spawn.js';
import { COLLECTOR_KINDS } from '../src/cdp/host/kinds.js';
import { runCollectorHost } from '../src/cdp/host/server.js';
import { collectorHostPath, scanCollectorHost } from '../src/cdp/host/handle.js';
import { stopAndReapCollectorHostAtSessionStop } from '../src/cdp/host/lifecycle.js';
import { CAPTURE_ROOT, ensurePrivateDir, processPidBirthProvider, readPrivateFile, removeArtifactTree, type PidBirth, writeJsonPrivate } from '../src/session/artifacts.js';

const NONCE = 'ab'.repeat(32);

function freshSession(label: string): string {
  const dir = path.join(CAPTURE_ROOT, `collector-host-lifecycle-${label}-${process.pid}-${Math.random().toString(16).slice(2)}`);
  ensurePrivateDir(dir);
  return dir;
}

function birthOf(pid: number): PidBirth {
  const observed = processPidBirthProvider.read(pid);
  assert.equal(observed.status, 'found');
  return observed.identity;
}

async function waitForBirth(pid: number): Promise<PidBirth> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    const observed = processPidBirthProvider.read(pid);
    if (observed.status === 'found') return observed.identity;
    if (Date.now() >= deadline) throw new Error(`no birth for child ${pid}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function spawnAndWaitDead(): Promise<{ pid: number; birth: PidBirth }> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  const pid = child.pid!;
  const birth = await waitForBirth(pid);
  child.kill();
  await new Promise<void>(resolve => child.once('exit', () => resolve()));
  return { pid, birth };
}

async function spawnPlaceholderChild(): Promise<{ pid: number; birth: PidBirth; kill: () => void }> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  try {
    return { pid: child.pid!, birth: await waitForBirth(child.pid!), kill: () => { try { child.kill(); } catch {} } };
  } catch (error) {
    child.kill();
    throw error;
  }
}

function writeHostHandle(sessionDir: string, pid: number, birth: PidBirth): void {
  writeJsonPrivate(collectorHostPath(sessionDir), {
    pid, birth, socketPath: collectorHostSocketPath(sessionDir), targetId: 'target', nonce: NONCE, startedAt: new Date().toISOString(), collectors: [], reservations: [],
  });
}

function writeCollecting(sessionDir: string, id = 'rec-orphan'): string {
  const dir = path.join(sessionDir, 'motion', 'recs', id);
  ensurePrivateDir(dir);
  writeJsonPrivate(path.join(dir, 'collecting.json'), { id, kind: 'motion', startedAt: new Date().toISOString(), hostPid: process.pid, hostBirth: birthOf(process.pid) });
  return dir;
}

test('collector host startup accepts only its generated socket and socket helpers preserve regular files', async () => {
  const sessionDir = freshSession('socket-ownership');
  const socketPath = collectorHostSocketPath(sessionDir);
  try {
    fs.writeFileSync(socketPath, 'protected');
    assert.throws(() => prepareSocketPath(socketPath), /socket path is not a Unix socket/);
    closeNdjsonSocket(net.createServer(), socketPath);
    assert.equal(fs.readFileSync(socketPath, 'utf8'), 'protected');
    await assert.rejects(runCollectorHost({ socketPath: path.join(sessionDir, 'forged.sock'), sessionDir, targetId: 'target', port: 1 }), /collector host socket path must match its session/);
  } finally {
    try { fs.unlinkSync(socketPath); } catch {}
    removeArtifactTree(sessionDir);
  }
});

test('session teardown is absent without a collector host handle', async () => {
  const sessionDir = freshSession('absent');
  try {
    assert.deepEqual(await stopAndReapCollectorHostAtSessionStop(sessionDir), { status: 'absent' });
  } finally { removeArtifactTree(sessionDir); }
});

test('collector host handles must name a generated socket that is a Unix socket', async () => {
  const sessionDir = freshSession('malformed-socket');
  const host = await spawnPlaceholderChild();
  const socketPath = collectorHostSocketPath(sessionDir);
  try {
    fs.writeFileSync(socketPath, 'not a socket');
    writeHostHandle(sessionDir, host.pid, host.birth);
    assert.equal(scanCollectorHost(sessionDir).classification, 'malformed');
    assert.deepEqual(await stopAndReapCollectorHostAtSessionStop(sessionDir), { status: 'terminal', error: 'collector host handle is malformed' });
    assert.equal(fs.readFileSync(socketPath, 'utf8'), 'not a socket');

    const forged = path.join(sessionDir, 'forged.sock');
    writeJsonPrivate(collectorHostPath(sessionDir), {
      pid: host.pid, birth: host.birth, socketPath: forged, targetId: 'target', nonce: NONCE, startedAt: new Date().toISOString(), collectors: [], reservations: [],
    });
    assert.equal(scanCollectorHost(sessionDir).classification, 'malformed');
  } finally {
    try { fs.unlinkSync(socketPath); } catch {}
    host.kill();
    removeArtifactTree(sessionDir);
  }
});

test('session teardown reconstructs collectors after a dead host', async () => {
  const sessionDir = freshSession('dead');
  const dead = await spawnAndWaitDead();
  const recDir = writeCollecting(sessionDir);
  writeHostHandle(sessionDir, dead.pid, dead.birth);
  try {
    const result = await stopAndReapCollectorHostAtSessionStop(sessionDir);
    assert.deepEqual(result, { status: 'reaped', outcomes: [{ status: 'reaped', id: 'rec-orphan', kind: 'motion', dir: recDir }] });
    const meta = JSON.parse(readPrivateFile(path.join(recDir, 'meta.json')).toString('utf8')) as { completion: string; reason: string; summary: { state: string } };
    assert.equal(meta.completion, 'orphaned');
    assert.equal(meta.reason, 'host_died');
    assert.equal(meta.summary.state, 'orphaned-finalized');
    assert.equal(fs.existsSync(path.join(recDir, 'collecting.json')), false);
    assert.equal(fs.existsSync(collectorHostPath(sessionDir)), false);
  } finally { removeArtifactTree(sessionDir); }
});

test('session teardown reports terminal when dead-host reconstruction fails', async () => {
  const sessionDir = freshSession('reap-failure');
  const dead = await spawnAndWaitDead();
  writeCollecting(sessionDir, 'rec-failure');
  writeHostHandle(sessionDir, dead.pid, dead.birth);
  const previous = COLLECTOR_KINDS.motion;
  (COLLECTOR_KINDS as any).motion = { ...previous, reconstruct: () => { throw new Error('reconstruct failed'); } };
  try {
    assert.deepEqual(await stopAndReapCollectorHostAtSessionStop(sessionDir), { status: 'terminal', error: 'reconstruct failed' });
  } finally {
    (COLLECTOR_KINDS as any).motion = previous;
    removeArtifactTree(sessionDir);
  }
});

test('session teardown drains a live host through its current host protocol', async () => {
  const sessionDir = freshSession('live');
  const host = await spawnPlaceholderChild();
  const socketPath = collectorHostSocketPath(sessionDir);
  writeHostHandle(sessionDir, host.pid, host.birth);
  const server = await listenNdjsonSocket(socketPath, (line, socket) => {
    const request = JSON.parse(line) as { reqId: number; type: string; nonce: string };
    assert.equal(request.type, 'session-teardown');
    assert.equal(request.nonce, NONCE);
    socket.write(JSON.stringify({ reqId: request.reqId, type: request.type, ok: true, outcomes: [] }) + '\n');
    host.kill();
  });
  try {
    assert.deepEqual(await stopAndReapCollectorHostAtSessionStop(sessionDir), { status: 'drained', outcomes: [] });
  } finally {
    closeNdjsonSocket(server, socketPath);
    host.kill();
    removeArtifactTree(sessionDir);
  }
});

test('session teardown preserves a live host after its host protocol refuses teardown', async () => {
  const sessionDir = freshSession('live-refusal');
  const host = await spawnPlaceholderChild();
  const socketPath = collectorHostSocketPath(sessionDir);
  writeHostHandle(sessionDir, host.pid, host.birth);
  const server = await listenNdjsonSocket(socketPath, (line, socket) => {
    const request = JSON.parse(line) as { reqId: number; type: string; nonce: string };
    socket.write(JSON.stringify({ reqId: request.reqId, type: request.type, ok: false, error: 'drain failed' }) + '\n');
  });
  try {
    assert.deepEqual(await stopAndReapCollectorHostAtSessionStop(sessionDir), { status: 'terminal', error: 'drain failed' });
    assert.equal(processPidBirthProvider.read(host.pid).status, 'found');
  } finally {
    closeNdjsonSocket(server, socketPath);
    host.kill();
    removeArtifactTree(sessionDir);
  }
});
