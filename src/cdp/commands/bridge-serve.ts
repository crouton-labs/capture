import { runBridgeServer } from '../bridge/server.js';
import { type ParsedArgs } from '../types.js';

/**
 * Hidden entrypoint spawned detached by `capture session start --hold`
 * (see `bridge/spawn.ts`). Not documented in `capture --help` \u2014 nothing
 * calls this directly.
 */
export async function cmdBridgeServe(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (!parsed.socket) {
    console.error('Usage: capture __bridge-serve --socket <path> [--port <cdpPort>]');
    process.exit(1);
  }
  await runBridgeServer(parsed.socket, parsed.port);
  // Deliberately does not exit: the open Unix socket server and the live
  // browser websocket keep this detached process alive until `session stop`
  // sends it SIGTERM.
}
