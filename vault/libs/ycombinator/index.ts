/**
 * Y Combinator Library
 *
 * Browser-executable functions for the public YC startup directory
 * (https://www.ycombinator.com/companies) and founder directory
 * (https://www.ycombinator.com/founders). Both are backed by separate
 * Algolia search indexes (`YCCompany_production`, `YCUsers_production`)
 * with their own per-page secured API keys exposed via `window.AlgoliaOpts`.
 */

import type {
  GetContextInput,
  GetContextOutput,
  SurfaceContext,
  SearchCompaniesInput,
  SearchCompaniesOutput,
  GetCompanyInput,
  GetCompanyOutput,
  GetCompanyDetailInput,
  GetCompanyDetailOutput,
  ListCompanyJobsInput,
  ListCompanyJobsOutput,
  GetFacetsInput,
  GetFacetsOutput,
  SearchFoundersInput,
  SearchFoundersOutput,
  GetFounderInput,
  GetFounderOutput,
  GetFounderFacetsInput,
  GetFounderFacetsOutput,
  SearchFacetValuesInput,
  SearchFacetValuesOutput,
  CompanyHit,
  FounderHit,
} from './schemas';

export type {
  GetContextInput,
  GetContextOutput,
  SearchCompaniesInput,
  SearchCompaniesOutput,
  GetCompanyInput,
  GetCompanyOutput,
  GetCompanyDetailInput,
  GetCompanyDetailOutput,
  ListCompanyJobsInput,
  ListCompanyJobsOutput,
  GetFacetsInput,
  GetFacetsOutput,
  SearchFoundersInput,
  SearchFoundersOutput,
  GetFounderInput,
  GetFounderOutput,
  GetFounderFacetsInput,
  GetFounderFacetsOutput,
  SearchFacetValuesInput,
  SearchFacetValuesOutput,
} from './schemas';

type Surface = 'companies' | 'founders';

const SURFACES: Record<
  Surface,
  { url: string; pathPrefix: string; index: string }
> = {
  companies: {
    url: 'https://www.ycombinator.com/companies',
    pathPrefix: '/companies',
    index: 'YCCompany_production',
  },
  founders: {
    url: 'https://www.ycombinator.com/founders',
    pathPrefix: '/founders',
    index: 'YCUsers_production',
  },
};

const COMPANY_BY_LAUNCH_INDEX = 'YCCompany_By_Launch_Date_production';

const COMPANY_FACETS = [
  'top_company',
  'isHiring',
  'nonprofit',
  'batch',
  'industries',
  'subindustry',
  'regions',
  'app_video_public',
  'demo_day_video_public',
  'app_answers',
  'question_answers',
] as const;

const FOUNDER_FACETS = [
  'top_company',
  'batches',
  'yc_industries',
  'yc_subindustries',
  'yc_titles',
] as const;

interface AlgoliaOpts {
  app: string;
  key: string;
}

declare global {
  interface Window {
    AlgoliaOpts?: AlgoliaOpts;
  }
}

const contextCache: Partial<Record<Surface, SurfaceContext>> = {};

async function ensureContext(surface: Surface): Promise<SurfaceContext> {
  const cached = contextCache[surface];
  if (cached) return cached;

  const { url, pathPrefix, index } = SURFACES[surface];

  if (typeof window !== 'undefined' && window.AlgoliaOpts) {
    const onMatchingPage = window.location?.pathname?.startsWith(pathPrefix);
    if (onMatchingPage && window.AlgoliaOpts.app && window.AlgoliaOpts.key) {
      const ctx: SurfaceContext = {
        algoliaAppId: window.AlgoliaOpts.app,
        algoliaApiKey: window.AlgoliaOpts.key,
        indexName: index,
      };
      contextCache[surface] = ctx;
      return ctx;
    }
  }

  const resp = await fetch(url, { credentials: 'omit' as RequestCredentials });
  if (!resp.ok) {
    throw new Error(
      `YC getContext(${surface}): failed to load ${url} (${resp.status} ${resp.statusText})`,
    );
  }
  const html = await resp.text();
  const match = html.match(/window\.AlgoliaOpts\s*=\s*(\{[^}]*\})/);
  if (!match) {
    throw new Error(
      `YC getContext(${surface}): window.AlgoliaOpts not found in ${url} HTML. The page structure may have changed.`,
    );
  }
  const opts = JSON.parse(match[1]) as AlgoliaOpts;
  if (!opts.app || !opts.key) {
    throw new Error(
      `YC getContext(${surface}): parsed AlgoliaOpts missing app or key: ${match[1]}`,
    );
  }

  const ctx: SurfaceContext = {
    algoliaAppId: opts.app,
    algoliaApiKey: opts.key,
    indexName: index,
  };
  contextCache[surface] = ctx;
  return ctx;
}

