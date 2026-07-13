import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { validateHarFile } from '../src/har-manager.js';
import { HARRecorder } from '../src/cdp/har-recorder.js';

class FakeClient extends EventEmitter {
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  body: unknown = { body: '', base64Encoded: false };
  enable: unknown = {};

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'Network.enable') {
      if (this.enable instanceof Error) throw this.enable;
      return this.enable;
    }
    if (method === 'Network.getResponseBody') {
      if (this.body instanceof Error) throw this.body;
      return this.body;
    }
    return {};
  }

  fire(event: string, params: unknown): void {
    this.emit(event, params);
  }
}

function request(requestId = 'r', overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId,
    timestamp: 10,
    wallTime: 1_700_000_000,
    request: { method: 'POST', url: 'https://example.test/path', headers: { 'Content-Type': 'text/plain', X: 'yes' }, postData: '' },
    ...overrides,
  };
}

function response(requestId = 'r', timestamp = 12): Record<string, unknown> {
  return { requestId, timestamp, response: { url: 'https://example.test/path', status: 201, headers: { X: 'response' } } };
}

function finished(requestId = 'r', timestamp = 15): Record<string, unknown> {
  return { requestId, timestamp, encodedDataLength: 42 };
}

async function recorder(): Promise<{ client: FakeClient; recorder: HARRecorder }> {
  const client = new FakeClient();
  const har = new HARRecorder(client as never);
  await har.start();
  assert.equal(client.calls[0].method, 'Network.enable');
  return { client, recorder: har };
}

test('uses request wall time for start and request/response/terminal monotonic clocks for factual duration', async () => {
  const { client, recorder: har } = await recorder();
  client.body = { body: 'hello', base64Encoded: false };
  client.fire('Network.requestWillBeSent', request());
  client.fire('Network.responseReceived', response('r', 12.25));
  client.fire('Network.loadingFinished', finished('r', 18.5));
  const entry = (await har.finish()).log.entries[0];
  assert.equal(entry.startedDateTime, new Date(1_700_000_000_000).toISOString());
  assert.equal(entry.time, 8500);
  assert.deepEqual(entry._capture.clocks, { requestWallTime: 1_700_000_000, requestMonotonic: 10, responseMonotonic: 12.25, terminalMonotonic: 18.5 });
  assert.deepEqual(entry.request.postData, { mimeType: 'text/plain', text: '' });
});

for (const [label, value] of [['missing', undefined], ['string', '1'], ['NaN', NaN], ['infinite', Infinity], ['out of ISO range', 9e12]] as const) {
  test(`rejects ${label} request wall time without a fallback`, async () => {
    const { client, recorder: har } = await recorder();
    const event = request('bad');
    if (value === undefined) delete event.wallTime;
    else event.wallTime = value;
    client.fire('Network.requestWillBeSent', event);
    await assert.rejects(har.finish(), /wallTime/);
  });
}

test('redirects form independent request generations and do not fetch redirect bodies', async () => {
  const { client, recorder: har } = await recorder();
  client.body = { body: 'next', base64Encoded: false };
  client.fire('Network.requestWillBeSent', request('same'));
  client.fire('Network.requestWillBeSent', request('same', { timestamp: 20, wallTime: 1_700_000_001, redirectResponse: { url: 'https://example.test/path', status: 302, headers: { Location: '/next' } } }));
  client.fire('Network.responseReceived', response('same', 21));
  client.fire('Network.loadingFinished', finished('same', 22));
  const result = await har.finish();
  assert.equal(result.log.entries.length, 2);
  assert.equal(result.log.entries[0]._capture.generation, 1);
  assert.equal(result.log.entries[0]._capture.terminal.kind, 'redirect');
  assert.equal(result.log.entries[0].response.status, 302);
  assert.equal(result.log.entries[1]._capture.generation, 2);
  assert.equal(client.calls.filter((call) => call.method === 'Network.getResponseBody').length, 1);
});

test('failure and duplicate terminal events produce one factual terminal entry', async () => {
  const { client, recorder: har } = await recorder();
  client.fire('Network.requestWillBeSent', request());
  client.fire('Network.loadingFailed', { requestId: 'r', timestamp: 13, errorText: 'net::ERR_FAILED', canceled: false, blockedReason: 'other', type: 'Document' });
  client.fire('Network.loadingFailed', { requestId: 'r', timestamp: 13, errorText: 'net::ERR_FAILED', canceled: false, blockedReason: 'other', type: 'Document' });
  const result = await har.finish();
  assert.equal(result.log.entries.length, 1);
  const entry = result.log.entries[0];
  assert.equal(entry.response.status, 0);
  assert.deepEqual(entry._capture.terminal, { kind: 'failed', errorText: 'net::ERR_FAILED', canceled: false, blockedReason: 'other', resourceType: 'Document' });
  assert.deepEqual(entry._capture.body, { state: 'not_applicable', reason: 'no_response' });
  assert.equal(client.calls.filter((call) => call.method === 'Network.getResponseBody').length, 0);
});

