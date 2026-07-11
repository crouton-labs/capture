import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CDPClient } from '../src/cdp/client.js';
import type { SnapshotContext, SnapshotWriter } from '../src/cdp/measure/types.js';
import { collectFocus } from '../src/cdp/measure/collectors/focus.js';
import { collectScroll } from '../src/cdp/measure/collectors/scroll.js';
import { collectStates } from '../src/cdp/measure/collectors/states.js';

// ============================================================================
// Restoration-failure-injection tests for the three mutating collectors W2
// owns (focus, scroll, states). Each proves that when a step fails, the
// collector STILL attempts restoration in its finally window and records the
// outcome as a factual field — never leaves the page mutated silently.
//
// Stubbed CDP only (no real Chrome), following the marker-`.includes()`
// convention of test/snapshot-settledness.test.ts and the recording
// SnapshotWriter of test/measure-maps-substrate.test.ts.
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
    dir: '/tmp/measure-restoration-test',
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
    ...overrides,
  };
  return { ctx, written };
}

function asClient(stub: unknown): CDPClient {
  return stub as unknown as CDPClient;
}

// ============================================================================
// focus.ts
// ============================================================================

class FocusStub {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  restoreCount = 0;
  cleanupCount = 0;
  private sampleCount = 0;
  /**
   * Genuine marker-lifecycle tracking (item 7.6 hardening) — mirrors which
   * `data-capture-focus-*` marker instances are CURRENTLY tagged page-side,
   * mutated only by the same evaluate calls a real page would apply them
   * through: `__captureFocusInit` (successful) ADDS them, a throwing init
   * adds ONLY the `original` marker (mirroring the real script's "tag the
   * active element FIRST, before the candidate/clickable loops that could
   * throw" ordering), and `__captureFocusMarkerCleanup`/`__captureFocusRestore`
   * (when they don't themselves throw) CLEAR it. Every `markersRemoved` this
   * stub returns is COMPUTED from this Set's emptiness, never an
   * unconditional canned `true` — so a test can assert against
   * {@link FocusStub.liveMarkerCount} directly to prove markers were
   * genuinely untagged, not merely that a cleanup call happened.
   */
  private liveMarkers = new Set<string>();

  get liveMarkerCount(): number {
    return this.liveMarkers.size;
  }

  constructor(
    private readonly opts: {
      failAtSample?: number;
      hadOriginalFocus?: boolean;
      throwOnFinalRestore?: boolean;
      sampleRole?: string;
      /** Origin-capture (`__captureFocusOrigin`) values — the TRUE original the fix must restore to. */
      originScrollX?: number;
      originScrollY?: number;
      /** Simulates `__captureFocusInit` throwing AFTER it has already mutated the page (a real marker-stamping loop partially applied, then threw). */
      throwOnInit?: boolean;
      /** Simulates a degenerate `__captureFocusOrigin` response that carries no `.value` at all (evaluate() resolves to `undefined`) — the origin was never proven, but no exception was thrown either. */
      originReturnsNoValue?: boolean;
      /** Simulates `__captureFocusOrigin` itself throwing, BEFORE any mutation has started. */
      throwOnOrigin?: boolean;
    } = {},
  ) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'Input.dispatchKeyEvent') return {};
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') {
      const sel = String((params as { selector?: unknown }).selector ?? '');
      if (sel === '[data-capture-focus-id]') return { nodeIds: [10, 11] };
      if (sel === '[data-capture-focus-clickable-id]') return { nodeIds: [20] };
      return { nodeIds: [] };
    }
    if (method === 'DOM.describeNode') {
      // The objectId bridge path: decode the COLLECTOR-PRIVATE cycle-key
      // backendNodeId (obj-N -> N). Branch on objectId presence FIRST so it
      // never clobbers the marker→backendNodeId (nodeId) path below, which is
      // what fills the EMITTED backendNodeId (1010/1011/2020).
      const objectId = String((params as { objectId?: unknown }).objectId ?? '');
      const om = objectId.match(/^obj-(\d+)$/);
      if (om) return { node: { backendNodeId: Number(om[1]) } };
      const nodeId = (params as { nodeId?: number }).nodeId;
      if (nodeId === 10) return { node: { backendNodeId: 1010, attributes: ['data-capture-focus-id', 'focus-1'] } };
      if (nodeId === 11) return { node: { backendNodeId: 1011, attributes: ['data-capture-focus-id', 'focus-2'] } };
      if (nodeId === 20) return { node: { backendNodeId: 2020, attributes: ['data-capture-focus-clickable-id', 'click-1'] } };
      return { node: {} };
    }
    if (method === 'Runtime.evaluate') {
      const expr = String((params as { expression?: unknown }).expression ?? '');
      // The collector-private identity bridge: document.activeElement as a held
      // RemoteObject. Map each candidate id to a fixed private backendNodeId
      // (focus-1 -> 3001, focus-2 -> 3002) so the deliberately repeating
      // ['focus-1','focus-2','focus-2'] sample sequence registers its repeat and
      // the walk exits naturally. These are private cycle keys, NEVER emitted —
      // the emitted backendNodeIds come from the marker path (1010/1011/2020).
      if (expr.trim() === 'document.activeElement' && (params as { returnByValue?: unknown }).returnByValue === false) {
        const seq = ['focus-1', 'focus-2', 'focus-2'];
        const lastId = seq[Math.min(this.sampleCount - 1, seq.length - 1)];
        const backend = lastId === 'focus-1' ? 3001 : 3002;
        return { result: { objectId: `obj-${backend}` } };
      }
      if (expr.includes('__captureFocusOrigin')) {
        if (this.opts.throwOnOrigin) {
          // Models the non-mutating origin read itself throwing, BEFORE any
          // marker has been stamped anywhere — nothing proven, nothing mutated.
          throw new Error('injected origin-read failure before any mutation');
        }
        if (this.opts.originReturnsNoValue) {
          // Models a degenerate Runtime.evaluate response that carries no
          // `.value` at all — evaluate() resolves to `undefined`, no exception.
          return { result: {} };
        }
        return {
          result: {
            value: {
              hadOriginalFocus: this.opts.hadOriginalFocus ?? false,
              scrollX: this.opts.originScrollX ?? 0,
              scrollY: this.opts.originScrollY ?? 0,
            },
          },
        };
      }
      if (expr.includes('__captureFocusInit')) {
        if (this.opts.throwOnInit) {
          // Models the real marker-stamping script throwing AFTER it has
          // already tagged some candidates in-page (a partial mutation) —
          // Runtime.evaluate rejects with no `.value` reaching Node. Per the
          // real script's ordering (tag the active element FIRST, then loop
          // candidates/clickables), only the `original` marker may have
          // landed before the throw.
          if (this.opts.hadOriginalFocus) this.liveMarkers.add('original');
          throw new Error('injected focus-init failure after partial marker mutation');
        }
        this.liveMarkers.add('original');
        this.liveMarkers.add('focus-id:focus-1');
        this.liveMarkers.add('focus-id:focus-2');
        this.liveMarkers.add('clickable-id:click-1');
        return {
          result: {
            value: {
              candidates: [
                { id: 'focus-1', selector: 'a#skip', tabIndex: 0, rect: null, visible: true, domIndex: 0 },
                { id: 'focus-2', selector: 'button.menu', tabIndex: 0, rect: null, visible: true, domIndex: 1 },
              ],
              clickableUnfocusable: [{ id: 'click-1', selector: 'div.card', rect: null }],
              iframesPresent: 1,
              shadowHostsPresent: 2,
            },
          },
        };
      }
      if (expr.includes('__captureFocusSample')) {
        this.sampleCount += 1;
        if (this.opts.failAtSample && this.sampleCount === this.opts.failAtSample) {
          throw new Error('injected sample failure token sk-abcdefghij1234567890');
        }
        const seq = ['focus-1', 'focus-2', 'focus-2'];
        const id = seq[Math.min(this.sampleCount - 1, seq.length - 1)];
        return {
          result: {
            value: { id, selector: id === 'focus-1' ? 'a#skip' : 'button.menu', role: this.opts.sampleRole ?? null, name: 'label', rect: null, tabIndex: 0, focusVisibleStyle: null, scrollX: 0, scrollY: 0, isBody: false, hasActiveElement: true },
          },
        };
      }
      if (expr.includes('__captureFocusMarkerCleanup')) {
        this.cleanupCount += 1;
        this.liveMarkers.clear();
        return { result: { value: { markersRemoved: this.liveMarkers.size === 0 } } };
      }
      if (expr.includes('__captureFocusRestore')) {
        this.restoreCount += 1;
        // Only the FINAL restore (the one in the collector's finally window) throws —
        // the mid-walk restore before the reverse pass (call 1) still succeeds. The
        // throw fires BEFORE `liveMarkers.clear()` — mirroring a real Runtime.evaluate
        // call-level failure, where the in-page removeAttribute lines never ran — so
        // the tracked markers genuinely remain live afterward, not just claimed clean.
        if (this.opts.throwOnFinalRestore && this.restoreCount === 2) {
          throw new Error('injected final restore-evaluate failure');
        }
        this.liveMarkers.clear();
        return { result: { value: { focusRestored: true, markersRemoved: this.liveMarkers.size === 0, scrollRestored: true } } };
      }
      return { result: {} };
    }
    return {};
  }
}

