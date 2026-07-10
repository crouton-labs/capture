/**
 * The settledness gate — decides whether a page has stopped mutating
 * (`pollForSettle`, pure) and the CDP-backed pieces that feed it (churn
 * observers, animation freezing/inventory, and grouping raw mutation/
 * animation evidence into `churn.json` + `UnstableRegion`s).
 *
 * The churn observer state (`{ lastMutationTs, mutations, resizeCount, mo,
 * ro }`) is never assigned to `window` or any other page-observable
 * location: `injectChurnObservers` evaluates the bootstrap script with
 * `returnByValue: false` and hands back a {@link ChurnObserverHandle}
 * wrapping the held CDP `objectId` of that live object. The
 * MutationObserver/ResizeObserver closures capture the state object
 * LEXICALLY, so they keep writing to it whether or not anything on the
 * page can ever see it. `buildDomSettleSampler`/`collectChurnEvidence`
 * read/mutate it back purely through `Runtime.callFunctionOn({objectId,
 * returnByValue:true})` with `this` bound to the held object — never by
 * re-evaluating a page-observable expression — so a page that predefines
 * `Object.defineProperty(window, '__captureSettle', {set(){...}})` has
 * nothing to fire against. `collectChurnEvidence` owns the handle's sole
 * `Runtime.releaseObject` call once teardown reads are done.
 *
 * A page can never settle while an infinite CSS/WAAPI animation runs — the
 * settle sampler forces `quietMs = 0` whenever one is `running` (see the
 * sample script below) — which is exactly why `freezeAnimationsBeforeCapture`
 * (pauses every animation, flipping `playState` away from `'running'`) is
 * what lets an otherwise-forever-churning page settle.
 */

import type { CDPClient } from '../client.js';
import { sanitizeString } from './redaction.js';
import type { AnimationEvidence, AnimationEvidenceRecord, ChurnReport, ChurnRegionRecord, UnstableRegion } from './types.js';

export const DEFAULT_SETTLE_TIMEOUT_MS = 5000;
export const DEFAULT_QUIET_THRESHOLD_MS = 300;
export const DEFAULT_POLL_INTERVAL_MS = 100;

// ============================================================================
// pollForSettle — pure, CDP-decoupled
// ============================================================================

export interface SettleSample<T> {
  readonly signature: T;
  readonly quietMs: number;
}

export interface SettleOptions<T> {
  readonly captureSample: () => Promise<SettleSample<T>>;
  readonly isEqual: (a: T, b: T) => boolean;
  readonly settleTimeoutMs: number;
  readonly quietThresholdMs?: number;
  readonly pollIntervalMs?: number;
  /** Injected for tests; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Injected for tests; defaults to a real `setTimeout`-based sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface SettleResult<T> {
  readonly settled: boolean;
  readonly elapsedMs: number;
  readonly sampleCount: number;
  readonly lastSample: SettleSample<T> | null;
}

/**
 * Polls `captureSample` until two consecutive samples compare equal (via
 * `isEqual`) AND the newer sample reports at least `quietThresholdMs` of
 * quiet time, or until `settleTimeoutMs` elapses (per the injected `now`).
 * Always takes at least one sample before it can time out.
 *
 * Deadline semantics: a sample that is matching+quiet is only accepted as
 * `settled: true` if the elapsed time AT that sample is `<= settleTimeoutMs`.
 * A matching+quiet sample that arrives strictly after the deadline returns
 * `settled: false` instead — the settled predicate is checked against the
 * deadline before being trusted, not just tested for the next-loop timeout.
 * The inter-sample sleep is capped to the remaining time to the deadline so
 * the loop can't overshoot it before taking its next (possibly final) sample.
 */
export async function pollForSettle<T>(opts: SettleOptions<T>): Promise<SettleResult<T>> {
  const quietThresholdMs = opts.quietThresholdMs ?? DEFAULT_QUIET_THRESHOLD_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const start = now();
  let sampleCount = 0;
  let previous: SettleSample<T> | null = null;

  for (;;) {
    const sample = await opts.captureSample();
    sampleCount += 1;
    const elapsed = now() - start;

    if (previous !== null && opts.isEqual(previous.signature, sample.signature) && sample.quietMs >= quietThresholdMs) {
      if (elapsed <= opts.settleTimeoutMs) {
        return { settled: true, elapsedMs: elapsed, sampleCount, lastSample: sample };
      }
      return { settled: false, elapsedMs: elapsed, sampleCount, lastSample: sample };
    }

    previous = sample;
    if (elapsed >= opts.settleTimeoutMs) {
      return { settled: false, elapsedMs: elapsed, sampleCount, lastSample: sample };
    }
    const remainingMs = opts.settleTimeoutMs - elapsed;
    await sleep(Math.min(pollIntervalMs, remainingMs));
  }
}

// ============================================================================
// CDP-backed pieces
// ============================================================================

/** One raw DOM mutation observed while the churn observers were installed. */
export interface ChurnMutationRecord {
  readonly t: number;
  readonly type: string;
  readonly selector: string | null;
  /** Stable CDP identity of the mutation target, when the held target object could be described. */
  readonly backendNodeId?: number;
}

/** Fixed, factual reasons {@link collectChurnEvidence} could not read a well-formed teardown payload back (never a raw exception message). Present only when {@link ChurnEvidenceRaw.teardownUnavailable} is `true`. */
export type ChurnTeardownUnavailableReason = 'malformed-value';

/** Fixed, factual reason {@link BOOTSTRAP_SCRIPT}'s `new ResizeObserver(...)`/`.observe()` setup itself failed (never a raw exception message). Present only when {@link ChurnEvidenceRaw.resizeObserverUnavailable} is `true`. */
export type ChurnResizeObserverUnavailableReason = 'setup-threw';

/** Raw teardown payload from `collectChurnEvidence` — not yet grouped into regions. */
export interface ChurnEvidenceRaw {
  /** Kept mutation records — bounded by the bootstrap script's 200-record cap. Empty/zero WITHOUT {@link teardownUnavailable} set means a genuinely quiet page; empty/zero WITH it set means the teardown read itself was malformed (I-5) — never treat the two as the same fact. */
  readonly mutations: readonly ChurnMutationRecord[];
  readonly resizeCount: number;
  /** Total mutation records the observer counted before the 200-record cap dropped any — always `>= mutations.length` on a genuinely well-formed read. Optional so a hand-built `ChurnEvidenceRaw` test fixture that doesn't care about truncation can omit it — {@link groupChurnEvidence} marks that omission explicitly (`mutationsTruncationUnknown`) rather than silently assuming nothing was dropped (I-5). */
  readonly mutationsObserved?: number;
  /** `true` when the teardown `Runtime.callFunctionOn` round-tripped but handed back a malformed value (missing/wrong-typed `mutations`/`resizeCount` — {@link TEARDOWN_SCRIPT} always returns both together, so this means the read itself is corrupt, not that the page was quiet). `mutations`/`resizeCount` above are then the empty/zero DEFAULT, never a genuine observation. A CDP-level throw is NOT this case — it propagates as a real exception out of `collectChurnEvidence` instead (already honest). */
  readonly teardownUnavailable?: boolean;
  /** Present only when `teardownUnavailable` is `true`. */
  readonly teardownUnavailableReason?: ChurnTeardownUnavailableReason;
  /** `true` when {@link BOOTSTRAP_SCRIPT}'s `new ResizeObserver(...)`/`.observe()` setup itself threw — `resizeCount` above is then the empty DEFAULT (the observer was never installed to count anything), never a genuine observation of zero resizes (I-5, the installation-time counterpart to {@link teardownUnavailable}'s teardown-read defect). A well-formed teardown read that genuinely saw zero resizes from a successfully-installed observer leaves this `undefined`. */
  readonly resizeObserverUnavailable?: boolean;
  /** Present only when `resizeObserverUnavailable` is `true`. */
  readonly resizeObserverUnavailableReason?: ChurnResizeObserverUnavailableReason;
}

async function evaluate<T>(client: CDPClient, expression: string): Promise<T> {
  const response = (await client.send('Runtime.evaluate', { expression, returnByValue: true })) as {
    result?: { value?: T };
  };
  return response.result?.value as T;
}

/**
 * Evaluates `expression` HELD (`returnByValue: false`) and returns the
 * resulting live object's own `objectId` — the cross-call handle that
 * replaces a page-observable global. Throws if CDP doesn't hand back an
 * `objectId` (the bootstrap script always returns an object literal, so a
 * missing `objectId` means something is genuinely wrong, not a case to
 * silently degrade from). Also throws if the evaluated expression itself
 * threw: Chrome still hands back a `result.objectId` in that case (a
 * remote Error object), so an `exceptionDetails`-blind read would
 * silently accept the Error object's handle as if it were the real
 * bootstrap state — the setup failure would then only surface later,
 * confusingly, when something tries to use that handle.
 */
async function evaluateHeld(client: CDPClient, expression: string): Promise<string> {
  const response = (await client.send('Runtime.evaluate', { expression, returnByValue: false })) as {
    result?: { objectId?: string };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  };
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text;
    throw new Error(`injectChurnObservers: BOOTSTRAP_SCRIPT threw during setup: ${detail}`);
  }
  const objectId = response.result?.objectId;
  if (!objectId) {
    throw new Error('injectChurnObservers: BOOTSTRAP_SCRIPT did not return a held object');
  }
  return objectId;
}

