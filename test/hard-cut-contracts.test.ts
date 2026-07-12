/**
 * U1 hard-cut contract/fixture gate. Intentionally fast and Chrome-free: it
 * validates only the frozen pure schemas and deterministic fixture skeleton.
 * No public launcher imports: U1 must remain unreachable until U15.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  EXPECTED_BRANCH_PATHS,
  EXPECTED_LEAF_PATHS,
  FORBIDDEN_PUBLIC_PATHS,
  MAX_BOUNDED_BYTES,
  MAX_CURSOR_BYTES,
  NEUTRAL_FAMILIES,
  parsePositiveInt,
  parseSignedInt,
  parseUint,
  validateAxTreeManifest,
  validateBoundedBounds,
  validateCollectionCounts,
  validateCursorClaims,
  validateCursorToken,
  validateDerivedReadManifest,
  validateFactsManifest,
  validateMotionObservationsManifest,
  validateReleaseTagMetadata,
  validateSnapshotMeta,
} from '../src/contracts/index.js';

const FIXTURES = path.join(__dirname, 'fixtures', 'hard-cut');
const json = (relative: string): unknown => JSON.parse(fs.readFileSync(path.join(FIXTURES, relative), 'utf8'));
const valid = (r: { valid: boolean; errors: readonly string[] }): void => assert.equal(r.valid, true, r.errors.join('; '));

test('U1 freezes grammar/bounds primitives and the complete route census', () => {
  assert.equal(parseUint('0'), 0);
  assert.equal(parseUint('01'), null);
  assert.equal(parsePositiveInt('1'), 1);
  assert.equal(parsePositiveInt('0'), null);
  assert.equal(parseSignedInt('-0'), null);
  assert.equal(parseSignedInt('-42'), -42);
  assert.equal(MAX_BOUNDED_BYTES, 16_384);
  assert.equal(MAX_CURSOR_BYTES, 2048);
  assert.equal(EXPECTED_LEAF_PATHS.length, 41);
  assert.deepEqual(EXPECTED_BRANCH_PATHS, ['session', 'har', 'lib', 'a11y', 'measure', 'measure map', 'motion']);
  for (const forbidden of ['-v', 'version', 'a11y', 'motion jank', 'motion response', '__bridge-serve']) assert.ok(FORBIDDEN_PUBLIC_PATHS.includes(forbidden));
  assert.equal(NEUTRAL_FAMILIES.length, 11);
  valid(validateBoundedBounds({ maxBytes: 16_384, maxRecords: 20, growing: true, paginated: true }));
  assert.equal(validateBoundedBounds({ maxBytes: 100, maxRecords: 20, growing: false, paginated: false }).valid, false);
  valid(validateCollectionCounts({ total: 20, displayed: 12, omitted: 8, limit: 12, omissionCauses: ['record-limit'] }));
});

test('U1 snapshot fixtures cover v2 authority, legacy absence, and DPR distinctions', () => {
  for (const fixture of ['snapshots/full/meta.json', 'snapshots/legacy/meta.json', 'snapshots/dpr-1/meta.json', 'snapshots/dpr-2/meta.json', 'snapshots/diff-left/meta.json', 'snapshots/diff-right/meta.json', 'snapshots/diff-ambiguous-left/meta.json', 'snapshots/diff-ambiguous-right/meta.json']) {
    valid(validateSnapshotMeta(json(fixture)));
  }
  const full = json('snapshots/full/meta.json') as { coordinateAuthority: { cssVisualViewport: { value: { clientWidth: number; clientHeight: number } }; cssContentSize: { value: { height: number } } }; contentInputs: { documentScrollHeight: { value: number } } };
  assert.deepEqual(full.coordinateAuthority.cssVisualViewport.value, { clientWidth: 1200, clientHeight: 953 });
  assert.equal(full.coordinateAuthority.cssContentSize.value.height, 3515);
  assert.equal(full.contentInputs.documentScrollHeight.value, 3600, 'DOM extent remains separate from protocol content authority');
  assert.equal(validateSnapshotMeta({ schemaVersion: 2, snapshotId: 'bad', request: {}, settled: true, timing: {}, coordinateAuthority: {}, contentInputs: {}, facets: [], sourcePixelCoverage: {} }).valid, false);
});

test('U1 concrete derived/read/tree fixture schemas are well formed and preserve hostile evidence', () => {
  valid(validateFactsManifest(json('reads/late-gate/facts.json')));
  valid(validateFactsManifest(json('reads/hostile/facts.json')));
  valid(validateAxTreeManifest(json('a11y/tree.json')));
  const tree = json('a11y/tree.json') as { nodes: readonly unknown[]; retained: number; dropped: number };
  assert.equal(tree.nodes.length, 5000);
  assert.equal(tree.retained, 5000);
  assert.equal(tree.dropped, 100);
  const hostile = fs.readFileSync(path.join(FIXTURES, 'reads/hostile/facts.json'), 'utf8');
  assert.match(hostile, /token=abc123/);
  assert.match(hostile, /\\u0001/);
  valid(validateDerivedReadManifest({ schemaVersion: 1, readId: 'read-1', owner: 'one-shot-1', operation: 'check', sources: [], factsPath: '/tmp/facts.json', selectorsPath: '/tmp/selectors.json', familyCounts: {}, factOrderVersion: 1, selectorOrderVersion: 1, completeWithinRetainedCoverage: true }));
  assert.equal(validateFactsManifest({ schemaVersion: 1, familyOrder: [], families: [], completeWithinRetainedCoverage: true }).valid, false);
  assert.equal(validateAxTreeManifest({ schemaVersion: 1, treeId: 'bad', nodes: [], retained: 0 }).valid, false);
  const late = json('reads/late-gate/facts.json') as { families: Array<{ facts: unknown[] }> };
  assert.equal(late.families[0].facts.length, 25);
});

test('U1 cursor, motion, and release validators reject contract drift without I/O', () => {
  valid(validateCursorToken('opaque.cursor-token'));
  assert.equal(validateCursorToken('x'.repeat(2049)).valid, false);
  valid(validateCursorClaims({ schemaVersion: 1, indexDigest: 'a'.repeat(64), leaf: 'list', filter: {}, nextExclusiveOrdinal: 0, pageSize: 20, expiresAt: '2026-07-13T00:00:00.000Z', mac: 'mac' }));
  assert.equal(validateCursorClaims({ schemaVersion: 1, indexDigest: 'a'.repeat(64), nextExclusiveOrdinal: 0, pageSize: 20, mac: 'mac' }).valid, false);
  valid(validateMotionObservationsManifest({ schemaVersion: 2, sourceSchemaVersion: 2, recordingId: 'recording-1', observations: [], completeWithinRetainedCoverage: true, ordering: '(sourceOrdinal,kind-rank,child-rank)' }));
  assert.equal(validateMotionObservationsManifest({ schemaVersion: 1 }).valid, false);
  valid(validateReleaseTagMetadata({ schemaVersion: 1, package: '@crouton-kit/capture', version: '1.4.0', baseSha: 'a'.repeat(40), releaseSha: 'b'.repeat(40), gateSha: 'c'.repeat(40), tarball: { filename: 'capture.tgz', bytes: 1, sha256: 'd'.repeat(64), integrity: 'sha512-x' }, runtime: { node: '24', npm: '11', pnpm: '10' } }));
  assert.equal(validateReleaseTagMetadata({ schemaVersion: 1, package: '@crouton-kit/capture' }).valid, false);
});

test('U1 fixture inventory is complete and Chrome-dependent files remain explicitly specified', () => {
  const required = [
    'snapshots/full/meta.json', 'snapshots/legacy/meta.json', 'snapshots/dpr-1/meta.json', 'snapshots/dpr-2/meta.json',
    'snapshots/diff-left/meta.json', 'snapshots/diff-right/meta.json', 'snapshots/diff-ambiguous-left/meta.json', 'snapshots/diff-ambiguous-right/meta.json',
    'reads/late-gate/facts.json', 'reads/hostile/facts.json', 'a11y/tree.json', 'sessions/small/bundle.json', 'sessions/large/bundle.json',
    'raw/large.json', 'raw/har-truncated.json', 'raw/javascript-values.json', 'sweep/fingerprint-base.json', 'sweep/fingerprint-availability.json', 'sweep/plan.json', 'html/README.md',
  ];
  for (const relative of required) assert.ok(fs.existsSync(path.join(FIXTURES, relative)), `missing ${relative}`);
  assert.ok(fs.statSync(path.join(FIXTURES, 'raw/large.json')).size > 16_384, 'raw fixture is genuinely larger than bounded output');
  for (const relative of ['snapshots/diff-left/authored-ids.json', 'snapshots/diff-right/authored-ids.json', 'snapshots/diff-ambiguous-left/authored-ids.json', 'snapshots/diff-ambiguous-right/authored-ids.json']) assert.ok(fs.existsSync(path.join(FIXTURES, relative)), `missing concrete diff evidence ${relative}`);
  const pinnedChrome = fs.readFileSync(path.join(FIXTURES, 'html/README.md'), 'utf8');
  for (const name of ['email-state.html', 'a11y-55-targets.html', 'ancestry-201.html', 'dpr-region.html']) assert.match(pinnedChrome, new RegExp(name.replace('.', '\\.')));
});
