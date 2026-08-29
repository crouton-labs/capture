import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HeapSnapshot, type RawHeapSnapshot } from '../src/cdp/heap-snapshot.js';

function fixture(name: string): HeapSnapshot {
  return HeapSnapshot.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

function chainSnapshot(nodeCount: number): RawHeapSnapshot {
  const nodes: number[] = [];
  const edges: number[] = [];
  for (let node = 0; node < nodeCount; node += 1) {
    nodes.push(node + 1, node + 1 < nodeCount ? 1 : 0, node === 0 ? 0 : 1, node === 0 ? 0 : 1, 1);
    if (node + 1 < nodeCount) edges.push((node + 1) * 5, 2, 0);
  }
  return {
    snapshot: {
      meta: {
        node_fields: ['id', 'edge_count', 'type', 'name', 'self_size'],
        node_types: ['number', 'number', ['hidden', 'object'], 'string', 'number'],
        edge_fields: ['to_node', 'name_or_index', 'type'],
        edge_types: ['number', 'string', ['property']],
      },
      node_count: nodeCount,
      edge_count: nodeCount - 1,
    },
    nodes,
    edges,
    strings: ['(root)', 'Chain', 'next'],
  };
}

test('parser follows the fixture-declared field layout instead of fixed Chrome offsets', () => {
  const snapshot = fixture('heap-snapshot-before.json');
  assert.equal(snapshot.nodeCount, 7);
  assert.equal(snapshot.edgeCount, 7);
  assert.deepEqual(snapshot.nodeAt(2), { index: 2, type: 'object', name: 'B', id: 3, selfSize: 20, edgeCount: 2 });
  assert.deepEqual(snapshot.edgeAt(1), { index: 1, type: 'property', nameOrIndex: 8, name: 'b', from: 0, to: 2 });
  assert.throws(() => HeapSnapshot.parse({ snapshot: { meta: { node_fields: ['type'], node_types: [['object']], edge_fields: [], edge_types: [] } }, nodes: [0], edges: [], strings: [] }), /missing required field "name"/);
});

test('retaining paths return stable shortest paths and qualify a bounded result', () => {
  const snapshot = fixture('heap-snapshot-before.json');
  const onePath = snapshot.retainingPaths(3);
  assert.equal(onePath.selection, 'shortest-paths');
  assert.equal(onePath.truncated, true);
  assert.deepEqual(onePath.paths[0].nodes.map((node) => node.name), ['(root)', 'A', 'Target']);
  assert.deepEqual(onePath.paths[0].edges.map((edge) => edge.name), ['a', 'target']);

  const allShortestPaths = snapshot.retainingPaths(3, { maxPaths: 2 });
  assert.equal(allShortestPaths.truncated, false);
  assert.deepEqual(allShortestPaths.paths.map((path) => path.nodes.map((node) => node.name)), [
    ['(root)', 'A', 'Target'],
    ['(root)', 'B', 'Target'],
  ]);
});

test('Lengauer-Tarjan dominators and retained sizes match the hand-audited fixture graph', () => {
  const snapshot = fixture('heap-snapshot-before.json');
  const dominators = snapshot.computeDominators();
  assert.equal(dominators.reachableNodeCount, 7);
  assert.deepEqual([...dominators.immediateDominators], [0, 0, 0, 0, 3, 2, 0]);
  assert.deepEqual([...dominators.retainedSizes], [81, 10, 28, 38, 8, 8, 4]);
  assert.equal(dominators.sizeQualification, 'retained size is the sum of Chrome self_size in the dominator subtree');
});

test('duplicate string analysis reports Chrome shallow-size estimate and its qualification', () => {
  const duplicates = fixture('heap-snapshot-before.json').duplicateStrings();
  assert.deepEqual(duplicates.duplicates, [{ value: 'shared', count: 2, totalSelfBytes: 16, wastedBytes: 8 }]);
  assert.match(duplicates.sizeQualification, /backing-store sharing/);
});

test('snapshot comparison matches Chrome object ids and reports added, removed, and retained-size growth by constructor', () => {
  const comparison = HeapSnapshot.compare(fixture('heap-snapshot-before.json'), fixture('heap-snapshot-after.json'));
  assert.equal(comparison.matching, 'Chrome snapshot node id');
  assert.match(comparison.retainedSizeQualification, /overlap/);
  assert.deepEqual(comparison.constructors, [
    { constructorName: '(root)', added: { nodeCount: 0, retainedSize: 0 }, removed: { nodeCount: 0, retainedSize: 0 }, grown: { nodeCount: 1, retainedSize: 18 } },
    { constructorName: 'Target', added: { nodeCount: 0, retainedSize: 0 }, removed: { nodeCount: 0, retainedSize: 0 }, grown: { nodeCount: 1, retainedSize: 10 } },
    { constructorName: 'New', added: { nodeCount: 1, retainedSize: 12 }, removed: { nodeCount: 0, retainedSize: 0 }, grown: { nodeCount: 0, retainedSize: 0 } },
    { constructorName: 'Gone', added: { nodeCount: 0, retainedSize: 0 }, removed: { nodeCount: 1, retainedSize: 4 }, grown: { nodeCount: 0, retainedSize: 0 } },
  ]);
});

test('a 100,000-node chain parses and computes a dominator tree without recursive traversal', () => {
  const snapshot = HeapSnapshot.parse(chainSnapshot(100_000));
  const dominators = snapshot.computeDominators();
  assert.equal(dominators.reachableNodeCount, 100_000);
  assert.equal(dominators.immediateDominators[99_999], 99_998);
  assert.equal(dominators.retainedSizes[0], 100_000);
});
