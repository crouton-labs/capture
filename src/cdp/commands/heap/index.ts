import { invalidInput } from '../../../errors.js';
import { type ParsedArgs } from '../../types.js';
import { cmdHeapSnapshot } from './snapshot.js';
import { cmdHeapCensus } from './census.js';
import { cmdHeapObjects } from './objects.js';
import { cmdHeapRetainers } from './retainers.js';
import { cmdHeapDiff } from './diff.js';

export const COMMAND_BLOCK = `<command name="heap">
the tab's JavaScript heap — \`snapshot\` records the heap as a V8 snapshot, every other leaf is a read-only graph query over it
use for what is retaining memory in the tab's JS heap: constructor totals, retained sizes, retaining paths, duplicate strings, before/after comparison; this is the JS heap and not process memory, and \`perf\` owns time
</command>`;

const HELP = `<command name="heap" description="the V8 heap-snapshot substrate">
<model>\`snapshot\` drives the browser; every other leaf is a read of the finalized snapshot artifact and never touches Chrome. Retained sizes are dominator-subtree sums of Chrome's own self_size. Findings exit 0; input/precondition errors exit 1. No leaf accepts --gate.</model>
<subcommand name="snapshot" description="take a V8 heap snapshot" whenToUse="Use to write the substrate every other heap leaf reads."/>
<subcommand name="census" description="what the heap is made of" whenToUse="Use for per-constructor node counts and retained bytes, or for duplicated strings."/>
<subcommand name="objects" description="the individual objects of one constructor" whenToUse="Use to get the snapshot object ids and sizes you need before asking what retains one."/>
<subcommand name="retainers" description="what is keeping one object alive" whenToUse="Use with an object id from \`objects\` to get the nearest application-owned retainers."/>
<subcommand name="diff" description="what changed between two snapshots" whenToUse="Use to see which constructors added, removed, or grew across an interaction."/>
</command>`;

export async function heapMain(parsed: ParsedArgs, _args: string[]): Promise<void> {
  const leaf = parsed.positional[0];
  const rest: ParsedArgs = { ...parsed, positional: parsed.positional.slice(1) };
  switch (leaf) {
    case 'snapshot': return cmdHeapSnapshot(rest);
    case 'census': return cmdHeapCensus(rest);
    case 'objects': return cmdHeapObjects(rest);
    case 'retainers': return cmdHeapRetainers(rest);
    case 'diff': return cmdHeapDiff(rest);
    case undefined:
      console.log(HELP);
      return;
    default:
      throw invalidInput(`Unknown heap leaf: ${leaf}.`, 'unknown_command');
  }
}
