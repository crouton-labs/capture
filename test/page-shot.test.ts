import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PNG } from 'pngjs';

// U07: `page shot` — the navigational look (design D2/D10).
//
// Follows the repo's CDP-stub pattern (page-input-verbs.test.ts): a fake
// client answers exactly the CDP calls the REAL captureScreenshot pipeline
// makes, and the call log proves the emulation behavior — a plain shot
// performs zero Emulation.* calls; --viewport/--full-page apply a transient
// override and clear it after the capture. The connection/session seams are
// injected via `__setPageShotDepsForTest`; the capture pipeline itself is
// not injectable, so these are the real CDP frames.

import {
  cmdPageShot,
  __setPageShotDepsForTest,
  buildScreenshotResult,
  pngDimensions,
} from '../src/cdp/commands/page/shot.js';
import { captureScreenshot } from '../src/cdp/screenshot.js';
import { createOneshotSession } from '../src/session/commands.js';
import { CAPTURE_ROOT } from '../src/session/artifacts.js';
import type { ParsedArgs, CDPTarget } from '../src/cdp/types.js';
import { renderResult } from '../src/output/render.js';

interface RecordedCall {
  method: string;
  params: Record<string, unknown>;
}

type Handlers = Record<string, (params: Record<string, unknown>) => unknown>;

