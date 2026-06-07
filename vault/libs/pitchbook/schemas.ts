import { z } from 'zod';

export const libraryDescription =
  'PitchBook private markets data — companies, deals, investors, funds via screener APIs';

export const libraryIcon = '/icons/libs/pitchbook.png';
export const loginUrl = 'https://my.pitchbook.com';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://my.pitchbook.com\`
2. Call \`getContext()\` to verify login and get user/account info
3. Use \`globalSearch()\` for quick cross-entity search (companies, investors, news)
4. Use screener functions to search companies, deals, investors, and funds with filters
5. Use \`getCompanyProfile()\`, \`getCompanyDealHistory()\`, \`getCompanyCapTable()\` for detailed company data
6. Use \`getCompanySuggests()\` to get deal and financial data for specific companies

## Screener-Based Search

PitchBook uses a screener (saved search) system:
1. Call \`createScreener()\` or \`searchCompanies()\` to create a screener and get initial results
2. To apply filters: navigate the user to the screener criteria page in PitchBook UI
3. After filters are applied, call \`runScreener()\` then \`getScreenerResults()\` for filtered data
4. Call \`getScreenerCount()\` to check how many results match

Criteria filtering must be done through the PitchBook UI — the criteria API is managed by isolated micro-frontends.

## Pagination

Results use page-based pagination: \`page\` (1-indexed) and \`pageSize\` (max 250).

## PitchBook IDs

Companies, deals, investors, and funds have PitchBook IDs (pbId) in format like \`896863-42\`. Use these IDs with profile, deal history, cap table, and suggest functions.

## Reference Data

Use \`getIndustryTree()\` to explore the full industry taxonomy. Use \`getFilterTrees()\` to fetch filter option trees (e.g. EMERGING_SPACES, EXIT_TYPE) for building screener criteria.
`;

// === Types ===

export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type GetRecentSearchesInput = z.infer<
  typeof getRecentSearchesSchema.input
>;
export type GetRecentSearchesOutput = z.infer<
  typeof getRecentSearchesSchema.output
>;
export type GetCompanyQuickStatsInput = z.infer<
  typeof getCompanyQuickStatsSchema.input
>;
export type GetCompanyQuickStatsOutput = z.infer<
  typeof getCompanyQuickStatsSchema.output
>;
export type GetCompanySuggestsInput = z.infer<
  typeof getCompanySuggestsSchema.input
>;
export type GetCompanySuggestsOutput = z.infer<
  typeof getCompanySuggestsSchema.output
>;
export type CreateScreenerInput = z.infer<typeof createScreenerSchema.input>;
export type CreateScreenerOutput = z.infer<typeof createScreenerSchema.output>;
export type GetScreenerInput = z.infer<typeof getScreenerSchema.input>;
export type GetScreenerOutput = z.infer<typeof getScreenerSchema.output>;
export type GetScreenerCriteriaInput = z.infer<
  typeof getScreenerCriteriaSchema.input
>;
export type GetScreenerCriteriaOutput = z.infer<
  typeof getScreenerCriteriaSchema.output
>;
export type UpdateScreenerCriteriaInput = z.infer<
  typeof updateScreenerCriteriaSchema.input
>;
export type UpdateScreenerCriteriaOutput = z.infer<
  typeof updateScreenerCriteriaSchema.output
>;
export type RunScreenerInput = z.infer<typeof runScreenerSchema.input>;
export type RunScreenerOutput = z.infer<typeof runScreenerSchema.output>;
export type GetScreenerCountInput = z.infer<
  typeof getScreenerCountSchema.input
>;
export type GetScreenerCountOutput = z.infer<
  typeof getScreenerCountSchema.output
>;
export type GetScreenerResultsInput = z.infer<
  typeof getScreenerResultsSchema.input
>;
export type GetScreenerResultsOutput = z.infer<
  typeof getScreenerResultsSchema.output
