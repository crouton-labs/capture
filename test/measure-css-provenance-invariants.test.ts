/**
 * Adversarial invariant coverage for the CSS provenance substrate
 * (`style-provenance.ts`, `styles.ts`, `layers.ts`) — findings B1, B2, C1,
 * D1 from the collector-invariant audit matrix. Stub-based tests exercise
 * `buildWinningDeclarations`/`captureStyleSheetHeaders` directly against
 * fabricated CDP responses shaped exactly like real Chrome (verified
 * empirically against real headless Chrome while writing this file — see
 * inline notes); real-Chrome tests prove the honest-approximate flag and
 * `backendNodeId` identity against genuine CDP behavior, following the
 * harness pattern in `test/measure-focus-geometry-identity.test.ts` and
 * the real-Chrome section of `test/measure-layers-styles.test.ts`.
 */

import { test, describe, before, after } from 'node:test';
import { LIVE_CHROME, liveChromeOpts } from './fixtures/live-chrome.js';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { closeChrome, spawnHeadlessChrome } from './fixtures/chrome.js';

import { CDPClient } from '../src/cdp/client.js';
import { enableDomainsForSnap } from '../src/cdp/domains.js';
import type { SnapshotContext, SnapshotWriter } from '../src/cdp/measure/types.js';
import { collectStyles, type StylesReport } from '../src/cdp/measure/collectors/styles.js';
import { collectLayers, type LayersReport } from '../src/cdp/measure/collectors/layers.js';
import { collectGeometry, type GeometryElementRecord } from '../src/cdp/measure/collectors/geometry.js';
import { buildWinningDeclarations, captureStyleSheetHeaders } from '../src/cdp/measure/collectors/style-provenance.js';

interface GeometryJson {
  elements: GeometryElementRecord[];
}

