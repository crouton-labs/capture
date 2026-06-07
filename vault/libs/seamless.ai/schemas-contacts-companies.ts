import { z } from 'zod';

// ============================================================================
// Shared types
// ============================================================================

const SavedContactSchema = z.object({
  id: z.string().describe('Numeric contact ID (e.g., "5788427514")'),
  companyId: z.string().describe('Associated company ID'),
  createdAt: z.string().describe('ISO timestamp when contact was saved'),
  updatedAt: z.string().describe('ISO timestamp of last update'),
  firstName: z.string().describe('First name'),
  middleName: z.string().describe('Middle name'),
  lastName: z.string().describe('Last name'),
  fullName: z.string().describe('Full name'),
  email: z.string().describe('Primary work email'),
  personalEmail: z.string().describe('Personal email (may be empty)'),
  contactPhone1: z.string().describe('Primary direct phone'),
  companyPhone1: z.string().describe('Primary company phone'),
  title: z.string().describe('Job title'),
  department: z.string().describe('Department (e.g., IT, Sales, Marketing)'),
  seniority: z
    .string()
    .describe('Seniority level (e.g., Director, VP, Manager)'),
  company: z.string().describe('Company name'),
  companyDomain: z.string().describe('Company website domain'),
  companyIndustry: z.string().describe('Primary industry'),
  companyIndustries: z.array(z.string()).describe('All industries'),
  companyStaffCount: z.number().describe('Company employee count'),
  companyStaffCountRange: z.string().describe('Employee count range label'),
  companyRevenueRange: z.string().describe('Revenue range label'),
  companyAnnualRevenue: z.string().describe('Annual revenue numeric string'),
  companyFounded: z.string().describe('Year company was founded'),
  companyType: z.string().describe('Company type (e.g., Private, Public)'),
  linkedInUrl: z.string().describe('Contact LinkedIn profile URL'),
  companyLinkedInUrl: z.string().describe('Company LinkedIn profile URL'),
  contactLocation: z
    .object({
      city: z.string().describe('City'),
      state: z.string().describe('State/province'),
      country: z.string().describe('Country'),
      fullString: z.string().describe('Full location string'),
    })
    .describe('Contact location'),
  companyLocation: z
    .object({
      street1: z.string().describe('Street address'),
      city: z.string().describe('City'),
      state: z.string().describe('State/province'),
      country: z.string().describe('Country'),
    })
    .describe('Company headquarters location'),
});

export type SavedContact = z.infer<typeof SavedContactSchema>;

const CompanySearchResultSchema = z.object({
  id: z.string().describe('Company search result UUID'),
  goldCompanyId: z
    .string()
    .describe('Gold company ID (same as id for search results)'),
  name: z.string().describe('Company name'),
  domain: z.string().describe('Company website domain'),
  description: z.string().describe('Company description'),
  industries: z.array(z.string()).describe('Industry list'),
  sicCode: z.string().describe('SIC industry code'),
  employeeCount: z.string().describe('Employee count as string'),
  employeeCountNmlzd: z
    .number()
    .describe('Normalized employee count as number'),
  staffCountRange: z
    .string()
    .describe('Employee count range label (e.g., "10,001+ employees")'),
  annualRevenue: z.number().describe('Annual revenue number'),
  revenueRange: z.string().describe('Revenue range label (e.g., "$1B+")'),
  foundedOn: z.string().describe('Year company was founded'),
  fundingTotal: z.string().nullable().describe('Total funding amount or null'),
  latestFundingDate: z
    .string()
    .nullable()
    .describe('Latest funding round date (YYYY-MM-DD HH:mm:ss format) or null'),
  latestFundingClassifications: z
    .array(z.string())
    .nullable()
    .describe('Latest funding round types or null'),
  numContacts: z
    .string()
    .describe('Number of contacts available for this company'),
  technologies: z
    .array(z.string())
    .describe('Technology stack (first few entries)'),
  technologiesCount: z
    .number()
    .optional()
    .describe('Total count of technologies'),
  linkedInUrl: z.string().describe('LinkedIn company page URL'),
  location: z
    .object({
      street1: z.string().describe('Street address'),
      city: z.string().describe('City'),
      state: z.string().describe('State/province'),
      country: z.string().describe('Country'),
      postCode: z.string().describe('Postal code'),
    })
    .describe('Company headquarters location'),
});

