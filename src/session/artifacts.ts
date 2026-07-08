/**
 * Secure artifact filesystem — the one place every session/oneshot artifact
 * writer (screenshots, HAR, snapshot substrate, recordings) goes through.
 *
 * Contract: directories are created `0700`, files are created `0600`,
 * writes are atomic (temp file + rename) and never follow a symlink planted
 * at the destination, and every helper refuses to operate outside
 * `CAPTURE_ROOT`. Downstream units (snapshot collectors, the recorder
 * bridge, motion query leaves) write ALL artifacts through these helpers
 * instead of ad-hoc `fs.writeFile`/`fs.mkdirSync`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** The one canonical session/oneshot root. Every artifact lives under here. */
export const CAPTURE_ROOT = path.join(os.tmpdir(), 'capture-sessions');

/** Owner rwx only. */
export const DIR_MODE = 0o700;
/** Owner rw only. */
export const FILE_MODE = 0o600;

// ============================================================================
// Meta.json contracts — the shape session stop() reads back out of
// measure/snaps/*/meta.json and motion/recs/*/meta.json to build the bundle
// manifest's `snaps`/`recs` arrays. Later units (U06 snapshot orchestrator,
// U13/U14 recorder) write meta.json in this shape.
// ============================================================================

export interface SnapMeta {
  id: string;
  url: string | null;
  viewport: string | null;
  settled: boolean;
  capturedAt: string;
}

export interface RecMeta {
  id: string;
  action: string | null;
  frames: number;
  durationMs: number;
  state: string;
}

// ============================================================================
// Path boundary
// ============================================================================

/**
 * Resolves `targetPath` to an absolute path and throws unless it is
 * strictly under `CAPTURE_ROOT`. Every write/cleanup helper below routes
 * through this so a caller can never be tricked (or mistaken) into writing
 * or deleting outside the capture artifact tree.
 */
export function assertUnderCaptureRoot(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(CAPTURE_ROOT);
  const rel = path.relative(root, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`artifact path escapes capture root ${root}: ${targetPath}`);
  }
  return resolved;
}

// ============================================================================
// Directories
// ============================================================================

/** Creates (or re-secures) one path segment as a private, non-symlink dir. */
function ensureSegmentPrivate(dirPath: string): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(dirPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    fs.mkdirSync(dirPath, { mode: DIR_MODE });
    // mkdir's mode is masked by umask; enforce explicitly.
    fs.chmodSync(dirPath, DIR_MODE);
    return;
  }
  if (st.isSymbolicLink()) {
    throw new Error(`refusing to use a symlinked artifact directory: ${dirPath}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`artifact path exists and is not a directory: ${dirPath}`);
  }
  fs.chmodSync(dirPath, DIR_MODE);
}

/**
 * Ensures `dirPath` and every missing ancestor up to (and including)
 * `CAPTURE_ROOT` exist as private (`0700`), non-symlink directories.
 * Existing directories in the chain are re-chmod'd to `0700` rather than
 * trusted. Returns the resolved absolute path. Throws if `dirPath` is not
 * under `CAPTURE_ROOT`, or if any path segment is a symlink or a
 * non-directory.
 */
export function ensurePrivateDir(dirPath: string): string {
  const resolved = assertUnderCaptureRoot(dirPath);
  const root = path.resolve(CAPTURE_ROOT);

  ensureSegmentPrivate(root);
  const rel = path.relative(root, resolved);
  let current = root;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    ensureSegmentPrivate(current);
  }
  return resolved;
}

// ============================================================================
// Atomic, no-symlink-follow writes
// ============================================================================

function refuseExistingSymlink(resolved: string): void {
  try {
    const st = fs.lstatSync(resolved);
    if (st.isSymbolicLink()) {
      throw new Error(`refusing to write through a symlink: ${resolved}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/**
 * Writes `data` to `filePath` as a private (`0600`) file, atomically:
 * writes to a uniquely-named temp file in the same directory (opened with
 * `O_NOFOLLOW`, so a pre-planted symlink at the temp name can't be written
 * through) and renames it over the destination. `rename(2)` replaces
 * whatever is at the destination — including a symlink — without ever
 * following it, so a symlink swapped in at `filePath` between calls is
 * unlinked, never written through. Ensures the parent directory exists
 * (and is private) first. This is the one primitive every other write
 * helper in this module is built on.
 */
export function writePrivateFile(filePath: string, data: string | Buffer): void {
  const resolved = assertUnderCaptureRoot(filePath);
  const dir = path.dirname(resolved);
  ensurePrivateDir(dir);
  refuseExistingSymlink(resolved);

  const tmpPath = path.join(dir, `.${path.basename(resolved)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  const fd = fs.openSync(
    tmpPath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW,
    FILE_MODE,
  );
  try {
    fs.writeSync(fd, data);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(tmpPath, FILE_MODE);
  fs.renameSync(tmpPath, resolved);
}

/** Writes `value` as pretty-printed JSON through {@link writePrivateFile}. */
export function writeJsonPrivate(filePath: string, value: unknown): void {
  writePrivateFile(filePath, JSON.stringify(value, null, 2));
}

/**
 * Writes `records` as a complete newline-delimited JSON file (one JSON
 * value per line), replacing any existing content atomically. For
 * incremental line-at-a-time appends (e.g. a live recorder streaming
 * frames/events), use {@link appendNdjsonPrivate} instead.
 */
export function writeNdjsonPrivate(filePath: string, records: unknown[]): void {
  const body = records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '');
  writePrivateFile(filePath, body);
}

/**
 * Appends one record as a single NDJSON line to `filePath`, creating it
 * (private, `0600`) if absent. Not atomic across the whole file the way
 * {@link writePrivateFile} is — it's the incremental-write counterpart used
 * while a recording is live — but still refuses to append through a
 * symlink and enforces the private mode on every call.
 */
export function appendNdjsonPrivate(filePath: string, record: unknown): void {
  const resolved = assertUnderCaptureRoot(filePath);
  const dir = path.dirname(resolved);
  ensurePrivateDir(dir);
  refuseExistingSymlink(resolved);

  const line = JSON.stringify(record) + '\n';
  const fd = fs.openSync(
    resolved,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW,
    FILE_MODE,
  );
  try {
    fs.writeSync(fd, line);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(resolved, FILE_MODE);
}

/**
 * Writes binary artifact data (PNG crops, `video.webm`, ...) through
 * {@link writePrivateFile}. A distinct named export for call-site clarity;
 * behavior is identical to passing a `Buffer` to `writePrivateFile`.
 */
export function writeBinaryPrivate(filePath: string, data: Buffer): void {
  writePrivateFile(filePath, data);
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Recursively removes the artifact tree at `targetPath` (a one-shot
 * session dir, an active session's `measure/snaps/{id}`, a
 * `motion/recs/{id}`, ...). Refuses any path that is not strictly under
 * `CAPTURE_ROOT` (including `CAPTURE_ROOT` itself). If `targetPath` is
 * itself a symlink, only the symlink is unlinked — its target is never
 * traversed or deleted.
 */
export function removeArtifactTree(targetPath: string): void {
  const resolved = assertUnderCaptureRoot(targetPath);
  fs.rmSync(resolved, { recursive: true, force: true });
}
