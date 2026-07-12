/**
 * capture — browser automation and UI measurement over CDP.
 *
 * Root router: seven visible roots (session, page, tab, measure, motion,
 * cdp, lib) plus the hidden `__bridge-serve` internal, all dispatched
 * through `cdpMain()`. Root help is assembled from each branch's exported
 * `COMMAND_BLOCK` — the parent walks its children, it never hardcodes a
 * child's description. An unknown first token is a structured
 * `<error code="unknown_command">` (exit 1), never help text.
 */

import * as fs from 'fs';
import * as path from 'path';
import { cdpMain } from './cdp.js';
import { emitResult, fact, text } from './output/render.js';
import { COMMAND_BLOCK as SESSION_BLOCK } from './session/commands.js';
import { COMMAND_BLOCK as PAGE_BLOCK } from './cdp/commands/page/index.js';
import { COMMAND_BLOCK as TAB_BLOCK } from './cdp/commands/tab/index.js';
import { COMMAND_BLOCK as MEASURE_BLOCK } from './cdp/commands/measure/index.js';
import { COMMAND_BLOCK as MOTION_BLOCK } from './cdp/commands/motion/index.js';
import { COMMAND_BLOCK as CDP_BLOCK } from './cdp/commands/cdp.js';
import { COMMAND_BLOCK as LIB_BLOCK } from './cdp/commands/lib.js';

/** The seven visible root children, in help order. */
const ROOTS = ['session', 'page', 'tab', 'measure', 'motion', 'cdp', 'lib'] as const;

const ROOT_BLOCKS = [
  SESSION_BLOCK,
  PAGE_BLOCK,
  TAB_BLOCK,
  MEASURE_BLOCK,
  MOTION_BLOCK,
  CDP_BLOCK,
  LIB_BLOCK,
] as const;

function rootHelp(): string {
  return `capture — browser automation and UI measurement over CDP.

${ROOT_BLOCKS.join('\n\n')}

I/O contract: flags and positionals on input; one rendered prose block on
stdout. --json mirrors the same result as JSON, but the rendered block is
the contract. stderr carries in-flight diagnostics only.

A CDP-enabled browser must be running; \`capture tab list\` is the probe.
CDP_PORT / CDP_TARGET pin the browser + tab for orchestrators — precedence:
explicit flag > active session > env.`;
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

  if (command === undefined || command === '-h') {
    console.log(rootHelp());
    return;
  }

  if ((ROOTS as readonly string[]).includes(command) || command === '__bridge-serve') {
    return cdpMain();
  }

  emitResult(
    {
      tag: 'error',
      attrs: { code: 'unknown_command' },
      summary: fact`received: unknown command \`${command}\`; expected one of the seven roots: session, page, tab, measure, motion, cdp, lib.`,
      followUp: text`Run \`capture -h\` for the assembled command tree.`,
    },
    { json: process.argv.includes('--json') },
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
