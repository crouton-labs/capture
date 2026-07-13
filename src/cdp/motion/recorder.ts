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
  readPrivateFile,
  unlinkPrivateFile,
  removeArtifactTree,
  processPidBirthProvider,
  type PidBirth,
  type PidBirthProvider,
  type RecMeta,
} from '../../session/artifacts.js';
import {
  withSessionLifecycle,
  scanRecorderHandles,
  recorderProcessAlive,
  admitSessionOperation,
  RECORDER_NONCE,
  type LifecycleSeams,
  type ScannedRecorderHandle,
  type RecorderHandleRecord,
} from '../../session/coordinator.js';
import { captureError } from '../../errors.js';
import { startRecorderBridge, recorderSocketPath, stopBridge } from '../bridge/spawn.js';
import { requestRecStart, requestRecStop, RecStopBridgeFailure } from '../recorder-client.js';
import { RECORDER_NONCE_BOOT_FILE } from '../recorder-bridge.js';
import { detectCdpPort } from '../detect.js';
import { findTabByIdAcrossEndpoints } from '../targets.js';
import { CDPClient } from '../client.js';
import { getActiveRecId, setActiveRecId, clearActiveRecId, getActiveSession, updateSessionState, type ActiveSessionState } from '../../session-context.js';

// ---------------------------------------------------------------------------
// recorder.json — the live-recorder handle. NOT part of the finalized
// recording inventory (removed on finalize/reap); this module is the only
// reader/writer of it.
// ---------------------------------------------------------------------------

export type RecorderLiveState = 'recording' | 'finalized' | 'orphaned-finalized' | 'partial';

/** Canonical persisted recorder-handle shape — owned by `session/coordinator.ts`
 * (one authority for the shape and its liveness classification); aliased here
 * for the motion callers and tests. `birth` is REQUIRED: recorder liveness is
 * a pid-birth-identity match, never a bare numeric-pid check. */
export type RecorderJson = RecorderHandleRecord;

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

/** The active-session pointer (`session-context.ts`, scoped per-caller by
 * `CRTR_NODE_ID`) is a SINGLE global pointer, not one per session id — so
 * before trusting/clearing its `activeRecId`, every reap/teardown path here
 * must first confirm that pointer actually names THIS session's dir, not
 * some other concurrently-active session. Returns `null` if it doesn't. */
function activeSessionMatching(sessionDir: string): ActiveSessionState | null {
  const active = getActiveSession();
  return active && active.dir === sessionDir ? active : null;
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

/** Best-effort session url, read directly from `.session.json` rather than
 * threading `session/commands.ts`'s internal `Session` type through here —
 * keeps this module decoupled from that file (which itself calls INTO this
 * module at session-stop time; an import back the other way would cycle).
 * This remains verbatim because session URLs are browser evidence. */
function readSessionUrl(sessionDir: string): string | null {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(sessionDir, '.session.json'), 'utf-8')) as { url?: string | null };
    const url = meta.url ?? null;
    return url === null ? null : url;
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
  /** Whether a viewport override owned by this recording was restored. */
  viewportRestored: boolean | null;
  /** Total events.jsonl record count observed at graceful `rec-stop` time;
   * `null` when the recorder was orphaned/best-effort finalized (no live socket to ask). */
  eventCount: number | null;
}

/** Clears the (single, global, per-caller-scoped) `activeRecId` pointer
 * ONLY if it currently names this exact `(sessionDir, recId)` — i.e. only
 * when the pointer is actually OURS to clear. A teardown/reap running
 * against session A must never blow away session B's pointer just because
 * B happens to be the currently-active one for this caller scope. */
async function clearActiveRecIdIfOwned(sessionDir: string, recId: string): Promise<void> {
  const active = getActiveSession();
  if (active && active.dir === sessionDir && active.activeRecId === recId) {
    await clearActiveRecId();
  }
}

const VIEWPORT_STATE_FILE = 'viewport-override.json';

let viewportDeps = {
  findTarget: findTabByIdAcrossEndpoints,
  createClient: (url: string) => new CDPClient(url),
};

/** Focused lifecycle tests inject the target/CDP boundary; production always
 * uses the normal target resolver and client. */
