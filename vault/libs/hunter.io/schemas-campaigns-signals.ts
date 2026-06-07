import { z } from 'zod';

// Re-define shared params locally to avoid circular import with schemas.ts
const ApiKeyParam = z.string().describe('Hunter.io API key from getContext()');

// ============================================================================
// Campaign Schema (matches actual GET /v2/campaigns response)
// ============================================================================

const CampaignSchema = z.object({
  id: z.number().describe('Campaign ID'),
  name: z.string().describe('Campaign/sequence name'),
  recipients_count: z.number().describe('Number of recipients added'),
  editable: z.boolean().describe('Whether the campaign can be edited'),
  started: z.boolean().describe('Whether the campaign has been started'),
  archived: z.boolean().describe('Whether the campaign is archived'),
  paused: z.boolean().describe('Whether the campaign is paused'),
  owner: z
    .object({
      id: z.number().describe('Owner user ID'),
      email: z.string().describe('Owner email address'),
    })
    .describe('Campaign owner'),
});

// ============================================================================
// Campaign Recipient Schema (matches actual GET /v2/campaigns/{id}/recipients)
// ============================================================================

const CampaignRecipientSchema = z.object({
  email: z.string().describe('Recipient email address'),
  first_name: z.string().nullable().describe('First name'),
  last_name: z.string().nullable().describe('Last name'),
  position: z.string().nullable().describe('Job title'),
  company: z.string().nullable().describe('Company name'),
  website: z.string().nullable().describe('Company website'),
  sending_status: z
    .string()
    .describe(
      'Sending status: pending, sent, opened, clicked, replied, bounced, unsubscribed',
    ),
  lead_id: z.number().describe('Associated lead ID in Hunter'),
});

// ============================================================================
// listCampaigns
// ============================================================================

export const listCampaignsSchema = {
  name: 'listCampaigns',
  description:
    'List all email campaigns/sequences with pagination and optional filters. Paginate by incrementing offset until fewer results than limit are returned (no total count in response).',
  notes: '',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
    started: z
      .boolean()
      .optional()
      .describe('Filter by started state (true=started, false=draft)'),
    archived: z.boolean().optional().describe('Filter by archived state'),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Results per page (default: 20)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Pagination offset (default: 0)'),
  }),
  output: z.object({
    data: z.object({
      campaigns: z.array(CampaignSchema).describe('List of campaigns'),
    }),
    meta: z.object({
      limit: z.number().describe('Applied page size'),
      offset: z.number().describe('Applied offset'),
    }),
  }),
};

// ============================================================================
// getCampaign
// ============================================================================

export const getCampaignSchema = {
  name: 'getCampaign',
  description:
    'Get a single campaign by ID (fetches from the campaigns list and filters)',
  notes:
    'Hunter.io has no dedicated single-campaign endpoint. This fetches from the list API and filters by ID. Use started/archived hints to narrow the search and avoid paginating through all campaigns.',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
    id: z.number().describe('Campaign ID'),
    started: z
      .boolean()
      .optional()
      .describe(
        'Optimization hint: set to true if the campaign is started, false if it is a draft. Limits the underlying list query to avoid scanning all campaigns.',
      ),
    archived: z
      .boolean()
      .optional()
      .describe(
        'Optimization hint: set to true if the campaign is archived. Limits the underlying list query to avoid scanning all campaigns.',
      ),
  }),
  output: z.object({
    data: CampaignSchema.describe('Campaign details'),
  }),
};

// ============================================================================
// listCampaignRecipients
// ============================================================================

export const listCampaignRecipientsSchema = {
  name: 'listCampaignRecipients',
  description:
    'List recipients of a campaign/sequence with pagination. Paginate by incrementing offset until fewer results than limit are returned (no total count in response).',
  notes: '',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
    campaignId: z.number().describe('Campaign ID'),
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
  }),
  output: z.object({
    data: z.object({
      recipients: z
        .array(CampaignRecipientSchema)
        .describe('List of campaign recipients'),
    }),
    meta: z.object({
      limit: z.number().describe('Applied page size'),
      offset: z.number().describe('Applied offset'),
    }),
  }),
};

// ============================================================================
// removeCampaignRecipient
// ============================================================================

export const removeCampaignRecipientSchema = {
  name: 'removeCampaignRecipient',
  description:
    'Cancel all scheduled (unsent) emails for one or more recipients in a campaign. Does NOT remove recipients from the campaign; they remain in the recipient list with their sending_status unchanged. Only cancels scheduled messages.',
  notes:
    'The campaign must have been started (started=true) for any messages to be scheduled. Calling this on a draft campaign (started=false) will always return recipients_canceled=[] and messages_canceled=0 with no error; this is expected behavior, not a bug. Already-sent emails are unaffected. Accepts up to 50 emails per call.',
  input: z.object({
    apiKey: ApiKeyParam,
    campaignId: z.number().describe('Campaign ID'),
    emails: z
      .array(z.string())
      .describe('Email addresses to cancel scheduled messages for (max 50)'),
  }),
  output: z.object({
    data: z.object({
      recipients_canceled: z
        .array(z.string())
        .describe('Email addresses that were successfully canceled'),
      messages_canceled: z
        .number()
        .describe('Total number of scheduled messages canceled'),
    }),
    meta: z.object({
      params: z
        .record(z.string(), z.unknown())
        .describe(
          'Echo of submitted params. Keys: emails (array of email strings).',
        ),
    }),
  }),
};

