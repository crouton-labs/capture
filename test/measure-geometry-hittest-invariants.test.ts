/**
 * Adversarial real-Chrome regression tests for geometry.ts/hittest.ts's
 * silent caps (I-5) and hittest's bridge-cap identity honesty (I-3) --
 * see `/Users/silasrhyneer/.crouter/canvas/nodes/mrdrewm2-eafba225/context/collector-invariant-audit-matrix.md`
 * findings C/D. Every truncation field asserted here (`elementsTruncated`,
 * `samplesTruncated`, `bridgeTruncated`, `columnTracksTruncated`,
 * `rowTracksTruncated`) and the honest-unresolved shape
 * (`backendNodeId: null` + `identityUnresolved: true`) did not exist before
 * this remediation -- every assertion below fails against the pre-fix
 * source (the field is `undefined`, or an over-cap stack member silently
 * carries no `backendNodeId` key with no accompanying honesty marker).
 *
 * Separate from `test/measure-geometry-hittest.test.ts` (the file this
 * task must not modify) -- own Chrome instance, own fixtures, own
 * `before`/`after`.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';

import { CDPClient } from '../src/cdp/client.js';
import { enableDomainsForSnap } from '../src/cdp/domains.js';
import { collectGeometry, type GeometryElementRecord } from '../src/cdp/measure/collectors/geometry.js';
import { collectHittest, type HittestJson } from '../src/cdp/measure/collectors/hittest.js';
import type { SnapshotContext, SnapshotWriter } from '../src/cdp/measure/types.js';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

interface GeometryJson {
  elements: GeometryElementRecord[];
  elementsTruncated: number;
  available: boolean;
  unavailableReason?: string;
}

// ============================================================================
// Boilerplate -- adapted from test/measure-geometry-hittest.test.ts's own
// Chrome-launch/readiness helpers (kept self-contained here since this file
// must not import from or modify that one).
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
    const port = 19900 + Math.floor(Math.random() * 700) + attempt * 137;
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

async function newClient(port: number, width: number, height: number): Promise<CDPClient> {
  const wsUrl = await newPageTarget(port);
  const client = new CDPClient(wsUrl);
  await client.waitReady();
  await enableDomainsForSnap(client);
  await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  return client;
}

async function navigateAndWait(client: CDPClient, html: string, timeoutMs = 20000): Promise<void> {
  const url = `data:text/html,${encodeURIComponent(html)}`;
  await client.send('Page.navigate', { url });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await client.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && document.getElementById('ready-marker') !== null`,
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (res.result?.value) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('fixture page did not reach readyState=complete in time');
}

function baseCtx(client: CDPClient, snapId: string, write: SnapshotWriter): SnapshotContext {
  return {
    client,
    dir: '/tmp/u07-measure-geometry-hittest-invariants-test-unused',
    snapId,
    url: 'about:blank',
    viewport: null,
    settled: true,
    freezeAnimations: false,
    captureUnsettled: false,
    pixels: false,
    state: [],
    unstableRegions: [],
    write,
  };
}

let chromeProc: ChildProcess | undefined;
let chromePort = 0;

before(async () => {
  const { proc, port } = await spawnHeadlessChrome();
  chromeProc = proc;
  chromePort = port;
}, { timeout: 20000 });

after(() => {
  try {
    chromeProc?.kill('SIGKILL');
  } catch {
    // already dead
  }
});

// ============================================================================
// Finding C (geometry): MAX_ELEMENTS + grid-track slice caps (I-5)
// ============================================================================

const GEOMETRY_FILLER_COUNT = 1300; // > geometry.ts's MAX_ELEMENTS (1200)
const GRID_COLUMN_COUNT = 100; // > MAX_GRID_TRACKS (64)
const GRID_ROW_COUNT = 80; // > MAX_GRID_TRACKS (64) -- deliberately different from GRID_COLUMN_COUNT

function buildGeometryFixtureHtml(): string {
  const fillers = Array.from({ length: GEOMETRY_FILLER_COUNT }, (_, i) => `<div class="filler">${i}</div>`).join('');
  return `<!doctype html><html><body>
    <div id="grid" style="display:grid;grid-template-columns:repeat(${GRID_COLUMN_COUNT},2px);grid-template-rows:repeat(${GRID_ROW_COUNT},2px);position:absolute;top:5000px;left:0;">
      <div id="grid-item">x</div>
    </div>
    ${fillers}
    <div id="ready-marker"></div>
  </body></html>`;
}

describe('geometry.json: MAX_ELEMENTS + grid-track slice caps emit exact truncation facts (I-5, finding C)', () => {
  let geometry: GeometryJson;
  let client: CDPClient;

  before(async () => {
    client = await newClient(chromePort, 800, 800);
    await navigateAndWait(client, buildGeometryFixtureHtml());
    const store: Record<string, unknown> = {};
    await collectGeometry(baseCtx(client, 'inv-geometry', makeInMemoryWriter(store)));
    geometry = store['geometry.json'] as GeometryJson;
  }, { timeout: 30000 });

  after(() => {
    try {
      client.close();
    } catch {
      // already closed
    }
  });

  test('MAX_ELEMENTS cap holds exactly and elementsTruncated is a positive exact count -- undefined pre-fix', () => {
    assert.equal(geometry.elements.length, 1200, 'expected the MAX_ELEMENTS cap to hold exactly');
    assert.equal(typeof geometry.elementsTruncated, 'number', 'expected elementsTruncated to be an always-present number fact, not a silently omitted field');
    assert.ok(geometry.elementsTruncated > 0, `expected a positive truncation count for the ${GEOMETRY_FILLER_COUNT + 2}-element fixture, got ${geometry.elementsTruncated}`);
  });

  test('grid-template-columns/rows track-array caps: both axes report independent, exact dropped-track counts -- undefined pre-fix', () => {
    const gridItem = geometry.elements.find((e) => e.selector === '#grid-item');
    assert.ok(gridItem, 'expected a geometry record for #grid-item');
    assert.ok(gridItem!.layout.grid !== null, 'expected #grid-item to carry layout.grid');
    const container = gridItem!.layout.grid!.container;

    assert.ok(container.templateColumns.length <= 64, `expected templateColumns capped at MAX_GRID_TRACKS, got ${container.templateColumns.length}`);
    assert.ok(container.templateRows.length <= 64, `expected templateRows capped at MAX_GRID_TRACKS, got ${container.templateRows.length}`);

    assert.equal(typeof container.columnTracksTruncated, 'number', 'expected columnTracksTruncated to be an always-present number fact');
    assert.equal(typeof container.rowTracksTruncated, 'number', 'expected rowTracksTruncated to be an always-present number fact');
    assert.equal(container.columnTracksTruncated, GRID_COLUMN_COUNT - container.templateColumns.length);
    assert.equal(container.rowTracksTruncated, GRID_ROW_COUNT - container.templateRows.length);
    assert.ok(container.columnTracksTruncated > 0, 'expected real columns to have been dropped');
    assert.ok(container.rowTracksTruncated > 0, 'expected real rows to have been dropped');
    assert.notEqual(
      container.columnTracksTruncated,
      container.rowTracksTruncated,
      'expected the two axes to be tracked independently (deliberately different fixture counts), not one shared/aliased count',
    );
  });
});

// ============================================================================
// Findings C + D (hittest): candidate/lattice/bridge caps (I-5), and
// bridge-cap identity honesty (I-3) -- an element-bearing record past
// MAX_BRIDGE_ELEMENTS must never look silently joinable.
// ============================================================================

// A native `document.elementsFromPoint` call itself caps out at 512
// elements (measured empirically -- not a MAX_BRIDGE_ELEMENTS-adjacent
// constant this project controls), so ONE arbitrarily-deep nested stack at
// a single point can never exceed MAX_BRIDGE_ELEMENTS (3000) by itself.
// Instead, this fixture tiles MANY separate, moderately-deep "towers" (each
// well under the 512-per-query cap) across a grid ALIGNED with the coarse
// whole-viewport lattice's 80px spacing, so most lattice points -- plus
// whichever towers become primary candidates -- each resolve a DIFFERENT
// tower's stack, and the UNION of distinct bridged elements across all of
// them exceeds MAX_BRIDGE_ELEMENTS.
const TOWER_GRID = 16; // 16x16 = 256 tower positions
const TOWER_DEPTH = 20; // 256 * 20 = 5120 elements >> MAX_BRIDGE_ELEMENTS (3000), well under the 512-per-query native cap
const TOWER_SPACING = 80; // == hittest.ts's LATTICE_STEP, so lattice points land squarely on distinct towers
const TOWER_SIZE = 60;

function buildHittestFixtureHtml(): string {
  const towers: string[] = [];
  for (let row = 0; row < TOWER_GRID; row += 1) {
    for (let col = 0; col < TOWER_GRID; col += 1) {
      const x = 40 + col * TOWER_SPACING; // 40 == LATTICE_STEP/2, the first lattice point's coordinate
      const y = 40 + row * TOWER_SPACING;
      const open = '<div class="t">'.repeat(TOWER_DEPTH);
      const close = '</div>'.repeat(TOWER_DEPTH);
      towers.push(`<div style="position:fixed;left:${x}px;top:${y}px;">${open}X${close}</div>`);
    }
  }
  return `<!doctype html><html><head><style>.t{width:${TOWER_SIZE}px;height:${TOWER_SIZE}px;}</style></head><body>
    ${towers.join('')}
    <div id="ready-marker"></div>
  </body></html>`;
}

describe('hittest.json: candidate/lattice/bridge caps emit exact truncation facts, and bridge-capped records are honestly unresolved (I-5 + I-3, findings C + D)', () => {
  let hittest: HittestJson;
  let client: CDPClient;

  before(async () => {
    client = await newClient(chromePort, 1400, 1400);
    await navigateAndWait(client, buildHittestFixtureHtml(), 30000);
    const store: Record<string, unknown> = {};
    await collectHittest(baseCtx(client, 'inv-hittest', makeInMemoryWriter(store)));
    hittest = store['hittest.json'] as HittestJson;
  }, { timeout: 90000 });

  after(() => {
    try {
      client.close();
    } catch {
      // already closed
    }
  });

  test('MAX_ELEMENTS candidate cap holds exactly and elementsTruncated is a positive exact count -- undefined pre-fix', () => {
    assert.equal(hittest.elements.length, 500, 'expected the hittest MAX_ELEMENTS cap to hold exactly');
    assert.equal(typeof hittest.elementsTruncated, 'number', 'expected elementsTruncated to be an always-present number fact');
    assert.ok(hittest.elementsTruncated > 0, `expected a positive candidate truncation count, got ${hittest.elementsTruncated}`);
  });

  test('LATTICE_MAX_POINTS cap holds and samplesTruncated is a positive exact count -- undefined pre-fix', () => {
    assert.ok(hittest.samples.length <= 200, 'expected the LATTICE_MAX_POINTS cap to hold');
    assert.equal(typeof hittest.samplesTruncated, 'number', 'expected samplesTruncated to be an always-present number fact');
    assert.ok(hittest.samplesTruncated > 0, `expected a positive lattice truncation count for the 1200x1200 viewport, got ${hittest.samplesTruncated}`);
  });

  test('MAX_BRIDGE_ELEMENTS cap: bridgeTruncated is a positive exact count, and every over-cap element-bearing record is HONESTLY marked unresolved, never silently joinable -- fails pre-fix', () => {
    assert.equal(typeof hittest.bridgeTruncated, 'number', 'expected bridgeTruncated to be an always-present number fact');
    assert.ok(hittest.bridgeTruncated > 0, `expected the ${TOWER_GRID}x${TOWER_GRID} towers of depth ${TOWER_DEPTH} to exceed MAX_BRIDGE_ELEMENTS, got bridgeTruncated=${hittest.bridgeTruncated}`);

    // A single lattice/candidate sample point only ever intersects ONE
    // tower's local stack (elementsFromPoint is point-local, never a union
    // across towers), so no single stack can itself exceed MAX_BRIDGE_ELEMENTS
    // -- the cap is on the UNION of distinct elements bridged across the
    // WHOLE walk (every candidate's 9-point stacks plus every whole-viewport
    // lattice sample). So scan every element-bearing record in the entire
    // artifact (every candidate's per-point stack, every whole-viewport
    // lattice sample's stack) for the honest-unresolved shape, rather than
    // asserting it on one hand-picked point.
    const allStackMembers = [
      ...hittest.samples.flatMap((s) => s.stack),
      ...hittest.elements.flatMap((e) => e.points.flatMap((p) => p.result.stack)),
    ];
    assert.ok(allStackMembers.length > 0, 'expected the fixture to produce at least one stack member');

    const unresolved = allStackMembers.filter((m) => m.backendNodeId === null);
    assert.ok(unresolved.length > 0, `expected at least one over-cap stack member across the whole artifact (bridgeTruncated=${hittest.bridgeTruncated}), got 0 unresolved among ${allStackMembers.length} stack members`);
    for (const m of unresolved) {
      assert.equal(m.backendNodeId, null, 'expected an explicit backendNodeId:null, never an omitted key, on an unresolved record');
      assert.equal(
        m.identityUnresolved,
        true,
        'expected identityUnresolved:true alongside backendNodeId:null -- pre-fix this record silently had NO backendNodeId key at all and no honesty marker, indistinguishable from "not looked up", the exact latent wrong-join this fixes',
      );
    }

    const resolved = allStackMembers.filter((m) => m.backendNodeId !== null);
    assert.ok(resolved.length > 0, 'expected some stack members to resolve within the bridge cap');
    for (const m of resolved) {
      assert.notEqual(m.identityUnresolved, true, 'expected a resolved record to never carry identityUnresolved:true');
    }
  });
});

// ============================================================================
// Finding 1 (source review, both collectors): a collection FAILURE (the
// page-side walk evaluate throwing, or Runtime.evaluate returning no
// objectId at all) must never collapse to the same measured-empty artifact
// (elements:[]/samples:[] with every truncation count at 0) a genuinely
// empty page produces -- that would falsely claim "nothing was dropped"
// on a run that never actually read anything. No real Chrome is needed:
// both collectors' only CDP interaction before this failure point is a
// single `Runtime.evaluate` call, so a minimal stub is sufficient (same
// pattern as `test/measure-animation-freeze-invariants.test.ts`'s
// `AnimationUnavailableStubClient`, reimplemented locally here).
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

function makeStubCtx(client: unknown): { ctx: SnapshotContext; written: Map<string, unknown> } {
  const { writer, written } = makeWriter();
  const ctx: SnapshotContext = {
    client: client as CDPClient,
    dir: '/tmp/measure-geometry-hittest-invariants-test-stub-ctx',
    snapId: 'snap-test',
    url: 'http://example.test',
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

class ThrowingWalkEvaluateStubClient {
  async send(method: string): Promise<unknown> {
    if (method === 'Runtime.evaluate') throw new Error('forced walk-evaluate failure');
    return {};
  }
}

class NoObjectIdWalkEvaluateStubClient {
  async send(method: string): Promise<unknown> {
    if (method === 'Runtime.evaluate') return { result: {} };
    return {};
  }
}

describe('geometry.json + hittest.json: a forced collection failure emits an honest unavailable fact, never a silent measured-empty artifact (I-4/I-5, source review finding 1)', () => {
  // MUST FAIL PRE-FIX: neither GeometryJson nor HittestJson had an
  // `available` field at all before this remediation, so `report.available`
  // would be `undefined`, and a thrown/no-objectId walk evaluate silently
  // produced the exact same `elements: []`/`elementsTruncated: 0` shape as a
  // genuinely empty page -- indistinguishable, the exact over-claim finding 1 fixes.
  test('collectGeometry: walk evaluate throwing marks available:false, reason walk-evaluate-threw, and never a measured-empty artifact', async () => {
    const { ctx, written } = makeStubCtx(new ThrowingWalkEvaluateStubClient());
    await collectGeometry(ctx);
    const geometry = written.get('geometry.json') as GeometryJson;
    assert.equal(geometry.available, false);
    assert.equal(geometry.unavailableReason, 'walk-evaluate-threw');
    assert.deepEqual(geometry.elements, []);
    assert.equal(geometry.elementsTruncated, 0);
  });

  test('collectGeometry: walk evaluate returning no objectId marks available:false, reason walk-evaluate-returned-no-object', async () => {
    const { ctx, written } = makeStubCtx(new NoObjectIdWalkEvaluateStubClient());
    await collectGeometry(ctx);
    const geometry = written.get('geometry.json') as GeometryJson;
    assert.equal(geometry.available, false);
    assert.equal(geometry.unavailableReason, 'walk-evaluate-returned-no-object');
    assert.deepEqual(geometry.elements, []);
    assert.equal(geometry.elementsTruncated, 0);
  });

  test('collectHittest: walk evaluate throwing marks available:false, reason walk-evaluate-threw, and never a measured-empty artifact', async () => {
    const { ctx, written } = makeStubCtx(new ThrowingWalkEvaluateStubClient());
    await collectHittest(ctx);
    const hittest = written.get('hittest.json') as HittestJson;
    assert.equal(hittest.available, false);
    assert.equal(hittest.unavailableReason, 'walk-evaluate-threw');
    assert.deepEqual(hittest.elements, []);
    assert.deepEqual(hittest.samples, []);
    assert.equal(hittest.elementsTruncated, 0);
    assert.equal(hittest.samplesTruncated, 0);
    assert.equal(hittest.bridgeTruncated, 0);
  });

  test('collectHittest: walk evaluate returning no objectId marks available:false, reason walk-evaluate-returned-no-object', async () => {
    const { ctx, written } = makeStubCtx(new NoObjectIdWalkEvaluateStubClient());
    await collectHittest(ctx);
    const hittest = written.get('hittest.json') as HittestJson;
    assert.equal(hittest.available, false);
    assert.equal(hittest.unavailableReason, 'walk-evaluate-returned-no-object');
    assert.deepEqual(hittest.elements, []);
    assert.deepEqual(hittest.samples, []);
  });

  // Companion happy-path -- proves the two failure cases above are now
  // distinguishable from a genuinely-empty-but-successful walk: before this
  // remediation both collapsed to the exact same indistinguishable shape.
  test('collectGeometry + collectHittest: a real (Chrome-backed) empty-page run reports available:true and no unavailableReason', async () => {
    const store: Record<string, unknown> = {};
    const client = await newClient(chromePort, 400, 400);
    try {
      await navigateAndWait(client, '<!doctype html><html><body><div id="ready-marker"></div></body></html>');
      const writer = makeInMemoryWriter(store);
      await collectGeometry(baseCtx(client, 'inv-empty-geometry', writer));
      await collectHittest(baseCtx(client, 'inv-empty-hittest', writer));
    } finally {
      client.close();
    }
    const geometry = store['geometry.json'] as GeometryJson;
    const hittest = store['hittest.json'] as HittestJson;
    assert.equal(geometry.available, true);
    assert.equal(geometry.unavailableReason, undefined);
    assert.equal(hittest.available, true);
    assert.equal(hittest.unavailableReason, undefined);
  });
});

// ============================================================================
// Finding 1, round 2 (source review re-verify): a SUCCESSFUL walk evaluate
// whose held container is missing a required property's objectId, or whose
// readHeldValue() resolves (without throwing) to `undefined`, must ALSO
// collapse to available:false -- not just the already-fixed thrown-evaluate
// / no-objectId-at-all cases above. Each stub below drives the CDP call
// sequence past `Runtime.evaluate` to force exactly one of these held-read
// holes, using the same minimal-stub-client pattern as the finding-1 block
// above (no real Chrome needed -- the collectors' only CDP calls before
// these failure points are `Runtime.evaluate`/`Runtime.getProperties`/
// `Runtime.callFunctionOn`).
// ============================================================================

interface StubCallParams {
  readonly objectId?: string;
}

/** `Runtime.getProperties` on the held walk-result container omits a `facts` entry entirely (as if the page-side script's return value never had one) -- `elements`/`meta` are still present so only the `facts` lookup is affected. */
class NoFactsObjectIdStubClient {
  async send(method: string): Promise<unknown> {
    if (method === 'Runtime.evaluate') return { result: { objectId: 'container-1' } };
    if (method === 'Runtime.getProperties') {
      return {
        result: [
          { name: 'elements', value: { objectId: 'elements-1' } },
          { name: 'meta', value: { objectId: 'meta-1' } },
        ],
      };
    }
    return {};
  }
}

