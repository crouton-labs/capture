import { spawn } from "node:child_process";
import { get } from "node:http";

const CHROME_VERSION = "143.0.7499.40";
const READY_TIMEOUT_MS = 30_000;
export const TARGET_IMAGE = "capture-audit-target:143.0.7499.40";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function probeVersion(port) {
  return new Promise((resolve, reject) => {
    const request = get({ hostname: "127.0.0.1", port, path: "/json/version", agent: false, timeout: 500 }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => {
        if (response.statusCode !== 200) return reject(new Error(`CDP endpoint returned ${response.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch (error) { reject(error); }
      });
    });
    request.once("error", reject);
    request.once("timeout", () => request.destroy(new Error("CDP endpoint probe timed out")));
  });
}

function command(program, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      const result = { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), exitCode, signal };
      if (exitCode === 0) resolve(result);
      else reject(new Error(`${program} ${args.join(" ")} failed (${signal ?? exitCode}): ${result.stderr.trim() || result.stdout.trim()}`));
    });
    if (input === undefined) return;
    child.stdin.end(input);
  });
}

function targetImage() { return process.env.AUDIT_TARGET_IMAGE ?? TARGET_IMAGE; }

function requireFlavor(flavor) {
  if (flavor !== "headless-shell" && flavor !== "chrome") throw new Error(`Unknown Chrome flavor: ${flavor}`);
}

function fixturePort(url) {
  const fixture = new URL(url);
  if (fixture.hostname !== "127.0.0.1" && fixture.hostname !== "localhost") throw new Error(`Fixture URL must be loopback-only: ${url}`);
  if (!fixture.port) throw new Error(`Fixture URL must include its ephemeral TCP port: ${url}`);
  return fixture.port;
}

function hostPort(output) {
  const match = /:(\d+)\s*$/m.exec(output);
  if (!match) throw new Error(`Docker did not publish Chrome's CDP port: ${output.trim()}`);
  return Number(match[1]);
}

/** Rewrites a loopback fixture URL for the target container's host gateway. */
export function targetUrl(url) {
  const rewritten = new URL(url);
  if (rewritten.hostname !== "127.0.0.1" && rewritten.hostname !== "localhost") throw new Error(`Fixture URL must be loopback-only: ${url}`);
  rewritten.hostname = "host.docker.internal";
  return rewritten.href.replace(/\/$/, "");
}

async function targetContainerId(port) {
  const listed = await command("docker", ["ps", "--filter", "label=capture.audit.target=true", "--format", "{{.ID}}"]);
  const ids = listed.stdout.trim().split("\n").filter(Boolean);
  for (const id of ids) {
    const published = await command("docker", ["port", id, "9222/tcp"]);
    if (hostPort(published.stdout) === port) return id;
  }
  throw new Error(`No audit target container publishes CDP port ${port}`);
}

/** Enumerates the running target filesystem as container root and scans it for sealed-case terms. */
export async function inspectTargetFilesystem(port, sealedTerms = []) {
  if (!Array.isArray(sealedTerms) || !sealedTerms.every((term) => typeof term === "string" && term.length)) throw new TypeError("sealedTerms must be non-empty strings");
  const containerId = await targetContainerId(port);
  const files = await command("docker", ["exec", "--user", "0", containerId, "sh", "-c", "find / -xdev -type f -print | LC_ALL=C sort"]);
  let termMatches = "";
  if (sealedTerms.length) {
    const scan = await command("docker", ["exec", "--interactive", "--user", "0", containerId, "sh", "-c", "cat >/tmp/audit-sealed-terms && find / -xdev -type f -print0 | xargs -0 grep -I -l -F -f /tmp/audit-sealed-terms 2>/dev/null || true; rm -f /tmp/audit-sealed-terms"], { input: `${sealedTerms.join("\n")}\n` });
    termMatches = scan.stdout;
  }
  const paths = files.stdout.trim().split("\n").filter(Boolean);
  return { fileCount: paths.length, matchingPaths: paths.filter((path) => /(?:^|\/)(?:capture|sealed|oracle|case-[a-e])(?:\/|$)/i.test(path)), sealedTermMatches: termMatches.trim().split("\n").filter((path) => path && path !== "/tmp/audit-sealed-terms") };
}

/** Launches pinned Chrome-for-Testing in an isolated linux/amd64 container and returns its host CDP port. */
export async function launchChrome({ args = [], fixtureUrl, flavor = "headless-shell", timeoutMs = READY_TIMEOUT_MS, handleSignals = true, onStarted } = {}) {
  requireFlavor(flavor);
  const allowedFixturePort = fixturePort(fixtureUrl);
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) throw new TypeError("Chrome args must be strings");
  if (typeof handleSignals !== "boolean") throw new TypeError("handleSignals must be a boolean");
  if (onStarted !== undefined && typeof onStarted !== "function") throw new TypeError("onStarted must be a function");
  if (args.some((arg) => arg.startsWith("--remote-debugging-") || arg.startsWith("--user-data-dir="))) throw new Error("The audit target owns CDP and profile flags");
  let containerId;
  let startedPromise;
  let stopping;
  const onSignal = (signal) => {
    void (startedPromise ?? Promise.resolve()).then(stop, stop).catch((cleanupError) => console.error(`Could not remove audit Chrome after ${signal}: ${cleanupError.message}`)).finally(() => process.kill(process.pid, signal));
  };
  const onSigint = () => onSignal("SIGINT");
  const onSigterm = () => onSignal("SIGTERM");
  const stop = async () => {
    if (stopping) return stopping;
    if (handleSignals) {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    }
    stopping = containerId ? command("docker", ["rm", "--force", containerId]) : Promise.resolve();
    return stopping;
  };
  try {
    if (handleSignals) {
      process.once("SIGINT", onSigint);
      process.once("SIGTERM", onSigterm);
    }
    await (startedPromise = command("docker", ["run", "--detach", "--rm", "--platform", "linux/amd64", "--cap-drop", "ALL", "--cap-add", "NET_ADMIN", "--cap-add", "SETUID", "--cap-add", "SETGID", "--cap-add", "SETPCAP", "--publish", "127.0.0.1::9222", "--shm-size", "512m", "--label", "capture.audit.target=true", "--env", `CHROME_FLAVOR=${flavor}`, "--env", `AUDIT_FIXTURE_PORT=${allowedFixturePort}`, targetImage(), ...args]).then((result) => {
      containerId = result.stdout.trim();
      if (!/^[a-f0-9]{12,64}$/.test(containerId)) throw new Error(`Docker returned an invalid target container id: ${containerId}`);
      onStarted?.({ stop });
      return result;
    }));
    const published = await command("docker", ["port", containerId, "9222/tcp"]);
    const port = hostPort(published.stdout);
    const deadline = Date.now() + timeoutMs;
    let lastProbeError;
    while (Date.now() < deadline) {
      try {
        const version = await probeVersion(port);
        if (version.Browser !== `HeadlessChrome/${CHROME_VERSION}` && version.Browser !== `Chrome/${CHROME_VERSION}`) throw new Error(`Target Chrome version mismatch: ${version.Browser}`);
        return { port, stop };
      } catch (error) {
        // During readiness the published port is authoritative; connection refusal and fetch timeout only mean Chrome has not opened it yet.
        lastProbeError = error;
      }
      await sleep(50);
    }
    throw new Error(`Chrome did not expose CDP within ${timeoutMs}ms${lastProbeError ? `: ${lastProbeError.message}` : ""}`);
  } catch (error) {
    await stop().catch((cleanupError) => { throw new AggregateError([error, cleanupError], "Chrome launch failed and its target container could not be removed"); });
    throw error;
  }
}
