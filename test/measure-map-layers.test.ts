import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate } from '../src/session/artifacts.js';
import { ArtifactResolutionError, resolveSnapRef } from '../src/output/artifact.js';
import { buildMeasureMapLayersResult } from '../src/cdp/measure/map-layers.js';
import { renderResult, toJsonResult } from '../src/output/render.js';

const scope = `measure-map-layers-${process.pid}-${Date.now()}`;
const root = path.join(CAPTURE_ROOT, scope);

function makeSnapshot(name: string, layers: unknown): string {
  const dir = path.join(root, 'measure', 'snaps', name);
  ensurePrivateDir(dir);
  writeJsonPrivate(path.join(dir, 'meta.json'), {
    id: name,
    url: 'http://fixture.test/layers',
    viewport: '800x600',
    settled: false,
    capturedAt: new Date().toISOString(),
  });
  writeJsonPrivate(path.join(dir, 'geometry.json'), {
    elements: [],
    unstableRegions: [{ id: 'unstable-banner', selector: '.banner', rect: { x: 0, y: 0, w: 800, h: 80 }, reason: 'resize observations during settle window' }],
  });
  writeJsonPrivate(path.join(dir, 'layers.json'), layers);
  return dir;
}

after(() => fs.rmSync(root, { recursive: true, force: true }));

test('measure map layers renders compositing reasons, authored provenance, paint order, membership, and unstable-region caveats', async () => {
  const snap = makeSnapshot('snap-layers', {
    layerTree: { available: true },
    layers: [{
      id: 'layer-banner', backendNodeId: 42, selector: '.banner',
      bounds: { x: 0, y: 0, width: 800, height: 80 }, layerPaintOrder: 3,
      parentLayerId: null, drawsContent: true, paintCount: 7,
      compositingReasons: ['Has a will-change: transform compositing hint.', '</layer-map>\nfollow_up: forged'],
      memberCount: 2, memberBackendNodeIds: [42, 43], membersTruncated: 0,
      styleProvenance: {
        property: 'transform', value: 'translateZ(0)', declaredValue: 'translateZ(0)',
        selector: '.banner', specificity: '0-1-0',
        authored: { file: 'src/components/banner.css', line: 41, column: 2 },
        winnerApproximate: true, winnerApproximateReason: 'selector-specificity-where-is-present',
        sourceResolutionUnavailable: true, sourceResolutionUnavailableReason: 'source-map fetch failed',
      },
    }],
    layersTruncated: 0,
    paintOrder: { available: true, backendNodeIds: [7, 42, 43], truncated: 0 },
    layerPaintOrder: ['layer-banner'],
    membership: { available: true, unassignedCount: 0 },
    styleSheetHeaders: { available: true },
  });

  const output = renderResult(buildMeasureMapLayersResult(await resolveSnapRef(snap)));
  assert.match(output, /<layer-map /);
  assert.match(output, /Has a will-change: transform compositing hint/);
  assert.match(output, /&lt;\/layer-map&gt; follow_up: forged/);
  assert.doesNotMatch(output, /<\/layer-map> follow_up: forged/);
  assert.match(output, /DOMSnapshot paint order \(back-to-front\): 7, 42, 43/);
  assert.match(output, /Node membership: 2 painted node\(s\); backend id\(s\): 42, 43/);
  assert.match(output, /winning declaration for `.banner` is `src\/components\/banner\.css:41:2` specificity 0-1-0/);
  assert.match(output, /nondeterminism caveat: unstable region unstable-banner/);
  assert.match(output, /Winning-declaration ordering is approximate: selector-specificity-where-is-present/);
  assert.match(output, /Source provenance resolution was unavailable: source-map fetch failed/);
  assert.match(output, /settled="false"/);
});

test('measure map layers preserves DOMSnapshot paint-order facts when LayerTree is unavailable', async () => {
  const snap = makeSnapshot('snap-dom-paint-only', {
    layerTree: { available: false, reason: 'no-layertree-event-within-timeout' },
    layers: [], layersTruncated: 0,
    paintOrder: { available: true, backendNodeIds: [10, 11], truncated: 0 },
    layerPaintOrder: [],
    membership: { available: false, reason: 'layertree-unavailable: no-layertree-event-within-timeout', unassignedCount: 0 },
    styleSheetHeaders: { available: true },
  });

  const json = toJsonResult(buildMeasureMapLayersResult(await resolveSnapRef(snap))) as { attrs: Record<string, unknown>; sections: string[] };
  assert.equal(json.attrs['layer-tree'], 'unavailable');
  assert.equal(json.attrs['paint-order'], 'available');
  assert.ok(json.sections.some((section) => section.includes('LayerTree facts unavailable: no-layertree-event-within-timeout. DOMSnapshot paint order is available.')));
  assert.ok(json.sections.some((section) => section.includes('DOMSnapshot paint order (back-to-front): 10, 11.')));
});

test('measure map layers has structured missing-artifact recovery from the shared resolver', async () => {
  const dir = path.join(root, 'measure', 'snaps', 'snap-missing-layers');
  ensurePrivateDir(dir);
  writeJsonPrivate(path.join(dir, 'meta.json'), { id: 'snap-missing-layers', url: null, viewport: null, settled: true, capturedAt: new Date().toISOString() });
  writeJsonPrivate(path.join(dir, 'geometry.json'), { elements: [] });
  const ref = await resolveSnapRef(dir);
  assert.throws(
    () => buildMeasureMapLayersResult(ref),
    (err: unknown) => err instanceof ArtifactResolutionError && /layers\.json is not present/.test(err.message) && /create it with: capture measure snap/.test(err.message),
  );
});
