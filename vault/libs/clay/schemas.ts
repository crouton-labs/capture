import { z } from 'zod';

export const libraryDescription =
  'Clay.com people and company search, enrichment, and workspace operations via internal APIs';

export const libraryIcon = '/icons/libs/clay.png';
export const loginUrl = 'https://app.clay.com';

export const libraryNotes = `
## Credit Warning

Almost all operations are FREE. Only \`runEnrichmentColumn\` costs credits. Before running it:
1. Call \`getSubscription\` to check available credits
2. Tell the user how many credits will be used
3. Get explicit "yes" before proceeding

\`createWaterfallEnrichment\` is free to create; only running the column via \`runEnrichmentColumn\` costs credits.

## Workflow

1. Navigate to \`https://app.clay.com\`
2. \`getContext\` → verify login
3. \`getWorkspaces\` → get workspaceId
4. Use workspaceId for all subsequent operations

## Key Concepts

**Workspace → Folders → Workbooks → Tables → Views**
- Tables are the functional unit (records + enrichment columns)
- Views are filtered/sorted subsets of table data (free, no duplication)
- Use views instead of new tables when you need a filtered subset

**Table Types: Never Mix Entities**: Tables have a type (people, company, spreadsheet). NEVER put companies in a people table or people in a company table. Signals require specific identifier fields per type: LinkedIn URLs for people, company domains for companies. Mixing entity types in one table makes signals impossible to configure. Always confirm the intended entity type with the user before creating a table, even if they don't mention it.

**Dual ID System for Campaigns**: Campaigns have a Clay table ID (\`t_xxx\`) for table CRUD and a Smartlead campaign ID (integer) for sequencer operations. \`createCampaign\` returns both; use the \`smartleadCampaignId\` field as \`campaignId\` in all sequencer functions.

**Campaign Send Flow**: After campaign setup (sequence, email accounts, schedule), use \`addLeadsToCampaign\` with the Smartlead campaign ID to add leads. Then \`updateCampaignStatus('START')\` to begin sending. Max 100 leads per \`addLeadsToCampaign\` call.

**Cell Format**: All record functions use human-readable field names as cell keys. You can also pass field IDs (f_xxx) if you already have them. Input values are plain strings/numbers/booleans. Output values are unwrapped (no {value, metadata} wrapper). \`getTableRecords\` returns a \`fieldMap\` (name→ID) for functions that need field IDs.

**Deduplication**: Clay has no cross-table dedup. Enriching the same person in multiple tables costs credits each time. Use one master table + views to avoid duplicate charges.

## Search Strategy: Start Broad, Narrow Down

DO NOT use more than 1-2 filters on your first search. Over-filtering returns 0 results.

**Finding a Specific Person** (progressive; stop when found):
1. \`names\` only: \`{ names: ["FirstName LastName"] }\`
2. Try name variations (nicknames, accents, middle initials)
3. Surname + one filter: \`{ names: ["LastName"], job_title_keywords: ["engineer"] }\`
4. Keywords only (last resort): \`{ about_keywords: ["company"], job_title_keywords: ["role"] }\`

**What NOT to do**:
- Never combine \`names\` + \`company_identifier\` + \`job_title_keywords\` + location at once
- Avoid \`company_identifier\` with names; use \`about_keywords\` with company name instead
- \`name\` (string) is broad; \`names\` (array) is more precise

**Multi-person search**: Search each individually. Add ONE filter if too many results. Ask user to disambiguate if multiple matches remain.

**Finding Companies**: Use \`searchCompanies\` with 1-2 filters max. Best approaches:
1. By location: \`{ country_names: ["Germany"] }\` or \`{ locations: ["Berlin"] }\`
2. By industry: \`{ industries: ["Software Development"] }\`
3. AI semantic search: \`{ semantic_description: "AI startup for healthcare" }\`
4. By description keywords: \`{ description_keywords: ["fintech"] }\`
Note: \`company_identifier\` is a broad relevance signal and will NOT return an exact company match. Use \`description_keywords\` instead.

## Importing People from Other Services

- Only populate fields with verified API data ; leave empty rather than guessing
- LinkedIn headlines are freeform text, not company/title. Use structured source fields
- Clay search does not support filtering by LinkedIn URL; search by name or email
- Prefer \`createPeopleTable\` with search filters over manual record creation when people exist in Clay's database
- To import a CSV file from the user's device, use \`importCSV\` with \`filePath\` (reads via Northlight files API) or \`csvContent\` (pass CSV string directly). Supports importing to existing tables (auto-maps columns by name) or creating new tables.

## Claygent Usage Workflow

To effectively USE claygents (not just create them), follow this end-to-end flow:

1. **Generate prompt**: \`generateClaygentPrompt\`: expand natural-language task into a structured prompt (pass \`columnNamesToIds\` to reference table columns)
2. **Generate output schema**: \`generateOutputSchema\`: create JSON schema for structured output from the prompt
3. **Create claygent**: \`createClaygent\`: with the generated prompt, schema, and suggested model
4. **Test in playground**: \`runClaygent\` → \`getClaygentRun\`: test before deploying
5. **Deploy to table**: \`addClaygentColumn\`: add as an action field on a table
6. **Set run conditions** (optional): \`generateFormula\`: create conditional run formulas from natural language (e.g., "only run if Industry is Technology")
7. **Execute**: \`runEnrichmentColumn\`: run the claygent column (costs credits per row)
8. **Monitor**: \`getFieldRunStatus\` / \`getFieldsRunStatus\`: check execution progress
9. **Extract results**: \`sendToTable\`: send list results to a new destination table (e.g., "Send a row for each item in a list")

**Enrichment Discovery**: Use \`searchEnrichments\` to find available enrichments by keyword before adding them.

## Quick Contact Lookup

When the user wants to quickly find a specific person's contact info (email, phone, etc.), not for building a campaign, use this streamlined flow:

1. \`searchPeople\` with the person's name (and optionally company via \`about_keywords\`): preview results (FREE)
2. Show matches to user, confirm the right person
3. \`createPeopleTable\` with the same filters: creates a table with all matches (FREE)
4. \`renameTable\` + \`renameWorkbook\` to something descriptive (e.g., "John Smith - Acme Corp Lookup")
5. \`createWaterfallEnrichment\` on the table: adds email column (FREE to create)
6. \`runEnrichmentColumn\` with \`recordIds\` targeting ONLY the specific person's row; costs credits for just 1 row, not the whole table
7. Poll \`getFieldRunStatus\` until done
8. \`getTableRecords\` with that record ID: return enriched contact info to user

**Organize in a Quick Lookups folder.** Call \`listFolders\` to check if a "Quick Lookups" folder exists. If not, create one with \`createFolder\`. Then \`moveToFolder\` the workbook there. This keeps one-off lookups separate from campaign/project tables.

**Selective row enrichment.** \`runEnrichmentColumn\` accepts \`recordIds\` to enrich specific rows instead of the whole table. Use this whenever the user only needs data on one or a few people from a larger table; it saves credits.

## Table Organization & Naming

**Single table for combined criteria.** When a user asks for people/companies matching multiple criteria (e.g., "engineers at Glean and SpaceX"), create ONE table with all results combined, not separate tables per company or per criterion. Only create separate tables if the user explicitly requests them.

**Always rename after creation.** \`createPeopleTable\` and \`createCompanyTable\` create workbooks/tables with generic default names ("People Search", "Company Search"). Immediately call \`renameTable\` + \`renameWorkbook\` with a descriptive name reflecting the content (e.g., "Glean & SpaceX Engineers Q1 2026").

**Explore workspace first.** Before creating tables, call \`listFolders\` + \`listWorkbooks\` to understand the user's existing organization: folder structure, naming patterns, and how they group related work. Match their conventions when naming new tables and choosing where to place them.

**Best practices when workspace is disorganized.** If the workspace has no clear structure or uses generic names, apply these defaults:
- Name tables by content: \`{Target} {Entity Type}\` (e.g., "Series A Fintech Companies", "Meta ML Engineers")
- Name workbooks by project/campaign: \`{Project or Goal}\` (e.g., "Q1 Outbound", "Hiring Pipeline")
- Group related tables in the same workbook when they serve a single workflow
`;

// ============================================================================
// Shared Parameter Schemas
// ============================================================================

export const WorkspaceIdParam = z
  .string()
  .describe(
    'Workspace ID as a string (e.g., "859597"). Must be a valid numeric value; non-numeric strings return 400.',
  );

// ============================================================================
// Context Schemas
// ============================================================================

export const ClayUserSchema = z.object({
  id: z.number().describe('User ID'),
  username: z.string().describe('Username'),
  email: z.string().describe('Email address'),
  name: z.string().describe('Display name'),
  fullName: z.string().describe('Full name'),
  profilePicture: z
    .string()
    .nullable()
    .optional()
    .describe('Profile picture URL'),
  role: z.string().describe('User role. Known values: "user", "admin"'),
  apiToken: z
    .string()
    .optional()
    .describe('API token (for programmatic access)'),
  emailVerified: z.boolean().describe('Whether email has been verified'),
  onboardingStep: z
    .string()
    .optional()
    .describe(
      'Current onboarding step as a string (e.g. "3"). Numeric value encoded as string',
    ),
  features: z
    .record(z.string(), z.boolean())
    .optional()
    .describe('Feature flags enabled for this user'),
  authStrategy: z
    .string()
    .optional()
    .describe(
      'Authentication method used to create account. Known values: "google", "email"',
    ),
  sessionState: z
    .object({
      last_workspace_visited_id: z
        .string()
        .optional()
        .describe('ID of last visited workspace'),
      new_onboarding_step: z.number().optional(),
      onboarding_completed: z.boolean().optional(),
    })
    .optional()
    .describe('Session state metadata'),
  createdAt: z.string().describe('Account creation timestamp (ISO 8601)'),
  updatedAt: z.string().describe('Last update timestamp (ISO 8601)'),
  rewardfulAffiliateId: z
    .string()
    .nullable()
    .optional()
    .describe('Rewardful affiliate tracking ID'),
  rewardfulReferralId: z
    .string()
    .nullable()
    .optional()
    .describe('Rewardful referral tracking ID'),
  accountRiskStatus: z
    .string()
    .optional()
    .describe(
      'Account risk classification. Known values: "real", "suspicious", "blocked"',
    ),
  isImpersonated: z
    .boolean()
    .optional()
    .describe(
      'Whether this session is impersonated by a Clay admin. When true, adminUser contains the impersonating admin info',
    ),
  adminUser: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .describe(
      'Admin user info when session is impersonated (isImpersonated=true). null when not impersonated',
    ),
  intercomHash: z
    .string()
    .optional()
    .describe('Intercom identity verification hash for support widget'),
});

export const ClayWorkspaceSchema = z.object({
  id: z.number().describe('Workspace ID'),
  name: z.string().describe('Workspace name'),
  billingPlanType: z
    .string()
    .describe('Billing plan type (free, trial, pro, etc.)'),
  billingEmail: z.string().optional().describe('Billing email'),
  createdByUserId: z.string().describe('User ID of workspace creator'),
  icon: z
    .object({
      url: z.string().describe('Workspace avatar/icon URL'),
    })
    .optional()
    .describe('Workspace icon'),
  customerId: z.string().optional().describe('Stripe customer ID for billing'),
  createdAt: z.string().describe('ISO 8601 creation timestamp'),
  updatedAt: z.string().describe('ISO 8601 last update timestamp'),
  deletedAt: z.string().nullable().optional().describe('Deletion timestamp'),
  billingPlanUpdatedAt: z
    .string()
    .optional()
    .describe('When billing plan was last changed'),
  settings: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Workspace settings (e.g. CLAY_SEQUENCER_SMARTLEAD_CLIENT_ID for campaign integration)',
    ),
  credits: z
    .object({
      basic: z.number().describe('Basic credits remaining'),
      longExpiry: z.number().optional().describe('Long expiry credits'),
      actionExecution: z
        .number()
        .optional()
        .describe('Action execution credits'),
    })
    .describe('Current credit balances'),
  featureFlags: z
    .record(
      z.string(),
      z.union([z.boolean(), z.number(), z.string(), z.array(z.string())]),
    )
    .describe('Feature flags controlling workspace capabilities'),
  abilities: z
    .record(z.string(), z.boolean())
    .describe(
      'User permissions (canUpdate, canDelete, canManageBilling, canManageAccess, etc.)',
    ),
  onboardingData: z
    .object({
      formSchema: z.string().describe('Onboarding form version (e.g. "V3")'),
      attribution: z.string().describe('How user heard about Clay'),
      firstUseCase: z.string().describe('Selected use case during onboarding'),
      workspaceName: z
        .string()
        .describe('Workspace name set during onboarding'),
      hasSubmittedOnboardingForm: z
        .boolean()
        .describe('Whether onboarding form has been submitted'),
    })
    .optional()
    .describe('Onboarding state and form data for the workspace'),
  audienceAbilities: z
    .record(z.string(), z.boolean())
    .optional()
    .describe(
      'Audience-specific permissions (canRead, canManageImports, canManageExports, etc.)',
    ),
});

export const CreditBalancesSchema = z.object({
  basic: z.number().describe('Basic credits remaining'),
  longExpiry: z.number().optional().describe('Long expiry credits'),
  actionExecution: z.number().optional().describe('Action execution credits'),
});

const WorkspaceLimitSchema = z.object({
  limit: z.number().optional().describe('Maximum allowed'),
  current: z.number().optional().describe('Current usage count'),
});

const BillingPhaseSchema = z.object({
  start: z.number().describe('Phase start timestamp (ms)'),
  end: z.number().describe('Phase end timestamp (ms)'),
  priceId: z.string().describe('Stripe price ID'),
  priceIdType: z.string().describe('Price type (e.g. "trial", "free", "paid")'),
  productId: z.string().describe('Stripe product ID'),
  productName: z.string().describe('Human-readable product name'),
  isCurrentPhase: z
    .boolean()
    .describe('Whether this is the active billing phase'),
  unitAmount: z.number().describe('Price in cents (0 for free/trial)'),
});

export const SubscriptionSchema = z.object({
  workspaceId: z.number().describe('Workspace ID'),
  creditBalances: CreditBalancesSchema.describe('Current credit balances'),
  creditBudgets: CreditBalancesSchema.describe('Credit budgets per period'),
  currentPeriodStart: z.number().describe('Period start timestamp (seconds)'),
  currentPeriodEnd: z.number().describe('Period end timestamp (seconds)'),
  stripeSubscriptionStatus: z
    .string()
    .describe(
      'Subscription status (e.g. "active", "past_due", "canceled", "trialing")',
    ),
  limits: z
    .record(z.string(), z.union([WorkspaceLimitSchema, z.boolean()]))
    .describe(
      'Workspace limits by feature key (e.g. "add-record-limit", "add-user-limit", "allow-export-limit")',
    ),
  schedule: z
    .array(BillingPhaseSchema)
    .describe(
      'Billing schedule phases: shows current and upcoming plan changes',
    ),
  scheduledChangeType: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Upcoming plan change type (e.g. "trial-ending") or null if none',
    ),
  pastDueInvoice: z
    .unknown()
    .nullable()
    .optional()
    .describe('Overdue invoice details, or null if no past-due invoices'),
  paymentMethod: z
    .unknown()
    .nullable()
    .optional()
    .describe('Payment method on file, or null if none configured'),
  cancelAtPeriodEnd: z
    .boolean()
    .describe(
      'Whether the subscription will cancel at the end of the current period',
    ),
  collectionMethod: z
    .string()
    .describe(
      'How payments are collected (e.g. "charge_automatically", "send_invoice")',
    ),
  metadata: z
    .record(z.string(), z.string())
    .describe('Subscription metadata (contains environment and workspaceId)'),
});

// ============================================================================
// People Search Schemas
// ============================================================================

export const PersonSchema = z.object({
  profile_id: z.string().describe('Clay person profile ID (upn_xxx format)'),
  name: z.string().describe('Full name'),
  first_name: z.string().optional().describe('First name'),
  last_name: z.string().optional().describe('Last name'),
  url: z.string().optional().describe('LinkedIn profile URL'),
  latest_experience_company: z
    .string()
    .optional()
    .describe('Current company name'),
  latest_experience_title: z.string().optional().describe('Current job title'),
  latest_experience_start_date: z
    .string()
    .optional()
    .describe('Role start date (YYYY-MM-DD)'),
  location_name: z
    .string()
    .optional()
    .describe('Location (city, state, country)'),
  domain: z.string().optional().describe('Company domain'),
  company_first_slug: z.string().optional().describe('Company LinkedIn slug'),
});

export const PeopleSearchFiltersSchema = z.object({
  // Job title filters
  job_title_keywords: z
    .array(z.string())
    .optional()
    .describe('Include people with these job titles'),
  job_title_exclude_keywords: z
    .array(z.string())
    .optional()
    .describe('Exclude people with these job titles'),
  job_title_seniority_levels: z
    .array(
      z.enum([
        'owner',
        'partner',
        'c-suite',
        'vp',
        'director',
        'head',
        'manager',
        'senior',
        'entry',
        'assistant',
        'intern',
        'freelance',
        'certified',
      ]),
    )
    .optional()
    .describe(
      'Seniority levels to filter by. Valid values: "owner", "partner", "c-suite", "vp", "director", "head", "manager", "senior", "entry", "assistant", "intern", "freelance", "certified"',
    ),
  job_title_mode: z
    .enum(['smart', 'exact'])
    .optional()
    .describe('Title matching mode (defaults to "smart" if omitted)'),
  job_title_exact_keyword_match: z
    .boolean()
    .optional()
    .describe(
      'When true, job title keywords must match exactly (no fuzzy/smart matching)',
    ),
  job_title_exact_match: z
    .boolean()
    .optional()
    .describe('When true, entire job title must match exactly as provided'),
  job_functions: z
    .array(z.string())
    .optional()
    .describe(
      'Job function categories. Valid values: "Clerical and Administrative", "Agriculture, Horticulture, and the Outdoors", "Design, Media, and Writing", "Business Management and Operations", "Community and Social Services", "Construction, Extraction, and Architecture", "Customer and Client Support", "Education and Training", "Engineering", "Finance", "Healthcare", "Hospitality, Food, and Tourism", "Human Resources", "Information Technology and Computer Science", "Law, Compliance, and Public Safety", "Maintenance, Repair, and Installation", "Manufacturing and Production", "Marketing and Public Relations", "Military", "Performing Arts", "Personal Services", "Sales", "Science and Research", "Social Analysis and Planning", "Students", "Transportation", "Not Employed"',
    ),

  // Company filters
  company_industries_include: z
    .array(z.string())
    .optional()
    .describe('Include these industries'),
  company_industries_exclude: z
    .array(z.string())
    .optional()
    .describe('Exclude these industries'),
  company_sizes: z
    .array(z.string())
    .optional()
    .describe(
      'Company size relevance signal (NOT a strict filter; results may include companies outside the specified ranges). ' +
        'Use these exact strings: "1" (1-10 employees), "11-50", "51-200", "201-500", "501-1,000", "1,001-5,000", "5,001-10,000", "10,001+". ' +
        'Prioritizes but does not guarantee results match the given sizes.',
    ),
  company_description_keywords: z
    .array(z.string())
    .optional()
    .describe('Keywords in company description'),
  company_description_keywords_exclude: z
    .array(z.string())
    .optional()
    .describe('Exclude companies with these description keywords'),
  company_identifier: z
    .array(z.string())
    .optional()
    .describe(
      'Company domains (e.g., "google.com", "salesforce.com"). Use domain format, not company names.',
    ),

  // Location filters
  location_countries_include: z
    .array(z.string())
    .optional()
    .describe('Include these countries'),
  location_countries_exclude: z
    .array(z.string())
    .optional()
    .describe('Exclude these countries'),
  location_states_include: z
    .array(z.string())
    .optional()
    .describe('Include these states/provinces'),
  location_states_exclude: z
    .array(z.string())
    .optional()
    .describe('Exclude these states/provinces'),
  location_cities_include: z
    .array(z.string())
    .optional()
    .describe('Include these cities'),
  location_cities_exclude: z
    .array(z.string())
    .optional()
    .describe('Exclude these cities'),
  location_regions_include: z
    .array(z.enum(['NAM', 'LATAM', 'EMEA', 'APAC']))
    .optional()
    .describe(
      'Include regions: NAM (North America), LATAM (Latin America), EMEA (Europe/Middle East/Africa), APAC (Asia-Pacific)',
    ),
  location_regions_exclude: z
    .array(z.enum(['NAM', 'LATAM', 'EMEA', 'APAC']))
    .optional()
    .describe(
      'Exclude regions: NAM (North America), LATAM (Latin America), EMEA (Europe/Middle East/Africa), APAC (Asia-Pacific)',
    ),
  locations: z
    .array(z.string())
    .optional()
    .describe('General location strings'),
  locations_exclude: z
    .array(z.string())
    .optional()
    .describe('Exclude general location strings'),
  search_raw_location: z
    .boolean()
    .optional()
    .describe('Search raw location text (defaults to false if omitted)'),

  // Experience filters
  experience_count: z
    .number()
    .optional()
    .describe('Minimum number of experiences'),
  max_experience_count: z
    .number()
    .optional()
    .describe('Maximum number of experiences'),
  include_past_experiences: z
    .boolean()
    .optional()
    .describe(
      'Include past job titles in search (defaults to false if omitted)',
    ),
  current_role_min_months_since_start_date: z
    .number()
    .optional()
    .describe('Min months in current role'),
  current_role_max_months_since_start_date: z
    .number()
    .optional()
    .describe('Max months in current role'),

  // Profile filters
  headline_keywords: z
    .array(z.string())
    .optional()
    .describe(
      'Keywords in LinkedIn headline section only (the tagline under name)',
    ),
  about_keywords: z
    .array(z.string())
    .optional()
    .describe('Keywords in the About/Summary section of the profile only'),
  profile_keywords: z
    .array(z.string())
    .optional()
    .describe(
      'Keywords searched across the ENTIRE profile (headline, about, experience, education, skills, etc.)',
    ),
  certification_keywords: z
    .array(z.string())
    .optional()
    .describe(
      'Keywords in the Certifications section only (e.g., "PMP", "AWS Certified")',
    ),
  job_description_keywords: z
    .array(z.string())
    .optional()
    .describe(
      'Keywords in job/experience description text only (the bullet points under each role)',
    ),
  // Name filters
  names: z
    .array(z.string())
    .optional()
    .describe(
      'Full names to search for (e.g., ["Bill Murphy", "Jane Smith"]). More precise than the name string field. Start here when looking for a specific person.',
    ),

  school_names: z
    .array(z.string())
    .optional()
    .describe('School/university names'),
  languages: z.array(z.string()).optional().describe('Spoken languages'),

  // Network filters
  connection_count: z.number().optional().describe('Minimum connection count'),
  max_connection_count: z
    .number()
    .optional()
    .describe('Maximum connection count'),
  follower_count: z.number().optional().describe('Minimum follower count'),
  max_follower_count: z.number().optional().describe('Maximum follower count'),
});

// ============================================================================
// Company Search Schemas
// ============================================================================

export const CompanySchema = z.object({
  clay_company_id: z.string().describe('Clay company ID'),
  linkedin_company_id: z.string().optional().describe('LinkedIn company ID'),
  name: z.string().describe('Company name'),
  type: z
    .string()
    .optional()
    .describe('Company type (e.g., "Private", "Public")'),
  size: z.string().optional().describe('Company size range'),
  industry: z.string().optional().describe('Primary industry'),
  industries: z.array(z.string()).optional().describe('All industries'),
  country: z.string().optional().describe('Country'),
  location: z.string().optional().describe('Full location string'),
  domain: z.string().optional().describe('Company domain'),
  linkedin_url: z.string().optional().describe('LinkedIn company URL'),
  description: z.string().optional().describe('Company description'),
  total_funding_amount_range_usd: z
    .string()
    .optional()
    .describe('Funding range in USD'),
  annual_revenue: z.string().optional().describe('Annual revenue estimate'),
  derived_datapoints: z
    .object({
      business_stage: z
        .string()
        .optional()
        .describe('Business maturity (e.g., "Established", "Growth")'),
      pattern_tags: z
        .string()
        .optional()
        .describe('Comma-separated category tags (e.g., "B2B, SaaS, AI")'),
      description: z
        .string()
        .optional()
        .describe('AI-generated company summary'),
      industry: z
        .array(z.string())
        .optional()
        .describe('Categorized industries'),
      revenue_streams: z
        .array(z.string())
        .optional()
        .describe(
          'Revenue model types (e.g., "Subscriptions/Recurring", "Advertising")',
        ),
      scale_scope: z
        .string()
        .optional()
        .describe('Geographic scope (e.g., "global", "regional")'),
      subindustry: z.array(z.string()).optional().describe('Sub-industries'),
      primary_offerings: z
        .array(z.string())
        .optional()
        .describe('Main products or services'),
      business_type: z
        .array(z.string())
        .optional()
        .describe('Business model types (e.g., ["B2B", "B2C"])'),
    })
    .optional()
    .describe(
      'AI-derived company insights (not always present; available for ~80% of results)',
    ),
});

export const CompanySearchFiltersSchema = z.object({
  // Text search
  description_keywords: z
    .array(z.string())
    .optional()
    .describe('Keywords in company description'),
  description_keywords_exclude: z
    .array(z.string())
    .optional()
    .describe('Exclude companies with these description keywords'),
  semantic_description: z
    .string()
    .optional()
    .describe(
      'AI semantic search: describe the type of company in natural language (e.g., "AI startup for healthcare", "B2B SaaS for construction"). More flexible than keyword filters.',
    ),

  // Company attributes
  sizes: z
    .array(
      z.enum(['1', '2', '10', '50', '200', '500', '1000', '5000', '10000']),
    )
    .optional()
    .describe(
      'Company size filter by employee count threshold. Values represent the lower bound of a range: ' +
        '"1" = Self-employed, "2" = 2-10, "10" = 11-50, "50" = 51-200, "200" = 201-500, ' +
        '"500" = 501-1,000, "1000" = 1,001-5,000, "5000" = 5,001-10,000, "10000" = 10,001+. ' +
        'Pass multiple values to match any of the selected ranges.',
    ),
  industries: z
    .array(z.string())
    .optional()
    .describe(
      'Include these industries (e.g., "Biotechnology Research", "Software Development", "Financial Services")',
    ),
  industries_exclude: z
    .array(z.string())
    .optional()
    .describe('Exclude these industries'),
  types: z
    .array(z.string())
    .optional()
    .describe(
      'Company types (e.g., "Privately Held", "Public Company", "Non Profit", "Self-Employed")',
    ),
  annual_revenues: z
    .array(
      z.enum([
        '100B-1T',
        '10B-100B',
        '1B-10B',
        '500M-1B',
        '200M-500M',
        '75M-200M',
        '25M-75M',
        '10M-25M',
        '5M-10M',
        '1M-5M',
        '500K-1M',
        '0-500K',
      ]),
    )
    .optional()
    .describe(
      'Annual revenue ranges. Values from largest to smallest: "100B-1T", "10B-100B", "1B-10B", "500M-1B", "200M-500M", "75M-200M", "25M-75M", "10M-25M", "5M-10M", "1M-5M", "500K-1M", "0-500K". Pass multiple to match any.',
    ),

  // Company identifiers
  company_identifier: z
    .array(z.string())
    .optional()
    .describe(
      'Company domains as broad relevance signals (e.g., "salesforce.com", "stripe.com"). Use domain format only; company names (e.g., "Google", "Stripe") return 0 results. WARNING: Even domains are NOT exact lookups; "google.com" may return companies that mention Google, not Google itself. For finding a specific company, prefer description_keywords with the company name instead.',
    ),

  // Location filters
  country_names: z
    .array(z.string())
    .optional()
    .describe(
      'Include companies in these countries (e.g., "Germany", "United States", "Japan")',
    ),
  country_names_exclude: z
    .array(z.string())
    .optional()
    .describe('Exclude companies in these countries'),
  locations: z
    .array(z.string())
    .optional()
    .describe(
      'Include companies in these locations: cities, states, or regions (e.g., "Berlin", "California", "Silicon Valley")',
    ),
  locations_exclude: z
    .array(z.string())
    .optional()
    .describe('Exclude companies in these locations'),

  // Funding
  funding_amounts: z
    .array(z.string())
    .optional()
    .describe(
      'Total funding raised ranges (e.g., "$250M+", "$100M - $250M", "$50M - $100M", "$25M - $50M", "$10M - $25M", "$5M - $10M", "$1M - $5M", "Under $1M")',
    ),

  // Member/follower counts
  minimum_member_count: z
    .number()
    .optional()
    .describe('Minimum company member/employee count on LinkedIn'),
  maximum_member_count: z
    .number()
    .optional()
    .describe('Maximum company member/employee count on LinkedIn'),
  minimum_follower_count: z
    .number()
    .optional()
    .describe('Minimum LinkedIn follower count'),
});

// ============================================================================
// Action Schemas
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description: 'Get Clay session context and user information',
  notes:
    'Call FIRST before any Clay operations. User must be on app.clay.com. ' +
    'Returns user info and verifies login status. FREE operation. ' +
    'When logged in: isLoggedIn=true, user is populated, workspaceId contains the last visited workspace ID. ' +
    'When logged out (401/403): isLoggedIn=false, user is omitted, error contains message.',
  input: z.object({}),
  output: z.object({
    success: z
      .boolean()
      .describe(
        'Always true; the function executed. Check isLoggedIn for auth status',
      ),
    isLoggedIn: z
      .boolean()
      .describe(
        'Whether user has an active Clay session. false means 401/403 from /me endpoint',
      ),
    currentUrl: z.string().describe('Current page URL'),
    workspaceId: z
      .string()
      .optional()
      .describe(
        'Last visited workspace ID from session state. Present when isLoggedIn=true. Use this directly; avoids a separate getWorkspaces() call.',
      ),
    user: ClayUserSchema.optional().describe(
      'Current user information. Present only when isLoggedIn=true',
    ),
    error: z
      .string()
      .optional()
      .describe(
        'Error message when isLoggedIn=false (e.g. "User not logged in to Clay")',
      ),
  }),
};

export const getWorkspacesSchema = {
  name: 'getWorkspaces',
  description: 'List all workspaces available to the current user',
  notes:
    'Returns all workspaces with comprehensive metadata: IDs, billing info, credit balances, ' +
    'feature flags, user permissions (abilities), settings, and timestamps. ' +
    'Use this to find workspace IDs before performing workspace-specific operations. FREE operation.',
  input: z.object({}),
  output: z.object({
    workspaces: z.array(ClayWorkspaceSchema).describe('List of workspaces'),
    totalCount: z.number().describe('Total number of workspaces'),
  }),
};

export const getSubscriptionSchema = {
  name: 'getSubscription',
  description: 'Get subscription and credit balance for a workspace',
  notes:
    'Check credit balances before running any credit-costing operations. ' +
    'Returns credit balances/budgets, billing schedule, workspace limits, payment status, and subscription metadata. FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
  }),
  output: SubscriptionSchema,
};

export const searchPeopleSchema = {
  name: 'searchPeople',
  description: 'Preview people search with filters (FREE - no credits used)',
  notes:
    '**FREE operation** - no credits used. Returns up to 50 people (preview only). ' +
    'For more than 50 results, use createPeopleTable() which creates a full table with all matching results (plan limit: up to 5,000). ' +
    'IMPORTANT: Start with minimal filters; use names only first (e.g., names: ["Bill Murphy"]). ' +
    'If 0 results, try name variations (nicknames, full names) before adding more filters. ' +
    'Only add ONE extra filter at a time if needed to narrow results. ' +
    'Do NOT combine names + company_identifier + job_title + location ; over-filtering returns 0 results. ' +
    'Use about_keywords with company name instead of company_identifier when searching by name.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    filters: PeopleSearchFiltersSchema.optional().describe(
      'Search filters to apply',
    ),
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Max results (default: 50, max: 50 for preview)'),
  }),
  output: z.object({
    people: z.array(PersonSchema).describe('Matching people'),
    totalCount: z.number().describe('Number of people returned'),
    resultCount: z
      .number()
      .optional()
      .describe('Total matching results (if available)'),
    taskId: z
      .string()
      .optional()
      .describe(
        'Task ID from this preview. Pass as previewTaskId to createPeopleTable() to speed up table creation.',
      ),
  }),
};

export const searchCompaniesSchema = {
  name: 'searchCompanies',
  description: 'Preview company search with filters (FREE - no credits used)',
  notes:
    '**FREE operation** - no credits used. Returns up to 50 companies. ' +
    'Start with broad filters (1-2 max) and narrow down as needed. Over-filtering returns 0 results. ' +
    'IMPORTANT: All filters are **relevance signals**, not strict constraints; results are ranked by relevance but may include companies outside the specified criteria. ' +
    'Invalid filter values (e.g., misspelled size ranges) are silently ignored, so double-check enum values.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    filters: CompanySearchFiltersSchema.optional().describe(
      'Search filters (relevance signals; results ranked by match quality, not strictly filtered)',
    ),
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Max results to return (1-50, default: 50)'),
  }),
  output: z.object({
    companies: z.array(CompanySchema).describe('Matching companies'),
    totalCount: z
      .number()
      .describe('Number of companies in this response (≤ limit)'),
    resultCount: z
      .number()
      .optional()
      .describe(
        'Estimated total companies matching filters in Clay database (can be millions for broad searches). NOT the number of results you can retrieve; only up to 50 are returned per call.',
      ),
    taskId: z
      .string()
      .optional()
      .describe(
        'Task ID from this preview. Pass as previewTaskId to createCompanyTable() to speed up table creation.',
      ),
  }),
};

export const getRelatedKeywordsSchema = {
  name: 'getRelatedKeywords',
  description: 'Get related/suggested keywords for search refinement',
  notes:
    'Helps expand searches by suggesting related terms. ' +
    'Useful for discovering additional keywords to include in filters. FREE operation. ' +
    'Keywords MUST be lowercase; uppercase returns no results (e.g. "engineer" works, "ENGINEER" does not). ' +
    'Single-word keywords work best. Multi-word phrases (e.g. "chief executive officer") typically return empty. ' +
    'Multiple keywords are supported and results are aggregated across all keywords. ' +
    'An empty array result means no related terms were found for the given keyword.',
  input: z.object({
    keywords: z
      .array(z.string())
      .describe(
        'Keywords to find related terms for. Must be lowercase single words (e.g. ["engineer"]). ' +
          'Multiple keywords aggregate results from each.',
      ),
  }),
  output: z.object({
    relatedKeywords: z
      .array(z.string())
      .describe(
        'Related/suggested keywords. Empty array if no related terms found (common for multi-word phrases, uppercase, or very niche terms)',
      ),
  }),
};

export const SavedSearchPresetSchema = z.object({
  type: z
    .string()
    .describe(
      'Preset type: "action" for enrichment/search presets, "evaluated_source" for saved source presets',
    ),
  inputsBinding: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Saved filter/input values keyed by parameter name. Values are Clay formula strings; ' +
        'e.g. "{{Input_1}}" for dynamic inputs, quoted literals like "\\"value\\"" for constants, ' +
        'or JSON arrays like "[\\"owner\\",\\"vp\\"]" for multi-select filters',
    ),
  inputDefinitions: z
    .array(
      z.object({
        label: z
          .string()
          .describe(
            'Human-readable label for the input (e.g. "Company Website")',
          ),
        inputId: z
          .string()
          .describe(
            'Input variable ID referenced in inputsBinding (e.g. "Input_1")',
          ),
        semanticType: z
          .string()
          .describe(
            'Semantic type hint, e.g. "company-domain", "company-linkedin-url", "url", "unknown"',
          ),
      }),
    )
    .optional()
    .describe(
      'Definitions for dynamic inputs referenced via {{Input_N}} in inputsBinding',
    ),
  conditionalRunFormulaText: z
    .string()
    .optional()
    .describe(
      'Clay formula that controls when this preset runs, e.g. "!!{{Input_1}}" means run only when Input_1 is truthy. Empty string means always run.',
    ),
  aiSummary: z
    .string()
    .optional()
    .describe(
      'AI-generated natural language summary of what the preset does, e.g. "Searching for individuals with job titles containing \'engineer\'". Auto-generated by Clay when creating saved searches.',
    ),
});

export const SavedSearchSchema = z.object({
  id: z.string().describe('Preset ID (pre__xxx format)'),
  name: z.string().describe('Saved search name'),
  type: z
    .string()
    .describe(
      'Preset category type: "action" for built-in templates, "evaluated_source" for user-created saved searches (via createSavedSearch), "recent_search" for auto-saved recent searches, "recipe" for multi-step templates',
    ),
  description: z.string().nullable().optional().describe('Search description'),
  actionKey: z
    .string()
    .describe(
      'Action type key identifying what the preset does, e.g. "find-lists-of-people-with-mixrank" (people search), ' +
        '"find-businesses" (local business search), "find-lists-of-companies-with-mixrank" (company search), ' +
        '"http-api-v2" (HTTP API call), "claygent" (AI agent), "chat-gpt-vision" (GPT vision), etc.',
    ),
  actionPackageId: z
    .string()
    .describe('UUID of the action package this preset belongs to'),
  preset: SavedSearchPresetSchema.optional(),
  workspaceId: z
    .number()
    .nullable()
    .optional()
    .describe(
      'Workspace ID that owns this preset, or null for global/public presets',
    ),
  createdByUserId: z
    .number()
    .nullable()
    .optional()
    .describe('User ID of the preset creator'),
  category: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Display category for organizing presets, e.g. "Company Enrichment", "Company Data", "Person Enrichment", "Find Companies". Null for uncategorized.',
    ),
  isPublic: z
    .boolean()
    .optional()
    .describe('Whether this preset is publicly visible'),
  isPopular: z
    .boolean()
    .optional()
    .describe('Whether this preset is marked as popular/featured'),
  createdAt: z.string().describe('ISO 8601 creation timestamp'),
  updatedAt: z.string().describe('ISO 8601 last update timestamp'),
  deletedAt: z
    .string()
    .nullable()
    .optional()
    .describe('ISO 8601 deletion timestamp, null if not deleted'),
});

// ============================================================================
// Table and Workbook Schemas
// ============================================================================

export const ClayWorkbookSchema = z.object({
  id: z.string().describe('Workbook ID (wb_xxx format)'),
  workspaceId: z.number().describe('Workspace ID'),
  name: z.string().describe('Workbook name'),
  description: z.string().nullable().describe('Workbook description'),
  parentFolderId: z
    .string()
    .nullable()
    .describe('Parent folder ID, null if at root'),
  settings: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Workbook settings'),
  annotations: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Workbook annotations'),
  defaultAccess: z
    .string()
    .optional()
    .describe('Default access level (e.g. "all")'),
  ownerId: z
    .union([z.string(), z.number()])
    .describe('Owner user ID (always normalized to string by implementation)'),
  owner: z
    .object({
      id: z.number().describe('Owner numeric ID'),
      username: z.string().describe('Owner username'),
      email: z.string().describe('Owner email'),
      name: z.string().describe('Owner display name'),
      profilePicture: z
        .string()
        .nullable()
        .optional()
        .describe('Profile picture URL'),
      fullName: z.string().optional().describe('Owner full name'),
    })
    .optional()
    .describe('Owner details (present on create, absent on list)'),
  createdAt: z.string().describe('ISO 8601 creation timestamp'),
  updatedAt: z.string().describe('ISO 8601 last update timestamp'),
  deletedAt: z
    .string()
    .nullable()
    .describe('ISO 8601 deletion timestamp, null if not deleted'),
  isHidden: z.boolean().describe('Whether workbook is hidden'),
  isHiddenFromNavigation: z
    .boolean()
    .describe('Whether workbook is hidden from navigation sidebar'),
  creditLimit: z.number().nullable().describe('Credit limit for workbook'),
  abilities: z
    .object({
      canDelete: z.boolean().optional(),
      canUpdate: z.boolean().optional(),
      canManageAccess: z.boolean().optional(),
    })
    .optional()
    .describe('User permissions for this workbook'),
  tags: z.array(z.string()).describe('Tags applied to this workbook'),
});

export const ClayFieldSchema = z.object({
  id: z.string().describe('Field ID (f_xxx format)'),
  tableId: z.string().optional().describe('Parent table ID'),
  name: z.string().describe('Field name'),
  type: z
    .string()
    .describe(
      'Field type: text, number, url, email, date, boolean, select, longtext, image, users, json, message, currency, validation_result, formula, or action',
    ),
  description: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Field description. Only present on fields where a description has been set; omitted on newly created fields',
    ),
  isLocked: z
    .boolean()
    .optional()
    .describe(
      'Whether the field is locked. Only present on fields with lock configuration; omitted on newly created fields',
    ),
  isSortable: z
    .boolean()
    .optional()
    .describe('Whether the field supports sorting'),
  groupId: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Field group ID if part of a group. Only present on fields belonging to a field group (e.g., enrichment or sequence groups); omitted on standalone fields',
    ),
  typeSettings: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Field type-specific settings (e.g., dataTypeSettings)'),
  lockSettings: z
    .object({
      lockDelete: z.boolean().optional(),
      lockUpdateCells: z.boolean().optional(),
      lockUpdateSettings: z.boolean().optional(),
    })
    .optional()
    .describe(
      'Lock configuration for the field. Only present on fields with lock configuration; omitted on newly created fields',
    ),
  isExtractedField: z
    .boolean()
    .optional()
    .describe('Whether the field was extracted from a source'),
  extractedField: z
    .unknown()
    .optional()
    .describe('Source extraction metadata (null if not extracted)'),
  createdAt: z.string().optional().describe('Field creation timestamp'),
  updatedAt: z.string().optional().describe('Field last update timestamp'),
  supportedFilterOperators: z
    .array(
      z.object({
        operator: z
          .string()
          .describe('Filter operator name (e.g., EQUAL, NOT_EQUAL, EMPTY)'),
        needsValue: z
          .boolean()
          .describe('Whether the operator requires a comparison value'),
        isHidden: z
          .boolean()
          .optional()
          .describe('Whether this operator is hidden from the UI'),
      }),
    )
    .optional()
    .describe('Available filter operators for this field type'),
  conditionalRunFieldIds: z
    .array(z.string())
    .optional()
    .describe(
      'Field IDs that determine conditional run logic (present on action fields in waterfall/enrichment groups)',
    ),
  delayFieldIds: z
    .array(z.string())
    .optional()
    .describe(
      'Field IDs for delay configuration (present on action fields in waterfall/enrichment groups)',
    ),
  inputFieldIds: z
    .array(z.string())
    .optional()
    .describe(
      'Field IDs used as inputs for this action or formula field (present on action/formula fields)',
    ),
});

/**
 * A single filter condition in a view's filter configuration.
 * `type` is the filter operator. Operators that don't need a value (EMPTY, NOT_EMPTY, HAS_ERROR)
 * omit the `value` field. Operators that need a value (EQUAL, NOT_EQUAL, CONTAIN, etc.) include it.
 * Known operators: EQUAL, NOT_EQUAL, CONTAIN, CONTAIN_ANY, NOT_CONTAIN, NOT_CONTAIN_ANY,
 * EMPTY, NOT_EMPTY, GREATER_THAN, GREATER_THAN_OR_EQUAL, LESS_THAN, LESS_THAN_OR_EQUAL, HAS_ERROR.
 */
const ClayViewFilterItemSchema = z.object({
  type: z
    .string()
    .describe(
      'Filter operator (e.g., EMPTY, HAS_ERROR, EQUAL, NOT_EQUAL, CONTAIN, CONTAIN_ANY, NOT_CONTAIN, NOT_CONTAIN_ANY, NOT_EMPTY, GREATER_THAN, GREATER_THAN_OR_EQUAL, LESS_THAN, LESS_THAN_OR_EQUAL)',
    ),
  fieldId: z.string().describe('Field ID to filter on (f_xxx format)'),
  value: z
    .unknown()
    .optional()
    .describe(
      'Comparison value. Present only for operators that need a value (EQUAL, CONTAIN, etc.). Omitted for EMPTY, NOT_EMPTY, HAS_ERROR.',
    ),
});

/**
 * View filter configuration. Contains an array of filter conditions and a combination mode.
 * Preconfigured views (e.g., "Errored rows") use EMPTY and HAS_ERROR filters.
 */
const ClayViewFilterSchema = z
  .object({
    items: z
      .array(ClayViewFilterItemSchema)
      .describe('Array of filter conditions applied to the view'),
    combinationMode: z
      .enum(['AND', 'OR'])
      .describe(
        'How filter items are combined. AND = all must match, OR = any can match.',
      ),
  })
  .nullable()
  .describe(
    'Filter configuration for the view. null means no filters applied. Preconfigured views like "Errored rows" have built-in HAS_ERROR/EMPTY filters.',
  );

/**
 * View sort configuration. Contains an array of sort rules.
 * In practice, sort is typically null for preconfigured and default views.
 */
const ClayViewSortSchema = z
  .object({
    items: z.array(
      z.object({
        fieldId: z.string().describe('Field ID to sort by (f_xxx format)'),
        direction: z
          .enum(['ASC', 'DESC'])
          .describe('Sort direction: ASC (ascending) or DESC (descending)'),
      }),
    ),
  })
  .nullable()
  .describe(
    'Sort configuration for the view. null means no sorting applied (default table order).',
  );

/**
 * View type settings. Empty object for user-created views.
 * Preconfigured views have isPreconfigured=true and a preconfiguredType.
 */
const ClayViewTypeSettingsSchema = z
  .object({
    isPreconfigured: z
      .boolean()
      .optional()
      .describe(
        'Whether this is a system-generated preconfigured view. Absent or false for user-created views.',
      ),
    preconfiguredType: z
      .string()
      .optional()
      .describe(
        'Type of preconfigured view. Only present when isPreconfigured is true. Common values: "fully-enriched-rows", "errored-rows", "non-enrichment-columns", "all-rows".',
      ),
  })
  .describe(
    'View type settings. Empty object ({}) for user-created views. Preconfigured views include isPreconfigured and preconfiguredType.',
  );

export const ClayViewSchema = z.object({
  id: z.string().describe('View ID (gv_xxx format)'),
  tableId: z.string().describe('Parent table ID'),
  name: z
    .string()
    .describe(
      'View name (e.g., "Default view", "Fully enriched rows", "Errored rows", "Non enrichment columns")',
    ),
  description: z.string().nullable().optional().describe('View description'),
  order: z
    .string()
    .optional()
    .describe(
      'Lexicographic position key for view ordering in the tab bar (e.g., "b", "h", "q", "u", "w"). Views are sorted alphabetically by this value.',
    ),
  fields: z
    .record(
      z.string(),
      z.object({
        order: z
          .string()
          .optional()
          .describe(
            'Lexicographic position key for column ordering (e.g., "b", "n", "t")',
          ),
        width: z.number().optional().describe('Column width in pixels'),
        isVisible: z
          .boolean()
          .optional()
          .describe('Whether this field is visible in the view'),
      }),
    )
    .optional()
    .describe(
      'Per-field visibility and layout configuration, keyed by field ID (f_xxx). Controls which columns are shown and their order/width in this view.',
    ),
  sort: ClayViewSortSchema.optional(),
  filter: ClayViewFilterSchema.optional(),
  limit: z.number().nullable().optional().describe('Row limit for the view'),
  offset: z.number().nullable().optional().describe('Row offset for the view'),
  createdAt: z.string().optional().describe('Creation timestamp (ISO 8601)'),
  updatedAt: z.string().optional().describe('Last update timestamp (ISO 8601)'),
  deletedAt: z
    .string()
    .nullable()
    .optional()
    .describe('Deletion timestamp (null if not deleted)'),
  typeSettings: ClayViewTypeSettingsSchema.optional(),
});

/**
 * Summary schema for tables returned by list endpoints (listTables, listWorkspaceTables).
 * These endpoints do NOT return fields, views, or owner details; only metadata.
 * Use getTable() to get full field/view data for a specific table.
 */
export const ClayTableSummarySchema = z.object({
  id: z.string().describe('Table ID (t_xxx format)'),
  workspaceId: z.number().describe('Parent workspace ID'),
  name: z.string().describe('Table name'),
  description: z.string().describe('Table description (empty string if none)'),
  type: z
    .enum(['spreadsheet', 'people', 'company', 'jobs'])
    .describe('Table type'),
  firstViewId: z
    .string()
    .nullable()
    .describe(
      'Default view ID (v_xxx or gv_xxx format). null when table has no views yet.',
    ),
  createdAt: z.string().describe('Creation timestamp'),
  updatedAt: z.string().describe('Last update timestamp'),
  workbookId: z
    .string()
    .optional()
    .describe('Parent workbook ID (wb_xxx format)'),
  createdByUserId: z
    .string()
    .optional()
    .describe('User ID who created the table'),
  ownerId: z.string().optional().describe('Owner user ID'),
  icon: z
    .object({
      emoji: z.string().optional().describe('Emoji character'),
      url: z.string().optional().describe('Custom icon URL'),
    })
    .nullable()
    .optional()
    .describe('Table icon (emoji or custom image)'),
  parentFolderId: z
    .string()
    .nullable()
    .optional()
    .describe('Parent folder ID if table is in a folder'),
  tableSettings: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Table-specific settings (e.g., BLOCK_TYPE for campaigns)'),
  fieldGroupMap: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .describe(
      'Field group configuration (e.g., clay_sequencer groups for campaigns)',
    ),
  defaultAccess: z
    .string()
    .optional()
    .describe('Default access level (e.g., "all")'),
  isSandbox: z.boolean().optional().describe('Whether this is a sandbox table'),
  isHiddenFromNavigation: z
    .boolean()
    .optional()
    .describe('Whether hidden from workspace navigation'),
  deletedAt: z
    .string()
    .nullable()
    .optional()
    .describe('Deletion timestamp (null if not deleted)'),
  abilities: z
    .object({
      canUpdate: z.boolean().optional(),
      canDelete: z.boolean().optional(),
      canManageAccess: z.boolean().optional(),
      canUpdateFromSandbox: z.boolean().optional(),
    })
    .optional()
    .describe('Current user permissions on this table'),
  tags: z.array(z.string()).optional().describe('Tags applied to this table'),
});

/**
 * Full table schema returned by getTable() and other single-table endpoints.
 * Includes fields, views, and owner details not present in list endpoints.
 */
export const ClayTableSchema = z.object({
  id: z.string().describe('Table ID (t_xxx format)'),
  workspaceId: z.number().describe('Parent workspace ID'),
  name: z.string().describe('Table name'),
  description: z.string().optional().describe('Table description'),
  type: z
    .enum(['spreadsheet', 'people', 'company', 'jobs'])
    .describe('Table type'),
  firstViewId: z
    .string()
    .optional()
    .describe(
      'Default view ID (v_xxx or gv_xxx format). Use with listRecordIds.',
    ),
  fields: z.array(ClayFieldSchema).optional().describe('Table fields/columns'),
  createdAt: z.string().describe('Creation timestamp'),
  updatedAt: z.string().describe('Last update timestamp'),
  workbookId: z
    .string()
    .optional()
    .describe('Parent workbook ID (wb_xxx format)'),
  createdByUserId: z
    .string()
    .optional()
    .describe('User ID who created the table'),
  ownerId: z.string().optional().describe('Owner user ID'),
  owner: z
    .object({
      id: z.number().describe('User ID'),
      username: z.string().describe('Username'),
      email: z.string().describe('Email address'),
      name: z.string().describe('Display name'),
      fullName: z.string().optional().describe('Full name'),
      profilePicture: z
        .string()
        .nullable()
        .optional()
        .describe('Profile picture URL'),
    })
    .nullable()
    .optional()
    .describe('Owner user details (null when owner data is not populated)'),
  icon: z
    .object({
      emoji: z.string().optional().describe('Emoji character'),
      url: z.string().optional().describe('Custom icon URL'),
    })
    .nullable()
    .optional()
    .describe('Table icon (emoji or custom image)'),
  parentFolderId: z
    .string()
    .nullable()
    .optional()
    .describe('Parent folder ID if table is in a folder'),
  tableSettings: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Table-specific settings (e.g., BLOCK_TYPE for campaigns)'),
  fieldGroupMap: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Field group configuration (e.g., clay_sequencer groups for campaigns)',
    ),
  defaultAccess: z
    .string()
    .optional()
    .describe('Default access level (e.g., "all")'),
  isSandbox: z.boolean().optional().describe('Whether this is a sandbox table'),
  isHiddenFromNavigation: z
    .boolean()
    .optional()
    .describe('Whether hidden from workspace navigation'),
  deletedAt: z
    .string()
    .nullable()
    .optional()
    .describe('Deletion timestamp (null if not deleted)'),
  abilities: z
    .object({
      canUpdate: z.boolean().optional(),
      canDelete: z.boolean().optional(),
      canManageAccess: z.boolean().optional(),
      canUpdateFromSandbox: z.boolean().optional(),
    })
    .optional()
    .describe('Current user permissions on this table'),
  views: z
    .array(ClayViewSchema)
    .optional()
    .describe('Table views (default, fully enriched, errored rows, etc.)'),
});

export const ClayCellSchema = z.object({
  value: z.unknown().describe('Cell value'),
  metadata: z
    .object({
      status: z.string().describe('Cell status (SUCCESS, PENDING, ERROR)'),
    })
    .optional(),
});

export const ClayRecordSchema = z.object({
  id: z.string().describe('Record ID (r_xxx format)'),
  tableId: z.string().describe('Parent table ID'),
  cells: z
    .record(z.string(), ClayCellSchema)
    .describe('Cell values keyed by field ID'),
});

export const ClayRecordOutputSchema = z.object({
  id: z
    .string()
    .describe('Record ID (r_xxx format, e.g. "r_0ta9byzpfs4UkreJPy4")'),
  tableId: z.string().describe('Parent table ID (t_xxx format)'),
  cells: z
    .record(z.string(), z.unknown())
    .describe(
      'Cell values keyed by field name (human-readable). Values are unwrapped (plain strings/numbers/booleans, not {value, metadata} objects). Example: {"Domain": "perplexity.ai", "Company Name": "Perplexity", "Created At": "2026-02-10T19:11:23.846Z"}',
    ),
  cellMetadata: z
    .record(
      z.string(),
      z.object({
        status: z
          .string()
          .optional()
          .describe(
            'Cell enrichment/processing status: "SUCCESS", "PENDING", "ERROR", "QUEUED"',
          ),
        isCoerced: z
          .boolean()
          .optional()
          .describe(
            'True when Clay auto-converted the value to the field type (e.g., Created At date fields)',
          ),
        isPreview: z
          .boolean()
          .optional()
          .describe(
            'True when the cell value is a preview (e.g., enrichment result summary)',
          ),
        isStale: z
          .boolean()
          .optional()
          .describe(
            'True when the cell value is stale and needs re-computation (e.g., after a dependency field changes)',
          ),
        isOverwrite: z
          .boolean()
          .optional()
          .describe(
            'True when the cell value was explicitly set by the user/API (as opposed to auto-populated or enriched)',
          ),
        imagePreview: z
          .string()
          .optional()
          .describe(
            'CDN URL to a preview image (e.g., company logo from enrichment)',
          ),
      }),
    )
    .optional()
    .describe(
      'Metadata for cells that have non-trivial processing state, keyed by field name. Entirely absent (not an empty object) when no cells have metadata. Example: {"Company Name": {"status": "SUCCESS", "isPreview": true, "imagePreview": "https://..."}, "Created At": {"isCoerced": true}}',
    ),
});

export const getSavedSearchesSchema = {
  name: 'getSavedSearches',
  description:
    'List saved search presets (people, company, and local business searches) in a workspace',
  notes:
    'Returns saved search configurations filtered to people finding, company finding, and local business finding operations. ' +
    'The API returns ALL workspace presets (enrichments, claygents, HTTP actions, etc., typically 400+), ' +
    'but this function filters to only search-related presets by actionKey. ' +
    'Results include three types: "evaluated_source" (user-created via createSavedSearch), "recent_search" (auto-saved when users perform searches), ' +
    'and "action" (built-in templates). Typically returns 0-20 results. ' +
    'Each preset includes its saved filter configuration in preset.inputsBinding. ' +
    'FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
  }),
  output: z.object({
    savedSearches: z
      .array(SavedSearchSchema)
      .describe(
        'Search-related presets only (filtered from all workspace presets by actionKey)',
      ),
    totalCount: z
      .number()
      .describe('Number of search-related presets returned (after filtering)'),
  }),
};

export const getPeopleSearchLimitSchema = {
  name: 'getPeopleSearchLimit',
  description: 'Get the people search result limit for a workspace',
  notes:
    'Returns the maximum number of people that can be returned in search results. ' +
    'This limit varies by billing plan. FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
  }),
  output: z.object({
    peopleSearchLimit: z.number().describe('Maximum search results allowed'),
  }),
};

export const listWorkbooksSchema = {
  name: 'listWorkbooks',
  description: 'List all workbooks in a workspace. Workbooks contain tables.',
  notes:
    'FREE; no credits consumed. Returns workbook IDs needed for listWorkbookTables.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
  }),
  output: z.object({
    workbooks: z.array(ClayWorkbookSchema).describe('List of workbooks'),
    totalCount: z.number().describe('Total number of workbooks'),
  }),
};

export const listTablesSchema = {
  name: 'listTables',
  description: 'List all tables in a workspace with summary metadata',
  notes:
    'Returns table summaries (no fields or views). Use getTable() for full field/view details on a specific table. FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
  }),
  output: z.object({
    tables: z.array(ClayTableSummarySchema).describe('List of table summaries'),
    totalCount: z.number().describe('Total number of tables'),
  }),
};

export const getTableSchema = {
  name: 'getTable',
  description:
    'Get detailed metadata for a single table including fields, views, and settings',
  notes: 'FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
  }),
  output: ClayTableSchema,
};

export const listViewsSchema = {
  name: 'listViews',
  description:
    'List all views on a table. Views are saved configurations of filters, sorting, and column visibility. Every table has a "Default view" plus optional preconfigured views (e.g., "Fully enriched rows", "Errored rows", "Non enrichment columns").',
  notes:
    'Extracts views from the table metadata (GET /tables/{id}), not a separate views endpoint. Views include filter/sort/field layout config. Preconfigured views have typeSettings.isPreconfigured=true. FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
  }),
  output: z.object({
    views: z
      .array(ClayViewSchema)
      .describe(
        'All views on the table, including the default view and any preconfigured views',
      ),
    totalCount: z.number().describe('Total number of views'),
  }),
};

export const createFieldSchema = {
  name: 'createField',
  description: 'Create a new field/column in a table',
  notes: 'Creates a new field in the specified table. FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    name: z.string().describe('Field name'),
    type: z
      .enum([
        'text',
        'number',
        'url',
        'email',
        'date',
        'boolean',
        'select',
        'longtext',
        'image',
        'users',
        'json',
        'message',
        'currency',
        'validation_result',
      ])
      .describe(
        'Field type. Common types: text (short text), longtext (rich/long text), number, email, url, date, boolean (checkbox), select (single-select dropdown), image, currency, json. Less common: users (workspace members), message (messaging), validation_result (validation status)',
      ),
  }),
  output: ClayFieldSchema.describe('The created field'),
};

export const updateFieldSchema = {
  name: 'updateField',
  description: 'Update a field name and/or type',
  notes:
    'Updates an existing field. Can rename, change type, or both. Useful for changing auto-created text fields to specific types (email, url, number, etc.). Returns the full updated field object (not wrapped). FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    fieldId: z.string().describe('Field ID (f_xxx format)'),
    name: z.string().optional().describe('New field name'),
    type: z
      .enum([
        'text',
        'number',
        'url',
        'email',
        'date',
        'boolean',
        'select',
        'longtext',
        'image',
        'users',
        'json',
        'message',
        'currency',
        'validation_result',
      ])
      .optional()
      .describe(
        'New field type. Use to change auto-created text fields to the correct type (e.g., email, url, number).',
      ),
  }),
  output: ClayFieldSchema.describe('The updated field'),
};

export const deleteFieldSchema = {
  name: 'deleteField',
  description: 'Delete a field/column from a table',
  notes:
    'DESTRUCTIVE: Permanently deletes a field and all its data. FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    fieldId: z.string().describe('Field ID (f_xxx format)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether deletion succeeded'),
  }),
};

export const createViewSchema = {
  name: 'createView',
  description: 'Create a new view on a table',
  notes:
    'Creates a new view with the specified name. The view inherits all fields from the table with default visibility/ordering. FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    name: z.string().describe('View name'),
  }),
  output: ClayViewSchema.describe('The created view'),
};

export const updateViewSchema = {
  name: 'updateView',
  description:
    'Update view settings (name, description, limit, offset). For filter and sort, use setViewFilter and setViewSort instead.',
  notes:
    'At least one field must be provided. Filter and sort have their own dedicated endpoints. FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    viewId: z.string().describe('View ID (gv_xxx format)'),
    name: z.string().optional().describe('New view name'),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('New view description (null to clear)'),
    limit: z
      .number()
      .nullable()
      .optional()
      .describe('Row limit for the view (null to remove limit)'),
    offset: z
      .number()
      .nullable()
      .optional()
      .describe('Row offset for the view (null to remove offset)'),
  }),
  output: ClayViewSchema.describe('The updated view'),
};

export const setViewFilterSchema = {
  name: 'setViewFilter',
  description:
    'Set or clear filters on a table view. Filters control which rows are visible in the view.',
  notes:
    'Uses a dedicated /filter endpoint (separate from updateView). To clear all filters, pass filter as null or omit it. Each filter item needs a fieldId and operator type. Use listViews or getTable to see available fields and their supportedFilterOperators. FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    viewId: z.string().describe('View ID (gv_xxx format)'),
    filter: z
      .object({
        items: z
          .array(
            z.object({
              type: z
                .string()
                .describe(
                  'Filter operator. Common operators: EQUAL, NOT_EQUAL, CONTAIN, CONTAIN_ANY, NOT_CONTAIN, NOT_CONTAIN_ANY, EMPTY, NOT_EMPTY, GREATER_THAN, GREATER_THAN_OR_EQUAL, LESS_THAN, LESS_THAN_OR_EQUAL, HAS_ERROR, SELECT_EQUAL. Check field.supportedFilterOperators for valid operators per field.',
                ),
              fieldId: z
                .string()
                .describe('Field ID to filter on (f_xxx format)'),
              value: z
                .unknown()
                .optional()
                .describe(
                  'Comparison value. Required for operators like EQUAL, CONTAIN, SELECT_EQUAL. Omit for EMPTY, NOT_EMPTY, HAS_ERROR. For SELECT_EQUAL, use {optionIds: [optionId]}.',
                ),
            }),
          )
          .describe('Array of filter conditions'),
        combinationMode: z
          .enum(['AND', 'OR'])
          .describe(
            'How filter items are combined. AND = all must match, OR = any can match.',
          ),
      })
      .nullable()
      .optional()
      .describe(
        'Filter configuration to set. Pass null or omit to clear all filters.',
      ),
  }),
  output: ClayViewSchema.describe(
    'The updated view with the new filter applied',
  ),
};

export const setViewSortSchema = {
  name: 'setViewSort',
  description:
    'Set or clear sort order on a table view. Sort controls the row ordering in the view.',
  notes:
    'Uses a dedicated /sort endpoint (separate from updateView). To clear sorting, pass sort as null or omit it. FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    viewId: z.string().describe('View ID (gv_xxx format)'),
    sort: z
      .object({
        items: z
          .array(
            z.object({
              fieldId: z
                .string()
                .describe('Field ID to sort by (f_xxx format)'),
              direction: z
                .enum(['ASC', 'DESC'])
                .describe(
                  'Sort direction: ASC (ascending) or DESC (descending)',
                ),
            }),
          )
          .describe('Array of sort rules. Multiple fields supported.'),
      })
      .nullable()
      .optional()
      .describe(
        'Sort configuration to set. Pass null or omit to clear sorting.',
      ),
  }),
  output: ClayViewSchema.describe('The updated view with the new sort applied'),
};

export const deleteViewSchema = {
  name: 'deleteView',
  description: 'Delete a view from a table',
  notes:
    'DESTRUCTIVE: Permanently deletes a view. FREE operation. After deletion, navigates browser to the table workbook to avoid a 404.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    viewId: z.string().describe('View ID (gv_xxx format)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether deletion succeeded'),
  }),
};

export const duplicateTableSchema = {
  name: 'duplicateTable',
  description: 'Duplicate an existing table',
  notes:
    'Creates a copy of the table with all fields, records, and views. New table is named "Copy of {original name}". FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID to duplicate (t_xxx format)'),
  }),
  output: z.object({
    table: ClayTableSchema.describe('Duplicated table'),
    oldViewIdToNewViewIdMap: z
      .record(z.string(), z.string())
      .describe(
        'Maps original view IDs to new view IDs in the duplicated table',
      ),
  }),
};

export const exportTableSchema = {
  name: 'exportTable',
  description: 'Export table to downloadable file',
  notes:
    'Creates an export job for the table. The downloadUrl is null initially and populates asynchronously once the export completes. Poll the export status to get the final download URL. FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID to export (t_xxx format)'),
  }),
  output: z.object({
    id: z.string().describe('Export job ID (ej_xxx format)'),
    workspaceId: z.number().describe('Workspace ID'),
    tableId: z.string().describe('Table ID'),
    viewId: z
      .string()
      .describe('View ID (empty string if exporting full table)'),
    userId: z.string().describe('User ID who initiated the export'),
    fileName: z.string().describe('Export file name'),
    status: z.string().describe('Export job status (ACTIVE, COMPLETED, etc.)'),
    uploadedFilePath: z
      .string()
      .nullable()
      .describe('Path to uploaded file when complete'),
    createdAt: z.string().describe('Export job creation timestamp'),
    updatedAt: z.string().describe('Export job last update timestamp'),
    totalRecordsInViewCount: z.number().describe('Total records to export'),
    recordsExportedCount: z.number().describe('Records exported so far'),
    downloadUrl: z
      .string()
      .nullable()
      .describe('Download URL (null until export completes)'),
    settings: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe('Export settings'),
    exportType: z.string().describe('Export type (TABLE, VIEW, etc.)'),
  }),
};

export const listCampaignsSchema = {
  name: 'listCampaigns',
  description:
    'List Clay Sequencer campaigns in workspace with both Smartlead IDs and Clay table IDs',
  notes:
    'Returns active campaigns. Campaigns have dual IDs: Smartlead integer ID (for sequencer operations) and Clay tableId (for table CRUD and deletion). Deduplicates by name (keeps most recent) and filters orphaned campaigns (no Clay table). FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
  }),
  output: z.object({
    campaigns: z
      .array(
        z.object({
          id: z.number().describe('Smartlead campaign ID (integer)'),
          name: z.string().describe('Campaign name'),
          status: z
            .string()
            .describe('Campaign status (DRAFTED, ACTIVE, PAUSED, etc.)'),
          created_at: z.string().describe('Creation timestamp'),
          updated_at: z.string().describe('Last update timestamp'),
          send_as_plain_text: z
            .boolean()
            .describe('Whether to send as plain text'),
          tableId: z
            .string()
            .nullable()
            .describe(
              'Clay table ID (t_xxx format). Pass to deleteCampaign for full cleanup. Always non-null (orphaned campaigns are filtered out).',
            ),
          workbookId: z
            .string()
            .nullable()
            .describe(
              'Clay workbook ID (wb_xxx format). Pass to deleteCampaign for full cleanup.',
            ),
        }),
      )
      .describe('List of campaigns'),
    totalCount: z.number().describe('Total number of campaigns'),
  }),
};

export const listWorkspaceMembersSchema = {
  name: 'listWorkspaceMembers',
  description: 'List all users in a workspace',
  notes:
    'Returns all workspace members with their roles and permissions. FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
  }),
  output: z.object({
    users: z
      .array(
        z.object({
          id: z.number().describe('User ID'),
          username: z.string().describe('Username'),
          email: z.string().describe('Email address'),
          name: z.string().describe('Display name'),
          fullName: z.string().describe('Full name'),
          profilePicture: z.string().optional().describe('Profile picture URL'),
          role: z
            .object({
              id: z.string().describe('Role ID'),
              role: z.string().describe('Role name (e.g., "workspace-admin")'),
            })
            .describe('User role'),
        }),
      )
      .describe('List of workspace members'),
    totalCount: z.number().describe('Total number of members'),
  }),
};

export const getTableRecordsSchema = {
  name: 'getTableRecords',
  description: 'Get records from a table by their IDs',
  notes:
    'Call listRecordIds() first to get record IDs, then pass them here. ' +
    'Cells are keyed by human-readable field name with unwrapped values (e.g., "Domain": "perplexity.ai"). ' +
    'Returns fieldMap (name→ID) for use with createWaterfallEnrichment and other functions that need field IDs. ' +
    'Handles any number of record IDs; automatically batches into chunks of 300 and fetches in parallel. ' +
    'Safe to pass all IDs from listRecordIds() directly, even for tables with thousands of rows. ' +
    'Invalid record IDs are silently skipped (no error, just absent from results). ' +
    'At least one recordId is required; pass an empty array and the call will throw. ' +
    'FREE operation; reads do not consume Clay credits.',
  input: z.object({
    tableId: z
      .string()
      .describe(
        'Table ID (t_xxx format, e.g. "t_0ta9byy82yMryfgTp3N"). Get from listTables or createTable/createPeopleTable/createCompanyTable.',
      ),
    recordIds: z
      .array(z.string())
      .describe(
        'Record IDs to fetch (r_xxx format, e.g. ["r_0ta9byzpfs4UkreJPy4"]). Get from listRecordIds(). Pass all IDs at once; auto-batches internally.',
      ),
  }),
  output: z.object({
    records: z
      .array(ClayRecordOutputSchema)
      .describe(
        'Fetched records with cells keyed by field name. Only records with valid IDs are returned; invalid IDs are silently omitted.',
      ),
    totalCount: z
      .number()
      .describe(
        'Number of records returned (may be less than recordIds.length if some IDs were invalid)',
      ),
    fieldMap: z
      .record(z.string(), z.string())
      .describe(
        'Field name → field ID mapping (e.g. {"Domain": "f_0ta9byz2q6s6bzzP9z4"}). Use these IDs for createWaterfallEnrichment and other functions that require field IDs.',
      ),
  }),
};

export const createSavedSearchSchema = {
  name: 'createSavedSearch',
  description: 'Save a people search as a preset',
  notes:
    'Creates a reusable search configuration. Only non-empty filter values are saved; ' +
    'empty arrays, nulls, false booleans, and empty strings are stripped. Zero (0) values ' +
    'are preserved. The API generates an aiSummary describing the saved filters in natural ' +
    'language. Validates enum fields (seniority, regions, job_title_mode, job_functions) ' +
    'and rejects negative numbers for count fields. FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    name: z.string().describe('Name for the saved search'),
    description: z.string().optional().describe('Description'),
    filters: PeopleSearchFiltersSchema.describe('Search filters to save'),
  }),
  output: z.object({
    id: z.string().describe('Preset ID (pre__xxx format)'),
    name: z.string().describe('Saved search name'),
    type: z
      .string()
      .describe('Preset type: always "evaluated_source" for saved searches'),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('Search description'),
    actionKey: z
      .string()
      .describe(
        'Action type key: "find-lists-of-people-with-mixrank-source" for people searches',
      ),
    actionPackageId: z
      .string()
      .describe('UUID of the action package this preset belongs to'),
    preset: z
      .object({
        type: z.string().describe('Preset type: "evaluated_source"'),
        inputsBinding: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Saved filter values keyed by parameter name. Only non-empty filters are included.',
          ),
        aiSummary: z
          .string()
          .optional()
          .describe(
            'AI-generated natural language summary of the saved filters; auto-generated by Clay',
          ),
      })
      .optional(),
    workspaceId: z.number().nullable().optional().describe('Workspace ID'),
    createdByUserId: z
      .number()
      .nullable()
      .optional()
      .describe('Creator user ID'),
    category: z.string().nullable().optional().describe('Display category'),
    isPublic: z.boolean().optional().describe('Whether publicly visible'),
    isPopular: z.boolean().optional().describe('Whether marked as popular'),
    createdAt: z.string().describe('ISO 8601 creation timestamp'),
    updatedAt: z.string().describe('ISO 8601 last update timestamp'),
    deletedAt: z
      .string()
      .nullable()
      .optional()
      .describe('ISO 8601 deletion timestamp or null'),
  }),
};

export const updateSavedSearchSchema = {
  name: 'updateSavedSearch',
  description: "Update a saved search preset's name, description, or filters",
  notes:
    'Updates an existing saved search. Only provided fields are changed; omitted fields remain unchanged. ' +
    'Validates enum fields (seniority, regions, job_title_mode, job_functions) and rejects negative numbers for count fields if filters are provided. ' +
    'At least one of name, description, or filters must be specified. Only non-empty filter values are saved. FREE operation.',
  input: z.object({
    presetId: z.string().describe('Preset ID to update (pre__xxx format)'),
    name: z.string().optional().describe('New name for the saved search'),
    description: z.string().optional().describe('New description'),
    filters: PeopleSearchFiltersSchema.optional().describe(
      'New search filters (replaces existing filters entirely)',
    ),
  }),
  output: z.object({
    id: z.string().describe('Preset ID (pre__xxx format)'),
    name: z.string().describe('Saved search name'),
    type: z
      .string()
      .describe('Preset type: always "evaluated_source" for saved searches'),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('Search description'),
    actionKey: z
      .string()
      .describe(
        'Action type key: "find-lists-of-people-with-mixrank-source" for people searches',
      ),
    actionPackageId: z
      .string()
      .describe('UUID of the action package this preset belongs to'),
    preset: z
      .object({
        type: z.string().describe('Preset type: "evaluated_source"'),
        inputsBinding: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Saved filter values keyed by parameter name. Only non-empty filters are included.',
          ),
        aiSummary: z
          .string()
          .optional()
          .describe(
            'AI-generated natural language summary of the saved filters; auto-generated by Clay',
          ),
      })
      .optional(),
    workspaceId: z.number().nullable().optional().describe('Workspace ID'),
    createdByUserId: z
      .number()
      .nullable()
      .optional()
      .describe('Creator user ID'),
    category: z.string().nullable().optional().describe('Display category'),
    isPublic: z.boolean().optional().describe('Whether publicly visible'),
    isPopular: z.boolean().optional().describe('Whether marked as popular'),
    createdAt: z.string().describe('ISO 8601 creation timestamp'),
    updatedAt: z.string().describe('ISO 8601 last update timestamp'),
    deletedAt: z
      .string()
      .nullable()
      .optional()
      .describe('ISO 8601 deletion timestamp or null'),
  }),
};

export const deleteSavedSearchSchema = {
  name: 'deleteSavedSearch',
  description: 'Delete a saved search preset',
  notes:
    'Permanently deletes a saved search created via createSavedSearch. Use getSavedSearches to find preset IDs. FREE operation.',
  input: z.object({
    presetId: z
      .string()
      .describe(
        'Preset ID to delete (pre__xxx format, from getSavedSearches or createSavedSearch)',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the deletion succeeded'),
  }),
};

export const createTableSchema = {
  name: 'createTable',
  description: 'Create a new table in a workspace',
  notes:
    'Creates a new blank table with only system fields (Created At, Updated At). ' +
    'You can add data immediately by calling createRecords; it auto-creates missing fields as text columns on blank tables. ' +
    'Or use createField to add columns with specific types (number, email, url, etc.) before adding records. ' +
    'If workbookId not provided, auto-creates a workbook with the same name. ' +
    'Returns workbookId on the table; needed to navigate to it in Clay UI ' +
    '(URL pattern: /workspaces/{wsId}/workbooks/{workbookId}). FREE operation.',
  input: z.object({
    name: z.string().describe('Table name'),
    workspaceId: WorkspaceIdParam,
    type: z
      .enum(['spreadsheet', 'people', 'company', 'jobs'])
      .describe(
        'Table type: "spreadsheet" (general-purpose), "people" (person records), "company" (company records), or "jobs" (job listings)',
      ),
    workbookId: z
      .string()
      .optional()
      .describe('Workbook ID (wb_xxx format) - auto-created if omitted'),
  }),
  output: z.object({
    table: ClayTableSchema.describe(
      'Created table with full metadata including fields, views, abilities, and owner',
    ),
    workbook: z
      .object({
        id: z.string().describe('Workbook ID (wb_xxx format)'),
        name: z.string().describe('Workbook name'),
        isNew: z
          .boolean()
          .describe(
            'true if workbook was auto-created (workbookId omitted), false if an existing workbook was used (workbookId provided)',
          ),
      })
      .optional()
      .describe(
        'Workbook the table was created in. Usually present. Contains the auto-created or existing workbook info.',
      ),
    extraData: z
      .object({
        initialRecordIds: z
          .array(z.string())
          .optional()
          .describe('IDs of any initial records created with the table'),
        initialRecords: z
          .array(z.unknown())
          .optional()
          .describe('Initial record data'),
        newlyCreatedWorkbook: z
          .unknown()
          .optional()
          .describe(
            'Workbook details when a new workbook was created. Contains properties like id, workspaceId, name, description, ownerId, settings, etc.',
          ),
      })
      .optional()
      .describe('Additional data returned on table creation'),
  }),
};

export const createWorkbookSchema = {
  name: 'createWorkbook',
  description: 'Create a new workbook in a workspace',
  notes: 'Creates a new workbook. FREE operation.',
  input: z.object({
    name: z
      .string()
      .describe(
        'Workbook name. No length limit or character restrictions enforced.',
      ),
    workspaceId: WorkspaceIdParam,
    settings: z
      .object({
        isAutoRun: z
          .boolean()
          .optional()
          .describe(
            'Enable auto-run for new tables in this workbook. Must be a boolean; non-boolean values are rejected.',
          ),
      })
      .optional()
      .describe(
        'Optional workbook settings. Only recognized fields (isAutoRun) are sent to the API; unknown fields are stripped. Non-object values (null, string, number) are silently ignored.',
      ),
  }),
  output: ClayWorkbookSchema,
};

export const createRecordsSchema = {
  name: 'createRecords',
  description: 'Create new records in a table',
  notes:
    'Creates one or more records in a table. Cell keys can be field names (e.g., "Full Name") or field IDs (f_xxx), and you can mix both in the same record. On blank tables (no custom fields), missing field names are auto-created as text columns; so you can call createRecords directly after createTable without calling createField first. On tables with existing custom fields, unknown field names throw an error (use createField to add new columns first). The function translates field names to IDs before sending to the API, and translates field IDs back to human-readable names in the response. Output cell values are unwrapped (plain strings/numbers/booleans), and auto-populated fields like "Created At" and "Updated At" appear automatically. cellMetadata is present on output records only when at least one cell has metadata (e.g., isCoerced: true for auto-populated date fields); it is entirely absent from the record object otherwise (not an empty object). Record IDs must be unique across the entire table (not just the request); duplicates within a request return a 500 error, and duplicates with existing table records return a 400 error. Only populate fields with verified data; leave fields empty rather than guessing. FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    records: z
      .array(
        z.object({
          id: z
            .string()
            .optional()
            .describe(
              'Optional user-defined record ID. Must be unique across the entire table. Duplicate IDs within the request cause a 500 error; duplicating an existing table record ID causes a 400 error. Omit to let Clay auto-generate an ID.',
            ),
          cells: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              'Cell values keyed by field name (e.g., "Full Name") or field ID (f_xxx). You can mix both styles in the same record. Values are plain strings/numbers/booleans, NOT wrapped in {value: ...}. Omit or pass {} to create a record with only auto-populated fields (Created At, Updated At).',
            ),
        }),
      )
      .describe('Array of records to create'),
  }),
  output: z.object({
    records: z
      .array(ClayRecordOutputSchema)
      .describe(
        'Created records. Cell keys are translated from API field IDs (f_xxx) to human-readable field names. Cell values are unwrapped from the API\'s {value, metadata} format into plain values. Auto-populated fields (Created At, Updated At) are included. cellMetadata is present only when at least one cell has metadata (e.g., {"Created At": {"isCoerced": true}}).',
      ),
    totalCount: z.number().describe('Number of records created'),
  }),
};

export const deleteTableSchema = {
  name: 'deleteTable',
  description: 'Delete a table',
  notes:
    'DESTRUCTIVE: Deletes a table via the resources endpoint. By default performs soft delete (recoverable from trash). Set isPermanentDelete: true for permanent deletion (cannot be undone). On failure, throws an Error (never returns { success: false }). FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    tableId: z.string().describe('Table ID (t_xxx format)'),
    isPermanentDelete: z
      .boolean()
      .optional()
      .describe(
        'If true, permanently deletes the table (cannot be undone). If false or omitted, soft-deletes to trash (recoverable via restoreResource). Default: false',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe(
        'Always true on success. On failure the function throws an Error with a descriptive message (never returns { success: false })',
      ),
  }),
};

export const deleteWorkbookSchema = {
  name: 'deleteWorkbook',
  description: 'Soft-delete a workbook (moves to trash)',
  notes:
    'DESTRUCTIVE: Moves a workbook to trash via the resources endpoint. The workbook can be recovered using restoreResource. To see trashed workbooks, use listTrash. FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    workbookId: z.string().describe('Workbook ID (wb_xxx format)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether deletion succeeded'),
  }),
};

export const deleteRecordsSchema = {
  name: 'deleteRecords',
  description: 'Delete records from a table',
  notes:
    'DESTRUCTIVE: Permanently deletes specified records. This action cannot be undone. Multiple records can be deleted in a single request. Record IDs can be obtained via listRecordIds. Requires confirmDeletion: true. FREE operation. Idempotent: deleting already-deleted or non-existent record IDs succeeds silently (no error, no way to distinguish from a real deletion). On error (404), returns {type, message, details}.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    recordIds: z
      .array(z.string())
      .describe('Record IDs to delete (r_xxx format)'),
    confirmDeletion: z
      .literal(true)
      .describe(
        'Must be true to confirm deletion - prevents accidental data loss',
      ),
  }),
  output: z
    .object({})
    .describe(
      'Empty object on success. The API returns no body. On failure the function throws an Error (never returns an error object).',
    ),
};

export const listRecordIdsSchema = {
  name: 'listRecordIds',
  description: 'Get all record IDs in a table view',
  notes:
    'Returns a JSON object containing the record IDs. Both TABLE_ID and VIEW_ID must be provided. Use getTable() first to find the viewId (firstViewId on the table response). FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format, required)'),
    viewId: z
      .string()
      .describe(
        'View ID (gv_xxx format). Get from getTable() response firstViewId field.',
      ),
  }),
  output: z.object({
    recordIds: z
      .array(z.string())
      .describe(
        'Array of record IDs (r_xxx format). Empty array if table has no records.',
      ),
  }),
};

export const getTableRowCountSchema = {
  name: 'getTableRowCount',
  description: 'Count rows in a table',
  notes: 'Returns the total number of records in a table. FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
  }),
  output: z.object({
    tableTotalRecordsCount: z.number().describe('Total number of records'),
  }),
};

export const deleteAllRecordsSchema = {
  name: 'deleteAllRecords',
  description: 'Bulk delete all rows from a table view',
  notes:
    "DESTRUCTIVE: Permanently deletes ALL records in a view. Only records matching the view's filter criteria are affected. This action cannot be undone. Requires confirmDeletion: true. Use omitRecordIds to preserve specific records. Works on empty tables too (returns success). FREE operation.",
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    viewId: z
      .string()
      .describe(
        'View ID (gv_xxx format). Get from getTable() response firstViewId field.',
      ),
    confirmDeletion: z
      .literal(true)
      .describe(
        'Must be true to confirm deletion - prevents accidental data loss',
      ),
    omitRecordIds: z
      .array(z.string())
      .optional()
      .describe('Record IDs to preserve (exclude from deletion)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether deletion succeeded'),
  }),
};

export const runEnrichmentColumnSchema = {
  name: 'runEnrichmentColumn',
  description:
    'Run enrichment on table fields to populate data (COSTS CREDITS)',
  notes:
    '⚠️ COSTS CREDITS. Fire-and-forget: returns immediately after queuing. Tell the user enrichment is running, then poll getFieldRunStatus() or getFieldsRunStatus() every 5-10 seconds to check progress. ' +
    'Enrichment typically takes 30 seconds to 5 minutes depending on record count and provider response times. Give up polling after 10 minutes. ' +
    'fieldIds must be action/enrichment field IDs (f_xxx format) returned by createWaterfallEnrichment, addClaygentColumn, or similar; NOT merge/formula/input fields. ' +
    'Target records via viewId (all or top N) OR recordIds (specific records). If both are provided, recordIds takes precedence. ' +
    'Use forceRun: true to re-run enrichment even on cells that already have results. ' +
    'ALWAYS get user consent before calling. Check credit balance via getSubscription() first. ' +
    'Status values from getFieldRunStatus: SUCCESS (data found), SUCCESS_NO_DATA (provider ran but found nothing), PENDING, RUNNING, ERROR_RUN_CONDITION_NOT_MET, ERROR_ACTION_RUNTIME_ERROR, ERROR_BAD_REQUEST, null (not yet run).',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    fieldIds: z
      .array(z.string())
      .describe('Array of column identifiers (field IDs in f_xxx format)'),
    viewId: z
      .string()
      .optional()
      .describe(
        'View ID (gv_xxx format). Required if recordIds not provided. Runs enrichment on records in this view.',
      ),
    numRecords: z
      .number()
      .optional()
      .describe(
        'Number of top records to run from the view (optional - omit to run all records in view). Only used with viewId.',
      ),
    recordIds: z
      .array(z.string())
      .optional()
      .describe(
        'Specific record IDs (r_xxx format) to run enrichment on. Alternative to viewId; provide one or the other.',
      ),
    forceRun: z
      .boolean()
      .optional()
      .describe(
        'Force re-run enrichment even on cells that already have results. Useful for refreshing stale data.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether enrichment started successfully'),
  }),
};

export const createWaterfallEnrichmentSchema = {
  name: 'createWaterfallEnrichment',
  description: 'Add a waterfall email enrichment column to a table',
  notes:
    '⚠️ The column itself is free to create, but RUNNING it (via runEnrichmentColumn) COSTS CREDITS. ' +
    'Creates a waterfall column that tries multiple email-finding providers in sequence. ' +
    'Get field IDs from the fieldMap returned by getTableRecords, or from createPeopleTable/createCompanyTable. Requires field IDs for fullName, companyDomain, and optionally linkedInUrl and companyName. ' +
    'Always pass linkedInUrlFieldId when a LinkedIn URL column exists; it significantly improves match accuracy. ' +
    'After creating, use runEnrichmentColumn() with the returned action field IDs (from the fields array in the response) to start enrichment. ' +
    'Currently supports attributeEnum: "person/workEmail" for work email discovery.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    attributeEnum: z
      .enum(['person/workEmail'])
      .describe(
        'Enrichment type - currently only "person/workEmail" supported',
      ),
    waterfallFieldName: z
      .string()
      .describe('Name for the waterfall column (e.g., "Work Email")'),
    fullNameFieldId: z
      .string()
      .describe('Field ID for the Full Name column (f_xxx format)'),
    companyDomainFieldId: z
      .string()
      .describe('Field ID for the Company Domain column (f_xxx format)'),
    linkedInUrlFieldId: z
      .string()
      .optional()
      .describe(
        'Field ID for LinkedIn URL column (f_xxx format) - improves accuracy',
      ),
    companyNameFieldId: z
      .string()
      .optional()
      .describe(
        'Field ID for Company Name column (f_xxx format) - improves accuracy',
      ),
  }),
  output: z.object({
    fields: z.array(ClayFieldSchema).describe('Created enrichment fields'),
    fieldGroupMap: z
      .record(z.string(), z.unknown())
      .describe('Field group configuration'),
  }),
};

export const ClayFolderSchema = z.object({
  id: z.string().describe('Folder ID'),
  workspaceId: z.number().describe('Parent workspace ID'),
  name: z.string().describe('Folder name'),
  icon: z
    .object({ emoji: z.string().optional(), url: z.string().optional() })
    .nullable()
    .optional()
    .describe('Folder icon'),
  description: z.string().nullable().optional().describe('Folder description'),
  createdByUserId: z
    .string()
    .optional()
    .describe('User ID of the folder creator'),
  parentFolderId: z
    .string()
    .nullable()
    .optional()
    .describe('Parent folder ID if nested'),
  createdAt: z.string().describe('Creation timestamp'),
  updatedAt: z.string().describe('Last update timestamp'),
  deletedAt: z
    .string()
    .nullable()
    .optional()
    .describe('Deletion timestamp if soft-deleted'),
  abilities: z
    .object({
      canDelete: z.boolean().optional().describe('Whether user can delete'),
      canUpdate: z.boolean().optional().describe('Whether user can update'),
    })
    .optional()
    .describe('User permissions for this folder'),
  tags: z.array(z.string()).optional().describe('Tags applied to the folder'),
});

export const createFolderSchema = {
  name: 'createFolder',
  description: 'Create a folder in workspace',
  notes:
    'Creates a new folder in the specified workspace. Supports nested folders via parentFolderId. FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    name: z.string().describe('Folder name'),
    parentFolderId: z
      .string()
      .optional()
      .describe(
        'Parent folder ID to create a nested subfolder. Omit to create at workspace root.',
      ),
  }),
  output: ClayFolderSchema,
};

export const deleteFolderSchema = {
  name: 'deleteFolder',
  description:
    'Delete workspace resources (folders, tables, workbooks) in a single call',
  notes:
    'DESTRUCTIVE: Deletes specified resources. At least one of folderIds, tableIds, or workbookIds must be non-empty. Use isPermanentDelete: true for permanent deletion (cannot be undone); default is soft delete (recoverable via restoreResource). API returns HTTP 204 No Content; function returns { success: true }. On failure the function throws an Error (never returns { success: false }). FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    folderIds: z.array(z.string()).optional().describe('Folder IDs to delete'),
    tableIds: z
      .array(z.string())
      .optional()
      .describe('Table IDs to delete (t_xxx format)'),
    workbookIds: z
      .array(z.string())
      .optional()
      .describe('Workbook IDs to delete (wb_xxx format)'),
    isPermanentDelete: z
      .boolean()
      .optional()
      .describe(
        'If true, permanently deletes (cannot be undone). If false or omitted, soft-deletes to trash. Default: false',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe(
        'Always true on success (API returns 204 No Content). On failure the function throws an Error with a descriptive message',
      ),
  }),
};

export const ClayResourceSchema = z.object({
  id: z.string().describe('Resource ID'),
  name: z.string().describe('Resource name'),
  resourceType: z.string().describe('Resource type (TABLE, WORKBOOK, FOLDER)'),
});

export const searchResourcesSchema = {
  name: 'searchResources',
  description:
    'Search workspace resources (tables, workbooks, folders) by name substring match',
  notes:
    'Case-insensitive substring match on resource name. Returns only resources whose name contains the query. FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    query: z.string().describe('Search query string'),
  }),
  output: z.object({
    resources: z.array(ClayResourceSchema).describe('Matching resources'),
    totalCount: z.number().describe('Total number of results'),
  }),
};

export const ClaySourceSchema = z.object({
  id: z.string().describe('Source ID'),
  name: z.string().describe('Source name'),
  type: z.string().describe('Source type'),
});

export const listSourcesSchema = {
  name: 'listSources',
  description: 'List data sources on a table',
  notes:
    'Returns all data sources configured on a table, including webhook sources. FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
  }),
  output: z.object({
    sources: z.array(ClaySourceSchema).describe('Table data sources'),
    totalCount: z.number().describe('Total number of sources'),
  }),
};

export const deleteSourceSchema = {
  name: 'deleteSource',
  description: 'Delete a data source',
  notes:
    'DESTRUCTIVE: Deletes a data source. Set deleteRecords: true to also delete associated records. FREE operation but cannot be undone!',
  input: z.object({
    sourceId: z.string().describe('Source ID'),
    deleteRecords: z
      .boolean()
      .optional()
      .describe(
        'Whether to also delete records imported by this source. Optional, defaults to false.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether deletion succeeded'),
  }),
};

export const createPeopleTableSchema = {
  name: 'createPeopleTable',
  description:
    'Create a populated people table from search filters in one step',
  notes:
    'One-shot search: creates a workbook + table and populates it with up to 50 records from the first page of matching results. ' +
    'This is NOT a wizard-based import; it does a single search call (same as searchPeople) and inserts the results. ' +
    'Returns tableId, viewId, workbookId, and a fields map (field name → field ID) for use with createWaterfallEnrichment. ' +
    'The returned fields map contains: "First Name", "Last Name", "Full Name", "Job Title", "Company Name", "Location", "Company Domain", "LinkedIn Profile". ' +
    'IMPORTANT: People search tables do NOT have an Email column; emails must be enriched via createWaterfallEnrichment + runEnrichmentColumn. ' +
    'When importing enriched data from another tool (e.g., Apollo CSV with emails), use importCSV to create a spreadsheet table instead; spreadsheet tables auto-create columns from CSV headers including Email. ' +
    'Use the same filters as searchPeople(). FREE operation. ' +
    'IMPORTANT: Always call searchPeople() first to preview results. If the preview returns 0, adjust filters before creating a table ; createPeopleTable creates an empty table on 0 matches. Check recordCount in the response. ' +
    'NAMING: This function creates a generic "People Search" workbook/table name. Always call renameTable() + renameWorkbook() immediately after with a descriptive name matching the search criteria. ' +
    'SINGLE TABLE: When searching across multiple companies or criteria, use one createPeopleTable call with combined filters (e.g., company_identifier: ["glean.com", "spacex.com"]) ; do NOT create separate tables per company.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    filters: PeopleSearchFiltersSchema.optional().describe(
      'Search filters (same as searchPeople). Omit for an unfiltered table.',
    ),
    previewTaskId: z
      .string()
      .optional()
      .describe(
        'Task ID from a previous searchPeople preview (optional, improves speed)',
      ),
  }),
  output: z.object({
    workbookId: z.string().describe('Created workbook ID (wb_xxx format)'),
    tableId: z.string().describe('Created table ID (t_xxx format)'),
    viewId: z
      .string()
      .describe('Default view ID (gv_xxx format) for runEnrichmentColumn'),
    sourceId: z
      .string()
      .optional()
      .describe('Source ID (s_xxx format), if available'),
    fields: z
      .record(z.string(), z.string())
      .describe(
        'Map of field name → field ID. Keys: "First Name", "Last Name", "Full Name", "Job Title", "Company Name", "Location", "Company Domain", "LinkedIn Profile"',
      ),
    recordCount: z
      .number()
      .describe(
        'Number of records populated in the table. 0 means the search matched nobody; check your filters.',
      ),
  }),
};

export const createCompanyTableSchema = {
  name: 'createCompanyTable',
  description:
    'Create a populated company table from search filters in one step',
  notes:
    'Creates a workbook + table populated with company search results. ' +
    'Returns tableId, viewId, workbookId, and a fields map (field name → field ID). ' +
    'The returned fields map contains: "Name", "Domain", "Industry", "Size", "Location", "LinkedIn URL", "Description", "Revenue". ' +
    'Use the same filters as searchCompanies(). FREE operation. ' +
    'IMPORTANT: Always call searchCompanies() first to preview results. If the preview returns 0, adjust filters before creating a table ; createCompanyTable creates an empty table on 0 matches. Check recordCount in the response. ' +
    'NAMING: This function creates a generic "Company Search" workbook/table name. Always call renameTable() + renameWorkbook() immediately after with a descriptive name matching the search criteria. ' +
    'SINGLE TABLE: When searching across multiple industries or criteria, use one createCompanyTable call with combined filters ; do NOT create separate tables per criterion.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    filters: CompanySearchFiltersSchema.optional().describe(
      'Search filters (same as searchCompanies). Omit for an unfiltered table.',
    ),
    previewTaskId: z
      .string()
      .optional()
      .describe(
        'Task ID from a previous searchCompanies preview (optional, improves speed)',
      ),
  }),
  output: z.object({
    workbookId: z.string().describe('Created workbook ID (wb_xxx format)'),
    tableId: z.string().describe('Created table ID (t_xxx format)'),
    viewId: z.string().describe('Default view ID (gv_xxx format)'),
    sourceId: z
      .string()
      .optional()
      .describe('Source ID (s_xxx format), if available'),
    fields: z
      .record(z.string(), z.string())
      .describe(
        'Map of field name → field ID. Keys: "Name", "Domain", "Industry", "Size", "Location", "LinkedIn URL", "Description", "Revenue"',
      ),
    recordCount: z
      .number()
      .describe(
        'Number of records populated in the table. 0 means the search matched no companies; check your filters.',
      ),
  }),
};

export const sendToTableSchema = {
  name: 'sendToTable',
  description:
    'Send data from one table to another, optionally exploding lists into rows',
  notes:
    'Creates a "route-row" action field on the source table that copies data to a destination table. ' +
    'In "row" mode (default), each source row produces one destination row. ' +
    'In "list" mode, each item in a list/array field produces a separate destination row; this is how Clay\'s "Send a row for each item in a list" works. ' +
    'List mode requires the list field to contain native JSON data (from enrichments, claygents, or sources). Manually inserted JSON strings via createRecords may not be exploded correctly. ' +
    'fieldMapping maps destination column names to source field names or IDs. ' +
    'If destinationTableId is omitted, a new table is created in the same workbook. ' +
    'Set runImmediately: false to create the routing field without executing it. ' +
    'Partially async: the function polls for 3 seconds then returns successes/errors counts. If successes + errors < expected records, tell the user routing is still in progress and poll getFieldRunStatus() on routeFieldId every 5 seconds for definitive results. ' +
    'Each call creates a new action field; safe to call multiple times on the same source table. ' +
    'When sending to an existing table where destination column names match existing non-formula fields, Clay skips those columns; use updateRecords to copy data into the correct columns afterward if needed. ' +
    'FREE to create. Running consumes credits only if the route-row action triggers downstream enrichments on the destination table.',
  input: z.object({
    sourceTableId: z.string().describe('Source table ID (t_xxx format)'),
    workspaceId: WorkspaceIdParam,
    destinationTableId: z
      .string()
      .optional()
      .describe(
        'Existing destination table ID (t_xxx format). Omit to create a new table.',
      ),
    destinationTableName: z
      .string()
      .optional()
      .describe(
        'Name for the new destination table. Only used when destinationTableId is omitted.',
      ),
    workbookId: z
      .string()
      .optional()
      .describe(
        "Workbook ID for the new destination table. Defaults to the source table's workbook.",
      ),
    fieldMapping: z
      .record(z.string(), z.string())
      .describe(
        'Map of destination column name → source field reference. Source can be a field name (e.g., "Company Name") or field ID (e.g., "f_xxx"). Example: {"Company": "Company Name", "Email": "f_0ta9byz2q6s"}',
      ),
    mode: z
      .enum(['row', 'list'])
      .optional()
      .describe(
        '"row" (default): one destination row per source row. "list": one destination row per item in the list field.',
      ),
    listFieldId: z
      .string()
      .optional()
      .describe(
        'Field name or ID containing the list/array to explode. Required when mode is "list".',
      ),
    listPath: z
      .string()
      .optional()
      .describe(
        'JSON path within the list field to extract items from. Defaults to "results" (expects field value like {results: [...]}). For enrichment outputs that nest data under a different key, pass that key name.',
      ),
    viewId: z
      .string()
      .optional()
      .describe(
        "View ID to select records from. Optional; defaults to the table's default view.",
      ),
    numRecords: z
      .number()
      .optional()
      .describe('Max records to send. Defaults to 100 when using viewId.'),
    recordIds: z
      .array(z.string())
      .optional()
      .describe('Specific record IDs to send. Alternative to viewId.'),
    runImmediately: z
      .boolean()
      .optional()
      .describe(
        'Whether to execute the route immediately after creating the field. Defaults to true.',
      ),
  }),
  output: z.object({
    destinationTableId: z
      .string()
      .describe('Destination table ID (t_xxx format)'),
    destinationTableCreated: z
      .boolean()
      .describe('Whether a new destination table was created'),
    routeFieldId: z
      .string()
      .describe(
        'Field ID of the route-row action field created on the source table. Use with getFieldRunStatus to check definitive results.',
      ),
    workbookId: z
      .string()
      .nullable()
      .describe('Workbook ID containing the destination table'),
    ran: z
      .boolean()
      .describe(
        'Whether the route-row action was queued. true does NOT mean all rows succeeded; check successes/errors.',
      ),
    successes: z
      .number()
      .describe(
        'Number of rows that completed successfully (polled 3s after run). 0 if not yet finished; call getFieldRunStatus for definitive count.',
      ),
    errors: z
      .number()
      .describe(
        'Number of rows that errored (polled 3s after run). 0 if not yet finished; call getFieldRunStatus for definitive count.',
      ),
  }),
};

export type SendToTableInput = z.infer<typeof sendToTableSchema.input>;
export type SendToTableOutput = z.infer<typeof sendToTableSchema.output>;

export const renameTableSchema = {
  name: 'renameTable',
  description: 'Rename a table',
  notes: 'FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    name: z
      .string()
      .min(1)
      .max(128)
      .describe(
        'New name for the table (must be non-empty, max 128 characters)',
      ),
  }),
  output: z.object({
    id: z.string().describe('Table ID'),
    name: z.string().describe('Updated table name'),
  }),
};

export const renameWorkbookSchema = {
  name: 'renameWorkbook',
  description: 'Rename a workbook',
  notes: 'FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    workbookId: z.string().describe('Workbook ID (wb_xxx format)'),
    name: z.string().describe('New name for the workbook'),
  }),
  output: z.object({
    id: z.string().describe('Workbook ID'),
    name: z.string().describe('Updated workbook name'),
  }),
};

export const moveToFolderSchema = {
  name: 'moveToFolder',
  description:
    'Move workbooks into a folder (or to root by passing null folderId)',
  notes: 'FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    workbookIds: z.array(z.string()).describe('Workbook IDs to move'),
    folderId: z
      .string()
      .nullable()
      .describe('Target folder ID, or null to move to root'),
  }),
  output: z.object({
    resources: z
      .array(
        z.object({
          id: z.string().describe('Workbook ID'),
          name: z.string().describe('Workbook name'),
          parentFolderId: z
            .string()
            .nullable()
            .describe('New parent folder ID after move, null if at root'),
        }),
      )
      .describe('Moved workbooks with updated parent folder'),
    newParentFolder: z
      .object({
        id: z.string().nullable().describe('Target folder ID, null if root'),
        name: z
          .string()
          .nullable()
          .describe('Target folder name, null if root'),
      })
      .describe('The folder resources were moved into'),
  }),
};

export const listFoldersSchema = {
  name: 'listFolders',
  description:
    'List folders in a workspace, optionally scoped to a parent folder',
  notes:
    'Without parentFolderId, returns only root-level folders. Pass parentFolderId to list subfolders within a specific folder. FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    parentFolderId: z
      .string()
      .optional()
      .describe(
        'Folder ID to scope results to. When set, returns only direct child folders of this folder. Omit to list root-level folders.',
      ),
  }),
  output: z.object({
    folders: z.array(ClayFolderSchema).describe('List of folders'),
    totalCount: z.number().describe('Total number of folders'),
  }),
};

export const renameFolderSchema = {
  name: 'renameFolder',
  description: 'Rename a folder',
  notes: 'FREE operation.',
  input: z.object({
    folderId: z.string().describe('Folder ID'),
    name: z.string().describe('New name for the folder'),
  }),
  output: ClayFolderSchema,
};

export const updateRecordsSchema = {
  name: 'updateRecords',
  description: 'Update cell values in existing records',
  notes:
    'Updates cell values for existing records. Cell keys can be field names (e.g., "Full Name") or field IDs (f_xxx). Field names are auto-converted to field IDs before sending to the API. Values should be strings for text fields, numbers for numeric fields, or booleans for checkbox fields. Updates are enqueued asynchronously; success: true only means the server accepted the request, NOT that updates have been applied. The API response ({records: [], extraData: {message}}) never confirms whether individual record updates succeeded. Always call getTableRecords() after 2-3 seconds to verify updates were actually applied. FREE operation.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    records: z
      .array(
        z.object({
          id: z.string().describe('Record ID (r_xxx format)'),
          cells: z
            .record(z.string(), z.unknown())
            .describe(
              'Cell values keyed by field name (e.g., "Full Name") or field ID (f_xxx). Use strings for text fields, numbers for numeric fields, booleans for checkbox fields.',
            ),
        }),
      )
      .describe('Array of records to update with new cell values'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe(
        'Whether the update request was accepted (true = enqueued, not yet applied)',
      ),
    message: z
      .string()
      .describe(
        'Server message (typically "Record updates enqueued"). This confirms acceptance only; call getTableRecords() after 2-3 seconds to verify updates were applied.',
      ),
  }),
};

// ============================================================================
// Signals, Claygents, and App Accounts
// ============================================================================

export const ClaySignalSchema = z.object({
  id: z.string().describe('Signal ID (sig_xxx format)'),
  name: z
    .string()
    .describe('User-set signal name (e.g., "Test Job Change Signal")'),
  workspaceId: z.number().describe('Workspace ID this signal belongs to'),
  type: z
    .string()
    .describe(
      'Signal type: "JobChange", "NewHire", "Promotion", "JobPost", or "News"',
    ),
  runStatus: z
    .string()
    .describe(
      'Signal run status: "Active" = running, "Paused" = stopped, "Testing" = test mode',
    ),
  triggerDefinitionId: z
    .string()
    .describe('Trigger definition ID (td_xxx format)'),
  schedule: z
    .object({
      periodAmount: z.number().describe('Schedule period amount'),
      periodUnit: z.string().describe('Schedule period unit (e.g., "monthly")'),
    })
    .nullable()
    .describe('Signal schedule configuration, null if no schedule'),
  lastRunAt: z
    .string()
    .nullable()
    .describe('ISO timestamp of last signal run, null if never run'),
  nextRunAt: z
    .string()
    .nullable()
    .describe(
      'Computed ISO timestamp of next scheduled run based on lastRunAt + schedule period. Null if no schedule or never run.',
    ),
  outputWorkbookId: z
    .string()
    .nullable()
    .describe(
      'Output workbook ID (wb_xxx) where signal results are written. Use this with deleteWorkbook() when cleaning up a signal.',
    ),
  outputTableId: z
    .string()
    .nullable()
    .describe(
      'Output table ID (t_xxx) inside the output workbook where signal events land.',
    ),
  signalCost: z
    .object({
      cost: z.number().describe('Credit cost per signal run'),
      chargeUnit: z.string().describe('Charge unit, typically "run"'),
    })
    .nullable()
    .describe(
      'Credit cost for each signal run. Check this before activating a signal. Null if cost info unavailable.',
    ),
  settings: z
    .object({
      version: z.number().optional(),
      signalType: z
        .string()
        .optional()
        .describe('Signal type (matches top-level type)'),
      monitorType: z
        .string()
        .optional()
        .describe('Monitor type (e.g., "ActionValueMonitor")'),
      tableId: z
        .string()
        .optional()
        .describe('Source table ID the signal monitors (t_xxx format)'),
      viewId: z
        .string()
        .optional()
        .describe('Source view ID the signal monitors (gv_xxx format)'),
      actionPackageId: z
        .string()
        .optional()
        .describe('UUID of the enrichment action package'),
      actionKey: z
        .string()
        .optional()
        .describe(
          'Enrichment action key (e.g., "enrich-person-with-mixrank-v2-job-change-signal")',
        ),
      actionTaskResumeBehavior: z
        .string()
        .optional()
        .describe('Task resume behavior (e.g., "requeue")'),
      actionInputBindings: z
        .array(
          z
            .object({
              inputType: z
                .string()
                .describe(
                  '"Field" for table column bindings, "Static" for fixed values',
                ),
              name: z.string().describe('Input parameter name'),
              fieldId: z
                .string()
                .optional()
                .describe('Field ID when inputType is "Field" (f_xxx format)'),
              pathAsFormula: z
                .string()
                .optional()
                .describe('Formula reference when inputType is "Field"'),
              value: z
                .unknown()
                .optional()
                .describe('Static value when inputType is "Static"'),
            })
            .passthrough(),
        )
        .optional()
        .describe('Enrichment action input bindings'),
      initialValueInputBinding: z
        .unknown()
        .nullable()
        .optional()
        .describe('Initial value input binding, usually null'),
      eventOutputPaths: z
        .array(
          z.object({
            key: z.array(z.string()).describe('Output key path'),
            path: z
              .array(z.string())
              .describe('Data path in enrichment result'),
          }),
        )
        .optional()
        .describe('Paths extracted from enrichment results for event data'),
      eventDiffOutputKeys: z
        .object({
          diffPreviousValueKey: z
            .string()
            .describe('Key name for the previous value in diff events'),
          diffNewValueKey: z
            .string()
            .describe('Key name for the new value in diff events'),
        })
        .optional()
        .describe('Key names used in change diff events'),
      storedOutputPaths: z
        .array(
          z.object({
            key: z.array(z.string()).describe('Storage key path'),
            path: z.array(z.string()).describe('Data path to store'),
          }),
        )
        .optional()
        .describe('Paths from enrichment results stored for future comparison'),
      watchedOutputPaths: z
        .object({
          type: z.string().describe('Watch type (e.g., "paths")'),
          combinationMode: z
            .string()
            .describe('"All" requires all paths to change, "Any" requires one'),
          paths: z
            .array(
              z
                .object({
                  path: z
                    .array(z.string())
                    .describe('Data path to watch for changes'),
                  monitorValueComparator: z
                    .string()
                    .describe(
                      'Comparison method: "CompanyLinkedInUrl", "SimilarString", etc.',
                    ),
                })
                .passthrough(),
            )
            .describe('Paths to monitor for changes'),
          exceptPaths: z
            .array(z.unknown())
            .optional()
            .describe('Paths excluded from monitoring'),
        })
        .optional()
        .describe(
          'Output paths monitored for changes to trigger signal events',
        ),
      shouldEmitInitialCheckEvents: z
        .boolean()
        .optional()
        .describe('Whether to emit events on the initial enrichment check'),
    })
    .passthrough()
    .describe(
      'Signal configuration settings including monitoring config, action bindings, and output paths',
    ),
  inputs: z
    .object({
      type: z.string().optional().describe('Input type matching signal type'),
      viewId: z
        .string()
        .optional()
        .describe('View ID for the source data (gv_xxx format)'),
      tableId: z
        .string()
        .optional()
        .describe('Table ID for the source data (t_xxx format)'),
      personIdentifier: z
        .object({
          fieldId: z
            .string()
            .describe(
              'Field ID containing person identifier, e.g., LinkedIn URL (f_xxx format)',
            ),
          pathAsFormula: z
            .string()
            .describe('Formula reference to the field (e.g., "{{f_xxx}}")'),
        })
        .nullable()
        .optional()
        .describe(
          'Person identifier field binding. Present for people signals (JobChange, NewHire, Promotion).',
        ),
      initialCompanyIdentifier: z
        .unknown()
        .nullable()
        .optional()
        .describe(
          'Company identifier for initial enrichment comparison, usually null',
        ),
      lookBackTimeWindowInMonths: z
        .number()
        .optional()
        .describe(
          'How many months back to check for changes on initial run (e.g., 3)',
        ),
    })
    .passthrough()
    .describe(
      'Signal input configuration including person/company identifiers and lookback windows',
    ),
});

export const listSignalsSchema = {
  name: 'listSignals',
  description: 'List signals in workspace',
  notes:
    'Returns all signals configured in the workspace with their names, schedules, and run status. FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
  }),
  output: z.object({
    signals: z.array(ClaySignalSchema).describe('List of signals'),
    totalCount: z.number().describe('Total number of signals'),
  }),
};

export const getSignalSchema = {
  name: 'getSignal',
  description: 'Get a single signal by ID from a workspace',
  notes:
    'Returns full signal configuration including settings, inputs, schedule, and run status. Get signal IDs from listSignals(). Only returns signals that have trigger definitions configured (all signals created via createSignal() have them). FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    signalId: z.string().describe('Signal ID (sig_xxx format)'),
  }),
  output: ClaySignalSchema,
};

export const updateSignalSchema = {
  name: 'updateSignal',
  description:
    'Update a signal configuration including run status, schedule frequency, name, or filter settings',
  notes:
    'Signals are backed by trigger definitions. This resolves the signalId to a triggerDefinitionId automatically; throws an error if the signal is not found in the workspace. Pass only the fields you want to change. Use runNow: true to trigger an immediate signal run (costs credits). Schedule updates use a separate API endpoint from name/status/settings changes. Schedule changes require a paid plan; on trial/free plans the API silently ignores the change and this function throws an error. Settings are shallow-merged with existing settings (keys you pass replace existing keys; keys you omit are preserved). Output includes read-only fields like numQueuePartitions that are not settable via this function. FREE operation (no credits consumed), except runNow which triggers a credit-costing signal run.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    signalId: z.string().describe('Signal ID (sig_xxx format)'),
    runStatus: z
      .enum(['Active', 'Testing', 'Paused', 'Errored', 'Disabled', 'Preview'])
      .optional()
      .describe(
        'Signal run status. "Active" = running, "Paused" = stopped, "Testing" = test mode, "Preview" = preview only',
      ),
    name: z
      .string()
      .min(1)
      .optional()
      .describe('New display name for the signal (must be non-empty)'),
    schedule: z
      .object({
        periodAmount: z
          .number()
          .describe('Number of period units between runs (e.g., 1)'),
        periodUnit: z
          .enum(['daily', 'weekly', 'monthly'])
          .describe('Schedule frequency unit'),
      })
      .optional()
      .describe(
        'Update the signal check frequency. Throws an error if the change is rejected (e.g., plan restriction)',
      ),
    settings: z
      .object({
        filter: z
          .object({
            type: z.string().optional(),
            items: z.array(z.record(z.string(), z.unknown())).optional(),
            combinationMode: z
              .enum(['And', 'Or'])
              .optional()
              .describe('How to combine filter conditions'),
          })
          .passthrough()
          .optional()
          .describe('Filter conditions for signal events'),
        sourceIds: z
          .array(z.string())
          .optional()
          .describe('Source IDs (s_xxx format) the signal monitors'),
      })
      .passthrough()
      .optional()
      .describe(
        'Trigger definition settings (filters, source bindings). Shallow-merged: keys you pass replace existing keys, keys you omit are preserved. Arrays (e.g., sourceIds) replace rather than concatenate.',
      ),
    runNow: z
      .boolean()
      .optional()
      .describe(
        'Set true to trigger an immediate signal run. Can be combined with other updates or used alone. COSTS CREDITS per run.',
      ),
  }),
  output: z.object({
    id: z.string().describe('Trigger definition ID (td_xxx format)'),
    workspaceId: z.number().describe('Workspace ID'),
    name: z.string().describe('Signal display name'),
    signalId: z.string().describe('Signal ID (sig_xxx format)'),
    runStatus: z
      .string()
      .describe(
        'Current run status: Active, Testing, Paused, Errored, Disabled, or Preview',
      ),
    schedule: z
      .object({
        periodAmount: z
          .number()
          .describe('Number of period units between runs'),
        periodUnit: z.string().describe('Schedule frequency unit'),
      })
      .nullable()
      .describe('Signal schedule configuration, null if no schedule set'),
    settings: z
      .record(z.string(), z.unknown())
      .describe(
        'Trigger definition settings including sourceIds and numQueuePartitions',
      ),
    createdAt: z.string().describe('ISO 8601 creation timestamp'),
    updatedAt: z.string().describe('ISO 8601 last update timestamp'),
    deletedAt: z
      .string()
      .nullable()
      .describe('ISO 8601 deletion timestamp, null if not deleted'),
    lastRunAt: z
      .string()
      .nullable()
      .describe(
        'ISO 8601 timestamp of last trigger definition run. This is the trigger definition timestamp, not the signal-level lastRunAt; it may be null immediately after triggering (before the run completes) even if the signal itself has a lastRunAt value.',
      ),
  }),
};

export const deleteSignalSchema = {
  name: 'deleteSignal',
  description: 'Delete a signal from a workspace',
  notes:
    'DESTRUCTIVE: Permanently deletes a signal (trigger definition) and its associated event column. Cannot be undone. WARNING: Deleting a signal does NOT delete its output workbook; the workbook remains in the workspace as an orphan. To clean up properly: (1) call getSignal() or listSignals() to get the outputWorkbookId, (2) call deleteSignal() to remove the signal, (3) THEN call deleteWorkbook() on the orphaned workbook. This order matters; deleting the workbook cascades and destroys the signal\'s trigger definition, causing deleteSignal() to fail with "No trigger definition found". FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    signalId: z.string().describe('Signal ID (sig_xxx format)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether deletion succeeded'),
  }),
};

export const createSignalSchema = {
  name: 'createSignal',
  description:
    'Create a new signal to monitor contacts or companies for built-in change events: job changes, new hires, promotions, news, or job postings. For external data sources (RSS feeds, social media, GitHub, Google Search, LinkedIn brand mentions, etc.), use createCustomSignal().',
  notes:
    'createSignal monitors BUILT-IN change events on an existing people or company table you already own (JobChange, NewHire, Promotion, JobPost, News). For EXTERNAL data sources (RSS, social media, GitHub, etc.), use createCustomSignal() instead. The originTableId must contain a person identifier field (e.g., LinkedIn Profile URL) for people signals, or a company identifier field for company signals. The signal starts in Paused state by default; use updateSignal() with runStatus "Active" to activate it. Signal creation requires a paid Clay plan (free plans get 402 error). COSTS CREDITS when the signal runs (not at creation). More frequent schedules and more monitored records = higher credit cost. Get field IDs from getTable().fields[].id; the field should contain LinkedIn URLs (https://linkedin.com/in/...) or emails for people, or company domains (clay.com) for companies. Signal output workbooks are created at the workspace root by default. Use moveToFolder() to organize them into the same folder as the source table workbook.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    signalType: z
      .enum(['JobChange', 'NewHire', 'JobPost', 'Promotion', 'News'])
      .describe(
        'Signal type. JobChange = monitors tracked people for job/company changes. NewHire = monitors tracked people and detects when they start new positions (requires personIdentifierFieldId, same as JobChange). Promotion = monitors tracked people for title promotions. JobPost = monitors tracked companies for new job postings (requires companyIdentifierFieldId). News = monitors tracked companies for news/fundraising (requires companyIdentifierFieldId). People signals (JobChange, NewHire, Promotion) require personIdentifierFieldId. Company signals (JobPost, News) require companyIdentifierFieldId.',
      ),
    name: z
      .string()
      .optional()
      .describe(
        'Display name for the signal. Defaults to the signal type name if not provided.',
      ),
    originTableId: z
      .string()
      .describe(
        'Table ID (t_xxx) of the existing table with contacts/companies to monitor. Must contain a person or company identifier field.',
      ),
    originViewId: z
      .string()
      .optional()
      .describe(
        'View ID (gv_xxx) from the origin table. If omitted, uses the first view.',
      ),
    personIdentifierFieldId: z
      .string()
      .optional()
      .describe(
        'Field ID (f_xxx) of a LinkedIn Profile URL or email field in the origin table. Required for people signals (JobChange, NewHire, Promotion). The field must exist in the origin table and contain LinkedIn Profile URLs or email addresses for the people to monitor. Get field IDs from getTable().',
      ),
    companyIdentifierFieldId: z
      .string()
      .optional()
      .describe(
        'Field ID (f_xxx) of a company domain or LinkedIn URL field in the origin table. Required for company signals (JobPost, News). The field must exist in the origin table and contain company domains (e.g., "clay.com") or LinkedIn company URLs. Get field IDs from getTable().',
      ),
    lookBackTimeWindowInMonths: z
      .number()
      .optional()
      .describe(
        'How many months back to check for initial events on first run. Must be a positive integer (minimum 1). Defaults to 3.',
      ),
    schedule: z
      .object({
        periodAmount: z
          .number()
          .describe(
            'Number of period units between runs. Must be a positive integer (minimum 1). Example: periodAmount=2 with periodUnit="weekly" means every 2 weeks.',
          ),
        periodUnit: z
          .enum([
            'minute',
            'fifteen-minutes',
            'hourly',
            'daily',
            'weekly',
            'biweekly',
            'monthly',
            'quarterly',
          ])
          .describe('Schedule frequency unit'),
      })
      .optional()
      .describe(
        'How often to check for signal events. Defaults to monthly if not specified. More frequent schedules consume more credits per run cycle.',
      ),
    parentFolderId: z
      .string()
      .optional()
      .describe(
        'Folder ID to place the signal workbook in. If omitted, created at workspace root.',
      ),
  }),
  output: z.object({
    signalId: z
      .string()
      .describe(
        'Signal ID (sig_xxx format). Use this with updateSignal() and deleteSignal() to manage the signal.',
      ),
    triggerDefinitionId: z
      .string()
      .describe(
        'Trigger definition ID (td_xxx format). Internal ID linking the signal to its schedule and configuration.',
      ),
    sourceId: z
      .string()
      .describe(
        'Source ID (s_xxx format). Identifies the data source binding between the origin table and the signal.',
      ),
    tableId: z
      .string()
      .describe(
        'Signal output table ID (t_xxx) where detected events will be written. Use with getTableRecords() to read signal results.',
      ),
    workbookId: z
      .string()
      .describe(
        'Workbook ID (wb_xxx) containing the signal output table. Use with listWorkbookTables() to see related tables.',
      ),
    name: z.string().describe('Display name of the created signal'),
    signalType: z.string().describe('Signal type (e.g., "JobChange")'),
    runStatus: z
      .string()
      .describe(
        'Initial run status (always "Paused"). Use updateSignal() with runStatus "Active" to start monitoring.',
      ),
  }),
};

export const CustomSignalSourceTypeSchema = z.object({
  actionKey: z
    .string()
    .describe('Internal action key used when creating the signal'),
  actionPackageId: z.string().describe('Package ID for the action'),
  name: z
    .string()
    .describe('Human-readable name of the source type (server-facing)'),
  iconType: z.string().describe('Icon type identifier used by the wizard API'),
  category: z
    .enum(['social', 'first_party', 'sourcing', 'other'])
    .describe('Source category'),
  description: z.string().describe('What this source monitors or imports'),
  authRequired: z
    .boolean()
    .describe('Whether a connected app account is required'),
  authType: z
    .string()
    .optional()
    .describe(
      'Type of app account required (e.g., "reddit", "linkedin") if authRequired is true',
    ),
  requiredInputs: z
    .array(z.string())
    .describe(
      'Required sourceInputs keys for createCustomSignal(). E.g., ["url"] for RSS, ["query"] for Google Search, ["handle"] for X followers.',
    ),
});

export const listCustomSignalSourceTypesSchema = {
  name: 'listCustomSignalSourceTypes',
  description:
    'List all available custom signal source types with their categories, descriptions, and auth requirements. Returns static metadata; no API call needed. Use this to discover what custom signal sources are available before calling createCustomSignal().',
  notes: '',
  input: z.object({
    category: z
      .enum(['social', 'first_party', 'sourcing', 'other'])
      .optional()
      .describe('Filter by category. Omit to return all source types.'),
  }),
  output: z.object({
    sourceTypes: z
      .array(CustomSignalSourceTypeSchema)
      .describe('Available custom signal source types'),
    totalCount: z.number().describe('Total number of source types returned'),
  }),
};

export const createCustomSignalSchema = {
  name: 'createCustomSignal',
  description:
    'Create a custom signal using the wizard API. Custom signals monitor external data sources like social media, RSS feeds, Google Search, GitHub repos, and more. Use listCustomSignalSourceTypes() first to discover available source types and their required inputs.',
  notes:
    'createCustomSignal is for EXTERNAL data sources (RSS, social media, GitHub, Google Search, LinkedIn brand mentions, etc.). For BUILT-IN change events on an existing table, use createSignal() instead. The sourceType must be a valid actionKey from listCustomSignalSourceTypes(). Each source type has different required sourceInputs; call listCustomSignalSourceTypes() to see requiredInputs keys (e.g., "url" for RSS, "query" for Google Search), descriptions, and auth requirements for each. COSTS CREDITS when the signal runs (not at creation). Sources requiring auth need a connected app account; use listAppAccounts() to find existing accounts or getAppAccountTypes() to see what can be connected. Custom signals may auto-run an initial validation check immediately after creation regardless of Paused status. If sourceInputs are invalid (e.g., bad RSS URL), the signal will show Errored status within seconds; this is normal; fix inputs via updateSignal() or delete and recreate. The schedule parameter sets the trigger-level schedule. The source type\'s internal scheduleConfig may show a different default (e.g., daily); the trigger-level schedule takes precedence for actual run timing.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    sourceType: z
      .string()
      .describe(
        'Action key of the custom signal source type (e.g., "rss-feed-fetcher-source", "x-mentions-source", "reddit-search-source"). Get valid values from listCustomSignalSourceTypes().',
      ),
    sourceInputs: z
      .record(z.string(), z.unknown())
      .describe(
        'Source-specific input parameters as key-value pairs. Each source type requires different inputs (e.g., RSS needs "url", X mentions needs keywords, Google Search needs a query). Check Clay UI or source type descriptions for required inputs.',
      ),
    appAccountId: z
      .string()
      .optional()
      .describe(
        'App account ID for sources requiring authentication (e.g., Reddit, LinkedIn, Snowflake). Get from listAppAccounts(). Required when the source type has authRequired=true.',
      ),
    schedule: z
      .object({
        periodAmount: z
          .number()
          .describe('Number of period units between runs'),
        periodUnit: z
          .enum([
            'minute',
            'fifteen-minutes',
            'hourly',
            'daily',
            'weekly',
            'biweekly',
            'monthly',
            'quarterly',
          ])
          .describe('Schedule frequency unit'),
      })
      .optional()
      .describe(
        'How often to check for new data. Defaults to daily if not specified.',
      ),
    name: z
      .string()
      .optional()
      .describe(
        'Display name for the signal. Auto-generated from source type if not provided.',
      ),
    parentFolderId: z
      .string()
      .optional()
      .describe(
        'Folder ID to place the signal workbook in. If omitted, created at workspace root.',
      ),
  }),
  output: z.object({
    signalId: z
      .string()
      .describe(
        'Signal ID. Use with getSignal(), updateSignal(), deleteSignal().',
      ),
    tableId: z
      .string()
      .describe(
        'Output table ID where signal results are written. Use with getTableRecords().',
      ),
    workbookId: z
      .string()
      .describe('Workbook ID containing the signal output table.'),
    sourceId: z.string().describe('Source ID for the data source binding.'),
    name: z.string().describe('Display name of the created signal'),
    runStatus: z
      .string()
      .describe(
        'Initial run status (always "Paused"). Use updateSignal() with runStatus "Active" to start monitoring.',
      ),
  }),
};

export const ClaygentOutputFieldSchema = z.object({
  type: z
    .enum(['string', 'number', 'boolean', 'array'])
    .describe(
      'Field data type. "string" for text, "number" for numeric, "boolean" for true/false, "array" for lists',
    ),
  description: z
    .string()
    .optional()
    .describe('Description of this output field'),
  id: z.string().optional().describe('Field UUID. Auto-generated if omitted'),
  options: z
    .string()
    .optional()
    .describe('Additional options (auto-filled if omitted)'),
});

export const ClaygentOutputFormatSchema = z.object({
  type: z
    .enum(['json'])
    .describe('Output type. Currently only "json" is supported'),
  jsonType: z
    .enum(['Fields', 'JSONSchema'])
    .describe(
      'JSON format type. "Fields" for named output fields, "JSONSchema" for raw JSON schema string',
    ),
  fields: z
    .record(z.string(), ClaygentOutputFieldSchema)
    .optional()
    .describe(
      'Output fields keyed by field name (used when jsonType is "Fields"). Example: {"summary": {"type": "string", "description": "A summary"}}',
    ),
  jsonSchema: z
    .string()
    .optional()
    .describe('Raw JSON schema string (used when jsonType is "JSONSchema")'),
});

export const ClayClaygentVersionSchema = z.object({
  id: z.string().describe('Version ID (cv_xxx format)'),
  versionNumber: z.number().describe('Version number'),
  claygentId: z.string().describe('Parent claygent ID'),
  userPrompt: z
    .string()
    .describe('The user prompt / instructions for this claygent'),
  variables: z
    .array(z.unknown())
    .describe(
      'Input variables configured for this claygent (each is a variable definition object)',
    ),
  modelSettings: z
    .object({
      model: z
        .string()
        .describe(
          'AI model identifier (e.g., "clay-argon", "gpt-4o", "claude-sonnet-4-6", "gemini-2.5-flash")',
        ),
      useCase: z
        .string()
        .optional()
        .describe('Use case identifier (e.g., "\\"claygent\\"")'),
      internetSearchEnabled: z
        .boolean()
        .optional()
        .describe('Whether internet search is enabled'),
    })
    .describe('Model configuration'),
  toolSettings: z
    .record(z.string(), z.unknown())
    .describe(
      'Tool settings keyed by tool name (e.g., web browsing, code execution config)',
    ),
  outputFormat: ClaygentOutputFormatSchema.nullable().describe(
    'Structured output format configuration, or null if not configured',
  ),
  summary: z.string().nullable().describe('Version summary'),
  isPublished: z.boolean().describe('Whether this version is published'),
  createdBy: z.string().describe('User ID who created this version'),
  createdAt: z.string().describe('Creation timestamp'),
  updatedAt: z.string().describe('Last update timestamp'),
});

export const ClayClaygentSchema = z.object({
  id: z.string().describe('Claygent ID (c_xxx format)'),
  workspaceId: z.number().describe('Workspace ID'),
  name: z.string().describe('Claygent name'),
  description: z.string().nullable().describe('Claygent description'),
  currentVersionId: z.string().describe('Current version ID (cv_xxx format)'),
  createdBy: z.string().describe('User ID who created this claygent'),
  createdAt: z.string().describe('Creation timestamp'),
  updatedAt: z.string().describe('Last update timestamp'),
  publishedAt: z
    .string()
    .nullable()
    .describe('Publish timestamp. null = draft, non-null = published'),
  currentVersion: ClayClaygentVersionSchema.describe(
    'Full current version object with prompt, model settings, and tool config',
  ),
});

export const listClaygentsSchema = {
  name: 'listClaygents',
  description:
    'List all claygents in a workspace with their versions, prompts, and model settings',
  notes:
    'FREE operation. publishedAt is null for drafts, non-null for published claygents.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
  }),
  output: z.object({
    claygents: z.array(ClayClaygentSchema).describe('List of claygents'),
    totalCount: z.number().describe('Total number of claygents'),
  }),
};

export const getClaygentSchema = {
  name: 'getClaygent',
  description: 'Get a single claygent (AI agent) by ID from a workspace',
  notes:
    'FREE operation. Returns full claygent details including current version with prompt, model settings, tool settings, and output format. Use this to inspect a claygent before running it with runClaygent(), especially to discover required variables.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    claygentId: z.string().describe('Claygent ID (c_xxx format)'),
  }),
  output: ClayClaygentSchema,
};

export const createClaygentSchema = {
  name: 'createClaygent',
  description:
    'Create a new claygent (AI agent) in a workspace with prompt, model, output format, and tool settings',
  notes:
    'FREE operation. Set markAsPublished: true to publish immediately, false (default) to save as draft. The outputFormat.fields object keys are the output field names.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    name: z.string().describe('Claygent name'),
    userPrompt: z
      .string()
      .describe('The prompt/instructions for this claygent'),
    description: z
      .string()
      .optional()
      .describe('Agent description. Visible on the claygents list page'),
    model: z
      .string()
      .optional()
      .describe(
        'Model identifier string. If omitted, Clay uses its default model. Clay models: "clay-helium" (1 credit, fastest), "clay-neon" (2 credits), "clay-argon" (3 credits, recommended). OpenAI: "gpt-4o" (3 credits), "gpt-4o-mini" (1 credit), "gpt-4.1-mini" (1 credit). Anthropic: "claude-sonnet-4-6" (15 credits), "claude-haiku-4-5" (3 credits). Google: "gemini-2.5-flash" (1 credit). WARNING: The API accepts any string without validation; invalid identifiers cause execution failures. Credit costs are per-run.',
      ),
    internetSearchEnabled: z
      .boolean()
      .optional()
      .describe('Enable web search tool for the agent. Defaults to true'),
    outputFormat: ClaygentOutputFormatSchema.optional().describe(
      'Output format configuration. If omitted, claygent has no structured output',
    ),
    variables: z
      .array(z.unknown())
      .optional()
      .describe(
        'Input variables for the claygent (each is a variable definition object). Empty array if none',
      ),
    toolSettings: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Tool settings keyed by tool name. Empty object ({}) if no custom tools',
      ),
    markAsPublished: z
      .boolean()
      .optional()
      .describe(
        'Whether to publish the claygent immediately. true = published (publishedAt set), false = draft (default)',
      ),
  }),
  output: z.object({
    id: z.string().describe('Created claygent ID (c_xxx format)'),
    workspaceId: z.number().describe('Workspace ID'),
    name: z.string().describe('Claygent name'),
    description: z.string().nullable().describe('Claygent description'),
    currentVersionId: z.string().describe('Current version ID (cv_xxx format)'),
    createdBy: z.string().describe('User ID who created this claygent'),
    createdAt: z.string().describe('Creation timestamp'),
    updatedAt: z.string().describe('Last update timestamp'),
    publishedAt: z
      .string()
      .nullable()
      .describe('Publish timestamp. null = draft, non-null = published'),
    currentVersion: ClayClaygentVersionSchema.describe(
      'Full current version object with prompt, model settings, and tool config',
    ),
  }),
};

export const updateClaygentSchema = {
  name: 'updateClaygent',
  description:
    "Update an existing claygent's name, description, prompt, model settings, output format, or publish status",
  notes:
    'FREE operation. Only pass the fields you want to change; all update fields are optional. Changes to version-related fields (userPrompt, model, internetSearchEnabled, outputFormat, variables, toolSettings) create a new version with an incremented versionNumber. Note: after markAsPublished=true, the top-level publishedAt is set but currentVersion.isPublished may remain false; use publishedAt (not isPublished) to determine publish status.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    claygentId: z.string().describe('Claygent ID (c_xxx format)'),
    name: z.string().optional().describe('New claygent name'),
    userPrompt: z
      .string()
      .optional()
      .describe('New prompt/instructions for this claygent'),
    description: z
      .string()
      .optional()
      .describe('New agent description. Visible on the claygents list page'),
    model: z
      .string()
      .optional()
      .describe(
        'Model identifier string. Clay models: "clay-helium" (1 credit, fastest), "clay-neon" (2 credits), "clay-argon" (3 credits, recommended). OpenAI: "gpt-4o" (3 credits), "gpt-4o-mini" (1 credit), "gpt-4.1" (12 credits), "gpt-4.1-mini" (1 credit), "gpt-4.1-nano" (0.5 credits), "gpt-5" (4 credits), "gpt-5-mini" (1 credit), "o3" (15 credits), "o4-mini" (15 credits). Anthropic: "claude-sonnet-4-6" (15 credits), "claude-haiku-4-5" (3 credits), "claude-opus-4-6" (20 credits). Google: "gemini-2.5-pro" (5 credits), "gemini-2.5-flash" (1 credit). WARNING: The API accepts any string without validation at update time; invalid model identifiers will cause execution failures when running the claygent. Credit costs are per-run.',
      ),
    internetSearchEnabled: z
      .boolean()
      .optional()
      .describe('Enable or disable web search tool for the agent'),
    outputFormat: ClaygentOutputFormatSchema.optional().describe(
      'New output format configuration',
    ),
    variables: z
      .array(z.unknown())
      .optional()
      .describe(
        'New input variables for the claygent (each is a variable definition object)',
      ),
    toolSettings: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('New tool settings keyed by tool name'),
    markAsPublished: z
      .boolean()
      .optional()
      .describe(
        'Whether to publish the claygent. true = published (publishedAt set), false = draft',
      ),
  }),
  output: z.object({
    id: z.string().describe('Claygent ID (c_xxx format)'),
    workspaceId: z.number().describe('Workspace ID'),
    name: z.string().describe('Claygent name'),
    description: z.string().nullable().describe('Claygent description'),
    currentVersionId: z.string().describe('Current version ID (cv_xxx format)'),
    createdBy: z.string().describe('User ID who created this claygent'),
    createdAt: z.string().describe('Creation timestamp'),
    updatedAt: z.string().describe('Last update timestamp'),
    publishedAt: z
      .string()
      .nullable()
      .describe('Publish timestamp. null = draft, non-null = published'),
    currentVersion: ClayClaygentVersionSchema.describe(
      'Full current version object; may be a new version if version-related fields were changed',
    ),
  }),
};

export const deleteClaygentSchema = {
  name: 'deleteClaygent',
  description:
    'Permanently delete a claygent (AI agent) from a workspace. DESTRUCTIVE; cannot be undone. Use getClaygent() first to verify you have the correct claygent before deleting.',
  notes:
    'DESTRUCTIVE: Permanently deletes the claygent and all its versions. Cannot be undone. ' +
    'Always call getClaygent() first to confirm the claygent name/details before deleting. FREE operation. ' +
    'Throws on failure; if the claygent does not exist (404), the workspace is invalid (400), or you lack permission, ' +
    'the function throws an Error instead of returning {success: false}. ' +
    'A return value of {success: true} means the deletion was confirmed by the API.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    claygentId: z
      .string()
      .describe(
        'Claygent ID to delete (c_xxx format, e.g., "c_0tab2gq2Vm5fEsNEARW"). Get from listClaygents() or getClaygent().',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe(
        'Always true on success. The function throws an Error on any failure (404 not found, 400 bad request, 403 forbidden) rather than returning {success: false}.',
      ),
  }),
};

export const runClaygentSchema = {
  name: 'runClaygent',
  description:
    'Start a claygent (AI agent) run and return a runId for tracking. Does NOT wait for completion; use getClaygentRun() to poll for results.',
  notes:
    'COSTS CREDITS. Fire-and-forget: submits the run and returns immediately with a runId. After calling this, tell the user the claygent is running, then poll getClaygentRun() every 3-5 seconds. Stop polling after 60 seconds of PENDING; if still PENDING after 60s, tell the user the run may have stalled and to check the Clay UI. getClaygentRun() is instant and free. Use getClaygent() first to inspect variables if the claygent requires inputs.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    claygentId: z.string().describe('Claygent ID (c_xxx format) to run'),
    variableValues: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Variable values keyed by variable name, e.g. {"company_name": "Acme Corp", "role": "engineer"}. Use getClaygent() to discover which variables are defined. Pass {} or omit if the claygent has no variables.',
      ),
  }),
  output: z.object({
    runId: z
      .string()
      .describe('Unique run ID. Pass to getClaygentRun() to poll for results.'),
  }),
};

export const getClaygentRunSchema = {
  name: 'getClaygentRun',
  description:
    'Check the status of a claygent run by its runId. Use after runClaygent() returns TIMEOUT status to check if the run completed.',
  notes:
    'FREE, instant check; single GET request, returns immediately. PENDING if still running, SUCCESS or ERROR when complete. Poll every 3-5 seconds. Give up after 60 seconds of PENDING; the run may have stalled. The runId comes from a previous runClaygent() call.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    runId: z
      .string()
      .describe(
        'Run ID from a previous runClaygent() call. Format: "playground-run-xxxxxxxx".',
      ),
  }),
  output: z.object({
    status: z
      .enum(['SUCCESS', 'ERROR', 'PENDING'])
      .describe(
        'Run status: "SUCCESS" when complete, "ERROR" on failure, "PENDING" if still running.',
      ),
    runId: z.string().describe('Run ID'),
    textPreview: z
      .string()
      .nullable()
      .describe('Text preview of the agent response. Null while PENDING.'),
    message: z
      .string()
      .nullable()
      .describe(
        'Status message. Null on success, contains error details on ERROR, contains progress info while PENDING.',
      ),
    fullValue: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe('Full structured output from the agent. Null while PENDING.'),
    confidence: z
      .string()
      .nullable()
      .describe('Agent confidence level. Null while PENDING.'),
    additionalCreditCost: z
      .number()
      .nullable()
      .describe('Credits consumed by this run. Null while PENDING.'),
    model: z
      .string()
      .nullable()
      .describe('AI model that was actually used. Null while PENDING.'),
    tokensUsed: z
      .number()
      .nullable()
      .describe('Total tokens consumed. Null while PENDING.'),
    imagePreview: z
      .string()
      .nullable()
      .describe('Image preview URL. Null while PENDING.'),
  }),
};

export const addClaygentColumnSchema = {
  name: 'addClaygentColumn',
  description:
    'Add a published claygent as an enrichment column on an existing table. Maps claygent input variables to table fields. After adding, use runEnrichmentColumn() with the returned fieldId to execute the claygent per-row.',
  notes:
    'The claygent MUST be published (publishedAt is not null) before it can be added as a column. Use updateClaygent() with markAsPublished: true first. Creating the column is FREE; only running it via runEnrichmentColumn() costs credits. The inputMappings array maps each claygent variable name to a table field ID.',
  input: z.object({
    tableId: z
      .string()
      .describe('Table ID (t_xxx format) to add the column to'),
    claygentId: z
      .string()
      .describe('Claygent ID (c_xxx format): must be published'),
    workspaceId: WorkspaceIdParam,
    inputMappings: z
      .array(
        z.object({
          variableName: z
            .string()
            .describe(
              'Claygent variable name (from getClaygent().currentVersion.variables)',
            ),
          fieldId: z
            .string()
            .describe('Table field ID (f_xxx format) to bind to this variable'),
        }),
      )
      .optional()
      .describe(
        'Maps claygent input variables to table field IDs. Get variable names from getClaygent().currentVersion.variables and field IDs from getTable().fields.',
      ),
    columnName: z
      .string()
      .optional()
      .describe(
        'Display name for the enrichment column. Defaults to the claygent name.',
      ),
  }),
  output: z.object({
    fieldId: z
      .string()
      .describe(
        'Action field ID: use this with runEnrichmentColumn() to execute the claygent per-row',
      ),
    fieldName: z.string().describe('Display name of the created field'),
  }),
};

export const ClayAppAccountSchema = z.object({
  id: z.string().describe('App account ID (aa_xxx format)'),
  name: z.string().describe('Account name'),
  appAccountTypeId: z
    .string()
    .describe('Account type ID (e.g., "anthropic", "gpt-3", "hunter")'),
  isSharedPublicKey: z
    .boolean()
    .describe('Whether this is a shared public key'),
  userOwnerId: z
    .number()
    .nullable()
    .describe('User owner ID if user-owned, null otherwise'),
  workspaceOwnerId: z.number().describe('Workspace owner ID'),
  createdAt: z.string().describe('Creation timestamp'),
  updatedAt: z.string().describe('Last update timestamp'),
  deletedAt: z
    .string()
    .nullable()
    .describe('Deletion timestamp if soft-deleted'),
  useStaticIP: z.boolean().describe('Whether to use static IP'),
  reauthInitiatedAt: z
    .string()
    .nullable()
    .describe(
      'Timestamp when re-authentication was initiated, null if not pending',
    ),
  reauthInitiatedByUserId: z
    .number()
    .nullable()
    .describe('User ID who initiated re-authentication, null if not pending'),
  obfuscatedCredentials: z
    .record(z.string(), z.string())
    .nullable()
    .describe(
      'Obfuscated credential values (e.g., masked API keys), null for shared accounts',
    ),
  abilities: z
    .object({
      canUpdate: z.boolean().describe('Whether user can update'),
      canDelete: z.boolean().describe('Whether user can delete'),
    })
    .describe('User permissions for this account'),
});

export const listAppAccountsSchema = {
  name: 'listAppAccounts',
  description: 'List connected integration accounts',
  notes:
    'Returns connected integration accounts (API keys, OAuth connections). Common types: anthropic, gpt-3, google-gemini, hunter, clearbit, etc. FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
  }),
  output: z.object({
    appAccounts: z.array(ClayAppAccountSchema).describe('List of app accounts'),
    totalCount: z.number().describe('Total number of app accounts'),
  }),
};

export const setDefaultAppAccountSchema = {
  name: 'setDefaultAppAccount',
  description:
    'Set a connected app account as the default for its integration type in a workspace. The default account is auto-selected when running enrichments that require that integration (e.g., the default OpenAI account is used unless another is explicitly chosen). To change the default, call this with a different account of the same type; only one default per type.',
  notes:
    'FREE operation. Only accounts where abilities.canUpdate is true can be set as default (Clay-managed shared accounts have canUpdate=false and cannot be set as default; returns 403). Use listAppAccounts to find account IDs and check abilities. If only one account of a type exists, it is already effectively the default. The returned object reflects the account after the update but does not include a dedicated "isDefault" field; the default status is implicit (the last account you called this on is the default). Throws 404 if the account ID does not exist.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    appAccountId: z
      .string()
      .describe('App account ID (aa_xxx format, from listAppAccounts)'),
  }),
  output: ClayAppAccountSchema,
};

export const ClayWorkspaceDetailsSchema = z.object({
  id: z.number().describe('Workspace ID'),
  name: z.string().describe('Workspace name'),
  createdByUserId: z
    .string()
    .describe('ID of the user who created the workspace'),
  icon: z
    .object({
      url: z.string().describe('Icon image URL'),
    })
    .nullable()
    .optional()
    .describe('Workspace icon'),
  billingPlanType: z
    .string()
    .describe(
      'Billing plan type (e.g. "trial", "starter", "explorer", "pro", "enterprise")',
    ),
  billingEmail: z.string().optional().describe('Billing contact email'),
  customerId: z.string().describe('Stripe customer ID (cus_xxx format)'),
  createdAt: z.string().describe('Workspace creation timestamp (ISO 8601)'),
  updatedAt: z.string().describe('Last update timestamp (ISO 8601)'),
  deletedAt: z
    .string()
    .nullable()
    .describe('Deletion timestamp (ISO 8601) or null if active'),
  billingPlanUpdatedAt: z
    .string()
    .describe('Timestamp when billing plan was last changed (ISO 8601)'),
  settings: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .describe('Workspace settings (e.g. CLAY_SEQUENCER_SMARTLEAD_CLIENT_ID)'),
  featureFlags: z
    .record(
      z.string(),
      z.union([z.boolean(), z.number(), z.string(), z.array(z.string())]),
    )
    .describe('Feature flags controlling workspace capabilities'),
  credits: z
    .object({
      basic: z.number().describe('Basic credits remaining'),
      longExpiry: z.number().optional().describe('Long expiry credits'),
      actionExecution: z
        .number()
        .optional()
        .describe('Action execution credits'),
    })
    .describe('Current credit balances'),
  creditBudgets: z
    .object({
      basic: z.number().describe('Basic credit budget'),
      longExpiry: z.number().optional().describe('Long expiry budget'),
      actionExecution: z
        .number()
        .optional()
        .describe('Action execution budget'),
    })
    .describe('Credit budgets per period'),
  currentPeriodEnd: z.number().describe('Billing period end (Unix timestamp)'),
  centsPerCredit: z.number().describe('Cost per credit in cents'),
  onboardingData: z
    .object({
      formSchema: z.string().optional().describe('Onboarding form version'),
      howDidYouHear: z
        .string()
        .optional()
        .describe('How they heard about Clay (e.g. "Search")'),
      firstUseCase: z.string().optional().describe('Selected use case'),
      workspaceName: z
        .string()
        .optional()
        .describe('Name entered during onboarding'),
      hasSubmittedOnboardingForm: z
        .boolean()
        .optional()
        .describe('Whether onboarding form was completed'),
    })
    .passthrough()
    .describe('Onboarding form data'),
  abilities: z
    .record(z.string(), z.boolean())
    .describe(
      'Workspace-level permissions (canUpdate, canDelete, canCreateResource, canManageBilling, canManageAccess, canManageAppAccounts, etc.)',
    ),
  audienceAbilities: z
    .record(z.string(), z.boolean())
    .describe(
      'Audience/segment permissions (canRead, canUpdateSegment, canDeleteSegment, canManageImports, canManageExports, canManageActions, canManageEnrichments, canManageSignals, canManageFields)',
    ),
});

export const getWorkspaceDetailsSchema = {
  name: 'getWorkspaceDetails',
  description:
    'Get detailed workspace info including credits, feature flags, and abilities',
  notes:
    'More detailed than getWorkspaces(). Returns credits, billing, feature flags, and granular permissions. FREE operation.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
  }),
  output: ClayWorkspaceDetailsSchema,
};

export const listWorkbookTablesSchema = {
  name: 'listWorkbookTables',
  description: 'List all tables in a specific workbook',
  notes:
    'Returns full table objects with fields and views. Use this to get all tables within a workbook instead of filtering listTables(). FREE operation.',
  input: z.object({
    workbookId: z.string().describe('Workbook ID (wb_xxx format)'),
  }),
  output: z.object({
    tables: z.array(ClayTableSchema).describe('List of tables in the workbook'),
    totalCount: z.number().describe('Total number of tables'),
  }),
};

export const listWorkspaceTablesSchema = {
  name: 'listWorkspaceTables',
  description:
    'List all tables across a workspace with summary metadata. Useful for finding tables without needing a workbook ID.',
  notes:
    'Returns table summaries (no fields or views). Use getTable() for full field/view details on a specific table. FREE; no credits consumed.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
  }),
  output: z.object({
    tables: z.array(ClayTableSummarySchema).describe('List of table summaries'),
    totalCount: z.number().describe('Total number of tables'),
  }),
};

export const listClaygentDocumentsSchema = {
  name: 'listClaygentDocuments',
  description:
    "List documents in a workspace, optionally filtered by context (e.g. 'agent_playground' for Claygent files). Returns an empty array for contexts with no documents or unrecognized context values (no error thrown). Throws 404 for invalid workspaceId.",
  notes: 'FREE; no credits consumed.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    context: z
      .string()
      .optional()
      .describe(
        'Context filter. Known values: "agent_playground" (Claygent files). Defaults to "agent_playground" if omitted. Unrecognized values silently return an empty documents array.',
      ),
  }),
  output: z.object({
    documents: z
      .array(
        z
          .object({
            id: z.string().describe('Document ID'),
            name: z.string().describe('Document name'),
            folderId: z.string().nullable().describe('Parent folder ID'),
            mimeType: z.string().describe('MIME type (e.g., "text/plain")'),
            size: z.string().describe('File size as string'),
            context: z
              .string()
              .describe('Document context (e.g., "agent_playground")'),
            createdAt: z.string().describe('Creation timestamp'),
            updatedAt: z.string().describe('Last update timestamp'),
          })
          .passthrough(),
      )
      .describe('Array of document objects'),
  }),
};

export const createClaygentDocumentSchema = {
  name: 'createClaygentDocument',
  description:
    'Create a context document in a workspace. Documents can be referenced by Claygents for additional context during execution.',
  notes:
    'FREE; no credits consumed. The document is immediately available for claygent reference after creation. Use listClaygentDocuments() to verify.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    name: z.string().describe('Document name (e.g., "Company Guidelines.txt")'),
    content: z.string().describe('Document content as plain text'),
    context: z
      .string()
      .optional()
      .describe(
        'Document context. Defaults to "agent_playground" for Claygent use. Other values may be supported for different contexts.',
      ),
  }),
  output: z.object({
    id: z.string().describe('Created document ID'),
    name: z.string().describe('Document name'),
  }),
};

export const deleteClaygentDocumentSchema = {
  name: 'deleteClaygentDocument',
  description:
    'Delete a context document from a workspace. Removes the document permanently; Claygents referencing it will no longer have access.',
  notes: 'FREE; no credits consumed. Cannot be undone.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    documentId: z.string().describe('Document ID to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the deletion succeeded'),
  }),
};

// ============================================================================
// Campaign Management Schemas
// ============================================================================

export const createCampaignSchema = {
  name: 'createCampaign',
  description:
    'Create a new email campaign. Creates a table with messaging block type and a Smartlead campaign.',
  notes:
    'FREE; no credits consumed. After creation, the full setup flow is: (1) setCampaignLeadEmail to bind the default email field, (2) setCampaignSequence to define email steps, (3) addCampaignEmailAccounts to assign sender accounts, (4) setCampaignSchedule to set sending times. The campaign table has an auto-created "Email" field ready for use. Returns smartleadCampaignId; use this as campaignId for all subsequent sequencer operations.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    name: z.string().describe('Campaign name (max 128 characters)'),
  }),
  output: z.object({
    id: z.string().describe('Table ID (t_xxx format)'),
    name: z.string().describe('Campaign name'),
    workbookId: z.string().describe('Workbook ID (wb_xxx format)'),
    smartleadCampaignId: z
      .number()
      .nullable()
      .describe(
        'Smartlead campaign ID: pass this as campaignId to all sequencer functions (setCampaignSequence, addCampaignEmailAccounts, setCampaignSchedule, updateCampaignStatus, etc.)',
      ),
  }),
};

export const deleteCampaignSchema = {
  name: 'deleteCampaign',
  description:
    'Delete a campaign: stops the Smartlead campaign and trashes the Clay table + workbook. Pass all IDs from listCampaigns for full cleanup.',
  notes:
    'FREE; no credits consumed. Smartlead has no permanent delete API; the campaign is STOPPED (best available). listCampaigns deduplicates by name so stopped ghosts are hidden. Pass tableId/workbookId to also trash the Clay table.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z
      .number()
      .describe(
        'Smartlead campaign ID (integer) from listCampaigns id field. Required for Smartlead deletion.',
      ),
    tableId: z
      .string()
      .optional()
      .describe(
        'Clay table ID (t_xxx format) from listCampaigns tableId field. Pass to also trash the Clay table.',
      ),
    workbookId: z
      .string()
      .optional()
      .describe(
        'Workbook ID (wb_xxx format) from listCampaigns workbookId field. Pass with tableId for full cleanup.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether deletion succeeded'),
  }),
};

export const getCampaignSettingsSchema = {
  name: 'getCampaignSettings',
  description:
    'Get rate-limiting and tracking settings for a campaign (max leads/day, min time between emails, tracking flags, unsubscribe text). Does NOT include schedule hours/days; use getCampaignSchedule for the full schedule + settings.',
  notes:
    'FREE; no credits consumed. campaignId is the smartleadCampaignId from listCampaigns. For schedule details (timezone, hours, days), use getCampaignSchedule instead; it returns everything this function returns plus the sending schedule.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z.number().describe('Smartlead campaign ID (not table ID)'),
  }),
  output: z.object({
    status: z
      .enum(['DRAFTED', 'START', 'PAUSED', 'STOPPED'])
      .describe(
        'Campaign status: DRAFTED (not yet started), START (actively sending), PAUSED (temporarily halted), STOPPED (ended)',
      ),
    scheduler_cron_value: z
      .union([
        z.object({
          tz: z.string().describe('IANA timezone'),
          days: z
            .array(z.number())
            .describe('Days of week (0=Sun, 1=Mon, ..., 6=Sat)'),
          startHour: z.string().describe('Start hour (HH:MM)'),
          endHour: z.string().describe('End hour (HH:MM)'),
        }),
        z.null(),
      ])
      .describe(
        'Schedule configuration (timezone, days, hours) or null if not set',
      ),
    min_time_btwn_emails: z
      .number()
      .describe('Minimum time between emails (minutes)'),
    max_leads_per_day: z.number().describe('Maximum leads to contact per day'),
    schedule_start_time: z
      .string()
      .nullable()
      .describe(
        'ISO 8601 datetime when scheduled sending starts, or null if not scheduled',
      ),
    unsubscribe_text: z.string().describe('Unsubscribe text'),
    track_settings: z
      .array(z.enum(['DONT_EMAIL_OPEN', 'DONT_LINK_CLICK']))
      .describe(
        'Negative tracking flags: lists what is DISABLED. "DONT_EMAIL_OPEN" = open tracking off, "DONT_LINK_CLICK" = click tracking off. Empty array means both open and click tracking are enabled.',
      ),
  }),
};

export const updateCampaignSettingsSchema = {
  name: 'updateCampaignSettings',
  description:
    'Update campaign rate-limiting settings (max leads per day, min time between emails, timezone). Reads current settings first to preserve omitted fields. Provide at least one setting to change.',
  notes:
    'FREE; no credits consumed. Writes to PATCH /schedule endpoint. Setting timezone will also initialize the sending schedule (weekday 9am-5pm default) if no schedule was previously configured; use setCampaignSchedule afterward to customize hours/days. Omitted fields are preserved from current settings.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z.number().describe('Smartlead campaign ID'),
    maxLeadsPerDay: z
      .number()
      .min(1)
      .max(10000)
      .optional()
      .describe('Maximum leads per day (1–10000)'),
    minTimeBtwnEmails: z
      .number()
      .min(5)
      .optional()
      .describe('Minimum time between emails in minutes. Must be at least 5.'),
    timezone: z
      .string()
      .optional()
      .describe(
        'IANA timezone (e.g., "America/New_York", "Europe/London"). If omitted, reads from current schedule or defaults to America/New_York.',
      ),
  }),
  output: z.object({
    min_time_btwn_emails: z
      .number()
      .describe('Updated minimum time between emails (minutes)'),
    max_leads_per_day: z.number().describe('Updated maximum leads per day'),
  }),
};

export const updateCampaignStatusSchema = {
  name: 'updateCampaignStatus',
  description:
    'Start, pause, or stop a campaign. PAUSED and STOPPED work on any campaign. START requires the campaign to be fully configured first (sending schedule, email accounts, sequence steps, and lead email field). If not configured, throws an error describing what is missing.',
  notes:
    'FREE; no credits consumed. Starting a campaign will begin sending emails. Use PAUSED to temporarily halt sending and START to resume.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z.number().describe('Smartlead campaign ID'),
    status: z
      .enum(['START', 'PAUSED', 'STOPPED'])
      .describe(
        'Target status. START begins or resumes sending (requires fully configured campaign). PAUSED temporarily halts sending. STOPPED permanently stops the campaign.',
      ),
  }),
  output: z.object({
    completedStatusTransition: z
      .string()
      .describe(
        'The status the campaign transitioned to (e.g., "STOPPED", "PAUSED", "START")',
      ),
  }),
};

export const listSequencerEmailAccountsSchema = {
  name: 'listSequencerEmailAccounts',
  description:
    'List email accounts available for the Clay Sequencer in this workspace.',
  notes: 'FREE; no credits consumed.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
  }),
  output: z.object({
    accounts: z
      .array(
        z.object({
          id: z.string().describe('Clay sequencer email account ID'),
          workspaceId: z.number().describe('Workspace ID'),
          email: z.string().describe('Email address'),
          displayName: z
            .string()
            .nullable()
            .describe('Display name for the account'),
          accountType: z
            .string()
            .describe('Account type (GMAIL, OUTLOOK, SMTP)'),
          smartleadId: z
            .string()
            .nullable()
            .describe('Smartlead account ID (numeric string)'),
          smartleadAccountStatus: z
            .string()
            .describe('Account status (active, not_found, error, suspended)'),
          profilePictureKey: z.string().nullable(),
          profilePictureUrl: z.string().nullable(),
          addedByUserId: z
            .string()
            .nullable()
            .describe('User ID who connected this account'),
          onlyShowForOwner: z
            .boolean()
            .describe('Whether this account is only visible to the owner'),
          createdAt: z.string().describe('Creation timestamp'),
          updatedAt: z.string().describe('Last update timestamp'),
          smartSenderOrderId: z
            .string()
            .nullable()
            .describe('Smart sender order ID if purchased via Smart Senders'),
          smartleadData: z
            .object({
              id: z.number().describe('Smartlead numeric ID'),
              created_at: z.string(),
              updated_at: z.string(),
              from_name: z.string(),
              from_email: z.string(),
              type: z.string().describe('Account type (GMAIL, OUTLOOK, SMTP)'),
              message_per_day: z.number().describe('Daily sending limit'),
              daily_sent_count: z.number().describe('Emails sent today'),
              smtp_failure_error: z.string().nullable(),
              imap_failure_error: z.string().nullable(),
              signature: z.string().nullable(),
              warmup_details: z
                .object({
                  status: z
                    .enum(['ACTIVE', 'INACTIVE'])
                    .describe('Warmup status'),
                  warmup_reputation: z.string().nullable(),
                  total_sent_count: z.number(),
                  total_spam_count: z.number(),
                  warmup_created_at: z.string().optional(),
                  warmup_key_id: z.string().optional(),
                  reply_rate: z.number().optional(),
                  blocked_reason: z.string().optional().nullable(),
                })
                .nullable()
                .describe(
                  'Warmup configuration and stats, null if warmup not enabled',
                ),
              campaign_count: z
                .number()
                .describe('Number of campaigns using this account'),
            })
            .describe(
              'Smartlead provider details including sending limits and status',
            ),
          addedByUserName: z
            .string()
            .nullable()
            .describe('Name of user who connected this account'),
          addedByUserEmail: z
            .string()
            .nullable()
            .describe('Email of user who connected this account'),
          addedByUserProfilePicture: z.string().nullable(),
        }),
      )
      .describe('Email account objects'),
    totalCount: z.number().describe('Total number of accounts'),
  }),
};

// ============================================================================
// Global Blocklist Schemas
// ============================================================================

export const listGlobalBlocklistSchema = {
  name: 'listGlobalBlocklist',
  description: 'List all emails and domains on the global email blocklist.',
  notes: 'FREE; no credits consumed.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
  }),
  output: z.object({
    entries: z
      .array(
        z.object({
          id: z.number().describe('Blocklist entry ID'),
          emailOrDomain: z.string().describe('Email address or domain'),
          createdAt: z.string().describe('Creation timestamp'),
          source: z
            .string()
            .describe('Source of the blocklist entry (e.g., "API")'),
        }),
      )
      .describe('Blocklist entries'),
    totalCount: z.number().describe('Total number of entries'),
  }),
};

export const addToGlobalBlocklistSchema = {
  name: 'addToGlobalBlocklist',
  description:
    'Add an email address or domain to the global blocklist to prevent sending emails to it.',
  notes: 'FREE; no credits consumed.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    emailOrDomain: z
      .string()
      .describe(
        'Email address or domain to block (e.g., "test@example.com" or "example.com")',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
  }),
};

export const batchAddToGlobalBlocklistSchema = {
  name: 'batchAddToGlobalBlocklist',
  description:
    'Add multiple email addresses or domains to the global blocklist in one call. Use this instead of addToGlobalBlocklist when blocking more than one entry.',
  notes:
    'FREE; no credits consumed. Entries are added sequentially. The API does not deduplicate; passing the same entry twice creates duplicate blocklist rows.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    entries: z
      .array(z.string())
      .min(1)
      .max(500)
      .describe(
        'Array of email addresses or domains to block (e.g., ["spam@example.com", "baddomain.com"]). Max 500 per call.',
      ),
  }),
  output: z.object({
    added: z.number().describe('Number of entries successfully added'),
    failed: z
      .array(
        z.object({
          entry: z.string().describe('The email or domain that failed'),
          error: z.string().describe('Error message'),
        }),
      )
      .describe('Entries that failed to add (empty array if all succeeded)'),
  }),
};

export const removeFromGlobalBlocklistSchema = {
  name: 'removeFromGlobalBlocklist',
  description: 'Remove an entry from the global blocklist by its ID.',
  notes:
    'FREE; no credits consumed. Use listGlobalBlocklist to find entry IDs.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    entryId: z.number().describe('Blocklist entry ID to remove'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
  }),
};

// ============================================================================
// Campaign Email Accounts Schemas
// ============================================================================

export const getEmailAccountConnectUrlSchema = {
  name: 'getEmailAccountConnectUrl',
  description:
    'Get the OAuth URL to connect a Gmail or Microsoft email account to the Clay Sequencer.',
  notes:
    'FREE; no credits consumed. Returns a URL the user must visit in their browser to authorize Clay. After authorization, the account appears in listSequencerEmailAccounts.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    provider: z
      .enum(['gmail', 'microsoft'])
      .optional()
      .describe('Email provider to connect (default: gmail)'),
  }),
  output: z.object({
    connectUrl: z.string().describe('OAuth URL for the user to visit'),
  }),
};

export const addCampaignEmailAccountsSchema = {
  name: 'addCampaignEmailAccounts',
  description: 'Add email accounts to a campaign for sending emails.',
  notes:
    'FREE; no credits consumed. Use the Smartlead account IDs (numbers): get them from smartleadData.id in listSequencerEmailAccounts, or from the id field in listCampaignEmailAccounts on an existing campaign. Adding an account that is already assigned is idempotent (succeeds silently). Invalid account IDs cause a 500 error. Throws client-side if campaignId is not a positive integer. A campaignId that does not belong to the workspace returns 403 "Campaign does not belong to this workspace". A non-numeric workspaceId returns 400. A non-existent workspace returns 404. An inaccessible workspace returns 403.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z
      .number()
      .int()
      .positive()
      .describe(
        'Smartlead campaign ID (positive integer, from listCampaigns .id field)',
      ),
    emailAccountIds: z
      .array(z.number().int().positive())
      .min(1)
      .describe(
        'Smartlead email account IDs: from smartleadData.id in listSequencerEmailAccounts or id in listCampaignEmailAccounts',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
  }),
};

export const removeCampaignEmailAccountsSchema = {
  name: 'removeCampaignEmailAccounts',
  description: 'Remove email accounts from a campaign.',
  notes:
    'FREE; no credits consumed. MUST call listCampaignEmailAccounts first to get IDs of accounts currently assigned to the campaign. Passing an ID not assigned to the campaign returns a 500 error. The id field from listCampaignEmailAccounts response is the correct value to use here.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z
      .number()
      .int()
      .positive()
      .describe(
        'Smartlead campaign ID (positive integer, from listCampaigns .id field)',
      ),
    emailAccountIds: z
      .array(z.number().int().positive())
      .min(1)
      .describe(
        'Smartlead email account IDs to remove: from smartleadData.id in listSequencerEmailAccounts or id in listCampaignEmailAccounts',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the removal succeeded'),
  }),
};

// ============================================================================
// Campaign Webhooks Schemas
// ============================================================================

export const listCampaignWebhooksSchema = {
  name: 'listCampaignWebhooks',
  description: 'List webhooks configured for a specific campaign.',
  notes: 'FREE; no credits consumed.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z.number().describe('Smartlead campaign ID'),
  }),
  output: z.object({
    webhooks: z
      .array(
        z.object({
          id: z.number().describe('Webhook ID'),
          name: z.string().describe('Webhook name'),
          webhookUrl: z.string().describe('Webhook URL'),
          emailCampaignId: z
            .number()
            .describe('Smartlead campaign ID this webhook belongs to'),
          eventTypes: z
            .array(z.string())
            .describe(
              'Event types this webhook listens to (e.g., EMAIL_REPLY, EMAIL_BOUNCE)',
            ),
          categories: z
            .array(z.string())
            .describe(
              'Lead reply categories that trigger this webhook (e.g., Interested, Meeting Request, Not Interested)',
            ),
          createdAt: z.string().describe('Creation timestamp'),
          updatedAt: z.string().describe('Last update timestamp'),
        }),
      )
      .describe('Campaign webhooks'),
    totalCount: z.number().describe('Total number of webhooks'),
  }),
};

export const createCampaignWebhookSchema = {
  name: 'createCampaignWebhook',
  description:
    'Create a webhook for a campaign to receive notifications on email events.',
  notes:
    'FREE; no credits consumed. Valid event types: EMAIL_SENT, EMAIL_REPLY, EMAIL_BOUNCE, FIRST_EMAIL_SENT, LEAD_UNSUBSCRIBED, LEAD_CATEGORY_UPDATED, CAMPAIGN_STATUS_CHANGED, MANUAL_STEP_REACHED, EMAIL_OPEN, EMAIL_LINK_CLICK.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z.number().describe('Smartlead campaign ID'),
    name: z.string().describe('Webhook name'),
    webhookUrl: z
      .string()
      .describe('Webhook URL to receive event notifications'),
    eventTypes: z
      .array(
        z.enum([
          'EMAIL_SENT',
          'EMAIL_REPLY',
          'EMAIL_BOUNCE',
          'FIRST_EMAIL_SENT',
          'LEAD_UNSUBSCRIBED',
          'LEAD_CATEGORY_UPDATED',
          'CAMPAIGN_STATUS_CHANGED',
          'MANUAL_STEP_REACHED',
          'EMAIL_OPEN',
          'EMAIL_LINK_CLICK',
        ]),
      )
      .describe(
        'Event types to listen for (e.g., ["EMAIL_REPLY", "EMAIL_BOUNCE"])',
      ),
  }),
  output: z.object({
    id: z.number().describe('Webhook ID'),
    name: z.string().describe('Webhook name'),
    webhookUrl: z.string().describe('Webhook URL'),
    emailCampaignId: z
      .number()
      .describe('Smartlead campaign ID this webhook belongs to'),
    eventTypes: z
      .array(z.string())
      .describe('Event types this webhook listens to'),
    categories: z
      .array(z.string())
      .describe(
        'Lead reply categories that trigger this webhook (e.g., Interested, Meeting Request)',
      ),
    createdAt: z.string().describe('Creation timestamp'),
    updatedAt: z.string().describe('Last update timestamp'),
  }),
};

// ============================================================================
// Campaign Analytics & Inbox Schemas
// ============================================================================

export const getCampaignAnalyticsSchema = {
  name: 'getCampaignAnalytics',
  description:
    'Get analytics for a specific campaign including sent, reply, bounce, click, open counts and lead stats.',
  notes: 'FREE; no credits consumed. campaignId is the smartleadCampaignId.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z.number().describe('The Smartlead campaign ID'),
  }),
  output: z.object({
    sent_count: z.string().describe('Number of emails sent'),
    reply_count: z.string().describe('Number of replies'),
    bounce_count: z.string().describe('Number of bounces'),
    unique_click_count: z.string().describe('Number of unique clicks'),
    open_count: z.string().describe('Number of opens'),
    campaign_lead_stats: z
      .object({
        total: z.number(),
        paused: z.number(),
        blocked: z.number(),
        revenue: z.number(),
        stopped: z.number(),
        completed: z.number(),
        inprogress: z.number(),
        interested: z.number(),
        notStarted: z.number(),
      })
      .describe('Lead status breakdown'),
  }),
};

export const getDayWiseAnalyticsSchema = {
  name: 'getDayWiseAnalytics',
  description:
    'Get day-by-day email analytics for one or more campaigns over a date range.',
  notes:
    'FREE; no credits consumed. Input dates use YYYY-MM-DD format. Output dates use "D Mon" format (e.g. "1 Feb", "10 Feb").',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignIds: z.array(z.number()).describe('Smartlead campaign IDs'),
    startDate: z.string().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().describe('End date (YYYY-MM-DD)'),
    timezone: z
      .string()
      .optional()
      .describe('Timezone (defaults to America/New_York)'),
  }),
  output: z.object({
    dayWiseStats: z.array(
      z.object({
        date: z.string().describe('Date in "D Mon" format (e.g. "1 Feb")'),
        dayName: z.string().describe('Day of week (e.g. "Monday")'),
        emailEngagementMetrics: z.object({
          sent: z.number(),
          opened: z.number(),
          replied: z.number(),
          bounced: z.number(),
          unsubscribed: z.number(),
          uniqueLeadReached: z.number(),
        }),
      }),
    ),
  }),
};

export const listInboxRepliesSchema = {
  name: 'listInboxReplies',
  description: 'List email replies from the global inbox across all campaigns.',
  notes:
    'FREE; no credits consumed. Reply objects contain emailLeadMapId (for setLeadCategory, setLeadReadStatus) and emailCampaignId + emailLeadId (for getMessageHistory as campaignId + leadId).',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    offset: z.number().optional().describe('Pagination offset (default 0)'),
    campaignId: z
      .number()
      .optional()
      .describe('Filter by Smartlead campaign ID'),
    categoryId: z
      .number()
      .optional()
      .describe(
        'Filter by category: 1=Interested, 2=Meeting Request, 3=Not Interested, 4=Out of Office, 5=Wrong Person, 6=Unsubscribe, 0=All',
      ),
  }),
  output: z.object({
    replies: z
      .array(
        z
          .object({
            emailLeadMapId: z
              .number()
              .optional()
              .describe(
                'Email lead map ID: pass to setLeadCategory/setLeadReadStatus',
              ),
            emailLeadId: z
              .number()
              .optional()
              .describe('Lead ID: pass as leadId to getMessageHistory'),
            emailCampaignId: z
              .number()
              .optional()
              .describe(
                'Smartlead campaign ID: pass as campaignId to getMessageHistory',
              ),
            emailCampaignName: z.string().optional(),
            leadEmail: z.string().optional(),
            leadFirstName: z.string().optional(),
            leadLastName: z.string().optional(),
            leadStatus: z.string().optional(),
            leadCategoryId: z
              .number()
              .optional()
              .describe(
                'Category: 1=Interested, 2=Meeting Request, 3=Not Interested, 4=Out of Office, 5=Wrong Person, 6=Unsubscribe',
              ),
            lastSentTime: z.string().optional(),
            lastReplyTime: z.string().optional(),
            hasNewUnreadEmail: z.boolean().optional(),
          })
          .passthrough(),
      )
      .describe('List of email replies'),
    totalCount: z.number().describe('Number of replies returned'),
  }),
};

export const sendInboxReplySchema = {
  name: 'sendInboxReply',
  description: 'Send a reply to an email in the global inbox.',
  notes:
    'FREE; no credits consumed. Requires emailStatsId and replyMessageId from getMessageHistory (statsId and messageId fields). Use emailCampaignId from listInboxReplies as campaignId. Skill hint: use the "sales-copy" skill for composing effective inbox replies.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z
      .number()
      .describe(
        'Smartlead campaign ID (emailCampaignId from listInboxReplies)',
      ),
    emailBody: z.string().describe('The reply email body (HTML supported)'),
    emailStatsId: z
      .string()
      .describe(
        'Stats ID of the email being replied to (statsId from getMessageHistory)',
      ),
    replyMessageId: z
      .string()
      .describe(
        'Message ID of the email being replied to (messageId from getMessageHistory)',
      ),
    replyEmailTime: z
      .string()
      .describe(
        'ISO 8601 timestamp of the email being replied to (time from getMessageHistory)',
      ),
    replyEmailBody: z
      .string()
      .describe(
        'Body of the email being replied to (body from getMessageHistory)',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the reply was sent'),
  }),
};

export const listCampaignEmailAccountsSchema = {
  name: 'listCampaignEmailAccounts',
  description: 'List email accounts assigned to a specific campaign.',
  notes:
    'FREE; no credits consumed. campaignId is the smartleadCampaignId (integer). Returns Smartlead email account details including warmup status and error info. The id field is the Smartlead email account ID used by addCampaignEmailAccounts and removeCampaignEmailAccounts.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z
      .number()
      .int()
      .positive()
      .describe(
        'Smartlead campaign ID (positive integer, from listCampaigns .id field)',
      ),
  }),
  output: z.object({
    accounts: z
      .array(
        z.object({
          id: z.number().describe('Smartlead email account ID'),
          createdAt: z.string().describe('ISO 8601 creation timestamp'),
          updatedAt: z.string().describe('ISO 8601 last update timestamp'),
          fromName: z.string().describe('Sender display name'),
          fromEmail: z.string().describe('Sender email address'),
          type: z.string().describe('Account type (GMAIL, MICROSOFT)'),
          messagePerDay: z.number().describe('Max messages per day'),
          dailySentCount: z.number().describe('Emails sent today'),
          smtpFailureError: z
            .string()
            .nullable()
            .describe('SMTP failure error message, null if no error'),
          imapFailureError: z
            .string()
            .nullable()
            .describe('IMAP failure error message, null if no error'),
          signature: z
            .string()
            .nullable()
            .describe('Email signature HTML, null if not set'),
          warmupDetails: z
            .object({
              status: z.enum(['ACTIVE', 'INACTIVE']).describe('Warmup status'),
              warmupReputation: z
                .string()
                .nullable()
                .describe('Warmup reputation score'),
              totalSentCount: z.number().describe('Total warmup emails sent'),
              totalSpamCount: z
                .number()
                .describe('Total warmup emails marked as spam'),
            })
            .nullable()
            .describe('Warmup details, null if warmup not configured'),
        }),
      )
      .describe('Email accounts assigned to campaign'),
    totalCount: z.number().describe('Number of accounts'),
  }),
};

export const setCampaignSequenceSchema = {
  name: 'setCampaignSequence',
  description:
    'Set the email sequence steps for a campaign. Each step has a subject, body, and delay.',
  notes:
    'FREE; no credits consumed. Idempotent: replaces any existing sequence steps. campaignId is the smartleadCampaignId from listCampaigns. Steps define the email sequence: first step is NEW_EMAIL_THREAD (uses subject), follow-ups are REPLY_TO_THREAD (subject ignored; replies inherit opener subject). timeDelayDays defaults to 1 for all steps (API requires > 0). Subject and body support Clay formula syntax with field references.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z.number().describe('Smartlead campaign ID'),
    tableId: z.string().describe('Campaign table ID (t_xxx)'),
    steps: z
      .array(
        z.object({
          subject: z.string().describe('Email subject line'),
          body: z.string().describe('Email body (plain text or HTML)'),
          timeDelayDays: z
            .number()
            .optional()
            .describe(
              'Days to wait before sending this step (must be > 0, defaults to 1)',
            ),
        }),
      )
      .describe('Email sequence steps in order'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const getCampaignSequenceSchema = {
  name: 'getCampaignSequence',
  description: 'Get the email sequence steps configured on a campaign.',
  notes:
    'FREE; no credits consumed. Returns message content from table metadata. timeDelayDays defaults to 0 when the sequence order has not been persisted to the table (common for newly created sequences). name is the step label set in the UI (e.g. "Opener", "Follow-up 1").',
  input: z.object({
    tableId: z.string().describe('Campaign table ID (t_xxx)'),
  }),
  output: z.object({
    steps: z.array(
      z.object({
        messageGroupId: z.string(),
        name: z
          .string()
          .describe('Step label from the UI (e.g. "Opener", "Follow-up 1")'),
        emailType: z.string(),
        timeDelayDays: z.number(),
        subject: z.string().optional(),
        body: z.string().optional(),
      }),
    ),
  }),
};

export const setCampaignScheduleSchema = {
  name: 'setCampaignSchedule',
  description:
    'Set the sending schedule for a campaign (timezone, days, hours). Reads current settings first and preserves unspecified fields; safe to call with only the fields you want to change.',
  notes:
    'FREE; no credits consumed. campaignId is the smartleadCampaignId. Uses read-then-update pattern: the /schedule PATCH resets omitted fields to defaults, so this function reads current settings first and includes all fields in the PATCH. Returns the confirmed schedule after update.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z.number().describe('Smartlead campaign ID'),
    timezone: z
      .string()
      .optional()
      .describe(
        'IANA timezone (e.g. "America/New_York"). Defaults to current value or "America/New_York" if never set.',
      ),
    startHour: z
      .string()
      .optional()
      .describe('Start hour in HH:MM format (e.g. "09:00")'),
    endHour: z
      .string()
      .optional()
      .describe('End hour in HH:MM format (e.g. "17:00")'),
    days: z
      .array(z.number())
      .optional()
      .describe(
        'Days of the week to send on as numbers: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday. E.g. [1,2,3,4,5] for weekdays.',
      ),
  }),
  output: z.object({
    timezone: z
      .string()
      .nullable()
      .describe('Confirmed IANA timezone after update'),
    startHour: z
      .string()
      .nullable()
      .describe('Confirmed start hour in HH:MM format after update'),
    endHour: z
      .string()
      .nullable()
      .describe('Confirmed end hour in HH:MM format after update'),
    days: z
      .array(z.number())
      .nullable()
      .describe('Confirmed days of the week after update'),
  }),
};

export const getCampaignScheduleSchema = {
  name: 'getCampaignSchedule',
  description:
    'Get the full sending schedule and settings for a campaign. Returns everything getCampaignSettings returns plus schedule details (timezone, hours, days). Prefer this over getCampaignSettings when you need schedule info.',
  notes:
    'FREE; no credits consumed. campaignId is the Smartlead campaign ID (the `id` field from listCampaigns). Returns defaults (maxLeadsPerDay=100, minTimeBetweenEmails=20) even if no schedule is configured; schedule fields (timezone, hours, days) are null when unconfigured.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z.number().describe('Smartlead campaign ID'),
  }),
  output: z.object({
    status: z
      .string()
      .describe(
        'Campaign status (e.g. "DRAFTED", "START", "PAUSED", "STOPPED", "COMPLETED")',
      ),
    timezone: z
      .string()
      .nullable()
      .describe('IANA timezone (e.g. "America/New_York") or null if not set'),
    startHour: z
      .string()
      .nullable()
      .describe('Start hour in HH:MM format (e.g. "09:00") or null if not set'),
    endHour: z
      .string()
      .nullable()
      .describe('End hour in HH:MM format (e.g. "17:00") or null if not set'),
    days: z
      .array(z.number())
      .nullable()
      .describe(
        'Days of the week as numbers: 0=Sunday, 1=Monday, ..., 6=Saturday. Null if not set.',
      ),
    maxLeadsPerDay: z.number().describe('Maximum leads to contact per day'),
    minTimeBetweenEmails: z
      .number()
      .describe('Minimum time between emails (minutes)'),
    scheduleStartTime: z
      .string()
      .nullable()
      .describe('Scheduled start time or null if not set'),
    unsubscribeText: z
      .string()
      .describe(
        'Unsubscribe text appended to emails (empty string if not set)',
      ),
    trackSettings: z
      .array(z.string())
      .describe(
        'Tracking settings (e.g. ["DONT_EMAIL_OPEN", "DONT_LINK_CLICK"])',
      ),
  }),
};

export const sendTestEmailSchema = {
  name: 'sendTestEmail',
  description:
    'Send a test email from a campaign to a custom address for preview/testing.',
  notes:
    'FREE; no credits consumed. Requires: (1) a lead list added to the campaign with the lead email column configured, (2) a lead record in the campaign table with the "Add lead to campaign" action completed successfully, (3) a configured sequence via setCampaignSequence. The customEmailAddress receives the test; leadEmail is the lead whose record data populates template variables.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z.number().describe('Smartlead campaign ID'),
    tableId: z.string().describe('Campaign table ID (t_xxx format)'),
    recordId: z.string().describe('Record ID of a lead in the campaign table'),
    emailAccountId: z
      .number()
      .describe(
        'Smartlead email account ID (numeric, from listSequencerEmailAccounts smartleadData.id field)',
      ),
    customEmailAddress: z
      .string()
      .describe('Email address to send the test email to'),
    leadEmail: z
      .string()
      .describe("The lead's email address (from the campaign table record)"),
    sequenceStepIndex: z
      .number()
      .optional()
      .describe('Which sequence step to test (0-indexed, defaults to 0)'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const addLeadsToCampaignSchema = {
  name: 'addLeadsToCampaign',
  description:
    'Add leads to a campaign by creating records in the campaign table and triggering the sequencer action fields. Each lead needs an email address.',
  notes:
    'FREE; no credits consumed. Maximum 100 leads per call. Campaign must be fully configured before adding leads: setCampaignLeadEmail, setCampaignSequence, addCampaignEmailAccounts, and setCampaignSchedule should all be called first. tableId is the campaign table ID (t_xxx format) from createCampaign or listCampaigns. The function auto-discovers the email field and action fields from the table metadata. Polls action results for up to 15 seconds. Check leadResults[].success to verify each lead was actually enrolled; actionsTriggered only means the action fields were triggered, not that enrollment succeeded.',
  input: z.object({
    tableId: z
      .string()
      .describe(
        'Campaign table ID (t_xxx format) from createCampaign or listCampaigns',
      ),
    leads: z
      .array(
        z.object({
          email: z.string().describe('Lead email address'),
        }),
      )
      .min(1)
      .max(100)
      .describe('Array of leads to add (1-100 per call)'),
  }),
  output: z.object({
    recordIds: z
      .array(z.string())
      .describe('IDs of created records in the campaign table'),
    recordCount: z.number().describe('Number of records created'),
    actionsTriggered: z
      .boolean()
      .describe(
        'Whether the sequencer action fields were successfully triggered on the new records',
      ),
    tableId: z.string().describe('Campaign table ID used'),
    emailFieldId: z
      .string()
      .describe('Field ID of the email column used for lead data'),
    leadResults: z
      .array(
        z.object({
          recordId: z.string(),
          email: z.string(),
          validateStatus: z
            .string()
            .nullable()
            .describe('Validation result - null if still pending'),
          addLeadStatus: z
            .string()
            .nullable()
            .describe('Add-to-campaign result - null if still pending'),
          success: z
            .boolean()
            .describe('Whether the lead was successfully enrolled'),
        }),
      )
      .describe(
        'Per-lead enrollment results after polling action fields. Check success field for each lead.',
      ),
  }),
};

export const setCampaignLeadEmailSchema = {
  name: 'setCampaignLeadEmail',
  description:
    'Configure which field is used as the lead email address for a campaign. Binds the email field to the campaign action fields so leads can be added and deduplicated correctly.',
  notes:
    'FREE; no credits consumed. The campaign table has a default "Email" field auto-created on campaign creation; use its field ID. The tableId is the campaign table ID (t_xxx format) from createCampaign or listCampaigns.',
  input: z.object({
    tableId: z
      .string()
      .describe(
        'Campaign table ID (t_xxx format) from createCampaign or listCampaigns',
      ),
    campaignId: z
      .number()
      .describe(
        'Smartlead campaign ID (from listCampaigns smartleadCampaignId)',
      ),
    leadEmailFieldId: z
      .string()
      .describe(
        'Field ID (f_xxx format) of the email column on the campaign table to use as lead email',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the email binding was configured'),
    addLeadFieldId: z
      .string()
      .nullable()
      .describe(
        'Field ID of the "Add lead to campaign" action field that was updated',
      ),
    validateLeadFieldId: z
      .string()
      .nullable()
      .describe(
        'Field ID of the "Validate lead input" action field that was updated',
      ),
  }),
};

export const getCreditReportSchema = {
  name: 'getCreditReport',
  description:
    'Get credit usage report showing consumption by workspace tables/integrations/signals.',
  notes:
    'FREE; no credits consumed. reportType: "workspace" groups by workbook (with table subentities), "integration" groups by enrichment provider, "signal" groups by signal.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    reportType: z
      .enum(['workspace', 'integration', 'signal'])
      .describe(
        'Report grouping type: "workspace" = by workbook/table, "integration" = by enrichment provider, "signal" = by signal',
      ),
    startTime: z
      .string()
      .describe(
        'Start of date range (ISO 8601, e.g. "2026-02-01T00:00:00Z"). Required.',
      ),
    endTime: z
      .string()
      .describe(
        'End of date range (ISO 8601, e.g. "2026-02-12T00:00:00Z"). Required.',
      ),
  }),
  output: z.object({
    entities: z.array(
      z.object({
        id: z
          .string()
          .describe('Entity ID (workbook, integration, or signal ID)'),
        entity: z.object({
          name: z.string(),
          isDeleted: z.boolean(),
          __kind: z
            .string()
            .describe('Entity type: "workbook", "integration", "table", etc.'),
          owner: z
            .object({
              id: z.number(),
              username: z.string(),
              email: z.string(),
              name: z.string(),
              profilePicture: z.string().nullable().optional(),
              fullName: z.string().optional(),
            })
            .optional()
            .describe('Owner info (present for workspace/signal reports)'),
        }),
        credits: z.number().describe('Credits consumed by this entity'),
        subentities: z
          .array(
            z.object({
              id: z.string(),
              entity: z.object({
                name: z.string(),
                isDeleted: z.boolean(),
                __kind: z.string(),
                owner: z
                  .object({
                    id: z.number(),
                    username: z.string(),
                    email: z.string(),
                    name: z.string(),
                    profilePicture: z.string().nullable().optional(),
                    fullName: z.string().optional(),
                  })
                  .optional(),
              }),
              credits: z.number(),
              actionExecutions: z.number(),
              hasRecurringUsage: z.boolean().optional(),
            }),
          )
          .optional()
          .describe(
            'Sub-entities (tables within workbooks, workspace report only)',
          ),
        actionExecutions: z
          .number()
          .optional()
          .describe('Number of action executions'),
        hasRecurringUsage: z
          .boolean()
          .optional()
          .describe('Whether entity has recurring credit usage'),
        creditLimitInfo: z
          .object({
            hasCreditLimit: z.boolean(),
          })
          .optional()
          .describe('Credit limit info (workspace report only)'),
      }),
    ),
    unattributedCredits: z
      .number()
      .describe('Credits not attributed to any entity'),
  }),
};

export const getGlobalCampaignStatsSchema = {
  name: 'getGlobalCampaignStats',
  description:
    'Get per-campaign performance stats across all campaigns in a date range.',
  notes:
    'FREE; no credits consumed. Returns sent/opened/replied/bounced counts and rates per campaign.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    startDate: z
      .string()
      .describe('Start date in ISO format (e.g. 2025-01-01)'),
    endDate: z.string().describe('End date in ISO format (e.g. 2025-12-31)'),
  }),
  output: z.object({
    campaignWisePerformance: z
      .array(
        z.object({
          id: z.number().describe('Smartlead campaign ID (integer)'),
          campaignName: z.string(),
          sent: z.number(),
          opened: z.number(),
          replied: z.number(),
          bounced: z.number(),
          openRate: z.string().optional().describe('e.g. "25.00%"'),
          replyRate: z.string().optional().describe('e.g. "10.00%"'),
          bounceRate: z.string().optional().describe('e.g. "2.00%"'),
          positiveReplyRate: z.string().optional(),
          positiveReplied: z.number().optional(),
          uniqueLeadCount: z.number().optional(),
          uniqueOpenCount: z.number().optional(),
        }),
      )
      .describe(
        'Per-campaign breakdown. Empty array if no campaigns have sent emails in the date range.',
      ),
  }),
};

export const inviteWorkspaceMemberSchema = {
  name: 'inviteWorkspaceMember',
  description: 'Invite a new member to the workspace by email.',
  notes:
    'FREE; no credits consumed. Sends an invitation email. Role defaults to workspace-member. If the email belongs to an existing Clay user, the user object is populated; otherwise user is null and the invite is pending.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    email: z.string().describe('Email address of the person to invite'),
    role: z
      .enum([
        'workspace-admin',
        'workspace-member',
        'workspace-viewer',
        'workspace-sales-rep',
      ])
      .optional()
      .describe('Role to assign (default: workspace-member)'),
  }),
  output: z.object({
    roleId: z
      .string()
      .describe(
        'UUID of the role assignment. Use this with removeWorkspaceMember to revoke the invitation.',
      ),
    email: z.string().describe('Email address that was invited'),
    pending: z
      .boolean()
      .describe('True if the user has not yet accepted the invitation'),
    user: z
      .object({
        id: z.number(),
        username: z.string(),
        email: z.string(),
        name: z.string(),
        fullName: z.string(),
        profilePicture: z.string().optional(),
      })
      .nullable()
      .describe(
        'User details if the email belongs to an existing Clay user, null otherwise',
      ),
    role: z.object({
      id: z.string().describe('Role assignment UUID (same as roleId)'),
      role: z.string().describe('Role name (e.g. workspace-member)'),
    }),
  }),
};

export const removeWorkspaceMemberSchema = {
  name: 'removeWorkspaceMember',
  description:
    'Remove a member or pending invitation from a workspace. DESTRUCTIVE; cannot be undone.',
  notes:
    'FREE; no credits consumed. Cannot remove the workspace owner. Use listWorkspaceMembers to get the roleId (the role.id field). Works for both active members and pending invitations. The function validates that roleId belongs to the specified workspace before deleting; passing a mismatched workspaceId will throw an error, not silently delete.',
  input: z.object({
    workspaceId: z
      .string()
      .describe(
        'Workspace ID: required for safety validation. The function verifies the roleId belongs to this workspace before deleting.',
      ),
    roleId: z
      .string()
      .describe(
        'The role assignment UUID: this is the role.id field from listWorkspaceMembers, NOT the user id. Must be a valid UUID format.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe(
        'Always true on success. The function throws an error on any failure (invalid inputs, roleId not found, API errors).',
      ),
  }),
};

export const updateWorkspaceMemberRoleSchema = {
  name: 'updateWorkspaceMemberRole',
  description:
    "Update a workspace member's role (e.g., promote to admin or demote to editor).",
  notes:
    'FREE; no credits consumed. Requires the userRoleId from listWorkspaceMembers (the role.id field, NOT the user id).',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    userRoleId: z
      .string()
      .describe(
        'The role assignment ID for the user: this is the role.id field from listWorkspaceMembers, NOT the user id.',
      ),
    role: z
      .enum([
        'workspace-admin',
        'workspace-member',
        'workspace-viewer',
        'workspace-sales-rep',
      ])
      .describe(
        'Role to assign. workspace-admin = Admin (full access, manage users). workspace-member = Editor (can edit resources). workspace-viewer = Viewer (read-only). workspace-sales-rep = Sales Rep (limited access).',
      ),
  }),
  output: z.object({
    success: z.boolean(),
    userRoleId: z.string().describe('Role assignment ID'),
    role: z.string().describe('New role name after update'),
    email: z.string().describe('Email of the updated user'),
  }),
};

export const createWebhookSourceSchema = {
  name: 'createWebhookSource',
  description:
    'Create a webhook source on a table. Returns a unique webhook URL that accepts JSON POST requests to add records.',
  notes:
    'FREE; no credits consumed. The returned webhookUrl can receive JSON POST requests. Each POST creates a new record in the table.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    tableId: z.string().describe('Table ID to attach the webhook source to'),
    name: z.string().optional().describe('Name for the webhook source'),
  }),
  output: z.object({
    sourceId: z.string().describe('Source ID'),
    webhookUrl: z.string().describe('URL to POST data to for adding records'),
    name: z.string().describe('Name of the created webhook source'),
  }),
};

export const createGoogleSheetsSourceSchema = {
  name: 'createGoogleSheetsSource',
  description:
    'Create a Google Sheets data source on a table. Pulls rows from a Google Spreadsheet into the Clay table.',
  notes:
    'FREE; no credits consumed to create. Requires a connected Google account; use listAppAccounts to find a Google Sheets app account (provider type google-sheets-restricted). If no Google account is connected, the user must connect one in Clay workspace settings first. The spreadsheetUrl must be a full Google Sheets URL. Optionally specify sheetId for a specific tab (defaults to first sheet).',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    tableId: z
      .string()
      .describe('Table ID to attach the Google Sheets source to'),
    spreadsheetUrl: z
      .string()
      .describe(
        'Full Google Spreadsheet URL (e.g., "https://docs.google.com/spreadsheets/d/1abc.../edit")',
      ),
    appAccountId: z
      .string()
      .optional()
      .describe(
        'Google Sheets app account ID from listAppAccounts (provider type google-sheets-restricted). Required for private spreadsheets.',
      ),
    sheetId: z
      .string()
      .optional()
      .describe(
        'Specific sheet tab ID within the spreadsheet (e.g., "0" for the first sheet). Defaults to first sheet if omitted.',
      ),
    name: z
      .string()
      .optional()
      .describe('Name for the source (defaults to "Google Sheets")'),
    columnMapping: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Optional column mapping from spreadsheet columns to Clay field names',
      ),
  }),
  output: z.object({
    sourceId: z.string().describe('Created source ID'),
    name: z.string().describe('Source name'),
    status: z
      .string()
      .describe(
        'Source action status. RUNNING = syncing, ERROR_MISSING_INPUT = needs configuration, COMPLETED = done',
      ),
    message: z
      .string()
      .optional()
      .describe('Status message (present on errors)'),
    numSourceRecords: z.number().describe('Number of records synced so far'),
  }),
};

export const createCrmImportSourceSchema = {
  name: 'createCrmImportSource',
  description:
    'Create a CRM import source on a table. Imports contacts, companies, deals, or other objects from a connected HubSpot or Salesforce account.',
  notes:
    'FREE; no credits consumed to create the source. Requires a connected CRM account; use listAppAccounts to find a HubSpot or Salesforce app account. If no CRM account is connected, the source will be created but will fail with ERROR_INVALID_CREDENTIALS status. The source begins syncing automatically after creation. Use getTableRecords to read imported data once status is COMPLETED.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    tableId: z.string().describe('Table ID to attach the CRM import source to'),
    crmType: z
      .enum(['hubspot', 'salesforce', 'salesforce-report', 'salesforce-soql'])
      .describe(
        'CRM type. hubspot = Import objects from HubSpot (contacts, companies, deals via unified endpoint). salesforce = Import records from a Salesforce list view. salesforce-report = Import from a Salesforce report (max 2000 rows). salesforce-soql = Import via custom SOQL query.',
      ),
    appAccountId: z
      .string()
      .optional()
      .describe(
        'Connected CRM app account ID from listAppAccounts (provider type hubspot or salesforce). Without this, the source will be created but fail to sync.',
      ),
    name: z
      .string()
      .optional()
      .describe(
        'Name for the source (defaults to "{CrmType} Import", e.g., "Hubspot Import")',
      ),
  }),
  output: z.object({
    sourceId: z.string().describe('Created source ID'),
    name: z.string().describe('Source name'),
    actionKey: z
      .string()
      .describe(
        'Internal action key used (e.g., hubspot-crm-objects-source, salesforce-records-view-source-v2)',
      ),
    status: z
      .string()
      .describe(
        'Source action status. RUNNING = syncing, ERROR_INVALID_CREDENTIALS = CRM not connected, COMPLETED = import done',
      ),
    message: z
      .string()
      .optional()
      .describe(
        'Status message (present on errors, e.g., "Please authorize Hubspot")',
      ),
    numSourceRecords: z
      .number()
      .describe('Number of records imported so far (0 initially)'),
  }),
};

export const createActionSourceSchema = {
  name: 'createActionSource',
  description:
    'Create any data source on a table from the Clay enrichment catalog. Supports 40+ source types including Apollo, Dynamics 365, Snowflake, BigQuery, Airtable, GitHub, Reddit, X/Twitter, Google Search, Typeform, Apify, PhantomBuster, Gong, and many more. Use searchEnrichments() with types=["source_action"] to discover available sources and get the entityId.',
  notes:
    'FREE to create. Use searchEnrichments({query: "apollo", types: ["source_action"]}) to discover sources and get the entityId. ' +
    'Then call getActionInputs() with the entityId to learn what inputs the source expects (field names, types, required/optional, select options). ' +
    'Many sources require a connected app account; check getActionInputs().authProvider and pass appAccountId from listAppAccounts(). ' +
    'After creation, use getSourceRuns() to monitor import progress.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    tableId: z.string().describe('Table ID (t_xxx) to attach the source to'),
    entityId: z
      .string()
      .describe(
        'Source entity ID from searchEnrichments() in "{actionPackageId}/{actionKey}" format (e.g., "778df10d-f68b-461a-8eb7-56047737f5eb/apollo-oauth-find-people-source")',
      ),
    appAccountId: z
      .string()
      .optional()
      .describe(
        'Connected app account ID (aa_xxx) from listAppAccounts(). Required for sources needing third-party auth (Apollo, HubSpot, Salesforce, Snowflake, etc.)',
      ),
    inputs: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Source-specific input parameters as key-value pairs. Values are strings (wrap numbers in quotes). E.g., for Apollo: {person_titles: "\\"CIO\\"", q_organization_domains: "\\"amd.com\\"", limit: "25"}. Create with empty inputs first to discover required fields from settingsErrors.',
      ),
    name: z
      .string()
      .optional()
      .describe(
        'Display name for the source. Defaults to the action name from the catalog.',
      ),
    scheduleConfig: z
      .object({
        runSettings: z
          .enum(['once', 'schedule'])
          .describe(
            '"once" to run once, "schedule" to run on a recurring schedule',
          ),
        periodUnit: z
          .enum(['hourly', 'daily', 'weekly', 'monthly'])
          .optional()
          .describe('Schedule period (required if runSettings is "schedule")'),
        periodAmount: z
          .number()
          .optional()
          .describe('Number of periods between runs (default: 1)'),
      })
      .optional()
      .describe(
        'Schedule config. Defaults to run once. Use {runSettings: "schedule", periodUnit: "daily"} for daily imports.',
      ),
  }),
  output: z.object({
    sourceId: z.string().describe('Created source ID (s_xxx)'),
    name: z.string().describe('Source display name'),
    actionKey: z.string().describe('Action key identifying the source type'),
    status: z
      .string()
      .describe(
        'Source status: CREATED, RUNNING, SUCCESS, ERROR. ERROR_INVALID_CREDENTIALS means auth is needed.',
      ),
    message: z
      .string()
      .optional()
      .describe('Status message (present on errors)'),
    numSourceRecords: z
      .number()
      .describe('Number of records imported (0 initially)'),
    settingsErrors: z
      .array(
        z.object({
          type: z
            .string()
            .describe('Error type (e.g., "MISSING_AUTH", "MISSING_INPUT")'),
          message: z.string().describe('Human-readable error description'),
        }),
      )
      .optional()
      .describe(
        'Configuration errors: check this to discover required inputs or auth',
      ),
  }),
};

export type CreateActionSourceInput = z.infer<
  typeof createActionSourceSchema.input
>;
export type CreateActionSourceOutput = z.infer<
  typeof createActionSourceSchema.output
>;

export const getActionInputsSchema = {
  name: 'getActionInputs',
  description:
    'Get the input parameter schema for a specific action (source, enrichment, or any action type). Returns the full input definition including field names, types, descriptions, options for select fields, and whether each field is required. Use this to discover what inputs a source or enrichment needs before creating it.',
  notes:
    'FREE operation. Use searchEnrichments() first to find the entityId, then call this to learn what inputs the action expects. ' +
    'Fields with type "dynamic-fields" require auth connection first (pass appAccountId to createActionSource). ' +
    'Fields with type "select" include an options array with valid values. ' +
    'Fields with type "tags" accept comma-separated values.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    entityId: z
      .string()
      .describe(
        'Action entity ID from searchEnrichments() in "{actionPackageId}/{actionKey}" format',
      ),
  }),
  output: z.object({
    actionKey: z.string().describe('Action key'),
    packageName: z.string().describe('Provider/package display name'),
    displayName: z.string().describe('Action display name'),
    version: z.number().describe('Action version'),
    authProvider: z
      .string()
      .nullable()
      .describe(
        'Auth provider type if auth is required (e.g., "apollo", "gong", "google-bigquery"). null if no auth needed.',
      ),
    inputs: z
      .array(
        z.object({
          name: z
            .string()
            .describe('Input parameter key to pass in the inputs object'),
          displayName: z.string().describe('Human-readable field label'),
          description: z
            .string()
            .optional()
            .describe('Field description with usage guidance'),
          type: z
            .string()
            .describe(
              'Field type: "text", "number", "boolean", "select", "tags", "url", "longtext", "map", "object", "dynamic-fields", "dynamic-options-select"',
            ),
          required: z.boolean().describe('Whether this field is required'),
          options: z
            .array(
              z.object({
                value: z.string().describe('Option value to pass'),
                displayName: z.string().describe('Human-readable option label'),
              }),
            )
            .optional()
            .describe('Available options for select/enum fields'),
          min: z
            .number()
            .optional()
            .describe('Minimum value for number fields'),
          max: z
            .number()
            .optional()
            .describe('Maximum value for number fields'),
          placeholder: z
            .string()
            .optional()
            .describe('Placeholder text showing example input'),
        }),
      )
      .describe('Input parameter definitions'),
    outputs: z
      .array(
        z.object({
          name: z.string().describe('Output field name'),
          type: z.string().describe('Output field type'),
          displayName: z.string().describe('Human-readable output label'),
        }),
      )
      .describe(
        'Output field definitions (what columns the source/enrichment produces)',
      ),
  }),
};

export type GetActionInputsInput = z.infer<typeof getActionInputsSchema.input>;
export type GetActionInputsOutput = z.infer<
  typeof getActionInputsSchema.output
>;

export const getDynamicFieldOptionsSchema = {
  name: 'getDynamicFieldOptions',
  description:
    'Resolve dynamic field options for an action that has "dynamic-fields" or "dynamic-options-select" input types. Some actions (like HubSpot CRM import) have inputs whose options depend on the connected account; this fetches the actual available values at runtime.',
  notes:
    'Use after getActionInputs() when an input has type "dynamic-fields" or "dynamic-options-select". ' +
    'Requires an appAccountId (connected account). The parameterPath is the input field name from getActionInputs(). ' +
    'Pass any already-selected inputs in the currentInputs object (e.g., after selecting objectTypeId, pass it to resolve dependent fields like listId).',
  input: z.object({
    actionPackageId: z
      .string()
      .describe(
        'Action package ID (UUID): first part of the entityId before the slash',
      ),
    actionKey: z
      .string()
      .describe('Action key: second part of the entityId after the slash'),
    authAccountId: z
      .string()
      .describe('Connected app account ID (aa_xxx) from listAppAccounts()'),
    parameterPath: z
      .string()
      .describe(
        'The input field name to resolve options for (e.g., "objectTypeId", "listId")',
      ),
    currentInputs: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Already-selected input values to provide context for dependent fields. Keys are field names, values are the selected values.',
      ),
  }),
  output: z.object({
    parameterPath: z.string().describe('The field name that was resolved'),
    options: z
      .array(
        z.object({
          value: z.string().describe('Option value to pass as input'),
          displayName: z.string().describe('Human-readable option label'),
        }),
      )
      .describe('Available options for this dynamic field'),
  }),
};

export type GetDynamicFieldOptionsInput = z.infer<
  typeof getDynamicFieldOptionsSchema.input
>;
export type GetDynamicFieldOptionsOutput = z.infer<
  typeof getDynamicFieldOptionsSchema.output
>;

export const createSalesNavSourceSchema = {
  name: 'createSalesNavSource',
  description:
    "Create a LinkedIn Sales Navigator (prospector) people search source on a table. Stores search criteria as a persistent import source backed by Clay's LinkedIn data provider.",
  notes:
    'FREE to create the source; no credits consumed at creation time. Uses the same people search filters as searchPeople / createPeopleTable. The source type is "prospector-source". WARNING: This function creates the source definition only. The import does NOT run automatically; there is no programmatic way to trigger source imports via the API. Use createSourceFromSearch / createPeopleTable instead for a one-shot create-and-populate flow. The filters accept company_identifier values including Sales Navigator company URLs and company IDs. Maximum limit is 2,500 per source.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    tableId: z.string().describe('Table ID to attach the Sales Nav source to'),
    filters: PeopleSearchFiltersSchema.describe(
      'People search filters: same format as searchPeople. Use job_title_keywords, company_sizes, locations, etc. to define the target audience. The company_identifier field accepts Sales Navigator company URLs and IDs.',
    ),
    limit: z
      .number()
      .optional()
      .describe(
        'Maximum number of people to import (1-2500, default 1000). Each imported person costs approximately 1 credit when run.',
      ),
    name: z
      .string()
      .optional()
      .describe('Name for the source (defaults to "Sales Nav Import")'),
  }),
  output: z.object({
    sourceId: z.string().describe('Created source ID (s_xxx format)'),
    name: z.string().describe('Source name'),
    type: z.string().describe('Source type (always "prospector-source")'),
    numSourceRecords: z
      .number()
      .describe(
        'Number of records in the source (0 at creation; records populate when the source import is run)',
      ),
  }),
};

export const deleteCampaignWebhookSchema = {
  name: 'deleteCampaignWebhook',
  description: 'Delete a webhook from a campaign.',
  notes:
    'FREE; no credits consumed. Use listCampaignWebhooks to find webhook IDs.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z.number().describe('Smartlead campaign ID'),
    webhookId: z.number().describe('Webhook ID to delete'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const setLeadCategorySchema = {
  name: 'setLeadCategory',
  description:
    'Categorize a lead reply in the campaign inbox (interested, not interested, etc.).',
  notes:
    'FREE; no credits consumed. Uses emailLeadMapId from listInboxReplies reply objects.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    emailLeadMapId: z
      .number()
      .describe('Email lead map ID from listInboxReplies'),
    categoryId: z
      .number()
      .describe(
        'Category ID: 1=Interested, 2=Meeting Request, 3=Not Interested, 4=Do Not Contact, 5=Information Request, 6=Out Of Office, 7=Wrong Person',
      ),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const setLeadReadStatusSchema = {
  name: 'setLeadReadStatus',
  description:
    'Mark a lead conversation as read or unread in the campaign inbox.',
  notes:
    'FREE; no credits consumed. Uses emailLeadMapId from listInboxReplies reply objects.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    emailLeadMapId: z
      .number()
      .describe('Email lead map ID from listInboxReplies'),
    readStatus: z
      .enum(['READ', 'UNREAD'])
      .describe('READ to mark as read, UNREAD for unread'),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

export const getMessageHistorySchema = {
  name: 'getMessageHistory',
  description:
    'Get the full email message history for a specific lead in a campaign.',
  notes:
    'FREE; no credits consumed. Returns all sent/received messages in the conversation thread. Uses leadId from listInboxReplies reply objects (emailLeadId). Returns empty messages array when the lead has no message history.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    campaignId: z
      .number()
      .describe(
        'Smartlead campaign ID (emailCampaignId from listInboxReplies)',
      ),
    leadId: z.number().describe('Lead ID (emailLeadId from listInboxReplies)'),
  }),
  output: z.object({
    messages: z.array(
      z.object({
        type: z
          .string()
          .describe('Message type: "SENT" for outbound, "REPLY" for inbound'),
        messageId: z.string().describe('Unique message identifier'),
        statsId: z.string().describe('Statistics tracking ID'),
        subject: z.string().describe('Email subject line'),
        body: z.string().describe('Email body (HTML)'),
        time: z.string().describe('ISO 8601 timestamp'),
        from: z.string().describe('Sender email address'),
        to: z.string().describe('Recipient email address'),
        emailSeqNumber: z
          .string()
          .optional()
          .describe('Sequence step number (outbound emails only)'),
        openCount: z
          .number()
          .optional()
          .describe('Number of opens (outbound emails only)'),
        clickCount: z
          .number()
          .optional()
          .describe('Number of clicks (outbound emails only)'),
      }),
    ),
  }),
};

export const listTrashSchema = {
  name: 'listTrash',
  description:
    'List deleted/trashed tables and workbooks that can be restored.',
  notes:
    'FREE; no credits consumed. Returns resources in the workspace trash. Use resourceType (WORKBOOK or TABLE) to determine what kind of resource it is. Pass the id to restoreResource in the matching type array (tableIds or workbookIds).',
  input: z.object({
    workspaceId: WorkspaceIdParam,
  }),
  output: z.object({
    resources: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        resourceType: z
          .enum(['WORKBOOK', 'TABLE'])
          .describe(
            'Resource type: determines which array to use in restoreResource',
          ),
        description: z.string().nullable(),
        ownerId: z.string(),
        owner: z.object({
          id: z.number(),
          username: z.string(),
          name: z.string(),
          fullName: z.string().optional(),
          email: z.string(),
          profilePicture: z.string().nullable().optional(),
        }),
        parentFolderId: z.string().nullable(),
        workbookId: z
          .string()
          .optional()
          .describe('Parent workbook ID (TABLE resources only)'),
        deletedAt: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
      }),
    ),
  }),
};

export const restoreResourceSchema = {
  name: 'restoreResource',
  description:
    'Restore deleted resources (tables, workbooks, folders) from the trash.',
  notes:
    'FREE; no credits consumed. Use listTrash to find resource IDs. Pass IDs in the matching type array. Returns the restored resources with updated metadata (deletedAt becomes null).',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    tableIds: z.array(z.string()).optional().describe('Table IDs to restore'),
    workbookIds: z
      .array(z.string())
      .optional()
      .describe('Workbook IDs to restore'),
    folderIds: z.array(z.string()).optional().describe('Folder IDs to restore'),
  }),
  output: z.object({
    resources: z.array(
      z.object({
        resourceType: z
          .enum(['WORKBOOK', 'TABLE', 'FOLDER'])
          .describe('Type of restored resource'),
        id: z.string().describe('Resource ID'),
        workspaceId: z.number().describe('Workspace ID (numeric)'),
        name: z.string().describe('Resource name'),
        description: z.string().nullable().describe('Resource description'),
        parentFolderId: z
          .string()
          .nullable()
          .describe('Parent folder ID if any'),
        workbookId: z
          .string()
          .optional()
          .describe('Parent workbook ID (present for TABLE resources only)'),
        ownerId: z.string().describe('Owner user ID'),
        defaultAccess: z
          .string()
          .optional()
          .describe('Default access level (e.g. "all")'),
        isHiddenFromNavigation: z
          .boolean()
          .optional()
          .describe('Whether hidden from workspace navigation'),
        abilities: z
          .object({
            canUpdate: z.boolean().optional(),
            canDelete: z.boolean().optional(),
            canManageAccess: z.boolean().optional(),
            canUpdateFromSandbox: z.boolean().optional(),
          })
          .optional()
          .describe('Permission abilities for the resource'),
        tags: z
          .array(z.string())
          .optional()
          .describe('Tags attached to the resource'),
        createdAt: z.string().describe('Creation timestamp'),
        updatedAt: z.string().describe('Last update timestamp'),
        deletedAt: z
          .string()
          .nullable()
          .describe('Deletion timestamp (null after restore)'),
      }),
    ),
  }),
};

// ============================================================================
// Workspace & Workbook Schemas (New)
// ============================================================================

export const updateWorkspaceSchema = {
  name: 'updateWorkspace',
  description:
    'Update workspace name. Returns the full updated workspace details.',
  notes: 'FREE; no credits consumed. Requires workspace admin permissions.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    name: z.string().describe('New workspace name'),
  }),
  output: ClayWorkspaceDetailsSchema,
};

export const getResourceSchema = {
  name: 'getResource',
  description:
    'Get specific resource details by ID (workbook, table, or folder). Returns ownership, access, timestamps, and navigation path.',
  notes:
    'Endpoint: GET /workspaces/{wsId}/resources/{resourceId}?resourceType={type}. Response is wrapped in { resource: {...} }.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    resourceId: z
      .string()
      .describe(
        'Resource ID (e.g. "wb_xxx" for workbook, "t_xxx" for table, folder UUID for folder)',
      ),
    resourceType: z
      .enum(['WORKBOOK', 'TABLE', 'FOLDER'])
      .describe(
        'Type of resource: must match the actual type of the resourceId',
      ),
  }),
  output: z.object({
    id: z.string(),
    resourceType: z.enum(['WORKBOOK', 'TABLE', 'FOLDER']),
    name: z.string(),
    description: z.string().nullable(),
    workspaceId: z.number(),
    parentFolderId: z.string().nullable(),
    settings: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Present for WORKBOOK, absent for TABLE/FOLDER'),
    annotations: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Present for WORKBOOK, absent for TABLE/FOLDER'),
    defaultAccess: z
      .string()
      .optional()
      .describe(
        'Access level: "all", "restricted", etc. Present for WORKBOOK/TABLE, absent for FOLDER',
      ),
    ownerId: z
      .string()
      .optional()
      .describe('Present for WORKBOOK/TABLE, absent for FOLDER'),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullable(),
    isHidden: z
      .boolean()
      .optional()
      .describe('Present for WORKBOOK, absent for TABLE/FOLDER'),
    isHiddenFromNavigation: z
      .boolean()
      .optional()
      .describe('Present for WORKBOOK/TABLE, absent for FOLDER'),
    creditLimit: z
      .number()
      .nullable()
      .optional()
      .describe('Present for WORKBOOK, absent for TABLE/FOLDER'),
    abilities: z.object({
      canDelete: z.boolean(),
      canUpdate: z.boolean(),
      canManageAccess: z
        .boolean()
        .optional()
        .describe('Present for WORKBOOK/TABLE, absent for FOLDER'),
      canUpdateFromSandbox: z
        .boolean()
        .optional()
        .describe('Present for TABLE'),
    }),
    isStarred: z.boolean(),
    lastOpenedAt: z
      .string()
      .nullable()
      .optional()
      .describe('Present for WORKBOOK, absent for TABLE/FOLDER'),
    owner: z
      .object({
        id: z.number(),
        username: z.string(),
        email: z.string(),
        name: z.string(),
        profilePicture: z.string().nullable(),
        fullName: z.string(),
      })
      .optional()
      .describe('Present for WORKBOOK/TABLE, absent for FOLDER'),
    parentResourcePath: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          type: z.string(),
        }),
      )
      .describe('Breadcrumb path from workspace root to this resource'),
    tags: z.array(z.string()),
  }),
};

export const logResourceActivitySchema = {
  name: 'logResourceActivity',
  description:
    'Log resource activity (view/open) - updates lastOpenedAt timestamp',
  notes: '',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    resourceId: z
      .string()
      .describe(
        'Resource ID (e.g. "wb_xxx" for workbook, "t_xxx" for table, "fl_xxx" for folder)',
      ),
    resourceType: z
      .enum(['WORKBOOK', 'TABLE', 'FOLDER'])
      .describe('Type of the resource being accessed'),
    activityType: z.enum(['LAST_OPENED']).describe('Type of activity to log'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the activity was logged successfully'),
  }),
};

export const removeWorkspaceUserSchema = {
  name: 'removeWorkspaceUser',
  description:
    'Remove a user from the workspace by their numeric user ID. Looks up the user in workspace permissions and deletes their role assignment. Cannot remove the workspace owner (workspace-admin). Get user IDs from listWorkspaceMembers.',
  notes: '',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    userId: z
      .string()
      .describe(
        'Numeric user ID to remove (from listWorkspaceMembers id field, e.g. "1152423")',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the user was successfully removed from the workspace'),
  }),
};

export const getKnockTokenSchema = {
  name: 'getKnockToken',
  description:
    'Get auth token for Knock.app notifications service. Returns a signed JWT for authenticating with Knock notification APIs. No parameters required.',
  notes: '',
  input: z.object({}),
  output: z.object({
    token: z
      .string()
      .describe('Signed JWT token for Knock.app API authentication'),
  }),
};

export const getCreditAccrualSchema = {
  name: 'getCreditAccrual',
  description:
    'Get credit accrual/rewards history for a workspace. Returns a list of credit accruals including rewards (e.g. first_table bonus) with amounts and balance snapshots.',
  notes: '',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    rewardsOnly: z
      .boolean()
      .optional()
      .describe('When true, filter to reward-type accruals only'),
  }),
  output: z.object({
    accruals: z.array(
      z.object({
        id: z.string().describe('Credit accrual ID (e.g. "creda_xxx")'),
        workspaceId: z.number().describe('Workspace ID'),
        accrualType: z.string().describe('Type of accrual (e.g. "reward")'),
        metadata: z.object({
          type: z
            .string()
            .describe('Reward type identifier (e.g. "first_table")'),
          balanceSnapshot: z.object({
            balanceAfter: z.number().describe('Credit balance after accrual'),
            balanceBefore: z.number().describe('Credit balance before accrual'),
          }),
        }),
        createdAt: z.string().describe('ISO 8601 timestamp'),
        amount: z.number().describe('Number of credits accrued'),
        creditType: z.string().describe('Credit type (e.g. "basic")'),
      }),
    ),
  }),
};

export const getWorkbookSchema = {
  name: 'getWorkbook',
  description:
    'Get a single workbook by ID, including owner, settings, abilities, tags, and an ordered list of tables in the workbook',
  notes: '',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    workbookId: z.string().describe('Workbook ID (e.g. "wb_xxx")'),
  }),
  output: z.object({
    id: z.string().describe('Workbook ID'),
    workspaceId: z.number().describe('Workspace ID'),
    name: z.string().describe('Workbook name'),
    description: z.string().nullable().describe('Workbook description'),
    parentFolderId: z
      .string()
      .nullable()
      .describe('Parent folder ID if nested'),
    settings: z
      .record(z.string(), z.unknown())
      .describe('Workbook settings (e.g. { isAutoRun: true })'),
    annotations: z
      .record(z.string(), z.unknown())
      .describe('Workbook annotations'),
    defaultAccess: z.string().describe('Default access level (e.g. "all")'),
    ownerId: z.string().describe('Owner user ID (as string)'),
    createdAt: z.string().describe('ISO 8601 creation timestamp'),
    updatedAt: z.string().describe('ISO 8601 last update timestamp'),
    deletedAt: z
      .string()
      .nullable()
      .describe('ISO 8601 deletion timestamp or null'),
    isHidden: z.boolean().describe('Whether workbook is hidden'),
    isHiddenFromNavigation: z
      .boolean()
      .describe('Whether workbook is hidden from navigation sidebar'),
    creditLimit: z.number().nullable().describe('Credit limit for workbook'),
    abilities: z
      .object({
        canDelete: z.boolean().optional(),
        canUpdate: z.boolean().optional(),
        canManageAccess: z.boolean().optional(),
      })
      .describe('Current user permissions'),
    owner: z
      .object({
        id: z.number(),
        username: z.string(),
        email: z.string(),
        name: z.string(),
        profilePicture: z.string().nullable().optional(),
        fullName: z.string().optional(),
      })
      .optional()
      .describe('Workbook owner details'),
    tags: z.array(z.string()).describe('Workbook tags'),
    orderedWorkbookTables: z
      .array(
        z.object({
          id: z.string().describe('Table ID (e.g. "t_xxx")'),
          name: z.string().describe('Table name'),
          tableType: z
            .string()
            .describe('Table type (e.g. "people", "spreadsheet", "company")'),
          blockType: z
            .string()
            .optional()
            .describe('Block type if applicable (e.g. "MESSAGING")'),
          firstViewId: z
            .string()
            .nullable()
            .optional()
            .describe('First view ID or null'),
        }),
      )
      .describe('Tables in this workbook, in display order'),
  }),
};

export const getWorkbookOverviewSchema = {
  name: 'getWorkbookOverview',
  description:
    'Get workbook overview graph showing tables, sources, and their connections. Returns a DAG of nodes (tables and data sources) and edges (data flow between them). Useful for understanding workbook structure and data pipeline.',
  notes:
    'Endpoint: GET /{workspaceId}/workbooks/{workbookId}/overview. Node types are "Table" (with tableDetails and sendDataFields) or "Source" (with action info and sourceIdentifier). Edges represent data flow (e.g. SourceSubscription).',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    workbookId: z.string().describe('Workbook ID (e.g. "wb_...")'),
  }),
  output: z.object({
    nodes: z
      .array(
        z.object({
          nodeId: z
            .string()
            .describe('Node identifier (table ID or source ID)'),
          name: z.string().describe('Display name of the node'),
          description: z.string().optional().describe('Node description'),
          creditEstimate: z
            .number()
            .nullable()
            .describe('Estimated credit cost per row, or null'),
          totalFieldCount: z
            .number()
            .optional()
            .describe('Number of fields (Table nodes only)'),
          type: z
            .enum(['Table', 'Source'])
            .describe('Node type: Table or Source'),
          tableDetails: z
            .object({
              id: z.string(),
              workspaceId: z.number(),
              createdByUserId: z.string().optional(),
              name: z.string(),
              description: z.string().optional(),
              type: z
                .string()
                .describe('Table type (e.g. "people", "spreadsheet")'),
              icon: z
                .object({
                  emoji: z.string().optional(),
                  url: z.string().optional(),
                })
                .nullable()
                .optional(),
              parentFolderId: z.string().nullable().optional(),
              tableSettings: z.record(z.string(), z.unknown()).optional(),
              createdAt: z.string(),
              updatedAt: z.string(),
              deletedAt: z.string().nullable().optional(),
              fieldGroupMap: z.record(z.string(), z.unknown()).optional(),
              workbookId: z.string().optional(),
              defaultAccess: z.string().optional(),
              ownerId: z.string().optional(),
              isSandbox: z.boolean().optional(),
              isHiddenFromNavigation: z.boolean().optional(),
              abilities: z
                .object({
                  canUpdate: z.boolean().optional(),
                  canDelete: z.boolean().optional(),
                  canManageAccess: z.boolean().optional(),
                  canUpdateFromSandbox: z.boolean().optional(),
                })
                .optional(),
              firstViewId: z.string().nullable().optional(),
              owner: z
                .object({
                  id: z.number(),
                  username: z.string(),
                  email: z.string(),
                  name: z.string(),
                  fullName: z.string().optional(),
                  profilePicture: z.string().nullable().optional(),
                })
                .nullable()
                .optional(),
            })
            .optional()
            .describe('Full table details (Table nodes only)'),
          sendDataFields: z
            .array(
              z.object({
                id: z.string(),
                tableId: z.string(),
                type: z.string(),
                name: z.string(),
                description: z.string().nullable().optional(),
                isSortable: z.boolean().optional(),
                isLocked: z.boolean().optional(),
                createdAt: z.string().optional(),
                updatedAt: z.string().optional(),
                typeSettings: z.record(z.string(), z.unknown()).optional(),
                supportedFilterOperators: z
                  .array(
                    z.object({
                      operator: z.string(),
                      needsValue: z.boolean(),
                      isHidden: z.boolean().optional(),
                    }),
                  )
                  .optional()
                  .describe('Filter operators supported by this field'),
                settingsError: z
                  .array(
                    z.object({
                      type: z.string(),
                      message: z.string(),
                    }),
                  )
                  .optional(),
                conditionalRunFieldIds: z.array(z.string()).optional(),
                delayFieldIds: z.array(z.string()).optional(),
                groupId: z.string().nullable().optional(),
                inputFieldIds: z.array(z.string()).optional(),
                settings: z
                  .record(z.string(), z.unknown())
                  .optional()
                  .describe('Action settings (mirrors typeSettings)'),
                actionDisplayProps: z
                  .object({
                    iconUri: z.string().optional(),
                    packageIcon: z.string().optional(),
                    displayName: z.string().optional(),
                  })
                  .optional(),
              }),
            )
            .optional()
            .describe('Action fields that send data (Table nodes only)'),
          recordCount: z.number().describe('Number of records/rows'),
          action: z
            .object({
              iconUri: z.string().optional(),
              packageIcon: z.string().optional(),
              displayName: z.string().optional(),
            })
            .optional()
            .describe('Action display info (Source nodes only)'),
          isDisabled: z
            .boolean()
            .optional()
            .describe('Whether the source is disabled (Source nodes only)'),
          tableId: z
            .string()
            .optional()
            .describe('Parent table ID (Source nodes only)'),
          fieldId: z
            .string()
            .optional()
            .describe('Associated field ID (Source nodes only)'),
          sourceId: z
            .string()
            .optional()
            .describe('Source ID (Source nodes only)'),
          sourceIdentifier: z
            .object({
              actionPackageId: z.string().optional(),
              actionKey: z.string().optional(),
              sourceType: z.string().optional(),
            })
            .optional()
            .describe('Source action identifier (Source nodes only)'),
        }),
      )
      .describe('Nodes in the workbook graph (tables and sources)'),
    edges: z
      .array(
        z.object({
          sourceNodeId: z.string().describe('Source node ID'),
          targetNodeId: z.string().describe('Target node ID'),
          sourceFieldId: z
            .string()
            .optional()
            .describe('Field ID on the source side'),
          type: z
            .string()
            .optional()
            .describe('Edge type (e.g. "SourceSubscription")'),
        }),
      )
      .describe('Edges representing data flow between nodes'),
  }),
};

// ============================================================================
// Table & View Schemas (New)
// ============================================================================

export const listSubroutinesSchema = {
  name: 'listSubroutines',
  description:
    'List subroutines (reusable automated workflows) available in a workspace. Subroutines are tables with BLOCK_TYPE=SUBROUTINE that accept inputs and produce outputs. They can be referenced from other tables.',
  notes: '',
  input: z.object({
    workspaceId: WorkspaceIdParam.describe('Workspace identifier'),
  }),
  output: z.object({
    subroutines: z
      .array(
        z.object({
          sourceId: z
            .string()
            .describe('Source ID associated with the subroutine'),
          table: z.object({
            id: z.string().describe('Table ID (e.g., "t_xxx")'),
            workspaceId: z.number().describe('Workspace ID'),
            createdByUserId: z
              .string()
              .describe('ID of the user who created the subroutine'),
            name: z.string().describe('Subroutine name'),
            description: z.string().describe('Subroutine description'),
            type: z.string().describe('Table type (e.g., "spreadsheet")'),
            icon: z
              .object({
                emoji: z.string().optional(),
                url: z.string().optional(),
              })
              .nullable()
              .describe('Optional icon'),
            parentFolderId: z
              .string()
              .nullable()
              .describe('Parent folder ID if organized in a folder'),
            tableSettings: z.object({
              BLOCK_TYPE: z
                .string()
                .describe('Always "SUBROUTINE" for subroutines'),
              SUBROUTINE_INPUTS: z
                .array(
                  z.object({
                    inputName: z
                      .string()
                      .describe('Name of the input parameter'),
                    optional: z
                      .boolean()
                      .describe('Whether this input is optional'),
                    formulaReplacementTarget: z
                      .string()
                      .describe(
                        'Formula replacement target (empty string if not used)',
                      ),
                  }),
                )
                .describe('Input parameters the subroutine accepts'),
              IS_PASS_THROUGH_TABLE: z
                .boolean()
                .describe('Whether the subroutine passes through input rows'),
              PASS_THROUGH_TABLE_SUCCESS_FIELD_IDS: z
                .array(z.string())
                .describe('Field IDs used to determine pass-through success'),
            }),
            createdAt: z.string().describe('ISO 8601 creation timestamp'),
            updatedAt: z.string().describe('ISO 8601 last update timestamp'),
            deletedAt: z
              .string()
              .nullable()
              .describe('ISO 8601 deletion timestamp or null'),
            fieldGroupMap: z
              .record(z.string(), z.unknown())
              .describe('Field group configuration'),
            workbookId: z
              .string()
              .nullable()
              .describe('Workbook ID if part of a workbook'),
            defaultAccess: z
              .string()
              .describe('Default access level (e.g., "all")'),
            ownerId: z.string().describe('Owner user ID'),
            isSandbox: z
              .boolean()
              .describe('Whether this is a sandbox subroutine'),
            isHiddenFromNavigation: z
              .boolean()
              .describe('Whether hidden from workspace navigation'),
            firstViewId: z.string().describe('ID of the first/default view'),
            owner: z
              .object({
                id: z.number(),
                username: z.string(),
                email: z.string(),
                name: z.string(),
                fullName: z.string().optional(),
                profilePicture: z.string().nullable().optional(),
              })
              .nullable()
              .describe('Owner user object (may be null)'),
          }),
          cost: z.number().describe('Credit cost of running this subroutine'),
          referenceCount: z
            .number()
            .describe('Number of tables referencing this subroutine'),
        }),
      )
      .describe('List of subroutines in the workspace'),
    totalCount: z.number().describe('Total number of subroutines'),
  }),
};

export const duplicateViewSchema = {
  name: 'duplicateView',
  description:
    'Duplicate a view with all filters, sort rules, column visibility, ordering, and layout settings',
  notes:
    'The new view is created with name "Copy of {original}" then renamed to the requested name. All filters, sorts, field visibility, and layout settings are copied from the source view.',
  input: z.object({
    tableId: z.string().describe('Table identifier (t_xxx format)'),
    viewId: z
      .string()
      .describe('Source view identifier to duplicate (gv_xxx format)'),
    name: z.string().describe('Name for the duplicated view'),
  }),
  output: z.object({
    id: z.string().describe('Newly created view ID (gv_xxx format)'),
    tableId: z.string().describe('Parent table ID'),
    name: z.string().describe('Name of the duplicated view'),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('View description (copied from source if present)'),
    order: z
      .string()
      .describe('Lexicographic position key for view ordering in tab bar'),
    fields: z
      .record(
        z.string(),
        z.object({
          order: z
            .string()
            .describe('Lexicographic position key for column ordering'),
          width: z.number().describe('Column width in pixels'),
          isVisible: z.boolean().describe('Whether field is visible in view'),
        }),
      )
      .describe(
        'Per-field visibility and layout configuration, keyed by field ID (f_xxx)',
      ),
    sort: z
      .object({
        items: z.array(
          z.object({
            fieldId: z.string().describe('Field ID to sort by'),
            direction: z.enum(['ASC', 'DESC']).describe('Sort direction'),
          }),
        ),
      })
      .nullable()
      .optional()
      .describe('Sort configuration (copied from source)'),
    filter: z
      .object({
        items: z.array(
          z.union([
            z.object({
              type: z.string().describe('Filter condition type'),
              fieldId: z.string().describe('Field ID to filter on'),
              value: z.unknown().optional().describe('Filter value'),
            }),
            z.object({
              items: z
                .array(
                  z.object({
                    type: z.string().describe('Filter condition type'),
                    fieldId: z.string().describe('Field ID to filter on'),
                    value: z.unknown().optional().describe('Filter value'),
                  }),
                )
                .describe('Nested filter conditions within this group'),
              filterType: z
                .literal('Group')
                .describe('Indicates this is a filter group'),
              combinationMode: z
                .enum(['AND', 'OR'])
                .describe('How to combine conditions within this group'),
            }),
          ]),
        ),
        combinationMode: z
          .enum(['AND', 'OR'])
          .describe('How to combine top-level filter items'),
      })
      .nullable()
      .optional()
      .describe('Filter configuration (copied from source)'),
    limit: z.number().nullable().optional().describe('Row limit for the view'),
    offset: z
      .number()
      .nullable()
      .optional()
      .describe('Row offset for the view'),
    createdAt: z.string().describe('Creation timestamp (ISO 8601)'),
    updatedAt: z.string().describe('Last update timestamp (ISO 8601)'),
    deletedAt: z
      .string()
      .nullable()
      .optional()
      .describe('Deletion timestamp (null if not deleted)'),
    typeSettings: z
      .object({
        isPreconfigured: z
          .boolean()
          .optional()
          .describe('Whether this is a system preconfigured view'),
        preconfiguredType: z
          .string()
          .optional()
          .describe('Type of preconfigured view if applicable'),
      })
      .optional()
      .describe('View type configuration'),
  }),
};

// ============================================================================
// Field Schemas (New)
// ============================================================================

export const stopFieldSchema = {
  name: 'stopField',
  description:
    'Stop running enrichment on a table. Cancels all currently running enrichment fields. The fieldId parameter identifies the field being targeted but the underlying API cancels all running enrichments on the table.',
  notes:
    'Uses POST /tables/{tableId}/cancelrun. This is a table-level operation; it cancels ALL running enrichments on the table, not just the specified field. The fieldId is included in the request body but the API may cancel all running fields regardless.',
  input: z.object({
    tableId: z
      .string()
      .describe('The unique identifier of the table containing the field'),
    fieldId: z
      .string()
      .describe(
        'The unique identifier of the enrichment field to stop. Note: the API cancels all running enrichments on the table.',
      ),
  }),
  output: z
    .object({
      success: z.boolean().describe('Whether the cancel request was accepted'),
    })
    .describe('Success confirmation from the cancelrun endpoint'),
};

export const getFieldRunStatusSchema = {
  name: 'getFieldRunStatus',
  description:
    'Get per-cell execution status counts for a single enrichment/action field. Returns how many cells are in each status (SUCCESS, PENDING, RUNNING, ERROR, etc.) and how many are stale. Throws 404 if the field is not an action field.',
  notes:
    'FREE, instant check. fieldId must be an enrichment/action field (f_xxx format), not a formula/text/input field. The API requires a viewId which is auto-resolved from the table. ' +
    'Use this to poll after runEnrichmentColumn(). Enrichment is done when no cells remain in PENDING or RUNNING status. ' +
    'Status null means the cell has not been run yet.',
  input: z.object({
    tableId: z.string().describe('Table ID in t_xxx format'),
    fieldId: z
      .string()
      .describe(
        'Enrichment/action field ID in f_xxx format. Must be an action field; formula, text, and input fields will return a 404 error.',
      ),
  }),
  output: z
    .object({
      fieldId: z.string().describe('The field ID that was queried'),
      statusCounts: z
        .array(
          z.object({
            status: z
              .string()
              .nullable()
              .describe(
                'Cell execution status. Known values: SUCCESS (data found), SUCCESS_NO_DATA (provider ran but found nothing; common in waterfalls), PENDING (queued), RUNNING (in progress), ERROR_RUN_CONDITION_NOT_MET (condition formula was false), ERROR_ACTION_RUNTIME_ERROR (provider error), ERROR_BAD_REQUEST (invalid input). null means the cell has not been run.',
              ),
            count: z.number().describe('Number of cells in this status'),
            staleCount: z
              .number()
              .describe(
                'Number of cells in this status that are stale (inputs changed since last run)',
              ),
          }),
        )
        .describe('Breakdown of cell counts by execution status'),
    })
    .describe('Per-cell execution status counts for the enrichment field'),
};

export const getFieldsRunStatusSchema = {
  name: 'getFieldsRunStatus',
  description:
    'Get per-cell execution status counts for ALL enrichment/action fields in a table. Fetches the table to discover action-type fields, then queries run status for each. Non-action fields (formula, text, date, source) are excluded.',
  notes:
    'Only fields with type "action" are included. Each field returns the same statusCounts structure as getFieldRunStatus. Fields are queried in parallel for speed.',
  input: z.object({
    tableId: z.string().describe('Table ID in t_xxx format'),
  }),
  output: z
    .object({
      fields: z
        .array(
          z.object({
            fieldId: z.string().describe('The enrichment/action field ID'),
            fieldName: z.string().describe('Human-readable name of the field'),
            statusCounts: z
              .array(
                z.object({
                  status: z
                    .string()
                    .nullable()
                    .describe(
                      'Cell execution status. Known values: SUCCESS (data found), SUCCESS_NO_DATA (provider ran but found nothing; common in waterfalls), PENDING (queued), RUNNING (in progress), ERROR_RUN_CONDITION_NOT_MET (condition formula was false), ERROR_ACTION_RUNTIME_ERROR (provider error), ERROR_BAD_REQUEST (invalid input). null means the cell has not been run.',
                    ),
                  count: z.number().describe('Number of cells in this status'),
                  staleCount: z
                    .number()
                    .describe(
                      'Number of cells in this status that are stale (inputs changed since last run)',
                    ),
                }),
              )
              .describe('Breakdown of cell counts by execution status'),
          }),
        )
        .describe('Run status for each action/enrichment field in the table'),
    })
    .describe('Aggregated run status for all enrichment fields in the table'),
};

export const setFieldRunConditionSchema = {
  name: 'setFieldRunCondition',
  description:
    'Set or clear a conditional run formula on an enrichment/action field',
  notes:
    'Sets a condition that must be true for the enrichment to run on each row. ' +
    'formulaText uses Clay formula syntax with field references like {{f_xxx}}. ' +
    'Example: \'({{f_abc}}||"").toLowerCase()=="ramp"\': only run if the company field equals "ramp". ' +
    'Example: \'{{f_abc}} === "yes" || {{f_def}} === "yes"\': run if either condition is true. ' +
    'Pass formulaText: null to remove the condition and run on all rows. ' +
    'For waterfall group fields, this sets the condition on all action fields in the waterfall (all providers skip if condition is not met). Field IDs are preserved; no need to re-fetch the table. ' +
    'For standalone action fields (claygent columns, etc.), this sets the condition on that specific field. ' +
    'Use getTable() to find field IDs to reference in the formula.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    fieldId: z
      .string()
      .describe(
        'Action/enrichment field ID (f_xxx format) to set the condition on. For waterfall enrichments, use any field ID within the waterfall group.',
      ),
    formulaText: z
      .string()
      .nullable()
      .describe(
        'Clay formula expression. Uses {{f_xxx}} for field references. Pass null to remove the condition. Example: \'({{f_abc}}||"").toLowerCase()=="ramp"\'',
      ),
    formulaPrompt: z
      .string()
      .optional()
      .describe(
        'Human-readable description of the condition (e.g., "Company is equal to Ramp"). Optional; used for display in the UI.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the run condition was set successfully'),
  }),
};

export type SetFieldRunConditionInput = z.infer<
  typeof setFieldRunConditionSchema.input
>;
export type SetFieldRunConditionOutput = z.infer<
  typeof setFieldRunConditionSchema.output
>;

// ============================================================================
// Search & Source Schemas (New)
// ============================================================================

export const getSourceRunsSchema = {
  name: 'getSourceRuns',
  description:
    'Get execution runs for a source. Returns list of source run records showing when the source was executed and how many rows were added.',
  notes:
    'FREE; no credits consumed. Returns runs in reverse chronological order. Empty runs array when source has never been executed.',
  input: z.object({
    sourceId: z.string().describe('Source ID (format: s_[alphanumeric])'),
    limit: z
      .number()
      .optional()
      .describe(
        'Maximum number of run records to return (min: 1, default: 50)',
      ),
  }),
  output: z.object({
    runs: z
      .array(
        z.object({
          id: z
            .string()
            .describe('Unique run identifier (format: sr_[alphanumeric])'),
          status: z
            .string()
            .describe('Execution status: QUEUED, RUNNING, COMPLETED, FAILED'),
          createdAt: z
            .string()
            .describe('ISO timestamp when the run was created'),
          completedAt: z
            .string()
            .optional()
            .describe(
              'ISO timestamp when the run completed (absent if still running or queued)',
            ),
          statusMessage: z
            .string()
            .optional()
            .describe(
              'Status message or error details (absent when no message)',
            ),
          numberOfRowsAdded: z
            .number()
            .optional()
            .describe(
              'Number of rows added by this run (absent if not yet completed)',
            ),
        }),
      )
      .describe('List of source run records'),
  }),
};

export const triggerSourceSyncSchema = {
  name: 'triggerSourceSync',
  description:
    'Trigger a prospector source to re-import data into its table. Creates a new source run that pulls fresh people/company search results.',
  notes:
    'Only works on prospector sources created through the Clay Find People UI flow (sources with searchCriteria in typeSettings). Sources from createSalesNavSource or createSourceFromSearch use a different internal format and will return 400. Returns 409 if a run is already in progress. Poll getSourceRuns() to monitor run progress after triggering. If workspaceId is omitted, it is auto-resolved from the source.',
  input: z.object({
    sourceId: z.string().describe('Source ID (format: s_[alphanumeric])'),
    workspaceId: z
      .string()
      .optional()
      .describe(
        'Workspace ID. Optional; auto-resolved from source if omitted.',
      ),
  }),
  output: z.object({
    sourceRunId: z.string().describe('ID of the newly created source run'),
    jobId: z.string().describe('Background job ID for tracking'),
  }),
};

export const createSourceFromSearchSchema = {
  name: 'createSourceFromSearch',
  description:
    'Create a new workbook, table, and people-search source from search filters via the Clay wizard. Populates the table with search results (up to the plan limit). Returns the created resource IDs. This is the programmatic equivalent of using the "Find & Enrich People" wizard and clicking "Save and run".',
  notes:
    'FREE; no credits consumed for the search/source creation itself. Uses the wizard evaluate-step endpoint internally. The source is created with a 1000-row limit by default. The table is populated with preview results (up to 50 rows initially). Uses the same PeopleSearchFilters as searchPeople. The previewTaskId is optional; if provided from a prior searchPeople call, it allows the wizard to reuse cached preview data.',
  input: z.object({
    workspaceId: WorkspaceIdParam.describe('Workspace ID'),
    filters: PeopleSearchFiltersSchema.optional().describe(
      'People search filters. Same filters as searchPeople. If omitted, creates a table with no search criteria (broad search).',
    ),
    previewTaskId: z
      .string()
      .optional()
      .describe(
        'Task ID from a prior searchPeople call. Allows the wizard to reuse cached preview results. Optional; wizard runs its own preview if omitted.',
      ),
    parentFolderId: z
      .string()
      .optional()
      .describe(
        'Folder ID to place the created workbook in. If omitted, workbook is created at workspace root.',
      ),
    workbookId: z
      .string()
      .optional()
      .describe(
        'Existing workbook ID to create the table in (wb_xxx format). If omitted, a new workbook is created.',
      ),
    limit: z
      .number()
      .optional()
      .describe(
        'Max records to populate (default ~1000). Controls how many people the search imports.',
      ),
  }),
  output: z.object({
    workbookId: z
      .string()
      .describe('Created workbook ID (format: wb_[alphanumeric])'),
    tableId: z.string().describe('Created table ID (format: t_[alphanumeric])'),
    tableName: z.string().describe('Name of the created table'),
    viewId: z
      .string()
      .describe(
        'Default view ID for the created table (format: gv_[alphanumeric])',
      ),
    sourceId: z
      .string()
      .describe('Created source ID (format: s_[alphanumeric])'),
    sourceFieldId: z
      .string()
      .describe(
        'Field ID for the source column in the table (e.g., "f_people_search")',
      ),
    recordCount: z
      .number()
      .describe(
        'Number of records populated in the table from the search preview',
      ),
  }),
};

export const addPeopleSearchToTableSchema = {
  name: 'addPeopleSearchToTable',
  description:
    'Add people matching search filters to an existing table. Runs a people search and appends matching records to the specified table without creating a new workbook or table.',
  notes:
    'FREE; no credits consumed for the search itself. Creates a temporary table via the wizard, copies records to the target table, then cleans up automatically. Target table must have matching field names (First Name, Last Name, Full Name, Job Title, Location, Company Domain, LinkedIn Profile). Fields that exist in the target but not in search results will be empty on new records. Uses the same PeopleSearchFilters as searchPeople.',
  input: z.object({
    workspaceId: WorkspaceIdParam.describe('Workspace ID'),
    tableId: z
      .string()
      .describe(
        'Existing table ID to add records to (t_xxx format). Table must have people-type fields.',
      ),
    filters: PeopleSearchFiltersSchema.optional().describe(
      'People search filters. Same filters as searchPeople.',
    ),
    limit: z
      .number()
      .optional()
      .describe(
        'Max records to add (default 1000, max per search). The actual count depends on how many results match the filters.',
      ),
  }),
  output: z.object({
    recordsAdded: z
      .number()
      .describe('Number of records added to the target table'),
    sourceId: z
      .string()
      .describe('Source ID created during the search (for reference)'),
  }),
};

export const addCompanySearchToTableSchema = {
  name: 'addCompanySearchToTable',
  description:
    'Add companies matching search filters to an existing table. Runs a company search and appends matching records to the specified table without creating a new workbook or table.',
  notes:
    'FREE; no credits consumed for the search itself. Searches for companies and inserts them directly into the target table. Target table must have matching field names (Name, Domain, Industry, Size, Location, LinkedIn URL, Description, Revenue). Fields that exist in the target but not in search results will be empty on new records. Uses the same CompanySearchFilters as searchCompanies.',
  input: z.object({
    workspaceId: WorkspaceIdParam.describe('Workspace ID'),
    tableId: z
      .string()
      .describe(
        'Existing table ID to add records to (t_xxx format). Table must have company-type fields.',
      ),
    filters: CompanySearchFiltersSchema.optional().describe(
      'Company search filters. Same filters as searchCompanies.',
    ),
    limit: z
      .number()
      .optional()
      .describe(
        'Max records to add (default 50). The actual count depends on how many results match the filters.',
      ),
  }),
  output: z.object({
    recordsAdded: z
      .number()
      .describe('Number of records added to the target table'),
  }),
};

// ============================================================================
// Campaign Schemas (New)
// ============================================================================

export const getCampaign30dAnalyticsSchema = {
  name: 'getCampaign30dAnalytics',
  description:
    'Get 30-day campaign analytics including sent count, reply count, bounce count, click count, open count, and detailed lead status breakdown.',
  notes:
    'FREE; no credits consumed. campaignId is the smartleadCampaignId (integer), not the Clay table ID.',
  input: z.object({
    workspaceId: WorkspaceIdParam.describe('Workspace ID'),
    campaignId: z.number().describe('Smartlead campaign ID (integer)'),
  }),
  output: z.object({
    sent_count: z
      .string()
      .describe('Number of emails sent (returned as string)'),
    reply_count: z
      .string()
      .describe('Number of replies received (returned as string)'),
    bounce_count: z
      .string()
      .describe('Number of bounced emails (returned as string)'),
    unique_click_count: z
      .string()
      .describe('Number of unique link clicks (returned as string)'),
    open_count: z
      .string()
      .describe('Number of email opens (returned as string)'),
    campaign_lead_stats: z
      .object({
        total: z.number().describe('Total number of leads'),
        paused: z.number().describe('Number of paused leads'),
        blocked: z.number().describe('Number of blocked leads'),
        revenue: z.number().describe('Revenue-related leads count'),
        stopped: z.number().describe('Number of stopped leads'),
        completed: z
          .number()
          .describe('Number of leads that completed the sequence'),
        inprogress: z
          .number()
          .describe('Number of leads currently in progress'),
        interested: z.number().describe('Number of interested leads'),
        notStarted: z.number().describe('Number of leads not yet started'),
      })
      .describe('Detailed breakdown of lead statuses in the campaign'),
  }),
};

export const getSmartleadAccountSchema = {
  name: 'getSmartleadAccount',
  description:
    'Get Smartlead integration account details for a workspace. Returns the connected Smartlead app account with metadata and configuration.',
  notes: '',
  input: z.object({
    workspaceId: WorkspaceIdParam.describe('Workspace ID'),
  }),
  output: z.object({
    id: z.string().describe('App account ID (aa_xxx format)'),
    name: z.string().describe('Account name'),
    appAccountTypeId: z
      .string()
      .describe(
        'Account type ID - typically clay-sequencer-smartlead for the Smartlead integration',
      ),
    isSharedPublicKey: z.boolean(),
    userOwnerId: z
      .number()
      .nullable()
      .describe('User owner ID if user-owned, null if workspace-owned'),
    workspaceOwnerId: z.number().describe('Workspace owner ID'),
    createdAt: z.string().describe('ISO 8601 timestamp'),
    updatedAt: z.string().describe('ISO 8601 timestamp'),
    deletedAt: z.string().nullable(),
    useStaticIP: z.boolean(),
    reauthInitiatedAt: z.string().nullable(),
    reauthInitiatedByUserId: z.number().nullable(),
    obfuscatedCredentials: z.record(z.string(), z.string()).nullable(),
    abilities: z.object({
      canUpdate: z.boolean(),
      canDelete: z.boolean(),
    }),
  }),
};

// ============================================================================
// Claygent & Signal Schemas (New)
// ============================================================================

// ============================================================================
// AI Schemas (New)
// ============================================================================

// ============================================================================
// Billing Schemas (New)
// ============================================================================

// ============================================================================
// Integration Schemas (New)
// ============================================================================

export const getAppAccountTypesSchema = {
  name: 'getAppAccountTypes',
  description:
    'Get list of all available integration types/providers that can be connected to Clay',
  notes: '',
  input: z.object({}),
  output: z.object({
    types: z
      .array(
        z.object({
          id: z
            .string()
            .describe(
              'Integration type identifier (e.g., "hubspot", "salesforce", "anthropic")',
            ),
          name: z.string().describe('Display name of the integration provider'),
          category: z
            .string()
            .describe(
              'Authentication type category (e.g., "api_key", "oauth", "jwt", "custom", "username_password", "oauth1", "custom_oauth")',
            ),
        }),
      )
      .describe('List of available integration provider types'),
  }),
};

export const getAppAccountTypeSchema = {
  name: 'getAppAccountType',
  description:
    'Get metadata and authentication configuration for a specific integration type',
  notes: '',
  input: z.object({
    type: z
      .string()
      .describe(
        'Integration type identifier (e.g., "autobound", "hubspot", "salesforce", "anthropic")',
      ),
  }),
  output: z.object({
    id: z
      .string()
      .describe('Integration type identifier (matches input type parameter)'),
    authenticationType: z
      .enum([
        'api_key',
        'custom',
        'jwt',
        'username_password',
        'oauth',
        'oauth1',
        'custom_oauth',
      ])
      .describe('Authentication method required for this integration'),
    displayMetadata: z
      .object({
        icon: z
          .string()
          .url()
          .describe('URL to the integration icon (SVG or PNG)'),
        name: z.string().describe('Display name for the integration'),
        defaultName: z
          .string()
          .describe('Default account name when user creates a new connection'),
        description: z
          .string()
          .describe('Description of the authentication method'),
        providerName: z.string().describe('Provider/company name').optional(),
        providerUrl: z
          .string()
          .describe('URL to the provider website')
          .optional(),
      })
      .describe('Display information for the integration'),
    typeSpecific: z
      .object({
        inputFields: z
          .array(
            z.object({
              name: z
                .string()
                .describe(
                  'Field identifier (e.g., "username", "api_key", "client_id")',
                ),
              displayName: z
                .string()
                .describe('User-facing label for the field'),
              type: z
                .string()
                .describe('Field value type (e.g., "object")')
                .optional(),
              description: z
                .string()
                .describe('Help text describing the field')
                .optional(),
              required: z
                .boolean()
                .describe('Whether this field is required')
                .optional(),
            }),
          )
          .describe('Input fields for custom/jwt authentication types')
          .optional(),
        validateAuthActionInfo: z
          .object({
            actionKey: z.string().describe('Action identifier for validation'),
            actionPackageId: z
              .string()
              .uuid()
              .describe(
                'UUID of the action package containing validation logic',
              ),
          })
          .describe('Action configuration for validating credentials')
          .optional(),
        scopes: z
          .object({
            scopes: z
              .array(
                z.object({
                  type: z
                    .string()
                    .describe(
                      'Scope requirement level (e.g., "required", "optional_default_on", "optional_default_off")',
                    ),
                  scope: z.string().describe('OAuth scope identifier'),
                  description: z
                    .string()
                    .describe('Human-readable description of the scope'),
                }),
              )
              .describe('List of OAuth scopes for this integration'),
            delimiter: z
              .string()
              .describe('Delimiter used to join scopes in the OAuth URL'),
            skipUrlEncode: z
              .boolean()
              .describe('Whether to skip URL encoding of scopes'),
          })
          .describe('OAuth scope configuration (present for oauth types)')
          .optional(),
      })
      .describe('Type-specific configuration that varies by integration'),
    createdAt: z
      .string()
      .datetime()
      .describe('ISO 8601 timestamp when this integration type was created'),
    updatedAt: z
      .string()
      .datetime()
      .describe(
        'ISO 8601 timestamp when this integration type was last updated',
      ),
    deletedAt: z
      .string()
      .datetime()
      .nullable()
      .describe(
        'ISO 8601 timestamp of deletion (null for active integrations)',
      ),
  }),
};

export const getAppAccountsByTypeSchema = {
  name: 'getAppAccountsByType',
  description:
    'Get all app accounts of a specific integration type in a workspace',
  notes: '',
  input: z.object({
    workspaceId: WorkspaceIdParam.describe(
      'Clay workspace ID (numeric string or number)',
    ),
    type: z
      .string()
      .describe(
        'Integration type identifier (e.g., "smartlead", "google", "apollo", "hubspot")',
      ),
  }),
  output: z
    .array(
      z.object({
        id: z.string().describe('App account ID (format: aa_xxx)'),
        name: z.string().describe('User-defined name for the account'),
        appAccountTypeId: z.string().describe('Integration type identifier'),
        isSharedPublicKey: z
          .boolean()
          .describe('Whether this account uses a shared public key'),
        userOwnerId: z
          .union([z.string(), z.number()])
          .nullable()
          .describe('User ID of the account owner'),
        workspaceOwnerId: z
          .union([z.string(), z.number()])
          .nullable()
          .describe('Workspace ID that owns this account'),
        createdAt: z
          .string()
          .datetime()
          .describe('ISO 8601 timestamp of creation'),
        updatedAt: z
          .string()
          .datetime()
          .describe('ISO 8601 timestamp of last update'),
        deletedAt: z
          .string()
          .datetime()
          .nullable()
          .describe('ISO 8601 timestamp of deletion (null if not deleted)'),
        useStaticIP: z
          .boolean()
          .describe("Whether this account uses Clay's static IP"),
        reauthInitiatedAt: z
          .string()
          .datetime()
          .nullable()
          .describe('Timestamp when re-authentication was initiated'),
        reauthInitiatedByUserId: z
          .union([z.string(), z.number()])
          .nullable()
          .describe('User ID who initiated re-authentication'),
        obfuscatedCredentials: z
          .record(z.string(), z.unknown())
          .nullable()
          .describe('Masked/obfuscated credentials for display'),
        abilities: z
          .object({
            canUpdate: z
              .boolean()
              .describe('Whether current user can update this account'),
            canDelete: z
              .boolean()
              .describe('Whether current user can delete this account'),
          })
          .describe('Permissions for this integration connection'),
      }),
    )
    .describe(
      'Array of app account objects matching the specified type. Returns empty array if no accounts of this type exist.',
    ),
};

export const createAppAccountSchema = {
  name: 'createAppAccount',
  description: 'Create a new integration connection in a workspace',
  notes:
    'For API key integrations, pass credentials as {"api_key": "<key>"}. Use getAppAccountType() to discover the required credential fields for a given appAccountTypeId. Use getAppAccountTypes() to list all available type IDs.',
  input: z.object({
    workspaceId: WorkspaceIdParam.describe(
      'Clay workspace ID (numeric string or number)',
    ),
    appAccountTypeId: z
      .string()
      .describe(
        'Integration type identifier (e.g., "smartlead-ai", "salesforce", "hubspot")',
      ),
    name: z
      .string()
      .describe('Human-readable name for this connection')
      .optional(),
    credentials: z
      .record(z.string(), z.unknown())
      .describe(
        'Integration-specific credentials (API keys, tokens, etc.). Schema varies by appAccountTypeId. Sent as "auth" in the API request body. Pass {} for OAuth-type integrations that authenticate via browser redirect.',
      )
      .default({}),
    useStaticIP: z
      .boolean()
      .describe(
        "Whether to use Clay's static IP for API requests from this integration",
      )
      .default(false)
      .optional(),
    setAsDefault: z
      .boolean()
      .describe(
        'Whether to set this account as the default for its integration type in the workspace',
      )
      .optional(),
  }),
  output: z
    .object({
      id: z.string().describe('App account ID (format: aa_xxx)'),
      name: z.string().describe('User-defined name for the account'),
      appAccountTypeId: z.string().describe('Integration type identifier'),
      isSharedPublicKey: z
        .boolean()
        .describe('Whether this account uses a shared public key'),
      userOwnerId: z
        .union([z.string(), z.number()])
        .nullable()
        .describe('User ID of the account owner'),
      workspaceOwnerId: z
        .union([z.string(), z.number()])
        .nullable()
        .describe('Workspace ID that owns this account'),
      createdAt: z
        .string()
        .datetime()
        .describe('ISO 8601 timestamp of creation'),
      updatedAt: z
        .string()
        .datetime()
        .describe('ISO 8601 timestamp of last update'),
      deletedAt: z
        .string()
        .datetime()
        .nullable()
        .describe('ISO 8601 timestamp of deletion (null if not deleted)'),
      useStaticIP: z
        .boolean()
        .describe("Whether this account uses Clay's static IP"),
      reauthInitiatedAt: z
        .string()
        .datetime()
        .nullable()
        .describe('Timestamp when re-authentication was initiated'),
      reauthInitiatedByUserId: z
        .union([z.string(), z.number()])
        .nullable()
        .describe('User ID who initiated re-authentication'),
      obfuscatedCredentials: z
        .union([z.string(), z.record(z.string(), z.unknown())])
        .nullable()
        .describe(
          'Masked/obfuscated credentials for display (string for API key types, object for multi-field credential types)',
        ),
      abilities: z
        .object({
          canUpdate: z
            .boolean()
            .describe('Whether current user can update this account'),
          canDelete: z
            .boolean()
            .describe('Whether current user can delete this account'),
        })
        .describe('Permissions for this integration connection'),
    })
    .describe(
      'Newly created app account object with generated IDs and metadata',
    ),
};

export const updateAppAccountSchema = {
  name: 'updateAppAccount',
  description:
    'Update an existing integration connection. Can update name, credentials, and static IP settings. Only include fields you want to change; omitted fields are not modified.',
  notes:
    'Credentials field names are integration-specific. For api_key type integrations (e.g. smartlead-ai, anthropic), use {api_key: "value"}. For username_password types, use {username: "...", password: "..."}. Use getAppAccountType() to determine the authentication type.',
  input: z.object({
    workspaceId: WorkspaceIdParam.describe(
      'Clay workspace ID (numeric string or number)',
    ),
    accountId: z.string().describe('App account ID to update (format: aa_xxx)'),
    name: z
      .string()
      .describe('New human-readable name for this connection')
      .optional(),
    credentials: z
      .record(z.string(), z.unknown())
      .describe('Updated integration-specific credentials')
      .optional(),
    useStaticIP: z
      .boolean()
      .describe("Whether to use Clay's static IP for API requests")
      .optional(),
  }),
  output: z
    .object({
      id: z.string().describe('App account ID (format: aa_xxx)'),
      name: z.string().describe('User-defined name for the account'),
      appAccountTypeId: z.string().describe('Integration type identifier'),
      isSharedPublicKey: z
        .boolean()
        .describe('Whether this account uses a shared public key'),
      userOwnerId: z
        .union([z.string(), z.number()])
        .nullable()
        .describe('User ID of the account owner'),
      workspaceOwnerId: z
        .union([z.string(), z.number()])
        .nullable()
        .describe('Workspace ID that owns this account'),
      createdAt: z
        .string()
        .datetime()
        .describe('ISO 8601 timestamp of creation'),
      updatedAt: z
        .string()
        .datetime()
        .describe('ISO 8601 timestamp of last update'),
      deletedAt: z
        .string()
        .datetime()
        .nullable()
        .describe('ISO 8601 timestamp of deletion (null if not deleted)'),
      useStaticIP: z
        .boolean()
        .describe("Whether this account uses Clay's static IP"),
      reauthInitiatedAt: z
        .string()
        .datetime()
        .nullable()
        .describe('Timestamp when re-authentication was initiated'),
      reauthInitiatedByUserId: z
        .union([z.string(), z.number()])
        .nullable()
        .describe('User ID who initiated re-authentication'),
      obfuscatedCredentials: z
        .union([z.string(), z.record(z.string(), z.unknown())])
        .nullable()
        .describe(
          'Masked/obfuscated credentials for display (string for API key types, object for multi-field credential types)',
        ),
      abilities: z
        .object({
          canUpdate: z
            .boolean()
            .describe('Whether current user can update this account'),
          canDelete: z
            .boolean()
            .describe('Whether current user can delete this account'),
        })
        .describe('Permissions for this integration connection'),
    })
    .describe('Updated app account object'),
};

export const deleteAppAccountSchema = {
  name: 'deleteAppAccount',
  description: 'Delete/disconnect an integration connection from a workspace',
  notes: '',
  input: z.object({
    workspaceId: WorkspaceIdParam.describe(
      'Clay workspace ID (numeric string or number)',
    ),
    accountId: z.string().describe('App account ID to delete (format: aa_xxx)'),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the account was successfully deleted'),
  }),
};

// ============================================================================
// Export & Trash Schemas (New)
// ============================================================================

export const listActiveExportsSchema = {
  name: 'listActiveExports',
  description:
    'List active/recent exports for a workspace. Returns exports that are currently processing or recently completed (within 24h). Each export includes a downloadUrl (signed S3 URL) when status is FINISHED.',
  notes:
    'Response is a bare array from the API. Exports expire ~24h after creation (expiresAt field). downloadUrl is null while export is processing. The downloadUrl points to S3 and is CORS-blocked from the Clay domain; download it via a shell command (e.g. curl) instead of fetch from the browser.',
  input: z.object({
    workspaceId: WorkspaceIdParam.describe('Workspace ID'),
  }),
  output: z.object({
    exports: z.array(
      z.object({
        id: z.string().describe('Export job ID (format: ej_xxx)'),
        workspaceId: z.number().describe('Workspace ID'),
        tableId: z.string().describe('Source table ID'),
        viewId: z.string().describe('View ID (empty string if not scoped)'),
        userId: z.number().describe('User who triggered the export'),
        fileName: z.string().describe('Export file name (no extension)'),
        status: z
          .string()
          .describe('Export status: ACTIVE (processing) or FINISHED'),
        uploadedFilePath: z
          .string()
          .nullable()
          .describe('S3 path of uploaded file, null while processing'),
        expiresAt: z
          .string()
          .describe('ISO datetime when export download link expires'),
        createdAt: z.string().describe('ISO datetime when export was created'),
        updatedAt: z
          .string()
          .describe('ISO datetime when export was last updated'),
        totalRecordsInViewCount: z
          .number()
          .describe('Total records in the exported view'),
        recordsExportedCount: z
          .number()
          .describe('Number of records exported so far'),
        downloadUrl: z
          .string()
          .nullable()
          .describe(
            'Signed S3 download URL, null while processing, expires with expiresAt',
          ),
        settings: z
          .record(z.string(), z.unknown())
          .nullable()
          .describe('Export settings, typically null'),
        exportType: z.string().describe('Type of export (e.g. TABLE)'),
      }),
    ),
  }),
};

export const createExportSchema = {
  name: 'createExport',
  description:
    'Create an export job for a table or view. Returns an export job that processes asynchronously; downloadUrl is null initially and populates when status becomes FINISHED. Use listActiveExports to poll for completion.',
  notes:
    'FREE operation. Fire-and-forget: returns immediately with status ACTIVE and downloadUrl null. Tell the user the export is processing, then poll listActiveExports() every 5 seconds. Export is done when status becomes FINISHED and downloadUrl is populated. Typically takes 5-30 seconds.',
  input: z.object({
    tableId: z.string().describe('Table ID to export (t_xxx format)'),
    viewId: z
      .string()
      .optional()
      .describe(
        'View ID to export (gv_xxx format). If omitted, exports the full table.',
      ),
  }),
  output: z.object({
    id: z.string().describe('Export job ID (ej_xxx format)'),
    workspaceId: z.number().describe('Workspace ID'),
    tableId: z.string().describe('Source table ID'),
    viewId: z
      .string()
      .describe('View ID (empty string if exporting full table)'),
    userId: z.string().describe('User ID who initiated the export'),
    fileName: z.string().describe('Export file name'),
    status: z
      .string()
      .describe('Export job status: ACTIVE (processing) or FINISHED'),
    uploadedFilePath: z
      .string()
      .nullable()
      .describe('S3 path of uploaded file, null while processing'),
    createdAt: z.string().describe('ISO datetime when export was created'),
    updatedAt: z.string().describe('ISO datetime when export was last updated'),
    totalRecordsInViewCount: z
      .number()
      .describe('Total records in the exported table/view'),
    recordsExportedCount: z
      .number()
      .describe('Number of records exported so far'),
    downloadUrl: z
      .string()
      .nullable()
      .describe(
        'Signed download URL, null while processing, available when FINISHED',
      ),
    settings: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe('Export settings, typically null'),
    exportType: z.string().describe('Type of export (e.g. TABLE)'),
  }),
};

export const downloadCSVSchema = {
  name: 'downloadCSV',
  description:
    "Download a Clay table as a CSV file to the user's device. Fetches all records, builds CSV, and saves via the Northlight files API.",
  notes:
    'FREE operation. Automatically discovers the default view if viewId is not provided. Always returns CSV content in the content field. Also saves to device (filePath) when available. To attach this CSV to an email, base64-encode the content field directly; do NOT try to read from filePath in a different executor.',
  input: z.object({
    tableId: z.string().describe('Table ID to export (t_xxx format)'),
    viewId: z
      .string()
      .optional()
      .describe(
        "View ID to export (gv_xxx format). If omitted, uses the table's default view.",
      ),
  }),
  output: z.object({
    fileName: z.string().describe('Name of the CSV file'),
    recordsExportedCount: z.number().describe('Number of records exported'),
    filePath: z
      .string()
      .nullable()
      .describe(
        "Absolute path where the CSV was saved on the user's device (null if files API unavailable)",
      ),
    content: z
      .string()
      .describe(
        'CSV content as string. Always populated. Use this directly for email attachments (base64-encode it) rather than reading from filePath.',
      ),
  }),
};

export const importCSVSchema = {
  name: 'importCSV',
  description:
    "Import a CSV file from the user's device into a Clay table. Reads the file, uploads to Clay's import service, and populates the table with CSV data.",
  notes:
    'FREE; no credits consumed. Provide either filePath (reads from device via Northlight files API) or csvContent (CSV as string). The CSV must have a header row. ' +
    'When importing to an existing table, CSV column headers are auto-matched to table field names. ' +
    'When creating a new table (spreadsheet type), text fields are created for each CSV column; this is the best way to import enriched data with email/phone fields from external tools. ' +
    'Polls until import completes (up to 120 seconds). Once status is FINISHED, records are immediately readable via listRecordIds + getTableRecords.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    filePath: z
      .string()
      .optional()
      .describe(
        'Absolute path to the CSV file on the user\'s device (e.g., "/Users/name/data.csv"). Requires the Northlight files API.',
      ),
    csvContent: z
      .string()
      .optional()
      .describe(
        'CSV content as a string. Alternative to filePath; use when you already have the CSV data (e.g., from files.load()). Must include header row.',
      ),
    tableId: z
      .string()
      .optional()
      .describe(
        'Table ID to import into (t_xxx format). If omitted, creates a new table in the specified workbook.',
      ),
    workbookId: z
      .string()
      .optional()
      .describe(
        'Workbook ID to create the new table in (wb_xxx format). Required when tableId is not provided.',
      ),
    tableName: z
      .string()
      .optional()
      .describe(
        'Name for the new table. Defaults to the CSV filename without extension. Ignored when tableId is provided.',
      ),
  }),
  output: z.object({
    importId: z.string().describe('Import job ID (ij_xxx format)'),
    tableId: z.string().describe('Table ID where data was imported'),
    status: z.string().describe('Final import status (FINISHED on success)'),
    numRows: z.number().describe('Number of rows imported'),
  }),
};

export const permanentDeleteTrashItemSchema = {
  name: 'permanentDeleteTrashItem',
  description:
    'DESTRUCTIVE: Permanently delete a single item from trash. Cannot be undone. Use listTrash to get resource IDs. Accepts table (t_), workbook (wb_), or folder (f_) IDs. Returns { success: true } on success; throws on failure (never returns { success: false }). FREE operation.',
  notes: 'Cannot be undone. Get resourceId from listTrash results.',
  input: z.object({
    workspaceId: WorkspaceIdParam.describe('Workspace ID'),
    resourceId: z
      .string()
      .describe(
        'Resource ID from listTrash (e.g. t_xxx for tables, wb_xxx for workbooks, f_xxx for folders)',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Always true on success; function throws on failure'),
  }),
};

export const bulkPermanentDeleteTrashSchema = {
  name: 'bulkPermanentDeleteTrash',
  description: 'Bulk permanently delete items from trash',
  notes: 'Cannot be undone. Pass at least one resource type array.',
  input: z.object({
    workspaceId: WorkspaceIdParam.describe('Workspace ID'),
    tableIds: z.array(z.string()).optional(),
    workbookIds: z.array(z.string()).optional(),
    folderIds: z.array(z.string()).optional(),
  }),
  output: z.object({
    success: z.boolean(),
  }),
};

// ============================================================================
// AI Generation Schemas
// ============================================================================

export const searchEnrichmentsSchema = {
  name: 'searchEnrichments',
  description:
    'Search the Clay enrichment catalog by keyword. Returns matching enrichment actions, waterfalls, templates, and integrations with metadata (provider, category, quality score). Use this to discover available enrichments before adding them to a table.',
  notes:
    'FREE operation. Pass a natural-language query describing what you want to enrich (e.g., "find work email", "enrich company", "linkedin profile"). Results include entityId which can be used with addEnrichmentColumn() to add as a table column, addClaygentColumn for AI agents, or createActionSource() for data sources.\n\n' +
    'To discover available **data sources** (Apollo, HubSpot, Snowflake, GitHub, Reddit, etc.), pass `types: ["source_action"]`. ' +
    'Source entityIds can then be used with `createActionSource()` to add the source to a table.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    query: z
      .string()
      .describe(
        'Natural-language search query (e.g., "find work email", "enrich company data", "claygent", "import from apollo")',
      ),
    types: z
      .array(
        z.enum([
          'waterfall',
          'template',
          'source_template',
          'action',
          'internal_action',
          'export_action',
          'signal_action',
          'client_driven_source_action',
          'source_action',
          'webhook_subscription_source',
          'function',
          'waterfall_template',
          'parent_waterfall_template',
          'child_waterfall_template',
        ]),
      )
      .optional()
      .describe(
        'Filter results to specific enrichment types. Use ["source_action"] to find data sources (Apollo, HubSpot, Snowflake, GitHub, etc.) for createActionSource(). Omit to search all types.',
      ),
  }),
  output: z.object({
    results: z.array(
      z.object({
        entityId: z
          .string()
          .describe('Unique enrichment entity ID used for adding to tables'),
        name: z.string().describe('Display name of the enrichment'),
        type: z
          .string()
          .describe(
            'Enrichment type: action, waterfall, template, function, source_action, etc.',
          ),
        score: z.number().describe('Relevance score (higher is better)'),
        tags: z.array(z.string()).describe('Category tags for this enrichment'),
        packageName: z
          .string()
          .optional()
          .describe('Provider package name (e.g., "clay", "apollo")'),
        dataStrength: z
          .array(z.string())
          .optional()
          .describe('Data quality indicators'),
        qualityScore: z
          .number()
          .optional()
          .describe('Quality score from 0-100'),
        matchingConcept: z
          .string()
          .optional()
          .describe('Why this enrichment matched the query'),
        outputPath: z
          .string()
          .optional()
          .describe('Path in the enrichment output data'),
      }),
    ),
    searchId: z.string().describe('Search session ID'),
  }),
};

export type SearchEnrichmentsInput = z.infer<
  typeof searchEnrichmentsSchema.input
>;
export type SearchEnrichmentsOutput = z.infer<
  typeof searchEnrichmentsSchema.output
>;

export const addEnrichmentColumnSchema = {
  name: 'addEnrichmentColumn',
  description:
    'Add a specific enrichment provider as a column on a table. Use searchEnrichments() first to find the entityId for the enrichment you want. After adding, use runEnrichmentColumn() with the returned fieldId to execute it per-row.',
  notes:
    'Creating the column is FREE; only running it via runEnrichmentColumn() costs credits. ' +
    'The entityId comes from searchEnrichments() results. ' +
    'inputMappings bind enrichment input parameters to table field IDs. ' +
    'Common input patterns by enrichment type:\n' +
    '- **Email enrichments** (Findymail, Prospeo, Enrow, etc.): inputs "full_name" + "company_domain"\n' +
    '- **Person enrichment** (People Data Labs, Datagma, etc.): input "person_identifier" (LinkedIn URL)\n' +
    '- **Company enrichment** (Clay built-in, ZoomInfo, Owler): input "domain" or "company_domain"\n' +
    '- **Tech stack** (BuiltWith, BuyerCaddy): input "domain"\n' +
    '- **Phone number** (Prospeo, FullEnrich): inputs "full_name" + "company_domain" or "linkedin_url"\n' +
    'If unsure about input names, create the column with empty inputMappings; the returned settingsErrors will indicate what is missing. ' +
    'Some enrichments require a connected app account (authAccountId from listAppAccounts). If missing, settingsErrors will include MISSING_AUTH.',
  input: z.object({
    tableId: z
      .string()
      .describe('Table ID (t_xxx format) to add the column to'),
    entityId: z
      .string()
      .describe(
        'Enrichment entity ID from searchEnrichments() results (format: "{actionPackageId}/{actionKey}")',
      ),
    inputMappings: z
      .array(
        z.object({
          inputName: z
            .string()
            .describe(
              'Enrichment input parameter name (e.g., "full_name", "company_domain", "person_identifier", "domain")',
            ),
          fieldId: z
            .string()
            .describe(
              'Table field ID (f_xxx format) to bind to this input parameter',
            ),
        }),
      )
      .optional()
      .describe(
        'Maps enrichment input parameters to table field IDs. Get field IDs from getTable().fields. If omitted, the column is created with no input bindings (useful for discovering required inputs from settingsErrors).',
      ),
    columnName: z
      .string()
      .optional()
      .describe(
        'Display name for the enrichment column. Defaults to the enrichment name from the catalog.',
      ),
    authAccountId: z
      .string()
      .optional()
      .describe(
        'Connected app account ID (aa_xxx format) from listAppAccounts(). Required for enrichments that need third-party auth (e.g., Findymail, Prospeo). If omitted and required, settingsErrors will include MISSING_AUTH.',
      ),
  }),
  output: z.object({
    fieldId: z
      .string()
      .describe(
        'Created field ID (f_xxx format): use this with runEnrichmentColumn() to execute the enrichment per-row',
      ),
    fieldName: z.string().describe('Display name of the created field'),
    settingsErrors: z
      .array(
        z.object({
          type: z
            .string()
            .describe('Error type (e.g., "MISSING_AUTH", "MISSING_INPUT")'),
          message: z.string().describe('Human-readable error description'),
        }),
      )
      .describe(
        'Configuration errors on the field. Empty array means fully configured. MISSING_AUTH means an authAccountId is needed. Check this before running the enrichment.',
      ),
  }),
};

export type AddEnrichmentColumnInput = z.infer<
  typeof addEnrichmentColumnSchema.input
>;
export type AddEnrichmentColumnOutput = z.infer<
  typeof addEnrichmentColumnSchema.output
>;

// ============================================================================
// Sequencer Export Schemas
// ============================================================================

export const listSequencerIntegrationsSchema = {
  name: 'listSequencerIntegrations',
  description:
    'List available sequencer/campaign integrations for exporting leads. Returns connected integrations with their action details and app accounts.',
  notes:
    'FREE operation. Shows all 20 supported sequencer/campaign integrations (Apollo, HubSpot, Smartlead, Instantly, Outreach, Salesloft, EmailBison, Lemlist, etc.) that the workspace has connected. Workflow: (1) listSequencerIntegrations → pick integration, (2) getActionInputs with the entityId → discover required input parameters, (3) getSequencerDynamicFields → fetch available sequences/campaigns for select fields, (4) addExportToSequencer → create the export column on a table.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
  }),
  output: z.object({
    integrations: z.array(
      z.object({
        name: z.string().describe('Integration display name'),
        entityId: z
          .string()
          .describe(
            'Entity ID in actionPackageId/actionKey format for addEnrichmentColumn()',
          ),
        actionPackageId: z.string(),
        actionKey: z.string(),
        appAccounts: z.array(
          z.object({
            id: z.string().describe('App account ID (aa_xxx format)'),
            name: z.string().describe('Account display name'),
            type: z.string().describe('Account type identifier'),
          }),
        ),
      }),
    ),
  }),
};

export type ListSequencerIntegrationsInput = z.infer<
  typeof listSequencerIntegrationsSchema.input
>;
export type ListSequencerIntegrationsOutput = z.infer<
  typeof listSequencerIntegrationsSchema.output
>;

export const getSequencerDynamicFieldsSchema = {
  name: 'getSequencerDynamicFields',
  description:
    'Get dynamic field options (sequences, email accounts, users) for a sequencer integration. Returns available values for select fields.',
  notes:
    'FREE operation. Call getActionInputs() first with the entityId to discover input parameter names and types. Then call this with parameter names that have type "dynamic-options-select" to fetch their available values. Common parameter names: "sequence_id", "campaign_id", "send_email_from_email_account_id", "user_id".',
  input: z.object({
    actionPackageId: z
      .string()
      .describe('Action package ID from listSequencerIntegrations()'),
    actionKey: z
      .string()
      .describe('Action key from listSequencerIntegrations()'),
    authAccountId: z
      .string()
      .describe(
        'App account ID (aa_xxx) from listSequencerIntegrations().appAccounts',
      ),
    tableId: z.string().describe('Table ID to query dynamic fields for'),
    parameterPaths: z
      .array(z.string())
      .describe(
        'Parameter names to fetch options for (e.g., ["sequence_id", "send_email_from_email_account_id"])',
      ),
  }),
  output: z.object({
    fields: z.array(
      z.object({
        parameterPath: z.string().describe('Parameter name'),
        options: z.array(
          z.object({
            label: z.string().describe('Display name'),
            value: z.string().describe('Value to use in configuration'),
          }),
        ),
      }),
    ),
  }),
};

export type GetSequencerDynamicFieldsInput = z.infer<
  typeof getSequencerDynamicFieldsSchema.input
>;
export type GetSequencerDynamicFieldsOutput = z.infer<
  typeof getSequencerDynamicFieldsSchema.output
>;

export const addExportToSequencerSchema = {
  name: 'addExportToSequencer',
  description:
    'Add a sequencer export column to a table. Maps table fields to integration inputs (email, sequence ID, etc.) and creates an action column that sends records to the external sequencer when run.',
  notes:
    'FREE to create the column; running it costs credits. After adding, use runEnrichmentColumn() with the returned fieldId to execute the export per-row. Use getSequencerDynamicFields() first to discover available sequences and email accounts.',
  input: z.object({
    tableId: z.string().describe('Table ID (t_xxx format)'),
    actionPackageId: z.string().describe('From listSequencerIntegrations()'),
    actionKey: z.string().describe('From listSequencerIntegrations()'),
    authAccountId: z
      .string()
      .describe('App account ID (aa_xxx) from listSequencerIntegrations()'),
    inputMappings: z.array(
      z.object({
        inputName: z
          .string()
          .describe(
            'Integration input parameter name (e.g., "sequence_id", "email_address", "contact_id")',
          ),
        value: z
          .string()
          .describe(
            'Either a static value (for select fields like sequence_id) or a field ID reference (f_xxx for table column mapping)',
          ),
        isFieldReference: z
          .boolean()
          .optional()
          .describe(
            'If true, value is a table field ID wrapped in {{fieldId}}. If false/omitted, value is used as a static literal.',
          ),
      }),
    ),
    columnName: z
      .string()
      .optional()
      .describe('Display name for the export column'),
  }),
  output: z.object({
    fieldId: z
      .string()
      .describe(
        'Created field ID (f_xxx): use with runEnrichmentColumn() to execute',
      ),
    fieldName: z.string(),
    settingsErrors: z.array(
      z.object({
        type: z.string(),
        message: z.string(),
      }),
    ),
  }),
};

export type AddExportToSequencerInput = z.infer<
  typeof addExportToSequencerSchema.input
>;
export type AddExportToSequencerOutput = z.infer<
  typeof addExportToSequencerSchema.output
>;

export const generateClaygentPromptSchema = {
  name: 'generateClaygentPrompt',
  description:
    'Generate a refined claygent prompt from a natural-language task description. Expands a short user task into a full structured prompt with context, objectives, instructions, and output format. Also suggests the best model and use case.',
  notes:
    "FREE operation. Uses Clay's metaprompter AI (SSE streaming collected as full response). " +
    'Pass columnNamesToIds to let the AI reference table columns in the prompt via {{fieldId}} syntax. ' +
    'The returned prompt is ready to use with createClaygent or updateClaygent.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    taskDescription: z
      .string()
      .describe(
        'Natural-language description of what the claygent should do (e.g., "Look at their pricing page and tell me if they have an API available at enterprise tiers")',
      ),
    columnNamesToIds: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Map of column display name to field ID (e.g., {"URL": "f_abc123", "Company": "f_def456"}). Allows the AI to reference table columns in the generated prompt.',
      ),
    model: z
      .string()
      .optional()
      .describe(
        'AI model hint. Defaults to clay-argon. Common values: clay-argon, clay-neon, clay-helium',
      ),
  }),
  output: z.object({
    prompt: z
      .string()
      .describe(
        'The full generated claygent prompt with #CONTEXT#, #OBJECTIVE#, #INSTRUCTIONS#, and #OUTPUT FORMAT# sections',
      ),
    suggestedUseCase: z
      .string()
      .describe('Suggested use case (typically "claygent")'),
    suggestedUseCaseReasoning: z
      .string()
      .describe('Explanation of why this use case was chosen'),
    suggestedModel: z
      .string()
      .describe(
        'Suggested Clay model (clay-argon for research, clay-neon for extraction, clay-helium for simple tasks)',
      ),
    suggestedModelReasoning: z
      .string()
      .describe('Explanation of why this model was chosen'),
  }),
};

export type GenerateClaygentPromptInput = z.infer<
  typeof generateClaygentPromptSchema.input
>;
export type GenerateClaygentPromptOutput = z.infer<
  typeof generateClaygentPromptSchema.output
>;

export const generateOutputSchemaSchema = {
  name: 'generateOutputSchema',
  description:
    'Generate a JSON schema for structured claygent output from a prompt. Takes the claygent prompt text and produces a JSON schema describing expected output fields, types, and descriptions.',
  notes:
    'FREE operation. The returned jsonSchema is a JSON string that can be parsed. ' +
    'Use this after generateClaygentPrompt to define structured output fields. ' +
    'The schema is used with createClaygent outputFormat to define structured output.',
  input: z.object({
    workspaceId: WorkspaceIdParam,
    prompt: z
      .string()
      .describe('The full claygent prompt text to generate output schema for'),
    model: z.string().optional().describe('Model to use for schema generation'),
  }),
  output: z.object({
    jsonSchema: z
      .string()
      .describe(
        'JSON schema as a string. Parse with JSON.parse() to get the schema object with type, properties, required fields, etc.',
      ),
  }),
};

export type GenerateOutputSchemaInput = z.infer<
  typeof generateOutputSchemaSchema.input
>;
export type GenerateOutputSchemaOutput = z.infer<
  typeof generateOutputSchemaSchema.output
>;

export const generateFormulaSchema = {
  name: 'generateFormula',
  description:
    'Generate a conditional run formula from a natural-language description. Used to create run conditions for enrichment columns (e.g., "only run if Company Size > 100"). Returns a JavaScript expression using Clay field references.',
  notes:
    'FREE operation. The userId comes from getContext() user.id field. ' +
    'columnNamesToIds maps display names to field IDs. The AI uses these to generate {{fieldId}} references in the formula. ' +
    'rawExampleTableData is optional but improves accuracy by showing the AI actual data values. ' +
    'The returned formula is a JS expression like: ({{f_xxx}}?.toString()?.toLowerCase()==="yes")',
  input: z.object({
    userId: z.number().describe('User ID from getContext() user.id field'),
    workspaceId: WorkspaceIdParam,
    userPromptInput: z
      .string()
      .describe(
        'Natural-language description of the condition (e.g., "only run if API Available is yes or Company Size > 100")',
      ),
    columnNamesToIds: z
      .record(z.string(), z.string())
      .describe(
        'Map of column display name to field ID. The AI uses these to create {{fieldId}} references.',
      ),
    mode: z
      .enum(['conditional', 'basic', 'array'])
      .optional()
      .describe(
        '"conditional" (default) for boolean run conditions, "basic" for transforms, "array" for array operations',
      ),
    rawExampleTableData: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe(
        'Sample rows from the table (field ID keys, actual values). Improves formula accuracy.',
      ),
    userProvidedCorrectedExamples: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe(
        'Corrected formula examples from the user for iterative refinement.',
      ),
  }),
  output: z.object({
    formula: z
      .string()
      .describe(
        'Generated JavaScript formula expression using {{fieldId}} references',
      ),
    dataType: z
      .string()
      .describe(
        'Data type of the formula result (typically "boolean" for conditional mode)',
      ),
  }),
};

export type GenerateFormulaInput = z.infer<typeof generateFormulaSchema.input>;
export type GenerateFormulaOutput = z.infer<
  typeof generateFormulaSchema.output
>;

// ============================================================================
// Filter Options: extract valid filter values from Clay's UI
// ============================================================================

export const getIndustriesSchema = {
  name: 'getIndustries',
  description:
    'Get the complete list of valid industry values for searchPeople and searchCompanies filters. Returns all 457 Clay-recognized industries.',
  notes:
    'Must be on the Find & Enrich People page (/w/find-and-enrich-people). Extracts from page state; no API call.',
  input: z.object({}),
  output: z.object({
    industries: z
      .array(z.string())
      .describe(
        'Valid industry names for company_industries_include/exclude filters',
      ),
    count: z.number().describe('Total number of industries'),
  }),
};
export type GetIndustriesInput = z.infer<typeof getIndustriesSchema.input>;
export type GetIndustriesOutput = z.infer<typeof getIndustriesSchema.output>;

export const getCountriesSchema = {
  name: 'getCountries',
  description:
    'Get the complete list of valid country values for searchPeople location filters. Returns all 247 Clay-recognized countries.',
  notes:
    'Must be on the Find & Enrich People page (/w/find-and-enrich-people). Extracts from page state; no API call.',
  input: z.object({}),
  output: z.object({
    countries: z
      .array(z.string())
      .describe(
        'Valid country names for location_countries_include/exclude filters',
      ),
    count: z.number().describe('Total number of countries'),
  }),
};
export type GetCountriesInput = z.infer<typeof getCountriesSchema.input>;
export type GetCountriesOutput = z.infer<typeof getCountriesSchema.output>;

export const getCitiesSchema = {
  name: 'getCities',
  description:
    'Get the list of pre-populated city values for searchPeople location filters. Returns ~424 cities with popularity ranking.',
  notes:
    'Must be on the Find & Enrich People page (/w/find-and-enrich-people). Extracts from page state; no API call. Cities with isPopular=true are major metro areas.',
  input: z.object({}),
  output: z.object({
    cities: z
      .array(
        z.object({
          name: z.string().describe('City name'),
          isPopular: z.boolean().describe('Whether this is a major metro area'),
        }),
      )
      .describe(
        'Available city options for location_cities_include/exclude filters',
      ),
    count: z.number().describe('Total number of cities'),
  }),
};
export type GetCitiesInput = z.infer<typeof getCitiesSchema.input>;
export type GetCitiesOutput = z.infer<typeof getCitiesSchema.output>;

export const getStatesSchema = {
  name: 'getStates',
  description:
    'Get the list of valid state/province/municipality values for searchPeople location filters. Returns ~261 options including US states and international regions.',
  notes:
    'Must be on the Find & Enrich People page (/w/find-and-enrich-people). Extracts from page state; no API call. States with isPopular=true are US states.',
  input: z.object({}),
  output: z.object({
    states: z
      .array(
        z.object({
          name: z.string().describe('State/province/municipality name'),
          isPopular: z
            .boolean()
            .describe('Whether this is a US state (popular) or international'),
        }),
      )
      .describe(
        'Available state/province options for location_states_include/exclude filters',
      ),
    count: z.number().describe('Total number of states'),
  }),
};
export type GetStatesInput = z.infer<typeof getStatesSchema.input>;
export type GetStatesOutput = z.infer<typeof getStatesSchema.output>;

export const getFilterOptionsSchema = {
  name: 'getFilterOptions',
  description:
    'Get ALL valid filter option values for people/company search in one call. Returns industries (457), countries (247), cities (424), states (261), company sizes (9), seniority levels (13), and regions (4).',
  notes:
    'Must be on the Find & Enrich People page (/w/find-and-enrich-people). Extracts from page state; no API call. Use these values to construct valid searchPeople/searchCompanies filter arguments. This is the most efficient way to discover all valid filter values at once.',
  input: z.object({}),
  output: z.object({
    industries: z.array(z.string()).describe('Valid industry names (457)'),
    countries: z.array(z.string()).describe('Valid country names (247)'),
    cities: z.array(z.string()).describe('Valid city names (424)'),
    states: z.array(z.string()).describe('Valid state/province names (261)'),
    companySizes: z.array(z.string()).describe('Valid company size labels (9)'),
    seniority: z.array(z.string()).describe('Valid seniority levels (13)'),
    regions: z
      .array(z.string())
      .describe('Valid region codes (4): NAM, LATAM, EMEA, APAC'),
  }),
};
export type GetFilterOptionsInput = z.infer<
  typeof getFilterOptionsSchema.input
>;
export type GetFilterOptionsOutput = z.infer<
  typeof getFilterOptionsSchema.output
>;

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  getContextSchema,
  getWorkspacesSchema,
  getWorkspaceDetailsSchema,
  getSubscriptionSchema,
  searchPeopleSchema,
  searchCompaniesSchema,
  getRelatedKeywordsSchema,
  getSavedSearchesSchema,
  getPeopleSearchLimitSchema,
  listWorkbooksSchema,
  listWorkbookTablesSchema,
  listWorkspaceTablesSchema,
  listClaygentDocumentsSchema,
  listTablesSchema,
  getTableSchema,
  listViewsSchema,
  createFieldSchema,
  updateFieldSchema,
  deleteFieldSchema,
  createViewSchema,
  updateViewSchema,
  setViewFilterSchema,
  setViewSortSchema,
  deleteViewSchema,
  duplicateTableSchema,
  exportTableSchema,
  listSignalsSchema,
  getSignalSchema,
  updateSignalSchema,
  deleteSignalSchema,
  createSignalSchema,
  listClaygentsSchema,
  getClaygentSchema,
  createClaygentSchema,
  updateClaygentSchema,
  deleteClaygentSchema,
  runClaygentSchema,
  getClaygentRunSchema,
  listAppAccountsSchema,
  listCampaignsSchema,
  listWorkspaceMembersSchema,
  getTableRecordsSchema,
  listRecordIdsSchema,
  getTableRowCountSchema,
  createTableSchema,
  createWorkbookSchema,
  createSavedSearchSchema,
  updateSavedSearchSchema,
  deleteSavedSearchSchema,
  createRecordsSchema,
  createFolderSchema,
  deleteTableSchema,
  deleteWorkbookSchema,
  deleteRecordsSchema,
  deleteAllRecordsSchema,
  deleteFolderSchema,
  deleteSourceSchema,
  runEnrichmentColumnSchema,
  createWaterfallEnrichmentSchema,
  createPeopleTableSchema,
  createCompanyTableSchema,
  sendToTableSchema,
  renameTableSchema,
  renameWorkbookSchema,
  renameFolderSchema,
  moveToFolderSchema,
  searchResourcesSchema,
  listSourcesSchema,
  listFoldersSchema,
  updateRecordsSchema,
  createCampaignSchema,
  deleteCampaignSchema,
  getCampaignSettingsSchema,
  updateCampaignSettingsSchema,
  updateCampaignStatusSchema,
  listSequencerEmailAccountsSchema,
  listGlobalBlocklistSchema,
  addToGlobalBlocklistSchema,
  batchAddToGlobalBlocklistSchema,
  removeFromGlobalBlocklistSchema,
  getEmailAccountConnectUrlSchema,
  addCampaignEmailAccountsSchema,
  removeCampaignEmailAccountsSchema,
  listCampaignWebhooksSchema,
  createCampaignWebhookSchema,
  getCampaignAnalyticsSchema,
  getDayWiseAnalyticsSchema,
  listInboxRepliesSchema,
  sendInboxReplySchema,
  listCampaignEmailAccountsSchema,
  setCampaignSequenceSchema,
  getCampaignSequenceSchema,
  setCampaignScheduleSchema,
  getCampaignScheduleSchema,
  sendTestEmailSchema,
  addLeadsToCampaignSchema,
  setCampaignLeadEmailSchema,
  getCreditReportSchema,
  getGlobalCampaignStatsSchema,
  inviteWorkspaceMemberSchema,
  removeWorkspaceMemberSchema,
  updateWorkspaceMemberRoleSchema,
  createWebhookSourceSchema,
  createGoogleSheetsSourceSchema,
  createCrmImportSourceSchema,
  createActionSourceSchema,
  getActionInputsSchema,
  getDynamicFieldOptionsSchema,
  createSalesNavSourceSchema,
  deleteCampaignWebhookSchema,
  setLeadCategorySchema,
  setLeadReadStatusSchema,
  getMessageHistorySchema,
  listTrashSchema,
  restoreResourceSchema,
  setDefaultAppAccountSchema,
  updateWorkspaceSchema,
  getResourceSchema,
  logResourceActivitySchema,
  removeWorkspaceUserSchema,
  getKnockTokenSchema,
  getCreditAccrualSchema,
  getWorkbookSchema,
  getWorkbookOverviewSchema,
  listSubroutinesSchema,
  duplicateViewSchema,
  stopFieldSchema,
  getFieldRunStatusSchema,
  getFieldsRunStatusSchema,
  setFieldRunConditionSchema,
  getSourceRunsSchema,
  triggerSourceSyncSchema,
  createSourceFromSearchSchema,
  addPeopleSearchToTableSchema,
  addCompanySearchToTableSchema,
  getCampaign30dAnalyticsSchema,
  getSmartleadAccountSchema,
  getAppAccountTypesSchema,
  getAppAccountTypeSchema,
  getAppAccountsByTypeSchema,
  createAppAccountSchema,
  updateAppAccountSchema,
  deleteAppAccountSchema,
  listActiveExportsSchema,
  createExportSchema,
  downloadCSVSchema,
  importCSVSchema,
  permanentDeleteTrashItemSchema,
  bulkPermanentDeleteTrashSchema,
  listCustomSignalSourceTypesSchema,
  createCustomSignalSchema,
  addClaygentColumnSchema,
  createClaygentDocumentSchema,
  deleteClaygentDocumentSchema,
  searchEnrichmentsSchema,
  addEnrichmentColumnSchema,
  listSequencerIntegrationsSchema,
  getSequencerDynamicFieldsSchema,
  addExportToSequencerSchema,
  generateClaygentPromptSchema,
  generateOutputSchemaSchema,
  generateFormulaSchema,
  getIndustriesSchema,
  getCountriesSchema,
  getCitiesSchema,
  getStatesSchema,
  getFilterOptionsSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

export type ClayUser = z.infer<typeof ClayUserSchema>;
export type ClayWorkspace = z.infer<typeof ClayWorkspaceSchema>;
export type CreditBalances = z.infer<typeof CreditBalancesSchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type Company = z.infer<typeof CompanySchema>;
export type PeopleSearchFilters = z.infer<typeof PeopleSearchFiltersSchema>;
export type CompanySearchFilters = z.infer<typeof CompanySearchFiltersSchema>;
export type SavedSearch = z.infer<typeof SavedSearchSchema>;
export type ClayWorkbook = z.infer<typeof ClayWorkbookSchema>;
export type ClayField = z.infer<typeof ClayFieldSchema>;
export type ClayView = z.infer<typeof ClayViewSchema>;
export type ClayTableSummary = z.infer<typeof ClayTableSummarySchema>;
export type ClayTable = z.infer<typeof ClayTableSchema>;
export type ClayCell = z.infer<typeof ClayCellSchema>;
export type ClayRecord = z.infer<typeof ClayRecordSchema>;

export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type GetWorkspacesInput = z.infer<typeof getWorkspacesSchema.input>;
export type GetWorkspacesOutput = z.infer<typeof getWorkspacesSchema.output>;
export type GetSubscriptionInput = z.infer<typeof getSubscriptionSchema.input>;
export type GetSubscriptionOutput = z.infer<
  typeof getSubscriptionSchema.output
>;
export type SearchPeopleInput = z.infer<typeof searchPeopleSchema.input>;
export type SearchPeopleOutput = z.infer<typeof searchPeopleSchema.output>;
export type SearchCompaniesInput = z.infer<typeof searchCompaniesSchema.input>;
export type SearchCompaniesOutput = z.infer<
  typeof searchCompaniesSchema.output
>;
export type GetRelatedKeywordsInput = z.infer<
  typeof getRelatedKeywordsSchema.input
>;
export type GetRelatedKeywordsOutput = z.infer<
  typeof getRelatedKeywordsSchema.output
>;
export type GetSavedSearchesInput = z.infer<
  typeof getSavedSearchesSchema.input
>;
export type GetSavedSearchesOutput = z.infer<
  typeof getSavedSearchesSchema.output
>;
export type GetPeopleSearchLimitInput = z.infer<
  typeof getPeopleSearchLimitSchema.input
>;
export type GetPeopleSearchLimitOutput = z.infer<
  typeof getPeopleSearchLimitSchema.output
>;
export type ListWorkbooksInput = z.infer<typeof listWorkbooksSchema.input>;
export type ListWorkbooksOutput = z.infer<typeof listWorkbooksSchema.output>;
export type ListTablesInput = z.infer<typeof listTablesSchema.input>;
export type ListTablesOutput = z.infer<typeof listTablesSchema.output>;
export type GetTableInput = z.infer<typeof getTableSchema.input>;
export type GetTableOutput = z.infer<typeof getTableSchema.output>;
export type GetTableRecordsInput = z.infer<typeof getTableRecordsSchema.input>;
export type GetTableRecordsOutput = z.infer<
  typeof getTableRecordsSchema.output
>;
export type CreateTableInput = z.infer<typeof createTableSchema.input>;
export type CreateTableOutput = z.infer<typeof createTableSchema.output>;
export type CreateWorkbookInput = z.infer<typeof createWorkbookSchema.input>;
export type CreateWorkbookOutput = z.infer<typeof createWorkbookSchema.output>;
export type CreateSavedSearchInput = z.infer<
  typeof createSavedSearchSchema.input
>;
export type CreateSavedSearchOutput = z.infer<
  typeof createSavedSearchSchema.output
>;
export type UpdateSavedSearchInput = z.infer<
  typeof updateSavedSearchSchema.input
>;
export type UpdateSavedSearchOutput = z.infer<
  typeof updateSavedSearchSchema.output
>;
export type DeleteSavedSearchInput = z.infer<
  typeof deleteSavedSearchSchema.input
>;
export type DeleteSavedSearchOutput = z.infer<
  typeof deleteSavedSearchSchema.output
>;
export type CreateRecordsInput = z.infer<typeof createRecordsSchema.input>;
export type CreateRecordsOutput = z.infer<typeof createRecordsSchema.output>;
export type DeleteTableInput = z.infer<typeof deleteTableSchema.input>;
export type DeleteTableOutput = z.infer<typeof deleteTableSchema.output>;
export type DeleteWorkbookInput = z.infer<typeof deleteWorkbookSchema.input>;
export type DeleteWorkbookOutput = z.infer<typeof deleteWorkbookSchema.output>;
export type DeleteRecordsInput = z.infer<typeof deleteRecordsSchema.input>;
export type DeleteRecordsOutput = z.infer<typeof deleteRecordsSchema.output>;
export type ListRecordIdsInput = z.infer<typeof listRecordIdsSchema.input>;
export type ListRecordIdsOutput = z.infer<typeof listRecordIdsSchema.output>;
export type GetTableRowCountInput = z.infer<
  typeof getTableRowCountSchema.input
>;
export type GetTableRowCountOutput = z.infer<
  typeof getTableRowCountSchema.output
>;
export type DeleteAllRecordsInput = z.infer<
  typeof deleteAllRecordsSchema.input
>;
export type DeleteAllRecordsOutput = z.infer<
  typeof deleteAllRecordsSchema.output
>;
export type RunEnrichmentColumnInput = z.infer<
  typeof runEnrichmentColumnSchema.input
>;
export type RunEnrichmentColumnOutput = z.infer<
  typeof runEnrichmentColumnSchema.output
>;
export type CreateWaterfallEnrichmentInput = z.infer<
  typeof createWaterfallEnrichmentSchema.input
>;
export type CreateWaterfallEnrichmentOutput = z.infer<
  typeof createWaterfallEnrichmentSchema.output
>;
export type CreatePeopleTableInput = z.infer<
  typeof createPeopleTableSchema.input
>;
export type CreatePeopleTableOutput = z.infer<
  typeof createPeopleTableSchema.output
>;
export type CreateCompanyTableInput = z.infer<
  typeof createCompanyTableSchema.input
>;
export type CreateCompanyTableOutput = z.infer<
  typeof createCompanyTableSchema.output
>;
export type ClayFolder = z.infer<typeof ClayFolderSchema>;
export type CreateFolderInput = z.infer<typeof createFolderSchema.input>;
export type CreateFolderOutput = z.infer<typeof createFolderSchema.output>;
export type DeleteFolderInput = z.infer<typeof deleteFolderSchema.input>;
export type DeleteFolderOutput = z.infer<typeof deleteFolderSchema.output>;
export type ClayResource = z.infer<typeof ClayResourceSchema>;
export type SearchResourcesInput = z.infer<typeof searchResourcesSchema.input>;
export type SearchResourcesOutput = z.infer<
  typeof searchResourcesSchema.output
>;
export type ClaySource = z.infer<typeof ClaySourceSchema>;
export type ListSourcesInput = z.infer<typeof listSourcesSchema.input>;
export type ListSourcesOutput = z.infer<typeof listSourcesSchema.output>;
export type DeleteSourceInput = z.infer<typeof deleteSourceSchema.input>;
export type DeleteSourceOutput = z.infer<typeof deleteSourceSchema.output>;
export type RenameTableInput = z.infer<typeof renameTableSchema.input>;
export type RenameTableOutput = z.infer<typeof renameTableSchema.output>;
export type RenameWorkbookInput = z.infer<typeof renameWorkbookSchema.input>;
export type RenameWorkbookOutput = z.infer<typeof renameWorkbookSchema.output>;
export type MoveToFolderInput = z.infer<typeof moveToFolderSchema.input>;
export type MoveToFolderOutput = z.infer<typeof moveToFolderSchema.output>;
export type ListFoldersInput = z.infer<typeof listFoldersSchema.input>;
export type ListFoldersOutput = z.infer<typeof listFoldersSchema.output>;
export type RenameFolderInput = z.infer<typeof renameFolderSchema.input>;
export type RenameFolderOutput = z.infer<typeof renameFolderSchema.output>;
export type UpdateRecordsInput = z.infer<typeof updateRecordsSchema.input>;
export type UpdateRecordsOutput = z.infer<typeof updateRecordsSchema.output>;
export type ListViewsInput = z.infer<typeof listViewsSchema.input>;
export type ListViewsOutput = z.infer<typeof listViewsSchema.output>;
export type CreateFieldInput = z.infer<typeof createFieldSchema.input>;
export type CreateFieldOutput = z.infer<typeof createFieldSchema.output>;
export type UpdateFieldInput = z.infer<typeof updateFieldSchema.input>;
export type UpdateFieldOutput = z.infer<typeof updateFieldSchema.output>;
export type DeleteFieldInput = z.infer<typeof deleteFieldSchema.input>;
export type DeleteFieldOutput = z.infer<typeof deleteFieldSchema.output>;
export type CreateViewInput = z.infer<typeof createViewSchema.input>;
export type CreateViewOutput = z.infer<typeof createViewSchema.output>;
export type UpdateViewInput = z.infer<typeof updateViewSchema.input>;
export type UpdateViewOutput = z.infer<typeof updateViewSchema.output>;
export type SetViewFilterInput = z.infer<typeof setViewFilterSchema.input>;
export type SetViewFilterOutput = z.infer<typeof setViewFilterSchema.output>;
export type SetViewSortInput = z.infer<typeof setViewSortSchema.input>;
export type SetViewSortOutput = z.infer<typeof setViewSortSchema.output>;
export type DeleteViewInput = z.infer<typeof deleteViewSchema.input>;
export type DeleteViewOutput = z.infer<typeof deleteViewSchema.output>;
export type DuplicateTableInput = z.infer<typeof duplicateTableSchema.input>;
export type DuplicateTableOutput = z.infer<typeof duplicateTableSchema.output>;
export type ExportTableInput = z.infer<typeof exportTableSchema.input>;
export type ExportTableOutput = z.infer<typeof exportTableSchema.output>;
export type ListCampaignsInput = z.infer<typeof listCampaignsSchema.input>;
export type ListCampaignsOutput = z.infer<typeof listCampaignsSchema.output>;
export type ListWorkspaceMembersInput = z.infer<
  typeof listWorkspaceMembersSchema.input
>;
export type ListWorkspaceMembersOutput = z.infer<
  typeof listWorkspaceMembersSchema.output
>;
export type ClaySignal = z.infer<typeof ClaySignalSchema>;
export type ListSignalsInput = z.infer<typeof listSignalsSchema.input>;
export type ListSignalsOutput = z.infer<typeof listSignalsSchema.output>;
export type GetSignalInput = z.infer<typeof getSignalSchema.input>;
export type GetSignalOutput = z.infer<typeof getSignalSchema.output>;
export type UpdateSignalInput = z.infer<typeof updateSignalSchema.input>;
export type UpdateSignalOutput = z.infer<typeof updateSignalSchema.output>;
export type DeleteSignalInput = z.infer<typeof deleteSignalSchema.input>;
export type DeleteSignalOutput = z.infer<typeof deleteSignalSchema.output>;
export type CreateSignalInput = z.infer<typeof createSignalSchema.input>;
export type CreateSignalOutput = z.infer<typeof createSignalSchema.output>;
export type ClayClaygentVersion = z.infer<typeof ClayClaygentVersionSchema>;
export type ClayClaygent = z.infer<typeof ClayClaygentSchema>;
export type ListClaygentsInput = z.infer<typeof listClaygentsSchema.input>;
export type ListClaygentsOutput = z.infer<typeof listClaygentsSchema.output>;
export type GetClaygentInput = z.infer<typeof getClaygentSchema.input>;
export type GetClaygentOutput = z.infer<typeof getClaygentSchema.output>;
export type ClaygentOutputField = z.infer<typeof ClaygentOutputFieldSchema>;
export type ClaygentOutputFormat = z.infer<typeof ClaygentOutputFormatSchema>;
export type CreateClaygentInput = z.infer<typeof createClaygentSchema.input>;
export type CreateClaygentOutput = z.infer<typeof createClaygentSchema.output>;
export type UpdateClaygentInput = z.infer<typeof updateClaygentSchema.input>;
export type UpdateClaygentOutput = z.infer<typeof updateClaygentSchema.output>;
export type DeleteClaygentInput = z.infer<typeof deleteClaygentSchema.input>;
export type DeleteClaygentOutput = z.infer<typeof deleteClaygentSchema.output>;
export type RunClaygentInput = z.infer<typeof runClaygentSchema.input>;
export type RunClaygentOutput = z.infer<typeof runClaygentSchema.output>;
export type GetClaygentRunInput = z.infer<typeof getClaygentRunSchema.input>;
export type GetClaygentRunOutput = z.infer<typeof getClaygentRunSchema.output>;
export type ClayAppAccount = z.infer<typeof ClayAppAccountSchema>;
export type ListAppAccountsInput = z.infer<typeof listAppAccountsSchema.input>;
export type ListAppAccountsOutput = z.infer<
  typeof listAppAccountsSchema.output
>;
export type ClayWorkspaceDetails = z.infer<typeof ClayWorkspaceDetailsSchema>;
export type GetWorkspaceDetailsInput = z.infer<
  typeof getWorkspaceDetailsSchema.input
>;
export type GetWorkspaceDetailsOutput = z.infer<
  typeof getWorkspaceDetailsSchema.output
>;
export type ListWorkbookTablesInput = z.infer<
  typeof listWorkbookTablesSchema.input
>;
export type ListWorkbookTablesOutput = z.infer<
  typeof listWorkbookTablesSchema.output
>;
export type ListWorkspaceTablesInput = z.infer<
  typeof listWorkspaceTablesSchema.input
>;
export type ListWorkspaceTablesOutput = z.infer<
  typeof listWorkspaceTablesSchema.output
>;
export type ListClaygentDocumentsInput = z.infer<
  typeof listClaygentDocumentsSchema.input
>;
export type ListClaygentDocumentsOutput = z.infer<
  typeof listClaygentDocumentsSchema.output
>;
export type CreateClaygentDocumentInput = z.infer<
  typeof createClaygentDocumentSchema.input
>;
export type CreateClaygentDocumentOutput = z.infer<
  typeof createClaygentDocumentSchema.output
>;
export type DeleteClaygentDocumentInput = z.infer<
  typeof deleteClaygentDocumentSchema.input
>;
export type DeleteClaygentDocumentOutput = z.infer<
  typeof deleteClaygentDocumentSchema.output
>;
export type AddClaygentColumnInput = z.infer<
  typeof addClaygentColumnSchema.input
>;
export type AddClaygentColumnOutput = z.infer<
  typeof addClaygentColumnSchema.output
>;
export type CreateCampaignInput = z.infer<typeof createCampaignSchema.input>;
export type CreateCampaignOutput = z.infer<typeof createCampaignSchema.output>;
export type DeleteCampaignInput = z.infer<typeof deleteCampaignSchema.input>;
export type DeleteCampaignOutput = z.infer<typeof deleteCampaignSchema.output>;
export type GetCampaignSettingsInput = z.infer<
  typeof getCampaignSettingsSchema.input
>;
export type GetCampaignSettingsOutput = z.infer<
  typeof getCampaignSettingsSchema.output
>;
export type UpdateCampaignSettingsInput = z.infer<
  typeof updateCampaignSettingsSchema.input
>;
export type UpdateCampaignSettingsOutput = z.infer<
  typeof updateCampaignSettingsSchema.output
>;
export type UpdateCampaignStatusInput = z.infer<
  typeof updateCampaignStatusSchema.input
>;
export type UpdateCampaignStatusOutput = z.infer<
  typeof updateCampaignStatusSchema.output
>;
export type ListSequencerEmailAccountsInput = z.infer<
  typeof listSequencerEmailAccountsSchema.input
>;
export type ListSequencerEmailAccountsOutput = z.infer<
  typeof listSequencerEmailAccountsSchema.output
>;
export type ListGlobalBlocklistInput = z.infer<
  typeof listGlobalBlocklistSchema.input
>;
export type ListGlobalBlocklistOutput = z.infer<
  typeof listGlobalBlocklistSchema.output
>;
export type AddToGlobalBlocklistInput = z.infer<
  typeof addToGlobalBlocklistSchema.input
>;
export type AddToGlobalBlocklistOutput = z.infer<
  typeof addToGlobalBlocklistSchema.output
>;
export type BatchAddToGlobalBlocklistInput = z.infer<
  typeof batchAddToGlobalBlocklistSchema.input
>;
export type BatchAddToGlobalBlocklistOutput = z.infer<
  typeof batchAddToGlobalBlocklistSchema.output
>;
export type RemoveFromGlobalBlocklistInput = z.infer<
  typeof removeFromGlobalBlocklistSchema.input
>;
export type RemoveFromGlobalBlocklistOutput = z.infer<
  typeof removeFromGlobalBlocklistSchema.output
>;
export type GetEmailAccountConnectUrlInput = z.infer<
  typeof getEmailAccountConnectUrlSchema.input
>;
export type GetEmailAccountConnectUrlOutput = z.infer<
  typeof getEmailAccountConnectUrlSchema.output
>;
export type AddCampaignEmailAccountsInput = z.infer<
  typeof addCampaignEmailAccountsSchema.input
>;
export type AddCampaignEmailAccountsOutput = z.infer<
  typeof addCampaignEmailAccountsSchema.output
>;
export type RemoveCampaignEmailAccountsInput = z.infer<
  typeof removeCampaignEmailAccountsSchema.input
>;
export type RemoveCampaignEmailAccountsOutput = z.infer<
  typeof removeCampaignEmailAccountsSchema.output
>;
export type ListCampaignWebhooksInput = z.infer<
  typeof listCampaignWebhooksSchema.input
>;
export type ListCampaignWebhooksOutput = z.infer<
  typeof listCampaignWebhooksSchema.output
>;
export type CreateCampaignWebhookInput = z.infer<
  typeof createCampaignWebhookSchema.input
>;
export type CreateCampaignWebhookOutput = z.infer<
  typeof createCampaignWebhookSchema.output
>;
export type GetCampaignAnalyticsInput = z.infer<
  typeof getCampaignAnalyticsSchema.input
>;
export type GetCampaignAnalyticsOutput = z.infer<
  typeof getCampaignAnalyticsSchema.output
>;
export type GetDayWiseAnalyticsInput = z.infer<
  typeof getDayWiseAnalyticsSchema.input
>;
export type GetDayWiseAnalyticsOutput = z.infer<
  typeof getDayWiseAnalyticsSchema.output
>;
export type ListInboxRepliesInput = z.infer<
  typeof listInboxRepliesSchema.input
>;
export type ListInboxRepliesOutput = z.infer<
  typeof listInboxRepliesSchema.output
>;
export type SendInboxReplyInput = z.infer<typeof sendInboxReplySchema.input>;
export type SendInboxReplyOutput = z.infer<typeof sendInboxReplySchema.output>;
export type ListCampaignEmailAccountsInput = z.infer<
  typeof listCampaignEmailAccountsSchema.input
>;
export type ListCampaignEmailAccountsOutput = z.infer<
  typeof listCampaignEmailAccountsSchema.output
>;
export type SetCampaignSequenceInput = z.infer<
  typeof setCampaignSequenceSchema.input
>;
export type SetCampaignSequenceOutput = z.infer<
  typeof setCampaignSequenceSchema.output
>;
export type GetCampaignSequenceInput = z.infer<
  typeof getCampaignSequenceSchema.input
>;
export type GetCampaignSequenceOutput = z.infer<
  typeof getCampaignSequenceSchema.output
>;
export type SetCampaignScheduleInput = z.infer<
  typeof setCampaignScheduleSchema.input
>;
export type SetCampaignScheduleOutput = z.infer<
  typeof setCampaignScheduleSchema.output
>;
export type GetCampaignScheduleInput = z.infer<
  typeof getCampaignScheduleSchema.input
>;
export type GetCampaignScheduleOutput = z.infer<
  typeof getCampaignScheduleSchema.output
>;
export type SendTestEmailInput = z.infer<typeof sendTestEmailSchema.input>;
export type SendTestEmailOutput = z.infer<typeof sendTestEmailSchema.output>;
export type AddLeadsToCampaignInput = z.infer<
  typeof addLeadsToCampaignSchema.input
>;
export type AddLeadsToCampaignOutput = z.infer<
  typeof addLeadsToCampaignSchema.output
>;
export type SetCampaignLeadEmailInput = z.infer<
  typeof setCampaignLeadEmailSchema.input
>;
export type SetCampaignLeadEmailOutput = z.infer<
  typeof setCampaignLeadEmailSchema.output
>;
export type GetCreditReportInput = z.infer<typeof getCreditReportSchema.input>;
export type GetCreditReportOutput = z.infer<
  typeof getCreditReportSchema.output
>;
export type GetGlobalCampaignStatsInput = z.infer<
  typeof getGlobalCampaignStatsSchema.input
>;
export type GetGlobalCampaignStatsOutput = z.infer<
  typeof getGlobalCampaignStatsSchema.output
>;
export type InviteWorkspaceMemberInput = z.infer<
  typeof inviteWorkspaceMemberSchema.input
>;
export type InviteWorkspaceMemberOutput = z.infer<
  typeof inviteWorkspaceMemberSchema.output
>;
export type RemoveWorkspaceMemberInput = z.infer<
  typeof removeWorkspaceMemberSchema.input
>;
export type RemoveWorkspaceMemberOutput = z.infer<
  typeof removeWorkspaceMemberSchema.output
>;
export type UpdateWorkspaceMemberRoleInput = z.infer<
  typeof updateWorkspaceMemberRoleSchema.input
>;
export type UpdateWorkspaceMemberRoleOutput = z.infer<
  typeof updateWorkspaceMemberRoleSchema.output
>;
export type CreateWebhookSourceInput = z.infer<
  typeof createWebhookSourceSchema.input
>;
export type CreateWebhookSourceOutput = z.infer<
  typeof createWebhookSourceSchema.output
>;
export type CreateGoogleSheetsSourceInput = z.infer<
  typeof createGoogleSheetsSourceSchema.input
>;
export type CreateGoogleSheetsSourceOutput = z.infer<
  typeof createGoogleSheetsSourceSchema.output
>;
export type CreateCrmImportSourceInput = z.infer<
  typeof createCrmImportSourceSchema.input
>;
export type CreateCrmImportSourceOutput = z.infer<
  typeof createCrmImportSourceSchema.output
>;
export type CreateSalesNavSourceInput = z.infer<
  typeof createSalesNavSourceSchema.input
>;
export type CreateSalesNavSourceOutput = z.infer<
  typeof createSalesNavSourceSchema.output
>;
export type DeleteCampaignWebhookInput = z.infer<
  typeof deleteCampaignWebhookSchema.input
>;
export type DeleteCampaignWebhookOutput = z.infer<
  typeof deleteCampaignWebhookSchema.output
>;
export type SetLeadCategoryInput = z.infer<typeof setLeadCategorySchema.input>;
export type SetLeadCategoryOutput = z.infer<
  typeof setLeadCategorySchema.output
>;
export type SetLeadReadStatusInput = z.infer<
  typeof setLeadReadStatusSchema.input
>;
export type SetLeadReadStatusOutput = z.infer<
  typeof setLeadReadStatusSchema.output
>;
export type GetMessageHistoryInput = z.infer<
  typeof getMessageHistorySchema.input
>;
export type GetMessageHistoryOutput = z.infer<
  typeof getMessageHistorySchema.output
>;
export type ListTrashInput = z.infer<typeof listTrashSchema.input>;
export type ListTrashOutput = z.infer<typeof listTrashSchema.output>;
export type RestoreResourceInput = z.infer<typeof restoreResourceSchema.input>;
export type RestoreResourceOutput = z.infer<
  typeof restoreResourceSchema.output
>;
export type SetDefaultAppAccountInput = z.infer<
  typeof setDefaultAppAccountSchema.input
>;
export type SetDefaultAppAccountOutput = z.infer<
  typeof setDefaultAppAccountSchema.output
>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema.input>;
export type UpdateWorkspaceOutput = z.infer<
  typeof updateWorkspaceSchema.output
>;
export type GetResourceInput = z.infer<typeof getResourceSchema.input>;
export type GetResourceOutput = z.infer<typeof getResourceSchema.output>;
export type LogResourceActivityInput = z.infer<
  typeof logResourceActivitySchema.input
>;
export type LogResourceActivityOutput = z.infer<
  typeof logResourceActivitySchema.output
>;
export type RemoveWorkspaceUserInput = z.infer<
  typeof removeWorkspaceUserSchema.input
>;
export type RemoveWorkspaceUserOutput = z.infer<
  typeof removeWorkspaceUserSchema.output
>;
export type GetKnockTokenInput = z.infer<typeof getKnockTokenSchema.input>;
export type GetKnockTokenOutput = z.infer<typeof getKnockTokenSchema.output>;
export type GetCreditAccrualInput = z.infer<
  typeof getCreditAccrualSchema.input
>;
export type GetCreditAccrualOutput = z.infer<
  typeof getCreditAccrualSchema.output
>;
export type GetWorkbookInput = z.infer<typeof getWorkbookSchema.input>;
export type GetWorkbookOutput = z.infer<typeof getWorkbookSchema.output>;
export type GetWorkbookOverviewInput = z.infer<
  typeof getWorkbookOverviewSchema.input
>;
export type GetWorkbookOverviewOutput = z.infer<
  typeof getWorkbookOverviewSchema.output
>;
export type ListSubroutinesInput = z.infer<typeof listSubroutinesSchema.input>;
export type ListSubroutinesOutput = z.infer<
  typeof listSubroutinesSchema.output
>;
export type DuplicateViewInput = z.infer<typeof duplicateViewSchema.input>;
export type DuplicateViewOutput = z.infer<typeof duplicateViewSchema.output>;
export type StopFieldInput = z.infer<typeof stopFieldSchema.input>;
export type StopFieldOutput = z.infer<typeof stopFieldSchema.output>;
export type GetFieldRunStatusInput = z.infer<
  typeof getFieldRunStatusSchema.input
>;
export type GetFieldRunStatusOutput = z.infer<
  typeof getFieldRunStatusSchema.output
>;
export type GetFieldsRunStatusInput = z.infer<
  typeof getFieldsRunStatusSchema.input
>;
export type GetFieldsRunStatusOutput = z.infer<
  typeof getFieldsRunStatusSchema.output
>;
export type GetSourceRunsInput = z.infer<typeof getSourceRunsSchema.input>;
export type GetSourceRunsOutput = z.infer<typeof getSourceRunsSchema.output>;
export type TriggerSourceSyncInput = z.infer<
  typeof triggerSourceSyncSchema.input
>;
export type TriggerSourceSyncOutput = z.infer<
  typeof triggerSourceSyncSchema.output
>;
export type CreateSourceFromSearchInput = z.infer<
  typeof createSourceFromSearchSchema.input
>;
export type CreateSourceFromSearchOutput = z.infer<
  typeof createSourceFromSearchSchema.output
>;
export type AddPeopleSearchToTableInput = z.infer<
  typeof addPeopleSearchToTableSchema.input
>;
export type AddPeopleSearchToTableOutput = z.infer<
  typeof addPeopleSearchToTableSchema.output
>;
export type AddCompanySearchToTableInput = z.infer<
  typeof addCompanySearchToTableSchema.input
>;
export type AddCompanySearchToTableOutput = z.infer<
  typeof addCompanySearchToTableSchema.output
>;
export type GetCampaign30dAnalyticsInput = z.infer<
  typeof getCampaign30dAnalyticsSchema.input
>;
export type GetCampaign30dAnalyticsOutput = z.infer<
  typeof getCampaign30dAnalyticsSchema.output
>;
export type GetSmartleadAccountInput = z.infer<
  typeof getSmartleadAccountSchema.input
>;
export type GetSmartleadAccountOutput = z.infer<
  typeof getSmartleadAccountSchema.output
>;
export type GetAppAccountTypesInput = z.infer<
  typeof getAppAccountTypesSchema.input
>;
export type GetAppAccountTypesOutput = z.infer<
  typeof getAppAccountTypesSchema.output
>;
export type GetAppAccountTypeInput = z.infer<
  typeof getAppAccountTypeSchema.input
>;
export type GetAppAccountTypeOutput = z.infer<
  typeof getAppAccountTypeSchema.output
>;
export type GetAppAccountsByTypeInput = z.infer<
  typeof getAppAccountsByTypeSchema.input
>;
export type GetAppAccountsByTypeOutput = z.infer<
  typeof getAppAccountsByTypeSchema.output
>;
export type CreateAppAccountInput = z.infer<
  typeof createAppAccountSchema.input
>;
export type CreateAppAccountOutput = z.infer<
  typeof createAppAccountSchema.output
>;
export type UpdateAppAccountInput = z.infer<
  typeof updateAppAccountSchema.input
>;
export type UpdateAppAccountOutput = z.infer<
  typeof updateAppAccountSchema.output
>;
export type DeleteAppAccountInput = z.infer<
  typeof deleteAppAccountSchema.input
>;
export type DeleteAppAccountOutput = z.infer<
  typeof deleteAppAccountSchema.output
>;
export type ListActiveExportsInput = z.infer<
  typeof listActiveExportsSchema.input
>;
export type ListActiveExportsOutput = z.infer<
  typeof listActiveExportsSchema.output
>;
export type CreateExportInput = z.infer<typeof createExportSchema.input>;
export type CreateExportOutput = z.infer<typeof createExportSchema.output>;
export type DownloadCSVInput = z.infer<typeof downloadCSVSchema.input>;
export type DownloadCSVOutput = z.infer<typeof downloadCSVSchema.output>;
export type ImportCSVInput = z.infer<typeof importCSVSchema.input>;
export type ImportCSVOutput = z.infer<typeof importCSVSchema.output>;
export type PermanentDeleteTrashItemInput = z.infer<
  typeof permanentDeleteTrashItemSchema.input
>;
export type PermanentDeleteTrashItemOutput = z.infer<
  typeof permanentDeleteTrashItemSchema.output
>;
export type BulkPermanentDeleteTrashInput = z.infer<
  typeof bulkPermanentDeleteTrashSchema.input
>;
export type BulkPermanentDeleteTrashOutput = z.infer<
  typeof bulkPermanentDeleteTrashSchema.output
>;
export type CustomSignalSourceType = z.infer<
  typeof CustomSignalSourceTypeSchema
>;
export type ListCustomSignalSourceTypesInput = z.infer<
  typeof listCustomSignalSourceTypesSchema.input
>;
export type ListCustomSignalSourceTypesOutput = z.infer<
  typeof listCustomSignalSourceTypesSchema.output
>;
export type CreateCustomSignalInput = z.infer<
  typeof createCustomSignalSchema.input
>;
export type CreateCustomSignalOutput = z.infer<
  typeof createCustomSignalSchema.output
>;
