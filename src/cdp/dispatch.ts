/**
 * Shared dispatch for every routed command. Two jobs live here:
 *
 *  1. Route each root (`session`, `page`, `tab`, `measure`, `motion`,
 *     `cdp`, `lib`, hidden `__bridge-serve`) to its branch main.
 *  2. Invoke the `--gate` guard ONCE for the whole surface: every command
 *     that is not `measure check|diff` rejects the flag structurally here,
 *     before any branch main runs.
 */
import { parseCliArgs } from './args.js';
import { type ParsedArgs } from './types.js';
import { isGateLeaf, rejectUnsupportedGate } from './commands/gate-guard.js';
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

export async function cdpMain(): Promise<void> {
  const args = process.argv.slice(2);
  const parsed = parseCliArgs(args);

  if (parsed.gate && !isGateLeaf(parsed)) {
    rejectUnsupportedGate(parsed, gateLeafName(parsed));
    return;
  }

  switch (parsed.command) {
    case 'session': return sessionMain(parsed, args);
    case 'page': return pageMain(parsed, args);
    case 'tab': return tabMain(parsed, args);
    case 'lib': return cmdLib(parsed, args);
    case 'cdp': return cmdCdp(parsed, args);
    case 'measure': return measureMain(parsed, args);
    case 'motion': return motionMain(parsed, args);
    case '__bridge-serve': return cmdBridgeServe(parsed, args);
    default:
      // capture.ts routes only the known roots into cdpMain(); an unknown
      // token gets its structured error there and never reaches this switch.
      throw new Error(`dispatch: unroutable command ${JSON.stringify(parsed.command)}`);
  }
}
