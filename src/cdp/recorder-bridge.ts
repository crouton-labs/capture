/**
 * The recorder bridge: a specialized instance of capture's held bridge
 * (`./bridge/server.ts`) that owns ONE tab-level CDP connection for the
 * lifetime of a `capture motion rec` recording instead of a browser-level
 * one. Same NDJSON-over-unix-socket wire style, same detached-process
 * shape as `session start --hold` — this file adds no new IPC or process
 * model, only the recorder-specific request handling and CDP driving.
 *
 * Lifecycle (see `./bridge/protocol.ts` for the wire messages):
 *  - `rec-start` — enables the motion-rec CDP domains, starts
 *    `Page.startScreencast` + `Tracing`, injects the Mutation/Resize/
 *    PerformanceObserver script, captures the clock baseline, and returns
 *    it for the caller's `markers.json` (this module does not write that
 *    file — see U14's lifecycle routing).
 *  - `cdp` — a CDP request routed through the held tab connection, used by
 *    intervening session commands during a composed recording. An optional
 *    `mark` brackets the dispatch with two performance.now() reads and
 *    appends a labeled input-landmark record to `events.jsonl`.
 *  - `rec-stop` — stops screencast + tracing, flushes/tears down the
 *    injected observers, and returns frame/event counts + duration for the
 *    caller's `meta.json` (this module does not write that file either).
 *
 * Frames land as PNGs under `{recDir}/frames/`; per-frame element rects
 * append to `{recDir}/rects.jsonl`; trace batches, observer entries, input
 * landmarks, and best-effort errors append to `{recDir}/events.jsonl` — all
 * writes go through the secure artifact helpers (`../session/artifacts.js`,
 * U03), never ad-hoc `fs.writeFile`.
 *
 * Navigation: a `navigate` mid-recording destroys the page's JS world (and
 * therefore the injected observers) same as any full navigation would.
 * `Page.startScreencast`/`Tracing` continue across it unaffected (they are
 * CDP-session-scoped, not page-scoped), but the recorder listens for
 * `Page.frameNavigated` on the main frame and re-creates the isolated world
 * + re-injects the observer script best-effort afterward (the binding, scoped
 * to the world name, auto-reattaches to the recreated world without being
 * re-issued), recording a `navigation-gap` marker in `events.jsonl` so
 * downstream consumers know the Mutation/Resize/PerformanceObserver stream
 * has a gap around that point.
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
import * as net from 'net';
import * as path from 'path';
import { CDPClient } from './client.js';
import { findTabByIdAcrossEndpoints } from './targets.js';
import { enableDomainsForMotionRec } from './domains.js';
import { readTraceClockBaseline, withDocumentPerformanceNow } from './timing.js';
import {
  EventBroker,
  listenNdjsonSocket,
  closeNdjsonSocket,
  installProcessCleanup,
} from './bridge/server.js';
import {
  type RecorderRequest,
  type RecorderResponse,
  type RecorderClockBaselines,
  type RecCdpRequest,
} from './bridge/protocol.js';
import { ensurePrivateDir, appendNdjsonPrivate, writeBinaryPrivate } from '../session/artifacts.js';
import { resolveIndexedObjectIds, describeBackendNodeId } from './measure/collectors/geometry.js';

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

export type RecorderCdpClient = Pick<CDPClient, 'send' | 'on' | 'onDisconnect' | 'close'>;

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
// (`buildSampleRectsExpression`'s `max = 2000`) is an optimization only — a hostile page can
// corrupt or bypass in-page JS (e.g. clobbering `Array.prototype` before the script runs),
// so every one of these limits is re-enforced here, on the host, before a sample is ever
// appended to `rects.jsonl`.
// ---------------------------------------------------------------------------

/** Mirrors the in-page cap, re-enforced host-side regardless of what the page script actually returned. */
const MAX_RECT_ELEMENTS = 2000;
const MAX_RECT_TAG_LENGTH = 32;
const MAX_RECT_STRING_LENGTH = 256;
/** Total serialized-byte budget for one frame's sanitized rect array, independent of the element-count cap. */
const MAX_RECTS_SERIALIZED_BYTES = 256 * 1024;
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

    await this.client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    await this.client.send('Tracing.start', { transferMode: 'ReportEvents', categories: TRACE_CATEGORIES });

    // A main-frame navigation anywhere in the initialization window above spawned a rearm that
    // recreated the isolated world in the newest context; wait for every one to settle so start()
    // never returns with the bridge bound to a world a startup navigation already destroyed.
    await this.drainPendingRearms();

    // Refuse to enter recording unless the LATEST navigation generation actually installed and
    // published its isolated world. A startup navigation that overtook the gen-0 install and then
    // failed its own rearm leaves no live context — entering recording here would let bridge
    // evaluates run with an undefined contextId (i.e. in the page main world), breaking the
    // isolated-world boundary. Aborting propagates to `handleRecorderRequest` as an `ok:false`
    // rec-start response.
    if (this.isolatedWorldContextId === undefined || this.activeWorldGeneration !== this.navGeneration) {
      throw new Error(
        'recorder start aborted: observer script was not installed in the latest main-frame context',
      );
    }

    this.startedAtWallClockMs = Date.now();
    this.state = 'recording';
    return { ...this.baselines };
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
   * `req` arrives as parsed-JSON cast to `RecCdpRequest` — `runRecorderBridge`
   * does not validate the wire shape at parse time, so the type-level
   * guarantee that `RecCdpWaitEventRequest` always carries a nonempty string
   * `waitEvent` is NOT enforced at runtime. Validate here, before any
   * dispatch: a request must carry EITHER a nonempty string `method`
   * (dispatch, optionally awaiting `waitEvent` too) OR a nonempty string
   * `waitEvent` (wait-event-only) — anything else (both absent, or a
   * present-but-empty/non-string field) is an explicit protocol error, not a
   * silent no-op "ok" response.
   */
  async handleCdp(req: RecCdpRequest): Promise<{ result?: unknown; event?: unknown }> {
    if (this.state === 'stopping' || this.state === 'stopped') {
      throw new Error(`cannot dispatch cdp request in state "${this.state}"`);
    }
    const hasMethod = typeof req.method === 'string' && req.method.length > 0;
    const hasWaitEvent = typeof req.waitEvent === 'string' && req.waitEvent.length > 0;
    if (!hasMethod && !hasWaitEvent) {
      throw new Error(
        'Invalid cdp request: requires a nonempty string "method" (to dispatch) or "waitEvent" (to wait only) — got neither.',
      );
    }

    // This recorder owns a direct tab websocket, so its actual CDP event
    // envelope scope is `undefined` (there is no flattened attach session).
    // Arm synchronously before any triggering send below.
    const eventWait = hasWaitEvent
      ? this.events.wait(req.waitEvent as string, undefined, req.timeoutMs ?? 10000)
      : undefined;

    try {
      if (!hasMethod) {
        // Wait-event-ONLY request (`RecCdpWaitEventRequest`) — there is no CDP
        // call to dispatch, so `client.send` must never be reached here (it
        // would otherwise send `method: undefined` over the real websocket).
        const event = eventWait ? await eventWait.result() : undefined;
        return { event };
      }

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
        const event = eventWait ? await eventWait.result() : undefined;
        return { result: bracket.result, event };
      }

      const result = await this.client.send(req.method, req.params ?? {}, req.timeoutMs ?? 60000);
      const event = eventWait ? await eventWait.result() : undefined;
      return { result, event };
    } catch (err) {
      eventWait?.cancel();
      throw err;
    }
  }

  async stop(): Promise<RecorderStopSummary> {
    if (this.state !== 'recording') {
      throw new Error(`cannot stop recorder in state "${this.state}"`);
    }
    // Flips away from 'recording' before any other await in this method, so every
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
    return {
      frameCount: this.frameCount,
      eventCount: this.eventCount,
      durationMs: Date.now() - this.startedAtWallClockMs,
      // this.baselines is always set by the time stop() is reachable — start() sets it before
      // flipping state to 'recording', and stop() only runs from state 'recording'.
      markers: { ...this.baselines! },
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
      throw new Error('recorder bridge has no active isolated world context');
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
    if (!frameId) throw new Error('recorder bridge could not resolve the main frame id via Page.getFrameTree');
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
      throw new Error('recorder bridge isolated world creation returned no execution context id');
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
   * still land the observer in the newest context). Sub-frame navigations (`frame.parentId` set)
   * don't affect the top document's world and are ignored. Bails once the recorder has left those
   * phases (`'stopping'`/`'stopped'`) so a navigation arriving mid-teardown doesn't start new CDP
   * work concurrent with it — `stop()` awaits every rearm still in flight at that boundary (tracked
   * in `pendingRearm`, which can hold more than one entry when navigations overlap).
   */
  private async handleFrameNavigated(params: { frame?: { id?: string; parentId?: string; url?: string } }): Promise<void> {
    if (this.state !== 'recording' && this.state !== 'starting') return;
    const frame = params.frame;
    if (!frame || frame.parentId) return;
    const generation = ++this.navGeneration;
    // The navigation destroyed the current isolated world; drop the now-dead context id
    // immediately so no bridge evaluate targets it while the rearm is in flight — or if the
    // rearm fails and never republishes.
    this.isolatedWorldContextId = undefined;
    this.activeWorldGeneration = undefined;
    if (frame.id) this.mainFrameId = frame.id;
    this.appendEvent({ kind: 'navigation-gap', url: preserveObserverString(frame.url) ?? null });
    try {
      await this.injectObserverScript(generation);
    } catch (err) {
      this.appendEvent({
        kind: 'error',
        message: `observer re-arm after navigation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
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
      appendNdjsonPrivate(this.rectsPath, {
        frame: frameIndex,
        file: frameName,
        cssToDevice: cssToDeviceTransform(sample.viewport, framePngDimensions(params.data)),
        screencastTimestamp: params.metadata?.timestamp ?? null,
        screencastTimestampPrecision: 'frame-metadata',
        recordedAtWallClockMs: Date.now(),
        elements,
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
  private async sampleRects(frameIndex: number): Promise<{ facts: unknown; viewport: unknown; backendNodeIds: Array<number | undefined> }> {
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
    return { facts, viewport: Array.isArray(value) ? undefined : value?.viewport, backendNodeIds };
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
function structuralMarkLabel(action: string): string {
  return `mark-${crypto.createHash('sha256').update(action).digest('hex')}`;
}

// ---------------------------------------------------------------------------
// Wire dispatch — the same "one request per connection, one response"
// convention the plain bridge uses (see ./bridge/server.ts).
// ---------------------------------------------------------------------------

export async function handleRecorderRequest(
  session: RecorderSession,
  req: RecorderRequest,
): Promise<RecorderResponse> {
  try {
    switch (req.type) {
      case 'rec-start': {
        const markers = await session.start();
        return { reqId: req.reqId, ok: true, type: 'rec-start', markers };
      }
      case 'rec-stop': {
        const summary = await session.stop();
        return { reqId: req.reqId, ok: true, type: 'rec-stop', ...summary };
      }
      case 'cdp': {
        const { result, event } = await session.handleCdp(req);
        return { reqId: req.reqId, ok: true, type: 'cdp', result, event };
      }
      default: {
        const exhaustive: never = req;
        throw new Error(`Unknown recorder request: ${JSON.stringify(exhaustive)}`);
      }
    }
  } catch (err) {
    return {
      reqId: req.reqId,
      ok: false,
      type: req.type,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Process entrypoint — spawned detached by `./bridge/spawn.ts`'s
// `startRecorderBridge()`, invoked via `capture __bridge-serve ... recorder
// <recDir>` (see ./commands/bridge-serve.ts).
// ---------------------------------------------------------------------------

export interface RunRecorderBridgeOptions {
  socketPath: string;
  targetId: string;
  recDir: string;
  port?: number;
}

export async function runRecorderBridge(opts: RunRecorderBridgeOptions): Promise<void> {
  const port = opts.port ?? (await resolvePort());
  const resolved = await findTabByIdAcrossEndpoints(opts.targetId, port);
  if (!resolved?.tab.webSocketDebuggerUrl) {
    throw new Error(`No tab found for target "${opts.targetId}" on port ${port}.`);
  }

  const client = new CDPClient(resolved.tab.webSocketDebuggerUrl);
  await client.waitReady();

  const session = new RecorderSession({ client, recDir: opts.recDir });

  async function handleLine(line: string, socket: net.Socket): Promise<void> {
    let req: RecorderRequest;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }
    const resp = await handleRecorderRequest(session, req);
    socket.write(JSON.stringify(resp) + '\n');
  }

  const server = await listenNdjsonSocket(opts.socketPath, handleLine);
  const cleanup = (): void => {
    closeNdjsonSocket(server, opts.socketPath);
    try {
      client.close();
    } catch {
      // Already closed.
    }
  };
  installProcessCleanup(cleanup, client);
  // Intentionally does not resolve further: the open server and the live
  // tab websocket keep this detached process alive until the caller (U14's
  // lifecycle routing) sends SIGTERM via the same `stopBridge()` used for
  // the plain held bridge.
}

async function resolvePort(): Promise<number> {
  const { detectCdpPort } = await import('./detect.js');
  return detectCdpPort();
}

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
      emit('mutation', {
        count: records.length,
        types: records.map(function(r) { return r.type; }),
      });
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
 * `getBoundingClientRect()` over every element (capped) rather than one CDP `DOM.getBoxModel`
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
    var all = document.querySelectorAll('*');
    var max = 2000;
    var identityCap = ${JSON.stringify(MAX_RECT_IDENTITY_RESOLUTIONS)};
    for (var i = 0; i < all.length && out.length < max; i++) {
      var el = all[i];
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
    var k = '__captureRecorder_' + ${JSON.stringify(nonce)};
    var host = window[k];
    if (host && host.stashRectElements) host.stashRectElements(${JSON.stringify(frameIndex)}, els);
    var viewport = window.visualViewport;
    return {
      elements: out,
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
