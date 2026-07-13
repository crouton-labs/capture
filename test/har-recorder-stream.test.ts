import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { type HarAppendBatch, validateHarAppendBatch } from '../src/har-manager.js';
import { HARRecorder, type HarSink } from '../src/cdp/har-recorder.js';

class FakeClient extends EventEmitter {
  calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  bodies = new Map<string, unknown>();
  defaultBody: unknown = { body: '', base64Encoded: false };

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'Network.getResponseBody') {
      const body = this.bodies.has(params.requestId as string) ? this.bodies.get(params.requestId as string) : this.defaultBody;
      if (body instanceof Error) throw body;
      return body;
    }
    return {};
  }

  fire(event: string, params: unknown): void {
    this.emit(event, params);
  }
}

function request(requestId: string, url: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId,
    timestamp: 10,
    wallTime: 1_700_000_000,
    request: { method: 'GET', url, headers: { Accept: '*/*' } },
    ...overrides,
  };
}

function response(requestId: string, timestamp = 12, status = 200): Record<string, unknown> {
  return { requestId, timestamp, response: { url: 'https://example.test/any', status, headers: { 'Content-Type': 'application/octet-stream' } } };
}

function finished(requestId: string, timestamp = 15): Record<string, unknown> {
  return { requestId, timestamp, encodedDataLength: 42 };
}

interface RecordedSink {
  sink: HarSink;
  batches: HarAppendBatch[];
  overlapped: boolean;
}

function recordedSink(): RecordedSink {
  const record: RecordedSink = { batches: [], overlapped: false, sink: undefined as never };
  let inFlight = 0;
  record.sink = async (batch) => {
    inFlight++;
    if (inFlight > 1) record.overlapped = true;
    await Promise.resolve();
    record.batches.push(batch);
    inFlight--;
  };
  return record;
}

async function streaming(sink: HarSink): Promise<{ client: FakeClient; recorder: HARRecorder }> {
  const client = new FakeClient();
  const har = new HARRecorder(client as never, sink);
  await har.start();
  assert.equal(client.calls[0].method, 'Network.enable');
  return { client, recorder: har };
}

function values(batches: HarAppendBatch[]): { entries: string[]; incomplete: Array<{ kind: string; url: string }> } {
  const entries: string[] = [];
  const incomplete: Array<{ kind: string; url: string }> = [];
  for (const batch of batches) {
    for (const entry of batch.entries) entries.push(entry.request.url);
    for (const lifecycle of batch.incompleteLifecycles) incomplete.push({ kind: lifecycle.kind, url: lifecycle.request.url });
  }
  return { entries, incomplete };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  return { promise: new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }), resolve, reject };
}

test('retains png, font, blocked-analytics, and unfinished-beacon traffic without any URL/extension/domain filtering', async () => {
  const record = recordedSink();
  const { client, recorder: har } = await streaming(record.sink);
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
  client.bodies.set('png', { body: pngBytes.toString('base64'), base64Encoded: true });
  client.bodies.set('font', { body: 'woff2-bytes', base64Encoded: false });

  client.fire('Network.requestWillBeSent', request('png', 'https://cdn.example.test/img/logo.png'));
  client.fire('Network.responseReceived', response('png'));
  client.fire('Network.loadingFinished', finished('png'));

  client.fire('Network.requestWillBeSent', request('font', 'https://fonts.gstatic.example/s/roboto/v30/font.woff2'));
  client.fire('Network.responseReceived', response('font'));
  client.fire('Network.loadingFinished', finished('font'));

  client.fire('Network.requestWillBeSent', request('analytics', 'https://www.google-analytics.example/collect?v=1&t=pageview'));
  client.fire('Network.loadingFailed', { requestId: 'analytics', timestamp: 14, errorText: 'net::ERR_BLOCKED_BY_CLIENT', canceled: false, blockedReason: 'inspector', type: 'Ping' });

  client.fire('Network.requestWillBeSent', request('beacon', 'https://tracker.example/beacon.gif?event=click'));

  await har.drain();
  const { entries, incomplete } = values(record.batches);
  // Completion order: the blocked request materializes synchronously (no body
  // fetch) while png/font wait one async body round-trip each.
  assert.deepEqual(entries, [
    'https://www.google-analytics.example/collect?v=1&t=pageview',
    'https://cdn.example.test/img/logo.png',
    'https://fonts.gstatic.example/s/roboto/v30/font.woff2',
  ]);
  assert.deepEqual(incomplete, [{ kind: 'stopped_before_terminal', url: 'https://tracker.example/beacon.gif?event=click' }]);

  // Binary evidence round-trips through the stream unchanged.
  const png = record.batches.flatMap((batch) => batch.entries).find((entry) => entry.request.url.endsWith('.png'))!;
  assert.equal(png.response.content.encoding, 'base64');
  assert.deepEqual(Buffer.from(png.response.content.text!, 'base64'), pngBytes);
  const analytics = record.batches.flatMap((batch) => batch.entries).find((entry) => entry.request.url.includes('collect'))!;
  assert.deepEqual(analytics._capture.terminal, { kind: 'failed', errorText: 'net::ERR_BLOCKED_BY_CLIENT', canceled: false, blockedReason: 'inspector', resourceType: 'Ping' });
  assert.deepEqual(analytics._capture.body, { state: 'not_applicable', reason: 'no_response' });
});

