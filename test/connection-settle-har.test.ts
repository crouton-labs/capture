import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// U08: the action-specific settle/HAR lifecycle (`withPageAction`), strict A2
// recorder routing, and lazy `{targetId, port}` endpoint publication in
// `connection.ts`.
//
// Every timing assertion runs against an injected monotonic clock and injected
// `sleep` — there are ZERO wall-time waits and ZERO tolerances. An ordered
// event log records exactly the connect/callback/settle/HAR-append landmarks
// the lifecycle contract commits to, so call order is asserted directly.

import {
  connectForCommand,
  withPageAction,
  __setConnectionSeamsForTest,
  type ConnectionSeams,
} from '../src/cdp/connection.js';
import { CaptureError } from '../src/errors.js';
import { createHarRecording } from '../src/har-manager.js';
import { CAPTURE_ROOT } from '../src/session/artifacts.js';
import { RecorderHeldClient, isRecorderHeldClient } from '../src/cdp/recorder-client.js';
import { recDirFor } from '../src/cdp/motion/recorder.js';
import type { ParsedArgs, CDPTarget } from '../src/cdp/types.js';
import type { ActiveSessionState } from '../src/session-context.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** A CDP client stub that answers exactly the calls the collectors make and
 * lets a test fire synthetic Network/Runtime events into the handlers the
 * recorders registered — so a single valid HAR lifecycle can be materialized
 * deterministically, with no real socket. */
function makeStubClient(): CDPClientStub {
  const handlers = new Map<string, Array<(params: unknown) => void>>();
  return {
    async waitReady() {},
    on(event: string, cb: (params: unknown) => void) {
      const arr = handlers.get(event) ?? [];
      arr.push(cb);
      handlers.set(event, arr);
    },
    onDisconnect() {},
    async send(method: string) {
      if (method === 'Network.getResponseBody') return { body: '', base64Encoded: false };
      return {};
    },
    close() {},
    fire(event: string, params: unknown) {
      for (const cb of handlers.get(event) ?? []) cb(params);
    },
  };
}

interface CDPClientStub {
  waitReady(): Promise<void>;
  on(event: string, cb: (params: unknown) => void): void;
  onDisconnect(): void;
  send(method: string): Promise<unknown>;
  close(): void;
  fire(event: string, params: unknown): void;
}

/** Fires one complete, clock-valid request/response/loadingFinished lifecycle
 * through the recorders' registered handlers, so `HARRecorder.finish()` yields
 * exactly one entry and the local-HAR append actually runs. */
function fireOneHarLifecycle(client: CDPClientStub): void {
  client.fire('Network.requestWillBeSent', {
    requestId: 'r1',
    request: { method: 'GET', url: 'https://fixture.test/', headers: {} },
    timestamp: 1,
    wallTime: 1000,
  });
  client.fire('Network.responseReceived', {
    requestId: 'r1',
    response: { url: 'https://fixture.test/', status: 200, headers: {} },
    timestamp: 2,
  });
  client.fire('Network.loadingFinished', {
    requestId: 'r1',
    timestamp: 3,
    encodedDataLength: 0,
  });
}

const FAKE_TAB: CDPTarget = {
  id: 'tab-new',
  title: '',
  url: 'https://fixture.test/',
  type: 'page',
  webSocketDebuggerUrl: 'ws://127.0.0.1:9223/devtools/page/tab-new',
};

interface Harness {
  log: string[];
  appendCalls: unknown[];
  updatePatches: Array<Partial<ActiveSessionState>>;
  client: CDPClientStub;
  restore: () => void;
}

/** Installs a fully deterministic seam set: a fake monotonic clock, a logging
 * `sleep`, a spy `appendHar`, a spy `updateActiveSession`, and a stub
 * `createClient`. `overrides` layer on top (session, resolveTab, a specific
 * client). Returns the ordered event log plus the spy captures. */
