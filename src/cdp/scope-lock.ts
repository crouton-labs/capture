/**
 * Cross-caller serialization for target-scoped multi-request CDP state
 * scopes (A2): focus emulation (`page exec`), the device-metrics/viewport
 * override (screenshot capture), and the Accessibility domain (full AX tree
 * reads). Each scope is an enable→work→restore sequence whose intermediate
 * state lives on the connection. A DIRECT connection needs no serialization —
 * its emulation/domain state is scoped to its own websocket session, which
 * closes with the command. The motion collector, however, holds ONE persistent
 * tab connection whose state outlives any single command, so two concurrent
 * routed callers could otherwise clear/disable one another's live state
 * (its dispatch is strictly per-request and provides no serialization).
 * When the client is the motion-held adapter, the whole scope therefore runs
 * under the owning session's private
 * cross-process lock (`.<scope>-scope.lock`, the shared `acquirePrivateLock`
 * authority every session lock uses).
 */
import * as path from 'path';
import { acquirePrivateLock } from '../session/artifacts.js';
import { getActiveSession } from '../session-context.js';
import { captureError } from '../errors.js';
import { isMotionHeldClient } from './host/held-client.js';

export interface ScopeSerializationDeps {
  isMotionHeldClient: (client: unknown) => boolean;
  getActiveSession: typeof getActiveSession;
}

let deps: ScopeSerializationDeps = { isMotionHeldClient, getActiveSession };

/** Swap the held-client/session seams for the CDP-stub tests. */
export function __setScopeSerializationDepsForTest(overrides: Partial<ScopeSerializationDeps>): () => void {
  const previous = deps;
  deps = { ...deps, ...overrides };
  return () => { deps = previous; };
}

/**
 * Runs `fn` — one complete state scope against `client` — serialized under
 * the active session's `.<scope>-scope.lock` when the client is the
 * recorder-held adapter; a direct connection runs it unlocked. `command`
 * names the caller in the missing-session failure. Callers with their own
 * injectable dependency seam (`page exec`) pass `overrides` so one seam
 * controls the whole branch; everyone else uses this module's defaults.
 */
export async function withScopeSerialization<T>(
  client: unknown,
  scope: string,
  command: string,
  fn: () => Promise<T>,
  overrides?: ScopeSerializationDeps,
): Promise<T> {
  const d = overrides ?? deps;
  if (!d.isMotionHeldClient(client)) {
    return fn();
  }
  const session = d.getActiveSession();
  if (!session) {
    throw captureError(
      'internal',
      'recorder_session_missing',
      `${command} was routed through a recorder-held connection but no active session exists to serialize its ${scope} scope.`,
    );
  }
  const lock = await acquirePrivateLock(path.join(session.dir, `.${scope}-scope.lock`), {
    acquireTimeoutMs: 120_000,
    leaseMs: 60_000,
  });
  try {
    return await fn();
  } finally {
    lock.release();
  }
}