test('collectFocus: clean walk carries backendNodeId join keys, scope counts, and restoration facts', async () => {
  const client = new FocusStub();
  const { ctx, written } = makeCtx(client);

  await collectFocus(ctx);

  const focus = written.get('focus.json') as any;
  assert.ok(focus, 'focus.json written');
  assert.deepEqual(focus.forward.map((s: any) => s.id), ['focus-1', 'focus-2']);
  assert.equal(focus.forward[0].backendNodeId, 1010);
  assert.equal(focus.forward[1].backendNodeId, 1011);
  assert.equal(focus.clickableUnfocusable[0].backendNodeId, 2020);

  assert.deepEqual(focus.scope, { root: 'top-document', shadowDom: 'light-only', iframesPresent: 1, shadowHostsPresent: 2 });

  assert.equal(focus.restoration.attempted, true);
  assert.equal(focus.restoration.focusRestored, true);
  assert.equal(focus.restoration.markersCleared, true);
  assert.equal(focus.restoration.scrollRestored, true);
  assert.equal(focus.restoration.error, undefined);
  assert.ok(client.restoreCount >= 1, 'the final restore ran');
  assert.equal(client.liveMarkerCount, 0, 'every tagged marker instance was genuinely untagged (stateful tracking, not a canned true)');
});

test('collectFocus: the forward walk\'s first stop seeds scrollBefore from the TRUE pre-walk origin scroll, not a hardcoded {0,0} (fix #1 evidence)', async () => {
  // Pre-fix, `walk()`'s forward call was seeded with a hardcoded `{x:0,y:0}`
  // for step 1's `scrollBefore` regardless of where the page was actually
  // scrolled before this collector ever ran — reporting a false scroll jump
  // on step 1 of any page that started pre-scrolled. Post-fix, `scrollBefore`
  // for step 1 is seeded from the non-mutating `__captureFocusOrigin` read.
  // `FocusStub`'s `__captureFocusSample` handler always returns
  // `scrollX:0,scrollY:0` regardless of call count, so step 1's `scrollBefore`
  // can ONLY come from the `originScroll` parameter threaded into `walk()` —
  // this test would fail against the pre-fix hardcoded default (which would
  // report `{x:0,y:0}` here instead of the true origin `{x:123,y:456}`).
  const client = new FocusStub({ originScrollX: 123, originScrollY: 456 });
  const { ctx, written } = makeCtx(client);

  await collectFocus(ctx);

  const focus = written.get('focus.json') as any;
  assert.ok(focus, 'focus.json written');
  assert.ok(focus.forward.length >= 1, 'the forward walk produced at least one stop');
  assert.deepEqual(
    focus.forward[0].scrollBefore,
    { x: 123, y: 456 },
    "the forward walk's first stop must be seeded from the TRUE pre-walk origin scroll, not a hardcoded {0,0}",
  );

  // The origin was proven (`originCaptured`), so the reverse walk's own
  // `originScroll` seed is also `origin` (the mid-walk restore scrolled the
  // page back to it before the reverse pass begins) — never a fabricated
  // {0,0} either.
  assert.ok(focus.reverse.length >= 1, 'the reverse walk produced at least one stop');
  assert.deepEqual(
    focus.reverse[0].scrollBefore,
    { x: 123, y: 456 },
    "the reverse walk's first stop must also be seeded from the true origin scroll (restored to before the reverse pass begins), not a fabricated {0,0}",
  );
});

test('collectFocus: a mid-walk sample failure still restores in finally and records a sanitized restoration fact', async () => {
  const client = new FocusStub({ failAtSample: 2 });
  const { ctx, written } = makeCtx(client);

  await collectFocus(ctx);

  const focus = written.get('focus.json') as any;
  assert.ok(focus, 'focus.json written even though the walk threw');
  assert.equal(focus.restoration.attempted, true);
  assert.ok(client.restoreCount >= 1, 'the finally restore ran despite the mid-walk throw');
  assert.equal(focus.restoration.markersCleared, true);
  assert.ok(typeof focus.restoration.error === 'string', 'the thrown error is recorded as a fact');
  assert.ok(!focus.restoration.error.includes('sk-abcdefghij1234567890'), 'the secret-shaped token in the error is redacted');
  assert.match(focus.restoration.error, /\[REDACTED\]/);
});

test('R2: a secret-shaped token planted in a focus stop\'s role attribute is redacted out of focus.json', async () => {
  // `role` is a free-form getAttribute string (author-controlled), so it
  // belongs to the D1 uniform-redaction set alongside selector/name. The
  // sample script reads it raw off document.activeElement; the decorate
  // pass must route it through sanitizeOrNull before it reaches focus.json.
  const secret = 'github_pat_11ABCDE0000ABCDE0000abcdefghijklmnop';
  const client = new FocusStub({ sampleRole: `role-${secret}` });
  const { ctx, written } = makeCtx(client);

  await collectFocus(ctx);

  const focus = written.get('focus.json') as any;
  assert.ok(focus, 'focus.json written');
  const raw = JSON.stringify(focus);
  assert.ok(!raw.includes(secret), 'the page-planted token must not appear anywhere in focus.json');
  const withRole = [...focus.forward, ...focus.reverse].filter((s: any) => typeof s.role === 'string' && s.role.length > 0);
  assert.ok(withRole.length >= 1, 'at least one stop carried the planted role');
  for (const s of withRole) {
    assert.ok(!s.role.includes(secret));
    assert.match(s.role, /\[REDACTED\]/, 'the token in the role attribute is replaced by the redaction marker');
  }
});

test('collectFocus: restores the REAL original active element by its dedicated marker (threads hadOriginalFocus, not the dead originalFocusId)', async () => {
  const client = new FocusStub({ hadOriginalFocus: true });
  const { ctx, written } = makeCtx(client);

  await collectFocus(ctx);

  const focus = written.get('focus.json') as any;
  assert.ok(focus, 'focus.json written');

  const restoreExprs = client.calls
    .filter((c) => c.method === 'Runtime.evaluate' && String((c.params as any)?.expression ?? '').includes('__captureFocusRestore'))
    .map((c) => String((c.params as any).expression));
  assert.ok(restoreExprs.length >= 1, 'a restore evaluate ran');
  for (const expr of restoreExprs) {
    // The restore re-finds the REAL original active element by its dedicated
    // marker — this covers a programmatically focused tabindex=-1 element the
    // tab-order candidate filter skips (which the dead originalFocusId missed).
    assert.match(expr, /data-capture-focus-original/);
    // The collector threaded init.hadOriginalFocus (true) into the restore, NOT
    // the removed originalFocusId field (which would resolve to false here).
    assert.match(expr, /var hadOriginalFocus = true;/);
  }
});

