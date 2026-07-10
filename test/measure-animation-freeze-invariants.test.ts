/**
 * Adversarial coverage for the C5 animation/settle/freeze invariant
 * remediation (Findings A, C, D — see
 * `/Users/silasrhyneer/.crouter/canvas/nodes/mrds1g6k-2fbb5e94/context/handoff-animation-freeze-remediation.md`).
 * Every stub `CDPClient` in this file is written locally (NOT imported
 * from `test/snapshot-settledness.test.ts` or `test/measure-maps-substrate.test.ts`
 * — both are protected shared test files) and follows the same
 * `.includes(...)`-marker-matching pattern those files established.
 *
 * Finding A (I-6, exception-safe animation restoration) is driven through
 * `captureSnapshotSubstrate` with a minimal single fake `CollectorDescriptor`
 * (`options.collectors` override), not through settle.ts in isolation, so
 * the assertions exercise the real orchestration wiring.
 *
 * Finding C (I-5) covers two independent facts: `animation.json`'s new
 * `available`/`unavailableReason` pair (via `collectAnimation` directly),
 * and `churn.json`'s new `mutationsTruncated` fact (via the pure
 * `groupChurnEvidence`, no CDP at all).
 *
 * Finding D (I-3) needs a real Chrome/Chromium binary — no stub can fake
 * CDP's own `objectId`->`backendNodeId` bridge credibly enough to prove
 * real node-identity equality across two independently-run collectors.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

import { CAPTURE_ROOT } from '../src/session/artifacts.js';
import { CDPClient } from '../src/cdp/client.js';
import { enableDomainsForSnap } from '../src/cdp/domains.js';
import { captureSnapshotSubstrate } from '../src/cdp/measure/snapshot.js';
import {
  groupChurnEvidence,
  collectChurnEvidence,
  collectAnimationEvidence,
  RESTORE_ANIMATIONS_SCRIPT,
  FREEZE_ANIMATIONS_SCRIPT,
  injectChurnObservers,
  buildDomSettleSampler,
  freezeAnimationsBeforeCapture,
} from '../src/cdp/measure/settle.js';
import type { ChurnEvidenceRaw, ChurnObserverHandle } from '../src/cdp/measure/settle.js';
import { collectAnimation } from '../src/cdp/measure/collectors/animation.js';
import type { AnimationReport } from '../src/cdp/measure/collectors/animation.js';
import { collectGeometry } from '../src/cdp/measure/collectors/geometry.js';
import type { GeometryElementRecord } from '../src/cdp/measure/collectors/geometry.js';
import type { SnapshotContext, SnapshotWriter, AnimationEvidence } from '../src/cdp/measure/types.js';

// A 1x1 transparent PNG, base64-encoded — stands in for `Page.captureScreenshot`'s
// `data` (same literal `test/snapshot-settledness.test.ts` uses; not imported).
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function freshSnapDir(label: string): string {
  return path.join(CAPTURE_ROOT, `measure-animation-freeze-invariants-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function asClient(stub: unknown): CDPClient {
  return stub as unknown as CDPClient;
}

// ============================================================================
// Finding A (I-6) — driven through captureSnapshotSubstrate with a custom
// stub CDPClient, using the NEW held-object freeze/restore shape
// (`settle.ts`'s `freezeAnimationsBeforeCapture`/`restoreAnimationsAfterCapture`):
// the freeze evaluate returns `{result:{objectId}}` (held), and restore is a
// `Runtime.callFunctionOn` on that objectId whose `functionDeclaration`
// includes `__captureRestoreAnimations`. This is a DIFFERENT shape than the
// protected `StubCdpClient` in `test/snapshot-settledness.test.ts`, which
// still answers the freeze evaluate with `{result:{value:true}}` — that
// stub could never exercise this restore path, which is exactly why a new
// stub is required here.
// ============================================================================

class FreezeStubCdpClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  private readonly restoreThrows: boolean;
  // Class C item 1 (I-6): when set, the `__captureFreezeAnimations` origin-
  // capture evaluate fails exactly the way the pre-fix ordering bug could
  // no longer protect against — either the evaluate itself throws, or it
  // round-trips but hands back no held `objectId`. Neither must ever let
  // `Animation.setPlaybackRate({playbackRate:0})` run.
  private readonly freezeEvaluateFails?: 'throws' | 'no-object-id';
  // Class C item 2b (I-6): when set, the browser-wide reset call
  // (`Animation.setPlaybackRate({playbackRate:1})`) throws — but ONLY the
  // reset call (`playbackRate===1`); the initial freeze call
  // (`playbackRate===0`) still succeeds, so this isolates the reset
  // failure from the freeze step.
  private readonly rateResetThrows: boolean;
  // Class C item 2a (I-6): when set, the restore `Runtime.callFunctionOn`
  // itself succeeds at the CDP level but reports the script's own honest
  // `ok:false` (mirrors a real per-animation `.play()` failure inside
  // RESTORE_ANIMATIONS_SCRIPT) instead of throwing outright.
  private readonly restoreReturnsFalse: boolean;
  // CHILD 6 #7 (I-5): when set, the held freeze container's own `ok` flag
  // (read back via `__captureFreezeOriginOk`, the round trip
  // `freezeAnimationsBeforeCapture` now makes right after the origin-
  // capture evaluate) reports `false` — mirrors `FREEZE_ANIMATIONS_SCRIPT`'s
  // own `document.getAnimations()` walk having thrown even though the
  // evaluate itself round-tripped a valid-looking held object. Defaults to
  // answering `true` so every OTHER test in this file (which never varies
  // this) keeps exercising the real freeze/restore path unchanged.
  private readonly freezeOriginNotOk: boolean;
  // CHILD 6 #8 (I-6): when set, the INITIAL browser-wide freeze override
  // (`Animation.setPlaybackRate({playbackRate:0})`) itself throws — distinct
  // from `rateResetThrows`, which only throws on the playbackRate:1 reset.
  private readonly freezeRateApplyThrows: boolean;
  // #72: the count `__captureFreezePauseStatus`'s read-back reports for
  // `pauseFailureCount` — mirrors a real page where N animations' own
  // `.pause()` calls threw inside FREEZE_ANIMATIONS_SCRIPT while the
  // surrounding walk itself still succeeded (`ok:true`). Defaults to `0`
  // (a clean freeze) so every OTHER test in this file keeps exercising the
  // real freeze/restore path unchanged.
  private readonly pauseFailureCount: number;
  // #72: when set, the `__captureFreezePauseStatus` callFunctionOn itself
  // throws — isolates "the tally could not be read back at all" (must be
  // treated pessimistically as incomplete) from "the tally was read back
  // and reports failures" (`pauseFailureCount` above).
  private readonly pauseStatusReadThrows: boolean;

  private static readonly STATE_OBJECT_ID = 'freeze-invariants-test-settle-state';
  // Public (not private) so the restore-throws test below can assert the
  // restore callFunctionOn's `objectId` equals this exact held container,
  // proving the restore acted on the held freeze origin rather than some
  // other/no object.
  static readonly FREEZE_CONTAINER_ID = 'freeze-invariants-test-freeze-container';

  constructor(
    opts: {
      restoreThrows?: boolean;
      freezeEvaluateFails?: 'throws' | 'no-object-id';
      rateResetThrows?: boolean;
      restoreReturnsFalse?: boolean;
      freezeOriginNotOk?: boolean;
      freezeRateApplyThrows?: boolean;
      pauseFailureCount?: number;
      pauseStatusReadThrows?: boolean;
    } = {},
  ) {
    this.restoreThrows = opts.restoreThrows ?? false;
    this.freezeEvaluateFails = opts.freezeEvaluateFails;
    this.rateResetThrows = opts.rateResetThrows ?? false;
    this.restoreReturnsFalse = opts.restoreReturnsFalse ?? false;
    this.freezeOriginNotOk = opts.freezeOriginNotOk ?? false;
    this.freezeRateApplyThrows = opts.freezeRateApplyThrows ?? false;
    this.pauseFailureCount = opts.pauseFailureCount ?? 0;
    this.pauseStatusReadThrows = opts.pauseStatusReadThrows ?? false;
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });

    if (method === 'Animation.setPlaybackRate') {
      if (this.rateResetThrows && (params as { playbackRate?: number }).playbackRate === 1) {
        throw new Error('rate-reset-boom: the browser-wide playbackRate(1) reset failed');
      }
      if (this.freezeRateApplyThrows && (params as { playbackRate?: number }).playbackRate === 0) {
        throw new Error('rate-apply-boom: the browser-wide playbackRate(0) freeze override failed');
      }
      return {};
    }
    if (method === 'Page.captureScreenshot') {
      return { data: ONE_PIXEL_PNG_BASE64 };
    }
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureFreezeAnimations')) {
        if (this.freezeEvaluateFails === 'throws') {
          throw new Error('freeze-evaluate-boom: the origin-capture evaluate itself failed');
        }
        if (this.freezeEvaluateFails === 'no-object-id') {
          // Round-tripped but handed back no held object — same "nothing to
          // restore from" outcome, must equally never trigger the mutation.
          return { result: {} };
        }
        // Held return (returnByValue:false) — the NEW shape freeze/restore
        // uses. The old stub in the protected file returns
        // `{result:{value:true}}` (by-value), which is why it can't be
        // reused: there is no objectId there to restore against.
        return { result: { objectId: FreezeStubCdpClient.FREEZE_CONTAINER_ID } };
      }
      if (expression.includes('__captureSettleBootstrap')) {
        return { result: { objectId: FreezeStubCdpClient.STATE_OBJECT_ID } };
      }
      if (expression === 'document.documentElement.outerHTML') {
        return { result: { value: '<html><body>frozen-fixture</body></html>' } };
      }
      // IFRAME_COUNT_SCRIPT and anything else — a bare returnByValue evaluate.
      return { result: { value: 0 } };
    }
    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      const functionDeclaration = String((params as { functionDeclaration?: unknown }).functionDeclaration ?? '');

      if (objectId === FreezeStubCdpClient.FREEZE_CONTAINER_ID && functionDeclaration.includes('__captureFreezeOriginOk')) {
        return { result: { value: !this.freezeOriginNotOk } };
      }
      if (objectId === FreezeStubCdpClient.FREEZE_CONTAINER_ID && functionDeclaration.includes('__captureFreezePauseStatus')) {
        if (this.pauseStatusReadThrows) {
          throw new Error('pause-status-boom: the pause-failure tally read-back itself failed');
        }
        return { result: { value: { total: 1, pauseFailureCount: this.pauseFailureCount } } };
      }
      if (objectId === FreezeStubCdpClient.FREEZE_CONTAINER_ID && functionDeclaration.includes('__captureRestoreAnimations')) {
        if (this.restoreThrows) {
          throw new Error('restore-boom: the restore callFunctionOn itself failed');
        }
        if (this.restoreReturnsFalse) {
          return { result: { value: false } };
        }
        return { result: { value: true } };
      }
      if (objectId === FreezeStubCdpClient.STATE_OBJECT_ID) {
        if (functionDeclaration.includes('__captureSettleSample')) {
          // Always the same signature and quiet enough — settles on the
          // second sample (mirrors the protected suite's 'stable' scenario).
          return { result: { value: { signature: 'sig-stable', quietMs: 1000 } } };
        }
        if (functionDeclaration.includes('__captureSettleTeardown')) {
          return { result: { value: { mutations: [], resizeCount: 0 } } };
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

// Test 1 — exception safety: a throwing baseline collector must still
// trigger a real restore attempt against the captured freeze origin.
//
// MUST FAIL PRE-FIX: pre-fix, `freezeAnimationsBeforeCapture` returned
// `Promise<void>` and there was no handle/restore call at all — the
// `Runtime.callFunctionOn` restore-call assertion below would find nothing
// to match, and the second `Animation.setPlaybackRate({playbackRate:1})`
// call (the exception-safety net) never happened because `snapshot.ts` had
// no `finally`-guarded restore closure to run it from.
test('captureSnapshotSubstrate: a throwing baseline collector still triggers real animation restoration (Finding A / I-6 exception safety)', async () => {
  const dir = freshSnapDir('exception-safety');
  const client = new FreezeStubCdpClient();
  try {
    await assert.rejects(
      captureSnapshotSubstrate({
        target: { client: asClient(client) },
        url: 'http://example.test',
        path: dir,
        settleTimeout: 500,
        pollIntervalMs: 20,
        freezeAnimations: true,
        collectors: [
          {
            name: 'boom',
            phase: 'baseline',
            fn: async () => {
              throw new Error('boom');
            },
          },
        ],
      }),
      /boom/,
    );

    const restoreCalls = client.calls.filter(
      (c) =>
        c.method === 'Runtime.callFunctionOn' &&
        String((c.params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration ?? '').includes('__captureRestoreAnimations'),
    );
    assert.equal(restoreCalls.length, 1, 'expected the restore callFunctionOn to have been attempted even though the whole capture rejected');
    assert.equal(
      (restoreCalls[0].params as { objectId?: string } | undefined)?.objectId,
      FreezeStubCdpClient.FREEZE_CONTAINER_ID,
      'the restore call must act on the held freeze container, not some other or absent object',
    );

    const rateCalls = client.calls.filter((c) => c.method === 'Animation.setPlaybackRate');
    assert.ok(
      rateCalls.some((c) => (c.params as { playbackRate?: number } | undefined)?.playbackRate === 0),
      'expected the initial browser-wide freeze (playbackRate 0)',
    );
    assert.ok(
      rateCalls.some((c) => (c.params as { playbackRate?: number } | undefined)?.playbackRate === 1),
      'expected the browser-wide reset back to real time (playbackRate 1) as part of the restore attempt',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Test 2 — restore-itself-throws → `restored:false` surfaced honestly. The
// whole capture must complete (not reject); only the internal restore
// attempt fails, and `restoreAnimationsAfterCapture` swallows that per its
// contract ("never throws").
//
// MUST FAIL PRE-FIX: pre-fix there was no `animationsRestored` field on
// `meta.json` at all — `result.meta.animationsRestored` would be
// `undefined`, which `assert.equal(..., false)` rejects (`undefined !== false`).
//
// Strengthened per the C5 review (Minor finding): `animationsRestored`
// defaults to `false` (snapshot.ts:162), so asserting only the false meta
// value would still pass even if the normal restore-before-meta call
// (snapshot.ts:274) were deleted outright. The restore-call-count +
// objectId assertions below close that gap by proving the restore was
// actually attempted against the held freeze container, not merely that
// the field happened to read false.
test('captureSnapshotSubstrate: restore itself throwing surfaces meta.animationsRestored:false honestly, without rejecting the capture (Finding A / I-6 restore-failure honesty)', async () => {
  const dir = freshSnapDir('restore-throws');
  const client = new FreezeStubCdpClient({ restoreThrows: true });
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 500,
      pollIntervalMs: 20,
      freezeAnimations: true,
      collectors: [
        {
          name: 'noop',
          phase: 'baseline',
          fn: async (ctx) => {
            ctx.write.json('noop.json', { ok: true });
          },
        },
      ],
    });

    assert.equal(result.meta.animationsRestored, false, 'a restore-call failure must surface as an honest false, never omitted or true');
    assert.ok(fs.existsSync(path.join(dir, 'noop.json')), 'the fake collector must still have run and written its artifact');
    assert.ok(fs.existsSync(path.join(dir, 'meta.json')));

    const meta = readJson(path.join(dir, 'meta.json'));
    assert.equal(meta.animationsRestored, false);

    const restoreCalls = client.calls.filter(
      (c) =>
        c.method === 'Runtime.callFunctionOn' &&
        String((c.params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration ?? '').includes('__captureRestoreAnimations'),
    );
    assert.equal(
      restoreCalls.length,
      1,
      'the normal restore-before-meta call must actually fire exactly once, proving the false meta value reflects a real attempted-and-failed restore rather than the false default going unexercised',
    );
    assert.equal(
      (restoreCalls[0].params as { objectId?: string } | undefined)?.objectId,
      FreezeStubCdpClient.FREEZE_CONTAINER_ID,
      'the restore call must act on the held freeze container captured at freeze time',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Success companion to the above: when the restore call succeeds,
// `animationsRestored` must surface as an honest `true` — this pins the
// positive path so a removed normal-restore-call can't hide behind the
// `false` default (which the throws-test alone couldn't distinguish from
// a genuinely-fired-and-failed restore).
//
// MUST FAIL PRE-FIX: pre-fix `animationsRestored` didn't exist on `meta.json`
// at all — `result.meta.animationsRestored` would be `undefined`, not `true`.
test('captureSnapshotSubstrate: a successful restore surfaces meta.animationsRestored:true (Finding A / I-6 restore-success positive path)', async () => {
  const dir = freshSnapDir('restore-succeeds');
  const client = new FreezeStubCdpClient({ restoreThrows: false });
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 500,
      pollIntervalMs: 20,
      freezeAnimations: true,
      collectors: [
        {
          name: 'noop',
          phase: 'baseline',
          fn: async (ctx) => {
            ctx.write.json('noop.json', { ok: true });
          },
        },
      ],
    });

    assert.equal(result.meta.animationsRestored, true, 'a successful restore call must surface as an honest true');
    const meta = readJson(path.join(dir, 'meta.json'));
    assert.equal(meta.animationsRestored, true);

    const restoreCalls = client.calls.filter(
      (c) =>
        c.method === 'Runtime.callFunctionOn' &&
        String((c.params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration ?? '').includes('__captureRestoreAnimations'),
    );
    assert.equal(restoreCalls.length, 1, 'expected exactly one restore attempt on the success path');
    assert.equal(
      (restoreCalls[0].params as { objectId?: string } | undefined)?.objectId,
      FreezeStubCdpClient.FREEZE_CONTAINER_ID,
      'the restore call must act on the held freeze container captured at freeze time',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Class C item 1 (I-6 honesty sweep r4): the origin-capture evaluate
// (`__captureFreezeAnimations`) is now acquired BEFORE the browser-wide
// `Animation.setPlaybackRate({playbackRate:0})` mutation — so when that
// evaluate fails (throws, or round-trips with no held objectId), the
// mutation must NEVER run at all. Pre-fix, `setPlaybackRate(0)` ran
// UNCONDITIONALLY before the evaluate, so this call WOULD be present
// pre-fix even on a failed origin capture.
// ============================================================================

// MUST FAIL PRE-FIX: pre-fix ordering called `Animation.setPlaybackRate({
// playbackRate:0})` first, unconditionally, THEN attempted the origin-
// capture evaluate — so even though the evaluate throwing here, the
// playbackRate:0 call would already be present in `client.calls` by the
// time this assertion runs. Post-fix, the evaluate is attempted FIRST and
// its failure returns `undefined` without ever touching setPlaybackRate.
test('captureSnapshotSubstrate: the freeze origin-capture evaluate throwing never triggers Animation.setPlaybackRate(0) (Class C item 1 / I-6 ordering)', async () => {
  const dir = freshSnapDir('freeze-evaluate-throws');
  const client = new FreezeStubCdpClient({ freezeEvaluateFails: 'throws' });
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 500,
      pollIntervalMs: 20,
      freezeAnimations: true,
      collectors: [
        {
          name: 'noop',
          phase: 'baseline',
          fn: async (ctx) => {
            ctx.write.json('noop.json', { ok: true });
          },
        },
      ],
    });

    const freezeRateCalls = client.calls.filter(
      (c) => c.method === 'Animation.setPlaybackRate' && (c.params as { playbackRate?: number } | undefined)?.playbackRate === 0,
    );
    assert.equal(
      freezeRateCalls.length,
      0,
      'a failed origin-capture evaluate must never let the browser-wide playbackRate(0) freeze run — nothing may be mutated on a failed freeze attempt',
    );

    // Pessimistic default per freezeAnimationsBeforeCapture's own contract:
    // "restoration cannot be guaranteed" when no handle was ever acquired.
    assert.equal(result.meta.animationsRestored, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('captureSnapshotSubstrate: the freeze origin-capture evaluate returning no held object never triggers Animation.setPlaybackRate(0) (Class C item 1 / I-6 ordering)', async () => {
  const dir = freshSnapDir('freeze-evaluate-no-object');
  const client = new FreezeStubCdpClient({ freezeEvaluateFails: 'no-object-id' });
  try {
    await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 500,
      pollIntervalMs: 20,
      freezeAnimations: true,
      collectors: [
        {
          name: 'noop',
          phase: 'baseline',
          fn: async (ctx) => {
            ctx.write.json('noop.json', { ok: true });
          },
        },
      ],
    });

    const freezeRateCalls = client.calls.filter(
      (c) => c.method === 'Animation.setPlaybackRate' && (c.params as { playbackRate?: number } | undefined)?.playbackRate === 0,
    );
    assert.equal(freezeRateCalls.length, 0, 'a no-objectId origin-capture round trip must never let the browser-wide playbackRate(0) freeze run');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// GREEN happy-path companion: proves the assertion above is a genuine
// toggle, not vacuously true because setPlaybackRate(0) is never called at
// all — on a successful origin capture, the freeze mutation MUST still run.
test('captureSnapshotSubstrate: a successful freeze origin-capture DOES trigger Animation.setPlaybackRate(0) (Class C item 1 happy-path companion)', async () => {
  const dir = freshSnapDir('freeze-evaluate-succeeds');
  const client = new FreezeStubCdpClient();
  try {
    await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 500,
      pollIntervalMs: 20,
      freezeAnimations: true,
      collectors: [
        {
          name: 'noop',
          phase: 'baseline',
          fn: async (ctx) => {
            ctx.write.json('noop.json', { ok: true });
          },
        },
      ],
    });

    const freezeRateCalls = client.calls.filter(
      (c) => c.method === 'Animation.setPlaybackRate' && (c.params as { playbackRate?: number } | undefined)?.playbackRate === 0,
    );
    assert.equal(freezeRateCalls.length, 1, 'a successful origin capture must still trigger exactly one playbackRate(0) freeze call');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Class C item 2 (I-6 honesty sweep r4): `restoreAnimationsAfterCapture`
// must return `restored:true` ONLY when EVERY restorative step truly
// succeeded — both (a) the per-animation `.play()` restore
// (RESTORE_ANIMATIONS_SCRIPT's own honest `ok` return, simulated here at
// the callFunctionOn level) AND (b) the browser-wide
// `Animation.setPlaybackRate({playbackRate:1})` reset.
// ============================================================================

// MUST FAIL PRE-FIX: pre-fix, RESTORE_ANIMATIONS_SCRIPT always returned an
// unconditional `true` regardless of any per-animation `.play()` failure,
// so a callFunctionOn result of `false` here (simulating the script
// honestly reporting a failure) would never have been possible to drive
// pre-fix at all — and even if it somehow returned false, the pre-fix
// wrapper had no `playRestored &&` gate, it just did
// `catch { playRestored = false }` around a THROW, never a `=== true`
// check against a returned `false`. Post-fix, `restoreAnimationsAfterCapture`
// gates on `(... ) === true`, so a script-reported `false` correctly flips
// `restored:false`.
test('captureSnapshotSubstrate: the restore script honestly reporting ok:false surfaces meta.animationsRestored:false (Class C item 2a / per-.play()-failure honesty)', async () => {
  const dir = freshSnapDir('restore-script-false');
  const client = new FreezeStubCdpClient({ restoreReturnsFalse: true });
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 500,
      pollIntervalMs: 20,
      freezeAnimations: true,
      collectors: [
        {
          name: 'noop',
          phase: 'baseline',
          fn: async (ctx) => {
            ctx.write.json('noop.json', { ok: true });
          },
        },
      ],
    });

    assert.equal(result.meta.animationsRestored, false, 'a script-reported restore failure must surface as an honest false, never true');
    const meta = readJson(path.join(dir, 'meta.json'));
    assert.equal(meta.animationsRestored, false);

    const restoreCalls = client.calls.filter(
      (c) =>
        c.method === 'Runtime.callFunctionOn' &&
        String((c.params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration ?? '').includes('__captureRestoreAnimations'),
    );
    assert.equal(restoreCalls.length, 1, 'the restore callFunctionOn must actually have been attempted');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------
// Review finding (r4 self-review, Major): the item 2a test above only
// drives the WRAPPER's handling of a pre-fabricated `false` from the
// stub's `Runtime.callFunctionOn` — it never executes
// RESTORE_ANIMATIONS_SCRIPT's own body, so it cannot distinguish the
// actual source fix (a per-`.play()` failure inside the script flips its
// own `ok` to `false`) from a hypothetical revert of that script back to
// its pre-fix unconditional `return true` (the stub would still hand back
// `false` regardless, since the stub controls the return value directly).
// This drives the REAL script body — exported as `RESTORE_ANIMATIONS_SCRIPT`
// for exactly this purpose — via `new Function`, exactly mirroring how CDP
// itself evaluates it as a `functionDeclaration` bound to a held `this`.
// ----------------------------------------------------------------------

function buildRestoreFn(): (this: { anims: Array<{ play(): void }>; origin: string[] }) => boolean {
  // Wrapping in parens forces expression (not statement) context — the
  // script string is `/* comment */ function() {...}`, a bare anonymous
  // function expression, exactly as CDP's own `functionDeclaration`
  // contract expects (see `callOnHeld`'s `Runtime.callFunctionOn` call).
  // eslint-disable-next-line no-new-func
  return new Function(`return (${RESTORE_ANIMATIONS_SCRIPT})`)() as (this: {
    anims: Array<{ play(): void }>;
    origin: string[];
  }) => boolean;
}

// MUST FAIL PRE-FIX: the pre-fix script swallowed every per-animation
// `.play()` failure into an unconditional `return true` — this fake `this`
// has one `running`-origin animation whose `.play()` throws, so the
// pre-fix script would return `true` here; only the fixed script (which
// flips its own `ok` to `false` inside the per-animation catch) returns
// `false`.
test('RESTORE_ANIMATIONS_SCRIPT (real script body): a single .play() failure among running-origin animations makes the script itself return false (Class C item 2a / script-level honesty)', () => {
  const restoreFn = buildRestoreFn();
  const fakeThis = {
    anims: [
      { play: () => {} },
      {
        play: () => {
          throw new Error('play() boom');
        },
      },
    ],
    origin: ['running', 'running'],
  };

  const result = restoreFn.call(fakeThis);
  assert.equal(result, false, 'the script itself must report false when any running-origin animation fails to .play() back');
});

// GREEN happy-path companion: proves the script-level `false` above isn't
// hardcoded — when every running-origin animation's `.play()` genuinely
// succeeds, the script reports true.
test('RESTORE_ANIMATIONS_SCRIPT (real script body): all .play() calls succeeding makes the script return true (Class C item 2a happy-path companion)', () => {
  const restoreFn = buildRestoreFn();
  const fakeThis = {
    anims: [{ play: () => {} }, { play: () => {} }],
    origin: ['running', 'running'],
  };

  const result = restoreFn.call(fakeThis);
  assert.equal(result, true);
});

// Also proves a non-'running' origin is correctly SKIPPED (never .play()'d
// back), and that skipping it does not itself count as a failure.
test('RESTORE_ANIMATIONS_SCRIPT (real script body): a non-running origin animation is skipped, not restored, and does not cause a false result', () => {
  const restoreFn = buildRestoreFn();
  let pausedPlayCalled = false;
  const fakeThis = {
    anims: [
      { play: () => {} },
      {
        play: () => {
          pausedPlayCalled = true;
        },
      },
    ],
    origin: ['running', 'paused'],
  };

  const result = restoreFn.call(fakeThis);
  assert.equal(result, true);
  assert.equal(pausedPlayCalled, false, 'an animation whose origin playState was not running must never be .play()-restored');
});

// ----------------------------------------------------------------------
// #72 -- FREEZE_ANIMATIONS_SCRIPT must track PER-ANIMATION `.pause()`
// failures instead of swallowing them, and RESTORE_ANIMATIONS_SCRIPT must
// never claim to have "restored" an animation that was never actually
// paused. Drives the REAL script bodies (via `new Function`, mirroring
// `buildRestoreFn` above), not stub-fabricated outcomes -- a stub can only
// fake what `Runtime.evaluate`/`callFunctionOn` returns, never exercise
// the script's own per-`.pause()` catch logic.
// ----------------------------------------------------------------------

function buildFreezeFn(): () => { anims: unknown[]; origin: string[]; paused: boolean[]; pauseFailureCount: number; ok: boolean } {
  // FREEZE_ANIMATIONS_SCRIPT is a self-invoking `(function() {...})();` --
  // unlike RESTORE_ANIMATIONS_SCRIPT's bare function expression, wrapping
  // it in `new Function('return (' + script + ')')()` both defines AND
  // immediately calls it, so the returned value IS the script's own return
  // object, not a function reference to call again. The script's own
  // trailing `;` must be stripped first -- `return (<expr>;)` is a syntax
  // error, since a `return (...)` parenthesized expression cannot itself
  // contain a statement-terminating semicolon.
  const expression = FREEZE_ANIMATIONS_SCRIPT.trim().replace(/;\s*$/, '');
  // eslint-disable-next-line no-new-func
  return () => new Function(`return (${expression})`)();
}

// MUST FAIL PRE-FIX: the pre-fix script had no `paused`/`pauseFailureCount`
// fields at all and swallowed a `.pause()` throw with a bare `catch (e) {}`
// -- `result.pauseFailureCount` would be `undefined`, not `1`, and
// `result.paused` would be `undefined`, not `[true, false]`.
test('FREEZE_ANIMATIONS_SCRIPT (real script body): a single .pause() failure is tracked per-animation instead of swallowed (#72)', () => {
  const originalDocument = (globalThis as { document?: unknown }).document;
  try {
    (globalThis as { document?: unknown }).document = {
      getAnimations: () => [
        { playState: 'running', pause: () => {} },
        {
          playState: 'running',
          pause: () => {
            throw new Error('pause() boom -- this animation never actually froze');
          },
        },
      ],
    };
    const freezeFn = buildFreezeFn();
    const result = freezeFn();

    assert.equal(result.ok, true, 'the enumeration walk itself did not throw, so ok must stay true (that is a DIFFERENT fact from per-animation pause success)');
    assert.equal(result.pauseFailureCount, 1, 'exactly one animation failed to pause');
    assert.deepEqual(result.paused, [true, false], 'the failing animation must be recorded as NOT paused, distinct from the successful one');
  } finally {
    (globalThis as { document?: unknown }).document = originalDocument;
  }
});

// GREEN happy-path companion: proves the tally above isn't hardcoded --
// when every animation's `.pause()` genuinely succeeds, pauseFailureCount
// stays 0 and every entry in `paused` is true.
test('FREEZE_ANIMATIONS_SCRIPT (real script body): every .pause() succeeding reports pauseFailureCount:0 and all-true paused (#72 positive control)', () => {
  const originalDocument = (globalThis as { document?: unknown }).document;
  try {
    (globalThis as { document?: unknown }).document = {
      getAnimations: () => [
        { playState: 'running', pause: () => {} },
        { playState: 'paused', pause: () => {} },
      ],
    };
    const freezeFn = buildFreezeFn();
    const result = freezeFn();

    assert.equal(result.ok, true);
    assert.equal(result.pauseFailureCount, 0);
    assert.deepEqual(result.paused, [true, true]);
  } finally {
    (globalThis as { document?: unknown }).document = originalDocument;
  }
});

// MUST FAIL PRE-FIX: pre-fix, RESTORE_ANIMATIONS_SCRIPT called `.play()` on
// EVERY `origin[i] === 'running'` entry regardless of whether that
// animation was ever actually paused -- an animation whose `.pause()` had
// failed (still genuinely running) would still get a `.play()` call,
// reporting a trivial no-op "success" that masquerades as a real restore.
// `pausedNeverFrozenPlayCalled` would be `true`, not `false`.
test('RESTORE_ANIMATIONS_SCRIPT (real script body): an animation whose .pause() failed at freeze time is never .play()-restored, even though its origin was running (#72)', () => {
  const restoreFn = buildRestoreFn();
  let pausedNeverFrozenPlayCalled = false;
  const fakeThis = {
    anims: [
      { play: () => {} },
      {
        play: () => {
          pausedNeverFrozenPlayCalled = true;
        },
      },
    ],
    origin: ['running', 'running'],
    paused: [true, false],
  };

  const result = restoreFn.call(fakeThis);
  assert.equal(result, true, 'skipping a never-paused animation must not itself count as a restore failure');
  assert.equal(
    pausedNeverFrozenPlayCalled,
    false,
    'an animation whose own .pause() call failed at freeze time was never actually stopped -- restoring it (calling .play()) is not a real restoration and must not happen',
  );
});

// MUST FAIL PRE-FIX: pre-fix, `freezeAnimationsBeforeCapture` never read
// back any pause-failure tally at all -- `AnimationFreezeHandle` had no
// `freezeIncomplete`/`unfrozenCount` fields, so a partially-failed freeze
// (one animation's `.pause()` throwing) surfaced NO fact distinguishing it
// from a fully successful freeze. `handle.freezeIncomplete` would not even
// exist (`undefined`), not `true`.
test('freezeAnimationsBeforeCapture: a partial per-animation pause failure surfaces freezeIncomplete:true / unfrozenCount:1, not a clean success (#72)', async () => {
  const client = new FreezeStubCdpClient({ pauseFailureCount: 1 });

  const handle = await freezeAnimationsBeforeCapture(asClient(client));

  assert.ok(handle, 'the walk itself succeeded (ok:true) -- a partial pause failure must still return a defined handle, just an honestly incomplete one');
  assert.equal(handle!.freezeIncomplete, true, '--freeze-animations must not read as fully successful when one animation was never frozen');
  assert.equal(handle!.unfrozenCount, 1);
});

// GREEN happy-path companion: proves freezeIncomplete/unfrozenCount are not
// hardcoded true -- a clean freeze (pauseFailureCount:0) reports
// freezeIncomplete:false.
test('freezeAnimationsBeforeCapture: a clean freeze with zero pause failures reports freezeIncomplete:false / unfrozenCount:0 (#72 positive control)', async () => {
  const client = new FreezeStubCdpClient({ pauseFailureCount: 0 });

  const handle = await freezeAnimationsBeforeCapture(asClient(client));

  assert.ok(handle);
  assert.equal(handle!.freezeIncomplete, false);
  assert.equal(handle!.unfrozenCount, 0);
});

// A failed READ of the pause-status tally itself (the __captureFreezePauseStatus
// callFunctionOn throwing) must be treated pessimistically as incomplete --
// never silently assumed clean just because the tally couldn't be read back.
test('freezeAnimationsBeforeCapture: a failed read-back of the pause-status tally itself is treated pessimistically as freezeIncomplete:true (#72 I-5 read-failure honesty)', async () => {
  const client = new FreezeStubCdpClient({ pauseStatusReadThrows: true });

  const handle = await freezeAnimationsBeforeCapture(asClient(client));

  assert.ok(handle, 'the origin capture itself still succeeded -- only the pause-status read-back failed');
  assert.equal(handle!.freezeIncomplete, true, 'an unreadable pause-failure tally must never be silently treated as a clean freeze');
});

// MUST FAIL PRE-FIX: pre-fix, restoreAnimationsAfterCapture had no way to
// know a specific animation was never paused -- RESTORE_ANIMATIONS_SCRIPT
// called .play() on every running-origin animation unconditionally, so a
// captureSnapshotSubstrate run with a partially-failed freeze would still
// have its restore callFunctionOn attempt to "restore" (via a no-op
// .play()) an animation that was never actually paused, with nothing in
// the whole flow ever recording that the freeze itself was incomplete.
test('captureSnapshotSubstrate: a partial per-animation pause failure does not silently read as a clean freeze end-to-end (#72)', async () => {
  const dir = freshSnapDir('freeze-pause-partial-failure');
  const client = new FreezeStubCdpClient({ pauseFailureCount: 1 });
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 500,
      pollIntervalMs: 20,
      freezeAnimations: true,
      // Minimal orchestration-only run (mirrors the exception-safety test
      // above): this stub only answers the churn/freeze/screenshot/dom-html
      // CDP calls the orchestrator itself makes, not the real per-collector
      // evaluates (media/geometry/etc.) the default COLLECTORS set would
      // issue — the point of this test is proving a partial freeze failure
      // doesn't abort/corrupt the surrounding capture, not re-testing every
      // collector's own stub wiring (already covered by their owners' test
      // files).
      collectors: [],
    });

    assert.equal(result.settled, true);
    // meta.json's `animationsRestored` reflects only the RESTORE step
    // (which this stub always answers cleanly) -- it is a SEPARATE fact
    // from freeze completeness, which is why #72's fix lives on the
    // handle rather than folded into this boolean. The honest fact this
    // test exists to prove -- freezeAnimationsBeforeCapture's returned
    // handle reporting an incomplete freeze -- is asserted directly above
    // via the handle-level tests; this end-to-end run proves the partial
    // failure does not ABORT or corrupt the rest of the capture.
    assert.equal(result.meta.animationsRestored, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// MUST FAIL PRE-FIX: pre-fix, the `Animation.setPlaybackRate({playbackRate:1})`
// reset call's failure was caught in a bare `catch {}` that never touched
// `restored` — so even though the per-animation restore succeeded, a reset
// failure was silently swallowed and `{restored:true}` still reached the
// caller. `result.meta.animationsRestored` would read `true`, not `false`.
test('captureSnapshotSubstrate: the browser-wide playbackRate(1) reset throwing surfaces meta.animationsRestored:false even though the per-animation restore itself succeeded (Class C item 2b / reset-failure honesty)', async () => {
  const dir = freshSnapDir('restore-rate-reset-throws');
  const client = new FreezeStubCdpClient({ rateResetThrows: true });
  try {
    const result = await captureSnapshotSubstrate({
      target: { client: asClient(client) },
      url: 'http://example.test',
      path: dir,
      settleTimeout: 500,
      pollIntervalMs: 20,
      freezeAnimations: true,
      collectors: [
        {
          name: 'noop',
          phase: 'baseline',
          fn: async (ctx) => {
            ctx.write.json('noop.json', { ok: true });
          },
        },
      ],
    });

    assert.equal(
      result.meta.animationsRestored,
      false,
      'a reset-call failure must gate restored honestly even when the per-animation restore itself reported success',
    );
    const meta = readJson(path.join(dir, 'meta.json'));
    assert.equal(meta.animationsRestored, false);

    const restoreCalls = client.calls.filter(
      (c) =>
        c.method === 'Runtime.callFunctionOn' &&
        String((c.params as { functionDeclaration?: unknown } | undefined)?.functionDeclaration ?? '').includes('__captureRestoreAnimations'),
    );
    assert.equal(restoreCalls.length, 1, 'the per-animation restore call must have actually succeeded (this is what isolates the reset-only failure)');

    const rateOneCalls = client.calls.filter(
      (c) => c.method === 'Animation.setPlaybackRate' && (c.params as { playbackRate?: number } | undefined)?.playbackRate === 1,
    );
    assert.equal(rateOneCalls.length, 1, 'the browser-wide reset must have actually been attempted (proving the false result reflects a real attempted-and-failed reset)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Class C item 3 (I-6 honesty sweep r4): `collectAnimationEvidence` must
// distinguish "could not enumerate animations" (available:false + reason)
// from "enumerated successfully, genuinely zero animations" — both
// previously collapsed to the same empty `animations: []`.
// ============================================================================

class EvidenceUnavailableStubClient {
  constructor(private readonly mode: 'get-animations-threw' | 'evaluate-failed' | 'happy-empty') {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureAnimationInventory')) {
        if (this.mode === 'evaluate-failed') throw new Error('evidence evaluate boom');
        if (this.mode === 'get-animations-threw') {
          // Mirrors ANIMATION_INVENTORY_SCRIPT's own catch branch: the
          // evaluate round trip succeeds, but the page-side
          // document.getAnimations() walk itself threw.
          return { result: { value: { animations: [], ok: false } } };
        }
        return { result: { value: { animations: [], ok: true } } };
      }
      return { result: { value: 0 } };
    }
    return {};
  }
}

// MUST FAIL PRE-FIX: `AnimationEvidence` had no `available` field at all
// before this remediation — `result.available` would be `undefined`, not
// `false`, and `result.unavailableReason` would likewise be `undefined`.
test('collectAnimationEvidence: the page-side script reporting ok:false surfaces available:false with reason get-animations-threw (Class C item 3)', async () => {
  const client = new EvidenceUnavailableStubClient('get-animations-threw');
  const result = await collectAnimationEvidence(asClient(client));

  assert.equal(result.available, false);
  assert.equal(result.unavailableReason, 'get-animations-threw');
  assert.deepEqual(result.animations, []);
});

test('collectAnimationEvidence: the CDP evaluate round trip itself throwing surfaces available:false with reason evaluate-failed (Class C item 3)', async () => {
  const client = new EvidenceUnavailableStubClient('evaluate-failed');
  const result = await collectAnimationEvidence(asClient(client));

  assert.equal(result.available, false);
  assert.equal(result.unavailableReason, 'evaluate-failed');
  assert.deepEqual(result.animations, []);
});

// GREEN happy-path companion: proves available:false isn't hardcoded — a
// genuinely successful, genuinely-empty walk reports available:true with
// no unavailableReason.
test('collectAnimationEvidence: a successful walk with zero animations reports available:true and no unavailableReason (Class C item 3 happy-path companion)', async () => {
  const client = new EvidenceUnavailableStubClient('happy-empty');
  const result = await collectAnimationEvidence(asClient(client));

  assert.equal(result.available, true);
  assert.equal(result.unavailableReason, undefined);
  assert.deepEqual(result.animations, []);
});

// Real-Chrome companion (Class C item 3): monkeypatches
// `document.getAnimations` on a live page to throw, proving the REAL
// ANIMATION_INVENTORY_SCRIPT catch branch (not just a hand-built stub
// shape) round-trips correctly through collectAnimationEvidence.
describe('Class C item 3 real-Chrome: collectAnimationEvidence against a live page whose document.getAnimations() throws', () => {
  let evidenceChromeProc: ChildProcess | undefined;
  let evidenceClient: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    evidenceChromeProc = proc;
    const wsUrl = await newPageTarget(port);
    evidenceClient = new CDPClient(wsUrl);
    await evidenceClient.waitReady();
    await enableDomainsForSnap(evidenceClient);
    await evidenceClient.send('Page.navigate', { url: 'data:text/html,<!DOCTYPE html><html><body></body></html>' });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const res = (await evidenceClient.send('Runtime.evaluate', {
        expression: `document.readyState === 'complete'`,
        returnByValue: true,
      })) as { result?: { value?: boolean } };
      if (res.result?.value) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  }, { timeout: 30000 });

  after(async () => {
    try {
      evidenceClient?.close();
    } catch {
      // already closed
    }
    try {
      evidenceChromeProc?.kill('SIGKILL');
    } catch {
      // already dead
    }
  });

  test('real page-side document.getAnimations() throwing surfaces available:false / get-animations-threw', async () => {
    if (!evidenceClient) throw new Error('client not ready');
    await evidenceClient.send('Runtime.evaluate', {
      expression: `document.getAnimations = function () { throw new Error('boom'); };`,
      returnByValue: true,
    });

    const result = await collectAnimationEvidence(evidenceClient);
    assert.equal(result.available, false);
    assert.equal(result.unavailableReason, 'get-animations-threw');
    assert.deepEqual(result.animations, []);
  });
});

// ============================================================================
// Finding C (I-5) — part 1: animation.json's new available/unavailableReason
// pair, via collectAnimation directly. No real Chrome needed: mirrors
// `test/measure-maps-substrate.test.ts`'s makeCtx/makeWriter pattern,
// reimplemented locally (not imported — that file is protected).
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

function makeCtx(client: unknown, overrides: Partial<SnapshotContext> = {}): { ctx: SnapshotContext; written: Map<string, unknown> } {
  const { writer, written } = makeWriter();
  const ctx: SnapshotContext = {
    client: client as CDPClient,
    dir: '/tmp/measure-animation-freeze-invariants-test-ctx',
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
    ...overrides,
  };
  return { ctx, written };
}

type AnimationUnavailableMode = 'throws' | 'no-object-id' | 'happy-empty';

/**
 * Mirrors the held-object bridge `collectAnimation` actually drives
 * (`Runtime.evaluate` returns a container objectId; `Runtime.getProperties`
 * resolves `facts`/`elements`' own objectIds; `Runtime.callFunctionOn` on
 * `facts`' objectId reads the raw record array back by value) — the same
 * shape `test/measure-maps-substrate.test.ts`'s `AnimationStubCdpClient`
 * uses, reimplemented locally here (not imported) with three switchable
 * failure modes.
 */
class AnimationUnavailableStubClient {
  constructor(private readonly mode: AnimationUnavailableMode) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureAnimationInventory')) {
        if (this.mode === 'throws') throw new Error('inventory evaluate boom');
        if (this.mode === 'no-object-id') return { result: {} };
        return { result: { objectId: 'anim-unavail-container-1' } };
      }
      // IFRAME_COUNT_SCRIPT and anything else — a bare returnByValue evaluate.
      return { result: { value: 0 } };
    }
    if (method === 'Runtime.getProperties') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === 'anim-unavail-container-1') {
        return {
          result: [
            { name: 'facts', value: { objectId: 'anim-unavail-facts-1' } },
            { name: 'elements', value: { objectId: 'anim-unavail-elements-1' } },
          ],
        };
      }
      return { result: [] };
    }
    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === 'anim-unavail-facts-1') {
        return { result: { value: [] } };
      }
      return { result: {} };
    }
    if (method === 'Runtime.releaseObject') {
      return {};
    }
    return {};
  }
}

// MUST FAIL PRE-FIX: `AnimationReport` had no `available` field at all
// before this remediation, so `report.available` would be `undefined`,
// not `false`.
test('collectAnimation: inventory evaluate throwing marks available:false with reason inventory-evaluate-threw', async () => {
  const client = new AnimationUnavailableStubClient('throws');
  const { ctx, written } = makeCtx(client);

  await collectAnimation(ctx);

  const report = written.get('animation.json') as AnimationReport;
  assert.equal(report.available, false);
  assert.equal(report.unavailableReason, 'inventory-evaluate-threw');
  assert.deepEqual(report.animations, []);
});

test('collectAnimation: inventory evaluate returning no objectId marks available:false with reason inventory-evaluate-returned-no-object', async () => {
  const client = new AnimationUnavailableStubClient('no-object-id');
  const { ctx, written } = makeCtx(client);

  await collectAnimation(ctx);

  const report = written.get('animation.json') as AnimationReport;
  assert.equal(report.available, false);
  assert.equal(report.unavailableReason, 'inventory-evaluate-returned-no-object');
  assert.deepEqual(report.animations, []);
});

// Companion happy-path: proves the two failure cases above are now
// distinguishable from a genuinely-empty-but-successful walk — before this
// remediation both collapsed to the same indistinguishable `animations: []`.
test('collectAnimation: a successful walk with zero animations reports available:true and no unavailableReason', async () => {
  const client = new AnimationUnavailableStubClient('happy-empty');
  const { ctx, written } = makeCtx(client);

  await collectAnimation(ctx);

  const report = written.get('animation.json') as AnimationReport;
  assert.equal(report.available, true);
  assert.equal(report.unavailableReason, undefined);
  assert.deepEqual(report.animations, []);
});

// ============================================================================
// Finding C (I-5) — part 2: churn.json's new mutationsTruncated fact, via
// the pure `groupChurnEvidence` (no CDP at all).
// ============================================================================

// Production-wiring test for the fix above: `groupChurnEvidence`'s pure
// arithmetic tests below only prove the function itself, not that a real
// `captureSnapshotSubstrate` capture ever feeds it `mutationsObserved` at
// all. `collectChurnEvidence` is the one and only place that reads the
// teardown script's live value and hands it to `groupChurnEvidence` — so
// this test drives `collectChurnEvidence` itself against a stub whose
// teardown `Runtime.callFunctionOn` returns a `mutationsObserved` greater
// than the kept `mutations` array, mirroring exactly what `TEARDOWN_SCRIPT`
// returns in production.
//
// MUST FAIL PRE-FIX: pre-fix, `collectChurnEvidence` typed the held
// teardown result as only `{ mutations, resizeCount }` and returned only
// `{ mutations, resizeCount }` — dropping `mutationsObserved` entirely even
// though the teardown script handed it back. `raw.mutationsObserved` would
// be `undefined`, not `mutations.length + 5`.
test('collectChurnEvidence: the real teardown-callFunctionOn wiring carries mutationsObserved through, not just groupChurnEvidence in isolation (Finding C / mutation truncation production wiring)', async () => {
  const mutations = [
    { t: 10, type: 'childList', selector: '.a' },
    { t: 20, type: 'childList', selector: '.a' },
  ];
  const stateObjectId = 'freeze-invariants-test-churn-state';
  let releaseCalls = 0;

  const stub = {
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      if (method === 'Runtime.callFunctionOn') {
        const objectId = (params as { objectId?: string }).objectId;
        const functionDeclaration = String((params as { functionDeclaration?: unknown }).functionDeclaration ?? '');
        if (objectId === stateObjectId && functionDeclaration.includes('__captureSettleTeardown')) {
          // Mirrors TEARDOWN_SCRIPT's real return shape (settle.ts:227):
          // `{ mutations, resizeCount, mutationsObserved }`, with
          // mutationsObserved counting every mutation seen, including ones
          // the 200-record cap would have dropped from `mutations`.
          return { result: { value: { mutations, resizeCount: 3, mutationsObserved: mutations.length + 5 } } };
        }
      }
      if (method === 'Runtime.releaseObject') {
        releaseCalls += 1;
        return {};
      }
      return {};
    },
  };

  const handle: ChurnObserverHandle = { stateObjectId };
  const raw = await collectChurnEvidence(asClient(stub), handle);

  assert.equal(
    raw.mutationsObserved,
    mutations.length + 5,
    "the teardown script's mutationsObserved must survive collectChurnEvidence's pass-through into ChurnEvidenceRaw, not be dropped",
  );
  assert.equal(raw.mutations.length, mutations.length);
  assert.equal(raw.resizeCount, 3);
  assert.equal(releaseCalls, 1, 'the held state object must still be released exactly once');
});

// MUST FAIL PRE-FIX: `ChurnReport` had no `mutationsTruncated` field before
// this remediation — `report.mutationsTruncated` would be `undefined`, not
// the expected dropped count, and the 200-record cap silently discarded
// mutations with no fact recording it ever happened.
test('groupChurnEvidence: mutationsObserved exceeding the kept mutation count reports the dropped count as mutationsTruncated', () => {
  const mutations = [
    { t: 10, type: 'childList', selector: '.a' },
    { t: 20, type: 'childList', selector: '.a' },
  ];
  const raw: ChurnEvidenceRaw = { mutations, resizeCount: 0, mutationsObserved: mutations.length + 7 };
  const animationEvidence: AnimationEvidence = { animations: [], infiniteCount: 0 };

  const { report } = groupChurnEvidence(raw, animationEvidence, 1000, 5000);

  assert.equal(report.mutationsTruncated, 7);
  assert.equal(report.totalMutations, mutations.length);
});

test('groupChurnEvidence: mutationsObserved equal to (or omitted vs.) the kept count reports mutationsTruncated as undefined', () => {
  const mutations = [{ t: 10, type: 'childList', selector: '.a' }];
  const animationEvidence: AnimationEvidence = { animations: [], infiniteCount: 0 };

  const rawEqual: ChurnEvidenceRaw = { mutations, resizeCount: 0, mutationsObserved: mutations.length };
  const { report: reportEqual } = groupChurnEvidence(rawEqual, animationEvidence, 1000, 5000);
  assert.equal(reportEqual.mutationsTruncated, undefined, 'nothing was dropped when mutationsObserved equals the kept count');
  // #9: mutationsObserved was SUPPLIED (and equals the kept count) -- the
  // 200-record cap's true drop count is CONFIRMED zero, so
  // mutationsTruncationUnknown must stay falsy here, distinct from the
  // omitted case right below.
  //
  // MUST FAIL PRE-FIX: pre-fix `ChurnReportRecord` had no
  // `mutationsTruncationUnknown` field at all -- `reportEqual
  // .mutationsTruncationUnknown` would be `undefined`, which happens to
  // also satisfy a bare falsy check, but `reportOmitted
  // .mutationsTruncationUnknown` below would ALSO be `undefined` even
  // though `mutationsObserved` was never supplied -- the two cases were
  // indistinguishable pre-fix, which is exactly the defect #9 fixes.
  assert.ok(!reportEqual.mutationsTruncationUnknown, 'a supplied, equal mutationsObserved confirms nothing was dropped -- must not be flagged unknown');

  const rawOmitted: ChurnEvidenceRaw = { mutations, resizeCount: 0 };
  const { report: reportOmitted } = groupChurnEvidence(rawOmitted, animationEvidence, 1000, 5000);
  assert.equal(reportOmitted.mutationsTruncated, undefined, 'omitting mutationsObserved (a hand-built fixture) degrades to "nothing was dropped"');
  // #9: mutationsObserved was NEVER supplied -- the true drop count is
  // UNKNOWN, a genuinely different fact from "confirmed nothing was
  // dropped" (reportEqual above). Pre-fix, `mutationsObserved` silently
  // defaulted to the kept length, so this omission read exactly like the
  // confirmed-zero case above; #9's fix is precisely this distinction.
  assert.equal(reportOmitted.mutationsTruncationUnknown, true, 'an omitted mutationsObserved must be flagged unknown, never silently treated as a confirmed zero');
});

