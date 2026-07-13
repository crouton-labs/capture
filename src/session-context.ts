/**
 * Session Context — persists active session state so CDP commands can target
 * the session tab and write session-owned artifacts without manual threading.
 *
 * A scoped, private active-index `.active-<scope>` only tracks the active
 * session identity and directory; mutable/live state lives in the canonical
 * per-session `.session.json` file under that directory.
 */

import * as path from 'node:path';
import {
  CAPTURE_ROOT,
  acquirePrivateLock,
  assertUnderCaptureRoot,
  ensurePrivateDir,
  parseRegisteredLogTailer,
  readPrivateFile,
  removeArtifactTree,
  unlinkPrivateFile,
  writeJsonPrivate,
  type RecMeta,
  type RegisteredLogTailer,
  type SnapMeta,
} from './session/artifacts.js';

function activeScopeKey(): string {
  return process.env.CRTR_NODE_ID ?? 'default';
}

export function activeSessionScopeKey(): string {
  return activeScopeKey();
}

function getActivePath(): string {
  return path.join(CAPTURE_ROOT, `.active-${activeScopeKey()}`);
}

interface ActiveSessionIndex {
  sessionId: string;
  dir: string;
}

/** The sole authoritative mutable record stored in `<dir>/.session.json`. */
export interface ActiveSessionState {
  sessionId: string;
  dir: string;
  harId: string | null;
  startedAt?: string;
  url?: string | null;
  targetId: string | null;
  stepCount: number;
  /** Identity-bearing registered log tailer handles owned by this session. */
  logPids?: RegisteredLogTailer[];
  /**
   * Optional CDP endpoint socket port used by this session.
   * Session index files never keep this; it is only in `.session.json`.
   */
  port?: number | null;
  /** Unix socket of the session's held CDP bridge (`session start --hold`), if any. */
  bridgeSocket?: string | null;
  /** Network.emulateNetworkConditions offline state for the session target. */
  networkOffline?: boolean;
  /** Child process id of the held CDP bridge, if any. */
  bridgePid?: number | null;
  /**
   * The id of the recording (`motion/recs/{recId}`) currently live under this
   * session, if `motion rec --start` has armed one.
   */
  activeRecId?: string | null;
  /** Marker written after successful stop to keep stale active indices from blocking.
   * It is not part of the active index; only read from `.session.json`.
   */
  stoppedAt?: string | null;
  /** Optional per-session run-state marker used by later lifecycle units. */
  stopping?: boolean;
}

function isIndex(value: unknown): value is ActiveSessionIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.sessionId === 'string' && typeof record.dir === 'string';
}

function readActiveSessionIndex(): ActiveSessionIndex | null {
  try {
    const raw = readPrivateFile(getActivePath()).toString('utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isIndex(parsed)) return null;
    return { sessionId: parsed.sessionId, dir: parsed.dir };
  } catch {
    return null;
  }
}

function sessionMetaPath(sessionDir: string): string {
  return path.join(sessionDir, '.session.json');
}

function sessionStateLockPath(sessionDir: string): string {
  return path.join(assertUnderCaptureRoot(sessionDir), '.session-state.lock');
}

async function withSessionStateLock<T>(sessionDir: string, action: () => T): Promise<T> {
  const lock = await acquirePrivateLock(sessionStateLockPath(sessionDir), {
    acquireTimeoutMs: 30_000,
    leaseMs: 500,
  });
  try {
    return action();
  } finally {
    lock.release();
  }
}

function isActiveStateCandidate(value: unknown): value is ActiveSessionState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const nullableString = (field: unknown): boolean => field === undefined || field === null || typeof field === 'string';
  const nullablePid = (field: unknown): boolean => field === undefined || field === null || (Number.isSafeInteger(field) && (field as number) > 0);
  const validLogs = record.logPids === undefined
    || (Array.isArray(record.logPids) && record.logPids.every(item => parseRegisteredLogTailer(item) !== undefined));
  return typeof record.sessionId === 'string' && record.sessionId.length > 0
    && typeof record.dir === 'string'
    && (record.harId === null || typeof record.harId === 'string')
    && nullableString(record.startedAt)
    && nullableString(record.url)
    && (record.targetId === null || typeof record.targetId === 'string')
    && typeof record.stepCount === 'number'
    && Number.isSafeInteger(record.stepCount)
    && record.stepCount >= 0
    && validLogs
    && (record.port === undefined || record.port === null || (Number.isInteger(record.port) && (record.port as number) > 0 && (record.port as number) <= 65535))
    && nullableString(record.bridgeSocket)
    && nullablePid(record.bridgePid)
    && nullableString(record.activeRecId)
    && nullableString(record.stoppedAt)
    && (record.stopping === undefined || typeof record.stopping === 'boolean');
}

