/**
 * The browsers capture itself starts, and the only place capture is allowed to
 * signal one.
 *
 * capture's whole surface attaches to a CDP endpoint it does not own, so before
 * this module the only way to get an endpoint was to hand-roll a detached
 * Chrome (`chrome --remote-debugging-port=9334 --user-data-dir=/tmp/whatever &`)
 * with an invented port and an invented scratch profile. Nothing reaped those:
 * the spawning shell exits, the browser is detached, and it survives — one
 * ~1GB resident orphan per agent turn, forever.
 *
 * `capture tab launch` replaces that with a browser capture owns end to end: a
 * profile under `CAPTURE_ROOT`, a kernel-chosen free port, and a registry
 * record naming the pid it started. Ownership is the whole point of the
 * module, so it is enforced structurally, not by convention:
 *
 *   - Capture signals a process ONLY when a registry record names it AND the
 *     live PID-birth identity still matches the recorded one (`sameBirth`, the
 *     same gate the private-lock owner check uses). A recycled pid can never
 *     make capture kill a stranger's process.
 *   - An endpoint reached with `--port` — the user's own CDP-enabled browser,
 *     or anything a previous agent started by hand — has no record here, so it
 *     is never swept, never signalled, and never cleaned up. Attaching to a
 *     browser capture did not start behaves exactly as it always has.
 *
 * Reaping has no daemon behind it. Three paths cover the lifecycle:
 *   1. `tab quit` — explicit, immediate.
 *   2. a launch that never reports readiness reaps the child it just spawned
 *      before it throws (the discipline `bridge/spawn.ts` already models).
 *   3. `sweepOwnedBrowsers()`, run at the top of `tab launch`, `tab list`, and
 *      `tab quit` — drops records whose process is gone, and kills owned
 *      browsers that are unusable (endpoint unreachable) or idle past
 *      `IDLE_REAP_MS`. `tab list` is the probe agents already run constantly,
 *      so an abandoned browser is reaped by the next agent through the door
 *      rather than living until reboot.
 */

import { execFileSync, spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CaptureError, captureError } from '../errors.js';
import { CDP_LOOPBACK_HOST } from './loopback.js';
import {
  CAPTURE_ROOT,
  assertUnderCaptureRoot,
  ensurePrivateDir,
  exactKeys,
  parseBirth,
  processPidBirthProvider,
  readPrivateFile,
  sameBirth,
  unlinkPrivateFile,
  writeJsonPrivate,
  type PidBirth,
} from '../session/artifacts.js';

/** How long an owned browser may sit unused before a sweep reaps it. Documented
 * in `capture tab launch -h`; deliberately a constant, not a flag — a knob here
 * would just be one more thing for a caller to get wrong, and an explicit
 * `capture tab quit` is always available for a shorter life. */
export const IDLE_REAP_MS = 30 * 60 * 1000;
const READY_TIMEOUT_MS = 15_000;
const READY_POLL_MS = 50;
const ENDPOINT_PROBE_MS = 2_000;
const TERM_GRACE_MS = 3_000;
const KILL_GRACE_MS = 2_000;
const RECORD_TOKEN = /^[0-9a-f]{16}$/;

export type BrowserSource = 'CAPTURE_BROWSER' | 'puppeteer-cache' | 'system';

/** One launched browser, exactly as persisted at `CAPTURE_ROOT/browsers/<token>.json`.
 * `port` is null only in the window between spawn and the readiness report — a
 * record in that state is still a full ownership claim, so a capture process
 * killed mid-launch still leaves the browser reapable by the next sweep. */
export interface OwnedBrowser {
  version: 1;
  token: string;
  port: number | null;
  pid: number;
  birth: PidBirth;
  profileDir: string;
  executablePath: string;
  source: BrowserSource;
  headless: boolean;
  startedAt: string;
  lastUsedAt: string;
}

export interface ReapedBrowser {
  port: number | null;
  pid: number;
  /** `exited` — the process was already gone; `unreachable` — alive but not
   * answering CDP, so useless to capture; `idle` — unused past IDLE_REAP_MS;
   * `requested` — an explicit `tab quit`. */
  reason: 'exited' | 'unreachable' | 'idle' | 'requested';
}