// ============================================================================
// CHILD 6 (I-5/I-6) -- settle.ts coerce-to-success honesty fixes #5, #6, #7,
// #8, #10 (#9 was folded into the existing groupChurnEvidence test just
// above). Adversarial RED->GREEN coverage per
// /Users/silasrhyneer/.crouter/canvas/nodes/mre7opwt-eb63755d/context/child6-test-writing-brief.md.
// Every stub CDPClient below is local to this file (or reuses
// FreezeStubCdpClient already defined above in this same file); none are
// imported from a protected shared test file.
// ============================================================================

// ----------------------------------------------------------------------
// #5 -- SAMPLE_SCRIPT's own animationReadFailed fact must survive
// buildDomSettleSampler as an explicit DomSettleSample.animationReadUnavailable,
// forcing quietMs to 0 on a failed read (fail-safe, same treatment as a
// CONFIRMED running-infinite animation).
// ----------------------------------------------------------------------

class SettleSampleUnavailableStubClient {
  private static readonly STATE_OBJECT_ID = 'child6-sample-stub-state';

  constructor(private readonly animationReadFailed: boolean) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureSettleBootstrap')) {
        return { result: { objectId: SettleSampleUnavailableStubClient.STATE_OBJECT_ID } };
      }
      return { result: { value: 0 } };
    }
    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      const functionDeclaration = String((params as { functionDeclaration?: unknown }).functionDeclaration ?? '');
      if (objectId === SettleSampleUnavailableStubClient.STATE_OBJECT_ID && functionDeclaration.includes('__captureSettleSample')) {
        return this.animationReadFailed
          ? { result: { value: { signature: 'sig-child6', quietMs: 5000, animationReadFailed: true } } }
          : { result: { value: { signature: 'sig-child6', quietMs: 5000 } } };
      }
    }
    return {};
  }
}

