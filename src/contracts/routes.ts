/**
 * Frozen public route/leaf descriptor contract. A descriptor is the sole truth
 * for one canonical public path. It names inputs, effects, output lane, bounds,
 * stderr, exits, and an opaque handler slot; it never imports a handler.
 */
import { OK, ValidationResult, combine, contextualize, fail } from './primitives.js';
import { BoundedBounds, ResultLane, validateBoundedBounds, validateResultLane } from './results.js';

export interface RouteEffects {
  readonly browser: boolean;
  readonly session: boolean;
  readonly artifact: boolean;
  readonly environment: boolean;
}
export const NO_EFFECTS: RouteEffects = { browser: false, session: false, artifact: false, environment: false };

export interface PositionalSpec { readonly name: string; readonly grammar: string; readonly required: boolean; readonly variadic?: boolean; }
export interface FlagSpec { readonly name: string; readonly grammar: string | 'boolean'; readonly values?: readonly string[]; readonly default?: string | number | boolean; readonly units?: string; }
export type StderrPolicy = 'empty-on-success' | 'declared-progress';
export type LeafExit = 0 | 2 | 3 | 10 | 11 | 130 | 143;

export interface BranchDescriptor { readonly kind: 'branch'; readonly path: string; readonly summary: string; }
export interface LeafDescriptor {
  readonly kind: 'leaf'; readonly path: string; readonly summary: string;
  readonly positionals: readonly PositionalSpec[]; readonly flags: readonly FlagSpec[];
  readonly mutualExclusions: readonly (readonly string[])[]; readonly effects: RouteEffects;
  readonly result: ResultLane; readonly bounds?: BoundedBounds; readonly stderr: StderrPolicy;
  readonly exits: readonly LeafExit[]; readonly handler: string;
}
export type RouteDescriptor = BranchDescriptor | LeafDescriptor;

/** All public non-root branches in the seven-noun Capture topology. */
export const EXPECTED_BRANCH_PATHS: readonly string[] = [
  'session', 'page', 'measure', 'measure map', 'measure variation', 'motion',
  'traffic', 'traffic har', 'browser', 'library',
];

/** Every public runnable path, exactly once. There are no aliases. */
export const EXPECTED_LEAF_PATHS: readonly string[] = [
  'session start', 'session stop', 'session list', 'session view', 'session log',
  'page a11y', 'page screenshot', 'page click', 'page type', 'page navigate', 'page exec',
  'measure snap', 'measure check', 'measure geometry', 'measure map focus', 'measure map scroll', 'measure map layers', 'measure explain', 'measure variation diff', 'measure variation census', 'measure variation sweep',
  'motion rec', 'motion mask', 'motion timeline', 'motion jank', 'motion response',
  'traffic record', 'traffic har create', 'traffic har read', 'traffic har delete',
  'browser detect', 'browser list', 'browser open', 'browser reset', 'browser network', 'browser cdp',
  'library list', 'library search', 'library show', 'library read',
];

export const PAGINATED_LEAF_PATHS: readonly string[] = [
  'session list', 'session view', 'browser detect', 'browser list', 'library list',
  'library search', 'library show',
];

/** Exact raw leaves are handler-owned bytes/text, never global JSON envelopes. */
export const EXACT_RAW_LEAF_PAYLOADS: Readonly<Record<string, string>> = {
  'session log': 'recorded session log bytes',
  'page a11y': 'full accessibility-tree text',
  'page exec': 'handler evaluation bytes/text',
  'traffic har read': 'stored HAR bytes',
  'browser cdp': 'raw protocol response bytes',
  'library read': 'bundled function source bytes',
};

/** Legacy spellings are deliberately unreachable after the U15 cutover. */
export const FORBIDDEN_PUBLIC_PATHS: readonly string[] = [
  '-v', 'version', 'log', 'detect', 'list', 'open', 'reset-tab', 'screenshot',
  'click', 'type', 'a11y', 'record', 'navigate', 'network', 'har', 'lib', 'cdp',
  'exec', 'motion observations', '__bridge-serve',
];

function flagNames(leaf: LeafDescriptor): Set<string> { return new Set(leaf.flags.map((flag) => flag.name)); }

