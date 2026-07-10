/**
 * Adversarial invariant tests for `ax.ts` / `queries.ts` / `media.ts` (C2
 * remediation). Two harnesses:
 *
 * - A real headless-Chrome session (one Chrome instance, one fixture page,
 *   shared across every `test()` in this file — mirrors
 *   `test/measure-geometry-hittest.test.ts`) for the invariants a stub
 *   cannot prove: no page-observable side effect (Finding A, I-1/I-6),
 *   backendNodeId identity EQUALITY across artifacts (Finding D, I-3), and
 *   the actual in-page CSSOM-walking arithmetic in `queries.ts`'s
 *   `QUERIES_SCRIPT` (Finding C-queries) — a stub bypasses that script
 *   entirely, so only real Chrome executing it proves the cap counts are
 *   both syntactically valid and arithmetically correct.
 * - Stub-driven unit tests for the node-side cap arithmetic in `ax.ts`
 *   (Finding C-ax) and the small companion total-count script in
 *   `media.ts` (Finding C-media), per the I-5 evidence bar ("stub the
 *   domain to return nothing; exceed the cap").
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CAPTURE_ROOT, writeJsonPrivate } from '../src/session/artifacts.js';
import { CDPClient } from '../src/cdp/client.js';
import { enableDomainsForSnap } from '../src/cdp/domains.js';
import type { SnapshotContext, SnapshotWriter } from '../src/cdp/measure/types.js';

import { collectAx, type AxReport, type AxNodeRecord } from '../src/cdp/measure/collectors/ax.js';
import { collectMedia, type MediaReport } from '../src/cdp/measure/collectors/media.js';
import { collectQueries, type QueriesReport } from '../src/cdp/measure/collectors/queries.js';
import { collectGeometry, type GeometryElementRecord } from '../src/cdp/measure/collectors/geometry.js';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

interface GeometryJson {
  elements: GeometryElementRecord[];
}

// ============================================================================
// Real-Chrome fixture — one page exercising every real-Chrome-required
// finding at once, so one Chrome launch + one navigation covers all of them:
//
// - `#cv` (canvas): Finding A -- a `getContext` spy is installed on
//   `HTMLCanvasElement.prototype` BEFORE `collectMedia` runs; the spy must
//   never fire.
// - `#ax-target` (button) / `#media-target` (img): Finding D -- each must
//   resolve the SAME `backendNodeId` in `ax.json`/`media.json` as
//   `geometry.json` resolves for the same element.
// - 310 `role="listitem"` divs: Finding C (ax) -- guaranteed non-ignored AX
//   nodes with a `backendDOMNodeId`, comfortably over `AX_MAX_RECT_LOOKUPS`
//   (300), so the rect-lookup cap must fire and be counted.
// - 205 extra `<img>` tags (+ `#cv` + `#media-target` = 207 total
//   img/video/canvas/svg/iframe elements): Finding C (media) -- over
//   `MEDIA_MAX_ELEMENTS` (200).
// - A `<style>` block with 55 `@media` rules (one holding 25 selectors) and
//   32 `@container` rules (one holding 25 selectors): Finding C (queries)
//   -- over `MAX_MEDIA_QUERIES` (50) / `MAX_CONTAINER_QUERIES` (30) /
//   `MAX_AFFECTED_SELECTORS` (20), and only a real browser executing
//   `QUERIES_SCRIPT`'s actual CSSOM walk can prove the arithmetic (a stub
//   never runs that script at all).
// ============================================================================

const AX_ITEM_COUNT = 310; // > AX_MAX_RECT_LOOKUPS (300)
const MEDIA_IMG_COUNT = 205; // + #cv + #media-target = 207 > MEDIA_MAX_ELEMENTS (200)
const RICH_MEDIA_SELECTORS = 25; // > MAX_AFFECTED_SELECTORS (20)
const TRIVIAL_MEDIA_QUERIES = 54; // + 1 rich = 55 > MAX_MEDIA_QUERIES (50)
const RICH_CONTAINER_SELECTORS = 25; // > MAX_AFFECTED_SELECTORS (20)
const TRIVIAL_CONTAINER_QUERIES = 31; // + 1 rich = 32 > MAX_CONTAINER_QUERIES (30)

function repeatSelectors(prefix: string, count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += `.${prefix}${i}{}\n`;
  return out;
}

function buildCss(): string {
  let css = `@media (min-width: 0px) {\n${repeatSelectors('msel', RICH_MEDIA_SELECTORS)}}\n`;
  for (let i = 0; i < TRIVIAL_MEDIA_QUERIES; i++) css += `@media (min-width: ${i + 1}px) {}\n`;
  css += `@container (min-width: 0px) {\n${repeatSelectors('csel', RICH_CONTAINER_SELECTORS)}}\n`;
  for (let i = 0; i < TRIVIAL_CONTAINER_QUERIES; i++) css += `@container (min-width: ${i + 1}px) {}\n`;
  return css;
}

function buildAxItems(): string {
  let out = '';
  for (let i = 0; i < AX_ITEM_COUNT; i++) {
    out += `<div role="listitem" aria-label="ax-item-${i}" style="position:absolute;top:${2000 + i}px;left:0;width:2px;height:2px;">i</div>\n`;
  }
  return out;
}

const TINY_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
// The #media-target img shares TINY_GIF's exact byte payload (so decoding behaves identically to
// the 205 filler images) but is given a distinct URL via a trailing fragment -- currentSrc is the
// verbatim src string, so this makes #media-target the ONLY element in the fixture whose currentSrc
// equals MEDIA_TARGET_SRC, unlike every filler image which shares the bare TINY_GIF currentSrc.
const MEDIA_TARGET_SRC = `${TINY_GIF}#media-target`;

// Named container-query fixture (queries.ts container-name matching): #outer-container (500px,
// named "outer-container") wraps #inner-container (300px, named "inner-container") wraps
// .named-target. The rule below queries "outer-container (min-width: 400px)" -- true for the OUTER
// container's 500px width, false for the nearer INNER container's 300px width -- so resolving the
// nearest non-normal ancestor (ignoring the rule's container-name) reports the wrong container
// (300px, unmatched) while resolving the NAMED ancestor reports the right one (500px, matched).
const NAMED_CONTAINER_CSS = `
@container outer-container (min-width: 400px) {
  .named-target {}
}
`;
const NAMED_CONTAINER_HTML = `
<div id="outer-container" style="container-type: inline-size; container-name: outer-container; width: 500px;">
  <div id="inner-container" style="container-type: inline-size; container-name: inner-container; width: 300px;">
    <div class="named-target">hi</div>
  </div>
</div>
`;

function buildMediaImgs(): string {
  let out = '';
  for (let i = 0; i < MEDIA_IMG_COUNT; i++) {
    out += `<img src="${TINY_GIF}" style="position:absolute;top:${3000 + i}px;left:0;width:1px;height:1px;">\n`;
  }
  return out;
}

const FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
<style>${NAMED_CONTAINER_CSS}${buildCss()}</style>
<canvas id="cv" width="10" height="10" style="position:absolute;top:0;left:0;"></canvas>
<button id="ax-target" style="position:absolute;top:20px;left:0;width:40px;height:20px;">Send</button>
<img id="media-target" src="${MEDIA_TARGET_SRC}" width="50" height="50" style="position:absolute;top:50px;left:0;">
${NAMED_CONTAINER_HTML}
${buildAxItems()}
${buildMediaImgs()}
</body></html>`;

const FIXTURE_URL = `data:text/html,${encodeURIComponent(FIXTURE_HTML)}`;

// ============================================================================
// Chrome process harness -- self-contained, mirrors measure-geometry-hittest.test.ts / measure-focus-geometry-identity.test.ts.
// ============================================================================

async function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${url}: ${String(lastErr)}`);
}

async function spawnHeadlessChrome(): Promise<{ proc: ChildProcess; port: number }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const port = 19200 + Math.floor(Math.random() * 700) + attempt * 137;
    const proc = spawn(
      CHROME_PATH,
      ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
      { stdio: 'ignore' },
    );
    try {
      await waitForHttpOk(`http://localhost:${port}/json/version`, 8000);
      return { proc, port };
    } catch (err) {
      lastErr = err;
      try {
        proc.kill('SIGKILL');
      } catch {
        // already dead
      }
    }
  }
  throw new Error(`failed to spawn headless Chrome after 3 attempts: ${String(lastErr)}`);
}

async function newPageTarget(port: number): Promise<string> {
  const resp = await fetch(`http://localhost:${port}/json/new?about:blank`, { method: 'PUT' });
  const json = (await resp.json()) as { webSocketDebuggerUrl?: string };
  if (!json.webSocketDebuggerUrl) throw new Error('no webSocketDebuggerUrl in /json/new response');
  return json.webSocketDebuggerUrl;
}

async function waitForFixtureReady(client: CDPClient, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await client.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && document.getElementById('media-target') !== null`,
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (res.result?.value) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('fixture page did not reach readyState=complete in time');
}

function makeInMemoryWriter(store: Record<string, unknown>): SnapshotWriter {
  return {
    json(filename, value) {
      store[filename] = value;
    },
    binary(filename, data) {
      store[filename] = data;
    },
  };
}

let chromeProc: ChildProcess | undefined;
let client: CDPClient | undefined;
let getContextCallCount = -1;
let ax: AxReport;
let media: MediaReport;
let queries: QueriesReport;
let geometry: GeometryJson;

before(async () => {
  const { proc, port } = await spawnHeadlessChrome();
  chromeProc = proc;

  const wsUrl = await newPageTarget(port);
  client = new CDPClient(wsUrl);
  await client.waitReady();
  await enableDomainsForSnap(client);
  await client.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 300, deviceScaleFactor: 1, mobile: false });
  await client.send('Page.bringToFront');

  await client.send('Page.navigate', { url: FIXTURE_URL });
  await waitForFixtureReady(client);

  // Finding A instrumentation: install a `getContext` spy BEFORE running any
  // collector. This is a TEST-ONLY diagnostic global (analogous to the
  // MutationObserver/defineProperty diagnostics used for I-1/I-2 elsewhere)
  // -- never something production collector code touches.
  await client.send('Runtime.evaluate', {
    expression: `(function () {
      window.__getContextCalls = 0;
      var orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type) {
        window.__getContextCalls++;
        return orig.apply(this, arguments);
      };
    })();`,
  });

  const store: Record<string, unknown> = {};
  const ctx: SnapshotContext = {
    client,
    dir: '/tmp/measure-ax-queries-media-invariants-test-unused',
    snapId: 'ax-queries-media-invariants-test-snap',
    url: FIXTURE_URL,
    viewport: null,
    settled: true,
    freezeAnimations: false,
    captureUnsettled: false,
    pixels: false,
    state: [],
    unstableRegions: [],
    write: makeInMemoryWriter(store),
  };

  await collectAx(ctx);
  await collectMedia(ctx);
  await collectQueries(ctx);
  await collectGeometry(ctx);

  const spyResponse = (await client.send('Runtime.evaluate', {
    expression: `window.__getContextCalls`,
    returnByValue: true,
  })) as { result?: { value?: number } };
  getContextCallCount = spyResponse.result?.value ?? -1;

  ax = store['ax.json'] as AxReport;
  media = store['media.json'] as MediaReport;
  queries = store['queries.json'] as QueriesReport;
  geometry = store['geometry.json'] as GeometryJson;
}, { timeout: 45000 });

after(async () => {
  try {
    client?.close();
  } catch {
    // already closed
  }
  try {
    chromeProc?.kill('SIGKILL');
  } catch {
    // already dead
  }
});

// ============================================================================
// Finding A -- media.ts baseline canvas.getContext side effect (I-1/I-6)
// ============================================================================

describe('Finding A: media.ts baseline collection never probes canvas.getContext', () => {
  test('collectMedia never triggers HTMLCanvasElement.prototype.getContext (real Chrome spy)', () => {
    assert.equal(
      getContextCallCount,
      0,
      `expected collectMedia to never call canvas.getContext (a baseline collector must not create/pin page-observable canvas context state); ` +
        `the spy recorded ${getContextCallCount} call(s). Pre-fix, media.ts unconditionally called el.getContext('2d'|'webgl2'|'webgl'|'bitmaprenderer') ` +
        `for every <canvas> element, so this assertion failed with a count >= 1.`,
    );
  });

  test('the canvas element record reports contextType: null (honest "not probed", not a measured absence)', () => {
    const record = media.elements.find((e) => e.tag === 'canvas');
    assert.ok(record, 'expected a media.json record for the <canvas> element');
    assert.equal(record!.contextType, null);
  });
});

// ============================================================================
// Finding D -- ax.ts + media.ts identity EQUALITY with geometry.json (I-3)
// ============================================================================

describe('Finding D: ax.json / media.json backendNodeId EQUALS geometry.json backendNodeId for the same element', () => {
  test('ax.json: #ax-target backendNodeId equals geometry.json #ax-target backendNodeId', () => {
    const axNode = ax.nodes.find((n) => n.axName === 'Send');
    assert.ok(axNode, 'expected an ax.json node for the #ax-target button (accessible name "Send")');
    assert.notEqual(axNode!.backendNodeId, undefined, 'expected the ax node to carry a backendNodeId');

    const geo = geometry.elements.find((e) => e.selector === '#ax-target');
    assert.ok(geo, 'expected a geometry.json record for #ax-target');
    assert.notEqual(geo!.backendNodeId, undefined, "expected geometry.json's #ax-target to carry a backendNodeId");

    assert.equal(
      axNode!.backendNodeId,
      geo!.backendNodeId,
      `expected ax.json's backendNodeId (${axNode!.backendNodeId}) to EQUAL geometry.json's #ax-target backendNodeId (${geo!.backendNodeId}) -- ` +
        'proving the ax record joins to the SAME DOM node across artifacts, not merely carrying some number',
    );
  });

  test('media.json: #media-target backendNodeId equals geometry.json #media-target backendNodeId', () => {
    // MEDIA_TARGET_SRC (TINY_GIF + a unique fragment) is worn by exactly ONE element in the fixture
    // -- every filler image shares the bare TINY_GIF currentSrc -- so this uniquely locates
    // #media-target rather than any of the 205 filler images with the same underlying image bytes.
    const matchingRecords = media.elements.filter((e) => e.tag === 'img' && e.currentSrc === MEDIA_TARGET_SRC);
    assert.equal(matchingRecords.length, 1, `expected exactly one media.json record with currentSrc === MEDIA_TARGET_SRC, got ${matchingRecords.length} -- the target must be uniquely identifiable, not merely one of many elements sharing this value`);
    const mediaRecord = matchingRecords[0];
    assert.ok(mediaRecord, 'expected a media.json record for the #media-target img');
    assert.notEqual(mediaRecord!.backendNodeId, undefined, 'expected the media record to carry a backendNodeId');

    const geo = geometry.elements.find((e) => e.selector === '#media-target');
    assert.ok(geo, 'expected a geometry.json record for #media-target');
    assert.notEqual(geo!.backendNodeId, undefined, "expected geometry.json's #media-target to carry a backendNodeId");

    assert.equal(
      mediaRecord!.backendNodeId,
      geo!.backendNodeId,
      `expected media.json's backendNodeId (${mediaRecord!.backendNodeId}) to EQUAL geometry.json's #media-target backendNodeId (${geo!.backendNodeId})`,
    );

    // Distinct identity, not a coincidental/constant value.
    const axGeo = geometry.elements.find((e) => e.selector === '#ax-target');
    assert.notEqual(mediaRecord!.backendNodeId, axGeo!.backendNodeId, 'expected #media-target and #ax-target to resolve DISTINCT backendNodeIds');
  });
});

// ============================================================================
// Finding C -- silent caps now emit truncation facts (I-5)
// ============================================================================

describe('Finding C: ax.ts AX_MAX_RECT_LOOKUPS cap now emits rectLookupsTruncated (real Chrome)', () => {
  test('ax.json reports a positive rectLookupsTruncated count once eligible nodes exceed the cap', () => {
    assert.notEqual(ax.rectLookupsTruncated, undefined, 'expected ax.json to carry rectLookupsTruncated once the 310 role=listitem items push eligible nodes over AX_MAX_RECT_LOOKUPS (300)');
    assert.ok(ax.rectLookupsTruncated! > 0, `expected a positive rectLookupsTruncated, got ${ax.rectLookupsTruncated}`);
  });
});

describe('Finding C: media.ts MEDIA_MAX_ELEMENTS cap now emits elementsTruncated (real Chrome)', () => {
  test('media.json reports elementsTruncated once the page has more than 200 img/video/canvas/svg/iframe elements', () => {
    // 1 #cv canvas + 1 #media-target img + 205 loop imgs = 207 total; cap is 200.
    assert.equal(media.elementsTruncated, 7, `expected media.json's elementsTruncated to be 207 - 200 = 7, got ${media.elementsTruncated}`);
    assert.equal(media.elements.length, 200, 'expected media.json to still emit exactly 200 (capped) element records');
  });
});

describe('Finding C: queries.ts MAX_MEDIA_QUERIES/MAX_CONTAINER_QUERIES/MAX_AFFECTED_SELECTORS caps now emit truncation facts (real Chrome)', () => {
  test('queries.json reports mediaQueriesTruncated once the stylesheet has more than 50 media-query rules', () => {
    assert.equal(queries.mediaQueriesTruncated, true, 'expected mediaQueriesTruncated: true (55 @media rules > MAX_MEDIA_QUERIES 50)');
    assert.equal(queries.mediaQueries.length, 50, 'expected mediaQueries to still be capped to exactly 50 records');
  });

  test('queries.json reports containerQueriesTruncated once the stylesheet has more than 30 @container rules', () => {
    assert.equal(queries.containerQueriesTruncated, true, 'expected containerQueriesTruncated: true (1 named + 32 generated = 33 @container rules > MAX_CONTAINER_QUERIES 30)');
    assert.equal(queries.containerQueries.length, 30, 'expected containerQueries to still be capped to exactly 30 records');
  });

  test('queries.json reports affectedSelectorsTruncated on the media-query record whose selector set exceeds MAX_AFFECTED_SELECTORS', () => {
    // Found by `affectedSelectorsTruncated`, not by matching the rule's serialized `query` text
    // (browsers may reformat `(min-width: 0px)` spacing/casing on serialization) -- only the one
    // rich rule (25 selectors) among the 55 generated rules has a non-empty, truncated selector set.
    const richRecord = queries.mediaQueries.find((m) => m.affectedSelectorsTruncated === true);
    assert.ok(richRecord, 'expected the rich @media rule (25 selectors) to be present within the first 50 kept records with affectedSelectorsTruncated set');
    assert.equal(richRecord!.affectedSelectors?.length, 20, 'expected affectedSelectors capped to exactly 20');
  });

  test('queries.json reports affectedSelectorsTruncated on the container-query record whose selector set exceeds MAX_AFFECTED_SELECTORS', () => {
    const richRecord = queries.containerQueries.find((c) => c.affectedSelectorsTruncated === true);
    assert.ok(richRecord, 'expected the rich @container rule (25 selectors) to be present within the first 30 kept records with affectedSelectorsTruncated set');
    assert.equal(richRecord!.affectedSelectors.length, 20, 'expected affectedSelectors capped to exactly 20');
  });
});

describe('Finding C2: queries.ts named container-query matching resolves the NAMED ancestor container, not merely the nearest (real Chrome)', () => {
  test('the "outer-container (min-width: 400px)" record resolves #outer-container (500px width), not the nearer but differently-named #inner-container (300px width)', () => {
    const record = queries.containerQueries.find((c) => c.containerName === 'outer-container');
    assert.ok(record, 'expected a queries.json record for the @container outer-container rule');
    assert.ok(record!.containerSize, 'expected a resolved containerSize');
    assert.equal(
      record!.containerSize!.width,
      500,
      `expected containerSize.width 500 (#outer-container, the ancestor whose container-name list actually contains "outer-container"), got ${record!.containerSize!.width} -- ` +
        'resolving the nearest non-normal ancestor regardless of name would report 300 (#inner-container) instead',
    );
    assert.equal(
      record!.matched,
      true,
      `expected matched: true (outer container's 500px width satisfies "min-width: 400px"); got ${record!.matched} -- ` +
        "resolving #inner-container's 300px width instead would report matched: false",
    );
  });
});

// ============================================================================
// Finding C (stub-driven, per the I-5 evidence bar: "stub the domain to
// return nothing; exceed the cap") -- cross-checks the node-side cap
// arithmetic in isolation from the real-Chrome fixture above.
// ============================================================================

function freshSnapDir(label: string): string {
  return path.join(CAPTURE_ROOT, `measure-ax-queries-media-invariants-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function asClient(stub: { send(method: string, params?: Record<string, unknown>): Promise<unknown> }): CDPClient {
  return stub as unknown as CDPClient;
}

function makeCtx(client: { send(method: string, params?: Record<string, unknown>): Promise<unknown> }, dir: string): SnapshotContext {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return {
    client: asClient(client),
    dir,
    snapId: 'snap-test',
    url: 'http://example.test',
    viewport: '390x844',
    settled: true,
    freezeAnimations: false,
    captureUnsettled: false,
    pixels: false,
    state: [],
    unstableRegions: [],
    write: {
      json(filename, value) {
        writeJsonPrivate(path.join(dir, filename), value);
      },
      binary() {
        /* unused by these collectors */
      },
    },
  };
}

