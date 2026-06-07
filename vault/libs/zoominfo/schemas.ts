import { z } from 'zod';

export const libraryDescription =
  'ZoomInfo B2B sales intelligence: search contacts and companies, build prospect lists, manage saved searches and tags';

export const libraryIcon = '/icons/libs/zoominfo.png';
export const loginUrl = 'https://app.zoominfo.com';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://app.zoominfo.com\`
2. Call \`getContext()\` first to verify login and retrieve user details
3. Call search or list functions as needed; no additional auth params required

## Pagination

ZoomInfo uses page-based pagination: \`page\` (1-indexed) and \`rpp\` (results per page, max 25).
Use \`maxResults\` from search responses to know the total matching record count.
Note: \`totalResults\` equals the number of records returned (same as \`rpp\`), not the total count.

## Credits

- **FREE**: Searching, filtering, browsing results (no credits consumed)
- **COSTS CREDITS**: Exporting contacts to CSV reveals full email/phone data
- Contact emails and phones are masked in search results until exported
- Check credit balance before any export operation; costs cannot be undone

## Key Concepts

- **Person IDs**: Can be negative (this is normal in ZoomInfo's database)
- **Company IDs**: Numeric, variable length (e.g., 239305146)
- **Title seniority codes**: C_EXECUTIVES, VP_EXECUTIVES, DIRECTOR, MANAGER, NON_MANAGER
- **Confidence score**: Data accuracy indicator (85–99 recommended for prospecting)
- **isMasked**: When true, email/phone are hidden; export or reveal to get real values
- **Tags**: ZoomInfo's way to organize contacts and companies. Tags have a type: "CONTACT" or "COMPANY"
- **Saved searches**: Stored filter configurations that can be re-run. Types: GROW_SAVED_SEARCH_PEOPLE, GROW_SAVED_SEARCH_COMPANY

## Filter Notes

Contact and company search filters are merged into ZoomInfo's Advanced Search params.
All filter fields are optional; combine freely. Company ID filters take objects with \`value\` and \`displayName\` fields.

**Company filtering**: Use \`employeeSizeMin\`/\`employeeSizeMax\` for employee count, \`revenueMinIn000s\`/\`revenueMaxIn000s\` for revenue, \`location\` for state/city (e.g. "California"), \`industryKeywords\` or \`doziIndustryQuery\` for industry. The output \`companyType\` field is unreliable (always "PRIVATE"); use the input \`companyType\` filter for reliable type filtering.

**companyRanking**: Filters to companies on named lists. Valid values: "Fortune 500", "Inc. 5000", "Deloitte Technology Fast 500", "Forbes Global 2000". Only available in contact search, not company search.

**boardMembers**: Controls board member inclusion in contact search. "exclude" (default) hides board-only contacts, "include" adds them, "only" returns exclusively board members.
`;

// ============================================================================
// Shared Schemas
// ============================================================================

export const PersonLocationSchema = z.object({
  City: z.string().nullable().optional(),
  State: z.string().nullable().optional(),
  CountryCode: z.string().nullable().optional(),
  metroArea: z.string().nullable().optional(),
});

export const CompanyAddressSchema = z.object({
  Street: z.string().nullable().optional(),
  City: z.string().nullable().optional(),
  State: z.string().nullable().optional(),
  Zip: z.string().nullable().optional(),
  CountryCode: z.string().nullable().optional(),
});

export const DoziIndustrySchema = z.object({
  displayName: z.string(),
  name: z.string().nullable().optional(),
  isPrimary: z.boolean().nullable().optional(),
  score: z.number().nullable().optional(),
});

export const OrgChartJobFunctionSchema = z.object({
  department: z.string().nullable().optional(),
  departmentId: z
    .string()
    .nullable()
    .optional()
    .describe('Department ID (string, e.g. "0", "1")'),
  jobFunction: z.string().nullable().optional(),
  jobFunctionId: z
    .string()
    .nullable()
    .optional()
    .describe('Job function ID (string, e.g. "_0.0", "_1.3")'),
});

export const SocialUrlsParsedSchema = z.object({
  linkedin: z.string().nullable().optional(),
  facebook: z.string().nullable().optional(),
  twitter: z.string().nullable().optional(),
  youtube: z.string().nullable().optional(),
});

export const EmploymentHistorySchema = z.object({
  companyName: z.string().nullable().optional(),
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  jobFunction: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  level: z.string().nullable().optional(),
  companyID: z.number().nullable().optional(),
  companyWebsite: z.string().nullable().optional(),
});

export const ContactResultSchema = z.object({
  personID: z.number().describe('ZoomInfo person ID (can be negative)'),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  name: z.string().nullable().optional().describe('Full name'),
  jobTitle: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  companyID: z.number().nullable().optional(),
  companyName: z.string().nullable().optional(),
  companyDomain: z.string().nullable().optional(),
  companyEmployees: z.number().nullable().optional(),
  companyRevenue: z.string().nullable().optional(),
  companyRevenueRange: z.string().nullable().optional(),
  companyAddress: CompanyAddressSchema.nullable().optional(),
  email: z
    .string()
    .nullable()
    .optional()
    .describe('Masked as XXXXX until revealed'),
  phone: z
    .string()
    .nullable()
    .optional()
    .describe('Direct phone, masked until revealed'),
  mobilePhone: z.string().nullable().optional(),
  companyPhone: z.string().nullable().optional(),
  location: PersonLocationSchema.nullable().optional(),
  isMasked: z
    .boolean()
    .nullable()
    .optional()
    .describe('True when contact info is hidden'),
  isTagged: z.boolean().nullable().optional(),
  confidenceScore: z.number().nullable().optional(),
  lastUpdatedDate: z.string().nullable().optional(),
  positionStartDate: z
    .string()
    .nullable()
    .optional()
    .describe('Date when the person started their current role'),
  orgChartTier: z
    .number()
    .nullable()
    .optional()
    .describe(
      'Org chart tier (1 = top executive / C-suite, 2 = VP-level, higher = lower seniority). Populated when outputFieldOptions includes "org_chart_tier"',
    ),
  orgChartJobFunction: z.array(OrgChartJobFunctionSchema).nullable().optional(),
  socialUrlsParsed: SocialUrlsParsedSchema.nullable().optional(),
  doziIndustry: z.array(DoziIndustrySchema).nullable().optional(),
  employmentHistory: z
    .array(EmploymentHistorySchema)
    .nullable()
    .optional()
    .describe('Past employment positions'),
});

export const CompanyResultSchema = z.object({
  companyID: z.number().describe('ZoomInfo company ID'),
  companyName: z.string().nullable().optional().describe('Company name'),
  companyDomain: z
    .string()
    .nullable()
    .optional()
    .describe('Company website domain'),
  companyDescription: z.string().nullable().optional(),
  companyPhone: z.string().nullable().optional(),
  companyLogo: z.string().nullable().optional(),
  location: CompanyAddressSchema.nullable()
    .optional()
    .describe('Company headquarters address'),
  revenue: z.string().nullable().optional(),
  revenueRange: z.string().nullable().optional(),
  employees: z.number().nullable().optional().describe('Employee count'),
  employeesRange: z
    .string()
    .nullable()
    .optional()
    .describe('Employee count range string'),
  companyType: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Company type from ZoomInfo data. Note: this field frequently returns "PRIVATE" even for public companies; use the companyType input filter for reliable filtering instead',
    ),
  topLevelIndustry: z
    .array(z.string())
    .nullable()
    .optional()
    .describe('Top-level industry categories'),
  doziIndustry: z.array(DoziIndustrySchema).nullable().optional(),
  isMasked: z
    .boolean()
    .nullable()
    .optional()
    .describe('True when company info is hidden'),
  isTagged: z.boolean().nullable().optional(),
  isDefunct: z.boolean().nullable().optional(),
  totalFundingAmountIn000s: z
    .number()
    .nullable()
    .optional()
    .describe('Total funding in thousands USD'),
  certified: z.boolean().nullable().optional(),
  certificationDate: z
    .string()
    .nullable()
    .optional()
    .describe('Date when ZoomInfo certified this company (e.g. "2025-03-17")'),
  companyRevenueIn000s: z
    .number()
    .nullable()
    .optional()
    .describe('Company revenue as a number in thousands USD'),
  funding: z
    .array(
      z.object({
        amountIn000s: z.number().nullable().optional(),
        date: z.string().nullable().optional(),
        round: z.string().nullable().optional(),
        investors: z
          .array(
            z.object({
              companyName: z.string().nullable().optional(),
              investorName: z.string().nullable().optional(),
              investorDomain: z.string().nullable().optional(),
              investorCompanyId: z.number().nullable().optional(),
            }),
          )
          .nullable()
          .optional(),
      }),
    )
    .nullable()
    .optional()
    .describe('Funding rounds with amount, date, round type, and investors'),
});

export const WebReferenceSchema = z.object({
  description: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
});

