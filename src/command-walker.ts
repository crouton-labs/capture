/** Pure exact command-path resolution for the descriptor registry. */
import { CAPTURE_REGISTRY, type RegistryBranch, type RegistryNode } from './registry.js';

export type WalkResult =
  | { readonly kind: 'resolved'; readonly node: RegistryNode; readonly remaining: readonly string[] }
  | { readonly kind: 'unknown-path'; readonly received: string; readonly resolved: RegistryBranch; readonly expected: readonly string[]; readonly remaining: readonly string[] };

/**
 * Resolves only exact canonical path tokens. It stops before the first option,
 * resolves the deepest known leaf/branch, and leaves all leaf argv untouched.
 * Parsing, output compatibility, effects, and handler dispatch are intentionally
 * outside this pure walker.
 */
export function walkCommand(argv: readonly string[], root: RegistryBranch = CAPTURE_REGISTRY): WalkResult {
  let current: RegistryNode = root;
  let index = 0;
  while (current.kind === 'branch' && index < argv.length) {
    const token = argv[index];
    if (token.startsWith('-')) break;
    const child: RegistryNode | undefined = current.children.find((candidate: RegistryNode) => candidate.path.split(' ').at(-1) === token);
    if (!child) return { kind: 'unknown-path', received: token, resolved: current, expected: current.children.filter((candidate) => candidate.visibility === 'public').map((candidate) => candidate.path.split(' ').at(-1)!), remaining: argv.slice(index) };
    current = child;
    index += 1;
  }
  return { kind: 'resolved', node: current, remaining: argv.slice(index) };
}

export function hasHelpFlag(argv: readonly string[]): boolean {
  return argv.includes('-h') || argv.includes('--help');
}

/** Root version is the sole accepted version spelling and wins before walking. */
export function hasRootVersionFlag(argv: readonly string[]): boolean {
  return argv[0] === '--version';
}
