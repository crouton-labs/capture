/**
 * LinkedIn Internal Helpers
 *
 * Shared utilities for LinkedIn Voyager API operations.
 */

import type { SearchPeopleOutput } from '../schemas';
import { ContractDrift, UpstreamError, Validation, throwForStatus } from '@vallum/_runtime';
import { AMD_PAGE_GUIDANCE } from './page-guidance';

const LINKEDIN_HEADERS = {
  accept: 'application/vnd.linkedin.normalized+json+2.1',
  'x-restli-protocol-version': '2.0.0',
  'x-li-lang': 'en_US',
};

/**
 * Stable pageforestid for this session. Real LinkedIn pages reuse the same
 * pageforestid across every API call made during one page load; rotating it
 * per-request is a trivial automation fingerprint. We scrape it from the
 * server-rendered HTML when available, otherwise generate one and hold it.
 *
 * Rotation is keyed on URL path so same-page re-imports reuse the cached id
 * while a real navigation to a different page refreshes it (matching how
 * LinkedIn's Ember client behaves on route change).
 */
let cachedPageForestId: { id: string; pathname: string } | null = null;

function hexBytes(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function extractPageForestIdFromHtml(): string | null {
  // LinkedIn embeds the current page forest ID in the initial HTML. Exact
  // placement varies by page; the canonical form is a 32-char hex blob with a
  // recognizable `00064...` timestamp prefix (LinkedIn's monotonic page ID).
  const html = document.documentElement.outerHTML;
  const match = html.match(/\b(00064f[a-f0-9]{26})\b/i);
  return match ? match[1] : null;
}

function getPageForestId(): string {
  const currentPath = location.pathname;
  if (cachedPageForestId && cachedPageForestId.pathname === currentPath) {
    return cachedPageForestId.id;
  }
  const id = extractPageForestIdFromHtml() ?? hexBytes(16);
  cachedPageForestId = { id, pathname: currentPath };
  return id;
}

/**
 * Generate W3C Trace Context headers that LinkedIn's frontend sends on API
 * requests. pageforestid is session-stable (matches real browser behavior);
 * spanId rotates per request.
 */
function generateTraceHeaders(): Record<string, string> {
  const traceId = getPageForestId();
  const spanId = hexBytes(8);

  return {
    'x-li-pageforestid': traceId,
    'x-li-traceparent': `00-${traceId}-${spanId}-00`,
    'x-li-tracestate': `LinkedIn=${spanId}`,
  };
}

/** In-memory cache for discovered queryIds (per session) */
const queryIdCache: Record<string, string> = {};

/**
 * Mapping from operation names used in our code to the webpack registration names.
 * The webpack Pr() calls use names like 'find-conversations-by-category-v2',
 * but our functions call getQueryId('messengerConversationsByCategoryQuery', ...).
 */
const MESSAGING_OPERATION_ALIASES: Record<string, string> = {
  messengerConversationsByCategoryQuery: 'messengerConversations',
};

export async function linkedinFetch<T>(
  csrf: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  // A missing csrf otherwise gets sent as the literal header `csrf-token: undefined`,
  // which LinkedIn rejects with an opaque `403 CSRF check failed` — easily misread
  // as a logged-out/wrong-tab/--port problem. Fail fast with an actionable message.
  if (!csrf || typeof csrf !== 'string') {
    throw new Validation(
      `linkedinFetch called without a csrf token (got ${JSON.stringify(csrf)}). ` +
        `Pass the csrf from getContext(): const ctx = await getContext({}); ` +
        `await searchPeople({ csrf: ctx.csrf, ... }).`,
    );
  }
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'csrf-token': csrf,
      ...LINKEDIN_HEADERS,
      ...generateTraceHeaders(),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    const truncated =
      body.length > 2000 ? body.slice(0, 2000) + '... [truncated]' : body;
    throwForStatus(response.status, `LinkedIn API error ${response.status}: ${truncated}`);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    const truncated =
      text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    throw new ContractDrift(`LinkedIn returned non-JSON response: ${truncated}`);
  }
}

