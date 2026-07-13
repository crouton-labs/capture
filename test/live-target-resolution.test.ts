import { test } from 'node:test';
import assert from 'node:assert/strict';

// U02: live target resolution + dispatch helpers (src/interact.ts).
//
// Follows the repo's CDP-stub pattern (see interaction-screenshot-perms.test.ts):
// a fake client answers exactly the CDP calls the code under test makes, and a
// call log proves what was dispatched. The "fixture page" is the stubbed CDP
// surface — DOM query results and a live AX tree.

import {
  resolveLiveTarget,
  clickResolved,
  focusAndType,
  scrollResolved,
  ACCEPTED_LIVE_PREFIXES,
  type LiveClient,
  type ResolvedTarget,
} from '../src/interact.js';
import { CaptureError } from '../src/errors.js';

interface RecordedCall {
  method: string;
  params: Record<string, unknown>;
  /** Set when the call went through the marked-dispatch lane. */
  mark?: string;
}

function stubClient(
  handlers: Record<string, (params: Record<string, unknown>) => unknown>,
  opts: { withMarkedLane?: boolean; withSuppressHook?: boolean } = {},
): LiveClient & { calls: RecordedCall[]; suppressCalls: number } {
  const calls: RecordedCall[] = [];
  const client = {
    calls,
    suppressCalls: 0,
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected CDP call in test stub: ${method}`);
      return handler(params);
    },
  } as LiveClient & { calls: RecordedCall[]; suppressCalls: number };
  if (opts.withMarkedLane) {
    client.sendMarked = async (method, params, mark) => {
      calls.push({ method, params, mark });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected marked CDP call in test stub: ${method}`);
      return handler(params);
    };
  }
  if (opts.withSuppressHook) {
    client.suppressNextFocusClickMark = () => {
      client.suppressCalls += 1;
      calls.push({ method: '__suppressNextFocusClickMark', params: {} });
    };
  }
  return client;
}

// The fixture page's live AX tree: two buttons whose names share the "Send"
// substring, plus a textbox and a nameless/undrivable node.
const AX_FIXTURE_NODES = [
  { nodeId: '1', backendDOMNodeId: 100, role: { value: 'RootWebArea' }, name: { value: 'Fixture' } },
  { nodeId: '5', backendDOMNodeId: 201, role: { value: 'button' }, name: { value: 'Send' } },
  { nodeId: '6', backendDOMNodeId: 202, role: { value: 'button' }, name: { value: 'Send later' } },
  { nodeId: '7', backendDOMNodeId: 203, role: { value: 'textbox' }, name: { value: 'Message' } },
  { nodeId: '8', role: { value: 'group' }, name: { value: 'Send group (no DOM node)' } }, // no backendDOMNodeId → never drivable
];

function axHandlers(): Record<string, (params: Record<string, unknown>) => unknown> {
  return {
    'Accessibility.enable': () => ({}),
    'Accessibility.disable': () => ({}),
    'Accessibility.getFullAXTree': () => ({ nodes: AX_FIXTURE_NODES }),
  };
}

async function caught(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  assert.fail('expected action to reject');
}

// Fixture DOM for CSS queries: `.btn` matches two nodes, `#send` one.
function cssHandlers(matches: number[]): Record<string, (params: Record<string, unknown>) => unknown> {
  const backendByNodeId: Record<number, number> = { 11: 111, 12: 112, 13: 113 };
  const identityByBackendId: Record<number, { role: string; name: string }> = {
    111: { role: 'button', name: 'Save' },
    112: { role: 'button', name: 'Cancel' },
    113: { role: 'link', name: 'Docs' },
  };
  return {
    'DOM.enable': () => ({}),
    'DOM.getDocument': () => ({ root: { nodeId: 1 } }),
    'DOM.querySelectorAll': () => ({ nodeIds: matches }),
    'DOM.describeNode': (params) => ({ node: { backendNodeId: backendByNodeId[params.nodeId as number] } }),
    'Accessibility.getPartialAXTree': (params) => {
      const id = params.backendNodeId as number;
      const identity = identityByBackendId[id];
      if (!identity) throw new Error('no AX node');
      return { nodes: [{ nodeId: `ax-${id}`, backendDOMNodeId: id, role: { value: identity.role }, name: { value: identity.name } }] };
    },
  };
}

