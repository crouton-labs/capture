/**
 * Adversarial invariant tests for the mutating collectors owned by this
 * remediation pass: `focus.ts`, `scroll.ts`, `states.ts`, and `pixels.ts`.
 *
 * ## Scope of this file
 * - **Finding C (I-5, silent-cap truncation facts):** every one of these
 *   collectors' caps must surface as an explicit fact on its JSON output —
 *   never a silently short array with the cap merely implied. Two distinct
 *   proof shapes are used, matched to where each cap's logic actually lives:
 *     - When the cap is computed in **Node/TS code** (`focus.ts`'s `walk()`
 *       hard-cap loop, `states.ts`'s selector/auto-element caps, `pixels.ts`'s
 *       `MAX_ELEMENTS` enumeration slice and its per-entry skip sites), a
 *       stub CDP client that fabricates the *input* the TS code consumes is
 *       sufficient proof — the cap-detection logic under test runs in Node,
 *       not in the page.
 *     - When the cap is computed **inside the injected in-page script**
 *       (`focus.ts`'s 50-candidate `clickableUnfocusable` scan, `scroll.ts`'s
 *       60-container / 30-descendant / 30-visible-child scans), a stub that
 *       fabricates the returned boolean proves only that the value passes
 *       through Node untouched — it cannot prove the in-page script itself
 *       ever computes that boolean correctly. Those caps are instead proven
 *       with a real headless-Chrome fixture genuinely built past the cap, so
 *       the real collector — real page script included — emits the fact.
 *   Stub-driven and real-Chrome Finding-C tests both appear below, one
 *   `describe` block per fact, labeled by which proof shape applies.
 * - **Finding D (I-3, backendNodeId identity):** one real-Chrome test suite
 *   per collector (`focus.ts`'s equivalent lives in the separate
 *   `test/measure-focus-geometry-identity.test.ts`; `scroll.ts`, `states.ts`,
 *   and `pixels.ts` each get their own `Finding D` `describe` block here),
 *   each proving the collector's `backendNodeId` for a real DOM node EQUALS
 *   `geometry.json`'s `backendNodeId` for the SAME node.
 *
 * This file's structure (stub conventions + the real-Chrome harness at the
 * bottom) is reused identically across all four collectors:
 *  - Follow the `makeCtx`/`makeWriter` stub-context helpers (mirrors
 *    `test/measure-restoration.test.ts`) for stub-driven Finding C tests.
 *  - Follow the `spawnHeadlessChrome`/`newPageTarget`/`makeInMemoryWriter`
 *    real-Chrome harness (mirrors `test/measure-focus-geometry-identity.test.ts`)
 *    for Finding D tests, and for the real-Chrome Finding C adversarial
 *    fixtures — each `describe` block spawns its OWN Chrome instance in its
 *    own `before`/`after` (SIGKILL on teardown) so one block's fixture/
 *    teardown can't leak into another's. `scroll.ts`'s Finding D uses the
 *    shared `waitForFixtureReady` (a scrollbox-specific readiness check);
 *    `states.ts` and `pixels.ts`, and the real-Chrome Finding C blocks, use
 *    the more general `waitForElementReady(client, checkExpression)` defined
 *    further below, parameterized per fixture's own readiness condition.
 *
 * Every truncation fact asserted below is checked both ways: a fixture that
 * genuinely exceeds the cap must read `true`, and a fixture genuinely under
 * the cap must read `false` — never `undefined` — so a regression that
 * drops the fact entirely, or one that fabricates it as always-true or
 * always-false, both fail a test in this file.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';

import { PNG } from 'pngjs';

import { CDPClient } from '../src/cdp/client.js';
import type { SnapshotContext, SnapshotWriter } from '../src/cdp/measure/types.js';
import { collectFocus, type FocusReport } from '../src/cdp/measure/collectors/focus.js';
import { collectScroll, type ScrollReport } from '../src/cdp/measure/collectors/scroll.js';
import { collectStates } from '../src/cdp/measure/collectors/states.js';
import { collectPixels } from '../src/cdp/measure/collectors/pixels.js';
import { collectGeometry, type GeometryElementRecord } from '../src/cdp/measure/collectors/geometry.js';
import { enableDomainsForSnap } from '../src/cdp/domains.js';

// ============================================================================
// Shared stub-context helpers — mirrors test/measure-restoration.test.ts.
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
    dir: '/tmp/measure-mutating-invariants-test',
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

// ============================================================================
// focus.ts — Finding C (I-5): clickableUnfocusableTruncated
// ============================================================================

/**
 * Minimal focus.ts stub: the sample script (`__captureFocusSample`)
 * immediately returns no value, so `walk()` breaks on its very first
 * iteration (`raw === undefined`) with `truncated: false` and an empty
 * stop list — this isolates the assertion to the `clickableTruncated`
 * passthrough from `__captureFocusInit` without needing a real walk.
 */
class FocusClickableCapStub {
  constructor(private readonly opts: { clickableTruncated: boolean; clickableCount: number }) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Input.dispatchKeyEvent') return {};
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') return { nodeIds: [] };
    if (method === 'DOM.describeNode') return { node: {} };
    if (method === 'Runtime.evaluate') {
      const expr = String((params as { expression?: unknown }).expression ?? '');
      if (expr.includes('__captureFocusOrigin')) {
        return { result: { value: { hadOriginalFocus: false, scrollX: 0, scrollY: 0 } } };
      }
      if (expr.includes('__captureFocusInit')) {
        const clickable = Array.from({ length: this.opts.clickableCount }, (_, i) => ({
          id: `click-${i + 1}`,
          selector: `div.card-${i + 1}`,
          rect: null,
        }));
        return {
          result: {
            value: {
              candidates: [],
              clickableUnfocusable: clickable,
              clickableTruncated: this.opts.clickableTruncated,
              iframesPresent: 0,
              shadowHostsPresent: 0,
            },
          },
        };
      }
      if (expr.includes('__captureFocusSample')) {
        // No value at all -- walk() sees raw === undefined and stops
        // immediately with an empty, non-truncated result.
        return { result: {} };
      }
      if (expr.includes('__captureFocusMarkerCleanup')) return { result: { value: { markersRemoved: true } } };
      if (expr.includes('__captureFocusRestore')) return { result: { value: { focusRestored: true, markersRemoved: true, scrollRestored: true } } };
      return { result: {} };
    }
    return {};
  }
}

describe('focus.ts — Finding C (I-5), stub proof (TS passthrough): clickableUnfocusableTruncated reflects __captureFocusInit\'s reported cap state', () => {
  test('collectFocus: 50-candidate clickable cap reached -> clickableUnfocusableTruncated === true', async () => {
    const client = new FocusClickableCapStub({ clickableTruncated: true, clickableCount: 50 });
    const { ctx, written } = makeCtx(client as unknown as CDPClient);

    await collectFocus(ctx);

    const focus = written.get('focus.json') as FocusReport;
    assert.ok(focus, 'focus.json written');
    assert.equal(focus.clickableUnfocusableTruncated, true, 'the cap-reached fact must flip true when __captureFocusInit reports clickableTruncated: true');
    assert.equal(focus.clickableUnfocusable.length, 50);
  });

  test('collectFocus: clickable cap NOT reached (small page) -> clickableUnfocusableTruncated === false', async () => {
    const client = new FocusClickableCapStub({ clickableTruncated: false, clickableCount: 3 });
    const { ctx, written } = makeCtx(client as unknown as CDPClient);

    await collectFocus(ctx);

    const focus = written.get('focus.json') as FocusReport;
    assert.ok(focus, 'focus.json written');
    assert.equal(focus.clickableUnfocusableTruncated, false, 'a small page (well under the cap) must report false, not merely omit the field');
    assert.equal(focus.clickableUnfocusable.length, 3);
  });
});

// ============================================================================
// focus.ts — Finding C (I-5): forwardTruncated (the MAX_STEPS_HARD_CAP=300 walk cap)
// ============================================================================

/**
 * Forces the forward walk to exhaust every one of its 300 steps: the
 * sample script returns a NEW, never-before-seen id on every single call,
 * so `walk()` never detects a cycle (`raw.id === firstId`) and never
 * detects a non-advancing step (`raw.id === previousId`) -- the only exit
 * left is the hard cap, which sets `truncated: true`.
 */
class FocusStepCapStub {
  private sampleCounter = 0;

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Input.dispatchKeyEvent') return {};
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') return { nodeIds: [] };
    if (method === 'DOM.describeNode') return { node: {} };
    if (method === 'Runtime.evaluate') {
      const expr = String((params as { expression?: unknown }).expression ?? '');
      if (expr.includes('__captureFocusOrigin')) {
        return { result: { value: { hadOriginalFocus: false, scrollX: 0, scrollY: 0 } } };
      }
      if (expr.includes('__captureFocusInit')) {
        return { result: { value: { candidates: [], clickableUnfocusable: [], clickableTruncated: false, iframesPresent: 0, shadowHostsPresent: 0 } } };
      }
      if (expr.includes('__captureFocusSample')) {
        this.sampleCounter += 1;
        const id = `never-repeats-${this.sampleCounter}`;
        return {
          result: {
            value: { id, selector: `div.item-${this.sampleCounter}`, role: null, name: null, rect: null, tabIndex: 0, focusVisibleStyle: null, scrollX: 0, scrollY: 0, isBody: false },
          },
        };
      }
      if (expr.includes('__captureFocusMarkerCleanup')) return { result: { value: { markersRemoved: true } } };
      if (expr.includes('__captureFocusRestore')) return { result: { value: { focusRestored: true, markersRemoved: true, scrollRestored: true } } };
      return { result: {} };
    }
    return {};
  }
}

