import { CDPClient } from './client.js';
import { findTabByIdAcrossEndpoints } from './targets.js';
import { buildExecExpression } from './exec-expression.js';
import { ConsoleRecorder, type ConsoleEntry } from './console-recorder.js';
import { HARRecorder } from './har-recorder.js';
import { printConsoleSummary } from './console-recorder.js';
import { writeHarAndPrintSummary } from './har-output.js';
import { type HAREntry } from '../har-manager.js';

export interface ExecuteOptions {
  port?: number;
  targetId?: string;
  record?: boolean;
  harOutPath?: string;
  timeoutMs?: number;
}

export interface ExecuteResult {
  success: boolean;
  value?: unknown;
  error?: string;
  har?: { log: { entries: HAREntry[] } };
  console: ConsoleEntry[];
}

export async function executeInBrowser(
  code: string,
  options: ExecuteOptions = {},
): Promise<ExecuteResult> {
  if (!options.targetId) {
    throw new Error('Use --target <tabId> to target a tab. Run "capture list" to see available tabs.');
  }

  const resolved = await findTabByIdAcrossEndpoints(options.targetId, options.port);
  const tab = resolved?.tab ?? null;
  if (!tab) {
    throw new Error(
      `No tab found for target "${options.targetId}". Run "capture list" to see available tabs.`,
    );
  }

  if (!tab.webSocketDebuggerUrl) {
    throw new Error('Tab has no WebSocket debugger URL');
  }

  const client = new CDPClient(tab.webSocketDebuggerUrl);
  await client.waitReady();

  // Emulate focus so network requests aren't deferred by the browser,
  // without actually bringing the tab to the foreground
  await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });

  const consoleRecorder = new ConsoleRecorder(client);
  await consoleRecorder.start();

  let harRecorder: HARRecorder | undefined;
  if (options.record) {
    harRecorder = new HARRecorder(client);
    await harRecorder.start();
  }

  try {
    // Execute code
    const result = (await client.send(
      'Runtime.evaluate',
      {
        expression: buildExecExpression(code),
        awaitPromise: true,
        returnByValue: true,
      },
      options.timeoutMs,
    )) as {
      result?: { value?: unknown };
      exceptionDetails?: { exception?: { description?: string } };
    };

    // Build HAR if recording
    let har: { log: { entries: HAREntry[] } } | undefined;
    if (harRecorder) {
      har = await harRecorder.finish();
      writeHarAndPrintSummary(har, options.harOutPath);
    }

    const consoleEntries = consoleRecorder.finish();
    printConsoleSummary(consoleEntries);
    client.close();

    if (result.exceptionDetails) {
      return {
        success: false,
        error:
          result.exceptionDetails.exception?.description ?? 'Unknown error',
        har,
        console: consoleEntries,
      };
    }

    return {
      success: true,
      value: result.result?.value,
      har,
      console: consoleEntries,
    };
  } catch (err) {
    const consoleEntries = consoleRecorder.finish();
    client.close();
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      console: consoleEntries,
    };
  }
}
