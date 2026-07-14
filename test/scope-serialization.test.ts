import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

// A2: target-scoped multi-request CDP state scopes serialize at the
// held-recorder authority for their ENTIRE enable/work/restore sequence.
// `page exec`'s focus scope has its two-caller proof in page-exec.test.ts;
// these are the matching proofs for the other two scopes on a recorder-held
// connection: the viewport scope (setDeviceMetricsOverride→capture→clear,
// src/cdp/screenshot.ts) and the AX scope (enable→read→disable,
// src/cdp/a11y.ts). Same shape as the focus test: real `acquirePrivateLock`
// through the production path, event-ordered barriers, no wall-clock races.
// Each scope also proves the dual-failure contract UNDER the lock — primary
// plus cleanup failure facts are both retained, and the failing caller
// releases the scope so the next caller proceeds.

import { captureScreenshot } from '../src/cdp/screenshot.js';
import { readFullAXTree } from '../src/cdp/a11y.js';
import { __setScopeSerializationDepsForTest } from '../src/cdp/scope-lock.js';
import { CAPTURE_ROOT } from '../src/session/artifacts.js';
import { CaptureError } from '../src/errors.js';
import type { ActiveSessionState } from '../src/session-context.js';
import type { CDPClient } from '../src/cdp/client.js';

// A tiny 1x1 PNG payload, base64-encoded like Page.captureScreenshot returns.
const PNG_BASE64 =
  'iVBORw0KGgoAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function makeFakeSession(tag: string): ActiveSessionState {
  const sessionId = `sess-scope-${tag}-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    sessionId,
    dir: path.join(CAPTURE_ROOT, sessionId),
    harId: null,
    targetId: 'tab-1',
    stepCount: 0,
  };
}

interface LogEntry {
  who: string;
  method: string;
}

type Handlers = Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>;

function loggedClient(who: string, log: LogEntry[], handlers: Handlers): CDPClient {
  return {
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      log.push({ who, method });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected CDP call in test stub: ${who}:${method}`);
      return handler(params);
    },
  } as unknown as CDPClient;
}

const fmt = (log: LogEntry[]) => log.map((e) => `${e.who}:${e.method}`);