/** `facts` HAS an objectId, but the `Runtime.callFunctionOn` read of it resolves to `{ result: {} }` -- no `value` key -- exactly what `readHeldValue()` sees when CDP hands back a result with no `value` (never a throw). `meta`'s read is stubbed the same way so this exercises the `factsValue === undefined` branch regardless of read order. */
class FactsReadUndefinedStubClient {
  async send(method: string): Promise<unknown> {
    if (method === 'Runtime.evaluate') return { result: { objectId: 'container-1' } };
    if (method === 'Runtime.getProperties') {
      return {
        result: [
          { name: 'facts', value: { objectId: 'facts-1' } },
          { name: 'elements', value: { objectId: 'elements-1' } },
          { name: 'meta', value: { objectId: 'meta-1' } },
        ],
      };
    }
    if (method === 'Runtime.callFunctionOn') return { result: {} };
    return {};
  }
}

/** `facts` reads back successfully (a real non-empty array), but `meta`'s objectId is simply absent from the held container -- reproduces geometry.ts's Hole C without needing a Chrome-real page whose walk script somehow omits `meta`. */
class GeometryFactsOkNoMetaObjectIdStubClient {
  async send(method: string, params?: StubCallParams): Promise<unknown> {
    if (method === 'Runtime.evaluate') return { result: { objectId: 'container-1' } };
    if (method === 'Runtime.getProperties') {
      return {
        result: [
          { name: 'facts', value: { objectId: 'facts-1' } },
          { name: 'elements', value: { objectId: 'elements-1' } },
        ],
      };
    }
    if (method === 'Runtime.callFunctionOn' && params?.objectId === 'facts-1') {
      return { result: { value: [{ idx: 0, tag: 'div' }] } };
    }
    return {};
  }
}

