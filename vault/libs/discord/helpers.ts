// Shared fetch helper for Discord v9 REST API.
// Runs in-page on discord.com — relative paths resolve against the page origin.

const API_BASE = '/api/v9';

// Session-stable headers Discord's own client adds to every API request.
// Replaying them on requests we issue (addFriend, greetChannel) avoids
// tripping the anti-abuse / captcha path that requires a full browser-shape
// request, not just X-Context-Properties.
const FINGERPRINT_HEADER_NAMES = [
  'x-super-properties',
  'x-installation-id',
  'x-discord-locale',
  'x-discord-timezone',
  'x-debug-options',
] as const;

export type FingerprintHeaderName = (typeof FINGERPRINT_HEADER_NAMES)[number];
export type FingerprintHeaders = Partial<Record<FingerprintHeaderName, string>>;

/**
 * Per-guild snapshot of the fields the UI's science events carry whenever the
 * user is viewing or interacting inside that guild. Captured from observed
 * /api/v9/science POSTs so we can replay them on our own events without making
 * Discord recompute them — and without leaving gaps that show up as a tell.
 */
export interface ScienceGuildContext {
  guild_size_total?: number;
  guild_num_channels?: number;
  guild_num_text_channels?: number;
  guild_num_voice_channels?: number;
  guild_num_roles?: number;
  guild_member_num_roles?: number;
  guild_member_perms?: string;
  guild_is_vip?: boolean;
  is_member?: boolean;
  num_voice_channels_active?: number;
}

/**
 * Per-channel snapshot. Same idea as ScienceGuildContext — the UI tags every
 * event with the channel context it's currently viewing.
 */
export interface ScienceChannelContext {
  channel_type?: number;
  channel_size_total?: number;
  channel_member_perms?: string;
  channel_hidden?: boolean;
}

/**
 * Stable per-session parameters observed on outgoing /api/v9/science POSTs.
 * Captured by installFetchHook so we can replay user_profile_action telemetry
 * events from our own API calls — without these, sendMessage/createDMFriend POSTs land
 * at Discord's anti-abuse pipeline with no preceding UI-action paper trail.
 */
export interface ScienceSessionState {
  token?: string;
  client_heartbeat_session_id?: string;
  launch_signature?: string;
  client_viewport_width?: number;
  client_viewport_height?: number;
  rendered_locale?: string;
  accessibility_features?: number;
  // Last-observed values (NOT captured-once) — Discord's UI updates these on
  // every event, so a frozen value across many replayed events is a tell.
  client_performance_memory?: number;
  client_performance_cpu?: number;
  // Hardware-derived, stable for the session.
  cpu_core_count?: number;
  // Last-observed uptime_app value with its capture timestamp; lets us
  // extrapolate the current uptime so replayed events show a plausible
  // monotonically-increasing value instead of resetting to 0.
  uptime_app_at?: number;
  uptime_app_observed_ms?: number;
  // Per-guild / per-channel context maps, keyed by snowflake. Populated from
  // any UI event whose properties carry guild_size_total / channel_type etc.
  // createDMDesktop reads these to build VIEW + SEND_DIRECT_MESSAGE event
  // bodies that match what the UI would have emitted for the same popout.
  guildContexts?: Record<string, ScienceGuildContext>;
  channelContexts?: Record<string, ScienceChannelContext>;
  // Highest event_sequence_number observed. New events fired by us increment
  // a local counter starting one past this so we don't collide with the UI.
  highest_sequence?: number;
}

declare global {
  interface Window {
    __nlDiscordFetchHookInstalled?: boolean;
    __nlDiscordXhrHookInstalled?: boolean;
    __nlDiscordHeaders?: FingerprintHeaders;
    __nlDiscordCapturedAuth?: string;
    __nlDiscordScience?: ScienceSessionState;
    __nlDiscordScienceLocalSeq?: number;
  }
}

// Module-scope cache so every function in the library can resolve the active
// token without the caller threading it through. Set by getContext() on
// success.
let activeToken: string | null = null;
let activeSurface: 'desktop' | 'browser' | null = null;

/**
 * Store the active session token. Called by getContext() after a successful
 * token-discovery cycle. Not part of the public API — agents should call
 * getContext() rather than setting the token directly.
 */
