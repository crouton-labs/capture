import { test, describe, before, after } from 'node:test';
import { LIVE_CHROME, liveChromeOpts } from './fixtures/live-chrome.js';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { closeChrome, spawnHeadlessChrome } from './fixtures/chrome.js';

import { CDPClient } from '../src/cdp/client.js';
import { enableDomainsForSnap } from '../src/cdp/domains.js';
import type { SnapshotContext, SnapshotWriter } from '../src/cdp/measure/types.js';
import { collectLayers } from '../src/cdp/measure/collectors/layers.js';
import { collectStyles } from '../src/cdp/measure/collectors/styles.js';

// ============================================================================
// Harness — a recording SnapshotWriter (no fs) + a stub CDPClient per test.
// EventEmitter-based stubs give the real `on`/`off`/`listenerCount` surface
// so listener-cleanup can be asserted directly.
// ============================================================================

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
    dir: '/tmp/measure-layers-styles-test',
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
// layers.ts — listener cleanup + explicit availability + DOMSnapshot paint order
// ============================================================================

const LAYER_TREE_EVENT = 'LayerTree.layerTreeDidChange';

/** A DOMSnapshot fixture whose paint order (ascending rank) is node ids [20, 30, 10]. */
const DOM_SNAPSHOT_CANNED = {
  documents: [
    {
      nodes: { backendNodeId: [10, 20, 30], parentIndex: [-1, 0, 0] },
      layout: { nodeIndex: [0, 1, 2], paintOrders: [2, 0, 1] },
    },
  ],
};

class LayersEventStubCdpClient extends EventEmitter {
  private readonly layers = [
    { layerId: 'L1', backendNodeId: 10, offsetX: 0, offsetY: 0, width: 390, height: 1840, paintCount: 5, drawsContent: true },
  ];

  constructor(private readonly opts: { emitEvent: boolean; domSnapshot: boolean } = { emitEvent: true, domSnapshot: true }) {
    super();
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    switch (method) {
      case 'LayerTree.enable':
        if (this.opts.emitEvent) this.emit(LAYER_TREE_EVENT, { layers: this.layers });
        return {};
      case 'LayerTree.compositingReasons':
        // A genuinely successful, reasonless response carries an explicit (empty) field — CDP
        // always returns at least one of `compositingReasons`/`compositingReasonIds`, even as `[]`;
        // a response with NEITHER field at all is the malformed shape (see the dedicated
        // `compositingReasonsMalformed` fixture), not this genuine-empty one.
        return { compositingReasonIds: [] };
      case 'DOMSnapshot.captureSnapshot':
        return this.opts.domSnapshot ? DOM_SNAPSHOT_CANNED : {};
      case 'DOM.describeNode':
        // Page-controlled selector evidence is retained exactly, subject only to string caps.
        return { node: { nodeName: 'DIV', attributes: ['id', 'sk-1234567890abcdefghij'] } };
      case 'DOM.pushNodesByBackendIdsToFrontend':
        return { nodeIds: [100] };
      case 'CSS.getMatchedStylesForNode':
        return {
          matchedCSSRules: [
            {
              rule: {
                selectorList: { selectors: [{ text: '.promo-sk-abcdefghijklmnop123456' }], text: '.promo-sk-abcdefghijklmnop123456' },
                origin: 'regular',
                style: { cssProperties: [{ name: 'transform', value: 'scale(1.05)' }] },
                // Page-controlled media evidence is retained exactly, subject only to string caps.
                media: [{ text: 'screen and (min-width: 1px) sk-mediaquerysecretabcdefghij' }],
              },
              matchingSelectors: [0],
            },
          ],
        };
      case 'CSS.getComputedStyleForNode':
        return { computedStyle: [{ name: 'transform', value: 'scale(1.05)' }] };
      default:
        return {};
    }
  }
}

test('collectLayers: success path removes the LayerTree listener and reports layerTree.available=true', async () => {
  const client = new LayersEventStubCdpClient({ emitEvent: true, domSnapshot: true });
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  assert.equal(client.listenerCount(LAYER_TREE_EVENT), 0, 'the one-shot LayerTree listener must be removed on the success path');

  const layers = written.get('layers.json') as any;
  assert.deepEqual(layers.layerTree, { available: true }, 'layerTree availability is serialized explicitly');
  assert.equal(layers.layers.length, 1);
  assert.equal(layers.layersTruncated, 0);
});

test('collectLayers: timeout path removes the LayerTree listener and reports layerTree.available=false with a reason', async () => {
  const client = new LayersEventStubCdpClient({ emitEvent: false, domSnapshot: true });
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  assert.equal(client.listenerCount(LAYER_TREE_EVENT), 0, 'the one-shot LayerTree listener must be removed on the timeout path');

  const layers = written.get('layers.json') as any;
  assert.equal(layers.layerTree.available, false, 'unavailability is an explicit fact, not a silent empty array');
  assert.equal(typeof layers.layerTree.reason, 'string');
  assert.ok(layers.layerTree.reason.length > 0);
  assert.deepEqual(layers.layers, [], 'no layers when the layer tree is unavailable');
});

// ============================================================================
// U29 defect 4 fix — the collector must FORCE frame production itself.
//
// On live Chrome 150 (verified empirically against the running validator
// runtime), a bare `LayerTree.enable` re-enable delivers `layerTreeDidChange`
// only ~1/5 of the time — the first-ever enable's delivery (in
// `enableDomainsForSnap`) is consumed before any listener attaches, and
// Chrome's compositor only (re)delivers the tree when a frame is actually
// PRODUCED. Forcing a frame via `Page.captureScreenshot` delivers it 5/5.
// This stub reproduces exactly that runtime behavior: `LayerTree.enable`
// emits NOTHING, and the layer tree is delivered ONLY once a
// `Page.captureScreenshot` frame is forced. Before the fix (no self-
// triggered screenshot) this run reported `available:false`; after it, the
// collector's own forced frame provokes delivery.
// ============================================================================

class ScreenshotGatedLayersStubCdpClient extends EventEmitter {
  screenshotCount = 0;
  private readonly layers = [
    { layerId: 'L1', backendNodeId: 10, offsetX: 0, offsetY: 0, width: 390, height: 1840, paintCount: 5, drawsContent: true },
  ];

  async send(method: string, _params: Record<string, unknown> = {}): Promise<unknown> {
    switch (method) {
      case 'LayerTree.enable':
        // A bare re-enable delivers nothing — exactly the live Chrome 150 gate.
        return {};
      case 'Page.captureScreenshot':
        // A forced frame is what makes the compositor (re)deliver the tree.
        this.screenshotCount += 1;
        this.emit(LAYER_TREE_EVENT, { layers: this.layers });
        return { data: '' };
      case 'LayerTree.compositingReasons':
        return { compositingReasonIds: [] };
      case 'DOMSnapshot.captureSnapshot':
        return DOM_SNAPSHOT_CANNED;
      case 'DOM.describeNode':
        return { node: { nodeName: 'DIV', attributes: [] } };
      case 'DOM.pushNodesByBackendIdsToFrontend':
        return { nodeIds: [100] };
      case 'CSS.getMatchedStylesForNode':
        return { matchedCSSRules: [] };
      case 'CSS.getComputedStyleForNode':
        return { computedStyle: [] };
      default:
        return {};
    }
  }
}