/** Calls `functionDeclaration` (a function expression) on a held `objectId` with `this` bound to it, and reads the result back by value. */
async function callOnHeld<T>(client: CDPClient, objectId: string, functionDeclaration: string): Promise<T> {
  const response = (await client.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration,
    returnByValue: true,
  })) as { result?: { value?: T } };
  return response.result?.value as T;
}

/** Resolves the mutation targets retained in the held observer state to CDP identities without exposing a page-observable marker. */
async function mutationTargetBackendNodeIds(client: CDPClient, stateObjectId: string, count: number): Promise<Array<number | undefined>> {
  const identities = new Array<number | undefined>(count);
  const childObjectIds = new Set<string>();
  let targetsObjectId: string | undefined;
  try {
    const targets = (await client.send('Runtime.callFunctionOn', {
      objectId: stateObjectId,
      functionDeclaration: 'function() { return this.mutations.map(function(mutation) { return mutation.target; }); }',
      returnByValue: false,
    })) as { result?: { objectId?: string } };
    targetsObjectId = targets.result?.objectId;
    if (!targetsObjectId) return identities;
    type RemoteObject = { objectId?: string };
    type PropertyDescriptor = { name?: string; value?: RemoteObject; get?: RemoteObject; set?: RemoteObject; symbol?: RemoteObject };
    const properties = (await client.send('Runtime.getProperties', { objectId: targetsObjectId, ownProperties: true })) as {
      result?: PropertyDescriptor[];
      internalProperties?: PropertyDescriptor[];
      privateProperties?: PropertyDescriptor[];
    };
    for (const descriptor of [...(properties.result ?? []), ...(properties.internalProperties ?? []), ...(properties.privateProperties ?? [])]) {
      for (const object of [descriptor.value, descriptor.get, descriptor.set, descriptor.symbol]) {
        if (object?.objectId) childObjectIds.add(object.objectId);
      }
    }
    const indexesByObjectId = new Map<string, number[]>();
    for (const descriptor of properties.result ?? []) {
      const objectId = descriptor.value?.objectId;
      const index = typeof descriptor.name === 'string' && /^\d+$/u.test(descriptor.name) ? Number(descriptor.name) : undefined;
      if (index === undefined || index >= count || !objectId) continue;
      const indexes = indexesByObjectId.get(objectId) ?? [];
      indexes.push(index);
      indexesByObjectId.set(objectId, indexes);
    }
    for (const [objectId, indexes] of indexesByObjectId) {
      try {
        const described = (await client.send('DOM.describeNode', { objectId })) as { node?: { backendNodeId?: unknown } };
        if (typeof described.node?.backendNodeId === 'number') {
          for (const index of indexes) identities[index] = described.node.backendNodeId;
        }
      } catch {
        // One node's identity read failing leaves only that node selector-only;
        // the remaining targets still resolve rather than the whole batch aborting.
      }
    }
  } catch {
    // Identity enrichment is optional: a failed CDP bridge leaves this legacy
    // record unjoined rather than assigning a caveat through its selector.
  } finally {
    for (const objectId of childObjectIds) {
      try {
        await client.send('Runtime.releaseObject', { objectId });
      } catch {
        // CDP-session-scoped bridge cleanup only.
      }
    }
    if (targetsObjectId) {
      try {
        await client.send('Runtime.releaseObject', { objectId: targetsObjectId });
      } catch {
        // CDP-session-scoped bridge cleanup only.
      }
    }
  }
  return identities;
}