describe('focus.ts — Finding C (I-5), stub proof (TS logic): forwardTruncated correctly reflects the walk() hard-cap exit', () => {
  test(
    'collectFocus: a sample sequence that never cycles or repeats exhausts the 300-step hard cap -> forwardTruncated === true, forward.length === 300',
    { timeout: 20000 },
    async () => {
      const client = new FocusStepCapStub();
      const { ctx, written } = makeCtx(client as unknown as CDPClient);

      await collectFocus(ctx);

      const focus = written.get('focus.json') as FocusReport;
      assert.ok(focus, 'focus.json written');
      assert.equal(focus.forward.length, 300, 'every one of the 300 hard-cap steps was recorded (no cycle/no-advance exit ever fired)');
      assert.equal(focus.forwardTruncated, true, 'the hard cap being exhausted must flip forwardTruncated true');
    },
  );
});

// ============================================================================
// focus.ts — Finding C (I-5): reverseTruncated (the same 300-step hard cap,
// independently applied to the reverse/Shift+Tab walk)
// ============================================================================

/**
 * Direction-aware stub: the forward (Tab) walk gets a fixed, repeating
 * sample so it cycles back to its own first stop on step 2 and terminates
 * naturally (`forwardTruncated === false`) after recording exactly one
 * stop; the reverse (Shift+Tab) walk then gets a brand-new, never-before-
 * seen id on every call, so it never detects a cycle or a non-advancing
 * step and the only exit is the 300-step hard cap. Direction is inferred
 * from the `modifiers` bit `Input.dispatchKeyEvent` carries (8 == Shift,
 * i.e. reverse) on the immediately preceding key dispatch, mirroring how
 * `walk()` itself drives `dispatchTab(client, reverse)`.
 */
class FocusReverseStepCapStub {
  private reverseCounter = 0;
  private currentlyReverse = false;

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Input.dispatchKeyEvent') {
      this.currentlyReverse = (params as { modifiers?: number }).modifiers === 8;
      return {};
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') return { nodeIds: [] };
    if (method === 'DOM.describeNode') return { node: {} };
    if (method === 'Runtime.evaluate') {
      const expr = String((params as { expression?: unknown }).expression ?? '');
      if (expr.includes('__captureFocusOrigin')) {
        return { result: { value: { hadOriginalFocus: false, scrollX: 0, scrollY: 0 } } };
      }
      if (expr.includes('__captureFocusInit')) {
        return { result: { value: { candidates: [], clickableUnfocusable: [], clickableTruncated: false, iframesPresent: 0, shadowHostsPresent: 0 } } };
      }
      if (expr.includes('__captureFocusSample')) {
        if (!this.currentlyReverse) {
          // Forward walk: the exact same id every call, so step 2 detects a
          // cycle back to the first stop and the forward walk terminates
          // naturally, well short of the hard cap.
          return {
            result: {
              value: { id: 'forward-fixed', selector: 'div.forward-fixed', role: null, name: null, rect: null, tabIndex: 0, focusVisibleStyle: null, scrollX: 0, scrollY: 0, isBody: false },
            },
          };
        }
        // Reverse walk: a brand-new id every single call -- never cycles,
        // never repeats -- so the only exit is the 300-step hard cap.
        this.reverseCounter += 1;
        const id = `reverse-never-repeats-${this.reverseCounter}`;
        return {
          result: {
            value: { id, selector: `div.reverse-${this.reverseCounter}`, role: null, name: null, rect: null, tabIndex: 0, focusVisibleStyle: null, scrollX: 0, scrollY: 0, isBody: false },
          },
        };
      }
      if (expr.includes('__captureFocusMarkerCleanup')) return { result: { value: { markersRemoved: true } } };
      if (expr.includes('__captureFocusRestore')) return { result: { value: { focusRestored: true, markersRemoved: true, scrollRestored: true } } };
      return { result: {} };
    }
    return {};
  }
}

describe('focus.ts — Finding C (I-5), stub proof (TS logic): reverseTruncated correctly reflects the reverse walk() hard-cap exit', () => {
  test(
    'collectFocus: forward walk terminates naturally (cycle detected), reverse walk exhausts the 300-step hard cap -> reverseTruncated === true, reverse.length === 300',
    { timeout: 20000 },
    async () => {
      const client = new FocusReverseStepCapStub();
      const { ctx, written } = makeCtx(client as unknown as CDPClient);

      await collectFocus(ctx);

      const focus = written.get('focus.json') as FocusReport;
      assert.ok(focus, 'focus.json written');
      assert.equal(focus.forward.length, 1, 'the forward walk cycled back to its own first stop after one recorded step');
      assert.equal(focus.forwardTruncated, false, 'the forward walk terminated naturally (a real cycle), not via the hard cap');
      assert.equal(focus.reverse.length, 300, 'every one of the 300 hard-cap steps was recorded for the reverse walk (no cycle/no-advance exit ever fired)');
      assert.equal(focus.reverseTruncated, true, 'the hard cap being exhausted on the REVERSE walk must flip reverseTruncated true, independently of forwardTruncated');
    },
  );
});

// ============================================================================
// scroll.ts — Finding C (I-5): scrollContainersTruncated (60-container cap)
// ============================================================================

function makeMinimalContainerRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scrollId: null,
    selector: 'div.container',
    isRoot: false,
    rect: { x: 0, y: 0, width: 100, height: 100 },
    scrollWidth: 200,
    scrollHeight: 200,
    clientWidth: 100,
    clientHeight: 100,
    scrollTop: 0,
    scrollLeft: 0,
    maxScrollTop: 100,
    maxScrollLeft: 100,
    overflowX: 'auto',
    overflowY: 'auto',
    scrollbarGutter: null,
    scrollSnapType: null,
    snapDescendants: [],
    snapDescendantsTruncated: false,
    stickyFixedDescendants: [],
    stickyFixedDescendantsTruncated: false,
    samples: [],
    ...overrides,
  };
}

class ScrollStub {
  constructor(private readonly topology: Record<string, unknown>) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expr = String((params as { expression?: unknown }).expression ?? '');
      if (expr.includes('__captureScrollTopology')) return { result: { value: this.topology } };
      if (expr.includes('__captureScrollCleanup')) return { result: { value: { cleared: true } } };
      return { result: {} };
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') return { nodeIds: [] };
    if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 390 }, cssLayoutViewport: { clientWidth: 390 } };
    return {};
  }
}

describe('scroll.ts — Finding C (I-5), stub proof (TS logic): scrollContainersTruncated correctly reflects the container-count vs. cap comparison', () => {
  test('collectScroll: 61 real scroll containers found but only 60 kept -> scrollContainersTruncated === true', async () => {
    const containers = Array.from({ length: 60 }, (_, i) => makeMinimalContainerRaw({ selector: `div.container-${i + 1}` }));
    const topology = {
      containers,
      documentScrollHeight: 5000,
      documentScrollWidth: 390,
      offsetsRestored: true,
      iframesPresent: 0,
      shadowHostsPresent: 0,
      scrollContainersTotal: 61,
      scrollContainersTruncated: true,
      scriptError: null,
    };
    const client = new ScrollStub(topology);
    const { ctx, written } = makeCtx(client as unknown as CDPClient);

    await collectScroll(ctx);

    const scroll = written.get('scroll.json') as ScrollReport;
    assert.ok(scroll, 'scroll.json written');
    assert.equal(scroll.containers.length, 60, 'the 60-container cap kept exactly 60');
    assert.equal(scroll.scrollContainersTotal, 61, 'the exact total (computed regardless of the cap) is preserved');
    assert.equal(scroll.scrollContainersTruncated, true, 'a real container beyond the cap must flip scrollContainersTruncated true');
  });

  test('collectScroll: 2 real scroll containers, both kept -> scrollContainersTruncated === false', async () => {
    const containers = [makeMinimalContainerRaw({ selector: 'div.a' }), makeMinimalContainerRaw({ selector: 'div.b' })];
    const topology = {
      containers,
      documentScrollHeight: 800,
      documentScrollWidth: 390,
      offsetsRestored: true,
      iframesPresent: 0,
      shadowHostsPresent: 0,
      scrollContainersTotal: 2,
      scrollContainersTruncated: false,
      scriptError: null,
    };
    const client = new ScrollStub(topology);
    const { ctx, written } = makeCtx(client as unknown as CDPClient);

    await collectScroll(ctx);

    const scroll = written.get('scroll.json') as ScrollReport;
    assert.ok(scroll, 'scroll.json written');
    assert.equal(scroll.containers.length, 2);
    assert.equal(scroll.scrollContainersTotal, 2);
    assert.equal(scroll.scrollContainersTruncated, false, 'a small page well under the cap must report false, not merely omit the field');
  });
});

// ============================================================================
// scroll.ts — Finding C (I-5): per-container / per-sample *Truncated passthrough
// (stickyFixedDescendantsTruncated, snapDescendantsTruncated, visibleChildrenTruncated)
// ============================================================================

