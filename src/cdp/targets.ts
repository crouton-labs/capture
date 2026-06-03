import { CDPClient } from './client.js';
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
    webSocketDebuggerUrl: string;
  };
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

export async function openTab(port: number, url: string): Promise<CDPTarget> {
  const { client } = await getBrowserClient(port);

  try {
    // Create new target in background to avoid stealing user's focus
    const result = (await client.send('Target.createTarget', {
      url,
      background: true,
    })) as {
      targetId: string;
    };

    // Return target info
    return {
      id: result.targetId,
      title: '',
      url,
      type: 'page',
      webSocketDebuggerUrl: `ws://localhost:${port}/devtools/page/${result.targetId}`,
    };
  } finally {
    client.close();
  }
}
