import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { CASES, auditRoot, getCase } from "../core/registry.mjs";
import { startFixture } from "../core/server.mjs";
import { launchChrome } from "../core/chrome.mjs";
import { connect } from "../core/cdp-client.mjs";
import { invokeCapture } from "../core/capture-invoke.mjs";

function option(args, name, fallback) { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1] ?? (() => { throw new Error(`${name} needs a value`); })(); }
function variant(args) { const value = option(args, "--variant", "faulty"); if (value !== "faulty" && value !== "healthy") throw new Error("--variant must be faulty or healthy"); return value; }
function requireCase(args) { return getCase(option(args, "--case")); }
async function fixtureModule(entry) { return (await import(new URL(`../fixtures/${entry.id}/fixture.mjs`, import.meta.url))).default; }

export async function list() {
  for (const entry of CASES) {
    if (entry.status === "not-built") { console.log(`${entry.id}\tnot-built`); continue; }
    let status = "pending";
    try { await access(join(entry.fixtureDir, "fixture.mjs"), constants.R_OK); await access(join(entry.oracleDir, "manifest.faulty.json"), constants.R_OK); status = "built"; } catch { /* Fixture authors have not landed their package yet. */ }
    console.log(`${entry.id}\t${status}\t${entry.opaqueId}\t${entry.revision}`);
  }
}

export async function serve(args) {
  const entry = requireCase(args); const port = Number(option(args, "--port", "0"));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be a TCP port");
  const server = await startFixture({ caseId: entry.id, variant: variant(args), runId: "operator", port });
  console.log(server.url);
  await new Promise((resolveStop) => { const stop = () => resolveStop(); process.once("SIGINT", stop); process.once("SIGTERM", stop); });
  await server.stop();
}

export async function preflight(args) {
  const entry = requireCase(args);
  const results = [];
  for (const currentVariant of ["faulty", "healthy"]) {
    const server = await startFixture({ caseId: entry.id, variant: currentVariant, runId: `preflight-${Date.now()}` });
    const chrome = await launchChrome();
    const cdp = await connect(`http://127.0.0.1:${chrome.port}`);
    try {
      const capture = (argv, options = {}) => invokeCapture(argv, { ...options, env: { ...options.env, CDP_PORT: String(chrome.port) } });
      const result = await server.preflight({ cdp, capture });
      results.push(result);
    } finally { await cdp.close(); await chrome.stop(); await server.stop(); }
  }
  let okay = true;
  for (const result of results) for (const assertion of result.assertions ?? []) { const pass = Boolean(assertion.ok); okay &&= pass; console.log(`${result.variant}\t${pass ? "PASS" : "FAIL"}\t${assertion.name}\texpected=${JSON.stringify(assertion.expected)}\tactual=${JSON.stringify(assertion.actual)}`); }
  if (!okay) process.exitCode = 1;
}

function responseName(index, response) {
  const fromUrl = basename(new URL(response.url).pathname) || "document";
  return `${String(index).padStart(3, "0")}-${fromUrl.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
}
function textResponse(response) { return /(?:javascript|json|css|html|xml|text)/i.test(response.mimeType ?? "") || /(?:javascript|json|css|html|xml|text)/i.test(response.headers?.["content-type"] ?? ""); }

/** Captures the browser-visible response/console/DOM evidence required for opacity review. */
export async function dump(args) {
  const entry = requireCase(args); const currentVariant = variant(args);
  const output = resolve(auditRoot, "runs", `${entry.id}-dump`);
  await mkdir(output, { recursive: true });
  const server = await startFixture({ caseId: entry.id, variant: currentVariant, runId: `${entry.id}-dump` });
  const chrome = await launchChrome(); const cdp = await connect(`http://127.0.0.1:${chrome.port}`);
  let dumpSessionId;
  const capture = (argv, options = {}) => invokeCapture(argv, { ...options, env: { ...options.env, CDP_PORT: String(chrome.port) } });
  const responses = new Map(), consoleOutput = [], doms = [], activeRequests = new Set();
  const snapshot = async (label = `interaction-${doms.length}`) => {
    const result = await cdp.send("Runtime.evaluate", { expression: "document.documentElement.outerHTML", returnByValue: true });
    const file = `dom-${String(doms.length).padStart(3, "0")}-${label.replace(/[^a-zA-Z0-9._-]/g, "_")}.html`;
    await writeFile(join(output, file), result.result.value, "utf8"); doms.push({ label, file }); return file;
  };
  cdp.on("Network.requestWillBeSent", (params) => activeRequests.add(params.requestId));
  cdp.on("Network.responseReceived", (params) => responses.set(params.requestId, { requestId: params.requestId, url: params.response.url, status: params.response.status, headers: params.response.headers, mimeType: params.response.mimeType }));
  cdp.on("Network.loadingFinished", (params) => activeRequests.delete(params.requestId));
  cdp.on("Network.loadingFailed", (params) => activeRequests.delete(params.requestId));
  cdp.on("Runtime.consoleAPICalled", (params) => consoleOutput.push({ type: params.type, timestamp: params.timestamp, stackTrace: params.stackTrace, args: params.args }));
  try {
    await cdp.send("Network.enable"); await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
    const target = cdp.webSocketUrl.split("/").at(-1);
    const started = await capture(["session", "start", "--target", target, "--port", String(chrome.port)]);
    if (started.exitCode !== 0) throw new Error(`capture session start failed: ${started.stderr}`);
    dumpSessionId = /<session id="([^"]+)"/.exec(started.stdout)?.[1];
    const navigated = await capture(["page", "navigate", server.url]);
    if (navigated.exitCode !== 0) throw new Error(`capture page navigate failed: ${navigated.stderr}`);
    await snapshot("load");
    const fixture = await fixtureModule(entry);
    if (typeof fixture.dumpScript === "function") await fixture.dumpScript({ url: server.url, cdp, capture, snapshot });
    const idleDeadline = Date.now() + 5_000;
    while (activeRequests.size && Date.now() < idleDeadline) await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    const bodyRecords = [];
    for (const response of responses.values()) {
      try {
        const body = await cdp.send("Network.getResponseBody", { requestId: response.requestId });
        const bytes = Buffer.from(body.body, body.base64Encoded ? "base64" : "utf8"); const name = responseName(bodyRecords.length, response);
        if (textResponse(response)) { const file = `${name}.txt`; await writeFile(join(output, file), bytes); bodyRecords.push({ ...response, body: { kind: "text", file, verbatim: true } }); }
        else bodyRecords.push({ ...response, body: { kind: "binary", name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } });
      } catch (error) { bodyRecords.push({ ...response, bodyError: error instanceof Error ? error.message : String(error) }); }
    }
    await writeFile(join(output, "responses.json"), `${JSON.stringify(bodyRecords, null, 2)}\n`);
    await writeFile(join(output, "console.json"), `${JSON.stringify(consoleOutput, null, 2)}\n`);
    await writeFile(join(output, "dump.json"), `${JSON.stringify({ caseId: entry.id, variant: currentVariant, url: server.url, document: doms[0]?.file, doms, responses: "responses.json", console: "console.json" }, null, 2)}\n`);
    console.log(output);
  } finally { if (dumpSessionId) await capture(["session", "stop", dumpSessionId]); await cdp.close(); await chrome.stop(); await server.stop(); }
}
