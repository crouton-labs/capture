import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  createHarRecording,
  readHarRecording,
  deleteHarRecording,
} from '../har-manager.js';
import {
  getActiveSession,
  setActiveSession,
  clearActiveSession,
} from '../session-context.js';
import { expandEqualsFlags } from '../cdp/args.js';
import { type ParsedArgs } from '../cdp/types.js';
import { startBridge, stopBridge } from '../cdp/bridge/spawn.js';
import { teardownAnyLiveRecorderAtSessionStop } from '../cdp/motion/recorder.js';
import {
  emitResult,
  fact,
  text,
  line,
  lineList,
  type FactLine,
} from '../output/render.js';
import {
  CAPTURE_ROOT,
  FILE_MODE,
  ensurePrivateDir,
  writeJsonPrivate,
  type SnapMeta,
  type RecMeta,
} from './artifacts.js';

interface LogPid {
  pid: number;
  name: string;
  sourcePath: string;
}

interface Session {
  id: string;
  dir: string;
  harId: string | null;
  startedAt: string;
  url: string | null;
  targetId: string | null;
  cdpPort: number | null;
  stepCount: number;
  logPids: LogPid[];
  /** Set when started with --hold: one CDP browser connection held open for the session. */
  bridgeSocket: string | null;
  bridgePid: number | null;
}

interface BundleManifest {
  id: string;
  startedAt: string;
  stoppedAt: string;
  duration: number;
  url: string | null;
  shots: Array<{ name: string; path: string }>;
  har: { id: string; path: string; entryCount: number } | null;
  logs: Array<{ name: string; path: string; lines: number }>;
  other: Array<{ name: string; path: string }>;
  /** `measure snap` artifacts collected from `measure/snaps/{id}/meta.json`. */
  snaps: Array<{ id: string; path: string; url: string | null; viewport: string | null; settled: boolean; capturedAt: string }>;
  /** `motion rec` artifacts collected from `motion/recs/{id}/meta.json`. */
  recs: Array<{ id: string; path: string; action: string | null; frames: number; durationMs: number; state: string; viewportRestored: boolean | null }>;
  /** Retry outcomes for viewport obligations retained by failed recorder starts. */
  pendingViewportRestorations: Array<{ recId: string; viewportRestored: boolean | null }>;
}

/** The bundle-manifest section keys `session view --filter` can address. */
type SectionKey = 'shots' | 'har' | 'logs' | 'snaps' | 'recs' | 'other';

// The `--filter <name>` query names map onto manifest section keys. Most are
// identical; `measure`/`motion` are the query-facing names for the `snaps`/
// `recs` keys (matching the `measure`/`motion` command branches rather than
// the artifact-file naming), so they get an explicit mapping.
const VIEW_FILTERS: Record<string, SectionKey> = {
  shots: 'shots',
  har: 'har',
  logs: 'logs',
  measure: 'snaps',
  motion: 'recs',
  other: 'other',
};

/** User-facing label for each manifest section in the unfiltered view. */
const SECTION_LABELS: Record<SectionKey, string> = {
  shots: 'shots',
  har: 'har',
  logs: 'logs',
  snaps: 'measure',
  recs: 'motion',
  other: 'other',
};

function sessionDir(id: string): string {
  return path.join(CAPTURE_ROOT, id);
}

/** One-shot artifact session outside an active session — see `createOneshotSession`. */
export interface OneshotSession {
  /** `oneshot-{id}`; also the dir name under `CAPTURE_ROOT`. */
  id: string;
  /** `{CAPTURE_ROOT}/oneshot-{id}` */
  dir: string;
  kind: 'measure' | 'motion' | 'page';
  /** `{dir}/measure/snaps`, `{dir}/motion/recs`, or `{dir}/page`, already created private. */
  artifactsDir: string;
}

/**
 * Creates the ephemeral artifact dir a URL-target `measure`/`motion`/`page`
 * leaf writes into when there is no active session: `oneshot-{id}/measure/snaps`,
 * `oneshot-{id}/motion/recs`, or `oneshot-{id}/page` under `CAPTURE_ROOT`.
 * Holds only the one subtree the caller needs — no HAR, no held bridge, no
 * `.session.json` — and is never registered as the active session. It is not
 * bundled/torn down by `session stop`; it accumulates under `/tmp` the same as
 * any other session dir until the OS reaps `/tmp`.
 */
