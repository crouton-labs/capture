import { recordTraffic, navigateAndRecord, waitForLoadAndSettle } from '../record.js';
import { withConnection, connectForCommand } from '../connection.js';
import { getActiveSession, setActiveNetworkOffline, type ActiveSessionState } from '../../session-context.js';
import { isRecorderHeldClient, type RecorderHeldClient } from '../recorder-client.js';
import { recDirFor, readRecorderJson } from '../motion/recorder.js';
import { appendToHarRecording as appendToHar } from '../../har-manager.js';
import { type ParsedArgs } from '../types.js';

const LOAD_EVENT_NAME = 'Page.loadEventFired';
const LOAD_EVENT_TIMEOUT_MS = 10000;

/** Plain, non-racy read of the tab's current URL via the recorder connection
 * — `client.send` (no `waitEvent` paired), so it carries no event-pairing
 * and is never subject to the combined-dispatch wait-timeout/result-loss
 * gotcha `dispatch()` documents. Used only to PREDICT same-document vs
 * cross-document before choosing a navigate strategy; never treated as more
 * than a prediction (see `navigateAtomicWithFragmentFix`'s misprediction
 * recovery path). */
async function currentTabUrl(client: RecorderHeldClient): Promise<string | null> {
  try {
    const history = (await client.send('Page.getNavigationHistory')) as {
      currentIndex: number;
      entries: Array<{ url: string }>;
    };
    return history.entries[history.currentIndex]?.url ?? null;
  } catch {
    return null;
  }
}

function isSameDocumentTarget(currentUrl: string | null, targetUrl: string): boolean {
  if (!currentUrl) return false;
  try {
    const a = new URL(currentUrl);
    const b = new URL(targetUrl);
    a.hash = '';
    b.hash = '';
    return a.href === b.href;
  } catch {
    return false;
  }
}

/**
 * Navigates through the active recorder, bundling the `Page.loadEventFired`
 * wait atomically onto whichever `Page.navigate` call is actually expected
 * to trigger it — so a fast-completing load cannot race a separately-issued
 * wait-event subscription (see `recorder-client.ts`'s `dispatch()`). A
 * same-document (fragment-only) navigation never fires a fresh load event,
 * and per `dispatch()`'s documented gotcha, bundling a wait onto a call that
 * times out loses that call's `result` (here, `loaderId`) entirely — so a
 * same-document nav is PREDICTED up front (via a plain, non-racy
 * `Page.getNavigationHistory` read) and routed straight to the existing
 * about:blank-bounce path, bundling the wait only on the definite final
 * re-navigate. A misprediction (rare — e.g. a client-side redirect racing
 * the history read) recovers by re-establishing ground truth with one extra
 * plain navigate rather than trusting a lost/ambiguous result.
 */
async function navigateAtomicWithFragmentFix(
  client: RecorderHeldClient,
  url: string,
): Promise<{ event: unknown }> {
  const current = await currentTabUrl(client);

  if (isSameDocumentTarget(current, url)) {
    await client.dispatch('Page.navigate', { url });
    await client.dispatch('Page.navigate', { url: 'about:blank' });
    const { event } = await client
      .dispatch('Page.navigate', { url }, LOAD_EVENT_NAME, LOAD_EVENT_TIMEOUT_MS)
      .catch(() => ({ event: undefined as unknown }));
    return { event };
  }

  try {
    const { result, event } = await client.dispatch('Page.navigate', { url }, LOAD_EVENT_NAME, LOAD_EVENT_TIMEOUT_MS);
    if ((result as { loaderId?: string } | undefined)?.loaderId) return { event };
    // Fall through to the recovery path below (the call succeeded, but,
    // unexpectedly, without a loaderId) — same as the non-atomic fragment-fix
    // path's own "no loaderId -> bounce" branch.
  } catch {
    // The bundled wait timed out (or the call failed outright) — the
    // prediction may have been wrong (e.g. a client-side redirect raced our
    // history read), or this is a genuinely slow (>10s) real load. Either
    // way `result` is unrecoverable from this response (the bridge discards
    // it on wait-timeout) — recover below.
  }

  const plain = (await client.dispatch('Page.navigate', { url })).result as { loaderId?: string } | undefined;
  if (plain?.loaderId) return { event: undefined }; // tolerate a slow real load, same as the non-routed path's own 10s inner timer
  await client.dispatch('Page.navigate', { url: 'about:blank' });
  const bounced = await client
    .dispatch('Page.navigate', { url }, LOAD_EVENT_NAME, LOAD_EVENT_TIMEOUT_MS)
    .catch(() => ({ event: undefined as unknown }));
  return { event: bounced.event };
}

export async function cmdRecord(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture record --target <id> [--duration <secs>] [--har-out <path>]\n\n' +
        'Passive HAR recording for the specified duration (default: 10s).',
    );
    process.exit(0);
  }
  if (!parsed.target) {
    console.error(
      'Usage: capture record --target <id> [--duration <secs>] [--har-out <path>]',
    );
    process.exit(1);
  }

  const result = await recordTraffic({
    port: parsed.port,
    targetId: parsed.target,
    duration: parsed.duration,
    harOutPath: parsed.harOut,
  });
  console.log(
    JSON.stringify(
      { entryCount: result.entryCount, harPath: result.harPath },
      null,
      2,
    ),
  );
  return;
}

