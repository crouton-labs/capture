import { z } from 'zod';

export const libraryDescription =
  'Hunter.io email discovery, company search, lead management, and campaign operations via internal API';

export const libraryIcon = '/icons/libs/hunter-io.ico';
export const loginUrl = 'https://hunter.io';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://hunter.io/dashboard\`
2. Call \`getContext()\` to get \`{ apiKey, csrfToken }\`
3. Pass \`apiKey\` to all subsequent calls as the \`apiKey\` parameter
4. CORS blocks requests to \`api.hunter.io\` from the browser; all calls use relative \`/v2/\` paths

## Key Concepts

- **API Key**: 40-character hex string embedded in page scripts. Sent as \`api_key\` query param on all \`/v2/\` requests.
- **Leads**: Individual email contacts stored in Hunter. Belong to leads lists. Can be added to campaigns.
- **Campaigns**: Email outreach sequences. Recipients are added in batches (max 50) using email arrays or lead ID arrays.
- **Domain Search**: Returns all known emails for a domain. Supports filtering by type (personal/generic), seniority, and department.
- **Discover**: Company search supporting only \`headcount\` filter. Location and industry filters are not functional on the /v2/discover endpoint. Pagination is not supported; offset > 0 returns HTTP 400. Always returns up to 100 results.
- **Pagination**: Domain-search uses \`offset\` + \`limit\` (default limit=10). Responses include \`meta.results\` for total count.
- **Confidence scores**: 0–100. Higher = more likely deliverable. Used in domain search email results.
- **Verification status**: \`valid\`, \`invalid\`, \`accept_all\`, \`webmail\`, \`disposable\`, or \`unknown\`. Note: webmail providers (Gmail, Yahoo, etc.) typically return \`status: "invalid"\` (not \`"webmail"\`) despite the \`webmail: true\` boolean being set. Check the \`webmail\` boolean field directly to detect webmail providers.
`;

// ============================================================================
// Shared Params
// ============================================================================

export const ApiKeyParam = z
  .string()
  .describe('Hunter.io API key from getContext()');

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Extract the Hunter.io API key and CSRF token from the current page',
  notes: 'Call FIRST before other Hunter.io operations. Must be on hunter.io.',
  input: z.object({}),
  output: z.object({
    apiKey: z
      .string()
      .describe('40-character hex API key for authenticating /v2/ requests'),
    csrfToken: z
      .string()
      .describe('CSRF token from meta tag for state-changing requests'),
  }),
};

// ============================================================================
// Discover Companies
// ============================================================================

export const DiscoverCompanySchema = z.object({
  domain: z.string().describe('Company domain'),
  organization: z.string().describe('Company name'),
  emails_count: z
    .object({
      personal: z.number().describe('Number of personal email addresses found'),
      generic: z
        .number()
        .describe('Number of generic/role email addresses found'),
      total: z.number().describe('Total email addresses found'),
    })
    .describe('Email count breakdown for this company'),
});

export const DiscoverMetaSchema = z.object({
  results: z.number().describe('Total number of matching companies'),
  limit: z.number().describe('Results per page (always 100)'),
  offset: z.number().describe('Current page offset (always 0)'),
  params: z
    .record(z.string(), z.unknown())
    .describe(
      'Echo of the filter params actually applied by the API. Only headcount is supported.',
    ),
  filters: z
    .record(z.string(), z.unknown())
    .describe(
      'Active filter state as parsed by the API. Only headcount appears here.',
    ),
});

