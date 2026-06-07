/**
 * Facebook Library: Shared Helpers
 *
 * Token extraction from Meta's module system and the common GraphQL
 * request builder used by every domain module.
 */

export function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

type RequireFn = (mod: string) => unknown;

export function getRequire(): RequireFn | null {
  const win = window as unknown as Record<string, unknown>;
  return typeof win.require === 'function' ? (win.require as RequireFn) : null;
}

function requireModule<T = unknown>(name: string): T | null {
  const req = getRequire();
  if (!req) return null;
  try {
    return req(name) as T;
  } catch {
    return null;
  }
}

export function getDtsgToken(): string {
  const dtsg = requireModule<{ token?: string }>('DTSGInitialData');
  if (dtsg?.token) return dtsg.token;
  const alt = requireModule<{ token?: string }>('DTSGInitData');
  if (alt?.token) return alt.token;
  throw new Error(
    'fb_dtsg token not found. Navigate to https://www.facebook.com/ or any authenticated Facebook page before calling getContext().',
  );
}

export function getLsdToken(): string {
  const lsd = requireModule<{ token?: string }>('LSD');
  return lsd?.token ?? '';
}

export function computeJazoest(dtsg: string): string {
  let sum = 0;
  for (let i = 0; i < dtsg.length; i++) sum += dtsg.charCodeAt(i);
  return '2' + String(sum);
}

export function getAsbdId(): string {
  const hdr = requireModule<{ ASBD_ID?: string }>('HeaderConfig');
  return hdr?.ASBD_ID ?? '359341';
}

interface SiteDataShape {
  client_revision?: number;
  __spin_r?: number;
  __spin_b?: string;
  __spin_t?: number;
  hsi?: string;
  haste_session?: string;
  ef_page?: string;
  comet_env?: number;
}

function getSiteData(): SiteDataShape {
  return requireModule<SiteDataShape>('SiteData') ?? {};
}

export function getViewerUserId(): string {
  const cu = requireModule<{ USER_ID?: string; ACCOUNT_ID?: string }>(
    'CurrentUserInitialData',
  );
  return cu?.USER_ID ?? cu?.ACCOUNT_ID ?? '0';
}

export function getServerNonce(): string {
  const sn = requireModule<{ ServerNonce?: string }>('ServerNonce');
  return sn?.ServerNonce ?? '';
}

export interface FacebookFetchContext {
  userId: string;
  docId: string;
  friendlyName: string;
  variables: Record<string, unknown>;
  routeName?: string;
  cometReq?: string;
}

/**
 * Build the form body for a Facebook GraphQL request. Tokens are read fresh
 * from the Meta module system on every call so they track rotation.
 */
export function buildGraphqlBody(ctx: FacebookFetchContext): URLSearchParams {
  const dtsg = getDtsgToken();
  const lsd = getLsdToken();
  const jazoest = computeJazoest(dtsg);
  const site = getSiteData();
  const rev = String(site.client_revision ?? site.__spin_r ?? 1);
  const spinR = String(site.__spin_r ?? rev);
  const spinB = site.__spin_b ?? 'trunk';
  const spinT = String(site.__spin_t ?? Math.floor(Date.now() / 1000));
  const hs = site.haste_session ?? '';
  const hsi = site.hsi ?? '';
  const crn = ctx.routeName ?? site.ef_page ?? '';
  const cometReq = ctx.cometReq ?? String(site.comet_env ?? 15);

  const params = new URLSearchParams();
  params.set('av', ctx.userId);
  params.set('__aaid', '0');
  params.set('__user', ctx.userId);
  params.set('__a', '1');
  params.set('__req', '1');
  params.set('__hs', hs);
  params.set('dpr', '1');
  params.set('__ccg', 'EXCELLENT');
  params.set('__rev', rev);
  params.set('__hsi', hsi);
  params.set('__comet_req', cometReq);
  params.set('fb_dtsg', dtsg);
  params.set('jazoest', jazoest);
  params.set('lsd', lsd);
  params.set('__spin_r', spinR);
  params.set('__spin_b', spinB);
  params.set('__spin_t', spinT);
  if (crn) params.set('__crn', crn);
  params.set('fb_api_caller_class', 'RelayModern');
  params.set('fb_api_req_friendly_name', ctx.friendlyName);
  params.set('variables', JSON.stringify(ctx.variables));
  params.set('server_timestamps', 'true');
  params.set('doc_id', ctx.docId);
  return params;
}

export function buildHeaders(friendlyName: string): Record<string, string> {
  return {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/x-www-form-urlencoded',
    origin: 'https://www.facebook.com',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'x-asbd-id': getAsbdId(),
    'x-fb-friendly-name': friendlyName,
    'x-fb-lsd': getLsdToken(),
  };
}

interface RelayChunk {
  label?: string;
  path?: (string | number)[];
  data?: unknown;
  extensions?: { is_final?: boolean };
  errors?: unknown[];
  errorSummary?: string;
  redirect?: string;
  error?: unknown;
}

