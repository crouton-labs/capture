import type {
  GetContextInput,
  GetContextOutput,
  GetSurfacePreferenceInput,
  GetSurfacePreferenceOutput,
  SetSurfacePreferenceInput,
  SetSurfacePreferenceOutput,
} from '../schemas';
import {
  awaitCapturedAuthorization,
  discordFetch,
  installFetchHook,
  installXhrHook,
} from '../helpers';
import {
  awaitRestApi,
  getWebpackRequire,
  installSendHook,
  safeGet,
  walkExports,
} from '../gateway';
import { setActiveToken, setActiveSurface } from '../helpers';

declare global {
  interface Window {
    DiscordNative?: unknown;
  }
}

const SESSION_KEY = '__nl_discord_session';
const SURFACE_PREFERENCE_KEY = '__nl_discord_surface_preference';

// Real Discord user tokens are three base64url segments joined by dots:
// `<userId-b64>.<timestamp-b64>.<hmac>`. Anything else (notably the decoy
// `dQw4w9WgXcQ:djEw…` that Discord plants in `localStorage.token` after
// detecting devtools/paste) is rejected.
const TOKEN_SHAPE_RE = /^[\w-]+\.[\w-]+\.[\w-]+$/;

// The active-token cache lives in helpers.ts so discordFetch can resolve it
// without a circular import. getContext() writes via setActiveToken() on
// success; discordFetch reads via getActiveToken() when the caller omits
// `token`. Persisted session lookup is a secondary fallback inside helpers.

/**
 * Inspect the runtime surface (desktop vs. browser) and read the user's saved
 * preference. Returns `preference: null` when the user has not yet been asked,
 * which the calling agent MUST treat as "ask the user before opening anything."
 *
 * Persistence is scoped to discord.com on the current browser profile, so it
 * survives across executor sessions there but not across browsers or devices.
 * The agent must also store the choice in its own workspace memory.
 */
export async function getSurfacePreference(
  _opts: GetSurfacePreferenceInput = {},
): Promise<GetSurfacePreferenceOutput> {
  const surface: 'desktop' | 'browser' =
    typeof window.DiscordNative !== 'undefined' ? 'desktop' : 'browser';
  let preference: 'desktop' | 'browser' | null = null;
  try {
    const v = window.localStorage?.getItem(SURFACE_PREFERENCE_KEY);
    if (v === 'desktop' || v === 'browser') preference = v;
  } catch {
    // Storage disabled — treat as no preference.
  }
  return { preference, surface };
}

/**
 * Persist the user-chosen surface at discord.com so subsequent agent sessions
 * on the same browser profile can read it back via getSurfacePreference().
 * Call this right after the user answers "desktop or browser?". The agent
 * MUST also write the same value to its own workspace memory.
 */
export async function setSurfacePreference(
  opts: SetSurfacePreferenceInput,
): Promise<SetSurfacePreferenceOutput> {
  try {
    window.localStorage?.setItem(SURFACE_PREFERENCE_KEY, opts.surface);
  } catch {
    // Storage may be quota-full or disabled; not fatal.
  }
  return { surface: opts.surface };
}

interface PersistedSession {
  token: string;
  userId: string;
  username: string;
  globalName: string | null;
  capturedAt: number;
}

/**
 * Read the user token from localStorage. Discord clears `localStorage.token`
 * in the top frame when it detects devtools/paste; an iframe's localStorage
 * is a separate handle and isn't cleared, so a hidden iframe is the fallback.
 *
 * Returns null if no value is found OR the value doesn't match a real
 * Discord token's three-segment shape. Discord plants a fixed decoy
 * (`dQw4w9WgXcQ:…`) in `localStorage.token` after anti-paste triggers;
 * the iframe path will happily return that decoy, so shape-validate before
 * returning to keep callers from short-circuiting on garbage.
 */
function readToken(): string | null {
  const accept = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof parsed !== 'string' || !TOKEN_SHAPE_RE.test(parsed)) return null;
    return parsed;
  };

  const direct = accept(window.localStorage?.getItem('token') ?? null);
  if (direct) return direct;

  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  document.body.appendChild(iframe);
  try {
    return accept(iframe.contentWindow?.localStorage?.getItem('token') ?? null);
  } finally {
    iframe.remove();
  }
}

/**
 * Decode the snowflake user ID from a Discord token's first segment.
 * Tokens look like `<base64url-userId>.<base64url-timestamp>.<hmac>`.
 * Returns null if the segment can't be decoded as a snowflake.
 */
function decodeUserIdFromToken(token: string): string | null {
  const first = token.split('.')[0];
  if (!first) return null;
  try {
    const b64 = first.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const decoded = atob(padded);
    if (/^\d{17,20}$/.test(decoded)) return decoded;
    return null;
  } catch {
    return null;
  }
}

