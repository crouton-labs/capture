/** Frozen motion observations schema-2 contract (U1), pure types/validators only. */
import { Availability, OK, ValidationResult, combine, fail, isObject } from './primitives.js';

export const MOTION_OBSERVATION_FAMILIES = ['source-record', 'trace-event', 'frame-interval', 'frame-pixel-delta', 'element-rect-delta', 'observer-rect-delta'] as const;
export type MotionObservationFamily = (typeof MOTION_OBSERVATION_FAMILIES)[number];
/** Source ordinals are contiguous across the entire recording before final write. */
export interface MotionObservation { readonly id: string; readonly family: MotionObservationFamily; readonly sourceOrdinal: number; readonly kindRank: number; readonly childRank: number; readonly values: Record<string, unknown>; readonly availability: Availability<null>; readonly provenance: { readonly recordingId: string; readonly artifactPath: string; readonly jsonPointer: string }; }
export interface MotionObservationsManifest { readonly schemaVersion: 2; readonly recordingId: string; readonly sourceSchemaVersion: 2; readonly observations: readonly MotionObservation[]; readonly completeWithinRetainedCoverage: true; readonly ordering: '(sourceOrdinal,kind-rank,child-rank)'; }
export function validateMotionObservationsManifest(value: unknown): ValidationResult {
  if (!isObject(value)) return fail('motion observations must be an object');
  const errs: ValidationResult[] = [];
  if (value.schemaVersion !== 2 || value.sourceSchemaVersion !== 2) errs.push(fail('motion observations requires recording/source schemaVersion 2'));
  if (typeof value.recordingId !== 'string' || !value.recordingId) errs.push(fail('motion observations missing recordingId'));
  if (value.ordering !== '(sourceOrdinal,kind-rank,child-rank)') errs.push(fail('motion observations has wrong ordering declaration'));
  if (value.completeWithinRetainedCoverage !== true) errs.push(fail('motion observations must attest retained coverage completeness'));
  if (!Array.isArray(value.observations)) errs.push(fail('motion observations requires array'));
  else for (const observation of value.observations) if (!isObject(observation) || typeof observation.id !== 'string' || !MOTION_OBSERVATION_FAMILIES.includes(observation.family as MotionObservationFamily) || !Number.isSafeInteger(observation.sourceOrdinal)) errs.push(fail('motion observations contains malformed observation'));
  return combine(...errs);
}
