import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import type { CDPClient } from '../src/cdp/client.js';
import type { SnapshotContext, SnapshotWriter } from '../src/cdp/measure/types.js';
import { collectFocus } from '../src/cdp/measure/collectors/focus.js';
import { collectScroll } from '../src/cdp/measure/collectors/scroll.js';
import { collectLayers } from '../src/cdp/measure/collectors/layers.js';
import { collectAnimation } from '../src/cdp/measure/collectors/animation.js';

// ============================================================================
// Test harness — a recording SnapshotWriter (no real fs) plus a stub
// CDPClient per collector, following the pattern established by
// `test/snapshot-settledness.test.ts` (Runtime.evaluate pattern-matched by
// marker-comment `.includes(...)`) and `test/recorder-bridge.test.ts`
// (EventEmitter-based stub for CDP domain events, `fire()`/synchronous
// emit from inside `send()`).
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
    dir: '/tmp/measure-maps-substrate-test',
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
// 1. focus.ts — Tab-order traversal
// ============================================================================

interface FocusCandidateFixture {
  id: string;
  selector: string;
  tabIndex: number;
  rect: { x: number; y: number; width: number; height: number } | null;
  visible: boolean;
  domIndex: number;
}

class FocusStubCdpClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  private sampleIndex = 0;

  private readonly candidates: FocusCandidateFixture[] = [
    { id: 'focus-1', selector: 'a.skip-link', tabIndex: 0, rect: { x: 8, y: 8, width: 44, height: 20 }, visible: true, domIndex: 0 },
    { id: 'focus-2', selector: 'button.menu', tabIndex: 0, rect: { x: 8, y: 16, width: 44, height: 44 }, visible: true, domIndex: 1 },
    { id: 'focus-3', selector: 'button.close', tabIndex: 1, rect: { x: 300, y: 8, width: 32, height: 32 }, visible: true, domIndex: 2 },
    { id: 'focus-4', selector: 'button.hidden-submit', tabIndex: 0, rect: null, visible: false, domIndex: 3 },
  ];

  // Real Tab order visits positive-tabindex elements first (focus-3, tabIndex 1),
  // then tabindex-0/DOM-order elements (focus-1, focus-2) — diverging from DOM
  // order at step 2. `focus-4` (display:none) is never reached. Forward cycles
  // back to focus-3 on the 4th press; reverse is driven independently and, for
  // this fixture, comes out as the literal reverse.
  private readonly forwardSequence = ['focus-3', 'focus-1', 'focus-2', 'focus-3'];
  private readonly reverseSequence = ['focus-2', 'focus-1', 'focus-3', 'focus-2'];

  private byId(id: string): FocusCandidateFixture | undefined {
    return this.candidates.find((c) => c.id === id);
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'Input.dispatchKeyEvent') return {};
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureFocusOrigin')) {
        // Non-mutating origin read, answered FIRST (before any marker is
        // stamped) — this is what the collector's `originCaptured` gate
        // keys on, and here it always succeeds, so restore below takes the
        // full destructive path (refocus/blur + scrollTo), not the
        // marker-only cleanup fallback.
        return { result: { value: { hadOriginalFocus: false, scrollX: 0, scrollY: 0 } } };
      }
      if (expression.includes('__captureFocusInit')) {
        return {
          result: {
            value: {
              candidates: this.candidates,
              clickableUnfocusable: [{ selector: 'div.card[onclick]', rect: { x: 20, y: 300, width: 350, height: 80 } }],
              iframesPresent: 0,
              shadowHostsPresent: 0,
            },
          },
        };
      }
      if (expression.includes('__captureFocusSample')) {
        const sequence = this.sampleIndex < 4 ? this.forwardSequence : this.reverseSequence;
        const localIndex = this.sampleIndex < 4 ? this.sampleIndex : this.sampleIndex - 4;
        const id = sequence[localIndex];
        this.sampleIndex += 1;
        const candidate = this.byId(id)!;
        return {
          result: {
            value: {
              id: candidate.id,
              selector: candidate.selector,
              role: null,
              name: candidate.selector,
              rect: candidate.rect,
              tabIndex: candidate.tabIndex,
              focusVisibleStyle: { outline: 'solid 2px rgb(26, 86, 219)', boxShadow: 'none' },
              scrollX: 0,
              scrollY: 0,
              isBody: false,
            },
          },
        };
      }
      if (expression.includes('__captureFocusMarkerCleanup')) {
        // Not exercised on this happy path (origin is always captured here,
        // so restore always takes the full destructive path below) but
        // answered so the collector's other restore-gating branch never hits
        // an unhandled/undefined `Runtime.evaluate` response either.
        return { result: { value: { markersRemoved: true } } };
      }
      if (expression.includes('__captureFocusRestore')) {
        return { result: { value: { focusRestored: true, markersRemoved: true, scrollRestored: true } } };
      }
      return { result: {} };
    }
    return {};
  }
}