export const EducationSchema = z.object({
  school: z.string().nullable().optional(),
  degree: z
    .object({
      areaOfStudy: z.string().nullable().optional(),
      degree: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const ContactProfileSchema = z.object({
  personID: z.number().describe('ZoomInfo person ID (can be negative)'),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  name: z.string().nullable().optional().describe('Full name'),
  title: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
  managementLevel: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Management level (only populated via getContact(), not in search results)',
    ),
  companyID: z.number().nullable().optional(),
  companyName: z.string().nullable().optional(),
  companyDomain: z.string().nullable().optional(),
  companyEmployees: z.number().nullable().optional(),
  companyRevenue: z.string().nullable().optional(),
  email: z
    .string()
    .nullable()
    .optional()
    .describe('Masked as XXXXX until revealed'),
  phone: z
    .string()
    .nullable()
    .optional()
    .describe('Direct phone, masked until revealed'),
  mobilePhone: z.string().nullable().optional(),
  companyPhone: z.string().nullable().optional(),
  location: PersonLocationSchema.nullable().optional(),
  companyAddress: CompanyAddressSchema.nullable().optional(),
  personBiography: z.string().nullable().optional(),
  orgChartTier: z.number().nullable().optional(),
  orgChartJobFunction: z.array(OrgChartJobFunctionSchema).nullable().optional(),
  socialUrlsParsed: SocialUrlsParsedSchema.nullable().optional(),
  doziIndustry: z.array(DoziIndustrySchema).nullable().optional(),
  education: z.array(EducationSchema).nullable().optional(),
  employmentHistory: z.array(EmploymentHistorySchema).nullable().optional(),
  confidenceScore: z.number().nullable().optional(),
  lastUpdatedDate: z.string().nullable().optional(),
  isMasked: z.boolean().nullable().optional(),
  isTagged: z.boolean().nullable().optional(),
  timezone: z
    .string()
    .nullable()
    .optional()
    .describe('IANA timezone (e.g. "America/Los_Angeles")'),
  personalEmail: z
    .string()
    .nullable()
    .optional()
    .describe('Personal email address'),
  companyRevenueIn000s: z
    .number()
    .nullable()
    .optional()
    .describe('Company revenue as a number in thousands USD'),
  companyRevenueRange: z
    .string()
    .nullable()
    .optional()
    .describe('Company revenue range string'),
  companyType: z
    .string()
    .nullable()
    .optional()
    .describe('Company type (e.g. "PRIVATE", "PUBLIC")'),
  certified: z
    .boolean()
    .nullable()
    .optional()
    .describe('Whether ZoomInfo has certified this record'),
  currentCompanyStartDate: z
    .string()
    .nullable()
    .optional()
    .describe('When the person started at their current company'),
  isEmailUnsubscribed: z
    .boolean()
    .nullable()
    .optional()
    .describe('Whether the contact has unsubscribed from email'),
  emailBlocked: z
    .boolean()
    .nullable()
    .optional()
    .describe('Business email is blocked'),
  personalEmailBlocked: z
    .boolean()
    .nullable()
    .optional()
    .describe('Personal email is blocked'),
  mobilePhoneBlocked: z
    .boolean()
    .nullable()
    .optional()
    .describe('Mobile phone is blocked'),
  directPhoneBlocked: z
    .boolean()
    .nullable()
    .optional()
    .describe('Direct phone is blocked'),
  companyPhoneBlocked: z
    .boolean()
    .nullable()
    .optional()
    .describe('Company phone is blocked'),
  emailBlockedReason: z
    .string()
    .nullable()
    .optional()
    .describe('Reason business email is blocked'),
  personalEmailBlockedReason: z
    .string()
    .nullable()
    .optional()
    .describe('Reason personal email is blocked'),
  mobilePhoneBlockedReason: z
    .string()
    .nullable()
    .optional()
    .describe('Reason mobile phone is blocked'),
  directPhoneBlockedReason: z
    .string()
    .nullable()
    .optional()
    .describe('Reason direct phone is blocked'),
  companyPhoneBlockedReason: z
    .string()
    .nullable()
    .optional()
    .describe('Reason company phone is blocked'),
  directPhoneIsDoNotCall: z
    .boolean()
    .nullable()
    .optional()
    .describe('Direct phone is on do-not-call list'),
  mobilePhoneIsDoNotCall: z
    .boolean()
    .nullable()
    .optional()
    .describe('Mobile phone is on do-not-call list'),
  profileImageURL: z
    .string()
    .nullable()
    .optional()
    .describe('URL to the contact profile image'),
  topLevelIndustry: z
    .array(z.string())
    .nullable()
    .optional()
    .describe('Top-level industry classifications'),
  icpScore: z
    .number()
    .nullable()
    .optional()
    .describe('Ideal Customer Profile score'),
  hasLeadIndicator: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      'Whether a lead indicator exists for this contact (only present when fetchLeadIndicator is true)',
    ),
  leadStatus: z
    .string()
    .nullable()
    .optional()
    .describe('CRM lead status (only present when fetchLeadStatus is true)'),
  webReference: z
    .array(WebReferenceSchema)
    .nullable()
    .optional()
    .describe(
      'Web references mentioning this contact (news articles, press releases, corporate filings)',
    ),
  middleInitial: z
    .string()
    .nullable()
    .optional()
    .describe('Middle initial of the contact'),
});

export const CompanyCompetitorSchema = z.object({
  companyId: z.number().describe('Competitor ZoomInfo company ID'),
  companyName: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  revenue: z.string().nullable().optional(),
  employeeCount: z.number().nullable().optional(),
});

export const CompanyProductSchema = z.object({
  value: z.string().describe('Product/technology identifier'),
  displayName: z.string().describe('Product/technology display name'),
});

export const CompanyMergerSchema = z.object({
  companyId: z
    .string()
    .describe('Acquired company ZoomInfo company ID (returned as string)'),
  companyName: z.string().nullable().optional(),
  zoomUrl: z.string().nullable().optional(),
});

export const CompanyParentSchema = z.object({
  id: z.number().nullable().optional().describe('Parent company ZoomInfo ID'),
  name: z.string().nullable().optional().describe('Parent company name'),
});

export const SubUnitTypeInfoSchema = z.object({
  type: z.number().nullable().optional().describe('Sub-unit type code'),
  typeDescription: z.string().nullable().optional(),
});

export const FollowerCountParsedSchema = z.object({
  linkedin: z
    .string()
    .nullable()
    .optional()
    .describe('LinkedIn follower count as string'),
  facebook: z
    .string()
    .nullable()
    .optional()
    .describe('Facebook follower count as string'),
  twitter: z
    .string()
    .nullable()
    .optional()
    .describe('Twitter/X follower count as string'),
  youtube: z
    .string()
    .nullable()
    .optional()
    .describe('YouTube follower count as string'),
});

export const DepartmentBudgetSchema = z.object({
  departmentType: z
    .string()
    .describe('Department name (e.g. "Marketing", "IT")'),
  budgetAmount: z.number().nullable().optional().describe('Budget amount'),
});

export const EmployeeGrowthDataPointSchema = z.object({
  label: z.string().describe('Time period label'),
  employeeCount: z.number().nullable().optional(),
});

export const CompanyEmployeeGrowthSchema = z.object({
  oneYearEmployeeGrowthRate: z
    .number()
    .nullable()
    .optional()
    .describe('1-year employee growth rate'),
  twoYearEmployeeGrowthRate: z
    .number()
    .nullable()
    .optional()
    .describe('2-year employee growth rate'),
  employeeGrowthData: z
    .array(EmployeeGrowthDataPointSchema)
    .nullable()
    .optional()
    .describe('Historical employee count data points'),
});

export const CompanyProfileSchema = z.object({
  id: z.number().describe('ZoomInfo company ID'),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  fax: z.string().nullable().optional().describe('Company fax number'),
  ticker: z.string().nullable().optional(),
  address: CompanyAddressSchema.nullable().optional(),
  displayAddress: z
    .string()
    .nullable()
    .optional()
    .describe('Formatted full address string'),
  employeeCount: z.number().nullable().optional(),
  employeeCountRange: z
    .string()
    .nullable()
    .optional()
    .describe('Employee count range string (e.g. "Over 10,000")'),
  revenue: z.string().nullable().optional(),
  revenueRange: z.string().nullable().optional(),
  companyRevenueIn000s: z
    .number()
    .nullable()
    .optional()
    .describe('Revenue as number in thousands USD'),
  totalFundingAmountIn000s: z
    .number()
    .nullable()
    .optional()
    .describe('Total funding in thousands USD'),
  doziIndustry: z.array(DoziIndustrySchema).nullable().optional(),
  allIndustries: z
    .array(z.string())
    .nullable()
    .optional()
    .describe('All industry classification names'),
  NAICS: z
    .array(z.number())
    .nullable()
    .optional()
    .describe('NAICS industry classification codes'),
  SIC: z
    .array(z.number())
    .nullable()
    .optional()
    .describe('SIC industry classification codes'),
  isDefunct: z.boolean().nullable().optional(),
  certified: z.boolean().nullable().optional(),
  certificationDate: z
    .string()
    .nullable()
    .optional()
    .describe('Date when ZoomInfo certified this company'),
  logo: z.string().nullable().optional(),
  alexaRank: z
    .number()
    .nullable()
    .optional()
    .describe(
      'Domain popularity rank (lower = more popular). Null for unranked domains',
    ),
  foundedYear: z
    .number()
    .nullable()
    .optional()
    .describe('Year the company was founded'),
  locationsCount: z
    .string()
    .nullable()
    .optional()
    .describe('Number of office locations (returned as string)'),
  ranking: z
    .array(z.string())
    .nullable()
    .optional()
    .describe('Stock index rankings (e.g. ["Russell 3000"])'),
  alternateNames: z
    .array(z.string())
    .nullable()
    .optional()
    .describe('Alternative company names'),
  socialUrlsParsed: SocialUrlsParsedSchema.nullable().optional(),
  followerCountParsed: FollowerCountParsedSchema.nullable()
    .optional()
    .describe('Social media follower counts'),
  ultimateParent: CompanyParentSchema.nullable()
    .optional()
    .describe('Ultimate parent company in corporate hierarchy'),
  directParent: CompanyParentSchema.nullable()
    .optional()
    .describe('Direct parent company'),
  subUnitTypeInfo: SubUnitTypeInfoSchema.nullable()
    .optional()
    .describe('Subsidiary/sub-unit type classification'),
  competitors: z
    .array(CompanyCompetitorSchema)
    .nullable()
    .optional()
    .describe('Competitor companies with revenue and employee data'),
  products: z
    .array(CompanyProductSchema)
    .nullable()
    .optional()
    .describe('Products and technologies used or offered by the company'),
  merger: z
    .array(CompanyMergerSchema)
    .nullable()
    .optional()
    .describe('Companies acquired through mergers and acquisitions'),
  funding: z
    .array(
      z.object({
        amountIn000s: z.number().nullable().optional(),
        date: z.string().nullable().optional(),
        round: z.string().nullable().optional(),
        investors: z
          .array(
            z.object({
              companyName: z.string().nullable().optional(),
              investorName: z.string().nullable().optional(),
              investorDomain: z.string().nullable().optional(),
              investorCompanyId: z.number().nullable().optional(),
            }),
          )
          .nullable()
          .optional(),
      }),
    )
    .nullable()
    .optional()
    .describe('Funding rounds with amount, date, round type, and investors'),
  departmentBudgets: z
    .array(DepartmentBudgetSchema)
    .nullable()
    .optional()
    .describe('Department budget data'),
  companyEmployeeGrowth: CompanyEmployeeGrowthSchema.nullable()
    .optional()
    .describe('Employee growth rate and historical data'),
});

export const SavedSearchQuerySchema = z
  .record(
    z.string(),
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(z.union([z.string(), z.number()])),
    ]),
  )
  .describe(
    'Filter params stored with the saved search (e.g. isCertified, companyPastOrPresent, jobTitle, etc.)',
  );

