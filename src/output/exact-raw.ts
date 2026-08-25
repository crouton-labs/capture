/**
 * Leaf-owned exact-raw output foundation. It deliberately has no structured
 * fallback: successful payloads are written exactly as their handler supplied
 * them, and global --json is rejected before the handler can perform effects.
 */
export type ExactRawPayload = string | Uint8Array;

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