function asClient(stub: unknown): CDPClient {
  return stub as unknown as CDPClient;
}

test('collectFocus: forward walk reflects positive-tabindex reordering, reverse is independently driven, unreached candidate is reported', async () => {
  const client = new FocusStubCdpClient();
  const { ctx, written } = makeCtx(client);

  await collectFocus(ctx);

  const focus = written.get('focus.json') as any;
  assert.ok(focus, 'expected focus.json to be written');

  assert.deepEqual(
    focus.forward.map((s: any) => s.id),
    ['focus-3', 'focus-1', 'focus-2'],
    'forward walk visits positive-tabindex focus-3 before DOM-earlier focus-1/focus-2, and stops before repeating the cycle-closing focus-3',
  );
  assert.deepEqual(
    focus.reverse.map((s: any) => s.id),
    ['focus-2', 'focus-1', 'focus-3'],
  );

  // DOM-order divergence: step 2 (focus-1, domIndex 0) follows step 1
  // (focus-3, domIndex 2) — domIndex went backward.
  assert.equal(focus.domOrderDivergence.length, 1);
  assert.equal(focus.domOrderDivergence[0].id, 'focus-1');
  assert.equal(focus.domOrderDivergence[0].domIndex, 0);
  assert.equal(focus.domOrderDivergence[0].previousDomIndex, 2);
  // The divergence entry's backendNodeId is the SAME value carried by the
  // forward stop for that same id (focus-1), not a fabricated/independent
  // number — this stub has no DOM.describeNode wired up, so both are
  // `undefined` here; the equality itself (not the value's presence) is
  // what a real cross-artifact join requires, and is proven with a real
  // backendNodeId end to end in test/measure-focus-geometry-identity.test.ts.
  const divergedStop = focus.forward.find((s: any) => s.id === focus.domOrderDivergence[0].id);
  assert.equal(focus.domOrderDivergence[0].backendNodeId, divergedStop.backendNodeId);

  // focus-4 (display:none) was a focusable candidate but never visited.
  assert.deepEqual(
    focus.unreachedFocusable.map((u: any) => u.id),
    ['focus-4'],
  );
  assert.equal(focus.unreachedFocusable[0].visible, false);

  assert.equal(focus.clickableUnfocusable.length, 1);
  assert.equal(focus.clickableUnfocusable[0].selector, 'div.card[onclick]');
  assert.deepEqual(focus.clickableUnfocusable[0].rect, { x: 20, y: 300, width: 350, height: 80 });
  // The stub provides no DOM.describeNode, so the marker→backendNodeId
  // resolution fails for this element-bearing clickable record. Per I-3/I-5
  // (hittest.ts's resolvedIdentity shape) that is reported honestly as
  // `backendNodeId: null` (never an omitted key) plus `identityUnresolved: true`,
  // not a silently absent field.
  assert.equal(focus.clickableUnfocusable[0].backendNodeId, null);
  assert.equal(focus.clickableUnfocusable[0].identityUnresolved, true);
  assert.equal(focus.candidateCount, 4);

  // Focus-visible style facts are carried per stop.
  assert.equal(focus.forward[0].focusVisibleStyle.outline, 'solid 2px rgb(26, 86, 219)');

  // The non-mutating origin read happens FIRST, before any marker mutation
  // — it is the very first Runtime.evaluate call issued.
  const firstEvaluate = client.calls.find((c) => c.method === 'Runtime.evaluate');
  assert.ok(
    String((firstEvaluate?.params as any)?.expression ?? '').includes('__captureFocusOrigin'),
    'expected the non-mutating origin read to run before any marker-stamping init call',
  );

  // Restore is gated on `originCaptured` (true here, since the stub answers
  // the origin read), which routes both restore points through the full
  // destructive restore script rather than the marker-only cleanup
  // fallback — invoked twice: once before the reverse walk (so the reverse
  // walk starts from the same original element the forward walk did), once
  // more in the `finally` to restore real page state after the traversal.
  const restoreCalls = client.calls.filter(
    (c) => c.method === 'Runtime.evaluate' && String((c.params as any)?.expression ?? '').includes('__captureFocusRestore'),
  );
  assert.equal(restoreCalls.length, 2);

  // The restoration outcome is reported factually in focus.json, driven by
  // the final (finally-block) restore call's return value.
  assert.deepEqual(focus.restoration, {
    attempted: true,
    focusRestored: true,
    markersCleared: true,
    scrollRestored: true,
  });

  // Real Tab/Shift+Tab key events were dispatched to drive the walk (not a
  // JS-only `.focus()` simulation) — forward uses modifiers 0, reverse uses
  // modifiers 8 (Shift).
  const keyDowns = client.calls.filter((c) => c.method === 'Input.dispatchKeyEvent' && (c.params as any).type === 'rawKeyDown');
  assert.equal(keyDowns.length, 8); // 4 forward + 4 reverse presses
  assert.ok(keyDowns.slice(0, 4).every((c) => (c.params as any).modifiers === 0));
  assert.ok(keyDowns.slice(4).every((c) => (c.params as any).modifiers === 8));
});

