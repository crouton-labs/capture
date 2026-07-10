/**
 * `animation.json` collector — the settled-capture animation inventory:
 * `document.getAnimations({subtree:true})` target, duration, iteration
 * count, run state, infinite-loop flag, frozen status, and (the
 * cross-artifact join key) each target's `backendNodeId`.
 *
 * Identity (D3): to attach `backendNodeId` to an animation's target this
 * collector runs its OWN inventory `Runtime.evaluate` that enumerates
 * `getAnimations()` AND, in that SAME script, collects each element
 * `a.effect.target` into a page-side array, recording the target's index
 * on the record as `targetIdx`. Resolving the targets in a SECOND
 * independent `getAnimations()` call would risk an enumeration-order
 * mismatch (a finished animation dropping out, or reordering between the
 * two calls), so enumeration and the identity collection MUST share one
 * evaluate. The walk never assigns anything to `window` or any other
 * page-observable location: its return value is a plain in-memory
 * `{ facts, elements }` object, read back purely through CDP's own
 * remote-object identity — the exact same CDP-only identity bridge
 * geometry.ts uses and exports (`ownPropertyObjectIds`/`readHeldValue`/
 * `resolveIndexedObjectIds`/`describeBackendNodeId`), reused here rather
 * than duplicated. A page can predefine a setter for any global name it can
 * guess; it can observe nothing here, because nothing is ever set on it.
 * Every held container/facts/elements `objectId` is released via
 * `Runtime.releaseObject` in `finally` (unconditionally) — a release
 * failure is recorded as the factual `bridgeCleanupFailed`, but can never
 * imply a contaminated baseline: there is no page-observable state left to
 * leak, only CDP-session-scoped remote-object memory freed when the tab
 * closes.
 *
 * The inventory script's `facts` array has the same bare record shape as
 * settle.ts's `collectAnimationEvidence` (`selector, animationName,
 * durationMs, iterationCount, infinite, playState`) plus the `targetIdx`
 * bridge index; this collector adds `id`, `frozen`, `backendNodeId`, and a
 * `coverage` scope fact on top. By the time this collector runs,
 * `snapshot.ts` has already applied `--freeze-animations` (if requested)
 * via settle.ts's CDP freeze helpers — this collector only reads the
 * resulting inventory, never freezes.
 *
 * `frozen` honesty (I-4): `--freeze-animations` pauses EVERY animation
 * that existed at freeze time via settle.ts's own, separate
 * `getAnimations()` walk, and CDP's `Animation.setPlaybackRate` override
 * is deliberately invisible to JS (confirmed: it never touches the
 * WAAPI-visible `Animation.playbackRate`). By the time THIS collector
 * re-enumerates independently, an animation the freeze forced from
 * `'running'` to `'paused'` is indistinguishable, by playState alone, from
 * one the page had already paused (or created already-paused) before or
 * without the freeze ever touching it — WAAPI exposes no pause-history.
 * `frozen` is therefore honestly scoped as "paused while freeze was
 * requested" (co-occurrence), never as proof this specific animation was
 * forced — see the field doc below. `report.freezeRequested` restates
 * `ctx.freezeAnimations` so a reader of `animation.json` alone (without
 * `meta.json`) can tell "freeze wasn't requested" apart from "freeze was
 * requested but nothing ended up paused".
 *
 * Scope (D5): `getAnimations({subtree:true})` covers the top document's own
 * shadow subtrees but NOT nested iframe documents (each has its own
 * `getAnimations`). `coverage.iframesNotWalked` counts the top-document
 * iframes whose animations are therefore absent — read as one
 * order-independent count (a bare `querySelectorAll('iframe').length`, no
 * enumeration coupling) — so downstream cannot read the omission as "no
 * animation".
 */

import type { Collector } from '../types.js';
import { ownPropertyObjectIds, readHeldValue, resolveIndexedObjectIds, describeBackendNodeId } from './geometry.js';
import { sanitizeString } from '../redaction.js';

