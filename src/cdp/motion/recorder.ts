import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { ensurePrivateDir, readPrivateFile } from '../../session/artifacts.js';
import { captureError } from '../../errors.js';
import { getActiveRecId, getActiveSession, setActiveRecId, clearActiveRecId, updateSessionState } from '../../session-context.js';
import { admitSessionOperation, withSessionLifecycle } from '../../session/coordinator.js';
import { collectorHostSocketPath, startCollectorHost } from '../bridge/spawn.js';
import { sendHostRequest } from '../host/client.js';
import { scanCollectorHost, type CollectorHostHandle } from '../host/handle.js';
import { stopAndReapCollectorHostAtSessionStop } from '../host/lifecycle.js';

export type RecorderLiveState = 'recording' | 'finalized' | 'orphaned-finalized' | 'partial';
export interface RecordingViewport { width: number; height: number; }
export interface FinalizedRecording {
  recId: string;
  recDir: string;
  frames: number;
  durationMs: number;
  fps: number;
  state: RecorderLiveState;
  viewportRestored: boolean | null;
  viewportRetained: boolean;
  eventCount: number | null;
}
export interface StartRecorderResult { recId: string; recDir: string; state: 'recording'; reapedStale: FinalizedRecording | null; }
export class StartRecorderError extends Error {
  constructor(message: string, readonly viewportRestored: boolean | null = null) { super(message); this.name = 'StartRecorderError'; }
}

export function recDirFor(sessionDir: string, recId: string): string { return path.join(sessionDir, 'motion', 'recs', recId); }

function motionHandle(handle: CollectorHostHandle, recId: string) {
  return handle.collectors.find(collector => collector.id === recId && collector.kind === 'motion') ?? null;
}

function finalFromMeta(recDir: string, recId: string): FinalizedRecording {
  const meta = JSON.parse(readPrivateFile(path.join(recDir, 'meta.json')).toString('utf8')) as Record<string, unknown>;
  const frames = typeof meta.frames === 'number' ? meta.frames : 0;
  const durationMs = typeof meta.durationMs === 'number' ? meta.durationMs : 0;
  return {
    recId,
    recDir,
    frames,
    durationMs,
    fps: durationMs > 0 ? Math.round((frames / (durationMs / 1000)) * 10) / 10 : 0,
    state: meta.state === 'partial' ? 'partial' : meta.completion === 'orphaned' ? 'orphaned-finalized' : 'finalized',
    eventCount: typeof meta.eventCount === 'number' ? meta.eventCount : null,
    viewportRestored: typeof meta.viewportRestored === 'boolean' ? meta.viewportRestored : null,
    viewportRetained: meta.viewportRetained === true,
  };
}

async function liveHost(sessionDir: string): Promise<CollectorHostHandle> {
  const scanned = scanCollectorHost(sessionDir);
  if (scanned.classification !== 'live' || !scanned.handle) throw captureError('precondition', 'recorder_unavailable', `This session has no live collector host (${scanned.classification}).`);
  return scanned.handle;
}

export interface StartRecorderDeps { detectPort?: () => Promise<number>; spawnCollectorHost?: typeof startCollectorHost; }

export async function startComposedRecorder(opts: { sessionDir: string; viewport?: RecordingViewport }, deps: StartRecorderDeps = {}): Promise<StartRecorderResult> {
  const operation = await admitSessionOperation(opts.sessionDir);
  try {
    return await withSessionLifecycle(opts.sessionDir, async () => {
      const session = getActiveSession();
      if (!session || session.dir !== opts.sessionDir) throw new Error('The active capture session is no longer available.');
      if (!session.targetId) throw new Error('The active session has no attached tab to record. Start it with a URL: `capture session start --url <url>`.');
      if (!session.harId) throw new Error('The active session has no live HAR recording id (harId); cannot arm a recorder without its HAR evidence store.');
      const port = session.port ?? await (deps.detectPort?.() ?? Promise.reject(new Error('The active session has no CDP port.')));
      await updateSessionState(opts.sessionDir, { targetId: session.targetId, port });
      let scanned = scanCollectorHost(opts.sessionDir);
      if (scanned.classification === 'unknown' || scanned.classification === 'malformed') throw captureError('precondition', 'recorder_unavailable', `This session's collector host is ${scanned.classification}.`);
      if (scanned.classification === 'dead') {
        const reaped = await stopAndReapCollectorHostAtSessionStop(opts.sessionDir);
        if (reaped.status === 'terminal') throw new Error(reaped.error);
        scanned = scanCollectorHost(opts.sessionDir);
      }
      if (scanned.classification === 'absent') {
        const spawn = deps.spawnCollectorHost ?? startCollectorHost;
        await spawn(collectorHostSocketPath(opts.sessionDir), port, session.targetId, opts.sessionDir);
        scanned = scanCollectorHost(opts.sessionDir);
      }
      if (scanned.classification !== 'live' || !scanned.handle) throw new Error('Collector host did not publish a live handle.');
      if (scanned.handle.targetId !== session.targetId) throw new Error('A collector host is bound to a different session target. Stop the session before changing tabs.');
      if (scanned.handle.collectors.some(collector => collector.kind === 'motion')) throw new Error('A recording is already active on this session. Stop it first: `capture motion rec --stop`.');
      const response = await sendHostRequest(scanned.handle.socketPath, { type: 'collector-start', nonce: scanned.handle.nonce, kind: 'motion', config: { harId: session.harId, viewport: opts.viewport } }, 30_000);
      if (!response.ok || !response.collector || typeof response.collector !== 'object') throw new StartRecorderError(response.error ?? 'collector host refused to start motion recording');
      const collector = response.collector as { id?: unknown; dir?: unknown };
      if (typeof collector.id !== 'string' || typeof collector.dir !== 'string') throw new StartRecorderError('collector host returned a malformed motion collector');
      await setActiveRecId(collector.id);
      return { recId: collector.id, recDir: collector.dir, state: 'recording', reapedStale: null };
    });
  } finally { await operation.release(); }
}

export async function stopComposedRecorder(opts: { sessionDir: string; recId?: string }): Promise<FinalizedRecording> {
  return withSessionLifecycle(opts.sessionDir, async () => {
    const recId = opts.recId ?? getActiveRecId();
    if (!recId) throw new Error('No active recording on this session. Start one first: `capture motion rec --start`.');
    const host = await liveHost(opts.sessionDir);
    const row = motionHandle(host, recId);
    if (!row) throw new Error(`No live motion collector named "${recId}".`);
    const response = await sendHostRequest(host.socketPath, { type: 'collector-stop', nonce: host.nonce, id: recId }, 30_000);
    if (!response.ok) throw new Error(response.error ?? 'collector host refused to stop motion recording');
    if (getActiveSession()?.dir === opts.sessionDir && getActiveRecId() === recId) await clearActiveRecId();
    return finalFromMeta(row.dir, recId);
  });
}

/** Session stop owns host teardown. Kept as the motion-facing explicit call for command code. */
export async function teardownAnyLiveRecorderAtSessionStop(sessionDir: string): Promise<FinalizedRecording | null> {
  const host = scanCollectorHost(sessionDir);
  const motion = host.handle?.collectors.find(collector => collector.kind === 'motion');
  const result = await stopAndReapCollectorHostAtSessionStop(sessionDir);
  if (result.status === 'terminal') throw new Error(result.error);
  if (!motion) return null;
  if (getActiveSession()?.dir === sessionDir && getActiveRecId() === motion.id) await clearActiveRecId();
  return finalFromMeta(motion.dir, motion.id);
}