export function createOneshotSession(kind: 'measure' | 'motion' | 'page'): OneshotSession {
  const id = `oneshot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = sessionDir(id);
  const artifactsDir = kind === 'measure'
    ? path.join(dir, 'measure', 'snaps')
    : kind === 'motion'
      ? path.join(dir, 'motion', 'recs')
      : path.join(dir, 'page');
  ensurePrivateDir(artifactsDir);
  return { id, dir, kind, artifactsDir };
}

/** Reads one `measure/snaps/{id}/meta.json` and shapes it into a manifest `snaps[]` entry. */
function readSnapMeta(snapDir: string, fallbackId: string): BundleManifest['snaps'][number] {
  const meta = JSON.parse(fs.readFileSync(path.join(snapDir, 'meta.json'), 'utf-8')) as Partial<SnapMeta>;
  return {
    id: meta.id ?? fallbackId,
    path: snapDir,
    url: meta.url ?? null,
    viewport: meta.viewport ?? null,
    settled: meta.settled ?? false,
    capturedAt: meta.capturedAt ?? '',
  };
}

/** Reads one `motion/recs/{id}/meta.json` and shapes it into a manifest `recs[]` entry. */
function readRecMeta(recDir: string, fallbackId: string): BundleManifest['recs'][number] {
  const meta = JSON.parse(fs.readFileSync(path.join(recDir, 'meta.json'), 'utf-8')) as Partial<RecMeta>;
  return {
    id: meta.id ?? fallbackId,
    path: recDir,
    action: meta.action ?? null,
    frames: meta.frames ?? 0,
    durationMs: meta.durationMs ?? 0,
    state: meta.state ?? 'unknown',
    viewportRestored: typeof meta.viewportRestored === 'boolean' ? meta.viewportRestored : null,
  };
}

/** Collects finalized snapshots under `{session.dir}/measure/snaps/{id}/meta.json`. */
function collectSnaps(dir: string): BundleManifest['snaps'] {
  const snapsRoot = path.join(dir, 'measure', 'snaps');
  if (!fs.existsSync(snapsRoot)) return [];
  return fs.readdirSync(snapsRoot)
    .filter((name) => fs.existsSync(path.join(snapsRoot, name, 'meta.json')))
    .map((name) => readSnapMeta(path.join(snapsRoot, name), name));
}

/** Collects finalized recordings under `{session.dir}/motion/recs/{id}/meta.json`. */
function collectRecs(dir: string): BundleManifest['recs'] {
  const recsRoot = path.join(dir, 'motion', 'recs');
  if (!fs.existsSync(recsRoot)) return [];
  return fs.readdirSync(recsRoot)
    .filter((name) => fs.existsSync(path.join(recsRoot, name, 'meta.json')))
    .map((name) => readRecMeta(path.join(recsRoot, name), name));
}

function sessionMetaPath(id: string): string {
  return path.join(sessionDir(id), '.session.json');
}

function readSession(id: string): Session {
  const metaPath = sessionMetaPath(id);
  if (!fs.existsSync(metaPath)) {
    throw new Error(`No capture session found: ${id}`);
  }
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as Session;
}

function generateId(): string {
  return `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function hasHelpFlag(args: string[]): boolean {
  return args.some((arg) => arg === '-h' || arg === '--help');
}

export async function waitForPageLoad(
  client: { waitReady(): Promise<void>; send(method: string, params?: Record<string, unknown>): Promise<unknown>; on(event: string, handler: (params: unknown) => void): void; },
  timeoutMs: number,
): Promise<boolean> {
  await client.waitReady();
  await client.send('Page.enable');

  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(true), timeoutMs);
    const done = (timedOut: boolean) => {
      clearTimeout(timer);
      resolve(timedOut);
    };
    client.on('Page.loadEventFired', () => done(false));
    // A page that finished loading before we attached (about:blank, cached
    // instant loads) never fires loadEventFired — check readyState directly.
    client
      .send('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      })
      .then((r) => {
        const value = (r as { result?: { value?: unknown } } | undefined)?.result?.value;
        if (value === 'complete') done(false);
      })
      .catch(() => {});
  });
}