// MUST FAIL PRE-FIX: pre-fix `buildDomSettleSampler` returned only
// `{ signature: value.signature, quietMs: value.quietMs }` -- there was no
// `animationReadUnavailable` field at all, and `quietMs` was passed
// through UNCHANGED even when the page-side `document.getAnimations()`
// read inside `SAMPLE_SCRIPT` threw (its catch branch set
// `animationReadFailed` but nothing downstream ever consumed it).
// `sample.animationReadUnavailable` would be `undefined`, not `true`, and
// `sample.quietMs` would be `5000`, not `0`.
test('buildDomSettleSampler: a page-side animation read failure surfaces animationReadUnavailable:true and forces quietMs to 0 (#5)', async () => {
  const client = new SettleSampleUnavailableStubClient(true);
  const handle = await injectChurnObservers(asClient(client));
  const sampler = buildDomSettleSampler(asClient(client), handle);

  const sample = await sampler();

  assert.equal(sample.animationReadUnavailable, true);
  assert.equal(sample.quietMs, 0, 'a failed animation read must never look quiet, even though the raw quietMs reported by the page was large');
  assert.equal(sample.signature, 'sig-child6');
});

// GREEN happy-path companion: proves animationReadUnavailable:true above
// isn't hardcoded -- a normal sample with no read failure reports it
// false and passes quietMs through completely unchanged.
test('buildDomSettleSampler: a normal sample with no animation read failure reports animationReadUnavailable:false and passes quietMs through unchanged (#5 positive control)', async () => {
  const client = new SettleSampleUnavailableStubClient(false);
  const handle = await injectChurnObservers(asClient(client));
  const sampler = buildDomSettleSampler(asClient(client), handle);

  const sample = await sampler();

  assert.equal(sample.animationReadUnavailable, false);
  assert.equal(sample.quietMs, 5000);
});

