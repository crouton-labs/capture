/**
 * Snapshot substrate types — the contract every `measure snap` collector
 * (U07–U12) and the orchestrator (`snapshot.ts`) share. This file is the
 * spec: read it before writing or changing a collector.
 *
 * ## The U04 artifact contract collectors must honor
 *  - `geometry.json` is ALWAYS `{ elements: ElementRecord[], unstableRegions?:
 *    UnstableRegion[] }`. `unstableRegions` is present ONLY on a
 *    `--capture-unsettled` capture of an unsettled page — never on a
 *    settled capture, and never omitted-but-empty vs. absent inconsistently.
 *    See `src/output/artifact.ts`'s module doc for the reader side of this.
 *  - Every per-element record any collector writes (in `geometry.json` and
 *    elsewhere) should carry the identifying fields in {@link ElementRecord}
 *    — a stable `id`, and whichever of `selector`/`backendNodeId`/`axId`/
 *    `axName`/`text` it has facts for — so `src/output/selector.ts`'s
 *    selector-input resolution works uniformly across every collector file.
 *  - `meta.json` MUST ALWAYS exist for any snap dir this orchestrator
 *    touches, including an unsettled, evidence-only capture (no
 *    `--capture-unsettled`). `session stop` reads it to build the bundle
 *    manifest, and `src/output/artifact.ts` treats its presence as the
 *    marker that a ref actually names something.
 */

import type { CDPClient } from '../client.js';
import type { SnapMeta } from '../../session/artifacts.js';
import type { UnstableRegion } from '../../output/artifact.js';
import type { ElementRecord } from '../../output/selector.js';

export type { UnstableRegion, ElementRecord };

/** The already-connected CDP client + (optional) target identity a snapshot capture drives. */
export interface CaptureSnapshotTarget {
  readonly client: CDPClient;
  readonly tabId?: string;
}

/** Input to {@link captureSnapshotSubstrate} — mirrors `measure snap`'s CLI options 1:1. */
export interface CaptureSnapshotOptions {
  readonly target: CaptureSnapshotTarget;
  readonly url: string | null;
  /** Absolute artifact directory for this snap, caller-resolved (session `measure/snaps/{id}` or a oneshot dir). */
  readonly path: string;
  /** Snapshot id; defaults to `basename(path)`. */
  readonly snapId?: string;
  /** `--settle-timeout <ms>`; default {@link DEFAULT_SETTLE_TIMEOUT_MS} (5000). */
  readonly settleTimeout?: number;
  /** `--freeze-animations`; default `false`. */
  readonly freezeAnimations?: boolean;
  /** `--capture-unsettled`; default `false`. */
  readonly captureUnsettled?: boolean;
  /** `--pixels`; default `false`. */
  readonly pixels?: boolean;
  /** `--state <state[:selector]>` (repeatable); default `[]`. */
  readonly state?: readonly string[];
  readonly viewport?: string | null;
  /**
   * Poll interval for the settledness loop; default {@link DEFAULT_POLL_INTERVAL_MS}
   * (100ms). Not part of the CLI surface — a test-only override so the
   * settledness suite doesn't need a fake-clock injection seam in
   * production code. Omitting it reproduces the documented default.
   */
  readonly pollIntervalMs?: number;
  /**
   * Quiet-window threshold for the settledness loop; default
   * {@link DEFAULT_QUIET_THRESHOLD_MS} (300ms). Same test-only-override
   * rationale as `pollIntervalMs`.
   */
  readonly quietThresholdMs?: number;
  /**
   * Collector set to run, ordered by {@link CollectorPhase}. Not part of
   * the CLI surface — a test-only override so the phase-ordering suite can
   * inject stub collectors that record their call order. Omitting it runs
   * the real collector set `snapshot.ts` defines.
   */
  readonly collectors?: readonly CollectorDescriptor[];
}

