import { CDPClient } from './client.js';
import { nextStepPath } from '../session-context.js';
import { writeBinaryPrivate } from '../session/artifacts.js';

export async function captureScreenshot(
  client: CDPClient,
  viewport?: { width: number; height: number },
  options?: { fullPage?: boolean },
): Promise<Buffer> {
  const MAX_DIM = 1600; // headroom below Anthropic's 2000px many-image limit

  // Apply viewport emulation if requested
  if (viewport) {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    // Let the page re-layout at the new size
    await new Promise((r) => setTimeout(r, 150));
  }

  // For full-page capture, resize viewport to the full content height
  if (options?.fullPage) {
    const layoutMetrics = (await client.send('Page.getLayoutMetrics')) as {
      contentSize?: { width: number; height: number };
      cssVisualViewport?: { clientWidth: number };
    };
    const contentWidth = layoutMetrics.cssVisualViewport?.clientWidth ?? viewport?.width ?? 1280;
    const contentHeight = layoutMetrics.contentSize?.height ?? viewport?.height ?? 800;
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: contentWidth,
      height: Math.ceil(contentHeight),
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise((r) => setTimeout(r, 150));
  }

  let screenshotOpts: Record<string, unknown> = {
    format: 'png',
    captureBeyondViewport: false,
  };

  try {
    const metrics = (await client.send('Page.getLayoutMetrics')) as {
      cssVisualViewport?: { clientWidth: number; clientHeight: number; pageX: number; pageY: number };
    };
    const vw = metrics.cssVisualViewport?.clientWidth ?? 0;
    const vh = metrics.cssVisualViewport?.clientHeight ?? 0;
    const sx = metrics.cssVisualViewport?.pageX ?? 0;
    const sy = metrics.cssVisualViewport?.pageY ?? 0;

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
    // Fallback: capture without downscaling
  }

  const result = (await client.send(
    'Page.captureScreenshot',
    screenshotOpts,
  )) as { data: string };

  // Reset emulation so the browser window isn't stuck at the overridden size
  if (viewport || options?.fullPage) {
    await client.send('Emulation.clearDeviceMetricsOverride');
  }

  return Buffer.from(result.data, 'base64');
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
