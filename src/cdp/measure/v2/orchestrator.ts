import { SnapshotFacet, SnapshotMetaV2, SnapshotTargetAttestation } from '../../../contracts/snapshot.js';
import { allocateSnapshotStaging, cleanupSnapshotStaging, finalizeSnapshotManifest, publishSnapshot, SnapshotIndexEntry } from '../../../output/artifact-lifecycle.js';
import { createArtifactWriter, defaultSnapshotCollectors, DeclaredArtifact, SnapshotCollectorRegistry, sourceArtifactDeclaration } from './collectors.js';
import { SnapAcquisitionRequest } from './snap-selection.js';
import { ResolvedTarget } from './target.js';
import { withTargetMutationLock } from './target-lock.js';
export interface PinnedSession { readonly sessionId: string; readonly source: 'active' | 'explicit'; readonly generation: number | null; readonly target: ResolvedTarget; readonly directory: string; }
export interface SessionSnapshotAuthority { withPinnedOpenSession<T>(selection: Extract<SnapAcquisitionRequest['selection'], { kind: 'named-session' | 'active-session' }>, fn: (session: PinnedSession) => Promise<T>): Promise<T>; }
export interface SnapshotOrchestratorDeps { readonly artifactRoot?: string; readonly collectors?: SnapshotCollectorRegistry; readonly resolveTarget: (request: SnapAcquisitionRequest) => Promise<{ readonly target: ResolvedTarget; readonly attestation: SnapshotTargetAttestation; readonly association: 'one-shot' | { readonly sessionId: string }; readonly close?: () => Promise<boolean> }>; readonly sessions?: SessionSnapshotAuthority; readonly coordinateAuthority?: Record<string, unknown>; readonly contentInputs?: Record<string, unknown>; }
export interface SnapshotAcquisitionResult { readonly snapshot: SnapshotIndexEntry; readonly attestation: SnapshotTargetAttestation; }
const sameTarget = (a: ResolvedTarget, b: ResolvedTarget): boolean => a.identity.host === b.identity.host && a.identity.port === b.identity.port && a.identity.fullTargetId === b.identity.fullTargetId;
const unavailable = { retained_count: 0, availability: { state: 'unavailable' as const, reason: 'collector-unavailable' }, truncation: { state: 'unknown' as const }, source_total: { state: 'unavailable' as const, reason: 'collector-unavailable' } };
const facet = (requested: boolean, primary: { name: string; coverage: any } | undefined, subpopulations: Record<string, any> | undefined): SnapshotFacet => { const coverage = primary?.coverage ?? unavailable; const blocked = coverage.availability !== 'available'; return { status: !requested ? 'not-requested' : blocked ? 'unavailable' : 'available', primary_population: primary ?? { name: 'unavailable', coverage }, subpopulations: subpopulations ?? {}, unavailable_reason: !requested ? null : blocked ? coverage.availability.reason : null }; };
/** Private/unreachable acquisition seam. Resolution, pinning, locking, collection, restoration, close, and publication are one lifecycle. */
export async function acquireSnapshotV2(request: SnapAcquisitionRequest, deps: SnapshotOrchestratorDeps): Promise<SnapshotAcquisitionResult> {
  const run = async (pinned?: PinnedSession): Promise<SnapshotAcquisitionResult> => {
    const resolved = await deps.resolveTarget(request);
    if (pinned && !sameTarget(pinned.target, resolved.target)) throw new Error('session target changed while pinned');
    const target = pinned?.target ?? resolved.target;
    return withTargetMutationLock(target.identity, async () => {
      let staging: ReturnType<typeof allocateSnapshotStaging> | undefined; let published = false; let closeAttempted = false; let primary: unknown; let restoration: unknown; let close: unknown;
      try {
        staging = allocateSnapshotStaging(deps.artifactRoot);
        const restorers: Array<{ name: string; restore: () => Promise<{ restored: boolean; reason?: string }> }> = []; const writer = createArtifactWriter(staging.directory, restorers); const results = new Map<string, { primary: any; subpopulations: Record<string, any>; artifacts: readonly DeclaredArtifact[] }>(); const registry = deps.collectors ?? defaultSnapshotCollectors;
        const baseline = registry.entries.filter(entry => entry.phase === 'baseline' && entry.requested(request));
        const settled = await Promise.allSettled(baseline.map(entry => entry.collect({ request, root: staging!.directory, ...writer }).then(result => results.set(entry.facet, result))));
        primary = settled.find(item => item.status === 'rejected' && item.reason)?.reason;
        if (!primary) for (const entry of registry.entries.filter(entry => entry.phase === 'mutating' && entry.requested(request))) { try { results.set(entry.facet, await entry.collect({ request, root: staging.directory, ...writer })); } catch (error) { primary = error; break; } }
        for (const restorer of [...restorers].reverse()) try { const result = await restorer.restore(); if (!result.restored) restoration ??= new Error(result.reason ?? `restoration ${restorer.name} unconfirmed`); } catch (error) { restoration ??= error; }
        if (resolved.close) try { closeAttempted = true; if (!(await resolved.close())) close = new Error('temporary_target_cleanup_unconfirmed'); } catch (error) { close = error; }
        if (close || restoration || primary) throw close ?? restoration ?? primary;
        const facets = {} as SnapshotMetaV2['facets']; const artifacts: DeclaredArtifact[] = [];
        for (const entry of registry.entries) { const result = results.get(entry.facet); (facets as any)[entry.facet] = facet(entry.requested(request), result?.primary, result?.subpopulations); if (result) artifacts.push(...result.artifacts); }
        const meta: Omit<SnapshotMetaV2, 'snapshotId'> = { schemaVersion: 2, request: { selection: request.selection }, settled: true, timing: {}, coordinateAuthority: deps.coordinateAuthority ?? {}, contentInputs: deps.contentInputs ?? {}, target: resolved.attestation, facets, source_artifact_manifest: { schemaVersion: 2, artifacts: artifacts.map(artifact => sourceArtifactDeclaration(staging!.directory, artifact)).sort((a, b) => a.path.localeCompare(b.path)) }, sourcePixelCoverage: {} };
        finalizeSnapshotManifest(staging, meta); const snapshot = publishSnapshot(staging, resolved.association, deps.artifactRoot); published = true; return { snapshot, attestation: resolved.attestation };
      } catch (error) {
        primary ??= error;
        if (resolved.close && !closeAttempted) try { closeAttempted = true; if (!(await resolved.close())) close = new Error('temporary_target_cleanup_unconfirmed'); } catch (closeError) { close = closeError; }
        if (staging && !published) cleanupSnapshotStaging(staging, deps.artifactRoot);
        throw close ?? restoration ?? primary;
      }
    });
  };
  if (request.selection.kind === 'named-session' || request.selection.kind === 'active-session') { if (!deps.sessions) throw new Error('session snapshot authority is required'); return deps.sessions.withPinnedOpenSession(request.selection, run); }
  return run();
}
