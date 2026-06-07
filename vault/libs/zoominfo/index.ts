/**
 * ZoomInfo Library
 *
 * Browser-executable ZoomInfo operations via internal APIs.
 * Requires user to be logged into ZoomInfo at app.zoominfo.com.
 */

import { Validation, NotFound, UpstreamError, Unauthenticated, throwForStatus } from '@vallum/_runtime';

import type {
  GetContextInput,
  GetContextOutput,
  SearchContactsInput,
  SearchContactsOutput,
  CreateTagInput,
  CreateTagOutput,
  UpdateTagInput,
  UpdateTagOutput,
  SearchCompaniesInput,
  SearchCompaniesOutput,
  ListTagsInput,
  ListTagsOutput,
  DeleteTagInput,
  DeleteTagOutput,
  GetCreditsInput,
  GetCreditsOutput,
  GetCompanyNewsInput,
  GetCompanyNewsOutput,
  GetContactInput,
  GetContactOutput,
  GetCompanyInput,
  GetCompanyOutput,
  GetCompanyEmployeesInput,
  GetCompanyEmployeesOutput,
  ListSavedSearchesInput,
  ListSavedSearchesOutput,
  RunSavedSearchInput,
  RunSavedSearchOutput,
  ListListsInput,
  ListListsOutput,
  TagContactsInput,
  TagContactsOutput,
  TagCompaniesInput,
  TagCompaniesOutput,
  UntagContactsInput,
  UntagContactsOutput,
  UntagCompaniesInput,
  UntagCompaniesOutput,
  GetScoopsInput,
  GetScoopsOutput,
  GetCompanyTechnographicsInput,
  GetCompanyTechnographicsOutput,
  DeleteSavedSearchInput,
  DeleteSavedSearchOutput,
  GetContactTagsInput,
  GetContactTagsOutput,
  GetCompanyTagsInput,
  GetCompanyTagsOutput,
  GetIcpConfigInput,
  GetIcpConfigOutput,
  ListWebsightsDomainsInput,
  ListWebsightsDomainsOutput,
} from './schemas';

export type {
  GetContextInput,
  GetContextOutput,
  SearchContactsInput,
  SearchContactsOutput,
  CreateTagInput,
  CreateTagOutput,
  UpdateTagInput,
  UpdateTagOutput,
  SearchCompaniesInput,
  SearchCompaniesOutput,
  ListTagsInput,
  ListTagsOutput,
  DeleteTagInput,
  DeleteTagOutput,
  GetCreditsInput,
  GetCreditsOutput,
  GetCompanyNewsInput,
  GetCompanyNewsOutput,
  GetContactInput,
  GetContactOutput,
  GetCompanyInput,
  GetCompanyOutput,
  GetCompanyEmployeesInput,
  GetCompanyEmployeesOutput,
  ListSavedSearchesInput,
  ListSavedSearchesOutput,
  RunSavedSearchInput,
  RunSavedSearchOutput,
  ListListsInput,
  ListListsOutput,
  TagContactsInput,
  TagContactsOutput,
  TagCompaniesInput,
  TagCompaniesOutput,
  UntagContactsInput,
  UntagContactsOutput,
  UntagCompaniesInput,
  UntagCompaniesOutput,
  GetScoopsInput,
  GetScoopsOutput,
  GetCompanyTechnographicsInput,
  GetCompanyTechnographicsOutput,
  DeleteSavedSearchInput,
  DeleteSavedSearchOutput,
  GetContactTagsInput,
  GetContactTagsOutput,
  GetCompanyTagsInput,
  GetCompanyTagsOutput,
  GetIcpConfigInput,
  GetIcpConfigOutput,
  ListWebsightsDomainsInput,
  ListWebsightsDomainsOutput,
};

// ============================================================================
// Auth helpers
// ============================================================================

function getCookie(name: string): string | null {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
}

function buildAuthHeaders(): Record<string, string> {
  const accessToken = getCookie('ziaccesstoken');
  const ziid = getCookie('ziid');
  const zisession = getCookie('zisession');

  if (!accessToken) {
    throw new Unauthenticated(
      `ZoomInfo auth cookie 'ziaccesstoken' not found. Ensure you are logged in at ${window.location.origin}`,
    );
  }
  if (!ziid) {
    throw new Unauthenticated(
      `ZoomInfo auth cookie 'ziid' not found. Ensure you are logged in at ${window.location.origin}`,
    );
  }
  if (!zisession) {
    throw new Unauthenticated(
      `ZoomInfo auth cookie 'zisession' not found. Ensure you are logged in at ${window.location.origin}`,
    );
  }

  return {
    'Content-Type': 'application/json',
    'x-ziaccesstoken': accessToken,
    'x-ziid': ziid,
    'x-zisession': zisession,
    'x-sourceid': 'ZI_FOR_SALES',
    'x-requested-with': 'XMLHttpRequest',
    'session-token': '1',
  };
}

async function ziGet<T>(path: string): Promise<T> {
  const origin = window.location.origin;
  const url = `${origin}${path}`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: buildAuthHeaders(),
    credentials: 'include',
  });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
  return resp.json() as Promise<T>;
}

async function ziPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const origin = window.location.origin;
  const url = `${origin}${path}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: buildAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
  return resp.json() as Promise<T>;
}

async function ziPut<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const origin = window.location.origin;
  const url = `${origin}${path}`;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: buildAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
  return resp.json() as Promise<T>;
}

async function ziDelete(path: string): Promise<void> {
  const origin = window.location.origin;
  const url = `${origin}${path}`;
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
    credentials: 'include',
  });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
}

async function ziGraphQLInline<T>(path: string, query: string): Promise<T> {
  const origin = window.location.origin;
  const url = `${origin}${path}`;
  const headers = buildAuthHeaders();

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
  const json = (await resp.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new UpstreamError(
      `GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`,
    );
  }
  if (!json.data) {
    throw new UpstreamError(`GraphQL request to ${path} returned no data`);
  }
  return json.data;
}

// ============================================================================
// GraphQL inline param helpers
// ============================================================================

/**
 * Serialize a value as an inline GraphQL argument value.
 * Used for companySearch (variables approach gives Validation Error for companySearch).
 */
function serializeGqlValue(val: unknown): string {
  if (typeof val === 'string') {
    return JSON.stringify(val);
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return String(val);
  }
  if (Array.isArray(val)) {
    return `[${val.map(serializeGqlValue).join(', ')}]`;
  }
  if (val !== null && typeof val === 'object') {
    const entries = Object.entries(val as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}: ${serializeGqlValue(v)}`);
    return `{${entries.join(', ')}}`;
  }
  return String(val);
}

