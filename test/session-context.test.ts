import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { acquirePrivateLock, CAPTURE_ROOT } from '../src/session/artifacts.js';

// Regression coverage for the multi-agent session-targeting bug: a
// `capture session start` in one concurrent caller must never hijack
// another caller's "active session" auto-fill, and an ambient CDP_TARGET
// env var must never outrank an active session's own target. `parsed.har`
// is a session-filled internal slot: no flag and no env var can set it.

test('active session pointer is isolated per CRTR_NODE_ID scope', async () => {
  const { getActiveSession, setActiveSession, clearActiveSession } = await import('../src/session-context.js');

  const prevNodeId = process.env.CRTR_NODE_ID;
  const dirA = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'capture-test-scope-a-'));
  const dirB = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'capture-test-scope-b-'));

  try {
    process.env.CRTR_NODE_ID = 'test-node-a';
    clearActiveSession();
    await setActiveSession({ sessionId: 'sess-a', dir: dirA, harId: 'har-a', targetId: 'target-a', stepCount: 0 });

    process.env.CRTR_NODE_ID = 'test-node-b';
    clearActiveSession();
    assert.equal(getActiveSession(), null, "a fresh scope must not see another scope's active session");
    await setActiveSession({ sessionId: 'sess-b', dir: dirB, harId: 'har-b', targetId: 'target-b', stepCount: 0 });

    // Scope b starting its own session must not clobber scope a's pointer.
    process.env.CRTR_NODE_ID = 'test-node-a';
    const active = getActiveSession();
    assert.equal(active?.sessionId, 'sess-a');
    assert.equal(active?.targetId, 'target-a');

    process.env.CRTR_NODE_ID = 'test-node-b';
    const activeB = getActiveSession();
    assert.equal(activeB?.sessionId, 'sess-b');
    assert.equal(activeB?.targetId, 'target-b');
  } finally {
    process.env.CRTR_NODE_ID = 'test-node-a';
    clearActiveSession();
    process.env.CRTR_NODE_ID = 'test-node-b';
    clearActiveSession();
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

test('active session index file stores only pointer identity, not mutable session state', async () => {
  const { setActiveSession, getActiveSession, clearActiveSession } = await import('../src/session-context.js');
  const { CAPTURE_ROOT } = await import('../src/session/artifacts.js');

  const prevNodeId = process.env.CRTR_NODE_ID;
  const dir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'capture-test-index-'));

  try {
    process.env.CRTR_NODE_ID = 'test-node-index';
    await setActiveSession({
      sessionId: 'sess-store',
      dir,
      harId: 'har-store',
      targetId: 'target-store',
      stepCount: 7,
      port: 5555,
      bridgeSocket: '/tmp/socket',
      bridgePid: 1234,
      activeRecId: 'rec-store',
    });

    const indexPath = path.join(CAPTURE_ROOT, '.active-test-node-index');
    const indexText = fs.readFileSync(indexPath, 'utf-8');
    assert.match(indexText, /"sessionId":\s*"sess-store"/);
    assert.match(indexText, /"dir":\s*"/);
    assert(!indexText.includes('harId'));
    assert(!indexText.includes('targetId'));

    const active = getActiveSession();
    assert.equal(active?.harId, 'har-store');
    assert.equal(active?.targetId, 'target-store');
    assert.equal(active?.port, 5555);
  } finally {
    clearActiveSession();
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('active session target, har, and endpoint win over stale environment values while explicit --port still overrides', async () => {
  const { setActiveSession, clearActiveSession } = await import('../src/session-context.js');
  const { parseCliArgs, resolveCliContext } = await import('../src/cdp/args.js');

  const prevNodeId = process.env.CRTR_NODE_ID;
  const prevTarget = process.env.CDP_TARGET;
  const prevPort = process.env.CDP_PORT;
  const dir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'capture-test-precedence-'));

  try {
    process.env.CRTR_NODE_ID = 'test-node-precedence';
    await setActiveSession({ sessionId: 'sess-p', dir, harId: 'session-har', targetId: 'session-target', port: 52621, stepCount: 0 });
    // Simulates leaked/inherited values from an unrelated orchestrator
    // or an earlier command in the same shell.
    process.env.CDP_TARGET = 'stale-env-target';
    process.env.CDP_PORT = '53451';

    const parsed = resolveCliContext(parseCliArgs(['click', 'Create applet']));
    assert.equal(parsed.target, 'session-target');
    assert.equal(parsed.har, 'session-har');
    assert.equal(parsed.port, 52621);
    assert.equal(parseCliArgs(['click', 'Create applet', '--port', '9222']).port, 9222);
  } finally {
    clearActiveSession();
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
    if (prevTarget === undefined) delete process.env.CDP_TARGET;
    else process.env.CDP_TARGET = prevTarget;
    if (prevPort === undefined) delete process.env.CDP_PORT;
    else process.env.CDP_PORT = prevPort;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('active session network emulation is retained and reapplied only to its target', async () => {
  const { setActiveSession, clearActiveSession, setActiveNetworkOffline } = await import('../src/session-context.js');
  const { applyActiveSessionNetworkConditions } = await import('../src/cdp/connection.js');
  const { CAPTURE_ROOT } = await import('../src/session/artifacts.js');
  const prevNodeId = process.env.CRTR_NODE_ID;
  const dir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'capture-test-network-'));
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = {
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      calls.push({ method, params });
      return {};
    },
  };

  try {
    process.env.CRTR_NODE_ID = 'test-node-network';
    clearActiveSession();
    await setActiveSession({ sessionId: 'sess-network', dir, harId: null, targetId: 'session-target', stepCount: 0 });
    await setActiveNetworkOffline(true);

    await applyActiveSessionNetworkConditions(client as never, (await import('../src/session-context.js')).getActiveSession(), 'session-target');
    assert.deepEqual(calls, [
      { method: 'Network.enable', params: {} },
      { method: 'Network.emulateNetworkConditions', params: { offline: true, latency: -1, downloadThroughput: 0, uploadThroughput: 0 } },
    ]);

    await applyActiveSessionNetworkConditions(client as never, (await import('../src/session-context.js')).getActiveSession(), 'other-target');
    assert.equal(calls.length, 2, 'a session setting must not affect an explicitly different target');

    // The online transition is reapplied on the session target too, so a
    // recorder-routed or fresh connection inherits the restored state.
    calls.length = 0;
    await setActiveNetworkOffline(false);
    await applyActiveSessionNetworkConditions(client as never, (await import('../src/session-context.js')).getActiveSession(), 'session-target');
    assert.deepEqual(calls, [
      { method: 'Network.enable', params: {} },
      { method: 'Network.emulateNetworkConditions', params: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 } },
    ]);
  } finally {
    clearActiveSession();
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CDP_TARGET env var still fills the target when no session is active; CDP_HAR_ID never fills har', async () => {
  const { clearActiveSession } = await import('../src/session-context.js');
  const { parseCliArgs, resolveCliContext } = await import('../src/cdp/args.js');

  const prevNodeId = process.env.CRTR_NODE_ID;
  const prevTarget = process.env.CDP_TARGET;
  const prevHar = process.env.CDP_HAR_ID;

  try {
    process.env.CRTR_NODE_ID = 'test-node-no-session';
    clearActiveSession();
    process.env.CDP_TARGET = 'env-target';
    // CDP_HAR_ID is dead: har is a session-filled internal slot only.
    process.env.CDP_HAR_ID = 'env-har';

    const parsed = resolveCliContext(parseCliArgs(['click', 'Sign in']));
    assert.equal(parsed.target, 'env-target');
    assert.equal(parsed.har, undefined);
  } finally {
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
    if (prevTarget === undefined) delete process.env.CDP_TARGET;
    else process.env.CDP_TARGET = prevTarget;
    if (prevHar === undefined) delete process.env.CDP_HAR_ID;
    else process.env.CDP_HAR_ID = prevHar;
  }
});

test('an explicit --target overrides both the active session and env vars', async () => {
  const { setActiveSession, clearActiveSession } = await import('../src/session-context.js');
  const { parseCliArgs, resolveCliContext } = await import('../src/cdp/args.js');

  const prevNodeId = process.env.CRTR_NODE_ID;
  const prevTarget = process.env.CDP_TARGET;
  const dir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'capture-test-explicit-'));

  try {
    process.env.CRTR_NODE_ID = 'test-node-explicit';
    await setActiveSession({ sessionId: 'sess-e', dir, harId: null, targetId: 'session-target', stepCount: 0 });
    process.env.CDP_TARGET = 'env-target';

    const parsed = resolveCliContext(parseCliArgs(['click', 'Create applet', '--target', 'explicit-target']));
    assert.equal(parsed.target, 'explicit-target');
  } finally {
    clearActiveSession();
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
    if (prevTarget === undefined) delete process.env.CDP_TARGET;
    else process.env.CDP_TARGET = prevTarget;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('explicit --port wins over session-port fallback and env var', async () => {
  const { setActiveSession, clearActiveSession } = await import('../src/session-context.js');
  const { parseCliArgs, resolveCliContext } = await import('../src/cdp/args.js');

  const prevNodeId = process.env.CRTR_NODE_ID;
  const prevPort = process.env.CDP_PORT;
  const dir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'capture-test-port-'));

  try {
    process.env.CRTR_NODE_ID = 'test-node-port';
    await setActiveSession({ sessionId: 'sess-port', dir, harId: null, targetId: 'target-port', stepCount: 0, port: 23456 });
    process.env.CDP_PORT = '9999';

    const parsed = resolveCliContext(parseCliArgs(['measure', 'snap', '--port', '56789']));
    assert.equal(parsed.port, 56789);
  } finally {
    clearActiveSession();
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
    if (prevPort === undefined) delete process.env.CDP_PORT;
    else process.env.CDP_PORT = prevPort;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('active session port fills --port when not explicitly provided, before env fallback', async () => {
  const { setActiveSession, clearActiveSession } = await import('../src/session-context.js');
  const { parseCliArgs, resolveCliContext } = await import('../src/cdp/args.js');

  const prevNodeId = process.env.CRTR_NODE_ID;
  const prevPort = process.env.CDP_PORT;
  const dir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'capture-test-port2-'));

  try {
    process.env.CRTR_NODE_ID = 'test-node-port2';
    await setActiveSession({ sessionId: 'sess-port2', dir, harId: null, targetId: 'target-port2', stepCount: 0, port: 23456 });
    process.env.CDP_PORT = '9999';

    const parsed = resolveCliContext(parseCliArgs(['click', 'Create']));
    assert.equal(parsed.port, 23456);
  } finally {
    clearActiveSession();
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
    if (prevPort === undefined) delete process.env.CDP_PORT;
    else process.env.CDP_PORT = prevPort;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('session metadata updates wait for the live U02 lock holder even after its lease expires', async () => {
  const { setActiveSession, updateSessionState, clearActiveSession } = await import('../src/session-context.js');
  const prevNodeId = process.env.CRTR_NODE_ID;
  const dir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'capture-test-metadata-lock-'));
  const lockPath = path.join(dir, '.session-state.lock');

  try {
    process.env.CRTR_NODE_ID = 'test-node-metadata-lock';
    await setActiveSession({ sessionId: 'sess-lock', dir, harId: null, targetId: null, stepCount: 0 });
    const holder = await acquirePrivateLock(lockPath, { acquireTimeoutMs: 1_000, leaseMs: 1 });
    let settled = false;
    const update = updateSessionState(dir, { targetId: 'target-after-release' }).then(value => {
      settled = true;
      return value;
    });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(settled, false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.session.json'), 'utf-8')).targetId, null);
    holder.release();
    assert.equal((await update).targetId, 'target-after-release');
  } finally {
    clearActiveSession();
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('real source entrypoint rejects malformed leaf input before touching a stale active index', () => {
  const root = fs.mkdtempSync(path.join(path.dirname(CAPTURE_ROOT), 'capture-entry-validation-'));
  const nodeId = `entry-validation-${process.pid}`;
  const activePath = path.join(root, `.active-${nodeId}`);
  const stale = Buffer.from('{"sessionId":"stale","dir":"/does/not/exist"}\n');
  fs.writeFileSync(activePath, stale, { mode: 0o600 });
  try {
    for (const argv of [
      ['page', 'click', 'one', 'two'],
      ['page', 'scroll', 'target', '--to', 'not-a-position'],
    ]) {
      const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/capture.ts', ...argv], {
        cwd: process.cwd(),
        env: { ...process.env, CAPTURE_ROOT: root, CRTR_NODE_ID: nodeId, CDP_PORT: 'invalid-env-must-not-resolve' },
        encoding: 'utf-8',
      });
      assert.equal(result.status, 1, `${argv.join(' ')}: ${result.stderr}`);
      assert.deepEqual(fs.readFileSync(activePath), stale);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clearActiveSessionIf removes active pointer only for matching ids', async () => {
  const { setActiveSession, clearActiveSessionIf, getActiveSession, clearActiveSession } = await import('../src/session-context.js');

  const prevNodeId = process.env.CRTR_NODE_ID;
  const dir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'capture-test-if-match-'));

  try {
    process.env.CRTR_NODE_ID = 'test-node-if-match';
    await setActiveSession({ sessionId: 'sess-keep', dir, harId: null, targetId: null, stepCount: 0 });

    clearActiveSessionIf('other');
    assert.equal(getActiveSession()?.sessionId, 'sess-keep');

    clearActiveSessionIf('sess-keep');
    assert.equal(getActiveSession(), null);
  } finally {
    clearActiveSession();
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
