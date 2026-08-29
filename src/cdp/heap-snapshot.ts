export interface RawHeapSnapshot {
  snapshot: {
    meta: {
      node_fields: string[];
      node_types: unknown[];
      edge_fields: string[];
      edge_types: unknown[];
    };
    node_count?: number;
    edge_count?: number;
  };
  nodes: number[];
  edges: number[];
  strings: string[];
}

export interface HeapNode {
  index: number;
  type: string;
  name: string;
  id: number;
  selfSize: number;
  edgeCount: number;
}

export interface HeapEdge {
  index: number;
  type: string;
  nameOrIndex: number;
  name: string | number;
  from: number;
  to: number;
}

export interface RetainerPath {
  nodes: HeapNode[];
  edges: HeapEdge[];
}

export interface RetainingPaths {
  /** Paths are shortest edge-count paths to root, in stable source-edge order. */
  selection: 'shortest-paths';
  rootIndex: number;
  maxPaths: number;
  truncated: boolean;
  paths: RetainerPath[];
}

export interface ApplicationRetainingPaths {
  /** Paths start at the nearest application-owned object and end at the selected object. */
  selection: 'nearest-application-owners';
  maxPaths: number;
  truncated: boolean;
  paths: RetainerPath[];
}

export interface DominatorTree {
  rootIndex: number;
  /** -1 means the node is not reachable from rootIndex. */
  immediateDominators: Int32Array;
  /** Chrome's self_size summed over every dominator-tree descendant. */
  retainedSizes: Float64Array;
  reachableNodeCount: number;
  sizeQualification: 'retained size is the sum of Chrome self_size in the dominator subtree';
}

export interface DuplicateString {
  value: string;
  count: number;
  totalSelfBytes: number;
  /** Estimated as total self_size less one smallest instance; backing-store sharing is not modeled. */
  wastedBytes: number;
}

export interface DuplicateStringAnalysis {
  duplicates: DuplicateString[];
  sizeQualification: 'self_size is Chrome-reported shallow size; wastedBytes assumes one smallest equal-content string is needed and does not model backing-store sharing';
}

export interface ConstructorTotals {
  nodeCount: number;
  retainedSize: number;
}

export interface ConstructorComparison {
  constructorName: string;
  added: ConstructorTotals;
  removed: ConstructorTotals;
  /** Nodes matched by Chrome snapshot object id whose retained size increased. retainedSize is the increase, not the current size. */
  grown: ConstructorTotals;
}

export interface SnapshotComparison {
  matching: 'Chrome snapshot node id';
  constructors: ConstructorComparison[];
  retainedSizeQualification: 'retained sizes are independently computed dominator-subtree sums, so constructor totals overlap and are not heap-total deltas';
}

interface ReverseEdges {
  starts: Int32Array;
  edges: Int32Array;
}

function requiredField(fields: unknown, field: string, schema: string): number {
  if (!Array.isArray(fields)) throw new Error(`Heap snapshot ${schema} must be an array.`);
  const index = fields.indexOf(field);
  if (index < 0) throw new Error(`Heap snapshot ${schema} is missing required field ${JSON.stringify(field)}.`);
  return index;
}

function requiredEnum(types: unknown, index: number, schema: string): string[] {
  if (!Array.isArray(types) || !Array.isArray(types[index]) || !types[index].every((value) => typeof value === 'string')) {
    throw new Error(`Heap snapshot ${schema} must declare string values for its type field.`);
  }
  return types[index] as string[];
}