export const SavedSearchItemSchema = z.object({
  id: z.number().describe('Saved search ID'),
  name: z.string().describe('Saved search name'),
  description: z
    .string()
    .nullable()
    .optional()
    .describe('Optional description'),
  creationDate: z.string().describe('Creation timestamp as ISO 8601 string'),
  favorite: z.number().describe('Favorite rank (0 = not favorited)'),
  alertFrequency: z
    .string()
    .nullable()
    .optional()
    .describe('Alert cadence: DAILY, WEEKLY, MONTHLY, or null'),
  showInHomepage: z
    .boolean()
    .nullable()
    .optional()
    .describe('Whether this saved search is shown on the ZoomInfo homepage'),
  subscriptionId: z
    .string()
    .nullable()
    .optional()
    .describe('Alert subscription ID (UUID), present when alerts are enabled'),
  isArchivedBc: z
    .boolean()
    .nullable()
    .optional()
    .describe('Whether the saved search has been archived'),
  savedSearchType: z
    .string()
    .describe(
      'Type: GROW_SAVED_SEARCH_PEOPLE, GROW_SAVED_SEARCH_COMPANY, DEFAULT_UNIFIED_SEARCH, HOMEPAGE_FEED_SEARCH, TRACKER_PEOPLE',
    ),
  query: SavedSearchQuerySchema.nullable()
    .optional()
    .describe('Stored filter query params'),
});

// ============================================================================
// getContext
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Get current user details and credit balance. Call first to verify login before any other function.',
  notes: '',
  input: z.object({}),
  output: z.object({
    userId: z.string().describe('ZoomInfo user ID (_id from userDetails)'),
    email: z.string().describe('User email address'),
    name: z.string().describe('User display name'),
    username: z.string().describe('Login username (usually same as email)'),
    company: z.string().nullable().optional().describe('User company name'),
    credits: z
      .number()
      .nullable()
      .optional()
      .describe('Account credit balance'),
    zoomAccountId: z
      .number()
      .nullable()
      .optional()
      .describe('ZoomInfo account ID'),
    zoomCompanyId: z
      .number()
      .nullable()
      .optional()
      .describe('ZoomInfo company ID'),
    isAdmin: z.boolean().nullable().optional(),
    productTier: z
      .string()
      .nullable()
      .optional()
      .describe('Plan tier (e.g., "Basic", "Advanced")'),
    csvExportAllowed: z.boolean().nullable().optional(),
    remainingCredits: z
      .number()
      .nullable()
      .optional()
      .describe('Remaining bulk credits'),
    remainingViews: z
      .number()
      .nullable()
      .optional()
      .describe('Remaining contact views'),
    viewCount: z
      .number()
      .nullable()
      .optional()
      .describe('Number of contact views used'),
    companyViewLimit: z
      .number()
      .nullable()
      .optional()
      .describe('Company-wide contact view limit'),
    zoomEnterprise: z
      .boolean()
      .nullable()
      .optional()
      .describe('Whether this is an enterprise account'),
    phoneVerified: z
      .boolean()
      .nullable()
      .optional()
      .describe('Whether user phone is verified'),
    platforms: z
      .array(z.string())
      .nullable()
      .optional()
      .describe('Active platform access (e.g., ["DOZI", "ADMIN"])'),
    productName: z
      .string()
      .nullable()
      .optional()
      .describe('Full product name (e.g., "SalesOS: Basic Bundle")'),
    productCode: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Internal product code (e.g., "PROFESSIONAL LITE SALES ECOMM")',
      ),
    productExpirationDate: z
      .string()
      .nullable()
      .optional()
      .describe('Product expiration as ISO 8601 date string'),
    accessLevel: z
      .number()
      .nullable()
      .optional()
      .describe('Numeric access level (e.g., 3)'),
  }),
};
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// searchContacts
// ============================================================================

export const CompanyIdFilterSchema = z.object({
  value: z.number().describe('Company ID numeric value'),
  displayName: z.string().describe('Company display name'),
});

export const searchContactsSchema = {
  name: 'searchContacts',
  description:
    'Search ZoomInfo contacts database using Advanced Search filters. Returns paginated results with masked contact info.',
  notes:
    'Call getContext() first to verify login. Email and phone are masked in results; use export (costs credits) to reveal. Use searchCompanies() to get companyIds for the companyIds filter. Use titleSeniority to filter by seniority. Use employeeSizeMin/employeeSizeMax for employee count filtering and revenueMinIn000s/revenueMaxIn000s for revenue filtering. Use companyRanking to filter by lists like "Fortune 500". Results are filtered to confidence score 85-99 and exclude board members and defunct companies by default.',
  input: z.object({
    page: z
      .number()
      .min(1)
      .optional()
      .default(1)
      .describe('Page number (1-indexed, must be >= 1)'),
    rpp: z
      .number()
      .min(1)
      .max(25)
      .optional()
      .default(25)
      .describe('Results per page (1-25)'),
    companyName: z.string().optional().describe('Filter by company name'),
    companyIds: z
      .array(CompanyIdFilterSchema)
      .optional()
      .describe(
        'Filter by specific company IDs (use searchCompanies to get IDs and names)',
      ),
    state: z
      .string()
      .optional()
      .describe('Filter by US state (e.g. "California")'),
    country: z
      .string()
      .optional()
      .describe('Filter by country (e.g. "United States")'),
    fullName: z
      .string()
      .optional()
      .describe('Search by contact full name (e.g. "Marc Benioff")'),
    titleSeniority: z
      .string()
      .optional()
      .describe(
        'Filter by management seniority code. Comma-separated for multiple. Values: C_EXECUTIVES, VP_EXECUTIVES, DIRECTOR, MANAGER, NON_MANAGER',
      ),
    contactRequirements: z
      .string()
      .optional()
      .describe(
        'Filter by required contact info availability. Comma-separated for multiple. Values: phone, email, mobile_phone, direct_phone',
      ),
    companyType: z
      .string()
      .optional()
      .describe('Filter by company type (e.g. "Public", "Private")'),
    zipCode: z
      .string()
      .optional()
      .describe('Filter by zip/postal code (e.g. "94105")'),
    confidenceScoreMin: z
      .number()
      .optional()
      .describe(
        'Minimum confidence score (default 85). Lower values return more results with weaker data confidence',
      ),
    confidenceScoreMax: z
      .number()
      .optional()
      .describe('Maximum confidence score (default 99)'),
    personTitle: z
      .string()
      .optional()
      .describe(
        'Filter by job title text (e.g. "Software Engineer", "VP of Sales"). Matches current job title',
      ),
    emailAddress: z
      .string()
      .optional()
      .describe('Filter by email address (e.g. "john@example.com")'),
    school: z
      .string()
      .optional()
      .describe(
        'Filter by college/university name (e.g. "Stanford University")',
      ),
    industryKeywords: z
      .string()
      .optional()
      .describe(
        'Filter by industry keywords in company profile (e.g. "cybersecurity")',
      ),
    companyDesc: z
      .string()
      .optional()
      .describe(
        'Filter by company description keywords (e.g. "artificial intelligence")',
      ),
    industryCodeList: z
      .string()
      .optional()
      .describe(
        'Filter by NAICS or SIC industry classification codes. Comma-separated for multiple (e.g. "541511,541512")',
      ),
    hasBeenNotified: z
      .enum(['only', 'include'])
      .optional()
      .describe(
        'Filter by GDPR notice status. "only" = only contacts provided with notice, "include" = include all',
      ),
    showOnlyUltimateParent: z
      .boolean()
      .optional()
      .describe(
        'When true, only show contacts at ultimate parent companies (not subsidiaries)',
      ),
    currentCompanyStartDate: z
      .string()
      .optional()
      .describe(
        'Filter for new hires: ISO date string for minimum start date at current company. Requires another filter to be active',
      ),
    personCreationStartDate: z
      .string()
      .optional()
      .describe(
        'Filter for newly discovered contacts: ISO date string for minimum creation date in ZoomInfo database',
      ),
    employeeSizeMin: z
      .number()
      .optional()
      .describe('Minimum company employee count (e.g. 100)'),
    employeeSizeMax: z
      .number()
      .optional()
      .describe('Maximum company employee count (e.g. 500)'),
    revenueMinIn000s: z
      .number()
      .optional()
      .describe('Minimum company revenue in thousands USD (e.g. 1000 = $1M)'),
    revenueMaxIn000s: z
      .number()
      .optional()
      .describe(
        'Maximum company revenue in thousands USD (e.g. 100000 = $100M)',
      ),
    totalFundingAmountMinIn000s: z
      .number()
      .optional()
      .describe(
        'Minimum total funding amount in thousands USD (e.g. 10000 = $10M)',
      ),
    totalFundingAmountMaxIn000s: z
      .number()
      .optional()
      .describe(
        'Maximum total funding amount in thousands USD (e.g. 500000 = $500M)',
      ),
    pageRank: z
      .string()
      .optional()
      .describe(
        'Filter by website domain rank range (e.g. "1-10000" for top 10K sites)',
      ),
    pTag: z
      .string()
      .optional()
      .describe(
        'Filter to contacts in specific contact tag IDs. Comma-separated for multiple',
      ),
    cTag: z
      .string()
      .optional()
      .describe(
        'Filter to contacts at companies in specific company tag IDs. Comma-separated for multiple',
      ),
    excludePeopleTags: z
      .string()
      .optional()
      .describe(
        'Exclude contacts in specific contact tag IDs. Comma-separated for multiple. Requires another filter to be active',
      ),
    excludeCompanyTags: z
      .string()
      .optional()
      .describe(
        'Exclude contacts at companies in specific company tag IDs. Comma-separated for multiple. Requires another filter to be active',
      ),
    pList: z
      .string()
      .optional()
      .describe(
        'Filter to contacts in specific contact list IDs. Comma-separated for multiple',
      ),
    cList: z
      .string()
      .optional()
      .describe(
        'Filter to contacts at companies in specific company list IDs. Comma-separated for multiple',
      ),
    scoopTopics: z
      .string()
      .optional()
      .describe(
        'Filter by scoop/news signal topics. Comma-separated for multiple',
      ),
    scoopTypes: z
      .string()
      .optional()
      .describe(
        'Filter by scoop/news signal types. Comma-separated for multiple',
      ),
    companyRanking: z
      .string()
      .optional()
      .describe(
        'Filter by company ranking list membership. Values: "Fortune 500", "Inc. 5000", "Deloitte Technology Fast 500", "Forbes Global 2000"',
      ),
    boardMembers: z
      .enum(['include', 'only', 'exclude'])
      .optional()
      .describe(
        'Board member filter. "exclude" (default) excludes board members, "include" includes all, "only" returns only board members',
      ),
    sortBy: z
      .enum([
        'Relevance',
        'LastName',
        'COMPANYNAME',
        'TITLE',
        'confidencescore',
      ])
      .optional()
      .describe(
        'Sort field. Default is Relevance. Secondary sort is always person_id desc',
      ),
    sortOrder: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Sort direction for the primary sort field (default desc)'),
  }),
  output: z.object({
    totalResults: z
      .number()
      .describe('Number of results returned (equals rpp)'),
    maxResults: z.number().describe('Total matching contacts across all pages'),
    data: z
      .array(ContactResultSchema)
      .describe(
        'Contact records. Key fields: personID, firstName, lastName, jobTitle, companyName, email, phone, location, isMasked',
      ),
  }),
};
export type SearchContactsInput = z.infer<typeof searchContactsSchema.input>;
export type SearchContactsOutput = z.infer<typeof searchContactsSchema.output>;