function installSeams(overrides: Partial<ConnectionSeams> = {}, client = makeStubClient()): Harness {
  const log: string[] = [];
  const appendCalls: unknown[] = [];
  const updatePatches: Array<Partial<ActiveSessionState>> = [];
  let clock = 0;

  const seams: Partial<ConnectionSeams> = {
    getActiveSession: () => null,
    resolveTab: async () => ({ port: 9223, tab: FAKE_TAB }),
    createClient: () => {
      log.push('connect');
      return client as never;
    },
    updateActiveSession: async (patch) => {
      updatePatches.push(patch);
      return null;
    },
    appendHar: (async (_id: string, batch: unknown) => {
      log.push('append');
      appendCalls.push(batch);
    }) as never,
    flushRecorderHar: async () => {
      log.push('har-flush');
    },
    now: () => clock,
    sleep: async (ms: number) => {
      log.push(`sleep:${ms}`);
      clock += ms;
    },
    ...overrides,
  };

  const restore = __setConnectionSeamsForTest(seams);
  return { log, appendCalls, updatePatches, client, restore };
}

function parsedFor(flags: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command: 'click', positional: [], target: 'tab-new', ...flags } as ParsedArgs;
}

function sessionState(overrides: Partial<ActiveSessionState>): ActiveSessionState {
  return {
    sessionId: 'sess-u08',
    dir: '/tmp/does-not-matter',
    harId: null,
    targetId: 'tab-new',
    stepCount: 0,
    ...overrides,
  };
}

/** A valid, mutable temp session dir for recorder.json fixtures. */
function makeTempSessionDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'u08-sess-'));
}