// Real-Chrome companion (#5): the two tests above only prove
// buildDomSettleSampler's CONSUMER half against a hand-fabricated
// `{animationReadFailed:true}` stub value -- they would still pass even if
// SAMPLE_SCRIPT's own catch branch regressed and never emitted the flag at
// all. This drives the ACTUAL SAMPLE_SCRIPT PRODUCER half against a live
// page: monkeypatches `document.getAnimations` to throw, injects the real
// observers via `injectChurnObservers`, and samples via the real
// `buildDomSettleSampler(client, handle)()` -- proving the real page-side
// read failure survives the whole round trip, not just the wrapper logic.
describe('#5 real-Chrome: buildDomSettleSampler against a live page whose document.getAnimations() throws', () => {
  let sampleChromeProc: ChildProcess | undefined;
  let sampleClient: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    sampleChromeProc = proc;
    const wsUrl = await newPageTarget(port);
    sampleClient = new CDPClient(wsUrl);
    await sampleClient.waitReady();
    await enableDomainsForSnap(sampleClient);
    await sampleClient.send('Page.navigate', { url: 'data:text/html,<!DOCTYPE html><html><body></body></html>' });
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const res = (await sampleClient.send('Runtime.evaluate', {
        expression: `document.readyState === 'complete'`,
        returnByValue: true,
      })) as { result?: { value?: boolean } };
      if (res.result?.value) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  }, { timeout: 30000 });

  after(async () => {
    try {
      sampleClient?.close();
    } catch {
      // already closed
    }
    try {
      sampleChromeProc?.kill('SIGKILL');
    } catch {
      // already dead
    }
  });

  // MUST FAIL PRE-FIX: pre-fix, SAMPLE_SCRIPT's catch branch never set any
  // failure flag at all -- `infiniteRunning` simply stayed `false` and the
  // sample returned `{signature, quietMs}` with no `animationReadFailed`
  // field, so a real `document.getAnimations()` throw on the page would
  // have looked EXACTLY like a genuinely quiet page with no infinite
  // animation running. `sample.animationReadUnavailable` would be
  // `undefined` (or, once buildDomSettleSampler existed, hardcoded `false`
  // since the stub-only test above could never regress-detect a producer-
  // side omission), not `true`, and `sample.quietMs` would pass through the
  // page's raw (non-zero) value instead of being forced to `0`.
  test('real page-side document.getAnimations() throwing surfaces animationReadUnavailable:true and forces quietMs:0', async () => {
    if (!sampleClient) throw new Error('client not ready');
    await sampleClient.send('Runtime.evaluate', {
      expression: `document.getAnimations = function () { throw new Error('boom'); };`,
      returnByValue: true,
    });

    const handle = await injectChurnObservers(sampleClient);
    const sampler = buildDomSettleSampler(sampleClient, handle);
    const sample = await sampler();

    assert.equal(sample.animationReadUnavailable, true, 'the real SAMPLE_SCRIPT catch branch must set animationReadFailed, which buildDomSettleSampler must surface as animationReadUnavailable');
    assert.equal(sample.quietMs, 0, 'a real failed animation read must never look quiet, regardless of whatever raw quietMs the page-side script computed');

    await collectChurnEvidence(sampleClient, handle);
  });
});

