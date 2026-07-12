/**
 * Frozen immutable snapshot manifest contract (U1). `meta.json` is the SOLE
 * immutable snapshot manifest and the only marker a snapshot ref resolves. A
 * source facet with no `schemaVersion` is legacy source schema 1; new
 * acquisition writes source schema 2. Readers never rewrite old artifacts and
 * never infer a newly-required v2 fact from a legacy approximation — an
 * unavailable fact narrows the claim.
 *
 * `manifest.json` is reserved for DERIVED reads (see `neutral.ts`), never a
 * snapshot. Session aggregation uses `bundle.json` and discovers snapshots only
 * through `meta.json`.
 *
 * This module is type/interface + pure validators only.
 */

import {
  Availability,
  OK,
  ValidationResult,
  combine,
  contextualize,
  fail,
  isFiniteNumber,
  isObject,
} from './primitives.js';

/** Integer source schema version. Absent on a facet/object == legacy 1. */
export type SchemaVersion = 1 | 2;

/** The canonical source facet file names (design coverage table). */
export const FACET_NAMES = [
  'geometry',
  'styles',
  'hittest',
  'ax',
  'text',
  'forms',
  'media',
  'animation',
  'focus',
  'scroll',
  'layers',
  'queries',
  'states',
  'pixels',
  'churn',
  'authored-ids',
] as const;
export type FacetName = (typeof FACET_NAMES)[number];

/**
 * Whether reaching a declared cap proves truncation, only possibly truncated,
 * or is merely a bounded auxiliary-enrichment cap that never implies dropped
 * population. Every declared cap says which.
 */
export type CapKind = 'truncation-proof' | 'possible-truncation' | 'bounded-auxiliary';

export interface CapSpec {
  readonly name: string;
  readonly limit: number;
  readonly kind: CapKind;
  /** True once the cap was actually reached in this acquisition. */
  readonly reached: boolean;
}

/**
 * Retained-population accounting for one facet. `dropped` is exact when known;
 * otherwise `droppedUnknown` is true. `sourceTotal` is present only when the
 * source total was actually measured.
 */
export interface FacetPopulation {
  readonly sourceTotal?: number;
  readonly kept: number;
  readonly dropped?: number;
  readonly droppedUnknown?: boolean;
  /** Named, machine-stable exclusion reasons applied during collection. */
  readonly exclusions: readonly string[];
}

/** One facet's manifest entry: path, schema, availability, scope, population, caps. */
export interface FacetManifest {
  readonly name: FacetName;
  /** Relative path within the snapshot dir, e.g. `geometry.json`. */
  readonly path: string;
  readonly schemaVersion: SchemaVersion;
  /** Availability of the facet itself (a v2 facet whose attestation disagrees is unavailable). */
  readonly availability: Availability<null>;
  /** Human/machine scope description of the retained population. */
  readonly scope: string;
  readonly population: FacetPopulation;
  readonly caps: readonly CapSpec[];
}

/** Screenshot raster dimensions are device pixels, NOT CSS viewport dimensions. */
export interface RasterAuthority {
  readonly space: 'screenshot/device-px';
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  /** Explicit CSS-to-device transform (scale factors), never assumed 1. */
  readonly cssToDeviceScaleX: number;
  readonly cssToDeviceScaleY: number;
}

/**
 * Coordinate/layout authority recorded on the manifest. Each metric is
 * independently available. The authoritative visual viewport is at origin
 * {0,0}; layout viewport and DOM scroll extent are separate evidence and never
 * substitute for a missing authority.
 */
export interface CoordinateAuthority {
  readonly cssVisualViewport: Availability<{ readonly clientWidth: number; readonly clientHeight: number }>;
  readonly cssLayoutViewport: Availability<{ readonly clientWidth: number; readonly clientHeight: number }>;
  readonly cssContentSize: Availability<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>;
  readonly raster: Availability<RasterAuthority>;
}

/** Separately-named content inputs (never merged with a `max`). */
export interface ContentInputs {
  readonly documentScrollWidth: Availability<number>;
  readonly documentScrollHeight: Availability<number>;
}

/** The enriched immutable snapshot manifest. */
export interface SnapshotMetaV2 {
  readonly schemaVersion: 2;
  /** Snapshot identity (container-id grammar). */
  readonly snapshotId: string;
  /** The request that produced it (url, viewport, flags) — preserved verbatim. */
  readonly request: Record<string, unknown>;
  /** Settledness/timing facts. */
  readonly settled: boolean;
  readonly timing: Record<string, unknown>;
  readonly coordinateAuthority: CoordinateAuthority;
  readonly contentInputs: ContentInputs;
  readonly facets: readonly FacetManifest[];
  /** Source-pixel coverage summary. */
  readonly sourcePixelCoverage: unknown;
}

/**
 * A legacy (schema 1) snapshot manifest: physically retained facts only. New
 * ancestry completeness, AX join coverage, content authority, cap attestation,
 * authored-ID uniqueness, and layer-transform facts are unavailable where
 * absent, never backfilled.
 */
export interface SnapshotMetaV1 {
  readonly schemaVersion?: 1;
  readonly snapshotId: string;
  readonly request?: Record<string, unknown>;
  readonly facets: readonly { readonly name: string; readonly path: string }[];
}

export type SnapshotMeta = SnapshotMetaV1 | SnapshotMetaV2;

// ---------------------------------------------------------------------------
// Validators.
// ---------------------------------------------------------------------------

export function isV2Meta(meta: SnapshotMeta): meta is SnapshotMetaV2 {
  return (meta as { schemaVersion?: number }).schemaVersion === 2;
}

