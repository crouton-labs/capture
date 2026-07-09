import { ContractDrift, NotFound, Validation, throwForStatus } from '@vallum/_runtime';

export type {
  GetCompanyProfileInput,
  GetCompanyProfileOutput,
  GetJobInput,
  GetJobOutput,
  ListCompanyJobsInput,
  ListCompanyJobsOutput,
  SearchJobsInput,
  SearchJobsOutput,
} from './schemas';

import type {
  GetCompanyProfileInput,
  GetCompanyProfileOutput,
  GetJobInput,
  GetJobOutput,
  ListCompanyJobsInput,
  ListCompanyJobsOutput,
  SearchJobsInput,
  SearchJobsOutput,
} from './schemas';

type RawObject = Record<string, unknown>;
type RawGraph = Record<string, unknown>;

type CompanySize = NonNullable<GetCompanyProfileOutput['companySize']>;
type JobType = NonNullable<GetJobOutput['jobType']>;

type PageData = {
  url: string;
  graph: RawGraph;
  jsonLd: RawObject[];
};

const WELLFOUND_ORIGIN = 'https://wellfound.com';

const COMPANY_SIZES = new Set<CompanySize>([
  'SIZE_1_10',
  'SIZE_11_50',
  'SIZE_51_100',
  'SIZE_101_200',
  'SIZE_201_500',
  'SIZE_501_1000',
  'SIZE_1001_5000',
  'SIZE_5001_10000',
  'SIZE_10001_',
]);

const JOB_TYPES = new Set<JobType>(['full_time', 'part_time', 'contract', 'internship', 'cofounder']);

function asObject(value: unknown): RawObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RawObject) : null;
}

function isRef(value: unknown): value is { __ref: string } {
  const raw = asObject(value);
  return typeof raw?.__ref === 'string';
}

function isJsonWrapper(value: unknown): value is { type: 'json'; json: unknown } {
  const raw = asObject(value);
  return raw?.type === 'json' && 'json' in raw;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function cleanString(value: unknown): string | null {
  if (!isString(value)) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readString(obj: RawObject, keys: string[]): string | null {
  for (const key of keys) {
    const value = cleanString(obj[key]);
    if (value) return value;
  }
  return null;
}

function readNumber(obj: RawObject, keys: string[]): number | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function readBoolean(obj: RawObject, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'boolean') return value;
  }
  return null;
}

function stripTags(html: string): string {
  if (!html) return '';
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.textContent ?? '').replace(/\s+\n/g, '\n').trim();
  }
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeSlug(value: string, fieldName: string): string {
  const slug = value.trim();
  if (!slug) {
    throw new Validation(`${fieldName} is required`);
  }
  if (slug.includes('/')) {
    throw new Validation(`${fieldName} must be a Wellfound path segment, not a path: ${slug}`);
  }
  return slug;
}

function normalizeJobType(value: unknown): JobType | null {
  const raw = cleanString(value)?.toLowerCase();
  return raw && JOB_TYPES.has(raw as JobType) ? (raw as JobType) : null;
}

function normalizeCompanySize(value: unknown): CompanySize | null {
  const raw = cleanString(value);
  if (!raw) return null;
  if (COMPANY_SIZES.has(raw as CompanySize)) return raw as CompanySize;

  const compact = raw.toLowerCase().replace(/[\s,–—-]+/g, '');
  if (/^1to10|^1-10|^1_10|^110/.test(compact)) return 'SIZE_1_10';
  if (/^11to50|^11-50|^11_50|^1150/.test(compact)) return 'SIZE_11_50';
  if (/^51to100|^51-100|^51_100|^51100/.test(compact)) return 'SIZE_51_100';
  if (/^101to200|^101-200|^101_200|^101200/.test(compact)) return 'SIZE_101_200';
  if (/^201to500|^201-500|^201_500|^201500/.test(compact)) return 'SIZE_201_500';
  if (/^501to1000|^501-1000|^501_1000|^5011000/.test(compact)) return 'SIZE_501_1000';
  if (/^1001to5000|^1001-5000|^1001_5000|^10015000/.test(compact)) return 'SIZE_1001_5000';
  if (/^5001to10000|^5001-10000|^5001_10000|^500110000/.test(compact)) return 'SIZE_5001_10000';
  if (/^10001\+|^10001_|^10001plus|^10001employees/.test(compact)) return 'SIZE_10001_';
  return null;
}

function requireStringField(obj: RawObject, keys: string[], fieldName: string, url: string, nodeName: string): string {
  const value = readString(obj, keys);
  if (!value) {
    throw new ContractDrift(`Wellfound ${nodeName} missing ${fieldName}. URL: ${url}`);
  }
  return value;
}

