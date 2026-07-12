/**
 * Frozen shared contract primitives for the Capture measurement/help hard cut
 * (build unit U1). This module owns the small, purely-computational validators
 * and shape vocabulary that every other `src/contracts/*` module builds on:
 * argv grammar, ID grammars, integer/decimal grammars, byte bounds, coordinate
 * spaces, and availability shapes.
 *
 * CONTRACT: this file is type/interface + pure functions ONLY. It imports no
 * browser, CLI, filesystem-effect, or caller-facing print/exit API. It never
 * emits to stdout/stderr and never exits the process. Downstream units freeze
 * against these types; changing a shape here is a contract change.
 *
 * EVIDENCE POLICY: nothing here deletes, substitutes, hashes, or redacts a code
 * point. Sanitation, where it exists downstream, is lossless/reversible and
 * protects the result protocol, never secrecy (see `taste/no-redaction`).
 */

/** Structured, side-effect-free validation outcome. Validators never throw for invalid data. */
export interface ValidationResult {
  readonly valid: boolean;
  /** Human-readable, machine-stable reasons. Empty iff `valid`. */
  readonly errors: readonly string[];
}

/** A passing result. */
export const OK: ValidationResult = { valid: true, errors: [] };

/** Build a failing result from one or more reasons. */
export function fail(...errors: string[]): ValidationResult {
  return { valid: false, errors };
}

/** Merge child results; valid iff every child is valid, accumulating all reasons in order. */
export function combine(...results: readonly ValidationResult[]): ValidationResult {
  const errors: string[] = [];
  for (const r of results) errors.push(...r.errors);
  return errors.length === 0 ? OK : { valid: false, errors };
}

/** Prefix every reason of a result with `context: `. Useful for nested field paths. */
export function contextualize(context: string, result: ValidationResult): ValidationResult {
  if (result.valid) return OK;
  return { valid: false, errors: result.errors.map((e) => `${context}: ${e}`) };
}

// ---------------------------------------------------------------------------
// Byte bounds (all measured as UTF-8 unless a contract narrows to ASCII).
// ---------------------------------------------------------------------------

/** Maximum bytes of a single argv value (unless a tighter per-flag bound applies). */
export const MAX_ARGV_BYTES = 4096;
/** Maximum bytes of any single bounded-leaf success payload, independently in prose and JSON. */
export const MAX_BOUNDED_BYTES = 16_384;
/** Maximum ASCII bytes of an opaque pagination cursor token. */
export const MAX_CURSOR_BYTES = 2048;
/** Maximum bytes of one progress line on a declared-progress leaf. */
export const MAX_PROGRESS_LINE_BYTES = 256;
/** Maximum total progress bytes across a whole sweep run. */
export const MAX_PROGRESS_TOTAL_BYTES = 25_600;
/** Default and maximum page size for every immutable-cursor leaf. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 20;

/** UTF-8 byte length of a string without allocating a Buffer view of the caller's data. */
export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** True iff every code unit is ASCII (0x00–0x7F). */
export function isAscii(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

/** True iff the string contains no NUL. */
export function isNulFree(value: string): boolean {
  return value.indexOf('\u0000') === -1;
}

/** Validate a raw argv value: NUL-free UTF-8 within the declared byte bound. */
export function validateArgvValue(value: string, maxBytes: number = MAX_ARGV_BYTES): ValidationResult {
  if (!isNulFree(value)) return fail('argv value contains NUL');
  const bytes = utf8ByteLength(value);
  if (bytes > maxBytes) return fail(`argv value is ${bytes} bytes, exceeds ${maxBytes}`);
  return OK;
}

// ---------------------------------------------------------------------------
// ID and number grammars (case-sensitive; no coercion; safe integers only).
// ---------------------------------------------------------------------------

/** Public container IDs: session, HAR, snapshot, tree, recording. */
export const CONTAINER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
/** Evidence IDs: fact IDs, occurrence IDs, subject IDs, AX IDs. */
export const EVIDENCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
/** `uint` grammar: 0 or a no-leading-zero positive. */
export const UINT_RE = /^(?:0|[1-9][0-9]*)$/;
/** `positive-int` grammar: a no-leading-zero positive. */
export const POSITIVE_INT_RE = /^[1-9][0-9]*$/;
/** `signed-int` grammar: 0 or a signed no-leading-zero integer (no `-0`). */
export const SIGNED_INT_RE = /^(?:0|-?[1-9][0-9]*)$/;
/** Non-exponent decimal grammar (no `+`, `-0`, leading zero, NaN, or infinity). Sweep endpoints override this. */
export const DECIMAL_RE = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

export function isContainerId(value: string): boolean {
  return CONTAINER_ID_RE.test(value);
}
export function isEvidenceId(value: string): boolean {
  return EVIDENCE_ID_RE.test(value);
}

/** Parse a `uint` token to a safe integer; null on grammar or safe-integer failure. */
export function parseUint(token: string): number | null {
  if (!UINT_RE.test(token)) return null;
  const n = Number(token);
  return Number.isSafeInteger(n) ? n : null;
}

/** Parse a `positive-int` token to a safe integer; null on failure. */
export function parsePositiveInt(token: string): number | null {
  if (!POSITIVE_INT_RE.test(token)) return null;
  const n = Number(token);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** Parse a `signed-int` token to a safe integer; null on failure. */
export function parseSignedInt(token: string): number | null {
  if (!SIGNED_INT_RE.test(token)) return null;
  const n = Number(token);
  return Number.isSafeInteger(n) ? n : null;
}

/** True iff `value` is an absolute WHATWG http:/https: URL. */
export function isAbsoluteHttpUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  return u.protocol === 'http:' || u.protocol === 'https:';
}

/** Lowercase 64-hex SHA-256 digest grammar. */
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
export function isSha256Hex(value: string): boolean {
  return SHA256_HEX_RE.test(value);
}

// ---------------------------------------------------------------------------
// Coordinate spaces and availability.
// ---------------------------------------------------------------------------

/**
 * The three declared coordinate spaces. Layers have NO Capture geometric
 * rectangle or coordinate space and therefore never carry one of these.
 */
export type CoordinateSpace =
  | 'top-visual-viewport/css-px'
  | 'top-page/css-px'
  | 'screenshot/device-px';

export const COORDINATE_SPACES: readonly CoordinateSpace[] = [
  'top-visual-viewport/css-px',
  'top-page/css-px',
  'screenshot/device-px',
];

export function isCoordinateSpace(value: string): value is CoordinateSpace {
  return (COORDINATE_SPACES as readonly string[]).includes(value);
}

/** A retained rectangle always names its coordinate space and unit. */
export interface GeometricRect {
  readonly space: CoordinateSpace;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * An availability wrapper. A dependent fact is either present with a value or
 * absent with a fixed machine-stable reason and optional detail. Zero is NEVER
 * used to stand in for unavailable evidence.
 */
export type Availability<T> =
  | { readonly available: true; readonly value: T }
  | { readonly available: false; readonly reason: string; readonly details?: string };

export function isAvailable<T>(a: Availability<T>): a is { available: true; value: T } {
  return a.available === true;
}

/** True iff `x` is a finite number (never NaN/±Infinity). Availability, not zero, marks missing facts. */
export function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** True iff `x` is a plain (non-null, non-array) object. */
export function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