const BOOTSTRAP_SCRIPT = `/* __captureSettleBootstrap */
(function() {
  var state = { lastMutationTs: performance.now(), mutations: [], mutationsObserved: 0, resizeCount: 0 };
  function describeTarget(node) {
    try {
      if (!node || node.nodeType !== 1) return null;
      var tag = node.tagName ? node.tagName.toLowerCase() : null;
      var id = node.id ? ('#' + node.id) : '';
      var cls = (node.className && typeof node.className === 'string')
        ? ('.' + node.className.trim().split(/\\s+/).join('.'))
        : '';
      return tag ? (tag + id + cls) : null;
    } catch (e) { return null; }
  }
  // I-5 sweep (mirrors the ResizeObserver setup below): unlike
  // ResizeObserver, MutationObserver construction/observe() here is NOT
  // wrapped in a swallowing try/catch -- a genuine setup failure throws
  // straight out of this whole IIFE. Chrome then reports the evaluate as
  // a thrown expression: it hands back an Error remote object (which DOES
  // have its own result.objectId) plus a top-level exceptionDetails.
  // evaluateHeld() checks exceptionDetails BEFORE trusting objectId, so it
  // rejects the Error object's handle and throws its own honest
  // BOOTSTRAP_SCRIPT-threw-during-setup exception right here at injection,
  // instead of accepting the Error object as if it were real state.
  // That is the honest outcome (a real visible failure, not a coerced
  // zero) -- no unavailable marker is needed here.
  var mo = new MutationObserver(function(records) {
    state.lastMutationTs = performance.now();
    for (var i = 0; i < records.length; i++) {
      state.mutationsObserved += 1;
      if (state.mutations.length >= 200) continue;
      var r = records[i];
      state.mutations.push({ t: state.lastMutationTs, type: r.type, selector: describeTarget(r.target), target: r.target });
    }
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  state.mo = mo;
  try {
    var ro = new ResizeObserver(function() {
      state.resizeCount += 1;
      state.lastMutationTs = performance.now();
    });
    ro.observe(document.documentElement);
    state.ro = ro;
  } catch (e) {
    // I-5: ResizeObserver construction/observe() itself threw -- report
    // that honestly via resizeObserverUnavailable rather than silently
    // leaving state.ro undefined and resizeCount stuck at 0, which would
    // be indistinguishable from a genuinely-installed observer that saw
    // zero resizes.
    state.resizeObserverUnavailable = true;
  }
  return state;
})();`;

const SAMPLE_SCRIPT = `/* __captureSettleSample */ function() {
  var state = this;
  var now = performance.now();
  var quietMs = now - state.lastMutationTs;
  var infiniteRunning = false;
  var animationReadFailed = false;
  try {
    var anims = document.getAnimations({ subtree: true });
    for (var i = 0; i < anims.length; i++) {
      var a = anims[i];
      if (a.playState !== 'running') continue;
      var timing = (a.effect && a.effect.getComputedTiming) ? a.effect.getComputedTiming() : null;
      if (timing && timing.iterations === Infinity) { infiniteRunning = true; break; }
    }
  } catch (e) {
    // I-5: document.getAnimations() (or reading one's computed timing)
    // itself threw -- report that honestly via animationReadFailed rather
    // than silently leaving infiniteRunning false, which would make a
    // FAILED read indistinguishable from a page that genuinely has no
    // infinite animation running (the caller forces quietMs to 0 whenever
    // this is true, exactly like a CONFIRMED infinite running animation).
    animationReadFailed = true;
  }
  if (infiniteRunning) quietMs = 0;
  var mutationCount = state.mutations.length;
  var resizeCount = state.resizeCount;
  var signature = document.documentElement.outerHTML.length + ':' + document.querySelectorAll('*').length + ':' + mutationCount + ':' + resizeCount;
  return { signature: signature, quietMs: quietMs, animationReadFailed: animationReadFailed };
}`;

const TEARDOWN_SCRIPT = `/* __captureSettleTeardown */ function() {
  var state = this;
  try { state.mo.disconnect(); } catch (e) {}
  try { if (state.ro) state.ro.disconnect(); } catch (e) {}
  // Project each record to its serializable fields only. The live node kept in
  // state.mutations[i].target stays on the held object for identity resolution;
  // it must not ride the returnByValue read, where a DOM node serializes to a
  // junk {} on every record.
  var mutations = state.mutations.map(function(m) { return { t: m.t, type: m.type, selector: m.selector }; });
  return { mutations: mutations, resizeCount: state.resizeCount, mutationsObserved: state.mutationsObserved, resizeObserverUnavailable: state.resizeObserverUnavailable === true };
}`;

/**
 * Pauses every animation and, in the SAME evaluate, captures each one's
 * pre-pause `playState` alongside a live reference to it — returned HELD
 * (never assigned to `window`) so {@link restoreAnimationsAfterCapture} can
 * later call `.play()` back on the EXACT SAME Animation objects, not ones
 * re-resolved by a second `getAnimations()` enumeration (which could add/
 * drop/reorder entries between the two calls — the same reordering risk
 * `animation.ts`'s D3 identity doc documents for its own bridge). This is
 * I-6's origin capture: it must happen in the SAME script as the mutation,
 * before any other code can observe the page, or a page-visible pause
 * could happen with no matching origin fact to restore from.
 */
// Exported for a test-only reason (#72, mirrors RESTORE_ANIMATIONS_SCRIPT's
// own export below): a stub-driven `Runtime.evaluate` response can only
// fake the OUTCOME of this script, never exercise its own per-`.pause()`
// catch logic. This export lets a test drive the ACTUAL script body
// (via `new Function`, against a faked global `document`) proving the
// script itself -- not just the wrapper that reads its return value --
// turns a real `.pause()` failure into an honest per-animation
// `paused[i]=false` + `pauseFailureCount` tally, without flipping the
// walk-level `ok` (which correctly stays `true`: the walk itself didn't
// throw).
export const FREEZE_ANIMATIONS_SCRIPT = `/* __captureFreezeAnimations */
(function() {
  var anims = [];
  var origin = [];
  var paused = [];
  var pauseFailureCount = 0;
  var ok = true;
  try {
    var all = document.getAnimations({ subtree: true });
    for (var i = 0; i < all.length; i++) {
      anims.push(all[i]);
      origin.push(all[i].playState);
      try {
        all[i].pause();
        paused.push(true);
      } catch (e) {
        // I-4/I-6 (#72): a single animation's own .pause() call failing
        // must NOT be swallowed into a benign "everything froze" outcome --
        // track it per-animation (paused[i]=false, pauseFailureCount++) so
        // the caller can tell "this specific animation was never actually
        // paused" apart from a clean freeze. The surrounding walk's own
        // ok:true only ever meant document.getAnimations() didn't throw,
        // never that every individual pause succeeded -- that conflation
        // is exactly what let --freeze-animations read as fully successful
        // while one animation kept running.
        paused.push(false);
        pauseFailureCount += 1;
      }
    }
  } catch (e) {
    // I-5: document.getAnimations() itself threw -- report that honestly
    // via ok:false rather than a fabricated empty origin that looks
    // identical to "this page genuinely has nothing to freeze."
    ok = false;
  }
  return { anims: anims, origin: origin, paused: paused, pauseFailureCount: pauseFailureCount, ok: ok };
})();`;

