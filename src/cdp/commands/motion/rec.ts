import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import { type ParsedArgs } from '../../types.js';
import { CDPClient } from '../../client.js';
import { findTabById, openTab } from '../../targets.js';
import { detectCdpPort } from '../../detect.js';
import { RecorderSession } from '../../recorder-bridge.js';
import { parseViewport, type Viewport } from '../../viewport.js';
import {
  emitResult,
  fact,
  formatArtifactList,
  type ArtifactEntry,
  type RenderableResult,
} from '../../../output/render.js';
import { getActiveSession } from '../../../session-context.js';
import { createOneshotSession } from '../../../session/commands.js';
import { ensurePrivateDir, writeBinaryPrivate, writeJsonPrivate, writeNdjsonPrivate, type RecMeta } from '../../../session/artifacts.js';
import {
  startComposedRecorder,
  stopComposedRecorder,
  StartRecorderError,
  type StartRecorderResult,
  type FinalizedRecording,
} from '../../motion/recorder.js';
import {
  resolveLiveTarget,
  scrollResolved,
  type LiveClient,
  type ResolvedTarget,
  type ResolutionFailure,
} from '../../../interact.js';

interface RecCommandDeps {
  detectCdpPort: typeof detectCdpPort;
  openTab: typeof openTab;
  findTabById: typeof findTabById;
  createClient: (webSocketDebuggerUrl: string) => CDPClient;
  createRecorderSession: (opts: { client: CDPClient; recDir: string }) => RecorderSession;
  createOneshotSession: typeof createOneshotSession;
  getActiveSession: typeof getActiveSession;
  startComposedRecorder: typeof startComposedRecorder;
  stopComposedRecorder: typeof stopComposedRecorder;
  encodeVideo: typeof encodeVideoIfAvailable;
}

let deps: RecCommandDeps = {
  detectCdpPort,
  openTab,
  findTabById,
  createClient: (webSocketDebuggerUrl) => new CDPClient(webSocketDebuggerUrl),
  createRecorderSession: (opts) => new RecorderSession(opts),
  createOneshotSession,
  getActiveSession,
  startComposedRecorder,
  stopComposedRecorder,
  encodeVideo: encodeVideoIfAvailable,
};

export function __setMotionRecDepsForTest(overrides: Partial<RecCommandDeps>): () => void {
  const previous = deps;
  deps = { ...deps, ...overrides };
  return () => { deps = previous; };
}

const USAGE = `capture motion rec — record the page over time: composed (whatever the active session does between --start and --stop) or one-shot (one scripted action on a URL or the active session tab).

input:
  [url] --do <action>       one-shot: open <url> (or record the active session tab when <url> is omitted), record one action, finalize
    action                  click:<target> | scroll:<target>,to=<top|bottom|px>
    target                  css selector (bare string) | ax:<name> (case-insensitive substring) | axid:<id> | backend:<id>
                            must resolve to exactly one live element; text: is not accepted by driving actions
    --duration <seconds>    keep recording after the action (default: 0)
    --viewport <WxH>        emulate a viewport for the recording window (restored after); exact <positive-safe-int>x<positive-safe-int> grammar with lowercase x and no whitespace
  --start                   arm the composed recorder on the active session tab (requires \`capture session start\`)
    --viewport <WxH>        as above; restored on --stop
  --stop                    finalize the composed recording
    --rec-id <id>           explicit recording id (default: the session's active recording)

output:
  <recording> block — frames, fps, duration, state, event-records, video status, artifact list; --json mirrors.

effects:
  One-shot on a URL opens a new tab and writes a private one-shot artifact dir; with <url> omitted it records the active session tab and writes under the session. Composed writes under the active session. Scripted actions dispatch real input, marked as labeled landmarks in events.jsonl. Video encodes via ffmpeg when available.`;

