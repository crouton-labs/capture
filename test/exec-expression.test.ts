import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExecExpression } from '../src/cdp/exec-expression.js';

test('plain expressions stay unwrapped', () => {
  assert.equal(buildExecExpression('document.title'), 'document.title');
});

test('top-level return snippets are wrapped in an async IIFE', () => {
  assert.equal(
    buildExecExpression('return document.title;'),
    '(async () => { return document.title; })()',
  );
});
