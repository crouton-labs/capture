import { execSync } from 'child_process';

export const BROWSER_PATTERNS: Record<string, string[]> = {
  'company.thebrowser.browser': ['arc'],
  'com.google.chrome': ['chrome', 'google chrome'],
  'com.brave.browser': ['brave'],
  'com.microsoft.edgemac': ['edge', 'microsoft edge'],
  'org.chromium.chromium': ['chromium'],
};

export function getDefaultBrowserId(): string | null {
  try {
    const output = execSync(
      'defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers 2>/dev/null',
      { encoding: 'utf-8' },
    );
    const match = output.match(
      /LSHandlerRoleAll = "([^"]+)";\s*LSHandlerURLScheme = https;/,
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

interface CdpProbeResult {
  browser: string;
  app: string;
  isElectron: boolean;
  hasPageTarget: boolean;
}

// Node's inspector, workerd/Miniflare's inspector, and similar V8-Inspector-
// protocol processes all speak enough of the Chrome DevTools Protocol to
// answer /json/version with a `Browser` field, so a naive probe mistakes them
// for a real browser. They are not: they never return a top-level
// `webSocketDebuggerUrl` (there's no browser-level target to attach to, only
// the single runtime target) and they never host a `page`-type target. Both
// are checked so these endpoints are excluded from auto-selection instead of
// being confused for the intended browser.
async function probeCdpPort(port: number): Promise<CdpProbeResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);
    const resp = await fetch(`http://localhost:${port}/json/version`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (resp.ok) {
      const version = (await resp.json()) as {
        Browser?: string;
        'User-Agent'?: string;
        webSocketDebuggerUrl?: string;
      };
      const browser = version.Browser;
      const userAgent = version['User-Agent'] ?? '';
      if (!browser) return null;
      // No browser-level WebSocket debugger URL means there's nothing to
      // open new tabs on — this isn't a controllable browser.
      if (!version.webSocketDebuggerUrl) return null;

      const isElectron = userAgent.includes('Electron');

      // Extract app name from User-Agent for Electron apps
      // Pattern: "AppName/1.2.3 Chrome/..." in the UA string
      let app = browser;
      if (isElectron) {
        const appMatch = userAgent.match(
          /(\S+?)\/[\d.]+ Chrome\/[\d.]+ Electron/,
        );
        if (appMatch) app = appMatch[1];
      }

      const hasPageTarget = await probeHasPageTarget(port);

      return { browser, app, isElectron, hasPageTarget };
    }
  } catch {
    // Not a CDP port or not responding
  }
  return null;
}

async function probeHasPageTarget(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);
    const resp = await fetch(`http://localhost:${port}/json/list`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return false;
    const list = (await resp.json()) as Array<{ type?: string }>;
    return Array.isArray(list) && list.some((t) => t.type === 'page');
  } catch {
    return false;
  }
}

function getLocalhostListeningPorts(): number[] {
  try {
    // netstat is much faster than lsof on macOS
    const output = execSync(
      'netstat -an 2>/dev/null | grep "127.0.0.1.*LISTEN"',
      { encoding: 'utf-8' },
    );
    const ports: number[] = [];
    for (const line of output.split('\n')) {
      // Format: tcp4       0      0  127.0.0.1.56192        *.*                    LISTEN
      const match = line.match(/127\.0\.0\.1\.(\d+)/);
      if (match) {
        ports.push(parseInt(match[1], 10));
      }
    }
    return ports;
  } catch {
    return [];
  }
}

function getListeningProcessNames(): Map<number, string> {
  const names = new Map<number, string>();
  try {
    const output = execSync('lsof -nP -iTCP -sTCP:LISTEN -Fpcn 2>/dev/null', {
      encoding: 'utf-8',
    });
    let command: string | null = null;
    for (const line of output.split('\n')) {
      if (line.startsWith('c')) {
        command = line.slice(1);
      } else if (command && line.startsWith('n')) {
        const match = line.match(/:(\d+)(?:\s|$)/);
        if (match) names.set(Number(match[1]), command);
      }
    }
  } catch {
    // Process identity is an optional refinement; CDP probing still works.
  }
  return names;
}

export function identifyBrowserBundleId(browser: string, processName?: string): string {
  // A listening process is stronger identity than Chromium's generic
  // Browser/User-Agent strings: Arc and Spotify both report as "Chrome".
  const identity = (processName ?? browser).toLowerCase();
  for (const [bundleId, patterns] of Object.entries(BROWSER_PATTERNS)) {
    if (patterns.some((pattern) => identity.includes(pattern))) return bundleId;
  }
  return 'unknown';
}

export interface CdpEndpoint {
  port: number;
  app: string;
  bundleId: string;
  isElectron: boolean;
  hasPageTarget: boolean;
}

export async function detectCdpPortsAsync(): Promise<CdpEndpoint[]> {
  const ports = getLocalhostListeningPorts();
  const processNames = getListeningProcessNames();
  const results: CdpEndpoint[] = [];

  // Probe ports in parallel for speed
  const probes = ports.map(async (port) => {
    const probe = await probeCdpPort(port);
    if (probe) {
      const processName = processNames.get(port);
      results.push({
        port,
        app: processName ?? probe.app,
        bundleId: identifyBrowserBundleId(probe.browser, processName),
        isElectron: probe.isElectron,
        hasPageTarget: probe.hasPageTarget,
      });
    }
  });

  await Promise.all(probes);
  return results;
}

// Selects the endpoint `detect`/`detectCdpPort` should treat as "the"
// browser out of everything discovered on localhost. Shared so `capture
// detect`'s printed default always matches what auto-discovery actually
// picks for session start / navigate / etc.
export function pickPreferredEndpoint(
  endpoints: CdpEndpoint[],
  defaultBrowser: string | null,
): CdpEndpoint {
  // Endpoints that already host a real page/tab are real browsers. CDP-
  // speaking non-browser processes (Node/workerd inspectors, etc.) never do,
  // so prefer real browsers whenever at least one is present — this is what
  // keeps an unrelated CDP listener from being picked over the intended one.
  const withPages = endpoints.filter((e) => e.hasPageTarget);
  const candidates = withPages.length > 0 ? withPages : endpoints;

  if (defaultBrowser) {
    const match = candidates.find(
      (p) => p.bundleId === defaultBrowser && !p.isElectron,
    );
    if (match) return match;
  }

  // Prefer a recognized browser over other Chromium hosts (Spotify, app
  // shells), then fall back to the original non-Electron ordering.
  const knownBrowser = candidates.find(
    (endpoint) => endpoint.bundleId !== 'unknown' && !endpoint.isElectron,
  );
  if (knownBrowser) return knownBrowser;
  const nonElectron = candidates.find((endpoint) => !endpoint.isElectron);
  return nonElectron ?? candidates[0];
}

export async function detectCdpPort(): Promise<number> {
  const endpoints = await detectCdpPortsAsync();
  if (endpoints.length === 0) {
    throw new Error(
      'No browser with CDP found. Start your browser with remote debugging enabled:\n' +
        '  Arc: Already enabled by default\n' +
        '  Chrome: --remote-debugging-port=9222\n' +
        '  Electron apps expose CDP automatically',
    );
  }

  return pickPreferredEndpoint(endpoints, getDefaultBrowserId()).port;
}
