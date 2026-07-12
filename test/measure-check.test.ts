import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';

import { checkSnapshot, parseChecks, writeFindingCrop } from '../src/cdp/measure/check.js';
import type { SnapRef } from '../src/output/artifact.js';

const root = path.join(os.tmpdir(), 'capture-sessions', `measure-check-test-${process.pid}`);
const dir = path.join(root, 'measure', 'snaps', 'snap-check');
const ref: SnapRef = { kind: 'snap', id: 'snap-check', dir };

function json(name: string, value: unknown) { fs.writeFileSync(path.join(dir, name), JSON.stringify(value)); }

fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
json('meta.json', { id: 'snap-check', url: 'http://example.test', viewport: '100x100', settled: false, capturedAt: new Date().toISOString() });
json('geometry.json', {
  elements: [
    // .a and .b are DOM siblings (neither domPath is a prefix of the other) with opaque backgrounds that overlap -> a real opaque sibling intersection, reported.
    { id: 'el-a', selector: '.a', domPath: 'body[0]/button[0]', tag: 'button', backendNodeId: 1, rect: { x: 80, y: 10, width: 30, height: 20 }, visibility: { visible: true, opacity: 1 }, zIndex: 'auto', layout: { scrollWidth: 130, clientWidth: 100, overflowX: 'auto' } },
    { id: 'el-b', selector: '.b', domPath: 'body[0]/div[1]', tag: 'div', backendNodeId: 2, rect: { x: 85, y: 15, width: 10, height: 10 }, visibility: { visible: true, opacity: 1 }, zIndex: 'auto' },
    // .child is a DOM descendant of .parent (domPath prefix): geometric intersection is trivial containment, NOT a sibling overlap -> excluded even though both are opaque.
    { id: 'el-parent', selector: '.parent', domPath: 'body[0]/div[2]', tag: 'div', backendNodeId: 3, rect: { x: 0, y: 40, width: 40, height: 40 }, visibility: { visible: true, opacity: 1 }, zIndex: 'auto' },
    { id: 'el-child', selector: '.child', domPath: 'body[0]/div[2]/div[0]', tag: 'div', backendNodeId: 4, rect: { x: 5, y: 45, width: 20, height: 20 }, visibility: { visible: true, opacity: 1 }, zIndex: 'auto' },
  ],
  unstableRegions: [{ id: 'unstable-a', selector: '.a', rect: { x: 70, y: 0, w: 40, h: 50 }, reason: 'resize observations' }],
});
// .b's opaque background is expressed in the modern browser-computed
// `oklch(...)` syntax (with dash-cased `background-color` key), exactly as the
// real U29 snapshot carries it. A parser that only understood legacy
// comma-form rgb() would read .b as unknown-alpha, drop the occlusion, and
// return a false-clean result.
json('styles.json', { elements: [
  { selector: '.a', backendNodeId: 1, computed: { color: 'oklch(0.145 0 0)', 'background-color': 'rgba(0, 0, 0, 0)' } },
  { selector: '.b', backendNodeId: 2, computed: { 'background-color': 'oklch(1 0 0)' } },
  { selector: '.parent', backendNodeId: 3, computed: { 'background-color': 'oklch(0.723 0.219 149.579)' } },
  { selector: '.child', backendNodeId: 4, computed: { 'background-color': 'oklab(0.723 -0.18885 0.110891 / 0.8)' } },
] });
// Authoritative back-to-front paint order (Chrome's DOMSnapshot order): .b
// (backend 2) is painted after .a (backend 1), so .b paints on top.
json('layers.json', { paintOrder: { available: true, backendNodeIds: [1, 2, 3, 4] } });
json('hittest.json', { elements: Array.from({ length: 25 }, (_, index) => ({ selector: `.hit-${index}`, selfHitCount: 0, selfHitTotal: 5, points: [{ result: { x: 90, y: 20, topReceiver: { selector: '.b' }, stack: [{ selector: '.b', pointerEvents: 'auto' }] } }] })) });
json('text.json', { elements: [{ selector: '.a', truncated: true, scrollWidth: 130, clientWidth: 100 }] });
json('forms.json', { controls: [] });
json('animation.json', { animations: [{ id: 'anim-1', selector: '.a', infinite: true, durationMs: 200, iterationCount: 'infinite', playState: 'running' }] });
json('media.json', { elements: [{ id: 'm-1', selector: 'img', rect: { x: 0, y: 0, width: 10, height: 10 }, visible: false, naturalWidth: 0, naturalHeight: 0, decodeState: 'loading' }] });
const png = new PNG({ width: 100, height: 100 }); png.data.fill(255); fs.writeFileSync(path.join(dir, 'screenshot.png'), PNG.sync.write(png));