/** `facts` reads back successfully, `meta` HAS an objectId, but reading it resolves to `{ result: {} }` (no `value`) -- geometry.ts's Hole C via an undefined `readHeldValue()` result rather than a missing objectId. */
class GeometryFactsOkMetaReadUndefinedStubClient {
  async send(method: string, params?: StubCallParams): Promise<unknown> {
    if (method === 'Runtime.evaluate') return { result: { objectId: 'container-1' } };
    if (method === 'Runtime.getProperties') {
      return {
        result: [
          { name: 'facts', value: { objectId: 'facts-1' } },
          { name: 'elements', value: { objectId: 'elements-1' } },
          { name: 'meta', value: { objectId: 'meta-1' } },
        ],
      };
    }
    if (method === 'Runtime.callFunctionOn' && params?.objectId === 'facts-1') {
      return { result: { value: [{ idx: 0, tag: 'div' }] } };
    }
    if (method === 'Runtime.callFunctionOn' && params?.objectId === 'meta-1') {
      return { result: {} };
    }
    return {};
  }
}

describe('geometry.json: a successful evaluate whose held facts/meta read fails still emits available:false, never a measured-empty artifact (I-4, finding 1 round 2, Holes A/B/C)', () => {
  // MUST FAIL PRE-FIX: pre-fix, `raw = (await readHeldValue(...)) ?? []` and
  // `elementsTruncated = meta?.elementsTruncated ?? 0` silently absorbed a
  // missing objectId/undefined read into the initialized empty/zero default
  // while leaving `available` at its default `true` -- these assertions on
  // `available`/`unavailableReason` would fail against that source.

  test('Hole A: resultObjectId present but the container has no facts objectId -> available:false, reason walk-facts-unavailable', async () => {
    const { ctx, written } = makeStubCtx(new NoFactsObjectIdStubClient());
    await collectGeometry(ctx);
    const geometry = written.get('geometry.json') as GeometryJson;
    assert.equal(geometry.available, false);
    assert.equal(geometry.unavailableReason, 'walk-facts-unavailable');
    assert.deepEqual(geometry.elements, []);
    assert.equal(geometry.elementsTruncated, 0);
  });

  test('Hole B: facts objectId present but readHeldValue() resolves to undefined (no thrown error) -> available:false, reason walk-facts-unavailable', async () => {
    const { ctx, written } = makeStubCtx(new FactsReadUndefinedStubClient());
    await collectGeometry(ctx);
    const geometry = written.get('geometry.json') as GeometryJson;
    assert.equal(geometry.available, false);
    assert.equal(geometry.unavailableReason, 'walk-facts-unavailable');
    assert.deepEqual(geometry.elements, []);
    assert.equal(geometry.elementsTruncated, 0);
  });

  test('Hole C (missing meta objectId): facts read fine but the container has no meta objectId -> available:false, reason walk-meta-unavailable, elementsTruncated never silently stamped 0-as-success', async () => {
    const { ctx, written } = makeStubCtx(new GeometryFactsOkNoMetaObjectIdStubClient());
    await collectGeometry(ctx);
    const geometry = written.get('geometry.json') as GeometryJson;
    assert.equal(geometry.available, false);
    assert.equal(geometry.unavailableReason, 'walk-meta-unavailable');
    assert.deepEqual(geometry.elements, []);
    assert.equal(geometry.elementsTruncated, 0);
  });

  test('Hole C (undefined meta read): facts read fine, meta objectId present but its readHeldValue() resolves to undefined -> available:false, reason walk-meta-unavailable', async () => {
    const { ctx, written } = makeStubCtx(new GeometryFactsOkMetaReadUndefinedStubClient());
    await collectGeometry(ctx);
    const geometry = written.get('geometry.json') as GeometryJson;
    assert.equal(geometry.available, false);
    assert.equal(geometry.unavailableReason, 'walk-meta-unavailable');
    assert.deepEqual(geometry.elements, []);
    assert.equal(geometry.elementsTruncated, 0);
  });
});

describe('hittest.json: a successful evaluate whose held facts read fails still emits available:false, never a measured-empty artifact (I-4, finding 1 round 2, Holes A prime/B prime)', () => {
  // MUST FAIL PRE-FIX: pre-fix, `raw = (await readHeldValue(...)) ?? raw`
  // silently kept the initialized-empty `raw` default (every truncation
  // count at 0) while leaving `available` at its default `true`.

  test("Hole A': resultObjectId present but the container has no facts objectId -> available:false, reason walk-facts-unavailable", async () => {
    const { ctx, written } = makeStubCtx(new NoFactsObjectIdStubClient());
    await collectHittest(ctx);
    const hittest = written.get('hittest.json') as HittestJson;
    assert.equal(hittest.available, false);
    assert.equal(hittest.unavailableReason, 'walk-facts-unavailable');
    assert.deepEqual(hittest.elements, []);
    assert.deepEqual(hittest.samples, []);
    assert.equal(hittest.elementsTruncated, 0);
    assert.equal(hittest.samplesTruncated, 0);
    assert.equal(hittest.bridgeTruncated, 0);
  });

  test("Hole B': facts objectId present but readHeldValue() resolves to undefined (no thrown error) -> available:false, reason walk-facts-unavailable", async () => {
    const { ctx, written } = makeStubCtx(new FactsReadUndefinedStubClient());
    await collectHittest(ctx);
    const hittest = written.get('hittest.json') as HittestJson;
    assert.equal(hittest.available, false);
    assert.equal(hittest.unavailableReason, 'walk-facts-unavailable');
    assert.deepEqual(hittest.elements, []);
    assert.deepEqual(hittest.samples, []);
    assert.equal(hittest.elementsTruncated, 0);
    assert.equal(hittest.samplesTruncated, 0);
    assert.equal(hittest.bridgeTruncated, 0);
  });
});

// ============================================================================
// Class B (Phase 3 sweep, geometry.ts): a successful collection that DOES
// emit real element records must never silently OMIT `backendNodeId` on a
// record whose per-element identity resolution failed -- distinct from the
// collection-level `available:false` failures above (those never emit any
// element record at all). Here the walk facts/meta/elements reads all
// succeed and one real RawGeometryFact comes back, but the per-element
// `objectId` bridge either has no entry for that index (no objectId to
// describe) or its `DOM.describeNode` call throws -- geometry.ts's
// `describeBackendNodeId` swallows the throw and returns `undefined`
// either way. Pre-fix, the record literal spread `backendNodeId,` straight
// from that `undefined`-valued local, producing a record whose
// `backendNodeId` key is present but holds `undefined` (not `null`) with no
// `identityUnresolved` marker at all -- the exact silent-omission finding
// (geometry.ts:403-407, 772-800) this block proves fixed.
// ============================================================================

interface MinimalRawGeometryFact {
  readonly idx: number;
  readonly tag: string;
  readonly domPath: string;
  readonly frame: { readonly frameId: string; readonly isTopFrame: boolean; readonly ancestorFrameIds: string[] };
  readonly shadow: null;
  readonly zIndex: string;
  readonly stackingContext: { readonly creates: boolean; readonly reasons: string[] };
  readonly visibility: { readonly visible: boolean; readonly opacity: number; readonly displayNone: boolean; readonly visibilityHidden: boolean; readonly zeroSize: boolean };
  readonly clipping: null;
  readonly layout: {
    readonly boxSizing: string;
    readonly position: string;
    readonly display: string;
    readonly overflowX: string;
    readonly overflowY: string;
    readonly scrollWidth: number;
    readonly scrollHeight: number;
    readonly clientWidth: number;
    readonly clientHeight: number;
    readonly contributesOverflowX: boolean;
    readonly contributesOverflowY: boolean;
    readonly minWidth: string;
    readonly maxWidth: string;
    readonly minHeight: string;
    readonly maxHeight: string;
    readonly aspectRatio: string;
    readonly flex: null;
    readonly grid: null;
  };
}

