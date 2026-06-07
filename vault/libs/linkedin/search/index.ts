/**
 * LinkedIn Search Operations
 *
 * People, company, and employee search functionality.
 * Uses REST endpoint /voyager/api/search/dash/clusters (no queryId required).
 */

import type {
  SearchPeopleOutput,
  SearchCompaniesOutput,
  SearchPostsOutput,
  SearchJobsOutput,
  ResolveGeoOutput,
  ResolveIndustryOutput,
  ResolveSchoolOutput,
  ResolveCompanyIdOutput,
} from '../schemas';
import {
  searchViaRest,
  searchViaGraphQL,
  searchRestFetch,
  buildEntityMap,
  linkedinFetch,
  getQueryId,
} from '../helpers';
import { Validation } from '@vallum/_runtime';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 500 + Math.floor(Math.random() * 1000);

const MAX_PAGE_SIZE = 50;
const MAX_PAGES = 50;

const CONNECTION_RANK: Record<string, number> = {
  '1st': 0,
  '2nd': 1,
  '3rd+': 2,
};

function sortByConnectionProximity(
  results: SearchPeopleOutput['results'],
): SearchPeopleOutput['results'] {
  return [...results].sort((a, b) => {
    const rankA = CONNECTION_RANK[a.connectionDegree ?? ''] ?? 3;
    const rankB = CONNECTION_RANK[b.connectionDegree ?? ''] ?? 3;
    return rankA - rankB;
  });
}

export async function searchPeople(opts: {
  csrf: string;
  keywords: string;
  network?: ('F' | 'S' | 'O')[];
  geoUrn?: string[];
  industry?: string[];
  currentCompany?: string[];
  pastCompany?: string[];
  school?: string[];
  profileLanguage?: string[];
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  serviceCategory?: string[];
  connectionOf?: string;
  start?: number;
  count?: number;
}): Promise<SearchPeopleOutput> {
  const hasKeywords =
    typeof opts.keywords === 'string' && opts.keywords.trim().length > 0;
  const hasFilter = !!(
    opts.network ||
    opts.geoUrn ||
    opts.industry ||
    opts.currentCompany ||
    opts.pastCompany ||
    opts.school ||
    opts.profileLanguage ||
    opts.firstName ||
    opts.lastName ||
    opts.title ||
    opts.company ||
    opts.serviceCategory ||
    opts.connectionOf
  );
  if (!hasKeywords && !hasFilter) {
    throw new Error(
      'searchPeople requires either `keywords` or at least one filter (e.g., firstName, lastName, currentCompany)',
    );
  }

  const count = opts.count ?? 10;
  const allResults: SearchPeopleOutput['results'] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  let start = opts.start ?? 0;
  let pages = 0;
  // LinkedIn's clusters endpoint returns ~3 EntityResults per page regardless
  // of count, so request larger pages to reduce round-trips
  const pageSize = MAX_PAGE_SIZE;

  // Build queryParameters with filters
  const queryParameters: Record<string, string[]> = {
    resultType: ['PEOPLE'],
  };
  if (opts.network) queryParameters.network = opts.network;
  if (opts.geoUrn) queryParameters.geoUrn = opts.geoUrn;
  if (opts.industry) queryParameters.industry = opts.industry;
  if (opts.currentCompany) queryParameters.currentCompany = opts.currentCompany;
  if (opts.pastCompany) queryParameters.pastCompany = opts.pastCompany;
  if (opts.school) queryParameters.schoolFilter = opts.school;
  if (opts.profileLanguage)
    queryParameters.profileLanguage = opts.profileLanguage;
  if (opts.firstName) queryParameters.firstName = [opts.firstName];
  if (opts.lastName) queryParameters.lastName = [opts.lastName];
  if (opts.title) queryParameters.title = [opts.title];
  if (opts.company) queryParameters.company = [opts.company];
  if (opts.serviceCategory)
    queryParameters.serviceCategory = opts.serviceCategory;
  if (opts.connectionOf) queryParameters.connectionOf = [opts.connectionOf];

  // Use FACETED_SEARCH origin when any filter is provided
  const hasFilters =
    opts.network ||
    opts.geoUrn ||
    opts.industry ||
    opts.currentCompany ||
    opts.pastCompany ||
    opts.school ||
    opts.profileLanguage ||
    opts.firstName ||
    opts.lastName ||
    opts.title ||
    opts.company ||
    opts.serviceCategory ||
    opts.connectionOf;
  const origin = hasFilters ? 'FACETED_SEARCH' : 'SWITCH_SEARCH_VERTICAL';

  // connectionOf requires GraphQL; the REST endpoint ignores it
  const searchFn = opts.connectionOf ? searchViaGraphQL : searchViaRest;

  while (allResults.length < count && pages < MAX_PAGES) {
    pages++;
    const page = await searchFn(opts.csrf, {
      origin,
      keywords: opts.keywords,
      queryParameters,
      start,
      count: pageSize,
    });

    if (total === undefined) {
      total = page.total;
    }

    if (page.results.length === 0) break;

    // Cross-page deduplication by memberId
    for (const r of page.results) {
      if (r.memberId && !seen.has(r.memberId)) {
        seen.add(r.memberId);
        allResults.push(r);
      }
    }

    start += pageSize;

    if (total !== undefined && start >= total) break;
    if (allResults.length >= count) break;

    await sleep(jitter());
  }

  return {
    results: sortByConnectionProximity(allResults.slice(0, count)),
    total,
  };
}