function stubClient(handlers: Handlers) {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected CDP call in test stub: ${method}`);
      return handler(params);
    },
  };
}

/** Minimal structurally-valid PNG: signature + IHDR carrying real
 * dimensions — what pngDimensions (and any PNG reader) sees first. */
function makePng(width: number, height: number): Buffer {
  const png = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
  png.writeUInt32BE(13, 8); // IHDR length
  png.write('IHDR', 12);
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png.writeUInt8(8, 24); // bit depth
  png.writeUInt8(6, 25); // color type RGBA
  return png;
}

/** The CDP surface the real captureScreenshot drives for a plain (no
 * emulation) capture. Emulation handlers are added only by the tests that
 * expect them — any other method throws, which is itself the proof. */
function captureHandlers(png: Buffer, opts: { emulation?: boolean; media?: boolean; contentHeight?: number; pageX?: number; pageY?: number } = {}): Handlers {
  const handlers: Handlers = {
    'Page.getLayoutMetrics': () => ({
      contentSize: { width: 1280, height: opts.contentHeight ?? 800 },
      cssVisualViewport: { clientWidth: 1280, clientHeight: 800, pageX: opts.pageX ?? 0, pageY: opts.pageY ?? 0 },
    }),
    'Runtime.evaluate': (params) => String(params.expression ?? '').includes('window.innerWidth')
      ? ({ result: { value: { width: 1280, height: 800 } } })
      : ({ result: { value: 1 } }),
    'Page.captureScreenshot': () => ({ data: png.toString('base64') }),
  };
  if (opts.emulation) {
    handlers['Emulation.setDeviceMetricsOverride'] = () => ({});
    handlers['Emulation.clearDeviceMetricsOverride'] = () => ({});
  }
  if (opts.media) handlers['Emulation.setEmulatedMedia'] = () => ({});
  return handlers;
}

interface ScriptedStep {
  readonly method: string;
  readonly result?: unknown;
  readonly error?: unknown;
}

/** A client held for one screenshot call, with every awaited CDP response
 * released in an exact scripted order. */
function scriptedHeldClient(steps: readonly ScriptedStep[]) {
  let cursor = 0;
  const calls: string[] = [];
  return {
    calls,
    get remaining() { return steps.length - cursor; },
    async send(method: string): Promise<unknown> {
      calls.push(method);
      const step = steps[cursor++];
      assert.ok(step, `unexpected CDP call: ${method}`);
      assert.equal(method, step.method, `CDP call ${cursor} must follow the scripted order`);
      if ('error' in step) throw step.error;
      return step.result ?? {};
    },
  };
}

const FAKE_TAB: CDPTarget = { id: 'tab-1', title: '', url: 'https://fixture.test/', type: 'page' };

interface InstalledDeps {
  settleSeen: number | undefined;
  commandSeen: string | undefined;
  connectionOpened: boolean;
  oneshotDirs: string[];
  restore: () => void;
}

/**
 * Injects the connection/session seams around a stub client. By default
 * there is no active session (nextStepPath → null) and the REAL
 * createOneshotSession runs (its dirs are recorded for cleanup); a
 * `sessionShotPath` simulates an active session's shots/ sequence.
 */
function installDeps(
  client: { send: (m: string, p?: Record<string, unknown>) => Promise<unknown> },
  opts: { sessionShotPath?: string | null } = {},
): InstalledDeps {
  const state: InstalledDeps = {
    settleSeen: undefined,
    commandSeen: undefined,
    connectionOpened: false,
    oneshotDirs: [],
    restore: () => {},
  };
  state.restore = __setPageShotDepsForTest({
    withConnection: (async (
      parsed: ParsedArgs,
      fn: (c: unknown, t: CDPTarget) => Promise<unknown>,
      o?: { settle?: number },
    ) => {
      state.connectionOpened = true;
      state.settleSeen = o?.settle;
      state.commandSeen = parsed.command;
      return fn(client, FAKE_TAB);
    }) as never,
    nextStepPath: () => opts.sessionShotPath ?? null,
    createOneshotSession: ((kind: 'measure' | 'motion' | 'page') => {
      const oneshot = createOneshotSession(kind);
      state.oneshotDirs.push(oneshot.dir);
      return oneshot;
    }) as never,
  });
  return state;
}

function cleanup(state: InstalledDeps): void {
  state.restore();
  for (const dir of state.oneshotDirs) fs.rmSync(dir, { recursive: true, force: true });
}

async function runCmd(fn: () => Promise<void>): Promise<{ stdout: string; exitCode: number | undefined }> {
  const origWrite = process.stdout.write.bind(process.stdout);
  const origLog = console.log;
  const origExit = process.exitCode;
  process.exitCode = undefined;
  let out = '';
  // TEE rather than swallow: the test reporter's own events flush
  // asynchronously and can land inside this window — swallowing them makes
  // the runner silently lose earlier tests from its stream.
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    out += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  console.log = (value?: unknown) => {
    out += `${String(value ?? '')}\n`;
  };
  try {
    await fn();
    return { stdout: out, exitCode: process.exitCode as number | undefined };
  } finally {
    process.stdout.write = origWrite;
    console.log = origLog;
    process.exitCode = origExit;
  }
}

function parsedFor(flags: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command: 'page', positional: [], ...flags } as ParsedArgs;
}

// ---------------------------------------------------------------------------
// No flags: zero Emulation.* calls — the actual current viewport
// ---------------------------------------------------------------------------

test('plain page shot performs zero Emulation.* calls and reports the no-emulation fact', async () => {
  const outPath = path.join(os.tmpdir(), `u07-plain-${process.pid}.png`);
  const client = stubClient(captureHandlers(makePng(1280, 800)));
  const state = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageShot(parsedFor({ out: outPath }), []));
    assert.equal(exitCode, undefined);

    // The stub throws on any unhandled method, and the call log holds not a
    // single Emulation.* frame — the default capture is override-free.
    const emulationCalls = client.calls.filter((c) => c.method.startsWith('Emulation.'));
    assert.deepEqual(emulationCalls, []);
    assert.ok(client.calls.some((c) => c.method === 'Page.captureScreenshot'));

    assert.match(stdout, /<screenshot [^>]*emulation="none"/);
    assert.match(stdout, /width="1280" height="800" css-width="1280" css-height="800" css-x="0" css-y="0" css-to-image-x="1\.000000" css-to-image-y="1\.000000"/);
    assert.ok(stdout.includes(outPath));
    assert.match(stdout, /CSS-to-image scale: 1\.000000 image px\/CSS px horizontally and 1\.000000 image px\/CSS px vertically/);
    assert.match(stdout, /scroll-x="0" scroll-y="0"/);
    assert.match(stdout, /scroll offset at capture: x=0 y=0 CSS px/);
    assert.match(stdout, /emulation: none — the browser's actual current viewport was captured/);
    assert.ok(fs.existsSync(outPath));

    // A look is cheap: no settle window, and the connection is opened as the
    // verb (stderr diagnostics identify the leaf, not the branch token).
    assert.equal(state.settleSeen, 0);
    assert.equal(state.commandSeen, 'shot');
  } finally {
    cleanup(state);
    fs.rmSync(outPath, { force: true });
  }
});

// A zoomed page's layout viewport (window.innerWidth/innerHeight) is a
// different coordinate space from the visual viewport the PNG is clipped to.
// Reporting the former produced a false scale — at page-scale 1.5 a 1000x700
// layout viewport yields a 667x467 image whose true CSS-to-image scale is ~1,
// not 0.667.
test('page shot reports the live scroll offset as capture provenance', async () => {
  const outPath = path.join(os.tmpdir(), `u07-scroll-${process.pid}.png`);
  const client = stubClient(captureHandlers(makePng(1280, 800), { pageX: 42.5, pageY: 137.25 }));
  const state = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageShot(parsedFor({ out: outPath }), []));
    assert.equal(exitCode, undefined);
    assert.match(stdout, /scroll-x="42\.5" scroll-y="137\.25"/);
    assert.match(stdout, /scroll offset at capture: x=42\.5 y=137\.25 CSS px/);
  } finally {
    cleanup(state);
    fs.rmSync(outPath, { force: true });
  }
});

test('page shot reports no scroll offset when its final fallback viewport probe cannot establish one', async () => {
  const outPath = path.join(os.tmpdir(), `u07-scroll-fallback-${process.pid}.png`);
  let captures = 0;
  const client = stubClient({
    'Page.getLayoutMetrics': () => ({
      contentSize: { width: 1280, height: 800 },
      cssVisualViewport: { clientWidth: 1280, clientHeight: 800, pageX: 42, pageY: 137 },
    }),
    'Runtime.evaluate': (params) => {
      if (String(params.expression).includes('devicePixelRatio')) return { result: { value: 1 } };
      throw new Error('final visual viewport probe unavailable');
    },
    'Page.captureScreenshot': () => ({ data: captures++ < 2 ? '' : PNG.sync.write(new PNG({ width: 1, height: 1 })).toString('base64') }),
  });
  const state = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageShot(parsedFor({ out: outPath }), []));
    assert.equal(exitCode, undefined);
    assert.ok(!stdout.includes('scroll-x='), stdout);
    assert.match(stdout, /scroll offset at capture unavailable/);
  } finally {
    cleanup(state);
    fs.rmSync(outPath, { force: true });
  }
});

test('a downscaled full-page image names its effective scale in result attributes and summary', () => {
  const output = renderResult(buildScreenshotResult({
    path: '/tmp/long-page.png',
    bytes: 1234,
    dimensions: { width: 301, height: 1600 },
    cssViewport: { x: 0, y: 0, width: 800, height: 4253 },
    emulation: 'full-page',
  }));

  assert.match(output, /effective-downscale-x="0\.376250" effective-downscale-y="0\.376205"/);
  assert.match(output, /effective downscale: horizontal 0\.376250× and vertical 0\.376205× \(image px\/CSS px\)/);
  assert.match(output, /CSS-to-image scale: 0\.376250 image px\/CSS px horizontally and 0\.376205 image px\/CSS px vertically/);
});

test('under page zoom the scale is measured against the captured clip, not the layout viewport', async () => {
  const outPath = path.join(os.tmpdir(), `u07-zoom-${process.pid}.png`);
  const client = stubClient({
    'Page.getLayoutMetrics': () => ({
      contentSize: { width: 1000, height: 700 },
      cssVisualViewport: { clientWidth: 666.6667, clientHeight: 466.6667, pageX: 0, pageY: 0 },
    }),
    'Runtime.evaluate': (params) => String(params.expression ?? '').includes('devicePixelRatio')
      ? ({ result: { value: 1 } })
      : ({ result: { value: { width: 1000, height: 700 } } }),
    'Page.captureScreenshot': () => ({ data: makePng(667, 467).toString('base64') }),
  });
  const state = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageShot(parsedFor({ out: outPath }), []));
    assert.equal(exitCode, undefined);

    const clip = client.calls.find((c) => c.method === 'Page.captureScreenshot')?.params.clip as Record<string, number>;
    assert.deepEqual({ width: clip.width, height: clip.height }, { width: 667, height: 467 });
    assert.match(stdout, /css-width="667" css-height="467"/);
    assert.match(stdout, /css-to-image-x="1\.000000" css-to-image-y="1\.000000"/);
  } finally {
    cleanup(state);
    fs.rmSync(outPath, { force: true });
  }
});

test('CSS coordinate crops preserve fractional origins, clamp to the visual viewport, and report the actual scale', async () => {
  const outPath = path.join(os.tmpdir(), `u07-crop-${process.pid}.png`);
  const client = stubClient(captureHandlers(makePng(60, 80)));
  const state = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageShot(parsedFor({ crop: '-5,20,20,20', zoom: '4', out: outPath }), []));
    assert.equal(exitCode, undefined);
    const clip = client.calls.find((call) => call.method === 'Page.captureScreenshot')?.params.clip as Record<string, number>;
    assert.deepEqual(clip, { x: 0, y: 20, width: 15, height: 20, scale: 4 });
    assert.match(stdout, /css-width="15" css-height="20" css-x="0" css-y="20" css-to-image-x="4\.000000" css-to-image-y="4\.000000"/);
    assert.match(stdout, /CSS crop: coordinates requested x=-5 y=20 w=20 h=20 at zoom 4; the captured CSS region above is its intersection with the source visual viewport/);
  } finally {
    cleanup(state);
    fs.rmSync(outPath, { force: true });
  }
});

test('a CSS crop fails rather than silently falling back to an uncropped viewport image', async () => {
  const outPath = path.join(os.tmpdir(), `u07-crop-no-fallback-${process.pid}.png`);
  let captures = 0;
  const client = stubClient({
    ...captureHandlers(makePng(100, 100)),
    'Page.captureScreenshot': () => ({ data: captures++ < 2 ? '' : makePng(100, 100).toString('base64') }),
  });
  const state = installDeps(client);
  try {
    await assert.rejects(
      cmdPageShot(parsedFor({ crop: '10,10,20,20', out: outPath }), []),
      /returned no image data/,
    );
    assert.equal(captures, 2, 'a crop retries only its clip; it never requests an unrelated viewport image');
    assert.equal(fs.existsSync(outPath), false);
  } finally {
    cleanup(state);
    fs.rmSync(outPath, { force: true });
  }
});

test('--crop-selector resolves exactly one target, pads its border box, and captures at the requested zoom', async () => {
  const outPath = path.join(os.tmpdir(), `u07-selector-crop-${process.pid}.png`);
  const client = stubClient({
    ...captureHandlers(makePng(176, 176), { pageX: 100, pageY: 400 }),
    'DOM.enable': () => ({}),
    'DOM.getDocument': () => ({ root: { nodeId: 1 } }),
    'DOM.querySelectorAll': () => ({ nodeIds: [2] }),
    'DOM.describeNode': () => ({ node: { backendNodeId: 14 } }),
    'Accessibility.getPartialAXTree': () => ({ nodes: [{ backendDOMNodeId: 14, role: { value: 'button' }, name: { value: 'Tile' } }] }),
    'DOM.scrollIntoViewIfNeeded': () => ({}),
    'DOM.getBoxModel': () => ({ model: { border: [26.5, 142, 54.5, 142, 54.5, 170, 26.5, 170] } }),
  });
  const state = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageShot(parsedFor({ cropSelector: '.tile', pad: 8, zoom: '4', out: outPath }), []));
    assert.equal(exitCode, undefined);
    const clip = client.calls.find((call) => call.method === 'Page.captureScreenshot')?.params.clip as Record<string, number>;
    assert.deepEqual(clip, { x: 118.5, y: 534, width: 44, height: 44, scale: 4 });
    assert.match(stdout, /crop-source="selector" crop-selector="\.tile" crop-backend-node-id="14" requested-zoom="4"/);
    assert.match(stdout, /captured CSS region 44×44 at page origin 118\.5,534/);
    assert.match(stdout, /border box plus 8px padding requested x=118\.5 y=534 w=44 h=44 at zoom 4/);
  } finally {
    cleanup(state);
    fs.rmSync(outPath, { force: true });
  }
});

test('--crop-selector names the requested and delivered regions when the live visual viewport clips the padded target', async () => {
  const outPath = path.join(os.tmpdir(), `u07-selector-crop-clipped-${process.pid}.png`);
  const client = stubClient({
    ...captureHandlers(makePng(240, 70), { pageX: 0, pageY: 400 }),
    'DOM.enable': () => ({}),
    'DOM.getDocument': () => ({ root: { nodeId: 1 } }),
    'DOM.querySelectorAll': () => ({ nodeIds: [2] }),
    'DOM.describeNode': () => ({ node: { backendNodeId: 14 } }),
    'Accessibility.getPartialAXTree': () => ({ nodes: [{ backendDOMNodeId: 14, role: { value: 'region' }, name: { value: 'Tall tile' } }] }),
    'DOM.scrollIntoViewIfNeeded': () => ({}),
    'DOM.getBoxModel': () => ({ model: { border: [100, 750, 300, 750, 300, 950, 100, 950] } }),
  });
  const state = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageShot(parsedFor({ cropSelector: '.tile', pad: 20, out: outPath }), []));
    assert.equal(exitCode, undefined);
    const clip = client.calls.find((call) => call.method === 'Page.captureScreenshot')?.params.clip as Record<string, number>;
    assert.deepEqual(clip, { x: 80, y: 1130, width: 240, height: 70, scale: 1 });
    assert.match(stdout, /crop-constrained="visual-viewport"/);
    assert.match(stdout, /Crop constraint: requested x=80 y=1130 w=240 h=240; delivered x=80 y=1130 w=240 h=70 because the requested selector crop extended outside the live visual viewport/);
  } finally {
    cleanup(state);
    fs.rmSync(outPath, { force: true });
  }
});

// ---------------------------------------------------------------------------
// --viewport WxH: transient override, cleared after the capture
// ---------------------------------------------------------------------------

test('--viewport 390x844 applies the transient override and clears it after the capture', async () => {
  const outPath = path.join(os.tmpdir(), `u07-viewport-${process.pid}.png`);
  const client = stubClient(captureHandlers(makePng(390, 844), { emulation: true }));
  const state = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() =>
      cmdPageShot(parsedFor({ viewport: '390x844', out: outPath }), []),
    );
    assert.equal(exitCode, undefined);

    const set = client.calls.find((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    assert.ok(set, 'the override must be applied');
    assert.equal(set.params.width, 390);
    assert.equal(set.params.height, 844);

    // Cleared AFTER the capture — the override is transient, never left behind.
    const methods = client.calls.map((c) => c.method);
    const captureIdx = methods.indexOf('Page.captureScreenshot');
    const clearIdx = methods.indexOf('Emulation.clearDeviceMetricsOverride');
    assert.ok(captureIdx >= 0 && clearIdx > captureIdx, `clear must follow the capture: ${methods.join(', ')}`);

    assert.match(stdout, /<screenshot [^>]*emulation="viewport"/);
    assert.match(stdout, /transient 390x844 device-metrics override applied .* and cleared/);
  } finally {
    cleanup(state);
    fs.rmSync(outPath, { force: true });
  }
});

test('--color-scheme dark applies media emulation through the screenshot and clears it afterward', async () => {
  const outPath = path.join(os.tmpdir(), `u07-dark-${process.pid}.png`);
  const client = stubClient(captureHandlers(makePng(1280, 800), { media: true }));
  const state = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageShot(parsedFor({ colorScheme: 'dark', out: outPath }), []));
    assert.equal(exitCode, undefined);
    const mediaCalls = client.calls.filter((call) => call.method === 'Emulation.setEmulatedMedia');
    assert.deepEqual(mediaCalls.map((call) => call.params), [
      { features: [{ name: 'prefers-color-scheme', value: 'dark' }] },
      { features: [] },
    ]);
    const methods = client.calls.map((call) => call.method);
    assert.ok(methods.indexOf('Page.captureScreenshot') > methods.indexOf('Emulation.setEmulatedMedia'));
    assert.equal(methods.at(-1), 'Emulation.setEmulatedMedia');
    assert.match(stdout, /color-scheme="dark"/);
    assert.match(stdout, /prefers-color-scheme=dark override applied .* cleared/);
  } finally {
    cleanup(state);
    fs.rmSync(outPath, { force: true });
  }
});

test('--full-page overrides to the full content height and clears it after the capture', async () => {
  const outPath = path.join(os.tmpdir(), `u07-fullpage-${process.pid}.png`);
  const client = stubClient(captureHandlers(makePng(1280, 2400), { emulation: true, contentHeight: 2400 }));
  const state = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageShot(parsedFor({ fullPage: true, out: outPath }), []));
    assert.equal(exitCode, undefined);

    const set = client.calls.find((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    assert.ok(set);
    assert.equal(set.params.height, 2400);

    const methods = client.calls.map((c) => c.method);
    assert.ok(
      methods.indexOf('Emulation.clearDeviceMetricsOverride') > methods.indexOf('Page.captureScreenshot'),
    );

    assert.match(stdout, /<screenshot [^>]*emulation="full-page"/);
    assert.match(stdout, /full-page device-metrics override applied .* and cleared/);
  } finally {
    cleanup(state);
    fs.rmSync(outPath, { force: true });
  }
});

test('screenshot cleanup follows a rejected first override setup exactly once', async () => {
  const setupError = new Error('first setup response rejected');
  const client = scriptedHeldClient([
    { method: 'Emulation.setDeviceMetricsOverride', error: setupError },
    { method: 'Emulation.clearDeviceMetricsOverride' },
  ]);

  await assert.rejects(
    captureScreenshot(client as never, { width: 390, height: 844 }),
    (error: unknown) => error === setupError,
  );
  assert.deepEqual(client.calls, [
    'Emulation.setDeviceMetricsOverride',
    'Emulation.clearDeviceMetricsOverride',
  ]);
  assert.equal(client.remaining, 0);
});

test('screenshot cleanup follows a rejected second override setup exactly once', async () => {
  const setupError = new Error('second setup response rejected');
  const client = scriptedHeldClient([
    { method: 'Emulation.setDeviceMetricsOverride' },
    { method: 'Page.getLayoutMetrics', result: { contentSize: { width: 390, height: 1200 }, cssVisualViewport: { clientWidth: 390 } } },
    { method: 'Emulation.setDeviceMetricsOverride', error: setupError },
    { method: 'Emulation.clearDeviceMetricsOverride' },
  ]);

  await assert.rejects(
    captureScreenshot(client as never, { width: 390, height: 844 }, { fullPage: true }),
    (error: unknown) => error === setupError,
  );
  assert.deepEqual(client.calls, [
    'Emulation.setDeviceMetricsOverride',
    'Page.getLayoutMetrics',
    'Emulation.setDeviceMetricsOverride',
    'Emulation.clearDeviceMetricsOverride',
  ]);
  assert.equal(client.remaining, 0);
});

test('screenshot cleanup follows capture rejection and preserves its primary error', async () => {
  const captureError = new Error('capture rejected');
  const client = scriptedHeldClient([
    { method: 'Emulation.setDeviceMetricsOverride' },
    { method: 'Page.getLayoutMetrics', result: { cssVisualViewport: { clientWidth: 390, clientHeight: 844, pageX: 0, pageY: 0 } } },
    { method: 'Runtime.evaluate', result: { result: { value: 1 } } },
    { method: 'Page.captureScreenshot', error: captureError },
    { method: 'Emulation.clearDeviceMetricsOverride' },
  ]);

  await assert.rejects(
    captureScreenshot(client as never, { width: 390, height: 844 }),
    (error: unknown) => error === captureError,
  );
  assert.deepEqual(client.calls, [
    'Emulation.setDeviceMetricsOverride',
    'Page.getLayoutMetrics',
    'Runtime.evaluate',
    'Page.captureScreenshot',
    'Emulation.clearDeviceMetricsOverride',
  ]);
  assert.equal(client.remaining, 0);
});

test('screenshot surfaces a clear-only failure after a successful capture', async () => {
  const cleanupError = new Error('clear rejected');
  const client = scriptedHeldClient([
    { method: 'Emulation.setDeviceMetricsOverride' },
    { method: 'Page.getLayoutMetrics', result: { cssVisualViewport: { clientWidth: 390, clientHeight: 844, pageX: 0, pageY: 0 } } },
    { method: 'Runtime.evaluate', result: { result: { value: 1 } } },
    { method: 'Page.captureScreenshot', result: { data: makePng(390, 844).toString('base64') } },
    { method: 'Emulation.clearDeviceMetricsOverride', error: cleanupError },
  ]);

  await assert.rejects(
    captureScreenshot(client as never, { width: 390, height: 844 }),
    (error: unknown) => error === cleanupError,
  );
  assert.equal(client.calls.at(-1), 'Emulation.clearDeviceMetricsOverride');
  assert.equal(client.calls.filter((method) => method === 'Emulation.clearDeviceMetricsOverride').length, 1);
  assert.equal(client.remaining, 0);
});

test('screenshot dual failure preserves primary and cleanup errors in order', async () => {
  const captureError = new Error('capture rejected');
  const cleanupError = new Error('clear rejected');
  const client = scriptedHeldClient([
    { method: 'Emulation.setDeviceMetricsOverride' },
    { method: 'Page.getLayoutMetrics', result: { cssVisualViewport: { clientWidth: 390, clientHeight: 844, pageX: 0, pageY: 0 } } },
    { method: 'Runtime.evaluate', result: { result: { value: 1 } } },
    { method: 'Page.captureScreenshot', error: captureError },
    { method: 'Emulation.clearDeviceMetricsOverride', error: cleanupError },
  ]);

  await assert.rejects(
    captureScreenshot(client as never, { width: 390, height: 844 }),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [captureError, cleanupError]);
      assert.equal(error.cause, captureError);
      return true;
    },
  );
  assert.equal(client.calls.filter((method) => method === 'Emulation.clearDeviceMetricsOverride').length, 1);
  assert.equal(client.remaining, 0);
});

// ---------------------------------------------------------------------------
// Viewport grammar: WxH only — malformed values and preset names rejected
// ---------------------------------------------------------------------------

test('a malformed WxH is a structured error, exit 1, before any connection', async () => {
  for (const bad of ['390x', 'x844', '390by844', '0x100', '390x0', '390x844x2', '-390x844', '390 x 844', '390X844', '1.5x800', '39e1x844', '9007199254740992x1']) {
    const client = stubClient({});
    const state = installDeps(client);
    try {
      const { stdout, exitCode } = await runCmd(() => cmdPageShot(parsedFor({ viewport: bad }), []));
      assert.equal(exitCode, 1, `--viewport ${bad} must exit 1`);
      assert.match(stdout, /<error command="page shot" code="invalid_viewport">/);
      assert.match(stdout, /<positive-safe-int>x<positive-safe-int>/);
      assert.equal(state.connectionOpened, false, `--viewport ${bad} must fail before connecting`);
      assert.equal(client.calls.length, 0);
    } finally {
      cleanup(state);
    }
  }
});

test('the deleted preset names are rejected by the WxH grammar', async () => {
  for (const preset of ['desktop', 'desktop-wide', 'tablet', 'mobile']) {
    const client = stubClient({});
    const state = installDeps(client);
    try {
      const { stdout, exitCode } = await runCmd(() => cmdPageShot(parsedFor({ viewport: preset }), []));
      assert.equal(exitCode, 1, `--viewport ${preset} must exit 1`);
      assert.match(stdout, /<error command="page shot" code="invalid_viewport">/);
      assert.ok(stdout.includes(`--viewport ${preset}`), 'the error names the received value');
      assert.match(stdout, /Preset names are not accepted/);
      assert.equal(state.connectionOpened, false);
    } finally {
      cleanup(state);
    }
  }
});

// ---------------------------------------------------------------------------
// Destinations: session shots/ sequence, oneshot dir, explicit --out
// ---------------------------------------------------------------------------

test('sessionless with no --out lands in a oneshot page dir: file 0600 under 0700 dirs', async () => {
  const client = stubClient(captureHandlers(makePng(1280, 800)));
  const state = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageShot(parsedFor(), []));
    assert.equal(exitCode, undefined);

    assert.equal(state.oneshotDirs.length, 1);
    const shotPath = path.join(state.oneshotDirs[0], 'page', 'shot.png');
    assert.ok(shotPath.startsWith(CAPTURE_ROOT), 'the oneshot dir lives under the capture root');
    assert.ok(fs.existsSync(shotPath), 'shot.png written into the oneshot page dir');
    assert.ok(stdout.includes(shotPath), 'the block carries the artifact path');

    assert.equal(fs.statSync(shotPath).mode & 0o777, 0o600, 'screenshot file must be 0600');
    assert.equal(fs.statSync(path.dirname(shotPath)).mode & 0o777, 0o700, 'artifact dir must be 0700');
    assert.equal(fs.statSync(state.oneshotDirs[0]).mode & 0o777, 0o700, 'oneshot dir must be 0700');
  } finally {
    cleanup(state);
  }
});

test('with an active session the shot lands in the shots/ sequence, written private', async () => {
  const sessionDir = path.join(CAPTURE_ROOT, `u07-sess-${process.pid}-${Date.now().toString(36)}`);
  const sessionShotPath = path.join(sessionDir, 'shots', '01-shot-manual.png');
  const client = stubClient(captureHandlers(makePng(1280, 800)));
  const state = installDeps(client, { sessionShotPath });
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageShot(parsedFor(), []));
    assert.equal(exitCode, undefined);

    assert.ok(fs.existsSync(sessionShotPath));
    assert.ok(stdout.includes(sessionShotPath));
    assert.equal(fs.statSync(sessionShotPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(sessionShotPath)).mode & 0o777, 0o700);
    // The session sequence wins — no oneshot dir is created.
    assert.deepEqual(state.oneshotDirs, []);
  } finally {
    cleanup(state);
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('an explicit --out outside the capture root is written as given', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u07-out-'));
  const outPath = path.join(outDir, 'look.png');
  const client = stubClient(captureHandlers(makePng(1280, 800)));
  const state = installDeps(client, { sessionShotPath: '/never/used.png' });
  try {
    const { stdout } = await runCmd(() => cmdPageShot(parsedFor({ out: outPath }), []));
    assert.ok(fs.existsSync(outPath), '--out wins over every default destination');
    assert.ok(stdout.includes(outPath));
    assert.deepEqual(state.oneshotDirs, []);
  } finally {
    cleanup(state);
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Surface hygiene: invalid input, help shape, PNG dimension measurement
// ---------------------------------------------------------------------------

test('a positional argument is a structured invalid_input error', async () => {
  const client = stubClient({});
  const state = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() =>
      cmdPageShot(parsedFor({ positional: ['stray'] } as Partial<ParsedArgs>), []),
    );
    assert.equal(exitCode, 1);
    assert.match(stdout, /<error command="page shot" code="invalid_input">/);
    assert.equal(state.connectionOpened, false);
  } finally {
    cleanup(state);
  }
});

test('-h is the leaf shape: summary, input/output/effects, declared resizes, no examples, no presets', async () => {
  const client = stubClient({});
  const state = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageShot(parsedFor({ help: true }), []));
    assert.equal(exitCode, undefined);
    assert.equal(state.connectionOpened, false);

    assert.match(stdout, /^capture page shot — /);
    assert.match(stdout, /^input:$/m);
    assert.match(stdout, /^output:$/m);
    assert.match(stdout, /^effects:$/m);
    assert.match(stdout, /--viewport <WxH>/);
    assert.match(stdout, /--color-scheme <dark\|light>/);
    // The two page-observable resizes are the declared effect; the no-flag
    // default declares its absence of any Emulation call.
    assert.match(stdout, /two page-observable resizes/);
    assert.match(stdout, /zero Emulation\.\* calls/);
    assert.ok(!/example/i.test(stdout), 'leaf help carries no examples');
    for (const preset of ['desktop-wide', 'tablet', 'mobile', '--height']) {
      assert.ok(!stdout.includes(preset), `help must not mention the deleted ${preset}`);
    }
  } finally {
    cleanup(state);
  }
});

test('dimensions are measured from the PNG bytes, not echoed from input', () => {
  assert.deepEqual(pngDimensions(makePng(390, 844)), { width: 390, height: 844 });
  assert.equal(pngDimensions(Buffer.from('not a png at all, definitely')), null);
  assert.equal(pngDimensions(Buffer.alloc(4)), null);
});
