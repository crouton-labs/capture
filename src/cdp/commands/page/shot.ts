/**
 * `page shot` — capture a PNG of the tab as it is right now (design D2/D10).
 *
 * The navigational look: vision as navigator, never inspector — cheap, no
 * settling, no collectors. With no flags it captures the browser's ACTUAL
 * current viewport and performs zero `Emulation.*` calls; emulation exists
 * only when explicitly asked (`--viewport <WxH>` / `--full-page` /
 * `--color-scheme dark|light`), applied transiently; viewport emulation uses
 * `Emulation.setDeviceMetricsOverride` (+ ~150ms re-layout)
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
import { type CDPClient } from '../../client.js';
import { captureScreenshotWithCssViewport, type CapturedRegion, type ScreenshotCrop } from '../../screenshot.js';
import { parseViewport, type Viewport } from '../../viewport.js';
import { parseColorScheme, withAppliedColorScheme, type ColorScheme } from '../../color-scheme.js';
import { nextStepPath } from '../../../session-context.js';
import { createOneshotSession } from '../../../session/commands.js';
import { resolveLiveTarget, type LiveClient, type ResolutionFailure } from '../../../interact.js';
import { emitResolutionError } from './click.js';
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
  --color-scheme <dark|light>  transient prefers-color-scheme override for this capture; cleared afterward
  --crop <x,y,w,h>  capture this page-coordinate CSS-pixel rect, intersected with the live visual viewport; x/y may be fractional, w/h must be positive
  --crop-selector <sel>  resolve exactly one live target (bare CSS takes precedence; exact accessible name applies when CSS finds none; ax:<name>, axid:<id>, or backend:<id>), scroll it into view, then crop its border box and surroundings
  --pad <px>        nonnegative integer CSS pixels added on every side of --crop-selector (default: 0; not accepted with --crop)
  --zoom <factor>   positive decimal CSS-to-image scale requested for a CSS crop; the 1600px image cap may produce a smaller reported scale
  --out <path>      destination file; default: the active session's shots/ sequence, or a fresh oneshot-*/page/ dir under the capture root when no session is active
  --target <tabId> | --url <pattern> | --port <n>   tab targeting; defaults to the active session tab
  --json            mirror the result as JSON
output:
  <screenshot path=… width=… height=… css-width=… css-height=… css-x=… css-y=… css-to-image-x=… css-to-image-y=… effective-downscale-x=… effective-downscale-y=… emulation=none|viewport|full-page color-scheme=dark|light> — saved path, PNG pixel dimensions, the CSS-pixel region the image covers (its page-coordinate origin and size) with the CSS-to-image scale derived from it, any effective downscale below 1 image px/CSS px, byte size, crop provenance, and any requested transient emulation
