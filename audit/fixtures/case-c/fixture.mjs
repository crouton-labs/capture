import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(fixtureDir, "app");
const REFUND_SELECTOR = '[data-policy="refunds"] .fineprint';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const passTiers = {
  season: "Summer 2026",
  onSaleFrom: "2026-03-02",
  onSaleTo: "2026-06-30",
  intro: "Every pass covers the full season and can be picked up at the front desk once the paperwork clears. Rates depend on where you live and how many people the pass covers.",
  note: "Rates include state and county tax. Add $15 per additional household member above six.",
  tiers: [
    { id: "individual", name: "Individual" },
    { id: "household", name: "Household" },
    { id: "senior-veteran", name: "Senior and veteran" },
  ],
};

const hours = {
  staffed: "Front desk staffed weekdays from 9:00 a.m. to 5:00 p.m.",
  periods: [
    { label: "Open swim", hours: "Daily, 11:00 a.m. to 7:00 p.m." },
    { label: "Lap lanes", hours: "Weekdays, 6:00 a.m. to 9:00 a.m." },
    { label: "Shallow-water play area", hours: "Daily, 11:00 a.m. to 5:00 p.m." },
    { label: "Adult evening swim", hours: "Tuesday and Thursday, 7:30 p.m. to 9:00 p.m." },
  ],
};

const notices = {
  policies: [
    { id: "guests", heading: "Guests", body: "Each passholder may bring up to two guests per visit. Guests must check in with the passholder and pay the daily guest fee before entering the deck." },
    { id: "weather", heading: "Closures for weather and maintenance", body: "The pool closes when lightning is reported within ten miles and reopens thirty minutes after the last report. Maintenance closures are posted at the front desk and at the gate." },
    { id: "transfers", heading: "Transfers", body: "A season pass may be transferred once to another household member who lives at the address on the original request. Bring both cards to the front desk for the update." },
    { id: "refunds", heading: "Refunds", body: "Passes may be refunded in full within thirty days of purchase, less a $10 processing fee; after thirty days a pass may be transferred once but is not refundable." },
  ],
  hoursChange: {
    headline: "Lap lanes open a half hour earlier in July",
    body: "Two lanes open at 5:30 a.m. on weekdays for the month of July.",
    effective: "2026-07-01",
  },
  closures: {
    headline: "Pool closed for the deck resurfacing",
    body: "The play area and lap lanes are both closed while the deck is resurfaced.",
    dates: ["2026-08-17", "2026-08-19"],
  },
};

function json(res, body) {
  const payload = `${JSON.stringify(body)}\n`;
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function methodNotAllowed(res) {
  res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Method Not Allowed");
}

async function requestJson(req) {
  const parts = [];
  for await (const part of req) parts.push(part);
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

async function waitForPage(cdp, activeRequests) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const result = await cdp.send("Runtime.evaluate", { expression: `document.readyState === "complete" && Boolean(document.querySelector(${JSON.stringify(REFUND_SELECTOR)})) && getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim().length > 0 && Boolean(document.querySelector('[data-field="pass-intro"]')?.textContent.trim()) && Boolean(document.querySelector('[data-field="staffed-hours"]')?.textContent.trim())`, returnByValue: true });
    if (result.result.value && activeRequests.size === 0) return;
    await sleep(25);
  }
  throw new Error("Millbrook season-pass page did not finish rendering and become network-idle");
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression: `JSON.stringify(${expression})`, returnByValue: true });
  if (typeof result.result.value !== "string") throw new Error("Preflight evaluation did not return JSON");
  return JSON.parse(result.result.value);
}