export const discoverCompaniesSchema = {
  name: 'discoverCompanies',
  description:
    'Search and discover companies by headcount using Hunter Discover',
  notes:
    'headcount is required; calling without it returns 0 results. Accepts range strings like "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+". Multiple values are ORed together. Location and industry filters are not supported by the /v2/discover API; they are silently dropped. Pagination is not supported; the endpoint rejects any offset > 0 with HTTP 400. Always returns the first page of up to 100 results.',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
    headcount: z
      .array(z.string())
      .optional()
      .describe(
        'Employee count ranges to filter by. Calling without this returns 0 results. Valid values: "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10001+". Multiple values are ORed.',
      ),
  }),
  output: z.object({
    data: z.array(DiscoverCompanySchema).describe('List of matching companies'),
    meta: DiscoverMetaSchema.describe('Pagination and filter metadata'),
  }),
};

// ============================================================================
// Domain Search
// ============================================================================

export const EmailSourceSchema = z.object({
  domain: z.string().describe('Source domain where email was found'),
  uri: z.string().describe('URL of the source page'),
  extracted_on: z.string().describe('Date email was first extracted'),
  last_seen_on: z.string().describe('Date email was last confirmed on page'),
  still_on_page: z.boolean().describe('Whether email is still on source page'),
});

export const DomainEmailSchema = z.object({
  value: z.string().describe('Email address'),
  type: z
    .enum(['personal', 'generic'])
    .describe('personal = individual, generic = role-based'),
  confidence: z
    .number()
    .describe('Confidence score 0-100 (higher = more likely deliverable)'),
  sources: z
    .array(EmailSourceSchema)
    .describe('Web sources where this email was found'),
  first_name: z.string().nullable().optional().describe('First name'),
  last_name: z.string().nullable().optional().describe('Last name'),
  position: z.string().nullable().optional().describe('Job title (normalized)'),
  position_raw: z
    .string()
    .nullable()
    .optional()
    .describe('Job title (as found)'),
  seniority: z
    .enum(['junior', 'senior', 'executive'])
    .nullable()
    .optional()
    .describe('Seniority level'),
  department: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Department: executive, it, finance, sales, legal, support, hr, management, communication, education, design, health, operations',
    ),
  linkedin: z.string().nullable().optional().describe('LinkedIn profile URL'),
  twitter: z.string().nullable().optional().describe('Twitter handle'),
  phone_number: z.string().nullable().optional().describe('Phone number'),
  verification: z
    .object({
      date: z.string().nullable().describe('Date of last verification'),
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
        .describe('Verification result'),
    })
    .describe('Email verification result'),
});

