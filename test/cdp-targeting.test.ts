import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs } from '../src/cdp/args.js';
import { requireTargetId, scoreTabUrlMatch } from '../src/cdp/targets.js';

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

test('openTab fails loudly when Target.createTarget returns no targetId', () => {
  assert.throws(
    () => requireTargetId(null, 'https://www.reddit.com/'),
    /returned no targetId/,
  );
});
