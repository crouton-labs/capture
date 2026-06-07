import { z } from 'zod';

// ============================================================================
// Shared entity schemas
// ============================================================================

export const ProspectContactSchema = z.object({
  id: z.string().nullable().optional().describe('Contact ID in SmartProspect'),
  firstName: z.string().nullable().optional().describe('First name'),
  lastName: z.string().nullable().optional().describe('Last name'),
  fullName: z.string().nullable().optional().describe('Full name'),
  title: z.string().nullable().optional().describe('Job title'),
  level: z
    .string()
    .nullable()
    .optional()
    .describe('Seniority level, e.g. C-Level, VP, Director'),
  department: z
    .array(z.string())
    .nullable()
    .optional()
    .describe('Departments the contact belongs to'),
  company: z
    .object({
      name: z.string().nullable().optional().describe('Company name'),
      website: z
        .string()
        .nullable()
        .optional()
        .describe('Company website domain'),
    })
    .nullable()
    .optional()
    .describe('Company info'),
  industry: z.string().nullable().optional().describe('Industry'),
  subIndustry: z.string().nullable().optional().describe('Sub-industry'),
  companyHeadCount: z
    .string()
    .nullable()
    .optional()
    .describe('Company headcount range, e.g. "10K - 50K"'),
  companyRevenue: z
    .string()
    .nullable()
    .optional()
    .describe('Company revenue range, e.g. "> $1B"'),
  country: z.string().nullable().optional().describe('Country'),
  state: z.string().nullable().optional().describe('State/region'),
  city: z.string().nullable().optional().describe('City'),
  linkedin: z.string().nullable().optional().describe('LinkedIn profile URL'),
  email: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Email address — masked placeholder unless unlocked (costs credits)',
    ),
  emailDeliverability: z
    .number()
    .nullable()
    .optional()
    .describe('Email deliverability score (0–1)'),
});

export const SavedSearchSchema = z.object({
  id: z.string().or(z.number()).describe('Saved search ID'),
  name: z.string().nullable().optional().describe('Search name/label'),
  filters: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Filter configuration for this saved search'),
  created_at: z
    .string()
    .nullable()
    .optional()
    .describe('ISO timestamp when search was saved'),
  updated_at: z
    .string()
    .nullable()
    .optional()
    .describe('ISO timestamp when search was last updated'),
});

export const RecentSearchSchema = z.object({
  id: z.string().or(z.number()).optional().describe('Search ID'),
  filters: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Filter configuration used in this search'),
  executed_at: z
    .string()
    .nullable()
    .optional()
    .describe('ISO timestamp when search was executed'),
  result_count: z
    .number()
    .nullable()
    .optional()
    .describe('Number of results returned'),
});

// ============================================================================
// searchProspects
// ============================================================================

export const searchProspectsSchema = {
  name: 'searchProspects',
  description:
    'Search the SmartProspect contact database with demographic and firmographic filters. Returns matching contacts WITHOUT real email addresses by default — emails must be explicitly unlocked (costs credits, separate operation). Supports cursor-based pagination via scrollId.',
  notes:
    'Searching is free and does NOT consume credits. Do NOT unlock emails automatically — unlocking is a paid operation that requires explicit user consent. Email fields in results are masked placeholders until unlocked.',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    jobTitles: z
      .array(z.string())
      .optional()
      .describe(
        'Filter by job titles (e.g. ["VP of Sales", "Head of Marketing"])',
      ),
    levels: z
      .array(
        z.enum([
          'C-Level',
          'VP',
          'Director-Level',
          'Manager-Level',
          'Senior',
          'Entry-Level',
          'Intern',
          'Owner',
          'Partner',
          'Founder',
        ]),
      )
      .optional()
      .describe('Filter by seniority levels'),
    departments: z
      .array(z.string())
      .optional()
      .describe(
        'Filter by department (e.g. ["Sales", "Engineering", "Marketing"])',
      ),
    includeCompany: z
      .array(z.string())
      .optional()
      .describe('Filter to specific company names'),
    excludeCompany: z
      .array(z.string())
      .optional()
      .describe('Exclude contacts from these company names'),
    includeCompanyDomain: z
      .array(z.string())
      .optional()
      .describe(
        'Filter to contacts at these company domains (e.g. ["salesforce.com"])',
      ),
    excludeCompanyDomain: z
      .array(z.string())
      .optional()
      .describe('Exclude contacts at these company domains'),
    industries: z
      .array(z.string())
      .optional()
      .describe('Filter by industry (e.g. ["Software & Internet", "Finance"])'),
    subIndustries: z
      .array(z.string())
      .optional()
      .describe('Filter by sub-industry'),
    headCounts: z
      .array(z.string())
      .optional()
      .describe(
        'Filter by company headcount range (e.g. ["0 - 25", "25 - 100", "10K - 50K"])',
      ),
    revenue: z
      .array(z.string())
      .optional()
      .describe('Filter by company revenue range'),
    countries: z
      .array(z.string())
      .optional()
      .describe('Filter by country (e.g. ["United States", "Canada"])'),
    states: z.array(z.string()).optional().describe('Filter by state/region'),
    cities: z.array(z.string()).optional().describe('Filter by city'),
    keywords: z
      .array(z.string())
      .optional()
      .describe('Keyword filters applied across contact and company fields'),
    offset: z
      .number()
      .optional()
      .describe('Pagination offset (0-indexed). Defaults to 0.'),
    limit: z
      .number()
      .optional()
      .describe('Maximum contacts to return. Defaults to 25.'),
    scrollId: z
      .string()
      .optional()
      .describe('Cursor from previous response for next page of results'),
  }),
  output: z.object({
    contacts: z.array(ProspectContactSchema).describe('Matching contacts'),
    total: z.number().describe('Total matching contacts in this page'),
    scrollId: z
      .string()
      .nullable()
      .optional()
      .describe('Cursor for next page — pass as scrollId in next call'),
  }),
};

export type SearchProspectsInput = z.infer<typeof searchProspectsSchema.input>;
export type SearchProspectsOutput = z.infer<
  typeof searchProspectsSchema.output
>;

// ============================================================================
// listSavedSearches
// ============================================================================

export const listSavedSearchesSchema = {
  name: 'listSavedSearches',
  description:
    "List the user's saved SmartProspect searches, including the filter configuration for each.",
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
  }),
  output: z.object({
    searches: z.array(SavedSearchSchema).describe('Saved search records'),
    total: z.number().describe('Total number of saved searches'),
  }),
};

export type ListSavedSearchesInput = z.infer<
  typeof listSavedSearchesSchema.input
>;
export type ListSavedSearchesOutput = z.infer<
  typeof listSavedSearchesSchema.output
>;

// ============================================================================
// listRecentSearches
// ============================================================================

export const listRecentSearchesSchema = {
  name: 'listRecentSearches',
  description:
    "List the user's recently executed SmartProspect searches, including the filters and result counts.",
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
  }),
  output: z.object({
    searches: z.array(RecentSearchSchema).describe('Recent search records'),
    total: z.number().describe('Total number of recent searches returned'),
  }),
};

export type ListRecentSearchesInput = z.infer<
  typeof listRecentSearchesSchema.input
>;
export type ListRecentSearchesOutput = z.infer<
  typeof listRecentSearchesSchema.output
>;

// ============================================================================
// Domain schemas array
// ============================================================================

export const prospectSchemas = [
  searchProspectsSchema,
  listSavedSearchesSchema,
  listRecentSearchesSchema,
];
