import { type ParsedArgs } from '../../types.js';
import { emitResult, fact, formatArtifactList, lineList, text } from '../../../output/render.js';
import { completionAttrs, loadHeap, resolveHeapRef, resultReference } from './common.js';
import { selectRecords } from '../../../output/selection.js';

const HELP = `capture heap objects <snapshot> --constructor <name> [--limit <N>] [--sort retained|self] — the individual objects of one constructor

input:
  <snapshot>            heap snapshot id in the active session or an absolute snapshot path (required)
  --constructor <name>  required. Exact constructor name as reported by \`capture heap census\` — the id source for \`capture heap retainers\`
  --limit <N>           return the top N objects in prose and JSON; default 25
  --sort <key>          retained (default) or self
output: <heap-objects …> — one row per object with its Chrome snapshot object id, node type, self bytes, and retained bytes, carrying the same retained-size qualification as \`census\`; --json mirrors
effects: read-only — reads the finalized snapshot artifact, never drives the browser`;

export function cmdHeapObjects(parsed: ParsedArgs): void {
  if (parsed.help) {
    console.log(HELP);
    return;
  }
  const ref = resolveHeapRef(parsed.positional[0]);
  const heap = loadHeap(ref);
  const constructor = parsed.constructor!;
  const sort = parsed.sort ?? 'retained';
  const dominators = heap.computeDominators();
  const objects = [] as Array<{ objectId: number; type: string; name: string; selfBytes: number; retainedBytes: number }>;
  for (let index = 0; index < heap.nodeCount; index += 1) {
    const node = heap.nodeAt(index);
    if (node.name === constructor) objects.push({ objectId: node.id, type: node.type, name: node.name, selfBytes: node.selfSize, retainedBytes: dominators.retainedSizes[index] });
  }
  objects.sort((a, b) => (sort === 'self' ? b.selfBytes - a.selfBytes || b.retainedBytes - a.retainedBytes : b.retainedBytes - a.retainedBytes || b.selfBytes - a.selfBytes) || a.objectId - b.objectId);
  const displayed = selectRecords(objects, parsed, 25);
  emitResult({
    tag: 'heap-objects',
    attrs: { heap: ref.id, path: ref.dir, ...completionAttrs(ref.meta), constructor, objects: objects.length, displayed: displayed.length, sort, 'size-qualification': dominators.sizeQualification },
    summary: text`Individual snapshot nodes of the selected constructor. Chrome snapshot object ids are not DOM backend node ids and are not stable across snapshots.`,
    artifacts: formatArtifactList([{ name: 'snapshot.heapsnapshot' }]),
    sections: [fact`${dominators.sizeQualification}`, lineList(displayed.map((object, index) => fact`${index + 1}. object-id=${object.objectId} type=${object.type} self-bytes=${object.selfBytes} retained-bytes=${object.retainedBytes}`))],
    jsonSections: displayed.map(object => ({ ...object, sizeQualification: dominators.sizeQualification })),
    followUp: fact`Use \`capture heap retainers ${resultReference(ref)} --node <object-id>\` with one Chrome snapshot object id from this result.`,
  }, { json: parsed.json });
}