// ============================================================================
// 2. scroll.ts — scroll-container discovery
// ============================================================================

class ScrollStubCdpClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureScrollTopology')) {
        return {
          result: {
            value: {
              containers: [
                {
                  selector: '(document)',
                  isRoot: true,
                  rect: { x: 0, y: 0, width: 390, height: 844 },
                  scrollWidth: 390,
                  scrollHeight: 1840,
                  clientWidth: 390,
                  clientHeight: 844,
                  scrollTop: 0,
                  scrollLeft: 0,
                  maxScrollTop: 996,
                  maxScrollLeft: 0,
                  overflowX: 'visible',
                  overflowY: 'auto',
                  scrollbarGutter: 'auto',
                  scrollSnapType: 'none',
                  snapDescendants: [],
                  stickyFixedDescendants: [
                    { selector: 'header.app-bar', position: 'sticky', rect: { x: 0, y: 0, width: 390, height: 56 } },
                    { selector: '.composer', position: 'fixed', rect: { x: 0, y: 800, width: 390, height: 44 } },
                  ],
                  samples: [],
                  nestedAncestry: [],
                },
                {
                  selector: '.message-list',
                  isRoot: false,
                  rect: { x: 0, y: 56, width: 390, height: 612 },
                  scrollWidth: 390,
                  scrollHeight: 2841,
                  clientWidth: 390,
                  clientHeight: 612,
                  scrollTop: 0,
                  scrollLeft: 0,
                  maxScrollTop: 2229,
                  maxScrollLeft: 0,
                  overflowX: 'visible',
                  overflowY: 'scroll',
                  scrollbarGutter: 'stable',
                  scrollSnapType: 'none',
                  snapDescendants: [],
                  stickyFixedDescendants: [],
                  samples: [
                    { offsetTop: 0, visibleChildren: [{ selector: '.message[data-id=1]', rect: { x: 0, y: 56, width: 390, height: 80 } }] },
                    {
                      offsetTop: 2229,
                      visibleChildren: [{ selector: '.message[data-id=98]', rect: { x: 0, y: 2760, width: 390, height: 81 } }],
                    },
                  ],
                  nestedAncestry: ['(document)'],
                },
              ],
              documentScrollHeight: 1840,
              documentScrollWidth: 390,
              scrollContainersTotal: 2,
              scrollContainersTruncated: false,
              iframesPresent: 0,
              shadowHostsPresent: 0,
              offsetsRestored: true,
              scriptError: null,
            },
          },
        };
      }
      return { result: {} };
    }
    if (method === 'Page.getLayoutMetrics') {
      return {
        cssVisualViewport: { clientWidth: 390, clientHeight: 844, scale: 1, pageX: 0, pageY: 0 },
        cssLayoutViewport: { clientWidth: 390, clientHeight: 844 },
      };
    }
    return {};
  }
}