/** `meta.json`'s on-disk shape — a {@link SnapMeta} (the U03 contract) plus snapshot-specific detail. */
export interface SnapshotMeta extends SnapMeta {
  readonly settleMs: number;
  readonly settleTimeoutMs: number;
  readonly freezeAnimations: boolean;
  readonly captureUnsettled: boolean;
  readonly pixels: boolean;
  readonly states: readonly string[];
  readonly unstableRegionCount: number;
  /** Present only when `freezeAnimations` is true — whether every animation `freezeAnimationsBeforeCapture` paused was confirmed resumed to its pre-freeze `playState` (I-6). `false` means restoration could not be guaranteed (origin capture failed, or the restore call itself threw) — never omitted to imply a clean restore. */
  readonly animationsRestored?: boolean;
  /** Present (and always `false`) only when the browser-wide `Animation.setPlaybackRate({playbackRate:0})` freeze override itself threw during origin capture (I-6, #8) — distinct from `animationsRestored` above, which reflects only the RESTORE step. The per-animation `.pause()` calls captured in the same evaluate as the origin capture are still real for whatever existed at freeze time, but any animation the page creates AFTER that point was never covered by the override. Absent whenever the override genuinely succeeded, freeze wasn't requested, or the origin capture itself failed (that failure is already surfaced via a pessimistic `animationsRestored:false`) — never a fabricated affirmative standing in for "unknown". */
  readonly freezeOverrideApplied?: false;
  /** Present (and always `true`) only when at least one animation's own `.pause()` call inside {@link FREEZE_ANIMATIONS_SCRIPT} failed (#72) — that animation was left running through the frozen baseline capture even though `rateOverrideApplied`/`freezeOverrideApplied` can both be genuinely clean. Absent whenever every enumerated animation was confirmed paused, freeze wasn't requested, or the origin capture itself failed (already surfaced via a pessimistic `animationsRestored:false`) — never a fabricated `false` standing in for "unknown". Always emitted alongside `unfrozenCount` when `true`. */
  readonly freezeIncomplete?: true;
  /** Count of animations whose `.pause()` call failed (#72) — only present when `freezeIncomplete` is `true`. `0` there means the pause-failure tally itself could not be read back (the count is genuinely UNKNOWN, not confirmed zero); `freezeIncomplete` is the operative gate for that case, not this count. */
  readonly unfrozenCount?: number;
  /** Present only when the snapshot reached the baseline boundary (`captured`) — whether `document.documentElement.outerHTML` was actually read (I-5). `false` means the CDP read threw or returned no value: `dom.html` is NOT written in that case (an absent file, never a benign empty one), and `unavailableReason` names why. */
  readonly domHtml?: { readonly available: boolean; readonly unavailableReason?: string };
}

/** Return value of {@link captureSnapshotSubstrate}. */
export interface CaptureSnapshotResult {
  readonly id: string;
  readonly dir: string;
  readonly url: string | null;
  readonly viewport: string | null;
  readonly settled: boolean;
  /** `settled || captureUnsettled` — whether the full collector substrate was written. */
  readonly captured: boolean;
  readonly settleMs: number;
  readonly settleTimeoutMs: number;
  readonly unstableRegions: readonly UnstableRegion[];
  /** Filenames written under `dir`, relative to it. */
  readonly artifacts: readonly string[];
  readonly meta: SnapshotMeta;
}

/**
 * The write surface a {@link SnapshotContext} hands to every collector.
 * Both methods resolve `filename` against the snap `dir` and THROW if the
 * resolved target would escape it (an absolute path, or a `path.relative`
 * from `dir` that climbs out via `..`) — the U03 secure-fs helpers only
 * enforce the global `CAPTURE_ROOT` boundary, so this containment check is
 * what actually scopes a collector's writes to this snap's directory.
 */
export interface SnapshotWriter {
  /** Writes `value` as pretty JSON to `filename` under the snap dir (via `writeJsonPrivate`) and records it as a written artifact. Throws if `filename` would escape the snap dir. */
  json(filename: string, value: unknown): void;
  /** Writes `data` as a binary file to `filename` under the snap dir (via `writeBinaryPrivate`) and records it as a written artifact. Throws if `filename` would escape the snap dir. */
  binary(filename: string, data: Buffer): void;
}

