/**
 * Real-Chrome integration test for U07's `geometry.ts`/`hittest.ts`
 * collectors. Unlike every other collector's stub-driven unit test, this
 * one spawns real headless Chrome and drives it over CDP end to end,
 * because the acceptance bar (quads differing from rects under a real CSS
 * transform, real iframe coordinate stitching, real flex/grid track
 * resolution, occlusion-aware hit-testing) requires a real layout engine
 * — a `StubCdpClient` (see `test/snapshot-settledness.test.ts`) can't
 * credibly fake any of it.
 *
 * One Chrome instance and one navigated tab are shared across every
 * `test()` block in this file (spun up once in `before`, torn down once
 * in `after`) — a real Chrome launch is slow, and the fixture page is
 * static, so nothing here needs a fresh tab per assertion.
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
  unstableRegions?: unknown[];
}

// ============================================================================
// Fixture — a `data:` URL parent with a `srcdoc` iframe (same-origin with
// its parent regardless of the parent's own scheme, so this needs no temp
// file and no local HTTP server). Covers the five acceptance-bearing
// shapes: a rotated (non-axis-aligned) transform, a same-origin iframe
// needing coordinate stitching, a flex container, a grid container, and an
// occluding overlay over a button for hit-test topReceiver resolution.
// ============================================================================

// A long, page-controlled `url()` cursor value (300+ chars once the browser
// re-serializes it into a computed-style string) -- a real-world analogue of
// a data-URI cursor image, used to prove `cursor` is capped (Fix 2).
const LONG_CURSOR_BASE64 = 'A'.repeat(400);

// A secret-shaped sentinel planted in BOTH an element id (-> selector) and
// its visible text. redaction.ts flags it (`sk-` token), so it must appear
// as `[REDACTED]` in geometry.json AND hittest.json, never raw -- the same
// string text.json/forms.json redact.
const SK_SENTINEL = 'sk-SENTINELabcdefghij0123456789';

// A boundary-STRADDLING secret sentinel for the geometry `text` field's
// 200-char per-field cap. `STRADDLE_PAD` is ~188 chars of short,
// non-secret-shaped runs; the `sk-` token then starts at ~char 190 and
// runs 40 chars, so it CROSSES the 200-char boundary. Under the old
// in-page pre-cap (slice-then-redact) the token was sliced to an ~11-char
// partial (`sk-BOUNDARY`) that is too short for redaction to recognize --
// it leaked. With the single node-side authority (redact-then-cap) the
// whole token is replaced by `[REDACTED]` before the cap runs, and the
// `sk-` prefix never appears. `STRADDLE_TOKEN` deliberately has >=13
// post-`sk-` chars so the embedded-secret matcher recognizes it whole.
const STRADDLE_PAD = 'wd '.repeat(63).trim();
const STRADDLE_TOKEN = 'sk-BOUNDARYSTRADDLE' + 'z'.repeat(21);

const FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
<div id="rotated" style="position:absolute;top:10px;left:10px;transform:rotate(20deg);width:100px;height:40px;background:blue;">R</div>
<iframe id="frame1" srcdoc="<div id='inner' style='margin:20px;width:50px;height:30px;background:red;'>inner</div>" style="width:200px;height:150px;position:absolute;top:300px;left:50px;border:none;"></iframe>
<div id="flexbox" style="display:flex;gap:10px;position:absolute;top:100px;left:10px;">
  <div class="flex-item" style="flex:1 1 auto;width:20px;height:20px;background:green;">a</div>
  <div class="flex-item" style="flex:2 1 auto;width:20px;height:20px;background:yellow;">b</div>
</div>
<div id="gridbox" style="display:grid;grid-template-columns:100px 200px;gap:5px;position:absolute;top:150px;left:10px;">
  <div class="grid-item" style="background:purple;">a</div>
  <div class="grid-item" style="background:orange;">b</div>
</div>
<button id="send" style="position:absolute;top:500px;left:50px;width:44px;height:44px;">Send</button>
<div id="overlay" style="position:absolute;top:490px;left:0;width:390px;height:100px;opacity:0;pointer-events:auto;z-index:10;"></div>
<div id="longcursor" style="position:absolute;top:800px;left:800px;width:10px;height:10px;cursor:url('data:image/png;base64,${LONG_CURSOR_BASE64}'),pointer;">c</div>
<div id="longgrid" style="display:grid;grid-template-columns:repeat(200,2px);position:absolute;top:850px;left:0;width:400px;">
  <div id="longgridchild" style="width:2px;height:2px;">g</div>
</div>
<div id="${SK_SENTINEL}" style="position:absolute;top:700px;left:600px;width:20px;height:20px;">leak ${SK_SENTINEL} x</div>
<div id="straddle" style="position:absolute;top:750px;left:400px;width:20px;height:20px;">${STRADDLE_PAD} ${STRADDLE_TOKEN}</div>
</body></html>`;

const FIXTURE_URL = `data:text/html,${encodeURIComponent(FIXTURE_HTML)}`;

// ============================================================================
// Chrome process harness — no new dependency, self-contained in this file.
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

/** Spawns headless Chrome on a randomized port, retrying with a fresh port a few times in case of collision with something else already listening. */
async function spawnHeadlessChrome(): Promise<{ proc: ChildProcess; port: number }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const port = 19200 + Math.floor(Math.random() * 700) + attempt * 137;
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