// ---------------------------------------------------------------------------
// Resolution — cardinality and per-prefix rules
// ---------------------------------------------------------------------------

test('css: `.btn` matching two nodes fails with two candidates, each carrying its backend id', async () => {
  const client = stubClient(cssHandlers([11, 12]));
  const result = await resolveLiveTarget(client, '.btn');
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.code, 'ambiguous');
  assert.equal(result.kind, 'css');
  assert.equal(result.matchCount, 2);
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(
    result.candidates.map((c) => c.backendNodeId),
    [111, 112],
  );
  assert.deepEqual(result.candidates[0], { backendNodeId: 111, role: 'button', name: 'Save' });
  assert.deepEqual(result.candidates[1], { backendNodeId: 112, role: 'button', name: 'Cancel' });
  // Live CSS query mechanics: DOM.getDocument + DOM.querySelectorAll.
  const methods = client.calls.map((c) => c.method);
  assert.ok(methods.includes('DOM.getDocument'));
  assert.ok(methods.includes('DOM.querySelectorAll'));
});

test('css: a single live match resolves with backend id, role, and name', async () => {
  const client = stubClient(cssHandlers([13]));
  const result = await resolveLiveTarget(client, '#send');
  assert.ok(result.ok);
  assert.deepEqual(result, { ok: true, kind: 'css', backendNodeId: 113, role: 'link', name: 'Docs' });
});

test('css: zero matches fails with no-match and an empty candidate list', async () => {
  const client = stubClient(cssHandlers([]));
  const result = await resolveLiveTarget(client, '.nope');
  assert.ok(!result.ok);
  assert.equal(result.code, 'no-match');
  assert.equal(result.matchCount, 0);
  assert.deepEqual(result.candidates, []);
});

test('ax: substring matching two names ("Send", "Send later") fails with both candidates', async () => {
  const client = stubClient(axHandlers());
  const result = await resolveLiveTarget(client, 'ax:Send');
  assert.ok(!result.ok);
  assert.equal(result.code, 'ambiguous');
  assert.equal(result.kind, 'ax');
  assert.equal(result.matchCount, 2);
  assert.deepEqual(result.candidates, [
    { backendNodeId: 201, role: 'button', name: 'Send' },
    { backendNodeId: 202, role: 'button', name: 'Send later' },
  ]);
});

test('ax: substring with a single live match resolves (case-insensitive)', async () => {
  const client = stubClient(axHandlers());
  const result = await resolveLiveTarget(client, 'ax:LATER');
  assert.ok(result.ok);
  assert.deepEqual(result, { ok: true, kind: 'ax', backendNodeId: 202, role: 'button', name: 'Send later' });
  assert.deepEqual(
    client.calls.map((call) => call.method),
    ['Accessibility.enable', 'Accessibility.getFullAXTree', 'Accessibility.disable'],
  );
});

test('ax: zero matches fails with no-match', async () => {
  const client = stubClient(axHandlers());
  const result = await resolveLiveTarget(client, 'ax:nonexistent');
  assert.ok(!result.ok);
  assert.equal(result.code, 'no-match');
  assert.equal(result.matchCount, 0);
});

test('ax: nodes without a backend DOM node are never candidates', async () => {
  const client = stubClient(axHandlers());
  // "Send group (no DOM node)" also contains the "Send group" substring but
  // has no backendDOMNodeId — it must not appear among matches.
  const result = await resolveLiveTarget(client, 'ax:Send group');
  assert.ok(!result.ok);
  assert.equal(result.code, 'no-match');
});

test('axid: resolves by AX node id from the same live fetch', async () => {
  const client = stubClient(axHandlers());
  const result = await resolveLiveTarget(client, 'axid:7');
  assert.ok(result.ok);
  assert.deepEqual(result, { ok: true, kind: 'axid', backendNodeId: 203, role: 'textbox', name: 'Message' });
});

