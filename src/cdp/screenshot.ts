import { PNG } from 'pngjs';
import { CDPClient } from './client.js';
import { nextStepPath } from '../session-context.js';
import { writeBinaryPrivate } from '../session/artifacts.js';
import { withScopeSerialization } from './scope-lock.js';

/**
 * The CSS-pixel rectangle a captured PNG covers: its page-coordinate origin and
 * its size. `image px / width` (and `/ height`) is the capture's true CSS-to-
 * image scale, and `x`/`y` turn a page coordinate into an image coordinate.
 */
export interface CapturedRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A CSS-pixel crop request. The capture is intersected with the live visual viewport before it reaches CDP. */
export interface ScreenshotCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type ScreenshotOptions = { fullPage?: boolean; crop?: ScreenshotCrop; zoom?: number };

/** A region is reportable only if every number is finite and its size is positive; anything else would produce a fabricated scale. */
function validRegion(region: CapturedRegion): CapturedRegion | undefined {
  const finite = [region.x, region.y, region.width, region.height].every((n) => typeof n === 'number' && Number.isFinite(n));
  if (!finite || region.width <= 0 || region.height <= 0) return undefined;
  return region;
}

/** Intersects page-coordinate CSS regions without rounding their geometry. */
function intersectRegions(a: CapturedRegion, b: CapturedRegion): CapturedRegion | undefined {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return validRegion({ x, y, width: right - x, height: bottom - y });
}

/**
 * Downscales a PNG so its longest side fits within maxDim, using a box
 * filter. Used when a clipped/scaled CDP capture is unavailable and the raw
 * capture exceeds the dimension budget.
 */
function downscalePngToFit(png: Buffer, maxDim: number): Buffer {
  const src = PNG.sync.read(png);
  const maxSide = Math.max(src.width, src.height);
  if (maxSide <= maxDim) return png;
  const ratio = maxDim / maxSide;
  const dstW = Math.max(1, Math.round(src.width * ratio));
  const dstH = Math.max(1, Math.round(src.height * ratio));
  const dst = new PNG({ width: dstW, height: dstH });
  for (let y = 0; y < dstH; y++) {
    const sy0 = Math.floor((y * src.height) / dstH);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * src.height) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx0 = Math.floor((x * src.width) / dstW);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * src.width) / dstW));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1 && sy < src.height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < src.width; sx++) {
          const i = (sy * src.width + sx) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          a += src.data[i + 3];
          n++;
        }
      }
      const j = (y * dstW + x) * 4;
      dst.data[j] = Math.round(r / n);
      dst.data[j + 1] = Math.round(g / n);
      dst.data[j + 2] = Math.round(b / n);
      dst.data[j + 3] = Math.round(a / n);
    }
  }
  return PNG.sync.write(dst);
}

/**
 * Captures one screenshot, applying (and always clearing) a device-metrics
 * override when a viewport or full-page capture is requested. The override
 * is target-visible state driven over the connection: a direct connection's
 * override dies with its own websocket session, but the recorder-held
 * connection is shared across commands, so the entire
 * setDeviceMetricsOverride→capture→clear scope serializes under the owning
 * session's `.viewport-scope.lock` (`withScopeSerialization`) when the
 * client is the recorder-held adapter — otherwise a concurrent routed
 * caller could clear this capture's live override mid-scope (or capture
 * inside someone else's).
 */
export async function captureScreenshot(
  client: CDPClient,
  viewport?: { width: number; height: number },
  options?: ScreenshotOptions,
): Promise<Buffer> {
  const result = await withScopeSerialization(client, 'viewport', 'screenshot capture', () =>
    viewportScopedCapture(client, viewport, options),
  );
  return result.png;
}

/**
 * Captures a PNG and the CSS-pixel region the image actually covers — the clip
 * sent to `Page.captureScreenshot` (or, for an unclipped capture, the visual
 * viewport). Dividing the PNG's pixel dimensions by that region's size is the
 * true CSS-to-image scale; the layout viewport (`window.innerWidth`) is a
 * different coordinate space under page zoom and must not stand in for it.
 */