function buildInlineParams(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${serializeGqlValue(v)}`)
    .join(', ');
}

// ============================================================================
// getContext
// ============================================================================

export async function getContext(
  _args: GetContextInput,
): Promise<GetContextOutput> {
  const data = await ziGet<{
    _id: string;
    email: string;
    name: string;
    username: string;
    company: string | null;
    credits: number | null;
    zoom_account_id: number | null;
    zoom_company_id: number | null;
    isAdmin: boolean | null;
    productTier: string | null;
    csvExportAllowed: boolean | null;
    zoomEnterprise: boolean | null;
    phoneVerified: boolean | null;
    platforms: string[] | null;
    accessStatus?: {
      accessLevel: number | null;
    };
    userZoominfo?: {
      productInfo?: {
        productCode: string | null;
        name: string | null;
        expirationDate: number | null;
      };
      usageInfo?: {
        remainingCredits: number | null;
        remainingViews: number | null;
        viewCount: number | null;
        companyViewLimit: number | null;
      };
    };
  }>('/anura/userData/userDetails');

  const expirationMs = data.userZoominfo?.productInfo?.expirationDate;

  return {
    userId: data._id,
    email: data.email,
    name: data.name,
    username: data.username,
    company: data.company,
    credits: data.credits,
    zoomAccountId: data.zoom_account_id,
    zoomCompanyId: data.zoom_company_id,
    isAdmin: data.isAdmin,
    productTier: data.productTier,
    csvExportAllowed: data.csvExportAllowed,
    remainingCredits: data.userZoominfo?.usageInfo?.remainingCredits ?? null,
    remainingViews: data.userZoominfo?.usageInfo?.remainingViews ?? null,
    viewCount: data.userZoominfo?.usageInfo?.viewCount ?? null,
    companyViewLimit: data.userZoominfo?.usageInfo?.companyViewLimit ?? null,
    zoomEnterprise: data.zoomEnterprise,
    phoneVerified: data.phoneVerified,
    platforms: data.platforms,
    productName: data.userZoominfo?.productInfo?.name ?? null,
    productCode: data.userZoominfo?.productInfo?.productCode ?? null,
    productExpirationDate: expirationMs
      ? new Date(expirationMs).toISOString()
      : null,
    accessLevel: data.accessStatus?.accessLevel ?? null,
  };
}

// ============================================================================
// searchContacts
// ============================================================================

export async function searchContacts(
  args: SearchContactsInput,
): Promise<SearchContactsOutput> {
  const rpp = Math.min(args.rpp ?? 25, 25);
  const page = args.page ?? 1;

  const sortField = args.sortBy ?? 'Relevance';
  const sortDir = args.sortOrder ?? 'desc';

  const boardMembers = args.boardMembers ?? 'exclude';
  const returnOnlyBoardMembers = boardMembers === 'only';
  const excludeBoardMembers = boardMembers === 'exclude';

  const searchFacadeParams: Record<string, unknown> = {
    page,
    companyPastOrPresent: '1',
    isCertified: 'include',
    sortBy: `${sortField},person_id`,
    sortOrder: `${sortDir},desc`,
    excludeDefunctCompanies: true,
    confidenceScoreMin: args.confidenceScoreMin ?? 85,
    confidenceScoreMax: args.confidenceScoreMax ?? 99,
    outputCurrencyCode: 'USD',
    inputCurrencyCode: 'USD',
    excludeNoCompany: 'true',
    returnOnlyBoardMembers,
    excludeBoardMembers,
    rpp,
    useUnifiedSearch: true,
  };

  if (args.companyName !== undefined)
    searchFacadeParams.companyName = args.companyName;
  if (args.companyIds !== undefined) {
    searchFacadeParams.companyIdQuery = {
      longTermList: {
        values: args.companyIds.map((c) => ({ value: c.value, negate: false })),
      },
      valueJoinOperator: 'OR',
    };
  }
  if (args.state !== undefined) searchFacadeParams.state = args.state;
  if (args.country !== undefined) searchFacadeParams.country = args.country;
  if (args.fullName !== undefined) searchFacadeParams.fullName = args.fullName;
  if (args.titleSeniority !== undefined)
    searchFacadeParams.titleSeniority = args.titleSeniority;
  if (args.contactRequirements !== undefined)
    searchFacadeParams.contactRequirements = args.contactRequirements;
  if (args.companyType !== undefined)
    searchFacadeParams.companyType = args.companyType;
  if (args.zipCode !== undefined) searchFacadeParams.zipCode = args.zipCode;
  if (args.personTitle !== undefined)
    searchFacadeParams.personTitle = args.personTitle;
  if (args.emailAddress !== undefined)
    searchFacadeParams.emailAddress = args.emailAddress;
  if (args.school !== undefined) searchFacadeParams.school = args.school;
  if (args.industryKeywords !== undefined)
    searchFacadeParams.industryKeywords = args.industryKeywords;
  if (args.companyDesc !== undefined)
    searchFacadeParams.companyDesc = args.companyDesc;
  if (args.industryCodeList !== undefined)
    searchFacadeParams.industryCodeList = args.industryCodeList;
  if (args.hasBeenNotified !== undefined)
    searchFacadeParams.hasBeenNotified = args.hasBeenNotified;
  if (args.showOnlyUltimateParent !== undefined)
    searchFacadeParams.showOnlyUltimateParent = args.showOnlyUltimateParent;
  if (args.currentCompanyStartDate !== undefined)
    searchFacadeParams.currentCompanyStartDate = args.currentCompanyStartDate;
  if (args.personCreationStartDate !== undefined)
    searchFacadeParams.personCreationStartDate = args.personCreationStartDate;
  if (args.employeeSizeMin !== undefined)
    searchFacadeParams.employeeSizeMin = args.employeeSizeMin;
  if (args.employeeSizeMax !== undefined)
    searchFacadeParams.employeeSizeMax = args.employeeSizeMax;
  if (args.revenueMinIn000s !== undefined)
    searchFacadeParams.revenueMinIn000s = args.revenueMinIn000s;
  if (args.revenueMaxIn000s !== undefined)
    searchFacadeParams.revenueMaxIn000s = args.revenueMaxIn000s;
  if (args.totalFundingAmountMinIn000s !== undefined)
    searchFacadeParams.totalFundingAmountMinIn000s =
      args.totalFundingAmountMinIn000s;
  if (args.totalFundingAmountMaxIn000s !== undefined)
    searchFacadeParams.totalFundingAmountMaxIn000s =
      args.totalFundingAmountMaxIn000s;
  if (args.pageRank !== undefined) searchFacadeParams.pageRank = args.pageRank;
  if (args.pTag !== undefined) searchFacadeParams.pTag = args.pTag;
  if (args.cTag !== undefined) searchFacadeParams.cTag = args.cTag;
  if (args.excludePeopleTags !== undefined)
    searchFacadeParams.excludePeopleTags = args.excludePeopleTags;
  if (args.excludeCompanyTags !== undefined)
    searchFacadeParams.excludeCompanyTags = args.excludeCompanyTags;
  if (args.pList !== undefined) searchFacadeParams.pList = args.pList;
  if (args.cList !== undefined) searchFacadeParams.cList = args.cList;
  if (args.scoopTopics !== undefined)
    searchFacadeParams.scoopTopics = args.scoopTopics;
  if (args.scoopTypes !== undefined)
    searchFacadeParams.scoopTypes = args.scoopTypes;
  if (args.companyRanking !== undefined)
    searchFacadeParams.companyRanking = args.companyRanking;

  const gqlQuery =
    'query personSearch($searchFacadeParams: PersonArgs) { personSearch(searchFacadeParams: $searchFacadeParams) { totalResults maxResults data { companyID companyLogo companyName companyAddress { Street City State Zip CountryCode } companyRevenue companyRevenueRange companyEmployees companyDomain companyPhone mobilePhone phone companyRevenueIn000s doziIndustry { displayName name isPrimary score } companyType certified topLevelIndustry isMasked isTagged title jobTitle jobFunction orgChartJobFunction { department departmentId jobFunction jobFunctionId } managementLevel personID firstName lastName email location { City State CountryCode metroArea } lastUpdatedDate confidenceScore name socialUrlsParsed { linkedin facebook twitter youtube } positionStartDate employmentHistory { companyName from to jobFunction title level companyID companyWebsite } } } }';

  const data = await ziPost<{
    data: {
      personSearch: {
        totalResults: number;
        maxResults: number;
        data: Array<Record<string, unknown>>;
      };
    };
    errors?: Array<{ message: string }>;
  }>('/profiles/graphql/personSearch', {
    operationName: 'personSearch',
    variables: {
      searchFacadeParams,
    },
    query: gqlQuery,
  });

  if (data.errors?.length) {
    throw new UpstreamError(
      `GraphQL error: ${data.errors.map((e) => e.message).join(', ')}`,
    );
  }
  if (!data.data) {
    throw new UpstreamError('personSearch returned no data');
  }

  return {
    totalResults: data.data.personSearch.totalResults,
    maxResults: data.data.personSearch.maxResults,
    data: data.data.personSearch.data as SearchContactsOutput['data'],
  };
}

// ============================================================================
// createTag
// ============================================================================

export async function createTag(
  args: CreateTagInput,
): Promise<CreateTagOutput> {
  const tagType = args.type ?? 'CONTACT';
  const body: Record<string, unknown> = {
    tagName: args.name,
    tagType,
  };

  const data = await ziPost<{
    tagId: number;
    accountId: number;
    companyId: number;
    tagName: string;
    type: string;
    creationDate: string;
  }>('/ziapi/user-tags/v3/user/tag/create', body);

  return {
    tagId: data.tagId,
    accountId: data.accountId,
    companyId: data.companyId,
    tagName: data.tagName,
    tagType: data.type as CreateTagOutput['tagType'],
    creationDate: data.creationDate,
  };
}

// ============================================================================
// updateTag
// ============================================================================

export async function updateTag(
  args: UpdateTagInput,
): Promise<UpdateTagOutput> {
  const data = await ziPut<{
    tagId: number;
    accountId: number;
    companyId: number;
    tagName: string;
    type: string;
    creationDate: string;
  }>('/ziapi/user-tags/v3/user/tag/update', {
    tagId: args.tagId,
    tagName: args.tagName,
  });

  return {
    tagId: data.tagId,
    accountId: data.accountId,
    companyId: data.companyId,
    tagName: data.tagName,
    tagType: data.type as UpdateTagOutput['tagType'],
    creationDate: data.creationDate,
  };
}

// ============================================================================
// searchCompanies
// ============================================================================

export async function searchCompanies(
  args: SearchCompaniesInput,
): Promise<SearchCompaniesOutput> {
  const rpp = Math.min(args.rpp ?? 25, 25);
  const page = args.page ?? 1;

  const sortBy = args.sortBy ?? 'Relevance';
  const sortOrder = args.sortOrder ?? 'desc';

  const params: Record<string, unknown> = {
    page,
    companyPastOrPresent: '1',
    isCertified: args.isCertified ?? 'include',
    sortBy,
    sortOrder,
    excludeDefunctCompanies: args.excludeDefunctCompanies ?? true,
    confidenceScoreMin: 85,
    confidenceScoreMax: 99,
    outputCurrencyCode: 'USD',
    inputCurrencyCode: 'USD',
    excludeNoCompany: 'true',
    returnOnlyBoardMembers: false,
    excludeBoardMembers: true,
    rpp,
    useUnifiedSearch: true,
  };

  if (args.companyName !== undefined) params.companyName = args.companyName;
  if (args.location !== undefined) params.location = args.location;
  if (args.country !== undefined) params.country = args.country;
  if (args.companyType !== undefined) params.companyType = args.companyType;
  if (args.businessModel !== undefined) {
    const tag = `#${args.businessModel.toLowerCase()}`;
    params.businessModelhashtagField = tag;
    params.hashtagField = tag;
  }
  if (args.employeeSizeMin !== undefined)
    params.employeeSizeMin = args.employeeSizeMin;
  if (args.employeeSizeMax !== undefined)
    params.employeeSizeMax = args.employeeSizeMax;
  if (args.revenueMinIn000s !== undefined)
    params.revenueMinIn000s = args.revenueMinIn000s;
  if (args.revenueMaxIn000s !== undefined)
    params.revenueMaxIn000s = args.revenueMaxIn000s;
  if (args.alexaRankMin !== undefined) params.alexaRankMin = args.alexaRankMin;
  if (args.alexaRankMax !== undefined) params.alexaRankMax = args.alexaRankMax;
  if (args.zipCode !== undefined) params.zipCode = args.zipCode;
  if (args.industryKeywords !== undefined)
    params.industryKeywords = args.industryKeywords;
  if (args.doziIndustryQuery !== undefined)
    params.doziIndustryQuery = args.doziIndustryQuery;

  const query = `query {
  companySearch(searchFacadeParams: {${buildInlineParams(params)}}) {
    totalResults
    maxResults
    data {
      companyID: id
      companyLogo: logo
      companyName: name
      location: address { Street City State Zip CountryCode }
      revenue
      revenueRange
      employees: employeeCount
      employeesRange
      companyDomain: domain
      companyDescription: description
      companyPhone: phone
      companyRevenueIn000s
      companyType: type
      topLevelIndustry
      totalFundingAmountIn000s
      isDefunct
      isMasked: masked
      isTagged: tagged
      certified
      certificationDate
      doziIndustry { displayName name isPrimary score }
      funding { amountIn000s date round investors { companyName investorName investorDomain investorCompanyId } }
    }
  }
}`;

  const data = await ziGraphQLInline<{
    companySearch: {
      totalResults: number;
      maxResults: number;
      data: Array<Record<string, unknown>>;
    };
  }>('/profiles/graphql/companySearch', query);

  return {
    totalResults: data.companySearch.totalResults,
    maxResults: data.companySearch.maxResults,
    data: data.companySearch.data as SearchCompaniesOutput['data'],
  };
}