// ----------------------------------------------------------------------
// #6 -- collectChurnEvidence's teardown read must distinguish a genuinely
// well-formed empty/zero churn read from a MALFORMED teardown value (the
// round trip succeeded but the shape is wrong) -- the latter must never
// silently coerce to the same empty/zero shape as the former.
// ----------------------------------------------------------------------

class SettleTeardownMalformedStubClient {
  private static readonly STATE_OBJECT_ID = 'child6-teardown-stub-state';

  constructor(private readonly mode: 'missing-fields' | 'wrong-types' | 'well-formed') {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureSettleBootstrap')) {
        return { result: { objectId: SettleTeardownMalformedStubClient.STATE_OBJECT_ID } };
      }
      return { result: { value: 0 } };
    }
    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      const functionDeclaration = String((params as { functionDeclaration?: unknown }).functionDeclaration ?? '');
      if (objectId === SettleTeardownMalformedStubClient.STATE_OBJECT_ID && functionDeclaration.includes('__captureSettleTeardown')) {
        if (this.mode === 'missing-fields') return { result: { value: {} } };
        if (this.mode === 'wrong-types') return { result: { value: { mutations: 'nope', resizeCount: 0 } } };
        return { result: { value: { mutations: [], resizeCount: 0, mutationsObserved: 0 } } };
      }
    }
    if (method === 'Runtime.releaseObject') {
      return {};
    }
    return {};
  }
}

