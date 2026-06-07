/**
 * PitchBook Library
 *
 * Browser-executable PitchBook operations via internal APIs.
 * Requires user to be logged into PitchBook at my.pitchbook.com.
 */

export type {
  GetContextInput,
  GetContextOutput,
  GetRecentSearchesInput,
  GetRecentSearchesOutput,
  GetCompanyQuickStatsInput,
  GetCompanyQuickStatsOutput,
  GetCompanySuggestsInput,
  GetCompanySuggestsOutput,
  CreateScreenerInput,
  CreateScreenerOutput,
  GetScreenerInput,
  GetScreenerOutput,
  GetScreenerCriteriaInput,
  GetScreenerCriteriaOutput,
  UpdateScreenerCriteriaInput,
  UpdateScreenerCriteriaOutput,
  RunScreenerInput,
  RunScreenerOutput,
  GetScreenerCountInput,
  GetScreenerCountOutput,
  GetScreenerResultsInput,
  GetScreenerResultsOutput,
  GetScreenerColumnsInput,
  GetScreenerColumnsOutput,
  SearchCompaniesInput,
  SearchCompaniesOutput,
  SearchDealsInput,
  SearchDealsOutput,
  SearchInvestorsInput,
  SearchInvestorsOutput,
  SearchFundsInput,
  SearchFundsOutput,
  GetSavedSearchesInput,
  GetSavedSearchesOutput,
  GlobalSearchInput,
  GlobalSearchOutput,
  GetCompanyProfileInput,
  GetCompanyProfileOutput,
  GetCompanyDealHistoryInput,
  GetCompanyDealHistoryOutput,
  GetCompanyCapTableInput,
  GetCompanyCapTableOutput,
  GetIndustryTreeInput,
  GetIndustryTreeOutput,
  GetFilterTreesInput,
  GetFilterTreesOutput,
  SearchNewsInput,
  SearchNewsOutput,
} from './schemas.js';

import { Validation, ContractDrift, UpstreamError, throwForStatus } from '@vallum/_runtime';

// === Helpers ===

const BASE = 'https://my.pitchbook.com/web-api';
const HEADERS: Record<string, string> = {
  Accept: 'application/json;charset=UTF-8',
  'Content-Type': 'application/json',
  'X-Requested-With': 'XMLHttpRequest',
};
// Profile endpoints return 500 with charset suffix — use plain application/json
const PROFILE_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'X-Requested-With': 'XMLHttpRequest',
};

async function pbFetch<T>(
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    method: options?.method ?? 'GET',
    headers: options?.headers ?? HEADERS,
    credentials: 'include' as RequestCredentials,
    ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, text);
  }
  const text = await resp.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

// === Context ===

export async function getContext(): Promise<{
  userId: number;
  login: string;
  firstName: string;
  lastName: string;
  accountName: string;
  accountId: number;
  maxResultsPageSize: number;
}> {
  const [general, account] = await Promise.all([
    pbFetch<{
      id: number;
      login: string;
      firstName: string;
      lastName: string;
      primaryAccountId: number;
    }>('/users/me/general'),
    pbFetch<{
      accountName: string;
      maxResultsPageSize: number;
    }>('/users/me/account'),
  ]);

  return {
    userId: general.id,
    login: general.login,
    firstName: general.firstName,
    lastName: general.lastName,
    accountName: account.accountName,
    accountId: general.primaryAccountId,
    maxResultsPageSize: account.maxResultsPageSize,
  };
}

// === Recent Searches ===