export const searchDomainSchema = {
  name: 'searchDomain',
  description:
    'Search all known email addresses for a domain, with optional filters for type, seniority, department, verification status, job titles, required fields, and location. Costs 1 credit per 10 emails returned; use getEmailCount first to check if a domain has discoverable emails.',
  notes:
    'REQUIRED: You must provide domain, company, or both; omitting both throws an error. When using the location filter, the function switches to a POST request automatically. Filters seniority, required_field, verification_status, and job_titles accept arrays of values; multiple values are ORed. GET is used for all non-location queries; POST is used only when location is specified.',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
    domain: z
      .string()
      .optional()
      .describe(
        'Domain to search, e.g. "stripe.com". Either domain or company is required.',
      ),
    company: z
      .string()
      .optional()
      .describe(
        'Company name to search, e.g. "Stripe". Either domain or company is required. Better results when domain is also supplied.',
      ),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe('Results per page (default: 10, max: 100)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Pagination offset (default: 0)'),
    type: z
      .enum(['personal', 'generic'])
      .optional()
      .describe('Filter by email type'),
    seniority: z
      .array(z.enum(['junior', 'senior', 'executive']))
      .optional()
      .describe(
        'Filter by seniority level. Accepts one or more values. Multiple values are ORed. Values: junior, senior, executive.',
      ),
    department: z
      .string()
      .optional()
      .describe(
        'Filter by department (comma-delimited for multiple): executive, it, finance, management, sales, legal, support, hr, marketing, communication, education, design, health, operations',
      ),
    required_field: z
      .array(z.enum(['full_name', 'position', 'phone_number']))
      .optional()
      .describe(
        'Only return emails where these fields are populated. Values: full_name, position, phone_number.',
      ),
    verification_status: z
      .array(z.enum(['valid', 'accept_all', 'unknown']))
      .optional()
      .describe(
        'Filter by email verification status. Values: valid, accept_all, unknown.',
      ),
    job_titles: z
      .array(z.string())
      .optional()
      .describe('Filter by job title(s), e.g. ["CEO", "CTO"].'),
    location: z
      .object({
        include: z
          .array(
            z.object({
              continent: z
                .enum([
                  'Africa',
                  'Antarctica',
                  'Asia',
                  'Europe',
                  'North America',
                  'Oceania',
                  'South America',
                ])
                .optional()
                .describe('Continent name'),
              business_region: z
                .enum(['AMER', 'EMEA', 'APAC', 'LATAM'])
                .optional()
                .describe('Business region'),
              country: z
                .string()
                .optional()
                .describe('ISO 3166-1 alpha-2 country code, e.g. "US"'),
              state: z
                .string()
                .optional()
                .describe(
                  'US state code, e.g. "CA". Only valid when country="US"',
                ),
              city: z
                .string()
                .optional()
                .describe(
                  'City name, e.g. "San Francisco". Requires country to be set.',
                ),
            }),
          )
          .optional()
          .describe('Locations to include in results'),
        exclude: z
          .array(
            z.object({
              continent: z
                .enum([
                  'Africa',
                  'Antarctica',
                  'Asia',
                  'Europe',
                  'North America',
                  'Oceania',
                  'South America',
                ])
                .optional(),
              business_region: z
                .enum(['AMER', 'EMEA', 'APAC', 'LATAM'])
                .optional(),
              country: z.string().optional(),
              state: z.string().optional(),
              city: z.string().optional(),
            }),
          )
          .optional()
          .describe('Locations to exclude from results'),
      })
      .optional()
      .describe(
        'Geographic filter. When provided, the function uses POST instead of GET. Specify include and/or exclude arrays of location objects.',
      ),
  }),
  output: z.object({
    data: z
      .object({
        domain: z.string().describe('Queried domain'),
        disposable: z
          .boolean()
          .describe('Whether domain is a disposable email provider'),
        webmail: z.boolean().describe('Whether domain is a webmail provider'),
        accept_all: z
          .boolean()
          .describe('Whether server accepts all emails (catch-all)'),
        pattern: z.string().nullable().describe('Detected email pattern'),
        organization: z.string().nullable().describe('Organization name'),
        linked_domains: z
          .array(z.string())
          .describe('Related domains discovered'),
        emails: z
          .array(DomainEmailSchema)
          .describe('Email addresses found for this domain'),
      })
      .describe('Domain search result'),
    meta: z
      .object({
        results: z.number().describe('Total matching emails'),
        limit: z.number().describe('Results per page'),
        offset: z.number().describe('Current offset'),
        params: z
          .object({
            domain: z.string().nullable().describe('Queried domain'),
            company: z
              .string()
              .nullable()
              .describe('Company name filter if provided'),
            type: z
              .string()
              .nullable()
              .describe('Email type filter if provided'),
            seniority: z
              .string()
              .nullable()
              .describe('Seniority filter if provided'),
            department: z
              .string()
              .nullable()
              .describe('Department filter if provided'),
          })
          .describe('Echo of the query params as applied by the API'),
      })
      .describe('Pagination metadata'),
  }),
};

// ============================================================================
// Leads
// ============================================================================

export const LeadSchema = z.object({
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
    .describe('ISO 8601 timestamp of last activity'),
  last_contacted_at: z
    .string()
    .nullable()
    .describe('ISO 8601 timestamp of last contact'),
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
      id: z.number().describe('Leads list ID'),
      name: z.string().describe('Leads list name'),
      leads_count: z.number().describe('Total leads in list'),
    })
    .nullable()
    .describe('The leads list this lead belongs to'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
});

