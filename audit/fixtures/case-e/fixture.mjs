import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(fixtureDir, "app");

function sendJson(res, body) {
  const bytes = Buffer.from(`${JSON.stringify(body)}\n`);
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": bytes.length });
  res.end(bytes);
}

function reviewFeed(manifest) {
  const items = Array.from({ length: manifest.reviewCount }, (_, index) => {
    const prefix = `Review ${index + 1}: `;
    const fill = `${String.fromCharCode(97 + (index % 26))}${index.toString(36)} `;
    return {
      id: `review-${index + 1}`,
      author: ["Jordan", "Sam", "Avery", "Riley"][index % 4],
      rating: 5 - (index % 2),
      body: `${prefix}${fill.repeat(Math.ceil((manifest.reviewBodyChars - prefix.length) / fill.length)).slice(0, manifest.reviewBodyChars - prefix.length)}`,
    };
  });
  return { items };
}

async function waitFor(cdp, expression, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
    if (result.result.value) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function click(cdp, selector) {
  await cdp.send("Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(selector)}).click()` });
}

async function forceGarbageCollection(cdp) {
  await cdp.send("HeapProfiler.enable");
  for (let attempt = 0; attempt < 3; attempt += 1) await cdp.send("HeapProfiler.collectGarbage");
}

async function takeHeapSnapshot(cdp) {
  const chunks = [];
  const unsubscribe = cdp.on("HeapProfiler.addHeapSnapshotChunk", ({ chunk }) => chunks.push(chunk));
  try {
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  } finally {
    unsubscribe();
  }
  return JSON.parse(chunks.join(""));
}

function detachedFrameDocuments(snapshot) {
  const { node_fields: fields, node_types: types } = snapshot.snapshot.meta;
  const nodeWidth = fields.length;
  const nameOffset = fields.indexOf("name");
  const detachednessOffset = fields.indexOf("detachedness");
  const typeOffset = fields.indexOf("type");
  if (nameOffset < 0 || detachednessOffset < 0 || typeOffset < 0) throw new Error("Heap snapshot has no detached DOM metadata");
  const typeNames = types[typeOffset];
  let count = 0;
  for (let index = 0; index < snapshot.nodes.length; index += nodeWidth) {
    const name = snapshot.strings[snapshot.nodes[index + nameOffset]];
    const detachedness = snapshot.nodes[index + detachednessOffset];
    const type = typeNames[snapshot.nodes[index + typeOffset]];
    if (detachedness > 0 && type === "native" && /Document$/.test(name)) count += 1;
  }
  return count;
}

async function openAndClose(cdp, times) {
  for (let index = 0; index < times; index += 1) {
    await click(cdp, "#quick-view");
    await waitFor(cdp, "Boolean(document.querySelector('#close-view:not([disabled])'))", "quick view to initialize");
    await click(cdp, "#close-view");
    await waitFor(cdp, "!document.querySelector('.quick-view')", "quick view to close");
  }
}

export default {
  id: "case-e",
  publicRoot,

  async handle(req, res, ctx) {
    const path = new URL(req.url ?? "/", "http://fixture.invalid").pathname;
    if (req.method !== "GET") return false;
    if (path === "/") {
      const body = await readFile(join(publicRoot, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": body.length });
      res.end(body);
      return true;
    }
    if (path === "/widget-preferences") {
      const read = ctx.state.preferenceReads ?? 0;
      ctx.state.preferenceReads = read + 1;
      sendJson(res, { channel: ctx.manifest.channelKeys[read % ctx.manifest.channelKeys.length] });
      return true;
    }
    if (path === "/review-feed") {
      sendJson(res, reviewFeed(ctx.manifest));
      return true;
    }
    return false;
  },

  async reset(ctx) {
    ctx.state.preferenceReads = 0;
  },

  async preflight({ url, cdp, variant }) {
    await cdp.send("Page.enable");
    await cdp.send("Page.navigate", { url });
    await waitFor(cdp, "document.readyState === 'complete' && Boolean(document.querySelector('#quick-view'))", "product page");
    await forceGarbageCollection(cdp);
    const baseline = detachedFrameDocuments(await takeHeapSnapshot(cdp));
    await openAndClose(cdp, 6);
    await forceGarbageCollection(cdp);
    const after = detachedFrameDocuments(await takeHeapSnapshot(cdp));
    const retained = Math.max(0, after - baseline);
    const expected = variant === "faulty" ? { min: 6 } : { exact: 0 };
    return { ok: variant === "faulty" ? retained >= 6 : retained === 0, variant, assertions: [{ name: "detachedFrameDocuments", expected, actual: { baseline, after, retained }, ok: variant === "faulty" ? retained >= 6 : retained === 0 }] };
  },

  async dumpScript({ capture, snapshot }) {
    for (let index = 0; index < 6; index += 1) {
      const opened = await capture(["page", "click", "#quick-view"]);
      if (opened.exitCode !== 0) throw new Error(`Quick View interaction failed: ${opened.stderr}`);
      await snapshot(`quick-view-${index + 1}-open`);
      const closed = await capture(["page", "click", "#close-view"]);
      if (closed.exitCode !== 0) throw new Error(`Quick View close failed: ${closed.stderr}`);
      await snapshot(`quick-view-${index + 1}-close`);
    }
  },
};