describe('scroll.ts — Finding C (I-5), stub proof (TS passthrough): per-container/per-sample truncation booleans survive toContainerOut\'s mapping unchanged', () => {
  test('collectScroll: stickyFixedDescendantsTruncated and snapDescendantsTruncated pass through untouched, both true and false, per container', async () => {
    const containerTrueSticky = makeMinimalContainerRaw({
      scrollId: 'scroll-1',
      selector: 'div.sticky-heavy',
      stickyFixedDescendants: [{ scrollId: 'scroll-2', selector: 'div.sticky-1', position: 'sticky', rect: null }],
      stickyFixedDescendantsTruncated: true,
      snapDescendants: [],
      snapDescendantsTruncated: false,
    });
    const containerTrueSnap = makeMinimalContainerRaw({
      scrollId: 'scroll-3',
      selector: 'div.snap-heavy',
      stickyFixedDescendants: [],
      stickyFixedDescendantsTruncated: false,
      snapDescendants: [{ scrollId: 'scroll-4', selector: 'div.snap-1', scrollSnapAlign: 'start' }],
      snapDescendantsTruncated: true,
    });
    const topology = {
      containers: [containerTrueSticky, containerTrueSnap],
      documentScrollHeight: 800,
      documentScrollWidth: 390,
      offsetsRestored: true,
      iframesPresent: 0,
      shadowHostsPresent: 0,
      scrollContainersTotal: 2,
      scrollContainersTruncated: false,
      scriptError: null,
    };
    const client = new ScrollStub(topology);
    const { ctx, written } = makeCtx(client as unknown as CDPClient);

    await collectScroll(ctx);

    const scroll = written.get('scroll.json') as ScrollReport;
    const outSticky = scroll.containers.find((c) => c.selector === 'div.sticky-heavy');
    const outSnap = scroll.containers.find((c) => c.selector === 'div.snap-heavy');
    assert.ok(outSticky && outSnap, 'both stub containers made it through toContainerOut');

    assert.equal(outSticky!.stickyFixedDescendantsTruncated, true, 'the sticky cap-reached fact must pass through unchanged');
    assert.equal(outSticky!.snapDescendantsTruncated, false, 'a fact NOT capped on the same container must pass through as false, not flip true');
    assert.equal(outSnap!.snapDescendantsTruncated, true, 'the snap cap-reached fact must pass through unchanged');
    assert.equal(outSnap!.stickyFixedDescendantsTruncated, false);
  });

  test('collectScroll: per-sample visibleChildrenTruncated passes through untouched, both true and false', async () => {
    const container = makeMinimalContainerRaw({
      scrollId: 'scroll-5',
      selector: 'div.sample-container',
      samples: [
        { offsetTop: 0, visibleChildren: [], visibleChildrenTruncated: true },
        { offsetTop: 100, visibleChildren: [{ scrollId: null, selector: 'div.child', rect: null }], visibleChildrenTruncated: false },
      ],
    });
    const topology = {
      containers: [container],
      documentScrollHeight: 800,
      documentScrollWidth: 390,
      offsetsRestored: true,
      iframesPresent: 0,
      shadowHostsPresent: 0,
      scrollContainersTotal: 1,
      scrollContainersTruncated: false,
      scriptError: null,
    };
    const client = new ScrollStub(topology);
    const { ctx, written } = makeCtx(client as unknown as CDPClient);

    await collectScroll(ctx);

    const scroll = written.get('scroll.json') as ScrollReport;
    const out = scroll.containers.find((c) => c.selector === 'div.sample-container');
    assert.ok(out, 'the stub container made it through toContainerOut');
    assert.equal(out!.samples.length, 2);
    assert.equal(out!.samples[0].visibleChildrenTruncated, true, 'the first sample\'s 30-child cap-reached fact must pass through unchanged');
    assert.equal(out!.samples[1].visibleChildrenTruncated, false, 'the second sample (under the cap) must pass through as false');
  });
});

// ============================================================================
// scroll.ts — Phase 3 Class A (I-5): report-level `available`/`reason` when
// the topology `Runtime.evaluate` itself could not be read (never a silent
// empty-success report indistinguishable from a genuinely-empty page).
// ============================================================================

class ScrollEvaluateThrowsStub {
  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expr = String((params as { expression?: unknown }).expression ?? '');
      if (expr.includes('__captureScrollTopology')) throw new Error('simulated evaluate failure');
      if (expr.includes('__captureScrollCleanup')) return { result: { value: { cleared: true } } };
      return { result: {} };
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') return { nodeIds: [] };
    if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 390 }, cssLayoutViewport: { clientWidth: 390 } };
    return {};
  }
}

class ScrollEvaluateNoValueStub {
  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expr = String((params as { expression?: unknown }).expression ?? '');
      // Real CDP shape when the page-side script throws synchronously inside
      // Runtime.evaluate without an exceptionDetails-triggered throw: the
      // `result` wrapper comes back with no `value` at all.
      if (expr.includes('__captureScrollTopology')) return { result: {} };
      if (expr.includes('__captureScrollCleanup')) return { result: { value: { cleared: true } } };
      return { result: {} };
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') return { nodeIds: [] };
    if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 390 }, cssLayoutViewport: { clientWidth: 390 } };
    return {};
  }
}

describe('scroll.ts — Phase 3 Class A (I-5), stub proof: topology evaluate failure flips available:false with a fixed reason, never a silent empty-success report', () => {
  test('collectScroll: topology Runtime.evaluate throws -> available:false, reason:"topology-evaluate-threw" (RED pre-fix: available omitted, report reads as a genuinely-empty success)', async () => {
    const client = new ScrollEvaluateThrowsStub();
    const { ctx, written } = makeCtx(client as unknown as CDPClient);

    await collectScroll(ctx);

    const scroll = written.get('scroll.json') as ScrollReport;
    assert.ok(scroll, 'scroll.json written');
    assert.equal(scroll.containers.length, 0, 'no containers were ever read');
    assert.equal(scroll.available, false, 'a thrown topology evaluate must NOT read as a successful empty report');
    assert.equal(scroll.reason, 'topology-evaluate-threw', 'the reason must be the fixed enum value, never a raw exception message');
  });

  test('collectScroll: topology Runtime.evaluate resolves with no `value` -> available:false, reason:"topology-evaluate-returned-no-value" (RED pre-fix: available omitted, report reads as a genuinely-empty success)', async () => {
    const client = new ScrollEvaluateNoValueStub();
    const { ctx, written } = makeCtx(client as unknown as CDPClient);

    await collectScroll(ctx);

    const scroll = written.get('scroll.json') as ScrollReport;
    assert.ok(scroll, 'scroll.json written');
    assert.equal(scroll.containers.length, 0, 'no containers were ever read');
    assert.equal(scroll.available, false, 'a missing evaluate value must NOT read as a successful empty report');
    assert.equal(scroll.reason, 'topology-evaluate-returned-no-value');
  });

  test('collectScroll: a normal run (topology genuinely has zero scroll containers) -> available:true, no reason', async () => {
    const topology = {
      containers: [],
      documentScrollHeight: 800,
      documentScrollWidth: 390,
      offsetsRestored: true,
      iframesPresent: 0,
      shadowHostsPresent: 0,
      scrollContainersTotal: 0,
      scrollContainersTruncated: false,
      scriptError: null,
    };
    const client = new ScrollStub(topology);
    const { ctx, written } = makeCtx(client as unknown as CDPClient);

    await collectScroll(ctx);

    const scroll = written.get('scroll.json') as ScrollReport;
    assert.equal(scroll.available, true, 'a genuinely-empty page (topology read succeeded) must be distinguishable from a failed read');
    assert.equal(scroll.reason, undefined, 'reason must be absent, not merely falsy, on a successful run');
  });
});

// ============================================================================
// scroll.ts — Phase 3 Class B (I-3): every element-bearing record
// (container, snap/sticky descendant, sampled visible child) carries
// backendNodeId: number | null + identityUnresolved when marker->
// backendNodeId resolution fails, never a silently omitted field.
// ============================================================================

class ScrollIdentityResolutionFailureStub {
  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expr = String((params as { expression?: unknown }).expression ?? '');
      if (expr.includes('__captureScrollTopology')) {
        return {
          result: {
            value: {
              containers: [
                makeMinimalContainerRaw({
                  scrollId: 'scroll-1',
                  selector: 'div.container',
                  stickyFixedDescendants: [{ scrollId: 'scroll-2', selector: 'div.sticky-1', position: 'sticky', rect: null }],
                  snapDescendants: [{ scrollId: 'scroll-3', selector: 'div.snap-1', scrollSnapAlign: 'start' }],
                  samples: [{ offsetTop: 0, visibleChildren: [{ scrollId: 'scroll-4', selector: 'div.child-1', rect: null }], visibleChildrenTruncated: false }],
                }),
              ],
              documentScrollHeight: 800,
              documentScrollWidth: 390,
              offsetsRestored: true,
              iframesPresent: 0,
              shadowHostsPresent: 0,
              scrollContainersTotal: 1,
              scrollContainersTruncated: false,
              scriptError: null,
            },
          },
        };
      }
      if (expr.includes('__captureScrollCleanup')) return { result: { value: { cleared: true } } };
      return { result: {} };
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    // Real markers ('scroll-1'/'scroll-2'/'scroll-3'/'scroll-4' -- container,
    // sticky descendant, snap descendant, sampled visible child) all exist
    // on the page, but the querySelectorAll/describeNode bridge that
    // resolves them fails to yield a usable backendNodeId for ANY of them --
    // simulating a genuine resolution failure across every element-bearing
    // record family, not merely "no markers present".
    if (method === 'DOM.querySelectorAll') return { nodeIds: [101, 102, 103, 104] };
    if (method === 'DOM.describeNode') return { node: { attributes: [] } };
    if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 390 }, cssLayoutViewport: { clientWidth: 390 } };
    return {};
  }
}

