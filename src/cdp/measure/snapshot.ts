/**
 * The `measure snap` orchestrator — drives the settledness gate, then (when
 * captured) runs the collectors in two phases: serialized `baseline`
 * collectors, then `screenshot.png`/`dom.html` at the baseline boundary,
 * then serialized `mutating` collectors (so their DOM/focus/scroll/
 * background changes can't contaminate the baseline artifacts). `meta.json`
 * is ALWAYS written last. This is the one function
 * `src/cdp/commands/measure/snap.ts` (U15) calls; nothing else drives a
 * snapshot capture.
 */

import * as path from 'path';

import { ensurePrivateDir, writeJsonPrivate, writeBinaryPrivate, writePrivateFile } from '../../session/artifacts.js';
import type { CDPClient } from '../client.js';
import { enableDomainsForSnap } from '../domains.js';
import {
  DEFAULT_SETTLE_TIMEOUT_MS,
  DEFAULT_QUIET_THRESHOLD_MS,
  DEFAULT_POLL_INTERVAL_MS,
  pollForSettle,
  buildDomSettleSampler,
  domSignaturesEqual,
  injectChurnObservers,
  collectChurnEvidence,
  freezeAnimationsBeforeCapture,
  restoreAnimationsAfterCapture,
  collectAnimationEvidence,
  groupChurnEvidence,
} from './settle.js';
import type { AnimationFreezeHandle } from './settle.js';
import { sanitizeString } from './redaction.js';
import type {
  CaptureSnapshotOptions,
  CaptureSnapshotResult,
  SnapshotContext,
  SnapshotMeta,
  SnapshotWriter,
  UnstableRegion,
  CollectorDescriptor,
  CollectorOutcome,
} from './types.js';

import { collectGeometry } from './collectors/geometry.js';
import { collectHittest } from './collectors/hittest.js';
import { collectStyles } from './collectors/styles.js';
import { collectQueries } from './collectors/queries.js';
import { collectAx } from './collectors/ax.js';
import { collectText } from './collectors/text.js';
import { collectForms } from './collectors/forms.js';
import { collectAnimation } from './collectors/animation.js';
import { collectFocus } from './collectors/focus.js';
import { collectScroll } from './collectors/scroll.js';
import { collectLayers } from './collectors/layers.js';
import { collectPixels } from './collectors/pixels.js';
import { collectStates } from './collectors/states.js';
import { collectMedia } from './collectors/media.js';

/**
 * The collector set, split by phase. Every collector shares one browser CDP
 * connection, so both phases run in descriptor order. Baseline collectors
 * finish before `screenshot.png`/`dom.html`; `mutating` collectors run afterward, so their
 * DOM/focus/scroll/background mutations cannot contaminate the baseline
 * artifacts. Geometry/hittest/text/forms are safely `baseline`: none of
 * them ever mutates the DOM — each resolves its elements' `backendNodeId`
 * through the read-only CDP object-id bridge (`geometry.ts`'s
 * `resolveIndexedObjectIds`/`describeBackendNodeId`, off a held
 * `{ facts, elements }` container returned by value and never assigned to
 * `window`), so nothing another baseline collector or the
 * `screenshot.png`/`dom.html` capture could observe ever changes.
 */
const COLLECTORS: readonly CollectorDescriptor[] = [
  { name: 'geometry', phase: 'baseline', fn: collectGeometry },
  { name: 'ax', phase: 'baseline', fn: collectAx },
  { name: 'styles', phase: 'baseline', fn: collectStyles },
  { name: 'queries', phase: 'baseline', fn: collectQueries },
  { name: 'animation', phase: 'baseline', fn: collectAnimation },
  { name: 'layers', phase: 'baseline', fn: collectLayers },
  { name: 'media', phase: 'baseline', fn: collectMedia },
  { name: 'hittest', phase: 'baseline', fn: collectHittest },
  { name: 'text', phase: 'baseline', fn: collectText },
  { name: 'forms', phase: 'baseline', fn: collectForms },
  { name: 'focus', phase: 'mutating', fn: collectFocus },
  { name: 'scroll', phase: 'mutating', fn: collectScroll },
  { name: 'states', phase: 'mutating', fn: collectStates },
  { name: 'pixels', phase: 'mutating', fn: collectPixels },
];