>;
export type GetScreenerColumnsInput = z.infer<
  typeof getScreenerColumnsSchema.input
>;
export type GetScreenerColumnsOutput = z.infer<
  typeof getScreenerColumnsSchema.output
>;
export type SearchCompaniesInput = z.infer<typeof searchCompaniesSchema.input>;
export type SearchCompaniesOutput = z.infer<
  typeof searchCompaniesSchema.output
>;
export type SearchDealsInput = z.infer<typeof searchDealsSchema.input>;
export type SearchDealsOutput = z.infer<typeof searchDealsSchema.output>;
export type SearchInvestorsInput = z.infer<typeof searchInvestorsSchema.input>;
export type SearchInvestorsOutput = z.infer<
  typeof searchInvestorsSchema.output
>;
export type SearchFundsInput = z.infer<typeof searchFundsSchema.input>;
export type SearchFundsOutput = z.infer<typeof searchFundsSchema.output>;

/** Screener search result shape shared across search functions */
export type ScreenerSearchResult = SearchCompaniesOutput;
export type GetSavedSearchesInput = z.infer<
  typeof getSavedSearchesSchema.input
>;
export type GetSavedSearchesOutput = z.infer<
  typeof getSavedSearchesSchema.output
>;
export type GlobalSearchInput = z.infer<typeof globalSearchSchema.input>;
export type GlobalSearchOutput = z.infer<typeof globalSearchSchema.output>;
export type GetCompanyProfileInput = z.infer<
  typeof getCompanyProfileSchema.input
>;
export type GetCompanyProfileOutput = z.infer<
  typeof getCompanyProfileSchema.output
>;
export type GetCompanyDealHistoryInput = z.infer<
  typeof getCompanyDealHistorySchema.input
>;
export type GetCompanyDealHistoryOutput = z.infer<
  typeof getCompanyDealHistorySchema.output
>;
export type GetCompanyCapTableInput = z.infer<
  typeof getCompanyCapTableSchema.input
>;
export type GetCompanyCapTableOutput = z.infer<
  typeof getCompanyCapTableSchema.output
>;
export type GetIndustryTreeInput = z.infer<typeof getIndustryTreeSchema.input>;
export type GetIndustryTreeOutput = z.infer<
  typeof getIndustryTreeSchema.output
>;
export type GetFilterTreesInput = z.infer<typeof getFilterTreesSchema.input>;
export type GetFilterTreesOutput = z.infer<typeof getFilterTreesSchema.output>;
export type SearchNewsInput = z.infer<typeof searchNewsSchema.input>;
export type SearchNewsOutput = z.infer<typeof searchNewsSchema.output>;

// === Schemas ===

const columnValueSchema = z.object({
  columnValueType: z
    .string()
    .describe('Type of value: STRING, DATE, ENTITY, NUMBER, etc.'),
  accessStatus: z.string().optional().describe('OK if accessible'),
  value: z.any().optional().describe('The value (string, number, etc.)'),
  name: z.string().optional().describe('Entity name (for ENTITY type)'),
  pbId: z.string().optional().describe('PitchBook ID (for ENTITY type)'),
  expected: z
    .boolean()
    .optional()
    .describe('Whether the date is expected/estimated'),
  asOfdate: z.string().optional().describe('As-of date for the value'),
});

const dataRowSchema = z.object({
  entityId: z.number().describe('Internal entity ID'),
  pbId: z.string().describe('PitchBook ID (e.g. "896863-42")'),
  disabled: z.boolean(),
  followed: z.boolean(),
  columnValues: z
    .record(z.string(), z.array(columnValueSchema))
    .describe(
      'Column values keyed by column name. Common columns: companyName, description, hqLocation, lastFinancingDate, financingStatusNote, activeInvestors, dealSize, dealDate, dealType',
    ),
});

