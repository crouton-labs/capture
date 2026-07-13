/**
 * U10 — truthful session-held network emulation (`capture tab network`).
 *
 * `tab network` is a session-hold-only leaf: it emulates on the active
 * session's own target through the live `session start --hold` bridge, and
 * nothing else. These tests drive the production seam in-process with a fake
 * NDJSON bridge server so they can prove the two invariants the plan requires:
 *
 *  - every rejected precondition (no session, no target, no held bridge,
 *    explicit target/port mismatch, --url, bad mode) sends ZERO bridge
 *    requests and fails with a structured CaptureError; and
 *  - an accepted call sends `Network.enable` then
 *    `Network.emulateNetworkConditions` through the exact held socket/target,
 *    both protocol operations must succeed, and offline→online reuse the same
 *    owner/socket/target.
 *
 * The command emits exactly `buildNetworkResult(mode, target)`, so the
 * truthful `session-hold` ownership and lifetime of its rendered output are
 * proven by the pure builder test above; the integration tests assert the
 * bridge traffic and let the command render to real stdout (node:test
 * tolerates that, but reassigning `process.stdout.write` to capture it races
 * this file's net-server handles and corrupts the TAP reporter).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import net from 'node:net';

import { cmdTabNetwork, buildNetworkResult } from '../src/cdp/commands/tab/network.js';
import { CaptureError } from '../src/errors.js';
import { renderResult } from '../src/output/render.js';
import {
  clearActiveSession,
  getActiveSession,
  setActiveSession,
  type ActiveSessionState,
} from '../src/session-context.js';
import { CAPTURE_ROOT } from '../src/session/artifacts.js';
import type { ParsedArgs } from '../src/cdp/types.js';

process.env.CRTR_NODE_ID = `u10-network-${process.pid}-${Date.now()}`;

const TARGET = 'CAFE0123456789ABCDEF0123456789AB';
const PORT = 9222;

let counter = 0;

interface FakeBridge {
  socketPath: string;
  readonly requests: { method?: string; targetId?: string; params?: Record<string, unknown> }[];
  readonly connections: number;
  close(): Promise<void>;
}

/** A minimal held-bridge stand-in: one NDJSON request per connection, one
 * response, mirroring `src/cdp/bridge/server.ts`. Records every connection so
 * a test can assert zero sends on a rejected precondition. */
async function fakeBridge(socketPath: string, opts: { failMethod?: string } = {}): Promise<FakeBridge> {
  const requests: FakeBridge['requests'] = [];
  let connections = 0;
  const server = net.createServer((sock) => {
    connections += 1;
    let buffer = '';
    sock.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const idx = buffer.indexOf('\n');
      if (idx < 0) return;
      const req = JSON.parse(buffer.slice(0, idx)) as { reqId: number; method?: string; targetId?: string; params?: Record<string, unknown> };
      requests.push({ method: req.method, targetId: req.targetId, params: req.params });
      const fail = opts.failMethod !== undefined && req.method === opts.failMethod;
      const resp = fail
        ? { reqId: req.reqId, ok: false, error: 'boom' }
        : { reqId: req.reqId, ok: true, result: {} };
      sock.write(`${JSON.stringify(resp)}\n`);
      sock.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => { server.off('error', reject); resolve(); });
  });
  return {
    socketPath,
    requests,
    get connections() { return connections; },
    close() { return new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}

interface Fixture {
  dir: string;
  state: ActiveSessionState;
  socketPath: string;
}

/** Publishes a live held session (with a real bound socket unless
 * `bridge:false`) as the active session for this scope. */
async function makeSession(overrides: Partial<ActiveSessionState> = {}, opts: { bridge?: boolean } = {}): Promise<Fixture> {
  const n = counter++;
  const id = `net-${process.pid}-${n}`;
  const dir = path.join(CAPTURE_ROOT, id);
  // Keep the AF_UNIX path short (macOS caps it at ~104 bytes); the leaf only
  // reads/connects the socket, it is not required to live under the root.
  const socketPath = path.join(os.tmpdir(), `u10-${process.pid}-${n}.sock`);
  const state: ActiveSessionState = {
    sessionId: id,
    dir,
    harId: null,
    targetId: TARGET,
    stepCount: 0,
    port: PORT,
    bridgeSocket: opts.bridge === false ? null : socketPath,
    bridgePid: 4242,
    ...overrides,
  };
  await setActiveSession(state);
  return { dir, state, socketPath };
}

function parsedArgs(positional: string[], extra: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command: 'tab', positional, json: false, ...extra } as ParsedArgs;
}