// ============================================================================
// createTag
// ============================================================================

export const createTagSchema = {
  name: 'createTag',
  description:
    'Create a new tag to organize contacts or companies. Tags are the ZoomInfo way to bookmark and group records.',
  notes:
    'Call getContext() first to verify login. Tag names must be unique per user; duplicates return a 422 error. After creating, the returned tagId can be used to identify the tag in listTags() and deleteTag().',
  input: z.object({
    name: z.string().min(1).describe('Tag name (e.g. "Hot Leads Q1")'),
    type: z
      .enum([
        'CONTACT',
        'COMPANY',
        'PUBLIC_CONTACT',
        'PUBLIC_COMPANY',
        'RECRUITER_CONTACT',
      ])
      .optional()
      .default('CONTACT')
      .describe(
        'Tag type: CONTACT/COMPANY are private, PUBLIC_CONTACT/PUBLIC_COMPANY are visible to all org members, RECRUITER_CONTACT is for recruiter workflows',
      ),
  }),
  output: z.object({
    tagId: z.number().describe('Created tag ID'),
    accountId: z.number().describe('ZoomInfo account ID of the tag owner'),
    companyId: z.number().describe('ZoomInfo company (tenant) ID'),
    tagName: z.string().describe('Tag name as stored'),
    tagType: z
      .enum([
        'CONTACT',
        'COMPANY',
        'PUBLIC_CONTACT',
        'PUBLIC_COMPANY',
        'RECRUITER_CONTACT',
      ])
      .describe('Tag type as stored'),
    creationDate: z.string().describe('Creation timestamp'),
  }),
};
export type CreateTagInput = z.infer<typeof createTagSchema.input>;
export type CreateTagOutput = z.infer<typeof createTagSchema.output>;

// ============================================================================
// updateTag
// ============================================================================

export const updateTagSchema = {
  name: 'updateTag',
  description: 'Rename an existing tag by its ID.',
  notes:
    'Call getContext() first to verify login. Use listTags() to get tagId values. Tag names must be unique per user; duplicates return a 422 error.',
  input: z.object({
    tagId: z.number().describe('ID of the tag to rename'),
    tagName: z.string().min(1).describe('New name for the tag'),
  }),
  output: z.object({
    tagId: z.number().describe('Tag ID'),
    accountId: z.number().describe('ZoomInfo account ID of the tag owner'),
    companyId: z.number().describe('ZoomInfo company (tenant) ID'),
    tagName: z.string().describe('Updated tag name'),
    tagType: z
      .enum([
        'CONTACT',
        'COMPANY',
        'PUBLIC_CONTACT',
        'PUBLIC_COMPANY',
        'RECRUITER_CONTACT',
      ])
      .describe('Tag type as stored'),
    creationDate: z.string().describe('Original creation timestamp'),
  }),
};
export type UpdateTagInput = z.infer<typeof updateTagSchema.input>;
export type UpdateTagOutput = z.infer<typeof updateTagSchema.output>;

// ============================================================================
// searchCompanies
// ============================================================================

export const searchCompaniesSchema = {
  name: 'searchCompanies',
  description:
    'Search ZoomInfo companies database using Advanced Search filters. Returns paginated company records.',
  notes:
    'Call getContext() first to verify login. Returned companyID values can be passed to getCompany(), getCompanyEmployees(), getCompanyNews(), or the companyIds filter in searchContacts(). Use employeeSizeMin/Max for employee count filtering and revenueMinIn000s/MaxIn000s for revenue filtering. Use location param for state/city filtering (not a separate state param). The output companyType field is unreliable; use the companyType input filter for reliable type filtering.',
  input: z.object({
    page: z.number().optional().default(1).describe('Page number (1-indexed)'),
    rpp: z
      .number()
      .optional()
      .default(25)
      .describe('Results per page (max 25)'),
    companyName: z.string().optional().describe('Filter by company name'),
    location: z
      .string()
      .optional()
      .describe(
        'Filter by location. Accepts state name (e.g. "California"), city + state (e.g. "San Francisco, California"), or state + country (e.g. "California, United States"). For non-US locations use country name or city + country',
      ),
    country: z
      .string()
      .optional()
      .describe('Filter by country (e.g. "United States")'),
    companyType: z
      .enum(['Public', 'Private', 'Education', 'Nonprofit', 'Government'])
      .optional()
      .describe('Filter by company type'),
    businessModel: z
      .enum(['B2B', 'B2C'])
      .optional()
      .describe('Filter by business model'),
    sortBy: z
      .enum(['Relevance', 'name', 'state', 'EmployeeCount', 'Revenue', 'URL'])
      .optional()
      .describe(
        'Sort results by field. Relevance (default), name (Company Name), state (City, State), EmployeeCount, Revenue, URL (Website)',
      ),
    sortOrder: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Sort direction (default: desc)'),
    excludeDefunctCompanies: z
      .boolean()
      .optional()
      .describe(
        'Exclude defunct/inactive companies from results (default: true)',
      ),
    employeeSizeMin: z
      .number()
      .optional()
      .describe('Minimum employee count (e.g. 100)'),
    employeeSizeMax: z
      .number()
      .optional()
      .describe('Maximum employee count (e.g. 500)'),
    revenueMinIn000s: z
      .number()
      .optional()
      .describe(
        'Minimum company revenue in thousands USD (e.g. 1000 = $1M, 100000 = $100M)',
      ),
    revenueMaxIn000s: z
      .number()
      .optional()
      .describe(
        'Maximum company revenue in thousands USD (e.g. 10000 = $10M, 1000000 = $1B)',
      ),
    alexaRankMin: z
      .number()
      .optional()
      .describe(
        'Minimum domain rank (1 = most popular). Maps to "Domain Rank" filter in UI',
      ),
    alexaRankMax: z
      .number()
      .optional()
      .describe('Maximum domain rank. Lower values = more popular websites'),
    isCertified: z
      .enum(['include', 'only'])
      .optional()
      .describe(
        'Certified companies filter. "include" (default) returns all, "only" returns only ZoomInfo-certified companies',
      ),
    zipCode: z
      .string()
      .optional()
      .describe('Filter by zip/postal code (e.g. "94105")'),
    industryKeywords: z
      .string()
      .optional()
      .describe(
        'Filter by industry keyword (e.g. "Software", "Healthcare", "Finance"). Matches companies whose industry classification contains the keyword',
      ),
    doziIndustryQuery: z
      .object({
        stringTermList: z.object({
          values: z.array(
            z.object({
              value: z
                .string()
                .describe(
                  'Industry code from doziIndustry.name field (e.g. "software", "healthcare.services", "finance.creditcards")',
                ),
              negate: z.boolean().describe('Set true to exclude this industry'),
            }),
          ),
        }),
      })
      .optional()
      .describe(
        'Structured industry filter using ZoomInfo industry codes. More precise than industryKeywords. Use doziIndustry.name values from search results to discover valid codes',
      ),
  }),
  output: z.object({
    totalResults: z
      .number()
      .describe('Number of results returned (equals rpp)'),
    maxResults: z
      .number()
      .describe('Total matching companies across all pages'),
    data: z
      .array(CompanyResultSchema)
      .describe(
        'Company records. Key fields: companyID, companyName, companyDomain, employees, revenue, location, doziIndustry',
      ),
  }),
};
export type SearchCompaniesInput = z.infer<typeof searchCompaniesSchema.input>;
export type SearchCompaniesOutput = z.infer<
  typeof searchCompaniesSchema.output
>;

// ============================================================================
// listTags
// ============================================================================

export const listTagsSchema = {
  name: 'listTags',
  description:
    'List all tags for the current user. Supports filtering by tag type (private, public, recruiter).',
  notes:
    'Call getContext() first to verify login. Use returned tagId values with deleteTag(). By default returns CONTACT, COMPANY, PUBLIC_CONTACT, and PUBLIC_COMPANY tags. Pass `type` to filter to specific tag types.',
  input: z.object({
    type: z
      .array(
        z.enum([
          'CONTACT',
          'COMPANY',
          'PUBLIC_CONTACT',
          'PUBLIC_COMPANY',
          'RECRUITER_CONTACT',
        ]),
      )
      .optional()
      .describe(
        'Tag types to include. CONTACT/COMPANY are private tags, PUBLIC_CONTACT/PUBLIC_COMPANY are visible to all org members, RECRUITER_CONTACT is for recruiter workflows. Defaults to all types except RECRUITER_CONTACT.',
      ),
  }),
  output: z.object({
    tags: z.array(
      z.object({
        tagId: z.number().describe('Unique tag ID'),
        accountId: z.number().describe('ZoomInfo account ID of the tag owner'),
        companyId: z.number().describe('ZoomInfo company (tenant) ID'),
        tagName: z.string().describe('Tag display name'),
        tagType: z
          .enum([
            'CONTACT',
            'COMPANY',
            'PUBLIC_CONTACT',
            'PUBLIC_COMPANY',
            'RECRUITER_CONTACT',
          ])
          .describe('Tag type'),
        creationDate: z
          .string()
          .describe('Creation timestamp (e.g. "2026-03-04 05:50:57.946")'),
      }),
    ),
  }),
};
export type ListTagsInput = z.infer<typeof listTagsSchema.input>;
export type ListTagsOutput = z.infer<typeof listTagsSchema.output>;