/** Polls `document.readyState` (plus a marker element proving the fixture's DOM is fully built) instead of racing a `Page.loadEventFired` listener registration against `Page.navigate`. */
async function waitForFixtureReady(client: CDPClient, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await client.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && document.getElementById('overlay') !== null`,
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

// ============================================================================
// Shared fixture state — one Chrome instance, one navigated tab, one
// collector run, reused by every test() below.
// ============================================================================

let chromeProc: ChildProcess | undefined;
let client: CDPClient | undefined;
let geometry: GeometryJson;
let hittest: HittestJson;

before(async () => {
  const { proc, port } = await spawnHeadlessChrome();
  chromeProc = proc;

  const wsUrl = await newPageTarget(port);
  client = new CDPClient(wsUrl);
  await client.waitReady();
  await enableDomainsForSnap(client);
  // A freshly `/json/new`-created tab's viewport defaults to something
  // smaller than the fixture's tallest fixed-position elements (button/
  // overlay at y=490-590) -- points below the actual viewport return an
  // empty `elementsFromPoint` stack. Enlarge it explicitly so every fixture
  // element is within the visible viewport for hit-testing.
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await client.send('Page.navigate', { url: FIXTURE_URL });
  await waitForFixtureReady(client);

  const store: Record<string, unknown> = {};
  const ctx: SnapshotContext = {
    client,
    dir: '/tmp/u07-measure-geometry-hittest-test-unused',
    snapId: 'u07-test-snap',
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

  await collectGeometry(ctx);
  await collectHittest(ctx);

  geometry = store['geometry.json'] as GeometryJson;
  hittest = store['hittest.json'] as HittestJson;
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

// ============================================================================
// Basic shape
// ============================================================================

test('geometry.json: elements array is non-empty and every record carries id + tag', () => {
  assert.ok(Array.isArray(geometry.elements));
  assert.ok(geometry.elements.length > 0);
  for (const el of geometry.elements) {
    assert.equal(typeof el.id, 'string');
    assert.ok(el.id.length > 0);
    assert.equal(typeof el.tag, 'string');
  }
});

test('hittest.json: elements + samples arrays are non-empty, and the whole-viewport lattice is capped', () => {
  assert.ok(Array.isArray(hittest.elements));
  assert.ok(hittest.elements.length > 0);
  assert.ok(Array.isArray(hittest.samples));
  assert.ok(hittest.samples.length > 0);
  assert.ok(hittest.samples.length <= 200, 'expected the LATTICE_MAX_POINTS cap to hold');
});

// ============================================================================
// 1. Rotated transform — quad differs from rect (non-axis-aligned + larger bbox)
// ============================================================================

test('#rotated: CDP quad is non-axis-aligned and its bbox is larger than the unrotated 100x40 rect', () => {
  const rotated = geometry.elements.find((e) => e.selector === '#rotated');
  assert.ok(rotated, 'expected a geometry record for #rotated');
  assert.ok(rotated!.quads.length > 0, 'expected at least one CDP quad');

  const quad = rotated!.quads[0];
  // An axis-aligned box's top-left/top-right corners share the same y, and
  // its bottom-right/bottom-left corners share the same y. A 20deg rotation
  // breaks both pairings by a wide margin (not just floating-point noise).
  const [, y1, , y2, , y3, , y4] = quad;
  assert.ok(Math.abs(y1 - y2) > 5, `expected non-axis-aligned top edge, got y1=${y1} y2=${y2}`);
  assert.ok(Math.abs(y3 - y4) > 5, `expected non-axis-aligned bottom edge, got y3=${y3} y4=${y4}`);

  // The AABB of a rotated 100x40 box is strictly larger than the unrotated
  // box in both dimensions (rotate(20deg): width ~107.6, height ~71.8).
  assert.ok(rotated!.rect.width > 100, `expected rect.width > 100, got ${rotated!.rect.width}`);
  assert.ok(rotated!.rect.height > 40, `expected rect.height > 40, got ${rotated!.rect.height}`);
});

// ============================================================================
// 2. Same-origin iframe — coordinates stitched into top-viewport space
// ============================================================================

test('#inner (inside the srcdoc iframe): rect.y is stitched into top-viewport space, greater than the iframe\'s own 300px offset', () => {
  const inner = geometry.elements.find((e) => e.selector === '#inner');
  assert.ok(inner, 'expected a geometry record for #inner');
  assert.ok(
    inner!.rect.y > 300,
    `expected #inner's top-viewport rect.y > 300 (iframe top offset), got ${inner!.rect.y} -- ` +
      'if this is ~20 (just the div\'s own margin), CDP quads are NOT already top-viewport-stitched and composeFrameTransform/toTopViewportQuad wiring is needed',
  );
  assert.equal(inner!.frame.isTopFrame, false);
  assert.notEqual(inner!.frame.frameId, 'frame-0');
});

