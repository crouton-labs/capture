/**
 * Shared dispatch for every routed command. Two jobs live here:
 *
 *  1. Route each root (`session`, `page`, `tab`, `measure`, `motion`,
 *     `cdp`, `lib`, hidden `__bridge-serve`) to its branch main.
 *  2. Invoke the `--gate` guard ONCE for the whole surface: every command
 *     that is not `measure check|diff` rejects the flag structurally here,
 *     before any branch main runs.
 */
import { parseCliSyntax, resolveCliContext, validateCliInvocation } from './args.js';
import { type ParsedArgs } from './types.js';
import { isGateLeaf, rejectUnsupportedGate } from './commands/gate-guard.js';
import { getActiveSession } from '../session-context.js';
import { admitSessionOperation } from '../session/coordinator.js';
import { sessionMain } from '../session/commands.js';
import { pageMain } from './commands/page/index.js';
import { tabMain } from './commands/tab/index.js';
import { cmdLib } from './commands/lib.js';
import { cmdCdp } from './commands/cdp.js';
import { cmdBridgeServe } from './commands/bridge-serve.js';
import { measureMain } from './commands/measure/index.js';
import { motionMain } from './commands/motion/index.js';

/** The dotted leaf name the gate rejection reports, derived from the parsed
 * command plus its first positional (the branch-leaf token). */
function gateLeafName(parsed: ParsedArgs): string {
  const branch =
    parsed.command === 'session' ||
    parsed.command === 'page' ||
    parsed.command === 'tab' ||
    parsed.command === 'measure' ||
    parsed.command === 'motion' ||
    parsed.command === 'lib';
  const leaf = parsed.positional[0];
  return branch && leaf ? `${parsed.command} ${leaf}` : parsed.command;
}

/**
 * Registers a session-bound operation (`page`/`measure`/`motion`) with the
 * lifecycle coordinator BEFORE its first side effect and releases in `finally`,
 * so a concurrent `session stop` (via `beginSessionStop`) waits for in-flight
 * artifact writers to drain and excludes any operation that starts after stop
 * marking (admission throws `session_stopping`). When there is no active
 * session the operation is a one-shot with nothing to coordinate against, so it
 * runs unwrapped. The active-session read here is never the first for these
 * leaves — `resolveCliContext` already hydrated the same session — so it adds
 * no new active-index side effect on the validation-rejected path.
 */
async function withActiveSessionAdmission(parsed: ParsedArgs, run: () => Promise<void>): Promise<void> {
  const active = getActiveSession();
  if (!active) return run();
  const operation = await admitSessionOperation(active.dir);
  try {
    return await run();
  } finally {
    await operation.release();
  }
}

export async function cdpMain(): Promise<void> {
  const args = process.argv.slice(2);
  const parsed = parseCliSyntax(args);

  if (parsed.gate && !isGateLeaf(parsed)) {
    rejectUnsupportedGate(parsed, gateLeafName(parsed));
    return;
  }

  validateCliInvocation(parsed);
  const resolved = resolveCliContext(parsed);

  switch (resolved.command) {
    case 'session': return sessionMain(resolved, args);
    case 'page': return withActiveSessionAdmission(resolved, () => pageMain(resolved, args));
    case 'tab': return tabMain(resolved, args);
    case 'lib': return cmdLib(resolved, args);
    case 'cdp': return cmdCdp(resolved, args);
    case 'measure': return withActiveSessionAdmission(resolved, () => measureMain(resolved, args));
    case 'motion': return withActiveSessionAdmission(resolved, () => motionMain(resolved, args));
    case '__bridge-serve': return cmdBridgeServe(resolved, args);
    default:
      // capture.ts routes only the known roots into cdpMain(); an unknown
      // token gets its structured error there and never reaches this switch.
      throw new Error(`dispatch: unroutable command ${JSON.stringify(resolved.command)}`);
  }
}
