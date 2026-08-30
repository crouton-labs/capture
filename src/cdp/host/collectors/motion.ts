/**
 * The motion collector runs inside the collector host's single tab-level CDP
 * connection. Its lifecycle enables the motion domains, starts screencast and
 * tracing, injects observers, records marked dispatches, flushes the session
 * HAR, and drains the recording on host stop.
 *
 * Frames land as PNGs under `{recDir}/frames/`; per-frame element rects append
 * to `{recDir}/rects.jsonl`; trace batches, observer entries, input landmarks,
 * and best-effort errors append to `{recDir}/events.jsonl` through the private
 * artifact helpers.
 *
 * Navigation destroys the page's JS world and injected observers. `Tracing`
 * continues across it because it is CDP-session-scoped, while the collector
 * listens for `Page.frameNavigated` on the main frame and re-creates the
 * isolated world + re-injects the observer script best-effort afterward (the
 * binding, scoped to the world name, auto-reattaches to the recreated world
 * without being re-issued). It also restarts the screencast because its
 * damage-driven stream does not guarantee a destination-document frame,
 * recording a `navigation-gap` marker in `events.jsonl` so downstream
 * consumers know the Mutation/Resize/PerformanceObserver stream has a gap
 * around that point.
 *
 * Binding channel: the page→host `Runtime.addBinding` channel is untrusted
 * input — every payload must carry a per-recording unguessable nonce
 * (embedded in the injected script's closure), is whitelisted by `kind` and
 * field, and is length/size/rate-capped; anything else is dropped and
 * tallied into a `binding-dropped` summary event rather than trusted or
 * written verbatim.
 *
 * Rect sampling: the per-frame `Runtime.evaluate` element-rect result is the same
 * hostile-page threat class as the binding channel, via a different path — the
 * host re-validates it (element-count cap, finite-coordinate checks, tag/id/class
 * string caps, and a total serialized-byte budget) before it ever reaches
 * `rects.jsonl`, tallying anything dropped/truncated into a `rect-sample-dropped`
 * summary event rather than trusting the in-page cap alone. Each frame's rect
 * elements, and each `resize` binding event's targets, carry a real `backendNodeId`
 * (I-3), resolved via a nonce-scoped follow-up CDP bridge: the by-value rect/resize
 * data is read by one `Runtime.evaluate`, then a SECOND `Runtime.evaluate` drains the
 * same elements (stashed page-side into a nonce-scoped queue keyed by frame index or a
 * page-assigned `seq`) as held remote objects and bridges each to a `backendNodeId`
 * via `resolveIndexedObjectIds`/`describeBackendNodeId` (the same identity-bridge
 * primitives `geometry.ts`/`hittest.ts` use), capped per-frame/per-event to bound
 * CDP round-trip cost. Any element whose identity did not resolve or was capped
 * carries `backendNodeId: null, identityUnresolved: true` — never a fabricated or
 * omitted backendNodeId. The ENTIRE injected observer script (MutationObserver/
 * ResizeObserver/PerformanceObserver plus the rect/resize stash-and-drain queues) runs
 * inside a CDP isolated execution world (`Page.createIsolatedWorld`), a JS global scope
 * page main-world code cannot enumerate, read, or monkey-patch — only the DOM itself,
 * not JS globals, is shared between worlds. This closes the page-tamperable identity
 * handoff for both the rect and resize paths with one mechanism: `Runtime.addBinding`
 * is scoped to the nonce-named isolated world via `executionContextName`, so
 * `window.captureRecorderEmit` exists ONLY inside that world (never the page main world,
 * which can therefore neither detect nor call it) and auto-reattaches to the world each
 * time it is recreated after navigation. `emit()`'s `window[BINDING](...)` calls from
 * inside the isolated world reach the host; the host additionally rejects any
 * `Runtime.bindingCalled` not originating from the active isolated context before it
 * touches the shared rate budget.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CDPClient } from '../../client.js';
import { enableDomainsForMotionRec } from '../../domains.js';
import { readTraceClockBaseline, withDocumentPerformanceNow } from '../../timing.js';
import { EventBroker } from '../../bridge/server.js';
import { ensurePrivateDir, appendNdjsonPrivate, removeArtifactTree, writeBinaryPrivate, writeJsonPrivate } from '../../../session/artifacts.js';
import { resolveIndexedObjectIds, describeBackendNodeId } from '../../measure/collectors/geometry.js';
import { HARRecorder } from '../../har-recorder.js';
import { appendToHarRecording } from '../../../har-manager.js';
import { RetainedCollectorStartFailure, type Collector, type CollectorContext, type DrainCause, type DrainOutcome, type DispatchNotice, type DispatchOutcome } from '../collector.js';

export interface RecorderClockBaselines {
  performanceNowMs: number;
  wallClockMs: number;
  firstScreencastTimestampSec: number | null;
  firstTraceEventTsUs: number | null;
  baselinesPending: boolean;
}

interface RecCdpRequest extends RecCdpCall { reqId: number; }

/**
 * The subset of `RecCdpRequest` that `RecorderSession.handleCdp` actually reads. The one-shot
 * `rec --do` lane (`commands/motion/rec.ts`'s `recorderLiveClient`) drives `handleCdp` in-proc —
 * genuinely socket-less, intentionally ungated (the nonce gate lives on the wire in
 * `runRecorderBridge`'s `handleLine`, which that lane never touches) — so it has no
 * `reqId`/`type`/`nonce` envelope to supply. This type lets that lane's call sites stay honestly
 * typed without fabricating envelope fields `handleCdp` never reads, while the wire lane
 * (`handleRecorderRequest`) keeps passing a full `RecCdpRequest` unchanged.
 */
export interface RecCdpCall {
  method?: string;
  params?: Record<string, unknown>;
  mark?: string;
  waitEvent?: string;
  timeoutMs?: number;
  /** Retains Document `Network.responseReceived` facts until this request's paired wait settles. */
  observeDocumentResponse?: boolean;
}

// ---------------------------------------------------------------------------
// Artifact record shapes
// ---------------------------------------------------------------------------

export interface SampledRect {
  /** Descriptive label only — the cross-artifact join key is {@link backendNodeId}. */
  tag: string;
  id: string | null;
  classes: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The cross-artifact join key, resolved via `DOM.describeNode` off this element's bridged CDP
   * objectId (see `RecorderSession.resolveRectIdentity`) — `null` only when identity resolution
   * failed or was capped for this frame (see {@link identityUnresolved}). */
  backendNodeId: number | null;
  /** `true` when {@link backendNodeId} is `null` because identity resolution failed, was
   * unavailable, or was capped by `MAX_RECT_IDENTITY_RESOLUTIONS` for this frame — never omit
   * this alongside a `null` backendNodeId. Absent (not `false`) when identity resolved. */
  identityUnresolved?: true;
}

/**
 * One line of `rects.jsonl` — element rects sampled at one screencast frame.
 *
 * These are `getBoundingClientRect()` values, not CDP quads: a single axis-aligned box per
 * element, with no transform decomposition, clip-path/overflow clipping, or iframe/shadow-root
 * coordinate stitching. Downstream consumers (`motion timeline` and friends) must present this
 * as bounding-box geometry, not quad-accurate geometry — quad-accurate geometry
 * (`DOM.getContentQuads`, frame/shadow stitching) is `measure snap`'s `geometry.json`, a
 * separate substrate this recorder does not produce.
 */
export interface FrameCssToDeviceTransform {
  /** Exact per-frame scale from top visual viewport CSS pixels to PNG device pixels. */
  scaleX: number;
  scaleY: number;
  /** The page-reported device-pixel ratio, retained independently of raster scale. */
  devicePixelRatio: number;
}

export interface FrameRectsRecord {
  frame: number;
  file: string;
  /** Per-frame CSS-to-device transform used by motion-mask DOM joins. */
  cssToDevice: FrameCssToDeviceTransform | null;
  /** `Page.screencastFrame`'s own `metadata.timestamp` (wall-clock seconds), raw — not baseline-converted. */
  screencastTimestamp: number | null;
  /**
   * Honesty label for `screencastTimestamp`: it is `Page.screencastFrame.metadata.timestamp`, a
   * wall-clock seconds value whose effective precision is bounded by the screencast frame cadence
   * (≈±1 frame) — NOT a sub-ms exact instrument reading, and not baseline-converted.
   */
  screencastTimestampPrecision: 'frame-metadata';
  recordedAtWallClockMs: number;
  elements: SampledRect[];
  /** The sampler reached its element cap before examining every remaining DOM candidate. */
  elementSampleTruncated?: true;
  /** The sampler exhausted its geometry-read budget while DOM candidates remained. */
  candidateSampleTruncated?: true;
}

/**
 * One line of `events.jsonl`. `kind` is `'input'` for a marked CDP
 * dispatch, `'trace'` for a `Tracing.dataCollected` batch, `'error'` for a
 * best-effort recorder failure, or one of the injected observer's own kinds
 * (`'mutation'` / `'resize'` / `'performance'`) — those carry whatever
 * fields the in-page emitter sent, hence the index signature.
 */
