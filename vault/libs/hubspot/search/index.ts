/**
 * HubSpot Global Search Operations
 *
 * Unified search across all CRM objects and activities.
 */

import type { GlobalSearchInput, GlobalSearchOutput } from '../schemas';
import { throwForStatus } from '@vallum/_runtime';

/**
 * Global search across all HubSpot CRM objects and activities.
 * Uses HubSpot's unified search endpoint (same as the UI search bar).
 * Best for keyword search - finds "Santander" in company names, contact emails, etc.
 */
export async function globalSearch(
  opts: GlobalSearchInput,
): Promise<GlobalSearchOutput> {
  const locale = opts.locale ?? 'en';
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 20;
  const types = opts.types ?? ['CONTACT', 'COMPANY', 'DEAL'];

  const typeParams = types.map((t) => `type=${t}`).join('&');
  const url = `/api/search-minified/v1/search?locale=${locale}&portalId=${opts.portalId}&query=${encodeURIComponent(opts.query)}&offset=${offset}&limit=${limit}&${typeParams}`;

  interface RawResult {
    resultId: string;
    properties?: Record<string, unknown>;
  }

  interface RawSection {
    resultType: string;
    results: RawResult[];
    total: number;
  }

  interface RawResponse {
    sections?: RawSection[];
    query?: string;
  }

  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'x-hubspot-csrf-hubspotapi': opts.csrf,
    },
  });

  if (!response.ok) {
    throwForStatus(response.status, await response.text().catch(() => undefined));
  }

  const data: RawResponse = await response.json();

  return {
    sections: (data.sections ?? []).map((section) => ({
      resultType:
        section.resultType as GlobalSearchOutput['sections'][0]['resultType'],
      results: section.results.map((r) => ({
        resultId: r.resultId,
        properties: r.properties ?? {},
      })),
      total: section.total,
    })),
    query: data.query ?? opts.query,
  };
}
