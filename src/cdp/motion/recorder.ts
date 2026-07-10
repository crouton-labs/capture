/**
 * Recorder LIFECYCLE orchestration for the composed `motion rec --start` /
 * `--stop` form — spawns/finalizes the recorder-mode held bridge
 * (`../recorder-bridge.ts` via `../bridge/spawn.ts`), persists the
 * live-recorder handle (`recorder.json`), and writes the finalized
 * `markers.json`/`meta.json`. `../commands/motion/rec.ts` is the only
 * caller for the command path; `../../session/commands.ts` calls
 * `teardownAnyLiveRecorderAtSessionStop` from `session stop`.
 *
 * This module does NOT drive the browser directly and does NOT talk CDP —
 * all of that lives in `../recorder-bridge.ts` (U13, already built/frozen);
 * this module only spawns/addresses that process and shapes its
 * request/response pairs into the artifact files the design calls for.
 *
 * One-shot (`rec --do`/`rec <url>`) recording is a separate, simpler path
 * (an in-process `RecorderSession`, no detached bridge) that a later unit
 * (U24) adds directly to `rec.ts` — out of scope here.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  ensurePrivateDir,
  writeJsonPrivate,
  removeArtifactTree,
  type RecMeta,
} from '../../session/artifacts.js';
import { startRecorderBridge, recorderSocketPath, stopBridge } from '../bridge/spawn.js';
import { requestRecStart, requestRecStop } from '../recorder-client.js';
import { detectCdpPort } from '../detect.js';
import { sanitizeString } from '../measure/redaction.js';
import { type RecorderClockBaselines } from '../bridge/protocol.js';
import { getActiveRecId, setActiveRecId, clearActiveRecId, getActiveSession, type ActiveSessionState } from '../../session-context.js';

// ---------------------------------------------------------------------------
// recorder.json — the live-recorder handle. NOT part of the finalized
// recording inventory (removed on finalize/reap); this module is the only
// reader/writer of it.
// ---------------------------------------------------------------------------

export type RecorderLiveState = 'recording' | 'finalized' | 'orphaned-finalized';

export interface RecorderJson {
  recId: string;
  pid: number;
  socketPath: string;
  targetId: string;
  url: string | null;
  startedAt: string;
  state: RecorderLiveState;
  /** The baseline triple captured at `rec-start` — possibly still `baselinesPending: true`;
   * `markers.json` at finalize time uses the FRESH triple from `rec-stop`'s response instead
   * of this snapshot (see `finalizeFromLiveStop` below), never recomputing it independently. */
  markers: RecorderClockBaselines;
}

export function recDirFor(sessionDir: string, recId: string): string {
  return path.join(sessionDir, 'motion', 'recs', recId);
}

function recsRootFor(sessionDir: string): string {
  return path.join(sessionDir, 'motion', 'recs');
}

const SAFE_REC_ID = /^[A-Za-z0-9_-]+$/;

/** Validates an explicit (CLI `--rec-id`) recId as a safe path basename and
 * asserts the directory it resolves to stays under this session's
 * `motion/recs` root — defense against a recId containing `..` or an
 * absolute-path escape. Throws a factual error; no lenient sanitizing. Only
 * ever called on the external/explicit `opts.recId` — internally-generated
 * ids (`crypto.randomBytes`, or `readdirSync` entries already confined to
 * `recsRoot`) never need it. */
function validateRecId(sessionDir: string, recId: string): string {
  if (!SAFE_REC_ID.test(recId)) {
    throw new Error(`Invalid --rec-id "${recId}": must be a plain basename (letters, digits, "-", "_" only).`);
  }
  const recsRoot = path.resolve(recsRootFor(sessionDir));
  const resolved = path.resolve(recDirFor(sessionDir, recId));
  if (resolved !== recsRoot && !resolved.startsWith(recsRoot + path.sep)) {
    throw new Error(`Invalid --rec-id "${recId}": resolves outside the session's recording directory.`);
  }
  return recId;
}

function startLockPath(sessionDir: string): string {
  return path.join(recsRootFor(sessionDir), '.start.lock');
}

