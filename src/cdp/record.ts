import { CDPClient } from './client.js';
import { detectCdpPort } from './detect.js';
import {
  findTab,
  findTabByIdAcrossEndpoints,
  findTabByUrlAcrossEndpoints,
  listTargets,
  openTab,
  type CDPTarget,
} from './targets.js';
import { HARRecorder } from './har-recorder.js';
import { writeHarAndPrintSummary } from './har-output.js';
import { type HAREntry } from '../har-manager.js';

export interface RecordOptions {
  port?: number;
  targetId?: string;
  duration?: number;
  harOutPath?: string;
}

export interface RecordResult {
  harPath: string | undefined;
  entryCount: number;
  har: { log: { entries: HAREntry[] } };
}

export async function recordTraffic(
  options: RecordOptions,
): Promise<RecordResult> {
  let port = options.port ?? 0;
  const duration = options.duration ?? 10;

  if (!options.targetId) {
    throw new Error('Use --target <tabId> to target a tab. Run "capture list" to see available tabs.');
  }

  const resolved = await findTabByIdAcrossEndpoints(options.targetId, options.port);
  const tab = resolved?.tab ?? null;
  if (resolved) {
    port = resolved.port;
  }
  if (!tab) {
    throw new Error(
      `No tab found for target "${options.targetId}". Run "capture list" to see available tabs.`,
    );
  }

  if (!tab.webSocketDebuggerUrl) {
    throw new Error('Tab has no WebSocket debugger URL');
  }

  const client = new CDPClient(tab.webSocketDebuggerUrl);
  await client.waitReady();

  console.error(
    `Using target ${tab.id.slice(0, 8)} on port ${port} (${tab.url})`,
  );

  const recorder = new HARRecorder(client);
  await recorder.start();

  console.error(
    `Recording traffic on target ${tab.id.slice(0, 8)} on port ${port} (${tab.url}) for ${duration}s... (click around in the browser)`,
  );

  await new Promise((r) => setTimeout(r, duration * 1000));

  const har = await recorder.finish();
  const harPath = writeHarAndPrintSummary(har, options.harOutPath);

  client.close();

  return { harPath, entryCount: har.log.entries.length, har };
}

/**
 * Navigates `client`'s tab to `url`, bouncing through `about:blank` and
 * re-navigating when Chrome reports a same-document (fragment-only) nav —
 * shared by `navigateAndRecord()` (below) and F2's recorder-routed path
 * (`../commands/traffic.ts`'s `cmdNavigate`), which calls this same helper
 * over a `RecorderHeldClient` instead of a fresh `CDPClient`.
 *
 * A fragment-only change against the current document is a same-document
 * navigation: Chrome updates location.hash but does NOT reload the page, so
 * SPAs that read the fragment on mount (e.g. Excalidraw's #url= scene import)
 * never see it. Same-document navigations return no loaderId. When that
 * happens, force a genuine cross-document load by bouncing through
 * about:blank and re-navigating, so the target URL (fragment included) is
 * delivered to a freshly-mounted document. A plain Page.reload here races
 * the still-committing fragment nav and can reload the pre-fragment URL.
 */
export async function navigateWithFragmentFix(
  client: Pick<CDPClient, 'send'>,
  url: string,
): Promise<void> {
  const navResult = (await client.send('Page.navigate', { url })) as { loaderId?: string; errorText?: string };
  if (!navResult.loaderId) {
    await client.send('Page.navigate', { url: 'about:blank' });
    await client.send('Page.navigate', { url });
  }
}

export interface WaitAndSettleResult {
  /** `true` when the OUTER `deadlineMs` elapsed before load-wait + settle finished. */
  timedOut: boolean;
}

/**
 * Shared wait/settle/overall-timeout semantics for a post-navigate pause —
 * factored out of `navigateAndRecord()` (below) so F2's recorder-routed path
 * (`../commands/traffic.ts`'s `tryNavigateViaActiveRecorder()`) can honor the
 * SAME `--settle`/timeout behavior as the non-routed path instead of
 * returning immediately after `Page.navigate` resolves. `waitForLoadEvent`
 * is caller-supplied so each path can wait on its own transport (a plain
 * `client.on('Page.loadEventFired', ...)` listener for a real `CDPClient`,
 * `RecorderHeldClient.waitEvent('Page.loadEventFired', ...)` for the
 * recorder-routed adapter) — it must resolve once the load signal is
 * observed and never reject on its own "no load event yet" timeout (that
 * tolerance is the caller's job, matching the non-routed path's existing
 * "Page load timeout (10s), continuing with settle..." behavior); only the
 * OUTER `deadlineMs` here turns into the returned `timedOut` flag.
 *
 * `afterSettle`, when given, runs INSIDE the raced/deadline-bounded branch,
 * immediately after the settle pause and before the race resolves — this is
 * how the non-routed `navigateAndRecord()` path below keeps its HAR
 * finalization (`recorder.finish()`) covered by the same 60s deadline as
 * load-wait + settle, matching this function's pre-extraction behavior
 * (HAR finalization used to happen inline inside the same raced branch).
 * `logTimeout`, default `true`, controls whether this function prints its
 * own `Navigate timeout (...)` line on timeout; `navigateAndRecord()` passes
 * `false` and prints its own single, pre-existing timeout line itself so
 * the non-routed path emits exactly one timeout log line, matching its
 * pre-extraction output byte-for-byte.
 */
