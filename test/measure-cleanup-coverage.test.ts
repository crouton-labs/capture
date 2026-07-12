import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { closeChrome, spawnHeadlessChrome } from './fixtures/chrome.js';

import { CAPTURE_ROOT, writeJsonPrivate } from '../src/session/artifacts.js';
import { CDPClient } from '../src/cdp/client.js';
import { enableDomainsForSnap } from '../src/cdp/domains.js';
import type { SnapshotContext } from '../src/cdp/measure/types.js';

import { collectAx } from '../src/cdp/measure/collectors/ax.js';
import { collectMedia, type MediaReport } from '../src/cdp/measure/collectors/media.js';
import { collectQueries } from '../src/cdp/measure/collectors/queries.js';

// Three distinct secret shapes, planted into every page-controlled string
// these three collectors emit (AX name/description, media currentSrc/poster/
// iframe src, media query text / affected selectors / container name). Each
// must be redacted before it lands in the artifact JSON — the shared
// redaction authority applies here exactly as it does in text/forms.
const SK_SENTINEL = 'sk-ADVSK1111aaaaBBBBccccDDDDeeeeFFFF';
const JWT_SENTINEL = 'eyJhbGciOiJBRFYiLCJ0eXAiOiJKV1QifQ.eyJhZHZlcnNhcmlhbCI6InNlbnRpbmVsIn0.QURWX0pXVF9TSUdOQVRVUkVfU0VOVElORUw';
const GH_PAT_SENTINEL = 'github_pat_ADVPATaaaa1111BBBBcccc2222DDDDeeee3333FFFFgggg4444';

function asClient(stub: { send(method: string, params?: Record<string, unknown>): Promise<unknown> }): CDPClient {
  return stub as unknown as CDPClient;
}

