import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate } from '../src/session/artifacts.js';
import {
  ArtifactLifecycleError,
  MAX_ARTIFACT_LOCATOR_ENCODED_BYTES,
  MAX_ARTIFACT_LOCATOR_SOURCE_BYTES,
  SNAPSHOT_ID_PATTERN,
  allocateSnapshotStaging,
  finalizeSnapshotManifest,
  publishSnapshot,
  resolveSnapshotRoot,
  validateArtifactLocator,
} from '../src/output/artifact-lifecycle.js';
import { SNAPSHOT_FACET_NAMES, SnapshotMetaV2 } from '../src/contracts/snapshot.js';

function manifest(): Omit<SnapshotMetaV2, 'snapshotId'> {
  const unavailable = { retained_count: 0, availability: { state: 'unavailable' as const, reason: 'collector-unavailable' }, truncation: { state: 'unknown' as const }, source_total: { state: 'unavailable' as const, reason: 'collector-unavailable' } };
  const facets = Object.fromEntries(SNAPSHOT_FACET_NAMES.map(name => [name, { status: name === 'states' || name === 'pixels' ? 'not-requested' : 'unavailable', primary_population: { name, coverage: unavailable }, subpopulations: name === 'queries' ? { 'media-queries': unavailable, 'container-queries': unavailable } : name === 'focus' ? { forward: unavailable, reverse: unavailable } : name === 'scroll' ? { 'snap-descendants': unavailable, 'sticky-fixed-descendants': unavailable, 'sampled-visible-children': unavailable } : {}, unavailable_reason: name === 'states' || name === 'pixels' ? null : 'collector-unavailable' }])) as SnapshotMetaV2['facets'];
  return { schemaVersion: 2, request: {}, settled: true, timing: {}, coordinateAuthority: {}, contentInputs: {}, target: { mode: 'explicit-target', session_id: null, session_source: null, target_id: 'target', endpoint: { host: '127.0.0.1', port: 9222 }, observed_url: 'https://example.test/' }, facets, source_artifact_manifest: { schemaVersion: 2, artifacts: [{ key: 'geometry', path: 'geometry.json', bytes: 0, sha256: '', media_type: 'application/json', retained_arrays: [] }] }, sourcePixelCoverage: {} };
}

function finalized(staging: ReturnType<typeof allocateSnapshotStaging>): void {
  const meta = manifest(); const file = path.join(staging.directory, 'geometry.json');
  const bytes = fs.statSync(file).size; const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  finalizeSnapshotManifest(staging, { ...meta, source_artifact_manifest: { ...meta.source_artifact_manifest, artifacts: [{ ...meta.source_artifact_manifest.artifacts[0], bytes, sha256 }] } });
}

