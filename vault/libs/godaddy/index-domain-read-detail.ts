/**
 * GoDaddy — domain read detail.
 *
 * Per-domain settings reads (contacts, nameservers, forwarding, privacy,
 * renewal terms) and portfolio CSV export jobs, all against
 * domainsapi.godaddy.com (DCC `domainsDccApi`). Account-scoped via the
 * signed-in session's customerId; callers thread no account ids.
 *
 * The settings reads are POST `.../get*` with the INCLUDE filter envelope used
 * across the domain API. Exports are REST GET/POST on `.../domainExports`.
 */

import {
  dccFetch,
  getCustomerId,
  DOMAINS_API,
  MGNT_DCC_API,
  Validation,
  ContractDrift,
  NotFound,
} from './_shared';
import type {
  DomainExport,
  GetDomainContactsOutput,
  GetDomainNameserversOutput,
  GetDomainForwardingOutput,
  GetDomainPrivacyOutput,
  GetDomainRenewalTermsOutput,
  ListDomainExportsOutput,
  ExportDomainsOutput,
  GetDomainExportStatusOutput,
} from './schemas-domain-read-detail';

export type {
  DomainContactDetail,
  DomainContactAddress,
  DomainExport,
  ForwardingRedirect,
  GetDomainContactsOutput,
  GetDomainNameserversOutput,
  GetDomainForwardingOutput,
  GetDomainPrivacyOutput,
  GetDomainRenewalTermsOutput,
  ListDomainExportsOutput,
  ExportDomainsOutput,
  GetDomainExportStatusOutput,
} from './schemas-domain-read-detail';

// ============================================================================
// Shared helpers
// ============================================================================

function requireDomainName(fn: string, domainName: string | undefined): string {
  const trimmed = domainName?.trim();
  if (!trimmed) {
    throw new Validation(`${fn} requires a domainName.`);
  }
  return trimmed;
}

/** Customer-scoped domains base on the domain portfolio API. */
function domainsBase(version: 'v1' | 'v2' = 'v1'): string {
  return `${DOMAINS_API}/${version}/customers/${getCustomerId()}/domains`;
}

/** Single-domain INCLUDE filter envelope shared by the `.../get*` reads. */
function singleDomainFilterBody(domainName: string) {
  return {
    domainNames: [domainName],
    pagination: {
      filter: {
        domainNamesFilter: { names: [domainName], type: 'INCLUDE' as const },
      },
    },
  };
}

/**
 * Extract the per-domain payload from a `.../get*` response. The detail
 * endpoints return either the domain object directly or wrapped in a `domains`
 * array; an empty/absent body yields an empty object so callers never crash on
 * a portfolio with no matching domain.
 */
function domainBlock(
  resp: unknown,
  domainName: string,
): Record<string, unknown> {
  if (resp == null || typeof resp !== 'object') return {};
  if (Array.isArray(resp)) {
    const arr = resp as Array<Record<string, unknown>>;
    return arr.find((d) => d && d.domainName === domainName) ?? arr[0] ?? {};
  }
  const r = resp as Record<string, unknown>;
  if (Array.isArray(r.domains)) {
    const arr = r.domains as Array<Record<string, unknown>>;
    return arr.find((d) => d && d.domainName === domainName) ?? arr[0] ?? {};
  }
  return r;
}

async function fetchDomainDetail(
  endpoint: string,
  domainName: string,
): Promise<Record<string, unknown>> {
  const resp = await dccFetch<unknown>(`${domainsBase()}/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(singleDomainFilterBody(domainName)),
  });
  return domainBlock(resp, domainName);
}

// ============================================================================
// getDomainContacts
// ============================================================================

interface GetContactsResponse {
  domainsContacts?: Array<{
    domainName?: string;
    contacts?: Record<string, unknown>;
  }>;
}

export async function getDomainContacts(args: {
  domainName: string;
}): Promise<GetDomainContactsOutput> {
  const domainName = requireDomainName('getDomainContacts', args.domainName);
  const resp = await dccFetch<GetContactsResponse | null>(
    `${domainsBase()}/getContacts`,
    {
      method: 'POST',
      body: JSON.stringify(singleDomainFilterBody(domainName)),
    },
  );
  if (!resp || !resp.domainsContacts || resp.domainsContacts.length === 0) {
    throw new NotFound(
      `getDomainContacts: domain "${domainName}" was not found in this account's portfolio.`,
    );
  }
  const contacts = resp.domainsContacts[0].contacts ?? {};
  return {
    domainName,
    contacts: contacts as GetDomainContactsOutput['contacts'],
  };
}

