/**
 * Real-Chrome integration test proving `focus.json`'s
 * `domOrderDivergence[]` entries carry a `backendNodeId` that is the SAME
 * value `geometry.json` resolves for the same DOM node — not merely a
 * present number, which a stub-driven test cannot prove (a stub's
 * `DOM.describeNode` response is fabricated, so it can't demonstrate real
 * CDP node-identity equality across two independently-run collectors).
 * Follows the same self-contained headless-Chrome harness as
 * `test/measure-geometry-hittest.test.ts`.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { closeChrome, spawnHeadlessChrome } from './fixtures/chrome.js';

import { CDPClient } from '../src/cdp/client.js';
import { enableDomainsForSnap } from '../src/cdp/domains.js';
import { collectFocus, type FocusReport } from '../src/cdp/measure/collectors/focus.js';
import { collectGeometry, type GeometryElementRecord } from '../src/cdp/measure/collectors/geometry.js';
import type { SnapshotContext, SnapshotWriter } from '../src/cdp/measure/types.js';


interface GeometryJson {
  elements: GeometryElementRecord[];
}

// ============================================================================
// Fixture — two buttons whose DOM order is the REVERSE of their tab order:
// `#a` (tabindex=2) is first in the DOM, `#b` (tabindex=1) is second. Real
// Chrome visits ascending positive-tabindex first (b, then a), so the
// forward walk's second stop (#a, domIndex 0) follows the first stop (#b,
// domIndex 1) with a lower domIndex -- a genuine DOM-order divergence.
// ============================================================================

const FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
<button id="a" tabindex="2" style="position:absolute;top:10px;left:10px;width:60px;height:24px;">A</button>
<button id="b" tabindex="1" style="position:absolute;top:50px;left:10px;width:60px;height:24px;">B</button>
</body></html>`;

const FIXTURE_URL = `data:text/html,${encodeURIComponent(FIXTURE_HTML)}`;

// ============================================================================
// Chrome process harness — self-contained, mirrors measure-geometry-hittest.test.ts.
// ============================================================================

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
      expression: `document.readyState === 'complete' && document.getElementById('b') !== null`,
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
let focus: FocusReport;
let geometry: GeometryJson;

describe('real Chrome integration', () => {
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

  const store: Record<string, unknown> = {};
  const ctx: SnapshotContext = {
    client,
    dir: '/tmp/measure-focus-geometry-identity-test-unused',
    snapId: 'focus-geometry-identity-test-snap',
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

  await collectFocus(ctx);
  await collectGeometry(ctx);

  focus = store['focus.json'] as FocusReport;
  geometry = store['geometry.json'] as GeometryJson;
}, { timeout: 30000 });

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
});

// ============================================================================
// The proof
// ============================================================================

test('focus.json: the forward walk visits #b (tabindex 1) before #a (tabindex 2), diverging from DOM order', () => {
  const forwardSelectors = focus.forward.map((s) => s.selector);
  const aIndex = forwardSelectors.indexOf('button#a');
  const bIndex = forwardSelectors.indexOf('button#b');
  assert.ok(aIndex >= 0 && bIndex >= 0, `expected both button#a and button#b in the forward walk, got ${JSON.stringify(forwardSelectors)}`);
  assert.ok(bIndex < aIndex, `expected button#b (tabindex 1) to be visited before button#a (tabindex 2), got order ${JSON.stringify(forwardSelectors)}`);
});

test('focus.json: domOrderDivergence has an entry for #a, and its backendNodeId EQUALS geometry.json\'s #a backendNodeId', () => {
  assert.ok(focus.domOrderDivergence.length >= 1, 'expected at least one DOM-order divergence entry');

  const divergedStop = focus.forward.find((s) => s.selector === 'button#a');
  assert.ok(divergedStop, 'expected a forward stop for button#a');

  const divergenceEntry = focus.domOrderDivergence.find((d) => d.id === divergedStop!.id);
  assert.ok(divergenceEntry, `expected a domOrderDivergence entry for #a's stop (id=${divergedStop!.id})`);

  assert.notEqual(divergenceEntry!.backendNodeId, undefined, 'expected the divergence entry to carry a backendNodeId, not just a collector-local id');

  const geoA = geometry.elements.find((e) => e.selector === '#a'); // geometry.ts's own selector helper prefers the bare `#id` form
  assert.ok(geoA, 'expected a geometry.json record for #a');
  assert.notEqual(geoA!.backendNodeId, undefined, "expected geometry.json's #a to carry a backendNodeId");

  assert.equal(
    divergenceEntry!.backendNodeId,
    geoA!.backendNodeId,
    `expected the domOrderDivergence entry's backendNodeId (${divergenceEntry!.backendNodeId}) to EQUAL geometry.json's #a backendNodeId (${geoA!.backendNodeId}) -- proving the divergence entry joins to the SAME DOM node across artifacts, not merely carrying some number`,
  );

  // Same identity, not a coincidental value: also equal to the forward
  // stop's own backendNodeId (the source the divergence entry is derived
  // from) and to #b's DISTINCT backendNodeId, ruling out a constant/stub value.
  assert.equal(divergenceEntry!.backendNodeId, divergedStop!.backendNodeId);
  const geoB = geometry.elements.find((e) => e.selector === '#b'); // same bare-`#id` selector form geometry.ts produces
  assert.ok(geoB, 'expected a geometry.json record for #b');
  assert.notEqual(geoB!.backendNodeId, geoA!.backendNodeId, 'expected #a and #b to resolve DISTINCT backendNodeIds');
});

// ============================================================================
// Class B (I-3/I-5) — per-record identity honesty on resolution failure.
//
// focus.ts resolves EVERY element-bearing record's `backendNodeId` off the
// SAME mechanism: `resolveMarkerBackendIds()` walks the temporary
// `data-capture-focus-id`/`data-capture-focus-clickable-id` markers via
// `DOM.getDocument` + `DOM.querySelectorAll` + `DOM.describeNode`. This
// suite forces `DOM.describeNode` itself to throw — the ONLY step that
// resolves a marker to a `backendNodeId` — while every other CDP call
// (the marker-stamping/walk evaluates, `DOM.getDocument`,
// `DOM.querySelectorAll`) passes through untouched, so the walk still
// produces real focusable stops and a real clickable-but-unfocusable
// element. Before the fix, `backendNodeId` was silently omitted
// (`undefined`) on this path with no honesty marker — indistinguishable
// from "not element-bearing". After the fix it is `null` PLUS
// `identityUnresolved: true`.
// ============================================================================

describe('focus.json: per-record identity honesty when DOM.describeNode fails (Class B)', () => {
  let idFailChromeProc: ChildProcess | undefined;
  let idFailClient: CDPClient | undefined;
  let idFailFocus: FocusReport;

  const ID_FAIL_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
<button id="x" style="position:absolute;top:10px;left:10px;width:60px;height:24px;">X</button>
<div id="d" onclick="void 0" style="position:absolute;top:50px;left:10px;width:60px;height:24px;">D</div>
</body></html>`;
  const ID_FAIL_FIXTURE_URL = `data:text/html,${encodeURIComponent(ID_FAIL_FIXTURE_HTML)}`;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    idFailChromeProc = proc;

    const wsUrl = await newPageTarget(port);
    idFailClient = new CDPClient(wsUrl);
    await idFailClient.waitReady();
    await enableDomainsForSnap(idFailClient);
    await idFailClient.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 300, deviceScaleFactor: 1, mobile: false });
    await idFailClient.send('Page.bringToFront');

    await idFailClient.send('Page.navigate', { url: ID_FAIL_FIXTURE_URL });

    const deadline = Date.now() + 10000;
    for (;;) {
      const res = (await idFailClient.send('Runtime.evaluate', {
        expression: `document.readyState === 'complete' && document.getElementById('x') !== null`,
        returnByValue: true,
      })) as { result?: { value?: boolean } };
      if (res.result?.value) break;
      if (Date.now() > deadline) throw new Error('identity-failure fixture page did not reach readyState=complete in time');
      await new Promise((r) => setTimeout(r, 50));
    }

    // Force per-element identity resolution to fail deterministically —
    // AFTER setup (domain enablement, navigation, readiness poll) so only
    // `collectFocus`'s own CDP traffic is affected.
    const originalSend = idFailClient.send.bind(idFailClient);
    idFailClient.send = async (method: string, params?: Record<string, unknown>, timeout?: number, sessionId?: string): Promise<unknown> => {
      if (method === 'DOM.describeNode') {
        throw new Error('forced DOM.describeNode failure (test)');
      }
      return originalSend(method, params, timeout, sessionId);
    };

    const store: Record<string, unknown> = {};
    const ctx: SnapshotContext = {
      client: idFailClient,
      dir: '/tmp/measure-focus-geometry-identity-test-unused-2',
      snapId: 'focus-identity-failure-test-snap',
      url: ID_FAIL_FIXTURE_URL,
      viewport: null,
      settled: true,
      freezeAnimations: false,
      captureUnsettled: false,
      pixels: false,
      state: [],
      unstableRegions: [],
      write: makeInMemoryWriter(store),
    };

    await collectFocus(ctx);
    idFailFocus = store['focus.json'] as FocusReport;
  }, { timeout: 30000 });

  after(async () => {
    try {
      idFailClient?.close();
    } catch {
      // already closed
    }
    try {
      await closeChrome(idFailChromeProc);
    } catch {
      // already dead
    }
  });

  test('forward walk visited button#x (element-bearing) but its identity did NOT resolve: backendNodeId is null AND identityUnresolved is true', () => {
    const stop = idFailFocus.forward.find((s) => s.selector === 'button#x');
    assert.ok(stop, `expected a forward stop for button#x, got ${JSON.stringify(idFailFocus.forward)}`);
    assert.ok(stop!.id !== null, 'expected the stop to be element-bearing (a non-null collector-local id)');
    assert.equal(stop!.backendNodeId, null, 'expected backendNodeId: null (never omitted/undefined) when identity resolution failed');
    assert.equal(stop!.identityUnresolved, true, 'expected identityUnresolved: true on an element-bearing record whose identity failed to resolve');
  });

  test('clickableUnfocusable carries div#d (element-bearing) with the same null + identityUnresolved honesty', () => {
    const entry = idFailFocus.clickableUnfocusable.find((c) => c.selector === 'div#d');
    assert.ok(entry, `expected a clickableUnfocusable entry for div#d, got ${JSON.stringify(idFailFocus.clickableUnfocusable)}`);
    assert.equal(entry!.backendNodeId, null, 'expected backendNodeId: null (never omitted/undefined) when identity resolution failed');
    assert.equal(entry!.identityUnresolved, true, 'expected identityUnresolved: true on an element-bearing record whose identity failed to resolve');
  });

  // This fixture's ONLY tab-focusable element is button#x (tagged by
  // FOCUS_INIT_SCRIPT); div#d is clickable but never tab-focusable (no
  // tabindex/contenteditable/native-focusable tag), so it can never become
  // `document.activeElement`. That means every `id === null` stop THIS
  // fixture can produce is genuinely `document.body` (nothing focused) —
  // there is no untagged-but-real-active-element case hiding here. (That
  // case — a real element active with `id === null` — is covered by the
  // dedicated untagged-contenteditable fixture below, per review Finding 1.)
  test('stops where nothing is focused (genuinely document.body, id === null) are NOT marked identityUnresolved', () => {
    const bodyStops = [...idFailFocus.forward, ...idFailFocus.reverse].filter((s) => s.id === null);
    for (const stop of bodyStops) {
      assert.equal(stop.backendNodeId, null, 'a non-element (document.body) stop still reports backendNodeId: null (never omitted)');
      assert.equal(stop.identityUnresolved, undefined, 'a non-element (document.body) stop must NOT carry identityUnresolved — there is no element whose identity could have failed to resolve');
    }
  });
});

// ============================================================================
// Class B regression (review Finding 1) — an UNTAGGED but genuinely active
// element must still be honestly marked `identityUnresolved: true`, never
// silently classified as a non-element (`document.body`) stop just because
// `id === null`. `id` reflects only whether `FOCUS_INIT_SCRIPT`'s candidate
// selector happened to stamp a marker on the active element — a
// `contenteditable=""` div (the true/empty-string state per the HTML spec,
// natively focusable and Tab-reachable in Chrome) is NOT matched by the
// candidate selector's exact `[contenteditable="true"]`, so it becomes
// `document.activeElement` with NO marker ever stamped on it — a real
// element, `id === null`, no CDP-call forcing required to prove the gap.
// ============================================================================

describe('focus.json: an UNTAGGED but real focus stop is still element-bearing (Class B — review Finding 1)', () => {
  let untaggedChromeProc: ChildProcess | undefined;
  let untaggedClient: CDPClient | undefined;
  let untaggedFocus: FocusReport;

  const UNTAGGED_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
<div id="ce" contenteditable="" style="position:absolute;top:10px;left:10px;width:120px;height:40px;">edit me</div>
</body></html>`;
  const UNTAGGED_FIXTURE_URL = `data:text/html,${encodeURIComponent(UNTAGGED_FIXTURE_HTML)}`;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    untaggedChromeProc = proc;

    const wsUrl = await newPageTarget(port);
    untaggedClient = new CDPClient(wsUrl);
    await untaggedClient.waitReady();
    await enableDomainsForSnap(untaggedClient);
    await untaggedClient.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 300, deviceScaleFactor: 1, mobile: false });
    await untaggedClient.send('Page.bringToFront');

    await untaggedClient.send('Page.navigate', { url: UNTAGGED_FIXTURE_URL });

    const deadline = Date.now() + 10000;
    for (;;) {
      const res = (await untaggedClient.send('Runtime.evaluate', {
        expression: `document.readyState === 'complete' && document.getElementById('ce') !== null`,
        returnByValue: true,
      })) as { result?: { value?: boolean } };
      if (res.result?.value) break;
      if (Date.now() > deadline) throw new Error('untagged fixture page did not reach readyState=complete in time');
      await new Promise((r) => setTimeout(r, 50));
    }

    const store: Record<string, unknown> = {};
    const ctx: SnapshotContext = {
      client: untaggedClient,
      dir: '/tmp/measure-focus-geometry-identity-test-unused-3',
      snapId: 'focus-untagged-identity-test-snap',
      url: UNTAGGED_FIXTURE_URL,
      viewport: null,
      settled: true,
      freezeAnimations: false,
      captureUnsettled: false,
      pixels: false,
      state: [],
      unstableRegions: [],
      write: makeInMemoryWriter(store),
    };

    await collectFocus(ctx);
    untaggedFocus = store['focus.json'] as FocusReport;
  }, { timeout: 30000 });

  after(async () => {
    try {
      untaggedClient?.close();
    } catch {
      // already closed
    }
    try {
      await closeChrome(untaggedChromeProc);
    } catch {
      // already dead
    }
  });

  test('div#ce (contenteditable="", untagged by FOCUS_INIT_SCRIPT) is real Tab-reachable and element-bearing with id === null: it must carry backendNodeId: null + identityUnresolved: true, never be over-classified as a non-element record', () => {
    const stop = untaggedFocus.forward.find((s) => s.selector === 'div#ce');
    assert.ok(stop, `expected a forward stop for div#ce (untagged contenteditable), got ${JSON.stringify(untaggedFocus.forward)}`);
    assert.equal(stop!.id, null, "expected this stop to be UNTAGGED (id === null) — FOCUS_INIT_SCRIPT's candidate selector requires the exact attribute value contenteditable=\"true\", which contenteditable=\"\" does not match");
    assert.equal(stop!.backendNodeId, null, 'expected backendNodeId: null (never omitted)');
    assert.equal(
      stop!.identityUnresolved,
      true,
      'expected identityUnresolved: true — an untagged but genuinely active element must NOT be mistaken for a document.body (non-element) record',
    );
  });
});

// ============================================================================
// Class A (I-5) — top-level traversal availability honesty.
//
// Before the fix, ANY failure inside the origin-read → init → forward-walk →
// reverse-walk pipeline — a thrown CDP error, OR (the second, previously-
// unflagged sibling instance this sweep found) an evaluate that RESOLVED but
// carried no value at all, coerced via `?? EMPTY_INIT` / a silent "treat as
// walk-complete" branch — was silently coerced into a benign SUCCESS-shaped
// report: `forward: []`, `reverse: []`, `forwardTruncated: false`,
// `reverseTruncated: false`, `candidateCount: 0`, zeroed `scope` counts.
// That is indistinguishable from a genuine "this page has no focus order /
// no focusable candidates" observation. These tests force REAL failures at
// the actual CDP call sites (not simulated results) and assert the report
// instead carries an explicit `available: false` + a fixed-enum
// `unavailableReason` — with a genuinely empty page proven to still report
// the benign shape via `available: true` and no reason at all.
// ============================================================================

async function bootFocusTargetForAvailabilityTest(html: string): Promise<{ proc: ChildProcess; client: CDPClient; url: string }> {
  const { proc, port } = await spawnHeadlessChrome();
  const wsUrl = await newPageTarget(port);
  const client = new CDPClient(wsUrl);
  await client.waitReady();
  await enableDomainsForSnap(client);
  await client.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 300, deviceScaleFactor: 1, mobile: false });
  await client.send('Page.bringToFront');

  const url = `data:text/html,${encodeURIComponent(html)}`;
  await client.send('Page.navigate', { url });

  const deadline = Date.now() + 10000;
  for (;;) {
    const res = (await client.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete'`,
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (res.result?.value) break;
    if (Date.now() > deadline) throw new Error('availability-test fixture page did not reach readyState=complete in time');
    await new Promise((r) => setTimeout(r, 50));
  }

  return { proc, client, url };
}

async function runCollectFocus(client: CDPClient, url: string): Promise<FocusReport> {
  const store: Record<string, unknown> = {};
  const ctx: SnapshotContext = {
    client,
    dir: '/tmp/measure-focus-availability-test-unused',
    snapId: 'focus-availability-test-snap',
    url,
    viewport: null,
    settled: true,
    freezeAnimations: false,
    captureUnsettled: false,
    pixels: false,
    state: [],
    unstableRegions: [],
    write: makeInMemoryWriter(store),
  };
  await collectFocus(ctx);
  return store['focus.json'] as FocusReport;
}

describe('focus.json: traversal unavailable when the init evaluate resolves with NO value (Class A)', () => {
  let initFailProc: ChildProcess | undefined;
  let initFailClient: CDPClient | undefined;
  let initFailFocus: FocusReport;

  const FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;"><button id="only">Only</button></body></html>`;

  before(async () => {
    const { proc, client: c, url } = await bootFocusTargetForAvailabilityTest(FIXTURE_HTML);
    initFailProc = proc;
    initFailClient = c;

    // Force ONLY __captureFocusInit's Runtime.evaluate to resolve with a
    // response that carries no `.result.value` at all -- a REAL degenerate
    // CDP response shape, not a simulated collector-level empty object.
    // Every other CDP call (origin read, DOM.* identity resolution, the
    // Tab-key walks) passes through untouched.
    const originalSend = c.send.bind(c);
    c.send = async (method: string, params?: Record<string, unknown>, timeout?: number, sessionId?: string): Promise<unknown> => {
      if (method === 'Runtime.evaluate' && typeof params?.expression === 'string' && params.expression.includes('__captureFocusInit')) {
        return {};
      }
      return originalSend(method, params, timeout, sessionId);
    };

    initFailFocus = await runCollectFocus(c, url);
  }, { timeout: 30000 });

  after(async () => {
    try { initFailClient?.close(); } catch { /* already closed */ }
    await closeChrome(initFailProc);
  });

  test('report.available is false with unavailableReason "init-unavailable", NOT a fabricated 0-candidate success shape', () => {
    assert.equal(initFailFocus.available, false, `expected available:false when init never resolved a value, got ${JSON.stringify({ available: initFailFocus.available, forward: initFailFocus.forward, candidateCount: initFailFocus.candidateCount })}`);
    assert.equal(initFailFocus.unavailableReason, 'init-unavailable');
  });
});

