/**
 * GoDaddy shared runtime.
 *
 * Stable helpers every GoDaddy function module imports: host constants,
 * cookie/context readers, authenticated fetch wrappers, and pagination.
 *
 * Auth is session-cookie only — there is no bearer token. Every request uses
 * `credentials: 'include'`. The DCC/domain/DNS REST APIs additionally require
 * `x-app-key` + `X-Request-Id`; the account/billing/sso surfaces do not.
 */

import {
  Unauthenticated,
  ContractDrift,
  Validation,
  NotFound,
  PermissionDenied,
  RateLimited,
  UpstreamError,
  throwForStatus,
} from '@vallum/_runtime';

// Re-export so function modules import errors + helpers from one place.
export {
  Unauthenticated,
  ContractDrift,
  Validation,
  NotFound,
  PermissionDenied,
  RateLimited,
  UpstreamError,
  throwForStatus,
};

// ============================================================================
// Hosts
// ============================================================================

export const ACCOUNT_ORIGIN = 'https://account.godaddy.com';
export const DOMAINS_API = 'https://domainsapi.godaddy.com';
export const FOLDER_API = 'https://folder.domains.api.godaddy.com';
export const PROFILE_API = 'https://profile.domains.api.godaddy.com';
export const COA_API = 'https://coa.api.godaddy.com';
export const ECOMM_DOMAINS_API = 'https://ecomm.domains.api.godaddy.com';
export const DOMDNS_API = 'https://domdns.api.godaddy.com';
export const MGNT_DCC_API = 'https://mgnt.dcc.api.godaddy.com';
export const PG_API = 'https://pg.api.godaddy.com';
export const CERTS_ORIGIN = 'https://certs.godaddy.com';
export const SSO_ORIGIN = 'https://sso.godaddy.com';
export const NOTIFICATIONS_API = 'https://notifications-api.godaddy.com';
export const DOMAINFIND_ORIGIN = 'https://www.godaddy.com';
export const GraphQLUrl = `${PG_API}/v1/gql/customer`;

/** Default app key for the DCC/domain/DNS REST APIs. */
export const DEFAULT_APP_KEY = 'DCC-DomainController';

// ============================================================================
// Cookie + context readers
// ============================================================================