describe('scroll.ts — Phase 3 Class B (I-3), stub proof: every element-bearing record carries backendNodeId:null + identityUnresolved:true when marker resolution fails, never a silently omitted field', () => {
  test('collectScroll: container AND a nested stickyFixedDescendants entry both get backendNodeId:null + identityUnresolved:true (RED pre-fix: backendNodeId key silently omitted)', async () => {
    const client = new ScrollIdentityResolutionFailureStub();
    const { ctx, written } = makeCtx(client as unknown as CDPClient);

    await collectScroll(ctx);

    const scroll = written.get('scroll.json') as ScrollReport;
    assert.ok(scroll, 'scroll.json written');
    assert.equal(scroll.containers.length, 1);
    const container = scroll.containers[0];

    assert.equal(Object.prototype.hasOwnProperty.call(container, 'backendNodeId'), true, 'backendNodeId must never be silently omitted, even on resolution failure');
    assert.equal(container.backendNodeId, null, 'a failed marker resolution must emit null, not omit the key');
    assert.equal(container.identityUnresolved, true, 'the failure must be explicitly flagged, not merely inferable from null');

    assert.equal(container.stickyFixedDescendants.length, 1);
    const stickyDescendant = container.stickyFixedDescendants[0];
    assert.equal(Object.prototype.hasOwnProperty.call(stickyDescendant, 'backendNodeId'), true, 'nested stickyFixedDescendants records must also never silently omit backendNodeId');
    assert.equal(stickyDescendant.backendNodeId, null);
    assert.equal(stickyDescendant.identityUnresolved, true);

    assert.equal(container.snapDescendants.length, 1);
    const snapDescendant = container.snapDescendants[0];
    assert.equal(Object.prototype.hasOwnProperty.call(snapDescendant, 'backendNodeId'), true, 'nested snapDescendants records must also never silently omit backendNodeId (I-3 covers this family too, not just stickyFixedDescendants)');
    assert.equal(snapDescendant.backendNodeId, null, 'a failed marker resolution on a snap descendant must emit null, not omit the key');
    assert.equal(snapDescendant.identityUnresolved, true);

    assert.equal(container.samples.length, 1);
    assert.equal(container.samples[0].visibleChildren.length, 1);
    const visibleChild = container.samples[0].visibleChildren[0];
    assert.equal(Object.prototype.hasOwnProperty.call(visibleChild, 'backendNodeId'), true, 'nested samples[].visibleChildren records must also never silently omit backendNodeId (I-3 covers this family too, not just stickyFixedDescendants)');
    assert.equal(visibleChild.backendNodeId, null, 'a failed marker resolution on a sampled visible child must emit null, not omit the key');
    assert.equal(visibleChild.identityUnresolved, true);
  });

  test('collectScroll: a container whose marker resolves normally, AND a resolved snapDescendants/stickyFixedDescendants/samples[].visibleChildren entry on it, each emit backendNodeId as the resolved number with identityUnresolved absent (positive control proving both branches, not just the failure)', async () => {
    const container = makeMinimalContainerRaw({
      scrollId: 'scroll-1',
      selector: 'div.resolved',
      stickyFixedDescendants: [{ scrollId: 'scroll-2', selector: 'div.sticky-1', position: 'sticky', rect: null }],
      snapDescendants: [{ scrollId: 'scroll-3', selector: 'div.snap-1', scrollSnapAlign: 'start' }],
      samples: [{ offsetTop: 0, visibleChildren: [{ scrollId: 'scroll-4', selector: 'div.child-1', rect: null }], visibleChildrenTruncated: false }],
    });
    const topology = {
      containers: [container],
      documentScrollHeight: 800,
      documentScrollWidth: 390,
      offsetsRestored: true,
      iframesPresent: 0,
      shadowHostsPresent: 0,
      scrollContainersTotal: 1,
      scrollContainersTruncated: false,
      scriptError: null,
    };
    // Each of the four markers ('scroll-1'..'scroll-4') resolves to its OWN
    // distinct backendNodeId, keyed by which DOM.describeNode nodeId is asked
    // for -- so a regression that resolves every marker to the same id, or
    // that resolves only the container and leaves the nested families
    // unresolved, would be caught by the distinct-value assertions below.
    const nodeIdToMarker = new Map<number, { backendNodeId: number; scrollId: string }>([
      [101, { backendNodeId: 555, scrollId: 'scroll-1' }],
      [102, { backendNodeId: 556, scrollId: 'scroll-2' }],
      [103, { backendNodeId: 557, scrollId: 'scroll-3' }],
      [104, { backendNodeId: 558, scrollId: 'scroll-4' }],
    ]);
    class ScrollIdentityResolvedStub {
      async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (method === 'Runtime.evaluate') {
          const expr = String((params as { expression?: unknown }).expression ?? '');
          if (expr.includes('__captureScrollTopology')) return { result: { value: topology } };
          if (expr.includes('__captureScrollCleanup')) return { result: { value: { cleared: true } } };
          return { result: {} };
        }
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        if (method === 'DOM.querySelectorAll') return { nodeIds: [101, 102, 103, 104] };
        if (method === 'DOM.describeNode') {
          const nodeId = (params as { nodeId?: number }).nodeId;
          const marker = nodeId !== undefined ? nodeIdToMarker.get(nodeId) : undefined;
          if (!marker) return { node: { attributes: [] } };
          return { node: { backendNodeId: marker.backendNodeId, attributes: ['data-capture-scroll-id', marker.scrollId] } };
        }
        if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 390 }, cssLayoutViewport: { clientWidth: 390 } };
        return {};
      }
    }
    const client = new ScrollIdentityResolvedStub();
    const { ctx, written } = makeCtx(client as unknown as CDPClient);

    await collectScroll(ctx);

    const scroll = written.get('scroll.json') as ScrollReport;
    const out = scroll.containers.find((c) => c.selector === 'div.resolved');
    assert.ok(out);
    assert.equal(out!.backendNodeId, 555, 'a resolved marker must emit the real backendNodeId');
    assert.equal(out!.identityUnresolved, undefined, 'identityUnresolved must be absent (not false) when identity resolved');

    assert.equal(out!.stickyFixedDescendants.length, 1);
    assert.equal(out!.stickyFixedDescendants[0].backendNodeId, 556, 'a resolved stickyFixedDescendants marker must emit its own real backendNodeId');
    assert.equal(out!.stickyFixedDescendants[0].identityUnresolved, undefined);

    assert.equal(out!.snapDescendants.length, 1);
    assert.equal(out!.snapDescendants[0].backendNodeId, 557, 'a resolved snapDescendants marker must emit its own real backendNodeId (I-3 covers this family too)');
    assert.equal(out!.snapDescendants[0].identityUnresolved, undefined);

    assert.equal(out!.samples.length, 1);
    assert.equal(out!.samples[0].visibleChildren.length, 1);
    assert.equal(out!.samples[0].visibleChildren[0].backendNodeId, 558, 'a resolved samples[].visibleChildren marker must emit its own real backendNodeId (I-3 covers this family too)');
    assert.equal(out!.samples[0].visibleChildren[0].identityUnresolved, undefined);
  });
});

// ============================================================================
// focus.ts / scroll.ts — Finding C (I-5), real-Chrome adversarial proof: each
// cap-tripping fact below is asserted against the REAL in-page collector
// script (FOCUS_INIT_SCRIPT / SCROLL_TOPOLOGY_SCRIPT), not a stub -- a
// regression that stops the real script from ever setting the boolean would
// turn these tests red, unlike the stub-passthrough tests above which only
// prove the TS side forwards whatever a stub claims.
//
// Each fact gets its own describe with its own Chrome instance (own
// before/after, SIGKILL teardown) and a runOnFixture(n) helper that
// navigates to a data: URL built from n, waits for a readiness expression,
// and runs the real collector via an in-memory-writer SnapshotContext --
// mirroring the Finding D harness above (spawnHeadlessChrome/newPageTarget/
// makeInMemoryWriter/waitForElementReady, all defined later in this module;
// referencing them here is fine since the whole module loads before any
// test callback runs).
// ============================================================================

describe('focus.ts — Finding C (I-5), real-Chrome adversarial proof: clickableUnfocusableTruncated reflects the real 50-candidate cap in FOCUS_INIT_SCRIPT', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;
    const wsUrl = await newPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
    await client.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 300, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.bringToFront');
  }, { timeout: 20000 });

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

  async function runOnFixture(n: number): Promise<FocusReport> {
    const html = `<!DOCTYPE html><html><body style="margin:0;">
<button id="anchor">anchor</button>
${Array.from({ length: n }, (_, i) => `<div onclick="void(0)" id="click-${i}">c${i}</div>`).join('\n')}
</body></html>`;
    const url = `data:text/html,${encodeURIComponent(html)}`;
    await client!.send('Page.navigate', { url });
    await waitForElementReady(
      client!,
      `document.readyState==='complete' && document.getElementById('anchor')!==null && document.querySelectorAll('[onclick]').length === ${n}`,
    );

    const store: Record<string, unknown> = {};
    const ctx: SnapshotContext = {
      client: client!,
      dir: '/tmp/measure-mutating-invariants-test-focus-clickable-cap-unused',
      snapId: 'focus-clickable-cap-test-snap',
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

  test('collectFocus: 60 non-focusable onclick divs exceed the 50-candidate cap -> clickableUnfocusableTruncated===true, clickableUnfocusable.length===50', { timeout: 20000 }, async () => {
    const focus = await runOnFixture(60);
    assert.equal(focus.clickableUnfocusableTruncated, true, 'expected the real 50-candidate clickable scan to report cap-reached for 60 candidates');
    assert.equal(focus.clickableUnfocusable.length, 50, 'expected the real scan array itself to be capped at 50');
  });

  test('collectFocus: 3 non-focusable onclick divs stay under the 50-candidate cap -> clickableUnfocusableTruncated===false, clickableUnfocusable.length===3', { timeout: 20000 }, async () => {
    const focus = await runOnFixture(3);
    assert.equal(focus.clickableUnfocusableTruncated, false, 'expected the real clickable scan to report NOT cap-reached for 3 candidates');
    assert.equal(focus.clickableUnfocusable.length, 3, 'expected all 3 real candidates to survive uncapped');
  });
});

