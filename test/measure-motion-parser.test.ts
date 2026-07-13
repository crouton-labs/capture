import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CaptureError } from '../src/errors.js';
import { parseCliArgs, resolveCliContext } from '../src/cdp/args.js';

function assertCaptureError(fn: () => unknown, code = 'invalid_input'): void {
  assert.throws(fn, (error: unknown) => error instanceof CaptureError && error.descriptor.code === code);
}

test('measure snap flags parse correctly', () => {
  const parsed = parseCliArgs([
    'measure',
    'snap',
    '--freeze-animations',
    '--settle-timeout',
    '15000',
    '--capture-unsettled',
    '--pixels',
    '--state',
    'hover:button.send-btn',
    '--state',
    'focus-visible:input.search',
  ]);

  assert.equal(parsed.freezeAnimations, true);
  assert.equal(parsed.settleTimeout, 15000);
  assert.equal(parsed.captureUnsettled, true);
  assert.equal(parsed.pixels, true);
  assert.deepEqual(parsed.state, ['hover:button.send-btn', 'focus-visible:input.search']);
});

test('measure check flags parse correctly', () => {
  const parsed = parseCliArgs(['measure', 'check', '--for', 'overlap,offscreen,overflow', '--gate']);

  assert.equal(parsed.for, 'overlap,offscreen,overflow');
  assert.equal(parsed.gate, true);
});

test('measure diff flags parse correctly', () => {
  const parsed = parseCliArgs([
    'measure',
    'diff',
    '--before',
    'snap-a3f2',
    '--after',
    'snap-b910',
    '--full',
    '--pixels',
    '--gate',
  ]);

  assert.equal(parsed.before, 'snap-a3f2');
  assert.equal(parsed.after, 'snap-b910');
  assert.equal(parsed.full, true);
  assert.equal(parsed.pixels, true);
  assert.equal(parsed.gate, true);
});

test('measure census flags parse correctly, including repeatable --snap and last-wins --url', () => {
  const parsed = parseCliArgs([
    'measure',
    'census',
    '--snap',
    'a',
    '--snap',
    'b',
    '--snap',
    'c',
    '--url',
    'u1',
    '--url',
    'u2',
    '--axis',
    'color',
  ]);

  assert.deepEqual(parsed.snap, ['a', 'b', 'c']);
  assert.deepEqual(parsed.urls, ['u1', 'u2']);
  // --url stays last-wins for every existing command's single-target
  // semantics, unchanged by the new repeatable `urls` accumulator.
  assert.equal(parsed.url, 'u2');
  assert.equal(parsed.axis, 'color');
});

test('measure census --set-file parses parsed.setFile', () => {
  const parsed = parseCliArgs(['measure', 'census', '--set-file', 'routes.txt', '--axis', 'color']);

  assert.equal(parsed.setFile, 'routes.txt');
  assert.equal(parsed.axis, 'color');
});

test('measure sweep --from/--to/--viewport-height parse as raw strings', () => {
  const parsed = parseCliArgs([
    'measure',
    'sweep',
    'https://example.com/',
    '--axis',
    'width',
    '--from',
    '320',
    '--to',
    '1440',
    '--viewport-height',
    '900',
  ]);

  assert.equal(parsed.from, '320');
  assert.equal(parsed.to, '1440');
  assert.equal(parsed.viewportHeight, '900');
});

test('motion rec --stop --rec-id parses parsed.recId', () => {
  const parsed = parseCliArgs(['motion', 'rec', '--stop', '--rec-id', 'rec-9f2']);

  assert.equal(parsed.stop, true);
  assert.equal(parsed.recId, 'rec-9f2');
});

test('measure check repeatable --viewport accumulates in order while --viewport stays last-wins', () => {
  const parsed = parseCliArgs([
    'measure',
    'check',
    '--viewport',
    '390x844',
    '--viewport',
    '768x1024',
    '--viewport',
    '1440x900',
  ]);

  assert.deepEqual(parsed.viewports, ['390x844', '768x1024', '1440x900']);
  assert.equal(parsed.viewport, '1440x900');
});

test('measure explain flags parse correctly', () => {
  const parsed = parseCliArgs(['measure', 'explain', '--selector', '.foo', '--size', '--text', '--form']);

  assert.equal(parsed.selector, '.foo');
  assert.equal(parsed.size, true);
  assert.equal(parsed.text, true);
  assert.equal(parsed.form, true);
});

test('motion rec --start / --stop / one-shot --do parse correctly', () => {
  const start = parseCliArgs(['motion', 'rec', '--start']);
  assert.equal(start.start, true);
  assert.equal(start.stop, undefined);

  const stop = parseCliArgs(['motion', 'rec', '--stop']);
  assert.equal(stop.stop, true);
  assert.equal(stop.start, undefined);

  const oneShot = parseCliArgs(['motion', 'rec', 'https://example.com/page', '--do', 'click:button.send-btn']);
  assert.equal(oneShot.do, 'click:button.send-btn');
  // parseCliArgs doesn't know about branches — the leaf token ('rec') and
  // the URL both stay in positional; only measureMain/motionMain shift the
  // leaf off at dispatch time.
  assert.deepEqual(oneShot.positional, ['rec', 'https://example.com/page']);
});

test('motion timeline/response flags parse correctly', () => {
  const timeline = parseCliArgs(['motion', 'timeline', 'rec-9f31', '--element', '.toast', '--prop', 'opacity']);
  assert.equal(timeline.element, '.toast');
  assert.equal(timeline.prop, 'opacity');

  const response = parseCliArgs(['motion', 'response', 'rec-9f31', '--action', 'click:button.send-btn']);
  assert.equal(response.action, 'click:button.send-btn');
});

