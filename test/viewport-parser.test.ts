import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseViewport } from '../src/cdp/viewport.js';

test('parseViewport accepts the exact lowercase positive-safe-integer grammar at its boundaries', () => {
  assert.deepEqual(parseViewport('1x1'), { width: 1, height: 1 });
  assert.deepEqual(parseViewport('390x844'), { width: 390, height: 844 });
  assert.deepEqual(
    parseViewport('9007199254740991x9007199254740991'),
    { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
  );
});

test('parseViewport rejects every non-canonical or unsafe component', () => {
  const invalid = [
    '',
    ' 390x844',
    '390x844 ',
    '390 x844',
    '390x 844',
    '390X844',
    '+390x844',
    '390x+844',
    '-390x844',
    '390x-844',
    '390.0x844',
    '390x844.0',
    '39e1x844',
    '390x8.44e2',
    'desktop',
    'mobile',
    '0x844',
    '390x0',
    '01x844',
    '390x0844',
    '9007199254740992x1',
    '1x9007199254740992',
    '999999999999999999999999999999999999999999x1',
    '1x999999999999999999999999999999999999999999',
  ];

  for (const value of invalid) {
    assert.throws(
      () => parseViewport(value),
      /<positive-safe-int>x<positive-safe-int>/,
      `expected ${JSON.stringify(value)} to be rejected`,
    );
  }
});
