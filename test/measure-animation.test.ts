/**
 * Real-Chrome integration test for `animation.ts`'s identity work (D3): an
 * animation's target element must carry a `backendNodeId` — the same
 * cross-artifact join key geometry.json/hittest.json expose — resolved in
 * the SAME evaluate that enumerates `getAnimations()`. A `StubCdpClient`
 * can't credibly fake the CDP `objectId`->`backendNodeId` bridge over a
 * real live-element side-channel, so this drives real headless Chrome end
 * to end (mirroring `measure-geometry-hittest.test.ts`'s self-contained
 * harness).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';

import { CDPClient } from '../src/cdp/client.js';
import { enableDomainsForSnap } from '../src/cdp/domains.js';
import { collectAnimation, type AnimationReport } from '../src/cdp/measure/collectors/animation.js';
import { collectGeometry } from '../src/cdp/measure/collectors/geometry.js';
import type { GeometryElementRecord } from '../src/cdp/measure/collectors/geometry.js';
import type { SnapshotContext, SnapshotWriter } from '../src/cdp/measure/types.js';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// A page with TWO independently animated, uniquely id'd elements -- a
// single-target fixture can't catch a "first-handle" or "every-record"
// identity bug (every record would resolve the SAME backendNodeId and the
// positive-count assertions below would still pass). With two targets,
// distinctness + a cross-check against collectGeometry's own identity read
// for the SAME uniquely-selectable element pins each animation record to
// the element it actually describes, not just "some element with a
// resolved id".
const FIXTURE_HTML = `<!DOCTYPE html><html><head><style>
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes pulse { from { opacity: 0.2; } to { opacity: 1; } }
#spinner-a { animation: spin 2s linear infinite; width:40px; height:40px; background:blue; }
#spinner-b { animation: pulse 1.5s ease-in-out infinite alternate; width:30px; height:30px; background:red; }
</style></head><body style="margin:0;">
<div id="spinner-a" class="spinner-a">A</div>
<div id="spinner-b" class="spinner-b">B</div>
</body></html>`;

const FIXTURE_URL = `data:text/html,${encodeURIComponent(FIXTURE_HTML)}`;

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
    const port = 19900 + Math.floor(Math.random() * 700) + attempt * 137;
    const proc = spawn(
      CHROME_PATH,
      [
        '--headless=new',
        '--disable-gpu',
        `--remote-debugging-port=${port}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ],
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

async function waitForFixtureReady(client: CDPClient, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await client.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && document.getElementById('spinner-a') !== null && document.getElementById('spinner-b') !== null`,
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
let animation: AnimationReport;
let geometry: { elements: GeometryElementRecord[] };

before(async () => {
  const { proc, port } = await spawnHeadlessChrome();
  chromeProc = proc;

  const wsUrl = await newPageTarget(port);
  client = new CDPClient(wsUrl);
  await client.waitReady();
  await enableDomainsForSnap(client);

  await client.send('Page.navigate', { url: FIXTURE_URL });
  await waitForFixtureReady(client);

  const store: Record<string, unknown> = {};
  const ctx: SnapshotContext = {
    client,
    dir: '/tmp/measure-animation-test-unused',
    snapId: 'anim-test-snap',
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

  // Both collectors run against the SAME live CDP client/page, into the
  // SAME in-memory writer -- exactly how the real orchestrator drives them
  // -- so the identity cross-check below compares two independently-run
  // collectors' reads of the SAME live elements.
  await collectAnimation(ctx);
  await collectGeometry(ctx);
  animation = store['animation.json'] as AnimationReport;
  geometry = store['geometry.json'] as { elements: GeometryElementRecord[] };
}, { timeout: 30000 });

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

test('animation.json: the infinite #spinner-a animation is enumerated with the settle.ts base shape', () => {
  assert.ok(Array.isArray(animation.animations));
  const spinner = animation.animations.find((a) => (a.selector ?? '').includes('spinner-a'));
  assert.ok(spinner, `expected an animation record for #spinner-a, got selectors ${JSON.stringify(animation.animations.map((a) => a.selector))}`);
  assert.equal(spinner!.infinite, true, 'expected the #spinner-a animation flagged infinite');
  assert.equal(typeof spinner!.id, 'string');
  assert.ok(spinner!.id.length > 0);
});

// Hardened per the review-residual C5 finding: a single-target fixture
// can't catch a "always resolves the first held handle" or "every record
// gets the same backendNodeId" bug -- both would still satisfy
// "every element-targeted animation has SOME positive backendNodeId".
// With two independently-selectable, uniquely id'd targets, this asserts
// (a) each animation's backendNodeId matches collectGeometry's OWN
// independent identity read for the SAME element (proving the mapping is
// index-correct, not just present), and (b) the two backendNodeIds are
// DISTINCT (proving neither is a stuck first-handle stamped onto every
// record).
test('animation.json: an element-targeted animation carries a backendNodeId (D3 cross-artifact join key), distinct per target', () => {
  const withTarget = animation.animations.filter((a) => a.selector !== null);
  assert.ok(withTarget.length > 0, 'expected at least one element-targeted animation');
  const withBackendNodeId = withTarget.filter((a) => a.backendNodeId !== undefined);
  assert.equal(
    withBackendNodeId.length,
    withTarget.length,
    `expected every element-targeted animation to resolve a backendNodeId, got ${withBackendNodeId.length}/${withTarget.length}`,
  );
  for (const a of withBackendNodeId) {
    assert.equal(typeof a.backendNodeId, 'number');
    assert.ok(a.backendNodeId! > 0);
  }

  const animA = animation.animations.find((a) => (a.selector ?? '').includes('spinner-a'));
  const animB = animation.animations.find((a) => (a.selector ?? '').includes('spinner-b'));
  assert.ok(animA, 'expected an animation record for #spinner-a');
  assert.ok(animB, 'expected an animation record for #spinner-b');

  const geomA = geometry.elements.find((e) => (e.selector ?? e.domPath ?? '').includes('spinner-a'));
  const geomB = geometry.elements.find((e) => (e.selector ?? e.domPath ?? '').includes('spinner-b'));
  assert.ok(geomA, `expected a geometry.json record for #spinner-a, got ${JSON.stringify(geometry.elements.map((e) => e.selector))}`);
  assert.ok(geomB, `expected a geometry.json record for #spinner-b, got ${JSON.stringify(geometry.elements.map((e) => e.selector))}`);

  assert.equal(
    animA!.backendNodeId,
    geomA!.backendNodeId,
    'the #spinner-a animation record must resolve the SAME backendNodeId collectGeometry independently resolves for #spinner-a',
  );
  assert.equal(
    animB!.backendNodeId,
    geomB!.backendNodeId,
    'the #spinner-b animation record must resolve the SAME backendNodeId collectGeometry independently resolves for #spinner-b',
  );
  assert.notEqual(
    animA!.backendNodeId,
    animB!.backendNodeId,
    'two distinct animated elements must resolve to two distinct backendNodeIds -- a stuck first-handle bug would stamp the same id on both',
  );
});

test('animation.json: coverage records the explicit top-document scope fact (D5)', () => {
  assert.ok(animation.coverage, 'expected a coverage scope fact');
  assert.equal(animation.coverage.scope, 'top-document');
  assert.equal(typeof animation.coverage.iframesNotWalked, 'number');
  assert.equal(animation.coverage.iframesNotWalked, 0, 'the fixture has no iframes');
});

// ============================================================================
// D9 real-Chrome: the same page-global contamination class already fixed in
// text/forms/geometry/hittest -- `animation.ts` used the exact same
// vulnerable pattern: a predictable, guessable page-observable global
// (`window.__captureAnimEls`) assigned during the baseline phase. A page
// that predefines a setter for that name can synchronously mutate the DOM
// when the collector assigns it, contaminating the baseline
// `screenshot.png`/`dom.html` (the same class of attack the reviewer
// reproduced against `__captureTextEls`/`__captureFormEls` and the follow-up
// found in `__captureGeomEls`/`__captureHitEls`). The fix replaces the
// side-channel with the exact same CDP-only identity bridge those files
// were fixed to use: the walk's return value is a plain in-memory
// `{ facts, elements }` object, read back purely through
// `Runtime.getProperties`/`Runtime.callFunctionOn`/`Runtime.releaseObject`
// -- nothing is ever assigned to `window` or any other page-observable
// location.
//
// A same-page setter recorder (installed once, before the collector runs)
// is the detector; a positive-control sub-test runs FIRST and proves the
// detector itself catches a manually reintroduced `window.__captureAnimEls
// = []` -- the exact reported reproduction
// (`Object.defineProperty(window, '__captureAnimEls', { set(){...} })`) --
// so the negative result in the second test is meaningful: had
// collectAnimation still assigned that global, this test would have
// failed exactly the way the positive control proves it can.
// ============================================================================

const SETTER_FIXTURE_HTML = `<!DOCTYPE html><html><head><style>
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
#spinner { animation: spin 2s linear infinite; width:40px; height:40px; background:blue; }
</style></head><body style="margin:0;">
<div id="spinner">S</div>
<script>
  window.__setterFired = [];
  Object.defineProperty(window, '__captureAnimEls', {
    configurable: true,
    set: function () { window.__setterFired.push('__captureAnimEls'); document.body.setAttribute('data-capture-observed', 'anim'); },
    get: function () { return undefined; },
  });
</script>
</body></html>`;

const SETTER_FIXTURE_URL = `data:text/html,${encodeURIComponent(SETTER_FIXTURE_HTML)}`;

async function waitForSetterFixtureReady(c: CDPClient, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await c.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && Array.isArray(window.__setterFired) && document.getElementById('spinner') !== null`,
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (res.result?.value) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('setter contamination fixture page did not become ready in time');
}

async function readSetterFired(c: CDPClient): Promise<string[]> {
  const res = (await c.send('Runtime.evaluate', { expression: 'window.__setterFired', returnByValue: true })) as {
    result?: { value?: string[] };
  };
  return res.result?.value ?? [];
}

describe('D9 real-Chrome: baseline collectAnimation never triggers a page-defined __captureAnimEls setter', () => {
  let setterChromeProc: ChildProcess | undefined;
  let setterClient: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    setterChromeProc = proc;
    const wsUrl = await newPageTarget(port);
    setterClient = new CDPClient(wsUrl);
    await setterClient.waitReady();
    await enableDomainsForSnap(setterClient);
    await setterClient.send('Page.navigate', { url: SETTER_FIXTURE_URL });
    await waitForSetterFixtureReady(setterClient);
  }, { timeout: 30000 });

  after(async () => {
    try {
      setterClient?.close();
    } catch {
      // already closed
    }
    try {
      setterChromeProc?.kill('SIGKILL');
    } catch {
      // already dead
    }
  });

  test('positive control: the recorder DOES catch a manually reintroduced window.__captureAnimEls assignment -- the exact reported reproduction', async () => {
    if (!setterClient) throw new Error('client not ready');
    await setterClient.send('Runtime.evaluate', { expression: 'window.__captureAnimEls = [];', returnByValue: true });
    const fired = await readSetterFired(setterClient);
    assert.ok(fired.includes('__captureAnimEls'), 'the recorder must catch a manually reintroduced __captureAnimEls assignment');

    // Reset the recorder and the DOM side effect for the real assertion below.
    await setterClient.send('Runtime.evaluate', {
      expression: `window.__setterFired = []; document.body.removeAttribute('data-capture-observed');`,
      returnByValue: true,
    });
  });

  test('collectAnimation never triggers the __captureAnimEls setter, and backendNodeId still resolves for #spinner', async () => {
    if (!setterClient) throw new Error('client not ready');
    const store: Record<string, unknown> = {};
    const ctx: SnapshotContext = {
      client: setterClient,
      dir: '/tmp/d9-measure-animation-setter-unused',
      snapId: 'd9-setter-snap',
      url: SETTER_FIXTURE_URL,
      viewport: null,
      settled: true,
      freezeAnimations: false,
      captureUnsettled: false,
      pixels: false,
      state: [],
      unstableRegions: [],
      write: makeInMemoryWriter(store),
    };

    await collectAnimation(ctx);

    const fired = await readSetterFired(setterClient);
    assert.deepEqual(fired, [], 'collectAnimation may never assign to window.__captureAnimEls (or trigger any page-defined setter for it)');

    const observed = (await setterClient.send('Runtime.evaluate', {
      expression: `document.body.getAttribute('data-capture-observed')`,
      returnByValue: true,
    })) as { result?: { value?: string | null } };
    assert.equal(observed.result?.value, null, 'the setter-driven DOM mutation must never have fired during baseline collection');

    const report = store['animation.json'] as AnimationReport;
    const spinner = report.animations.find((a) => a.selector !== null);
    assert.ok(spinner, 'expected the #spinner animation to still be enumerated');
    assert.equal(typeof spinner!.backendNodeId, 'number', 'backendNodeId must still resolve for #spinner via the held-reference bridge, not the removed global');
    assert.ok(spinner!.backendNodeId! > 0);
    assert.equal(report.bridgeCleanupFailed, undefined, 'no bridgeCleanupFailed fact expected on a clean run');
  });
});

// ============================================================================
// Stub-driven coverage for the review-residual honesty/cleanup fixes:
// (2) a page-side `document.getAnimations()` throw, and an iframe-count
//     evaluate failure, must surface as explicit unavailable facts rather
//     than being coerced into an empty SUCCESS reading;
// (3) every per-target element objectId `resolveIndexedObjectIds()` hands
//     back must be released, not just the container/facts/elements ids.
// A `StubCdpClient` can credibly drive these (unlike the D3 identity work
// above): none of this depends on CDP's real objectId->backendNodeId
// bridge, only on the shape of the calls collectAnimation itself makes.
// ============================================================================

function makeWriter(): { writer: SnapshotWriter; written: Map<string, unknown> } {
  const written = new Map<string, unknown>();
  const writer: SnapshotWriter = {
    json(filename, value) {
      written.set(filename, value);
    },
    binary(filename, data) {
      written.set(filename, data);
    },
  };
  return { writer, written };
}

function makeStubCtx(client: unknown, overrides: Partial<SnapshotContext> = {}): { ctx: SnapshotContext; written: Map<string, unknown> } {
  const { writer, written } = makeWriter();
  const ctx: SnapshotContext = {
    client: client as CDPClient,
    dir: '/tmp/measure-animation-test-stub-ctx',
    snapId: 'stub-snap',
    url: 'http://example.test',
    viewport: null,
    settled: true,
    freezeAnimations: false,
    captureUnsettled: false,
    pixels: false,
    state: [],
    unstableRegions: [],
    write: writer,
    ...overrides,
  };
  return { ctx, written };
}

// ----------------------------------------------------------------------
// Fix (2): a page-side getAnimations() throw is caught INSIDE the
// inventory script's own try/catch -- it never reaches Runtime.evaluate's
// exception path -- so it must be surfaced through the new `meta.ok:false`
// signal, not silently coerced into an empty successful walk.
// ----------------------------------------------------------------------

class GetAnimationsThrewStubClient {
  releaseCalls: string[] = [];

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureAnimationInventory')) {
        return { result: { objectId: 'container-threw-1' } };
      }
      return { result: { value: { count: 0, ok: true } } };
    }
    if (method === 'Runtime.getProperties') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === 'container-threw-1') {
        return {
          result: [
            { name: 'facts', value: { objectId: 'facts-threw-1' } },
            { name: 'elements', value: { objectId: 'elements-threw-1' } },
            { name: 'meta', value: { objectId: 'meta-threw-1' } },
          ],
        };
      }
      return { result: [] };
    }
    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === 'facts-threw-1') return { result: { value: [] } };
      // Mirrors the page script's own catch branch: getAnimations() threw,
      // the script returned { facts: [], elements: [], meta: { ok: false } }.
      if (objectId === 'meta-threw-1') return { result: { value: { ok: false } } };
      return { result: {} };
    }
    if (method === 'Runtime.releaseObject') {
      this.releaseCalls.push((params as { objectId?: string }).objectId ?? '');
      return {};
    }
    return {};
  }
}

// MUST FAIL PRE-FIX: pre-fix, a page-side getAnimations() throw was caught
// by the inventory script's own `catch (e) {}` and coerced into a plain
// `{ facts: [], elements: [] }` -- there was no `meta` property at all, so
// this stub's `meta-threw-1` branch would never even be consulted, and
// collectAnimation would report `available: true, animations: []` (a
// genuinely-empty walk indistinguishable from a failed one).
test('collectAnimation: a page-side document.getAnimations() throw surfaces available:false with reason get-animations-threw, not an empty success', async () => {
  const client = new GetAnimationsThrewStubClient();
  const { ctx, written } = makeStubCtx(client);

  await collectAnimation(ctx);

  const report = written.get('animation.json') as AnimationReport;
  assert.equal(report.available, false);
  assert.equal(report.unavailableReason, 'get-animations-threw');
  assert.deepEqual(report.animations, []);
});

// ----------------------------------------------------------------------
// Fix (2): the iframe-count evaluate can fail two ways -- the page-side
// querySelectorAll throws (caught inside IFRAME_COUNT_SCRIPT, ok:false),
// or the Runtime.evaluate round trip itself throws/returns nothing
// usable. Both must surface as coverage.available:false, never a silent
// iframesNotWalked:0 masquerading as "genuinely zero iframes".
// ----------------------------------------------------------------------

class IframeCountFailureStubClient {
  constructor(private readonly mode: 'script-threw' | 'evaluate-threw') {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureAnimationInventory')) {
        return { result: { objectId: 'container-iframe-1' } };
      }
      // The IFRAME_COUNT_SCRIPT evaluate.
      if (this.mode === 'evaluate-threw') throw new Error('iframe count evaluate boom');
      return { result: { value: { count: 0, ok: false } } };
    }
    if (method === 'Runtime.getProperties') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === 'container-iframe-1') {
        return {
          result: [
            { name: 'facts', value: { objectId: 'facts-iframe-1' } },
            { name: 'elements', value: { objectId: 'elements-iframe-1' } },
            { name: 'meta', value: { objectId: 'meta-iframe-1' } },
          ],
        };
      }
      return { result: [] };
    }
    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === 'facts-iframe-1') return { result: { value: [] } };
      if (objectId === 'meta-iframe-1') return { result: { value: { ok: true } } };
      return { result: {} };
    }
    if (method === 'Runtime.releaseObject') return {};
    return {};
  }
}

// MUST FAIL PRE-FIX: pre-fix, IFRAME_COUNT_SCRIPT returned a bare number
// and both its own internal `catch (e) { return 0; }` and the Node-side
// `catch { iframesNotWalked = 0; }` coerced any failure into the exact
// same `iframesNotWalked: 0` a genuinely iframe-free page also reports --
// there was no `coverage.available` field to distinguish them at all.
test('collectAnimation: the page-side iframe count throwing surfaces coverage.available:false, not a bare iframesNotWalked:0', async () => {
  const client = new IframeCountFailureStubClient('script-threw');
  const { ctx, written } = makeStubCtx(client);

  await collectAnimation(ctx);

  const report = written.get('animation.json') as AnimationReport;
  assert.equal(report.coverage.available, false);
  assert.equal(report.coverage.iframesNotWalked, 0);
});

test('collectAnimation: the iframe-count Runtime.evaluate round trip throwing surfaces coverage.available:false', async () => {
  const client = new IframeCountFailureStubClient('evaluate-threw');
  const { ctx, written } = makeStubCtx(client);

  await collectAnimation(ctx);

  const report = written.get('animation.json') as AnimationReport;
  assert.equal(report.coverage.available, false);
});

// Companion happy path: proves `coverage.available` genuinely toggles, not
// hardcoded false -- a successful iframe count reports true.
test('collectAnimation: a successful iframe count reports coverage.available:true', async () => {
  const client = new IframeCountFailureStubClient('script-threw');
  // Override just the iframe evaluate to succeed for this one case.
  (client as unknown as { send: IframeCountFailureStubClient['send'] }).send = async function (
    this: IframeCountFailureStubClient,
    method: string,
    params: Record<string, unknown> = {},
  ) {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureAnimationInventory')) return { result: { objectId: 'container-iframe-1' } };
      return { result: { value: { count: 3, ok: true } } };
    }
    if (method === 'Runtime.getProperties') {
      return {
        result: [
          { name: 'facts', value: { objectId: 'facts-iframe-1' } },
          { name: 'elements', value: { objectId: 'elements-iframe-1' } },
          { name: 'meta', value: { objectId: 'meta-iframe-1' } },
        ],
      };
    }
    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === 'facts-iframe-1') return { result: { value: [] } };
      if (objectId === 'meta-iframe-1') return { result: { value: { ok: true } } };
      return { result: {} };
    }
    return {};
  };
  const { ctx, written } = makeStubCtx(client);

  await collectAnimation(ctx);

  const report = written.get('animation.json') as AnimationReport;
  assert.equal(report.coverage.available, true);
  assert.equal(report.coverage.iframesNotWalked, 3);
});

// ----------------------------------------------------------------------
// Fix (3): every per-target element objectId resolveIndexedObjectIds()
// hands back is its OWN held remote reference and must be released, not
// just the container/facts/elements array objectIds.
// ----------------------------------------------------------------------

class TwoTargetCleanupStubClient {
  releaseCalls: string[] = [];

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureAnimationInventory')) {
        return { result: { objectId: 'container-cleanup-1' } };
      }
      return { result: { value: { count: 0, ok: true } } };
    }
    if (method === 'Runtime.getProperties') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === 'container-cleanup-1') {
        return {
          result: [
            { name: 'facts', value: { objectId: 'facts-cleanup-1' } },
            { name: 'elements', value: { objectId: 'elements-cleanup-1' } },
            { name: 'meta', value: { objectId: 'meta-cleanup-1' } },
          ],
        };
      }
      if (objectId === 'elements-cleanup-1') {
        return {
          result: [
            { name: '0', value: { objectId: 'target-el-A' } },
            { name: '1', value: { objectId: 'target-el-B' } },
          ],
        };
      }
      return { result: [] };
    }
    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === 'facts-cleanup-1') {
        return {
          result: {
            value: [
              { selector: '.a', animationName: 'spin', durationMs: 1000, iterationCount: 1, infinite: false, playState: 'running', targetIdx: 0 },
              { selector: '.b', animationName: 'pulse', durationMs: 500, iterationCount: 1, infinite: false, playState: 'running', targetIdx: 1 },
            ],
          },
        };
      }
      if (objectId === 'meta-cleanup-1') return { result: { value: { ok: true } } };
      return { result: {} };
    }
    if (method === 'DOM.describeNode') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === 'target-el-A') return { node: { backendNodeId: 101 } };
      if (objectId === 'target-el-B') return { node: { backendNodeId: 102 } };
      return { node: {} };
    }
    if (method === 'Runtime.releaseObject') {
      this.releaseCalls.push((params as { objectId?: string }).objectId ?? '');
      return {};
    }
    return {};
  }
}

// MUST FAIL PRE-FIX: pre-fix, `heldObjectIds` only ever received the
// container/facts/elements objectIds -- the per-target `target-el-A`/
// `target-el-B` handles `resolveIndexedObjectIds()` resolved were read via
// `describeBackendNodeId` and then simply dropped, never released.
test('collectAnimation: releases every per-target element objectId resolveIndexedObjectIds() resolves, not just container/facts/elements', async () => {
  const client = new TwoTargetCleanupStubClient();
  const { ctx, written } = makeStubCtx(client);

  await collectAnimation(ctx);

  const report = written.get('animation.json') as AnimationReport;
  assert.equal(report.animations.length, 2);
  assert.equal(report.animations[0].backendNodeId, 101);
  assert.equal(report.animations[1].backendNodeId, 102);

  assert.ok(client.releaseCalls.includes('target-el-A'), `expected target-el-A to be released, got ${JSON.stringify(client.releaseCalls)}`);
  assert.ok(client.releaseCalls.includes('target-el-B'), `expected target-el-B to be released, got ${JSON.stringify(client.releaseCalls)}`);
  assert.ok(client.releaseCalls.includes('container-cleanup-1'));
  assert.ok(client.releaseCalls.includes('facts-cleanup-1'));
  assert.ok(client.releaseCalls.includes('elements-cleanup-1'));
});

// ----------------------------------------------------------------------
// Class B (I-3/I-5 honesty sweep r4): per-target identity resolution can
// fail for ONE target while another target on the SAME run succeeds --
// that must never collapse to the same shape as "no element target" at
// all (the pre-fix behavior: `describeBackendNodeId` returning `undefined`
// left `backendNodeId` silently omitted, indistinguishable from a bare
// non-element-targeted `Animation`). Clones `TwoTargetCleanupStubClient`
// but makes target B's `DOM.describeNode` throw while target A succeeds.
// ----------------------------------------------------------------------

class MixedIdentityStubClient {
  releaseCalls: string[] = [];

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureAnimationInventory')) {
        return { result: { objectId: 'container-mixed-1' } };
      }
      return { result: { value: { count: 0, ok: true } } };
    }
    if (method === 'Runtime.getProperties') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === 'container-mixed-1') {
        return {
          result: [
            { name: 'facts', value: { objectId: 'facts-mixed-1' } },
            { name: 'elements', value: { objectId: 'elements-mixed-1' } },
            { name: 'meta', value: { objectId: 'meta-mixed-1' } },
          ],
        };
      }
      if (objectId === 'elements-mixed-1') {
        return {
          result: [
            { name: '0', value: { objectId: 'target-el-good' } },
            { name: '1', value: { objectId: 'target-el-bad' } },
          ],
        };
      }
      return { result: [] };
    }
    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === 'facts-mixed-1') {
        return {
          result: {
            value: [
              { selector: '.good', animationName: 'spin', durationMs: 1000, iterationCount: 1, infinite: false, playState: 'running', targetIdx: 0 },
              { selector: '.bad', animationName: 'pulse', durationMs: 500, iterationCount: 1, infinite: false, playState: 'running', targetIdx: 1 },
            ],
          },
        };
      }
      if (objectId === 'meta-mixed-1') return { result: { value: { ok: true } } };
      return { result: {} };
    }
    if (method === 'DOM.describeNode') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === 'target-el-good') return { node: { backendNodeId: 201 } };
      if (objectId === 'target-el-bad') throw new Error('describeNode boom');
      return { node: {} };
    }
    if (method === 'Runtime.releaseObject') {
      this.releaseCalls.push((params as { objectId?: string }).objectId ?? '');
      return {};
    }
    return {};
  }
}

// MUST FAIL PRE-FIX: pre-fix, `describeBackendNodeId` returning `undefined`
// (from the thrown DOM.describeNode) left `backendNodeId` entirely OMITTED
// on the record -- the exact same shape as "this animation has no element
// target at all". `report.animations[1].identityUnresolved` did not exist
// as a field pre-fix (it would read `undefined`, not `true`), so this
// assertion could not have passed against the old code.
test('collectAnimation: one target failing identity resolution reports backendNodeId:null + identityUnresolved:true, without affecting the other target', async () => {
  const client = new MixedIdentityStubClient();
  const { ctx, written } = makeStubCtx(client);

  await collectAnimation(ctx);

  const report = written.get('animation.json') as AnimationReport;
  assert.equal(report.animations.length, 2);

  const good = report.animations[0];
  const bad = report.animations[1];

  assert.equal(good.backendNodeId, 201, 'the succeeding target must still resolve a plain numeric backendNodeId');
  assert.equal(good.identityUnresolved, undefined, 'a succeeding target must not carry identityUnresolved');

  assert.equal(bad.backendNodeId, null, 'the failing target must report backendNodeId:null, never silently omitted');
  assert.equal(bad.identityUnresolved, true, 'the failing target must carry identityUnresolved:true');
});

// ============================================================================
// Review-residual (2026-07-09 review, findings A/B): the two stub tests above
// for `get-animations-threw` and iframe-count `script-threw` NEVER execute
// the real `ANIMATION_INVENTORY_SCRIPT`/`IFRAME_COUNT_SCRIPT` page-side
// `catch` branches -- they hand-build the post-catch Node-side shape
// directly in the stub. That leaves a real theatre hole: a regression to
// either injected script's OWN `catch` (e.g. dropping the `meta` property,
// or reporting `ok:true` on a masked failure) would sail through those stub
// tests untouched, because the stub never lets the real script run at all.
// These two tests drive real headless Chrome, monkeypatch the exact
// page-side call each script makes so it throws for real, and assert on
// collectAnimation's actual output -- so a regression to either script's
// `catch` branch is caught here even though the equivalent stub tests above
// stay green. Each test navigates to its OWN fresh blank page first, so the
// monkeypatched global cannot leak into any other test in this file (the
// shared module-level `client`/fixture used by the tests above is never
// touched by this describe block -- it spawns and owns its own Chrome
// instance).
// ============================================================================

describe('real-Chrome page-side catch-branch regressions (review findings A/B)', () => {
  let failChromeProc: ChildProcess | undefined;
  let failClient: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    failChromeProc = proc;
    const wsUrl = await newPageTarget(port);
    failClient = new CDPClient(wsUrl);
    await failClient.waitReady();
    await enableDomainsForSnap(failClient);
  }, { timeout: 30000 });

  after(async () => {
    try {
      failClient?.close();
    } catch {
      // already closed
    }
    try {
      failChromeProc?.kill('SIGKILL');
    } catch {
      // already dead
    }
  });

  // A fresh navigation per test, rather than restoring the monkeypatched
  // global afterward, is the isolation mechanism: navigation tears down the
  // entire page-side JS realm, so there is nothing left to leak into the
  // next test even within this same describe block.
  async function navigateFreshBlankPage(c: CDPClient): Promise<void> {
    await c.send('Page.navigate', { url: 'data:text/html,<!DOCTYPE html><html><body></body></html>' });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const res = (await c.send('Runtime.evaluate', {
        expression: `document.readyState === 'complete'`,
        returnByValue: true,
      })) as { result?: { value?: boolean } };
      if (res.result?.value) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('fresh blank page did not become ready in time');
  }

  function makeFailCtx(c: CDPClient): { ctx: SnapshotContext; written: Map<string, unknown> } {
    const { writer, written } = makeWriter();
    const ctx: SnapshotContext = {
      client: c,
      dir: '/tmp/measure-animation-test-real-page-throw-unused',
      snapId: 'real-page-throw-snap',
      url: 'data:text/html,blank',
      viewport: null,
      settled: true,
      freezeAnimations: false,
      captureUnsettled: false,
      pixels: false,
      state: [],
      unstableRegions: [],
      write: writer,
    };
    return { ctx, written };
  }

  // Fix A. ANIMATION_INVENTORY_SCRIPT calls `document.getAnimations({ subtree:
  // true })` inside its own try/catch -- monkeypatch that exact call (on the
  // real page, before collectAnimation runs) to throw, so the script's own
  // catch branch executes for real.
  test('Fix A: real page-side document.getAnimations() throwing surfaces available:false / get-animations-threw', async () => {
    if (!failClient) throw new Error('client not ready');
    await navigateFreshBlankPage(failClient);
    await failClient.send('Runtime.evaluate', {
      expression: `document.getAnimations = function () { throw new Error('boom'); };`,
      returnByValue: true,
    });

    const { ctx, written } = makeFailCtx(failClient);
    await collectAnimation(ctx);

    const report = written.get('animation.json') as AnimationReport;
    assert.equal(report.available, false);
    assert.equal(report.unavailableReason, 'get-animations-threw');
    assert.deepEqual(report.animations, []);
  });

  // Fix B. IFRAME_COUNT_SCRIPT calls `document.querySelectorAll('iframe')`
  // inside its own try/catch -- monkeypatch `document.querySelectorAll`
  // (scoped to the literal `'iframe'` selector, so it doesn't disturb
  // anything else the collector or the page does) to throw, so the script's
  // own catch branch executes for real.
  test('Fix B: real page-side iframe-count querySelectorAll(\'iframe\') throwing surfaces coverage.available:false', async () => {
    if (!failClient) throw new Error('client not ready');
    await navigateFreshBlankPage(failClient);
    await failClient.send('Runtime.evaluate', {
      expression: `(function () {
        var original = document.querySelectorAll.bind(document);
        document.querySelectorAll = function (selector) {
          if (selector === 'iframe') throw new Error('boom');
          return original(selector);
        };
      })();`,
      returnByValue: true,
    });

    const { ctx, written } = makeFailCtx(failClient);
    await collectAnimation(ctx);

    const report = written.get('animation.json') as AnimationReport;
    assert.equal(report.coverage.available, false);
    assert.equal(report.coverage.iframesNotWalked, 0);
  });
});

// ----------------------------------------------------------------------
// Fix (C, minor): `AnimationReport.freezeRequested` restates
// `ctx.freezeAnimations` at the artifact level and had no assertion
// anywhere. A minimal always-succeeds stub is enough here -- this is a
// pure Node-side pass-through, nothing about the CDP objectId/backendNodeId
// bridge is in play.
// ----------------------------------------------------------------------

class MinimalOkStubClient {
  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureAnimationInventory')) {
        return { result: { objectId: 'container-freeze-1' } };
      }
      return { result: { value: { count: 0, ok: true } } };
    }
    if (method === 'Runtime.getProperties') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === 'container-freeze-1') {
        return {
          result: [
            { name: 'facts', value: { objectId: 'facts-freeze-1' } },
            { name: 'elements', value: { objectId: 'elements-freeze-1' } },
            { name: 'meta', value: { objectId: 'meta-freeze-1' } },
          ],
        };
      }
      return { result: [] };
    }
    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === 'facts-freeze-1') return { result: { value: [] } };
      if (objectId === 'meta-freeze-1') return { result: { value: { ok: true } } };
      return { result: {} };
    }
    if (method === 'Runtime.releaseObject') return {};
    return {};
  }
}

test('collectAnimation: freezeRequested is false under a default ctx (freezeAnimations not requested)', async () => {
  const { ctx, written } = makeStubCtx(new MinimalOkStubClient());
  await collectAnimation(ctx);
  const report = written.get('animation.json') as AnimationReport;
  assert.equal(report.freezeRequested, false);
});

test('collectAnimation: freezeRequested is true when ctx.freezeAnimations is true', async () => {
  const { ctx, written } = makeStubCtx(new MinimalOkStubClient(), { freezeAnimations: true });
  await collectAnimation(ctx);
  const report = written.get('animation.json') as AnimationReport;
  assert.equal(report.freezeRequested, true);
});