function writeRecorderJson(sessionDir: string, recId: string, body: unknown): void {
  const recDir = recDirFor(sessionDir, recId);
  fs.mkdirSync(recDir, { recursive: true });
  fs.writeFileSync(path.join(recDir, 'recorder.json'), typeof body === 'string' ? body : JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// withPageAction — settle/HAR ordering
// ---------------------------------------------------------------------------

test('withPageAction: ordinary + local HAR runs connect → callback → settle → HAR append → result, in order', async () => {
  const rec = await createHarRecording(path.join(CAPTURE_ROOT, 'u08-har'));
  const h = installSeams();
  try {
    const { result, settle } = await withPageAction(
      parsedFor({ har: rec.id }),
      { settleMs: 2500 },
      async (client) => {
        h.log.push('callback');
        fireOneHarLifecycle(client as unknown as CDPClientStub);
        return 'ok';
      },
    );
    // Exact order: the settle window elapses BEFORE the local HAR is drained.
    assert.deepEqual(h.log, ['connect', 'callback', 'sleep:2500', 'append']);
    assert.equal(h.appendCalls.length, 1);
    assert.equal(result, 'ok');
    assert.deepEqual(settle, { requestedMs: 2500, waitedMs: 2500, completed: true });
  } finally {
    h.restore();
    fs.rmSync(rec.path, { force: true });
  }
});

test('withPageAction: ordinary no-HAR settles but never appends', async () => {
  const h = installSeams();
  try {
    const { settle } = await withPageAction(parsedFor(), { settleMs: 2500 }, async () => {
      h.log.push('callback');
      return 1;
    });
    assert.deepEqual(h.log, ['connect', 'callback', 'sleep:2500']);
    assert.equal(h.appendCalls.length, 0);
    assert.deepEqual(settle, { requestedMs: 2500, waitedMs: 2500, completed: true });
  } finally {
    h.restore();
  }
});

test('withPageAction: zero settle skips the sleep but reports a measured zero wait, order intact', async () => {
  const h = installSeams();
  try {
    const { settle } = await withPageAction(parsedFor(), { settleMs: 0 }, async () => {
      h.log.push('callback');
      return 1;
    });
    // No sleep landmark — the settle window was zero, and that fact is measured, not faked.
    assert.deepEqual(h.log, ['connect', 'callback']);
    assert.deepEqual(settle, { requestedMs: 0, waitedMs: 0, completed: true });
  } finally {
    h.restore();
  }
});

test('withPageAction: a callback failure claims no settle and never appends', async () => {
  const rec = await createHarRecording(path.join(CAPTURE_ROOT, 'u08-har'));
  const h = installSeams();
  try {
    await assert.rejects(
      withPageAction(parsedFor({ har: rec.id }), { settleMs: 2500 }, async () => {
        h.log.push('callback');
        throw new Error('the action itself failed');
      }),
      /the action itself failed/,
    );
    // The action failed, so there is NO settle to claim and NO HAR to drain.
    assert.deepEqual(h.log, ['connect', 'callback']);
    assert.equal(h.appendCalls.length, 0);
  } finally {
    h.restore();
    fs.rmSync(rec.path, { force: true });
  }
});

test('withPageAction: a recorder-routed action starts no local collectors but still settles', async () => {
  const sessionDir = makeTempSessionDir();
  writeRecorderJson(sessionDir, 'rec-live', {
    recId: 'rec-live',
    pid: process.pid,
    socketPath: path.join(sessionDir, 'rec.sock'),
    targetId: 'tab-rec',
    url: null,
    nonce: 'a'.repeat(64),
    startedAt: new Date().toISOString(),
    state: 'recording',
    markers: {},
  });
  const createSpy: string[] = [];
  const h = installSeams({
    getActiveSession: () => sessionState({ dir: sessionDir, activeRecId: 'rec-live' }),
    createClient: () => {
      createSpy.push('direct');
      return makeStubClient() as never;
    },
  });
  try {
    const { result, settle } = await withPageAction(
      parsedFor({ target: undefined }),
      { settleMs: 2500 },
      async (client) => {
        // A routed client is the recorder-held adapter, not a fresh direct client.
        assert.ok(isRecorderHeldClient(client), 'routed action must use the recorder-held client');
        h.log.push('callback');
        return 'routed';
      },
    );
    assert.equal(result, 'routed');
    // Settle still runs, then the recorder's har-flush health barrier fires
    // BEFORE success output; no direct client was created and no local HAR
    // appended (the routed action's traffic lives in the session HAR).
    assert.deepEqual(h.log, ['callback', 'sleep:2500', 'har-flush']);
    assert.equal(createSpy.length, 0, 'routed lane must not open a direct connection');
    assert.equal(h.appendCalls.length, 0);
    assert.deepEqual(settle, { requestedMs: 2500, waitedMs: 2500, completed: true });
  } finally {
    h.restore();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Strict A2 routing — recorder_unavailable, never a silent direct fallback
// ---------------------------------------------------------------------------

test('connectForCommand: a claimed-but-unusable recorder is recorder_unavailable, never a direct fallback', async () => {
  const sessionDir = makeTempSessionDir();
  const cases: Array<{ name: string; write: () => void }> = [
    { name: 'absent handle', write: () => {} },
    { name: 'malformed JSON', write: () => writeRecorderJson(sessionDir, 'rec-x', 'not json at all') },
    {
      name: 'missing socketPath field',
      write: () =>
        writeRecorderJson(sessionDir, 'rec-x', {
          recId: 'rec-x',
          pid: process.pid,
          targetId: 'tab-rec',
          url: null,
          startedAt: new Date().toISOString(),
          state: 'recording',
          markers: {},
        }),
    },
    {
      name: 'finalized (wrong state)',
      write: () =>
        writeRecorderJson(sessionDir, 'rec-x', {
          recId: 'rec-x',
          pid: process.pid,
          socketPath: path.join(sessionDir, 'rec.sock'),
          targetId: 'tab-rec',
          url: null,
          startedAt: new Date().toISOString(),
          state: 'finalized',
          markers: {},
        }),
    },
  ];

  for (const c of cases) {
    fs.rmSync(recDirFor(sessionDir, 'rec-x'), { recursive: true, force: true });
    c.write();
    const resolveSpy: string[] = [];
    const h = installSeams({
      getActiveSession: () => sessionState({ dir: sessionDir, activeRecId: 'rec-x' }),
      resolveTab: async () => {
        resolveSpy.push('resolved');
        return { port: 9223, tab: FAKE_TAB };
      },
    });
    try {
      await assert.rejects(
        // No --target/--url divert, so this command MUST route through the recorder.
        connectForCommand(parsedFor({ target: undefined })),
        (err: unknown) => {
          assert.ok(err instanceof CaptureError, `${c.name}: must throw a typed CaptureError`);
          assert.equal(err.descriptor.code, 'recorder_unavailable', `${c.name}: code`);
          return true;
        },
      );
      // Proof it never fell through to a direct connection.
      assert.equal(resolveSpy.length, 0, `${c.name}: must not resolve a direct tab`);
    } finally {
      h.restore();
    }
  }
  fs.rmSync(sessionDir, { recursive: true, force: true });
});

test('connectForCommand: direct CDP is allowed when there is no active recording, or an explicit distinct target diverts', async () => {
  // (a) No active recording, no target/url → the direct lane's own invocation
  // error, NOT recorder_unavailable.
  {
    const h = installSeams({ getActiveSession: () => null });
    try {
      await assert.rejects(connectForCommand(parsedFor({ target: undefined })), (err: unknown) => {
        assert.ok(err instanceof CaptureError, 'no-recording direct lane is a typed invocation error');
        assert.equal(err.descriptor.kind, 'invocation');
        assert.equal(err.descriptor.code, 'missing_target');
        assert.match(err.message, /Use --target/);
        return true;
      });
    } finally {
      h.restore();
    }
  }
  // (b) An active recording, but an explicit --target naming a DIFFERENT tab →
  // the caller diverted, so the direct lane resolves that tab (no throw).
  {
    const sessionDir = makeTempSessionDir();
    const resolveSpy: string[] = [];
    const h = installSeams({
      getActiveSession: () => sessionState({ dir: sessionDir, targetId: 'tab-recorder', activeRecId: 'rec-live' }),
      resolveTab: async () => {
        resolveSpy.push('resolved');
        return { port: 9223, tab: FAKE_TAB };
      },
    });
    try {
      const { client } = await connectForCommand(parsedFor({ target: 'tab-other' }));
      assert.ok(!isRecorderHeldClient(client), 'a diverted target uses a direct client');
      assert.equal(resolveSpy.length, 1, 'the diverted target resolved through the direct lane');
    } finally {
      h.restore();
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// Lazy endpoint publication — atomic {targetId, port}, never stale env
// ---------------------------------------------------------------------------

test('connectForCommand: lazily publishes {targetId, port} as one atomic patch from the resolved endpoint, ignoring env', async () => {
  const prevEnv = process.env.CDP_PORT;
  process.env.CDP_PORT = 'garbage-not-a-port';
  const sessionDir = makeTempSessionDir();
  const h = installSeams({
    // Session exists with NO targetId yet → the lazy publish fires.
    getActiveSession: () => sessionState({ dir: sessionDir, targetId: null }),
    resolveTab: async () => ({ port: 9223, tab: FAKE_TAB }),
  });
  try {
    await connectForCommand(parsedFor({ target: 'tab-new' }));
    assert.equal(h.updatePatches.length, 1, 'exactly one metadata patch');
    // Both fields, together, from the RESOLVED port — never the garbage env.
    assert.deepEqual(h.updatePatches[0], { targetId: 'tab-new', port: 9223 });
  } finally {
    h.restore();
    fs.rmSync(sessionDir, { recursive: true, force: true });
    if (prevEnv === undefined) delete process.env.CDP_PORT;
    else process.env.CDP_PORT = prevEnv;
  }
});
