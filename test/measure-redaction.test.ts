import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_FILENAME_SLUG_LENGTH,
  MAX_VALUE_LENGTH,
  capArray,
  capString,
  sanitizeFilenameSlug,
  sanitizeString,
} from '../src/cdp/measure/redaction.js';

const REPRESENTATIVE_EVIDENCE = [
  'hunter2-super-secret-password',
  'sk-abcdefghijklmnopqrstuvwxyz123456',
  'github_pat_11ABCDE0000ABCDE0000abcdefghijklmnop',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart',
  'https://example.test/account?token=sk-abcdefghijklmnopqrstuvwxyz123456#billing',
  '4111 1111 1111 1111',
  'person@example.test',
];

test('sanitizeString preserves evidence regardless of value shape', () => {
  for (const value of REPRESENTATIVE_EVIDENCE) {
    assert.equal(sanitizeString(value), value);
  }
});

test('sanitizeString applies only the requested structural cap', () => {
  const value = `prefix:${'x'.repeat(MAX_VALUE_LENGTH)}:suffix`;
  assert.equal(sanitizeString(value), value.slice(0, MAX_VALUE_LENGTH));
  assert.equal(sanitizeString(value, { max: 17 }), value.slice(0, 17));
});

test('capString preserves an uncapped value and reports a capped prefix factually', () => {
  const evidence = REPRESENTATIVE_EVIDENCE.join('|');
  assert.deepEqual(capString(evidence), { value: evidence, capped: false });

  const long = `${evidence}:${'z'.repeat(MAX_VALUE_LENGTH)}`;
  assert.deepEqual(capString(long, 31), { value: long.slice(0, 31), capped: true });
});

test('sanitizeFilenameSlug enforces filename safety without secret-shape replacement', () => {
  const token = 'github_pat_11ABCDE0000ABCDE0000abcdefghijklmnop';
  assert.equal(sanitizeFilenameSlug(token), token);
  assert.equal(sanitizeFilenameSlug(`panel/${token}?active=true`), `panel-${token}-active-true`);
});

test('sanitizeFilenameSlug collapses unsafe runs and applies its cap', () => {
  assert.equal(sanitizeFilenameSlug('  a///b ... c  '), 'a-b-c');
  const value = 'ab-'.repeat(70);
  assert.equal(sanitizeFilenameSlug(value).length, MAX_FILENAME_SLUG_LENGTH);
  assert.equal(sanitizeFilenameSlug('***'), '');
});

test('capArray preserves order and reports only cap overflow', () => {
  assert.deepEqual(capArray(['secret', 'token'], 3), { items: ['secret', 'token'], truncated: 0 });
  assert.deepEqual(capArray(['a', 'b', 'c'], 2), { items: ['a', 'b'], truncated: 1 });
});
