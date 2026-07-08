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
 * Known limitation: the injected observer script and `Runtime.addBinding`
 * are only armed once, at `rec-start`. A `navigate` mid-recording wipes the
 * page's JS world (and therefore the observers) same as any full
 * navigation would; re-arming after `Page.frameNavigated` is not built
 * here. `Page.startScreencast`/`Tracing` continue across navigation (they
 * are CDP-session-scoped, not page-scoped), so frames/trace events are
 * unaffected — only the Mutation/Resize/PerformanceObserver stream would
 * gap across a navigate. Flagged for whichever unit drives `motion rec`
 * across a `navigate` command.
 */

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

// ---------------------------------------------------------------------------
// Artifact record shapes
// ---------------------------------------------------------------------------

export interface SampledRect {
  tag: string;
  id: string | null;
  classes: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One line of `rects.jsonl` — element quads sampled at one screencast frame. */
export interface FrameRectsRecord {
  frame: number;
  file: string;
  /** `Page.screencastFrame`'s own `metadata.timestamp` (wall-clock seconds), raw — not baseline-converted. */
  screencastTimestamp: number | null;
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

export type RecorderState = 'idle' | 'recording' | 'stopped';

export interface RecorderSessionOptions {
  client: RecorderCdpClient;
  /** Absolute path to `motion/recs/{recId}` — must resolve under `CAPTURE_ROOT`. */
  recDir: string;
}

export interface RecorderStopSummary {
  frameCount: number;
  eventCount: number;
  durationMs: number;
}

const RECORDER_BINDING_NAME = 'captureRecorderEmit';

const TRACE_CATEGORIES =
  'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,loading,blink.user_timing';

interface ScreencastFrameParams {
  data: string;
  metadata?: { timestamp?: number; [key: string]: unknown };
  sessionId?: number;
}

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

    await enableDomainsForMotionRec(asCDPClient(this.client));

    this.client.on('Page.screencastFrame', (params) => {
      void this.handleScreencastFrame(params as ScreencastFrameParams);
    });
    this.client.on('Tracing.dataCollected', (params) => {
      this.handleTraceData(params as { value: unknown[] });
    });
    this.client.on('Runtime.bindingCalled', (params) => {
      this.handleBindingCalled(params as { name: string; payload: string });
    });

    await this.client.send('Runtime.addBinding', { name: RECORDER_BINDING_NAME });
    await this.client.send('Runtime.evaluate', { expression: buildObserverScript(RECORDER_BINDING_NAME) });

    await this.client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
    await this.client.send('Tracing.start', { transferMode: 'ReportEvents', categories: TRACE_CATEGORIES });

    const baseline = await readTraceClockBaseline(asCDPClient(this.client));
    this.startedAtWallClockMs = Date.now();
    this.state = 'recording';
    return baseline;
  }

  /** Handles a `type: 'cdp'` request — plain passthrough, or bracketed + logged when `mark` is set. */
  async handleCdp(req: RecCdpRequest): Promise<{ result?: unknown; event?: unknown }> {
    const eventPromise = req.waitEvent ? this.events.wait(req.waitEvent, req.timeoutMs ?? 10000) : undefined;

    if (req.mark) {
      const bracket = await withDocumentPerformanceNow(asCDPClient(this.client), () =>
        this.client.send(req.method, req.params ?? {}, req.timeoutMs ?? 60000),
      );
      this.appendEvent({
        kind: 'input',
        mark: req.mark,
        method: req.method,
        startPerformanceNow: bracket.startPerformanceNow,
        endPerformanceNow: bracket.endPerformanceNow,
      });
      const event = eventPromise ? await eventPromise : undefined;
      return { result: bracket.result, event };
    }

    const result = await this.client.send(req.method, req.params ?? {}, req.timeoutMs ?? 60000);
    const event = eventPromise ? await eventPromise : undefined;
    return { result, event };
  }

