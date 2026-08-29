import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CDPClient } from '../client.js';
import { findTabByIdAcrossEndpoints } from '../targets.js';
import { closeNdjsonSocket, installProcessCleanup, listenNdjsonSocket } from '../bridge/server.js';
import { collectorHostSocketPath } from '../bridge/spawn.js';
import { processPidBirthProvider, removeArtifactTree, writeJsonPrivate } from '../../session/artifacts.js';
import { readSessionState } from '../../session-context.js';
import { applyActiveSessionNetworkConditions } from '../connection.js';
import { CollectorHost, type HostSnapshot } from './core.js';
import type { CollectorKind } from './collector.js';

export interface RunCollectorHostOptions { socketPath: string; sessionDir: string; targetId: string; port: number; }

function sameNonce(expected: string, actual: unknown): boolean {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(expected); const b = Buffer.from(actual);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function runCollectorHost(options: RunCollectorHostOptions): Promise<void> {
  if (options.socketPath !== collectorHostSocketPath(options.sessionDir)) throw new Error('collector host socket path must match its session');
  const target = await findTabByIdAcrossEndpoints(options.targetId, options.port);
  if (!target?.tab.webSocketDebuggerUrl) throw new Error(`No tab found for target "${options.targetId}" on port ${options.port}.`);
  const birth = processPidBirthProvider.read(process.pid);
  if (birth.status !== 'found') throw new Error('could not establish collector host process identity');
  const nonce = crypto.randomBytes(32).toString('hex');
  const client = new CDPClient(target.tab.webSocketDebuggerUrl);
  await client.waitReady();
  const session = readSessionState(options.sessionDir);
  if (session.targetId !== options.targetId) throw new Error('collector host target does not match session state');
  await applyActiveSessionNetworkConditions(client, session, options.targetId);
  let server: import('node:net').Server | undefined;
  const handlePath = path.join(options.sessionDir, '.collector-host.json');
  const publish = (snapshot: HostSnapshot): void => writeJsonPrivate(handlePath, {
    pid: process.pid, birth: birth.identity, socketPath: options.socketPath, targetId: options.targetId, nonce, startedAt: new Date().toISOString(), ...snapshot,
  });
  const cleanup = (): void => {
    if (server) closeNdjsonSocket(server, options.socketPath);
    try { client.close(); } catch {}
  };
  const host = new CollectorHost(client, options.sessionDir, { pid: process.pid, birth: birth.identity, targetId: options.targetId }, publish, () => {
    cleanup();
    try { removeArtifactTree(handlePath); } catch {}
  });
  publish(host.snapshot());
  server = await listenNdjsonSocket(options.socketPath, async (line, socket) => {
    let request: Record<string, unknown>;
    try { request = JSON.parse(line) as Record<string, unknown>; } catch { return; }
    const reqId = typeof request.reqId === 'number' ? request.reqId : 0;
    const type = typeof request.type === 'string' ? request.type : 'cdp';
    const answer = (body: Record<string, unknown>): void => { socket.write(JSON.stringify({ reqId, type, ...body }) + '\n'); };
    if (!sameNonce(nonce, request.nonce)) { answer({ ok: false, error: 'unauthorized' }); return; }
    try {
      switch (type) {
        case 'host-status': answer({ ok: true, ...host.snapshot() }); return;
        case 'claim-reserve': {
          const claims = Array.isArray(request.claims) ? request.claims as never : [];
          const reservation = host.reserve(claims, String(request.holderLabel ?? 'external command'), Number(request.pid), request.birth as never, request.exclusive === true);
          answer({ ok: true, reservation }); return;
        }
        case 'claim-release': host.releaseReservation(String(request.token ?? '')); answer({ ok: true }); return;
        case 'collector-start': {
          const row = await host.start(request.kind as CollectorKind, request.config);
          answer({ ok: true, collector: row }); return;
        }
        case 'collector-stop': answer({ ok: true, ...(await host.stop(String(request.id ?? ''))) }); return;
        case 'session-teardown': answer({ ok: true, outcomes: await host.teardown('session-stop') }); cleanup(); return;
        case 'har-flush': await host.control({ type: 'har-flush' }); answer({ ok: true }); return;
        case 'cdp': {
          const dispatched = await host.dispatch(
            String(request.method ?? ''),
            request.params as Record<string, unknown> ?? {},
            typeof request.annotation === 'string' ? request.annotation : undefined,
            typeof request.waitEvent === 'string' ? request.waitEvent : undefined,
            typeof request.timeoutMs === 'number' ? request.timeoutMs : undefined,
          ) as { result?: unknown; event?: unknown; waitOutcome?: unknown };
          answer({ ok: true, ...(dispatched && typeof dispatched === 'object' ? dispatched as Record<string, unknown> : { result: dispatched }) });
          return;
        }
        default: answer({ ok: false, error: `unknown collector host request: ${type}` }); return;
      }
    } catch (error) { answer({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });
  installProcessCleanup(() => { host.abandon(); cleanup(); }, client);
}