const MINIMAL_GEOMETRY_FACT: MinimalRawGeometryFact = {
  idx: 0,
  tag: 'div',
  domPath: 'html>body>div',
  frame: { frameId: 'main', isTopFrame: true, ancestorFrameIds: [] },
  shadow: null,
  zIndex: 'auto',
  stackingContext: { creates: false, reasons: [] },
  visibility: { visible: true, opacity: 1, displayNone: false, visibilityHidden: false, zeroSize: false },
  clipping: null,
  layout: {
    boxSizing: 'content-box',
    position: 'static',
    display: 'block',
    overflowX: 'visible',
    overflowY: 'visible',
    scrollWidth: 0,
    scrollHeight: 0,
    clientWidth: 0,
    clientHeight: 0,
    contributesOverflowX: false,
    contributesOverflowY: false,
    minWidth: 'auto',
    maxWidth: 'none',
    minHeight: 'auto',
    maxHeight: 'none',
    aspectRatio: 'auto',
    flex: null,
    grid: null,
  },
};

/** Facts/meta/elements all resolve successfully with ONE real element fact, and the `elements` bridge array has NO entry at all for index 0 -- reproduces geometry.ts's "no objectId to describe" identity-unresolved path (never bridged in the first place, as opposed to bridged-but-describe-failed below). */
class NoElementObjectIdStubClient {
  async send(method: string, params?: StubCallParams): Promise<unknown> {
    if (method === 'Runtime.evaluate') return { result: { objectId: 'container-1' } };
    if (method === 'Runtime.getProperties') {
      if (params?.objectId === 'container-1') {
        return {
          result: [
            { name: 'facts', value: { objectId: 'facts-1' } },
            { name: 'elements', value: { objectId: 'elements-1' } },
            { name: 'meta', value: { objectId: 'meta-1' } },
          ],
        };
      }
      if (params?.objectId === 'elements-1') return { result: [] }; // no index-0 entry -- never bridged
      return { result: [] };
    }
    if (method === 'Runtime.callFunctionOn') {
      if (params?.objectId === 'facts-1') return { result: { value: [MINIMAL_GEOMETRY_FACT] } };
      if (params?.objectId === 'meta-1') return { result: { value: { elementsTruncated: 0 } } };
    }
    return {};
  }
}

/** Facts/meta/elements all resolve successfully with ONE real element fact, and the `elements` bridge array DOES resolve index 0 to a real `objectId` -- but `DOM.describeNode` on that objectId throws, reproducing geometry.ts's `describeBackendNodeId` catch-and-return-undefined path on an otherwise-bridged element. `DOM.getContentQuads`/`DOM.getBoxModel` are ALSO stubbed to throw here -- geometry.ts now (post Phase 3.2 fix) surfaces that as `geometryUnavailable:true`/`geometryUnavailableReason:'quads-read-threw'` rather than a fabricated zero-size/invisible observation, orthogonal to the identity assertion this class exists for (see the dedicated `geometryUnavailable` block below for the honest-geometry-failure assertions). */
class DescribeNodeThrowsStubClient {
  async send(method: string, params?: StubCallParams): Promise<unknown> {
    if (method === 'Runtime.evaluate') return { result: { objectId: 'container-1' } };
    if (method === 'Runtime.getProperties') {
      if (params?.objectId === 'container-1') {
        return {
          result: [
            { name: 'facts', value: { objectId: 'facts-1' } },
            { name: 'elements', value: { objectId: 'elements-1' } },
            { name: 'meta', value: { objectId: 'meta-1' } },
          ],
        };
      }
      if (params?.objectId === 'elements-1') return { result: [{ name: '0', value: { objectId: 'el-0' } }] };
      return { result: [] };
    }
    if (method === 'Runtime.callFunctionOn') {
      if (params?.objectId === 'facts-1') return { result: { value: [MINIMAL_GEOMETRY_FACT] } };
      if (params?.objectId === 'meta-1') return { result: { value: { elementsTruncated: 0 } } };
    }
    if (method === 'DOM.describeNode') throw new Error('forced describeNode failure');
    if (method === 'DOM.getContentQuads' || method === 'DOM.getBoxModel') throw new Error('no layout box');
    return {};
  }
}

describe('geometry.json: a per-element identity-resolution failure on an otherwise-successful collection never silently omits backendNodeId (I-3, Phase 3 Class B)', () => {
  // MUST FAIL PRE-FIX: pre-fix, `backendNodeId` was spread straight from a
  // `number | undefined` local (`backendNodeId,`) with no `identityUnresolved`
  // field emitted at all. `record.backendNodeId` would be `undefined`, not
  // `null`, so `assert.equal(record.backendNodeId, null)` fails pre-fix; and
  // `record.identityUnresolved` would be `undefined`, so
  // `assert.equal(record.identityUnresolved, true)` fails pre-fix too.

  test('no bridged objectId at all for the element -> backendNodeId:null, identityUnresolved:true (never an omitted/undefined key)', async () => {
    const { ctx, written } = makeStubCtx(new NoElementObjectIdStubClient());
    await collectGeometry(ctx);
    const geometry = written.get('geometry.json') as GeometryJson;
    assert.equal(geometry.available, true);
    assert.equal(geometry.elements.length, 1);
    const record = geometry.elements[0];
    assert.ok('backendNodeId' in record, 'backendNodeId key must always be present on an emitted element record');
    assert.equal(record.backendNodeId, null);
    assert.equal(record.identityUnresolved, true);
  });

  test('objectId bridged but DOM.describeNode throws -> backendNodeId:null, identityUnresolved:true (never an omitted/undefined key)', async () => {
    const { ctx, written } = makeStubCtx(new DescribeNodeThrowsStubClient());
    await collectGeometry(ctx);
    const geometry = written.get('geometry.json') as GeometryJson;
    assert.equal(geometry.available, true);
    assert.equal(geometry.elements.length, 1);
    const record = geometry.elements[0];
    assert.ok('backendNodeId' in record, 'backendNodeId key must always be present on an emitted element record');
    assert.equal(record.backendNodeId, null);
    assert.equal(record.identityUnresolved, true);
  });

  test('resolved identity: successful describeNode omits identityUnresolved entirely (absent, not false)', async () => {
    const client = {
      async send(method: string, params?: StubCallParams): Promise<unknown> {
        if (method === 'Runtime.evaluate') return { result: { objectId: 'container-1' } };
        if (method === 'Runtime.getProperties') {
          if (params?.objectId === 'container-1') {
            return {
              result: [
                { name: 'facts', value: { objectId: 'facts-1' } },
                { name: 'elements', value: { objectId: 'elements-1' } },
                { name: 'meta', value: { objectId: 'meta-1' } },
              ],
            };
          }
          if (params?.objectId === 'elements-1') return { result: [{ name: '0', value: { objectId: 'el-0' } }] };
          return { result: [] };
        }
        if (method === 'Runtime.callFunctionOn') {
          if (params?.objectId === 'facts-1') return { result: { value: [MINIMAL_GEOMETRY_FACT] } };
          if (params?.objectId === 'meta-1') return { result: { value: { elementsTruncated: 0 } } };
        }
        if (method === 'DOM.describeNode') return { node: { backendNodeId: 4242 } };
        if (method === 'DOM.getContentQuads' || method === 'DOM.getBoxModel') throw new Error('no layout box');
        return {};
      },
    };
    const { ctx, written } = makeStubCtx(client);
    await collectGeometry(ctx);
    const geometry = written.get('geometry.json') as GeometryJson;
    const record = geometry.elements[0];
    assert.equal(record.backendNodeId, 4242);
    assert.equal('identityUnresolved' in record, false, 'identityUnresolved must be ABSENT (not false) when identity resolved');
  });
});

// ============================================================================
// Phase 3.2 sweep (geometry.ts): a per-element `DOM.getContentQuads`/
// `DOM.getBoxModel` read FAILURE must never collapse to the same
// zero-size/invisible shape a genuine no-layout-box element earns --
// distinct from Class B above (that covers the per-element IDENTITY bridge;
// this covers the per-element GEOMETRY read). Real Chrome (probed directly
// against `DOM.getContentQuads`/`DOM.getBoxModel`) confirms `DOM.getBoxModel`
// throws "Could not compute box model" for EVERY node with no box (the
// IDENTICAL throw a genuinely invalid/detached node reference produces),
// while `DOM.getContentQuads` resolves that same no-box case with a clean,
// non-throwing empty array -- so the two calls must be handled
// independently, not behind one combined try/catch.
// ============================================================================

const VISIBLE_GEOMETRY_FACT: MinimalRawGeometryFact = {
  ...MINIMAL_GEOMETRY_FACT,
  visibility: { visible: true, opacity: 1, displayNone: false, visibilityHidden: false, zeroSize: false },
};

/** Facts/meta/elements/identity all resolve successfully (a normal, otherwise-healthy element), but `DOM.getContentQuads` itself throws -- reproducing a genuine per-element geometry read failure that is NOT proof of "no layout box" (see the block doc above). `DOM.getBoxModel` is stubbed to throw too, but the fix must never even call it once `DOM.getContentQuads` has thrown. */
class QuadsReadThrowsStubClient {
  async send(method: string, params?: StubCallParams): Promise<unknown> {
    if (method === 'Runtime.evaluate') return { result: { objectId: 'container-1' } };
    if (method === 'Runtime.getProperties') {
      if (params?.objectId === 'container-1') {
        return {
          result: [
            { name: 'facts', value: { objectId: 'facts-1' } },
            { name: 'elements', value: { objectId: 'elements-1' } },
            { name: 'meta', value: { objectId: 'meta-1' } },
          ],
        };
      }
      if (params?.objectId === 'elements-1') return { result: [{ name: '0', value: { objectId: 'el-0' } }] };
      return { result: [] };
    }
    if (method === 'Runtime.callFunctionOn') {
      if (params?.objectId === 'facts-1') return { result: { value: [VISIBLE_GEOMETRY_FACT] } };
      if (params?.objectId === 'meta-1') return { result: { value: { elementsTruncated: 0 } } };
    }
    if (method === 'DOM.describeNode') return { node: { backendNodeId: 777 } };
    if (method === 'DOM.getContentQuads') throw new Error('forced getContentQuads failure');
    if (method === 'DOM.getBoxModel') throw new Error('getBoxModel must never be called once getContentQuads has thrown');
    return {};
  }
}

