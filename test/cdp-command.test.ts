import { test } from 'node:test';
import assert from 'node:assert/strict';

// U11: `cdp` conform-in-place (src/cdp/commands/cdp.ts).
//
// Follows the repo's CDP-stub pattern (see live-target-resolution.test.ts):
// a fake client answers exactly the CDP calls the code under test makes and a
// call log proves what was dispatched. `runPageScope`'s injectable `connect`
// parameter is the seam — no live browser needed.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { cmdCdp, runPageScope, runBrowserScope, type CdpScopeClient, type BrowserScopeClient, type BrowserScopeDeps } from '../src/cdp/commands/cdp.js';
import { CaptureError } from '../src/errors.js';
import type { ParsedArgs } from '../src/cdp/types.js';
import { CAPTURE_ROOT } from '../src/session/artifacts.js';
import { setActiveSession, clearActiveSession } from '../src/session-context.js';
import type { BridgeRequest, BridgeResponse } from '../src/cdp/bridge/protocol.js';

// Isolate the active-session pointer from any real capture session on this
// machine (session-context.ts scopes its pointer file by CRTR_NODE_ID) —
// same convention as recorder-navigate-waitevent.test.ts.
process.env.CRTR_NODE_ID = `u11-cdp-command-test-${process.pid}-${Date.now()}`;

function parsedArgs(overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command: 'cdp', positional: [], ...overrides };
}

/** Stubs `process.exit` to capture the code instead of killing the test
 * process, and `process.stdout.write` to capture the emitted block. */
async function withCapturedOutput<T>(
  fn: () => Promise<T>,
): Promise<{ exitCode: number | undefined; stdout: string }> {
  const originalExit = process.exit;
  const originalWrite = process.stdout.write;
  let exitCode: number | undefined;
  let stdout = '';
  // @ts-expect-error — test-only stub, narrower signature than the real process.exit
  process.exit = (code?: number) => {
    exitCode = code ?? 0;
    throw new Error('__process_exit__');
  };
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
    return { exitCode, stdout };
  } catch (err) {
    if (err instanceof Error && err.message === '__process_exit__') {
      return { exitCode, stdout };
    }
    throw err;
  } finally {
    process.exit = originalExit;
    process.stdout.write = originalWrite;
  }
}

interface RecordedCall {
  method: string;
  params: Record<string, unknown>;
}