test('collectFocus: a final restore evaluate that itself throws still writes focus.json with restoration.markerCleanupFailed', async () => {
  const client = new FocusStub({ throwOnFinalRestore: true });
  const { ctx, written } = makeCtx(client);

  await collectFocus(ctx);

  const focus = written.get('focus.json') as any;
  assert.ok(focus, 'focus.json written even though the final restore evaluate threw');
  assert.equal(focus.restoration.attempted, true);
  assert.equal(focus.restoration.markerCleanupFailed, true, 'the restore-evaluate throw is recorded as a fact, not swallowed');
  assert.equal(focus.restoration.markersCleared, false, 'markers could not be confirmed cleared when the restore evaluate threw');
  assert.ok(
    client.liveMarkerCount > 0,
    'the markers genuinely remain tagged (stateful tracking, not a canned response) when the final restore evaluate itself throws before it can clear them — proving markersCleared:false is an honest fact about real page state, not a guess',
  );
});

test('collectFocus: an init that throws AFTER partially mutating the page still restores the TRUE original scroll/focus, not blur+(0,0)', async () => {
  // The init script (marker-stamping) throws after — in a real browser — it
  // would already have tagged some candidates. The true original had focus
  // and was scrolled to (123, 456). Pre-fix, `collectFocus` threaded
  // `init.hadOriginalFocus`/`init.scrollX`/`init.scrollY` into every restore
  // call, and `init` stays EMPTY_INIT (hadOriginalFocus: false, scrollX: 0,
  // scrollY: 0) when its own evaluate throws — so restore would blur the
  // real original focus and scroll the page to (0,0). Post-fix, restore is
  // built from a separate non-mutating origin capture that ran BEFORE the
  // throwing init, so it carries the true values regardless.
  const client = new FocusStub({ throwOnInit: true, hadOriginalFocus: true, originScrollX: 123, originScrollY: 456 });
  const { ctx, written } = makeCtx(client);

  await collectFocus(ctx);

  const focus = written.get('focus.json') as any;
  assert.ok(focus, 'focus.json written even though init threw after partial mutation');
  assert.equal(focus.restoration.attempted, true);
  assert.ok(typeof focus.restoration.error === 'string', 'the init throw is recorded as a fact');

  const restoreExprs = client.calls
    .filter((c) => c.method === 'Runtime.evaluate' && String((c.params as any)?.expression ?? '').includes('__captureFocusRestore'))
    .map((c) => String((c.params as any).expression));
  assert.ok(restoreExprs.length >= 1, 'a restore evaluate ran despite the init throw');
  for (const expr of restoreExprs) {
    // The restore parameters come from the origin capture (true original),
    // NOT the EMPTY_INIT fallback (hadOriginalFocus: false, scrollX: 0, scrollY: 0)
    // that `init` collapses to when its own evaluate throws.
    assert.match(expr, /var hadOriginalFocus = true;/, 'restore threads the TRUE hadOriginalFocus, not the EMPTY_INIT false default');
    assert.match(expr, /var scrollX = 123;/, 'restore threads the TRUE original scrollX, not the EMPTY_INIT 0 default');
    assert.match(expr, /var scrollY = 456;/, 'restore threads the TRUE original scrollY, not the EMPTY_INIT 0 default');
  }
});

test('collectFocus: origin evaluate returns no value — throws before the mutating init ever runs, so there is nothing to clean up (no destructive blur/scroll, no marker cleanup either)', async () => {
  // Hole 1, UPDATED: the origin read comes back with NO `.value` at all (a
  // degenerate CDP response, not an exception). The now-reviewed I-5 honesty
  // fix treats this identically to the origin read THROWING (see the
  // adjacent "origin evaluate throws before any mutation" test below): both
  // are genuine origin-proof failures, so `collectFocus` throws immediately
  // — BEFORE `mutationStarted` is ever set to `true` and BEFORE
  // `__captureFocusInit` is ever invoked. `throwOnInit: true` is configured
  // on the stub below but is never exercised, because init never runs.
  // Pre-fix, a no-value origin silently fell back to EMPTY_ORIGIN and let
  // the mutating init proceed, so a marker-only cleanup was needed after the
  // init throw. Post-fix, since no marker was ever stamped, there is
  // genuinely nothing to clean up — `cleanupCount` staying 0 is itself the
  // honest, safe outcome (proven empirically: probing this exact stub shape
  // shows `__captureFocusInit` is never called, `cleanupCount` and
  // `restoreCount` both stay 0, and `restoration.attempted` is `false`).
  const client = new FocusStub({ originReturnsNoValue: true, throwOnInit: true });
  const { ctx, written } = makeCtx(client);

  await collectFocus(ctx);

  const focus = written.get('focus.json') as any;
  assert.ok(focus, 'focus.json written even though the origin read never proved a value');
  assert.equal(focus.available, false, 'the traversal is honestly marked unavailable');
  assert.equal(focus.unavailableReason, 'origin-read-threw', 'attributed to the origin-read step, since init was never reached');
  assert.equal(focus.restoration.error, 'focus origin evaluate returned no value', 'the origin-read failure is recorded as a fact');

  // Safety invariant preserved: zero destructive blur/scroll restore
  // evaluates ran, on the basis of an origin that was never proven.
  const restoreExprs = client.calls.filter(
    (c) => c.method === 'Runtime.evaluate' && String((c.params as any)?.expression ?? '').includes('__captureFocusRestore'),
  );
  assert.equal(restoreExprs.length, 0, 'no destructive blur/scroll restore ran on the basis of an unproven origin');
  assert.equal(client.restoreCount, 0, 'no destructive restore evaluate ran');

  // The mutating init genuinely never ran, so there are no markers to strip
  // either — the marker-only cleanup path is correctly skipped, not merely
  // unobserved.
  const initExprs = client.calls.filter(
    (c) => c.method === 'Runtime.evaluate' && String((c.params as any)?.expression ?? '').includes('__captureFocusInit'),
  );
  assert.equal(initExprs.length, 0, 'the mutating init was never invoked — the origin-read failure is caught before any page mutation begins');
  assert.equal(client.cleanupCount, 0, 'no marker cleanup ran — there was nothing to clean up, since nothing was ever mutated');

  assert.equal(focus.restoration.attempted, false, 'no restore/cleanup attempt happened — mutation never started');
  assert.equal(focus.restoration.focusRestored, false, 'no focus restore was attempted — nothing to report as restored');
  assert.equal(focus.restoration.scrollRestored, false, 'no scroll restore was attempted — nothing to report as restored');
  assert.equal(focus.restoration.markersCleared, false, 'no markers were ever stamped, so none were cleared');
});

test('collectFocus: origin evaluate throws before any mutation — restore is skipped entirely, no destructive blur/scroll', async () => {
  // Hole 2: the origin read THROWS before the mutating init is ever invoked
  // — no origin proven, no marker ever stamped. Pre-fix, `collectFocus`'s
  // `finally` still ran the full destructive restore built from
  // EMPTY_ORIGIN, blurring real focus and scrolling to (0,0) despite nothing
  // having been mutated and nothing proven. Post-fix, restore must be
  // skipped entirely — there is nothing to clean up and nothing to restore.
  const client = new FocusStub({ throwOnOrigin: true });
  const { ctx, written } = makeCtx(client);

  await collectFocus(ctx);

  const focus = written.get('focus.json') as any;
  assert.ok(focus, 'focus.json written even though the origin read threw before any mutation');
  assert.ok(typeof focus.restoration.error === 'string', 'the origin throw is recorded as a fact');

  const initExprs = client.calls.filter(
    (c) => c.method === 'Runtime.evaluate' && String((c.params as any)?.expression ?? '').includes('__captureFocusInit'),
  );
  assert.equal(initExprs.length, 0, 'the mutating init was never invoked — nothing was ever mutated');
  assert.equal(client.restoreCount, 0, 'no destructive blur/scroll restore ran');
  assert.equal(client.cleanupCount, 0, 'no marker cleanup ran either — there was nothing to clean up');

  assert.equal(focus.restoration.attempted, false, 'restoration was skipped entirely — nothing proven, nothing mutated');
  assert.equal(focus.restoration.focusRestored, false);
  assert.equal(focus.restoration.scrollRestored, false);
  assert.equal(focus.restoration.markersCleared, false);
});

// ============================================================================
// scroll.ts
// ============================================================================

class ScrollStub {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  cleanupRan = false;