/** Facts/meta/elements/identity all resolve successfully AND `DOM.getContentQuads` resolves with a REAL non-empty quad (a genuine box exists), but the follow-up `DOM.getBoxModel` detail read throws -- reproducing an independent box-model-only failure that must not discard the already-proven rect/quads/visibility. */
class BoxModelReadThrowsStubClient {
  async send(method: string, params?: StubCallParams): Promise<unknown> {
    if (method === 'Runtime.evaluate') return { result: { objectId: 'container-1' } };
    if (method === 'Runtime.getProperties') {
      if (params?.objectId === 'container-1') {
        return {
          result: [
            { name: 'facts', value: { objectId: 'facts-1' } },
            { name: 'elements', value: { objectId: 'elements-1' } },
            { name: 'meta', value: { objectId: 'meta-1' } },
          ],
        };
      }
      if (params?.objectId === 'elements-1') return { result: [{ name: '0', value: { objectId: 'el-0' } }] };
      return { result: [] };
    }
    if (method === 'Runtime.callFunctionOn') {
      if (params?.objectId === 'facts-1') return { result: { value: [VISIBLE_GEOMETRY_FACT] } };
      if (params?.objectId === 'meta-1') return { result: { value: { elementsTruncated: 0 } } };
    }
    if (method === 'DOM.describeNode') return { node: { backendNodeId: 888 } };
    if (method === 'DOM.getContentQuads') return { quads: [[1, 2, 3, 2, 3, 4, 1, 4]] };
    if (method === 'DOM.getBoxModel') throw new Error('forced getBoxModel failure');
    return {};
  }
}

/** Facts/meta/elements/identity all resolve successfully AND `DOM.getContentQuads` resolves with a REAL, genuinely empty array (the honest "no layout box" result Chrome actually returns for e.g. `display:none` -- see the block doc above) -- never throws. `DOM.getBoxModel` is stubbed to throw if called at all, proving the fix's "only call getBoxModel once quads.length > 0" guard: this positive control must show `DOM.getBoxModel` was never invoked. */
class GenuineEmptyQuadsStubClient {
  boxModelCalled = false;
  async send(method: string, params?: StubCallParams): Promise<unknown> {
    if (method === 'Runtime.evaluate') return { result: { objectId: 'container-1' } };
    if (method === 'Runtime.getProperties') {
      if (params?.objectId === 'container-1') {
        return {
          result: [
            { name: 'facts', value: { objectId: 'facts-1' } },
            { name: 'elements', value: { objectId: 'elements-1' } },
            { name: 'meta', value: { objectId: 'meta-1' } },
          ],
        };
      }
      if (params?.objectId === 'elements-1') return { result: [{ name: '0', value: { objectId: 'el-0' } }] };
      return { result: [] };
    }
    if (method === 'Runtime.callFunctionOn') {
      if (params?.objectId === 'facts-1') return { result: { value: [MINIMAL_GEOMETRY_FACT] } }; // zeroSize:false, visible:true on the JS side -- CDP's real empty quads must still honestly override to zeroSize:true/visible:false
      if (params?.objectId === 'meta-1') return { result: { value: { elementsTruncated: 0 } } };
    }
    if (method === 'DOM.describeNode') return { node: { backendNodeId: 999 } };
    if (method === 'DOM.getContentQuads') return { quads: [] };
    if (method === 'DOM.getBoxModel') {
      this.boxModelCalled = true;
      throw new Error('DOM.getBoxModel must never be called when DOM.getContentQuads genuinely returned an empty array');
    }
    return {};
  }
}

describe('geometry.json: a per-element DOM.getContentQuads/DOM.getBoxModel read FAILURE never collapses to a fabricated zero-size/invisible observation, and a genuine empty-quads result is still preserved (I-4/I-5, Phase 3.2 residual sweep)', () => {
  // MUST FAIL PRE-FIX: pre-fix, ANY thrown DOM.getContentQuads/DOM.getBoxModel
  // read (via the combined `getContentQuadBox` helper) unconditionally set
  // `quads=[]`/`boxModel=null` and forced `zeroSize = fact.visibility.zeroSize
  // || quads.length===0` (always true) / `visible = fact.visibility.visible &&
  // quads.length>0` (always false), with NO `geometryUnavailable` field at
  // all -- indistinguishable from a genuinely zero-size/invisible element.
  // These assertions on `geometryUnavailable`/`geometryUnavailableReason` and
  // on `visibility.zeroSize`/`visibility.visible` reflecting the ORIGINAL
  // (true) JS-side facts would all fail against that source.

  test('DOM.getContentQuads throws for an otherwise-visible element -> geometryUnavailable:true, reason quads-read-threw, and visibility falls back to the true JS-side facts (never fabricated zero-size/invisible)', async () => {
    const { ctx, written } = makeStubCtx(new QuadsReadThrowsStubClient());
    await collectGeometry(ctx);
    const geometry = written.get('geometry.json') as GeometryJson;
    assert.equal(geometry.available, true);
    assert.equal(geometry.elements.length, 1);
    const record = geometry.elements[0];
    assert.equal(record.backendNodeId, 777, 'identity resolution is independent of the geometry read and must still succeed');
    assert.equal(record.identityUnresolved, undefined);
    assert.equal((record as unknown as { geometryUnavailable?: true }).geometryUnavailable, true);
    assert.equal((record as unknown as { geometryUnavailableReason?: string }).geometryUnavailableReason, 'quads-read-threw');
    assert.deepEqual(record.quads, []);
    assert.equal(record.boxModel, null);
    assert.deepEqual(record.rect, { x: 0, y: 0, width: 0, height: 0 });
    assert.equal(record.visibility.zeroSize, false, 'expected the TRUE JS-side zeroSize:false to survive a failed CDP quad read, never forced to true');
    assert.equal(record.visibility.visible, true, 'expected the TRUE JS-side visible:true to survive a failed CDP quad read, never forced to false');
  });

  test('DOM.getBoxModel throws after real (non-empty) quads succeeded -> geometryUnavailable:true, reason box-model-read-threw, but rect/quads/visibility stay the proven CDP observation', async () => {
    const { ctx, written } = makeStubCtx(new BoxModelReadThrowsStubClient());
    await collectGeometry(ctx);
    const geometry = written.get('geometry.json') as GeometryJson;
    assert.equal(geometry.elements.length, 1);
    const record = geometry.elements[0];
    assert.equal(record.backendNodeId, 888);
    assert.equal((record as unknown as { geometryUnavailable?: true }).geometryUnavailable, true);
    assert.equal((record as unknown as { geometryUnavailableReason?: string }).geometryUnavailableReason, 'box-model-read-threw');
    assert.equal(record.boxModel, null, 'the box-model DETAIL is unavailable');
    assert.equal(record.quads.length, 1, 'the real quads DID resolve and must be reported, not discarded');
    assert.equal(record.visibility.zeroSize, false, 'real non-empty quads honestly prove non-zero size');
    assert.equal(record.visibility.visible, true, 'real non-empty quads plus a visible JS fact honestly prove visibility');
  });

  test('positive control: DOM.getContentQuads genuinely resolves an empty array (no throw) -> honest zeroSize:true/visible:false with geometryUnavailable ABSENT, and DOM.getBoxModel is never called', async () => {
    const stubClient = new GenuineEmptyQuadsStubClient();
    const { ctx, written } = makeStubCtx(stubClient);
    await collectGeometry(ctx);
    const geometry = written.get('geometry.json') as GeometryJson;
    assert.equal(geometry.elements.length, 1);
    const record = geometry.elements[0];
    assert.equal(record.backendNodeId, 999);
    assert.equal('geometryUnavailable' in record, false, 'a genuine empty-quads result must never be flagged unavailable');
    assert.equal(stubClient.boxModelCalled, false, 'DOM.getBoxModel must never be invoked once DOM.getContentQuads genuinely proved there is no box');
    assert.equal(record.visibility.zeroSize, true, 'a real empty-quads CDP result is honest proof of zero size');
    assert.equal(record.visibility.visible, false, 'a real empty-quads CDP result is honest proof of invisibility');
    assert.deepEqual(record.quads, []);
    assert.equal(record.boxModel, null);
  });

  test('no bridged objectId at all -> geometryUnavailable:true, reason no-element-object-id, and visibility falls back to the true JS-side facts', async () => {
    const { ctx, written } = makeStubCtx(new NoElementObjectIdStubClient());
    await collectGeometry(ctx);
    const geometry = written.get('geometry.json') as GeometryJson;
    const record = geometry.elements[0];
    assert.equal(record.backendNodeId, null);
    assert.equal(record.identityUnresolved, true);
    assert.equal((record as unknown as { geometryUnavailable?: true }).geometryUnavailable, true);
    assert.equal((record as unknown as { geometryUnavailableReason?: string }).geometryUnavailableReason, 'no-element-object-id');
    assert.equal(record.visibility.zeroSize, MINIMAL_GEOMETRY_FACT.visibility.zeroSize, 'falls back to the true JS-side zeroSize fact, not a fabricated one');
    assert.equal(record.visibility.visible, MINIMAL_GEOMETRY_FACT.visibility.visible, 'falls back to the true JS-side visible fact, not a fabricated one');
  });

  // Real-Chrome positive controls: proves the honest shape against ACTUAL
  // `DOM.getContentQuads`/`DOM.getBoxModel` behavior, not just stub theatre --
  // a genuinely visible element and a genuinely `display:none` element both
  // still report the plain, unflagged benign shape (no `geometryUnavailable`
  // anywhere), exactly matching pre-fix output for the cases where nothing
  // actually failed.
  test('real Chrome: a genuinely visible element and a genuinely display:none element both resolve with geometryUnavailable absent everywhere', async () => {
    const client = await newClient(chromePort, 400, 400);
    try {
      await navigateAndWait(
        client,
        `<!doctype html><html><body>
          <div id="visible-el">visible content</div>
          <div id="hidden-el" style="display:none">hidden content</div>
          <div id="ready-marker"></div>
        </body></html>`,
      );
      const store: Record<string, unknown> = {};
      await collectGeometry(baseCtx(client, 'inv-geometry-real-noboxfailure', makeInMemoryWriter(store)));
      const geometry = store['geometry.json'] as GeometryJson;
      assert.equal(geometry.available, true);

      const visibleRecord = geometry.elements.find((e) => e.selector === '#visible-el');
      assert.ok(visibleRecord, 'expected a geometry record for #visible-el');
      assert.equal('geometryUnavailable' in visibleRecord!, false);
      assert.equal(visibleRecord!.visibility.visible, true);
      assert.equal(visibleRecord!.visibility.zeroSize, false);
      assert.ok(visibleRecord!.quads.length > 0);

      const hiddenRecord = geometry.elements.find((e) => e.selector === '#hidden-el');
      assert.ok(hiddenRecord, 'expected a geometry record for #hidden-el');
      assert.equal('geometryUnavailable' in hiddenRecord!, false, 'a genuine display:none element is an honest empty-quads result, not a read failure');
      assert.equal(hiddenRecord!.visibility.visible, false);
      assert.equal(hiddenRecord!.visibility.zeroSize, true);
      assert.deepEqual(hiddenRecord!.quads, []);
      assert.equal(hiddenRecord!.boxModel, null);
    } finally {
      client.close();
    }
  }, { timeout: 15000 });
});

