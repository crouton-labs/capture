/**
 * `capture page navigate` — navigate the tab to a URL, wait for load, then
 * settle. During a live composed recording the navigation routes through the
 * recorder socket with a marked `Page.navigate` (the landmark `motion
 * timeline` correlates against); otherwise the standalone path drives a
 * fresh tab websocket and appends recorded network entries to the active
 * session's HAR.
 */
import { navigateAndRecord, waitForLoadAndSettle } from '../../record.js';
import { connectForCommand } from '../../connection.js';
import { getActiveSession, type ActiveSessionState } from '../../../session-context.js';
import { isRecorderHeldClient, type RecorderHeldClient } from '../../recorder-client.js';
import { recDirFor, readRecorderJson } from '../../motion/recorder.js';
import { appendToHarRecording as appendToHar } from '../../../har-manager.js';
import { type ParsedArgs } from '../../types.js';
import { isParseableUrl } from '../../leaf-grammar.js';
import { emitResult, fact, text, type FactLine, type RenderableResult } from '../../../output/render.js';

const LOAD_EVENT_NAME = 'Page.loadEventFired';
const LOAD_EVENT_TIMEOUT_MS = 10000;

const DEFAULT_SETTLE_MS = 2000;

const USAGE = `capture page navigate <url> [--settle <ms>] — navigate the tab to a URL, wait for load, then settle.

Input:
  <url>          Absolute URL (WHATWG-parseable). A fragment-only change
                 against the current document is forced through a real
                 cross-document reload so a freshly-mounted document sees it.
  --settle <ms>  Post-load settle wait; default ${DEFAULT_SETTLE_MS}ms in both the
                 recorder-routed and standalone paths. 0 disables.
  --target <id>  Standalone path only: navigate this tab instead of the
                 active session tab.

Output:
  One <navigated url=… settle=… timed-out=…> block: the tab URL after
  navigation, whether load + settle finished inside the 60s deadline, the
  settle actually applied, and (standalone, in a session) the network
  entries appended to the session HAR. --json mirrors the same fields.

Effects:
  Navigates the tab. With an active session, recorded network entries are
  appended to the session HAR. During a live composed recording the CDP
  routes through the recorder socket and Page.navigate carries a labeled
  performance.mark landmark; HAR/console capture is skipped while routed
  (events.jsonl holds the equivalent record).`;

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

/**
 * Mirrors `connectToActiveRecorder()`'s own routability guards
 * (`connection.ts`, not exported) WITHOUT opening a connection — lets
 * `tryNavigateViaActiveRecorder()` decide up front whether
 * `connectForCommand()` will actually route through the recorder. Without
 * this precondition, a stale/stopped recorder (`recorder.json` missing or
 * `state !== 'recording'`) makes `connectToActiveRecorder()` return `null`
 * internally, and `connectForCommand()` falls through to its "Use --target
 * <tabId> or --url <pattern>..." error — which fires on a completely normal
 * `capture page navigate <url>`, since navigate's URL is positional, not
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
 * Routes `page navigate` through an ACTIVE composed recording instead of
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
): Promise<{ entryCount: number; tabUrl: string; timedOut: boolean } | null> {
  const session = getActiveSession();
  if (!session || !isRecorderRoutable(session, parsed)) return null;

  if (!isParseableUrl(url)) throw new Error(`Invalid URL: ${url}`);

  // The branch router hands leaves `command: 'page'`, but the recorded
  // input-landmark label (`deriveActionLabel` in connection.ts) is
  // `<command>:<target>` — the design's landmark shape for this verb is
  // `navigate:<url>` (what motion timeline correlates against), so the
  // connection is opened under the verb name, not the branch token.
  const { client } = await connectForCommand({ ...parsed, command: 'navigate' });
  if (!isRecorderHeldClient(client)) {
    client.close();
    return null;
  }

  console.error(
    '  [recorder] routing navigate through the active recording — Page.navigate is marked; ' +
      'HAR/console capture is skipped while routed (see events.jsonl for the equivalent record).',
  );

  const settle = parsed.settle ?? DEFAULT_SETTLE_MS;
  // `navigateAtomicWithFragmentFix` never throws (every branch tolerates its
  // own failure internally, same as the non-routed path's 10s inner
  // "continuing with settle..." tolerance) — so, unlike the old split
  // send-then-wait pair, this needs no `.then(ok, onErr)` wrapper here.
  const waitForLoadEvent = (): Promise<void> => navigateAtomicWithFragmentFix(client, url).then(() => undefined);

  const { timedOut } = await waitForLoadAndSettle(waitForLoadEvent, settle);
  if (timedOut) {
    console.error('Navigate timeout (60s)');
  }

  return { entryCount: 0, tabUrl: url, timedOut };
}

interface NavigatedFacts {
  /** The tab's URL after navigation (routed: the requested URL; standalone:
   * the refreshed target's reported URL). */
  tabUrl: string;
  requestedUrl: string;
  settle: number;
  timedOut: boolean;
  routed: boolean;
  /** Standalone path only: entries recorded during the navigation. */
  entryCount?: number;
  /** Standalone path only: entries appended to the active session's HAR. */
  appended?: { harId: string; entries: number };
}

