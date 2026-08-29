import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { type ParsedArgs } from '../../types.js';
import { detectCdpPort } from '../../detect.js';
import { openTab } from '../../targets.js';
import { collectorHostSocketPath, startCollectorHost } from '../../bridge/spawn.js';
import { sendHostRequest, type HostResponse } from '../../host/client.js';
import { scanCollectorHost, type CollectorHostHandle } from '../../host/handle.js';
import { stopAndReapCollectorHostAtSessionStop } from '../../host/lifecycle.js';
import { resolveTraceRef } from '../../../output/artifact.js';
import { emitResult, fact, formatArtifactList, type RenderableResult } from '../../../output/render.js';
import { CAPTURE_ROOT, ensurePrivateDir, readPrivateFile } from '../../../session/artifacts.js';
import { getActiveSession } from '../../../session-context.js';
import { withSessionLifecycle } from '../../../session/coordinator.js';
import { driveOneShotAction } from '../motion/rec.js';

const HELP = `capture perf trace [url] [--do <action>] [--duration <seconds>] | --start | --stop — record a Chrome performance trace

input:
  [url]                  navigate to this URL and trace the load until it settles; without a URL the active session tab is traced in place (mutually exclusive with --start/--stop)
  --do <action>          trace across one action on the current page (same action grammar as \`motion rec --do\`), for an interaction trace INP can be read from
  --duration <seconds>   stop tracing this long after the action; default 3
  --start                open a trace window and return; requires an active session, and the trace stays live across intervening commands until --stop
  --stop                 close the live trace window and finalize its artifact; the session's one live trace is selected without an id
output: <trace …> — the finalized trace artifact, its recorded window, event count, and completion state; --json mirrors
effects: drives the browser and records; spawns or joins the session's collector host, which holds the tab connection until the trace is stopped. Claims \`tracing\`, which is browser-global: refused while \`motion rec\` or another trace is live anywhere in the browser, and the refusal names the claim and the collector holding it.`;

interface TraceSummary { events: number; windowMs: number; navigations: number; categories: string; }
interface TraceArtifact { id: string; dir: string; completion: string; reason?: string; summary: TraceSummary; }

function commandError(parsed: ParsedArgs, status: string, message: string): void {
  const held = /^Claim "([^"]+)" is held by (collector|reservation) (.+)\.$/.exec(message);
  const result: RenderableResult = held
    ? {
      tag: 'error',
      attrs: { command: 'perf trace', code: 'claim_held', claim: held[1], holder: `${held[2]} ${held[3]}` },
      summary: fact`received: perf trace\nexpected: no live collector holding the ${held[1]} claim\nholder: ${held[2]} ${held[3]}`,
      followUp: fact`Run \`capture session collectors\` to see the live roster, stop the holder, then re-issue.`,
    }
    : { tag: 'error', attrs: { command: 'perf trace', status }, summary: fact`${message}` };
  emitResult(result, { json: parsed.json });
  process.exitCode = 1;
}

function summaryFromMeta(dir: string, id: string): TraceArtifact {
  const resolved = resolveTraceRef(dir);
  const meta = JSON.parse(readPrivateFile(path.join(dir, 'meta.json')).toString('utf8')) as Record<string, unknown>;
  const summary = (meta.summary && typeof meta.summary === 'object' ? meta.summary : meta) as Record<string, unknown>;
  return {
    id,
    dir,
    completion: resolved.completion,
    ...(resolved.reason ? { reason: resolved.reason } : {}),
    summary: {
      events: typeof summary.events === 'number' ? summary.events : 0,
      windowMs: typeof summary.windowMs === 'number' ? summary.windowMs : 0,
      navigations: typeof summary.navigations === 'number' ? summary.navigations : 0,
      categories: typeof summary.categories === 'string' ? summary.categories : 'devtools-default',
    },
  };
}

