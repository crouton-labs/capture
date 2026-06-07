import * as fs from 'fs';
import { withConnection } from '../connection.js';
import { HARRecorder } from '../har-recorder.js';
import { writeHarAndPrintSummary } from '../har-output.js';
import { type ParsedArgs } from '../types.js';
import { hasImports, bundleExec } from '../../vault/bundle.js';

export async function cmdExec(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture exec <code> [--target <id>] [--record] [--file <path>] [--har <id>]\n\n' +
        'Execute JavaScript in a browser tab. Supports await (wrapped in async IIFE).\n\n' +
        'Examples:\n' +
        '  capture exec "document.title" --target <id>\n' +
        '  capture exec "await fetch(\'/api/data\').then(r=>r.json())" --target <id>\n' +
        '  capture exec "document.querySelector(\'.btn\').click()" --target <id>\n' +
        '  capture exec --file /tmp/scrape.js --target <id> --record\n\n' +
        'Import vault libs (dev checkout only): static imports first, then your code.\n' +
        '  capture exec "import {searchEmails} from \'libs/gmail\'; const ctx = await getContext(); return await searchEmails({ ...ctx, query: \'invoice\' })"',
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

  // Import-driven exec: if the code has leading static imports, bundle the
  // forked vault libs on the fly (esbuild) BEFORE opening a tab — fail fast,
  // no wasted CDP connection. Plain exec (no imports) skips this entirely.
  let prebuilt: string | undefined;
  if (hasImports(code)) {
    try {
      prebuilt = await bundleExec(code);
    } catch (e) {
      console.error(`ERROR: ${(e as Error).message}`);
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

      // A prebuilt bundle is already a complete IIFE returning the user's
      // promise. Otherwise fall back to the existing smart wrap: async IIFE
      // only when code contains `await`; bare code lets Runtime.evaluate return
      // the last expression's completion value (multi-statement code works).
      const expression = prebuilt
        ? prebuilt
        : /\bawait\b/.test(code)
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