/** Parse company results from a single REST search response page. */
function parseCompanyResults(resp: {
  included?: Array<{
    $type?: string;
    trackingUrn?: string;
    title?: { text?: string };
    primarySubtitle?: { text?: string };
    secondarySubtitle?: { text?: string };
    navigationUrl?: string;
    image?: {
      attributes?: Array<{
        detailDataUnion?: {
          nonEntityCompanyLogo?: {
            vectorImage?: {
              rootUrl?: string;
              artifacts?: Array<{
                fileIdentifyingUrlPathSegment?: string;
                width?: number;
              }>;
            };
          };
        };
      }>;
    };
  }>;
}): SearchCompaniesOutput['results'] {
  const results: SearchCompaniesOutput['results'] = [];
  if (!resp.included) return results;

  for (const e of resp.included) {
    if (!e.$type?.includes('EntityResult')) continue;
    if (!e.trackingUrn?.includes('company:')) continue;

    const companyId = e.trackingUrn.split(':').pop();

    let universalName: string | undefined;
    if (e.navigationUrl) {
      const match = e.navigationUrl.match(/\/company\/([^/?]+)/);
      universalName = match ? match[1] : undefined;
    }

    // Extract logo from detailDataUnion.nonEntityCompanyLogo.vectorImage
    // rootUrl is empty; the full URL is in fileIdentifyingUrlPathSegment
    let logoUrl: string | undefined;
    const vectorImage =
      e.image?.attributes?.[0]?.detailDataUnion?.nonEntityCompanyLogo
        ?.vectorImage;
    if (vectorImage?.artifacts?.length) {
      const artifact = vectorImage.artifacts[0];
      if (artifact.fileIdentifyingUrlPathSegment) {
        logoUrl = vectorImage.rootUrl
          ? vectorImage.rootUrl + artifact.fileIdentifyingUrlPathSegment
          : artifact.fileIdentifyingUrlPathSegment;
      }
    }

    // secondarySubtitle contains follower count (e.g., "41M followers"), not employee count.
    // staffCount is not available from search results; use getCompany for employee count.

    results.push({
      companyId,
      name: e.title?.text,
      subtitle: e.primarySubtitle?.text,
      universalName,
      companyUrl: `https://www.linkedin.com/company/${universalName ?? companyId}`,
      logoUrl,
    });
  }

  return results;
}