export type CompanySearchResult = z.infer<typeof CompanySearchResultSchema>;

const SavedCompanySchema = z.object({
  id: z.string().describe('Saved company ID'),
  name: z.string().describe('Company name'),
  domain: z.string().describe('Company website domain'),
  industry: z.string().describe('Primary industry'),
  industries: z.array(z.string()).describe('All industries'),
  staffCount: z.number().describe('Employee count'),
  staffCountRange: z.string().describe('Employee count range label'),
  revenueRange: z.string().describe('Revenue range label'),
  annualRevenue: z.string().describe('Annual revenue string'),
  founded: z.string().describe('Year company was founded'),
  companyType: z.string().describe('Company type (e.g., Private, Public)'),
  linkedInUrl: z.string().describe('Company LinkedIn page URL'),
  location: z
    .object({
      street1: z.string().describe('Street address'),
      city: z.string().describe('City'),
      state: z.string().describe('State/province'),
      country: z.string().describe('Country'),
    })
    .describe('Company headquarters location'),
});

export type SavedCompany = z.infer<typeof SavedCompanySchema>;

const CompanyListSchema = z.object({
  id: z.string().describe('List ID'),
  name: z.string().describe('List name'),
  companyCount: z
    .number()
    .optional()
    .describe('Number of companies in this list'),
});

export type CompanyList = z.infer<typeof CompanyListSchema>;

// ============================================================================
// listContacts
// ============================================================================

export const listContactsSchema = {
  name: 'listContacts',
  description:
    'Get saved contacts from My Contacts. Returns enriched contact data with emails, phones, company info. Supports pagination and sorting.',
  notes:
    'Returns only contacts that have been researched and saved (not raw search results). Use searchContacts + researchContact to find and enrich new contacts first.',
  input: z.object({
    page: z.number().optional().describe('Page number (0-indexed). Default 0.'),
    limit: z
      .number()
      .optional()
      .describe('Results per page (max 50). Default 25.'),
    sortColumn: z
      .enum([
        'researchedAt',
        'updatedAt',
        'createdAt',
        'Name',
        'Company',
        'Title',
      ])
      .optional()
      .describe('Column to sort by. Default researchedAt.'),
    sortOrder: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Sort direction. Default desc.'),
  }),
  output: z.object({
    contacts: z.array(SavedContactSchema).describe('Array of saved contacts'),
    count: z.number().describe('Number of contacts returned in this page'),
    total: z.number().describe('Total number of saved contacts'),
  }),
};

export type ListContactsInput = z.infer<typeof listContactsSchema.input>;
export type ListContactsOutput = z.infer<typeof listContactsSchema.output>;

// ============================================================================
// getContact
// ============================================================================

export const getContactSchema = {
  name: 'getContact',
  description:
    'Get a single saved contact by numeric contact ID. Returns the same enriched fields as listContacts (emails, phones, company info) for one specific contact.',
  notes:
    'Use the numeric contact ID from listContacts or researchContact results.',
  input: z.object({
    contactId: z
      .string()
      .describe(
        'Numeric contact ID (e.g., "5788427514") from listContacts or researchContact',
      ),
  }),
  output: z.object({
    contact: SavedContactSchema.describe('Full contact details'),
  }),
};

export type GetContactInput = z.infer<typeof getContactSchema.input>;
export type GetContactOutput = z.infer<typeof getContactSchema.output>;

// ============================================================================
// searchCompanies
// ============================================================================

