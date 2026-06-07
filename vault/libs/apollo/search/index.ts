/**
 * Apollo Search Module
 *
 * People and company search, view, and selection operations.
 * Includes searchPeople, searchCompanies, viewPerson, selectPeople,
 * selectCompanies, and viewCompany.
 */

import { Validation, throwForStatus } from '@vallum/_runtime';

import type {
  SearchCompaniesOutput,
  SearchPeopleOutput,
  SelectCompaniesOutput,
  SelectPeopleOutput,
  ViewCompanyOutput,
} from '../schemas';

interface SearchParams {
  page: number;
  per_page: number;
  display_mode: string;
  finder_version: number;
  sort_ascending: boolean;
  sort_by_field: string;
  context: string;
  show_suggestions?: boolean;
  cacheKey: number;
  prospected_by_current_team?: string[];
  q_keywords?: string;
  included_organization_keyword_fields?: string[];
}

// Cached set of valid technology UIDs; populated on first validation call per page load
let cachedTechUids: Set<string> | null = null;

/**
 * Validate that technology UIDs exist in Apollo's database.
 * Fetches all technology tags (cached after first call) and throws if any UIDs are invalid.
 */
async function validateTechUids(uids: string[]): Promise<void> {
  if (uids.length === 0) return;

  if (!cachedTechUids) {
    const base = window.location.origin;
    const perPage = 100;
    type RawTag = { uid?: string };

    const firstResp = await fetch(
      `${base}/api/v1/tags/search?kind=technology&per_page=${perPage}&page=1`,
      { credentials: 'include' },
    );
    const firstData = await firstResp.json();
    const firstBatch: RawTag[] = firstData.tags || [];
    const allTags: RawTag[] = [...firstBatch];

    if (firstBatch.length === perPage) {
      const pageNums = Array.from({ length: 24 }, (_, i) => i + 2);
      const results = await Promise.all(
        pageNums.map((page) =>
          fetch(
            `${base}/api/v1/tags/search?kind=technology&per_page=${perPage}&page=${page}`,
            { credentials: 'include' },
          ).then((r) => r.json()),
        ),
      );
      for (const data of results) {
        const batch: RawTag[] = data.tags || [];
        if (batch.length > 0) allTags.push(...batch);
      }
    }

    cachedTechUids = new Set(
      allTags.map((t) => t.uid).filter((uid): uid is string => !!uid),
    );
  }

  const invalid = uids.filter((uid) => !cachedTechUids!.has(uid));
  if (invalid.length > 0) {
    throw new Validation(
      `Invalid technology UIDs: ${invalid.join(', ')}. Use searchFilterTags({ kind: "technology", query: "..." }) to find valid UIDs.`,
    );
  }
}

/**
 * If filters contain technology UID fields, validate them.
 */
async function validateFilters(
  filters: Record<string, unknown>,
): Promise<void> {
  const techUids = filters.currently_using_any_of_technology_uids;
  const notTechUids = filters.not_currently_using_any_of_technology_uids;
  const allUids: string[] = [];
  if (Array.isArray(techUids)) allUids.push(...techUids);
  if (Array.isArray(notTechUids)) allUids.push(...notTechUids);
  if (allUids.length > 0) await validateTechUids(allUids);
}

/**
 * Search people by keyword and filters.
 * Returns both net-new people and saved contacts based on mode.
 */
export async function searchPeople(opts: {
  keyword?: string;
  mode?: 'total' | 'net-new' | 'saved';
  page?: number;
  perPage?: number;
  filters?: Record<string, unknown>;
}): Promise<SearchPeopleOutput> {
  const {
    keyword = '',
    mode = 'total',
    page = 1,
    perPage = 25,
    filters = {},
  } = opts;

  // Apollo silently returns 0 results when per_page exceeds 25
  const safePage = Math.min(perPage, 25);

  // Validate mode
  if (!['total', 'net-new', 'saved'].includes(mode)) {
    throw new Validation(
      `Invalid mode: ${mode}. Valid modes: total, net-new, saved`,
    );
  }

  // Validate technology UIDs; Apollo silently ignores invalid ones
  await validateFilters(filters);

  const searchParams: SearchParams = {
    page: page,
    per_page: safePage,
    display_mode: 'explorer_mode',
    finder_version: 2,
    sort_ascending: false,
    sort_by_field: 'recommendations_score',
    context: 'people-index-page',
    show_suggestions: false,
    cacheKey: Date.now(),
    ...filters,
  };

  // Apply mode filter
  if (mode === 'net-new') {
    searchParams.prospected_by_current_team = ['no'];
  } else if (mode === 'saved') {
    searchParams.prospected_by_current_team = ['yes'];
  }

  // Add keyword if provided
  if (keyword) {
    searchParams.q_keywords = keyword;
    searchParams.included_organization_keyword_fields = ['tags', 'name'];
  }

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/mixed_people/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(searchParams),
  });

  return await response.json();
}

