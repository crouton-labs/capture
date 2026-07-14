import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { closeChrome, spawnHeadlessChrome } from './fixtures/chrome.js';

import { CAPTURE_ROOT, DIR_MODE, FILE_MODE } from '../src/session/artifacts.js';
import { CDPClient } from '../src/cdp/client.js';
import { enableDomainsForSnap } from '../src/cdp/domains.js';
import type { Collector, CollectorDescriptor } from '../src/cdp/measure/types.js';
import {
  DEFAULT_SETTLE_TIMEOUT_MS,
  pollForSettle,
  groupChurnEvidence,
  injectChurnObservers,
  buildDomSettleSampler,
  collectChurnEvidence,
  domSignaturesEqual,
} from '../src/cdp/measure/settle.js';
import { captureSnapshotSubstrate } from '../src/cdp/measure/snapshot.js';
import { liveChromeOpts } from './fixtures/live-chrome.js';

// A 1x1 transparent PNG, base64-encoded — stands in for `Page.captureScreenshot`'s `data`.
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// Representative token-shaped DOM evidence.
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

// Planted in the fixture DOM to prove end-to-end evidence preservation.
const FAKE_GH_PAT = 'github_pat_' + '11ABCDEFGHIJKLMNOPQR0123456789abcdefghijklmnopqrstuvwxyz_9Q';

const FIXTURE_HTML = `<!DOCTYPE html><html><body>
<form>
  <input type="password" name="pw" value="hunter2super">
  <div data-token="${FAKE_JWT}" class="token-holder"></div>
  <div data-pat="${FAKE_GH_PAT}" class="pat-holder-sentinel"></div>
</form>
</body></html>`;

type Scenario = 'stable' | 'churning' | 'freeze';

/**
 * Stands in for `CDPClient` — no real Chrome, no real websocket. Follows
 * `test/recorder-bridge.test.ts`'s `StubCdpClient` pattern: `send` pattern-
 * matches on `Runtime.evaluate`'s `expression` string via `.includes(...)`
 * against `settle.ts`'s marker constants.
 */
class StubCdpClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  private readonly scenario: Scenario;
  private frozen = false;
  private sampleCounter = 0;
  /**
   * Forces the `document.documentElement.outerHTML` `Runtime.evaluate` call
   * (the I-5 dom.html read under test) to fail at the real call-site: `throw`
   * makes `client.send` reject exactly as a CDP transport/protocol failure
   * would, `no-value` returns the real success-shaped `{ result: {} }` CDP
   * gives back when the page-side expression evaluates to `undefined`.
   * Defaults to `undefined` — the genuine-observation path, unchanged.
   */
  private readonly domHtmlFailureMode?: 'throw' | 'no-value';
  /** #8: when set, the browser-wide `Animation.setPlaybackRate({playbackRate:0})` freeze-override call itself throws — isolates the I-6 override-apply failure from the origin capture (which still succeeds, mirroring a real Chrome/target combo that rejects only the override). */
  private readonly rateApplyThrows: boolean;
  /** #72: when >0, the stub's `__captureFreezePauseStatus` read-back reports this many per-animation `.pause()` failures instead of a clean `0` — isolates the I-6 per-animation pause-failure fact from the browser-wide override (which still succeeds), mirroring a real Chrome/target combo where SOME individual animations reject `.pause()` even though the walk itself and the override both succeed. */
  private readonly pauseFailureCount: number;

  constructor(scenario: Scenario, domHtmlFailureMode?: 'throw' | 'no-value', rateApplyThrows = false, pauseFailureCount = 0) {
    this.scenario = scenario;
    this.domHtmlFailureMode = domHtmlFailureMode;
    this.rateApplyThrows = rateApplyThrows;
    this.pauseFailureCount = pauseFailureCount;
  }

  /**
   * When provided, the stub records a `screenshot`/`dom-capture` event
   * into this shared array the instant it sees the orchestrator's baseline
   * artifact CDP calls — so the phase-ordering test can interleave these
   * against its stub collectors' own recorded events.
   */
  phaseEvents?: string[];

  /** The fixed `objectId` the stub hands back for the held churn-observer state (BOOTSTRAP's held return value) — there's only ever one per stub instance, so a fixed id is enough to route `Runtime.callFunctionOn`/`Runtime.releaseObject` calls against it below. */
  private static readonly STATE_OBJECT_ID = 'stub-settle-state';
  /** The fixed `objectId` the stub hands back for the held freeze-origin container (FREEZE_ANIMATIONS_SCRIPT's real held return shape — the production script always returns an object literal, never a bare `value:true`, so the stub must mirror that for `freezeAnimationsBeforeCapture`'s I-6 handle-acquired-before-mutation ordering to actually exercise `Animation.setPlaybackRate`). */
  private static readonly FREEZE_CONTAINER_ID = 'stub-freeze-container';

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    if (this.phaseEvents) {
      if (method === 'Page.captureScreenshot') this.phaseEvents.push('screenshot');
      else if (method === 'Runtime.evaluate' && String((params as { expression?: unknown }).expression ?? '') === 'document.documentElement.outerHTML') {
        this.phaseEvents.push('dom-capture');
      }
    }

    if (method === 'Animation.setPlaybackRate') {
      if (this.rateApplyThrows && (params as { playbackRate?: number }).playbackRate === 0) {
        // #8: the initial browser-wide freeze override itself failing — the
        // per-animation pauses captured in the SAME evaluate as the origin
        // capture (already recorded via `this.frozen = true` above) are
        // still real; only the browser-wide override call fails.
        throw new Error('rate-apply-boom: the browser-wide playbackRate(0) freeze override failed');
      }
      this.frozen = true;
      return {};
    }
    if (method === 'Page.captureScreenshot') {
      return { data: ONE_PIXEL_PNG_BASE64 };
    }
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureFreezeAnimations')) {
        // Held return (returnByValue:false) — mirrors the real
        // FREEZE_ANIMATIONS_SCRIPT, which always returns an `{anims,
        // origin}` object literal, never a bare by-value `true`. Setting
        // `frozen` here (before `Animation.setPlaybackRate` is ever called)
        // matches I-6's fixed ordering: the origin handle is acquired
        // first, and the browser-wide override is a SEPARATE later call.
        this.frozen = true;
        return { result: { objectId: StubCdpClient.FREEZE_CONTAINER_ID } };
      }
      if (expression.includes('__captureSettleBootstrap')) {
        // Held return (returnByValue:false) — the orchestrator now gets a
        // handle wrapping this objectId, never a `window.__captureSettle` value.
        return { result: { objectId: StubCdpClient.STATE_OBJECT_ID } };
      }
      if (expression.includes('__captureAnimationInventory')) {
        // Class C item 3 (I-6 honesty sweep r4): the real
        // ANIMATION_INVENTORY_SCRIPT now returns `{ animations, ok }`, not
        // a bare array — collectAnimationEvidence gates on `ok === true` and
        // `Array.isArray(animations)` before trusting the walk at all. A
        // bare-array stub (the pre-fix shape) would fail that check and
        // silently surface `available:false` here, dropping every
        // animation-sourced churn region this scenario expects.
        return { result: { value: { animations: this.animationInventory(), ok: true } } };
      }
      if (expression === 'document.documentElement.outerHTML') {
        if (this.domHtmlFailureMode === 'throw') {
          throw new Error('stub: outerHTML evaluate transport failure');
        }
        if (this.domHtmlFailureMode === 'no-value') {
          return { result: {} };
        }
        return { result: { value: FIXTURE_HTML } };
      }
      return { result: {} };
    }
    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      const functionDeclaration = String((params as { functionDeclaration?: unknown }).functionDeclaration ?? '');
      if (objectId === StubCdpClient.FREEZE_CONTAINER_ID && functionDeclaration.includes('__captureFreezeOriginOk')) {
        // #7: freezeAnimationsBeforeCapture now reads the held freeze
        // container's own `ok` flag back via FREEZE_ORIGIN_OK_SCRIPT before
        // ever trusting the origin capture or applying the browser-wide
        // override — this stub's origin capture always succeeds, so it
        // always answers `true` here. Without this branch, the call would
        // fall through to the STATE_OBJECT_ID assertion below and fail.
        return { result: { value: true } };
      }
      if (objectId === StubCdpClient.FREEZE_CONTAINER_ID && functionDeclaration.includes('__captureRestoreAnimations')) {
        return { result: { value: true } };
      }
      if (objectId === StubCdpClient.FREEZE_CONTAINER_ID && functionDeclaration.includes('__captureFreezePauseStatus')) {
        // #72: freezeAnimationsBeforeCapture now reads back the per-animation
        // pause-failure tally FREEZE_ANIMATIONS_SCRIPT records — this stub's
        // origin capture never fails an individual .pause() call, so it
        // always reports a clean tally here. Without this branch, the call
        // would fall through to the STATE_OBJECT_ID assertion below and fail.
        return { result: { value: { total: 1, pauseFailureCount: this.pauseFailureCount } } };
      }
      assert.equal(objectId, StubCdpClient.STATE_OBJECT_ID, 'callFunctionOn must target the held churn-observer state objectId');
      if (functionDeclaration.includes('__captureSettleSample')) {
        return { result: { value: this.nextSample() } };
      }
      if (functionDeclaration.includes('__captureSettleTeardown')) {
        return { result: { value: this.teardown() } };
      }
      return { result: {} };
    }
    if (method === 'Runtime.releaseObject') {
      const releasedId = (params as { objectId?: string }).objectId;
      assert.ok(
        releasedId === StubCdpClient.STATE_OBJECT_ID || releasedId === StubCdpClient.FREEZE_CONTAINER_ID,
        'releaseObject must target either the held churn-observer state objectId or the held freeze-container objectId',
      );
      return {};
    }
    // Page.enable, DOM.enable, CSS.enable, Accessibility.enable,
    // LayerTree.enable, Animation.enable, Runtime.enable, ...
    return {};
  }

  private nextSample(): { signature: string; quietMs: number } {
    if (this.scenario === 'stable') return { signature: 'sig-stable', quietMs: 1000 };
    if (this.scenario === 'freeze' && this.frozen) return { signature: 'sig-stable', quietMs: 1000 };
    // churning (or freeze not yet frozen): an autoplay carousel with an
    // infinite CSS animation — strictly-increasing signature, never quiet.
    this.sampleCounter += 1;
    return { signature: `sig-${this.sampleCounter}`, quietMs: 0 };
  }

  private teardown(): { mutations: Array<{ t: number; type: string; selector: string }>; resizeCount: number } {
    if (this.scenario === 'stable') return { mutations: [], resizeCount: 0 };
    return {
      mutations: [
        { t: 10, type: 'childList', selector: '.ad-slot' },
        { t: 20, type: 'childList', selector: '.ad-slot' },
      ],
      resizeCount: 0,
    };
  }

  private animationInventory(): unknown[] {
    if (this.scenario === 'stable') return [];
    return [
      { selector: '.carousel', animationName: 'slide', durationMs: 3200, iterationCount: 'infinite', infinite: true, playState: 'running' },
    ];
  }
}

/**
 * `domains.ts`/`settle.ts`/`snapshot.ts` declare their client parameter as
 * the concrete `CDPClient` class (private-field members, so TS won't
 * structurally accept a plain stub there) — same seam
 * `recorder-bridge.test.ts`/`recorder-bridge.ts` uses (`asCDPClient`). Both
 * only ever call `.send()` on it.
 */
function asClient(stub: StubCdpClient): CDPClient {
  return stub as unknown as CDPClient;
}