export async function getRecentSearches(args: { limit?: number }): Promise<{
  items: Array<{
    type: string;
    profileResult?: {
      id: string;
      name: string;
      description?: string;
      typeDescription?: string;
      location?: string;
    };
    sparseData?: Record<string, unknown>;
    website?: string;
  }>;
}> {
  const limit = args.limit ?? 15;
  const tz = new Date().getTimezoneOffset();
  const tzHours = Math.floor(Math.abs(tz) / 60);
  const tzMins = Math.abs(tz) % 60;
  const tzSign = tz <= 0 ? '-' : '+';
  const tzOffset = `${tzSign}${String(tzHours).padStart(2, '0')}:${String(tzMins).padStart(2, '0')}`;

  const data = await pbFetch<{
    items: Array<{ type: string; value: Record<string, unknown> }>;
  }>(
    `/general-search/recent/all?limit=${limit}&offset=0&timeZoneOffset=${encodeURIComponent(tzOffset)}`,
  );

  return {
    items: data.items.map((item) => {
      const val = item.value as Record<string, unknown>;
      const profile = val.profileResult as Record<string, unknown> | undefined;
      const sparse = val.sparseData as Record<string, unknown> | undefined;
      return {
        type: item.type,
        profileResult: profile
          ? {
              id: profile.id as string,
              name: profile.name as string,
              description: profile.description as string | undefined,
              typeDescription: profile.typeDescription as string | undefined,
              location: profile.location as string | undefined,
            }
          : undefined,
        sparseData: sparse,
        website: val.website as string | undefined,
      };
    }),
  };
}

// === Company Quick Stats ===

export async function getCompanyQuickStats(args: {
  items: Array<{ id: string; type?: string; subType?: string }>;
}): Promise<{
  quickStats: Array<{
    id: string;
    subType: string;
    quickStats: Record<string, unknown>;
  }>;
}> {
  return pbFetch('/general-search/quick-stats', {
    method: 'POST',
    body: {
      items: args.items.map((i) => ({
        id: i.id,
        type: i.type ?? 'PROFILE',
        subType: i.subType ?? 'PRIVATE_COMPANY',
      })),
    },
  });
}

// === Company Suggests ===

export async function getCompanySuggests(args: {
  companies: Array<{ pbId: string; type?: string }>;
}): Promise<{
  results: Array<{
    type: string;
    pbId: string;
    dealData?: Record<string, unknown>;
    financialData?: Record<string, unknown>;
    investorData?: unknown;
    executiveData?: unknown;
    newsData?: unknown;
  }>;
}> {
  const tz = new Date().getTimezoneOffset();
  const tzHours = Math.floor(Math.abs(tz) / 60);
  const tzMins = Math.abs(tz) % 60;
  const tzSign = tz <= 0 ? '-' : '+';
  const tzOffset = `${tzSign}${String(tzHours).padStart(2, '0')}:${String(tzMins).padStart(2, '0')}`;

  const body = args.companies.map((c) => ({
    type: c.type ?? 'PRIVATE_COMPANY',
    pbId: c.pbId,
    timeZoneOffset: tzOffset,
  }));

  const data = await pbFetch<
    Array<{ type: string; value: Record<string, unknown> }>
  >('/general-search/suggests', { method: 'POST', body });

  return {
    results: data.map((item) => ({
      type: item.type,
      pbId: (item.value as Record<string, unknown>).pbId as string,
      dealData: (item.value as Record<string, unknown>).dealData as
        | Record<string, unknown>
        | undefined,
      financialData: (item.value as Record<string, unknown>).financialData as
        | Record<string, unknown>
        | undefined,
      investorData: (item.value as Record<string, unknown>).investorData,
      executiveData: (item.value as Record<string, unknown>).executiveData,
      newsData: (item.value as Record<string, unknown>).newsData,
    })),
  };
}

// === Screener Operations ===