function clearActivePath(): void {
  const activePath = getActivePath();
  try {
    unlinkPrivateFile(activePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    // A stale planted symlink is itself an index entry, never a target to follow.
    try { removeArtifactTree(activePath); } catch { /* stale cleanup is best effort */ }
  }
}

/**
 * Reads active session metadata. Endpoint resolution uses `cleanStale: false`
 * while it decides whether a malformed ambient CDP_PORT is relevant: that
 * preserves a stale pointer for the invocation error path. Normal command
 * consumers retain the default eager stale-index cleanup.
 */
export function getActiveSession({ cleanStale = true }: { cleanStale?: boolean } = {}): ActiveSessionState | null {
  const index = readActiveSessionIndex();
  if (!index) {
    if (cleanStale) clearActivePath();
    return null;
  }

  try {
    const sessionDir = assertUnderCaptureRoot(path.resolve(index.dir));
    if (sessionDir !== index.dir) throw new Error('active session directory escaped capture root');

    try {
      readPrivateFile(path.join(sessionDir, 'bundle.json'));
      if (cleanStale) clearActivePath();
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const raw = readPrivateFile(sessionMetaPath(sessionDir)).toString('utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isActiveStateCandidate(parsed)) {
      if (cleanStale) clearActivePath();
      return null;
    }

    const state = parsed as ActiveSessionState;
    if (state.sessionId !== index.sessionId || state.dir !== sessionDir) {
      if (cleanStale) clearActivePath();
      return null;
    }
    if (state.stoppedAt) {
      if (cleanStale) clearActivePath();
      return null;
    }

    ensurePrivateDir(sessionDir);
    return state;
  } catch {
    // Any malformed/corrupt pointer or metadata file is stale. Endpoint
    // precedence may inspect it without mutation; all ordinary callers clean.
    if (cleanStale) clearActivePath();
    return null;
  }
}

export async function setActiveSession(state: ActiveSessionState): Promise<void> {
  const sessionDir = ensurePrivateDir(state.dir);
  const next: ActiveSessionState = {
    ...state,
    dir: path.resolve(sessionDir),
    sessionId: state.sessionId,
    harId: state.harId,
    targetId: state.targetId,
    stepCount: Number.isSafeInteger(state.stepCount) ? state.stepCount : 0,
  };
  const index: ActiveSessionIndex = { sessionId: next.sessionId, dir: next.dir };

  await withSessionStateLock(next.dir, () => {
    writeJsonPrivate(sessionMetaPath(next.dir), next);
    writeJsonPrivate(getActivePath(), index);
  });
}

export function clearActiveSession(): void {
  clearActivePath();
}

export function clearActiveSessionIf(sessionId: string): void {
  const index = readActiveSessionIndex();
  if (index?.sessionId === sessionId) {
    clearActivePath();
  }
}

async function mutateSessionState(
  sessionDir: string,
  mutate: (current: ActiveSessionState) => ActiveSessionState,
): Promise<ActiveSessionState> {
  const canonical = assertUnderCaptureRoot(sessionDir);
  return withSessionStateLock(canonical, () => {
    const metaPath = sessionMetaPath(canonical);
    const current = JSON.parse(readPrivateFile(metaPath).toString('utf-8')) as unknown;
    if (!isActiveStateCandidate(current) || current.dir !== canonical) throw new Error(`invalid session metadata: ${metaPath}`);
    const next = mutate(current);
    const updated = { ...next, dir: current.dir, sessionId: current.sessionId };
    if (!isActiveStateCandidate(updated)) throw new Error(`invalid session metadata update: ${metaPath}`);
    writeJsonPrivate(metaPath, updated);
    return updated;
  });
}

export function updateSessionState(sessionDir: string, patch: Partial<ActiveSessionState>): Promise<ActiveSessionState> {
  return mutateSessionState(sessionDir, current => ({ ...current, ...patch }));
}

export async function updateActiveSession(patch: Partial<ActiveSessionState>): Promise<ActiveSessionState | null> {
  const current = getActiveSession();
  if (!current) return null;
  return updateSessionState(current.dir, patch);
}

/** Records `recId` as the active session's live recording. */
export function setActiveRecId(recId: string): Promise<ActiveSessionState | null> {
  return updateActiveSession({ activeRecId: recId });
}

/** Clears the active session's live-recording pointer (on `rec --stop` / stale reap). */
export function clearActiveRecId(): Promise<ActiveSessionState | null> {
  return updateActiveSession({ activeRecId: null });
}

/** Reads the active session's live recording id, or `null` if none. */
export function getActiveRecId(): string | null {
  return getActiveSession()?.activeRecId ?? null;
}

/** Records the active session target's requested network emulation state. */
export function setActiveNetworkOffline(offline: boolean): ActiveSessionState | null {
  return updateActiveSession({ networkOffline: offline });
}

function sanitizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/**
 * Returns the next auto-numbered screenshot path for the active session.
 * Format: {dir}/shots/{NN}-{action}-{sanitized-label}.png
 * Increments stepCount in the session state.
 */
export async function nextStepPath(action: string, label: string): Promise<string | null> {
  const session = getActiveSession();
  if (!session) return null;

  const updated = await mutateSessionState(session.dir, current => ({
    ...current,
    stepCount: current.stepCount + 1,
  }));
  const nn = String(updated.stepCount).padStart(2, '0');
  const sanitized = sanitizeLabel(label);
  return path.join(updated.dir, 'shots', `${nn}-${action}-${sanitized}.png`);
}

export { type SnapMeta, type RecMeta };