test('collectScroll: discovers containers, samples reachable content, and reads visual/layout viewport', async () => {
  const client = new ScrollStubCdpClient();
  const { ctx, written } = makeCtx(client);

  await collectScroll(ctx);

  const scroll = written.get('scroll.json') as any;
  assert.ok(scroll, 'expected scroll.json to be written');
  assert.equal(scroll.containers.length, 2);

  const root = scroll.containers[0];
  assert.equal(root.isRoot, true);
  assert.equal(root.maxScrollTop, 996);
  assert.equal(root.stickyFixedDescendants.length, 2);
  assert.ok(root.stickyFixedDescendants.some((d: any) => d.position === 'sticky'));
  assert.ok(root.stickyFixedDescendants.some((d: any) => d.position === 'fixed'));

  const messageList = scroll.containers[1];
  assert.equal(messageList.selector, '.message-list');
  assert.equal(messageList.overflowY, 'scroll');
  assert.equal(messageList.scrollbarGutter, 'stable');
  assert.equal(messageList.samples.length, 2);
  assert.equal(messageList.samples[1].offsetTop, 2229);
  assert.equal(messageList.samples[1].visibleChildren[0].selector, '.message[data-id=98]');
  assert.deepEqual(messageList.nestedAncestry, ['(document)']);

  assert.equal(scroll.documentScrollHeight, 1840);
  assert.deepEqual(scroll.visualViewport, { clientWidth: 390, clientHeight: 844, scale: 1, pageX: 0, pageY: 0 });
  assert.deepEqual(scroll.layoutViewport, { clientWidth: 390, clientHeight: 844 });

  assert.ok(client.calls.some((c) => c.method === 'Page.getLayoutMetrics'));

  // Positive control (I-4/I-5, scroll #37/#38 + nestedAncestry sibling): this
  // topology/metrics fixture is now COMPLETE (every optional field the fix
  // gates on is present with a genuine value), so none of the honesty
  // markers introduced by the fix should fire on this happy path — proving
  // the fix is inert on well-formed CDP responses, not just present on
  // malformed ones.
  assert.equal(scroll.scrollContainersCountUnavailable, undefined, 'complete topology counts must not be flagged unavailable');
  assert.equal(scroll.scopeCountsUnavailable, undefined, 'complete iframe/shadow-host counts must not be flagged unavailable');
  assert.equal(scroll.visualViewportUnavailable, undefined, 'a genuine cssVisualViewport value must not be flagged unavailable');
  assert.equal(scroll.layoutViewportUnavailable, undefined, 'a genuine cssLayoutViewport value must not be flagged unavailable');
  assert.equal(root.nestedAncestryUnavailable, undefined, 'root supplied nestedAncestry: [] — a genuine empty array, not a missing field');
  assert.equal(messageList.nestedAncestryUnavailable, undefined, 'messageList supplied a genuine nestedAncestry array');
});

// ============================================================================
// 2b. scroll.ts — I-4/I-5 honesty markers on malformed-but-successful
// topology/metrics responses (scroll #37, #38, nestedAncestry sibling)
// ============================================================================

/**
 * A configurable scroll stub: the caller hand-crafts exactly the
 * (deliberately malformed) `topology`/`metrics` shape each adversarial case
 * needs, mirroring the off-limits `test/measure-mutating-invariants.test.ts`
 * file's own `ScrollStub` pattern (not imported — that class isn't
 * exported, so this is a fresh small class local to this file).
 */
class ConfigurableScrollStubCdpClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];

  constructor(
    private readonly topology: Record<string, unknown>,
    private readonly metrics: Record<string, unknown> = {
      cssVisualViewport: { clientWidth: 390, clientHeight: 844, scale: 1, pageX: 0, pageY: 0 },
      cssLayoutViewport: { clientWidth: 390, clientHeight: 844 },
    },
  ) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureScrollTopology')) {
        return { result: { value: this.topology } };
      }
      return { result: {} };
    }
    if (method === 'Page.getLayoutMetrics') {
      return this.metrics;
    }
    return {};
  }
}