export interface AnimationRecord {
  readonly id: string;
  /**
   * The cross-artifact join key — the target element's `backendNodeId`.
   * OMITTED (not `null`) when this animation genuinely has no element
   * target (e.g. a bare `Animation` with a null effect) — there is nothing
   * to identify. Present as `null` (never silently omitted) alongside
   * `identityUnresolved: true` when the animation DOES have an element
   * target but CDP could not resolve its identity (`describeBackendNodeId`
   * failed or the bridge object was never held) — see {@link
   * identityUnresolved}. Per I-3/I-5, "no target" and "target present but
   * unresolved" must never collapse to the same shape.
   */
  readonly backendNodeId?: number | null;
  /** `true` when this animation has an element target but {@link backendNodeId} is `null` because identity resolution failed or was never attempted — never omit this alongside a `null` backendNodeId. Absent (not `false`) when identity resolved or the animation has no element target at all. */
  readonly identityUnresolved?: boolean;
  readonly selector: string | null;
  readonly animationName: string | null;
  readonly durationMs: number | null;
  readonly iterationCount: number | 'infinite' | null;
  readonly infinite: boolean;
  readonly playState: string;
  /**
   * True when `--freeze-animations` was requested for this capture AND
   * this animation's `playState` is `'paused'` at read time. This is a
   * CO-OCCURRENCE fact, not proof of causation: an animation the page
   * itself had already paused (or created already-paused) before or
   * independent of the freeze is indistinguishable, from this collector's
   * own independent post-freeze `getAnimations()` re-enumeration, from one
   * the freeze mechanism forced from `'running'` to `'paused'` — WAAPI
   * exposes no per-animation pause history, and CDP's
   * `Animation.setPlaybackRate` override never touches the JS-visible
   * `Animation.playbackRate`. Read `frozen` as "paused while freeze was
   * requested", never as a verified per-animation tool-intervention claim.
   */
  readonly frozen: boolean;
}

/** Explicit factual scope for `animation.json`: `getAnimations({subtree:true})` walks the top document and its shadow subtrees, never nested iframe documents. */
export interface AnimationCoverage {
  readonly scope: 'top-document';
  /** Count of top-document `<iframe>` elements whose own animations are NOT enumerated (each iframe document has its own `getAnimations`). Meaningless (always `0`) when `available` below is `false` — read `available` first. */
  readonly iframesNotWalked: number;
  /** `false` when the iframe-count evaluate itself failed (the page-side count threw, or the CDP round trip threw/returned no usable value) — `iframesNotWalked:0` is then "could not count", not "zero iframes" (I-4/I-5). Always `true` on a normal run, including a page with genuinely zero iframes. */
  readonly available: boolean;
}

/** The fixed, factual reasons `animation.json`'s inventory could not be read — never a raw exception message, which is unbounded/page-influenced. */
export type AnimationUnavailableReason =
  | 'inventory-evaluate-threw'
  | 'inventory-evaluate-returned-no-object'
  | 'inventory-facts-unavailable'
  | 'inventory-meta-unavailable'
  | 'get-animations-threw';

export interface AnimationReport {
  /** `false` when the inventory evaluate/bridge itself failed, OR the page-side `document.getAnimations()` walk itself threw — an empty `animations` list is then "could not enumerate", not "genuinely no animations" (I-5). Always `true` on a normal run, including one where the page really has zero animations. */
  readonly available: boolean;
  /** Present only when `available` is `false`. */
  readonly unavailableReason?: AnimationUnavailableReason;
  /** Restates `ctx.freezeAnimations` at the artifact level — lets a reader of `animation.json` alone (without `meta.json`) tell "freeze wasn't requested" apart from "freeze was requested but nothing ended up paused" (`frozenCount:0` is otherwise ambiguous between the two). */
  readonly freezeRequested: boolean;
  readonly animations: readonly AnimationRecord[];
  readonly infiniteCount: number;
  readonly frozenCount: number;
  readonly coverage: AnimationCoverage;
  /** True when the try/finally release of a held CDP bridge object threw — a factual marker that CDP-session-scoped remote-object memory may not have been freed early, never a diagnosis and never page-observable state. Absent when release succeeded. */
  readonly bridgeCleanupFailed?: boolean;
}

/** Page-side raw record — the settle.ts base shape plus a `targetIdx` into the held (never page-observable) elements array (absent/`-1` when the animation has no element target). */
interface RawAnimationRecord {
  readonly selector: string | null;
  readonly animationName: string | null;
  readonly durationMs: number | null;
  readonly iterationCount: number | 'infinite' | null;
  readonly infinite: boolean;
  readonly playState: string;
  readonly targetIdx?: number;
}