// ============================================================================
// 3. Flex container — layout.flex provenance
// ============================================================================

test('.flex-item elements: both carry non-null layout.flex with the right grow factors and container gap', () => {
  const flexItems = geometry.elements.filter((e) => e.layout.flex !== null);
  assert.equal(flexItems.length, 2, 'expected exactly the two .flex-item elements to carry layout.flex');

  const a = flexItems.find((e) => e.text === 'a');
  const b = flexItems.find((e) => e.text === 'b');
  assert.ok(a && b, 'expected both flex items to be found by their direct text');
  assert.equal(a!.layout.flex!.grow, 1);
  assert.equal(b!.layout.flex!.grow, 2);
  assert.equal(a!.layout.flex!.container.gap, '10px');
  assert.equal(b!.layout.flex!.container.gap, '10px');
});

// ============================================================================
// 4. Grid container — layout.grid provenance
// ============================================================================

test('.grid-item elements: both carry non-null layout.grid, and the container resolves exact px track sizes', () => {
  // Scoped to the fixture's `.grid-item` text markers ('a'/'b') rather than
  // "every element with layout.grid !== null" -- the fixture also has a
  // #longgridchild grid item (used by the grid-track-array-cap regression
  // test below), which would otherwise inflate this count.
  const gridItems = geometry.elements.filter((e) => e.layout.grid !== null && (e.text === 'a' || e.text === 'b'));
  assert.equal(gridItems.length, 2, 'expected exactly the two .grid-item elements to carry layout.grid');

  for (const item of gridItems) {
    assert.deepEqual(item.layout.grid!.container.templateColumns, ['100px', '200px']);
  }
});

