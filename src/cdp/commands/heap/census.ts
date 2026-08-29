import { type ParsedArgs } from '../../types.js';
import { capped, emitResult, fact, formatArtifactList, lineList, text } from '../../../output/render.js';
import { completionAttrs, loadHeap, resolveHeapRef, resultReference } from './common.js';

const HELP = `capture heap census <snapshot> [--axis constructor|string] [--limit <N>] — what the heap is made of

input:
  <snapshot>       heap snapshot id in the active session or an absolute snapshot path (required)
  --axis <axis>    constructor (default) groups every node by constructor name with node count and retained bytes; string groups equal-content strings with their instance count and estimated duplicate bytes
  --limit <N>      return the top N groups by retained bytes; default 25, including under --json
output: <heap-census …> — one row per group with its counts and sizes, plus the size qualification for the chosen axis; --json mirrors
effects: read-only — reads the finalized snapshot artifact, never drives the browser`;

export function cmdHeapCensus(parsed: ParsedArgs): void {
  if (parsed.help) {
    console.log(HELP);
    return;
  }
  const ref = resolveHeapRef(parsed.positional[0]);
  const heap = loadHeap(ref);
  const limit = parsed.limit ?? 25;
  const axis = parsed.axis ?? 'constructor';
  if (axis === 'string') {
    const duplicate = heap.duplicateStrings();
    const groups = [...duplicate.duplicates].sort((a, b) => b.wastedBytes - a.wastedBytes || b.totalSelfBytes - a.totalSelfBytes || a.value.localeCompare(b.value));
    const displayed = groups.slice(0, limit);
    emitResult({
      tag: 'heap-census',
      attrs: { heap: ref.id, path: ref.dir, ...completionAttrs(ref.meta), axis, groups: groups.length, displayed: displayed.length, nodes: heap.nodeCount, 'size-qualification': duplicate.sizeQualification },
      summary: text`Equal-content string instances grouped from the Chrome heap snapshot.`,
      artifacts: formatArtifactList([{ name: 'snapshot.heapsnapshot' }]),
      sections: [fact`${duplicate.sizeQualification}`, lineList(displayed.map((group, index) => fact`${index + 1}. ${capped(group.value, 120)} · instances=${group.count} self-bytes=${group.totalSelfBytes} wasted-bytes=${group.wastedBytes}`))],
      jsonSections: displayed.map(group => ({ string: capped(group.value, Number.MAX_SAFE_INTEGER), instanceCount: group.count, selfBytes: group.totalSelfBytes, wastedBytes: group.wastedBytes, sizeQualification: duplicate.sizeQualification })),
      followUp: fact`Use \`capture heap objects ${resultReference(ref)} --constructor <name>\` to inspect one constructor, or \`capture heap diff --before ${resultReference(ref)} --after <snapshot>\` to compare snapshots.`,
    }, { json: parsed.json });
    return;
  }

  const dominators = heap.computeDominators();
  const grouped = new Map<string, { constructor: string; nodeCount: number; retainedBytes: number; selfBytes: number }>();
  for (let index = 0; index < heap.nodeCount; index += 1) {
    const node = heap.nodeAt(index);
    const group = grouped.get(node.name) ?? { constructor: node.name, nodeCount: 0, retainedBytes: 0, selfBytes: 0 };
    group.nodeCount += 1;
    group.retainedBytes += dominators.retainedSizes[index];
    group.selfBytes += node.selfSize;
    grouped.set(node.name, group);
  }
  const groups = [...grouped.values()].sort((a, b) => b.retainedBytes - a.retainedBytes || b.selfBytes - a.selfBytes || a.constructor.localeCompare(b.constructor));
  const displayed = groups.slice(0, limit);
  emitResult({
    tag: 'heap-census',
    attrs: { heap: ref.id, path: ref.dir, ...completionAttrs(ref.meta), axis, groups: groups.length, displayed: displayed.length, nodes: heap.nodeCount, 'size-qualification': dominators.sizeQualification },
    summary: text`Constructor totals from the V8 heap snapshot.`,
    artifacts: formatArtifactList([{ name: 'snapshot.heapsnapshot' }]),
    sections: [fact`${dominators.sizeQualification}`, lineList(displayed.map((group, index) => fact`${index + 1}. ${capped(group.constructor, 120)} · nodes=${group.nodeCount} retained-bytes=${group.retainedBytes} self-bytes=${group.selfBytes}`))],
    jsonSections: displayed.map(group => ({ constructor: capped(group.constructor, Number.MAX_SAFE_INTEGER), nodeCount: group.nodeCount, retainedBytes: group.retainedBytes, selfBytes: group.selfBytes, sizeQualification: dominators.sizeQualification })),
    followUp: fact`Use \`capture heap objects ${resultReference(ref)} --constructor <name>\` for Chrome snapshot object ids and \`capture heap retainers ${resultReference(ref)} --node <object-id>\` for a retaining path.`,
  }, { json: parsed.json });
}
