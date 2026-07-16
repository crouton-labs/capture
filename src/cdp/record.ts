import { CDPClient } from './client.js';
import {
  findTab,
  listTargets,
  openTab,
} from './targets.js';
import { type CDPTarget } from './types.js';

/**
 * Opens (or reuses) a tab for `url` and waits for its load event — `tab open`'s
 * load-wait helper. Navigation of an existing tab lives in
 * `./commands/page/navigate.ts` via ordinary page targeting.
 */
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

  // Wait for page load. The client owns a page WebSocket, so close it even
  // when connection, readiness, timeout, or target-refresh work fails.
  const client = new CDPClient(tab.webSocketDebuggerUrl);
  try {
    await client.waitReady();
    await client.send('Page.enable');

    let timer: NodeJS.Timeout | undefined;
    let loadHandler: ((params: unknown) => void) | undefined;
    let loadTimeoutError: Error | undefined;
    let resolveLoad!: () => void;
    const loadPromise = new Promise<void>((resolve) => {
      resolveLoad = resolve;
      loadHandler = () => {
        if (timer) clearTimeout(timer);
        resolveLoad();
      };
      // Arm the event before checking readyState: the load event may fire
      // while the readiness query is in flight.
      client.on('Page.loadEventFired', loadHandler);
      timer = setTimeout(() => {
        loadTimeoutError = new Error(`Page load timeout: ${url}`);
        resolveLoad();
      }, timeout);
    });

    try {
      const result = await client.send('Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true,
      });
      const readyState = (result as { result?: { value?: unknown } } | undefined)?.result?.value;
      if (readyState !== 'complete') {
        await loadPromise;
        if (loadTimeoutError) throw loadTimeoutError;
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (loadHandler) client.off('Page.loadEventFired', loadHandler);
    }
  } finally {
    client.close();
  }

  // Refresh target info — find by ID to avoid returning a different tab with same URL
  const targets = await listTargets(port);
  const refreshed = targets.find((t) => t.id === tab.id);
  return refreshed ?? tab;
}