effects:
  no flags: none — the capture reads the viewport as-is, with zero Emulation.* calls. --viewport/--full-page applies a transient Emulation.setDeviceMetricsOverride (~150ms re-layout wait) and clears it after the capture — two page-observable resizes. --color-scheme applies a transient Emulation.setEmulatedMedia prefers-color-scheme override and clears it after the capture. --crop-selector scrolls its resolved target into view. CSS crops are intersected with the source visual viewport; an empty intersection fails without writing an image. --crop/--crop-selector cannot be combined with --full-page.`;

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

interface CropProvenance {
  readonly source: 'coordinates' | 'selector';
  readonly requested: ScreenshotCrop;
  readonly selector?: string;
  readonly backendNodeId?: number;
  readonly pad?: number;
  readonly zoom: number;
}

/** Renders a CSS-pixel measurement without inventing precision: an integer stays an integer, a fractional zoomed viewport keeps six decimals. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function buildScreenshotResult(f: {
  path: string;
  bytes: number;
  dimensions: { width: number; height: number } | null;
  cssViewport?: CapturedRegion;
  emulation: EmulationMode;
  viewport?: { width: number; height: number };
  colorScheme?: ColorScheme;
  crop?: CropProvenance;
}): RenderableResult {
  // The denominator is the CSS region the image was actually cut from, so the
  // ratio stays true under page zoom, device pixel ratio, and the local
  // downscale — the layout viewport is a different space and is never used here.
  const scale = f.dimensions && f.cssViewport
    ? { x: f.dimensions.width / f.cssViewport.width, y: f.dimensions.height / f.cssViewport.height }
    : undefined;
  const downscale = scale && (scale.x < 1 || scale.y < 1)
    ? { x: scale.x < 1 ? scale.x : undefined, y: scale.y < 1 ? scale.y : undefined }
    : undefined;
  const downscaleDescription = downscale
    ? [
      downscale.x === undefined ? undefined : `horizontal ${downscale.x.toFixed(6)}×`,
      downscale.y === undefined ? undefined : `vertical ${downscale.y.toFixed(6)}×`,
    ].filter((axis): axis is string => axis !== undefined).join(' and ')
    : undefined;
  const sections: FactLine[] = [
    scale && f.cssViewport
      ? fact`CSS-to-image scale: ${scale.x.toFixed(6)} image px/CSS px horizontally and ${scale.y.toFixed(6)} image px/CSS px vertically (captured CSS region ${round6(f.cssViewport.width)}×${round6(f.cssViewport.height)} at page origin ${round6(f.cssViewport.x)},${round6(f.cssViewport.y)}).`
      : text`CSS-to-image scale unavailable: the browser did not return the CSS region this capture covers.`,
    f.crop
      ? fact`CSS crop: ${f.crop.source === 'selector' ? `selector ${f.crop.selector} (backend:${f.crop.backendNodeId}), border box plus ${f.crop.pad}px padding` : 'coordinates'} requested ${formatRect(f.crop.requested)} at zoom ${f.crop.zoom}; the captured CSS region above is its intersection with the source visual viewport.`
      : text`CSS crop: none — the captured CSS region above is the source visual viewport.`,
    f.emulation === 'none'
      ? text`viewport emulation: none — the browser's actual current viewport was captured.`
      : f.emulation === 'viewport'
        ? fact`emulation: transient ${f.viewport!.width}x${f.viewport!.height} device-metrics override applied for the capture and cleared after — two page-observable resizes.`
        : f.viewport
          ? fact`emulation: transient full-page device-metrics override (from ${f.viewport.width}x${f.viewport.height}) applied for the capture and cleared after — two page-observable resizes.`
          : text`emulation: transient full-page device-metrics override applied for the capture and cleared after — two page-observable resizes.`,
    f.colorScheme
      ? fact`color scheme: transient prefers-color-scheme=${f.colorScheme} override applied for the capture and cleared after.`
      : text`color scheme: browser default — no Emulation.setEmulatedMedia call was made.`,
  ];
  return {
    tag: 'screenshot',
    attrs: {
      path: f.path,
      width: f.dimensions?.width,
      height: f.dimensions?.height,
      'css-width': f.cssViewport === undefined ? undefined : round6(f.cssViewport.width),
      'css-height': f.cssViewport === undefined ? undefined : round6(f.cssViewport.height),
      'css-x': f.cssViewport === undefined ? undefined : round6(f.cssViewport.x),
      'css-y': f.cssViewport === undefined ? undefined : round6(f.cssViewport.y),
      'css-to-image-x': scale?.x.toFixed(6),
      'css-to-image-y': scale?.y.toFixed(6),
      'effective-downscale-x': downscale?.x?.toFixed(6),
      'effective-downscale-y': downscale?.y?.toFixed(6),
      emulation: f.emulation,
      'color-scheme': f.colorScheme,
      'crop-source': f.crop?.source,
      'crop-selector': f.crop?.selector,
      'crop-backend-node-id': f.crop?.backendNodeId,
      'requested-zoom': f.crop?.zoom,
    },
    summary: f.dimensions
      ? downscaleDescription
        ? fact`saved ${f.path} — ${f.dimensions.width}x${f.dimensions.height}px, ${f.bytes} bytes; effective downscale: ${downscaleDescription} (image px/CSS px).`
        : fact`saved ${f.path} — ${f.dimensions.width}x${f.dimensions.height}px, ${f.bytes} bytes.`
      : fact`saved ${f.path} — ${f.bytes} bytes.`,
    sections,
  };
}

