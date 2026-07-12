/** Frozen retained accessibility tree contract (U1), with pure validators only. */
import { Availability, OK, ValidationResult, combine, fail, isObject } from './primitives.js';

export interface AxRectCoverage { readonly eligible: number; readonly attempted: number; readonly succeeded: number; readonly failed: number; readonly skipped: number; }
/** Every retained AX node is source ordered, including ignored/unnamed nodes, and preserves evidence verbatim. */
export interface AxTreeNode { readonly axId: string; readonly sourceOrdinal: number; readonly role?: string; readonly name?: string; readonly description?: string; readonly value?: unknown; readonly ignored: boolean; readonly cdpNodeId?: number; readonly backendNodeId?: number; readonly parentAxId?: string; readonly childAxIds: readonly string[]; readonly rect: Availability<unknown>; readonly raw: Record<string, unknown>; }
/** Exhaustive retained store: first <=5000 source-array nodes, no semantic filtering. */
export interface AxTreeManifest { readonly schemaVersion: 1; readonly treeId: string; readonly source: 'live' | 'snapshot'; readonly snapshotId?: string; readonly nodes: readonly AxTreeNode[]; readonly sourceTotal?: number; readonly retained: number; readonly dropped?: number; readonly droppedUnknown?: boolean; readonly rectCoverage: AxRectCoverage; readonly iframeExclusion: Availability<null>; }
/** Sidecar meta at `<owner>/a11y/trees/<tree-id>/meta.json`; tree lifetime equals file lifetime. */
export interface AxTreeReference { readonly schemaVersion: 1; readonly treeId: string; readonly treePath: string; readonly metaPath: string; readonly owner: string; readonly retained: number; readonly coverage: Pick<AxTreeManifest, 'sourceTotal' | 'dropped' | 'droppedUnknown' | 'rectCoverage'>; }
export function validateAxTreeManifest(value: unknown): ValidationResult {
  if (!isObject(value)) return fail('a11y tree must be an object');
  const errs: ValidationResult[] = [];
  if (value.schemaVersion !== 1) errs.push(fail('a11y tree schemaVersion must be 1'));
  if (typeof value.treeId !== 'string' || !value.treeId) errs.push(fail('a11y tree missing treeId'));
  if (value.source !== 'live' && value.source !== 'snapshot') errs.push(fail('a11y tree source must be live or snapshot'));
  if (!isObject(value.rectCoverage)) errs.push(fail('a11y tree missing rectCoverage'));
  if (!isObject(value.iframeExclusion)) errs.push(fail('a11y tree missing iframeExclusion'));
  if (!Array.isArray(value.nodes)) errs.push(fail('a11y tree requires nodes array'));
  else {
    if (value.nodes.length > 5000) errs.push(fail('a11y tree retains more than 5000 nodes'));
    const ids = new Set<string>();
    for (const node of value.nodes) {
      if (!isObject(node) || typeof node.axId !== 'string') { errs.push(fail('a11y tree has malformed node')); continue; }
      if (ids.has(node.axId)) errs.push(fail(`a11y tree duplicate retained AX ID: ${node.axId}`));
      ids.add(node.axId);
    }
  }
  if (typeof value.retained !== 'number') errs.push(fail('a11y tree missing retained count'));
  else if (Array.isArray(value.nodes) && value.retained !== value.nodes.length) errs.push(fail('a11y tree retained count must equal node count'));
  if (typeof value.sourceTotal === 'number' && typeof value.dropped === 'number' && typeof value.retained === 'number' && value.sourceTotal !== value.retained + value.dropped) errs.push(fail('a11y tree sourceTotal must equal retained + dropped'));
  return combine(...errs);
}
