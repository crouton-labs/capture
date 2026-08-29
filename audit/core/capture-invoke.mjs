import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { auditRoot } from "./registry.mjs";

const defaultBinary = resolve(auditRoot, "..", "bin", "capture");

/** Runs the shipped capture executable as a coordinator action; no audit telemetry is injected. */
export async function invokeCapture(argv, { env, cwd, input, binary = process.env.AUDIT_CAPTURE_BIN ?? defaultBinary } = {}) {
  if (!Array.isArray(argv) || !argv.every((arg) => typeof arg === "string")) throw new TypeError("capture argv must be an array of strings");
  const started = performance.now();
  return new Promise((resolveResult, reject) => {
    const child = spawn(binary, argv, { cwd, env: env ? { ...process.env, ...env } : process.env, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (exitCode) => resolveResult({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), exitCode, elapsedMs: Math.round(performance.now() - started) }));
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  });
}