export const getContextSchema = {
  name: 'getContext',
  description:
    'Get current user and account context from PitchBook. Call FIRST to verify login.',
  notes: '',
  input: z.object({}),
  output: z.object({
    userId: z.number().describe('PitchBook user ID'),
    login: z.string().describe('User email/login'),
    firstName: z.string(),
    lastName: z.string(),
    accountName: z.string().describe('Organization/account name'),
    accountId: z.number().describe('Primary account ID'),
    maxResultsPageSize: z
      .number()
      .describe('Max page size for search results (typically 250)'),
  }),
};

export const getRecentSearchesSchema = {
  name: 'getRecentSearches',
  description:
    'Get recently viewed companies, deals, investors, and other entities in PitchBook.',
  notes: '',
  input: z.object({
    limit: z
      .number()
      .optional()
      .default(15)
      .describe('Max items to return (default 15)'),
  }),
  output: z.object({
    items: z.array(
      z.object({
        type: z
          .string()
          .describe('Entity type: COMPANY, DEAL, INVESTOR, FUND, etc.'),
        profileResult: z
          .object({
            id: z.string().describe('PitchBook ID'),
            name: z.string(),
            description: z.string().optional(),
            typeDescription: z
              .string()
              .optional()
              .describe('e.g. "Private Company"'),
            location: z.string().optional(),
          })
          .optional(),
        sparseData: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            'Additional data: ownershipStatus, businessStatus, financingStatus, primaryIndustry, verticals',
          ),
        website: z.string().optional(),
      }),
    ),
  }),
};

export const getCompanyQuickStatsSchema = {
  name: 'getCompanyQuickStats',
  description:
    'Get quick stats (last deal amount) for one or more companies by PitchBook ID.',
  notes: '',
  input: z.object({
    items: z
      .array(
        z.object({
          id: z.string().describe('PitchBook ID (e.g. "896863-42")'),
          type: z.literal('PROFILE').default('PROFILE'),
          subType: z
            .enum(['PRIVATE_COMPANY', 'PUBLIC_COMPANY'])
            .default('PRIVATE_COMPANY')
            .describe('Company type'),
        }),
      )
      .describe('Companies to get quick stats for'),
  }),
  output: z.object({
    quickStats: z.array(
      z.object({
        id: z.string(),
        subType: z.string(),
        quickStats: z
          .record(z.string(), z.any())
          .describe(
            'Stats like LAST_DEAL_AMOUNT with currency, amount, asOfDate',
          ),
      }),
    ),
  }),
};

export const getCompanySuggestsSchema = {
  name: 'getCompanySuggests',
  description:
    'Get detailed suggestion data for companies — includes deal data, financial data, investor data, and executive data.',
  notes: '',
  input: z.object({
    companies: z
      .array(
        z.object({
          pbId: z.string().describe('PitchBook ID'),
          type: z
            .enum(['PRIVATE_COMPANY', 'PUBLIC_COMPANY'])
            .default('PRIVATE_COMPANY'),
        }),
      )
      .describe('Companies to get suggestion data for'),
  }),
  output: z.object({
    results: z.array(
      z.object({
        type: z.string(),
        pbId: z.string(),
        dealData: z
          .object({
            id: z.string().optional(),
            amount: z
              .object({
                currency: z.string(),
                amount: z.number(),
                nativeCurrency: z.string().optional(),
                nativeAmount: z.number().optional(),
              })
              .optional(),
            type: z
              .string()
              .optional()
              .describe('Deal type: Seed Round, Series A, etc.'),
            status: z.string().optional().describe('Upcoming, Completed, etc.'),
            asOfDate: z.string().optional(),
          })
          .optional(),
        financialData: z
          .object({
            latestTotalRevenue: z
              .object({
                currency: z.string(),
                amount: z.number(),
              })
              .optional(),
            latestEbitda: z
              .object({
                currency: z.string(),
                amount: z.number(),
              })
              .optional(),
            fiscalYear: z.number().optional(),
            period: z.string().optional(),
          })
          .optional(),
        investorData: z.any().optional(),
        executiveData: z.any().optional(),
        newsData: z.any().optional(),
      }),
    ),
  }),
};

