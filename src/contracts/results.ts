/**
 * Frozen result-lane contracts (U1). Two lanes only:
 *
 *  - `bounded:<domain>`  — one typed projection through the bounded output
 *    kernel: at most {@link MAX_BOUNDED_BYTES} UTF-8 bytes independently in
 *    prose and JSON, with fixed identity/summary/scope/coverage/count/artifact
 *    metadata that is NEVER dropped, and optional records removed only at
 *    record boundaries (never byte-sliced) until both encodings fit.
 *  - `exact-raw:<payload>` — handler-produced bytes/text for one named payload,
 *    unbounded and preserved exactly (including final-newline presence); empty
 *    stderr on success. Global `--json` is rejected before effects.
 *
 * This module is type/interface + pure validators only. It imports no print or
 * exit API. The "no direct stdout" rule is a contract on the handlers that
 * produce these values, encoded in the descriptor layer (see `routes.ts`).
 */

import {
  MAX_BOUNDED_BYTES,
  OK,
  ValidationResult,
  combine,
  contextualize,
  fail,
  isObject,
  utf8ByteLength,
} from './primitives.js';

export { MAX_BOUNDED_BYTES };

/** Discriminator for the two public result lanes plus the effect-only branch/launcher rows. */
export type ResultLaneKind = 'bounded' | 'exact-raw' | 'branch' | 'launcher-metadata';

/** A `bounded:<domain>` lane naming exactly one bounded projection domain. */
export interface BoundedLane {
  readonly kind: 'bounded';
  readonly domain: string;
  /** The JSON/prose schema name the bounded kernel serializes. */
  readonly schema: string;
}

/** An exact raw lane naming its handler-owned unbounded payload. */
export interface ExactRawLane {
  readonly kind: 'exact-raw';
  /** The payload type, e.g. `recorded HAR bytes`. */
  readonly payload: string;
}

/** A branch row: help + child assembly, no result. */
export interface BranchLane {
  readonly kind: 'branch';
}

/** The launcher `--version` metadata row. */
export interface LauncherMetadataLane {
  readonly kind: 'launcher-metadata';
}

export type ResultLane = BoundedLane | ExactRawLane | BranchLane | LauncherMetadataLane;

// ---------------------------------------------------------------------------
// Byte/list bounds descriptor a bounded leaf declares.
// ---------------------------------------------------------------------------

/**
 * Every bounded leaf declares its collection and byte bounds up front so the
 * registry can reject a growing collection that lacks an omission contract.
 */
export interface BoundedBounds {
  /** Independent max UTF-8 bytes of prose and JSON. Always {@link MAX_BOUNDED_BYTES}. */
  readonly maxBytes: number;
  /** Max displayed records for the primary collection (e.g. 20). */
  readonly maxRecords: number;
  /**
   * Whether the primary collection can grow with the underlying source. A
   * growing collection MUST declare `paginated` so a cursor covers every row.
   */
  readonly growing: boolean;
  /** True iff this leaf adopts the immutable-cursor pagination service. */
  readonly paginated: boolean;
}

// ---------------------------------------------------------------------------
// Bounded projection payload shape (the kernel's typed input, pre-encoding).
// ---------------------------------------------------------------------------

/** Fixed metadata every bounded projection carries and never drops when bounding. */
export interface BoundedFixedMeta {
  readonly domain: string;
  readonly schema: string;
  /** Identity of the subject the projection describes (snapshot id, session id, tree id, …). */
  readonly identity: Record<string, string>;
  /** Scope and source coverage (populations/caps/availability), preserved verbatim. */
  readonly coverage: unknown;
  /** total/displayed/omitted/limit for the primary collection. */
  readonly counts: BoundedCollectionCounts;
  /** Absolute artifact paths a caller can re-read for the exhaustive evidence. */
  readonly artifacts: readonly string[];
}

/** total/displayed/omitted/limit accounting for one bounded collection. */
export interface BoundedCollectionCounts {
  readonly total: number;
  readonly displayed: number;
  readonly omitted: number;
  readonly limit: number;
  /** Machine-stable reasons the omitted records were dropped (e.g. `byte-bound`, `record-limit`). */
  readonly omissionCauses: readonly string[];
}