export function validateLeafDescriptor(leaf: LeafDescriptor): ValidationResult {
  const errors: ValidationResult[] = [];
  if (!leaf.path) errors.push(fail('leaf has empty path'));
  if (leaf.positionals.filter((p) => !p.variadic).length > 1) errors.push(fail(`leaf ${leaf.path} declares more than one primary positional`));
  const names = flagNames(leaf);
  for (const group of leaf.mutualExclusions) for (const name of group) if (!names.has(name)) errors.push(fail(`leaf ${leaf.path} mutual-exclusion references undeclared flag ${name}`));
  errors.push(contextualize(`leaf ${leaf.path} result`, validateResultLane(leaf.result)));
  if (leaf.result.kind === 'bounded') {
    if (!leaf.bounds) errors.push(fail(`bounded leaf ${leaf.path} missing byte/list bounds`));
    else errors.push(contextualize(`leaf ${leaf.path} bounds`, validateBoundedBounds(leaf.bounds)));
  } else if (leaf.result.kind === 'exact-raw') {
    if (leaf.bounds) errors.push(fail(`exact raw leaf ${leaf.path} must not declare bounded bounds`));
    if (leaf.stderr !== 'empty-on-success') errors.push(fail(`exact raw leaf ${leaf.path} must have empty-on-success stderr`));
  } else errors.push(fail(`leaf ${leaf.path} must use bounded or exact-raw result lane`));
  if (!leaf.handler) errors.push(fail(`leaf ${leaf.path} missing handler slot`));
  if (!leaf.exits.length) errors.push(fail(`leaf ${leaf.path} declares no exits`));
  return combine(...errors);
}

export function validateBranchDescriptor(branch: BranchDescriptor): ValidationResult {
  if (!branch.path) return fail('branch has empty path');
  if ((branch as unknown as { handler?: unknown }).handler !== undefined) return fail(`branch ${branch.path} must not declare a handler`);
  return OK;
}

/** Validate an assembled public registry against the canonical seven-noun census. */
export function validateRegistry(descriptors: readonly RouteDescriptor[]): ValidationResult {
  const errors: ValidationResult[] = [];
  const seen = new Set<string>(); const leaves = new Set<string>(); const branches = new Set<string>();
  for (const descriptor of descriptors) {
    if (seen.has(descriptor.path)) errors.push(fail(`duplicate route path: ${descriptor.path}`));
    seen.add(descriptor.path);
    if (FORBIDDEN_PUBLIC_PATHS.includes(descriptor.path)) errors.push(fail(`forbidden public path present: ${descriptor.path}`));
    if (descriptor.kind === 'leaf') {
      leaves.add(descriptor.path); errors.push(validateLeafDescriptor(descriptor));
      const expectedPayload = EXACT_RAW_LEAF_PAYLOADS[descriptor.path];
      if (expectedPayload && (descriptor.result.kind !== 'exact-raw' || descriptor.result.payload !== expectedPayload)) errors.push(fail(`leaf ${descriptor.path} must be exact-raw:${expectedPayload}`));
      const paginated = descriptor.result.kind === 'bounded' && descriptor.bounds?.paginated === true;
      if (PAGINATED_LEAF_PATHS.includes(descriptor.path) !== paginated) errors.push(fail(`leaf ${descriptor.path} pagination declaration disagrees with census`));
    } else { branches.add(descriptor.path); errors.push(validateBranchDescriptor(descriptor)); }
  }
  for (const path of EXPECTED_LEAF_PATHS) if (!leaves.has(path)) errors.push(fail(`missing expected leaf path: ${path}`));
  for (const path of EXPECTED_BRANCH_PATHS) if (!branches.has(path)) errors.push(fail(`missing expected branch path: ${path}`));
  for (const path of leaves) if (!EXPECTED_LEAF_PATHS.includes(path)) errors.push(fail(`unexpected leaf path (not in census): ${path}`));
  for (const path of branches) if (!EXPECTED_BRANCH_PATHS.includes(path)) errors.push(fail(`unexpected branch path (not in census): ${path}`));
  return combine(...errors);
}