export function __setViewportLifecycleDepsForTest(overrides: Partial<typeof viewportDeps>): () => void {
  const previous = viewportDeps;
  viewportDeps = { ...viewportDeps, ...overrides };
  return () => { viewportDeps = previous; };
}

/** Persist the lifecycle-owned restoration obligation only after the recorder
 * is live, so every finalization route (stop, reap, session-stop) sees it. */
export function recordViewportOverride(recDir: string): void {
  writeJsonPrivate(path.join(recDir, VIEWPORT_STATE_FILE), { phase: 'applied' });
}

export interface RecordingViewport {
  width: number;
  height: number;
}

async function applyViewportOverride(recDir: string, targetId: string, viewport: RecordingViewport | undefined): Promise<boolean> {
  if (!viewport) return false;
  const tab = await viewportDeps.findTarget(targetId);
  if (!tab?.tab.webSocketDebuggerUrl) throw new Error('recording target is unavailable');
  const client = viewportDeps.createClient(tab.tab.webSocketDebuggerUrl);
  try {
    await client.waitReady();
    // From this write onward the set request may reach Chrome even if its
    // response is lost, so teardown owns a compensating clear.
    writeJsonPrivate(path.join(recDir, VIEWPORT_STATE_FILE), { phase: 'attempting', targetId });
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    writeJsonPrivate(path.join(recDir, VIEWPORT_STATE_FILE), { phase: 'applied', targetId });
    return true;
  } finally {
    client.close();
  }
}

interface ViewportOverrideState {
  phase?: unknown;
  applied?: unknown;
  targetId?: unknown;
}

function readViewportOverrideState(statePath: string): ViewportOverrideState | null {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8')) as ViewportOverrideState;
  } catch {
    return null;
  }
}

async function restoreViewportOverride(recDir: string, targetId: string): Promise<boolean | null> {
  const statePath = path.join(recDir, VIEWPORT_STATE_FILE);
  if (!fs.existsSync(statePath)) return null;
  const state = readViewportOverrideState(statePath);
  // Only an in-flight or acknowledged set can have mutated Chrome. A
  // prepared obligation is discarded rather than clearing another owner.
  const mayHaveApplied = state?.phase === 'attempting' || state?.phase === 'applied' || state?.applied === true;
  if (!mayHaveApplied) {
    removeArtifactTree(statePath);
    return null;
  }
  try {
    const tab = await viewportDeps.findTarget(targetId);
    if (!tab?.tab.webSocketDebuggerUrl) throw new Error('recording target is unavailable');
    const client = viewportDeps.createClient(tab.tab.webSocketDebuggerUrl);
    try {
      await client.waitReady();
      await client.send('Emulation.clearDeviceMetricsOverride');
    } finally {
      client.close();
    }
    removeArtifactTree(statePath);
    return true;
  } catch {
    // Preserve the state file as the factual failed-restoration evidence.
    return false;
  }
}

export class StartRecorderError extends Error {
  constructor(message: string, readonly viewportRestored: boolean | null) {
    super(message);
    this.name = 'StartRecorderError';
  }
}

async function writeFinalizedArtifacts(
  sessionDir: string,
  recDir: string,
  recId: string,
  url: string | null,
  frames: number,
  durationMs: number,
  state: RecorderLiveState,
  markers: unknown,
  eventCount: number | null,
  targetId: string,
): Promise<FinalizedRecording> {
  const fps = durationMs > 0 ? round1(frames / (durationMs / 1000)) : 0;
  const viewportRestored = await restoreViewportOverride(recDir, targetId);
  writeJsonPrivate(markersPath(recDir), markers);
  const meta: RecMeta & { url: string | null; fps: number; eventCount: number | null; viewportRestored: boolean | null } = {
    id: recId,
    action: null,
    frames,
    durationMs,
    state,
    url,
    fps,
    eventCount,
    viewportRestored,
  };
  writeJsonPrivate(metaPath(recDir), meta);
  removeArtifactTree(recorderJsonPath(recDir));
  await clearActiveRecIdIfOwned(sessionDir, recId);
  return { recId, recDir, frames, durationMs, fps, state, eventCount, viewportRestored };
}