describe('scroll.ts — Finding C (I-5), real-Chrome adversarial proof: scrollContainersTruncated reflects the real 60-container cap in SCROLL_TOPOLOGY_SCRIPT', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;
    const wsUrl = await newPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
    await client.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 300, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.bringToFront');
  }, { timeout: 20000 });

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

  async function runOnFixture(n: number): Promise<ScrollReport> {
    const html = `<!DOCTYPE html><html><body style="margin:0;">
${Array.from({ length: n }, (_, i) => `<div class="scrollbox" id="scrollbox-${i}" style="width:20px;height:20px;overflow:auto;"><div style="height:200px;">tall</div></div>`).join('\n')}
</body></html>`;
    const url = `data:text/html,${encodeURIComponent(html)}`;
    await client!.send('Page.navigate', { url });
    await waitForElementReady(
      client!,
      `document.querySelectorAll('.scrollbox').length===${n} && (function(){var b=document.querySelector('.scrollbox');return !!b && b.scrollHeight>b.clientHeight;})()`,
    );

    const store: Record<string, unknown> = {};
    const ctx: SnapshotContext = {
      client: client!,
      dir: '/tmp/measure-mutating-invariants-test-scroll-containers-cap-unused',
      snapId: 'scroll-containers-cap-test-snap',
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

    await collectScroll(ctx);
    return store['scroll.json'] as ScrollReport;
  }

  test('collectScroll: 70 genuine scroll containers exceed the 60-container cap -> scrollContainersTruncated===true, scrollContainersTotal>60, containers.length===60', { timeout: 20000 }, async () => {
    const scroll = await runOnFixture(70);
    assert.equal(scroll.scrollContainersTruncated, true, 'expected the real topology scan to report cap-reached for 70 real containers');
    assert.ok(scroll.scrollContainersTotal > 60, `expected scrollContainersTotal > 60, got ${scroll.scrollContainersTotal}`);
    assert.equal(scroll.containers.length, 60, 'expected the real containers array (root + 59) to be capped at 60');
  });

  test('collectScroll: 3 genuine scroll containers stay under the 60-container cap -> scrollContainersTruncated===false, scrollContainersTotal===3', { timeout: 20000 }, async () => {
    const scroll = await runOnFixture(3);
    assert.equal(scroll.scrollContainersTruncated, false, 'expected the real topology scan to report NOT cap-reached for 3 real containers');
    assert.equal(scroll.scrollContainersTotal, 3, 'expected all 3 real containers to be counted uncapped');
  });
});

describe('scroll.ts — Finding C (I-5), real-Chrome adversarial proof: stickyFixedDescendantsTruncated reflects the real per-container 30-descendant cap', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;
    const wsUrl = await newPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
    await client.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 300, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.bringToFront');
  }, { timeout: 20000 });

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

  async function runOnFixture(n: number): Promise<ScrollReport> {
    const html = `<!DOCTYPE html><html><body style="margin:0;">
<div id="stickybox" style="width:100px;height:100px;overflow:auto;">
${Array.from({ length: n }, (_, i) => `<div class="sticky-kid" style="position:sticky;top:0;height:10px;">s${i}</div>`).join('\n')}
<div style="height:2000px;">filler</div>
</div>
</body></html>`;
    const url = `data:text/html,${encodeURIComponent(html)}`;
    await client!.send('Page.navigate', { url });
    await waitForElementReady(
      client!,
      `document.getElementById('stickybox')!==null && document.querySelectorAll('.sticky-kid').length===${n} && document.getElementById('stickybox').scrollHeight > document.getElementById('stickybox').clientHeight`,
    );

    const store: Record<string, unknown> = {};
    const ctx: SnapshotContext = {
      client: client!,
      dir: '/tmp/measure-mutating-invariants-test-scroll-sticky-cap-unused',
      snapId: 'scroll-sticky-cap-test-snap',
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

    await collectScroll(ctx);
    return store['scroll.json'] as ScrollReport;
  }

  test('collectScroll: 35 real sticky descendants exceed the per-container 30 cap -> stickyFixedDescendantsTruncated===true, stickyFixedDescendants.length===30', { timeout: 20000 }, async () => {
    const scroll = await runOnFixture(35);
    const stickybox = scroll.containers.find((c) => c.selector?.includes('stickybox'));
    assert.ok(stickybox, `expected a scroll.json container for #stickybox, got selectors ${JSON.stringify(scroll.containers.map((c) => c.selector))}`);
    assert.equal(stickybox!.stickyFixedDescendantsTruncated, true, 'expected the real per-container sticky scan to report cap-reached for 35 real sticky descendants');
    assert.equal(stickybox!.stickyFixedDescendants.length, 30, 'expected the real sticky descendants array to be capped at 30');
  });

  test('collectScroll: 2 real sticky descendants stay under the per-container 30 cap -> stickyFixedDescendantsTruncated===false, stickyFixedDescendants.length===2', { timeout: 20000 }, async () => {
    const scroll = await runOnFixture(2);
    const stickybox = scroll.containers.find((c) => c.selector?.includes('stickybox'));
    assert.ok(stickybox, `expected a scroll.json container for #stickybox, got selectors ${JSON.stringify(scroll.containers.map((c) => c.selector))}`);
    assert.equal(stickybox!.stickyFixedDescendantsTruncated, false, 'expected the real per-container sticky scan to report NOT cap-reached for 2 real sticky descendants');
    assert.equal(stickybox!.stickyFixedDescendants.length, 2, 'expected both real sticky descendants to survive uncapped');
  });
});

describe('scroll.ts — Finding C (I-5), real-Chrome adversarial proof: snapDescendantsTruncated reflects the real per-container 30-descendant cap', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;
    const wsUrl = await newPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
    await client.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 300, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.bringToFront');
  }, { timeout: 20000 });

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

  async function runOnFixture(n: number): Promise<ScrollReport> {
    const html = `<!DOCTYPE html><html><body style="margin:0;">
<div id="snapbox" style="width:100px;height:100px;overflow:auto;scroll-snap-type:y mandatory;">
${Array.from({ length: n }, (_, i) => `<div class="snap-kid" style="scroll-snap-align:start;height:10px;">s${i}</div>`).join('\n')}
<div style="height:2000px;">filler</div>
</div>
</body></html>`;
    const url = `data:text/html,${encodeURIComponent(html)}`;
    await client!.send('Page.navigate', { url });
    await waitForElementReady(
      client!,
      `document.getElementById('snapbox')!==null && document.querySelectorAll('.snap-kid').length===${n} && document.getElementById('snapbox').scrollHeight > document.getElementById('snapbox').clientHeight`,
    );

    const store: Record<string, unknown> = {};
    const ctx: SnapshotContext = {
      client: client!,
      dir: '/tmp/measure-mutating-invariants-test-scroll-snap-cap-unused',
      snapId: 'scroll-snap-cap-test-snap',
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

    await collectScroll(ctx);
    return store['scroll.json'] as ScrollReport;
  }

  test('collectScroll: 35 real snap descendants exceed the per-container 30 cap -> snapDescendantsTruncated===true, snapDescendants.length===30', { timeout: 20000 }, async () => {
    const scroll = await runOnFixture(35);
    const snapbox = scroll.containers.find((c) => c.selector?.includes('snapbox'));
    assert.ok(snapbox, `expected a scroll.json container for #snapbox, got selectors ${JSON.stringify(scroll.containers.map((c) => c.selector))}`);
    assert.equal(snapbox!.snapDescendantsTruncated, true, 'expected the real per-container snap scan to report cap-reached for 35 real snap descendants');
    assert.equal(snapbox!.snapDescendants.length, 30, 'expected the real snap descendants array to be capped at 30');
  });

  test('collectScroll: 2 real snap descendants stay under the per-container 30 cap -> snapDescendantsTruncated===false, snapDescendants.length===2', { timeout: 20000 }, async () => {
    const scroll = await runOnFixture(2);
    const snapbox = scroll.containers.find((c) => c.selector?.includes('snapbox'));
    assert.ok(snapbox, `expected a scroll.json container for #snapbox, got selectors ${JSON.stringify(scroll.containers.map((c) => c.selector))}`);
    assert.equal(snapbox!.snapDescendantsTruncated, false, 'expected the real per-container snap scan to report NOT cap-reached for 2 real snap descendants');
    assert.equal(snapbox!.snapDescendants.length, 2, 'expected both real snap descendants to survive uncapped');
  });
});

describe('scroll.ts — Finding C (I-5), real-Chrome adversarial proof: visibleChildrenTruncated reflects the real per-sample 30-child cap', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;
    const wsUrl = await newPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
    await client.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 300, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.bringToFront');
  }, { timeout: 20000 });

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

  async function runOnFixture(n: number): Promise<ScrollReport> {
    const html = `<!DOCTYPE html><html><body style="margin:0;">
<div id="visbox" style="width:100px;height:3000px;overflow:auto;">
${Array.from({ length: n }, (_, i) => `<div class="vis-kid" style="height:10px;">v${i}</div>`).join('\n')}
<div style="height:5000px;">filler</div>
</div>
</body></html>`;
    const url = `data:text/html,${encodeURIComponent(html)}`;
    await client!.send('Page.navigate', { url });
    await waitForElementReady(
      client!,
      `document.getElementById('visbox')!==null && document.querySelectorAll('.vis-kid').length===${n} && document.getElementById('visbox').scrollHeight > document.getElementById('visbox').clientHeight`,
    );

    const store: Record<string, unknown> = {};
    const ctx: SnapshotContext = {
      client: client!,
      dir: '/tmp/measure-mutating-invariants-test-scroll-visible-cap-unused',
      snapId: 'scroll-visible-cap-test-snap',
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

    await collectScroll(ctx);
    return store['scroll.json'] as ScrollReport;
  }

  test('collectScroll: 35 real direct children exceed the per-sample 30 cap at offsetTop=0 -> visibleChildrenTruncated===true, visibleChildren.length===30', { timeout: 20000 }, async () => {
    const scroll = await runOnFixture(35);
    const visbox = scroll.containers.find((c) => c.selector?.includes('visbox'));
    assert.ok(visbox, `expected a scroll.json container for #visbox, got selectors ${JSON.stringify(scroll.containers.map((c) => c.selector))}`);
    const sample = visbox!.samples.find((s) => s.offsetTop === 0);
    assert.ok(sample, `expected an offsetTop===0 sample, got offsets ${JSON.stringify(visbox!.samples.map((s) => s.offsetTop))}`);
    assert.equal(sample!.visibleChildrenTruncated, true, 'expected the real per-sample visible-children scan to report cap-reached for 35 real intersecting children');
    assert.equal(sample!.visibleChildren.length, 30, 'expected the real visible-children array to be capped at 30');
  });

  test('collectScroll: 5 real direct children stay under the per-sample 30 cap at offsetTop=0 -> visibleChildrenTruncated===false', { timeout: 20000 }, async () => {
    const scroll = await runOnFixture(5);
    const visbox = scroll.containers.find((c) => c.selector?.includes('visbox'));
    assert.ok(visbox, `expected a scroll.json container for #visbox, got selectors ${JSON.stringify(scroll.containers.map((c) => c.selector))}`);
    const sample = visbox!.samples.find((s) => s.offsetTop === 0);
    assert.ok(sample, `expected an offsetTop===0 sample, got offsets ${JSON.stringify(visbox!.samples.map((s) => s.offsetTop))}`);
    assert.equal(sample!.visibleChildrenTruncated, false, 'expected the real per-sample visible-children scan to report NOT cap-reached for 5 real children (filler may also intersect, so the exact count is not asserted)');
  });
});

