/**
 * Instagram Library: Shared Helpers
 *
 * Canonical helper functions used by all domain modules.
 * Auth token extraction, GraphQL request builders, and common utilities.
 */

import { Unauthenticated, ContractDrift, throwForStatus } from '@vallum/_runtime';

export function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export type RequireFn = (mod: string) => unknown;

export function getRequire(): RequireFn | null {
  const win = window as unknown as Record<string, unknown>;
  return typeof win.require === 'function' ? (win.require as RequireFn) : null;
}

/** Get the fb_dtsg token from Meta's module system */
export function getDtsgToken(): string {
  const req = getRequire();
  if (!req)
    throw new Unauthenticated('Meta require() not found. Page may not be fully loaded.');

  // Try DTSGInitialData first (primary source)
  try {
    const dtsg = req('DTSGInitialData') as { token?: string } | undefined;
    if (dtsg?.token) return dtsg.token;
  } catch {
    /* module not available */
  }

  // Fallback to DTSGInitData (alternate module name)
  try {
    const dtsgAlt = req('DTSGInitData') as { token?: string } | undefined;
    if (dtsgAlt?.token) return dtsgAlt.token;
  } catch {
    /* module not available */
  }

  throw new Unauthenticated(
    'fb_dtsg token not found. The home feed page (/) does not expose this token. Navigate to a profile page or DM page first, then call getContext().',
  );
}

/** Get the LSD token from Meta's module system */
export function getLsdToken(): string {
  const req = getRequire();
  if (!req) return '';
  try {
    const lsd = req('LSD') as { token?: string } | undefined;
    if (lsd?.token) return lsd.token;
  } catch {
    /* module not available */
  }
  return '';
}

/** Compute jazoest from fb_dtsg (sum of char codes, prefixed with "2") */
export function computeJazoest(dtsg: string): string {
  let sum = 0;
  for (let i = 0; i < dtsg.length; i++) {
    sum += dtsg.charCodeAt(i);
  }
  return '2' + String(sum);
}

/** Get the SiteData revision for __rev and __spin_r */
export function getClientRevision(): string {
  const req = getRequire();
  if (!req) return '1';
  try {
    const siteData = req('SiteData') as
      | { client_revision?: number; __spin_r?: number }
      | undefined;
    if (siteData?.client_revision) return String(siteData.client_revision);
    if (siteData?.__spin_r) return String(siteData.__spin_r);
  } catch {
    /* module not available */
  }
  return '1';
}

/** Get App ID */
export function getAppId(): string {
  const req = getRequire();
  if (req) {
    try {
      const cu = req('CurrentUserInitialData') as
        | { APP_ID?: string }
        | undefined;
      if (cu?.APP_ID) return cu.APP_ID;
    } catch {
      /* module not available */
    }
  }
  return '936619743392459';
}

/** Get the viewer's FBID (Meta cross-platform ID) for the `av` body parameter */
export function getViewerFbid(): string {
  const req = getRequire();
  if (req) {
    try {
      const viewer = req('PolarisViewer') as
        | { data?: { fbid?: string } }
        | undefined;
      if (viewer?.data?.fbid) return viewer.data.fbid;
    } catch {
      /* module not available */
    }
  }
  return '0';
}

/**
 * Build common headers for Instagram API requests.
 */
export function buildHeaders(csrf: string): Record<string, string> {
  return {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/x-www-form-urlencoded',
    'x-csrftoken': csrf,
    'x-ig-app-id': getAppId(),
    'x-requested-with': 'XMLHttpRequest',
  };
}

/**
 * Build the common form body params required by all Instagram GraphQL requests.
 */
export function buildGraphqlBody(
  docId: string,
  friendlyName: string,
  variables: Record<string, unknown>,
): URLSearchParams {
  const dtsg = getDtsgToken();
  const lsd = getLsdToken();
  const jazoest = computeJazoest(dtsg);
  const rev = getClientRevision();

  const params = new URLSearchParams({
    __a: '1',
    __comet_req: '7',
    __d: 'www',
    __rev: rev,
    __s: '',
    __user: '0',
    av: getViewerFbid(),
    doc_id: docId,
    dpr: '2',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: friendlyName,
    fb_dtsg: dtsg,
    jazoest,
    lsd,
    server_timestamps: 'true',
    variables: JSON.stringify(variables),
  });

  return params;
}

/**
 * Make a GraphQL request to Instagram's primary endpoint (/api/graphql).
 */
export async function graphqlPrimary<T>(
  csrf: string,
  docId: string,
  friendlyName: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const origin = window.location.origin;
  const body = buildGraphqlBody(docId, friendlyName, variables);

  const resp = await fetch(`${origin}/api/graphql`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(csrf),
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, `Instagram API error: HTTP ${resp.status} ${resp.statusText}. Endpoint: /api/graphql (${friendlyName}). Body: ${text?.slice(0, 500)}`);
  }

  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      `Instagram returned HTML instead of JSON for ${friendlyName}. This usually means auth tokens are missing or invalid.`,
    );
  }

  const data = await parseIGResponse<T>(resp, friendlyName);
  return data;
}

/**
 * Parse an Instagram API response, stripping the `for (;;);` anti-hijacking prefix if present.
 * Instagram returns Content-Type `application/x-javascript` with this prefix on GraphQL endpoints.
 */
async function parseIGResponse<T>(
  resp: Response,
  friendlyName: string,
): Promise<T> {
  const text = await resp.text();
  const cleaned = text.startsWith('for (;;);') ? text.slice(9) : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new ContractDrift(
      `Instagram returned unparseable response for ${friendlyName}. First 200 chars: ${text.slice(0, 200)}`,
    );
  }
  // Detect Instagram's error response format (HTTP 200 but error body)
  const obj = parsed as Record<string, unknown>;
  if (obj && typeof obj.error === 'number') {
    throw new Unauthenticated(
      `Instagram API error for ${friendlyName}: error ${obj.error} (${(obj.errorSummary as string) ?? 'unknown'}). This may indicate an invalid CSRF token.`,
    );
  }
  return parsed as T;
}

/**
 * Make a GraphQL request to Instagram's secondary endpoint (/graphql/query).
 */
export async function graphqlQuery<T>(
  csrf: string,
  docId: string,
  friendlyName: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const origin = window.location.origin;
  const body = buildGraphqlBody(docId, friendlyName, variables);

  const resp = await fetch(`${origin}/graphql/query`, {
    method: 'POST',
    credentials: 'include',
    headers: buildHeaders(csrf),
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, `Instagram API error: HTTP ${resp.status} ${resp.statusText}. Endpoint: /graphql/query (${friendlyName}). Body: ${text?.slice(0, 500)}`);
  }

  const contentType = resp.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    throw new Unauthenticated(
      `Instagram returned HTML instead of JSON for ${friendlyName}. This usually means auth tokens are missing or invalid.`,
    );
  }

  const data = await parseIGResponse<T>(resp, friendlyName);
  return data;
}
