import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import { type ParsedArgs } from '../../types.js';
import { CDPClient } from '../../client.js';
import { openTab } from '../../targets.js';
import { detectCdpPort } from '../../detect.js';
import { RecorderSession } from '../../recorder-bridge.js';
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
import { sanitizeString } from '../../measure/redaction.js';
import {
  startComposedRecorder,
  stopComposedRecorder,
  StartRecorderError,
  type StartRecorderResult,
  type FinalizedRecording,
} from '../../motion/recorder.js';
import { rejectUnsupportedGate } from '../gate-guard.js';

interface RecCommandDeps {
  detectCdpPort: typeof detectCdpPort;
  openTab: typeof openTab;
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

const USAGE = `Usage: capture motion rec <url> --do <action> [--duration <seconds>]
       capture motion rec --start
       capture motion rec --stop [--rec-id <id>]

One-shot: opens <url>, records one scripted action, and finalizes an artifact.
Supported actions: click:<css-selector>; scroll:<css-selector>,to=<top|bottom|px>.

Composed (\`--start\` ... intervening commands ... \`--stop\`): records
whatever the active session does across multiple independent commands.
Requires an active session (\`capture session start\`).

Options:
  --do <action>      One-shot scripted action (requires a positional URL)
  --duration <secs>  Continue recording after the action (default: 0)
  --start            Arm the composed recorder (requires an active session)
  --stop             Finalize the composed recorder
  --rec-id <id>      Explicit recording id (default: the session's active recording)`;

export async function cmdMotionRec(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (rejectUnsupportedGate(parsed, 'motion rec')) return;

  const lifecycleError = validateLifecycleInputs(parsed);
  if (lifecycleError) return emitCommandError(parsed, lifecycleError.status, lifecycleError.message);
  if (parsed.start) return handleStart(parsed);
  if (parsed.stop) return handleStop(parsed);
  return handleOneShot(parsed);
}

async function handleOneShot(parsed: ParsedArgs): Promise<void> {
  const url = parsed.positional[0];
  if (!url || !parsed.do || parsed.positional.length !== 1) {
    return emitCommandError(parsed, 'invalid_oneshot', 'One-shot recording requires exactly one URL and `--do <action>`.');
  }
  if (deps.getActiveSession()) {
    return emitCommandError(parsed, 'oneshot_requires_no_session', 'One-shot recording is URL-scoped. In an active session, use `capture motion rec --start` and `capture motion rec --stop`.');
  }
  if (!Number.isFinite(parsed.duration ?? 0) || (parsed.duration ?? 0) < 0) {
    return emitCommandError(parsed, 'invalid_duration', '`--duration` must be a non-negative number of seconds.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return emitCommandError(parsed, 'invalid_url', `Invalid recording URL: ${url}`);
  }

  const oneshot = deps.createOneshotSession('motion');
  const recId = `rec-${crypto.randomBytes(2).toString('hex')}`;
  const recDir = path.join(oneshot.artifactsDir, recId);
  ensurePrivateDir(recDir);
  ensurePrivateDir(path.join(recDir, 'frames'));

  let client: CDPClient | undefined;
  let viewportMayHaveApplied = false;
  let failure: string | null = null;
  try {
    const port = parsed.port ?? await deps.detectCdpPort();
    const tab = await deps.openTab(port, parsedUrl.toString());
    if (!tab.webSocketDebuggerUrl) throw new Error('Opened tab has no WebSocket debugger URL.');
    client = deps.createClient(tab.webSocketDebuggerUrl);
    await client.waitReady();
    await client.send('Page.enable');
    const viewportRequested = Boolean(parseViewport(parsed.viewport));
    viewportMayHaveApplied = viewportRequested;
    await applyViewportOverride(client, parsed.viewport);
    await waitForPageReady(client);

    const recorder = deps.createRecorderSession({ client, recDir });
    await recorder.start();
    await driveOneShotAction(recorder, parsed.do);
    if (parsed.duration) await sleep(parsed.duration * 1000);
    const stopped = await recorder.stop();
    let viewportRestored: boolean | null = null;
    if (viewportMayHaveApplied) {
      viewportRestored = await restoreSessionViewportForClient(client);
      viewportMayHaveApplied = false;
    }
    const finalized = finalizeOneShotRecording(recDir, recId, parsedUrl.toString(), parsed.do, stopped, deps.encodeVideo, viewportRestored);
    emitFinalizedResult(parsed, finalized);
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  } finally {
    let restored: boolean | null = null;
    if (client && viewportMayHaveApplied) restored = await restoreSessionViewportForClient(client);
    client?.close();
    if (failure !== null) {
      // A failed action is not a completed measurement. Keep the private partial
      // artifact for inspection, but never invent a finalized meta.json.
      emitCommandError(parsed, 'oneshot_failed', failure, restored === null ? undefined : { 'viewport-restored': restored });
    }
  }
}

/** Drive the deliberately narrow one-shot action grammar. Selectors are
 * passed as JSON data into Runtime.evaluate, never concatenated as code. */
export async function driveOneShotAction(recorder: Pick<RecorderSession, 'handleCdp'>, action: string): Promise<void> {
  if (action.startsWith('click:')) {
    const selector = action.slice('click:'.length);
    if (!selector) throw new Error('Invalid --do action: click requires a CSS selector.');
    const result = await recorder.handleCdp({
      method: 'Runtime.evaluate',
      params: {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { error: 'selector_not_found' }; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
        returnByValue: true,
      },
    });
    assertRuntimeEvaluateSucceeded(result, `One-shot click target lookup failed for selector: ${selector}`);
    const value = (result.result as { result?: { value?: { x?: unknown; y?: unknown; error?: unknown } } } | undefined)?.result?.value;
    if (!value || value.error || typeof value.x !== 'number' || typeof value.y !== 'number') {
      throw new Error(`One-shot click target was not found: ${selector}`);
    }
    await recorder.handleCdp({ method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: value.x, y: value.y, button: 'left', clickCount: 1 }, mark: action });
    await recorder.handleCdp({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: value.x, y: value.y, button: 'left', clickCount: 1 } });
    return;
  }

