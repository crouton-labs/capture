import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CAPTURE_ROOT, DIR_MODE, ensurePrivateDir, writeJsonPrivate } from '../../../session/artifacts.js';
import { currentProcessStartIdentity } from '../../../output/artifact-lifecycle.js';
import { TargetIdentity, targetLockKey } from './target.js';
export interface ProcessOwner { readonly pid: number; readonly processStartIdentity: string | null; }
export interface ProcessLiveness { startIdentity(pid: number): string | null; }
const defaultLiveness: ProcessLiveness = { startIdentity: currentProcessStartIdentity };
/** Owner-attested target mutation lock. It has no elapsed-time staleness rule. */
export async function withTargetMutationLock<T>(identity: TargetIdentity, fn: () => Promise<T>, options: { readonly lockRoot?: string; readonly owner?: ProcessOwner; readonly liveness?: ProcessLiveness } = {}): Promise<T> {
  const root = ensurePrivateDir(options.lockRoot ?? path.join(CAPTURE_ROOT, 'target-locks')); const lock = path.join(root, targetLockKey(identity)); const owner = options.owner ?? { pid: process.pid, processStartIdentity: currentProcessStartIdentity() }; const token = crypto.randomUUID(); const liveness = options.liveness ?? defaultLiveness;
  for (;;) { try { fs.mkdirSync(lock, { mode: DIR_MODE }); writeJsonPrivate(path.join(lock, 'owner.json'), { ...owner, token }); break; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; let held: { pid?: unknown; processStartIdentity?: unknown } = {}; try { held = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8')); } catch { /* interrupted ownership is reclaimable */ } if (typeof held.pid === 'number' && typeof held.processStartIdentity === 'string' && liveness.startIdentity(held.pid) === held.processStartIdentity) throw new Error(`target lock is held for ${identity.fullTargetId}`); fs.rmSync(lock, { recursive: true, force: true }); } }
  try { return await fn(); } finally { try { const held = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8')) as { token?: string }; if (held.token === token) fs.rmSync(lock, { recursive: true, force: true }); } catch { /* never delete a replacement owner */ } }
}
