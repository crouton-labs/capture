import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Process-scope this file's active-session pointer. Node's test runner
// process-isolates each file, so setting it before the imports run scopes only
// THIS file's pointer under CAPTURE_ROOT.
process.env.CRTR_NODE_ID = `u04-rollback-${process.pid}-${Date.now()}`;

import { sessionMain, __setSessionStartWorld, type SessionStartWorld } from '../src/session/commands.js';
import { getActiveSession, clearActiveSession, setActiveSession } from '../src/session-context.js';
import { CAPTURE_ROOT } from '../src/session/artifacts.js';
import { startBridge } from '../src/cdp/bridge/spawn.js';
import { createHarRecording } from '../src/har-manager.js';
import type { CDPTarget, ParsedArgs } from '../src/cdp/types.js';

function scopePointerPath(): string {
  return path.join(CAPTURE_ROOT, `.active-${process.env.CRTR_NODE_ID}`);
}

function startArgs(extra: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command: 'session', positional: ['start'], json: false, ...extra } as ParsedArgs;
}

/** TEE capture: forward to the real stdout so node's reporter stream stays
 * intact, while accumulating this command's output for substring checks. */
async function runStart(extra: Partial<ParsedArgs>): Promise<{ out: string; exitCode: number | undefined }> {
  const origWrite = process.stdout.write.bind(process.stdout);
  const origExit = process.exitCode;
  process.exitCode = undefined;
  let out = '';
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    out += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    await sessionMain(startArgs(extra), []);
    return { out, exitCode: process.exitCode as number | undefined };
  } finally {
    process.stdout.write = origWrite;
    process.exitCode = origExit;
  }
}

interface WorldCalls {
  createHar: string[];
  deleteHar: string[];
  detect: number;
  openTab: string[];
  closeTarget: Array<{ port: number; targetId: string }>;
  awaitTabReady: string[];
  startBridge: string[];
  stopBridge: Array<{ pid: number | null; socketPath: string | null }>;
  publish: string[];
}

/** A world whose steps all succeed, with a per-test call log. Individual tests
 * override the ONE method that should throw at the boundary under test. */
