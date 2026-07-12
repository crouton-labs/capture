/**
 * Leaf-owned exact-raw output foundation. It deliberately has no structured
 * fallback: successful payloads are written exactly as their handler supplied
 * them, and global --json is rejected before the handler can perform effects.
 */
import { OK, type ValidationResult, fail } from '../contracts/primitives.js';

export type ExactRawPayload = string | Uint8Array;

/** The only two public leaf output modes at the hard cut. */
export type LeafOutputMode = 'structured-json-capable' | 'exact-raw-json-rejected';

export interface StructuredOutputOwner {
  readonly mode: 'structured-json-capable';
  readonly canonicalPath: string;
}

export interface ExactRawOutputOwner {
  readonly mode: 'exact-raw-json-rejected';
  readonly canonicalPath: string;
  readonly payloadType: string;
  readonly size: 'unbounded';
}

export type LeafOutputOwner = StructuredOutputOwner | ExactRawOutputOwner;

/** The fixed exhaustive public output-mode matrix. */
export const PUBLIC_OUTPUT_OWNERS: readonly LeafOutputOwner[] = [
  ...['session start', 'session stop', 'session list', 'session view'].map((canonicalPath) => ({ mode: 'structured-json-capable' as const, canonicalPath })),
  ...['page screenshot', 'page click', 'page type', 'page navigate'].map((canonicalPath) => ({ mode: 'structured-json-capable' as const, canonicalPath })),
  ...['measure snap', 'measure check', 'measure geometry', 'measure map focus', 'measure map scroll', 'measure map layers', 'measure explain', 'measure variation diff', 'measure variation census', 'measure variation sweep'].map((canonicalPath) => ({ mode: 'structured-json-capable' as const, canonicalPath })),
  ...['motion rec', 'motion mask', 'motion timeline', 'motion jank', 'motion response'].map((canonicalPath) => ({ mode: 'structured-json-capable' as const, canonicalPath })),
  ...['traffic record', 'traffic har create', 'traffic har delete'].map((canonicalPath) => ({ mode: 'structured-json-capable' as const, canonicalPath })),
  ...['browser detect', 'browser list', 'browser open', 'browser reset', 'browser network'].map((canonicalPath) => ({ mode: 'structured-json-capable' as const, canonicalPath })),
  ...['library list', 'library search', 'library show'].map((canonicalPath) => ({ mode: 'structured-json-capable' as const, canonicalPath })),
  { mode: 'exact-raw-json-rejected', canonicalPath: 'session log', payloadType: 'recorded session log bytes', size: 'unbounded' },
  { mode: 'exact-raw-json-rejected', canonicalPath: 'page a11y', payloadType: 'full accessibility-tree text', size: 'unbounded' },
  { mode: 'exact-raw-json-rejected', canonicalPath: 'page exec', payloadType: 'handler evaluation bytes/text', size: 'unbounded' },
  { mode: 'exact-raw-json-rejected', canonicalPath: 'traffic har read', payloadType: 'stored HAR bytes', size: 'unbounded' },
  { mode: 'exact-raw-json-rejected', canonicalPath: 'browser cdp', payloadType: 'raw protocol response bytes', size: 'unbounded' },
  { mode: 'exact-raw-json-rejected', canonicalPath: 'library read', payloadType: 'bundled function source bytes', size: 'unbounded' },
];

/** Validate a registry's exhaustive output-mode partition before route effects are bound. */
export function validateLeafOutputOwners(owners: readonly LeafOutputOwner[]): ValidationResult {
  const expected = new Map(PUBLIC_OUTPUT_OWNERS.map((owner) => [owner.canonicalPath, owner]));
  const paths = new Set<string>();
  const errors: string[] = [];
  for (const owner of owners) {
    if (!owner.canonicalPath) errors.push('output owner has empty canonical path');
    if (paths.has(owner.canonicalPath)) errors.push(`duplicate output owner path: ${owner.canonicalPath}`);
    paths.add(owner.canonicalPath);
    const required = expected.get(owner.canonicalPath);
    if (!required) { errors.push(`unexpected output owner path: ${owner.canonicalPath}`); continue; }
    if (owner.mode !== required.mode) { errors.push(`wrong output mode for ${owner.canonicalPath}`); continue; }
    if (owner.mode === 'exact-raw-json-rejected' && (owner.payloadType !== required.payloadType || owner.size !== 'unbounded')) {
      errors.push(`wrong exact raw declaration for ${owner.canonicalPath}`);
    }
  }
  for (const path of expected.keys()) if (!paths.has(path)) errors.push(`missing output owner path: ${path}`);
  return errors.length === 0 ? OK : fail(...errors);
}

export interface ExactRawJsonRejection {
  readonly code: 'output_mode_unsupported';
  readonly field: '--json';
  readonly expected: 'omit --json for exact raw output';
  readonly next_action: string;
}

export interface ExactRawLeaf {
  readonly canonicalPath: string;
  readonly argv: readonly string[];
  /** The leaf handler; callers must put all effects inside this callback. */
  readonly produce: () => ExactRawPayload | Promise<ExactRawPayload>;
}

export type ExactRawRunResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ExactRawJsonRejection };

export function exactRawJsonRejection(canonicalPath: string): ExactRawJsonRejection {
  if (!canonicalPath) throw new Error('canonical exact-raw path must not be empty');
  return {
    code: 'output_mode_unsupported',
    field: '--json',
    expected: 'omit --json for exact raw output',
    next_action: `run ${canonicalPath} -h`,
  };
}

/** True only for the global JSON switch, never for payload text that resembles it. */
export function rejectsGlobalJson(argv: readonly string[]): boolean {
  for (const token of argv) {
    if (token === '--') return false;
    if (token === '--json') return true;
  }
  return false;
}

/** Writes a supplied payload with no newline insertion or any transformation. */
export function emitExactRaw(payload: ExactRawPayload, write: (chunk: ExactRawPayload) => void = process.stdout.write.bind(process.stdout)): void {
  write(payload);
}

/**
 * Execute an exact-raw leaf. `produce` is intentionally unreachable whenever
 * --json is present, giving route adapters a pre-effect validation seam.
 */
export async function runExactRaw(leaf: ExactRawLeaf, write: (chunk: ExactRawPayload) => void = process.stdout.write.bind(process.stdout)): Promise<ExactRawRunResult> {
  if (rejectsGlobalJson(leaf.argv)) return { ok: false, error: exactRawJsonRejection(leaf.canonicalPath) };
  emitExactRaw(await leaf.produce(), write);
  return { ok: true };
}
