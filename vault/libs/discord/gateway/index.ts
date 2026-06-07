// Gateway client: in-page primitives for sending Op codes to Discord's existing
// gateway WebSocket and reading responses via Discord's internal Flux dispatcher.
//
// This module never opens its own WebSocket. It captures a reference to the one
// Discord's bundle already opened, sends frames through it, and observes the
// already-decompressed dispatch actions via the Flux bus that Discord's bundle
// also exposes. That avoids the zlib-stream decompression problem entirely.
//
// Lifecycle:
//   1. installSendHook() runs once. It patches WebSocket.prototype.send so the
//      already-open gateway WS reveals itself on its next outgoing frame
//      (heartbeat fires ~every 40s). This works for the in-page paste case,
//      where Discord's bundle constructed the socket before our hook ran.
//   2. getGatewayWs() polls for the captured reference.
//   3. getFluxDispatcher() walks webpack to find Discord's Flux dispatcher; we
//      identify it by the `flushWaitQueue` method, which is FluxDispatcher-
//      exclusive in current Discord builds.
//   4. gatewaySend(payload) writes a JSON frame.
//   5. gatewayAwait(actionType, predicate, timeoutMs) subscribes, waits for the
//      first matching dispatch, unsubscribes, and resolves.

declare global {
  interface Window {
    __nlDiscordWs?: WebSocket;
    __nlDiscordWsHookInstalled?: boolean;
    __nlDiscordFlux?: FluxDispatcherLike;
  }
}

export interface FluxDispatcherLike {
  dispatch: (action: unknown) => void;
  subscribe: (actionType: string, handler: (action: unknown) => void) => void;
  unsubscribe: (actionType: string, handler: (action: unknown) => void) => void;
  flushWaitQueue: (...args: unknown[]) => unknown;
}

const GATEWAY_HOST = 'gateway.discord.gg';

/**
 * Patch `WebSocket.prototype.send` so any gateway-URL socket stashes itself
 * into `window.__nlDiscordWs` on its next outgoing frame. Idempotent across
 * re-runs.
 *
 * A constructor proxy can't capture the existing socket because Discord's
 * bundle constructed it before this code runs. Patching `send` works because
 * the gateway's heartbeat fires every ~40s, so the live socket reveals
 * itself shortly after install on any page.
 *
 * Returns true if the hook was installed this call, false if it was already
 * present.
 */
export function installSendHook(): boolean {
  if (window.__nlDiscordWsHookInstalled) return false;
  const origSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (
    this: WebSocket,
    data: Parameters<WebSocket['send']>[0],
  ) {
    if (typeof this.url === 'string' && this.url.includes(GATEWAY_HOST)) {
      window.__nlDiscordWs = this;
    }
    return origSend.call(this, data);
  };
  window.__nlDiscordWsHookInstalled = true;
  return true;
}

/**
 * Wait for the gateway WebSocket reference to be captured, return it.
 * Throws on timeout. Default is 60s because gateway heartbeats fire roughly
 * every 41s — capture latency is bounded by that interval on a quiet client.
 */
