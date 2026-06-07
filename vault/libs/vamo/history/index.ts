/**
 * Vamo Search History
 */

import type {
  ListSearchHistoryInput,
  ListSearchHistoryOutput,
} from './schemas';

export async function listSearchHistory(
  args: ListSearchHistoryInput,
): Promise<ListSearchHistoryOutput> {
  const url = `/api/project/${encodeURIComponent(args.projectId)}/search-history`;
  const resp = await fetch(url, { credentials: 'include' });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `listSearchHistory ${resp.status} ${resp.statusText}: ${body.slice(0, 200)}`,
    );
  }
  return (await resp.json()) as ListSearchHistoryOutput;
}
