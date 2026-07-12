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
 *
 * Output: one `<cdp-result>` block via `src/output/render.ts` \u2014 the protocol
 * result/event as a capped inline data payload, mirrored at full fidelity
 * under `--json` (D11). Params stay inline `--params <json>`, a documented
 * spec deviation: raw CDP params are small protocol-defined objects and this
 * leaf is the diagnostic escape hatch, so file indirection buys nothing.
 */

import * as fs from 'fs';
import { getActiveSession } from '../../session-context.js';
import { connectForCommand } from '../connection.js';
import { getBrowserClient, findTabById } from '../targets.js';
import { detectCdpPort } from '../detect.js';
import { sendBridgeRequest } from '../bridge/client.js';
import { isRecorderHeldClient } from '../recorder-client.js';
import { type ParsedArgs } from '../types.js';
import {
  capped,
  data,
  emitResult,
  fact,
  line,
  text,
  type FactLine,
} from '../../output/render.js';

const DEFAULT_TIMEOUT_MS = 10000;

/** Generous inline cap for the protocol result/event payload (D11): big
 * enough for typical protocol objects, still bounded in the prose block.
 * `--json` carries the payload uncapped (full fidelity). */
const GENEROUS_RESULT_CAP = 4000;

/** Root-help representation of this leaf, assembled by `src/capture.ts`. */
export const COMMAND_BLOCK = `<command name="cdp">
raw CDP escape hatch — send any protocol method capture doesn't wrap, or wait for a protocol event
use when no other capture command covers the protocol surface you need (Browser.*, ServiceWorker.*, Target.*, ...)
  cdp [<Domain.method>] [--params <json>] [--browser] [--wait-event <name>] — \`capture cdp -h\`
</command>`;

const HELP = `capture cdp — send a raw CDP protocol method and/or wait for a protocol event: the escape hatch for domains no other capture command wraps (Browser.*, ServiceWorker.*, Target.*, ...).

Input:
  <Domain.method>              protocol method to send. At least one of <Domain.method> / --wait-event is required.
  --params <json>              JSON-encoded params object for the method. Spec deviation: params stay inline JSON (no file indirection) — raw CDP params are small protocol-defined objects.
  --wait-event <Domain.event>  wait for (and return) the next occurrence of a protocol event; combinable with a method (the method is sent first) or usable alone.
  --browser                    route through the held connection (session start --hold) instead of a one-shot page websocket. Connection-scoped state (permission grants, domain enables) reverts the instant its connection closes — it survives across commands only inside a held session.
  --target <id>                with --browser: attach a flattened CDP session on the held connection to this target (for target-scoped domains); without --browser: the page target to run against. 8-char id prefix accepted.
  --timeout <ms>               event-wait timeout (default ${DEFAULT_TIMEOUT_MS}ms).

Output:
  <cdp-result method=… wait-event=… scope=…> — the protocol result and/or awaited event as an escaped, length-capped JSON payload. --json mirrors the same block with the payload at full fidelity.

Effects:
  Sends the method verbatim to the browser — whatever browser/page state the protocol call mutates, it mutates. Writes no artifacts.`;

/**
 * The minimal client surface both scopes drive. Satisfied structurally by
 * `CDPClient`, `RecorderHeldClient`, and test stubs \u2014 the injectable
 * `connect` parameter on `runPageScope` exists so tests can exercise the
 * command wiring against a stub without a live browser.
 */
export interface CdpScopeClient {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (params: unknown) => void): void;
  close(): void;
}

export interface CdpResultOptions {
  method?: string;
  waitEvent?: string;
  scope: 'browser' | 'page';
  target?: string;
  result?: unknown;
  event?: unknown;
  json?: boolean;
}

/**
 * Emit the `<cdp-result>` block. The protocol result/event is embedded as a
 * JSON-stringified data payload: capped at `GENEROUS_RESULT_CAP` in prose,
 * uncapped (full fidelity) under `--json`. Exported for `test/cdp-command.test.ts`.
 */
export function emitCdpResult(opts: CdpResultOptions): void {
  const sections: FactLine[] = [];
  const payloadCap = (payload: string): number => (opts.json ? payload.length : GENEROUS_RESULT_CAP);
  if (opts.method) {
    const payload = JSON.stringify(opts.result) ?? 'undefined';
    sections.push(line(text`result: `, data(capped(payload, payloadCap(payload)))));
  }
  if (opts.waitEvent) {
    const payload = JSON.stringify(opts.event) ?? 'undefined';
    sections.push(line(text`event: `, data(capped(payload, payloadCap(payload)))));
  }
  emitResult(
    {
      tag: 'cdp-result',
      attrs: {
        method: opts.method,
        'wait-event': opts.waitEvent,
        scope: opts.scope,
        target: opts.target,
      },
      sections,
    },
    { json: opts.json },
  );
}

function emitCdpError(opts: {
  code: string;
  summary: FactLine;
  followUp?: FactLine;
  json?: boolean;
}): never {
  emitResult(
    {
      tag: 'error',
      attrs: { command: 'cdp', code: opts.code },
      summary: opts.summary,
      followUp: opts.followUp,
    },
    { json: opts.json },
  );
  process.exit(1);
}