function cleanup(...dirs: string[]): void {
  clearActiveSession();
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Pure builder — truthful owner + lifetime, no over-promised persistence
// ---------------------------------------------------------------------------

test('buildNetworkResult: reports session-hold owner and a lifetime bounded by online/session-stop', () => {
  const offline = renderResult(buildNetworkResult('offline', TARGET));
  assert.ok(offline.startsWith('<network '), offline);
  assert.ok(offline.includes('mode="offline"'), offline);
  assert.ok(offline.includes('owner="session-hold"'), offline);
  assert.ok(offline.includes(`target="${TARGET}"`), offline);
  // Lifetime is stated as the held owner's lifetime, never broader persistence.
  assert.ok(offline.includes('until `capture tab network online` or the session stops'), offline);
  assert.ok(!/persist|permanent|forever/i.test(offline), offline);
  assert.ok(offline.includes('follow_up: capture tab network online'), offline);

  const online = renderResult(buildNetworkResult('online', TARGET));
  assert.ok(online.includes('mode="online"'), online);
  assert.ok(online.includes('owner="session-hold"'), online);
  assert.ok(online.includes('connectivity restored'), online);
  assert.ok(!online.includes('follow_up:'), online);
});

// ---------------------------------------------------------------------------
// Rejected preconditions — every one sends ZERO bridge requests
// ---------------------------------------------------------------------------

test('bad mode is a structured invalid_argument naming offline|online, and sends nothing', async () => {
  const { dir, socketPath } = await makeSession();
  const bridge = await fakeBridge(socketPath);
  try {
    await assert.rejects(
      cmdTabNetwork(parsedArgs(['bogus']), []),
      (err: unknown) => err instanceof CaptureError && err.descriptor.kind === 'invocation' && err.descriptor.code === 'invalid_argument' && /offline\|online/.test(err.message),
    );
    assert.equal(bridge.connections, 0);
  } finally { await bridge.close(); cleanup(dir); }
});

test('--url is rejected as unsupported before any session/bridge effect', async () => {
  const { dir, socketPath } = await makeSession();
  const bridge = await fakeBridge(socketPath);
  try {
    await assert.rejects(
      cmdTabNetwork(parsedArgs(['offline'], { url: 'https://example.test/' }), []),
      (err: unknown) => err instanceof CaptureError && err.descriptor.kind === 'invocation' && err.descriptor.code === 'unsupported_flag',
    );
    assert.equal(bridge.connections, 0);
  } finally { await bridge.close(); cleanup(dir); }
});

test('no active session rejects with no_active_session and sends nothing', async () => {
  clearActiveSession();
  assert.equal(getActiveSession(), null);
  await assert.rejects(
    cmdTabNetwork(parsedArgs(['offline']), []),
    (err: unknown) => err instanceof CaptureError && err.descriptor.kind === 'precondition' && err.descriptor.code === 'no_active_session',
  );
});

test('a session with no target rejects with session_target_missing, sends nothing', async () => {
  const { dir, socketPath } = await makeSession({ targetId: null });
  const bridge = await fakeBridge(socketPath);
  try {
    await assert.rejects(
      cmdTabNetwork(parsedArgs(['offline']), []),
      (err: unknown) => err instanceof CaptureError && err.descriptor.code === 'session_target_missing',
    );
    assert.equal(bridge.connections, 0);
  } finally { await bridge.close(); cleanup(dir); }
});

test('a session with no held bridge socket rejects with no_held_bridge, sends nothing', async () => {
  const { dir } = await makeSession({}, { bridge: false });
  await assert.rejects(
    cmdTabNetwork(parsedArgs(['offline']), []),
    (err: unknown) => err instanceof CaptureError && err.descriptor.code === 'no_held_bridge',
  );
  cleanup(dir);
});

test('a session whose bridge socket no longer exists rejects with no_held_bridge, sends nothing', async () => {
  // Never bind the socket — the path is set on the session but absent on disk.
  const { dir } = await makeSession();
  await assert.rejects(
    cmdTabNetwork(parsedArgs(['offline']), []),
    (err: unknown) => err instanceof CaptureError && err.descriptor.code === 'no_held_bridge',
  );
  cleanup(dir);
});

test('an explicit --target unequal to the session target rejects before any send (A2)', async () => {
  const { dir, socketPath } = await makeSession();
  const bridge = await fakeBridge(socketPath);
  try {
    await assert.rejects(
      cmdTabNetwork(parsedArgs(['offline'], { target: 'DEADBEEF00000000DEADBEEF00000000' }), []),
      (err: unknown) => err instanceof CaptureError && err.descriptor.code === 'target_mismatch',
    );
    assert.equal(bridge.connections, 0);
  } finally { await bridge.close(); cleanup(dir); }
});

test('an explicit --port unequal to session.port rejects before any send (A4)', async () => {
  const { dir, socketPath } = await makeSession();
  const bridge = await fakeBridge(socketPath);
  try {
    await assert.rejects(
      cmdTabNetwork(parsedArgs(['offline'], { port: PORT + 1 }), []),
      (err: unknown) => err instanceof CaptureError && err.descriptor.code === 'port_mismatch',
    );
    assert.equal(bridge.connections, 0);
  } finally { await bridge.close(); cleanup(dir); }
});

// ---------------------------------------------------------------------------
// Accepted calls — exact bridge/target, both ops succeed, stable owner identity
// ---------------------------------------------------------------------------

test('offline sends Network.enable then emulate through the exact held socket/target', async () => {
  const { dir, socketPath, state } = await makeSession();
  const bridge = await fakeBridge(socketPath);
  try {
    await cmdTabNetwork(parsedArgs(['offline']), []);
    assert.equal(bridge.requests.length, 2);
    assert.deepEqual(bridge.requests.map((r) => r.method), ['Network.enable', 'Network.emulateNetworkConditions']);
    for (const req of bridge.requests) assert.equal(req.targetId, state.targetId);
    assert.equal(bridge.requests[1].params?.offline, true);
    // The command renders exactly buildNetworkResult(mode, target); its truthful
    // session-hold/lifetime output is asserted by the builder test above.
    assert.ok(renderResult(buildNetworkResult('offline', state.targetId!)).includes('owner="session-hold"'));
  } finally { await bridge.close(); cleanup(dir); }
});

test('an explicit --port/--target equal to the session is accepted and sends', async () => {
  const { dir, socketPath, state } = await makeSession();
  const bridge = await fakeBridge(socketPath);
  try {
    await cmdTabNetwork(parsedArgs(['offline'], { port: PORT, target: state.targetId! }), []);
    assert.equal(bridge.requests.length, 2);
  } finally { await bridge.close(); cleanup(dir); }
});

test('offline then online reuse the same owner socket and target', async () => {
  const { dir, socketPath, state } = await makeSession();
  const bridge = await fakeBridge(socketPath);
  try {
    await cmdTabNetwork(parsedArgs(['offline']), []);
    await cmdTabNetwork(parsedArgs(['online']), []);
    assert.equal(bridge.requests.length, 4);
    // Same held target across the full offline→online lifetime.
    for (const req of bridge.requests) assert.equal(req.targetId, state.targetId);
    assert.equal(bridge.requests[3].method, 'Network.emulateNetworkConditions');
    assert.equal(bridge.requests[3].params?.offline, false);
    const online = renderResult(buildNetworkResult('online', state.targetId!));
    assert.ok(online.includes('mode="online"') && online.includes('owner="session-hold"'));
    assert.ok(!online.includes('follow_up:'), online);
  } finally { await bridge.close(); cleanup(dir); }
});

// ---------------------------------------------------------------------------
// Bridge failure — structured error spine, both ops must succeed
// ---------------------------------------------------------------------------

test('a bridge protocol failure surfaces as a structured world/bridge_error', async () => {
  const { dir, socketPath } = await makeSession();
  const bridge = await fakeBridge(socketPath, { failMethod: 'Network.emulateNetworkConditions' });
  try {
    await assert.rejects(
      cmdTabNetwork(parsedArgs(['offline']), []),
      (err: unknown) => err instanceof CaptureError && err.descriptor.kind === 'world' && err.descriptor.code === 'bridge_error' && /emulateNetworkConditions/.test(err.message),
    );
    // enable was attempted; the second op's failure is what rejects.
    assert.equal(bridge.requests[0].method, 'Network.enable');
  } finally { await bridge.close(); cleanup(dir); }
});
