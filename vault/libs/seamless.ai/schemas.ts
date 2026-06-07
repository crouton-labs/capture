import { z } from 'zod';

export const libraryDescription =
  'Seamless.AI B2B contact search and sales intelligence via internal APIs';

export const libraryIcon = '/icons/libs/seamless-ai.png';
export const loginUrl = 'https://login.seamless.ai';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://login.seamless.ai\`
2. Call \`getContext()\` to verify login and get orgId + credit balances
3. Call other functions as needed; no additional auth params required (cookies handle auth)

## Pagination

Seamless.AI uses page-based pagination: \`page\` (0-indexed in API) and \`perPage\` (max 50).

## Credit System

Seamless.AI uses multiple credit pools:
- **Standard credits**: For researching/enriching contacts (the "Find" action)
- **Search credits**: For running contact/company searches (consumed per search, not per result)
- **Universal credits**: Bonus credits usable across operations
- **Company save credits**: For saving companies

Call \`getContext()\` to check current balances before credit-consuming operations.

## ID Types

- **searchResultId**: UUID identifying a contact in search results (e.g., \`d7125f51-4b50-3db7-b95c-0c6a3f1e81f0\`). Used only as input to researchContact.
- **contactSearchId**: Numeric integer for a saved contact search session. Returned by searchContacts, required by researchContact.
- **contact ID**: Numeric string (e.g., \`"5788426795"\`) assigned after research. Used for list operations and getContact.
- **orgId**: Numeric string for the organization (needed for org-scoped endpoints).

## Key Concepts

- Searches return unresearched contacts (name, title, company visible but no emails/phones)
- To get verified emails and phones, you must "research" a contact (costs 1 universal credit each)
- Lists are called "tags" in the API; a single list can hold both contacts and companies
`;

// ============================================================================
// Shared types
// ============================================================================

const CreditPoolSchema = z.object({
  key: z.number().describe('Credit pool key identifier'),
  label: z.string().describe('Human-readable credit pool name'),
  credits: z.number().describe('Total credits allocated'),
  creditsRemaining: z.number().describe('Credits remaining in this pool'),
  searchCredits: z.number().describe('Total search credits'),
  searchCreditsRemaining: z.number().describe('Search credits remaining'),
  companySaveCredits: z.number().describe('Company save credits allocated'),
  companySaveCreditsRemaining: z
    .number()
    .describe('Company save credits remaining'),
  licenseType: z
    .string()
    .nullable()
    .describe('License type: free, pro, enterprise'),
  licenseStatus: z
    .string()
    .nullable()
    .describe('License status: trial, active, etc.'),
});

export type CreditPool = z.infer<typeof CreditPoolSchema>;

const CreditsSchema = z.object({
  standard: CreditPoolSchema.describe(
    'Standard credit pool: for contact research/enrichment',
  ),
  intent: CreditPoolSchema.describe(
    'Intent credit pool: for buyer intent signals',
  ),
  universal: CreditPoolSchema.describe(
    'Universal credit pool: bonus credits usable across operations',
  ),
});

export type Credits = z.infer<typeof CreditsSchema>;

