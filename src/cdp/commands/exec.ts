import * as fs from 'fs';
import { withConnection } from '../connection.js';
import { buildExecExpression } from '../exec-expression.js';
import { type ParsedArgs } from '../types.js';
import { hasImports, bundleExec } from '../../vault/bundle.js';

export async function cmdExec(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(
      'Usage: capture exec <code> [--target <id>] [--record] [--file <path>] [--har <id>]\n\n' +
        'Execute JavaScript in a browser tab. Plain expressions run directly; statement bodies can use top-level return/await and are wrapped in an async IIFE.\n\n' +
        'Examples:\n' +
        '  capture exec "document.title" --target <id>\n' +
        '  capture exec "return document.title" --target <id>\n' +
        '  capture exec "return await fetch(\'/api/data\').then(r=>r.json())" --target <id>\n' +
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
          'Supported shapes:\n' +
          '  document.title\n' +
          '  return document.title\n' +
          '  const r = await fetch(\'/api/data\'); return await r.json()\n\n' +
          'Examples:\n' +
          '  capture exec "document.title" --target <id>\n' +
          '  capture exec "return document.title" --target <id>\n' +
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

      // A prebuilt bundle is already a complete IIFE returning the user's
      // promise. Otherwise fall back to the exec expression wrapper: bare
      // expressions run directly, while snippets containing top-level `return`
      // or `await` are wrapped in an async IIFE.
      const expression = buildExecExpression(code, prebuilt);

      const evalResult = (await client.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })) as {
        result?: { value?: unknown };
        exceptionDetails?: { exception?: { description?: string } };
      };

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