export async function waitForLoadAndSettle(
  waitForLoadEvent: () => Promise<void>,
  settleMs: number,
  deadlineMs = 60_000,
  afterSettle?: () => Promise<void>,
  logTimeout = true,
): Promise<WaitAndSettleResult> {
  const t0 = Date.now();
  try {
    await Promise.race([
      (async () => {
        await waitForLoadEvent();

        // Settle time for SPAs that load after DOMContentLoaded
        console.error(`Settling for ${settleMs}ms...`);
        await new Promise((r) => setTimeout(r, settleMs));

        if (afterSettle) await afterSettle();
      })(),
      new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error('__navigate_timeout__')), deadlineMs - (Date.now() - t0));
        // Don't keep process alive just for the deadline timer
        if (typeof t === 'object' && 'unref' in t) t.unref();
      }),
    ]);
    return { timedOut: false };
  } catch (err) {
    if (err instanceof Error && err.message === '__navigate_timeout__') {
      if (logTimeout) console.error(`Navigate timeout (${deadlineMs / 1000}s)`);
      return { timedOut: true };
    }
    throw err;
  }
}

export interface NavigateAndRecordOptions {
  port?: number;
  url: string;
  targetId?: string;
  harOutPath?: string;
  settle?: number;
}

export interface NavigateAndRecordResult {
  harPath: string | undefined;
  entryCount: number;
  har: { log: { entries: HAREntry[] } };
  tab: CDPTarget;
  timedOut: boolean;
}

export async function navigateAndRecord(
  options: NavigateAndRecordOptions,
): Promise<NavigateAndRecordResult> {
  let requestedUrl: URL;
  try {
    requestedUrl = new URL(options.url);
  } catch {
    throw new Error(`Invalid URL: ${options.url}`);
  }
  const settle = options.settle ?? 2000;

  // Find tab — prefer exact target or an already-open matching URL across all endpoints.
  let port = options.port ?? 0;
  let tab: CDPTarget | null = null;
  let isNewTab = false;

  if (options.targetId) {
    const resolved = await findTabByIdAcrossEndpoints(options.targetId, options.port);
    if (!resolved) {
      throw new Error(
        `No tab found with target ID "${options.targetId}". Tab may have been closed.`,
      );
    }
    port = resolved.port;
    tab = resolved.tab;
  } else {
    const matched = await findTabByUrlAcrossEndpoints(options.url, options.port);
    if (matched) {
      port = matched.port;
      tab = matched.tab;
    } else {
      port = options.port ?? (await detectCdpPort());
      const domain = requestedUrl.hostname;
      tab = await findTab(port, domain);
      if (!tab) {
        tab = await openTab(port, options.url);
        isNewTab = true;
      }
    }
  }
  if (!tab.webSocketDebuggerUrl) {
    throw new Error('Tab has no WebSocket debugger URL');
  }

  const client = new CDPClient(tab.webSocketDebuggerUrl);
  await client.waitReady();
  await client.send('Page.enable');

  console.error(
    `Using target ${tab.id.slice(0, 8)} on port ${port} (${tab.url})`,
  );

  // Start recording BEFORE navigation
  const recorder = new HARRecorder(client);
  await recorder.start();

  if (!isNewTab) {
    // Navigate existing tab
    console.error(`Navigating to: ${options.url}`);
    await navigateWithFragmentFix(client, options.url);
  }

  const waitForLoadEvent = (): Promise<void> =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        console.error('Page load timeout (10s), continuing with settle...');
        resolve();
      }, 10000);
      client.on('Page.loadEventFired', () => {
        clearTimeout(timer);
        resolve();
      });
    });

  // HAR finalization runs as `afterSettle`, INSIDE the raced/deadline-bounded
  // region (via `logTimeout: false` so this path keeps its own single timeout
  // line below) — this restores the pre-extraction invariant that the 60s
  // deadline covers load-wait + settle + HAR finalization, not just the first
  // two, so a near-deadline `recorder.finish()` can still trip `timedOut`.
  let har!: { log: { entries: HAREntry[] } };
  const { timedOut } = await waitForLoadAndSettle(
    waitForLoadEvent,
    settle,
    60_000,
    async () => {
      har = await recorder.finish();
    },
    false,
  );
  if (timedOut) {
    console.error('Navigate timeout (60s) — returning partial HAR');
    har = recorder.finishPartial();
  }

  const harPath = writeHarAndPrintSummary(har, options.harOutPath);

  client.close();

  // Refresh target info
  const updatedTab = (await findTab(port, options.url)) ?? tab;

  return { harPath, entryCount: har.log.entries.length, har, tab: updatedTab, timedOut };
}

export async function navigateAndWait(
  port: number,
  url: string,
  options: { timeout?: number; forceNew?: boolean } = {},
): Promise<CDPTarget> {
  const timeout = options.timeout ?? 10000;

  // Check if tab already exists (unless forceNew requested)
  if (!options.forceNew) {
    const existing = await findTab(port, url);
    if (existing) {
      return existing;
    }
  }

  // Open new tab
  const tab = await openTab(port, url);
  if (!tab.webSocketDebuggerUrl) {
    throw new Error('New tab has no WebSocket debugger URL');
  }

  // Wait for page load
  const client = new CDPClient(tab.webSocketDebuggerUrl);
  await client.waitReady();
  await client.send('Page.enable');

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Page load timeout: ${url}`)),
      timeout,
    );
    client.on('Page.loadEventFired', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  client.close();

  // Refresh target info — find by ID to avoid returning a different tab with same URL
  const targets = await listTargets(port);
  const refreshed = targets.find((t) => t.id === tab.id);
  return refreshed ?? tab;
}