// ============================================================================
// 5. Hit-test occlusion — #send's center resolves to #overlay, not #send
// ============================================================================

test('hittest.json: #send\'s center-point topReceiver resolves to #overlay (occlusion-aware, not self)', () => {
  const sendSample = hittest.elements.find((e) => e.selector === '#send');
  assert.ok(sendSample, 'expected a hittest element sample for #send');

  const centerPoint = sendSample!.points.find((p) => p.label === 'center');
  assert.ok(centerPoint, 'expected a center-point sample for #send');
  assert.ok(centerPoint!.result.topReceiver, 'expected a topReceiver for the center point');
  assert.equal(centerPoint!.result.topReceiver!.selector, '#overlay');
  assert.notEqual(centerPoint!.result.topReceiver!.selector, '#send');

  // Corroborated by selfHitCount: since #overlay covers the whole 9-point
  // lattice of #send, #send should self-hit on none (or very few) of its
  // own sampled points.
  assert.ok(sendSample!.selfHitCount < sendSample!.selfHitTotal, 'expected #send to be occluded on at least one sampled point');
});

// ============================================================================
// 5b. Deep-stack backendNodeId bridging (Major 1 remediation) -- #send's
// center-point stack is occluded by #overlay, so #send itself surfaces as a
// NON-TOP stack member (stack[>0], underneath #overlay's topReceiver entry).
// Before this fix, only the primary sampled element and each point's TOP
// receiver (stack[0]) were bridged to a backendNodeId -- every deeper stack
// member was selector-only and NOT joinable to geometry.json. This asserts
// the deeper #send member now carries a backendNodeId, AND that it equals
// the SAME backendNodeId geometry.json resolves for #send -- proving it's a
// real cross-artifact join key, not merely present.
// ============================================================================

test('hittest.json: #send\'s center-point stack has a deeper (non-top) member (#send itself, underneath #overlay) that carries a backendNodeId joinable to geometry.json', () => {
  const sendSample = hittest.elements.find((e) => e.selector === '#send');
  assert.ok(sendSample, 'expected a hittest element sample for #send');

  const centerPoint = sendSample!.points.find((p) => p.label === 'center');
  assert.ok(centerPoint, 'expected a center-point sample for #send');

  const stack = centerPoint!.result.stack;
  assert.ok(stack.length > 1, 'expected #send\'s center-point stack to be deeper than just the top receiver (#overlay over #send over body/html)');

  // The top of the stack is #overlay (already covered by test 5); #send
  // itself must appear somewhere BELOW index 0.
  const deeperMembers = stack.slice(1);
  const deeperSend = deeperMembers.find((m) => m.selector === '#send');
  assert.ok(deeperSend, 'expected #send itself present as a deeper (non-top) stack member');

  assert.notEqual(
    deeperSend!.backendNodeId,
    undefined,
    'expected the deeper #send stack member to carry a backendNodeId -- deeper stack members must be bridged, not selector-only',
  );

  const geoSend = geometry.elements.find((e) => e.selector === '#send');
  assert.ok(geoSend, 'expected a geometry record for #send');
  assert.notEqual(geoSend!.backendNodeId, undefined, 'expected #send to carry a geometry backendNodeId');
  assert.equal(
    deeperSend!.backendNodeId,
    geoSend!.backendNodeId,
    `expected the deeper stack member's backendNodeId (${deeperSend!.backendNodeId}) to EQUAL geometry.json's #send backendNodeId (${geoSend!.backendNodeId}) -- proving deeper stack members join across artifacts by backendNodeId`,
  );
});