export const createScreenerSchema = {
  name: 'createScreener',
  description:
    'Create a new PitchBook screener (saved search). Returns a search ID and criteria ID for filtering and running.',
  notes:
    'Creates a screener by navigating to the search-tools page and clicking the appropriate button. This modifies the browser URL.',
  input: z.object({
    type: z
      .enum(['COMPANY', 'DEAL', 'INVESTOR', 'FUND', 'DEBT', 'LENDER'])
      .describe('Type of screener to create'),
  }),
  output: z.object({
    searchId: z.string().describe('Search ID (e.g. "s641074662")'),
    criteriaId: z.string().describe('Criteria ID'),
    url: z.string().describe('Full URL of the screener'),
  }),
};

export const getScreenerSchema = {
  name: 'getScreener',
  description:
    'Get details of an existing screener including its tabs, type, and view configuration.',
  notes: '',
  input: z.object({
    searchId: z.string().describe('Search ID (e.g. "s641074662")'),
  }),
  output: z.object({
    id: z.string(),
    searchType: z.string(),
    defaultName: z.string(),
    activeTabId: z.string(),
    tabs: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        name: z.string(),
        viewId: z.string().optional(),
      }),
    ),
  }),
};

export const getScreenerCriteriaSchema = {
  name: 'getScreenerCriteria',
  description:
    'Get the current filter criteria for a screener. Returns the full criteria object showing all available filter fields and their current values.',
  notes: '',
  input: z.object({
    searchId: z.string().describe('Search ID'),
  }),
  output: z
    .object({
      criteriaDiscriminator: z
        .string()
        .describe('Type: COMPANY, DEAL, INVESTOR, FUND'),
      company: z
        .record(z.string(), z.any())
        .optional()
        .describe(
          'Company filters. Key fields: names (company name search), financingStatus, industryQueryCriteria, location, dateFounded, totalRaised, ownershipStatus, businessStatus, companyScoring',
        ),
      deal: z.record(z.string(), z.any()).optional().describe('Deal filters'),
      investor: z
        .record(z.string(), z.any())
        .optional()
        .describe('Investor filters'),
      exit: z.record(z.string(), z.any()).optional().describe('Exit filters'),
    })
    .passthrough(),
};

export const updateScreenerCriteriaSchema = {
  name: 'updateScreenerCriteria',
  description:
    'Navigate to the screener criteria page so filters can be applied via the PitchBook UI. Direct API updates are not supported due to MFE isolation.',
  notes:
    'PitchBook criteria updates happen inside isolated micro-frontend iframes. After the user applies filters in the UI, call runScreener() and getScreenerResults() to fetch filtered data.',
  input: z.object({
    searchId: z.string().describe('Search ID'),
    criteria: z
      .record(z.string(), z.any())
      .describe('Criteria to apply (used for navigation context only)'),
  }),
  output: z.object({
    success: z.boolean(),
    searchId: z.string(),
  }),
};

export const runScreenerSchema = {
  name: 'runScreener',
  description:
    'Execute a screener search with its current criteria. Must be called after creating or updating criteria before fetching results.',
  notes: '',
  input: z.object({
    searchId: z.string().describe('Search ID'),
  }),
  output: z.object({
    success: z.boolean(),
    searchId: z.string(),
  }),
};

export const getScreenerCountSchema = {
  name: 'getScreenerCount',
  description: 'Get the total number of results for a screener.',
  notes: '',
  input: z.object({
    searchId: z.string().describe('Search ID'),
  }),
  output: z.object({
    count: z.number().describe('Total matching results'),
  }),
};

