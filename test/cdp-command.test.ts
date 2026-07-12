import { test } from 'node:test';
import assert from 'node:assert/strict';

// U11: `cdp` conform-in-place (src/cdp/commands/cdp.ts).
//
// Follows the repo's CDP-stub pattern (see live-target-resolution.test.ts):
// a fake client answers exactly the CDP calls the code under test makes and a
// call log proves what was dispatched. `runPageScope`'s injectable `connect`
// parameter is the seam — no live browser needed.

import { cmdCdp, runPageScope, type CdpScopeClient } from '../src/cdp/commands/cdp.js';
import type { ParsedArgs } from '../src/cdp/types.js';

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
// Both method and --wait-event absent → structured <error>, exit 1.
// ---------------------------------------------------------------------------

test('cdp with neither <Domain.method> nor --wait-event emits a structured <error> and exits 1', async () => {
  const { exitCode, stdout } = await withCapturedOutput(() => cmdCdp(parsedArgs(), []));
  assert.equal(exitCode, 1);
  assert.match(stdout, /<error /);
  assert.match(stdout, /code="missing_method_and_event"/);
  assert.match(stdout, /at least one/);
});

test('cdp both-absent error mirrors as JSON under --json', async () => {
  const { exitCode, stdout } = await withCapturedOutput(() => cmdCdp(parsedArgs({ json: true }), []));
  assert.equal(exitCode, 1);
  const output = JSON.parse(stdout) as { tag: string; attrs: Record<string, unknown> };
  assert.equal(output.tag, 'error');
  assert.equal(output.attrs.code, 'missing_method_and_event');
});

test('cdp wait-only invocation passes the both-absent gate (its failure is a connection error, never missing_method_and_event)', async () => {
  // No injectable connect at the cmdCdp level: with no session/target the
  // page-scope connection fails deterministically offline — proving the gate
  // let the wait-only invocation through to the connection attempt.
  const { exitCode, stdout } = await withCapturedOutput(() =>
    cmdCdp(parsedArgs({ waitEvent: 'ServiceWorker.workerRegistrationUpdated', timeoutMs: 200 }), []),
  );
  assert.equal(exitCode, 1);
  assert.match(stdout, /code="cdp_failed"/);
  assert.doesNotMatch(stdout, /missing_method_and_event/);
});

test('cdp with invalid --params JSON emits a structured <error code="invalid_params_json"> and exits 1', async () => {
  const { exitCode, stdout } = await withCapturedOutput(() =>
    cmdCdp(parsedArgs({ positional: ['Browser.getVersion'], params: '{not-json' }), []),
  );
  assert.equal(exitCode, 1);
  assert.match(stdout, /<error /);
  assert.match(stdout, /code="invalid_params_json"/);
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
  assert.equal(exitCode, 0);
  assert.match(helpText, /At least one of <Domain\.method> \/ --wait-event is required/);
  assert.match(helpText, /Spec deviation: params stay inline JSON/);
  assert.match(helpText, /Output:/);
  assert.match(helpText, /Effects:/);
  assert.doesNotMatch(helpText, /Example/i, 'D6 leaf help carries no examples');
});