export async function getContext(
  _args: GetContextInput = {},
): Promise<GetContextOutput> {
  const [companies, founders] = await Promise.all([
    ensureContext('companies'),
    ensureContext('founders'),
  ]);
  return { companies, founders };
}

interface AlgoliaResult<T> {
  hits: T[];
  nbHits: number;
  page: number;
  nbPages: number;
  hitsPerPage: number;
  facets?: Record<string, Record<string, number>>;
}

interface AlgoliaResponse<T> {
  results: Array<AlgoliaResult<T>>;
}

function buildAlgoliaUrl(
  ctx: SurfaceContext,
  endpoint: 'queries' | 'facetQuery',
  facetName?: string,
): string {
  const base = `https://${ctx.algoliaAppId.toLowerCase()}-dsn.algolia.net/1/indexes`;
  const path =
    endpoint === 'queries'
      ? `/*/queries`
      : `/${ctx.indexName}/facets/${facetName}/query`;
  return (
    `${base}${path}` +
    `?x-algolia-agent=${encodeURIComponent('Algolia for JavaScript (3.35.1); Browser; JS Helper (3.16.1)')}` +
    `&x-algolia-application-id=${ctx.algoliaAppId}` +
    `&x-algolia-api-key=${ctx.algoliaApiKey}`
  );
}

