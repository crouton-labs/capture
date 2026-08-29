import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_VERSION = "143.0.7499.40";
const READY_TIMEOUT_MS = 8_000;

function chromePath() {
  if (process.env.CAPTURE_TEST_CHROME_PATH) return process.env.CAPTURE_TEST_CHROME_PATH;
  const platform = process.platform === "darwin" ? (process.arch === "arm64" ? "mac_arm" : "mac") : process.platform === "linux" ? "linux" : process.platform === "win32" ? "win64" : undefined;
  if (!platform) throw new Error(`No Chrome-for-Testing mapping for ${process.platform}/${process.arch}; set CAPTURE_TEST_CHROME_PATH.`);
  const app = platform === "mac_arm" ? "chrome-headless-shell-mac-arm64" : platform === "mac" ? "chrome-headless-shell-mac-x64" : platform === "linux" ? "chrome-headless-shell-linux64" : "chrome-headless-shell-win64";
  return join(process.env.HOME ?? "", ".cache", "puppeteer", "chrome-headless-shell", `${platform}-${CHROME_VERSION}`, app, process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Launches the pinned Chrome-for-Testing build in a fresh profile and returns its CDP port. */
export async function launchChrome({ args = [], timeoutMs = READY_TIMEOUT_MS } = {}) {
  const profileDir = await mkdtemp(join(tmpdir(), "capture-audit-chrome-"));
  const proc = spawn(chromePath(), ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profileDir}`, ...args, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  let exited = false;
  proc.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_000); });
  const exitedPromise = new Promise((resolve) => proc.once("exit", () => { exited = true; resolve(); }));
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(stderr);
      if (match) {
        const port = Number(match[1]);
        try {
          if ((await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(250) })).ok) {
            return { proc, port, profileDir, async stop() { if (!exited) { proc.kill("SIGTERM"); await Promise.race([exitedPromise, sleep(2_000)]); if (!exited) proc.kill("SIGKILL"); } await rm(profileDir, { recursive: true, force: true }); } };
          }
        } catch { /* Chrome can announce CDP before its HTTP listener is ready. */ }
      }
      if (exited) throw new Error(`Chrome exited before CDP became ready. stderr:\n${stderr}`);
      await sleep(25);
    }
    throw new Error(`Chrome did not expose CDP within ${timeoutMs}ms. stderr:\n${stderr}`);
  } catch (error) {
    if (!exited) proc.kill("SIGKILL");
    await exitedPromise;
    await rm(profileDir, { recursive: true, force: true });
    throw error;
  }
}
