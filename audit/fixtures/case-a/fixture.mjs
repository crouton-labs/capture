import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(fixtureDir, "app");
const indexPath = join(publicRoot, "index.html");

function sendJson(res, body) {
  const payload = JSON.stringify(body);
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function validFragment(fragment) {
  return fragment && typeof fragment === "object" && !Array.isArray(fragment);
}

function responseFor(pathname, manifest) {
  if (pathname === "/api/shipping-quote") return manifest.shippingQuote;
  if (pathname === "/api/tax-estimate") return manifest.taxCalculation;
  return undefined;
}

async function pageValue(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return result.result.value;
}

async function waitFor(cdp, expression, description) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await pageValue(cdp, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function recalculate(cdp, description) {
  await pageValue(cdp, "document.querySelector('#recalculate').click()");
  await waitFor(cdp, "document.querySelector('#summary')?.dataset.state === 'ready'", description);
  return pageValue(cdp, "Math.round(Number(document.querySelector('#summary-shipping').dataset.amount) * 100)");
}

async function mockResponse(cdp, urlPattern, transform) {
  let failure;
  const unsubscribe = cdp.on("Fetch.requestPaused", async (params) => {
    try {
      const body = await cdp.send("Fetch.getResponseBody", { requestId: params.requestId });
      const input = JSON.parse(Buffer.from(body.body, body.base64Encoded ? "base64" : "utf8").toString("utf8"));
      const output = transform(input);
      await cdp.send("Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: params.responseStatusCode ?? 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json; charset=utf-8" }],
        body: Buffer.from(JSON.stringify(output)).toString("base64"),
      });
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      try { await cdp.send("Fetch.continueRequest", { requestId: params.requestId }); } catch { /* Preserve the interception error. */ }
    }
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern, requestStage: "Response" }] });
  return async () => {
    await cdp.send("Fetch.disable");
    unsubscribe();
    if (failure) throw failure;
  };
}

function rangeAssertion(name, expected, actual) {
  return { name, expected, actual, ok: Number.isFinite(actual) && actual >= expected.min && actual <= expected.max };
}

export default {
  id: "case-a",
  publicRoot,

  async handle(req, res, ctx) {
    const requestUrl = new URL(req.url ?? "/", "http://fixture.invalid");
    if (requestUrl.pathname === "/") {
      if (req.method !== "GET" && req.method !== "HEAD") return false;
      const page = await readFile(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": page.length });
      res.end(req.method === "HEAD" ? undefined : page);
      return true;
    }

    const fragment = responseFor(requestUrl.pathname, ctx.manifest);
    if (fragment === undefined) return false;
    if (req.method !== "GET") return false;
    if (!validFragment(fragment)) throw new Error(`Invalid scenario response for ${requestUrl.pathname}`);
    ctx.log({ route: requestUrl.pathname, query: Object.fromEntries(requestUrl.searchParams) });
    sendJson(res, fragment);
    return true;
  },

  async reset() {},

  async preflight({ cdp, url, variant }) {
    const expectedShipping = variant === "faulty" ? { min: 1900, max: 1900 } : { min: 0, max: 0 };
    await cdp.send("Page.navigate", { url });
    await waitFor(cdp, "document.readyState === 'complete' && document.querySelector('#summary')?.dataset.state === 'pending'", "checkout load");
    const displayedShippingCents = await recalculate(cdp, "initial recalculation");
    const qualificationBadgeVisible = await pageValue(cdp, "document.querySelector('#free-shipping-badge')?.dataset.eligible === 'true' ? 1 : 0");
    const quoteKeys = await pageValue(cdp, "fetch('/api/shipping-quote?postalCode=97209&subtotal=122.90&units=4').then((response) => response.json()).then(Object.keys)");

    const stopTaxMock = await mockResponse(cdp, "*api/tax-estimate*", (payload) => {
      for (const key of quoteKeys) delete payload[key];
      return payload;
    });
    let taxPayloadRemovalShippingCents;
    try { taxPayloadRemovalShippingCents = await recalculate(cdp, "tax response counterfactual"); } finally { await stopTaxMock(); }

    const stopShippingMock = await mockResponse(cdp, "*api/shipping-quote*", (payload) => Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, typeof value === "number" ? value + 1 : value])));
    let shippingResponseOnlyShippingCents;
    try { shippingResponseOnlyShippingCents = await recalculate(cdp, "shipping response negative control"); } finally { await stopShippingMock(); }

    const assertions = [
      rangeAssertion("displayedShippingCents", expectedShipping, displayedShippingCents),
      rangeAssertion("qualificationBadgeVisible", { min: 1, max: 1 }, qualificationBadgeVisible),
      rangeAssertion("taxPayloadRemovalShippingCents", { min: 0, max: 0 }, taxPayloadRemovalShippingCents),
      rangeAssertion("shippingResponseOnlyShippingCents", variant === "faulty" ? { min: 1900, max: 1900 } : { min: 100, max: 100 }, shippingResponseOnlyShippingCents),
    ];
    return { ok: assertions.every((assertion) => assertion.ok), variant, assertions };
  },

  async dumpScript({ capture, snapshot }) {
    const click = await capture(["page", "click", "#recalculate", "--settle", "0"]);
    if (click.exitCode !== 0) throw new Error(`Recalculate interaction failed: ${click.stderr}`);
    await snapshot("recalculated");
  },
};
