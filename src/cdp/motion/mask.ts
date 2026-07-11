import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';

import { diffPngs } from '../../output/diff.js';
import { artifactPath, readMeta, readRects, type RecRef } from '../../output/artifact.js';
import { ensurePrivateDir, writeBinaryPrivate } from '../../session/artifacts.js';

export interface MotionRect {
  frame: number;
  file?: string;
  screencastTimestamp?: number | null;
  elements?: MotionElement[];
}

interface MotionElement {
  tag?: string;
  id?: string | null;
  classes?: string | null;
  backendNodeId?: number | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface MotionMaskRegion {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  areaPixels: number;
  distancePx: number;
  velocityPxPerSecond: number;
  startMs: number;
  endMs: number;
  element?: { label: string; backendNodeId?: number };
}

export interface MotionMaskResult {
  outputPath: string;
  width: number;
  height: number;
  comparedFramePairs: number;
  regions: MotionMaskRegion[];
  /**
   * Set only when the recording spans more than one viewport size: a factual
   * provenance note stating which contiguous same-size frame run the composite
   * and region facts were computed over, its dimensions, and that frames of a
   * different size were excluded. Undefined when every frame shared one size.
   */
  caveat?: string;
}

interface ChangeSample {
  pair: number;
  pixels: Array<{ x: number; y: number }>;
}

interface Component {
  pixels: Array<{ x: number; y: number }>;
  lookup: Set<number>;
}

/**
 * Creates the recording's `motion-mask.png`: transparent where no adjacent
 * frames differ and blue-to-red by the latest changed frame where they do.
 * Pairwise raster comparisons intentionally route through `diffPngs`, the
 * shared pixel wrapper, rather than duplicating pixelmatch configuration.
 */
export function createMotionMask(ref: RecRef): MotionMaskResult {
  const framesDir = recordingArtifactPath(ref, 'frames');
  if (!fs.statSync(framesDir).isDirectory()) {
    throw new Error(`Recording ${ref.id} has frames but ${framesDir} is not a directory; create a finalized recording with \`capture motion rec\`.`);
  }
  const allFrameFiles = fs.readdirSync(framesDir)
    .filter((name) => name.endsWith('.png'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (allFrameFiles.length < 2) {
    throw new Error(`Recording ${ref.id} has ${allFrameFiles.length} frame PNG(s) at ${framesDir}; motion mask needs at least two frames. Record again with \`capture motion rec\`.`);
  }

  // A recording that spans a viewport resize holds frames of more than one
  // size. Rather than fail the whole recording, measure over the longest
  // contiguous run of same-size frames and report a caveat naming that run.
  const dims = allFrameFiles.map((name) => readPngDimensions(path.join(framesDir, name)));
  const run = longestSameSizeRun(dims);
  if (run.length < 2) {
    throw new Error(`Recording ${ref.id} has no contiguous run of two or more same-size frames at ${framesDir}; every adjacent frame pair differs in viewport size, so a motion composite cannot be built. Record again at one viewport size with \`capture motion rec\`.`);
  }
  const frameFiles = allFrameFiles.slice(run.start, run.start + run.length);
  const runDims = dims[run.start];
  const excludedCount = allFrameFiles.length - frameFiles.length;
  const caveat = excludedCount > 0
    ? `Partial-window fallback: recorded frames span more than one viewport size. Composite and region facts cover only the longest contiguous same-size run — frames ${run.start}\u2013${run.start + run.length - 1} (${frameFiles[0]}\u2013${frameFiles[frameFiles.length - 1]}) at ${runDims.width}\u00d7${runDims.height}. ${excludedCount} frame(s) outside this run were excluded; some may share these dimensions.`
    : undefined;

  // Region facts (attribution, distance, velocity, timing) must cover ONLY the
  // selected same-size run — the same window the raster composite spans. Rect
  // records from excluded frames are dropped here so an element that appears
  // only outside the run cannot win attribution or contribute movement.
  const runFiles = new Set(frameFiles);
  const rectRecords = readRects<MotionRect>(ref).sort((a, b) => a.frame - b.frame);
  const recordsByFile = new Map(rectRecords.filter((record) => record.file && runFiles.has(record.file)).map((record) => [record.file!, record]));
  const meta = readMeta<{ durationMs?: unknown }>(ref);
  const outputPath = path.join(ref.dir, 'motion-mask.png');
  const workDir = path.join(ref.dir, '.motion-mask-work');
  ensurePrivateDir(workDir);

  try {
    let width = 0;
    let height = 0;
    let composite: PNG | undefined;
    const samples: ChangeSample[] = [];

    for (let pair = 0; pair < frameFiles.length - 1; pair++) {
      const before = path.join(framesDir, frameFiles[pair]);
      const after = path.join(framesDir, frameFiles[pair + 1]);
      const diffPath = path.join(workDir, `pair-${String(pair).padStart(6, '0')}.png`);
      const outcome = diffPngs(before, after, diffPath, { diffMask: true });
      if (!outcome.ok) {
        throw new Error(`Frame dimensions differ between ${frameFiles[pair]} (${outcome.before.width}x${outcome.before.height}) and ${frameFiles[pair + 1]} (${outcome.after.width}x${outcome.after.height}); a motion composite requires one viewport size.`);
      }
      if (!composite) {
        width = outcome.width;
        height = outcome.height;
        composite = new PNG({ width, height, fill: true });
      }
      const diff = PNG.sync.read(fs.readFileSync(diffPath));
      const pixels: Array<{ x: number; y: number }> = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const offset = (y * width + x) * 4;
          // pixelmatch's diffMask leaves unchanged pixels transparent.
          if (diff.data[offset + 3] === 0) continue;
          pixels.push({ x, y });
          const [r, g, b] = hueForPair(pair, frameFiles.length - 2);
          composite.data[offset] = r;
          composite.data[offset + 1] = g;
          composite.data[offset + 2] = b;
          composite.data[offset + 3] = 255;
        }
      }
      samples.push({ pair, pixels });
    }

    if (!composite) throw new Error(`Recording ${ref.id} had no readable frame pairs.`);
    writeBinaryPrivate(outputPath, PNG.sync.write(composite));
    const components = connectedComponents(composite, width, height);
    const durationMs = finiteNumber(meta.durationMs) ?? 0;
    const regions = components.map((component, index) => regionForComponent(
      component,
      index + 1,
      samples,
      frameFiles,
      recordsByFile,
      durationMs,
      width,
      run.start,
      allFrameFiles.length,
    ));
    return { outputPath, width, height, comparedFramePairs: samples.length, regions, caveat };
  } finally {
    // The wrapper's pairwise outputs are private transient files, not
    // recording artifacts. The final composite is atomically private-written.
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function readPngDimensions(file: string): { width: number; height: number } {
  // PNG dimensions live in the IHDR chunk: 8-byte signature, 4-byte length,
  // 4-byte "IHDR", then big-endian uint32 width (offset 16) and height (20).
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(24);
    fs.readSync(fd, header, 0, 24, 0);
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

function longestSameSizeRun(dims: Array<{ width: number; height: number }>): { start: number; length: number } {
  let bestStart = 0;
  let bestLength = dims.length ? 1 : 0;
  let runStart = 0;
  for (let i = 1; i < dims.length; i++) {
    if (dims[i].width !== dims[i - 1].width || dims[i].height !== dims[i - 1].height) runStart = i;
    const length = i - runStart + 1;
    if (length > bestLength) {
      bestLength = length;
      bestStart = runStart;
    }
  }
  return { start: bestStart, length: bestLength };
}

function recordingArtifactPath(ref: RecRef, filename: string): string {
  try {
    return artifactPath(ref, filename);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${detail} — create a finalized recording with \`capture motion rec\`.`);
  }
}

function connectedComponents(composite: PNG, width: number, height: number): Component[] {
  const seen = new Uint8Array(width * height);
  const components: Component[] = [];
  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || composite.data[start * 4 + 3] === 0) continue;
    const pixels: Array<{ x: number; y: number }> = [];
    const lookup = new Set<number>();
    const queue = [start];
    seen[start] = 1;
    while (queue.length) {
      const current = queue.pop()!;
      const x = current % width;
      const y = Math.floor(current / width);
      pixels.push({ x, y });
      lookup.add(current);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[next] || composite.data[next * 4 + 3] === 0) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    components.push({ pixels, lookup });
  }
  return components.sort((a, b) => b.pixels.length - a.pixels.length);
}

function regionForComponent(
  component: Component,
  index: number,
  samples: ChangeSample[],
  frameFiles: string[],
  recordsByFile: Map<string, MotionRect>,
  durationMs: number,
  width: number,
  runStart: number,
  totalFrames: number,
): MotionMaskRegion {
  const xs = component.pixels.map((pixel) => pixel.x);
  const ys = component.pixels.map((pixel) => pixel.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const activeSamples = samples.filter((sample) => sample.pixels.some((pixel) => component.lookup.has(pixel.y * width + pixel.x)));
  const startPair = activeSamples[0]?.pair ?? 0;
  const endPair = activeSamples.at(-1)?.pair ?? startPair;
  const startMs = timestampForPair(startPair, frameFiles, recordsByFile, durationMs, runStart, totalFrames);
  const endMs = timestampForPair(endPair + 1, frameFiles, recordsByFile, durationMs, runStart, totalFrames);
  const attribution = attributeElement(component, recordsByFile, width);
  const rectDistance = attribution ? distanceForElement(attribution.element, recordsByFile) : null;
  const pixelDistance = centroidDistance(activeSamples, component, width);
  const distancePx = round2(rectDistance ?? pixelDistance);
  const elapsedSeconds = Math.max(0, endMs - startMs) / 1000;
  return {
    index,
    x,
    y,
    width: right - x + 1,
    height: bottom - y + 1,
    areaPixels: component.pixels.length,
    distancePx,
    velocityPxPerSecond: round2(elapsedSeconds > 0 ? distancePx / elapsedSeconds : 0),
    startMs: round2(startMs),
    endMs: round2(endMs),
    element: attribution ? { label: elementLabel(attribution.element), ...(typeof attribution.element.backendNodeId === 'number' ? { backendNodeId: attribution.element.backendNodeId } : {}) } : undefined,
  };
}

function attributeElement(component: Component, recordsByFile: Map<string, MotionRect>, width: number): { element: MotionElement; overlap: number } | null {
  const candidates = new Map<string, { element: MotionElement; overlap: number }>();
  for (const record of recordsByFile.values()) {
    for (const element of record.elements ?? []) {
      if (![element.x, element.y, element.width, element.height].every((value) => typeof value === 'number' && Number.isFinite(value))) continue;
      let overlap = 0;
      for (let py = Math.max(0, Math.floor(element.y!)); py < Math.ceil(element.y! + element.height!); py++) {
        for (let px = Math.max(0, Math.floor(element.x!)); px < Math.ceil(element.x! + element.width!); px++) {
          if (component.lookup.has(py * width + px)) overlap++;
        }
      }
      if (!overlap) continue;
      const key = typeof element.backendNodeId === 'number' ? `backend:${element.backendNodeId}` : elementLabel(element);
      const existing = candidates.get(key);
      if (!existing) candidates.set(key, { element, overlap });
      else existing.overlap += overlap;
    }
  }
  return [...candidates.values()].sort((a, b) => b.overlap - a.overlap)[0] ?? null;
}

function distanceForElement(target: MotionElement, recordsByFile: Map<string, MotionRect>): number | null {
  const key = typeof target.backendNodeId === 'number' ? `backend:${target.backendNodeId}` : elementLabel(target);
  const centers: Array<{ x: number; y: number }> = [];
  for (const record of [...recordsByFile.values()].sort((a, b) => a.frame - b.frame)) {
    const element = (record.elements ?? []).find((candidate) => (typeof candidate.backendNodeId === 'number' ? `backend:${candidate.backendNodeId}` : elementLabel(candidate)) === key);
    if (!element || ![element.x, element.y, element.width, element.height].every((value) => typeof value === 'number' && Number.isFinite(value))) continue;
    centers.push({ x: element.x! + element.width! / 2, y: element.y! + element.height! / 2 });
  }
  if (centers.length < 2) return null;
  return centers.slice(1).reduce((total, center, i) => total + Math.hypot(center.x - centers[i].x, center.y - centers[i].y), 0);
}

function centroidDistance(samples: ChangeSample[], component: Component, width: number): number {
  const centers = samples.map((sample) => {
    const pixels = sample.pixels.filter((pixel) => component.lookup.has(pixel.y * width + pixel.x));
    if (!pixels.length) return null;
    return pixels.reduce((sum, pixel) => ({ x: sum.x + pixel.x / pixels.length, y: sum.y + pixel.y / pixels.length }), { x: 0, y: 0 });
  }).filter((center): center is { x: number; y: number } => center !== null);
  return centers.slice(1).reduce((total, center, i) => total + Math.hypot(center.x - centers[i].x, center.y - centers[i].y), 0);
}

function timestampForPair(pair: number, frameFiles: string[], recordsByFile: Map<string, MotionRect>, durationMs: number, runStart: number, totalFrames: number): number {
  const record = recordsByFile.get(frameFiles[Math.min(pair, frameFiles.length - 1)]);
  const first = recordsByFile.get(frameFiles[0])?.screencastTimestamp;
  if (typeof record?.screencastTimestamp === 'number' && typeof first === 'number') return (record.screencastTimestamp - first) * 1000;
  // Absent rect timestamps: map this pair's ABSOLUTE frame index across the
  // whole recording's duration so timing stays scoped to the selected run's
  // slice, not stretched to fill the full durationMs.
  return totalFrames > 1 ? ((runStart + pair) / (totalFrames - 1)) * durationMs : 0;
}

function elementLabel(element: MotionElement): string {
  const tag = element.tag || 'element';
  const id = element.id ? `#${element.id}` : '';
  const classes = element.classes ? `.${element.classes.trim().split(/\s+/).filter(Boolean).join('.')}` : '';
  return `${tag}${id}${classes}`;
}

function hueForPair(pair: number, pairs: number): [number, number, number] {
  const hue = 220 * (1 - (pairs <= 1 ? 1 : pair / (pairs - 1)));
  const c = 1;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : [0, x, c];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