export function setActiveToken(token: string): void {
  activeToken = token;
}

/**
 * Return the cached Discord token. Throws if no token has been set yet —
 * callers MUST run getContext() before any other library function.
 */
export function getActiveToken(): string {
  if (activeToken) return activeToken;
  throw new Error(
    'No Discord session. Call getContext() before any other Discord function.',
  );
}

/**
 * Clear the in-memory token cache. Tests use this; production callers should
 * not need it — getContext() always overwrites the cache on a fresh call.
 */
export function resetActiveToken(): void {
  activeToken = null;
  activeSurface = null;
}

/**
 * Store the confirmed surface ('desktop' | 'browser'). Set by getContext()
 * after it cross-checks the agent-supplied surface against the actual
 * executor attachment. Surface-gated functions (e.g. createDMDesktop) read
 * this to refuse running on the wrong surface.
 */
export function setActiveSurface(surface: 'desktop' | 'browser'): void {
  activeSurface = surface;
}

/**
 * Return the cached surface. Throws if getContext() hasn't run yet — same
 * precondition as getActiveToken.
 */
export function getActiveSurface(): 'desktop' | 'browser' {
  if (activeSurface) return activeSurface;
  throw new Error(
    'No Discord session. Call getContext() before any other Discord function.',
  );
}

function readHeaderValue(
  headers: HeadersInit | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const lower = name.toLowerCase();
  if (Array.isArray(headers)) {
    const found = headers.find(([n]) => n.toLowerCase() === lower);
    return found?.[1];
  }
  const obj = headers as Record<string, string>;
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === lower) return obj[k];
  }
  return undefined;
}

// Field sets used by captureScienceState.
// CAPTURE_ONCE: values that don't change for the session — only the first
// observation matters, subsequent observations are ignored.
// CAPTURE_LATEST: values that drift over time (CPU%, memory) — every
// observation overwrites, so replayed events show a plausibly-current value.
const CAPTURE_ONCE_FIELDS = [
  'client_heartbeat_session_id',
  'launch_signature',
  'client_viewport_width',
  'client_viewport_height',
  'rendered_locale',
  'accessibility_features',
  'cpu_core_count',
] as const satisfies ReadonlyArray<keyof ScienceSessionState>;

const CAPTURE_LATEST_FIELDS = [
  'client_performance_memory',
  'client_performance_cpu',
] as const satisfies ReadonlyArray<keyof ScienceSessionState>;

const GUILD_CONTEXT_FIELDS = [
  'guild_size_total',
  'guild_num_channels',
  'guild_num_text_channels',
  'guild_num_voice_channels',
  'guild_num_roles',
  'guild_member_num_roles',
  'guild_member_perms',
  'guild_is_vip',
  'is_member',
  'num_voice_channels_active',
] as const satisfies ReadonlyArray<keyof ScienceGuildContext>;

const CHANNEL_CONTEXT_FIELDS = [
  'channel_type',
  'channel_size_total',
  'channel_member_perms',
  'channel_hidden',
] as const satisfies ReadonlyArray<keyof ScienceChannelContext>;