function formatRect(rect: ScreenshotCrop): string {
  return `x=${round6(rect.x)} y=${round6(rect.y)} w=${round6(rect.width)} h=${round6(rect.height)}`;
}

function parseCrop(value: string): ScreenshotCrop | undefined {
  const match = /^(-?(?:\d+\.?\d*|\.\d+)),(-?(?:\d+\.?\d*|\.\d+)),(\d+(?:\.\d*)?|\.\d+),(\d+(?:\.\d*)?|\.\d+)$/.exec(value);
  if (!match) return undefined;
  const [x, y, width, height] = match.slice(1).map(Number);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function parseZoom(value: string): number | undefined {
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value)) return undefined;
  const zoom = Number(value);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : undefined;
}

function borderRect(model: unknown): ScreenshotCrop | undefined {
  const border = (model as { border?: unknown } | undefined)?.border;
  if (!Array.isArray(border) || border.length !== 8 || !border.every((point) => typeof point === 'number' && Number.isFinite(point))) return undefined;
  const xs = [border[0], border[2], border[4], border[6]] as number[];
  const ys = [border[1], border[3], border[5], border[7]] as number[];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function padded(rect: ScreenshotCrop, pad: number): ScreenshotCrop {
  return { x: rect.x - pad, y: rect.y - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad };
}

async function pageBorderRect(client: CDPClient, backendNodeId: number): Promise<ScreenshotCrop | undefined> {
  const box = (await client.send('DOM.getBoxModel', { backendNodeId })) as { model?: unknown };
  const rect = borderRect(box.model);
  if (!rect) return undefined;

  // DOM box-model quads are relative to the live viewport. Screenshot clips
  // use page coordinates, so account for the scroll DOM.scrollIntoViewIfNeeded
  // just performed for a selector crop.
  const metrics = (await client.send('Page.getLayoutMetrics')) as {
    cssVisualViewport?: { pageX?: unknown; pageY?: unknown };
  };
  const pageX = metrics.cssVisualViewport?.pageX;
  const pageY = metrics.cssVisualViewport?.pageY;
  if (typeof pageX !== 'number' || !Number.isFinite(pageX) || typeof pageY !== 'number' || !Number.isFinite(pageY)) {
    throw new Error('Page.getLayoutMetrics returned no valid visual-viewport page origin for --crop-selector.');
  }
  return { ...rect, x: rect.x + pageX, y: rect.y + pageY };
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
        summary: fact`received: ${parsed.positional.length} positional arguments; expected none — \`capture page shot [--viewport <WxH>] [--full-page] [--color-scheme <dark|light>] [--crop <x,y,w,h> | --crop-selector <sel> [--pad <px>]] [--zoom <factor>] [--out <path>]\`.`,
      },
      { json: parsed.json },
    );
    process.exitCode = 1;
    return;
  }

  const crop = parsed.crop === undefined ? undefined : parseCrop(parsed.crop);
  if (parsed.crop !== undefined && !crop) {
    emitResult({ tag: 'error', attrs: { command: 'page shot', code: 'invalid_crop' }, summary: fact`received: --crop ${parsed.crop}; expected x,y,w,h as finite CSS pixels without whitespace, with positive w and h.` }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }
  if (parsed.crop !== undefined && parsed.cropSelector !== undefined) {
    emitResult({ tag: 'error', attrs: { command: 'page shot', code: 'conflicting_crop' }, summary: text`--crop and --crop-selector cannot be combined; choose coordinates or one live target.` }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }
  if (parsed.cropSelector !== undefined && !parsed.cropSelector.trim()) {
    emitResult({ tag: 'error', attrs: { command: 'page shot', code: 'invalid_crop_selector' }, summary: text`received an empty --crop-selector; expected a bare CSS selector or exact accessible name, ax:<name>, axid:<id>, or backend:<id>.` }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }
  if (parsed.pad !== undefined && parsed.cropSelector === undefined) {
    emitResult({ tag: 'error', attrs: { command: 'page shot', code: 'pad_requires_crop_selector' }, summary: text`--pad applies only to --crop-selector.` }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }
  const zoom = parsed.zoom === undefined ? 1 : parseZoom(parsed.zoom);
  if (!zoom) {
    emitResult({ tag: 'error', attrs: { command: 'page shot', code: 'invalid_zoom' }, summary: fact`received: --zoom ${parsed.zoom}; expected a positive decimal factor.` }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }
  if (parsed.zoom !== undefined && !crop && parsed.cropSelector === undefined) {
    emitResult({ tag: 'error', attrs: { command: 'page shot', code: 'zoom_requires_crop' }, summary: text`--zoom requires --crop or --crop-selector.` }, { json: parsed.json });
    process.exitCode = 1;
    return;
  }
  if (parsed.fullPage && (crop || parsed.cropSelector !== undefined)) {
    emitResult({ tag: 'error', attrs: { command: 'page shot', code: 'crop_conflicts_with_full_page' }, summary: text`--crop and --crop-selector capture from the visual viewport and cannot be combined with --full-page.` }, { json: parsed.json });
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

  let colorScheme: ColorScheme | undefined;
  try {
    colorScheme = parseColorScheme(parsed.colorScheme);
  } catch {
    emitResult(
      {
        tag: 'error',
        attrs: { command: 'page shot', code: 'invalid_color_scheme' },
        summary: fact`received: --color-scheme ${parsed.colorScheme}; expected dark or light.`,
      },
      { json: parsed.json },
    );
    process.exitCode = 1;
    return;
  }

  const emulation: EmulationMode = parsed.fullPage ? 'full-page' : viewport ? 'viewport' : 'none';

  // connection.ts derives the recorder-routed action label from
  // parsed.command, which the router leaves as the branch token 'page' —
  // restore the verb so stderr diagnostics identify this leaf.
  const result = await deps.withConnection(
    { ...parsed, command: 'shot' },
    async (client) => withAppliedColorScheme(client, colorScheme, async () => {
      let cropProvenance: CropProvenance | undefined;
      let requestedCrop = crop;
      if (parsed.cropSelector !== undefined) {
        const resolved = await resolveLiveTarget(client as unknown as LiveClient, parsed.cropSelector);
        if (!resolved.ok) return { failure: resolved } as const;
        await client.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: resolved.backendNodeId });
        const rect = await pageBorderRect(client, resolved.backendNodeId);
        if (!rect) throw new Error(`Resolved target backend:${resolved.backendNodeId} has no measurable border box for --crop-selector.`);
        const pad = parsed.pad ?? 0;
        requestedCrop = padded(rect, pad);
        cropProvenance = { source: 'selector', requested: requestedCrop, selector: parsed.cropSelector, backendNodeId: resolved.backendNodeId, pad, zoom };
      } else if (requestedCrop) {
        cropProvenance = { source: 'coordinates', requested: requestedCrop, zoom };
      }
      const screenshot = await captureScreenshotWithCssViewport(client, viewport, { fullPage: parsed.fullPage, crop: requestedCrop, zoom });
      const outPath = await resolveOutPath(parsed);
      writeScreenshot(outPath, screenshot.png);
      return { path: outPath, bytes: screenshot.png.length, dimensions: pngDimensions(screenshot.png), cssViewport: screenshot.cssViewport, crop: cropProvenance } as const;
    }),
    { settle: 0 },
  );

  if ('failure' in result) {
    emitResolutionError(parsed, 'page shot', result.failure as ResolutionFailure);
    return;
  }
  emitResult(buildScreenshotResult({ ...result, emulation, viewport, colorScheme }), { json: parsed.json });
}