test('collectLayers: forces frame production (Page.captureScreenshot) itself, so a runtime that only delivers layerTreeDidChange on a produced frame (live Chrome 150) reports layerTree.available=true', async () => {
  const client = new ScreenshotGatedLayersStubCdpClient();
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  assert.ok(client.screenshotCount >= 1, 'the collector must force at least one frame via Page.captureScreenshot to provoke layerTreeDidChange delivery');
  assert.equal(client.listenerCount(LAYER_TREE_EVENT), 0, 'the one-shot LayerTree listener must be removed once the forced-frame event settles');

  const layers = written.get('layers.json') as any;
  assert.deepEqual(layers.layerTree, { available: true }, 'the collector-forced frame makes the layer tree available — not a bare re-enable that this runtime ignores');
  assert.equal(layers.layers.length, 1, 'the delivered layer is serialized');
  assert.equal(layers.layers[0].backendNodeId, 10);
});

test('collectLayers: paint order comes from DOMSnapshot (backendNodeIds sorted by paint rank) with an availability fact', async () => {
  const client = new LayersEventStubCdpClient({ emitEvent: true, domSnapshot: true });
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  assert.equal(layers.paintOrder.available, true);
  assert.deepEqual(layers.paintOrder.backendNodeIds, [20, 30, 10], 'ascending paint rank maps to backend node ids');
  assert.equal(layers.paintOrder.truncated, 0);
  // The secondary LayerTree-delivery-order proxy is retained separately.
  assert.deepEqual(layers.layerPaintOrder, ['L1']);
});

test('collectLayers: DOMSnapshot without paint order serializes paintOrder.available=false', async () => {
  const client = new LayersEventStubCdpClient({ emitEvent: true, domSnapshot: false });
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  assert.equal(layers.paintOrder.available, false);
  assert.equal(typeof layers.paintOrder.reason, 'string');
  assert.deepEqual(layers.paintOrder.backendNodeIds, []);
});

// ============================================================================
// layers.ts — per-node layer `membership`, derived from DOM ancestry over
// the same DOMSnapshot call backing `paintOrder`
// ============================================================================

/**
 * A tree of 4 nodes: html(1) > main.app(10) > .toast-container(20), and a
 * sibling header(30) also under html(1). Two layers: a root/document layer
 * with no owning node (`ROOT`), and `L-MAIN` owned by main.app(10). Expected
 * membership: `.toast-container`(20) has no layer of its own, so it inherits
 * its nearest layer-owning ancestor main.app's layer (`L-MAIN`); header(30)
 * has no layer-owning ancestor at all, so it falls back to the root layer
 * (`ROOT`), same as html(1) itself.
 */
const DOM_SNAPSHOT_MEMBERSHIP = {
  documents: [
    {
      nodes: { backendNodeId: [1, 10, 20, 30], parentIndex: [-1, 0, 1, 0] },
      layout: { nodeIndex: [0, 1, 2, 3], paintOrders: [0, 1, 2, 3] },
    },
  ],
};

class LayersMembershipStubCdpClient extends EventEmitter {
  private readonly layers = [
    { layerId: 'ROOT', offsetX: 0, offsetY: 0, width: 390, height: 1840, paintCount: 1, drawsContent: true },
    { layerId: 'L-MAIN', backendNodeId: 10, offsetX: 0, offsetY: 0, width: 390, height: 1840, paintCount: 3, drawsContent: true },
  ];

  constructor(private readonly opts: { domSnapshot: unknown } = { domSnapshot: DOM_SNAPSHOT_MEMBERSHIP }) {
    super();
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    switch (method) {
      case 'LayerTree.enable':
        this.emit(LAYER_TREE_EVENT, { layers: this.layers });
        return {};
      case 'LayerTree.compositingReasons':
        return {};
      case 'DOMSnapshot.captureSnapshot':
        return this.opts.domSnapshot as Record<string, unknown>;
      case 'DOM.describeNode':
        return { node: { nodeName: 'MAIN', attributes: ['class', 'app'] } };
      case 'DOM.pushNodesByBackendIdsToFrontend':
        return { nodeIds: [100] };
      case 'CSS.getMatchedStylesForNode':
        return { matchedCSSRules: [] };
      case 'CSS.getComputedStyleForNode':
        return { computedStyle: [] };
      default:
        return {};
    }
  }
}

test('collectLayers: per-node layer membership joins by backendNodeId — a layer-less descendant inherits its nearest layer-owning ancestor, a layer-less node with no such ancestor falls back to the root layer', async () => {
  const client = new LayersMembershipStubCdpClient();
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  assert.deepEqual(layers.membership, { available: true, unassignedCount: 0 }, 'membership is an explicit availability fact');

  const root = layers.layers.find((l: any) => l.id === 'ROOT');
  const main = layers.layers.find((l: any) => l.id === 'L-MAIN');
  assert.ok(root && main);

  // html(1) has no layer-owning ancestor at all → root/document layer.
  // header(30) sits outside main.app's subtree → also falls back to root.
  assert.equal(root.memberCount, 2, 'root layer owns 2 painted nodes (html + the sibling header outside main.app)');
  assert.deepEqual(root.memberBackendNodeIds, [1, 30]);
  assert.equal(root.membersTruncated, 0);

  // main.app(10) owns itself, plus .toast-container(20) which paints into
  // main.app's layer because it triggers no compositing of its own — this is
  // the design's ".toast-container paints into layer 2 (main.app)" fact.
  assert.equal(main.memberCount, 2, 'main.app layer owns 2 painted nodes (itself + .toast-container)');
  assert.deepEqual(main.memberBackendNodeIds, [10, 20]);
  assert.equal(main.membersTruncated, 0);
});

test('collectLayers: membership.available=false with a reason when the DOMSnapshot backing paintOrder lacks parentIndex, and every layer reports zero (uncomputed) members', async () => {
  const client = new LayersMembershipStubCdpClient({ domSnapshot: { documents: [{ nodes: { backendNodeId: [1, 10] }, layout: { nodeIndex: [0, 1], paintOrders: [0, 1] } }] } });
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  assert.equal(layers.membership.available, false);
  assert.equal(typeof layers.membership.reason, 'string');
  assert.ok(layers.membership.reason.length > 0);
  assert.equal(layers.paintOrder.available, false, 'membership and paintOrder share the same DOMSnapshot source, so both go unavailable together');
  for (const layer of layers.layers) {
    assert.equal(layer.memberCount, 0, 'no fabricated membership when the source data is unavailable');
    assert.deepEqual(layer.memberBackendNodeIds, []);
    assert.equal(layer.membersTruncated, 0);
  }
});

test('collectLayers: membership.available=false with a reason when the layer tree itself is unavailable (no layers to assign membership into)', async () => {
  const client = new LayersEventStubCdpClient({ emitEvent: false, domSnapshot: true });
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  assert.equal(layers.membership.available, false);
  assert.equal(typeof layers.membership.reason, 'string');
  assert.deepEqual(layers.layers, []);
});

test('collectLayers preserves exact page-controlled selector and style-provenance evidence', async () => {
  const client = new LayersEventStubCdpClient({ emitEvent: true, domSnapshot: true });
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const layer = layers.layers[0];

  assert.equal(layer.selector, 'div#sk-1234567890abcdefghij');
  assert.equal(layer.styleProvenance.selector, '.promo-sk-abcdefghijklmnop123456');
  assert.equal(layer.styleProvenance.property, 'transform');
  assert.equal(layer.styleProvenance.declaredValue, 'scale(1.05)', 'the winning declaration carries its declared value, not just property/selector');
  assert.equal(layer.styleProvenance.mediaQuery, 'screen and (min-width: 1px) sk-mediaquerysecretabcdefghij');
});

// ============================================================================
// layers.ts — per-layer honesty markers (I-5): a failed CDP read for one
// layer must not collapse to the same shape as a genuine observation.
// Each stub below fails exactly ONE of the per-layer reads (real call-site
// throws, not a simulated empty response) while a POSITIVE-CONTROL layer
// (`L-OK`, backendNodeId 20) goes through every read successfully, proving
// the genuine-observation path stays unmarked.
// ============================================================================