/** Plain cookie read (non-httpOnly cookies only). */
export function readCookie(name: string): string | undefined {
  const prefix = name + '=';
  const hit = document.cookie.split('; ').find((c) => c.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

interface InfoCustIdp {
  info_shopperId?: string;
  info_cid?: string;
  plid?: string | number;
  username?: string;
  firstname?: string;
  lastname?: string;
  currency?: string;
}

/** Decode the non-httpOnly `info_cust_idp` cookie (URL-encoded JSON). */
export function parseInfoCustIdp(): InfoCustIdp {
  if (!window.location.hostname.endsWith('godaddy.com')) {
    throw new Unauthenticated(
      `Open any *.godaddy.com page while logged in. URL: ${window.location.href}`,
    );
  }

  const raw = readCookie('info_cust_idp');
  if (!raw) {
    throw new Unauthenticated(
      `Not signed in: info_cust_idp cookie missing on ${window.location.href}.`,
    );
  }
  let info: InfoCustIdp;
  try {
    info = JSON.parse(decodeURIComponent(raw));
  } catch {
    throw new ContractDrift(
      `info_cust_idp cookie is not URL-encoded JSON: ${raw.slice(0, 120)}`,
    );
  }
  return info;
}

/** Customer UUID — the primary scoping segment on domains/DNS/billing APIs. */
export function getCustomerId(): string {
  // Try the traditional info_cust_idp cookie path first.
  try {
    const info = parseInfoCustIdp();
    if (info.info_cid) return String(info.info_cid);
  } catch {
    // Cookie missing or malformed — fall through to the __NEXT_DATA__ path.
  }

  // Fall back to the DCC Next.js page config (present on dcc.godaddy.com pages).
  const fromNextData = (window as unknown as Record<string, unknown>)
    ?.__NEXT_DATA__ as Record<string, unknown> | undefined;
  const cid = (
    (
      (
        (fromNextData?.props as Record<string, unknown>)?.pageProps as Record<
          string,
          unknown
        >
      )?.initialState as Record<string, unknown>
    )?.config as Record<string, unknown>
  )?.customerId as string | undefined;
  if (cid) return String(cid);

  throw new Unauthenticated(
    `getCustomerId: Not signed in — info_cust_idp cookie missing and no __NEXT_DATA__ config on ${window.location.href}. Open any dcc.godaddy.com or account.godaddy.com page while signed in.`,
  );
}

/** Numeric shopper id — used by sso/platapi/header endpoints. */
export function getShopperId(): string {
  const info = parseInfoCustIdp();
  if (!info.info_shopperId) {
    throw new ContractDrift(
      `info_cust_idp cookie lacks info_shopperId (keys: ${Object.keys(info).join(',')}).`,
    );
  }
  return String(info.info_shopperId);
}

/** Account market/locale, e.g. "en-US". Defaults to "en-US". */
export function getMarket(): string {
  return readCookie('market') ?? 'en-US';
}

/** Account currency, e.g. "USD". */
export function getCurrency(): string | undefined {
  return parseInfoCustIdp().currency ?? readCookie('currency') ?? undefined;
}

/** Private label id (plid); "1" for retail GoDaddy. */
export function getPlid(): string | number | undefined {
  return parseInfoCustIdp().plid;
}

/** Fresh uuid v4 for the per-request X-Request-Id header. */
export function uuid(): string {
  return crypto.randomUUID();
}

// ============================================================================
// Authenticated fetch
// ============================================================================

async function doFetch<T>(
  url: string,
  options: RequestInit,
  headers: Record<string, string>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...options, credentials: 'include', headers });
  } catch (err) {
    throw new UpstreamError(
      `GoDaddy fetch failed (${url}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Akamai WAF block (edgesuite.net reference) — IP-level rate limit, not a session issue.
    // account.godaddy.com can be host-wide blocked for 15-30 minutes after automated bursts.
    // Recovery: stop all account.godaddy.com requests, wait 15-30 min, then retry.
    // Note: navigating to account.godaddy.com via CDP also gets blocked; the block must expire.
    if (res.status === 403 && body.includes('edgesuite')) {
      throw new RateLimited(
        `GoDaddy account.godaddy.com temporarily blocked by Akamai WAF (${url}). Stop all requests to account.godaddy.com, wait 15-30 minutes, then retry.`,
      );
    }
    const truncated =
      body.length > 2000 ? body.slice(0, 2000) + '... [truncated]' : body;
    throwForStatus(
      res.status,
      `GoDaddy API ${res.status} (${url}): ${truncated}`,
    );
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ContractDrift(
      `GoDaddy returned non-JSON (${url}): ${text.slice(0, 500)}`,
    );
  }
}

/**
 * Cookie-auth JSON fetch for the account / billing / renewals / sso surfaces.
 * These hosts take NO x-app-key / X-Request-Id headers.
 *
 * NOTE on Akamai: account.godaddy.com hard-blocks synthetic bursts (403
 * host-wide for minutes). NEVER loop calls to it — space single calls and ride
 * the user's live session.
 */
export async function gdFetch<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  return doFetch<T>(url, options, {
    Accept: 'application/json',
    ...(options.body
      ? { 'Content-Type': 'application/json; charset=utf-8' }
      : {}),
    ...(options.headers as Record<string, string> | undefined),
  });
}

/**
 * Cookie-auth JSON fetch for the DCC / domain / DNS REST APIs
 * (domainsapi, domdns.api, mgnt.dcc.api). Adds the required x-app-key and a
 * fresh X-Request-Id. Override `appKey` for groups that need a different one
 * (e.g. 'DCC_Controller', 'dcc-controller', 'DCC-Domain-Details').
 */
export async function dccFetch<T>(
  url: string,
  options: RequestInit = {},
  appKey: string = DEFAULT_APP_KEY,
): Promise<T> {
  return doFetch<T>(url, options, {
    Accept: 'application/json',
    'x-app-key': appKey,
    'X-Request-Id': uuid(),
    ...(options.body
      ? { 'Content-Type': 'application/json; charset=utf-8' }
      : {}),
    ...(options.headers as Record<string, string> | undefined),
  });
}

/** GraphQL POST against pg.api.godaddy.com. Headers match DCC REST. */
export async function gqlFetch<T>(
  operationName: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const body = JSON.stringify({ operationName, query, variables });
  const resp = await dccFetch<{
    data?: T;
    errors?: Array<{ message?: string }>;
  }>(GraphQLUrl, {
    method: 'POST',
    body,
  });
  if (resp.errors?.length) {
    throw new UpstreamError(
      `GraphQL ${operationName} failed: ${JSON.stringify(resp.errors).slice(0, 400)}`,
    );
  }
  if (resp.data == null) {
    throw new ContractDrift(`GraphQL ${operationName} returned no data.`);
  }
  return resp.data;
}

// ============================================================================
// Pagination helpers (callers may also paginate inline when these don't fit)
// ============================================================================

/**
 * Offset/limit pagination (subscriptions, gateway). Pages internally past the
 * server cap until `count` items are gathered or a short page signals the end.
 */
export async function paginateOffset<T>(
  fetchPage: (
    limit: number,
    offset: number,
  ) => Promise<{ items: T[]; total?: number }>,
  count?: number,
  pageSize = 50,
): Promise<{ items: T[]; total?: number }> {
  const out: T[] = [];
  let offset = 0;
  let total: number | undefined;
  for (;;) {
    const want =
      count != null ? Math.min(pageSize, count - out.length) : pageSize;
    if (want <= 0) break;
    const { items, total: t } = await fetchPage(want, offset);
    if (t != null) total = t;
    out.push(...items);
    if (items.length < want) break;
    offset += items.length;
    if (count != null && out.length >= count) break;
  }
  return { items: count != null ? out.slice(0, count) : out, total };
}

/**
 * Page-number pagination (DNS records/zones). `pageNumber` is 1-indexed.
 * Stops on a short page or when `count` is reached.
 */
export async function paginatePage<T>(
  fetchPage: (pageNumber: number, pageSize: number) => Promise<T[]>,
  count?: number,
  pageSize = 100,
): Promise<T[]> {
  const out: T[] = [];
  let pageNumber = 1;
  for (;;) {
    const items = await fetchPage(pageNumber, pageSize);
    out.push(...items);
    if (items.length < pageSize) break;
    if (count != null && out.length >= count) break;
    pageNumber += 1;
  }
  return count != null ? out.slice(0, count) : out;
}
