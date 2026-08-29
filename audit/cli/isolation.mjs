import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CASES } from "../core/registry.mjs";
import { inspectTargetFilesystem, launchChrome } from "../core/chrome.mjs";
import { invokeCapture } from "../core/capture-invoke.mjs";

const HOST_PATHS = [
  "/",
  "/etc/passwd",
  "/Users/",
  "/Users/silasrhyneer/Code/cli/capture/audit/sealed/case-a/oracle.json",
  "/Users/silasrhyneer/Code/cli/capture/audit/sealed/case-b/manifest.faulty.json",
  "/Users/silasrhyneer/Code/cli/capture/audit/runs/",
  "/Users/silasrhyneer/Code/cli/capture/src/",
];

function fileUrl(path) { return `file://${path}`; }
function sessionId(output) { return /<session id="([^"]+)"/.exec(output)?.[1]; }
function printed(result) { return { exitCode: result.exitCode, stdout: result.stdout.trimEnd(), stderr: result.stderr.trimEnd() }; }

async function sealedTerms() {
  const terms = new Set();
  for (const entry of CASES.filter((candidate) => candidate.status === "built")) {
    const oracle = JSON.parse(await readFile(join(entry.oracleDir, "oracle.json"), "utf8"));
    terms.add(oracle.plantedCondition);
    for (const name of ["manifest.faulty.json", "manifest.healthy.json"]) {
      const manifest = await readFile(join(entry.oracleDir, name), "utf8");
      for (const line of manifest.split("\n")) if (/#(?:[0-9a-f]{6})\b/i.test(line) || /\b\d{4,}\b/.test(line) || /"[A-Za-z]+-[A-Za-z0-9]+"/.test(line)) terms.add(line);
    }
  }
  return [...terms].sort();
}

async function readThroughCapture(port, url) {
  const started = await invokeCapture(["session", "start", "--url", url, "--port", String(port)]);
  const id = sessionId(started.stdout);
  let executed;
  let stopped;
  try {
    executed = id ? await invokeCapture(["page", "exec", "({ href: location.href, text: document.body.innerText })"], { env: { CDP_PORT: String(port) } }) : null;
  } finally {
    if (id) stopped = await invokeCapture(["session", "stop", id], { env: { CDP_PORT: String(port) } });
  }
  return { url, start: printed(started), exec: executed ? printed(executed) : null, stop: stopped ? printed(stopped) : null };
}

async function hostService(body) {
  const server = createServer((_request, response) => response.end(body));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen({ host: "127.0.0.1", port: 0 }, resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Host probe server did not expose a TCP port");
  return { port: address.port, stop: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

/** Proves the target Chrome reads its own files but cannot read the host audit filesystem. */
export async function probe() {
  const fixtureService = await hostService("fixture-network-positive-control");
  const otherHostService = await hostService("host-service-must-not-be-reachable");
  let chrome;
  try {
    chrome = await launchChrome({ fixtureUrl: `http://127.0.0.1:${fixtureService.port}` });
    const files = [];
    for (const path of HOST_PATHS) files.push(await readThroughCapture(chrome.port, fileUrl(path)));
    const fixture = await readThroughCapture(chrome.port, `http://host.docker.internal:${fixtureService.port}`);
    const denied = await readThroughCapture(chrome.port, `http://host.docker.internal:${otherHostService.port}`);
    const terms = await sealedTerms();
    const filesystem = await inspectTargetFilesystem(chrome.port, terms);
    console.log(JSON.stringify({
      chromePort: chrome.port,
      positiveControl: { path: "/etc/passwd", result: files.find((item) => item.url === fileUrl("/etc/passwd")) },
      fileReads: files,
      filesystem: { ...filesystem, scannedTerms: terms },
      network: { fixturePort: fixtureService.port, fixture, deniedHostPort: otherHostService.port, deniedHostService: denied },
    }, null, 2));
  } finally {
    try { await chrome?.stop(); }
    finally {
      try { await fixtureService.stop(); }
      finally { await otherHostService.stop(); }
    }
  }
}
