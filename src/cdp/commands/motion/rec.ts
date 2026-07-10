import * as fs from 'fs';
import * as path from 'path';
import { type ParsedArgs } from '../../types.js';
import {
  emitResult,
  fact,
  text,
  formatArtifactList,
  type ArtifactEntry,
  type RenderableResult,
} from '../../../output/render.js';
import { getActiveSession } from '../../../session-context.js';
import {
  startComposedRecorder,
  stopComposedRecorder,
  type StartRecorderResult,
  type FinalizedRecording,
} from '../../motion/recorder.js';
import { rejectUnsupportedGate } from '../gate-guard.js';

const USAGE = `Usage: capture motion rec --start
       capture motion rec --stop [--rec-id <id>]

Composed (\`--start\` ... intervening commands ... \`--stop\`): records
whatever the active session does across multiple independent commands.
Requires an active session (\`capture session start\`).

Options:
  --start            Arm the composed recorder (requires an active session)
  --stop             Finalize the composed recorder
  --rec-id <id>      Explicit recording id (default: the session's active recording)

One-shot (\`--do\`/bare url): not yet implemented.`;

export async function cmdMotionRec(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (rejectUnsupportedGate(parsed, 'motion rec')) return;

  if (parsed.start) {
    await handleStart(parsed);
    return;
  }

  if (parsed.stop) {
    await handleStop(parsed);
    return;
  }

  const result: RenderableResult = {
    tag: 'error',
    attrs: { command: 'motion rec', status: 'not_implemented' },
    summary: fact`One-shot \`motion rec\` (\`--do\`/bare url) is not implemented yet \u2014 use \`--start\`/\`--stop\` for a composed recording.`,
  };
  emitResult(result, { json: parsed.json });
  process.exit(1);
}

async function handleStart(parsed: ParsedArgs): Promise<void> {
  const session = getActiveSession();
  if (!session) {
    const result: RenderableResult = {
      tag: 'error',
      attrs: { command: 'motion rec --start', status: 'no_active_session' },
      summary: fact`No active capture session. Start one first: \`capture session start --url <url>\`.`,
    };
    emitResult(result, { json: parsed.json });
    process.exit(1);
    return;
  }

  let started: StartRecorderResult;
  try {
    started = await startComposedRecorder({ sessionDir: session.dir, targetId: session.targetId });
  } catch (err) {
    const result: RenderableResult = {
      tag: 'error',
      attrs: { command: 'motion rec --start', status: 'start_failed' },
      summary: fact`${err instanceof Error ? err.message : String(err)}`,
    };
    emitResult(result, { json: parsed.json });
    process.exit(1);
    return;
  }

  const result: RenderableResult = {
    tag: 'recording',
    attestation: { kind: 'recording', id: started.recId, path: started.recDir },
    attrs: { state: 'recording' },
    summary: text`Recorder armed on the session tab (screencast + tracing + observers). Drive the page with any capture command; \`motion rec --stop\` finalizes.`,
    sections: started.reapedStale
      ? [fact`A stale recording (\`${started.reapedStale.recId}\`, dead process) was reaped before this one armed.`]
      : undefined,
  };
  emitResult(result, { json: parsed.json });
}

async function handleStop(parsed: ParsedArgs): Promise<void> {
  const session = getActiveSession();
  if (!session) {
    const result: RenderableResult = {
      tag: 'error',
      attrs: { command: 'motion rec --stop', status: 'no_active_session' },
      summary: fact`No active capture session. Start one first: \`capture session start --url <url>\`.`,
    };
    emitResult(result, { json: parsed.json });
    process.exit(1);
    return;
  }

  let stopped: FinalizedRecording;
  try {
    stopped = await stopComposedRecorder({ sessionDir: session.dir, recId: parsed.recId });
  } catch (err) {
    const result: RenderableResult = {
      tag: 'error',
      attrs: { command: 'motion rec --stop', status: 'stop_failed' },
      summary: fact`${err instanceof Error ? err.message : String(err)}`,
    };
    emitResult(result, { json: parsed.json });
    process.exit(1);
    return;
  }

  const durationS = `${(stopped.durationMs / 1000).toFixed(1)}s`;
  const result: RenderableResult = {
    tag: 'recording',
    attestation: { kind: 'recording', id: stopped.recId, path: stopped.recDir },
    attrs: { frames: stopped.frames, fps: stopped.fps, duration: durationS, state: stopped.state },
    summary: stopped.state === 'orphaned-finalized'
      ? fact`Recorder process was no longer running; finalized best-effort from artifacts already flushed to disk.`
      : stopped.eventCount !== null
        ? fact`Recording finalized: ${stopped.frames} frame(s) over ${durationS}, ${stopped.eventCount} event(s) labeled.`
        : fact`Recording finalized: ${stopped.frames} frame(s) over ${durationS}.`,
    artifacts: formatArtifactList(listRecordingArtifacts(stopped.recDir)),
  };
  emitResult(result, { json: parsed.json });
}

/** Lists only what actually landed on `recDir` — never a fixed/assumed set of
 * filenames, since a best-effort/orphaned finalize can leave some artifacts
 * (e.g. `rects.jsonl`/`events.jsonl`, only ever written by the bridge process)
 * missing. An empty directory (e.g. `frames/` with zero PNGs flushed) is
 * treated as not having produced that artifact. */
function listRecordingArtifacts(recDir: string): ArtifactEntry[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(recDir);
  } catch {
    return [];
  }
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