// ============================================================================
// deleteTag
// ============================================================================

export const deleteTagSchema = {
  name: 'deleteTag',
  description:
    'Delete a tag by its ID. Works for both CONTACT and COMPANY tag types.',
  notes:
    'Call getContext() first to verify login. Use listTags() to get tagId values.',
  input: z.object({
    tagId: z.number().describe('ID of the tag to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('True when the tag was deleted successfully'),
  }),
};
export type DeleteTagInput = z.infer<typeof deleteTagSchema.input>;
export type DeleteTagOutput = z.infer<typeof deleteTagSchema.output>;

// ============================================================================
// getCredits
// ============================================================================

export const getCreditsSchema = {
  name: 'getCredits',
  description:
    'Get detailed credit usage and limits for the current user account.',
  notes:
    'Call getContext() first to verify login. Check this before any export operation; exporting contact data costs credits and cannot be undone.',
  input: z.object({}),
  output: z.object({
    bulkAvailableCredits: z
      .number()
      .describe('Bulk credits currently available for export operations'),
    bulkUserCreditLimit: z
      .number()
      .describe('Maximum bulk credits allocated to this user'),
    totalRemainingCredits: z
      .number()
      .describe('Total remaining credits across all credit types'),
    recurringAvailableCredits: z
      .number()
      .describe('Recurring (monthly refresh) credits currently available'),
    recurringUserQuota: z
      .number()
      .describe('Monthly recurring credit quota for this user'),
    companyHasCredits: z
      .boolean()
      .describe('True when the organization account has credits configured'),
    hasUnlimitedBulkUserCreditLimit: z
      .boolean()
      .describe('True when this user has unlimited bulk credit access'),
    creditLimitTermType: z
      .string()
      .nullable()
      .describe(
        'Credit term type (e.g. "MONTHLY", "ANNUAL") or null if not set',
      ),
  }),
};
export type GetCreditsInput = z.infer<typeof getCreditsSchema.input>;
export type GetCreditsOutput = z.infer<typeof getCreditsSchema.output>;

// ============================================================================
// getCompanyNews
// ============================================================================

export const getCompanyNewsSchema = {
  name: 'getCompanyNews',
  description:
    'Get recent news articles for a company by its ZoomInfo company ID.',
  notes:
    'Call getContext() first to verify login. Use searchCompanies() to get companyId values. Results are paginated in pages of 250. Use pageNumber to paginate (0-indexed). Use categories to filter by news type.',
  input: z.object({
    companyId: z.number().describe('ZoomInfo company ID'),
    count: z
      .number()
      .optional()
      .default(10)
      .describe(
        'Maximum number of articles to return (default 10, max 250 per page). Results are trimmed client-side from the API page',
      ),
    sortByField: z
      .enum(['pageDate', 'title'])
      .optional()
      .describe(
        'Sort field for news articles. pageDate (default) sorts by publication date, title sorts alphabetically',
      ),
    sortDirection: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Sort direction (default desc). Use asc for oldest-first'),
    categories: z
      .enum([
        'GENERAL_NEWS',
        'GENERAL_PRESS_RELEASE',
        'FUNDING',
        'MERGER_OR_ACQUISITION',
        'PERSON',
        'PRODUCT',
        'FINANCIAL_RESULTS',
      ])
      .optional()
      .describe(
        'Filter articles by news category. Only one category at a time. Omit to return all categories',
      ),
    pageNumber: z
      .number()
      .optional()
      .describe(
        'Page number for pagination (0-indexed, pages of 250 articles). Page 0 and 1 return the same first page',
      ),
  }),
  output: z.object({
    articles: z.array(
      z.object({
        title: z.string().describe('Article headline'),
        url: z.string().describe('Full article URL'),
        domain: z
          .string()
          .describe('Publisher domain (e.g. "finance.yahoo.com")'),
        pageDate: z.string().describe('Publication date in ISO 8601 format'),
        categories: z
          .array(z.string())
          .describe('Article categories (e.g. ["GENERAL_NEWS", "FUNDING"])'),
        content: z
          .string()
          .describe('Article excerpt (up to numberOfChars characters)'),
        imageUrl: z.string().nullable().describe('Article image URL or null'),
        companyName: z
          .array(z.string())
          .describe('Company names mentioned in the article'),
        companyId: z
          .array(z.number())
          .describe('ZoomInfo company IDs mentioned in the article'),
      }),
    ),
    maxResults: z
      .number()
      .describe('Total number of matching articles across all pages'),
  }),
};
export type GetCompanyNewsInput = z.infer<typeof getCompanyNewsSchema.input>;
export type GetCompanyNewsOutput = z.infer<typeof getCompanyNewsSchema.output>;

// ============================================================================
// getContact
// ============================================================================

export const getContactSchema = {
  name: 'getContact',
  description:
    'Get a full contact profile by person ID, including biography, employment history, education, and social URLs.',
  notes:
    'Call getContext() first to verify login. Person IDs come from searchContacts() or getCompanyEmployees(). IDs can be negative; both positive and negative values are valid. Set unmaskEmailAndPhone to true to reveal actual email and phone values (this costs credits).',
  input: z.object({
    personId: z
      .number()
      .describe('ZoomInfo person ID (can be negative; both are valid)'),
    unmaskEmailAndPhone: z
      .boolean()
      .optional()
      .describe(
        'Reveal actual email and phone values instead of masked XXXXX. Costs credits; check getCredits() first',
      ),
    fetchLeadIndicator: z
      .boolean()
      .optional()
      .describe(
        'When true, fetches the lead indicator flag for this contact (populates hasLeadIndicator in the response)',
      ),
    fetchLeadStatus: z
      .boolean()
      .optional()
      .describe(
        'When true, fetches the CRM lead status for this contact (populates leadStatus in the response)',
      ),
  }),
  output: z.object(ContactProfileSchema.shape),
};
export type GetContactInput = z.infer<typeof getContactSchema.input>;
export type GetContactOutput = z.infer<typeof getContactSchema.output>;

// ============================================================================
// getCompany
// ============================================================================

export const getCompanySchema = {
  name: 'getCompany',
  description:
    'Get a full company profile by company ID, including address, industry, revenue, employee count, funding, competitors, products, acquisitions, social URLs, and corporate hierarchy.',
  notes:
    'Call getContext() first to verify login. Company IDs come from searchCompanies() or from companyID on contact records. Returns comprehensive profile data including NAICS/SIC codes, social media URLs and follower counts, competitor companies, products/technologies, M&A history, corporate parent hierarchy, and employee growth data.',
  input: z.object({
    companyId: z.number().describe('ZoomInfo company ID'),
  }),
  output: z.object(CompanyProfileSchema.shape),
};
export type GetCompanyInput = z.infer<typeof getCompanySchema.input>;
export type GetCompanyOutput = z.infer<typeof getCompanySchema.output>;

// ============================================================================
// getCompanyEmployees
// ============================================================================

export const getCompanyEmployeesSchema = {
  name: 'getCompanyEmployees',
  description:
    'Get employees at a specific company, with optional filters for management level, department, seniority, job title, and more.',
  notes:
    'Call getContext() first to verify login. Use searchCompanies() to get companyId. Returned personID values can be passed to getContact() for full profiles. Email and phone are masked; export costs credits. Results are filtered to confidence score 85-99 and exclude board members by default. Use companyPastOrPresent to include former employees. Use titleSeniority for seniority filtering (C_EXECUTIVES, VP_EXECUTIVES, DIRECTOR, MANAGER, NON_MANAGER). The managementLevel filter is converted to titleSeniority internally; if both are supplied, titleSeniority takes precedence. Department filtering is not supported by the API. Use orgChartJobFunction in results to inspect department assignments.',
  input: z.object({
    companyId: z.number().describe('ZoomInfo company ID'),
    page: z.number().optional().default(1).describe('Page number (1-indexed)'),
    rpp: z
      .number()
      .optional()
      .default(25)
      .describe('Results per page (max 25)'),
    managementLevel: z
      .array(
        z.enum(['C-Level', 'VP-Level', 'Director', 'Manager', 'Non-Manager']),
      )
      .optional()
      .describe(
        'Filter by management level. Converted to titleSeniority codes internally (C-Level→C_EXECUTIVES, VP-Level→VP_EXECUTIVES, Director→DIRECTOR, Manager→MANAGER, Non-Manager→NON_MANAGER). Ignored if titleSeniority is also provided.',
      ),
    sortBy: z
      .enum([
        'Relevance',
        'LastName',
        'COMPANYNAME',
        'TITLE',
        'confidencescore',
      ])
      .optional()
      .describe(
        'Sort field. Default is Relevance. Secondary sort is always person_id desc',
      ),
    sortOrder: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Sort direction for the primary sort field (default desc)'),
    companyPastOrPresent: z
      .enum(['1', '2', '3'])
      .optional()
      .describe(
        'Employee tenure filter. "1" = current employees (default), "2" = former employees, "3" = current or former employees',
      ),
    excludeBoardMembers: z
      .boolean()
      .optional()
      .describe('Exclude board members from results (default true)'),
    confidenceScoreMin: z
      .number()
      .optional()
      .describe(
        'Minimum confidence score (default 85). Lower values return more results with weaker data confidence',
      ),
    confidenceScoreMax: z
      .number()
      .optional()
      .describe('Maximum confidence score (default 99)'),
    titleSeniority: z
      .string()
      .optional()
      .describe(
        'Filter by management seniority code. Comma-separated for multiple. Values: C_EXECUTIVES, VP_EXECUTIVES, DIRECTOR, MANAGER, NON_MANAGER',
      ),
    personTitle: z
      .string()
      .optional()
      .describe(
        'Filter by job title text (e.g. "Software Engineer", "VP of Sales"). Matches current job title',
      ),
    fullName: z
      .string()
      .optional()
      .describe('Search by contact full name within the company'),
    contactRequirements: z
      .string()
      .optional()
      .describe(
        'Filter by required contact info availability. Comma-separated for multiple. Values: phone, email, mobile_phone, direct_phone',
      ),
    state: z
      .string()
      .optional()
      .describe('Filter by US state (e.g. "California")'),
    country: z
      .string()
      .optional()
      .describe('Filter by country (e.g. "United States")'),
    personWebReferencesURL: z
      .string()
      .optional()
      .describe(
        'Filter to contacts mentioned on a specific website domain (e.g. "techcrunch.com"). Only returns employees who have been mentioned or published on that site',
      ),
    isCertified: z
      .enum(['include', 'only', 'exclude'])
      .optional()
      .describe(
        'Certified companies filter. "include" = all contacts (default), "only" = only ZoomInfo-certified companies, "exclude" = exclude certified companies',
      ),
    emailAddress: z
      .string()
      .optional()
      .describe('Filter by specific email address'),
    hasBeenNotified: z
      .enum(['only', 'include'])
      .optional()
      .describe(
        'Filter by GDPR notice status. "only" = only contacts provided with notice, "include" = include all',
      ),
    currentCompanyStartDate: z
      .string()
      .optional()
      .describe(
        'Filter for new hires: ISO date string for minimum start date at current company. Requires another filter to be active',
      ),
    personCreationStartDate: z
      .string()
      .optional()
      .describe(
        'Filter for newly discovered contacts: ISO date string for minimum creation date in ZoomInfo database',
      ),
    school: z
      .string()
      .optional()
      .describe(
        'Filter by college/university name (e.g. "Stanford University")',
      ),
    zipCode: z
      .string()
      .optional()
      .describe('Filter by zip/postal code (e.g. "94105")'),
    pTag: z
      .string()
      .optional()
      .describe(
        'Filter to contacts in specific contact tag IDs. Comma-separated for multiple',
      ),
    cTag: z
      .string()
      .optional()
      .describe(
        'Filter to contacts at companies in specific company tag IDs. Comma-separated for multiple',
      ),
    excludePeopleTags: z
      .string()
      .optional()
      .describe(
        'Exclude contacts in specific contact tag IDs. Comma-separated for multiple. Requires another filter to be active',
      ),
    excludeCompanyTags: z
      .string()
      .optional()
      .describe(
        'Exclude contacts at companies in specific company tag IDs. Comma-separated for multiple. Requires another filter to be active',
      ),
    scoopTopics: z
      .string()
      .optional()
      .describe(
        'Filter by scoop/news signal topics. Comma-separated for multiple',
      ),
    scoopTypes: z
      .string()
      .optional()
      .describe(
        'Filter by scoop/news signal types. Comma-separated for multiple',
      ),
    excludeDefunctCompanies: z
      .boolean()
      .optional()
      .describe('Exclude defunct/inactive companies from results'),
    showOnlyUltimateParent: z
      .boolean()
      .optional()
      .describe(
        'When true, only show contacts at ultimate parent companies (not subsidiaries)',
      ),
    companyType: z
      .string()
      .optional()
      .describe(
        'Filter by company type (e.g. "Public", "Private", "Education", "Nonprofit", "Government")',
      ),
    industryKeywords: z
      .string()
      .optional()
      .describe(
        'Filter by industry keyword in company profile (e.g. "cybersecurity", "cloud computing")',
      ),
    pList: z
      .string()
      .optional()
      .describe(
        'Filter to contacts in specific contact list IDs. Comma-separated for multiple',
      ),
    cList: z
      .string()
      .optional()
      .describe(
        'Filter to contacts at companies in specific company list IDs. Comma-separated for multiple',
      ),
    excludeExportedPersons: z
      .boolean()
      .optional()
      .describe(
        'Exclude contacts the current user has previously exported from results. Useful for deduplication when prospecting',
      ),
    excludeOrgExportedPersons: z
      .boolean()
      .optional()
      .describe(
        'Exclude contacts previously exported by anyone in the organization. Broader deduplication than excludeExportedPersons',
      ),
    excludeExportedCompanies: z
      .boolean()
      .optional()
      .describe(
        'Exclude contacts at companies that have been exported. Filters out employees of already-exported companies',
      ),
  }),
  output: z.object({
    totalResults: z
      .number()
      .describe('Number of results returned (equals rpp)'),
    maxResults: z
      .number()
      .describe('Total matching employees across all pages'),
    data: z
      .array(ContactResultSchema)
      .describe(
        'Employee records. Key fields: personID, firstName, lastName, jobTitle, orgChartTier (1=C-suite, 2=VP, higher=lower seniority), orgChartJobFunction (department+jobFunction), email, phone, location, isMasked',
      ),
  }),
};
export type GetCompanyEmployeesInput = z.infer<
  typeof getCompanyEmployeesSchema.input
>;
export type GetCompanyEmployeesOutput = z.infer<
  typeof getCompanyEmployeesSchema.output
>;

// ============================================================================
// listSavedSearches
// ============================================================================

export const listSavedSearchesSchema = {
  name: 'listSavedSearches',
  description: 'List all saved searches for the current user.',
  notes:
    'Call getContext() first to verify login. The stored query params in each result can be used to reconstruct what filters were applied when the search was saved.',
  input: z.object({
    types: z
      .array(
        z.enum([
          'GROW_SAVED_SEARCH_PEOPLE',
          'GROW_SAVED_SEARCH_COMPANY',
          'DEFAULT_UNIFIED_SEARCH',
          'HOMEPAGE_FEED_SEARCH',
          'TRACKER_PEOPLE',
        ]),
      )
      .optional()
      .describe(
        'Filter by saved search type. GROW_SAVED_SEARCH_PEOPLE = contact searches, GROW_SAVED_SEARCH_COMPANY = company searches, DEFAULT_UNIFIED_SEARCH = unified searches, HOMEPAGE_FEED_SEARCH = homepage feed searches with alert subscriptions, TRACKER_PEOPLE = people tracker searches. Omit to return all types.',
      ),
  }),
  output: z.object({
    savedSearches: z
      .array(SavedSearchItemSchema)
      .describe('All saved searches matching the requested types'),
  }),
};
export type ListSavedSearchesInput = z.infer<
  typeof listSavedSearchesSchema.input
>;
export type ListSavedSearchesOutput = z.infer<
  typeof listSavedSearchesSchema.output
>;

// ============================================================================
// runSavedSearch
// ============================================================================

export const runSavedSearchSchema = {
  name: 'runSavedSearch',
  description:
    'Execute a saved search by ID and return the matching contacts or companies.',
  notes:
    'Call getContext() first to verify login. Call listSavedSearches() first to get available IDs and savedSearchType values. GROW_SAVED_SEARCH_PEOPLE returns contact records; GROW_SAVED_SEARCH_COMPANY returns company records.',
  input: z.object({
    savedSearchId: z
      .number()
      .describe('Saved search ID from listSavedSearches()'),
    page: z.number().optional().describe('Page number (1-indexed, default 1)'),
    rpp: z
      .number()
      .optional()
      .describe('Results per page (max 25, default 25)'),
    sortBy: z
      .enum([
        'Relevance',
        'LastName',
        'COMPANYNAME',
        'TITLE',
        'confidencescore',
        'name',
        'state',
        'EmployeeCount',
        'Revenue',
        'URL',
      ])
      .optional()
      .describe(
        'Override sort field. Person search values: Relevance, LastName, COMPANYNAME, TITLE, confidencescore. Company search values: Relevance, name, state, EmployeeCount, Revenue, URL. Overrides the sort stored with the saved search.',
      ),
    sortOrder: z
      .enum(['asc', 'desc'])
      .optional()
      .describe(
        'Override sort direction. Overrides the sort direction stored with the saved search.',
      ),
    useUnifiedSearch: z
      .boolean()
      .optional()
      .describe(
        'Enable unified search engine. When true, uses the newer ZoomInfo unified search backend for improved result quality.',
      ),
  }),
  output: z.object({
    savedSearchType: z
      .string()
      .describe(
        'Type of the executed saved search: GROW_SAVED_SEARCH_PEOPLE, GROW_SAVED_SEARCH_COMPANY, etc.',
      ),
    totalResults: z.number().describe('Number of records returned (≤ rpp)'),
    maxResults: z
      .number()
      .describe('Total records matching the saved search query'),
    data: z
      .array(
        z
          .object({})
          .catchall(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.null(),
              z.array(z.union([z.string(), z.number()])),
              z.record(
                z.string(),
                z.union([z.string(), z.number(), z.boolean(), z.null()]),
              ),
            ]),
          ),
      )
      .describe(
        'Search result records. For GROW_SAVED_SEARCH_PEOPLE: same fields as searchContacts data (personID, name, email, companyName, etc.). For GROW_SAVED_SEARCH_COMPANY: same fields as searchCompanies data (companyID, companyName, employees, etc.).',
      ),
  }),
};
export type RunSavedSearchInput = z.infer<typeof runSavedSearchSchema.input>;
export type RunSavedSearchOutput = z.infer<typeof runSavedSearchSchema.output>;

