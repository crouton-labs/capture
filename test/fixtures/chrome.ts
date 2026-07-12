import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_VERSION = '143.0.7499.40';
const READY_TIMEOUT_MS = 8_000;
const STDERR_LIMIT = 16_000;
const fixtures = new WeakMap<ChildProcess, ChromeFixture>();

export interface ChromeFixture {
  proc: ChildProcess;
  port: number;
  profileDir: string;
  close(): Promise<void>;
}

interface LaunchOptions {
  executablePath?: string;
  args?: string[];
  rawArgs?: boolean;
  timeoutMs?: number;
}

function chromeForTestingPath(): string {
  if (process.env.CAPTURE_TEST_CHROME_PATH) return process.env.CAPTURE_TEST_CHROME_PATH;
  const platform = process.platform === 'darwin'
    ? (process.arch === 'arm64' ? 'mac_arm' : 'mac')
    : process.platform === 'linux'
      ? 'linux'
      : process.platform === 'win32'
        ? 'win64'
        : undefined;
  if (!platform) throw new Error(`No Chrome-for-Testing headless-shell archive mapping for ${process.platform}/${process.arch}; set CAPTURE_TEST_CHROME_PATH.`);
  const app = platform === 'mac_arm' ? 'chrome-headless-shell-mac-arm64' : platform === 'mac' ? 'chrome-headless-shell-mac-x64' : platform === 'linux' ? 'chrome-headless-shell-linux64' : 'chrome-headless-shell-win64';
  return join(process.env.HOME ?? '', '.cache', 'puppeteer', 'chrome-headless-shell', `${platform}-${CHROME_VERSION}`, app, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Closes a fixture obtained from `spawnHeadlessChrome`, including its temporary profile. */
export async function closeChrome(proc: ChildProcess | undefined): Promise<void> {
  await fixtures.get(proc as ChildProcess)?.close();
}

/** Launches a pinned cached Chrome-for-Testing headless shell in an isolated temporary profile. Install it with `npm run test:install-chrome`. */
export async function spawnHeadlessChrome(options: LaunchOptions = {}): Promise<ChromeFixture> {
  const profileDir = await mkdtemp(join(tmpdir(), 'capture-chrome-'));
  const executablePath = options.executablePath ?? chromeForTestingPath();
  const proc = spawn(executablePath, options.rawArgs ? (options.args ?? []) : [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, ...(options.args ?? ['about:blank']),
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  proc.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-STDERR_LIMIT); });
  const exit = new Promise<void>((resolve) => {
    proc.once('exit', (code, signal) => { exited = { code, signal }; resolve(); });
    proc.once('error', (error) => { stderr = (stderr + `\nspawn error: ${error.message}`).slice(-STDERR_LIMIT); exited = { code: null, signal: null }; resolve(); });
  });
  const cleanupProfile = async (): Promise<void> => { await rm(profileDir, { recursive: true, force: true }); };
  proc.once('exit', () => { void cleanupProfile(); });

  try {
    const deadline = Date.now() + (options.timeoutMs ?? READY_TIMEOUT_MS);
    while (Date.now() < deadline) {
      if (exited) throw new Error(`Chrome-for-Testing exited before CDP became ready (code=${exited.code}, signal=${exited.signal ?? 'none'}). stderr:\n${stderr || '(empty)'}`);
      const match = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(stderr);
      if (match) {
        const port = Number(match[1]);
        const controller = new AbortController();
        const remaining = deadline - Date.now();
        const timer = setTimeout(() => controller.abort(), Math.min(250, remaining));
        void exit.then(() => controller.abort());
        try {
          if ((await fetch(`http://127.0.0.1:${port}/json/version`, { signal: controller.signal })).ok) {
            const fixture: ChromeFixture = {
              proc, port, profileDir,
              async close(): Promise<void> {
                if (!exited) {
                  proc.kill('SIGTERM');
                  await Promise.race([exit, sleep(2_000)]);
                  if (!exited) { proc.kill('SIGKILL'); await exit; }
                }
                await cleanupProfile();
              },
            };
            fixtures.set(proc, fixture);
            return fixture;
          }
        } catch {
          // DevTools announces its endpoint before the HTTP handler is necessarily ready.
        } finally { clearTimeout(timer); }
      }
      await Promise.race([exit, sleep(25)]);
    }
    throw new Error(`Chrome-for-Testing did not expose CDP within ${options.timeoutMs ?? READY_TIMEOUT_MS}ms. stderr:\n${stderr || '(empty)'}`);
  } catch (error) {
    if (!exited) { proc.kill('SIGKILL'); await exit; }
    await cleanupProfile();
    throw error;
  }
}