export async function getGatewayWs(timeoutMs = 60_000): Promise<WebSocket> {
  const start = Date.now();
  while (true) {
    const ws = window.__nlDiscordWs;
    if (ws && ws.readyState === WebSocket.OPEN) return ws;
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Gateway WebSocket not captured within ${timeoutMs}ms. ` +
          `Call getContext() first to install the send hook. Capture relies ` +
          `on the next outgoing frame (heartbeat ~every 41s) — if no frame ` +
          `was sent in this window, the page may have a broken connection.`,
      );
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

export interface WebpackRequire {
  c: Record<string, { exports?: unknown }>;
}

export function getWebpackRequire(): WebpackRequire | null {
  const chunk = (window as unknown as { webpackChunkdiscord_app?: unknown[] })
    .webpackChunkdiscord_app;
  if (!Array.isArray(chunk)) return null;
  let req: WebpackRequire | undefined;
  try {
    chunk.push([
      [Symbol('nl-discord-' + Math.random())],
      {},
      (r: WebpackRequire) => {
        req = r;
      },
    ]);
  } catch {
    return null;
  }
  return req?.c ? req : null;
}

export function* walkExports(
  wp: WebpackRequire,
): Generator<unknown, void, unknown> {
  const seen = new WeakSet<object>();
  const offer = (c: unknown) => {
    if (!c) return null;
    if (typeof c !== 'object' && typeof c !== 'function') return null;
    if (seen.has(c as object)) return null;
    seen.add(c as object);
    return c;
  };
  // Every property access on a webpack export can hit a `let`/`const` getter
  // that is still in its temporal-dead-zone, throwing
  // `Cannot access 'X' before initialization`. Wrap every read so a single
  // poisoned module doesn't kill the whole walk.
  for (const id in wp.c) {
    let exp: Record<string, unknown> | undefined;
    try {
      exp = wp.c[id]?.exports as Record<string, unknown> | undefined;
    } catch {
      continue;
    }
    if (!exp) continue;
    const direct = offer(exp);
    if (direct) yield direct;
    for (const alias of ['default', 'Z', 'ZP', 'A']) {
      let v: unknown;
      try {
        v = (exp as Record<string, unknown>)[alias];
      } catch {
        continue;
      }
      const w = offer(v);
      if (w) yield w;
    }
    if (typeof exp === 'object') {
      let keys: string[] = [];
      try {
        keys = Object.keys(exp);
      } catch {
        continue;
      }
      for (const k of keys) {
        if (k === 'default' || k === 'Z' || k === 'ZP' || k === 'A') continue;
        let v: unknown;
        try {
          v = exp[k];
        } catch {
          continue;
        }
        const w = offer(v);
        if (w) yield w;
      }
    }
  }
}

/**
 * Read a property without letting a TDZ getter abort the caller. Returns
 * `undefined` if the access throws.
 */
export function safeGet(obj: unknown, key: string): unknown {
  if (!obj || (typeof obj !== 'object' && typeof obj !== 'function'))
    return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * Find Discord's FluxDispatcher by walking the webpack module cache.
 *
 * Strategy A (primary): unique `flushWaitQueue` method alongside dispatch +
 * subscribe. This name is FluxDispatcher-exclusive in current builds.
 *
 * Strategy B (fallback): find any FluxStore (has `_dispatcher` + `getName`) and
 * pull the dispatcher off it. More stable across rewrites, but slower.
 *
 * Throws if neither strategy succeeds; the candidate set is logged for the next
 * maintainer to inspect.
 */
export function getFluxDispatcher(): FluxDispatcherLike {
  if (window.__nlDiscordFlux) return window.__nlDiscordFlux;

  const wp = getWebpackRequire();
  if (!wp)
    throw new Error(
      'Discord webpack module cache not accessible (window.webpackChunkdiscord_app missing or unrecognized)',
    );

  for (const c of walkExports(wp)) {
    const dispatch = safeGet(c, 'dispatch');
    const subscribe = safeGet(c, 'subscribe');
    const flushWaitQueue = safeGet(c, 'flushWaitQueue');
    if (
      typeof dispatch === 'function' &&
      typeof subscribe === 'function' &&
      typeof flushWaitQueue === 'function'
    ) {
      window.__nlDiscordFlux = c as FluxDispatcherLike;
      return window.__nlDiscordFlux;
    }
  }

  for (const c of walkExports(wp)) {
    const _dispatcher = safeGet(c, '_dispatcher');
    const getName = safeGet(c, 'getName');
    if (
      _dispatcher &&
      typeof getName === 'function' &&
      typeof safeGet(_dispatcher, 'dispatch') === 'function' &&
      typeof safeGet(_dispatcher, 'subscribe') === 'function'
    ) {
      window.__nlDiscordFlux = _dispatcher as FluxDispatcherLike;
      return window.__nlDiscordFlux;
    }
  }

  const candidates: Array<{ keys: string[]; hasFlushWaitQueue: boolean }> = [];
  for (const c of walkExports(wp)) {
    const dispatch = safeGet(c, 'dispatch');
    const subscribe = safeGet(c, 'subscribe');
    if (typeof dispatch === 'function' && typeof subscribe === 'function') {
      let keys: string[] = [];
      try {
        keys = Object.keys(c as object).slice(0, 12);
      } catch {
        // ignore
      }
      candidates.push({
        keys,
        hasFlushWaitQueue: typeof safeGet(c, 'flushWaitQueue') === 'function',
      });
    }
  }
  throw new Error(
    `FluxDispatcher not found. dispatch+subscribe candidates: ${JSON.stringify(candidates).slice(0, 800)}`,
  );
}

/**
 * Poll `getFluxDispatcher` until it succeeds or timeoutMs elapses. The
 * dispatcher module loads lazily on cold tabs; the synchronous version throws
 * when called before the module shows up in the webpack cache.
 */
export async function awaitFluxDispatcher(
  timeoutMs = 10_000,
): Promise<FluxDispatcherLike> {
  const start = Date.now();
  let lastErr: unknown;
  while (true) {
    try {
      return getFluxDispatcher();
    } catch (e) {
      lastErr = e;
    }
    if (Date.now() - start > timeoutMs) {
      throw lastErr instanceof Error
        ? lastErr
        : new Error(`awaitFluxDispatcher timeout after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

interface ChannelStoreLike {
  getMutableGuildChannelsForGuild: (
    guildId: string,
  ) => Record<string, { id: string; type: number; name?: string }>;
}

/**
 * Find Discord's ChannelStore. Used to default a channelId when callers omit it
 * from listGuildMembers (Op 14 requires a channel anchor for permission-aware
 * member visibility).
 */
export function getChannelStore(): ChannelStoreLike {
  const wp = getWebpackRequire();
  if (!wp) throw new Error('webpack not accessible');
  for (const c of walkExports(wp)) {
    const getChannel = safeGet(c, 'getChannel');
    const getMutableGuildChannelsForGuild = safeGet(
      c,
      'getMutableGuildChannelsForGuild',
    );
    const getName = safeGet(c, 'getName');
    if (
      typeof getChannel === 'function' &&
      typeof getMutableGuildChannelsForGuild === 'function' &&
      typeof getName === 'function'
    ) {
      try {
        if ((getName as () => unknown).call(c) === 'ChannelStore') {
          return c as ChannelStoreLike;
        }
      } catch {
        // getName threw; skip
      }
    }
  }
  throw new Error('ChannelStore not found in webpack module cache');
}

/**
 * Poll `getChannelStore` until it succeeds or timeoutMs elapses.
 */
export async function awaitChannelStore(
  timeoutMs = 10_000,
): Promise<ChannelStoreLike> {
  const start = Date.now();
  let lastErr: unknown;
  while (true) {
    try {
      return getChannelStore();
    } catch (e) {
      lastErr = e;
    }
    if (Date.now() - start > timeoutMs) {
      throw lastErr instanceof Error
        ? lastErr
        : new Error(`awaitChannelStore timeout after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

interface RestApiLike {
  get: (opts: { url: string }) => Promise<unknown>;
  post: (opts: { url: string; body?: unknown }) => Promise<unknown>;
  put: (opts: { url: string; body?: unknown }) => Promise<unknown>;
  patch: (opts: { url: string; body?: unknown }) => Promise<unknown>;
  del: (opts: { url: string }) => Promise<unknown>;
}

/**
 * Find Discord's internal REST API client. Identified by the conjunction of
 * `get`, `post`, `put`, `patch`, and `del` method names on a single export —
 * Discord uses `del` (not `delete`) to dodge the reserved-word collision,
 * which makes this shape uniquely theirs in the bundle.
 *
 * Used by getContext on desktop to actively poke Discord's bundle into firing
 * an authenticated request through its own auth interceptor, so the installed
 * fetch/XHR hooks can observe the Authorization header.
 */
export function findRestApi(): RestApiLike | null {
  const wp = getWebpackRequire();
  if (!wp) return null;
  for (const c of walkExports(wp)) {
    const get = safeGet(c, 'get');
    const post = safeGet(c, 'post');
    const put = safeGet(c, 'put');
    const patch = safeGet(c, 'patch');
    const del = safeGet(c, 'del');
    if (
      typeof get === 'function' &&
      typeof post === 'function' &&
      typeof put === 'function' &&
      typeof patch === 'function' &&
      typeof del === 'function'
    ) {
      return c as RestApiLike;
    }
  }
  return null;
}

/**
 * Poll `findRestApi` until it succeeds or timeoutMs elapses. The REST module
 * loads lazily on cold tabs; first call after a fresh navigation may need a
 * brief wait before the export appears in the webpack cache.
 */
export async function awaitRestApi(
  timeoutMs = 5_000,
): Promise<RestApiLike | null> {
  const start = Date.now();
  while (true) {
    const api = findRestApi();
    if (api) return api;
    if (Date.now() - start > timeoutMs) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
}

interface GuildStoreLike {
  getGuild: (guildId: string) => unknown;
  getGuilds: () => Record<string, unknown>;
}

function findGuildStore(): GuildStoreLike | null {
  const wp = getWebpackRequire();
  if (!wp) return null;
  // `getGuild + getGuilds` alone matches multiple stores (EmojiStore,
  // StickerStore, etc.); first-wins picks the wrong one. Discriminate with
  // FluxStore.getName() which uniquely returns "GuildStore".
  for (const c of walkExports(wp)) {
    const getGuild = safeGet(c, 'getGuild');
    const getGuilds = safeGet(c, 'getGuilds');
    const getName = safeGet(c, 'getName');
    if (
      typeof getGuild === 'function' &&
      typeof getGuilds === 'function' &&
      typeof getName === 'function'
    ) {
      try {
        if ((getName as () => unknown).call(c) === 'GuildStore') {
          return c as GuildStoreLike;
        }
      } catch {
        // getName threw; skip
      }
    }
  }
  return null;
}

/**
 * Wait until Discord's gateway has finished its READY handshake for the given
 * guild. Op 14 / Op 8 frames silently no-op if sent before READY, so callers
 * must gate on this. Readiness is detected by polling GuildStore for the
 * target guildId — it only appears once READY has rehydrated client state.
 */
export async function awaitGuildReady(
  guildId: string,
  timeoutMs = 15_000,
): Promise<void> {
  const start = Date.now();
  while (true) {
    const store = findGuildStore();
    if (store) {
      try {
        if (store.getGuild(guildId)) return;
      } catch {
        // store not hydrated yet
      }
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Gateway did not become ready for guild ${guildId} within ${timeoutMs}ms. ` +
          `User may not be a member, or gateway READY handshake hasn't completed.`,
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Provoke Discord to emit a /api/v9/science POST so the fetch hook in helpers.ts
 * can capture the session-stable telemetry parameters (token,
 * client_heartbeat_session_id, launch_signature, etc.). Required by
 * createDMDesktop and any other function that depends on observed science
 * state.
 *
 * Background: a `window.location.href = ...` navigation wipes the in-page JS
 * context, including the installed fetch hook. The next `getContext()` call
 * reinstalls it, but Discord's React bundle has often already finished its
 * post-mount telemetry batch by then. Without organic user input (mouse,
 * keyboard, focus change) Discord may not fire another /api/v9/science POST
 * for ~30s — well past the createDMDesktop deadline. This function dispatches
 * Flux actions that Discord's analytics middleware reliably converts into a
 * science POST, so the hook has something to observe within ~1s.
 *
 * Best-effort: never throws. Returns true if the FluxDispatcher was located
 * and at least one provocation was dispatched; false if webpack isn't ready.
 */
export async function provokeScienceEmission(
  timeoutMs = 3000,
): Promise<boolean> {
  let flux: FluxDispatcherLike;
  try {
    flux = await awaitFluxDispatcher(timeoutMs);
  } catch {
    return false;
  }
  // The window-focus transition is the most reliable trigger across Discord
  // builds: PresenceStore + AnalyticsStore both subscribe and emit a heartbeat
  // batch on the focus edge. UNFOCUSED → FOCUS gives a clean edge even if
  // the renderer never lost OS focus from the user's perspective. Each
  // dispatch is wrapped because action-type names occasionally rename across
  // builds and one rename shouldn't kill the whole provoke sequence.
  try {
    flux.dispatch({ type: 'WINDOW_UNFOCUSED' });
  } catch {
    // best-effort
  }
  try {
    flux.dispatch({ type: 'WINDOW_FOCUS' });
  } catch {
    // best-effort
  }
  // Secondary: dispatch TRACK directly. The analytics middleware enqueues
  // these into the science batcher; a focus transition above flushes the
  // queue immediately. client_performance_marker is a benign always-emittable
  // event that won't appear in any user-facing log.
  try {
    flux.dispatch({
      type: 'TRACK',
      event: 'client_performance_marker',
      properties: {
        marker_name: 'app_native_marker_load',
        marker_value_ms: 0,
      },
    });
  } catch {
    // best-effort
  }
  return true;
}

interface TransitionFn {
  (path: string, ...rest: unknown[]): void;
}

/**
 * Walk webpack for Discord's NavigationUtils.transitionTo — the function the
 * sidebar click ultimately calls to switch channels. Identified by the
 * `transitionTo` + `replaceWith` + `back` triple, which is unique to Discord's
 * router-wrapper module in current builds.
 *
 * Returns null if not found; callers fall back to history.pushState + Flux
 * dispatch, which is less faithful (no React-router mount) but better than
 * nothing.
 */
function findTransitionTo(): TransitionFn | null {
  const wp = getWebpackRequire();
  if (!wp) return null;
  for (const c of walkExports(wp)) {
    const transitionTo = safeGet(c, 'transitionTo');
    const replaceWith = safeGet(c, 'replaceWith');
    const back = safeGet(c, 'back');
    if (
      typeof transitionTo === 'function' &&
      typeof replaceWith === 'function' &&
      typeof back === 'function'
    ) {
      return transitionTo as TransitionFn;
    }
  }
  return null;
}

/**
 * Navigate the Discord client to a guild channel via SPA routing. Mirrors a
 * sidebar click: history updates, React router mounts, Discord fires its full
 * channel-mount telemetry batch (channel_opened, guild_viewed, settings-proto/2
 * sync, entitlements GET, sticker bar GET). The fetch hook installed by
 * getContext() survives because no full-page reload occurs — exactly the
 * difference between this and `window.location.href = ...`, which wipes the
 * hook and causes Discord to fire the post-mount batch in a JS context that
 * has no hook installed yet, leaving the science state cold.
 *
 * Strategy (in priority order):
 *   1. Call Discord's `NavigationUtils.transitionTo` — the same function the
 *      sidebar invokes; most faithful, triggers the real React mount flow.
 *   2. Fall back to `history.pushState` + Flux `CHANNEL_SELECT` dispatch.
 *      The dispatch wakes Discord's Flux subscribers (analytics, channel
 *      store) so the mount telemetry still fires; the pushState updates the
 *      URL so `createDMDesktop`'s referer/location-stack precondition passes.
 *
 * Always use this from agent code instead of `window.location.href = ...`
 * before calling createDMDesktop. Best-effort: never throws on the navigation
 * itself, but does throw if FluxDispatcher can't be located (the session is
 * too broken to do anything meaningful).
 */
export interface SelectChannelInput {
  /**
   * Parent guild snowflake. Omit for DM channels — the path becomes
   * `/channels/@me/{channelId}` and the Flux CHANNEL_SELECT dispatch carries
   * `guildId: null`, matching what Discord's UI emits when the user clicks a
   * sidebar DM entry. Required for guild channels.
   */
  guildId?: string;
  channelId: string;
}

export async function selectChannel(
  params: SelectChannelInput,
): Promise<Record<string, never>> {
  const { guildId, channelId } = params;
  const path = guildId
    ? `/channels/${guildId}/${channelId}`
    : `/channels/@me/${channelId}`;

  // Strategy 1: Discord's own transitionTo — highest fidelity. Drives both
  // history update and React-router mount + telemetry in one call.
  const transitionTo = findTransitionTo();
  if (transitionTo) {
    try {
      transitionTo(path);
      // Small mount dwell so the caller can chain immediately. Discord's
      // post-mount science batch typically fires within 300-600ms of the
      // navigation; we wait conservatively.
      await new Promise((r) => setTimeout(r, 600));
      return {};
    } catch {
      // fall through to strategy 2
    }
  }

  // Strategy 2: history.pushState + Flux dispatch CHANNEL_SELECT. Less
  // faithful (Discord's router may or may not subscribe to popstate in
  // current builds) but at least the URL is correct and Discord's
  // analytics middleware will still emit a channel-mount science batch
  // in response to the Flux action.
  try {
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
      // Some Discord builds bind to popstate for router updates; fire it
      // so they pick up the URL change.
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  } catch {
    // best-effort
  }
  const flux = await awaitFluxDispatcher(5000);
  try {
    flux.dispatch({
      type: 'CHANNEL_SELECT',
      channelId,
      // DM channels carry guildId: null in Discord's own CHANNEL_SELECT
      // dispatches (sidebar DM click). Guild channels carry the parent
      // guildId.
      guildId: guildId ?? null,
      // `source` matches the HAR property the UI sends when the click
      // originates from a sidebar entry (vs. context menu, vs. keyboard).
      source: 'click',
    });
  } catch {
    // best-effort
  }
  await new Promise((r) => setTimeout(r, 600));
  return {};
}

/**
 * Send a JSON frame through the captured gateway WebSocket.
 */
export async function gatewaySend(payload: {
  op: number;
  d: unknown;
}): Promise<void> {
  const ws = await getGatewayWs();
  ws.send(JSON.stringify(payload));
}

/**
 * Subscribe to a Flux action type, resolve on the first dispatch matching the
 * predicate, then unsubscribe. Rejects on timeout.
 *
 * @param actionType  Dispatch action type (e.g., "GUILD_MEMBER_LIST_UPDATE")
 * @param predicate   Returns true when the action is the response we're waiting for
 * @param timeoutMs   Milliseconds before rejection
 */
export async function gatewayAwait<T = unknown>(
  actionType: string,
  predicate: (action: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const dispatcher = await awaitFluxDispatcher(timeoutMs);
  return new Promise<T>((resolve, reject) => {
    const handler = (action: T) => {
      try {
        if (!predicate(action)) return;
      } catch {
        return;
      }
      dispatcher.unsubscribe(actionType, handler);
      clearTimeout(timer);
      resolve(action);
    };
    const timer = setTimeout(() => {
      dispatcher.unsubscribe(actionType, handler);
      reject(
        new Error(`gatewayAwait(${actionType}) timeout after ${timeoutMs}ms`),
      );
    }, timeoutMs);
    dispatcher.subscribe(actionType, handler);
  });
}

/**
 * Send a frame and wait for a matching dispatch in one call. Subscribes BEFORE
 * sending to avoid races where the response arrives before the listener is
 * attached.
 */
export async function gatewayRequest<T = unknown>(
  payload: { op: number; d: unknown },
  responseType: string,
  predicate: (action: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const dispatcher = await awaitFluxDispatcher(timeoutMs);
  const ws = await getGatewayWs();

  return new Promise<T>((resolve, reject) => {
    const handler = (action: T) => {
      try {
        if (!predicate(action)) return;
      } catch {
        return;
      }
      dispatcher.unsubscribe(responseType, handler);
      clearTimeout(timer);
      resolve(action);
    };
    const timer = setTimeout(() => {
      dispatcher.unsubscribe(responseType, handler);
      reject(
        new Error(
          `gatewayRequest(${payload.op} → ${responseType}) timeout after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    dispatcher.subscribe(responseType, handler);
    try {
      ws.send(JSON.stringify(payload));
    } catch (e) {
      dispatcher.unsubscribe(responseType, handler);
      clearTimeout(timer);
      reject(e);
    }
  });
}