const SearchResultSchema = z.object({
  searchResultId: z
    .string()
    .describe('UUID identifying this contact in search results'),
  contactSearchId: z.number().describe('Numeric ID of the search session'),
  name: z.string().describe('Full name of the contact'),
  title: z.string().describe('Job title'),
  company: z.string().describe('Company name'),
  domain: z.string().describe('Company domain'),
  city: z.string().describe('Contact city'),
  state: z.string().describe('Contact state'),
  country: z.string().describe('Contact country'),
  companyCity: z.string().describe('Company headquarters city'),
  companyState: z.string().describe('Company headquarters state'),
  companyCountry: z.string().describe('Company headquarters country'),
  department: z.string().describe('Department (e.g., IT, Sales, Marketing)'),
  seniority: z.string().describe('Seniority level'),
  industry: z.string().describe('Primary industry'),
  industries: z
    .array(z.string())
    .describe('All industries associated with the company'),
  employeeCount: z.number().describe('Company employee count'),
  liUrl: z.string().describe('LinkedIn profile URL'),
  companyRevenueRange: z.string().describe('Company revenue range'),
  companyFundingTotal: z.string().describe('Total company funding amount'),
  companyLatestFundingDate: z.string().describe('Date of latest funding round'),
  companyLatestFundingClassifications: z
    .string()
    .describe('Latest funding round type'),
  sicCode: z.string().describe('SIC industry code'),
  sicDesc: z.string().describe('SIC code description'),
  companyFoundedOn: z.string().describe('Company founding date'),
  titleStartedAt: z.string().describe('When contact started current title'),
  startedAtCurrentCompany: z
    .string()
    .describe('When contact joined current company'),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;

const TagSchema = z.object({
  id: z.string().describe('Tag/list ID'),
  name: z.string().describe('Tag/list name'),
  contactCount: z
    .number()
    .optional()
    .describe('Number of contacts in this list'),
});

export type Tag = z.infer<typeof TagSchema>;

// ============================================================================
// getContext
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Get current user profile, org ID, and credit balances. Call this first to verify the user is logged in and to get orgId needed for org-scoped endpoints.',
  notes: '',
  input: z.object({}),
  output: z.object({
    userId: z.string().describe('Numeric user ID'),
    orgId: z.string().describe('Organization ID for org-scoped API calls'),
    firstName: z.string().describe('User first name'),
    lastName: z.string().describe('User last name'),
    fullName: z.string().describe('User full name'),
    email: z.string().describe('User email (username field)'),
    company: z.string().describe('Company name'),
    title: z.string().describe('Job title'),
    orgRole: z.string().describe('Role in org: owner, admin, member'),
    isOrgAdmin: z.boolean().describe('Whether user is an org admin'),
    isPaidOrg: z.boolean().describe('Whether org is on a paid plan'),
    credits: CreditsSchema.describe('Credit balances across all pools'),
  }),
};

export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// searchContacts
// ============================================================================

export const searchContactsSchema = {
  name: 'searchContacts',
  description:
    'Search the Seamless.AI contact database (1.3B+ contacts) with rich firmographic filters. Returns unresearched contacts; to get verified emails and phones, call researchContact with the searchResultId. Each search consumes 1 search credit.',
  notes:
    'Results do NOT include emails or phone numbers. You must call researchContact on individual searchResultIds to get verified contact info (costs 1 universal credit each).',
  input: z.object({
    companies: z
      .array(z.string())
      .optional()
      .describe('Filter by company names'),
    companiesExactMatch: z
      .boolean()
      .optional()
      .describe('Exact match for company names (default false)'),
    titles: z
      .array(z.string())
      .optional()
      .describe(
        'Filter by job titles. Use multiple variations (e.g., "VP Sales", "Vice President of Sales")',
      ),
    titlesExactMatch: z
      .boolean()
      .optional()
      .describe('Exact match for titles (default false)'),
    seniorities: z
      .array(z.string())
      .optional()
      .describe(
        'Filter by seniority: vp, director, manager, c_suite, partner, owner, senior, entry',
      ),
    departments: z
      .array(z.string())
      .optional()
      .describe(
        'Filter by department: sales, marketing, engineering, finance, operations, hr, legal, it, support, executive',
      ),
    industries: z
      .array(z.string())
      .optional()
      .describe(
        'Filter by industry name. Use listIndustries to discover valid values.',
      ),
    locations: z
      .array(z.string())
      .optional()
      .describe('Filter by location (city, state, or country)'),
    employeeSizes: z
      .array(z.string())
      .optional()
      .describe(
        'Filter by company size. Valid values: "0 - 1 (Self-employed)", "2 - 10", "11 - 50", "51 - 200", "201 - 500", "501 - 1,000", "1,001 - 5,000", "5,001 - 10,000", "10,001+"',
      ),
    estimatedRevenues: z
      .array(z.string())
      .optional()
      .describe(
        'Filter by estimated revenue. Valid values: "$0 - $100K", "$100K - $1M", "$1M - $5M", "$5M - $20M", "$20M - $50M", "$50M - $100M", "$100M - $500M", "$500M - $1B", "$1B+"',
      ),
    technologies: z
      .array(z.string())
      .optional()
      .describe('Filter by technologies used by the company'),
    keywords: z
      .array(z.string())
      .optional()
      .describe('Filter by keywords in contact profile'),
    keywordsIsOr: z
      .boolean()
      .optional()
      .describe('Use OR logic for keywords (default AND)'),
    formerCompanies: z
      .array(z.string())
      .optional()
      .describe('Filter by former company names'),
    jobChangesType: z
      .string()
      .nullable()
      .optional()
      .describe('Filter by job change type'),
    jobChangesDayRange: z
      .number()
      .nullable()
      .optional()
      .describe('Job changes within N days'),
    page: z.number().optional().describe('Page number (0-indexed). Default 0.'),
    perPage: z
      .number()
      .optional()
      .describe('Results per page (max 50). Default 50.'),
  }),
  output: z.object({
    contactSearchId: z
      .number()
      .describe('ID of this search session, used for pagination'),
    isMore: z
      .boolean()
      .describe('Whether more results are available on the next page'),
    results: z
      .array(SearchResultSchema)
      .describe('Array of matching contacts (without email/phone)'),
    totalResults: z
      .number()
      .optional()
      .describe('Total matching contacts across all pages'),
  }),
};

export type SearchContactsInput = z.infer<typeof searchContactsSchema.input>;
export type SearchContactsOutput = z.infer<typeof searchContactsSchema.output>;

// ============================================================================
// researchContact
// ============================================================================

export const researchContactSchema = {
  name: 'researchContact',
  description:
    'Research/enrich a single contact to get verified email addresses and phone numbers. This is the "Find" button action. Costs 1 universal credit per contact. Research is async; the function polls until enrichment completes (typically 3-5 seconds).',
  notes:
    'Consumes 1 universal credit. Check credit balance via getContext() first. The searchResultId and contactSearchId both come from searchContacts results. The returned contact ID is a new numeric ID (different from the search UUID); use this ID for addContactsToList.',
  input: z.object({
    searchResultId: z
      .string()
      .describe(
        'UUID of the contact from searchContacts results (the searchResultId field)',
      ),
    contactSearchId: z
      .number()
      .describe(
        'The contactSearchId from the search session that found this contact',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the research was successful'),
    contact: z
      .object({
        id: z.string().describe('Contact ID after research'),
        name: z.string().describe('Full name'),
        title: z.string().describe('Job title'),
        company: z.string().describe('Company name'),
        emails: z
          .array(
            z.object({
              email: z.string().describe('Email address'),
              type: z.string().describe('Email type: work, personal, etc.'),
              isValidated: z
                .boolean()
                .optional()
                .describe('Whether email has been validated'),
            }),
          )
          .describe('Verified email addresses'),
        phones: z
          .array(
            z.object({
              number: z.string().describe('Phone number'),
              type: z.string().describe('Phone type: mobile, direct, company'),
            }),
          )
          .describe('Phone numbers found'),
        linkedInUrl: z.string().optional().describe('LinkedIn profile URL'),
      })
      .describe('Enriched contact data with verified emails and phones'),
  }),
};

export type ResearchContactInput = z.infer<typeof researchContactSchema.input>;
export type ResearchContactOutput = z.infer<
  typeof researchContactSchema.output
>;

// ============================================================================
// listContactLists
// ============================================================================

export const listContactListsSchema = {
  name: 'listContactLists',
  description:
    'Get all contact lists (tags) belonging to the current user. Lists are used to organize saved contacts.',
  notes:
    'Lists (tags) are shared between contacts and companies. The returned id is used in addContactsToList, addCompaniesToList, and removeContactsFromList.',
  input: z.object({}),
  output: z.object({
    lists: z.array(TagSchema).describe('All contact lists'),
  }),
};

export type ListContactListsInput = z.infer<
  typeof listContactListsSchema.input
>;
export type ListContactListsOutput = z.infer<
  typeof listContactListsSchema.output
>;

// ============================================================================
// createContactList
// ============================================================================

export const createContactListSchema = {
  name: 'createContactList',
  description: 'Create a new contact list (tag) for organizing contacts.',
  notes:
    'Lists (tags) are shared between contacts and companies; a single list can hold both. The returned id is used in addContactsToList and addCompaniesToList.',
  input: z.object({
    name: z.string().describe('Name for the new contact list'),
  }),
  output: z.object({
    id: z.string().describe('ID of the created list'),
    name: z.string().describe('Name of the created list'),
  }),
};

export type CreateContactListInput = z.infer<
  typeof createContactListSchema.input
>;
export type CreateContactListOutput = z.infer<
  typeof createContactListSchema.output
>;

// ============================================================================
// addContactsToList
// ============================================================================

export const addContactsToListSchema = {
  name: 'addContactsToList',
  description:
    'Add saved contacts to an existing list. Contacts must be researched first via researchContact.',
  notes:
    'Use the numeric contact ID returned by researchContact (e.g., "5788426795"), NOT the UUID searchResultId from searchContacts. Contacts must be researched before they can be added to a list.',
  input: z.object({
    listId: z
      .string()
      .describe(
        'ID of the target list (from listContactLists or createContactList)',
      ),
    contactIds: z
      .array(z.string())
      .describe('Array of contact IDs to add to the list'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether contacts were added successfully'),
    addedCount: z.number().describe('Number of contacts added'),
  }),
};

export type AddContactsToListInput = z.infer<
  typeof addContactsToListSchema.input
>;
export type AddContactsToListOutput = z.infer<
  typeof addContactsToListSchema.output
>;

// ============================================================================
// bulkResearchContacts
// ============================================================================

const EnrichedContactSchema = z.object({
  id: z.string().describe('Numeric contact ID after research'),
  name: z.string().describe('Full name'),
  title: z.string().describe('Job title'),
  company: z.string().describe('Company name'),
  emails: z
    .array(
      z.object({
        email: z.string().describe('Email address'),
        type: z.string().describe('Email type: work, personal'),
        isValidated: z
          .boolean()
          .optional()
          .describe('Whether email has been validated'),
      }),
    )
    .describe('Verified email addresses'),
  phones: z
    .array(
      z.object({
        number: z.string().describe('Phone number'),
        type: z.string().describe('Phone type: direct, company'),
      }),
    )
    .describe('Phone numbers found'),
  linkedInUrl: z.string().optional().describe('LinkedIn profile URL'),
});

export const bulkResearchContactsSchema = {
  name: 'bulkResearchContacts',
  description:
    'Research/enrich multiple contacts at once to get verified emails and phone numbers. Sends a single batch request and polls until all contacts are enriched. Costs 1 universal credit per contact.',
  notes:
    'Consumes 1 universal credit per contact. Check credit balance via getContext() first. All contacts must come from the same searchContacts session (same contactSearchId). Max ~10 contacts per batch recommended. Returns only contacts that finished enriching within the timeout.',
  input: z.object({
    contacts: z
      .array(
        z.object({
          searchResultId: z
            .string()
            .describe('UUID from searchContacts results'),
          contactSearchId: z
            .number()
            .describe('contactSearchId from the search session'),
        }),
      )
      .describe('Array of contacts to research (from searchContacts results)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the batch was submitted'),
    contacts: z
      .array(EnrichedContactSchema)
      .describe('Enriched contacts that completed within timeout'),
    pendingCount: z
      .number()
      .describe('Number of contacts still processing when timeout was reached'),
  }),
};

export type BulkResearchContactsInput = z.infer<
  typeof bulkResearchContactsSchema.input
>;
export type BulkResearchContactsOutput = z.infer<
  typeof bulkResearchContactsSchema.output
>;

// Re-export engagement schemas and types
export * from './schemas-engagement';

// Re-export settings schemas and types
export * from './schemas-settings';

// Re-export contacts & companies schemas and types
export * from './schemas-contacts-companies';

// Re-export lists & searches schemas and types
export * from './schemas-lists-searches';

// Re-export templates schemas and types
export * from './schemas-templates';

import { engagementSchemas } from './schemas-engagement';
import { settingsSchemas } from './schemas-settings';
import { contactsCompaniesSchemas } from './schemas-contacts-companies';
import { allSchemas as listsSearchesSchemas } from './schemas-lists-searches';
import { templatesSchemas } from './schemas-templates';

// ============================================================================
// allSchemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  searchContactsSchema,
  researchContactSchema,
  bulkResearchContactsSchema,
  listContactListsSchema,
  createContactListSchema,
  addContactsToListSchema,
  ...engagementSchemas,
  ...settingsSchemas,
  ...contactsCompaniesSchemas,
  ...listsSearchesSchemas,
  ...templatesSchemas,
];