// ============================================================================
// scroll.ts — Finding D (I-3): real-Chrome backendNodeId EQUALITY vs geometry.json
//
// Establishes the real-Chrome harness pattern for this new file, following
// test/measure-focus-geometry-identity.test.ts (see that file's own header
// comment for why a stub cannot prove this: a stub's DOM.describeNode
// response is fabricated, so it can't demonstrate real CDP node-identity
// equality across two independently-run collectors).
// ============================================================================

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

interface GeometryJson {
  elements: GeometryElementRecord[];
}

// A tall #scrollbox with overflow:auto and enough content to be a genuine
// scroll container (scrollHeight - clientHeight > 1, scroll.ts's own
// isScrollContainer() test).
const SCROLL_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
<div id="scrollbox" style="width:200px;height:100px;overflow:auto;">
  <div style="height:800px;">tall content to force real scrolling</div>
</div>
</body></html>`;

const SCROLL_FIXTURE_URL = `data:text/html,${encodeURIComponent(SCROLL_FIXTURE_HTML)}`;

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
    const port = 19600 + Math.floor(Math.random() * 700) + attempt * 137;
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
      expression: `document.readyState === 'complete' && document.getElementById('scrollbox') !== null && document.getElementById('scrollbox').scrollHeight > document.getElementById('scrollbox').clientHeight`,
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (res.result?.value) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('fixture page did not reach readyState=complete (with a genuine scroll container) in time');
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

describe('scroll.ts — Finding D (I-3): real-Chrome backendNodeId EQUALITY vs geometry.json', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;
  let scroll: ScrollReport;
  let geometry: GeometryJson;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;

    const wsUrl = await newPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
    await client.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 300, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.bringToFront');

    await client.send('Page.navigate', { url: SCROLL_FIXTURE_URL });
    await waitForFixtureReady(client);

    const store: Record<string, unknown> = {};
    const ctx: SnapshotContext = {
      client,
      dir: '/tmp/measure-mutating-invariants-test-scroll-identity-unused',
      snapId: 'scroll-geometry-identity-test-snap',
      url: SCROLL_FIXTURE_URL,
      viewport: null,
      settled: true,
      freezeAnimations: false,
      captureUnsettled: false,
      pixels: false,
      state: [],
      unstableRegions: [],
      write: makeInMemoryWriter(store),
    };

    await collectScroll(ctx);
    await collectGeometry(ctx);

    scroll = store['scroll.json'] as ScrollReport;
    geometry = store['geometry.json'] as GeometryJson;
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

  test('scroll.json: real Chrome resolves #scrollbox as a genuine scroll container', () => {
    assert.ok(scroll, 'scroll.json was produced');
    const scrollboxContainer = scroll.containers.find((c) => c.selector?.includes('scrollbox'));
    assert.ok(scrollboxContainer, `expected a scroll.json container for #scrollbox, got selectors ${JSON.stringify(scroll.containers.map((c) => c.selector))}`);
    assert.ok(scrollboxContainer!.maxScrollTop > 0, 'expected #scrollbox to actually be scrollable (maxScrollTop > 0)');
  });

  test('scroll.json: #scrollbox backendNodeId EQUALS geometry.json\'s #scrollbox backendNodeId', () => {
    const scrollboxContainer = scroll.containers.find((c) => c.selector?.includes('scrollbox'));
    assert.ok(scrollboxContainer, 'expected a scroll.json container for #scrollbox');
    assert.notEqual(scrollboxContainer!.backendNodeId, undefined, 'expected scroll.json\'s #scrollbox record to carry a backendNodeId, not just a collector-local scrollId');

    const geoScrollbox = geometry.elements.find((e) => e.selector === '#scrollbox');
    assert.ok(geoScrollbox, 'expected a geometry.json record for #scrollbox');
    assert.notEqual(geoScrollbox!.backendNodeId, undefined, "expected geometry.json's #scrollbox to carry a backendNodeId");

    assert.equal(
      scrollboxContainer!.backendNodeId,
      geoScrollbox!.backendNodeId,
      `expected scroll.json's #scrollbox backendNodeId (${scrollboxContainer!.backendNodeId}) to EQUAL geometry.json's #scrollbox backendNodeId (${geoScrollbox!.backendNodeId}) -- proving the two collectors joined the SAME DOM node, not merely each carrying some number`,
    );
  });
});

// ============================================================================
// states.ts — Finding C (I-5): truncatedRequests (MAX_SELECTOR_MATCHES=10 /
// MAX_AUTO_ELEMENTS=8 silent caps)
// ============================================================================

interface StatesTruncatedRequestJson {
  state: string;
  selector?: string;
  matched: number;
  kept: number;
}

interface StatesElementJsonMinimal {
  id: string;
  state: string;
  selector?: string;
  backendNodeId?: number;
}

interface StatesJsonMinimal {
  truncatedRequests: StatesTruncatedRequestJson[];
  elements: StatesElementJsonMinimal[];
}

/**
 * Minimal states.ts stub: every `--state normal[:selector]` request only
 * exercises the `resolveNodeIds` cap + the `normal`-state early-return path
 * in `captureOneElement` (a zero-delta baseline capture with no forcing at
 * all), so this stub only needs to answer `DOM.getDocument`,
 * `DOM.querySelectorAll` (the matched-node-id list under test),
 * `DOM.describeNode` (identity), and the `__captureStateFacts` in-page
 * probe — no `CSS.forcePseudoState` or force-expression handling is needed.
 */
class StatesCapStub {
  constructor(private readonly matchedNodeIds: number[]) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') return { nodeIds: this.matchedNodeIds };
    if (method === 'DOM.describeNode') {
      const nodeId = (params as { nodeId: number }).nodeId;
      return { node: { nodeName: 'BUTTON', backendNodeId: nodeId * 100, attributes: ['id', `card-${nodeId}`] } };
    }
    if (method === 'Runtime.evaluate') {
      const expr = String((params as { expression?: unknown }).expression ?? '');
      if (expr.includes('__captureStateFacts')) {
        return {
          result: {
            value: {
              exists: true,
              tag: 'BUTTON',
              rect: { x: 0, y: 0, width: 10, height: 10 },
              style: {},
              hit: { isTarget: true, topTag: 'BUTTON' },
              text: '',
              axName: null,
            },
          },
        };
      }
      return { result: {} };
    }
    return {};
  }
}

describe('states.ts — Finding C (I-5), stub proof (TS logic): truncatedRequests correctly records the matched/kept counts for each capped request', () => {
  test('collectStates: an explicit selector request matching 15 elements is capped to MAX_SELECTOR_MATCHES=10 -> truncatedRequests records {matched:15, kept:10}', async () => {
    const nodeIds = Array.from({ length: 15 }, (_, i) => i + 1);
    const client = new StatesCapStub(nodeIds);
    const { ctx, written } = makeCtx(client as unknown as CDPClient, { state: ['normal:button.card'] });

    await collectStates(ctx);

    const states = written.get('states.json') as StatesJsonMinimal;
    assert.ok(states, 'states.json written');
    assert.equal(states.truncatedRequests.length, 1, 'exactly one over-capped request recorded');
    assert.equal(states.truncatedRequests[0].state, 'normal');
    assert.equal(states.truncatedRequests[0].selector, 'button.card');
    assert.equal(states.truncatedRequests[0].matched, 15, 'the full match count before the cap was ever applied');
    assert.equal(states.truncatedRequests[0].kept, 10, 'the MAX_SELECTOR_MATCHES cap');
    assert.equal(states.elements.length, 10, 'only 10 element records are actually captured, matching kept');
  });

  test('collectStates: a bare (auto-discovered) request matching 12 eligible elements is capped to MAX_AUTO_ELEMENTS=8 -> truncatedRequests records {matched:12, kept:8}', async () => {
    const nodeIds = Array.from({ length: 12 }, (_, i) => i + 1);
    const client = new StatesCapStub(nodeIds);
    const { ctx, written } = makeCtx(client as unknown as CDPClient, { state: ['normal'] });

    await collectStates(ctx);

    const states = written.get('states.json') as StatesJsonMinimal;
    assert.ok(states, 'states.json written');
    assert.equal(states.truncatedRequests.length, 1, 'exactly one over-capped request recorded');
    assert.equal(states.truncatedRequests[0].state, 'normal');
    assert.equal(states.truncatedRequests[0].selector, undefined, 'no selector on an auto-discovered (bare) request');
    assert.equal(states.truncatedRequests[0].matched, 12);
    assert.equal(states.truncatedRequests[0].kept, 8, 'the MAX_AUTO_ELEMENTS cap (smaller than the selector cap)');
    assert.equal(states.elements.length, 8);
  });

  test('collectStates: a request well under the cap emits truncatedRequests as an empty array, never an omitted field', async () => {
    const nodeIds = [1, 2, 3];
    const client = new StatesCapStub(nodeIds);
    const { ctx, written } = makeCtx(client as unknown as CDPClient, { state: ['normal:button.card'] });

    await collectStates(ctx);

    const states = written.get('states.json') as StatesJsonMinimal;
    assert.ok(states, 'states.json written');
    assert.deepEqual(states.truncatedRequests, [], 'truncatedRequests must be present and empty, not merely absent, when nothing was capped');
    assert.equal(states.elements.length, 3);
  });
});