// ============================================================================
// 6. Regression (Fix 1) — a SECOND collectHittest() against the SAME live
// DOM must still resolve bridge data correctly. Before the fix, the bridge
// dedupe table was an expando (`__captureHitBridgeIdx`) written directly
// onto page elements and never cleaned up (only `window.__captureHitEls`
// was deleted), so a second run would read back a stale index without
// pushing the element into the new run's `bridgeEls` array -- dropping or
// corrupting `backendNodeId`/topReceiver resolution on repeat captures of
// the same tab. The fix replaced the expando with a `WeakMap` scoped to a
// single `Runtime.evaluate` invocation.
// ============================================================================

test('collectHittest(): a second run against the same live DOM still resolves bridge data (backendNodeId + #send/#overlay occlusion)', async () => {
  const store2: Record<string, unknown> = {};
  const ctx2: SnapshotContext = {
    client: client!,
    dir: '/tmp/u07-measure-geometry-hittest-test-unused',
    snapId: 'u07-test-snap-2',
    url: FIXTURE_URL,
    viewport: null,
    settled: true,
    freezeAnimations: false,
    captureUnsettled: false,
    pixels: false,
    state: [],
    unstableRegions: [],
    write: makeInMemoryWriter(store2),
  };

  await collectHittest(ctx2);
  const hittest2 = store2['hittest.json'] as HittestJson;

  assert.ok(hittest2.elements.length > 0, 'expected the second run to still walk elements');

  // Every PRIMARY sampled element must resolve a backendNodeId on the
  // second run, exactly as on the first -- proves the bridge isn't silently
  // dropping elements because of a stale expando index left by the first
  // run's walk. Tightened from `e.backendNodeId !== undefined` (per
  // hittest.ts's contract, backendNodeId is `number | null` and NEVER
  // `undefined` -- see HitTestElementSample's doc comment -- so that check
  // was vacuously true for every record regardless of whether identity
  // actually resolved, silently accepting a regression to `null`) to a
  // concrete-number check, which genuinely distinguishes a resolved
  // identity from an honestly-unresolved one (`null` + `identityUnresolved:
  // true`). This fixture's ~20 candidate elements are far under
  // MAX_ELEMENTS/MAX_BRIDGE_ELEMENTS, so every primary SHOULD resolve
  // concretely -- none of this fixture's records are a legitimate
  // identityUnresolved case.
  const withBackendNodeId = hittest2.elements.filter((e) => typeof e.backendNodeId === 'number');
  assert.equal(
    withBackendNodeId.length,
    hittest2.elements.length,
    'expected every primary element to resolve a concrete numeric backendNodeId on the second run',
  );

  // #send's occlusion by #overlay must still resolve correctly on the
  // second run, including the topReceiver's own backendNodeId (every
  // point's topReceiver is bridged, not just primaries -- see hittest.ts's
  // module doc).
  const sendSample2 = hittest2.elements.find((e) => e.selector === '#send');
  assert.ok(sendSample2, 'expected a hittest element sample for #send on the second run');
  const centerPoint2 = sendSample2!.points.find((p) => p.label === 'center');
  assert.ok(centerPoint2, 'expected a center-point sample for #send on the second run');
  const receiver2 = centerPoint2!.result.topReceiver;
  assert.ok(receiver2, 'expected a topReceiver for #send\'s center point on the second run');
  assert.equal(receiver2!.selector, '#overlay');
  assert.notEqual(receiver2!.selector, '#send');
  // Tightened from `assert.notEqual(receiver2!.backendNodeId, undefined, ...)`
  // for the same reason as above: backendNodeId is `number | null`, never
  // `undefined`, so the old assertion passed unconditionally even if
  // #overlay's topReceiver came back `identityUnresolved: true` /
  // `backendNodeId: null`. #overlay is an ordinary, un-capped fixture
  // element, so it SHOULD resolve concretely -- this is not a legitimate
  // identityUnresolved case.
  assert.equal(typeof receiver2!.backendNodeId, 'number', 'expected #overlay\'s topReceiver to resolve a concrete numeric backendNodeId on the second run');
  assert.notEqual(receiver2!.identityUnresolved, true, 'expected #overlay\'s topReceiver to not be marked identityUnresolved on the second run');
});

