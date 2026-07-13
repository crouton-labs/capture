import { CDPClient } from './client.js';
import {
  findTab,
  listTargets,
  openTab,
  type CDPTarget,
} from './targets.js';
import { captureError } from '../errors.js';

export interface NavigateAndRecordOptions {
  port?: number;
  url: string;
  targetId?: string;
  settle?: number;
}

export interface NavigateAndRecordResult {
  entryCount: number;
  har: { log: { entries: unknown[] } };
  tab: CDPTarget;
  timedOut: boolean;
}

/**
 * REMOVED. `page navigate` no longer resolves its source or opens tabs by
 * destination heuristics — it uses ordinary page targeting (`--target` /
 * `--url` / the session tab) through `connectForCommand`, and `tab open` is
 * the sole tab-creating verb (see `../commands/page/navigate.ts`). This
 * named export survives only so the `../cdp.ts` barrel keeps compiling until
 * that barrel line is removed; it must never be called.
 */
export async function navigateAndRecord(
  _options: NavigateAndRecordOptions,
): Promise<NavigateAndRecordResult> {
  throw captureError(
    'invocation',
    'navigate_api_removed',
    'page navigate resolves its source through ordinary page targeting (--target / --url / the session tab); tab open alone creates tabs.',
  );
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