test('emits each value exactly once as a validated frozen single-value batch, serialized in completion order', async () => {
  const record = recordedSink();
  const { client, recorder: har } = await streaming(record.sink);
  const slowBody = deferred<unknown>();
  client.bodies.set('slow', slowBody.promise);
  client.bodies.set('fast', { body: 'fast-body', base64Encoded: false });

  client.fire('Network.requestWillBeSent', request('slow', 'https://example.test/slow'));
  client.fire('Network.responseReceived', response('slow'));
  client.fire('Network.loadingFinished', finished('slow'));
  client.fire('Network.requestWillBeSent', request('fast', 'https://example.test/fast'));
  client.fire('Network.responseReceived', response('fast'));
  client.fire('Network.loadingFinished', finished('fast'));

  // A pending body never blocks other completions: fast's entry streams while
  // slow's body fetch is still in flight (settle the microtask queue only).
  await new Promise((tick) => setImmediate(tick));
  assert.deepEqual(values(record.batches).entries, ['https://example.test/fast']);
  slowBody.resolve({ body: 'slow-body', base64Encoded: false });
  await har.drain();

  // Completion order, one value per batch, no duplicates, no overlap.
  assert.deepEqual(values(record.batches).entries, ['https://example.test/fast', 'https://example.test/slow']);
  assert.equal(record.batches.length, 2);
  assert.equal(record.overlapped, false);
  for (const batch of record.batches) {
    assert.equal(batch.entries.length + batch.incompleteLifecycles.length, 1);
    assert(Object.isFrozen(batch));
    assert(Object.isFrozen(batch.entries));
    assert.deepEqual(validateHarAppendBatch(batch, 'emitted stream batch'), batch);
  }
});

test('flush waits for in-flight body and append work and surfaces the entry before resolving', async () => {
  const record = recordedSink();
  const { client, recorder: har } = await streaming(record.sink);
  const body = deferred<unknown>();
  client.bodies.set('r', body.promise);
  client.fire('Network.requestWillBeSent', request('r', 'https://example.test/pending'));
  client.fire('Network.responseReceived', response('r'));
  client.fire('Network.loadingFinished', finished('r'));

  let flushed = false;
  const barrier = har.flush().then(() => { flushed = true; });
  await Promise.resolve();
  assert.equal(flushed, false);
  assert.equal(record.batches.length, 0);
  body.resolve({ body: 'now', base64Encoded: false });
  await barrier;
  assert.equal(flushed, true);
  assert.deepEqual(values(record.batches).entries, ['https://example.test/pending']);
});

test('drain cuts admission on its first synchronous line: post-cut events cannot allocate or mutate while pre-cut work drains', async () => {
  const record = recordedSink();
  const { client, recorder: har } = await streaming(record.sink);
  const body = deferred<unknown>();
  client.bodies.set('completed', body.promise);

  client.fire('Network.requestWillBeSent', request('completed', 'https://example.test/completed'));
  client.fire('Network.responseReceived', response('completed'));
  client.fire('Network.loadingFinished', finished('completed'));
  client.fire('Network.requestWillBeSent', request('open', 'https://example.test/open'));
  client.fire('Network.responseReceived', response('open'));

  const draining = har.drain();
  // Post-cut: a new allocation and a terminal for the open request are both dropped.
  client.fire('Network.requestWillBeSent', request('late', 'https://example.test/late'));
  client.fire('Network.loadingFinished', finished('open', 16));
  body.resolve({ body: 'pre-cut body', base64Encoded: false });
  await draining;

  const { entries, incomplete } = values(record.batches);
  assert.deepEqual(entries, ['https://example.test/completed']);
  assert.deepEqual(incomplete, [{ kind: 'stopped_before_terminal', url: 'https://example.test/open' }]);
  const open = record.batches.flatMap((batch) => batch.incompleteLifecycles)[0] as { _capture: { response: unknown } };
  assert.deepEqual(open._capture.response, { status: 200, headers: [{ name: 'Content-Type', value: 'application/octet-stream' }], responseMonotonic: 12 });
});

