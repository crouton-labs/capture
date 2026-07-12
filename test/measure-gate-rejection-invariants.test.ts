import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cdpMain } from '../src/cdp/dispatch.js';

/**
 * D7/I-8: `--gate` (exit 2 on findings/changes) is accepted only by
 * `measure check` and `measure diff`. The rejection lives in exactly ONE
 * place — the shared dispatch layer (`src/cdp/dispatch.ts` +
 * `gate-guard.ts`) — so every other leaf on the whole surface rejects the
 * flag structurally (a `<error status="unsupported_flag">`, exit 1) before
 * its branch main runs. No measure/motion leaf calls the guard itself;
 * these tests drive `cdpMain()` (the dispatch entry) to prove the single
 * guard covers a sample from every branch: session, page, tab, cdp, lib,
 * measure (incl. bare `measure`/`measure map`), and motion.
 */

/** Runs cdpMain() against a stubbed process.argv, capturing stdout +
 * console.log and trapping both exit mechanisms (process.exit and a leaf's
 * process.exitCode), restoring everything in `finally`. */
async function runDispatch(argv: string[]): Promise<{ stdout: string; exitCode?: number }> {
  const originalArgv = process.argv;
  const originalLog = console.log;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalExit = process.exit;
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;

  let stdout = '';
  let exitCode: number | undefined;

  process.argv = [process.argv[0]!, 'capture', ...argv];
  console.log = (...args: unknown[]) => {
    stdout += `${args.map((a) => String(a)).join(' ')}\n`;
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
    await cdpMain();
  } catch (err) {
    if (!(err instanceof Error) || !/^process\.exit\(\d+\)$/.test(err.message)) throw err;
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
    process.stdout.write = originalWrite;
    process.exit = originalExit;
  }

  if (exitCode === undefined && typeof process.exitCode === 'number') exitCode = process.exitCode;
  process.exitCode = originalExitCode;

  return { stdout, exitCode };
}

// --- rejection: a sample from every branch, plus every measure/motion leaf ---

const rejectionCases: Array<{ argv: string[]; command: string }> = [
  // one sample per non-measure/motion branch (their leaf files are owned
  // elsewhere; the dispatch guard fires before any branch main runs)
  { argv: ['session', 'list', '--gate'], command: 'session list' },
  { argv: ['page', 'click', 'x', '--gate'], command: 'page click' },
  { argv: ['tab', 'list', '--gate'], command: 'tab list' },
  { argv: ['cdp', 'Page.enable', '--gate'], command: 'cdp' },
  { argv: ['lib', 'list', '--gate'], command: 'lib list' },
  // every measure leaf that must reject, including the bare branches
  { argv: ['measure', '--gate'], command: 'measure' },
  { argv: ['measure', 'snap', 'snap-a3f2', '--gate'], command: 'measure snap' },
  { argv: ['measure', 'census', '--axis', 'color', '--gate'], command: 'measure census' },
  { argv: ['measure', 'explain', 'snap-a3f2', '--selector', '.foo', '--gate'], command: 'measure explain' },
  { argv: ['measure', 'sweep', '--gate'], command: 'measure sweep' },
  { argv: ['measure', 'map', '--gate'], command: 'measure map' },
  { argv: ['measure', 'map', 'focus', 'snap-a3f2', '--gate'], command: 'measure map' },
  // every motion leaf, including the bare branch
  { argv: ['motion', '--gate'], command: 'motion' },
  { argv: ['motion', 'rec', '--gate'], command: 'motion rec' },
  { argv: ['motion', 'mask', 'rec-9f31', '--gate'], command: 'motion mask' },
  { argv: ['motion', 'timeline', 'rec-9f31', '--element', '.toast', '--gate'], command: 'motion timeline' },
  { argv: ['motion', 'jank', 'rec-9f31', '--gate'], command: 'motion jank' },
  { argv: ['motion', 'response', 'rec-9f31', '--gate'], command: 'motion response' },
];

for (const { argv, command } of rejectionCases) {
  test(`\`${argv.join(' ')}\` is rejected structurally at dispatch (exit 1, unsupported_flag, command="${command}")`, async () => {
    const { stdout, exitCode } = await runDispatch(argv);

    assert.equal(exitCode, 1, `--gate must reject with exit 1, got ${exitCode}\n${stdout}`);
    assert.match(stdout, /<error /);
    assert.match(stdout, /status="unsupported_flag"/);
    assert.match(stdout, new RegExp(`command="${command.replace(/ /g, '\\s')}"`));
    // The guard fires INSTEAD of the branch/leaf running — never alongside.
    assert.doesNotMatch(stdout, /<subcommand /);
    assert.doesNotMatch(stdout, /not_implemented/);
  });
}

// --- acceptance: exactly measure check and measure diff pass the guard ------

test('measure check --gate passes the dispatch guard: the leaf runs its real logic (artifact error here), never a gate rejection', async () => {
  const { stdout, exitCode } = await runDispatch(['measure', 'check', 'snap-a3f2', '--for', 'overlap', '--gate']);

  assert.equal(exitCode, 1);
  assert.match(stdout, /<error /);
  assert.match(stdout, /command="measure\scheck"/);
  assert.doesNotMatch(stdout, /unsupported_flag/);
});

test('measure diff --gate passes the dispatch guard: the leaf runs its real logic, never a gate rejection', async () => {
  const { stdout, exitCode } = await runDispatch(['measure', 'diff', '--before', 'snap-a', '--after', 'snap-b', '--gate']);

  assert.equal(exitCode, 1);
  assert.match(stdout, /<error /);
  assert.match(stdout, /command="measure\sdiff"/);
  assert.doesNotMatch(stdout, /unsupported_flag/);
});

// --- without --gate, the bare branch usage paths still exit cleanly ---------

test('bare `measure` / `measure map` / `motion` (no --gate) print branch usage and never call process.exit', async () => {
  for (const argv of [['measure'], ['measure', 'map'], ['motion']]) {
    const { stdout, exitCode } = await runDispatch(argv);
    assert.equal(exitCode, undefined, `${argv.join(' ')} must not exit`);
    assert.match(stdout, /<subcommand /);
  }
});
