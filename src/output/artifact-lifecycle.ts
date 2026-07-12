/**
 * Private hard-cut artifact ownership and publication substrate.
 *
 * This is deliberately not imported by legacy handlers. New acquisition and
 * read leaves use it at cutover; legacy active-session resolution remains
 * isolated in output/artifact.ts until then.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import { CAPTURE_ROOT, DIR_MODE, ensurePrivateDir, writeJsonPrivate } from '../session/artifacts.js';
import { SnapshotMetaV2, SourceArtifactManifest, validateSnapshotMetaV2 } from '../contracts/snapshot.js';

export const SNAPSHOT_ID_PATTERN = /^snap_[0-9a-z]{26}$/;
export const SESSION_ID_PATTERN = /^ses_[0-9a-z]{26}$/;
export const PUBLICATION_OPERATION_ID_PATTERN = /^pub_[0-9a-z]{26}$/;
export const MAX_ARTIFACT_LOCATOR_SOURCE_BYTES = 512;
export const MAX_ARTIFACT_LOCATOR_ENCODED_BYTES = 768;

/** The only artifact owner classes. A leaf cannot borrow another class's tree. */
export type ArtifactOwner = 'snapshot-source' | 'derived-read' | 'direct-read' | 'sweep-observation';
/** Exact U1 canonical measurement leaf suffixes; aliases cannot acquire an owner. */
export type MeasurementLeafPath = 'snap' | 'check' | 'diff' | 'census' | 'explain' | 'resolve' | 'sweep' | 'map scroll' | 'map layers' | 'map focus';
export const MEASUREMENT_ARTIFACT_OWNERS = {
  snap: 'snapshot-source',
  check: 'derived-read',
  diff: 'derived-read',
  census: 'derived-read',
  explain: 'direct-read',
  resolve: 'direct-read',
  sweep: 'sweep-observation',
  'map scroll': 'derived-read',
  'map layers': 'derived-read',
  'map focus': 'derived-read',
} as const satisfies Record<MeasurementLeafPath, ArtifactOwner>;

export type SnapshotAssociation = 'one-shot' | { readonly sessionId: string };

export interface SnapshotIndexEntry {
  readonly snapshotId: string;
  readonly absoluteDirectory: string;
  readonly association: SnapshotAssociation;
  /** Repeats the final meta marker to prove this index published that tree. */
  readonly publicationOperationId: string;
}