/**
 * Enumerates `getAnimations({subtree:true})` and, in the SAME pass, collects
 * each element target into a page-side array at the index recorded as
 * `targetIdx` — so a target's `backendNodeId` is resolved against the
 * exact element the record describes, with no second-call ordering skew.
 * Returns `{ facts, elements, meta }`: `facts` is the bare record ARRAY
 * (identical to settle.ts's inventory shape, plus `targetIdx`); `elements`
 * is the live target array, in `targetIdx` order; `meta.ok` is `false`
 * when `document.getAnimations()` (or reading its timing) itself threw —
 * distinguishing that failure from a genuinely-empty successful walk is
 * the entire point (I-4/I-5): a thrown enumeration discards any partial
 * `facts`/`elements` accumulated so far (never returns a partial result as
 * if it were the complete truth). None of `facts`/`elements`/`meta` is
 * ever assigned to `window` or any other page-observable location — the
 * return value is a plain in-memory object, read back only through its own
 * held CDP `objectId` (see {@link collectAnimation}). `describeTarget`
 * matches settle.ts verbatim so the `selector` base field is identical
 * across both `animation.json` branches.
 */
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
  var targets = [];
  try {
    var anims = document.getAnimations({ subtree: true });
    for (var i = 0; i < anims.length; i++) {
      var a = anims[i];
      var timing = (a.effect && a.effect.getComputedTiming) ? a.effect.getComputedTiming() : null;
      var iterations = timing ? timing.iterations : null;
      var infinite = iterations === Infinity;
      var target = (a.effect && a.effect.target) ? a.effect.target : null;
      var targetIdx = -1;
      if (target && target.nodeType === 1) {
        targetIdx = targets.length;
        targets.push(target);
      }
      out.push({
        selector: target ? describeTarget(target) : null,
        animationName: a.animationName || a.id || null,
        durationMs: timing ? timing.duration : null,
        iterationCount: infinite ? 'infinite' : (typeof iterations === 'number' ? iterations : null),
        infinite: infinite,
        playState: a.playState,
        targetIdx: targetIdx,
      });
    }
  } catch (e) {
    return { facts: [], elements: [], meta: { ok: false } };
  }
  return { facts: out, elements: targets, meta: { ok: true } };
})();`;

/**
 * Order-independent count of top-document iframes whose animations are not
 * enumerated. Its own evaluate — a bare count, no coupling to the inventory
 * enumeration order. Returns `{ count, ok }` rather than a bare number so a
 * page-side `querySelectorAll` throw is distinguishable from a genuine
 * zero-iframe page (I-4/I-5) — see {@link AnimationCoverage.available}.
 */
const IFRAME_COUNT_SCRIPT = `(function () { try { return { count: document.querySelectorAll('iframe').length, ok: true }; } catch (e) { return { count: 0, ok: false }; } })()`;

export const collectAnimation: Collector = async (ctx) => {
  let raw: RawAnimationRecord[] = [];
  let bridgeCleanupFailed = false;
  // I-5: distinguishes "the evaluate/bridge failed" from "the page really
  // has no animations" — both otherwise collapse to an empty `animations`
  // list, indistinguishable to a reader.
  let available = true;
  let unavailableReason: AnimationReport['unavailableReason'];
  const heldObjectIds: string[] = [];
  // Preallocated below once `raw` (and so `targetCount`) is known — filled
  // in the SAME try block as the walk, before the held ids are released.
  let backendNodeIds: Array<number | undefined> = [];
  try {
    const walkEval = (await ctx.client.send('Runtime.evaluate', {
      expression: ANIMATION_INVENTORY_SCRIPT,
      returnByValue: false,
    })) as { result?: { objectId?: string } };
    const resultObjectId = walkEval.result?.objectId;

    if (resultObjectId) {
      heldObjectIds.push(resultObjectId);
      const containerIds = await ownPropertyObjectIds(ctx.client, resultObjectId);
      const factsObjectId = containerIds.get('facts');
      const elementsObjectId = containerIds.get('elements');
      const metaObjectId = containerIds.get('meta');

      // I-4: a missing objectId for a required held property, OR a
      // readHeldValue() that resolves (without throwing) to `undefined`, is
      // the SAME fact as a thrown read -- the property was never actually
      // read. Read both before deciding success/failure so neither can
      // silently fall through to the initialized empty/default artifact
      // (mirrors geometry.ts's facts/meta pattern).
      let factsValue: RawAnimationRecord[] | undefined;
      if (factsObjectId) {
        heldObjectIds.push(factsObjectId);
        factsValue = await readHeldValue<RawAnimationRecord[]>(ctx.client, factsObjectId);
      }

      let metaValue: { ok?: boolean } | undefined;
      if (metaObjectId) {
        heldObjectIds.push(metaObjectId);
        metaValue = await readHeldValue<{ ok?: boolean }>(ctx.client, metaObjectId);
      }

      if (factsValue === undefined) {
        available = false;
        unavailableReason = 'inventory-facts-unavailable';
      } else if (metaObjectId && metaValue === undefined) {
        // `meta` rides the SAME returned object literal as `facts` -- when
        // the container has a `meta` OWN PROPERTY (a real production
        // inventory return always does) but reading it failed, that is a
        // broken bridge read, not "the page has zero animations". A
        // container with NO `meta` property at all is treated as
        // undetermined-but-fine below rather than unavailable, so this
        // stays compatible with any caller driving the pre-existing
        // `{ facts, elements }` shape without the newer `ok` signal.
        available = false;
        unavailableReason = 'inventory-meta-unavailable';
      } else if (metaValue?.ok === false) {
        // The page-side `document.getAnimations()` walk itself threw --
        // `facts`/`elements` were reset to empty by the script's own catch
        // branch, so there is nothing partial to trust here either.
        available = false;
        unavailableReason = 'get-animations-threw';
      } else {
        raw = factsValue;
        const targetCount = raw.reduce((n, a) => (typeof a.targetIdx === 'number' && a.targetIdx >= 0 ? n + 1 : n), 0);
        backendNodeIds = new Array<number | undefined>(targetCount).fill(undefined);

        if (elementsObjectId && targetCount > 0) {
          heldObjectIds.push(elementsObjectId);
          const objectIds = await resolveIndexedObjectIds(ctx.client, elementsObjectId, targetCount);
          // Each resolved per-target element objectId is its OWN held remote
          // reference, distinct from the container/facts/elements array
          // objectIds above -- it must be released too, or every animated
          // element this run touched leaks CDP-session-scoped memory.
          for (const objectId of objectIds) {
            if (objectId) heldObjectIds.push(objectId);
          }
          await Promise.all(
            objectIds.map(async (objectId, idx) => {
              if (!objectId) return;
              backendNodeIds[idx] = await describeBackendNodeId(ctx.client, objectId);
            }),
          );
        }
      }
    } else {
      available = false;
      unavailableReason = 'inventory-evaluate-returned-no-object';
    }
  } catch {
    raw = [];
    available = false;
    unavailableReason = 'inventory-evaluate-threw';
  } finally {
    // Runs UNCONDITIONALLY: every held container/facts/elements/per-target
    // objectId must be released even when a step above throws, so a later
    // capture on the same tab never collides with anything this run held.
    for (const id of heldObjectIds) {
      try {
        await ctx.client.send('Runtime.releaseObject', { objectId: id });
      } catch {
        bridgeCleanupFailed = true;
      }
    }
  }

  let iframesNotWalked = 0;
  let iframeCoverageAvailable = true;
  try {
    const frameResult = (await ctx.client.send('Runtime.evaluate', {
      expression: IFRAME_COUNT_SCRIPT,
      returnByValue: true,
    })) as { result?: { value?: { count?: number; ok?: boolean } } };
    const value = frameResult.result?.value;
    if (value && value.ok === true && typeof value.count === 'number') {
      iframesNotWalked = value.count;
    } else {
      // The evaluate itself succeeded but the page-side count threw (or the
      // round trip returned no usable value) -- 0 here would otherwise be
      // indistinguishable from a genuine zero-iframe page.
      iframeCoverageAvailable = false;
    }
  } catch {
    iframeCoverageAvailable = false;
  }

  const animations: AnimationRecord[] = raw.map((a, i) => {
    const hasTarget = typeof a.targetIdx === 'number' && a.targetIdx >= 0;
    // I-3/I-5: "no element target" (omit the field — nothing to identify)
    // and "target present but identity resolution failed" (backendNodeId:
    // null + identityUnresolved:true) must never collapse to the same
    // undefined-field shape — mirrors hittest.ts's `resolvedIdentity`.
    const resolvedBackendNodeId = hasTarget ? backendNodeIds[a.targetIdx as number] : undefined;
    const identity: Pick<AnimationRecord, 'backendNodeId' | 'identityUnresolved'> = !hasTarget
      ? {}
      : resolvedBackendNodeId === undefined
        ? { backendNodeId: null, identityUnresolved: true }
        : { backendNodeId: resolvedBackendNodeId };
    return {
      id: `anim-${i + 1}`,
      ...identity,
      selector: a.selector !== null ? sanitizeString(a.selector, { max: 300 }) : null,
      animationName: a.animationName !== null ? sanitizeString(a.animationName, { max: 200 }) : null,
      durationMs: a.durationMs,
      iterationCount: a.iterationCount,
      infinite: a.infinite,
      playState: a.playState,
      frozen: ctx.freezeAnimations && a.playState === 'paused',
    };
  });

  const report: AnimationReport = {
    available,
    ...(unavailableReason ? { unavailableReason } : {}),
    freezeRequested: ctx.freezeAnimations,
    animations,
    infiniteCount: animations.filter((a) => a.infinite).length,
    frozenCount: animations.filter((a) => a.frozen).length,
    coverage: { scope: 'top-document', iframesNotWalked, available: iframeCoverageAvailable },
    ...(bridgeCleanupFailed ? { bridgeCleanupFailed: true } : {}),
  };

  ctx.write.json('animation.json', report);
};
