import { CDPClient } from './client.js';
import {
  findTab,
  listTargets,
  openTab,
  type CDPTarget,
} from './targets.js';

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
