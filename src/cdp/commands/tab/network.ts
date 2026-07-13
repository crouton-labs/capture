/**
 * `capture tab network <offline|online>` — connection-level network
 * emulation for the active session's held tab via
 * `Network.emulateNetworkConditions`.
 *
 * Emulation is only meaningful while the CDP connection that applied it stays
 * open, so this leaf refuses to run except against an active session that owns
 * a live `session start --hold` bridge. It sends `Network.enable` +
 * `Network.emulateNetworkConditions` through that exact bridge, scoped to the
 * session's own target, and reports the truthful owner (`session-hold`) and the
 * lifetime of the emulation — until a matching `online` or the session stops.
 */
import * as fs from 'node:fs';
import { captureError } from '../../../errors.js';
import { getActiveSession, setActiveNetworkOffline } from '../../../session-context.js';
import { admitSessionOperation } from '../../../session/coordinator.js';
import { sendBridgeRequest } from '../../bridge/client.js';
import { type ParsedArgs } from '../../types.js';
import {
  emitResult,
  fact,
  text,
  type RenderableResult,
} from '../../../output/render.js';

const USAGE = `capture tab network — toggle connection-level network emulation for the active session's held tab.

input:
  <offline|online>   required — offline blocks HTTP requests and drops WebSocket connections; online restores connectivity
  --target <id>      optional — must equal the active session's target; --url is not accepted
  --port <port>      optional — must equal the active session's port

output: <network mode=… owner="session-hold"> — the emulation applied to the session's held tab, and how long it lasts.
effects: page-observable — Network.emulateNetworkConditions is sent through the session's held CDP bridge and stays in effect on that tab until a matching \`capture tab network online\` or the session stops.
requires: an active session with a live \`session start --hold\` bridge and a target; emulation lives only as long as that held connection.`;

/**
 * Pure `<network>` result builder — exported for tests. Reports the factual
 * `session-hold` owner and the lifetime of the emulation; it never promises
 * persistence beyond that owner.
 */
export function buildNetworkResult(mode: 'offline' | 'online', target?: string): RenderableResult {
  const offline = mode === 'offline';
  const attrs: Record<string, string> = { mode, owner: 'session-hold' };
  if (target) attrs.target = target;
  return {
    tag: 'network',
    attrs,
    summary: offline
      ? fact`network emulation applied to the session-hold tab ${target ?? ''}: offline — HTTP requests blocked, WebSocket connections drop. It is held on the session's bridge and lasts until \`capture tab network online\` or the session stops.`
      : fact`network emulation on the session-hold tab ${target ?? ''}: online — connectivity restored; the held offline emulation is cleared.`,
    ...(offline ? { followUp: text`capture tab network online` } : {}),
  };
}

export async function cmdTabNetwork(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  const mode = parsed.positional[0];
  if (mode !== 'offline' && mode !== 'online') {
    throw captureError(
      'invocation',
      'invalid_argument',
      `received: \`${mode ?? ''}\`; expected: capture tab network <offline|online>.`,
    );
  }

  // `tab network` emulates on the active session's held tab; a caller-supplied
  // URL target has no place here. Reject before touching session state.
  if (parsed.url !== undefined) {
    throw captureError(
      'invocation',
      'unsupported_flag',
      'capture tab network does not accept --url; it emulates on the active session\'s held tab.',
    );
  }

  const session = getActiveSession();
  if (!session) {
    throw captureError(
      'precondition',
      'no_active_session',
      'capture tab network requires an active session; start one with `capture session start --hold`.',
    );
  }
  if (!session.targetId) {
    throw captureError(
      'precondition',
      'session_target_missing',
      `session ${session.sessionId} has no target to emulate on; open one with \`capture session start --hold --url <url>\` or \`capture tab reset <url>\`.`,
    );
  }
  if (!session.bridgeSocket || !fs.existsSync(session.bridgeSocket)) {
    throw captureError(
      'precondition',
      'no_held_bridge',
      `session ${session.sessionId} has no live held CDP bridge; network emulation only outlives a command when the session was started with \`session start --hold\`.`,
    );
  }
  // The only target that can be emulated is the session's own. An explicit
  // `--target` unequal to it is a mismatch; an equal one is accepted.
  if (parsed.target !== undefined && parsed.target !== session.targetId) {
    throw captureError(
      'precondition',
      'target_mismatch',
      `received --target ${parsed.target}; capture tab network only emulates the active session's target ${session.targetId}.`,
    );
  }
  // Likewise, an explicitly flagged port must be the session's own port. An
  // equal port is accepted; a mismatch rejects before any bridge send (A4).
  if (parsed.port !== undefined && parsed.port !== session.port) {
    throw captureError(
      'precondition',
      'port_mismatch',
      `received --port ${parsed.port}; capture tab network only emulates on the active session's port ${session.port ?? 'unknown'}.`,
    );
  }

  const offline = mode === 'offline';
  const socket = session.bridgeSocket;
  const targetId = session.targetId;

  const operation = await admitSessionOperation(session.dir);
  try {
    const enable = await sendBridgeRequest(socket, { method: 'Network.enable', targetId });
    if (!enable.ok) {
      throw captureError(
        'world',
        'bridge_error',
        `Network.enable failed over the session's held bridge: ${enable.error || 'unknown bridge error'}`,
      );
    }
    const emulate = await sendBridgeRequest(socket, {
      method: 'Network.emulateNetworkConditions',
      params: {
        offline,
        latency: offline ? -1 : 0,
        downloadThroughput: offline ? 0 : -1,
        uploadThroughput: offline ? 0 : -1,
      },
      targetId,
    });
    if (!emulate.ok) {
      throw captureError(
        'world',
        'bridge_error',
        `Network.emulateNetworkConditions failed over the session's held bridge: ${emulate.error || 'unknown bridge error'}`,
      );
    }
    // Local-main session network retention: record the emulation on the
    // active session so later independent command connections re-apply it
    // (applyActiveSessionNetworkConditions in cdp/connection.ts).
    await setActiveNetworkOffline(offline);
  } finally {
    await operation.release();
  }

  emitResult(buildNetworkResult(mode, targetId), { json: parsed.json });
}
