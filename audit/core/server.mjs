import { createServer } from "node:http";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { getCase } from "./registry.mjs";

const MIME_TYPES = { ".css": "text/css; charset=utf-8", ".gif": "image/gif", ".htm": "text/html; charset=utf-8", ".html": "text/html; charset=utf-8", ".ico": "image/x-icon", ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".webp": "image/webp", ".woff": "font/woff", ".woff2": "font/woff2" };
const headers = (extra = {}) => ({ ...extra, "Cache-Control": "no-store" });
function send(res, status, body = "", extra) { res.writeHead(status, headers(extra)); res.end(body); }
function enforceResponseHeaders(res) {
  const originalSetHeader = res.setHeader.bind(res); const originalWriteHead = res.writeHead.bind(res);
  res.setHeader = (name, value) => {
    const normalized = String(name).toLowerCase();
    if (normalized === "etag" || normalized === "last-modified" || normalized === "x-sourcemap") return res;
    return originalSetHeader(name, normalized === "cache-control" ? "no-store" : value);
  };
  res.writeHead = (statusCode, statusMessage, responseHeaders) => {
    const message = typeof statusMessage === "string" ? statusMessage : undefined;
    const supplied = (message ? responseHeaders : statusMessage) ?? {};
    const safe = Object.fromEntries(Object.entries(supplied).filter(([name]) => !["etag", "last-modified", "x-sourcemap"].includes(name.toLowerCase())));
    safe["Cache-Control"] = "no-store";
    return message ? originalWriteHead(statusCode, message, safe) : originalWriteHead(statusCode, safe);
  };
  res.setHeader("Cache-Control", "no-store");
}
async function loadFixture(entry) { const fixture = (await import(pathToFileURL(resolve(entry.fixtureDir, "fixture.mjs")).href)).default; if (!fixture || fixture.id !== entry.id || typeof fixture.publicRoot !== "string") throw new Error(`Invalid fixture module for ${entry.id}`); return fixture; }
async function loadManifest(entry, variant) { const manifest = JSON.parse(await readFile(resolve(entry.oracleDir, `manifest.${variant}.json`), "utf8")); if (manifest.variant !== variant) throw new Error(`Manifest variant mismatch for ${entry.id}`); return manifest; }

/** Starts one coordinator-owned, loopback-only fixture instance. Optional paths exist only for isolated core tests. */
export async function startFixture({ caseId, variant = "faulty", runId, port = 0, fixtureDir, oracleDir }) {
  if (!new Set(["faulty", "healthy"]).has(variant)) throw new Error(`Invalid fixture variant: ${variant}`);
  const registered = getCase(caseId); const entry = { ...registered, fixtureDir: fixtureDir ?? registered.fixtureDir, oracleDir: oracleDir ?? registered.oracleDir };
  if (entry.status !== "built") throw new Error(`Fixture ${caseId} is not built`);
  const [fixture, manifest] = await Promise.all([loadFixture(entry), loadManifest(entry, variant)]);
  const publicRoot = resolve(fixture.publicRoot); await access(publicRoot, constants.R_OK);
  const rootPrefix = publicRoot.endsWith(sep) ? publicRoot : `${publicRoot}${sep}`;
  const requestLog = []; const state = {};
  const context = { manifest, state, runId, log(event) { requestLog.push({ at: new Date().toISOString(), type: "fixture", event }); } };
  const server = createServer(async (req, res) => {
    const began = Date.now();
    enforceResponseHeaders(res);
    res.on("finish", () => requestLog.push({ at: new Date().toISOString(), type: "request", method: req.method, url: req.url, status: res.statusCode, elapsedMs: Date.now() - began }));
    try {
      if (typeof fixture.handle === "function" && await fixture.handle(req, res, context)) return;
      if (res.writableEnded) return;
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method Not Allowed");
      const requestUrl = new URL(req.url ?? "/", "http://fixture.invalid"); let decoded;
      try { decoded = decodeURIComponent(requestUrl.pathname); } catch { return send(res, 400, "Bad Request"); }
      if (decoded.includes("\0") || decoded.endsWith("/") || extname(decoded).toLowerCase() === ".map") return send(res, 404, "Not Found");
      const candidate = resolve(publicRoot, `.${decoded}`);
      if (candidate !== publicRoot && !candidate.startsWith(rootPrefix)) return send(res, 403, "Forbidden");
      let info; try { info = await stat(candidate); } catch { return send(res, 404, "Not Found"); }
      if (!info.isFile()) return send(res, 404, "Not Found");
      const extra = { "Content-Type": MIME_TYPES[extname(candidate).toLowerCase()] ?? "application/octet-stream", "Content-Length": info.size };
      if (req.method === "HEAD") return send(res, 200, "", extra);
      send(res, 200, await readFile(candidate), extra);
    } catch (error) {
      requestLog.push({ at: new Date().toISOString(), type: "server-error", message: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) send(res, 500, "Internal Server Error"); else res.destroy(error instanceof Error ? error : undefined);
    }
  });
  await new Promise((resolveListen, rejectListen) => { server.once("error", rejectListen); server.listen({ host: "127.0.0.1", port }, resolveListen); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture server did not bind a TCP port");
  const url = `http://127.0.0.1:${address.port}`;
  return { url, port: address.port, requestLog, async reset() { if (typeof fixture.reset === "function") await fixture.reset(context); }, async preflight(tools) { if (typeof fixture.preflight !== "function") throw new Error(`Fixture ${caseId} does not provide preflight()`); return fixture.preflight({ ...tools, url: tools.url ?? url, variant }); }, async stop() { await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose())); } };
}
