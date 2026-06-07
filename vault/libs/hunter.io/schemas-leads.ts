import { z } from 'zod';

// Re-define shared params locally to avoid circular import with schemas.ts
const ApiKeyParam = z.string().describe('Hunter.io API key from getContext()');

const LeadSchema = z.object({
  id: z.number().describe('Lead ID'),
  email: z.string().describe('Email address'),
  first_name: z.string().nullable().describe('First name'),
  last_name: z.string().nullable().describe('Last name'),
  position: z.string().nullable().describe('Job title'),
  company: z.string().nullable().describe('Company name'),
  company_industry: z.string().nullable().describe('Company industry'),
  confidence_score: z.number().nullable().describe('Confidence score 0-100'),
  website: z.string().nullable().describe('Company website'),
  country_code: z
    .string()
    .nullable()
    .describe('ISO 2-letter country code for the lead'),
  company_size: z.string().nullable().describe('Company size range'),
  source: z.string().nullable().describe('Lead source'),
  linkedin_url: z.string().nullable().describe('LinkedIn profile URL'),
  phone_number: z.string().nullable().describe('Phone number'),
  twitter: z.string().nullable().describe('Twitter handle'),
  sync_status: z.string().nullable().describe('CRM sync status'),
  notes: z.string().nullable().describe('Notes about the lead'),
  sending_status: z.string().nullable().describe('Campaign sending status'),
  last_activity_at: z
    .string()
    .nullable()
    .describe('Timestamp of last activity (YYYY-MM-DD HH:MM:SS UTC)'),
  last_contacted_at: z
    .string()
    .nullable()
    .describe('Timestamp of last contact (YYYY-MM-DD HH:MM:SS UTC)'),
  verification: z
    .object({
      date: z.string().nullable().describe('Verification date'),
      status: z
        .enum([
          'valid',
          'invalid',
          'accept_all',
          'webmail',
          'disposable',
          'unknown',
        ])
        .nullable()
        .describe('Email verification status'),
    })
    .nullable()
    .describe('Email verification result'),
  leads_list: z
    .object({
      id: z.number().nullable().describe('Leads list ID'),
      name: z.string().nullable().describe('Leads list name'),
      leads_count: z.number().nullable().describe('Total leads in list'),
    })
    .nullable()
    .describe('The leads list this lead belongs to'),
  created_at: z
    .string()
    .describe('Creation timestamp (YYYY-MM-DD HH:MM:SS UTC)'),
});

// ============================================================================
// List Leads
// ============================================================================

export const listLeadsSchema = {
  name: 'listLeads',
  description:
    'List saved leads with optional filters for list, email, name, company, status, and more',
  notes:
    'sending_status and verification_status accept arrays (multiple values ORed). query performs a full-text search across name, email, company, and website. Leads with null verification.status (never verified) or null sending_status (never added to a campaign) are not matched by those filters; omit the filter to include them.',
  input: z.object({
    apiKey: ApiKeyParam.optional(),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Results per page (default: 20, max: 100)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Pagination offset (default: 0)'),
    leads_list_id: z.number().optional().describe('Filter by leads list ID'),
    email: z.string().optional().describe('Filter by email address'),
    first_name: z.string().optional().describe('Filter by first name'),
    last_name: z.string().optional().describe('Filter by last name'),
    query: z
      .string()
      .optional()
      .describe(
        'Full-text search across name, email, company, and website fields',
      ),
    company: z.string().optional().describe('Filter by company name'),
    position: z.string().optional().describe('Filter by job title'),
    website: z.string().optional().describe('Filter by company website domain'),
    linkedin_url: z.string().optional().describe('Filter by LinkedIn URL'),
    phone_number: z.string().optional().describe('Filter by phone number'),
    twitter: z.string().optional().describe('Filter by Twitter handle'),
    country_code: z
      .string()
      .optional()
      .describe('Filter by company country (ISO 2-letter code, e.g. "US")'),
    lead_country_code: z
      .string()
      .optional()
      .describe(
        'Filter by lead\'s personal country (ISO 2-letter code, e.g. "US"). Distinct from country_code which is the company country.',
      ),
    source: z.string().optional().describe('Filter by lead source label'),
    company_industry: z
      .string()
      .optional()
      .describe('Filter by company industry'),
    company_size: z
      .string()
      .optional()
      .describe('Filter by company size range, e.g. "11-50"'),
    company_type: z.string().optional().describe('Filter by company type'),
    sync_status: z
      .string()
      .optional()
      .describe('Filter by CRM synchronization status'),
    sending_status: z
      .array(
        z.enum([
          'not_contacted',
          'scheduled',
          'sent',
          'bounced',
          'opened',
          'clicked',
          'replied',
          'error',
          'unsubscribed',
          'canceled',
        ]),
      )
      .optional()
      .describe(
        'Filter by campaign sending status (multiple values ORed). Only matches leads that have been added to a campaign; leads never added to any campaign have sending_status: null and are not matched by any of these values.',
      ),
    verification_status: z
      .array(
        z.enum([
          'valid',
          'invalid',
          'accept_all',
          'unknown',
          'webmail',
          'disposable',
        ]),
      )
      .optional()
      .describe(
        'Filter by email verification status (multiple values ORed). Valid values: valid, invalid, accept_all, unknown, webmail, disposable. Leads that have never been verified have verification.status: null and cannot be filtered with this parameter; omit it to include unverified leads.',
      ),
  }),
  output: z.object({
    data: z.object({
      leads: z.array(LeadSchema).describe('List of leads'),
    }),
    meta: z.object({
      count: z
        .number()
        .describe(
          'Number of leads matching the current filters (across all pages)',
        ),
      total: z
        .number()
        .describe('Total number of leads in the account (ignoring filters)'),
      params: z
        .object({
          limit: z.number().describe('Requested page size'),
          offset: z.number().describe('Requested offset'),
        })
        .describe('Echo of pagination params'),
    }),
  }),
};

