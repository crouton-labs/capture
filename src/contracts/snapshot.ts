/** Immutable source snapshot contracts. V2 is the only acquisition schema; V1 is read-only legacy evidence. */
import { OK, ValidationResult, combine, fail, isObject } from './primitives.js';

export type SchemaVersion = 1 | 2;
export const SNAPSHOT_FACET_NAMES = ['viewport', 'geometry', 'styles', 'hit-testing', 'text', 'forms', 'media', 'animation', 'accessibility', 'queries', 'focus', 'scroll', 'layers', 'states', 'pixels', 'screenshot', 'dom-html'] as const;
export type SnapshotFacetName = (typeof SNAPSHOT_FACET_NAMES)[number];
/** @deprecated Legacy source facets are read-only; new snapshots use SNAPSHOT_FACET_NAMES. */
export const FACET_NAMES = SNAPSHOT_FACET_NAMES;
export type FacetName = SnapshotFacetName;

export type CollectorCoverage = {
  readonly retained_count: number;
  readonly availability: 'available' | { readonly state: 'unavailable'; readonly reason: string };
  readonly truncation: { readonly state: 'none' } | { readonly state: 'exact'; readonly dropped_count: number } | { readonly state: 'lower_bound'; readonly dropped_count_lower_bound: number } | { readonly state: 'unknown' };
  readonly source_total: { readonly state: 'exact'; readonly count: number } | { readonly state: 'lower_bound'; readonly count_lower_bound: number } | { readonly state: 'unavailable'; readonly reason: string };
};
export type SnapshotFacet = { readonly status: 'available' | 'unavailable' | 'not-requested'; readonly primary_population: { readonly name: string; readonly coverage: CollectorCoverage }; readonly subpopulations: Readonly<Record<string, CollectorCoverage>>; readonly unavailable_reason: string | null };
export interface CdpEndpoint { readonly host: '127.0.0.1'; readonly port: number; }
export interface SnapshotTargetAttestation { readonly mode: 'fresh-url' | 'session' | 'explicit-target'; readonly session_id: string | null; readonly session_source: 'active' | 'explicit' | null; readonly target_id: string; readonly endpoint: CdpEndpoint; readonly observed_url: string; }
export interface SourceManifestArtifact { readonly key: string; readonly path: string; readonly bytes: number; readonly sha256: string; readonly media_type: string; readonly retained_arrays: readonly { readonly key: string; readonly json_pointer: string; readonly retained_count: number }[]; }
export interface SourceArtifactManifest { readonly schemaVersion: 2; readonly artifacts: readonly SourceManifestArtifact[]; }
export interface SnapshotMetaV2 {
  readonly schemaVersion: 2;
  readonly snapshotId: string;
  readonly request: Record<string, unknown>;
  readonly settled: boolean;
  readonly timing: Record<string, unknown>;
  readonly coordinateAuthority: Record<string, unknown>;
  readonly contentInputs: Record<string, unknown>;
  readonly target: SnapshotTargetAttestation;
  readonly facets: { readonly [K in SnapshotFacetName]: SnapshotFacet };
  readonly source_artifact_manifest: SourceArtifactManifest;
  readonly sourcePixelCoverage: unknown;
}
export interface SnapshotMetaV1 { readonly schemaVersion?: 1; readonly snapshotId: string; readonly request?: Record<string, unknown>; readonly facets: readonly { readonly name: string; readonly path: string }[]; }
export type SnapshotMeta = SnapshotMetaV1 | SnapshotMetaV2;
export function isV2Meta(meta: SnapshotMeta): meta is SnapshotMetaV2 { return (meta as { schemaVersion?: number }).schemaVersion === 2; }
export function effectiveSchemaVersion(obj: unknown): SchemaVersion | 'unknown' { if (!isObject(obj)) return 'unknown'; return obj.schemaVersion === undefined || obj.schemaVersion === 1 ? 1 : obj.schemaVersion === 2 ? 2 : 'unknown'; }