export async function searchCompanies(opts: {
  csrf: string;
  keywords: string;
  companyHqGeo?: string[];
  companySize?: string[];
  industry?: string[];
  start?: number;
  count?: number;
}): Promise<SearchCompaniesOutput> {
  if (
    !opts.keywords ||
    typeof opts.keywords !== 'string' ||
    !opts.keywords.trim()
  ) {
    throw new Validation('keywords is required and cannot be empty');
  }

  const count = opts.count ?? 10;
  const allResults: SearchCompaniesOutput['results'] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  let start = opts.start ?? 0;
  let pages = 0;
  const pageSize = MAX_PAGE_SIZE;

  // Build queryParameters with filters
  const queryParameters: Record<string, string[]> = {
    resultType: ['COMPANIES'],
  };
  if (opts.companyHqGeo) queryParameters.companyHqGeo = opts.companyHqGeo;
  if (opts.companySize) queryParameters.companySize = opts.companySize;
  if (opts.industry) queryParameters.industry = opts.industry;

  const hasFilters = opts.companyHqGeo || opts.companySize || opts.industry;
  const origin = hasFilters ? 'FACETED_SEARCH' : 'OTHER';

  while (allResults.length < count && pages < MAX_PAGES) {
    pages++;
    const resp = await searchRestFetch(opts.csrf, {
      origin,
      keywords: opts.keywords,
      queryParameters,
      start,
      count: pageSize,
    });

    if (total === undefined) {
      total = resp.data?.metadata?.totalResultCount;
    }

    const pageResults = parseCompanyResults(resp);

    if (pageResults.length === 0) break;

    // Cross-page deduplication by companyId
    for (const r of pageResults) {
      if (r.companyId && !seen.has(r.companyId)) {
        seen.add(r.companyId);
        allResults.push(r);
      }
    }

    start += pageSize;

    if (total !== undefined && start >= total) break;
    if (allResults.length >= count) break;

    await sleep(jitter());
  }

  return {
    results: allResults.slice(0, count),
    total,
  };
}

