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
import { CaptureError, captureError, invalidInput } from '../../errors.js';
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
  --port <port>                CDP endpoint. An explicit flag selects that endpoint even when an active session holds another browser connection.
  --target <id>                with --browser: attach a flattened CDP session on the held connection to this target (for target-scoped domains), including an already-open tab adopted by \`session start --hold\` without --url; without --browser: the page target to run against. 8-char id prefix accepted.
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

/** The browser-level one-shot client surface: the same shape as {@link CdpScopeClient}
 * plus the flattened-session `send(..., timeout, sessionId)` overload. Satisfied
 * by `CDPClient`; the injectable `deps` on `runBrowserScope` lets tests drive
 * this without a live browser. */
export interface BrowserScopeClient extends CdpScopeClient {
  send(method: string, params?: Record<string, unknown>, timeout?: number, sessionId?: string): Promise<unknown>;
}

/** Seams `runBrowserScope` reaches the browser through — real by default,
 * injectable in `test/cdp-command.test.ts`. */
export interface BrowserScopeDeps {
  sendBridgeRequest: typeof sendBridgeRequest;
  getBrowserClient: (port: number) => Promise<{ client: BrowserScopeClient }>;
  findTabById: (port: number, targetId: string) => Promise<{ id: string } | null>;
  detectCdpPort: typeof detectCdpPort;
}

const DEFAULT_BROWSER_DEPS: BrowserScopeDeps = { sendBridgeRequest, getBrowserClient, findTabById, detectCdpPort };

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

/** Recovery line for a rejected bare (target-less) protocol call: many CDP
 * domains are tab-scoped, and Chrome often rejects them with only "Internal
 * error" when sent on the bare browser connection. */
const TAB_SCOPE_RECOVERY =
  'Many CDP domains (Storage.*, Page.*, DOM.*, Emulation.*, ...) are tab-scoped, not connection-scoped — re-run with --target <tabId> (`capture tab list` shows available tabs).';

/** Appends the tab-scope recovery hint when the failed call was target-less. */
function cdpFailed(message: string, flagTarget: string | undefined, cause?: unknown): CaptureError {
  return captureError('world', 'cdp_failed', flagTarget ? message : `${message} ${TAB_SCOPE_RECOVERY}`, cause);
}

export async function cmdCdp(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(HELP);
    return;
  }

  // Positional cardinality (0..1, where 0 requires --wait-event) is enforced
  // by `validateCliInvocation` before dispatch reaches this leaf; this guard
  // covers direct programmatic callers only. Failures cross the boundary as
  // typed CaptureErrors — capture.ts is the sole renderer/exit-status owner.
  const method = parsed.positional[0];
  if (!method && !parsed.waitEvent) {
    throw invalidInput(
      'received: neither a <Domain.method> positional nor --wait-event; expected: at least one of the two. Run `capture cdp -h` for the input schema.',
      'missing_method_and_event',
    );
  }

  let params: Record<string, unknown> | undefined;
  if (parsed.params) {
    try {
      params = JSON.parse(parsed.params);
    } catch (err) {
      throw invalidInput(
        `received: --params that is not valid JSON (${err instanceof Error ? err.message : String(err)}); expected: a JSON-encoded params object.`,
        'invalid_params_json',
      );
    }
  }

  const timeoutMs = parsed.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (parsed.browser) {
    await runBrowserScope(method, params, parsed, timeoutMs, DEFAULT_BROWSER_DEPS);
    return;
  }

  try {
    await runPageScope(method, params, parsed, timeoutMs);
  } catch (err) {
    if (err instanceof CaptureError) throw err;
    throw captureError(
      'world',
      'cdp_failed',
      `\`${invocationLabel(method, parsed.waitEvent)}\` failed on the page connection: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

function invocationLabel(method: string | undefined, waitEvent: string | undefined): string {
  return method ?? `--wait-event ${waitEvent}`;
}

/**
 * Exported for `test/cdp-command.test.ts`. Browser-scope CDP is connection-
 * level, so a target is only meaningful when the caller *explicitly* asked for
 * one with `--target` (`parsed.targetSource === 'flag'`). Session/env target
 * autofill exists to scope ordinary PAGE commands and must never silently
 * flatten a browser-level call onto some other tab — so this reads the flag-
 * sourced target directly instead of inferring provenance from the final
 * string.
 */
export async function runBrowserScope(
  method: string | undefined,
  params: Record<string, unknown> | undefined,
  parsed: ParsedArgs,
  timeoutMs: number,
  deps: BrowserScopeDeps = DEFAULT_BROWSER_DEPS,
): Promise<void> {
  const flagTarget = parsed.targetSource === 'flag' ? parsed.target : undefined;
  const session = getActiveSession();
  const bridgeSocket = session?.bridgeSocket;
  const heldBridgeActive = Boolean(bridgeSocket && fs.existsSync(bridgeSocket));
  if (parsed.portSource !== 'flag' && bridgeSocket && heldBridgeActive) {
    const resp = await deps.sendBridgeRequest(bridgeSocket, {
      method,
      params,
      targetId: flagTarget,
      waitEvent: parsed.waitEvent,
      timeoutMs,
    });
    if (!resp.ok) {
      throw cdpFailed(
        `\`${invocationLabel(method, parsed.waitEvent)}\` failed over the held connection: ${resp.error ?? 'unknown bridge error'}`,
        flagTarget,
      );
    }
    emitCdpResult({
      method,
      waitEvent: parsed.waitEvent,
      scope: 'browser',
      target: flagTarget,
      result: resp.result,
      event: resp.event,
      json: parsed.json,
    });
    return;
  }

  // In-flight diagnostic (stderr): the one-shot connection semantics fact.
  const connectionReason = parsed.portSource === 'flag'
    ? heldBridgeActive
      ? `Using explicitly selected CDP port ${parsed.port} instead of the active session bridge`
      : `Using explicitly selected CDP port ${parsed.port}`
    : 'No held session bridge active';
  console.error(
    `${connectionReason} — this one-shot connection closes when the command exits, ` +
    'so any browser-level grant or target enablement made here reverts immediately after.',
  );

  const port = parsed.port ?? (await deps.detectCdpPort());
  const { client } = await deps.getBrowserClient(port);
  try {
    let sessionId: string | undefined;
    if (flagTarget) {
      // Accept the same 8-char-prefix targeting every other capture command
      // promises (see the root help's targeting contract) instead of
      // requiring the full 32-char target id here.
      const tab = await deps.findTabById(port, flagTarget);
      if (!tab) {
        throw captureError(
          'precondition',
          'target_not_found',
          `received: --target ${flagTarget} with no matching target on port ${port}; expected: an existing target id (8-char prefix accepted). \`capture tab list\` shows available targets.`,
        );
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
      target: flagTarget,
      result,
      event,
      json: parsed.json,
    });
  } catch (err) {
    if (err instanceof CaptureError) throw err;
    throw cdpFailed(
      `\`${invocationLabel(method, parsed.waitEvent)}\` failed on the one-shot browser connection: ${err instanceof Error ? err.message : String(err)}`,
      flagTarget,
      err,
    );
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
      // event-wait timeout, so one combined request preserves the complete
      // result contract (contrast `page/navigate.ts`'s multi-call
      // `navigateAtomicWithFragmentFix`).
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