function paramString(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function algoliaQuery<T>(
  surface: Surface,
  params: Record<string, string | number>,
  indexOverride?: string,
): Promise<AlgoliaResult<T>> {
  const ctx = await ensureContext(surface);
  const url = buildAlgoliaUrl(ctx, 'queries');
  const indexName = indexOverride ?? ctx.indexName;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: JSON.stringify({
      requests: [{ indexName, params: paramString(params) }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(
      `YC Algolia error (${surface}) ${resp.status} ${resp.statusText}: ${text}`,
    );
  }

  const json = (await resp.json()) as AlgoliaResponse<T>;
  if (!json.results?.[0]) {
    throw new Error(`YC Algolia error (${surface}): empty results array`);
  }
  return json.results[0];
}

// === Companies ===

function buildCompanyFacetFilters(
  args: SearchCompaniesInput,
): string[][] | undefined {
  const groups: string[][] = [];
  if (args.batches?.length) groups.push(args.batches.map((b) => `batch:${b}`));
  if (args.industries?.length)
    groups.push(args.industries.map((i) => `industries:${i}`));
  if (args.subindustries?.length)
    groups.push(args.subindustries.map((s) => `subindustry:${s}`));
  if (args.regions?.length)
    groups.push(args.regions.map((r) => `regions:${r}`));
  if (args.isHiring !== undefined) groups.push([`isHiring:${args.isHiring}`]);
  if (args.topCompany !== undefined)
    groups.push([`top_company:${args.topCompany}`]);
  if (args.nonprofit !== undefined)
    groups.push([`nonprofit:${args.nonprofit}`]);
  if (args.hasAppAnswers !== undefined)
    groups.push([`app_answers:${args.hasAppAnswers}`]);
  if (args.hasAppVideo !== undefined)
    groups.push([`app_video_public:${args.hasAppVideo}`]);
  if (args.hasDemoDayVideo !== undefined)
    groups.push([`demo_day_video_public:${args.hasDemoDayVideo}`]);
  if (args.hasQuestionAnswers !== undefined)
    groups.push([`question_answers:${args.hasQuestionAnswers}`]);
  return groups.length ? groups : undefined;
}

function isoToUnixSeconds(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`searchCompanies: invalid ISO date string "${iso}"`);
  }
  return Math.floor(ms / 1000);
}

function buildCompanyNumericFilters(
  args: SearchCompaniesInput,
): string[] | undefined {
  const filters: string[] = [];
  if (args.minTeamSize !== undefined)
    filters.push(`team_size>=${args.minTeamSize}`);
  if (args.maxTeamSize !== undefined)
    filters.push(`team_size<=${args.maxTeamSize}`);
  if (args.launchedAfter)
    filters.push(`launched_at>=${isoToUnixSeconds(args.launchedAfter)}`);
  if (args.launchedBefore)
    filters.push(`launched_at<=${isoToUnixSeconds(args.launchedBefore)}`);
  return filters.length ? filters : undefined;
}

export async function searchCompanies(
  args: SearchCompaniesInput,
): Promise<SearchCompaniesOutput> {
  const params: Record<string, string | number> = {
    query: args.query ?? '',
    page: args.page ?? 0,
    hitsPerPage: args.hitsPerPage ?? 50,
    facets: JSON.stringify([...COMPANY_FACETS]),
    maxValuesPerFacet: 1000,
    tagFilters: '',
  };
  const filters = buildCompanyFacetFilters(args);
  if (filters) params.facetFilters = JSON.stringify(filters);

  const numFilters = buildCompanyNumericFilters(args);
  if (numFilters) params.numericFilters = JSON.stringify(numFilters);

  const indexOverride =
    args.sortBy === 'launchDate' ? COMPANY_BY_LAUNCH_INDEX : undefined;

  const result = await algoliaQuery<CompanyHit>(
    'companies',
    params,
    indexOverride,
  );
  return {
    nbHits: result.nbHits,
    page: result.page,
    nbPages: result.nbPages,
    hitsPerPage: result.hitsPerPage,
    hits: result.hits,
  };
}

export async function getCompany(
  args: GetCompanyInput,
): Promise<GetCompanyOutput> {
  const result = await algoliaQuery<CompanyHit>('companies', {
    query: '',
    page: 0,
    hitsPerPage: 1,
    facetFilters: JSON.stringify([[`slug:${args.slug}`]]),
  });
  return result.hits[0] ?? null;
}

export async function getFacets(
  _args: GetFacetsInput = {},
): Promise<GetFacetsOutput> {
  const result = await algoliaQuery<{ objectID: string }>('companies', {
    query: '',
    hitsPerPage: 1,
    attributesToRetrieve: JSON.stringify([]),
    attributesToHighlight: JSON.stringify([]),
    analytics: 'false',
    facets: JSON.stringify([...COMPANY_FACETS]),
    sortFacetValuesBy: 'count',
    maxValuesPerFacet: 1000,
  });

  const f = result.facets ?? {};
  return {
    nbHits: result.nbHits,
    batch: f.batch ?? {},
    industries: f.industries ?? {},
    subindustry: f.subindustry ?? {},
    regions: f.regions ?? {},
    isHiring: f.isHiring ?? {},
    nonprofit: f.nonprofit ?? {},
    top_company: f.top_company ?? {},
    app_video_public: f.app_video_public ?? {},
    demo_day_video_public: f.demo_day_video_public ?? {},
    app_answers: f.app_answers ?? {},
    question_answers: f.question_answers ?? {},
  };
}

// === Company Detail Page (Inertia.js SSR) ===

interface InertiaPage {
  component: string;
  props: Record<string, unknown>;
  url: string;
  version: string | null;
}

async function fetchInertiaPage<T = InertiaPage>(path: string): Promise<T> {
  const resp = await fetch(`https://www.ycombinator.com${path}`, {
    credentials: 'omit' as RequestCredentials,
  });
  if (!resp.ok) {
    throw new Error(
      `YC Inertia fetch failed: ${resp.status} ${resp.statusText} — ${path}`,
    );
  }
  const html = await resp.text();
  const match = html.match(/data-page="([^"]+)"/);
  if (!match) {
    throw new Error(
      `YC Inertia: data-page attribute not found in ${path}. Page structure may have changed.`,
    );
  }
  const decoded =
    typeof DOMParser !== 'undefined'
      ? (() => {
          const doc = new DOMParser().parseFromString(
            `<!doctype html><body><span data-x="${match[1]}"></span>`,
            'text/html',
          );
          return doc.querySelector('span')?.getAttribute('data-x') ?? '';
        })()
      : match[1]
          .replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'")
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&');
  return JSON.parse(decoded) as T;
}

interface CompanyShowProps {
  company: GetCompanyDetailOutput['company'] & {
    primary_group_partner: GetCompanyDetailOutput['groupPartner'];
    founders: GetCompanyDetailOutput['founders'];
  };
  jobPostings: ListCompanyJobsOutput['jobs'];
  newsItems: GetCompanyDetailOutput['newsItems'];
  launches: GetCompanyDetailOutput['launches'];
}