export const getScreenerResultsSchema = {
  name: 'getScreenerResults',
  description:
    'Get paginated results from a screener. Returns rows of data with column values.',
  notes:
    'Call runScreener() first if criteria were updated. The dataSetId is derived from searchId + tab type.',
  input: z.object({
    searchId: z.string().describe('Search ID'),
    tabType: z
      .enum(['company', 'deal', 'investor', 'fund'])
      .default('company')
      .describe('Which tab/entity type to get results for'),
    page: z.number().optional().default(1).describe('Page number (1-indexed)'),
    pageSize: z
      .number()
      .optional()
      .default(50)
      .describe('Results per page (max 250)'),
  }),
  output: z.object({
    page: z.object({
      page: z.number(),
      pageSize: z.number(),
    }),
    dataRows: z.array(dataRowSchema),
  }),
};

export const getScreenerColumnsSchema = {
  name: 'getScreenerColumns',
  description:
    'Get available columns for a screener result table. Shows what data fields can be displayed.',
  notes: '',
  input: z.object({
    searchId: z.string().describe('Search ID'),
    tabType: z.enum(['company', 'deal', 'investor', 'fund']).default('company'),
  }),
  output: z.object({
    columns: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string().optional(),
      }),
    ),
  }),
};

export const searchCompaniesSchema = {
  name: 'searchCompanies',
  description:
    'Create a new company screener, run it, and return the first page of results. Returns all companies with no filters — use getScreenerCriteria to see filter options, then apply via the PitchBook UI.',
  notes:
    'Creates a temporary screener. To apply filters, navigate to the criteria page URL and use the PitchBook UI, then call getScreenerResults with the searchId.',
  input: z.object({
    page: z.number().optional().default(1),
    pageSize: z.number().optional().default(50),
  }),
  output: z.object({
    searchId: z.string(),
    count: z.number(),
    page: z.object({
      page: z.number(),
      pageSize: z.number(),
    }),
    dataRows: z.array(dataRowSchema),
  }),
};

export const searchDealsSchema = {
  name: 'searchDeals',
  description:
    'Create a new deal screener, run it, and return the first page of results.',
  notes: '',
  input: z.object({
    page: z.number().optional().default(1),
    pageSize: z.number().optional().default(50),
  }),
  output: z.object({
    searchId: z.string(),
    count: z.number(),
    page: z.object({ page: z.number(), pageSize: z.number() }),
    dataRows: z.array(dataRowSchema),
  }),
};

export const searchInvestorsSchema = {
  name: 'searchInvestors',
  description:
    'Create a new investor screener, run it, and return the first page of results.',
  notes: '',
  input: z.object({
    page: z.number().optional().default(1),
    pageSize: z.number().optional().default(50),
  }),
  output: z.object({
    searchId: z.string(),
    count: z.number(),
    page: z.object({ page: z.number(), pageSize: z.number() }),
    dataRows: z.array(dataRowSchema),
  }),
};

export const searchFundsSchema = {
  name: 'searchFunds',
  description:
    'Create a new fund screener, run it, and return the first page of results.',
  notes: '',
  input: z.object({
    page: z.number().optional().default(1),
    pageSize: z.number().optional().default(50),
  }),
  output: z.object({
    searchId: z.string(),
    count: z.number(),
    page: z.object({ page: z.number(), pageSize: z.number() }),
    dataRows: z.array(dataRowSchema),
  }),
};

export const getSavedSearchesSchema = {
  name: 'getSavedSearches',
  description:
    'List saved searches (screeners) for the current user, filtered by type.',
  notes: '',
  input: z.object({
    searchTypes: z
      .array(z.enum(['COMPANY', 'DEAL', 'INVESTOR', 'FUND', 'MARKET_MAP']))
      .optional()
      .default(['COMPANY'])
      .describe('Types of saved searches to list'),
  }),
  output: z.object({
    searches: z.array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        searchType: z.string(),
      }),
    ),
  }),
};

