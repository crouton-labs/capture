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
}

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
      };
      const browser = version.Browser;
      const userAgent = version['User-Agent'] ?? '';
      if (!browser) return null;

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

      return { browser, app, isElectron };
    }
  } catch {
    // Not a CDP port or not responding
  }
  return null;
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

export interface CdpEndpoint {
  port: number;
  app: string;
  bundleId: string;
  isElectron: boolean;
}

export async function detectCdpPortsAsync(): Promise<CdpEndpoint[]> {
  const ports = getLocalhostListeningPorts();
  const results: CdpEndpoint[] = [];

  // Probe ports in parallel for speed
  const probes = ports.map(async (port) => {
    const probe = await probeCdpPort(port);
    if (probe) {
      // Map browser string to bundle ID for default browser matching
      const lower = probe.browser.toLowerCase();
      let bundleId = 'unknown';
      for (const [bid, patterns] of Object.entries(BROWSER_PATTERNS)) {
        if (patterns.some((p) => lower.includes(p))) {
          bundleId = bid;
          break;
        }
      }
      results.push({
        port,
        app: probe.app,
        bundleId,
        isElectron: probe.isElectron,
      });
    }
  });

  await Promise.all(probes);
  return results;
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

  // Use default browser if available (prefer non-Electron)
  const defaultBrowser = getDefaultBrowserId();
  if (defaultBrowser) {
    const match = endpoints.find(
      (p) => p.bundleId === defaultBrowser && !p.isElectron,
    );
    if (match) return match.port;
  }

  // Fall back to first non-Electron, then first found
  const nonElectron = endpoints.find((p) => !p.isElectron);
  return (nonElectron ?? endpoints[0]).port;
}
