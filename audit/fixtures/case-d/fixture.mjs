import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(fixtureDir, "app");
const sealedRoot = join(fixtureDir, "..", "..", "sealed", "case-d");

function json(res, body) {
  const text = `${JSON.stringify(body)}\n`;
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

function collection(cardCount) {
  const colors = ["#dce9e2", "#e8ded1", "#d8e4ee", "#eadfd7", "#e4e6d4", "#ded9eb"];
  const names = ["Canvas carryall", "Cedar shelf", "Harbor lamp", "Field notebook", "Woven runner", "Stoneware cup"];
  return Array.from({ length: cardCount }, (_, index) => ({ name: `${names[index % names.length]} ${index + 1}`, price: `$${24 + (index % 9) * 7}.00`, label: index % 5 === 0 ? "New" : "Studio", tile: colors[index % colors.length] }));
}

function traceFacts(events) {
  const layouts = events.filter((event) => event.name === "UpdateLayoutTree" && Number.isFinite(event.ts) && Number.isFinite(event.dur) && event.dur > 0);
  const badgeLayouts = layouts.filter((event) => (event.args?.beginData?.stackTrace ?? []).some((frame) => frame.functionName === "positionMarks" && String(frame.url ?? "").includes("/ornaments.js")));
  return { layoutMs: badgeLayouts.reduce((total, event) => total + event.dur, 0) / 1000, layoutCount: badgeLayouts.length, vendorCalls: badgeLayouts.length };
}

async function waitForReady(cdp) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await cdp.send("Runtime.evaluate", { expression: "window.__marinerReady === true", returnByValue: true });
    if (result.result.value) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Product grid did not become ready");
}

async function recordScroll(cdp, url) {
  const events = [];
  const stopEvents = cdp.on("Tracing.dataCollected", ({ value }) => events.push(...value));
  const complete = new Promise((resolve) => { const stop = cdp.on("Tracing.tracingComplete", (event) => { stop(); resolve(event); }); });
  await cdp.send("Page.navigate", { url });
  await waitForReady(cdp);
  await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack,blink.user_timing", transferMode: "ReportEvents" });
  await cdp.send("Runtime.evaluate", { expression: `new Promise(async (resolve) => { const grid = document.querySelector("#product-grid"); const steps = [120, 280, 470, 690, 930, 1220]; for (const top of steps) { grid.scrollTop = top; grid.dispatchEvent(new Event("scroll")); await new Promise((frame) => requestAnimationFrame(() => requestAnimationFrame(frame))); } resolve(); })()`, awaitPromise: true, returnByValue: true });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await cdp.send("Tracing.end");
  await complete;
  stopEvents();
  return traceFacts(events);
}

export default {
  id: "case-d",
  publicRoot,
  async handle(req, res, { manifest }) {
    const path = new URL(req.url ?? "/", "http://fixture.invalid").pathname;
    if (req.method !== "GET") return false;
    if (path === "/") { const body = await readFile(join(publicRoot, "index.html")); res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": body.length }); res.end(body); return true; }
    if (path === "/collection") { json(res, { products: collection(manifest.catalog.cardCount) }); return true; }
    if (path === "/display-options") { json(res, { batchSize: manifest.widget.batchSize }); return true; }
    return false;
  },
  async reset({ state }) { for (const key of Object.keys(state)) delete state[key]; },
  async preflight({ url, cdp, variant }) {
    const scenario = JSON.parse(await readFile(join(sealedRoot, `manifest.${variant}.json`), "utf8"));
    const actual = await recordScroll(cdp, url);
    const forcedReflow = actual.layoutCount >= scenario.preflight.insight.minLayoutCount;
    const hasAttribution = actual.vendorCalls > 0;
    const durationInRange = actual.layoutMs >= scenario.preflight.layoutMs.min && actual.layoutMs <= scenario.preflight.layoutMs.max;
    return { ok: forcedReflow === scenario.preflight.insight.present && hasAttribution && durationInRange, variant, assertions: [
      { name: "forced-reflow-insight", expected: scenario.preflight.insight.present ? 1 : 0, actual: forcedReflow ? 1 : 0, ok: forcedReflow === scenario.preflight.insight.present },
      { name: "badge-layout-attribution", expected: 1, actual: hasAttribution ? 1 : 0, ok: hasAttribution },
      { name: "scroll-layout-ms", expected: scenario.preflight.layoutMs, actual: actual.layoutMs, ok: durationInRange },
    ] };
  },
  async dumpScript({ capture, snapshot }) {
    const result = await capture(["page", "scroll", "#product-grid", "--to", "bottom", "--settle", "0", "--no-screenshot"]);
    if (result.exitCode !== 0) throw new Error(`Dump scroll failed: ${result.stderr}`);
    await snapshot("scroll");
  },
};