  constructor(private readonly opts: { failTopology?: boolean; topology?: unknown } = {}) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'Runtime.evaluate') {
      const expr = String((params as { expression?: unknown }).expression ?? '');
      if (expr.includes('__captureScrollTopology')) {
        if (this.opts.failTopology) throw new Error('topology boom');
        return { result: { value: this.opts.topology } };
      }
      if (expr.includes('__captureScrollCleanup')) {
        this.cleanupRan = true;
        return { result: { value: { cleared: true } } };
      }
      return { result: {} };
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') return { nodeIds: [] };
    if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 390 }, cssLayoutViewport: { clientWidth: 390 } };
    return {};
  }
}

test('collectScroll: an in-page offset restoration failure is surfaced as a fact, and markers are still cleaned', async () => {
  const topology = {
    containers: [],
    documentScrollHeight: 1000,
    documentScrollWidth: 390,
    offsetsRestored: false,
    iframesPresent: 3,
    shadowHostsPresent: 1,
    scriptError: 'sampling failed with token sk-abcdefghij1234567890',
  };
  const client = new ScrollStub({ topology });
  const { ctx, written } = makeCtx(client);

  await collectScroll(ctx);

  const scroll = written.get('scroll.json') as any;
  assert.ok(scroll, 'scroll.json written');
  assert.equal(scroll.restoration.attempted, true);
  assert.equal(scroll.restoration.offsetsRestored, false, 'the in-page restoration failure is reported factually');
  assert.equal(scroll.restoration.markersCleared, true, 'markers are cleaned even though offset restore reported failure');
  assert.ok(client.cleanupRan, 'the marker cleanup eval ran');
  assert.match(scroll.restoration.error, /\[REDACTED\]/);
  assert.ok(!scroll.restoration.error.includes('sk-abcdefghij1234567890'));
  assert.deepEqual(scroll.scope, { root: 'top-document', shadowDom: 'light-only', iframesPresent: 3, shadowHostsPresent: 1 });
});

test('collectScroll: a thrown topology eval still writes restoration facts and cleans markers', async () => {
  const client = new ScrollStub({ failTopology: true });
  const { ctx, written } = makeCtx(client);

  await collectScroll(ctx);

  const scroll = written.get('scroll.json') as any;
  assert.ok(scroll, 'scroll.json written despite the topology eval throwing');
  assert.equal(scroll.restoration.attempted, true);
  assert.equal(scroll.restoration.offsetsRestored, false);
  assert.equal(scroll.restoration.markersCleared, true, 'cleanup still ran after the topology throw');
  assert.ok(client.cleanupRan);
  assert.deepEqual(scroll.containers, []);
});

// ============================================================================
// states.ts — customValidity preservation + radio-group peer restoration
// ============================================================================

interface StateFixtureEl {
  nodeId: number;
  nodeName: string;
  attributes: string[];
  type?: string;
  name?: string;
  checked?: boolean;
  hadCustom?: boolean;
  customMessage?: string;
}

/**
 * A round-tripping states stub: force expressions mutate the fixture and
 * return the captured `prev`; the collector embeds that prev in the restore
 * expression it generates; this stub PARSES the embedded prev back out and
 * applies the real restore semantics — so the fixture's final state proves
 * the collector threaded the pre-force snapshot through to restoration.
 */
class StatesStub {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  private readonly selectorToNodeIds = new Map<string, number[]>();
  private readonly nodesById = new Map<number, StateFixtureEl>();
  private factsCalls = 0;
  private readonly domQuerySelectorAllCallCount = new Map<string, number>();

  constructor(
    elements: StateFixtureEl[],
    selectorMap: Record<string, number[]>,
    private readonly opts: {
      failAfterForce?: boolean;
      /** Item 7.4 hardening: simulates the page reordering the radio group's bookkeeping (a DOM re-render) AFTER force tags each peer's stable handle but BEFORE restore runs — so a regression from stable-handle to positional peer resolution would misapply a DIFFERENT peer's recorded state. */
      reorderPeersAfterForce?: boolean;
      /** Item 7.5 (fix #4) hardening: on the SECOND CDP `DOM.querySelectorAll` call for this selector (the post-force `identityStillMatches` recheck — the FIRST call is `collectStates`'s own initial resolution), return a DIFFERENT nodeId set, simulating a synchronous reorder/replace between the two resolutions. */
      secondQuerySelectorAllOverride?: { selector: string; nodeIds: number[] };
      /** Item 7.2 (fix #2) hardening: short-circuits EVERY `__captureStateForce_*` call to a canned `{ supported: false, reason }` (bypassing all mutation) so a force-response `reason` string can be planted directly — proving the NODE-SIDE `sanitizeString(value.reason)` call in `captureOneElement`, not this stub, is what redacts it. */
      forceRejectReason?: string;
    } = {},
  ) {
    for (const el of elements) this.nodesById.set(el.nodeId, el);
    for (const [sel, ids] of Object.entries(selectorMap)) this.selectorToNodeIds.set(sel, ids);
  }

