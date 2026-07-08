import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CAPTURE_ROOT, writeJsonPrivate, ensurePrivateDir } from '../src/session/artifacts.js';

function freshSessionDir(label: string): string {
  return path.join(CAPTURE_ROOT, `test-caveats-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function makeSnapDirWithGeometry(
  sessionDir: string,
  snapId: string,
  geometry: unknown,
): string {
  const dir = path.join(sessionDir, 'measure', 'snaps', snapId);
  ensurePrivateDir(dir);
  writeJsonPrivate(path.join(dir, 'meta.json'), {
    id: snapId,
    url: 'http://example.test/promo',
    viewport: '390x844',
    settled: false,
    capturedAt: new Date().toISOString(),
  });
  writeJsonPrivate(path.join(dir, 'geometry.json'), geometry);
  return dir;
}

test('unstableRegionsFor reads the unstableRegions marked by --capture-unsettled on geometry.json', async () => {
  const { resolveSnapRef, unstableRegionsFor } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('regions');
  const snapDir = makeSnapDirWithGeometry(sessionDir, 'snap-c11a', {
    elements: [
      { id: 'el-carousel', selector: '.carousel', rect: { x: 0, y: 120, w: 390, h: 240 } },
      { id: 'el-ad', selector: '.ad-slot', rect: { x: 0, y: 620, w: 390, h: 180 } },
      { id: 'el-static', selector: 'header.app-bar', rect: { x: 0, y: 0, w: 390, h: 56 } },
    ],
    unstableRegions: [
      {
        id: 'region-1',
        selector: '.carousel',
        rect: { x: 0, y: 120, w: 390, h: 240 },
        elementIds: ['el-carousel'],
        reason: 'autoplay repaint every 3.2s',
      },
      {
        id: 'region-2',
        selector: '.ad-slot',
        rect: { x: 0, y: 620, w: 390, h: 180 },
        elementIds: ['el-ad'],
        reason: 'remounted twice during the settle window',
      },
    ],
  });
  try {
    const ref = await resolveSnapRef(snapDir);
    const regions = unstableRegionsFor(ref);
    assert.equal(regions.length, 2);
    assert.equal(regions[0].id, 'region-1');
    assert.equal(regions[0].reason, 'autoplay repaint every 3.2s');
    assert.equal(regions[1].id, 'region-2');
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('unstableRegionsFor returns [] for a settled snapshot with no unstableRegions key', async () => {
  const { resolveSnapRef, unstableRegionsFor } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('regions-settled');
  const snapDir = makeSnapDirWithGeometry(sessionDir, 'snap-settled', {
    elements: [{ id: 'el-1', selector: 'button.send-btn' }],
  });
  try {
    const ref = await resolveSnapRef(snapDir);
    assert.deepEqual(unstableRegionsFor(ref), []);
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('unstableRegionsFor throws the standard reader failure when geometry.json is entirely absent', async () => {
  const { resolveSnapRef, unstableRegionsFor, ArtifactResolutionError } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('regions-no-geometry');
  const dir = path.join(sessionDir, 'measure', 'snaps', 'snap-no-substrate');
  ensurePrivateDir(dir);
  writeJsonPrivate(path.join(dir, 'meta.json'), {
    id: 'snap-no-substrate',
    url: 'http://example.test/promo',
    viewport: '390x844',
    settled: false,
    capturedAt: new Date().toISOString(),
  });
  // No geometry.json at all — the "did not settle, no --capture-unsettled" case.
  try {
    const ref = await resolveSnapRef(dir);
    assert.throws(
      () => unstableRegionsFor(ref),
      (err: unknown) => {
        assert.ok(err instanceof ArtifactResolutionError);
        assert.equal(err.creatingCommand, 'capture measure snap');
        return true;
      },
    );
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ============================================================================
// annotateUnstableFacts
// ============================================================================

test('annotateUnstableFacts attaches a caveat to facts matched by elementId', async () => {
  const { annotateUnstableFacts } = await import('../src/output/artifact.js');
  const regions = [
    { id: 'region-1', selector: '.carousel', elementIds: ['el-carousel'], reason: 'autoplay repaint every 3.2s' },
  ];
  const facts = [
    { elementId: 'el-carousel', label: 'offscreen' },
    { elementId: 'el-static', label: 'clean' },
  ];
  const annotated = annotateUnstableFacts(facts, regions);
  assert.equal(annotated.length, 2);
  assert.equal(annotated[0].caveats.length, 1);
  assert.equal(annotated[0].caveats[0].regionId, 'region-1');
  assert.equal(annotated[0].caveats[0].reason, 'autoplay repaint every 3.2s');
  assert.deepEqual(annotated[1].caveats, []);
});

test('annotateUnstableFacts attaches a caveat to facts matched by rect overlap when no elementId matches', async () => {
  const { annotateUnstableFacts } = await import('../src/output/artifact.js');
  const regions = [
    { id: 'region-1', selector: '.ad-slot', rect: { x: 0, y: 620, w: 390, h: 180 } },
  ];
  const facts = [
    { rect: { x: 10, y: 630, w: 50, h: 20 }, label: 'inside region' }, // overlaps
    { rect: { x: 0, y: 0, w: 50, h: 20 }, label: 'far away' }, // no overlap
    { rect: { x: 390, y: 620, w: 5, h: 5 }, label: 'edge-touching only' }, // touches the region's right edge exactly — no overlap
  ];
  const annotated = annotateUnstableFacts(facts, regions);
  assert.equal(annotated[0].caveats.length, 1);
  assert.deepEqual(annotated[1].caveats, []);
  assert.deepEqual(annotated[2].caveats, []);
});

test('annotateUnstableFacts attaches one caveat per overlapping region for a fact spanning multiple regions', async () => {
  const { annotateUnstableFacts } = await import('../src/output/artifact.js');
  const regions = [
    { id: 'region-1', rect: { x: 0, y: 0, w: 100, h: 100 } },
    { id: 'region-2', rect: { x: 50, y: 50, w: 100, h: 100 } },
  ];
  const facts = [{ rect: { x: 40, y: 40, w: 30, h: 30 }, label: 'straddles both' }];
  const annotated = annotateUnstableFacts(facts, regions);
  assert.equal(annotated[0].caveats.length, 2);
  assert.deepEqual(
    annotated[0].caveats.map((c) => c.regionId).sort(),
    ['region-1', 'region-2'],
  );
});

test('annotateUnstableFacts returns empty caveats for every fact when there are no unstable regions', async () => {
  const { annotateUnstableFacts } = await import('../src/output/artifact.js');
  const facts = [{ elementId: 'el-1' }, { rect: { x: 0, y: 0, w: 10, h: 10 } }];
  const annotated = annotateUnstableFacts(facts, []);
  assert.deepEqual(annotated.map((a) => a.caveats), [[], []]);
});

test('unstableRegionsFor + annotateUnstableFacts compose end-to-end over a fixture snapshot', async () => {
  const { resolveSnapRef, unstableRegionsFor, annotateUnstableFacts } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('end-to-end');
  const snapDir = makeSnapDirWithGeometry(sessionDir, 'snap-e2e', {
    elements: [
      { id: 'el-carousel', selector: '.carousel', rect: { x: 0, y: 120, w: 390, h: 240 } },
      { id: 'el-static', selector: 'header.app-bar', rect: { x: 0, y: 0, w: 390, h: 56 } },
    ],
    unstableRegions: [
      { id: 'region-1', selector: '.carousel', rect: { x: 0, y: 120, w: 390, h: 240 }, elementIds: ['el-carousel'] },
    ],
  });
  try {
    const ref = await resolveSnapRef(snapDir);
    const regions = unstableRegionsFor(ref);
    const facts = [
      { elementId: 'el-carousel', rect: { x: 0, y: 120, w: 390, h: 240 }, kind: 'offscreen' },
      { elementId: 'el-static', rect: { x: 0, y: 0, w: 390, h: 56 }, kind: 'clean' },
    ];
    const annotated = annotateUnstableFacts(facts, regions);
    assert.equal(annotated[0].caveats.length, 1);
    assert.equal(annotated[0].caveats[0].regionId, 'region-1');
    assert.deepEqual(annotated[1].caveats, []);
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});
