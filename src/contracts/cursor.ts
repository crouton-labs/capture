/** Frozen immutable index/cursor contract (U1), pure types/validators only. */
import { MAX_CURSOR_BYTES, OK, ValidationResult, combine, fail, isAscii, isObject, isSha256Hex } from './primitives.js';

/** Exactly the nine leaves permitted to materialize immutable cursor indexes. */
export type CursorLeaf = 'session list' | 'session view' | 'detect' | 'list' | 'lib list' | 'lib search' | 'lib show' | 'a11y search' | 'measure resolve';
export interface ImmutableIndex<Row = unknown> { readonly schemaVersion: 1; readonly leaf: CursorLeaf; readonly path: string; readonly digest: string; readonly createdAt: string; readonly expiresAt: string; readonly filter: Record<string, unknown>; readonly pageSize: number; readonly order: string; readonly coverage: unknown; readonly rows: readonly Row[]; }
/** Authenticated opaque cursor claims. The serialized token itself is <=2048 ASCII bytes. */
export interface CursorClaims { readonly schemaVersion: 1; readonly indexDigest: string; readonly leaf: CursorLeaf; readonly filter: Record<string, unknown>; readonly nextExclusiveOrdinal: number; readonly pageSize: number; readonly expiresAt: string; readonly mac: string; }
export function validateImmutableIndex(value: unknown): ValidationResult {
  if (!isObject(value)) return fail('immutable index must be an object');
  const errs: ValidationResult[] = [];
  if (value.schemaVersion !== 1) errs.push(fail('index schemaVersion must be 1'));
  if (typeof value.digest !== 'string' || !isSha256Hex(value.digest)) errs.push(fail('index digest must be lowercase SHA-256 hex'));
  if (!Array.isArray(value.rows)) errs.push(fail('index requires rows array'));
  if (!(typeof value.pageSize === 'number' && value.pageSize >= 1 && value.pageSize <= 20)) errs.push(fail('index pageSize must be 1..20'));
  return combine(...errs);
}
export function validateCursorToken(token: string): ValidationResult {
  if (!isAscii(token)) return fail('cursor must be ASCII');
  if (Buffer.byteLength(token, 'ascii') > MAX_CURSOR_BYTES) return fail(`cursor exceeds ${MAX_CURSOR_BYTES} ASCII bytes`);
  return OK;
}
export function validateCursorClaims(value: unknown): ValidationResult {
  if (!isObject(value)) return fail('cursor claims must be an object');
  const errs: ValidationResult[] = [];
  if (value.schemaVersion !== 1) errs.push(fail('cursor schemaVersion must be 1'));
  if (typeof value.indexDigest !== 'string' || !isSha256Hex(value.indexDigest)) errs.push(fail('cursor missing valid indexDigest'));
  if (!['session list', 'session view', 'detect', 'list', 'lib list', 'lib search', 'lib show', 'a11y search', 'measure resolve'].includes(value.leaf as string)) errs.push(fail('cursor has invalid leaf'));
  if (!isObject(value.filter)) errs.push(fail('cursor missing filter object'));
  if (typeof value.expiresAt !== 'string' || Number.isNaN(Date.parse(value.expiresAt))) errs.push(fail('cursor missing valid expiresAt'));
  if (!(typeof value.nextExclusiveOrdinal === 'number' && Number.isSafeInteger(value.nextExclusiveOrdinal) && value.nextExclusiveOrdinal >= 0)) errs.push(fail('cursor nextExclusiveOrdinal must be nonnegative safe integer'));
  if (!(typeof value.pageSize === 'number' && value.pageSize >= 1 && value.pageSize <= 20)) errs.push(fail('cursor pageSize must be 1..20'));
  if (typeof value.mac !== 'string' || !value.mac) errs.push(fail('cursor missing MAC'));
  return combine(...errs);
}
