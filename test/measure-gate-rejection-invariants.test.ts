import { test } from 'node:test';
import assert from 'node:assert/strict';

import { measureMain } from '../src/cdp/commands/measure/index.js';
import type { ParsedArgs } from '../src/cdp/types.js';

/**
 * `--gate` (exit 2 on findings/changes) is accepted only by `measure check`
 * and `measure diff` (see `gate-guard.ts`). Every other measure leaf must
 * REJECT an unsupported `--gate` (a structured error, `process.exit(1)`) —
 * never silently print usage and return 0, which would make a caller's
 * gating pipeline believe the flag was honored.
 */

function baseParsed(gate: boolean): ParsedArgs {
  return { command: 'measure', positional: [], json: true, gate };
}

/** Stubs `process.exit` to capture the code instead of killing the test process; restores it unconditionally. */
async function withCapturedExit<T>(fn: () => Promise<T>): Promise<{ exitCode: number | undefined; result?: T }> {
  const originalExit = process.exit;
  let exitCode: number | undefined;
  // @ts-expect-error — test-only stub, narrower signature than the real process.exit
  process.exit = (code?: number) => {
    exitCode = code ?? 0;
    throw new Error('__process_exit__');
  };
  try {
    const result = await fn();
    return { exitCode, result };
  } catch (err) {
    if (err instanceof Error && err.message === '__process_exit__') {
      return { exitCode };
    }
    throw err;
  } finally {
    process.exit = originalExit;
  }
}

test('measure --gate (no leaf) rejects with exit 1, never falls through to printing usage with exit 0', async () => {
  const { exitCode } = await withCapturedExit(() => measureMain(baseParsed(true), ['--gate']));
  assert.equal(exitCode, 1, '--gate on a bare `measure` must reject (exit 1), not print usage and return');
});

test('measure map --gate (no sub-leaf) rejects with exit 1, never falls through to printing usage with exit 0', async () => {
  const parsed: ParsedArgs = { ...baseParsed(true), positional: ['map'] };
  const { exitCode } = await withCapturedExit(() => measureMain(parsed, ['map', '--gate']));
  assert.equal(exitCode, 1, '--gate on a bare `measure map` must reject (exit 1), not print usage and return');
});

test('measure (no leaf, no --gate) still prints usage and returns normally (no exit call at all)', async () => {
  const { exitCode } = await withCapturedExit(() => measureMain(baseParsed(false), []));
  assert.equal(exitCode, undefined, 'without --gate, the bare `measure` usage path must not call process.exit at all');
});

test('measure map (no sub-leaf, no --gate) still prints usage and returns normally (no exit call at all)', async () => {
  const parsed: ParsedArgs = { ...baseParsed(false), positional: ['map'] };
  const { exitCode } = await withCapturedExit(() => measureMain(parsed, ['map']));
  assert.equal(exitCode, undefined, 'without --gate, the bare `measure map` usage path must not call process.exit at all');
});