/** A single well-formed scroll container, complete on every field `toContainerOut` unconditionally reads (`.map`s on arrays that must exist), so each adversarial test can override just the field(s) under test. */
function makeContainerFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    selector: '.container',
    isRoot: true,
    rect: { x: 0, y: 0, width: 390, height: 844 },
    scrollWidth: 390,
    scrollHeight: 1000,
    clientWidth: 390,
    clientHeight: 844,
    scrollTop: 0,
    scrollLeft: 0,
    maxScrollTop: 156,
    maxScrollLeft: 0,
    overflowX: 'visible',
    overflowY: 'auto',
    scrollbarGutter: 'auto',
    scrollSnapType: 'none',
    snapDescendants: [],
    stickyFixedDescendants: [],
    samples: [],
    nestedAncestry: [],
    ...overrides,
  };
}

test('collectScroll (scroll #37 — container counts): topology missing scrollContainersTotal/scrollContainersTruncated is reported unavailable, with fallback totals still emitted', async () => {
  const topology = {
    containers: [makeContainerFixture()],
    documentScrollHeight: 1000,
    documentScrollWidth: 390,
    offsetsRestored: true,
    iframesPresent: 0,
    shadowHostsPresent: 0,
    scriptError: null,
    // scrollContainersTotal / scrollContainersTruncated deliberately omitted.
  };
  const client = new ConfigurableScrollStubCdpClient(topology);
  const { ctx, written } = makeCtx(client);

  await collectScroll(ctx);

  const scroll = written.get('scroll.json') as any;
  assert.equal(scroll.available, true, 'the topology evaluate itself succeeded — this is a malformed successful response, not an evaluate failure');
  assert.equal(scroll.scrollContainersCountUnavailable, true, 'a missing scrollContainersTotal/scrollContainersTruncated on an otherwise-present topology must be flagged, not silently defaulted');
  assert.equal(scroll.scrollContainersTotal, 1, 'fallback totals are still emitted (containers.length), not withheld, alongside the marker');
  assert.equal(scroll.scrollContainersTruncated, false, 'fallback truncation flag (length comparison) is still emitted alongside the marker');
  // Isolation: the scope-counts/viewport/nestedAncestry markers are complete
  // in this fixture and must not fire as a side effect.
  assert.equal(scroll.scopeCountsUnavailable, undefined);
  assert.equal(scroll.visualViewportUnavailable, undefined);
  assert.equal(scroll.layoutViewportUnavailable, undefined);
});

test('collectScroll (scroll #37 sibling — scope counts): topology missing iframesPresent/shadowHostsPresent is reported unavailable, while scope keeps its exact 4-key shape', async () => {
  const topology = {
    containers: [makeContainerFixture()],
    documentScrollHeight: 1000,
    documentScrollWidth: 390,
    offsetsRestored: true,
    scrollContainersTotal: 1,
    scrollContainersTruncated: false,
    scriptError: null,
    // iframesPresent / shadowHostsPresent deliberately omitted.
  };
  const client = new ConfigurableScrollStubCdpClient(topology);
  const { ctx, written } = makeCtx(client);

  await collectScroll(ctx);

  const scroll = written.get('scroll.json') as any;
  assert.equal(scroll.scopeCountsUnavailable, true, 'a missing iframesPresent/shadowHostsPresent on an otherwise-present topology must be flagged, not silently defaulted to 0/0');
  assert.deepEqual(
    scroll.scope,
    { root: 'top-document', shadowDom: 'light-only', iframesPresent: 0, shadowHostsPresent: 0 },
    'the marker lives on ScrollReport, not inside scope — scope keeps its exact 4-key shape (asserted verbatim by the off-limits restoration test) even when its counts are fallback values',
  );
  // Isolation.
  assert.equal(scroll.scrollContainersCountUnavailable, undefined);
  assert.equal(scroll.visualViewportUnavailable, undefined);
  assert.equal(scroll.layoutViewportUnavailable, undefined);
});

test('collectScroll (scroll #38 — viewport unavailable): Page.getLayoutMetrics resolving with no viewport fields at all is reported unavailable, not a genuine empty viewport', async () => {
  const topology = {
    containers: [makeContainerFixture()],
    documentScrollHeight: 1000,
    documentScrollWidth: 390,
    offsetsRestored: true,
    iframesPresent: 0,
    shadowHostsPresent: 0,
    scrollContainersTotal: 1,
    scrollContainersTruncated: false,
    scriptError: null,
  };
  const client = new ConfigurableScrollStubCdpClient(topology, {});

  const { ctx, written } = makeCtx(client);

  await collectScroll(ctx);

  const scroll = written.get('scroll.json') as any;
  assert.equal(scroll.visualViewport, null, 'a genuinely malformed getLayoutMetrics response (neither css* nor legacy field) falls back to null, never a fabricated viewport');
  assert.equal(scroll.visualViewportUnavailable, true);
  assert.equal(scroll.layoutViewport, null);
  assert.equal(scroll.layoutViewportUnavailable, true);
  // Isolation.
  assert.equal(scroll.scrollContainersCountUnavailable, undefined);
  assert.equal(scroll.scopeCountsUnavailable, undefined);
});

