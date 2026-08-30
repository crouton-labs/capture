import { type ParsedArgs } from '../../types.js';
import { HeapSnapshot } from '../../heap-snapshot.js';
import { capped, emitResult, fact, formatArtifactList, lineList, text } from '../../../output/render.js';
import { completionAttrs, loadHeap, resolveHeapRef, resultReference } from './common.js';

const HELP = `capture heap diff --before <snapshot> --after <snapshot> [--limit <N>] — what changed between two heap snapshots

input:
  --before <snapshot>   required. Heap snapshot id in the active session or an absolute snapshot path
  --after <snapshot>    required. Heap snapshot id in the active session or an absolute snapshot path
  --limit <N>           render the top N constructors by added retained bytes and top N after-snapshot nodes Chrome marks detached; default 25, --json always carries every constructor
output: <heap-diff …> — per constructor, the nodes added, removed, and grown between the two snapshots, with retained-byte and detached-node totals for each; after-snapshot nodes Chrome marks detached are listed with their object ids; --json mirrors
effects: read-only — reads both finalized snapshot artifacts, never drives the browser`;

export function cmdHeapDiff(parsed: ParsedArgs): void {
  if (parsed.help) {
    console.log(HELP);
    return;
  }
  const before = resolveHeapRef(parsed.before!);
  const after = resolveHeapRef(parsed.after!);
  const comparison = HeapSnapshot.compare(loadHeap(before), loadHeap(after));
  const constructors = [...comparison.constructors].sort((a, b) => b.added.retainedSize - a.added.retainedSize || b.grown.retainedSize - a.grown.retainedSize || b.removed.retainedSize - a.removed.retainedSize || a.constructorName.localeCompare(b.constructorName));
  const limit = parsed.limit ?? 25;
  const displayed = constructors.slice(0, limit);
  const detached = comparison.afterDetachedNodes.slice(0, limit);
  const detachedSection = detached.length
    ? lineList(detached.map((node, index) => fact`${index + 1}. object-id=${node.objectId} constructor=${capped(node.constructorName, 120)} type=${node.type} detachedness=${node.detachedness}`))
    : text`No after-snapshot nodes are marked detached by Chrome.`;
  const jsonSections = [
    ...constructors.map(constructor => ({
      constructor: capped(constructor.constructorName, Number.MAX_SAFE_INTEGER),
      added: { nodeCount: constructor.added.nodeCount, detachedNodeCount: constructor.added.detachedNodeCount, retainedSize: constructor.added.retainedSize },
      removed: { nodeCount: constructor.removed.nodeCount, detachedNodeCount: constructor.removed.detachedNodeCount, retainedSize: constructor.removed.retainedSize },
      grown: { nodeCount: constructor.grown.nodeCount, detachedNodeCount: constructor.grown.detachedNodeCount, retainedSize: constructor.grown.retainedSize },
      retainedSizeQualification: comparison.retainedSizeQualification,
      matching: comparison.matching,
    })),
    ...(comparison.afterDetachedNodes.length ? [{
      afterDetachedNodes: detached.map(node => ({
        objectId: node.objectId,
        constructor: capped(node.constructorName, Number.MAX_SAFE_INTEGER),
        type: node.type,
        detachedness: node.detachedness,
      })),
      total: comparison.afterDetachedNodes.length,
      displayed: detached.length,
      detachednessQualification: 'Chrome detachedness metadata value 2 marks these after-snapshot nodes detached.',
    }] : []),
  ];
  emitResult({
    tag: 'heap-diff',
    attrs: {
      before: before.id,
      'before-path': before.dir,
      ...Object.fromEntries(Object.entries(completionAttrs(before.meta)).map(([key, value]) => [`before-${key}`, value])),
      after: after.id,
      'after-path': after.dir,
      ...Object.fromEntries(Object.entries(completionAttrs(after.meta)).map(([key, value]) => [`after-${key}`, value])),
      matching: comparison.matching,
      constructors: constructors.length,
      displayed: displayed.length,
      'after-detached-nodes': comparison.afterDetachedNodes.length,
      'detached-displayed': detached.length,
      'retained-size-qualification': comparison.retainedSizeQualification,
    },
    summary: text`Nodes are matched by Chrome snapshot object id. “grown” reports the increase in retained size for id-matched nodes, not their current size.`,
    artifacts: formatArtifactList([{ name: `${resultReference(before)}/snapshot.heapsnapshot`, note: 'before' }, { name: `${resultReference(after)}/snapshot.heapsnapshot`, note: 'after' }]),
    sections: [
      fact`${comparison.retainedSizeQualification}`,
      lineList(displayed.map((constructor, index) => fact`${index + 1}. ${capped(constructor.constructorName, 120)} · added nodes=${constructor.added.nodeCount} detached-nodes=${constructor.added.detachedNodeCount} retained-bytes=${constructor.added.retainedSize}; removed nodes=${constructor.removed.nodeCount} detached-nodes=${constructor.removed.detachedNodeCount} retained-bytes=${constructor.removed.retainedSize}; grown nodes=${constructor.grown.nodeCount} detached-nodes=${constructor.grown.detachedNodeCount} retained-bytes=${constructor.grown.retainedSize}`)),
      fact`After-snapshot nodes marked detached by Chrome (object-id is the heap retainers --node input):`,
      detachedSection,
    ],
    jsonSections,
    followUp: fact`The detached object ids above are inputs to \`capture heap retainers ${resultReference(after)} --node <object-id>\`.`,
  }, { json: parsed.json });
}