/**
 * Search companies/organizations by keyword and filters.
 * Returns both net-new organizations and saved accounts based on mode.
 */
export async function searchCompanies(opts: {
  keyword?: string;
  mode?: 'total' | 'net-new' | 'saved';
  page?: number;
  perPage?: number;
  filters?: Record<string, unknown>;
}): Promise<SearchCompaniesOutput> {
  const {
    keyword = '',
    mode = 'total',
    page = 1,
    perPage = 25,
    filters = {},
  } = opts;

  // Apollo silently returns 0 results when per_page exceeds 25
  const safePage = Math.min(perPage, 25);

  // Validate mode
  if (!['total', 'net-new', 'saved'].includes(mode)) {
    throw new Validation(
      `Invalid mode: ${mode}. Valid modes: total, net-new, saved`,
    );
  }

  // Validate technology UIDs; Apollo silently ignores invalid ones
  await validateFilters(filters);

  const searchParams: Record<string, unknown> = {
    page: page,
    per_page: safePage,
    display_mode: 'explorer_mode',
    finder_version: 2,
    sort_ascending: false,
    sort_by_field: 'recommendations_score',
    context: 'organization-index-page',
    show_suggestions: false,
    cacheKey: Date.now(),
    ...filters,
  };

  // Apply mode filter
  if (mode === 'net-new') {
    searchParams.prospected_by_current_team = ['no'];
  } else if (mode === 'saved') {
    searchParams.prospected_by_current_team = ['yes'];
  }

  // Add keyword if provided
  if (keyword) {
    searchParams.q_organization_name = keyword;
  }

  const base = window.location.origin;
  const response = await fetch(`${base}/api/v1/mixed_companies/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(searchParams),
  });

  return await response.json();
}

/**
 * Select/collect multiple people IDs from search results.
 * Returns array of person IDs and simplified person objects.
 */
export async function selectPeople(
  opts: {
    filters?: Record<string, unknown>;
    maxCount?: number;
    perPage?: number;
  } = {},
): Promise<SelectPeopleOutput> {
  const { filters = {}, maxCount = 25, perPage = 25 } = opts;

  // Apollo silently returns 0 results when per_page exceeds 25
  const safePerPage = Math.min(perPage, 25);

  // Validate technology UIDs; Apollo silently ignores invalid ones
  await validateFilters(filters);

  const seenIds = new Set<string>();
  const collectedIds: string[] = [];
  const collectedPeople: Array<{
    id: string;
    name: string;
    title: string;
    company: string;
  }> = [];
  let page = 1;

  while (collectedIds.length < maxCount) {
    const remaining = maxCount - collectedIds.length;
    const fetchCount = Math.min(remaining, safePerPage);

    const searchParams: Record<string, unknown> = {
      page: page,
      per_page: fetchCount,
      display_mode: 'explorer_mode',
      finder_version: 2,
      context: 'people-index-page',
      cacheKey: Date.now(),
      ...filters,
    };

    const base = window.location.origin;
    const response = await fetch(`${base}/api/v1/mixed_people/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(searchParams),
    });
    const data = await response.json();

    const results: Array<{
      id: string;
      name: string;
      title: string;
      organization_name: string;
      organization?: { name?: string };
    }> =
      data.people && data.people.length > 0
        ? data.people
        : data.contacts
          ? data.contacts
          : [];

    if (results.length === 0) break;

    results.forEach((p) => {
      if (collectedIds.length < maxCount && !seenIds.has(p.id)) {
        seenIds.add(p.id);
        collectedIds.push(p.id);
        collectedPeople.push({
          id: p.id,
          name: p.name || '',
          title: p.title || '',
          company: p.organization_name || p.organization?.name || '',
        });
      }
    });

    const totalPages = data.pagination ? data.pagination.total_pages : 1;
    if (page >= totalPages) break;
    page++;
  }

  return {
    ids: collectedIds,
    people: collectedPeople,
    totalCollected: collectedIds.length,
  };
}