export const COLLECTOR_NAMES = COLLECTORS.map((collector) => collector.name);
export const DEFAULT_COLLECTOR_TIMEOUT_MS = 30_000;

/**
 * Resolves `filename` against the snap `dir` and rejects (throws) anything
 * that would escape it — an absolute path, or a `path.relative(dir, target)`
 * that starts climbing out (`..`). The U03 secure-fs helpers only enforce the
 * global `CAPTURE_ROOT` boundary, so this is what actually scopes a
 * collector's writes to the snap directory `SnapshotWriter` documents.
 */
function resolveScopedArtifactPath(dir: string, filename: string): string {
  const target = path.resolve(dir, filename);
  const rel = path.relative(dir, target);
  const escapesDir = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  if (escapesDir) {
    throw new Error(`Refusing to write snapshot artifact "${filename}" outside its snap dir ${dir}`);
  }
  return target;
}

function makeWriter(dir: string, artifacts: string[]): SnapshotWriter {
  return {
    json(filename: string, value: unknown): void {
      writeJsonPrivate(resolveScopedArtifactPath(dir, filename), value);
      artifacts.push(filename);
    },
    binary(filename: string, data: Buffer): void {
      writeBinaryPrivate(resolveScopedArtifactPath(dir, filename), data);
      artifacts.push(filename);
    },
  };
}

/** A collector publishes its artifacts only after it completes within budget. */
function makeCollectorWriter(writer: SnapshotWriter): { writer: SnapshotWriter; commit: () => void; discard: () => void } {
  const staged: Array<{ filename: string; value: unknown } | { filename: string; data: Buffer }> = [];
  let open = true;
  return {
    writer: {
      json(filename: string, value: unknown): void {
        if (open) staged.push({ filename, value });
      },
      binary(filename: string, data: Buffer): void {
        if (open) staged.push({ filename, data });
      },
    },
    commit(): void {
      if (!open) return;
      open = false;
      for (const artifact of staged) {
        if ('data' in artifact) writer.binary(artifact.filename, artifact.data);
        else writer.json(artifact.filename, artifact.value);
      }
      staged.length = 0;
    },
    discard(): void {
      open = false;
      staged.length = 0;
    },
  };
}

// ============================================================================
// Orchestrator
// ============================================================================

/** One CDP operation is bounded so a page-side script or browser command that never returns cannot strand the CLI behind CDPClient's 60-second default. */
export const SNAPSHOT_REQUEST_TIMEOUT_MS = 5_000;

/** A snapshot operation timed out after writing zero or more partial artifacts. */
export class SnapshotCaptureTimeout extends Error {
  readonly code = 'snapshot_capture_timeout';

  constructor(
    readonly phase: string,
    readonly method: string,
    readonly timeoutMs: number,
    readonly partialPath: string,
  ) {
    super(`snapshot capture timed out in ${phase} while waiting for ${method} after ${timeoutMs}ms; partial artifacts: ${partialPath}`);
    this.name = 'SnapshotCaptureTimeout';
  }
}

/** Bounds one snapshot CDP request and labels the phase that owns it. */
function boundedClient(client: CDPClient, phase: string, partialPath: string, onTimeout?: () => void): CDPClient {
  const bounded = Object.create(client) as CDPClient;
  bounded.send = (method: string, params: Record<string, unknown> = {}, timeout = 60_000, sessionId?: string): Promise<unknown> => {
    const timeoutMs = Math.min(timeout, SNAPSHOT_REQUEST_TIMEOUT_MS);
    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;
    const markTimedOut = (): void => {
      if (timedOut) return;
      timedOut = true;
      onTimeout?.();
    };
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        markTimedOut();
        reject(new SnapshotCaptureTimeout(phase, method, timeoutMs, partialPath));
      }, timeoutMs);
    });
    const request = Promise.resolve().then(() => client.send(method, params, timeoutMs, sessionId)).catch((error: unknown) => {
      if (error instanceof SnapshotCaptureTimeout) throw error;
      if (error instanceof Error && error.message.startsWith('CDP request timeout')) {
        markTimedOut();
        throw new SnapshotCaptureTimeout(phase, method, timeoutMs, partialPath);
      }
      throw error;
    });
    return Promise.race([request, deadline]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  };
  return bounded;
}