test('a rejected sink append latches as the fatal store error: no further emission, and flush/drain reject without resetting', async () => {
  const failure = new Error('append authority failed');
  let sinkCalls = 0;
  const sink: HarSink = async () => {
    sinkCalls++;
    throw failure;
  };
  const { client, recorder: har } = await streaming(sink);
  client.defaultBody = { body: 'x', base64Encoded: false };
  client.fire('Network.requestWillBeSent', request('a', 'https://example.test/a'));
  client.fire('Network.responseReceived', response('a'));
  client.fire('Network.loadingFinished', finished('a'));
  await assert.rejects(har.flush(), (error) => error === failure);

  // Later traffic is dropped, never re-emitted, and the failure stays latched.
  client.fire('Network.requestWillBeSent', request('b', 'https://example.test/b'));
  client.fire('Network.responseReceived', response('b'));
  client.fire('Network.loadingFinished', finished('b'));
  await assert.rejects(har.drain(), (error) => error === failure);
  await assert.rejects(har.drain(), (error) => error === failure);
  assert.equal(sinkCalls, 1);
});

test('drain is idempotent and finalizes the frozen active map exactly once', async () => {
  const record = recordedSink();
  const { client, recorder: har } = await streaming(record.sink);
  client.defaultBody = { body: 'done', base64Encoded: false };
  client.fire('Network.requestWillBeSent', request('done', 'https://example.test/done'));
  client.fire('Network.responseReceived', response('done'));
  client.fire('Network.loadingFinished', finished('done'));
  await har.flush();
  client.fire('Network.requestWillBeSent', request('open', 'https://example.test/open'));

  const first = har.drain();
  const second = har.drain();
  await Promise.all([first, second]);
  await har.drain();
  const { entries, incomplete } = values(record.batches);
  assert.deepEqual(entries, ['https://example.test/done']);
  assert.deepEqual(incomplete, [{ kind: 'stopped_before_terminal', url: 'https://example.test/open' }]);
  assert.equal(record.batches.length, 2);
});

test('redirect generations stream as independent exactly-once entries and fetch only the final body', async () => {
  const record = recordedSink();
  const { client, recorder: har } = await streaming(record.sink);
  client.defaultBody = { body: 'landing', base64Encoded: false };
  client.fire('Network.requestWillBeSent', request('same', 'https://example.test/start'));
  client.fire('Network.requestWillBeSent', request('same', 'https://example.test/next', { timestamp: 20, wallTime: 1_700_000_001, redirectResponse: { url: 'https://example.test/start', status: 302, headers: { Location: '/next' } } }));
  client.fire('Network.responseReceived', response('same', 21));
  client.fire('Network.loadingFinished', finished('same', 22));
  await har.drain();

  const entries = record.batches.flatMap((batch) => batch.entries);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]._capture.generation, 1);
  assert.equal(entries[0]._capture.terminal.kind, 'redirect');
  assert.equal(entries[0].response.status, 302);
  assert.equal(entries[1]._capture.generation, 2);
  assert.equal(entries[1]._capture.terminal.kind, 'finished');
  assert.equal(client.calls.filter((call) => call.method === 'Network.getResponseBody').length, 1);
});

test('malformed owned traffic latches fatal in streaming mode and drain rejects with it', async () => {
  const record = recordedSink();
  const { client, recorder: har } = await streaming(record.sink);
  client.fire('Network.requestWillBeSent', request('owned', 'https://example.test/owned'));
  client.fire('Network.loadingFinished', { requestId: 'owned', timestamp: 'bad', encodedDataLength: 1 });
  await assert.rejects(har.drain(), /Malformed owned Network event/);
  assert.equal(record.batches.length, 0);
});

test('wall/monotonic provenance and factual duration survive the stream unchanged', async () => {
  const record = recordedSink();
  const { client, recorder: har } = await streaming(record.sink);
  client.defaultBody = { body: 'hello', base64Encoded: false };
  client.fire('Network.requestWillBeSent', request('r', 'https://example.test/clock'));
  client.fire('Network.responseReceived', response('r', 12.25));
  client.fire('Network.loadingFinished', finished('r', 18.5));
  await har.drain();
  const entry = record.batches[0].entries[0];
  assert.equal(entry.startedDateTime, new Date(1_700_000_000_000).toISOString());
  assert.equal(entry.time, 8500);
  assert.deepEqual(entry._capture.clocks, { requestWallTime: 1_700_000_000, requestMonotonic: 10, responseMonotonic: 12.25, terminalMonotonic: 18.5 });
});

test('mode misuse throws: snapshot finalizers are unavailable when streaming, stream verbs are unavailable when snapshotting', async () => {
  const record = recordedSink();
  const stream = await streaming(record.sink);
  await assert.rejects(stream.recorder.finish(), /snapshot-only/);
  assert.throws(() => stream.recorder.finishPartial(), /snapshot-only/);

  const client = new FakeClient();
  const snapshot = new HARRecorder(client as never);
  await snapshot.start();
  await assert.rejects(snapshot.flush(), /streaming HAR recorder/);
  await assert.rejects(snapshot.drain(), /streaming HAR recorder/);
  // Misuse rejection did not finalize or poison the snapshot recorder.
  client.fire('Network.requestWillBeSent', request('r', 'https://example.test/still-recording'));
  client.fire('Network.responseReceived', response('r'));
  client.fire('Network.loadingFinished', finished('r'));
  const result = await snapshot.finish();
  assert.equal(result.log.entries.length, 1);
});