function getAtPath(
  root: Record<string, unknown>,
  path: (string | number)[],
): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

function setAtPath(
  root: Record<string, unknown>,
  path: (string | number)[],
  value: unknown,
): void {
  let cur: Record<string | number, unknown> = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    let next = cur[key];
    if (next == null || typeof next !== 'object') {
      next = typeof path[i + 1] === 'number' ? [] : {};
      cur[key] = next;
    }
    cur = next as Record<string | number, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

/**
 * Parse a Facebook GraphQL response.
 *
 * Facebook responds with Content-Type text/html but a JSON body. When
 * Relay incremental delivery is active the response is a stream of
 * newline-delimited JSON objects: the first object carries base `data`,
 * and subsequent objects deliver streamed array elements (`$stream$`)
 * or deferred fields (`$defer$`) at a `path` within `data`. We merge
 * all chunks so the returned shape matches a non-streamed response.
 */
async function parseFacebookResponse<T>(
  resp: Response,
  friendlyName: string,
): Promise<T> {
  const text = await resp.text();
  if (!text) {
    throw new Error(
      `Facebook returned empty body for ${friendlyName}. Session may be invalid.`,
    );
  }

  const lines = text.split('\n').filter((l) => l.length > 0);
  const chunks: RelayChunk[] = [];
  for (const line of lines) {
    try {
      chunks.push(JSON.parse(line) as RelayChunk);
    } catch {
      throw new Error(
        `Facebook returned unparseable response for ${friendlyName}. First 200 chars: ${text.slice(0, 200)}`,
      );
    }
  }
  if (chunks.length === 0) {
    throw new Error(
      `Facebook returned no JSON chunks for ${friendlyName}. First 200 chars: ${text.slice(0, 200)}`,
    );
  }

  const head = chunks[0];
  if (head.errors && Array.isArray(head.errors) && head.errors.length > 0) {
    throw new Error(
      `Facebook GraphQL error for ${friendlyName}: ${JSON.stringify(head.errors).slice(0, 400)}`,
    );
  }
  if (head.redirect) {
    throw new Error(
      `Facebook redirected ${friendlyName} to ${head.redirect}. Likely a checkpoint or login challenge.`,
    );
  }
  if (typeof head.error === 'number') {
    throw new Error(
      `Facebook API error for ${friendlyName}: error ${head.error} (${head.errorSummary || 'unknown'}).`,
    );
  }

  if (chunks.length === 1 || !head.data || typeof head.data !== 'object') {
    return head as T;
  }

  const root = head.data as Record<string, unknown>;
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk.path || !chunk.label) continue;
    if (chunk.data === undefined) continue;
    if (chunk.label.includes('$stream$')) {
      setAtPath(root, chunk.path, chunk.data);
    } else if (chunk.label.includes('$defer$')) {
      const target = getAtPath(root, chunk.path);
      if (
        target != null &&
        typeof target === 'object' &&
        chunk.data != null &&
        typeof chunk.data === 'object' &&
        !Array.isArray(target)
      ) {
        Object.assign(target, chunk.data);
      } else {
        setAtPath(root, chunk.path, chunk.data);
      }
    }
  }

  return head as T;
}

export async function graphql<T>(
  userId: string,
  docId: string,
  friendlyName: string,
  variables: Record<string, unknown>,
  opts?: { routeName?: string; cometReq?: string },
): Promise<T> {
  const origin = window.location.origin;
  const body = buildGraphqlBody({
    userId,
    docId,
    friendlyName,
    variables,
    routeName: opts?.routeName,
    cometReq: opts?.cometReq,
  });

  const resp = await fetch(`${origin}/api/graphql/`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(friendlyName),
    body: body.toString(),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(
      `Facebook API HTTP ${resp.status} for ${friendlyName}. Body: ${txt.slice(0, 300)}`,
    );
  }

  return parseFacebookResponse<T>(resp, friendlyName);
}

export interface RouteDefinitionProps {
  collectionToken: string | null;
  rawSectionToken: string | null;
  sectionToken: string | null;
  userID: string;
  userVanity: string;
  viewerID: string;
}

/**
 * Build the SPA route path used to mint section/collection tokens for a
 * profile tab or collection. Always uses the raw numeric userID so we never
 * need a vanity-URL round-trip; Facebook canonicalizes profile.php → vanity
 * server-side and `getRouteDefinition` follows that redirect.
 */
export function buildRoutePath(userID: string, slug: string): string {
  return `/profile.php?id=${userID}&sk=${slug}`;
}

/**
 * Resolve an SPA route via Facebook's `/ajax/route-definition/` endpoint.
 * Used to obtain the opaque `rawSectionToken` / `sectionToken` /
 * `collectionToken` values that Profile section + collection GraphQL
 * queries require. These tokens are not present in any GraphQL response
 * body — only this endpoint produces them.
 */
