import * as fs from 'node:fs';
import * as path from 'node:path';
import { captureError } from '../../../errors.js';
import { HeapSnapshot } from '../../heap-snapshot.js';
import { assertUnderCaptureRoot, readPrivateFile } from '../../../session/artifacts.js';
import { getActiveSession } from '../../../session-context.js';
import type { ResolvedCompletion } from '../../host/collector.js';

export interface HeapMeta {
  id: string;
  completion: ResolvedCompletion;
  reason?: string;
  url?: string;
  files: readonly { name: string; bytes: number }[];
}

export interface HeapRef {
  readonly kind: 'heap';
  readonly id: string;
  readonly dir: string;
  readonly meta: HeapMeta;
}

function readHeapMeta(dir: string, ref: string): HeapMeta {
  const metaPath = path.join(dir, 'meta.json');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readPrivateFile(metaPath).toString('utf8')) as Record<string, unknown>;
  } catch (error) {
    throw captureError('artifact', 'heap_ref_unavailable', `Could not read finalized heap snapshot ${JSON.stringify(ref)} at ${dir}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (raw.kind !== 'heap' || typeof raw.id !== 'string' || !['complete', 'partial', 'orphaned'].includes(String(raw.completion))) {
    throw captureError('artifact', 'heap_ref_unavailable', `Artifact ${JSON.stringify(ref)} is not a finalized heap snapshot.`);
  }
  const files = Array.isArray(raw.files) && raw.files.every(file => file && typeof file === 'object' && typeof (file as { name?: unknown }).name === 'string' && typeof (file as { bytes?: unknown }).bytes === 'number')
    ? raw.files as Array<{ name: string; bytes: number }>
    : [];
  const snapshot = files.find(file => file.name === 'snapshot.heapsnapshot');
  let completion = raw.completion as ResolvedCompletion;
  if (!snapshot || !fs.existsSync(path.join(dir, 'snapshot.heapsnapshot')) || fs.statSync(path.join(dir, 'snapshot.heapsnapshot')).size !== snapshot.bytes) completion = 'truncated';
  return { id: raw.id, completion, ...(typeof raw.reason === 'string' ? { reason: raw.reason } : {}), ...(typeof raw.url === 'string' ? { url: raw.url } : {}), files };
}

export function resolveHeapRef(ref: string): HeapRef {
  let dir: string;
  if (path.isAbsolute(ref)) {
    dir = assertUnderCaptureRoot(ref);
  } else {
    if (ref.includes('/') || ref.includes(path.sep)) throw captureError('invocation', 'heap_ref_invalid', 'Heap snapshot references must be a bare id or an absolute artifact path.');
    const active = getActiveSession();
    if (!active) throw captureError('precondition', 'heap_ref_unavailable', `A bare heap snapshot id (${ref}) requires an active capture session; pass the absolute path printed by capture heap snapshot.`);
    dir = assertUnderCaptureRoot(path.join(active.dir, 'heap', 'snapshots', ref));
  }
  return { kind: 'heap', id: path.basename(dir), dir, meta: readHeapMeta(dir, ref) };
}

export function loadHeap(ref: HeapRef): HeapSnapshot {
  const snapshotPath = path.join(ref.dir, 'snapshot.heapsnapshot');
  if (ref.meta.completion === 'truncated' || !fs.existsSync(snapshotPath)) {
    throw captureError('artifact', 'heap_snapshot_truncated', `Heap snapshot ${ref.id} is ${ref.meta.completion}; snapshot.heapsnapshot does not match its finalized inventory.`);
  }
  try {
    return HeapSnapshot.parse(readPrivateFile(snapshotPath).toString('utf8'));
  } catch (error) {
    throw captureError('artifact', 'heap_snapshot_invalid', `Heap snapshot ${ref.id} could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function completionAttrs(meta: HeapMeta): { completion: ResolvedCompletion; 'completion-reason'?: string } {
  return { completion: meta.completion, ...(meta.completion !== 'complete' && meta.reason ? { 'completion-reason': meta.reason } : {}) };
}

export function resultReference(ref: HeapRef): string {
  const active = getActiveSession();
  return active && path.join(active.dir, 'heap', 'snapshots', ref.id) === ref.dir ? ref.id : ref.dir;
}
