import { test } from 'node:test';
import assert from 'node:assert/strict';

// U21: `capture page navigate` direct (non-recorder) path — source-targeted,
// single-dispatch navigation with the load-event wait armed BEFORE the
// destination send and reported as its own factual outcome, separate from the
// method result. Everything runs against injected connection seams (stub
// resolveTab/createClient/now/sleep) and tiny navigate timers — ZERO real
// sockets, ZERO wall-clock waits.

import { __setConnectionSeamsForTest, type ConnectionSeams } from '../src/cdp/connection.js';
import { CaptureError } from '../src/errors.js';
import type { ParsedArgs, CDPTarget } from '../src/cdp/types.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface StubClient {
  waitReady(): Promise<void>;
  on(event: string, cb: (params: unknown, sessionId?: string) => void): void;
  off?(event: string, cb: (params: unknown) => void): void;
  onDisconnect(): void;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
  fire(event: string, params: unknown): void;
  sends: Array<{ method: string; params?: Record<string, unknown> }>;
}

/** A CDP client stub. `sendImpl` scripts the navigate-relevant calls
 * (`Page.enable`, `Page.navigate`); everything else (console/log enables the
 * collectors make) answers `{}`. `fire` pushes a synthetic event into the
 * handlers the EventBroker registered. */
function makeStubClient(
  sendImpl?: (client: StubClient, method: string, params?: Record<string, unknown>) => Promise<unknown> | unknown,
): StubClient {
  const handlers = new Map<string, Array<(params: unknown, sessionId?: string) => void>>();
  const client: StubClient = {
    sends: [],
    async waitReady() {},
    on(event, cb) {
      const arr = handlers.get(event) ?? [];
      arr.push(cb);
      handlers.set(event, arr);
    },
    off(event, cb) {
      const arr = handlers.get(event);
      if (arr) handlers.set(event, arr.filter((h) => h !== cb));
    },
    onDisconnect() {},
    async send(method, params) {
      client.sends.push({ method, params });
      if (sendImpl) return sendImpl(client, method, params);
      return {};
    },
    close() {},
    fire(event, params) {
      for (const cb of [...(handlers.get(event) ?? [])]) cb(params, undefined);
    },
  };
  return client;
}

function tab(id: string, url: string): CDPTarget {
  return { id, title: '', url, type: 'page', webSocketDebuggerUrl: `ws://127.0.0.1:9223/devtools/page/${id}` };
}

interface Harness {
  resolveTabCalls: ParsedArgs[];
  createdUrls: string[];
  client: StubClient;
  restoreSeams: () => void;
}

/** Installs deterministic connection seams: no active session, a spy
 * resolveTab returning `resolved`, and a createClient returning `client`.
 * `now`/`sleep` are stubbed so the wrapper's settle never touches wall time. */
function installSeams(
  client: StubClient,
  resolved: { port: number; tab: CDPTarget } | null,
): Harness {
  const resolveTabCalls: ParsedArgs[] = [];
  const createdUrls: string[] = [];
  let clock = 0;
  const seams: Partial<ConnectionSeams> = {
    getActiveSession: () => null,
    resolveTab: async (parsed) => {
      resolveTabCalls.push(parsed);
      return resolved;
    },
    createClient: (wsUrl) => {
      createdUrls.push(wsUrl);
      return client as never;
    },
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
  };
  const restoreSeams = __setConnectionSeamsForTest(seams);
  return { resolveTabCalls, createdUrls, client, restoreSeams };
}

function parsedFor(flags: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command: 'page', positional: [], settle: 0, json: true, ...flags } as ParsedArgs;
}

/** Tees process.stdout.write and returns the emitted JSON result chunk. */
async function captureEmittedJson(fn: () => Promise<void>): Promise<{ tag: string; attrs: Record<string, unknown>; sections?: string[] }> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  const resultChunk = chunks.find((c) => c.trimStart().startsWith('{'));
  assert.ok(resultChunk, `expected one emitted JSON result chunk on stdout; got: ${JSON.stringify(chunks)}`);
  return JSON.parse(resultChunk);
}