/** Effective source schema version of any object: 2 if explicit, else legacy 1. Unknown versions are invalid. */
export function effectiveSchemaVersion(obj: unknown): SchemaVersion | 'unknown' {
  if (!isObject(obj)) return 'unknown';
  const v = obj.schemaVersion;
  if (v === undefined) return 1;
  if (v === 1 || v === 2) return v;
  return 'unknown';
}

function validateCap(cap: CapSpec): ValidationResult {
  const valid: CapKind[] = ['truncation-proof', 'possible-truncation', 'bounded-auxiliary'];
  if (!valid.includes(cap.kind)) return fail(`cap ${cap.name} has invalid kind ${cap.kind}`);
  if (!(cap.limit >= 0)) return fail(`cap ${cap.name} has invalid limit`);
  return OK;
}

function validatePopulation(pop: FacetPopulation): ValidationResult {
  const errs: ValidationResult[] = [];
  if (!(pop.kept >= 0)) errs.push(fail('kept must be >= 0'));
  const hasExactDrop = pop.dropped !== undefined;
  const hasUnknownDrop = pop.droppedUnknown === true;
  if (hasExactDrop && hasUnknownDrop) {
    errs.push(fail('facet declares both exact dropped and droppedUnknown'));
  }
  if (pop.sourceTotal !== undefined && hasExactDrop) {
    if (pop.sourceTotal !== pop.kept + (pop.dropped as number)) {
      errs.push(fail(`sourceTotal(${pop.sourceTotal}) != kept(${pop.kept}) + dropped(${pop.dropped})`));
    }
  }
  if (!Array.isArray(pop.exclusions)) errs.push(fail('exclusions must be an array'));
  return combine(...errs);
}

export function validateFacetManifest(facet: FacetManifest): ValidationResult {
  const errs: ValidationResult[] = [];
  if (!(FACET_NAMES as readonly string[]).includes(facet.name)) {
    errs.push(fail(`unknown facet name: ${facet.name}`));
  }
  if (!facet.path) errs.push(fail(`facet ${facet.name} missing path`));
  if (facet.schemaVersion !== 1 && facet.schemaVersion !== 2) {
    errs.push(fail(`facet ${facet.name} has unsupported schemaVersion ${facet.schemaVersion}`));
  }
  errs.push(contextualize(`facet ${facet.name} population`, validatePopulation(facet.population)));
  for (const cap of facet.caps) errs.push(contextualize(`facet ${facet.name}`, validateCap(cap)));
  return combine(...errs);
}

function validateAvailabilityNumber(a: Availability<unknown>, label: string): ValidationResult {
  if (!isObject(a)) return fail(`${label} must be an availability object`);
  if (a.available === false) {
    return typeof a.reason === 'string' && a.reason.length > 0
      ? OK
      : fail(`${label} unavailable without a reason`);
  }
  if (a.available !== true) return fail(`${label} missing available flag`);
  return OK;
}

/** Validate a v2 snapshot manifest structurally (not the on-disk facet bytes). */
export function validateSnapshotMetaV2(meta: SnapshotMetaV2): ValidationResult {
  const errs: ValidationResult[] = [];
  if (meta.schemaVersion !== 2) errs.push(fail('v2 meta must declare schemaVersion 2'));
  if (!meta.snapshotId) errs.push(fail('missing snapshotId'));
  if (!isObject(meta.coordinateAuthority)) {
    errs.push(fail('missing coordinateAuthority'));
  } else {
    const ca = meta.coordinateAuthority;
    errs.push(validateAvailabilityNumber(ca.cssVisualViewport, 'cssVisualViewport'));
    errs.push(validateAvailabilityNumber(ca.cssLayoutViewport, 'cssLayoutViewport'));
    errs.push(validateAvailabilityNumber(ca.cssContentSize, 'cssContentSize'));
    errs.push(validateAvailabilityNumber(ca.raster, 'raster'));
    // If raster available, DPR must be a finite positive number.
    if (isObject(ca.raster) && ca.raster.available === true && (!isObject(ca.raster.value) || !(isFiniteNumber(ca.raster.value.devicePixelRatio) && ca.raster.value.devicePixelRatio > 0))) {
      errs.push(fail('raster authority available but devicePixelRatio is not a finite positive number'));
    }
  }
  if (!isObject(meta.contentInputs)) {
    errs.push(fail('missing contentInputs'));
  } else {
    errs.push(validateAvailabilityNumber(meta.contentInputs.documentScrollWidth, 'documentScrollWidth'));
    errs.push(validateAvailabilityNumber(meta.contentInputs.documentScrollHeight, 'documentScrollHeight'));
  }
  if (!Array.isArray(meta.facets) || meta.facets.length === 0) {
    errs.push(fail('v2 meta must declare at least one facet'));
  } else {
    for (const f of meta.facets) errs.push(validateFacetManifest(f));
  }
  return combine(...errs);
}

/** Validate any snapshot manifest: accepts v1 and v2, rejects unknown versions. */
export function validateSnapshotMeta(meta: unknown): ValidationResult {
  const version = effectiveSchemaVersion(meta);
  if (version === 'unknown') return fail('unsupported snapshot schemaVersion');
  if (!isObject(meta)) return fail('snapshot meta must be an object');
  if (version === 2) return validateSnapshotMetaV2(meta as unknown as SnapshotMetaV2);
  // Legacy v1: physically-retained facts only.
  const errs: ValidationResult[] = [];
  if (typeof meta.snapshotId !== 'string' || !meta.snapshotId) errs.push(fail('legacy meta missing snapshotId'));
  if (!Array.isArray(meta.facets)) errs.push(fail('legacy meta missing facets array'));
  return combine(...errs);
}