export const createLeadSchema = {
  name: 'createLead',
  description: 'Create a new lead in Hunter.io with an email address',
  notes:
    "email is the only required field. Use leads_list_id to assign to a specific list. country_code is the company country; lead_country_code is the lead's personal country.",
  input: z.object({
    apiKey: ApiKeyParam,
    email: z.string().describe('Email address (required)'),
    first_name: z.string().optional().describe('First name'),
    last_name: z.string().optional().describe('Last name'),
    company: z.string().optional().describe('Company name'),
    position: z.string().optional().describe('Job title'),
    linkedin_url: z.string().optional().describe('LinkedIn profile URL'),
    phone_number: z.string().optional().describe('Phone number'),
    twitter: z.string().optional().describe('Twitter handle'),
    website: z.string().optional().describe('Company website URL'),
    notes: z.string().optional().describe('Notes about the lead'),
    company_industry: z.string().optional().describe('Company industry'),
    company_size: z
      .string()
      .optional()
      .describe('Company size range, e.g. "11-50"'),
    country_code: z
      .string()
      .optional()
      .describe('ISO 2-letter country code for the company, e.g. "US"'),
    source: z.string().optional().describe('Lead source label'),
    leads_list_id: z.number().optional().describe('ID of the leads list'),
    department: z
      .enum([
        'executive',
        'it',
        'finance',
        'management',
        'sales',
        'legal',
        'support',
        'hr',
        'marketing',
        'communication',
        'education',
        'design',
        'health',
        'operations',
      ])
      .optional()
      .describe('Department the lead works in'),
    seniority: z
      .enum(['junior', 'senior', 'executive'])
      .optional()
      .describe('Seniority level of the lead'),
    city: z.string().optional().describe('City where the lead is located'),
    lead_state: z
      .string()
      .optional()
      .describe('State or province where the lead is located'),
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
    data: LeadSchema.describe('Created lead'),
  }),
};

// ============================================================================
// Campaigns
// ============================================================================

export const SkippedRecipientSchema = z.object({
  email: z.string().describe('Email that was skipped'),
  reason: z
    .string()
    .describe(
      'Why skipped: duplicate, invalid, removed, bounced, unsubscribed, claimed',
    ),
});

export const addCampaignRecipientSchema = {
  name: 'addCampaignRecipient',
  description:
    'Add one or more recipients to an existing Hunter.io email campaign (max 50)',
  notes:
    'Provide emails (array) or leadIds (array), or both. New leads are auto-created for unknown emails. Skipped recipients are returned with reasons.',
  input: z.object({
    apiKey: ApiKeyParam,
    campaignId: z.number().describe('Campaign ID to add recipients to'),
    emails: z
      .array(z.string())
      .optional()
      .describe('Email addresses to add (max 50)'),
    leadIds: z
      .array(z.number())
      .optional()
      .describe('Existing Hunter lead IDs to add (max 50)'),
  }),
  output: z.object({
    data: z.object({
      recipients_added: z.number().describe('Number of recipients added'),
      skipped_recipients: z
        .array(SkippedRecipientSchema)
        .nullable()
        .describe(
          'Recipients that were skipped with reasons (null if none skipped)',
        ),
    }),
    meta: z.object({
      params: z
        .record(z.string(), z.unknown())
        .describe(
          'Echo of submitted params. Only the "emails" key is present (null when only leadIds were submitted). campaign_id and lead_ids are never echoed.',
        ),
    }),
  }),
};

// ============================================================================
// Account
// ============================================================================

