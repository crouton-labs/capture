/**
 * `page shot` — capture a PNG of the tab as it is right now (design D2/D10).
 *
 * The navigational look: vision as navigator, never inspector — cheap, no
 * settling, no collectors. With no flags it captures the browser's ACTUAL
 * current viewport and performs zero `Emulation.*` calls; emulation exists
 * only when explicitly asked (`--viewport <WxH>` / `--full-page`), applied
 * as a transient `Emulation.setDeviceMetricsOverride` (+ ~150ms re-layout)
 * and cleared after — two page-observable resizes, declared as the leaf's
 * effect in `-h` (I-1/I-2 posture). Explicit viewport emulation uses the
 * single `WxH` grammar (D10).
 *
 * Destination: `--out <path>` wins; otherwise the active session's `shots/`
 * sequence; sessionless with no `--out` → a fresh `oneshot-{id}/page` dir
 * under the capture root (never a loose /tmp file).
 */
import * as fs from 'fs';
import * as path from 'path';
import { type ParsedArgs } from '../../types.js';
import { withConnection } from '../../connection.js';
import { captureScreenshot } from '../../screenshot.js';
import { parseViewport, type Viewport } from '../../viewport.js';
import { nextStepPath } from '../../../session-context.js';
import { createOneshotSession } from '../../../session/commands.js';
import { assertUnderCaptureRoot, writeBinaryPrivate } from '../../../session/artifacts.js';
import {
  emitResult,
  fact,
  text,
  type FactLine,
  type RenderableResult,
} from '../../../output/render.js';

const USAGE = `capture page shot — capture a PNG of the tab as it is right now

input:
  --viewport <WxH>  transient device-metrics override for this capture; grammar: <positive-safe-int>x<positive-safe-int>, exact lowercase x with no whitespace — preset names are not accepted. Absent → no emulation, the browser's actual current viewport is captured
  --full-page       transient override to the full scrollable content height for this capture
  --out <path>      destination file; default: the active session's shots/ sequence, or a fresh oneshot-*/page/ dir under the capture root when no session is active
  --target <tabId> | --url <pattern> | --port <n>   tab targeting; defaults to the active session tab
  --json            mirror the result as JSON
output:
  <screenshot path=… width=… height=… emulation=none|viewport|full-page> — saved path, PNG pixel dimensions, byte size, and the emulation fact (whether a transient override was applied, or its absence)
effects:
  no flags: none — the capture reads the viewport as-is, with zero Emulation.* calls. With --viewport/--full-page: applies a transient Emulation.setDeviceMetricsOverride (~150ms re-layout wait) and clears it after the capture — two page-observable resizes (resize events fire; media queries flip and flip back)`;

// ---------------------------------------------------------------------------
// Test-injectable dependency seam (the CDP-stub test pattern; the capture
// pipeline itself — captureScreenshot — is NOT injectable, so the tests
// prove the real CDP traffic against a stub client).
// ---------------------------------------------------------------------------

export interface PageShotDeps {
  withConnection: typeof withConnection;
  nextStepPath: typeof nextStepPath;
  createOneshotSession: typeof createOneshotSession;
}

let deps: PageShotDeps = { withConnection, nextStepPath, createOneshotSession };

/** Swap the connection/session seams for the CDP-stub tests. */
export function __setPageShotDepsForTest(overrides: Partial<PageShotDeps>): () => void {
  const previous = deps;
  deps = { ...deps, ...overrides };
  return () => { deps = previous; };
}

// ---------------------------------------------------------------------------
// PNG dimensions — measured from the actual bytes written, not echoed input
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads width/height from the IHDR chunk (always first per the PNG spec).
 * Returns null for anything that is not a parseable PNG. */
