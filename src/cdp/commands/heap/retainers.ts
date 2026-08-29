import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, formatArtifactList, line, lineList, text } from '../../../output/render.js';
import { completionAttrs, loadHeap, resolveHeapRef, resultReference } from './common.js';

const HELP = `capture heap retainers <snapshot> --node <object-id> [--paths <N>] — what is keeping one object alive

input:
  <snapshot>          heap snapshot id in the active session or an absolute snapshot path (required)
  --node <object-id>  required. Chrome snapshot object id from \`capture heap objects\`
  --paths <N>         return up to N paths; default 1
output: <retainers …> — each path from the nearest application-owned retainer to the selected object as an alternating node/edge chain, with each edge's kind and property name, and each node's self bytes under the same size qualification as \`census\`; V8 root plumbing is excluded from path selection; --json mirrors
effects: read-only — reads the finalized snapshot artifact, never drives the browser`;

export function cmdHeapRetainers(parsed: ParsedArgs): void {
  if (parsed.help) {
    console.log(HELP);
    return;
  }
  const ref = resolveHeapRef(parsed.positional[0]);
  const heap = loadHeap(ref);
  const objectId = Number(parsed.node);
  let targetIndex = -1;
  for (let index = 0; index < heap.nodeCount; index += 1) if (heap.nodeAt(index).id === objectId) { targetIndex = index; break; }
  if (targetIndex < 0) throw new Error(`Heap snapshot ${ref.id} has no node with Chrome snapshot object id ${objectId}.`);
  const paths = heap.applicationRetainingPaths(targetIndex, { maxPaths: parsed.paths ?? 1 });
  const dominators = heap.computeDominators();
  const prosePaths = paths.paths.map((path, index) => {
    const chain = [] as ReturnType<typeof fact>[];
    for (let node = 0; node < path.nodes.length; node += 1) {
      const item = path.nodes[node];
      chain.push(fact`object-id=${item.id} ${item.type} ${item.name} self-bytes=${item.selfSize}`);
      if (node < path.edges.length) {
        const edge = path.edges[node];
        chain.push(fact` --${edge.type}:${String(edge.name)}--> `);
      }
    }
    return line(fact`${index + 1}. `, ...chain);
  });
  emitResult({
    tag: 'retainers',
    attrs: { heap: ref.id, path: ref.dir, ...completionAttrs(ref.meta), node: objectId, paths: paths.paths.length, truncated: paths.truncated, selection: paths.selection, 'size-qualification': dominators.sizeQualification },
    summary: text`Paths start at the nearest closure, object, or array that retains the selected object, rather than at V8's synthetic roots and handle tables. Other retaining references may exist and are not enumerated unless --paths asks for them.`,
    artifacts: formatArtifactList([{ name: 'snapshot.heapsnapshot' }]),
    sections: [fact`${dominators.sizeQualification}`, ...(prosePaths.length ? [lineList(prosePaths)] : [text`No application-owned retainer was found for this node.`])],
    jsonSections: paths.paths.map(path => ({
      path: path.nodes.map(node => ({ objectId: node.id, type: node.type, name: node.name, selfBytes: node.selfSize })),
      edges: path.edges.map(edge => ({ type: edge.type, name: String(edge.name) })),
      sizeQualification: dominators.sizeQualification,
    })),
    followUp: fact`Use \`capture heap objects ${resultReference(ref)} --constructor <name>\` to select another Chrome snapshot object id.`,
  }, { json: parsed.json });
}
