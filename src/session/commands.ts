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
import { startBridge, stopBridge } from '../cdp/bridge/spawn.js';
import { teardownAnyLiveRecorderAtSessionStop } from '../cdp/motion/recorder.js';
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
  screenshots: Array<{ name: string; path: string }>;
  har: { id: string; path: string; entryCount: number } | null;
  a11y: Array<{ name: string; path: string }>;
  logs: Array<{ name: string; path: string; lines: number }>;
  other: Array<{ name: string; path: string }>;
  /** `measure snap` artifacts collected from `measure/snaps/{id}/meta.json`. */
  snaps: Array<{ id: string; path: string; url: string | null; viewport: string | null; settled: boolean; capturedAt: string }>;
  /** `motion rec` artifacts collected from `motion/recs/{id}/meta.json`. */
  recs: Array<{ id: string; path: string; action: string | null; frames: number; durationMs: number; state: string; viewportRestored: boolean | null }>;
  /** Retry outcomes for viewport obligations retained by failed recorder starts. */
  pendingViewportRestorations: Array<{ recId: string; viewportRestored: boolean | null }>;
}

function sessionDir(id: string): string {
  return path.join(CAPTURE_ROOT, id);
}

/** One-shot artifact session outside an active session — see `createOneshotSession`. */
export interface OneshotSession {
  /** `oneshot-{id}`; also the dir name under `CAPTURE_ROOT`. */
  id: string;
  /** `{CAPTURE_ROOT}/oneshot-{id}` */
  dir: string;
  kind: 'measure' | 'motion';
  /** `{dir}/measure/snaps` or `{dir}/motion/recs`, already created private. */
  artifactsDir: string;
}

/**
 * Creates the ephemeral artifact dir a URL-target `measure`/`motion` leaf
 * writes into when there is no active session: `oneshot-{id}/measure/snaps`
 * or `oneshot-{id}/motion/recs` under `CAPTURE_ROOT`. Holds only the one
 * subtree the caller needs — no HAR, no held bridge, no `.session.json` —
 * and is never registered as the active session. It is not bundled/torn
 * down by `session stop`; it accumulates under `/tmp` the same as any other
 * session dir until the OS reaps `/tmp`.
 */