const DOM_SNAPSHOT_TWO_LAYERS = {
  documents: [
    {
      nodes: { backendNodeId: [10, 20], parentIndex: [-1, -1] },
      layout: { nodeIndex: [0, 1], paintOrders: [0, 1] },
    },
  ],
};

type LayersFailureMode =
  | 'compositingReasons'
  | 'compositingReasonsMalformed'
  | 'compositingReasonsMalformedNull'
  | 'styleProvenance'
  | 'matchedStylesThrow'
  | 'describeNode'
  | 'describeNodeMalformed'
  | 'computedStyleThrow'
  | 'computedStyleMalformed'
  | 'drawsContentMissing'
  | 'drawsContentNull'
  | 'paintCountMissing'
  | 'paintCountNull'
  | 'none';

class LayersFailureStubCdpClient extends EventEmitter {
  private readonly layers: Array<Record<string, unknown>>;

  constructor(private readonly failMode: LayersFailureMode) {
    super();
    // `L-FAIL`'s `drawsContent`/`paintCount` are omitted ENTIRELY (not set to `false`/`0`) for the
    // *Missing modes — the real adversarial shape (a `LayerTree.Layer` delivery that never carried
    // the field) — and set to the WRONG runtime type (`null`) for the *Null modes, a second,
    // distinct adversarial shape (a delivery that carries the field but not as a `boolean`/`number`).
    const failLayer: Record<string, unknown> = {
      layerId: 'L-FAIL',
      backendNodeId: 10,
      offsetX: 0,
      offsetY: 0,
      width: 100,
      height: 100,
      paintCount: 1,
      drawsContent: true,
    };
    if (failMode === 'drawsContentMissing') delete failLayer.drawsContent;
    if (failMode === 'paintCountMissing') delete failLayer.paintCount;
    if (failMode === 'drawsContentNull') failLayer.drawsContent = null;
    if (failMode === 'paintCountNull') failLayer.paintCount = null;
    this.layers = [
      failLayer,
      { layerId: 'L-OK', backendNodeId: 20, offsetX: 0, offsetY: 0, width: 100, height: 100, paintCount: 1, drawsContent: true },
    ];
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const layerId = (params as { layerId?: string }).layerId;
    const backendNodeId = (params as { backendNodeId?: number }).backendNodeId;
    switch (method) {
      case 'LayerTree.enable':
        this.emit(LAYER_TREE_EVENT, { layers: this.layers });
        return {};
      case 'LayerTree.compositingReasons':
        if (this.failMode === 'compositingReasons' && layerId === 'L-FAIL') throw new Error('simulated LayerTree.compositingReasons failure');
        // Malformed: neither `compositingReasons` nor `compositingReasonIds` present at all — the
        // real ambiguous shape this fix distinguishes from a genuinely reasonless layer.
        if (this.failMode === 'compositingReasonsMalformed' && layerId === 'L-FAIL') return {};
        // Malformed (second shape): BOTH fields present but neither is a real array — `null` and a
        // non-array value — just as much a read failure as the fields being absent outright.
        if (this.failMode === 'compositingReasonsMalformedNull' && layerId === 'L-FAIL') return { compositingReasons: null, compositingReasonIds: 'not-an-array' };
        return { compositingReasons: ['transform'] };
      case 'DOMSnapshot.captureSnapshot':
        return DOM_SNAPSHOT_TWO_LAYERS;
      case 'DOM.describeNode':
        if (this.failMode === 'describeNode' && backendNodeId === 10) throw new Error('simulated DOM.describeNode failure');
        // Malformed: `node` present but with no `nodeName` at all — CDP documents `nodeName` as a
        // required `DOM.Node` field, so this is a malformed delivery, never a genuine nameless node.
        if (this.failMode === 'describeNodeMalformed' && backendNodeId === 10) return { node: { attributes: ['class', 'box'] } };
        return { node: { nodeName: 'DIV', attributes: ['class', 'box'] } };
      case 'DOM.pushNodesByBackendIdsToFrontend': {
        const ids = (params as { backendNodeIds?: number[] }).backendNodeIds ?? [];
        if (this.failMode === 'styleProvenance' && ids[0] === 10) throw new Error('simulated DOM.pushNodesByBackendIdsToFrontend failure');
        return { nodeIds: [900 + (ids[0] ?? 0)] };
      }
      case 'CSS.getMatchedStylesForNode':
        if (this.failMode === 'matchedStylesThrow' && (params as { nodeId?: number }).nodeId === 910) throw new Error('simulated CSS.getMatchedStylesForNode failure');
        return {
          matchedCSSRules: [
            {
              rule: {
                selectorList: { selectors: [{ text: '.box' }], text: '.box' },
                origin: 'regular',
                style: { cssProperties: [{ name: 'transform', value: 'scale(1)' }] },
              },
              matchingSelectors: [0],
            },
          ],
        };
      case 'CSS.getComputedStyleForNode': {
        // nodeId 910 == backendNodeId 10 (L-FAIL), per the `900 + ids[0]` push-response formula above.
        const nodeId = (params as { nodeId?: number }).nodeId;
        if (this.failMode === 'computedStyleThrow' && nodeId === 910) throw new Error('simulated CSS.getComputedStyleForNode failure');
        // Malformed: no `computedStyle` array in the response at all.
        if (this.failMode === 'computedStyleMalformed' && nodeId === 910) return {};
        return { computedStyle: [{ name: 'transform', value: 'scale(1)' }] };
      }
      default:
        return {};
    }
  }
}

test('collectLayers: a failed LayerTree.compositingReasons read is marked compositingReasonsUnavailable, distinct from a genuinely reasonless layer', async () => {
  const client = new LayersFailureStubCdpClient('compositingReasons');
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const failed = layers.layers.find((l: any) => l.id === 'L-FAIL');
  const ok = layers.layers.find((l: any) => l.id === 'L-OK');
  assert.ok(failed && ok);

  assert.deepEqual(failed.compositingReasons, [], 'the failed read leaves compositingReasons empty');
  assert.equal(failed.compositingReasonsUnavailable, true, 'a failed read must be marked unavailable, not left indistinguishable from a genuinely reasonless layer');

  // Positive control: the genuine-observation path succeeds and reports real reasons with NO unavailable marker.
  assert.deepEqual(ok.compositingReasons, ['transform']);
  assert.equal(ok.compositingReasonsUnavailable, undefined, 'a successful read must not carry the unavailable marker');
});

test('collectLayers: a genuinely reasonless layer (successful read, empty response) reports compositingReasons=[] with NO unavailable marker', async () => {
  const client = new LayersFailureStubCdpClient('none');
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  for (const layer of layers.layers) {
    assert.equal(layer.compositingReasonsUnavailable, undefined, 'a successful (even empty-reasons) read must never carry the unavailable marker');
  }
});

test('collectLayers: a failed style-provenance resolution (DOM.pushNodesByBackendIdsToFrontend throws) is marked styleProvenanceUnavailable, distinct from a genuine no-declaration observation', async () => {
  const client = new LayersFailureStubCdpClient('styleProvenance');
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const failed = layers.layers.find((l: any) => l.id === 'L-FAIL');
  const ok = layers.layers.find((l: any) => l.id === 'L-OK');
  assert.ok(failed && ok);

  assert.equal(failed.styleProvenance, undefined, 'the failed resolution leaves styleProvenance omitted');
  assert.equal(failed.styleProvenanceUnavailable, true, 'a failed resolution must be marked unavailable, not indistinguishable from a genuine no-declaration observation');

  // Positive control: the genuine-observation path succeeds and reports a real winning declaration with NO unavailable marker.
  assert.ok(ok.styleProvenance, 'expected a resolved winning declaration for the healthy layer');
  assert.equal(ok.styleProvenance.property, 'transform');
  assert.equal(ok.styleProvenanceUnavailable, undefined, 'a successful resolution must not carry the unavailable marker');
});