/**
 * Function-on-held companion to {@link FREEZE_ANIMATIONS_SCRIPT}: reads
 * back the script's own `ok` flag from the held container BEFORE the
 * caller trusts the origin capture for anything. A held `objectId` alone
 * cannot distinguish "the walk succeeded and there really are zero
 * animations" from "the walk threw and `anims`/`origin` are an empty
 * fallback" — both round-trip the SAME valid-looking held object.
 */
const FREEZE_ORIGIN_OK_SCRIPT = `/* __captureFreezeOriginOk */ function() { return this.ok === true; }`;

/**
 * Function-on-held companion to {@link FREEZE_ANIMATIONS_SCRIPT}: reads
 * back the per-animation pause-failure tally the origin capture recorded
 * (#72). `FREEZE_ORIGIN_OK_SCRIPT`'s `ok:true` only proves the
 * `document.getAnimations()` WALK itself didn't throw -- it says nothing
 * about whether every individual `.pause()` call inside that walk
 * succeeded. Read separately, always AFTER `originCaptureOk` is confirmed
 * (so a genuinely-failed walk never reports a bogus pause tally), so a
 * page whose walk succeeds but whose pauses partially fail is still
 * distinguishable from a clean freeze rather than silently folded into
 * `ok`.
 */
const FREEZE_PAUSE_STATUS_SCRIPT = `/* __captureFreezePauseStatus */ function() {
  var total = this.anims ? this.anims.length : 0;
  var failures = typeof this.pauseFailureCount === 'number' ? this.pauseFailureCount : 0;
  return { total: total, pauseFailureCount: failures };
}`;

/**
 * Function-on-held companion to {@link FREEZE_ANIMATIONS_SCRIPT}: resumes
 * exactly the animations captured there whose pre-pause `playState` was
 * `'running'`, leaving any animation the page itself had already
 * paused/finished/idle untouched. Unlike the pre-I-6-fix version, a
 * per-animation `.play()` failure is NOT silently swallowed into an
 * overall `true` — it flips the returned `ok` false, so {@link
 * restoreAnimationsAfterCapture} can report an honest `restored:false`
 * instead of over-claiming success for a page that is still partially
 * frozen.
 */
// Exported for a test-only reason (r4 honesty-sweep review finding): a
// stub-driven `Runtime.callFunctionOn` response can only fake the OUTCOME
// of this script, never exercise its own per-`.play()` catch logic. This
// export lets a test drive the ACTUAL script body (via `new Function`)
// against a fake `this`, proving the script itself — not just the wrapper
// that gates on its return value — turns a real `.play()` failure into an
// honest `false`.
export const RESTORE_ANIMATIONS_SCRIPT = `/* __captureRestoreAnimations */ function() {
  var state = this;
  try {
    var ok = true;
    for (var i = 0; i < state.anims.length; i++) {
      if (state.origin[i] !== 'running') continue;
      // #72: an animation whose own .pause() call failed at freeze time
      // (state.paused[i] === false) was never actually stopped -- it is
      // still running right now, so calling .play() on it is not a
      // restoration of anything this collector did; it would just report
      // a trivial no-op success and let the freeze's per-animation failure
      // masquerade as a clean restore. Guarded for state.paused possibly
      // being absent (older held container shape) so this stays backward
      // compatible with any pre-#72 fixture.
      if (state.paused && state.paused[i] === false) continue;
      try {
        state.anims[i].play();
      } catch (e) {
        ok = false;
      }
    }
    return ok;
  } catch (e) {
    return false;
  }
}`;

const ANIMATION_INVENTORY_SCRIPT = `/* __captureAnimationInventory */
(function() {
  function describeTarget(node) {
    try {
      if (!node || node.nodeType !== 1) return null;
      var tag = node.tagName ? node.tagName.toLowerCase() : null;
      var cls = (node.className && typeof node.className === 'string')
        ? ('.' + node.className.trim().split(/\\s+/).join('.'))
        : '';
      return tag ? (tag + cls) : null;
    } catch (e) { return null; }
  }
  var out = [];
  try {
    var anims = document.getAnimations({ subtree: true });
    for (var i = 0; i < anims.length; i++) {
      var a = anims[i];
      var timing = (a.effect && a.effect.getComputedTiming) ? a.effect.getComputedTiming() : null;
      var iterations = timing ? timing.iterations : null;
      var infinite = iterations === Infinity;
      out.push({
        selector: (a.effect && a.effect.target) ? describeTarget(a.effect.target) : null,
        animationName: a.animationName || a.id || null,
        durationMs: timing ? timing.duration : null,
        iterationCount: infinite ? 'infinite' : (typeof iterations === 'number' ? iterations : null),
        infinite: infinite,
        playState: a.playState,
      });
    }
  } catch (e) {
    // I-5: document.getAnimations() (or reading an animation's computed
    // timing) itself threw -- report that honestly via ok:false rather
    // than falling through to an empty-but-"successful"-looking array
    // ({@link collectAnimationEvidence} turns this into available:false).
    return { animations: [], ok: false };
  }
  return { animations: out, ok: true };
})();`;

/**
 * The cross-call handle returned by {@link injectChurnObservers} — wraps
 * the held CDP `objectId` of the churn-observer state object. It replaces
 * the old `window.__captureSettle` global: nothing is ever page-observable,
 * so a page-defined setter for that name has nothing to fire against. The
 * caller must thread it through {@link buildDomSettleSampler} and
 * {@link collectChurnEvidence} — the latter owns releasing it.
 */
export interface ChurnObserverHandle {
  readonly stateObjectId: string;
}

/** Installs the MutationObserver/ResizeObserver churn state and returns a held handle to it. Call exactly once per snapshot; the returned handle must be released via {@link collectChurnEvidence}. */
export async function injectChurnObservers(client: CDPClient): Promise<ChurnObserverHandle> {
  const stateObjectId = await evaluateHeld(client, BOOTSTRAP_SCRIPT);
  return { stateObjectId };
}

