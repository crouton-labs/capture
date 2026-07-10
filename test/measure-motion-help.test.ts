import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';

import { parseCliArgs } from '../src/cdp/args.js';
import { measureMain, MEASURE_USAGE, MEASURE_MAP_USAGE } from '../src/cdp/commands/measure/index.js';
import { motionMain, MOTION_USAGE } from '../src/cdp/commands/motion/index.js';

/** Capture console.log (branch-level usage) + process.stdout.write (leaf
 * emitResult output) and surface the resulting exit code, restoring all
 * three in `finally`. Two exit mechanisms are unified: the branch router and
 * gate guard call process.exit(code) (trapped here), while a leaf signals a
 * structured error by setting process.exitCode = 1 and returning — so the
 * returned exitCode prefers a trapped process.exit but falls back to the
 * process.exitCode a leaf left behind. process.exitCode is reset around the
 * call so a leaf's failing code never leaks to the test runner. Mirrors the
 * capture patterns in test/session-help.test.ts and test/output-render.test.ts. */
async function withCapture(fn: () => Promise<void>): Promise<{
  logs: string;
  stdout: string;
  exitCode?: number;
}> {
  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalExit = process.exit;
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;

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
    // process.exit throwing is expected for every leaf error path; anything
    // else is a real test failure and should propagate.
    if (!(err instanceof Error) || !/^process\.exit\(\d+\)$/.test(err.message)) throw err;
  } finally {
    console.log = originalLog;
    process.stdout.write = originalWrite;
    process.exit = originalExit;
  }

  // A trapped process.exit(code) wins; otherwise fall back to the
  // process.exitCode a leaf sets on a structured error.
  if (exitCode === undefined && typeof process.exitCode === 'number') exitCode = process.exitCode;
  process.exitCode = originalExitCode;

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

test('`measure --gate` (no leaf) rejects --gate instead of printing branch usage', async () => {
  const { stdout, logs, exitCode } = await withCapture(() => measureMain(parseCliArgs(['measure', '--gate']), []));

  assert.equal(exitCode, 1);
  assert.match(stdout, /<error /);
  assert.match(stdout, /status="unsupported_flag"/);
  assert.match(stdout, /command="measure"/);
  // The rejection fires instead of the usage listing, not alongside it.
  assert.doesNotMatch(logs, /Leaves:/);
});

test('`measure map` with no sub-leaf prints its own usage listing focus/scroll/layers', async () => {
  const { logs, exitCode } = await withCapture(() => measureMain(parseCliArgs(['measure', 'map']), []));

  assert.equal(exitCode, undefined);
  assert.match(logs, /\bfocus\b/);
  assert.match(logs, /\bscroll\b/);
  assert.match(logs, /\blayers\b/);
});