test('collectLayers: a CSS.getMatchedStylesForNode throw during style-provenance resolution is marked styleProvenanceUnavailable, not a resolved no-declaration observation', async () => {
  const client = new LayersFailureStubCdpClient('matchedStylesThrow');
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const failed = layers.layers.find((l: any) => l.id === 'L-FAIL');
  const ok = layers.layers.find((l: any) => l.id === 'L-OK');
  assert.ok(failed && ok);

  assert.equal(failed.styleProvenance, undefined, 'the failed matched-styles read leaves styleProvenance omitted');
  assert.equal(failed.styleProvenanceUnavailable, true, 'a failed CSS.getMatchedStylesForNode read must be marked unavailable, not indistinguishable from a genuine no-declaration observation');

  // Positive control: the genuine-observation path succeeds and reports a real winning declaration with NO unavailable marker.
  assert.ok(ok.styleProvenance, 'expected a resolved winning declaration for the healthy layer');
  assert.equal(ok.styleProvenance.property, 'transform');
  assert.equal(ok.styleProvenanceUnavailable, undefined, 'a successful resolution must not carry the unavailable marker');
});

test('collectLayers: a genuine no-declaration observation (successful resolution, no winning candidate) reports styleProvenance omitted with NO unavailable marker', async () => {
  class NoDeclarationStubCdpClient extends EventEmitter {
    private readonly layers = [{ layerId: 'L1', backendNodeId: 10, offsetX: 0, offsetY: 0, width: 100, height: 100, paintCount: 1, drawsContent: true }];
    async send(method: string): Promise<unknown> {
      switch (method) {
        case 'LayerTree.enable':
          this.emit(LAYER_TREE_EVENT, { layers: this.layers });
          return {};
        case 'LayerTree.compositingReasons':
          return {};
        case 'DOMSnapshot.captureSnapshot':
          return { documents: [{ nodes: { backendNodeId: [10], parentIndex: [-1] }, layout: { nodeIndex: [0], paintOrders: [0] } }] };
        case 'DOM.describeNode':
          return { node: { nodeName: 'DIV', attributes: [] } };
        case 'DOM.pushNodesByBackendIdsToFrontend':
          return { nodeIds: [900] };
        case 'CSS.getMatchedStylesForNode':
          return { matchedCSSRules: [] }; // genuinely no matched rule for any layer-affecting property
        case 'CSS.getComputedStyleForNode':
          return { computedStyle: [] }; // genuinely successful read, no computed value for any tracked property
        default:
          return {};
      }
    }
  }
  const client = new NoDeclarationStubCdpClient();
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const layer = layers.layers[0];
  assert.equal(layer.styleProvenance, undefined, 'genuinely no winning declaration for any tracked property');
  assert.equal(layer.styleProvenanceUnavailable, undefined, 'a successful resolution that found no winner must NOT be marked unavailable — that would over-claim a read failure that never happened');
});

test('collectLayers: a LayerTree.layerTreeDidChange event delivered WITHOUT a layers field is reported unavailable, distinct from a genuine empty layer tree', async () => {
  class MissingLayersFieldStubCdpClient extends EventEmitter {
    async send(method: string): Promise<unknown> {
      switch (method) {
        case 'LayerTree.enable':
          // Real Chrome documents `layers` as an OPTIONAL event param, absent when the renderer
          // isn't in layer-tree/compositing mode — emit the event with NO `layers` key at all
          // (not merely `layers: []`), the real ambiguous shape this fix distinguishes.
          this.emit(LAYER_TREE_EVENT, {});
          return {};
        default:
          return {};
      }
    }
  }
  const client = new MissingLayersFieldStubCdpClient();
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  assert.equal(layers.layerTree.available, false, 'an event with no layers field must not be reported as a genuine empty layer tree');
  assert.equal(layers.layerTree.reason, 'layertree-event-missing-layers');
  assert.deepEqual(layers.layers, [], 'no fabricated layers when the event delivered no layers field');
});

test('collectLayers: a LayerTree.layerTreeDidChange event delivered WITH a literal empty layers array is a genuine empty layer tree, available=true', async () => {
  class EmptyLayersArrayStubCdpClient extends EventEmitter {
    async send(method: string): Promise<unknown> {
      switch (method) {
        case 'LayerTree.enable':
          this.emit(LAYER_TREE_EVENT, { layers: [] });
          return {};
        default:
          return {};
      }
    }
  }
  const client = new EmptyLayersArrayStubCdpClient();
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  assert.equal(layers.layerTree.available, true, 'a literal empty layers array is a genuine observation, not an unavailable fact');
  assert.equal(layers.layerTree.reason, undefined);
  assert.deepEqual(layers.layers, []);
});

test('collectLayers: a genuinely SUCCESSFUL empty LayerTree.compositingReasons response ({ compositingReasonIds: [] }) reports compositingReasons=[] with NO unavailable marker', async () => {
  // LayersEventStubCdpClient's LayerTree.compositingReasons returns a genuinely successful,
  // explicitly-empty `{ compositingReasonIds: [] }` — the true positive control for a real
  // empty-but-successful read, distinct from the earlier 'none'-failMode test whose stub returned
  // a non-empty ['transform'] (only proving a non-empty success stays unmarked), and distinct from
  // the malformed `{}` shape (neither field present at all) the `compositingReasonsMalformed`
  // fixture covers.
  const client = new LayersEventStubCdpClient({ emitEvent: true, domSnapshot: true });
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const layer = layers.layers[0];
  assert.deepEqual(layer.compositingReasons, [], 'a genuinely successful empty response reports an empty array');
  assert.equal(layer.compositingReasonsUnavailable, undefined, 'a genuinely successful empty read must NOT carry the unavailable marker');
});

test('collectLayers: a failed DOM.describeNode read is marked selectorUnavailable, distinct from a genuinely nameless described node', async () => {
  const client = new LayersFailureStubCdpClient('describeNode');
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const failed = layers.layers.find((l: any) => l.id === 'L-FAIL');
  const ok = layers.layers.find((l: any) => l.id === 'L-OK');
  assert.ok(failed && ok);

  assert.equal(failed.selector, null, 'the failed read leaves selector null');
  assert.equal(failed.selectorUnavailable, true, 'a failed DOM.describeNode read must be marked unavailable');

  // Positive control.
  assert.equal(ok.selector, 'div.box');
  assert.equal(ok.selectorUnavailable, undefined, 'a successful describeNode read must not carry the unavailable marker');
});

test('collectLayers: a DOM.describeNode response with no node/nodeName at all (malformed, no throw) is marked selectorUnavailable, distinct from a genuinely nameless described node', async () => {
  const client = new LayersFailureStubCdpClient('describeNodeMalformed');
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const failed = layers.layers.find((l: any) => l.id === 'L-FAIL');
  const ok = layers.layers.find((l: any) => l.id === 'L-OK');
  assert.ok(failed && ok);

  assert.equal(failed.selector, null, 'the malformed read leaves selector null');
  assert.equal(failed.selectorUnavailable, true, 'a describeNode response with no node/nodeName must be marked unavailable, not indistinguishable from a genuinely nameless described node (impossible under the CDP contract, but the collector must not coerce it either way)');

  // Positive control: the genuine-observation path succeeds and reports a real selector with NO unavailable marker.
  assert.equal(ok.selector, 'div.box');
  assert.equal(ok.selectorUnavailable, undefined, 'a successful describeNode read must not carry the unavailable marker');
});

