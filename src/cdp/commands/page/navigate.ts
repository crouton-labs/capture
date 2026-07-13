/**
 * `capture page navigate <url>` — navigate the SOURCE tab to a destination
 * URL, then report the load outcome as a fact separate from the settle.
 *
 * Source targeting is ordinary page targeting: `--target <id>` / `--url
 * <pattern>` (or, in a session, the session's own tab) selects which tab
 * navigates; the single positional is the destination only. Navigate never
 * creates a tab — `tab open` is the sole tab-creating verb — so an
 * unresolvable source is `connectForCommand`'s structured targeting error,
 * not a silently-opened tab.
 *
 * Dispatch is single-shot: exactly one `Page.navigate` for the destination
 * (plus a `dest → about:blank → dest` bounce only when the target is a
 * same-document/fragment change that returns no loaderId). The load wait
 * (`Page.loadEventFired`) is armed BEFORE the destination send and reported
 * as its own factual outcome — `observed` (the event fired inside the
 * load-wait window) or `bounded-timeout` (it did not; the navigation still
 * dispatched). A load-wait timeout NEVER discards the navigation's own
 * result (its loaderId), and the navigation is never redispatched to chase a
 * missing event.
 */
import { connectForCommand, withPageAction, type SettleFacts } from '../../connection.js';
import { EventBroker } from '../../bridge/server.js';
import { isRecorderHeldClient, type RecorderHeldClient } from '../../recorder-client.js';
import { type CDPClient } from '../../client.js';
import { type ParsedArgs } from '../../types.js';
import { CaptureError, captureError, invalidInput } from '../../../errors.js';
import { isParseableUrl } from '../../leaf-grammar.js';
import { emitResult, fact, text, type FactLine, type RenderableResult } from '../../../output/render.js';

const LOAD_EVENT_NAME = 'Page.loadEventFired';
const DEFAULT_SETTLE_MS = 2000;

/** Load-wait window (inner) and total nav-phase deadline (outer) in ms.
 * Injectable so tests drive the timing with tiny timers instead of the real
 * multi-second waits — mirrors `connection.ts`'s `__setConnectionSeamsForTest`
 * seam pattern. */
interface NavigateTiming {
  innerTimeoutMs: number;
  outerDeadlineMs: number;
}
let timing: NavigateTiming = { innerTimeoutMs: 10_000, outerDeadlineMs: 60_000 };
export function __setNavigateTimingForTest(overrides: Partial<NavigateTiming>): () => void {
  const previous = timing;
  timing = { ...timing, ...overrides };
  return () => { timing = previous; };
}

const USAGE = `capture page navigate <url> [--settle <ms>] — navigate the source tab to a URL and report the load outcome.

Input:
  <url>          Destination URL (absolute, WHATWG-parseable). This is the
                 destination only — it never selects or creates a tab.
  --settle <ms>  Post-load settle wait; default ${DEFAULT_SETTLE_MS}ms. 0 disables.
  --target <id>  Select the SOURCE tab to navigate (ordinary page targeting).
  --url <pat>    Select the SOURCE tab by URL pattern (ordinary page targeting).

Source resolution: --target / --url (or, in a session, the session's own tab)
picks which tab navigates. Navigate never creates a tab — use "tab open" for
that; an unresolvable source is a targeting error, not a new tab.

Output:
  One <navigated url=… settle=… load-outcome=… deadline-exceeded=…> block:
  the tab URL after navigation, the measured settle, and — reported
  separately — the load outcome (observed | bounded-timeout), whether the
  nav phase exceeded its deadline, the dispatched navigation's loaderId (and
  any about:blank bounce for a same-document target), and whether the CDP
  routed through an active recording. --json mirrors the same fields.

Effects:
  Navigates the source tab (exactly one Page.navigate for the destination;
  one dest→about:blank→dest bounce only for a same-document/fragment target).
  During a live composed recording the CDP routes through the recorder socket
  and Page.navigate carries a labeled performance.mark landmark; HAR/console
  capture is skipped while routed (events.jsonl holds the equivalent record).`;

/** Load outcome plus the dispatched navigation's own facts, produced by one
 * navigation core (recorder-routed or direct). Distinct fields so the render
 * layer can report the load result separately from the method result. */
interface NavCore {
  loadOutcome: 'observed' | 'bounded-timeout';
  /** The dispatched navigation's loaderId (present on a real cross-document
   * navigation; absent for a same-document target before the bounce). */
  loaderId?: string;
  /** True when a same-document (fragment-only) target forced the
   * dest→about:blank→dest bounce so a freshly-mounted document sees it. */
  bounced: boolean;
}

/**
 * Recorder-routed navigation. The load wait is bundled atomically onto the
 * destination `Page.navigate` via `dispatch()` (the bridge arms the wait
 * before sending), so a fast load cannot race a separate subscription and a
 * wait timeout no longer discards the navigation's loaderId. A same-document
 * target returns no loaderId — recover with exactly one dest→about:blank→dest
 * bounce, bundling the wait only on the final re-navigate.
 */
