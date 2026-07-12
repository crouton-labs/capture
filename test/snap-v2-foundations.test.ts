import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SNAPSHOT_FACET_NAMES, validateSnapshotMetaV2 } from '../src/contracts/snapshot.js';
import { parseSnapRawArgv, SnapInputError } from '../src/cdp/measure/v2/snap-selection.js';
import { resolveExplicitTarget } from '../src/cdp/measure/v2/target.js';
import { defaultSnapshotCollectors } from '../src/cdp/measure/v2/collectors.js';

test('v2 snap parser has closed target selection and ignores ambient CDP state', () => {
  const env = { CDP_PORT: '9222', CDP_TARGET: 'wrong', CDP_HAR_ID: 'wrong', CRTR_NODE_ID: 'node' };
  assert.deepEqual(parseSnapRawArgv(['https://example.test/', '--port', '9333'], env).selection, { kind: 'fresh-url', requestedUrl: 'https://example.test/', requestedPort: 9333, navigationTimeoutMs: 10000 });
  assert.deepEqual(parseSnapRawArgv(['--session', 'ses_0123456789abcdefghijklmnop'], env).selection, { kind: 'named-session', sessionId: 'ses_0123456789abcdefghijklmnop' });
  assert.deepEqual(parseSnapRawArgv(['--target', 'ABCD'], env).selection, { kind: 'explicit-target', targetToken: 'ABCD', requestedPort: null });
  assert.deepEqual(parseSnapRawArgv([], { CRTR_NODE_ID: '' }).selection, { kind: 'active-session', scopeKey: 'default' });
  assert.throws(() => parseSnapRawArgv(['--port', '9222']), (error: unknown) => error instanceof SnapInputError && error.detail.code === 'port_requires_url_or_target');
  assert.throws(() => parseSnapRawArgv(['--session', 'x', '--port', '9222']), (error: unknown) => error instanceof SnapInputError && error.detail.code === 'port_conflicts_with_session');
});

test('explicit resolution is endpoint-qualified, global exact, and case-sensitive', async () => {
  const source = { discoverEndpoints: async () => [{ host: '127.0.0.1' as const, port: 9333 }, { host: '127.0.0.1' as const, port: 9222 }], list: async (endpoint: { host: '127.0.0.1'; port: number }) => [{ endpoint, fullTargetId: endpoint.port === 9222 ? 'ABCD-exact' : 'ABCD-other', type: 'page', url: 'https://example.test/', title: '', attachable: true, websocketUrl: 'ws://real' }] };
  assert.equal((await resolveExplicitTarget('ABCD-exact', null, source)).identity.port, 9222);
  assert.equal((await resolveExplicitTarget('ABCD', 9333, source)).identity.fullTargetId, 'ABCD-other');
  await assert.rejects(() => resolveExplicitTarget('abcD', null, source));
});

test('default registry is complete, ordered, and unavailable placeholders stay explicit', () => {
  assert.deepEqual(defaultSnapshotCollectors.entries.map(entry => entry.facet), SNAPSHOT_FACET_NAMES);
  const unavailable = { retained_count: 0, availability: { state: 'unavailable' as const, reason: 'x' }, truncation: { state: 'unknown' as const }, source_total: { state: 'unavailable' as const, reason: 'x' } };
  const facets = Object.fromEntries(SNAPSHOT_FACET_NAMES.map(name => [name, { status: name === 'states' || name === 'pixels' ? 'not-requested' : 'unavailable', primary_population: { name, coverage: unavailable }, subpopulations: name === 'queries' ? { 'media-queries': unavailable, 'container-queries': unavailable } : name === 'focus' ? { forward: unavailable, reverse: unavailable } : name === 'scroll' ? { 'snap-descendants': unavailable, 'sticky-fixed-descendants': unavailable, 'sampled-visible-children': unavailable } : {}, unavailable_reason: name === 'states' || name === 'pixels' ? null : 'x' }]));
  assert.equal(validateSnapshotMetaV2({ schemaVersion: 2, snapshotId: 'snap_0123456789abcdefghijklmnop', request: {}, settled: true, timing: {}, coordinateAuthority: {}, contentInputs: {}, target: { mode: 'explicit-target', session_id: null, session_source: null, target_id: 'full', endpoint: { host: '127.0.0.1', port: 9222 }, observed_url: 'https://example.test/' }, facets: facets as any, source_artifact_manifest: { schemaVersion: 2, artifacts: [] }, sourcePixelCoverage: {} }).valid, true);
});