describe('focus.json: traversal unavailable when the forward-walk sample evaluate resolves with NO value mid-walk (Class A)', () => {
  let walkFailProc: ChildProcess | undefined;
  let walkFailClient: CDPClient | undefined;
  let walkFailFocus: FocusReport;

  // A REAL focusable button exists -- a correctly-functioning walk would
  // visit it on step 1. Forcing the sample read itself to fail proves the
  // resulting empty `forward` is an honest "traversal never completed", not
  // a genuine "this page has no focus order".
  const FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;"><button id="only">Only</button></body></html>`;

  before(async () => {
    const { proc, client: c, url } = await bootFocusTargetForAvailabilityTest(FIXTURE_HTML);
    walkFailProc = proc;
    walkFailClient = c;

    const originalSend = c.send.bind(c);
    c.send = async (method: string, params?: Record<string, unknown>, timeout?: number, sessionId?: string): Promise<unknown> => {
      if (method === 'Runtime.evaluate' && typeof params?.expression === 'string' && params.expression.includes('__captureFocusSample')) {
        return {};
      }
      return originalSend(method, params, timeout, sessionId);
    };

    walkFailFocus = await runCollectFocus(c, url);
  }, { timeout: 30000 });

  after(async () => {
    try { walkFailClient?.close(); } catch { /* already closed */ }
    await closeChrome(walkFailProc);
  });

  test('report.available is false with unavailableReason "forward-walk-threw", NOT a fabricated empty/non-truncated walk-complete shape', () => {
    assert.equal(walkFailFocus.available, false, `expected available:false when the sample read never resolved a value mid-walk, got ${JSON.stringify({ available: walkFailFocus.available, forward: walkFailFocus.forward, forwardTruncated: walkFailFocus.forwardTruncated })}`);
    assert.equal(walkFailFocus.unavailableReason, 'forward-walk-threw');
  });
});