function captureScienceState(init?: RequestInit): void {
  // Discord's UI POSTs to /api/v9/science with a JSON body { token, events:[...] }.
  // We harvest stable session params plus per-guild / per-channel snapshots so
  // we can replay agent-initiated telemetry whose property bodies match what
  // the UI would have emitted from the same context.
  try {
    const body = init?.body;
    if (typeof body !== 'string') return;
    const parsed = JSON.parse(body) as {
      token?: string;
      events?: Array<{ properties?: Record<string, unknown> }>;
    };
    if (!parsed || typeof parsed !== 'object') return;
    const state: ScienceSessionState = window.__nlDiscordScience ?? {};
    if (parsed.token && state.token !== parsed.token)
      state.token = parsed.token;
    const events = Array.isArray(parsed.events) ? parsed.events : [];
    for (const ev of events) {
      const p = ev?.properties;
      if (!p) continue;
      const seq = p['event_sequence_number'];
      if (
        typeof seq === 'number' &&
        (!state.highest_sequence || seq > state.highest_sequence)
      ) {
        state.highest_sequence = seq;
      }
      ingestObservedClientUuid(p['client_uuid'], seq);
      for (const f of CAPTURE_ONCE_FIELDS) {
        const v = p[f];
        if (v !== undefined && state[f] === undefined) {
          (state as Record<string, unknown>)[f] = v;
        }
      }
      for (const f of CAPTURE_LATEST_FIELDS) {
        const v = p[f];
        if (v !== undefined) {
          (state as Record<string, unknown>)[f] = v;
        }
      }
      if (typeof p['uptime_app'] === 'number') {
        state.uptime_app_observed_ms = p['uptime_app'] * 1000;
        state.uptime_app_at = Date.now();
      }
      const guildId = p['guild_id'];
      if (typeof guildId === 'string' && p['guild_size_total'] !== undefined) {
        const map = state.guildContexts ?? {};
        const ctx: ScienceGuildContext = map[guildId] ?? {};
        for (const f of GUILD_CONTEXT_FIELDS) {
          const v = p[f];
          if (v !== undefined) {
            (ctx as Record<string, unknown>)[f] = v;
          }
        }
        map[guildId] = ctx;
        state.guildContexts = map;
      }
      const channelId = p['channel_id'];
      if (typeof channelId === 'string' && p['channel_type'] !== undefined) {
        const map = state.channelContexts ?? {};
        const ctx: ScienceChannelContext = map[channelId] ?? {};
        for (const f of CHANNEL_CONTEXT_FIELDS) {
          const v = p[f];
          if (v !== undefined) {
            (ctx as Record<string, unknown>)[f] = v;
          }
        }
        map[channelId] = ctx;
        state.channelContexts = map;
      }
    }
    window.__nlDiscordScience = state;
  } catch {
    // body wasn't JSON, or fields shifted — silently skip
  }
}

/**
 * Patch window.fetch so requests Discord's own client sends to /api/v9/* leak
 * their fingerprint headers (X-Super-Properties etc.) into a window-scoped
 * cache. Idempotent across re-runs.
 */
export function installFetchHook(): boolean {
  if (window.__nlDiscordFetchHookInstalled) return false;
  const origFetch = window.fetch;
  window.fetch = function (
    this: typeof window,
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    try {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      if (url && url.includes('/api/v9/')) {
        const sources: (HeadersInit | undefined)[] = [];
        if (init?.headers) sources.push(init.headers);
        if (typeof input !== 'string' && !(input instanceof URL)) {
          sources.push((input as Request).headers);
        }
        const captured = window.__nlDiscordHeaders ?? {};
        let updated = false;
        for (const name of FINGERPRINT_HEADER_NAMES) {
          for (const src of sources) {
            const v = readHeaderValue(src, name);
            if (v && captured[name] !== v) {
              captured[name] = v;
              updated = true;
              break;
            }
          }
        }
        if (updated) window.__nlDiscordHeaders = captured;
        // Also capture Authorization — needed on desktop where localStorage is
        // wiped and the token is closure-captured in webpack scope.
        if (!window.__nlDiscordCapturedAuth) {
          for (const src of sources) {
            const a = readHeaderValue(src, 'authorization');
            if (a && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(a)) {
              window.__nlDiscordCapturedAuth = a;
              break;
            }
          }
        }
        if (url.includes('/api/v9/science')) {
          captureScienceState(init);
        }
      }
    } catch {
      // never let our hook break the original fetch
    }
    return origFetch.call(this, input as RequestInfo, init);
  };
  window.__nlDiscordFetchHookInstalled = true;
  return true;
}

/**
 * Patch XMLHttpRequest.setRequestHeader so /api/v9 calls Discord makes via XHR
 * (rather than fetch) also leak their Authorization header into the same
 * window-scoped cache. Idempotent. Used by the desktop tier-4 token path —
 * Discord desktop's renderer has no localStorage and closure-captures the
 * token in webpack, so the only way to learn it is to observe an outgoing call.
 */