function freshSnapDir(label: string): string {
  return path.join(CAPTURE_ROOT, `snapshot-settledness-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ============================================================================
// 1. Default settle timeout is 5000ms
// ============================================================================

test('default settle timeout is 5000ms', async () => {
  assert.equal(DEFAULT_SETTLE_TIMEOUT_MS, 5000);

  const dir = freshSnapDir('default-timeout');
  const client = new StubCdpClient('stable');
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      pollIntervalMs: 20,
    });
    assert.equal(typeof result.settleMs, 'number');
    assert.equal(result.meta.settleTimeoutMs, 5000);
    assert.equal(result.settled, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The full settled-branch collector substrate — every file a settled or
// forced-full (`captureUnsettled`) capture must write (excluding
// `churn.json`, which is unstable-branch-only). Shared by tests 2 and 4 so
// the forced-full-unsettled case is held to the exact same bar.
const FULL_SUBSTRATE_FILES = [
  'geometry.json',
  'hittest.json',
  'styles.json',
  'queries.json',
  'ax.json',
  'text.json',
  'forms.json',
  'animation.json',
  'focus.json',
  'scroll.json',
  'layers.json',
  'media.json',
  'screenshot.png',
  'dom.html',
  'meta.json',
];

// ============================================================================
// 2. Stable scenario writes the full settled substrate
// ============================================================================

test('stable scenario writes the full settled substrate', async () => {
  const dir = freshSnapDir('stable-full');
  const client = new StubCdpClient('stable');
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 500,
      pollIntervalMs: 20,
    });

    assert.equal(result.settled, true);
    assert.equal(result.captured, true);

    for (const filename of FULL_SUBSTRATE_FILES) {
      assert.ok(fs.existsSync(path.join(dir, filename)), `expected ${filename} to exist`);
    }
    assert.equal(fs.existsSync(path.join(dir, 'pixels.json')), false);
    assert.equal(fs.existsSync(path.join(dir, 'states.json')), false);

    const geometry = readJson(path.join(dir, 'geometry.json'));
    assert.deepEqual(geometry.elements, []);
    assert.equal('unstableRegions' in geometry, false);

    const domHtml = fs.readFileSync(path.join(dir, 'dom.html'), 'utf-8');
    assert.equal(domHtml, FIXTURE_HTML);
    assert.ok(domHtml.includes('hunter2super'));
    assert.ok(domHtml.includes(FAKE_JWT));

    assert.equal(fs.statSync(path.join(dir, 'meta.json')).mode & 0o777, FILE_MODE);
    assert.equal(fs.statSync(path.join(dir, 'dom.html')).mode & 0o777, FILE_MODE);
    assert.equal(fs.statSync(path.join(dir, 'screenshot.png')).mode & 0o777, FILE_MODE);
    assert.equal(fs.statSync(dir).mode & 0o777, DIR_MODE);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// 2b. Emitted dom.html preserves page evidence end-to-end.
// ============================================================================

test('emitted dom.html preserves password, token-shaped attribute, and DOM identity evidence', async () => {
  const dir = freshSnapDir('emitted-dom-evidence');
  const client = new StubCdpClient('stable');
  try {
    await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 500,
      pollIntervalMs: 20,
    });

    const domHtml = fs.readFileSync(path.join(dir, 'dom.html'), 'utf-8');
    assert.equal(domHtml, FIXTURE_HTML);
    assert.ok(domHtml.includes('hunter2super'));
    assert.ok(domHtml.includes(FAKE_JWT));
    assert.ok(domHtml.includes(FAKE_GH_PAT));
    assert.ok(domHtml.includes('pat-holder-sentinel'));
    assert.ok(!domHtml.includes('[REDACTED]'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// 2c. I-5 honesty gap (positive control + adversarial): a genuine outerHTML
// read reports `meta.domHtml.available:true` and writes the file (unchanged
// benign shape); a FAILED read (throw, or a real no-value CDP response) must
// surface an explicit `meta.domHtml.available:false` + fixed reason and MUST
// NOT write a benign-looking empty dom.html — while the rest of the snapshot
// substrate still survives.
// ============================================================================

test('positive control: a genuine outerHTML read reports domHtml.available:true and writes dom.html', async () => {
  const dir = freshSnapDir('domhtml-positive-control');
  const client = new StubCdpClient('stable');
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 500,
      pollIntervalMs: 20,
    });

    assert.deepEqual(result.meta.domHtml, { available: true });
    const meta = readJson(path.join(dir, 'meta.json'));
    assert.deepEqual(meta.domHtml, { available: true });
    assert.equal('unavailableReason' in meta.domHtml, false);
    assert.ok(fs.existsSync(path.join(dir, 'dom.html')));
    assert.ok(result.artifacts.includes('dom.html'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const mode of ['throw', 'no-value'] as const) {
  const expectedReason = mode === 'throw' ? 'dom-evaluate-threw' : 'dom-evaluate-returned-no-value';

  test(`adversarial (${mode}): a failed outerHTML read reports domHtml.available:false and does NOT write a benign-looking empty dom.html`, async () => {
    const dir = freshSnapDir(`domhtml-${mode}`);
    const client = new StubCdpClient('stable', mode);
    try {
      const result = await captureSnapshotSubstrate({
        target: { client: asClient(client) },
        url: 'http://example.test',
        path: dir,
        settleTimeout: 500,
        pollIntervalMs: 20,
      });

      // The honesty fact: explicit unavailable + fixed reason, not omitted.
      assert.deepEqual(result.meta.domHtml, { available: false, unavailableReason: expectedReason });
      const meta = readJson(path.join(dir, 'meta.json'));
      assert.deepEqual(meta.domHtml, { available: false, unavailableReason: expectedReason });

      // No dom.html file at all — an absent artifact, never a benign empty one
      // indistinguishable from a genuinely empty document (the pre-fix bug).
      assert.equal(fs.existsSync(path.join(dir, 'dom.html')), false);
      assert.ok(!result.artifacts.includes('dom.html'));

      // The rest of the snapshot substrate still survives the dom.html read
      // failure — hard-failing the whole snapshot was NOT the chosen path.
      assert.ok(fs.existsSync(path.join(dir, 'screenshot.png')), 'screenshot.png must still be written');
      assert.ok(fs.existsSync(path.join(dir, 'geometry.json')), 'geometry.json must still be written');
      assert.ok(fs.existsSync(path.join(dir, 'meta.json')), 'meta.json must still be written last');
      assert.equal(result.settled, true);
      assert.equal(result.captured, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

// ============================================================================
// 3. Churning scenario (no freeze, no --capture-unsettled) writes evidence only
// ============================================================================

test('churning scenario writes evidence only (churn.json + animation.json + meta.json)', async () => {
  const dir = freshSnapDir('churning-evidence');
  const client = new StubCdpClient('churning');
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 150,
      pollIntervalMs: 20,
    });

    assert.equal(result.settled, false);
    assert.equal(result.captured, false);

    assert.ok(fs.existsSync(path.join(dir, 'churn.json')));
    assert.ok(fs.existsSync(path.join(dir, 'animation.json')));
    assert.ok(fs.existsSync(path.join(dir, 'meta.json')));
    assert.equal(fs.existsSync(path.join(dir, 'geometry.json')), false);
    assert.equal(fs.existsSync(path.join(dir, 'styles.json')), false);
    assert.equal(fs.existsSync(path.join(dir, 'screenshot.png')), false);
    assert.equal(fs.existsSync(path.join(dir, 'dom.html')), false);

    // Exact three-file contract — catches an accidental extra collector
    // write (e.g. a stray hittest.json/ax.json) that individual
    // existsSync-false checks above wouldn't necessarily enumerate.
    assert.deepEqual(fs.readdirSync(dir).sort(), ['animation.json', 'churn.json', 'meta.json']);

    const meta = readJson(path.join(dir, 'meta.json'));
    assert.equal(meta.settled, false);

    const churn = readJson(path.join(dir, 'churn.json'));
    assert.ok(churn.regions.some((r: any) => r.selector === '.ad-slot'), 'expected a mutation-sourced .ad-slot region');
    assert.ok(
      churn.regions.some((r: any) => typeof r.reason === 'string' && r.reason.toLowerCase().includes('animation')),
      'expected an animation-sourced region',
    );
    assert.ok(result.unstableRegions.length >= 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// 4. Churning + --capture-unsettled forces full substrate with unstable markers
// ============================================================================

test('churning + captureUnsettled forces full substrate with unstable markers', async () => {
  const dir = freshSnapDir('churning-forced');
  const client = new StubCdpClient('churning');
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 150,
      pollIntervalMs: 20,
      captureUnsettled: true,
    });

    assert.equal(result.settled, false);
    assert.equal(result.captured, true);

    // Forced-full unsettled must write the same full substrate a settled
    // capture does, PLUS churn.json (the unstable-branch evidence file).
    for (const filename of FULL_SUBSTRATE_FILES) {
      assert.ok(fs.existsSync(path.join(dir, filename)), `expected ${filename} to exist`);
    }
    assert.ok(fs.existsSync(path.join(dir, 'churn.json')));

    const geometry = readJson(path.join(dir, 'geometry.json'));
    assert.ok(Array.isArray(geometry.unstableRegions));
    assert.ok(geometry.unstableRegions.length > 0);

    const churn = readJson(path.join(dir, 'churn.json'));
    const churnIds = churn.regions.map((r: any) => r.id).sort();
    const geometryIds = geometry.unstableRegions.map((r: any) => r.id).sort();
    assert.deepEqual(churnIds, geometryIds);

    const meta = readJson(path.join(dir, 'meta.json'));
    assert.ok(meta.unstableRegionCount > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// 5. --freeze-animations settles a page that would otherwise never settle
// ============================================================================

test('freezeAnimations settles a page that would otherwise never settle', async () => {
  const dir = freshSnapDir('freeze');
  const client = new StubCdpClient('freeze');
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 300,
      pollIntervalMs: 20,
      freezeAnimations: true,
    });

    assert.equal(result.settled, true);
    assert.ok(client.calls.some((c) => c.method === 'Animation.setPlaybackRate'));

    const geometry = readJson(path.join(dir, 'geometry.json'));
    assert.equal('unstableRegions' in geometry, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// CHILD 6 fix pass, Fix C (#8): the browser-wide
// `Animation.setPlaybackRate({playbackRate:0})` freeze override itself
// failing must land as an explicit `meta.json` fact, not read as a clean
// freeze just because `animationsRestored` (which only reflects the
// RESTORE step) happens to come back true.
//
// MUST FAIL PRE-FIX: pre-fix, `captureSnapshotSubstrate` never read
// `animationFreezeHandle?.rateOverrideApplied` at all — `meta.json` only
// ever had `animationsRestored`, so `result.meta.freezeOverrideApplied`
// would be `undefined` (the field didn't exist), not the expected `false`.
test('#8: the browser-wide playbackRate(0) freeze override throwing surfaces meta.freezeOverrideApplied:false honestly', async () => {
  const dir = freshSnapDir('freeze-override-throws');
  const client = new StubCdpClient('freeze', undefined, true);
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 300,
      pollIntervalMs: 20,
      freezeAnimations: true,
    });

    assert.equal(result.settled, true, 'the per-animation pauses captured at origin-capture time still let the page settle even though the browser-wide override failed');
    assert.equal(
      result.meta.freezeOverrideApplied,
      false,
      'a thrown playbackRate(0) override must surface as an explicit failure fact, never read like a fully successful freeze',
    );

    const meta = readJson(path.join(dir, 'meta.json'));
    assert.equal(meta.freezeOverrideApplied, false);

    const rateZeroCalls = client.calls.filter(
      (c) => c.method === 'Animation.setPlaybackRate' && (c.params as { playbackRate?: number } | undefined)?.playbackRate === 0,
    );
    assert.equal(rateZeroCalls.length, 1, 'the browser-wide override must actually have been attempted (proving the false marker reflects a real attempted-and-failed override)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// GREEN happy-path companion: proves the `false` marker above isn't
// hardcoded — a genuinely successful override reports no
// `freezeOverrideApplied` field at all (the affirmative case stays
// unmarked, exactly like every other honesty marker in this remediation).
test('#8 positive control: a successful playbackRate(0) override reports no freezeOverrideApplied marker', async () => {
  const dir = freshSnapDir('freeze-override-succeeds');
  const client = new StubCdpClient('freeze');
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 300,
      pollIntervalMs: 20,
      freezeAnimations: true,
    });

    assert.equal(result.meta.freezeOverrideApplied, undefined);
    const meta = readJson(path.join(dir, 'meta.json'));
    assert.equal('freezeOverrideApplied' in meta, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// CHILD 6 fix pass (#72): a per-animation `.pause()` call inside
// FREEZE_ANIMATIONS_SCRIPT can fail even though the origin-capture walk
// itself, and the browser-wide `Animation.setPlaybackRate(0)` override,
// both succeed — that animation is left running through the frozen
// baseline capture. `AnimationFreezeHandle.freezeIncomplete`/
// `unfrozenCount` already carry this fact on the in-memory handle (settle.ts);
// this proves it reaches the emitted `meta.json` artifact, not just the
// handle.
//
// MUST FAIL PRE-FIX: pre-fix, `captureSnapshotSubstrate` never read
// `animationFreezeHandle?.freezeIncomplete`/`?.unfrozenCount` at all —
// `meta.json` had no `freezeIncomplete` field, so `result.meta.freezeIncomplete`
// would be `undefined` (the field didn't exist), not the expected `true`.
test('#72: a per-animation pause failure surfaces meta.freezeIncomplete:true and unfrozenCount honestly', async () => {
  const dir = freshSnapDir('freeze-incomplete');
  const client = new StubCdpClient('freeze', undefined, false, 1);
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 300,
      pollIntervalMs: 20,
      freezeAnimations: true,
    });

    assert.equal(
      result.meta.freezeIncomplete,
      true,
      'a per-animation pause failure must surface as an explicit meta.json fact, never silently dropped',
    );
    assert.equal(result.meta.unfrozenCount, 1, 'the pause-failure tally must reach meta.json alongside the incomplete marker');

    const meta = readJson(path.join(dir, 'meta.json'));
    assert.equal(meta.freezeIncomplete, true);
    assert.equal(meta.unfrozenCount, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// GREEN positive control: proves the #72 marker above isn't hardcoded — a
// genuinely clean freeze (every enumerated animation confirmed paused)
// reports no `freezeIncomplete`/`unfrozenCount` fields at all (the
// affirmative case stays unmarked, exactly like `freezeOverrideApplied`
// above).
test('#72 positive control: a clean freeze reports no freezeIncomplete marker', async () => {
  const dir = freshSnapDir('freeze-complete');
  const client = new StubCdpClient('freeze');
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 300,
      pollIntervalMs: 20,
      freezeAnimations: true,
    });

    assert.equal(result.meta.freezeIncomplete, undefined);
    assert.equal(result.meta.unfrozenCount, undefined);
    const meta = readJson(path.join(dir, 'meta.json'));
    assert.equal('freezeIncomplete' in meta, false);
    assert.equal('unfrozenCount' in meta, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// 6. pollForSettle — pure unit tests
// ============================================================================

test('pollForSettle: two consecutive equal quiet-enough signatures settle at sampleCount 2', async () => {
  const result = await pollForSettle<string>({
    captureSample: async () => ({ signature: 'sig', quietMs: 1000 }),
    isEqual: (a, b) => a === b,
    settleTimeoutMs: 5000,
    quietThresholdMs: 300,
    now: () => 0,
    sleep: async () => {},
  });
  assert.equal(result.settled, true);
  assert.equal(result.sampleCount, 2);
});

test('pollForSettle: ever-changing signatures time out unsettled', async () => {
  let n = 0;
  let clock = 0;
  const result = await pollForSettle<string>({
    captureSample: async () => {
      n += 1;
      return { signature: `sig-${n}`, quietMs: 1000 };
    },
    isEqual: (a, b) => a === b,
    settleTimeoutMs: 100,
    quietThresholdMs: 300,
    now: () => {
      clock += 50;
      return clock;
    },
    sleep: async () => {},
  });
  assert.equal(result.settled, false);
  assert.ok(result.elapsedMs >= 100);
});

test('pollForSettle: equal signatures but quiet below threshold keep polling until timeout', async () => {
  let clock = 0;
  const result = await pollForSettle<string>({
    captureSample: async () => ({ signature: 'sig', quietMs: 10 }),
    isEqual: (a, b) => a === b,
    settleTimeoutMs: 100,
    quietThresholdMs: 300,
    now: () => {
      clock += 50;
      return clock;
    },
    sleep: async () => {},
  });
  assert.equal(result.settled, false);
});

test('pollForSettle: a matching+quiet sample that arrives after the deadline does not settle', async () => {
  // now() is called once for `start`, then once per sample to compute
  // elapsed. Sequence: start=0, after sample #1 elapsed=50 (< 100ms
  // timeout, so the loop keeps going), after sample #2 elapsed=150 (>
  // 100ms timeout). Both samples report the SAME signature and
  // quietMs=1000 (>= the 300ms threshold), so sample #2 would be accepted
  // as "settled" by a version of pollForSettle that doesn't check the
  // deadline before trusting the settled predicate — exactly the Major 1
  // bug. This must return settled:false.
  const nowValues = [0, 50, 150];
  let callIndex = 0;
  const result = await pollForSettle<string>({
    captureSample: async () => ({ signature: 'sig', quietMs: 1000 }),
    isEqual: (a, b) => a === b,
    settleTimeoutMs: 100,
    quietThresholdMs: 300,
    now: () => {
      const value = nowValues[callIndex] ?? nowValues[nowValues.length - 1];
      callIndex += 1;
      return value;
    },
    sleep: async () => {},
  });
  assert.equal(result.settled, false);
  assert.equal(result.sampleCount, 2);
  assert.equal(result.elapsedMs, 150);
});

// ============================================================================
// 7. churn evidence and groupChurnEvidence
// ============================================================================

test('collectChurnEvidence releases each distinct mutation-target remote object after identity resolution', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = {
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      calls.push({ method, params });
      if (method === 'Runtime.callFunctionOn') {
        const declaration = String(params.functionDeclaration ?? '');
        if (declaration.includes('__captureSettleTeardown')) {
          return { result: { value: { mutations: [
            { t: 1, type: 'attributes', selector: '#first' },
            { t: 2, type: 'attributes', selector: '#also-first' },
            { t: 3, type: 'childList', selector: '#second' },
          ], resizeCount: 0 } } };
        }
        if (declaration.includes('mutations.map')) return { result: { objectId: 'mutation-targets' } };
      }
      if (method === 'Runtime.getProperties') {
        assert.equal(params.objectId, 'mutation-targets');
        assert.equal(params.ownProperties, true, 'identity resolution must read own properties only, never the prototype chain');
        return {
          result: [
            { name: '0', value: { objectId: 'target-first' }, get: { objectId: 'target-getter' }, set: { objectId: 'target-setter' }, symbol: { objectId: 'target-symbol' } },
            { name: '1', value: { objectId: 'target-first' } },
            { name: '2', value: { objectId: 'target-second' } },
          ],
          internalProperties: [{ name: '[[Prototype]]', value: { objectId: 'array-prototype' } }],
          privateProperties: [{ name: '#targetCache', value: { objectId: 'target-cache' } }],
        };
      }
      if (method === 'DOM.describeNode') {
        return { node: { backendNodeId: params.objectId === 'target-first' ? 101 : 202 } };
      }
      return {};
    },
  } as unknown as CDPClient;

  const evidence = await collectChurnEvidence(client, { stateObjectId: 'settle-state' });

  assert.deepEqual(evidence.mutations.map((mutation) => mutation.backendNodeId), [101, 101, 202]);
  assert.deepEqual(
    calls.filter((call) => call.method === 'Runtime.releaseObject').map((call) => call.params.objectId),
    ['target-first', 'target-getter', 'target-setter', 'target-symbol', 'target-second', 'array-prototype', 'target-cache', 'mutation-targets', 'settle-state'],
  );
});

test('collectChurnEvidence releases the targets handle and returns selector-only mutations when getProperties throws', async () => {
  const releases: string[] = [];
  const client = {
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      if (method === 'Runtime.callFunctionOn') {
        const declaration = String(params.functionDeclaration ?? '');
        if (declaration.includes('__captureSettleTeardown')) {
          return { result: { value: { mutations: [{ t: 1, type: 'attributes', selector: '#first' }], resizeCount: 0 } } };
        }
        if (declaration.includes('mutations.map')) return { result: { objectId: 'mutation-targets' } };
      }
      if (method === 'Runtime.getProperties') throw new Error('stub: getProperties transport failure');
      if (method === 'Runtime.releaseObject') {
        releases.push(String(params.objectId));
        return {};
      }
      return {};
    },
  } as unknown as CDPClient;

  const evidence = await collectChurnEvidence(client, { stateObjectId: 'settle-state' });

  // Identity enrichment threw before any node was described, so the mutation
  // stays selector-only rather than the whole collection aborting.
  assert.deepEqual(evidence.mutations.map((mutation) => mutation.backendNodeId), [undefined]);
  assert.equal(evidence.mutations[0]?.selector, '#first');
  // The held targets-array handle and the state handle are still released.
  assert.ok(releases.includes('mutation-targets'), 'the targets-array handle is released even when getProperties throws');
  assert.ok(releases.includes('settle-state'), 'the state handle is always released');
});

test('collectChurnEvidence salvages the remaining nodes and releases every handle when one describeNode throws', async () => {
  const releases: string[] = [];
  const client = {
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      if (method === 'Runtime.callFunctionOn') {
        const declaration = String(params.functionDeclaration ?? '');
        if (declaration.includes('__captureSettleTeardown')) {
          return { result: { value: { mutations: [
            { t: 1, type: 'attributes', selector: '#first' },
            { t: 2, type: 'childList', selector: '#second' },
          ], resizeCount: 0 } } };
        }
        if (declaration.includes('mutations.map')) return { result: { objectId: 'mutation-targets' } };
      }
      if (method === 'Runtime.getProperties') {
        return {
          result: [
            { name: '0', value: { objectId: 'target-first' } },
            { name: '1', value: { objectId: 'target-second' } },
          ],
        };
      }
      if (method === 'DOM.describeNode') {
        if (params.objectId === 'target-first') throw new Error('stub: describeNode failure for one node');
        return { node: { backendNodeId: 303 } };
      }
      if (method === 'Runtime.releaseObject') {
        releases.push(String(params.objectId));
        return {};
      }
      return {};
    },
  } as unknown as CDPClient;

  const evidence = await collectChurnEvidence(client, { stateObjectId: 'settle-state' });

  // The failed node stays selector-only; the other still resolves its identity.
  assert.deepEqual(evidence.mutations.map((mutation) => mutation.backendNodeId), [undefined, 303]);
  // Every collected child handle, the targets container, and the state handle are released.
  assert.deepEqual(
    releases.slice().sort(),
    ['mutation-targets', 'settle-state', 'target-first', 'target-second'],
    'a describeNode failure still releases every collected remote object',
  );
});

test('groupChurnEvidence groups mutation regions by selector, then appends running-infinite animation regions', () => {
  const raw = {
    mutations: [
      { t: 10, type: 'childList', selector: '.ad-slot' },
      { t: 20, type: 'attributes', selector: '.toast' },
    ],
    resizeCount: 1,
  };
  const animationEvidence = {
    animations: [
      { selector: '.carousel', animationName: 'slide', durationMs: 3200, iterationCount: 'infinite' as const, infinite: true, playState: 'running' },
      { selector: '.badge', animationName: 'pulse', durationMs: 500, iterationCount: 3, infinite: false, playState: 'finished' },
    ],
    infiniteCount: 1,
  };

  const { report, unstableRegions } = groupChurnEvidence(raw, animationEvidence, 1234, 5000);

  assert.equal(report.regions.length, 3, 'expected 2 mutation regions + 1 running-infinite animation region (finished animation excluded)');
  assert.equal(unstableRegions.length, 3);
  assert.deepEqual(
    report.regions.map((r) => r.id),
    unstableRegions.map((r) => r.id),
  );

  const adRegion = report.regions.find((r) => r.selector === '.ad-slot');
  assert.equal(adRegion?.mutationCount, 1);
  const toastRegion = report.regions.find((r) => r.selector === '.toast');
  assert.equal(toastRegion?.mutationCount, 1);
  const carouselRegion = report.regions.find((r) => r.selector === '.carousel');
  assert.ok(carouselRegion, 'expected an animation-sourced region for the running infinite animation');
  assert.ok(!report.regions.some((r) => r.selector === '.badge'), 'the finished (non-infinite) animation must not produce a region');

  assert.equal(report.totalMutations, 2);
  assert.equal(report.resizeCount, 1);
  assert.equal(report.settled, false);
  assert.equal(report.settleTimeoutMs, 5000);
  assert.equal(report.elapsedMs, 1234);
});

test('groupChurnEvidence persists mutation-target backend identities for exact downstream caveat joins', () => {
  const { unstableRegions } = groupChurnEvidence({
    mutations: [
      { t: 10, type: 'attributes', selector: 'div#foo.bar.target', backendNodeId: 2 },
      { t: 20, type: 'attributes', selector: 'div.notice.banner.pinned.transient', backendNodeId: 4 },
    ],
    resizeCount: 0,
  }, { animations: [], infiniteCount: 0 }, 100, 5000);

  assert.deepEqual(unstableRegions.map((region) => region.elementIds), [['2'], ['4']]);
});

test('groupChurnEvidence coalesces same-backendNodeId mutations with different selectors into one region', () => {
  const { report, unstableRegions } = groupChurnEvidence({
    mutations: [
      { t: 10, type: 'attributes', selector: 'div#foo.bar', backendNodeId: 7 },
      { t: 20, type: 'childList', selector: 'div#foo.bar.mutated', backendNodeId: 7 },
    ],
    resizeCount: 0,
  }, { animations: [], infiniteCount: 0 }, 100, 5000);

  // One stable backend identity across two selectors collapses to a single
  // backendNodeId-keyed region, not two selector-keyed ones.
  assert.equal(report.regions.length, 1);
  assert.equal(report.regions[0]?.mutationCount, 2);
  assert.deepEqual(unstableRegions.map((region) => region.elementIds), [['7']]);
});

// ============================================================================
// 9. Phase model — mutating collectors run only after baseline finishes and
// after the baseline artifacts (screenshot.png + dom.html) are captured.
// ============================================================================

test('mutating collectors run only after baseline finishes and after screenshot+dom capture', async () => {
  const dir = freshSnapDir('phase-order');
  const client = new StubCdpClient('stable');
  const events: string[] = [];
  client.phaseEvents = events;

  // A baseline collector that resolves after a delay proves the
  // orchestrator waits for the whole baseline phase before the boundary; a
  // mutating collector that also delays proves the mutating phase is
  // serialized (a later, no-delay mutating collector cannot overtake it).
  const makeCollector = (name: string, delayMs: number): Collector => async () => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    events.push(name);
  };
  const collectors: CollectorDescriptor[] = [
    { name: 'baseline-slow', phase: 'baseline', fn: makeCollector('baseline-slow', 40) },
    { name: 'baseline-fast', phase: 'baseline', fn: makeCollector('baseline-fast', 5) },
    { name: 'mutating-slow', phase: 'mutating', fn: makeCollector('mutating-slow', 30) },
    { name: 'mutating-fast', phase: 'mutating', fn: makeCollector('mutating-fast', 0) },
  ];

  try {
    await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 500,
      pollIntervalMs: 20,
      collectors,
    });

    const idx = (name: string) => events.indexOf(name);
    assert.ok(idx('baseline-slow') >= 0 && idx('baseline-fast') >= 0, 'both baseline collectors ran');
    assert.ok(idx('screenshot') >= 0 && idx('dom-capture') >= 0, 'baseline artifacts captured');
    assert.ok(idx('mutating-slow') >= 0 && idx('mutating-fast') >= 0, 'both mutating collectors ran');

    // Every baseline collector completes before either baseline artifact is captured.
    assert.ok(idx('baseline-slow') < idx('screenshot'), 'baseline-slow finished before screenshot');
    assert.ok(idx('baseline-fast') < idx('screenshot'), 'baseline-fast finished before screenshot');
    assert.ok(idx('baseline-slow') < idx('dom-capture'), 'baseline-slow finished before dom capture');

    // No mutating collector runs before both baseline artifacts are captured.
    assert.ok(idx('screenshot') < idx('mutating-slow'), 'screenshot captured before mutating-slow');
    assert.ok(idx('screenshot') < idx('mutating-fast'), 'screenshot captured before mutating-fast');
    assert.ok(idx('dom-capture') < idx('mutating-slow'), 'dom captured before mutating-slow');
    assert.ok(idx('dom-capture') < idx('mutating-fast'), 'dom captured before mutating-fast');

    // Mutating phase is serialized in descriptor order: the slow mutating
    // collector completes before the fast one starts, even though the fast
    // one has no delay (parallel execution would let it finish first).
    assert.ok(idx('mutating-slow') < idx('mutating-fast'), 'mutating collectors ran serialized, in order');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// 10. D-block real-Chrome: the churn-observer state must never be assigned
// to `window.__captureSettle` (or any other page-observable location) at
// any point in its lifecycle — bootstrap, sample, or teardown.
// ============================================================================


async function rcNewPageTarget(port: number): Promise<string> {
  const resp = await fetch(`http://localhost:${port}/json/new?about:blank`, { method: 'PUT' });
  const json = (await resp.json()) as { webSocketDebuggerUrl?: string };
  if (!json.webSocketDebuggerUrl) throw new Error('no webSocketDebuggerUrl in /json/new response');
  return json.webSocketDebuggerUrl;
}

// A page that predefines a setter for `window.__captureSettle` (the exact
// global the pre-fix BOOTSTRAP/SAMPLE/TEARDOWN scripts read/wrote) and
// records every firing into `window.__setterFired`. Also carries a mutable
// `#churn` node so the real churn-observer lifecycle has real DOM mutations
// to record.
const RC_SETTLE_SETTER_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;font:16px sans-serif;">
<div id="churn">initial</div>
<script>
  window.__setterFired = [];
  Object.defineProperty(window, '__captureSettle', {
    configurable: true,
    set: function () { window.__setterFired.push('__captureSettle'); },
    get: function () { return undefined; },
  });
</script>
</body></html>`;

const RC_SETTLE_SETTER_FIXTURE_URL = `data:text/html,${encodeURIComponent(RC_SETTLE_SETTER_FIXTURE_HTML)}`;

async function rcWaitForSettleSetterFixtureReady(client: CDPClient, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await client.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && Array.isArray(window.__setterFired)`,
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (res.result?.value) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('settle setter contamination fixture page did not become ready in time');
}

