import * as crypto from 'node:crypto';
export interface CdpEndpoint { readonly host: '127.0.0.1'; readonly port: number; }
export interface EndpointTarget { readonly endpoint: CdpEndpoint; readonly fullTargetId: string; readonly type: string; readonly url: string; readonly title: string; readonly attachable: boolean; readonly websocketUrl: string | null; }
export interface TargetIdentity extends CdpEndpoint { readonly fullTargetId: string; }
export interface ResolvedTarget { readonly identity: TargetIdentity; readonly observedUrl: string; readonly websocketUrl: string; }
export interface TargetSnapshotSource { discoverEndpoints(): Promise<readonly CdpEndpoint[]>; list(endpoint: CdpEndpoint): Promise<readonly EndpointTarget[]>; }
export class TargetResolutionError extends Error { constructor(readonly code: 'target_unavailable', message: string) { super(message); } }
export async function resolveExplicitTarget(token: string, port: number | null, source: TargetSnapshotSource): Promise<ResolvedTarget> {
  const endpoints = (port === null ? await source.discoverEndpoints() : [{ host: '127.0.0.1' as const, port }]).slice().sort((a, b) => a.port - b.port);
  const rows = (await Promise.all(endpoints.map(async endpoint => (await source.list(endpoint)).filter(row => row.endpoint.host === '127.0.0.1' && row.endpoint.port === endpoint.port && row.type === 'page' && row.attachable && typeof row.websocketUrl === 'string' && /^wss?:\/\//.test(row.websocketUrl))))).flat();
  const choose = (candidates: readonly EndpointTarget[]): ResolvedTarget => { if (candidates.length !== 1) throw new TargetResolutionError('target_unavailable', `target ${JSON.stringify(token)} has ${candidates.length} endpoint-qualified page candidates`); const row = candidates[0]; return { identity: { host: '127.0.0.1', port: row.endpoint.port, fullTargetId: row.fullTargetId }, observedUrl: row.url, websocketUrl: row.websocketUrl! }; };
  const exact = rows.filter(row => row.fullTargetId === token); if (exact.length) return choose(exact);
  if (token.length < 4) throw new TargetResolutionError('target_unavailable', 'target prefixes require at least four characters');
  return choose(rows.filter(row => row.fullTargetId.startsWith(token)));
}
export function targetLockKey(identity: TargetIdentity): string { return crypto.createHash('sha256').update(`127.0.0.1\0${identity.port}\0${identity.fullTargetId}`).digest('hex'); }
