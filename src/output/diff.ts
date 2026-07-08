/**
 * Raster PNG diff helper — shared by `measure diff --pixels`, snapshot crops,
 * and `motion mask`. Wraps pixelmatch + pngjs (pure JS, esbuild-safe, no
 * native/system binary dependency).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

export interface DiffPngsOptions {
  /** Matching threshold (0 to 1); smaller is more sensitive. Default 0.1. */
  threshold?: number;
  /** Whether to skip anti-aliasing detection. */
  includeAA?: boolean;
  /** Opacity of original image in diff output. */
  alpha?: number;
  /** Color of anti-aliased pixels in diff output. */
  aaColor?: [number, number, number];
  /** Color of different pixels in diff output. */
  diffColor?: [number, number, number];
  /** Alternate diff color for dark-on-light vs light-on-dark differences. */
  diffColorAlt?: [number, number, number];
  /** Draw the diff over a transparent background (a mask) instead of the alpha-blended original. */
  diffMask?: boolean;
}

export interface DiffPngsResult {
  ok: true;
  width: number;
  height: number;
  diffPixelCount: number;
  threshold: number;
}

export interface DiffPngsDimensionMismatchError {
  ok: false;
  code: "dimension_mismatch";
  message: string;
  before: { width: number; height: number };
  after: { width: number; height: number };
}

export type DiffPngsOutcome = DiffPngsResult | DiffPngsDimensionMismatchError;

const DEFAULT_THRESHOLD = 0.1;

/**
 * Reads two PNGs from disk, pixel-diffs them, and writes a diff PNG to `out`.
 *
 * Returns a structured `{ ok: false, code: "dimension_mismatch", ... }` result
 * (never a bare throw) when the two images have different dimensions, since
 * pixelmatch requires equally sized images.
 */
export function diffPngs(
  before: string,
  after: string,
  out: string,
  options: DiffPngsOptions = {}
): DiffPngsOutcome {
  const beforePng = readPng(before);
  const afterPng = readPng(after);

  if (beforePng.width !== afterPng.width || beforePng.height !== afterPng.height) {
    return {
      ok: false,
      code: "dimension_mismatch",
      message:
        `cannot diff PNGs with mismatched dimensions: ` +
        `before is ${beforePng.width}x${beforePng.height} (${before}), ` +
        `after is ${afterPng.width}x${afterPng.height} (${after})`,
      before: { width: beforePng.width, height: beforePng.height },
      after: { width: afterPng.width, height: afterPng.height },
    };
  }

  const { width, height } = beforePng;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const diff = new PNG({ width, height });

  const diffPixelCount = pixelmatch(beforePng.data, afterPng.data, diff.data, width, height, {
    threshold,
    includeAA: options.includeAA,
    alpha: options.alpha,
    aaColor: options.aaColor,
    diffColor: options.diffColor,
    diffColorAlt: options.diffColorAlt,
    diffMask: options.diffMask,
  });

  writePngPrivate(out, PNG.sync.write(diff));

  return { ok: true, width, height, diffPixelCount, threshold };
}

function readPng(pngPath: string): PNG {
  const buf = fs.readFileSync(pngPath);
  return PNG.sync.read(buf);
}

/**
 * Writes a PNG buffer to `outPath` with private permissions (dir 0700, file
 * 0600). Callers that already write into a session/oneshot artifact tree
 * created via the shared secure artifact filesystem helpers get private dirs
 * for free; this is a defensive floor for standalone use of `diffPngs`.
 */
function writePngPrivate(outPath: string, data: Buffer): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outPath, data, { mode: 0o600 });
}
