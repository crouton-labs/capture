/**
 * capture — browser automation and UI measurement over CDP.
 *
 * Root router: ten visible roots (session, page, tab, measure, motion, perf,
 * heap, lighthouse, cdp, lib) plus the hidden `__bridge-serve` and `__log-tail-serve`
 * internals, all dispatched below. Root help is assembled from each branch's exported
 * `COMMAND_BLOCK` — the parent walks its children, it never hardcodes a
 * child's description. An unknown first token is a structured
 * `<error code="unknown_command">` (exit 1), never help text.
 */

import * as fs from 'fs';
import * as path from 'path';
import { cdpMain } from './cdp.js';
import { captureError, failureResult } from './errors.js';
import { emitResult } from './output/render.js';
import { COMMAND_BLOCK as SESSION_BLOCK } from './session/commands.js';
import { COMMAND_BLOCK as PAGE_BLOCK } from './cdp/commands/page/index.js';
import { COMMAND_BLOCK as TAB_BLOCK } from './cdp/commands/tab/index.js';
import { COMMAND_BLOCK as MEASURE_BLOCK } from './cdp/commands/measure/index.js';
import { COMMAND_BLOCK as MOTION_BLOCK } from './cdp/commands/motion/index.js';
import { COMMAND_BLOCK as PERF_BLOCK } from './cdp/commands/perf/index.js';
import { COMMAND_BLOCK as HEAP_BLOCK } from './cdp/commands/heap/index.js';
import { COMMAND_BLOCK as LIGHTHOUSE_BLOCK } from './cdp/commands/lighthouse.js';
import { COMMAND_BLOCK as CDP_BLOCK } from './cdp/commands/cdp.js';
import { COMMAND_BLOCK as LIB_BLOCK } from './cdp/commands/lib.js';

/** The ten visible root children, in help order. */
const ROOTS = ['session', 'page', 'tab', 'measure', 'motion', 'perf', 'heap', 'lighthouse', 'cdp', 'lib'] as const;

/**
 * Guessable former/legacy tokens with one unambiguous current destination —
 * an orientation hint on the `unknown_command` error, never a second
 * dispatchable path (the guessed token still fails; only the message
 * changes). Deliberately small: an entry only earns a place here when its
 * correct destination is unambiguous, so this stays a short discriminator
 * rather than a growing synonym taxonomy.
 */
const GUESSABLE_HINTS: Readonly<Record<string, string>> = {
  screenshot: 'page shot',
  trace: 'perf trace',
  memory: 'heap census',
  mock: 'tab mock start',
};

const ROOT_BLOCKS = [
  SESSION_BLOCK,
  PAGE_BLOCK,
  TAB_BLOCK,
  MEASURE_BLOCK,
  MOTION_BLOCK,
  PERF_BLOCK,
  HEAP_BLOCK,
  LIGHTHOUSE_BLOCK,
  CDP_BLOCK,
  LIB_BLOCK,
] as const;

function rootHelp(): string {
  return `capture — browser automation and UI measurement over CDP.

${ROOT_BLOCKS.join('\n\n')}

Selecting a noun: session, page, and tab address the live browser; measure, motion, perf, and heap each record once and then answer many questions from that recording — a settled snapshot, a screencast, a performance trace, a heap snapshot; lighthouse, cdp, and lib are third-party audit, raw protocol, and local-library surfaces. Record with the noun whose artifact holds the facts you need, then query it.

I/O contract: flags and positionals on input; one rendered prose block on stdout. --json mirrors the same result as JSON, but the rendered block is the contract. stderr carries in-flight diagnostics only. --artifact-dir <path> selects the root for a session bundle (\`session start\`) or a sessionless artifact-producing leaf's one-shot bundle; leaf help states when it writes one. --out always names one caller-owned file, never a bundle directory.

A CDP-enabled browser must be running; \`capture tab list\` is the probe, and \`capture tab launch\` starts one capture owns and reaps when nothing is (never hand-roll a detached browser — nothing reaps that). Capture never signals a browser it did not start, so attaching to your own with --port is unchanged. CDP_PORT / CDP_TARGET pin the browser + tab for target-selecting commands — precedence: explicit flag > active session > env. \`session start\` adopts only an explicit --target.`;
}

function printVersion(): void {
  // Version is injected at build time via esbuild's --define flag.
  // Falls back to reading package.json at runtime if not injected.
  const declared = (globalThis as { __CAPTURE_VERSION__?: string }).__CAPTURE_VERSION__;
  if (declared) {
    console.log(declared);
    return;
  }
  try {
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
    console.log(pkg.version);
  } catch {
    console.log('unknown');
  }
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);

  if (command === '--version') {
    printVersion();
    return;
  }

  if (command === undefined || command === '-h' || command === '--help') {
    console.log(rootHelp());
    return;
  }

  if (command === '__log-tail-serve') {
    // Internal self-spawn target for `session log`'s detached tailer worker.
    // Not a visible root: absent from ROOTS, help, and every COMMAND_BLOCK.
    const { runLogTailer } = await import('./session/log-tailer.js');
    return runLogTailer(process.argv.slice(3));
  }

  if ((ROOTS as readonly string[]).includes(command) || command === '__bridge-serve') {
    return cdpMain();
  }

  const hint = GUESSABLE_HINTS[command];
  throw captureError(
    'invocation',
    'unknown_command',
    hint
      ? `Unknown command ${command}; did you mean \`capture ${hint}\`? Expected one of the ten roots: session, page, tab, measure, motion, perf, heap, lighthouse, cdp, lib.`
      : `Unknown command ${command}; expected one of the ten roots: session, page, tab, measure, motion, perf, heap, lighthouse, cdp, lib.`,
  );
}

main().catch((error) => {
  emitResult(failureResult(error), { json: process.argv.includes('--json') });
  process.exitCode = 1;
});