/**
 * Shared, read-only capture context every collector (U07–U12) receives.
 * Collectors read from this and write only through `write` — never touch
 * `fs` directly, never resolve their own path under `dir`.
 */
export interface SnapshotContext {
  readonly client: CDPClient;
  /** Absolute snap artifact directory. */
  readonly dir: string;
  readonly snapId: string;
  readonly url: string | null;
  readonly viewport: string | null;
  /** Whether the page reached settledness (not merely whether a full substrate is being written — see `captureUnsettled`). */
  readonly settled: boolean;
  readonly freezeAnimations: boolean;
  readonly captureUnsettled: boolean;
  readonly pixels: boolean;
  /** `--state` values requested for this capture. */
  readonly state: readonly string[];
  /** Non-empty ONLY when the page was unstable and a full substrate was still captured (`--capture-unsettled`). Collectors that key elements should stamp matching regions' ids onto affected records; `geometry.ts` spreads this directly into `geometry.json`'s `unstableRegions` field. */
  readonly unstableRegions: readonly UnstableRegion[];
  readonly write: SnapshotWriter;
}

/** A collector's whole contract: read from `ctx`, write via `ctx.write`, resolve. */
export type Collector = (ctx: SnapshotContext) => Promise<void>;

/**
 * Which snapshot phase a collector belongs to — the ordering guarantee the
 * orchestrator enforces:
 *  - `baseline`: pure/measuring collectors that must observe the page as it
 *    settled. They run in PARALLEL, and ALL finish before `screenshot.png`
 *    + `dom.html` are captured at the baseline boundary.
 *  - `mutating`: collectors that mutate DOM/focus/scroll/background
 *    (focus, scroll, states, pixels). They run AFTER the baseline artifacts
 *    are captured, and SERIALIZED (one at a time) so their mutations and
 *    restorations cannot contaminate the baseline artifacts or each other.
 */
export type CollectorPhase = 'baseline' | 'mutating';

/** A collector paired with the phase that decides when and how it runs. */
export interface CollectorDescriptor {
  readonly name: string;
  readonly phase: CollectorPhase;
  readonly fn: Collector;
}

// ============================================================================
// Churn/evidence artifact shapes — written only on the evidence branch
// (unsettled capture), by `settle.ts`/`snapshot.ts`.
// ============================================================================

/** One `churn.json` region — grouped mutation or animation evidence for one distinct source. */
export interface ChurnRegionRecord {
  readonly id: string;
  readonly selector?: string;
  readonly reason?: string;
  readonly mutationCount: number;
  readonly firstMutationAtMs?: number;
  readonly lastMutationAtMs?: number;
}

/** `churn.json`'s on-disk shape — written only when a snap did NOT settle. */
export interface ChurnReport {
  readonly settled: false;
  readonly settleTimeoutMs: number;
  readonly elapsedMs: number;
  /** Count of mutations actually kept (bounded by the churn observer's 200-record cap) — `regions[].mutationCount` sums to this, not to the true observed total. */
  readonly totalMutations: number;
  readonly resizeCount: number;
  /** Present (with the dropped count) only when the churn observer's 200-record cap was hit — the observer counted more raw mutations than it kept, so `totalMutations`/`regions` reflect the capped set, not every mutation the page produced (I-5). Absent when nothing was dropped. */
  readonly mutationsTruncated?: number;
  readonly regions: readonly ChurnRegionRecord[];
}

/** One entry in `document.getAnimations()`'s inventory. */
export interface AnimationEvidenceRecord {
  readonly selector: string | null;
  readonly animationName: string | null;
  readonly durationMs: number | null;
  readonly iterationCount: number | 'infinite' | null;
  readonly infinite: boolean;
  readonly playState: string;
}

/** `animation.json`'s on-disk shape when written as evidence (unsettled, not captured). */
export interface AnimationEvidence {
  readonly animations: readonly AnimationEvidenceRecord[];
  readonly infiniteCount: number;
}