export async function cmdMotionRec(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }

  const lifecycleError = validateLifecycleInputs(parsed);
  if (lifecycleError) return emitCommandError(parsed, lifecycleError.status, lifecycleError.message);

  let viewport: Viewport | undefined;
  if (parsed.viewport !== undefined) {
    try {
      viewport = parseViewport(parsed.viewport);
    } catch (error) {
      return emitCommandError(parsed, 'invalid_viewport', error instanceof Error ? error.message : String(error));
    }
  }

  if (parsed.start) return handleStart(parsed, viewport);
  if (parsed.stop) return handleStop(parsed);
  return handleOneShot(parsed, viewport);
}

async function handleOneShot(parsed: ParsedArgs, viewport: Viewport | undefined): Promise<void> {
  const url = parsed.positional[0];
  const active = deps.getActiveSession();
  if (!parsed.do || parsed.positional.length > 1 || (!url && !active)) {
    return emitCommandError(parsed, 'invalid_oneshot', 'One-shot recording requires a URL (or an active session tab) and `--do <action>`.');
  }
  if (!active?.targetId && !url) {
    return emitCommandError(parsed, 'no_session_target', 'Active capture session has no target tab to record.');
  }
  if (!Number.isFinite(parsed.duration ?? 0) || (parsed.duration ?? 0) < 0) {
    return emitCommandError(parsed, 'invalid_duration', '`--duration` must be a non-negative number of seconds.');
  }

  let parsedUrl: URL | undefined;
  if (url) {
    try {
      parsedUrl = new URL(url);
    } catch {
      return emitCommandError(parsed, 'invalid_url', `Invalid recording URL: ${url}`);
    }
  }

  const oneshot = active ? undefined : deps.createOneshotSession('motion');
  const destination = active ? path.join(active.dir, 'motion', 'recs') : oneshot!.artifactsDir;
  const recId = `rec-${crypto.randomBytes(2).toString('hex')}`;
  const recDir = path.join(destination, recId);
  ensurePrivateDir(recDir);
  ensurePrivateDir(path.join(recDir, 'frames'));

  let client: CDPClient | undefined;
  let viewportMayHaveApplied = false;
  let failure: string | null = null;
  let failureStatus = 'oneshot_failed';
  try {
    const port = parsed.port ?? await deps.detectCdpPort();
    // The shared parser fills the active session's targetId into parsed.target,
    // but this leaf needs the target's live websocket and URL rather than a
    // URL-pattern lookup. An explicit positional URL retains one-shot's
    // existing new-tab behavior; omission means "the active session tab".
    const tab = parsedUrl
      ? await deps.openTab(port, parsedUrl.toString())
      : await deps.findTabById(port, active!.targetId!);
    if (!tab) throw new Error(`Active session target ${active!.targetId} is no longer available.`);
    if (!tab.webSocketDebuggerUrl) throw new Error('Recording target has no WebSocket debugger URL.');
    client = deps.createClient(tab.webSocketDebuggerUrl);
    await client.waitReady();
    await client.send('Page.enable');
    viewportMayHaveApplied = viewport !== undefined;
    await applyViewportOverride(client, viewport);
    await waitForPageReady(client);

    const recorder = deps.createRecorderSession({ client, recDir });
    await recorder.start();
    await driveOneShotAction(recorder, parsed.do);
    if (parsed.duration) await sleep(parsed.duration);
    const stopped = await recorder.stop();
    let viewportRestored: boolean | null = null;
    if (viewportMayHaveApplied) {
      viewportRestored = await restoreSessionViewportForClient(client);
      viewportMayHaveApplied = false;
    }
    const finalized = finalizeOneShotRecording(recDir, recId, parsedUrl?.toString() ?? tab.url, parsed.do, stopped, deps.encodeVideo, viewportRestored);
    emitFinalizedResult(parsed, finalized);
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
    if (err instanceof DoActionError) failureStatus = err.status;
  } finally {
    let restored: boolean | null = null;
    if (client && viewportMayHaveApplied) restored = await restoreSessionViewportForClient(client);
    client?.close();
    if (failure !== null) {
      // A failed action is not a completed measurement. Keep the private partial
      // artifact for inspection, but never invent a finalized meta.json.
      emitCommandError(parsed, failureStatus, failure, restored === null ? undefined : { 'viewport-restored': restored });
    }
  }
}

