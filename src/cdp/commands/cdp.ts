/**
 * Raw CDP passthrough \u2014 the escape hatch for domains no other capture
 * command wraps (`Browser.grantPermissions`, `ServiceWorker.*`, etc.).
 *
 * `--browser` routes through the HELD connection (see `session start
 * --hold` / `src/cdp/bridge/`) instead of a fresh page/tab websocket.
 * Browser-scoped state (permission grants) and target-scoped state that was
 * enabled on that same connection (`ServiceWorker.enable`, ...) is
 * per-CLIENT and reverts the instant its websocket disconnects, so a plain
 * one-shot call here only lasts for that single command \u2014 running inside a
 * held session is what keeps it alive across commands.
 */

import * as fs from 'fs';
import { getActiveSession } from '../../session-context.js';
import { connectForCommand } from '../connection.js';
import { getBrowserClient, findTabById } from '../targets.js';
import { detectCdpPort } from '../detect.js';
import { sendBridgeRequest } from '../bridge/client.js';
import { type CDPClient } from '../client.js';
import { isRecorderHeldClient } from '../recorder-client.js';
import { type ParsedArgs } from '../types.js';

const DEFAULT_TIMEOUT_MS = 10000;

/** Root-help representation of this leaf, assembled by `src/capture.ts`. */
export const COMMAND_BLOCK = `<command name="cdp">
raw CDP escape hatch — send any protocol method capture doesn't wrap, or wait for a protocol event
use when no other capture command covers the protocol surface you need (Browser.*, ServiceWorker.*, Target.*, ...)
  cdp [<Domain.method>] [--params <json>] [--browser] [--wait-event <name>] — \`capture cdp -h\`
</command>`;

function printHelp(): void {
  console.log(
    `Usage: capture cdp <Domain.method> [--params '<json>'] [--browser] [--target <id>] [--wait-event <Domain.event>] [--timeout <ms>]

Send a raw CDP command \u2014 the escape hatch for domains no other capture
command wraps (Browser.grantPermissions, ServiceWorker.*, Target.*, ...).

  --browser           Route through the held connection (session --hold)
                       instead of a fresh page/tab websocket. Required for
                       state that must survive across separate commands.
  --target <id>       With --browser: attach to this target (a flattened CDP
                       session on the SAME held connection) for target-scoped
                       domains, e.g. ServiceWorker.enable / .deliverPushMessage.
                       Without --browser: the page target to run against, as
                       with every other capture command.
  --params '<json>'   JSON-encoded params object for the method.
  --wait-event <name> Wait for (and return) the next occurrence of a CDP
                       event, e.g. ServiceWorker.workerRegistrationUpdated.
                       Can be combined with a method (sent first) or alone.
  --timeout <ms>      Wait timeout (default: ${DEFAULT_TIMEOUT_MS}ms).

Browser-level and target-enablement state reverts the instant its connection
disconnects \u2014 a one-shot call here only lasts for that single command. Run
inside a held session to keep it alive across commands:

  capture session start --url http://localhost:3000 --hold
  capture cdp Browser.grantPermissions --browser \\
    --params '{"origin":"http://localhost:3000","permissions":["notifications"]}'
  capture cdp ServiceWorker.enable --browser --target <pageTabId>
  capture cdp --browser --target <pageTabId> --wait-event ServiceWorker.workerRegistrationUpdated
  capture cdp ServiceWorker.deliverPushMessage --browser --target <pageTabId> \\
    --params '{"origin":"...","registrationId":"...","data":"..."}'
  capture session stop <session-id>

Without --browser, the method runs against the current page target (session
context or --target), like any other capture command \u2014 e.g. DOM.* or
Accessibility.* calls beyond what \`capture a11y\` exposes.`,
  );
}