/**
 * `buildDomSettleSampler`'s actual sample shape — `SettleSample<string>`
 * plus the I-5 animation-read-availability fact {@link SAMPLE_SCRIPT}'s
 * own catch branch now reports explicitly.
 */
export interface DomSettleSample extends SettleSample<string> {
  /** `true` when the per-sample `document.getAnimations()` read (inside {@link SAMPLE_SCRIPT}) itself threw. A failed read must never look "quiet": `quietMs` above is forced to `0` whenever this is `true` — exactly the same fail-safe treatment `SAMPLE_SCRIPT` already gives a CONFIRMED running-infinite animation — and this fact rides along on the sample so a consumer can still tell a real failed read apart from a genuinely quiet page. */
  readonly animationReadUnavailable: boolean;
}

/** Builds a `pollForSettle`-compatible sampler backed by the injected churn observers, read back through the held handle. */
export function buildDomSettleSampler(client: CDPClient, handle: ChurnObserverHandle): () => Promise<DomSettleSample> {
  return async () => {
    const value = await callOnHeld<{ signature: string; quietMs: number; animationReadFailed?: boolean }>(client, handle.stateObjectId, SAMPLE_SCRIPT);
    const animationReadUnavailable = value.animationReadFailed === true;
    return {
      signature: value.signature,
      quietMs: animationReadUnavailable ? 0 : value.quietMs,
      animationReadUnavailable,
    };
  };
}

export function domSignaturesEqual(a: string, b: string): boolean {
  return a === b;
}

/**
 * Tears down the churn observers, returns everything they recorded, and
 * releases the held handle — the ONLY place `handle.stateObjectId` is
 * released. ALWAYS call this after the settle poll finishes (settled or
 * not) — it is cleanup, not conditional evidence-gathering. The release is
 * attempted even if reading the teardown result throws, and a release
 * failure can never leak page-observable state: the handle is only ever
 * CDP-session-scoped remote-object memory, freed at the latest when the
 * tab closes.
 */
export async function collectChurnEvidence(client: CDPClient, handle: ChurnObserverHandle): Promise<ChurnEvidenceRaw> {
  try {
    const value = await callOnHeld<{
      mutations?: unknown;
      resizeCount?: unknown;
      mutationsObserved?: unknown;
      resizeObserverUnavailable?: unknown;
    }>(client, handle.stateObjectId, TEARDOWN_SCRIPT);
    // I-5: a fully-missing `value` (the callFunctionOn round trip returned
    // no usable result at all) already throws honestly right here —
    // `value.mutations` below rejects on `undefined` before any `??` could
    // ever mask it. The case this guards is different: `value` IS a real
    // object (TEARDOWN_SCRIPT ran) but its shape is wrong — which `??`
    // alone silently turned into an empty/zero "successful" churn read.
    const mutationsValid = Array.isArray(value.mutations);
    const resizeCountValid = typeof value.resizeCount === 'number';
    if (!mutationsValid || !resizeCountValid) {
      return { mutations: [], resizeCount: 0, teardownUnavailable: true, teardownUnavailableReason: 'malformed-value' };
    }
    // I-5: `resizeObserverUnavailable` is a DIFFERENT fact from
    // `teardownUnavailable` above — the teardown read itself is well-formed
    // here, but it is faithfully reporting that BOOTSTRAP_SCRIPT's own
    // ResizeObserver setup failed at installation time, so `resizeCount`
    // is the empty DEFAULT rather than a genuine zero-resize observation.
    // Never conflate the two: a malformed teardown read never sets this,
    // and a resize-observer setup failure never sets `teardownUnavailable`.
    const mutations = value.mutations as ChurnMutationRecord[];
    const targetBackendNodeIds = await mutationTargetBackendNodeIds(client, handle.stateObjectId, mutations.length);
    return {
      mutations: mutations.map((mutation, index) => ({
        ...mutation,
        ...(targetBackendNodeIds[index] === undefined ? {} : { backendNodeId: targetBackendNodeIds[index] }),
      })),
      resizeCount: value.resizeCount as number,
      mutationsObserved: typeof value.mutationsObserved === 'number' ? value.mutationsObserved : undefined,
      ...(value.resizeObserverUnavailable === true
        ? { resizeObserverUnavailable: true, resizeObserverUnavailableReason: 'setup-threw' as const }
        : {}),
    };
  } finally {
    try {
      await client.send('Runtime.releaseObject', { objectId: handle.stateObjectId });
    } catch {
      // Best-effort — nothing page-observable to leak from a release failure.
    }
  }
}

/** Held handle to the origin capture {@link freezeAnimationsBeforeCapture} returns — the cross-call reference {@link restoreAnimationsAfterCapture} restores from and releases. */
export interface AnimationFreezeHandle {
  readonly containerObjectId: string;
  /** `false` when the browser-wide `Animation.setPlaybackRate({playbackRate:0})` override itself failed to apply (I-6) — the per-animation `.pause()` calls captured in the SAME evaluate as the origin capture are still the authoritative freeze for whatever animations existed AT freeze time, but any animation the page creates AFTER this point will NOT be frozen, and previously no fact ever recorded that. `true` only means Chrome accepted the override call, not that every future animation is guaranteed frozen. */
  readonly rateOverrideApplied: boolean;
  /** `true` when at least one animation's own `.pause()` call inside {@link FREEZE_ANIMATIONS_SCRIPT} threw (#72) — that animation is still running right now, so the freeze is only PARTIAL even though the surrounding walk itself (and `rateOverrideApplied`) can both be genuinely successful. `false` means every animation the walk enumerated was confirmed paused, or a read-back failure of the tally itself was treated pessimistically as incomplete (never silently assumed clean). The caller must not report `--freeze-animations` as fully successful when this is `true`. */
  readonly freezeIncomplete: boolean;
  /** Count of animations whose `.pause()` call failed (#72) — `0` when every enumerated animation was confirmed paused (matching `freezeIncomplete:false`), OR when the tally itself could not be read back (matching `freezeIncomplete:true` — the count is then genuinely UNKNOWN, not confirmed zero; `freezeIncomplete` is the operative gate for that case, not this count). Present alongside `freezeIncomplete` so a caller can report how many animations were never frozen when that number IS known. */
  readonly unfrozenCount: number;
}

