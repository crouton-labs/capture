import { runBridgeServer } from '../bridge/server.js';
import { runRecorderBridge } from '../recorder-bridge.js';
import { type ParsedArgs } from '../types.js';

/**
 * Hidden entrypoint spawned detached by `capture session start --hold`
 * (see `bridge/spawn.ts`'s `startBridge()`) or by `capture motion rec
 * --start` in recorder mode (`startRecorderBridge()`). Not documented in
 * `capture --help` — nothing calls this directly.
 *
 * Recorder mode is selected by a `recorder <recDir>` positional rather
 * than a new flag, since `src/cdp/args.ts`'s fixed flag set isn't owned by
 * this unit but `parsed.positional` is already generic passthrough:
 *   capture __bridge-serve --socket <path> --port <cdpPort> --target <tabId> recorder <recDir>
 */
export async function cmdBridgeServe(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (!parsed.socket) {
    console.error(
      'Usage: capture __bridge-serve --socket <path> [--port <cdpPort>] [--target <tabId> recorder <recDir>]',
    );
    process.exit(1);
  }

  if (parsed.positional[0] === 'recorder') {
    const recDir = parsed.positional[1];
    if (!parsed.target || !recDir) {
      console.error(
        'Usage: capture __bridge-serve --socket <path> --port <cdpPort> --target <tabId> recorder <recDir>',
      );
      process.exit(1);
    }
    await runRecorderBridge({ socketPath: parsed.socket, port: parsed.port, targetId: parsed.target, recDir });
    // Deliberately does not exit: the open Unix socket server and the live
    // tab websocket keep this detached process alive until the caller sends
    // it SIGTERM (same teardown as the plain held bridge).
    return;
  }

  await runBridgeServer(parsed.socket, parsed.port);
  // Deliberately does not exit: the open Unix socket server and the live
  // browser websocket keep this detached process alive until `session stop`
  // sends it SIGTERM.
}