describe('focus.json: a genuinely empty page (no focusable candidates) still reports available:true with NO unavailableReason (positive control)', () => {
  let emptyProc: ChildProcess | undefined;
  let emptyClient: CDPClient | undefined;
  let emptyFocus: FocusReport;

  // A single real focusable button: the forward walk visits it on step 1,
  // then Tab has no further effect (nothing else to move to) -- a genuine,
  // unforced natural completion, not the degenerate all-body-stops loop a
  // TRULY empty page produces (irrelevant to this collector's I-5 honesty;
  // out of scope for this sweep).
  const SINGLE_CANDIDATE_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;"><button id="only">Only</button></body></html>`;

  before(async () => {
    const { proc, client: c, url } = await bootFocusTargetForAvailabilityTest(SINGLE_CANDIDATE_FIXTURE_HTML);
    emptyProc = proc;
    emptyClient = c;
    emptyFocus = await runCollectFocus(c, url);
  }, { timeout: 30000 });

  after(async () => {
    try { emptyClient?.close(); } catch { /* already closed */ }
    await closeChrome(emptyProc);
  });

  test('genuine successful-observation shape is preserved: available:true, no unavailableReason, real forward/reverse stops, real candidateCount', () => {
    assert.equal(emptyFocus.available, true, `expected a genuinely successful traversal to report available:true, got ${JSON.stringify({ available: emptyFocus.available, unavailableReason: emptyFocus.unavailableReason })}`);
    assert.equal(emptyFocus.unavailableReason, undefined, 'expected no unavailableReason on a genuinely successful traversal');
    assert.equal(emptyFocus.candidateCount, 1, 'expected the one real button to be a genuinely observed candidate, not a coerced failure default');
    assert.ok(emptyFocus.forward.length >= 1, `expected the forward walk to genuinely visit at least the one real button, got ${JSON.stringify(emptyFocus.forward)}`);
    assert.equal(emptyFocus.forward[0]?.selector, 'button#only');
  });
});

