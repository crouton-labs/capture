import * as fs from 'node:fs';
import * as path from 'node:path';
import { type ParsedArgs } from '../../types.js';
import { captureError } from '../../../errors.js';
import { detectCdpPort } from '../../detect.js';
import { findTabById, openTab } from '../../targets.js';
import { collectorHostSocketPath, startCollectorHost } from '../../bridge/spawn.js';
import { sendHostRequest } from '../../host/client.js';
import { scanCollectorHost, type CollectorHostHandle } from '../../host/handle.js';
import { stopAndReapCollectorHostAtSessionStop } from '../../host/lifecycle.js';
import { CAPTURE_ROOT, ensurePrivateDir } from '../../../session/artifacts.js';
import { getActiveSession } from '../../../session-context.js';
import { withSessionLifecycle } from '../../../session/coordinator.js';
import { emitResult, fact, formatArtifactList, text } from '../../../output/render.js';
import { completionAttrs, loadHeap, resolveHeapRef, resultReference } from './common.js';

const HELP = `capture heap snapshot [url] — take a V8 heap snapshot of the tab's JavaScript heap

input:
  [url]   navigate to this URL and snapshot it in a one-shot session; without a URL the active session tab is snapshotted in place
output: <heap-snapshot …> — the finalized snapshot artifact, its node and edge counts, on-disk bytes, and completion state; --json mirrors
effects: drives the browser and writes a large artifact; spawns or joins the session's collector host for the duration of one snapshot and releases it immediately. Claims \`heap-snapshot\`; refused while another heap snapshot is streaming, and the refusal names the claim and its holder. Composes with a live trace and with a live mock.`;

async function liveHost(sessionDir: string, port: number, targetId: string): Promise<CollectorHostHandle> {
  let scanned = scanCollectorHost(sessionDir);
  if (scanned.classification === 'dead') {
    const reaped = await stopAndReapCollectorHostAtSessionStop(sessionDir);
    if (reaped.status === 'terminal') throw new Error(reaped.error);
    scanned = scanCollectorHost(sessionDir);
  }
  if (scanned.classification === 'unknown' || scanned.classification === 'malformed') throw new Error(`Collector host is ${scanned.classification}.`);
  if (scanned.classification === 'absent') {
    await startCollectorHost(collectorHostSocketPath(sessionDir), port, targetId, sessionDir);
    scanned = scanCollectorHost(sessionDir);
  }
  if (scanned.classification !== 'live' || !scanned.handle) throw new Error('Collector host did not publish a live handle.');
  if (scanned.handle.targetId !== targetId) throw new Error('Collector host is bound to a different tab. Stop the session before changing tabs.');
  return scanned.handle;
}

async function collect(sessionDir: string, port: number, targetId: string): Promise<string> {
  const host = await liveHost(sessionDir, port, targetId);
  const started = await sendHostRequest(host.socketPath, { type: 'collector-start', nonce: host.nonce, kind: 'heap', config: {} }, 120_000);
  if (!started.ok || !started.collector || typeof started.collector !== 'object') throw new Error(started.error ?? 'collector host refused to start heap snapshot');
  const collector = started.collector as { id?: unknown; dir?: unknown };
  if (typeof collector.id !== 'string' || typeof collector.dir !== 'string') throw new Error('collector host returned a malformed heap collector');
  const stopped = await sendHostRequest(host.socketPath, { type: 'collector-stop', nonce: host.nonce, id: collector.id }, 120_000);
  if (!stopped.ok) throw new Error(stopped.error ?? 'collector host refused to finalize heap snapshot');
  return collector.dir;
}

function oneshotHeapDir(): string {
  const dir = path.join(CAPTURE_ROOT, `oneshot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, 'heap', 'snapshots');
  ensurePrivateDir(dir);
  return path.dirname(path.dirname(dir));
}

export async function cmdHeapSnapshot(parsed: ParsedArgs): Promise<void> {
  if (parsed.help) {
    console.log(HELP);
    return;
  }
  const url = parsed.positional[0];
  const active = getActiveSession();
  const selectedPort = parsed.port ?? active?.port;
  if (!url && (!active?.targetId || selectedPort === null || selectedPort === undefined)) {
    throw captureError('precondition', 'heap_snapshot_unavailable', 'heap snapshot without a URL requires an active capture session with a target tab and CDP port.');
  }
  const port = selectedPort ?? await detectCdpPort();
  let snapshotDir: string;
  let targetId: string;
  if (url) {
    const tab = await openTab(port, url);
    targetId = tab.id;
    const sessionDir = oneshotHeapDir();
    snapshotDir = await collect(sessionDir, port, targetId);
  } else {
    targetId = active!.targetId!;
    snapshotDir = await withSessionLifecycle(active!.dir, () => collect(active!.dir, port, targetId));
  }
  const target = await findTabById(port, targetId);
  if (!target) throw new Error(`Heap snapshot target ${targetId} disappeared before its URL could be recorded.`);
  const ref = resolveHeapRef(snapshotDir);
  const heap = loadHeap(ref);
  const bytes = fs.statSync(path.join(ref.dir, 'snapshot.heapsnapshot')).size;
  emitResult({
    tag: 'heap-snapshot',
    attrs: { heap: ref.id, path: ref.dir, url: target.url, ...completionAttrs(ref.meta), nodes: heap.nodeCount, edges: heap.edgeCount, bytes },
    summary: text`Chrome's own .heapsnapshot, taken after Chrome's forced pre-snapshot garbage collection. This is the V8 JavaScript heap of one renderer, not the browser process's memory.`,
    artifacts: formatArtifactList([{ name: 'snapshot.heapsnapshot', note: `${bytes} bytes` }]),
    followUp: fact`Query heap snapshot ${resultReference(ref)} with \`capture heap census ${resultReference(ref)}\`, \`capture heap objects ${resultReference(ref)} --constructor <name>\`, or \`capture heap retainers ${resultReference(ref)} --node <object-id>\`.`,
  }, { json: parsed.json });
}