test('collectLayers: a LayerTree.compositingReasons response with NEITHER compositingReasons NOR compositingReasonIds (malformed, no throw) is marked compositingReasonsUnavailable, distinct from a genuinely reasonless layer', async () => {
  const client = new LayersFailureStubCdpClient('compositingReasonsMalformed');
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const failed = layers.layers.find((l: any) => l.id === 'L-FAIL');
  const ok = layers.layers.find((l: any) => l.id === 'L-OK');
  assert.ok(failed && ok);

  assert.deepEqual(failed.compositingReasons, [], 'the malformed read leaves compositingReasons empty');
  assert.equal(
    failed.compositingReasonsUnavailable,
    true,
    'a response with neither field at all must be marked unavailable, not indistinguishable from a genuinely reasonless layer',
  );

  // Positive control: the genuine-observation path succeeds and reports real reasons with NO unavailable marker.
  assert.deepEqual(ok.compositingReasons, ['transform']);
  assert.equal(ok.compositingReasonsUnavailable, undefined, 'a successful read must not carry the unavailable marker');
});

test('collectLayers: a CSS.getComputedStyleForNode THROW during style-provenance resolution is marked styleProvenanceUnavailable, not a resolved no-declaration observation', async () => {
  const client = new LayersFailureStubCdpClient('computedStyleThrow');
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const failed = layers.layers.find((l: any) => l.id === 'L-FAIL');
  const ok = layers.layers.find((l: any) => l.id === 'L-OK');
  assert.ok(failed && ok);

  assert.equal(failed.styleProvenance, undefined, 'the failed computed-style read leaves styleProvenance omitted');
  assert.equal(
    failed.styleProvenanceUnavailable,
    true,
    'a thrown CSS.getComputedStyleForNode read must not read as "resolved, no author declaration" — a real winning declaration exists in matched styles for this node, but the computed-style leg of the resolution failed',
  );

  // Positive control: the genuine-observation path succeeds (both matched AND computed styles resolve) and reports a real winning declaration with NO unavailable marker.
  assert.ok(ok.styleProvenance, 'expected a resolved winning declaration for the healthy layer');
  assert.equal(ok.styleProvenance.property, 'transform');
  assert.equal(ok.styleProvenanceUnavailable, undefined, 'a successful resolution must not carry the unavailable marker');
});

test('collectLayers: a CSS.getComputedStyleForNode response with no computedStyle array at all (malformed, no throw) is marked styleProvenanceUnavailable, not a resolved no-declaration observation', async () => {
  const client = new LayersFailureStubCdpClient('computedStyleMalformed');
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const failed = layers.layers.find((l: any) => l.id === 'L-FAIL');
  const ok = layers.layers.find((l: any) => l.id === 'L-OK');
  assert.ok(failed && ok);

  assert.equal(failed.styleProvenance, undefined, 'the malformed computed-style read leaves styleProvenance omitted');
  assert.equal(
    failed.styleProvenanceUnavailable,
    true,
    'a computed-style response with no computedStyle array at all must not read as "resolved, no author declaration" — the real winning declaration in matched styles is masked by the malformed computed-value leg',
  );

  // Positive control.
  assert.ok(ok.styleProvenance, 'expected a resolved winning declaration for the healthy layer');
  assert.equal(ok.styleProvenance.property, 'transform');
  assert.equal(ok.styleProvenanceUnavailable, undefined, 'a successful resolution must not carry the unavailable marker');
});

test('collectLayers: a LayerTree.Layer delivery that omits the required drawsContent field is marked drawsContentUnavailable, not a genuine false observation', async () => {
  const client = new LayersFailureStubCdpClient('drawsContentMissing');
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const failed = layers.layers.find((l: any) => l.id === 'L-FAIL');
  const ok = layers.layers.find((l: any) => l.id === 'L-OK');
  assert.ok(failed && ok);

  assert.equal(failed.drawsContent, false, 'the missing field defaults to false for backward-compatible shape');
  assert.equal(failed.drawsContentUnavailable, true, 'an omitted required drawsContent field must be marked unavailable, not indistinguishable from a layer that genuinely draws no content');

  // Positive control: the field was genuinely present (true) and must not carry the unavailable marker.
  assert.equal(ok.drawsContent, true);
  assert.equal(ok.drawsContentUnavailable, undefined, 'a genuinely present drawsContent field must not carry the unavailable marker');
});

test('collectLayers: a LayerTree.Layer delivery that omits the required paintCount field is marked paintCountUnavailable, not a genuine zero observation', async () => {
  const client = new LayersFailureStubCdpClient('paintCountMissing');
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const failed = layers.layers.find((l: any) => l.id === 'L-FAIL');
  const ok = layers.layers.find((l: any) => l.id === 'L-OK');
  assert.ok(failed && ok);

  assert.equal(failed.paintCount, 0, 'the missing field defaults to 0 for backward-compatible shape');
  assert.equal(failed.paintCountUnavailable, true, 'an omitted required paintCount field must be marked unavailable, not indistinguishable from a layer that genuinely has zero paints');

  // Positive control: the field was genuinely present (1) and must not carry the unavailable marker.
  assert.equal(ok.paintCount, 1);
  assert.equal(ok.paintCountUnavailable, undefined, 'a genuinely present paintCount field must not carry the unavailable marker');
});

test('collectLayers: a LayerTree.compositingReasons response where BOTH fields are present but neither is a real array (null / non-array) is marked compositingReasonsUnavailable, not a genuine empty observation', async () => {
  const client = new LayersFailureStubCdpClient('compositingReasonsMalformedNull');
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const failed = layers.layers.find((l: any) => l.id === 'L-FAIL');
  const ok = layers.layers.find((l: any) => l.id === 'L-OK');
  assert.ok(failed && ok);

  assert.deepEqual(failed.compositingReasons, [], 'the malformed (non-array) read leaves compositingReasons empty');
  assert.equal(
    failed.compositingReasonsUnavailable,
    true,
    'a `null`/non-array field is just as malformed as an absent one — must not silently coerce into the genuinely-reasonless [] shape',
  );

  // Positive control.
  assert.deepEqual(ok.compositingReasons, ['transform']);
  assert.equal(ok.compositingReasonsUnavailable, undefined);
});

test('collectLayers: a LayerTree.Layer delivery whose drawsContent field is present but the wrong type (null, not a boolean) is marked drawsContentUnavailable, not a genuine false observation', async () => {
  const client = new LayersFailureStubCdpClient('drawsContentNull');
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const failed = layers.layers.find((l: any) => l.id === 'L-FAIL');
  const ok = layers.layers.find((l: any) => l.id === 'L-OK');
  assert.ok(failed && ok);

  assert.equal(failed.drawsContent, false, 'the mistyped field defaults to false for backward-compatible shape');
  assert.equal(
    failed.drawsContentUnavailable,
    true,
    'a `drawsContent:null` delivery is a malformed (wrong-type) read, not a genuine false observation — must not coerce into the same shape as a layer that genuinely draws no content',
  );

  assert.equal(ok.drawsContent, true);
  assert.equal(ok.drawsContentUnavailable, undefined);
});