/** A one-shot `--do` failure carrying a precise status for the `<error>` block. */
export class DoActionError extends Error {
  constructor(message: string, readonly status: string) {
    super(message);
  }
}

type DoAction =
  | { verb: 'click'; target: string }
  | { verb: 'scroll'; target: string; to: string };

/** Parses the deliberately narrow one-shot action grammar; targets use the
 * unified driving-verb target grammar (no `text:`). */
function parseDoAction(action: string): DoAction {
  if (action.startsWith('click:')) {
    const target = action.slice('click:'.length);
    if (!target) throw new DoActionError('Invalid --do action: click requires a target — a css selector, ax:<name>, axid:<id>, or backend:<id>.', 'invalid_do_action');
    return { verb: 'click', target };
  }
  if (action.startsWith('scroll:')) {
    const spec = action.slice('scroll:'.length);
    const comma = spec.lastIndexOf(',to=');
    if (comma <= 0) throw new DoActionError('Invalid --do action: scroll requires `scroll:<target>,to=<top|bottom|px>`.', 'invalid_do_action');
    return { verb: 'scroll', target: spec.slice(0, comma), to: spec.slice(comma + ',to='.length) };
  }
  throw new DoActionError('Unsupported --do action. Supported actions: click:<target>; scroll:<target>,to=<top|bottom|px> — target is a css selector, ax:<name>, axid:<id>, or backend:<id>.', 'invalid_do_action');
}

/** Adapts `RecorderSession.handleCdp` onto interact.ts's `LiveClient` so
 * live target resolution and scroll dispatch route through the recorder —
 * `sendMarked` carries the labeled input landmark into `events.jsonl`. */
function recorderLiveClient(recorder: Pick<RecorderSession, 'handleCdp'>): LiveClient {
  return {
    async send(method, params) {
      return (await recorder.handleCdp({ method, params: params ?? {} })).result;
    },
    async sendMarked(method, params, mark) {
      return (await recorder.handleCdp({ method, params, mark })).result;
    },
  };
}

function resolutionError(failure: ResolutionFailure): DoActionError {
  if (failure.code === 'unsupported-prefix') {
    return new DoActionError(
      `Unsupported --do target prefix in "${failure.input}": text: is query-leaf-only. Accepted prefixes: bare css selector, ax:<name>, axid:<id>, backend:<id>.`,
      'unsupported_target_prefix',
    );
  }
  if (failure.code === 'no-match') {
    return new DoActionError(`--do target matched no live element: ${failure.input}.`, 'target_resolution_failed');
  }
  const candidates = failure.candidates
    .map((c) => `${c.role ?? 'unknown'} "${c.name ?? ''}" backend:${c.backendNodeId}`)
    .join('; ');
  return new DoActionError(
    `--do target is ambiguous: ${failure.input} matched ${failure.matchCount} live elements. Candidates: ${candidates}. Retry with backend:<id>.`,
    'target_resolution_failed',
  );
}

/** Drives the one-shot action: resolves the target via the unified live
 * grammar (exactly one match), then dispatches through the recorder so the
 * initiating input carries its labeled landmark. */
export async function driveOneShotAction(recorder: Pick<RecorderSession, 'handleCdp'>, action: string): Promise<void> {
  const parsedAction = parseDoAction(action);
  const live = recorderLiveClient(recorder);
  const resolved = await resolveLiveTarget(live, parsedAction.target);
  if (!resolved.ok) throw resolutionError(resolved);
  if (parsedAction.verb === 'click') {
    await clickResolvedMarked(recorder, resolved, action);
    return;
  }
  // Scroll drives through the shared helper so the landmark behavior is
  // identical to `page scroll` (the adapter's sendMarked carries the label).
  await scrollResolved(live, resolved, parsedAction.to, { mark: action });
}

