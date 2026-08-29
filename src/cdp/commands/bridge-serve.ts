import { runBridgeServer } from '../bridge/server.js';
import { runCollectorHost } from '../host/server.js';
import { invalidInput } from '../../errors.js';
import { type ParsedArgs } from '../types.js';

/**
 * Hidden entrypoint spawned detached by `capture session start --hold`
 * (see `bridge/spawn.ts`'s `startBridge()`) or by `capture motion rec
 * --start` in collector-host mode. Not documented in `capture --help` —
 * nothing calls this directly. Collector-host mode is selected by the
 * `host <sessionDir>` positional:
 *   capture __bridge-serve --socket <path> --port <cdpPort> --target <tabId> host <sessionDir>
 *
 * Usage errors throw the repo's structured `CaptureError` — the root
 * boundary in `src/capture.ts` renders it via `failureResult()` and exits
 * nonzero, same as every other command leaf.
 */
export async function cmdBridgeServe(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (!parsed.socket) {
    throw invalidInput(
      'Usage: capture __bridge-serve --socket <path> [--port <cdpPort>] [--target <tabId>] [host <sessionDir>]',
      'bridge_serve_usage',
    );
  }

  if (parsed.positional[0] === 'host') {
    const sessionDir = parsed.positional[1];
    if (!parsed.target || !sessionDir || parsed.port === undefined) {
      throw invalidInput('Usage: capture __bridge-serve --socket <path> --port <cdpPort> --target <tabId> host <sessionDir>', 'bridge_serve_usage');
    }
    await runCollectorHost({ socketPath: parsed.socket, port: parsed.port, targetId: parsed.target, sessionDir });
    return;
  }

  await runBridgeServer(parsed.socket, parsed.port);
  // Deliberately does not exit: the open Unix socket server and the live
  // browser websocket keep this detached process alive until `session stop`
  // sends it SIGTERM.
}
