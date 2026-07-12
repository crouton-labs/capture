#!/usr/bin/env tsx
/**
 * CDP (Chrome DevTools Protocol) — the library barrel over the CDP substrate.
 *
 * Re-exports the client, target discovery, execution, screenshot, recording,
 * and tab-lock building blocks, plus `cdpMain` (the routed command dispatch).
 * The command surface itself lives under `src/cdp/commands/` and is routed by
 * `src/capture.ts` → `src/cdp/dispatch.ts`.
 */

export { CDPClient } from './cdp/client.js';
export type { CDPTarget } from './cdp/types.js';
export { detectCdpPort } from './cdp/detect.js';
export { listTargets, findTab, findTabById, openTab } from './cdp/targets.js';
export { captureScreenshot } from './cdp/screenshot.js';
export type { A11yNode } from './cdp/a11y.js';
export { getAccessibilityTree } from './cdp/a11y.js';
export { executeInBrowser } from './cdp/execute.js';
export type { ExecuteOptions, ExecuteResult } from './cdp/execute.js';
export { navigateAndRecord, navigateAndWait } from './cdp/record.js';
export type { NavigateAndRecordOptions, NavigateAndRecordResult } from './cdp/record.js';
export { HARRecorder } from './cdp/har-recorder.js';
export { ConsoleRecorder } from './cdp/console-recorder.js';
export type { ConsoleEntry } from './cdp/console-recorder.js';
export { acquireTabLock, isTabLocked, releaseTabLock, withTabLock } from './cdp/tab-lock.js';
export { cdpMain } from './cdp/dispatch.js';

// Only run CLI when executed directly (not imported via capture.ts)
const isMainModule =
  process.argv[1]?.endsWith('cdp.ts') ||
  process.argv[1]?.endsWith('cdp.mjs');
if (isMainModule) {
  cdpMain()
    .then(() => {
      // Flush stdout before exiting — process.exit() doesn't wait for stream drain
      if (process.stdout.writableNeedDrain) {
        process.stdout.once('drain', () => process.exit(0));
      } else {
        process.exit(0);
      }
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