export function createOneshotSession(kind: 'measure' | 'motion'): OneshotSession {
  const id = `oneshot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = sessionDir(id);
  const artifactsDir = kind === 'measure'
    ? path.join(dir, 'measure', 'snaps')
    : path.join(dir, 'motion', 'recs');
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

function printSessionHelp(): void {
  console.log(`capture session — manage capture sessions

Sub-commands:
  start [--url <url>] [--hold]    Start a session (opens tab, records HAR, sets active context)
                                   --hold keeps one CDP browser connection open for the session
  stop  <session-id>              Finalize and bundle artifacts (screenshots, HAR, a11y, logs)
  list                            List active and stopped sessions
  view  <id> [--filter section]   View bundle manifest; section = screenshots|har|a11y|logs|measure|motion
                                   measure -> manifest.snaps, motion -> manifest.recs

Why sessions: once started, every subsequent capture command auto-fills
--target (the tab) and --har (the recording). No manual flag threading.

Typical flow:
  1. capture session start --url http://localhost:3000
  2. Interact — no --target / --har needed:
       capture a11y --interactive
       capture click "Sign in"
       capture type "hi@me.com" --into "Email"
       capture screenshot
       capture navigate https://app.example.com/dashboard
       capture har read --filter-url /api
  3. capture session stop <session-id>
  4. capture session view <session-id>

--hold: keeps one CDP browser connection open for the session's lifetime, so
browser-level state (Browser.grantPermissions, ServiceWorker.enable, ...)
survives across separate commands instead of reverting the instant each
command's own connection closes. Use it together with \`capture cdp --browser\`:

  capture session start --url http://localhost:3000 --hold
  capture cdp Browser.grantPermissions --browser --params '{"origin":"http://localhost:3000","permissions":["notifications"]}'
  capture cdp ServiceWorker.enable --browser --target <pageTabId>
  capture cdp ServiceWorker.deliverPushMessage --browser --target <pageTabId> --params '{...}'
  capture session stop <session-id>   # also tears down the held connection

Related:  capture log <path> [--name label]   Tail a log into the active session
See also: capture --help                      Full command list`);
}

// ============================================================================
// Session Commands
// ============================================================================

async function start(rawArgs: string[]): Promise<void> {
  const args = expandEqualsFlags(rawArgs);
  let url: string | null = null;
  let hold = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      url = args[++i];
    } else if (args[i] === '--hold') {
      hold = true;
    }
  }

  const id = generateId();
  const dir = sessionDir(id);
  ensurePrivateDir(path.join(dir, 'shots'));
  ensurePrivateDir(path.join(dir, 'a11y'));

  // Start HAR recording directly
  let harId: string | null = null;
  try {
    const harResult = createHarRecording();
    harId = harResult.id;
  } catch (err) {
    console.error(`Warning: could not start HAR recording: ${err instanceof Error ? err.message : err}`);
  }

  // Open tab if URL provided. Fail fast if the new target cannot attach.
  let targetId: string | null = null;
  let pageLoadTimedOut = false;
  let cdpPort: number | null = null;
  if (url || hold) {
    const { detectCdpPort } = await import('../cdp.js');
    cdpPort = await detectCdpPort();
  }
  if (url) {
    try {
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
    } catch (err) {
      if (harId) {
        try {
          deleteHarRecording(harId);
        } catch {
          /* best effort */
        }
      }
      throw err;
    }
  }

  // Hold a CDP browser connection open for the session's lifetime so
  // browser-level state (permission grants, ServiceWorker enablement)
  // survives across separate `capture` commands instead of reverting the
  // instant each command's own connection closes.
  let bridgeSocket: string | null = null;
  let bridgePid: number | null = null;
  if (hold) {
    try {
      const bridge = await startBridge(dir, cdpPort!);
      bridgeSocket = bridge.socketPath;
      bridgePid = bridge.pid;
    } catch (err) {
      if (harId) {
        try {
          deleteHarRecording(harId);
        } catch {
          /* best effort */
        }
      }
      throw err;
    }
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

  // Set as active session for auto-defaults
  setActiveSession({
    sessionId: id,
    dir,
    harId,
    targetId,
    cdpPort,
    stepCount: 0,
    bridgeSocket,
  });

  // Output for agent consumption
  const result = {
    sessionId: id,
    bundleDir: dir,
    harId,
    targetId,
    cdpPort,
    pageLoadTimedOut,
    shotsDir: path.join(dir, 'shots'),
    a11yDir: path.join(dir, 'a11y'),
    held: hold,
  };
  console.log(JSON.stringify(result, null, 2));

  // Agent-friendly next steps on stderr
  console.error(`\nCapture session started: ${id}`);
  if (targetId) {
    console.error(`Tab opened — session context active. No need to pass --target or --har.`);
    if (pageLoadTimedOut) {
      console.error(`Page load timed out, but the session is attached to target ${targetId.slice(0, 8)}. Use \`capture exec --target ${targetId.slice(0, 8)}\` or \`capture list\` if you need to recover it.`);
    }
  }
  if (hold) {
    console.error(`CDP bridge held (pid ${bridgePid}) — browser-level state now survives across commands via: capture cdp <Method> --browser [--params '<json>']`);
  }
  console.error(`\nWhen done: capture session stop ${id}`);
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

  console.log(JSON.stringify({ name, sourcePath: resolved, destPath, pid }, null, 2));
}

