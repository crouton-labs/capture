import { access, readdir, utimes, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { CASES, auditRoot, getCase } from "../core/registry.mjs";
import { startFixture } from "../core/server.mjs";
import { launchChrome, targetUrl } from "../core/chrome.mjs";
import { connect } from "../core/cdp-client.mjs";
import { invokeCapture } from "../core/capture-invoke.mjs";
import { prepareDumpDirectory, responseRecord, unavailableBody } from "../core/dump.mjs";

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
  const chromeFlavor = (await fixtureModule(entry)).chromeFlavor;
  for (const currentVariant of ["faulty", "healthy"]) {
    const server = await startFixture({ caseId: entry.id, variant: currentVariant, runId: `preflight-${Date.now()}` });
    let chrome;
    let cdp;
    try {
      chrome = await launchChrome({ fixtureUrl: server.url, flavor: chromeFlavor });
      cdp = await connect(`http://127.0.0.1:${chrome.port}`);
      const capture = (argv, options = {}) => invokeCapture(argv, { ...options, env: { ...options.env, CDP_PORT: String(chrome.port) } });
      const result = await server.preflight({ url: targetUrl(server.url), cdp, capture });
      results.push(result);
    } finally {
      try { await cdp?.close(); }
      finally {
        try { await chrome?.stop(); }
        finally { await server.stop(); }
      }
    }
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
// Every dump artifact gets one fixed timestamp. Real mtimes disclose the interval between
// responses and DOM snapshots, which for a case whose planted condition is a response latency
// is the answer itself — invisible in the served bytes but plain in a directory listing.
const DUMP_TIMESTAMP = new Date("2000-01-01T00:00:00Z");
async function normalizeTimestamps(dir) {
  const names = await readdir(dir);
  await Promise.all(names.map((name) => utimes(join(dir, name), DUMP_TIMESTAMP, DUMP_TIMESTAMP)));
  await utimes(dir, DUMP_TIMESTAMP, DUMP_TIMESTAMP);
}

export async function dump(args) {
  const entry = requireCase(args); const currentVariant = variant(args);
  const output = resolve(auditRoot, "runs", `${entry.id}-dump`);
  await prepareDumpDirectory(output);
  const server = await startFixture({ caseId: entry.id, variant: currentVariant, runId: `${entry.id}-dump` });
  const fixture = await fixtureModule(entry);
  let chrome;
  let cdp;
  let capture;
  let dumpSessionId;
  try {
    chrome = await launchChrome({ fixtureUrl: server.url, flavor: fixture.chromeFlavor });
    cdp = await connect(`http://127.0.0.1:${chrome.port}`);
    const browserUrl = targetUrl(server.url);
    capture = (argv, options = {}) => invokeCapture(argv, { ...options, env: { ...options.env, CDP_PORT: String(chrome.port) } });
    const requestWillBeSent = new Map(), responseEvents = [], loadingFinished = new Map(), consoleOutput = [], doms = [], activeRequests = new Set();
    const snapshot = async (label = `interaction-${doms.length}`) => {
      const result = await cdp.send("Runtime.evaluate", { expression: "document.documentElement.outerHTML", returnByValue: true });
      const file = `dom-${String(doms.length).padStart(3, "0")}-${label.replace(/[^a-zA-Z0-9._-]/g, "_")}.html`;
      await writeFile(join(output, file), result.result.value, "utf8"); doms.push({ label, file }); return file;
    };
    cdp.on("Network.requestWillBeSent", (params) => {
      const priorRequest = requestWillBeSent.get(params.requestId);
      if (params.redirectResponse) responseEvents.push({ request: priorRequest, response: { requestId: params.requestId, timestamp: params.timestamp, response: params.redirectResponse, source: "Network.requestWillBeSent.redirectResponse" }, redirect: true });
      requestWillBeSent.set(params.requestId, params); activeRequests.add(params.requestId);
    });
    cdp.on("Network.responseReceived", (params) => responseEvents.push({ request: requestWillBeSent.get(params.requestId), response: params }));
    cdp.on("Network.loadingFinished", (params) => { loadingFinished.set(params.requestId, params); activeRequests.delete(params.requestId); });
    cdp.on("Network.loadingFailed", (params) => activeRequests.delete(params.requestId));
    cdp.on("Runtime.consoleAPICalled", (params) => consoleOutput.push({ type: params.type, timestamp: params.timestamp, stackTrace: params.stackTrace, args: params.args }));
    await cdp.send("Network.enable"); await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
    const target = cdp.webSocketUrl.split("/").at(-1);
    const started = await capture(["session", "start", "--target", target, "--port", String(chrome.port)]);
    if (started.exitCode !== 0) throw new Error(`capture session start failed: ${started.stderr}`);
    dumpSessionId = /<session id="([^"]+)"/.exec(started.stdout)?.[1];
    const navigated = await capture(["page", "navigate", browserUrl]);
    if (navigated.exitCode !== 0) throw new Error(`capture page navigate failed: ${navigated.stderr}`);
    await snapshot("load");
    if (typeof fixture.dumpScript === "function") await fixture.dumpScript({ url: browserUrl, cdp, capture, snapshot });
    const idleDeadline = Date.now() + 5_000;
    while (activeRequests.size && Date.now() < idleDeadline) await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    const bodyRecords = [];
    for (const event of responseEvents) {
      const responseEvent = event.response;
      const response = responseRecord(event.request, responseEvent, event.redirect ? null : loadingFinished.get(responseEvent.requestId));
      const unavailable = unavailableBody(response);
      if (unavailable) { bodyRecords.push({ ...response, body: unavailable }); continue; }
      try {
        const body = await cdp.send("Network.getResponseBody", { requestId: response.requestId });
        const bytes = Buffer.from(body.body, body.base64Encoded ? "base64" : "utf8"); const name = responseName(bodyRecords.length, response);
        if (textResponse(response)) { const file = `${name}.txt`; await writeFile(join(output, file), bytes); bodyRecords.push({ ...response, body: { kind: "text", file, verbatim: true } }); }
        else bodyRecords.push({ ...response, body: { kind: "binary", storage: "digest-only", fileWritten: false, resourceName: name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } });
      } catch (error) { bodyRecords.push({ ...response, bodyError: error instanceof Error ? error.message : String(error) }); }
    }
    const missingBodies = bodyRecords.filter((record) => record.bodyError || record.body?.kind === "unavailable").map((record) => record.url);
    await writeFile(join(output, "responses.json"), `${JSON.stringify(bodyRecords, null, 2)}\n`);
    await writeFile(join(output, "console.json"), `${JSON.stringify(consoleOutput, null, 2)}\n`);
    await writeFile(join(output, "dump.json"), `${JSON.stringify({ caseId: entry.id, variant: currentVariant, url: server.url, document: doms[0]?.file, doms, responses: "responses.json", console: "console.json", binaryBodyConvention: { storage: "digest-only", fileWritten: false, description: "Binary response bodies are represented by resourceName, size, and sha256; no binary body file is written." }, complete: missingBodies.length === 0, missingBodies }, null, 2)}\n`);
    await normalizeTimestamps(output);
    // A dump missing a response body makes the opacity acceptance test worthless: the reviewer
    // would clear a fixture on bytes nobody read. Keep the artifacts, refuse the success status.
    if (missingBodies.length) throw new Error(`dump incomplete, do not review it: ${missingBodies.length} response body/bodies unavailable (${missingBodies.join(", ")}). Artifacts written to ${output}`);
    console.log(output);
  } finally {
    try { if (dumpSessionId) await capture?.(["session", "stop", dumpSessionId]); }
    finally {
      try { await cdp?.close(); }
      finally {
        try { await chrome?.stop(); }
        finally { await server.stop(); }
      }
    }
  }
}