function root(label: string): string {
  return path.join(CAPTURE_ROOT, `artifact-lifecycle-${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

test('snapshot publication atomically gives a globally resolvable ID and immutable source inventory', () => {
  const artifactRoot = root('publish');
  try {
    const staging = allocateSnapshotStaging(artifactRoot);
    assert.match(staging.snapshotId, SNAPSHOT_ID_PATTERN);
    writeJsonPrivate(path.join(staging.directory, 'geometry.json'), { elements: [{ ordinal: 0 }] });
    finalized(staging);

    const entry = publishSnapshot(staging, { sessionId: 'ses_0123456789abcdefghijklmnop' }, artifactRoot);
    assert.equal(entry.snapshotId, staging.snapshotId);
    assert.equal(entry.absoluteDirectory, staging.finalDirectory);
    assert.ok(fs.existsSync(path.join(entry.absoluteDirectory, 'meta.json')));
    assert.ok(fs.existsSync(path.join(artifactRoot, 'snapshot-index', `${entry.snapshotId}.json`)));
    assert.deepEqual(resolveSnapshotRoot(entry.snapshotId, artifactRoot), entry);
    assert.deepEqual(resolveSnapshotRoot(entry.absoluteDirectory, artifactRoot), entry);

    const meta = JSON.parse(fs.readFileSync(path.join(entry.absoluteDirectory, 'meta.json'), 'utf8'));
    assert.equal(meta.publication.state, 'unpublished-final');
    assert.equal(meta.publication.publicationOperationId, entry.publicationOperationId);
    assert.deepEqual(meta.sourceArtifactInventory.artifacts.map((x: { path: string }) => x.path), ['geometry.json']);
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('publication rejects source mutations after finalization', () => {
  const artifactRoot = root('immutable');
  try {
    const staging = allocateSnapshotStaging(artifactRoot);
    writeJsonPrivate(path.join(staging.directory, 'geometry.json'), { revision: 1 });
    finalized(staging);
    // Simulate an out-of-band post-finalization mutation; publication must still catch it.
    fs.writeFileSync(path.join(staging.directory, 'geometry.json'), JSON.stringify({ revision: 2 }));
    assert.throws(() => publishSnapshot(staging, 'one-shot', artifactRoot), (error: unknown) => error instanceof ArtifactLifecycleError && error.code === 'snapshot_publication_invalid');
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('a dead owner-attested lock is reclaimed without time-based staleness', () => {
  const artifactRoot = root('stale-lock');
  try {
    ensurePrivateDir(artifactRoot);
    const lock = path.join(artifactRoot, '.snapshot-index.lock');
    ensurePrivateDir(lock);
    writeJsonPrivate(path.join(lock, 'owner.json'), { pid: 99999999, processStartIdentity: 'definitely-not-a-live-process' });
    const staging = allocateSnapshotStaging(artifactRoot);
    assert.match(staging.snapshotId, SNAPSHOT_ID_PATTERN);
    assert.ok(!fs.existsSync(lock));
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('snapshot root resolution never falls back to the active session', async () => {
  const artifactRoot = root('no-active-fallback');
  const oldNodeId = process.env.CRTR_NODE_ID;
  process.env.CRTR_NODE_ID = `lifecycle-${Date.now()}`;
  try {
    const { setActiveSession, clearActiveSession } = await import('../src/session-context.js');
    const activeDir = path.join(artifactRoot, 'legacy-active');
    ensurePrivateDir(activeDir);
    setActiveSession({ sessionId: 'legacy-session', dir: activeDir, harId: null, targetId: null, stepCount: 0 });
    await assert.rejects(
      async () => resolveSnapshotRoot('snap_0123456789abcdefghijklmnop', artifactRoot),
      (error: unknown) => error instanceof ArtifactLifecycleError && error.code === 'snapshot_not_found',
    );
    clearActiveSession();
  } finally {
    if (oldNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = oldNodeId;
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('locators are normalized, lossless, and reject source or escaped encoded overflow', () => {
  const escaped = path.join(CAPTURE_ROOT, 'quoted-"locator"');
  assert.equal(validateArtifactLocator(escaped), escaped);
  assert.ok(Buffer.byteLength(JSON.stringify(escaped), 'utf8') > Buffer.byteLength(escaped, 'utf8'));
  const proseOverflow = `${CAPTURE_ROOT}${path.sep}${'&'.repeat(200)}`;
  assert.ok(Buffer.byteLength(proseOverflow, 'utf8') <= MAX_ARTIFACT_LOCATOR_SOURCE_BYTES);
  assert.throws(() => validateArtifactLocator(proseOverflow), (error: unknown) => error instanceof ArtifactLifecycleError && error.code === 'artifact_path_too_long');

  const sourceOverflow = path.join(CAPTURE_ROOT, 'x'.repeat(MAX_ARTIFACT_LOCATOR_SOURCE_BYTES));
  assert.throws(() => validateArtifactLocator(sourceOverflow), (error: unknown) => error instanceof ArtifactLifecycleError && error.code === 'artifact_path_too_long');

  // Quotes cost an extra byte in the final JSON literal, proving escaping is bounded separately.
  const prefix = `${CAPTURE_ROOT}${path.sep}`;
  const quoteCount = Math.ceil((MAX_ARTIFACT_LOCATOR_ENCODED_BYTES - Buffer.byteLength(JSON.stringify(prefix), 'utf8') + 1) / 2);
  const encodedOverflow = `${prefix}${'"'.repeat(quoteCount)}`;
  assert.ok(Buffer.byteLength(encodedOverflow, 'utf8') <= MAX_ARTIFACT_LOCATOR_SOURCE_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(encodedOverflow), 'utf8') > MAX_ARTIFACT_LOCATOR_ENCODED_BYTES);
  assert.throws(() => validateArtifactLocator(encodedOverflow), (error: unknown) => error instanceof ArtifactLifecycleError && error.code === 'artifact_path_too_long');

  assert.throws(() => validateArtifactLocator(`${CAPTURE_ROOT}/a/../b`), /normalized absolute path/);
});