export async function searchPosts(opts: {
  csrf: string;
  keywords: string;
  sortBy?: 'date_posted' | 'relevance';
  datePosted?: 'past-24h' | 'past-week' | 'past-month';
  contentType?: 'videos' | 'images' | 'articles' | 'documents' | 'liveVideos';
  postedBy?: 'first' | 'me' | 'following';
  authorCompany?: string;
  authorIndustry?: string;
  fromMember?: string;
  fromOrganization?: string;
  start?: number;
  count?: number;
}): Promise<SearchPostsOutput> {
  if (
    !opts.keywords ||
    typeof opts.keywords !== 'string' ||
    !opts.keywords.trim()
  ) {
    throw new Validation('keywords is required and cannot be empty');
  }

  const count = opts.count !== undefined ? opts.count : 10;
  const start = opts.start !== undefined ? opts.start : 0;

  // Build queryParameters list entries with optional filters
  const qpEntries = ['(key:resultType,value:List(CONTENT))'];
  if (opts.sortBy) qpEntries.push(`(key:sortBy,value:List(${opts.sortBy}))`);
  if (opts.datePosted)
    qpEntries.push(`(key:datePosted,value:List(${opts.datePosted}))`);
  if (opts.contentType)
    qpEntries.push(`(key:contentType,value:List(${opts.contentType}))`);
  if (opts.postedBy)
    qpEntries.push(`(key:postedBy,value:List(${opts.postedBy}))`);
  if (opts.authorCompany)
    qpEntries.push(`(key:authorCompany,value:List(${opts.authorCompany}))`);
  if (opts.authorIndustry)
    qpEntries.push(`(key:authorIndustry,value:List(${opts.authorIndustry}))`);
  if (opts.fromMember)
    qpEntries.push(`(key:fromMember,value:List(${opts.fromMember}))`);
  if (opts.fromOrganization)
    qpEntries.push(
      `(key:fromOrganization,value:List(${opts.fromOrganization}))`,
    );

  // Build GraphQL variables in LinkedIn's native tuple format
  const variables = `(start:${start},origin:GLOBAL_SEARCH_HEADER,query:(keywords:${opts.keywords},flagshipSearchIntent:SEARCH_SRP,queryParameters:List(${qpEntries.join(',')}),includeFiltersInResponse:false))`;
  const queryId = getQueryId(
    'voyagerSearchDashClusters',
    'search-cluster-collection',
  );

  const resp = await linkedinFetch<{
    data?: { metadata?: { totalResultCount?: number } };
    included?: Array<{
      $type?: string;
      entityUrn?: string;
      actor?: { name?: { text?: string }; description?: { text?: string } };
      '*socialDetail'?: string;
      metadata?: { shareUrn?: string; backendUrn?: string };
      commentary?: { text?: { text?: string } };
      createdAt?: number;
    }>;
  }>(
    opts.csrf,
    `/voyager/api/graphql?variables=${variables}&queryId=${queryId}`,
  );

  const results: SearchPostsOutput['results'] = [];
  const entityMap = buildEntityMap(resp.included);

  if (resp.included) {
    for (const e of resp.included) {
      if (!e.$type?.includes('com.linkedin.voyager.dash.feed.Update')) continue;

      // Extract activity URN from entityUrn or metadata.backendUrn
      let activityUrn: string | undefined;
      const entityUrnMatch = e.entityUrn?.match(/urn:li:activity:(\d+)/);
      if (entityUrnMatch) {
        activityUrn = `urn:li:activity:${entityUrnMatch[1]}`;
      } else if (e.metadata?.backendUrn?.includes('urn:li:activity:')) {
        activityUrn = e.metadata.backendUrn;
      }

      // Get author name and headline
      const authorName = e.actor?.name?.text;

      // Get post text from commentary
      const text = e.commentary?.text?.text;

      // Get social counts
      let reactionCount: number | undefined;
      let commentCount: number | undefined;

      if (e['*socialDetail']) {
        const socialDetail = entityMap[e['*socialDetail']] as
          | { '*totalSocialActivityCounts'?: string }
          | undefined;

        if (socialDetail?.['*totalSocialActivityCounts']) {
          const counts = entityMap[
            socialDetail['*totalSocialActivityCounts']
          ] as
            | {
                numLikes?: number;
                numComments?: number;
              }
            | undefined;

          if (counts) {
            reactionCount = counts.numLikes;
            commentCount = counts.numComments;
          }
        }
      }

      // Match SocialActivityCounts by activity URN
      if (!reactionCount && !commentCount && activityUrn) {
        for (const entity of resp.included || []) {
          const socialActivityCount = entity as {
            $type?: string;
            entityUrn?: string;
            numLikes?: number;
            numComments?: number;
            numShares?: number;
          };

          if (
            !socialActivityCount.$type?.includes(
              'com.linkedin.voyager.dash.feed.SocialActivityCounts',
            )
          )
            continue;

          if (socialActivityCount.entityUrn?.includes(activityUrn)) {
            reactionCount = socialActivityCount.numLikes;
            commentCount = socialActivityCount.numComments;
            break;
          }
        }
      }

      results.push({
        activityUrn,
        authorName,
        text,
        publishedAt: e.createdAt,
        reactionCount,
        commentCount,
      });
    }
  }

  return {
    results: results.slice(0, count),
    total: resp.data?.metadata?.totalResultCount,
  };
}

