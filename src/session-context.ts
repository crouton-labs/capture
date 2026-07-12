/**
 * Session Context — persists active session state so CDP commands
 * can auto-fill --target, --har, and --out without manual threading.
 *
 * State is written to /tmp/capture-sessions/.active-<scope> (JSON), where
 * <scope> isolates concurrent callers (see activeScopeKey() below) so one
 * caller's `session start` never clobbers another's active pointer.
 * Stale sessions (dir deleted, crashed process) are cleaned up on read.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CAPTURE_ROOT } from './session/artifacts.js';

/**
 * The active-session pointer is scoped per caller so concurrent, unrelated
 * capture invocations never clobber one another's "active session" — e.g.
 * two crtr agent nodes each running `capture session start` in parallel.
 * When invoked from a crtr node, CRTR_NODE_ID scopes the pointer to that
 * node (stable across separate tool calls within the node's lifetime).
 * Outside crtr (a bare interactive terminal), there's no such identity, so
 * fall back to the single legacy pointer — the original single-user,
 * single-session-at-a-time contract still holds there.
 */
function activeScopeKey(): string {
  return process.env.CRTR_NODE_ID ?? 'default';
}

function getActivePath(): string {
  return path.join(CAPTURE_ROOT, `.active-${activeScopeKey()}`);
}

export interface ActiveSessionState {
  sessionId: string;
  dir: string;
  harId: string | null;
  targetId: string | null;
  /** CDP endpoint that owns targetId; session commands must prefer it over discovery. */
  cdpPort?: number | null;
  stepCount: number;
  /** Unix socket of the session's held CDP bridge (`session start --hold`), if any. */
  bridgeSocket?: string | null;
  /** Network.emulateNetworkConditions offline state for the session target. */
  networkOffline?: boolean;
  /**
   * The id of the recording (`motion/recs/{recId}`) currently live under
   * this session, if `motion rec --start` has armed one. Cleared by
   * `motion rec --stop` (or a stale-recorder reap). See
   * {@link setActiveRecId}/{@link clearActiveRecId}/{@link getActiveRecId}.
   */
  activeRecId?: string | null;
}

export function getActiveSession(): ActiveSessionState | null {
  try {
    const activePath = getActivePath();
    if (!fs.existsSync(activePath)) return null;
    const state = JSON.parse(fs.readFileSync(activePath, 'utf-8')) as ActiveSessionState;
    // Validate session dir still exists — clean up stale files
    if (!fs.existsSync(state.dir)) {
      clearActiveSession();
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export function setActiveSession(state: ActiveSessionState): void {
  fs.mkdirSync(CAPTURE_ROOT, { recursive: true });
  fs.writeFileSync(getActivePath(), JSON.stringify(state, null, 2));
}

export function clearActiveSession(): void {
  try {
    fs.unlinkSync(getActivePath());
  } catch {
    // Already gone
  }
}

export function updateActiveSession(patch: Partial<ActiveSessionState>): ActiveSessionState | null {
  const current = getActiveSession();
  if (!current) return null;
  const updated = { ...current, ...patch };
  setActiveSession(updated);
  return updated;
}

/** Records `recId` as the active session's live recording. */
export function setActiveRecId(recId: string): ActiveSessionState | null {
  return updateActiveSession({ activeRecId: recId });
}

/** Clears the active session's live-recording pointer (on `rec --stop` / stale reap). */
export function clearActiveRecId(): ActiveSessionState | null {
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
export function nextStepPath(action: string, label: string): string | null {
  const session = getActiveSession();
  if (!session) return null;

  const step = session.stepCount + 1;
  const nn = String(step).padStart(2, '0');
  const sanitized = sanitizeLabel(label);
  const filename = `${nn}-${action}-${sanitized}.png`;
  const shotPath = path.join(session.dir, 'shots', filename);

  updateActiveSession({ stepCount: step });
  return shotPath;
}