/** The registry's pathname only. Deliberately NOT `ensurePrivateDir` — reading
 * the registry (which every sweep does, on every `tab list`) must not create
 * anything: a capture root that has never launched a browser stays empty. The
 * private artifact transaction behind `writeJsonPrivate` establishes this
 * directory when the first record is actually written. */
function browsersDir(): string {
  return path.join(CAPTURE_ROOT, 'browsers');
}

function recordPath(token: string): string {
  return path.join(browsersDir(), `${token}.json`);
}

function profilePath(token: string): string {
  return path.join(CAPTURE_ROOT, 'browsers', 'profiles', token);
}

const SOURCES: readonly BrowserSource[] = ['CAPTURE_BROWSER', 'puppeteer-cache', 'system'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Strictly parses one persisted registry record; anything weaker is undefined
 * (and therefore not an ownership claim, so nothing it names can be signalled). */
export function parseOwnedBrowser(value: unknown): OwnedBrowser | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const birth = parseBirth(record.birth);
  const valid = birth !== undefined
    && exactKeys(record, ['version', 'token', 'port', 'pid', 'birth', 'profileDir', 'executablePath', 'source', 'headless', 'startedAt', 'lastUsedAt'])
    && record.version === 1
    && typeof record.token === 'string' && RECORD_TOKEN.test(record.token)
    && (record.port === null || (Number.isSafeInteger(record.port) && (record.port as number) >= 1 && (record.port as number) <= 65535))
    && Number.isSafeInteger(record.pid) && (record.pid as number) > 0
    && typeof record.profileDir === 'string' && record.profileDir === profilePath(record.token as string)
    && typeof record.executablePath === 'string' && path.isAbsolute(record.executablePath)
    && typeof record.source === 'string' && SOURCES.includes(record.source as BrowserSource)
    && typeof record.headless === 'boolean'
    && typeof record.startedAt === 'string' && ISO.test(record.startedAt)
    && typeof record.lastUsedAt === 'string' && ISO.test(record.lastUsedAt);
  // `valid` already implies a parsed birth; the explicit disjunct is what
  // narrows `birth` for the return type — do not "simplify" it away.
  if (!valid || birth === undefined) return undefined;
  return {
    version: 1,
    token: record.token as string,
    port: record.port as number | null,
    pid: record.pid as number,
    birth,
    profileDir: record.profileDir as string,
    executablePath: record.executablePath as string,
    source: record.source as BrowserSource,
    headless: record.headless as boolean,
    startedAt: record.startedAt as string,
    lastUsedAt: record.lastUsedAt as string,
  };
}

/** Every well-formed registry record. A malformed or unreadable file names no
 * process capture may signal, so it is dropped from the registry rather than
 * interpreted. */
export function readOwnedBrowsers(): OwnedBrowser[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(browsersDir());
  } catch {
    return [];
  }
  const records: OwnedBrowser[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json') || !RECORD_TOKEN.test(entry.slice(0, -'.json'.length))) continue;
    const file = path.join(browsersDir(), entry);
    let parsed: OwnedBrowser | undefined;
    try {
      parsed = parseOwnedBrowser(JSON.parse(readPrivateFile(file).toString('utf-8')));
    } catch {
      parsed = undefined;
    }
    if (parsed) records.push(parsed);
    else forgetRecordFile(file);
  }
  return records.sort((a, b) => (a.port ?? 0) - (b.port ?? 0));
}

function forgetRecordFile(file: string): void {
  try {
    unlinkPrivateFile(file);
  } catch {
    // Already gone, or not ours to remove — either way it names nothing we act on.
  }
}

/** True when the recorded process is still the process capture started. The
 * ONLY gate that authorizes a signal; an `unknown` read (a provider that could
 * not answer) is deliberately NOT a kill authorization. */
function stillOurs(record: OwnedBrowser): boolean {
  const observed = processPidBirthProvider.read(record.pid);
  return observed.status === 'found' && sameBirth(observed.identity, record.birth);
}