const safe = (n: unknown): n is number => Number.isSafeInteger(n) && n >= 0;
const reason = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 512;
const keys = (x: object): string[] => Object.keys(x);
const SUBPOPULATIONS: Record<SnapshotFacetName, readonly string[]> = { viewport: [], geometry: [], styles: [], 'hit-testing': [], text: [], forms: [], media: [], animation: [], accessibility: [], queries: ['media-queries', 'container-queries'], focus: ['forward', 'reverse'], scroll: ['snap-descendants', 'sticky-fixed-descendants', 'sampled-visible-children'], layers: [], states: [], pixels: [], screenshot: [], 'dom-html': [] };
function normalizedPath(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !value.includes('\\') && !value.startsWith('/') && !value.split('/').some(p => !p || p === '.' || p === '..'); }
function coverage(value: unknown): ValidationResult {
  if (!isObject(value)) return fail('coverage must be an object');
  const v = value as Partial<CollectorCoverage>;
  const errors: ValidationResult[] = [];
  if (!safe(v.retained_count)) errors.push(fail('retained_count must be a nonnegative safe integer'));
  const unavailable = isObject(v.availability) && v.availability.state === 'unavailable' && reason(v.availability.reason);
  if (v.availability !== 'available' && !unavailable) errors.push(fail('coverage availability is invalid'));
  if (!isObject(v.truncation) || !['none', 'exact', 'lower_bound', 'unknown'].includes(String(v.truncation.state))) errors.push(fail('coverage truncation is invalid'));
  else if (v.truncation.state === 'exact' && !safe(v.truncation.dropped_count)) errors.push(fail('exact truncation needs dropped_count'));
  else if (v.truncation.state === 'lower_bound' && !safe(v.truncation.dropped_count_lower_bound)) errors.push(fail('lower_bound truncation needs dropped_count_lower_bound'));
  if (!isObject(v.source_total) || !['exact', 'lower_bound', 'unavailable'].includes(String(v.source_total.state))) errors.push(fail('coverage source_total is invalid'));
  else if (v.source_total.state === 'exact' && !safe(v.source_total.count)) errors.push(fail('exact source_total needs count'));
  else if (v.source_total.state === 'lower_bound' && !safe(v.source_total.count_lower_bound)) errors.push(fail('lower_bound source_total needs count_lower_bound'));
  else if (v.source_total.state === 'unavailable' && !reason(v.source_total.reason)) errors.push(fail('unavailable source_total needs reason'));
  if (unavailable && (v.retained_count !== 0 || v.truncation?.state !== 'unknown' || v.source_total?.state !== 'unavailable')) errors.push(fail('unavailable coverage cannot represent zero evidence'));
  if (v.source_total?.state === 'exact' && v.truncation?.state === 'exact' && v.source_total.count !== (v.retained_count ?? 0) + v.truncation.dropped_count) errors.push(fail('exact coverage totals disagree'));
  return combine(...errors);
}
export function validateCollectorCoverage(value: unknown): ValidationResult { return coverage(value); }
function facet(name: SnapshotFacetName, value: unknown): ValidationResult {
  if (!isObject(value)) return fail(`facet ${name} must be an object`);
  const v = value as Partial<SnapshotFacet>; const errors = [coverage(v.primary_population?.coverage)];
  if (!v.primary_population || !reason(v.primary_population.name)) errors.push(fail(`facet ${name} primary population is invalid`));
  const expected = SUBPOPULATIONS[name];
  if (!isObject(v.subpopulations) || keys(v.subpopulations).join('\0') !== expected.join('\0')) errors.push(fail(`facet ${name} subpopulations are invalid`));
  else for (const item of expected) errors.push(coverage(v.subpopulations[item]));
  if (!['available', 'unavailable', 'not-requested'].includes(String(v.status))) errors.push(fail(`facet ${name} status is invalid`));
  if (v.status === 'unavailable' && !reason(v.unavailable_reason)) errors.push(fail(`facet ${name} unavailable without reason`));
  if (v.status !== 'unavailable' && v.unavailable_reason !== null) errors.push(fail(`facet ${name} has inconsistent unavailable reason`));
  if (v.status === 'not-requested' && name !== 'states' && name !== 'pixels') errors.push(fail(`facet ${name} cannot be not-requested`));
  return combine(...errors);
}
function validateSourceManifest(value: unknown): ValidationResult {
  if (!isObject(value) || value.schemaVersion !== 2 || !Array.isArray(value.artifacts)) return fail('source_artifact_manifest is invalid');
  const artifactKeys = new Set<string>(); const paths = new Set<string>(); const arrayKeys = new Set<string>(); const errors: ValidationResult[] = [];
  for (const a of value.artifacts) { if (!isObject(a) || !reason(a.key) || !normalizedPath(a.path) || !safe(a.bytes) || typeof a.media_type !== 'string' || !/^[a-f0-9]{64}$/.test(String(a.sha256)) || !Array.isArray(a.retained_arrays)) { errors.push(fail('source artifact is invalid')); continue; } if (artifactKeys.has(a.key) || paths.has(a.path)) errors.push(fail('duplicate source artifact key or path')); artifactKeys.add(a.key); paths.add(a.path); for (const r of a.retained_arrays) { if (!isObject(r) || !reason(r.key) || typeof r.json_pointer !== 'string' || (!r.json_pointer.startsWith('/') && r.json_pointer !== '') || !safe(r.retained_count) || arrayKeys.has(r.key)) errors.push(fail('source retained array is invalid')); else arrayKeys.add(r.key); } }
  return combine(...errors);
}
export function validateSnapshotMetaV2(meta: SnapshotMetaV2): ValidationResult {
  const errors: ValidationResult[] = [];
  if (!isObject(meta) || meta.schemaVersion !== 2 || typeof meta.snapshotId !== 'string' || !meta.snapshotId) errors.push(fail('invalid v2 identity'));
  if (!isObject(meta.request) || !isObject(meta.timing) || !isObject(meta.coordinateAuthority) || !isObject(meta.contentInputs)) errors.push(fail('v2 request/timing/authority fields must be objects'));
  if (!isObject(meta.facets) || keys(meta.facets).join('\0') !== SNAPSHOT_FACET_NAMES.join('\0')) errors.push(fail('v2 facets must use fixed ordered keys')); else for (const n of SNAPSHOT_FACET_NAMES) errors.push(facet(n, meta.facets[n]));
  const t = meta.target; if (!isObject(t) || !['fresh-url', 'session', 'explicit-target'].includes(String(t.mode)) || typeof t.target_id !== 'string' || !t.target_id || !isObject(t.endpoint) || t.endpoint.host !== '127.0.0.1' || !Number.isSafeInteger(t.endpoint.port) || t.endpoint.port < 1 || t.endpoint.port > 65535 || typeof t.observed_url !== 'string') errors.push(fail('invalid target attestation')); else if (t.mode === 'session' ? !(typeof t.session_id === 'string' && /^ses_[0-9a-z]{26}$/.test(t.session_id) && (t.session_source === 'active' || t.session_source === 'explicit')) : t.session_id !== null || t.session_source !== null) errors.push(fail('target attestation session fields disagree with mode'));
  errors.push(validateSourceManifest(meta.source_artifact_manifest));
  return combine(...errors);
}
export function validateSnapshotMeta(meta: unknown): ValidationResult { const version = effectiveSchemaVersion(meta); if (version === 'unknown' || !isObject(meta)) return fail('unsupported snapshot schemaVersion'); if (version === 2) return validateSnapshotMetaV2(meta as SnapshotMetaV2); return typeof meta.snapshotId === 'string' && Array.isArray(meta.facets) ? OK : fail('legacy meta is invalid'); }