after(() => fs.rmSync(root, { recursive: true, force: true }));

test('check reads measurements, filters categories, attaches unstable caveats, and writes id-relative crops', () => {
  assert.deepEqual(parseChecks('geometry'), ['overlap', 'offscreen', 'overflow', 'tap-targets']);
  const geometry = checkSnapshot(ref, parseChecks('geometry'));
  assert.deepEqual(new Set(geometry.findings.map((f) => f.kind)), new Set(['overlap', 'offscreen', 'overflow', 'tap-targets']));
  assert.ok(geometry.findings.every((f) => f.caveats.some((c) => c.regionId === 'unstable-a')));
  // Overlap reports the opaque sibling intersection (.a/.b) exactly once and
  // EXCLUDES the ancestor-descendant containment pair (.parent/.child).
  const overlaps = geometry.findings.filter((f) => f.kind === 'overlap');
  assert.equal(overlaps.length, 1);
  assert.match(overlaps[0].detail, /^\.a \d+% occluded by \.b\b/);
  assert.equal(overlaps.some((f) => /\.child|\.parent/.test(f.detail)), false);
  const crop = writeFindingCrop(ref, geometry.findings[0], 0);
  assert.equal(crop, 'snap-check/findings/1-overlap.png');
  assert.ok(fs.existsSync(path.join(dir, 'findings', '1-overlap.png')));
  const content = checkSnapshot(ref, parseChecks('content'));
  assert.deepEqual(new Set(content.findings.map((f) => f.kind)), new Set(['truncation', 'media']));
});