/** Root-help representation of this branch, assembled by `src/capture.ts`. */
export const COMMAND_BLOCK = `<command name="session">
the artifact container — a session opens a tab, records HAR, and bundles every artifact; while active, every command auto-targets its tab
use when starting scoped work against a page: start first, then every other capture command needs no --target/--port threading
  start · stop · list · view — \`capture session -h\`
</command>`;

const START_USAGE = `capture session start [--url <url>] [--hold] — open a tab, record HAR, and set the active capture context.

Input:
  --url <url>    Absolute URL to open in a fresh tab. Omit to start a session
                 with no tab (HAR-only until a later command targets one).
  --hold         Hold one CDP browser connection open for the session's
                 lifetime, so browser-level state (permission grants,
                 ServiceWorker enablement) survives across separate commands.
  --port <n>     CDP port to attach to; default is auto-detected across localhost.

Output:
  One <session id=… path=… [url=…]> block: the session id, bundle dir, opened
  tab, HAR recording id, and held-bridge pid when applicable. --json mirrors
  the same fields.

Effects:
  Creates a private session dir with shots/, starts a HAR recording, opens the
  tab (with --url), optionally holds a CDP bridge, and registers the session as
  the active capture context so subsequent commands auto-target it.`;

const STOP_USAGE = `capture session stop <session-id> — finalize a session and write its bundle manifest.

Input:
  <session-id>   The session to stop (from \`capture session list\`).

Output:
  One <session-stopped id=… path=…> block: the bundle manifest path plus
  counts (shots, HAR entries, logs, measure snaps, motion recs, other). --json
  mirrors the same fields.

Effects:
  Kills log tailers, tears down the held CDP bridge, finalizes any live
  recorder, collects every artifact into bundle.json, and clears the active
  capture context.`;

const LIST_USAGE = `capture session list — list active and stopped capture sessions.

Input:
  (none)

Output:
  One <sessions count=…> block, one row per session: id, status
  (active|stopped), start time, and URL when set. --json mirrors the same rows.

Effects:
  None — reads session metadata only.`;

const VIEW_USAGE = `capture session view <session-id> [--filter <section>] — read back a stopped session's bundle manifest.

Input:
  <session-id>        A stopped session (from \`capture session list\`).
  --filter <section>  Show only one section: shots, har, logs, measure,
                      motion, or other. measure -> manifest snaps, motion ->
                      manifest recs.

Output:
  One <session id=… path=… [filter=…]> block: the manifest sections (shots,
  har, logs, measure snaps, motion recs, other), or a single section under
  --filter. --json mirrors the same fields.

Effects:
  None — reads bundle.json only.`;

function printSessionHelp(): void {
  console.log(`capture session — the artifact container: opens a tab, records HAR, bundles every artifact.

An active session auto-targets its tab and auto-appends recorded traffic — no
--target/--har threading. \`stop\` finalizes the session and writes its bundle
manifest; \`view\` reads that manifest back.

  <subcommand name="start" args="[--url <url>] [--hold]" whenToUse="open a tab, start HAR, and set the active capture context"/>
  <subcommand name="stop" args="<session-id>" whenToUse="finalize the session and write its bundle manifest"/>
  <subcommand name="list" args="" whenToUse="show active and stopped sessions"/>
  <subcommand name="view" args="<session-id> [--filter shots|har|logs|measure|motion|other]" whenToUse="read back a stopped session's bundle manifest"/>

  capture session <leaf> -h    Per-leaf usage`);
}

// ============================================================================
// Session Commands
// ============================================================================