// MUST FAIL PRE-FIX: pre-fix `collectChurnEvidence` returned
// `{ mutations: value.mutations ?? [], resizeCount: value.resizeCount ?? 0 }`
// unconditionally -- a `value` object missing `mutations`/`resizeCount`
// entirely coerced straight into the SAME `{mutations:[], resizeCount:0}`
// shape a genuinely quiet page produces, with no marker distinguishing the
// two. `raw.teardownUnavailable` would be `undefined`, not `true`.
test('collectChurnEvidence: a teardown value missing mutations/resizeCount entirely surfaces teardownUnavailable:true / malformed-value (#6)', async () => {
  const client = new SettleTeardownMalformedStubClient('missing-fields');
  const handle = await injectChurnObservers(asClient(client));

  const raw = await collectChurnEvidence(asClient(client), handle);

  assert.equal(raw.teardownUnavailable, true);
  assert.equal(raw.teardownUnavailableReason, 'malformed-value');
  assert.deepEqual(raw.mutations, []);
  assert.equal(raw.resizeCount, 0);
});

// Same defect, different malformed shape: `mutations` present but
// wrong-typed (not an array) rather than fully absent -- the pre-fix `??`
// coercion only guarded against `null`/`undefined`, so a wrong-typed value
// would have sailed straight through as "successfully" read.
test('collectChurnEvidence: a teardown value with a wrong-typed mutations field surfaces teardownUnavailable:true / malformed-value (#6)', async () => {
  const client = new SettleTeardownMalformedStubClient('wrong-types');
  const handle = await injectChurnObservers(asClient(client));

  const raw = await collectChurnEvidence(asClient(client), handle);

  assert.equal(raw.teardownUnavailable, true);
  assert.equal(raw.teardownUnavailableReason, 'malformed-value');
  assert.deepEqual(raw.mutations, []);
  assert.equal(raw.resizeCount, 0);
});

