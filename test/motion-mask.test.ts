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

test('motion mask falls back to the longest same-size frame run when a viewport resize splits the recording, exiting success with a precise caveat', () => {
  const sessionDir = path.join(CAPTURE_ROOT, `motion-mask-resize-${process.pid}-${Date.now()}`);
  const recDir = path.join(sessionDir, 'motion', 'recs', 'rec-resize');
  const framesDir = path.join(recDir, 'frames');
  try {
    ensurePrivateDir(framesDir);
    writeJsonPrivate(path.join(recDir, 'meta.json'), {
      id: 'rec-resize', action: 'resize', frames: 5, durationMs: 400, state: 'finalized',
    });
    // Frames 0–2 share a 10×10 viewport (a block moves across them); frames 3–4
    // are a resized 8×8 viewport. The longest same-size run is 0–2.
    writeBinaryPrivate(path.join(framesDir, 'frame-000000.png'), png(10, 10));
    writeBinaryPrivate(path.join(framesDir, 'frame-000001.png'), png(10, 10, { x: 2, y: 2, width: 2, height: 2 }));
    writeBinaryPrivate(path.join(framesDir, 'frame-000002.png'), png(10, 10, { x: 4, y: 2, width: 2, height: 2 }));
    writeBinaryPrivate(path.join(framesDir, 'frame-000003.png'), png(8, 8));
    writeBinaryPrivate(path.join(framesDir, 'frame-000004.png'), png(8, 8, { x: 1, y: 1, width: 2, height: 2 }));
    writeNdjsonPrivate(path.join(recDir, 'rects.jsonl'), []);
    writeNdjsonPrivate(path.join(recDir, 'events.jsonl'), []);

    const result = createMotionMask(resolveRecRef(recDir));

    // Measured only over the same-size run: 3 frames → 2 adjacent pairs, 10×10.
    assert.equal(result.width, 10);
    assert.equal(result.height, 10);
    assert.equal(result.comparedFramePairs, 2);
    const composite = PNG.sync.read(fs.readFileSync(result.outputPath));
    assert.equal(composite.width, 10);
    assert.equal(composite.height, 10);
    assert.ok(result.regions.length >= 1);
    assert.equal(
      result.caveat,
      'Partial-window fallback: recorded frames span more than one viewport size. Composite and region facts cover only the longest contiguous same-size run — frames 0–2 (frame-000000.png–frame-000002.png) at 10×10. 2 frame(s) outside this run were excluded; some may share these dimensions.',
    );
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('motion mask confines region facts to the selected run: rects and timing from excluded frames never leak into attribution, distance, or velocity', () => {
  const sessionDir = path.join(CAPTURE_ROOT, `motion-mask-scope-${process.pid}-${Date.now()}`);
  const recDir = path.join(sessionDir, 'motion', 'recs', 'rec-scope');
  const framesDir = path.join(recDir, 'frames');
  try {
    ensurePrivateDir(framesDir);
    writeJsonPrivate(path.join(recDir, 'meta.json'), {
      id: 'rec-scope', action: 'resize', frames: 5, durationMs: 400, state: 'finalized',
    });
    // Selected run = frames 0–2 (10×10); frames 3–4 (8×8) are excluded.
    writeBinaryPrivate(path.join(framesDir, 'frame-000000.png'), png(10, 10));
    writeBinaryPrivate(path.join(framesDir, 'frame-000001.png'), png(10, 10, { x: 2, y: 2, width: 2, height: 2 }));
    writeBinaryPrivate(path.join(framesDir, 'frame-000002.png'), png(10, 10, { x: 4, y: 2, width: 2, height: 2 }));
    writeBinaryPrivate(path.join(framesDir, 'frame-000003.png'), png(8, 8));
    writeBinaryPrivate(path.join(framesDir, 'frame-000004.png'), png(8, 8, { x: 1, y: 1, width: 2, height: 2 }));
    // The ONLY recorded rects belong to excluded frames 3–4: a large 'div#ghost'
    // that (pre-fix) would overlap the run's composite changed pixels, win
    // attribution, and contribute its own rect distance. No rects exist for the
    // selected run, and no screencastTimestamp is recorded (fallback timing).
    writeNdjsonPrivate(path.join(recDir, 'rects.jsonl'), [
      { frame: 3, file: 'frame-000003.png', elements: [{ tag: 'div', id: 'ghost', backendNodeId: 99, x: 2, y: 2, width: 4, height: 4 }] },
      { frame: 4, file: 'frame-000004.png', elements: [{ tag: 'div', id: 'ghost', backendNodeId: 99, x: 5, y: 2, width: 4, height: 4 }] },
    ]);
    writeNdjsonPrivate(path.join(recDir, 'events.jsonl'), []);

    const result = createMotionMask(resolveRecRef(recDir));

    assert.equal(result.comparedFramePairs, 2);
    assert.ok(result.regions.length >= 1);
    const region = result.regions[0];
    // Attribution/distance leak: the excluded 'div#ghost' must not win the region
    // nor supply its rect distance. With no run rects, attribution is empty and
    // distance falls back to the composite's pixel centroids.
    assert.equal(region.element, undefined);
    // Timing leak: absent rect timestamps map the pair's ABSOLUTE frame index
    // across the recording (5 frames, 400ms) — run pairs 0–1 span 0–200ms, not
    // the stretched 0–400ms the pre-fix fallback produced over the run alone.
    assert.equal(region.startMs, 0);
    assert.equal(region.endMs, 200);
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('motion mask errors when no contiguous run of two same-size frames exists', () => {
  const sessionDir = path.join(CAPTURE_ROOT, `motion-mask-norun-${process.pid}-${Date.now()}`);
  const recDir = path.join(sessionDir, 'motion', 'recs', 'rec-norun');
  const framesDir = path.join(recDir, 'frames');
  try {
    ensurePrivateDir(framesDir);
    writeJsonPrivate(path.join(recDir, 'meta.json'), { id: 'rec-norun', action: null, frames: 3, durationMs: 300, state: 'finalized' });
    // Every adjacent frame pair differs in size — no usable same-size run.
    writeBinaryPrivate(path.join(framesDir, 'frame-000000.png'), png(10, 10));
    writeBinaryPrivate(path.join(framesDir, 'frame-000001.png'), png(8, 8));
    writeBinaryPrivate(path.join(framesDir, 'frame-000002.png'), png(6, 6));
    writeNdjsonPrivate(path.join(recDir, 'rects.jsonl'), []);
    writeNdjsonPrivate(path.join(recDir, 'events.jsonl'), []);
    assert.throws(
      () => createMotionMask(resolveRecRef(recDir)),
      /no contiguous run of two or more same-size frames/,
    );
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