test('`measure map --gate` (no sub-leaf) rejects --gate instead of printing branch usage', async () => {
  const { stdout, logs, exitCode } = await withCapture(() =>
    measureMain(parseCliArgs(['measure', 'map', '--gate']), []),
  );

  assert.equal(exitCode, 1);
  assert.match(stdout, /<error /);
  assert.match(stdout, /status="unsupported_flag"/);
  assert.match(stdout, /command="measure map"/);
  assert.doesNotMatch(logs, /Leaves:/);
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

test('`motion --gate` (no leaf) rejects --gate instead of printing branch usage', async () => {
  const { stdout, logs, exitCode } = await withCapture(() => motionMain(parseCliArgs(['motion', '--gate']), []));

  assert.equal(exitCode, 1);
  assert.match(stdout, /<error /);
  assert.match(stdout, /status="unsupported_flag"/);
  assert.match(stdout, /command="motion"/);
  assert.doesNotMatch(logs, /Leaves:/);
});

interface LeafCase {
  name: string;
  argv: string[];
  command: string;
  main: (parsed: ReturnType<typeof parseCliArgs>, args: string[]) => Promise<void>;
}

const measureLeafCases: LeafCase[] = [
  { name: 'measure snap', argv: ['measure', 'snap', 'snap-a3f2'], command: 'measure snap', main: measureMain },
  { name: 'measure check', argv: ['measure', 'check', 'snap-a3f2', '--for', 'overlap'], command: 'measure check', main: measureMain },
  { name: 'measure diff', argv: ['measure', 'diff', '--before', 'snap-a', '--after', 'snap-b'], command: 'measure diff', main: measureMain },
  { name: 'measure census', argv: ['measure', 'census', '--axis', 'color'], command: 'measure census', main: measureMain },
  { name: 'measure explain', argv: ['measure', 'explain', 'snap-a3f2', '--selector', '.foo'], command: 'measure explain', main: measureMain },
  { name: 'measure sweep', argv: ['measure', 'sweep'], command: 'measure sweep', main: measureMain },
  { name: 'measure map focus', argv: ['measure', 'map', 'focus', 'snap-a3f2'], command: 'measure map focus', main: measureMain },
  { name: 'measure map scroll', argv: ['measure', 'map', 'scroll', 'snap-a3f2'], command: 'measure map scroll', main: measureMain },
  { name: 'measure map layers', argv: ['measure', 'map', 'layers', 'snap-a3f2'], command: 'measure map layers', main: measureMain },
];

const motionLeafCases: LeafCase[] = [
  { name: 'motion rec', argv: ['motion', 'rec'], command: 'motion rec', main: motionMain },
  { name: 'motion mask', argv: ['motion', 'mask', 'rec-9f31'], command: 'motion mask', main: motionMain },
  { name: 'motion timeline', argv: ['motion', 'timeline', 'rec-9f31', '--element', '.toast'], command: 'motion timeline', main: motionMain },
  { name: 'motion jank', argv: ['motion', 'jank', 'rec-9f31'], command: 'motion jank', main: motionMain },
  { name: 'motion response', argv: ['motion', 'response', 'rec-9f31'], command: 'motion response', main: motionMain },
];

for (const { name, argv, command, main } of [...measureLeafCases, ...motionLeafCases]) {
  test(`${name} routes end-to-end: parseCliArgs -> branch router -> leaf dispatch -> renderer`, async () => {
    const { stdout, exitCode } = await withCapture(() => main(parseCliArgs(argv), []));

    // The branch router dispatched to the right leaf: the leaf ran its own
    // logic and emitted a structured <error> stamped with its own command
    // path. Each argv targets an unreachable snapshot/recording or omits a
    // required arg, so the leaf fails fast before driving a browser — routing
    // is proven without a live browser. The command attribute is the tell:
    // dispatch to the wrong leaf would stamp a different command path.
    assert.equal(exitCode, 1);
    assert.match(stdout, /<error /);
    assert.match(stdout, new RegExp(`command="${command.replace(/ /g, '\\s')}"`));
    assert.doesNotMatch(stdout, /not_implemented/);
  });
}

test('measure leaves honor --json: a structured error renders as valid JSON with the current tag/status vocabulary', async () => {
  const { stdout, exitCode } = await withCapture(() =>
    measureMain(parseCliArgs(['measure', 'snap', 'snap-a3f2', '--json']), []),
  );

  assert.equal(exitCode, 1);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.tag, 'error');
  assert.equal(parsed.attrs.status, 'snapshot_ref_unavailable');
  assert.equal(parsed.attrs.command, 'measure snap');
});

test('motion leaves also honor --json', async () => {
  const { stdout, exitCode } = await withCapture(() =>
    motionMain(parseCliArgs(['motion', 'jank', 'rec-9f31', '--json']), []),
  );

  assert.equal(exitCode, 1);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.tag, 'error');
  assert.equal(parsed.attrs.status, 'artifact_unavailable');
  assert.equal(parsed.attrs.command, 'motion jank');
});

// --- I-8: --gate is scoped to `measure check`/`measure diff` only ---------

const gateAllowedCommands = new Set(['measure check', 'measure diff']);

for (const { name, argv, command, main } of [...measureLeafCases, ...motionLeafCases]) {
  if (gateAllowedCommands.has(command)) continue;

  test(`${name} rejects --gate with a structured error instead of silently accepting it`, async () => {
    const { stdout, exitCode } = await withCapture(() => main(parseCliArgs([...argv, '--gate']), []));

    assert.equal(exitCode, 1);
    assert.match(stdout, /<error /);
    assert.match(stdout, /status="unsupported_flag"/);
    assert.match(stdout, new RegExp(`command="${command.replace(/ /g, '\\s')}"`));
    // Rejection fires before the leaf's own not_implemented path runs.
    assert.doesNotMatch(stdout, /not_implemented/);
  });
}