/** Acquires the exclusive "a start is in flight" lock for this session via an
 * atomic create-exclusive (`wx`) file open — the OS guarantees only one of
 * two concurrent `startComposedRecorder` invocations (even across separate
 * `capture` process invocations) can win this open; the loser gets `EEXIST`
 * synchronously and fails fast with the same "already active" error, no
 * wait/retry (no lenient fallback). Must always be paired with
 * `releaseStartLock` in a `finally`. */
function acquireStartLock(sessionDir: string): number {
  ensurePrivateDir(recsRootFor(sessionDir));
  try {
    return fs.openSync(startLockPath(sessionDir), 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(
        'A recording is already active on this session. Stop it first: `capture motion rec --stop`.',
      );
    }
    throw err;
  }
}

function releaseStartLock(sessionDir: string, fd: number): void {
  try {
    fs.closeSync(fd);
  } catch {
    // Already closed.
  }
  try {
    fs.unlinkSync(startLockPath(sessionDir));
  } catch {
    // Already gone.
  }
}

/** The active-session pointer (`session-context.ts`, scoped per-caller by
 * `CRTR_NODE_ID`) is a SINGLE global pointer, not one per session id — so
 * before trusting/clearing its `activeRecId`, every reap/teardown path here
 * must first confirm that pointer actually names THIS session's dir, not
 * some other concurrently-active session. Returns `null` if it doesn't. */
function activeSessionMatching(sessionDir: string): ActiveSessionState | null {
  const active = getActiveSession();
  return active && active.dir === sessionDir ? active : null;
}

/** Directory-authoritative discovery: every `motion/recs/{recId}/recorder.json`
 * under this session, regardless of whether the (single, global,
 * possibly-stale-or-elsewhere-pointing) `activeRecId` pointer names it.
 * This is what makes reap/teardown work even when the pointer is absent, or
 * currently names a different session — see this file's `reapStaleActiveRecorder`/
 * `teardownAnyLiveRecorderAtSessionStop` header comments. */