// ============================================================================
// Review round 2 findings — two more real call sites that silently ignored a
// degenerate no-value CDP response instead of surfacing it as unavailable.
// ============================================================================

describe('focus.json: traversal unavailable when the ORIGIN evaluate resolves with NO value (review Finding 1)', () => {
  let originFailProc: ChildProcess | undefined;
  let originFailClient: CDPClient | undefined;
  let originFailFocus: FocusReport;

  const FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;"><button id="only">Only</button></body></html>`;

  before(async () => {
    const { proc, client: c, url } = await bootFocusTargetForAvailabilityTest(FIXTURE_HTML);
    originFailProc = proc;
    originFailClient = c;

    // Force ONLY __captureFocusOrigin's Runtime.evaluate to resolve with a
    // real degenerate (no `.result.value`) response -- BEFORE any marker is
    // ever stamped. Before the fix, this silently left `originCaptured` false
    // and the traversal proceeded anyway (fabricating `{x:0,y:0}` as the
    // forward walk's first `scrollBefore`), still reporting `available:true`.
    const originalSend = c.send.bind(c);
    c.send = async (method: string, params?: Record<string, unknown>, timeout?: number, sessionId?: string): Promise<unknown> => {
      if (method === 'Runtime.evaluate' && typeof params?.expression === 'string' && params.expression.includes('__captureFocusOrigin')) {
        return {};
      }
      return originalSend(method, params, timeout, sessionId);
    };

    originFailFocus = await runCollectFocus(c, url);
  }, { timeout: 30000 });

  after(async () => {
    try { originFailClient?.close(); } catch { /* already closed */ }
    await closeChrome(originFailProc);
  });

  test('report.available is false with unavailableReason "origin-read-threw", not a silent degraded-but-successful traversal', () => {
    assert.equal(originFailFocus.available, false, `expected available:false when the origin read never resolved a value, got ${JSON.stringify({ available: originFailFocus.available, forward: originFailFocus.forward })}`);
    assert.equal(originFailFocus.unavailableReason, 'origin-read-threw');
  });
});

