import { type ParsedArgs } from '../../types.js';
import { HeapSnapshot } from '../../heap-snapshot.js';
import { emitResult, fact, formatArtifactList, lineList, text } from '../../../output/render.js';
import { completionAttrs, loadHeap, resolveHeapRef, resultReference } from './common.js';

const HELP = `capture heap diff --before <snapshot> --after <snapshot> [--limit <N>] — what changed between two heap snapshots

input:
  --before <snapshot>   required. Heap snapshot id in the active session or an absolute snapshot path
  --after <snapshot>    required. Heap snapshot id in the active session or an absolute snapshot path
  --limit <N>           render the top N constructors by added retained bytes; default 25, --json always carries every constructor
output: <heap-diff …> — per constructor, the nodes added, removed, and grown between the two snapshots, with retained-byte totals for each; --json mirrors
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
  const displayed = constructors.slice(0, parsed.limit ?? 25);
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
      'retained-size-qualification': comparison.retainedSizeQualification,
    },
    summary: text`Nodes are matched by Chrome snapshot object id. “grown” reports the increase in retained size for id-matched nodes, not their current size.`,
    artifacts: formatArtifactList([{ name: `${resultReference(before)}/snapshot.heapsnapshot`, note: 'before' }, { name: `${resultReference(after)}/snapshot.heapsnapshot`, note: 'after' }]),
    sections: [fact`${comparison.retainedSizeQualification}`, lineList(displayed.map((constructor, index) => fact`${index + 1}. ${constructor.constructorName} · added nodes=${constructor.added.nodeCount} retained-bytes=${constructor.added.retainedSize}; removed nodes=${constructor.removed.nodeCount} retained-bytes=${constructor.removed.retainedSize}; grown nodes=${constructor.grown.nodeCount} retained-bytes=${constructor.grown.retainedSize}`))],
    jsonSections: constructors.map(constructor => ({
      constructor: constructor.constructorName,
      added: { nodeCount: constructor.added.nodeCount, retainedSize: constructor.added.retainedSize },
      removed: { nodeCount: constructor.removed.nodeCount, retainedSize: constructor.removed.retainedSize },
      grown: { nodeCount: constructor.grown.nodeCount, retainedSize: constructor.grown.retainedSize },
      retainedSizeQualification: comparison.retainedSizeQualification,
      matching: comparison.matching,
    })),
    followUp: fact`Use \`capture heap census ${resultReference(after)}\` to inspect the after snapshot's constructor totals.`,
  }, { json: parsed.json });
}
