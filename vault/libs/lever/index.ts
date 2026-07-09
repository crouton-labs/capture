import { ContractDrift, Validation, throwForStatus } from '@vallum/_runtime';

import type {
  GetPostingInput,
  GetPostingOutput,
  LeverPosting,
  ListPostingsInput,
  ListPostingsOutput,
} from './schemas';

export type {
  GetPostingInput,
  GetPostingOutput,
  LeverPosting,
  ListPostingsInput,
  ListPostingsOutput,
} from './schemas';

type RawObject = Record<string, unknown>;
type FilterKey = 'location' | 'team' | 'department' | 'commitment' | 'level';

const API_BASE = 'https://api.lever.co/v0/postings';
function requirePathSegment(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('/')) {
    throw new Validation(`${fieldName} must be a non-empty Lever path segment`);
  }
  return trimmed;
}

function appendFilter(params: URLSearchParams, key: FilterKey, value: unknown): string[] {
  if (typeof value === 'string') {
    params.append(key, value);
    return [value];
  }
  if (Array.isArray(value)) {
    const values = value.filter((item): item is string => typeof item === 'string');
    for (const item of values) params.append(key, item);
    return values;
  }
  return [];
}

function asObject(value: unknown): RawObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RawObject)
    : null;
}

function readString(obj: RawObject, key: string): string {
  const value = obj[key];
  return typeof value === 'string' ? value : '';
}

function readNullableString(obj: RawObject, key: string): string | null {
  const value = obj[key];
  return typeof value === 'string' ? value : null;
}

function readNullableNumber(obj: RawObject, key: string): number | null {
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringArray(obj: RawObject, key: string): string[] {
  const value = obj[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function htmlToPlain(html: string): string {
  if (!html) return '';
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent ?? '').replace(/\s+\n/g, '\n').trim();
  }
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throwForStatus(
      response.status,
      `Lever public postings request failed. URL: ${url.toString()} Status: ${response.status} ${response.statusText}. Body: ${body.slice(0, 500)}`,
    );
  }
  return response.json();
}

function normalizeSalaryRange(value: unknown): LeverPosting['salaryRange'] {
  const raw = asObject(value);
  if (!raw) return null;
  return {
    currency: readNullableString(raw, 'currency'),
    interval: readNullableString(raw, 'interval'),
    min: readNullableNumber(raw, 'min'),
    max: readNullableNumber(raw, 'max'),
  };
}

function normalizePosting(value: unknown): LeverPosting {
  const raw = asObject(value);
  if (!raw) throw new ContractDrift('Lever posting was not an object');

  const id = readString(raw, 'id');
  const text = readString(raw, 'text');
  const hostedUrl = readString(raw, 'hostedUrl');
  const applyUrl = readString(raw, 'applyUrl');
  if (!id || !text || !hostedUrl || !applyUrl) {
    throw new ContractDrift('Lever posting is missing id, text, hostedUrl, or applyUrl');
  }

  const categoriesRaw = asObject(raw.categories) ?? {};
  const listsRaw = Array.isArray(raw.lists) ? raw.lists : [];
  const lists = listsRaw.map((item) => {
    const section = asObject(item) ?? {};
    const contentHtml = readString(section, 'content');
    return {
      title: readString(section, 'text'),
      contentHtml,
      contentPlain: htmlToPlain(contentHtml),
    };
  });

  const createdAt = readNullableNumber(raw, 'createdAt');

  return {
    id,
    title: text,
    text,
    categories: {
      location: readNullableString(categoriesRaw, 'location'),
      team: readNullableString(categoriesRaw, 'team'),
      department: readNullableString(categoriesRaw, 'department'),
      commitment: readNullableString(categoriesRaw, 'commitment'),
      level: readNullableString(categoriesRaw, 'level'),
      allLocations: readStringArray(categoriesRaw, 'allLocations'),
    },
    country: readNullableString(raw, 'country'),
    workplaceType: readNullableString(raw, 'workplaceType'),
    opening: readString(raw, 'opening'),
    openingPlain: readString(raw, 'openingPlain'),
    description: readString(raw, 'description'),
    descriptionPlain: readString(raw, 'descriptionPlain'),
    descriptionBody: readString(raw, 'descriptionBody'),
    descriptionBodyPlain: readString(raw, 'descriptionBodyPlain'),
    lists,
    additional: readString(raw, 'additional'),
    additionalPlain: readString(raw, 'additionalPlain'),
    hostedUrl,
    applyUrl,
    createdAt,
    createdAtIso: createdAt !== null ? new Date(createdAt).toISOString() : null,
    salaryRange: normalizeSalaryRange(raw.salaryRange),
    salaryDescription: readNullableString(raw, 'salaryDescription'),
    salaryDescriptionPlain: readNullableString(raw, 'salaryDescriptionPlain'),
  };
}