  private radioGroup(el: StateFixtureEl): StateFixtureEl[] {
    return [...this.nodesById.values()].filter((e) => e.type === 'radio' && e.name === el.name);
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') {
      const sel = String((params as { selector?: unknown }).selector ?? '');
      const count = (this.domQuerySelectorAllCallCount.get(sel) ?? 0) + 1;
      this.domQuerySelectorAllCallCount.set(sel, count);
      if (this.opts.secondQuerySelectorAllOverride && this.opts.secondQuerySelectorAllOverride.selector === sel && count === 2) {
        return { nodeIds: this.opts.secondQuerySelectorAllOverride.nodeIds };
      }
      return { nodeIds: this.selectorToNodeIds.get(sel) ?? [] };
    }
    if (method === 'DOM.describeNode') {
      const nodeId = (params as { nodeId?: number }).nodeId;
      const el = this.nodesById.get(nodeId!);
      return { node: { nodeName: el?.nodeName ?? 'DIV', backendNodeId: (nodeId ?? 0) * 100, attributes: el?.attributes ?? [] } };
    }
    if (method === 'CSS.forcePseudoState') return {};
    if (method === 'Runtime.evaluate') {
      const expr = String((params as { expression?: unknown }).expression ?? '');
      return { result: { value: this.evalExpression(expr) } };
    }
    return {};
  }

  private resolveBySelectorIndex(expr: string): StateFixtureEl | undefined {
    const m = expr.match(/document\.querySelectorAll\((".*?")\)\[(\d+)\]/);
    if (!m) return undefined;
    const sel = JSON.parse(m[1]) as string;
    const idx = Number(m[2]);
    const nodeId = this.selectorToNodeIds.get(sel)?.[idx];
    return nodeId === undefined ? undefined : this.nodesById.get(nodeId);
  }

  private findByAttr(attr: string, value: string): StateFixtureEl | undefined {
    for (const el of this.nodesById.values()) {
      for (let i = 0; i + 1 < el.attributes.length; i += 2) {
        if (el.attributes[i] === attr && el.attributes[i + 1] === value) return el;
      }
    }
    return undefined;
  }

  private resolveByMarker(expr: string): StateFixtureEl | undefined {
    const m = expr.match(/data-capture-state-id=\\?"([A-Za-z0-9_-]+)/);
    return m ? this.findByAttr('data-capture-state-id', m[1]) : undefined;
  }

  private removeAttr(el: StateFixtureEl, attr: string): void {
    for (let i = 0; i + 1 < el.attributes.length; i += 2) {
      if (el.attributes[i] === attr) {
        el.attributes.splice(i, 2);
        return;
      }
    }
  }

  // Balanced-brace extraction of the `var prev = <JSON>;` literal the real
  // restore expression embeds. The naive /\{.*?\}/ match stops at the first
  // `}` — which now sits INSIDE the nested `radioGroup: [{rid,checked}]` array
  // — so scan matching braces instead (proving the new nested shape round-trips).
  private parsePrev(expr: string): any {
    const marker = 'var prev = ';
    const start = expr.indexOf(marker);
    if (start === -1) return null;
    let i = start + marker.length;
    if (expr[i] !== '{') return null;
    const from = i;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (; i < expr.length; i++) {
      const ch = expr[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    try {
      return JSON.parse(expr.slice(from, i));
    } catch {
      return null;
    }
  }

  private evalExpression(expr: string): unknown {
    if (expr.includes('__captureStateFacts')) {
      const el = this.resolveBySelectorIndex(expr);
      if (!el) return { exists: false };
      this.factsCalls += 1;
      // Inject a mid-capture failure on the SECOND facts call — the post-force
      // "after" capture — so restoration must still run in the collector's
      // finally window on the native invalid/checked mutation paths.
      if (this.opts.failAfterForce && this.factsCalls === 2) {
        throw new Error('simulated CDP failure during post-force capture');
      }
      return { exists: true, tag: el.nodeName, rect: { x: 0, y: 0, width: 10, height: 10 }, style: { color: 'rgb(0,0,0)' }, hit: { isTarget: true, topTag: el.nodeName }, text: '', axName: null };
    }

    if (this.opts.forceRejectReason && expr.includes('__captureStateForce_')) {
      // Bypasses ALL mutation — proves the sanitization under test happens
      // NODE-SIDE (in captureOneElement's `reason = value?.reason ? sanitizeString(value.reason) : ...`),
      // not by this stub scrubbing anything itself.
      return { supported: false, reason: this.opts.forceRejectReason };
    }

    if (expr.includes('__captureStateForce_invalid')) {
      const el = this.resolveBySelectorIndex(expr);
      if (!el) return { supported: false, reason: 'element no longer present' };
      const prev = { hadCustom: !!el.hadCustom, prevMsg: el.hadCustom ? (el.customMessage ?? '') : '' };
      const markerId = expr.match(/data-capture-state-id',\s*"([^"]+)"/)?.[1];
      if (markerId) el.attributes.push('data-capture-state-id', markerId);
      el.hadCustom = true;
      el.customMessage = 'capture-forced-invalid';
      return { supported: true, prev };
    }
    if (expr.includes('__captureStateRestore_invalid')) {
      const el = this.resolveByMarker(expr);
      if (!el) return { restored: false, reason: 'element no longer present' };
      const prev = this.parsePrev(expr);
      el.hadCustom = !!(prev && prev.hadCustom);
      el.customMessage = prev && prev.hadCustom ? prev.prevMsg : '';
      this.removeAttr(el, 'data-capture-state-id');
      return { restored: true };
    }

    if (expr.includes('__captureStateForce_checked')) {
      const el = this.resolveBySelectorIndex(expr);
      if (!el || !('checked' in el)) return { supported: false, reason: 'element has no checked property' };
      const markerId = expr.match(/data-capture-state-id',\s*"([^"]+)"/)?.[1];
      if (markerId) el.attributes.push('data-capture-state-id', markerId);
      const prevChecked = !!el.checked;
      let radioGroup: Array<{ rid: string; checked: boolean }> | null = null;
      if (el.type === 'radio' && el.name) {
        const peers = this.radioGroup(el);
        // NEW shape: each peer gets a STABLE data-capture-state-radio-id handle,
        // and its pre-force checked value is snapshotted against that handle.
        radioGroup = peers.map((p, i) => {
          const rid = `${markerId}-radio-${i}`;
          p.attributes.push('data-capture-state-radio-id', rid);
          return { rid, checked: !!p.checked };
        });
        for (const p of peers) p.checked = p === el; // real radio semantics: forcing one unchecks its peers
        if (this.opts.reorderPeersAfterForce) {
          // Simulate the page reordering these peers in the DOM AFTER force
          // tagged them (their stable data-capture-state-radio-id handles are
          // UNCHANGED by this) — a restore that regressed to resolving peers by
          // a re-derived positional index (rather than by that stable handle)
          // would misapply a DIFFERENT peer's recorded prev-state entry once
          // this reorder has happened.
          const rotated = [...peers.slice(1), peers[0]];
          for (const p of rotated) this.nodesById.delete(p.nodeId);
          for (const p of rotated) this.nodesById.set(p.nodeId, p);
        }
      }
      el.checked = true;
      return { supported: true, prev: { checked: prevChecked, radioGroup } };
    }
    if (expr.includes('__captureStateRestore_checked')) {
      const el = this.resolveByMarker(expr);
      if (!el) return { restored: false, reason: 'element no longer present' };
      const prev = this.parsePrev(expr);
      el.checked = !!(prev && prev.checked);
      if (prev && prev.radioGroup && el.type === 'radio') {
        for (const entry of prev.radioGroup) {
          if (!entry || !entry.rid) continue;
          // Resolve each peer by its STABLE handle, NOT by re-running
          // querySelectorAll('input[type=radio]') order.
          const peer = this.findByAttr('data-capture-state-radio-id', entry.rid);
          if (peer) {
            peer.checked = !!entry.checked;
            this.removeAttr(peer, 'data-capture-state-radio-id');
          }
        }
      }
      this.removeAttr(el, 'data-capture-state-id');
      return { restored: true };
    }

    return {};
  }
}

// ============================================================================
// Item 7.3 (fix #3) evidence — LITERALLY executes the real, production
// `buildRestoreExpression` output (states.ts is not mine to edit and does not
// export the builder, but its generated string is sent verbatim over
// `Runtime.evaluate`; this stub intercepts THAT string and runs it for real
// via `new Function`, mirroring `test/measure-states.test.ts`'s
// `RealForceExpressionStub` pattern but for restore instead of force). Facts
// and force are CANNED (not literally executed — only restore integrity is
// under test here), so the fake DOM only needs to model what restore reads:
// a primary element found by its `data-capture-state-id` marker, and radio
// peers found by their stable `data-capture-state-radio-id` handles.
// ============================================================================

interface FakeAttrEl {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
}

function withAttrs<T extends object>(target: T): T & FakeAttrEl {
  const attrs = new Map<string, string>();
  return Object.assign(target, {
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
    removeAttribute(name: string) {
      attrs.delete(name);
    },
    hasAttribute(name: string) {
      return attrs.has(name);
    },
    getAttribute(name: string) {
      return attrs.has(name) ? (attrs.get(name) as string) : null;
    },
  });
}

/**
 * A fake radio peer for the REAL restore expression to operate on.
 * `throwOnCheckedSet`, when true, makes the `.checked` SETTER throw
 * unconditionally (modeling a hostile peer whose native property write
 * fails) — the getter and the value are otherwise untouched by the throw,
 * so a failed write is observably a no-op, not a partial mutation.
 */
function makeRestoreFakeRadio(name: string, initialChecked: boolean, opts: { throwOnCheckedSet?: boolean } = {}): FakeAttrEl & { type: string; name: string; checked: boolean } {
  const el = withAttrs({ type: 'radio', name }) as FakeAttrEl & { type: string; name: string; checked: boolean };
  let checkedValue = initialChecked;
  Object.defineProperty(el, 'checked', {
    configurable: true,
    get() {
      return checkedValue;
    },
    set(_v: boolean) {
      if (opts.throwOnCheckedSet) throw new Error('simulated hostile radio-peer checked setter failure');
      checkedValue = _v;
    },
  });
  return el;
}

/** Fake `document` supporting only the `[attr="value"]` attribute-selector form `buildRestoreExpression` generates (`document.querySelector('[data-capture-state-id="..."]')` / `'[data-capture-state-radio-id="..."]'`). */
function makeRestoreFakeDocument(elements: FakeAttrEl[]): { querySelector(sel: string): FakeAttrEl | null } {
  return {
    querySelector(sel: string): FakeAttrEl | null {
      const m = sel.match(/^\[([a-zA-Z0-9_-]+)="([^"]*)"\]$/);
      if (!m) return null;
      const [, attr, value] = m;
      for (const el of elements) {
        if (el.getAttribute(attr) === value) return el;
      }
      return null;
    },
  };
}

class RealRestoreExpressionStub {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  /** Set true if the executed `__captureStateRestore_*` expression itself threw synchronously instead of resolving to a value — a template regression that would defeat the whole point of the `__safe` best-effort wrapping. */
  restoreExpressionEscaped = false;

  constructor(
    private readonly fakeDocument: { querySelector(sel: string): unknown },
    private readonly describedNode: { nodeName: string; backendNodeId: number; attributes: string[] },
    private readonly forceResult: { supported: boolean; reason?: string; prev?: unknown },
  ) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params: { ...params } });

    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') return { nodeIds: [1] };
    if (method === 'DOM.describeNode') return { node: this.describedNode };

    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureStateFacts')) {
        return {
          result: {
            value: {
              exists: true,
              tag: this.describedNode.nodeName,
              rect: { x: 0, y: 0, width: 16, height: 16 },
              style: {},
              hit: { isTarget: true, topTag: this.describedNode.nodeName },
              text: '',
              axName: null,
            },
          },
        };
      }
      if (expression.includes('__captureStateForce_')) {
        return { result: { value: this.forceResult } };
      }
      if (expression.includes('__captureStateRestore_')) {
        let value: unknown;
        try {
          // eslint-disable-next-line no-new-func -- executing the REAL generated restore template is the whole point of this stub.
          value = new Function('document', 'return (' + expression + ');')(this.fakeDocument);
        } catch (e) {
          this.restoreExpressionEscaped = true;
          throw e;
        }
        return { result: { value } };
      }
      return { result: { value: {} } };
    }

    return {};
  }
}