  async stop(): Promise<RecorderStopSummary> {
    if (this.state !== 'recording') {
      throw new Error(`cannot stop recorder in state "${this.state}"`);
    }

    try {
      await this.client.send('Page.stopScreencast');
    } catch {
      // Best-effort — the tab/browser may already be gone.
    }

    const tracingComplete = this.events.wait('Tracing.tracingComplete', 5000).catch(() => undefined);
    try {
      await this.client.send('Tracing.end');
    } catch {
      // Best-effort.
    }
    await tracingComplete;

    try {
      await this.client.send('Runtime.evaluate', {
        expression: 'window.__captureRecorder && window.__captureRecorder.teardown()',
      });
    } catch {
      // Best-effort — the page may already be gone.
    }
    try {
      await this.client.send('Runtime.removeBinding', { name: RECORDER_BINDING_NAME });
    } catch {
      // Best-effort.
    }

    this.state = 'stopped';
    return {
      frameCount: this.frameCount,
      eventCount: this.eventCount,
      durationMs: Date.now() - this.startedAtWallClockMs,
    };
  }

  private appendEvent(record: Omit<RecorderEventRecord, 'recordedAtWallClockMs'>): void {
    this.eventCount++;
    appendNdjsonPrivate(this.eventsPath, {
      ...record,
      recordedAtWallClockMs: Date.now(),
    } satisfies RecorderEventRecord);
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

    const frameName = `frame-${String(frameIndex).padStart(6, '0')}.png`;
    writeBinaryPrivate(path.join(this.framesDir, frameName), Buffer.from(params.data, 'base64'));

    try {
      const elements = await this.sampleRects();
      appendNdjsonPrivate(this.rectsPath, {
        frame: frameIndex,
        file: frameName,
        screencastTimestamp: params.metadata?.timestamp ?? null,
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
    this.appendEvent({ kind: 'trace', events: params.value });
  }

  private handleBindingCalled(params: { name: string; payload: string }): void {
    if (params.name !== RECORDER_BINDING_NAME) return;
    let payload: unknown;
    try {
      payload = JSON.parse(params.payload);
    } catch {
      return;
    }
    if (!payload || typeof payload !== 'object') return;
    this.appendEvent(payload as Omit<RecorderEventRecord, 'recordedAtWallClockMs'>);
  }

  private async sampleRects(): Promise<SampledRect[]> {
    const evaluation = (await this.client.send('Runtime.evaluate', {
      expression: SAMPLE_RECTS_EXPRESSION,
      returnByValue: true,
    })) as { result: { value?: unknown }; exceptionDetails?: unknown };
    if (evaluation.exceptionDetails) {
      throw new Error(`rect sampling failed: ${JSON.stringify(evaluation.exceptionDetails)}`);
    }
    return Array.isArray(evaluation.result.value) ? (evaluation.result.value as SampledRect[]) : [];
  }
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
 * Builds the IIFE injected once at `rec-start` via `Runtime.evaluate`. Sets
 * up MutationObserver/ResizeObserver/PerformanceObserver on the document,
 * each emitting NDJSON-ready records to the host over the CDP binding
 * (`Runtime.addBinding` + `Runtime.bindingCalled`) — the standard CDP
 * page-to-host channel, not a new IPC mechanism. `window.__captureRecorder`
 * exposes `teardown()`, called at `rec-stop` to disconnect the observers.
 */
function buildObserverScript(bindingName: string): string {
  return `(function() {
    if (window.__captureRecorder) return;
    var BINDING = ${JSON.stringify(bindingName)};
    function emit(kind, payload) {
      try {
        var record = Object.assign({ kind: kind, performanceNowMs: performance.now() }, payload);
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
      emit('resize', {
        count: entries.length,
        targets: entries.slice(0, 20).map(function(e) {
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

    window.__captureRecorder = {
      teardown: function() {
        try { mutationObserver.disconnect(); } catch (e) {}
        try { resizeObserver.disconnect(); } catch (e) {}
        perfObservers.forEach(function(po) {
          try { po.disconnect(); } catch (e) {}
        });
      },
    };
  })()`;
}

/**
 * Single round-trip element-rect sample, evaluated once per screencast
 * frame. Uses `getBoundingClientRect()` over every element (capped) rather
 * than one CDP `DOM.getBoxModel` round trip per element — the cheap
 * approximation this mechanism unit ships with; quad-accurate geometry
 * (transforms, clipping, frame/shadow stitching) is the `measure snap`
 * substrate's job (`geometry.json`), not the motion recorder's.
 */
const SAMPLE_RECTS_EXPRESSION = `(function() {
  var out = [];
  var all = document.querySelectorAll('*');
  var max = 2000;
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
  }
  return out;
})()`;