export interface RecorderEventRecord {
  kind: string;
  recordedAtWallClockMs: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// RecorderSession — the CDP driving + artifact-writing core, injectable for
// tests (accepts anything shaped like the public surface of `CDPClient`).
// ---------------------------------------------------------------------------

export type RecorderCdpClient = Pick<CDPClient, 'send' | 'on' | 'off' | 'onDisconnect' | 'close'>;

/**
 * `'starting'` covers `start()`'s initialization window — from the top of `start()` until the
 * observer is installed in the latest main-frame context and the streams are live. It exists so a
 * main-frame navigation arriving mid-initialization is handled (the isolated world is recreated and
 * the observer reinstalled in the newest context) instead of leaving `start()` bound to a destroyed
 * world. `'stopping'` covers the whole `stop()` teardown window: it flips at the very top of
 * `stop()` before any await, so every state-sensitive guard (`handleFrameNavigated`, `handleCdp`)
 * stops treating an in-flight stop as still `'recording'`. `'stopped'` is only reached once teardown
 * fully completes.
 */
export type RecorderState = 'idle' | 'starting' | 'recording' | 'stopping' | 'stopped';

export interface RecorderSessionOptions {
  client: RecorderCdpClient;
  /** Absolute path to `motion/recs/{recId}` — must resolve under `CAPTURE_ROOT`. */
  recDir: string;
}

export interface RecorderStopSummary {
  frameCount: number;
  eventCount: number;
  durationMs: number;
  /** The clock baselines re-read at stop time — the flush path (see `RecorderClockBaselines`). */
  markers: RecorderClockBaselines;
}

const RECORDER_BINDING_NAME = 'captureRecorderEmit';

/** The in-page observer script returns this sentinel from its injection IIFE once every observer
 * is wired and the nonce-scoped bridge global is installed. `injectObserverScript` requires it
 * (alongside an absent `exceptionDetails`) before publishing the world's context id — a
 * `Runtime.evaluate` whose JS throws resolves with `exceptionDetails` instead of rejecting, and an
 * install that silently no-ops returns something else, so neither is ever mistaken for a live
 * bridge behind a usable-looking context id. */
export const OBSERVER_INSTALLED_SENTINEL = '__captureRecorderInstalled__';

const TRACE_CATEGORIES =
  'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,loading,blink.user_timing';
const SCREENCAST_OPTIONS = { format: 'png', everyNthFrame: 1 };

interface ScreencastFrameParams {
  data: string;
  metadata?: { timestamp?: number; [key: string]: unknown };
  sessionId?: number;
}

// ---------------------------------------------------------------------------
// Binding-channel hardening — every `Runtime.bindingCalled` payload
// is untrusted page-controlled input: it must carry this recording's nonce,
// its `kind` must be one of the observer's own emitted kinds, its fields are
// schema-validated without rewriting admitted strings or arrays, and the channel itself is rate-limited. Anything
// that fails a check is dropped (never parsed further/written) and tallied
// for a single summarizing `binding-dropped` event per reason at `rec-stop`.
// ---------------------------------------------------------------------------

/** Raw `payload` string length cap — checked before `JSON.parse`, so an oversized payload is never even parsed. */
const MAX_BINDING_PAYLOAD_BYTES = 8 * 1024;
const BINDING_RATE_LIMIT_PER_SECOND = 200;

// ---------------------------------------------------------------------------
// Rect-sampling hardening — `sampleRects()`'s `Runtime.evaluate` result is the SAME
// hostile-page threat class as the binding channel above, via a different path: it is
// page-controlled DOM data (element tag/id/className strings, and an array length) read in the
// isolated world and returned once per screencast frame, so it must be re-validated host-side
// rather than trusted because the injected script capped it. The in-page cap
// (`buildSampleRectsExpression`'s `max = 4000`) is an optimization only — a hostile page can
// corrupt or bypass in-page JS (e.g. clobbering `Array.prototype` before the script runs),
// so every one of these limits is re-enforced here, on the host, before a sample is ever
// appended to `rects.jsonl`.
// ---------------------------------------------------------------------------

/** Mirrors the in-page cap, re-enforced host-side regardless of what the page script actually returned. */
const MAX_RECT_ELEMENTS = 4000;
/** Bounds per-frame `getBoundingClientRect()` calls; one TreeWalker sentinel read establishes whether unvisited candidates remain. */
const MAX_RECT_GEOMETRY_CANDIDATES = 8000;
const MAX_RECT_TAG_LENGTH = 32;
const MAX_RECT_STRING_LENGTH = 256;
/** Total serialized-byte budget for one frame's sanitized rect array, independent of the element-count cap. */
const MAX_RECTS_SERIALIZED_BYTES = 1024 * 1024;
/** Bounds per-frame `DOM.describeNode` round-trip cost for the rect sampler's identity bridge —
 * mirrors `hittest.ts`'s `MAX_BRIDGE_ELEMENTS` cap, tuned far lower because this bridge runs on
 * EVERY screencast frame instead of once per snapshot. Elements past this cap are left
 * `identityUnresolved: true` rather than uncapping per-frame CDP cost. */
const MAX_RECT_IDENTITY_RESOLUTIONS = 300;

/** Collects every remote-object handle materialized anywhere in a CDP response. A
 * `Runtime.getProperties` response can carry handles outside numeric property values, including
 * accessor, symbol, private-property, and `[[Prototype]]` descriptors; all belong to this property
 * walk and must be released along with the indexed element handles. */
function collectRemoteObjectIds(value: unknown, objectIds: Set<string>, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (key === 'objectId' && typeof child === 'string') objectIds.add(child);
    else collectRemoteObjectIds(child, objectIds, seen);
  }
}

/**
 * Rect-identity variant of `geometry.ts`'s `resolveIndexedObjectIds`: returns the capped indexed
 * element handles `resolveRectIdentity` describes plus every remote-object handle materialized by
 * `Runtime.getProperties`. The caller releases the complete handle set, while `resolveCount`
 * independently bounds the `DOM.describeNode` follow-ups.
 */
async function resolveCappedRectObjectIds(
  client: CDPClient,
  arrayObjectId: string,
  resolveCount: number,
): Promise<{ objectIds: Array<string | undefined>; allMaterializedObjectIds: string[] }> {
  const objectIds = new Array<string | undefined>(resolveCount).fill(undefined);
  const propsResult = (await client.send('Runtime.getProperties', {
    objectId: arrayObjectId,
    ownProperties: true,
  })) as { result?: Array<{ name: string; value?: { objectId?: string } }> };
  const allMaterializedObjectIds = new Set<string>();
  collectRemoteObjectIds(propsResult, allMaterializedObjectIds);
  for (const prop of propsResult.result ?? []) {
    if (!/^\d+$/.test(prop.name)) continue;
    const objectId = prop.value?.objectId;
    if (!objectId) continue;
    const idx = Number(prop.name);
    if (idx >= 0 && idx < resolveCount) objectIds[idx] = objectId;
  }
  return { objectIds, allMaterializedObjectIds: [...allMaterializedObjectIds] };
}

// ---------------------------------------------------------------------------
// Trace-batch bounds — trace events are preserved as received. Their exact
// JSON encoding sizes enforce event-count and serialized-byte caps without
// deleting individual fields such as `args`, URLs, or names.
// ---------------------------------------------------------------------------

const MAX_TRACE_EVENTS_PER_BATCH = 500;
const MAX_TRACE_SERIALIZED_BYTES = 256 * 1024;

type BindingFieldSanitizer = (value: unknown) => unknown;

function sanitizeFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sanitizeRectString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function sanitizeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function sanitizeElementSampleTruncated(value: unknown): true | undefined {
  return value === true ? true : undefined;
}

/** Preserves an admitted observer string verbatim in its source artifact. */
function preserveObserverString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function preserveObserverStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return undefined;
  return value as string[];
}

function preserveResizeTargets(value: unknown): Array<{ tag?: string; width?: number; height?: number }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Array<{ tag?: string; width?: number; height?: number }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return undefined;
    const record = item as Record<string, unknown>;
    const target: { tag?: string; width?: number; height?: number } = {};
    const tag = preserveObserverString(record.tag);
    const width = sanitizeFiniteNumber(record.width);
    const height = sanitizeFiniteNumber(record.height);
    if (tag !== undefined) target.tag = tag;
    if (width !== undefined) target.width = width;
    if (height !== undefined) target.height = height;
    out.push(target);
  }
  return out;
}

/**
 * Whitelisted `kind` values the page-side observer script may emit, and the field-by-field
 * sanitizer for each. A `kind` not present here (including the host-only kinds `input`, `trace`,
 * `error`, `navigation-gap`, `binding-dropped`, which this channel must never be able to forge)
 * is dropped outright.
 */
const BINDING_FIELD_SANITIZERS: Record<string, Record<string, BindingFieldSanitizer>> = {
  mutation: {
    count: sanitizeFiniteNumber,
    types: preserveObserverStringArray,
  },
  resize: {
    count: sanitizeFiniteNumber,
    targets: preserveResizeTargets,
    seq: sanitizeFiniteNumber,
  },
  performance: {
    entryType: preserveObserverString,
    name: preserveObserverString,
    startTime: sanitizeFiniteNumber,
    duration: sanitizeFiniteNumber,
    value: sanitizeFiniteNumber,
    hadRecentInput: sanitizeBoolean,
  },
};

/**
 * `domains.ts`/`timing.ts` declare their parameter as the concrete
 * `CDPClient` class (private-field members, so TS won't structurally
 * accept a plain stub there); both only ever call `.send()` on it (see
 * their own doc comments), so this cast is the deliberate, documented seam
 * that keeps `RecorderSession` testable with a stub client while still
 * reusing those shared helpers unchanged.
 */
function asCDPClient(client: RecorderCdpClient): CDPClient {
  return client as unknown as CDPClient;
}

function structuralMarkLabel(action: string): string {
  return `mark-${crypto.createHash('sha256').update(action).digest('hex')}`;
}

export class RecorderSession {
  readonly recDir: string;
  readonly framesDir: string;
  readonly eventsPath: string;
  readonly rectsPath: string;
  state: RecorderState = 'idle';

