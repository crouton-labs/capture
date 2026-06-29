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
    await client.send('Page.navigate', { url: options.url });
  }

  const deadline = 60_000;
  const t0 = Date.now();
  let timedOut = false;
  let har!: { log: { entries: HAREntry[] } };

  try {
    await Promise.race([
      (async () => {
        // Wait for load event
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            console.error('Page load timeout (10s), continuing with settle...');
            resolve();
          }, 10000);
          client.on('Page.loadEventFired', () => {
            clearTimeout(timer);
            resolve();
          });
        });

        // Settle time for SPAs that load after DOMContentLoaded
        console.error(`Settling for ${settle}ms...`);
        await new Promise((r) => setTimeout(r, settle));

        har = await recorder.finish();
      })(),
      new Promise<never>((_, reject) => {
        const t = setTimeout(() => reject(new Error('__navigate_timeout__')), deadline - (Date.now() - t0));
        // Don't keep process alive just for the deadline timer
        if (typeof t === 'object' && 'unref' in t) t.unref();
      }),
    ]);
  } catch (err) {
    if (err instanceof Error && err.message === '__navigate_timeout__') {
      timedOut = true;
      console.error('Navigate timeout (60s) — returning partial HAR');
      har = recorder.finishPartial();
    } else {
      throw err;
    }
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