/**
 * Best-effort-pauses every running animation so a page that would
 * otherwise never settle (because of an infinite CSS/WAAPI animation) can,
 * capturing each animation's pre-pause `playState` (I-6's required origin
 * capture) in the SAME evaluate as the pause — see {@link
 * FREEZE_ANIMATIONS_SCRIPT}. Call BEFORE {@link injectChurnObservers} so
 * freeze-induced style settling isn't itself recorded as churn.
 *
 * I-6 ordering (fixed): the restorable origin handle is acquired FIRST,
 * via {@link FREEZE_ANIMATIONS_SCRIPT}'s own evaluate — BEFORE the
 * browser-wide `Animation.setPlaybackRate(0)` override is ever applied.
 * Previously the override ran first; if the subsequent evaluate then
 * failed or returned no held object, the page was left with the override
 * applied and NO handle to ever reset it from (restoreAnimationsAfterCapture
 * is only ever reachable through a defined handle) — a silently-permanent
 * freeze. Now, a failure acquiring the origin handle returns `undefined`
 * WITHOUT ever touching `Animation.setPlaybackRate`, so a failed freeze
 * attempt never mutates the page at all.
 *
 * Returns the held handle {@link restoreAnimationsAfterCapture} needs, or
 * `undefined` when the evaluate didn't hand back a held object (nothing
 * was mutated — there is simply no origin reference to restore from). The
 * caller must treat an `undefined` handle as "restoration cannot be
 * guaranteed" and surface `animationsRestored: false` — never silently
 * treat the forced state as already clean.
 *
 * #72: a DEFINED handle is not, by itself, proof every animation actually
 * froze — `handle.freezeIncomplete`/`handle.unfrozenCount` (read back via
 * {@link FREEZE_PAUSE_STATUS_SCRIPT}) report whether one or more
 * individual `.pause()` calls inside the SAME origin-capture evaluate
 * failed. A caller surfacing `--freeze-animations` success must check
 * these alongside `rateOverrideApplied` — a defined handle with a
 * successfully-applied override can still be a PARTIAL freeze.
 */
export async function freezeAnimationsBeforeCapture(client: CDPClient): Promise<AnimationFreezeHandle | undefined> {
  let containerObjectId: string | undefined;
  try {
    const response = (await client.send('Runtime.evaluate', {
      expression: FREEZE_ANIMATIONS_SCRIPT,
      returnByValue: false,
    })) as { result?: { objectId?: string } };
    containerObjectId = response.result?.objectId;
  } catch {
    // The pause/origin-capture script itself failed to evaluate — nothing
    // was held AND nothing was mutated (the browser-wide override below
    // never runs), so there is no origin to restore from and nothing to
    // undo either.
    return undefined;
  }
  if (!containerObjectId) {
    // The evaluate round-tripped but handed back no held object — same
    // "nothing to restore from" outcome as above, and for the same reason
    // the browser-wide override must NOT be applied here either.
    return undefined;
  }

  // I-5: FREEZE_ANIMATIONS_SCRIPT's own document.getAnimations() walk can
  // throw INSIDE its try/catch and still hand back a valid-looking held
  // object ({anims:[], origin:[], ok:false}) — a held objectId alone
  // cannot tell that apart from a page that genuinely has zero animations
  // to freeze. Read the script's own `ok` flag back before trusting the
  // origin capture, or (per the ordering rule this function documents)
  // ever touching the browser-wide override below.
  let originCaptureOk = false;
  try {
    originCaptureOk = (await callOnHeld<boolean>(client, containerObjectId, FREEZE_ORIGIN_OK_SCRIPT)) === true;
  } catch {
    originCaptureOk = false;
  }
  if (!originCaptureOk) {
    // Nothing trustworthy to restore from — release the now-useless held
    // object and report "no origin handle," exactly like the two failure
    // paths above, WITHOUT ever applying the browser-wide override.
    try {
      await client.send('Runtime.releaseObject', { objectId: containerObjectId });
    } catch {
      // Best-effort — CDP-session-scoped remote-object memory only.
    }
    return undefined;
  }

  let rateOverrideApplied = true;
  try {
    await client.send('Animation.setPlaybackRate', { playbackRate: 0 });
  } catch {
    // I-6: the browser-wide override itself failed to apply — record that
    // fact explicitly (some Chrome/target combos may reject it) rather
    // than swallowing it as merely best-effort. The per-animation pauses
    // captured in the SAME evaluate above are still the authoritative
    // freeze for whatever existed at freeze time.
    rateOverrideApplied = false;
  }

  // #72: read back the per-animation pause-failure tally FREEZE_ANIMATIONS_SCRIPT
  // recorded — originCaptureOk above only proves the enumeration walk didn't
  // throw, never that every individual .pause() call inside it succeeded. A
  // failed read-back of the tally itself is treated pessimistically as
  // incomplete (never silently assumed clean), same posture as every other
  // I-5/I-6 read in this module.
  let freezeIncomplete = false;
  let unfrozenCount = 0;
  try {
    const pauseStatus = await callOnHeld<{ total?: number; pauseFailureCount?: number }>(
      client,
      containerObjectId,
      FREEZE_PAUSE_STATUS_SCRIPT,
    );
    unfrozenCount = typeof pauseStatus?.pauseFailureCount === 'number' ? pauseStatus.pauseFailureCount : 0;
    freezeIncomplete = unfrozenCount > 0;
  } catch {
    freezeIncomplete = true;
  }

  return { containerObjectId, rateOverrideApplied, freezeIncomplete, unfrozenCount };
}

/**
 * Restores every animation {@link freezeAnimationsBeforeCapture} paused
 * back to its captured pre-pause `playState`, and releases the held
 * handle — the ONLY place `handle.containerObjectId` is released. Never
 * throws: any failure (the per-animation restore call, an individual
 * `.play()` inside it, or the browser-wide playback-rate reset) is caught
 * and reported as `restored: false` rather than left to abort the
 * caller's snapshot flow. This is the ONLY sanctioned way to undo {@link
 * freezeAnimationsBeforeCapture} — callers must call it exactly once per
 * handle, exception-safely (e.g. from a `finally`), so a
 * forced-but-uncaptured page is never left frozen past this snapshot.
 *
 * I-6 honesty (fixed): `restored` is `true` ONLY when EVERY restorative
 * step actually succeeded — the per-animation `.play()` calls (via {@link
 * RESTORE_ANIMATIONS_SCRIPT}'s now-honest `ok` return) AND the
 * browser-wide `Animation.setPlaybackRate(1)` reset. Previously a per-
 * animation `.play()` failure was swallowed inside the page script (always
 * returning `true`) and a reset failure was caught but never reflected in
 * the result — both let `{restored:true}` reach the caller (and
 * `meta.json`) while the page was still partially or fully forced. A held-
 * object release failure is NOT page-observable (CDP-session-scoped memory
 * only) so it does not gate `restored`.
 */
