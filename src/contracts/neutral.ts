/** Frozen neutral measurement derived-read contracts (U1), pure types/validators only. */
import { Availability, OK, ValidationResult, combine, fail, isObject } from './primitives.js';

/** The eleven canonical family order is semantic and deterministic. */
export const NEUTRAL_FAMILIES = [
  'viewport-box-position', 'element-scroll-extent', 'native-interactive-box-size',
  'computed-color-pair-contrast', 'sampled-hit-reception', 'text-inline-extent',
  'form-control-state', 'media-state', 'animation-state',
  'opaque-background-sibling-box-intersection',
  'css-overflow-visible-descendant-peer-box-intersection',
] as const;
export type NeutralFamily = (typeof NEUTRAL_FAMILIES)[number];

export interface NumericSummary { readonly count: number; readonly unavailableCount: number; readonly min: number | null; readonly p25: number | null; readonly p50: number | null; readonly p75: number | null; readonly max: number | null; }
export interface FactProvenance { readonly snapshotId: string; readonly sources: readonly string[]; readonly artifactPath: string; readonly jsonPointer: string; }
export interface NeutralFact { readonly id: string; readonly family: NeutralFamily; readonly schemaVersion: 1; readonly subjects: readonly string[]; readonly values: Record<string, unknown>; readonly units: Record<string, string>; readonly availability: Availability<null>; readonly provenance: FactProvenance; }
export interface FamilyCoverage { readonly populationDefinition: string; readonly schemaVersion: 1; readonly sources: readonly string[]; readonly availability: Availability<null>; readonly populationCount: number; readonly measuredCount: number; readonly unavailableCount: number; readonly sourceTotal?: number; readonly kept: number; readonly dropped?: number; readonly droppedUnknown?: boolean; readonly caps: readonly string[]; readonly exclusions: readonly string[]; readonly unavailableReasons: Readonly<Record<string, number>>; }
export interface NeutralFamilyStore { readonly family: NeutralFamily; readonly coverage: FamilyCoverage; readonly numericSummaries: Readonly<Record<string, NumericSummary>>; readonly categoricalMaps: Readonly<Record<string, Readonly<Record<string, number>>>>; readonly relationCandidateAccounting?: Record<string, number>; readonly facts: readonly NeutralFact[]; }
/** Exhaustive retained measurement evidence, never a bounded display projection. */
export interface FactsManifest { readonly schemaVersion: 1; readonly snapshotIds: readonly string[]; readonly familyOrder: readonly NeutralFamily[]; readonly families: readonly NeutralFamilyStore[]; readonly completeWithinRetainedCoverage: true; }

/** One merged snapshot-local subject; collisions never merge subjects. */
export interface SelectorSubject { readonly subjectId: string; readonly snapshotId: string; readonly geometryOrdinal?: number; readonly axSourceOrdinal?: number; readonly textSourceOrdinal?: number; readonly backendNodeId?: number; readonly css?: readonly string[]; readonly axIds?: readonly string[]; readonly axNames?: readonly string[]; readonly text?: readonly string[]; }
export interface SelectorsManifest { readonly schemaVersion: 1; readonly snapshotIds: readonly string[]; readonly order: 'geometry-ordinal-then-ax-document-order-then-text-capture-order'; readonly subjects: readonly SelectorSubject[]; }

/** Source occurrence attested by a derived read. SHA-256 is over source `meta.json` bytes. */
export interface ReadSourceOccurrence { readonly snapshotId: string; readonly canonicalPath: string; readonly metaSchemaVersion: 1 | 2; readonly metaSha256: string; }
export interface DerivedReadManifest { readonly schemaVersion: 1; readonly readId: string; readonly owner: string; readonly operation: string; readonly sources: readonly ReadSourceOccurrence[]; readonly factsPath: string; readonly selectorsPath: string; readonly familyCounts: Readonly<Record<string, number>>; readonly factOrderVersion: 1; readonly selectorOrderVersion: 1; readonly completeWithinRetainedCoverage: true; readonly cropsPath?: string; }

export function validateFactsManifest(value: unknown): ValidationResult {
  if (!isObject(value)) return fail('facts manifest must be an object');
  const errs: ValidationResult[] = [];
  if (value.schemaVersion !== 1) errs.push(fail('facts schemaVersion must be 1'));
  if (!Array.isArray(value.snapshotIds) || !value.snapshotIds.every((x) => typeof x === 'string')) errs.push(fail('facts requires snapshotIds string array'));
  if (!Array.isArray(value.familyOrder) || !Array.isArray(value.families)) errs.push(fail('facts requires familyOrder and families arrays'));
  else for (const family of value.families) {
    if (!isObject(family) || typeof family.family !== 'string' || !isObject(family.coverage) || !Array.isArray(family.facts)) errs.push(fail('facts contains malformed family store'));
  }
  if (value.completeWithinRetainedCoverage !== true) errs.push(fail('facts must attest completeWithinRetainedCoverage=true'));
  return combine(...errs);
}
export function validateSelectorsManifest(value: unknown): ValidationResult {
  if (!isObject(value)) return fail('selectors manifest must be an object');
  if (value.schemaVersion !== 1) return fail('selectors schemaVersion must be 1');
  if (!Array.isArray(value.snapshotIds) || !Array.isArray(value.subjects) || typeof value.order !== 'string') return fail('selectors requires snapshotIds, order, and subjects');
  return OK;
}
export function validateDerivedReadManifest(value: unknown): ValidationResult {
  if (!isObject(value)) return fail('derived read manifest must be an object');
  const errs: ValidationResult[] = [];
  if (value.schemaVersion !== 1) errs.push(fail('derived read manifest schemaVersion must be 1'));
  for (const f of ['readId', 'owner', 'operation', 'factsPath', 'selectorsPath']) if (typeof value[f] !== 'string' || !value[f]) errs.push(fail(`missing ${f}`));
  if (!Array.isArray(value.sources)) errs.push(fail('derived read manifest requires sources array'));
  if (value.completeWithinRetainedCoverage !== true) errs.push(fail('derived read must attest completeWithinRetainedCoverage=true'));
  return combine(...errs);
}