// ============================================================================
// Finding 3 (source review, hittest.ts): bogus 'iframe-undefined' frame ids
// under bridge-cap exhaustion -- N/A for a dedicated adversarial test, documented:
//
// The fix (see hittest.ts's `iframeFrameId` helper) is applied and is
// structurally sufficient on its own. A regression test that forces
// `bridgeIndexOf(iframeEl)` to return `undefined` for a SAME-ORIGIN iframe's
// OWN identity is architecturally impractical here: `walkCandidates`
// unconditionally visits and bridges EVERY reachable same-origin iframe
// element (via its own `bridgeIndexOf(el)` call) during the collector's
// FIRST, cheap, non-cap-consuming DOM-only pass -- which always completes
// in full BEFORE the candidate/lattice sampling loops (the only code that
// bridges ordinary elements) ever run. So by the time any candidate or
// lattice point sampling could exhaust MAX_BRIDGE_ELEMENTS (3000), every
// reachable iframe's own bridge index has ALREADY been assigned (and is
// then read from cache, never re-evaluated, at every later use site,
// including `sampleStackAt`'s retargeting branch). Reproducing the bug
// would require >=3000 PRIOR visible same-origin iframes with real content
// already bridged ahead of the target iframe in DOM order -- thousands of
// real srcdoc iframe navigations in one page, which is impractical (slow,
// resource-heavy, and flaky) for a unit test and disproportionate to what
// it would prove beyond the fix already being structurally correct.
// ============================================================================

// ============================================================================
// Finding #24 (final coordinated honesty pass, hittest.ts): a PRIMARY
// element's CDP rect-upgrade read (`DOM.getContentQuads`/`DOM.getBoxModel`
// via coordinates.ts's `getContentQuadBox`, called from `resolveBridge`)
// REJECTING must never collapse to the same unmarked shape a genuinely
// JS-local (non-primary) stack member's rect produces -- pre-fix, the catch
// block silently kept `rect` undefined with no marker at all, so
// `patchMember`'s `info?.rect ?? member.rect` fallback was indistinguishable
// from an ordinary stack member that never even attempts the CDP upgrade by
// design. No real Chrome is needed: the only CDP calls this code path makes
// are `Runtime.evaluate`/`Runtime.getProperties`/`Runtime.callFunctionOn`
// (the walk + bridge resolution) plus `DOM.describeNode`/
// `DOM.getContentQuads`/`DOM.getBoxModel` (identity + geometry upgrade),
// all of which a minimal stub can drive directly at the real call site --
// same pattern as the Class B / Phase 3.2 geometry.ts blocks above.
// ============================================================================

const HITTEST_PRIMARY_MEMBER = {
  bridgeIdx: 0,
  selector: '#primary',
  tag: 'div',
  rect: { x: 1, y: 1, width: 2, height: 2 }, // the JS-local getBoundingClientRect() approximation
  zIndex: 'auto',
  pointerEvents: 'auto',
  cursor: 'auto',
  opacity: 1,
  disabled: false,
  ariaDisabled: false,
  inert: false,
  clipped: false,
  inShadowDom: false,
  inIframe: false,
  frameId: 'frame-0',
};

/** A second stack member at the SAME sample point, bridged (so its identity still resolves) but NOT referenced by any `RawElementSample.bridgeIdx` -- i.e. an ORDINARY, non-primary stack member that never attempts the CDP rect upgrade at all, by design. Its rect must stay JS-local with no failure marker, distinct from the primary member's failed-upgrade case below. */
const HITTEST_ORDINARY_MEMBER = {
  ...HITTEST_PRIMARY_MEMBER,
  bridgeIdx: 1,
  selector: '#ordinary',
  rect: { x: 10, y: 10, width: 5, height: 5 },
};

function hittestRawFacts(stack: unknown[]): unknown {
  return {
    bridgeCount: stack.length,
    elements: [
      {
        markIdx: 0,
        bridgeIdx: 0,
        selector: '#primary',
        points: [
          {
            label: 'center',
            result: {
              x: 5,
              y: 5,
              stack,
              topReceiver: stack[0],
              retargetedThroughIframe: false,
              retargetedThroughShadow: false,
              opaqueFrame: false,
            },
          },
        ],
        selfHitCount: 1,
        selfHitTotal: 1,
      },
    ],
    samples: [],
    elementsTruncated: 0,
    samplesTruncated: 0,
    bridgeTruncated: 0,
  };
}

/** `DOM.getContentQuads`/`DOM.getBoxModel` (the two calls `coordinates.ts`'s `getContentQuadBox` bundles behind one reject) both throw for the PRIMARY element's `objectId` (`el-0`) -- reproducing finding #24's real call-site rejection. Throws with a DISTINCT message if either is ever invoked for the ORDINARY member's `objectId` (`el-1`), proving the upgrade is genuinely only attempted for primary elements. */
class HittestQuadUpgradeThrowsStubClient {
  async send(method: string, params?: StubCallParams): Promise<unknown> {
    if (method === 'Runtime.evaluate') return { result: { objectId: 'container-1' } };
    if (method === 'Runtime.getProperties') {
      if (params?.objectId === 'container-1') {
        return {
          result: [
            { name: 'facts', value: { objectId: 'facts-1' } },
            { name: 'elements', value: { objectId: 'elements-1' } },
          ],
        };
      }
      if (params?.objectId === 'elements-1') {
        return {
          result: [
            { name: '0', value: { objectId: 'el-0' } },
            { name: '1', value: { objectId: 'el-1' } },
          ],
        };
      }
      return { result: [] };
    }
    if (method === 'Runtime.callFunctionOn' && params?.objectId === 'facts-1') {
      return { result: { value: hittestRawFacts([HITTEST_PRIMARY_MEMBER, HITTEST_ORDINARY_MEMBER]) } };
    }
    if (method === 'DOM.describeNode') {
      if (params?.objectId === 'el-0') return { node: { backendNodeId: 4242 } };
      if (params?.objectId === 'el-1') return { node: { backendNodeId: 5252 } };
      return {};
    }
    if (method === 'DOM.getContentQuads' || method === 'DOM.getBoxModel') {
      if (params?.objectId !== 'el-0') {
        throw new Error('the CDP rect upgrade must only ever be attempted for a PRIMARY element (bridge idx 0), never an ordinary stack member');
      }
      throw new Error('forced quad-box read failure');
    }
    return {};
  }
}

/** Companion positive control: `DOM.getContentQuads`/`DOM.getBoxModel` both RESOLVE for the sole primary element, with a real quad distinct from the JS-local rect -- proves a genuinely successful upgrade still reports honestly, with the failure marker ABSENT and `rect` replaced by the real CDP-derived quad-union rect. */
class HittestQuadUpgradeSucceedsStubClient {
  async send(method: string, params?: StubCallParams): Promise<unknown> {
    if (method === 'Runtime.evaluate') return { result: { objectId: 'container-1' } };
    if (method === 'Runtime.getProperties') {
      if (params?.objectId === 'container-1') {
        return {
          result: [
            { name: 'facts', value: { objectId: 'facts-1' } },
            { name: 'elements', value: { objectId: 'elements-1' } },
          ],
        };
      }
      if (params?.objectId === 'elements-1') return { result: [{ name: '0', value: { objectId: 'el-0' } }] };
      return { result: [] };
    }
    if (method === 'Runtime.callFunctionOn' && params?.objectId === 'facts-1') {
      return { result: { value: hittestRawFacts([HITTEST_PRIMARY_MEMBER]) } };
    }
    if (method === 'DOM.describeNode') return { node: { backendNodeId: 9191 } };
    if (method === 'DOM.getContentQuads') return { quads: [[100, 100, 120, 100, 120, 130, 100, 130]] };
    if (method === 'DOM.getBoxModel') {
      const q = [100, 100, 120, 100, 120, 130, 100, 130];
      return { model: { content: q, padding: q, border: q, margin: q, width: 20, height: 30 } };
    }
    return {};
  }
}