function makeCtx(client: unknown): { ctx: SnapshotContext; written: Map<string, unknown> } {
  const written = new Map<string, unknown>();
  const writer: SnapshotWriter = {
    json(filename, value) {
      written.set(filename, value);
    },
    binary(filename, data) {
      written.set(filename, data);
    },
  };
  const ctx: SnapshotContext = {
    client: client as CDPClient,
    dir: '/tmp/measure-css-provenance-invariants-test',
    snapId: 'snap-test',
    url: 'http://example.test',
    viewport: '390x844',
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

// ============================================================================
// B1 — stub-level: winnerApproximate reflects the presence of an unresolved
// cascade construct in the matched-rule set for a property, without
// changing the reported winner itself (the simplified model's winner
// stays as-is; only the honesty flag is new).
// ============================================================================

test('buildWinningDeclarations: two same-specificity candidates, one nested in an @layer, flags winnerApproximate=true with reason cascade-layers-present', async () => {
  // Shape verified against real Chrome (`CSS.getMatchedStylesForNode` on an
  // `@layer`-nested rule reports `rule.layers: [{ text, range, styleSheetId }]`
  // and `ruleTypes: ['LayerRule']` on that rule only — non-layered rules have
  // `layers: []`).
  const matched = {
    matchedCSSRules: [
      {
        rule: {
          styleSheetId: 'ss1',
          selectorList: { selectors: [{ text: '.box' }], text: '.box' },
          origin: 'regular',
          style: { cssProperties: [{ name: 'color', value: 'red' }] },
          layers: [{ text: 'base' }],
        },
        matchingSelectors: [0],
      },
      {
        rule: {
          styleSheetId: 'ss1',
          selectorList: { selectors: [{ text: '.box' }], text: '.box' },
          origin: 'regular',
          style: { cssProperties: [{ name: 'color', value: 'blue' }] },
          layers: [{ text: 'override' }],
        },
        matchingSelectors: [0],
      },
    ],
  } as any;

  const decls = await buildWinningDeclarations(
    undefined as any,
    matched,
    { color: 'rgb(0, 0, 255)' },
    new Map(),
    new Map(),
    ['color'],
  );
  const color = decls.find((d) => d.property === 'color');
  assert.ok(color);
  // PRE-FIX PROOF: before this remediation, WinningDeclaration carried no
  // `winnerApproximate`/`winnerApproximateReason` field at all — this
  // assertion fails against the pre-fix shape (the field is simply absent),
  // which is exactly the over-claim B1 flags: a non-guaranteed winner
  // reported with no uncertainty marker.
  assert.equal(color!.winnerApproximate, true, 'a candidate set containing an @layer-nested rule must be flagged approximate, not claimed exact');
  assert.equal(color!.winnerApproximateReason, 'cascade-layers-present');
});

test('buildWinningDeclarations: an @scope-nested candidate flags winnerApproximate=true with reason cascade-scope-present', async () => {
  const matched = {
    matchedCSSRules: [
      {
        rule: {
          styleSheetId: 'ss1',
          selectorList: { selectors: [{ text: '.box' }], text: '.box' },
          origin: 'regular',
          style: { cssProperties: [{ name: 'color', value: 'green' }] },
          scopes: [{ text: '(.card)' }],
        },
        matchingSelectors: [0],
      },
    ],
  } as any;

  const decls = await buildWinningDeclarations(undefined as any, matched, { color: 'rgb(0, 128, 0)' }, new Map(), new Map(), ['color']);
  const color = decls.find((d) => d.property === 'color');
  assert.equal(color!.winnerApproximate, true);
  assert.equal(color!.winnerApproximateReason, 'cascade-scope-present');
});

test('buildWinningDeclarations: a revert-layer declared value flags winnerApproximate=true with reason revert-keyword-present', async () => {
  const matched = {
    matchedCSSRules: [
      {
        rule: {
          styleSheetId: 'ss1',
          selectorList: { selectors: [{ text: '.box' }], text: '.box' },
          origin: 'regular',
          style: { cssProperties: [{ name: 'color', value: 'revert-layer' }] },
        },
        matchingSelectors: [0],
      },
    ],
  } as any;

  const decls = await buildWinningDeclarations(undefined as any, matched, { color: 'rgb(0, 0, 0)' }, new Map(), new Map(), ['color']);
  const color = decls.find((d) => d.property === 'color');
  assert.equal(color!.winnerApproximate, true);
  assert.equal(color!.winnerApproximateReason, 'revert-keyword-present');
});

test('buildWinningDeclarations: a normal (no-layer, no-scope, no-revert) candidate set reports the winner as exact — winnerApproximate is absent', async () => {
  const matched = {
    matchedCSSRules: [
      {
        rule: {
          styleSheetId: 'ss1',
          selectorList: { selectors: [{ text: '.box' }], text: '.box' },
          origin: 'regular',
          style: { cssProperties: [{ name: 'color', value: 'red' }] },
        },
        matchingSelectors: [0],
      },
      {
        rule: {
          styleSheetId: 'ss1',
          selectorList: { selectors: [{ text: '#box' }], text: '#box' },
          origin: 'regular',
          style: { cssProperties: [{ name: 'color', value: 'blue' }] },
        },
        matchingSelectors: [0],
      },
    ],
  } as any;

  const decls = await buildWinningDeclarations(undefined as any, matched, { color: 'rgb(0, 0, 255)' }, new Map(), new Map(), ['color']);
  const color = decls.find((d) => d.property === 'color');
  assert.equal(color!.declaredValue, 'blue', 'the id selector (higher specificity) wins, unaffected by the honesty flag');
  assert.equal(color!.winnerApproximate, undefined, 'a fully-resolvable candidate set must not be flagged approximate');
  assert.equal(color!.winnerApproximateReason, undefined);
});

// ============================================================================
// Child 6 / finding #7 (style-provenance.ts:495-523) — stub-level: a REJECTED
// resolveAuthoredSourceLocation (a malformed source-map decode, as opposed to
// resolveAuthoredSourceLocation's own honest "no source map present" outcome)
// must not be silently indistinguishable from a genuine no-authored-source
// declaration. Uses a real malformed VLQ `mappings` string so the rejection
// is the module's real synchronous throw path (`decodeVLQSegment`), not a
// fabricated stub failure — see `test/source-map-provenance.test.ts` for the
// lower-level proof that this exact fixture throws inside
// `resolveAuthoredSourceLocation` itself.
// ============================================================================

test('buildWinningDeclarations: a matched declaration whose source-map decode throws is NOT emitted as a silent source-less winner — it carries sourceResolutionUnavailable + a preserved generated fallback', async () => {
  const malformedMap = { version: 3, sources: ['app.css'], mappings: '!!!!' };
  const mapDataURI = `data:application/json;base64,${Buffer.from(JSON.stringify(malformedMap), 'utf8').toString('base64')}`;
  const generatedText = `.box{color:red}\n/*# sourceMappingURL=${mapDataURI} */`;

  const client = {
    send: async (method: string) => {
      if (method === 'CSS.getStyleSheetText') return { text: generatedText };
      throw new Error(`unexpected CDP call in this test: ${method}`);
    },
  } as unknown as CDPClient;

  const matched = {
    matchedCSSRules: [
      {
        rule: {
          styleSheetId: 'ss-decode-throws',
          selectorList: { selectors: [{ text: '.box' }], text: '.box' },
          origin: 'regular',
          style: {
            cssProperties: [{ name: 'color', value: 'red', range: { startLine: 0, startColumn: 5, endLine: 0, endColumn: 15 } }],
          },
        },
        matchingSelectors: [0],
      },
    ],
  } as any;

  const decls = await buildWinningDeclarations(client, matched, { color: 'rgb(255, 0, 0)' }, new Map(), new Map(), ['color']);
  const color = decls.find((d) => d.property === 'color');
  assert.ok(color);

  // PRE-FIX PROOF: before this fix, a rejected `resolveAuthoredSourceLocation` was swallowed by
  // a bare `catch {}` that left `authored`/`generated`/`sourceResolutionUnavailable` all absent —
  // this declaration would have been indistinguishable from `.box`'s genuine "no author source
  // available (minified/prod)" case. This assertion fails against that pre-fix shape (the field
  // does not exist) and passes only once a real failure is marked.
  assert.equal(color!.sourceResolutionUnavailable, true, 'a rejected source-map decode must be marked unavailable, not silently omitted');
  assert.equal(typeof color!.sourceResolutionUnavailableReason, 'string');
  assert.ok(color!.sourceResolutionUnavailableReason!.length > 0);

  // The declaration itself (selector/specificity/declaredValue) is still the winning fact — a
  // failed SOURCE lookup must not blank out the winning declaration we already resolved.
  assert.equal(color!.declaredValue, 'red');
  assert.equal(color!.selector, '.box');

  // authored is honestly absent (resolution never completed enough to know an authored position
  // exists) — but the generated (pre-map) fallback fact, which was already known BEFORE the
  // failed map lookup, is preserved rather than discarded.
  assert.equal(color!.authored, undefined);
  assert.ok(color!.generated, 'the generated fallback fact must be preserved even when source-map resolution itself rejects');
  assert.equal(color!.generated!.line, 0);
  assert.equal(color!.generated!.column, 5);
});

test('buildWinningDeclarations: a declaration with no range at all (no source lookup attempted) is NOT flagged sourceResolutionUnavailable', async () => {
  const matched = {
    matchedCSSRules: [
      {
        rule: {
          styleSheetId: 'ss-no-range',
          selectorList: { selectors: [{ text: '.box' }], text: '.box' },
          origin: 'regular',
          style: { cssProperties: [{ name: 'color', value: 'red' }] }, // no range, no rule.style.range
        },
        matchingSelectors: [0],
      },
    ],
  } as any;

  const decls = await buildWinningDeclarations(undefined as any, matched, { color: 'rgb(255, 0, 0)' }, new Map(), new Map(), ['color']);
  const color = decls.find((d) => d.property === 'color');
  assert.ok(color);
  assert.equal(color!.sourceResolutionUnavailable, undefined, 'no range means no source lookup was attempted at all — this is a genuine absence, not a failed resolution');
  assert.equal(color!.authored, undefined);
  assert.equal(color!.generated, undefined);
});

// ============================================================================
// B2 — stub-level: captureStyleSheetHeaders emits an explicit
// available/reason fact instead of a silently empty map.
// ============================================================================

test('captureStyleSheetHeaders: a client with no event-delivery support (no `.on`) reports available=false with a reason', async () => {
  const client = { send: async () => ({}) } as unknown as CDPClient;
  const result = await captureStyleSheetHeaders(client);
  // PRE-FIX PROOF: the old return shape was `{ urls, stop }` only — this
  // assertion fails against that shape (the field does not exist), which is
  // exactly the silent-degradation B2 flags.
  assert.equal(result.available, false);
  assert.equal(result.reason, 'client-lacks-event-support');
  assert.deepEqual([...result.urls.entries()], []);
});

test('captureStyleSheetHeaders: a disable/enable cycle that throws reports available=false with a reason, not a silent empty map', async () => {
  class ThrowingClient extends EventEmitter {
    async send(method: string): Promise<unknown> {
      if (method === 'CSS.disable') throw new Error('boom');
      return {};
    }
  }
  const client = new ThrowingClient() as unknown as CDPClient;
  const result = await captureStyleSheetHeaders(client);
  assert.equal(result.available, false);
  assert.equal(result.reason, 'stylesheet-header-redelivery-failed');
});

test('collectStyles: propagates styleSheetHeaders.available=false to styles.json when header capture fails', async () => {
  class ThrowingStylesClient extends EventEmitter {
    async send(method: string): Promise<unknown> {
      if (method === 'CSS.disable') throw new Error('boom');
      if (method === 'Runtime.evaluate') return { result: { value: { elements: [], total: 0, iframesNotWalked: 0, shadowRootsNotWalked: 0 } } };
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      return {};
    }
  }
  const { ctx, written } = makeCtx(new ThrowingStylesClient());
  await collectStyles(ctx);
  const styles = written.get('styles.json') as StylesReport;
  assert.equal(styles.styleSheetHeaders.available, false, 'styles.json must surface the header-capture failure, not a silent empty source');
  assert.equal(typeof styles.styleSheetHeaders.reason, 'string');
});

test('collectLayers: propagates styleSheetHeaders.available=false to layers.json when header capture fails', async () => {
  class ThrowingLayersClient extends EventEmitter {
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      if (method === 'CSS.disable') throw new Error('boom');
      if (method === 'LayerTree.enable') {
        this.emit('LayerTree.layerTreeDidChange', { layers: [] });
        return {};
      }
      if (method === 'DOMSnapshot.captureSnapshot') return {};
      return {};
    }
  }
  const { ctx, written } = makeCtx(new ThrowingLayersClient());
  await collectLayers(ctx);
  const layers = written.get('layers.json') as LayersReport;
  assert.equal(layers.styleSheetHeaders.available, false, 'layers.json must surface the header-capture failure, not a silent empty source');
  assert.equal(typeof layers.styleSheetHeaders.reason, 'string');
});

// ============================================================================
// Real-Chrome harness — mirrors test/measure-focus-geometry-identity.test.ts
// and the real-Chrome section of test/measure-layers-styles.test.ts.
// ============================================================================


/** Creates a page target already navigating to `url` via `/json/new?<url>` (a PUT against the browser's own HTTP endpoint) — mirrors `newRealChromePageTarget` in test/measure-layers-styles.test.ts. */
async function newPageTarget(port: number, url: string): Promise<string> {
  const resp = await fetch(`http://localhost:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const json = (await resp.json()) as { webSocketDebuggerUrl?: string };
  if (!json.webSocketDebuggerUrl) throw new Error('no webSocketDebuggerUrl in /json/new response');
  return json.webSocketDebuggerUrl;
}

async function waitForReady(client: CDPClient, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await client.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete'`,
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (res.result?.value) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('fixture page did not reach readyState=complete in time');
}

function makeRealCtx(client: CDPClient, url: string): { ctx: SnapshotContext; written: Map<string, unknown> } {
  const written = new Map<string, unknown>();
  const writer: SnapshotWriter = {
    json(filename, value) {
      written.set(filename, value);
    },
    binary(filename, data) {
      written.set(filename, data);
    },
  };
  const ctx: SnapshotContext = {
    client,
    dir: '/tmp/measure-css-provenance-invariants-real-chrome-unused',
    snapId: 'real-chrome-test',
    url,
    viewport: '400x600',
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

let chromeProc: ChildProcess | undefined;
let chromePort: number;

describe('real Chrome integration', () => {
before(async () => {
  if (!LIVE_CHROME) return; // real-Chrome section below is gated with liveChromeOpts
  const { proc, port } = await spawnHeadlessChrome();
  chromeProc = proc;
  chromePort = port;
}, { timeout: 20000 });

after(async () => {
  try {
    await closeChrome(chromeProc);
  } catch {
    // already dead
  }
});

// ----------------------------------------------------------------------------
// B1 real-Chrome — cascade layers decide the winner by LAYER DECLARATION
// ORDER, which overrides specificity entirely: `@layer base, override;`
// makes `override` the higher-priority layer, so `.box`'s override-layer
// declaration (specificity 0-1-0) wins over `#box`'s base-layer declaration
// (specificity 1-0-0) even though `#box` has the objectively higher
// specificity. This engine's `pickWinner` picks by highest specificity
// FIRST (see style-provenance.ts) with no layer-priority concept at all, so
// it necessarily picks `#box`/red here — the wrong answer. Verified
// empirically against real headless Chrome while writing this test: the
// computed color is `rgb(0, 128, 0)` (green/override), not `rgb(255, 0, 0)`
// (red/base).
// ----------------------------------------------------------------------------

const LAYERS_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
<style>
@layer base, override;
@layer base { #box { color: red; } }
@layer override { .box { color: green; } }
</style>
<div id="box" class="box">hi</div>
</body></html>`;
const LAYERS_FIXTURE_URL = `data:text/html,${encodeURIComponent(LAYERS_FIXTURE_HTML)}`;

test('real-chrome (B1): a matched-rule set containing @layer-nested rules is flagged winnerApproximate, and the actual computed winner differs from the simplified model\'s reported winner', liveChromeOpts, async () => {
  const wsUrl = await newPageTarget(chromePort, LAYERS_FIXTURE_URL);
  const client = new CDPClient(wsUrl);
  await client.waitReady();
  try {
    await waitForReady(client);
    await enableDomainsForSnap(client);

    const computedColor = (await client.send('Runtime.evaluate', {
      expression: `getComputedStyle(document.getElementById('box')).color`,
      returnByValue: true,
    })) as { result?: { value?: string } };
    assert.equal(computedColor.result?.value, 'rgb(0, 128, 0)', 'real Chrome resolves the higher-priority @layer (override/green) despite its LOWER specificity, proving the fixture is a genuine adversarial case for a specificity-first engine');

    const docRes = (await client.send('DOM.getDocument', { depth: 0 })) as { root?: { nodeId?: number } };
    const queryRes = (await client.send('DOM.querySelector', { nodeId: docRes.root!.nodeId, selector: '#box' })) as { nodeId?: number };
    const boxNodeId = queryRes.nodeId;
    assert.ok(boxNodeId);

    const { urls: styleSheetUrls, stop } = await captureStyleSheetHeaders(client);
    try {
      const matched = await client.send('CSS.getMatchedStylesForNode', { nodeId: boxNodeId });
      const decls = await buildWinningDeclarations(client, matched as any, { color: 'rgb(0, 128, 0)' }, new Map(), styleSheetUrls, ['color']);
      const color = decls.find((d) => d.property === 'color');
      assert.ok(color);
      // PRE-FIX PROOF: before this remediation, WinningDeclaration carried no honesty flag at
      // all, so this specificity-first engine would have reported `#box`'s `red` as THE winning
      // declaration with no uncertainty marker — a wrong number stamped exact.
      assert.equal(color!.winnerApproximate, true, 'the candidate set contains @layer-nested rules — the winner must be flagged, never claimed exact');
      assert.equal(color!.winnerApproximateReason, 'cascade-layers-present');
      // Documents the simplified model's actual (mis-ordered) pick — the model still returns
      // SOME declaration, per B1's "keep the simplified winner, flag it" fix; it does not
      // silently become correct. This is the exact over-claim the flag exists to honestly mark.
      assert.equal(color!.declaredValue, 'red', "the specificity-first engine picks #box's higher-specificity declaration, which is NOT what real Chrome renders (layer priority overrides specificity) — exactly why winnerApproximate must be set");
    } finally {
      stop();
    }
  } finally {
    client.close();
  }
}, { timeout: 20000 });

const NO_LAYER_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
<style>
.box { color: blue; }
#box { color: red; }
</style>
<div id="box" class="box">hi</div>
</body></html>`;
const NO_LAYER_FIXTURE_URL = `data:text/html,${encodeURIComponent(NO_LAYER_FIXTURE_HTML)}`;

test('real-chrome (B1): a normal page with no @layer/@scope/revert reports the winner as exact (winnerApproximate absent)', liveChromeOpts, async () => {
  const wsUrl = await newPageTarget(chromePort, NO_LAYER_FIXTURE_URL);
  const client = new CDPClient(wsUrl);
  await client.waitReady();
  try {
    await waitForReady(client);
    await enableDomainsForSnap(client);

    const docRes = (await client.send('DOM.getDocument', { depth: 0 })) as { root?: { nodeId?: number } };
    const queryRes = (await client.send('DOM.querySelector', { nodeId: docRes.root!.nodeId, selector: '#box' })) as { nodeId?: number };
    const boxNodeId = queryRes.nodeId;
    assert.ok(boxNodeId);

    const { urls: styleSheetUrls, stop } = await captureStyleSheetHeaders(client);
    try {
      const matched = await client.send('CSS.getMatchedStylesForNode', { nodeId: boxNodeId });
      const decls = await buildWinningDeclarations(client, matched as any, { color: 'rgb(255, 0, 0)' }, new Map(), styleSheetUrls, ['color']);
      const color = decls.find((d) => d.property === 'color');
      assert.ok(color);
      assert.equal(color!.declaredValue, 'red', 'the id selector (higher specificity) correctly wins over the class selector');
      assert.equal(color!.winnerApproximate, undefined, 'a fully-resolvable candidate set must not be flagged approximate');
    } finally {
      stop();
    }
  } finally {
    client.close();
  }
}, { timeout: 20000 });

// ----------------------------------------------------------------------------
// C1 real-Chrome — the STYLES_MAX_ELEMENTS enumeration cap emits an
// honest total/kept/truncated fact instead of silently reporting only
// the capped elements with no signal that more existed.
// ----------------------------------------------------------------------------

const STYLES_CAP_ELEMENT_COUNT = 200; // exceeds styles.ts's STYLES_MAX_ELEMENTS (150)
const STYLES_CAP_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
${Array.from({ length: STYLES_CAP_ELEMENT_COUNT }, (_, i) => `<div class="item" style="width:4px;height:4px;">${i}</div>`).join('')}
</body></html>`;
const STYLES_CAP_FIXTURE_URL = `data:text/html,${encodeURIComponent(STYLES_CAP_FIXTURE_HTML)}`;

test('real-chrome (C1): styles.json reports total/kept/truncated when the page has more visible elements than STYLES_MAX_ELEMENTS', liveChromeOpts, async () => {
  const wsUrl = await newPageTarget(chromePort, STYLES_CAP_FIXTURE_URL);
  const client = new CDPClient(wsUrl);
  await client.waitReady();
  try {
    await waitForReady(client);
    const { ctx, written } = makeRealCtx(client, STYLES_CAP_FIXTURE_URL);
    await collectStyles(ctx);
    const styles = written.get('styles.json') as StylesReport;

    // PRE-FIX PROOF: before this remediation, `coverage` carried no
    // `totalCandidateElements`/`keptElements`/`elementsTruncated` fields —
    // this test's assertions on those fields fail against the pre-fix shape.
    assert.equal(styles.coverage.totalCandidateElements, STYLES_CAP_ELEMENT_COUNT, 'total must count every candidate element, not stop at the cap');
    assert.equal(styles.elements.length, 150, 'emitted elements are capped at STYLES_MAX_ELEMENTS');
    assert.equal(styles.coverage.keptElements, 150);
    assert.equal(styles.coverage.elementsTruncated, true, 'truncation must be an explicit boolean fact, not inferred from array length alone');
  } finally {
    client.close();
  }
}, { timeout: 20000 });

test('real-chrome (C1): a page with FEWER elements than the cap reports elementsTruncated=false', liveChromeOpts, async () => {
  const smallHtml = `<!DOCTYPE html><html><body style="margin:0;"><div id="one" style="width:10px;height:10px;"></div></body></html>`;
  const smallUrl = `data:text/html,${encodeURIComponent(smallHtml)}`;
  const wsUrl = await newPageTarget(chromePort, smallUrl);
  const client = new CDPClient(wsUrl);
  await client.waitReady();
  try {
    await waitForReady(client);
    const { ctx, written } = makeRealCtx(client, smallUrl);
    await collectStyles(ctx);
    const styles = written.get('styles.json') as StylesReport;
    assert.equal(styles.coverage.totalCandidateElements, 1);
    assert.equal(styles.coverage.keptElements, 1);
    assert.equal(styles.coverage.elementsTruncated, false);
  } finally {
    client.close();
  }
}, { timeout: 20000 });

// ----------------------------------------------------------------------------
// D1 real-Chrome — backendNodeId EQUALITY (not mere presence) between a
// styles.json element record and geometry.json for the same DOM node.
// ----------------------------------------------------------------------------

const IDENTITY_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;"><div id="box" style="width:50px;height:50px;background:red;">hi</div></body></html>`;
const IDENTITY_FIXTURE_URL = `data:text/html,${encodeURIComponent(IDENTITY_FIXTURE_HTML)}`;

test('real-chrome (D1): styles.json element backendNodeId EQUALS geometry.json backendNodeId for the same DOM node', liveChromeOpts, async () => {
  const wsUrl = await newPageTarget(chromePort, IDENTITY_FIXTURE_URL);
  const client = new CDPClient(wsUrl);
  await client.waitReady();
  try {
    await waitForReady(client);
    const { ctx, written } = makeRealCtx(client, IDENTITY_FIXTURE_URL);
    await collectStyles(ctx);
    await collectGeometry(ctx);

    const styles = written.get('styles.json') as StylesReport;
    const geometry = written.get('geometry.json') as GeometryJson;

    assert.equal(styles.elements.length, 1, 'the fixture has exactly one candidate element');
    assert.equal(geometry.elements.length, 1, 'geometry.json enumerates the same single element');
    assert.notEqual(styles.elements[0].backendNodeId, undefined, 'styles.json must carry a backendNodeId, not just a collector-local id');
    assert.notEqual(geometry.elements[0].backendNodeId, undefined);

    // Independently resolve #box's real CDP backendNodeId as ground truth, ruling out a
    // coincidental match between two independently-stubbed values (there is no stub here —
    // both come from live CDP — but this pins the expected value explicitly).
    const docRes = (await client.send('DOM.getDocument', { depth: 0 })) as { root?: { nodeId?: number } };
    const queryRes = (await client.send('DOM.querySelector', { nodeId: docRes.root!.nodeId, selector: '#box' })) as { nodeId?: number };
    const described = (await client.send('DOM.describeNode', { nodeId: queryRes.nodeId })) as { node?: { backendNodeId?: number } };
    const groundTruthBackendNodeId = described.node?.backendNodeId;
    assert.ok(groundTruthBackendNodeId);

    assert.equal(styles.elements[0].backendNodeId, groundTruthBackendNodeId);
    assert.equal(
      geometry.elements[0].backendNodeId,
      groundTruthBackendNodeId,
      `expected styles.json's backendNodeId (${styles.elements[0].backendNodeId}) to EQUAL geometry.json's (${geometry.elements[0].backendNodeId}) for the same DOM node`,
    );
    assert.equal(styles.elements[0].backendNodeId, geometry.elements[0].backendNodeId);
  } finally {
    client.close();
  }
}, { timeout: 20000 });

// ----------------------------------------------------------------------------
// D1 real-Chrome — layer owner + member backendNodeId EQUALITY with
// geometry.json. Real headless Chrome's compositor only commits a layer
// (and delivers `LayerTree.layerTreeDidChange`) on a domain's FIRST
// `LayerTree.enable`-after-a-frame-is-produced; this test forces that by
// spamming `Page.captureScreenshot` concurrently with `collectLayers`'s own
// listener-attach window (verified empirically while writing this test —
// without the concurrent screenshot spam, `layerTree.available` is
// consistently `false` in this sandbox, matching the documented empirical
// finding in `test/measure-layers-styles.test.ts`'s real-Chrome section).
// ----------------------------------------------------------------------------

const LAYER_IDENTITY_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
<div id="box" style="width:100px;height:100px;background:red;will-change:transform;transform:translateZ(0);position:absolute;top:20px;left:20px;"></div>
</body></html>`;
const LAYER_IDENTITY_FIXTURE_URL = `data:text/html,${encodeURIComponent(LAYER_IDENTITY_FIXTURE_HTML)}`;

test('real-chrome (D1): a layer\'s owning backendNodeId, and a member backendNodeId, EQUAL geometry.json\'s backendNodeId for the same node', liveChromeOpts, async () => {
  const wsUrl = await newPageTarget(chromePort, LAYER_IDENTITY_FIXTURE_URL);
  const client = new CDPClient(wsUrl);
  await client.waitReady();
  try {
    await waitForReady(client);
    await enableDomainsForSnap(client);

    const { ctx, written } = makeRealCtx(client, LAYER_IDENTITY_FIXTURE_URL);

    const layersPromise = collectLayers(ctx);
    const screenshotSpam = (async () => {
      for (let i = 0; i < 8; i++) {
        try {
          await client.send('Page.captureScreenshot', {});
        } catch {
          // best-effort — only needs to land once during the listener window
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    })();
    await layersPromise;
    await screenshotSpam;
    await collectGeometry(ctx);

    const layers = written.get('layers.json') as LayersReport;
    const geometry = written.get('geometry.json') as GeometryJson;

    assert.equal(layers.layerTree.available, true, 'expected a real compositor layer tree in this sandbox with forced frame production');

    const geoBox = geometry.elements.find((e) => e.selector === '#box');
    assert.ok(geoBox, 'expected a geometry.json record for #box');
    assert.notEqual(geoBox!.backendNodeId, undefined);

    const ownerLayer = layers.layers.find((l) => l.backendNodeId === geoBox!.backendNodeId);
    assert.ok(
      ownerLayer,
      `expected a layer OWNED by #box's backendNodeId (${geoBox!.backendNodeId}); layers seen: ${JSON.stringify(layers.layers.map((l) => ({ id: l.id, backendNodeId: l.backendNodeId })))}`,
    );
    assert.equal(ownerLayer!.backendNodeId, geoBox!.backendNodeId, "the layer's owning backendNodeId must EQUAL geometry.json's backendNodeId for the same DOM node");

    // A layer's owning node is also a member of its own layer (self-inclusion) — prove the
    // MEMBER list carries the same real identity too, not just the owner field.
    assert.ok(
      ownerLayer!.memberBackendNodeIds.includes(geoBox!.backendNodeId!),
      `expected #box's backendNodeId to appear in its owning layer's memberBackendNodeIds (${JSON.stringify(ownerLayer!.memberBackendNodeIds)})`,
    );
  } finally {
    client.close();
  }
}, { timeout: 20000 });
});