// ============================================================================
// listTags
// ============================================================================

const DEFAULT_TAG_TYPES = [
  'CONTACT',
  'COMPANY',
  'PUBLIC_CONTACT',
  'PUBLIC_COMPANY',
];

export async function listTags(args: ListTagsInput): Promise<ListTagsOutput> {
  const types = (args.type ?? DEFAULT_TAG_TYPES).join(',');
  const data = await ziGet<{
    userTags: Array<{
      tagId: number;
      accountId: number;
      companyId: number;
      tagName: string;
      type: string;
      creationDate: string;
    }>;
  }>(`/ziapi/user-tags/v3/tags/byTypes?type=${types}`);

  return {
    tags: data.userTags.map((tag) => ({
      tagId: tag.tagId,
      accountId: tag.accountId,
      companyId: tag.companyId,
      tagName: tag.tagName,
      tagType: tag.type as ListTagsOutput['tags'][number]['tagType'],
      creationDate: tag.creationDate,
    })),
  };
}

// ============================================================================
// deleteTag
// ============================================================================

export async function deleteTag(
  args: DeleteTagInput,
): Promise<DeleteTagOutput> {
  await ziDelete(`/ziapi/user-tags/v3/user/tag/deleteById?tagId=${args.tagId}`);
  return { success: true };
}

// ============================================================================
// getCredits
// ============================================================================

export async function getCredits(
  _args: GetCreditsInput,
): Promise<GetCreditsOutput> {
  const data = await ziGet<{
    bulkAvailableCredits: number;
    bulkUserCreditLimit: number;
    totalRemainingCredits: number;
    recurringAvailableCredits: number;
    recurringUserQuota: number;
    companyHasCredits: boolean;
    hasUnlimitedBulkUserCreditLimit: boolean;
    creditLimitTermType: string | null;
  }>('/ziapi/credit-mgmt/external/credit/usage');

  return {
    bulkAvailableCredits: data.bulkAvailableCredits,
    bulkUserCreditLimit: data.bulkUserCreditLimit,
    totalRemainingCredits: data.totalRemainingCredits,
    recurringAvailableCredits: data.recurringAvailableCredits,
    recurringUserQuota: data.recurringUserQuota,
    companyHasCredits: data.companyHasCredits,
    hasUnlimitedBulkUserCreditLimit: data.hasUnlimitedBulkUserCreditLimit,
    creditLimitTermType: data.creditLimitTermType,
  };
}