export interface SourceArtifactInventoryEntry {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** A stable inventory for embedding in the immutable `meta.json` source manifest. */
export interface SourceArtifactInventory {
  readonly schemaVersion: 1;
  readonly artifacts: readonly SourceArtifactInventoryEntry[];
}

export interface PublicationMarker {
  readonly state: 'unpublished-final';
  readonly snapshotId: string;
  readonly publicationOperationId: string;
  readonly ownerPid: number;
  readonly ownerProcessStartIdentity: string | null;
  readonly finalDirectory: string;
}

export interface SnapshotStaging {
  readonly snapshotId: string;
  readonly publicationOperationId: string;
  readonly directory: string;
  readonly finalDirectory: string;
}

export class ArtifactLifecycleError extends Error {
  constructor(readonly code: 'artifact_path_too_long' | 'snapshot_not_found' | 'snapshot_publication_owner_live' | 'snapshot_index_recovery_failed' | 'snapshot_publication_invalid' | 'artifact_lifecycle_lock_unavailable', message: string) {
    super(message);
    this.name = 'ArtifactLifecycleError';
  }
}

function rootFor(root = CAPTURE_ROOT): string {
  const resolved = path.resolve(root);
  const captureRoot = path.resolve(CAPTURE_ROOT);
  if (resolved === captureRoot) {
    try {
      const stat = fs.lstatSync(resolved);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`capture root is not a private directory: ${resolved}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      fs.mkdirSync(resolved, { recursive: true, mode: DIR_MODE });
    }
    fs.chmodSync(resolved, DIR_MODE);
    return resolved;
  }
  return ensurePrivateDir(resolved);
}
function readRootFor(root = CAPTURE_ROOT): string {
  const resolved = path.resolve(root);
  const captureRoot = path.resolve(CAPTURE_ROOT);
  if (resolved !== captureRoot && !isStrictlyUnder(captureRoot, resolved)) {
    throw new ArtifactLifecycleError('snapshot_not_found', `artifact root escapes Capture root: ${resolved}`);
  }
  return resolved;
}
function snapshotsDir(root: string): string { return path.join(root, 'snapshots'); }
function stagingDir(root: string): string { return path.join(root, 'snapshot-staging'); }
function allocationsDir(root: string): string { return path.join(root, 'snapshot-allocations'); }
function indexDir(root: string): string { return path.join(root, 'snapshot-index'); }
function quarantineDir(root: string): string { return path.join(root, 'snapshot-recovery-quarantine'); }
function indexPath(root: string, snapshotId: string): string { return path.join(indexDir(root), `${snapshotId}.json`); }

function bytes(value: string): number { return Buffer.byteLength(value, 'utf8'); }
function randomId(prefix: 'snap' | 'pub'): string {
  // base36 digits only; rejection sampling avoids an accidental shorter ID.
  let out = '';
  while (out.length < 26) out += BigInt(`0x${crypto.randomBytes(16).toString('hex')}`).toString(36);
  return `${prefix}_${out.slice(0, 26)}`;
}
function requireSnapshotId(id: string): void {
  if (!SNAPSHOT_ID_PATTERN.test(id)) throw new ArtifactLifecycleError('snapshot_not_found', `invalid snapshot id ${JSON.stringify(id)}`);
}
function requireOperationId(id: string): void {
  if (!PUBLICATION_OPERATION_ID_PATTERN.test(id)) throw new ArtifactLifecycleError('snapshot_publication_invalid', `invalid publication operation id ${JSON.stringify(id)}`);
}
function isSnapshotAssociation(value: unknown): value is SnapshotAssociation {
  return value === 'one-shot' || (typeof value === 'object' && value !== null && Object.keys(value).length === 1 && typeof (value as { sessionId?: unknown }).sessionId === 'string' && SESSION_ID_PATTERN.test((value as { sessionId: string }).sessionId));
}
function isStrictlyUnder(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Validates a locator without shortening it. Prose and structured JSON both
 * carry the canonical JSON string literal, so JSON.stringify is the final
 * representation whose escaping must fit the encoded bound.
 */
export function validateArtifactLocator(locator: string): string {
  if (!path.isAbsolute(locator) || path.resolve(locator) !== locator) {
    throw new ArtifactLifecycleError('artifact_path_too_long', `artifact locator must be normalized absolute path: ${JSON.stringify(locator)}`);
  }
  const sourceBytes = bytes(locator);
  const jsonBytes = bytes(JSON.stringify(locator));
  // The prose encoder's XML text context expands these characters; prove both final encodings.
  const proseBytes = bytes(JSON.stringify(locator).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  const encodedBytes = Math.max(jsonBytes, proseBytes);
  if (sourceBytes > MAX_ARTIFACT_LOCATOR_SOURCE_BYTES || encodedBytes > MAX_ARTIFACT_LOCATOR_ENCODED_BYTES) {
    throw new ArtifactLifecycleError('artifact_path_too_long', `artifact locator exceeds limits (source=${sourceBytes}/${MAX_ARTIFACT_LOCATOR_SOURCE_BYTES}, encoded=${encodedBytes}/${MAX_ARTIFACT_LOCATOR_ENCODED_BYTES}); use a shorter Capture root or snapshot path`);
  }
  return locator;
}

/** Inventory excludes `meta.json`: callers embed this value into that file. */
export function buildSourceArtifactInventory(directory: string): SourceArtifactInventory {
  const root = path.resolve(directory);
  validateArtifactLocator(root);
  const artifacts: SourceArtifactInventoryEntry[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && path.relative(root, full) !== 'meta.json') {
        const relative = path.relative(root, full).split(path.sep).join('/');
        artifacts.push({ path: relative, bytes: fs.statSync(full).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') });
      } else if (entry.isSymbolicLink()) {
        throw new ArtifactLifecycleError('snapshot_publication_invalid', `source artifact inventory refuses symlink ${full}`);
      }
    }
  };
  walk(root);
  return { schemaVersion: 1, artifacts };
}

/** Current process identity used by split recovery; null means it cannot be attested live. */
export function currentProcessStartIdentity(pid = process.pid): string | null {
  try {
    // Portable enough for supported unix hosts; exact PID-start pairing prevents PID reuse from looking live.
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}
function markerIsLive(marker: PublicationMarker): boolean {
  if (!marker.ownerProcessStartIdentity || marker.ownerPid <= 0) return false;
  return currentProcessStartIdentity(marker.ownerPid) === marker.ownerProcessStartIdentity;
}

/** An owner-attested lock: dead holders are reclaimed by PID/start identity, never elapsed time. */
export function withSnapshotIndexLock<T>(fn: () => T, artifactRoot = CAPTURE_ROOT): T {
  const root = rootFor(artifactRoot);
  const lock = path.join(root, '.snapshot-index.lock');
  for (;;) {
    try {
      fs.mkdirSync(lock, { mode: DIR_MODE });
      writeJsonPrivate(path.join(lock, 'owner.json'), { pid: process.pid, processStartIdentity: currentProcessStartIdentity() });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      let owner: { pid?: unknown; processStartIdentity?: unknown } | null = null;
      try { owner = readJson(path.join(lock, 'owner.json')) as { pid?: unknown; processStartIdentity?: unknown }; } catch { /* interrupted lock creation is reclaimable */ }
      const live = typeof owner?.pid === 'number' && typeof owner.processStartIdentity === 'string' && currentProcessStartIdentity(owner.pid) === owner.processStartIdentity;
      if (live) throw new ArtifactLifecycleError('artifact_lifecycle_lock_unavailable', 'snapshot index lock is held by a live operation');
      fs.rmSync(lock, { recursive: true, force: true });
    }
  }
  try { return fn(); }
  finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

function readJson(file: string): unknown { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function parseMarker(value: unknown): PublicationMarker | null {
  if (!value || typeof value !== 'object') return null;
  const publication = (value as { publication?: unknown }).publication;
  if (!publication || typeof publication !== 'object') return null;
  const p = publication as Partial<PublicationMarker>;
  if (p.state !== 'unpublished-final' || typeof p.snapshotId !== 'string' || !SNAPSHOT_ID_PATTERN.test(p.snapshotId) || typeof p.publicationOperationId !== 'string' || !PUBLICATION_OPERATION_ID_PATTERN.test(p.publicationOperationId) || !Number.isSafeInteger(p.ownerPid) || p.ownerPid <= 0 || (p.ownerProcessStartIdentity !== null && typeof p.ownerProcessStartIdentity !== 'string') || typeof p.finalDirectory !== 'string' || !path.isAbsolute(p.finalDirectory) || path.resolve(p.finalDirectory) !== p.finalDirectory) return null;
  return p as PublicationMarker;
}

/** Removes/quarantines only unindexed finalized trees whose owner is provably not live. */
function recoverUnpublishedSnapshotsUnderLock(artifactRoot = CAPTURE_ROOT): void {
  const root = rootFor(artifactRoot);
  ensurePrivateDir(snapshotsDir(root));
  for (const entry of fs.readdirSync(snapshotsDir(root), { withFileTypes: true })) {
    if (!entry.isDirectory() || !SNAPSHOT_ID_PATTERN.test(entry.name)) continue;
    const finalDirectory = path.join(snapshotsDir(root), entry.name);
    const metaPath = path.join(finalDirectory, 'meta.json');
    let marker: PublicationMarker | null = null;
    try { marker = parseMarker(readJson(metaPath)); } catch { continue; }
    if (!marker || marker.snapshotId !== entry.name || marker.finalDirectory !== finalDirectory || fs.existsSync(indexPath(root, entry.name))) continue;
    if (markerIsLive(marker)) throw new ArtifactLifecycleError('snapshot_publication_owner_live', `unpublished snapshot ${entry.name} is owned by live process ${marker.ownerPid}`);
    try {
      fs.rmSync(finalDirectory, { recursive: true, force: true });
      if (!fs.existsSync(finalDirectory)) continue;
    } catch { /* quarantine below */ }
    const quarantine = path.join(quarantineDir(root), `${entry.name}-${marker.publicationOperationId}`);
    try {
      ensurePrivateDir(quarantineDir(root));
      fs.renameSync(finalDirectory, quarantine);
      if (!fs.existsSync(finalDirectory) && fs.existsSync(quarantine)) continue;
    } catch { /* stable failure below */ }
    throw new ArtifactLifecycleError('snapshot_index_recovery_failed', `could not delete or quarantine unpublished snapshot ${finalDirectory} for ${marker.publicationOperationId}`);
  }
}

/** Runs split recovery while holding the global publication lock. */
export function recoverUnpublishedSnapshots(artifactRoot = CAPTURE_ROOT): void {
  withSnapshotIndexLock(() => recoverUnpublishedSnapshotsUnderLock(artifactRoot), artifactRoot);
}

/** Allocates a globally unique snapshot ID and private staging tree. */
export function allocateSnapshotStaging(artifactRoot = CAPTURE_ROOT): SnapshotStaging {
  // Validate the worst-case public locator before allocating any durable state.
  const readRoot = readRootFor(artifactRoot);
  validateArtifactLocator(path.join(snapshotsDir(readRoot), `snap_${'z'.repeat(26)}`));
  return withSnapshotIndexLock(() => {
    const root = rootFor(artifactRoot);
    recoverUnpublishedSnapshotsUnderLock(root);
    ensurePrivateDir(allocationsDir(root));
    ensurePrivateDir(stagingDir(root));
    for (;;) {
      const snapshotId = randomId('snap');
      try { fs.mkdirSync(path.join(allocationsDir(root), snapshotId), { mode: DIR_MODE }); }
      catch (err) { if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue; throw err; }
      const publicationOperationId = randomId('pub');
      const directory = ensurePrivateDir(path.join(stagingDir(root), `${snapshotId}-${publicationOperationId}`));
      const finalDirectory = path.join(snapshotsDir(root), snapshotId);
      validateArtifactLocator(finalDirectory);
      return { snapshotId, publicationOperationId, directory, finalDirectory };
    }
  }, artifactRoot);
}

/** Removes only an allocation-owned staging tree. The durable allocation tombstone remains reserved. */
export function cleanupSnapshotStaging(staging: SnapshotStaging, artifactRoot = CAPTURE_ROOT): void {
  const root = rootFor(artifactRoot);
  requireSnapshotId(staging.snapshotId); requireOperationId(staging.publicationOperationId);
  const expected = path.join(stagingDir(root), `${staging.snapshotId}-${staging.publicationOperationId}`);
  if (path.resolve(staging.directory) !== expected || staging.finalDirectory !== path.join(snapshotsDir(root), staging.snapshotId)) throw new ArtifactLifecycleError('snapshot_publication_invalid', 'staging cleanup refused an unowned directory');
  fs.rmSync(staging.directory, { recursive: true, force: true });
  if (fs.existsSync(staging.directory)) throw new ArtifactLifecycleError('snapshot_publication_invalid', `could not remove staging directory ${staging.directory}`);
}

/** Direct reads expose one root plus trusted source keys, never plural or truncated paths. */
export interface DirectSourceAccess { readonly root: string; readonly manifest: 'meta.json'; readonly keys: readonly string[]; }
export function validateDirectSourceAccess(value: unknown): DirectSourceAccess {
  if (!value || typeof value !== 'object') throw new ArtifactLifecycleError('snapshot_publication_invalid', 'direct source access must be an object');
  const v = value as Partial<DirectSourceAccess>;
  if (typeof v.root !== 'string' || validateArtifactLocator(v.root) !== v.root || v.manifest !== 'meta.json' || !Array.isArray(v.keys) || v.keys.length < 1 || v.keys.length > 16 || v.keys.some(key => typeof key !== 'string' || !key || Buffer.byteLength(key, 'utf8') > 64) || new Set(v.keys).size !== v.keys.length) throw new ArtifactLifecycleError('snapshot_publication_invalid', 'direct source access is invalid');
  return { root: v.root, manifest: 'meta.json', keys: [...v.keys] };
}

/** Writes final v2 meta only after collectors have completed; publication remains impossible until the index rename. */
export function finalizeSnapshotManifest(staging: SnapshotStaging, manifest: Omit<SnapshotMetaV2, 'snapshotId'>): void {
  const finalDirectory = validateArtifactLocator(staging.finalDirectory);
  const metaPath = path.join(staging.directory, 'meta.json');
  if (fs.existsSync(metaPath)) throw new ArtifactLifecycleError('snapshot_publication_invalid', 'snapshot staging manifest is already finalized');
  if (Object.prototype.hasOwnProperty.call(manifest, 'publication') || Object.prototype.hasOwnProperty.call(manifest, 'sourceArtifactInventory')) throw new ArtifactLifecycleError('snapshot_publication_invalid', 'collectors cannot supply lifecycle fields');
  const inventory = buildSourceArtifactInventory(staging.directory);
  const source = manifest.source_artifact_manifest as SourceArtifactManifest;
  const inventoryPaths = inventory.artifacts.map(item => item.path).join('\0');
  const declaredPaths = source?.artifacts?.map(item => item.path).join('\0');
  const candidate = { ...manifest, snapshotId: staging.snapshotId } as SnapshotMetaV2;
  const validation = validateSnapshotMetaV2(candidate);
  if (!validation.valid || inventoryPaths !== declaredPaths || source.artifacts.some((item, index) => item.bytes !== inventory.artifacts[index]?.bytes || item.sha256 !== inventory.artifacts[index]?.sha256)) throw new ArtifactLifecycleError('snapshot_publication_invalid', `invalid v2 snapshot manifest: ${validation.errors.join('; ') || 'source manifest does not match finalized files'}`);
  const publication: PublicationMarker = { state: 'unpublished-final', snapshotId: staging.snapshotId, publicationOperationId: staging.publicationOperationId, ownerPid: process.pid, ownerProcessStartIdentity: currentProcessStartIdentity(), finalDirectory };
  writeJsonPrivate(metaPath, { ...candidate, sourceArtifactInventory: inventory, publication });
}

/** Two-rename publication: final tree first, global ID index second (the linearization point). */
export function publishSnapshot(staging: SnapshotStaging, association: SnapshotAssociation, artifactRoot = CAPTURE_ROOT): SnapshotIndexEntry {
  return withSnapshotIndexLock(() => {
    const root = rootFor(artifactRoot);
    recoverUnpublishedSnapshotsUnderLock(root);
    requireSnapshotId(staging.snapshotId); requireOperationId(staging.publicationOperationId);
    if (!isSnapshotAssociation(association)) throw new ArtifactLifecycleError('snapshot_publication_invalid', 'snapshot association must be one-shot or one exact session ID');
    if (path.resolve(staging.directory) !== staging.directory || !isStrictlyUnder(stagingDir(root), staging.directory)) throw new ArtifactLifecycleError('snapshot_publication_invalid', 'staging directory is outside the snapshot staging root');
    if (staging.finalDirectory !== path.join(snapshotsDir(root), staging.snapshotId)) throw new ArtifactLifecycleError('snapshot_publication_invalid', 'final directory does not match snapshot identity');
    let meta: Record<string, unknown>;
    try { meta = readJson(path.join(staging.directory, 'meta.json')) as Record<string, unknown>; }
    catch { throw new ArtifactLifecycleError('snapshot_publication_invalid', 'staging meta is missing or invalid'); }
    const marker = parseMarker(meta);
    if (!marker || marker.snapshotId !== staging.snapshotId || marker.publicationOperationId !== staging.publicationOperationId || marker.finalDirectory !== staging.finalDirectory) throw new ArtifactLifecycleError('snapshot_publication_invalid', 'staging meta does not carry the matching unpublished-final marker');
    const recordedInventory = meta.sourceArtifactInventory;
    const actualInventory = buildSourceArtifactInventory(staging.directory);
    if (JSON.stringify(recordedInventory) !== JSON.stringify(actualInventory)) throw new ArtifactLifecycleError('snapshot_publication_invalid', 'source artifacts changed after manifest finalization');
    ensurePrivateDir(snapshotsDir(root));
    if (fs.existsSync(staging.finalDirectory) || fs.existsSync(indexPath(root, staging.snapshotId))) throw new ArtifactLifecycleError('snapshot_publication_invalid', `snapshot identity ${staging.snapshotId} is already published or finalized`);
    fs.renameSync(staging.directory, staging.finalDirectory);
    const index: SnapshotIndexEntry = { snapshotId: staging.snapshotId, absoluteDirectory: validateArtifactLocator(staging.finalDirectory), association, publicationOperationId: staging.publicationOperationId };
    writeJsonPrivate(indexPath(root, staging.snapshotId), index);
    return index;
  }, artifactRoot);
}

/** Resolves only an exact globally-indexed ID or a normalized absolute root. Never reads active session state. */
export function resolveSnapshotRoot(ref: string, artifactRoot = CAPTURE_ROOT): SnapshotIndexEntry {
  // Read resolution deliberately creates no root, lock, recovery, or session state.
  const root = readRootFor(artifactRoot);
  if (path.isAbsolute(ref)) {
    const absoluteDirectory = validateArtifactLocator(ref);
    let marker: PublicationMarker | null;
    try { marker = parseMarker(readJson(path.join(absoluteDirectory, 'meta.json'))); }
    catch { throw new ArtifactLifecycleError('snapshot_not_found', `absolute snapshot directory is unavailable: ${absoluteDirectory}`); }
    if (!marker) throw new ArtifactLifecycleError('snapshot_not_found', `absolute snapshot directory has no immutable published meta: ${absoluteDirectory}`);
    const entry = readSnapshotIndex(root, marker.snapshotId);
    if (entry.absoluteDirectory !== absoluteDirectory) throw new ArtifactLifecycleError('snapshot_not_found', `absolute snapshot directory is not the indexed root for ${marker.snapshotId}`);
    return entry;
  }
  requireSnapshotId(ref);
  return readSnapshotIndex(root, ref);
}
function readSnapshotIndex(root: string, snapshotId: string): SnapshotIndexEntry {
  let raw: unknown;
  try { raw = readJson(indexPath(root, snapshotId)); }
  catch { throw new ArtifactLifecycleError('snapshot_not_found', `snapshot ${snapshotId} is not globally published`); }
  if (!raw || typeof raw !== 'object') throw new ArtifactLifecycleError('snapshot_not_found', `snapshot ${snapshotId} is not globally published`);
  const entry = raw as Partial<SnapshotIndexEntry>;
  const associationValid = isSnapshotAssociation(entry.association);
  if (entry.snapshotId !== snapshotId || typeof entry.absoluteDirectory !== 'string' || entry.absoluteDirectory !== path.join(snapshotsDir(root), snapshotId) || !associationValid || typeof entry.publicationOperationId !== 'string' || !PUBLICATION_OPERATION_ID_PATTERN.test(entry.publicationOperationId)) throw new ArtifactLifecycleError('snapshot_not_found', `snapshot index entry for ${snapshotId} is invalid`);
  try {
    validateArtifactLocator(entry.absoluteDirectory);
    const marker = parseMarker(readJson(path.join(entry.absoluteDirectory, 'meta.json')));
    if (!marker || marker.snapshotId !== snapshotId || marker.publicationOperationId !== entry.publicationOperationId || marker.finalDirectory !== entry.absoluteDirectory) throw new Error('published marker mismatch');
  } catch (error) {
    if (error instanceof ArtifactLifecycleError && error.code === 'artifact_path_too_long') throw error;
    throw new ArtifactLifecycleError('snapshot_not_found', `published snapshot root is unavailable or does not match its index: ${snapshotId}`);
  }
  return entry as SnapshotIndexEntry;
}
