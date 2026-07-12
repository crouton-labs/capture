import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCliArgs } from '../src/cdp/args.js';

/** Run `fn` with `process.exit` trapped to throw and `console.error`
 * captured, restoring both in `finally`. Mirrors test/session-help.test.ts's
 * pattern for exercising parseCliArgs' `process.exit(1)` unknown-flag path
 * without actually exiting the test runner. */
function withExitTrap<T>(fn: () => T): { result?: T; threw?: unknown; errors: string[] } {
  const restoreExit = process.exit;
  const restoreError = console.error;
  const errors: string[] = [];

  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => String(a)).join(' '));
  };
  process.exit = ((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as typeof process.exit;

  try {
    return { result: fn(), errors };
  } catch (threw) {
    return { threw, errors };
  } finally {
    process.exit = restoreExit;
    console.error = restoreError;
  }
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

test('unknown flags are still rejected for a new branch command', () => {
  const { threw, errors } = withExitTrap(() => parseCliArgs(['measure', 'snap', '--nonsense']));

  assert.ok(threw instanceof Error);
  assert.match((threw as Error).message, /process\.exit\(1\)/);
  assert.ok(errors.some((e) => e.includes('Unknown flag: --nonsense')));
});

test('unknown flags are still rejected for an existing (pre-U02) command', () => {
  const { threw, errors } = withExitTrap(() => parseCliArgs(['screenshot', '--nonsense']));

  assert.ok(threw instanceof Error);
  assert.match((threw as Error).message, /process\.exit\(1\)/);
  assert.ok(errors.some((e) => e.includes('Unknown flag: --nonsense')));
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
    const { threw, errors } = withExitTrap(() => parseCliArgs(argv));

    assert.ok(threw instanceof Error, `${flag} should be rejected`);
    assert.match((threw as Error).message, /process\.exit\(1\)/);
    assert.ok(errors.some((e) => e.includes(`Unknown flag: ${flag}`)), `${flag} should surface as unknown`);
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