// ============================================================================
// 7. Regression (Fix 2) — page-controlled strings are capped
// ============================================================================

test('hittest.json: a long page-controlled cursor (url() data-URI) is capped, not written through uncapped', () => {
  const el = hittest.elements.find((e) => e.selector === '#longcursor');
  assert.ok(el, 'expected a hittest element sample for #longcursor');
  const centerPoint = el!.points.find((p) => p.label === 'center');
  assert.ok(centerPoint, 'expected a center-point sample for #longcursor');
  const receiver = centerPoint!.result.topReceiver;
  assert.ok(receiver, 'expected a topReceiver for #longcursor\'s center point');
  assert.equal(receiver!.selector, '#longcursor');
  assert.ok(receiver!.cursor.length > 0, 'expected a non-empty cursor string');
  assert.ok(
    receiver!.cursor.length <= 300,
    `expected the capped cursor string to be <= 300 chars, got ${receiver!.cursor.length} -- the uncapped computed cursor (url() + base64 data URI) is well over 400 chars`,
  );
});

// ============================================================================
// 8. Composed identity join (D3) — #send is one logical DOM node reachable
// from both geometry.json and hittest.json, and it MUST carry the SAME
// backendNodeId in both, proving backendNodeId is a real cross-artifact
// join key (not an independently-minted per-artifact handle).
// ============================================================================

test('composed identity: #send joins across geometry.json and hittest.json by an equal backendNodeId', () => {
  const geoSend = geometry.elements.find((e) => e.selector === '#send');
  assert.ok(geoSend, 'expected a geometry record for #send');
  assert.notEqual(geoSend!.backendNodeId, undefined, 'expected #send to carry a geometry backendNodeId');

  const hitSend = hittest.elements.find((e) => e.selector === '#send');
  assert.ok(hitSend, 'expected a hittest element sample for #send');
  assert.notEqual(hitSend!.backendNodeId, undefined, 'expected #send to carry a hittest backendNodeId');

  assert.equal(
    hitSend!.backendNodeId,
    geoSend!.backendNodeId,
    `expected #send's hittest backendNodeId (${hitSend!.backendNodeId}) to EQUAL its geometry backendNodeId (${geoSend!.backendNodeId}) -- proving at least one logical DOM node joins across artifacts by backendNodeId`,
  );
});

// ============================================================================
// 9. Secret redaction (D8b/D1) — a secret-shaped token planted in an
// element id (-> selector) and its visible text must be redacted in BOTH
// geometry.json and hittest.json, exactly as text.json/forms.json would.
// ============================================================================

test('geometry.json + hittest.json: a planted sk- token in an id-derived selector and visible text is secret-redacted, never written raw', () => {
  const geoJson = JSON.stringify(geometry);
  const hitJson = JSON.stringify(hittest);
  assert.ok(!geoJson.includes(SK_SENTINEL), 'sk- sentinel leaked raw into geometry.json');
  assert.ok(!hitJson.includes(SK_SENTINEL), 'sk- sentinel leaked raw into hittest.json');

  // Prove the sweep is meaningful: the sentinel element IS present in both
  // artifacts, with its selector redacted to `#[REDACTED]` (not simply
  // absent, which would make the negative sweep pass vacuously).
  const geoRedacted = geometry.elements.find((e) => e.selector === '#[REDACTED]');
  assert.ok(geoRedacted, 'expected the sentinel element present in geometry.json with a redacted selector');
  const hitRedacted = hittest.elements.find((e) => e.selector === '#[REDACTED]');
  assert.ok(hitRedacted, 'expected the sentinel element present in hittest.json with a redacted selector');
  assert.ok(hitRedacted!.text?.includes('[REDACTED]'), 'expected the sentinel visible text redacted in hittest.json');
});

