import { test, describe, before, after } from 'node:test';
import { LIVE_CHROME, liveChromeOpts } from './fixtures/live-chrome.js';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { closeChrome, spawnHeadlessChrome, type ChromeFixture } from './fixtures/chrome.js';

import { PNG } from 'pngjs';

import { CAPTURE_ROOT, ensurePrivateDir, removeArtifactTree, writeJsonPrivate, writeBinaryPrivate } from '../src/session/artifacts.js';
import { CDPClient } from '../src/cdp/client.js';
import { enableDomainsForSnap } from '../src/cdp/domains.js';
import type { SnapshotContext, SnapshotWriter } from '../src/cdp/measure/types.js';
import { collectPixels } from '../src/cdp/measure/collectors/pixels.js';

// ============================================================================
// Test fixtures — a 100x50 CSS-pixel viewport with one "element" occupying
// the rect x=10,y=10,w=20,h=10, solid red (255,0,0). Two full-page PNGs
// stand in for `Page.captureScreenshot`'s two calls (normal background,
// then transparent background): the normal one is opaque everywhere
// (white background, red element); the transparent one is alpha=0
// everywhere except the red element (alpha=255), so alphaFraction /
// visiblePixelFraction on that element's crop should read ~1.0.
// ============================================================================

const VIEWPORT_W = 100;
const VIEWPORT_H = 50;
const ELEMENT_RECT = { x: 10, y: 10, width: 20, height: 10 };

function buildFullPagePng(mode: 'normal' | 'transparent'): PNG {
  const png = new PNG({ width: VIEWPORT_W, height: VIEWPORT_H });
  for (let y = 0; y < VIEWPORT_H; y += 1) {
    for (let x = 0; x < VIEWPORT_W; x += 1) {
      const o = (y * VIEWPORT_W + x) * 4;
      const insideElement =
        x >= ELEMENT_RECT.x &&
        x < ELEMENT_RECT.x + ELEMENT_RECT.width &&
        y >= ELEMENT_RECT.y &&
        y < ELEMENT_RECT.y + ELEMENT_RECT.height;
      if (insideElement) {
        png.data[o] = 255;
        png.data[o + 1] = 0;
        png.data[o + 2] = 0;
        png.data[o + 3] = 255;
      } else if (mode === 'normal') {
        png.data[o] = 255;
        png.data[o + 1] = 255;
        png.data[o + 2] = 255;
        png.data[o + 3] = 255;
      } else {
        png.data[o] = 0;
        png.data[o + 1] = 0;
        png.data[o + 2] = 0;
        png.data[o + 3] = 0;
      }
    }
  }
  return png;
}

const NORMAL_PNG_BASE64 = PNG.sync.write(buildFullPagePng('normal')).toString('base64');
const TRANSPARENT_PNG_BASE64 = PNG.sync.write(buildFullPagePng('transparent')).toString('base64');

/** A quad, clockwise from top-left, for `ELEMENT_RECT`: [x1,y1,x2,y2,x3,y3,x4,y4]. */
const ELEMENT_QUAD = [
  ELEMENT_RECT.x,
  ELEMENT_RECT.y,
  ELEMENT_RECT.x + ELEMENT_RECT.width,
  ELEMENT_RECT.y,
  ELEMENT_RECT.x + ELEMENT_RECT.width,
  ELEMENT_RECT.y + ELEMENT_RECT.height,
  ELEMENT_RECT.x,
  ELEMENT_RECT.y + ELEMENT_RECT.height,
];

/** Matches the collector's `AncestorClipInfo` shape returned by the page-side ancestor-clip walk. */
interface StubClipInfo {
  rect: { x: number; y: number; width: number; height: number } | null;
  shapes?: unknown[];
  approximate?: boolean;
}

/** Convenience builder for a plain rectangular clip (the pre-existing overflow/inset stub tests). */
function rectClip(rect: { x: number; y: number; width: number; height: number } | null): StubClipInfo {
  return { rect, shapes: [], approximate: false };
}

interface StubOptions {
  /** nodeIds `DOM.querySelectorAll` reports; each must have a matching entry in `nodes`. */
  nodeIds: number[];
  nodes: Record<
    number,
    {
      quad?: number[];
      quads?: number[][];
      /** Forces the REAL `DOM.getContentQuads` call to throw — a genuine per-element read failure (`elementsReadFailed`), distinct from {@link noLayoutBox} below. */
      throwsOnQuads?: boolean;
      /** Makes `DOM.getContentQuads` resolve normally with a real, honest EMPTY array — the genuine "no layout box" shape (`display:none`/detached/etc.) that must never be conflated with {@link throwsOnQuads}'s genuine read failure. */
      noLayoutBox?: boolean;
      nodeName?: string;
      backendNodeId?: number;
      attributes?: string[];
      /** Forces `DOM.describeNode` to throw for this node — the adversarial identity-resolution failure this suite proves is handled honestly (I-3). */
      throwsOnDescribeNode?: boolean;
      /** Forces `DOM.describeNode` to resolve WITHOUT a `backendNodeId` on its `node` — the other identity-unresolved shape (resolved call, missing field), distinct from an outright throw. */
      omitsBackendNodeId?: boolean;
      /** Forces the ancestor-clip `DOM.resolveNode` call to resolve WITHOUT an `object.objectId` for this node — the adversarial "resolved but no handle" ancestor-clip failure (I-5), distinct from an outright throw. */
      clipResolveNodeOmitsObjectId?: boolean;
      /** Forces the ancestor-clip `DOM.resolveNode` call to throw for this node. */
      clipResolveNodeThrows?: boolean;
      /** Forces the ancestor-clip `Runtime.callFunctionOn` call to resolve WITHOUT a `result.value` for this node — the adversarial malformed-response ancestor-clip failure, distinct from an outright throw. */
      clipCallFunctionOmitsValue?: boolean;
      /** Forces the ancestor-clip `Runtime.callFunctionOn` call to throw for this node. */
      clipCallFunctionThrows?: boolean;
    }
  >;
  /** Full-page PNG (base64) returned for the normal-background screenshot; defaults to the 100x50 1:1 fixture. */
  normalPngBase64?: string;
  /** Full-page PNG (base64) returned for the transparent-background screenshot; defaults to the 100x50 1:1 fixture. */
  transparentPngBase64?: string;
  /** `{w,h}` reported by the `window.innerWidth`/`innerHeight` probe; defaults to the 100x50 viewport. */
  viewport?: { w: number; h: number };
  /** When set, `Runtime.evaluate`'s `window.innerWidth`/`innerHeight` probe resolves WITHOUT a usable `{w,h}` value (an empty `result`) — the adversarial missing-viewport-read path this suite proves is surfaced honestly rather than silently substituted. */
  viewportUnavailable?: boolean;
  /** When set, `Page.captureScreenshot` throws on the matching capture: `'normal'` (background not overridden) or `'transparent'` (override active). */
  screenshotError?: 'normal' | 'transparent';
  /** Ancestor-clip info the `DOM.resolveNode` + `Runtime.callFunctionOn` round trip reports for a given nodeId; absent means "no ancestor clip", exactly like a real page with no clipping ancestor. Matches the collector's `AncestorClipInfo` contract (`rect` + `shapes` + `approximate`). */
  clipRects?: Record<number, StubClipInfo | null>;
}

/** Axis-aligned bounding quad (clockwise from top-left) of one-or-more quads, for the `DOM.getBoxModel` stub. */
function boundingQuad(quads: number[][]): number[] {
  const xs = quads.flatMap((q) => [q[0], q[2], q[4], q[6]]);
  const ys = quads.flatMap((q) => [q[1], q[3], q[5], q[7]]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return [minX, minY, maxX, minY, maxX, maxY, minX, maxY];
}

class StubCdpClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  private transparentMode = false;
  private readonly options: StubOptions;

  constructor(options: StubOptions) {
    this.options = options;
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });

    if (method === 'Emulation.setDefaultBackgroundColorOverride') {
      this.transparentMode = 'color' in params;
      return {};
    }
    if (method === 'Page.captureScreenshot') {
      if (this.options.screenshotError === 'transparent' && this.transparentMode) {
        throw new Error('injected transparent-background screenshot failure');
      }
      if (this.options.screenshotError === 'normal' && !this.transparentMode) {
        throw new Error('injected normal-background screenshot failure');
      }
      const normal = this.options.normalPngBase64 ?? NORMAL_PNG_BASE64;
      const transparent = this.options.transparentPngBase64 ?? TRANSPARENT_PNG_BASE64;
      return { data: this.transparentMode ? transparent : normal };
    }
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('window.innerWidth')) {
        if (this.options.viewportUnavailable) return { result: {} };
        const vp = this.options.viewport ?? { w: VIEWPORT_W, h: VIEWPORT_H };
        return { result: { value: vp } };
      }
      return { result: {} };
    }
    if (method === 'DOM.getDocument') {
      return { root: { nodeId: 1 } };
    }
    if (method === 'DOM.querySelectorAll') {
      return { nodeIds: this.options.nodeIds };
    }
    if (method === 'DOM.getContentQuads') {
      const nodeId = (params as { nodeId: number }).nodeId;
      const node = this.options.nodes[nodeId];
      if (!node) throw new Error(`no stub configured for node ${nodeId}`);
      if (node.throwsOnQuads) throw new Error(`injected DOM.getContentQuads failure for node ${nodeId}`);
      if (node.noLayoutBox) return { quads: [] };
      return { quads: node.quads ?? [node.quad ?? ELEMENT_QUAD] };
    }
    if (method === 'DOM.getBoxModel') {
      const nodeId = (params as { nodeId: number }).nodeId;
      const node = this.options.nodes[nodeId];
      if (!node || node.throwsOnQuads) throw new Error(`no layout box for node ${nodeId}`);
      const quad = node.quads ? boundingQuad(node.quads) : (node.quad ?? ELEMENT_QUAD);
      const width = Math.abs(quad[2] - quad[0]);
      const height = Math.abs(quad[5] - quad[1]);
      return { model: { content: quad, padding: quad, border: quad, margin: quad, width, height } };
    }
    if (method === 'DOM.describeNode') {
      const nodeId = (params as { nodeId: number }).nodeId;
      const node = this.options.nodes[nodeId];
      if (node?.throwsOnDescribeNode) {
        throw new Error(`injected DOM.describeNode failure for node ${nodeId}`);
      }
      return {
        node: {
          nodeName: node?.nodeName ?? 'DIV',
          ...(node?.omitsBackendNodeId ? {} : { backendNodeId: node?.backendNodeId ?? nodeId * 1000 }),
          attributes: node?.attributes ?? [],
        },
      };
    }
    if (method === 'DOM.resolveNode') {
      const nodeId = (params as { nodeId: number }).nodeId;
      const node = this.options.nodes[nodeId];
      if (node?.clipResolveNodeThrows) throw new Error(`injected DOM.resolveNode failure for node ${nodeId}`);
      if (node?.clipResolveNodeOmitsObjectId) return { object: {} };
      return { object: { objectId: `stub-obj-${nodeId}` } };
    }
    if (method === 'Runtime.callFunctionOn') {
      const objectId = String((params as { objectId?: unknown }).objectId ?? '');
      const nodeId = Number(objectId.replace('stub-obj-', ''));
      const node = this.options.nodes[nodeId];
      if (node?.clipCallFunctionThrows) throw new Error(`injected Runtime.callFunctionOn failure for node ${nodeId}`);
      if (node?.clipCallFunctionOmitsValue) return { result: {} };
      const clip = this.options.clipRects?.[nodeId];
      if (clip === undefined) return { result: { value: { rect: null, shapes: [], approximate: false } } };
      if (clip === null) return { result: { value: { rect: null, shapes: [], approximate: false } } };
      return { result: { value: clip } };
    }
    return {};
  }
}