/** Every SIGTERM this module ever sends goes through here: re-reads the
 * process's birth identity immediately before signaling and only signals when
 * it still matches the recorded identity. A recycled/foreign pid gets NO
 * signal — the socket file is cleaned up either way. */
function killIfIdentityMatches(record: Pick<RecorderHandleRecord, 'pid' | 'socketPath' | 'birth'>, provider: PidBirthProvider): void {
  if (recorderProcessAlive(record, provider)) stopBridge(record.pid, record.socketPath);
  else stopBridge(null, record.socketPath); // gone/foreign/mismatch: clean socket only, NEVER SIGTERM
}

/** After a successful authenticated `rec-stop`, the bridge process exits
 * itself once its response has flushed. The graceful stop paths wait for that
 * VERIFIED exit (birth-identity check — an absent or recycled/foreign pid
 * counts as gone and is never signaled) instead of racing it with an
 * immediate SIGTERM; only a timeout with a STILL-MATCHING identity escalates
 * to the identity-checked kill. Socket-file hygiene happens either way. */
async function waitForRecorderExit(
  record: Pick<RecorderHandleRecord, 'pid' | 'socketPath' | 'birth'>,
  provider: PidBirthProvider,
  deps: LifecycleSeams,
): Promise<void> {
  const timeoutMs = deps.stopExitTimeoutMs ?? 2000;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!recorderProcessAlive(record, provider)) {
      stopBridge(null, record.socketPath); // gone or identity mismatch: clean socket only, NEVER signal
      return;
    }
    if (Date.now() >= deadline) {
      killIfIdentityMatches(record, provider); // still the same process after the grace window: escalate
      return;
    }
    await sleep(25);
  }
}

/**
 * Shared tail for a TERMINAL `rec-stop` failure — the bridge authenticated
 * the request and explicitly answered `ok:false` (`RecStopBridgeFailure`,
 * e.g. a fatal HAR drain: sink/store rejection or assembly/validation
 * failure), as opposed to a wedged/unreachable bridge. That fatal bridge
 * self-exits non-zero once its response has flushed (see
 * `../recorder-bridge.ts`'s terminal rec-stop latch), so waiting through the
 * SAME identity-verified `waitForRecorderExit` the success path uses
 * resolves rather than timing out — there is no wedged process to escalate
 * against. This path takes NO identity-kill first resort and produces NO
 * orphan-finalize success: it always re-throws the primary bridge failure,
 * never a finalized recording. `waitForRecorderExit` itself does not throw
 * in its ordinary outcomes (gone/mismatched identity resolves normally; a
 * still-matching identity after timeout escalates to a kill and still
 * resolves) — if it somehow does throw, that fact is folded in alongside the
 * primary error via `AggregateError` (same precedent as
 * `../../session/artifacts.ts`'s `combineFailure`) rather than masking the
 * primary with a generic fallback.
 */
async function propagateTerminalRecStopFailure(
  record: Pick<RecorderHandleRecord, 'pid' | 'socketPath' | 'birth'>,
  provider: PidBirthProvider,
  deps: LifecycleSeams,
  primary: RecStopBridgeFailure,
): Promise<never> {
  try {
    await waitForRecorderExit(record, provider, deps);
  } catch (cleanupErr) {
    throw new AggregateError([primary, cleanupErr], primary.message);
  }
  throw primary;
}

/**
 * True for the designated fatal teardown error `../../session/commands.ts`'s
 * `session stop` must let escape its warn-and-continue recorder-teardown
 * catch and route to the outer `stop_failed` lane instead — a terminal
 * `rec-stop` failure thrown by `propagateTerminalRecStopFailure` above,
 * whether that's the bare `RecStopBridgeFailure` or one wrapped alongside a
 * cleanup fact in an `AggregateError`. Any OTHER teardown failure (dead-handle
 * noise, liveness-unknown, a malformed handle) keeps the existing
 * warn-and-continue policy — only an authenticated, explicit bridge refusal
 * is fatal to the whole session stop.
 */
export function isTerminalRecStopFailure(err: unknown): boolean {
  if (err instanceof RecStopBridgeFailure) return true;
  return err instanceof AggregateError && err.errors.some((e) => e instanceof RecStopBridgeFailure);
}