  if (action.startsWith('scroll:')) {
    const spec = action.slice('scroll:'.length);
    const comma = spec.lastIndexOf(',to=');
    if (comma <= 0) throw new Error('Invalid --do action: scroll requires `scroll:<css-selector>,to=<top|bottom|px>`.');
    const selector = spec.slice(0, comma);
    const destination = spec.slice(comma + ',to='.length);
    const result = await recorder.handleCdp({
      method: 'Runtime.evaluate',
      params: {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { error: 'selector_not_found' }; const to = ${JSON.stringify(destination)}; const n = to === 'top' ? 0 : to === 'bottom' ? el.scrollHeight : Number(to); if (!Number.isFinite(n)) return { error: 'invalid_destination' }; el.scrollTop = n; return { scrollTop: el.scrollTop }; })()`,
        returnByValue: true,
      },
      mark: action,
    });
    assertRuntimeEvaluateSucceeded(result, `One-shot scroll failed for selector: ${selector}`);
    const value = (result.result as { result?: { value?: { error?: unknown; scrollTop?: unknown } } } | undefined)?.result?.value;
    if (!value || value.error) throw new Error(`One-shot scroll could not run: ${String(value?.error ?? 'missing_result')}.`);
    if (typeof value.scrollTop !== 'number') throw new Error('One-shot scroll did not return a valid scrollTop payload.');
    return;
  }

  throw new Error('Unsupported --do action. Supported actions: click:<css-selector>; scroll:<css-selector>,to=<top|bottom|px>.');
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
  writeJsonPrivate(path.join(recDir, 'markers.json'), stopped.markers);
  const meta: RecMeta & { url: string; fps: number; eventCount: number; video: VideoEncoding; viewportRestored: boolean | null } = {
    id: recId,
    action: sanitizeString(action),
    frames: stopped.frameCount,
    durationMs: stopped.durationMs,
    state: 'finalized',
    url: sanitizeString(url),
    fps,
    eventCount: stopped.eventCount,
    video,
    viewportRestored,
  };
  writeJsonPrivate(path.join(recDir, 'meta.json'), meta);
  return { recId, recDir, frames: stopped.frameCount, durationMs: stopped.durationMs, fps, state: 'finalized', eventCount: stopped.eventCount, viewportRestored, action: sanitizeString(action), video };
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

function parseViewport(viewport: string | undefined): { width: number; height: number } | null {
  if (!viewport) return null;
  const match = /^(\d+)x(\d+)$/i.exec(viewport.trim());
  if (!match) throw new Error('`--viewport` must be in WxH format, for example `390x844`.');
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('`--viewport` width and height must be positive integers.');
  }
  return { width, height };
}

async function applyViewportOverride(client: Pick<CDPClient, 'send'>, viewport: string | undefined): Promise<boolean> {
  const parsed = parseViewport(viewport);
  if (!parsed) return false;
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: parsed.width,
    height: parsed.height,
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

function assertRuntimeEvaluateSucceeded(result: unknown, prefix: string): void {
  const response = result as { result?: { exceptionDetails?: unknown }; exceptionDetails?: unknown } | undefined;
  if (response?.exceptionDetails || response?.result?.exceptionDetails) {
    throw new Error(`${prefix}: Runtime.evaluate reported a JavaScript exception.`);
  }
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

async function handleStart(parsed: ParsedArgs): Promise<void> {
  const session = deps.getActiveSession();
  if (!session) return emitCommandError(parsed, 'no_active_session', 'No active capture session. Start one first: `capture session start --url <url>`.');
  if (!session.targetId) return emitCommandError(parsed, 'no_session_target', 'Active capture session has no target tab to record.');

  let viewport: { width: number; height: number } | undefined;
  try {
    viewport = parseViewport(parsed.viewport) ?? undefined;
  } catch (err) {
    return emitCommandError(parsed, 'viewport_failed', err instanceof Error ? err.message : String(err));
  }

  let started: StartRecorderResult;
  try {
    started = await deps.startComposedRecorder({ sessionDir: session.dir, targetId: session.targetId, viewport });
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
    summary: stopped.state === 'orphaned-finalized'
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
  emitResult({ tag: 'error', attrs: { command: 'motion rec', status, ...attrs }, summary: fact`${sanitizeString(message)}` }, { json: parsed.json });
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