export function installXhrHook(): boolean {
  if (window.__nlDiscordXhrHookInstalled) return false;
  const XHRProto = XMLHttpRequest.prototype;
  const origOpen = XHRProto.open;
  const origSetHeader = XHRProto.setRequestHeader;
  XHRProto.open = function (
    this: XMLHttpRequest & { __nlUrl?: string },
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    this.__nlUrl = typeof url === 'string' ? url : url.href;
    return (origOpen as (...a: unknown[]) => void).call(
      this,
      method,
      url,
      ...rest,
    );
  };
  XHRProto.setRequestHeader = function (
    this: XMLHttpRequest & { __nlUrl?: string },
    name: string,
    value: string,
  ) {
    try {
      const url = this.__nlUrl ?? '';
      if (
        url.includes('/api/v9/') &&
        name?.toLowerCase() === 'authorization' &&
        !window.__nlDiscordCapturedAuth &&
        /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value)
      ) {
        window.__nlDiscordCapturedAuth = value;
      }
    } catch {
      // never break the original
    }
    return origSetHeader.call(this, name, value);
  };
  window.__nlDiscordXhrHookInstalled = true;
  return true;
}

/**
 * Wait until an Authorization header has been observed on any outgoing
 * /api/v9/* request (via the fetch or XHR hook). Used on Discord desktop
 * where every other token-discovery path is blocked.
 */