// ============================================================================
// getCompanyNews
// ============================================================================

export async function getCompanyNews(
  args: GetCompanyNewsInput,
): Promise<GetCompanyNewsOutput> {
  const count = args.count ?? 10;
  const sortByField = args.sortByField ?? 'pageDate';
  const sortDirection = args.sortDirection ?? 'desc';
  const params = new URLSearchParams();
  params.set('numberOfFeeds', String(count));
  params.set('sortByField', sortByField);
  params.set('sortDirection', sortDirection);
  if (args.categories !== undefined) params.set('categories', args.categories);
  if (args.pageNumber !== undefined)
    params.set('pageNumber', String(args.pageNumber));

  const data = await ziGet<{
    success: boolean;
    value: {
      companyId: number[];
      maxResults: number;
      docs: Array<{
        domain: string;
        url: string;
        pageDate: string;
        title: string;
        categories: string[];
        companyName: string[];
        company_id: number[];
        image_url?: string | null;
        content?: string;
      }>;
    };
  }>(
    `/ziapi/newsfeed/news/${args.companyId}/company/companyV2?${params.toString()}`,
  );

  const articles = data.value.docs.map((doc) => ({
    title: doc.title,
    url: doc.url,
    domain: doc.domain,
    pageDate: doc.pageDate,
    categories: doc.categories,
    content: doc.content ?? '',
    imageUrl: doc.image_url ?? null,
    companyName: doc.companyName,
    companyId: doc.company_id,
  }));

  return {
    articles: articles.slice(0, count),
    maxResults: data.value.maxResults,
  };
}

// ============================================================================
// getContact
// ============================================================================

export async function getContact(
  args: GetContactInput,
): Promise<GetContactOutput> {
  const params: Record<string, unknown> = {
    personIds: String(args.personId),
    page: 1,
    rpp: 1,
    excludeBoardMembers: false,
    excludeNoCompany: false,
    useUnifiedSearch: true,
    outputFieldOptions:
      'd_address_street,d_address_city,d_address_country,d_address_metroarea,d_address_region,d_address_postal,d_resume,timezone,org_chart_tier,d_education,d_primary_title,job_function,d_reference-other,d_reference-news,d_reference-corp,social_urls,d_external_url,founding_year,alexa_rank,person_automated_bio,person_biography',
  };

  if (args.unmaskEmailAndPhone !== undefined)
    params.unmaskEmailAndPhone = args.unmaskEmailAndPhone;
  if (args.fetchLeadIndicator !== undefined)
    params.fetchLeadIndicator = args.fetchLeadIndicator;
  if (args.fetchLeadStatus !== undefined)
    params.fetchLeadStatus = args.fetchLeadStatus;

  const query = `query {
  personSearch(searchFacadeParams: {${buildInlineParams(params)}}) {
    totalResults
    maxResults
    data {
      personID firstName lastName middleInitial name title jobTitle managementLevel
      companyID companyName companyDomain companyEmployees companyRevenue
      companyRevenueIn000s companyRevenueRange companyType
      email phone mobilePhone companyPhone personalEmail
      timezone certified currentCompanyStartDate
      topLevelIndustry icpScore profileImageURL
      location { City State CountryCode metroArea }
      companyAddress { Street City State Zip CountryCode }
      personBiography orgChartTier
      orgChartJobFunction { department departmentId jobFunction jobFunctionId }
      socialUrlsParsed { linkedin facebook twitter youtube }
      doziIndustry { displayName name isPrimary score }
      education { school degree { areaOfStudy degree } }
      employmentHistory { companyName from to jobFunction title level companyID companyWebsite }
      webReference { description title url date }
      hasLeadIndicator leadStatus
      confidenceScore lastUpdatedDate isMasked isTagged
      isEmailUnsubscribed
      emailBlocked personalEmailBlocked mobilePhoneBlocked directPhoneBlocked companyPhoneBlocked
      emailBlockedReason personalEmailBlockedReason mobilePhoneBlockedReason directPhoneBlockedReason companyPhoneBlockedReason
      directPhoneIsDoNotCall mobilePhoneIsDoNotCall
    }
  }
}`;

  const gqlData = await ziGraphQLInline<{
    personSearch: {
      totalResults: number;
      maxResults: number;
      data: Array<Record<string, unknown>>;
    };
  }>('/profiles/graphql/personSearch', query);

  const records = gqlData.personSearch.data;
  if (!records || records.length === 0) {
    throw new NotFound(
      `No contact found for personId ${args.personId}. The person may not exist or may not be accessible.`,
    );
  }

  return records[0] as GetContactOutput;
}

// ============================================================================
// getCompany
// ============================================================================

export async function getCompany(
  args: GetCompanyInput,
): Promise<GetCompanyOutput> {
  const params: Record<string, unknown> = {
    companyIds: String(args.companyId),
    excludeDefunctCompanies: false,
    useUnifiedSearch: true,
    rpp: 1,
    outputFieldOptions:
      'naics_codes,sic_codes,social_urls,d_funding,d_ticker,founding_year,alexa_rank,d_company_competitors,d_products,d_emp_growth_data_points,one_year_emp_growth,two_year_emp_growth,location_count,family_tree,d_headquarters_fax,d_indexes,d_industry,dozi_industries',
  };

  // Use data field (same pattern as searchCompanies; base field only works with variables approach)
  const query = `query {
  companySearch(searchFacadeParams: {${buildInlineParams(params)}}) {
    totalResults
    data {
      id
      name
      description
      domain
      phone
      fax
      ticker
      address { Street City State Zip CountryCode }
      displayAddress
      employeeCount
      employeeCountRange
      revenue
      revenueRange
      companyRevenueIn000s
      totalFundingAmountIn000s
      doziIndustry { displayName name isPrimary score }
      allIndustries
      NAICS
      SIC
      isDefunct
      certified
      certificationDate
      logo
      foundedYear
      alexaRank
      locationsCount
      ranking
      alternateNames
      socialUrlsParsed { linkedin facebook twitter youtube }
      followerCountParsed { linkedin facebook twitter youtube }
      ultimateParent { id name }
      directParent { id name }
      subUnitTypeInfo { type typeDescription }
      competitors { companyId companyName domain revenue employeeCount }
      products { value displayName }
      merger { companyId companyName zoomUrl }
      funding { amountIn000s date round investors { companyName investorName investorDomain investorCompanyId } }
      departmentBudgets { departmentType budgetAmount }
      companyEmployeeGrowth { oneYearEmployeeGrowthRate twoYearEmployeeGrowthRate employeeGrowthData { label employeeCount } }
    }
  }
}`;

  const gqlData = await ziGraphQLInline<{
    companySearch: {
      totalResults: number;
      data: Array<Record<string, unknown>>;
    };
  }>('/profiles/graphql/companySearch', query);

  const records = gqlData.companySearch.data;
  if (!records || records.length === 0) {
    throw new NotFound(
      `No company found for companyId ${args.companyId}. The company may not exist or may not be accessible.`,
    );
  }

  return records[0] as GetCompanyOutput;
}

// ============================================================================
// getCompanyEmployees
// ============================================================================

const MANAGEMENT_LEVEL_TO_SENIORITY: Record<string, string> = {
  'C-Level': 'C_EXECUTIVES',
  'VP-Level': 'VP_EXECUTIVES',
  Director: 'DIRECTOR',
  Manager: 'MANAGER',
  'Non-Manager': 'NON_MANAGER',
};