// GREEN happy-path companion: proves teardownUnavailable:true above isn't
// hardcoded -- a genuinely well-formed empty/zero teardown (a real quiet
// page) reports no unavailable marker at all.
test('collectChurnEvidence: a well-formed empty/zero teardown reports no teardownUnavailable marker (#6 positive control)', async () => {
  const client = new SettleTeardownMalformedStubClient('well-formed');
  const handle = await injectChurnObservers(asClient(client));

  const raw = await collectChurnEvidence(asClient(client), handle);

  assert.equal(raw.teardownUnavailable, undefined);
  assert.deepEqual(raw.mutations, []);
  assert.equal(raw.resizeCount, 0);
});

// ----------------------------------------------------------------------
// #7 / #8 -- freezeAnimationsBeforeCapture's own I-5/I-6 honesty: the held
// origin container's own `ok` flag (read back via FREEZE_ORIGIN_OK_SCRIPT)
// gates whether the browser-wide Animation.setPlaybackRate(0) override is
// EVER applied (#7); and a THROWING setPlaybackRate(0) call must still
// return a defined handle, just with rateOverrideApplied:false, since the
// per-animation pauses captured in the SAME evaluate as the origin capture
// are still real (#8). Both reuse FreezeStubCdpClient, already defined
// above in this file, which already supports the `freezeOriginNotOk` and
// `freezeRateApplyThrows` constructor options for exactly this purpose.
// ----------------------------------------------------------------------

// MUST FAIL PRE-FIX: pre-fix, `freezeAnimationsBeforeCapture` read no `ok`
// flag back from the held freeze container at all -- a held `objectId`
// alone was trusted directly as "there is a valid origin to restore
// from", so a page-side `document.getAnimations()` throw that still
// round-tripped a valid-looking `{anims:[], origin:[], ok:false}`
// container would have produced a DEFINED handle, and the browser-wide
// `Animation.setPlaybackRate({playbackRate:0})` override WOULD have been
// applied. `handle` here would be an object, not `undefined`, and the
// `playbackRate:0` call WOULD be present in `client.calls`.
test('freezeAnimationsBeforeCapture: the held origin container reporting ok:false returns undefined and never applies the playbackRate(0) override (#7)', async () => {
  const client = new FreezeStubCdpClient({ freezeOriginNotOk: true });

  const handle = await freezeAnimationsBeforeCapture(asClient(client));

  assert.equal(handle, undefined, 'a failed origin capture must never hand back a handle to restore from');
  const rateZeroCalls = client.calls.filter(
    (c) => c.method === 'Animation.setPlaybackRate' && (c.params as { playbackRate?: number } | undefined)?.playbackRate === 0,
  );
  assert.equal(rateZeroCalls.length, 0, 'the browser-wide freeze override must never be applied when the origin capture itself failed');
});

// GREEN happy-path companion (also the #8 positive control): proves the
// undefined-handle result above isn't hardcoded -- a genuinely successful
// origin capture returns a defined handle with rateOverrideApplied:true.
test('freezeAnimationsBeforeCapture: a successful origin capture returns a defined handle with rateOverrideApplied:true (#7 / #8 positive control)', async () => {
  const client = new FreezeStubCdpClient();

  const handle = await freezeAnimationsBeforeCapture(asClient(client));

  assert.ok(handle, 'a successful origin capture must return a defined handle');
  assert.equal(handle!.rateOverrideApplied, true);
});

// MUST FAIL PRE-FIX: pre-fix, `AnimationFreezeHandle` had no
// `rateOverrideApplied` field at all, and the `Animation.setPlaybackRate`
// call's failure was swallowed with a bare `catch {}` that recorded
// nothing -- there was no fact anywhere saying the browser-wide freeze
// override itself failed to apply. `handle.rateOverrideApplied` would not
// even exist (`undefined`), not `false`.
test('freezeAnimationsBeforeCapture: the browser-wide playbackRate(0) override throwing still returns a defined handle, with rateOverrideApplied:false (#8)', async () => {
  const client = new FreezeStubCdpClient({ freezeRateApplyThrows: true });

  const handle = await freezeAnimationsBeforeCapture(asClient(client));

  assert.ok(handle, 'the per-animation pauses captured in the SAME evaluate as the origin capture are still real -- a failed override must not erase the handle');
  assert.equal(handle!.rateOverrideApplied, false);
});

// ----------------------------------------------------------------------
// #10 -- groupChurnEvidence must propagate an animationEvidence read's own
// available:false into churn.json as an explicit animationEvidenceUnavailable
// marker, distinguishing "no running infinite animations because the read
// failed" from "no running infinite animations because the page genuinely
// has none".
// ----------------------------------------------------------------------

// MUST FAIL PRE-FIX: `ChurnReportRecord` had no `animationEvidenceUnavailable`
// field before this remediation, and `groupChurnEvidence` only ever read
// `animationEvidence.animations` (already honestly empty on a failed read)
// -- that emptiness alone fed straight into the animation-based regions
// loop with no marker recording the read itself had failed.
// `report.animationEvidenceUnavailable` would be `undefined`, not `true`.
test('groupChurnEvidence: an animationEvidence read reporting available:false surfaces animationEvidenceUnavailable:true with its reason (#10)', () => {
  const raw: ChurnEvidenceRaw = { mutations: [], resizeCount: 0, mutationsObserved: 0 };
  const animationEvidence = { animations: [], infiniteCount: 0, available: false, unavailableReason: 'get-animations-threw' as const };

  const { report } = groupChurnEvidence(raw, animationEvidence, 1000, 5000);

  assert.equal(report.animationEvidenceUnavailable, true);
  assert.equal(report.animationEvidenceUnavailableReason, 'get-animations-threw');
});

// GREEN happy-path companions: proves the marker above isn't hardcoded --
// an explicit available:true reports no marker, and a bare AnimationEvidence
// fixture with no `available` field at all (the pre-remediation shape,
// still structurally valid per AnimationEvidenceInput) degrades honestly
// to "no marker" too, proving backward compatibility.
test('groupChurnEvidence: available:true (or a bare AnimationEvidence fixture with no available field) reports no animationEvidenceUnavailable marker (#10 positive control)', () => {
  const raw: ChurnEvidenceRaw = { mutations: [], resizeCount: 0, mutationsObserved: 0 };

  const availableTrue = { animations: [], infiniteCount: 0, available: true };
  const { report: reportAvailable } = groupChurnEvidence(raw, availableTrue, 1000, 5000);
  assert.equal(reportAvailable.animationEvidenceUnavailable, undefined);

  const bareFixture: AnimationEvidence = { animations: [], infiniteCount: 0 };
  const { report: reportBare } = groupChurnEvidence(raw, bareFixture, 1000, 5000);
  assert.equal(
    reportBare.animationEvidenceUnavailable,
    undefined,
    'a bare AnimationEvidence fixture with no available field must remain backward compatible',
  );
});

