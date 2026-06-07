import type {
  SearchProspectsInput,
  SearchProspectsOutput,
  ListSavedSearchesInput,
  ListSavedSearchesOutput,
  ListRecentSearchesInput,
  ListRecentSearchesOutput,
} from './schemas';
import {
  ProspectContactSchema,
  SavedSearchSchema,
  RecentSearchSchema,
} from './schemas';
import { z } from 'zod';
import { throwForStatus } from '@vallum/_runtime';
import { apiFetch } from '../helpers';

const PROSPECT_API_BASE = 'https://prospect-api.smartlead.ai';

// ============================================================================
// Internal types
// ============================================================================

type ProspectContact = z.infer<typeof ProspectContactSchema>;
type SavedSearch = z.infer<typeof SavedSearchSchema>;
type RecentSearch = z.infer<typeof RecentSearchSchema>;

interface ProspectSearchResponse {
  success: boolean;
  data?: {
    list?: ProspectContact[];
    total_count?: number | null;
    scroll_id?: string | null;
    filter_id?: string | null;
  };
}

// ============================================================================
// searchProspects
// ============================================================================

/**
 * Search the SmartProspect contact database with filters.
 * Returns contacts WITHOUT real emails by default — emails require explicit unlocking (costs credits).
 */
export async function searchProspects(
  params: SearchProspectsInput,
): Promise<SearchProspectsOutput> {
  const { token, offset = 0, limit = 25, scrollId, ...filters } = params;

  const body: Record<string, unknown> = { ...filters, offset, limit };
  if (scrollId) {
    body.scroll_id = scrollId;
  }

  const res = await apiFetch(
    token,
    '/api/search-email-leads/search-contacts',
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    PROSPECT_API_BASE,
  );

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as ProspectSearchResponse;

  const contacts: ProspectContact[] = data.data?.list ?? [];
  const total: number = data.data?.total_count ?? contacts.length;
  const nextScrollId: string | null = data.data?.scroll_id ?? null;

  return { contacts, total, scrollId: nextScrollId };
}

// ============================================================================
// listSavedSearches
// ============================================================================

/**
 * List the user's saved SmartProspect searches.
 */
export async function listSavedSearches(
  params: ListSavedSearchesInput,
): Promise<ListSavedSearchesOutput> {
  const { token } = params;

  const qs = new URLSearchParams({ limit: '100', offset: '0' });
  const res = await apiFetch(
    token,
    `/api/search-email-leads/search-filters/saved-searches?${qs}`,
    {},
    PROSPECT_API_BASE,
  );

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as {
    success: boolean;
    data: { savedSearches: SavedSearch[]; totalCount: number };
  };
  const searches = data.data?.savedSearches ?? [];

  return { searches, total: data.data?.totalCount ?? searches.length };
}

// ============================================================================
// listRecentSearches
// ============================================================================

/**
 * List the user's recently executed SmartProspect searches.
 */
export async function listRecentSearches(
  params: ListRecentSearchesInput,
): Promise<ListRecentSearchesOutput> {
  const { token } = params;

  const qs = new URLSearchParams({ limit: '100', offset: '0' });
  const res = await apiFetch(
    token,
    `/api/search-email-leads/search-filters/recent-searches?${qs}`,
    {},
    PROSPECT_API_BASE,
  );

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  const data = (await res.json()) as {
    success: boolean;
    data: { recentSearches: RecentSearch[]; totalCount: number };
  };
  const searches = data.data?.recentSearches ?? [];

  return { searches, total: data.data?.totalCount ?? searches.length };
}