function contrastProbe(selector) {
  return `(() => {
    const toRgb = (value) => {
      const match = value.match(/rgba?\\(([^)]+)\\)/);
      if (!match) return null;
      const values = match[1].split(",").map((part) => Number(part.trim()));
      return values.length >= 3 ? values : null;
    };
    const luminance = ([red, green, blue]) => [red, green, blue].map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const background = (element) => {
      for (let node = element; node; node = node.parentElement) {
        const parsed = toRgb(getComputedStyle(node).backgroundColor);
        if (parsed && (parsed[3] === undefined || parsed[3] > 0)) return parsed;
      }
      return null;
    };
    const ratioFor = (element) => {
      const foreground = toRgb(getComputedStyle(element).color);
      const behind = background(element);
      if (!foreground || !behind) return null;
      const [lighter, darker] = [luminance(foreground), luminance(behind)].sort((left, right) => right - left);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const node = document.querySelector(${JSON.stringify(selector)});
    return node ? { ratio: ratioFor(node), fontSizePx: Number.parseFloat(getComputedStyle(node).fontSize), text: node.textContent.trim(), boxHeight: node.getBoundingClientRect().height, display: getComputedStyle(node).display } : null;
  })()`;
}

async function panelFacts(cdp) {
  return evaluate(cdp, `(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const textParents = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.parentElement?.textContent.trim() && node.parentElement.getClientRects().length) textParents.push(node.parentElement);
    const directTextElements = [...new Set(textParents)];
    const toRgb = (value) => {
      const match = value.match(/rgba?\\(([^)]+)\\)/);
      if (!match) return null;
      const values = match[1].split(",").map((part) => Number(part.trim()));
      return values.length >= 3 ? values : null;
    };
    const luminance = ([red, green, blue]) => [red, green, blue].map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const ratio = (element) => {
      const foreground = toRgb(getComputedStyle(element).color);
      let background = null;
      for (let node = element; node; node = node.parentElement) {
        const candidate = toRgb(getComputedStyle(node).backgroundColor);
        if (candidate && (candidate[3] === undefined || candidate[3] > 0)) { background = candidate; break; }
      }
      if (!foreground || !background) return null;
      const [lighter, darker] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const outsideFailures = directTextElements.filter((element) => !element.closest(".panel--sunken") && (ratio(element) ?? Infinity) < 4.5).length;
    const grid = document.querySelector(".pass-grid");
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")];
    return {
      passGridAltMissing: grid && !["alt", "aria-label", "aria-labelledby", "title", "role"].some((name) => grid.hasAttribute(name)) ? 1 : 0,
      closuresBannerAbsent: document.querySelector('[data-slot="closures"]')?.children.length === 0 ? 1 : 0,
      headingSkipPresent: headings.some((heading, index) => index > 0 && headings[index - 1].tagName === "H2" && heading.tagName === "H4") ? 1 : 0,
      paletteToken: getComputedStyle(document.documentElement).getPropertyValue("--text-muted").trim(),
      contrastFailuresOutsidePanel: outsideFailures,
    };
  })()`);
}

function range(name, expected, actual) {
  return { name, expected, actual, ok: actual >= expected.min && actual <= expected.max };
}