export const getAccountSchema = {
  name: 'getAccount',
  description:
    'Get Hunter.io account details including credit balance, usage limits, and plan tier',
  notes: '',
  input: z.object({
    apiKey: ApiKeyParam,
  }),
  output: z.object({
    data: z.object({
      first_name: z.string().describe('Account holder first name'),
      last_name: z.string().describe('Account holder last name'),
      email: z.string().describe('Account email address'),
      plan_name: z
        .string()
        .describe('Plan name, e.g. "Free", "Starter", "Growth"'),
      plan_level: z.number().describe('Numeric plan tier (0=Free)'),
      reset_date: z
        .string()
        .describe('Next credit reset date in YYYY-MM-DD format'),
      team_id: z.number().describe('Team/organization ID'),
      requests: z.object({
        credits: z.object({
          used: z
            .number()
            .describe('Credits used this billing period (can be fractional)'),
          available: z.number().describe('Total credits available per period'),
        }),
        searches: z.object({
          used: z.number().describe('Domain searches used this period'),
          available: z
            .number()
            .describe('Total domain searches available per period'),
        }),
        verifications: z.object({
          used: z.number().describe('Email verifications used this period'),
          available: z
            .number()
            .describe('Total email verifications available per period'),
        }),
      }),
      calls: z
        .object({
          _deprecation_notice: z
            .string()
            .describe(
              'Deprecation warning: sums searches + verifications for an imprecise usage view',
            ),
          used: z.number().describe('Combined searches + verifications used'),
          available: z
            .number()
            .describe('Combined searches + verifications available'),
        })
        .optional()
        .describe(
          'Deprecated aggregate usage field. Use requests.searches and requests.verifications instead.',
        ),
    }),
  }),
};

export type GetAccountInput = z.infer<typeof getAccountSchema.input>;
export type GetAccountOutput = z.infer<typeof getAccountSchema.output>;

// ============================================================================
// Email Count
// ============================================================================

export const getEmailCountSchema = {
  name: 'getEmailCount',
  description:
    'Count discoverable email addresses for a domain, broken down by department and seniority. Free, no credit cost.',
  notes: '',
  input: z.object({
    apiKey: ApiKeyParam,
    domain: z.string().describe('Domain to check, e.g. "stripe.com"'),
    type: z
      .enum(['personal', 'generic'])
      .optional()
      .describe(
        'Filter counts by email type: personal = individual addresses, generic = role-based addresses',
      ),
  }),
  output: z.object({
    data: z.object({
      total: z
        .number()
        .describe('Total number of email addresses found for the domain'),
      personal_emails: z
        .number()
        .describe('Number of personal email addresses'),
      generic_emails: z
        .number()
        .describe('Number of generic/role-based email addresses'),
      department: z
        .record(z.string(), z.number())
        .describe(
          'Email counts by department. Keys: executive, it, finance, management, sales, legal, support, hr, marketing, communication, education, design, health, operations',
        ),
      seniority: z
        .record(z.string(), z.number())
        .describe(
          'Email counts by seniority level. Keys: junior, senior, executive',
        ),
    }),
    meta: z.object({
      params: z.object({
        domain: z.string().describe('Queried domain'),
        type: z.string().nullable().describe('Email type filter if provided'),
      }),
    }),
  }),
};

export type GetEmailCountInput = z.infer<typeof getEmailCountSchema.input>;
export type GetEmailCountOutput = z.infer<typeof getEmailCountSchema.output>;

// ============================================================================
// Email Finder
// ============================================================================

