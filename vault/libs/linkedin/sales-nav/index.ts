/**
 * LinkedIn Sales Navigator Library
 *
 * Browser-executable functions for Sales Navigator REST API operations.
 * All endpoints use https://www.linkedin.com/sales-api/ with RestLI protocol.
 */

import type {
  SearchLeadsInput,
  SearchLeadsOutput,
  SearchAccountsInput,
  SearchAccountsOutput,
  GetLeadProfileInput,
  GetLeadProfileOutput,
  GetLeadTimelineInput,
  GetLeadTimelineOutput,
  GetAccountDetailInput,
  GetAccountDetailOutput,
  GetAccountLeadsInput,
  GetAccountLeadsOutput,
  ListLeadListsInput,
  ListLeadListsOutput,
  ListAccountListsInput,
  ListAccountListsOutput,
  GetLeadsInListInput,
  GetLeadsInListOutput,
  GetAccountsInListInput,
  GetAccountsInListOutput,
  CreateListInput,
  CreateListOutput,
  DeleteListInput,
  DeleteListOutput,
  UpdateListInput,
  UpdateListOutput,
  SaveLeadInput,
  SaveLeadOutput,
  UnsaveLeadInput,
  UnsaveLeadOutput,
  AddLeadToListInput,
  AddLeadToListOutput,
  RemoveLeadFromListInput,
  RemoveLeadFromListOutput,
  AddAccountToListInput,
  AddAccountToListOutput,
  RemoveAccountFromListInput,
  RemoveAccountFromListOutput,
  SaveAccountInput,
  SaveAccountOutput,
  UnsaveAccountInput,
  UnsaveAccountOutput,
  GetLeadNotesInput,
  GetLeadNotesOutput,
  GetAccountNotesInput,
  GetAccountNotesOutput,
  CreateNoteInput,
  CreateNoteOutput,
  UpdateNoteInput,
  UpdateNoteOutput,
  DeleteNoteInput,
  DeleteNoteOutput,
  ListInMailThreadsInput,
  ListInMailThreadsOutput,
  ViewInMailThreadInput,
  ViewInMailThreadOutput,
  SendInMailInput,
  SendInMailOutput,
  ListSavedSearchesInput,
  ListSavedSearchesOutput,
  ListSalesNavNotificationsInput,
  ListSalesNavNotificationsOutput,
  GetInMailCreditsInput,
  GetInMailCreditsOutput,
  SearchFilterValuesInput,
  SearchFilterValuesOutput,
  GetAccountDossierInput,
  GetAccountDossierOutput,
  GetAccountHeadcountInput,
  GetAccountHeadcountOutput,
  GetLeadHighlightsInput,
  GetLeadHighlightsOutput,
  LeadResult,
  AccountResult,
} from '../schemas';

// ============================================================================
// Helper Functions
// ============================================================================

import { ContractDrift, NotFound, Validation, UpstreamError, Unauthenticated, throwForStatus } from '@vallum/_runtime';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 500 + Math.floor(Math.random() * 1000);

const SALES_NAV_MAX_PAGE_SIZE = 100;
const SALES_NAV_MAX_RESULTS = 2500;

const SALES_NAV_HEADERS = {
  accept: 'application/vnd.linkedin.normalized+json+2.1',
  'x-restli-protocol-version': '2.0.0',
};

/**
 * Shared fetch helper for Sales Navigator API.
 * All requests need csrf-token header + credentials.
 */
async function salesFetch<T>(
  csrf: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = path.startsWith('http')
    ? path
    : `https://www.linkedin.com/sales-api/${path.replace(/^\/+/, '')}`;

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'csrf-token': csrf,
      ...SALES_NAV_HEADERS,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    const truncated =
      body.length > 2000 ? body.slice(0, 2000) + '... [truncated]' : body;
    throwForStatus(response.status, `Sales Navigator API error ${response.status}: ${truncated}`);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    const truncated =
      text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    throw new ContractDrift(`Sales Navigator returned non-JSON response: ${truncated}`);
  }
}

/**
 * Extract CSRF token from JSESSIONID cookie (same as LinkedIn).
 */
