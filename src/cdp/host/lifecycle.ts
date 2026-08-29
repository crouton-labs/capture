import * as fs from 'node:fs';
import * as path from 'node:path';
import { stopBridge } from '../bridge/spawn.js';
import { processPidBirthProvider, readPrivateFile, removeArtifactTree, sameBirth, unlinkPrivateFile, writeJsonPrivate } from '../../session/artifacts.js';
import { collectorKind, COLLECTOR_KINDS } from './kinds.js';
import { sendHostRequest } from './client.js';
import { scanCollectorHost, type CollectorHostHandle } from './handle.js';
import type { CollectorKind, TeardownOutcome } from './collector.js';

export type CollectorHostTeardown =
  | { status: 'absent' }
  | { status: 'drained'; outcomes: readonly TeardownOutcome[] }
  | { status: 'reaped'; outcomes: readonly TeardownOutcome[] }
  | { status: 'terminal'; error: string };

export class TerminalCollectorHostStopFailure extends Error {
  constructor(readonly outcome: Extract<CollectorHostTeardown, { status: 'terminal' }>) {
    super(`collector host teardown failed: ${outcome.error}`);
    this.name = 'TerminalCollectorHostStopFailure';
  }
}

export function isTerminalCollectorHostStopFailure(error: unknown): error is TerminalCollectorHostStopFailure {
  return error instanceof TerminalCollectorHostStopFailure;
}

function isCollectorKind(value: unknown): value is CollectorKind {
  return typeof value === 'string' && value in COLLECTOR_KINDS;
}

function readCollecting(dir: string): { id: string; kind: CollectorKind; startedAt: string } | null {
  try {
    const raw = JSON.parse(readPrivateFile(path.join(dir, 'collecting.json')).toString('utf8')) as Record<string, unknown>;
    if (typeof raw.id !== 'string' || !isCollectorKind(raw.kind) || typeof raw.startedAt !== 'string') return null;
    return { id: raw.id, kind: raw.kind, startedAt: raw.startedAt };
  } catch {
    return null;
  }
}

function collectingDirectories(root: string): string[] {
  const dirs: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some(entry => entry.isFile() && entry.name === 'collecting.json')) dirs.push(dir);
    for (const entry of entries) if (entry.isDirectory()) walk(path.join(dir, entry.name));
  };
  walk(root);
  return dirs;
}

function reapOrphanedCollectors(sessionDir: string): TeardownOutcome[] {
  const outcomes: TeardownOutcome[] = [];
  for (const dir of collectingDirectories(sessionDir)) {
    const collecting = readCollecting(dir);
    if (!collecting) continue;
    try {
      const reconstructed = collectorKind(collecting.kind).reconstruct(dir);
      const summary = reconstructed.summary && typeof reconstructed.summary === 'object' && !Array.isArray(reconstructed.summary)
        ? reconstructed.summary as Record<string, unknown>
        : { value: reconstructed.summary };
      writeJsonPrivate(path.join(dir, 'meta.json'), {
        id: collecting.id,
        kind: collecting.kind,
        completion: 'orphaned',
        reason: 'host_died',
        startedAt: collecting.startedAt,
        endedAt: new Date().toISOString(),
        files: reconstructed.files,
        summary,
        ...summary,
      });
      unlinkPrivateFile(path.join(dir, 'collecting.json'));
      outcomes.push({ status: 'reaped', id: collecting.id, kind: collecting.kind, dir });
    } catch (error) {
      outcomes.push({ status: 'terminal', id: collecting.id, kind: collecting.kind, dir, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return outcomes;
}

async function waitForHostExit(handle: CollectorHostHandle, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const observed = processPidBirthProvider.read(handle.pid);
    if (observed.status === 'absent' || (observed.status === 'found' && !sameBirth(observed.identity, handle.birth))) return;
    if (Date.now() >= deadline) {
      stopBridge(handle.pid, handle.socketPath);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

function terminal(error: string): CollectorHostTeardown {
  return { status: 'terminal', error };
}

/** Stops a session's host before immutable bundle construction. A terminal result means the caller must not commit. */
export async function stopAndReapCollectorHostAtSessionStop(sessionDir: string): Promise<CollectorHostTeardown> {
  const scanned = scanCollectorHost(sessionDir);
  if (scanned.classification === 'absent') return { status: 'absent' };
  if (!scanned.handle) return terminal(`collector host handle is ${scanned.classification}`);
  if (scanned.classification === 'unknown') return terminal('collector host liveness is unknown');
  if (scanned.classification === 'dead') {
    const outcomes = reapOrphanedCollectors(sessionDir);
    removeArtifactTree(scanned.path);
    const failure = outcomes.find(outcome => outcome.status === 'terminal');
    return failure ? terminal(failure.error) : { status: 'reaped', outcomes };
  }
  try {
    const response = await sendHostRequest(scanned.handle.socketPath, { type: 'session-teardown', nonce: scanned.handle.nonce }, 30_000);
    if (!response.ok) return terminal(response.error ?? 'collector host refused session teardown');
    const outcomes = Array.isArray(response.outcomes) ? response.outcomes as TeardownOutcome[] : [];
    const failure = outcomes.find(outcome => outcome.status === 'terminal');
    if (failure) return terminal(failure.error);
    await waitForHostExit(scanned.handle);
    return { status: 'drained', outcomes };
  } catch (error) {
    return terminal(error instanceof Error ? error.message : String(error));
  }
}