export async function awaitCapturedAuthorization(
  timeoutMs = 10000,
): Promise<string | null> {
  const start = Date.now();
  while (true) {
    if (window.__nlDiscordCapturedAuth) return window.__nlDiscordCapturedAuth;
    if (Date.now() - start > timeoutMs) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Wait until x-super-properties + x-installation-id are both captured, or the
 * timeout elapses. Returns whatever was captured (possibly empty).
 *
 * Discord's client makes /api/v9/* requests continuously (presence, science
 * telemetry, channel acks); on a healthy session the wait usually resolves
 * in well under a second. Returns immediately on subsequent calls.
 */
export async function awaitCapturedFingerprint(
  timeoutMs = 5000,
): Promise<FingerprintHeaders> {
  const start = Date.now();
  while (true) {
    const h = window.__nlDiscordHeaders;
    if (h && h['x-super-properties'] && h['x-installation-id']) return h;
    if (Date.now() - start > timeoutMs) return h ?? {};
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Wait until a science token has been observed on an outgoing /api/v9/science
 * POST (via the fetch hook). Used to gate telemetry replay until we have a
 * usable session token. Returns the captured state or undefined on timeout.
 */
export async function awaitCapturedScience(
  timeoutMs = 5000,
): Promise<ScienceSessionState | undefined> {
  const start = Date.now();
  while (true) {
    const s = window.__nlDiscordScience;
    if (s && s.token && s.client_heartbeat_session_id) return s;
    if (Date.now() - start > timeoutMs) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
}

// --- client_uuid ---
//
// Each /api/v9/science event the UI emits carries a client_uuid. The encoding
// is base64 of 24 raw bytes (32 base64 chars, no padding). Within a single
// session the first 18 bytes are a stable random prefix; byte 20 is an event
// counter that monotonically increments by 1 for every event the UI emits
// (regardless of type), wrapping at 256. Bytes 18, 19, 21, 22, 23 are
// session-stable (zero in observed sessions, but we preserve whatever bytes
// the UI used so we don't introduce a fingerprint contradiction).
//
// A random 18-byte payload (the previous implementation) is wrong on two
// axes: prefix bytes change per event, and the counter byte is unrelated to
// the event_sequence_number. Both are checkable against a single session.
//
// Strategy: harvest the first observed client_uuid + its event_sequence_number
// to learn the prefix bytes and the counter offset (= observed_byte20 -
// observed_sequence). For each replayed event with sequence S, produce
// prefix + byte20=(S + offset) & 0xff. Falls back to random if we never
// observed a UI emission.

let capturedUuidBytes: Uint8Array | null = null;
let uuidCounterOffset: number | null = null;

function decodeBase64ToBytes(s: string): Uint8Array | null {
  try {
    const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=+$/, '');
}

function ingestObservedClientUuid(uuid: unknown, sequence: unknown): void {
  if (capturedUuidBytes) return;
  if (typeof uuid !== 'string' || typeof sequence !== 'number') return;
  const bytes = decodeBase64ToBytes(uuid);
  if (!bytes || bytes.length !== 24) return;
  capturedUuidBytes = bytes;
  uuidCounterOffset = bytes[20] - sequence;
}

function generateClientUuid(sequence?: number): string {
  if (
    capturedUuidBytes &&
    uuidCounterOffset !== null &&
    sequence !== undefined
  ) {
    const bytes = capturedUuidBytes.slice();
    bytes[20] = (sequence + uuidCounterOffset) & 0xff;
    return encodeBytesToBase64(bytes);
  }
  // Fallback: 18 random bytes, base64-encoded. Matches the legacy shape and
  // gets used when no science event has been observed (cold start).
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return encodeBytesToBase64(bytes);
}

/**
 * RFC-4122 v4 UUID. Discord's `profile_session_id` (correlating VIEW with
 * SEND_DIRECT_MESSAGE on the same popout) is a standard UUIDv4.
 * crypto.randomUUID() exists in modern Chromium / Electron renderers; we
 * still provide a manual fallback for older runtimes.
 */
export function generateUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}

/**
 * Sleep with optional uniform jitter. `sleep(3000, 500)` waits 2500–3500ms.
 * Used to mirror human dwell time between sequential UI fetches that get
 * fingerprinted as bot-like when they fire back-to-back.
 */
export function sleep(meanMs: number, jitterMs = 0): Promise<void> {
  const delta = jitterMs > 0 ? (Math.random() * 2 - 1) * jitterMs : 0;
  const ms = Math.max(0, Math.round(meanMs + delta));
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Build the value for the X-Context-Properties header: base64(JSON({location})).
 * Mirrors Discord's UI signal for "where in the UI did this action originate"
 * — anti-abuse checks the presence and shape of this header on relationship /
 * messaging / friend endpoints.
 */
export function contextProperties(location: string): string {
  return btoa(JSON.stringify({ location }));
}

/**
 * Build the merged property body for a single replayed science event,
 * applying captured session state and per-guild / per-channel snapshots so
 * the body matches what Discord's UI would have emitted from the same
 * context. `sequenceOffset` lets a batch caller emit N events with
 * monotonically-increasing event_sequence_number values without colliding.
 */
function buildScienceEventProperties(
  state: ScienceSessionState,
  properties: Record<string, unknown>,
  sequenceOffset: number,
): Record<string, unknown> {
  const localSeq = (window.__nlDiscordScienceLocalSeq ?? 0) + sequenceOffset;
  const sequence = (state.highest_sequence ?? 0) + localSeq;
  const now = Date.now();
  // Extrapolate current uptime: use captured base + wall-clock delta since the
  // last observation. Falls back to performance.now() if we never saw one.
  let uptimeAppSec: number;
  if (state.uptime_app_observed_ms !== undefined && state.uptime_app_at) {
    uptimeAppSec = Math.floor(
      (state.uptime_app_observed_ms + (Date.now() - state.uptime_app_at)) /
        1000,
    );
  } else {
    uptimeAppSec = Math.floor(performance.now() / 1000);
  }
  // uptime_process_renderer is consistently 0-1s past uptime_app in HAR.
  const uptimeRendererSec = uptimeAppSec + 1;
  // Apply guild / channel context if the caller's properties reference one.
  const guildId = properties['guild_id'];
  const channelId = properties['channel_id'];
  const guildCtx =
    typeof guildId === 'string' ? (state.guildContexts?.[guildId] ?? {}) : {};
  const channelCtx =
    typeof channelId === 'string'
      ? (state.channelContexts?.[channelId] ?? {})
      : {};
  return {
    client_track_timestamp: now,
    client_heartbeat_session_id: state.client_heartbeat_session_id,
    event_sequence_number: sequence,
    // Guild / channel context spread BEFORE the caller's properties so caller
    // overrides win — e.g. dm_list_viewed wants channel_type:1 for the DM,
    // not the channel context the agent was viewing.
    ...guildCtx,
    ...channelCtx,
    client_performance_cpu: state.client_performance_cpu ?? 0,
    client_performance_memory: state.client_performance_memory ?? 0,
    cpu_core_count: state.cpu_core_count ?? 0,
    accessibility_features: state.accessibility_features ?? 0,
    rendered_locale: state.rendered_locale ?? 'en-US',
    uptime_app: uptimeAppSec,
    uptime_process_renderer: uptimeRendererSec,
    launch_signature: state.launch_signature,
    client_rtc_state: 'DISCONNECTED',
    client_app_state: 'focused',
    client_viewport_width: state.client_viewport_width ?? window.innerWidth,
    client_viewport_height: state.client_viewport_height ?? window.innerHeight,
    client_uuid: generateClientUuid(sequence),
    client_send_timestamp: now,
    ...properties,
  };
}

/**
 * Fire a /api/v9/science telemetry event using captured session params.
 * No-op if the science hook hasn't observed a real Discord science POST yet
 * (cold start) — never throws, never blocks, fire-and-forget.
 *
 * The Discord client emits these events at every UI interaction; replaying
 * them for agent-initiated actions keeps the server-side telemetry trail
 * coherent (a message POST with no preceding user_profile_action SEND_MESSAGE
 * is a strong bot signal).
 */
export async function scienceTrack(
  eventType: string,
  properties: Record<string, unknown>,
): Promise<void> {
  return scienceTrackBatch([{ type: eventType, properties }]);
}

/**
 * Fire one /api/v9/science POST carrying multiple events. Discord batches
 * events that fire in the same tick (e.g., channel_opened + dm_list_viewed
 * + dismissible_content_* all leave together when a new DM channel mounts).
 * Replaying them as separate POSTs is a shape mismatch the classifier sees.
 */
export async function scienceTrackBatch(
  events: Array<{ type: string; properties: Record<string, unknown> }>,
): Promise<void> {
  try {
    const state = window.__nlDiscordScience;
    if (!state?.token || !state.client_heartbeat_session_id) return;
    if (!events.length) return;
    const startingSeq = window.__nlDiscordScienceLocalSeq ?? 0;
    window.__nlDiscordScienceLocalSeq = startingSeq + events.length;
    const built = events.map((ev, i) => ({
      type: ev.type,
      properties: buildScienceEventProperties(state, ev.properties, i + 1),
    }));
    const body = JSON.stringify({ token: state.token, events: built });
    // fire-and-forget; the original fetch (not patched response) is fine here.
    await fetch('/api/v9/science', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(window.__nlDiscordHeaders ?? {}),
      },
      body,
    }).catch((): undefined => {
      // best-effort telemetry; failures must never propagate to the caller
      return undefined;
    });
  } catch {
    // never propagate telemetry failures into the calling function
  }
}

export interface DiscordFetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /**
   * HTTP status codes to treat as success (parse and return body instead of throwing).
   * Use for endpoints where the "error" response carries meaningful data
   * (e.g., referrals/eligibility returns 404 with `{code, message}` for non-eligible users).
   */
  tolerateStatuses?: number[];
}

// ============================================================================
// DOM flow isolation invariant
//
// `createDMDesktopDOM` and `sendMessageDesktopDOM` exist because REST POSTs
// to non-friend DM endpoints (channels POST, messages POST) reliably get
// accounts suspended for bot activity — including, as of 2026-05-18, sends
// to non-friend DMs with prior message history. The DOM functions sidestep
// this by simulating real DOM events so Discord's React handlers emit the
// API calls; the messages POST that hits Discord's servers has the same
// shape and provenance as one a real human keypress would produce.
//
// For that guarantee to hold, the DOM functions must NEVER emit a non-GET
// /api/v9/* request from our code during their execution. A REST send (or
// any other state-changing call) issued from inside a DOM flow would land
// alongside Discord's own bundle-emitted POST, with no surrounding telemetry
// to wrap it, producing exactly the orphan-channels-POST + delayed-API-send
// pattern the DOM path was built to avoid.
//
// `DOM_FLOW_DEPTH` is the runtime guard. The DOM functions wrap their bodies
// in `withDomFlow`, incrementing the counter on entry and decrementing on
// exit (including failure). `discordFetch` checks the counter at the top:
// any non-GET request while the counter is > 0 throws immediately with a
// diagnostic, refusing to silently emit the very pattern the DOM path
// exists to prevent. GET reads are allowed — the DOM functions legitimately
// use `listRelationships`, `/users/@me/channels`, and `listMessages` for
// precondition checks, none of which are state-changing.
//
// This is defense-in-depth: today's DOM functions don't call any non-GET
// REST endpoint, but a future maintainer adding a "retry sendMessage if the
// DOM dispatch fails" branch would silently regress the suspension story.
// The throw makes that regression load-bearing visible.
// ============================================================================
let DOM_FLOW_DEPTH = 0;

export async function withDomFlow<T>(fn: () => Promise<T>): Promise<T> {
  DOM_FLOW_DEPTH++;
  try {
    return await fn();
  } finally {
    DOM_FLOW_DEPTH--;
  }
}

export function isInDomFlow(): boolean {
  return DOM_FLOW_DEPTH > 0;
}

export async function discordFetch<T>(
  token: string | undefined,
  path: string,
  options: DiscordFetchOptions = {},
): Promise<T> {
  // Refuse any non-GET REST request while a DOM-driven send flow is in
  // progress. See the DOM_FLOW_DEPTH block above for why this matters.
  // `method` defaults to GET when unset (the fetch spec default); only
  // explicit non-GET methods trip this guard.
  if (DOM_FLOW_DEPTH > 0) {
    const method = (options.method ?? 'GET').toUpperCase();
    if (method !== 'GET') {
      throw new Error(
        `Refusing ${method} ${path} during a DOM-driven send flow. The DOM functions (createDMDesktopDOM, sendMessageDesktopDOM) must NOT emit any /api/v9/* request from our code — Discord's own React handlers emit them in response to simulated DOM events, which is the whole point of the DOM path. A non-GET call from inside a DOM flow produces the orphan-channels-POST + delayed-API-send pattern that gets accounts suspended for bot activity. This is the exact pattern the DOM path exists to avoid. If you're hitting this throw: do NOT remove this guard. Investigate why a non-GET REST call is being made inside the DOM flow and fix the calling code to use the DOM-driven path (paste + Enter via the existing helpers) for state changes, or to do this work OUTSIDE the DOM flow.`,
      );
    }
  }

  const authToken = token ?? getActiveToken();
  const { body, headers, tolerateStatuses, ...rest } = options;
  const url = path.startsWith('http')
    ? path
    : `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

  // Mirror Discord's UI: every /api/v9/* request the real client makes carries
  // the full fingerprint header set (x-super-properties, x-installation-id,
  // x-discord-locale, x-discord-timezone, x-debug-options). Auto-inject from
  // the captured cache so callers don't have to spread them per-call; explicit
  // headers passed in `options.headers` still win.
  const captured =
    typeof window !== 'undefined' && window.__nlDiscordHeaders
      ? window.__nlDiscordHeaders
      : {};
  // Only declare Content-Type when we actually send a body. Discord rejects
  // GETs that carry `Content-Type: application/json` with no body on some
  // endpoints (e.g. /users/@me/relationships → 400 code 50109 "invalid JSON"),
  // because the header asserts a JSON-body shape the request doesn't satisfy.
  const hasBody = body !== undefined;
  const response = await fetch(url, {
    ...rest,
    credentials: 'include',
    headers: {
      Authorization: authToken,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...captured,
      ...headers,
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });

  if (response.status === 429) {
    const text = await response.text();
    let retryAfter: number | undefined;
    try {
      retryAfter = JSON.parse(text)?.retry_after;
    } catch {
      // ignore
    }
    throw new Error(
      `Discord rate-limited (429). retry_after=${retryAfter ?? 'unknown'}s. URL: ${url}`,
    );
  }

  const tolerated = !response.ok && tolerateStatuses?.includes(response.status);

  if (!response.ok && !tolerated) {
    const errBody = await response.text();
    const truncated =
      errBody.length > 1500
        ? errBody.slice(0, 1500) + '… [truncated]'
        : errBody;
    throw new Error(`Discord API ${response.status} on ${url}: ${truncated}`);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    const truncated =
      text.length > 1500 ? text.slice(0, 1500) + '… [truncated]' : text;
    throw new Error(`Discord returned non-JSON on ${url}: ${truncated}`);
  }
}

/**
 * Generate a Discord-style snowflake-ish nonce.
 * Doesn't have to be a real snowflake — just a unique-enough client-side dedupe key.
 */
export function generateNonce(): string {
  const ms = Date.now() - 1420070400000; // Discord epoch
  const rand = Math.floor(Math.random() * 4096);
  return ((BigInt(ms) << 22n) | BigInt(rand)).toString();
}

/**
 * Build a query string from a record, omitting undefined values.
 * Arrays become repeated params (Discord convention: `?application_ids=A&application_ids=B`).
 */
export function buildQuery(
  params: Record<
    string,
    string | number | boolean | string[] | null | undefined
  >,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value)
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    } else {
      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      );
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}
