#!/usr/bin/env tsx
/**
 * CDP (Chrome DevTools Protocol) — browser automation via exec-first design.
 *
 * The agent writes arbitrary JS and passes it to `exec`. No training-wheel
 * commands for click/type/wait — the agent composes whatever it needs.
 *
 * Commands:
 *   capture exec <code>         Execute JS in a tab (the primary interface)
 *   capture exec --file <path>  Execute JS from file
 *   capture detect              Detect CDP port
 *   capture list                List all browser tabs
 *   capture open <url>          Open URL in browser (returns tab ID)
 *   capture reset-tab <url>    Abandon stuck tab, open fresh one
 *   capture screenshot          Capture screenshot
 *   capture a11y                Get accessibility tree
 *   capture record              Passive HAR recording
 *   capture navigate <url>      Navigate + record HAR
 *   capture har create|read|delete  Manage HAR recordings
 *
 * Options:
 *   --port <port>       Override CDP port (auto-detects if not specified)
 *   --target <tabId>    Target tab by exact ID (preferred, parallel-safe)
 *   --new               Force open a new tab (open command)
 *   --record            Enable HAR recording (exec)
 *   --har <id>          Append traffic to a HAR recording
 *   --har-out <path>    HAR output path
 *   --file <path>       Read JS from file (exec)
 *   --duration <secs>   Recording duration (record, default: 10)
 *   --settle <ms>       Settle time after navigation (navigate, default: 2000)
 *   --out <path>        Output path (screenshot)
 *   --height <px>       Override viewport height (screenshot)
 *   --full-page         Capture entire scrollable page (screenshot)
 *   --json              JSON output (a11y)
 *   --interactive       Interactive elements only (a11y)
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
export { recordTraffic, navigateAndRecord, navigateAndWait } from './cdp/record.js';
export type { RecordOptions, RecordResult, NavigateAndRecordOptions, NavigateAndRecordResult } from './cdp/record.js';
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