test('full AX lifecycle: an enable response loss still disables and preserves the primary failure', async () => {
  const primary = new Error('enable response lost');
  const client = stubClient({
    'Accessibility.enable': () => { throw primary; },
    'Accessibility.disable': () => ({}),
  });

  const error = await caught(() => resolveLiveTarget(client, 'ax:Send'));
  assert.equal(error, primary);
  assert.deepEqual(
    client.calls.map((call) => call.method),
    ['Accessibility.enable', 'Accessibility.disable'],
  );
});

test('full AX lifecycle: a tree rejection disables and preserves the primary failure', async () => {
  const primary = new Error('tree transport failed');
  const client = stubClient({
    'Accessibility.enable': () => ({}),
    'Accessibility.getFullAXTree': () => { throw primary; },
    'Accessibility.disable': () => ({}),
  });

  const error = await caught(() => resolveLiveTarget(client, 'ax:Send'));
  assert.equal(error, primary);
  assert.deepEqual(
    client.calls.map((call) => call.method),
    ['Accessibility.enable', 'Accessibility.getFullAXTree', 'Accessibility.disable'],
  );
});

test('full AX lifecycle: malformed nodes throw typed malformed_protocol after cleanup', async () => {
  const response = { nodes: [{ nodeId: 1, role: { value: 'button' } }] };
  const client = stubClient({
    'Accessibility.enable': () => ({}),
    'Accessibility.getFullAXTree': () => response,
    'Accessibility.disable': () => ({}),
  });

  const error = await caught(() => resolveLiveTarget(client, 'ax:Send'));
  assert.ok(error instanceof CaptureError);
  assert.equal(error.descriptor.kind, 'world');
  assert.equal(error.descriptor.code, 'malformed_protocol');
  assert.deepEqual(error.descriptor.cause, { method: 'Accessibility.getFullAXTree', response });
  assert.deepEqual(
    client.calls.map((call) => call.method),
    ['Accessibility.enable', 'Accessibility.getFullAXTree', 'Accessibility.disable'],
  );
});

test('full AX lifecycle: a disable failure prevents success as a typed cleanup failure', async () => {
  const cleanup = new Error('disable failed');
  const client = stubClient({
    'Accessibility.enable': () => ({}),
    'Accessibility.getFullAXTree': () => ({ nodes: AX_FIXTURE_NODES }),
    'Accessibility.disable': () => { throw cleanup; },
  });

  const error = await caught(() => resolveLiveTarget(client, 'ax:LATER'));
  assert.ok(error instanceof CaptureError);
  assert.equal(error.descriptor.kind, 'cleanup');
  assert.equal(error.descriptor.code, 'accessibility_cleanup_failed');
  assert.equal(error.descriptor.cause, cleanup);
  assert.deepEqual(
    client.calls.map((call) => call.method),
    ['Accessibility.enable', 'Accessibility.getFullAXTree', 'Accessibility.disable'],
  );
});

test('full AX lifecycle: dual tree and disable failures retain primary and cleanup facts', async () => {
  const primary = new Error('tree failed');
  const cleanup = new Error('disable failed');
  const client = stubClient({
    'Accessibility.enable': () => ({}),
    'Accessibility.getFullAXTree': () => { throw primary; },
    'Accessibility.disable': () => { throw cleanup; },
  });

  const error = await caught(() => resolveLiveTarget(client, 'ax:Send'));
  assert.ok(error instanceof AggregateError);
  assert.equal(error.cause, primary);
  assert.equal(error.errors[0], primary);
  assert.ok(error.errors[1] instanceof CaptureError);
  assert.equal(error.errors[1].descriptor.kind, 'cleanup');
  assert.equal(error.errors[1].descriptor.code, 'accessibility_cleanup_failed');
  assert.equal(error.errors[1].descriptor.cause, cleanup);
  assert.deepEqual(
    client.calls.map((call) => call.method),
    ['Accessibility.enable', 'Accessibility.getFullAXTree', 'Accessibility.disable'],
  );
});

test('backend: resolves by identity, enriched with best-effort AX role/name', async () => {
  const client = stubClient({
    'Accessibility.getPartialAXTree': () => ({
      nodes: [{ nodeId: 'ax-42', backendDOMNodeId: 42, role: { value: 'button' }, name: { value: 'Send' } }],
    }),
  });
  const result = await resolveLiveTarget(client, 'backend:42');
  assert.ok(result.ok);
  assert.deepEqual(result, { ok: true, kind: 'backend', backendNodeId: 42, role: 'button', name: 'Send' });
});