async function stop(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error('Usage: capture session stop <session-id>');
    process.exit(1);
  }

  const session = readSession(id);
  const stoppedAt = new Date().toISOString();
  const startMs = new Date(session.startedAt).getTime();
  const duration = Date.now() - startMs;

  // Kill log tailers
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

  // Collect screenshots
  const shotsDir = path.join(session.dir, 'shots');
  const screenshots = fs.existsSync(shotsDir)
    ? fs.readdirSync(shotsDir)
        .filter((f) => f.endsWith('.png') || f.endsWith('.jpg'))
        .map((f) => ({ name: f, path: path.join(shotsDir, f) }))
    : [];

  // Collect a11y snapshots
  const a11yDir = path.join(session.dir, 'a11y');
  const a11y = fs.existsSync(a11yDir)
    ? fs.readdirSync(a11yDir)
        .filter((f) => f.endsWith('.json') || f.endsWith('.txt'))
        .map((f) => ({ name: f, path: path.join(a11yDir, f) }))
    : [];

  // Collect HAR directly from har-manager
  let har: BundleManifest['har'] = null;
  if (session.harId) {
    try {
      const harData = readHarRecording(session.harId);
      if (harData) {
        const harPath = path.join(session.dir, 'har.json');
        writeJsonPrivate(harPath, harData);
        har = { id: session.harId, path: harPath, entryCount: harData.log.entries.length };
        // Clean up the HAR recording
        try { deleteHarRecording(session.harId); } catch { /* best effort */ }
      }
    } catch (err) {
      console.error(`Warning: could not read HAR: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Collect log files
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

  // Collect measure snapshots and motion recordings
  const snaps = collectSnaps(session.dir);
  const recs = collectRecs(session.dir);

  // Collect anything else dropped in the session dir
  const knownDirs = new Set(['shots', 'a11y', 'logs', 'measure', 'motion']);
  const knownFiles = new Set(['.session.json', 'har.json', 'bundle.json', 'bridge.sock']);
  const other = fs.readdirSync(session.dir)
    .filter((f) => !knownDirs.has(f) && !knownFiles.has(f))
    .map((f) => ({ name: f, path: path.join(session.dir, f) }));

  // Clear active session context
  clearActiveSession();

  const manifest: BundleManifest = {
    id: session.id,
    startedAt: session.startedAt,
    stoppedAt,
    duration,
    url: session.url,
    screenshots,
    har,
    a11y,
    logs,
    other,
    snaps,
    recs,
    pendingViewportRestorations: recorderTeardown?.pendingViewportRestorations ?? [],
  };

  const bundlePath = path.join(session.dir, 'bundle.json');
  writeJsonPrivate(bundlePath, manifest);

  console.log(JSON.stringify({
    bundlePath,
    summary: {
      duration,
      screenshots: screenshots.length,
      harEntries: har?.entryCount ?? 0,
      a11ySnapshots: a11y.length,
      logFiles: logs.length,
      otherFiles: other.length,
      snaps: snaps.length,
      recs: recs.length,
      ...(recorderTeardown && !('recording' in recorderTeardown) ? { recording: { recId: recorderTeardown.recId, state: recorderTeardown.state, viewportRestored: recorderTeardown.viewportRestored } } : {}),
      ...(recorderTeardown?.pendingViewportRestorations.length ? { pendingViewportRestorations: recorderTeardown.pendingViewportRestorations } : {}),
    },
  }, null, 2));

  console.error(`\nBundle written: ${bundlePath}`);
  console.error(`Read it: capture session view ${id}`);
}

function list(): void {
  if (!fs.existsSync(CAPTURE_ROOT)) {
    console.log('[]');
    return;
  }

  const sessions = fs.readdirSync(CAPTURE_ROOT)
    .filter((d) => fs.existsSync(sessionMetaPath(d)))
    .map((d) => {
      const session = readSession(d);
      const hasBundled = fs.existsSync(path.join(session.dir, 'bundle.json'));
      return { id: session.id, startedAt: session.startedAt, url: session.url, status: hasBundled ? 'stopped' : 'active' };
    });

  console.log(JSON.stringify(sessions, null, 2));
}

// `session view --filter <name>` reads a manifest section by the same key
// name for most sections (screenshots|har|a11y|logs|other), but `measure`
// and `motion` are the query-facing filter names for the `snaps`/`recs`
// manifest keys (matching the `measure`/`motion` command branches, not the
// artifact-file naming), so they need an explicit alias.
const VIEW_FILTER_ALIASES: Record<string, keyof BundleManifest> = {
  measure: 'snaps',
  motion: 'recs',
};

function view(rawArgs: string[]): void {
  const args = expandEqualsFlags(rawArgs);
  const id = args[0];
  if (!id) {
    console.error('Usage: capture session view <session-id> [--filter screenshots|har|a11y|logs|other|measure|motion]');
    process.exit(1);
  }

  const session = readSession(id);
  const bundlePath = path.join(session.dir, 'bundle.json');

  if (!fs.existsSync(bundlePath)) {
    console.error(`Session ${id} hasn't been stopped yet. Run: capture session stop ${id}`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(bundlePath, 'utf-8')) as BundleManifest;

  const filter = args.find((_, i) => args[i - 1] === '--filter');
  if (filter) {
    const key = VIEW_FILTER_ALIASES[filter] ?? (filter as keyof BundleManifest);
    const section = manifest[key];
    console.log(JSON.stringify(section, null, 2));
  } else {
    console.log(JSON.stringify(manifest, null, 2));
  }
}

export async function sessionMain(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  if (!subcommand || hasHelpFlag(args)) {
    printSessionHelp();
    return;
  }

  switch (subcommand) {
    case 'start': return start(rest);
    case 'stop': return stop(rest);
    case 'list': return list();
    case 'view': return view(rest);
    default:
      printSessionHelp();
  }
}