export async function restoreAnimationsAfterCapture(
  client: CDPClient,
  handle: AnimationFreezeHandle,
): Promise<{ restored: boolean }> {
  let playRestored = false;
  try {
    playRestored = (await callOnHeld<boolean>(client, handle.containerObjectId, RESTORE_ANIMATIONS_SCRIPT)) === true;
  } catch {
    playRestored = false;
  } finally {
    try {
      await client.send('Runtime.releaseObject', { objectId: handle.containerObjectId });
    } catch {
      // Best-effort cleanup only — CDP-session-scoped remote-object memory,
      // never page-observable state, so a release failure never gates
      // `restored` below.
    }
  }
  let rateReset = false;
  try {
    await client.send('Animation.setPlaybackRate', { playbackRate: 1 });
    rateReset = true;
  } catch {
    // The browser-wide override reset itself failed — every animation may
    // still be forced to playbackRate 0, a real page-observable
    // consequence, so this MUST gate `restored` honestly rather than being
    // swallowed as merely best-effort (I-6).
    rateReset = false;
  }
  return { restored: playRestored && rateReset };
}

/** Fixed, factual reasons {@link collectAnimationEvidence} could not determine the page's animations (never a raw exception message, which is unbounded/page-influenced). Present only when {@link AnimationEvidenceResult.available} is `false`. */
export type AnimationEvidenceUnavailableReason = 'evaluate-failed' | 'get-animations-threw';

/**
 * {@link collectAnimationEvidence}'s actual return shape — `AnimationEvidence`
 * (the wire/artifact type from `types.ts`) plus the I-5 availability pair.
 * Declared here rather than added to `types.ts` (outside this remediation's
 * owned file set): structurally compatible everywhere a plain
 * `AnimationEvidence` is expected (e.g. {@link groupChurnEvidence}'s
 * parameter, or the raw `writeJsonPrivate` call in `snapshot.ts` that
 * serializes this verbatim into `animation.json` on the evidence-only
 * branch), so the extra fields flow straight into the artifact too.
 */
export interface AnimationEvidenceResult extends AnimationEvidence {
  /** `false` when `document.getAnimations()` itself threw, or the CDP evaluate round trip failed/returned no usable value — an empty `animations` array is then "could not enumerate", not "genuinely no animations" (I-5). Always `true` on a normal run, including one where the page really has zero animations. */
  readonly available: boolean;
  /** Present only when `available` is `false`. */
  readonly unavailableReason?: AnimationEvidenceUnavailableReason;
}

/**
 * Inventories `document.getAnimations()` — used both for `animation.json`
 * evidence and churn-region grouping. Distinguishes "the walk threw / the
 * evaluate round trip failed" (`available:false` + reason, `animations:
 * []` unavoidably empty because there was nothing to report) from "the walk
 * succeeded and the page genuinely has zero animations" (`available:true`,
 * `animations: []`) — both previously collapsed to the same empty array
 * (I-5).
 */
export async function collectAnimationEvidence(client: CDPClient): Promise<AnimationEvidenceResult> {
  let records: AnimationEvidenceRecord[] = [];
  let available = true;
  let unavailableReason: AnimationEvidenceUnavailableReason | undefined;
  try {
    const value = await evaluate<{ animations?: AnimationEvidenceRecord[]; ok?: boolean } | undefined>(client, ANIMATION_INVENTORY_SCRIPT);
    if (value && value.ok === true && Array.isArray(value.animations)) {
      records = value.animations;
    } else {
      // The evaluate round-tripped but either returned no usable value, or
      // the page-side `document.getAnimations()` walk itself threw (the
      // script's own catch branch signals `ok:false`) — both are "could not
      // determine the page's animations", never a genuinely-empty walk.
      available = false;
      unavailableReason = 'get-animations-threw';
    }
  } catch {
    // The CDP evaluate round trip itself failed (a transport/session-level
    // throw, before any script-level ok:false could ever be reported).
    available = false;
    unavailableReason = 'evaluate-failed';
  }
  // Route the page-controlled `selector`/`animationName` through the shared
  // sanitizer before either lands in animation.json (written raw by the
  // orchestrator) or in a churn region reason — a secret in an id/class or
  // an animation-name must not reach the evidence artifact.
  const animations = records.map((a) => ({
    ...a,
    selector: a.selector === null ? null : sanitizeString(a.selector),
    animationName: a.animationName === null ? null : sanitizeString(a.animationName),
  }));
  const infiniteCount = animations.filter((a) => a.infinite).length;
  return {
    animations,
    infiniteCount,
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
  };
}

// ============================================================================
// groupChurnEvidence — pure, no CDP
// ============================================================================

interface MutationBucket {
  readonly selector?: string;
  count: number;
  first?: number;
  last?: number;
}

/**
 * `groupChurnEvidence`'s actual `animationEvidence` parameter shape — a
 * bare {@link AnimationEvidence} (e.g. a hand-built test fixture that
 * doesn't care about availability) works exactly as before; the I-5
 * `available`/`unavailableReason` pair {@link collectAnimationEvidence}
 * actually returns (as {@link AnimationEvidenceResult}) is OPTIONAL here
 * but honored whenever present — see the `animationEvidenceUnavailable`
 * fact below (#10).
 */
type AnimationEvidenceInput = AnimationEvidence & Partial<Pick<AnimationEvidenceResult, 'available' | 'unavailableReason'>>;

/**
 * `groupChurnEvidence`'s actual `report` shape — `ChurnReport` (the
 * wire/artifact type from `types.ts`) plus the I-5 honesty markers this
 * remediation adds. Declared here rather than added to `types.ts`
 * (outside this remediation's owned file set), mirroring
 * {@link AnimationEvidenceResult}'s same rationale: structurally
 * compatible everywhere a plain `ChurnReport` is expected, and
 * `snapshot.ts` writes this object verbatim into `churn.json`, so the
 * extra fields flow straight into the artifact.
 */