/**
 * Captures one snapshot substrate directory: enables the CDP domains,
 * runs the settledness gate, and — when the page settled or the caller
 * forced `captureUnsettled` — writes the full collector substrate plus
 * `screenshot.png`/`dom.html`. `meta.json` is written on every branch,
 * unconditionally, last.
 */
export async function captureSnapshotSubstrate(options: CaptureSnapshotOptions): Promise<CaptureSnapshotResult> {
  const client = options.target.client;
  const dir = ensurePrivateDir(options.path);
  const snapId = options.snapId ?? path.basename(dir);
  const settleTimeoutMs = options.settleTimeout ?? DEFAULT_SETTLE_TIMEOUT_MS;
  const quietThresholdMs = options.quietThresholdMs ?? DEFAULT_QUIET_THRESHOLD_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const freezeAnimations = options.freezeAnimations ?? false;
  const captureUnsettled = options.captureUnsettled ?? false;
  const pixels = options.pixels ?? false;
  const state = options.state ?? [];
  const viewport = options.viewport ?? null;
  // Apply the shared artifact-string cap once at the source. URL contents
  // otherwise survive unchanged in meta.json, the result, and collector context.
  const url = options.url ? sanitizeString(options.url) : null;
  const artifacts: string[] = [];
  const phaseClient = (phase: string): CDPClient => boundedClient(client, phase, dir);

  await enableDomainsForSnap(phaseClient('domains'));

  // I-6: capture each animation's pre-freeze origin BEFORE this, the first
  // mutation, and restore it exception-safely — `animationFreezeHandle`/
  // `animationsRestored` are threaded through the whole function (via the
  // outer `finally` below) so a throw anywhere after this point still gets
  // a real restore attempt, never a page left silently forced.
  let animationFreezeHandle: AnimationFreezeHandle | undefined;
  // Pessimistic default: only flips to `true` on a confirmed restore, so an
  // origin-capture failure (handle stays `undefined`, restoreAnimationsOnce
  // never runs) still reports the honest `false` rather than omitting the
  // fact entirely.
  let animationsRestored: boolean | undefined = freezeAnimations ? false : undefined;
  // #8: capture the freeze-OVERRIDE-apply fact right here, at origin-capture
  // time — `restoreAnimationsOnce` below unconditionally nulls out
  // `animationFreezeHandle` once consumed, so `handle.rateOverrideApplied`
  // would no longer be reachable by the time `meta.json` is built if it
  // weren't captured into its own variable now. Stays `undefined` when
  // freeze wasn't requested at all, OR when the origin capture itself
  // failed (no handle was ever returned — nothing was mutated, and that
  // failure is already surfaced honestly via the pessimistic
  // `animationsRestored:false` default below).
  let freezeOverrideApplied: boolean | undefined;
  // #72: same capture-now rationale as `freezeOverrideApplied` above —
  // `restoreAnimationsOnce` nulls out `animationFreezeHandle` once consumed,
  // so the per-animation pause-failure facts would no longer be reachable by
  // the time `meta.json` is built if they weren't captured into their own
  // variables now. Both stay `undefined` when freeze wasn't requested, OR
  // when the origin capture itself failed (no handle was ever returned).
  let freezeIncomplete: boolean | undefined;
  let unfrozenCount: number | undefined;
  if (freezeAnimations) {
    animationFreezeHandle = await freezeAnimationsBeforeCapture(phaseClient('freeze-animations'));
    freezeOverrideApplied = animationFreezeHandle?.rateOverrideApplied;
    freezeIncomplete = animationFreezeHandle?.freezeIncomplete;
    unfrozenCount = animationFreezeHandle?.unfrozenCount;
  }
  // Idempotent — the second (or only) call is a no-op once the handle has
  // been consumed, so calling it both at the natural restore point AND from
  // the `finally` safety net below never double-restores.
  const restoreAnimationsOnce = async (): Promise<void> => {
    if (!animationFreezeHandle) return;
    const handle = animationFreezeHandle;
    animationFreezeHandle = undefined;
    const result = await restoreAnimationsAfterCapture(phaseClient('restore-animations'), handle);
    animationsRestored = result.restored;
  };

  try {
    const churnHandle = await injectChurnObservers(phaseClient('settle-observers'));

    // The churn observers (MutationObserver/ResizeObserver) MUST be torn down
    // even if sampling throws (a CDP failure mid-poll) — otherwise they leak
    // and contaminate later captures in the same tab. Teardown is attempted
    // unconditionally; if the poll failed, its error is what gets rethrown
    // (a secondary teardown failure never masks it). Exactly one of the two
    // `collectChurnEvidence(client, churnHandle)` calls below runs per
    // invocation — the catch path rethrows, so the normal-path call below it
    // never also runs — and `collectChurnEvidence` owns the handle's single
    // `Runtime.releaseObject`, so the handle is released exactly once either way.
    let settleResult: Awaited<ReturnType<typeof pollForSettle<string>>>;
    try {
      settleResult = await pollForSettle({
        captureSample: buildDomSettleSampler(phaseClient('settle'), churnHandle),
        isEqual: domSignaturesEqual,
        settleTimeoutMs,
        quietThresholdMs,
        pollIntervalMs,
      });
    } catch (pollError) {
      try {
        await collectChurnEvidence(phaseClient('settle-cleanup'), churnHandle);
      } catch {
        // Secondary teardown failure — the original poll error is what matters.
      }
      throw pollError;
    }

    // Always call — cleanup, and potential evidence, regardless of settledness.
    const churnEvidenceRaw = await collectChurnEvidence(phaseClient('settle-cleanup'), churnHandle);

    const settled = settleResult.settled;
    const captured = settled || captureUnsettled;
    const unstable = !settled;

    let unstableRegions: readonly UnstableRegion[] = [];
    // I-5: set only inside the `captured` branch below (the only place
    // `dom.html` is ever attempted) — stays `undefined` on the evidence-only
    // branch, where `meta.json`'s spread omits the field entirely rather than
    // implying a read that never happened.
    let domHtmlFact: SnapshotMeta['domHtml'];
    const collectorOutcomes: CollectorOutcome[] = [];

    if (unstable) {
      const animationEvidence = await collectAnimationEvidence(phaseClient('settle-evidence'));
      const grouped = groupChurnEvidence(churnEvidenceRaw, animationEvidence, settleResult.elapsedMs, settleTimeoutMs);
      unstableRegions = grouped.unstableRegions;
      writeJsonPrivate(path.join(dir, 'churn.json'), grouped.report);
      artifacts.push('churn.json');
      if (!captured) {
        writeJsonPrivate(path.join(dir, 'animation.json'), animationEvidence);
        artifacts.push('animation.json');
      }
    }

    if (captured) {
      const ctx: SnapshotContext = {
        client,
        dir,
        snapId,
        url,
        viewport,
        settled,
        freezeAnimations,
        captureUnsettled,
        pixels,
        state,
        unstableRegions,
        write: makeWriter(dir, artifacts),
      };

      const collectors = options.collectors ?? COLLECTORS;
      const skipCollectors = new Set(options.skipCollectors ?? []);
      const baseline = collectors.filter((c) => c.phase === 'baseline');
      const mutating = collectors.filter((c) => c.phase === 'mutating');
      const collectorTimeoutMs = options.collectorTimeout ?? DEFAULT_COLLECTOR_TIMEOUT_MS;
      const runCollector = async (collector: CollectorDescriptor): Promise<CollectorOutcome> => {
        if (skipCollectors.has(collector.name)) return { name: collector.name, status: 'skipped' };

        const startedAt = Date.now();
        let requestTimeouts = 0;
        const collectorWriter = makeCollectorWriter(ctx.write);
        const run = Promise.resolve().then(() => collector.fn({
          ...ctx,
          client: boundedClient(client, `collector:${collector.name}`, dir, () => { requestTimeouts += 1; }),
          write: collectorWriter.writer,
        }));
        // A collector can still be awaiting a browser response after its wall-clock
        // deadline. Its writer is discarded before the next collector starts, so it
        // cannot publish a late or partial artifact into this completed snapshot.
        run.catch(() => undefined);
        let timer: NodeJS.Timeout | undefined;
        const completion = await Promise.race([
          run.then(() => 'complete' as const, () => 'error' as const),
          new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), collectorTimeoutMs);
          }),
        ]);
        if (timer) clearTimeout(timer);
        const ms = Date.now() - startedAt;
        if (completion === 'complete') {
          collectorWriter.commit();
          return requestTimeouts > 0
            ? { name: collector.name, status: 'degraded', ms, requestTimeouts }
            : { name: collector.name, status: 'ok', ms };
        }
        collectorWriter.discard();
        return { name: collector.name, status: completion, ms, ...(requestTimeouts > 0 ? { requestTimeouts } : {}) };
      };

      // Phase 1 — baseline collectors observe the page exactly as it settled.
      // They are serialized because CDP commands share one browser connection;
      // every completed result is published before the baseline boundary.
      for (const collector of baseline) collectorOutcomes.push(await runCollector(collector));

      // Baseline boundary — capture screenshot.png + dom.html BEFORE any
      // mutating collector runs, so a mutating collector's DOM/focus/scroll/
      // background change (or a failed restoration) can never contaminate
      // these artifacts.
      const screenshotResponse = (await phaseClient('baseline-screenshot').send('Page.captureScreenshot', { format: 'png' })) as { data: string };
      writeBinaryPrivate(path.join(dir, 'screenshot.png'), Buffer.from(screenshotResponse.data, 'base64'));
      artifacts.push('screenshot.png');

      // I-5: an `outerHTML` read that throws or returns no `value` is a
      // FAILED read, not the fact "the document is empty" — coercing it to
      // `''` would write a valid-looking-but-empty `dom.html` indistinguishable
      // from a genuinely empty document. Surface the failure as an explicit
      // `meta.json` fact and skip writing the file (an absent artifact, never
      // a benign empty one) rather than fabricate the read.
      let domHtmlValue: string | undefined;
      let domHtmlUnavailableReason: string | undefined;
      try {
        const domResponse = (await phaseClient('baseline-dom').send('Runtime.evaluate', {
          expression: 'document.documentElement.outerHTML',
          returnByValue: true,
        })) as { result?: { value?: string } };
        domHtmlValue = domResponse.result?.value;
        if (domHtmlValue === undefined) {
          domHtmlUnavailableReason = 'dom-evaluate-returned-no-value';
        }
      } catch {
        domHtmlValue = undefined;
        domHtmlUnavailableReason = 'dom-evaluate-threw';
      }
      if (domHtmlValue === undefined) {
        domHtmlFact = { available: false, unavailableReason: domHtmlUnavailableReason };
      } else {
        writePrivateFile(path.join(dir, 'dom.html'), domHtmlValue);
        artifacts.push('dom.html');
        domHtmlFact = { available: true };
      }

      // I-6: restore right after the frozen baseline artifacts are captured
      // — animations must stay paused through screenshot.png/dom.html (the
      // entire point of `--freeze-animations`), but a mutating-phase
      // collector (focus/scroll/states probing) should observe the page as
      // it would otherwise behave, not one still forced.
      await restoreAnimationsOnce();

      // Phase 2 — mutating collectors run AFTER the baseline artifacts are
      // captured, one at a time, so their mutations and restorations cannot
      // contaminate each other.
      for (const collector of mutating) collectorOutcomes.push(await runCollector(collector));
    } else {
      // Evidence-only branch (unstable, not captured) — nothing depends on
      // animations staying frozen any longer, so restore now.
      await restoreAnimationsOnce();
    }

    const meta: SnapshotMeta = {
      id: snapId,
      url,
      viewport,
      settled,
      capturedAt: new Date().toISOString(),
      settleMs: settleResult.elapsedMs,
      settleTimeoutMs,
      freezeAnimations,
      captureUnsettled,
      pixels,
      states: state.map((spec) => sanitizeString(spec)),
      unstableRegionCount: unstableRegions.length,
      ...(freezeAnimations ? { animationsRestored: animationsRestored ?? false } : {}),
      // #8: the browser-wide `Animation.setPlaybackRate({playbackRate:0})`
      // override itself failing to apply is a genuine I-6 fact distinct from
      // `animationsRestored` above (which reflects only the RESTORE step) —
      // a page can restore cleanly from whatever WAS frozen at origin-capture
      // time while still never having had the browser-wide override applied,
      // meaning any animation created after freeze was never covered. Only
      // ever written when the override genuinely failed; a successful
      // override (or freeze never requested / origin capture itself failed,
      // both already covered elsewhere) leaves this field absent — never a
      // fabricated affirmative value standing in for "we don't actually know".
      ...(freezeOverrideApplied === false ? { freezeOverrideApplied: false } : {}),
      // #72: only the noteworthy (incomplete) case is ever written — same
      // convention as `freezeOverrideApplied` above. A clean freeze (or
      // freeze not requested, or origin capture itself failed) leaves this
      // absent; a consumer must never read the absence as "confirmed clean"
      // on its own, only alongside the other freeze facts already emitted
      // (`animationsRestored`, `freezeOverrideApplied`) that cover those
      // other cases. `unfrozenCount` is only ever emitted alongside a `true`
      // `freezeIncomplete`, matching the handle's own documented contract.
      ...(freezeIncomplete === true ? { freezeIncomplete: true as const, unfrozenCount: unfrozenCount ?? 0 } : {}),
      ...(domHtmlFact ? { domHtml: domHtmlFact } : {}),
      ...(captured ? { collectors: collectorOutcomes, collectorTimeoutMs: options.collectorTimeout ?? DEFAULT_COLLECTOR_TIMEOUT_MS } : {}),
    };
    writeJsonPrivate(path.join(dir, 'meta.json'), meta);
    artifacts.push('meta.json');

    return {
      id: snapId,
      dir,
      url,
      viewport,
      settled,
      captured,
      settleMs: settleResult.elapsedMs,
      settleTimeoutMs,
      unstableRegions,
      artifacts,
      collectors: collectorOutcomes,
      meta,
    };
  } catch (error) {
    if (error instanceof SnapshotCaptureTimeout) {
      try {
        writeJsonPrivate(path.join(dir, 'capture-timeout.json'), {
          schemaVersion: 1,
          id: snapId,
          status: 'timeout',
          phase: error.phase,
          method: error.method,
          timeoutMs: error.timeoutMs,
          partialPath: dir,
          artifacts,
          capturedAt: new Date().toISOString(),
        });
        artifacts.push('capture-timeout.json');
      } catch {
        // Preserve the timeout and its directory even if recovery metadata cannot be written.
      }
    }
    throw error;
  } finally {
    // I-6 exception safety net: if anything above threw before either
    // natural restore point ran, still restore the page against the
    // captured origin — `restoreAnimationsAfterCapture` never throws, so
    // this can't mask the original error, and it's a no-op once the handle
    // has already been consumed.
    await restoreAnimationsOnce();
  }
}