// ============================================================================
// Test helpers — a real SnapshotWriter backed by the shared secure-fs
// helpers, mirroring `snapshot.ts`'s (unexported) `makeWriter`, so crops
// and `pixels.json` really land on disk under a scoped snap dir.
// ============================================================================

function makeTestWriter(dir: string): SnapshotWriter {
  return {
    json(filename, value) {
      writeJsonPrivate(resolveScoped(dir, filename), value);
    },
    binary(filename, data) {
      writeBinaryPrivate(resolveScoped(dir, filename), data);
    },
  };
}

function resolveScoped(dir: string, filename: string): string {
  const target = path.resolve(dir, filename);
  const rel = path.relative(dir, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`escaping artifact filename: ${filename}`);
  }
  return target;
}

function makeSnapDir(label: string): string {
  const dir = path.join(CAPTURE_ROOT, `test-pixels-${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, 'measure', 'snaps', 'snap-test');
  return ensurePrivateDir(dir);
}

function makeCtx(dir: string, client: CDPClient): SnapshotContext {
  return {
    client,
    dir,
    snapId: 'snap-test',
    url: null,
    viewport: `${VIEWPORT_W}x${VIEWPORT_H}`,
    settled: true,
    freezeAnimations: false,
    captureUnsettled: false,
    pixels: true,
    state: [],
    unstableRegions: [],
    write: makeTestWriter(dir),
  };
}

interface PixelsJson {
  scope: {
    enumeration: string;
    pierce: boolean;
    includesIframeContent: boolean;
    includesShadowDom: boolean;
  };
  backgroundOverrideRestored: boolean;
  captureFailed: boolean;
  elementsTotal?: number;
  elementsTruncated?: boolean;
  elementsSkipped?: number;
  elementsReadFailed?: number;
  viewportScale?: {
    available: boolean;
    innerWidth: number;
    innerHeight: number;
    scaleX: number;
    scaleY: number;
    unavailableReason?: string;
  };
  elements: Array<{
    id: string;
    backendNodeId: number | null;
    identityUnresolved?: boolean;
    selector?: string;
    rect: { x: number; y: number; width: number; height: number };
    ancestorClipped?: boolean;
    ancestorClipApproximate?: boolean;
    ancestorClipUnavailable?: boolean;
    ancestorClipUnavailableReason?: string;
    crop: string;
    maskedPixelFraction: number;
    hash: string;
    avgColor: { r: number; g: number; b: number };
    medianColor: { r: number; g: number; b: number };
    dominantColor: { r: number; g: number; b: number };
    alphaFraction: number;
    visiblePixelFraction: number;
  }>;
}

// ============================================================================
// Tests
// ============================================================================

test('collectPixels is a no-op when ctx.pixels is false', async () => {
  const dir = makeSnapDir('noop');
  try {
    const client = new StubCdpClient({ nodeIds: [], nodes: {} });
    const ctx: SnapshotContext = { ...makeCtx(dir, client as unknown as CDPClient), pixels: false };

    await collectPixels(ctx);

    assert.equal(client.calls.length, 0, 'no CDP calls when pixels is disabled');
    assert.equal(fs.existsSync(path.join(dir, 'pixels.json')), false);
    assert.equal(fs.existsSync(path.join(dir, 'crops')), false);
  } finally {
    removeArtifactTree(dir);
  }
});

test('collectPixels writes a quad-derived crop file, dominant color, and pixels.json for a known colored element', async () => {
  const dir = makeSnapDir('basic');
  try {
    const client = new StubCdpClient({
      nodeIds: [42],
      nodes: { 42: { nodeName: 'DIV', backendNodeId: 4242, attributes: ['class', 'swatch red-swatch'] } },
    });
    const ctx = makeCtx(dir, client as unknown as CDPClient);

    await collectPixels(ctx);

    const pixelsJsonPath = path.join(dir, 'pixels.json');
    assert.equal(fs.existsSync(pixelsJsonPath), true, 'pixels.json written');
    const pixelsJson = JSON.parse(fs.readFileSync(pixelsJsonPath, 'utf8')) as PixelsJson;
    assert.equal(pixelsJson.elements.length, 1);

    const el = pixelsJson.elements[0];
    assert.equal(el.id, 'px-0');
    assert.equal(el.backendNodeId, 4242);
    assert.equal(el.selector, 'div.swatch.red-swatch');
    assert.deepEqual(el.rect, ELEMENT_RECT);

    // Crop path follows the id-relative grammar: `{snapId}/crops/<file>.png`.
    assert.match(el.crop, /^snap-test\/crops\/.+\.png$/);
    const cropRelPath = el.crop.slice('snap-test/'.length);
    const cropAbsPath = path.join(dir, cropRelPath);
    assert.equal(fs.existsSync(cropAbsPath), true, 'crop file exists on disk');

    // The crop is a real, decodable PNG sized exactly to the quad-derived rect (scale 1:1 here).
    const decoded = PNG.sync.read(fs.readFileSync(cropAbsPath));
    assert.equal(decoded.width, ELEMENT_RECT.width);
    assert.equal(decoded.height, ELEMENT_RECT.height);
    // Every pixel in the crop is the solid red fill.
    for (let i = 0; i < decoded.width * decoded.height; i += 1) {
      const o = i * 4;
      assert.equal(decoded.data[o], 255);
      assert.equal(decoded.data[o + 1], 0);
      assert.equal(decoded.data[o + 2], 0);
      assert.equal(decoded.data[o + 3], 255);
    }

    // Solid-color crop: avg/median/dominant all agree exactly.
    assert.deepEqual(el.avgColor, { r: 255, g: 0, b: 0 });
    assert.deepEqual(el.medianColor, { r: 255, g: 0, b: 0 });
    assert.deepEqual(el.dominantColor, { r: 255, g: 0, b: 0 });

    // The transparent-background sample was solid opaque red over the whole element rect.
    assert.equal(el.alphaFraction, 1);
    assert.equal(el.visiblePixelFraction, 1);

    // Stable hash: 8x8 aHash packed into 16 hex chars.
    assert.match(el.hash, /^[0-9a-f]{16}$/);
  } finally {
    removeArtifactTree(dir);
  }
});

test('collectPixels produces a deterministic hash for identical crop content across runs', async () => {
  const dirA = makeSnapDir('stable-a');
  const dirB = makeSnapDir('stable-b');
  try {
    const nodes = { 7: { nodeName: 'SPAN', backendNodeId: 77 } };
    const clientA = new StubCdpClient({ nodeIds: [7], nodes });
    const clientB = new StubCdpClient({ nodeIds: [7], nodes });

    await collectPixels(makeCtx(dirA, clientA as unknown as CDPClient));
    await collectPixels(makeCtx(dirB, clientB as unknown as CDPClient));

    const a = JSON.parse(fs.readFileSync(path.join(dirA, 'pixels.json'), 'utf8')) as PixelsJson;
    const b = JSON.parse(fs.readFileSync(path.join(dirB, 'pixels.json'), 'utf8')) as PixelsJson;

    assert.equal(a.elements[0].hash, b.elements[0].hash);
    assert.deepEqual(a.elements[0].avgColor, b.elements[0].avgColor);
  } finally {
    removeArtifactTree(dirA);
    removeArtifactTree(dirB);
  }
});

test('collectPixels skips elements with no layout box instead of failing the whole capture', async () => {
  const dir = makeSnapDir('skip');
  try {
    // Node 2's `DOM.getContentQuads` resolves normally with a real, honest
    // EMPTY array -- the genuine no-layout-box shape (display:none/detached)
    // this test proves is silently skipped, never a throw (see
    // `readContentQuads`'s doc comment for why a throw is a DIFFERENT,
    // marked case -- proven by the adversarial test below).
    const client = new StubCdpClient({
      nodeIds: [1, 2],
      nodes: {
        1: { nodeName: 'DIV' },
        2: { noLayoutBox: true }, // e.g. display:none / detached
      },
    });
    const ctx = makeCtx(dir, client as unknown as CDPClient);

    await collectPixels(ctx);

    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;
    assert.equal(pixelsJson.elements.length, 1, 'only the element with a real layout box is recorded');
    assert.equal(pixelsJson.elements[0].id, 'px-0');
    assert.equal(pixelsJson.elementsSkipped, 1, 'the genuinely boxless element counts as a skip');
    assert.equal(pixelsJson.elementsReadFailed, 0, 'a genuine no-layout-box element is NOT a read failure');
  } finally {
    removeArtifactTree(dir);
  }
});

// ============================================================================
// I-5 -- per-element `DOM.getContentQuads` read-failure honesty (a genuine
// CDP throw must never be coerced into the same silent skip a genuinely
// uncroppable/no-layout-box element gets -- see `readContentQuads`'s and
// `describeElementForCrop`'s doc comments).
// ============================================================================

test('collectPixels counts a genuine DOM.getContentQuads throw as elementsReadFailed, distinct from elementsSkipped', async () => {
  const dir = makeSnapDir('quads-read-failed');
  try {
    const client = new StubCdpClient({
      nodeIds: [1, 2, 3],
      nodes: {
        1: { nodeName: 'DIV' }, // real, croppable element
        2: { noLayoutBox: true }, // genuinely uncroppable -- an honest empty read, not a failure
        3: { throwsOnQuads: true }, // a genuine CDP protocol failure on the SAME call
      },
    });
    const ctx = makeCtx(dir, client as unknown as CDPClient);

    await collectPixels(ctx);

    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;
    assert.equal(pixelsJson.elements.length, 1, 'only the real element is recorded -- the boxless and the failed reads never enter elements[]');
    assert.equal(pixelsJson.elements[0].id, 'px-0');
    assert.equal(pixelsJson.elementsSkipped, 1, 'ONLY the genuinely uncroppable (no-layout-box) element is counted here');
    assert.equal(
      pixelsJson.elementsReadFailed,
      1,
      'the genuine DOM.getContentQuads throw is counted separately -- never folded into elementsSkipped',
    );
  } finally {
    removeArtifactTree(dir);
  }
});

// ============================================================================
// I-3 (Class B) — identity honesty on per-element `DOM.describeNode`
// failure. The happy-path test above already proves `backendNodeId` is
// populated when identity resolves; these prove the FAILURE path is honest
// too: every element-bearing record carries `backendNodeId: number | null`
// (the key always present, `null` rather than omitted when identity did not
// resolve) plus `identityUnresolved: true` on that same failure, so a
// downstream join can never mistake an unresolved record for a resolved one
// or for "this collector never resolves identity at all". Each test asserts
// `'backendNodeId' in el` (key presence), not just its value, since a
// missing key and an explicit `null` both read as `undefined` after
// `JSON.parse` — only the `in` check distinguishes them.
// ============================================================================

test('collectPixels emits backendNodeId:null + identityUnresolved:true (never an omitted key) when DOM.describeNode throws', async () => {
  const dir = makeSnapDir('identity-throws');
  try {
    const client = new StubCdpClient({
      nodeIds: [42],
      nodes: { 42: { nodeName: 'DIV', throwsOnDescribeNode: true } },
    });
    const ctx = makeCtx(dir, client as unknown as CDPClient);

    await collectPixels(ctx);

    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;
    assert.equal(pixelsJson.elements.length, 1, 'the element is still emitted — an identity failure never drops the element');
    const el = pixelsJson.elements[0];

    // The key itself must always be present, whether or not identity resolved.
    assert.ok('backendNodeId' in el, 'backendNodeId key must be present, never silently omitted, on identity-resolution failure');
    assert.equal(el.backendNodeId, null, 'backendNodeId is explicitly null on a DOM.describeNode throw, not omitted and not a stale value');
    assert.equal(el.identityUnresolved, true, 'identityUnresolved must be set so a downstream join can never mistake this for a resolved record');

    // The crop/rect/facts are still valid — identity failure is best-effort
    // only for identity, never a reason to drop the whole element (matches
    // the pre-existing selector-failure contract).
    assert.deepEqual(el.rect, ELEMENT_RECT);
    assert.equal(fs.existsSync(path.join(dir, el.crop.slice('snap-test/'.length))), true, 'crop file still written despite the identity failure');
  } finally {
    removeArtifactTree(dir);
  }
});

test('collectPixels emits backendNodeId:null + identityUnresolved:true when DOM.describeNode resolves without a backendNodeId', async () => {
  const dir = makeSnapDir('identity-omitted');
  try {
    const client = new StubCdpClient({
      nodeIds: [7],
      nodes: { 7: { nodeName: 'SPAN', omitsBackendNodeId: true } },
    });
    const ctx = makeCtx(dir, client as unknown as CDPClient);

    await collectPixels(ctx);

    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;
    const el = pixelsJson.elements[0];

    assert.ok('backendNodeId' in el, 'backendNodeId key must be present even when DOM.describeNode omitted it without throwing');
    assert.equal(el.backendNodeId, null);
    assert.equal(el.identityUnresolved, true);
  } finally {
    removeArtifactTree(dir);
  }
});

test('collectPixels never sets identityUnresolved when identity genuinely resolves', async () => {
  const dir = makeSnapDir('identity-resolved');
  try {
    const client = new StubCdpClient({
      nodeIds: [42],
      nodes: { 42: { nodeName: 'DIV', backendNodeId: 4242 } },
    });
    const ctx = makeCtx(dir, client as unknown as CDPClient);

    await collectPixels(ctx);

    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;
    const el = pixelsJson.elements[0];

    assert.equal(el.backendNodeId, 4242);
    assert.equal('identityUnresolved' in el, false, 'identityUnresolved must be ABSENT (not false) on the healthy path');
  } finally {
    removeArtifactTree(dir);
  }
});

test('collectPixels always restores the background override, even after screenshots', async () => {
  const dir = makeSnapDir('restore');
  try {
    const client = new StubCdpClient({ nodeIds: [], nodes: {} });
    const ctx = makeCtx(dir, client as unknown as CDPClient);

    await collectPixels(ctx);

    const overrideCalls = client.calls.filter((c) => c.method === 'Emulation.setDefaultBackgroundColorOverride');
    assert.equal(overrideCalls.length, 2, 'sets transparent, then clears it');
    assert.ok('color' in (overrideCalls[0].params ?? {}), 'first call forces transparent');
    assert.ok(!('color' in (overrideCalls[1].params ?? {})), 'second call clears the override');

    // Factual restore result + scope fact on the success path.
    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;
    assert.equal(pixelsJson.backgroundOverrideRestored, true);
    assert.equal(pixelsJson.captureFailed, false, 'no capture failure on the happy path');
    // C: explicit factual enumeration scope (top-document / light-DOM only).
    assert.deepEqual(pixelsJson.scope, {
      enumeration: 'top-document-light-dom',
      pierce: false,
      includesIframeContent: false,
      includesShadowDom: false,
    });
  } finally {
    removeArtifactTree(dir);
  }
});

test('collectPixels restores the override AND emits the restoration fact even when the transparent screenshot throws', async () => {
  const dir = makeSnapDir('restore-fail');
  try {
    // The FIRST (normal-background) screenshot succeeds; the SECOND
    // (transparent-background) screenshot throws — the exact failure the
    // finally-only path swallowed by never emitting pixels.json.
    const client = new StubCdpClient({ nodeIds: [], nodes: {}, screenshotError: 'transparent' });
    const ctx = makeCtx(dir, client as unknown as CDPClient);

    // The failure propagates — the collector does not swallow it.
    await assert.rejects(() => collectPixels(ctx), /injected transparent-background screenshot failure/);

    // The override was still restored: forced transparent, then cleared, in
    // the failure path. If the catch dropped the restore this would be 1.
    const overrideCalls = client.calls.filter((c) => c.method === 'Emulation.setDefaultBackgroundColorOverride');
    assert.equal(overrideCalls.length, 2, 'override forced transparent, then cleared even on failure');
    assert.ok('color' in (overrideCalls[0].params ?? {}), 'first call forces transparent');
    assert.ok(!('color' in (overrideCalls[1].params ?? {})), 'second call clears the override in the failure path');

    // The restoration fact was emitted to pixels.json BEFORE the throw
    // propagated — the finally-only path never wrote this file at all, so a
    // regression to that shape makes readFileSync below throw ENOENT.
    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;
    assert.equal(pixelsJson.backgroundOverrideRestored, true, 'restoration fact recorded despite the screenshot failure');
    assert.equal(pixelsJson.captureFailed, true, 'capture failure recorded as a fact');
    assert.deepEqual(pixelsJson.elements, [], 'no per-element crops when the capture failed');
    assert.equal(pixelsJson.scope.enumeration, 'top-document-light-dom', 'scope fact present even on the failure path');
  } finally {
    removeArtifactTree(dir);
  }
});

// ============================================================================
// D6 — off-quad masking. A generic full-page fixture builder: `colorAt` is
// called per PNG pixel and returns the [r,g,b,a] to paint there.
// ============================================================================

function buildPng(width: number, height: number, colorAt: (x: number, y: number) => [number, number, number, number]): string {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const [r, g, b, a] = colorAt(x, y);
      png.data[o] = r;
      png.data[o + 1] = g;
      png.data[o + 2] = b;
      png.data[o + 3] = a;
    }
  }
  return PNG.sync.write(png).toString('base64');
}

test('collectPixels masks off-quad pixels out of the crop and every derived fact (disjoint quads)', async () => {
  const dir = makeSnapDir('mask-disjoint');
  try {
    // Two disjoint red bars inside a 20x10 bounding box, with a 4px green gap
    // (cols 8-11) between them that belongs to NEITHER quad.
    const quadA = [10, 10, 18, 10, 18, 20, 10, 20];
    const quadB = [22, 10, 30, 10, 30, 20, 22, 20];
    const inQuad = (x: number, y: number) =>
      y >= 10 && y < 20 && ((x >= 10 && x < 18) || (x >= 22 && x < 30));

    const normal = buildPng(VIEWPORT_W, VIEWPORT_H, (x, y) =>
      inQuad(x, y) ? [255, 0, 0, 255] : [0, 255, 0, 255],
    );
    const transparent = buildPng(VIEWPORT_W, VIEWPORT_H, (x, y) =>
      inQuad(x, y) ? [255, 0, 0, 255] : [0, 0, 0, 0],
    );

    const client = new StubCdpClient({
      nodeIds: [5],
      nodes: { 5: { nodeName: 'DIV', backendNodeId: 55, quads: [quadA, quadB] } },
      normalPngBase64: normal,
      transparentPngBase64: transparent,
    });

    await collectPixels(makeCtx(dir, client as unknown as CDPClient));

    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;
    assert.equal(pixelsJson.elements.length, 1);
    const el = pixelsJson.elements[0];

    // 160 of the 200 bounding-box pixels fall inside a quad (2 x 8x10 bars).
    assert.equal(el.maskedPixelFraction, 0.8);
    // The green gap is masked out: color/hash/alpha see ONLY the red quads.
    assert.deepEqual(el.avgColor, { r: 255, g: 0, b: 0 });
    assert.deepEqual(el.medianColor, { r: 255, g: 0, b: 0 });
    assert.deepEqual(el.dominantColor, { r: 255, g: 0, b: 0 });
    assert.equal(el.alphaFraction, 1);
    assert.equal(el.visiblePixelFraction, 1);

    // The written crop zeroes off-mask pixels to transparent; on-mask stay red.
    const cropAbsPath = path.join(dir, el.crop.slice('snap-test/'.length));
    const decoded = PNG.sync.read(fs.readFileSync(cropAbsPath));
    assert.equal(decoded.width, 20);
    assert.equal(decoded.height, 10);
    const pixelAt = (col: number, row: number) => {
      const o = (row * decoded.width + col) * 4;
      return [decoded.data[o], decoded.data[o + 1], decoded.data[o + 2], decoded.data[o + 3]];
    };
    assert.deepEqual(pixelAt(0, 0), [255, 0, 0, 255], 'inside quad A -> red');
    assert.deepEqual(pixelAt(14, 0), [255, 0, 0, 255], 'inside quad B -> red');
    assert.deepEqual(pixelAt(9, 0), [0, 0, 0, 0], 'gap between quads -> transparent');
  } finally {
    removeArtifactTree(dir);
  }
});

test('collectPixels intersects the mask with an ancestor overflow-clip rect (contamination excluded)', async () => {
  const dir = makeSnapDir('ancestor-clip');
  try {
    // The element's own content quad is the FULL 20x10 rect (x10..30,y10..20) —
    // exactly what an unclipped `DOM.getContentQuads` call would report even
    // though an `overflow:hidden` ancestor only lets the LEFT half (x10..20)
    // actually paint. The right half (x20..30), inside the quad but outside
    // the ancestor clip, is rendered as a contrasting BLUE — standing in for
    // whatever paints through where the browser refuses to paint this
    // element (background/ancestor/sibling), never this element's own color.
    // A mask that only tests quad membership (the pre-fix behavior) would
    // include those blue pixels in every derived fact; the fix must exclude
    // them by intersecting with the ancestor clip BEFORE masking.
    const inQuad = (x: number, y: number) => y >= 10 && y < 20 && x >= 10 && x < 30;
    const inVisibleClip = (x: number, y: number) => y >= 10 && y < 20 && x >= 10 && x < 20;
    const normal = buildPng(VIEWPORT_W, VIEWPORT_H, (x, y) => {
      if (inVisibleClip(x, y)) return [255, 0, 0, 255];
      if (inQuad(x, y)) return [0, 0, 255, 255];
      return [255, 255, 255, 255];
    });
    const transparent = buildPng(VIEWPORT_W, VIEWPORT_H, (x, y) => (inVisibleClip(x, y) ? [255, 0, 0, 255] : [0, 0, 0, 0]));

    const client = new StubCdpClient({
      nodeIds: [42],
      nodes: { 42: { nodeName: 'DIV', backendNodeId: 4242, attributes: [] } },
      normalPngBase64: normal,
      transparentPngBase64: transparent,
      // The ancestor clip rect an `overflow:hidden` container of width 10
      // (x0..20 in this viewport) would report for this element.
      clipRects: { 42: rectClip({ x: 0, y: 0, width: 20, height: 50 }) },
    });

    await collectPixels(makeCtx(dir, client as unknown as CDPClient));

    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;
    assert.equal(pixelsJson.elements.length, 1);
    const el = pixelsJson.elements[0] as PixelsJson['elements'][number] & { ancestorClipped: boolean };

    // The emitted rect is the CLIPPED rect (x10,y10,w10,h10), not the
    // element's own unclipped 20x10 quad union.
    assert.deepEqual(el.rect, { x: 10, y: 10, width: 10, height: 10 });
    assert.equal(el.ancestorClipped, true);

    // Every derived fact reflects ONLY the visible (red) region — the blue
    // clipped-away contamination never entered the mask.
    assert.deepEqual(el.avgColor, { r: 255, g: 0, b: 0 });
    assert.deepEqual(el.medianColor, { r: 255, g: 0, b: 0 });
    assert.deepEqual(el.dominantColor, { r: 255, g: 0, b: 0 });
    assert.equal(el.alphaFraction, 1, 'on-mask pixels are all fully opaque red, not blended with the clipped-away transparent half');
    assert.equal(el.visiblePixelFraction, 1);

    // The crop itself is sized to the clipped rect, not the unclipped quad.
    const cropAbsPath = path.join(dir, el.crop.slice('snap-test/'.length));
    const decoded = PNG.sync.read(fs.readFileSync(cropAbsPath));
    assert.equal(decoded.width, 10);
    assert.equal(decoded.height, 10);
    for (let i = 0; i < decoded.width * decoded.height; i += 1) {
      const o = i * 4;
      assert.deepEqual(
        [decoded.data[o], decoded.data[o + 1], decoded.data[o + 2], decoded.data[o + 3]],
        [255, 0, 0, 255],
        `crop pixel ${i} should be the visible red content, never the clipped-away blue`,
      );
    }
  } finally {
    removeArtifactTree(dir);
  }
});

test('collectPixels leaves the rect/mask unchanged when the ancestor-clip lookup reports no clip', async () => {
  const dir = makeSnapDir('ancestor-clip-none');
  try {
    const client = new StubCdpClient({
      nodeIds: [42],
      nodes: { 42: { nodeName: 'DIV', backendNodeId: 4242, attributes: [] } },
      clipRects: { 42: rectClip(null) },
    });
    await collectPixels(makeCtx(dir, client as unknown as CDPClient));

    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;
    const el = pixelsJson.elements[0] as PixelsJson['elements'][number] & { ancestorClipped: boolean };
    assert.deepEqual(el.rect, ELEMENT_RECT);
    assert.equal(el.ancestorClipped, false);
    // Positive control (I-5): a walk that genuinely ran and found nothing to
    // clip must NEVER be marked unavailable -- the key itself must be
    // absent, not merely falsy, so a downstream consumer can distinguish
    // "read failed" from "read succeeded, no clip".
    assert.equal('ancestorClipUnavailable' in el, false, 'ancestorClipUnavailable must be ABSENT on a genuine no-clip success');
    assert.equal('ancestorClipUnavailableReason' in el, false, 'ancestorClipUnavailableReason must be ABSENT on a genuine no-clip success');
  } finally {
    removeArtifactTree(dir);
  }
});

// ============================================================================
// I-5 -- ancestor-clip read-failure honesty (findings #2-4). A genuine
// `DOM.resolveNode`/`Runtime.callFunctionOn` failure during the ancestor-clip
// walk must never be coerced into the same `{rect:null,shapes:[],
// approximate:false}` shape a genuine "no ancestor clips this element"
// result produces -- see `computeAncestorClip`'s doc comment. Each test
// asserts the element is still emitted (a clip-read failure is best-effort
// only for clip info, never a reason to drop the element), the rect is left
// unchanged (never fabricated), `ancestorClipped` stays false (never
// fabricated true), and the explicit unavailable marker + reason are set.
// ============================================================================

test('collectPixels marks ancestorClipUnavailable with reason resolve-node-no-object-id when DOM.resolveNode resolves without an objectId', async () => {
  const dir = makeSnapDir('ancestor-clip-resolve-no-objectid');
  try {
    const client = new StubCdpClient({
      nodeIds: [42],
      nodes: { 42: { nodeName: 'DIV', backendNodeId: 4242, attributes: [], clipResolveNodeOmitsObjectId: true } },
    });
    await collectPixels(makeCtx(dir, client as unknown as CDPClient));

    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;
    assert.equal(pixelsJson.elements.length, 1, 'the element is still emitted -- an ancestor-clip read failure never drops the element');
    const el = pixelsJson.elements[0] as PixelsJson['elements'][number] & { ancestorClipped: boolean };

    assert.equal(el.ancestorClipUnavailable, true);
    assert.equal(el.ancestorClipUnavailableReason, 'resolve-node-no-object-id');
    assert.deepEqual(el.rect, ELEMENT_RECT, 'rect is left as the elements own unclipped rect, never fabricated');
    assert.equal(el.ancestorClipped, false, 'ancestorClipped must never be fabricated true on a read failure');
  } finally {
    removeArtifactTree(dir);
  }
});

test('collectPixels marks ancestorClipUnavailable with reason resolve-or-call-threw when DOM.resolveNode throws', async () => {
  const dir = makeSnapDir('ancestor-clip-resolve-throws');
  try {
    const client = new StubCdpClient({
      nodeIds: [42],
      nodes: { 42: { nodeName: 'DIV', backendNodeId: 4242, attributes: [], clipResolveNodeThrows: true } },
    });
    await collectPixels(makeCtx(dir, client as unknown as CDPClient));

    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;
    assert.equal(pixelsJson.elements.length, 1, 'the element is still emitted -- an ancestor-clip read failure never drops the element');
    const el = pixelsJson.elements[0] as PixelsJson['elements'][number] & { ancestorClipped: boolean };

    assert.equal(el.ancestorClipUnavailable, true);
    assert.equal(el.ancestorClipUnavailableReason, 'resolve-or-call-threw');
    assert.deepEqual(el.rect, ELEMENT_RECT, 'rect is left as the elements own unclipped rect, never fabricated');
    assert.equal(el.ancestorClipped, false, 'ancestorClipped must never be fabricated true on a read failure');
  } finally {
    removeArtifactTree(dir);
  }
});

test('collectPixels marks ancestorClipUnavailable with reason call-function-no-value when Runtime.callFunctionOn resolves without a value', async () => {
  const dir = makeSnapDir('ancestor-clip-call-no-value');
  try {
    const client = new StubCdpClient({
      nodeIds: [42],
      nodes: { 42: { nodeName: 'DIV', backendNodeId: 4242, attributes: [], clipCallFunctionOmitsValue: true } },
    });
    await collectPixels(makeCtx(dir, client as unknown as CDPClient));

    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;
    assert.equal(pixelsJson.elements.length, 1, 'the element is still emitted -- an ancestor-clip read failure never drops the element');
    const el = pixelsJson.elements[0] as PixelsJson['elements'][number] & { ancestorClipped: boolean };

    assert.equal(el.ancestorClipUnavailable, true);
    assert.equal(el.ancestorClipUnavailableReason, 'call-function-no-value');
    assert.deepEqual(el.rect, ELEMENT_RECT, 'rect is left as the elements own unclipped rect, never fabricated');
    assert.equal(el.ancestorClipped, false, 'ancestorClipped must never be fabricated true on a read failure');
  } finally {
    removeArtifactTree(dir);
  }
});

test('collectPixels marks ancestorClipUnavailable with reason resolve-or-call-threw when Runtime.callFunctionOn throws', async () => {
  const dir = makeSnapDir('ancestor-clip-call-throws');
  try {
    const client = new StubCdpClient({
      nodeIds: [42],
      nodes: { 42: { nodeName: 'DIV', backendNodeId: 4242, attributes: [], clipCallFunctionThrows: true } },
    });
    await collectPixels(makeCtx(dir, client as unknown as CDPClient));

    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;
    assert.equal(pixelsJson.elements.length, 1, 'the element is still emitted -- an ancestor-clip read failure never drops the element');
    const el = pixelsJson.elements[0] as PixelsJson['elements'][number] & { ancestorClipped: boolean };

    assert.equal(el.ancestorClipUnavailable, true);
    assert.equal(el.ancestorClipUnavailableReason, 'resolve-or-call-threw');
    assert.deepEqual(el.rect, ELEMENT_RECT, 'rect is left as the elements own unclipped rect, never fabricated');
    assert.equal(el.ancestorClipped, false, 'ancestorClipped must never be fabricated true on a read failure');
  } finally {
    removeArtifactTree(dir);
  }
});

test('collectPixels honors the viewport->screenshot scale on a 2x DPR page', async () => {
  const dir = makeSnapDir('dpr');
  try {
    // 100x50 CSS viewport rendered into a 200x100 screenshot (devicePixelRatio 2).
    const PNG_W = 200;
    const PNG_H = 100;
    // Same CSS element rect x=10,y=10,w=20,h=10 -> PNG pixels x=20..60, y=20..40.
    const inElement = (x: number, y: number) => x >= 20 && x < 60 && y >= 20 && y < 40;
    const normal = buildPng(PNG_W, PNG_H, (x, y) => (inElement(x, y) ? [255, 0, 0, 255] : [255, 255, 255, 255]));
    const transparent = buildPng(PNG_W, PNG_H, (x, y) => (inElement(x, y) ? [255, 0, 0, 255] : [0, 0, 0, 0]));

    const client = new StubCdpClient({
      nodeIds: [9],
      nodes: { 9: { nodeName: 'DIV', backendNodeId: 99, quad: ELEMENT_QUAD } },
      normalPngBase64: normal,
      transparentPngBase64: transparent,
      viewport: { w: VIEWPORT_W, h: VIEWPORT_H },
    });

    await collectPixels(makeCtx(dir, client as unknown as CDPClient));

    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;
    const el = pixelsJson.elements[0];
    // rect stays in CSS space; the CROP is in screenshot pixels -> doubled.
    assert.deepEqual(el.rect, ELEMENT_RECT);
    const cropAbsPath = path.join(dir, el.crop.slice('snap-test/'.length));
    const decoded = PNG.sync.read(fs.readFileSync(cropAbsPath));
    assert.equal(decoded.width, ELEMENT_RECT.width * 2, 'crop width scaled by DPR');
    assert.equal(decoded.height, ELEMENT_RECT.height * 2, 'crop height scaled by DPR');
    assert.equal(el.maskedPixelFraction, 1, 'axis-aligned rect fully covers its bounding box');
    assert.deepEqual(el.avgColor, { r: 255, g: 0, b: 0 });
    assert.equal(el.alphaFraction, 1);
  } finally {
    removeArtifactTree(dir);
  }
});

// ============================================================================
// I-5/I-4 — viewport-scale read honesty. `scaleX`/`scaleY` (derived from
// `window.innerWidth`/`innerHeight`) are the SCALE BASIS for every element's
// crop-geometry/color measurement. When the page-side viewport read resolves
// without a usable `{w,h}` value, the collector still needs SOME scale to
// keep producing crops — but silently substituting the screenshot's own
// pixel dimensions and presenting the resulting scale as exact would
// fabricate a devicePixelRatio-1 assumption with no signal it ever happened.
// These tests prove `pixels.json` now carries an explicit `viewportScale`
// availability fact rather than silently reusing the fallback as if measured.
// ============================================================================

test('collectPixels marks viewportScale unavailable (never a silent substitution) when the page-side viewport read returns no usable value', async () => {
  const dir = makeSnapDir('viewport-unavailable');
  try {
    const client = new StubCdpClient({
      nodeIds: [9],
      nodes: { 9: { nodeName: 'DIV', backendNodeId: 99, quad: ELEMENT_QUAD } },
      // Forces the EXACT adversarial path: `Runtime.evaluate` resolves but
      // with no `{w,h}` value at all — the real-world shape of a page whose
      // `window.innerWidth`/`innerHeight` read comes back empty, not a
      // thrown/rejected call.
      viewportUnavailable: true,
    });

    await collectPixels(makeCtx(dir, client as unknown as CDPClient));

    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;

    // The capture itself still succeeds — crops are still produced on a
    // best-effort scale basis — but that basis must be marked unavailable,
    // never presented as a resolved, exact CSS viewport size.
    assert.equal(pixelsJson.captureFailed, false, 'a missing viewport read is not a capture failure — crops still produced');
    assert.equal(pixelsJson.elements.length, 1, 'the element is still emitted on the fallback scale basis');

    assert.ok(pixelsJson.viewportScale, 'pixels.json must carry a viewportScale fact');
    assert.equal(pixelsJson.viewportScale!.available, false, 'the fallback scale basis must be marked unavailable, not silently exact');
    assert.equal(
      pixelsJson.viewportScale!.unavailableReason,
      'viewport-read-unavailable',
      'a fixed, factual reason must accompany the unavailable flag',
    );
    // The fallback values (screenshot pixel dims as the CSS size stand-in,
    // scale 1:1) are still reported — approximate, but not hidden.
    assert.equal(pixelsJson.viewportScale!.innerWidth, VIEWPORT_W);
    assert.equal(pixelsJson.viewportScale!.innerHeight, VIEWPORT_H);
    assert.equal(pixelsJson.viewportScale!.scaleX, 1);
    assert.equal(pixelsJson.viewportScale!.scaleY, 1);
  } finally {
    removeArtifactTree(dir);
  }
});

test('collectPixels marks viewportScale available (no unavailableReason) when the page-side viewport read succeeds', async () => {
  const dir = makeSnapDir('viewport-available');
  try {
    // Positive control: the same DPR-2 fixture as the scale test above, but
    // asserting the NEW viewportScale fact rather than the derived crop size
    // — proves the happy path stays clean (no spurious unavailable flag)
    // when the read genuinely succeeds.
    const PNG_W = 200;
    const PNG_H = 100;
    const inElement = (x: number, y: number) => x >= 20 && x < 60 && y >= 20 && y < 40;
    const normal = buildPng(PNG_W, PNG_H, (x, y) => (inElement(x, y) ? [255, 0, 0, 255] : [255, 255, 255, 255]));
    const transparent = buildPng(PNG_W, PNG_H, (x, y) => (inElement(x, y) ? [255, 0, 0, 255] : [0, 0, 0, 0]));

    const client = new StubCdpClient({
      nodeIds: [9],
      nodes: { 9: { nodeName: 'DIV', backendNodeId: 99, quad: ELEMENT_QUAD } },
      normalPngBase64: normal,
      transparentPngBase64: transparent,
      viewport: { w: VIEWPORT_W, h: VIEWPORT_H },
    });

    await collectPixels(makeCtx(dir, client as unknown as CDPClient));

    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;

    assert.ok(pixelsJson.viewportScale, 'pixels.json must carry a viewportScale fact');
    assert.equal(pixelsJson.viewportScale!.available, true);
    assert.equal('unavailableReason' in pixelsJson.viewportScale!, false, 'unavailableReason must be ABSENT (not present/undefined) on the healthy path');
    assert.equal(pixelsJson.viewportScale!.innerWidth, VIEWPORT_W);
    assert.equal(pixelsJson.viewportScale!.innerHeight, VIEWPORT_H);
    assert.equal(pixelsJson.viewportScale!.scaleX, 2, 'real DPR-2 scale, genuinely measured');
    assert.equal(pixelsJson.viewportScale!.scaleY, 2);
  } finally {
    removeArtifactTree(dir);
  }
});

test('collectPixels preserves page-controlled IDs/classes in selectors and applies only filename safety to crop slugs', async () => {
  const dir = makeSnapDir('identity-evidence');
  try {
    const id = 'sk-abcdefghijklmnop1234';
    const className = `safe_token-${'z'.repeat(100)}`;
    const client = new StubCdpClient({
      nodeIds: [3],
      nodes: {
        3: {
          nodeName: 'DIV',
          backendNodeId: 33,
          attributes: ['id', id, 'class', `swatch ${className}`],
        },
      },
    });

    await collectPixels(makeCtx(dir, client as unknown as CDPClient));

    const pixelsJson = JSON.parse(fs.readFileSync(path.join(dir, 'pixels.json'), 'utf8')) as PixelsJson;
    const el = pixelsJson.elements[0];
    assert.equal(el.selector, `div#${id}.swatch.${className}`);

    // The slug replaces selector punctuation only; alphanumeric, underscore, and dash token characters survive verbatim before its structural cap.
    const cropName = path.basename(el.crop);
    const expectedSlug = `div-${id}-swatch-${className}`.slice(0, 80);
    const expectedCropName = `0-33-${expectedSlug}.png`;
    assert.equal(cropName, expectedCropName);
    assert.equal(expectedSlug.length, 80, 'the fixture activates the filename slug cap');

    const cropFiles = fs.readdirSync(path.join(dir, 'crops'));
    assert.deepEqual(cropFiles, [expectedCropName]);
  } finally {
    removeArtifactTree(dir);
  }
});

// ============================================================================
// D5 — REAL-Chrome masking + DPR. Unlike the stub-driven tests above (pure
// mask math over synthetic PNGs, only axis-aligned bars), this section
// spawns real headless Chrome, renders a fixture with a genuinely rotated
// (non-axis-aligned) quad, a disjoint multi-line-box inline element (two
// content quads with real off-quad gutter between/around them), and a plain
// axis-aligned element, all under a real 2x device-pixel-ratio capture. It
// then runs `collectPixels` end to end and proves on-mask metrics and
// off-mask transparency against genuinely rendered pixels — a StubCdpClient
// can't fake a rotation matrix, multi-quad line boxes, or a real DPR raster.
//
// One Chrome instance / one navigated tab is shared across the D5 blocks
// (spun up once in `before`, torn down once in `after`) — a launch is slow
// and the fixture is static.
// ============================================================================


// Rotated 80x80 red square (bbox ~113x113 -> corners off-mask); a disjoint
// inline span that wraps to two line boxes in a narrow monospace box (line 1
// full, line 2 short -> right of line 2 is inside the bbox but off both
// quads); and a plain axis-aligned blue 40x40 div (DPR proof). Distinct
// solid colors so on-mask vs background is unambiguous.
const D5_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;background:rgb(255,255,255);">
<div id="rot" style="position:absolute;top:60px;left:80px;width:80px;height:80px;background:rgb(220,20,20);transform:rotate(45deg);"></div>
<div style="position:absolute;top:260px;left:40px;width:100px;font:20px/24px monospace;">
  <span id="wrap" style="background:rgb(20,20,220);color:rgba(0,0,0,0);">AAAAAAAA BB</span>
</div>
<div id="plain" style="position:absolute;top:360px;left:40px;width:40px;height:40px;background:rgb(0,0,255);"></div>
<div id="clipParent" style="position:absolute;top:460px;left:40px;width:60px;height:40px;overflow:hidden;">
  <div id="clipChild" style="position:absolute;top:0;left:0;width:120px;height:40px;background:linear-gradient(to right, rgb(0,200,0) 50%, rgb(200,0,200) 50%);"></div>
</div>
<div id="clipPathParent" style="position:absolute;top:520px;left:40px;width:120px;height:40px;clip-path:inset(0 60px 0 0);">
  <div id="clipPathChild" style="position:absolute;top:0;left:0;width:120px;height:40px;background:linear-gradient(to right, rgb(0,200,0) 50%, rgb(200,0,200) 50%);"></div>
</div>
<div id="clipCircleParent" style="position:absolute;top:600px;left:40px;width:80px;height:80px;clip-path:circle(40px at 40px 40px);">
  <div id="clipCircleChild" style="position:absolute;top:0;left:0;width:80px;height:80px;background:rgb(255,140,0);"></div>
</div>
<div id="clipPolyParent" style="position:absolute;top:700px;left:40px;width:100px;height:60px;clip-path:polygon(0 0, 100% 0, 0 100%);">
  <div id="clipPolyChild" style="position:absolute;top:0;left:0;width:100px;height:60px;background:rgb(0,180,0);"></div>
</div>
<div id="clipPathFuncParent" style="position:absolute;top:780px;left:40px;width:60px;height:40px;clip-path:path('M0 0 L60 0 L60 40 L0 40 Z');">
  <div id="clipPathFuncChild" style="position:absolute;top:0;left:0;width:60px;height:40px;background:rgb(0,150,150);"></div>
</div>
<div id="clipCalcParent" style="position:absolute;top:860px;left:40px;width:100px;height:100px;clip-path:circle(20px at right 30px bottom 30px);">
  <div id="clipCalcChild" style="position:absolute;top:0;left:0;width:100px;height:100px;background:rgb(0,120,255);"></div>
</div>
<div id="clipUrlParent" style="position:absolute;top:980px;left:40px;width:100px;height:100px;clip-path:url('#circle(20px at 50px 50px)');">
  <div id="clipUrlChild" style="position:absolute;top:0;left:0;width:100px;height:100px;background:rgb(255,0,120);"></div>
</div>
<div id="clipEdgeOrderParent" style="position:absolute;top:1100px;left:40px;width:100px;height:100px;clip-path:circle(20px at bottom 30px right 30px);">
  <div id="clipEdgeOrderChild" style="position:absolute;top:0;left:0;width:100px;height:100px;background:rgb(0,120,255);"></div>
</div>
<div id="clipCalcOffsetParent" style="position:absolute;top:1220px;left:40px;width:100px;height:100px;clip-path:ellipse(20px 10px at left calc(10px + 20px) top calc(10px + 20px));">
  <div id="clipCalcOffsetChild" style="position:absolute;top:0;left:0;width:100px;height:100px;background:rgb(0,120,255);"></div>
</div>
<div id="marker"></div>
</body></html>`;

const D5_FIXTURE_URL = `data:text/html,${encodeURIComponent(D5_FIXTURE_HTML)}`;

/** Spawns headless Chrome on a randomized port, retrying with a fresh port a few times in case of collision. */

async function newPageTarget(port: number): Promise<string> {
  const resp = await fetch(`http://localhost:${port}/json/new?about:blank`, { method: 'PUT' });
  const json = (await resp.json()) as { webSocketDebuggerUrl?: string };
  if (!json.webSocketDebuggerUrl) throw new Error('no webSocketDebuggerUrl in /json/new response');
  return json.webSocketDebuggerUrl;
}

async function waitForFixtureReady(c: CDPClient, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await c.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && document.getElementById('marker') !== null`,
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (res.result?.value) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('D5 fixture page did not reach readyState=complete in time');
}

/** In-memory writer: JSON kept as objects, crop binaries kept as Buffers, keyed by the collector's own filename. */
function makeInMemoryWriter(store: Record<string, unknown>): SnapshotWriter {
  return {
    json(filename, value) {
      store[filename] = value;
    },
    binary(filename, data) {
      store[filename] = data;
    },
  };
}

const D5_SNAP_ID = 'px-d5';
const D5_DPR = 2;
let d5Chrome: ChildProcess | undefined;
let d5Fixture: ChromeFixture | undefined;
let d5Client: CDPClient | undefined;
let d5Pixels: PixelsJson;
let d5Store: Record<string, unknown>;

/** Decodes the crop PNG for an element record from the in-memory store (crop path is `${snapId}/<filename>`). */
function decodeCropFor(el: PixelsJson['elements'][number]): PNG {
  const filename = el.crop.slice(`${D5_SNAP_ID}/`.length);
  const buf = d5Store[filename];
  assert.ok(Buffer.isBuffer(buf), `crop buffer present for ${el.selector}`);
  return PNG.sync.read(buf as Buffer);
}

function alphaAt(png: PNG, x: number, y: number): number {
  return png.data[(y * png.width + x) * 4 + 3];
}

describe('D5 real-Chrome pixel collection', () => {
before(async () => {
  if (!LIVE_CHROME) return; // D5 real-Chrome tests below are gated with liveChromeOpts
  d5Fixture = await spawnHeadlessChrome();
  const { proc, port } = d5Fixture;
  d5Chrome = proc;

  const wsUrl = await newPageTarget(port);
  d5Client = new CDPClient(wsUrl);
  await d5Client.waitReady();
  await enableDomainsForSnap(d5Client);
  // Real 2x device-pixel-ratio: a 400x1500 CSS viewport rasterized into an
  // 800x3000 screenshot (tall enough to keep the last fixture element,
  // `#clipCalcOffsetParent` at top:1220/height:100, fully visible).
  // `collectPixels` reads window.innerWidth (400 CSS) and divides the
  // screenshot width by it, so scaleX/scaleY resolve to 2.
  await d5Client.send('Emulation.setDeviceMetricsOverride', {
    width: 400,
    height: 1500,
    deviceScaleFactor: D5_DPR,
    mobile: false,
  });
  await d5Client.send('Page.navigate', { url: D5_FIXTURE_URL });
  await waitForFixtureReady(d5Client);

  d5Store = {};
  const ctx: SnapshotContext = {
    client: d5Client,
    dir: '/tmp/px-d5-real-chrome-unused',
    snapId: D5_SNAP_ID,
    url: D5_FIXTURE_URL,
    viewport: '400x1500',
    settled: true,
    freezeAnimations: false,
    captureUnsettled: false,
    pixels: true,
    state: [],
    unstableRegions: [],
    write: makeInMemoryWriter(d5Store),
  };
  await collectPixels(ctx);
  d5Pixels = d5Store['pixels.json'] as PixelsJson;
}, { timeout: 30000 });

after(async () => {
  try {
    d5Client?.close();
  } catch {
    // already closed
  }
  await d5Fixture?.close();
});

test('D5 real-Chrome: pixels.json carries the scope fact and a clean success capture', liveChromeOpts, () => {
  assert.deepEqual(d5Pixels.scope, {
    enumeration: 'top-document-light-dom',
    pierce: false,
    includesIframeContent: false,
    includesShadowDom: false,
  });
  assert.equal(d5Pixels.captureFailed, false);
  assert.equal(d5Pixels.backgroundOverrideRestored, true);
  assert.ok(d5Pixels.elements.length > 0);
});

test('D5 real-Chrome: rotated (non-axis-aligned) quad masks off-mask pixels and keeps facts on-mask', liveChromeOpts, () => {
  const rot = d5Pixels.elements.find((e) => e.selector === 'div#rot');
  assert.ok(rot, 'rotated element present');

  // A 45deg-rotated square: its axis-aligned bbox is strictly larger than
  // the rotated quad, so a real chunk of the crop is off-mask. If masking
  // were disabled (bbox == mask), this fraction would be ~1.
  assert.ok(rot!.maskedPixelFraction < 0.85, `rotated mask fraction should be well under 1, got ${rot!.maskedPixelFraction}`);
  assert.ok(rot!.maskedPixelFraction > 0.2, `rotated mask fraction sanity floor, got ${rot!.maskedPixelFraction}`);

  // On-mask facts see the red fill, not the white background. If off-mask
  // white leaked in, r/g/b would converge; the strong r-vs-g/b gap proves
  // the background was excluded.
  assert.ok(rot!.avgColor.r > 150, `on-mask red channel high, got ${JSON.stringify(rot!.avgColor)}`);
  assert.ok(rot!.avgColor.r > rot!.avgColor.g + 60, 'on-mask avg is red-dominant vs green');
  assert.ok(rot!.avgColor.r > rot!.avgColor.b + 60, 'on-mask avg is red-dominant vs blue');

  // In the transparent-background capture the rotated div is fully opaque
  // on-mask; off-mask is alpha 0. On-mask alphaFraction ~1 proves off-mask
  // (alpha-0) pixels are excluded from the fraction — a broken mask would
  // pull this toward the ~0.5 mask/bbox ratio.
  assert.ok(rot!.alphaFraction > 0.9, `on-mask alpha fraction ~1, got ${rot!.alphaFraction}`);

  // The written crop zeroes off-mask pixels to transparent: the bbox
  // top-left corner is outside the rotated diamond -> alpha 0.
  const crop = decodeCropFor(rot!);
  assert.equal(alphaAt(crop, 0, 0), 0, 'bbox corner is off-mask and written transparent');
  // ...while a genuinely rendered pixel exists somewhere on-mask.
  let anyOpaque = false;
  for (let i = 3; i < crop.data.length; i += 4) {
    if (crop.data[i] > 0) {
      anyOpaque = true;
      break;
    }
  }
  assert.ok(anyOpaque, 'crop retains on-mask painted pixels');
});

test('D5 real-Chrome: disjoint multi-line-box inline element carves off-quad gutter out of the crop', liveChromeOpts, () => {
  const wrap = d5Pixels.elements.find((e) => e.selector === 'span#wrap');
  assert.ok(wrap, 'wrapped inline element present');

  // Two line boxes (full line 1, short line 2) => two content quads with a
  // real off-quad gutter to the right of line 2 inside the bbox. An
  // axis-aligned single quad would fill its bbox (fraction ~1); this is
  // meaningfully below 1 only because the disjoint quads were masked.
  assert.ok(wrap!.maskedPixelFraction < 0.9, `multi-quad mask fraction under 1, got ${wrap!.maskedPixelFraction}`);

  // The crop contains BOTH off-mask transparent pixels (the gutter) and
  // on-mask painted pixels (the line boxes) — proving genuine per-quad
  // masking rather than an all-or-nothing bbox.
  const crop = decodeCropFor(wrap!);
  let transparent = 0;
  let opaque = 0;
  for (let i = 3; i < crop.data.length; i += 4) {
    if (crop.data[i] === 0) transparent += 1;
    else opaque += 1;
  }
  assert.ok(transparent > 0, 'off-quad gutter written transparent');
  assert.ok(opaque > 0, 'line-box pixels retained on-mask');
});

test('D5 real-Chrome: plain element crop is scaled by the real 2x device-pixel-ratio', liveChromeOpts, () => {
  const plain = d5Pixels.elements.find((e) => e.selector === 'div#plain');
  assert.ok(plain, 'plain element present');

  // rect stays in CSS space (~40x40); the CROP is in real screenshot pixels
  // -> ~2x under deviceScaleFactor 2. Allow +/-2px for clamp floor/ceil.
  assert.ok(Math.abs(plain!.rect.width - 40) <= 1, `CSS rect width ~40, got ${plain!.rect.width}`);
  assert.ok(Math.abs(plain!.rect.height - 40) <= 1, `CSS rect height ~40, got ${plain!.rect.height}`);

  const crop = decodeCropFor(plain!);
  assert.ok(Math.abs(crop.width - plain!.rect.width * D5_DPR) <= 2, `crop width ~2x CSS, got ${crop.width} vs rect ${plain!.rect.width}`);
  assert.ok(Math.abs(crop.height - plain!.rect.height * D5_DPR) <= 2, `crop height ~2x CSS, got ${crop.height} vs rect ${plain!.rect.height}`);

  // Axis-aligned: mask fills the bbox, and the on-mask color is the blue fill.
  assert.ok(plain!.maskedPixelFraction > 0.95, `axis-aligned mask ~full, got ${plain!.maskedPixelFraction}`);
  assert.ok(plain!.avgColor.b > 150, `on-mask blue channel high, got ${JSON.stringify(plain!.avgColor)}`);
  assert.ok(plain!.avgColor.b > plain!.avgColor.r + 60, 'on-mask avg is blue-dominant');
});

test('D5 real-Chrome: overflow:hidden ancestor clips the child\'s pixel mask (green/magenta gradient truncated to the visible half)', liveChromeOpts, () => {
  // `#clipChild` is a 120x40 element (half green, half magenta) whose
  // `#clipParent` ancestor is only 60px wide with `overflow:hidden` — only
  // the left (green) half is ever actually painted; the right (magenta)
  // half never renders at all (that screen region shows the white page
  // background, since `#clipParent` itself has no background). A mask that
  // only tests `#clipChild`'s own (unclipped) content quad would include
  // that white-background region as if it were the element's own pixels.
  const clipChild = d5Pixels.elements.find((e) => e.selector === 'div#clipChild');
  assert.ok(clipChild, 'clipChild element present');

  // The emitted rect/crop is truncated to the visible (left) half: ~60 CSS
  // px wide, not the element's own unclipped 120px layout width.
  assert.ok(Math.abs(clipChild!.rect.width - 60) <= 2, `rect width should be clipped to ~60, got ${clipChild!.rect.width}`);
  assert.equal((clipChild as unknown as { ancestorClipped: boolean }).ancestorClipped, true);

  // Color proof: on-mask pixels are the pure green fill, not a green/white
  // (or green/magenta) blend. A broken (pre-fix) mask spanning the full
  // 120px would pull red/blue up from the white background showing through
  // the clipped-away half.
  assert.ok(clipChild!.avgColor.g > 150, `on-mask green channel high, got ${JSON.stringify(clipChild!.avgColor)}`);
  assert.ok(clipChild!.avgColor.r < 40, `on-mask red channel should be near-zero (pure green, no white/magenta blend), got ${JSON.stringify(clipChild!.avgColor)}`);
  assert.ok(clipChild!.avgColor.b < 40, `on-mask blue channel should be near-zero, got ${JSON.stringify(clipChild!.avgColor)}`);

  // Alpha proof (background-independent): in the transparent-background
  // capture, the clipped-away half never paints at all (alpha 0) while the
  // visible half is fully opaque. A mask spanning the full unclipped width
  // would blend those to ~0.5; a correctly clipped mask reads ~1.0.
  assert.ok(clipChild!.alphaFraction > 0.9, `on-mask alpha should be ~1 (clipped-away half excluded), got ${clipChild!.alphaFraction}`);
});

test('D5 real-Chrome: rectangular clip-path ancestor clips the child\'s pixel mask', liveChromeOpts, () => {
  // Same green/magenta gradient child, this time clipped by an ANCESTOR's
  // `clip-path: inset(0 60px 0 0)` (rather than `overflow:hidden`) — insets
  // the visible region to the same left 60px of the 120px-wide box.
  const clipPathChild = d5Pixels.elements.find((e) => e.selector === 'div#clipPathChild');
  assert.ok(clipPathChild, 'clipPathChild element present');

  assert.ok(Math.abs(clipPathChild!.rect.width - 60) <= 2, `rect width should be clipped to ~60, got ${clipPathChild!.rect.width}`);
  assert.equal((clipPathChild as unknown as { ancestorClipped: boolean }).ancestorClipped, true);

  assert.ok(clipPathChild!.avgColor.g > 150, `on-mask green channel high, got ${JSON.stringify(clipPathChild!.avgColor)}`);
  assert.ok(clipPathChild!.avgColor.r < 40, `on-mask red channel should be near-zero, got ${JSON.stringify(clipPathChild!.avgColor)}`);
  assert.ok(clipPathChild!.avgColor.b < 40, `on-mask blue channel should be near-zero, got ${JSON.stringify(clipPathChild!.avgColor)}`);
  assert.ok(clipPathChild!.alphaFraction > 0.9, `on-mask alpha should be ~1, got ${clipPathChild!.alphaFraction}`);
});

test('D5 real-Chrome: circular clip-path ancestor clips the child\'s pixel mask (non-rectangular shape, bbox unchanged)', liveChromeOpts, () => {
  // `#clipCircleChild` is a SOLID-orange 80x80 fill; its `#clipCircleParent`
  // ancestor clips it to `circle(40px at 40px 40px)` -- a disc INSCRIBED in
  // the ancestor's own 80x80 box (radius 40 exactly reaches all four edges
  // from the box's center), so the circle's own bounding box is IDENTICAL
  // to the ancestor's box -- the child's rect is completely UNCHANGED. This
  // is exactly the "ancestorClipped can even stay false" bug the re-review
  // flagged: a bounding-box-only approximation (the pre-fix behavior for
  // every non-inset clip-path) would report no clipping at all here, even
  // though the four corners of the box (~21% of its area) never actually
  // paint -- they show the white page background (or, in the transparent
  // capture, paint nothing at all).
  const el = d5Pixels.elements.find((e) => e.selector === 'div#clipCircleChild');
  assert.ok(el, 'clipCircleChild element present');

  assert.ok(Math.abs(el!.rect.width - 80) <= 2, `rect width unchanged by a circle inscribed in the box, got ${el!.rect.width}`);
  assert.ok(Math.abs(el!.rect.height - 80) <= 2, `rect height unchanged, got ${el!.rect.height}`);
  assert.equal(
    (el as unknown as { ancestorClipped: boolean }).ancestorClipped,
    true,
    'a real (non-rectangular) ancestor clip must be flagged even when the bbox does not shrink',
  );

  // Orange (255,140,0) vs the white (255,255,255) page background share the
  // same red channel, but blue is 0 in the true fill and 255 in white -- a
  // bbox-only mask (the unpainted corners bleeding in) drags avgColor.b and
  // alphaFraction away from the true on-disc values.
  assert.ok(el!.avgColor.b < 40, `on-mask blue channel should be near-zero (no white-background bleed), got ${JSON.stringify(el!.avgColor)}`);
  assert.ok(el!.alphaFraction > 0.9, `on-mask alpha should be ~1 (only the painted disc counted), got ${el!.alphaFraction}`);
});

test('D5 real-Chrome: polygon clip-path ancestor clips the child\'s pixel mask (non-rectangular shape, bbox unchanged)', liveChromeOpts, () => {
  // `#clipPolyChild` is a SOLID-green 100x60 fill; its `#clipPolyParent`
  // ancestor clips it to `polygon(0 0, 100% 0, 0 100%)` -- the box's own
  // upper-left triangular HALF. Every vertex sits on the box's own edges,
  // so the bounding box is UNCHANGED even though only ~50% of the area is
  // ever actually painted (the lower-right triangle never renders).
  const el = d5Pixels.elements.find((e) => e.selector === 'div#clipPolyChild');
  assert.ok(el, 'clipPolyChild element present');

  assert.ok(Math.abs(el!.rect.width - 100) <= 2, `rect width unchanged by the polygon's own bbox, got ${el!.rect.width}`);
  assert.ok(Math.abs(el!.rect.height - 60) <= 2, `rect height unchanged, got ${el!.rect.height}`);
  assert.equal(
    (el as unknown as { ancestorClipped: boolean }).ancestorClipped,
    true,
    'a triangular ancestor clip must be flagged even when the bbox does not shrink',
  );

  // Pure green (0,180,0) vs the white page background: a bbox-only mask
  // blends in the ~50% unpainted triangle, pulling r/b up from 0 toward
  // ~128 and alphaFraction down toward ~0.5.
  assert.ok(el!.avgColor.r < 40, `on-mask red channel should be near-zero (no white-background bleed), got ${JSON.stringify(el!.avgColor)}`);
  assert.ok(el!.avgColor.b < 40, `on-mask blue channel should be near-zero, got ${JSON.stringify(el!.avgColor)}`);
  assert.ok(el!.alphaFraction > 0.9, `on-mask alpha should be ~1 (only the painted triangle counted), got ${el!.alphaFraction}`);
});

test('D5 real-Chrome: path() ancestor clip-path is flagged honest/approximate instead of silently unmasked', liveChromeOpts, () => {
  // `#clipPathFuncChild`'s ancestor uses `clip-path: path('M0 0 L60 0 L60 40
  // L0 40 Z')` -- a shape this collector cannot resolve to exact per-pixel
  // geometry (an arbitrary SVG path). The mandatory contract for shapes we
  // can't mask precisely: never silently fall back to the full bounding box
  // as if nothing were clipped -- flag both facts honestly instead.
  const el = d5Pixels.elements.find((e) => e.selector === 'div#clipPathFuncChild');
  assert.ok(el, 'clipPathFuncChild element present');

  const record = el as unknown as { ancestorClipped: boolean; ancestorClipApproximate: boolean };
  assert.equal(record.ancestorClipped, true, 'an ancestor path() clip must be flagged, never silently treated as unclipped');
  assert.equal(
    record.ancestorClipApproximate,
    true,
    'path()/url() clip-path shapes cannot be masked precisely and must say so honestly rather than silently passing the full bbox',
  );
});

test('D5 real-Chrome: edge-offset circle() ancestor clip resolves the computed calc() position exactly (not approximate)', liveChromeOpts, () => {
  // `#clipCalcParent` is authored `clip-path: circle(20px at right 30px
  // bottom 30px)`. Chrome preserves this valid four-value CSS <position>
  // form in computed style. The parser must resolve each edge/offset pair,
  // not discard the vertical pair and invent a two-value position.
  // The 100x100 box places the circle's center at (70,70) -- 20px radius is
  // strictly inside all four edges (min distance 30px), so this is a real,
  // resolvable, non-approximate exact-shape clip whose bbox actually
  // shrinks the child's rect to the circle's own 40x40 bounding box.
  const el = d5Pixels.elements.find((e) => e.selector === 'div#clipCalcChild');
  assert.ok(el, 'clipCalcChild element present');

  const record = el as unknown as { ancestorClipped: boolean; ancestorClipApproximate: boolean };
  assert.equal(record.ancestorClipped, true, 'the calc()-computed circle must be flagged as an ancestor clip');
  assert.equal(
    record.ancestorClipApproximate,
    false,
    'a four-value edge-offset position is resolvable exactly, not approximate',
  );

  // The circle's bbox is 2*r = 40px square, centered on viewport (110,930).
  assert.ok(Math.abs(el!.rect.x - 90) <= 2, `rect x should be ~90, got ${el!.rect.x}`);
  assert.ok(Math.abs(el!.rect.y - 910) <= 2, `rect y should be ~910, got ${el!.rect.y}`);
  assert.ok(Math.abs(el!.rect.width - 40) <= 2, `rect width should shrink to the circle's ~40px bbox, got ${el!.rect.width}`);
  assert.ok(Math.abs(el!.rect.height - 40) <= 2, `rect height should shrink to the circle's ~40px bbox, got ${el!.rect.height}`);

  // #clipCalcChild is a solid blue (0,120,255) fill; the page background is
  // white. If the computed calc() position were mis-resolved (e.g. treated
  // as unresolvable/approximate and only bounded by the full 100x100 box,
  // or resolved to the WRONG center), on-mask facts would include white
  // background bleed, pulling r/g up and diluting b down from 255.
  assert.ok(el!.avgColor.r < 40, `on-mask red channel should be near-zero (no white bleed), got ${JSON.stringify(el!.avgColor)}`);
  assert.ok(el!.avgColor.b > 200, `on-mask blue channel should stay near 255 (no white bleed), got ${JSON.stringify(el!.avgColor)}`);
  assert.ok(el!.alphaFraction > 0.9, `on-mask alpha should be ~1 (only the painted disc counted), got ${el!.alphaFraction}`);
});

test('D5 real-Chrome: vertical-first four-value edge offsets resolve exactly', liveChromeOpts, () => {
  const el = d5Pixels.elements.find((e) => e.selector === 'div#clipEdgeOrderChild');
  assert.ok(el, 'clipEdgeOrderChild element present');
  const record = el as unknown as { ancestorClipApproximate: boolean };
  assert.equal(record.ancestorClipApproximate, false, 'bottom/right edge-offset pair order is exact');
  assert.ok(Math.abs(el!.rect.x - 90) <= 2, `rect x should be ~90, got ${el!.rect.x}`);
  assert.ok(Math.abs(el!.rect.y - 1150) <= 2, `rect y should be ~1150, got ${el!.rect.y}`);
  assert.ok(Math.abs(el!.rect.width - 40) <= 2, `rect width should be ~40, got ${el!.rect.width}`);
  assert.ok(Math.abs(el!.rect.height - 40) <= 2, `rect height should be ~40, got ${el!.rect.height}`);
});

test('D5 real-Chrome: calc() edge offsets resolve exactly', liveChromeOpts, () => {
  const el = d5Pixels.elements.find((e) => e.selector === 'div#clipCalcOffsetChild');
  assert.ok(el, 'clipCalcOffsetChild element present');
  const record = el as unknown as { ancestorClipApproximate: boolean };
  assert.equal(record.ancestorClipApproximate, false, 'calc() offsets are exact');
  assert.ok(Math.abs(el!.rect.x - 50) <= 2, `rect x should be ~50, got ${el!.rect.x}`);
  assert.ok(Math.abs(el!.rect.y - 1240) <= 2, `rect y should be ~1240, got ${el!.rect.y}`);
  assert.ok(Math.abs(el!.rect.width - 40) <= 2, `rect width should be ~40, got ${el!.rect.width}`);
  assert.ok(Math.abs(el!.rect.height - 20) <= 2, `rect height should be ~20, got ${el!.rect.height}`);
});

test('D5 real-Chrome: malformed three-token positions are approximate, never guessed exact', liveChromeOpts, async () => {
  // Browsers reject malformed CSS before it reaches computed style. Feed the
  // page-side collector the malformed value through a narrowly scoped
  // computed-style proxy so this regression proves its defensive parser path.
  await d5Client.send('Runtime.evaluate', {
    expression: `(() => {
      const malformed = [
        ['clipMalformedTokenChild', 'circle(20px at right 30px bottom)'],
        ['clipMalformedNumberChild', 'circle(20px at right 1..2px bottom 20px)'],
        ['clipMalformedCalcChild', 'circle(20px at right calc(10px +) bottom 20px)'],
      ];
      const clipPaths = new Map();
      for (const [childId, clipPath] of malformed) {
        const parent = document.createElement('div');
        parent.style.cssText = 'position:absolute;top:1340px;left:40px;width:100px;height:100px';
        const child = document.createElement('div');
        child.id = childId;
        child.style.cssText = 'position:absolute;inset:0;background:rgb(0,120,255)';
        parent.append(child);
        document.body.append(parent);
        clipPaths.set(parent, clipPath);
      }
      const nativeGetComputedStyle = window.getComputedStyle;
      window.getComputedStyle = function(node) {
        const style = nativeGetComputedStyle.call(window, node);
        const clipPath = clipPaths.get(node);
        if (!clipPath) return style;
        return new Proxy(style, { get(target, property) {
          return property === 'clipPath' ? clipPath : Reflect.get(target, property);
        }});
      };
    })()`,
    returnByValue: true,
  });
  const store: Record<string, unknown> = {};
  await collectPixels({
    client: d5Client,
    dir: '/tmp/px-d5-malformed-position-unused',
    snapId: D5_SNAP_ID,
    url: D5_FIXTURE_URL,
    viewport: '400x1500',
    settled: true,
    freezeAnimations: false,
    captureUnsettled: false,
    pixels: true,
    state: [],
    unstableRegions: [],
    write: makeInMemoryWriter(store),
  });
  const pixels = store['pixels.json'] as PixelsJson;
  for (const selector of ['div#clipMalformedTokenChild', 'div#clipMalformedNumberChild', 'div#clipMalformedCalcChild']) {
    const el = pixels.elements.find((e) => e.selector === selector);
    assert.ok(el, `${selector} element present`);
    const record = el as unknown as { ancestorClipped: boolean; ancestorClipApproximate: boolean };
    assert.equal(record.ancestorClipped, true, `${selector}: malformed clip remains reported`);
    assert.equal(record.ancestorClipApproximate, true, `${selector}: malformed position never becomes invented exact geometry`);
    assert.ok(Math.abs(el!.rect.width - 100) <= 2, `${selector}: conservative width should remain ~100, got ${el!.rect.width}`);
    assert.ok(Math.abs(el!.rect.height - 100) <= 2, `${selector}: conservative height should remain ~100, got ${el!.rect.height}`);
  }
});

test('D5 real-Chrome: url() clip-path whose fragment merely resembles a circle() call is flagged approximate, never treated as an exact shape', liveChromeOpts, () => {
  // `#clipUrlParent` is authored `clip-path: url('#circle(20px at 50px
  // 50px)')` -- a valid but UNSUPPORTED `<clip-source>` reference (an SVG
  // `<clipPath>` element id, which this fragment does not actually name).
  // Real Chrome's computed `clipPath` string for this is exactly
  // `url("#circle(20px at 50px 50px)")` -- the literal substring
  // `circle(20px at 50px 50px)` sits inside the url() fragment. Before this
  // fix, `extractFunctionArgs` located that substring via a bare
  // `indexOf('circle(')` anywhere in the clip-path string and parsed it as
  // an exact circle() shape (`ancestorClipApproximate:false`, a shrunk
  // ~40x40 masked rect) -- a dishonest exact reading of an unsupported
  // clip-path form. The fix requires the parser to only recognize a
  // TOP-LEVEL `circle(`/`inset(`/`ellipse(`/`polygon(` token, so this must
  // fall into the same honest "cannot resolve" path as path()/url() alone:
  // flagged, approximate, and bounded by the ancestor's own 100x100 box
  // (never silently unmasked, never a fabricated exact circle).
  const el = d5Pixels.elements.find((e) => e.selector === 'div#clipUrlChild');
  assert.ok(el, 'clipUrlChild element present');

  const record = el as unknown as { ancestorClipped: boolean; ancestorClipApproximate: boolean };
  assert.equal(record.ancestorClipped, true, 'a url() ancestor clip-path must be flagged, never silently treated as unclipped');
  assert.equal(
    record.ancestorClipApproximate,
    true,
    'shape text found only inside a url() clip-source fragment must not be parsed as an exact circle() -- this must report honest-approximate',
  );

  // The ancestor's own 100x100 box is the conservative bound (never a
  // fabricated ~40x40 circle bbox derived from the unsupported url() text).
  assert.ok(Math.abs(el!.rect.width - 100) <= 2, `rect width should stay the full ~100px ancestor box, not a fabricated circle bbox, got ${el!.rect.width}`);
  assert.ok(Math.abs(el!.rect.height - 100) <= 2, `rect height should stay the full ~100px ancestor box, not a fabricated circle bbox, got ${el!.rect.height}`);
});
});