/**
 * Encode a URN string for LinkedIn's GraphQL variables.
 * URNs inside List() must be URL-encoded with parentheses also encoded.
 */
function encodeUrn(urn: string): string {
  return encodeURIComponent(urn).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/**
 * Encode variables for LinkedIn's custom GraphQL format.
 * Format: (key:value,key2:value2,list:List(item1,item2))
 * URN strings (urn:li:...) are always URL-encoded.
 */
export function encodeVars(obj: unknown): string {
  if (obj === null || obj === undefined) return '';
  if (typeof obj === 'string') {
    // URN strings always need URL encoding
    if (obj.startsWith('urn:li:')) {
      return encodeUrn(obj);
    }
    return obj;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    return `List(${obj.map((v) => encodeVars(v)).join(',')})`;
  }
  if (typeof obj === 'object') {
    const pairs = Object.entries(obj).map(([k, v]) => `${k}:${encodeVars(v)}`);
    return `(${pairs.join(',')})`;
  }
  return String(obj);
}

export function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function generateTrackingId(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => String.fromCharCode(b)).join('');
}

/**
 * Build entity map from included array for reference resolution.
 */
export function buildEntityMap(
  included: unknown[] | undefined,
): Record<string, unknown> {
  const entityMap: Record<string, unknown> = {};
  if (!included) return entityMap;

  for (const entity of included) {
    const e = entity as { entityUrn?: string };
    if (e.entityUrn) {
      entityMap[e.entityUrn] = entity;
    }
  }
  return entityMap;
}

/**
 * Parse people search results from LinkedIn's normalized response format.
 */