function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

describe('Finding C (stub cross-check): ax.ts rect-lookup cap arithmetic', () => {
  class AxRectCapStub {
    constructor(private readonly nodeCount: number) {}
    async send(method: string): Promise<unknown> {
      if (method === 'Accessibility.getFullAXTree') {
        const nodes = Array.from({ length: this.nodeCount }, (_, i) => ({
          nodeId: String(i),
          ignored: false,
          role: { type: 'internalRole', value: 'generic' },
          backendDOMNodeId: 1000 + i,
        }));
        return { nodes };
      }
      if (method === 'DOM.getBoxModel') {
        return { model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } };
      }
      return {};
    }
  }

  test('exceeding AX_MAX_RECT_LOOKUPS (300) with 350 eligible nodes emits rectLookupsTruncated: 50', async () => {
    const dir = freshSnapDir('ax-rect-cap');
    try {
      await collectAx(makeCtx(new AxRectCapStub(350), dir));
      const report = readJson(path.join(dir, 'ax.json')) as AxReport;
      assert.equal(report.rectLookupsTruncated, 50, `expected rectLookupsTruncated: 50 (350 eligible - 300 cap), got ${report.rectLookupsTruncated}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('staying at or under the cap (300 eligible nodes) omits rectLookupsTruncated entirely', async () => {
    const dir = freshSnapDir('ax-rect-nocap');
    try {
      await collectAx(makeCtx(new AxRectCapStub(300), dir));
      const report = readJson(path.join(dir, 'ax.json')) as AxReport;
      assert.equal(report.rectLookupsTruncated, undefined, 'expected rectLookupsTruncated to be absent when the eligible set does not exceed the cap');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Finding C (stub cross-check): media.ts element cap arithmetic', () => {
  class MediaElementCapStub {
    constructor(
      private readonly factCount: number,
      private readonly total: number,
    ) {}
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      if (method === 'Runtime.evaluate') {
        const expression = String((params as { expression?: unknown }).expression ?? '');
        if (expression.includes('__captureMediaInventory')) {
          const facts = Array.from({ length: this.factCount }, (_, i) => ({
            tag: 'img',
            cssPath: `img:nth-of-type(${i + 1})`,
            rect: { x: 0, y: 0, width: 10, height: 10 },
            visible: true,
            naturalWidth: 10,
            naturalHeight: 10,
            currentSrc: null,
            decodeState: 'complete',
            poster: null,
            objectFit: null,
            objectPosition: null,
            contextType: null,
            backingWidth: null,
            backingHeight: null,
            src: null,
            crossOrigin: null,
            dpr: 1,
          }));
          return { result: { value: facts } };
        }
        if (expression.includes('__captureMediaTotal')) return { result: { value: this.total } };
        return { result: {} };
      }
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      return {};
    }
  }

  test('a page reporting 250 total matching elements (200 kept) emits elementsTruncated: 50', async () => {
    const dir = freshSnapDir('media-elements-cap');
    try {
      await collectMedia(makeCtx(new MediaElementCapStub(200, 250), dir));
      const report = readJson(path.join(dir, 'media.json')) as MediaReport;
      assert.equal(report.elementsTruncated, 50, `expected elementsTruncated: 50 (250 total - 200 cap), got ${report.elementsTruncated}`);
      assert.equal(report.elements.length, 200);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a page reporting exactly 200 total matching elements omits elementsTruncated entirely', async () => {
    const dir = freshSnapDir('media-elements-nocap');
    try {
      await collectMedia(makeCtx(new MediaElementCapStub(200, 200), dir));
      const report = readJson(path.join(dir, 'media.json')) as MediaReport;
      assert.equal(report.elementsTruncated, undefined, 'expected elementsTruncated to be absent when total does not exceed the cap');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// Finding I-4 (stub cross-check): media.ts identity-unavailable honesty fact.
// A per-element `backendNodeId` that's simply absent (that one element's
// selector didn't resolve while the system was healthy) must be
// distinguishable, at the report level, from a whole-run identity-resolution
// failure (`DOM.getDocument`/`resolveNodeIds` never even ran) -- otherwise
// both look identical: every element missing `backendNodeId`.
// ============================================================================

describe('Finding I-4 (stub cross-check): media.ts report-level identity availability fact', () => {
  type DocResponse = 'healthy' | 'throws' | 'no-root';

  class MediaIdentityStub {
    constructor(private readonly docResponse: DocResponse) {}
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      if (method === 'Runtime.evaluate') {
        const expression = String((params as { expression?: unknown }).expression ?? '');
        if (expression.includes('__captureMediaInventory')) {
          return {
            result: {
              value: [
                {
                  tag: 'img',
                  cssPath: 'img:nth-of-type(1)',
                  rect: { x: 0, y: 0, width: 10, height: 10 },
                  visible: true,
                  naturalWidth: 10,
                  naturalHeight: 10,
                  currentSrc: null,
                  decodeState: 'complete',
                  poster: null,
                  objectFit: null,
                  objectPosition: null,
                  contextType: null,
                  backingWidth: null,
                  backingHeight: null,
                  src: null,
                  crossOrigin: null,
                  dpr: 1,
                },
              ],
            },
          };
        }
        if (expression.includes('__captureMediaTotal')) return { result: { value: 1 } };
        return { result: {} };
      }
      if (method === 'DOM.getDocument') {
        if (this.docResponse === 'throws') throw new Error('simulated DOM.getDocument failure');
        if (this.docResponse === 'no-root') return {};
        return { root: { nodeId: 1 } };
      }
      if (method === 'DOM.querySelector') return { nodeId: 5 };
      if (method === 'DOM.describeNode') return { node: { backendNodeId: 999 } };
      return {};
    }
  }

  test('DOM.getDocument throwing reports identity: { available: false, reason } -- distinct from a per-element absence', async () => {
    const dir = freshSnapDir('media-identity-throws');
    try {
      await collectMedia(makeCtx(new MediaIdentityStub('throws'), dir));
      const report = readJson(path.join(dir, 'media.json')) as MediaReport;
      assert.equal(report.identity.available, false, 'expected identity.available: false when DOM.getDocument throws');
      assert.equal((report.identity as { reason: string }).reason, 'dom-getdocument-unavailable', 'expected the fixed factual reason string when DOM.getDocument throws, not raw/page-influenced text');
      // I-3: pre-fix, a per-element identity failure OMITTED backendNodeId entirely (undefined) --
      // indistinguishable, at the record level, from a healthy element whose field just wasn't
      // requested. Post-fix, the field is explicitly null and paired with identityUnresolved:true,
      // never a silently-absent key.
      assert.equal(report.elements[0].backendNodeId, null, 'the one element has an explicit null backendNodeId (I-3), not an omitted field; identity.available:false is the separate report-level signal that distinguishes this from a healthy per-element miss');
      assert.equal(report.elements[0].identityUnresolved, true, 'expected identityUnresolved: true alongside backendNodeId: null');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('DOM.getDocument returning no root.nodeId reports identity: { available: false, reason }', async () => {
    const dir = freshSnapDir('media-identity-noroot');
    try {
      await collectMedia(makeCtx(new MediaIdentityStub('no-root'), dir));
      const report = readJson(path.join(dir, 'media.json')) as MediaReport;
      assert.equal(report.identity.available, false, 'expected identity.available: false when DOM.getDocument returns no root');
      assert.equal((report.identity as { reason: string }).reason, 'dom-getdocument-unavailable', 'expected the fixed factual reason string when DOM.getDocument returns no root, not raw/page-influenced text');
      assert.equal(report.elements[0].backendNodeId, null, 'I-3: explicit null, not an omitted field');
      assert.equal(report.elements[0].identityUnresolved, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a healthy DOM.getDocument reports identity: { available: true } explicitly', async () => {
    const dir = freshSnapDir('media-identity-healthy');
    try {
      await collectMedia(makeCtx(new MediaIdentityStub('healthy'), dir));
      const report = readJson(path.join(dir, 'media.json')) as MediaReport;
      assert.deepEqual(report.identity, { available: true }, 'expected identity: { available: true } when DOM.getDocument succeeds -- this was never explicitly asserted before Finding I-4');
      assert.equal(report.elements[0].backendNodeId, 999, 'a resolved element keeps its numeric backendNodeId, no identityUnresolved');
      assert.equal(report.elements[0].identityUnresolved, undefined, 'identityUnresolved must be absent (not false) when resolved');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('I-3: identity.available:true (whole run healthy) but ONE element\'s selector fails to resolve -- that element still gets backendNodeId:null + identityUnresolved:true, not a silently-omitted field', async () => {
    // Two-element inventory: element 0's selector resolves via DOM.querySelector; element 1's does
    // not (stub returns no nodeId for it) -- a per-element miss while the system is otherwise healthy,
    // distinct from the whole-run failures covered above.
    class MixedResolutionStub {
      async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (method === 'Runtime.evaluate') {
          const expression = String((params as { expression?: unknown }).expression ?? '');
          if (expression.includes('__captureMediaInventory')) {
            const mk = (n: number) => ({
              tag: 'img',
              cssPath: `img:nth-of-type(${n})`,
              rect: { x: 0, y: 0, width: 10, height: 10 },
              visible: true,
              naturalWidth: 10,
              naturalHeight: 10,
              currentSrc: null,
              decodeState: 'complete',
              poster: null,
              objectFit: null,
              objectPosition: null,
              contextType: null,
              backingWidth: null,
              backingHeight: null,
              src: null,
              crossOrigin: null,
              dpr: 1,
            });
            return { result: { value: [mk(1), mk(2)] } };
          }
          if (expression.includes('__captureMediaTotal')) return { result: { value: 2 } };
          return { result: {} };
        }
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        if (method === 'DOM.querySelector') {
          const selector = String((params as { selector?: unknown }).selector ?? '');
          if (selector.includes('nth-of-type(2)')) return {}; // no nodeId -- this one selector fails to resolve
          return { nodeId: 5 };
        }
        if (method === 'DOM.describeNode') return { node: { backendNodeId: 999 } };
        return {};
      }
    }

    const dir = freshSnapDir('media-identity-mixed');
    try {
      await collectMedia(makeCtx(new MixedResolutionStub(), dir));
      const report = readJson(path.join(dir, 'media.json')) as MediaReport;
      assert.deepEqual(report.identity, { available: true }, 'the whole run is healthy -- identity.available stays true');
      assert.equal(report.elements[0].backendNodeId, 999, 'element 0 resolved normally');
      assert.equal(report.elements[0].identityUnresolved, undefined);
      // RED (pre-fix): the old code emitted `backendNodeId: undefined` (an omitted key) for element 1
      // with NO identityUnresolved marker at all -- indistinguishable from element 0 simply not having
      // been read yet, and JSON.stringify drops the key entirely, so a downstream reader could not even
      // detect the miss from the artifact.
      assert.equal(report.elements[1].backendNodeId, null, "element 1's selector failed to resolve -- explicit null, not an omitted field");
      assert.equal(report.elements[1].identityUnresolved, true, 'element 1 must carry identityUnresolved:true even though the report-level identity fact is available:true');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// Phase-3 honesty sweep (stub cross-check): ax.ts / queries.ts report-level
// `available`/`unavailableReason` facts (I-5). A failed/missing top-level
// read must not be coerced into an empty-success shape.
// ============================================================================

describe('Phase 3 (stub cross-check): ax.ts report-level availability fact', () => {
  class AxAvailabilityStub {
    constructor(private readonly mode: 'no-nodes-field' | 'throws' | 'healthy-empty') {}
    async send(method: string): Promise<unknown> {
      if (method === 'Accessibility.getFullAXTree') {
        if (this.mode === 'throws') throw new Error('simulated getFullAXTree failure');
        if (this.mode === 'no-nodes-field') return {}; // no `nodes` field at all
        return { nodes: [] }; // genuinely empty tree
      }
      return {};
    }
  }

  test('Accessibility.getFullAXTree returning no `nodes` field reports available:false with a reason -- RED: pre-fix code coerced this to `nodes: []`, available absent (empty-success)', async () => {
    const dir = freshSnapDir('ax-availability-no-nodes-field');
    try {
      const report = (await (async () => {
        await collectAx(makeCtx(new AxAvailabilityStub('no-nodes-field'), dir));
        return readJson(path.join(dir, 'ax.json')) as AxReport;
      })()) as AxReport;
      assert.equal(report.available, false, 'expected available:false when `nodes` is absent from the response -- old code silently emitted nodes:[] with no available field at all (RED)');
      assert.equal(report.unavailableReason, 'axtree-returned-no-nodes');
      assert.deepEqual(report.nodes, []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Accessibility.getFullAXTree throwing reports available:false with a reason', async () => {
    const dir = freshSnapDir('ax-availability-throws');
    try {
      await collectAx(makeCtx(new AxAvailabilityStub('throws'), dir));
      const report = readJson(path.join(dir, 'ax.json')) as AxReport;
      assert.equal(report.available, false, 'expected available:false when the send throws');
      assert.equal(report.unavailableReason, 'axtree-unavailable');
      assert.deepEqual(report.nodes, []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a genuinely empty tree (`nodes: []` present) reports available:true, distinct from an unavailable read', async () => {
    const dir = freshSnapDir('ax-availability-healthy-empty');
    try {
      await collectAx(makeCtx(new AxAvailabilityStub('healthy-empty'), dir));
      const report = readJson(path.join(dir, 'ax.json')) as AxReport;
      assert.equal(report.available, true, 'a genuinely empty (but present) `nodes` array is honest empty success, not unavailable');
      assert.equal(report.unavailableReason, undefined);
      assert.deepEqual(report.nodes, []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// Findings #3/#4 (stub cross-check): ax.ts per-node `DOM.getBoxModel` rect
// lookup failure honesty. Pre-fix, BOTH a throw AND a no/malformed
// `model.content` were silently swallowed (the node just kept no `rect`),
// making a genuine read FAILURE indistinguishable from a node this
// function never even attempted a lookup for (ignored / no
// `backendDOMNodeId` / skipped by the AX_MAX_RECT_LOOKUPS cap) -- both
// looked identical: `rect` simply absent, no marker either way. Each stub
// drives the REAL `DOM.getBoxModel` call site inside `resolveRects` (not a
// simulated collector-boundary shortcut), mirroring the AxRectCapStub /
// AxAvailabilityStub pattern already established above in this file.
// ============================================================================

describe('Findings #3/#4 (stub cross-check): ax.ts per-node rect-lookup failure honesty', () => {
  function singleEligibleNodeStub(getBoxModel: () => Promise<unknown>) {
    return {
      async send(method: string): Promise<unknown> {
        if (method === 'Accessibility.getFullAXTree') {
          return {
            nodes: [
              {
                nodeId: '1',
                ignored: false,
                role: { type: 'internalRole', value: 'generic' },
                name: { type: 'computedString', value: 'target' },
                backendDOMNodeId: 42,
              },
            ],
          };
        }
        if (method === 'DOM.getBoxModel') return getBoxModel();
        return {};
      },
    };
  }

  function findTarget(report: AxReport): AxNodeRecord {
    const node = report.nodes.find((n) => n.axName === 'target');
    assert.ok(node, 'expected the stub to emit one ax.json node named "target"');
    return node!;
  }

  test('#3: DOM.getBoxModel THROWING marks rectUnavailable:true + reason box-model-read-threw (RED pre-fix: silently omitted rect, no marker)', async () => {
    const dir = freshSnapDir('ax-rect-throw');
    try {
      const stub = singleEligibleNodeStub(async () => {
        throw new Error('simulated DOM.getBoxModel failure');
      });
      await collectAx(makeCtx(stub, dir));
      const report = readJson(path.join(dir, 'ax.json')) as AxReport;
      const node = findTarget(report);
      assert.equal(node.rect, undefined, 'a failed lookup must not fabricate a rect');
      assert.equal(node.rectUnavailable, true, 'expected rectUnavailable:true when DOM.getBoxModel throws -- pre-fix this was silently absent, identical to a genuinely non-rendered node');
      assert.equal(node.rectUnavailableReason, 'box-model-read-threw');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('#4a: DOM.getBoxModel returning NO model.content marks rectUnavailable:true + reason box-model-no-content (RED pre-fix: silently omitted rect, no marker)', async () => {
    const dir = freshSnapDir('ax-rect-no-content');
    try {
      const stub = singleEligibleNodeStub(async () => ({ model: {} }));
      await collectAx(makeCtx(stub, dir));
      const report = readJson(path.join(dir, 'ax.json')) as AxReport;
      const node = findTarget(report);
      assert.equal(node.rect, undefined);
      assert.equal(node.rectUnavailable, true, 'expected rectUnavailable:true when model.content is absent -- pre-fix this was silently absent');
      assert.equal(node.rectUnavailableReason, 'box-model-no-content');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('#4b: DOM.getBoxModel returning a MALFORMED (wrong-length) content array marks rectUnavailable:true + reason box-model-no-content', async () => {
    const dir = freshSnapDir('ax-rect-malformed-content');
    try {
      const stub = singleEligibleNodeStub(async () => ({ model: { content: [0, 0, 10, 0] } })); // 4 numbers, not the required 8
      await collectAx(makeCtx(stub, dir));
      const report = readJson(path.join(dir, 'ax.json')) as AxReport;
      const node = findTarget(report);
      assert.equal(node.rect, undefined);
      assert.equal(node.rectUnavailable, true, 'expected rectUnavailable:true when content is not the required 8-number quad');
      assert.equal(node.rectUnavailableReason, 'box-model-no-content');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('#4c: DOM.getBoxModel returning an 8-entry content array containing a NON-NUMBER/NaN entry marks rectUnavailable:true + reason box-model-no-content (review-flagged gap: length===8 alone is not validation)', async () => {
    const dir = freshSnapDir('ax-rect-nan-content');
    try {
      // 8 entries (passes a naive `.length === 8` check) but one is NaN -- axisAlignedRectFromQuad
      // would silently propagate NaN through min/max arithmetic, producing a rect whose fields
      // serialize as JSON `null` with NO rectUnavailable marker at all if not explicitly validated.
      const stub = singleEligibleNodeStub(async () => ({ model: { content: [0, 0, 10, 0, NaN, 10, 0, 10] } }));
      await collectAx(makeCtx(stub, dir));
      const report = readJson(path.join(dir, 'ax.json')) as AxReport;
      const node = findTarget(report);
      assert.equal(node.rect, undefined, 'a NaN-bearing quad must not fabricate a rect (not even one with null fields)');
      assert.equal(node.rectUnavailable, true, 'expected rectUnavailable:true when content has 8 entries but one is not a finite number');
      assert.equal(node.rectUnavailableReason, 'box-model-no-content');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('positive control: a SUCCESSFUL DOM.getBoxModel (including a genuine zero-area/degenerate quad) sets rect and carries NO rectUnavailable marker', async () => {
    const dir = freshSnapDir('ax-rect-success');
    try {
      // Degenerate (zero-area) quad -- a real, honest "tiny/zero-size but rendered" box, mirroring
      // the empirically-observed real-Chrome response for e.g. `width:0;height:0;overflow:hidden`
      // (a genuine success, distinct from a read failure -- must NOT be marked unavailable).
      const stub = singleEligibleNodeStub(async () => ({ model: { content: [8, 8, 8, 8, 8, 8, 8, 8] } }));
      await collectAx(makeCtx(stub, dir));
      const report = readJson(path.join(dir, 'ax.json')) as AxReport;
      const node = findTarget(report);
      assert.deepEqual(node.rect, { x: 8, y: 8, width: 0, height: 0 }, 'a genuine zero-area box is a real observation, not a failure');
      assert.equal(node.rectUnavailable, undefined, 'a successful lookup must not carry rectUnavailable, even for a degenerate zero-size result');
      assert.equal(node.rectUnavailableReason, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a node never eligible for lookup (ignored) omits BOTH rect and rectUnavailable -- "not attempted" is distinct from "attempted and failed"', async () => {
    const dir = freshSnapDir('ax-rect-ignored');
    try {
      const stub = {
        async send(method: string): Promise<unknown> {
          if (method === 'Accessibility.getFullAXTree') {
            return {
              nodes: [
                {
                  nodeId: '1',
                  ignored: true,
                  role: { type: 'internalRole', value: 'generic' },
                  name: { type: 'computedString', value: 'ignored-target' },
                  backendDOMNodeId: 42,
                },
              ],
            };
          }
          if (method === 'DOM.getBoxModel') {
            throw new Error('must not be called for an ignored node -- it is never in the eligible set');
          }
          return {};
        },
      };
      await collectAx(makeCtx(stub, dir));
      const report = readJson(path.join(dir, 'ax.json')) as AxReport;
      const node = report.nodes.find((n) => n.axName === 'ignored-target');
      assert.ok(node, 'expected the ignored node to still appear in ax.json');
      assert.equal(node!.rect, undefined);
      assert.equal(node!.rectUnavailable, undefined, 'an ignored node was never attempted -- it must carry no failure marker, distinct from an attempted-and-failed node');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Phase 3 (stub cross-check): queries.ts report-level availability fact', () => {
  class QueriesAvailabilityStub {
    constructor(private readonly mode: 'no-value' | 'throws' | 'healthy') {}
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      if (method === 'Runtime.evaluate') {
        const expression = String((params as { expression?: unknown }).expression ?? '');
        if (expression.includes('__captureQueriesInventory')) {
          if (this.mode === 'throws') throw new Error('simulated queries evaluate failure');
          if (this.mode === 'no-value') return { result: {} }; // no `value` field at all
          return {
            result: {
              value: {
                environment: { width: 390, height: 844, dpr: 2, colorScheme: 'light', pointer: 'coarse', hover: 'none', reducedMotion: 'no-preference', forcedColors: 'none' },
                mediaQueries: [],
                mediaQueriesTruncated: false,
                containerQueries: [],
                containerQueriesTruncated: false,
                ruleWalkErrors: 0,
              },
            },
          };
        }
        return { result: {} };
      }
      return {};
    }
  }

  test('Runtime.evaluate returning no `value` reports available:false with a reason -- RED: pre-fix code silently normalized this into a default 0x0/dpr-1 environment with no available field at all (empty-success)', async () => {
    const dir = freshSnapDir('queries-availability-no-value');
    try {
      await collectQueries(makeCtx(new QueriesAvailabilityStub('no-value'), dir));
      const report = readJson(path.join(dir, 'queries.json')) as QueriesReport;
      assert.equal(report.available, false, 'expected available:false when Runtime.evaluate returns no value -- old code fabricated a default-looking environment instead (RED)');
      assert.equal(report.unavailableReason, 'queries-evaluate-returned-no-value');
      assert.equal(report.environment.width, 0, 'the default/empty shape is still emitted, but now explicitly flagged unavailable rather than passed off as real');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('Runtime.evaluate throwing reports available:false with a reason', async () => {
    const dir = freshSnapDir('queries-availability-throws');
    try {
      await collectQueries(makeCtx(new QueriesAvailabilityStub('throws'), dir));
      const report = readJson(path.join(dir, 'queries.json')) as QueriesReport;
      assert.equal(report.available, false, 'expected available:false when the send throws');
      assert.equal(report.unavailableReason, 'queries-evaluate-threw');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a real value object reports available:true', async () => {
    const dir = freshSnapDir('queries-availability-healthy');
    try {
      await collectQueries(makeCtx(new QueriesAvailabilityStub('healthy'), dir));
      const report = readJson(path.join(dir, 'queries.json')) as QueriesReport;
      assert.equal(report.available, true);
      assert.equal(report.unavailableReason, undefined);
      assert.equal(report.environment.width, 390, 'the real environment values pass through unaffected by the new field');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// Hybrid-bar honesty fix (Child 1): MARK #62/#63/#28/#29/#30 adversarial
// tests. Each proves RED (pre-fix: a failed in-page read is silently
// coerced into a benign-looking successful observation) -> GREEN (post-fix:
// an explicit unavailable/incomplete marker is emitted instead).
//
// #62/#63/#29 use a DEDICATED small real-Chrome fixture (its own Chrome
// process + navigation, separate from the shared 200+ element fixture above)
// with targeted `window`/prototype overrides that force the ACTUAL
// production MEDIA_SCRIPT/QUERIES_SCRIPT catch paths to fire for exactly
// one element/query, mirroring the getContext-spy technique already used in
// this file's shared `before()` hook.
//
// #28/#30 use a faithful stub of QUERIES_SCRIPT's post-catch return shape
// (I-11) to prove the NODE-SIDE marker-propagation fix in `normalizeReport` --
// reliably forcing the underlying CSSOM container-resolution/rule-walk
// internals (ancestor `getComputedStyle` during container resolution,
// `CSSMediaRule.media`/`cssRules` during the rule walk) to throw in real
// Chrome without collateral damage to unrelated rules on the same page is
// impractical; the stub exercises the identical shape the real script now
// emits on that throw.
// ============================================================================

describe('MARK #62/#63/#29 (real Chrome, dedicated fixture): media/queries in-page read-failure honesty markers', () => {
  const HONESTY_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
<style>@media (min-width: 1px) { .honesty-marker-sel {} }</style>
<img id="style-fail-target" src="${TINY_GIF}" width="40" height="30" style="position:absolute;top:0;left:0;object-fit:cover;">
<svg id="viewbox-fail-target" viewBox="0 0 50 25" width="50" height="25" style="position:absolute;top:40px;left:0;"></svg>
</body></html>`;
  const HONESTY_FIXTURE_URL = `data:text/html,${encodeURIComponent(HONESTY_FIXTURE_HTML)}`;

  let honestyChromeProc: ChildProcess | undefined;
  let honestyClient: CDPClient | undefined;
  let honestyMedia: MediaReport;
  let honestyQueries: QueriesReport;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    honestyChromeProc = proc;

    const wsUrl = await newPageTarget(port);
    honestyClient = new CDPClient(wsUrl);
    await honestyClient.waitReady();
    await enableDomainsForSnap(honestyClient);
    await honestyClient.send('Emulation.setDeviceMetricsOverride', { width: 300, height: 200, deviceScaleFactor: 1, mobile: false });
    await honestyClient.send('Page.bringToFront');

    await honestyClient.send('Page.navigate', { url: HONESTY_FIXTURE_URL });

    const deadline = Date.now() + 15000;
    for (;;) {
      const res = (await honestyClient.send('Runtime.evaluate', {
        expression: `document.readyState === 'complete' && document.getElementById('viewbox-fail-target') !== null`,
        returnByValue: true,
      })) as { result?: { value?: boolean } };
      if (res.result?.value) break;
      if (Date.now() > deadline) throw new Error('honesty fixture did not reach readyState=complete in time');
      await new Promise((r) => setTimeout(r, 50));
    }

    // Force MARK #62's getComputedStyle catch to fire for #style-fail-target ONLY -- every other
    // call (there are none else on this page, but this stays precise rather than a blanket throw)
    // delegates to the real implementation.
    await honestyClient.send('Runtime.evaluate', {
      expression: `(function () {
        var target = document.getElementById('style-fail-target');
        var orig = window.getComputedStyle.bind(window);
        Object.defineProperty(window, 'getComputedStyle', {
          configurable: true,
          value: function (el) {
            if (el === target) throw new Error('injected getComputedStyle failure');
            return orig(el);
          },
        });
      })();`,
    });

    // Force MARK #63's viewBox.baseVal catch: throw on ANY access to `.viewBox` on an
    // SVGSVGElement -- this fixture has exactly one <svg>, so no collateral.
    await honestyClient.send('Runtime.evaluate', {
      expression: `(function () {
        Object.defineProperty(SVGSVGElement.prototype, 'viewBox', {
          configurable: true,
          get: function () { throw new Error('injected viewBox failure'); },
        });
      })();`,
    });

    // Force MARK #29's matchMedia catch to fire for the fixture's one @media query text ONLY --
    // every other matchMedia call (QUERIES_SCRIPT's environment detection: color-scheme, pointer,
    // hover, reduced-motion, forced-colors) delegates to the real implementation, so this proves the
    // per-query catch fires without the whole QUERIES_SCRIPT eval throwing.
    await honestyClient.send('Runtime.evaluate', {
      expression: `(function () {
        var orig = window.matchMedia.bind(window);
        Object.defineProperty(window, 'matchMedia', {
          configurable: true,
          value: function (q) {
            if (q === '(min-width: 1px)') throw new Error('injected matchMedia failure');
            return orig(q);
          },
        });
      })();`,
    });

    const store: Record<string, unknown> = {};
    const ctx: SnapshotContext = {
      client: honestyClient,
      dir: '/tmp/measure-ax-queries-media-honesty-test-unused',
      snapId: 'honesty-test-snap',
      url: HONESTY_FIXTURE_URL,
      viewport: null,
      settled: true,
      freezeAnimations: false,
      captureUnsettled: false,
      pixels: false,
      state: [],
      unstableRegions: [],
      write: makeInMemoryWriter(store),
    };

    await collectMedia(ctx);
    await collectQueries(ctx);

    honestyMedia = store['media.json'] as MediaReport;
    honestyQueries = store['queries.json'] as QueriesReport;
  }, { timeout: 45000 });

  after(async () => {
    try {
      honestyClient?.close();
    } catch {
      // already closed
    }
    try {
      honestyChromeProc?.kill('SIGKILL');
    } catch {
      // already dead
    }
  });

  test('MARK #62: a thrown getComputedStyle read marks styleUnavailable:true and withholds visible/objectFit/objectPosition/crop rather than guessing from rect geometry alone', () => {
    const record = honestyMedia.elements.find((e) => e.tag === 'img');
    assert.ok(record, 'expected a media.json record for #style-fail-target');
    assert.equal(record!.styleUnavailable, true, 'expected styleUnavailable:true when getComputedStyle threw for this element');
    assert.equal(
      record!.visible,
      null,
      'expected visible:null (unknown), not a rect-derived guess -- pre-fix this element (a real, on-screen 40x30 rect with no hiding CSS) would have reported visible:true purely from rect geometry, silently ignoring that the style read (which could equally well have said display:none) never actually succeeded',
    );
    assert.equal(record!.objectFit, null);
    assert.equal(record!.objectPosition, null);
    assert.equal(
      record!.crop,
      null,
      "expected crop:null -- pre-fix, computeObjectFitCrop's `objectFit || 'fill'` fallback would have fabricated a 'fill'-mode crop fact from this image's REAL natural/rendered dimensions despite the authored object-fit:cover never actually being read",
    );
  });

  test('MARK #63: a thrown SVG viewBox.baseVal read marks intrinsicDimsUnavailable:true, distinguishing a failed read from a genuinely absent viewBox', () => {
    const record = honestyMedia.elements.find((e) => e.tag === 'svg');
    assert.ok(record, 'expected a media.json record for #viewbox-fail-target');
    assert.equal(
      record!.intrinsicDimsUnavailable,
      true,
      'expected intrinsicDimsUnavailable:true when el.viewBox threw, even though this SVG carries a REAL viewBox="0 0 50 25" attribute -- pre-fix, naturalWidth/Height staying null here was indistinguishable from an svg with no viewBox at all',
    );
    assert.equal(record!.naturalWidth, null);
    assert.equal(record!.naturalHeight, null);
  });

  test('MARK #29: a thrown matchMedia(mq).matches read marks matchUnavailable:true and withholds matched rather than reading as genuinely non-matching', () => {
    const record = honestyQueries.mediaQueries.find((m) => m.query === '(min-width: 1px)');
    assert.ok(record, "expected a queries.json record for the fixture's one @media rule");
    assert.equal(record!.matchUnavailable, true, 'expected matchUnavailable:true when window.matchMedia threw for this query');
    assert.equal(
      record!.matched,
      undefined,
      'expected matched to be withheld (undefined), not coerced to false -- pre-fix this always-true-at-300px-viewport query would have been reported matched:false, indistinguishable from a genuinely non-matching query',
    );
  });
});

describe('MARK #28 (stub cross-check): queries.ts container-resolution-failure marker propagates through normalizeReport', () => {
  class ContainerResolutionFailureStub {
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      if (method === 'Runtime.evaluate') {
        const expression = String((params as { expression?: unknown }).expression ?? '');
        if (expression.includes('__captureQueriesInventory')) {
          return {
            result: {
              value: {
                environment: { width: 390, height: 844, dpr: 2, colorScheme: 'light', pointer: 'coarse', hover: 'none', reducedMotion: 'no-preference', forcedColors: 'none' },
                mediaQueries: [],
                mediaQueriesTruncated: false,
                containerQueries: [
                  {
                    containerName: 'outer',
                    containerSelector: null,
                    containerSize: null,
                    query: '(min-width: 400px)',
                    matched: null,
                    affectedSelectors: ['.target'],
                    affectedSelectorsTruncated: false,
                    // Exactly what QUERIES_SCRIPT's describeContainerRule now emits (post-fix) when its
                    // resolution attempt threw -- pre-fix, normalizeReport had no knowledge of this field
                    // at all and silently dropped it, leaving no way to distinguish this from a genuine
                    // "no matching container"/"condition didn't parse" null.
                    resolutionUnavailable: true,
                  },
                ],
                containerQueriesTruncated: false,
                ruleWalkErrors: 0,
              },
            },
          };
        }
        return { result: {} };
      }
      return {};
    }
  }

  test('a container-query record whose in-page resolution threw carries resolutionUnavailable:true through to queries.json (RED pre-fix: the field was silently dropped)', async () => {
    const dir = freshSnapDir('queries-resolution-unavailable');
    try {
      await collectQueries(makeCtx(new ContainerResolutionFailureStub(), dir));
      const report = readJson(path.join(dir, 'queries.json')) as QueriesReport;
      const record = report.containerQueries[0];
      assert.ok(record, 'expected one containerQueries record');
      assert.equal(record.resolutionUnavailable, true, 'expected resolutionUnavailable:true to propagate through normalizeReport');
      assert.equal(record.resolutionUnavailableReason, 'container-resolution-threw');
      assert.equal(record.containerSelector, null);
      assert.equal(record.matched, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a container-query record that resolved cleanly (no resolutionUnavailable field from the script) omits it in the written report too', async () => {
    class HealthyContainerStub {
      async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (method === 'Runtime.evaluate') {
          const expression = String((params as { expression?: unknown }).expression ?? '');
          if (expression.includes('__captureQueriesInventory')) {
            return {
              result: {
                value: {
                  environment: { width: 390, height: 844, dpr: 2, colorScheme: 'light', pointer: 'coarse', hover: 'none', reducedMotion: 'no-preference', forcedColors: 'none' },
                  mediaQueries: [],
                  mediaQueriesTruncated: false,
                  containerQueries: [
                    {
                      containerName: null,
                      containerSelector: '.outer',
                      containerSize: { width: 500, height: 300 },
                      query: '(min-width: 400px)',
                      matched: true,
                      affectedSelectors: ['.target'],
                      affectedSelectorsTruncated: false,
                    },
                  ],
                  containerQueriesTruncated: false,
                  ruleWalkErrors: 0,
                },
              },
            };
          }
          return { result: {} };
        }
        return {};
      }
    }

    const dir = freshSnapDir('queries-resolution-healthy');
    try {
      await collectQueries(makeCtx(new HealthyContainerStub(), dir));
      const report = readJson(path.join(dir, 'queries.json')) as QueriesReport;
      const record = report.containerQueries[0];
      assert.equal(record.resolutionUnavailable, undefined, 'a healthy resolution must not carry resolutionUnavailable, even as `false`');
      assert.equal(record.matched, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('MARK #30 (stub cross-check): queries.ts rule-walk-incomplete count propagates to the report', () => {
  function ruleWalkStub(ruleWalkErrors: number) {
    return {
      async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (method === 'Runtime.evaluate') {
          const expression = String((params as { expression?: unknown }).expression ?? '');
          if (expression.includes('__captureQueriesInventory')) {
            return {
              result: {
                value: {
                  environment: { width: 390, height: 844, dpr: 2, colorScheme: 'light', pointer: 'coarse', hover: 'none', reducedMotion: 'no-preference', forcedColors: 'none' },
                  mediaQueries: [],
                  mediaQueriesTruncated: false,
                  containerQueries: [],
                  containerQueriesTruncated: false,
                  // Exactly what QUERIES_SCRIPT's walkRules now emits (post-fix) -- pre-fix, normalizeReport
                  // read no such field, so dropped rules were completely invisible in the written report.
                  ruleWalkErrors: ruleWalkErrors,
                },
              },
            };
          }
          return { result: {} };
        }
        return {};
      },
    };
  }

  test('a positive in-page ruleWalkErrors count is surfaced on queries.json (RED pre-fix: the field did not exist, dropped rules were invisible)', async () => {
    const dir = freshSnapDir('queries-rule-walk-errors');
    try {
      await collectQueries(makeCtx(ruleWalkStub(3), dir));
      const report = readJson(path.join(dir, 'queries.json')) as QueriesReport;
      assert.equal(report.ruleWalkErrors, 3, 'expected ruleWalkErrors:3 to propagate through normalizeReport');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a zero ruleWalkErrors count (the normal, fully-successful case) omits the field entirely', async () => {
    const dir = freshSnapDir('queries-rule-walk-errors-zero');
    try {
      await collectQueries(makeCtx(ruleWalkStub(0), dir));
      const report = readJson(path.join(dir, 'queries.json')) as QueriesReport;
      assert.equal(report.ruleWalkErrors, undefined, 'expected ruleWalkErrors to be absent (not 0) when nothing was dropped');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ============================================================================
// Whole-file sweep (Layer 2, I-5): a QUERIES_SCRIPT eval that succeeds but
// returns a structurally malformed top-level value (missing `environment` /
// `mediaQueries` not an array / etc.) must not be silently absorbed into a
// benign-looking default report -- the same class as sibling collectors'
// `walkValue?.records ?? []` / `meta.elementsTruncated ?? 0` Layer-2
// violations, found independently of the 5 assigned MARK findings while
// grepping this file for `?? default` reads (discipline #3).
// ============================================================================

describe('Whole-file sweep (Layer 2, I-5): queries.ts malformed top-level facts object honesty', () => {
  function malformedFactsStub(mode: 'missing-environment' | 'mediaqueries-not-array' | 'healthy') {
    return {
      async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (method === 'Runtime.evaluate') {
          const expression = String((params as { expression?: unknown }).expression ?? '');
          if (expression.includes('__captureQueriesInventory')) {
            const baseEnvironment = { width: 390, height: 844, dpr: 2, colorScheme: 'light', pointer: 'coarse', hover: 'none', reducedMotion: 'no-preference', forcedColors: 'none' };
            if (mode === 'missing-environment') {
              return { result: { value: { mediaQueries: [], mediaQueriesTruncated: false, containerQueries: [], containerQueriesTruncated: false } } };
            }
            if (mode === 'mediaqueries-not-array') {
              return {
                result: {
                  value: { environment: baseEnvironment, mediaQueries: null, mediaQueriesTruncated: false, containerQueries: [], containerQueriesTruncated: false },
                },
              };
            }
            return {
              result: {
                value: { environment: baseEnvironment, mediaQueries: [], mediaQueriesTruncated: false, containerQueries: [], containerQueriesTruncated: false, ruleWalkErrors: 0 },
              },
            };
          }
          return { result: {} };
        }
        return {};
      },
    };
  }

  test('a present but malformed top-level value (missing `environment` entirely) reports available:false with reason queries-facts-malformed -- RED: pre-fix code silently defaulted to a 0x0/dpr-1 environment with available:true (empty-success)', async () => {
    const dir = freshSnapDir('queries-malformed-no-environment');
    try {
      await collectQueries(makeCtx(malformedFactsStub('missing-environment'), dir));
      const report = readJson(path.join(dir, 'queries.json')) as QueriesReport;
      assert.equal(report.available, false, 'expected available:false when the top-level value is missing `environment` entirely');
      assert.equal(report.unavailableReason, 'queries-facts-malformed');
      assert.equal(report.environment.width, 0, 'the default/empty shape is still emitted, but now explicitly flagged unavailable rather than passed off as real');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a present but malformed top-level value (`mediaQueries` not an array) reports available:false with reason queries-facts-malformed", async () => {
    const dir = freshSnapDir('queries-malformed-mediaqueries');
    try {
      await collectQueries(makeCtx(malformedFactsStub('mediaqueries-not-array'), dir));
      const report = readJson(path.join(dir, 'queries.json')) as QueriesReport;
      assert.equal(report.available, false);
      assert.equal(report.unavailableReason, 'queries-facts-malformed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a well-formed top-level value reports available:true, unaffected by the new validation', async () => {
    const dir = freshSnapDir('queries-malformed-healthy');
    try {
      await collectQueries(makeCtx(malformedFactsStub('healthy'), dir));
      const report = readJson(path.join(dir, 'queries.json')) as QueriesReport;
      assert.equal(report.available, true);
      assert.equal(report.unavailableReason, undefined);
      assert.equal(report.environment.width, 390);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
