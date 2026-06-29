import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from '../src/cdp/args.js';
import { findTabByIdInPorts, requireTargetId, scoreTabUrlMatch } from '../src/cdp/targets.js';

test('CDP_PORT env fills the default port when --port is omitted', () => {
  const previous = process.env.CDP_PORT;
  process.env.CDP_PORT = '49561';

  try {
    const parsed = parseCliArgs(['navigate', 'https://account.godaddy.com/products']);
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

test('openTab fails loudly when Target.createTarget returns no targetId', () => {
  assert.throws(
    () => requireTargetId(null, 'https://www.reddit.com/'),
    /returned no targetId/,
  );
});
