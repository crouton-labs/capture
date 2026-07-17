import * as fs from 'fs';
import * as path from 'path';
import {
  createHarRecording,
  readHarRecording,
  deleteHarRecording,
  harFilePath,
  validateHarFile,
  type HarFile,
  type HAREntry,
} from '../har-manager.js';
import {
  getActiveSession,
  setActiveSession,
  clearActiveSessionIf,
  updateSessionState,
  isActiveStateCandidate,
  type ActiveSessionState,
} from '../session-context.js';
import { type ParsedArgs, type CDPTarget } from '../cdp/types.js';
import { startBridge, stopBridge } from '../cdp/bridge/spawn.js';
import { normalizeFailure, failureResult, captureError, worldFailure } from '../errors.js';
import {
  startSessionLogTailer,
  stopSessionLogTailers,
} from './log-tailer.js';
import { teardownAnyLiveRecorderAtSessionStop, isTerminalRecStopFailure } from '../cdp/motion/recorder.js';
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
  MAX_LOG_LABEL_BYTES,
  acquirePrivateLock,
  ensurePrivateDir,
  rejectLogLabel,
  writeJsonPrivate,
  readPrivateFile,
  removeArtifactTree,
  type SnapMeta,
  type RecMeta,
} from './artifacts.js';
import { beginSessionStop, admitSessionOperation, withSessionLifecycle } from './coordinator.js';
import { parseStatusFilter, type StatusPredicate } from './har-filter.js';

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

function isNamedPathEntry(value: unknown): value is { name: string; path: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === 'string' && typeof record.path === 'string';
}

/** The one schema check for a persisted `bundle.json` manifest. A manifest is
 * committed once and immutable, so any record failing this shape was written
 * by an incompatible version or corrupted — never something to structurally
 * trust into the renderer. */