function baseWorld(): { calls: WorldCalls; world: SessionStartWorld } {
  const calls: WorldCalls = {
    createHar: [], deleteHar: [], detect: 0, openTab: [], closeTarget: [],
    awaitTabReady: [], startBridge: [], stopBridge: [], publish: [],
  };
  const fakeTarget = (): CDPTarget => ({ id: 'TAB1', title: '', url: 'about:blank', type: 'page', webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/TAB1' });
  const world: SessionStartWorld = {
    async createHar(dir) { calls.createHar.push(dir); return `${dir}/.har/fake.json`; },
    async deleteHar(id) { calls.deleteHar.push(id); },
    async detectCdpPort() { calls.detect += 1; return 9222; },
    async openTab(_port, _url) { calls.openTab.push(_url); return fakeTarget(); },
    async closeTarget(port, targetId) { calls.closeTarget.push({ port, targetId }); },
    async awaitTabReady(target) { calls.awaitTabReady.push(target.id); return false; },
    async startBridge(dir) { calls.startBridge.push(dir); return { socketPath: path.join(dir, 'bridge.sock'), pid: 999999 }; },
    stopBridge(pid, socketPath) { calls.stopBridge.push({ pid, socketPath }); },
    async publishActiveSession(session) { calls.publish.push(session.sessionId); },
  };
  return { calls, world };
}

function newSessionDirs(before: Set<string>): string[] {
  const after = fs.existsSync(CAPTURE_ROOT) ? fs.readdirSync(CAPTURE_ROOT) : [];
  // Ignore scope-lock artifacts (`.session-lifecycle-*`, `.active-*`, `.har`)
  // that are not per-session trees; a residual `cap-*` dir is the real leak.
  return after.filter((name) => name.startsWith('cap-') && !before.has(name));
}

function seedForeignPointer(): { path: string; bytes: Buffer } {
  const p = path.join(CAPTURE_ROOT, `.active-foreign-${process.pid}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(CAPTURE_ROOT, { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ sessionId: 'foreign-sess', dir: path.join(CAPTURE_ROOT, 'foreign-sess') }));
  return { path: p, bytes: fs.readFileSync(p) };
}

function resetScope(): void {
  clearActiveSession();
  try { fs.unlinkSync(scopePointerPath()); } catch { /* absent */ }
}

/** Every failed start must: exit 1, emit start_failed, leave the scope pointer
 * cleared, register no active session, remove any cap-* tree, and never touch a
 * foreign pointer. Returns the newly-leaked dirs (must be empty). */
function assertCleanFailure(res: { out: string; exitCode: number | undefined }, before: Set<string>, foreign: { path: string; bytes: Buffer }): void {
  assert.equal(res.exitCode, 1, res.out);
  assert.ok(res.out.includes('start_failed'), `expected start_failed, got: ${res.out}`);
  assert.equal(getActiveSession(), null, 'no active session after a failed start');
  assert.ok(!fs.existsSync(scopePointerPath()), 'scope active pointer must be cleared');
  assert.deepEqual(newSessionDirs(before), [], 'a failed start must leave no cap-* tree');
  assert.deepEqual(fs.readFileSync(foreign.path), foreign.bytes, 'foreign pointer must be byte-identical');
}

test('rollback: createHar failure removes the artifact tree and acquires nothing else', async () => {
  resetScope();
  const foreign = seedForeignPointer();
  const before = new Set(fs.existsSync(CAPTURE_ROOT) ? fs.readdirSync(CAPTURE_ROOT) : []);
  const { calls, world } = baseWorld();
  world.createHar = async () => { throw new Error('har boom'); };
  __setSessionStartWorld(world);
  try {
    const res = await runStart({ url: 'https://example.test/', port: 9222 });
    assertCleanFailure(res, before, foreign);
    assert.deepEqual(calls.deleteHar, [], 'no HAR was acquired to delete');
    assert.deepEqual(calls.closeTarget, [], 'no target opened');
    assert.deepEqual(calls.stopBridge, [], 'no bridge started');
    assert.equal(calls.openTab.length, 0);
  } finally {
    __setSessionStartWorld();
    fs.unlinkSync(foreign.path);
  }
});

test('rollback: detectCdpPort failure (hold-only) deletes the HAR and removes the tree', async () => {
  resetScope();
  const foreign = seedForeignPointer();
  const before = new Set(fs.existsSync(CAPTURE_ROOT) ? fs.readdirSync(CAPTURE_ROOT) : []);
  const { calls, world } = baseWorld();
  world.detectCdpPort = async () => { throw new Error('no cdp port'); };
  __setSessionStartWorld(world);
  try {
    const res = await runStart({ hold: true });
    assertCleanFailure(res, before, foreign);
    assert.equal(calls.deleteHar.length, 1, 'the acquired HAR is deleted exactly once');
    assert.deepEqual(calls.openTab, [], 'hold-only never opens a tab');
    assert.deepEqual(calls.closeTarget, []);
    assert.deepEqual(calls.stopBridge, []);
  } finally {
    __setSessionStartWorld();
    fs.unlinkSync(foreign.path);
  }
});

test('rollback: openTab failure never closes a target and cleans HAR + tree', async () => {
  resetScope();
  const foreign = seedForeignPointer();
  const before = new Set(fs.existsSync(CAPTURE_ROOT) ? fs.readdirSync(CAPTURE_ROOT) : []);
  const { calls, world } = baseWorld();
  world.openTab = async () => { throw new Error('open failed'); };
  __setSessionStartWorld(world);
  try {
    const res = await runStart({ url: 'https://example.test/', port: 9222 });
    assertCleanFailure(res, before, foreign);
    assert.equal(calls.deleteHar.length, 1);
    assert.deepEqual(calls.closeTarget, [], 'a target that never opened is never closed');
  } finally {
    __setSessionStartWorld();
    fs.unlinkSync(foreign.path);
  }
});

test('rollback: awaitTabReady failure closes exactly the opened target once', async () => {
  resetScope();
  const foreign = seedForeignPointer();
  const before = new Set(fs.existsSync(CAPTURE_ROOT) ? fs.readdirSync(CAPTURE_ROOT) : []);
  const { calls, world } = baseWorld();
  world.awaitTabReady = async () => { throw new Error('attach timeout'); };
  __setSessionStartWorld(world);
  try {
    const res = await runStart({ url: 'https://example.test/', port: 9222 });
    assertCleanFailure(res, before, foreign);
    assert.deepEqual(calls.closeTarget, [{ port: 9222, targetId: 'TAB1' }], 'the opened target is closed once');
    assert.equal(calls.deleteHar.length, 1);
    assert.deepEqual(calls.stopBridge, [], 'no bridge to stop');
  } finally {
    __setSessionStartWorld();
    fs.unlinkSync(foreign.path);
  }
});

test('rollback: startBridge failure closes the target, cleans HAR, and stops no bridge', async () => {
  resetScope();
  const foreign = seedForeignPointer();
  const before = new Set(fs.existsSync(CAPTURE_ROOT) ? fs.readdirSync(CAPTURE_ROOT) : []);
  const { calls, world } = baseWorld();
  world.startBridge = async () => { throw new Error('bridge never came up'); };
  __setSessionStartWorld(world);
  try {
    const res = await runStart({ url: 'https://example.test/', port: 9222, hold: true });
    assertCleanFailure(res, before, foreign);
    assert.deepEqual(calls.closeTarget, [{ port: 9222, targetId: 'TAB1' }]);
    assert.equal(calls.deleteHar.length, 1);
    assert.deepEqual(calls.stopBridge, [], 'a bridge that never started is never stopped');
  } finally {
    __setSessionStartWorld();
    fs.unlinkSync(foreign.path);
  }
});

test('rollback: publish failure releases bridge, target, HAR in reverse order', async () => {
  resetScope();
  const foreign = seedForeignPointer();
  const before = new Set(fs.existsSync(CAPTURE_ROOT) ? fs.readdirSync(CAPTURE_ROOT) : []);
  const { calls, world } = baseWorld();
  const order: string[] = [];
  // Prove reverse order via observed state, not just call order:
  // - active publication is compare-cleared FIRST (its release was pushed last),
  //   so when stopBridge runs the scope pointer is already gone;
  // - the artifact tree is removed LAST, so when deleteHar runs the dir survives.
  world.publishActiveSession = async () => { throw new Error('publish exploded'); };
  world.stopBridge = (pid, socketPath) => {
    order.push('stopBridge');
    assert.ok(!fs.existsSync(scopePointerPath()), 'publication compare-clear precedes stopBridge');
    calls.stopBridge.push({ pid, socketPath });
  };
  world.closeTarget = async (port, targetId) => { order.push('closeTarget'); calls.closeTarget.push({ port, targetId }); };
  world.deleteHar = async (id) => {
    order.push('deleteHar');
    const dir = path.dirname(path.dirname(id));
    assert.ok(fs.existsSync(dir), 'artifact-tree removal is last, after deleteHar');
    calls.deleteHar.push(id);
  };
  __setSessionStartWorld(world);
  try {
    const res = await runStart({ url: 'https://example.test/', port: 9222, hold: true });
    assertCleanFailure(res, before, foreign);
    assert.deepEqual(order, ['stopBridge', 'closeTarget', 'deleteHar'], 'reverse acquisition order');
    assert.equal(calls.stopBridge.length, 1, 'the held bridge is stopped once');
    assert.equal(calls.stopBridge[0].pid, 999999, 'stopBridge receives this attempt\'s bridge pid');
    assert.ok(calls.stopBridge[0].socketPath?.endsWith('bridge.sock'), 'stopBridge receives this attempt\'s socket');
    assert.deepEqual(calls.closeTarget, [{ port: 9222, targetId: 'TAB1' }]);
  } finally {
    __setSessionStartWorld();
    fs.unlinkSync(foreign.path);
  }
});

test('rollback: a landed publication is compare-cleared, foreign pointer untouched', async () => {
  resetScope();
  const foreign = seedForeignPointer();
  const before = new Set(fs.existsSync(CAPTURE_ROOT) ? fs.readdirSync(CAPTURE_ROOT) : []);
  const { calls, world } = baseWorld();
  // Publication actually lands (index + .session.json written) and THEN fails.
  world.publishActiveSession = async (session) => { await setActiveSession(session); throw new Error('post-publish failure'); };
  __setSessionStartWorld(world);
  try {
    const res = await runStart({ url: 'https://example.test/', port: 9222 });
    assertCleanFailure(res, before, foreign);
    assert.equal(calls.closeTarget.length, 1, 'target closed once');
    assert.equal(calls.deleteHar.length, 1);
  } finally {
    __setSessionStartWorld();
    fs.unlinkSync(foreign.path);
  }
});

test('rollback: dual failure preserves both the primary error and the cleanup failure', async () => {
  resetScope();
  const foreign = seedForeignPointer();
  const before = new Set(fs.existsSync(CAPTURE_ROOT) ? fs.readdirSync(CAPTURE_ROOT) : []);
  const { world } = baseWorld();
  world.awaitTabReady = async () => { throw new Error('primary attach failure'); };
  world.closeTarget = async () => { throw new Error('secondary close failure'); };
  __setSessionStartWorld(world);
  try {
    const res = await runStart({ url: 'https://example.test/', port: 9222 });
    assert.equal(res.exitCode, 1);
    assert.ok(res.out.includes('primary attach failure'), `primary failure preserved: ${res.out}`);
    assert.ok(res.out.includes('secondary close failure'), `cleanup failure preserved: ${res.out}`);
    // Tree removal still runs after the failing closeTarget.
    assert.deepEqual(newSessionDirs(before), [], 'tree still removed despite a cleanup failure');
    assert.deepEqual(fs.readFileSync(foreign.path), foreign.bytes);
  } finally {
    __setSessionStartWorld();
    fs.unlinkSync(foreign.path);
  }
});

test('success: a fully successful start invokes no cleanup', async () => {
  resetScope();
  const before = new Set(fs.existsSync(CAPTURE_ROOT) ? fs.readdirSync(CAPTURE_ROOT) : []);
  const { calls, world } = baseWorld();
  // Real publication so the active session is genuinely established.
  world.publishActiveSession = setActiveSession;
  // Real HAR create so the persisted harId matches a real file for the success path.
  world.createHar = async (dir) => { calls.createHar.push(dir); return (await createHarRecording(dir)).id; };
  __setSessionStartWorld(world);
  let dir: string | undefined;
  try {
    const res = await runStart({ url: 'https://example.test/', port: 9222, hold: true });
    assert.equal(res.exitCode, undefined, res.out);
    const active = getActiveSession();
    assert.ok(active, 'session active after success');
    dir = active!.dir;
    assert.equal(active!.targetId, 'TAB1');
    assert.equal(active!.port, 9222);
    assert.equal(active!.bridgePid, 999999);
    assert.ok(active!.harId, 'harId persisted');
    assert.ok(fs.existsSync(dir), 'session dir exists on success');
    assert.deepEqual(calls.closeTarget, [], 'success closes no target');
    assert.deepEqual(calls.stopBridge, [], 'success stops no bridge');
    assert.deepEqual(calls.deleteHar, [], 'success deletes no HAR');
  } finally {
    __setSessionStartWorld();
    clearActiveSession();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- Direct proof: plain startBridge self-reaps its child on readiness timeout ---

test('startBridge reaps its child before rejecting when the socket never appears', async () => {
  // A fixture that ignores argv, writes its own pid, and never creates a
  // socket — forcing startBridge's readiness timeout path.
  const fixture = path.join(os.tmpdir(), `u04-bridge-fixture-${process.pid}-${Date.now()}.cjs`);
  const pidFile = `${fixture}.pid`;
  fs.writeFileSync(fixture, `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1e9);\n`);
  fs.mkdirSync(CAPTURE_ROOT, { recursive: true });
  const sessionRoot = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'u04-bridge-'));
  const origArgv1 = process.argv[1];
  process.argv[1] = fixture;
  try {
    let err: unknown;
    try {
      await startBridge(sessionRoot, 65500, 400);
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof Error, 'startBridge must reject on readiness timeout');
    assert.ok(/did not come up within/.test((err as Error).message), (err as Error).message);
    // The child actually launched (proves there was a live process to reap).
    assert.ok(fs.existsSync(pidFile), 'the bridge child launched before the timeout');
    const childPid = Number(fs.readFileSync(pidFile, 'utf8'));
    assert.ok(Number.isInteger(childPid) && childPid > 0);
    // It is dead by/shortly after rejection — SIGTERM delivery is async, so
    // poll within a bounded window for ESRCH.
    const deadline = Date.now() + 2000;
    let alive = true;
    while (Date.now() < deadline) {
      try { process.kill(childPid, 0); } catch { alive = false; break; }
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(alive, false, 'startBridge left its readiness-timeout child alive');
  } finally {
    process.argv[1] = origArgv1;
    try { fs.rmSync(sessionRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.unlinkSync(fixture); } catch { /* best effort */ }
    try { fs.unlinkSync(pidFile); } catch { /* best effort */ }
  }
});
