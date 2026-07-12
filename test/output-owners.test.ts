import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emitExactRaw, PUBLIC_OUTPUT_OWNERS, runExactRaw, validateLeafOutputOwners } from '../src/output/exact-raw.js';
import { allocateStructuredProjection, capUtf8, projectionExhaustive, type DisplayedCollections, type ProjectionCandidate } from '../src/output/structured.js';

interface RecordValue { readonly id: string; readonly value: string }
interface Semantic {
  readonly collections: DisplayedCollections<RecordValue>;
  readonly ids: readonly string[];
}

const encoders = {
  prose: (semantic: Semantic): string => JSON.stringify({ ids: semantic.ids, collections: semantic.collections }),
  json: (semantic: Semantic): string => JSON.stringify({ collections: semantic.collections, ids: semantic.ids }),
};

function build(collections: DisplayedCollections<RecordValue>): Semantic {
  return { collections, ids: Object.values(collections).flatMap((collection) => collection.records.map((record) => record.id)) };
}

function candidate(id: string, value: string, displayOrder: number = 0): ProjectionCandidate<RecordValue> {
  return { id, displayOrder, record: { id, value } };
}

test('structured allocator makes one dual-encoding admission decision with exact count and byte omissions', () => {
  const tooLarge = candidate('fact-too-large', 'x'.repeat(2_000), 0);
  const b = candidate('fact-b', 'b', 1);
  const c = candidate('fact-c', 'c', 2);
  const projection = allocateStructuredProjection({
    collections: [{ name: 'facts', retainedTotal: 4, limit: 3, candidates: [tooLarge, b, c] }],
    candidateOrder: [tooLarge, b, c].map((entry) => ({ collection: 'facts', candidate: entry })),
    build,
    encoders,
    maxBytes: 600,
  });

  assert.deepEqual(projection.semantic.ids, ['fact-b', 'fact-c']);
  assert.deepEqual(projection.collections.facts, {
    retained_total: 4,
    displayed: 2,
    omitted: 2,
    limit: 3,
    omitted_by: { count_limit: 1, byte_budget: 1 },
    records: [{ id: 'fact-b', value: 'b' }, { id: 'fact-c', value: 'c' }],
  });
  assert.ok(projection.bytes.prose <= 600);
  assert.ok(projection.bytes.json <= 600);
  assert.deepEqual(JSON.parse(projection.prose).ids, JSON.parse(projection.json).ids);
  assert.equal(projectionExhaustive(projection.collections, 0), false);
});

test('structured allocator follows explicit cross-collection ordering and does not let an early collection starve later ones', () => {
  const a1 = candidate('a1', 'a'.repeat(100), 0);
  const a2 = candidate('a2', 'a'.repeat(100), 1);
  const b1 = candidate('b1', 'b'.repeat(100), 0);
  const b2 = candidate('b2', 'b'.repeat(100), 1);
  const projection = allocateStructuredProjection({
    collections: [
      { name: 'a', retainedTotal: 2, limit: 2, candidates: [a1, a2] },
      { name: 'b', retainedTotal: 2, limit: 2, candidates: [b1, b2] },
    ],
    candidateOrder: [
      { collection: 'a', candidate: a1 },
      { collection: 'b', candidate: b1 },
      { collection: 'a', candidate: a2 },
      { collection: 'b', candidate: b2 },
    ],
    build,
    encoders,
    maxBytes: 600,
  });
  assert.ok(projection.semantic.ids.includes('a1'));
  assert.ok(projection.semantic.ids.includes('b1'));
  assert.deepEqual(projection.semantic.ids.slice(0, 2), ['a1', 'b1']);
});

test('structured allocator separates ancestry admission priority from nearest-outward render order', () => {
  const nearest = candidate('nearest', 'nearest', 0);
  const middle = candidate('middle', 'middle', 1);
  const outermost = candidate('outermost', 'outermost', 2);
  const projection = allocateStructuredProjection({
    collections: [{ name: 'ancestry', retainedTotal: 3, limit: 3, candidates: [nearest, middle, outermost] }],
    candidateOrder: [{ collection: 'ancestry', candidate: nearest }, { collection: 'ancestry', candidate: outermost }, { collection: 'ancestry', candidate: middle }],
    build,
    encoders,
  });
  assert.deepEqual(projection.semantic.ids, ['nearest', 'middle', 'outermost']);
});