function _getCsrfFromCookie(): string {
  const csrf = document.cookie
    .split('; ')
    .find((row) => row.startsWith('JSESSIONID='))
    ?.split('=')[1]
    ?.replace(/"/g, '');

  if (!csrf) {
    throw new Unauthenticated(
      'JSESSIONID cookie not found. Ensure you are logged into LinkedIn Sales Navigator.',
    );
  }

  return csrf;
}

/**
 * Parse profileId from Sales Navigator entity URN.
 * URN format: urn:li:fs_salesProfile:(ACw...,NAME_SEARCH,xxx)
 * Returns: ACw...
 */
function parseProfileId(entityUrn: string): string | undefined {
  const match = entityUrn.match(/fs_salesProfile:\(([^,)]+)/);
  return match?.[1];
}

/**
 * Parse companyId from Sales Navigator entity URN.
 * URN format: urn:li:fs_salesCompany:12345
 * Returns: 12345
 */
function parseCompanyId(entityUrn: string): string | undefined {
  const match = entityUrn.match(/fs_salesCompany:(\d+)/);
  return match?.[1];
}

/**
 * Encode a RestLI parameter value for use in URL query strings.
 * encodeURIComponent doesn't encode ( ) which LinkedIn requires as %28 %29.
 */
function encodeRestLi(value: string): string {
  return encodeURIComponent(value).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/**
 * Filter definition structure for Sales Navigator search API.
 */
interface FilterDef {
  type: string;
  values?: Array<{ id?: string; text?: string; selectionType?: string }>;
  rangeValue?: { min?: number; max?: number };
  selectedSubFilter?: string;
}

/**
 * Build a single filter string in RestLI format.
 * Format: (type:X,values:List((id:Y,selectionType:INCLUDED)),...)
 */
function buildFilterStr(f: FilterDef): string {
  const parts: string[] = [`type:${f.type}`];

  if (f.values && f.values.length > 0) {
    const vals = f.values.map((v) => {
      const vParts: string[] = [];
      if (v.id !== undefined) vParts.push(`id:${v.id}`);
      if (v.text !== undefined) vParts.push(`text:${encodeURI(v.text)}`);
      const selectionType =
        v.selectionType !== undefined ? v.selectionType : 'INCLUDED';
      vParts.push(`selectionType:${selectionType}`);
      return `(${vParts.join(',')})`;
    });
    parts.push(`values:List(${vals.join(',')})`);
  }

  if (f.rangeValue) {
    const rParts: string[] = [];
    if (f.rangeValue.min !== undefined) rParts.push(`min:${f.rangeValue.min}`);
    if (f.rangeValue.max !== undefined) rParts.push(`max:${f.rangeValue.max}`);
    parts.push(`rangeValue:(${rParts.join(',')})`);
  }

  if (f.selectedSubFilter) {
    parts.push(`selectedSubFilter:${f.selectedSubFilter}`);
  }

  return `(${parts.join(',')})`;
}

/**
 * Build search query with proper filter nesting.
 * Only keywords and spellCorrectionEnabled are top-level.
 * All other filters go inside filters:List(...).
 */
function buildSearchQuery(params: {
  keywords?: string;
  filters: FilterDef[];
}): string {
  const parts: string[] = ['spellCorrectionEnabled:true'];

  if (params.keywords) {
    parts.push(`keywords:${encodeURI(params.keywords)}`);
  }

  if (params.filters.length > 0) {
    const filterStrs = params.filters.map(buildFilterStr);
    parts.push(`filters:List(${filterStrs.join(',')})`);
  }

  return `(${parts.join(',')})`;
}

/**
 * Extract lead results from Sales Navigator search response.
 * Response has *elements references pointing to included array.
 */
function parseLeadResults(data: {
  data?: {
    '*elements'?: string[];
    elements?: unknown[];
  };
  included?: Array<{
    $type?: string;
    entityUrn?: string;
    objectUrn?: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    headline?: string;
    geoRegion?: string;
    degree?: number;
    saved?: boolean;
    listCount?: number;
    premium?: boolean;
    openLink?: boolean;
    currentPositions?: Array<{
      title?: string;
      companyName?: string;
      companyUrn?: string;
      current?: boolean;
    }>;
  }>;
}): LeadResult[] {
  const included = data.included || [];
  const entityMap = new Map<string, unknown>();
  for (const entity of included) {
    const e = entity as { entityUrn?: string };
    if (e.entityUrn) entityMap.set(e.entityUrn, entity);
  }

  const elements =
    data.data?.elements ||
    data.data?.['*elements']?.map((urn) => entityMap.get(urn));
  if (!elements) return [];

  const results: LeadResult[] = [];

  for (const elem of elements) {
    if (!elem) continue;

    // Element may be URN reference or direct object
    const resolved = typeof elem === 'string' ? entityMap.get(elem) : elem;
    if (!resolved) continue;

    const profile = resolved as {
      $type?: string;
      entityUrn?: string;
      objectUrn?: string;
      firstName?: string;
      lastName?: string;
      fullName?: string;
      headline?: string;
      geoRegion?: string;
      degree?: number;
      saved?: boolean;
      listCount?: number;
      openLink?: boolean;
      premium?: boolean;
      currentPositions?: Array<{
        title?: string;
        companyName?: string;
        companyUrn?: string;
        current?: boolean;
      }>;
    };

    if (
      !profile.$type?.includes('SearchHit') &&
      !profile.$type?.includes('Profile')
    )
      continue;

    const profileId = parseProfileId(
      profile.entityUrn || profile.objectUrn || '',
    );
    if (!profileId) continue;

    // Map numeric degree to enum
    let degreeEnum: 'DEGREE_1' | 'DEGREE_2' | 'DEGREE_3' | undefined;
    if (profile.degree === 1) degreeEnum = 'DEGREE_1';
    else if (profile.degree === 2) degreeEnum = 'DEGREE_2';
    else if (profile.degree === 3) degreeEnum = 'DEGREE_3';

    const currentPosition = profile.currentPositions?.[0];

    results.push({
      profileId,
      name: profile.fullName,
      firstName: profile.firstName,
      lastName: profile.lastName,
      headline: currentPosition?.title || profile.headline,
      companyName: currentPosition?.companyName,
      location: profile.geoRegion,
      degree: degreeEnum,
      saved: profile.saved,
      listCount: profile.listCount,
      openLink: profile.openLink,
      premium: profile.premium,
      profileUrl: `https://www.linkedin.com/sales/lead/${profileId}`,
    });
  }

  return results;
}

/**
 * Extract account results from Sales Navigator search response.
 */
function parseAccountResults(data: {
  data?: {
    '*elements'?: string[];
    elements?: unknown[];
  };
  included?: Array<{
    $type?: string;
    entityUrn?: string;
    companyName?: string;
    description?: string;
    industry?: string;
    employeeCountRange?: string;
    employeeDisplayCount?: string;
  }>;
}): AccountResult[] {
  const included = data.included || [];
  const entityMap = new Map<string, unknown>();
  for (const entity of included) {
    const e = entity as { entityUrn?: string };
    if (e.entityUrn) entityMap.set(e.entityUrn, entity);
  }

  const elements =
    data.data?.elements ||
    data.data?.['*elements']?.map((urn) => entityMap.get(urn));
  if (!elements) return [];

  const results: AccountResult[] = [];

  for (const elem of elements) {
    if (!elem) continue;

    const resolved = typeof elem === 'string' ? entityMap.get(elem) : elem;
    if (!resolved) continue;

    const company = resolved as {
      $type?: string;
      entityUrn?: string;
      companyName?: string;
      description?: string;
      industry?: string;
      employeeCountRange?: string;
      employeeDisplayCount?: string;
    };

    if (!company.$type?.includes('Company')) continue;

    const companyId = parseCompanyId(company.entityUrn || '');
    if (!companyId) continue;

    // Parse employee count from display string (e.g., "5,001-10,000 employees")
    const countMatch = company.employeeCountRange?.match(/^([\d,]+)/);
    const employeeCount = countMatch
      ? parseInt(countMatch[1].replace(/,/g, ''), 10)
      : undefined;

    results.push({
      companyId,
      name: company.companyName,
      industry: company.industry,
      description: company.description,
      employeeCount,
      employeeCountRange: company.employeeCountRange,
      companyUrl: `https://www.linkedin.com/sales/company/${companyId}`,
    });
  }

  return results;
}

// ============================================================================
// Search Operations
// ============================================================================

export async function searchLeads(
  params: SearchLeadsInput,
): Promise<SearchLeadsOutput> {
  const { csrf, start = 0, count = 25, ...filterParams } = params;

  if (count > SALES_NAV_MAX_RESULTS) {
    throw new Validation(
      `Sales Navigator limits search results to ${SALES_NAV_MAX_RESULTS} total. Requested ${count}. Use narrower filters to find more specific leads.`,
    );
  }
  if (start >= SALES_NAV_MAX_RESULTS) {
    throw new Validation(
      `Sales Navigator limits search results to ${SALES_NAV_MAX_RESULTS} total. start=${start} is beyond the limit.`,
    );
  }

  const filters: FilterDef[] = [];

  // Current company filter
  if (filterParams.currentCompany && filterParams.currentCompany.length > 0) {
    filters.push({
      type: 'CURRENT_COMPANY',
      values: filterParams.currentCompany.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Past company filter
  if (filterParams.pastCompany && filterParams.pastCompany.length > 0) {
    filters.push({
      type: 'PAST_COMPANY',
      values: filterParams.pastCompany.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Seniority filter
  if (filterParams.seniority && filterParams.seniority.length > 0) {
    filters.push({
      type: 'SENIORITY_LEVEL',
      values: filterParams.seniority.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Company size filter
  if (filterParams.companySize && filterParams.companySize.length > 0) {
    filters.push({
      type: 'COMPANY_HEADCOUNT',
      values: filterParams.companySize.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Industry filter
  if (filterParams.industry && filterParams.industry.length > 0) {
    filters.push({
      type: 'INDUSTRY',
      values: filterParams.industry.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // School filter
  if (filterParams.school && filterParams.school.length > 0) {
    filters.push({
      type: 'SCHOOL',
      values: filterParams.school.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Geography/Region filter
  if (filterParams.geography && filterParams.geography.length > 0) {
    filters.push({
      type: 'REGION',
      values: filterParams.geography.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Function filter
  if (filterParams.function && filterParams.function.length > 0) {
    filters.push({
      type: 'FUNCTION',
      values: filterParams.function.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Title filter (with scope)
  if (filterParams.title) {
    const titleFilter: FilterDef = {
      type: filterParams.titleScope === 'PAST' ? 'PAST_TITLE' : 'CURRENT_TITLE',
      values: [{ text: filterParams.title, selectionType: 'INCLUDED' }],
    };
    if (filterParams.titleScope && filterParams.titleScope !== 'CURRENT') {
      titleFilter.selectedSubFilter = filterParams.titleScope;
    }
    filters.push(titleFilter);
  }

  // Company headquarters filter
  if (
    filterParams.companyHeadquarters &&
    filterParams.companyHeadquarters.length > 0
  ) {
    filters.push({
      type: 'COMPANY_HEADQUARTERS',
      values: filterParams.companyHeadquarters.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // First name filter
  if (filterParams.firstName) {
    filters.push({
      type: 'FIRST_NAME',
      values: [{ text: filterParams.firstName, selectionType: 'INCLUDED' }],
    });
  }

  // Last name filter
  if (filterParams.lastName) {
    filters.push({
      type: 'LAST_NAME',
      values: [{ text: filterParams.lastName, selectionType: 'INCLUDED' }],
    });
  }

  // Years of experience filter
  if (
    filterParams.yearsOfExperience &&
    filterParams.yearsOfExperience.length > 0
  ) {
    filters.push({
      type: 'YEARS_OF_EXPERIENCE',
      values: filterParams.yearsOfExperience.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Years at current company filter
  if (
    filterParams.yearsAtCurrentCompany &&
    filterParams.yearsAtCurrentCompany.length > 0
  ) {
    filters.push({
      type: 'YEARS_AT_CURRENT_COMPANY',
      values: filterParams.yearsAtCurrentCompany.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Years in current position filter
  if (
    filterParams.yearsInCurrentPosition &&
    filterParams.yearsInCurrentPosition.length > 0
  ) {
    filters.push({
      type: 'YEARS_IN_CURRENT_POSITION',
      values: filterParams.yearsInCurrentPosition.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Connection degree filter (map codes to RELATIONSHIP)
  if (
    filterParams.connectionDegree &&
    filterParams.connectionDegree.length > 0
  ) {
    filters.push({
      type: 'RELATIONSHIP',
      values: filterParams.connectionDegree.map((code) => ({
        id: code,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Profile language filter
  if (filterParams.profileLanguage && filterParams.profileLanguage.length > 0) {
    filters.push({
      type: 'PROFILE_LANGUAGE',
      values: filterParams.profileLanguage.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Group filter
  if (filterParams.group && filterParams.group.length > 0) {
    filters.push({
      type: 'GROUP',
      values: filterParams.group.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Company type filter
  if (filterParams.companyType && filterParams.companyType.length > 0) {
    filters.push({
      type: 'COMPANY_TYPE',
      values: filterParams.companyType.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Boolean toggle filters
  if (filterParams.postedOnLinkedIn) {
    filters.push({
      type: 'POSTED_ON_LINKEDIN',
      values: [{ id: 'RPOL', selectionType: 'INCLUDED' }],
    });
  }

  if (filterParams.recentlyChangedJobs) {
    filters.push({
      type: 'RECENTLY_CHANGED_JOBS',
      values: [{ id: 'RPC', selectionType: 'INCLUDED' }],
    });
  }

  if (filterParams.followsYourCompany) {
    filters.push({
      type: 'FOLLOWS_YOUR_COMPANY',
      values: [{ id: 'CF', selectionType: 'INCLUDED' }],
    });
  }

  if (filterParams.viewedYourProfile) {
    filters.push({
      type: 'VIEWED_YOUR_PROFILE',
      values: [{ id: 'VYP', selectionType: 'INCLUDED' }],
    });
  }

  // Posted content keywords filter
  if (
    filterParams.postedContentKeywords &&
    filterParams.postedContentKeywords.length > 0
  ) {
    filters.push({
      type: 'POSTED_CONTENT_KEYWORDS',
      values: filterParams.postedContentKeywords.map((text) => ({
        text,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Company headcount growth filter
  if (filterParams.companyHeadcountGrowth) {
    filters.push({
      type: 'COMPANY_HEADCOUNT_GROWTH',
      rangeValue: filterParams.companyHeadcountGrowth,
    });
  }

  // Lead list filter
  if (filterParams.leadList && filterParams.leadList.length > 0) {
    filters.push({
      type: 'LEAD_LIST',
      values: filterParams.leadList.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Saved leads filter
  if (filterParams.savedLeads) {
    filters.push({
      type: 'SAVED_LEADS_AND_ACCOUNTS',
      values: [{ id: 'SL', selectionType: 'INCLUDED' }],
    });
  }

  // Saved accounts filter
  if (filterParams.savedAccounts) {
    filters.push({
      type: 'SAVED_LEADS_AND_ACCOUNTS',
      values: [{ id: 'SA', selectionType: 'INCLUDED' }],
    });
  }

  // Past colleague filter
  if (filterParams.pastColleague) {
    filters.push({
      type: 'PAST_COLLEAGUE',
      values: [{ id: 'PC', selectionType: 'INCLUDED' }],
    });
  }

  // Shared experiences filter
  if (filterParams.sharedExperiences) {
    filters.push({
      type: 'LEAD_HIGHLIGHTS',
      values: [{ id: 'COMM', selectionType: 'INCLUDED' }],
    });
  }

  // Connections of filter
  if (filterParams.connectionsOf && filterParams.connectionsOf.length > 0) {
    filters.push({
      type: 'CONNECTION_OF',
      values: filterParams.connectionsOf.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Persona filter
  if (filterParams.persona && filterParams.persona.length > 0) {
    filters.push({
      type: 'PERSONA',
      values: filterParams.persona.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Account list filter
  if (filterParams.accountList && filterParams.accountList.length > 0) {
    filters.push({
      type: 'ACCOUNT_LIST',
      values: filterParams.accountList.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // People interacted with filter
  if (
    filterParams.peopleInteractedWith &&
    filterParams.peopleInteractedWith.length > 0
  ) {
    filters.push({
      type: 'LEAD_INTERACTIONS',
      values: filterParams.peopleInteractedWith.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  const query = buildSearchQuery({
    keywords: filterParams.keywords,
    filters,
  });

  const decorationId =
    'com.linkedin.sales.deco.desktop.searchv2.LeadSearchResult-14';

  // Auto-paginate with jitter to avoid rate limiting
  const allResults: LeadResult[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  let offset = start;
  const effectiveCount = Math.min(count, SALES_NAV_MAX_RESULTS - start);

  while (allResults.length < effectiveCount) {
    const pageSize = Math.min(
      SALES_NAV_MAX_PAGE_SIZE,
      effectiveCount - allResults.length,
      SALES_NAV_MAX_RESULTS - offset,
    );
    if (pageSize <= 0) break;

    const data = await salesFetch<{
      data?: {
        paging?: { total?: number };
        '*elements'?: string[];
        elements?: unknown[];
      };
      included?: unknown[];
    }>(
      csrf,
      `salesApiLeadSearch?q=searchQuery&query=${query}&start=${offset}&count=${pageSize}&decorationId=${decorationId}`,
    );

    if (total === undefined) {
      total = data.data?.paging?.total;
    }

    const pageResults = parseLeadResults(
      data as Parameters<typeof parseLeadResults>[0],
    );
    if (pageResults.length === 0) break;

    for (const r of pageResults) {
      const key = r.profileId || r.name || JSON.stringify(r);
      if (!seen.has(key)) {
        seen.add(key);
        allResults.push(r);
      }
    }

    offset += pageSize;
    if (total !== undefined && offset >= total) break;
    if (offset >= SALES_NAV_MAX_RESULTS) break;
    if (allResults.length >= effectiveCount) break;

    await sleep(jitter());
  }

  return { results: allResults.slice(0, effectiveCount), total };
}

export async function searchAccounts(
  params: SearchAccountsInput,
): Promise<SearchAccountsOutput> {
  const { csrf, start = 0, count = 25, ...filterParams } = params;

  if (count > SALES_NAV_MAX_RESULTS) {
    throw new Validation(
      `Sales Navigator limits search results to ${SALES_NAV_MAX_RESULTS} total. Requested ${count}. Use narrower filters to find more specific accounts.`,
    );
  }
  if (start >= SALES_NAV_MAX_RESULTS) {
    throw new Validation(
      `Sales Navigator limits search results to ${SALES_NAV_MAX_RESULTS} total. start=${start} is beyond the limit.`,
    );
  }

  const filters: FilterDef[] = [];

  // Company size filter
  if (filterParams.companySize && filterParams.companySize.length > 0) {
    filters.push({
      type: 'COMPANY_HEADCOUNT',
      values: filterParams.companySize.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Industry filter
  if (filterParams.industry && filterParams.industry.length > 0) {
    filters.push({
      type: 'INDUSTRY',
      values: filterParams.industry.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Annual revenue filter
  if (filterParams.annualRevenue) {
    filters.push({
      type: 'ANNUAL_REVENUE',
      rangeValue: filterParams.annualRevenue,
    });
  }

  // Company headcount growth filter
  if (filterParams.companyHeadcountGrowth) {
    filters.push({
      type: 'COMPANY_HEADCOUNT_GROWTH',
      rangeValue: filterParams.companyHeadcountGrowth,
    });
  }

  // Company type filter
  if (filterParams.companyType && filterParams.companyType.length > 0) {
    filters.push({
      type: 'COMPANY_TYPE',
      values: filterParams.companyType.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Fortune filter
  if (filterParams.fortune && filterParams.fortune.length > 0) {
    filters.push({
      type: 'FORTUNE',
      values: filterParams.fortune.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Number of followers filter
  if (filterParams.numOfFollowers) {
    filters.push({
      type: 'NUM_OF_FOLLOWERS',
      rangeValue: filterParams.numOfFollowers,
    });
  }

  // Account activities filter
  if (
    filterParams.accountActivities &&
    filterParams.accountActivities.length > 0
  ) {
    filters.push({
      type: 'ACCOUNT_ACTIVITIES',
      values: filterParams.accountActivities.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Account list filter
  if (filterParams.accountList && filterParams.accountList.length > 0) {
    filters.push({
      type: 'ACCOUNT_LIST',
      values: filterParams.accountList.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Company headquarters filter (REGION type under HEADQUARTERS_LOCATION aggregate)
  if (filterParams.headquarters && filterParams.headquarters.length > 0) {
    filters.push({
      type: 'REGION',
      values: filterParams.headquarters.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Department headcount filter
  if (filterParams.departmentHeadcount) {
    const depFilter: FilterDef = {
      type: 'DEPARTMENT_HEADCOUNT',
      rangeValue: filterParams.departmentHeadcount.range,
    };
    if (filterParams.departmentHeadcount.departmentId) {
      depFilter.selectedSubFilter =
        filterParams.departmentHeadcount.departmentId;
    }
    filters.push(depFilter);
  }

  // Department headcount growth filter
  if (filterParams.departmentHeadcountGrowth) {
    const depGrowthFilter: FilterDef = {
      type: 'DEPARTMENT_HEADCOUNT_GROWTH',
      rangeValue: filterParams.departmentHeadcountGrowth.range,
    };
    if (filterParams.departmentHeadcountGrowth.departmentId) {
      depGrowthFilter.selectedSubFilter =
        filterParams.departmentHeadcountGrowth.departmentId;
    }
    filters.push(depGrowthFilter);
  }

  // Connection degree filter
  if (
    filterParams.connectionDegree &&
    filterParams.connectionDegree.length > 0
  ) {
    filters.push({
      type: 'RELATIONSHIP',
      values: filterParams.connectionDegree.map((id) => ({
        id,
        selectionType: 'INCLUDED',
      })),
    });
  }

  // Saved accounts filter
  if (filterParams.savedAccounts) {
    filters.push({
      type: 'SAVED_ACCOUNTS',
      values: [{ id: 'SA', selectionType: 'INCLUDED' }],
    });
  }

  const query = buildSearchQuery({
    keywords: filterParams.keywords,
    filters,
  });

  const decorationId =
    'com.linkedin.sales.deco.desktop.searchv2.AccountSearchResult-4';

  // Auto-paginate with jitter to avoid rate limiting
  const allResults: AccountResult[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  let offset = start;
  const effectiveCount = Math.min(count, SALES_NAV_MAX_RESULTS - start);

  while (allResults.length < effectiveCount) {
    const pageSize = Math.min(
      SALES_NAV_MAX_PAGE_SIZE,
      effectiveCount - allResults.length,
      SALES_NAV_MAX_RESULTS - offset,
    );
    if (pageSize <= 0) break;

    const data = await salesFetch<{
      data?: {
        paging?: { total?: number };
        '*elements'?: string[];
        elements?: unknown[];
      };
      included?: unknown[];
    }>(
      csrf,
      `salesApiAccountSearch?q=searchQuery&query=${query}&start=${offset}&count=${pageSize}&decorationId=${decorationId}`,
    );

    if (total === undefined) {
      total = data.data?.paging?.total;
    }

    const pageResults = parseAccountResults(
      data as Parameters<typeof parseAccountResults>[0],
    );
    if (pageResults.length === 0) break;

    for (const r of pageResults) {
      const key = r.companyId || r.name || JSON.stringify(r);
      if (!seen.has(key)) {
        seen.add(key);
        allResults.push(r);
      }
    }

    offset += pageSize;
    if (total !== undefined && offset >= total) break;
    if (offset >= SALES_NAV_MAX_RESULTS) break;
    if (allResults.length >= effectiveCount) break;

    await sleep(jitter());
  }

  return { results: allResults.slice(0, effectiveCount), total };
}

// ============================================================================
// Lead Operations
// ============================================================================

export async function getLeadProfile(
  params: GetLeadProfileInput,
): Promise<GetLeadProfileOutput> {
  const { csrf, profileId } = params;

  // First decoration: core profile data, positions, contact info
  const decoration1 =
    '(entityUrn,objectUrn,firstName,lastName,fullName,headline,degree,location,listCount,summary,savedLead,contactInfo,pendingInvitation,unlocked,flagshipProfileUrl,pronoun,memorialized,positions*(companyName,current,new,description,endedOn,posId,startedOn,title,location,companyUrn~fs_salesCompany(entityUrn,name)),crmStatus)';

  // Second decoration: enrichment fields (education, skills, badges, connections)
  // Must match the exact decoration the Sales Navigator UI sends; sub-field decorations
  // like skills*(name) or memberBadges(premium,...) cause HTTP 500.
  const decoration2 =
    '(entityUrn,noteCount,educations*(degree,eduId,endedOn,schoolName,startedOn,fieldsOfStudy*),skills*,languages*,memberBadges,numOfConnections,numOfSharedConnections,inmailRestriction)';

  const profilePath = `salesApiProfiles/(profileId:${profileId},authType:undefined,authToken:undefined)`;

  type ProfileData = {
    objectUrn?: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    headline?: string;
    location?: string;
    summary?: string;
    degree?: number;
    savedLead?: boolean;
    listCount?: number;
    unlocked?: boolean;
    pendingInvitation?: boolean;
    pronoun?: string;
    flagshipProfileUrl?: string;
    contactInfo?: {
      emailAddresses?: Array<{ emailAddress?: string; dataSource?: string }>;
      phoneNumbers?: Array<{ number?: string; type?: string }>;
      websites?: Array<{ url?: string; category?: string }>;
      primaryEmail?: { emailAddress?: string };
    };
    positions?: Array<{
      title?: string;
      companyName?: string;
      companyUrn?: string;
      current?: boolean;
      description?: string;
      location?: string;
      startedOn?: { month?: number; year?: number };
      endedOn?: { month?: number; year?: number };
    }>;
  };

  type EnrichData = {
    educations?: Array<{
      degree?: string;
      schoolName?: string;
      fieldsOfStudy?: string[];
      startedOn?: { month?: number; year?: number };
      endedOn?: { month?: number; year?: number };
    }>;
    skills?: Array<{ name?: string }>;
    languages?: string[];
    memberBadges?: {
      premium?: boolean;
      openLink?: boolean;
      jobSeeker?: boolean;
    };
    numOfConnections?: number;
    numOfSharedConnections?: number;
    inmailRestriction?: string;
    noteCount?: number;
  };

  const [data1, data2] = await Promise.all([
    salesFetch<{ data?: ProfileData }>(
      csrf,
      `${profilePath}?decoration=${encodeRestLi(decoration1)}`,
    ),
    salesFetch<{ data?: EnrichData }>(
      csrf,
      `${profilePath}?decoration=${encodeRestLi(decoration2)}`,
    ),
  ]);

  const profile = data1.data;
  if (!profile) {
    throw new NotFound(`Lead profile not found: ${profileId}`);
  }

  const profile2 = data2.data;

  // Extract standard LinkedIn memberId from objectUrn (e.g., "urn:li:member:123456789")
  const memberId = profile.objectUrn
    ? profile.objectUrn.split(':').pop()
    : undefined;

  // Map numeric degree
  let degreeEnum: 'DEGREE_1' | 'DEGREE_2' | 'DEGREE_3' | undefined;
  if (profile.degree === 1) degreeEnum = 'DEGREE_1';
  else if (profile.degree === 2) degreeEnum = 'DEGREE_2';
  else if (profile.degree === 3) degreeEnum = 'DEGREE_3';

  // Extract positions
  const currentPositions: GetLeadProfileOutput['currentPositions'] = [];
  const pastPositions: GetLeadProfileOutput['pastPositions'] = [];

  if (profile.positions) {
    for (const pos of profile.positions) {
      const companyId = pos.companyUrn
        ? parseCompanyId(pos.companyUrn)
        : undefined;
      const startDate = pos.startedOn
        ? { month: pos.startedOn.month, year: pos.startedOn.year }
        : undefined;
      const endDate = pos.endedOn
        ? { month: pos.endedOn.month, year: pos.endedOn.year }
        : undefined;
      const position = {
        title: pos.title,
        companyName: pos.companyName,
        companyId,
        description: pos.description,
        location: pos.location,
        startDate,
        current: pos.current,
        endDate,
      };
      if (pos.current) {
        currentPositions.push(position);
      } else {
        pastPositions.push(position);
      }
    }
  }

  // Extract contact info
  const contactInfo: GetLeadProfileOutput['contactInfo'] = profile.contactInfo
    ? {
        emails: profile.contactInfo.emailAddresses?.map((e) => ({
          emailAddress: e.emailAddress,
          dataSource: e.dataSource,
        })),
        phoneNumbers: profile.contactInfo.phoneNumbers?.map((p) => ({
          number: p.number,
          type: p.type,
        })),
        websites: profile.contactInfo.websites?.map((w) => ({
          url: w.url,
          category: w.category,
        })),
        primaryEmail: profile.contactInfo.primaryEmail?.emailAddress,
      }
    : undefined;

  // Extract educations from second call
  const educations: GetLeadProfileOutput['educations'] =
    profile2?.educations?.map((e) => ({
      degree: e.degree,
      schoolName: e.schoolName,
      fieldsOfStudy: e.fieldsOfStudy,
      startDate: e.startedOn
        ? { month: e.startedOn.month, year: e.startedOn.year }
        : undefined,
      endDate: e.endedOn
        ? { month: e.endedOn.month, year: e.endedOn.year }
        : undefined,
    }));

  return {
    profileId,
    memberId,
    name: profile.fullName,
    firstName: profile.firstName,
    lastName: profile.lastName,
    headline: profile.headline,
    location: profile.location,
    summary: profile.summary,
    pronoun: profile.pronoun,
    profileUrl: profile.flagshipProfileUrl,
    currentPositions:
      currentPositions.length > 0 ? currentPositions : undefined,
    pastPositions: pastPositions.length > 0 ? pastPositions : undefined,
    contactInfo,
    educations: educations && educations.length > 0 ? educations : undefined,
    skills:
      profile2?.skills && profile2.skills.length > 0
        ? profile2.skills.map((s) => ({ name: s.name }))
        : undefined,
    languages:
      profile2?.languages && profile2.languages.length > 0
        ? profile2.languages
        : undefined,
    memberBadges: profile2?.memberBadges,
    numOfConnections: profile2?.numOfConnections,
    numOfSharedConnections: profile2?.numOfSharedConnections,
    inmailRestriction: profile2?.inmailRestriction,
    degree: degreeEnum,
    saved: profile.savedLead,
    unlocked: profile.unlocked,
    pendingInvitation: profile.pendingInvitation,
    listCount: profile.listCount,
    noteCount: profile2?.noteCount,
  };
}

export async function getLeadTimeline(
  params: GetLeadTimelineInput,
): Promise<GetLeadTimelineOutput> {
  const { csrf, profileId, count = 10 } = params;

  const profileUrn = `urn:li:fs_salesProfile:(${profileId},undefined,undefined)`;
  const encodedUrn = encodeRestLi(profileUrn);
  const decoration = '(entityUrn,entityCount,performedAt,domainSource,type)';

  let data: {
    data?: {
      '*elements'?: string[];
      elements?: Array<{
        entityUrn?: string;
        type?: string;
        performedAt?: number;
        entityCount?: number;
      }>;
    };
    included?: Array<{
      $type?: string;
      entityUrn?: string;
      type?: string;
      performedAt?: number;
      entityCount?: number;
    }>;
  };

  try {
    data = await salesFetch(
      csrf,
      `salesApiProfileTimeline?q=timeline&count=${count}&profile=${encodedUrn}&timelineActivityFilters=List(ALL)&decoration=${encodeRestLi(decoration)}`,
    );
  } catch (err: unknown) {
    // LinkedIn returns 500 for some profiles; return empty instead of throwing
    if (err instanceof Error && err.message.includes('500')) {
      return { activities: [] };
    }
    throw err;
  }

  const activities: GetLeadTimelineOutput['activities'] = [];
  const included = data.included || [];
  const entityMap = new Map<string, unknown>();
  for (const entity of included) {
    if (entity.entityUrn) entityMap.set(entity.entityUrn, entity);
  }

  // Try both direct elements and URN references
  type ElementType = NonNullable<typeof data.data>['elements'];
  const elements: ElementType =
    data.data?.elements ||
    (data.data?.['*elements']
      ?.map((urn) => entityMap.get(urn))
      .filter(Boolean) as ElementType) ||
    [];

  for (const elem of elements) {
    if (!elem) continue;
    activities.push({
      activityType: elem.type,
      timestamp: elem.performedAt,
      activityUrn: elem.entityUrn,
    });
  }

  return { activities };
}

// ============================================================================
// Account Operations
// ============================================================================

export async function getAccountDetail(
  params: GetAccountDetailInput,
): Promise<GetAccountDetailOutput> {
  const { csrf, companyId } = params;

  const decoration =
    '(entityUrn,name,account(saved,starred,noteCount,listCount,crmStatus),description,industry,location,headquarters,website,revenueRange,flagshipCompanyUrl,employeeGrowthPercentages,employeeCountRange,specialties,type,yearFounded)';

  const data = await salesFetch<{
    data?: {
      entityUrn?: string;
      name?: string;
      description?: string;
      industry?: string;
      location?: string;
      employeeCountRange?: string;
      revenueRange?: {
        estimatedMinRevenue?: {
          amount?: number;
          unit?: string;
          currencyCode?: string;
        };
        estimatedMaxRevenue?: {
          amount?: number;
          unit?: string;
          currencyCode?: string;
        };
      };
      headquarters?: {
        country?: string;
        city?: string;
        geographicArea?: string;
        postalCode?: string;
        line1?: string;
      };
      website?: string;
      flagshipCompanyUrl?: string;
      yearFounded?: number;
      type?: string;
      specialties?: string[];
      employeeGrowthPercentages?: Array<{
        timespan?: string;
        percentage?: number;
      }>;
      account?: {
        saved?: boolean;
        starred?: boolean;
        noteCount?: number;
        listCount?: number;
      };
    };
  }>(
    csrf,
    `salesApiCompanies/${companyId}?decoration=${encodeRestLi(decoration)}`,
  );

  const company = data.data;
  if (!company) {
    throw new NotFound(`Account not found: ${companyId}`);
  }

  // Format revenue range as human-readable string
  let revenue: string | undefined;
  if (
    company.revenueRange?.estimatedMinRevenue &&
    company.revenueRange?.estimatedMaxRevenue
  ) {
    const min = company.revenueRange.estimatedMinRevenue;
    const max = company.revenueRange.estimatedMaxRevenue;
    revenue = `${min.amount} ${min.unit} - ${max.amount} ${max.unit} ${min.currencyCode}`;
  }

  return {
    companyId,
    name: company.name,
    industry: company.industry,
    description: company.description,
    location: company.location,
    type: company.type,
    yearFounded: company.yearFounded,
    specialties:
      company.specialties && company.specialties.length > 0
        ? company.specialties
        : undefined,
    employeeCountRange: company.employeeCountRange,
    employeeGrowth:
      company.employeeGrowthPercentages &&
      company.employeeGrowthPercentages.length > 0
        ? company.employeeGrowthPercentages.map((g) => ({
            timespan: g.timespan,
            percentage: g.percentage,
          }))
        : undefined,
    revenue,
    headquarters: company.headquarters
      ? {
          country: company.headquarters.country,
          city: company.headquarters.city,
          state: company.headquarters.geographicArea,
          addressLine: company.headquarters.line1,
          postalCode: company.headquarters.postalCode,
        }
      : undefined,
    website: company.website,
    flagshipCompanyUrl: company.flagshipCompanyUrl,
    companyUrl: `https://www.linkedin.com/sales/company/${companyId}`,
    saved: company.account?.saved,
    starred: company.account?.starred,
    noteCount: company.account?.noteCount,
    listCount: company.account?.listCount,
  };
}

export async function getAccountLeads(
  params: GetAccountLeadsInput,
): Promise<GetAccountLeadsOutput> {
  const { csrf, companyId, start = 0, count = 25 } = params;

  // Use searchLeads with currentCompany filter
  return searchLeads({
    csrf,
    currentCompany: [companyId],
    start,
    count,
  });
}

export async function getAccountDossier(
  params: GetAccountDossierInput,
): Promise<GetAccountDossierOutput> {
  const { csrf, companyId } = params;

  // Response is wrapped in {data: {...}, included: [...]}
  const resp = await salesFetch<{
    data?: {
      strategicPriorities?: Array<{
        text?: string;
        description?: string;
        source?: string;
      }>;
      challenges?: Array<{
        text?: string;
        description?: string;
        source?: string;
      }>;
      competitiveLandscape?: {
        text?: string;
        description?: string;
        source?: string;
      };
      annualRevenue?: string;
      quarterRevenue?: string;
      cxoSummary?: string;
      bingCompanyNews?: Array<{
        title?: string;
        url?: string;
        datePublished?: string;
      }>;
      executivesProfiles?: Array<{
        firstName?: string;
        lastName?: string;
        title?: string;
        entityUrn?: string;
      }>;
      // competitorDetails is an OBJECT {competitors: [...], source: [...]}, NOT an array
      competitorDetails?: {
        competitors?: Array<{
          name?: string;
          companyId?: string;
          entityUrn?: string;
          industry?: string;
        }>;
        source?: string[];
      };
    };
  }>(
    csrf,
    `salesApiAccountDossier/${companyId}?accountIQUseCase=SALES_NAVIGATOR`,
  );

  const dossier = resp?.data;
  if (!dossier) {
    return {};
  }

  return {
    strategicPriorities: dossier.strategicPriorities,
    challenges: dossier.challenges,
    competitiveLandscape: dossier.competitiveLandscape,
    annualRevenue: dossier.annualRevenue,
    quarterRevenue: dossier.quarterRevenue,
    cxoSummary: dossier.cxoSummary,
    bingCompanyNews: dossier.bingCompanyNews,
    executivesProfiles: dossier.executivesProfiles?.map((e) => ({
      name: [e.firstName, e.lastName].filter(Boolean).join(' ') || undefined,
      title: e.title,
      profileId: e.entityUrn ? parseProfileId(e.entityUrn) : undefined,
    })),
    competitorDetails: dossier.competitorDetails?.competitors?.map((c) => ({
      companyName: c.name,
      companyId:
        c.companyId || (c.entityUrn ? parseCompanyId(c.entityUrn) : undefined),
    })),
  };
}

export async function getAccountHeadcount(
  params: GetAccountHeadcountInput,
): Promise<GetAccountHeadcountOutput> {
  const { csrf, companyId, includeFunctional = false } = params;

  // API returns {data: {medianTenure, monthlyHeadCounts: [{headCountsByDate: [...]}]}, included: [...]}
  // headCountsByDate entries have dateOn: {month, year, day} format
  const resp = await salesFetch<{
    data?: {
      medianTenure?: number;
      monthlyHeadCounts?: Array<{
        employeeCount?: number;
        employeePercentageDifference?: number;
        headCountsByDate?: Array<{
          dateOn?: { month?: number; year?: number; day?: number };
          employeeCount?: number;
          monthlyPercentageDifference?: number;
        }>;
      }>;
    };
  }>(
    csrf,
    `salesApiEmployeeInsights/${companyId}?employeeInsightType=TOTAL_HEADCOUNT`,
  );

  const totalData = resp?.data;
  // Extract the time series from the nested structure
  const headCountsByDate = totalData?.monthlyHeadCounts?.[0]?.headCountsByDate;

  const result: GetAccountHeadcountOutput = {
    medianTenure: totalData?.medianTenure,
    monthlyHeadCounts: headCountsByDate?.map((h) => {
      const d = h.dateOn;
      const date = d
        ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day || 1).padStart(2, '0')}`
        : undefined;
      return {
        date,
        employeeCount: h.employeeCount,
        monthlyPercentageDifference: h.monthlyPercentageDifference,
      };
    }),
  };

  // Optionally fetch functional breakdown
  if (includeFunctional) {
    const funcResp = await salesFetch<{
      data?: {
        oneYearHeadCountsByFunction?: Array<{
          functionName?: string;
          displayName?: string;
          employeeCount?: number;
          percentageDifference?: number;
          headCountsByDate?: Array<{
            dateOn?: { month?: number; year?: number; day?: number };
            employeeCount?: number;
          }>;
        }>;
      };
    }>(
      csrf,
      `salesApiEmployeeInsights/${companyId}?employeeInsightType=FUNCTIONAL_HEADCOUNT`,
    );

    result.functionalHeadCounts =
      funcResp?.data?.oneYearHeadCountsByFunction?.map((f) => ({
        displayName: f.displayName || f.functionName,
        employeeCount: f.employeeCount,
        percentageDifference: f.percentageDifference,
        history: f.headCountsByDate?.map((h) => {
          const d = h.dateOn;
          const date = d
            ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day || 1).padStart(2, '0')}`
            : undefined;
          return { date, count: h.employeeCount };
        }),
      }));
  }

  return result;
}

export async function getLeadHighlights(
  params: GetLeadHighlightsInput,
): Promise<GetLeadHighlightsOutput> {
  const { csrf, profileId } = params;

  // Highlights decoration: uses ~fs_salesProfile/~fs_salesCompany/~fs_salesSchool
  // to resolve URNs inline. Returns all shared connections with names.
  const highlightDecoration = encodeRestLi(
    '(sharedConnection(sharedConnectionUrns*~fs_salesProfile(entityUrn,firstName,lastName,fullName)),' +
      'teamlinkInfo(totalCount),' +
      'sharedEducations*(overlapInfo,entityUrn~fs_salesSchool(entityUrn,name)),' +
      'sharedExperiences*(overlapInfo,entityUrn~fs_salesCompany(entityUrn,name)),' +
      'sharedGroups*(entityUrn~fs_salesGroup(entityUrn,name)))',
  );

  // Warm intro: profileAuthKey must NOT be URL-encoded (RestLI handles it).
  // Uses ~fs_salesProfile for inline profile resolution.
  const profileAuthKey = `(profileId:${profileId},authType:undefined,authToken:undefined)`;
  const warmIntroDecoration = encodeRestLi(
    '(matchedPosition(title,current),' +
      'profileUrn~fs_salesProfile(entityUrn,firstName,lastName,fullName,degree),' +
      'seniorityLevel,sharedConnection,teamlink)',
  );

  // All 3 endpoints return normalized format: {data: {...}, included: [...]}
  // The ~fs_salesProfile decoration resolves URN references in data via the included array.
  type NormalizedResp<T> = {
    data?: T;
    included?: Array<Record<string, unknown>>;
  };

  const [spotlightResp, highlightResp, warmIntroResp] = await Promise.all([
    salesFetch<
      NormalizedResp<{
        spotlightBadges?: Array<{
          id?: string;
          displayValue?: string;
        }>;
      }>
    >(
      csrf,
      `salesApiProfileSpotlights/${profileId}?authType=undefined&authToken=undefined`,
    ).catch((): undefined => {
      // Optional profile endpoint — swallow errors so Promise.all never rejects.
      return undefined;
    }),

    salesFetch<
      NormalizedResp<{
        sharedConnection?: {
          sharedConnectionUrns?: Array<string>;
        };
        // Normalized references use * prefix: '*sharedExperiences', '*sharedEducations'
        '*sharedExperiences'?: Array<string>;
        '*sharedEducations'?: Array<string>;
      }>
    >(
      csrf,
      `salesApiProfileHighlights/${profileId}?decoration=${highlightDecoration}`,
    ).catch((): undefined => {
      // Optional profile endpoint — swallow errors so Promise.all never rejects.
      return undefined;
    }),

    salesFetch<
      NormalizedResp<{
        elements?: Array<{
          profileUrn?: string;
          '*profileUrnResolutionResult'?: string;
          matchedPosition?: { title?: string; current?: boolean };
          seniorityLevel?: string;
          sharedConnection?: boolean;
          teamlink?: boolean;
        }>;
      }>
    >(
      csrf,
      `salesApiWarmIntro?profileAuthKey=${profileAuthKey}&q=warmIntroBySeniority&warmIntroSpotlightType=ALL&decoration=${warmIntroDecoration}`,
    ).catch((): undefined => {
      // Optional profile endpoint — swallow errors so Promise.all never rejects.
      return undefined;
    }),
  ]);

  const spotlightData = spotlightResp?.data;

  // Build entity map from included arrays for URN → profile/company/school resolution
  const buildEntityMap = (included?: Array<Record<string, unknown>>) => {
    const map = new Map<string, Record<string, unknown>>();
    if (included) {
      for (const entity of included) {
        const urn = entity.entityUrn as string | undefined;
        if (urn) map.set(urn, entity);
      }
    }
    return map;
  };

  const highlightEntities = buildEntityMap(highlightResp?.included);
  const warmIntroEntities = buildEntityMap(warmIntroResp?.included);

  // Resolve shared connections: data.sharedConnection.sharedConnectionUrns[] → included profiles
  const connectionUrns =
    highlightResp?.data?.sharedConnection?.sharedConnectionUrns || [];
  const sharedConnections =
    connectionUrns.length > 0
      ? connectionUrns
          .map((urn) => {
            const profile = highlightEntities.get(urn);
            return {
              profileId: parseProfileId(urn),
              fullName: (profile?.fullName as string) || undefined,
            };
          })
          .filter(
            (c): c is { profileId: string; fullName: string | undefined } =>
              !!c.profileId,
          )
      : undefined;

  // Resolve shared experiences: '*sharedExperiences' references → included companies
  const expRefs = (highlightResp?.data as Record<string, unknown>)?.[
    '*sharedExperiences'
  ] as string[] | undefined;
  const sharedExperiences = expRefs?.map((urn) => {
    const entity = highlightEntities.get(urn);
    const overlapInfo = entity?.overlapInfo as
      | {
          detailUnion?: {
            duration?: { numMonths?: number; numYears?: number };
          };
        }
      | undefined;
    // Resolve the company URN reference
    const companyUrn = entity?.['*entityUrnResolutionResult'] as
      | string
      | undefined;
    const company = companyUrn
      ? highlightEntities.get(companyUrn)
      : (entity?.entityUrnResolutionResult as
          | Record<string, unknown>
          | undefined);
    const duration = overlapInfo?.detailUnion?.duration;
    return {
      companyName: (company?.name as string) || undefined,
      overlapDuration: duration
        ? `${duration.numYears || 0}y ${duration.numMonths || 0}m`
        : undefined,
    };
  });

  // Resolve shared educations similarly
  const eduRefs = (highlightResp?.data as Record<string, unknown>)?.[
    '*sharedEducations'
  ] as string[] | undefined;
  const sharedEducations = eduRefs?.map((urn) => {
    const entity = highlightEntities.get(urn);
    const schoolUrn = entity?.['*entityUrnResolutionResult'] as
      | string
      | undefined;
    const school = schoolUrn
      ? highlightEntities.get(schoolUrn)
      : (entity?.entityUrnResolutionResult as
          | Record<string, unknown>
          | undefined);
    return {
      schoolName: (school?.name as string) || undefined,
    };
  });

  // Resolve warm intros: elements[].profileUrn → included profiles
  const warmIntros = warmIntroResp?.data?.elements?.map((w) => {
    const profileUrn = w['*profileUrnResolutionResult'] || w.profileUrn;
    const profile = profileUrn ? warmIntroEntities.get(profileUrn) : undefined;
    return {
      name: (profile?.fullName as string) || undefined,
      profileId: profileUrn ? parseProfileId(profileUrn) : undefined,
      title: w.matchedPosition?.title,
      seniorityLevel: w.seniorityLevel,
      sharedConnection: w.sharedConnection,
      teamlink: w.teamlink,
    };
  });

  return {
    spotlights: spotlightData?.spotlightBadges?.map((s) => ({
      type: s.id,
      displayValue: s.displayValue,
    })),
    sharedConnections,
    sharedExperiences,
    sharedEducations,
    warmIntros,
  };
}

// ============================================================================
// List Management
// ============================================================================

export async function listLeadLists(
  params: ListLeadListsInput,
): Promise<ListLeadListsOutput> {
  const { csrf } = params;

  const decoration =
    '(id,listType,listSource,name,role,lastModifiedAt,entityCount)';

  const data = await salesFetch<{
    data?: {
      elements?: Array<{
        id?: string;
        name?: string;
        entityCount?: number;
        lastModifiedAt?: number;
      }>;
      '*elements'?: string[];
    };
    included?: Array<{
      entityUrn?: string;
      id?: string;
      name?: string;
      entityCount?: number;
      lastModifiedAt?: number;
    }>;
  }>(
    csrf,
    `salesApiLists?q=listType&listType=LEAD&listSources=List(MANUAL,SYSTEM)&isMetadataNeeded=true&start=0&count=100&sortCriteria=LAST_MODIFIED&sortOrder=DESCENDING&ownership=OWNED_BY_VIEWER&decoration=${encodeRestLi(decoration)}`,
  );

  // Lists can be inline elements or URN references
  const entityMap = new Map<string, unknown>();
  for (const entity of data.included || []) {
    const e = entity as { entityUrn?: string };
    if (e.entityUrn) entityMap.set(e.entityUrn, entity);
  }

  const rawElements =
    data.data?.elements ||
    data.data?.['*elements']?.map((urn) => entityMap.get(urn)) ||
    [];

  const lists = rawElements
    .filter(Boolean)
    .map((item) => {
      const list = item as {
        id?: string;
        name?: string;
        entityCount?: number;
        lastModifiedAt?: number;
      };
      if (!list.id) return null;
      return {
        listId: list.id,
        name: list.name,
        leadCount: list.entityCount,
        createdAt: list.lastModifiedAt,
      };
    })
    .filter(Boolean) as Array<{
    listId: string;
    name?: string;
    leadCount?: number;
    createdAt?: number;
  }>;

  return { lists };
}

export async function listAccountLists(
  params: ListAccountListsInput,
): Promise<ListAccountListsOutput> {
  const { csrf } = params;

  const decoration =
    '(id,listType,listSource,name,role,lastModifiedAt,entityCount)';

  const data = await salesFetch<{
    data?: {
      elements?: Array<{
        id?: string;
        name?: string;
        entityCount?: number;
        lastModifiedAt?: number;
      }>;
      '*elements'?: string[];
    };
    included?: Array<{
      entityUrn?: string;
      id?: string;
      name?: string;
      entityCount?: number;
      lastModifiedAt?: number;
    }>;
  }>(
    csrf,
    `salesApiLists?q=listType&listType=ACCOUNT&listSources=List(MANUAL,SYSTEM)&isMetadataNeeded=true&start=0&count=100&sortCriteria=LAST_MODIFIED&sortOrder=DESCENDING&ownership=OWNED_BY_VIEWER&decoration=${encodeRestLi(decoration)}`,
  );

  const entityMap = new Map<string, unknown>();
  for (const entity of data.included || []) {
    const e = entity as { entityUrn?: string };
    if (e.entityUrn) entityMap.set(e.entityUrn, entity);
  }

  const rawElements =
    data.data?.elements ||
    data.data?.['*elements']?.map((urn) => entityMap.get(urn)) ||
    [];

  const lists = rawElements
    .filter(Boolean)
    .map((item) => {
      const list = item as {
        id?: string;
        name?: string;
        entityCount?: number;
        lastModifiedAt?: number;
      };
      if (!list.id) return null;
      return {
        listId: list.id,
        name: list.name,
        accountCount: list.entityCount,
        createdAt: list.lastModifiedAt,
      };
    })
    .filter(Boolean) as Array<{
    listId: string;
    name?: string;
    accountCount?: number;
    createdAt?: number;
  }>;

  return { lists };
}

export async function getLeadsInList(
  params: GetLeadsInListInput,
): Promise<GetLeadsInListOutput> {
  const { csrf, listId, start = 0, count = 25 } = params;

  const listUrn = `urn:li:fs_salesList:${listId}`;
  const encodedUrn = encodeRestLi(listUrn);

  const query = `(spotlightParam:(selectedType:ALL),doFetchSpotlights:true,doFetchHits:true,doFetchFilters:false,pivotParam:(com.linkedin.sales.search.LeadListPivotRequest:(list:${encodedUrn},sortCriteria:CREATED_TIME,sortOrder:DESCENDING)),list:(scope:LEAD,includeAll:false,excludeAll:false,includedValues:List((id:${listId}))))`;
  const decorationId =
    'com.linkedin.sales.deco.desktop.searchv2.LeadSearchResult-14';

  const data = await salesFetch<{
    data?: {
      paging?: { total?: number };
      '*elements'?: string[];
      elements?: unknown[];
    };
    included?: unknown[];
  }>(
    csrf,
    `salesApiPeopleSearch?q=peopleSearchQuery&query=${query}&start=${start}&count=${count}&decorationId=${decorationId}`,
  );

  const results = parseLeadResults(
    data as Parameters<typeof parseLeadResults>[0],
  );
  const total = data.data?.paging?.total;

  return { results, total };
}

export async function createList(
  params: CreateListInput,
): Promise<CreateListOutput> {
  const { csrf, name, type } = params;

  const data = await salesFetch<{
    data?: { id?: string; name?: string; listType?: string };
  }>(csrf, 'salesApiLists', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name,
      listType: type,
      role: 'OWNER',
    }),
  });

  if (!data?.data?.id) {
    throw new ContractDrift('List creation returned no ID');
  }

  return {
    listId: data.data.id,
    name: data.data.name || name,
    type: data.data.listType || type,
  };
}

export async function deleteList(
  params: DeleteListInput,
): Promise<DeleteListOutput> {
  const { csrf, listId } = params;

  await salesFetch(
    csrf,
    `salesApiLists/${listId}?unsaveEntity=false&doUnsaveLeadsUnderAccount=false`,
    {
      method: 'DELETE',
    },
  );

  return { success: true };
}

export async function saveLead(params: SaveLeadInput): Promise<SaveLeadOutput> {
  const { csrf, profileId, companyId, listIds } = params;

  const body: {
    member: string;
    isWithoutAccount: boolean;
    company?: number;
    lists?: string[];
  } = {
    member: profileId,
    isWithoutAccount: false,
  };

  if (companyId) {
    body.company = parseInt(companyId, 10);
  }

  if (listIds && listIds.length > 0) {
    body.lists = listIds;
  }

  try {
    await salesFetch(csrf, 'salesApiLeads?action=saveByMember', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    return { success: true };
  } catch (error) {
    throw new UpstreamError(
      `Failed to save lead: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function unsaveLead(
  params: UnsaveLeadInput,
): Promise<UnsaveLeadOutput> {
  const { csrf, profileId } = params;

  try {
    await salesFetch(csrf, 'salesApiLeads?action=unsaveByMember', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        member: profileId,
      }),
    });

    return { success: true };
  } catch (error) {
    throw new UpstreamError(
      `Failed to unsave lead: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ============================================================================
// List Management
// ============================================================================

export async function updateList(
  params: UpdateListInput,
): Promise<UpdateListOutput> {
  const { csrf, listId, name } = params;

  await salesFetch(csrf, `salesApiLists/${listId}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-restli-method': 'PARTIAL_UPDATE',
    },
    body: JSON.stringify({
      patch: { $set: { name } },
    }),
  });

  return { success: true };
}

export async function getAccountsInList(
  params: GetAccountsInListInput,
): Promise<GetAccountsInListOutput> {
  const { csrf, listId, start = 0, count = 25 } = params;

  const data = await salesFetch<{
    elements?: Array<{
      companyInfo?: {
        entityUrn?: string;
        name?: string;
        industry?: string;
        employeeCount?: number;
        employeeDisplayCount?: string;
        description?: string;
      };
    }>;
    paging?: { total?: number; count?: number; start?: number };
  }>(
    csrf,
    `salesApiDashboardAccountTable?q=list&listId=${listId}&accountDashboardListType=CUSTOM_LISTS&sortCriteria=NAME&sortOrder=ASCENDING&start=${start}&count=${count}&columns=List(UNIFIED_RECOMMENDED_LEAD)&doPersonaQuery=true`,
    {
      headers: {
        accept: 'application/json',
      },
    },
  );

  const results: AccountResult[] = [];
  for (const elem of data.elements || []) {
    const info = elem.companyInfo;
    if (!info?.entityUrn) continue;

    const companyId = parseCompanyId(info.entityUrn);
    if (!companyId) continue;

    results.push({
      companyId,
      name: info.name,
      industry: info.industry,
      description: info.description,
      employeeCount: info.employeeCount,
      employeeCountRange: info.employeeDisplayCount,
      companyUrl: `https://www.linkedin.com/sales/company/${companyId}`,
    });
  }

  const total = data.paging?.total;

  return { results, total };
}

export async function addLeadToList(
  params: AddLeadToListInput,
): Promise<AddLeadToListOutput> {
  const { csrf, profileId, listIds } = params;

  const entityUrn = `urn:li:fs_salesProfile:(${profileId},NAME_SEARCH,undefined)`;

  await salesFetch(csrf, 'salesApiListEntities?action=edit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      entity: entityUrn,
      addToLists: listIds,
      removeFromLists: [],
    }),
  });

  return { success: true };
}

export async function removeLeadFromList(
  params: RemoveLeadFromListInput,
): Promise<RemoveLeadFromListOutput> {
  const { csrf, profileId, listIds } = params;

  const entityUrn = `urn:li:fs_salesProfile:(${profileId},NAME_SEARCH,undefined)`;

  await salesFetch(csrf, 'salesApiListEntities?action=edit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      entity: entityUrn,
      addToLists: [],
      removeFromLists: listIds,
    }),
  });

  return { success: true };
}

export async function addAccountToList(
  params: AddAccountToListInput,
): Promise<AddAccountToListOutput> {
  const { csrf, companyId, listIds } = params;

  const entityUrn = `urn:li:fs_salesCompany:${companyId}`;

  await salesFetch(csrf, 'salesApiListEntities?action=edit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      entity: entityUrn,
      addToLists: listIds,
      removeFromLists: [],
    }),
  });

  return { success: true };
}

export async function removeAccountFromList(
  params: RemoveAccountFromListInput,
): Promise<RemoveAccountFromListOutput> {
  const { csrf, companyId, listIds } = params;

  const entityUrn = `urn:li:fs_salesCompany:${companyId}`;

  await salesFetch(csrf, 'salesApiListEntities?action=edit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      entity: entityUrn,
      addToLists: [],
      removeFromLists: listIds,
    }),
  });

  return { success: true };
}

export async function saveAccount(
  params: SaveAccountInput,
): Promise<SaveAccountOutput> {
  const { csrf, companyId, listIds } = params;

  await salesFetch(csrf, 'salesApiCompanies?action=save', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      companyIds: [parseInt(companyId, 10)],
      lists: listIds || [],
    }),
  });

  return { success: true };
}

export async function unsaveAccount(
  params: UnsaveAccountInput,
): Promise<UnsaveAccountOutput> {
  const { csrf, companyId, unsaveLeads = false } = params;

  await salesFetch(csrf, 'salesApiCompanies?action=unsave', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      companyIds: [parseInt(companyId, 10)],
      doUnsaveLeadsUnderAccount: unsaveLeads,
    }),
  });

  return { success: true };
}

// ============================================================================
// Notes
// ============================================================================

export async function getLeadNotes(
  params: GetLeadNotesInput,
): Promise<GetLeadNotesOutput> {
  const { csrf, profileId } = params;

  const entityUrn = `urn:li:fs_salesProfile:(${profileId},undefined,undefined)`;
  const encodedUrn = encodeRestLi(entityUrn);

  const data = await salesFetch<{
    data?: {
      elements?: Array<{
        noteId?: number;
        body?: { text?: string };
        bodyText?: string;
        createdAt?: number;
        ownerInfo?: { fullName?: string };
        seat?: string;
        entity?: string;
      }>;
    };
  }>(
    csrf,
    `salesApiEntityNote?count=100&entityUrn=${encodedUrn}&q=entity&start=0&visibility=ALL`,
  );

  const elements = data.data?.elements;
  if (!elements) {
    return { notes: [] };
  }

  const notes = elements.map((note) => {
    if (note.noteId === undefined) {
      throw new ContractDrift('Note missing required noteId field');
    }
    return {
      noteId: String(note.noteId),
      text: note.body?.text || note.bodyText,
      createdAt: note.createdAt,
      authorName: note.ownerInfo?.fullName,
      seat: note.seat,
      entity: note.entity,
    };
  });

  return { notes };
}

export async function getAccountNotes(
  params: GetAccountNotesInput,
): Promise<GetAccountNotesOutput> {
  const { csrf, companyId } = params;

  const entityUrn = `urn:li:fs_salesCompany:${companyId}`;
  const encodedUrn = encodeRestLi(entityUrn);

  const data = await salesFetch<{
    data?: {
      elements?: Array<{
        noteId?: number;
        body?: { text?: string };
        bodyText?: string;
        createdAt?: number;
        ownerInfo?: { fullName?: string };
        seat?: string;
        entity?: string;
      }>;
    };
  }>(
    csrf,
    `salesApiEntityNote?count=100&entityUrn=${encodedUrn}&q=entity&start=0&visibility=ALL`,
  );

  const elements = data.data?.elements;
  if (!elements) {
    return { notes: [] };
  }

  const notes = elements.map((note) => {
    if (note.noteId === undefined) {
      throw new ContractDrift('Note missing required noteId field');
    }
    return {
      noteId: String(note.noteId),
      text: note.body?.text || note.bodyText,
      createdAt: note.createdAt,
      authorName: note.ownerInfo?.fullName,
      seat: note.seat,
      entity: note.entity,
    };
  });

  return { notes };
}

export async function createNote(
  params: CreateNoteInput,
): Promise<CreateNoteOutput> {
  const { csrf, entityType, entityId, text } = params;

  const entityUrn =
    entityType === 'LEAD'
      ? `urn:li:fs_salesProfile:(${entityId},undefined,undefined)`
      : `urn:li:fs_salesCompany:${entityId}`;

  const response = await fetch(
    'https://www.linkedin.com/sales-api/salesApiEntityNote',
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'csrf-token': csrf,
        ...SALES_NAV_HEADERS,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        body: { attributes: [], text },
        entity: entityUrn,
        copyToCrm: false,
      }),
    },
  );

  if (!response.ok) {
    const errBody = await response.text().catch(() => undefined);
    throwForStatus(response.status, `Failed to create note: ${response.status} ${errBody?.slice(0, 500)}`);
  }

  // noteId is in the x-restli-id header: "{seat=..., entity=..., noteId=12345}"
  const restliId = response.headers.get('x-restli-id') || '';
  const noteIdMatch = restliId.match(/noteId=(\d+)/);
  if (!noteIdMatch) {
    throw new ContractDrift('Note creation returned no noteId in x-restli-id header');
  }

  return {
    noteId: noteIdMatch[1],
    text,
  };
}

export async function updateNote(
  params: UpdateNoteInput,
): Promise<UpdateNoteOutput> {
  const { csrf, noteId, entity, seat, text } = params;

  const encodedEntity = encodeRestLi(entity);
  const encodedSeat = encodeRestLi(seat);

  try {
    await salesFetch(
      csrf,
      `salesApiEntityNote/(entity:${encodedEntity},noteId:${noteId},seat:${encodedSeat})`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          patch: {
            $set: {
              body: {
                attributes: [],
                text,
              },
              copyToCrm: false,
            },
          },
        }),
      },
    );

    return { success: true };
  } catch (error) {
    throw new UpstreamError(
      `Failed to update note: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function deleteNote(
  params: DeleteNoteInput,
): Promise<DeleteNoteOutput> {
  const { csrf, noteId, entity, seat } = params;

  const encodedEntity = encodeRestLi(entity);
  const encodedSeat = encodeRestLi(seat);

  try {
    await salesFetch(
      csrf,
      `salesApiEntityNote/(entity:${encodedEntity},noteId:${noteId},seat:${encodedSeat})`,
      {
        method: 'DELETE',
      },
    );

    return { success: true };
  } catch (error) {
    throw new UpstreamError(
      `Failed to delete note: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// ============================================================================
// Messaging (InMail)
// ============================================================================

export async function listInMailThreads(
  params: ListInMailThreadsInput,
): Promise<ListInMailThreadsOutput> {
  const { csrf, count = 20 } = params;

  const decoration =
    '(id,restrictions,archived,unreadMessageCount,totalMessageCount,messages*(id,type,deliveredAt,subject,body,author),participants*~fs_salesProfile(entityUrn,firstName,lastName,fullName,degree,objectUrn))';

  // Use current timestamp as pageStartsAt (returns most recent threads)
  const pageStartsAt = Date.now();

  const data = await salesFetch<{
    data?: {
      '*elements'?: string[];
      elements?: unknown[];
    };
    included?: Array<{
      $type?: string;
      entityUrn?: string;
      id?: string;
      subject?: string;
      unreadMessageCount?: number;
      totalMessageCount?: number;
      archived?: boolean;
      messages?: Array<{
        id?: string;
        subject?: string;
        body?: string;
        deliveredAt?: number;
        author?: string;
      }>;
      '*participants'?: string[];
      // Profile entities for participant resolution
      firstName?: string;
      lastName?: string;
      fullName?: string;
      objectUrn?: string;
    }>;
  }>(
    csrf,
    `salesApiMessagingThreads?decoration=${encodeRestLi(decoration)}&count=${count}&filter=INBOX&pageStartsAt=${pageStartsAt}&q=filter`,
  );

  // Build entity map from included array (profiles for participant resolution)
  const included = data.included || [];
  const entityMap = new Map<
    string,
    { fullName?: string; objectUrn?: string; degree?: number }
  >();
  for (const entity of included) {
    if (entity.entityUrn) entityMap.set(entity.entityUrn, entity);
  }

  // Elements are inline in data.elements (not URN references)
  const elements = (data.data as { elements?: unknown[] })?.elements || [];
  const threads: ListInMailThreadsOutput['threads'] = [];

  for (const elem of elements) {
    const thread = elem as {
      id?: string;
      unreadMessageCount?: number;
      totalMessageCount?: number;
      messages?: Array<{
        subject?: string;
        body?: string;
        deliveredAt?: number;
      }>;
      participants?: string[];
    };
    if (!thread?.id) continue;

    // Get most recent message
    const lastMessage = thread.messages?.[0];

    // Resolve first non-self participant from included profiles
    let participantName: string | undefined;
    let participantProfileId: string | undefined;
    for (const participantUrn of thread.participants || []) {
      const profile = entityMap.get(participantUrn);
      if (profile && profile.objectUrn) {
        // Skip self (degree 0)
        if (profile.degree === 0) continue;
        participantName = profile.fullName;
        participantProfileId = profile.objectUrn.match(/member:(\d+)/)?.[1];
        break;
      }
    }

    threads.push({
      threadId: thread.id,
      subject: lastMessage?.subject,
      lastMessageText: lastMessage?.body,
      lastMessageTime: lastMessage?.deliveredAt,
      unread: (thread.unreadMessageCount || 0) > 0,
      participantName,
      participantProfileId,
    });
  }

  const total = (data.data as { paging?: { total?: number } })?.paging?.total;
  return { threads, total };
}

export async function viewInMailThread(
  params: ViewInMailThreadInput,
): Promise<ViewInMailThreadOutput> {
  const { csrf, threadId } = params;

  const decoration =
    '(id,restrictions,archived,unreadMessageCount,totalMessageCount,messages*(id,type,contentFlag,deliveredAt,lastEditedAt,subject,body,footerText,attachments,author,systemMessageContent),participants*~fs_salesProfile(entityUrn,firstName,lastName,fullName,degree,objectUrn))';

  const data = await salesFetch<{
    data?: {
      id?: string;
      messages?: Array<{
        id?: string;
        subject?: string;
        body?: string;
        deliveredAt?: number;
        author?: string; // URN reference
        type?: string;
      }>;
      '*participants'?: string[];
    };
    included?: Array<{
      entityUrn?: string;
      fullName?: string;
      objectUrn?: string;
    }>;
  }>(
    csrf,
    `salesApiMessagingThreads/${threadId}?decoration=${encodeRestLi(decoration)}`,
  );

  // Build entity map for author resolution
  const entityMap = new Map<
    string,
    { fullName?: string; objectUrn?: string }
  >();
  for (const entity of data.included || []) {
    if (entity.entityUrn) entityMap.set(entity.entityUrn, entity);
  }

  const rawMessages = data.data?.messages || [];

  const messages = rawMessages
    .map((msg) => {
      if (!msg.id) return null;

      // Resolve author
      const authorEntity = msg.author ? entityMap.get(msg.author) : undefined;

      return {
        messageId: msg.id,
        text: msg.body,
        sentAt: msg.deliveredAt,
        senderName: authorEntity?.fullName,
        senderProfileId: authorEntity?.objectUrn
          ? authorEntity.objectUrn.match(/member:(\d+)/)?.[1]
          : undefined,
        isInMail: msg.type === 'INMAIL',
      };
    })
    .filter(Boolean) as ViewInMailThreadOutput['messages'];

  return { messages };
}

export async function sendInMail(
  params: SendInMailInput,
): Promise<SendInMailOutput> {
  const { csrf, identityToken, profileId, subject, body, threadId } = params;

  const recipientUrn = `urn:li:fs_salesProfile:(${profileId},undefined,undefined)`;

  // Generate a random tracking ID (16 bytes as raw chars, matching LinkedIn's format)
  const trackingId = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => String.fromCharCode(b))
    .join('');

  const data = await salesFetch<{
    data?: {
      value?: {
        messageId?: string;
        threadId?: string;
      };
    };
  }>(csrf, 'salesApiMessageActions?action=createMessage', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-li-identity': identityToken,
    },
    body: JSON.stringify({
      createMessageRequest: {
        body,
        ...(subject ? { subject } : {}),
        recipients: [recipientUrn],
        ...(threadId ? { threadId } : {}),
        copyToCrm: false,
        trackingId,
      },
    }),
  });

  return {
    success: true,
    messageId: data?.data?.value?.messageId,
    threadId: data?.data?.value?.threadId,
  };
}

// ============================================================================
// Saved Searches
// ============================================================================

export async function listSavedSearches(
  params: ListSavedSearchesInput,
): Promise<ListSavedSearchesOutput> {
  const { csrf, type } = params;

  let qParam: string;
  if (type === 'LEAD') {
    qParam = 'savedPeopleSearches';
  } else if (type === 'ACCOUNT') {
    qParam = 'savedAccountSearches';
  } else {
    throw new Validation(`Invalid saved search type: ${type}`);
  }
  const decoration =
    '(createdAt,id,lastViewedAt,name,newHitsCount,seat,keywords,filters)';

  const data = await salesFetch<{
    data?: {
      elements?: Array<{
        id?: string;
        name?: string;
        createdAt?: number;
        alertEnabled?: boolean;
      }>;
    };
  }>(
    csrf,
    `salesApiSavedSearchesV2?decoration=${encodeRestLi(decoration)}&count=50&q=${qParam}&start=0`,
  );

  const elements = data.data?.elements;
  if (!elements) {
    return { searches: [] };
  }

  const searchType: 'LEAD' | 'ACCOUNT' =
    type === 'ACCOUNT' ? 'ACCOUNT' : 'LEAD';

  const searches = elements.map((search) => {
    if (!search.id) {
      throw new ContractDrift('Saved search missing required id field');
    }
    return {
      savedSearchId: search.id,
      name: search.name,
      type: searchType,
      alertEnabled: search.alertEnabled,
      createdAt: search.createdAt,
    };
  });

  return { searches };
}

// ============================================================================
// Notifications
// ============================================================================

export async function listSalesNavNotifications(
  params: ListSalesNavNotificationsInput,
): Promise<ListSalesNavNotificationsOutput> {
  const { csrf, start = 0, count = 25 } = params;

  const decorationId =
    'com.linkedin.sales.deco.mobile.notifications.DecoratedCardRecipe-10';

  const data = await salesFetch<{
    data?: {
      '*elements'?: string[];
      elements?: unknown[];
      paging?: { total?: number };
    };
    included?: Array<{
      entityUrn?: string;
      notificationUrn?: string;
      type?: string;
      headline?: { text?: string };
      body?: { text?: string };
      read?: boolean;
      publishedAt?: number;
      actionTarget?: string;
    }>;
  }>(
    csrf,
    `salesApiNotifications?count=${count}&decorationId=${decorationId}&q=criteria&sortBy=RELEVANCE&start=${start}`,
  );

  // Build entity map for URN resolution
  const included = data.included || [];
  const entityMap = new Map<string, (typeof included)[0]>();
  for (const entity of included) {
    if (entity.entityUrn) entityMap.set(entity.entityUrn, entity);
  }

  // Resolve elements from URN references or direct elements
  const elementUrns = data.data?.['*elements'] || [];
  const resolvedElements =
    elementUrns.length > 0
      ? elementUrns
          .map((urn) => entityMap.get(urn))
          .filter((x): x is NonNullable<typeof x> => x != null)
      : ((data.data?.elements || []) as typeof included);

  const notifications = resolvedElements
    .map((notif) => {
      // Extract notification ID from URN: urn:li:notificationV2:(...)
      const notifUrn = notif.notificationUrn || notif.entityUrn || '';
      const notifId =
        notifUrn.match(/notificationV2:\((.+)\)/)?.[1] || notifUrn;
      if (!notifId) return null;

      return {
        notificationId: notifId,
        type: notif.type,
        text: notif.headline?.text || notif.body?.text,
        timestamp: notif.publishedAt,
        read: notif.read,
        actionUrl: notif.actionTarget,
      };
    })
    .filter(Boolean) as ListSalesNavNotificationsOutput['notifications'];

  return {
    notifications,
    total: data.data?.paging?.total,
  };
}

// ============================================================================
// Credits
// ============================================================================

export async function getInMailCredits(
  params: GetInMailCreditsInput,
): Promise<GetInMailCreditsOutput> {
  const { csrf } = params;

  const data = await salesFetch<{
    data?: {
      elements?: Array<{
        id?: number;
        type?: string;
        value?: number;
      }>;
    };
  }>(csrf, 'salesApiCredits?q=findCreditGrant&creditGrantType=LSS_INMAIL');

  const creditGrant = data.data?.elements?.[0];
  if (!creditGrant) {
    throw new NotFound('InMail credit grant not found');
  }

  return {
    credits: creditGrant.value || 0,
  };
}

// ============================================================================
// Filter Discovery
// ============================================================================

export async function searchFilterValues(
  params: SearchFilterValuesInput,
): Promise<SearchFilterValuesOutput> {
  const { csrf, filterType, query = '' } = params;
  const count = query ? 10 : 100; // Fetch more when listing all
  const url = `salesApiFacetTypeahead?q=query&start=0&count=${count}&type=${encodeURIComponent(filterType)}${query ? `&query=${encodeURIComponent(query)}` : ''}`;

  const resp = await salesFetch<{
    data?: {
      elements?: Array<{ id?: string | number; displayValue?: string }>;
    };
    included?: Array<{ id?: string | number; displayValue?: string }>;
  }>(csrf, url);

  // LinkedIn normalized JSON may return values in either `data.elements` or `included`.
  // Check both and merge, deduplicating by ID.
  const fromElements = (resp.data?.elements || [])
    .filter((e) => e.id != null && e.displayValue)
    .map((e) => ({ id: String(e.id), label: e.displayValue! }));

  const fromIncluded = (resp.included || [])
    .filter((e) => e.id != null && e.displayValue)
    .map((e) => ({ id: String(e.id), label: e.displayValue! }));

  // Merge with elements taking priority (dedup by ID)
  const seen = new Set<string>();
  const values: Array<{ id: string; label: string }> = [];
  for (const v of [...fromElements, ...fromIncluded]) {
    if (!seen.has(v.id)) {
      seen.add(v.id);
      values.push(v);
    }
  }

  return { values };
}