export async function cmdNavigate(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture navigate <url> [--har-out <path>] [--settle <ms>] [--har <id>]\n\n' +
        'Navigate to URL and record HAR. Appends to session HAR if --har is set.\n\n' +
        'Example: capture navigate "https://app.example.com/dashboard" --settle 3000',
    );
    process.exit(0);
  }
  const url = parsed.positional[0];
  if (!url) {
    console.error(
      'Usage: capture navigate <url> [--har-out <path>] [--settle <ms>]',
    );
    process.exit(1);
  }

  const routed = await tryNavigateViaActiveRecorder(parsed, url);
  if (routed) {
    console.log(JSON.stringify(routed, null, 2));
    return;
  }

  const result = await navigateAndRecord({
    port: parsed.port,
    url,
    targetId: parsed.target,
    harOutPath: parsed.har ? undefined : parsed.harOut,
    settle: parsed.settle,
  });

  // Append to session HAR if active
  if (parsed.har && result.har.log.entries.length > 0) {
    appendToHar(parsed.har, result.har.log.entries);
    console.error(`  [har:${parsed.har}] +${result.har.log.entries.length} entries`);
  }

  console.log(
    JSON.stringify(
      {
        entryCount: result.entryCount,
        harPath: result.harPath,
        tabUrl: result.tab.url,
        timedOut: result.timedOut,
      },
      null,
      2,
    ),
  );
  return;
}

/**
 * Mirrors `connectToActiveRecorder()`'s own routability guards
 * (`connection.ts`, not exported) WITHOUT opening a connection — lets
 * `tryNavigateViaActiveRecorder()` decide up front whether
 * `connectForCommand()` will actually route through the recorder. Without
 * this precondition, a stale/stopped recorder (`recorder.json` missing or
 * `state !== 'recording'`) makes `connectToActiveRecorder()` return `null`
 * internally, and `connectForCommand()` falls through to its "Use --target
 * <tabId> or --url <pattern>..." error — which fires on a completely normal
 * `capture navigate <url>`, since navigate's URL is positional, not
 * `parsed.url`. Checked here so that case returns `null` (clean fallback to
 * `navigateAndRecord()`) instead of throwing.
 */
function isRecorderRoutable(session: ActiveSessionState, parsed: ParsedArgs): boolean {
  const recId = session.activeRecId;
  if (!recId) return false;
  if (parsed.url) return false;
  if (parsed.target && parsed.target !== session.targetId) return false;

  const rj = readRecorderJson(recDirFor(session.dir, recId));
  return !!rj && rj.state === 'recording';
}

/**
 * Routes `capture navigate` through an ACTIVE composed recording instead of
 * `navigateAndRecord()`'s own fresh tab websocket. Returns `null` when there
 * is no recording routable for this invocation (falls back to the existing
 * `navigateAndRecord()` path, unchanged) — mirrors `connectForCommand()`'s
 * own routing guards (explicit `--url`/mismatched `--target` skip routing,
 * and see `isRecorderRoutable()` above for the stale/stopped-recorder
 * guard). Skips HAR/console capture the same documented way
 * `withConnection()` does for every other routed command (events.jsonl is
 * the equivalent record) — but otherwise honors the SAME
 * URL-validation/load-wait/`--settle`/timeout semantics as the non-routed
 * `navigateAndRecord()` path: `Page.loadEventFired` is awaited via
 * `navigateAtomicWithFragmentFix()` (bundled atomically onto the
 * recorder-routed `Page.navigate` call itself,
 * through the recorder bridge's own event broker) instead of the adapter's
 * inert `.on()`, through the shared `waitForLoadAndSettle()` helper.
 */
export async function tryNavigateViaActiveRecorder(
  parsed: ParsedArgs,
  url: string,
): Promise<{ entryCount: number; harPath: undefined; tabUrl: string; timedOut: boolean } | null> {
  const session = getActiveSession();
  if (!session || !isRecorderRoutable(session, parsed)) return null;

  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  const { client } = await connectForCommand(parsed);
  if (!isRecorderHeldClient(client)) {
    client.close();
    return null;
  }

  console.error(
    '  [recorder] routing navigate through the active recording — Page.navigate is marked; ' +
      'HAR/console capture is skipped while routed (see events.jsonl for the equivalent record).',
  );

  const settle = parsed.settle ?? 2000;
  // `navigateAtomicWithFragmentFix` never throws (every branch tolerates its
  // own failure internally, same as the non-routed path's 10s inner
  // "continuing with settle..." tolerance) — so, unlike the old split
  // send-then-wait pair, this needs no `.then(ok, onErr)` wrapper here.
  const waitForLoadEvent = (): Promise<void> => navigateAtomicWithFragmentFix(client, url).then(() => undefined);

  const { timedOut } = await waitForLoadAndSettle(waitForLoadEvent, settle);
  if (timedOut) {
    console.error('Navigate timeout (60s)');
  }

  return { entryCount: 0, harPath: undefined, tabUrl: url, timedOut };
}

export async function cmdNetwork(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture network <offline|online> [--target <id>]\n\n' +
        'Toggle network connectivity for a tab. Use "offline" to simulate\n' +
        'network failure (kills WebSocket connections, blocks HTTP requests).\n' +
        'Use "online" to restore connectivity.',
    );
    process.exit(0);
  }
  const mode = parsed.positional[0];
  if (!mode || !['offline', 'online'].includes(mode)) {
    console.error('Usage: capture network <offline|online> [--target <id>]');
    process.exit(1);
  }
  const offline = mode === 'offline';
  const result = await withConnection(
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
      return { network: mode, offline };
    },
    { settle: 0 },
  );
  console.log(JSON.stringify(result, null, 2));
  if (offline) {
    console.error('\nNetwork disabled. WebSocket connections will drop.');
    console.error('Restore with: capture network online');
  } else {
    console.error('\nNetwork restored.');
  }
  return;
}