function checkedInteger(value: unknown, description: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Heap snapshot ${description} must be a non-negative safe integer.`);
  return value as number;
}

/** A compact, schema-driven view of Chrome's JSON .heapsnapshot graph. */
export class HeapSnapshot {
  readonly nodeCount: number;
  readonly edgeCount: number;
  private readonly strings: string[];
  private readonly nodeTypes: string[];
  private readonly edgeTypes: string[];
  private readonly nodeTypeIndexes: Int32Array;
  private readonly nameIndexes: Int32Array;
  private readonly ids: Float64Array;
  private readonly selfSizes: Float64Array;
  private readonly edgeStarts: Int32Array;
  private readonly targets: Int32Array;
  private readonly sources: Int32Array;
  private readonly edgeTypeIndexes: Int32Array;
  private readonly edgeNameOrIndexes: Int32Array;
  private reverseEdges?: ReverseEdges;

  private constructor(data: {
    strings: string[];
    nodeTypes: string[];
    edgeTypes: string[];
    nodeTypeIndexes: Int32Array;
    nameIndexes: Int32Array;
    ids: Float64Array;
    selfSizes: Float64Array;
    edgeStarts: Int32Array;
    targets: Int32Array;
    sources: Int32Array;
    edgeTypeIndexes: Int32Array;
    edgeNameOrIndexes: Int32Array;
  }) {
    this.strings = data.strings;
    this.nodeTypes = data.nodeTypes;
    this.edgeTypes = data.edgeTypes;
    this.nodeTypeIndexes = data.nodeTypeIndexes;
    this.nameIndexes = data.nameIndexes;
    this.ids = data.ids;
    this.selfSizes = data.selfSizes;
    this.edgeStarts = data.edgeStarts;
    this.targets = data.targets;
    this.sources = data.sources;
    this.edgeTypeIndexes = data.edgeTypeIndexes;
    this.edgeNameOrIndexes = data.edgeNameOrIndexes;
    this.nodeCount = data.nodeTypeIndexes.length;
    this.edgeCount = data.targets.length;
  }

  static parse(input: string | RawHeapSnapshot): HeapSnapshot {
    let raw: RawHeapSnapshot;
    try {
      raw = typeof input === 'string' ? JSON.parse(input) : input;
    } catch (error) {
      throw new Error(`Heap snapshot is not valid JSON: ${(error as Error).message}`);
    }
    if (!raw || typeof raw !== 'object' || !raw.snapshot?.meta) throw new Error('Heap snapshot is missing snapshot.meta.');
    if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges) || !Array.isArray(raw.strings)) throw new Error('Heap snapshot must contain nodes, edges, and strings arrays.');
    if (!raw.strings.every((value) => typeof value === 'string')) throw new Error('Heap snapshot strings must contain only strings.');

    const meta = raw.snapshot.meta;
    const nodeTypeField = requiredField(meta.node_fields, 'type', 'snapshot.meta.node_fields');
    const nodeNameField = requiredField(meta.node_fields, 'name', 'snapshot.meta.node_fields');
    const nodeIdField = requiredField(meta.node_fields, 'id', 'snapshot.meta.node_fields');
    const nodeSelfSizeField = requiredField(meta.node_fields, 'self_size', 'snapshot.meta.node_fields');
    const nodeEdgeCountField = requiredField(meta.node_fields, 'edge_count', 'snapshot.meta.node_fields');
    const edgeTypeField = requiredField(meta.edge_fields, 'type', 'snapshot.meta.edge_fields');
    const edgeNameField = requiredField(meta.edge_fields, 'name_or_index', 'snapshot.meta.edge_fields');
    const edgeTargetField = requiredField(meta.edge_fields, 'to_node', 'snapshot.meta.edge_fields');
    const nodeTypes = requiredEnum(meta.node_types, nodeTypeField, 'snapshot.meta.node_types');
    const edgeTypes = requiredEnum(meta.edge_types, edgeTypeField, 'snapshot.meta.edge_types');
    const nodeWidth = meta.node_fields.length;
    const edgeWidth = meta.edge_fields.length;
    if (nodeWidth === 0 || raw.nodes.length % nodeWidth !== 0) throw new Error(`Heap snapshot nodes length ${raw.nodes.length} is not divisible by declared node width ${nodeWidth}.`);
    if (edgeWidth === 0 || raw.edges.length % edgeWidth !== 0) throw new Error(`Heap snapshot edges length ${raw.edges.length} is not divisible by declared edge width ${edgeWidth}.`);
    const nodeCount = raw.nodes.length / nodeWidth;
    const edgeCount = raw.edges.length / edgeWidth;
    if (raw.snapshot.node_count !== undefined && raw.snapshot.node_count !== nodeCount) throw new Error(`Heap snapshot declares ${raw.snapshot.node_count} nodes but its nodes array contains ${nodeCount}.`);
    if (raw.snapshot.edge_count !== undefined && raw.snapshot.edge_count !== edgeCount) throw new Error(`Heap snapshot declares ${raw.snapshot.edge_count} edges but its edges array contains ${edgeCount}.`);

    const nodeTypeIndexes = new Int32Array(nodeCount);
    const nameIndexes = new Int32Array(nodeCount);
    const ids = new Float64Array(nodeCount);
    const selfSizes = new Float64Array(nodeCount);
    const edgeStarts = new Int32Array(nodeCount + 1);
    let expectedEdges = 0;
    for (let node = 0; node < nodeCount; node += 1) {
      const offset = node * nodeWidth;
      const typeIndex = checkedInteger(raw.nodes[offset + nodeTypeField], `node ${node} type`);
      const nameIndex = checkedInteger(raw.nodes[offset + nodeNameField], `node ${node} name`);
      const id = checkedInteger(raw.nodes[offset + nodeIdField], `node ${node} id`);
      const selfSize = checkedInteger(raw.nodes[offset + nodeSelfSizeField], `node ${node} self_size`);
      const edgeCountForNode = checkedInteger(raw.nodes[offset + nodeEdgeCountField], `node ${node} edge_count`);
      if (typeIndex >= nodeTypes.length) throw new Error(`Heap snapshot node ${node} type index ${typeIndex} is outside snapshot.meta.node_types.`);
      if (nameIndex >= raw.strings.length) throw new Error(`Heap snapshot node ${node} name index ${nameIndex} is outside strings.`);
      if (expectedEdges + edgeCountForNode > edgeCount) throw new Error(`Heap snapshot node ${node} declares edges beyond the edges array.`);
      nodeTypeIndexes[node] = typeIndex;
      nameIndexes[node] = nameIndex;
      ids[node] = id;
      selfSizes[node] = selfSize;
      edgeStarts[node] = expectedEdges;
      expectedEdges += edgeCountForNode;
    }
    edgeStarts[nodeCount] = expectedEdges;
    if (expectedEdges !== edgeCount) throw new Error(`Heap snapshot node edge_count values total ${expectedEdges}, but edges array contains ${edgeCount}.`);

    const targets = new Int32Array(edgeCount);
    const sources = new Int32Array(edgeCount);
    for (let node = 0; node < nodeCount; node += 1) {
      for (let edge = edgeStarts[node]; edge < edgeStarts[node + 1]; edge += 1) sources[edge] = node;
    }
    const edgeTypeIndexes = new Int32Array(edgeCount);
    const edgeNameOrIndexes = new Int32Array(edgeCount);
    for (let edge = 0; edge < edgeCount; edge += 1) {
      const offset = edge * edgeWidth;
      const typeIndex = checkedInteger(raw.edges[offset + edgeTypeField], `edge ${edge} type`);
      const nameOrIndex = checkedInteger(raw.edges[offset + edgeNameField], `edge ${edge} name_or_index`);
      const targetOffset = checkedInteger(raw.edges[offset + edgeTargetField], `edge ${edge} to_node`);
      if (typeIndex >= edgeTypes.length) throw new Error(`Heap snapshot edge ${edge} type index ${typeIndex} is outside snapshot.meta.edge_types.`);
      if (targetOffset % nodeWidth !== 0 || targetOffset / nodeWidth >= nodeCount) throw new Error(`Heap snapshot edge ${edge} to_node ${targetOffset} is not a valid node-record offset.`);
      targets[edge] = targetOffset / nodeWidth;
      edgeTypeIndexes[edge] = typeIndex;
      edgeNameOrIndexes[edge] = nameOrIndex;
    }

    return new HeapSnapshot({ strings: raw.strings, nodeTypes, edgeTypes, nodeTypeIndexes, nameIndexes, ids, selfSizes, edgeStarts, targets, sources, edgeTypeIndexes, edgeNameOrIndexes });
  }

  nodeAt(index: number): HeapNode {
    this.assertNodeIndex(index);
    return {
      index,
      type: this.nodeTypes[this.nodeTypeIndexes[index]],
      name: this.strings[this.nameIndexes[index]],
      id: this.ids[index],
      selfSize: this.selfSizes[index],
      edgeCount: this.edgeStarts[index + 1] - this.edgeStarts[index],
    };
  }

  edgeAt(index: number): HeapEdge {
    if (!Number.isInteger(index) || index < 0 || index >= this.edgeCount) throw new Error(`Heap snapshot edge index ${index} is outside 0..${this.edgeCount - 1}.`);
    const from = this.sourceForEdge(index);
    const nameOrIndex = this.edgeNameOrIndexes[index];
    return {
      index,
      type: this.edgeTypes[this.edgeTypeIndexes[index]],
      nameOrIndex,
      name: this.edgeTypes[this.edgeTypeIndexes[index]] === 'element' || this.edgeTypes[this.edgeTypeIndexes[index]] === 'hidden' ? nameOrIndex : this.strings[nameOrIndex] ?? nameOrIndex,
      from,
      to: this.targets[index],
    };
  }

  outgoingEdges(nodeIndex: number): HeapEdge[] {
    this.assertNodeIndex(nodeIndex);
    const edges: HeapEdge[] = [];
    for (let edge = this.edgeStarts[nodeIndex]; edge < this.edgeStarts[nodeIndex + 1]; edge += 1) edges.push(this.edgeAt(edge));
    return edges;
  }

  retainingPaths(nodeIndex: number, { rootIndex = 0, maxPaths = 1 }: { rootIndex?: number; maxPaths?: number } = {}): RetainingPaths {
    this.assertNodeIndex(nodeIndex);
    this.assertNodeIndex(rootIndex);
    if (!Number.isInteger(maxPaths) || maxPaths < 1) throw new Error('maxPaths must be a positive integer.');
    if (nodeIndex === rootIndex) return { selection: 'shortest-paths', rootIndex, maxPaths, truncated: false, paths: [{ nodes: [this.nodeAt(rootIndex)], edges: [] }] };

    const reverse = this.getReverseEdges();
    const distance = new Int32Array(this.nodeCount);
    distance.fill(-1);
    const queue = new Int32Array(this.nodeCount);
    let head = 0;
    let tail = 0;
    distance[nodeIndex] = 0;
    queue[tail++] = nodeIndex;
    let rootDistance = -1;
    while (head < tail) {
      const current = queue[head++];
      if (rootDistance >= 0 && distance[current] >= rootDistance) continue;
      for (let cursor = reverse.starts[current]; cursor < reverse.starts[current + 1]; cursor += 1) {
        const source = this.sourceForEdge(reverse.edges[cursor]);
        if (distance[source] >= 0) continue;
        distance[source] = distance[current] + 1;
        if (source === rootIndex) rootDistance = distance[source];
        queue[tail++] = source;
      }
    }
    if (rootDistance < 0) return { selection: 'shortest-paths', rootIndex, maxPaths, truncated: false, paths: [] };

    // Count root-reaching shortest paths, capped so this remains linear even
    // when a diamond-shaped graph has exponentially many possible paths.
    const pathCounts = new Int32Array(this.nodeCount);
    pathCounts[rootIndex] = 1;
    for (let position = tail - 1; position >= 0; position -= 1) {
      const current = queue[position];
      if (current === rootIndex || distance[current] >= rootDistance) continue;
      let count = 0;
      for (let cursor = reverse.starts[current]; cursor < reverse.starts[current + 1]; cursor += 1) {
        const source = this.sourceForEdge(reverse.edges[cursor]);
        if (distance[source] === distance[current] + 1) count = Math.min(maxPaths + 1, count + pathCounts[source]);
      }
      pathCounts[current] = count;
    }

    const paths: RetainerPath[] = [];
    const nodePath = [nodeIndex];
    const edgePath: number[] = [];
    const cursors = [reverse.starts[nodeIndex]];
    while (nodePath.length > 0 && paths.length < maxPaths) {
      const current = nodePath[nodePath.length - 1];
      if (current === rootIndex) {
        paths.push({ nodes: [...nodePath].reverse().map((index) => this.nodeAt(index)), edges: [...edgePath].reverse().map((index) => this.edgeAt(index)) });
        nodePath.pop();
        cursors.pop();
        edgePath.pop();
        continue;
      }
      const cursor = cursors[cursors.length - 1];
      if (cursor >= reverse.starts[current + 1]) {
        nodePath.pop();
        cursors.pop();
        edgePath.pop();
        continue;
      }
      cursors[cursors.length - 1] = cursor + 1;
      const edge = reverse.edges[cursor];
      const source = this.sourceForEdge(edge);
      if (distance[source] !== distance[current] + 1 || pathCounts[source] === 0) continue;
      nodePath.push(source);
      edgePath.push(edge);
      cursors.push(reverse.starts[source]);
    }
    return { selection: 'shortest-paths', rootIndex, maxPaths, truncated: pathCounts[nodeIndex] > maxPaths, paths };
  }

  applicationRetainingPaths(nodeIndex: number, { maxPaths = 1 }: { maxPaths?: number } = {}): ApplicationRetainingPaths {
    this.assertNodeIndex(nodeIndex);
    if (!Number.isInteger(maxPaths) || maxPaths < 1) throw new Error('maxPaths must be a positive integer.');

    const reverse = this.getReverseEdges();
    const distance = new Int32Array(this.nodeCount);
    distance.fill(-1);
    const queue = new Int32Array(this.nodeCount);
    let head = 0;
    let tail = 0;
    let ownerDistance = -1;
    const owners: number[] = [];
    distance[nodeIndex] = 0;
    queue[tail++] = nodeIndex;

    while (head < tail) {
      const current = queue[head++];
      const currentDistance = distance[current];
      if (ownerDistance >= 0 && currentDistance > ownerDistance) break;
      if (current !== nodeIndex && this.isApplicationOwner(current)) {
        ownerDistance = currentDistance;
        owners.push(current);
        continue;
      }
      if (ownerDistance >= 0) continue;
      for (let cursor = reverse.starts[current]; cursor < reverse.starts[current + 1]; cursor += 1) {
        const edge = reverse.edges[cursor];
        const source = this.sourceForEdge(edge);
        if (distance[source] >= 0) continue;
        distance[source] = currentDistance + 1;
        queue[tail++] = source;
      }
    }

    const paths: RetainerPath[] = [];
    let truncated = false;
    for (const owner of owners) {
      const nodePath = [owner];
      const edgePath: number[] = [];
      const cursors = [this.edgeStarts[owner]];
      while (nodePath.length > 0) {
        const current = nodePath[nodePath.length - 1];
        if (current === nodeIndex) {
          if (paths.length === maxPaths) {
            truncated = true;
            break;
          }
          paths.push({ nodes: nodePath.map(index => this.nodeAt(index)), edges: edgePath.map(index => this.edgeAt(index)) });
          nodePath.pop();
          cursors.pop();
          edgePath.pop();
          continue;
        }
        const cursor = cursors[cursors.length - 1];
        if (cursor >= this.edgeStarts[current + 1]) {
          nodePath.pop();
          cursors.pop();
          edgePath.pop();
          continue;
        }
        cursors[cursors.length - 1] = cursor + 1;
        const target = this.targets[cursor];
        if (distance[target] !== distance[current] - 1) continue;
        nodePath.push(target);
        edgePath.push(cursor);
        cursors.push(this.edgeStarts[target]);
      }
      if (truncated) break;
    }
    return { selection: 'nearest-application-owners', maxPaths, truncated, paths };
  }

  computeDominators(rootIndex = 0): DominatorTree {
    this.assertNodeIndex(rootIndex);
    const dfsNumber = new Int32Array(this.nodeCount);
    const vertex = new Int32Array(this.nodeCount + 1);
    const parent = new Int32Array(this.nodeCount + 1);
    const stackNodes = new Int32Array(this.nodeCount);
    const stackEdges = new Int32Array(this.nodeCount);
    let reachable = 1;
    dfsNumber[rootIndex] = 1;
    vertex[1] = rootIndex;
    let depth = 0;
    stackNodes[0] = rootIndex;
    stackEdges[0] = this.edgeStarts[rootIndex];
    while (depth >= 0) {
      const node = stackNodes[depth];
      const edge = stackEdges[depth];
      if (edge >= this.edgeStarts[node + 1]) {
        depth -= 1;
        continue;
      }
      stackEdges[depth] = edge + 1;
      const target = this.targets[edge];
      if (dfsNumber[target] !== 0) continue;
      reachable += 1;
      dfsNumber[target] = reachable;
      vertex[reachable] = target;
      parent[reachable] = dfsNumber[node];
      depth += 1;
      stackNodes[depth] = target;
      stackEdges[depth] = this.edgeStarts[target];
    }

    const semi = new Int32Array(reachable + 1);
    const label = new Int32Array(reachable + 1);
    const ancestor = new Int32Array(reachable + 1);
    const idom = new Int32Array(reachable + 1);
    const bucketHead = new Int32Array(reachable + 1);
    const bucketNext = new Int32Array(reachable + 1);
    const compressPath = new Int32Array(reachable + 1);
    for (let i = 1; i <= reachable; i += 1) {
      semi[i] = i;
      label[i] = i;
    }
    const reverse = this.getReverseEdges();
    const compress = (node: number): void => {
      let length = 0;
      let current = node;
      while (ancestor[current] !== 0 && ancestor[ancestor[current]] !== 0) {
        compressPath[length++] = current;
        current = ancestor[current];
      }
      while (length > 0) {
        current = compressPath[--length];
        const parentNode = ancestor[current];
        if (semi[label[parentNode]] < semi[label[current]]) label[current] = label[parentNode];
        ancestor[current] = ancestor[parentNode];
      }
    };
    const evaluate = (node: number): number => {
      if (ancestor[node] === 0) return label[node];
      compress(node);
      return label[node];
    };
    for (let current = reachable; current >= 2; current -= 1) {
      const node = vertex[current];
      for (let cursor = reverse.starts[node]; cursor < reverse.starts[node + 1]; cursor += 1) {
        const predecessor = dfsNumber[this.sourceForEdge(reverse.edges[cursor])];
        if (predecessor === 0) continue;
        const candidate = evaluate(predecessor);
        if (semi[candidate] < semi[current]) semi[current] = semi[candidate];
      }
      bucketNext[current] = bucketHead[semi[current]];
      bucketHead[semi[current]] = current;
      ancestor[current] = parent[current];
      let member = bucketHead[parent[current]];
      bucketHead[parent[current]] = 0;
      while (member !== 0) {
        const next = bucketNext[member];
        const candidate = evaluate(member);
        idom[member] = semi[candidate] < semi[member] ? candidate : parent[current];
        member = next;
      }
    }
    for (let current = 2; current <= reachable; current += 1) {
      if (idom[current] !== semi[current]) idom[current] = idom[idom[current]];
    }

    const immediateDominators = new Int32Array(this.nodeCount);
    immediateDominators.fill(-1);
    immediateDominators[rootIndex] = rootIndex;
    const retainedSizes = new Float64Array(this.nodeCount);
    for (let current = 1; current <= reachable; current += 1) retainedSizes[vertex[current]] = this.selfSizes[vertex[current]];
    for (let current = reachable; current >= 2; current -= 1) {
      const node = vertex[current];
      const dominator = vertex[idom[current]];
      immediateDominators[node] = dominator;
      retainedSizes[dominator] += retainedSizes[node];
    }
    return { rootIndex, immediateDominators, retainedSizes, reachableNodeCount: reachable, sizeQualification: 'retained size is the sum of Chrome self_size in the dominator subtree' };
  }

  duplicateStrings(): DuplicateStringAnalysis {
    const groups = new Map<number, { count: number; totalSelfBytes: number; smallestSelfBytes: number }>();
    for (let node = 0; node < this.nodeCount; node += 1) {
      if (this.nodeTypes[this.nodeTypeIndexes[node]] !== 'string') continue;
      const nameIndex = this.nameIndexes[node];
      const group = groups.get(nameIndex) ?? { count: 0, totalSelfBytes: 0, smallestSelfBytes: Number.POSITIVE_INFINITY };
      group.count += 1;
      group.totalSelfBytes += this.selfSizes[node];
      group.smallestSelfBytes = Math.min(group.smallestSelfBytes, this.selfSizes[node]);
      groups.set(nameIndex, group);
    }
    const duplicates: DuplicateString[] = [];
    for (const [nameIndex, group] of groups) {
      if (group.count > 1) duplicates.push({ value: this.strings[nameIndex], count: group.count, totalSelfBytes: group.totalSelfBytes, wastedBytes: group.totalSelfBytes - group.smallestSelfBytes });
    }
    return { duplicates, sizeQualification: 'self_size is Chrome-reported shallow size; wastedBytes assumes one smallest equal-content string is needed and does not model backing-store sharing' };
  }

  static compare(before: HeapSnapshot, after: HeapSnapshot, rootIndex = 0): SnapshotComparison {
    const beforeDominators = before.computeDominators(rootIndex);
    const afterDominators = after.computeDominators(rootIndex);
    const beforeById = new Map<number, number>();
    for (let node = 0; node < before.nodeCount; node += 1) beforeById.set(before.ids[node], node);
    const groups = new Map<string, ConstructorComparison>();
    const groupFor = (name: string): ConstructorComparison => {
      let group = groups.get(name);
      if (!group) {
        group = { constructorName: name, added: { nodeCount: 0, retainedSize: 0 }, removed: { nodeCount: 0, retainedSize: 0 }, grown: { nodeCount: 0, retainedSize: 0 } };
        groups.set(name, group);
      }
      return group;
    };
    const matchedBefore = new Uint8Array(before.nodeCount);
    for (let node = 0; node < after.nodeCount; node += 1) {
      const beforeNode = beforeById.get(after.ids[node]);
      if (beforeNode === undefined) {
        const added = groupFor(after.strings[after.nameIndexes[node]]).added;
        added.nodeCount += 1;
        added.retainedSize += afterDominators.retainedSizes[node];
        continue;
      }
      matchedBefore[beforeNode] = 1;
      const increase = afterDominators.retainedSizes[node] - beforeDominators.retainedSizes[beforeNode];
      if (increase > 0) {
        const grown = groupFor(after.strings[after.nameIndexes[node]]).grown;
        grown.nodeCount += 1;
        grown.retainedSize += increase;
      }
    }
    for (let node = 0; node < before.nodeCount; node += 1) {
      if (matchedBefore[node]) continue;
      const removed = groupFor(before.strings[before.nameIndexes[node]]).removed;
      removed.nodeCount += 1;
      removed.retainedSize += beforeDominators.retainedSizes[node];
    }
    return {
      matching: 'Chrome snapshot node id',
      constructors: [...groups.values()],
      retainedSizeQualification: 'retained sizes are independently computed dominator-subtree sums, so constructor totals overlap and are not heap-total deltas',
    };
  }

  private isApplicationOwner(index: number): boolean {
    const type = this.nodeTypes[this.nodeTypeIndexes[index]];
    if (type === 'closure') return true;
    if (!['object', 'array'].includes(type)) return false;
    const name = this.strings[this.nameIndexes[index]];
    return !/^(\(|NativeContext$|system \/ Context$|Window(?: \(global\*\))?(?: \/.*)?$|global handles$|traced handles$)/.test(name);
  }

  private getReverseEdges(): ReverseEdges {
    if (this.reverseEdges) return this.reverseEdges;
    const starts = new Int32Array(this.nodeCount + 1);
    for (let edge = 0; edge < this.edgeCount; edge += 1) starts[this.targets[edge] + 1] += 1;
    for (let node = 1; node <= this.nodeCount; node += 1) starts[node] += starts[node - 1];
    const cursor = starts.slice(0, this.nodeCount);
    const edges = new Int32Array(this.edgeCount);
    for (let edge = 0; edge < this.edgeCount; edge += 1) edges[cursor[this.targets[edge]]++] = edge;
    this.reverseEdges = { starts, edges };
    return this.reverseEdges;
  }

  private sourceForEdge(edgeIndex: number): number {
    return this.sources[edgeIndex];
  }


  private assertNodeIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.nodeCount) throw new Error(`Heap snapshot node index ${index} is outside 0..${this.nodeCount - 1}.`);
  }
}
