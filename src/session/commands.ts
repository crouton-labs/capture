import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  createHarRecording,
  readHarRecording,
  deleteHarRecording,
  harFilePath,
  type HarFile,
  type HAREntry,
} from '../har-manager.js';
import {
  getActiveSession,
  setActiveSession,
  clearActiveSessionIf,
  updateSessionState,
  type ActiveSessionState,
} from '../session-context.js';
import { type ParsedArgs } from '../cdp/types.js';
import { startBridge, stopBridge } from '../cdp/bridge/spawn.js';
import { teardownAnyLiveRecorderAtSessionStop } from '../cdp/motion/recorder.js';
import {
  emitResult,
  fact,
  text,
  line,
  lineList,
  data,
  capped,
  type FactLine,
} from '../output/render.js';
import {
  CAPTURE_ROOT,
  FILE_MODE,
  acquirePrivateLock,
  ensurePrivateDir,
  writeJsonPrivate,
  readPrivateFile,
  unlinkPrivateFile,
  type SnapMeta,
  type RecMeta,
} from './artifacts.js';
import { beginSessionStop } from './coordinator.js';

type Session = ActiveSessionState;

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

function lifecycleScopeLockPath(): string {
  return path.join(CAPTURE_ROOT, `.session-lifecycle-${process.env.CRTR_NODE_ID ?? 'default'}`);
}

async function withLifecycleCoordinator<T>(action: () => Promise<T>): Promise<T> {
  const handle = await acquirePrivateLock(lifecycleScopeLockPath(), {
    acquireTimeoutMs: 120_000,
    leaseMs: 1_000,
  });
  try {
    return await action();
  } finally {
    handle.release();
  }
}

function isSessionStopped(session: Session): boolean {
  return Boolean(session.stoppedAt) || fs.existsSync(path.join(session.dir, 'bundle.json'));
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
  try {
    return JSON.parse(readPrivateFile(metaPath).toString('utf-8')) as Session;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`No capture session found: ${id}`);
    throw error;
  }
}

