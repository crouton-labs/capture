import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CAPTURE_ROOT, writeJsonPrivate, ensurePrivateDir } from '../src/session/artifacts.js';
import { captureSnapshotSubstrate } from '../src/cdp/measure/snapshot.js';
import type { CDPClient } from '../src/cdp/client.js';

function freshSessionDir(label: string): string {
  return path.join(CAPTURE_ROOT, `test-caveats-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function freshSnapDir(label: string): string {
  return path.join(CAPTURE_ROOT, `test-caveats-snap-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function asClient(stub: unknown): CDPClient {
  return stub as unknown as CDPClient;
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

// ============================================================================
// CHILD 6 (#6 + #10) integration -- real production wiring, end to end.
// Adversarial RED->GREEN coverage per
// /Users/silasrhyneer/.crouter/canvas/nodes/mre7opwt-eb63755d/context/child6-test-writing-brief.md
// (test 7). Drives `captureSnapshotSubstrate` itself (not settle.ts in
// isolation) through its unstable/evidence-only branch
// (`freezeAnimations:false`, `captureUnsettled:false`, a small
// `settleTimeout`/`pollIntervalMs` so it genuinely times out unsettled)
// against a local stub CDPClient whose churn-observer teardown read is
// malformed AND whose page-side animation-inventory walk reports
// `ok:false` -- then reads the WRITTEN `churn.json` back off disk and
// asserts both honesty markers landed in the real artifact, not just in a
// hand-built fixture. Mirrors the freeze-invariants file's
// 'collectChurnEvidence: the real teardown-callFunctionOn wiring...'
// production-wiring pattern.
// ============================================================================

class UnsettledChurnAnimationUnavailableStubClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];

  private static readonly STATE_OBJECT_ID = 'unsettled-caveats-test-settle-state';

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });

    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureSettleBootstrap')) {
        return { result: { objectId: UnsettledChurnAnimationUnavailableStubClient.STATE_OBJECT_ID } };
      }
      if (expression.includes('__captureAnimationInventory')) {
        // Mirrors ANIMATION_INVENTORY_SCRIPT's own catch branch: the
        // page-side document.getAnimations() walk itself threw -- the
        // evaluate round trip still succeeds but hands back ok:false.
        return { result: { value: { animations: [], ok: false } } };
      }
      // IFRAME_COUNT_SCRIPT / document.documentElement.outerHTML / etc --
      // never reached on this branch (captured stays false), but answered
      // harmlessly regardless.
      return { result: { value: 0 } };
    }
    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      const functionDeclaration = String((params as { functionDeclaration?: unknown }).functionDeclaration ?? '');
      if (objectId === UnsettledChurnAnimationUnavailableStubClient.STATE_OBJECT_ID) {
        if (functionDeclaration.includes('__captureSettleSample')) {
          // quietMs is always 0 (below the default 300ms threshold) and the
          // signature never changes -- the page never reports quiet, so
          // pollForSettle genuinely times out into the unstable branch
          // rather than this stub faking an unsettled result some other way.
          return { result: { value: { signature: 'sig-churning', quietMs: 0 } } };
        }
        if (functionDeclaration.includes('__captureSettleTeardown')) {
          // Malformed teardown value -- missing mutations/resizeCount
          // entirely, mirroring a corrupted round trip (#6).
          return { result: { value: {} } };
        }
      }
      return { result: {} };
    }
    if (method === 'Runtime.releaseObject') {
      return {};
    }
    // Page.enable, DOM.enable, CSS.enable, Accessibility.enable,
    // LayerTree.enable, Animation.enable, Runtime.enable, ...
    return {};
  }
}

// MUST FAIL PRE-FIX: pre-fix, `collectChurnEvidence` coerced the malformed
// teardown value to `{mutations:[], resizeCount:0}` with no marker at all
// (#6), and `groupChurnEvidence` never read `animationEvidence.available`
// (#10) -- so the written `churn.json` would have neither
// `mutationsUnavailable` nor `animationEvidenceUnavailable` at all;
// `churn.mutationsUnavailable`/`churn.animationEvidenceUnavailable` would
// both be `undefined`, not `true`, and the artifact would look exactly
// like a genuinely quiet page with zero infinite animations.
test('captureSnapshotSubstrate: an unsettled capture writes churn.json with mutationsUnavailable AND animationEvidenceUnavailable when the teardown read and animation-evidence read both fail (#6 + #10 integration)', async () => {
  const dir = freshSnapDir('churn-anim-unavailable');
  const client = new UnsettledChurnAnimationUnavailableStubClient();
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 200,
      pollIntervalMs: 20,
      freezeAnimations: false,
      captureUnsettled: false,
    });

    assert.equal(result.settled, false, 'the stub never reports a quiet sample, so the capture must genuinely time out unsettled');
    assert.equal(result.captured, false, 'captureUnsettled is false, so the evidence-only branch (churn.json but no full substrate) must be the one that ran');

    const churnPath = path.join(dir, 'churn.json');
    assert.ok(fs.existsSync(churnPath), 'the evidence-only branch must still write churn.json');

    const churn = JSON.parse(fs.readFileSync(churnPath, 'utf-8'));
    assert.equal(churn.mutationsUnavailable, true, 'the malformed teardown read must surface as mutationsUnavailable in the WRITTEN churn.json artifact');
    assert.equal(churn.mutationsUnavailableReason, 'malformed-value');
    assert.equal(
      churn.animationEvidenceUnavailable,
      true,
      'the failed page-side animation-inventory walk must surface as animationEvidenceUnavailable in the WRITTEN churn.json artifact',
    );
    assert.equal(churn.animationEvidenceUnavailableReason, 'get-animations-threw');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// CHILD 6 fix pass, Fix B integration -- ResizeObserver setup failure must
