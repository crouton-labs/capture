import { runBridgeServer } from '../bridge/server.js';
import { runRecorderBridge } from '../recorder-bridge.js';
import { invalidInput } from '../../errors.js';
import { type ParsedArgs } from '../types.js';

/**
 * Hidden entrypoint spawned detached by `capture session start --hold`
 * (see `bridge/spawn.ts`'s `startBridge()`) or by `capture motion rec
 * --start` in recorder mode (`startRecorderBridge()`). Not documented in
 * `capture --help` — nothing calls this directly.
 *
 * Recorder mode is selected by a `recorder <recDir> <harId>` positional
 * rather than a new flag, since `src/cdp/args.ts`'s fixed flag set isn't
 * owned by this unit but `parsed.positional` is already generic passthrough:
 *   capture __bridge-serve --socket <path> --port <cdpPort> --target <tabId> recorder <recDir> <harId>
 *
 * Usage errors throw the repo's structured `CaptureError` — the root
 * boundary in `src/capture.ts` renders it via `failureResult()` and exits
 * nonzero, same as every other command leaf.
 */
export async function cmdBridgeServe(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (!parsed.socket) {
    throw invalidInput(
      'Usage: capture __bridge-serve --socket <path> [--port <cdpPort>] [--target <tabId> recorder <recDir> <harId>]',
      'bridge_serve_usage',
    );
  }

  if (parsed.positional[0] === 'recorder') {
    const recDir = parsed.positional[1];
    const harId = parsed.positional[2];
    if (!parsed.target || !recDir || !harId) {
      throw invalidInput(
        'Usage: capture __bridge-serve --socket <path> --port <cdpPort> --target <tabId> recorder <recDir> <harId>',
        'bridge_serve_usage',
      );
    }
    await runRecorderBridge({ socketPath: parsed.socket, port: parsed.port, targetId: parsed.target, recDir, harId });
    // Deliberately does not exit: the open Unix socket server and the live
    // tab websocket keep this detached process alive until an authenticated
    // `rec-stop` completes (self-exit) or the caller escalates with SIGTERM.
    return;
  }

  await runBridgeServer(parsed.socket, parsed.port);
  // Deliberately does not exit: the open Unix socket server and the live
  // browser websocket keep this detached process alive until `session stop`
  // sends it SIGTERM.
}