test('backend: identity survives a failing AX enrichment (role/name null)', async () => {
  const client = stubClient({
    'Accessibility.getPartialAXTree': () => {
      throw new Error('No AX node for this backend id');
    },
  });
  const result = await resolveLiveTarget(client, 'backend:99');
  assert.ok(result.ok);
  assert.deepEqual(result, { ok: true, kind: 'backend', backendNodeId: 99, role: null, name: null });
});

test('backend: a non-numeric id fails as no-match without any CDP call', async () => {
  const client = stubClient({});
  const result = await resolveLiveTarget(client, 'backend:abc');
  assert.ok(!result.ok);
  assert.equal(result.code, 'no-match');
  assert.equal(client.calls.length, 0);
});

test('text: is rejected with a typed failure naming the accepted prefixes, without any CDP call', async () => {
  const client = stubClient({});
  const result = await resolveLiveTarget(client, 'text:x');
  assert.ok(!result.ok);
  assert.equal(result.code, 'unsupported-prefix');
  assert.equal(result.input, 'text:x');
  assert.deepEqual([...result.acceptedPrefixes], ['css', 'ax:', 'axid:', 'backend:']);
  assert.deepEqual([...ACCEPTED_LIVE_PREFIXES], ['css', 'ax:', 'axid:', 'backend:']);
  assert.equal(client.calls.length, 0, 'a rejected prefix must never touch the page');
});

// ---------------------------------------------------------------------------
// Dispatch helpers
// ---------------------------------------------------------------------------

const RESOLVED_BUTTON: ResolvedTarget = { ok: true, kind: 'ax', backendNodeId: 201, role: 'button', name: 'Send' };

function dispatchHandlers(): Record<string, (params: Record<string, unknown>) => unknown> {
  return {
    'DOM.scrollIntoViewIfNeeded': () => ({}),
    'DOM.getBoxModel': () => ({ model: { content: [10, 10, 30, 10, 30, 20, 10, 20] } }),
    'Input.dispatchMouseEvent': () => ({}),
    'Input.insertText': () => ({}),
  };
}

test('clickResolved: scrollIntoView → box model → press/release at the content-quad center', async () => {
  const client = stubClient(dispatchHandlers());
  const dispatch = await clickResolved(client, RESOLVED_BUTTON);

  assert.deepEqual(dispatch, { backendNodeId: 201, role: 'button', name: 'Send', x: 20, y: 15 });

  const methods = client.calls.map((c) => c.method);
  assert.deepEqual(methods, [
    'DOM.scrollIntoViewIfNeeded',
    'DOM.getBoxModel',
    'Input.dispatchMouseEvent',
    'Input.dispatchMouseEvent',
  ]);
  const mouse = client.calls.filter((c) => c.method === 'Input.dispatchMouseEvent');
  assert.deepEqual(
    mouse.map((c) => [c.params.type, c.params.x, c.params.y]),
    [
      ['mousePressed', 20, 15],
      ['mouseReleased', 20, 15],
    ],
  );
});

test('focusAndType: suppresses the focus-click mark, clicks, then inserts the text', async () => {
  const client = stubClient(dispatchHandlers(), { withSuppressHook: true });
  const dispatch = await focusAndType(client, RESOLVED_BUTTON, 'hello world');

  assert.equal(client.suppressCalls, 1);
  const methods = client.calls.map((c) => c.method);
  assert.ok(
    methods.indexOf('__suppressNextFocusClickMark') < methods.indexOf('Input.dispatchMouseEvent'),
    'the suppress hook must be armed before the focus click dispatches',
  );
  const insert = client.calls.find((c) => c.method === 'Input.insertText');
  assert.ok(insert);
  assert.equal(insert.params.text, 'hello world');
  assert.ok(
    methods.indexOf('Input.insertText') > methods.lastIndexOf('Input.dispatchMouseEvent'),
    'text insertion must follow the focus click',
  );
  assert.deepEqual(dispatch, { backendNodeId: 201, role: 'button', name: 'Send', x: 20, y: 15 });
});