export const findEmailSchema = {
  name: 'findEmail',
  description:
    "Find a person's email address given their name and company domain",
  notes:
    "Costs 1 credit per successful lookup. Returns null fields when the email cannot be found. You must provide name in one of two ways: (1) first_name + last_name, or (2) full_name alone (the API splits it automatically). You must also provide domain OR linkedin_handle; linkedin_handle can substitute for domain+name if the handle is in Hunter's database. max_duration minimum is 3; values below that return HTTP 400.",
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
    domain: z
      .string()
      .optional()
      .describe(
        'Company domain to search, e.g. "intercom.com". Required unless linkedin_handle is provided.',
      ),
    first_name: z
      .string()
      .optional()
      .describe(
        "Person's first name. Required together with last_name unless full_name is provided.",
      ),
    last_name: z
      .string()
      .optional()
      .describe(
        "Person's last name. Required together with first_name unless full_name is provided.",
      ),
    full_name: z
      .string()
      .optional()
      .describe(
        'Full name as an alternative to first_name + last_name, e.g. "Patrick Collison". The API splits it automatically. Do not also send first_name/last_name when using this.',
      ),
    company: z
      .string()
      .optional()
      .describe(
        'Company name to help disambiguate when multiple companies share a domain, e.g. "Intercom". Use the display name with standard capitalization; the API may return different (and potentially richer) results depending on the exact string passed.',
      ),
    linkedin_handle: z
      .string()
      .optional()
      .describe(
        'LinkedIn profile handle (not URL) to identify the person, e.g. "patrickcollison". Can substitute for domain + name. Returns error if handle is not in Hunter\'s database.',
      ),
    max_duration: z
      .number()
      .min(3)
      .optional()
      .describe(
        'Maximum seconds the API will search before returning early. Minimum value is 3 (lower values return HTTP 400). Useful for time-sensitive requests.',
      ),
  }),
  output: z.object({
    data: z.object({
      first_name: z.string().nullable().describe('First name'),
      last_name: z.string().nullable().describe('Last name'),
      email: z
        .string()
        .nullable()
        .describe('Found email address, or null if not found'),
      score: z
        .number()
        .nullable()
        .describe('Confidence score 0-100 (null if not found)'),
      domain: z.string().describe('Queried domain'),
      accept_all: z
        .boolean()
        .nullable()
        .describe('Whether domain is catch-all'),
      position: z.string().nullable().describe('Job title'),
      twitter: z.string().nullable().describe('Twitter handle'),
      linkedin_url: z.string().nullable().describe('LinkedIn profile URL'),
      phone_number: z.string().nullable().describe('Phone number'),
      company: z.string().nullable().describe('Company name'),
      sources: z
        .array(EmailSourceSchema)
        .describe('Web sources where this email was found'),
      verification: z.object({
        date: z.string().nullable().describe('Date of last verification'),
        status: z
          .string()
          .nullable()
          .describe(
            'Verification status: valid, invalid, accept_all, webmail, disposable, unknown, or null',
          ),
      }),
    }),
    meta: z.object({
      params: z.object({
        first_name: z.string().nullable().describe('Queried first name'),
        last_name: z.string().nullable().describe('Queried last name'),
        full_name: z.string().nullable().describe('Full name if provided'),
        domain: z
          .string()
          .nullable()
          .describe(
            'Queried domain, or null when lookup used linkedin_handle only',
          ),
        company: z.string().nullable().describe('Company name if provided'),
        linkedin_handle: z
          .string()
          .nullable()
          .describe('LinkedIn handle if provided'),
        max_duration: z
          .string()
          .nullable()
          .describe(
            'Max duration if specified (returned as string by the API)',
          ),
      }),
    }),
  }),
};

export type FindEmailInput = z.infer<typeof findEmailSchema.input>;
export type FindEmailOutput = z.infer<typeof findEmailSchema.output>;

// ============================================================================
// Email Verifier
// ============================================================================