export const globalSearchSchema = {
  name: 'globalSearch',
  description:
    'Search across companies, investors, news, and conference events by keyword.',
  notes: '',
  input: z.object({
    query: z.string().describe('Search query text'),
    limit: z
      .number()
      .optional()
      .default(15)
      .describe('Max results to return (default 15)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Offset for pagination (default 0)'),
  }),
  output: z.object({
    items: z.array(
      z.object({
        type: z
          .string()
          .describe(
            'Entity type: COMPANY, INVESTOR, THIRD_PARTY_NEWS, CONFERENCE_EVENT',
          ),
        name: z.string().optional().describe('Entity name'),
        pbId: z.string().optional().describe('PitchBook ID'),
        description: z.string().optional(),
        location: z.string().optional(),
        website: z.string().optional(),
        industry: z
          .string()
          .optional()
          .describe('Primary industry (companies)'),
        verticals: z
          .array(z.string())
          .optional()
          .describe('Industry verticals (companies)'),
        financingStatus: z
          .string()
          .optional()
          .describe('Financing status (companies)'),
        investorStatus: z
          .string()
          .optional()
          .describe('Investor status (investors)'),
        yearFounded: z.number().optional().describe('Year founded (investors)'),
        dryPowder: z
          .number()
          .optional()
          .describe('Dry powder amount (investors)'),
        investmentsTtm: z
          .number()
          .optional()
          .describe('Investments trailing twelve months (investors)'),
        totalInvestments: z
          .number()
          .optional()
          .describe('Total investments count (investors)'),
      }),
    ),
  }),
};

export const getCompanyProfileSchema = {
  name: 'getCompanyProfile',
  description:
    'Get detailed profile for a company by PitchBook ID — combines general info, contact info, and industry/verticals data.',
  notes: '',
  input: z.object({
    pbId: z.string().describe('PitchBook ID (e.g. "896863-42")'),
  }),
  output: z.object({
    generalInfo: z.object({
      officialName: z.string().optional(),
      formerName: z.string().optional(),
      website: z.string().optional(),
      dateFounded: z.string().optional(),
      description: z.string().optional(),
      financingStatusNote: z.string().optional(),
    }),
    contactInfo: z.object({
      primaryContact: z
        .object({
          name: z.string().optional(),
          title: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().optional(),
        })
        .optional(),
      primaryOffice: z
        .object({
          name: z.string().optional(),
          phone: z.string().optional(),
          email: z.string().optional(),
          address: z.string().optional(),
        })
        .optional(),
      alternateOffices: z.array(z.record(z.string(), z.any())).optional(),
    }),
    industries: z.object({
      keywords: z.array(z.string()).optional(),
      verticals: z.array(z.string()).optional(),
      industries: z.array(z.string()).optional(),
      gecsIndustry: z.string().optional(),
      gecsSector: z.string().optional(),
    }),
  }),
};

export const getCompanyDealHistorySchema = {
  name: 'getCompanyDealHistory',
  description: 'Get the full deal history for a company by PitchBook ID.',
  notes: '',
  input: z.object({
    pbId: z.string().describe('PitchBook ID (e.g. "896863-42")'),
  }),
  output: z.object({
    deals: z.array(
      z.object({
        id: z.string().optional(),
        dealNumber: z.string().optional(),
        status: z
          .string()
          .optional()
          .describe('Deal status: Completed, Upcoming, etc.'),
        type: z
          .string()
          .optional()
          .describe('Deal type: Seed Round, Series A, etc.'),
        categories: z.array(z.string()).optional(),
        synopsis: z.string().optional(),
        amount: z
          .object({
            currency: z.string().optional(),
            amount: z.number().optional(),
            asOfDate: z.string().optional(),
          })
          .optional(),
        postValuation: z
          .object({
            currency: z.string().optional(),
            amount: z.number().optional(),
            asOfDate: z.string().optional(),
          })
          .optional(),
        totalMoneyRaised: z.number().optional(),
        dealDate: z.string().optional(),
        investorCount: z.number().optional(),
      }),
    ),
  }),
};

