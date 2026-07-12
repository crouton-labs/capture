import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CursorService,
  CursorServiceError,
  MemoryCursorIndexStore,
  type CursorIndexStore,
} from '../src/cursor/index.js';
import type { ImmutableIndex } from '../src/contracts/index.js';

const NOW = new Date('2026-07-12T12:00:00.000Z');
const expiry = '2026-07-12T13:00:00.000Z';
const identity = { scope: { snapshotId: 'snap_01' }, query: { term: 'button', role: 'button' } };

function service(store = new MemoryCursorIndexStore<{ id: string }>()) {
  return new CursorService({ store, secret: 'test-secret', now: () => NOW });
}

async function create(limit = 2) {
  return service().createPage({
    ...identity,
    leaf: 'a11y search',
    path: 'a11y search',
    order: 'source-ordinal-v1',
    coverage: { retained: 5 },
    rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }],
    expiresAt: expiry,
    limit,
  });
}

async function rejects(code: string, action: () => Promise<unknown>): Promise<void> {
  await assert.rejects(action, (error: unknown) => error instanceof CursorServiceError && error.code === code);
}

test('cursor service round-trips deterministic pages without reordering rows', async () => {
  const store = new MemoryCursorIndexStore<{ id: string }>();
  const subject = service(store);
  const first = await subject.createPage({
    ...identity,
    leaf: 'a11y search', path: 'a11y search', order: 'source-ordinal-v1', coverage: { retained: 5 },
    rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }], expiresAt: expiry, limit: 2,
  });
  assert.deepEqual(first.rows.map((row) => row.id), ['a', 'b']);
  assert.equal(first.total, 5);
  assert.equal('index' in first, false, 'a bounded page must not expose undisplayed retained rows');
  assert.ok(first.nextCursor);

  const second = await subject.continuePage({ ...identity, cursor: first.nextCursor! });
  assert.deepEqual(second.rows.map((row) => row.id), ['c', 'd']);
  assert.ok(second.nextCursor);
  const third = await subject.continuePage({ ...identity, cursor: second.nextCursor! });
  assert.deepEqual(third.rows.map((row) => row.id), ['e']);
  assert.equal(third.nextCursor, null);
});

test('cursor bytes are signed: tampering is rejected before the index store is read', async () => {
  let reads = 0;
  const store: CursorIndexStore<{ id: string }> = {
    put() {},
    get() { reads++; return undefined; },
  };
  const subject = service(store);
  const first = await subject.createPage({
    ...identity,
    leaf: 'a11y search', path: 'a11y search', order: 'source-ordinal-v1', coverage: {}, rows: [{ id: 'a' }, { id: 'b' }], expiresAt: expiry, limit: 1,
  });
  const tampered = `${first.nextCursor!.slice(0, -1)}${first.nextCursor!.endsWith('a') ? 'b' : 'a'}`;
  await rejects('cursor_invalid', () => subject.continuePage({ ...identity, cursor: tampered }));
  assert.equal(reads, 0);
});

test('expired cursors reject before index lookup', async () => {
  let reads = 0;
  const store: CursorIndexStore<{ id: string }> = { put() {}, get() { reads++; return undefined; } };
  const issuer = new CursorService({ store, secret: 'test-secret', now: () => new Date('2026-07-12T10:00:00.000Z') });
  const first = await issuer.createPage({
    ...identity,
    leaf: 'a11y search', path: 'a11y search', order: 'source-ordinal-v1', coverage: {}, rows: [{ id: 'a' }, { id: 'b' }], expiresAt: '2026-07-12T11:00:00.000Z', limit: 1,
  });
  await rejects('cursor_expired', () => service(store).continuePage({ ...identity, cursor: first.nextCursor! }));
  assert.equal(reads, 0);
});

test('scope and query identity mismatches reject before index lookup', async () => {
  let reads = 0;
  const store: CursorIndexStore<{ id: string }> = { put() {}, get() { reads++; return undefined; } };
  const subject = service(store);
  const first = await subject.createPage({
    ...identity,
    leaf: 'a11y search', path: 'a11y search', order: 'source-ordinal-v1', coverage: {}, rows: [{ id: 'a' }, { id: 'b' }], expiresAt: expiry, limit: 1,
  });
  await rejects('cursor_scope_mismatch', () => subject.continuePage({ ...identity, scope: { snapshotId: 'snap_02' }, cursor: first.nextCursor! }));
  await rejects('cursor_query_mismatch', () => subject.continuePage({ ...identity, query: { term: 'link' }, cursor: first.nextCursor! }));
  assert.equal(reads, 0);
});

test('page boundaries and maximum limits are fixed, bounded, and deterministic', async () => {
  const store = new MemoryCursorIndexStore<{ id: string }>();
  const subject = service(store);
  const rows = Array.from({ length: 21 }, (_, n) => ({ id: String(n) }));
  const first = await subject.createPage({
    ...identity,
    leaf: 'a11y search', path: 'a11y search', order: 'source-ordinal-v1', coverage: {}, rows, expiresAt: expiry, limit: 20,
  });
  assert.equal(first.rows.length, 20);
  const last = await subject.continuePage({ ...identity, cursor: first.nextCursor! });
  assert.deepEqual(last.rows, [{ id: '20' }]);
  await rejects('cursor_limit_invalid', () => subject.createPage({
    ...identity,
    leaf: 'a11y search', path: 'a11y search', order: 'source-ordinal-v1', coverage: {}, rows, expiresAt: expiry, limit: 21,
  }));

  const fixed = await create(2);
  await rejects('cursor_limit_invalid', () => service().continuePage({ ...identity, cursor: fixed.nextCursor!, limit: 1 }));
});

test('a mutated or mismatched durable index is never paginated', async () => {
  let saved: ImmutableIndex<{ id: string }> | undefined;
  const store: CursorIndexStore<{ id: string }> = {
    put(index) { saved = index; },
    get() { return { ...saved!, rows: [{ id: 'changed' }] }; },
  };
  const subject = service(store);
  const first = await subject.createPage({
    ...identity,
    leaf: 'a11y search', path: 'a11y search', order: 'source-ordinal-v1', coverage: {}, rows: [{ id: 'a' }, { id: 'b' }], expiresAt: expiry, limit: 1,
  });
  await rejects('cursor_index_invalid', () => subject.continuePage({ ...identity, cursor: first.nextCursor! }));
});
