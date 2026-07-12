/** Frozen hard-cut release metadata contract (U1), pure types/validators only. */
import { OK, ValidationResult, combine, fail, isObject, isSha256Hex } from './primitives.js';
/** Canonical JSON stored in the annotated release tag message. */
export interface ReleaseTagMetadata { readonly schemaVersion: 1; readonly package: '@crouton-kit/capture'; readonly version: string; readonly baseSha: string; readonly releaseSha: string; readonly gateSha: string; readonly tarball: { readonly filename: string; readonly bytes: number; readonly sha256: string; readonly integrity: string }; readonly runtime: { readonly node: string; readonly npm: string; readonly pnpm: string }; }
/** Persisted release controller state; conflicts are nonmutating. */
export type ReleaseDisposition = 'candidate' | 'release_already_published' | 'release_publish_retryable' | 'registry_integrity_conflict' | 'release_state_conflict';
export function validateReleaseTagMetadata(value: unknown): ValidationResult {
  if (!isObject(value)) return fail('release tag metadata must be an object');
  const errs: ValidationResult[] = [];
  if (value.schemaVersion !== 1) errs.push(fail('release tag schemaVersion must be 1'));
  if (value.package !== '@crouton-kit/capture') errs.push(fail('release tag package must be @crouton-kit/capture'));
  if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)) errs.push(fail('invalid version'));
  for (const key of ['baseSha', 'releaseSha', 'gateSha']) if (typeof value[key] !== 'string' || !/^[0-9a-f]{40,64}$/.test(value[key] as string)) errs.push(fail(`invalid ${key}`));
  if (!isObject(value.tarball) || typeof value.tarball.filename !== 'string' || !(typeof value.tarball.bytes === 'number' && value.tarball.bytes >= 0) || typeof value.tarball.integrity !== 'string' || typeof value.tarball.sha256 !== 'string' || !isSha256Hex(value.tarball.sha256)) errs.push(fail('invalid tarball metadata'));
  if (!isObject(value.runtime) || !['node', 'npm', 'pnpm'].every((key) => typeof value.runtime[key] === 'string' && value.runtime[key])) errs.push(fail('invalid runtime metadata'));
  return combine(...errs);
}