// reach the WRITTEN churn.json artifact, not just a hand-built
// groupChurnEvidence fixture. Mirrors the #6 + #10 integration test above:
// drives captureSnapshotSubstrate itself through the evidence-only branch
// against a local stub whose churn-observer teardown is otherwise
// well-formed (mutations/resizeCount valid, animation evidence available)
// but carries the bootstrap-time resizeObserverUnavailable flag -- isolating
// this one fact from the #6/#10 stub's other simultaneous failures above.
// ============================================================================

class UnsettledResizeObserverUnavailableStubClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];

  private static readonly STATE_OBJECT_ID = 'unsettled-caveats-resize-test-settle-state';

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });

    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureSettleBootstrap')) {
        return { result: { objectId: UnsettledResizeObserverUnavailableStubClient.STATE_OBJECT_ID } };
      }
      if (expression.includes('__captureAnimationInventory')) {
        // A genuinely successful, empty animation-evidence walk -- isolates
        // the resizeObserverUnavailable marker from #10's separate defect.
        return { result: { value: { animations: [], ok: true } } };
      }
      return { result: { value: 0 } };
    }
    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      const functionDeclaration = String((params as { functionDeclaration?: unknown }).functionDeclaration ?? '');
      if (objectId === UnsettledResizeObserverUnavailableStubClient.STATE_OBJECT_ID) {
        if (functionDeclaration.includes('__captureSettleSample')) {
          // Never quiet -- genuinely times out into the unstable branch.
          return { result: { value: { signature: 'sig-churning-resize', quietMs: 0 } } };
        }
        if (functionDeclaration.includes('__captureSettleTeardown')) {
          // Well-formed mutations/resizeCount (unlike the #6+#10 stub above),
          // but the bootstrap-time ResizeObserver setup genuinely failed.
          return { result: { value: { mutations: [], resizeCount: 0, mutationsObserved: 0, resizeObserverUnavailable: true } } };
        }
      }
      return { result: {} };
    }
    if (method === 'Runtime.releaseObject') {
      return {};
    }
    return {};
  }
}

// MUST FAIL PRE-FIX: pre-fix, `BOOTSTRAP_SCRIPT`'s ResizeObserver setup
// catch recorded no fact at all, `TEARDOWN_SCRIPT` never returned it, and
// neither `ChurnEvidenceRaw` nor `ChurnReportRecord` had a
// `resizeObserverUnavailable` field -- the written `churn.json` would have
// `resizeCount:0` with no marker at all, indistinguishable from a genuinely
// quiet page with a working ResizeObserver; `churn.resizeObserverUnavailable`
// would be `undefined`, not `true`.
test('captureSnapshotSubstrate: an unsettled capture writes churn.json with resizeObserverUnavailable when the bootstrap ResizeObserver setup fails (Fix B integration)', async () => {
  const dir = freshSnapDir('churn-resize-unavailable');
  const client = new UnsettledResizeObserverUnavailableStubClient();
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 200,
      pollIntervalMs: 20,
      freezeAnimations: false,
      captureUnsettled: false,
    });

    assert.equal(result.settled, false);
    assert.equal(result.captured, false);

    const churnPath = path.join(dir, 'churn.json');
    assert.ok(fs.existsSync(churnPath), 'the evidence-only branch must still write churn.json');

    const churn = JSON.parse(fs.readFileSync(churnPath, 'utf-8'));
    assert.equal(
      churn.resizeObserverUnavailable,
      true,
      'a bootstrap-time ResizeObserver setup failure must surface as resizeObserverUnavailable in the WRITTEN churn.json artifact',
    );
    assert.equal(churn.resizeObserverUnavailableReason, 'setup-threw');
    assert.equal(churn.resizeCount, 0);
    assert.equal(churn.animationEvidenceUnavailable, undefined, 'this stub keeps animation evidence genuinely available, isolating the resize marker');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