export const getCompanyCapTableSchema = {
  name: 'getCompanyCapTable',
  description:
    'Get the cap table (capitalization table) for a company by PitchBook ID.',
  notes: '',
  input: z.object({
    pbId: z.string().describe('PitchBook ID (e.g. "896863-42")'),
  }),
  output: z.object({
    series: z.array(
      z.object({
        seriesId: z.string().optional(),
        seriesName: z.string().optional(),
        sharesAuthorized: z.number().optional(),
        sharesOutstanding: z.number().optional(),
        percentOwned: z.number().optional(),
        parValue: z.number().optional(),
        originalIssuePrice: z.number().optional(),
        liquidation: z.number().optional(),
        conversionPrice: z.number().optional(),
      }),
    ),
  }),
};

export const getIndustryTreeSchema = {
  name: 'getIndustryTree',
  description:
    'Get the full hierarchical industry taxonomy used by PitchBook — codes, descriptions, examples, and children.',
  notes: '',
  input: z.object({}),
  output: z.object({
    industries: z.array(
      z.object({
        code: z.string().optional().describe('Industry code'),
        name: z.string().optional().describe('Industry name'),
        type: z.string().optional().describe('Node type'),
        explanation: z
          .string()
          .optional()
          .describe('Explanation of the industry'),
        example: z
          .string()
          .optional()
          .describe('Example companies or use cases'),
        children: z
          .array(z.record(z.string(), z.any()))
          .optional()
          .describe('Sub-industries'),
      }),
    ),
  }),
};

export const getFilterTreesSchema = {
  name: 'getFilterTrees',
  description:
    'Get a filter option tree by name — returns hierarchical nodes used in advanced screener criteria.',
  notes: '',
  input: z.object({
    treeName: z
      .enum([
        'EMERGING_SPACES',
        'EXIT_TYPE',
        'CLINICAL_TRIALS_TYPE',
        'ADDITIONAL_DEBT_CHARACTERISTIC',
      ])
      .describe('Name of the filter tree to fetch'),
  }),
  output: z.object({
    nodes: z.array(
      z.object({
        id: z.string().optional(),
        caption: z.string().optional().describe('Display label for the node'),
        description: z.string().optional(),
        children: z.array(z.record(z.string(), z.any())).optional(),
      }),
    ),
  }),
};

export const searchNewsSchema = {
  name: 'searchNews',
  description:
    'Search PitchBook news items from LCD and third-party providers.',
  notes: '',
  input: z.object({
    page: z
      .number()
      .optional()
      .default(1)
      .describe('Page number (1-indexed, default 1)'),
    pageSize: z
      .number()
      .optional()
      .default(10)
      .describe('Results per page (default 10)'),
  }),
  output: z.object({
    items: z.array(
      z
        .record(z.string(), z.any())
        .describe(
          'News item. Common properties: id, title, publishedDate, summary, url, newsProvider, relatedEntities',
        ),
    ),
  }),
};

export const allSchemas = [
  getContextSchema,
  getRecentSearchesSchema,
  getCompanyQuickStatsSchema,
  getCompanySuggestsSchema,
  createScreenerSchema,
  getScreenerSchema,
  getScreenerCriteriaSchema,
  updateScreenerCriteriaSchema,
  runScreenerSchema,
  getScreenerCountSchema,
  getScreenerResultsSchema,
  getScreenerColumnsSchema,
  searchCompaniesSchema,
  searchDealsSchema,
  searchInvestorsSchema,
  searchFundsSchema,
  getSavedSearchesSchema,
  globalSearchSchema,
  getCompanyProfileSchema,
  getCompanyDealHistorySchema,
  getCompanyCapTableSchema,
  getIndustryTreeSchema,
  getFilterTreesSchema,
  searchNewsSchema,
];
