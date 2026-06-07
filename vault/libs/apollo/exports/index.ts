/**
 * Apollo Exports Module
 *
 * Free and credit-based data extraction from Apollo people search results.
 */

import { ContractDrift, RateLimited, UpstreamError, Validation, throwForStatus } from '@vallum/_runtime';

import type {
  FreeExportPeopleSearchOutput,
  ExportPeopleSearchOutput,
  ExportContactsToCsvOutput,
  ListExportsOutput,
} from '../schemas';

import { download, save } from '../../files';

type PersonResult = {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  headline?: string;
  linkedin_url?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  seniority?: string;
  departments?: string[];
  functions?: string[];
  email_status?: string;
  email_domain_catchall?: boolean;
  organization_name?: string;
  organization?: {
    name?: string;
    website_url?: string;
    linkedin_url?: string;
    phone?: string;
    industry?: string;
    founded_year?: number;
    estimated_num_employees?: number;
    primary_domain?: string;
    sic_codes?: string[];
    naics_codes?: string[];
    organization_headcount_six_month_growth?: number;
    organization_headcount_twelve_month_growth?: number;
    organization_headcount_twenty_four_month_growth?: number;
    publicly_traded_symbol?: string;
    publicly_traded_exchange?: string;
  };
  employment_history?: Array<{ start_date?: string; current?: boolean }>;
  certifications?: unknown[];
};

function extractResults(
  payload: Record<string, unknown>,
  mode: string,
): PersonResult[] {
  if (mode === 'saved') return (payload?.contacts as PersonResult[]) || [];
  if (mode === 'net-new') return (payload?.people as PersonResult[]) || [];
  return [
    ...((payload?.people as PersonResult[]) || []),
    ...((payload?.contacts as PersonResult[]) || []),
  ];
}

function toExportRow(p: PersonResult) {
  const org = p.organization || {};
  return {
    first_name: p.first_name || '',
    last_name: p.last_name || '',
    name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
    title: p.title || '',
    headline: p.headline || '',
    seniority: p.seniority || '',
    departments: (p.departments || []).join('; '),
    linkedin_url: p.linkedin_url || '',
    city: p.city || '',
    state: p.state || '',
    country: p.country || '',
    postal_code: p.postal_code || '',
    email_status: p.email_status || '',
    company: p.organization_name || org.name || '',
    company_website: org.website_url || '',
    company_linkedin: org.linkedin_url || '',
    company_phone: org.phone || '',
    company_industry: org.industry || '',
    company_domain: org.primary_domain || '',
    company_employees:
      org.estimated_num_employees != null
        ? String(org.estimated_num_employees)
        : '',
    company_founded_year:
      org.founded_year != null ? String(org.founded_year) : '',
    company_headcount_growth_6m:
      org.organization_headcount_six_month_growth != null
        ? String(org.organization_headcount_six_month_growth)
        : '',
    company_headcount_growth_12m:
      org.organization_headcount_twelve_month_growth != null
        ? String(org.organization_headcount_twelve_month_growth)
        : '',
    company_headcount_growth_24m:
      org.organization_headcount_twenty_four_month_growth != null
        ? String(org.organization_headcount_twenty_four_month_growth)
        : '',
    company_sic_codes: (org.sic_codes || []).join('; '),
    company_naics_codes: (org.naics_codes || []).join('; '),
    company_ticker: org.publicly_traded_symbol || '',
    company_exchange: org.publicly_traded_exchange || '',
    current_role_start:
      (p.employment_history || []).find((e) => e.current)?.start_date || '',
    certifications_count: String((p.certifications || []).length),
  };
}

function linkedInToCsv(rows: ReturnType<typeof toExportRow>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]).join(',');
  const csvRows = rows.map((r) =>
    Object.values(r)
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  return [headers, ...csvRows].join('\n');
}

function linkedInToJson(rows: ReturnType<typeof toExportRow>[]): string {
  return JSON.stringify(rows, null, 2);
}

/**
 * Free export of people search results to CSV or JSON file. No credits consumed.
 */