// ============================================================================
// pixels.ts — Finding C (I-5): elementsTotal / elementsTruncated /
// elementsSkipped (MAX_ELEMENTS=2000 enumeration cap, and the 4 uncroppable-
// element `continue` sites). Adapted from test/measure-pixels.test.ts's
// `StubCdpClient` (its `nodeIds:[1,2]`, node 2 `throwsOnQuads:true` case,
// see that file around lines 371-389) — trimmed to just what `collectPixels`
// needs, plus a new MAX_ELEMENTS-forcing case this file adds.
// ============================================================================

const PX_VIEWPORT_W = 100;
const PX_VIEWPORT_H = 50;
const PX_ELEMENT_RECT = { x: 10, y: 10, width: 20, height: 10 };

function buildPxFullPagePng(mode: 'normal' | 'transparent'): PNG {
  const png = new PNG({ width: PX_VIEWPORT_W, height: PX_VIEWPORT_H });
  for (let y = 0; y < PX_VIEWPORT_H; y += 1) {
    for (let x = 0; x < PX_VIEWPORT_W; x += 1) {
      const o = (y * PX_VIEWPORT_W + x) * 4;
      const insideElement =
        x >= PX_ELEMENT_RECT.x &&
        x < PX_ELEMENT_RECT.x + PX_ELEMENT_RECT.width &&
        y >= PX_ELEMENT_RECT.y &&
        y < PX_ELEMENT_RECT.y + PX_ELEMENT_RECT.height;
      if (insideElement) {
        png.data[o] = 255;
        png.data[o + 1] = 0;
        png.data[o + 2] = 0;
        png.data[o + 3] = 255;
      } else if (mode === 'normal') {
        png.data[o] = 255;
        png.data[o + 1] = 255;
        png.data[o + 2] = 255;
        png.data[o + 3] = 255;
      } else {
        png.data[o] = 0;
        png.data[o + 1] = 0;
        png.data[o + 2] = 0;
        png.data[o + 3] = 0;
      }
    }
  }
  return png;
}

const PX_NORMAL_PNG_BASE64 = PNG.sync.write(buildPxFullPagePng('normal')).toString('base64');
const PX_TRANSPARENT_PNG_BASE64 = PNG.sync.write(buildPxFullPagePng('transparent')).toString('base64');

const PX_ELEMENT_QUAD = [
  PX_ELEMENT_RECT.x,
  PX_ELEMENT_RECT.y,
  PX_ELEMENT_RECT.x + PX_ELEMENT_RECT.width,
  PX_ELEMENT_RECT.y,
  PX_ELEMENT_RECT.x + PX_ELEMENT_RECT.width,
  PX_ELEMENT_RECT.y + PX_ELEMENT_RECT.height,
  PX_ELEMENT_RECT.x,
  PX_ELEMENT_RECT.y + PX_ELEMENT_RECT.height,
];

interface PixelsStubClipInfo {
  rect: { x: number; y: number; width: number; height: number } | null;
  shapes?: unknown[];
  approximate?: boolean;
}

interface PixelsStubOptions {
  nodeIds: number[];
  nodes: Record<number, { quad?: number[]; throwsOnQuads?: boolean; nodeName?: string; backendNodeId?: number }>;
  /** Ancestor-clip info the DOM.resolveNode + Runtime.callFunctionOn round trip reports for a given nodeId; absent means "no ancestor clip" (matches the collector's `AncestorClipInfo` contract). */
  clipRects?: Record<number, PixelsStubClipInfo>;
}

class PixelsCapStub {
  private transparentMode = false;
  constructor(private readonly options: PixelsStubOptions) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Emulation.setDefaultBackgroundColorOverride') {
      this.transparentMode = 'color' in params;
      return {};
    }
    if (method === 'Page.captureScreenshot') {
      return { data: this.transparentMode ? PX_TRANSPARENT_PNG_BASE64 : PX_NORMAL_PNG_BASE64 };
    }
    if (method === 'Runtime.evaluate') {
      const expr = String((params as { expression?: unknown }).expression ?? '');
      if (expr.includes('window.innerWidth')) return { result: { value: { w: PX_VIEWPORT_W, h: PX_VIEWPORT_H } } };
      return { result: {} };
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') return { nodeIds: this.options.nodeIds };
    if (method === 'DOM.getContentQuads') {
      const nodeId = (params as { nodeId: number }).nodeId;
      const node = this.options.nodes[nodeId];
      if (!node || node.throwsOnQuads) throw new Error(`no layout box for node ${nodeId}`);
      return { quads: [node.quad ?? PX_ELEMENT_QUAD] };
    }
    if (method === 'DOM.getBoxModel') {
      const nodeId = (params as { nodeId: number }).nodeId;
      const node = this.options.nodes[nodeId];
      if (!node || node.throwsOnQuads) throw new Error(`no layout box for node ${nodeId}`);
      const quad = node.quad ?? PX_ELEMENT_QUAD;
      const width = Math.abs(quad[2] - quad[0]);
      const height = Math.abs(quad[5] - quad[1]);
      return { model: { content: quad, padding: quad, border: quad, margin: quad, width, height } };
    }
    if (method === 'DOM.describeNode') {
      const nodeId = (params as { nodeId: number }).nodeId;
      const node = this.options.nodes[nodeId];
      return { node: { nodeName: node?.nodeName ?? 'DIV', backendNodeId: node?.backendNodeId ?? nodeId * 1000, attributes: [] } };
    }
    if (method === 'DOM.resolveNode') {
      const nodeId = (params as { nodeId: number }).nodeId;
      return { object: { objectId: `stub-obj-${nodeId}` } };
    }
    if (method === 'Runtime.callFunctionOn') {
      const objectId = String((params as { objectId?: unknown }).objectId ?? '');
      const nodeId = Number(objectId.replace('stub-obj-', ''));
      const clip = this.options.clipRects?.[nodeId];
      if (!clip) return { result: { value: { rect: null, shapes: [], approximate: false } } };
      return { result: { value: clip } };
    }
    return {};
  }
}

interface PixelsElementJsonMinimal {
  id: string;
  selector?: string;
  backendNodeId?: number;
}

interface PixelsJsonMinimal {
  elementsTotal: number;
  elementsTruncated: boolean;
  elementsSkipped: number;
  elementsReadFailed: number;
  elements: PixelsElementJsonMinimal[];
}

describe('pixels.ts — Finding C (I-5), stub proof (TS logic): elementsTotal/elementsTruncated/elementsSkipped correctly reflect the enumeration cap and each per-entry skip site', () => {
  test('collectPixels: an element whose DOM.getContentQuads call throws is a read failure, counted in elementsReadFailed, not elementsSkipped', async () => {
    const client = new PixelsCapStub({
      nodeIds: [1, 2],
      nodes: {
        1: { nodeName: 'DIV', backendNodeId: 111 },
        2: { throwsOnQuads: true }, // a genuine CDP protocol read failure -- e.g. the node vanished between enumeration and the quad read -- NOT proof the node is display:none/detached (which would be a successful read yielding a degenerate/empty quad, the elementsSkipped path)
      },
    });
    const { ctx, written } = makeCtx(client as unknown as CDPClient, { pixels: true });

    await collectPixels(ctx);

    const pixels = written.get('pixels.json') as PixelsJsonMinimal;
    assert.ok(pixels, 'pixels.json written');
    assert.equal(pixels.elements.length, 1, 'only the readable element is recorded');
    assert.equal(pixels.elementsReadFailed, 1, 'the quad-read throw is counted as a read failure, not silently dropped');
    assert.equal(pixels.elementsSkipped, 0, 'a read failure is distinct from a genuinely-uncroppable (enumerated, read succeeded, degenerate box) element');
    assert.equal(pixels.elementsTotal, 2, 'total enumerated count includes the read-failed element');
    assert.equal(pixels.elementsTruncated, false, 'well under MAX_ELEMENTS=2000, so this must read false, not merely be absent');
  });

  test('collectPixels: an element fully outside its ancestor clip rect (effectiveRect collapses to zero area) is skipped and counted in elementsSkipped', async () => {
    const client = new PixelsCapStub({
      nodeIds: [1],
      // node 1's quad defaults to PX_ELEMENT_QUAD == PX_ELEMENT_RECT (x:10,y:10,w:20,h:10); this
      // ancestor clip rect shares no area with it at all, so intersectRect(entry.rect, clipRect)
      // collapses to width/height 0 -- the `effectiveRect.width <= 0 || effectiveRect.height <= 0` site.
      clipRects: { 1: { rect: { x: 90, y: 40, width: 5, height: 5 }, shapes: [], approximate: false } },
      nodes: { 1: { nodeName: 'DIV', backendNodeId: 111 } },
    });
    const { ctx, written } = makeCtx(client as unknown as CDPClient, { pixels: true });

    await collectPixels(ctx);

    const pixels = written.get('pixels.json') as PixelsJsonMinimal;
    assert.ok(pixels, 'pixels.json written');
    assert.equal(pixels.elements.length, 0, 'the element was skipped, not recorded');
    assert.equal(pixels.elementsSkipped, 1, 'an ancestor clip disjoint from the element rect must count the element as skipped');
    assert.equal(pixels.elementsTotal, 1);
  });

  test('collectPixels: an element whose content quad is fully off the captured viewport (clampRectToPixels degenerates) is skipped and counted in elementsSkipped', async () => {
    const client = new PixelsCapStub({
      nodeIds: [1],
      // Quad placed entirely outside the PX_VIEWPORT_W x PX_VIEWPORT_H (100x50) captured
      // screenshot -- effectiveRect is non-degenerate in CSS space, but clampRectToPixels'
      // intersection with the actual PNG bounds yields x1 <= x0 -- the `!pixelRect` site.
      nodes: { 1: { nodeName: 'DIV', backendNodeId: 111, quad: [1000, 1000, 1020, 1000, 1020, 1010, 1000, 1010] } },
    });
    const { ctx, written } = makeCtx(client as unknown as CDPClient, { pixels: true });

    await collectPixels(ctx);

    const pixels = written.get('pixels.json') as PixelsJsonMinimal;
    assert.ok(pixels, 'pixels.json written');
    assert.equal(pixels.elements.length, 0, 'the element was skipped, not recorded');
    assert.equal(pixels.elementsSkipped, 1, 'an element entirely off the captured viewport must count as skipped');
    assert.equal(pixels.elementsTotal, 1);
  });

  test('collectPixels: an element fully excluded by an ancestor clip-path shape (every candidate pixel fails the shape test, mask.count === 0) is skipped and counted in elementsSkipped', async () => {
    const client = new PixelsCapStub({
      nodeIds: [1],
      // node 1's quad defaults to PX_ELEMENT_RECT, well inside the viewport and with no
      // bounding-rect clip (rect: null) -- but every candidate pixel must ALSO satisfy this
      // zero-radius circle shape centered far outside the element, so buildQuadMask's
      // `inClipShapes` check fails for every pixel and mask.count stays 0 -- the
      // `mask.count === 0` site (distinct from the effectiveRect/pixelRect sites above,
      // which never even reach mask construction).
      clipRects: { 1: { rect: null, shapes: [{ type: 'circle', cx: -1000, cy: -1000, r: 0 }], approximate: false } },
      nodes: { 1: { nodeName: 'DIV', backendNodeId: 111 } },
    });
    const { ctx, written } = makeCtx(client as unknown as CDPClient, { pixels: true });

    await collectPixels(ctx);

    const pixels = written.get('pixels.json') as PixelsJsonMinimal;
    assert.ok(pixels, 'pixels.json written');
    assert.equal(pixels.elements.length, 0, 'the element was skipped, not recorded');
    assert.equal(pixels.elementsSkipped, 1, 'an ancestor clip-path shape excluding every on-mask pixel must count the element as skipped');
    assert.equal(pixels.elementsTotal, 1);
  });

  test(
    'collectPixels: enumeration finds 2001 elements, MAX_ELEMENTS=2000 caps the crop loop -> elementsTotal:2001, elementsTruncated:true',
    { timeout: 20000 },
    async () => {
      const nodeIds = Array.from({ length: 2001 }, (_, i) => i + 1);
      const client = new PixelsCapStub({ nodeIds, nodes: {} });
      const { ctx, written } = makeCtx(client as unknown as CDPClient, { pixels: true });

      await collectPixels(ctx);

      const pixels = written.get('pixels.json') as PixelsJsonMinimal;
      assert.ok(pixels, 'pixels.json written');
      assert.equal(pixels.elementsTotal, 2001, 'the full pre-slice enumeration count, cheaply known before slicing');
      assert.equal(pixels.elementsTruncated, true, 'a real enumeration beyond MAX_ELEMENTS=2000 must flip elementsTruncated true');
    },
  );

  test('collectPixels: a small enumeration (2 elements) under the cap reports elementsTruncated: false, never merely omitted', async () => {
    const client = new PixelsCapStub({
      nodeIds: [1, 2],
      nodes: { 1: { nodeName: 'DIV', backendNodeId: 111 }, 2: { nodeName: 'SPAN', backendNodeId: 222 } },
    });
    const { ctx, written } = makeCtx(client as unknown as CDPClient, { pixels: true });

    await collectPixels(ctx);

    const pixels = written.get('pixels.json') as PixelsJsonMinimal;
    assert.ok(pixels, 'pixels.json written');
    assert.equal(pixels.elementsTotal, 2);
    assert.equal(pixels.elementsTruncated, false);
    assert.equal(pixels.elementsSkipped, 0, 'both elements had real layout boxes -- nothing was skipped');
  });
});