function emitTrace(parsed: ParsedArgs, artifact: TraceArtifact): void {
  const result: RenderableResult = {
    tag: 'trace',
    attestation: { kind: 'trace', id: artifact.id, path: artifact.dir },
    attrs: {
      completion: artifact.completion,
      events: artifact.summary.events,
      'window-ms': artifact.summary.windowMs,
      navigations: artifact.summary.navigations,
      categories: artifact.summary.categories,
      ...(artifact.reason ? { reason: artifact.reason } : {}),
    },
    summary: fact`Trace events are Chrome's own Tracing output at the DevTools default category set. The recording window is bounded by this command's start and stop and contains nothing from before it.`,
    artifacts: formatArtifactList([{ name: 'trace.json' }]),
    ...(artifact.reason ? { sections: [fact`Completion reason: ${artifact.reason}`] } : {}),
  };
  emitResult(result, { json: parsed.json });
}

async function ensureHost(sessionDir: string, port: number, targetId: string): Promise<CollectorHostHandle> {
  let scanned = scanCollectorHost(sessionDir);
  if (scanned.classification === 'unknown' || scanned.classification === 'malformed') throw new Error(`collector host is ${scanned.classification}`);
  if (scanned.classification === 'dead') {
    const reaped = await stopAndReapCollectorHostAtSessionStop(sessionDir);
    if (reaped.status === 'terminal') throw new Error(reaped.error);
    scanned = scanCollectorHost(sessionDir);
  }
  if (scanned.classification === 'absent') {
    await startCollectorHost(collectorHostSocketPath(sessionDir), port, targetId, sessionDir);
    scanned = scanCollectorHost(sessionDir);
  }
  if (scanned.classification !== 'live' || !scanned.handle) throw new Error('collector host did not publish a live handle');
  if (scanned.handle.targetId !== targetId) throw new Error('collector host is bound to a different target; stop the active collector before tracing this tab');
  return scanned.handle;
}

async function startTrace(host: CollectorHostHandle): Promise<{ id: string; dir: string }> {
  const response = await sendHostRequest(host.socketPath, { type: 'collector-start', nonce: host.nonce, kind: 'trace', config: {} }, 30_000);
  if (!response.ok || !response.collector || typeof response.collector !== 'object') throw new Error(response.error ?? 'collector host refused to start trace');
  const collector = response.collector as { id?: unknown; dir?: unknown };
  if (typeof collector.id !== 'string' || typeof collector.dir !== 'string') throw new Error('collector host returned a malformed trace collector');
  return { id: collector.id, dir: collector.dir };
}

async function stopTrace(host: CollectorHostHandle, id: string, dir: string): Promise<TraceArtifact> {
  const response = await sendHostRequest(host.socketPath, { type: 'collector-stop', nonce: host.nonce, id }, 45_000);
  if (!response.ok) throw new Error(response.error ?? 'collector host refused to stop trace');
  return summaryFromMeta(dir, id);
}

function hostCdp(host: CollectorHostHandle) {
  return async (method: string, params: Record<string, unknown> = {}, annotation?: string): Promise<Record<string, unknown>> => {
    const response = await sendHostRequest(host.socketPath, { type: 'cdp', nonce: host.nonce, method, params, ...(annotation ? { annotation } : {}) }, 30_000);
    if (!response.ok) throw new Error(response.error ?? `host CDP call ${method} failed`);
    const { reqId: _reqId, ok: _ok, type: _type, error: _error, ...result } = response;
    return result;
  };
}