async function rcReadSetterFired(client: CDPClient): Promise<string[]> {
  const res = (await client.send('Runtime.evaluate', {
    expression: 'window.__setterFired',
    returnByValue: true,
  })) as { result?: { value?: string[] } };
  return res.result?.value ?? [];
}

describe('D10 real-Chrome: the churn-observer lifecycle never triggers a page-defined __captureSettle setter', liveChromeOpts, () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;
    const wsUrl = await rcNewPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
    await client.send('Page.navigate', { url: RC_SETTLE_SETTER_FIXTURE_URL });
    await rcWaitForSettleSetterFixtureReady(client);
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

  test('positive control: the recorder DOES catch a manually reintroduced window.__captureSettle assignment — the exact pre-fix reproduction', async () => {
    if (!client) throw new Error('client not ready');
    // Reintroduces the EXACT assignment the pre-fix BOOTSTRAP_SCRIPT used
    // (`window.__captureSettle = state;`), against the live fixture's
    // predefined setter, with nothing else changed. If the recorder doesn't
    // catch this, the negative result below would prove nothing.
    await client.send('Runtime.evaluate', { expression: 'window.__captureSettle = {};', returnByValue: true });
    const fired = await rcReadSetterFired(client);
    assert.ok(fired.includes('__captureSettle'), 'the recorder must catch a manually reintroduced __captureSettle assignment');

    // Reset the recorder for the real assertions below.
    await client.send('Runtime.evaluate', { expression: 'window.__setterFired = [];', returnByValue: true });
  });

  test('the real churn-observer lifecycle (inject → sample → mutate → sample → teardown) never triggers the __captureSettle setter, while still producing real samples and churn evidence', async () => {
    if (!client) throw new Error('client not ready');
    const c = client;

    const handle = await injectChurnObservers(c);
    assert.equal(typeof handle.stateObjectId, 'string');
    assert.ok(handle.stateObjectId.length > 0);

    const sample = buildDomSettleSampler(c, handle);

    const first = await sample();
    assert.equal(typeof first.signature, 'string');
    assert.equal(typeof first.quietMs, 'number');

    // Cause a real DOM mutation for the MutationObserver to pick up.
    await c.send('Runtime.evaluate', {
      expression: `document.getElementById('churn').textContent = 'mutated';`,
      returnByValue: true,
    });
    // Give the MutationObserver's microtask a turn to fire before sampling again.
    await new Promise((r) => setTimeout(r, 50));

    const second = await sample();
    assert.equal(typeof second.signature, 'string');
    assert.ok(!domSignaturesEqual(first.signature, second.signature), 'the mutation must change the settle signature');

    const evidence = await collectChurnEvidence(c, handle);
    assert.ok(evidence.mutations.length > 0, 'the real MutationObserver must have recorded the DOM mutation');
    assert.ok(
      evidence.mutations.some((m) => m.selector && m.selector.includes('churn')),
      'the recorded mutation must reference the mutated #churn element',
    );
    assert.ok(
      evidence.mutations.some((m) => typeof m.backendNodeId === 'number'),
      'the held mutation target must resolve to a stable CDP backend node identity',
    );

    const fired = await rcReadSetterFired(c);
    assert.deepEqual(
      fired,
      [],
      'the churn-observer lifecycle must never assign to window.__captureSettle (or trigger any page-defined setter for it)',
    );
  });

  test('pollForSettle over the real churn-observer lifecycle settles once mutations stop, without ever triggering the setter', async () => {
    if (!client) throw new Error('client not ready');
    const c = client;

    await c.send('Runtime.evaluate', { expression: 'window.__setterFired = [];', returnByValue: true });

    const handle = await injectChurnObservers(c);
    const result = await pollForSettle({
      captureSample: buildDomSettleSampler(c, handle),
      isEqual: domSignaturesEqual,
      settleTimeoutMs: 1000,
      quietThresholdMs: 150,
      pollIntervalMs: 50,
    });
    await collectChurnEvidence(c, handle);

    assert.equal(result.settled, true, 'a quiescent fixture page must settle');

    const fired = await rcReadSetterFired(c);
    assert.deepEqual(fired, [], 'polling to settle must never trigger the __captureSettle setter');
  });
});