test('collectLayers: a LayerTree.Layer delivery whose paintCount field is present but the wrong type (null, not a number) is marked paintCountUnavailable, not a genuine zero observation', async () => {
  const client = new LayersFailureStubCdpClient('paintCountNull');
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const failed = layers.layers.find((l: any) => l.id === 'L-FAIL');
  const ok = layers.layers.find((l: any) => l.id === 'L-OK');
  assert.ok(failed && ok);

  assert.equal(failed.paintCount, 0, 'the mistyped field defaults to 0 for backward-compatible shape');
  assert.equal(
    failed.paintCountUnavailable,
    true,
    'a `paintCount:null` delivery is a malformed (wrong-type) read, not a genuine zero observation — must not coerce into the same shape as a layer that genuinely has zero paints',
  );

  assert.equal(ok.paintCount, 1);
  assert.equal(ok.paintCountUnavailable, undefined);
});

test('collectLayers: a layer whose drawsContent/paintCount are GENUINELY false/0 (real values, not absent or mistyped) reports them honestly with NO unavailable marker', async () => {
  class GenuineFalseZeroStubCdpClient extends EventEmitter {
    private readonly layers = [
      { layerId: 'L-QUIET', offsetX: 0, offsetY: 0, width: 100, height: 100, paintCount: 0, drawsContent: false },
    ];
    async send(method: string): Promise<unknown> {
      switch (method) {
        case 'LayerTree.enable':
          this.emit(LAYER_TREE_EVENT, { layers: this.layers });
          return {};
        case 'LayerTree.compositingReasons':
          return { compositingReasons: [] };
        case 'DOMSnapshot.captureSnapshot':
          return { documents: [{ nodes: { backendNodeId: [], parentIndex: [] }, layout: { nodeIndex: [], paintOrders: [] } }] };
        default:
          return {};
      }
    }
  }
  const client = new GenuineFalseZeroStubCdpClient();
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  const layer = layers.layers.find((l: any) => l.id === 'L-QUIET');
  assert.ok(layer);

  assert.equal(layer.drawsContent, false, 'a layer that genuinely draws no content reports drawsContent:false');
  assert.equal(layer.drawsContentUnavailable, undefined, 'a genuinely-present false value must NOT carry the unavailable marker — that would over-claim a read failure that never happened');
  assert.equal(layer.paintCount, 0, 'a layer that genuinely has zero paints reports paintCount:0');
  assert.equal(layer.paintCountUnavailable, undefined, 'a genuinely-present zero value must NOT carry the unavailable marker');
});

// ============================================================================
// styles.ts — generated source fallback preserved for BOTH authored and
// generated results, and real stylesheet URLs passed from CSS.styleSheetAdded
// ============================================================================

const STYLES_FACTS_CANNED = [{ cssPath: 'div:nth-of-type(1)', computed: { 'padding-top': '12px' } }];

const STYLES_MATCHED_CANNED = {
  matchedCSSRules: [
    {
      rule: {
        styleSheetId: 'ss1',
        selectorList: { selectors: [{ text: '.card' }], text: '.card' },
        origin: 'regular',
        style: {
          cssProperties: [
            { name: 'padding-top', value: '12px', range: { startLine: 0, startColumn: 5, endLine: 0, endColumn: 20 } },
          ],
        },
      },
      matchingSelectors: [0],
    },
  ],
};

const STYLE_SHEET_URL = 'https://example.test/app.css';

// A source map resolving generated (0,5) -> app.jsx:1:10 (same fixture as source-map-provenance).
const SOURCE_MAP_FIXTURE = {
  version: 3,
  sources: ['app.jsx'],
  sourcesContent: ['export const original = "authored source";'],
  names: [],
  mappings: 'AAAA,KAAU;EACP',
};
const SOURCE_MAP_DATA_URI = `data:application/json;base64,${Buffer.from(JSON.stringify(SOURCE_MAP_FIXTURE), 'utf8').toString('base64')}`;

class StylesStubCdpClient extends EventEmitter {
  constructor(
    private readonly generatedText: string,
    private readonly styleSheetUrl: string = STYLE_SHEET_URL,
  ) {
    super();
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      // The style-sheet-url tracker registers its listener before this first send — fire the header now.
      this.emit('CSS.styleSheetAdded', { header: { styleSheetId: 'ss1', sourceURL: this.styleSheetUrl } });
      if (expression.includes('__captureStylesInventory')) {
        // The in-page inventory now returns { elements, iframesNotWalked, shadowRootsNotWalked }.
        return { result: { value: { elements: STYLES_FACTS_CANNED, iframesNotWalked: 2, shadowRootsNotWalked: 1 } } };
      }
      return { result: {} };
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelector') return { nodeId: 42 };
    if (method === 'DOM.describeNode') return { node: { backendNodeId: 999 } };
    if (method === 'CSS.getMatchedStylesForNode') return STYLES_MATCHED_CANNED;
    if (method === 'CSS.getStyleSheetText') return { text: this.generatedText };
    return {};
  }
}

test('collectStyles: generated fallback is preserved when no source map resolves (generated present, authored absent)', async () => {
  // Generated CSS with NO sourceMappingURL — resolveAuthoredSourceLocation returns a generated location.
  const client = new StylesStubCdpClient('.card{padding-top:12px}');
  const { ctx, written } = makeCtx(client);

  await collectStyles(ctx);

  const styles = written.get('styles.json') as any;
  const paddingTop = styles.elements[0].winningDeclarations.find((d: any) => d.property === 'padding-top');
  assert.ok(paddingTop, 'expected a padding-top winning declaration');
  assert.equal(paddingTop.authored, undefined, 'no source map resolved — authored must be absent');
  assert.ok(paddingTop.generated, 'generated fallback location must be preserved, not discarded');
  assert.equal(paddingTop.generated.sourceURL, STYLE_SHEET_URL, 'the real stylesheet URL feeds the generated location');
  assert.equal(paddingTop.generated.line, 0);
  assert.equal(paddingTop.generated.column, 5);
  assert.equal(paddingTop.sourceStyleSheetUrl, STYLE_SHEET_URL, 'the real stylesheet URL is passed, not only the opaque id');
});

test('collectStyles: styles.json emits an explicit top-document / light-DOM-only scope fact', async () => {
  const client = new StylesStubCdpClient('.card{padding-top:12px}');
  const { ctx, written } = makeCtx(client);

  await collectStyles(ctx);

  const styles = written.get('styles.json') as any;
  assert.ok(styles.coverage, 'styles.json must carry a coverage scope fact');
  assert.equal(styles.coverage.scope, 'top-document', 'enumeration is top-document only');
  assert.equal(styles.coverage.iframesNotWalked, 2, 'reports iframe count the light-DOM enumeration did not pierce');
  assert.equal(styles.coverage.shadowRootsNotWalked, 1, 'reports shadow-root count the light-DOM enumeration did not pierce');
});

test('collectStyles preserves an exact page-controlled stylesheet sourceURL in emitted provenance', async () => {
  const token = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV';
  const sourceUrl = `https://example.test/app.css?token=${token}`;
  const client = new StylesStubCdpClient('.card{padding-top:12px}', sourceUrl);
  const { ctx, written } = makeCtx(client);

  await collectStyles(ctx);

  const styles = written.get('styles.json') as any;
  const paddingTop = styles.elements[0].winningDeclarations.find((d: any) => d.property === 'padding-top');
  assert.ok(paddingTop, 'expected a padding-top winning declaration');
  assert.equal(paddingTop.sourceStyleSheetUrl, sourceUrl);
  assert.equal(paddingTop.generated?.sourceURL, sourceUrl);
});