test('finish records nonterminal traffic as stopped evidence and final result is stable', async () => {
  const { client, recorder: har } = await recorder();
  client.fire('Network.requestWillBeSent', request());
  const first = await har.finish();
  client.fire('Network.loadingFailed', { requestId: 'r', timestamp: 13, errorText: 'late' });
  assert.strictEqual(await har.finish(), first);
  assert.equal(first.log.entries.length, 0);
  assert.equal(first.incompleteLifecycles[0].kind, 'stopped_before_terminal');
  assert(Object.isFrozen(first));
  assert(Object.isFrozen(first.log.entries));
});

test('base64 preserves binary bytes and decoded-byte cap boundaries', async () => {
  for (const size of [256 * 1024 - 1, 256 * 1024, 256 * 1024 + 1]) {
    const { client, recorder: har } = await recorder();
    const bytes = Buffer.alloc(size);
    bytes[0] = 0;
    bytes[Math.min(1, size - 1)] = 0xff;
    client.body = { body: bytes.toString('base64'), base64Encoded: true };
    client.fire('Network.requestWillBeSent', request());
    client.fire('Network.responseReceived', response());
    client.fire('Network.loadingFinished', finished());
    const entry = (await har.finish()).log.entries[0];
    assert.equal(entry.response.content.encoding, 'base64');
    assert.deepEqual(Buffer.from(entry.response.content.text!, 'base64'), bytes.subarray(0, Math.min(size, 256 * 1024)));
    assert.deepEqual(entry._capture.body, { state: 'captured', sourceEncoding: 'base64', decodedByteLength: size, capturedByteLength: Math.min(size, 256 * 1024), truncated: size > 256 * 1024 });
  }
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  return { promise: new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }), resolve, reject };
}

function assertValid(result: unknown): void {
  assert.deepEqual(validateHarFile(result, 'test recorder output'), result);
}

test('multibyte text caps on UTF-8 scalar boundaries and failed body retrieval remains factual', async () => {
  const { client, recorder: har } = await recorder();
  const text = 'a'.repeat(256 * 1024 - 2) + '🙂';
  client.body = { body: text, base64Encoded: false };
  client.fire('Network.requestWillBeSent', request());
  client.fire('Network.responseReceived', response());
  client.fire('Network.loadingFinished', finished());
  const textEntry = (await har.finish()).log.entries[0];
  assert.equal(textEntry.response.content.text, 'a'.repeat(256 * 1024 - 2));
  assert.deepEqual(textEntry._capture.body, { state: 'captured', sourceEncoding: 'text', decodedByteLength: 256 * 1024 + 2, capturedByteLength: 256 * 1024 - 2, truncated: true });

  const second = await recorder();
  second.client.body = new Error('body evicted');
  second.client.fire('Network.requestWillBeSent', request());
  second.client.fire('Network.responseReceived', response());
  second.client.fire('Network.loadingFinished', finished());
  const failed = (await second.recorder.finish()).log.entries[0];
  assert.deepEqual(failed._capture.body, { state: 'fetch_failed', error: 'body evicted' });
  assert.deepEqual(failed.response.content, {});
});

test('reserves start before enable resolves and latches a failed attempt', async () => {
  const client = new FakeClient();
  const enabled = deferred<unknown>();
  client.enable = enabled.promise;
  const har = new HARRecorder(client as never);
  const first = har.start();
  await assert.rejects(har.start(), /already been started/);
  assert.equal(client.calls.filter((call) => call.method === 'Network.enable').length, 1);
  enabled.resolve({});
  await first;
  assert.equal(client.listenerCount('Network.requestWillBeSent'), 1);

  const rejected = new FakeClient();
  rejected.enable = new Error('enable failed');
  const failed = new HARRecorder(rejected as never);
  await assert.rejects(failed.start(), /enable failed/);
  await assert.rejects(failed.start(), /already been started/);
  await assert.rejects(failed.finish(), /enable failed/);
  assert.equal(rejected.calls.filter((call) => call.method === 'Network.enable').length, 1);
});