function generateId(): string {
  return `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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
  start · stop · list · view · har · log — \`capture session -h\`
</command>`;

const START_USAGE = `capture session start [--url <url>] [--hold] — open a tab, record HAR, and set the active capture context.

input:
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

effects:
  Creates a private session dir with shots/, starts a HAR recording, opens the
  tab (with --url), optionally holds a CDP bridge, and registers the session as
  the active capture context so subsequent commands auto-target it.`;

const STOP_USAGE = `capture session stop <session-id> — finalize a session and write its bundle manifest.

input:
  <session-id>   The session to stop (from \`capture session list\`).

Output:
  One <session-stopped id=… path=…> block: the bundle manifest path plus
  counts (shots, HAR entries, logs, measure snaps, motion recs, other). --json
  mirrors the same fields.

effects:
  Kills log tailers, tears down the held CDP bridge, finalizes any live
  recorder, collects every artifact into bundle.json, and clears the active
  capture context.`;

const LIST_USAGE = `capture session list — list active and stopped capture sessions.

input:
  (none)

output:
  One <sessions count=…> block, one row per session: id, status
  (active|stopped), start time, and URL when set. --json mirrors the same rows.

effects:
  None — reads session metadata only.`;

const VIEW_USAGE = `capture session view <session-id> [--filter <section>] — read back a stopped session's bundle manifest.

input:
  <session-id>        A stopped session (from \`capture session list\`).
  --filter <section>  Show only one section: shots, har, logs, measure,
                      motion, or other. measure -> manifest snaps, motion ->
                      manifest recs.

Output:
  One <session id=… path=… [filter=…]> block: the manifest sections (shots,
  har, logs, measure snaps, motion recs, other), or a single section under
  --filter. --json mirrors the same fields.

effects:
  None — reads bundle.json only.`;

const HAR_USAGE = `capture session har [<session-id>] — read a session's recorded HTTP traffic as a selection list.

input:
  <session-id>              session to read; defaults to the active session. A
                            running session reads its live accumulating HAR; a
                            stopped one reads the bundled har.json.
  --filter-url <pattern>    substring or regex match on the request URL
  --filter-status <code>    status code, prefix (e.g. 4), or range (e.g. 400-499)
  --filter-method <method>  HTTP method (GET, POST, …)
  --limit <n>               first n matching entries
  --full                    inline per-entry detail (headers, post data,
                            response body — escaped and capped); bodies are
                            never inlined without it

output:
  One <session-har id=… path=… source=live|bundle entries=… total=…> block,
  one row per entry: method, status, URL, body size, start time. The path
  attribute is the HAR file's absolute path — the full-fidelity pointer.
  --json mirrors the same fields. WebSockets opened while a command was
  recording appear as entries with _resourceType "websocket" and their frames
  in _webSocketMessages (capped at 200 frames/socket, 4KB/frame); sockets
  opened before recording started are not visible.

effects:
  None — reads recorded HAR data only.`;

const LOG_USAGE = `capture session log <path> [--name <label>] [--session <id>] — tail an external log file into a session's logs/ dir.

input:
  <path>          log file to follow (must exist)
  --name <label>  destination label; default is the source file's basename
  --session <id>  target session; defaults to the active session

output:
  One <log-tail session=… path=…> block: tailer name, source path, destination
  path, and tailer pid. --json mirrors the same fields.

effects:
  Spawns a detached tail process appending timestamped lines to the session's
  logs/<name>.log until \`session stop\` kills it; registers the tailer pid in
  the session metadata.`;

function printSessionHelp(): void {
  console.log(`capture session — the artifact container: opens a tab, records HAR, bundles every artifact.

An active session auto-targets its tab and auto-appends recorded traffic — no
--target/--har threading. \`stop\` finalizes the session and writes its bundle
manifest; \`view\` reads that manifest back.

  <subcommand name="start" args="[--url <url>] [--hold]" whenToUse="open a tab, start HAR, and set the active capture context"/>
  <subcommand name="stop" args="<session-id>" whenToUse="finalize the session and write its bundle manifest"/>
  <subcommand name="list" args="" whenToUse="show active and stopped sessions"/>
  <subcommand name="view" args="<session-id> [--filter shots|har|logs|measure|motion|other]" whenToUse="read back a stopped session's bundle manifest"/>
  <subcommand name="har" args="[<session-id>] [--filter-url <pattern>] [--filter-status <code>] [--filter-method <method>] [--limit <n>] [--full]" whenToUse="inspect recorded traffic — the live accumulating HAR of a running session or a stopped session's bundled har.json"/>
  <subcommand name="log" args="<path> [--name <label>] [--session <id>]" whenToUse="tail an external log file into the session's logs/ dir"/>

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

  return withLifecycleCoordinator(async () => {
    const active = getActiveSession();
    if (active && !isSessionStopped(active)) {
      emitResult({
        tag: 'error',
        attrs: { command: 'session start', code: 'start_failed' },
        summary: fact`A session is already active for this scope (${active.sessionId}); stop it first with \`session stop ${active.sessionId}\`.`,
        followUp: text`Only one live session is allowed per capture scope at a time.`,
      }, { json: parsed.json });
      process.exitCode = 1;
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
      const harResult = await createHarRecording(dir);
      harId = harResult.id;
    } catch (err) {
      console.error(`Warning: could not start HAR recording: ${err instanceof Error ? err.message : err}`);
    }

    let targetId: string | null = null;
    let pageLoadTimedOut = false;
    let bridgeSocket: string | null = null;
    let bridgePid: number | null = null;
    let cdpPort: number | null = null;

    try {
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
          await deleteHarRecording(harId);
        } catch {
          /* best effort */
        }
        try {
          unlinkPrivateFile(harId);
        } catch {
          /* best effort */
        }
      }
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
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
      sessionId: id,
      dir,
      harId,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      stopping: false,
      url,
      targetId,
      port: cdpPort,
      stepCount: 0,
      logPids: [],
      bridgeSocket,
      bridgePid,
    };
    await setActiveSession(session);

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
  });
}