  private client: RecorderCdpClient;
  private events: EventBroker;
  private frameCount = 0;
  private eventCount = 0;
  private startedAtWallClockMs = 0;
  /** Per-recording unguessable token, embedded in the injected observer script's closure and required on every `Runtime.bindingCalled` payload — see the binding-hardening helpers above. */
  private readonly bindingNonce = crypto.randomBytes(16).toString('hex');
  /** The CDP isolated world's `worldName`, derived from the nonce. The binding is scoped to this
   * name via `Runtime.addBinding({ executionContextName })`, and every `Page.createIsolatedWorld`
   * (initial + per-navigation) creates a world of this name — so the binding auto-attaches to the
   * recreated world after navigation without being re-issued, and is never exposed to the page main
   * world. */
  private readonly isolatedWorldName = `captureRecorder_${this.bindingNonce}`;
  private baselines: RecorderClockBaselines | null = null;
  /** Screencast-frame handling in flight, tracked so `stop()` can await every write/rect-sample before returning. Each promise removes itself on settle. */
  private pendingFrames = new Set<Promise<void>>();
  /** Post-navigation re-arms in flight, tracked so `stop()` can await ALL of them before tearing down — mirrors `pendingFrames` below: each `Page.frameNavigated` handler adds its own rearm promise here and removes only that promise on settle, so two overlapping rearms (a second navigation firing while the first rearm's `Runtime.evaluate` is still pending) are both awaited by `stop()` rather than one clobbering the other. */
  private pendingRearm = new Set<Promise<void>>();
  /** Resize-target identity-bridge follow-up calls in flight, tracked so `stop()` can await every
   * one before tearing down the observer script — mirrors `pendingFrames`/`pendingRearm`. Each
   * promise removes itself on settle. */
  private pendingBindingResolution = new Set<Promise<void>>();
  /** Flips to `false` right after `Page.stopScreencast` is issued in `stop()`; a screencast frame event arriving after that is ignored rather than starting new frame work. */
  private acceptingFrames = true;
  private bindingDropCounts = new Map<string, number>();
  private bindingWindowStartedAtMs = 0;
  private bindingWindowCount = 0;
  /** Tallies of rect-sample elements dropped/truncated by host-side sanitization, by reason — flushed as `rect-sample-dropped` summary events at stop(), same style as `bindingDropCounts`. */
  private rectDropCounts = new Map<string, number>();
  /** Tallies of trace events dropped/truncated by host-side sanitization, by reason — flushed as `trace-dropped` summary events at stop(), same style as `rectDropCounts`. */
  private traceDropCounts = new Map<string, number>();
  /** The main frame's CDP `frameId`, resolved once via `Page.getFrameTree` on the first
   * `injectObserverScript()` call, then kept current from `Page.frameNavigated`'s own `frame.id`
   * on every subsequent rearm — avoids one `Page.getFrameTree` round trip per navigation. */
  private mainFrameId: string | undefined;
  /** The isolated world's `Runtime.evaluate` `contextId`, (re-)created by every
   * `injectObserverScript()` call — every OTHER evaluate that touches the bridge
   * (`sampleRects`, `resolveRectIdentity`, `resolveAndAppendResizeIdentity`, the stop-time
   * teardown call) must scope itself to this same context, never create its own world. */
  private isolatedWorldContextId: number | undefined;
  /** Monotonic main-frame navigation counter, incremented on every main-frame `Page.frameNavigated`
   * (and read as the generation the initial `start()` injection installs for). `injectObserverScript`
   * stamps the generation it is installing for and publishes its context id only if no newer
   * navigation has superseded it — so `isolatedWorldContextId` always tracks the latest document's
   * world, never a stale one from a navigation that has already been overtaken. */
  private navGeneration = 0;
  /** The navGeneration whose isolated-world context is currently published in
   * `isolatedWorldContextId`. `undefined` whenever no live world is active — before the first
   * install, and from the moment a navigation destroys the old world until a rearm republishes.
   * Lets `start()` and the bridge evaluates tell "the latest navigation actually installed a
   * world" apart from "a rearm merely settled". */
  private activeWorldGeneration: number | undefined;
  /** Flips to `true` immediately before the final `flushPendingBindingResolutions()` drain in
   * `stop()`, closing acceptance of NEW resize-identity resolvers — see `handleBindingCalled`'s
   * `kind === 'resize'` branch. Mutation/performance/input events are intentionally still
   * captured throughout the rest of `'stopping'`; only the async resize path is a real
   * post-stop-append race target. */
  private resizeResolutionClosed = false;
  private screencastRefresh = Promise.resolve();

  constructor(opts: RecorderSessionOptions) {
    this.client = opts.client;
    this.recDir = ensurePrivateDir(opts.recDir);
    this.framesDir = ensurePrivateDir(path.join(this.recDir, 'frames'));
    this.eventsPath = path.join(this.recDir, 'events.jsonl');
    this.rectsPath = path.join(this.recDir, 'rects.jsonl');
    this.events = new EventBroker(this.client);
  }

  async start(): Promise<RecorderClockBaselines> {
    if (this.state !== 'idle') {
      throw new Error(`recorder cannot start from state "${this.state}"`);
    }
    // Enter 'starting' before any await so the `Page.frameNavigated` listener registered below
    // treats a navigation during initialization as live — recreating the isolated world and
    // reinstalling the observer in the newest context rather than ignoring it.
    this.state = 'starting';
    let screencastMayBeStarted = false;
    let tracingMayBeStarted = false;

    try {
      await enableDomainsForMotionRec(asCDPClient(this.client));

      this.client.on('Page.screencastFrame', (params) => {
        this.onScreencastFrameEvent(params as ScreencastFrameParams);
      });
      this.client.on('Tracing.dataCollected', (params) => {
        this.handleTraceData(params as { value: unknown[] });
      });
      this.client.on('Runtime.bindingCalled', (params) => {
        this.handleBindingCalled(params as { name: string; payload: string; executionContextId?: number });
      });
      this.client.on('Page.frameNavigated', (params) => {
        const rearm = this.handleFrameNavigated(params as { frame?: { id?: string; parentId?: string; url?: string } });
        this.pendingRearm.add(rearm);
        void rearm.finally(() => {
          this.pendingRearm.delete(rearm);
        });
      });

      await this.ensureBinding();
      await this.injectObserverScript(this.navGeneration);

      // The first-frame/first-trace latch storage MUST exist before either stream is started:
      // `Page.screencastFrame`/`Tracing.dataCollected` can only fire after `Page.startScreencast`/
      // `Tracing.start` are issued, so reading the (performanceNowMs, wallClockMs) anchor and
      // creating `this.baselines` here — before those two sends — closes the window where a
      // frame/trace arriving immediately after the stream starts would otherwise hit
      // `this.baselines === null` in the handler and have its real first timestamp discarded.
      const clock = await readTraceClockBaseline(asCDPClient(this.client));
      this.baselines = {
        performanceNowMs: clock.performanceNowMs,
        wallClockMs: clock.wallClockMs,
        firstScreencastTimestampSec: null,
        firstTraceEventTsUs: null,
        baselinesPending: true,
      };

      // Capture the generation before issuing the initial request: a navigation that starts while
      // this request is in flight needs one refresh after the initial stream is owned.
      const initialScreencastGeneration = this.navGeneration;
      screencastMayBeStarted = true;
      await this.client.send('Page.startScreencast', SCREENCAST_OPTIONS);
      tracingMayBeStarted = true;
      await this.client.send('Tracing.start', { transferMode: 'ReportEvents', categories: TRACE_CATEGORIES });

      // A main-frame navigation anywhere in the initialization window above spawned a rearm that
      // recreated the isolated world in the newest context; wait for every one to settle so start()
      // never returns with the bridge bound to a world a startup navigation already destroyed.
      await this.drainPendingRearms();

      // Coalesce every startup navigation after the initial stream into its latest generation. A
      // navigation can land while the refresh's stop request is in flight, so drain and retry the
      // latest generation until one refresh completes without being superseded.
      while (this.navGeneration > initialScreencastGeneration) {
        const refreshGeneration = this.navGeneration;
        this.requireLatestObserverGeneration();
        await this.refreshScreencast(refreshGeneration);
        await this.drainPendingRearms();
        if (this.navGeneration === refreshGeneration) break;
      }
      this.requireLatestObserverGeneration();

      this.startedAtWallClockMs = Date.now();
      this.state = 'recording';
      return { ...this.baselines };
    } catch (err) {
      this.acceptingFrames = false;
      const cleanupErrors: unknown[] = [];
      if (screencastMayBeStarted) {
        try {
          await this.client.send('Page.stopScreencast');
        } catch (cleanupErr) {
          cleanupErrors.push(cleanupErr);
        }
      }
      if (tracingMayBeStarted) {
        try {
          await this.client.send('Tracing.end');
        } catch (cleanupErr) {
          cleanupErrors.push(cleanupErr);
        }
      }
      this.state = 'stopped';
      if (cleanupErrors.length > 0) {
        const message = err instanceof Error ? err.message : String(err);
        throw new AggregateError([err, ...cleanupErrors], `recorder start failed: ${message}; stream cleanup failed`);
      }
      throw err;
    }
  }

  /**
   * Handles a `type: 'cdp'` request — plain passthrough, or bracketed +
   * logged as a labeled input landmark in `events.jsonl` when `mark` is set
   * (the mark never touches the page — see `../timing.ts`'s
   * `withDocumentPerformanceNow`), or a wait-event-ONLY request when
   * `method` is omitted. Rejects outright once the recorder has left
   * `'recording'` (i.e. is `'stopping'` or `'stopped'`) rather than dispatching
   * against a connection that is mid-teardown.
   *
   * `req` arrives as parsed-JSON cast to `RecCdpRequest` (the wire lane, via
   * `handleRecorderRequest`) or as a bare `RecCdpCall` (the one-shot `rec
   * --do` lane in `commands/motion/rec.ts`, which drives this method in-proc
   * — genuinely socket-less, with no `reqId`/`type`/`nonce` to supply and
   * nothing here to fabricate: the nonce gate lives on the wire in
   * `runRecorderBridge`'s `handleLine`, which that lane never touches).
   * Neither shape is validated at parse time, so the type-level guarantee
   * that `RecCdpWaitEventRequest` always carries a nonempty string
   * `waitEvent` is NOT enforced at runtime. Validate here, before any
   * dispatch: a request must carry EITHER a nonempty string `method`
   * (dispatch, optionally awaiting `waitEvent` too) OR a nonempty string
   * `waitEvent` (wait-event-only) — anything else (both absent, or a
   * present-but-empty/non-string field) is an explicit protocol error, not a
   * silent no-op "ok" response.
   *
   * Method result and wait outcome are SEPARATE. When a request carries both a
   * `method` and a `waitEvent`, a successful method dispatch is never undone by
   * the paired wait's own timeout: the wait is armed before the send (so a fast
   * action-caused event cannot be missed), and if it later times out the method
   * `result` (e.g. `Page.navigate`'s `loaderId`) is still returned, tagged
   * `waitOutcome: 'bounded-timeout'` with no `event`; when the event is observed
   * the outcome is `'observed'` with the `event`. Only a method dispatch
   * FAILURE cancels the wait and throws. A wait-event-ONLY request (no method)
   * that times out still rejects — there is no method result to preserve.
   */
  async handleCdp(req: RecCdpRequest | RecCdpCall): Promise<{ result?: unknown; event?: unknown; waitOutcome?: 'observed' | 'bounded-timeout'; documentResponse?: { status: number; url: string } }> {
    if (this.state === 'stopping' || this.state === 'stopped') {
      throw new Error(`cannot dispatch cdp request in state "${this.state}"`);
    }
    const hasMethod = typeof req.method === 'string' && req.method.length > 0;
    const hasWaitEvent = typeof req.waitEvent === 'string' && req.waitEvent.length > 0;
    if (req.method === 'Capture.collectStyleSheetHeaders') {
      return { result: await this.collectStyleSheetHeaders() };
    }
    if (!hasMethod && !hasWaitEvent) {
      throw new Error(
        'Invalid cdp request: requires a nonempty string "method" (to dispatch) or "waitEvent" (to wait only) — got neither.',
      );
    }

    // This recorder owns a direct tab websocket, so its actual CDP event
    // envelope scope is `undefined` (there is no flattened attach session).
    // Arm synchronously before any triggering send below.
    const documentResponses: Array<{ loaderId: string; status: number; url: string }> = [];
    const onDocumentResponse = req.observeDocumentResponse ? (params: unknown) => {
      if (!params || typeof params !== 'object' || Array.isArray(params)) return;
      const event = params as { type?: unknown; loaderId?: unknown; response?: unknown };
      if (event.type !== 'Document' || typeof event.loaderId !== 'string' || !event.response || typeof event.response !== 'object' || Array.isArray(event.response)) return;
      const response = event.response as { status?: unknown; url?: unknown };
      if (typeof response.status !== 'number' || !Number.isFinite(response.status) || typeof response.url !== 'string') return;
      documentResponses.push({ loaderId: event.loaderId, status: response.status, url: response.url });
    } : undefined;
    if (onDocumentResponse) this.client.on('Network.responseReceived', onDocumentResponse);
    const eventWait = hasWaitEvent
      ? this.events.wait(req.waitEvent as string, undefined, req.timeoutMs ?? 10000)
      : undefined;

    try {
      if (!hasMethod) {
        // Wait-event-ONLY request (`RecCdpWaitEventRequest`) — there is no CDP
        // call to dispatch, so `client.send` must never be reached here (it
        // would otherwise send `method: undefined` over the real websocket). A
        // timeout here rejects (no method result to preserve).
        const event = eventWait ? await eventWait.result() : undefined;
        return { event };
      }

      let result: unknown;
      if (req.mark) {
        const internalMark = structuralMarkLabel(req.mark);
        const bracket = await withDocumentPerformanceNow(asCDPClient(this.client), () =>
          this.client.send(req.method!, req.params ?? {}, req.timeoutMs ?? 60000),
        );
        this.appendEvent({
          kind: 'input',
          action: req.mark,
          mark: internalMark,
          method: req.method,
          startPerformanceNow: bracket.startPerformanceNow,
          endPerformanceNow: bracket.endPerformanceNow,
        });
        result = bracket.result;
      } else {
        // `hasMethod` above already proved `req.method` is a nonempty string for this branch
        // (mirrors the `req.method!` a few lines up in the `req.mark` branch); widening
        // `handleCdp`'s parameter to accept the in-proc `RecCdpCall` shape too (see that type's
        // doc comment) adds a third union member whose `method` is independently optional, which
        // is enough to stop TS's aliased-condition narrowing from collapsing `req.method` to
        // `string` here on its own.
        result = await this.client.send(req.method!, req.params ?? {}, req.timeoutMs ?? 60000);
      }

      // The method dispatch succeeded. Resolve the paired wait WITHOUT letting
      // its own timeout destroy the method result: an observed event tags
      // `'observed'`; the wait's bounded timer elapsing tags `'bounded-timeout'`
      // and preserves `result` with no `event`.
      const loaderId = (result as { loaderId?: unknown } | undefined)?.loaderId;
      const documentResponse = typeof loaderId === 'string'
        ? documentResponses.filter((response) => response.loaderId === loaderId).at(-1)
        : undefined;
      if (!eventWait) return { result, ...(documentResponse ? { documentResponse } : {}) };
      const settled = await eventWait.result().then(
        (event) => ({ event, waitOutcome: 'observed' as const }),
        () => ({ waitOutcome: 'bounded-timeout' as const }),
      );
      const settledDocumentResponse = typeof loaderId === 'string'
        ? documentResponses.filter((response) => response.loaderId === loaderId).at(-1)
        : undefined;
      return { result, ...settled, ...(settledDocumentResponse ? { documentResponse: settledDocumentResponse } : {}) };
    } catch (err) {
      eventWait?.cancel();
      throw err;
    } finally {
      if (onDocumentResponse) this.client.off('Network.responseReceived', onDocumentResponse);
    }
  }