function buildNavigatedResult(f: NavigatedFacts): RenderableResult {
  const sections: FactLine[] = [
    f.timedOut
      ? fact`load + settle did not finish inside the 60s deadline (settle requested: ${f.settle}ms).`
      : fact`load wait completed; settled ${f.settle}ms.`,
  ];
  if (f.routed) {
    sections.push(
      text`Page.navigate routed through the active recording with a labeled performance.mark; HAR/console capture skipped while routed (events.jsonl holds the equivalent record).`,
    );
  } else if (f.appended) {
    sections.push(fact`${f.appended.entries} network entries appended to session HAR ${f.appended.harId}.`);
  } else if (f.entryCount !== undefined) {
    sections.push(fact`${f.entryCount} network entries recorded (no active session HAR to append to).`);
  }
  return {
    tag: 'navigated',
    attrs: { url: f.tabUrl, settle: f.settle, 'timed-out': f.timedOut, routed: f.routed || undefined },
    summary: fact`tab at ${f.tabUrl} after Page.navigate to ${f.requestedUrl}.`,
    sections,
  };
}

export async function cmdPageNavigate(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  const url = parsed.positional[0];
  if (!url) {
    emitResult(
      {
        tag: 'error',
        attrs: { command: 'page navigate', code: 'missing_url' },
        summary: text`received: no URL; expected: \`capture page navigate <url> [--settle <ms>]\`.`,
        followUp: text`Re-run with the destination URL as the first positional argument.`,
      },
      { json: parsed.json },
    );
    process.exit(1);
  }

  const settle = parsed.settle ?? DEFAULT_SETTLE_MS;

  try {
    const routed = await tryNavigateViaActiveRecorder(parsed, url);
    if (routed) {
      emitResult(
        buildNavigatedResult({
          tabUrl: routed.tabUrl,
          requestedUrl: url,
          settle,
          timedOut: routed.timedOut,
          routed: true,
        }),
        { json: parsed.json },
      );
      return;
    }

    const result = await navigateAndRecord({
      port: parsed.port,
      url,
      targetId: parsed.target,
      settle,
    });

    // Append to the active session's HAR (parsed.har is the session-filled
    // internal slot — not CLI-settable).
    let appended: NavigatedFacts['appended'];
    const appendedBatch = { entries: result.har.log.entries, incompleteLifecycles: result.har.incompleteLifecycles };
    if (parsed.har && (appendedBatch.entries.length > 0 || appendedBatch.incompleteLifecycles.length > 0)) {
      await appendToHar(parsed.har, appendedBatch);
      appended = { harId: parsed.har, entries: appendedBatch.entries.length };
      console.error(
        `  [har:${parsed.har}] +${appendedBatch.entries.length} entries` +
        (appendedBatch.incompleteLifecycles.length > 0
          ? ` +${appendedBatch.incompleteLifecycles.length} incomplete`
          : ''),
      );
    }

    emitResult(
      buildNavigatedResult({
        tabUrl: result.tab.url,
        requestedUrl: url,
        settle,
        timedOut: result.timedOut,
        routed: false,
        entryCount: result.entryCount,
        appended,
      }),
      { json: parsed.json },
    );
  } catch (err) {
    emitResult(
      {
        tag: 'error',
        attrs: { command: 'page navigate', code: 'navigate_failed' },
        summary: fact`${err instanceof Error ? err.message : String(err)}`,
        followUp: text`Check the URL is absolute and a CDP-enabled browser is running (probe: capture tab list).`,
      },
      { json: parsed.json },
    );
    process.exit(1);
  }
}