async function logTail(parsed: ParsedArgs): Promise<void> {
  if (parsed.help) {
    console.log(LOG_USAGE);
    return;
  }

  const sourcePath = parsed.positional[0];
  if (!sourcePath) {
    emitResult({
      tag: 'error',
      attrs: { command: 'session log', code: 'missing_argument' },
      summary: fact`received: \`session log\`; expected: \`session log <path> [--name <label>] [--session <id>]\`.`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  const resolved = path.resolve(sourcePath);
  if (!fs.existsSync(resolved)) {
    emitResult({
      tag: 'error',
      attrs: { command: 'session log', code: 'log_file_not_found' },
      summary: fact`received: ${resolved}; expected an existing log file to follow.`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  let sessionId = parsed.session ?? null;
  if (!sessionId) {
    const active = getActiveSession();
    if (!active) {
      emitResult({
        tag: 'error',
        attrs: { command: 'session log', code: 'no_active_session' },
        summary: fact`received: \`session log\` with no --session and no active session; expected an active session or an explicit --session <id>.`,
        followUp: text`Run \`capture session start\` or pass --session <id> from \`capture session list\`.`,
      }, { json: parsed.json });
      process.exitCode = 1;
      return;
    }
    sessionId = active.sessionId;
  }

  let session: Session;
  try {
    session = readSession(sessionId);
  } catch {
    emitResult({
      tag: 'error',
      attrs: { command: 'session log', code: 'unknown_session' },
      summary: fact`No capture session found: ${sessionId}.`,
      followUp: text`Run \`capture session list\` to see known sessions.`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  const name = parsed.name ?? path.basename(resolved, path.extname(resolved));

  const logsDir = path.join(session.dir, 'logs');
  ensurePrivateDir(logsDir);

  const destPath = path.join(logsDir, `${name}.log`);
  const outFd = fs.openSync(destPath, 'a', FILE_MODE);
  fs.chmodSync(destPath, FILE_MODE);

  const child = spawn(
    'sh',
    // BEGIN{$|=1} autoflushes per line — without it perl block-buffers into
    // the file fd and a short-lived session's lines die in the buffer when
    // `session stop` SIGTERMs the tailer.
    ['-c', `tail -f "${resolved}" | perl -MPOSIX -ne 'BEGIN{$|=1} print strftime("%Y-%m-%dT%H:%M:%SZ",gmtime())." ".$_'`],
    { detached: true, stdio: ['ignore', outFd, 'ignore'] },
  );
  child.unref();
  fs.closeSync(outFd);

  const pid = child.pid!;
  const logPids = [...(session.logPids ?? []), { pid, name, sourcePath: resolved }];
  session = await updateSessionState(session.dir, { logPids });

  emitResult({
    tag: 'log-tail',
    attrs: { session: session.sessionId, path: destPath },
    summary: fact`Tailing ${resolved} into the session logs/ dir.`,
    sections: [lineList([
      fact`name: ${name}`,
      fact`source: ${resolved}`,
      fact`dest: ${destPath}`,
      fact`tailer pid: ${pid} — killed at \`session stop\``,
    ])],
  }, { json: parsed.json });
}

// ============================================================================
// session har — the session-owned HAR read surface (D4)
// ============================================================================

/** Matcher for `--filter-status`: exact code, prefix (e.g. `4`), or range (`400-499`). */
function statusMatcher(spec: string): (code: number) => boolean {
  if (/^\d+-\d+$/.test(spec)) {
    const [lo, hi] = spec.split('-').map((n) => parseInt(n, 10));
    return (c) => c >= lo && c <= hi;
  }
  if (/^\d+$/.test(spec)) {
    if (spec.length < 3) return (c) => String(c).startsWith(spec);
    const n = parseInt(spec, 10);
    return (c) => c === n;
  }
  return () => true;
}

interface HarSource {
  har: HarFile;
  /** Absolute HAR file path — the block's full-fidelity pointer. */
  path: string;
  source: 'live' | 'bundle';
}

/**
 * Locates a session's HAR data: the live accumulating recording while the
 * session runs, the bundled `har.json` once it is stopped. Returns an
 * `unavailable` reason instead of a source when the session has no readable
 * HAR (recording never started, or the file is gone).
 */
async function locateSessionHar(session: Session): Promise<HarSource | { unavailable: string }> {
  const stopped = fs.existsSync(path.join(session.dir, 'bundle.json'));
  if (stopped) {
    const harPath = path.join(session.dir, 'har.json');
    if (!fs.existsSync(harPath)) {
      return { unavailable: 'the stopped session bundled no HAR (recording never started or captured nothing)' };
    }
    return { har: JSON.parse(fs.readFileSync(harPath, 'utf-8')) as HarFile, path: harPath, source: 'bundle' };
  }
  if (!session.harId) {
    return { unavailable: 'the running session has no HAR recording (it could not be started with the session)' };
  }
  try {
    const live = await readHarRecording(session.harId);
    return { har: live, path: harFilePath(session.harId), source: 'live' };
  } catch {
    return { unavailable: `the live HAR recording file is missing: ${harFilePath(session.harId)}` };
  }
}

/** One selection-list row: method, status, URL, body size, start time. Body
 * content is NEVER inlined here (I-7) — `--full` is the only opt-in. */
function harEntryRow(e: HAREntry): FactLine {
  const bodyText = e.response.content?.text;
  const sizePart = typeof bodyText === 'string'
    ? fact`${Buffer.byteLength(bodyText, 'utf-8')} bytes`
    : text`body not captured`;
  return line(
    fact`${e.request.method} ${e.response.status} `,
    data(e.request.url, 300),
    text` — `,
    sizePart,
    fact` — started ${e.startedDateTime}`,
  );
}

/** `--full` inline detail for one entry: headers, post data, and response
 * body — every value escaped and capped through data()/fact. */
function harEntryDetail(e: HAREntry, index: number): FactLine {
  const rows: FactLine[] = [line(fact`${index + 1}. `, harEntryRow(e))];
  for (const h of e.request.headers ?? []) {
    rows.push(fact`   req ${h.name}: ${h.value}`);
  }
  if (e.request.postData?.text !== undefined) {
    rows.push(fact`   post data: ${capped(e.request.postData.text, 2000)}`);
  }
  for (const h of e.response.headers ?? []) {
    rows.push(fact`   res ${h.name}: ${h.value}`);
  }
  const bodyText = e.response.content?.text;
  rows.push(
    typeof bodyText === 'string'
      ? fact`   body: ${capped(bodyText, 2000)}`
      : text`   body: not captured`,
  );
  return lineList(rows);
}

async function har(parsed: ParsedArgs): Promise<void> {
  if (parsed.help) {
    console.log(HAR_USAGE);
    return;
  }

  let id = parsed.positional[0] ?? null;
  if (!id) {
    const active = getActiveSession();
    if (!active) {
      emitResult({
        tag: 'error',
        attrs: { command: 'session har', code: 'no_active_session' },
        summary: fact`received: \`session har\` with no <session-id> and no active session; expected an active session or an explicit session id.`,
        followUp: text`Run \`capture session list\` to find a session id.`,
      }, { json: parsed.json });
      process.exitCode = 1;
      return;
    }
    id = active.sessionId;
  }

  let session: Session;
  try {
    session = readSession(id);
  } catch {
    emitResult({
      tag: 'error',
      attrs: { command: 'session har', code: 'unknown_session' },
      summary: fact`No capture session found: ${id}.`,
      followUp: text`Run \`capture session list\` to see known sessions.`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  const located = await locateSessionHar(session);
  if ('unavailable' in located) {
    emitResult({
      tag: 'error',
      attrs: { command: 'session har', code: 'har_unavailable' },
      summary: fact`Session ${id} has no readable HAR: ${located.unavailable}.`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  let entries = located.har.log.entries;
  const total = entries.length;
  const filters: string[] = [];

  if (parsed.filterUrl) {
    const pattern = parsed.filterUrl;
    let re: RegExp | null = null;
    try { re = new RegExp(pattern, 'i'); } catch { re = null; }
    entries = entries.filter((e) =>
      re ? re.test(e.request.url) : e.request.url.toLowerCase().includes(pattern.toLowerCase()),
    );
    filters.push(`url~${pattern}`);
  }
  if (parsed.filterStatus) {
    const matches = statusMatcher(parsed.filterStatus);
    entries = entries.filter((e) => matches(e.response.status));
    filters.push(`status=${parsed.filterStatus}`);
  }
  if (parsed.filterMethod) {
    const m = parsed.filterMethod.toUpperCase();
    entries = entries.filter((e) => e.request.method.toUpperCase() === m);
    filters.push(`method=${m}`);
  }
  if (typeof parsed.limit === 'number' && parsed.limit > 0) {
    entries = entries.slice(0, parsed.limit);
    filters.push(`limit=${parsed.limit}`);
  }

  const summary = filters.length > 0
    ? fact`${entries.length} of ${total} entries match (${filters.join(', ')}).`
    : fact`${total} entries.`;

  const sections = parsed.full
    ? entries.map((e, i) => harEntryDetail(e, i))
    : [lineList(entries.map((e, i) => line(fact`${i + 1}. `, harEntryRow(e))))];

  emitResult({
    tag: 'session-har',
    attrs: {
      id,
      path: located.path,
      source: located.source,
      entries: entries.length,
      total,
    },
    summary,
    sections,
  }, { json: parsed.json });
}

function bundleRows(manifest: BundleManifest): FactLine[] {
  return [
    fact`shots: ${manifest.shots.length}`,
    manifest.har ? fact`har: ${manifest.har.entryCount} entries — ${manifest.har.path}` : fact`har: 0 entries`,
    fact`logs: ${manifest.logs.length}`,
    fact`measure snaps: ${manifest.snaps.length}`,
    fact`motion recs: ${manifest.recs.length}`,
    fact`other: ${manifest.other.length}`,
  ];
}

function emitStoppedFromManifest(id: string, sessionDir: string, manifest: BundleManifest, parsed: ParsedArgs): void {
  emitResult({
    tag: 'session-stopped',
    attrs: { id, path: path.join(sessionDir, 'bundle.json') },
    summary: fact`Session ${id} stopped after ${manifest.duration}ms; bundle manifest written.`,
    sections: [lineList(bundleRows(manifest))],
    followUp: fact`capture session view ${id}`,
  }, { json: parsed.json });
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

  return withLifecycleCoordinator(async () => {
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

    const stopAdmission = await beginSessionStop(session.dir);
    let committed = false;
    try {
      // A process waiting behind another stop must re-read finalized truth after
      // winning the per-session stop lock. Existing bundles are immutable.
      session = readSession(id);
      const bundlePath = path.join(session.dir, 'bundle.json');
      try {
        const manifest = JSON.parse(readPrivateFile(bundlePath).toString('utf-8')) as BundleManifest;
        // The bundle commit is authoritative even if the committing process
        // died before post-commit cleanup. Complete those idempotent steps
        // without ever replacing the immutable manifest.
        if (session.harId) {
          try { await deleteHarRecording(session.harId); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        await updateSessionState(session.dir, { stoppedAt: manifest.stoppedAt, stopping: false });
        clearActiveSessionIf(id);
        emitStoppedFromManifest(id, session.dir, manifest, parsed);
        committed = true;
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        if (session.stoppedAt) throw new Error(`finalized session ${id} is missing its immutable bundle`);
      }

      session = await updateSessionState(session.dir, { stopping: true });
      const stoppedAt = new Date().toISOString();
      const startMs = new Date(session.startedAt ?? stoppedAt).getTime();
      const duration = Date.now() - startMs;

      for (const lp of session.logPids ?? []) {
        try { process.kill(-lp.pid, 'SIGTERM'); } catch { /* already dead */ }
      }
      if (session.logPids?.length) await new Promise(resolve => setTimeout(resolve, 200));
      if (session.bridgePid || session.bridgeSocket) stopBridge(session.bridgePid, session.bridgeSocket);

      let recorderTeardown: Awaited<ReturnType<typeof teardownAnyLiveRecorderAtSessionStop>> | null = null;
      try {
        recorderTeardown = await teardownAnyLiveRecorderAtSessionStop(session.dir);
      } catch (error) {
        console.error(`Warning: could not finalize active recording: ${error instanceof Error ? error.message : error}`);
      }

      const shotsDir = path.join(session.dir, 'shots');
      const shots = fs.existsSync(shotsDir)
        ? fs.readdirSync(shotsDir).filter(name => name.endsWith('.png') || name.endsWith('.jpg')).map(name => ({ name, path: path.join(shotsDir, name) }))
        : [];

      let har: BundleManifest['har'] = null;
      if (session.harId) {
        const harData = await readHarRecording(session.harId);
        const harPath = path.join(session.dir, 'har.json');
        writeJsonPrivate(harPath, harData);
        har = { id: session.harId, path: harPath, entryCount: harData.log.entries.length };
      }

      const logsDir = path.join(session.dir, 'logs');
      const logs = fs.existsSync(logsDir)
        ? fs.readdirSync(logsDir).filter(name => name.endsWith('.log')).map(name => {
            const filePath = path.join(logsDir, name);
            const content = fs.readFileSync(filePath, 'utf-8');
            return { name, path: filePath, lines: content ? content.split('\n').filter(Boolean).length : 0 };
          })
        : [];
      const snaps = collectSnaps(session.dir);
      const recs = collectRecs(session.dir);
      const knownDirs = new Set(['shots', 'logs', 'measure', 'motion', '.har', '.stop.lock', '.operations.lock']);
      const knownFiles = new Set(['.session.json', '.operations.json', 'har.json', 'bundle.json', 'bridge.sock']);
      const other = fs.readdirSync(session.dir)
        .filter(name => !knownDirs.has(name) && !knownFiles.has(name))
        .map(name => ({ name, path: path.join(session.dir, name) }));

      const manifest: BundleManifest = {
        id: session.sessionId,
        startedAt: session.startedAt ?? '',
        stoppedAt,
        duration,
        url: session.url ?? null,
        shots,
        har,
        logs,
        other,
        snaps,
        recs,
        pendingViewportRestorations: recorderTeardown?.pendingViewportRestorations ?? [],
      };

      // The immutable bundle is the commit point. Live HAR deletion, stopped
      // metadata, and pointer compare-clear are strictly post-commit.
      writeJsonPrivate(bundlePath, manifest);
      if (session.harId) await deleteHarRecording(session.harId);
      await updateSessionState(session.dir, { stoppedAt, stopping: false });
      clearActiveSessionIf(id);
      committed = true;

      const rows = bundleRows(manifest);
      if (recorderTeardown && 'recId' in recorderTeardown) rows.push(fact`recorder ${recorderTeardown.recId} finalized — state ${recorderTeardown.state}, viewport restored ${String(recorderTeardown.viewportRestored)}`);
      if (recorderTeardown?.pendingViewportRestorations.length) rows.push(fact`pending viewport restorations: ${recorderTeardown.pendingViewportRestorations.length}`);
      emitResult({
        tag: 'session-stopped',
        attrs: { id, path: bundlePath },
        summary: fact`Session ${id} stopped after ${duration}ms; bundle manifest written.`,
        sections: [lineList(rows)],
        followUp: fact`capture session view ${id}`,
      }, { json: parsed.json });
    } catch (error) {
      try { await updateSessionState(session.dir, { stopping: false }); } catch { /* preserve stop failure */ }
      emitResult({
        tag: 'error',
        attrs: { command: 'session stop', code: 'stop_failed' },
        summary: fact`Session ${id} could not be stopped: ${error instanceof Error ? error.message : String(error)}`,
      }, { json: parsed.json });
      process.exitCode = 1;
    } finally {
      await stopAdmission.finish(committed);
    }
  });
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
          return { id: session.sessionId, startedAt: session.startedAt ?? '', url: session.url ?? null, status: hasBundled ? 'stopped' : 'active' };
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
    case 'har': return har(rest);
    case 'log': return logTail(rest);
    case undefined:
      printSessionHelp();
      return;
    default:
      emitResult({
        tag: 'error',
        attrs: { command: 'session', code: 'unknown_subcommand' },
        summary: fact`received: \`session ${leaf}\`; expected one of: start, stop, list, view, har, log.`,
        followUp: text`Run \`capture session -h\` for usage.`,
      }, { json: parsed.json });
      process.exitCode = 1;
      return;
  }
}