export function pngDimensions(png: Buffer): { width: number; height: number } | null {
  if (png.length < 24) return null;
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

// ---------------------------------------------------------------------------
// Destination + private write
// ---------------------------------------------------------------------------

/**
 * Resolves the output path: explicit `--out` > active session's `shots/`
 * sequence > a fresh `oneshot-{id}/page` dir under the capture root.
 */
async function resolveOutPath(parsed: ParsedArgs): Promise<string> {
  if (parsed.out) return parsed.out;
  const sessionPath = await deps.nextStepPath('shot', 'manual');
  if (sessionPath) return sessionPath;
  return path.join(deps.createOneshotSession('page').artifactsDir, 'shot.png');
}

/**
 * Writes the PNG privately (0600 under a 0700 dir) when it lands under
 * CAPTURE_ROOT (auto-generated session/oneshot paths), and with a plain
 * write when the user gave an explicit `--out` outside the capture tree —
 * a user-chosen destination whose permissions are the user's to decide.
 */
function writeScreenshot(outPath: string, png: Buffer): void {
  try {
    assertUnderCaptureRoot(outPath);
  } catch {
    fs.writeFileSync(outPath, png);
    return;
  }
  writeBinaryPrivate(outPath, png);
}

// ---------------------------------------------------------------------------
// Result assembly
// ---------------------------------------------------------------------------

export type EmulationMode = 'none' | 'viewport' | 'full-page';

export function buildScreenshotResult(f: {
  path: string;
  bytes: number;
  dimensions: { width: number; height: number } | null;
  emulation: EmulationMode;
  viewport?: { width: number; height: number };
}): RenderableResult {
  const sections: FactLine[] = [
    f.emulation === 'none'
      ? text`emulation: none — the browser's actual current viewport was captured; no Emulation call was made.`
      : f.emulation === 'viewport'
        ? fact`emulation: transient ${f.viewport!.width}x${f.viewport!.height} device-metrics override applied for the capture and cleared after — two page-observable resizes.`
        : f.viewport
          ? fact`emulation: transient full-page device-metrics override (from ${f.viewport.width}x${f.viewport.height}) applied for the capture and cleared after — two page-observable resizes.`
          : text`emulation: transient full-page device-metrics override applied for the capture and cleared after — two page-observable resizes.`,
  ];
  return {
    tag: 'screenshot',
    attrs: {
      path: f.path,
      width: f.dimensions?.width,
      height: f.dimensions?.height,
      emulation: f.emulation,
    },
    summary: f.dimensions
      ? fact`saved ${f.path} — ${f.dimensions.width}x${f.dimensions.height}px, ${f.bytes} bytes.`
      : fact`saved ${f.path} — ${f.bytes} bytes.`,
    sections,
  };
}

// ---------------------------------------------------------------------------
// page shot
// ---------------------------------------------------------------------------

export async function cmdPageShot(parsed: ParsedArgs, _args: string[]): Promise<void> {
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  if (parsed.positional.length > 0) {
    emitResult(
      {
        tag: 'error',
        attrs: { command: 'page shot', code: 'invalid_input' },
        summary: fact`received: ${parsed.positional.length} positional arguments; expected none — \`capture page shot [--viewport <WxH>] [--full-page] [--out <path>]\`.`,
      },
      { json: parsed.json },
    );
    process.exitCode = 1;
    return;
  }

  let viewport: Viewport | undefined;
  if (parsed.viewport !== undefined) {
    try {
      viewport = parseViewport(parsed.viewport);
    } catch {
      emitResult(
        {
          tag: 'error',
          attrs: { command: 'page shot', code: 'invalid_viewport' },
          summary: fact`received: --viewport ${parsed.viewport}; expected: <positive-safe-int>x<positive-safe-int> with exact lowercase x and no whitespace. Preset names are not accepted.`,
        },
        { json: parsed.json },
      );
      process.exitCode = 1;
      return;
    }
  }

  const emulation: EmulationMode = parsed.fullPage ? 'full-page' : viewport ? 'viewport' : 'none';

  // connection.ts derives the recorder-routed action label from
  // parsed.command, which the router leaves as the branch token 'page' —
  // restore the verb so stderr diagnostics identify this leaf.
  const result = await deps.withConnection(
    { ...parsed, command: 'shot' },
    async (client) => {
      const png = await captureScreenshot(client, viewport, { fullPage: parsed.fullPage });
      const outPath = await resolveOutPath(parsed);
      writeScreenshot(outPath, png);
      return { path: outPath, bytes: png.length, dimensions: pngDimensions(png) };
    },
    { settle: 0 },
  );

  emitResult(buildScreenshotResult({ ...result, emulation, viewport }), { json: parsed.json });
}
