import * as fs from 'fs';
import { CDPClient } from './client.js';
import { findTabByIdAcrossEndpoints, findTabByUrlAcrossEndpoints } from './targets.js';
import { type CDPTarget, type ParsedArgs } from './types.js';
import { ConsoleRecorder, printConsoleSummary } from './console-recorder.js';
import { HARRecorder } from './har-recorder.js';
import {
  harFilePath,
  appendToHarRecording as appendToHar,
} from '../har-manager.js';
import { getActiveSession, updateActiveSession } from '../session-context.js';

function getPortFromWebSocketDebuggerUrl(url?: string): number | null {
  if (!url) return null;
  try {
    return Number(new URL(url).port);
  } catch {
    return null;
  }
}

export async function connectForCommand(
  parsed: ParsedArgs,
): Promise<{ client: CDPClient; tab: CDPTarget }> {
  if (!parsed.target && !parsed.url) {
    throw new Error('Use --target <tabId> or --url <pattern> to target a tab. Run "capture list" to see available tabs.');
  }

  const resolved = parsed.target
    ? await findTabByIdAcrossEndpoints(parsed.target, parsed.port)
    : await findTabByUrlAcrossEndpoints(parsed.url!, parsed.port);
  const tab = resolved?.tab ?? null;

  if (!tab) {
    const query = parsed.target ?? parsed.url;
    throw new Error(
      `No tab found for ${parsed.target ? 'target' : 'URL pattern'} "${query}". Run "capture list" to see available tabs.`,
    );
  }

  if (!tab.webSocketDebuggerUrl) {
    throw new Error('Tab has no WebSocket debugger URL');
  }

  // Lazy-populate targetId in active session if not yet set
  const activeSession = getActiveSession();
  if (activeSession && !activeSession.targetId) {
    updateActiveSession({ targetId: tab.id });
  }

  const port = resolved?.port ?? getPortFromWebSocketDebuggerUrl(tab.webSocketDebuggerUrl);
  console.error(
    `Using target ${tab.id.slice(0, 8)}${port ? ` on port ${port}` : ''}${tab.url ? ` (${tab.url})` : ''}`,
  );

  const client = new CDPClient(tab.webSocketDebuggerUrl);
  await client.waitReady();

  return { client, tab };
}

export async function withConnection<T>(
  parsed: ParsedArgs,
  fn: (client: CDPClient, tab: CDPTarget) => Promise<T>,
  opts: { settle?: number } = {},
): Promise<T> {
  const { client, tab } = await connectForCommand(parsed);

  const consoleRecorder = new ConsoleRecorder(client);
  await consoleRecorder.start();

  let harRecorder: HARRecorder | undefined;
  if (parsed.har) {
    // Validate HAR ID exists before starting recording
    const harPath = harFilePath(parsed.har);
    if (!fs.existsSync(harPath)) {
      console.error(
        `ERROR: No HAR recording found for --har "${parsed.har}". Run 'har create' first.`,
      );
      process.exit(1);
    }
    harRecorder = new HARRecorder(client);
    await harRecorder.start();
  }

  try {
    const result = await fn(client, tab);

    // Wait for network activity triggered by the action, then append to HAR
    if (harRecorder && parsed.har) {
      const settle = opts.settle !== undefined ? opts.settle : 3000;
      if (settle > 0) {
        await new Promise((r) => setTimeout(r, settle));
      }
      const har = await harRecorder.finish();
      if (har.log.entries.length > 0) {
        appendToHar(parsed.har, har.log.entries);
        console.error(
          `  [har:${parsed.har}] +${har.log.entries.length} entries`,
        );
      }
    }

    printConsoleSummary(consoleRecorder.finish());

    return result;
  } finally {
    client.close();
  }
}