function normalizeUrl(value: unknown): string | null {
  const raw = cleanString(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw, WELLFOUND_ORIGIN);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeLocationNames(value: unknown): string[] {
  const out = new Set<string>();
  const visit = (input: unknown): void => {
    if (!input) return;
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (trimmed) out.add(trimmed);
      return;
    }
    if (Array.isArray(input)) {
      for (const item of input) visit(item);
      return;
    }
    if (isJsonWrapper(input)) {
      visit(input.json);
      return;
    }
    const obj = asObject(input);
    if (!obj) return;
    const label = readString(obj, ['name', 'label', 'displayName', 'city', 'region', 'location']);
    if (label) out.add(label);
  };
  visit(value);
  return [...out];
}

function normalizeSkills(value: unknown): string[] {
  const out = new Set<string>();
  const visit = (input: unknown): void => {
    if (!input) return;
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (trimmed) out.add(trimmed);
      return;
    }
    if (Array.isArray(input)) {
      for (const item of input) visit(item);
      return;
    }
    if (isJsonWrapper(input)) {
      visit(input.json);
      return;
    }
    const obj = asObject(input);
    if (!obj) return;
    const label = readString(obj, ['name', 'label', 'title']);
    if (label) out.add(label);
  };
  visit(value);
  return [...out];
}

function normalizeBadge(value: unknown): { label: string; tooltip: string | null } | null {
  if (typeof value === 'string') {
    const label = value.trim();
    return label ? { label, tooltip: null } : null;
  }
  const obj = asObject(value);
  if (!obj) return null;
  const label = readString(obj, ['label', 'name', 'title']);
  if (!label) return null;
  return { label, tooltip: cleanString(obj.tooltip) };
}

function normalizeRecruiter(value: unknown): GetJobOutput['recruiter'] {
  const obj = asObject(value);
  if (!obj) return null;
  const name = cleanString(obj.name) ?? cleanString(obj.fullName) ?? cleanString(obj.displayName);
  const title = cleanString(obj.title) ?? cleanString(obj.role) ?? cleanString(obj.headline);
  const profileUrl = normalizeUrl(obj.profileUrl) ?? normalizeUrl(obj.url) ?? normalizeUrl(obj.pathName);
  if (!name && !title && !profileUrl) return null;
  return {
    name,
    title,
    profileUrl,
  };
}

function canonicalCompanyProfileUrl(slug: string): string {
  return `${WELLFOUND_ORIGIN}/company/${encodeURIComponent(slug)}`;
}

function canonicalCompanyJobsUrl(slug: string): string {
  return `${WELLFOUND_ORIGIN}/company/${encodeURIComponent(slug)}/jobs`;
}

function canonicalJobUrl(jobId: string, slug: string): string {
  return `${WELLFOUND_ORIGIN}/jobs/${encodeURIComponent(jobId)}-${encodeURIComponent(slug)}`;
}

function buildSearchUrl(args: SearchJobsInput): { url: string; pageType: SearchJobsOutput['pageType'] } {
  const page = args.page ?? 1;
  const searchParams = new URLSearchParams();
  if (page > 1) searchParams.set('page', String(page));

  if (args.role) {
    const role = normalizeSlug(args.role, 'role');
    const location = args.location ? normalizeSlug(args.location, 'location') : null;
    const url = location
      ? `${WELLFOUND_ORIGIN}/role/l/${encodeURIComponent(role)}/${encodeURIComponent(location)}`
      : `${WELLFOUND_ORIGIN}/role/r/${encodeURIComponent(role)}`;
    return { url: appendQuery(url, searchParams), pageType: 'role' };
  }

  if (args.location) {
    const location = normalizeSlug(args.location, 'location');
    return { url: appendQuery(`${WELLFOUND_ORIGIN}/location/${encodeURIComponent(location)}`, searchParams), pageType: 'location' };
  }

  const params = new URLSearchParams(searchParams);
  if (args.query) params.set('q', args.query);
  if (args.market) params.set('market', args.market);
  return { url: appendQuery(`${WELLFOUND_ORIGIN}/jobs`, params), pageType: 'jobs' };
}