test('focusAndType: works against a client without the recorder hook', async () => {
  const client = stubClient(dispatchHandlers());
  const dispatch = await focusAndType(client, RESOLVED_BUTTON, 'plain');
  assert.equal(dispatch.backendNodeId, 201);
  assert.ok(client.calls.some((c) => c.method === 'Input.insertText'));
});

function scrollHandlers(resultingScrollTop: number): Record<string, (params: Record<string, unknown>) => unknown> {
  return {
    'DOM.resolveNode': () => ({ object: { objectId: 'obj-1' } }),
    'Runtime.callFunctionOn': () => ({ result: { value: resultingScrollTop } }),
  };
}

test('scrollResolved: resolves the node to an object and drives scrollTop with the destination as data', async () => {
  const client = stubClient(scrollHandlers(640));
  const dispatch = await scrollResolved(client, RESOLVED_BUTTON, 'bottom');

  assert.deepEqual(dispatch, { backendNodeId: 201, role: 'button', name: 'Send', to: 'bottom', scrollTop: 640 });

  const resolveCall = client.calls.find((c) => c.method === 'DOM.resolveNode');
  assert.ok(resolveCall);
  assert.equal(resolveCall.params.backendNodeId, 201);

  const scrollCall = client.calls.find((c) => c.method === 'Runtime.callFunctionOn');
  assert.ok(scrollCall);
  assert.equal(scrollCall.params.objectId, 'obj-1');
  assert.equal(scrollCall.params.returnByValue, true);
  // The destination travels as an argument (data), never concatenated into code.
  assert.deepEqual(scrollCall.params.arguments, [{ value: 'bottom' }]);
  assert.ok(String(scrollCall.params.functionDeclaration).includes('scrollTop'));
});

test('scrollResolved: accepts a pixel offset destination', async () => {
  const client = stubClient(scrollHandlers(250));
  const dispatch = await scrollResolved(client, RESOLVED_BUTTON, '250');
  assert.equal(dispatch.scrollTop, 250);
  assert.equal(dispatch.to, '250');
  const scrollCall = client.calls.find((c) => c.method === 'Runtime.callFunctionOn');
  assert.deepEqual(scrollCall?.params.arguments, [{ value: '250' }]);
});

test('scrollResolved: an invalid destination throws before any CDP call', async () => {
  const client = stubClient({});
  await assert.rejects(
    () => scrollResolved(client, RESOLVED_BUTTON, 'sideways'),
    /Invalid scroll destination/,
  );
  assert.equal(client.calls.length, 0);
});

test('scrollResolved: carries the recorder landmark on the one mutating call when the transport supports marks', async () => {
  const client = stubClient(scrollHandlers(999), { withMarkedLane: true });
  await scrollResolved(client, RESOLVED_BUTTON, 'bottom', { mark: 'scroll:.feed,to=bottom' });

  const resolveCall = client.calls.find((c) => c.method === 'DOM.resolveNode');
  assert.equal(resolveCall?.mark, undefined, 'node resolution is incidental — never marked');
  const scrollCall = client.calls.find((c) => c.method === 'Runtime.callFunctionOn');
  assert.equal(scrollCall?.mark, 'scroll:.feed,to=bottom', 'the scrollTop mutation carries the landmark');
});

test('scrollResolved: a marked call degrades to plain send when the transport has no marked lane', async () => {
  const client = stubClient(scrollHandlers(5));
  const dispatch = await scrollResolved(client, RESOLVED_BUTTON, 'top', { mark: 'scroll:.feed,to=top' });
  assert.equal(dispatch.scrollTop, 5);
  assert.ok(client.calls.every((c) => c.mark === undefined));
});

test('scrollResolved: an in-page exception surfaces as an error', async () => {
  const client = stubClient({
    'DOM.resolveNode': () => ({ object: { objectId: 'obj-1' } }),
    'Runtime.callFunctionOn': () => ({ exceptionDetails: { text: 'boom' } }),
  });
  await assert.rejects(() => scrollResolved(client, RESOLVED_BUTTON, 'top'), /boom/);
});