test('structured allocator treats either encoding exceeding its bound as rejection and never slices a record', () => {
  const wide = candidate('wide', 'record', 0);
  const fits = candidate('fits', 'ok', 1);
  const projection = allocateStructuredProjection({
    collections: [{ name: 'facts', retainedTotal: 2, limit: 2, candidates: [wide, fits] }],
    candidateOrder: [{ collection: 'facts', candidate: wide }, { collection: 'facts', candidate: fits }],
    build,
    encoders: {
      prose: (semantic) => `${semantic.ids.includes('wide') ? 'x'.repeat(1_000) : ''}${JSON.stringify(semantic)}`,
      json: (semantic) => JSON.stringify(semantic),
    },
    maxBytes: 500,
  });

  assert.deepEqual(projection.semantic.ids, ['fits']);
  assert.equal(projection.collections.facts.omitted_by.byte_budget, 1);
  assert.equal(projection.prose.includes('x'.repeat(500)), false);
});

test('structured allocator rejects a requested bound above the 16,384-byte hard maximum', () => {
  const only = candidate('only', 'x', 0);
  assert.throws(() => allocateStructuredProjection({
    collections: [{ name: 'facts', retainedTotal: 1, limit: 1, candidates: [only] }],
    candidateOrder: [{ collection: 'facts', candidate: only }],
    build,
    encoders,
    maxBytes: 16_385,
  }), /must not exceed 16384/);
});

test('UTF-8 caps report exact adjacent byte omissions without splitting code points', () => {
  assert.deepEqual(capUtf8('a😀b', 5), { value: 'a😀', bytes_omitted: 1 });
  assert.deepEqual(capUtf8('😀', 3), { value: '', bytes_omitted: 4 });
});

test('output owners are the fixed exhaustive structured-or-exact-raw partition', () => {
  assert.equal(validateLeafOutputOwners(PUBLIC_OUTPUT_OWNERS).valid, true);
  assert.equal(validateLeafOutputOwners(PUBLIC_OUTPUT_OWNERS.slice(1)).valid, false, 'missing leaf fails');
  assert.equal(validateLeafOutputOwners([...PUBLIC_OUTPUT_OWNERS, { mode: 'structured-json-capable', canonicalPath: 'unexpected leaf' }]).valid, false, 'extra leaf fails');
  const wrongMode = PUBLIC_OUTPUT_OWNERS.map((owner) => owner.canonicalPath === 'browser cdp'
    ? { mode: 'structured-json-capable' as const, canonicalPath: owner.canonicalPath }
    : owner);
  assert.equal(validateLeafOutputOwners(wrongMode).valid, false, 'wrong mode fails');
});

test('exact raw writes handler bytes and final newline exactly', async () => {
  const payload = Buffer.from([0, 0xff, 0x0a]);
  const writes: Uint8Array[] = [];
  const result = await runExactRaw({ canonicalPath: 'capture browser cdp', argv: [], produce: () => payload }, (chunk) => writes.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));

  assert.deepEqual(result, { ok: true });
  assert.equal(writes.length, 1);
  assert.deepEqual(Buffer.from(writes[0]!), payload);
  const direct: Uint8Array[] = [];
  emitExactRaw('no-final-newline', (chunk) => direct.push(Buffer.from(chunk)));
  assert.equal(Buffer.from(direct[0]!).toString(), 'no-final-newline');
});

test('exact raw rejects global --json before effects but not literal payload text after --', async () => {
  let effects = 0;
  const writes: Uint8Array[] = [];
  const rejected = await runExactRaw({
    canonicalPath: 'capture browser cdp',
    argv: ['--json'],
    produce: () => { effects++; return Buffer.from('must not run'); },
  }, (chunk) => writes.push(Buffer.from(chunk)));

  assert.equal(effects, 0);
  assert.equal(writes.length, 0);
  assert.deepEqual(rejected, {
    ok: false,
    error: {
      code: 'output_mode_unsupported',
      field: '--json',
      expected: 'omit --json for exact raw output',
      next_action: 'run capture browser cdp -h',
    },
  });

  const literalWrites: Uint8Array[] = [];
  const accepted = await runExactRaw({ canonicalPath: 'capture page exec', argv: ['--', '--json'], produce: () => 'literal --json' }, (chunk) => literalWrites.push(Buffer.from(chunk)));
  assert.deepEqual(accepted, { ok: true });
  assert.equal(Buffer.concat(literalWrites).toString(), 'literal --json');
});
