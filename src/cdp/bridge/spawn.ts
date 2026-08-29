/**
 * Spawns/stops the detached bridge process for a held session
 * (`capture session start --hold`). Mirrors the existing detached-child +
 * pid-tracking pattern used for session log tailers (`session/commands.ts`).
 */

import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CAPTURE_ROOT } from '../../session/artifacts.js';

export function bridgeSocketPath(sessionDir: string): string {
  return path.join(sessionDir, 'bridge.sock');
}

/**
 * The collector host socket is stored in a short private directory because
 * macOS caps `AF_UNIX` paths at about 104 bytes. This cannot live beneath
 * CAPTURE_ROOT: test and caller roots can already consume that entire budget.
 */
function collectorSocketDir(): string {
  const dir = '/tmp/capture-sockets';
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`collector socket directory is not a real directory: ${dir}`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error(`collector socket directory is not owned by this user: ${dir}`);
  fs.chmodSync(dir, 0o700);
  return dir;
}

function shortSocketName(scopeDir: string): string {
  return crypto.createHash('sha1').update(path.resolve(scopeDir)).digest('hex').slice(0, 16);
}

/** The one collector host socket is keyed by its session, not an individual artifact. */
export function collectorHostSocketPath(sessionDir: string): string {
  return path.join(collectorSocketDir(), `host-${shortSocketName(sessionDir)}.sock`);
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
      // Own the child we spawned: a bridge that never signalled readiness is
      // ours to reap before we reject, so no orphaned process outlives the
      // failed start. Mirrors startRecorderBridge()'s ownership discipline.
      stopBridge(pid, socketPath);
      throw new Error(
        `CDP bridge (pid ${pid}) did not come up within ${timeoutMs}ms. ` +
          `Check that a browser is reachable on port ${port} (capture tab list --port ${port}).`,
      );
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  return { socketPath, pid };
}

export async function startCollectorHost(
  socketPath: string,
  port: number,
  targetId: string,
  sessionDir: string,
  timeoutMs = 5000,
): Promise<{ socketPath: string; pid: number }> {
  const child = spawn(process.execPath, [process.argv[1], '__bridge-serve', '--socket', socketPath, '--port', String(port), '--target', targetId, 'host', sessionDir], { detached: true, stdio: 'ignore' });
  child.unref();
  if (!child.pid) throw new Error('Failed to spawn collector host process.');
  const started = Date.now();
  while (!fs.existsSync(socketPath)) {
    if (Date.now() - started > timeoutMs) {
      stopBridge(child.pid, socketPath);
      throw new Error(`Collector host (pid ${child.pid}) did not come up within ${timeoutMs}ms.`);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return { socketPath, pid: child.pid };
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
      if (fs.lstatSync(socketPath).isSocket()) fs.unlinkSync(socketPath);
    } catch {
      // Already gone.
    }
  }
}
