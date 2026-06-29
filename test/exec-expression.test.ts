import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExecExpression } from '../src/cdp/exec-expression.js';

test('plain expressions stay unwrapped', () => {
  assert.equal(buildExecExpression('document.title'), 'document.title');
});

test('top-level await expressions are preserved', () => {
  assert.equal(
    buildExecExpression('await Promise.resolve(42)'),
    '(async () => (await Promise.resolve(42)))()',
  );
});

test('top-level return snippets are wrapped in an async IIFE', () => {
  assert.equal(
    buildExecExpression('return document.title;'),
    '(async () => { return document.title; })()',
  );
});

test('strings and nested functions containing await/return stay expression-safe', () => {
  const code = '(() => "return await")()';
  assert.equal(buildExecExpression(code), code);
});

test('declarations followed by a final expression preserve the final value', async () => {
  const code = 'const f = () => { return 42; }; f()';
  assert.equal(await eval(buildExecExpression(code)), 42);
});

test('string tokens inside statements do not block the final expression value', async () => {
  const code = 'const note = "return await"; note';
  assert.equal(await eval(buildExecExpression(code)), 'return await');
});