function buildListUrl(args: ListPostingsInput): {
  url: URL;
  companySlug: string;
  filtersApplied: ListPostingsOutput['filtersApplied'];
} {
  const companySlug = requirePathSegment(args.companySlug, 'companySlug');
  const url = new URL(`${API_BASE}/${encodeURIComponent(companySlug)}`);
  url.searchParams.set('mode', 'json');

  const filtersApplied = {
    location: appendFilter(url.searchParams, 'location', args.location),
    team: appendFilter(url.searchParams, 'team', args.team),
    department: appendFilter(url.searchParams, 'department', args.department),
    commitment: appendFilter(url.searchParams, 'commitment', args.commitment),
    level: appendFilter(url.searchParams, 'level', args.level),
  };

  if (typeof args.skip === 'number') url.searchParams.set('skip', String(args.skip));
  if (typeof args.limit === 'number') url.searchParams.set('limit', String(args.limit));
  if (args.groupBy) url.searchParams.set('group', args.groupBy);

  return { url, companySlug, filtersApplied };
}

export async function listPostings(
  args: ListPostingsInput,
): Promise<ListPostingsOutput> {
  const { url, companySlug, filtersApplied } = buildListUrl(args);
  const data = await fetchJson(url);
  if (!Array.isArray(data)) {
    throw new ContractDrift(`Lever list response was not an array. URL: ${url.toString()}`);
  }

  if (args.groupBy) {
    const groups = data.map((item) => {
      const bucket = asObject(item);
      if (!bucket || !Array.isArray(bucket.postings)) {
        throw new ContractDrift(`Lever grouped list response had an invalid bucket. URL: ${url.toString()}`);
      }
      const postings = bucket.postings.map(normalizePosting);
      return {
        title: readString(bucket, 'title'),
        postings,
        count: postings.length,
      };
    });
    const postings = groups.flatMap((group) => group.postings);
    return {
      companySlug,
      total: postings.length,
      groupBy: args.groupBy,
      filtersApplied,
      skip: typeof args.skip === 'number' ? args.skip : null,
      limit: typeof args.limit === 'number' ? args.limit : null,
      postings,
      groups,
    };
  }

  const postings = data.map(normalizePosting);
  return {
    companySlug,
    total: postings.length,
    groupBy: null,
    filtersApplied,
    skip: typeof args.skip === 'number' ? args.skip : null,
    limit: typeof args.limit === 'number' ? args.limit : null,
    postings,
    groups: [],
  };
}

export async function getPosting(
  args: GetPostingInput,
): Promise<GetPostingOutput> {
  const companySlug = requirePathSegment(args.companySlug, 'companySlug');
  const postingId = requirePathSegment(args.postingId, 'postingId');
  const url = new URL(
    `${API_BASE}/${encodeURIComponent(companySlug)}/${encodeURIComponent(postingId)}`,
  );
  const data = await fetchJson(url);
  return {
    companySlug,
    postingId,
    posting: normalizePosting(data),
  };
}