// ============================================================================
// listLists
// ============================================================================

export const ListUploadItemSchema = z.object({
  id: z.number().describe('List ID'),
  name: z.string().describe('List name'),
  count: z
    .number()
    .nullable()
    .optional()
    .describe('Number of records in the list'),
  type: z
    .string()
    .nullable()
    .optional()
    .describe('List type: CONTACT or COMPANY'),
  creationDate: z
    .string()
    .nullable()
    .optional()
    .describe('Creation date string'),
  status: z.string().nullable().optional().describe('List processing status'),
});

export const listListsSchema = {
  name: 'listLists',
  description:
    'List available upload lists (CSV imports). Returns lists created via the Upload Lists feature.',
  notes:
    'Call getContext() first to verify login. Lists are created by uploading CSV files, not programmatically. If the user has no upload lists, returns an empty array. Use tags for programmatic contact/company organization instead. Use rowSize + startRow for pagination (startRow is 0-indexed row offset: page 2 of 25 = startRow 25).',
  input: z.object({
    rowSize: z
      .number()
      .optional()
      .describe('Number of lists per page (default 25)'),
    startRow: z
      .number()
      .optional()
      .describe(
        'Starting row index for pagination (0-indexed, default 0). Page 2 of 25 results = startRow 25',
      ),
    jobType: z
      .array(
        z.enum([
          'DOZI_MARKETING_EXCLUSION_LIST_COMPANY',
          'DOZI_DAAS_WORKBOOK_PERSON',
          'DOZI_DAAS_WORKBOOK_COMPANY',
          'DOZI_ACCOUNT_ASSIGNMENT',
          'DOZI_ADMIN_ACCOUNT_ASSIGNMENT',
        ]),
      )
      .optional()
      .describe(
        'Filter by list job types. Defaults to all types. DOZI_DAAS_WORKBOOK_PERSON = uploaded contact lists, DOZI_DAAS_WORKBOOK_COMPANY = uploaded company lists, DOZI_MARKETING_EXCLUSION_LIST_COMPANY = company exclusion lists, DOZI_ACCOUNT_ASSIGNMENT / DOZI_ADMIN_ACCOUNT_ASSIGNMENT = account assignment lists',
      ),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Sort field name (default "createDate"). Use "listName" to sort alphabetically by list name',
      ),
    sortDescending: z
      .boolean()
      .optional()
      .describe(
        'Sort direction: true = descending / newest-first (default), false = ascending / oldest-first',
      ),
  }),
  output: z.object({
    lists: z
      .array(ListUploadItemSchema)
      .describe('Available upload lists with id, name, count, and type'),
    total: z
      .number()
      .optional()
      .describe('Total number of lists matching the current filters'),
    totalWithFilter: z
      .number()
      .optional()
      .describe(
        'Total number of lists with active filters applied (may differ from total when filters are set)',
      ),
  }),
};
export type ListListsInput = z.infer<typeof listListsSchema.input>;
export type ListListsOutput = z.infer<typeof listListsSchema.output>;