export async function captureScreenshotWithCssViewport(
  client: CDPClient,
  viewport?: { width: number; height: number },
  options?: ScreenshotOptions,
): Promise<{ png: Buffer; cssViewport?: CapturedRegion }> {
  return withScopeSerialization(client, 'viewport', 'screenshot capture', () =>
    viewportScopedCapture(client, viewport, options, true),
  );
}

/**
 * The one viewport/capture state transaction: override (when requested) →
 * capture → clear. Restoration ownership is claimed BEFORE the override is
 * awaited (a lost response does not prove Chrome rejected it); a clear
 * failure prevents success — alone it throws, paired with a primary failure
 * it throws an `AggregateError` preserving both facts.
 */
async function viewportScopedCapture(
  client: CDPClient,
  viewport?: { width: number; height: number },
  options?: ScreenshotOptions,
  includeCssViewport = false,
): Promise<{ png: Buffer; cssViewport?: CapturedRegion }> {
  const MAX_DIM = 1600; // headroom below Anthropic's 2000px many-image limit
  let ownsDeviceMetricsOverride = false;
  let primaryFailed = false;
  let primaryError: unknown;

  try {
    if (viewport) {
      // A rejected response does not prove that Chrome rejected the request.
      // Claim cleanup responsibility before awaiting every override request.
      ownsDeviceMetricsOverride = true;
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    if (options?.fullPage) {
      const layoutMetrics = (await client.send('Page.getLayoutMetrics', {}, 5000)) as {
        contentSize?: { width: number; height: number };
        cssVisualViewport?: { clientWidth: number };
      };
      const contentWidth = layoutMetrics.cssVisualViewport?.clientWidth ?? viewport?.width ?? 1280;
      const contentHeight = layoutMetrics.contentSize?.height ?? viewport?.height ?? 800;
      ownsDeviceMetricsOverride = true;
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: contentWidth,
        height: Math.ceil(contentHeight),
        deviceScaleFactor: 1,
        mobile: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    let screenshotOpts: Record<string, unknown> = {
      format: 'png',
      captureBeyondViewport: false,
    };

    // The CSS-pixel region the returned image covers, set from the clip that is
    // actually sent. An unclipped capture clears it again and it is read from the
    // live visual viewport below instead.
    let capturedRegion: CapturedRegion | undefined;

    try {
      const metrics = (await client.send('Page.getLayoutMetrics', {}, 5000)) as {
        cssVisualViewport?: { clientWidth: number; clientHeight: number; pageX: number; pageY: number };
      };
      // Snap the clip to integer CSS pixels: browser zoom (e.g. 110%) makes the
      // CSS viewport fractional, and some Chromium-based browsers (Arc, at
      // least) answer a clipped Page.captureScreenshot whose output dimensions
      // are fractional with a SUCCESSFUL response carrying empty `data`.
      const vw = Math.round(metrics.cssVisualViewport?.clientWidth ?? 0);
      const vh = Math.round(metrics.cssVisualViewport?.clientHeight ?? 0);
      const sx = Math.floor(metrics.cssVisualViewport?.pageX ?? 0);
      const sy = Math.floor(metrics.cssVisualViewport?.pageY ?? 0);

      const dprResult = (await client.send('Runtime.evaluate', {
        expression: 'window.devicePixelRatio',
        returnByValue: true,
      }, 5000)) as { result: { value: number } };
      const dpr = dprResult.result.value ?? 1;

      const visualViewport = validRegion({ x: sx, y: sy, width: vw, height: vh });
      const requestedCrop = options?.crop;
      const crop = requestedCrop && visualViewport
        ? intersectRegions(requestedCrop, visualViewport)
        : visualViewport;
      if (!crop) {
        throw new Error('The requested CSS crop does not intersect the live visual viewport.');
      }
      const zoom = options?.zoom ?? 1;
      const actualMaxSide = Math.max(crop.width, crop.height) * dpr * zoom;
      const scale = actualMaxSide > MAX_DIM ? MAX_DIM / (Math.max(crop.width, crop.height) * dpr) : zoom / dpr;
      screenshotOpts = {
        ...screenshotOpts,
        clip: { x: crop.x, y: crop.y, width: crop.width, height: crop.height, scale },
      };
      // The clip is what the image is cut from, including a CSS crop's
      // viewport intersection — not the fractional viewport it was derived from.
      capturedRegion = crop;
    } catch (error) {
      // A crop without CSS viewport metrics cannot be located honestly; unlike
      // an ordinary full-viewport shot, it must not silently become an
      // unrelated uncropped image.
      if (options?.crop) throw error;
      // Capture without downscaling when the optional metrics probe is unavailable.
    }

    const result = (await client.send(
      'Page.captureScreenshot',
      screenshotOpts,
      15000,
    )) as { data?: string };
    let png = Buffer.from(result.data ?? '', 'base64');

    // A fractional scale (1/devicePixelRatio) can still produce fractional
    // output dimensions, which the browsers above answer with empty data.
    // Retry the same integer clip at scale 1, preserving full-page captures,
    // then enforce the dimension budget locally.
    if (png.length === 0 && screenshotOpts.clip) {
      const clip = screenshotOpts.clip as Record<string, unknown>;
      const retry = (await client.send('Page.captureScreenshot', {
        ...screenshotOpts,
        clip: { ...clip, scale: 1 },
      }, 15000)) as { data?: string };
      png = Buffer.from(retry.data ?? '', 'base64');
      if (png.length > 0) png = downscalePngToFit(png, MAX_DIM);
    }

    // If the browser rejects clipped capture entirely, an unclipped viewport
    // capture is still better than a false successful 0-byte artifact.
    if (png.length === 0 && screenshotOpts.clip && !options?.fullPage && !options?.crop) {
      const retry = (await client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      }, 15000)) as { data?: string };
      png = Buffer.from(retry.data ?? '', 'base64');
      if (png.length > 0) png = downscalePngToFit(png, MAX_DIM);
      // An unclipped capture covers the visual viewport itself, not the integer
      // clip that was refused — and the two failed attempts above can have taken
      // 30 seconds, so the viewport sampled before them is no longer evidence.
      if (png.length > 0) capturedRegion = undefined;
    }

    // The image was captured unclipped (no clip was ever sent, or the clipped
    // attempts were refused), so it covers the visual viewport. Read it as it
    // stands now rather than reporting the layout viewport, which is a different
    // space under page zoom, or a sample taken before a failed attempt.
    if (includeCssViewport && !capturedRegion) {
      try {
        const response = (await client.send('Runtime.evaluate', {
          expression: '(() => { const v = window.visualViewport; return v ? { x: v.pageLeft, y: v.pageTop, width: v.width, height: v.height } : null; })()',
          returnByValue: true,
        }, 5000)) as { result?: { value?: Record<string, unknown> | null } };
        const value = response.result?.value;
        if (value) {
          capturedRegion = validRegion({
            x: Number(value.x),
            y: Number(value.y),
            width: Number(value.width),
            height: Number(value.height),
          });
        }
      } catch {
        // The image remains usable; only its CSS-coordinate mapping is unavailable.
      }
    }

    if (png.length === 0) {
      throw new Error(
        'Page.captureScreenshot returned no image data (the tab may not be rendering); refusing to write a 0-byte PNG',
      );
    }

    return { png, ...(includeCssViewport && capturedRegion ? { cssViewport: capturedRegion } : {}) };
  } catch (error) {
    primaryFailed = true;
    primaryError = error;
    throw error;
  } finally {
    if (ownsDeviceMetricsOverride) {
      try {
        await client.send('Emulation.clearDeviceMetricsOverride');
      } catch (cleanupError) {
        if (primaryFailed) {
          throw new AggregateError(
            [primaryError, cleanupError],
            'Screenshot capture failed and device-metrics cleanup also failed.',
            { cause: primaryError },
          );
        }
        throw cleanupError;
      }
    }
  }
}

export async function autoScreenshot(
  client: CDPClient,
  action: string,
  label: string,
  noScreenshot?: boolean,
): Promise<string | null> {
  if (noScreenshot) return null;
  const shotPath = await nextStepPath(action, label);
  if (!shotPath) return null;

  // Brief settle for UI to update
  await new Promise((r) => setTimeout(r, 300));
  const png = await captureScreenshot(client);
  // Shot path always resolves under the session dir (CAPTURE_ROOT); the
  // private writer creates the file 0600 and re-ensures shots/ is 0700.
  writeBinaryPrivate(shotPath, png);
  console.error(`  [screenshot] ${shotPath}`);
  return shotPath;
}
