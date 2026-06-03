import * as fs from 'fs';
import { withConnection } from '../connection.js';
import { HARRecorder } from '../har-recorder.js';
import { writeHarAndPrintSummary } from '../har-output.js';
import { type ParsedArgs } from '../types.js';

export async function cmdExec(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture exec <code> [--target <id>] [--record] [--file <path>] [--har <id>]\n\n' +
        'Execute JavaScript in a browser tab. Supports await (wrapped in async IIFE).\n\n' +
        'Examples:\n' +
        '  capture exec "document.title" --target <id>\n' +
        '  capture exec "await fetch(\'/api/data\').then(r=>r.json())" --target <id>\n' +
        '  capture exec "document.querySelector(\'.btn\').click()" --target <id>\n' +
        '  capture exec --file /tmp/scrape.js --target <id> --record',
    );
    process.exit(0);
  }
  let code: string;
  if (parsed.file) {
    code = fs.readFileSync(parsed.file, 'utf-8');
  } else {
    code = parsed.positional[0];
    if (!code) {
      console.error(
        'ERROR: Missing code to execute.\n\n' +
          'Usage: capture exec <code> [--target <id>] [--record] [--file <path>]\n\n' +
          'Examples:\n' +
          '  capture exec "document.title" --target <id>\n' +
          '  capture exec "document.querySelector(\'.btn\').click()" --target <id>\n' +
          '  capture exec --file /tmp/scrape.js --target <id> --record',
      );
      process.exit(1);
    }
  }

  await withConnection(
    parsed,
    async (client) => {
      await client.send('Emulation.setFocusEmulationEnabled', { enabled: true });

      // Standalone HAR recording (--record flag writes its own file)
      let standaloneRecorder: HARRecorder | undefined;
      if (parsed.record) {
        standaloneRecorder = new HARRecorder(client);
        await standaloneRecorder.start();
      }

      // Smart wrapping: only use async IIFE when code contains `await`.
      // Without wrapping, Runtime.evaluate returns the completion value
      // of the last expression, handling multi-statement code naturally.
      const needsAsyncWrap = /\bawait\b/.test(code);
      const expression = needsAsyncWrap
        ? `(async () => { ${code} })()`
        : code;

      const evalResult = (await client.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })) as {
        result?: { value?: unknown };
        exceptionDetails?: { exception?: { description?: string } };
      };

      if (standaloneRecorder) {
        const har = await standaloneRecorder.finish();
        writeHarAndPrintSummary(har, parsed.harOut);
      }

      if (evalResult.exceptionDetails) {
        console.error(
          `ERROR: ${evalResult.exceptionDetails.exception?.description ?? 'Unknown error'}`,
        );
        process.exit(1);
      }

      console.log(JSON.stringify(evalResult.result?.value));
    },
    { settle: 3000 },
  );
  return;
}
