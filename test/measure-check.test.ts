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
    { id: 'el-a', selector: '.a', tag: 'button', rect: { x: 80, y: 10, width: 30, height: 20 }, visibility: { visible: true }, layout: { scrollWidth: 130, clientWidth: 100, overflowX: 'auto' } },
    { id: 'el-b', selector: '.b', tag: 'div', rect: { x: 85, y: 15, width: 10, height: 10 }, visibility: { visible: true } },
  ],
  unstableRegions: [{ id: 'unstable-a', selector: '.a', rect: { x: 70, y: 0, w: 40, h: 50 }, reason: 'resize observations' }],
});
json('styles.json', { elements: [{ selector: '.a', computed: { color: 'rgb(0, 0, 0)', backgroundColor: 'rgb(255, 255, 255)' } }] });
json('hittest.json', { elements: [{ selector: '.a', selfHitCount: 0, selfHitTotal: 5, points: [{ result: { x: 90, y: 20, topReceiver: { selector: '.b' }, stack: [{ selector: '.b', pointerEvents: 'auto' }] } }] }] });
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
  const crop = writeFindingCrop(ref, geometry.findings[0], 0);
  assert.equal(crop, 'snap-check/findings/1-overlap.png');
  assert.ok(fs.existsSync(path.join(dir, 'findings', '1-overlap.png')));
  const content = checkSnapshot(ref, parseChecks('content'));
  assert.deepEqual(new Set(content.findings.map((f) => f.kind)), new Set(['truncation', 'media']));
});

test('check accepts individual checks and rejects unknown names', () => {
  assert.deepEqual(parseChecks('hit-test,truncation'), ['hit-test', 'truncation']);
  assert.throws(() => parseChecks('advice'), /unknown check/);
});

test('command renders findings and --gate exits 2 only when findings exist', () => {
  const gated = spawnSync(process.execPath, ['--import', 'tsx', 'src/capture.ts', 'measure', 'check', dir, '--for', 'geometry', '--gate'], { encoding: 'utf8' });
  assert.equal(gated.status, 2);
  assert.match(gated.stdout, /<checks /);
  assert.match(gated.stdout, /snap-check\/findings\/1-overlap\.png/);
  assert.match(gated.stdout, /Nondeterminism caveat/);
  const clean = spawnSync(process.execPath, ['--import', 'tsx', 'src/capture.ts', 'measure', 'check', dir, '--for', 'contrast', '--gate'], { encoding: 'utf8' });
  assert.equal(clean.status, 0);
  assert.match(clean.stdout, /result="clean"/);
});