function isBundleManifest(value: unknown): value is BundleManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const validHar = record.har === null
    || (!!record.har && typeof record.har === 'object' && !Array.isArray(record.har)
      && typeof (record.har as Record<string, unknown>).id === 'string'
      && typeof (record.har as Record<string, unknown>).path === 'string'
      && typeof (record.har as Record<string, unknown>).entryCount === 'number');
  return typeof record.id === 'string'
    && typeof record.startedAt === 'string'
    && typeof record.stoppedAt === 'string'
    && typeof record.duration === 'number'
    && (record.url === null || typeof record.url === 'string')
    && Array.isArray(record.shots) && record.shots.every(isNamedPathEntry)
    && validHar
    && Array.isArray(record.logs) && record.logs.every(item => isNamedPathEntry(item) && typeof (item as unknown as Record<string, unknown>).lines === 'number')
    && Array.isArray(record.other) && record.other.every(isNamedPathEntry)
    && Array.isArray(record.snaps) && record.snaps.every(item => !!item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string' && typeof (item as Record<string, unknown>).path === 'string')
    && Array.isArray(record.recs) && record.recs.every(item => !!item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string' && typeof (item as Record<string, unknown>).path === 'string')
    && Array.isArray(record.pendingViewportRestorations);
}

/** Reads and VALIDATES one immutable `bundle.json`. The read is contained and
 * no-follow (`readPrivateFile`); ENOENT propagates for callers that treat a
 * missing bundle as "not stopped yet". Unparsable bytes or a schema failure
 * throw a typed `invalid_bundle_manifest` artifact error instead of letting a
 * structurally-trusted cast reach the renderer. */
function readBundleManifest(bundlePath: string): BundleManifest {
  const raw = readPrivateFile(bundlePath).toString('utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw captureError('artifact', 'invalid_bundle_manifest', `bundle manifest at ${bundlePath} is not valid JSON; the record is corrupt and cannot be read as a capture bundle.`, cause);
  }
  if (!isBundleManifest(parsed)) {
    throw captureError('artifact', 'invalid_bundle_manifest', `bundle manifest at ${bundlePath} does not match the capture bundle schema; it was written by an incompatible version or corrupted.`);
  }
  return parsed;
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

/**
 * Reads and VALIDATES one persisted `.session.json`. A missing file throws a
 * typed `unknown_session` precondition error (leaf catch-alls emit it as
 * `unknown_session`); unparsable bytes or a record failing the shared
 * `isActiveStateCandidate` schema throw a typed `invalid_session_record`
 * artifact error instead of letting a structurally-trusted cast reach the
 * renderer (where a legacy-schema record used to crash `session list`
 * unbranded via `fact` interpolation of undefined fields).
 */
function readSession(id: string): Session {
  const metaPath = sessionMetaPath(id);
  let raw: string;
  try {
    raw = readPrivateFile(metaPath).toString('utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw captureError('precondition', 'unknown_session', `No capture session found: ${id}`);
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw captureError('artifact', 'invalid_session_record', `session metadata at ${metaPath} is not valid JSON; the record is corrupt and cannot be read as a capture session.`, cause);
  }
  if (!isActiveStateCandidate(parsed)) {
    throw captureError('artifact', 'invalid_session_record', `session metadata at ${metaPath} does not match the capture session record schema; it was written by an incompatible version or corrupted.`);
  }
  return parsed;
}

function generateId(): string {
  return `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** A fresh target must acknowledge Page.enable promptly. Target.createTarget
 * already succeeded; waiting a full CDP request timeout here only postpones a
 * failed session start before it can publish or roll back its target. */
export const SESSION_TAB_ATTACH_TIMEOUT_MS = 5_000;

export async function waitForPageLoad(
  client: { waitReady(): Promise<void>; send(method: string, params?: Record<string, unknown>, timeout?: number): Promise<unknown>; on(event: string, handler: (params: unknown) => void): void; },
  timeoutMs: number,
  attachTimeoutMs = SESSION_TAB_ATTACH_TIMEOUT_MS,
): Promise<boolean> {
  await client.waitReady();
  await client.send('Page.enable', {}, attachTimeoutMs);

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
  --filter-status <spec>    exact status (100-599), one-digit class prefix
                            (1-5, e.g. 4 = every 4xx), or ordered range
                            (e.g. 400-499); any other token is invalid_filter
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
  <path>          log file to follow (must exist). Any filename is accepted — it
                  is only ever passed to \`tail\` as an argv element, never a shell.
  --name <label>  destination label; default is the source file's basename. One
                  bounded path component: no \`/\`, no \`.\`/\`..\`, no NUL, ≤ ${MAX_LOG_LABEL_BYTES} bytes.
  --session <id>  target session; defaults to the active session

output:
  One <log-tail session=… path=…> block: tailer name, source path, destination
  path, and tailer pid. --json mirrors the same fields.

effects:
  Self-spawns one detached, identity-owned worker (its own process group) that
  runs \`tail -f\` and appends ISO-8601-timestamped lines to the session's
  contained logs/<name>.log. \`session stop\` drains it over its nonce-authenticated
  control socket so its buffered output lands before the bundle is committed;
  the identity-bearing tailer record is registered in the session metadata.`;

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

/**
 * The external effects `session start` acquires, behind one seam so the
 * transaction's acquisition/rollback ordering is testable with deterministic
 * fakes instead of a real browser. The default (`productionStartWorld`) wires
 * these to the real CDP layer.
 */
export interface SessionStartWorld {
  createHar(dir: string): Promise<string>;
  deleteHar(harId: string): Promise<void>;
  detectCdpPort(): Promise<number>;
  openTab(port: number, url: string): Promise<CDPTarget>;
  closeTarget(port: number, targetId: string): Promise<void>;
  /** Attach to the freshly-opened tab and wait for load; returns page-load-timed-out. */
  awaitTabReady(target: CDPTarget, url: string): Promise<boolean>;
  startBridge(dir: string, port: number): Promise<{ socketPath: string; pid: number }>;
  stopBridge(pid: number | null, socketPath: string | null): void;
  publishActiveSession(session: Session): Promise<void>;
}

const productionStartWorld: SessionStartWorld = {
  async createHar(dir) {
    return (await createHarRecording(dir)).id;
  },
  deleteHar: deleteHarRecording,
  async detectCdpPort() {
    const { detectCdpPort } = await import('../cdp.js');
    return detectCdpPort();
  },
  async openTab(port, url) {
    const { openTab } = await import('../cdp.js');
    return openTab(port, url);
  },
  async closeTarget(port, targetId) {
    const { closeTarget } = await import('../cdp/targets.js');
    return closeTarget(port, targetId);
  },
  async awaitTabReady(target, url) {
    if (!target.webSocketDebuggerUrl) {
      throw worldFailure(`capture session start could not attach to ${url}: missing WebSocket debugger URL. Reuse an existing tab with --target.`);
    }
    const { CDPClient } = await import('../cdp.js');
    const client = new CDPClient(target.webSocketDebuggerUrl);
    try {
      try {
        await client.send('Runtime.enable', {}, 5_000);
      } catch (err) {
        throw worldFailure(`capture session start could not attach to ${url}: ${err instanceof Error ? err.message : err}. Reuse an existing tab with --target.`, err);
      }
      try {
        return await waitForPageLoad(client, 10_000);
      } catch (err) {
        throw worldFailure(
          `capture session start could not attach to ${url}: Page.enable failed during its ${SESSION_TAB_ATTACH_TIMEOUT_MS}ms attachment window (${err instanceof Error ? err.message : err}). The CDP endpoint created the tab but cannot drive it; choose another endpoint from \`capture tab list\` and retry with \`--port\`.`,
          err,
        );
      }
    } finally {
      client.close();
    }
  },
  startBridge,
  stopBridge,
  publishActiveSession: setActiveSession,
};

let startWorld: SessionStartWorld = productionStartWorld;

/** Test seam: swap the effect world session start drives; pass nothing to restore production. */
export function __setSessionStartWorld(next?: Partial<SessionStartWorld>): void {
  startWorld = next ? { ...productionStartWorld, ...next } : productionStartWorld;
}

/**
 * Exact leaf positional cardinality, enforced at the leaf boundary BEFORE any
 * filesystem/process/session effect (m7). The CLI validator in
 * `src/cdp/args.ts` rejects the same shapes at the entrypoint; this wall
 * covers the direct-call seam so surplus positionals are never silently
 * ignored. Missing-argument rejection stays with each leaf's existing
 * `missing_argument` check. Returns true when the invocation was rejected.
 */
function rejectSurplusPositionals(parsed: ParsedArgs, leaf: string, max: number, usage: string): boolean {
  const count = parsed.positional.length;
  if (count <= max) return false;
  const expected = max === 0 ? 'exactly 0' : max === 1 ? 'at most 1' : `at most ${max}`;
  emitResult({
    tag: 'error',
    attrs: { command: `session ${leaf}`, code: 'invalid_input' },
    summary: fact`received: ${count} positional argument(s); expected ${expected} — \`${usage}\`.`,
  }, { json: parsed.json });
  process.exitCode = 1;
  return true;
}

/** One acquired resource: a label plus its reverse-order release. */
interface Acquisition {
  label: string;
  release(): Promise<void> | void;
}

async function start(parsed: ParsedArgs): Promise<void> {
  if (parsed.help) {
    console.log(START_USAGE);
    return;
  }

  if (rejectSurplusPositionals(parsed, 'start', 0, 'capture session start [--url <url>] [--hold]')) return;

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

    // Every effect below is owned the instant it succeeds and released in exact
    // reverse order if any later step throws. Nothing is committed outside this
    // one transaction, so a failure leaves the scope byte-identical to before.
    const acquired: Acquisition[] = [];
    let harId: string | null = null;
    let target: CDPTarget | null = null;
    let pageLoadTimedOut = false;
    let bridgeSocket: string | null = null;
    let bridgePid: number | null = null;
    let cdpPort: number | null = null;

    try {
      ensurePrivateDir(path.join(dir, 'shots'));
      acquired.push({ label: 'artifact tree', release: () => removeArtifactTree(dir) });

      harId = await startWorld.createHar(dir);
      const acquiredHarId = harId;
      acquired.push({ label: 'HAR recording', release: () => startWorld.deleteHar(acquiredHarId) });

      if (url || hold) {
        cdpPort = parsed.port ?? await startWorld.detectCdpPort();
      }

      if (url) {
        target = await startWorld.openTab(cdpPort!, url);
        const openedPort = cdpPort!;
        const openedTargetId = target.id;
        acquired.push({ label: 'opened target', release: () => startWorld.closeTarget(openedPort, openedTargetId) });
        pageLoadTimedOut = await startWorld.awaitTabReady(target, url);
      }

      // Hold a CDP browser connection open for the session's lifetime so
      // browser-level state (permission grants, ServiceWorker enablement)
      // survives across separate `capture` commands instead of reverting the
      // instant each command's own connection closes.
      if (hold) {
        const bridge = await startWorld.startBridge(dir, cdpPort!);
        bridgeSocket = bridge.socketPath;
        bridgePid = bridge.pid;
        acquired.push({ label: 'held bridge', release: () => startWorld.stopBridge(bridgePid, bridgeSocket) });
      }

      const session: Session = {
        sessionId: id,
        dir,
        harId,
        startedAt: new Date().toISOString(),
        stoppedAt: null,
        stopping: false,
        url,
        targetId: target?.id ?? null,
        port: cdpPort,
        stepCount: 0,
        logPids: [],
        bridgeSocket,
        bridgePid,
      };
      // The active index + `.session.json` are published together (last).
      // Its rollback is a scope-owned compare-clear: a no-op unless THIS
      // attempt's publication actually landed.
      acquired.push({ label: 'active publication', release: () => clearActiveSessionIf(id) });
      await startWorld.publishActiveSession(session);
    } catch (primary) {
      await rollbackStart(acquired, parsed, primary);
      return;
    }

    const rows: FactLine[] = [fact`bundle dir: ${dir}`];
    if (target) rows.push(fact`tab ${target.id} opened at ${url ?? ''}`);
    if (pageLoadTimedOut) rows.push(fact`page load timed out after 10000ms; the session stays attached to target ${target?.id ?? ''}`);
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

/**
 * Releases every acquired resource in exact reverse order, then renders the
 * primary start failure. Cleanup failures never replace the primary error —
 * they are aggregated onto it so both survive.
 */
async function rollbackStart(acquired: Acquisition[], parsed: ParsedArgs, primary: unknown): Promise<void> {
  const cleanupFailures: string[] = [];
  for (let i = acquired.length - 1; i >= 0; i -= 1) {
    try {
      await acquired[i].release();
    } catch (error) {
      cleanupFailures.push(`${acquired[i].label}: ${normalizeFailure(error).descriptor.message}`);
    }
  }

  const primaryMessage = normalizeFailure(primary).descriptor.message;
  const summary = cleanupFailures.length === 0
    ? fact`Session could not start: ${primaryMessage}`
    : fact`Session could not start: ${primaryMessage} (rollback also failed: ${cleanupFailures.join('; ')})`;

  emitResult({
    tag: 'error',
    attrs: { command: 'session start', code: 'start_failed' },
    summary,
    followUp: text`Ensure a CDP-enabled browser is running — \`capture tab list\` is the probe.`,
  }, { json: parsed.json });
  process.exitCode = 1;
}

// ============================================================================
// session log — shell-free, contained, identity-owned log tailing (C2)
// ============================================================================

async function logTail(parsed: ParsedArgs): Promise<void> {
  if (parsed.help) {
    console.log(LOG_USAGE);
    return;
  }

  if (rejectSurplusPositionals(parsed, 'log', 1, 'capture session log <path> [--name <label>] [--session <id>]')) return;

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

  const source = path.resolve(sourcePath);
  const name = parsed.name ?? path.basename(source, path.extname(source));
  const labelReason = rejectLogLabel(name);
  if (labelReason) {
    const labelHint = parsed.name === undefined && labelReason === `exceeds ${MAX_LOG_LABEL_BYTES} bytes`
      ? ' Pass `--name <short>` to choose a shorter destination label.'
      : '';
    emitResult({
      tag: 'error',
      attrs: { command: 'session log', code: 'invalid_label' },
      summary: fact`invalid destination label (${labelReason}); expected one bounded filename component.${labelHint}`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  // Source symlinks are valid caller selections; the path is passed only as one
  // argv element to `tail` after the worker's `--` option terminator.
  if (!fs.existsSync(source)) {
    emitResult({
      tag: 'error',
      attrs: { command: 'session log', code: 'log_file_not_found' },
      summary: fact`received: ${source}; expected an existing log file to follow.`,
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

  // Finalized truth is checked before operation admission, directory creation,
  // descriptor open, process spawn, socket creation, or metadata replacement.
  if (isSessionStopped(session)) {
    emitResult({
      tag: 'error',
      attrs: { command: 'session log', code: 'session_stopped' },
      summary: fact`session ${session.sessionId} is finalized; its bundle is immutable and cannot accept a new log tailer.`,
    }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }

  const operation = await admitSessionOperation(session.dir);
  try {
    const result = await withSessionLifecycle(session.dir, async () => startSessionLogTailer({
      sessionDir: session.dir,
      sourcePath: source,
      name,
      register: async record => {
        const current = readSession(session.sessionId);
        await updateSessionState(session.dir, {
          logPids: [...(current.logPids ?? []), record],
        });
      },
      unregister: async record => {
        const current = readSession(session.sessionId);
        await updateSessionState(session.dir, {
          logPids: (current.logPids ?? []).filter(entry => entry.nonce !== record.nonce || entry.pid !== record.pid),
        });
      },
    }));

    emitResult({
      tag: 'log-tail',
      attrs: { session: session.sessionId, path: result.destPath },
      summary: fact`Tailing ${source} into the session logs/ dir.`,
      sections: [lineList([
        fact`name: ${name}`,
        fact`source: ${source}`,
        fact`dest: ${result.destPath}`,
        fact`tailer pid: ${result.pid} — drained at \`session stop\``,
      ])],
    }, { json: parsed.json });
  } catch (error) {
    emitResult(failureResult(error), { json: parsed.json });
    process.exitCode = 1;
  } finally {
    await operation.release();
  }
}

// ============================================================================
// session har — the session-owned HAR read surface (D4)
// ============================================================================

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
    let raw: string;
    try {
      raw = readPrivateFile(harPath).toString('utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { unavailable: 'the stopped session bundled no HAR (recording never started or captured nothing)' };
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw captureError('artifact', 'invalid_har_file', `bundled HAR at ${harPath} is not valid JSON; the record is corrupt and cannot be read as a HAR file.`, cause);
    }
    return { har: validateHarFile(parsed, `bundled HAR ${harPath}`), path: harPath, source: 'bundle' };
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

  if (rejectSurplusPositionals(parsed, 'har', 1, 'capture session har [<session-id>] [--filter-status <spec>] …')) return;

  // Leaf-local filter grammar parses BEFORE any session/HAR lookup (M9/A4):
  // an invalid --filter-status wins over an unknown session or a corrupt/
  // missing artifact, and the active-session index is never consulted for it.
  let statusMatch: StatusPredicate | null = null;
  if (parsed.filterStatus !== undefined) {
    try {
      statusMatch = parseStatusFilter(parsed.filterStatus);
    } catch (error) {
      const { descriptor } = normalizeFailure(error);
      emitResult({
        tag: 'error',
        attrs: { command: 'session har', code: descriptor.code },
        summary: fact`${descriptor.message}`,
      }, { json: parsed.json });
      process.exitCode = 1;
      return;
    }
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
  if (statusMatch) {
    const matches = statusMatch;
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

  if (rejectSurplusPositionals(parsed, 'stop', 1, 'capture session stop <session-id>')) return;

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
        const manifest = readBundleManifest(bundlePath);
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

      // Drain/terminate every registered log tailer identity-first BEFORE the
      // bundle is committed: a live writer into logs/ would falsify the immutable
      // bundle. A verified-alive tailer that cannot be drained or terminated
      // throws here and fails the stop, preserving the failure.
      await stopSessionLogTailers(session.logPids ?? []);
      if (session.bridgePid || session.bridgeSocket) stopBridge(session.bridgePid, session.bridgeSocket);

      let recorderTeardown: Awaited<ReturnType<typeof teardownAnyLiveRecorderAtSessionStop>> | null = null;
      try {
        recorderTeardown = await teardownAnyLiveRecorderAtSessionStop(session.dir);
      } catch (error) {
        // A terminal `rec-stop` failure (the bridge authenticated the request
        // and explicitly refused — e.g. a fatal HAR drain) must NOT be
        // swallowed into a warning: it escapes to the outer `stop_failed`
        // lane below, so no bundle is committed and no live HAR/recorder
        // handle is deleted while admitted append work may still be lost.
        // Non-fatal teardown noise (dead handle, liveness-unknown, malformed
        // handle) keeps the existing warn-and-continue policy.
        if (isTerminalRecStopFailure(error)) throw error;
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

  if (rejectSurplusPositionals(parsed, 'list', 0, 'capture session list')) return;

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

  if (rejectSurplusPositionals(parsed, 'view', 1, 'capture session view <session-id> [--filter <section>]')) return;

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
  let manifest: BundleManifest;
  try {
    manifest = readBundleManifest(bundlePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      emitResult({
        tag: 'error',
        attrs: { command: 'session view', code: 'session_not_stopped' },
        summary: fact`Session ${id} has not been stopped; there is no bundle manifest yet.`,
        followUp: fact`capture session stop ${id}`,
      }, { json: parsed.json });
      process.exitCode = 1;
      return;
    }
    throw error;
  }

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