/** Reads, validates, and CONSUMES the nonce boot file the recorder bridge
 * wrote into `recDir` before binding its socket (see `recorder-bridge.ts`'s
 * `RECORDER_NONCE_BOOT_FILE`). The nonce is persisted into `recorder.json`
 * by the caller — one persistent authority — so the boot file is deleted here
 * as soon as it is read. Throws factually on a missing/malformed file: there
 * is no unauthenticated fallback lane. */
function consumeRecorderNonceBootFile(recDir: string): string {
  const bootPath = path.join(recDir, RECORDER_NONCE_BOOT_FILE);
  let nonce: unknown;
  try {
    nonce = (JSON.parse(readPrivateFile(bootPath).toString('utf-8')) as { nonce?: unknown }).nonce;
  } catch (err) {
    throw new Error(`Recorder bridge did not hand back a control nonce (${err instanceof Error ? err.message : String(err)}).`);
  }
  if (typeof nonce !== 'string' || !RECORDER_NONCE.test(nonce)) {
    throw new Error('Recorder bridge handed back a malformed control nonce.');
  }
  unlinkPrivateFile(bootPath);
  return nonce;
}

/** Best-effort finalize when the recorder process is dead, or known-alive but
 * unresponsive on its socket: counts whatever `frames/`/lack thereof already
 * made it to disk, computes duration from `recorder.json`'s own `startedAt`,
 * and reuses whichever baseline triple `rec-start` last persisted (it cannot
 * get a fresher one — nothing is listening on the socket anymore).
 *
 * `attemptKill` lets a caller that classified the handle live (but whose
 * socket round trip failed — a wedged bridge) still stop the process, via an
 * identity-verified kill. Callers finalizing an already-dead handle pass
 * `false`: the socket file is cleaned up, nothing is ever signaled. */
async function finalizeOrphaned(record: RecorderHandleRecord, recDir: string, sessionDir: string, provider: PidBirthProvider, attemptKill: boolean): Promise<FinalizedRecording> {
  const frames = countFrames(recDir);
  const durationMs = Math.max(0, Date.now() - Date.parse(record.startedAt));
  if (attemptKill) killIfIdentityMatches(record, provider);
  else stopBridge(null, record.socketPath); // dead handle: clean socket, never signal
  return writeFinalizedArtifacts(sessionDir, recDir, record.recId, record.url, frames, durationMs, 'orphaned-finalized', record.markers, null, record.targetId);
}

// ---------------------------------------------------------------------------
// Dead-handle reap — a `recorder.json` whose birth-identity no longer matches
// a live process. Called (under the lifecycle lock) at the top of
// `startComposedRecorder` — never resume, always reap-then-proceed.
// ---------------------------------------------------------------------------

/** Orphan-finalizes every `dead`-classified handle in `scan` (motion
 * consequence: meta/markers/viewport restore — reset does none of this; it
 * only calls coordinator's neutral `clearDanglingRecorderPointer` and leaves
 * dead handles intact for this finalizer to reap on the next start/stop).
 * Clears a dangling `activeRecId` pointer owned by this session. Returns the
 * handle the pointer named if it was reaped, else the first one reaped, else `null`. */