export async function getCompanyEmployees(
  args: GetCompanyEmployeesInput,
): Promise<GetCompanyEmployeesOutput> {
  if (args.companyId === undefined || args.companyId === null) {
    throw new Validation('getCompanyEmployees: companyId is required');
  }

  const rpp = Math.min(args.rpp ?? 25, 25);
  const page = args.page ?? 1;

  const sortField = args.sortBy ?? 'Relevance';
  const sortDir = args.sortOrder ?? 'desc';

  const params: Record<string, unknown> = {
    companyIds: String(args.companyId),
    page,
    rpp,
    companyPastOrPresent: args.companyPastOrPresent ?? '1',
    excludeBoardMembers: args.excludeBoardMembers ?? true,
    useUnifiedSearch: true,
    confidenceScoreMin: args.confidenceScoreMin ?? 85,
    confidenceScoreMax: args.confidenceScoreMax ?? 99,
    sortBy: `${sortField},person_id`,
    sortOrder: `${sortDir},desc`,
    outputFieldOptions: 'job_function,org_chart_tier',
  };

  // managementLevel array is silently ignored by the GraphQL API.
  // Convert to titleSeniority codes instead (unless titleSeniority is explicitly set).
  if (args.managementLevel !== undefined && args.titleSeniority === undefined) {
    const codes = args.managementLevel
      .map((m) => MANAGEMENT_LEVEL_TO_SENIORITY[m])
      .filter(Boolean);
    if (codes.length > 0) {
      params.titleSeniority = codes.join(',');
    }
  }
  if (args.titleSeniority !== undefined)
    params.titleSeniority = args.titleSeniority;
  if (args.personTitle !== undefined) params.personTitle = args.personTitle;
  if (args.fullName !== undefined) params.fullName = args.fullName;
  if (args.contactRequirements !== undefined)
    params.contactRequirements = args.contactRequirements;
  if (args.state !== undefined) params.state = args.state;
  if (args.country !== undefined) params.country = args.country;
  if (args.personWebReferencesURL !== undefined)
    params.personWebReferencesURL = args.personWebReferencesURL;
  if (args.isCertified !== undefined) params.isCertified = args.isCertified;
  if (args.emailAddress !== undefined) params.emailAddress = args.emailAddress;
  if (args.hasBeenNotified !== undefined)
    params.hasBeenNotified = args.hasBeenNotified;
  if (args.currentCompanyStartDate !== undefined)
    params.currentCompanyStartDate = args.currentCompanyStartDate;
  if (args.personCreationStartDate !== undefined)
    params.personCreationStartDate = args.personCreationStartDate;
  if (args.school !== undefined) params.school = args.school;
  if (args.zipCode !== undefined) params.zipCode = args.zipCode;
  if (args.pTag !== undefined) params.pTag = args.pTag;
  if (args.cTag !== undefined) params.cTag = args.cTag;
  if (args.excludePeopleTags !== undefined)
    params.excludePeopleTags = args.excludePeopleTags;
  if (args.excludeCompanyTags !== undefined)
    params.excludeCompanyTags = args.excludeCompanyTags;
  if (args.scoopTopics !== undefined) params.scoopTopics = args.scoopTopics;
  if (args.scoopTypes !== undefined) params.scoopTypes = args.scoopTypes;
  if (args.excludeDefunctCompanies !== undefined)
    params.excludeDefunctCompanies = args.excludeDefunctCompanies;
  if (args.showOnlyUltimateParent !== undefined)
    params.showOnlyUltimateParent = args.showOnlyUltimateParent;
  if (args.companyType !== undefined) params.companyType = args.companyType;
  if (args.industryKeywords !== undefined)
    params.industryKeywords = args.industryKeywords;
  if (args.pList !== undefined) params.pList = args.pList;
  if (args.cList !== undefined) params.cList = args.cList;
  if (args.excludeExportedPersons !== undefined)
    params.excludeExportedPersons = args.excludeExportedPersons;
  if (args.excludeOrgExportedPersons !== undefined)
    params.excludeOrgExportedPersons = args.excludeOrgExportedPersons;
  if (args.excludeExportedCompanies !== undefined)
    params.excludeExportedCompanies = args.excludeExportedCompanies;

  const query = `query {
  personSearch(searchFacadeParams: {${buildInlineParams(params)}}) {
    totalResults
    maxResults
    data {
      personID
      firstName
      lastName
      name
      title
      jobTitle
      companyID
      companyName
      companyDomain
      companyEmployees
      companyRevenue
      companyRevenueRange
      companyAddress { Street City State Zip CountryCode }
      companyPhone
      email
      phone
      mobilePhone
      location { City State CountryCode metroArea }
      isMasked
      isTagged
      confidenceScore
      lastUpdatedDate
      orgChartTier
      orgChartJobFunction { department departmentId jobFunction jobFunctionId }
      socialUrlsParsed { linkedin facebook twitter youtube }
      doziIndustry { displayName name isPrimary score }
    }
  }
}`;

  const gqlData = await ziGraphQLInline<{
    personSearch: {
      totalResults: number;
      maxResults: number;
      data: Array<Record<string, unknown>>;
    };
  }>('/profiles/graphql/personSearch', query);

  return {
    totalResults: gqlData.personSearch.totalResults,
    maxResults: gqlData.personSearch.maxResults,
    data: gqlData.personSearch.data as GetCompanyEmployeesOutput['data'],
  };
}

// ============================================================================
// listSavedSearches
// ============================================================================

const DEFAULT_SEARCH_TYPES = [
  'GROW_SAVED_SEARCH_PEOPLE',
  'GROW_SAVED_SEARCH_COMPANY',
  'DEFAULT_UNIFIED_SEARCH',
  'HOMEPAGE_FEED_SEARCH',
  'TRACKER_PEOPLE',
] as const;

const VALID_SEARCH_TYPES = new Set(DEFAULT_SEARCH_TYPES);

export async function listSavedSearches(
  args: ListSavedSearchesInput,
): Promise<ListSavedSearchesOutput> {
  if (args.types) {
    for (const t of args.types) {
      if (!VALID_SEARCH_TYPES.has(t as (typeof DEFAULT_SEARCH_TYPES)[number])) {
        throw new Validation(
          `listSavedSearches: invalid type "${t}". Valid values: ${Array.from(VALID_SEARCH_TYPES).join(', ')}`,
        );
      }
    }
  }

  const types =
    args.types && args.types.length > 0 ? args.types : DEFAULT_SEARCH_TYPES;

  const data = await ziPost<{
    resultCode: number;
    success: boolean;
    resultTextCode: string;
    value: {
      numberOfFavoriteSearch: number;
      savedSearches: Array<{
        id: number;
        name: string;
        description: string | null;
        creationDate: number;
        favorite: number;
        alertFrequency: string | null;
        showInHomepage: boolean;
        savedSearchResult: unknown;
        subscriptionId: string | null;
        savedSearchType: string;
        query: Record<string, unknown> | null;
        isArchivedBc: boolean | null;
      }>;
    };
  }>('/ziapi/saved-search-facade/api/v1/saved-searches/type', {
    savedSearchTypes: types.join(','),
    isAlertsViaWorkflow: true,
  });

  if (!data.success) {
    throw new UpstreamError(
      `listSavedSearches failed: resultCode=${data.resultCode} resultTextCode=${data.resultTextCode}`,
    );
  }

  // Deduplicate by id; the ZoomInfo API returns duplicate entries when a single
  // type is passed in savedSearchTypes (known API bug).
  const seen = new Set<number>();
  const unique = data.value.savedSearches.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  return {
    savedSearches: unique.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      creationDate: new Date(s.creationDate).toISOString(),
      favorite: s.favorite,
      alertFrequency: s.alertFrequency,
      showInHomepage: s.showInHomepage,
      subscriptionId: s.subscriptionId,
      isArchivedBc: s.isArchivedBc,
      savedSearchType: s.savedSearchType,
      query:
        s.query as ListSavedSearchesOutput['savedSearches'][number]['query'],
    })),
  };
}

