/**
 * CDP (Chrome DevTools Protocol) — the library barrel over the CDP substrate.
 *
 * Re-exports the client, target discovery, screenshot, a11y, console-recording,
 * and tab-lock building blocks, plus `cdpMain` (the routed command dispatch).
 * HAR ownership is NOT exported here: the session HAR manager
 * (`src/har-manager.ts`) fed by the internal streaming recorder
 * (`src/cdp/har-recorder.ts`, a direct import of the recorder bridge) is the
 * sole HAR lane.
 * The command surface itself lives under `src/cdp/commands/` and is routed by
 * `src/capture.ts` → `src/cdp/dispatch.ts`. This module is a pure barrel:
 * `src/capture.ts` is the ONLY entrypoint and the ONLY error/termination
 * boundary — nothing here executes, renders, or exits.
 */

export { CDPClient } from './cdp/client.js';
export type { CDPTarget } from './cdp/types.js';
export { detectCdpPort } from './cdp/detect.js';
export { listTargets, findTab, findTabById, openTab } from './cdp/targets.js';
export { captureScreenshot } from './cdp/screenshot.js';
export type { A11yNode } from './cdp/a11y.js';
export { getAccessibilityTree } from './cdp/a11y.js';
export { navigateAndWait } from './cdp/record.js';
export { ConsoleRecorder } from './cdp/console-recorder.js';
export type { ConsoleEntry } from './cdp/console-recorder.js';
export { acquireTabLock, isTabLocked, releaseTabLock, withTabLock } from './cdp/tab-lock.js';
export { cdpMain } from './cdp/dispatch.js';