// ============================================================================
// startCampaign
// ============================================================================

export const startCampaignSchema = {
  name: 'startCampaign',
  description: 'Start a draft campaign/sequence to begin sending emails',
  notes:
    'Campaign must be in draft state with recipients added, email content set, and an email account connected. Returns 422 if prerequisites are not met.',
  input: z.object({
    apiKey: ApiKeyParam,
    campaignId: z.number().describe('Campaign ID to start'),
  }),
  output: z.object({
    data: z.object({
      message: z
        .string()
        .describe(
          'Confirmation message, e.g. "42 emails scheduled for sending."',
        ),
      recipients_count: z
        .number()
        .describe('Total recipients that will receive emails'),
    }),
  }),
};

// ============================================================================
// listSignals
// ============================================================================

export const listSignalsSchema = {
  name: 'listSignals',
  description:
    'List signal monitors configured in the account. Scraped from the /signals HTML page. Paginate using limit/offset (applied in-memory after scraping all signals).',
  notes:
    'Hunter.io has no JSON API for signals. This function fetches and parses the /signals HTML page. No apiKey is required; authentication uses the browser session cookie. The category field uses the machine-readable slug (fundings_and_acquisitions, job_openings, company). The type field is the human-readable sub-type label from the UI.',
  input: z.object({
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Results per page (default: 20)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Pagination offset (default: 0)'),
  }),
  output: z.object({
    data: z.object({
      signals: z
        .array(
          z.object({
            id: z.number().describe('Signal ID'),
            name: z.string().describe('Signal name'),
            category: z
              .string()
              .describe(
                'Machine-readable category slug: fundings_and_acquisitions, job_openings, company',
              ),
            type: z
              .string()
              .describe(
                'Human-readable signal type within category, e.g. "Companies that raised money"',
              ),
            active: z.boolean().describe('Whether the signal is active'),
            created_at: z
              .string()
              .describe(
                'ISO 8601 creation timestamp (parsed from display date)',
              ),
          }),
        )
        .describe('List of signal monitors'),
    }),
    meta: z.object({
      limit: z.number().describe('Applied page size'),
      offset: z.number().describe('Applied offset'),
    }),
  }),
};

// ============================================================================
// createSignal
// ============================================================================