/** Installs the held/session seams and a real session dir; returns teardown. */
function installHeldScope(tag: string): { session: ActiveSessionState; teardown: () => void } {
  const session = makeFakeSession(tag);
  fs.mkdirSync(session.dir, { recursive: true, mode: 0o700 }); // lock parent must exist
  const restore = __setScopeSerializationDepsForTest({
    isRecorderHeldClient: () => true,
    getActiveSession: () => session,
  });
  return {
    session,
    teardown: () => {
      restore();
      fs.rmSync(session.dir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Viewport scope — setDeviceMetricsOverride → capture → clear
// ---------------------------------------------------------------------------

test('viewport scope: two held-recorder callers serialize the whole override scope via the session lock (A2)', async () => {
  const { teardown } = installHeldScope('vp');
  const log: LogEntry[] = [];

  let releaseAGate!: () => void;
  const aGate = new Promise<void>((resolve) => {
    releaseAGate = resolve;
  });
  let signalAReached!: () => void;
  const aReached = new Promise<void>((resolve) => {
    signalAReached = resolve;
  });

  const handlersFor = (who: string): Handlers => ({
    'Emulation.setDeviceMetricsOverride': () => ({}),
    'Page.getLayoutMetrics': () => ({
      cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 0 },
    }),
    'Runtime.evaluate': () => ({ result: { value: 1 } }),
    'Page.captureScreenshot': async () => {
      if (who === 'A') {
        signalAReached(); // A has entered its held scope
        await aGate; // and holds it open until the test releases the gate
      }
      return { data: PNG_BASE64 };
    },
    'Emulation.clearDeviceMetricsOverride': () => ({}),
  });
  const clientA = loggedClient('A', log, handlersFor('A'));
  const clientB = loggedClient('B', log, handlersFor('B'));

  try {
    const capA = captureScreenshot(clientA, { width: 800, height: 600 });
    await aReached; // A now holds the viewport scope, override live
    const capB = captureScreenshot(clientB, { width: 400, height: 300 });
    // Give B several event-loop turns to attempt (and block on) the lock.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    // While A holds the scope, B has made ZERO CDP calls — in particular B
    // has not cleared A's live device-metrics override.
    assert.deepEqual(fmt(log), [
      'A:Emulation.setDeviceMetricsOverride',
      'A:Page.getLayoutMetrics',
      'A:Runtime.evaluate',
      'A:Page.captureScreenshot',
    ]);
    releaseAGate();
    await capA;
    await capB;
    // Full order: A's complete scope (through its clear), then B's — never
    // interleaved.
    assert.deepEqual(fmt(log), [
      'A:Emulation.setDeviceMetricsOverride',
      'A:Page.getLayoutMetrics',
      'A:Runtime.evaluate',
      'A:Page.captureScreenshot',
      'A:Emulation.clearDeviceMetricsOverride',
      'B:Emulation.setDeviceMetricsOverride',
      'B:Page.getLayoutMetrics',
      'B:Runtime.evaluate',
      'B:Page.captureScreenshot',
      'B:Emulation.clearDeviceMetricsOverride',
    ]);
  } finally {
    teardown();
  }
});

test('viewport scope: a primary+clear dual failure under the lock retains both facts and releases the scope', async () => {
  const { teardown } = installHeldScope('vpfail');
  const log: LogEntry[] = [];

  const failing = loggedClient('A', log, {
    'Emulation.setDeviceMetricsOverride': () => ({}),
    'Page.getLayoutMetrics': () => ({
      cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 0 },
    }),
    'Runtime.evaluate': () => ({ result: { value: 1 } }),
    'Page.captureScreenshot': () => {
      throw new Error('primary boom');
    },
    'Emulation.clearDeviceMetricsOverride': () => {
      throw new Error('cleanup boom');
    },
  });

  try {
    let thrown: unknown;
    try {
      await captureScreenshot(failing, { width: 800, height: 600 });
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown instanceof AggregateError, 'a primary+clear dual failure is an AggregateError');
    assert.equal((thrown as AggregateError).errors.length, 2);
    assert.equal(((thrown as AggregateError).errors[0] as Error).message, 'primary boom');
    assert.equal(((thrown as AggregateError).errors[1] as Error).message, 'cleanup boom');

    // The failing caller released the scope: the next caller acquires the
    // same lock and completes its whole scope.
    const clean = loggedClient('B', log, {
      'Emulation.setDeviceMetricsOverride': () => ({}),
      'Page.getLayoutMetrics': () => ({
        cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 0 },
      }),
      'Runtime.evaluate': () => ({ result: { value: 1 } }),
      'Page.captureScreenshot': () => ({ data: PNG_BASE64 }),
      'Emulation.clearDeviceMetricsOverride': () => ({}),
    });
    const png = await captureScreenshot(clean, { width: 800, height: 600 });
    assert.ok(Buffer.isBuffer(png) && png.length > 0, 'the next caller proceeds after the failure');
  } finally {
    teardown();
  }
});

// ---------------------------------------------------------------------------
// AX scope — Accessibility.enable → getFullAXTree → disable
// ---------------------------------------------------------------------------

const AX_NODES = { nodes: [{ nodeId: '1', role: { value: 'RootWebArea' }, name: { value: '' } }] };

test('AX scope: two held-recorder callers serialize the whole enable/read/disable scope via the session lock (A2)', async () => {
  const { teardown } = installHeldScope('ax');
  const log: LogEntry[] = [];

  let releaseAGate!: () => void;
  const aGate = new Promise<void>((resolve) => {
    releaseAGate = resolve;
  });
  let signalAReached!: () => void;
  const aReached = new Promise<void>((resolve) => {
    signalAReached = resolve;
  });

  const handlersFor = (who: string): Handlers => ({
    'Accessibility.enable': () => ({}),
    'Accessibility.getFullAXTree': async () => {
      if (who === 'A') {
        signalAReached(); // A has entered its held scope
        await aGate; // and holds it open until the test releases the gate
      }
      return AX_NODES;
    },
    'Accessibility.disable': () => ({}),
  });
  const clientA = loggedClient('A', log, handlersFor('A'));
  const clientB = loggedClient('B', log, handlersFor('B'));

  try {
    const readA = readFullAXTree(clientA);
    await aReached; // A now holds the AX scope, domain enabled mid-read
    const readB = readFullAXTree(clientB);
    // Give B several event-loop turns to attempt (and block on) the lock.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    // While A holds the scope, B has made ZERO CDP calls — in particular B
    // has not disabled the Accessibility domain under A's live read.
    assert.deepEqual(fmt(log), ['A:Accessibility.enable', 'A:Accessibility.getFullAXTree']);
    releaseAGate();
    await readA;
    await readB;
    // Full order: A's complete scope (through its disable), then B's —
    // never interleaved.
    assert.deepEqual(fmt(log), [
      'A:Accessibility.enable',
      'A:Accessibility.getFullAXTree',
      'A:Accessibility.disable',
      'B:Accessibility.enable',
      'B:Accessibility.getFullAXTree',
      'B:Accessibility.disable',
    ]);
  } finally {
    teardown();
  }
});

test('AX scope: a primary+disable dual failure under the lock retains both facts and releases the scope', async () => {
  const { teardown } = installHeldScope('axfail');
  const log: LogEntry[] = [];

  const failing = loggedClient('A', log, {
    'Accessibility.enable': () => ({}),
    'Accessibility.getFullAXTree': () => {
      throw new Error('primary boom');
    },
    'Accessibility.disable': () => {
      throw new Error('cleanup boom');
    },
  });

  try {
    let thrown: unknown;
    try {
      await readFullAXTree(failing);
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown instanceof AggregateError, 'a primary+disable dual failure is an AggregateError');
    assert.equal((thrown as AggregateError).errors.length, 2);
    assert.equal(((thrown as AggregateError).errors[0] as Error).message, 'primary boom');
    const cleanup = (thrown as AggregateError).errors[1];
    assert.ok(cleanup instanceof CaptureError, 'the disable failure is the typed cleanup error');
    assert.equal((cleanup as CaptureError).descriptor.code, 'accessibility_cleanup_failed');

    // The failing caller released the scope: the next caller acquires the
    // same lock and completes its whole scope.
    const clean = loggedClient('B', log, {
      'Accessibility.enable': () => ({}),
      'Accessibility.getFullAXTree': () => AX_NODES,
      'Accessibility.disable': () => ({}),
    });
    const nodes = await readFullAXTree(clean);
    assert.equal(nodes.length, 1, 'the next caller proceeds after the failure');
  } finally {
    teardown();
  }
});