function freshSnapDir(label: string): string {
  return path.join(CAPTURE_ROOT, `measure-cleanup-coverage-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

function rawJson(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

// ============================================================================
// ax.ts
// ============================================================================

class AxStub {
  constructor(private readonly nodes: unknown[]) {}
  async send(method: string): Promise<unknown> {
    if (method === 'Accessibility.getFullAXTree') return { nodes: this.nodes };
    return {};
  }
}

test('collectAx: a secret-shaped aria-label/description is redacted and never appears raw in ax.json', async () => {
  const dir = freshSnapDir('ax-redact');
  try {
    const stub = new AxStub([
      {
        nodeId: '1',
        ignored: false,
        role: { type: 'internalRole', value: 'textbox' },
        name: { type: 'computedString', value: `API token ${SK_SENTINEL}` },
        description: { type: 'computedString', value: `see ${JWT_SENTINEL} for details` },
        backendDOMNodeId: 7,
      },
    ]);
    await collectAx(makeCtx(stub, dir));

    const file = path.join(dir, 'ax.json');
    const ax = readJson(file);
    assert.equal(ax.nodes[0].axName, 'API token [REDACTED]');
    assert.equal(ax.nodes[0].description, 'see [REDACTED] for details');
    const raw = rawJson(file);
    assert.ok(!raw.includes(SK_SENTINEL), 'sk- sentinel must not appear raw in ax.json');
    assert.ok(!raw.includes(JWT_SENTINEL), 'JWT sentinel must not appear raw in ax.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectAx: emits an explicit top-document scope fact', async () => {
  const dir = freshSnapDir('ax-coverage');
  try {
    const stub = new AxStub([
      { nodeId: '1', ignored: false, role: { type: 'internalRole', value: 'button' }, name: { value: 'Send' }, backendDOMNodeId: 1 },
    ]);
    await collectAx(makeCtx(stub, dir));
    const ax = readJson(path.join(dir, 'ax.json'));
    assert.deepEqual(ax.coverage, { scope: 'top-document' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// media.ts
// ============================================================================

class MediaStub {
  constructor(private readonly facts: unknown[]) {}
  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureMediaInventory')) return { result: { value: this.facts } };
      return { result: {} };
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    return {};
  }
}

function mediaFact(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    tag: 'img',
    cssPath: 'img:nth-of-type(1)',
    rect: { x: 0, y: 0, width: 100, height: 100 },
    visible: true,
    naturalWidth: 100,
    naturalHeight: 100,
    currentSrc: null,
    decodeState: 'complete',
    poster: null,
    objectFit: 'fill',
    objectPosition: '50% 50%',
    contextType: null,
    backingWidth: null,
    backingHeight: null,
    src: null,
    crossOrigin: null,
    dpr: 1,
    ...overrides,
  };
}

test('collectMedia: secret-shaped currentSrc/poster/iframe-src are redacted and never appear raw in media.json', async () => {
  const dir = freshSnapDir('media-redact');
  try {
    const facts = [
      mediaFact({ tag: 'img', currentSrc: `https://cdn.test/a.jpg?token=${SK_SENTINEL}` }),
      mediaFact({ tag: 'video', currentSrc: `https://cdn.test/v.mp4?sig=${JWT_SENTINEL}`, poster: `https://cdn.test/p.jpg?k=${SK_SENTINEL}`, decodeState: 'HAVE_ENOUGH_DATA' }),
      mediaFact({ tag: 'iframe', src: `https://embed.test/?auth=${GH_PAT_SENTINEL}`, crossOrigin: true }),
    ];
    await collectMedia(makeCtx(new MediaStub(facts), dir));

    const file = path.join(dir, 'media.json');
    const media = readJson(file);
    assert.ok(media.elements[0].currentSrc.includes('[REDACTED]'));
    assert.ok(media.elements[1].poster.includes('[REDACTED]'));
    assert.ok(media.elements[2].src.includes('[REDACTED]'));
    const raw = rawJson(file);
    assert.ok(!raw.includes(SK_SENTINEL), 'sk- sentinel must not appear raw in media.json');
    assert.ok(!raw.includes(JWT_SENTINEL), 'JWT sentinel must not appear raw in media.json');
    assert.ok(!raw.includes(GH_PAT_SENTINEL), 'github_pat_ sentinel must not appear raw in media.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectMedia: a plain URL survives sanitization unchanged', async () => {
  const dir = freshSnapDir('media-plain');
  try {
    await collectMedia(makeCtx(new MediaStub([mediaFact({ currentSrc: 'https://example.test/hero.jpg' })]), dir));
    const media = readJson(path.join(dir, 'media.json'));
    assert.equal(media.elements[0].currentSrc, 'https://example.test/hero.jpg');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectMedia: emits an explicit top-document scope fact', async () => {
  const dir = freshSnapDir('media-coverage');
  try {
    await collectMedia(makeCtx(new MediaStub([mediaFact({})]), dir));
    const media = readJson(path.join(dir, 'media.json'));
    assert.deepEqual(media.coverage, { scope: 'top-document' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// media.ts (real headless Chrome) -- the stub tests above hand `MediaStub`
// hand-authored facts directly, so `Runtime.evaluate` never actually runs
// `MEDIA_SCRIPT`; a bug inside that in-page script (a wrong field name, a
// dropped `el.currentSrc` read, ...) would not be caught by them. This
// block runs the real `collectMedia` collector -- real `MEDIA_SCRIPT`,
// real `CDPClient`, real `DOM.getDocument` -- against a fixture page with
// secret-shaped values planted directly in DOM attributes, closing that
// gap. Harness copied from `measure-ax-queries-media-invariants.test.ts`
// (no shared harness module exists in this repo -- see that file's header).
// ============================================================================


const MEDIA_REDACT_TINY_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
// A data: URI's fragment is not part of the base64 payload, so appending the sentinel there plants
// a secret-shaped substring in `el.currentSrc` without corrupting image decoding.
const MEDIA_REDACT_IMG_SRC = `${MEDIA_REDACT_TINY_GIF}#${SK_SENTINEL}`;
const MEDIA_REDACT_POSTER = `https://cdn.test/poster.jpg?k=${SK_SENTINEL}`;
const MEDIA_REDACT_IFRAME_SRC = `https://embed.test/?auth=${GH_PAT_SENTINEL}`;

const MEDIA_REDACT_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
<img id="redact-img" src="${MEDIA_REDACT_IMG_SRC}" width="10" height="10">
<video id="redact-video" poster="${MEDIA_REDACT_POSTER}" width="10" height="10"></video>
<iframe id="redact-iframe" src="${MEDIA_REDACT_IFRAME_SRC}" width="10" height="10"></iframe>
</body></html>`;
const MEDIA_REDACT_FIXTURE_URL = `data:text/html,${encodeURIComponent(MEDIA_REDACT_FIXTURE_HTML)}`;

async function newPageTarget(port: number): Promise<string> {
  const resp = await fetch(`http://localhost:${port}/json/new?about:blank`, { method: 'PUT' });
  const json = (await resp.json()) as { webSocketDebuggerUrl?: string };
  if (!json.webSocketDebuggerUrl) throw new Error('no webSocketDebuggerUrl in /json/new response');
  return json.webSocketDebuggerUrl;
}

async function waitForRedactFixtureReady(client: CDPClient, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await client.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && document.getElementById('redact-iframe') !== null`,
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (res.result?.value) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('media-redaction fixture page did not reach readyState=complete in time');
}

describe('collectMedia (real headless Chrome): secret-shaped src/poster/iframe-src planted in real DOM attributes are redacted', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;
  let dir: string;
  let media: MediaReport;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;

    const wsUrl = await newPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);

    await client.send('Page.navigate', { url: MEDIA_REDACT_FIXTURE_URL });
    await waitForRedactFixtureReady(client);

    dir = freshSnapDir('media-redact-real-chrome');
    await collectMedia(makeCtx(client, dir));
    media = readJson(path.join(dir, 'media.json')) as MediaReport;
  }, { timeout: 45000 });

  after(async () => {
    try {
      client?.close();
    } catch {
      // already closed
    }
    try {
      await closeChrome(chromeProc);
    } catch {
      // already dead
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  test('the real-Chrome-executed MEDIA_SCRIPT captures the img currentSrc, and the collector redacts it', () => {
    const img = media.elements.find((e) => e.tag === 'img');
    assert.ok(img, 'expected a media.json record for #redact-img');
    assert.ok(
      img!.currentSrc != null && img!.currentSrc.includes('[REDACTED]'),
      `expected img.currentSrc to be captured (non-null) AND redacted, got ${JSON.stringify(img!.currentSrc)} -- ` +
        'a stub-driven test cannot catch a MEDIA_SCRIPT regression that stops capturing currentSrc entirely, since the stub never executes MEDIA_SCRIPT',
    );
  });

  test('the real-Chrome-executed MEDIA_SCRIPT captures the video poster, and the collector redacts it', () => {
    const video = media.elements.find((e) => e.tag === 'video');
    assert.ok(video, 'expected a media.json record for #redact-video');
    assert.ok(
      video!.poster != null && video!.poster.includes('[REDACTED]'),
      `expected video.poster to be captured (non-null) AND redacted, got ${JSON.stringify(video!.poster)}`,
    );
  });

  test('the real-Chrome-executed MEDIA_SCRIPT captures the iframe src, and the collector redacts it', () => {
    const iframe = media.elements.find((e) => e.tag === 'iframe');
    assert.ok(iframe, 'expected a media.json record for #redact-iframe');
    assert.ok(
      iframe!.src != null && iframe!.src.includes('[REDACTED]'),
      `expected iframe.src to be captured (non-null) AND redacted, got ${JSON.stringify(iframe!.src)}`,
    );
  });

  test('none of the planted secrets survive raw in media.json', () => {
    const raw = rawJson(path.join(dir, 'media.json'));
    assert.ok(!raw.includes(SK_SENTINEL), 'sk- sentinel must not appear raw in media.json (real Chrome)');
    assert.ok(!raw.includes(GH_PAT_SENTINEL), 'github_pat_ sentinel must not appear raw in media.json (real Chrome)');
  });
});

// ============================================================================
// queries.ts
// ============================================================================

class QueriesStub {
  constructor(private readonly report: unknown) {}
  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureQueriesInventory')) return { result: { value: this.report } };
      return { result: {} };
    }
    return {};
  }
}

test('collectQueries: secret-shaped query text / selectors / container name are redacted, never raw in queries.json', async () => {
  const dir = freshSnapDir('queries-redact');
  try {
    const report = {
      environment: {
        width: 390,
        height: 844,
        dpr: 2,
        colorScheme: 'light',
        pointer: 'fine',
        hover: 'hover',
        reducedMotion: 'no-preference',
        forcedColors: 'none',
      },
      mediaQueries: [
        { query: `(max-width: 640px) /* ${SK_SENTINEL} */`, matched: true, affectedSelectors: [`.a-${JWT_SENTINEL}`] },
      ],
      containerQueries: [
        {
          containerName: `main-${GH_PAT_SENTINEL}`,
          containerSelector: `.container-${SK_SENTINEL}`,
          containerSize: { width: 300, height: 200 },
          query: `(min-width: 200px) ${JWT_SENTINEL}`,
          matched: true,
          affectedSelectors: [`.card-${SK_SENTINEL}`],
        },
      ],
    };
    await collectQueries(makeCtx(new QueriesStub(report), dir));

    const file = path.join(dir, 'queries.json');
    const raw = rawJson(file);
    assert.ok(!raw.includes(SK_SENTINEL), 'sk- sentinel must not appear raw in queries.json');
    assert.ok(!raw.includes(JWT_SENTINEL), 'JWT sentinel must not appear raw in queries.json');
    assert.ok(!raw.includes(GH_PAT_SENTINEL), 'github_pat_ sentinel must not appear raw in queries.json');

    const q = readJson(file);
    assert.ok(q.mediaQueries[0].query.includes('[REDACTED]'));
    assert.ok(q.mediaQueries[0].affectedSelectors[0].includes('[REDACTED]'));
    assert.ok(q.containerQueries[0].containerName.includes('[REDACTED]'));
    assert.ok(q.containerQueries[0].containerSelector.includes('[REDACTED]'));
    assert.ok(q.containerQueries[0].query.includes('[REDACTED]'));
    assert.ok(q.containerQueries[0].affectedSelectors[0].includes('[REDACTED]'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectQueries: ordinary media/container query text survives unchanged and emits a top-document scope fact', async () => {
  const dir = freshSnapDir('queries-plain');
  try {
    const report = {
      environment: {
        width: 390,
        height: 844,
        dpr: 2,
        colorScheme: 'light',
        pointer: 'coarse',
        hover: 'none',
        reducedMotion: 'no-preference',
        forcedColors: 'none',
      },
      mediaQueries: [{ query: '(max-width: 640px)', matched: true, affectedSelectors: ['.card-grid'] }],
      containerQueries: [],
    };
    await collectQueries(makeCtx(new QueriesStub(report), dir));
    const q = readJson(path.join(dir, 'queries.json'));
    assert.equal(q.mediaQueries[0].query, '(max-width: 640px)');
    assert.deepEqual(q.mediaQueries[0].affectedSelectors, ['.card-grid']);
    assert.deepEqual(q.coverage, { scope: 'top-document' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