test('collectStyles: authored result also carries the generated (pre-map) location', async () => {
  const client = new StylesStubCdpClient(`.card{padding-top:12px}\n/*# sourceMappingURL=${SOURCE_MAP_DATA_URI} */`);
  const { ctx, written } = makeCtx(client);

  await collectStyles(ctx);

  const styles = written.get('styles.json') as any;
  const paddingTop = styles.elements[0].winningDeclarations.find((d: any) => d.property === 'padding-top');
  assert.deepEqual(paddingTop.authored, { file: 'app.jsx', line: 1, column: 10 }, 'source map still resolves the authored location');
  assert.ok(paddingTop.generated, 'generated location is set for authored results too');
  assert.equal(paddingTop.generated.sourceURL, STYLE_SHEET_URL);
  assert.equal(paddingTop.generated.line, 0);
  assert.equal(paddingTop.generated.column, 5);
});

// ============================================================================
// REAL-Chrome validation — a stub can only assert what it was told to return,
// not whether a CDP method genuinely exists or whether a bare re-`CSS.enable`
// is a documented no-op; these tests spawn real headless Chrome after
// `enableDomainsForSnap`, so they exercise the genuine CDP protocol surface,
// not a fiction. Test B drives the real `collectStyles` path end-to-end.
// Test A drives the real `collectLayers()` path end-to-end too, via
// `LayerTreeSynthesizingClient` — a thin real-client wrapper that synthesizes
// only the one `LayerTree.layerTreeDidChange` event headless Chrome's
// compositor gate rarely yields in this sandbox, seeded from a genuinely
// CDP-resolved `backendNodeId`; every other CDP call reaches real Chrome
// unmodified — see the detailed comment on Test A below.
// ============================================================================


/**
 * Creates a page target ALREADY NAVIGATING to `url` via `/json/new?<url>`
 * (a PUT against the browser's own HTTP endpoint) — the target starts
 * loading before our WebSocket even attaches, which is exactly the
 * precondition Test B needs: the fixture's `<style>` must be parsed before
 * any CDP domain (in particular CSS) is ever enabled by this test.
 */