// ============================================================================
// getDomainNameservers
// ============================================================================

export async function getDomainNameservers(args: {
  domainName: string;
}): Promise<GetDomainNameserversOutput> {
  const domainName = requireDomainName('getDomainNameservers', args.domainName);
  const block = await fetchDomainDetail('getNameservers', domainName);
  const ns = block.nameserverDomains;
  return {
    domainName,
    nameservers: Array.isArray(ns) ? (ns as string[]) : [],
  };
}

// ============================================================================
// getDomainForwarding
// ============================================================================

interface ForwardingResponse {
  redirects?: Array<Record<string, unknown>>;
  pagination?: { next?: string; previous?: string; total?: number };
}

export async function getDomainForwarding(args: {
  domainName: string;
  includeHosts?: boolean;
  pageNumber?: number;
  pageSize?: number;
}): Promise<GetDomainForwardingOutput> {
  const domainName = requireDomainName('getDomainForwarding', args.domainName);
  const customerId = getCustomerId();

  const params = new URLSearchParams();
  if (args.includeHosts) {
    params.set('includeHosts', 'true');
  } else {
    params.set('exactMatch', 'true');
  }
  if (args.pageNumber != null)
    params.set('pageNumber', String(args.pageNumber));
  if (args.pageSize != null) params.set('pageSize', String(args.pageSize));

  const url = `${MGNT_DCC_API}/v1/customers/${customerId}/domains/${encodeURIComponent(domainName)}/domainforwarding?${params}`;
  const resp = await dccFetch<ForwardingResponse>(url);

  return {
    domainName,
    redirects: (resp?.redirects ??
      []) as GetDomainForwardingOutput['redirects'],
    pagination: {
      total: resp?.pagination?.total ?? 0,
      next: resp?.pagination?.next,
      previous: resp?.pagination?.previous,
    },
  };
}

// ============================================================================
// getDomainPrivacy
// ============================================================================

export async function getDomainPrivacy(args: {
  domainName: string;
}): Promise<GetDomainPrivacyOutput> {
  const domainName = requireDomainName('getDomainPrivacy', args.domainName);

  // Verify domain ownership: getContacts returns 204 (null) for domains not in this portfolio.
  const ownershipCheck = await dccFetch<GetContactsResponse | null>(
    `${domainsBase()}/getContacts`,
    {
      method: 'POST',
      body: JSON.stringify(singleDomainFilterBody(domainName)),
    },
  );
  if (!ownershipCheck?.domainsContacts?.length) {
    throw new NotFound(
      `getDomainPrivacy: domain "${domainName}" was not found in this account's portfolio.`,
    );
  }

  const block = await fetchDomainDetail('getPrivacyEmailSettings', domainName);
  return {
    domainName,
    privacy: block as unknown as GetDomainPrivacyOutput['privacy'],
  };
}

// ============================================================================
// getDomainRenewalTerms
// ============================================================================

interface RenewalTermsResponse {
  domainRenewals?: Array<Record<string, unknown>>;
}

export async function getDomainRenewalTerms(args: {
  domainName: string;
  domainStates?: Array<string>;
}): Promise<GetDomainRenewalTermsOutput> {
  const domainName = requireDomainName(
    'getDomainRenewalTerms',
    args.domainName,
  );
  const states = args.domainStates ?? ['ACTIVE', 'REDEMPTION'];
  const resp = await dccFetch<RenewalTermsResponse>(
    `${domainsBase()}/getRenewalTerms`,
    {
      method: 'POST',
      body: JSON.stringify({
        domainNamesFilter: { names: [domainName], type: 'INCLUDE' },
        domainStates: states,
      }),
    },
  );
  const renewals = resp?.domainRenewals ?? [];
  if (renewals.length === 0) {
    throw new NotFound(
      `getDomainRenewalTerms: domain "${domainName}" was not found in this account's portfolio.`,
    );
  }
  const entry =
    renewals.find((r) => r.domainName === domainName) ?? renewals[0];
  return {
    domainName,
    renewalTerms:
      entry as unknown as GetDomainRenewalTermsOutput['renewalTerms'],
  };
}