function stubClient(
  handlers: Record<string, (params: Record<string, unknown>) => unknown>,
  opts: { fireEvent?: { name: string; params: unknown } } = {},
): CdpScopeClient & { calls: RecordedCall[]; closed: boolean } {
  const client = {
    calls: [] as RecordedCall[],
    closed: false,
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      client.calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected CDP call in test stub: ${method}`);
      return handler(params);
    },
    on(event: string, handler: (params: unknown) => void): void {
      if (opts.fireEvent && event === opts.fireEvent.name) {
        queueMicrotask(() => handler(opts.fireEvent!.params));
      }
    },
    close(): void {
      client.closed = true;
    },
  };
  return client;
}

function stubConnect(client: CdpScopeClient): (parsed: ParsedArgs) => Promise<{ client: CdpScopeClient }> {
  return async () => ({ client });
}

// ---------------------------------------------------------------------------
// Invocation failures cross the boundary as typed CaptureErrors (U16/A4):
// the leaf never renders an error block or exits — capture.ts owns both.
// ---------------------------------------------------------------------------

async function assertCaptureRejection(run: () => Promise<void>, code: string): Promise<{ stdout: string }> {
  let stdoutSeen = '';
  await assert.rejects(
    async () => {
      const { stdout } = await withCapturedOutput(run);
      stdoutSeen = stdout;
    },
    (error: unknown) => {
      assert.ok(error instanceof CaptureError, `expected CaptureError, got ${String(error)}`);
      assert.equal(error.descriptor.code, code);
      return true;
    },
  );
  return { stdout: stdoutSeen };
}

test('cdp with neither <Domain.method> nor --wait-event throws a typed missing_method_and_event without rendering or exiting', async () => {
  const originalWrite = process.stdout.write;
  let stdout = '';
  process.stdout.write = ((chunk: unknown) => { stdout += String(chunk); return true; }) as typeof process.stdout.write;
  try {
    await assert.rejects(
      () => cmdCdp(parsedArgs(), []),
      (error: unknown) => {
        assert.ok(error instanceof CaptureError);
        assert.equal(error.descriptor.code, 'missing_method_and_event');
        assert.equal(error.descriptor.kind, 'invocation');
        assert.match(error.descriptor.message, /at least one/);
        return true;
      },
    );
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.equal(stdout, '', 'the leaf must not render the error itself');
});

test('cdp wait-only invocation passes the both-absent gate (its failure is a connection error, never missing_method_and_event)', async () => {
  // No injectable connect at the cmdCdp level: with no session/target the
  // page-scope connection fails deterministically offline — proving the gate
  // let the wait-only invocation through to the connection attempt.
  await assert.rejects(
    () => withCapturedOutput(() => cmdCdp(parsedArgs({ waitEvent: 'ServiceWorker.workerRegistrationUpdated', timeoutMs: 200 }), [])),
    (error: unknown) => {
      assert.ok(error instanceof CaptureError);
      assert.equal(error.descriptor.code, 'cdp_failed');
      assert.doesNotMatch(error.descriptor.message, /missing_method_and_event/);
      return true;
    },
  );
});

test('cdp with invalid --params JSON throws a typed invalid_params_json', async () => {
  await assertCaptureRejection(
    () => cmdCdp(parsedArgs({ positional: ['Browser.getVersion'], params: '{not-json' }), []),
    'invalid_params_json',
  );
});

// ---------------------------------------------------------------------------
// Wait-only invocation (page scope) — the branch preserved by D11.
// ---------------------------------------------------------------------------

test('wait-only invocation renders the awaited event in a <cdp-result> block with no method sent', async () => {
  const eventFixture = { registrationId: 'reg-1', scopeURL: 'https://example.com/' };
  const client = stubClient(
    {},
    { fireEvent: { name: 'ServiceWorker.workerRegistrationUpdated', params: eventFixture } },
  );
  const parsed = parsedArgs({ waitEvent: 'ServiceWorker.workerRegistrationUpdated' });

  const { exitCode, stdout } = await withCapturedOutput(() =>
    runPageScope(undefined, undefined, parsed, 1000, stubConnect(client)),
  );

  assert.equal(exitCode, undefined, 'a successful wait-only invocation must not call process.exit');
  assert.equal(client.calls.length, 0, 'wait-only must send no protocol method');
  assert.ok(client.closed, 'the client must be closed after the command');
  assert.match(stdout, /<cdp-result /);
  assert.match(stdout, /wait-event="ServiceWorker.workerRegistrationUpdated"/);
  assert.match(stdout, /scope="page"/);
  assert.match(stdout, /event: /);
  assert.match(stdout, /reg-1/);
  assert.doesNotMatch(stdout, /result: /, 'no method → no result line');
});

// ---------------------------------------------------------------------------
// Method + params — rendered capped in prose, mirrored raw under --json.
// ---------------------------------------------------------------------------

const BIG_RESULT = { value: 'x'.repeat(5000), ok: true };

test('method+params result is dispatched with the parsed params and rendered as a capped data block', async () => {
  const client = stubClient({ 'Runtime.evaluate': () => BIG_RESULT });
  const parsed = parsedArgs({ positional: ['Runtime.evaluate'] });
  const params = { expression: '1 + 1' };

  const { exitCode, stdout } = await withCapturedOutput(() =>
    runPageScope('Runtime.evaluate', params, parsed, 1000, stubConnect(client)),
  );

  assert.equal(exitCode, undefined);
  assert.deepEqual(client.calls, [{ method: 'Runtime.evaluate', params }], 'the inline --params object must reach the protocol call verbatim');
  assert.match(stdout, /<cdp-result /);
  assert.match(stdout, /method="Runtime.evaluate"/);
  assert.match(stdout, /result: /);
  // Capped: the payload (>5000 chars of JSON) is truncated with the cap marker.
  assert.match(stdout, /…\[\+\d+ chars\]/, 'an oversize protocol result must be length-capped in prose');
  const payloadLine = stdout.split('\n').find((l) => l.startsWith('result: '));
  assert.ok(payloadLine && payloadLine.length < 4200, 'the prose payload must be bounded by the generous cap');
});

test('--json mirrors the raw protocol result at full fidelity (no cap)', async () => {
  const client = stubClient({ 'Runtime.evaluate': () => BIG_RESULT });
  const parsed = parsedArgs({ positional: ['Runtime.evaluate'], json: true });

  const { exitCode, stdout } = await withCapturedOutput(() =>
    runPageScope('Runtime.evaluate', { expression: '1 + 1' }, parsed, 1000, stubConnect(client)),
  );

  assert.equal(exitCode, undefined);
  const output = JSON.parse(stdout) as { tag: string; attrs: Record<string, unknown>; sections: string[] };
  assert.equal(output.tag, 'cdp-result');
  assert.equal(output.attrs.method, 'Runtime.evaluate');
  assert.equal(output.attrs.scope, 'page');
  const resultSection = output.sections.find((s) => s.startsWith('result: '));
  assert.ok(resultSection, 'the JSON mirror must carry the result section');
  const roundTripped = JSON.parse(resultSection.slice('result: '.length)) as typeof BIG_RESULT;
  assert.deepEqual(roundTripped, BIG_RESULT, 'the --json payload must round-trip the raw protocol result unclipped');
});

test('combined method + --wait-event renders both result and event sections', async () => {
  const eventFixture = { frameId: 'main' };
  const client = stubClient(
    { 'Page.reload': () => ({ reloaded: true }) },
    { fireEvent: { name: 'Page.loadEventFired', params: eventFixture } },
  );
  const parsed = parsedArgs({ positional: ['Page.reload'], waitEvent: 'Page.loadEventFired' });

  const { exitCode, stdout } = await withCapturedOutput(() =>
    runPageScope('Page.reload', {}, parsed, 1000, stubConnect(client)),
  );

  assert.equal(exitCode, undefined);
  assert.match(stdout, /method="Page.reload"/);
  assert.match(stdout, /wait-event="Page.loadEventFired"/);
  assert.match(stdout, /result: /);
  assert.match(stdout, /event: /);
});

test('direct page event wait is armed before a synchronous triggering send', async () => {
  let eventHandler: ((params: unknown) => void) | undefined;
  let closed = false;
  const client: CdpScopeClient = {
    async send(method): Promise<unknown> {
      assert.equal(method, 'Page.reload');
      assert.ok(eventHandler, 'the event callback must be installed before send starts');
      eventHandler({ frameId: 'synchronous-main' });
      return { reloaded: true };
    },
    on(event, handler): void {
      assert.equal(event, 'Page.loadEventFired');
      eventHandler = handler;
    },
    close(): void {
      closed = true;
    },
  };
  const parsed = parsedArgs({ positional: ['Page.reload'], waitEvent: 'Page.loadEventFired' });

  const { exitCode, stdout } = await withCapturedOutput(() =>
    runPageScope('Page.reload', {}, parsed, 100, stubConnect(client)),
  );

  assert.equal(exitCode, undefined);
  assert.ok(closed);
  assert.match(stdout, /synchronous-main/);
  assert.match(stdout, /reloaded/);
});

// ---------------------------------------------------------------------------
// -h — D6 leaf shape, documents the D11 constraints.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// U14 — browser-scope target provenance. A browser-level CDP call is
// connection-scoped, so a flattened target session is attached ONLY when the
// caller explicitly passed `--target` (`targetSource: 'flag'`). Session/env
// target autofill must never scope a browser-level call onto some other tab.
// ---------------------------------------------------------------------------

function bridgeDeps(record: (req: Omit<BridgeRequest, 'reqId'>) => void): BrowserScopeDeps {
  return {
    async sendBridgeRequest(_socket: string, req: Omit<BridgeRequest, 'reqId'>): Promise<BridgeResponse> {
      record(req);
      return { reqId: 1, ok: true, result: { version: '1' } };
    },
    getBrowserClient() {
      throw new Error('one-shot browser client must not be reached while a held bridge is active');
    },
    findTabById() {
      throw new Error('findTabById must not be reached while a held bridge is active');
    },
    detectCdpPort() {
      throw new Error('detectCdpPort must not be reached while a held bridge is active');
    },
  };
}

async function withHeldSession(fn: (socket: string) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'u14-held-'));
  const socket = path.join(dir, 'bridge.sock');
  fs.writeFileSync(socket, '');
  await setActiveSession({ sessionId: 'u14-held', dir, harId: null, targetId: 'session-target', stepCount: 0, bridgeSocket: socket });
  try {
    await fn(socket);
  } finally {
    clearActiveSession();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('held bridge omits the target for a bare browser call even when the session autofilled one', async () => {
  await withHeldSession(async () => {
    let req: Omit<BridgeRequest, 'reqId'> | undefined;
    const parsed = parsedArgs({ positional: ['Browser.getVersion'], browser: true, target: 'session-target', targetSource: 'session' });
    const { exitCode, stdout } = await withCapturedOutput(() =>
      runBrowserScope('Browser.getVersion', undefined, parsed, 1000, bridgeDeps((r) => { req = r; })),
    );
    assert.equal(exitCode, undefined);
    assert.equal(req?.targetId, undefined, 'a session-autofilled target must not scope a browser-level call');
    assert.match(stdout, /scope="browser"/);
    assert.doesNotMatch(stdout, /target="session-target"/, 'the browser result must not report the autofilled target');
  });
});

test('held bridge passes an explicit --target through to the flattened session', async () => {
  await withHeldSession(async () => {
    let req: Omit<BridgeRequest, 'reqId'> | undefined;
    const parsed = parsedArgs({ positional: ['ServiceWorker.enable'], browser: true, target: 'explicit-target', targetSource: 'flag' });
    const { exitCode, stdout } = await withCapturedOutput(() =>
      runBrowserScope('ServiceWorker.enable', undefined, parsed, 1000, bridgeDeps((r) => { req = r; })),
    );
    assert.equal(exitCode, undefined);
    assert.equal(req?.targetId, 'explicit-target', 'an explicit --target must scope the browser call');
    assert.match(stdout, /target="explicit-target"/);
  });
});

test('one-shot browser call skips Target.attachToTarget for a session-autofilled target', async () => {
  clearActiveSession();
  const calls: string[] = [];
  const client: BrowserScopeClient & { closed: boolean } = {
    closed: false,
    async send(method: string): Promise<unknown> { calls.push(method); return { version: '1' }; },
    on(): void {},
    close(): void { this.closed = true; },
  };
  const deps: BrowserScopeDeps = {
    sendBridgeRequest() { throw new Error('no held bridge is active'); },
    async getBrowserClient() { return { client }; },
    findTabById() { throw new Error('findTabById must not be reached for an autofilled target'); },
    async detectCdpPort() { return 9222; },
  };
  const parsed = parsedArgs({ positional: ['Browser.getVersion'], browser: true, target: 'session-target', targetSource: 'session', port: 9222 });
  const { exitCode, stdout } = await withCapturedOutput(() =>
    runBrowserScope('Browser.getVersion', undefined, parsed, 1000, deps),
  );
  assert.equal(exitCode, undefined);
  assert.deepEqual(calls, ['Browser.getVersion'], 'a bare browser call sends only the method, never Target.attachToTarget');
  assert.ok(client.closed);
  assert.doesNotMatch(stdout, /target="session-target"/);
});

test('one-shot browser call attaches a flattened session only for an explicit --target', async () => {
  clearActiveSession();
  const calls: Array<{ method: string; sessionId?: string }> = [];
  const client: BrowserScopeClient & { closed: boolean } = {
    closed: false,
    async send(method: string, _params?: Record<string, unknown>, _timeout?: number, sessionId?: string): Promise<unknown> {
      calls.push({ method, sessionId });
      if (method === 'Target.attachToTarget') return { sessionId: 'flat-session' };
      return { enabled: true };
    },
    on(): void {},
    close(): void { this.closed = true; },
  };
  const findCalls: string[] = [];
  const deps: BrowserScopeDeps = {
    sendBridgeRequest() { throw new Error('no held bridge is active'); },
    async getBrowserClient() { return { client }; },
    async findTabById(_port: number, targetId: string) { findCalls.push(targetId); return { id: 'full-target-id' }; },
    async detectCdpPort() { return 9222; },
  };
  const parsed = parsedArgs({ positional: ['ServiceWorker.enable'], browser: true, target: 'explicit', targetSource: 'flag', port: 9222 });
  const { exitCode, stdout } = await withCapturedOutput(() =>
    runBrowserScope('ServiceWorker.enable', undefined, parsed, 1000, deps),
  );
  assert.equal(exitCode, undefined);
  assert.deepEqual(findCalls, ['explicit'], 'the explicit --target is resolved to a full target id');
  assert.deepEqual(calls, [
    { method: 'Target.attachToTarget', sessionId: undefined },
    { method: 'ServiceWorker.enable', sessionId: 'flat-session' },
  ], 'the method runs on the flattened target session');
  assert.match(stdout, /target="explicit"/);
});

test('cdp -h states the at-least-one-of input constraint and the inline --params spec deviation, with no examples', async () => {
  const originalLog = console.log;
  let helpText = '';
  console.log = ((msg?: unknown) => {
    helpText += `${String(msg)}\n`;
  }) as typeof console.log;
  let exitCode: number | undefined;
  try {
    ({ exitCode } = await withCapturedOutput(() => cmdCdp(parsedArgs({ help: true }), [])));
  } finally {
    console.log = originalLog;
  }
  assert.equal(exitCode, undefined, 'help must return, never call process.exit');
  assert.match(helpText, /At least one of <Domain\.method> \/ --wait-event is required/);
  assert.match(helpText, /Spec deviation: params stay inline JSON/);
  assert.match(helpText, /Output:/);
  assert.match(helpText, /Effects:/);
  assert.doesNotMatch(helpText, /Example/i, 'D6 leaf help carries no examples');
});