export async function searchJobs(opts: {
  csrf: string;
  keywords: string;
  location?: string;
  jobType?: string[];
  experience?: string[];
  datePosted?: string;
  workplaceType?: string[];
  sortBy?: 'date_posted' | 'relevance';
  company?: string[];
  easyApply?: boolean;
  earlyApplicant?: boolean;
  salary?: string[];
  industry?: string[];
  jobFunction?: string[];
  titleId?: string[];
  commitments?: string[];
  benefits?: string[];
  fairChanceEmployer?: boolean;
  verifications?: boolean;
  jobInYourNetwork?: boolean;
  populatedPlace?: string[];
  start?: number;
  count?: number;
}): Promise<SearchJobsOutput> {
  if (
    !opts.keywords ||
    typeof opts.keywords !== 'string' ||
    !opts.keywords.trim()
  ) {
    throw new Validation('keywords is required and cannot be empty');
  }

  const count = opts.count ?? 10;
  const start = opts.start ?? 0;

  // Build query with optional location
  let queryParts = `origin:JOB_SEARCH_PAGE_OTHER_ENTRY,keywords:${encodeURIComponent(opts.keywords)},spellCorrectionEnabled:true`;
  if (opts.location) {
    queryParts += `,locationUnion:(seoLocation:(location:${encodeURIComponent(opts.location)}))`;
  }

  // Build selectedFilters for job-specific filters
  const filters: string[] = [];
  if (opts.jobType) filters.push(`jobType:List(${opts.jobType.join(',')})`);
  if (opts.experience)
    filters.push(`experience:List(${opts.experience.join(',')})`);
  if (opts.datePosted) filters.push(`timePostedRange:List(${opts.datePosted})`);
  if (opts.workplaceType)
    filters.push(`workplaceType:List(${opts.workplaceType.join(',')})`);
  // NEW: Add new filters
  if (opts.sortBy === 'date_posted') filters.push('sortBy:List(DD)');
  if (opts.company) filters.push(`company:List(${opts.company.join(',')})`);
  if (opts.easyApply) filters.push('applyWithLinkedin:List(true)');
  if (opts.earlyApplicant) filters.push('earlyApplicant:List(true)');
  if (opts.salary)
    filters.push(`salaryBucketV2:List(${opts.salary.join(',')})`);
  if (opts.industry) filters.push(`industry:List(${opts.industry.join(',')})`);
  if (opts.jobFunction)
    filters.push(`function:List(${opts.jobFunction.join(',')})`);
  if (opts.titleId) filters.push(`title:List(${opts.titleId.join(',')})`);
  if (opts.commitments)
    filters.push(`commitments:List(${opts.commitments.join(',')})`);
  if (opts.benefits) filters.push(`benefits:List(${opts.benefits.join(',')})`);
  if (opts.fairChanceEmployer) filters.push('fairChanceEmployer:List(true)');
  if (opts.verifications) filters.push('verifiedJob:List(true)');
  if (opts.jobInYourNetwork) filters.push('jobInYourNetwork:List(true)');
  if (opts.populatedPlace)
    filters.push(`populatedPlace:List(${opts.populatedPlace.join(',')})`);

  if (filters.length > 0) {
    queryParts += `,selectedFilters:(${filters.join(',')})`;
  }

  const resp = await linkedinFetch<{
    data?: { paging?: { total?: number } };
    included?: Array<{
      $type?: string;
      entityUrn?: string;
      jobPostingTitle?: string;
      jobPostingUrn?: string;
      primaryDescription?: { text?: string };
      secondaryDescription?: { text?: string };
      tertiaryDescription?: { text?: string };
      footerItems?: Array<{ type?: string; timeAt?: number }>;
      title?: string;
    }>;
  }>(
    opts.csrf,
    `/voyager/api/voyagerJobsDashJobCards?decorationId=com.linkedin.voyager.dash.deco.jobs.search.JobSearchCardsCollection-220&count=${count}&q=jobSearch&query=(${queryParts})&start=${start}`,
  );

  const results: SearchJobsOutput['results'] = [];

  if (resp.included) {
    for (const e of resp.included) {
      if (e.$type !== 'com.linkedin.voyager.dash.jobs.JobPostingCard') continue;
      // Skip JOB_DETAILS variant cards (empty placeholders); only use JOBS_SEARCH cards
      if (e.entityUrn && !e.entityUrn.includes('JOBS_SEARCH')) continue;

      const jobId = e.jobPostingUrn?.match(/fsd_jobPosting:(\d+)/)?.[1];
      const listedAt = e.footerItems?.find(
        (f) => f.type === 'LISTED_DATE',
      )?.timeAt;

      results.push({
        jobId,
        title: e.jobPostingTitle,
        company: e.primaryDescription?.text,
        location: e.secondaryDescription?.text,
        salary: e.tertiaryDescription?.text,
        listedAt,
        jobUrl: jobId
          ? `https://www.linkedin.com/jobs/view/${jobId}/`
          : undefined,
      });
    }
  }

  return {
    results: results.slice(0, count),
    total: resp.data?.paging?.total,
  };
}