  /** Records a host-routed marked dispatch without issuing a second CDP call. */
  recordRoutedDispatch(notice: DispatchNotice, outcome: DispatchOutcome): void {
    this.appendEvent({
      kind: 'input',
      action: notice.annotation,
      mark: structuralMarkLabel(notice.annotation ?? ''),
      method: notice.method,
      startPerformanceNow: notice.atPerformanceNowMs,
      endPerformanceNow: outcome.atPerformanceNowMs,
    });
  }

  /** Runs CSS header redelivery on the one connection that can receive its events while recording. */
  private async collectStyleSheetHeaders(): Promise<{ headers: Array<{ styleSheetId: string; sourceURL: string }> }> {
    const headers = new Map<string, string>();
    const handler = (params: unknown): void => {
      const header = (params as { header?: { styleSheetId?: unknown; sourceURL?: unknown } } | undefined)?.header;
      if (typeof header?.styleSheetId === 'string' && typeof header.sourceURL === 'string' && header.sourceURL.length > 0) headers.set(header.styleSheetId, header.sourceURL);
    };
    this.client.on('CSS.styleSheetAdded', handler);
    try {
      await this.client.send('CSS.disable');
      await this.client.send('CSS.enable');
      return { headers: [...headers].map(([styleSheetId, sourceURL]) => ({ styleSheetId, sourceURL })) };
    } finally {
      this.client.off('CSS.styleSheetAdded', handler);
    }
  }

  /** Synchronous admission cutoff used by the collector host before any drain awaits. */
  closeAdmission(): void {
    if (this.state === 'recording') this.state = 'stopping';
  }

  async stop(): Promise<RecorderStopSummary> {
    this.closeAdmission();
    return this.drain();
  }

  async drain(): Promise<RecorderStopSummary> {
    if (this.state !== 'stopping') {
      throw new Error(`cannot drain recorder in state "${this.state}"`);
    }
    // `closeAdmission()` flips state before any drain await, so every
    // state-sensitive guard (`handleFrameNavigated`, `handleCdp`) already sees the recorder
    // as no longer recording for the rest of this teardown.
    this.state = 'stopping';

    // Every rearm already committed to running at the exact recording/stopping boundary must
    // finish before teardown proceeds — otherwise it races the CDP sends below. There can be more
    // than one: two navigations firing while the first rearm's Runtime.evaluate is still pending
    // both land in `pendingRearm`, and every one of them must settle before teardown continues.
    await Promise.all(this.pendingRearm);

    try {
      await this.client.send('Page.stopScreencast');
    } catch {
      // Best-effort — the tab/browser may already be gone.
    }
    // No new screencast-frame work starts past this point; whatever was already
    // dispatched (including anything queued in the brief race window before this
    // flips) is awaited below instead of discarded.
    this.acceptingFrames = false;
    await this.flushPendingFrames();

    const tracingCompleteWait = this.events.wait('Tracing.tracingComplete', undefined, 5000);
    try {
      await this.client.send('Tracing.end');
      await tracingCompleteWait.result().catch(() => undefined);
    } catch {
      // Best-effort, including removal of the now-ownerless event wait.
      tracingCompleteWait.cancel();
    }

    // Every resize-target identity-bridge follow-up already committed to running must finish
    // before teardown removes the observer script it depends on. Closing acceptance immediately
    // before this quiescence drain guarantees the set can only shrink: existing work settles, and
    // later resize bindings are tallied as drops instead of spawning untracked append work.
    this.resizeResolutionClosed = true;
    await this.flushPendingBindingResolutions();

    // Skip the in-page teardown entirely when no isolated world is live (a navigation destroyed it
    // and no rearm republished) — the world's globals are already gone, and sending this evaluate
    // with an undefined contextId would run it in the page main world.
    if (this.isolatedWorldContextId !== undefined) {
      try {
        await this.client.send('Runtime.evaluate', {
          expression: `(function(){var k='__captureRecorder_'+${JSON.stringify(this.bindingNonce)};return window[k]&&window[k].teardown();})()`,
          contextId: this.requireIsolatedContextId(),
        });
      } catch {
        // Best-effort — the page may already be gone.
      }
    }
    try {
      await this.client.send('Runtime.removeBinding', { name: RECORDER_BINDING_NAME });
    } catch {
      // Best-effort.
    }

    this.flushBindingDropSummary();
    this.flushRectDropSummary();
    this.flushTraceDropSummary();

    this.state = 'stopped';
    const stoppedAtWallClockMs = Date.now();
    return {
      frameCount: this.frameCount,
      eventCount: this.eventCount,
      durationMs: stoppedAtWallClockMs - this.startedAtWallClockMs,
      // this.baselines is always set by the time stop() is reachable — start() sets it before
      // flipping state to 'recording', and stop() only runs from state 'recording'.
      markers: { ...this.baselines!, stoppedAtWallClockMs },
    };
  }