// ============================================================================
// Items 7.4/7.5 (2026-07-09 review findings #2/#3) evidence — a richer
// literal-execution harness that, unlike `RealRestoreExpressionStub` above
// (facts/force CANNED, restore only literally executed), ALSO literally
// executes the real, production `__captureStateFacts` and
// `__captureStateForce_*` expressions `states.ts` sends over
// `Runtime.evaluate`, via `new Function`, against a fake DOM supporting BOTH
// the FROZEN `document.querySelectorAll(selector)[index]` positional locate
// form (facts/force) and the `[attr="value"]` stable-handle form (restore)
// — so a malformed/drifted in-page expression in ANY of the three phases is
// caught, not just pattern-matched or hand-simulated. CDP-level node
// identity (`DOM.querySelectorAll`/`DOM.describeNode`, used by
// `resolveNodeIds`/`identityStillMatches`) is kept as a bookkeeping layer
// SEPARATE from the in-page fake document, mirroring real Chrome's own
// separation between CDP node ids and in-page DOM objects.
// ============================================================================

interface FakeStateEl extends FakeAttrEl {
  tagName: string;
  className: string;
  type?: string;
  name?: string;
  checked?: boolean;
  form: undefined;
  textContent: string;
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
}

function makeFakeStateEl(
  tagName: string,
  className: string,
  opts: { type?: string; name?: string; checked?: boolean; rect?: { x: number; y: number; width: number; height: number } } = {},
): FakeStateEl {
  const el = withAttrs({
    tagName,
    className,
    type: opts.type,
    name: opts.name,
    form: undefined,
    textContent: '',
    getBoundingClientRect() {
      return opts.rect ?? { x: 0, y: 0, width: 16, height: 16 };
    },
  }) as FakeStateEl;
  if (opts.checked !== undefined) el.checked = opts.checked;
  return el;
}

/**
 * Wires REAL native radio-group semantics onto already-created fake radios:
 * setting one peer's `.checked = true` unchecks every OTHER peer sharing
 * this group array — exactly like a real `<input type="radio">` group — so
 * the force script's bare `el.checked = true` (which RELIES on that native
 * behavior; it never explicitly unchecks peers itself) produces a genuine
 * group state, not a hand-simulated one.
 */
function wireFakeRadioGroup(peers: FakeStateEl[]): void {
  const backing = new Map<FakeStateEl, boolean>(peers.map((p) => [p, !!p.checked]));
  for (const p of peers) {
    Object.defineProperty(p, 'checked', {
      configurable: true,
      get() {
        return backing.get(p)!;
      },
      set(v: boolean) {
        backing.set(p, v);
        if (v) {
          for (const other of peers) if (other !== p) backing.set(other, false);
        }
      },
    });
  }
}

function fakeStateSelectorMatch(el: FakeStateEl, sel: string): boolean {
  const attrForm = sel.match(/^([a-zA-Z0-9]*)\[([a-zA-Z0-9_-]+)="([^"]*)"\]$/);
  if (attrForm) {
    const [, tag, attr, value] = attrForm;
    if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    if (attr === 'type') return (el.type ?? '') === value;
    return el.getAttribute(attr) === value;
  }
  const parts = sel.split('.');
  const tag = parts[0];
  if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  return parts.slice(1).every((cls) => el.className.split(/\s+/).includes(cls));
}

/** Fake `document` supporting the FROZEN `querySelectorAll(selector)[index]` positional locate form (facts/force), the `input[type="radio"]` peer-scan, and the `[attr="value"]` stable-handle form (restore) — everything the three real generated expressions read. Reads `elements` LIVE (not a snapshot) so a test can reorder the backing array between force and restore and have that reorder observed. */
function makeFakeStateDocument(elements: FakeStateEl[]): {
  querySelectorAll(sel: string): FakeStateEl[];
  querySelector(sel: string): FakeStateEl | null;
  elementsFromPoint(x: number, y: number): FakeStateEl[];
} {
  return {
    querySelectorAll(sel: string) {
      return elements.filter((el) => fakeStateSelectorMatch(el, sel));
    },
    querySelector(sel: string) {
      return elements.find((el) => fakeStateSelectorMatch(el, sel)) ?? null;
    },
    elementsFromPoint() {
      return [];
    },
  };
}

const FAKE_STATE_WINDOW = { innerWidth: 1000, innerHeight: 1000 };
function fakeStateGetComputedStyle(): { getPropertyValue(prop: string): string } {
  return { getPropertyValue: () => '' };
}

/**
 * Executes the REAL generated `__captureStateFacts`, `__captureStateForce_*`,
 * AND `__captureStateRestore_*` expressions — nothing in this class hand-
 * simulates any of the three phases; `states.ts` is not mine to edit and
 * does not export the builders, so this stub intercepts the literal strings
 * it sends over `Runtime.evaluate` and runs them for real via `new
 * Function`. `opts.afterForceMutate`, when given, runs immediately after a
 * `__captureStateForce_*` expression resolves — letting a test simulate the
 * page mutating the DOM (reordering elements, changing a property) in the
 * window BETWEEN force and restore, exactly where a hostile/dynamic page
 * could act.
 */
class RealStatesExpressionStub {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  private readonly fakeDocument: ReturnType<typeof makeFakeStateDocument>;
  private readonly domQuerySelectorAllCallCount = new Map<string, number>();

  constructor(
    private readonly elements: FakeStateEl[],
    private readonly cdpSelectorToNodeIds: Record<string, number[]>,
    private readonly describeById: Record<number, { nodeName: string; backendNodeId: number; attributes: string[] }>,
    private readonly opts: {
      secondQuerySelectorAllOverride?: { selector: string; nodeIds: number[] };
      afterForceMutate?: (elements: FakeStateEl[]) => void;
    } = {},
  ) {
    this.fakeDocument = makeFakeStateDocument(this.elements);
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params: { ...params } });
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') {
      const sel = String((params as { selector?: unknown }).selector ?? '');
      const count = (this.domQuerySelectorAllCallCount.get(sel) ?? 0) + 1;
      this.domQuerySelectorAllCallCount.set(sel, count);
      if (this.opts.secondQuerySelectorAllOverride && this.opts.secondQuerySelectorAllOverride.selector === sel && count === 2) {
        return { nodeIds: this.opts.secondQuerySelectorAllOverride.nodeIds };
      }
      return { nodeIds: this.cdpSelectorToNodeIds[sel] ?? [] };
    }
    if (method === 'DOM.describeNode') {
      const nodeId = (params as { nodeId?: number }).nodeId ?? 0;
      return { node: this.describeById[nodeId] ?? { nodeName: 'DIV', backendNodeId: nodeId * 100, attributes: [] } };
    }
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureStateFacts')) {
        // eslint-disable-next-line no-new-func -- executing the REAL generated facts template is the whole point of this stub.
        const value = new Function('document', 'window', 'getComputedStyle', 'return (' + expression + ');')(
          this.fakeDocument,
          FAKE_STATE_WINDOW,
          fakeStateGetComputedStyle,
        );
        return { result: { value } };
      }
      if (expression.includes('__captureStateForce_')) {
        // eslint-disable-next-line no-new-func -- executing the REAL generated force template is the whole point of this stub.
        const value = new Function('document', 'return (' + expression + ');')(this.fakeDocument);
        this.opts.afterForceMutate?.(this.elements);
        return { result: { value } };
      }
      if (expression.includes('__captureStateRestore_')) {
        // eslint-disable-next-line no-new-func -- executing the REAL generated restore template is the whole point of this stub.
        const value = new Function('document', 'return (' + expression + ');')(this.fakeDocument);
        return { result: { value } };
      }
      return { result: { value: {} } };
    }
    return {};
  }
}

