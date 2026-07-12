/**
 * Frozen public route/leaf descriptor contract (U1). A descriptor is the sole
 * truth for one public path: exact canonical path, typed positional/flags and
 * their mutual exclusions, browser/session/artifact/environment effects, result
 * lane + schema, byte/list bounds, stderr policy, exits, and a typed handler
 * slot. The registry walker resolves the deepest exact path before leaf parsing.
 *
 * This module is type/interface + pure validators only. Descriptors carry a
 * `handler` SLOT (an opaque symbol name), never an imported handler function,
 * so the frozen contract layer does not depend on any handler, print, or exit
 * API. U4 populates real handlers against this shape.
 *
 * `EXPECTED_ROUTE_PATHS` is the exhaustive end-state public route census from
 * the design's route table. Registry conformance tests compare a built
 * registry's canonical paths against this list; private bridge entries and the
 * deleted `-v`/`version`/bare-`a11y` spellings never appear.
 */

import {
  OK,
  ValidationResult,
  combine,
  contextualize,
  fail,
} from './primitives.js';
import {
  BoundedBounds,
  ResultLane,
  validateBoundedBounds,
  validateResultLane,
} from './results.js';

/** Declared side effects a leaf may have. Help and version are always effect-free. */
export interface RouteEffects {
  readonly browser: boolean;
  readonly session: boolean;
  readonly artifact: boolean;
  readonly environment: boolean;
}

export const NO_EFFECTS: RouteEffects = {
  browser: false,
  session: false,
  artifact: false,
  environment: false,
};

/** A typed positional target. A leaf has at most one PRIMARY positional; extras are variadic tails. */
export interface PositionalSpec {
  readonly name: string;
  /** Grammar token the parser enforces (e.g. `container-id`, `url`, `uint`, `text`). */
  readonly grammar: string;
  readonly required: boolean;
  /** True for a repeatable trailing positional (e.g. `lib read LIBRARY FUNCTION [FUNCTION ...]`). */
  readonly variadic?: boolean;
}

/** A typed flag. Value flags accept only `--name value` / `--name=value`; booleans take no value. */
export interface FlagSpec {
  readonly name: string;
  /** `boolean` for a switch, else the grammar token of its value. */
  readonly grammar: string | 'boolean';
  /** Accepted enum values, when the grammar is a closed set. */
  readonly values?: readonly string[];
  /** Default, when the flag is optional and has one. */
  readonly default?: string | number | boolean;
  /** Units, when meaningful (e.g. `ms`, `css-px`, `seconds`). */
  readonly units?: string;
}

/** Stderr discipline. Only three leaves declare bounded factual progress; raw success stderr is empty. */
export type StderrPolicy = 'empty-on-success' | 'declared-progress';

/** Declared exit codes a leaf can produce, beyond the universal 0/2/3. */
export type LeafExit = 0 | 2 | 3 | 10 | 11 | 130 | 143;

/** A branch descriptor: help + child assembly only, never a handler or result. */
export interface BranchDescriptor {
  readonly kind: 'branch';
  /** Canonical space-joined path, e.g. `measure map`. Root is `''`. */
  readonly path: string;
  /** One-line summary shown by the parent. */
  readonly summary: string;
}

/** A leaf descriptor: the full contract for one runnable public path. */
export interface LeafDescriptor {
  readonly kind: 'leaf';
  /** Canonical space-joined path, e.g. `measure snap`. */
  readonly path: string;
  readonly summary: string;
  readonly positionals: readonly PositionalSpec[];
  readonly flags: readonly FlagSpec[];
  /** Sets of flag names that are mutually exclusive (at most one may be present). */
  readonly mutualExclusions: readonly (readonly string[])[];
  readonly effects: RouteEffects;
  readonly result: ResultLane;
  /** Byte/list bounds — present iff `result.kind === 'bounded'`. */
  readonly bounds?: BoundedBounds;
  readonly stderr: StderrPolicy;
  readonly exits: readonly LeafExit[];
  /**
   * Opaque handler slot name. The frozen contract references a handler by name
   * only; U4 binds the real typed handler. This keeps the contract free of any
   * print/exit import.
   */
  readonly handler: string;
}