// ============================================================================
// Shared real-Chrome readiness helper for the states.ts/pixels.ts Finding D
// blocks below -- a more general counterpart to the scroll-specific
// `waitForFixtureReady` above, parameterized on the page-readiness check
// expression since these fixtures are simple single-element pages rather
// than a scroll container needing its own scrollability check.
// ============================================================================

async function waitForElementReady(client: CDPClient, checkExpression: string, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await client.send('Runtime.evaluate', {
      expression: checkExpression,
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (res.result?.value) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`fixture page did not become ready in time (expression: ${checkExpression})`);
}

// ============================================================================
// states.ts — Finding D (I-3): real-Chrome backendNodeId EQUALITY vs geometry.json
// ============================================================================

const STATES_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;">
<button id="target">Click me</button>
</body></html>`;

const STATES_FIXTURE_URL = `data:text/html,${encodeURIComponent(STATES_FIXTURE_HTML)}`;

describe('states.ts — Finding D (I-3): real-Chrome backendNodeId EQUALITY vs geometry.json', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;
  let states: StatesJsonMinimal;
  let geometry: GeometryJson;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;

    const wsUrl = await newPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
    await client.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 300, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.bringToFront');

    await client.send('Page.navigate', { url: STATES_FIXTURE_URL });
    await waitForElementReady(client, "document.readyState === 'complete' && document.getElementById('target') !== null");

    const store: Record<string, unknown> = {};
    const ctx: SnapshotContext = {
      client,
      dir: '/tmp/measure-mutating-invariants-test-states-identity-unused',
      snapId: 'states-geometry-identity-test-snap',
      url: STATES_FIXTURE_URL,
      viewport: null,
      settled: true,
      freezeAnimations: false,
      captureUnsettled: false,
      pixels: false,
      state: ['hover:button#target'],
      unstableRegions: [],
      write: makeInMemoryWriter(store),
    };

    await collectStates(ctx);
    await collectGeometry(ctx);

    states = store['states.json'] as StatesJsonMinimal;
    geometry = store['geometry.json'] as GeometryJson;
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

  test('states.json: real Chrome resolves the hover:button#target request into a captured hover-state record', () => {
    assert.ok(states, 'states.json was produced');
    const hoverEl = states.elements.find((e) => e.state === 'hover');
    assert.ok(hoverEl, `expected a hover state record, got states ${JSON.stringify(states.elements.map((e) => e.state))}`);
  });

  test("states.json: button#target's backendNodeId EQUALS geometry.json's #target backendNodeId", () => {
    const hoverEl = states.elements.find((e) => e.state === 'hover');
    assert.ok(hoverEl, 'expected a hover state record');
    assert.notEqual(hoverEl!.backendNodeId, undefined, "expected states.json's hover record to carry a backendNodeId");

    const geoTarget = geometry.elements.find((e) => e.selector === '#target');
    assert.ok(geoTarget, 'expected a geometry.json record for #target');
    assert.notEqual(geoTarget!.backendNodeId, undefined, "expected geometry.json's #target to carry a backendNodeId");

    assert.equal(
      hoverEl!.backendNodeId,
      geoTarget!.backendNodeId,
      `expected states.json's hover backendNodeId (${hoverEl!.backendNodeId}) to EQUAL geometry.json's #target backendNodeId (${geoTarget!.backendNodeId}) -- proving the two collectors joined the SAME DOM node, not merely each carrying some number`,
    );
  });
});

// ============================================================================
// pixels.ts — Finding D (I-3): real-Chrome backendNodeId EQUALITY vs geometry.json
// ============================================================================

const PIXELS_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;background:rgb(255,255,255);">
<div id="plain" style="position:absolute;top:10px;left:10px;width:40px;height:40px;background:rgb(0,0,255);"></div>
</body></html>`;

const PIXELS_FIXTURE_URL = `data:text/html,${encodeURIComponent(PIXELS_FIXTURE_HTML)}`;

describe('pixels.ts — Finding D (I-3): real-Chrome backendNodeId EQUALITY vs geometry.json', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;
  let pixelsJson: PixelsJsonMinimal;
  let geometry: GeometryJson;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;

    const wsUrl = await newPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
    await client.send('Emulation.setDeviceMetricsOverride', { width: 200, height: 200, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.bringToFront');

    await client.send('Page.navigate', { url: PIXELS_FIXTURE_URL });
    await waitForElementReady(client, "document.readyState === 'complete' && document.getElementById('plain') !== null");

    const store: Record<string, unknown> = {};
    const ctx: SnapshotContext = {
      client,
      dir: '/tmp/measure-mutating-invariants-test-pixels-identity-unused',
      snapId: 'pixels-geometry-identity-test-snap',
      url: PIXELS_FIXTURE_URL,
      viewport: null,
      settled: true,
      freezeAnimations: false,
      captureUnsettled: false,
      pixels: true,
      state: [],
      unstableRegions: [],
      write: makeInMemoryWriter(store),
    };

    await collectPixels(ctx);
    await collectGeometry(ctx);

    pixelsJson = store['pixels.json'] as PixelsJsonMinimal;
    geometry = store['geometry.json'] as GeometryJson;
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

  test('pixels.json: real Chrome crops div#plain into a pixels.json element record', () => {
    assert.ok(pixelsJson, 'pixels.json was produced');
    const plain = pixelsJson.elements.find((e) => e.selector === 'div#plain');
    assert.ok(plain, `expected a pixels.json element for div#plain, got selectors ${JSON.stringify(pixelsJson.elements.map((e) => e.selector))}`);
  });

  test("pixels.json: div#plain's backendNodeId EQUALS geometry.json's #plain backendNodeId", () => {
    const plain = pixelsJson.elements.find((e) => e.selector === 'div#plain');
    assert.ok(plain, 'expected a pixels.json element for div#plain');
    assert.notEqual(plain!.backendNodeId, undefined, "expected pixels.json's div#plain record to carry a backendNodeId");

    const geoPlain = geometry.elements.find((e) => e.selector === '#plain');
    assert.ok(geoPlain, 'expected a geometry.json record for #plain');
    assert.notEqual(geoPlain!.backendNodeId, undefined, "expected geometry.json's #plain to carry a backendNodeId");

    assert.equal(
      plain!.backendNodeId,
      geoPlain!.backendNodeId,
      `expected pixels.json's div#plain backendNodeId (${plain!.backendNodeId}) to EQUAL geometry.json's #plain backendNodeId (${geoPlain!.backendNodeId}) -- proving the two collectors joined the SAME DOM node, not merely each carrying some number`,
    );
  });
});
