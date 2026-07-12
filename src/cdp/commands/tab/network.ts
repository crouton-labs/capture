/**
 * `capture tab network <offline|online>` — connection-level network
 * emulation for a tab via `Network.emulateNetworkConditions`. Emits a
 * `<network>` block; the one genuinely natural next call after going
 * offline (restoring connectivity) is the block's `follow_up`.
 */
import { withConnection } from '../../connection.js';
import { getActiveSession, setActiveNetworkOffline } from '../../../session-context.js';
import { type ParsedArgs } from '../../types.js';
import {
  emitResult,
  fact,
  text,
  type RenderableResult,
} from '../../../output/render.js';

const USAGE = `capture tab network — toggle connection-level network emulation for a tab.

input:
  <offline|online>   required — offline blocks HTTP requests and drops WebSocket connections; online restores connectivity
  --target <id> | --url <pattern> | --port <port>   tab targeting (default: the active session's tab)

output: <network mode=…> — the emulation state applied to the tab.
effects: page-observable — Network.emulateNetworkConditions alters the tab's connectivity until set back online.`;

/** Pure `<network>` result builder — exported for tests. */
export function buildNetworkResult(mode: 'offline' | 'online'): RenderableResult {
  const offline = mode === 'offline';
  return {
    tag: 'network',
    attrs: { mode },
    summary: offline
      ? text`network emulation applied: offline — HTTP requests blocked, WebSocket connections drop.`
      : text`network emulation applied: online — connectivity restored.`,
    ...(offline ? { followUp: text`capture tab network online` } : {}),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function cmdTabNetwork(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  const mode = parsed.positional[0];
  if (mode !== 'offline' && mode !== 'online') {
    emitResult(
      {
        tag: 'error',
        attrs: { command: 'tab network', code: 'invalid_argument' },
        summary: fact`received: \`${mode ?? ''}\`; expected: capture tab network <offline|online>.`,
      },
      { json: parsed.json },
    );
    process.exit(1);
  }

  const offline = mode === 'offline';
  try {
    await withConnection(
      parsed,
      async (client, tab) => {
        await client.send('Network.enable');
        await client.send('Network.emulateNetworkConditions', {
          offline,
          latency: offline ? -1 : 0,
          downloadThroughput: offline ? 0 : -1,
          uploadThroughput: offline ? 0 : -1,
        });
        // Only a command aimed at the active session's own tab changes the
        // state later independent command connections must inherit.
        if (getActiveSession()?.targetId === tab.id) setActiveNetworkOffline(offline);
      },
      { settle: 0 },
    );
  } catch (err) {
    emitResult(
      {
        tag: 'error',
        attrs: { command: 'tab network', code: 'connection_failed' },
        summary: fact`received: \`${mode}\`; connecting to the tab failed: ${errorMessage(err)}`,
      },
      { json: parsed.json },
    );
    process.exit(1);
  }

  emitResult(buildNetworkResult(mode), { json: parsed.json });
}
