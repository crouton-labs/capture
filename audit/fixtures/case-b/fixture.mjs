import { readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(fixtureDir, "app");
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function profileDelay(manifest) {
  const value = manifest.profileDelayMs;
  if (!Number.isInteger(value) || value < 0) throw new Error("Invalid profile configuration");
  return value;
}

function heroPath(manifest) {
  if (typeof manifest.heroSource !== "string") throw new Error("Invalid profile configuration");
  const candidate = resolve(publicRoot, manifest.heroSource);
  const prefix = publicRoot.endsWith(sep) ? publicRoot : `${publicRoot}${sep}`;
  if (!candidate.startsWith(prefix)) throw new Error("Invalid profile configuration");
  return candidate;
}

function sendJson(res, body) {
  const payload = JSON.stringify(body);
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function installObserversSource() {
  return `(() => {
    const state = window.__caseBPreflight = { paints: [], largest: [] };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.paints.push({ name: entry.name, startTime: entry.startTime });
    }).observe({ type: "paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.largest.push({
        startTime: entry.startTime,
        url: entry.url,
        element: entry.element ? { tagName: entry.element.tagName, alt: entry.element.alt } : null
      });
    }).observe({ type: "largest-contentful-paint", buffered: true });
  })();`;
}

async function readEvidence(cdp) {
  const expression = `JSON.stringify({
    state: window.__caseBPreflight,
    navigation: performance.getEntriesByType("navigation").map((entry) => ({ responseStart: entry.responseStart }))[0] || null,
    resources: performance.getEntriesByType("resource").map((entry) => ({
      name: entry.name, initiatorType: entry.initiatorType, startTime: entry.startTime,
      requestStart: entry.requestStart, responseStart: entry.responseStart, responseEnd: entry.responseEnd
    }))
  })`;
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
  if (typeof result.result.value !== "string") return null;
  return JSON.parse(result.result.value);
}

async function waitForEvidence(cdp) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const evidence = await readEvidence(cdp);
    const largest = evidence?.state?.largest?.filter((entry) => entry.element?.tagName === "IMG")?.at(-1);
    const heroResource = evidence?.resources?.find((entry) => entry.initiatorType === "img");
    const fcp = evidence?.state?.paints?.find((entry) => entry.name === "first-contentful-paint");
    if (largest && heroResource && fcp && evidence.navigation) return { evidence, largest, heroResource, fcp };
    await sleep(25);
  }
  throw new Error("Landing page did not produce the expected paint evidence");
}

function rounded(value) { return Math.round(value * 10) / 10; }

export default {
  id: "case-b",
  publicRoot,

  async handle(req, res, ctx) {
    res.sendDate = false;
    const pathname = new URL(req.url ?? "/", "http://fixture.invalid").pathname;
    if (pathname === "/") {
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end("Method Not Allowed"); return true; }
      const document = await readFile(resolve(publicRoot, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": document.length });
      res.end(req.method === "HEAD" ? undefined : document);
      return true;
    }
    if (pathname === "/profile") {
      if (req.method !== "GET") { res.writeHead(405); res.end("Method Not Allowed"); return true; }
      await sleep(profileDelay(ctx.manifest));
      if (typeof ctx.manifest.heroUrl !== "string" || !ctx.manifest.heroUrl.startsWith("/")) throw new Error("Invalid profile configuration");
      sendJson(res, { image: ctx.manifest.heroUrl });
      ctx.log({ route: "profile", outcome: "served" });
      return true;
    }
    if (pathname === "/art/primary") {
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end("Method Not Allowed"); return true; }
      const image = await readFile(heroPath(ctx.manifest));
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": image.length });
      res.end(req.method === "HEAD" ? undefined : image);
      ctx.log({ route: "art", outcome: "served" });
      return true;
    }
    return false;
  },

  async reset() {},

  async dumpScript({ cdp, snapshot }) {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const result = await cdp.send("Runtime.evaluate", { expression: "Boolean(document.querySelector('[data-hero] img')?.complete) && document.querySelector('[data-hero] img')?.naturalWidth > 0", returnByValue: true });
      if (result.result.value) { await snapshot("personalized"); return; }
      await sleep(25);
    }
    throw new Error("Landing page did not finish personalization for dump");
  },

  async preflight({ url, cdp, variant }) {
    await cdp.send("Page.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: installObserversSource() });
    const loaded = new Promise((resolveLoaded) => {
      const unsubscribe = cdp.on("Page.loadEventFired", () => { unsubscribe(); resolveLoaded(); });
    });
    await cdp.send("Page.navigate", { url });
    await Promise.race([loaded, sleep(2_000).then(() => { throw new Error("Landing page did not load"); })]);
    const { evidence, largest, heroResource, fcp } = await waitForEvidence(cdp);
    const lcpMs = rounded(largest.startTime);
    const fcpMs = rounded(fcp.startTime);
    const navigationResponseStart = evidence.navigation.responseStart;
    const resourceLoadDelayMs = heroResource.startTime - navigationResponseStart;
    const ttfbMs = heroResource.responseStart - heroResource.requestStart;
    const downloadMs = heroResource.responseEnd - heroResource.responseStart;
    if (largest.url !== heroResource.name) throw new Error("The largest paint did not identify the injected image resource");
    if (!(resourceLoadDelayMs > ttfbMs && resourceLoadDelayMs > downloadMs)) throw new Error("Image resource load delay was not the dominant phase");
    const lcpExpected = variant === "faulty" ? { min: 2800, max: 3800 } : { min: 0, max: 1200 };
    return {
      ok: fcpMs <= 800 && lcpMs >= lcpExpected.min && lcpMs <= lcpExpected.max,
      variant,
      assertions: [
        { name: "fcpMs", expected: { min: 0, max: 800 }, actual: fcpMs, ok: fcpMs <= 800 },
        { name: "lcpMs", expected: lcpExpected, actual: lcpMs, ok: lcpMs >= lcpExpected.min && lcpMs <= lcpExpected.max }
      ]
    };
  },
};