export default {
  id: "case-c",
  publicRoot,
  chromeFlavor: "chrome",

  async handle(req, res, { manifest, state }) {
    res.sendDate = false;
    const pathname = new URL(req.url ?? "/", "http://fixture.invalid").pathname;
    if (pathname === "/") {
      if (req.method !== "GET" && req.method !== "HEAD") { methodNotAllowed(res); return true; }
      const document = await readFile(join(publicRoot, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": document.length, "X-Robots-Tag": "noindex" });
      res.end(req.method === "HEAD" ? undefined : document);
      return true;
    }
    if (pathname === "/api/palette") {
      if (req.method !== "GET") { methodNotAllowed(res); return true; }
      json(res, { tokens: manifest.palette, densityScale: manifest.densityScale });
      return true;
    }
    if (pathname === "/api/pass-tiers") {
      if (req.method !== "GET") { methodNotAllowed(res); return true; }
      json(res, passTiers);
      return true;
    }
    if (pathname === "/api/hours") {
      if (req.method !== "GET") { methodNotAllowed(res); return true; }
      json(res, hours);
      return true;
    }
    if (pathname === "/api/notices") {
      if (req.method !== "GET") { methodNotAllowed(res); return true; }
      json(res, notices);
      return true;
    }
    if (pathname === "/api/requests") {
      if (req.method !== "POST") { methodNotAllowed(res); return true; }
      const request = await requestJson(req);
      state.requests ??= [];
      state.requests.push(request);
      json(res, { reference: "MPR-2026-4417" });
      return true;
    }
    return false;
  },

  async reset({ state }) {
    for (const key of Object.keys(state)) delete state[key];
  },

  async preflight({ url, cdp, variant }) {
    const consoleErrors = [];
    const documentResponses = [];
    const activeRequests = new Set();
    const removeConsoleListener = cdp.on("Runtime.consoleAPICalled", (params) => { if (params.type === "error") consoleErrors.push(params); });
    const removeResponseListener = cdp.on("Network.responseReceived", (params) => { if (params.type === "Document" && params.response.url === `${url}/`) documentResponses.push(params.response); });
    const removeRequestListener = cdp.on("Network.requestWillBeSent", (params) => activeRequests.add(params.requestId));
    const removeFinishedListener = cdp.on("Network.loadingFinished", (params) => activeRequests.delete(params.requestId));
    const removeFailedListener = cdp.on("Network.loadingFailed", (params) => activeRequests.delete(params.requestId));
    try {
      await cdp.send("Network.enable");
      await cdp.send("Runtime.enable");
      await cdp.send("Page.enable");
      const expected = variant === "faulty"
        ? { refund: { min: 3.2, max: 3.32 }, white: { min: 4.7, max: 4.83 } }
        : { refund: { min: 5.55, max: 5.73 }, white: { min: 8.15, max: 8.34 } };
      const replicas = [];
      for (let replica = 0; replica < 3; replica += 1) {
        const errorOffset = consoleErrors.length;
        const responseOffset = documentResponses.length;
        await cdp.send("Page.navigate", { url });
        await waitForPage(cdp, activeRequests);
        const desktop = await evaluate(cdp, contrastProbe(REFUND_SELECTOR));
        const white = await evaluate(cdp, contrastProbe('[data-field="staffed-hours"]'));
        const facts = await panelFacts(cdp);
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 412, height: 823, deviceScaleFactor: 2.625, mobile: true });
        let mobile;
        try { mobile = await evaluate(cdp, contrastProbe(REFUND_SELECTOR)); } finally { await cdp.send("Emulation.clearDeviceMetricsOverride"); }
        const robotsHeaderNoindex = documentResponses.slice(responseOffset).some((response) => Object.entries(response.headers).some(([name, value]) => name.toLowerCase() === "x-robots-tag" && String(value).toLowerCase().includes("noindex"))) ? 1 : 0;
        replicas.push([
          range("refundSentenceContrast", expected.refund, desktop?.ratio ?? NaN),
          range("refundSentenceContrastMobile", expected.refund, mobile?.ratio ?? NaN),
          range("mutedOnWhiteContrast", expected.white, white?.ratio ?? NaN),
          range("refundSentencePresent", { min: 1, max: 1 }, desktop?.text && desktop.boxHeight > 0 && desktop.display !== "none" ? 1 : 0),
          range("refundSentenceFontSizePx", { min: 12, max: 16 }, desktop?.fontSizePx ?? NaN),
          range("contrastFailuresOutsidePanel", { min: 0, max: 0 }, facts.contrastFailuresOutsidePanel),
          range("robotsHeaderNoindex", { min: 1, max: 1 }, robotsHeaderNoindex),
          range("passGridAltMissing", { min: 1, max: 1 }, facts.passGridAltMissing),
          range("consoleErrorCount", { min: 1, max: 3 }, consoleErrors.length - errorOffset),
          range("closuresBannerAbsent", { min: 1, max: 1 }, facts.closuresBannerAbsent),
          range("headingSkipPresent", { min: 1, max: 1 }, facts.headingSkipPresent),
          range("paletteTokenApplied", { min: 1, max: 1 }, facts.paletteToken.toLowerCase() === (variant === "faulty" ? "#6e737c" : "#4a4f57") ? 1 : 0),
        ]);
      }
      const assertions = replicas.flat();
      return { ok: assertions.every((assertion) => assertion.ok), variant, assertions };
    } finally {
      removeConsoleListener();
      removeResponseListener();
      removeRequestListener();
      removeFinishedListener();
      removeFailedListener();
    }
  },

};
