import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCliArgs } from '../src/cdp/args.js';
import { measureMain } from '../src/cdp/commands/measure/index.js';
import { motionMain } from '../src/cdp/commands/motion/index.js';

/** Capture console.log (branch-level usage) + process.stdout.write (leaf
 * emitResult output) + trap process.exit (leaf stubs call
 * process.exit(0)/process.exit(1)), restoring all three in `finally`.
 * Mirrors the capture patterns in test/session-help.test.ts and
 * test/output-render.test.ts. */
async function withCapture(fn: () => Promise<void>): Promise<{
  logs: string;
  stdout: string;
  exitCode?: number;
}> {
  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalExit = process.exit;

  const logs: string[] = [];
  let stdout = '';
  let exitCode: number | undefined;

  console.log = (...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(' '));
  };
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit(${exitCode})`);
  }) as typeof process.exit;

  try {
    await fn();
  } catch (err) {
    // process.exit throwing is expected for every leaf-stub path; anything
    // else is a real test failure and should propagate.
    if (!(err instanceof Error) || !/^process\.exit\(\d+\)$/.test(err.message)) throw err;
  } finally {
    console.log = originalLog;
    process.stdout.write = originalWrite;
    process.exit = originalExit;
  }

  return { logs: logs.join('\n'), stdout, exitCode };
}

test('`measure` with no leaf prints branch usage listing every leaf', async () => {
  const { logs, exitCode } = await withCapture(() => measureMain(parseCliArgs(['measure']), []));

  assert.equal(exitCode, undefined);
  assert.match(logs, /\bsnap\b/);
  assert.match(logs, /\bcheck\b/);
  assert.match(logs, /\bdiff\b/);
  assert.match(logs, /\bcensus\b/);
  assert.match(logs, /\bexplain\b/);
  assert.match(logs, /\bsweep\b/);
  assert.match(logs, /map focus\|scroll\|layers/);
});

test('`measure map` with no sub-leaf prints its own usage listing focus/scroll/layers', async () => {
  const { logs, exitCode } = await withCapture(() => measureMain(parseCliArgs(['measure', 'map']), []));

  assert.equal(exitCode, undefined);
  assert.match(logs, /\bfocus\b/);
  assert.match(logs, /\bscroll\b/);
  assert.match(logs, /\blayers\b/);
});

test('`motion` with no leaf prints branch usage listing every leaf', async () => {
  const { logs, exitCode } = await withCapture(() => motionMain(parseCliArgs(['motion']), []));

  assert.equal(exitCode, undefined);
  assert.match(logs, /\brec\b/);
  assert.match(logs, /\bmask\b/);
  assert.match(logs, /\btimeline\b/);
  assert.match(logs, /\bjank\b/);
  assert.match(logs, /\bresponse\b/);
});

interface LeafCase {
  name: string;
  argv: string[];
  command: string;
  main: (parsed: ReturnType<typeof parseCliArgs>, args: string[]) => Promise<void>;
}

const measureLeafCases: LeafCase[] = [
  { name: 'measure snap', argv: ['measure', 'snap', 'https://example.com/'], command: 'measure snap', main: measureMain },
  { name: 'measure check', argv: ['measure', 'check', 'snap-a3f2', '--for', 'overlap'], command: 'measure check', main: measureMain },
  { name: 'measure diff', argv: ['measure', 'diff', '--before', 'snap-a', '--after', 'snap-b'], command: 'measure diff', main: measureMain },
  { name: 'measure census', argv: ['measure', 'census', '--axis', 'color'], command: 'measure census', main: measureMain },
  { name: 'measure explain', argv: ['measure', 'explain', 'snap-a3f2', '--selector', '.foo'], command: 'measure explain', main: measureMain },
  { name: 'measure sweep', argv: ['measure', 'sweep', 'https://example.com/'], command: 'measure sweep', main: measureMain },
  { name: 'measure map focus', argv: ['measure', 'map', 'focus', 'snap-a3f2'], command: 'measure map focus', main: measureMain },
  { name: 'measure map scroll', argv: ['measure', 'map', 'scroll', 'snap-a3f2'], command: 'measure map scroll', main: measureMain },
  { name: 'measure map layers', argv: ['measure', 'map', 'layers', 'snap-a3f2'], command: 'measure map layers', main: measureMain },
];

const motionLeafCases: LeafCase[] = [
  { name: 'motion rec', argv: ['motion', 'rec', 'https://example.com/', '--do', 'click:button'], command: 'motion rec', main: motionMain },
  { name: 'motion mask', argv: ['motion', 'mask', 'rec-9f31'], command: 'motion mask', main: motionMain },
  { name: 'motion timeline', argv: ['motion', 'timeline', 'rec-9f31', '--element', '.toast'], command: 'motion timeline', main: motionMain },
  { name: 'motion jank', argv: ['motion', 'jank', 'rec-9f31'], command: 'motion jank', main: motionMain },
  { name: 'motion response', argv: ['motion', 'response', 'rec-9f31'], command: 'motion response', main: motionMain },
];

for (const { name, argv, command, main } of [...measureLeafCases, ...motionLeafCases]) {
  test(`${name} routes end-to-end: parseCliArgs -> branch router -> leaf stub -> renderer`, async () => {
    const { stdout, exitCode } = await withCapture(() => main(parseCliArgs(argv), []));

    assert.equal(exitCode, 1);
    assert.match(stdout, /<error /);
    assert.match(stdout, /status="not_implemented"/);
    assert.match(stdout, new RegExp(`command="${command.replace(/ /g, '\\s')}"`));
  });
}

test('leaf stubs honor --json: valid JSON, tag "error", status "not_implemented"', async () => {
  const { stdout, exitCode } = await withCapture(() =>
    measureMain(parseCliArgs(['measure', 'snap', '--json']), []),
  );

  assert.equal(exitCode, 1);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.tag, 'error');
  assert.equal(parsed.attrs.status, 'not_implemented');
  assert.equal(parsed.attrs.command, 'measure snap');
});

test('motion leaf stubs also honor --json', async () => {
  const { stdout, exitCode } = await withCapture(() =>
    motionMain(parseCliArgs(['motion', 'jank', 'rec-9f31', '--json']), []),
  );

  assert.equal(exitCode, 1);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.tag, 'error');
  assert.equal(parsed.attrs.status, 'not_implemented');
  assert.equal(parsed.attrs.command, 'motion jank');
});