export type RouteDescriptor = BranchDescriptor | LeafDescriptor;

// ---------------------------------------------------------------------------
// Exhaustive end-state public route census (design route table).
// ---------------------------------------------------------------------------

/** Every branch path (has help + children, no result). Root `''` is implicit and not listed. */
export const EXPECTED_BRANCH_PATHS: readonly string[] = [
  'session',
  'har',
  'lib',
  'a11y',
  'measure',
  'measure map',
  'motion',
];

/** Every runnable public leaf path, exactly. No aliases, no `-v`/`version`, no bare `a11y`, no private bridge. */
export const EXPECTED_LEAF_PATHS: readonly string[] = [
  // top-level session/browser/interaction
  'session start',
  'session stop',
  'session list',
  'session view',
  'log',
  'detect',
  'list',
  'open',
  'reset-tab',
  'screenshot',
  'click',
  'type',
  // accessibility
  'a11y acquire',
  'a11y search',
  'a11y detail',
  // traffic / protocol / library
  'record',
  'navigate',
  'network',
  'har create',
  'har read',
  'har delete',
  'lib list',
  'lib search',
  'lib show',
  'lib read',
  'cdp',
  'exec',
  // measurement
  'measure snap',
  'measure check',
  'measure diff',
  'measure census',
  'measure explain',
  'measure resolve',
  'measure sweep',
  'measure map scroll',
  'measure map layers',
  'measure map focus',
  // motion
  'motion rec',
  'motion mask',
  'motion timeline',
  'motion observations',
];

/** The exactly-nine leaves that adopt immutable-cursor pagination. */
export const PAGINATED_LEAF_PATHS: readonly string[] = [
  'session list',
  'session view',
  'detect',
  'list',
  'lib list',
  'lib search',
  'lib show',
  'a11y search',
  'measure resolve',
];

/** Raw-json leaves and their single named envelope. */
export const RAW_LEAF_ENVELOPES: Readonly<Record<string, string>> = {
  'har read': 'recorded-har-projection',
  'lib read': 'library-schema-envelope',
  cdp: 'cdp-envelope',
  exec: 'javascript-evaluation-envelope',
};

/** Spellings that must NOT be reachable in the end state (deletion scan targets). */
export const FORBIDDEN_PUBLIC_PATHS: readonly string[] = [
  '-v',
  'version',
  'a11y', // bare a11y is deleted; only acquire/search/detail exist
  'motion jank',
  'motion response',
  '__bridge-serve',
];

// ---------------------------------------------------------------------------
// Descriptor and registry validators.
// ---------------------------------------------------------------------------

function flagNames(leaf: LeafDescriptor): Set<string> {
  return new Set(leaf.flags.map((f) => f.name));
}

export function validateLeafDescriptor(leaf: LeafDescriptor): ValidationResult {
  const errs: ValidationResult[] = [];

  if (!leaf.path) errs.push(fail('leaf has empty path'));

  // At most one primary (non-variadic, required-or-optional) positional target.
  const primary = leaf.positionals.filter((p) => !p.variadic);
  if (primary.length > 1) {
    errs.push(fail(`leaf ${leaf.path} declares ${primary.length} primary positionals; at most one allowed`));
  }

  // Mutual exclusions must reference declared flags.
  const names = flagNames(leaf);
  for (const group of leaf.mutualExclusions) {
    for (const n of group) {
      if (!names.has(n)) {
        errs.push(fail(`leaf ${leaf.path} mutual-exclusion references undeclared flag ${n}`));
      }
    }
  }

  // Result lane well-formedness.
  errs.push(contextualize(`leaf ${leaf.path} result`, validateResultLane(leaf.result)));

  // Bounded leaves must declare bounds; raw leaves must name an envelope and declare no bounds.
  if (leaf.result.kind === 'bounded') {
    if (!leaf.bounds) {
      errs.push(fail(`bounded leaf ${leaf.path} missing byte/list bounds`));
    } else {
      errs.push(contextualize(`leaf ${leaf.path} bounds`, validateBoundedBounds(leaf.bounds)));
    }
  } else if (leaf.result.kind === 'raw-json') {
    if (leaf.bounds) errs.push(fail(`raw leaf ${leaf.path} must not declare bounded bounds`));
    if (!leaf.result.envelope) errs.push(fail(`raw leaf ${leaf.path} missing named envelope`));
    if (leaf.stderr !== 'empty-on-success') {
      errs.push(fail(`raw leaf ${leaf.path} must have empty-on-success stderr`));
    }
  } else {
    errs.push(fail(`leaf ${leaf.path} must use bounded or raw-json result lane`));
  }

  if (!leaf.handler) errs.push(fail(`leaf ${leaf.path} missing handler slot`));
  if (leaf.exits.length === 0) errs.push(fail(`leaf ${leaf.path} declares no exits`));

  return combine(...errs);
}

