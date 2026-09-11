/**
 * Spawns/stops the detached bridge process for a held session
 * (`capture session start --hold`). Mirrors the existing detached-child +
 * pid-tracking pattern used for session log tailers (`session/commands.ts`).
 */

import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Bridge sockets live in a short private directory because macOS caps
 * `AF_UNIX` paths at about 104 bytes. This cannot live beneath CAPTURE_ROOT:
 * test and caller roots can already consume that entire budget.
 */
function socketDir(): string {
  const dir = '/tmp/capture-sockets';
  try { fs.mkdirSync(dir, { mode: 0o700 }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`bridge socket directory is not a real directory: ${dir}`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error(`bridge socket directory is not owned by this user: ${dir}`);
  fs.chmodSync(dir, 0o700);
  return dir;
}

function shortSocketName(scopeDir: string): string {
  return crypto.createHash('sha1').update(path.resolve(scopeDir)).digest('hex').slice(0, 16);
}

function sessionSocketPath(sessionDir: string, kind: 'bridge' | 'host'): string {
  return path.join(socketDir(), `${kind}-${shortSocketName(sessionDir)}.sock`);
}

export function bridgeSocketPath(sessionDir: string): string {
  return sessionSocketPath(sessionDir, 'bridge');
}

/** The one collector host socket is keyed by its session, not an individual artifact. */
export function collectorHostSocketPath(sessionDir: string): string {
  return sessionSocketPath(sessionDir, 'host');
}

type BridgeChildMessage = { type?: unknown; error?: unknown };

function startupError(label: string, pid: number, detail: string): Error {
  return new Error(`${label} (pid ${pid}) failed to start: ${detail}`);
}

async function startBridgeChild(
  label: string,
  socketPath: string,
  args: string[],
  timeoutMs: number,
): Promise<{ socketPath: string; pid: number }> {
  const child = spawn(process.execPath, [process.argv[1], '__bridge-serve', ...args], {
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  child.unref();
  const pid = child.pid;
  if (!pid) throw new Error(`Failed to spawn ${label.toLowerCase()} process.`);

  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('exit', onExit);
      child.stderr?.removeAllListeners('data');
    };
    const detach = (): void => {
      if (child.connected) child.disconnect();
      child.stderr?.destroy();
    };
    const succeed = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      detach();
      resolve({ socketPath, pid });
    };
    const fail = (error: Error, reap = true): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (reap) stopBridge(pid, socketPath);
      detach();
      reject(error);
    };
    const onMessage = (message: BridgeChildMessage): void => {
      if (message?.type === 'bridge-ready') succeed();
      if (message?.type === 'bridge-error') {
        fail(startupError(label, pid, typeof message.error === 'string' ? message.error : 'bridge child reported an unknown error'));
      }
    };
    const onError = (error: Error): void => fail(startupError(label, pid, error.message));
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      const outcome = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
      fail(startupError(label, pid, stderr.trim() || outcome), false);
    };
    const timeout = setTimeout(() => {
      fail(startupError(label, pid, `did not report readiness within ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('message', onMessage);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

export async function startBridge(
  sessionDir: string,
  port: number,
  timeoutMs = 5000,
): Promise<{ socketPath: string; pid: number }> {
  const socketPath = bridgeSocketPath(sessionDir);
  return startBridgeChild('CDP bridge', socketPath, ['--socket', socketPath, '--port', String(port)], timeoutMs);
}

export async function startCollectorHost(
  socketPath: string,
  port: number,
  targetId: string,
  sessionDir: string,
  timeoutMs = 5000,
): Promise<{ socketPath: string; pid: number }> {
  return startBridgeChild(
    'Collector host',
    socketPath,
    ['--socket', socketPath, '--port', String(port), '--target', targetId, 'host', sessionDir],
    timeoutMs,
  );
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