/**
 * Walk Discord's webpack module cache for the in-memory auth store and read
 * the token directly. Used as a fallback when `localStorage.token` is empty —
 * Discord wipes it on devtools open and may not write it at all on hidden /
 * backgrounded tabs where module init is deferred. The auth store keeps the
 * token in module scope and exposes `getToken()`; that's the same path
 * Discord's own client uses.
 *
 * Identifies the store by a `getToken` function that returns a Discord-shaped
 * token (`base64.base64.hmac`).
 */
function readTokenFromWebpack(): string | null {
  const wp = getWebpackRequire();
  if (!wp) return null;
  for (const c of walkExports(wp)) {
    const getToken = safeGet(c, 'getToken');
    if (typeof getToken !== 'function') continue;
    let t: unknown;
    try {
      t = (getToken as () => unknown).call(c);
    } catch {
      continue;
    }
    if (typeof t === 'string' && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(t)) {
      return t;
    }
  }
  return null;
}

function readPersistedSession(): PersistedSession | null {
  try {
    const raw = window.localStorage?.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSession>;
    if (
      typeof parsed?.token === 'string' &&
      typeof parsed?.userId === 'string' &&
      /^\d{17,20}$/.test(parsed.userId) &&
      typeof parsed?.username === 'string'
    ) {
      return {
        token: parsed.token,
        userId: parsed.userId,
        username: parsed.username,
        globalName: parsed.globalName ?? null,
        capturedAt: parsed.capturedAt ?? Date.now(),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function persistSession(s: PersistedSession): void {
  try {
    window.localStorage?.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // Storage may be quota-full or disabled; not fatal.
  }
}

/**
 * Actively trigger an authenticated /api/v9 request from Discord's own bundle
 * so the installed fetch/XHR hooks can observe its Authorization header.
 *
 * Required on desktop: the renderer doesn't expose the token via localStorage
 * (anti-paste wipe) or via webpack auth-store exports (closure-captured), and
 * after the page finishes loading no fresh authenticated traffic fires on its
 * own — the gateway heartbeat is WS-only, not REST.
 *
 * Walks webpack for Discord's internal REST client and calls /users/@me
 * through it. The call passes through Discord's auth interceptor, which
 * attaches Authorization before sending; our installFetchHook reads the
 * header off the outgoing request. Fire-and-forget: the response value is
 * irrelevant, only that the request fires.
 */
async function pokeForAuthHeader(): Promise<void> {
  const api = await awaitRestApi(2000);
  if (!api) return;
  try {
    await api.get({ url: '/users/@me' });
  } catch {
    // Shape mismatch or HTTP error — the auth header is attached at request
    // build time, before any failure path; the hook captures from the
    // outgoing request, not the response.
  }
}

interface SelfIdentity {
  userId: string;
  username: string;
  globalName: string | null;
}

async function fetchSelfIdentity(token: string): Promise<SelfIdentity | null> {
  try {
    const me = await discordFetch<{
      id?: string;
      username?: string;
      global_name?: string | null;
    }>(token, '/users/@me');
    if (
      me?.id &&
      /^\d{17,20}$/.test(me.id) &&
      typeof me.username === 'string' &&
      me.username.length > 0
    ) {
      return {
        userId: me.id,
        username: me.username,
        globalName: me.global_name ?? null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function getContext(
  opts: GetContextInput,
): Promise<GetContextOutput> {
  // Surface is required. The library refuses to run without the agent having
  // explicitly resolved desktop vs browser — silent defaulting is what got
  // users frustrated. The agent must read workspace memory ("discordSurface")
  // or ask the user, then pass the answer here.
  if (!opts || (opts.surface !== 'desktop' && opts.surface !== 'browser')) {
    throw new Error(
      'getContext requires `surface: "desktop" | "browser"`. Read it from workspace memory under "discordSurface", or ask the user "Use the Discord desktop app, or a browser tab?" and save their answer before calling.',
    );
  }
  const timeoutMs = opts.timeoutMs ?? 10000;
  const startTime = Date.now();

  while (!window.location.hostname.includes('discord.com')) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error(
        `Not on Discord domain. Navigate to ${'https://discord.com/channels/@me'}. Current URL: ${window.location.href}`,
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Install the gateway WS send-hook so subsequent gateway-based functions
  // (listGuildMembers, searchGuildMembers) can capture the existing
  // gateway socket on its next outgoing frame (heartbeat ~every 41s).
  installSendHook();

  // Install the fetch hook so anti-abuse-sensitive endpoints (addFriend,
  // greetChannel) can replay the fingerprint headers Discord's own client
  // attaches to every API request. Also install the XHR hook so the desktop
  // tier-4 path can see Authorization on either transport.
  installFetchHook();
  installXhrHook();

  const isDesktop = typeof window.DiscordNative !== 'undefined';
  const actualSurface: 'desktop' | 'browser' = isDesktop
    ? 'desktop'
    : 'browser';

  // Cross-check the agent's claim against what the executor actually attached
  // to. If they disagree, the agent and the user will both end up confused;
  // fail loudly with remediation steps.
  if (opts.surface !== actualSurface) {
    throw new Error(
      `Surface mismatch: agent requested "${opts.surface}" but executor is attached to "${actualSurface}". ` +
        (actualSurface === 'browser'
          ? 'The Discord desktop app is not running or not reachable via attached mode. Either start the desktop app and retry, or update workspace memory `discordSurface` to "browser" and re-create the executor.'
          : 'The browser tab created an unexpected desktop attachment. Close the executor and recreate it explicitly with `createExecutor({ url: "https://discord.com/channels/@me" })` for browser, or update workspace memory `discordSurface` to "desktop".'),
    );
  }

  // Also persist the confirmed surface to discord.com localStorage as the
  // same-browser fallback. Workspace memory remains the canonical record.
  try {
    window.localStorage?.setItem(SURFACE_PREFERENCE_KEY, actualSurface);
  } catch {
    // Storage disabled — not fatal.
  }

  // Tier 1: persisted session, validated against /users/@me.
  const persisted = readPersistedSession();
  if (persisted) {
    const identity = await fetchSelfIdentity(persisted.token);
    if (identity && identity.userId === persisted.userId) {
      setActiveToken(persisted.token);
      setActiveSurface(actualSurface);
      persistSession({
        token: persisted.token,
        userId: identity.userId,
        username: identity.username,
        globalName: identity.globalName,
        capturedAt: Date.now(),
      });
      return {
        token: persisted.token,
        userId: identity.userId,
        username: identity.username,
        globalName: identity.globalName,
        surface: actualSurface,
      };
    }
  }

  // Tier 2 (web only): read token from localStorage. Iframe fallback if the
  // top-frame value is wiped by Discord's anti-paste protection. Skipped on
  // desktop entirely — the desktop renderer has no top-frame localStorage,
  // and the iframe path returns Discord's decoy token, not a real one. The
  // shape check inside readToken catches the decoy as a second line of
  // defense, but skipping the call on desktop is cleaner and faster.
  // Tier 3: walk webpack for the auth store. The store keeps the token in
  // module scope regardless of localStorage state.
  // Tier 4 (desktop): trigger an authenticated /api/v9 request via Discord's
  // own REST client, then read the Authorization header off it via our
  // installed fetch/XHR hooks. Only Discord's own outgoing traffic carries
  // the token on desktop, and traffic doesn't fire on its own after page
  // load, so we have to provoke it.
  let token = (isDesktop ? null : readToken()) ?? readTokenFromWebpack();
  if (!token && isDesktop) {
    void pokeForAuthHeader();
    const remaining = Math.max(3000, timeoutMs - (Date.now() - startTime));
    token = await awaitCapturedAuthorization(remaining);
  }
  if (!token) {
    throw new Error(
      isDesktop
        ? 'Discord token not captured (desktop). Poked Discord\'s REST client but no Authorization header was observed within the timeout. Recover by closing this executor and retrying with the browser fallback: createExecutor({ url: "https://discord.com/channels/@me" }).'
        : 'Discord token not found in localStorage or webpack auth store. User may be logged out.',
    );
  }

  // Always fetch /users/@me — we need username/global_name so the caller can
  // identify the account by name, not just snowflake. The userId from the
  // token decode is verified against the response.
  const identity = await fetchSelfIdentity(token);
  if (!identity) {
    throw new Error(
      `Could not fetch user identity. /users/@me did not return a valid user object — token may be invalid or rate-limited.`,
    );
  }
  const decodedUserId = decodeUserIdFromToken(token);
  if (decodedUserId && decodedUserId !== identity.userId) {
    throw new Error(
      `User ID mismatch: token decodes to ${decodedUserId} but /users/@me returned ${identity.userId}. Token may be malformed.`,
    );
  }

  setActiveToken(token);
  setActiveSurface(actualSurface);
  persistSession({
    token,
    userId: identity.userId,
    username: identity.username,
    globalName: identity.globalName,
    capturedAt: Date.now(),
  });
  return {
    token,
    userId: identity.userId,
    username: identity.username,
    globalName: identity.globalName,
    surface: actualSurface,
  };
}