describe("hittest.json: a PRIMARY element's failed CDP rect-upgrade read never collapses to the same unmarked shape a deliberately JS-local (non-primary) rect produces (I-4/I-5, finding #24)", () => {
  // MUST FAIL PRE-FIX: pre-fix, resolveBridge's catch block silently kept
  // `rect` undefined with no marker of any kind, so patchMember's
  // `info?.rect ?? member.rect` fallback was indistinguishable from an
  // ordinary stack member's deliberately-always-JS-local rect.
  // `rectCdpUpgradeFailed` did not exist anywhere on the pre-fix
  // `HitTestStackMember` shape, so `primary.rectCdpUpgradeFailed` would be
  // `undefined` and the `assert.equal(primary.rectCdpUpgradeFailed, true)`
  // below fails against that source.

  test('DOM.getContentQuads/DOM.getBoxModel reject for the primary element -> rectCdpUpgradeFailed:true, rect stays the JS-local fallback, identity resolution is unaffected', async () => {
    const { ctx, written } = makeStubCtx(new HittestQuadUpgradeThrowsStubClient());
    await collectHittest(ctx);
    const hittest = written.get('hittest.json') as HittestJson;
    assert.equal(hittest.available, true);
    assert.equal(hittest.elements.length, 1);
    const point = hittest.elements[0].points[0].result;

    const primary = point.stack[0];
    assert.equal(primary.selector, '#primary');
    assert.equal(primary.backendNodeId, 4242, 'identity resolution is independent of the failed geometry read and must still succeed');
    assert.equal(primary.identityUnresolved, undefined);
    assert.deepEqual(primary.rect, { x: 1, y: 1, width: 2, height: 2 }, 'expected the JS-local getBoundingClientRect() rect to survive a failed CDP upgrade');
    assert.equal(primary.rectCdpUpgradeFailed, true, 'expected an explicit marker that the CDP rect upgrade failed and this rect is the JS-local approximation');
    assert.equal(point.topReceiver?.rectCdpUpgradeFailed, true, 'topReceiver is the same underlying record as stack[0] and must carry the same marker');

    // Positive control: an ORDINARY (non-primary) stack member's rect is
    // ALWAYS JS-local by design -- the upgrade is never even attempted for
    // it, which is not itself a failure, so it must carry NO marker.
    const ordinary = point.stack[1];
    assert.equal(ordinary.selector, '#ordinary');
    assert.equal(ordinary.backendNodeId, 5252);
    assert.deepEqual(ordinary.rect, { x: 10, y: 10, width: 5, height: 5 });
    assert.equal('rectCdpUpgradeFailed' in ordinary, false, 'a non-primary stack member never attempts the CDP upgrade, so it must never carry the upgrade-failed marker');
  });

  test('positive control: DOM.getContentQuads/DOM.getBoxModel genuinely resolve for the primary element -> rect is the real CDP-derived quad-union rect, rectCdpUpgradeFailed ABSENT', async () => {
    const { ctx, written } = makeStubCtx(new HittestQuadUpgradeSucceedsStubClient());
    await collectHittest(ctx);
    const hittest = written.get('hittest.json') as HittestJson;
    assert.equal(hittest.available, true);
    const primary = hittest.elements[0].points[0].result.stack[0];
    assert.equal(primary.backendNodeId, 9191);
    assert.deepEqual(primary.rect, { x: 100, y: 100, width: 20, height: 30 }, 'expected the real CDP-derived quad-union rect, not the JS-local fallback');
    assert.equal('rectCdpUpgradeFailed' in primary, false, 'a genuinely successful CDP rect upgrade must never be flagged as a failure');
  });

  // Real-Chrome positive control: proves the honest shape against actual
  // DOM.getContentQuads/DOM.getBoxModel behavior for a genuinely visible
  // primary element -- the upgrade succeeds, so rectCdpUpgradeFailed is
  // absent and rect reflects the real (non-zero) CDP-derived geometry.
  test('real Chrome: a genuinely visible primary element resolves its CDP rect upgrade with rectCdpUpgradeFailed absent', async () => {
    const client = await newClient(chromePort, 400, 400);
    try {
      await navigateAndWait(
        client,
        `<!doctype html><html><body>
          <button id="target" style="position:absolute;left:20px;top:20px;width:40px;height:20px">click me</button>
          <div id="ready-marker"></div>
        </body></html>`,
      );
      const store: Record<string, unknown> = {};
      await collectHittest(baseCtx(client, 'inv-hittest-real-quad-upgrade', makeInMemoryWriter(store)));
      const hittest = store['hittest.json'] as HittestJson;
      assert.equal(hittest.available, true);
      const el = hittest.elements.find((e) => e.selector === '#target');
      assert.ok(el, 'expected a hittest element record for #target');
      const centerPoint = el!.points.find((p) => p.label === 'center');
      assert.ok(centerPoint, 'expected a center-point sample for #target');
      const primary = centerPoint!.result.stack.find((m) => m.selector === '#target');
      assert.ok(primary, "expected #target to appear in its own center-point stack");
      assert.equal('rectCdpUpgradeFailed' in primary!, false, 'a genuinely successful real-Chrome CDP rect upgrade must never be flagged as a failure');
      assert.ok(primary!.rect.width > 0 && primary!.rect.height > 0, 'expected a real non-zero CDP-derived rect');
    } finally {
      client.close();
    }
  }, { timeout: 15000 });
});

// ============================================================================
// Hybrid-bar honesty fix pass, Child 2 (geometry.ts + hittest.ts) --
// G6, G17, H5, H7 from
// /Users/silasrhyneer/.crouter/canvas/nodes/mrea2mf5-82237291/context/final-measure-matrix-reaudit.md,
// closed per the settled I-4/I-5 read-layer scope in
// /Users/silasrhyneer/.crouter/canvas/nodes/mrcij7i9-8de09bf7/context/observational-collector-invariants.md.
// ============================================================================

/** Forces a same-origin (srcdoc) `<iframe>` element's `contentDocument` accessor to THROW once the page has fully loaded -- a genuine read failure distinct from an ordinary cross-origin iframe (which returns `null` without throwing and carries no G6/H7 marker). Reused by both the geometry.ts (G6, per-record) and hittest.ts (H7, aggregate) tests below since both collectors hit the identical `el.contentDocument` read pattern in their own tree walks. */
function buildIframeContentDocumentThrowsFixtureHtml(): string {
  return `<!doctype html><html><body>
    <iframe id="target-iframe" style="width:120px;height:80px;" srcdoc="<div id='inner' style='width:20px;height:20px;'>hi</div>"></iframe>
    <script>
      window.addEventListener('load', function () {
        var ifr = document.getElementById('target-iframe');
        Object.defineProperty(ifr, 'contentDocument', {
          get: function () { throw new Error('forced contentDocument failure'); }
        });
        var marker = document.createElement('div');
        marker.id = 'ready-marker';
        document.body.appendChild(marker);
      });
    </script>
  </body></html>`;
}

describe('geometry.json: a same-origin iframe whose contentDocument read THROWS marks the iframe record unavailable rather than silently skipping its subtree with no fact (I-4/I-5, G6)', () => {
  // MUST FAIL PRE-FIX: pre-fix, geometry.ts's IFRAME branch caught the throw,
  // set innerDoc=null, and returned with zero markers of any kind -- the
  // iframe's own record had no `iframeContentUnavailable` key at all (always
  // `undefined`), indistinguishable from a genuinely childless/cross-origin
  // iframe. `assert.equal(record.iframeContentUnavailable, true)` fails
  // against that source.
  let geometry: GeometryJson;
  let client: CDPClient;

  before(async () => {
    client = await newClient(chromePort, 400, 400);
    await navigateAndWait(client, buildIframeContentDocumentThrowsFixtureHtml());
    const store: Record<string, unknown> = {};
    await collectGeometry(baseCtx(client, 'inv-geometry-iframe-throws', makeInMemoryWriter(store)));
    geometry = store['geometry.json'] as GeometryJson;
  }, { timeout: 20000 });

  after(() => {
    try {
      client.close();
    } catch {
      // already closed
    }
  });

  test("the iframe element's own record carries iframeContentUnavailable:true / reason content-document-read-threw, and its subtree was never walked", () => {
    assert.equal(geometry.available, true);
    const record = geometry.elements.find((e) => e.selector === '#target-iframe');
    assert.ok(record, 'expected a geometry record for #target-iframe');
    assert.equal(
      (record as unknown as { iframeContentUnavailable?: true }).iframeContentUnavailable,
      true,
      "expected an explicit iframeContentUnavailable:true marker on the iframe's own record",
    );
    assert.equal(
      (record as unknown as { iframeContentUnavailableReason?: string }).iframeContentUnavailableReason,
      'content-document-read-threw',
    );

    // The subtree was never walked -- #inner must be absent from the artifact entirely.
    const inner = geometry.elements.find((e) => e.selector === '#inner');
    assert.equal(inner, undefined, 'expected #inner (inside the failed-read iframe) to be absent -- its subtree was never walked');
  });

  test('positive control: an ordinary same-origin iframe (contentDocument read never overridden) walks its subtree normally with iframeContentUnavailable absent', async () => {
    const normalClient = await newClient(chromePort, 400, 400);
    try {
      await navigateAndWait(
        normalClient,
        `<!doctype html><html><body>
          <iframe id="normal-iframe" style="width:120px;height:80px;" srcdoc="<div id='normal-inner' style='width:20px;height:20px;'>hi</div>"></iframe>
          <div id="ready-marker"></div>
        </body></html>`,
      );
      const store: Record<string, unknown> = {};
      await collectGeometry(baseCtx(normalClient, 'inv-geometry-iframe-normal', makeInMemoryWriter(store)));
      const normalGeometry = store['geometry.json'] as GeometryJson;
      const iframeRecord = normalGeometry.elements.find((e) => e.selector === '#normal-iframe');
      assert.ok(iframeRecord, 'expected a geometry record for #normal-iframe');
      assert.equal('iframeContentUnavailable' in iframeRecord!, false, 'a genuinely successful contentDocument read must never be flagged unavailable');
      const innerRecord = normalGeometry.elements.find((e) => e.selector === '#normal-inner');
      assert.ok(innerRecord, 'expected the subtree of a genuinely walkable same-origin iframe to be present');
    } finally {
      normalClient.close();
    }
  }, { timeout: 20000 });
});