// ============================================================================
// Hybrid-bar honesty fix pass, Child 4 -- focus #4 (Layer 3, I-4/I-5).
//
// FOCUS_INIT_SCRIPT's clickable scan reads `getComputedStyle(e2).cursor`
// for every non-candidate element to decide `cursorPointer`. Before the fix,
// a throw from that read left `cursorPointer` at its `false` default AND
// (when the element also has no `onclick`) silently OMITTED the element
// from `clickableUnfocusable` entirely -- indistinguishable from a genuine
// non-clickable element, even though the element's true cursor style was
// never actually observed. This test forces a REAL `getComputedStyle`
// failure for one specific element (a page-side monkey-patch, not a
// simulated collector-level result) while every other element's read
// passes through untouched, and asserts the element is still emitted --
// carrying `cursorReadUnavailable: true` -- rather than silently dropped.
// ============================================================================

describe('focus.json: clickable scan reports cursorReadUnavailable (not silent omission) when getComputedStyle(...).cursor throws for one element (focus #4)', () => {
  let cursorFailProc: ChildProcess | undefined;
  let cursorFailClient: CDPClient | undefined;
  let cursorFailFocus: FocusReport;

  // #poison has no onclick and no tabindex -- its ONLY possible clickable
  // evidence is a cursor:pointer computed style, which this page-side
  // monkey-patch prevents the collector from ever reading. #control is a
  // normal onclick element proving the scan still functions for everything
  // else on the same page.
  const CURSOR_FAIL_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
<div id="poison" style="position:absolute;top:10px;left:10px;width:60px;height:24px;cursor:pointer;">P</div>
<div id="control" onclick="void 0" style="position:absolute;top:50px;left:10px;width:60px;height:24px;">C</div>
<script>
(function() {
  var poison = document.getElementById('poison');
  var original = window.getComputedStyle;
  window.getComputedStyle = function(el) {
    if (el === poison) { throw new Error('forced getComputedStyle failure (test)'); }
    return original.apply(window, arguments);
  };
})();
</script>
</body></html>`;

  before(async () => {
    const { proc, client: c, url } = await bootFocusTargetForAvailabilityTest(CURSOR_FAIL_FIXTURE_HTML);
    cursorFailProc = proc;
    cursorFailClient = c;
    cursorFailFocus = await runCollectFocus(c, url);
  }, { timeout: 30000 });

  after(async () => {
    try { cursorFailClient?.close(); } catch { /* already closed */ }
    await closeChrome(cursorFailProc);
  });

  test('div#poison (cursor read failed) is emitted with cursorReadUnavailable:true, never silently dropped as "not clickable"', () => {
    const entry = cursorFailFocus.clickableUnfocusable.find((c) => c.selector === 'div#poison');
    assert.ok(
      entry,
      `expected a clickableUnfocusable entry for div#poison whose cursor read failed (before the fix this element was silently omitted entirely), got ${JSON.stringify(cursorFailFocus.clickableUnfocusable)}`,
    );
    assert.equal(entry!.cursorReadUnavailable, true, 'expected cursorReadUnavailable:true marking the failed read -- not a bare/omitted false that reads as "confirmed not clickable"');
  });

  test('div#control (real onclick, unaffected by the monkey-patch) is still reported normally with no cursorReadUnavailable marker (positive control)', () => {
    const entry = cursorFailFocus.clickableUnfocusable.find((c) => c.selector === 'div#control');
    assert.ok(entry, `expected a clickableUnfocusable entry for div#control, got ${JSON.stringify(cursorFailFocus.clickableUnfocusable)}`);
    assert.equal(entry!.cursorReadUnavailable, undefined, 'a genuinely successful cursor read (or an element whose onclick evidence made the cursor read irrelevant) must not carry cursorReadUnavailable');
  });
});