async function navigateViaRecorder(client: RecorderHeldClient, url: string): Promise<NavCore> {
  const first = await client.dispatch('Page.navigate', { url }, LOAD_EVENT_NAME, timing.innerTimeoutMs);
  const loaderId = (first.result as { loaderId?: string } | undefined)?.loaderId;
  if (loaderId) {
    return { loadOutcome: first.waitOutcome ?? 'bounded-timeout', loaderId, bounced: false };
  }
  // Same-document target: the destination is already committed (no loaderId);
  // bounce through about:blank and re-navigate so a fresh document mounts.
  await client.dispatch('Page.navigate', { url: 'about:blank' });
  const final = await client.dispatch('Page.navigate', { url }, LOAD_EVENT_NAME, timing.innerTimeoutMs);
  const finalLoaderId = (final.result as { loaderId?: string } | undefined)?.loaderId;
  return { loadOutcome: final.waitOutcome ?? 'bounded-timeout', loaderId: finalLoaderId, bounced: true };
}

/** Arms a bounded `Page.loadEventFired` wait on a direct client's broker and
 * returns the wait handle plus a never-rejecting outcome promise
 * (`observed` | `bounded-timeout`). Arm this BEFORE the paired
 * `Page.navigate` send so a synchronous load event cannot be missed. */
function armLoadWait(broker: EventBroker): {
  wait: ReturnType<EventBroker['wait']>;
  outcome: Promise<'observed' | 'bounded-timeout'>;
} {
  const wait = broker.wait(LOAD_EVENT_NAME, undefined, timing.innerTimeoutMs);
  const outcome = wait.result().then(
    () => 'observed' as const,
    () => 'bounded-timeout' as const,
  );
  return { wait, outcome };
}

/**
 * Direct (non-recorder) navigation over a real CDP client. The load wait is
 * armed before the destination send (via the shared `EventBroker`), so a
 * synchronous `Page.loadEventFired` is still observed. A method throw
 * propagates (no retry). A same-document target (no loaderId) recovers with
 * exactly one dest→about:blank→dest bounce, re-arming the wait before the
 * final send.
 */
async function navigateDirect(
  client: CDPClient,
  url: string,
  armed?: { cancel: () => void },
): Promise<NavCore> {
  await client.send('Page.enable');
  const broker = new EventBroker(client);

  const first = armLoadWait(broker);
  // Publish the currently-armed wait's canceller so an outer-deadline
  // abandonment can clear its inner timer instead of letting it fire on its own.
  if (armed) armed.cancel = () => first.wait.cancel();
  let nav: { loaderId?: string } | undefined;
  try {
    nav = (await client.send('Page.navigate', { url })) as { loaderId?: string };
  } catch (err) {
    first.wait.cancel();
    throw err;
  }
  if (nav?.loaderId) {
    return { loadOutcome: await first.outcome, loaderId: nav.loaderId, bounced: false };
  }

  // Same-document target: discard the first wait, bounce through about:blank,
  // re-arm the wait, then re-navigate to the destination.
  first.wait.cancel();
  await client.send('Page.navigate', { url: 'about:blank' });
  const second = armLoadWait(broker);
  if (armed) armed.cancel = () => second.wait.cancel();
  let navFinal: { loaderId?: string } | undefined;
  try {
    navFinal = (await client.send('Page.navigate', { url })) as { loaderId?: string };
  } catch (err) {
    second.wait.cancel();
    throw err;
  }
  return { loadOutcome: await second.outcome, loaderId: navFinal?.loaderId, bounced: true };
}

/** Races the nav+load phase against the outer deadline. The deadline never
 * throws — on elapse it returns `{ completed: false }` and the caller reports
 * `deadline-exceeded` as a fact alongside whatever partial outcome it holds.
 * A method rejection from `work` propagates (no retry). */