export async function cmdCdp(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    printHelp();
    process.exit(0);
  }

  const method = parsed.positional[0];
  if (!method && !parsed.waitEvent) {
    console.error('ERROR: Provide a CDP method (e.g. Browser.grantPermissions) or --wait-event.\n');
    printHelp();
    process.exit(1);
  }

  let params: Record<string, unknown> | undefined;
  if (parsed.params) {
    try {
      params = JSON.parse(parsed.params);
    } catch (err) {
      console.error(`ERROR: --params is not valid JSON: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  }

  const timeoutMs = parsed.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (parsed.browser) {
    await runBrowserScope(method, params, parsed, timeoutMs);
    return;
  }

  await runPageScope(method, params, parsed, timeoutMs);
}

async function runBrowserScope(
  method: string | undefined,
  params: Record<string, unknown> | undefined,
  parsed: ParsedArgs,
  timeoutMs: number,
): Promise<void> {
  const session = getActiveSession();
  if (session?.bridgeSocket && fs.existsSync(session.bridgeSocket)) {
    const resp = await sendBridgeRequest(session.bridgeSocket, {
      method,
      params,
      targetId: parsed.target,
      waitEvent: parsed.waitEvent,
      timeoutMs,
    });
    if (!resp.ok) {
      console.error(`ERROR: ${resp.error}`);
      if (!parsed.target) {
        console.error(
          '\nMany CDP domains (Storage.*, Page.*, DOM.*, Emulation.*, ...) are scoped to a specific ' +
            'tab, not the browser connection as a whole \u2014 sent bare like this, Chrome often rejects them ' +
            'with just "Internal error" and no further detail. Pass --target <tabId> to attach to the tab ' +
            'the call should apply to (run "capture list" to find one).',
        );
      }
      process.exit(1);
    }
    console.log(JSON.stringify({ result: resp.result, event: resp.event }, null, 2));
    return;
  }

  console.error(
    'No held session bridge active \u2014 this connection closes when the command exits, ' +
      'so any browser-level grant or target enablement made here reverts immediately after.\n' +
      'For state that must survive multiple commands: capture session start --hold\n',
  );

  const port = parsed.port ?? (await detectCdpPort());
  const { client } = await getBrowserClient(port);
  try {
    let sessionId: string | undefined;
    if (parsed.target) {
      // Accept the same 8-char-prefix targeting every other capture command
      // promises (see the top-level --help TARGETING section) instead of
      // requiring the full 32-char target id here.
      const tab = await findTabById(port, parsed.target);
      if (!tab) {
        console.error(`ERROR: No target found for "${parsed.target}" on port ${port}. Run "capture list" to see available tabs.`);
        process.exit(1);
      }
      const attached = (await client.send('Target.attachToTarget', {
        targetId: tab.id,
        flatten: true,
      })) as { sessionId: string };
      sessionId = attached.sessionId;
    }
    const eventPromise = parsed.waitEvent ? waitForEventOnce(client, parsed.waitEvent, timeoutMs) : undefined;
    const result = method ? await client.send(method, params ?? {}, 60000, sessionId) : undefined;
    const event = eventPromise ? await eventPromise : undefined;
    console.log(JSON.stringify({ result, event }, null, 2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`ERROR: ${message}`);
    if (!parsed.target) {
      console.error(
        '\nMany CDP domains (Storage.*, Page.*, DOM.*, Emulation.*, ...) are scoped to a specific ' +
          'tab, not the browser connection as a whole \u2014 sent bare like this, Chrome often rejects them ' +
          'with just "Internal error" and no further detail. Pass --target <tabId> to attach to the tab ' +
          `the call should apply to (run "capture list" to find one${method ? `, e.g. capture cdp ${method} --browser --target <tabId> ...` : ''}).`,
      );
    }
    process.exit(1);
  } finally {
    client.close();
  }
}

/**
 * Exported for testing (`test/recorder-navigate-waitevent.test.ts`): the
 * recorder-held branch below (`isRecorderHeldClient(client)`) is the actual
 * command wiring `capture cdp --wait-event` runs under an active recording.
 */
export async function runPageScope(
  method: string | undefined,
  params: Record<string, unknown> | undefined,
  parsed: ParsedArgs,
  timeoutMs: number,
): Promise<void> {
  const { client } = await connectForCommand(parsed);
  try {
    let result: unknown;
    let event: unknown;
    if (isRecorderHeldClient(client)) {
      // The recorder-held adapter's `.on()` is a documented no-op (nothing
      // pushes unsolicited events back over its one-request-one-response
      // socket) — `waitForEventOnce` below would hang until its own timeout.
      // `.waitEvent()`/`.dispatch()` are the real event-wait surface for this
      // adapter, routing the wait through the recorder bridge's own event
      // broker. When both a method and a wait-event are requested,
      // `.dispatch()` carries them in ONE request so the bridge arms the wait
      // before dispatching the call — sending them as two separate requests
      // (`.send()` then `.waitEvent()`) risks the action firing the event
      // before the wait-only request even reaches the bridge. This command has
      // no fragment-nav-style multi-call logic and already throws on an
      // event-wait timeout, so bundling here is a pure simplification with no
      // tradeoff (contrast `../commands/traffic.ts`'s `navigateAtomicWithFragmentFix`).
      if (method) {
        const combined = await client.dispatch(method, params ?? {}, parsed.waitEvent, timeoutMs);
        result = combined.result;
        event = combined.event;
      } else if (parsed.waitEvent) {
        event = await client.waitEvent(parsed.waitEvent, timeoutMs);
      }
    } else {
      const eventPromise = parsed.waitEvent ? waitForEventOnce(client, parsed.waitEvent, timeoutMs) : undefined;
      result = method ? await client.send(method, params ?? {}) : undefined;
      event = eventPromise ? await eventPromise : undefined;
    }
    console.log(JSON.stringify({ result, event }, null, 2));
  } finally {
    client.close();
  }
}

function waitForEventOnce(client: CDPClient, eventName: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs}ms waiting for event "${eventName}"`)),
      timeoutMs,
    );
    client.on(eventName, (params) => {
      clearTimeout(timer);
      resolve(params);
    });
  });
}