// ============================================================================
// Domain exports
// ============================================================================

interface ExportListResponse {
  exportSummaries?: Array<Record<string, unknown>>;
  total?: number;
}

function extractExportItems(
  resp: ExportListResponse | null | undefined,
): Array<Record<string, unknown>> {
  if (!resp) return [];
  return resp.exportSummaries ?? [];
}

function toDomainExport(
  item: Record<string, unknown>,
  fallbackId?: string,
): DomainExport {
  return {
    ...item,
    exportId: String(item.exportId ?? item.id ?? fallbackId ?? ''),
  } as unknown as DomainExport;
}

// ============================================================================
// listDomainExports
// ============================================================================

export async function listDomainExports(
  args: {
    count?: number;
    sortColumn?: string;
    sortDirection?: 'ASC' | 'DESC';
  } = {},
): Promise<ListDomainExportsOutput> {
  if (args.count === 0) {
    return { exports: [], total: 0 };
  }

  const customerId = getCustomerId();
  const defaultPageSize = 50;
  const sortColumn = args.sortColumn ?? 'CreateDate';
  const sortDirection = args.sortDirection ?? 'DESC';
  const all: Array<Record<string, unknown>> = [];
  let total: number | undefined;

  for (let page = 1; ; page += 1) {
    const remaining = args.count != null ? args.count - all.length : undefined;
    const pageSize =
      remaining != null
        ? Math.min(remaining, defaultPageSize)
        : defaultPageSize;
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortColumn,
      sortDirection,
    });
    const resp = await dccFetch<ExportListResponse>(
      `${DOMAINS_API}/v1/customers/${customerId}/domainExports?${params}`,
    );
    if (resp) total = resp.total ?? total;
    const items = extractExportItems(resp);
    all.push(...items);
    if (items.length < pageSize) break;
    if (args.count != null && all.length >= args.count) break;
  }

  return {
    exports: all.map((item) => toDomainExport(item)),
    total: total ?? all.length,
  };
}

// ============================================================================
// exportDomains
// ============================================================================

export async function exportDomains(
  args: {
    exportType?: string;
    format?: string;
    compression?: string;
    includeAuthCode?: boolean;
    name?: string;
    columns?: string[];
  } = {},
): Promise<ExportDomainsOutput> {
  const customerId = getCustomerId();
  const exportName =
    args.name ?? `export-${new Date().toISOString().slice(0, 10)}`;
  const exportType = args.exportType ?? 'FilteredDomainsExport';
  const defaultColumns =
    exportType === 'TransferDomainsExport'
      ? ['CREATE_DATE', 'DOMAIN_NAME', 'STATUS', 'TLD', 'TRANSFER_TYPE']
      : ['_ALL'];
  const body: Record<string, unknown> = {
    exportType,
    format: args.format ?? 'CSV',
    compression: args.compression ?? 'NONE',
    includeAuthCode: args.includeAuthCode ?? false,
    name: exportName,
    columns: args.columns ?? defaultColumns,
    filter: { domainNamesFilter: { names: [], type: 'INCLUDE' } },
  };

  const resp = await dccFetch<{
    exportId?: number | string;
    id?: number | string;
  }>(`${DOMAINS_API}/v1/customers/${customerId}/domainExports`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const exportId = String(resp?.exportId ?? resp?.id ?? '');
  if (!exportId || exportId === 'undefined') {
    throw new ContractDrift('Domain export create returned no exportId.');
  }
  return { exportId };
}

// ============================================================================
// getDomainExportStatus
// ============================================================================

export async function getDomainExportStatus(args: {
  exportId: string;
}): Promise<GetDomainExportStatusOutput> {
  const exportId = args.exportId?.trim();
  if (!exportId) {
    throw new Validation('getDomainExportStatus requires an exportId.');
  }

  const customerId = getCustomerId();
  const resp = await dccFetch<Record<string, unknown>>(
    `${DOMAINS_API}/v1/customers/${customerId}/domainExports/${encodeURIComponent(exportId)}`,
  );

  return { export: toDomainExport(resp ?? {}, exportId) };
}