  /**
   * Adds the CDP binding once, called only from `start()`, scoped to this recording's isolated world
   * via `executionContextName` so `window.captureRecorderEmit` is exposed ONLY inside the nonce-named
   * world and is absent from the page main world — closing the page-observable/page-callable side
   * channel. The `executionContextName` form auto-attaches the binding to the world every time
   * `Page.createIsolatedWorld` recreates it under the same name (i.e. after navigation), so the
   * binding is never re-issued from the rearm path. Defensively idempotent: an "already
   * exists"-shaped error from the single call is swallowed rather than thrown.
   */
  private async ensureBinding(): Promise<void> {
    try {
      await this.client.send('Runtime.addBinding', {
        name: RECORDER_BINDING_NAME,
        executionContextName: this.isolatedWorldName,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/already exists/i.test(message)) throw err;
    }
  }

  /** The active isolated-world context id, or a thrown error when none is live — before the first
   * install, and from the moment a navigation destroys the world until a rearm republishes. Every
   * bridge-touching evaluate routes its `contextId` through this so it can never fall into the page
   * main world by sending an `undefined` contextId (CDP omits an undefined param, and
   * `Runtime.evaluate` with no contextId runs in the page main world). */
  private requireIsolatedContextId(): number {
    if (this.isolatedWorldContextId === undefined) {
      throw new Error('motion collector has no active isolated world context');
    }
    return this.isolatedWorldContextId;
  }

  /** Returns `this.mainFrameId` if already known; otherwise resolves it once via
   * `Page.getFrameTree`. Only the very first call (from `start()`, via `injectObserverScript()`)
   * hits `Page.getFrameTree` — every subsequent rearm already has `mainFrameId` set from
   * `Page.frameNavigated`'s own event (see `handleFrameNavigated`), so no extra CDP round trip
   * per navigation. */
  private async resolveMainFrameId(): Promise<string> {
    if (this.mainFrameId) return this.mainFrameId;
    const tree = (await this.client.send('Page.getFrameTree', {})) as { frameTree?: { frame?: { id?: string } } };
    const frameId = tree.frameTree?.frame?.id;
    if (!frameId) throw new Error('motion collector could not resolve the main frame id via Page.getFrameTree');
    this.mainFrameId = frameId;
    return frameId;
  }

  /**
   * (Re-)injects the observer script into a FRESH CDP isolated world of this recording's stable
   * `isolatedWorldName`, and publishes its execution context id as the active bridge context ONLY
   * after the in-page install is confirmed. Runs once from `start()` and again on every
   * post-navigation rearm — a navigation wipes the page's JS world and destroys the isolated world
   * along with it, so a fresh world must be created every time, never reused (the binding, scoped to
   * the world name, auto-reattaches — see `ensureBinding()`).
   *
   * `Runtime.evaluate` resolves (does NOT reject) when the injected JS throws, reporting it in
   * `exceptionDetails`; a script that installs cleanly returns `OBSERVER_INSTALLED_SENTINEL`. Both
   * are checked here: an install that throws or fails to confirm the sentinel is fatal (propagates)
   * and NO context id is published, so a failed install never leaves a usable-looking context with
   * no bridge behind it. A failed rearm surfaces as an `error` event via `handleFrameNavigated`'s
   * try/catch; a failed initial install aborts `start()`.
   *
   * `generation` is the navigation generation this install belongs to. The context id is published
   * only if no newer main-frame navigation has bumped `navGeneration` in the meantime, so
   * concurrent/overlapping rearms always leave `isolatedWorldContextId` pointing at the latest
   * document's world regardless of the order their evaluates complete.
   */
  private async injectObserverScript(generation: number): Promise<void> {
    const frameId = await this.resolveMainFrameId();
    const created = (await this.client.send('Page.createIsolatedWorld', {
      frameId,
      worldName: this.isolatedWorldName,
      grantUniveralAccess: false,
    })) as { executionContextId?: number };
    const contextId = created.executionContextId;
    if (typeof contextId !== 'number') {
      throw new Error('motion collector isolated world creation returned no execution context id');
    }
    const evaluation = (await this.client.send('Runtime.evaluate', {
      expression: buildObserverScript(RECORDER_BINDING_NAME, this.bindingNonce),
      contextId,
      returnByValue: true,
    })) as { result?: { value?: unknown }; exceptionDetails?: unknown };
    if (evaluation.exceptionDetails) {
      throw new Error(`recorder observer script install threw: ${JSON.stringify(evaluation.exceptionDetails)}`);
    }
    if (evaluation.result?.value !== OBSERVER_INSTALLED_SENTINEL) {
      throw new Error('recorder observer script install did not confirm the installed sentinel');
    }
    // Publish only if this install is still for the latest navigation generation — a newer
    // navigation that bumped navGeneration owns a fresher world and will publish its own id.
    // Both fields move together so `activeWorldGeneration` always names the generation whose
    // context is live in `isolatedWorldContextId`.
    if (generation === this.navGeneration) {
      this.isolatedWorldContextId = contextId;
      this.activeWorldGeneration = generation;
    }
  }

  /**
   * `Page.frameNavigated` handler: a main-frame navigation destroys the page's JS world, silently
   * dropping the injected observers (the binding itself survives — see `ensureBinding()`).
   * Recreates the isolated world, re-injects the observer script best-effort, and records a
   * `navigation-gap` marker so downstream consumers know the Mutation/Resize/PerformanceObserver
   * stream has a gap around this point (the binding, scoped to the world name, auto-reattaches to
   * the recreated world — see `ensureBinding()`). Every main-frame navigation bumps `navGeneration`,
   * so a rearm publishes its context id only if no newer navigation has overtaken it. Runs both
   * while `'recording'` and while `'starting'` (a navigation during `start()` initialization must
   * still land the observer in the newest context), but only a handler that began while recording
   * refreshes the screencast; start() owns the one deferred refresh for all startup navigations.
   * Sub-frame navigations (`frame.parentId` set)
   * don't affect the top document's world and are ignored. Bails once the recorder has left those
   * phases (`'stopping'`/`'stopped'`) so a navigation arriving mid-teardown doesn't start new CDP
   * work concurrent with it — `stop()` awaits every rearm still in flight at that boundary (tracked
   * in `pendingRearm`, which can hold more than one entry when navigations overlap).
   */
  private async handleFrameNavigated(params: { frame?: { id?: string; parentId?: string; url?: string } }): Promise<void> {
    if (this.state !== 'recording' && this.state !== 'starting') return;
    const frame = params.frame;
    if (!frame || frame.parentId) return;
    const refreshScreencast = this.state === 'recording';
    const generation = ++this.navGeneration;
    // The navigation destroyed the current isolated world; drop the now-dead context id
    // immediately so no bridge evaluate targets it while the rearm is in flight — or if the
    // rearm fails and never republishes.
    this.isolatedWorldContextId = undefined;
    this.activeWorldGeneration = undefined;
    if (frame.id) this.mainFrameId = frame.id;
    this.appendEvent({ kind: 'navigation-gap', url: preserveObserverString(frame.url) ?? null });
    let observerRearmed = false;
    try {
      await this.injectObserverScript(generation);
      observerRearmed = this.activeWorldGeneration === generation;
    } catch (err) {
      this.appendEvent({
        kind: 'error',
        message: `observer re-arm after navigation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    if (refreshScreencast && observerRearmed) {
      try {
        await this.refreshScreencast(generation);
      } catch (err) {
        this.appendEvent({
          kind: 'error',
          message: `screencast refresh after navigation failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  /** Rejects a refresh/start when the latest navigation did not publish a live observer world. */
  private requireLatestObserverGeneration(): void {
    if (this.isolatedWorldContextId === undefined || this.activeWorldGeneration !== this.navGeneration) {
      throw new Error('recorder start aborted: observer script was not installed in the latest main-frame context');
    }
  }

  private refreshScreencast(generation?: number): Promise<void> {
    const refresh = this.screencastRefresh.catch(() => {}).then(async () => {
      if (generation !== undefined && this.activeWorldGeneration !== generation) return;
      await this.client.send('Page.stopScreencast');
      // A second navigation may have destroyed the destination world while the stop was in
      // flight. Leave the stream stopped rather than starting it against a bridgeless/stale page;
      // its current generation owns the next serialized refresh after observer injection.
      if (generation !== undefined && this.activeWorldGeneration !== generation) return;
      await this.client.send('Page.startScreencast', SCREENCAST_OPTIONS);
    });
    this.screencastRefresh = refresh;
    return refresh;
  }

  private appendEvent(record: Omit<RecorderEventRecord, 'recordedAtWallClockMs'>): void {
    // Defense-in-depth: nothing may append once fully stopped. Scoped to `'stopped'` specifically,
    // NOT `'stopping'` — mutation/performance/trace/input events are intentionally still captured
    // throughout most of `'stopping'`. Every existing call to `appendEvent` from within `stop()`
    // itself (the drop-summary flushes) runs before `this.state = 'stopped'` is set, so this guard
    // never fires on a legitimate call.
    if (this.state === 'stopped') return;
    this.eventCount++;
    appendNdjsonPrivate(this.eventsPath, {
      ...record,
      recordedAtWallClockMs: Date.now(),
    } satisfies RecorderEventRecord);
  }

  /** `Page.screencastFrame` listener body: tracks the handler's promise so `stop()` can flush it, and stops admitting new frame work once `acceptingFrames` is false. */
  private onScreencastFrameEvent(params: ScreencastFrameParams): void {
    if (!this.acceptingFrames) return;
    const handled = this.handleScreencastFrame(params);
    this.pendingFrames.add(handled);
    void handled.finally(() => {
      this.pendingFrames.delete(handled);
    });
  }

  /** Drains every in-flight post-navigation rearm, looping because a rearm can itself spawn while
   * the set is being awaited (a navigation firing during another rearm). `start()` uses it to
   * guarantee the observer is installed in the latest context before recording begins. */
  private async drainPendingRearms(): Promise<void> {
    while (this.pendingRearm.size > 0) {
      await Promise.allSettled(Array.from(this.pendingRearm));
    }
  }

  private async flushPendingFrames(): Promise<void> {
    // Loop rather than a single snapshot-and-await: a frame event already queued in the event
    // loop when `acceptingFrames` flips can still add one more promise after we've read the set.
    while (this.pendingFrames.size > 0) {
      await Promise.allSettled(Array.from(this.pendingFrames));
    }
  }

  private async handleScreencastFrame(params: ScreencastFrameParams): Promise<void> {
    const frameIndex = this.frameCount++;
    try {
      if (params.sessionId !== undefined) {
        await this.client.send('Page.screencastFrameAck', { sessionId: params.sessionId });
      }
    } catch {
      // Best-effort ack — losing one ack just risks the browser pausing the stream.
    }

    if (this.baselines && this.baselines.firstScreencastTimestampSec === null && typeof params.metadata?.timestamp === 'number') {
      this.baselines.firstScreencastTimestampSec = params.metadata.timestamp;
      this.updateBaselinesPending();
    }

    const frameName = `frame-${String(frameIndex).padStart(6, '0')}.png`;
    writeBinaryPrivate(path.join(this.framesDir, frameName), Buffer.from(params.data, 'base64'));

    try {
      const sample = await this.sampleRects(frameIndex);
      const elements = this.sanitizeRectSample(sample.facts, sample.backendNodeIds);
      const elementSampleTruncated = sanitizeElementSampleTruncated(sample.elementSampleTruncated);
      const candidateSampleTruncated = sanitizeElementSampleTruncated(sample.candidateSampleTruncated);
      appendNdjsonPrivate(this.rectsPath, {
        frame: frameIndex,
        file: frameName,
        cssToDevice: cssToDeviceTransform(sample.viewport, framePngDimensions(params.data)),
        screencastTimestamp: params.metadata?.timestamp ?? null,
        screencastTimestampPrecision: 'frame-metadata',
        recordedAtWallClockMs: Date.now(),
        elements,
        ...(elementSampleTruncated === undefined ? {} : { elementSampleTruncated }),
        ...(candidateSampleTruncated === undefined ? {} : { candidateSampleTruncated }),
      } satisfies FrameRectsRecord);
    } catch (err) {
      // A failed rect sample for one frame shouldn't take the recorder down;
      // the frame PNG above is already written regardless.
      this.appendEvent({
        kind: 'error',
        message: `rect sample failed for frame ${frameIndex}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  private handleTraceData(params: { value: unknown[] }): void {
    // Once fully stopped, discard — a trace batch can legitimately still arrive during the
    // 'stopping' window (between `Tracing.end` and `tracingComplete`) and must still be captured.
    if (this.state === 'stopped') return;
    // Capture the earliest event timestamp as the trace baseline before recording this batch.
    this.captureFirstTraceEventTs(params.value);
    const events = this.sanitizeTraceEvents(Array.isArray(params.value) ? params.value : []);
    this.appendEvent({ kind: 'trace', events });
  }

  /**
   * Preserves each JSON-shaped `Tracing.dataCollected` event in full while
   * enforcing batch event-count and serialized-byte caps. `JSON.stringify`
   * measures the same encoding later written to NDJSON; the already-decoded
   * CDP object itself is retained without a redundant parse clone.
   */
  private sanitizeTraceEvents(raw: unknown[]): Array<Record<string, unknown>> {
    const events: Array<Record<string, unknown>> = [];
    let serializedBytes = 0;
    for (let i = 0; i < raw.length; i++) {
      if (events.length >= MAX_TRACE_EVENTS_PER_BATCH) {
        this.recordTraceDrop('event-cap', raw.length - i);
        break;
      }
      const item = raw[i];
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        this.recordTraceDrop('invalid-shape');
        continue;
      }

      let encoded: string;
      try {
        encoded = JSON.stringify(item);
      } catch {
        this.recordTraceDrop('invalid-shape');
        continue;
      }
      const sizeBytes = Buffer.byteLength(encoded, 'utf-8');
      if (serializedBytes + sizeBytes > MAX_TRACE_SERIALIZED_BYTES) {
        this.recordTraceDrop('byte-budget', raw.length - i);
        break;
      }
      serializedBytes += sizeBytes;
      events.push(item as Record<string, unknown>);
    }
    return events;
  }

  private recordTraceDrop(reason: string, count = 1): void {
    this.traceDropCounts.set(reason, (this.traceDropCounts.get(reason) ?? 0) + count);
  }

  /** Writes one summarizing `trace-dropped` event per drop reason instead of one per dropped/truncated trace event. */
  private flushTraceDropSummary(): void {
    for (const [reason, count] of this.traceDropCounts) {
      this.appendEvent({ kind: 'trace-dropped', reason, count });
    }
    this.traceDropCounts.clear();
  }

  private captureFirstTraceEventTs(events: unknown[]): void {
    if (!this.baselines || this.baselines.firstTraceEventTsUs !== null) return;
    for (const event of events) {
      const ts = (event as { ts?: unknown } | undefined)?.ts;
      if (typeof ts === 'number' && Number.isFinite(ts)) {
        this.baselines.firstTraceEventTsUs = ts;
        this.updateBaselinesPending();
        return;
      }
    }
  }

  private updateBaselinesPending(): void {
    if (!this.baselines) return;
    this.baselines.baselinesPending =
      this.baselines.firstScreencastTimestampSec === null || this.baselines.firstTraceEventTsUs === null;
  }

  /**
   * `Runtime.bindingCalled` handler — the page→host channel is untrusted input. The binding is
   * scoped to the isolated world (see `ensureBinding()`), so a legitimate call originates from that
   * world's execution context and carries this recording's nonce in its payload. Both origin checks
   * run BEFORE the per-second rate limit is consumed — a call from any other execution context is
   * dropped as `wrong-origin`, and a payload missing the nonce as `bad-nonce`, without touching the
   * rate budget — so no foreign-context flood can starve legitimate isolated-world events out of the
   * shared budget. A payload must also be `<= MAX_BINDING_PAYLOAD_BYTES` (UTF-8, checked before
   * parsing) and carry a whitelisted `kind`; only that kind's schema fields are retained, with
   * admitted strings and arrays preserved verbatim. Anything that fails a check is dropped and tallied, never parsed further or written
   * verbatim. Discards outright once fully `'stopped'`; an observer emission can legitimately still
   * arrive during the `'stopping'` window and must still be captured.
   */
  private handleBindingCalled(params: { name: string; payload: string; executionContextId?: number }): void {
    if (this.state === 'stopped') return;
    if (params.name !== RECORDER_BINDING_NAME) return;

    // Origin gate — before the rate limit. Only the active isolated world's context may drive the
    // channel; anything from another context is dropped without consuming the shared per-second
    // budget, so a foreign-context flood cannot starve legitimate isolated-world events.
    if (this.isolatedWorldContextId === undefined || params.executionContextId !== this.isolatedWorldContextId) {
      this.recordBindingDrop('wrong-origin');
      return;
    }

    if (typeof params.payload !== 'string' || Buffer.byteLength(params.payload, 'utf8') > MAX_BINDING_PAYLOAD_BYTES) {
      this.recordBindingDrop('oversized-payload');
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(params.payload);
    } catch {
      this.recordBindingDrop('invalid-json');
      return;
    }
    if (!payload || typeof payload !== 'object') {
      this.recordBindingDrop('invalid-shape');
      return;
    }

    const record = payload as Record<string, unknown>;
    // Nonce is the second origin proof, also checked before the rate limit, so a bad-nonce flood
    // (even from the right context) cannot consume the budget either.
    if (record.nonce !== this.bindingNonce) {
      this.recordBindingDrop('bad-nonce');
      return;
    }

    // Only a correctly-origined, correctly-nonced emission consumes the rate budget.
    if (!this.checkBindingRateLimit()) {
      this.recordBindingDrop('rate-limited');
      return;
    }

    const kind = typeof record.kind === 'string' ? record.kind : '';
    const sanitizers = BINDING_FIELD_SANITIZERS[kind];
    if (!sanitizers) {
      this.recordBindingDrop('unknown-kind');
      return;
    }

    const sanitized: Omit<RecorderEventRecord, 'recordedAtWallClockMs'> = { kind };
    const perfNow = sanitizeFiniteNumber(record.performanceNowMs);
    if (perfNow !== undefined) sanitized.performanceNowMs = perfNow;
    for (const [field, sanitize] of Object.entries(sanitizers)) {
      const value = sanitize(record[field]);
      if (value !== undefined) sanitized[field] = value;
    }
    if (kind === 'resize') {
      if (this.resizeResolutionClosed) {
        this.recordBindingDrop('resize-resolution-closed');
        return;
      }
      const resolving = this.resolveAndAppendResizeIdentity(sanitized);
      this.pendingBindingResolution.add(resolving);
      void resolving.finally(() => {
        this.pendingBindingResolution.delete(resolving);
      });
      return;
    }
    this.appendEvent(sanitized);
  }

  /**
   * Async continuation for a `kind:'resize'` binding event: resolves each target's `backendNodeId`
   * via a follow-up CDP round trip (the page-assigned `seq` — see `buildObserverScript` — keys
   * into the SAME nonce-scoped element queue the rect sampler's `takeRectElements` sibling uses),
   * then appends the event. Runs async (unlike every other binding kind, which appends
   * synchronously) because backendNodeId resolution requires its own `Runtime.evaluate` +
   * `DOM.describeNode` round trips — tracked in `pendingBindingResolution` so `stop()` can await it
   * before tearing down the observer script. Best-effort: any CDP failure along the way leaves
   * every target `identityUnresolved: true` rather than throwing out of a binding-event handler.
   */
  private async resolveAndAppendResizeIdentity(
    sanitized: Omit<RecorderEventRecord, 'recordedAtWallClockMs'>,
  ): Promise<void> {
    const targets = Array.isArray(sanitized.targets) ? (sanitized.targets as Array<Record<string, unknown>>) : [];
    const seq = sanitized.seq;
    const backendNodeIds = new Array<number | undefined>(targets.length).fill(undefined);

    if (typeof seq === 'number' && targets.length > 0) {
      let arrayObjectId: string | undefined;
      let objectIds: Array<string | undefined> = [];
      try {
        const client = asCDPClient(this.client);
        const evaluation = (await this.client.send('Runtime.evaluate', {
          expression: buildTakeResizeTargetsExpression(this.bindingNonce, seq),
          returnByValue: false,
          contextId: this.requireIsolatedContextId(),
        })) as { result: { objectId?: string }; exceptionDetails?: unknown };
        arrayObjectId = evaluation.exceptionDetails ? undefined : evaluation.result.objectId;
        if (arrayObjectId) {
          objectIds = await resolveIndexedObjectIds(client, arrayObjectId, targets.length);
          await Promise.all(
            objectIds.map(async (objectId, idx) => {
              if (!objectId) return;
              backendNodeIds[idx] = await describeBackendNodeId(client, objectId);
            }),
          );
        }
      } catch {
        // Best-effort — see doc comment above.
      } finally {
        const releaseIds = [arrayObjectId, ...objectIds].filter((id): id is string => Boolean(id));
        for (const id of releaseIds) {
          try {
            await this.client.send('Runtime.releaseObject', { objectId: id });
          } catch {
            // Best-effort.
          }
        }
      }
    }

    sanitized.targets = targets.map((t, idx) => {
      const backendNodeId = backendNodeIds[idx];
      return backendNodeId === undefined
        ? { ...t, backendNodeId: null, identityUnresolved: true }
        : { ...t, backendNodeId };
    });
    delete sanitized.seq; // internal correlation token only — not part of the public event shape
    this.appendEvent(sanitized);
  }

  private async flushPendingBindingResolutions(): Promise<void> {
    while (this.pendingBindingResolution.size > 0) {
      await Promise.allSettled(Array.from(this.pendingBindingResolution));
    }
  }

  private checkBindingRateLimit(): boolean {
    const now = Date.now();
    if (now - this.bindingWindowStartedAtMs >= 1000) {
      this.bindingWindowStartedAtMs = now;
      this.bindingWindowCount = 0;
    }
    this.bindingWindowCount++;
    return this.bindingWindowCount <= BINDING_RATE_LIMIT_PER_SECOND;
  }

  private recordBindingDrop(reason: string): void {
    this.bindingDropCounts.set(reason, (this.bindingDropCounts.get(reason) ?? 0) + 1);
  }

  /** Writes one summarizing `binding-dropped` event per drop reason instead of one per dropped payload. */
  private flushBindingDropSummary(): void {
    for (const [reason, count] of this.bindingDropCounts) {
      this.appendEvent({ kind: 'binding-dropped', reason, count });
    }
    this.bindingDropCounts.clear();
  }

  /**
   * Returns the RAW rect facts (`getBoundingClientRect` data read over the page DOM inside the
   * isolated world — untyped and untrusted, since the DOM it reads is page-controlled;
   * `sanitizeRectSample()` is the host-side guard that turns them into `SampledRect[]`, and this
   * method must never hand back that data typed as if it were already safe) alongside this frame's
   * resolved `backendNodeId`s, one per fact in the same order.
   */
  private async sampleRects(frameIndex: number): Promise<{ facts: unknown; viewport: unknown; elementSampleTruncated: unknown; candidateSampleTruncated: unknown; backendNodeIds: Array<number | undefined> }> {
    const evaluation = (await this.client.send('Runtime.evaluate', {
      expression: buildSampleRectsExpression(this.bindingNonce, frameIndex),
      returnByValue: true,
      contextId: this.requireIsolatedContextId(),
    })) as { result: { value?: unknown }; exceptionDetails?: unknown };
    if (evaluation.exceptionDetails) {
      throw new Error(`rect sampling failed: ${JSON.stringify(evaluation.exceptionDetails)}`);
    }
    const value = evaluation.result.value as { elements?: unknown; viewport?: unknown } | unknown[] | undefined;
    // Older recording seams returned the raw array; new recordings return the
    // array plus viewport facts needed for the transform.
    const facts = Array.isArray(value) ? value : value?.elements;
    const count = Array.isArray(facts) ? facts.length : 0;
    const backendNodeIds = await this.resolveRectIdentity(frameIndex, count);
    return {
      facts,
      viewport: Array.isArray(value) ? undefined : value?.viewport,
      elementSampleTruncated: Array.isArray(value) ? undefined : value?.elementSampleTruncated,
      candidateSampleTruncated: Array.isArray(value) ? undefined : value?.candidateSampleTruncated,
      backendNodeIds,
    };
  }

  /**
   * Follow-up identity bridge for the SAME frame's rect sample: drains the elements
   * `buildSampleRectsExpression` stashed page-side (via `stashRectElements`) into a nonce-scoped
   * queue keyed by `frameIndex`, as a held remote array, then bridges each to a `backendNodeId`
   * via `describeBackendNodeId` (the same identity-bridge primitive `geometry.ts`/`hittest.ts`
   * use). Bounded by `MAX_RECT_IDENTITY_RESOLUTIONS`; elements past the cap, or any element whose
   * `DOM.describeNode` fails, are left `undefined` here (mapped to `identityUnresolved: true` by
   * `sanitizeRectSample`). Uses the local `resolveCappedRectObjectIds` so the release loop below
   * releases every remote-object handle the `Runtime.getProperties` response materialized,
   * including descriptor handles outside the capped numeric slice; `resolveCount` bounds only the
   * `DOM.describeNode` follow-ups. Releases every held objectId before
   * returning, regardless of outcome — this runs every frame, so an unreleased handle here
   * accumulates for the WHOLE recording, unlike a one-shot measure collector.
   */
  private async resolveRectIdentity(frameIndex: number, count: number): Promise<Array<number | undefined>> {
    const backendNodeIds = new Array<number | undefined>(count).fill(undefined);
    if (count <= 0) return backendNodeIds;
    const resolveCount = Math.min(count, MAX_RECT_IDENTITY_RESOLUTIONS);

    let arrayObjectId: string | undefined;
    let allMaterializedObjectIds: string[] = [];
    try {
      const client = asCDPClient(this.client);
      const evaluation = (await this.client.send('Runtime.evaluate', {
        expression: buildTakeRectElementsExpression(this.bindingNonce, frameIndex),
        returnByValue: false,
        contextId: this.requireIsolatedContextId(),
      })) as { result: { objectId?: string }; exceptionDetails?: unknown };
      arrayObjectId = evaluation.exceptionDetails ? undefined : evaluation.result.objectId;
      if (arrayObjectId) {
        const resolved = await resolveCappedRectObjectIds(client, arrayObjectId, resolveCount);
        allMaterializedObjectIds = resolved.allMaterializedObjectIds;
        await Promise.all(
          resolved.objectIds.map(async (objectId, idx) => {
            if (!objectId) return;
            backendNodeIds[idx] = await describeBackendNodeId(client, objectId);
          }),
        );
      }
    } catch {
      // Best-effort — see doc comment above.
    } finally {
      const releaseIds = [arrayObjectId, ...allMaterializedObjectIds].filter((id): id is string => Boolean(id));
      for (const id of releaseIds) {
        try {
          await this.client.send('Runtime.releaseObject', { objectId: id });
        } catch {
          // Best-effort.
        }
      }
    }
    return backendNodeIds;
  }

  /**
   * Host-side sanitizer for one frame's rect sample (page-controlled DOM data read in the isolated
   * world) — the real guard behind the
   * in-page `buildSampleRectsExpression` cap (see the constants above). Caps
   * the element count, requires finite numeric coordinates, length-caps `tag`/`id`/`classes`,
   * and enforces a total serialized-byte budget for the frame; anything dropped is tallied by
   * reason into `rectDropCounts` (flushed as `rect-sample-dropped` summaries at stop(), same
   * style as the binding channel's drop tally) rather than silently discarded or trusted.
   * `backendNodeIds` is this frame's identity-bridge result (see `resolveRectIdentity`), aligned
   * by index to `raw` — `undefined` (never fabricated) becomes `backendNodeId: null,
   * identityUnresolved: true` on the emitted element (I-3/I-5).
   */
  private sanitizeRectSample(raw: unknown, backendNodeIds: ReadonlyArray<number | undefined>): SampledRect[] {
    const items = Array.isArray(raw) ? raw : [];
    const elements: SampledRect[] = [];
    let serializedBytes = 0;
    for (let i = 0; i < items.length; i++) {
      if (elements.length >= MAX_RECT_ELEMENTS) {
        this.recordRectDrop('element-cap', items.length - i);
        break;
      }
      const item = items[i];
      if (!item || typeof item !== 'object') {
        this.recordRectDrop('invalid-shape');
        continue;
      }
      const record = item as Record<string, unknown>;
      const x = sanitizeFiniteNumber(record.x);
      const y = sanitizeFiniteNumber(record.y);
      const width = sanitizeFiniteNumber(record.width);
      const height = sanitizeFiniteNumber(record.height);
      if (x === undefined || y === undefined || width === undefined || height === undefined) {
        this.recordRectDrop('non-finite-coords');
        continue;
      }
      const backendNodeId = backendNodeIds[i];
      const sanitized: SampledRect = {
        tag: sanitizeRectString(record.tag, MAX_RECT_TAG_LENGTH) ?? '',
        id: record.id === null ? null : (sanitizeRectString(record.id, MAX_RECT_STRING_LENGTH) ?? null),
        classes: record.classes === null ? null : (sanitizeRectString(record.classes, MAX_RECT_STRING_LENGTH) ?? null),
        x,
        y,
        width,
        height,
        ...(backendNodeId === undefined ? { backendNodeId: null, identityUnresolved: true } : { backendNodeId }),
      };
      const sizeBytes = Buffer.byteLength(JSON.stringify(sanitized), 'utf-8');
      if (serializedBytes + sizeBytes > MAX_RECTS_SERIALIZED_BYTES) {
        this.recordRectDrop('byte-budget', items.length - i);
        break;
      }
      serializedBytes += sizeBytes;
      elements.push(sanitized);
    }
    return elements;
  }

  private recordRectDrop(reason: string, count = 1): void {
    this.rectDropCounts.set(reason, (this.rectDropCounts.get(reason) ?? 0) + count);
  }

  /** Writes one summarizing `rect-sample-dropped` event per drop reason instead of one per dropped/truncated element. */
  private flushRectDropSummary(): void {
    for (const [reason, count] of this.rectDropCounts) {
      this.appendEvent({ kind: 'rect-sample-dropped', reason, count });
    }
    this.rectDropCounts.clear();
  }
}

/** A structural-safe implementation mark is deliberately distinct from the
 * verbatim action identity retained in the adjacent `action` field. */
// ---------------------------------------------------------------------------
// Injected in-page instrumentation
// ---------------------------------------------------------------------------

/**
 * Builds the IIFE injected at `rec-start` (and re-injected best-effort after every main-frame
 * navigation, see `RecorderSession.handleFrameNavigated`) via `Runtime.evaluate`. Sets up
 * MutationObserver/ResizeObserver/PerformanceObserver on the document, each emitting
 * NDJSON-ready records to the host over the CDP binding (`Runtime.addBinding` +
 * `Runtime.bindingCalled`) — the standard CDP page-to-host channel, not a new IPC mechanism.
 * `window['__captureRecorder_' + NONCE]` exposes `teardown()`, called at `rec-stop` to disconnect
 * the observers, drop both identity-bridge queues, and delete the nonce-scoped global (releasing its
 * retained DOM references) from the isolated world. The global's property name is scoped by
 * this recording's 128-bit `nonce` precisely so a page cannot predefine it: a page cannot preseed
 * or trap the installation guard (`if (window[KEY]) return;`) without first predicting an
 * unguessable per-recording token, and a second recording (a new nonce) on the same
 * never-navigated world always installs fresh instead of seeing a leftover global from a prior
 * nonce. Every emitted record ALSO carries `nonce` in its payload — the same token, closed over
 * — which the host (`RecorderSession.handleBindingCalled`) requires on every binding-channel
 * payload before trusting it; that is a separate check from the global's key and stops a hostile
 * page from forging binding-channel events by calling `window[BINDING]` directly.
 */
export class MotionCollector implements Collector<{ frames: number; durationMs: number; eventCount: number; markers: RecorderClockBaselines; state: string }> {
  readonly kind = 'motion' as const;
  readonly claims = ['tracing', 'screencast'] as const;
  private session: RecorderSession | undefined;
  private context: CollectorContext | undefined;
  private har: HARRecorder | undefined;
  private harDrain: Promise<void> | undefined;
  private stopped: RecorderStopSummary | undefined;
  private viewportApplied = false;

  async start(context: CollectorContext): Promise<void> {
    const config = context.config as { harId?: unknown; viewport?: { width?: unknown; height?: unknown } } | null;
    if (typeof config?.harId !== 'string' || config.harId.length === 0) throw new Error('motion collector requires a session HAR recording id');
    this.context = context;
    try {
      if (config.viewport) {
        const { width, height } = config.viewport;
        if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error('motion viewport must contain positive integer width and height');
        writeJsonPrivate(path.join(context.dir, 'viewport-override.json'), { phase: 'attempting', targetId: context.targetId, retainOnStop: true });
        await context.client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        this.viewportApplied = true;
        writeJsonPrivate(path.join(context.dir, 'viewport-override.json'), { phase: 'applied', targetId: context.targetId, retainOnStop: true });
      }
      this.har = new HARRecorder(context.client, batch => appendToHarRecording(config.harId as string, batch));
      await this.har.start();
      this.session = new RecorderSession({ client: context.client, recDir: context.dir });
      await this.session.start();
    } catch (startError) {
      this.closeAdmission();
      await this.harDrain?.catch(() => undefined);
      if (!this.viewportApplied) throw startError;
      try {
        await context.client.send('Emulation.clearDeviceMetricsOverride');
        this.viewportApplied = false;
        removeArtifactTree(path.join(context.dir, 'viewport-override.json'));
      } catch (cleanupError) {
        writeJsonPrivate(path.join(context.dir, 'viewport-override.json'), {
          phase: 'restore-failed',
          targetId: context.targetId,
          retainOnStop: true,
          startError: startError instanceof Error ? startError.message : String(startError),
          cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
        throw new RetainedCollectorStartFailure('motion collector start failed and its viewport override could not be cleared', startError, cleanupError);
      }
      throw startError;
    }
  }

  closeAdmission(): void {
    this.session?.closeAdmission();
    if (this.har && !this.harDrain) {
      this.harDrain = this.har.drain();
      this.harDrain.catch(() => undefined);
    }
  }

  async control(message: unknown): Promise<unknown> {
    if (!this.session || !this.har) throw new Error('motion collector was not started');
    const request = message as { type?: unknown; method?: unknown; params?: unknown; annotation?: unknown; waitEvent?: unknown; timeoutMs?: unknown; observeDocumentResponse?: unknown } | null;
    if (request?.type === 'har-flush') return this.har.flush();
    if (request?.type !== 'cdp') throw new Error('unsupported motion collector control request');
    return this.session.handleCdp({
      reqId: 0,
      method: typeof request.method === 'string' ? request.method : undefined,
      params: request.params && typeof request.params === 'object' && !Array.isArray(request.params) ? request.params as Record<string, unknown> : {},
      mark: typeof request.annotation === 'string' ? request.annotation : undefined,
      waitEvent: typeof request.waitEvent === 'string' ? request.waitEvent : undefined,
      timeoutMs: typeof request.timeoutMs === 'number' ? request.timeoutMs : undefined,
      observeDocumentResponse: request.observeDocumentResponse === true,
    });
  }

  async drain(cause: DrainCause): Promise<DrainOutcome<{ frames: number; durationMs: number; eventCount: number; markers: RecorderClockBaselines; state: string }>> {
    if (!this.session || !this.context) throw new Error('motion collector was not started');
    if (!cause.clientUsable) this.context.noteLoss('transport_lost');
    this.closeAdmission();
    const [stopped] = await Promise.all([this.stopped ??= this.session.drain(), this.harDrain]);
    this.stopped = stopped;
    let viewportRestored: boolean | null = null;
    if (this.viewportApplied && cause.trigger !== 'explicit') {
      try {
        await this.context.client.send('Emulation.clearDeviceMetricsOverride');
        removeArtifactTree(path.join(this.context.dir, 'viewport-override.json'));
        viewportRestored = true;
      } catch {
        viewportRestored = false;
      }
    }
    writeJsonPrivate(path.join(this.context.dir, 'markers.json'), stopped.markers);
    return { summary: { frames: stopped.frameCount, durationMs: stopped.durationMs, eventCount: stopped.eventCount, markers: stopped.markers, state: stopped.frameCount > 0 ? 'finalized' : 'partial', viewportRestored, viewportRetained: this.viewportApplied && cause.trigger === 'explicit' }, files: [] };
  }

  onDispatch(notice: DispatchNotice): ((outcome: DispatchOutcome) => void) | void {
    if (!this.session || !notice.annotation) return;
    return outcome => { if (outcome.ok) this.session!.recordRoutedDispatch(notice, outcome); };
  }

  abandon(): void {}
}

function buildObserverScript(bindingName: string, nonce: string): string {
  return `(function() {
    var BINDING = ${JSON.stringify(bindingName)};
    var NONCE = ${JSON.stringify(nonce)};
    var KEY = '__captureRecorder_' + NONCE;
    if (window[KEY]) return ${JSON.stringify(OBSERVER_INSTALLED_SENTINEL)};
    var resizeSeq = 0;
    var resizeQueue = {};
    var rectQueue = {};
    function pruneQueue(q, maxKeys) {
      var keys = Object.keys(q);
      if (keys.length <= maxKeys) return;
      keys.sort(function(a, b) { return Number(a) - Number(b); });
      for (var i = 0; i < keys.length - maxKeys; i++) delete q[keys[i]];
    }
    function emit(kind, payload) {
      try {
        var record = Object.assign({}, payload, { kind: kind, performanceNowMs: performance.now(), nonce: NONCE });
        window[BINDING](JSON.stringify(record));
      } catch (e) {}
    }

    var mutationObserver = new MutationObserver(function(records) {
      var maxRecordsPerEmission = 256;
      for (var start = 0; start < records.length; start += maxRecordsPerEmission) {
        var batch = records.slice(start, start + maxRecordsPerEmission);
        emit('mutation', {
          count: batch.length,
          types: batch.map(function(r) { return r.type; }),
        });
      }
    });
    mutationObserver.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, characterData: true,
    });

    var resizeObserver = new ResizeObserver(function(entries) {
      var seq = ++resizeSeq;
      resizeQueue[seq] = entries.map(function(e) { return e.target; });
      pruneQueue(resizeQueue, 40);
      emit('resize', {
        seq: seq,
        count: entries.length,
        targets: entries.map(function(e) {
          var rect = e.contentRect;
          return { tag: e.target && e.target.tagName, width: rect.width, height: rect.height };
        }),
      });
    });
    resizeObserver.observe(document.documentElement);

    var perfObservers = [];
    ['longtask', 'layout-shift', 'paint', 'mark', 'measure'].forEach(function(type) {
      try {
        if (!window.PerformanceObserver || !PerformanceObserver.supportedEntryTypes ||
            PerformanceObserver.supportedEntryTypes.indexOf(type) === -1) return;
        var po = new PerformanceObserver(function(list) {
          list.getEntries().forEach(function(entry) {
            emit('performance', {
              entryType: entry.entryType,
              name: entry.name,
              startTime: entry.startTime,
              duration: entry.duration,
              value: entry.entryType === 'layout-shift' ? entry.value : undefined,
              hadRecentInput: entry.entryType === 'layout-shift' ? entry.hadRecentInput : undefined,
            });
          });
        });
        po.observe({ type: type, buffered: true });
        perfObservers.push(po);
      } catch (e) {}
    });

    window[KEY] = {
      teardown: function() {
        try { mutationObserver.disconnect(); } catch (e) {}
        try { resizeObserver.disconnect(); } catch (e) {}
        perfObservers.forEach(function(po) {
          try { po.disconnect(); } catch (e) {}
        });
        resizeQueue = {};
        rectQueue = {};
        try { delete window[KEY]; } catch (e) {}
      },
      takeResizeTargets: function(seq) {
        var t = resizeQueue[seq];
        delete resizeQueue[seq];
        return t || [];
      },
      stashRectElements: function(frameIndex, els) {
        rectQueue[frameIndex] = els;
        pruneQueue(rectQueue, 10);
      },
      takeRectElements: function(frameIndex) {
        var e = rectQueue[frameIndex];
        delete rectQueue[frameIndex];
        return e || [];
      },
    };
    return ${JSON.stringify(OBSERVER_INSTALLED_SENTINEL)};
  })()`;
}

/**
 * Single round-trip element-rect sample, evaluated once per screencast frame. Uses
 * `getBoundingClientRect()` over a bounded TreeWalker prefix and retains its visible elements rather than one CDP `DOM.getBoxModel`
 * round trip per element — the cheap approximation this mechanism unit ships with; quad-accurate
 * geometry (transforms, clipping, frame/shadow stitching) is the `measure snap` substrate's job
 * (`geometry.json`), not the motion recorder's. Also stashes the live element handles it walked
 * into this recording's nonce-scoped queue (`window[KEY].stashRectElements`), keyed by
 * `frameIndex`, so a SEPARATE follow-up evaluate (`buildTakeRectElementsExpression`) can drain
 * them as held remote objects and bridge each to a `backendNodeId`. The stashed `els` array stops
 * growing once it reaches `identityCap` (mirrors `MAX_RECT_IDENTITY_RESOLUTIONS`) while `out`
 * keeps collecting up to `max` — both pushes happen in the same loop iteration while under the
 * cap, so `els[k]`/`out[k]` stay index-aligned for every `k` the identity bridge ever resolves;
 * this bounds the real CDP round-trip cost of the follow-up `Runtime.getProperties` walk to the
 * cap, rather than relying on the host-side release loop alone to bound it.
 */
function buildSampleRectsExpression(nonce: string, frameIndex: number): string {
  return `(function() {
    var out = [];
    var els = [];
    var max = ${JSON.stringify(MAX_RECT_ELEMENTS)};
    var candidateGeometryReadMax = ${JSON.stringify(MAX_RECT_GEOMETRY_CANDIDATES)};
    var identityCap = ${JSON.stringify(MAX_RECT_IDENTITY_RESOLUTIONS)};
    var walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
    var candidateGeometryReads = 0;
    var el;
    while (candidateGeometryReads < candidateGeometryReadMax && out.length < max && (el = walker.nextNode())) {
      candidateGeometryReads++;
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: typeof el.className === 'string' ? el.className : null,
        x: r.x, y: r.y, width: r.width, height: r.height,
      });
      if (els.length < identityCap) els.push(el);
    }
    var unexaminedCandidate = walker.nextNode() !== null;
    var k = '__captureRecorder_' + ${JSON.stringify(nonce)};
    var host = window[k];
    if (host && host.stashRectElements) host.stashRectElements(${JSON.stringify(frameIndex)}, els);
    var viewport = window.visualViewport;
    return {
      elements: out,
      elementSampleTruncated: out.length === max && unexaminedCandidate,
      candidateSampleTruncated: candidateGeometryReads === candidateGeometryReadMax && unexaminedCandidate,
      viewport: {
        width: viewport ? viewport.width : window.innerWidth,
        height: viewport ? viewport.height : window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
    };
  })()`;
}

function framePngDimensions(base64: string): { width: number; height: number } | null {
  try {
    const header = Buffer.from(base64, 'base64').subarray(0, 24);
    if (header.length < 24 || header.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } catch {
    return null;
  }
}

function cssToDeviceTransform(viewport: unknown, raster: { width: number; height: number } | null): FrameCssToDeviceTransform | null {
  if (!viewport || typeof viewport !== 'object' || !raster) return null;
  const record = viewport as Record<string, unknown>;
  const width = record.width;
  const height = record.height;
  const devicePixelRatio = record.devicePixelRatio;
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0
    || typeof height !== 'number' || !Number.isFinite(height) || height <= 0
    || typeof devicePixelRatio !== 'number' || !Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return null;
  return { scaleX: raster.width / width, scaleY: raster.height / height, devicePixelRatio };
}

/** Drains this frame's rect-sampler element queue (stashed by `buildSampleRectsExpression`) as a
 * held remote array — `RecorderSession.resolveRectIdentity`'s bridge follow-up. */
function buildTakeRectElementsExpression(nonce: string, frameIndex: number): string {
  return `(function(){var k='__captureRecorder_'+${JSON.stringify(nonce)};var h=window[k];return h&&h.takeRectElements?h.takeRectElements(${JSON.stringify(frameIndex)}):[];})()`;
}

/** Drains a resize-observer callback batch's target-element queue (stashed by `buildObserverScript`'s
 * `ResizeObserver` callback, keyed by its own page-assigned `seq`) as a held remote array —
 * `RecorderSession.resolveAndAppendResizeIdentity`'s bridge follow-up. */
function buildTakeResizeTargetsExpression(nonce: string, seq: number): string {
  return `(function(){var k='__captureRecorder_'+${JSON.stringify(nonce)};var h=window[k];return h&&h.takeResizeTargets?h.takeResizeTargets(${JSON.stringify(seq)}):[];})()`;
}