export const createSignalSchema = {
  name: 'createSignal',
  description: 'Create a new signal monitor to track company events',
  notes:
    'Uses Rails form endpoint POST /signals (not /v2/signals which returns 404). Authenticates via browser session + CSRF token; apiKey is unused. Validation requires specific-enough filters; too-broad configs return 422. Known type values: "job_opened" (job_openings), "raised_money" (fundings_and_acquisitions). Maximum 10 signals per account; returns 422 with a clear error message if the limit is exceeded.',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key (unused for signal creation, accepted for interface consistency)',
    ),
    name: z.string().describe('Name for the signal monitor'),
    category: z
      .enum(['fundings_and_acquisitions', 'job_openings'])
      .describe(
        'Signal category: fundings_and_acquisitions (track funding rounds), job_openings (track hiring)',
      ),
    type: z
      .string()
      .describe(
        'Signal type within the category. For job_openings: "job_opened". For fundings_and_acquisitions: "raised_money".',
      ),

    // ── Common filter params ──────────────────────────────────────────────────
    countries: z
      .array(z.string())
      .optional()
      .describe(
        'Headquarters country/continent codes to filter by (e.g. ["US", "GB"])',
      ),
    company_sizes: z
      .array(
        z.enum([
          '1-10',
          '11-50',
          '51-200',
          '201-500',
          '501-1000',
          '1001-5000',
          '5001-10000',
          '10001+',
        ]),
      )
      .optional()
      .describe('Company headcount ranges to filter by'),
    company_industries_include: z
      .array(z.string())
      .optional()
      .describe('Industry names/codes to include in results'),
    company_industries_exclude: z
      .array(z.string())
      .optional()
      .describe('Industry names/codes to exclude from results'),
    published_date: z
      .enum(['7d', '1m', '3m', '6m', '1y', 'custom'])
      .optional()
      .describe(
        'Time window for signal events: 7d=past 7 days, 1m=past month, 3m=past 3 months, 6m=past 6 months, 1y=past year, custom=custom range',
      ),
    published_date_from: z
      .number()
      .optional()
      .describe(
        'Custom date range start (days ago). Only used when published_date="custom"',
      ),
    published_date_to: z
      .number()
      .optional()
      .describe(
        'Custom date range end (days ago). Only used when published_date="custom"',
      ),

    // ── Fundings-specific params (category=fundings_and_acquisitions) ─────────
    series: z
      .array(
        z.enum([
          'pre_seed',
          'seed',
          'pre_series_a',
          'series_a',
          'pre_series_b',
          'series_b',
          'pre_series_c',
          'series_c+',
          'other',
        ]),
      )
      .optional()
      .describe(
        'Funding round series to filter by (for fundings_and_acquisitions category)',
      ),
    amount_raised_from: z
      .number()
      .optional()
      .describe(
        'Minimum funding amount in USD (for fundings_and_acquisitions category)',
      ),
    amount_raised_to: z
      .number()
      .optional()
      .describe(
        'Maximum funding amount in USD (for fundings_and_acquisitions category)',
      ),

    // ── Job-opening-specific params (category=job_openings) ───────────────────
    filter_out_search_firms: z
      .boolean()
      .optional()
      .describe(
        'Exclude staffing and recruiting companies from results (for job_openings category)',
      ),
    title_include: z
      .array(z.string())
      .optional()
      .describe(
        'Job title keywords to include (for job_openings category; tag-style array)',
      ),
    title_exclude: z
      .array(z.string())
      .optional()
      .describe(
        'Job title keywords to exclude (for job_openings category; tag-style array)',
      ),
    description_include: z
      .array(z.string())
      .optional()
      .describe(
        'Job description keywords to include (for job_openings category)',
      ),
    description_exclude: z
      .array(z.string())
      .optional()
      .describe(
        'Job description keywords to exclude (for job_openings category)',
      ),
    job_countries: z
      .array(z.string())
      .optional()
      .describe(
        'Job location country codes (for job_openings category; distinct from company HQ countries)',
      ),
    seniority: z
      .array(
        z.enum([
          'Associate',
          'Director',
          'Entry level',
          'Executive',
          'Internship',
          'Mid-Senior level',
          'Not Applicable',
        ]),
      )
      .optional()
      .describe('Seniority levels to filter by (for job_openings category)'),
    types_of_contract: z
      .array(
        z.enum([
          'Contract',
          'Full-time',
          'Internship',
          'Other',
          'Part-time',
          'Temporary',
          'Volunteer',
        ]),
      )
      .optional()
      .describe(
        'Employment contract types to filter by (for job_openings category)',
      ),
    departments: z
      .array(
        z.enum([
          'accounting/auditing',
          'administrative',
          'advertising',
          'analyst',
          'art/creative',
          'business development',
          'consulting',
          'customer service',
          'design',
          'distribution',
          'education',
          'engineer',
          'engineering',
          'finance',
          'general business',
          'health care',
          'health care provider',
          'human resources',
          'information technology',
          'legal',
          'management',
          'manufacturing',
          'marketing',
          'other',
          'product management',
          'production',
          'project management',
          'public relations',
          'purchasing',
          'quality assurance',
          'research',
          'sales',
          'science',
          'strategy/planning',
          'supply chain',
          'training',
          'writing/editing',
        ]),
      )
      .optional()
      .describe('Job department/function filter (for job_openings category)'),
  }),
  output: z.object({
    data: z.object({
      id: z.number().describe('Created signal ID'),
      name: z.string().describe('Signal name'),
      category: z
        .string()
        .describe(
          'Machine-readable category slug, e.g. "fundings_and_acquisitions", "job_openings"',
        ),
      type: z
        .string()
        .describe(
          'Human-readable signal type label as shown in the UI (e.g. "Companies that raised money", "Companies that published a job"), not the API code value used as input',
        ),
      active: z.boolean().describe('Whether signal is active'),
      created_at: z.string().describe('ISO 8601 creation timestamp'),
    }),
  }),
};

// ============================================================================
// All Schemas Export
// ============================================================================

export const campaignsSignalsSchemas = [
  listCampaignsSchema,
  getCampaignSchema,
  listCampaignRecipientsSchema,
  removeCampaignRecipientSchema,
  startCampaignSchema,
  listSignalsSchema,
  createSignalSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

export type Campaign = z.infer<typeof CampaignSchema>;
export type CampaignRecipient = z.infer<typeof CampaignRecipientSchema>;
export type ListCampaignsInput = z.infer<typeof listCampaignsSchema.input>;
export type ListCampaignsOutput = z.infer<typeof listCampaignsSchema.output>;
export type GetCampaignInput = z.infer<typeof getCampaignSchema.input>;
export type GetCampaignOutput = z.infer<typeof getCampaignSchema.output>;
export type ListCampaignRecipientsInput = z.infer<
  typeof listCampaignRecipientsSchema.input
>;
export type ListCampaignRecipientsOutput = z.infer<
  typeof listCampaignRecipientsSchema.output
>;
export type RemoveCampaignRecipientInput = z.infer<
  typeof removeCampaignRecipientSchema.input
>;
export type RemoveCampaignRecipientOutput = z.infer<
  typeof removeCampaignRecipientSchema.output
>;
export type StartCampaignInput = z.infer<typeof startCampaignSchema.input>;
export type StartCampaignOutput = z.infer<typeof startCampaignSchema.output>;
export type ListSignalsInput = z.infer<typeof listSignalsSchema.input>;
export type ListSignalsOutput = z.infer<typeof listSignalsSchema.output>;
export type CreateSignalInput = z.infer<typeof createSignalSchema.input>;
export type CreateSignalOutput = z.infer<typeof createSignalSchema.output>;
