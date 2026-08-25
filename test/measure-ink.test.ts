import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deriveInkBox } from '../src/cdp/measure/ink.js';

const rect = { x: 26.5, y: 142, width: 28, height: 28 };
const base = {
  'box-shadow': 'none',
  'outline-width': '0px',
  'outline-style': 'none',
  'outline-offset': '0px',
  filter: 'none',
  transform: 'none',
};

test('deriveInkBox derives a Tailwind ring from a non-inset spread-only box shadow', () => {
  const result = deriveInkBox(rect, { ...base, 'box-shadow': 'rgba(229, 229, 229, 0.2) 0px 0px 0px 2px' });
  assert.deepEqual(result.inkBox, { x: 24.5, y: 140, width: 32, height: 32 });
  assert.deepEqual(result.contributors, [{
    source: 'box-shadow', index: 1, edges: { top: 2, right: 2, bottom: 2, left: 2 },
  }]);
});

test('deriveInkBox combines outer shadows, excludes inset shadows, and retains each contributor', () => {
  const result = deriveInkBox({ x: 10, y: 20, width: 30, height: 40 }, {
    ...base,
    'box-shadow': 'inset 0px 0px 20px 8px rgb(0, 0, 0), 3px -2px 1px 2px red, -4px 5px 0px 0px blue',
  });
  assert.deepEqual(result.inkBox, { x: 6, y: 15, width: 40, height: 50 });
  assert.deepEqual(result.contributors, [
    { source: 'box-shadow', index: 2, edges: { top: 5, right: 6, bottom: 1, left: 0 }, nominal: true },
    { source: 'box-shadow', index: 3, edges: { top: 0, right: 0, bottom: 5, left: 4 } },
  ]);
});

test('deriveInkBox includes outlines and drop-shadow filters', () => {
  const result = deriveInkBox({ x: 10, y: 20, width: 30, height: 40 }, {
    ...base,
    'outline-width': '2px',
    'outline-style': 'solid',
    'outline-offset': '1px',
    filter: 'brightness(1.1) drop-shadow(rgb(0, 0, 0) -2px 3px 4px)',
  });
  assert.deepEqual(result.inkBox, { x: 4, y: 17, width: 39, height: 50 });
  assert.deepEqual(result.contributors, [
    { source: 'outline', edges: { top: 3, right: 3, bottom: 3, left: 3 } },
    { source: 'filter:drop-shadow', index: 1, edges: { top: 1, right: 2, bottom: 7, left: 6 }, nominal: true },
  ]);
});

test('deriveInkBox refuses a border-box answer when captured ink styles are incomplete or unresolved', () => {
  const missing = deriveInkBox(rect, { 'box-shadow': 'none' });
  assert.equal(missing.inkBox, null);
  assert.deepEqual(missing.missingStyles, ['outline-width', 'outline-style', 'outline-offset', 'filter', 'transform']);

  const unresolved = deriveInkBox(rect, { ...base, filter: 'blur(3px)' });
  assert.equal(unresolved.inkBox, null);
  assert.deepEqual(unresolved.unresolved, ['filter']);

  const transformed = deriveInkBox(rect, { ...base, transform: 'matrix(2, 0, 0, 2, 0, 0)' });
  assert.equal(transformed.inkBox, null);
  assert.deepEqual(transformed.unresolved, ['transform']);
});