// ============================================================================
// Get Lead
// ============================================================================

export const getLeadSchema = {
  name: 'getLead',
  description: 'Get a single lead by its ID',
  notes: '',
  input: z.object({
    apiKey: ApiKeyParam,
    leadId: z.number().describe('Lead ID to retrieve'),
  }),
  output: z.object({
    data: LeadSchema.describe('Lead details'),
  }),
};

// ============================================================================
// Update Lead
// ============================================================================

export const updateLeadSchema = {
  name: 'updateLead',
  description: "Update a lead's fields by ID",
  notes:
    'apiKey is optional; if omitted, extracted automatically from the page. PUT returns 204 No Content; the function re-fetches and returns the updated lead. The fields lead_city, lead_state, lead_country_code, and company_type are accepted as input and written successfully (204 response) but are NOT returned in the GET response; they are write-only fields that cannot be confirmed via the API response.',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
    leadId: z.number().describe('Lead ID to update'),
    email: z.string().optional().describe('Updated email address'),
    first_name: z.string().optional().describe('Updated first name'),
    last_name: z.string().optional().describe('Updated last name'),
    position: z.string().optional().describe('Updated job title'),
    company: z.string().optional().describe('Updated company name'),
    company_industry: z
      .string()
      .optional()
      .describe('Updated company industry'),
    company_size: z
      .string()
      .optional()
      .describe('Updated company size range, e.g. "11-50"'),
    confidence_score: z
      .number()
      .optional()
      .describe('Updated confidence score 0-100'),
    website: z.string().optional().describe('Updated company website URL'),
    country_code: z
      .string()
      .optional()
      .describe('Updated ISO 2-letter country code'),
    source: z.string().optional().describe('Updated lead source label'),
    linkedin_url: z
      .string()
      .optional()
      .describe('Updated LinkedIn profile URL'),
    phone_number: z.string().optional().describe('Updated phone number'),
    twitter: z.string().optional().describe('Updated Twitter handle'),
    notes: z.string().optional().describe('Updated notes about the lead'),
    leads_list_id: z
      .number()
      .optional()
      .describe('Move lead to a different list'),
    lead_city: z
      .string()
      .optional()
      .describe(
        'City where the lead is personally located, e.g. "New York". Uses field name lead_city (not city) for the update endpoint.',
      ),
    lead_state: z
      .string()
      .optional()
      .describe(
        'State or province where the lead is personally located, e.g. "NY"',
      ),
    lead_country_code: z
      .string()
      .optional()
      .describe(
        'ISO 2-letter country code for the lead\'s personal location, e.g. "US". Distinct from country_code which is the company country.',
      ),
    company_type: z
      .enum([
        'educational',
        'educational institution',
        'government agency',
        'non profit',
        'partnership',
        'privately held',
        'public company',
        'self employed',
        'self owned',
        'sole proprietorship',
      ])
      .optional()
      .describe('Company type'),
  }),
  output: z.object({
    data: LeadSchema.describe('Updated lead'),
  }),
};

// ============================================================================
// Delete Lead
// ============================================================================

export const deleteLeadSchema = {
  name: 'deleteLead',
  description: 'Delete a lead by its ID',
  notes: '',
  input: z.object({
    apiKey: ApiKeyParam,
    leadId: z.number().describe('Lead ID to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the lead was successfully deleted'),
  }),
};

// ============================================================================
// All Schemas
// ============================================================================

export const leadsSchemas = [
  listLeadsSchema,
  getLeadSchema,
  updateLeadSchema,
  deleteLeadSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

export type ListLeadsInput = z.infer<typeof listLeadsSchema.input>;
export type ListLeadsOutput = z.infer<typeof listLeadsSchema.output>;
export type GetLeadInput = z.infer<typeof getLeadSchema.input>;
export type GetLeadOutput = z.infer<typeof getLeadSchema.output>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema.input>;
export type UpdateLeadOutput = z.infer<typeof updateLeadSchema.output>;
export type DeleteLeadInput = z.infer<typeof deleteLeadSchema.input>;
export type DeleteLeadOutput = z.infer<typeof deleteLeadSchema.output>;