// ============================================================================
// 9b. Boundary-straddle redaction (verdict finding A / judgment call (b)) --
// a secret that CROSSES the geometry `text` field's 200-char per-field cap
// must be fully redacted node-side. The old geometry-local sanitizer
// pre-capped IN-PAGE (`__capStr`) before node-side redaction ran, so a
// token straddling the boundary was sliced into a sub-16-char partial that
// redaction could no longer match -- and the `sk-` prefix leaked. With the
// single redaction.ts `sanitizeString({ max })` authority (redact-then-
// cap) the whole token becomes `[REDACTED]` before the cap applies.
// ============================================================================

test('geometry.json: a secret straddling the 200-char text cap is fully redacted (redact-then-cap), never sliced into a leaking partial', () => {
  const el = geometry.elements.find((e) => e.selector === '#straddle');
  assert.ok(el, 'expected a geometry record for #straddle');
  assert.equal(typeof el!.text, 'string');
  assert.ok(el!.text!.length > 0, 'expected non-empty straddle text');
  // No `sk-` prefix survives -- if a reintroduced in-page pre-cap sliced
  // the token, the leaked partial would still start with `sk-`.
  assert.ok(
    !el!.text!.includes('sk-'),
    `boundary-straddling sk- token leaked (whole or as a sliced partial) into geometry.json text: ${el!.text}`,
  );
  assert.ok(el!.text!.includes('[REDACTED]'), 'expected the straddling token replaced by [REDACTED] in geometry.json text');
  // Whole-artifact sweep: the distinctive token core never appears raw anywhere.
  assert.ok(!JSON.stringify(geometry).includes('BOUNDARYSTRADDLE'), 'straddle token core leaked raw into geometry.json');
});

test('geometry.json: an oversized grid-template-columns list is capped to a bounded array, not left unbounded', () => {
  const child = geometry.elements.find((e) => e.selector === '#longgridchild');
  assert.ok(child, 'expected a geometry record for #longgridchild');
  assert.ok(child!.layout.grid !== null, 'expected #longgridchild to carry layout.grid');
  const tracks = child!.layout.grid!.container.templateColumns;
  assert.ok(tracks.length > 0, 'expected at least one template-column track');
  assert.ok(
    tracks.length < 200,
    `expected the 200-track grid-template-columns to be capped well below 200, got ${tracks.length}`,
  );
});

// ============================================================================
// D9 real-Chrome: the follow-up Major flagged by the text/forms fix report --
// `geometry.ts`/`hittest.ts` used the exact same vulnerable pattern as the
// pre-fix `text.ts`/`forms.ts`: a predictable, guessable page-observable
// global (`window.__captureGeomEls`/`window.__captureHitEls`) assigned
// during the baseline phase. A page that predefines a setter for either
// name can synchronously mutate the DOM when the collector assigns it,
// contaminating the baseline `screenshot.png`/`dom.html` (the same class of
// attack the reviewer reproduced against `__captureTextEls`/
// `__captureFormEls`). The fix replaces both side-channels with the exact
// same CDP-only identity bridge `text.ts`/`forms.ts` were fixed to use: the
// walk's return value is a plain in-memory `{ facts, elements }` object,
// read back purely through `Runtime.getProperties`/`Runtime.callFunctionOn`/
// `Runtime.releaseObject` -- nothing is ever assigned to `window` or any
// other page-observable location.
//
// A same-page setter recorder (installed once, before either collector
// runs) is the detector; a positive-control sub-test runs FIRST and proves
// the detector itself catches a manually reintroduced `window.__captureGeomEls
// = []` / `window.__captureHitEls = []` -- the exact reported reproduction
// (`Object.defineProperty(window, '__captureGeomEls', { set(){...} })`) --
// so the negative result in the second test is meaningful: had
// collectGeometry/collectHittest still assigned either global, this test
// would have failed exactly the way the positive control proves it can.
// ============================================================================