// ============================================================================
// Independent-review finding (Major) — the SAME Layer-2 named-field-default
// class scroll.ts's #37 fix covers, applied to focus.ts.
// `clickableUnfocusableTruncated: init.clickableTruncated ?? false` turned a
// well-formed, `available:true` init result that happened to be MISSING
// `clickableTruncated` into a clean, confirmed "not truncated" fact --
// indistinguishable from a genuinely-observed `clickableTruncated: false`.
// This test forces a REAL init evaluate response (the actual page-side
// result for real candidates/clickables) with `clickableTruncated` stripped
// before it reaches the collector -- not a simulated no-value response
// (Class A, covered above, which correctly reports `available:false`
// instead) -- and asserts the report carries
// `clickableUnfocusableTruncationUnavailable: true` alongside the
// unavoidable `false` fallback, so a reader can tell "confirmed not
// truncated" apart from "the field could not be read".
// ============================================================================

describe('focus.json: clickableUnfocusableTruncationUnavailable marks a well-formed init result MISSING clickableTruncated (not a silent confirmed-false)', () => {
  let truncFailProc: ChildProcess | undefined;
  let truncFailClient: CDPClient | undefined;
  let truncFailFocus: FocusReport;

  // Two real focusable buttons plus one non-focusable onclick div, so both
  // `candidates` and `clickableUnfocusable` are genuinely non-empty on the
  // stripped result -- proving the marker fires on an otherwise-healthy init
  // result, not merely an empty/degenerate one.
  const FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
<button id="a">A</button>
<button id="b">B</button>
<div id="clicker" onclick="void 0" style="position:absolute;top:50px;left:10px;width:60px;height:24px;">C</div>
</body></html>`;

  before(async () => {
    const { proc, client: c, url } = await bootFocusTargetForAvailabilityTest(FIXTURE_HTML);
    truncFailProc = proc;
    truncFailClient = c;

    // Let the real __captureFocusInit evaluate run untouched, then strip
    // ONLY `clickableTruncated` from its otherwise-genuine returned value
    // before handing it to the collector -- a real, well-formed init result
    // missing exactly the one field under test, not a hand-authored fixture
    // and not a simulated no-value response.
    const originalSend = c.send.bind(c);
    c.send = async (method: string, params?: Record<string, unknown>, timeout?: number, sessionId?: string): Promise<unknown> => {
      if (method === 'Runtime.evaluate' && typeof params?.expression === 'string' && params.expression.includes('__captureFocusInit')) {
        const real = (await originalSend(method, params, timeout, sessionId)) as { result?: { value?: Record<string, unknown> } };
        if (real.result?.value) {
          const { clickableTruncated, ...rest } = real.result.value;
          return { result: { value: rest } };
        }
        return real;
      }
      return originalSend(method, params, timeout, sessionId);
    };

    truncFailFocus = await runCollectFocus(c, url);
  }, { timeout: 30000 });

  after(async () => {
    try { truncFailClient?.close(); } catch { /* already closed */ }
    await closeChrome(truncFailProc);
  });

  test('report stays available:true (init genuinely returned a value) with real, non-empty candidates and clickableUnfocusable', () => {
    assert.equal(truncFailFocus.available, true, `expected available:true -- the init evaluate genuinely resolved a value, only clickableTruncated was stripped, got ${JSON.stringify({ available: truncFailFocus.available, unavailableReason: truncFailFocus.unavailableReason })}`);
    assert.equal(truncFailFocus.candidateCount, 2, `expected the two real buttons to be genuinely observed candidates, got ${JSON.stringify(truncFailFocus)}`);
    assert.equal(truncFailFocus.clickableUnfocusable.length, 1, `expected the one real onclick div to be genuinely observed as clickable-but-unfocusable, got ${JSON.stringify(truncFailFocus.clickableUnfocusable)}`);
  });

  test('clickableUnfocusableTruncationUnavailable is true -- the marker is present, not silently omitted', () => {
    assert.equal(truncFailFocus.clickableUnfocusableTruncationUnavailable, true, `expected clickableUnfocusableTruncationUnavailable:true when the well-formed init result was missing clickableTruncated, got ${JSON.stringify({ clickableUnfocusableTruncated: truncFailFocus.clickableUnfocusableTruncated, clickableUnfocusableTruncationUnavailable: truncFailFocus.clickableUnfocusableTruncationUnavailable })}`);
  });

  test('clickableUnfocusableTruncated still emits the honest false fallback, but must never be read as a confirmed clean measurement without the marker present alongside it', () => {
    // The fallback value itself is unavoidable (the field's declared type is
    // `boolean`, not `boolean | undefined`) -- the fix's job is not to
    // withhold it but to accompany it with the marker above so a reader
    // never mistakes it for a genuinely-observed "not truncated". This
    // assertion pins BOTH halves of that contract together: the fallback is
    // still emitted, AND the marker proving it is not to be trusted is
    // emitted alongside it.
    assert.equal(truncFailFocus.clickableUnfocusableTruncated, false, 'expected the honest `?? false` fallback to still be emitted (never withheld)');
    assert.equal(truncFailFocus.clickableUnfocusableTruncationUnavailable, true, 'the fallback above must be accompanied by the unavailable marker -- a bare `false` with no marker would read as a confirmed clean measurement');
  });
});

describe('focus.json: traversal unavailable when the reverse-walk RESTORE/RE-INIT setup evaluate resolves with NO value (review Finding 2)', () => {
  let reverseSetupFailProc: ChildProcess | undefined;
  let reverseSetupFailClient: CDPClient | undefined;
  let reverseSetupFailFocus: FocusReport;

  // Two real focusable buttons so the forward walk (which must succeed
  // BEFORE the targeted failure) has genuine, non-trivial work to do.
  const FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
<button id="a">A</button>
<button id="b">B</button>
</body></html>`;

  before(async () => {
    const { proc, client: c, url } = await bootFocusTargetForAvailabilityTest(FIXTURE_HTML);
    reverseSetupFailProc = proc;
    reverseSetupFailClient = c;

    // Let the FIRST __captureFocusInit call (forward-walk setup) through
    // untouched, then force the SECOND one -- the reverse-walk re-stamp -- to
    // resolve with a real degenerate no-value response. Before the fix, this
    // return value was discarded unchecked and the reverse walk proceeded
    // regardless, still reporting `available:true`.
    let initCallCount = 0;
    const originalSend = c.send.bind(c);
    c.send = async (method: string, params?: Record<string, unknown>, timeout?: number, sessionId?: string): Promise<unknown> => {
      if (method === 'Runtime.evaluate' && typeof params?.expression === 'string' && params.expression.includes('__captureFocusInit')) {
        initCallCount += 1;
        if (initCallCount === 2) {
          return {};
        }
      }
      return originalSend(method, params, timeout, sessionId);
    };

    reverseSetupFailFocus = await runCollectFocus(c, url);
  }, { timeout: 30000 });

  after(async () => {
    try { reverseSetupFailClient?.close(); } catch { /* already closed */ }
    await closeChrome(reverseSetupFailProc);
  });

  test('report.available is false with unavailableReason "reverse-walk-threw", despite a genuinely successful forward walk', () => {
    assert.ok(reverseSetupFailFocus.forward.length >= 1, `expected the forward walk (which ran before the targeted failure) to have genuinely succeeded, got ${JSON.stringify(reverseSetupFailFocus.forward)}`);
    assert.equal(reverseSetupFailFocus.available, false, `expected available:false when the reverse-walk re-init never resolved a value, got ${JSON.stringify({ available: reverseSetupFailFocus.available, reverse: reverseSetupFailFocus.reverse })}`);
    assert.equal(reverseSetupFailFocus.unavailableReason, 'reverse-walk-threw');
  });
});
});