export function parseSearchResults(
  data: {
    data?: { data?: { searchDashClustersByAll?: unknown } };
    included?: unknown[];
  },
  count: number,
): { results: SearchPeopleOutput['results']; total?: number } {
  const entityMap = buildEntityMap(data.included);
  const results: SearchPeopleOutput['results'] = [];

  const searchData = (
    data.data?.data as {
      searchDashClustersByAll?: {
        elements?: unknown[];
        '*elements'?: string[];
        paging?: { total?: number };
      };
    }
  )?.searchDashClustersByAll;
  if (!searchData) return { results };

  // Get elements array (may be direct or via *elements reference)
  let elements = searchData.elements;
  if (!elements && searchData['*elements']) {
    elements = searchData['*elements'].map(
      (urn: string) => entityMap[urn] ?? urn,
    );
  }

  if (elements) {
    for (const cluster of elements) {
      const resolvedCluster =
        typeof cluster === 'string' ? entityMap[cluster] : cluster;
      if (!resolvedCluster) continue;

      const clusterObj = resolvedCluster as {
        items?: unknown[];
        '*items'?: string[];
      };
      let items = clusterObj.items;
      if (!items && clusterObj['*items']) {
        items = clusterObj['*items'].map(
          (urn: string) => entityMap[urn] ?? urn,
        );
      }

      if (items) {
        for (const item of items) {
          const resolvedItem =
            typeof item === 'string' ? entityMap[item] : item;
          if (!resolvedItem) continue;

          const itemObj = resolvedItem as {
            item?: { entityResult?: unknown; '*entityResult'?: string };
          };
          const itemComponent = itemObj.item ?? resolvedItem;
          const comp = itemComponent as {
            entityResult?: unknown;
            '*entityResult'?: string;
          };

          let entityResult = comp.entityResult;
          if (!entityResult && comp['*entityResult']) {
            entityResult = entityMap[comp['*entityResult']];
          }

          if (entityResult) {
            const entity = (
              typeof entityResult === 'string'
                ? entityMap[entityResult]
                : entityResult
            ) as {
              entityUrn?: string;
              trackingUrn?: string;
              title?: { text?: string };
              primarySubtitle?: { text?: string };
              secondarySubtitle?: { text?: string };
              badgeText?: { text?: string };
              navigationUrl?: string;
            };

            if (entity?.title?.text) {
              const navigationUrl = entity.navigationUrl;
              const vanityNameMatch = navigationUrl?.match(/\/in\/([^/?]+)/);
              const vanityName = vanityNameMatch?.[1] ?? undefined;

              const badgeText = entity.badgeText?.text;
              let connectionDegree: string | undefined;
              if (badgeText) {
                if (badgeText.includes('1st')) connectionDegree = '1st';
                else if (badgeText.includes('2nd')) connectionDegree = '2nd';
                else if (badgeText.includes('3rd')) connectionDegree = '3rd+';
              }

              const urn = entity.entityUrn ?? entity.trackingUrn;
              // Extract member ID, stripping any tracking metadata (e.g., ",SEARCH_SRP,DEFAULT)")
              let memberId = urn?.split(':').pop();
              if (memberId?.includes(',')) {
                memberId = memberId.split(',')[0];
              }

              results.push({
                memberId,
                name: entity.title.text,
                headline: entity.primarySubtitle?.text,
                location: entity.secondarySubtitle?.text,
                vanityName,
                profileUrl: vanityName
                  ? `https://www.linkedin.com/in/${vanityName}`
                  : undefined,
                connectionDegree,
              });
            }
          }
        }
      }
    }
  }

  // Fallback: check for EntityResult entries directly in included
  if (results.length === 0 && data.included) {
    for (const entity of data.included) {
      const e = entity as {
        $type?: string;
        entityUrn?: string;
        title?: { text?: string };
        primarySubtitle?: { text?: string };
        secondarySubtitle?: { text?: string };
        badgeText?: { text?: string };
        navigationUrl?: string;
      };

      if (e.$type?.includes('EntityResult') && e.title?.text) {
        const vanityNameMatch = e.navigationUrl?.match(/\/in\/([^/?]+)/);
        const vanityName = vanityNameMatch?.[1];

        const badgeText = e.badgeText?.text;
        let connectionDegree: string | undefined;
        if (badgeText) {
          if (badgeText.includes('1st')) connectionDegree = '1st';
          else if (badgeText.includes('2nd')) connectionDegree = '2nd';
          else if (badgeText.includes('3rd')) connectionDegree = '3rd+';
        }

        results.push({
          memberId: e.entityUrn?.split(':').pop(),
          name: e.title.text,
          headline: e.primarySubtitle?.text,
          location: e.secondarySubtitle?.text,
          vanityName,
          profileUrl: vanityName
            ? `https://www.linkedin.com/in/${vanityName}`
            : undefined,
          connectionDegree,
        });
      }
    }
  }

  // Deduplicate by memberId (multiple people can share the same name)
  const seen = new Set<string>();
  const uniqueResults = results.filter((p) => {
    const key = p.memberId ?? p.name ?? '';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const paging = searchData.paging;
  const total = paging?.total;

  return {
    results: uniqueResults.slice(0, count),
    total,
  };
}

/**
 * AMD registry cache: populated once per session by scanning require.entries.
 * Maps operation name OR module name to full queryId.
 */
let amdRegistryCache: Record<string, string> | null = null;

/**
 * Webpack messaging cache: populated once per session by scanning
 * webpackChunk_ember_auto_import_ modules (messaging page only).
 * Maps operation name AND registration name to full queryId.
 */
let webpackMessagingCache: Record<string, string> | null = null;

/** Typed reference to LinkedIn's AMD require global */
declare const require: {
  entries: Record<string, { callback?: { toString(): string } }>;
};

/** Typed reference to LinkedIn's webpack chunk array (messaging bundles) */
declare const webpackChunk_ember_auto_import_: Array<
  [unknown, Record<string, ((...args: unknown[]) => void) | object>]
>;

/**
 * Extract ALL queryIds from LinkedIn's Ember AMD module registry.
 * Parses require.entries callback source for id:"operationName.hash" patterns.
 * Zero network requests, instant, works on all Ember pages (feed, profile, jobs, etc.).
 */
function extractAllQueryIdsFromAMD(): Record<string, string> {
  const registry: Record<string, string> = {};
  const entries = require.entries;

  for (const key of Object.keys(entries)) {
    if (!key.startsWith('graphql-queries/')) continue;
    const entry = entries[key];
    if (!entry?.callback) continue;

    const src = entry.callback.toString();
    const idMatch = src.match(/id:"([^"]+)"/);
    const nameMatch = src.match(/name:"([^"]+)"/);
    if (!idMatch) continue;

    const fullId = idMatch[1];
    const opName = fullId.split('.')[0];
    const modName = nameMatch?.[1];

    // Store by operation name (first match wins; queries before mutations)
    if (!registry[opName]) {
      registry[opName] = fullId;
    }

    // Also store by module name for disambiguation (multiple hashes per operation)
    if (modName) {
      registry[modName] = fullId;
    }
  }

  return registry;
}

