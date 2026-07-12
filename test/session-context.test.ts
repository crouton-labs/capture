import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Regression coverage for the multi-agent session-targeting bug: a
// `capture session start` in one concurrent caller must never hijack
// another caller's "active session" auto-fill, and an ambient CDP_TARGET
// env var must never outrank an active session's own target. `parsed.har`
// is a session-filled internal slot: no flag and no env var can set it.

test('active session pointer is isolated per CRTR_NODE_ID scope', async () => {
  const { getActiveSession, setActiveSession, clearActiveSession } = await import('../src/session-context.js');

  const prevNodeId = process.env.CRTR_NODE_ID;
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-test-scope-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-test-scope-b-'));

  try {
    process.env.CRTR_NODE_ID = 'test-node-a';
    clearActiveSession();
    setActiveSession({ sessionId: 'sess-a', dir: dirA, harId: 'har-a', targetId: 'target-a', stepCount: 0 });

    process.env.CRTR_NODE_ID = 'test-node-b';
    clearActiveSession();
    assert.equal(getActiveSession(), null, "a fresh scope must not see another scope's active session");
    setActiveSession({ sessionId: 'sess-b', dir: dirB, harId: 'har-b', targetId: 'target-b', stepCount: 0 });

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

test('active session target, har, and endpoint win over stale environment values while explicit --port still overrides', async () => {
  const { setActiveSession, clearActiveSession } = await import('../src/session-context.js');
  const { parseCliArgs } = await import('../src/cdp/args.js');

  const prevNodeId = process.env.CRTR_NODE_ID;
  const prevTarget = process.env.CDP_TARGET;
  const prevPort = process.env.CDP_PORT;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-test-precedence-'));

  try {
    process.env.CRTR_NODE_ID = 'test-node-precedence';
    setActiveSession({ sessionId: 'sess-p', dir, harId: 'session-har', targetId: 'session-target', cdpPort: 52621, stepCount: 0 });
    // Simulates leaked/inherited values from an unrelated orchestrator.
    process.env.CDP_TARGET = 'stale-env-target';
    process.env.CDP_PORT = '53451';

    const parsed = parseCliArgs(['click', 'Create applet']);
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
  const prevNodeId = process.env.CRTR_NODE_ID;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-test-network-'));
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
    setActiveSession({ sessionId: 'sess-network', dir, harId: null, targetId: 'session-target', stepCount: 0 });
    setActiveNetworkOffline(true);

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
    setActiveNetworkOffline(false);
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
  const { parseCliArgs } = await import('../src/cdp/args.js');

  const prevNodeId = process.env.CRTR_NODE_ID;
  const prevTarget = process.env.CDP_TARGET;
  const prevHar = process.env.CDP_HAR_ID;

  try {
    process.env.CRTR_NODE_ID = 'test-node-no-session';
    clearActiveSession();
    process.env.CDP_TARGET = 'env-target';
    // CDP_HAR_ID is dead: har is a session-filled internal slot only.
    process.env.CDP_HAR_ID = 'env-har';

    const parsed = parseCliArgs(['click', 'Sign in']);
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
  const { parseCliArgs } = await import('../src/cdp/args.js');

  const prevNodeId = process.env.CRTR_NODE_ID;
  const prevTarget = process.env.CDP_TARGET;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-test-explicit-'));

  try {
    process.env.CRTR_NODE_ID = 'test-node-explicit';
    setActiveSession({ sessionId: 'sess-e', dir, harId: null, targetId: 'session-target', stepCount: 0 });
    process.env.CDP_TARGET = 'env-target';

    const parsed = parseCliArgs(['click', 'Create applet', '--target', 'explicit-target']);
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
