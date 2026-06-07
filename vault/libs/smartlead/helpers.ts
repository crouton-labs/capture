import { throwForStatus, UpstreamError } from '@vallum/_runtime';

export const API_BASE = 'https://server.smartlead.ai';
export const GQL_BASE = 'https://fe-gql.smartlead.ai';

export async function apiFetch(
  token: string,
  endpoint: string,
  options: RequestInit = {},
  baseUrl = API_BASE,
): Promise<Response> {
  const url = `${baseUrl}${endpoint}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
}

/**
 * Fetch against the SmartLead v1 public API.
 * Uses api_key query parameter instead of Bearer JWT.
 */
export async function v1ApiFetch(
  apiKey: string,
  endpoint: string,
  options: RequestInit = {},
): Promise<Response> {
  const separator = endpoint.includes('?') ? '&' : '?';
  const url = `${API_BASE}${endpoint}${separator}api_key=${encodeURIComponent(apiKey)}`;
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
}

/**
 * Execute a GraphQL mutation/query against SmartLead's Hasura endpoint.
 * Uses the same Bearer JWT as the internal REST API.
 */
export async function gqlFetch<T = unknown>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${GQL_BASE}/v1/graphql`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throwForStatus(res.status, await res.text().catch(() => undefined));
  }

  interface GqlResponse {
    data?: T;
    errors?: Array<{ message: string }>;
  }

  const json = (await res.json()) as GqlResponse;
  if (json.errors?.length) {
    throw new UpstreamError(
      `GraphQL errors: ${json.errors.map((e) => e.message).join(', ')}`,
    );
  }

  return json.data as T;
}

export function unwrapList<T>(envelope: unknown): T[] {
  if (Array.isArray(envelope)) return envelope as T[];
  if (envelope !== null && typeof envelope === 'object') {
    if ('results' in envelope) {
      return (envelope as { results?: T[] }).results ?? [];
    }
    if ('data' in envelope) {
      return unwrapList<T>((envelope as { data: unknown }).data);
    }
  }
  return [];
}

export async function paginateAll<T>(
  fetcher: (offset: number, limit: number) => Promise<T[]>,
  pageSize = 100,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;

  while (true) {
    const page = await fetcher(offset, pageSize);
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}