async function start(parsed: ParsedArgs): Promise<void> {
  if (parsed.help) {
    console.log(START_USAGE);
    return;
  }

  const url = parsed.url ?? null;
  const hold = parsed.hold === true;

  const id = generateId();
  const dir = sessionDir(id);
  ensurePrivateDir(path.join(dir, 'shots'));

  // Start HAR recording directly.
  let harId: string | null = null;
  try {
    const harResult = createHarRecording();
    harId = harResult.id;
  } catch (err) {
    console.error(`Warning: could not start HAR recording: ${err instanceof Error ? err.message : err}`);
  }

  let targetId: string | null = null;
  let pageLoadTimedOut = false;
  let bridgeSocket: string | null = null;
  let bridgePid: number | null = null;

  try {
    let cdpPort: number | null = null;
    if (url || hold) {
      const { detectCdpPort } = await import('../cdp.js');
      cdpPort = parsed.port ?? await detectCdpPort();
    }

    // Open tab if URL provided. Fail fast if the new target cannot attach.
    if (url) {
      const { openTab, CDPClient } = await import('../cdp.js');
      const tab = await openTab(cdpPort!, url);
      targetId = tab.id;

      if (!targetId) {
        throw new Error(
          `capture session start could not attach to ${url}. Reuse an existing tab with --target.`,
        );
      }
      if (!tab.webSocketDebuggerUrl) {
        throw new Error(
          `capture session start could not attach to ${url}: missing WebSocket debugger URL. Reuse an existing tab with --target.`,
        );
      }

      const client = new CDPClient(tab.webSocketDebuggerUrl);
      try {
        try {
          await client.send('Runtime.enable', {}, 5_000);
        } catch (err) {
          throw new Error(
            `capture session start could not attach to ${url}: ${err instanceof Error ? err.message : err}. Reuse an existing tab with --target.`,
          );
        }
        pageLoadTimedOut = await waitForPageLoad(client, 10_000);
      } finally {
        client.close();
      }
    }

    // Hold a CDP browser connection open for the session's lifetime so
    // browser-level state (permission grants, ServiceWorker enablement)
    // survives across separate `capture` commands instead of reverting the
    // instant each command's own connection closes.
    if (hold) {
      const bridge = await startBridge(dir, cdpPort!);
      bridgeSocket = bridge.socketPath;
      bridgePid = bridge.pid;
    }
  } catch (err) {
    // Any failure after HAR creation (CDP-port detection, tab open, bridge
    // start) leaks the newly-created HAR recording unless we clean it up here.
    // Best-effort so a cleanup failure can't mask the real start error.
    if (harId) {
      try {
        deleteHarRecording(harId);
      } catch {
        /* best effort */
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    emitResult({
      tag: 'error',
      attrs: { command: 'session start', code: 'start_failed' },
      summary: fact`Session could not start: ${msg}`,
      followUp: text`Ensure a CDP-enabled browser is running — \`capture tab list\` is the probe.`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  const session: Session = {
    id,
    dir,
    harId,
    startedAt: new Date().toISOString(),
    url,
    targetId,
    cdpPort,
    stepCount: 0,
    logPids: [],
    bridgeSocket,
    bridgePid,
  };
  writeJsonPrivate(sessionMetaPath(id), session);

  // Set as active session for auto-defaults.
  setActiveSession({
    sessionId: id,
    dir,
    harId,
    targetId,
    cdpPort,
    stepCount: 0,
    bridgeSocket,
  });

  const rows: FactLine[] = [fact`bundle dir: ${dir}`];
  if (targetId) rows.push(fact`tab ${targetId} opened at ${url ?? ''}`);
  if (pageLoadTimedOut) rows.push(fact`page load timed out after 10000ms; the session stays attached to target ${targetId ?? ''}`);
  if (harId) rows.push(fact`HAR recording ${harId} — traffic auto-appends while the session is active`);
  if (hold) rows.push(fact`held CDP bridge: pid ${bridgePid ?? 0}`);

  emitResult({
    tag: 'session',
    attrs: { id, path: dir, ...(url ? { url } : {}) },
    summary: fact`Session ${id} started; it is now the active capture context.`,
    sections: [lineList(rows)],
    followUp: fact`capture session stop ${id}`,
  }, { json: parsed.json });
}

export function logCommand(rawArgs: string[]): void {
  const args = expandEqualsFlags(rawArgs);
  if (hasHelpFlag(args)) {
    console.log('Usage: capture log <path> [--name label] [--session <id>]');
    return;
  }

  const sourcePath = args[0];
  if (!sourcePath) {
    console.error('Usage: capture log <path> [--name label] [--session <id>]');
    process.exit(1);
  }

  const resolved = path.resolve(sourcePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Log file not found: ${resolved}`);
  }

  let name: string | null = null;
  let sessionId: string | null = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) name = args[++i];
    if (args[i] === '--session' && args[i + 1]) sessionId = args[++i];
  }

  if (!sessionId) {
    const active = getActiveSession();
    if (!active) {
      throw new Error('No active capture session. Start one or pass --session <id>.');
    }
    sessionId = active.sessionId;
  }

  const session = readSession(sessionId);
  name = name ?? path.basename(resolved, path.extname(resolved));

  const logsDir = path.join(session.dir, 'logs');
  ensurePrivateDir(logsDir);

  const destPath = path.join(logsDir, `${name}.log`);
  const outFd = fs.openSync(destPath, 'a', FILE_MODE);
  fs.chmodSync(destPath, FILE_MODE);

  const child = spawn(
    'sh',
    ['-c', `tail -f "${resolved}" | perl -MPOSIX -ne 'print strftime("%Y-%m-%dT%H:%M:%SZ",gmtime())." ".$_'`],
    { detached: true, stdio: ['ignore', outFd, 'ignore'] },
  );
  child.unref();
  fs.closeSync(outFd);

  const pid = child.pid!;
  session.logPids.push({ pid, name, sourcePath: resolved });
  writeJsonPrivate(sessionMetaPath(session.id), session);

  const payload = JSON.stringify({ name, sourcePath: resolved, destPath, pid }, null, 2);
  console.log(payload);
}

async function stop(parsed: ParsedArgs): Promise<void> {
  if (parsed.help) {
    console.log(STOP_USAGE);
    return;
  }

  const id = parsed.positional[0];
  if (!id) {
    emitResult({
      tag: 'error',
      attrs: { command: 'session stop', code: 'missing_argument' },
      summary: fact`received: \`session stop\`; expected: \`session stop <session-id>\`.`,
      followUp: text`Run \`capture session list\` to find a session id.`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  let session: Session;
  try {
    session = readSession(id);
  } catch {
    emitResult({
      tag: 'error',
      attrs: { command: 'session stop', code: 'unknown_session' },
      summary: fact`No capture session found: ${id}.`,
      followUp: text`Run \`capture session list\` to see known sessions.`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  const stoppedAt = new Date().toISOString();
  const startMs = new Date(session.startedAt).getTime();
  const duration = Date.now() - startMs;

  // Kill log tailers.
  for (const lp of session.logPids ?? []) {
    try { process.kill(-lp.pid, 'SIGTERM'); } catch { /* already dead */ }
  }
  if (session.logPids?.length) {
    await new Promise((r) => setTimeout(r, 200));
  }

  // Tear down the held CDP bridge, if any — releases the browser-level
  // connection (and any grants/target-enablement it was keeping alive).
  if (session.bridgePid || session.bridgeSocket) {
    stopBridge(session.bridgePid, session.bridgeSocket);
  }

  // Recorder lifecycle teardown — finalize/tear down any live recorder
  // before bundle collection (cdp/motion/recorder.ts); a stale recorder.json
  // with a dead pid is reaped, never resumed.
  let recorderTeardown: Awaited<ReturnType<typeof teardownAnyLiveRecorderAtSessionStop>> | null = null;
  try {
    recorderTeardown = await teardownAnyLiveRecorderAtSessionStop(session.dir);
  } catch (err) {
    console.error(`Warning: could not finalize active recording: ${err instanceof Error ? err.message : err}`);
  }

  // Collect screenshots.
  const shotsDir = path.join(session.dir, 'shots');
  const shots = fs.existsSync(shotsDir)
    ? fs.readdirSync(shotsDir)
        .filter((f) => f.endsWith('.png') || f.endsWith('.jpg'))
        .map((f) => ({ name: f, path: path.join(shotsDir, f) }))
    : [];

  // Collect HAR directly from har-manager.
  let har: BundleManifest['har'] = null;
  if (session.harId) {
    try {
      const harData = readHarRecording(session.harId);
      if (harData) {
        const harPath = path.join(session.dir, 'har.json');
        writeJsonPrivate(harPath, harData);
        har = { id: session.harId, path: harPath, entryCount: harData.log.entries.length };
        try { deleteHarRecording(session.harId); } catch { /* best effort */ }
      }
    } catch (err) {
      console.error(`Warning: could not read HAR: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Collect log files.
  const logsDir = path.join(session.dir, 'logs');
  const logs = fs.existsSync(logsDir)
    ? fs.readdirSync(logsDir)
        .filter((f) => f.endsWith('.log'))
        .map((f) => {
          const filePath = path.join(logsDir, f);
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content ? content.split('\n').filter(Boolean).length : 0;
          return { name: f, path: filePath, lines };
        })
    : [];

  // Collect measure snapshots and motion recordings.
  const snaps = collectSnaps(session.dir);
  const recs = collectRecs(session.dir);

  // Collect anything else dropped in the session dir.
  const knownDirs = new Set(['shots', 'logs', 'measure', 'motion']);
  const knownFiles = new Set(['.session.json', 'har.json', 'bundle.json', 'bridge.sock']);
  const other = fs.readdirSync(session.dir)
    .filter((f) => !knownDirs.has(f) && !knownFiles.has(f))
    .map((f) => ({ name: f, path: path.join(session.dir, f) }));

  // Clear active session context.
  clearActiveSession();

  const manifest: BundleManifest = {
    id: session.id,
    startedAt: session.startedAt,
    stoppedAt,
    duration,
    url: session.url,
    shots,
    har,
    logs,
    other,
    snaps,
    recs,
    pendingViewportRestorations: recorderTeardown?.pendingViewportRestorations ?? [],
  };

  const bundlePath = path.join(session.dir, 'bundle.json');
  writeJsonPrivate(bundlePath, manifest);

  const rows: FactLine[] = [
    fact`shots: ${shots.length}`,
    har ? fact`har: ${har.entryCount} entries — ${har.path}` : fact`har: 0 entries`,
    fact`logs: ${logs.length}`,
    fact`measure snaps: ${snaps.length}`,
    fact`motion recs: ${recs.length}`,
    fact`other: ${other.length}`,
  ];
  if (recorderTeardown && 'recId' in recorderTeardown) {
    rows.push(fact`recorder ${recorderTeardown.recId} finalized — state ${recorderTeardown.state}, viewport restored ${String(recorderTeardown.viewportRestored)}`);
  }
  if (recorderTeardown?.pendingViewportRestorations.length) {
    rows.push(fact`pending viewport restorations: ${recorderTeardown.pendingViewportRestorations.length}`);
  }

  emitResult({
    tag: 'session-stopped',
    attrs: { id, path: bundlePath },
    summary: fact`Session ${id} stopped after ${duration}ms; bundle manifest written.`,
    sections: [lineList(rows)],
    followUp: fact`capture session view ${id}`,
  }, { json: parsed.json });
}

function list(parsed: ParsedArgs): void {
  if (parsed.help) {
    console.log(LIST_USAGE);
    return;
  }

  const sessions = fs.existsSync(CAPTURE_ROOT)
    ? fs.readdirSync(CAPTURE_ROOT)
        .filter((d) => fs.existsSync(sessionMetaPath(d)))
        .map((d) => {
          const session = readSession(d);
          const hasBundled = fs.existsSync(path.join(session.dir, 'bundle.json'));
          return { id: session.id, startedAt: session.startedAt, url: session.url, status: hasBundled ? 'stopped' : 'active' };
        })
    : [];

  if (sessions.length === 0) {
    emitResult({
      tag: 'sessions',
      attrs: { count: 0 },
      summary: text`No capture sessions.`,
    }, { json: parsed.json });
    return;
  }

  const rows = sessions.map((s) =>
    line(
      fact`${s.id} — ${s.status} — started ${s.startedAt}`,
      s.url ? fact` — ${s.url}` : text``,
    ),
  );

  emitResult({
    tag: 'sessions',
    attrs: { count: sessions.length },
    sections: [lineList(rows)],
  }, { json: parsed.json });
}

/** Renders one manifest section into the per-entry rows the view command prints. */
function sectionRows(manifest: BundleManifest, key: SectionKey): FactLine[] {
  switch (key) {
    case 'shots':
      return manifest.shots.map((s) => fact`${s.name} — ${s.path}`);
    case 'har':
      return manifest.har
        ? [fact`har.json — ${manifest.har.entryCount} entries — ${manifest.har.path}`]
        : [];
    case 'logs':
      return manifest.logs.map((l) => fact`${l.name} — ${l.lines} lines — ${l.path}`);
    case 'snaps':
      return manifest.snaps.map((s) =>
        fact`${s.id} — url ${s.url ?? '(none)'} — viewport ${s.viewport ?? '(none)'} — settled ${String(s.settled)} — ${s.path}`);
    case 'recs':
      return manifest.recs.map((r) =>
        fact`${r.id} — ${r.action ?? '(none)'} — ${r.frames} frames, ${r.durationMs}ms, ${r.state} — ${r.path}`);
    case 'other':
      return manifest.other.map((o) => fact`${o.name} — ${o.path}`);
  }
}

function view(parsed: ParsedArgs): void {
  if (parsed.help) {
    console.log(VIEW_USAGE);
    return;
  }

  const id = parsed.positional[0];
  if (!id) {
    emitResult({
      tag: 'error',
      attrs: { command: 'session view', code: 'missing_argument' },
      summary: fact`received: \`session view\`; expected: \`session view <session-id>\`.`,
      followUp: text`Run \`capture session list\` to find a session id.`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  let session: Session;
  try {
    session = readSession(id);
  } catch {
    emitResult({
      tag: 'error',
      attrs: { command: 'session view', code: 'unknown_session' },
      summary: fact`No capture session found: ${id}.`,
      followUp: text`Run \`capture session list\` to see known sessions.`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  const bundlePath = path.join(session.dir, 'bundle.json');
  if (!fs.existsSync(bundlePath)) {
    emitResult({
      tag: 'error',
      attrs: { command: 'session view', code: 'session_not_stopped' },
      summary: fact`Session ${id} has not been stopped; there is no bundle manifest yet.`,
      followUp: fact`capture session stop ${id}`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(bundlePath, 'utf-8')) as BundleManifest;

  if (parsed.filter !== undefined) {
    const key = VIEW_FILTERS[parsed.filter];
    if (!key) {
      emitResult({
        tag: 'error',
        attrs: { command: 'session view', code: 'invalid_filter' },
        summary: fact`received: --filter ${parsed.filter}; expected one of: shots, har, logs, measure, motion, other.`,
        followUp: text`Re-run \`capture session view <id> --filter <section>\` with a valid section.`,
      }, { json: parsed.json });
      process.exitCode = 1;
      return;
    }

    const rows = sectionRows(manifest, key);
    emitResult({
      tag: 'session',
      attrs: { id, path: bundlePath, filter: parsed.filter },
      summary: fact`${parsed.filter}: ${rows.length} entries`,
      sections: [lineList(rows)],
    }, { json: parsed.json });
    return;
  }

  const keys: SectionKey[] = ['shots', 'har', 'logs', 'snaps', 'recs', 'other'];
  const sections = keys.map((key) => {
    const rows = sectionRows(manifest, key);
    return lineList([
      fact`${SECTION_LABELS[key]}: ${rows.length}`,
      ...rows.map((r) => line(text`  `, r)),
    ]);
  });

  emitResult({
    tag: 'session',
    attrs: { id, path: bundlePath },
    summary: fact`Session ${id}: started ${manifest.startedAt}, stopped ${manifest.stoppedAt}, ${manifest.duration}ms.`,
    sections,
  }, { json: parsed.json });
}

export async function sessionMain(parsed: ParsedArgs, _args: string[]): Promise<void> {
  const leaf = parsed.positional[0];
  const rest: ParsedArgs = { ...parsed, positional: parsed.positional.slice(1) };

  switch (leaf) {
    case 'start': return start(rest);
    case 'stop': return stop(rest);
    case 'list': return list(rest);
    case 'view': return view(rest);
    case undefined:
      printSessionHelp();
      return;
    default:
      emitResult({
        tag: 'error',
        attrs: { command: 'session', code: 'unknown_subcommand' },
        summary: fact`received: \`session ${leaf}\`; expected one of: start, stop, list, view.`,
        followUp: text`Run \`capture session -h\` for usage.`,
      }, { json: parsed.json });
      process.exitCode = 1;
      return;
  }
}