export const verifyEmailSchema = {
  name: 'verifyEmail',
  description:
    'Verify the deliverability of an email address with SMTP checks and validation',
  notes: 'Costs 1 verification credit per call.',
  input: z.object({
    apiKey: ApiKeyParam,
    email: z.string().describe('Email address to verify'),
  }),
  output: z.object({
    data: z.object({
      status: z
        .enum([
          'valid',
          'invalid',
          'accept_all',
          'webmail',
          'disposable',
          'unknown',
        ])
        .describe(
          'Verification result status. NOTE: webmail providers like Gmail typically return "invalid" (not "webmail"); check the separate webmail boolean field to detect webmail providers. "webmail" status is rare. "disposable" = disposable email domain. "accept_all" = catch-all server.',
        ),
      score: z.number().describe('Deliverability score 0-100'),
      email: z.string().describe('Verified email address'),
      regexp: z.boolean().describe('Whether email passes regex validation'),
      gibberish: z
        .boolean()
        .describe('Whether the local part appears to be gibberish'),
      disposable: z
        .boolean()
        .describe('Whether the domain is a disposable email provider'),
      webmail: z
        .boolean()
        .describe(
          'Whether the domain is a webmail provider (Gmail, Yahoo, etc.)',
        ),
      mx_records: z
        .boolean()
        .describe('Whether the domain has valid MX records'),
      smtp_server: z.boolean().describe('Whether SMTP server was reachable'),
      smtp_check: z
        .boolean()
        .describe('Whether the SMTP check confirmed the address exists'),
      accept_all: z
        .boolean()
        .describe('Whether the server accepts all email addresses (catch-all)'),
      block: z
        .boolean()
        .describe('Whether the email was found on a known block list'),
      sources: z
        .array(EmailSourceSchema)
        .describe('Web sources where this email was found'),
      result: z
        .enum(['deliverable', 'undeliverable', 'risky'])
        .optional()
        .describe(
          'Deprecated: high-level deliverability result. Use status instead. deliverable=valid, undeliverable=invalid, risky=accept_all/webmail/disposable/unknown.',
        ),
      _deprecation_notice: z
        .string()
        .optional()
        .describe('Deprecation notice when result field is present'),
    }),
    meta: z.object({
      params: z.object({
        email: z.string().describe('Verified email address'),
      }),
    }),
  }),
};

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema.input>;
export type VerifyEmailOutput = z.infer<typeof verifyEmailSchema.output>;

// ============================================================================
// Re-export leads schemas
// ============================================================================

export {
  listLeadsSchema,
  getLeadSchema,
  updateLeadSchema,
  deleteLeadSchema,
  leadsSchemas,
} from './schemas-leads';

export type {
  ListLeadsInput,
  ListLeadsOutput,
  GetLeadInput,
  GetLeadOutput,
  UpdateLeadInput,
  UpdateLeadOutput,
  DeleteLeadInput,
  DeleteLeadOutput,
} from './schemas-leads';

// ============================================================================
// Re-export enrichment schemas
// ============================================================================

export {
  enrichPersonSchema,
  enrichCompanySchema,
  enrichCombinedSchema,
  enrichmentSchemas,
} from './schemas-enrichment';

export type {
  EnrichPersonInput,
  EnrichPersonOutput,
  EnrichCompanyInput,
  EnrichCompanyOutput,
  EnrichCombinedInput,
  EnrichCombinedOutput,
} from './schemas-enrichment';

// ============================================================================
// Re-export lists & attrs schemas
// ============================================================================

export {
  listLeadListsSchema,
  getLeadListSchema,
  createLeadListSchema,
  updateLeadListSchema,
  deleteLeadListSchema,
  listCustomAttributesSchema,
  createCustomAttributeSchema,
  updateCustomAttributeSchema,
  deleteCustomAttributeSchema,
  listsAttrsSchemas,
} from './schemas-lists-attrs';

export type {
  LeadListSummary,
  CustomAttribute,
  ListLeadListsInput,
  ListLeadListsOutput,
  GetLeadListInput,
  GetLeadListOutput,
  CreateLeadListInput,
  CreateLeadListOutput,
  UpdateLeadListInput,
  UpdateLeadListOutput,
  DeleteLeadListInput,
  DeleteLeadListOutput,
  ListCustomAttributesInput,
  ListCustomAttributesOutput,
  CreateCustomAttributeInput,
  CreateCustomAttributeOutput,
  UpdateCustomAttributeInput,
  UpdateCustomAttributeOutput,
  DeleteCustomAttributeInput,
  DeleteCustomAttributeOutput,
} from './schemas-lists-attrs';

// ============================================================================
// Re-export campaigns-signals schemas
// ============================================================================

