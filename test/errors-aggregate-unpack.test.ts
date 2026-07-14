/**
 * Root-boundary AggregateError unpack: a dual-failure envelope (primary +
 * cleanup, produced by e.g. screenshot device-metrics restore or AX-disable
 * teardown) must render BOTH sub-messages in the one error an agent sees,
 * typed with the primary sub-failure's kind/code — never just the envelope
 * message as an opaque internal_error.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureError, failureResult, normalizeFailure } from '../src/errors.js';

test('a dual-failure AggregateError normalizes to the primary kind/code with both sub-messages distinguishable', () => {
  const primary = captureError('world', 'screenshot_failed', 'Primary boom.');
  const cleanup = captureError('cleanup', 'metrics_cleanup_failed', 'Cleanup boom.');
  const envelope = new AggregateError(
    [primary, cleanup],
    'Screenshot capture failed and device-metrics cleanup also failed.',
    { cause: primary },
  );

  const { descriptor } = normalizeFailure(envelope);
  assert.equal(descriptor.kind, 'world');
  assert.equal(descriptor.code, 'screenshot_failed');
  assert.ok(descriptor.message.includes('Screenshot capture failed and device-metrics cleanup also failed.'), descriptor.message);
  assert.ok(descriptor.message.includes('Primary boom.'), descriptor.message);
  assert.ok(descriptor.message.includes('Cleanup boom.'), descriptor.message);

  const result = failureResult(envelope);
  assert.equal(result.tag, 'error');
  assert.equal(result.attrs.code, 'screenshot_failed');
  assert.equal(result.attrs.kind, 'world');
});

test('untyped sub-errors in an AggregateError still surface both messages (normalized recursively)', () => {
  const envelope = new AggregateError([new Error('raw primary'), new Error('raw cleanup')], '');
  const { descriptor } = normalizeFailure(envelope);
  // An untyped primary normalizes to internal_error — the vocabulary rule for
  // any untyped throw — but both messages must still render.
  assert.equal(descriptor.kind, 'internal');
  assert.equal(descriptor.code, 'internal_error');
  assert.ok(descriptor.message.includes('raw primary'), descriptor.message);
  assert.ok(descriptor.message.includes('raw cleanup'), descriptor.message);
});