const SETTER_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;font:16px sans-serif;">
<button id="btn" style="width:100px;height:40px;">Click me</button>
<div id="box" style="width:80px;height:80px;background:teal;">box</div>
<script>
  window.__setterFired = [];
  Object.defineProperty(window, '__captureGeomEls', {
    configurable: true,
    set: function () { window.__setterFired.push('__captureGeomEls'); },
    get: function () { return undefined; },
  });
  Object.defineProperty(window, '__captureHitEls', {
    configurable: true,
    set: function () { window.__setterFired.push('__captureHitEls'); },
    get: function () { return undefined; },
  });
</script>
</body></html>`;

const SETTER_FIXTURE_URL = `data:text/html,${encodeURIComponent(SETTER_FIXTURE_HTML)}`;

async function waitForSetterFixtureReady(c: CDPClient, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await c.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && Array.isArray(window.__setterFired)`,
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

describe('D9 real-Chrome: baseline collectGeometry/collectHittest never trigger a page-defined __captureGeomEls/__captureHitEls setter', () => {
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

  test('positive control: the recorder DOES catch a manually reintroduced window.__captureGeomEls/__captureHitEls assignment -- the exact reported reproduction', async () => {
    if (!setterClient) throw new Error('client not ready');
    await setterClient.send('Runtime.evaluate', { expression: 'window.__captureGeomEls = [];', returnByValue: true });
    await setterClient.send('Runtime.evaluate', { expression: 'window.__captureHitEls = [];', returnByValue: true });
    const fired = await readSetterFired(setterClient);
    assert.ok(fired.includes('__captureGeomEls'), 'the recorder must catch a manually reintroduced __captureGeomEls assignment');
    assert.ok(fired.includes('__captureHitEls'), 'the recorder must catch a manually reintroduced __captureHitEls assignment');

    // Reset the recorder for the real assertions below.
    await setterClient.send('Runtime.evaluate', { expression: 'window.__setterFired = [];', returnByValue: true });
  });

  test('collectGeometry + collectHittest running concurrently (the real baseline Promise.all shape) never trigger the __captureGeomEls/__captureHitEls setter, and backendNodeId still resolves', async () => {
    if (!setterClient) throw new Error('client not ready');
    const store: Record<string, unknown> = {};
    const ctx: SnapshotContext = {
      client: setterClient,
      dir: '/tmp/d9-measure-geometry-hittest-setter-unused',
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

    // Mirrors snapshot.ts's real baseline phase: both collectors run in the
    // SAME Promise.all -- the exact shape the reported deviation was about.
    await Promise.all([collectGeometry(ctx), collectHittest(ctx)]);

    const fired = await readSetterFired(setterClient);
    assert.deepEqual(
      fired,
      [],
      'neither collector may ever assign to window.__captureGeomEls/__captureHitEls (or trigger any page-defined setter for them)',
    );

    // Confirm the fix didn't break the join key this was all for -- both
    // collectors still resolve backendNodeId for the elements they walk, and
    // no bridgeCleanupFailed leak fact was recorded on a clean run.
    const geom = store['geometry.json'] as GeometryJson;
    const hit = store['hittest.json'] as HittestJson;
    const btn = geom.elements.find((e) => e.selector === '#btn');
    assert.ok(btn, 'expected a geometry record for #btn');
    assert.equal(typeof btn!.backendNodeId, 'number', 'geometry.json element must still carry a resolved backendNodeId');
    assert.ok(!('bridgeCleanupFailed' in geom), 'no cleanup-failure fact expected on a clean geometry run');

    const hitBtn = hit.elements.find((e) => e.selector === '#btn');
    assert.ok(hitBtn, 'expected a hittest element sample for #btn');
    assert.equal(typeof hitBtn!.backendNodeId, 'number', 'hittest.json element must still carry a resolved backendNodeId');
    assert.ok(!('bridgeCleanupFailed' in hit), 'no cleanup-failure fact expected on a clean hittest run');
  });
});
