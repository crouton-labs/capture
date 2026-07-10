import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';

import { CAPTURE_ROOT, ensurePrivateDir, writeBinaryPrivate, writeJsonPrivate, writeNdjsonPrivate } from '../src/session/artifacts.js';
import { createMotionMask } from '../src/cdp/motion/mask.js';
import { cmdMotionMask } from '../src/cdp/commands/motion/mask.js';
import { resolveRecRef } from '../src/output/artifact.js';

function png(width: number, height: number, block?: { x: number; y: number; width: number; height: number }): Buffer {
  const image = new PNG({ width, height, fill: true });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
      image.data[offset + 3] = 255;
    }
  }
  if (block) {
    for (let y = block.y; y < block.y + block.height; y++) {
      for (let x = block.x; x < block.x + block.width; x++) {
        const offset = (y * width + x) * 4;
        image.data[offset] = 0;
        image.data[offset + 1] = 0;
        image.data[offset + 2] = 0;
      }
    }
  }
  return PNG.sync.write(image);
}

// Importing the command leaf above verifies the renderer-facing surface resolves;
// focused fixture assertions exercise its shared analysis primitive below.
void cmdMotionMask;

test('motion mask writes a private time-colored PNG and reports region area, distance, velocity, and rect attribution', () => {
  const sessionDir = path.join(CAPTURE_ROOT, `motion-mask-${process.pid}-${Date.now()}`);
  const recDir = path.join(sessionDir, 'motion', 'recs', 'rec-mask');
  const framesDir = path.join(recDir, 'frames');
  try {
    ensurePrivateDir(framesDir);
    writeJsonPrivate(path.join(recDir, 'meta.json'), {
      id: 'rec-mask', action: 'click:button.send', frames: 3, durationMs: 200, state: 'finalized',
    });
    writeBinaryPrivate(path.join(framesDir, 'frame-000000.png'), png(10, 10));
    writeBinaryPrivate(path.join(framesDir, 'frame-000001.png'), png(10, 10, { x: 2, y: 2, width: 2, height: 2 }));
    writeBinaryPrivate(path.join(framesDir, 'frame-000002.png'), png(10, 10, { x: 4, y: 2, width: 2, height: 2 }));
    writeNdjsonPrivate(path.join(recDir, 'rects.jsonl'), [
      { frame: 0, file: 'frame-000000.png', screencastTimestamp: 10, elements: [{ tag: 'button', id: 'send', classes: 'primary', backendNodeId: 7, x: 2, y: 2, width: 2, height: 2 }] },
      { frame: 1, file: 'frame-000001.png', screencastTimestamp: 10.1, elements: [{ tag: 'button', id: 'send', classes: 'primary', backendNodeId: 7, x: 2, y: 2, width: 2, height: 2 }] },
      { frame: 2, file: 'frame-000002.png', screencastTimestamp: 10.2, elements: [{ tag: 'button', id: 'send', classes: 'primary', backendNodeId: 7, x: 4, y: 2, width: 2, height: 2 }] },
    ]);
    writeNdjsonPrivate(path.join(recDir, 'events.jsonl'), []);

    const result = createMotionMask(resolveRecRef(recDir));

    assert.equal(result.comparedFramePairs, 2);
    assert.equal(result.outputPath, path.join(recDir, 'motion-mask.png'));
    assert.ok(fs.existsSync(result.outputPath));
    assert.equal(fs.statSync(result.outputPath).mode & 0o777, 0o600);
    const composite = PNG.sync.read(fs.readFileSync(result.outputPath));
    assert.equal(composite.width, 10);
    assert.equal(composite.height, 10);
    assert.ok(result.regions.length >= 1);
    const region = result.regions[0];
    assert.ok(region.areaPixels > 0);
    assert.ok(region.distancePx > 0);
    assert.ok(region.velocityPxPerSecond > 0);
    assert.equal(region.element?.label, 'button#send.primary');
    assert.equal(region.element?.backendNodeId, 7);
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('motion mask reports a recoverable missing-frames condition', () => {
  const sessionDir = path.join(CAPTURE_ROOT, `motion-mask-missing-${process.pid}-${Date.now()}`);
  const recDir = path.join(sessionDir, 'motion', 'recs', 'rec-missing');
  try {
    ensurePrivateDir(recDir);
    writeJsonPrivate(path.join(recDir, 'meta.json'), { id: 'rec-missing', action: null, frames: 0, durationMs: 0, state: 'finalized' });
    assert.throws(
      () => createMotionMask(resolveRecRef(recDir)),
      /frames is not present.*capture motion rec/, 
    );
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});
