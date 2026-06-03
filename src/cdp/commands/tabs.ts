import { detectCdpPortsAsync, detectCdpPort, getDefaultBrowserId } from '../detect.js';
import { listTargets, openTab } from '../targets.js';
import { navigateAndWait } from '../record.js';
import { CDPClient } from '../client.js';
import { updateActiveSession } from '../../session-context.js';
import { type ParsedArgs } from '../types.js';

export async function cmdDetect(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture detect\n\n' +
        'Detect CDP port (prioritizes default browser).\n' +
        'Returns JSON with port, app name, and all discovered endpoints.',
    );
    process.exit(0);
  }
  const endpoints = await detectCdpPortsAsync();
  if (endpoints.length === 0) {
    console.error(
      'ERROR: No browser with CDP found.\n\n' +
        'Fix: Start a browser with remote debugging enabled:\n' +
        '  Arc: Already enabled by default\n' +
        '  Chrome: --remote-debugging-port=9222\n' +
        '  Electron apps expose CDP automatically',
    );
    process.exit(1);
  }
  const defaultBrowser = getDefaultBrowserId();
  const preferred =
    endpoints.find(
      (p) => p.bundleId === defaultBrowser && !p.isElectron,
    ) ??
    endpoints.find((p) => !p.isElectron) ??
    endpoints[0];
  console.log(
    JSON.stringify(
      {
        port: preferred.port,
        app: preferred.app,
        isElectron: preferred.isElectron,
        all: endpoints.map((e) => ({
          port: e.port,
          app: e.app,
          isElectron: e.isElectron,
        })),
      },
      null,
      2,
    ),
  );
  console.error(
    `\nFound ${endpoints.length} CDP endpoint${endpoints.length > 1 ? 's' : ''}. Default: port ${preferred.port} (${preferred.app}).` +
      `\n\nNext (most tasks): capture session start --url <your app url>` +
      `\n      (one-off):    capture list --port ${preferred.port}`,
  );
  return;
}

export async function cmdList(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture list [--port <port>]\n\n' +
        'List all browser tabs across all CDP endpoints (or a specific port).\n' +
        'Returns JSON array of {id, title, url, port, app}.',
    );
    process.exit(0);
  }
  if (parsed.port) {
    // Single port mode
    const targets = await listTargets(parsed.port);
    const pages = targets.filter((t) => t.type === 'page');
    console.log(JSON.stringify(pages.map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
    })), null, 2));
    console.error(
      `\n${pages.length} tab${pages.length !== 1 ? 's' : ''} on port ${parsed.port}.` +
        `\n\nTarget a tab with: --target <id prefix>  (first 8 chars sufficient)`,
    );
  } else {
    // All endpoints mode
    const endpoints = await detectCdpPortsAsync();
    if (endpoints.length === 0) {
      console.error('No CDP endpoints found.');
      process.exit(1);
    }
    const allPages: { id: string; title: string; url: string; port: number; app: string }[] = [];
    await Promise.all(endpoints.map(async (ep) => {
      try {
        const targets = await listTargets(ep.port);
        const pages = targets.filter((t) => t.type === 'page');
        for (const t of pages) {
          allPages.push({ id: t.id, title: t.title, url: t.url, port: ep.port, app: ep.app });
        }
      } catch {
        // Skip endpoints that fail to respond
      }
    }));
    console.log(JSON.stringify(allPages, null, 2));
    console.error(
      `\n${allPages.length} tab${allPages.length !== 1 ? 's' : ''} across ${endpoints.length} CDP endpoint${endpoints.length !== 1 ? 's' : ''}.` +
        `\n\nTarget a tab with: --target <id prefix>  (first 8 chars sufficient)`,
    );
  }
  return;
}

export async function cmdOpen(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture open <url> [--new] [--port <port>]\n\n' +
        'Open URL in browser (returns tab ID).\n\n' +
        'Example: capture open "https://app.example.com" --new',
    );
    process.exit(0);
  }
  const url = parsed.positional[0];
  if (!url) {
    console.error(
      'ERROR: Missing URL.\n\n' +
        'Usage: capture open <url> [--new] [--port <port>]\n\n' +
        'Example: capture open "https://app.example.com" --new',
    );
    process.exit(1);
  }
  const p = parsed.port ?? (await detectCdpPort());
  const tab = await navigateAndWait(p, url, { forceNew: parsed.new });
  console.log(JSON.stringify({
    id: tab.id,
    title: tab.title,
    url: tab.url,
    port: p,
  }, null, 2));
  console.error(
    `\nOpened: ${tab.title || url}` +
      `\n\nFor a multi-step validation, prefer a session (auto-targets this kind of tab):` +
      `\n  capture session start --url "${url}"` +
      `\n\nOr interact one-off against this tab:` +
      `\n  capture a11y       --port ${p} --target ${tab.id.slice(0, 8)} --interactive` +
      `\n  capture screenshot --port ${p} --target ${tab.id.slice(0, 8)}` +
      `\n  capture exec "<js>" --port ${p} --target ${tab.id.slice(0, 8)}`,
  );
  return;
}

export async function cmdResetTab(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture reset-tab <url> [--port <port>]\n\n' +
        'Abandon a stuck/unresponsive tab and open a fresh one.\n' +
        'Updates session context so subsequent commands auto-target the new tab.\n\n' +
        'Example: capture reset-tab "https://www.instagram.com/"',
    );
    process.exit(0);
  }
  const url = parsed.positional[0];
  if (!url) {
    console.error(
      'Usage: capture reset-tab <url> [--port <port>]',
    );
    process.exit(1);
  }
  const p = parsed.port ?? (await detectCdpPort());
  const tab = await openTab(p, url);

  // Wait for page load
  if (tab.webSocketDebuggerUrl) {
    const client = new CDPClient(tab.webSocketDebuggerUrl);
    await client.waitReady();
    await client.send('Page.enable');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 10000);
      client.on('Page.loadEventFired', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    client.close();
  }

  // Update session context so subsequent commands auto-target the new tab
  updateActiveSession({ targetId: tab.id });

  console.log(JSON.stringify({ id: tab.id, url: tab.url, port: p }, null, 2));
  console.error(`\nNew tab opened. Session context updated.`);
  console.error(`Use --target ${tab.id.slice(0, 8)} if passing target explicitly.`);
  return;
}