/**
 * Select/collect multiple company IDs from search results.
 * Returns array of company IDs and simplified company objects.
 */
export async function selectCompanies(
  opts: {
    filters?: Record<string, unknown>;
    maxCount?: number;
    perPage?: number;
  } = {},
): Promise<SelectCompaniesOutput> {
  const { filters = {}, maxCount = 25, perPage = 25 } = opts;

  // Validate technology UIDs; Apollo silently ignores invalid ones
  await validateFilters(filters);

  const collectedIds: string[] = [];
  const collectedCompanies: Array<{
    id: string;
    name: string;
    website: string;
    industry: string;
  }> = [];
  let page = 1;

  while (collectedIds.length < maxCount) {
    const remaining = maxCount - collectedIds.length;
    const fetchCount = Math.min(remaining, perPage);

    const searchParams: Record<string, unknown> = {
      page: page,
      per_page: fetchCount,
      display_mode: 'explorer_mode',
      finder_version: 2,
      context: 'organization-index-page',
      cacheKey: Date.now(),
      ...filters,
    };

    const base = window.location.origin;
    const response = await fetch(`${base}/api/v1/mixed_companies/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(searchParams),
    });
    const data = await response.json();

    const results: Array<{
      id: string;
      name: string;
      website_url: string;
      industry: string;
    }> =
      data.organizations && data.organizations.length > 0
        ? data.organizations
        : data.accounts
          ? data.accounts
          : [];

    if (results.length === 0) break;

    results.forEach((c) => {
      if (collectedIds.length < maxCount && c.id) {
        collectedIds.push(c.id);
        collectedCompanies.push({
          id: c.id,
          name: c.name,
          website: c.website_url,
          industry: c.industry,
        });
      }
    });

    const totalPages = data.pagination ? data.pagination.total_pages : 1;
    if (page >= totalPages) break;
    page++;
  }

  return {
    ids: collectedIds,
    companies: collectedCompanies,
    totalCollected: collectedIds.length,
  };
}

/**
 * View detailed information for a company/organization.
 * Can search by account ID or by name.
 */
export async function viewCompany(opts: {
  accountId?: string;
  organizationId?: string;
  searchName?: string;
}): Promise<ViewCompanyOutput> {
  const { accountId, organizationId, searchName } = opts;

  let company: unknown = null;
  const base = window.location.origin;

  if (organizationId) {
    // Direct lookup by organization ID (global org database)
    const response = await fetch(
      `${base}/api/v1/organizations/${organizationId}`,
      {
        method: 'GET',
        credentials: 'include',
      },
    );
    if (!response.ok)
      throwForStatus(response.status, await response.text().catch(() => undefined));
    const data = await response.json();
    company = data.organization;

    if (!company) {
      return {
        success: false,
        error: 'Organization not found',
        organizationId,
      };
    }
  } else if (accountId) {
    // Direct lookup by CRM account ID
    const response = await fetch(`${base}/api/v1/accounts/${accountId}`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!response.ok)
      throwForStatus(response.status, await response.text().catch(() => undefined));
    const data = await response.json();
    company = data.account;

    if (!company) {
      return {
        success: false,
        error: 'Company not found',
        accountId,
      };
    }
  } else if (searchName) {
    // Search for company by name
    const searchParams: Record<string, unknown> = {
      page: 1,
      per_page: 10,
      display_mode: 'explorer_mode',
      finder_version: 2,
      q_organization_name: searchName,
      cacheKey: Date.now(),
    };

    const response = await fetch(`${base}/api/v1/mixed_companies/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(searchParams),
    });
    const data = await response.json();

    // Get results
    let results: Array<{ name?: string }> = [];
    results = [...(data?.organizations || []), ...(data?.accounts || [])];

    if (results.length === 0) {
      return {
        success: false,
        error: 'No results found',
        searchName,
      };
    }

    // Find best match
    const nameLower = searchName.toLowerCase();
    company =
      results.find((c) => c.name && c.name.toLowerCase().includes(nameLower)) ||
      results[0];
  } else {
    return {
      success: false,
      error: 'Must provide either accountId, organizationId, or searchName',
    };
  }

  return {
    success: true,
    company: company as ViewCompanyOutput['company'],
  };
}