// ============================================================================
// runSavedSearch
// ============================================================================

const PERSON_SEARCH_TYPES = new Set([
  'GROW_SAVED_SEARCH_PEOPLE',
  'TRACKER_PEOPLE',
  'HOMEPAGE_FEED_SEARCH',
]);

export async function runSavedSearch(
  args: RunSavedSearchInput,
): Promise<RunSavedSearchOutput> {
  // Fetch all saved searches (all types) to find the requested one
  const data = await ziPost<{
    resultCode: number;
    success: boolean;
    resultTextCode: string;
    value: {
      savedSearches: Array<{
        id: number;
        savedSearchType: string;
        query: Record<string, unknown> | null;
      }>;
    };
  }>('/ziapi/saved-search-facade/api/v1/saved-searches/type', {
    savedSearchTypes:
      'GROW_SAVED_SEARCH_PEOPLE,GROW_SAVED_SEARCH_COMPANY,DEFAULT_UNIFIED_SEARCH,HOMEPAGE_FEED_SEARCH,TRACKER_PEOPLE',
    isAlertsViaWorkflow: true,
  });

  if (!data.success) {
    throw new UpstreamError(
      `runSavedSearch: failed to load saved searches. resultCode=${data.resultCode} resultTextCode=${data.resultTextCode}`,
    );
  }

  const savedSearch = data.value.savedSearches.find(
    (s) => s.id === args.savedSearchId,
  );
  if (!savedSearch) {
    throw new NotFound(
      `runSavedSearch: saved search ${args.savedSearchId} not found`,
    );
  }
  if (!savedSearch.query) {
    throw new UpstreamError(
      `runSavedSearch: saved search ${args.savedSearchId} has no stored query`,
    );
  }

  // Build params from stored query, applying overrides
  const params: Record<string, unknown> = { ...savedSearch.query };
  if (args.page !== undefined) params.page = args.page;
  if (args.rpp !== undefined) params.rpp = Math.min(args.rpp, 25);
  if (args.sortBy !== undefined) params.sortBy = args.sortBy;
  if (args.sortOrder !== undefined) params.sortOrder = args.sortOrder;
  if (args.useUnifiedSearch !== undefined)
    params.useUnifiedSearch = args.useUnifiedSearch;
  // Ensure defaults if not set by stored query
  if (params.page === undefined) params.page = 1;
  if (params.rpp === undefined) params.rpp = 25;

  const isPersonSearch =
    PERSON_SEARCH_TYPES.has(savedSearch.savedSearchType) ||
    savedSearch.savedSearchType === 'DEFAULT_UNIFIED_SEARCH';

  if (isPersonSearch) {
    const query = `query {
  personSearch(searchFacadeParams: {${buildInlineParams(params)}}) {
    totalResults
    maxResults
    data {
      personID
      firstName
      lastName
      name
      title
      jobTitle
      companyID
      companyName
      companyDomain
      companyEmployees
      companyRevenue
      companyRevenueRange
      companyAddress { Street City State Zip CountryCode }
      companyPhone
      email
      phone
      mobilePhone
      location { City State CountryCode metroArea }
      isMasked
      isTagged
      confidenceScore
      lastUpdatedDate
      orgChartJobFunction { department departmentId jobFunction jobFunctionId }
      socialUrlsParsed { linkedin facebook twitter youtube }
      doziIndustry { displayName name isPrimary score }
    }
  }
}`;

    const gqlData = await ziGraphQLInline<{
      personSearch: {
        totalResults: number;
        maxResults: number;
        data: Array<Record<string, unknown>>;
      };
    }>('/profiles/graphql/personSearch', query);

    return {
      savedSearchType: savedSearch.savedSearchType,
      totalResults: gqlData.personSearch.totalResults,
      maxResults: gqlData.personSearch.maxResults,
      data: gqlData.personSearch.data as RunSavedSearchOutput['data'],
    };
  } else {
    const query = `query {
  companySearch(searchFacadeParams: {${buildInlineParams(params)}}) {
    totalResults
    maxResults
    data {
      companyID: id
      companyLogo: logo
      companyName: name
      location: address { Street City State Zip CountryCode }
      revenue
      revenueRange
      employees: employeeCount
      employeesRange
      companyDomain: domain
      companyDescription: description
      companyPhone: phone
      companyRevenueIn000s
      companyType: type
      topLevelIndustry
      totalFundingAmountIn000s
      isDefunct
      isMasked: masked
      isTagged: tagged
      certified
      certificationDate
      doziIndustry { displayName name isPrimary score }
    }
  }
}`;

    const gqlData = await ziGraphQLInline<{
      companySearch: {
        totalResults: number;
        maxResults: number;
        data: Array<Record<string, unknown>>;
      };
    }>('/profiles/graphql/companySearch', query);

    return {
      savedSearchType: savedSearch.savedSearchType,
      totalResults: gqlData.companySearch.totalResults,
      maxResults: gqlData.companySearch.maxResults,
      data: gqlData.companySearch.data as RunSavedSearchOutput['data'],
    };
  }
}

// ============================================================================
// listLists
// ============================================================================

const DEFAULT_LIST_JOB_TYPES = [
  'DOZI_MARKETING_EXCLUSION_LIST_COMPANY',
  'DOZI_DAAS_WORKBOOK_PERSON',
  'DOZI_DAAS_WORKBOOK_COMPANY',
  'DOZI_ACCOUNT_ASSIGNMENT',
  'DOZI_ADMIN_ACCOUNT_ASSIGNMENT',
] as const;

export async function listLists(
  args: ListListsInput,
): Promise<ListListsOutput> {
  const origin = window.location.origin;

  const rowSize = args.rowSize ?? 25;
  const startRow = args.startRow ?? 0;
  const jobTypes = args.jobType ?? DEFAULT_LIST_JOB_TYPES;
  const sortBy = args.sortBy ?? 'createDate';
  const sortDescending = args.sortDescending ?? true;
  const sortMapAsString = JSON.stringify({ [sortBy]: sortDescending });

  const innerParams = new URLSearchParams({
    filtersApplied: 'true',
    doBuildFilterValuesList: 'false',
    includeCreditSource: 'false',
    includeUploadProcessing: 'true',
    jobType: jobTypes.join(','),
    rowSize: String(rowSize),
    sortMapAsString,
    startRow: String(startRow),
    listStatisticsRequired: 'true',
  });

  const filters = btoa(innerParams.toString());
  const url = `${origin}/ziapi/export-facade/api/v1/list?filters=${filters}`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: buildAuthHeaders(),
    credentials: 'include',
  });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }

  // Endpoint returns empty body (content-length: 0) in some cases
  const text = await resp.text();
  if (!text || text.trim() === '') {
    return { lists: [] };
  }

  const parsed = JSON.parse(text) as
    | {
        listData: Array<{
          id: number;
          name: string;
          count?: number | null;
          type?: string | null;
          creationDate?: string | null;
          status?: string | null;
        }>;
        total: number;
        totalWithFilter: number;
      }
    | Array<{
        id: number;
        name: string;
        count?: number | null;
        type?: string | null;
        creationDate?: string | null;
        status?: string | null;
      }>;

  const items = Array.isArray(parsed) ? parsed : parsed.listData;
  const total = Array.isArray(parsed) ? undefined : parsed.total;
  const totalWithFilter = Array.isArray(parsed)
    ? undefined
    : parsed.totalWithFilter;

  return {
    lists: items.map((item) => ({
      id: item.id,
      name: item.name,
      count: item.count ?? null,
      type: item.type ?? null,
      creationDate: item.creationDate ?? null,
      status: item.status ?? null,
    })),
    total,
    totalWithFilter,
  };
}

