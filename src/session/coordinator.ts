import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { captureError } from '../errors.js';
import {
  acquirePrivateLock,
  assertUnderCaptureRoot,
  readPrivateFile,
  sameBirth,
  writeJsonPrivate,
  processPidBirthProvider,
  type PidBirth,
  type PidBirthProvider,
} from './artifacts.js';
import { getActiveSession, updateSessionState } from '../session-context.js';

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

// ---------------------------------------------------------------------------
// Neutral recorder-handle scan + lifecycle transaction. Owned here so tab/reset
// and recorder start never import a motion feature (A2). Motion CONSEQUENCES
// (orphan finalize, markers/meta, viewport restore) stay in recorder.ts.
// ---------------------------------------------------------------------------

export interface RecorderHandleRecord {
  recId: string; pid: number; socketPath: string; targetId: string;
  url: string | null; startedAt: string; state: string; birth: PidBirth; markers: unknown;
  /** The recording's control-socket admission token (64 lowercase hex chars,
   * server-generated by the recorder bridge at boot). Required — a handle
   * without a structurally valid nonce is malformed; there is no
   * unauthenticated or legacy handle shape. */
  nonce: string;
}
export type RecorderHandleClassification = 'live' | 'dead' | 'malformed' | 'unknown';
export interface ScannedRecorderHandle {
  recId: string; recDir: string; classification: RecorderHandleClassification;
  record: RecorderHandleRecord | null; // null iff malformed
}
export interface LifecycleSeams {
  pidBirthProvider?: PidBirthProvider; nowNs?: () => bigint;
  sleep?: (ms: number) => Promise<void>; token?: () => string;
  acquireTimeoutMs?: number; leaseMs?: number;
  /** How long a graceful recorder stop waits for the bridge process's own
   * verified exit before escalating to an identity-checked SIGTERM
   * (default ~2000ms) — injectable so tests with never-exiting placeholder
   * children stay fast. */
  stopExitTimeoutMs?: number;
}

/** Structural gate for a recorder control-socket nonce — the exact shape the
 * bridge generates (`crypto.randomBytes(32).toString('hex')`). */
export const RECORDER_NONCE = /^[0-9a-f]{64}$/;

function parseRecorderHandle(raw: unknown): RecorderHandleRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.recId !== 'string' || !r.recId) return null;
  if (!Number.isSafeInteger(r.pid) || (r.pid as number) <= 0) return null;
  if (typeof r.socketPath !== 'string' || !r.socketPath) return null;
  if (typeof r.targetId !== 'string' || !r.targetId) return null;
  if (!(r.url === null || typeof r.url === 'string')) return null;
  if (typeof r.startedAt !== 'string' || !r.startedAt) return null;
  if (typeof r.state !== 'string' || !r.state) return null;
  if (!isBirth(r.birth)) return null;
  if (typeof r.nonce !== 'string' || !RECORDER_NONCE.test(r.nonce)) return null;
  return { recId: r.recId, pid: r.pid as number, socketPath: r.socketPath, targetId: r.targetId,
    url: r.url as string | null, startedAt: r.startedAt, state: r.state, birth: r.birth as PidBirth, markers: r.markers,
    nonce: r.nonce };
}

/** True iff the recorded process is the same birth-identity still alive. */
export function recorderProcessAlive(record: Pick<RecorderHandleRecord, 'pid' | 'birth'>, provider: PidBirthProvider = processPidBirthProvider): boolean {
  const now = provider.read(record.pid);
  return now.status === 'found' && sameBirth(now.identity, record.birth);
}

export function scanRecorderHandles(sessionDir: string, seams: LifecycleSeams = {}): ScannedRecorderHandle[] {
  const provider = seams.pidBirthProvider ?? processPidBirthProvider;
  const recsRoot = path.join(assertUnderCaptureRoot(sessionDir), 'motion', 'recs');
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(recsRoot, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const out: ScannedRecorderHandle[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const recDir = path.join(recsRoot, entry.name);
    let raw: unknown;
    try { raw = JSON.parse(readPrivateFile(path.join(recDir, 'recorder.json')).toString('utf-8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; // no handle
      out.push({ recId: entry.name, recDir, classification: 'malformed', record: null }); continue;
    }
    const record = parseRecorderHandle(raw);
    if (!record) { out.push({ recId: entry.name, recDir, classification: 'malformed', record: null }); continue; }
    const read = provider.read(record.pid);
    const classification: RecorderHandleClassification =
      read.status === 'unknown' ? 'unknown'
      : (read.status === 'found' && sameBirth(read.identity, record.birth) && record.state === 'recording') ? 'live'
      : 'dead';
    out.push({ recId: entry.name, recDir, classification, record });
  }
  return out;
}

/** Reset-time pointer hygiene: reset does NOT remove dead handles — it only
 * clears a session pointer that no longer names a LIVE recorder. Dead handles
 * are left intact so motion's own reapDeadHandles / session-stop teardown
 * orphan-finalizes them on the next start/stop, preserving their partial frames
 * as meta.json in the bundle. */
export async function clearDanglingRecorderPointer(sessionDir: string, scan: ScannedRecorderHandle[]): Promise<void> {
  const active = getActiveSession();
  if (active && active.dir === sessionDir && active.activeRecId
      && !scan.some(h => h.recId === active.activeRecId && h.classification === 'live')) {
    await updateSessionState(sessionDir, { activeRecId: null });
  }
}

export async function withSessionLifecycle<T>(sessionDir: string, action: () => Promise<T>, seams: LifecycleSeams = {}): Promise<T> {
  const lock = await acquirePrivateLock(path.join(assertUnderCaptureRoot(sessionDir), '.lifecycle.lock'), {
    acquireTimeoutMs: seams.acquireTimeoutMs ?? 30_000, leaseMs: seams.leaseMs ?? 30_000,
    pidBirthProvider: seams.pidBirthProvider, nowNs: seams.nowNs, sleep: seams.sleep, token: seams.token,
  });
  try { return await action(); } finally { lock.release(); }
}
