/**
 * GoDaddy — SSL certificates (certs.godaddy.com / bff.pcx.godaddy.com).
 *
 * The SSL surface uses the BFF API on bff.pcx.godaddy.com, authorized by
 * session cookies. These functions must run while on a certs.godaddy.com page
 * so that same-site cookie auth is in scope.
 */

import {
  ContractDrift,
  Validation,
  throwForStatus,
  paginatePage,
} from './_shared';
import type {
  ListCertificatesOutput,
  SearchCertificatesOutput,
} from './schemas-ssl';

export type {
  CertificateSummary,
  SslCredit,
  ListCertificatesOutput,
  SearchCertificatesOutput,
} from './schemas-ssl';

// ============================================================================
// Helpers
// ============================================================================

const BFF_ORIGIN = 'https://bff.pcx.godaddy.com';

const VALID_PRODUCT_TYPES = new Set([
  'BV_SSL',
  'DV_SSL',
  'DV_WILDCARD_SSL',
  'EV_SSL',
  'OV_CS',
  'OV_DS',
  'OV_SSL',
  'OV_WILDCARD_SSL',
  'UCC_DV_SSL',
  'UCC_EV_SSL',
  'UCC_OV_SSL',
  'UCC_WILDCARD_DV_SSL',
  'UCC_WILDCARD_OV_SSL',
]);

const VALID_SORT_BY = new Set([
  'CERTIFICATE_ID',
  'DOMAIN',
  'PRODUCT_TYPE',
  'VALID_START_DATE',
  'VALID_END_DATE',
  'RENEW_AVAILABLE',
  'SUBSCRIPTION_START_DATE',
  'SUBSCRIPTION_END_DATE',
]);

const PAGE_SIZE_MIN = 1;
const PAGE_SIZE_MAX = 100;

async function bffFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BFF_ORIGIN}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const truncated =
      body.length > 2000 ? body.slice(0, 2000) + '... [truncated]' : body;
    throwForStatus(
      res.status,
      `GoDaddy SSL BFF ${res.status} (${path}): ${truncated}`,
    );
  }

  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ContractDrift(
      `GoDaddy SSL BFF returned non-JSON (${path}): ${text.slice(0, 500)}`,
    );
  }
}

interface BffCertListResponse {
  totalCertCount?: number;
  currentPage?: number;
  pageSize?: number;
  certificates?: Array<Record<string, unknown>>;
}

interface BffCreditsResponse {
  subscriptions?: Array<Record<string, unknown>>;
}

/**
 * Shared list/search read using the BFF SSL API. Fetches all pages up to
 * `count` when count is set, or a single page otherwise. Credits are fetched
 * in parallel from the available-subscriptions endpoint.
 */
async function fetchCertificateList(opts: {
  domain?: string;
  productType?: string;
  sortBy?: string;
  sortDirection?: string;
  status?: string;
  count?: number;
  page?: number;
  pageSize?: number;
}): Promise<{
  certificates: Array<Record<string, unknown>>;
  credits: Array<Record<string, unknown>>;
  total: number;
}> {
  if (
    opts.productType &&
    opts.productType !== 'ALL' &&
    !VALID_PRODUCT_TYPES.has(opts.productType)
  ) {
    throw new Validation(
      `listCertificates: invalid productType "${opts.productType}". Valid values: ${[...VALID_PRODUCT_TYPES].join(', ')}.`,
    );
  }
  if (opts.sortBy && !VALID_SORT_BY.has(opts.sortBy)) {
    throw new Validation(
      `listCertificates: invalid sortBy "${opts.sortBy}". Valid values: ${[...VALID_SORT_BY].join(', ')}.`,
    );
  }

  if (opts.count === 0) {
    const creditsResp = await bffFetch<BffCreditsResponse>(
      '/api/ssl/certificates/views/available-subscriptions',
    );
    return {
      certificates: [],
      credits: creditsResp.subscriptions ?? [],
      total: 0,
    };
  }

  const rawPageSize =
    opts.pageSize ?? (opts.count != null && opts.count < 25 ? opts.count : 25);
  const resolvedPageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(PAGE_SIZE_MIN, rawPageSize),
  );

  const buildQs = (page: number) => {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('pageSize', String(resolvedPageSize));
    if (opts.domain) qs.set('domain', opts.domain);
    if (opts.productType && opts.productType !== 'ALL')
      qs.set('productType', opts.productType);
    if (opts.sortBy) qs.set('sortBy', opts.sortBy);
    if (opts.sortDirection) qs.set('sortDirection', opts.sortDirection);
    return qs.toString();
  };

  let totalCertCount: number | undefined;

  const [certs, creditsResp] = await Promise.all([
    paginatePage<Record<string, unknown>>(
      async (pageNumber) => {
        const resp = await bffFetch<BffCertListResponse>(
          `/api/ssl/certificates/views/list?${buildQs(pageNumber)}`,
        );
        if (totalCertCount == null) totalCertCount = resp.totalCertCount;
        return resp.certificates ?? [];
      },
      opts.count,
      resolvedPageSize,
    ),
    bffFetch<BffCreditsResponse>(
      '/api/ssl/certificates/views/available-subscriptions',
    ),
  ]);

  let filtered = certs;

  // Client-side status filter (BFF doesn't support server-side status filtering).
  if (opts.status && opts.status !== 'ALL') {
    filtered = filtered.filter((c) => c.status === opts.status);
  }

  return {
    certificates: filtered,
    credits: creditsResp.subscriptions ?? [],
    total: totalCertCount ?? certs.length,
  };
}

// ============================================================================
// listCertificates
// ============================================================================

export async function listCertificates(
  args: {
    status?: string;
    productType?: string;
    domain?: string;
    sortBy?: string;
    sortDirection?: string;
    page?: number;
    pageSize?: number;
    count?: number;
  } = {},
): Promise<ListCertificatesOutput> {
  return fetchCertificateList({
    status: args.status,
    productType: args.productType,
    domain: args.domain,
    sortBy: args.sortBy,
    sortDirection: args.sortDirection,
    page: args.page,
    pageSize: args.pageSize,
    count: args.count,
  });
}

// ============================================================================
// searchCertificates
// ============================================================================

export async function searchCertificates(
  args: {
    query?: string;
    status?: string;
    count?: number;
    productType?: string;
    sortBy?: string;
    sortDirection?: string;
  } = {},
): Promise<SearchCertificatesOutput> {
  return fetchCertificateList({
    domain: args.query,
    status: args.status,
    productType: args.productType,
    sortBy: args.sortBy,
    sortDirection: args.sortDirection,
    count: args.count,
  });
}