/**
 * A capped string reports byte accounting and an exact RFC-6901 pointer into
 * the exhaustive artifact rather than silently truncating.
 */
export interface CappedStringMeta {
  readonly sourceBytes: number;
  readonly displayedBytes: number;
  readonly omittedBytes: number;
  /** Absolute artifact path + RFC-6901 JSON Pointer to the full value. */
  readonly artifactPath: string;
  readonly jsonPointer: string;
}

/**
 * A structured public error (bounded, factual). Written to stderr by the result
 * owner, never by a handler. Exit 2 = invalid route/grammar/selection/cursor
 * input; exit 3 = source/runtime/publication failure.
 */
export interface BoundedError {
  readonly message: string;
  readonly exit: 2 | 3;
  readonly details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Validators.
// ---------------------------------------------------------------------------

export function validateResultLane(lane: ResultLane): ValidationResult {
  switch (lane.kind) {
    case 'bounded':
      if (!lane.domain) return fail('bounded lane missing domain');
      if (!lane.schema) return fail('bounded lane missing schema');
      return OK;
    case 'exact-raw':
      if (!lane.payload) return fail('exact-raw lane missing payload type');
      return OK;
    case 'branch':
    case 'launcher-metadata':
      return OK;
    default:
      return fail(`unknown result lane kind: ${(lane as { kind: string }).kind}`);
  }
}

export function validateBoundedBounds(bounds: BoundedBounds): ValidationResult {
  const errs: ValidationResult[] = [];
  if (bounds.maxBytes !== MAX_BOUNDED_BYTES) {
    errs.push(fail(`bounded maxBytes must be ${MAX_BOUNDED_BYTES}, got ${bounds.maxBytes}`));
  }
  if (!(bounds.maxRecords >= 0)) errs.push(fail('bounded maxRecords must be >= 0'));
  if (bounds.growing && !bounds.paginated) {
    errs.push(fail('a growing bounded collection must declare pagination (cursor coverage)'));
  }
  return combine(...errs);
}

/** True iff both encodings fit the independent byte bound. */
export function fitsBoundedBounds(prose: string, json: string): ValidationResult {
  const errs: ValidationResult[] = [];
  const p = utf8ByteLength(prose);
  const j = utf8ByteLength(json);
  if (p > MAX_BOUNDED_BYTES) errs.push(fail(`prose is ${p} bytes, exceeds ${MAX_BOUNDED_BYTES}`));
  if (j > MAX_BOUNDED_BYTES) errs.push(fail(`json is ${j} bytes, exceeds ${MAX_BOUNDED_BYTES}`));
  return combine(...errs);
}

/** Validate collection counts are internally consistent: displayed+omitted==total, displayed<=limit. */
export function validateCollectionCounts(counts: BoundedCollectionCounts): ValidationResult {
  const errs: ValidationResult[] = [];
  if (counts.displayed + counts.omitted !== counts.total) {
    errs.push(fail(`displayed(${counts.displayed}) + omitted(${counts.omitted}) != total(${counts.total})`));
  }
  if (counts.displayed > counts.limit) {
    errs.push(fail(`displayed(${counts.displayed}) exceeds limit(${counts.limit})`));
  }
  if (counts.omitted > 0 && counts.omissionCauses.length === 0) {
    errs.push(fail('omitted records present but no omissionCauses declared'));
  }
  return combine(...errs);
}

/** Validate the fixed metadata block that must precede any bounded records. */
export function validateBoundedFixedMeta(meta: unknown): ValidationResult {
  if (!isObject(meta)) return fail('bounded fixed meta must be an object');
  const errs: ValidationResult[] = [];
  if (typeof meta.domain !== 'string' || !meta.domain) errs.push(fail('missing domain'));
  if (typeof meta.schema !== 'string' || !meta.schema) errs.push(fail('missing schema'));
  if (!isObject(meta.identity)) errs.push(fail('missing identity object'));
  if (!('coverage' in meta)) errs.push(fail('missing coverage'));
  if (!Array.isArray(meta.artifacts)) errs.push(fail('artifacts must be an array of absolute paths'));
  if (isObject(meta.counts)) {
    errs.push(contextualize('counts', validateCollectionCounts(meta.counts as BoundedCollectionCounts)));
  } else {
    errs.push(fail('missing counts'));
  }
  return combine(...errs);
}