export async function createScreener(args: { type: string }): Promise<{
  searchId: string;
  criteriaId: string;
  url: string;
}> {
  // Map type to button aria-label
  const typeMap: Record<string, string> = {
    COMPANY: 'New Companies Screener',
    DEAL: 'New Deals Screener',
    INVESTOR: 'New Investors Screener',
    FUND: 'New Funds Screener',
    DEBT: 'New Debts Screener',
    LENDER: 'New Lenders Screener',
  };

  const ariaLabel = typeMap[args.type];
  if (!ariaLabel) {
    throw new Validation(
      `Invalid screener type: ${args.type}. Valid: ${Object.keys(typeMap).join(', ')}`,
    );
  }

  // Navigate to search-tools page
  window.location.href = 'https://my.pitchbook.com/search-tools';
  await new Promise<void>((resolve) => {
    const check = (): void => {
      if (
        window.location.pathname === '/search-tools' &&
        document.readyState === 'complete'
      ) {
        resolve();
      } else {
        setTimeout(check, 200);
      }
    };
    setTimeout(check, 1000);
  });

  // Wait for the button to appear in the DOM
  let btn: HTMLElement | null = null;
  for (let i = 0; i < 30; i++) {
    btn = document.querySelector(`button[aria-label="${ariaLabel}"]`);
    if (btn) break;
    await new Promise<void>((r) => setTimeout(r, 500));
  }

  if (!btn) {
    throw new ContractDrift(
      `Could not find "${ariaLabel}" button on search-tools page`,
    );
  }

  btn.click();

  // Wait for navigation to the criteria page
  let searchId = '';
  let criteriaId = '';
  for (let i = 0; i < 30; i++) {
    const url = window.location.href;
    const match = url.match(/search\/(s\d+)\/criteria\/(\d+)/);
    if (match) {
      searchId = match[1];
      criteriaId = match[2];
      break;
    }
    await new Promise<void>((r) => setTimeout(r, 500));
  }

  if (!searchId) {
    throw new UpstreamError(
      'Screener creation timed out — URL did not change to criteria page',
    );
  }

  return {
    searchId,
    criteriaId,
    url: window.location.href,
  };
}

export async function getScreener(args: { searchId: string }): Promise<{
  id: string;
  searchType: string;
  defaultName: string;
  activeTabId: string;
  tabs: Array<{ id: string; type: string; name: string; viewId?: string }>;
}> {
  const data = await pbFetch<{
    id: string;
    searchType: string;
    defaultName: string;
    activeTabId: string;
    tabs: Array<{
      id: string;
      type: string;
      name: string;
      viewId?: string;
      subTabs?: Array<{
        id: string;
        type: string;
        name: string;
        viewId?: string;
      }>;
    }>;
  }>(`/advanced-search-api/searches/${args.searchId}`);

  const flatTabs = data.tabs.flatMap((tab) => {
    const main = {
      id: tab.id,
      type: tab.type,
      name: tab.name,
      viewId: tab.viewId,
    };
    const subs = (tab.subTabs ?? []).map((s) => ({
      id: s.id,
      type: s.type,
      name: s.name,
      viewId: s.viewId,
    }));
    return [main, ...subs];
  });

  return {
    id: data.id,
    searchType: data.searchType,
    defaultName: data.defaultName,
    activeTabId: data.activeTabId,
    tabs: flatTabs,
  };
}

export async function getScreenerCriteria(args: {
  searchId: string;
}): Promise<Record<string, unknown>> {
  return pbFetch(
    `/advanced-search-api-bff/api/v1/search-criteria/${args.searchId}`,
  );
}

export async function updateScreenerCriteria(args: {
  searchId: string;
  criteria: Record<string, unknown>;
}): Promise<{ success: boolean; searchId: string }> {
  // PitchBook's criteria API is managed by isolated MFE iframes.
  // Direct API calls to update criteria return 500 errors.
  // Instead, navigate the user to the criteria page where they can apply filters.
  const criteriaUrl = window.location.href.match(/criteria\/(\d+)/)?.[1];
  const url = `https://my.pitchbook.com/as-criteria/COMPANY/COMPANY/search/${args.searchId}/criteria/${criteriaUrl ?? 'default'}`;
  window.location.href = url;
  throw new ContractDrift(
    `Criteria updates must be applied via the PitchBook UI. ` +
      `Navigated to: ${url}. ` +
      `After applying filters, call runScreener() and getScreenerResults() to fetch data.`,
  );
}

export async function runScreener(args: {
  searchId: string;
}): Promise<{ success: boolean; searchId: string }> {
  await pbFetch(
    `/advanced-search-api/searches/${args.searchId}/run?resetTrigger=API&resetActiveTab=false`,
    {
      method: 'POST',
    },
  );
  return { success: true, searchId: args.searchId };
}