test('rejects duplicate active ids without losing an owned generation, including a pending body generation', async () => {
  const { client, recorder: har } = await recorder();
  client.fire('Network.requestWillBeSent', request('duplicate'));
  client.fire('Network.requestWillBeSent', request('duplicate', { timestamp: 11 }));
  await assert.rejects(har.finish(), /duplicate active requestId/);

  const second = await recorder();
  const body = deferred<unknown>();
  second.client.body = body.promise;
  second.client.fire('Network.requestWillBeSent', request('pending'));
  second.client.fire('Network.responseReceived', response('pending'));
  second.client.fire('Network.loadingFinished', finished('pending'));
  second.client.fire('Network.requestWillBeSent', request('pending', { timestamp: 16 }));
  await assert.rejects(second.recorder.finish(), /duplicate active requestId/);
  body.resolve({ body: '', base64Encoded: false });
});

test('ignores malformed unmatched terminal traffic but rejects malformed owned terminal traffic', async () => {
  for (const [event, malformed] of [
    ['Network.loadingFinished', { requestId: 'unknown', timestamp: 'bad', encodedDataLength: -1 }],
    ['Network.loadingFailed', { requestId: 'unknown', timestamp: 'bad', errorText: 1 }],
  ] as const) {
    const { client, recorder: har } = await recorder();
    client.fire(event, malformed);
    const result = await har.finish();
    assertValid(result);
    assert.equal(result.log.entries.length, 0);
  }
  for (const [event, malformed] of [
    ['Network.loadingFinished', { requestId: 'owned', timestamp: 'bad', encodedDataLength: 1 }],
    ['Network.loadingFailed', { requestId: 'owned', timestamp: 'bad', errorText: 'x' }],
  ] as const) {
    const { client, recorder: har } = await recorder();
    client.fire('Network.requestWillBeSent', request('owned'));
    client.fire(event, malformed);
    await assert.rejects(har.finish(), /Malformed owned Network event/);
  }
});

test('preserves failure facts without body fetch, including an empty error string and received response', async () => {
  const { client, recorder: har } = await recorder();
  client.fire('Network.requestWillBeSent', request());
  client.fire('Network.responseReceived', response());
  client.fire('Network.loadingFailed', { requestId: 'r', timestamp: 14, errorText: '' });
  const result = await har.finish();
  const entry = result.log.entries[0];
  assert.equal(entry.response.status, 201);
  assert.deepEqual(entry._capture.body, { state: 'not_applicable', reason: 'network_failed' });
  assert.equal((entry._capture.terminal as { errorText: string }).errorText, '');
  assert.equal(client.calls.filter((call) => call.method === 'Network.getResponseBody').length, 0);
  assertValid(result);
});

test('makes clock disorder incomplete evidence without inventing redirect response clocks', async () => {
  const cases: Array<{ name: string; events(client: FakeClient): void; violation: string }> = [
    { name: 'response before request', violation: 'response_before_request', events: (client) => { client.fire('Network.requestWillBeSent', request()); client.fire('Network.responseReceived', response('r', 9)); client.fire('Network.loadingFailed', { requestId: 'r', timestamp: 12, errorText: 'x' }); } },
    { name: 'terminal before request', violation: 'terminal_before_request', events: (client) => { client.fire('Network.requestWillBeSent', request()); client.fire('Network.loadingFailed', { requestId: 'r', timestamp: 9, errorText: 'x' }); } },
    { name: 'terminal before response', violation: 'terminal_before_response', events: (client) => { client.fire('Network.requestWillBeSent', request()); client.fire('Network.responseReceived', response('r', 13)); client.fire('Network.loadingFailed', { requestId: 'r', timestamp: 12, errorText: 'x' }); } },
  ];
  for (const item of cases) {
    const { client, recorder: har } = await recorder();
    item.events(client);
    const result = await har.finish();
    assert.equal(result.incompleteLifecycles[0].kind, 'invalid_clock_order', item.name);
    assert.equal((result.incompleteLifecycles[0] as { violation: string }).violation, item.violation);
    assertValid(result);
  }
  const { client, recorder: har } = await recorder();
  client.fire('Network.requestWillBeSent', request('redirect'));
  client.fire('Network.requestWillBeSent', request('redirect', { timestamp: 9, redirectResponse: { url: 'https://example.test/path', status: 302, headers: {} } }));
  const result = await har.finish();
  const incomplete = result.incompleteLifecycles[0] as Extract<(typeof result.incompleteLifecycles)[number], { kind: 'invalid_clock_order' }>;
  assert.deepEqual(incomplete.response, { status: 302, headers: [], responseMonotonic: null });
  assert.equal(incomplete.violation, 'terminal_before_request');
  assertValid(result);

  const invalidRedirects = [
    { ...incomplete, response: { ...incomplete.response!, status: 200 } },
    { ...incomplete, response: null },
    { ...incomplete, response: { ...incomplete.response!, responseMonotonic: 8 } },
    {
      ...incomplete,
      terminal: { kind: 'failed' as const, terminalMonotonic: 9, errorText: 'x', canceled: false, blockedReason: null, resourceType: null },
    },
  ];
  for (const invalid of invalidRedirects) {
    const malformed = structuredClone(result);
    malformed.incompleteLifecycles[0] = invalid;
    assert.throws(() => validateHarFile(malformed, 'invalid redirect clock'));
  }
});

