/**
 * Coverage for the pixelmatch/pngjs wrapper in `src/output/diff.ts`, used by
 * `measure diff --pixels`, snapshot crops, and `motion mask`.
 *
 * Run: `node --import tsx --test test/pixel-diff.test.ts`
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PNG } from "pngjs";
import { diffPngs } from "../src/output/diff.js";

const FIXTURES = path.join(__dirname, "fixtures", "pixels");
const BEFORE = path.join(FIXTURES, "before.png");
const AFTER = path.join(FIXTURES, "after.png");
const MISMATCHED = path.join(FIXTURES, "mismatched-size.png");

function tmpOut(name: string): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pixel-diff-test-")), name);
}

test("diffPngs reports the known pixel difference and writes the diff PNG", () => {
  const out = tmpOut("diff.png");
  const result = diffPngs(BEFORE, AFTER, out);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  // fixtures/pixels/before.png is 10x10 solid white; after.png is identical
  // except for a 3x3 red block at (2,2)-(4,4) => 9 differing pixels.
  assert.equal(result.width, 10);
  assert.equal(result.height, 10);
  assert.equal(result.diffPixelCount, 9);
  assert.equal(result.threshold, 0.1);

  assert.equal(fs.existsSync(out), true);
  const written = PNG.sync.read(fs.readFileSync(out));
  assert.equal(written.width, 10);
  assert.equal(written.height, 10);
});

test("diffPngs respects a custom threshold", () => {
  const out = tmpOut("diff-strict.png");
  const result = diffPngs(BEFORE, AFTER, out, { threshold: 0 });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.threshold, 0);
  assert.equal(result.diffPixelCount, 9);
});

test("diffPngs returns a structured error (not a throw) for mismatched dimensions", () => {
  const out = tmpOut("diff-mismatch.png");

  const result = diffPngs(BEFORE, MISMATCHED, out);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "dimension_mismatch");
  assert.deepEqual(result.before, { width: 10, height: 10 });
  assert.deepEqual(result.after, { width: 12, height: 10 });
  assert.match(result.message, /10x10/);
  assert.match(result.message, /12x10/);

  // No diff PNG should be written when the comparison could not run.
  assert.equal(fs.existsSync(out), false);
});

test("diffPngs writes the output file with private permissions", () => {
  const out = tmpOut("diff-private.png");
  diffPngs(BEFORE, AFTER, out);

  const mode = fs.statSync(out).mode & 0o777;
  assert.equal(mode, 0o600);
});
