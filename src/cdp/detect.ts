import { execSync } from 'child_process';
import * as http from 'http';

/**
 * A CDP-endpoint JSON probe that CANNOT leak a socket handle. Node's built-in
 * `fetch` (undici) leaves a dangling socket + request handle when a
 * connect-phase abort fires against a port that accepts TCP but never sends an
 * HTTP response (e.g. a docker-proxied or half-open listener). That handle
 * keeps this short-lived CLI process alive for undici's ~7s internal socket
 * timeout AFTER all real work is done, so a single dead port on the machine
 * adds ~7s to every command that runs port detection. A raw `http.get` whose
 * request we explicitly `destroy()` on timeout releases the handle immediately.
 *
 * Resolves to the parsed JSON body on a 2xx response, or `null` on any
 * timeout, connection error, non-2xx status, or unparseable body.
 */
function httpGetJson(
  port: number,
  path: string,
  timeoutMs: number,
): Promise<unknown | null> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: 'localhost', port, path, timeout: timeoutMs },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          res.resume();
          resolve(null);
          return;
        }
        let body = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
        res.on('error', () => resolve(null));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

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
    const version = (await httpGetJson(port, '/json/version', 500)) as {
      Browser?: string;
      'User-Agent'?: string;
      webSocketDebuggerUrl?: string;
    } | null;
    if (version) {
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
    const list = (await httpGetJson(port, '/json/list', 500)) as Array<{
      type?: string;
    }> | null;
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
export interface PreferredEndpointSelection {
  endpoint: CdpEndpoint;
  reason: string;
}

export function pickPreferredEndpointWithReason(
  endpoints: CdpEndpoint[],
  defaultBrowser: string | null,
): PreferredEndpointSelection {
  // Endpoints that already host a real page/tab are real browsers. CDP-
  // speaking non-browser processes (Node/workerd inspectors, etc.) never do,
  // so prefer real browsers whenever at least one is present — this is what
  // keeps an unrelated CDP listener from being picked over the intended one.
  const withPages = endpoints.filter((e) => e.hasPageTarget);
  const candidates = withPages.length > 0 ? withPages : endpoints;
  const candidateScope = withPages.length > 0
    ? 'among endpoints with a live page target'
    : 'because no discovered endpoint has a live page target';

  if (defaultBrowser) {
    const match = candidates.find(
      (p) => p.bundleId === defaultBrowser && !p.isElectron,
    );
    if (match) return { endpoint: match, reason: `matched the configured default browser ${candidateScope}` };
  }

  // Prefer a recognized browser over other Chromium hosts (Spotify, app
  // shells), then fall back to the original non-Electron ordering.
  const knownBrowser = candidates.find(
    (endpoint) => endpoint.bundleId !== 'unknown' && !endpoint.isElectron,
  );
  if (knownBrowser) return { endpoint: knownBrowser, reason: `is a recognized non-Electron browser ${candidateScope}` };
  const nonElectron = candidates.find((endpoint) => !endpoint.isElectron);
  if (nonElectron) return { endpoint: nonElectron, reason: `is the first non-Electron endpoint ${candidateScope}` };
  return { endpoint: candidates[0], reason: `is the first discovered endpoint ${candidateScope}` };
}

export function pickPreferredEndpoint(
  endpoints: CdpEndpoint[],
  defaultBrowser: string | null,
): CdpEndpoint {
  return pickPreferredEndpointWithReason(endpoints, defaultBrowser).endpoint;
}

export async function detectCdpEndpoint(): Promise<CdpEndpoint & { selectionReason: string }> {
  const endpoints = await detectCdpPortsAsync();
  if (endpoints.length === 0) {
    throw new Error(
      'No browser with CDP found. Start your browser with remote debugging enabled:\n' +
        '  Arc: Already enabled by default\n' +
        '  Chrome: --remote-debugging-port=9222\n' +
        '  Electron apps expose CDP automatically',
    );
  }
  const { endpoint, reason } = pickPreferredEndpointWithReason(endpoints, getDefaultBrowserId());
  return { ...endpoint, selectionReason: reason };
}

export async function detectCdpPort(): Promise<number> {
  return (await detectCdpEndpoint()).port;
}
