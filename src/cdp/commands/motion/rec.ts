import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { type ParsedArgs } from '../../types.js';
import { CDPClient } from '../../client.js';
import { openTab } from '../../targets.js';
import { detectCdpPort } from '../../detect.js';
import { RecorderSession } from '../../recorder-bridge.js';
import {
  emitResult,
  fact,
  text,
  formatArtifactList,
  type ArtifactEntry,
  type RenderableResult,
} from '../../../output/render.js';
import { getActiveSession } from '../../../session-context.js';
import { createOneshotSession } from '../../../session/commands.js';
import { ensurePrivateDir, writeJsonPrivate, writeNdjsonPrivate, type RecMeta } from '../../../session/artifacts.js';
import { sanitizeString } from '../../measure/redaction.js';
import {
  startComposedRecorder,
  stopComposedRecorder,
  type StartRecorderResult,
  type FinalizedRecording,
} from '../../motion/recorder.js';
import { rejectUnsupportedGate } from '../gate-guard.js';

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

  if (parsed.start && parsed.stop) {
    return emitCommandError(parsed, 'invalid_lifecycle', '`--start` and `--stop` cannot be used together.');
  }
  if (parsed.start) return handleStart(parsed);
  if (parsed.stop) return handleStop(parsed);
  return handleOneShot(parsed);
}