// Build an isolated snapshot fixture (meta + geometry + styles + layers) for a
// focused overlap scenario, returning its ref. Kept minimal: overlap reads
// only these four artifacts.
function makeSnap(id: string, opts: { geometry: unknown; styles: unknown; layers?: unknown }): SnapRef {
  const d = path.join(root, 'measure', 'snaps', id);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(d, 'meta.json'), JSON.stringify({ id, url: 'http://example.test', viewport: '200x200', settled: true, capturedAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(d, 'geometry.json'), JSON.stringify(opts.geometry));
  fs.writeFileSync(path.join(d, 'styles.json'), JSON.stringify(opts.styles));
  if (opts.layers) fs.writeFileSync(path.join(d, 'layers.json'), JSON.stringify(opts.layers));
  return { kind: 'snap', id, dir: d };
}

test('overlap recognizes modern oklab alpha as transparent (no false occlusion when the top painter is see-through)', () => {
  // Two direct siblings; the top painter (.over) has an oklab background with
  // 0.3 alpha — a semi-transparent overlay that does NOT occlude. A parser
  // that treated every oklab()/oklch() as opaque would wrongly report it.
  const ref = makeSnap('snap-oklab-alpha', {
    geometry: { elements: [
      { id: 'u', selector: '.under', domPath: 'body[0]/div[0]', tag: 'div', backendNodeId: 1, rect: { x: 10, y: 10, width: 40, height: 40 }, visibility: { visible: true, opacity: 1 } },
      { id: 'o', selector: '.over', domPath: 'body[0]/div[1]', tag: 'div', backendNodeId: 2, rect: { x: 20, y: 20, width: 40, height: 40 }, visibility: { visible: true, opacity: 1 } },
    ] },
    styles: { elements: [
      { selector: '.under', backendNodeId: 1, computed: { 'background-color': 'oklch(1 0 0)' } },
      { selector: '.over', backendNodeId: 2, computed: { 'background-color': 'oklab(0.97 0 0 / 0.3)' } },
    ] },
    layers: { paintOrder: { available: true, backendNodeIds: [1, 2] } },
  });
  const overlaps = checkSnapshot(ref, ['overlap']).findings.filter((f) => f.kind === 'overlap');
  assert.equal(overlaps.length, 0);
});

test('overlap excludes cousin and descendant-of-sibling intersections (only direct siblings are reported)', () => {
  // .cousin-left and .cousin-right live in different subtrees (parents
  // section[0] vs aside[1]) and their rects intersect while both opaque —
  // a cousin pair. .deep is a DESCENDANT of .right-sibling and intersects
  // .left-sibling. Only the two direct siblings (.left-sibling/.right-sibling)
  // may produce a finding; the cousin and descendant-of-sibling pairs are noise.
  const ref = makeSnap('snap-cousins', {
    geometry: { elements: [
      { id: 'ls', selector: '.left-sibling', domPath: 'body[0]/section[0]', tag: 'section', backendNodeId: 1, rect: { x: 0, y: 0, width: 100, height: 100 }, visibility: { visible: true, opacity: 1 } },
      { id: 'rs', selector: '.right-sibling', domPath: 'body[0]/aside[1]', tag: 'aside', backendNodeId: 2, rect: { x: 50, y: 0, width: 100, height: 100 }, visibility: { visible: true, opacity: 1 } },
      { id: 'cl', selector: '.cousin-left', domPath: 'body[0]/section[0]/span[0]', tag: 'span', backendNodeId: 3, rect: { x: 40, y: 40, width: 30, height: 30 }, visibility: { visible: true, opacity: 1 } },
      { id: 'cr', selector: '.cousin-right', domPath: 'body[0]/aside[1]/span[0]', tag: 'span', backendNodeId: 4, rect: { x: 50, y: 40, width: 30, height: 30 }, visibility: { visible: true, opacity: 1 } },
      { id: 'dp', selector: '.deep', domPath: 'body[0]/aside[1]/div[1]', tag: 'div', backendNodeId: 5, rect: { x: 45, y: 5, width: 20, height: 20 }, visibility: { visible: true, opacity: 1 } },
    ] },
    styles: { elements: [
      { selector: '.left-sibling', backendNodeId: 1, computed: { 'background-color': 'oklch(1 0 0)' } },
      { selector: '.right-sibling', backendNodeId: 2, computed: { 'background-color': 'oklch(1 0 0)' } },
      { selector: '.cousin-left', backendNodeId: 3, computed: { 'background-color': 'oklch(1 0 0)' } },
      { selector: '.cousin-right', backendNodeId: 4, computed: { 'background-color': 'oklch(1 0 0)' } },
      { selector: '.deep', backendNodeId: 5, computed: { 'background-color': 'oklch(1 0 0)' } },
    ] },
    layers: { paintOrder: { available: true, backendNodeIds: [1, 2, 3, 4, 5] } },
  });
  const overlaps = checkSnapshot(ref, ['overlap']).findings.filter((f) => f.kind === 'overlap');
  assert.equal(overlaps.length, 1);
  assert.match(overlaps[0].detail, /\.left-sibling|\.right-sibling/);
  assert.equal(overlaps.some((f) => /cousin|\.deep/.test(f.detail)), false);
});

test('overlap resolves top/bottom from authoritative paint order, not DOM order', () => {
  // .early is EARLIER in DOM (div[0]) but the artifact's paint order paints it
  // LAST (on top). .early is opaque; .late is transparent. Resolving by paint
  // order names .early as the occluder; a DOM-order guess would pick the
  // transparent .late and report nothing.
  const ref = makeSnap('snap-reversed-paint', {
    geometry: { elements: [
      { id: 'e', selector: '.early', domPath: 'body[0]/div[0]', tag: 'div', backendNodeId: 1, rect: { x: 0, y: 0, width: 60, height: 60 }, visibility: { visible: true, opacity: 1 } },
      { id: 'l', selector: '.late', domPath: 'body[0]/div[1]', tag: 'div', backendNodeId: 2, rect: { x: 30, y: 0, width: 60, height: 60 }, visibility: { visible: true, opacity: 1 } },
    ] },
    styles: { elements: [
      { selector: '.early', backendNodeId: 1, computed: { 'background-color': 'oklch(1 0 0)' } },
      { selector: '.late', backendNodeId: 2, computed: { 'background-color': 'rgba(0, 0, 0, 0)' } },
    ] },
    // Paint order REVERSED vs DOM order: .late (2) painted first, .early (1) on top.
    layers: { paintOrder: { available: true, backendNodeIds: [2, 1] } },
  });
  const overlaps = checkSnapshot(ref, ['overlap']).findings.filter((f) => f.kind === 'overlap');
  assert.equal(overlaps.length, 1);
  assert.match(overlaps[0].detail, /^\.late \d+% occluded by \.early\b/);
  assert.match(overlaps[0].provenance ?? '', /paints above .* in DOMSnapshot paint order/);
});

test('overlap requires the actual TOP painter to be opaque (opaque-under + transparent-over is not an occlusion)', () => {
  // The top painter (.over, painted last) is transparent; the element beneath
  // (.under) is opaque. Requiring EITHER to be opaque (the old bug) falsely
  // reported this; requiring the TOP painter to be opaque correctly reports nothing.
  const ref = makeSnap('snap-opaque-under', {
    geometry: { elements: [
      { id: 'u', selector: '.under', domPath: 'body[0]/div[0]', tag: 'div', backendNodeId: 1, rect: { x: 0, y: 0, width: 60, height: 60 }, visibility: { visible: true, opacity: 1 } },
      { id: 'o', selector: '.over', domPath: 'body[0]/div[1]', tag: 'div', backendNodeId: 2, rect: { x: 30, y: 0, width: 60, height: 60 }, visibility: { visible: true, opacity: 1 } },
    ] },
    styles: { elements: [
      { selector: '.under', backendNodeId: 1, computed: { 'background-color': 'oklch(1 0 0)' } },
      { selector: '.over', backendNodeId: 2, computed: { 'background-color': 'rgba(0, 0, 0, 0)' } },
    ] },
    layers: { paintOrder: { available: true, backendNodeIds: [1, 2] } },
  });
  const overlaps = checkSnapshot(ref, ['overlap']).findings.filter((f) => f.kind === 'overlap');
  assert.equal(overlaps.length, 0);
});

test('overlap emits no occlusion when authoritative paint order is missing or omits a candidate (DOM order is not paint order)', () => {
  // Two direct siblings whose opaque rects intersect — a real geometric
  // overlap — but the top painter is unprovable: DOM order is not paint order
  // for positioned/z-indexed/stacking-context elements, so without
  // authoritative paintOrder for BOTH the tool must claim no occlusion.

  // Case 1: layers.json entirely absent (no paintOrder artifact).
  const noLayers = makeSnap('snap-no-paintorder', {
    geometry: { elements: [
      { id: 'a', selector: '.a', domPath: 'body[0]/div[0]', tag: 'div', backendNodeId: 1, rect: { x: 0, y: 0, width: 60, height: 60 }, visibility: { visible: true, opacity: 1 } },
      { id: 'b', selector: '.b', domPath: 'body[0]/div[1]', tag: 'div', backendNodeId: 2, rect: { x: 30, y: 0, width: 60, height: 60 }, visibility: { visible: true, opacity: 1 } },
    ] },
    styles: { elements: [
      { selector: '.a', backendNodeId: 1, computed: { 'background-color': 'oklch(1 0 0)' } },
      { selector: '.b', backendNodeId: 2, computed: { 'background-color': 'oklch(1 0 0)' } },
    ] },
  });
  assert.equal(checkSnapshot(noLayers, ['overlap']).findings.filter((f) => f.kind === 'overlap').length, 0);

  // Case 2: paintOrder present but OMITS one candidate's backendNodeId (.b/2).
  const partial = makeSnap('snap-partial-paintorder', {
    geometry: { elements: [
      { id: 'a', selector: '.a', domPath: 'body[0]/div[0]', tag: 'div', backendNodeId: 1, rect: { x: 0, y: 0, width: 60, height: 60 }, visibility: { visible: true, opacity: 1 } },
      { id: 'b', selector: '.b', domPath: 'body[0]/div[1]', tag: 'div', backendNodeId: 2, rect: { x: 30, y: 0, width: 60, height: 60 }, visibility: { visible: true, opacity: 1 } },
    ] },
    styles: { elements: [
      { selector: '.a', backendNodeId: 1, computed: { 'background-color': 'oklch(1 0 0)' } },
      { selector: '.b', backendNodeId: 2, computed: { 'background-color': 'oklch(1 0 0)' } },
    ] },
    layers: { paintOrder: { available: true, backendNodeIds: [1] } },
  });
  assert.equal(checkSnapshot(partial, ['overlap']).findings.filter((f) => f.kind === 'overlap').length, 0);
});

test('check accepts individual checks and rejects unknown names', () => {
  assert.deepEqual(parseChecks('hit-test,truncation'), ['hit-test', 'truncation']);
  assert.throws(() => parseChecks('advice'), /unknown check/);
});

test('command renders a bounded cross-kind sample with a factual rollup, while JSON retains every finding', () => {
  const gated = spawnSync(process.execPath, ['--import', 'tsx', 'src/capture.ts', 'measure', 'check', dir, '--for', 'all', '--gate'], { encoding: 'utf8' });
  assert.equal(gated.status, 2);
  assert.match(gated.stdout, /<checks [^>]*findings="32"[^>]*displayed="20"/);
  assert.match(gated.stdout, /Finding counts: overlap=1, offscreen=1, overflow=1, tap-targets=1, hit-test=25, truncation=1, media=1, animation=1/);
  assert.equal((gated.stdout.match(/^\d+\. /gm) ?? []).length, 20);
  assert.match(gated.stdout, /snap-check\/findings\/1-overlap\.png/);

  const jsonResult = spawnSync(process.execPath, ['--import', 'tsx', 'src/capture.ts', 'measure', 'check', dir, '--for', 'all', '--json'], { encoding: 'utf8' });
  assert.equal(jsonResult.status, 0);
  const rendered = JSON.parse(jsonResult.stdout) as { attrs: { findings: number; displayed: number }; sections: string[] };
  assert.equal(rendered.attrs.findings, 32);
  assert.equal(rendered.attrs.displayed, 32);
  assert.equal(rendered.sections.length, 33);

  for (const limit of ['0', '1.9', 'nope', 'Infinity']) {
    const invalid = spawnSync(process.execPath, ['--import', 'tsx', 'src/capture.ts', 'measure', 'check', dir, '--for', 'all', '--limit', limit], { encoding: 'utf8' });
    assert.equal(invalid.status, 1, `${limit}: ${invalid.stdout}`);
    assert.match(invalid.stdout, /Invalid --limit/);
  }
  const customLimit = spawnSync(process.execPath, ['--import', 'tsx', 'src/capture.ts', 'measure', 'check', dir, '--for', 'all', '--limit', '3'], { encoding: 'utf8' });
  assert.equal(customLimit.status, 0);
  assert.equal((customLimit.stdout.match(/^\d+\. /gm) ?? []).length, 3);

  const clean = spawnSync(process.execPath, ['--import', 'tsx', 'src/capture.ts', 'measure', 'check', dir, '--for', 'contrast', '--gate'], { encoding: 'utf8' });
  assert.equal(clean.status, 0);
  assert.match(clean.stdout, /result="clean"/);
});