// ============================================================================
// tagContacts
// ============================================================================

export async function tagContacts(
  args: TagContactsInput,
): Promise<TagContactsOutput> {
  if (args.tagId === undefined || args.tagId === null) {
    throw new Validation('tagContacts: tagId is required');
  }
  if (!args.personIds || args.personIds.length === 0) {
    throw new Validation('tagContacts: personIds must be a non-empty array');
  }

  const entityIds = args.personIds.map(String);
  const isPublic = args.isPublicTag ?? false;

  const body: Record<string, unknown> = {
    privateTagIds: isPublic ? [] : [args.tagId],
    publicTagIds: isPublic ? [args.tagId] : [],
    entityIds,
  };

  if (args.recruiterTagIds !== undefined) {
    body.recruiterTagIds = args.recruiterTagIds;
  }

  await ziPost<unknown>(
    '/ziapi/user-tags-facade/api/v1/tags/actions/person/tag',
    body,
  );

  return {
    success: true,
    taggedCount: args.personIds.length,
  };
}

// ============================================================================
// tagCompanies
// ============================================================================

export async function tagCompanies(
  args: TagCompaniesInput,
): Promise<TagCompaniesOutput> {
  if (args.tagId === undefined || args.tagId === null) {
    throw new Validation('tagCompanies: tagId is required');
  }
  if (!args.companyIds || args.companyIds.length === 0) {
    throw new Validation('tagCompanies: companyIds must be a non-empty array');
  }

  const entityIds = args.companyIds.map(String);
  const isPublic = args.isPublicTag ?? false;
  const additionalTagIds = (args.tagIds ?? []).filter(
    (id) => id !== args.tagId,
  );

  const body: Record<string, unknown> = {
    privateTagIds: isPublic
      ? additionalTagIds
      : [args.tagId, ...additionalTagIds],
    publicTagIds: isPublic ? [args.tagId] : [],
    entityIds,
  };

  await ziPost<unknown>(
    '/ziapi/user-tags-facade/api/v1/tags/actions/company/tag',
    body,
  );

  return {
    success: true,
    taggedCount: args.companyIds.length,
  };
}

// ============================================================================
// untagContacts
// ============================================================================

export async function untagContacts(
  args: UntagContactsInput,
): Promise<UntagContactsOutput> {
  if (args.tagId === undefined || args.tagId === null) {
    throw new Validation('untagContacts: tagId is required');
  }
  if (!args.personIds || args.personIds.length === 0) {
    throw new Validation('untagContacts: personIds must be a non-empty array');
  }

  const entityIds = args.personIds.map(String);
  const isPublic = args.isPublicTag ?? false;

  const body: Record<string, unknown> = {
    privateTagIds: isPublic ? [] : [args.tagId],
    publicTagIds: isPublic ? [args.tagId] : [],
    entityIds,
  };

  if (args.recruiterTagIds !== undefined) {
    body.recruiterTagIds = args.recruiterTagIds;
  }

  await ziPost<unknown>(
    '/ziapi/user-tags-facade/api/v1/tags/actions/person/untag',
    body,
  );

  return {
    success: true,
    untaggedCount: args.personIds.length,
  };
}

// ============================================================================
// untagCompanies
// ============================================================================

export async function untagCompanies(
  args: UntagCompaniesInput,
): Promise<UntagCompaniesOutput> {
  if (args.tagId === undefined || args.tagId === null) {
    throw new Validation('untagCompanies: tagId is required');
  }
  if (!args.companyIds || args.companyIds.length === 0) {
    throw new Validation('untagCompanies: companyIds must be a non-empty array');
  }

  // Auto-detect tag type to prevent silent failures when the wrong isPublicTag
  // value is passed. The API accepts any payload but silently no-ops if the tag
  // is placed in the wrong bucket (e.g. private tag ID sent as publicTagIds).
  const tagData = await ziGet<{
    userTags: Array<{ tagId: number; type: string }>;
  }>(`/ziapi/user-tags/v3/tags/byTypes?type=COMPANY,PUBLIC_COMPANY`);

  const tag = tagData.userTags.find((t) => t.tagId === args.tagId);
  if (!tag) {
    throw new NotFound(
      `untagCompanies: tag ${args.tagId} not found or is not a COMPANY/PUBLIC_COMPANY tag`,
    );
  }
  const isPublic = tag.type === 'PUBLIC_COMPANY';

  const entityIds = args.companyIds.map(String);
  const additionalTagIds = args.tagIds ?? [];

  const body: Record<string, unknown> = {
    privateTagIds: isPublic
      ? additionalTagIds
      : [args.tagId, ...additionalTagIds],
    publicTagIds: isPublic ? [args.tagId] : [],
    entityIds,
  };

  if (args.recruiterTagIds !== undefined) {
    body.recruiterTagIds = args.recruiterTagIds;
  }

  await ziPost<unknown>(
    '/ziapi/user-tags-facade/api/v1/tags/actions/company/untag',
    body,
  );

  return {
    success: true,
    untaggedCount: args.companyIds.length,
  };
}

// ============================================================================
// getScoops
// ============================================================================

export async function getScoops(
  args: GetScoopsInput,
): Promise<GetScoopsOutput> {
  if (!args.companyId && args.companyId !== 0) {
    throw new Validation('getScoops: companyId is required');
  }
  if (
    args.sortOrder !== undefined &&
    !['asc', 'desc', 'ASC', 'DESC'].includes(args.sortOrder)
  ) {
    throw new Validation(
      `getScoops: invalid sortOrder "${args.sortOrder}". Valid values: asc, desc, ASC, DESC`,
    );
  }
  const rpp = Math.min(Math.max(args.rpp ?? 25, 1), 25);
  const page = Math.max(args.page ?? 1, 1);

  const body: Record<string, unknown> = {
    companyIds: String(args.companyId),
    rpp,
    page,
  };

  if (args.scoopTypes !== undefined) body.scoopTypes = args.scoopTypes;
  if (args.scoopTopics !== undefined) body.scoopTopics = args.scoopTopics;
  if (args.scoopDepartments !== undefined)
    body.scoopDepartments = args.scoopDepartments;
  if (args.sortBy !== undefined) body.sortBy = args.sortBy;
  if (args.sortOrder !== undefined) body.sortOrder = args.sortOrder;
  if (args.scoopStartDate !== undefined)
    body.scoopStartDate = args.scoopStartDate;
  if (args.scoopEndDate !== undefined) body.scoopEndDate = args.scoopEndDate;
  if (args.scoopDesc !== undefined) body.scoopDesc = args.scoopDesc;
  if (args.isSubscribed !== undefined) body.isSubscribed = args.isSubscribed;
  if (args.updatedSinceCreation !== undefined)
    body.updatedSinceCreation = args.updatedSinceCreation ? 'true' : 'false';

  const data = await ziPost<{
    resultEntity?: Array<{
      basic?: {
        id?: string;
        types?: string[];
        topics?: string[];
        description?: string;
        company?: { companyID?: number; companyName?: string };
      };
    }>;
    totalResults?: number;
    maxResults?: number;
  }>('/anura/zoominfo/hUnifiedScoopSearch', body);

  const scoops = (data.resultEntity ?? []).map((item) => ({
    id: item.basic?.id ?? null,
    types: item.basic?.types ?? null,
    topics: item.basic?.topics ?? null,
    description: item.basic?.description ?? null,
    company: item.basic?.company
      ? {
          companyID: item.basic.company.companyID ?? null,
          companyName: item.basic.company.companyName ?? null,
        }
      : null,
  }));

  return {
    scoops,
    totalResults: data.totalResults ?? scoops.length,
    maxResults: data.maxResults ?? scoops.length,
  };
}

