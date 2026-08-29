import * as fs from 'node:fs';
import * as path from 'node:path';
import { collectorHostSocketPath } from '../bridge/spawn.js';
import { assertUnderCaptureRoot, parseBirth, readPrivateFile, sameBirth, type PidBirth } from '../../session/artifacts.js';
import { processPidBirthProvider } from '../../session/artifacts.js';
import type { CollectorRow } from './core.js';
import type { ClaimReservation } from './collector.js';

export interface CollectorHostHandle {
  pid: number;
  birth: PidBirth;
  socketPath: string;
  targetId: string;
  nonce: string;
  startedAt: string;
  collectors: readonly CollectorRow[];
  reservations: readonly ClaimReservation[];
}
export type CollectorHostClassification = 'absent' | 'live' | 'dead' | 'malformed' | 'unknown';
export interface ScannedCollectorHost { classification: CollectorHostClassification; handle: CollectorHostHandle | null; path: string; }

export function collectorHostPath(sessionDir: string): string { return path.join(assertUnderCaptureRoot(sessionDir), '.collector-host.json'); }
function parseHandle(raw: unknown, sessionDir: string): CollectorHostHandle | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const birth = parseBirth(value.birth);
  if (!birth || !Number.isSafeInteger(value.pid) || (value.pid as number) <= 0 || typeof value.socketPath !== 'string' || value.socketPath !== collectorHostSocketPath(sessionDir) || typeof value.targetId !== 'string' || !value.targetId || typeof value.nonce !== 'string' || !/^[0-9a-f]{64}$/.test(value.nonce) || typeof value.startedAt !== 'string' || !Array.isArray(value.collectors) || !Array.isArray(value.reservations)) return null;
  return value as unknown as CollectorHostHandle;
}

export function scanCollectorHost(sessionDir: string): ScannedCollectorHost {
  const file = collectorHostPath(sessionDir);
  let raw: unknown;
  try { raw = JSON.parse(readPrivateFile(file).toString('utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { classification: 'absent', handle: null, path: file }; return { classification: 'malformed', handle: null, path: file }; }
  const handle = parseHandle(raw, sessionDir);
  if (!handle) return { classification: 'malformed', handle: null, path: file };
  const read = processPidBirthProvider.read(handle.pid);
  if (read.status === 'unknown') return { classification: 'unknown', handle, path: file };
  if (read.status === 'found' && sameBirth(read.identity, handle.birth)) {
    try {
      if (!fs.lstatSync(handle.socketPath).isSocket()) return { classification: 'malformed', handle: null, path: file };
    } catch { return { classification: 'malformed', handle: null, path: file }; }
    return { classification: 'live', handle, path: file };
  }
  return { classification: 'dead', handle, path: file };
}