// ----------------------------------------------------------------------
// CHILD 6 fix pass, Fix B (review Major) -- BOOTSTRAP_SCRIPT's ResizeObserver
// setup failure (`new ResizeObserver(...)`/`.observe()` throwing) must not
// silently coerce to `resizeCount:0` -- that is indistinguishable from a
// genuinely-installed observer that saw zero resizes. Mirrors the #6
// (teardownUnavailable) and #10 (animationEvidenceUnavailable) marker
// patterns end to end: held state -> TEARDOWN_SCRIPT -> ChurnEvidenceRaw ->
// collectChurnEvidence -> groupChurnEvidence/ChurnReportRecord.
// ----------------------------------------------------------------------

class SettleResizeObserverUnavailableStubClient {
  private static readonly STATE_OBJECT_ID = 'child6-resize-stub-state';

  constructor(private readonly mode: 'setup-failed' | 'well-formed') {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureSettleBootstrap')) {
        return { result: { objectId: SettleResizeObserverUnavailableStubClient.STATE_OBJECT_ID } };
      }
      return { result: { value: 0 } };
    }
    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      const functionDeclaration = String((params as { functionDeclaration?: unknown }).functionDeclaration ?? '');
      if (objectId === SettleResizeObserverUnavailableStubClient.STATE_OBJECT_ID && functionDeclaration.includes('__captureSettleTeardown')) {
        // Mirrors TEARDOWN_SCRIPT's real return shape: a well-formed teardown
        // (mutations/resizeCount valid) that ALSO carries the bootstrap-time
        // resizeObserverUnavailable flag -- a DIFFERENT failure mode than a
        // malformed teardown read (#6), which this stub never produces.
        return {
          result: {
            value: {
              mutations: [],
              resizeCount: 0,
              mutationsObserved: 0,
              resizeObserverUnavailable: this.mode === 'setup-failed',
            },
          },
        };
      }
    }
    if (method === 'Runtime.releaseObject') {
      return {};
    }
    return {};
  }
}

// MUST FAIL PRE-FIX: pre-fix, `collectChurnEvidence` only ever read
// `value.mutations`/`value.resizeCount`/`value.mutationsObserved` off the
// teardown payload -- `value.resizeObserverUnavailable` was dropped
// entirely, and `ChurnEvidenceRaw` had no such field at all.
// `raw.resizeObserverUnavailable` would be `undefined`, not `true`, even
// though the bootstrap script's ResizeObserver setup genuinely failed.
test('collectChurnEvidence: a teardown payload reporting resizeObserverUnavailable surfaces raw.resizeObserverUnavailable:true / setup-threw (Fix B)', async () => {
  const client = new SettleResizeObserverUnavailableStubClient('setup-failed');
  const handle = await injectChurnObservers(asClient(client));

  const raw = await collectChurnEvidence(asClient(client), handle);

  assert.equal(raw.resizeObserverUnavailable, true);
  assert.equal(raw.resizeObserverUnavailableReason, 'setup-threw');
  assert.equal(raw.resizeCount, 0, 'resizeCount is the empty DEFAULT from a never-installed observer, not a genuine zero-resize observation');
});

// GREEN happy-path companion: proves the marker above isn't hardcoded -- a
// genuinely successful ResizeObserver installation that saw zero resizes
// reports no marker at all.
test('collectChurnEvidence: a well-formed teardown with no resizeObserverUnavailable flag reports no marker (Fix B positive control)', async () => {
  const client = new SettleResizeObserverUnavailableStubClient('well-formed');
  const handle = await injectChurnObservers(asClient(client));

  const raw = await collectChurnEvidence(asClient(client), handle);

  assert.equal(raw.resizeObserverUnavailable, undefined);
  assert.equal(raw.resizeCount, 0);
});

// MUST FAIL PRE-FIX: pre-fix, `ChurnReportRecord` had no
// `resizeObserverUnavailable` field at all, and `groupChurnEvidence` never
// read `raw.resizeObserverUnavailable` -- `report.resizeObserverUnavailable`
// would be `undefined`, not `true`, and the written churn.json would look
// exactly like a genuinely quiet page with a working ResizeObserver.
test('groupChurnEvidence: a raw carrying resizeObserverUnavailable:true surfaces report.resizeObserverUnavailable:true with its reason (Fix B)', () => {
  const raw: ChurnEvidenceRaw = {
    mutations: [],
    resizeCount: 0,
    mutationsObserved: 0,
    resizeObserverUnavailable: true,
    resizeObserverUnavailableReason: 'setup-threw',
  };
  const animationEvidence: AnimationEvidence = { animations: [], infiniteCount: 0 };

  const { report } = groupChurnEvidence(raw, animationEvidence, 1000, 5000);

  assert.equal(report.resizeObserverUnavailable, true);
  assert.equal(report.resizeObserverUnavailableReason, 'setup-threw');
});

// GREEN happy-path companion: proves the marker above isn't hardcoded -- a
// raw with no resizeObserverUnavailable flag (a genuinely successful
// observer, or a hand-built fixture that doesn't care) reports no marker.
test('groupChurnEvidence: a raw with no resizeObserverUnavailable flag reports no marker (Fix B positive control)', () => {
  const raw: ChurnEvidenceRaw = { mutations: [], resizeCount: 0, mutationsObserved: 0 };
  const animationEvidence: AnimationEvidence = { animations: [], infiniteCount: 0 };

  const { report } = groupChurnEvidence(raw, animationEvidence, 1000, 5000);

  assert.equal(report.resizeObserverUnavailable, undefined);
  assert.equal(report.resizeObserverUnavailableReason, undefined);
});

// ----------------------------------------------------------------------
// CHILD 6 fix pass, Minor -- `evaluateHeld` (settle.ts) must reject a
// thrown BOOTSTRAP_SCRIPT at injection time instead of silently accepting
// the remote Error object's own `objectId` as if it were real state. Real
// CDP hands back `result.objectId` (pointing at the Error object) PLUS a
// top-level `exceptionDetails` whenever the evaluated expression throws --
// `evaluateHeld` must check `exceptionDetails` before trusting `objectId`.
// ----------------------------------------------------------------------

class SettleBootstrapThrowsStubClient {
  async send(method: string): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      // Shaped like a real thrown Runtime.evaluate response: Chrome still
      // returns a (Error-typed) result.objectId, but ALSO an
      // exceptionDetails describing the throw.
      return {
        result: { type: 'object', subtype: 'error', objectId: 'err-1' },
        exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: ResizeObserver is not defined' } },
      };
    }
    if (method === 'Runtime.releaseObject') {
      return {};
    }
    return {};
  }
}

// MUST FAIL PRE-FIX: pre-fix, `evaluateHeld` only read `result.objectId` and
// ignored `exceptionDetails` entirely -- it would resolve with
// `stateObjectId:'err-1'` (the Error object's own handle) instead of
// rejecting, and the setup failure would only surface later, confusingly,
// when something tried to use that handle.
test('injectChurnObservers: a thrown BOOTSTRAP_SCRIPT (exceptionDetails present) rejects at injection instead of returning the Error object handle (Minor honesty fix)', async () => {
  const client = new SettleBootstrapThrowsStubClient();

  await assert.rejects(
    () => injectChurnObservers(asClient(client)),
    /injectChurnObservers: BOOTSTRAP_SCRIPT threw during setup: TypeError: ResizeObserver is not defined/,
  );
});

// ============================================================================
// Finding D (I-3) — real-Chrome identity equality: collectAnimation and
// collectGeometry must resolve the SAME backendNodeId for the same live
// element. Harness copied from `test/measure-animation.test.ts`
// (spawnHeadlessChrome/newPageTarget/waitForHttpOk), not imported — it is a
// self-contained pattern already duplicated across this test suite.
// ============================================================================

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const FIXTURE_HTML = `<!DOCTYPE html><html><head><style>
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
#spinner { animation: spin 2s linear infinite; width:40px; height:40px; background:blue; }
</style></head><body style="margin:0;">
<div id="spinner">S</div>
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

async function waitForFixtureReady(client: CDPClient, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await client.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && document.getElementById('spinner') !== null`,
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

describe('Finding D real-Chrome: collectAnimation and collectGeometry resolve the SAME backendNodeId for #spinner', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;
  let animationReport: AnimationReport;
  let geometryReport: { elements: GeometryElementRecord[] };

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
      dir: '/tmp/measure-animation-freeze-invariants-test-d-unused',
      snapId: 'freeze-invariants-d-snap',
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
    // SAME in-memory writer — exactly how the real orchestrator drives them.
    await collectAnimation(ctx);
    await collectGeometry(ctx);

    animationReport = store['animation.json'] as AnimationReport;
    geometryReport = store['geometry.json'] as { elements: GeometryElementRecord[] };
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

  // Evidence-of-correctness, not a bug reproduction (per I-3 in the
  // invariants doc — "the test IS the evidence"): this specific
  // cross-collector equality assertion did not exist before, even though
  // the underlying values likely already agreed.
  test('animationRecord.backendNodeId equals geometryRecord.backendNodeId for the #spinner div', () => {
    const animationRecord = animationReport.animations.find((a) => a.backendNodeId !== undefined);
    assert.ok(
      animationRecord,
      `expected an animation record with a resolved backendNodeId, got selectors ${JSON.stringify(animationReport.animations.map((a) => a.selector))}`,
    );

    const geometryRecord = geometryReport.elements.find(
      (e) => e.tag === 'div' && (e.selector === '#spinner' || e.selector === 'div#spinner' || (e.domPath ?? '').includes('spinner')),
    );
    assert.ok(
      geometryRecord,
      `expected a geometry.json record for the #spinner div, got ${JSON.stringify(geometryReport.elements.map((e) => ({ tag: e.tag, selector: e.selector, domPath: e.domPath })))}`,
    );

    assert.notEqual(animationRecord!.backendNodeId, undefined);
    assert.notEqual(geometryRecord!.backendNodeId, undefined);
    assert.equal(
      animationRecord!.backendNodeId,
      geometryRecord!.backendNodeId,
      'the spinner animation and the spinner geometry element must resolve to the SAME CDP backendNodeId (the cross-artifact join key)',
    );
  });
});