// ============================================================================
// getCompanyTechnographics
// ============================================================================

export async function getCompanyTechnographics(
  args: GetCompanyTechnographicsInput,
): Promise<GetCompanyTechnographicsOutput> {
  const params: Record<string, unknown> = {
    companyIds: String(args.companyId),
    rpp: 1,
    page: 1,
  };

  const query = `query {
  companySearch(searchFacadeParams: {${buildInlineParams(params)}}) {
    data {
      technologyAddDrop {
        technologyId
        activity
        date
      }
    }
  }
}`;

  const gqlData = await ziGraphQLInline<{
    companySearch: {
      data: Array<{
        technologyAddDrop?: Array<{
          technologyId: number;
          activity: string;
          date: string;
        }>;
      }>;
    };
  }>('/profiles/graphql/companySearch', query);

  const company = gqlData.companySearch.data[0];
  const techData = company?.technologyAddDrop ?? [];

  if (techData.length === 0) {
    return { technologies: [] };
  }

  const techIds = techData.map((t) => t.technologyId).join(',');
  const attrMap: Record<
    string,
    {
      technologyName: string | null;
      categoryParent: string | null;
      category: string | null;
      vendor: string | null;
      website: string | null;
      logo: string | null;
      domain: string | null;
      description: string | null;
      attribute: string | null;
      createdTime: string | null;
      modifiedTime: string | null;
    }
  > = {};
  const techAttrsResp = await ziGet<{
    resultCode: number;
    value: {
      techAttributes: Array<{
        tag: string;
        product?: string;
        categoryParent?: string;
        category?: string;
        vendor?: string;
        website?: string;
        logo?: string;
        domain?: string;
        description?: string;
        attribute?: string;
        createdTime?: string;
        modifiedTime?: string;
      }>;
    };
  }>(`/anura/techAttributes/techAttributesById?technology=${techIds}`);
  for (const attr of techAttrsResp.value?.techAttributes ?? []) {
    attrMap[attr.tag] = {
      technologyName: attr.product ?? null,
      categoryParent: attr.categoryParent ?? null,
      category: attr.category ?? null,
      vendor: attr.vendor ?? null,
      website: attr.website ?? null,
      logo: attr.logo ?? null,
      domain: attr.domain ?? null,
      description: attr.description ?? null,
      attribute: attr.attribute ?? null,
      createdTime: attr.createdTime ?? null,
      modifiedTime: attr.modifiedTime ?? null,
    };
  }

  return {
    technologies: techData.map((t) => ({
      technologyId: t.technologyId,
      technologyName: attrMap[String(t.technologyId)]?.technologyName ?? null,
      activity: t.activity,
      date: t.date,
      categoryParent: attrMap[String(t.technologyId)]?.categoryParent ?? null,
      category: attrMap[String(t.technologyId)]?.category ?? null,
      vendor: attrMap[String(t.technologyId)]?.vendor ?? null,
      website: attrMap[String(t.technologyId)]?.website ?? null,
      logo: attrMap[String(t.technologyId)]?.logo ?? null,
      domain: attrMap[String(t.technologyId)]?.domain ?? null,
      description: attrMap[String(t.technologyId)]?.description ?? null,
      attribute: attrMap[String(t.technologyId)]?.attribute ?? null,
      createdTime: attrMap[String(t.technologyId)]?.createdTime ?? null,
      modifiedTime: attrMap[String(t.technologyId)]?.modifiedTime ?? null,
    })),
  };
}

// ============================================================================
// deleteSavedSearch
// ============================================================================

export async function deleteSavedSearch(
  args: DeleteSavedSearchInput,
): Promise<DeleteSavedSearchOutput> {
  const origin = window.location.origin;
  const url = `${origin}/ziapi/saved-search-facade/api/v1/saved-searches/${args.savedSearchId}`;
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
    credentials: 'include',
  });
  if (!resp.ok) {
    throwForStatus(resp.status, await resp.text().catch(() => undefined));
  }
  const data = (await resp.json()) as {
    resultCode: number;
    success: boolean;
    resultTextCode: string;
  };
  if (!data.success) {
    throw new UpstreamError(
      `deleteSavedSearch failed: resultCode=${data.resultCode} resultTextCode=${data.resultTextCode}`,
    );
  }
  return {
    success: true,
    savedSearchId: args.savedSearchId,
  };
}

// ============================================================================
// getContactTags / getCompanyTags
// ============================================================================

type EntityTagDetail = {
  tagId: number;
  tagName: string;
  type: string;
  creationDate: string | null;
  lastInteractedDate: string | null;
};

function normalizeEntityTags(raw: unknown): Record<string, EntityTagDetail[]> {
  // Response shape observed: {} when no tags. When tags exist the API
  // returns a map keyed by entityId with either an array of tag details
  // or an object containing a `tags` array. Normalize both.
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, EntityTagDetail[]> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    let tags: unknown[] = [];
    if (Array.isArray(value)) {
      tags = value;
    } else if (value && typeof value === 'object') {
      const inner = (value as { tags?: unknown }).tags;
      if (Array.isArray(inner)) tags = inner;
    }
    out[id] = tags
      .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
      .map((t) => ({
        tagId: Number(t.tagId ?? t.id ?? 0),
        tagName: String(t.tagName ?? t.name ?? ''),
        type: String(t.type ?? ''),
        creationDate: (t.creationDate as string | null | undefined) ?? null,
        lastInteractedDate:
          (t.lastInteractedDate as string | null | undefined) ?? null,
      }));
  }
  return out;
}

export async function getContactTags(
  args: GetContactTagsInput,
): Promise<GetContactTagsOutput> {
  const data = await ziPost<unknown>(
    '/ziapi/user-tags-facade/api/v1/tags/actions/person/list',
    {
      entitiesIds: args.personIds.map((id) => String(id)),
      isGetTagDetails: true,
    },
  );
  return { tagsByPersonId: normalizeEntityTags(data) };
}

export async function getCompanyTags(
  args: GetCompanyTagsInput,
): Promise<GetCompanyTagsOutput> {
  const data = await ziPost<unknown>(
    '/ziapi/user-tags-facade/api/v1/tags/actions/company/list',
    {
      entitiesIds: args.companyIds.map((id) => String(id)),
      isGetTagDetails: true,
    },
  );
  return { tagsByCompanyId: normalizeEntityTags(data) };
}

// ============================================================================
// getIcpConfig
// ============================================================================

export async function getIcpConfig(
  _args: GetIcpConfigInput,
): Promise<GetIcpConfigOutput> {
  const data = await ziGet<{
    data?: {
      type?: string;
      attributes?: Record<string, unknown>;
    };
  }>('/ziapi/icp/api/v1/icps-config');

  const attrs = data.data?.attributes ?? {};
  return {
    isIcpScoreInSearchEnabled: Boolean(attrs.isIcpScoreInSearchEnabled),
    raw: attrs as Record<string, unknown>,
  };
}

// ============================================================================
// listWebsightsDomains
// ============================================================================

export async function listWebsightsDomains(
  _args: ListWebsightsDomainsInput,
): Promise<ListWebsightsDomainsOutput> {
  const data = await ziGet<
    Array<{
      _id: string;
      domain: string;
      verified?: boolean | null;
      active?: boolean | null;
      gaEnable?: boolean | null;
    }>
  >('/ziapi/ip2org/websights-domains');

  return {
    domains: data.map((d) => ({
      id: d._id,
      domain: d.domain,
      verified: d.verified ?? null,
      active: d.active ?? null,
      gaEnable: d.gaEnable ?? null,
    })),
  };
}
