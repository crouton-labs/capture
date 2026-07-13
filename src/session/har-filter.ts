/**
 * `session har --filter-status` grammar (M9) — one pure, complete-token
 * parser. Exactly three documented forms are valid:
 *
 *   exact code    100..599                      e.g. `404`
 *   class prefix  1..5 (one digit)              e.g. `4` — every 4xx status
 *   exact range   lo-hi, both 100..599, lo<=hi  e.g. `400-499`
 *
 * Every other token — empty, whitespace-bearing, two-digit prefixes (`40`),
 * out-of-range codes (`99`, `600`), unordered/partial/extra-hyphen ranges —
 * throws a typed `invalid_filter` CaptureError. There is no match-all
 * fallback, and the parser touches no session or HAR state: the caller must
 * parse BEFORE any session/HAR lookup, so an invalid filter wins over a
 * missing or corrupt artifact.
 */
import { captureError, type CaptureError } from '../errors.js';

const EXACT = /^[1-5]\d{2}$/;
const CLASS_PREFIX = /^[1-5]$/;
const RANGE = /^([1-5]\d{2})-([1-5]\d{2})$/;

/** Decides whether one recorded response status matches the parsed filter. */
export type StatusPredicate = (status: number) => boolean;

function invalidFilter(spec: string): CaptureError {
  const received = spec === '' ? '(empty)' : spec;
  return captureError(
    'invocation',
    'invalid_filter',
    `received: --filter-status ${received}; expected an exact status (100-599), a one-digit class prefix (1-5), or an ordered range like 400-499.`,
  );
}

/**
 * Parses one `--filter-status` token into a status predicate, or throws a
 * typed `invalid_filter` CaptureError for any token outside the documented
 * grammar. Pure: no session, filesystem, or HAR access.
 */
export function parseStatusFilter(spec: string): StatusPredicate {
  if (EXACT.test(spec)) {
    const code = Number(spec);
    return (status) => status === code;
  }
  if (CLASS_PREFIX.test(spec)) {
    const lo = Number(spec) * 100;
    const hi = lo + 99;
    return (status) => status >= lo && status <= hi;
  }
  const range = RANGE.exec(spec);
  if (range) {
    const lo = Number(range[1]);
    const hi = Number(range[2]);
    if (lo > hi) throw invalidFilter(spec);
    return (status) => status >= lo && status <= hi;
  }
  throw invalidFilter(spec);
}