export interface ChurnReportRecord extends ChurnReport {
  /** `true` when the churn-observer teardown read ({@link ChurnEvidenceRaw.teardownUnavailable}) was malformed — `totalMutations`/`resizeCount`/`regions` above are then the empty/zero DEFAULT from a failed read, not a genuine observation of a quiet page (#6). */
  readonly mutationsUnavailable?: boolean;
  /** Present only when `mutationsUnavailable` is `true`. */
  readonly mutationsUnavailableReason?: ChurnTeardownUnavailableReason;
  /** `true` when `raw.mutationsObserved` was never supplied — the 200-record cap's true drop count is unknown, so `mutationsTruncated` being absent must NOT be read as "confirmed nothing was dropped" (#9). */
  readonly mutationsTruncationUnknown?: boolean;
  /** `true` when the `animationEvidence` this report was grouped from itself had `available:false` — animation-based regions above can then only ever be "none found because the read failed," not "none found because nothing is running" (#10). */
  readonly animationEvidenceUnavailable?: boolean;
  /** Present only when `animationEvidenceUnavailable` is `true`. */
  readonly animationEvidenceUnavailableReason?: AnimationEvidenceUnavailableReason;
  /** `true` when `raw.resizeObserverUnavailable` was set — the ResizeObserver setup itself failed at installation time, so `resizeCount` above is the empty DEFAULT, never a genuine observation of zero resizes (I-5, mirrors `mutationsUnavailable`'s teardown-read counterpart, but on observer INSTALLATION instead). */
  readonly resizeObserverUnavailable?: boolean;
  /** Present only when `resizeObserverUnavailable` is `true`. */
  readonly resizeObserverUnavailableReason?: ChurnResizeObserverUnavailableReason;
}

/**
 * Groups raw mutation + animation evidence into `churn.json`'s `regions`
 * and the matching `UnstableRegion[]` (1:1 by id). Dual-sourced by design:
 * one region per distinct mutation `selector` (DOM-mutation-based), THEN
 * one region per `infinite && playState === 'running'` animation
 * (animation-based) — do not simplify this to only one source.
 */
export function groupChurnEvidence(
  raw: ChurnEvidenceRaw,
  animationEvidence: AnimationEvidenceInput,
  elapsedMs: number,
  settleTimeoutMs: number,
): { report: ChurnReportRecord; unstableRegions: UnstableRegion[] } {
  const buckets = new Map<string, MutationBucket & { backendNodeId?: number }>();
  for (const mutation of raw.mutations) {
    const backendNodeId = typeof mutation.backendNodeId === 'number' ? mutation.backendNodeId : undefined;
    const key = backendNodeId === undefined ? `selector:${mutation.selector ?? '(unknown)'}` : `backend:${backendNodeId}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { selector: mutation.selector === null ? undefined : sanitizeString(mutation.selector), count: 0, ...(backendNodeId === undefined ? {} : { backendNodeId }) };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.first = bucket.first === undefined ? mutation.t : Math.min(bucket.first, mutation.t);
    bucket.last = bucket.last === undefined ? mutation.t : Math.max(bucket.last, mutation.t);
  }

  const regions: ChurnRegionRecord[] = [];
  const unstableRegions: UnstableRegion[] = [];
  let regionIndex = 0;

  for (const bucket of buckets.values()) {
    regionIndex += 1;
    const id = `region-${regionIndex}`;
    const reason = `${bucket.count} DOM mutation${bucket.count === 1 ? '' : 's'} observed over ${elapsedMs}ms`;
    regions.push({
      id,
      ...(bucket.selector ? { selector: bucket.selector } : {}),
      reason,
      mutationCount: bucket.count,
      ...(bucket.first !== undefined ? { firstMutationAtMs: bucket.first } : {}),
      ...(bucket.last !== undefined ? { lastMutationAtMs: bucket.last } : {}),
    });
    unstableRegions.push({
      id,
      ...(bucket.selector ? { selector: bucket.selector } : {}),
      ...(bucket.backendNodeId === undefined ? {} : { elementIds: [String(bucket.backendNodeId)] }),
      reason,
    });
  }

  for (const anim of animationEvidence.animations) {
    if (!anim.infinite || anim.playState !== 'running') continue;
    regionIndex += 1;
    const id = `region-${regionIndex}`;
    const name = anim.animationName ? sanitizeString(anim.animationName) : 'unnamed animation';
    const selector = anim.selector ? sanitizeString(anim.selector) : undefined;
    const durationPart = anim.durationMs !== null ? ` (duration ${anim.durationMs}ms)` : '';
    const reason = `infinite animation "${name}"${durationPart} still running`;
    regions.push({
      id,
      ...(selector ? { selector } : {}),
      reason,
      mutationCount: 0,
    });
    unstableRegions.push({
      id,
      ...(selector ? { selector } : {}),
      reason,
    });
  }

  // I-5 (#9): the churn observer's bootstrap script caps kept mutation
  // records at 200 but counts every one it actually saw
  // (`mutationsObserved`) — when that total exceeds what was kept,
  // `regions`/`totalMutations` are working from a capped set unless this
  // fact says so. `mutationsObserved` being ABSENT is a DIFFERENT fact
  // from "confirmed nothing was dropped": defaulting it to `raw.mutations
  // .length` would silently claim the latter every time it's merely
  // unknown, so it now stays honestly distinguishable via
  // `mutationsTruncationUnknown`.
  const mutationsObserved = raw.mutationsObserved;
  const mutationsTruncationUnknown = mutationsObserved === undefined;
  const mutationsTruncated =
    mutationsObserved !== undefined && mutationsObserved > raw.mutations.length ? mutationsObserved - raw.mutations.length : undefined;

  // #10: an `animationEvidence` read that itself failed must not read as
  // "grouped successfully, found no running infinite animations" —
  // `animationEvidence.animations` is already honestly empty on that
  // failure ({@link collectAnimationEvidence}), but that emptiness alone
  // is indistinguishable from a genuine zero-animation page once it only
  // feeds into the (also legitimately empty) animation-based regions above.
  const animationEvidenceUnavailable = animationEvidence.available === false;

  const report: ChurnReportRecord = {
    settled: false,
    settleTimeoutMs,
    elapsedMs,
    totalMutations: raw.mutations.length,
    resizeCount: raw.resizeCount,
    ...(mutationsTruncated !== undefined ? { mutationsTruncated } : {}),
    ...(mutationsTruncationUnknown ? { mutationsTruncationUnknown: true } : {}),
    ...(raw.teardownUnavailable
      ? { mutationsUnavailable: true, ...(raw.teardownUnavailableReason ? { mutationsUnavailableReason: raw.teardownUnavailableReason } : {}) }
      : {}),
    ...(raw.resizeObserverUnavailable
      ? {
          resizeObserverUnavailable: true,
          ...(raw.resizeObserverUnavailableReason ? { resizeObserverUnavailableReason: raw.resizeObserverUnavailableReason } : {}),
        }
      : {}),
    ...(animationEvidenceUnavailable
      ? {
          animationEvidenceUnavailable: true,
          ...(animationEvidence.unavailableReason ? { animationEvidenceUnavailableReason: animationEvidence.unavailableReason } : {}),
        }
      : {}),
    regions,
  };
  return { report, unstableRegions };
}