async function handleOneShot(parsed: ParsedArgs): Promise<void> {
  const url = parsed.positional[0];
  if (!url || !parsed.do || parsed.positional.length !== 1) {
    return emitCommandError(parsed, 'invalid_oneshot', 'One-shot recording requires exactly one URL and `--do <action>`.');
  }
  if (getActiveSession()) {
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

  const oneshot = createOneshotSession('motion');
  const recId = `rec-${crypto.randomBytes(2).toString('hex')}`;
  const recDir = path.join(oneshot.artifactsDir, recId);
  ensurePrivateDir(recDir);
  ensurePrivateDir(path.join(recDir, 'frames'));

  let client: CDPClient | undefined;
  try {
    const port = parsed.port ?? await detectCdpPort();
    const tab = await openTab(port, parsedUrl.toString());
    if (!tab.webSocketDebuggerUrl) throw new Error('Opened tab has no WebSocket debugger URL.');
    client = new CDPClient(tab.webSocketDebuggerUrl);
    await client.waitReady();

    const recorder = new RecorderSession({ client, recDir });
    await recorder.start();
    await driveOneShotAction(recorder, parsed.do);
    if (parsed.duration) await sleep(parsed.duration * 1000);
    const stopped = await recorder.stop();
    const finalized = finalizeOneShotRecording(recDir, recId, parsedUrl.toString(), parsed.do, stopped);
    emitFinalizedResult(parsed, finalized);
  } catch (err) {
    // A failed action is not a completed measurement. Keep the private partial
    // artifact for inspection, but never invent a finalized meta.json.
    return emitCommandError(parsed, 'oneshot_failed', err instanceof Error ? err.message : String(err));
  } finally {
    client?.close();
  }
}

/** Drive the deliberately narrow one-shot action grammar. Selectors are
 * passed as JSON data into Runtime.evaluate, never concatenated as code. */
async function driveOneShotAction(recorder: RecorderSession, action: string): Promise<void> {
  if (action.startsWith('click:')) {
    const selector = action.slice('click:'.length);
    if (!selector) throw new Error('Invalid --do action: click requires a CSS selector.');
    const result = await recorder.handleCdp({
      method: 'Runtime.evaluate',
      params: {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { error: 'selector_not_found' }; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
        returnByValue: true,
      },
      mark: action,
    });
    const value = (result.result as { result?: { value?: { x?: unknown; y?: unknown; error?: unknown } } } | undefined)?.result?.value;
    if (!value || value.error || typeof value.x !== 'number' || typeof value.y !== 'number') {
      throw new Error(`One-shot click target was not found: ${selector}`);
    }
    await recorder.handleCdp({ method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: value.x, y: value.y, button: 'left', clickCount: 1 }, mark: action });
    await recorder.handleCdp({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseReleased', x: value.x, y: value.y, button: 'left', clickCount: 1 }, mark: action });
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
    const value = (result.result as { result?: { value?: { error?: unknown } } } | undefined)?.result?.value;
    if (value?.error) throw new Error(`One-shot scroll could not run: ${String(value.error)}.`);
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
): FinalizedRecording {
  ensureFinalizedInventory(recDir);
  const fps = stopped.durationMs > 0 ? Math.round((stopped.frameCount / (stopped.durationMs / 1000)) * 10) / 10 : 0;
  writeJsonPrivate(path.join(recDir, 'markers.json'), stopped.markers);
  const meta: RecMeta & { url: string; fps: number; eventCount: number } = {
    id: recId,
    action: sanitizeString(action),
    frames: stopped.frameCount,
    durationMs: stopped.durationMs,
    state: 'finalized',
    url: sanitizeString(url),
    fps,
    eventCount: stopped.eventCount,
  };
  writeJsonPrivate(path.join(recDir, 'meta.json'), meta);
  return { recId, recDir, frames: stopped.frameCount, durationMs: stopped.durationMs, fps, state: 'finalized', eventCount: stopped.eventCount };
}

function ensureFinalizedInventory(recDir: string): void {
  ensurePrivateDir(path.join(recDir, 'frames'));
  for (const filename of ['rects.jsonl', 'events.jsonl']) {
    const artifactPath = path.join(recDir, filename);
    if (!fs.existsSync(artifactPath)) writeNdjsonPrivate(artifactPath, []);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleStart(parsed: ParsedArgs): Promise<void> {
  const session = getActiveSession();
  if (!session) return emitCommandError(parsed, 'no_active_session', 'No active capture session. Start one first: `capture session start --url <url>`.');

  let started: StartRecorderResult;
  try {
    started = await startComposedRecorder({ sessionDir: session.dir, targetId: session.targetId });
  } catch (err) {
    return emitCommandError(parsed, 'start_failed', err instanceof Error ? err.message : String(err));
  }

  const result: RenderableResult = {
    tag: 'recording',
    attestation: { kind: 'recording', id: started.recId, path: started.recDir },
    attrs: { state: 'recording', 'timestamp-uncertainty': '±1 frame for frame-derived timestamps' },
    summary: text`Recorder armed on the session tab (screencast + tracing + observers). Drive the page with capture commands; motion rec --stop finalizes.`,
    sections: started.reapedStale ? [fact`A stale recording (${started.reapedStale.recId}, dead process) was reaped before this one armed.`] : undefined,
  };
  emitResult(result, { json: parsed.json });
}

async function handleStop(parsed: ParsedArgs): Promise<void> {
  const session = getActiveSession();
  if (!session) return emitCommandError(parsed, 'no_active_session', 'No active capture session. Start one first: `capture session start --url <url>`.');

  let stopped: FinalizedRecording;
  try {
    stopped = await stopComposedRecorder({ sessionDir: session.dir, recId: parsed.recId });
    ensureFinalizedInventory(stopped.recDir);
  } catch (err) {
    return emitCommandError(parsed, 'stop_failed', err instanceof Error ? err.message : String(err));
  }
  emitFinalizedResult(parsed, stopped);
}

function emitFinalizedResult(parsed: ParsedArgs, stopped: FinalizedRecording): void {
  const durationS = `${(stopped.durationMs / 1000).toFixed(1)}s`;
  const result: RenderableResult = {
    tag: 'recording',
    attestation: { kind: 'recording', id: stopped.recId, path: stopped.recDir },
    attrs: { frames: stopped.frames, fps: stopped.fps, duration: durationS, state: stopped.state, 'timestamp-uncertainty': '±1 frame for frame-derived timestamps' },
    summary: stopped.state === 'orphaned-finalized'
      ? fact`Recorder process was no longer running; finalized best-effort from artifacts already flushed to disk.`
      : stopped.eventCount !== null
        ? fact`Recording finalized: ${stopped.frames} frame(s) over ${durationS}, ${stopped.eventCount} event(s) labeled.`
        : fact`Recording finalized: ${stopped.frames} frame(s) over ${durationS}.`,
    artifacts: formatArtifactList(listRecordingArtifacts(stopped.recDir)),
  };
  emitResult(result, { json: parsed.json });
}

function emitCommandError(parsed: ParsedArgs, status: string, message: string): void {
  emitResult({ tag: 'error', attrs: { command: 'motion rec', status }, summary: fact`${sanitizeString(message)}` }, { json: parsed.json });
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