test("collectStates: the REAL generated buildRestoreExpression 'checked' JS continues restoring the other radio peers, and the primary element's own write/marker removal, when one peer's checked setter throws (executed against a fake DOM, not hand-simulated) (fix #3 evidence)", async () => {
  // el = r2, the FORCED radio (its own pre-force value was false). r1 was
  // the originally-checked peer (true) and has a HOSTILE checked setter that
  // throws unconditionally. r3 is a normal, non-hostile peer whose CURRENT
  // (live, pre-restore) checked value is deliberately left at `true` even
  // though its recorded original is `false` — so its restoration to `false`
  // is an observable, non-trivial effect of the restore actually running for
  // it, not a value it already happened to hold.
  const el = makeRestoreFakeRadio('plan', false);
  el.setAttribute('data-capture-state-id', 'state-0');
  el.setAttribute('data-capture-state-radio-id', 'state-0-radio-1');

  const r1 = makeRestoreFakeRadio('plan', true, { throwOnCheckedSet: true });
  r1.setAttribute('data-capture-state-radio-id', 'state-0-radio-0');

  const r3 = makeRestoreFakeRadio('plan', true);
  r3.setAttribute('data-capture-state-radio-id', 'state-0-radio-2');

  const fakeDocument = makeRestoreFakeDocument([el, r1, r3]);

  const prev = {
    checked: false, // el's (r2's) own pre-force value
    radioGroup: [
      { rid: 'state-0-radio-0', checked: true }, // r1's pre-force value
      { rid: 'state-0-radio-1', checked: false }, // el's own pre-force value, redundantly present as a peer too (mirrors the real force script, whose peer scan includes el itself)
      { rid: 'state-0-radio-2', checked: false }, // r3's pre-force value
    ],
  };

  const client = new RealRestoreExpressionStub(
    fakeDocument,
    { nodeName: 'INPUT', backendNodeId: 9100, attributes: ['class', 'r2'] },
    { supported: true, prev },
  );
  const { ctx, written } = makeCtx(client, { state: ['checked:input.r2'] });

  await collectStates(ctx);

  assert.equal(
    client.restoreExpressionEscaped,
    false,
    'a hostile radio peer checked-setter throw must NOT escape the restore IIFE — pre-fix, buildRestoreExpression had no __safe wrapping at all, so this throw would have propagated straight out of the generated expression',
  );

  const states = written.get('states.json') as any;
  const rec = states.elements[0];
  assert.equal(rec.supported, true);
  assert.deepEqual(
    rec.forced,
    { applied: true, restored: false },
    'ONE step (r1\'s checked write) genuinely failed, so restored is honestly false — never a false claim of clean restoration',
  );

  // The primary element's OWN write and its OWN marker removal still ran.
  assert.equal(el.checked, false, "the forced element's own checked value is restored to its pre-force original");
  assert.equal(el.hasAttribute('data-capture-state-id'), false, "the forced element's own data-capture-state-id marker is removed (a __safe step AFTER the peer loop, which still runs despite a peer's earlier failure)");

  // The hostile peer's checked WRITE failed (its value is left as whatever it
  // already held) but its OWN radio-id marker removal — a SEPARATE __safe
  // call in the same loop iteration — still ran. Pre-fix (no per-step
  // wrapping at all), a throw from `peer.checked = ...` would have aborted
  // the ENTIRE expression, leaving r1's own marker removal, r3's restoration,
  // AND the final primary-marker removal above all unexecuted.
  assert.equal(r1.checked, true, "r1's checked write threw, so its value is left unchanged by the failed set");
  assert.equal(r1.hasAttribute('data-capture-state-radio-id'), false, "r1's own radio-id marker removal is a SEPARATE __safe step from its checked write and still runs despite that write throwing");

  // The OTHER (non-hostile) peer restores fully — proving the loop continues
  // past r1's failure rather than aborting the whole restore.
  assert.equal(r3.checked, false, "r3's restoration to its recorded original (false) still ran despite r1's earlier failure in the same loop");
  assert.equal(r3.hasAttribute('data-capture-state-radio-id'), false, "r3's own radio-id marker removal still ran despite r1's earlier failure");
});

test('collectStates: a mid-capture failure on the native invalid path still restores the pre-existing customValidity exactly', async () => {
  const input: StateFixtureEl = { nodeId: 30, nodeName: 'INPUT', attributes: ['class', 'email'], type: 'email', hadCustom: true, customMessage: 'pre-existing app error' };
  const client = new StatesStub([input], { 'input.email': [30] }, { failAfterForce: true });
  const { ctx, written } = makeCtx(client, { state: ['invalid:input.email'] });

  await collectStates(ctx);

  const states = written.get('states.json') as any;
  assert.ok(states, 'states.json written even though the post-force capture threw');
  const rec = states.elements[0];
  assert.equal(rec.state, 'invalid');
  assert.equal(rec.supported, false, 'the injected mid-capture failure marks the record unsupported');
  assert.match(rec.reason ?? '', /facts read failed after forcing state/);
  assert.equal(rec.factsUnavailable, true, 'the post-force facts read is honestly marked unavailable, not a generic capture error');
  assert.deepEqual(rec.forced, { applied: true, restored: true }, 'restoration ran in the finally window despite the mid-capture failure');

  // The forced 'capture-forced-invalid' message is rolled back to the pre-existing
  // app-set validity EXACTLY — not wiped to '' and not left forced.
  assert.equal(input.hadCustom, true);
  assert.equal(input.customMessage, 'pre-existing app error');
  assert.equal(states.scope.root, 'top-document');
});

test('collectStates: the REAL generated buildForceExpression/buildRestoreExpression "checked" JS restores every radio peer by its stable handle after a positional reorder AND after the page mutates the target\'s type/name between force and restore (executed against a fake DOM, not hand-simulated) (item #4 + fix #1 evidence)', async () => {
  // Only ONE radio may be genuinely `checked` at a time within a shared
  // `name` group (that's what `wireFakeRadioGroup` enforces — real native
  // semantics), so r1 alone starts checked. r1's post-restore value (true)
  // is distinguishable from its post-FORCE value (false, auto-unchecked by
  // native radio semantics when r2 is force-checked) — a skipped restore
  // leaves it at the wrong (post-force) value, a correct restore puts it
  // back at true.
  const r1 = makeFakeStateEl('INPUT', 'r1', { type: 'radio', name: 'plan', checked: true });
  const r2 = makeFakeStateEl('INPUT', 'r2', { type: 'radio', name: 'plan', checked: false }); // the forced target
  const r3 = makeFakeStateEl('INPUT', 'r3', { type: 'radio', name: 'plan', checked: false });
  const elements = [r1, r2, r3];
  wireFakeRadioGroup(elements);

  const client = new RealStatesExpressionStub(
    elements,
    { 'input.r2': [42] },
    { 42: { nodeName: 'INPUT', backendNodeId: 4200, attributes: ['class', 'r2'] } },
    {
      afterForceMutate: (els) => {
        // Item #4: simulate a page re-render reordering the peer bookkeeping
        // AFTER force tagged each peer's stable data-capture-state-radio-id
        // handle (the handles themselves are unaffected by array order) — a
        // restore that regressed to a re-derived POSITIONAL peer lookup
        // would misapply a different peer's recorded prev-state entry once
        // this reorder has happened.
        els.push(els.shift()!);
        // Fix #1: simulate the page mutating the FORCED element's type/name
        // between force and restore (e.g. a framework re-render swapping the
        // control). Pre-fix, buildRestoreExpression's peer-restore loop was
        // gated on `el.type === 'radio' && el.name` read AT RESTORE TIME —
        // this mutation makes that gate false, so pre-fix the ENTIRE recorded
        // peer loop is skipped (r1/r3 never restored, their markers never
        // cleared) while `{ restored: true }` is still dishonestly returned.
        // Post-fix, `prev.radioGroup` (captured at FORCE time) is the sole
        // authority, independent of the target's current type/name.
        r2.type = 'text';
        r2.name = undefined;
      },
    },
  );
  const { ctx, written } = makeCtx(client, { state: ['checked:input.r2'] });

  await collectStates(ctx);

  const states = written.get('states.json') as any;
  const rec = states.elements[0];
  assert.equal(rec.state, 'checked');
  assert.equal(rec.supported, true);
  assert.deepEqual(
    rec.forced,
    { applied: true, restored: true },
    'every recorded peer restored successfully (no throwing setters in this test), so restored:true is an HONEST claim here — not the pre-fix dishonest true that ships even when every peer restore was skipped by the gate',
  );

  // Despite the reorder AND the type/name mutation, each peer restores to
  // its OWN correct original value. RED against the pre-fix gated code: r2's
  // mutated type/name would fail the `el.type === 'radio' && el.name` gate,
  // skipping the WHOLE peer loop, leaving r1 stuck at its post-force value
  // (false) instead of its recorded original (true).
  assert.equal(r1.checked, true, "r1 restores to its own correct original (true), not left at its post-force auto-unchecked value, and not misapplied from a different peer's slot after the positional reorder");
  assert.equal(r2.checked, false, "the forced radio's own primary write always runs (unconditional), restoring it to its own correct original (false)");
  assert.equal(r3.checked, false, "r3 keeps its own correct original (false) — restoring r1's peer entry to true correctly re-triggers native uncheck-siblings semantics rather than leaving two peers checked at once");

  // Every recorded peer's data-capture-state-radio-id marker is cleaned up —
  // including r2's OWN entry (the force script's peer scan includes the
  // target itself). RED pre-fix: the gate-skipped loop never runs any
  // marker removal, leaving all three markers stuck.
  assert.equal(r1.hasAttribute('data-capture-state-radio-id'), false, "r1's radio-id marker is cleared");
  assert.equal(r2.hasAttribute('data-capture-state-radio-id'), false, "r2's own radio-id marker is cleared");
  assert.equal(r3.hasAttribute('data-capture-state-radio-id'), false, "r3's radio-id marker is cleared");
  assert.equal(r2.hasAttribute('data-capture-state-id'), false, "the forced element's primary marker is cleared");
});