export async function getRouteDefinition(
  routeUrl: string,
): Promise<RouteDefinitionProps> {
  const origin = window.location.origin;
  const userId = getViewerUserId();
  const dtsg = getDtsgToken();
  const lsd = getLsdToken();
  const jazoest = computeJazoest(dtsg);
  const site = getSiteData();

  const params = new URLSearchParams();
  params.set('route_url', routeUrl);
  params.set('routing_namespace', 'fb_comet');
  params.set('client_previous_actor_id', userId);
  params.set('av', userId);
  params.set('__user', userId);
  params.set('__a', '1');
  params.set('__req', '1');
  params.set('__hs', site.haste_session ?? '');
  params.set('dpr', '1');
  params.set('__ccg', 'EXCELLENT');
  params.set('__rev', String(site.client_revision ?? site.__spin_r ?? 1));
  params.set('__hsi', site.hsi ?? '');
  params.set('__comet_req', '15');
  params.set('fb_dtsg', dtsg);
  params.set('jazoest', jazoest);
  params.set('lsd', lsd);
  params.set('__spin_r', String(site.__spin_r ?? site.client_revision ?? 1));
  params.set('__spin_b', site.__spin_b ?? 'trunk');
  params.set(
    '__spin_t',
    String(site.__spin_t ?? Math.floor(Date.now() / 1000)),
  );

  const resp = await fetch(`${origin}/ajax/route-definition/`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin,
      'sec-fetch-site': 'same-origin',
      'x-asbd-id': getAsbdId(),
      'x-fb-lsd': lsd,
    },
    body: params.toString(),
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(
      `Facebook route-definition HTTP ${resp.status} for ${routeUrl}. Body: ${txt.slice(0, 300)}`,
    );
  }

  const text = await resp.text();
  // Facebook prefixes JSON responses with `for (;;);` to defeat XSSI, and
  // large route-definition payloads arrive as newline-delimited JSON chunks
  // (Relay incremental delivery). Strip the prefix, then parse line-by-line
  // and take the first chunk that carries `payload`.
  const jsonStart = text.indexOf('{');
  if (jsonStart < 0) {
    throw new Error(
      `Facebook route-definition returned non-JSON for ${routeUrl}. First 200 chars: ${text.slice(0, 200)}`,
    );
  }
  type RouteResult = {
    type?: string;
    exports?: {
      rootView?: { props?: Partial<RouteDefinitionProps> };
    };
    redirect_result?: RouteResult;
  };
  type RouteDefPayload = {
    payload?: {
      error?: boolean;
      result?: RouteResult;
    };
    error?: unknown;
  };
  const lines = text
    .slice(jsonStart)
    .split('\n')
    .filter((l) => l.length > 0);
  let parsed: RouteDefPayload | null = null;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as RouteDefPayload;
      if (obj.payload || obj.error) {
        parsed = obj;
        break;
      }
    } catch {
      // skip non-JSON or partial chunks; the payload chunk parses cleanly
    }
  }
  if (!parsed) {
    throw new Error(
      `Facebook route-definition unparseable for ${routeUrl}. First 200 chars: ${text.slice(0, 200)}`,
    );
  }

  if (parsed.payload?.error || parsed.error) {
    throw new Error(
      `Facebook route-definition reported error for ${routeUrl}: ${JSON.stringify(parsed).slice(0, 400)}`,
    );
  }

  // Facebook returns one of two shapes:
  //   1. result.exports.rootView.props (direct match)
  //   2. result.type === "route_redirect", with the resolved route nested in
  //      result.redirect_result (e.g. profile.php?id=… → /<vanity>/…).
  // Walk redirect_result chains until we find rootView.props.
  let result: RouteResult | undefined = parsed.payload?.result;
  while (result && !result.exports?.rootView?.props && result.redirect_result) {
    result = result.redirect_result;
  }
  const props = result?.exports?.rootView?.props;
  if (!props || typeof props.userID !== 'string') {
    throw new Error(
      `Facebook route-definition for ${routeUrl} did not return rootView.props. Response: ${text.slice(jsonStart, jsonStart + 400)}`,
    );
  }

  return {
    collectionToken: props.collectionToken ?? null,
    rawSectionToken: props.rawSectionToken ?? null,
    sectionToken: props.sectionToken ?? null,
    userID: props.userID,
    userVanity: props.userVanity ?? '',
    viewerID: props.viewerID ?? userId,
  };
}

/**
 * Build the Relay-internal feed-key string the section/collection feed
 * queries expect. Facebook's web client computes this client-side from
 * the rawSectionToken, so we replicate the formula rather than parsing
 * it out of a response.
 */
export function buildAppSectionFeedKey(rawSectionToken: string): string {
  return `ProfileCometAppSectionFeed_timeline_nav_app_sections__${rawSectionToken}`;
}