async function newRealChromePageTarget(port: number, url: string): Promise<string> {
  const resp = await fetch(`http://localhost:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const json = (await resp.json()) as { webSocketDebuggerUrl?: string };
  if (!json.webSocketDebuggerUrl) throw new Error('no webSocketDebuggerUrl in /json/new response');
  return json.webSocketDebuggerUrl;
}

/** Polls `document.readyState` + a marker element via `Runtime.evaluate` — deliberately called with NO domain enabled yet, since `Runtime.evaluate` needs no `.enable` call. */
async function waitForRealChromeFixtureReady(c: CDPClient, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await c.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && document.getElementById('marker') !== null`,
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (res.result?.value) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('real-Chrome fixture did not reach readyState=complete in time');
}

function makeRealChromeCtx(client: CDPClient, url: string): { ctx: SnapshotContext; written: Map<string, unknown> } {
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
    dir: '/tmp/measure-layers-styles-real-chrome-unused',
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

let realChrome: ChildProcess | undefined;
let realChromePort: number;

describe('real Chrome integration', () => {
before(async () => {
  if (!LIVE_CHROME) return; // real-chrome tests A/B below are gated with liveChromeOpts
  const { proc, port } = await spawnHeadlessChrome();
  realChrome = proc;
  realChromePort = port;
}, { timeout: 20000 });

after(async () => {
  try {
    await closeChrome(realChrome);
  } catch {
    // already dead
  }
});

// ----------------------------------------------------------------------------
// Test A — layers winning-declaration + generated-source provenance, driven
// through the real, exported `collectLayers()` end-to-end. Two rules of
// DIFFERENT specificity both declare `transform` on the same element: `#box`
// (id selector, specificity 1-0-0) declares `scale(3)`, `.box` (class
// selector, specificity 0-1-0) declares `scale(1)` and is listed LAST in the
// stylesheet. The real winning-declaration engine must report `#box`'s
// `scale(3)` regardless of source order, because `#box` has the higher
// specificity — a naive "first/last matching rule" scan would not guarantee
// that.
//
// EMPIRICAL FINDING (this environment): real headless Chrome 150.0.7871.100
// here never enters LayerTree "compositing mode" — `LayerTree.enable`
// never redelivers a `layerTreeDidChange` event, confirmed across
// `--headless=new` and legacy `--headless`, with/without `--disable-gpu`,
// and after forcing frame production via `Page.captureScreenshot` and
// `Page.startScreencast` (all 0 events; the protocol's own doc for this
// event says "layers, absent if not in the compositing mode", i.e. this is
// a real, sandbox-dependent CDP fact, not a bug in this collector).
// `collectLayers()`'s `layerTree.available:false` degradation path (see
// layers.ts's module doc) is exactly what handles this honestly on a bare
// real client — but it also means a bare real client can never drive
// `collectLayers()`'s `resolveStyleProvenance` call (reached only when a
// `LayerRecord` has a `backendNodeId`) end-to-end in this sandbox.
//
// `LayerTreeSynthesizingClient` below closes that one gap without touching
// `layers.ts` (out of scope; not exported from it): it wraps the real,
// connected `CDPClient` and forwards every call to it UNCHANGED, except it
// intercepts the ONE fact this sandbox can't produce — it stores the
// collector's `LayerTree.layerTreeDidChange` listener instead of forwarding
// the `.on` registration, and the instant `LayerTree.enable` resolves
// against the real client, it synchronously invokes the stored handler with
// one synthesized layer, seeded from a REAL, `DOM.querySelector` +
// `DOM.describeNode`-resolved `backendNodeId` for `#box`. Every other CDP
// call `collectLayers()` makes (`DOMSnapshot.captureSnapshot`,
// `DOM.describeNode`, `DOM.pushNodesByBackendIdsToFrontend`,
// `CSS.getMatchedStylesForNode`, `CSS.getComputedStyleForNode`,
// `LayerTree.compositingReasons`, `CSS.styleSheetAdded` delivery) goes
// straight through to real Chrome untouched — so this drives the ACTUAL
// production `collectLayers()` → `resolveStyleProvenance()` →
// `buildWinningDeclarations()` path end-to-end, with only the LayerTree
// event itself synthesized. (`LayerTree.compositingReasons` on the fake
// `layerId` 404s/throws against real Chrome — already caught by
// `collectLayers`'s own `.catch(() => ({}))`, harmless.)
// ----------------------------------------------------------------------------

const LAYERS_A_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;background:#fff;">
<style>
#box { transform: scale(3); }
.box { transform: scale(1); }
</style>
<div id="box" class="box" style="width:50px;height:50px;background:red;"></div>
<div id="marker"></div>
</body></html>`;
const LAYERS_A_FIXTURE_URL = `data:text/html,${encodeURIComponent(LAYERS_A_FIXTURE_HTML)}`;

/**
 * Wraps a real, connected `CDPClient` and forwards every call to it
 * unchanged, except it intercepts `LayerTree.layerTreeDidChange`
 * registration (stored locally, never forwarded to the real client) and
 * synthesizes exactly one delivery of that event — seeded from
 * `syntheticBackendNodeId` — the instant `LayerTree.enable` resolves
 * against the real client. See the comment above Test A for why this one
 * substitution is necessary and why it is the only one.
 */
class LayerTreeSynthesizingClient {
  private layerTreeHandler: ((params: unknown) => void) | undefined;

  constructor(
    private readonly real: CDPClient,
    private readonly syntheticBackendNodeId: number,
  ) {}

  async send(method: string, params: Record<string, unknown> = {}, timeout?: number, sessionId?: string): Promise<unknown> {
    const result = await this.real.send(method, params, timeout, sessionId);
    if (method === 'LayerTree.enable' && this.layerTreeHandler) {
      this.layerTreeHandler({
        layers: [
          {
            layerId: 'synthetic-L1',
            backendNodeId: this.syntheticBackendNodeId,
            offsetX: 0,
            offsetY: 0,
            width: 50,
            height: 50,
            paintCount: 1,
            drawsContent: true,
          },
        ],
      });
    }
    return result;
  }

  on(event: string, handler: (params: unknown) => void): void {
    if (event === 'LayerTree.layerTreeDidChange') {
      this.layerTreeHandler = handler;
      return;
    }
    this.real.on(event, handler);
  }

  off(event: string, handler: (params: unknown) => void): void {
    if (event === 'LayerTree.layerTreeDidChange') {
      if (this.layerTreeHandler === handler) this.layerTreeHandler = undefined;
      return;
    }
    this.real.off(event, handler);
  }
}

test('real-chrome A (layers): collectLayers() drives the real production path end-to-end and reports the WINNING (higher-specificity) declaration, with generated source location', liveChromeOpts, async () => {
  const wsUrl = await newRealChromePageTarget(realChromePort, LAYERS_A_FIXTURE_URL);
  const client = new CDPClient(wsUrl);
  await client.waitReady();
  try {
    await waitForRealChromeFixtureReady(client);
    await enableDomainsForSnap(client);

    const docRes = (await client.send('DOM.getDocument', { depth: 0 })) as { root?: { nodeId?: number } };
    const rootNodeId = docRes.root?.nodeId;
    assert.ok(rootNodeId, 'expected a document root nodeId');
    const queryRes = (await client.send('DOM.querySelector', { nodeId: rootNodeId, selector: '#box' })) as { nodeId?: number };
    const boxNodeId = queryRes.nodeId;
    assert.ok(boxNodeId, 'expected #box to resolve to a CDP nodeId');
    const described = (await client.send('DOM.describeNode', { nodeId: boxNodeId })) as { node?: { backendNodeId?: number } };
    const backendNodeId = described.node?.backendNodeId;
    assert.ok(backendNodeId, 'expected a backendNodeId for #box');

    const wrapped = new LayerTreeSynthesizingClient(client, backendNodeId) as unknown as CDPClient;
    const { ctx, written } = makeRealChromeCtx(wrapped, LAYERS_A_FIXTURE_URL);

    await collectLayers(ctx);

    const layers = written.get('layers.json') as any;
    assert.equal(layers.layerTree.available, true, 'the synthesized LayerTree event makes the layer tree available');
    const layer = layers.layers.find((l: any) => l.backendNodeId === backendNodeId);
    assert.ok(layer, 'expected the synthesized layer, seeded from the real #box backendNodeId, in layers.json');
    assert.ok(layer.styleProvenance, 'expected resolveStyleProvenance (reached through the real collectLayers() path) to have resolved a winning declaration for #box');
    assert.equal(layer.styleProvenance.property, 'transform');
    assert.equal(
      layer.styleProvenance.declaredValue,
      'scale(3)',
      'the WINNING declaration is #box (specificity 1-0-0), not .box (0-1-0) which is listed later in source',
    );
    assert.equal(layer.styleProvenance.specificity, '1-0-0', 'specificity must be present and reflect the id-selector winner');
    assert.ok(layer.styleProvenance.generated, 'generated source location must be present (inline <style>, no sourceMappingURL)');
    assert.equal(layer.styleProvenance.generated.sourceURL, LAYERS_A_FIXTURE_URL, 'generated.sourceURL is the page URL for an inline <style>');
    assert.equal(typeof layer.styleProvenance.generated.line, 'number');
    assert.equal(typeof layer.styleProvenance.generated.column, 'number');
  } finally {
    client.close();
  }
}, { timeout: 20000 });

// ----------------------------------------------------------------------------
// Test B — styles static stylesheet-header fallback. The page
// (with its inline <style>) is created via `/json/new?<url>` — Chrome starts
// parsing it BEFORE our WebSocket even attaches, and no CDP domain (in
// particular CSS) is enabled until this test's own `enableDomainsForSnap`
// call, well after the stylesheet was already parsed. NO late
// `CSS.styleSheetAdded` fires during collection — the header-capture
// disable/enable pair (see `captureStyleSheetHeaders`'s module doc) is the
// only source of the stylesheet's URL for an already-parsed static page.
// ----------------------------------------------------------------------------

const STYLES_B_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
<style>#box { color: rgb(1,2,3); }</style>
<div id="box">hi</div>
<div id="marker"></div>
</body></html>`;
const STYLES_B_FIXTURE_URL = `data:text/html,${encodeURIComponent(STYLES_B_FIXTURE_HTML)}`;

test('real-chrome B (styles): a stylesheet already parsed before any CSS.enable still yields a generated source location, with no late styleSheetAdded during collection', liveChromeOpts, async () => {
  const wsUrl = await newRealChromePageTarget(realChromePort, STYLES_B_FIXTURE_URL);
  const client = new CDPClient(wsUrl);
  await client.waitReady();
  try {
    await waitForRealChromeFixtureReady(client);

    // Environment-fact proof, WITHOUT touching styles.ts or style-provenance.ts
    // (both out of scope): reproduce, directly against real Chrome using only
    // test-local scratch code and the raw client, a `CSS.styleSheetAdded`
    // listener registered AFTER CSS is already enabled once (by
    // `enableDomainsForSnap`, mirroring the real pipeline's own first
    // CSS.enable before any collector runs), followed by a single BARE
    // `CSS.enable` call (no preceding disable). This establishes the
    // environment fact `captureStyleSheetHeaders`'s disable+enable pair
    // depends on: a bare re-enable, on its own, redelivers NOTHING for an
    // already-parsed stylesheet.
    await enableDomainsForSnap(client);
    const staleHeaders = new Map<string, string>();
    const scratchHandler = (params: unknown): void => {
      const header = (params as { header?: { styleSheetId?: string; sourceURL?: string } } | undefined)?.header;
      if (header?.styleSheetId && header.sourceURL) staleHeaders.set(header.styleSheetId, header.sourceURL);
    };
    client.on('CSS.styleSheetAdded', scratchHandler);
    await client.send('CSS.enable'); // bare re-enable, NOT a disable+enable pair
    await new Promise((r) => setTimeout(r, 200)); // give any (absent) redelivery a chance to arrive
    client.off('CSS.styleSheetAdded', scratchHandler);
    assert.equal(
      staleHeaders.size,
      0,
      "a bare re-CSS.enable (no preceding disable) does not redeliver headers for an already-parsed stylesheet in real Chrome — only captureStyleSheetHeaders's disable+enable pair does (proven below)",
    );

    // Now exercise the real production code path: collectStyles's own
    // captureStyleSheetHeaders attaches its listener THEN forces a
    // disable+enable PAIR, which (per the empirical finding above) DOES
    // redeliver the header for the already-parsed sheet.
    const { ctx, written } = makeRealChromeCtx(client, STYLES_B_FIXTURE_URL);
    await collectStyles(ctx);
    const styles = written.get('styles.json') as any;
    const boxEl = styles.elements.find((e: any) => e.winningDeclarations?.some((d: any) => d.property === 'color' && d.declaredValue));
    assert.ok(boxEl, 'expected an element with a winning color declaration');
    const colorDecl = boxEl.winningDeclarations.find((d: any) => d.property === 'color');
    assert.equal(colorDecl.declaredValue, 'rgb(1, 2, 3)');
    assert.ok(colorDecl.generated, 'generated source location must be present for an already-parsed static stylesheet');
    assert.equal(colorDecl.generated.sourceURL, STYLES_B_FIXTURE_URL, 'the forced disable/enable redelivery captured the real (already-parsed) stylesheet URL');
    assert.equal(typeof colorDecl.generated.line, 'number');
    assert.equal(typeof colorDecl.generated.column, 'number');
  } finally {
    client.close();
  }
}, { timeout: 20000 });
});
