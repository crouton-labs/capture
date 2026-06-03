import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const LOCK_DIR = os.tmpdir();
const LOCK_STALE_MS = 120_000;
const LOCK_TIMEOUT_MS = 60_000;
const LOCK_POLL_BASE_MS = 200;

function lockPath(tabId: string): string {
  return path.join(LOCK_DIR, `capture-cdp-tab-${tabId}.lock`);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isLockStale(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { pid, ts } = JSON.parse(content) as { pid: number; ts: number };
    if (!isPidAlive(pid)) return true;
    return Date.now() - ts > LOCK_STALE_MS;
  } catch {
    return true;
  }
}

// Track locks held by this process for cleanup on exit
const heldLocks = new Set<string>();
let cleanupRegistered = false;

function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const cleanup = () => {
    for (const file of heldLocks) {
      try {
        fs.unlinkSync(file);
      } catch {
        // Best-effort
      }
    }
    heldLocks.clear();
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
}

export async function acquireTabLock(tabId: string): Promise<void> {
  registerCleanup();
  const file = lockPath(tabId);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let delay = LOCK_POLL_BASE_MS;

  while (true) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
      fs.closeSync(fd);
      heldLocks.add(file);
      return;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }

    if (isLockStale(file)) {
      try {
        fs.unlinkSync(file);
      } catch {
        // Another process may have already removed it
      }
      continue;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for CDP tab lock (${tabId}). ` +
          `Another process may be using this tab. Lock file: ${file}`,
      );
    }

    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 2000);
  }
}

export function isTabLocked(tabId: string): boolean {
  const file = lockPath(tabId);
  try {
    fs.accessSync(file);
    return !isLockStale(file);
  } catch {
    return false;
  }
}

export function releaseTabLock(tabId: string): void {
  const file = lockPath(tabId);
  heldLocks.delete(file);
  try {
    fs.unlinkSync(file);
  } catch {
    // Already removed — fine
  }
}

export async function withTabLock<T>(
  tabId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await acquireTabLock(tabId);
  try {
    return await fn();
  } finally {
    releaseTabLock(tabId);
  }
}