export async function freeExportPeopleSearch(
  opts: {
    company?: string;
    titles?: string[];
    keywords?: string;
    locations?: string[];
    filters?: Record<string, unknown>;
    mode?: 'total' | 'net-new' | 'saved';
    limit?: number;
    startPage?: number;
    format?: 'csv' | 'json';
  } = {},
): Promise<FreeExportPeopleSearchOutput> {
  const {
    company,
    titles = [],
    keywords,
    locations = [],
    filters,
    mode = 'total',
    limit = 100,
    startPage = 1,
    format = 'csv',
  } = opts;

  if (!['total', 'net-new', 'saved'].includes(mode)) {
    throw new Validation(
      `Invalid mode: ${mode}. Valid modes: total, net-new, saved`,
    );
  }

  const base = window.location.origin;
  const perPage = 25;
  const maxPages = Math.ceil(limit / perPage);
  const allResults: PersonResult[] = [];
  let totalAvailable = 0;
  let lastPage = startPage - 1;

  for (let i = 0; i < maxPages; i++) {
    const page = startPage + i;
    const searchParams: Record<string, unknown> = {
      page,
      per_page: perPage,
      display_mode: 'explorer_mode',
      finder_version: 2,
      sort_ascending: false,
      sort_by_field: 'recommendations_score',
      context: 'people-index-page',
      cacheKey: Date.now(),
      ...(filters || {}),
    };

    if (company) {
      searchParams.q_keywords = company;
      searchParams.included_organization_keyword_fields = ['name'];
    }
    if (titles.length > 0) {
      searchParams.person_titles = titles;
    }
    if (keywords) {
      searchParams.q_keywords = searchParams.q_keywords
        ? `${searchParams.q_keywords} ${keywords}`
        : keywords;
      searchParams.included_organization_keyword_fields = ['tags', 'name'];
    }
    if (locations.length > 0) {
      searchParams.person_locations = locations;
    }
    if (mode === 'net-new') {
      searchParams.prospected_by_current_team = ['no'];
    } else if (mode === 'saved') {
      searchParams.prospected_by_current_team = ['yes'];
    }

    let payload: Record<string, unknown> | null = null;
    try {
      const response = await fetch(`${base}/api/v1/mixed_people/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(searchParams),
      });
      if (!response.ok) break;
      payload = await response.json();
    } catch {
      break; // Cloudflare challenge or parse failure
    }

    if (!payload) break;

    totalAvailable =
      (payload.pagination as { total_entries?: number })?.total_entries ??
      totalAvailable;
    const results = extractResults(payload, mode);

    if (results.length === 0) break;

    lastPage = page;
    allResults.push(...results);
    if (results.length < perPage) break;
    if (allResults.length >= limit) break;

    // 1s delay between pages
    if (i < maxPages - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const trimmed = allResults.slice(0, limit);
  const rows = trimmed.map(toExportRow);

  // Format and save; include startPage in filename to avoid overwrites
  const timestamp = new Date().toISOString().slice(0, 10);
  const pageSuffix = startPage > 1 ? `-p${startPage}` : '';
  const filename = `apollo-free-export-${timestamp}${pageSuffix}.${format}`;
  const content =
    format === 'json' ? linkedInToJson(rows) : linkedInToCsv(rows);

  const fileRef = await save({
    filename: `~/Downloads/${filename}`,
    content,
  });

  return {
    exported: rows.length,
    requested: limit,
    totalAvailable,
    lastPage,
    filename,
    fileRef,
  };
}

/**
 * Export people search results with revealed emails and phones to CSV or JSON file.
 * **WARNING: This action consumes Apollo export credits!**
 * Searches for people, bulk-reveals contact info via add_to_my_prospects, then saves enriched data to a file.
 */
export async function exportPeopleSearch(args: {
  keyword?: string;
  mode?: 'total' | 'net-new' | 'saved';
  filters?: Record<string, unknown>;
  maxResults?: number;
  format?: 'csv' | 'json';
  includePhones?: boolean;
}): Promise<ExportPeopleSearchOutput> {
  const maxResults = Math.min(args.maxResults ?? 25, 100);
  const perPage = 25;
  const totalPages = Math.ceil(maxResults / perPage);
  const includePhones = args.includePhones ?? false;
  const allPersonIds: string[] = [];
  const personMap = new Map<string, Record<string, unknown>>();

  // Phase 1: Search and collect person IDs
  for (let page = 1; page <= totalPages; page++) {
    const searchParams: Record<string, unknown> = {
      page,
      per_page: perPage,
      display_mode: 'explorer_mode',
      finder_version: 2,
    };
    if (args.keyword) searchParams.q_keywords = args.keyword;
    if (args.mode === 'net-new')
      searchParams.prospected_by_current_team = ['no'];
    else if (args.mode === 'saved')
      searchParams.prospected_by_current_team = ['yes'];
    if (args.filters) Object.assign(searchParams, args.filters);

    const base = window.location.origin;
    const resp = await fetch(`${base}/api/v1/mixed_people/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(searchParams),
    });
    const payload = await resp.json();

    const people = payload?.people || [];
    const contacts = payload?.contacts || [];
    const results: Array<Record<string, unknown>> =
      args.mode === 'saved'
        ? contacts
        : args.mode === 'net-new'
          ? people
          : [...people, ...contacts];

    for (const p of results) {
      const id = (p.id as string) || '';
      if (id && !personMap.has(id)) {
        allPersonIds.push(id);
        personMap.set(id, p);
      }
    }

    if (results.length < perPage) break;
    if (allPersonIds.length >= maxResults) break;
  }

  const idsToReveal = allPersonIds.slice(0, maxResults);

  if (idsToReveal.length === 0) {
    throw new ContractDrift('No people found matching the search criteria.');
  }

  // Phase 2: Bulk reveal emails (and optionally phones) via add_to_my_prospects
  const batchSize = 25;
  const enrichedContacts: Array<Record<string, unknown>> = [];
  const base = window.location.origin;
  let creditsUsed = 0;

  for (let i = 0; i < idsToReveal.length; i += batchSize) {
    const batch = idsToReveal.slice(i, i + batchSize);

    const body: Record<string, unknown> = {
      entity_ids: batch,
      export_csv: true,
      run_contact_emails_waterfall: true,
      skip_fetching_people: false,
      cta_name: 'Export',
      cacheKey: Date.now(),
    };
    if (includePhones) {
      body.run_direct_dial_enrichment = true;
    }

    const response = await fetch(
      `${base}/api/v1/mixed_people/add_to_my_prospects`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      let errBody: Record<string, unknown> | undefined;
      try {
        errBody = await response.json();
      } catch {
        /* not JSON */
      }

      if (response.status === 422 && errBody?.code === 'credit_limit') {
        const remaining =
          (errBody as { num_credits_remaining?: number })
            .num_credits_remaining ?? 0;
        throw new RateLimited(
          `exportPeopleSearch: insufficient credits (need ${batch.length}, have ${remaining}). ` +
            `Reduce maxResults or ask the user to add credits in Apollo.`,
        );
      }

      const detail = errBody ? `: ${JSON.stringify(errBody)}` : '';
      throw new UpstreamError(
        `exportPeopleSearch reveal failed: ${response.status}${detail}`,
      );
    }

    const data = await response.json();
    const revealedContacts = data.contacts || [];
    enrichedContacts.push(...revealedContacts);
    creditsUsed += revealedContacts.length;

    // Wait between batches to avoid rate limiting
    if (i + batchSize < idsToReveal.length) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // Phase 3: Format output
  const format = args.format ?? 'csv';
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `apollo-export-${timestamp}.${format}`;

  let content: string;
  if (format === 'json') {
    const cleaned = enrichedContacts.map((c) => ({
      name: c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim(),
      first_name: c.first_name || '',
      last_name: c.last_name || '',
      title: c.title || '',
      company: c.organization_name || '',
      email: c.email || '',
      email_status: c.email_status || '',
      phone: (c.phone_numbers as Array<{ sanitized_number?: string }> | undefined)?.[0]?.sanitized_number || '',
      linkedin_url: c.linkedin_url || '',
      seniority: c.seniority || '',
      city: c.city || '',
      state: c.state || '',
      country: c.country || '',
    }));
    content = JSON.stringify(cleaned, null, 2);
  } else {
    const headers = [
      'Name',
      'First Name',
      'Last Name',
      'Title',
      'Company',
      'Email',
      'Email Status',
      'Phone',
      'LinkedIn',
      'Seniority',
      'City',
      'State',
      'Country',
    ];
    const rows = enrichedContacts.map((c) =>
      [
        c.name || `${c.first_name || ''} ${c.last_name || ''}`.trim(),
        c.first_name || '',
        c.last_name || '',
        c.title || '',
        c.organization_name || '',
        c.email || '',
        c.email_status || '',
        (
          c.phone_numbers as Array<{ sanitized_number?: string }> | undefined
        )?.[0]?.sanitized_number || '',
        c.linkedin_url || '',
        c.seniority || '',
        c.city || '',
        c.state || '',
        c.country || '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    content = [headers.join(','), ...rows].join('\n');
  }

  const fileRef = await save({
    filename: `~/Downloads/${filename}`,
    content,
  });

  return {
    exported: enrichedContacts.length,
    creditsUsed,
    filename,
    fileRef,
  };
}

/**
 * Export saved contacts to CSV via Apollo's native csv_exports endpoint.
 * No credits consumed; exports contacts already saved to your CRM.
 * Downloads the file via the Northlight files library (bypasses CORS on the tryapollo.io → S3 redirect chain).
 *
 * Supports two modes:
 * - listId: Export an entire list in one shot (modality: "labels")
 * - contactIds: Export specific contacts by ID (modality: "contacts")
 */
export async function exportContactsToCsv(args: {
  listId?: string;
  contactIds?: string[];
  includeGuessedEmails?: boolean;
}): Promise<ExportContactsToCsvOutput> {
  const { listId, contactIds, includeGuessedEmails = true } = args;

  if (!listId && (!contactIds || contactIds.length === 0)) {
    throw new Validation('Either listId or contactIds is required');
  }

  const base = window.location.origin;

  // Determine modality and entity_ids based on input
  const modality = listId ? 'labels' : 'contacts';
  const entity_ids = listId ? [listId] : contactIds!;

  // Create native CSV export via Apollo's csv_exports endpoint
  const resp = await fetch(`${base}/api/v1/csv_exports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      endpoint: '/csv_exports',
      entity_ids,
      email_once_done: false,
      include_guessed_emails: includeGuessedEmails,
      modality,
      cacheKey: Date.now(),
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new UpstreamError(
      `exportContactsToCsv: csv_exports failed: ${resp.status}${detail ? `: ${detail}` : ''}`,
    );
  }

  const data = await resp.json();
  // data = { id, progress, type, rows, url, credits }

  if (!data.id) {
    throw new ContractDrift(
      'exportContactsToCsv: no export ID returned from csv_exports',
    );
  }

  // Download via files lib (Node.js fetch, bypasses CORS)
  // Use same-origin URL instead of data.url (which points to tryapollo.io, a different
  // domain whose redirect chain loses cookies and returns 401)
  const downloadUrl = `${base}/api/v1/csv_exports/${data.id}/download/`;
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `apollo-contacts-export-${timestamp}.csv`;
  const fileRef = await download({ url: downloadUrl, filename });

  return {
    exported: data.rows ?? contactIds?.length ?? 0,
    filename,
    fileRef,
  };
}

/**
 * List CSV exports in Apollo with their status and metadata.
 * Uses the csv_exports/search endpoint to retrieve export history.
 */
export async function listExports(
  args: {
    page?: number;
    perPage?: number;
  } = {},
): Promise<ListExportsOutput> {
  const { page = 1, perPage = 25 } = args;
  const base = window.location.origin;

  const resp = await fetch(`${base}/api/v1/csv_exports/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      page,
      per_page: perPage,
      display_mode: 'explorer_mode',
      num_fetch_result: 1,
      cacheKey: Date.now(),
    }),
  });

  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  const data = await resp.json();
  const exports = (data.csv_exports || []).map(
    (e: Record<string, unknown>) => ({
      id: (e.id as string) || '',
      type: (e.type as string) || '',
      progress: (e.progress as number) ?? 0,
      rows: (e.rows as number) ?? 0,
      credits: (e.credits as number) ?? 0,
      createdAt: (e.created_at as string) || '',
      status: (e.progress as number) >= 1.0 ? 'completed' : 'in_progress',
    }),
  );

  return {
    exports,
    pagination: {
      page: data.pagination?.page ?? page,
      perPage: data.pagination?.per_page ?? perPage,
      totalEntries: data.pagination?.total_entries ?? 0,
      totalPages: data.pagination?.total_pages ?? 0,
    },
  };
}
