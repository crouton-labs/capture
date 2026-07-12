export type SnapStateName = 'hover' | 'focus' | 'active' | 'checked' | 'open' | 'disabled' | 'invalid';
export type SnapSelection =
  | { readonly kind: 'fresh-url'; readonly requestedUrl: string; readonly requestedPort: number | null; readonly navigationTimeoutMs: number }
  | { readonly kind: 'named-session'; readonly sessionId: string }
  | { readonly kind: 'explicit-target'; readonly targetToken: string; readonly requestedPort: number | null }
  | { readonly kind: 'active-session'; readonly scopeKey: string };
export interface SnapAcquisitionRequest { readonly selection: SnapSelection; readonly settleTimeoutMs: number; readonly freezeAnimations: boolean; readonly captureUnsettled: boolean; readonly pixels: boolean; readonly states: readonly { readonly name: SnapStateName; readonly selector: string | null }[]; readonly viewport: { readonly width: number; readonly height: number } | null; }
export interface SnapInputErrorShape { readonly code: string; readonly field?: string; readonly received: unknown; readonly expected: string; readonly next_action: 'capture measure snap -h'; }
export class SnapInputError extends Error { constructor(readonly detail: SnapInputErrorShape) { super(detail.code); this.name = 'SnapInputError'; } }
const states: readonly SnapStateName[] = ['hover', 'focus', 'active', 'checked', 'open', 'disabled', 'invalid'];
const invalid = (code: string, received: unknown, expected: string, field?: string): never => { throw new SnapInputError({ code, field, received, expected, next_action: 'capture measure snap -h' }); };
const positive = (value: string, field: string, max: number): number => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max ? Number(value) : invalid('invalid_option', value, `integer 1..${max}`, field);
/** Raw, side-effect-free argv parser. Ambient CDP variables intentionally never participate. */
export function parseSnapRawArgv(argv: readonly string[], env: Readonly<NodeJS.ProcessEnv> = process.env): SnapAcquisitionRequest {
  const values = new Map<string, string[]>(); const positionals: string[] = []; const booleans = new Set<string>();
  const takes = new Set(['--session', '--target', '--port', '--navigation-timeout', '--settle-timeout', '--viewport', '--state']); const flags = new Set([...takes, '--pixels', '--freeze-animations', '--capture-unsettled']);
  for (let i = 0; i < argv.length; i++) { const token = argv[i]; if (!token.startsWith('--')) { positionals.push(token); continue; } if (!flags.has(token)) invalid('unknown_option', token, 'a measure snap option', token); if (takes.has(token)) { const value = argv[++i]; if (value === undefined || value.startsWith('--')) invalid('missing_option_value', token, `a value for ${token}`, token); const entries = values.get(token) ?? []; entries.push(value); values.set(token, entries); } else { if (booleans.has(token)) invalid('duplicate_option', token, 'one occurrence', token); booleans.add(token); } }
  for (const [name, found] of values) if (name !== '--state' && found.length > 1) invalid('duplicate_option', found[1], `one ${name}`, name);
  if (positionals.length > 1) invalid('unexpected_positional', positionals[1], 'at most one URL positional');
  const one = (name: string): string | undefined => values.get(name)?.[0]; const session = one('--session'); const target = one('--target'); const portText = one('--port'); const url = positionals[0];
  const port = portText === undefined ? null : positive(portText, '--port', 65535); const settleTimeoutMs = one('--settle-timeout') === undefined ? 1000 : positive(one('--settle-timeout')!, '--settle-timeout', 60000); const navigationTimeoutMs = one('--navigation-timeout') === undefined ? 10000 : positive(one('--navigation-timeout')!, '--navigation-timeout', 60000);
  let viewport: { width: number; height: number } | null = null; if (one('--viewport')) { const match = /^(\d+)x(\d+)$/.exec(one('--viewport')!); if (!match) invalid('invalid_option', one('--viewport')!, 'WIDTHxHEIGHT', '--viewport'); viewport = { width: positive(match[1], '--viewport', 100000), height: positive(match[2], '--viewport', 100000) }; }
  if (url && !/^https?:\/\//.test(url)) invalid('invalid_option', url, 'an absolute http: or https: URL', 'url');
  if ((url ? 1 : 0) + (session ? 1 : 0) + (target ? 1 : 0) > 1) invalid('snapshot_target_conflict', { url, session, target }, 'exactly one target selection');
  if (session && port !== null) invalid('port_conflicts_with_session', portText!, 'no --port with --session', '--port');
  if (!url && !target && port !== null) invalid('port_requires_url_or_target', portText!, '--port with URL or --target', '--port');
  if (one('--navigation-timeout') && !url) invalid('navigation_timeout_requires_fresh_url', one('--navigation-timeout')!, 'a fresh URL selection', '--navigation-timeout');
  const rawStates = values.get('--state') ?? []; const selected: { name: SnapStateName; selector: string | null }[] = [];
  for (const raw of rawStates) { const colon = raw.indexOf(':'); const name = (colon < 0 ? raw : raw.slice(0, colon)); const selector = colon < 0 ? null : raw.slice(colon + 1); if (name === 'all') { if (rawStates.length !== 1) invalid('snapshot_target_conflict', raw, '--state all alone', '--state'); for (const state of states) selected.push({ name: state, selector: null }); continue; } if (!(states as readonly string[]).includes(name) || selector === '') invalid('invalid_option', raw, 'STATE or STATE:SELECTOR', '--state'); selected.push({ name: name as SnapStateName, selector }); }
  if (new Set(selected.map(s => `${s.name}\0${s.selector ?? ''}`)).size !== selected.length) invalid('duplicate_option', rawStates, 'unique state selections', '--state');
  const selection: SnapSelection = url ? { kind: 'fresh-url', requestedUrl: url, requestedPort: port, navigationTimeoutMs } : session ? { kind: 'named-session', sessionId: session } : target ? { kind: 'explicit-target', targetToken: target, requestedPort: port } : { kind: 'active-session', scopeKey: env.CRTR_NODE_ID?.trim() || 'default' };
  return { selection, settleTimeoutMs, freezeAnimations: booleans.has('--freeze-animations'), captureUnsettled: booleans.has('--capture-unsettled'), pixels: booleans.has('--pixels'), states: selected, viewport };
}
