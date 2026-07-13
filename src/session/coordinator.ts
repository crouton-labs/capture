import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { captureError } from '../errors.js';
import {
  acquirePrivateLock,
  assertUnderCaptureRoot,
  readPrivateFile,
  writeJsonPrivate,
  processPidBirthProvider,
  type PidBirth,
} from './artifacts.js';

interface OperationOwner {
  token: string;
  pid: number;
  birth: PidBirth;
}

interface OperationState {
  stopping: boolean;
  tokens: OperationOwner[];
}

export interface SessionOperation {
  token: string;
  release(): Promise<void>;
}

export interface SessionStopAdmission {
  finish(success: boolean): Promise<void>;
}

function statePath(sessionDir: string): string {
  return path.join(assertUnderCaptureRoot(sessionDir), '.operations.json');
}

function lockPath(sessionDir: string): string {
  return path.join(assertUnderCaptureRoot(sessionDir), '.operations.lock');
}

function isBirth(value: unknown): value is PidBirth {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const birth = value as Record<string, unknown>;
  return (birth.provider === 'linux-proc-v1' && typeof birth.bootId === 'string' && typeof birth.startTicks === 'string')
    || (birth.provider === 'darwin-kern-proc-v1' && typeof birth.startSec === 'string' && Number.isSafeInteger(birth.startUsec));
}

function isOperationOwner(value: unknown): value is OperationOwner {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const owner = value as Record<string, unknown>;
  return typeof owner.token === 'string' && Number.isSafeInteger(owner.pid) && (owner.pid as number) > 0 && isBirth(owner.birth);
}

function sameBirth(left: PidBirth, right: PidBirth): boolean {
  return left.provider === right.provider && (left.provider === 'linux-proc-v1'
    ? left.bootId === (right as Extract<PidBirth, { provider: 'linux-proc-v1' }>).bootId && left.startTicks === (right as Extract<PidBirth, { provider: 'linux-proc-v1' }>).startTicks
    : left.startSec === (right as Extract<PidBirth, { provider: 'darwin-kern-proc-v1' }>).startSec && left.startUsec === (right as Extract<PidBirth, { provider: 'darwin-kern-proc-v1' }>).startUsec);
}

function readState(sessionDir: string): OperationState {
  try {
    const value = JSON.parse(readPrivateFile(statePath(sessionDir)).toString('utf-8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('malformed session operation state');
    const record = value as Record<string, unknown>;
    if (typeof record.stopping !== 'boolean' || !Array.isArray(record.tokens) || !record.tokens.every(isOperationOwner)) {
      throw new Error('malformed session operation state');
    }
    return { stopping: record.stopping, tokens: [...record.tokens] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { stopping: false, tokens: [] };
    throw error;
  }
}

async function withStateLock<T>(sessionDir: string, action: (state: OperationState) => T): Promise<T> {
  const lock = await acquirePrivateLock(lockPath(sessionDir), { acquireTimeoutMs: 30_000, leaseMs: 500 });
  try {
    const state = readState(sessionDir);
    const result = action(state);
    writeJsonPrivate(statePath(sessionDir), state);
    return result;
  } finally {
    lock.release();
  }
}

/** Register before the first session-bound effect. Admissions after stop marking fail. */
export async function admitSessionOperation(sessionDir: string): Promise<SessionOperation> {
  const token = crypto.randomBytes(18).toString('hex');
  const observed = processPidBirthProvider.read(process.pid);
  if (observed.status !== 'found') throw new Error(`cannot identify session operation owner: ${observed.status === 'unknown' ? observed.reason : 'process absent'}`);
  const owner: OperationOwner = { token, pid: process.pid, birth: observed.identity };
  await withStateLock(sessionDir, state => {
    if (state.stopping) throw captureError('precondition', 'session_stopping', 'This session is stopping; start a new operation after `session stop` finalizes.');
    state.tokens.push(owner);
  });
  let released = false;
  return {
    token,
    async release() {
      if (released) return;
      await withStateLock(sessionDir, state => {
        state.tokens = state.tokens.filter(candidate => candidate.token !== token);
      });
      released = true;
    },
  };
}

/** Mark stopping, reject later admissions, and wait for every earlier token to drain. */
export async function beginSessionStop(sessionDir: string): Promise<SessionStopAdmission> {
  const stopLock = await acquirePrivateLock(path.join(assertUnderCaptureRoot(sessionDir), '.stop.lock'), {
    acquireTimeoutMs: 120_000,
    leaseMs: 1_000,
  });
  try {
    await withStateLock(sessionDir, state => { state.stopping = true; });
    for (;;) {
      const pending = await withStateLock(sessionDir, state => {
        state.tokens = state.tokens.filter(owner => {
          const observed = processPidBirthProvider.read(owner.pid);
          if (observed.status === 'unknown') throw new Error(`cannot establish session operation owner liveness: ${observed.reason}`);
          return observed.status === 'found' && sameBirth(observed.identity, owner.birth);
        });
        return state.tokens.length;
      });
      if (pending === 0) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } catch (error) {
    stopLock.release();
    throw error;
  }
  let finished = false;
  return {
    async finish(success: boolean) {
      if (finished) return;
      try {
        if (!success) await withStateLock(sessionDir, state => { state.stopping = false; });
      } finally {
        stopLock.release();
        finished = true;
      }
    },
  };
}