test('both finalizers synchronously cut admission while enable is deferred', async () => {
  for (const finalizer of ['finish', 'finishPartial'] as const) {
    const client = new FakeClient();
    const enabled = deferred<unknown>();
    client.enable = enabled.promise;
    const har = new HARRecorder(client as never);
    const starting = har.start();
    const result = finalizer === 'finish' ? await har.finish() : har.finishPartial();
    assert.equal(result.log.entries.length, 0);
    assert.equal(har.responseCount, 0);
    enabled.resolve({});
    await starting;
    assert.equal(client.listenerCount('Network.requestWillBeSent'), 0);
    client.fire('Network.requestWillBeSent', request(finalizer));
    client.fire('Network.loadingFailed', { requestId: finalizer, timestamp: 12, errorText: 'late' });
    assert.equal(har.responseCount, 0);
    assert.strictEqual(finalizer === 'finish' ? await har.finish() : har.finishPartial(), result);
    assert.equal(result.log.entries.length, 0);
    assert.equal(result.incompleteLifecycles.length, 0);
  }
});

test('partial finalization is frozen, reports pending body work, and cannot be replaced by late completion', async () => {
  const { client, recorder: har } = await recorder();
  const body = deferred<unknown>();
  client.body = body.promise;
  client.fire('Network.requestWillBeSent', request());
  client.fire('Network.responseReceived', response());
  client.fire('Network.loadingFinished', finished());
  const partial = har.finishPartial();
  assert.equal(partial.incompleteLifecycles[0].kind, 'stopped_during_body');
  assert.strictEqual(await har.finish(), partial);
  body.resolve({ body: 'late', base64Encoded: false });
  await Promise.resolve();
  assert.strictEqual(har.finishPartial(), partial);
  assertValid(partial);
});

test('malformed body payloads become factual fetch failures', async () => {
  for (const body of [
    { body: 1, base64Encoded: false },
    { body: 'not base64!', base64Encoded: true },
  ]) {
    const { client, recorder: har } = await recorder();
    client.body = body;
    client.fire('Network.requestWillBeSent', request());
    client.fire('Network.responseReceived', response());
    client.fire('Network.loadingFinished', finished());
    const result = await har.finish();
    const entry = result.log.entries[0];
    assert.equal(entry._capture.body.state, 'fetch_failed');
    assert.deepEqual(entry.response.content, {});
    assertValid(result);
  }
});

test('conflicting terminal and derived validator failures retain one fatal authority', async () => {
  const conflicting = await recorder();
  conflicting.client.fire('Network.requestWillBeSent', request());
  conflicting.client.fire('Network.loadingFailed', { requestId: 'r', timestamp: 12, errorText: 'first' });
  conflicting.client.fire('Network.loadingFailed', { requestId: 'r', timestamp: 13, errorText: 'second' });
  await assert.rejects(conflicting.recorder.finish(), /conflicting terminal event/);

  const { client, recorder: har } = await recorder();
  client.fire('Network.requestWillBeSent', request('overflow', { timestamp: 0 }));
  client.fire('Network.responseReceived', response('overflow', 1));
  client.fire('Network.loadingFinished', finished('overflow', Number.MAX_VALUE));
  let failure: unknown;
  try {
    await har.finish();
  } catch (error) {
    failure = error;
  }
  assert(failure instanceof Error);
  await assert.rejects(har.finish(), (error) => error === failure);
  assert.throws(() => har.finishPartial(), (error) => error === failure);
});

test('finish owns mixed finalization races and validates stopped lifecycle evidence', async () => {
  const { client, recorder: har } = await recorder();
  const body = deferred<unknown>();
  client.body = body.promise;
  client.fire('Network.requestWillBeSent', request());
  client.fire('Network.responseReceived', response());
  client.fire('Network.loadingFinished', finished());
  const completing = har.finish();
  assert.throws(() => har.finishPartial(), /finalizing with finish/);
  body.resolve({ body: '', base64Encoded: false });
  const result = await completing;
  assert.strictEqual(await har.finish(), result);
  assertValid(result);

  const stopped = await recorder();
  stopped.client.fire('Network.requestWillBeSent', request('response-only'));
  stopped.client.fire('Network.responseReceived', response('response-only'));
  const stoppedResult = await stopped.recorder.finish();
  assert.equal(stoppedResult.incompleteLifecycles[0].kind, 'stopped_before_terminal');
  assertValid(stoppedResult);
});