for (const { name, argv, command, main } of [...measureLeafCases, ...motionLeafCases]) {
  if (!gateAllowedCommands.has(command)) continue;

  test(`${name} still accepts --gate (it parses through to the implemented leaf instead of being rejected)`, async () => {
    const { stdout, exitCode } = await withCapture(() => main(parseCliArgs([...argv, '--gate']), []));

    // --gate is a valid flag on this leaf: the guard lets it through and the
    // leaf runs its real logic (here it fails resolving the unreachable
    // snapshot ref). The tell is that --gate was NOT rejected as unsupported.
    assert.equal(exitCode, 1);
    assert.match(stdout, /<error /);
    assert.match(stdout, new RegExp(`command="${command.replace(/ /g, '\\s')}"`));
    assert.doesNotMatch(stdout, /unsupported_flag/);
  });
}

test('measure branch usage advertises --gate only on the check and diff leaf lines', () => {
  const gateLines = MEASURE_USAGE.split('\n').filter((l) => l.includes('--gate'));

  // Exactly the check line, the diff line, and the one summary sentence
  // scoping --gate to those two leaves — never a per-leaf mention on any
  // other line.
  assert.equal(gateLines.length, 3);
  assert.ok(gateLines.some((l) => l.includes('check') && l.includes('[--gate]')));
  assert.ok(gateLines.some((l) => l.includes('diff') && l.includes('[--gate]')));
  assert.ok(gateLines.some((l) => l.includes('only') && l.includes('check') && l.includes('diff')));
});

test('measure map branch usage never mentions --gate', () => {
  assert.doesNotMatch(MEASURE_MAP_USAGE, /--gate/);
});

test('motion branch usage documents that no motion leaf accepts --gate, and never advertises it as an accepted flag', () => {
  assert.match(MOTION_USAGE, /No leaf accepts --gate/);
  assert.doesNotMatch(MOTION_USAGE, /\[--gate\]/);
});

for (const { name, argv, command } of [...measureLeafCases, ...motionLeafCases]) {
  if (gateAllowedCommands.has(command)) continue;

  test(`${name} --help never advertises --gate`, async () => {
    const main = [...measureLeafCases, ...motionLeafCases].find((c) => c.command === command)!.main;
    const { logs } = await withCapture(() => main(parseCliArgs([...argv, '--help']), []));

    assert.doesNotMatch(logs, /--gate/);
  });
}

test('measure check --help and measure diff --help still advertise --gate', async () => {
  const check = await withCapture(() => measureMain(parseCliArgs(['measure', 'check', '--help']), []));
  assert.match(check.logs, /--gate/);

  const diff = await withCapture(() => measureMain(parseCliArgs(['measure', 'diff', '--help']), []));
  assert.match(diff.logs, /--gate/);
});

test('no leaf/args source introduces --expect (posture invariant: no grade/prediction input)', () => {
  const files = [
    'src/cdp/args.ts',
    'src/cdp/types.ts',
    'src/cdp/commands/measure/index.ts',
    'src/cdp/commands/measure/snap.ts',
    'src/cdp/commands/measure/check.ts',
    'src/cdp/commands/measure/diff.ts',
    'src/cdp/commands/measure/census.ts',
    'src/cdp/commands/measure/explain.ts',
    'src/cdp/commands/measure/sweep.ts',
    'src/cdp/commands/measure/map-focus.ts',
    'src/cdp/commands/measure/map-scroll.ts',
    'src/cdp/commands/measure/map-layers.ts',
    'src/cdp/commands/motion/index.ts',
    'src/cdp/commands/motion/rec.ts',
    'src/cdp/commands/motion/mask.ts',
    'src/cdp/commands/motion/timeline.ts',
    'src/cdp/commands/motion/jank.ts',
    'src/cdp/commands/motion/response.ts',
    'src/cdp/commands/gate-guard.ts',
  ];

  for (const rel of files) {
    const contents = fs.readFileSync(path.resolve(rel), 'utf8');
    assert.doesNotMatch(contents, /--expect\b/, `${rel} must not introduce --expect`);
  }
});