/** Click dispatch with the one-shot's labeled landmark on the initiating
 * press — the same mechanics as interact.ts's `clickResolved` (scroll into
 * view → box model → center press/release), routed through the recorder so
 * the mark lands in `events.jsonl`. */
async function clickResolvedMarked(recorder: Pick<RecorderSession, 'handleCdp'>, resolved: ResolvedTarget, mark: string): Promise<void> {
  const { backendNodeId } = resolved;
  await recorder.handleCdp({ method: 'DOM.scrollIntoViewIfNeeded', params: { backendNodeId } });
  const box = (await recorder.handleCdp({ method: 'DOM.getBoxModel', params: { backendNodeId } })).result as { model?: { content?: number[] } } | undefined;
  const quad = box?.model?.content;
  if (!quad || quad.length < 8) {
    throw new DoActionError(`Resolved target backend:${backendNodeId} has no box model to click.`, 'target_not_clickable');
  }
  const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
  const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
  await recorder.handleCdp({ method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, mark });
  await recorder.handleCdp({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 } });
}

/** Exported for the focused artifact-layout test. This is the one-shot
 * counterpart of U14's composed finalizer: it writes the same finalized
 * inventory and deliberately never creates recorder.json. */
export function finalizeOneShotRecording(
  recDir: string,
  recId: string,
  url: string,
  action: string,
  stopped: { frameCount: number; eventCount: number; durationMs: number; markers: unknown },
  encodeVideo = encodeVideoIfAvailable,
  viewportRestored: boolean | null = null,
): FinalizedRecording & { action: string; video: VideoEncoding } {
  ensureFinalizedInventory(recDir);
  const video = encodeVideo(recDir, stopped.durationMs);
  const fps = stopped.durationMs > 0 ? Math.round((stopped.frameCount / (stopped.durationMs / 1000)) * 10) / 10 : 0;
  const state = stopped.frameCount > 0 ? 'finalized' : 'partial';
  writeJsonPrivate(path.join(recDir, 'markers.json'), stopped.markers);
  const meta: RecMeta & { url: string; fps: number; eventCount: number; video: VideoEncoding; viewportRestored: boolean | null; reason?: 'no_frames' } = {
    id: recId,
    action,
    frames: stopped.frameCount,
    durationMs: stopped.durationMs,
    state,
    ...(state === 'partial' ? { reason: 'no_frames' as const } : {}),
    url,
    fps,
    eventCount: stopped.eventCount,
    video,
    viewportRestored,
  };
  writeJsonPrivate(path.join(recDir, 'meta.json'), meta);
  return { recId, recDir, frames: stopped.frameCount, durationMs: stopped.durationMs, fps, state, eventCount: stopped.eventCount, viewportRestored, action, video };
}

function ensureFinalizedInventory(recDir: string): void {
  ensurePrivateDir(path.join(recDir, 'frames'));
  for (const filename of ['rects.jsonl', 'events.jsonl']) {
    const artifactPath = path.join(recDir, filename);
    if (!fs.existsSync(artifactPath)) writeNdjsonPrivate(artifactPath, []);
  }
}