function listLiveRecorderHandles(
  sessionDir: string,
): Array<{ recId: string; recDir: string; rj: RecorderJson }> {
  const recsRoot = recsRootFor(sessionDir);
  if (!fs.existsSync(recsRoot)) return [];
  const out: Array<{ recId: string; recDir: string; rj: RecorderJson }> = [];
  for (const entry of fs.readdirSync(recsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const recDir = path.join(recsRoot, entry.name);
    const rj = readRecorderJson(recDir);
    if (rj) out.push({ recId: entry.name, recDir, rj });
  }
  return out;
}

function recorderJsonPath(recDir: string): string {
  return path.join(recDir, 'recorder.json');
}

function markersPath(recDir: string): string {
  return path.join(recDir, 'markers.json');
}

function metaPath(recDir: string): string {
  return path.join(recDir, 'meta.json');
}

/** Reads `recorder.json`, or `null` if absent/unparseable (already reaped, or never existed). */
export function readRecorderJson(recDir: string): RecorderJson | null {
  try {
    return JSON.parse(fs.readFileSync(recorderJsonPath(recDir), 'utf-8')) as RecorderJson;
  } catch {
    return null;
  }
}

/** `kill -0` liveness check — `EPERM` still means the process exists (just owned by someone else); only `ESRCH`-shaped failures mean it's gone. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Best-effort session url, read directly from `.session.json` rather than
 * threading `session/commands.ts`'s internal `Session` type through here —
 * keeps this module decoupled from that file (which itself calls INTO this
 * module at session-stop time; an import back the other way would cycle).
 * Redacted at this single boundary — a URL query param can carry a
 * secret token, and this is the one place a session's raw url enters both
 * `recorder.json.url` (below) and, via that field, `meta.json.url` (see
 * `writeFinalizedArtifacts`), so redacting here covers both artifacts. */
function readSessionUrl(sessionDir: string): string | null {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(sessionDir, '.session.json'), 'utf-8')) as { url?: string | null };
    const url = meta.url ?? null;
    return url === null ? null : sanitizeString(url);
  } catch {
    return null;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function countFrames(recDir: string): number {
  const framesDir = path.join(recDir, 'frames');
  if (!fs.existsSync(framesDir)) return 0;
  return fs.readdirSync(framesDir).filter((f) => f.endsWith('.png')).length;
}

// ---------------------------------------------------------------------------
// Finalize — shared by a graceful `rec-stop`, an orphaned (dead-pid) reap,
// and session-stop teardown. Writes markers.json + meta.json, removes
// recorder.json, clears activeRecId. Never re-derives baselines itself.
// ---------------------------------------------------------------------------

export interface FinalizedRecording {
  recId: string;
  recDir: string;
  frames: number;
  durationMs: number;
  fps: number;
  state: RecorderLiveState;
  /** Input-landmark count observed at graceful `rec-stop` time; `null` when
   * the recorder was orphaned/best-effort finalized (no live socket to ask). */
  eventCount: number | null;
}

/** Clears the (single, global, per-caller-scoped) `activeRecId` pointer
 * ONLY if it currently names this exact `(sessionDir, recId)` — i.e. only
 * when the pointer is actually OURS to clear. A teardown/reap running
 * against session A must never blow away session B's pointer just because
 * B happens to be the currently-active one for this caller scope. */
function clearActiveRecIdIfOwned(sessionDir: string, recId: string): void {
  const active = getActiveSession();
  if (active && active.dir === sessionDir && active.activeRecId === recId) {
    clearActiveRecId();
  }
}

function writeFinalizedArtifacts(
  sessionDir: string,
  recDir: string,
  recId: string,
  url: string | null,
  frames: number,
  durationMs: number,
  state: RecorderLiveState,
  markers: RecorderClockBaselines,
  eventCount: number | null,
): FinalizedRecording {
  const fps = durationMs > 0 ? round1(frames / (durationMs / 1000)) : 0;
  writeJsonPrivate(markersPath(recDir), markers);
  const meta: RecMeta & { url: string | null; fps: number; eventCount: number | null } = {
    id: recId,
    action: null,
    frames,
    durationMs,
    state,
    url,
    fps,
    eventCount,
  };
  writeJsonPrivate(metaPath(recDir), meta);
  removeArtifactTree(recorderJsonPath(recDir));
  clearActiveRecIdIfOwned(sessionDir, recId);
  return { recId, recDir, frames, durationMs, fps, state, eventCount };
}

/** Best-effort finalize when the recorder process is dead, or known-alive but
 * unresponsive on its socket: counts whatever `frames/`/lack thereof already
 * made it to disk, computes duration from `recorder.json`'s own `startedAt`,
 * and reuses whichever baseline triple `rec-start` last persisted (it cannot
 * get a fresher one — nothing is listening on the socket anymore).
 *
 * `killPid` lets a caller that already confirmed the pid is alive (but its
 * socket round trip failed) still SIGTERM it here, rather than orphan-finalizing
 * a live process without ever stopping it. Callers finalizing an already-dead
 * pid pass `null` (the default) — killing a dead pid would be a no-op anyway,
 * but staying explicit keeps that path from depending on `rj.pid`'s liveness. */
function finalizeOrphaned(rj: RecorderJson, recDir: string, sessionDir: string, killPid: number | null = null): FinalizedRecording {
  const frames = countFrames(recDir);
  const durationMs = Math.max(0, Date.now() - Date.parse(rj.startedAt));
  stopBridge(killPid, rj.socketPath); // best-effort: SIGTERM only if a live pid was passed; always cleans up the socket file
  return writeFinalizedArtifacts(sessionDir, recDir, rj.recId, rj.url, frames, durationMs, 'orphaned-finalized', rj.markers, null);
}

// ---------------------------------------------------------------------------
// Stale-recorder reap — a `recorder.json` whose pid is dead. Called at the
// top of `startComposedRecorder` (never resume, always reap-then-proceed)
// and by `session stop` (never resume, tear down instead).
// ---------------------------------------------------------------------------

/**
 * Directory-authoritative stale-recorder reap: scans every
 * `motion/recs/{recId}/recorder.json` under `sessionDir` (NOT just the one the
 * global `activeRecId` pointer happens to name — a `recorder.json` can
 * outlive that pointer, or the pointer can be pointing at a different
 * session entirely) and, for each handle whose pid is dead, finalizes it
 * best-effort (`state: "orphaned-finalized"`). Live handles are left alone
 * untouched — reap never resumes, and a still-live recorder is not stale.
 * Clears the `activeRecId` pointer only when it's actually this session's
 * (see `clearActiveRecIdIfOwned`), including the dangling-pointer case
 * (pointer set, but no matching on-disk handle left to reap). Returns the
 * handle the pointer named, if any was reaped, else the first one reaped,
 * else `null` if there was nothing stale to reap. */
export function reapStaleActiveRecorder(sessionDir: string): FinalizedRecording | null {
  const handles = listLiveRecorderHandles(sessionDir);
  const activeHere = activeSessionMatching(sessionDir);

  let primary: FinalizedRecording | null = null;
  for (const { recId, recDir, rj } of handles) {
    if (isPidAlive(rj.pid)) continue;
    const finalized = finalizeOrphaned(rj, recDir, sessionDir);
    if (recId === activeHere?.activeRecId || primary === null) primary = finalized;
  }

  if (activeHere?.activeRecId && !handles.some((h) => h.recId === activeHere.activeRecId)) {
    clearActiveRecId();
  }

  return primary;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export interface StartRecorderResult {
  recId: string;
  recDir: string;
  state: 'recording';
  /** Set when a stale prior recording was reaped before this one armed. */
  reapedStale: FinalizedRecording | null;
}

/**
 * Injectable seams for `startComposedRecorder`'s two external effects (CDP
 * port detection and spawning the detached recorder-bridge process) —
 * lets tests exercise the full start path (recorder.json shape, stale-reap,
 * activeRecId bookkeeping) against a fake NDJSON socket server instead of a
 * real spawned `__bridge-serve` child (which only works against the built
 * bin, not a `tsx`-run test — see `../bridge/spawn.ts`'s own doc comment).
 * Omit both in production; only tests pass `deps`.
 */
export interface StartRecorderDeps {
  detectPort?: () => Promise<number>;
  spawnRecorderBridge?: typeof startRecorderBridge;
}

export async function startComposedRecorder(
  opts: {
    sessionDir: string;
    targetId: string | null;
  },
  deps: StartRecorderDeps = {},
): Promise<StartRecorderResult> {
  const reapedStale = reapStaleActiveRecorder(opts.sessionDir);

  // The lock closes the check-then-spawn race between two concurrent
  // `startComposedRecorder` calls (see `acquireStartLock`'s doc comment);
  // the directory scan below (not just the `activeRecId` pointer) is what
  // closes the "live recorder.json with a missing/cleared pointer" gap.
  const lockFd = acquireStartLock(opts.sessionDir);
  try {
    const liveElsewhere = listLiveRecorderHandles(opts.sessionDir).some(({ rj }) => isPidAlive(rj.pid));
    if (getActiveRecId() || liveElsewhere) {
      throw new Error(
        'A recording is already active on this session. Stop it first: `capture motion rec --stop`.',
      );
    }
    if (!opts.targetId) {
      throw new Error(
        'The active session has no attached tab to record. Start it with a URL: `capture session start --url <url>`.',
      );
    }

    const recId = `rec-${crypto.randomBytes(2).toString('hex')}`;
    const recDir = recDirFor(opts.sessionDir, recId);
    ensurePrivateDir(recDir);
    ensurePrivateDir(path.join(recDir, 'frames'));

    const port = await (deps.detectPort ?? detectCdpPort)();
    const socketPath = recorderSocketPath(recDir);
    const spawnRecorderBridge = deps.spawnRecorderBridge ?? startRecorderBridge;
    const { pid } = await spawnRecorderBridge(socketPath, port, opts.targetId, recDir);

    let markers: RecorderClockBaselines;
    try {
      const startResp = await requestRecStart(socketPath);
      markers = startResp.markers;
    } catch (err) {
      stopBridge(pid, socketPath);
      removeArtifactTree(recDir);
      throw err;
    }

    const recorderJson: RecorderJson = {
      recId,
      pid,
      socketPath,
      targetId: opts.targetId,
      url: readSessionUrl(opts.sessionDir),
      startedAt: new Date().toISOString(),
      state: 'recording',
      markers,
    };
    writeJsonPrivate(recorderJsonPath(recDir), recorderJson);
    setActiveRecId(recId);

    return { recId, recDir, state: 'recording', reapedStale };
  } finally {
    releaseStartLock(opts.sessionDir, lockFd);
  }
}

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

/** Finalizes the session's active composed recording (or an explicit `recId`).
 * Gracefully stops a live recorder over its socket; best-effort finalizes an
 * already-dead one instead of failing. Throws if there is nothing to stop. */
export async function stopComposedRecorder(opts: {
  sessionDir: string;
  recId?: string;
}): Promise<FinalizedRecording> {
  const recId = opts.recId ? validateRecId(opts.sessionDir, opts.recId) : getActiveRecId();
  if (!recId) {
    throw new Error('No active recording on this session. Start one first: `capture motion rec --start`.');
  }
  const recDir = recDirFor(opts.sessionDir, recId);
  const rj = readRecorderJson(recDir);
  if (!rj) {
    throw new Error(`No live-recorder state found for "${recId}" (already finalized, or never started).`);
  }

  if (!isPidAlive(rj.pid)) {
    return finalizeOrphaned(rj, recDir, opts.sessionDir);
  }

  try {
    const stopResp = await requestRecStop(rj.socketPath);
    stopBridge(rj.pid, rj.socketPath);
    return writeFinalizedArtifacts(opts.sessionDir, recDir, recId, rj.url, stopResp.frameCount, stopResp.durationMs, 'finalized', stopResp.markers, stopResp.eventCount);
  } catch {
    // Known-live pid, but the socket round trip failed (wedged/missing
    // bridge) — kill the pid and best-effort finalize from whatever made it
    // to disk, same fallback `teardownAnyLiveRecorderAtSessionStop` uses.
    return finalizeOrphaned(rj, recDir, opts.sessionDir, rj.pid);
  }
}

// ---------------------------------------------------------------------------
// Session-stop teardown
// ---------------------------------------------------------------------------

/**
 * Called by `session stop` before bundle collection: finalizes/tears down
 * EVERY live recorder found on this session, directory-authoritatively —
 * it scans `motion/recs/{recId}/recorder.json` rather than trusting the single
 * global `activeRecId` pointer, because that pointer can be absent (a
 * `recorder.json` left behind with no pointer naming it) or can currently
 * name a *different* session entirely (this caller scope's one active
 * pointer, pointing elsewhere while THIS session still has its own live
 * recorder on disk). Each handle found gets a graceful `rec-stop` if its
 * pid answers, otherwise a best-effort orphaned finalize; reap never
 * resumes a stale one. The pointer is cleared only for handles this
 * session actually owns (`clearActiveRecIdIfOwned`) — a pointer naming
 * some other session is left completely untouched. No-op (returns `null`)
 * if there is nothing on disk to tear down. */
export async function teardownAnyLiveRecorderAtSessionStop(sessionDir: string): Promise<FinalizedRecording | null> {
  const handles = listLiveRecorderHandles(sessionDir);
  const activeHere = activeSessionMatching(sessionDir);

  let primary: FinalizedRecording | null = null;
  for (const { recId, recDir, rj } of handles) {
    let finalized: FinalizedRecording;
    if (!isPidAlive(rj.pid)) {
      finalized = finalizeOrphaned(rj, recDir, sessionDir);
    } else {
      try {
        const stopResp = await requestRecStop(rj.socketPath);
        stopBridge(rj.pid, rj.socketPath);
        finalized = writeFinalizedArtifacts(
          sessionDir,
          recDir,
          recId,
          rj.url,
          stopResp.frameCount,
          stopResp.durationMs,
          'finalized',
          stopResp.markers,
          stopResp.eventCount,
        );
      } catch {
        // The process answered isPidAlive() but the socket round trip itself
        // failed (e.g. mid-teardown race) — fall back to the same best-effort
        // path an already-dead pid takes, rather than leaving the session
        // stuck with a live-looking recorder it can never stop. The pid IS
        // known-live here, so pass it through to be SIGTERM'd — otherwise the
        // bridge process is finalized on disk but never killed and leaks.
        finalized = finalizeOrphaned(rj, recDir, sessionDir, rj.pid);
      }
    }
    if (recId === activeHere?.activeRecId || primary === null) primary = finalized;
  }

  // A dangling pointer for THIS session with no matching on-disk handle left
  // to tear down (already reaped, or the pointer never named a real one).
  if (activeHere?.activeRecId && !handles.some((h) => h.recId === activeHere.activeRecId)) {
    clearActiveRecId();
  }

  return primary;
}
