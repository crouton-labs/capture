import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Regression coverage for the multi-agent session-targeting bug: a
// `capture session start` in one concurrent caller must never hijack
// another caller's "active session" auto-fill, and an ambient
// CDP_TARGET/CDP_HAR_ID env var must never outrank an active session's own
// target/har.

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

test('active session target, HAR, and endpoint win over stale environment values while explicit --port still overrides', async () => {
  const { setActiveSession, clearActiveSession } = await import('../src/session-context.js');
  const { parseCliArgs } = await import('../src/cdp/args.js');

  const prevNodeId = process.env.CRTR_NODE_ID;
  const prevTarget = process.env.CDP_TARGET;
  const prevHar = process.env.CDP_HAR_ID;
  const prevPort = process.env.CDP_PORT;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-test-precedence-'));

  try {
    process.env.CRTR_NODE_ID = 'test-node-precedence';
    setActiveSession({ sessionId: 'sess-p', dir, harId: 'session-har', targetId: 'session-target', cdpPort: 52621, stepCount: 0 });
    // Simulates leaked/inherited values from an unrelated orchestrator.
    process.env.CDP_TARGET = 'stale-env-target';
    process.env.CDP_HAR_ID = 'stale-env-har';
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
    if (prevHar === undefined) delete process.env.CDP_HAR_ID;
    else process.env.CDP_HAR_ID = prevHar;
    if (prevPort === undefined) delete process.env.CDP_PORT;
    else process.env.CDP_PORT = prevPort;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CDP_TARGET env var still fills the target when no session is active', async () => {
  const { clearActiveSession } = await import('../src/session-context.js');
  const { parseCliArgs } = await import('../src/cdp/args.js');

  const prevNodeId = process.env.CRTR_NODE_ID;
  const prevTarget = process.env.CDP_TARGET;

  try {
    process.env.CRTR_NODE_ID = 'test-node-no-session';
    clearActiveSession();
    process.env.CDP_TARGET = 'env-target';

    const parsed = parseCliArgs(['click', 'Sign in']);
    assert.equal(parsed.target, 'env-target');
  } finally {
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
    if (prevTarget === undefined) delete process.env.CDP_TARGET;
    else process.env.CDP_TARGET = prevTarget;
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