function validateLifecycleInputs(parsed: ParsedArgs): { status: string; message: string } | null {
  if (parsed.start && parsed.stop) return { status: 'invalid_lifecycle', message: '`--start` and `--stop` cannot be used together.' };
  if (!parsed.stop && parsed.recId) return { status: parsed.start ? 'invalid_lifecycle' : 'invalid_oneshot', message: '`--rec-id` is valid only with `--stop`.' };
  if (parsed.start) {
    if (parsed.positional.length > 0) return { status: 'invalid_lifecycle', message: '`--start` does not accept a positional URL.' };
    if (parsed.do) return { status: 'invalid_lifecycle', message: '`--start` cannot be combined with `--do`.' };
    if (parsed.duration !== undefined) return { status: 'invalid_lifecycle', message: '`--start` cannot be combined with `--duration`.' };
  }
  if (parsed.stop) {
    if (parsed.positional.length > 0) return { status: 'invalid_lifecycle', message: '`--stop` does not accept positional arguments.' };
    if (parsed.do) return { status: 'invalid_lifecycle', message: '`--stop` cannot be combined with `--do`.' };
    if (parsed.duration !== undefined) return { status: 'invalid_lifecycle', message: '`--stop` cannot be combined with `--duration`.' };
    if (parsed.viewport) return { status: 'invalid_lifecycle', message: '`--stop` cannot be combined with `--viewport`; viewport restoration uses the recording started by `--start`.' };
  }
  return null;
}

async function applyViewportOverride(client: Pick<CDPClient, 'send'>, viewport: Viewport | undefined): Promise<boolean> {
  if (!viewport) return false;
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return true;
}

async function restoreSessionViewportForClient(client: Pick<CDPClient, 'send'>): Promise<boolean> {
  try {
    await client.send('Emulation.clearDeviceMetricsOverride');
    return true;
  } catch {
    return false;
  }
}


