import { captureError } from '../../../../errors.js';
import { admitSessionOperation, withSessionLifecycle } from '../../../../session/coordinator.js';
import { getActiveSession } from '../../../../session-context.js';
import { collectorHostSocketPath, startCollectorHost } from '../../../bridge/spawn.js';
import { sendHostRequest } from '../../../host/client.js';
import { scanCollectorHost, type CollectorHostHandle } from '../../../host/handle.js';
import { stopAndReapCollectorHostAtSessionStop } from '../../../host/lifecycle.js';

interface LiveMock { id: string; dir: string; startedAt: string; }
export interface StartedMock extends LiveMock { rules: number; targetId: string; }
export interface StoppedMock extends LiveMock { completion: string; rules: number; paused: number; matched: number; releasedUnmatched: number; ruleMatches: number[]; }

function activeSession(): NonNullable<ReturnType<typeof getActiveSession>> {
  const session = getActiveSession();
  if (!session) throw captureError('precondition', 'no_active_session', 'capture tab mock requires an active session with a target; start one with `capture session start --url <url>`.');
  if (!session.targetId) throw captureError('precondition', 'session_target_missing', `session ${session.sessionId} has no target to mock; start it with a URL or reset its tab first.`);
  return session;
}

function claimHeld(handle: CollectorHostHandle): never {
  const holder = handle.collectors.find(collector => collector.claims.includes('fetch-interception'));
  if (holder) throw captureError('precondition', 'claim_held', `received: capture tab mock start\nexpected: no live collector holding the \`fetch-interception\` claim\nholder: ${holder.kind} collector ${holder.id}, started ${holder.startedAt}\nNext: Run \`capture session collectors\` to see the live roster, stop the holder, then re-issue.`);
  throw captureError('precondition', 'claim_held', 'received: capture tab mock start\nexpected: no live collector holding the `fetch-interception` claim\nNext: Run `capture session collectors` to see the live roster, stop the holder, then re-issue.');
}

async function hostForStart(sessionDir: string, targetId: string, port: number): Promise<CollectorHostHandle> {
  let scanned = scanCollectorHost(sessionDir);
  if (scanned.classification === 'unknown' || scanned.classification === 'malformed') throw captureError('precondition', 'collector_host_unavailable', `session collector host is ${scanned.classification}.`);
  if (scanned.classification === 'dead') {
    const reaped = await stopAndReapCollectorHostAtSessionStop(sessionDir);
    if (reaped.status === 'terminal') throw captureError('cleanup', 'collector_host_reap_failed', reaped.error);
    scanned = scanCollectorHost(sessionDir);
  }
  if (scanned.classification === 'absent') {
    await startCollectorHost(collectorHostSocketPath(sessionDir), port, targetId, sessionDir);
    scanned = scanCollectorHost(sessionDir);
  }
  if (scanned.classification !== 'live' || !scanned.handle) throw captureError('world', 'collector_host_unavailable', 'collector host did not publish a live handle.');
  if (scanned.handle.targetId !== targetId) throw captureError('precondition', 'target_mismatch', 'collector host is bound to a different session target; stop the session before changing tabs.');
  return scanned.handle;
}

export async function startMock(rulesPath: string, rules: number): Promise<StartedMock> {
  const session = activeSession();
  const operation = await admitSessionOperation(session.dir);
  try {
    return await withSessionLifecycle(session.dir, async () => {
      const current = activeSession();
      if (current.dir !== session.dir) throw captureError('precondition', 'session_changed', 'the active session changed while mock startup was waiting for its lifecycle lock.');
      if (!current.port) throw captureError('precondition', 'session_port_missing', 'active session has no CDP port for its target.');
      const host = await hostForStart(current.dir, current.targetId!, current.port);
      if (host.collectors.some(collector => collector.claims.includes('fetch-interception'))) claimHeld(host);
      const response = await sendHostRequest(host.socketPath, { type: 'collector-start', nonce: host.nonce, kind: 'intercept', config: { rulesPath } }, 30_000);
      if (!response.ok || !response.collector || typeof response.collector !== 'object') {
        if ((response.error ?? '').includes('fetch-interception')) claimHeld(host);
        throw captureError('world', 'mock_start_failed', response.error ?? 'collector host refused to start mock');
      }
      const collector = response.collector as { id?: unknown; dir?: unknown };
      if (typeof collector.id !== 'string' || typeof collector.dir !== 'string') throw captureError('internal', 'malformed_collector_response', 'collector host returned a malformed mock collector.');
      return { id: collector.id, dir: collector.dir, startedAt: new Date().toISOString(), rules, targetId: current.targetId! };
    });
  } finally {
    await operation.release();
  }
}

export async function stopMock(): Promise<StoppedMock> {
  const session = activeSession();
  const operation = await admitSessionOperation(session.dir);
  try {
    return await withSessionLifecycle(session.dir, async () => {
      const current = activeSession();
      if (current.dir !== session.dir) throw captureError('precondition', 'session_changed', 'the active session changed while mock shutdown was waiting for its lifecycle lock.');
      const scanned = scanCollectorHost(current.dir);
      if (scanned.classification !== 'live' || !scanned.handle) throw captureError('precondition', 'no_live_mock', `no live mock exists in this session (${scanned.classification}). Start one with \`capture tab mock start --rules <path>\`.`);
      const row = scanned.handle.collectors.find(collector => collector.kind === 'intercept');
      if (!row) throw captureError('precondition', 'no_live_mock', 'no live mock exists in this session. Start one with `capture tab mock start --rules <path>`.');
      const response = await sendHostRequest(scanned.handle.socketPath, { type: 'collector-stop', nonce: scanned.handle.nonce, id: row.id }, 30_000);
      if (!response.ok) throw captureError('world', 'mock_stop_failed', response.error ?? 'collector host refused to stop mock');
      const summary = response.summary && typeof response.summary === 'object' && !Array.isArray(response.summary) ? response.summary as Record<string, unknown> : {};
      const number = (name: string): number => typeof summary[name] === 'number' ? summary[name] as number : 0;
      const ruleMatches = Array.isArray(summary.ruleMatches) && summary.ruleMatches.every(value => typeof value === 'number') ? summary.ruleMatches as number[] : [];
      return { id: row.id, dir: row.dir, startedAt: row.startedAt, completion: typeof response.completion === 'string' ? response.completion : 'partial', rules: number('rules'), paused: number('paused'), matched: number('matched'), releasedUnmatched: number('releasedUnmatched'), ruleMatches };
    });
  } finally {
    await operation.release();
  }
}