// ============================================================================
// Typeahead Resolver
// ============================================================================

type TypeaheadType =
  | 'GEO'
  | 'SCHOOL'
  | 'COMPANY'
  | 'INDUSTRY'
  | 'TITLE'
  | 'SKILL'
  | 'PEOPLE';

interface TypeaheadResult {
  name: string;
  id: string;
  subtitle?: string;
  urn: string;
}

async function typeaheadSearch(
  csrf: string,
  keywords: string,
  type: TypeaheadType,
  count: number = 10,
): Promise<TypeaheadResult[]> {
  const vars = `(keywords:${keywords},query:(),type:${type},start:0,count:${count})`;
  const queryId = getQueryId(
    'voyagerSearchDashReusableTypeahead',
    'search-reusable-typeahead-collection-finder-type-query',
  );
  const resp = await linkedinFetch<{
    data?: {
      data?: {
        searchDashReusableTypeaheadByType?: {
          elements?: Array<{
            title?: { text?: string };
            subtitle?: { text?: string };
            trackingUrn?: string;
          }>;
        };
      };
    };
  }>(csrf, `/voyager/api/graphql?variables=${vars}&queryId=${queryId}`);

  const elements =
    resp.data?.data?.searchDashReusableTypeaheadByType?.elements || [];
  return elements
    .filter((e) => e.title?.text && e.trackingUrn)
    .map((e) => ({
      name: e.title!.text!,
      id: e.trackingUrn!.split(':').pop()!,
      subtitle: e.subtitle?.text,
      urn: e.trackingUrn!,
    }));
}

export async function resolveGeo(opts: {
  csrf: string;
  query: string;
}): Promise<ResolveGeoOutput> {
  if (!opts.query?.trim()) {
    throw new Validation('query is required and cannot be empty');
  }
  const results = await typeaheadSearch(opts.csrf, opts.query.trim(), 'GEO');
  return {
    results: results.map((r) => ({ geoUrn: r.id, name: r.name })),
  };
}

export async function resolveIndustry(opts: {
  csrf: string;
  query: string;
}): Promise<ResolveIndustryOutput> {
  if (!opts.query?.trim()) {
    throw new Validation('query is required and cannot be empty');
  }
  const results = await typeaheadSearch(
    opts.csrf,
    opts.query.trim(),
    'INDUSTRY',
  );
  return {
    results: results.map((r) => ({ industryCode: r.id, name: r.name })),
  };
}

export async function resolveSchool(opts: {
  csrf: string;
  query: string;
}): Promise<ResolveSchoolOutput> {
  if (!opts.query?.trim()) {
    throw new Validation('query is required and cannot be empty');
  }
  const results = await typeaheadSearch(opts.csrf, opts.query.trim(), 'SCHOOL');
  return {
    results: results.map((r) => ({ schoolId: r.id, name: r.name })),
  };
}

export async function resolveCompanyId(opts: {
  csrf: string;
  query: string;
}): Promise<ResolveCompanyIdOutput> {
  if (!opts.query?.trim()) {
    throw new Validation('query is required and cannot be empty');
  }
  const query = opts.query.trim();
  const resp = await searchRestFetch(opts.csrf, {
    origin: 'OTHER',
    keywords: query,
    queryParameters: { resultType: ['COMPANIES'] },
    start: 0,
    count: 10,
  });
  const companies = parseCompanyResults(resp).filter(
    (c) => c.companyId && c.name,
  );
  const q = query.toLowerCase();
  const score = (name: string): number => {
    const n = name.toLowerCase();
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    return 3;
  };
  const ranked = [...companies].sort((a, b) => score(a.name!) - score(b.name!));
  return {
    results: ranked.map((c) => ({ companyId: c.companyId!, name: c.name! })),
  };
}