/**
 * Extract messaging queryIds from LinkedIn's webpack chunk registry.
 * Parses webpackChunk_ember_auto_import_ module source for Pr(!0,{...id:"op.hash"...name:"name"}) patterns.
 * Only available on /messaging/ page where the messaging webpack chunk loads.
 */
function extractMessagingQueryIdsFromWebpack(): Record<string, string> | null {
  if (
    typeof webpackChunk_ember_auto_import_ === 'undefined' ||
    !Array.isArray(webpackChunk_ember_auto_import_)
  ) {
    return null;
  }

  const registry: Record<string, string> = {};

  for (const chunk of webpackChunk_ember_auto_import_) {
    const modules = chunk[1];
    if (!modules || typeof modules !== 'object') continue;

    for (const mod of Object.values(modules)) {
      if (typeof mod !== 'function') continue;
      const src = mod.toString();
      if (!src.includes('messengerConversations')) continue;

      // Found the messaging module; extract all Pr() registrations
      // Pattern: Pr(!0,{kind:"query",id:"endpoint.hash",typeName:"...",name:"op-name"})
      const regex =
        /\(!0,\{kind:"(query|mutation)",id:"([^"]+)",typeName:"[^"]+",name:"([^"]+)"\}\)/g;
      let match;
      while ((match = regex.exec(src)) !== null) {
        const fullId = match[2]; // e.g. "messengerConversations.9501074288a12f3ae9e3c7ea243bccbf"
        const opName = fullId.split('.')[0]; // e.g. "messengerConversations"
        const regName = match[3]; // e.g. "find-conversations-by-category-v2"

        // Store by registration name (most specific, for moduleName disambiguation)
        registry[regName] = fullId;

        // Store by endpoint name (first match wins)
        if (!registry[opName]) {
          registry[opName] = fullId;
        }
      }

      return registry;
    }
  }

  return null;
}

/**
 * Get queryId for a messaging GraphQL operation (webpack source only).
 *
 * Requires the browser to be on /messaging/ where webpackChunk_ember_auto_import_ is loaded.
 *
 * @param operationName - Messaging operation prefix (e.g. 'messengerConversationsByCategoryQuery')
 * @param moduleName - Webpack registration name for disambiguation (e.g. 'find-conversations-by-category-v2')
 */
export function getMessagingQueryId(
  operationName: string,
  moduleName: string,
): string {
  const cacheKey = `${operationName}:${moduleName}`;
  if (queryIdCache[cacheKey]) return queryIdCache[cacheKey];

  const resolvedOp =
    MESSAGING_OPERATION_ALIASES[operationName] ?? operationName;

  if (!webpackMessagingCache) {
    webpackMessagingCache = extractMessagingQueryIdsFromWebpack() ?? {};
  }

  const wpId =
    webpackMessagingCache[moduleName] || webpackMessagingCache[resolvedOp];
  if (wpId) {
    queryIdCache[cacheKey] = wpId;
    return wpId;
  }

  throw new UpstreamError(
    `Messaging queryId not found for ${resolvedOp} (module: ${moduleName}). ` +
      `Webpack registry: ${Object.keys(webpackMessagingCache).length} entries. ` +
      `Page: ${location.pathname}. ` +
      `Navigate to /messaging/ first; messaging webpack bundles only load there.`,
  );
}