test('collectScroll (scroll #38 positive control): Page.getLayoutMetrics resolving with ONLY the legacy visualViewport/layoutViewport fields (no css*) is a legitimate version fallback, not flagged unavailable', async () => {
  const topology = {
    containers: [makeContainerFixture()],
    documentScrollHeight: 1000,
    documentScrollWidth: 390,
    offsetsRestored: true,
    iframesPresent: 0,
    shadowHostsPresent: 0,
    scrollContainersTotal: 1,
    scrollContainersTruncated: false,
    scriptError: null,
  };
  const legacyMetrics = {
    visualViewport: { clientWidth: 390, clientHeight: 844, scale: 1, pageX: 0, pageY: 0 },
    layoutViewport: { clientWidth: 390, clientHeight: 844 },
  };
  const client = new ConfigurableScrollStubCdpClient(topology, legacyMetrics);

  const { ctx, written } = makeCtx(client);

  await collectScroll(ctx);

  const scroll = written.get('scroll.json') as any;
  assert.deepEqual(scroll.visualViewport, legacyMetrics.visualViewport, 'the legacy field is a legitimate older-Chrome shape and must pass through via fallback');
  assert.equal(scroll.visualViewportUnavailable, undefined, 'a legitimate version fallback (legacy field present, css* absent) must NOT be flagged unavailable');
  assert.deepEqual(scroll.layoutViewport, legacyMetrics.layoutViewport);
  assert.equal(scroll.layoutViewportUnavailable, undefined);
});

test('collectScroll (nestedAncestry sibling): a container missing the nestedAncestry field entirely is reported unavailable, with the [] fallback still emitted', async () => {
  const containerMissingAncestry = makeContainerFixture();
  delete containerMissingAncestry.nestedAncestry;
  const topology = {
    containers: [containerMissingAncestry],
    documentScrollHeight: 1000,
    documentScrollWidth: 390,
    offsetsRestored: true,
    iframesPresent: 0,
    shadowHostsPresent: 0,
    scrollContainersTotal: 1,
    scrollContainersTruncated: false,
    // Plausible: a mid-loop throw during the in-page nested-ancestry pass,
    // after `containers` was already fully populated.
    scriptError: "TypeError: Cannot read properties of null (reading 'parentElement') at computeNestedAncestry",
  };
  const client = new ConfigurableScrollStubCdpClient(topology);

  const { ctx, written } = makeCtx(client);

  await collectScroll(ctx);

  const scroll = written.get('scroll.json') as any;
  assert.deepEqual(scroll.containers[0].nestedAncestry, [], 'the [] fallback is still emitted, not withheld, alongside the marker');
  assert.equal(scroll.containers[0].nestedAncestryUnavailable, true, 'a MISSING nestedAncestry field on an otherwise-present container must be flagged, not silently read as "no nested scrollable ancestors"');
  assert.equal(scroll.restoration.error, topology.scriptError, 'the same in-page failure that left nestedAncestry unassigned is independently carried on restoration.error');
});

// ============================================================================
// 3. layers.ts — compositor layer map + provenance
// ============================================================================

