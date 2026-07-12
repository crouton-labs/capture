import { PNG } from 'pngjs';
import { CDPClient } from './client.js';
import { nextStepPath } from '../session-context.js';
import { writeBinaryPrivate } from '../session/artifacts.js';

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

export async function captureScreenshot(
  client: CDPClient,
  viewport?: { width: number; height: number },
  options?: { fullPage?: boolean },
): Promise<Buffer> {
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
      const layoutMetrics = (await client.send('Page.getLayoutMetrics')) as {
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

    try {
      const metrics = (await client.send('Page.getLayoutMetrics')) as {
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
      })) as { result: { value: number } };
      const dpr = dprResult.result.value ?? 1;

      const actualMaxSide = Math.max(vw, vh) * dpr;
      const scale = actualMaxSide > MAX_DIM ? MAX_DIM / actualMaxSide : 1 / dpr;
      screenshotOpts = {
        ...screenshotOpts,
        clip: { x: sx, y: sy, width: vw, height: vh, scale },
      };
    } catch {
      // Capture without downscaling when the optional metrics probe is unavailable.
    }

    const result = (await client.send(
      'Page.captureScreenshot',
      screenshotOpts,
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
      })) as { data?: string };
      png = Buffer.from(retry.data ?? '', 'base64');
      if (png.length > 0) png = downscalePngToFit(png, MAX_DIM);
    }

    // If the browser rejects clipped capture entirely, an unclipped viewport
    // capture is still better than a false successful 0-byte artifact.
    if (png.length === 0 && screenshotOpts.clip && !options?.fullPage) {
      const retry = (await client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      })) as { data?: string };
      png = Buffer.from(retry.data ?? '', 'base64');
      if (png.length > 0) png = downscalePngToFit(png, MAX_DIM);
    }

    if (png.length === 0) {
      throw new Error(
        'Page.captureScreenshot returned no image data (the tab may not be rendering); refusing to write a 0-byte PNG',
      );
    }

    return png;
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
  const shotPath = nextStepPath(action, label);
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
