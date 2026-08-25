import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate } from '../src/session/artifacts.js';
import { resolveSnapRef } from '../src/output/artifact.js';
import { buildMeasureMapPaintResult } from '../src/cdp/commands/measure/map-paint.js';
import { renderResult, toJsonResult } from '../src/output/render.js';

const scope = `measure-map-paint-${process.pid}-${Date.now()}`;
const root = path.join(CAPTURE_ROOT, scope);
const styles = {
  'box-shadow': 'none',
  'outline-width': '0px',
  'outline-style': 'none',
  'outline-offset': '0px',
  filter: 'none',
  transform: 'none',
};

function box(x: number, y: number, width: number, height: number): number[] {
  return [x, y, x + width, y, x + width, y + height, x, y + height];
}

function element(id: string, backendNodeId: number, selector: string, domPath: string, x: number, y: number, width: number, height: number, options: { zIndex?: string; visible?: boolean; opacity?: number; paint?: Record<string, string> } = {}) {
  return {
    id, backendNodeId, selector, domPath, frame: { frameId: 'frame-0' },
    boxModel: { border: box(x, y, width, height) }, paint: options.paint ?? styles,
    zIndex: options.zIndex ?? 'auto', visibility: { visible: options.visible ?? true, opacity: options.opacity ?? 1 },
  };
}

function snapshot(name: string, states?: unknown): string {
  const dir = path.join(root, 'measure', 'snaps', name);
  ensurePrivateDir(dir);
  const glassPath = 'html[0]/body[0]/div[0]';
  const targetPath = `${glassPath}/ul[0]/li[0]/button[0]`;
  const targetTwoPath = `${glassPath}/ul[0]/li[1]/button[0]`;
  const targetThreePath = `${glassPath}/ul[0]/li[2]/button[0]`;
  writeJsonPrivate(path.join(dir, 'meta.json'), { id: name, settled: true, capturedAt: new Date().toISOString() });
  writeJsonPrivate(path.join(dir, 'geometry.json'), {
    elements: [
      element('glass', 1, 'div.glass', glassPath, 12, 0, 44, 600),
      element('tile-1', 2, 'button.tile', targetPath, 26.5, 142, 28, 28),
      element('badge-1', 3, 'span.badge', `${targetPath}/span[0]`, 26.5, 142, 28, 28),
      element('dot', 4, 'div.dot', `${glassPath}/div[1]`, 43, 142, 12, 12, { zIndex: '5' }),
      element('tile-2', 5, 'button.tile:nth-of-type(2)', targetTwoPath, 26.5, 178, 28, 28),
      element('badge-2', 6, 'span.badge:nth-of-type(2)', `${targetTwoPath}/span[0]`, 26.5, 178, 28, 28),
      element('tile-3', 7, 'button.tile:nth-of-type(3)', targetThreePath, 26.5, 214, 28, 28),
      element('badge-3', 8, 'span.badge:nth-of-type(3)', `${targetThreePath}/span[0]`, 26.5, 214, 28, 28),
      element('hidden', 9, 'div.hidden-overlap', `${glassPath}/div[2]`, 26.5, 142, 28, 28, { zIndex: '99', visible: false }),
      element('transparent', 10, 'div.transparent-overlap', `${glassPath}/div[3]`, 26.5, 142, 28, 28, { zIndex: '100', opacity: 0 }),
    ],
  });
  writeJsonPrivate(path.join(dir, 'layers.json'), {
    paintOrder: { available: true, backendNodeIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], truncated: 0 },
  });
  if (states) writeJsonPrivate(path.join(dir, 'states.json'), states);
  return dir;
}

after(() => fs.rmSync(root, { recursive: true, force: true }));

