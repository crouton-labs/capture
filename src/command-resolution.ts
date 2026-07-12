/** Pure pre-dispatch control precedence for U15's future launcher wiring. */
import { assembleHelp } from './command-help.js';
import { hasHelpFlag, hasRootVersionFlag, walkCommand } from './command-walker.js';
import { CAPTURE_REGISTRY, type RegistryBranch, type RegistryNode } from './registry.js';

export type CommandResolution =
  | { readonly kind: 'version' }
  | { readonly kind: 'help'; readonly node: RegistryNode; readonly text: string }
  | { readonly kind: 'dispatch'; readonly node: RegistryNode; readonly argv: readonly string[] }
  | { readonly kind: 'unknown-path'; readonly received: string; readonly expected: readonly string[]; readonly path: string };

/**
 * Applies only control precedence. It deliberately does not parse leaf argv,
 * validate `--json`, invoke a handler, or allocate any effectful dependency.
 */
export function resolveCommand(argv: readonly string[], root: RegistryBranch = CAPTURE_REGISTRY): CommandResolution {
  if (hasRootVersionFlag(argv)) return { kind: 'version' };
  const walked = walkCommand(argv, root);
  if (walked.kind === 'unknown-path') return { kind: 'unknown-path', received: walked.received, expected: walked.expected, path: walked.resolved.path };
  if (hasHelpFlag(walked.remaining)) return { kind: 'help', node: walked.node, text: assembleHelp(walked.node) };
  return { kind: 'dispatch', node: walked.node, argv: walked.remaining };
}