export async function getScreenerCount(args: {
  searchId: string;
}): Promise<{ count: number }> {
  return pbFetch(`/advanced-search-api/searches/${args.searchId}/count`);
}

export async function getScreenerResults(args: {
  searchId: string;
  tabType?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  page: { page: number; pageSize: number };
  dataRows: Array<{
    entityId: number;
    pbId: string;
    disabled: boolean;
    followed: boolean;
    columnValues: Record<string, Array<Record<string, unknown>>>;
  }>;
}> {
  const tab = args.tabType ?? 'company';
  const page = args.page ?? 1;
  const pageSize = args.pageSize ?? 50;
  const dataSetId = `${args.searchId}.${tab}.data_set`;

  return pbFetch(
    `/advanced-search-api/tables/${dataSetId}/data?page=${page}&pageSize=${pageSize}&alertMode=false&recentUpdatesMode=false`,
    { method: 'POST' },
  );
}

export async function getScreenerColumns(args: {
  searchId: string;
  tabType?: string;
}): Promise<{
  columns: Array<{ id: string; name: string; type?: string }>;
}> {
  const tab = args.tabType ?? 'company';
  const dataSetId = `${args.searchId}.${tab}.data_set`;

  const data = await pbFetch<Array<Record<string, unknown>>>(
    `/advanced-search-api/tables/${dataSetId}/columns?alertMode=false&recentUpdatesMode=false`,
  );

  return {
    columns: data.map((col) => ({
      id: (col.columnId as string) ?? '',
      name: (col.label as string) ?? (col.alias as string) ?? '',
      type: col.columnType as string | undefined,
    })),
  };
}

// === Convenience Search Functions ===

async function screenerSearch(
  type: string,
  tabType: string,
  page: number,
  pageSize: number,
): Promise<{
  searchId: string;
  count: number;
  page: { page: number; pageSize: number };
  dataRows: Array<{
    entityId: number;
    pbId: string;
    disabled: boolean;
    followed: boolean;
    columnValues: Record<string, Array<Record<string, unknown>>>;
  }>;
}> {
  const screener = await createScreener({ type });

  await runScreener({ searchId: screener.searchId });

  const [countResult, results] = await Promise.all([
    getScreenerCount({ searchId: screener.searchId }),
    getScreenerResults({
      searchId: screener.searchId,
      tabType,
      page,
      pageSize,
    }),
  ]);

  return {
    searchId: screener.searchId,
    count: countResult.count,
    ...results,
  };
}

export async function searchCompanies(args: {
  page?: number;
  pageSize?: number;
}): Promise<{
  searchId: string;
  count: number;
  page: { page: number; pageSize: number };
  dataRows: Array<{
    entityId: number;
    pbId: string;
    disabled: boolean;
    followed: boolean;
    columnValues: Record<string, Array<Record<string, unknown>>>;
  }>;
}> {
  return screenerSearch(
    'COMPANY',
    'company',
    args.page ?? 1,
    args.pageSize ?? 50,
  );
}

export async function searchDeals(args: {
  page?: number;
  pageSize?: number;
}): Promise<{
  searchId: string;
  count: number;
  page: { page: number; pageSize: number };
  dataRows: Array<{
    entityId: number;
    pbId: string;
    disabled: boolean;
    followed: boolean;
    columnValues: Record<string, Array<Record<string, unknown>>>;
  }>;
}> {
  return screenerSearch('DEAL', 'deal', args.page ?? 1, args.pageSize ?? 50);
}

export async function searchInvestors(args: {
  page?: number;
  pageSize?: number;
}): Promise<{
  searchId: string;
  count: number;
  page: { page: number; pageSize: number };
  dataRows: Array<{
    entityId: number;
    pbId: string;
    disabled: boolean;
    followed: boolean;
    columnValues: Record<string, Array<Record<string, unknown>>>;
  }>;
}> {
  return screenerSearch(
    'INVESTOR',
    'investor',
    args.page ?? 1,
    args.pageSize ?? 50,
  );
}

export async function searchFunds(args: {
  page?: number;
  pageSize?: number;
}): Promise<{
  searchId: string;
  count: number;
  page: { page: number; pageSize: number };
  dataRows: Array<{
    entityId: number;
    pbId: string;
    disabled: boolean;
    followed: boolean;
    columnValues: Record<string, Array<Record<string, unknown>>>;
  }>;
}> {
  return screenerSearch('FUND', 'fund', args.page ?? 1, args.pageSize ?? 50);
}

// === Saved Searches ===

export async function getSavedSearches(args: {
  searchTypes?: string[];
}): Promise<{
  searches: Array<{
    id: string;
    name?: string;
    searchType: string;
  }>;
}> {
  const types = args.searchTypes ?? ['COMPANY'];
  const data = await pbFetch<
    Array<{ id: string; name?: string; searchType: string }>
  >('/advanced-search-api/saved-searches/find', {
    method: 'POST',
    body: { searchTypes: types },
  });
  return { searches: data };
}

// === Global Search ===

export async function globalSearch(args: {
  query: string;
  limit?: number;
  offset?: number;
}): Promise<{
  items: Array<{
    type: string;
    name?: string;
    pbId?: string;
    description?: string;
    location?: string;
    website?: string;
    industry?: string;
    verticals?: string[];
    financingStatus?: string;
    investorStatus?: string;
    yearFounded?: number;
    dryPowder?: number;
    investmentsTtm?: number;
    totalInvestments?: number;
  }>;
}> {
  const limit = args.limit ?? 15;
  const offset = args.offset ?? 0;
  const tz = new Date().getTimezoneOffset();
  const tzHours = Math.floor(Math.abs(tz) / 60);
  const tzMins = Math.abs(tz) % 60;
  const tzSign = tz <= 0 ? '-' : '+';
  const tzOffset = `${tzSign}${String(tzHours).padStart(2, '0')}:${String(tzMins).padStart(2, '0')}`;

  const data = await pbFetch<{
    items: Array<{ type: string; value: Record<string, unknown> }>;
  }>('/general-search/search/mixed', {
    method: 'POST',
    body: {
      savedConferenceSearchAllowed: false,
      transcriptSearchAllowed: true,
      conferencesSearchAllowed: true,
      searchRequest: { limit, offset, query: args.query },
      timeZoneOffset: tzOffset,
    },
  });

  return {
    items: data.items.map((item) => {
      const val = item.value as Record<string, unknown>;
      const profile = val.profileResult as Record<string, unknown> | undefined;
      const sparse = val.sparseData as Record<string, unknown> | undefined;
      return {
        type: item.type,
        name: profile?.name as string | undefined,
        pbId: profile?.id as string | undefined,
        description: profile?.description as string | undefined,
        location: profile?.location as string | undefined,
        website: val.website as string | undefined,
        industry: sparse?.primaryIndustry as string | undefined,
        verticals: sparse?.verticals as string[] | undefined,
        financingStatus: sparse?.financingStatus as string | undefined,
        investorStatus: sparse?.investorStatus as string | undefined,
        yearFounded: sparse?.yearFounded as number | undefined,
        dryPowder: sparse?.dryPowder as number | undefined,
        investmentsTtm: sparse?.investmentsTtm as number | undefined,
        totalInvestments: sparse?.totalInvestments as number | undefined,
      };
    }),
  };
}

// === Company Profile ===

export async function getCompanyProfile(args: { pbId: string }): Promise<{
  generalInfo: {
    officialName?: string;
    formerName?: string;
    website?: string;
    dateFounded?: string;
    description?: string;
    financingStatusNote?: string;
  };
  contactInfo: {
    primaryContact?: {
      name?: string;
      title?: string;
      phone?: string;
      email?: string;
    };
    primaryOffice?: {
      name?: string;
      phone?: string;
      email?: string;
      address?: string;
    };
    alternateOffices?: Array<Record<string, unknown>>;
  };
  industries: {
    keywords?: string[];
    verticals?: string[];
    industries?: string[];
    gecsIndustry?: string;
    gecsSector?: string;
  };
}> {
  const [generalData, contactData, industryData] = await Promise.all([
    pbFetch<Record<string, unknown>>(
      `/profile-platform-bff/profiles/${args.pbId}/company/general-info`,
      { headers: PROFILE_HEADERS },
    ),
    pbFetch<Record<string, unknown>>(
      `/profile-platform-bff/profiles/${args.pbId}/company/contact-info`,
      { headers: PROFILE_HEADERS },
    ),
    pbFetch<Record<string, unknown>>(
      `/profile-platform-bff/profiles/${args.pbId}/company/industries-verticals-and-keywords`,
      { headers: PROFILE_HEADERS },
    ),
  ]);

  const primaryContact = contactData.primaryContact as
    | Record<string, unknown>
    | undefined;
  const primaryOffice = contactData.primaryOffice as
    | Record<string, unknown>
    | undefined;

  return {
    generalInfo: {
      officialName: generalData.officialName as string | undefined,
      formerName: generalData.formerName as string | undefined,
      website: generalData.website as string | undefined,
      dateFounded: generalData.dateFounded as string | undefined,
      description: generalData.description as string | undefined,
      financingStatusNote: generalData.financingStatusNote as
        | string
        | undefined,
    },
    contactInfo: {
      primaryContact: primaryContact
        ? {
            name: primaryContact.name as string | undefined,
            title: primaryContact.title as string | undefined,
            phone: primaryContact.phone as string | undefined,
            email: primaryContact.email as string | undefined,
          }
        : undefined,
      primaryOffice: primaryOffice
        ? {
            name: primaryOffice.name as string | undefined,
            phone: primaryOffice.phone as string | undefined,
            email: primaryOffice.email as string | undefined,
            address: primaryOffice.address as string | undefined,
          }
        : undefined,
      alternateOffices: contactData.alternateOffices as
        | Array<Record<string, unknown>>
        | undefined,
    },
    industries: {
      keywords: industryData.keywords as string[] | undefined,
      verticals: industryData.verticals as string[] | undefined,
      industries: industryData.industries as string[] | undefined,
      gecsIndustry: industryData.gecsIndustry as string | undefined,
      gecsSector: industryData.gecsSector as string | undefined,
    },
  };
}

// === Company Deal History ===

export async function getCompanyDealHistory(args: { pbId: string }): Promise<{
  deals: Array<{
    id?: string;
    dealNumber?: string;
    status?: string;
    type?: string;
    categories?: string[];
    synopsis?: string;
    amount?: { currency?: string; amount?: number; asOfDate?: string };
    postValuation?: { currency?: string; amount?: number; asOfDate?: string };
    totalMoneyRaised?: number;
    dealDate?: string;
    investorCount?: number;
  }>;
}> {
  const data = await pbFetch<{ items: Array<Record<string, unknown>> }>(
    `/deal-debt-experience-bff/companies/${args.pbId}/deal-history`,
    { headers: PROFILE_HEADERS },
  );

  return {
    deals: data.items.map((item) => {
      const amount = item.amount as Record<string, unknown> | undefined;
      const postValuation = item.postValuation as
        | Record<string, unknown>
        | undefined;
      return {
        id: item.id as string | undefined,
        dealNumber: item.dealNumber as string | undefined,
        status: item.status as string | undefined,
        type: item.type as string | undefined,
        categories: item.categories as string[] | undefined,
        synopsis: item.synopsis as string | undefined,
        amount: amount
          ? {
              currency: amount.currency as string | undefined,
              amount: amount.amount as number | undefined,
              asOfDate: amount.asOfDate as string | undefined,
            }
          : undefined,
        postValuation: postValuation
          ? {
              currency: postValuation.currency as string | undefined,
              amount: postValuation.amount as number | undefined,
              asOfDate: postValuation.asOfDate as string | undefined,
            }
          : undefined,
        totalMoneyRaised: item.totalMoneyRaised as number | undefined,
        dealDate: item.dealDate as string | undefined,
        investorCount: item.investorCount as number | undefined,
      };
    }),
  };
}

// === Company Cap Table ===

export async function getCompanyCapTable(args: { pbId: string }): Promise<{
  series: Array<{
    seriesId?: string;
    seriesName?: string;
    sharesAuthorized?: number;
    sharesOutstanding?: number;
    percentOwned?: number;
    parValue?: number;
    originalIssuePrice?: number;
    liquidation?: number;
    conversionPrice?: number;
  }>;
}> {
  const data = await pbFetch<{ items: Array<Record<string, unknown>> }>(
    `/deal-debt-experience-bff/companies/${args.pbId}/deal-history/cap-table`,
    { headers: PROFILE_HEADERS },
  );

  return {
    series: data.items.map((item) => ({
      seriesId: item.seriesId as string | undefined,
      seriesName: item.seriesName as string | undefined,
      sharesAuthorized: item.sharesAuthorized as number | undefined,
      sharesOutstanding: item.sharesOutstanding as number | undefined,
      percentOwned: item.percentOwned as number | undefined,
      parValue: item.parValue as number | undefined,
      originalIssuePrice: item.originalIssuePrice as number | undefined,
      liquidation: item.liquidation as number | undefined,
      conversionPrice: item.conversionPrice as number | undefined,
    })),
  };
}

// === Industry Tree ===

export async function getIndustryTree(): Promise<{
  industries: Array<{
    code?: string;
    name?: string;
    type?: string;
    explanation?: string;
    example?: string;
    children?: Array<Record<string, unknown>>;
  }>;
}> {
  // Response shape: { INDUSTRY: [ { id, children: [ { id, children: [ { id, attributes: { description, type, explanation, example } } ] } ] } ] }
  const data = await pbFetch<Record<string, Array<Record<string, unknown>>>>(
    '/v2/trees?treeNames=INDUSTRY',
  );

  function flattenIndustryNodes(
    nodes: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];
    for (const node of nodes) {
      const attrs = node.attributes as Record<string, unknown> | undefined;
      if (attrs?.description) {
        result.push({
          code: node.id,
          name: attrs.description,
          type: attrs.type,
          explanation: attrs.explanation,
          example: attrs.example,
        });
      }
      const children = node.children as
        | Array<Record<string, unknown>>
        | undefined;
      if (children?.length) {
        result.push(...flattenIndustryNodes(children));
      }
    }
    return result;
  }

  const rawNodes = data.INDUSTRY ?? [];
  return {
    industries: flattenIndustryNodes(rawNodes),
  };
}