test('measure map paint reports the dot against border and ink boxes, excludes target tree ancestors, and ignores invisible/transparent records', async () => {
  const dir = snapshot('base');
  const output = renderResult(buildMeasureMapPaintResult(await resolveSnapRef(dir), 'span.badge'));

  assert.match(output, /Target border box from base-state geometry record: x=26\.5…54\.5 y=142…170 \(w=28 h=28 area=784px²\)/);
  assert.match(output, /Target ink box from base-state geometry record: x=26\.5…54\.5 y=142…170 \(w=28 h=28 area=784px²\)/);
  assert.match(output, /div\.dot: DOMSnapshot paint rank 3 \(target rank 2\); z-index=5; border-box intersection x=43…54\.5 y=142…154; area=138px² \(17\.60% of target border box\); ink-box intersection x=43…54\.5 y=142…154; area=138px² \(17\.60% of target ink box\)/);
  assert.doesNotMatch(output, /div\.glass/);
  assert.doesNotMatch(output, /hidden-overlap|transparent-overlap/);
  assert.match(output, /AABB intersection over recorded border\/ink geometry, not a pixel-exact paint test/);
});

test('measure map paint states an empty occluder set for unoccluded tiles', async () => {
  const dir = snapshot('empty');
  const output = renderResult(buildMeasureMapPaintResult(await resolveSnapRef(dir), 'span.badge:nth-of-type(2)'));

  assert.match(output, /occluders="0"/);
  assert.match(output, /occluder set is empty/);
  assert.doesNotMatch(output, /div\.dot:/);
});

test('measure map paint marks a capped DOMSnapshot order unavailable instead of reporting an exhaustive occluder set', async () => {
  const dir = snapshot('truncated-order');
  writeJsonPrivate(path.join(dir, 'layers.json'), {
    paintOrder: { available: true, backendNodeIds: [1, 2, 3], truncated: 7 },
  });
  const output = renderResult(buildMeasureMapPaintResult(await resolveSnapRef(dir), 'span.badge'));

  assert.match(output, /status="paint_order_unavailable"/);
  assert.match(output, /DOMSnapshot paint order omitted 7 backend node id\(s\) at the collector cap/);
  assert.doesNotMatch(output, /occluder set is empty/);
});

test('measure map paint reports coverage-unavailable ranked candidates instead of silently calling the set empty', async () => {
  const dir = snapshot('candidate-without-border');
  const geometryPath = path.join(dir, 'geometry.json');
  const geometry = JSON.parse(fs.readFileSync(geometryPath, 'utf8')) as { elements: Array<{ id: string; boxModel?: unknown }> };
  geometry.elements.find((entry) => entry.id === 'dot')!.boxModel = null;
  writeJsonPrivate(geometryPath, geometry);
  const output = renderResult(buildMeasureMapPaintResult(await resolveSnapRef(dir), 'span.badge'));

  assert.match(output, /coverage-unavailable="1"/);
  assert.match(output, /Coverage unavailable 1\. div\.dot: DOMSnapshot paint rank 3; this target's border-box quad was not captured/);
  assert.match(output, /occluder set is not exhaustive/);
  assert.doesNotMatch(output, /occluder set is empty/);
});

test('measure map paint derives forced-state ink from the matching affected descendant row', async () => {
  const states = {
    elements: [{
      id: 'state-hover-button', state: 'hover', supported: true, selector: 'button.tile', backendNodeId: 2,
      geometry: { after: { x: 26.5, y: 142, width: 28, height: 28 } }, style: { after: styles },
      affected: { elements: [{
        relation: 'descendant', selector: 'span.badge', backendNodeId: 3,
        geometry: { after: { x: 26.5, y: 142, width: 28, height: 28 } },
        style: { after: { ...styles, 'box-shadow': 'rgba(229, 229, 229, 0.2) 0px 0px 0px 2px' } },
      }] },
    }],
  };
  const dir = snapshot('hover', states);
  const result = buildMeasureMapPaintResult(await resolveSnapRef(dir), 'span.badge', 'hover');
  const output = renderResult(result);
  const json = toJsonResult(result) as { attrs: Record<string, unknown> };

  assert.equal(json.attrs.state, 'hover');
  assert.match(output, /Target ink box from forced state "hover" \(states\.json record state-hover-button, descendant row, post-force values\): x=24\.5…56\.5 y=140…172 \(w=32 h=32 area=1024px²\)/);
  assert.match(output, /ink-box intersection x=43…55 y=142…154; area=144px² \(14\.06% of target ink box\)/);
});