/** Recovery line for a rejected bare (target-less) protocol call: many CDP
 * domains are tab-scoped, and Chrome often rejects them with only "Internal
 * error" when sent on the bare browser connection. */
const TAB_SCOPE_RECOVERY = text`Many CDP domains (Storage.*, Page.*, DOM.*, Emulation.*, ...) are tab-scoped, not connection-scoped — re-run with --target <tabId> (\`capture tab list\` shows available tabs).`;

export async function cmdCdp(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(HELP);
    process.exit(0);
  }

  const method = parsed.positional[0];
  if (!method && !parsed.waitEvent) {
    emitCdpError({
      code: 'missing_method_and_event',
      summary: text`received: neither a <Domain.method> positional nor --wait-event; expected: at least one of the two.`,
      followUp: text`Run \`capture cdp -h\` for the input schema.`,
      json: parsed.json,
    });
  }

  let params: Record<string, unknown> | undefined;
  if (parsed.params) {
    try {
      params = JSON.parse(parsed.params);
    } catch (err) {
      emitCdpError({
        code: 'invalid_params_json',
        summary: fact`received: --params that is not valid JSON (${err instanceof Error ? err.message : String(err)}); expected: a JSON-encoded params object.`,
        json: parsed.json,
      });
    }
  }

  const timeoutMs = parsed.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (parsed.browser) {
    await runBrowserScope(method, params, parsed, timeoutMs);
    return;
  }

  try {
    await runPageScope(method, params, parsed, timeoutMs);
  } catch (err) {
    emitCdpError({
      code: 'cdp_failed',
      summary: fact`\`${invocationLabel(method, parsed.waitEvent)}\` failed on the page connection: ${err instanceof Error ? err.message : String(err)}`,
      json: parsed.json,
    });
  }
}

function invocationLabel(method: string | undefined, waitEvent: string | undefined): string {
  return method ?? `--wait-event ${waitEvent}`;
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
      emitCdpError({
        code: 'cdp_failed',
        summary: fact`\`${invocationLabel(method, parsed.waitEvent)}\` failed over the held connection: ${resp.error ?? 'unknown bridge error'}`,
        followUp: parsed.target ? undefined : TAB_SCOPE_RECOVERY,
        json: parsed.json,
      });
    }
    emitCdpResult({
      method,
      waitEvent: parsed.waitEvent,
      scope: 'browser',
      target: parsed.target,
      result: resp.result,
      event: resp.event,
      json: parsed.json,
    });
    return;
  }

  // In-flight diagnostic (stderr): the one-shot connection semantics fact.
  console.error(
    'No held session bridge active \u2014 this one-shot connection closes when the command exits, ' +
      'so any browser-level grant or target enablement made here reverts immediately after.',
  );

  const port = parsed.port ?? (await detectCdpPort());
  const { client } = await getBrowserClient(port);
  try {
    let sessionId: string | undefined;
    if (parsed.target) {
      // Accept the same 8-char-prefix targeting every other capture command
      // promises (see the root help's targeting contract) instead of
      // requiring the full 32-char target id here.
      const tab = await findTabById(port, parsed.target);
      if (!tab) {
        emitCdpError({
          code: 'target_not_found',
          summary: fact`received: --target ${parsed.target} with no matching target on port ${port}; expected: an existing target id (8-char prefix accepted).`,
          followUp: text`\`capture tab list\` shows available targets.`,
          json: parsed.json,
        });
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
    emitCdpResult({
      method,
      waitEvent: parsed.waitEvent,
      scope: 'browser',
      target: parsed.target,
      result,
      event,
      json: parsed.json,
    });
  } catch (err) {
    emitCdpError({
      code: 'cdp_failed',
      summary: fact`\`${invocationLabel(method, parsed.waitEvent)}\` failed on the one-shot browser connection: ${err instanceof Error ? err.message : String(err)}`,
      followUp: parsed.target ? undefined : TAB_SCOPE_RECOVERY,
      json: parsed.json,
    });
  } finally {
    client.close();
  }
}

/**
 * Exported for testing (`test/recorder-navigate-waitevent.test.ts`,
 * `test/cdp-command.test.ts`): the recorder-held branch below
 * (`isRecorderHeldClient(client)`) is the actual command wiring
 * `capture cdp --wait-event` runs under an active recording, and the
 * injectable `connect` lets `test/cdp-command.test.ts` drive the non-held
 * branch against a stub client.
 */
export async function runPageScope(
  method: string | undefined,
  params: Record<string, unknown> | undefined,
  parsed: ParsedArgs,
  timeoutMs: number,
  connect: (parsed: ParsedArgs) => Promise<{ client: CdpScopeClient }> = connectForCommand,
): Promise<void> {
  const { client } = await connect(parsed);
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
    emitCdpResult({
      method,
      waitEvent: parsed.waitEvent,
      scope: 'page',
      target: parsed.target,
      result,
      event,
      json: parsed.json,
    });
  } finally {
    client.close();
  }
}

function waitForEventOnce(client: CdpScopeClient, eventName: string, timeoutMs: number): Promise<unknown> {
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
