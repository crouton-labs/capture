import { recordTraffic, navigateAndRecord } from '../record.js';
import { withConnection } from '../connection.js';
import { appendToHarRecording as appendToHar } from '../../har-manager.js';
import { type ParsedArgs } from '../types.js';

export async function cmdRecord(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture record --target <id> [--duration <secs>] [--har-out <path>]\n\n' +
        'Passive HAR recording for the specified duration (default: 10s).',
    );
    process.exit(0);
  }
  if (!parsed.target) {
    console.error(
      'Usage: capture record --target <id> [--duration <secs>] [--har-out <path>]',
    );
    process.exit(1);
  }

  const result = await recordTraffic({
    port: parsed.port,
    targetId: parsed.target,
    duration: parsed.duration,
    harOutPath: parsed.harOut,
  });
  console.log(
    JSON.stringify(
      { entryCount: result.entryCount, harPath: result.harPath },
      null,
      2,
    ),
  );
  return;
}

export async function cmdNavigate(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture navigate <url> [--har-out <path>] [--settle <ms>] [--har <id>]\n\n' +
        'Navigate to URL and record HAR. Appends to session HAR if --har is set.\n\n' +
        'Example: capture navigate "https://app.example.com/dashboard" --settle 3000',
    );
    process.exit(0);
  }
  const url = parsed.positional[0];
  if (!url) {
    console.error(
      'Usage: capture navigate <url> [--har-out <path>] [--settle <ms>]',
    );
    process.exit(1);
  }

  const result = await navigateAndRecord({
    port: parsed.port,
    url,
    targetId: parsed.target,
    harOutPath: parsed.har ? undefined : parsed.harOut,
    settle: parsed.settle,
  });

  // Append to session HAR if active
  if (parsed.har && result.har.log.entries.length > 0) {
    appendToHar(parsed.har, result.har.log.entries);
    console.error(`  [har:${parsed.har}] +${result.har.log.entries.length} entries`);
  }

  console.log(
    JSON.stringify(
      {
        entryCount: result.entryCount,
        harPath: result.harPath,
        tabUrl: result.tab.url,
        timedOut: result.timedOut,
      },
      null,
      2,
    ),
  );
  return;
}

export async function cmdNetwork(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture network <offline|online> [--target <id>]\n\n' +
        'Toggle network connectivity for a tab. Use "offline" to simulate\n' +
        'network failure (kills WebSocket connections, blocks HTTP requests).\n' +
        'Use "online" to restore connectivity.',
    );
    process.exit(0);
  }
  const mode = parsed.positional[0];
  if (!mode || !['offline', 'online'].includes(mode)) {
    console.error('Usage: capture network <offline|online> [--target <id>]');
    process.exit(1);
  }
  const offline = mode === 'offline';
  const result = await withConnection(
    parsed,
    async (client) => {
      await client.send('Network.enable');
      await client.send('Network.emulateNetworkConditions', {
        offline,
        latency: offline ? -1 : 0,
        downloadThroughput: offline ? 0 : -1,
        uploadThroughput: offline ? 0 : -1,
      });
      return { network: mode, offline };
    },
    { settle: 0 },
  );
  console.log(JSON.stringify(result, null, 2));
  if (offline) {
    console.error('\nNetwork disabled. WebSocket connections will drop.');
    console.error('Restore with: capture network online');
  } else {
    console.error('\nNetwork restored.');
  }
  return;
}