export {
  listCampaignsSchema,
  getCampaignSchema,
  listCampaignRecipientsSchema,
  removeCampaignRecipientSchema,
  startCampaignSchema,
  listSignalsSchema,
  createSignalSchema,
  campaignsSignalsSchemas,
} from './schemas-campaigns-signals';

export type {
  Campaign,
  CampaignRecipient,
  ListCampaignsInput,
  ListCampaignsOutput,
  GetCampaignInput,
  GetCampaignOutput,
  ListCampaignRecipientsInput,
  ListCampaignRecipientsOutput,
  RemoveCampaignRecipientInput,
  RemoveCampaignRecipientOutput,
  StartCampaignInput,
  StartCampaignOutput,
  ListSignalsInput,
  ListSignalsOutput,
  CreateSignalInput,
  CreateSignalOutput,
} from './schemas-campaigns-signals';

// ============================================================================
// All Schemas Export
// ============================================================================

import {
  listLeadsSchema,
  getLeadSchema,
  updateLeadSchema,
  deleteLeadSchema,
} from './schemas-leads';
import {
  enrichPersonSchema,
  enrichCompanySchema,
  enrichCombinedSchema,
} from './schemas-enrichment';
import {
  listLeadListsSchema,
  getLeadListSchema,
  createLeadListSchema,
  updateLeadListSchema,
  deleteLeadListSchema,
  listCustomAttributesSchema,
  createCustomAttributeSchema,
  updateCustomAttributeSchema,
  deleteCustomAttributeSchema,
} from './schemas-lists-attrs';
import {
  listCampaignsSchema,
  getCampaignSchema,
  listCampaignRecipientsSchema,
  removeCampaignRecipientSchema,
  startCampaignSchema,
  listSignalsSchema,
  createSignalSchema,
} from './schemas-campaigns-signals';

export const allSchemas = [
  getContextSchema,
  getAccountSchema,
  getEmailCountSchema,
  findEmailSchema,
  verifyEmailSchema,
  discoverCompaniesSchema,
  searchDomainSchema,
  createLeadSchema,
  addCampaignRecipientSchema,
  // Leads
  listLeadsSchema,
  getLeadSchema,
  updateLeadSchema,
  deleteLeadSchema,
  // Enrichment
  enrichPersonSchema,
  enrichCompanySchema,
  enrichCombinedSchema,
  // Lead Lists & Custom Attributes
  listLeadListsSchema,
  getLeadListSchema,
  createLeadListSchema,
  updateLeadListSchema,
  deleteLeadListSchema,
  listCustomAttributesSchema,
  createCustomAttributeSchema,
  updateCustomAttributeSchema,
  deleteCustomAttributeSchema,
  // Campaigns & Signals
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

// Entity types
export type DiscoverCompany = z.infer<typeof DiscoverCompanySchema>;
export type DiscoverMeta = z.infer<typeof DiscoverMetaSchema>;
export type DomainEmail = z.infer<typeof DomainEmailSchema>;
export type EmailSource = z.infer<typeof EmailSourceSchema>;
export type Lead = z.infer<typeof LeadSchema>;

// Input types
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type DiscoverCompaniesInput = z.infer<
  typeof discoverCompaniesSchema.input
>;
export type SearchDomainInput = z.infer<typeof searchDomainSchema.input>;
export type CreateLeadInput = z.infer<typeof createLeadSchema.input>;
export type AddCampaignRecipientInput = z.infer<
  typeof addCampaignRecipientSchema.input
>;

// Output types
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type DiscoverCompaniesOutput = z.infer<
  typeof discoverCompaniesSchema.output
>;
export type SearchDomainOutput = z.infer<typeof searchDomainSchema.output>;
export type CreateLeadOutput = z.infer<typeof createLeadSchema.output>;
export type AddCampaignRecipientOutput = z.infer<
  typeof addCampaignRecipientSchema.output
>;
