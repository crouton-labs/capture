import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseCliArgs, resolveCliContext } from '../src/cdp/args.js';
import { AmbiguousPageTargetError, findTabByIdInPorts, findUnambiguousPageTabInPorts, requireTargetId, scoreTabUrlMatch } from '../src/cdp/targets.js';
import { CAPTURE_ROOT } from '../src/session/artifacts.js';

// U14 — target provenance is recorded at the assignment point as
// `targetSource: 'flag' | 'session' | 'env'`, never inferred later by
// comparing final strings.

test('a bare invocation with no target records no provenance', () => {
  const parsed = parseCliArgs(['click', 'Sign in']);
  assert.equal(parsed.target, undefined);
  assert.equal(parsed.targetSource, undefined);
});

test('an explicit --port records flag provenance at parse time', () => {
  const parsed = parseCliArgs(['cdp', 'Browser.getVersion', '--port', '9222']);
  assert.equal(parsed.port, 9222);
  assert.equal(parsed.portSource, 'flag');
});

test('an explicit --target records flag provenance at parse time', () => {
  const parsed = parseCliArgs(['click', 'Sign in', '--target', 'abc123']);
  assert.equal(parsed.target, 'abc123');
  assert.equal(parsed.targetSource, 'flag');
});

test('an ordinary page command retains active-session target autofill tagged session', async () => {
  const { setActiveSession, clearActiveSession } = await import('../src/session-context.js');
  const prevNodeId = process.env.CRTR_NODE_ID;
  const prevTarget = process.env.CDP_TARGET;
  const dir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'u14-page-autofill-'));
  try {
    process.env.CRTR_NODE_ID = 'u14-page-autofill';
    delete process.env.CDP_TARGET;
    await setActiveSession({ sessionId: 'sess-page', dir, harId: null, targetId: 'session-target', stepCount: 0 });
    const parsed = resolveCliContext(parseCliArgs(['click', 'Create applet']));
    assert.equal(parsed.target, 'session-target', 'page scope keeps ordinary session autofill');
    assert.equal(parsed.targetSource, 'session');
  } finally {
    clearActiveSession();
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
    if (prevTarget === undefined) delete process.env.CDP_TARGET;
    else process.env.CDP_TARGET = prevTarget;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CDP_PORT env fills the default port when --port is omitted', () => {
  const previous = process.env.CDP_PORT;
  process.env.CDP_PORT = '49561';

  try {
    const parsed = resolveCliContext(parseCliArgs(['navigate', 'https://account.godaddy.com/products']));
    assert.equal(parsed.port, 49561);
  } finally {
    if (previous === undefined) {
      delete process.env.CDP_PORT;
    } else {
      process.env.CDP_PORT = previous;
    }
  }
});

test('URL matching prefers the exact requested page over same-host login pages', () => {
  const exact = scoreTabUrlMatch(
    'https://account.godaddy.com/products',
    'https://account.godaddy.com/products',
  );
  const login = scoreTabUrlMatch(
    'https://account.godaddy.com/sign-in',
    'https://account.godaddy.com/products',
  );

  assert.ok(exact > login);
});

test('URL matching never treats two loopback dev servers on different ports as the same host', () => {
  // Regression for an evidence-integrity bug: `measure snap
  // http://127.0.0.1:45999/` scored a match against an unrelated already-open
  // tab at `http://127.0.0.1:57581/` because host comparison ignored the
  // port, so "same host, same root path" alone was enough to win with no
  // better candidate present — and the snapshot silently captured the wrong
  // page. Distinct ports on the same loopback address are distinct origins.
  const differentPortSameRoot = scoreTabUrlMatch(
    'http://127.0.0.1:57581/',
    'http://127.0.0.1:45999/',
  );
  assert.equal(differentPortSameRoot, 0);

  const samePortSameRoot = scoreTabUrlMatch(
    'http://127.0.0.1:45999/',
    'http://127.0.0.1:45999/',
  );
  assert.equal(samePortSameRoot, 100);
});

test('explicit ports stay explicit when target resolution falls back to a port list', async () => {
  const calls: number[] = [];
  const resolved = await findTabByIdInPorts('tab-2', [1111, 2222, 3333], async (port, targetId) => {
    calls.push(port);
    if (port === 2222 && targetId === 'tab-2') {
      return { id: 'tab-2', title: '', url: 'https://www.reddit.com/', type: 'page', webSocketDebuggerUrl: 'ws://localhost:2222/devtools/page/tab-2' };
    }
    return null;
  });

  assert.deepEqual(calls, [1111, 2222]);
  assert.equal(resolved?.port, 2222);
  assert.equal(resolved?.tab.id, 'tab-2');
});

test('an omitted target resolves the one page tab across selected endpoints', async () => {
  const resolved = await findUnambiguousPageTabInPorts([9222], async () => [
    { id: 'only-page', title: 'Fixture', url: 'http://fixture.test/', type: 'page', webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/only-page' },
    { id: 'worker', title: '', url: '', type: 'service_worker', webSocketDebuggerUrl: undefined },
  ]);
  assert.deepEqual(resolved, {
    port: 9222,
    tab: { id: 'only-page', title: 'Fixture', url: 'http://fixture.test/', type: 'page', webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/only-page' },
  });
});

test('an omitted target rejects two page tabs with their candidate list', async () => {
  await assert.rejects(
    () => findUnambiguousPageTabInPorts([9222], async () => [
      { id: 'first-page', title: 'First', url: 'http://first.test/', type: 'page', webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/first-page' },
      { id: 'second-page', title: 'Second', url: 'http://second.test/', type: 'page', webSocketDebuggerUrl: 'ws://localhost:9222/devtools/page/second-page' },
    ]),
    (error: unknown) => {
      assert.ok(error instanceof AmbiguousPageTargetError);
      assert.match(error.message, /first-pa/);
      assert.match(error.message, /second-p/);
      assert.match(error.message, /Use --target/);
      return true;
    },
  );
});

test('openTab fails loudly when Target.createTarget returns no targetId', () => {
  assert.throws(
    () => requireTargetId(null, 'https://www.reddit.com/'),
    /returned no targetId/,
  );
});