class LayersStubCdpClient extends EventEmitter {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];

  private readonly layers = [
    { layerId: 'L1', backendNodeId: 10, offsetX: 0, offsetY: 0, width: 390, height: 1840, paintCount: 5, drawsContent: true },
    { layerId: 'L2', backendNodeId: 20, offsetX: 0, offsetY: 56, width: 390, height: 220, paintCount: 2, drawsContent: true },
  ];

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    switch (method) {
      case 'LayerTree.enable':
        // Real Chrome redelivers the current layer tree as a fresh event on
        // (re-)enable — emit synchronously before this resolves, since
        // `collectLayers` registers its listener before awaiting this call.
        this.emit('LayerTree.layerTreeDidChange', { layers: this.layers });
        return {};
      case 'LayerTree.compositingReasons': {
        const layerId = (params as { layerId?: string }).layerId;
        if (layerId === 'L1') return { compositingReasonIds: [] };
        if (layerId === 'L2') return { compositingReasons: ['video'] };
        return {};
      }
      case 'DOM.describeNode': {
        const backendNodeId = (params as { backendNodeId?: number }).backendNodeId;
        if (backendNodeId === 10) return { node: { nodeName: 'MAIN', attributes: ['class', 'app'] } };
        if (backendNodeId === 20) return { node: { nodeName: 'VIDEO', attributes: ['class', 'promo'] } };
        return { node: {} };
      }
      case 'DOM.pushNodesByBackendIdsToFrontend': {
        const backendNodeId = (params as { backendNodeIds?: number[] }).backendNodeIds?.[0];
        if (backendNodeId === 10) return { nodeIds: [100] };
        if (backendNodeId === 20) return { nodeIds: [200] };
        return {};
      }
      case 'CSS.getMatchedStylesForNode': {
        const nodeId = (params as { nodeId?: number }).nodeId;
        if (nodeId === 100) {
          return {
            matchedCSSRules: [
              {
                rule: {
                  selectorList: { selectors: [{ text: 'main.app' }], text: 'main.app' },
                  origin: 'regular',
                  style: { cssProperties: [{ name: 'transform', value: 'translateY(-4px)' }] },
                },
                matchingSelectors: [0],
              },
            ],
          };
        }
        return { matchedCSSRules: [] };
      }
      case 'CSS.getComputedStyleForNode': {
        // resolveStyleProvenance now genuinely consumes the computed value (the real cascade
        // winner's `value` field, not just the declared/authored text) — this stub answers it
        // so the genuine-success path can resolve past the honest `computedResult.available`
        // gate. Only node 100 (main.app, backendNodeId 10) needs a real entry; node 200 has no
        // matched-rule winner regardless, so its computed style is irrelevant to the assertions.
        const nodeId = (params as { nodeId?: number }).nodeId;
        if (nodeId === 100) {
          return { computedStyle: [{ name: 'transform', value: 'matrix(1, 0, 0, 1, 0, -4)' }] };
        }
        return { computedStyle: [] };
      }
      default:
        return {};
    }
  }

  on(event: string, handler: (params: unknown) => void): this {
    return super.on(event, handler);
  }
}

test('collectLayers: reads bounds/reasons/paint-order/node-membership and best-effort style provenance', async () => {
  const client = new LayersStubCdpClient();
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  assert.ok(layers, 'expected layers.json to be written');
  assert.equal(layers.layers.length, 2);
  assert.equal(layers.layerTree.available, true, 'the layerTreeDidChange event was delivered, so the tree is available');
  // The old layer-id delivery order now lives on `layerPaintOrder`; top-level
  // `paintOrder` is the DOMSnapshot-sourced fact (unavailable under this stub).
  assert.deepEqual(layers.layerPaintOrder, ['L1', 'L2']);
  assert.equal(layers.paintOrder.available, false);

  const main = layers.layers[0];
  assert.equal(main.id, 'L1');
  assert.equal(main.selector, 'main.app');
  assert.deepEqual(main.bounds, { x: 0, y: 0, width: 390, height: 1840 });
  assert.equal(main.layerPaintOrder, 0);
  assert.deepEqual(main.compositingReasons, []);
  assert.ok(main.styleProvenance, 'expected best-effort style provenance for the transform-triggered layer');
  assert.equal(main.styleProvenance.property, 'transform');
  assert.equal(main.styleProvenance.selector, 'main.app');
  // Winning-declaration semantics, not just a matching selector: the declared value and
  // specificity of the actual winning rule are reported (D6/Major-5 remediation).
  assert.equal(main.styleProvenance.declaredValue, 'translateY(-4px)');
  assert.equal(main.styleProvenance.specificity, '0-1-1');

  const video = layers.layers[1];
  assert.equal(video.id, 'L2');
  assert.equal(video.selector, 'video.promo');
  assert.equal(video.layerPaintOrder, 1);
  assert.deepEqual(video.compositingReasons, ['video']);
  assert.equal(video.styleProvenance, undefined, 'no layer-affecting rule was matched for this node — provenance is absent, not fabricated');

  assert.ok(client.calls.some((c) => c.method === 'LayerTree.enable'));
});