async function raceNavDeadline(work: Promise<NavCore>): Promise<{ completed: true; core: NavCore } | { completed: false }> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<{ completed: false }>((resolve) => {
    timer = setTimeout(() => resolve({ completed: false }), timing.outerDeadlineMs);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  });
  const workOutcome = work.then((core) => ({ completed: true as const, core }));
  // If the deadline wins the race, `work` is still pending and may later
  // reject (e.g. a hung dispatch that eventually errors) — mark it handled so
  // that late rejection is not an unhandled promise. This does not suppress a
  // rejection that arrives BEFORE the deadline: Promise.race still observes it.
  workOutcome.catch(() => {});
  try {
    return await Promise.race([workOutcome, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}

interface NavigatedFacts {
  tabUrl: string;
  requestedUrl: string;
  loadOutcome: 'observed' | 'bounded-timeout';
  deadlineExceeded: boolean;
  loaderId?: string;
  bounced: boolean;
  routed: boolean;
  settle: SettleFacts;
}

function buildNavigatedResult(f: NavigatedFacts): RenderableResult {
  const sections: FactLine[] = [
    f.loadOutcome === 'observed'
      ? fact`load: ${LOAD_EVENT_NAME} observed within the ${timing.innerTimeoutMs}ms load-wait window.`
      : fact`load: ${LOAD_EVENT_NAME} not observed within the ${timing.innerTimeoutMs}ms load-wait window (bounded-timeout); the navigation still dispatched.`,
    fact`navigation dispatched: loaderId ${f.loaderId ?? '(none)'}${f.bounced ? '; delivered via dest→about:blank→dest bounce (same-document target)' : ''}.`,
    fact`settle: requested ${f.settle.requestedMs}ms, waited ${f.settle.waitedMs}ms.`,
  ];
  if (f.deadlineExceeded) {
    sections.push(fact`navigation phase exceeded its ${timing.outerDeadlineMs / 1000}s deadline before completing.`);
  }
  if (f.routed) {
    sections.push(
      text`Page.navigate routed through the active recording with a labeled performance.mark; HAR/console capture skipped while routed (events.jsonl holds the equivalent record).`,
    );
  }
  return {
    tag: 'navigated',
    attrs: {
      url: f.tabUrl,
      settle: f.settle.requestedMs,
      'load-outcome': f.loadOutcome,
      'deadline-exceeded': f.deadlineExceeded || undefined,
      routed: f.routed || undefined,
    },
    summary: fact`tab at ${f.tabUrl} after Page.navigate to ${f.requestedUrl}.`,
    sections,
  };
}

export async function cmdPageNavigate(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  // Positional cardinality (exactly 1) is enforced by `validateCliInvocation`
  // before dispatch reaches this leaf; this guard covers direct programmatic
  // callers only. Failures cross the boundary as typed CaptureErrors —
  // capture.ts is the sole renderer/exit-status owner.
  const url = parsed.positional[0];
  if (!url) {
    throw invalidInput('received: no URL; expected: `capture page navigate <url> [--settle <ms>]`.', 'missing_url');
  }
  // Validate the destination BEFORE any effect (connect/send). connectForCommand
  // never runs for an unparseable URL, so no tab is touched.
  if (!isParseableUrl(url)) {
    throw invalidInput(`received: \`${url}\`; expected: an absolute, WHATWG-parseable URL.`, 'invalid_url');
  }

  const settle = parsed.settle ?? DEFAULT_SETTLE_MS;

  // Session admission is owned by dispatch.ts's `withActiveSessionAdmission`,
  // which wraps every `page` command already — this leaf mirrors its
  // siblings (click/type/scroll) and does NOT re-admit here.
  //
  // connection.ts derives the recorder landmark label from parsed.command,
  // which the router leaves as the branch token 'page' — restore the verb
  // so a routed navigate's landmark stays `navigate:<url>`.
  //
  // Connection/targeting failures from `connectForCommand` (e.g. its
  // "Use --target/--url" or "No tab found" errors) surface with their own
  // message; only a genuinely raw navigation dispatch failure is re-tagged as
  // `navigate_failed` (scoped to the nav core below), so a valid-URL targeting
  // miss is never mislabeled with a URL/browser hint that doesn't apply.
  const { result: core, settle: settleFacts } = await withPageAction(
    { ...parsed, command: 'navigate' },
    { settleMs: settle },
    async (client, _tab) => {
      const routed = isRecorderHeldClient(client);
      // Holder for the direct path's currently-armed load wait, so an
      // outer-deadline abandonment can cancel it (clearing its inner timer).
      const armed = { cancel: () => {} };
      const work = routed
        ? navigateViaRecorder(client as unknown as RecorderHeldClient, url)
        : navigateDirect(client, url, armed);
      let raced: Awaited<ReturnType<typeof raceNavDeadline>>;
      try {
        raced = await raceNavDeadline(work);
      } catch (err) {
        // A raw navigation dispatch failure — tag it. Typed capture errors
        // (recorder/targeting) pass through unmodified.
        if (err instanceof CaptureError) throw err;
        throw captureError(
          'world',
          'navigate_failed',
          `${err instanceof Error ? err.message : String(err)} — check the URL is absolute and a CDP-enabled browser is running (probe: capture tab list).`,
          err,
        );
      }
      if (raced.completed) {
        return { ...raced.core, deadlineExceeded: false, routed, tabUrl: url };
      }
      // Deadline elapsed before the nav phase completed — cancel the armed
      // load wait and report partial facts (load unconfirmed) rather than throwing.
      armed.cancel();
      return {
        loadOutcome: 'bounded-timeout' as const,
        loaderId: undefined,
        bounced: false,
        deadlineExceeded: true,
        routed,
        tabUrl: url,
      };
    },
  );

  emitResult(
    buildNavigatedResult({
      tabUrl: core.tabUrl,
      requestedUrl: url,
      loadOutcome: core.loadOutcome,
      deadlineExceeded: core.deadlineExceeded,
      loaderId: core.loaderId,
      bounced: core.bounced,
      routed: core.routed,
      settle: settleFacts,
    }),
    { json: parsed.json },
  );
}