/**
 * Removes an owned profile tree. Deliberately `fs.rmSync`, NOT the repo's
 * pinned `removeArtifactTree`: Chrome writes `SingletonLock`/`SingletonSocket`
 * (symlinks and unix sockets) into its user-data-dir, and the pinned remover
 * refuses every non-regular, non-directory entry by design. The path is still
 * proven to be inside `CAPTURE_ROOT` first, so this can only ever delete a
 * profile capture created.
 */
function removeProfile(profileDir: string): void {
  fs.rmSync(assertUnderCaptureRoot(profileDir), { recursive: true, force: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** SIGTERM, then SIGKILL if it is still alive, then forget it. Every signal is
 * re-gated on `stillOurs` so a pid that dies and is recycled mid-reap cannot
 * receive the escalation. */
async function reap(record: OwnedBrowser): Promise<void> {
  for (const [signal, graceMs] of [['SIGTERM', TERM_GRACE_MS], ['SIGKILL', KILL_GRACE_MS]] as const) {
    if (!stillOurs(record)) break;
    try {
      process.kill(record.pid, signal);
    } catch {
      break; // Gone between the birth check and the signal.
    }
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline && stillOurs(record)) await sleep(READY_POLL_MS);
  }
  forgetRecordFile(recordPath(record.token));
  removeProfile(record.profileDir);
}

async function endpointAnswers(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://${CDP_LOOPBACK_HOST}:${port}/json/version`, {
      signal: AbortSignal.timeout(ENDPOINT_PROBE_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Reconciles the registry with reality and reaps what no longer earns its
 * memory. Run at the top of every `tab` leaf that touches owned browsers — this
 * is what makes an abandoned browser die on its own instead of outliving the
 * agent that started it.
 */
export async function sweepOwnedBrowsers(): Promise<ReapedBrowser[]> {
  const reaped: ReapedBrowser[] = [];
  for (const record of readOwnedBrowsers()) {
    if (!stillOurs(record)) {
      // Crashed, or SIGKILLed by someone else. Nothing to signal — just drop
      // the claim and the profile it left behind.
      forgetRecordFile(recordPath(record.token));
      removeProfile(record.profileDir);
      reaped.push({ port: record.port, pid: record.pid, reason: 'exited' });
      continue;
    }
    if (record.port === null || !(await endpointAnswers(record.port))) {
      await reap(record);
      reaped.push({ port: record.port, pid: record.pid, reason: 'unreachable' });
      continue;
    }
    if (Date.now() - Date.parse(record.lastUsedAt) > IDLE_REAP_MS) {
      await reap(record);
      reaped.push({ port: record.port, pid: record.pid, reason: 'idle' });
    }
  }
  return reaped;
}

/**
 * Refreshes an owned browser's idle clock. Called from the one browser-level
 * CDP connect (`getBrowserClient`), so any capture command that actually uses a
 * browser keeps it alive; a port with no record — the user's own browser — is a
 * cheap no-op with no writes at all.
 */
export function touchOwnedBrowser(port: number): void {
  const record = readOwnedBrowsers().find((candidate) => candidate.port === port);
  if (!record) return;
  writeJsonPrivate(recordPath(record.token), { ...record, lastUsedAt: new Date().toISOString() });
}

/** Owned browsers by port, for `tab list`'s capture-owned marker. */
export function ownedBrowsersByPort(): Map<number, OwnedBrowser> {
  const byPort = new Map<number, OwnedBrowser>();
  for (const record of readOwnedBrowsers()) if (record.port !== null) byPort.set(record.port, record);
  return byPort;
}

/** Stops owned browsers: one port, or every one capture started. Only records
 * are consulted, so a port capture never launched matches nothing and no signal
 * is sent — including when that port is a live browser of the user's. */
export async function quitOwnedBrowsers(selector: { port?: number; all?: boolean }): Promise<ReapedBrowser[]> {
  const records = readOwnedBrowsers().filter((record) => selector.all || record.port === selector.port);
  const stopped: ReapedBrowser[] = [];
  for (const record of records) {
    await reap(record);
    stopped.push({ port: record.port, pid: record.pid, reason: 'requested' });
  }
  return stopped;
}

// ---------------------------------------------------------------------------
// Executable resolution
// ---------------------------------------------------------------------------

interface Candidate {
  path: string;
  source: BrowserSource;
  /** A headless-shell build has no window and cannot serve `--headed`. */
  headlessOnly: boolean;
}

const PUPPETEER_RELATIVE: Record<string, { chrome: string; shell: string } | undefined> = {
  'darwin-arm64': {
    chrome: 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    shell: 'chrome-headless-shell-mac-arm64/chrome-headless-shell',
  },
  'darwin-x64': {
    chrome: 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    shell: 'chrome-headless-shell-mac-x64/chrome-headless-shell',
  },
  'linux-x64': { chrome: 'chrome-linux64/chrome', shell: 'chrome-headless-shell-linux64/chrome-headless-shell' },
  'linux-arm64': { chrome: 'chrome-linux64/chrome', shell: 'chrome-headless-shell-linux64/chrome-headless-shell' },
};

const SYSTEM_PATHS: Record<string, readonly string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ],
};

function executable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Newest-first version directories under one `~/.cache/puppeteer/<product>` tree. */
function puppeteerVersionDirs(product: string): string[] {
  const root = path.join(os.homedir(), '.cache', 'puppeteer', product);
  try {
    return fs.readdirSync(root).sort().reverse().map((entry) => path.join(root, entry));
  } catch {
    return [];
  }
}

/**
 * Every browser capture would launch, best first. The puppeteer cache comes
 * before the user's installed Chrome deliberately: Chrome for Testing is a
 * pinned, updateless build meant to be driven, and it is exactly what the
 * hand-rolled launches this command replaces were already reaching for.
 */
function browserCandidates(): Candidate[] {
  const configured = process.env.CAPTURE_BROWSER;
  const candidates: Candidate[] = configured
    ? [{ path: path.resolve(configured), source: 'CAPTURE_BROWSER', headlessOnly: false }]
    : [];
  const relative = PUPPETEER_RELATIVE[`${process.platform}-${process.arch}`];
  if (relative) {
    for (const dir of puppeteerVersionDirs('chrome-headless-shell')) {
      candidates.push({ path: path.join(dir, relative.shell), source: 'puppeteer-cache', headlessOnly: true });
    }
    for (const dir of puppeteerVersionDirs('chrome')) {
      candidates.push({ path: path.join(dir, relative.chrome), source: 'puppeteer-cache', headlessOnly: false });
    }
  }
  for (const file of SYSTEM_PATHS[process.platform] ?? []) {
    candidates.push({ path: file, source: 'system', headlessOnly: false });
  }
  return candidates;
}

/** The browser `tab launch` would start, with the provenance of that choice.
 * Reported on every launch so the caller can see WHICH browser answered — a
 * measurement, not a recommendation. */
export function resolveBrowserExecutable(headless: boolean): { path: string; source: BrowserSource } {
  const candidates = browserCandidates().filter((candidate) => headless || !candidate.headlessOnly);
  const found = candidates.find((candidate) => executable(candidate.path));
  if (found) return { path: found.path, source: found.source };
  throw captureError(
    'world',
    'no_browser_executable',
    `received: no usable ${headless ? 'browser' : 'headed browser'} executable; expected: Chrome/Chromium at one of ` +
      `${candidates.map((candidate) => candidate.path).join(', ') || '(no known location for this platform)'}. ` +
      `Set CAPTURE_BROWSER=<absolute path> to name one explicitly, or install Chrome for Testing ` +
      `(npx @puppeteer/browsers install chrome-headless-shell@stable).`,
  );
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

/** Chrome writes its chosen debugging port here once it is listening — the only
 * readiness signal available when `--remote-debugging-port=0` picks a free port
 * for us (stdio is `ignore`, so its stderr banner is not). */
function devToolsPort(profileDir: string): number | null {
  try {
    const first = fs.readFileSync(path.join(profileDir, 'DevToolsActivePort'), 'utf-8').split('\n')[0]?.trim();
    if (!first || !/^[1-9]\d*$/.test(first)) return null;
    const port = Number(first);
    return port >= 1 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
}

/** Refuses an explicit debugging port already listened on through either
 * address family. `lsof` exits 1 when it found no listener; every other
 * failure is a failed precondition check, never permission to launch into an
 * endpoint whose identity capture cannot establish. */
export function assertPortUnbound(port: number): void {
  try {
    const output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-F', 'n'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (output.trim()) {
      throw captureError('precondition', 'browser_port_in_use', `received: port ${port}; expected: no TCP listener on that port. Capture refuses to launch because the endpoint would be ambiguous across loopback address families.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).status === 1) return;
    if (error instanceof CaptureError && error.descriptor.code === 'browser_port_in_use') throw error;
    throw captureError('world', 'browser_port_check_failed', `received: port ${port}; checking TCP listeners with lsof failed, so Capture cannot prove the port is unbound: ${error instanceof Error ? error.message : String(error)}`, error);
  }
}

export interface LaunchOptions {
  /** First page to open; `about:blank` when unset. */
  url?: string;
  /** Pin the debugging port instead of letting the kernel choose a free one. */
  port?: number;
  headless: boolean;
}

/**
 * Starts a browser capture owns and registers it before it is even ready, so no
 * window exists in which a live browser has no ownership record. A launch that
 * never reports readiness reaps its own child — the same discipline
 * `startBridge()` applies to the bridge process it spawns.
 */
export async function launchOwnedBrowser(options: LaunchOptions): Promise<OwnedBrowser> {
  if (options.port !== undefined) assertPortUnbound(options.port);
  const executablePath = resolveBrowserExecutable(options.headless);
  const token = crypto.randomBytes(8).toString('hex');
  const profileDir = ensurePrivateDir(profilePath(token));
  const args = [
    `--remote-debugging-port=${options.port ?? 0}`,
    `--remote-debugging-address=${CDP_LOOPBACK_HOST}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    ...(options.headless ? ['--headless=new'] : []),
    options.url ?? 'about:blank',
  ];
  const child = spawn(executablePath.path, args, { detached: true, stdio: 'ignore' });
  child.unref();
  const pid = child.pid;
  if (pid === undefined) {
    removeProfile(profileDir);
    throw captureError('world', 'browser_spawn_failed', `received: ${executablePath.path}; spawning it produced no pid.`);
  }

  const observed = processPidBirthProvider.read(pid);
  if (observed.status !== 'found') {
    // Without a birth identity there is no gate that could ever authorize a
    // signal to this pid, so it must not become a registry record. Reap it now,
    // while the child handle still proves which process it is.
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    removeProfile(profileDir);
    throw captureError(
      'world',
      'browser_identity_unavailable',
      `received: browser pid ${pid}; expected: a readable process-birth identity to own it by ` +
        `(${observed.status === 'unknown' ? observed.reason : 'the process was already gone'}).`,
    );
  }

  const now = new Date().toISOString();
  const record: OwnedBrowser = {
    version: 1,
    token,
    port: null,
    pid,
    birth: observed.identity,
    profileDir,
    executablePath: executablePath.path,
    source: executablePath.source,
    headless: options.headless,
    startedAt: now,
    lastUsedAt: now,
  };
  writeJsonPrivate(recordPath(token), record);

  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const port = options.port ?? devToolsPort(profileDir);
    if (port !== null && (await endpointAnswers(port))) {
      const ready: OwnedBrowser = { ...record, port, lastUsedAt: new Date().toISOString() };
      writeJsonPrivate(recordPath(token), ready);
      return ready;
    }
    if (Date.now() > deadline) {
      await reap(record);
      throw captureError(
        'world',
        'browser_launch_timeout',
        `received: ${executablePath.path} (pid ${pid}); it did not answer CDP on ` +
          `${options.port === undefined ? 'a kernel-chosen port' : `port ${options.port}`} within ${READY_TIMEOUT_MS}ms. ` +
          `The browser was stopped and its profile removed.`,
      );
    }
    await sleep(READY_POLL_MS);
  }
}