export function validateBranchDescriptor(branch: BranchDescriptor): ValidationResult {
  const errs: ValidationResult[] = [];
  if (!branch.path) errs.push(fail('branch has empty path'));
  // A branch cannot masquerade as a leaf; TS type guarantees no handler/result field.
  if ((branch as unknown as { handler?: unknown }).handler !== undefined) {
    errs.push(fail(`branch ${branch.path} must not declare a handler`));
  }
  return combine(...errs);
}

/**
 * Validate an assembled registry against the frozen census: exhaustive leaf and
 * branch coverage, no duplicate paths, no forbidden/private spellings, correct
 * pagination and raw-envelope declarations, and per-descriptor well-formedness.
 */
export function validateRegistry(descriptors: readonly RouteDescriptor[]): ValidationResult {
  const errs: ValidationResult[] = [];
  const seen = new Set<string>();
  const leafPaths = new Set<string>();
  const branchPaths = new Set<string>();

  for (const d of descriptors) {
    if (seen.has(d.path)) errs.push(fail(`duplicate route path: ${d.path}`));
    seen.add(d.path);
    if (FORBIDDEN_PUBLIC_PATHS.includes(d.path)) {
      errs.push(fail(`forbidden public path present: ${d.path}`));
    }
    if (d.kind === 'leaf') {
      leafPaths.add(d.path);
      errs.push(validateLeafDescriptor(d));
      // Raw envelope / pagination consistency with the census.
      const expectedEnvelope = RAW_LEAF_ENVELOPES[d.path];
      if (expectedEnvelope) {
        if (d.result.kind !== 'raw-json' || d.result.envelope !== expectedEnvelope) {
          errs.push(fail(`leaf ${d.path} must be raw-json:${expectedEnvelope}`));
        }
      }
      const shouldPaginate = PAGINATED_LEAF_PATHS.includes(d.path);
      const declaresPaginate = d.result.kind === 'bounded' && d.bounds?.paginated === true;
      if (shouldPaginate && !declaresPaginate) {
        errs.push(fail(`leaf ${d.path} must adopt immutable-cursor pagination`));
      }
      if (!shouldPaginate && declaresPaginate) {
        errs.push(fail(`leaf ${d.path} must not paginate (not one of the nine adopters)`));
      }
    } else {
      branchPaths.add(d.path);
      errs.push(validateBranchDescriptor(d));
    }
  }

  for (const p of EXPECTED_LEAF_PATHS) {
    if (!leafPaths.has(p)) errs.push(fail(`missing expected leaf path: ${p}`));
  }
  for (const p of EXPECTED_BRANCH_PATHS) {
    if (!branchPaths.has(p)) errs.push(fail(`missing expected branch path: ${p}`));
  }
  for (const p of leafPaths) {
    if (!EXPECTED_LEAF_PATHS.includes(p)) errs.push(fail(`unexpected leaf path (not in census): ${p}`));
  }
  for (const p of branchPaths) {
    if (!EXPECTED_BRANCH_PATHS.includes(p)) errs.push(fail(`unexpected branch path (not in census): ${p}`));
  }

  return combine(...errs);
}