/**
 * Get queryId for a non-messaging GraphQL operation (AMD registry only).
 *
 * Requires LinkedIn's Ember GraphQL query registry. Be on
 * https://www.linkedin.com/notifications/ — a fixed path that reliably loads it.
 * NOT available on profile pages (/in/<name>/), /feed/, or /search/results/*.
 *
 * @param operationName - GraphQL operation prefix (e.g. 'voyagerSocialDashComments')
 * @param moduleName - Optional AMD module name for disambiguation when an operation
 *   has multiple hashes (e.g. 'member-share-feed' for voyagerFeedDashProfileUpdates)
 */
export function getQueryId(operationName: string, moduleName?: string): string {
  const cacheKey = moduleName
    ? `${operationName}:${moduleName}`
    : operationName;
  if (queryIdCache[cacheKey]) return queryIdCache[cacheKey];

  if (typeof require === 'undefined' || !require.entries) {
    throw new UpstreamError(
      `AMD registry not available on ${location.pathname}. ${AMD_PAGE_GUIDANCE}`,
    );
  }

  if (!amdRegistryCache) {
    amdRegistryCache = extractAllQueryIdsFromAMD();
  }

  const id =
    (moduleName && amdRegistryCache[moduleName]) ||
    amdRegistryCache[operationName];
  if (id) {
    queryIdCache[cacheKey] = id;
    return id;
  }

  throw new UpstreamError(
    `QueryId not found for ${operationName}${moduleName ? ` (module: ${moduleName})` : ''}. ` +
      `AMD registry: ${Object.keys(amdRegistryCache).length} entries. ` +
      `Page: ${location.pathname}.`,
  );
}

/**
 * Build REST search URL for LinkedIn's search/dash/clusters endpoint.
 * This endpoint does NOT require queryId discovery.
 */
function buildSearchRestUrl(opts: {
  origin: string;
  keywords?: string;
  queryParameters: Record<string, string[]>;
  start: number;
  count: number;
}): string {
  const qp = Object.entries(opts.queryParameters)
    .map(([k, v]) => `${k}:List(${v.join(',')})`)
    .join(',');

  const parts: string[] = [];
  if (opts.keywords) parts.push(`keywords:${opts.keywords}`);
  parts.push('flagshipSearchIntent:SEARCH_SRP');
  parts.push(`queryParameters:(${qp})`);

  return `/voyager/api/search/dash/clusters?decorationId=com.linkedin.voyager.dash.deco.search.SearchClusterCollection-175&origin=${opts.origin}&q=all&query=(${parts.join(',')})&start=${opts.start}&count=${opts.count}`;
}

interface RestSearchResponse {
  data?: {
    paging?: { total?: number; count?: number; start?: number };
    metadata?: { totalResultCount?: number };
  };
  included?: Array<{
    $type?: string;
    entityUrn?: string;
    trackingUrn?: string;
    title?: { text?: string };
    primarySubtitle?: { text?: string };
    secondarySubtitle?: { text?: string };
    badgeText?: { text?: string };
    navigationUrl?: string;
    image?: {
      attributes?: Array<{
        detailDataUnion?: {
          nonEntityCompanyLogo?: {
            vectorImage?: {
              rootUrl?: string;
              artifacts?: Array<{
                fileIdentifyingUrlPathSegment?: string;
                width?: number;
              }>;
            };
          };
        };
      }>;
    };
  }>;
}

/**
 * Search via LinkedIn REST endpoint (no queryId required).
 * Returns people search results parsed from the included array.
 */