test('unknown flags throw typed invocation failures', () => {
  assertCaptureError(() => parseCliArgs(['measure', 'snap', '--nonsense']), 'unknown_flag');
  assertCaptureError(() => parseCliArgs(['screenshot', '--nonsense']), 'unknown_flag');
});

test('exact numeric domains reject partials, signs, exponents, and overflow', () => {
  const cases: Array<{ flag: string; values: string[] }> = [
    { flag: '--port', values: ['0', '65536', '1x', '-1', '+1', '1e2', 'Infinity'] },
    { flag: '--settle', values: ['-1', '+1', '1.1', '1x', '1e2', '2147483648'] },
    { flag: '--timeout', values: ['0', '-1', '1.1', '1x', '1e2', '2147483648'] },
    { flag: '--settle-timeout', values: ['0', '-1', '1.1', '1x', '1e2', '2147483648'] },
    { flag: '--limit', values: ['0', '-1', '+1', '1.1', '1e2', '9007199254740992'] },
    { flag: '--occurrence', values: ['0', '-1', '+1', '1.1', '1e2', '9007199254740992'] },
    { flag: '--duration', values: ['-1', '+1', '1e2', '1x', 'Infinity', '2147483.648', '2147483.6470000001', '2147483.6470000000000000000000000001'] },
  ];
  for (const { flag, values } of cases) for (const value of values) assertCaptureError(() => parseCliArgs(['motion', 'rec', flag, value]));
});

test('exact numeric domains retain valid boundaries and duration stores milliseconds', () => {
  assert.equal(parseCliArgs(['tab', 'list', '--port', '1']).port, 1);
  assert.equal(parseCliArgs(['tab', 'list', '--port', '65535']).port, 65535);
  assert.equal(parseCliArgs(['page', 'click', '--settle', '0']).settle, 0);
  assert.equal(parseCliArgs(['page', 'click', '--settle', '2147483647']).settle, 2147483647);
  assert.equal(parseCliArgs(['cdp', '--timeout', '1']).timeoutMs, 1);
  assert.equal(parseCliArgs(['motion', 'rec', '--duration', '0.001']).duration, 1);
  assert.equal(parseCliArgs(['motion', 'rec', '--duration', '2147483.647']).duration, 2147483647);
});

test('duration compares decimal seconds to the timer-ms bound exactly', () => {
  const cases: Array<{ token: string; milliseconds?: number }> = [
    { token: '2147483.645', milliseconds: 2147483645 },
    { token: '2147483.647', milliseconds: 2147483647 },
    { token: '2147483.647000000000000000', milliseconds: 2147483647 },
    { token: '2147483.6470000001' },
    { token: '2147483.648' },
  ];
  for (const { token, milliseconds } of cases) {
    if (milliseconds === undefined) assertCaptureError(() => parseCliArgs(['motion', 'rec', '--duration', token]));
    else assert.equal(parseCliArgs(['motion', 'rec', '--duration', token]).duration, milliseconds);
  }
});

test('the full unsigned decimal grammar is accepted — leading zeros and bare-dot forms', () => {
  assert.equal(parseCliArgs(['tab', 'list', '--port', '09222']).port, 9222);
  assert.equal(parseCliArgs(['page', 'click', '--settle', '00']).settle, 0);
  assert.equal(parseCliArgs(['motion', 'rec', '--duration', '.5']).duration, 500);
  assert.equal(parseCliArgs(['motion', 'rec', '--duration', '1.']).duration, 1000);
  assert.equal(parseCliArgs(['motion', 'rec', '--duration', '00.5']).duration, 500);
});

test('an explicit --port survives an irrelevant malformed ambient CDP_PORT', () => {
  const prior = process.env.CDP_PORT;
  process.env.CDP_PORT = 'garbage';
  try {
    assert.equal(resolveCliContext(parseCliArgs(['tab', 'list', '--port', '9222'])).port, 9222);
    assertCaptureError(() => resolveCliContext(parseCliArgs(['tab', 'list'])));
  } finally {
    if (prior === undefined) delete process.env.CDP_PORT;
    else process.env.CDP_PORT = prior;
  }
});

test('parseCliArgs itself still tokenizes --gate anywhere it appears (leaf-level rejection is enforced by the command layer, not the tokenizer)', () => {
  const parsed = parseCliArgs(['measure', 'snap', '--gate']);

  assert.equal(parsed.gate, true);
});

test('an existing single-value flag combo still parses correctly post-change', () => {
  const parsed = parseCliArgs(['click', 'Sign in', '--target', 'tab-1']);

  assert.equal(parsed.command, 'click');
  assert.deepEqual(parsed.positional, ['Sign in']);
  assert.equal(parsed.target, 'tab-1');
});

test('deleted flags are rejected as unknown', () => {
  for (const flag of ['--role', '--har', '--har-out', '--record', '--height', '--interactive', '--nested', '--help']) {
    const argv = ['click', 'Sign in', flag];
    // Give value-taking flags a value token so rejection is about the flag
    // itself, not a missing argument.
    if (['--role', '--har', '--har-out', '--height'].includes(flag)) argv.push('x');
    assertCaptureError(() => parseCliArgs(argv), 'unknown_flag');
  }
});

test('-h sets parsed.help', () => {
  const parsed = parseCliArgs(['click', '-h']);

  assert.equal(parsed.help, true);
});

test('--all and --session parse', () => {
  const parsed = parseCliArgs(['session', 'stop', '--all', '--session', 'sess-42']);

  assert.equal(parsed.all, true);
  assert.equal(parsed.session, 'sess-42');
});