async function fetchCompanyShowPage(slug: string): Promise<CompanyShowProps> {
  const page = await fetchInertiaPage<{ props: CompanyShowProps }>(
    `/companies/${slug}`,
  );
  return page.props;
}

export async function getCompanyDetail(
  args: GetCompanyDetailInput,
): Promise<GetCompanyDetailOutput> {
  const props = await fetchCompanyShowPage(args.slug);
  const { founders, primary_group_partner, ...company } = props.company;
  return {
    company,
    founders: founders ?? [],
    groupPartner: primary_group_partner ?? null,
    newsItems: props.newsItems ?? [],
    launches: props.launches ?? [],
  };
}

export async function listCompanyJobs(
  args: ListCompanyJobsInput,
): Promise<ListCompanyJobsOutput> {
  const props = await fetchCompanyShowPage(args.slug);
  return { jobs: props.jobPostings ?? [] };
}

// === Founders ===

function buildFounderFacetFilters(
  args: SearchFoundersInput,
): string[][] | undefined {
  const groups: string[][] = [];
  if (args.batches?.length)
    groups.push(args.batches.map((b) => `batches:${b}`));
  if (args.industries?.length)
    groups.push(args.industries.map((i) => `yc_industries:${i}`));
  if (args.subindustries?.length)
    groups.push(args.subindustries.map((s) => `yc_subindustries:${s}`));
  if (args.titles?.length)
    groups.push(args.titles.map((t) => `yc_titles:${t}`));
  if (args.topCompany !== undefined)
    groups.push([`top_company:${args.topCompany}`]);
  return groups.length ? groups : undefined;
}

export async function searchFounders(
  args: SearchFoundersInput,
): Promise<SearchFoundersOutput> {
  const params: Record<string, string | number> = {
    query: args.query ?? '',
    page: args.page ?? 0,
    hitsPerPage: args.hitsPerPage ?? 50,
    facets: JSON.stringify([...FOUNDER_FACETS]),
    maxValuesPerFacet: 1000,
    tagFilters: '',
  };
  const filters = buildFounderFacetFilters(args);
  if (filters) params.facetFilters = JSON.stringify(filters);

  const result = await algoliaQuery<FounderHit>('founders', params);
  return {
    nbHits: result.nbHits,
    page: result.page,
    nbPages: result.nbPages,
    hitsPerPage: result.hitsPerPage,
    hits: result.hits,
  };
}

export async function getFounder(
  args: GetFounderInput,
): Promise<GetFounderOutput> {
  const result = await algoliaQuery<FounderHit>('founders', {
    query: '',
    page: 0,
    hitsPerPage: 1,
    facetFilters: JSON.stringify([[`url_slug:${args.urlSlug}`]]),
  });
  return result.hits[0] ?? null;
}

export async function getFounderFacets(
  _args: GetFounderFacetsInput = {},
): Promise<GetFounderFacetsOutput> {
  const result = await algoliaQuery<{ objectID: string }>('founders', {
    query: '',
    hitsPerPage: 1,
    attributesToRetrieve: JSON.stringify([]),
    attributesToHighlight: JSON.stringify([]),
    analytics: 'false',
    facets: JSON.stringify([...FOUNDER_FACETS]),
    sortFacetValuesBy: 'count',
    maxValuesPerFacet: 1000,
  });

  const f = result.facets ?? {};
  return {
    nbHits: result.nbHits,
    batches: f.batches ?? {},
    yc_industries: f.yc_industries ?? {},
    yc_subindustries: f.yc_subindustries ?? {},
    yc_titles: f.yc_titles ?? {},
    top_company: f.top_company ?? {},
  };
}

export async function searchFacetValues(
  args: SearchFacetValuesInput,
): Promise<SearchFacetValuesOutput> {
  const ctx = await ensureContext('founders');
  const url = buildAlgoliaUrl(ctx, 'facetQuery', args.facet);
  const limit = args.limit ?? 10;

  const params = paramString({
    facetQuery: args.query ?? '',
    maxFacetHits: limit,
    facets: JSON.stringify([...FOUNDER_FACETS]),
    maxValuesPerFacet: 1000,
    tagFilters: '',
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: JSON.stringify({ params }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(
      `YC Algolia facet-query error ${resp.status} ${resp.statusText}: ${text}`,
    );
  }

  const json = (await resp.json()) as {
    facetHits: Array<{ value: string; count: number }>;
  };
  return {
    facet: args.facet,
    values: (json.facetHits ?? []).map((h) => ({
      value: h.value,
      count: h.count,
    })),
  };
}