// ============================================================================
// tagContacts
// ============================================================================

export const tagContactsSchema = {
  name: 'tagContacts',
  description:
    'Add contacts (person IDs) to an existing tag. Use listTags() to find tag IDs and searchContacts()/getContact() to find person IDs.',
  notes:
    'Call getContext() first to verify login. Public tags (type PUBLIC_CONTACT) require setting isPublicTag: true. Private tags (type CONTACT) use the default isPublicTag: false. Recruiter tags (type RECRUITER_CONTACT) use the recruiterTagIds param instead of tagId. Person IDs can be negative (this is normal in ZoomInfo). IMPORTANT: Only use CONTACT and PUBLIC_CONTACT tag types; passing a COMPANY or PUBLIC_COMPANY tagId will return a 500 error. Use tagCompanies() for COMPANY tags.',
  input: z.object({
    tagId: z.number().describe('The tag ID to add contacts to'),
    personIds: z
      .array(z.number())
      .describe('Array of person IDs to add to the tag (can be negative)'),
    isPublicTag: z
      .boolean()
      .optional()
      .describe(
        'Set to true when tagging with a public tag (type PUBLIC_CONTACT). Defaults to false for private tags (type CONTACT)',
      ),
    recruiterTagIds: z
      .array(z.number())
      .optional()
      .describe(
        'Array of RECRUITER_CONTACT tag IDs to tag the contacts with. Use this instead of tagId when working with recruiter tags (type RECRUITER_CONTACT)',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('True when contacts were tagged successfully'),
    taggedCount: z
      .number()
      .describe(
        'Number of person IDs submitted for tagging (equals personIds.length). The ZoomInfo API returns only {success:true}; this count reflects the input, not a per-contact confirmation from the server',
      ),
  }),
};
export type TagContactsInput = z.infer<typeof tagContactsSchema.input>;
export type TagContactsOutput = z.infer<typeof tagContactsSchema.output>;

// ============================================================================
// tagCompanies
// ============================================================================

export const tagCompaniesSchema = {
  name: 'tagCompanies',
  description:
    'Add companies (company IDs) to an existing tag. Use listTags() to find tag IDs and searchCompanies()/getCompany() to find company IDs.',
  notes:
    'Call getContext() first to verify login. Public tags (type PUBLIC_COMPANY) require setting isPublicTag: true. Private tags (type COMPANY) use the default isPublicTag: false. Use tagIds to tag companies to multiple private tags in a single request.',
  input: z.object({
    tagId: z.number().describe('The tag ID to add companies to'),
    companyIds: z
      .array(z.number())
      .describe('Array of company IDs to add to the tag'),
    isPublicTag: z
      .boolean()
      .optional()
      .describe(
        'Set to true when tagging with a public tag (type PUBLIC_COMPANY). Defaults to false for private tags (type COMPANY)',
      ),
    tagIds: z
      .array(z.number())
      .optional()
      .describe(
        'Additional private COMPANY tag IDs to tag the companies with in the same request. Merged with tagId into a single API call. Use when you need to add companies to multiple private tags at once.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('True when companies were tagged successfully'),
    taggedCount: z.number().describe('Number of companies tagged'),
  }),
};
export type TagCompaniesInput = z.infer<typeof tagCompaniesSchema.input>;
export type TagCompaniesOutput = z.infer<typeof tagCompaniesSchema.output>;

// ============================================================================
// untagContacts
// ============================================================================

export const untagContactsSchema = {
  name: 'untagContacts',
  description:
    'Remove contacts (person IDs) from an existing tag. Use listTags() to find tag IDs and searchContacts()/getContact() to find person IDs.',
  notes:
    'Call getContext() first to verify login. Public tags (type PUBLIC_CONTACT) require setting isPublicTag: true. Private tags (type CONTACT) use the default isPublicTag: false. Person IDs can be negative (this is normal in ZoomInfo). Use recruiterTagIds instead of tagId when working with RECRUITER_CONTACT tags.',
  input: z.object({
    tagId: z.number().describe('The tag ID to remove contacts from'),
    personIds: z
      .array(z.number())
      .describe('Array of person IDs to remove from the tag (can be negative)'),
    isPublicTag: z
      .boolean()
      .optional()
      .describe(
        'Set to true when untagging from a public tag (type PUBLIC_CONTACT). Defaults to false for private tags (type CONTACT)',
      ),
    recruiterTagIds: z
      .array(z.number())
      .optional()
      .describe(
        'Array of RECRUITER_CONTACT tag IDs to remove the contacts from. Use this instead of tagId when working with recruiter tags (type RECRUITER_CONTACT)',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('True when contacts were untagged successfully'),
    untaggedCount: z
      .number()
      .describe(
        'Number of person IDs submitted for untagging (equals personIds.length). The ZoomInfo API returns only {success:true}; this count reflects the input, not a per-contact confirmation from the server',
      ),
  }),
};
export type UntagContactsInput = z.infer<typeof untagContactsSchema.input>;
export type UntagContactsOutput = z.infer<typeof untagContactsSchema.output>;

// ============================================================================
// untagCompanies
// ============================================================================

export const untagCompaniesSchema = {
  name: 'untagCompanies',
  description:
    'Remove companies (company IDs) from an existing tag. Use listTags() to find tag IDs and searchCompanies()/getCompany() to find company IDs.',
  notes:
    'Call getContext() first to verify login. Works for both private (COMPANY) and public (PUBLIC_COMPANY) tags; the tag type is detected automatically so you do not need to specify it. Use tagIds to untag from multiple private tags in a single request.',
  input: z.object({
    tagId: z.number().describe('The tag ID to remove companies from'),
    companyIds: z
      .array(z.number())
      .describe('Array of company IDs to remove from the tag'),
    tagIds: z
      .array(z.number())
      .optional()
      .describe(
        'Additional private COMPANY tag IDs to untag the companies from in the same request. Merged with tagId into a single API call. Use when you need to remove companies from multiple private tags at once.',
      ),
    recruiterTagIds: z
      .array(z.number())
      .optional()
      .describe(
        'Array of RECRUITER_CONTACT tag IDs to untag the companies from. Use this instead of tagId when working with recruiter tags.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('True when companies were untagged successfully'),
    untaggedCount: z
      .number()
      .describe(
        'Number of company IDs submitted for untagging (equals companyIds.length). The ZoomInfo API returns only {success:true}; this count reflects the input, not a per-company confirmation from the server',
      ),
  }),
};
export type UntagCompaniesInput = z.infer<typeof untagCompaniesSchema.input>;
export type UntagCompaniesOutput = z.infer<typeof untagCompaniesSchema.output>;

// ============================================================================
// getScoops
// ============================================================================

export const ScoopItemSchema = z.object({
  id: z.string().nullable().optional().describe('Scoop ID'),
  types: z
    .array(z.string())
    .nullable()
    .optional()
    .describe('Scoop type names (e.g. "New Hire", "Funding")'),
  topics: z
    .array(z.string())
    .nullable()
    .optional()
    .describe('Scoop topic names'),
  description: z
    .string()
    .nullable()
    .optional()
    .describe('Summary of the scoop event'),
  company: z
    .object({
      companyID: z.number().nullable().optional(),
      companyName: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const getScoopsSchema = {
  name: 'getScoops',
  description:
    'Get structured buying signals (Scoops) for a company. Scoops are intelligence events like new hires, expansions, funding, and technology adoption (distinct from news articles).',
  notes:
    'Call getContext() first to verify login. Requires a ZoomInfo Premium plan. A 403 error means the account lacks the required plan, NOT a bad request. Use getCompanyNews() for news articles, which works on all plan levels.',
  input: z.object({
    companyId: z.number().describe('ZoomInfo company ID'),
    page: z
      .number()
      .min(1)
      .optional()
      .default(1)
      .describe('Page number (1-indexed)'),
    rpp: z
      .number()
      .min(1)
      .max(25)
      .optional()
      .default(25)
      .describe('Results per page (1-25)'),
    scoopTypes: z
      .string()
      .optional()
      .describe(
        'Comma-separated scoop type IDs. Financial Scoops: 1=Investment, 2=Funding, 3=Revenue, 4=Valuation, 5=PrivateEquity. General Business: 6=Partnership, 7=Expansion, 8=NewOffering, 9=Acquisition, 10=Relocation. Personnel: 11=NewHire, 12=Promotion, 13=Departure, 14=BoardChange, 15=NewContact, 16=ConfirmedContact, 17=JobPosting, 18=ExecutiveChange, 19=Other. Opportunity: 20=Initiative, 21=PainPoint. PersonNews: 22=Award, 23=Publication.',
      ),
    scoopTopics: z
      .string()
      .optional()
      .describe(
        'Comma-separated scoop topic IDs. Emerging Tech: 1001=AI/ML, 1002=Cloud, 1003=Cybersecurity, 1004=IoT. Marketing: 2001=DigitalMarketing, 2002=ContentMarketing. Project Management: 3001=Agile, 3002=ProjectManagement.',
      ),
    scoopDepartments: z
      .string()
      .optional()
      .describe(
        'Comma-separated department IDs: 1=IT, 2=Finance, 3=Marketing, 4=Engineering, 5=Sales, 7=HR, 8=CSuite, 9=Legal, 10=Operations, 11=Other.',
      ),
    sortBy: z.string().optional().describe('Sort field (e.g. "date")'),
    sortOrder: z
      .enum(['asc', 'desc', 'ASC', 'DESC'])
      .optional()
      .describe('Sort direction. Defaults to "desc" (newest first).'),
    scoopStartDate: z
      .string()
      .optional()
      .describe(
        'Start date filter for scoops (YYYY-MM-DD). Defaults to 6 months ago when scoopTypes is set.',
      ),
    scoopEndDate: z
      .string()
      .optional()
      .describe(
        'End date filter for scoops (YYYY-MM-DD). Use with scoopStartDate for date range filtering. Defaults to today when scoopTypes is set.',
      ),
    scoopDesc: z
      .string()
      .optional()
      .describe(
        'Text search within scoop descriptions. Filters to scoops whose description contains this string.',
      ),
    isSubscribed: z
      .boolean()
      .optional()
      .describe(
        'Pass true to signal the user has an active scoops subscription. The JS bundle always sends true for premium users. Omit for standard accounts.',
      ),
    updatedSinceCreation: z
      .boolean()
      .optional()
      .describe(
        'When true, filters to scoops that have been updated since their original publication date. Sent to the API as the string "true" or "false". Corresponds to the "Updated Scoops" filter in the ZoomInfo UI.',
      ),
  }),
  output: z.object({
    scoops: z.array(ScoopItemSchema).describe('Scoop events for the company'),
    totalResults: z.number().describe('Number of scoops returned'),
    maxResults: z.number().describe('Total matching scoops'),
  }),
};
export type GetScoopsInput = z.infer<typeof getScoopsSchema.input>;
export type GetScoopsOutput = z.infer<typeof getScoopsSchema.output>;

// ============================================================================
// getCompanyTechnographics
// ============================================================================

export const TechnographicItemSchema = z.object({
  technologyId: z.number().describe('ZoomInfo technology ID'),
  technologyName: z
    .string()
    .nullable()
    .optional()
    .describe('Technology product name (e.g. "Salesforce", "AWS")'),
  activity: z
    .string()
    .nullable()
    .optional()
    .describe('Activity type: "ADD" (newly adopted) or "DROP" (discontinued)'),
  date: z
    .string()
    .nullable()
    .optional()
    .describe('Date of the technology activity (ISO 8601)'),
  categoryParent: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Top-level technology category (e.g. "E-Commerce", "Marketing", "CRM")',
    ),
  category: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Specific technology sub-category (e.g. "E-Commerce Platforms", "Marketing Automation")',
    ),
  vendor: z
    .string()
    .nullable()
    .optional()
    .describe('Technology vendor/company name (e.g. "Salesforce, Inc.")'),
  website: z
    .string()
    .nullable()
    .optional()
    .describe('Technology product website URL'),
  logo: z
    .string()
    .nullable()
    .optional()
    .describe('Technology product logo URL from Cloudinary CDN'),
  domain: z
    .string()
    .nullable()
    .optional()
    .describe('Technology product domain (e.g. "salesforce.com")'),
  description: z
    .string()
    .nullable()
    .optional()
    .describe('Description of the technology product'),
  attribute: z
    .string()
    .nullable()
    .optional()
    .describe(
      'ZoomInfo internal taxonomy attribute code (e.g. "368.352.120248775")',
    ),
  createdTime: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Timestamp when this technology record was created in ZoomInfo (e.g. "2019-03-08 21:06:15+00:00")',
    ),
  modifiedTime: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Timestamp when this technology record was last modified in ZoomInfo (e.g. "2025-04-29 19:23:58+00:00")',
    ),
});

export const getCompanyTechnographicsSchema = {
  name: 'getCompanyTechnographics',
  description:
    'Get the technology stack installed at a company, including recently added and dropped technologies.',
  notes:
    'Call getContext() first to verify login. Requires a ZoomInfo Premium plan. Returns an empty technologies array on standard accounts.',
  input: z.object({
    companyId: z.number().describe('ZoomInfo company ID'),
  }),
  output: z.object({
    technologies: z
      .array(TechnographicItemSchema)
      .describe('Technology install/drop events for the company'),
  }),
};
export type GetCompanyTechnographicsInput = z.infer<
  typeof getCompanyTechnographicsSchema.input
>;
export type GetCompanyTechnographicsOutput = z.infer<
  typeof getCompanyTechnographicsSchema.output
>;

// ============================================================================
// deleteSavedSearch
// ============================================================================

export const deleteSavedSearchSchema = {
  name: 'deleteSavedSearch',
  description: 'Delete a saved search by its ID.',
  notes:
    'Call getContext() first to verify login. Use listSavedSearches() to find the savedSearchId. Works for all saved search types.',
  input: z.object({
    savedSearchId: z
      .number()
      .describe('ID of the saved search to delete (from listSavedSearches())'),
  }),
  output: z.object({
    success: z.boolean().describe('True when the delete succeeded'),
    savedSearchId: z.number().describe('The deleted saved search ID'),
  }),
};
export type DeleteSavedSearchInput = z.infer<
  typeof deleteSavedSearchSchema.input
>;
export type DeleteSavedSearchOutput = z.infer<
  typeof deleteSavedSearchSchema.output
>;

// ============================================================================
// getContactTags
// ============================================================================

const EntityTagDetailSchema = z.object({
  tagId: z.number().describe('ZoomInfo tag ID'),
  tagName: z.string().describe('Tag display name'),
  type: z
    .string()
    .describe(
      'Tag type (e.g. CONTACT, PUBLIC_CONTACT, COMPANY, PUBLIC_COMPANY)',
    ),
  creationDate: z.string().nullable().optional(),
  lastInteractedDate: z.string().nullable().optional(),
});

export const getContactTagsSchema = {
  name: 'getContactTags',
  description:
    'Get the tags applied to one or more contacts (person IDs). Returns a map from personId to its list of tags.',
  notes:
    'Call getContext() first to verify login. Use searchContacts() or getContact() to get person IDs. Person IDs can be negative. Contacts with no tags are omitted from the tagsByPersonId map.',
  input: z.object({
    personIds: z
      .array(z.number())
      .min(1)
      .describe('Person IDs to look up tags for. Can include negative values.'),
  }),
  output: z.object({
    tagsByPersonId: z
      .record(z.string(), z.array(EntityTagDetailSchema))
      .describe(
        'Map from personId (string) to array of tags applied to that contact. Contacts with no tags are not included.',
      ),
  }),
};
export type GetContactTagsInput = z.infer<typeof getContactTagsSchema.input>;
export type GetContactTagsOutput = z.infer<typeof getContactTagsSchema.output>;

// ============================================================================
// getCompanyTags
// ============================================================================

export const getCompanyTagsSchema = {
  name: 'getCompanyTags',
  description:
    'Get the tags applied to one or more companies. Returns a map from companyId to its list of tags.',
  notes:
    'Call getContext() first to verify login. Use searchCompanies() or getCompany() to get company IDs. Companies with no tags are omitted from the tagsByCompanyId map.',
  input: z.object({
    companyIds: z
      .array(z.number())
      .min(1)
      .describe('Company IDs to look up tags for.'),
  }),
  output: z.object({
    tagsByCompanyId: z
      .record(z.string(), z.array(EntityTagDetailSchema))
      .describe(
        'Map from companyId (string) to array of tags applied to that company. Companies with no tags are not included.',
      ),
  }),
};
export type GetCompanyTagsInput = z.infer<typeof getCompanyTagsSchema.input>;
export type GetCompanyTagsOutput = z.infer<typeof getCompanyTagsSchema.output>;

// ============================================================================
// getIcpConfig
// ============================================================================

export const getIcpConfigSchema = {
  name: 'getIcpConfig',
  description:
    'Get the ideal customer profile (ICP) configuration for the current account, including whether ICP scoring is enabled in search results.',
  notes: 'Call getContext() first to verify login.',
  input: z.object({}),
  output: z.object({
    isIcpScoreInSearchEnabled: z
      .boolean()
      .describe('True when ICP scores are shown alongside search results'),
    raw: z
      .record(z.string(), z.unknown())
      .describe('Full ICP config attributes from the API'),
  }),
};
export type GetIcpConfigInput = z.infer<typeof getIcpConfigSchema.input>;
export type GetIcpConfigOutput = z.infer<typeof getIcpConfigSchema.output>;

// ============================================================================
// listWebsightsDomains
// ============================================================================

const WebsightsDomainSchema = z.object({
  id: z.string().describe('Internal Websights domain record ID'),
  domain: z.string().describe('Domain being tracked (e.g. "vallum.ai")'),
  verified: z
    .boolean()
    .nullable()
    .optional()
    .describe('True when domain ownership has been verified'),
  active: z
    .boolean()
    .nullable()
    .optional()
    .describe('True when tracking is currently active'),
  gaEnable: z
    .boolean()
    .nullable()
    .optional()
    .describe('True when Google Analytics integration is enabled'),
});

export const listWebsightsDomainsSchema = {
  name: 'listWebsightsDomains',
  description:
    'List domains tracked by ZoomInfo Websights (website visitor de-anonymization). Use to check which of your own domains have tracking configured.',
  notes:
    'Call getContext() first to verify login. Returns the domains the current account has added to Websights; this is your own tracked domains, not arbitrary company lookups. Requires Websights access on the account.',
  input: z.object({}),
  output: z.object({
    domains: z
      .array(WebsightsDomainSchema)
      .describe('Domains tracked by Websights for this account'),
  }),
};
export type ListWebsightsDomainsInput = z.infer<
  typeof listWebsightsDomainsSchema.input
>;
export type ListWebsightsDomainsOutput = z.infer<
  typeof listWebsightsDomainsSchema.output
>;

// ============================================================================
// allSchemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  searchContactsSchema,
  createTagSchema,
  updateTagSchema,
  searchCompaniesSchema,
  listTagsSchema,
  deleteTagSchema,
  getCreditsSchema,
  getCompanyNewsSchema,
  getContactSchema,
  getCompanySchema,
  getCompanyEmployeesSchema,
  listSavedSearchesSchema,
  runSavedSearchSchema,
  deleteSavedSearchSchema,
  listListsSchema,
  tagContactsSchema,
  tagCompaniesSchema,
  untagContactsSchema,
  untagCompaniesSchema,
  getContactTagsSchema,
  getCompanyTagsSchema,
  getScoopsSchema,
  getCompanyTechnographicsSchema,
  getIcpConfigSchema,
  listWebsightsDomainsSchema,
];