test('collectStates: a force-response reason containing a secret-shaped token is sanitized before reaching states.json (fix #2 evidence, the force-response reason path, distinct from the outer capture-error path)', async () => {
  // Pre-fix, `captureOneElement`'s non-pseudo force branch did
  // `reason = value?.reason ?? 'unsupported'` — the in-page force/rollback
  // `reason` string (page-controlled: it embeds a hostile setter's own
  // `Error.message` via `rolledBackReason`) reached `states.json` RAW.
  // Post-fix it is routed through `sanitizeString`. This is a NEW path from
  // the existing `/capture error/` assertions elsewhere in this file (those
  // cover the OUTER Node-side catch block's `captureErrorReason`, which was
  // already sanitized before this fix) — this one exercises the force
  // RESPONSE's own `reason` field specifically.
  const secret = 'sk-abcdefghij1234567890';
  const input: StateFixtureEl = { nodeId: 70, nodeName: 'INPUT', attributes: ['class', 'secret-input'], type: 'checkbox', checked: false };
  const client = new StatesStub([input], { 'input.secret-input': [70] }, {
    forceRejectReason: `force failed (rolled back): simulated hostile setter failure ${secret}`,
  });
  const { ctx, written } = makeCtx(client, { state: ['checked:input.secret-input'] });

  await collectStates(ctx);

  const rec = (written.get('states.json') as any).elements[0];
  assert.equal(rec.supported, false);
  assert.doesNotMatch(rec.reason ?? '', /capture error/, 'this is the force-response reason path, not the outer capture-error catch-block path');
  assert.match(rec.reason ?? '', /\[REDACTED\]/, 'the in-page force-response reason is routed through node-side sanitization');
  assert.ok(!(rec.reason ?? '').includes(secret), 'the raw secret-shaped token never reaches states.json');
});

test('collectStates: a synchronous reorder between the initial resolution and the post-force identity recheck marks the record unsupported with delta fields absent, proven against the REAL executed __captureStateFacts/__captureStateForce_checked JS (not hand-simulated) (fix #4 evidence)', async () => {
  // `identityStillMatches` re-resolves `selector[index]`'s CURRENT
  // backendNodeId via a SECOND `DOM.querySelectorAll` + `DOM.describeNode`
  // CDP round trip and compares it to the identity resolved BEFORE forcing.
  // That CDP-level identity layer is kept adversarial exactly as before:
  // the stub returns nodeId 60 (the real target, `btn`) on the FIRST
  // `DOM.querySelectorAll('input.secret-cb')` call (collectStates's own
  // initial resolution) but a DIFFERENT nodeId 99 (`impersonator`, a
  // distinct element with its own backendNodeId) on the SECOND call —
  // simulating a synchronous CDP-level reorder/replace between the two
  // resolutions. What changed from the prior version of this test: the
  // in-page `__captureStateFacts` and `__captureStateForce_checked`
  // expressions are no longer hand-simulated by a regex-extracting stub —
  // they are the REAL generated strings, executed for real via `new
  // Function` against a fake document (so a malformed/drifted facts or
  // force template would fail this test too, not just the identity check).
  // Pre-fix, there was no post-force identity recheck at all: since the
  // in-page `document.querySelectorAll(selector)[index]` facts capture
  // legitimately still resolves to the SAME real fake-document element both
  // before and after forcing (the fake document is unaffected by the
  // CDP-domain override — that override lives in a totally separate
  // nodeId/backendNodeId bookkeeping layer, mirroring real Chrome's own
  // split between CDP node ids and in-page DOM objects), the pre-fix
  // collector would have reported `supported:true` with a clean (zero)
  // delta — masking the fact that the INDEPENDENT CDP-level identity check
  // would have caught a real mismatch. Post-fix, the mismatch is caught and
  // reported honestly.
  const btn = makeFakeStateEl('INPUT', 'secret-cb', { type: 'checkbox', checked: false, rect: { x: 0, y: 0, width: 16, height: 16 } });
  const client = new RealStatesExpressionStub(
    [btn],
    { 'input.secret-cb': [60] },
    {
      60: { nodeName: 'INPUT', backendNodeId: 6000, attributes: ['class', 'secret-cb'] },
      99: { nodeName: 'INPUT', backendNodeId: 9900, attributes: ['class', 'decoy'] },
    },
    { secondQuerySelectorAllOverride: { selector: 'input.secret-cb', nodeIds: [99] } },
  );
  const { ctx, written } = makeCtx(client, { state: ['checked:input.secret-cb'] });

  await collectStates(ctx);

  const rec = (written.get('states.json') as any).elements[0];
  assert.equal(
    rec.supported,
    false,
    'pre-fix there was no post-force identity recheck at all, so this would have reported supported:true against an unverified identity',
  );
  assert.match(rec.reason ?? '', /identity check failed/);
  assert.equal(rec.geometry, undefined, 'no bogus delta is reported when the identity check fails');
  assert.equal(rec.style, undefined, 'no bogus delta is reported when the identity check fails');
  assert.equal(rec.hittest, undefined, 'no bogus delta is reported when the identity check fails');
  // Restoration still ran (the force succeeded and installed a restoreFn;
  // the identity check failing is independent of restoration, per I-6). The
  // restore is ALSO the real executed __captureStateRestore_checked JS.
  assert.equal(rec.forced?.applied, true);
  assert.equal(rec.forced?.restored, true, "restore is the real executed template; el has no radio peers so the single primary-property write and marker removal succeed cleanly");
  assert.equal(btn.checked, false, "the real restore expression put the element's checked property back to its pre-force original");
});

test('collectStates: an unsupported force still emits a restoration fact (applied:false)', async () => {
  const btn: StateFixtureEl = { nodeId: 50, nodeName: 'BUTTON', attributes: ['class', 'go'] };
  const client = new StatesStub([btn], { 'button.go': [50] });
  const { ctx, written } = makeCtx(client, { state: ['checked:button.go'] });

  await collectStates(ctx);

  const rec = (written.get('states.json') as any).elements[0];
  assert.equal(rec.supported, false);
  assert.deepEqual(rec.forced, { applied: false }, 'restoration fact present even on the unsupported branch');
});