// === Filter Trees ===

export async function getFilterTrees(args: { treeName: string }): Promise<{
  nodes: Array<{
    id?: string;
    caption?: string;
    description?: string;
    children?: Array<Record<string, unknown>>;
  }>;
}> {
  // Response is a direct array: [ { nodeDiscriminator, id, caption, description, children: [...] } ]
  const data = await pbFetch<Array<Record<string, unknown>>>(
    `/advanced-search-api-bff/api/v2/trees/${encodeURIComponent(args.treeName)}`,
  );

  return {
    nodes: data.map((node) => ({
      id: node.id as string | undefined,
      caption: node.caption as string | undefined,
      description: node.description as string | undefined,
      children: node.children as Array<Record<string, unknown>> | undefined,
    })),
  };
}

// === News Search ===

export async function searchNews(args: {
  page?: number;
  pageSize?: number;
}): Promise<{
  items: Array<Record<string, unknown>>;
}> {
  const page = args.page ?? 1;
  const pageSize = args.pageSize ?? 10;

  const data = await pbFetch<{
    items?: Array<Record<string, unknown>>;
    results?: Array<Record<string, unknown>>;
  }>('/news-bff/api/v1/news/search/dashboard', {
    method: 'POST',
    body: {
      tabCriteria: { newsProviders: ['LCD', 'THIRD_PARTY'] },
      page: { page, pageSize },
    },
  });

  return { items: data.items ?? data.results ?? [] };
}