function appendQuery(url: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

function htmlFromDocument(doc: Document): string {
  const html = doc.documentElement?.outerHTML ?? '';
  if (!html) {
    throw new ContractDrift(`Wellfound returned an empty document. URL: ${window.location.href}`);
  }
  return html;
}

function extractJsonLdObjects(doc: Document, url: string): RawObject[] {
  const out: RawObject[] = [];
  const scripts = [...doc.querySelectorAll('script[type="application/ld+json"]')];
  for (const script of scripts) {
    const raw = script.textContent?.trim();
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new ContractDrift(
        `Wellfound JSON-LD was not valid JSON. URL: ${url}. Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        const obj = asObject(entry);
        if (obj) out.push(obj);
      }
    } else {
      const obj = asObject(parsed);
      if (obj) out.push(obj);
    }
  }
  return out;
}

function extractGraphFromNextData(nextData: RawObject, url: string): RawGraph {
  const props = asObject(nextData.props);
  const pageProps = asObject(props?.pageProps);
  const apolloState = asObject(pageProps?.apolloState);
  const graph = asObject(apolloState?.data) as RawGraph | null;
  if (!graph) {
    throw new ContractDrift(`Wellfound __NEXT_DATA__ missing props.pageProps.apolloState.data. URL: ${url}`);
  }
  return graph;
}

function resolveValue(value: unknown, graph: RawGraph, url: string, seen = new Set<string>()): unknown {
  if (value === null || value === undefined) return value;
  if (isRef(value)) {
    const ref = value.__ref;
    if (seen.has(ref)) return null;
    const target = graph[ref];
    if (target === undefined) {
      throw new ContractDrift(`Wellfound Apollo ref target missing. URL: ${url} Ref: ${ref}`);
    }
    const nextSeen = new Set(seen);
    nextSeen.add(ref);
    return resolveValue(target, graph, url, nextSeen);
  }
  if (isJsonWrapper(value)) {
    return resolveValue(value.json, graph, url, seen);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, graph, url, seen));
  }
  if (typeof value === 'object') {
    const obj = value as RawObject;
    const out: RawObject = {};
    for (const [key, entry] of Object.entries(obj)) {
      if (key === '__typename') {
        out[key] = entry;
        continue;
      }
      out[key] = resolveValue(entry, graph, url, seen);
    }
    return out;
  }
  return value;
}

function parseApolloConnectionKey(key: string): { after: string | null } | null {
  const match = key.match(/^jobListingsConnection\((.*)\)$/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as RawObject;
    return {
      after: cleanString(parsed.after) ?? '',
    };
  } catch {
    throw new ContractDrift(`Wellfound jobListingsConnection key was not valid JSON: ${key}`);
  }
}

function pickConnection(graph: RawGraph, pageUrl: string): { key: string; node: RawObject } | null {
  const entries: Array<{ key: string; node: RawObject; config: { after: string | null } | null }> = [];
  for (const [key, value] of Object.entries(graph)) {
    if (!key.startsWith('jobListingsConnection(')) continue;
    const node = asObject(resolveValue(value, graph, pageUrl));
    if (!node) continue;
    entries.push({ key, node, config: parseApolloConnectionKey(key) });
  }

  if (entries.length === 0) return null;
  const firstPage = entries.find((entry) => entry.config?.after === '' || entry.config?.after === 'MA==');
  return firstPage ? { key: firstPage.key, node: firstPage.node } : { key: entries[0].key, node: entries[0].node };
}

function parseCurrencySymbol(value: string | null): string | null {
  if (!value) return null;
  if (value.includes('$')) return 'USD';
  if (value.includes('£')) return 'GBP';
  if (value.includes('€')) return 'EUR';
  if (value.includes('₹')) return 'INR';
  return null;
}

function parseScaledNumber(raw: string): number | null {
  const normalized = raw.replace(/[,\s]/g, '').trim();
  const match = normalized.match(/^(-?\d+(?:\.\d+)?)([kKmMbB]?)$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const suffix = match[2].toLowerCase();
  if (suffix === 'k') return value * 1_000;
  if (suffix === 'm') return value * 1_000_000;
  if (suffix === 'b') return value * 1_000_000_000;
  return value;
}

function parseCompensationText(text: string | null | undefined): GetJobOutput['compensation'] {
  const salaryText = cleanString(text);
  if (!salaryText) return null;

  const salaryMatch = salaryText.match(/([£$€₹]\s*[-\d.,]+\s*[kKmMbB]?)\s*[–—-]\s*([£$€₹]?\s*[-\d.,]+\s*[kKmMbB]?)/);
  const singleSalaryMatch = salaryText.match(/([£$€₹]\s*[-\d.,]+\s*[kKmMbB]?)/);
  const equityMatch = salaryText.match(/(\d+(?:\.\d+)?)%\s*[–—-]\s*(\d+(?:\.\d+)?)%/);
  const singleEquityMatch = salaryText.match(/(\d+(?:\.\d+)?)%/);

  const salary = salaryMatch
    ? {
        currency: parseCurrencySymbol(salaryMatch[1]) ?? parseCurrencySymbol(salaryMatch[2]) ?? null,
        minUsd: parseScaledNumber(salaryMatch[1].replace(/[^\d.kKmMbB-]/g, '')),
        maxUsd: parseScaledNumber(salaryMatch[2].replace(/[^\d.kKmMbB-]/g, '')),
        unitText: 'year',
      }
    : singleSalaryMatch
      ? {
          currency: parseCurrencySymbol(singleSalaryMatch[1]),
          minUsd: parseScaledNumber(singleSalaryMatch[1].replace(/[^\d.kKmMbB-]/g, '')),
          maxUsd: parseScaledNumber(singleSalaryMatch[1].replace(/[^\d.kKmMbB-]/g, '')),
          unitText: 'year',
        }
      : null;

  const equity = equityMatch
    ? {
        minPct: Number(equityMatch[1]),
        maxPct: Number(equityMatch[2]),
      }
    : singleEquityMatch
      ? {
          minPct: Number(singleEquityMatch[1]),
          maxPct: Number(singleEquityMatch[1]),
        }
      : null;

  return {
    salaryText,
    salary,
    equity,
  };
}

function parseExperienceLevel(job: RawObject): string | null {
  const direct = readString(job, ['experienceLevel', 'experience_level']);
  if (direct) return direct;
  const min = readNumber(job, ['yearsExperienceMin', 'years_experience_min']);
  const max = readNumber(job, ['yearsExperienceMax', 'years_experience_max']);
  if (min === null && max === null) return null;
  if (min !== null && max !== null && min !== max) return `${min}-${max} years`;
  const years = min ?? max;
  return years !== null ? `${years}+ years` : null;
}

function parsePostedAtIso(job: RawObject): string | null {
  const explicit = readString(job, ['postedAtIso', 'posted_at_iso']);
  if (explicit) return explicit;
  const liveStartAt = readNumber(job, ['liveStartAt', 'live_start_at', 'postedAtEpochSeconds', 'posted_at_epoch_seconds']);
  if (liveStartAt === null) return null;
  return new Date(liveStartAt * 1_000).toISOString();
}

function parseJobCard(
  raw: unknown,
  pageUrl: string,
  nodeName: string,
  companyFallback?: ReturnType<typeof normalizeCompanySummary>,
): SearchJobsOutput['jobs'][number] | null {
  const job = asObject(raw);
  if (!job) return null;

  const jobId = requireStringField(job, ['id', 'jobId', 'listingId'], 'id', pageUrl, nodeName);
  const title = requireStringField(job, ['title'], 'title', pageUrl, nodeName);
  const slug = requireStringField(job, ['slug'], 'slug', pageUrl, nodeName);

  const companyNode = asObject(job.company) ?? asObject(job.startup) ?? asObject(job.startupCompany) ?? companyFallback?.__raw ?? null;
  const company = normalizeCompanySummary(companyNode, companyFallback ?? null);

  const url = normalizeUrl(job.url) ?? normalizeUrl(job.jobUrl) ?? canonicalJobUrl(jobId, slug);
  const locationNames = normalizeLocationNames(job.locationNames ?? job.locations ?? job.locationNamesJson);
  const compensationText = cleanString(job.compensation) ?? cleanString(job.compensationText) ?? null;

  return {
    id: jobId,
    title,
    slug,
    url,
    companyName: company?.name ?? cleanString(job.companyName) ?? null,
    companySlug: company?.slug ?? cleanString(job.companySlug) ?? null,
    companyProfileUrl: company?.profileUrl ?? normalizeUrl(job.companyProfileUrl) ?? null,
    companyJobsUrl: company?.jobsUrl ?? normalizeUrl(job.companyJobsUrl) ?? null,
    companyLogoUrl: company?.logoUrl ?? normalizeUrl(job.companyLogoUrl) ?? null,
    companyHighConcept: company?.highConcept ?? cleanString(job.companyHighConcept) ?? null,
    companySize: company?.companySize ?? normalizeCompanySize(job.companySize ?? job.companySizeEnum ?? job.company_size_enum),
    primaryRoleTitle: cleanString(job.primaryRoleTitle) ?? cleanString(job.primary_role_title) ?? null,
    primaryRoleParent: cleanString(job.primaryRoleParent) ?? cleanString(job.primary_role_parent) ?? null,
    jobType: normalizeJobType(job.jobType ?? job.job_type),
    remote: readBoolean(job, ['remote']) ?? null,
    locationNames,
    liveStartAt: readNumber(job, ['liveStartAt', 'live_start_at', 'postedAtEpochSeconds', 'posted_at_epoch_seconds']),
    compensationText,
    descriptionSnippet: cleanString(job.descriptionSnippet) ?? cleanString(job.description_snippet) ?? null,
  };
}

function normalizeCompanySummary(value: unknown, fallback: CompanyProfileLike | null): CompanyProfileLike | null {
  const company = asObject(value);
  if (!company) return fallback;
  const slug = cleanString(company.slug) ?? fallback?.slug ?? null;
  const name = cleanString(company.name) ?? fallback?.name ?? null;
  const profileUrl = normalizeUrl(company.profileUrl) ?? normalizeUrl(company.companyProfileUrl) ?? (slug ? canonicalCompanyProfileUrl(slug) : fallback?.profileUrl ?? null);
  const jobsUrl = normalizeUrl(company.jobsUrl) ?? normalizeUrl(company.companyJobsUrl) ?? (slug ? canonicalCompanyJobsUrl(slug) : fallback?.jobsUrl ?? null);
  return {
    __raw: company,
    id: cleanString(company.id) ?? fallback?.id ?? null,
    name,
    slug,
    profileUrl,
    jobsUrl,
    logoUrl: normalizeUrl(company.logoUrl) ?? normalizeUrl(company.companyLogoUrl) ?? fallback?.logoUrl ?? null,
    highConcept: cleanString(company.highConcept) ?? cleanString(company.companyHighConcept) ?? fallback?.highConcept ?? null,
    companySize: normalizeCompanySize(company.companySize ?? company.company_size_enum ?? company.companySizeEnum) ?? fallback?.companySize ?? null,
    totalRaisedAmount: readNumber(company, ['totalRaisedAmount', 'total_raised_amount_usd']) ?? fallback?.totalRaisedAmount ?? null,
    websiteUrl: normalizeUrl(company.websiteUrl) ?? normalizeUrl(company.companyUrl) ?? normalizeUrl(company.url) ?? fallback?.websiteUrl ?? null,
  };
}

type CompanyProfileLike = {
  __raw: RawObject;
  id: string | null;
  name: string | null;
  slug: string | null;
  profileUrl: string | null;
  jobsUrl: string | null;
  logoUrl: string | null;
  highConcept: string | null;
  companySize: CompanySize | null;
  totalRaisedAmount: number | null;
  websiteUrl: string | null;
};

function normalizeCompanyCard(raw: unknown, graph: RawGraph, pageUrl: string): SearchJobsOutput['companies'][number] | null {
  const company = asObject(raw);
  if (!company) return null;
  const summary = normalizeCompanySummary(company, null);
  const id = requireStringField(company, ['id'], 'id', pageUrl, 'StartupResult');
  const name = requireStringField(company, ['name'], 'name', pageUrl, 'StartupResult');
  const slug = requireStringField(company, ['slug'], 'slug', pageUrl, 'StartupResult');
  const highlightedJobs = normalizeHighlightedJobs(company.highlightedJobListings, summary ?? { __raw: company, id, name, slug, profileUrl: null, jobsUrl: null, logoUrl: null, highConcept: null, companySize: null, totalRaisedAmount: null, websiteUrl: null }, graph, pageUrl);
  return {
    id,
    name,
    slug,
    profileUrl: summary?.profileUrl ?? canonicalCompanyProfileUrl(slug),
    jobsUrl: summary?.jobsUrl ?? canonicalCompanyJobsUrl(slug),
    logoUrl: summary?.logoUrl ?? null,
    highConcept: summary?.highConcept ?? null,
    companySize: summary?.companySize ?? null,
    badges: ((company.badges as unknown[]) ?? []).map(normalizeBadge).filter((item): item is NonNullable<typeof item> => Boolean(item)),
    highlightedJobs,
  };
}

function normalizeHighlightedJobs(
  value: unknown,
  companyFallback: CompanyProfileLike,
  graph: RawGraph,
  pageUrl: string,
): SearchJobsOutput['companies'][number]['highlightedJobs'] {
  if (!Array.isArray(value)) return [];
  const jobs: SearchJobsOutput['companies'][number]['highlightedJobs'] = [];
  for (const item of value) {
    const resolved = resolveValue(item, graph, pageUrl);
    const job = parseJobCard(resolved ?? item, pageUrl, 'StartupResult.highlightedJobListings', companyFallback);
    if (job) jobs.push(job);
  }
  return jobs;
}

function buildPageData(url: string, doc: Document): PageData {
  const nextData = parseNextData(doc, url);
  const graph = extractGraphFromNextData(nextData, url);
  const jsonLd = extractJsonLdObjects(doc, url);
  return { url, graph, jsonLd };
}

function parseNextData(doc: Document, url: string): RawObject {
  const nextDataText = doc.getElementById('__NEXT_DATA__')?.textContent?.trim();
  if (!nextDataText) {
    throw new ContractDrift(`Wellfound page missing __NEXT_DATA__. URL: ${url}`);
  }
  try {
    return JSON.parse(nextDataText) as RawObject;
  } catch (error) {
    throw new ContractDrift(
      `Wellfound __NEXT_DATA__ was not valid JSON. URL: ${url}. Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function loadPage(url: string): Promise<PageData> {
  const target = new URL(url);
  const samePage = typeof window !== 'undefined' && window.location.origin === target.origin && window.location.pathname === target.pathname && window.location.search === target.search;
  if (samePage && typeof document !== 'undefined') {
    htmlFromDocument(document);
    return buildPageData(target.toString(), document);
  }

  const response = await fetch(target.toString(), {
    method: 'GET',
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    credentials: 'omit',
  });
  const html = await response.text().catch(() => '');
  if (!response.ok) {
    throwForStatus(
      response.status,
      `Wellfound request failed. URL: ${target.toString()} Status: ${response.status} ${response.statusText}. Body: ${html.slice(0, 500)}`,
    );
  }
  if (!html.trim()) {
    throw new ContractDrift(`Wellfound returned an empty response. URL: ${target.toString()}`);
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return buildPageData(target.toString(), doc);
}

function findSearchNodes(graph: RawGraph, pageUrl: string): { jobs: SearchJobsOutput['jobs']; companies: SearchJobsOutput['companies'] } {
  const jobsById = new Map<string, SearchJobsOutput['jobs'][number]>();
  const companiesById = new Map<string, SearchJobsOutput['companies'][number]>();

  for (const [key, value] of Object.entries(graph)) {
    const resolved = asObject(resolveValue(value, graph, pageUrl));
    if (!resolved) continue;
    if (key.startsWith('JobListingSearchResult:')) {
      const job = parseJobCard(resolved, pageUrl, 'JobListingSearchResult');
      if (job) jobsById.set(job.id, job);
    }
    if (key.startsWith('StartupResult:')) {
      const company = normalizeCompanyCard(resolved, graph, pageUrl);
      if (company) companiesById.set(company.id, company);
    }
  }

  return { jobs: [...jobsById.values()], companies: [...companiesById.values()] };
}

function getCompanyProfileNode(graph: RawGraph, pageUrl: string): RawObject | null {
  for (const [key, value] of Object.entries(graph)) {
    if (!key.startsWith('Startup:')) continue;
    const resolved = asObject(resolveValue(value, graph, pageUrl));
    if (resolved) return resolved;
  }
  return null;
}

function getJobDetailNode(graph: RawGraph, pageUrl: string): RawObject | null {
  for (const [key, value] of Object.entries(graph)) {
    if (!key.startsWith('JobListing:')) continue;
    const resolved = asObject(resolveValue(value, graph, pageUrl));
    if (resolved) return resolved;
  }
  return null;
}

function normalizeCompanyProfile(raw: RawObject, url: string): GetCompanyProfileOutput {
  const id = requireStringField(raw, ['id'], 'id', url, 'Startup');
  const name = requireStringField(raw, ['name'], 'name', url, 'Startup');
  const slug = requireStringField(raw, ['slug'], 'slug', url, 'Startup');
  const profileUrl = normalizeUrl(raw.profileUrl) ?? normalizeUrl(raw.url) ?? canonicalCompanyProfileUrl(slug);
  const jobsUrl = normalizeUrl(raw.jobsUrl) ?? canonicalCompanyJobsUrl(slug);
  return {
    id,
    name,
    slug,
    profileUrl,
    jobsUrl,
    logoUrl: normalizeUrl(raw.logoUrl) ?? null,
    highConcept: cleanString(raw.highConcept) ?? null,
    companySize: normalizeCompanySize(raw.companySize ?? raw.company_size_enum ?? raw.companySizeEnum),
    totalRaisedAmount: readNumber(raw, ['totalRaisedAmount', 'total_raised_amount_usd']),
    websiteUrl: normalizeUrl(raw.websiteUrl) ?? normalizeUrl(raw.companyUrl) ?? normalizeUrl(raw.url),
    twitterUrl: normalizeUrl(raw.twitterUrl),
    linkedInUrl: normalizeUrl(raw.linkedInUrl),
    productHuntUrl: normalizeUrl(raw.productHuntUrl),
    blogUrl: normalizeUrl(raw.blogUrl),
    facebookUrl: normalizeUrl(raw.facebookUrl),
    jobPreamble: cleanString(raw.jobPreamble) ?? null,
    isOperating: readBoolean(raw, ['isOperating']),
    public: readBoolean(raw, ['public']),
    published: readBoolean(raw, ['published']),
    quarantined: readBoolean(raw, ['quarantined']),
    isShell: readBoolean(raw, ['isShell']),
    isIncubator: readBoolean(raw, ['isIncubator']),
  };
}

function resolveCompanyContext(job: RawObject): CompanyProfileLike | null {
  const candidate = asObject(job.company) ?? asObject(job.startup) ?? asObject(job.startupCompany) ?? asObject(job.organization) ?? null;
  if (!candidate) return null;
  const summary = normalizeCompanySummary(candidate, null);
  if (!summary) return null;
  return summary;
}

function normalizeJobDetail(raw: RawObject, url: string, jsonLd: RawObject[]): GetJobOutput {
  const jobId = requireStringField(raw, ['id'], 'id', url, 'JobListing');
  const slug = requireStringField(raw, ['slug'], 'slug', url, 'JobListing');
  const title = requireStringField(raw, ['title', 'name'], 'title', url, 'JobListing');
  const companyContext = resolveCompanyContext(raw) ?? { __raw: {}, id: null, name: null, slug: null, profileUrl: null, jobsUrl: null, logoUrl: null, highConcept: null, companySize: null, totalRaisedAmount: null, websiteUrl: null };
  const companyName = companyContext.name ?? cleanString(raw.companyName);
  if (!companyName) {
    throw new ContractDrift(`Wellfound JobListing missing company name. URL: ${url}`);
  }
  const jsonLdJob = jsonLd.find((entry) => cleanString(entry['@type']) === 'JobPosting' || cleanString(entry['@type']) === 'jobPosting');
  const descriptionHtml = cleanString(raw.description) ?? cleanString(raw.descriptionHtml) ?? cleanString(raw.description_full) ?? cleanString(jsonLdJob?.description) ?? '';
  if (!descriptionHtml) {
    throw new ContractDrift(`Wellfound JobListing missing description body. URL: ${url}`);
  }
  const compensationText = cleanString(raw.compensation) ?? cleanString(raw.compensationText) ?? cleanString(raw.salaryText) ?? null;
  const compensation = compensationText || raw.salary || raw.equity || raw.salaryText ? parseCompensationText(compensationText) : null;
  const applyUrl = normalizeUrl(raw.applyUrl) ?? normalizeUrl(raw.apply_url) ?? normalizeUrl(jsonLdJob?.applicationUrl) ?? normalizeUrl(jsonLdJob?.url) ?? null;
  const atsUrl = normalizeUrl(raw.atsUrl) ?? normalizeUrl(raw.ats_url) ?? normalizeUrl(raw.applyExternalUrl) ?? normalizeUrl(raw.apply_external_url) ?? null;
  const atsSource = cleanString(raw.atsSource) ?? cleanString(raw.ats_source) ?? null;
  const recruiter = normalizeRecruiter(raw.recruiter ?? raw.recruitingContact ?? raw.hiringContact ?? raw.hiring_contact);
  const liveStartAt = readNumber(raw, ['liveStartAt', 'live_start_at', 'postedAtEpochSeconds', 'posted_at_epoch_seconds']);
  const postedAtIso = parsePostedAtIso(raw);

  return {
    jobId,
    slug,
    url: canonicalJobUrl(jobId, slug),
    title,
    company: {
      name: companyName,
      slug: companyContext.slug,
      profileUrl: companyContext.profileUrl,
      jobsUrl: companyContext.jobsUrl,
      logoUrl: companyContext.logoUrl,
      highConcept: companyContext.highConcept,
      companySize: companyContext.companySize,
      totalRaisedAmount: companyContext.totalRaisedAmount,
      websiteUrl: companyContext.websiteUrl,
    },
    descriptionHtml,
    descriptionText: stripTags(descriptionHtml),
    skills: normalizeSkills(raw.skills),
    locationNames: normalizeLocationNames(raw.locationNames ?? raw.locations ?? raw.locationNamesJson),
    remote: readBoolean(raw, ['remote']),
    jobType: normalizeJobType(raw.jobType ?? raw.job_type),
    employmentType: cleanString(raw.employmentType) ?? cleanString(raw.employment_type),
    experienceLevel: parseExperienceLevel(raw),
    liveStartAt,
    postedAtIso,
    compensation,
    applyUrl,
    atsUrl,
    atsSource,
    recruiter,
  };
}

export async function searchJobs(args: SearchJobsInput): Promise<SearchJobsOutput> {
  const { url, pageType } = buildSearchUrl(args);
  const page = await loadPage(url);
  const { jobs, companies } = findSearchNodes(page.graph, url);

  return {
    sourceUrl: url,
    pageType,
    page: args.page ?? 1,
    query: pageType === 'jobs' ? (args.query ?? null) : null,
    role: pageType === 'role' ? cleanString(args.role) : null,
    location: pageType === 'location' || pageType === 'role' ? cleanString(args.location) : null,
    market: pageType === 'jobs' ? (cleanString(args.market) ?? null) : null,
    jobs,
    companies,
  };
}

export async function getCompanyProfile(args: GetCompanyProfileInput): Promise<GetCompanyProfileOutput> {
  const companySlug = normalizeSlug(args.companySlug, 'companySlug');
  const url = canonicalCompanyProfileUrl(companySlug);
  const page = await loadPage(url);
  const companyNode = getCompanyProfileNode(page.graph, url);
  if (!companyNode) {
    throw new NotFound(`Wellfound company profile not found. URL: ${url}`);
  }
  return normalizeCompanyProfile(companyNode, url);
}

export async function listCompanyJobs(args: ListCompanyJobsInput): Promise<ListCompanyJobsOutput> {
  const companySlug = normalizeSlug(args.companySlug, 'companySlug');
  const url = canonicalCompanyJobsUrl(companySlug);
  const page = await loadPage(url);
  const companyNode = getCompanyProfileNode(page.graph, url);
  const connection = pickConnection(page.graph, url);
  if (!companyNode) {
    throw new NotFound(`Wellfound company jobs page not found. URL: ${url}`);
  }
  if (!connection) {
    throw new ContractDrift(
      `Wellfound company jobs page did not contain an embedded jobListingsConnection. URL: ${url} Available keys: ${Object.keys(page.graph).filter((key) => key.startsWith('jobListingsConnection(')).join(', ') || '(none)'}`,
    );
  }

  const company = normalizeCompanyProfile(companyNode, url);
  const companyContext: CompanyProfileLike = { ...company, __raw: companyNode };
  const rawEdges = Array.isArray(connection.node.edges)
    ? connection.node.edges
    : Array.isArray(connection.node.nodes)
      ? connection.node.nodes
      : [];
  const jobs = rawEdges
    .slice(0, args.first ?? 20)
    .map((edge) => {
      const resolvedEdge = asObject(edge) && 'node' in edge ? (edge.node ?? edge) : edge;
      return parseJobCard(resolvedEdge, url, 'jobListingsConnection edge', companyContext);
    })
    .filter((job): job is NonNullable<typeof job> => Boolean(job));

  return {
    sourceUrl: url,
    first: args.first ?? 20,
    pageSize: readNumber(connection.node, ['pageSize']) ?? rawEdges.length,
    totalPageCount: readNumber(connection.node, ['totalPageCount']),
    nextCursor: cleanString(connection.node.nextCursor) ?? cleanString(asObject(connection.node.pageInfo)?.endCursor) ?? null,
    company: {
      id: company.id,
      name: company.name,
      slug: company.slug,
      profileUrl: company.profileUrl,
      jobsUrl: company.jobsUrl,
      logoUrl: company.logoUrl,
      highConcept: company.highConcept,
      companySize: company.companySize,
      totalRaisedAmount: company.totalRaisedAmount,
      websiteUrl: company.websiteUrl,
      twitterUrl: normalizeUrl(companyNode.twitterUrl),
      linkedInUrl: normalizeUrl(companyNode.linkedInUrl),
      productHuntUrl: normalizeUrl(companyNode.productHuntUrl),
      blogUrl: normalizeUrl(companyNode.blogUrl),
      facebookUrl: normalizeUrl(companyNode.facebookUrl),
      jobPreamble: cleanString(companyNode.jobPreamble) ?? null,
      isOperating: readBoolean(companyNode, ['isOperating']),
      public: readBoolean(companyNode, ['public']),
      published: readBoolean(companyNode, ['published']),
      quarantined: readBoolean(companyNode, ['quarantined']),
      isShell: readBoolean(companyNode, ['isShell']),
      isIncubator: readBoolean(companyNode, ['isIncubator']),
    },
    jobs,
  };
}

export async function getJob(args: GetJobInput): Promise<GetJobOutput> {
  const jobId = normalizeSlug(args.jobId, 'jobId');
  const slug = normalizeSlug(args.slug, 'slug');
  const url = canonicalJobUrl(jobId, slug);
  const page = await loadPage(url);
  const jobNode = getJobDetailNode(page.graph, url);
  if (!jobNode) {
    throw new NotFound(`Wellfound job not found. URL: ${url}`);
  }
  return normalizeJobDetail(jobNode, url, page.jsonLd);
}

export {};