async function reapDeadHandles(sessionDir: string, scan: ScannedRecorderHandle[], provider: PidBirthProvider): Promise<FinalizedRecording | null> {
  const active = activeSessionMatching(sessionDir);
  let primary: FinalizedRecording | null = null;
  for (const h of scan) {
    if (h.classification !== 'dead') continue;
    const finalized = await finalizeOrphaned(h.record!, h.recDir, sessionDir, provider, false);
    if (h.recId === active?.activeRecId || primary === null) primary = finalized;
  }
  if (active?.activeRecId && !scan.some(h => h.recId === active.activeRecId)) await clearActiveRecId();
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
export interface StartRecorderDeps extends LifecycleSeams {
  detectPort?: () => Promise<number>;
  spawnRecorderBridge?: typeof startRecorderBridge;
}

export async function startComposedRecorder(
  opts: {
    sessionDir: string;
    viewport?: RecordingViewport;
  },
  deps: StartRecorderDeps = {},
): Promise<StartRecorderResult> {
  // Admission into the session's operation coordinator comes FIRST — before
  // the lifecycle lock and before any session-bound effect. A `session stop`
  // that has already marked `.operations.json` stopping rejects this start
  // with zero side effects; a start admitted first holds its token until the
  // recorder handle is atomically published (or the start fully rolled back),
  // so a concurrent stop's drain barrier cannot finalize the bundle around a
  // half-armed recorder. Deadlock-free ordering: stop drains tokens BEFORE
  // taking `.lifecycle.lock`, while this start holds its token WHILE waiting
  // on that lock — the two never wait on each other in a cycle.
  const operation = await admitSessionOperation(opts.sessionDir);
  try {
    return await startComposedRecorderAdmitted(opts, deps);
  } finally {
    await operation.release();
  }
}

async function startComposedRecorderAdmitted(
  opts: {
    sessionDir: string;
    viewport?: RecordingViewport;
  },
  deps: StartRecorderDeps = {},
): Promise<StartRecorderResult> {
  // The lifecycle lock covers the scan, dead-handle reap, endpoint
  // resolution, viewport mutation, and bridge startup. A rejected start
  // therefore cannot touch a live recording's viewport, a stale reap
  // completes before a new override, and the recording target is the one
  // the session names UNDER the lock — never a stale pre-lock snapshot.
  return withSessionLifecycle(opts.sessionDir, async () => {
    const provider = deps.pidBirthProvider ?? processPidBirthProvider;
    const scan = scanRecorderHandles(opts.sessionDir, deps);
    if (scan.some(h => h.classification === 'unknown')) throw captureError('world', 'recorder_liveness_unknown', 'Cannot determine recorder liveness; refusing to start.');
    if (scan.some(h => h.classification === 'malformed')) throw captureError('precondition', 'recorder_unavailable', 'A malformed recorder handle exists on this session; resolve it before starting.');
    if (scan.some(h => h.classification === 'live')) throw new Error('A recording is already active on this session. Stop it first: `capture motion rec --stop`.');
    const reapedStale = await reapDeadHandles(opts.sessionDir, scan, provider);
    const session = getActiveSession();
    if (!session || session.dir !== opts.sessionDir) throw new Error('The active capture session is no longer available.');
    if (!session.targetId) throw new Error('The active session has no attached tab to record. Start it with a URL: `capture session start --url <url>`.');
    const targetId = session.targetId;
    // The owning session's live HAR store — REQUIRED: a session-backed
    // recorder always has one (session start creates it), and the recorder
    // bridge streams its network evidence there. No fallback lane.
    const harId = session.harId;
    if (typeof harId !== 'string' || harId.length === 0) {
      throw new Error('The active session has no live HAR recording id (harId); cannot arm a recorder without its HAR evidence store.');
    }
    const port = session.port ?? await (deps.detectPort ?? detectCdpPort)();
    await updateSessionState(opts.sessionDir, { targetId, port });

    const recId = `rec-${crypto.randomBytes(2).toString('hex')}`;
    const recDir = recDirFor(opts.sessionDir, recId);
    ensurePrivateDir(recDir);
    ensurePrivateDir(path.join(recDir, 'frames'));
    let viewportAttempted = false;
    let socketPath: string | null = null;
    let established: { pid: number; socketPath: string; birth: PidBirth } | null = null;
    try {
      viewportAttempted = await applyViewportOverride(recDir, targetId, opts.viewport);
      socketPath = recorderSocketPath(recDir);
      const spawnRecorderBridge = deps.spawnRecorderBridge ?? startRecorderBridge;
      const { pid } = await spawnRecorderBridge(socketPath, port, targetId, recDir, harId);
      const born = provider.read(pid);
      if (born.status !== 'found') {
        // Identity unestablished — never signal a pid we cannot prove is ours.
        stopBridge(null, socketPath);
        throw new Error(`Could not establish recorder process identity (${born.status === 'unknown' ? born.reason : 'process absent'}).`);
      }
      established = { pid, socketPath, birth: born.identity };
      // The bridge wrote its server-generated nonce into recDir before binding
      // the socket; spawn's readiness poll guarantees it exists here. Read,
      // validate, and consume it — recorder.json below becomes the one
      // persistent authority for it.
      const nonce = consumeRecorderNonceBootFile(recDir);
      const startResp = await requestRecStart(socketPath, nonce);

      const recorderJson: RecorderJson = {
        recId,
        pid,
        socketPath,
        targetId,
        url: readSessionUrl(opts.sessionDir),
        startedAt: new Date().toISOString(),
        state: 'recording',
        birth: born.identity,
        markers: startResp.markers,
        nonce,
      };
      writeJsonPrivate(recorderJsonPath(recDir), recorderJson);
      await setActiveRecId(recId);
      return { recId, recDir, state: 'recording' as const, reapedStale };
    } catch (err) {
      if (established) killIfIdentityMatches(established, provider);
      else if (socketPath) stopBridge(null, socketPath);
      const restored = viewportAttempted || fs.existsSync(path.join(recDir, VIEWPORT_STATE_FILE))
        ? await restoreViewportOverride(recDir, targetId)
        : null;
      // A failed restoration is a live lifecycle obligation, not disposable
      // partial output. Leave it for the next session teardown to retry.
      if (restored !== false) removeArtifactTree(recDir);
      throw err instanceof StartRecorderError ? err : new StartRecorderError(err instanceof Error ? err.message : String(err), restored);
    }
  }, deps);
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
}, deps: LifecycleSeams = {}): Promise<FinalizedRecording> {
  // validateRecId throws BEFORE the lock — a traversal-shaped --rec-id is an
  // invocation defect, not a lifecycle transition; it never touches the lock.
  const recId = opts.recId ? validateRecId(opts.sessionDir, opts.recId) : getActiveRecId();
  if (!recId) {
    throw new Error('No active recording on this session. Start one first: `capture motion rec --start`.');
  }
  return withSessionLifecycle(opts.sessionDir, async () => {
    const provider = deps.pidBirthProvider ?? processPidBirthProvider;
    const handle = scanRecorderHandles(opts.sessionDir, deps).find(h => h.recId === recId);
    if (!handle) {
      throw new Error(`No live-recorder state found for "${recId}" (already finalized, or never started).`);
    }
    if (handle.classification === 'unknown') throw captureError('world', 'recorder_liveness_unknown', 'Cannot determine recorder liveness; refusing to stop.');
    if (handle.classification === 'malformed') throw captureError('precondition', 'recorder_unavailable', `The recorder handle for "${recId}" is malformed.`);
    const record = handle.record!;
    if (handle.classification === 'dead') {
      return await finalizeOrphaned(record, handle.recDir, opts.sessionDir, provider, false);
    }
    try {
      const stopResp = await requestRecStop(record.socketPath, record.nonce);
      // The bridge self-exits once its authenticated rec-stop response has
      // flushed — wait for that verified exit; escalate to an identity-checked
      // SIGTERM only if the same process is still alive after the grace window.
      await waitForRecorderExit(record, provider, deps);
      return await writeFinalizedArtifacts(opts.sessionDir, handle.recDir, recId, record.url, stopResp.frameCount, stopResp.durationMs, 'finalized', stopResp.markers, stopResp.eventCount, record.targetId);
    } catch (err) {
      if (err instanceof RecStopBridgeFailure) {
        // The bridge authenticated the request and explicitly refused — a
        // terminal recorder failure, NOT a wedged bridge. No identity-kill,
        // no orphan-finalize success: propagate the primary error.
        await propagateTerminalRecStopFailure(record, provider, deps, err);
      }
      // Known-live handle, but the socket round trip failed (wedged/missing
      // bridge) — identity-verified kill and best-effort finalize from
      // whatever made it to disk, same fallback teardown uses.
      return await finalizeOrphaned(record, handle.recDir, opts.sessionDir, provider, true);
    }
  }, deps);
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
 * some other session is left completely untouched. Returns the finalized
 * recording, if any, plus every pending failed-start viewport retry outcome. */
export interface PendingViewportRestoration {
  recId: string;
  viewportRestored: boolean | null;
}

async function restorePendingStartViewportOverrides(sessionDir: string): Promise<PendingViewportRestoration[]> {
  const recsRoot = recsRootFor(sessionDir);
  if (!fs.existsSync(recsRoot)) return [];
  const outcomes: PendingViewportRestoration[] = [];
  for (const entry of fs.readdirSync(recsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const recDir = path.join(recsRoot, entry.name);
    if (readRecorderJson(recDir)) continue;
    const statePath = path.join(recDir, VIEWPORT_STATE_FILE);
    if (!fs.existsSync(statePath)) continue;
    const state = readViewportOverrideState(statePath);
    const targetId = typeof state?.targetId === 'string' ? state.targetId : null;
    const viewportRestored = targetId ? await restoreViewportOverride(recDir, targetId) : null;
    outcomes.push({ recId: entry.name, viewportRestored });
  }
  return outcomes;
}

export type SessionRecorderTeardown = (FinalizedRecording & {
  pendingViewportRestorations: PendingViewportRestoration[];
}) | {
  recording: null;
  pendingViewportRestorations: PendingViewportRestoration[];
} | null;

export async function teardownAnyLiveRecorderAtSessionStop(sessionDir: string, deps: LifecycleSeams = {}): Promise<SessionRecorderTeardown> {
  return withSessionLifecycle(sessionDir, async () => {
    const provider = deps.pidBirthProvider ?? processPidBirthProvider;
    const scan = scanRecorderHandles(sessionDir, deps);
    const activeHere = activeSessionMatching(sessionDir);

    let primary: FinalizedRecording | null = null;
    for (const h of scan) {
      if (h.classification === 'unknown') throw captureError('world', 'recorder_liveness_unknown', 'Cannot determine recorder liveness during session stop.');
      if (h.classification === 'malformed') continue; // no readable handle to finalize; leave the dir as-is
      const record = h.record!;
      let finalized: FinalizedRecording;
      if (h.classification === 'dead') {
        finalized = await finalizeOrphaned(record, h.recDir, sessionDir, provider, false);
      } else {
        try {
          const stopResp = await requestRecStop(record.socketPath, record.nonce);
          // Same verified-exit wait as stopComposedRecorder's graceful path —
          // never race the bridge's own post-response self-exit with a signal.
          await waitForRecorderExit(record, provider, deps);
          finalized = await writeFinalizedArtifacts(
            sessionDir,
            h.recDir,
            record.recId,
            record.url,
            stopResp.frameCount,
            stopResp.durationMs,
            'finalized',
            stopResp.markers,
            stopResp.eventCount,
            record.targetId,
          );
        } catch (err) {
          if (err instanceof RecStopBridgeFailure) {
            // Terminal recorder-stop failure during whole-session teardown —
            // the bridge authenticated the request and explicitly refused
            // (e.g. fatal HAR drain). This must escape the caller's
            // warn-and-continue teardown catch (`../../session/commands.ts`)
            // and reach the outer `stop_failed` lane: no bundle commit, no
            // live-HAR deletion, no handle deletion-as-finalized. Propagate
            // rather than falling into the dead-handle fallback below.
            await propagateTerminalRecStopFailure(record, provider, deps, err);
          }
          // The handle classified live but the socket round trip itself
          // failed (e.g. mid-teardown race) — identity-verified kill plus the
          // same best-effort path a dead handle takes, rather than leaving
          // the session stuck with a live-looking recorder it can never stop.
          finalized = await finalizeOrphaned(record, h.recDir, sessionDir, provider, true);
        }
      }
      if (record.recId === activeHere?.activeRecId || primary === null) primary = finalized;
    }

    // A dangling pointer for THIS session with no matching on-disk handle left
    // to tear down (already reaped, or the pointer never named a real one).
    if (activeHere?.activeRecId && !scan.some((h) => h.recId === activeHere.activeRecId)) {
      await clearActiveRecId();
    }

    const pendingViewportRestorations = await restorePendingStartViewportOverrides(sessionDir);
    if (primary) return { ...primary, pendingViewportRestorations };
    if (pendingViewportRestorations.length) return { recording: null, pendingViewportRestorations };
    return null;
  }, deps);
}