function navigateSends(client: StubClient): Array<{ method: string; params?: Record<string, unknown> }> {
  return client.sends.filter((s) => s.method === 'Page.navigate');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('direct navigate resolves the SOURCE tab via --url and observes a synchronous Page.loadEventFired (arm-before-send)', async () => {
  const client = makeStubClient((c, method) => {
    if (method === 'Page.navigate') {
      // The load event fires synchronously, DURING the send, before its
      // response resolves — only an arm-before-send wait can observe it.
      c.fire('Page.loadEventFired', { frameId: 'main' });
      return { loaderId: 'L1' };
    }
    return {};
  });
  const h = installSeams(client, { port: 9223, tab: tab('tab-A', 'https://a.test/') });
  const { __setNavigateTimingForTest, cmdPageNavigate } = await import('../src/cdp/commands/page/navigate.js');
  const restoreTiming = __setNavigateTimingForTest({ innerTimeoutMs: 30, outerDeadlineMs: 500 });
  try {
    const output = await captureEmittedJson(() =>
      cmdPageNavigate(parsedFor({ positional: ['https://a.test/dest'], url: 'a.test' }), []),
    );
    assert.equal(output.tag, 'navigated');
    assert.equal(
      output.attrs.url,
      'https://a.test/dest',
      'the rendered url is the DESTINATION, not the source tab\'s pre-navigation URL (https://a.test/)',
    );
    assert.equal(output.attrs['load-outcome'], 'observed', 'a synchronous load event must be observed via the pre-armed wait');
    assert.equal(output.attrs['deadline-exceeded'], undefined);
    assert.equal(output.attrs.routed, undefined, 'the direct path is not routed');

    assert.equal(h.resolveTabCalls.length, 1, 'the SOURCE tab is resolved through ordinary page targeting');
    assert.equal(h.resolveTabCalls[0].url, 'a.test');
    assert.equal(h.createdUrls.length, 1, 'exactly one client is created (the resolved source); no other tab is touched');
    const navs = navigateSends(client);
    assert.equal(navs.length, 1, 'a cross-document nav with loaderId present dispatches exactly one Page.navigate');
    assert.equal(navs[0].params?.url, 'https://a.test/dest');
  } finally {
    restoreTiming();
    h.restoreSeams();
  }
});

test('direct navigate reports load-outcome=bounded-timeout when the load event never fires, retaining the loaderId and NOT redispatching', async () => {
  const client = makeStubClient((_c, method) => (method === 'Page.navigate' ? { loaderId: 'L1' } : {}));
  const h = installSeams(client, { port: 9223, tab: tab('tab-A', 'https://a.test/') });
  const { __setNavigateTimingForTest, cmdPageNavigate } = await import('../src/cdp/commands/page/navigate.js');
  const restoreTiming = __setNavigateTimingForTest({ innerTimeoutMs: 20, outerDeadlineMs: 500 });
  try {
    const output = await captureEmittedJson(() =>
      cmdPageNavigate(parsedFor({ positional: ['https://a.test/dest'], target: 'tab-A' }), []),
    );
    assert.equal(output.attrs['load-outcome'], 'bounded-timeout');
    assert.equal(output.attrs['deadline-exceeded'], undefined, 'the inner load-wait timed out but the overall nav phase completed');
    assert.equal(navigateSends(client).length, 1, 'a bounded-timeout with loaderId present must NOT redispatch');
  } finally {
    restoreTiming();
    h.restoreSeams();
  }
});

test('direct navigate propagates a Page.navigate failure without retrying or bouncing', async () => {
  const client = makeStubClient((_c, method) => {
    if (method === 'Page.navigate') throw new Error('net::ERR_ABORTED');
    return {};
  });
  const h = installSeams(client, { port: 9223, tab: tab('tab-A', 'https://a.test/') });
  const { __setNavigateTimingForTest, cmdPageNavigate } = await import('../src/cdp/commands/page/navigate.js');
  const restoreTiming = __setNavigateTimingForTest({ innerTimeoutMs: 20, outerDeadlineMs: 500 });
  try {
    await assert.rejects(
      () => cmdPageNavigate(parsedFor({ positional: ['https://a.test/dest'], target: 'tab-A' }), []),
      /ERR_ABORTED|navigate/i,
      'a method dispatch failure must surface, not be swallowed or retried',
    );
    assert.equal(navigateSends(client).length, 1, 'a failed Page.navigate must not be retried or bounced');
  } finally {
    restoreTiming();
    h.restoreSeams();
  }
});

test('direct navigate to a same-document (no-loaderId) target bounces dest->about:blank->dest, re-arming the wait before the final send', async () => {
  let destCount = 0;
  const client = makeStubClient((c, method, params) => {
    if (method !== 'Page.navigate') return {};
    if (params?.url === 'about:blank') return { loaderId: 'blank' };
    destCount += 1;
    if (destCount === 1) return {}; // same-document: no loaderId, no fresh load event
    // Final re-navigate: real cross-document load, observed synchronously.
    c.fire('Page.loadEventFired', { frameId: 'main' });
    return { loaderId: 'L2' };
  });
  const h = installSeams(client, { port: 9223, tab: tab('tab-A', 'https://a.test/app') });
  const { __setNavigateTimingForTest, cmdPageNavigate } = await import('../src/cdp/commands/page/navigate.js');
  const restoreTiming = __setNavigateTimingForTest({ innerTimeoutMs: 20, outerDeadlineMs: 500 });
  try {
    const output = await captureEmittedJson(() =>
      cmdPageNavigate(parsedFor({ positional: ['https://a.test/app#frag'], target: 'tab-A' }), []),
    );
    assert.equal(output.attrs['load-outcome'], 'observed', 'the reported outcome comes from the final re-navigate');
    const navs = navigateSends(client);
    assert.equal(navs.length, 3, 'same-document target -> dest, about:blank, re-navigate (3 total)');
    assert.equal(navs[0].params?.url, 'https://a.test/app#frag');
    assert.equal(navs[1].params?.url, 'about:blank');
    assert.equal(navs[2].params?.url, 'https://a.test/app#frag');
  } finally {
    restoreTiming();
    h.restoreSeams();
  }
});

test('direct navigate reports deadline-exceeded when the nav phase outruns the outer deadline, independent of the inner load outcome', async () => {
  const client = makeStubClient((_c, method) => {
    if (method === 'Page.navigate') return new Promise(() => {}); // never resolves — outruns the outer deadline
    return {};
  });
  const h = installSeams(client, { port: 9223, tab: tab('tab-A', 'https://a.test/') });
  const { __setNavigateTimingForTest, cmdPageNavigate } = await import('../src/cdp/commands/page/navigate.js');
  const restoreTiming = __setNavigateTimingForTest({ innerTimeoutMs: 80, outerDeadlineMs: 20 });
  try {
    const output = await captureEmittedJson(() =>
      cmdPageNavigate(parsedFor({ positional: ['https://a.test/dest'], target: 'tab-A' }), []),
    );
    assert.equal(output.attrs['deadline-exceeded'], true, 'the outer deadline elapsing is its own separate fact');
    assert.equal(output.attrs['load-outcome'], 'bounded-timeout', 'an incomplete nav phase reports load as unconfirmed');
  } finally {
    restoreTiming();
    h.restoreSeams();
  }
});

test('an invalid destination URL is a typed error BEFORE any connect/send (zero effects)', async () => {
  const client = makeStubClient();
  const h = installSeams(client, { port: 9223, tab: tab('tab-A', 'https://a.test/') });
  const { cmdPageNavigate } = await import('../src/cdp/commands/page/navigate.js');
  try {
    await assert.rejects(
      () => cmdPageNavigate(parsedFor({ positional: ['not-a-url'], target: 'tab-A' }), []),
      (err: unknown) => err instanceof CaptureError && err.descriptor.code === 'invalid_url',
      'an unparseable destination must be a typed invalid_url error',
    );
    assert.equal(h.resolveTabCalls.length, 0, 'no tab is resolved for an invalid URL');
    assert.equal(client.sends.length, 0, 'no CDP call is made for an invalid URL');
  } finally {
    h.restoreSeams();
  }
});

test('no active session and no source selector is a targeting error with zero tab creation', async () => {
  const client = makeStubClient();
  const h = installSeams(client, null);
  const { cmdPageNavigate } = await import('../src/cdp/commands/page/navigate.js');
  try {
    await assert.rejects(
      () => cmdPageNavigate(parsedFor({ positional: ['https://a.test/dest'] }), []),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        // The plain targeting error passes through with its own message — it is
        // NOT re-tagged as a `world`/navigate_failed with a misleading
        // "check the URL is absolute / CDP-enabled browser" hint.
        assert.match(msg, /--target|--url|targeting|tab/i);
        assert.doesNotMatch(msg, /check the URL is absolute/i);
        return true;
      },
      'an unresolvable source is a targeting error — navigate never creates a tab',
    );
    assert.equal(h.resolveTabCalls.length, 0, 'connectForCommand rejects before resolveTab when no target/url is given');
    assert.equal(client.sends.length, 0, 'no tab is created or driven');
  } finally {
    h.restoreSeams();
  }
});