export const searchCompaniesSchema = {
  name: 'searchCompanies',
  description:
    'Search the Seamless.AI company database with firmographic filters. Returns company name, domain, industry, employee count, revenue range, tech stack, location. Each search consumes 1 search credit.',
  notes:
    'Results come from the company search index, not saved companies. Returns firmographic data only (no contacts are included). Each search consumes 1 search credit.',
  input: z.object({
    companies: z
      .array(z.string())
      .optional()
      .describe('Filter by company names'),
    companiesExactMatch: z
      .boolean()
      .optional()
      .describe('Exact match for company names (default false)'),
    industries: z
      .array(z.string())
      .optional()
      .describe('Filter by industry name'),
    locations: z
      .array(z.string())
      .optional()
      .describe('Filter by location (city, state, or country)'),
    technologies: z
      .array(z.string())
      .optional()
      .describe('Filter by technologies used by the company'),
    keywords: z
      .array(z.string())
      .optional()
      .describe('Filter by keywords in company profile'),
    companyTypes: z
      .array(z.string())
      .optional()
      .describe('Filter by company type: "Private", "Public"'),
    companyFoundedOn: z
      .array(z.string())
      .optional()
      .describe(
        'Filter by founding year range. Valid values: "0-1" (less than 1 year), "1-3", "4-10", "10+"',
      ),
    companyFundingTotals: z
      .array(z.string())
      .optional()
      .describe(
        'Filter by total funding range. Valid values: "$0-$100K", "$100K-$1M", "$1M-$5M", "$5M-$20M", "$20M-$50M", "$50M-$100M", "$100M-$500M", "$500M-$1B", "$1B+"',
      ),
    companyLatestFundingDates: z
      .array(z.string())
      .optional()
      .describe(
        'Filter by latest funding date. Valid values: "30" (last 30 days), "90", "180", "365", "1095" (last 3 years)',
      ),
    companyLatestFundingClassifications: z
      .array(z.string())
      .optional()
      .describe(
        'Filter by latest funding round type. Valid values: "Angel", "Seed", "Series A", "Series B", "Series C", "Series D", "Series E", "Private Equity", "Public", "Other"',
      ),
    page: z.number().optional().describe('Page number (0-indexed). Default 0.'),
    perPage: z
      .number()
      .optional()
      .describe('Results per page (max 50). Default 25.'),
  }),
  output: z.object({
    companies: z
      .array(CompanySearchResultSchema)
      .describe('Array of matching companies'),
    isMore: z.boolean().describe('Whether more results exist on the next page'),
    total: z.number().describe('Total matching companies across all pages'),
  }),
};

export type SearchCompaniesInput = z.infer<typeof searchCompaniesSchema.input>;
export type SearchCompaniesOutput = z.infer<
  typeof searchCompaniesSchema.output
>;

// ============================================================================
// listCompanies
// ============================================================================

export const listCompaniesSchema = {
  name: 'listCompanies',
  description: 'Get saved companies from My Companies. Supports pagination.',
  notes:
    'Returns only companies that have been explicitly saved to the account. To find new companies, use searchCompanies first.',
  input: z.object({
    page: z.number().optional().describe('Page number (0-indexed). Default 0.'),
    limit: z
      .number()
      .optional()
      .describe('Results per page (max 50). Default 25.'),
  }),
  output: z.object({
    companies: z.array(SavedCompanySchema).describe('Array of saved companies'),
    count: z.number().describe('Total number of saved companies'),
  }),
};

export type ListCompaniesInput = z.infer<typeof listCompaniesSchema.input>;
export type ListCompaniesOutput = z.infer<typeof listCompaniesSchema.output>;

// ============================================================================
// getCompany
// ============================================================================

export const getCompanySchema = {
  name: 'getCompany',
  description: 'Get full details for a single saved company by its numeric ID.',
  notes:
    'Use the numeric company ID from listCompanies results. The UUID id returned by searchCompanies is NOT valid here; companies must be saved first.',
  input: z.object({
    companyId: z.string().describe('Numeric company ID from listCompanies'),
  }),
  output: z.object({
    company: SavedCompanySchema.describe('Full company details'),
  }),
};

export type GetCompanyInput = z.infer<typeof getCompanySchema.input>;
export type GetCompanyOutput = z.infer<typeof getCompanySchema.output>;

// ============================================================================
// listCompanyLists
// ============================================================================

export const listCompanyListsSchema = {
  name: 'listCompanyLists',
  description:
    'Get all company lists (tags) with their names and company counts. Company lists are separate from contact lists.',
  notes:
    'Company lists are distinct from contact lists returned by listContactLists. Use addCompaniesToList to add companies to a list.',
  input: z.object({}),
  output: z.object({
    lists: z.array(CompanyListSchema).describe('All company lists'),
  }),
};

export type ListCompanyListsInput = z.infer<
  typeof listCompanyListsSchema.input
>;
export type ListCompanyListsOutput = z.infer<
  typeof listCompanyListsSchema.output
>;

// ============================================================================
// allSchemas
// ============================================================================

export const contactsCompaniesSchemas = [
  listContactsSchema,
  getContactSchema,
  searchCompaniesSchema,
  listCompaniesSchema,
  getCompanySchema,
  listCompanyListsSchema,
];