describe('geometry.json: a malformed meta.elementsTruncated field on an otherwise-successful walk emits elementsTruncatedUnknown rather than a silent 0 (I-4/I-5 Layer 2, G17)', () => {
  // MUST FAIL PRE-FIX: pre-fix, `metaValue.elementsTruncated ?? 0` silently
  // treated a missing/malformed field as a proven "zero truncation"
  // observation, and `elementsTruncatedUnknown` did not exist anywhere on
  // GeometryJson -- `assert.equal(geometry.elementsTruncatedUnknown, true)`
  // fails against that source (the field is simply `undefined`).

  class MalformedElementsTruncatedStubClient {
    async send(method: string, params?: StubCallParams): Promise<unknown> {
      if (method === 'Runtime.evaluate') return { result: { objectId: 'container-1' } };
      if (method === 'Runtime.getProperties') {
        if (params?.objectId === 'container-1') {
          return {
            result: [
              { name: 'facts', value: { objectId: 'facts-1' } },
              { name: 'elements', value: { objectId: 'elements-1' } },
              { name: 'meta', value: { objectId: 'meta-1' } },
            ],
          };
        }
        return { result: [] }; // no index-0 entry for 'elements-1' -- irrelevant to this test, raw is empty
      }
      if (method === 'Runtime.callFunctionOn' && params?.objectId === 'facts-1') return { result: { value: [] } };
      if (method === 'Runtime.callFunctionOn' && params?.objectId === 'meta-1') {
        // 'meta' itself vouched for (a real held object read back successfully),
        // but its named elementsTruncated field is malformed -- a non-number
        // string, exactly the class of malformed-named-field the pre-fix `?? 0`
        // silently absorbed.
        return { result: { value: { elementsTruncated: 'not-a-number' } } };
      }
      return {};
    }
  }

  class MissingElementsTruncatedFieldStubClient {
    async send(method: string, params?: StubCallParams): Promise<unknown> {
      if (method === 'Runtime.evaluate') return { result: { objectId: 'container-1' } };
      if (method === 'Runtime.getProperties') {
        if (params?.objectId === 'container-1') {
          return {
            result: [
              { name: 'facts', value: { objectId: 'facts-1' } },
              { name: 'elements', value: { objectId: 'elements-1' } },
              { name: 'meta', value: { objectId: 'meta-1' } },
            ],
          };
        }
        return { result: [] };
      }
      if (method === 'Runtime.callFunctionOn' && params?.objectId === 'facts-1') return { result: { value: [] } };
      if (method === 'Runtime.callFunctionOn' && params?.objectId === 'meta-1') {
        // meta reads back as a real object, but the elementsTruncated KEY itself
        // is simply absent -- distinct from Hole C (missing meta objectId/undefined
        // meta read entirely), which already correctly collapses to available:false.
        return { result: { value: {} } };
      }
      return {};
    }
  }

  test('meta.elementsTruncated is a non-number string -> available stays true, elementsTruncated:0 placeholder, elementsTruncatedUnknown:true', async () => {
    const { ctx, written } = makeStubCtx(new MalformedElementsTruncatedStubClient());
    await collectGeometry(ctx);
    const geometry = written.get('geometry.json') as GeometryJson;
    assert.equal(geometry.available, true, 'a malformed elementsTruncated field must not collapse the whole successful collection to unavailable');
    assert.equal(geometry.elementsTruncated, 0);
    assert.equal((geometry as unknown as { elementsTruncatedUnknown?: true }).elementsTruncatedUnknown, true);
  });

  test('meta object reads back fine but the elementsTruncated key is entirely absent -> elementsTruncatedUnknown:true, never a silent 0-as-success', async () => {
    const { ctx, written } = makeStubCtx(new MissingElementsTruncatedFieldStubClient());
    await collectGeometry(ctx);
    const geometry = written.get('geometry.json') as GeometryJson;
    assert.equal(geometry.available, true);
    assert.equal(geometry.elementsTruncated, 0);
    assert.equal((geometry as unknown as { elementsTruncatedUnknown?: true }).elementsTruncatedUnknown, true);
  });
});

describe("hittest.json: document.elementsFromPoint() throwing or returning a nullish result marks every point stackUnavailable:true rather than a silent empty hit stack (I-4/I-5, H5)", () => {
  // MUST FAIL PRE-FIX: pre-fix, `doc.elementsFromPoint(localX, localY) || []`
  // collapsed BOTH a throw and a nullish return to the exact same empty-stack
  // shape a genuinely empty point produces, with no marker of any kind --
  // `stackUnavailable` did not exist anywhere on the pre-fix shape, so
  // `assert.equal(point.stackUnavailable, true)` fails against that source.

  function buildElementsFromPointOverrideFixtureHtml(behavior: 'throw' | 'null'): string {
    const override =
      behavior === 'throw'
        ? `document.elementsFromPoint = function () { throw new Error('forced elementsFromPoint failure'); };`
        : `document.elementsFromPoint = function () { return null; };`;
    return `<!doctype html><html><body>
      <button id="target" style="position:absolute;left:20px;top:20px;width:60px;height:30px">click me</button>
      <script>${override}</script>
      <div id="ready-marker"></div>
    </body></html>`;
  }

  async function collectWithOverride(behavior: 'throw' | 'null'): Promise<HittestJson> {
    const client = await newClient(chromePort, 300, 300);
    try {
      await navigateAndWait(client, buildElementsFromPointOverrideFixtureHtml(behavior));
      const store: Record<string, unknown> = {};
      await collectHittest(baseCtx(client, `inv-hittest-efp-${behavior}`, makeInMemoryWriter(store)));
      return store['hittest.json'] as HittestJson;
    } finally {
      client.close();
    }
  }

  test('elementsFromPoint throws -> every whole-viewport lattice sample AND every candidate point is stackUnavailable:true with an empty stack and null topReceiver', async () => {
    const hittest = await collectWithOverride('throw');
    assert.equal(hittest.available, true, 'a per-point read failure must not collapse the whole collection to unavailable');
    assert.ok(hittest.samples.length > 0, 'expected at least one whole-viewport lattice sample');
    for (const sample of hittest.samples) {
      assert.equal(sample.stackUnavailable, true);
      assert.deepEqual(sample.stack, []);
      assert.equal(sample.topReceiver, null);
    }
    assert.ok(hittest.elements.length > 0, 'expected #target to still be discovered as a candidate (walkCandidates does not depend on elementsFromPoint)');
    for (const el of hittest.elements) {
      for (const p of el.points) {
        assert.equal(p.result.stackUnavailable, true);
        assert.deepEqual(p.result.stack, []);
      }
      assert.equal(el.selfHitCount, 0, 'a failed hit-test read can never prove a self-hit');
    }
  }, { timeout: 20000 });

  test('elementsFromPoint returns null (no throw) -> same stackUnavailable:true honesty, never silently coerced to a proven empty stack', async () => {
    const hittest = await collectWithOverride('null');
    assert.ok(hittest.samples.length > 0);
    for (const sample of hittest.samples) {
      assert.equal(sample.stackUnavailable, true);
      assert.deepEqual(sample.stack, []);
      assert.equal(sample.topReceiver, null);
    }
  }, { timeout: 20000 });

  test('positive control: a real (unmodified) elementsFromPoint read reports stackUnavailable:false for a point that genuinely hits something', async () => {
    const client = await newClient(chromePort, 300, 300);
    try {
      await navigateAndWait(
        client,
        `<!doctype html><html><body>
          <button id="target" style="position:absolute;left:20px;top:20px;width:60px;height:30px">click me</button>
          <div id="ready-marker"></div>
        </body></html>`,
      );
      const store: Record<string, unknown> = {};
      await collectHittest(baseCtx(client, 'inv-hittest-efp-normal', makeInMemoryWriter(store)));
      const hittest = store['hittest.json'] as HittestJson;
      const el = hittest.elements.find((e) => e.selector === '#target');
      assert.ok(el, 'expected a hittest element record for #target');
      const centerPoint = el!.points.find((p) => p.label === 'center');
      assert.ok(centerPoint, 'expected a center-point sample for #target');
      assert.equal(centerPoint!.result.stackUnavailable, false, 'a genuinely successful elementsFromPoint read must report stackUnavailable:false');
      assert.ok(centerPoint!.result.stack.length > 0, 'expected a real, non-empty hit stack');
    } finally {
      client.close();
    }
  }, { timeout: 20000 });
});

describe('hittest.json: a same-origin iframe whose contentDocument read THROWS during the candidate walk emits an honest candidateIframesUnavailable aggregate rather than silently skipping inner candidates (I-4/I-5, H7)', () => {
  // MUST FAIL PRE-FIX: pre-fix, walkCandidates' IFRAME branch caught the
  // throw, set innerDoc=null, and returned with no marker at all --
  // `candidateIframesUnavailable` did not exist anywhere on the pre-fix
  // shape, so `typeof hittest.candidateIframesUnavailable === 'number'`
  // fails (it is `undefined`) and `hittest.candidateIframesUnavailable > 0`
  // fails too, against that source.

  test('the failing iframe increments candidateIframesUnavailable, and its inner candidate is never discovered', async () => {
    const client = await newClient(chromePort, 400, 400);
    try {
      await navigateAndWait(client, buildIframeContentDocumentThrowsFixtureHtml());
      const store: Record<string, unknown> = {};
      await collectHittest(baseCtx(client, 'inv-hittest-iframe-throws', makeInMemoryWriter(store)));
      const hittest = store['hittest.json'] as HittestJson;
      assert.equal(hittest.available, true, 'a per-iframe read failure must not collapse the whole collection to unavailable');
      assert.equal(typeof hittest.candidateIframesUnavailable, 'number', 'expected candidateIframesUnavailable to be an always-present number fact');
      assert.ok(hittest.candidateIframesUnavailable > 0, `expected a positive count for the forced contentDocument failure, got ${hittest.candidateIframesUnavailable}`);

      // The inner candidate (#inner, inside the failed-read iframe) must never
      // have been discovered as a hittest candidate -- its subtree was skipped.
      const innerCandidate = hittest.elements.find((e) => e.selector === '#inner');
      assert.equal(innerCandidate, undefined, 'expected #inner (inside the failed-read iframe) to be absent from hittest candidates');
    } finally {
      client.close();
    }
  }, { timeout: 20000 });

  test('positive control: an ordinary same-origin iframe (contentDocument read never overridden) reports candidateIframesUnavailable:0 and discovers its inner candidate', async () => {
    const client = await newClient(chromePort, 400, 400);
    try {
      await navigateAndWait(
        client,
        `<!doctype html><html><body>
          <iframe id="normal-iframe" style="width:120px;height:80px;" srcdoc="<button id='normal-inner' style='width:40px;height:20px;'>hi</button>"></iframe>
          <div id="ready-marker"></div>
        </body></html>`,
      );
      const store: Record<string, unknown> = {};
      await collectHittest(baseCtx(client, 'inv-hittest-iframe-normal', makeInMemoryWriter(store)));
      const hittest = store['hittest.json'] as HittestJson;
      assert.equal(hittest.candidateIframesUnavailable, 0);
      const innerCandidate = hittest.elements.find((e) => e.selector === '#normal-inner');
      assert.ok(innerCandidate, "expected the genuinely walkable iframe's inner candidate to be discovered");
    } finally {
      client.close();
    }
  }, { timeout: 20000 });
});
