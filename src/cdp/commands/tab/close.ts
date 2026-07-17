import { captureError, invalidInput } from '../../../errors.js';
import { detectCdpPort } from '../../detect.js';
import { closeTarget, findTabById } from '../../targets.js';
import { getActiveSession } from '../../../session-context.js';
import { withSessionScopeLifecycle } from '../../../session/coordinator.js';
import { type CDPTarget, type ParsedArgs } from '../../types.js';
import {
  data,
  emitResult,
  fact,
  line,
  text,
  type RenderableResult,
} from '../../../output/render.js';

const USAGE = `capture tab close — close one explicitly identified background browser tab.

input:
  <target>        required — full tab target id or an unambiguous 8-character prefix
  --port <port>   CDP endpoint (default: the auto-discovered preferred endpoint)

output: <tab-closed port=… target=…> — the closed tab's full target id and last observed URL.
effects: closes exactly one page tab. Refuses unless any active session's background-tab ownership is known, and never closes that session's tab; reset or stop the session first.`;

export function buildTabClosedResult(tab: CDPTarget, port: number): RenderableResult {
  return {
    tag: 'tab-closed',
    attrs: { port, target: tab.id },
    summary: line(text`tab `, data(tab.id.slice(0, 8)), text` closed: `, data(tab.url, 300)),
  };
}

export async function cmdTabClose(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  const target = parsed.positional[0];
  if (!target) {
    throw invalidInput('received: no target; expected: capture tab close <target> [--port <port>].', 'missing_argument');
  }
  if (target.length < 8) {
    throw invalidInput(`received: target ${target}; expected: a full target id or an unambiguous prefix of at least 8 characters.`, 'target_prefix_too_short');
  }

  let port: number;
  try {
    port = parsed.port ?? await detectCdpPort();
  } catch {
    throw captureError(
      'world',
      'no_cdp_endpoint',
      'received: no --port, and no CDP endpoint was discovered on localhost; expected: a running CDP-enabled browser (or an explicit --port <port>). capture tab list probes every localhost CDP endpoint.',
    );
  }

  const tab = await withSessionScopeLifecycle(async () => {
    let resolved: CDPTarget | null;
    try {
      resolved = await findTabById(port, target);
    } catch (error) {
      throw captureError('precondition', 'target_unavailable', `received: target ${target} on port ${port}; expected: one unambiguous page-tab target id. ${error instanceof Error ? error.message : String(error)}`, error);
    }
    if (!resolved || resolved.type !== 'page') {
      throw captureError(
        'precondition',
        'target_unavailable',
        `received: target ${target} on port ${port}; expected: one existing page-tab target id (8-character prefix accepted). capture tab list shows available tabs.`,
      );
    }

    const active = getActiveSession();
    if (active && !active.targetId) {
      throw captureError(
        'precondition',
        'active_session_target_unknown',
        `session ${active.sessionId} has not established its target yet, so capture tab close cannot prove ${resolved.id} is a background tab. Target the session with a page command first, or stop the session with capture session stop ${active.sessionId}.`,
      );
    }
    if (active?.targetId === resolved.id) {
      throw captureError(
        'precondition',
        'active_session_target',
        `target ${resolved.id} is the active session ${active.sessionId}'s tab; capture tab close never leaves an active session pointing at a closed target. Use capture tab reset <url> to replace it or capture session stop ${active.sessionId} first.`,
      );
    }

    try {
      await closeTarget(port, resolved.id);
    } catch (error) {
      throw captureError('world', 'close_failed', `closing target ${resolved.id} on port ${port} failed: ${error instanceof Error ? error.message : String(error)}`, error);
    }
    return resolved;
  });

  emitResult(buildTabClosedResult(tab, port), { json: parsed.json });
}