export async function searchViaRest(
  csrf: string,
  opts: {
    origin: string;
    keywords?: string;
    queryParameters: Record<string, string[]>;
    start: number;
    count: number;
  },
): Promise<{ results: SearchPeopleOutput['results']; total?: number }> {
  const resp = await searchRestFetch(csrf, opts);

  const results: SearchPeopleOutput['results'] = [];
  if (resp.included) {
    for (const e of resp.included) {
      if (!e.$type?.includes('EntityResult') || !e.title?.text) continue;

      const vanityNameMatch = e.navigationUrl?.match(/\/in\/([^/?]+)/);
      const vanityName = vanityNameMatch?.[1];

      const badgeText = e.badgeText?.text;
      let connectionDegree: string | undefined;
      if (badgeText) {
        if (badgeText.includes('1st')) connectionDegree = '1st';
        else if (badgeText.includes('2nd')) connectionDegree = '2nd';
        else if (badgeText.includes('3rd')) connectionDegree = '3rd+';
      }

      let memberId = e.entityUrn?.split(':').pop();
      if (memberId?.includes(',')) {
        memberId = memberId.split(',')[0];
      }

      results.push({
        memberId,
        name: e.title.text,
        headline: e.primarySubtitle?.text,
        location: e.secondarySubtitle?.text,
        vanityName,
        profileUrl: vanityName
          ? `https://www.linkedin.com/in/${vanityName}`
          : undefined,
        connectionDegree,
      });
    }
  }

  // Filter out results without memberId (unusable for downstream operations)
  const validResults = results.filter((p) => p.memberId);

  // Deduplicate by memberId
  const seen = new Set<string>();
  const uniqueResults = validResults.filter((p) => {
    const key = p.memberId!;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    results: uniqueResults.slice(0, opts.count),
    total: resp.data?.metadata?.totalResultCount,
  };
}

/**
 * Raw REST search fetch - returns the full response for custom parsing.
 * Used by company search which needs different field extraction.
 */
export async function searchRestFetch(
  csrf: string,
  opts: {
    origin: string;
    keywords?: string;
    queryParameters: Record<string, string[]>;
    start: number;
    count: number;
  },
): Promise<RestSearchResponse> {
  return linkedinFetch<RestSearchResponse>(csrf, buildSearchRestUrl(opts));
}

/**
 * Search via LinkedIn GraphQL endpoint using voyagerSearchDashClusters.
 * Required for connectionOf searches with network:S (2nd-degree); the REST
 * endpoint ignores the S filter and only returns mutual connections.
 */
export async function searchViaGraphQL(
  csrf: string,
  opts: {
    origin: string;
    keywords?: string;
    queryParameters: Record<string, string[]>;
    start: number;
    count: number;
  },
): Promise<{ results: SearchPeopleOutput['results']; total?: number }> {
  const queryId = getQueryId(
    'voyagerSearchDashClusters',
    'search-cluster-collection',
  );

  // Build key-value List pairs: (key:network,value:List(F,S))
  const kvPairs = Object.entries(opts.queryParameters)
    .map(([k, v]) => `(key:${k},value:List(${v.join(',')}))`)
    .join(',');

  const queryParts: string[] = [
    'flagshipSearchIntent:SEARCH_SRP',
    `queryParameters:List(${kvPairs})`,
    'includeFiltersInResponse:false',
  ];
  if (opts.keywords) {
    queryParts.push(`keywords:${encodeURIComponent(opts.keywords)}`);
  }

  const variables = `(start:${opts.start},count:${opts.count},origin:${opts.origin},query:(${queryParts.join(',')}))`;

  const resp = await linkedinFetch<RestSearchResponse>(
    csrf,
    `/voyager/api/graphql?includeWebMetadata=true&variables=${variables}&queryId=${queryId}`,
  );

  const results: SearchPeopleOutput['results'] = [];
  if (resp.included) {
    for (const e of resp.included) {
      if (!e.$type?.includes('EntityResult') || !e.title?.text) continue;

      const vanityNameMatch = e.navigationUrl?.match(/\/in\/([^/?]+)/);
      const vanityName = vanityNameMatch?.[1];

      const badgeText = e.badgeText?.text;
      let connectionDegree: string | undefined;
      if (badgeText) {
        if (badgeText.includes('1st')) connectionDegree = '1st';
        else if (badgeText.includes('2nd')) connectionDegree = '2nd';
        else if (badgeText.includes('3rd')) connectionDegree = '3rd+';
      }

      let memberId = e.entityUrn?.split(':').pop();
      if (memberId?.includes(',')) {
        memberId = memberId.split(',')[0];
      }

      results.push({
        memberId,
        name: e.title.text,
        headline: e.primarySubtitle?.text,
        location: e.secondarySubtitle?.text,
        vanityName,
        profileUrl: vanityName
          ? `https://www.linkedin.com/in/${vanityName}`
          : undefined,
        connectionDegree,
      });
    }
  }

  const validResults = results.filter((p) => p.memberId);
  const seen = new Set<string>();
  const uniqueResults = validResults.filter((p) => {
    const key = p.memberId!;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Total from GraphQL response is nested differently
  const searchData = (resp as Record<string, unknown>).data as
    | { data?: { searchDashClustersByAll?: { paging?: { total?: number } } } }
    | undefined;
  const total =
    searchData?.data?.searchDashClustersByAll?.paging?.total ??
    resp.data?.metadata?.totalResultCount;

  return {
    results: uniqueResults.slice(0, opts.count),
    total,
  };
}

/**
 * Resolve vanity name to member ID using REST API (no queryId needed).
 */
export async function resolveVanityNameToMemberId(
  csrf: string,
  vanityName: string,
): Promise<string | null> {
  const resp = await linkedinFetch<{
    data?: {
      entityUrn?: string;
      miniProfile?: string;
      '*miniProfile'?: string;
    };
    included?: Array<{ entityUrn?: string }>;
  }>(csrf, `/voyager/api/identity/normalizedProfiles/${vanityName}`);

  // Check for member ID in response
  const entityUrn =
    resp.data?.entityUrn ??
    resp.data?.miniProfile ??
    resp.data?.['*miniProfile'];
  if (
    entityUrn &&
    (entityUrn.includes('fsd_profile:') ||
      entityUrn.includes('fs_miniProfile:') ||
      entityUrn.includes('fs_normalized_profile:'))
  ) {
    const parts = entityUrn.split(':');
    return parts.length > 0 ? parts[parts.length - 1] : null;
  }

  // Check included array
  for (const entity of resp.included || []) {
    if (
      entity.entityUrn &&
      (entity.entityUrn.includes('fsd_profile:') ||
        entity.entityUrn.includes('fs_normalized_profile:'))
    ) {
      const parts = entity.entityUrn.split(':');
      return parts.length > 0 ? parts[parts.length - 1] : null;
    }
  }

  return null;
}

/**
 * Activity type → AMD module name mapping.
 * Each activity tab uses a different GraphQL module under voyagerFeedDashProfileUpdates.
 */
const ACTIVITY_MODULE_NAMES: Record<string, string> = {
  posts: 'get-feed-dash-profile-updates-by-member-share-feed',
  comments: 'get-feed-dash-profile-updates-by-member-comments',
  reactions: 'get-feed-dash-profile-updates-by-member-reactions',
  articles: 'get-feed-dash-profile-updates-by-document',
  feed: 'get-feed-dash-profile-updates-by-member-feed',
};

/**
 * Get the queryId for a profile activity type.
 * Uses AMD module name disambiguation since voyagerFeedDashProfileUpdates has 5+ variants.
 */
export function getActivityQueryId(
  activityType: 'posts' | 'comments' | 'reactions' | 'articles' | 'feed',
): string {
  const moduleName = ACTIVITY_MODULE_NAMES[activityType];
  if (!moduleName) {
    throw new ContractDrift(`Unknown activity type: ${activityType}`);
  }
  return getQueryId('voyagerFeedDashProfileUpdates', moduleName);
}