test('collectLayers: no layerTreeDidChange event within the timeout writes an empty layer set (not a hang or a throw)', async () => {
  class NoEventClient {
    async send(method: string): Promise<unknown> {
      if (method === 'LayerTree.enable') return {}; // never emits an event
      return {};
    }
    on(): void {
      // Registers a handler that is simply never called.
    }
  }
  const client = new NoEventClient();
  const { ctx, written } = makeCtx(client);

  await collectLayers(ctx);

  const layers = written.get('layers.json') as any;
  assert.deepEqual(layers.layers, []);
  assert.equal(layers.layerTree.available, false, 'no layerTreeDidChange event within the timeout is an explicit unavailability fact');
  assert.deepEqual(layers.layerPaintOrder, []);
  assert.equal(layers.paintOrder.available, false);
});

// ============================================================================
// 4. animation.ts — inventory shape coordination with the settledness gate
// ============================================================================

// Models the held-return CDP bridge `collectAnimation` actually drives
// (see animation.ts's D3 identity doc comment): the inventory evaluate
// returns a container `objectId` (never a by-value result), a
// `Runtime.getProperties` on it resolves `facts`/`elements`' own
// `objectId`s, and a `Runtime.callFunctionOn({returnByValue:true})` on
// `facts`' objectId reads the raw record array back out. Neither fixture
// record carries a `targetIdx`, so `elements` is never indexed here —
// backendNodeId identity resolution is covered by the real-Chrome
// `test/measure-animation.test.ts`, not this shape test.
class AnimationStubCdpClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureAnimationInventory')) {
        return { result: { objectId: 'anim-container-1' } };
      }
      return { result: {} };
    }
    if (method === 'Runtime.getProperties') {
      const { objectId } = params as { objectId?: string };
      if (objectId === 'anim-container-1') {
        return {
          result: [
            { name: 'facts', value: { objectId: 'anim-facts-1' } },
            { name: 'elements', value: { objectId: 'anim-elements-1' } },
          ],
        };
      }
      return { result: [] };
    }
    if (method === 'Runtime.callFunctionOn') {
      const { objectId } = params as { objectId?: string };
      if (objectId === 'anim-facts-1') {
        return {
          result: {
            value: [
              { selector: '.carousel', animationName: 'slide', durationMs: 3200, iterationCount: 'infinite', infinite: true, playState: 'paused' },
              { selector: '.badge', animationName: 'pulse', durationMs: 500, iterationCount: 3, infinite: false, playState: 'finished' },
            ],
          },
        };
      }
      return { result: {} };
    }
    return {};
  }
}

test('collectAnimation: reuses the settle.ts inventory shape, adding id + frozen', async () => {
  const client = new AnimationStubCdpClient();
  const { ctx, written } = makeCtx(client, { freezeAnimations: true });

  await collectAnimation(ctx);

  const animation = written.get('animation.json') as any;
  assert.ok(animation, 'expected animation.json to be written');
  assert.equal(animation.animations.length, 2);

  const carousel = animation.animations.find((a: any) => a.selector === '.carousel');
  assert.equal(carousel.id, 'anim-1');
  assert.equal(carousel.infinite, true);
  assert.equal(carousel.playState, 'paused');
  assert.equal(carousel.frozen, true, 'freezeAnimations was requested and this animation is paused as a result');
  assert.equal(carousel.durationMs, 3200);
  assert.equal(carousel.iterationCount, 'infinite');

  const badge = animation.animations.find((a: any) => a.selector === '.badge');
  assert.equal(badge.id, 'anim-2');
  assert.equal(badge.playState, 'finished');
  assert.equal(badge.frozen, false, 'an already-finished animation is not "frozen" even when --freeze-animations was requested');

  assert.equal(animation.infiniteCount, 1);
  assert.equal(animation.frozenCount, 1);
});

test('collectAnimation: without --freeze-animations, nothing is reported frozen even if paused for other reasons', async () => {
  const client = new AnimationStubCdpClient();
  const { ctx, written } = makeCtx(client, { freezeAnimations: false });

  await collectAnimation(ctx);

  const animation = written.get('animation.json') as any;
  assert.ok(animation.animations.every((a: any) => a.frozen === false));
  assert.equal(animation.frozenCount, 0);
});
