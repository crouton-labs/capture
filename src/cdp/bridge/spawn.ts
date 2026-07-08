/**
 * Spawns/stops the detached bridge process for a held session
 * (`capture session start --hold`). Mirrors the existing detached-child +
 * pid-tracking pattern used for session log tailers (`session/commands.ts`).
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export function bridgeSocketPath(sessionDir: string): string {
  return path.join(sessionDir, 'bridge.sock');
}

export async function startBridge(
  sessionDir: string,
  port: number,
  timeoutMs = 5000,
): Promise<{ socketPath: string; pid: number }> {
  const socketPath = bridgeSocketPath(sessionDir);
  // Re-invoke the currently-running capture entrypoint in a hidden mode.
  // Only works against the built bin (a bundled, plain-node-runnable JS
  // file) \u2014 running `npm run dev` (tsx) can't self-spawn this way.
  const scriptPath = process.argv[1];
  const child = spawn(
    process.execPath,
    [scriptPath, '__bridge-serve', '--socket', socketPath, '--port', String(port)],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  const pid = child.pid;
  if (!pid) {
    throw new Error('Failed to spawn CDP bridge process.');
  }

  const start = Date.now();
  while (!fs.existsSync(socketPath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `CDP bridge (pid ${pid}) did not come up within ${timeoutMs}ms. ` +
          `Check that a browser is reachable on port ${port} (capture detect).`,
      );
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  return { socketPath, pid };
}

export function stopBridge(pid: number | null | undefined, socketPath: string | null | undefined): void {
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already dead.
    }
  }
  if (socketPath) {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // Already gone.
    }
  }
}