async function waitForPageReady(client: Pick<CDPClient, 'send'>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastState = 'unknown';
  while (Date.now() < deadline) {
    const response = await client.send('Runtime.evaluate', {
      expression: `(() => ({ readyState: document.readyState, href: location.href }))()`,
      returnByValue: true,
    }) as { exceptionDetails?: unknown; result?: { value?: { readyState?: unknown; href?: unknown } } };
    if (!response.exceptionDetails) {
      const value = response.result?.value;
      const readyState = typeof value?.readyState === 'string' ? value.readyState : 'unknown';
      const href = typeof value?.href === 'string' ? value.href : '';
      lastState = `${readyState} ${href}`.trim();
      if ((readyState === 'interactive' || readyState === 'complete') && href !== 'about:blank') return;
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for page readiness before recording one-shot action (last state: ${lastState}).`);
}

export type VideoEncoding = { status: 'encoded' | 'unavailable' | 'failed'; reason?: string };

/** ffmpeg encode time grows with frame count, so a fixed 30s ceiling spuriously
 * fails long recordings (thousands of frames take minutes to encode). Budget a
 * generous fixed base plus a per-frame allowance, capped by an upper safety bound
 * so a pathological run still cannot hang indefinitely. */
export function encodeTimeoutMs(frameCount: number): number {
  const BASE_MS = 30_000; // fixed startup + probe + muxing overhead
  const PER_FRAME_MS = 60; // per-frame VP9 encode budget (generous for slow hosts)
  const MAX_MS = 15 * 60_000; // 15-minute upper safety bound
  return Math.min(MAX_MS, BASE_MS + Math.max(0, frameCount) * PER_FRAME_MS);
}

/** Distinguishes a timeout kill from a genuine encode failure for precise
 * provenance. Only spawnSync's own timeout — surfaced as an ETIMEDOUT error —
 * establishes a timeout; the accompanying SIGTERM is how spawnSync kills the
 * child on timeout, but a bare SIGTERM with no ETIMEDOUT is an external/self
 * termination, not proof of a timeout, so it is reported as termination rather
 * than falsely as timed-out. This is provenance, not coaching. */
export function classifyEncodeFailure(result: { error?: (Error & { code?: string }) | null; signal?: NodeJS.Signals | null }): string {
  if (result.error && (result.error as { code?: string }).code === 'ETIMEDOUT') return 'ffmpeg_encoding_timed_out';
  if (result.error) return 'ffmpeg_execution_failed';
  if (result.signal === 'SIGTERM') return 'ffmpeg_terminated';
  return 'ffmpeg_encoding_failed';
}

/** Encodes inside a new private directory, then installs through the shared
 * atomic no-follow writer. Frame cadence is measured from the recording's
 * duration rather than assumed from a display refresh rate. */
export function encodeVideoIfAvailable(recDir: string, durationMs: number): VideoEncoding {
  const framesDir = path.join(recDir, 'frames');
  const frames = fs.existsSync(framesDir) ? fs.readdirSync(framesDir).filter((name) => name.endsWith('.png')).sort() : [];
  if (frames.length === 0) return { status: 'unavailable', reason: 'no_frames' };
  if (durationMs <= 0) return { status: 'unavailable', reason: 'recording_duration_unavailable' };
  const probe = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 5_000 });
  if (probe.error || probe.status !== 0 || !String(probe.stdout ?? '').includes('libvpx-vp9')) return { status: 'unavailable', reason: 'ffmpeg_or_vp9_encoder_unavailable' };
  const tempDir = path.join(recDir, `.video-encode-${crypto.randomBytes(8).toString('hex')}`);
  ensurePrivateDir(tempDir);
  const tempOutput = path.join(tempDir, 'video.webm');
  const cadence = String(frames.length / (durationMs / 1000));
  const result = spawnSync('ffmpeg', [
    '-y', '-framerate', cadence, '-pattern_type', 'glob', '-i', path.join(framesDir, '*.png'),
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', tempOutput,
  ], { stdio: 'ignore', timeout: encodeTimeoutMs(frames.length) });
  try {
    if (result.error || result.status !== 0 || !fs.existsSync(tempOutput)) {
      return { status: 'failed', reason: classifyEncodeFailure(result) };
    }
    try {
      writeBinaryPrivate(path.join(recDir, 'video.webm'), fs.readFileSync(tempOutput));
      return { status: 'encoded' };
    } catch {
      return { status: 'failed', reason: 'video_install_failed' };
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleStart(parsed: ParsedArgs, viewport: Viewport | undefined): Promise<void> {
  const session = deps.getActiveSession();
  if (!session) return emitCommandError(parsed, 'no_active_session', 'No active capture session. Start one first: `capture session start --url <url>`.');
  if (!session.targetId) return emitCommandError(parsed, 'no_session_target', 'Active capture session has no target tab to record.');

  let started: StartRecorderResult;
  try {
    started = await deps.startComposedRecorder({
      sessionDir: session.dir,
      targetId: session.targetId,
      ...(parsed.port !== undefined ? { port: parsed.port } : {}),
      viewport,
    });
  } catch (err) {
    const viewportRestored = err instanceof StartRecorderError ? err.viewportRestored : null;
    return emitCommandError(
      parsed,
      'start_failed',
      err instanceof Error ? err.message : String(err),
      viewportRestored === null ? undefined : { 'viewport-restored': viewportRestored },
    );
  }

  const staleViewport = started.reapedStale?.viewportRestored;
  const result: RenderableResult = {
    tag: 'recording',
    attestation: { kind: 'recording', id: started.recId, path: started.recDir },
    attrs: {
      state: 'recording',
      ...(staleViewport !== null && staleViewport !== undefined ? { 'stale-viewport-restored': staleViewport } : {}),
      'timestamp-uncertainty': '±1 frame for frame-derived timestamps',
    },
    summary: fact`Recorder armed on the session tab (screencast + tracing + observers).`,
    sections: started.reapedStale ? [fact`A stale recording (${started.reapedStale.recId}, dead process) was reaped before this one armed.`] : undefined,
  };
  emitResult(result, { json: parsed.json });
}

async function handleStop(parsed: ParsedArgs): Promise<void> {
  const session = deps.getActiveSession();
  if (!session) return emitCommandError(parsed, 'no_active_session', 'No active capture session. Start one first: `capture session start --url <url>`.');
  if (!session.targetId) return emitCommandError(parsed, 'no_session_target', 'Active capture session has no target tab to restore.');

  let stopped: FinalizedRecording;
  try {
    stopped = await deps.stopComposedRecorder({ sessionDir: session.dir, recId: parsed.recId });
    ensureFinalizedInventory(stopped.recDir);
    const video = deps.encodeVideo(stopped.recDir, stopped.durationMs);
    const metaPath = path.join(stopped.recDir, 'meta.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
      writeJsonPrivate(metaPath, { ...meta, video });
    }
    (stopped as FinalizedRecording & { video?: VideoEncoding }).video = video;
  } catch (err) {
    return emitCommandError(parsed, 'stop_failed', err instanceof Error ? err.message : String(err));
  }
  emitFinalizedResult(parsed, stopped);
}

function emitFinalizedResult(parsed: ParsedArgs, stopped: FinalizedRecording & { action?: string }): void {
  const durationS = `${(stopped.durationMs / 1000).toFixed(1)}s`;
  const result: RenderableResult = {
    tag: 'recording',
    attestation: { kind: 'recording', id: stopped.recId, path: stopped.recDir },
    attrs: {
      frames: stopped.frames,
      fps: stopped.fps,
      duration: durationS,
      state: stopped.state,
      'event-records': stopped.eventCount ?? 'unavailable',
      'baseline-availability': baselineAvailability(stopped.recDir),
      ...(stopped.action ? { action: stopped.action } : {}),
      ...(stopped.viewportRestored !== null ? { 'viewport-restored': stopped.viewportRestored } : {}),
      ...('video' in stopped ? { video: (stopped as { video?: VideoEncoding }).video?.status ?? 'unavailable' } : {}),
      'timestamp-uncertainty': '±1 frame for frame-derived timestamps',
    },
    summary: stopped.state === 'partial'
      ? fact`Recording is partial: no screencast frames were captured over ${durationS}; retained event and recorder artifacts are available.`
      : stopped.state === 'orphaned-finalized'
        ? fact`Recorder process was no longer running; finalized best-effort from artifacts already flushed to disk.`
        : stopped.eventCount !== null
          ? fact`Recording finalized: ${stopped.frames} frame(s) over ${durationS}, ${stopped.eventCount} event record(s).`
          : fact`Recording finalized: ${stopped.frames} frame(s) over ${durationS}.`,
    artifacts: formatArtifactList(listRecordingArtifacts(stopped.recDir)),
  };
  emitResult(result, { json: parsed.json });
}

function baselineAvailability(recDir: string): string {
  try {
    const markers = JSON.parse(fs.readFileSync(path.join(recDir, 'markers.json'), 'utf8')) as { baselinesPending?: unknown; performanceNowMs?: unknown };
    return markers.baselinesPending ? 'pending' : typeof markers.performanceNowMs === 'number' ? 'available' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

function emitCommandError(parsed: ParsedArgs, status: string, message: string, attrs: Record<string, boolean> = {}): void {
  emitResult({ tag: 'error', attrs: { command: 'motion rec', status, ...attrs }, summary: fact`${message}` }, { json: parsed.json });
  process.exitCode = 1;
}

/** Lists only artifacts actually present — a best-effort orphaned finalize
 * can legitimately lack video encoding or flushed frame data. */
function listRecordingArtifacts(recDir: string): ArtifactEntry[] {
  let entries: string[];
  try { entries = fs.readdirSync(recDir); } catch { return []; }
  const names: string[] = [];
  for (const entry of entries) {
    const full = path.join(recDir, entry);
    if (fs.statSync(full).isDirectory()) {
      if (fs.readdirSync(full).length > 0) names.push(`${entry}/`);
    } else {
      names.push(entry);
    }
  }
  return names.sort().map((name) => ({ name }));
}
