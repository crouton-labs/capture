import { CDPClient } from './client.js';
import { detectCdpPortsAsync } from './detect.js';
import { type CDPTarget } from './types.js';

async function getBrowserClient(
  port: number,
): Promise<{ client: CDPClient; browserWsUrl: string }> {
  const versionResp = await fetch(`http://localhost:${port}/json/version`);
  if (!versionResp.ok) {
    throw new Error(
      `Failed to connect to CDP on port ${port}: ${versionResp.status}`,
    );
  }
  const version = (await versionResp.json()) as {
    webSocketDebuggerUrl?: string;
  };
  if (!version.webSocketDebuggerUrl) {
    throw new Error(
      `Port ${port} answers CDP's /json/version but has no browser-level WebSocket debugger URL — ` +
        `it's not a real browser (e.g. a Node/workerd inspector), so it can't host tabs. ` +
        `Run "capture detect" to find a real browser endpoint, or pass --port explicitly.`,
    );
  }
  const client = new CDPClient(version.webSocketDebuggerUrl);
  await client.waitReady();
  return { client, browserWsUrl: version.webSocketDebuggerUrl };
}

export async function listTargets(port: number): Promise<CDPTarget[]> {
  const { client } = await getBrowserClient(port);

  try {
    // Enable target discovery to get all targets including pages
    await client.send('Target.setDiscoverTargets', { discover: true });
    const result = (await client.send('Target.getTargets')) as {
      targetInfos: Array<{
        targetId: string;
        type: string;
        title: string;
        url: string;
      }>;
    };

    // Convert to CDPTarget format with webSocketDebuggerUrl
    return result.targetInfos.map((t) => ({
      id: t.targetId,
      title: t.title,
      url: t.url,
      type: t.type,
      webSocketDebuggerUrl: `ws://localhost:${port}/devtools/page/${t.targetId}`,
    }));
  } finally {
    client.close();
  }
}

export async function findTab(
  port: number,
  urlPattern?: string,
): Promise<CDPTarget | null> {
  const targets = await listTargets(port);
  const pages = targets.filter((t) => t.type === 'page');

  if (!urlPattern) {
    // Return first page
    return pages[0] ?? null;
  }

  // Find by URL pattern
  const pattern = urlPattern.toLowerCase();
  return pages.find((t) => t.url.toLowerCase().includes(pattern)) ?? null;
}

export async function findTabById(
  port: number,
  targetId: string,
): Promise<CDPTarget | null> {
  const targets = await listTargets(port);
  // Exact match first
  const exact = targets.find((t) => t.id === targetId);
  if (exact) return exact;
  // Prefix match (min 4 chars to avoid ambiguity)
  if (targetId.length >= 4) {
    const prefix = targetId.toUpperCase();
    const matches = targets.filter((t) => t.id.toUpperCase().startsWith(prefix));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous target prefix "${targetId}" matches ${matches.length} tabs:\n` +
          matches.map((t) => `  ${t.id.slice(0, 8)}  ${t.url}`).join('\n'),
      );
    }
  }
  return null;
}

export async function findTabByIdInPorts(
  targetId: string,
  ports: number[],
  finder: (port: number, targetId: string) => Promise<CDPTarget | null> = findTabById,
): Promise<{ port: number; tab: CDPTarget } | null> {
  for (const port of ports) {
    try {
      const tab = await finder(port, targetId);
      if (tab) return { port, tab };
    } catch {
      // Skip endpoints that fail or are ambiguous on a different port.
    }
  }
  return null;
}

function normalizeUrlForMatch(value: string): { full: string; host: string; path: string } | null {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return {
      full: `${url.origin}${path}${url.search}${url.hash}`.toLowerCase(),
      host: url.hostname.toLowerCase(),
      path: path.toLowerCase(),
    };
  } catch {
    return null;
  }
}

export function scoreTabUrlMatch(tabUrl: string, requestedUrl: string): number {
  const tab = normalizeUrlForMatch(tabUrl);
  const requested = normalizeUrlForMatch(requestedUrl);

  if (tab && requested) {
    if (tab.full === requested.full) return 100;
    if (tab.host === requested.host && tab.path === requested.path) return 95;
    if (tab.host === requested.host && tab.path.startsWith(requested.path)) return 90;
    if (tab.host === requested.host && requested.path.startsWith(tab.path)) return 85;
    if (tab.host === requested.host) return 70;
    if (tab.full.includes(requested.full)) return 60;
    if (tab.full.includes(requested.host)) return 50;
    if (requested.full.includes(tab.full)) return 40;
    return 0;
  }

  const tabLower = tabUrl.toLowerCase();
  const requestedLower = requestedUrl.toLowerCase();
  if (tabLower === requestedLower) return 100;
  if (tabLower.includes(requestedLower)) return 60;
  if (requestedLower.includes(tabLower)) return 40;
  return 0;
}

function resolveSearchPorts(
  endpoints: Array<{ port: number }>,
  preferredPort?: number,
): number[] {
  if (preferredPort) return [preferredPort];
  return endpoints.map((endpoint) => endpoint.port);
}

export async function findTabByIdAcrossEndpoints(
  targetId: string,
  preferredPort?: number,
): Promise<{ port: number; tab: CDPTarget } | null> {
  const ports = resolveSearchPorts(await detectCdpPortsAsync(), preferredPort);
  return findTabByIdInPorts(targetId, ports);
}

export async function findTabByUrlAcrossEndpoints(
  url: string,
  preferredPort?: number,
): Promise<{ port: number; tab: CDPTarget } | null> {
  const ports = resolveSearchPorts(await detectCdpPortsAsync(), preferredPort);
  let best: { port: number; tab: CDPTarget; score: number } | null = null;

  for (const port of ports) {
    try {
      const targets = await listTargets(port);
      for (const tab of targets.filter((t) => t.type === 'page')) {
        const score = scoreTabUrlMatch(tab.url, url);
        if (score <= 0) continue;
        if (!best || score > best.score || (score === best.score && port < best.port)) {
          best = { port, tab, score };
        }
      }
    } catch {
      // Skip endpoints that fail to respond.
    }
  }

  return best ? { port: best.port, tab: best.tab } : null;
}

export function requireTargetId(
  targetId: string | null | undefined,
  url: string,
): string {
  if (!targetId) {
    throw new Error(
      `Target.createTarget returned no targetId for ${url}. Reuse an existing tab with --target.`,
    );
  }
  return targetId;
}

export async function openTab(port: number, url: string): Promise<CDPTarget> {
  const { client } = await getBrowserClient(port);

  try {
    // Create new target in background to avoid stealing user's focus
    const result = (await client.send('Target.createTarget', {
      url,
      background: true,
    })) as {
      targetId: string | null;
    };
    const targetId = requireTargetId(result.targetId, url);

    // Return target info
    return {
      id: targetId,
      title: '',
      url,
      type: 'page',
      webSocketDebuggerUrl: `ws://localhost:${port}/devtools/page/${targetId}`,
    };
  } finally {
    client.close();
  }
}