async function waitForDocument(host: CollectorHostHandle): Promise<void> {
  const cdp = hostCdp(host);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await cdp('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    const state = (response.result as { value?: unknown } | undefined)?.value;
    if (state === 'complete') return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting for the traced document to finish loading');
}

async function drive(host: CollectorHostHandle, url: string | undefined, action: string | undefined, durationMs: number): Promise<void> {
  const cdp = hostCdp(host);
  if (url) {
    await cdp('Page.enable');
    await cdp('Page.navigate', { url });
    await waitForDocument(host);
  }
  if (action) {
    await driveOneShotAction({
      async handleCdp(request: { method: string; params?: Record<string, unknown>; mark?: string }) {
        return { result: await cdp(request.method, request.params ?? {}, request.mark) };
      },
    }, action);
  }
  await new Promise(resolve => setTimeout(resolve, durationMs));
}

function oneShotDir(): string {
  const dir = path.join(CAPTURE_ROOT, `oneshot-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`);
  ensurePrivateDir(path.join(dir, 'perf', 'traces'));
  return dir;
}

async function handleStart(parsed: ParsedArgs): Promise<void> {
  const session = getActiveSession();
  if (!session?.targetId || session.port === undefined || session.port === null) return commandError(parsed, 'no_active_session', 'perf trace --start requires an active session with a target and CDP port.');
  try {
    const started = await withSessionLifecycle(session.dir, async () => startTrace(await ensureHost(session.dir, session.port!, session.targetId!)));
    emitResult({
      tag: 'trace',
      attestation: { kind: 'trace', id: started.id, path: started.dir },
      attrs: { completion: 'live', categories: 'devtools-default' },
      summary: fact`Trace window is live on the session tab. It contains events after this command until \`capture perf trace --stop\`.`,
    }, { json: parsed.json });
  } catch (error) { commandError(parsed, 'start_failed', error instanceof Error ? error.message : String(error)); }
}

async function handleStop(parsed: ParsedArgs): Promise<void> {
  const session = getActiveSession();
  if (!session) return commandError(parsed, 'no_active_session', 'perf trace --stop requires an active session.');
  try {
    const artifact = await withSessionLifecycle(session.dir, async () => {
      const scanned = scanCollectorHost(session.dir);
      if (scanned.classification !== 'live' || !scanned.handle) throw new Error(`no live collector host (${scanned.classification})`);
      const trace = scanned.handle.collectors.find(collector => collector.kind === 'trace');
      if (!trace) throw new Error('no live trace collector exists in this session');
      return stopTrace(scanned.handle, trace.id, trace.dir);
    });
    emitTrace(parsed, artifact);
  } catch (error) { commandError(parsed, 'stop_failed', error instanceof Error ? error.message : String(error)); }
}

async function handleOneShot(parsed: ParsedArgs): Promise<void> {
  const active = getActiveSession();
  const url = parsed.positional[0];
  const durationMs = parsed.duration ?? 3_000;
  if (!Number.isFinite(durationMs) || durationMs < 0) return commandError(parsed, 'invalid_duration', '--duration must be a non-negative number of seconds.');
  if (!active?.targetId && !url) return commandError(parsed, 'no_session_target', 'perf trace without a URL requires an active session tab.');
  let host: CollectorHostHandle | undefined;
  let started: { id: string; dir: string } | undefined;
  try {
    const port = active?.port ?? parsed.port ?? await detectCdpPort();
    const sessionDir = active?.dir ?? oneShotDir();
    const targetId = active?.targetId ?? (await openTab(port, 'about:blank')).id;
    const run = async (): Promise<TraceArtifact> => {
      host = await ensureHost(sessionDir, port, targetId);
      started = await startTrace(host);
      await drive(host, url, parsed.do, durationMs);
      return stopTrace(host, started.id, started.dir);
    };
    const artifact = active ? await withSessionLifecycle(sessionDir, run) : await run();
    emitTrace(parsed, artifact);
  } catch (error) {
    if (host && started) {
      try { await stopTrace(host, started.id, started.dir); } catch {}
    }
    commandError(parsed, 'trace_failed', error instanceof Error ? error.message : String(error));
  }
}

export async function cmdPerfTrace(parsed: ParsedArgs): Promise<void> {
  if (parsed.help) { console.log(HELP); return; }
  if (parsed.start) return handleStart(parsed);
  if (parsed.stop) return handleStop(parsed);
  return handleOneShot(parsed);
}

export { HELP as PERF_TRACE_HELP, resolveTraceRef };
