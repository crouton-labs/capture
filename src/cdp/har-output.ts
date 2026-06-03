import * as fs from 'fs';
import { type HAREntry } from '../har-manager.js';

export function writeHarAndPrintSummary(
  har: { log: { entries: HAREntry[] } },
  harOutPath?: string,
): string | undefined {
  if (har.log.entries.length === 0 && !harOutPath) return undefined;

  const harPath = harOutPath ?? `/tmp/capture-har-${Date.now()}.json`;
  try {
    fs.writeFileSync(harPath, JSON.stringify(har, null, 2));
  } catch (err) {
    // Fallback: strip response bodies and retry
    const stripped = {
      log: {
        ...har.log,
        entries: har.log.entries.map((e) => ({
          ...e,
          response: { ...e.response, content: { text: '[body stripped — too large to serialize]' } },
        })),
      },
    };
    fs.writeFileSync(harPath, JSON.stringify(stripped, null, 2));
    console.error('  WARNING: Response bodies stripped from HAR (too large to serialize)');
  }

  // Print summary to stderr
  const errors = har.log.entries.filter((e) => e.response.status >= 400);
  console.error(
    `\nHAR: ${har.log.entries.length} requests captured → ${harPath}`,
  );
  if (errors.length > 0) {
    console.error(`  ${errors.length} failed:`);
    for (const entry of errors) {
      const method = entry.request.method.padEnd(6);
      const status = entry.response.status;
      const url =
        entry.request.url.length > 100
          ? entry.request.url.slice(0, 97) + '...'
          : entry.request.url;
      console.error(`  ${method} ${status} ${url}`);
    }
  }

  return harPath;
}
