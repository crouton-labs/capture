import { z } from 'zod';

export const libraryDescription =
  'Apollo.io sales intelligence operations via internal APIs';

export const libraryIcon = '/icons/libs/apollo.png';
export const loginUrl = 'https://app.apollo.io';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://app.apollo.io\`
2. Call \`getContext()\` first to verify login; check the returned account/team info to confirm you are in the correct Apollo account before proceeding
3. Call other functions as needed; no additional auth params required

## Pagination

Apollo uses page-based pagination: \`page\` (1-indexed) and \`perPage\` (max 25). Higher perPage values return empty results.

**Free accounts are limited to 5 pages (125 results) per search.** Paid accounts can paginate deeper. If a search returns fewer results than expected, this is likely the cause: the free plan caps search depth. Tell the user if so.

## Working With Apollo

Keep calls small and incremental. Do NOT make one giant request and wait; use small batches and pick up where you left off. For bulk operations, call the function repeatedly with small limits (100 or less) and use \`startPage\`/\`lastPage\` to continue. This avoids timeouts and gives the user progress updates between batches.

## Search Modes

- **\`total\`** = all people (net-new + saved)
- **\`net-new\`** = people not yet in your CRM
- **\`saved\`** = contacts already in your CRM

## File Exports

\`freeExportPeopleSearch()\`: 30+ fields per person, zero credits. No emails/phones.
\`exportPeopleSearch()\`: includes revealed emails and phones. Costs 1 credit per person; check \`getPlanDetails()\` first.

Both save files to the user's device automatically. Do NOT use \`@vallum/files\`; check \`fileRef.path\` in the response. Pass \`format: "csv"\` or \`format: "json"\`.

## Credit Operations

Apollo uses a **unified credit pool**; all operations draw from \`totalCredits\`. Call \`getPlanDetails()\` to check the balance and per-operation costs.

- **FREE**: Search, filter, view, all metadata fields, \`freeExportPeopleSearch\`, \`unlockEmail()\` (basic), \`unlockPhone()\` (basic)
- **1 credit each**: \`unlockEmail({ useWaterfall: true })\`, \`exportPeopleSearch\` (per person)
- **8 credits each**: \`unlockPhone({ useEnrichment: true })\` (per person)

Check \`costPerEmailReveal\` and \`costPerPhoneReveal\` from \`getPlanDetails()\` for exact costs, as they may vary by plan.

## Filter Discovery

Apollo has 382+ filter fields. Use these three functions to discover valid filter keys and values dynamically:

- \`getFilterFields()\`: Returns all valid filter parameter names (the keys you pass in the \`filters\` object to \`searchPeople()\`, \`searchCompanies()\`, \`selectPeople()\`, \`selectCompanies()\`, and as signal keys to \`createSavedSearch()\`)
- \`getFilterOptions()\`: Returns valid values for 21 enumerated filters (seniorities, funding stages, employee ranges, departments, email/phone status, etc.). Each facet includes a \`filterKey\` showing which filter parameter accepts those values.
- \`searchFilterTags({ kind, query })\`: Search for industry or technology tags by name to get tag IDs for \`organization_linkedin_industry_tag_ids\` or \`currently_using_any_of_technology_uids\` filters.

The filter descriptions on \`searchPeople()\` / \`selectPeople()\` / \`searchCompanies()\` list common filters only. For the full list, call \`getFilterFields()\`.

## Funding Stage Codes

The \`organization_latest_funding_stage_cd\` filter uses numeric string codes, NOT human-readable names:
- \`"0"\` = Seed, \`"1"\` = Angel, \`"2"\` = Series A, \`"3"\` = Series B
- \`"4"\` = Series C, \`"5"\` = Series D, \`"6"\` = Series E, \`"7"\` = Series F
- \`"10"\` = Venture, \`"11"\` = Private Equity, \`"12"\` = Other
- \`"13"\` = Debt Financing, \`"14"\` = Equity Crowdfunding, \`"15"\` = Convertible Note, \`"16"\` = M&A

Call \`getFilterOptions()\` to discover all valid values dynamically instead of relying on this list.

## Person IDs vs Contact IDs

Apollo has two INCOMPATIBLE ID types; using the wrong one silently fails:
- **Person IDs**: People in Apollo's 275M database (from selectPeople/searchPeople). Required by \`unlockEmail()\` and \`unlockPhone()\`.
- **Contact IDs**: People saved to YOUR Apollo CRM (from addContactsToList/getContactsInList/CSV imports). Required by \`addContactsToSequence()\`.

**Common mistake**: CSV-imported contacts only have Contact IDs. Calling \`unlockEmail()\` with Contact IDs returns zero emails; it needs Person IDs from \`selectPeople()\`. To enrich CSV imports, use \`emailEnrichment: true\` in \`importCsvToList()\` instead.

Use \`addContactsToList()\` to convert Person IDs → Contact IDs for sequence enrollment.

## CSV Import Workflow

When importing contacts from external sources (Clay, spreadsheets, etc.):
1. Import CSV with \`importCsvToList({ ..., emailEnrichment: true })\`; enrichment finds emails via Apollo's database
2. Wait for enrichment to complete (async, may take minutes for large imports)
3. Check email coverage via \`getContactsInList()\` before creating sequences
4. If coverage is low, supplement by searching Apollo natively for the same companies/titles

## End-to-End Outreach Workflow

1. \`selectPeople({ filters, maxCount })\` → returns \`{ ids, people, totalCollected }\` (use \`ids\` field for person IDs)
2. \`addContactsToList({ listName, contactIds: ids })\` → saves to CRM, returns \`savedContactIds\`
3. \`listEmailAccounts()\` → get email account ID
4. \`createSequence({ name })\` → create a sequence
5. Add steps; use \`replyToThread: true\` on follow-up steps to thread emails:
   - \`addSequenceStep({ sequenceId, type: "auto_email", subject: "Initial outreach", bodyHtml: "..." })\` → step 1 (new thread)
   - \`addSequenceStep({ sequenceId, type: "auto_email", replyToThread: true, waitTime: 2, bodyHtml: "..." })\` → step 2 (threaded reply)
   - \`addSequenceStep({ sequenceId, type: "auto_email", replyToThread: true, waitTime: 3, bodyHtml: "..." })\` → step 3 (threaded reply)
6. \`addListToSequence({ listId, sequenceId, sendEmailFromEmailAccountId })\` → enroll ALL list contacts
7. **STOP and confirm with the user** before activating; activation sends real emails immediately
8. \`activateSequence({ sequenceId })\` → approve and start sending (only after user confirms)
8. \`searchEmails({ sequenceId })\` → find scheduled email IDs
9. \`sendEmailNow({ id })\` → force-send immediately (optional, bypasses batch queue)

Or use \`addContactsToSequence()\` with \`savedContactIds\` from step 2 for more control.

**IMPORTANT**: You MUST call \`activateSequence()\` to start sending. Setting \`active: true\` via \`updateSequence()\` does NOT work.
Apollo's batch queue can delay emails 15+ minutes. Use \`sendEmailNow()\` after activation to send instantly.

**Multi-step threading**: Set \`replyToThread: true\` on steps 2+ to create threaded email chains. The first step is always a new thread. Follow-up steps with \`replyToThread: true\` will appear as replies in the recipient's inbox with "Re:" prefixed to the first step's subject.

## Known Limitations

- **contacts_finished_in_other_campaigns**: Once a contact finishes or is removed from ANY sequence, Apollo blocks re-enrollment by default. Override with \`sequenceFinishedInOtherCampaigns: true\` in addContactsToSequence(), or use \`resetFinishedContacts()\` to delete and recreate the contacts (generates new contact IDs).
- **searchPeople does not return tech stack data**: Technology filters work for narrowing results, but the returned person/organization objects do not include which technologies matched. Use \`viewCompany()\` separately if you need to verify tech stack.
- **Technology UIDs are validated automatically**: Search functions validate \`currently_using_any_of_technology_uids\` and \`not_currently_using_any_of_technology_uids\` against Apollo's tag database and throw on invalid UIDs. Use \`searchFilterTags()\` to find valid UIDs.

## People

- \`searchPeople()\` - Search/filter people. To look up a specific person, pass \`filters: { q_person_name: "Name", q_organization_name: "Company" }\` with \`perPage: 5\`. Always include company name to disambiguate; common names return many false matches.
- \`selectPeople()\` - Collect person IDs from search

## Companies

- \`searchCompanies()\` - Search/filter companies
- \`viewCompany()\` - View company details
- \`selectCompanies()\` - Collect company IDs from search

## Contact Management

- \`createContact()\` - Create a new contact
- \`updateContact()\` - Update an existing contact
- \`deleteContact()\` - Delete a contact
- \`updateContactStage()\` - Update a contact's stage
- \`listContactStages()\` - List all contact stages

## Account Management

- \`createAccount()\` - Create a new account
- \`updateAccount()\` - Update an existing account
- \`deleteAccount()\` - Delete an account
- \`updateAccountStage()\` - Update an account's stage
- \`listAccountStages()\` - List all account stages

## Lists

Lists (called "labels" in Apollo's API) organize contacts and companies. \`addContactsToList()\` and \`addCompaniesToList()\` auto-create the list if it doesn't exist.

## Sequences

- \`searchSequences()\` - Search sequences with pagination
- \`viewSequence()\` - View a single sequence by ID
- \`createSequence()\` - Create a new sequence
- \`updateSequence()\` - Update an existing sequence
- \`deleteSequence()\` - Delete a sequence
- \`activateSequence()\` - Activate/approve a sequence for sending
- \`deactivateSequence()\` - Pause/deactivate a sequence
- \`addSequenceStep()\` - Add a step to a sequence
- \`deleteSequenceStep()\` - Delete a sequence step
- \`updateSequenceStep()\` - Update step metadata (wait time, type)
- \`addContactsToSequence()\` - Add contacts to a sequence for outreach
- \`addListToSequence()\` - Add ALL contacts from a list to a sequence (auto-paginates)
- \`getSequenceContacts()\` - List contacts enrolled in a sequence
- \`updateSequenceContactStatus()\` - Update contact status in a sequence (pause/resume/finish)
- \`cloneSequence()\` - Clone a sequence
- \`listSequenceSchedules()\` - List sending schedules
- \`createSequenceSchedule()\` - Create a new sending schedule
- \`deleteSequenceSchedule()\` - Delete a schedule

## Email Tracking

- \`searchEmails()\` - Search sent emails from sequences
- \`viewEmail()\` - View a single email message details (returns full rendered body with all template variables resolved)
- \`getEmailAnalytics()\` - Get email performance metrics
- \`sendEmailNow()\` - Force send a scheduled or drafted email immediately (bypasses batch queue)
- \`createEmail()\` - Create a one-off email draft to a contact (not tied to any sequence)
- \`sendEmail()\` - Compose and send a one-off email to a contact immediately

## Verifying Email Content

After creating sequence steps with template variables, always verify the rendered email looks correct:
1. Enroll a contact → \`addContactsToSequence()\`
2. Find the scheduled email → \`searchEmails({ sequenceId })\`
3. View the full rendered email → \`viewEmail({ id })\`; the \`body_html\` and \`body_text\` fields contain the final email with ALL template variables resolved (e.g. \`{{first_name}}\` becomes "Satya")
4. Check for empty or missing variable values that indicate the contact is missing data

You can also inspect raw templates before enrollment via \`viewSequence()\`; the \`emailer_templates\` array contains the unresolved templates with \`{{variable}}\` placeholders. Chain with \`listTemplateVariables()\` to verify variable names are correct.

## Email Templates

A sequence cannot be activated until ALL prerequisites are met:
1. **At least one step**: add via \`addSequenceStep()\`
2. **Sending schedule assigned**: call \`listSequenceSchedules()\` to get available schedule IDs, then pass \`emailerScheduleId\` to \`updateSequence()\`
3. **Set active**: call \`updateSequence({ id, active: true })\`

You can combine steps 2 and 3: \`updateSequence({ id, emailerScheduleId: "...", active: true })\`

If Apollo silently refuses activation, \`updateSequence()\` throws with diagnostics. The most common cause is a missing schedule.
`;

// ============================================================================
// Shared Parameter Schemas
// ============================================================================

export const ModeParam = z
  .enum(['total', 'net-new', 'saved'])
  .describe('Search mode: total=all, net-new=not in CRM, saved=in CRM');

export const ModalityParam = z
  .enum(['contacts', 'accounts'])
  .describe('List type: contacts=people, accounts=companies');

export const SequencePermissionsParam = z
  .enum(['team_can_use', 'team_can_view', 'private'])
  .describe('Sequence permission level');

export const SequenceStepTypeParam = z
  .enum([
    'auto_email',
    'manual_email',
    'call',
    'action_item',
    'linkedin_step_message',
    'linkedin_step_connect',
    'linkedin_step_view_profile',
    'linkedin_step_interact_with_post',
  ])
  .describe('Sequence step type');

export const StepPriorityParam = z
  .enum(['A', 'B'])
  .describe('Step priority: A=main, B=A/B test variant');

export const WaitModeParam = z
  .enum(['day', 'hour', 'minute'])
  .describe('Wait time unit between steps');

export const SavedSearchModalityParam = z
  .enum(['people', 'companies'])
  .describe('Saved search type: people or companies');

// ============================================================================
// Common Filter Value Enums
// ============================================================================

/**
 * Funding stage codes for organization_latest_funding_stage_cd filter.
 * WARNING: These are numeric string codes, NOT human-readable names.
 * "series_a" does NOT mean Series A; it maps to Seed.
 */
export const FundingStageCode = z
  .enum([
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '10',
    '11',
    '12',
    '13',
    '14',
    '15',
    '16',
  ])
  .describe(
    'Funding stage code: "0"=Seed, "1"=Angel, "2"=Series A, "3"=Series B, "4"=Series C, "5"=Series D, "6"=Series E, "7"=Series F, "10"=Venture, "11"=Private Equity, "12"=Other, "13"=Debt Financing, "14"=Equity Crowdfunding, "15"=Convertible Note, "16"=Merger/Acquisition',
  );

export const SeniorityCode = z
  .enum([
    'owner',
    'founder',
    'c_suite',
    'partner',
    'vp',
    'head',
    'director',
    'manager',
    'senior',
    'entry',
    'intern',
  ])
  .describe('Seniority level for person_seniorities filter');

export const EmployeeRangeCode = z
  .enum([
    '1,10',
    '11,20',
    '21,50',
    '51,100',
    '101,200',
    '201,500',
    '501,1000',
    '1001,2000',
    '2001,5000',
    '5001,10000',
    '10001',
  ])
  .describe(
    'Employee count range for organization_num_employees_ranges filter',
  );

// ============================================================================
// Shared Output Schemas
// ============================================================================

export const PaginationSchema = z.object({
  page: z.number().describe('Current page number'),
  per_page: z.number().describe('Results per page'),
  total_pages: z.number().describe('Total number of pages'),
  total_entries: z.number().describe('Total matching records'),
});

export const PersonSchema = z.object({
  id: z.string().describe('Person ID'),
  name: z.string().optional().describe('Full name'),
  first_name: z.string().optional().describe('First name'),
  last_name: z.string().optional().describe('Last name'),
  title: z.string().optional().describe('Job title'),
  organization_name: z.string().optional().describe('Company name'),
  linkedin_url: z.string().optional().describe('LinkedIn profile URL'),
  city: z.string().optional().describe('City'),
  state: z.string().optional().describe('State'),
  country: z.string().optional().describe('Country'),
  email_domain_catchall: z
    .boolean()
    .optional()
    .describe(
      'Whether the email domain is a catch-all (accepts any address, less reliable for deliverability)',
    ),
  formatted_address: z
    .string()
    .optional()
    .describe('Full formatted address (e.g. "Media, PA, USA")'),
  certifications: z
    .array(
      z.object({
        title: z.string().optional().describe('Certification name'),
        issuer: z.string().optional().describe('Issuing organization'),
        date_from: z
          .string()
          .nullable()
          .optional()
          .describe('Date earned (YYYY-MM-DD)'),
        date_to: z
          .string()
          .nullable()
          .optional()
          .describe('Expiration date (YYYY-MM-DD), null if no expiry'),
      }),
    )
    .optional()
    .describe('Professional certifications'),
  organization: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      website_url: z.string().optional(),
      linkedin_url: z.string().optional(),
      phone: z.string().optional(),
      founded_year: z.number().optional(),
      estimated_num_employees: z.number().optional(),
      industry: z.string().optional(),
      logo_url: z.string().nullable().optional(),
      primary_domain: z
        .string()
        .optional()
        .describe('Primary domain (e.g. "acme.com")'),
      sic_codes: z
        .array(z.string())
        .optional()
        .describe('SIC industry classification codes'),
      naics_codes: z
        .array(z.string())
        .optional()
        .describe('NAICS industry classification codes'),
      organization_headcount_six_month_growth: z
        .number()
        .nullable()
        .optional()
        .describe(
          'Headcount growth rate over 6 months (e.g. 0.15 = 15% growth)',
        ),
      organization_headcount_twelve_month_growth: z
        .number()
        .nullable()
        .optional()
        .describe('Headcount growth rate over 12 months'),
      organization_headcount_twenty_four_month_growth: z
        .number()
        .nullable()
        .optional()
        .describe('Headcount growth rate over 24 months'),
      twitter_url: z.string().nullable().optional(),
      facebook_url: z.string().nullable().optional(),
      publicly_traded_symbol: z.string().nullable().optional(),
      publicly_traded_exchange: z.string().nullable().optional(),
    })
    .passthrough()
    .optional()
    .describe(
      'Embedded company data returned with each person; includes headcount growth, SIC/NAICS codes, tech stack, and more without a separate viewCompany call',
    ),
});

export const CompanySchema = z.object({
  id: z.string().describe('Company/organization ID'),
  name: z.string().optional().describe('Company name'),
  website_url: z.string().optional().describe('Website URL'),
  linkedin_url: z.string().optional().describe('LinkedIn company URL'),
  phone: z.string().optional().describe('Phone number'),
  founded_year: z.number().optional().describe('Year founded'),
  organization_revenue_printed: z.string().optional().describe('Revenue range'),
  industry: z.string().optional().describe('Industry'),
  city: z.string().optional().describe('City'),
  state: z.string().optional().describe('State'),
  country: z.string().optional().describe('Country'),
  short_description: z.string().optional().describe('Company description'),
  estimated_num_employees: z
    .number()
    .optional()
    .describe('Estimated employee count'),
  total_funding: z
    .number()
    .nullable()
    .optional()
    .describe('Total funding in dollars'),
  total_funding_printed: z
    .string()
    .nullable()
    .optional()
    .describe('Human-readable total funding (e.g. "$1.5B")'),
  latest_funding_stage: z
    .string()
    .nullable()
    .optional()
    .describe('Latest funding stage (e.g. "Series F")'),
  latest_funding_round_date: z
    .string()
    .nullable()
    .optional()
    .describe('Date of latest funding round'),
  annual_revenue: z
    .number()
    .nullable()
    .optional()
    .describe('Annual revenue in dollars'),
  annual_revenue_printed: z
    .string()
    .nullable()
    .optional()
    .describe('Human-readable annual revenue'),
  technology_names: z
    .array(z.string())
    .optional()
    .describe('Technology stack names'),
  keywords: z.array(z.string()).optional().describe('Keyword tags'),
  twitter_url: z
    .string()
    .nullable()
    .optional()
    .describe('Twitter/X profile URL'),
  facebook_url: z.string().nullable().optional().describe('Facebook page URL'),
  logo_url: z.string().nullable().optional().describe('Company logo URL'),
  street_address: z.string().nullable().optional().describe('Street address'),
  raw_address: z.string().nullable().optional().describe('Full raw address'),
  postal_code: z.string().nullable().optional().describe('Postal/ZIP code'),
  publicly_traded_symbol: z
    .string()
    .nullable()
    .optional()
    .describe('Stock ticker symbol'),
  publicly_traded_exchange: z
    .string()
    .nullable()
    .optional()
    .describe('Stock exchange name'),
  primary_domain: z
    .string()
    .optional()
    .describe('Primary domain (e.g. "stripe.com")'),
  industries: z
    .array(z.string())
    .optional()
    .describe('Industry classifications'),
  sic_codes: z
    .array(z.string())
    .optional()
    .describe('SIC industry classification codes'),
  naics_codes: z
    .array(z.string())
    .optional()
    .describe('NAICS industry classification codes'),
  organization_headcount_six_month_growth: z
    .number()
    .nullable()
    .optional()
    .describe('Headcount growth rate over 6 months (e.g. 0.15 = 15% growth)'),
  organization_headcount_twelve_month_growth: z
    .number()
    .nullable()
    .optional()
    .describe('Headcount growth rate over 12 months'),
  organization_headcount_twenty_four_month_growth: z
    .number()
    .nullable()
    .optional()
    .describe('Headcount growth rate over 24 months'),
  employee_metrics: z
    .array(
      z.object({
        date: z.string().optional(),
        count: z.number().optional(),
      }),
    )
    .optional()
    .describe('Historical employee count snapshots over time'),
  current_technologies: z
    .array(
      z.object({
        uid: z.string().optional(),
        name: z.string().optional(),
        category: z.string().optional(),
      }),
    )
    .optional()
    .describe(
      'Technologies currently used by the company (from viewCompany detail endpoint)',
    ),
  funding_events: z
    .array(
      z.object({
        id: z.string().optional(),
        date: z.string().optional(),
        news_url: z.string().nullable().optional(),
        type: z.string().optional(),
        investors: z.string().optional(),
        amount: z.string().optional(),
        currency: z.string().optional(),
      }),
    )
    .optional()
    .describe('Funding round history (from viewCompany detail endpoint)'),
});

export const LabelSchema = z.object({
  id: z.string().describe('List ID'),
  name: z.string().describe('List name'),
  modality: ModalityParam.describe('List type'),
  cached_count: z
    .number()
    .optional()
    .describe(
      'Number of items in list. May be stale; can show 0 even when items exist. Do not rely on for accurate counts.',
    ),
  created_at: z
    .string()
    .optional()
    .describe('ISO timestamp when list was created'),
  updated_at: z
    .string()
    .optional()
    .describe('ISO timestamp when list was last updated'),
  user_id: z.string().optional().describe('ID of the user who owns the list'),
});

export const FinderViewSchema = z.object({
  id: z.string().describe('Saved search ID'),
  name: z.string().describe('Saved search name'),
  shared: z.boolean().optional().describe('Whether shared with team'),
  system: z.boolean().describe('True for Apollo-provided default views'),
  updated_at: z.string().optional().describe('Last updated timestamp'),
});

export const LinkedInDataSchema = z.object({
  name: z.string().describe('Full name'),
  title: z.string().describe('Job title'),
  company: z.string().describe('Company name'),
  linkedin_url: z.string().describe('LinkedIn profile URL'),
  location: z.string().describe('Location (city, state, country)'),
});

export const PhoneNumberSchema = z
  .object({
    raw_number: z.string().describe('Phone number as entered'),
    sanitized_number: z.string().optional().describe('Cleaned phone number'),
    type: z.string().optional().describe('Phone type (mobile, work, etc.)'),
    status: z.string().optional().describe('Verification status'),
  })
  .passthrough();

export const ContactEmailSchema = z
  .object({
    email: z.string().describe('Email address'),
    email_status: z.string().describe('Verification status'),
  })
  .passthrough();

export const UnlockedContactSchema = z
  .object({
    id: z.string().describe('Contact ID'),
    name: z.string().optional().describe('Full name'),
    title: z.string().optional().describe('Job title'),
    company: z.string().optional().describe('Company name'),
    email: z.string().optional().describe('Primary email'),
    emailStatus: z.string().optional().describe('Email verification status'),
    contactEmails: z
      .array(ContactEmailSchema)
      .optional()
      .describe('All email addresses'),
    phoneNumbers: z
      .array(PhoneNumberSchema)
      .optional()
      .describe('All phone numbers'),
    sanitizedPhone: z.string().optional().describe('Primary phone number'),
    directDialStatus: z
      .string()
      .optional()
      .describe('Direct dial enrichment status'),
  })
  .passthrough();

export const SequenceSchema = z.object({
  id: z.string().describe('Sequence ID'),
  name: z.string().describe('Sequence name'),
  active: z.boolean().optional().describe('Whether the sequence is active'),
  archived: z.boolean().optional().describe('Whether the sequence is archived'),
  created_at: z.string().optional().describe('Creation timestamp'),
  num_steps: z.number().optional().describe('Number of steps in the sequence'),
  permissions: SequencePermissionsParam.optional().describe('Permission level'),
  user_id: z.string().optional().describe('Owner user ID'),
  emailer_schedule_id: z.string().optional().describe('Schedule ID'),
  max_emails_per_day: z.number().optional().describe('Max emails per day'),
  same_account_reply_policy_cd: z
    .number()
    .optional()
    .describe('Same-account reply policy code'),
  unique_scheduled: z
    .union([z.number(), z.string()])
    .optional()
    .describe(
      'Unique contacts scheduled (returns "loading" on newly created sequences)',
    ),
  unique_delivered: z
    .union([z.number(), z.string()])
    .optional()
    .describe('Unique contacts delivered to'),
  unique_bounced: z
    .union([z.number(), z.string()])
    .optional()
    .describe('Unique contacts bounced'),
  unique_opened: z
    .union([z.number(), z.string()])
    .optional()
    .describe('Unique contacts who opened'),
  unique_replied: z
    .union([z.number(), z.string()])
    .optional()
    .describe('Unique contacts who replied'),
  unique_clicked: z
    .union([z.number(), z.string()])
    .optional()
    .describe('Unique contacts who clicked'),
  unique_unsubscribed: z
    .union([z.number(), z.string()])
    .optional()
    .describe('Unique contacts who unsubscribed'),
  bounce_rate: z
    .union([z.number(), z.string()])
    .optional()
    .describe('Bounce rate percentage'),
  open_rate: z
    .union([z.number(), z.string()])
    .optional()
    .describe('Open rate percentage'),
  reply_rate: z
    .union([z.number(), z.string()])
    .optional()
    .describe('Reply rate percentage'),
  click_rate: z
    .union([z.number(), z.string()])
    .optional()
    .describe('Click rate percentage'),
  contact_statuses: z
    .record(z.string(), z.union([z.number(), z.string()]))
    .optional()
    .describe(
      'Contact status counts. Keys: active, failed, paused, finished, bounced, hard_bounced, spam_blocked, not_sent. Values may be "loading" on newly created sequences.',
    ),
});

export const SequenceStepSchema = z.object({
  id: z.string().describe('Step ID'),
  emailer_campaign_id: z.string().optional().describe('Parent sequence ID'),
  type: SequenceStepTypeParam.optional().describe('Step type'),
  priority: StepPriorityParam.optional().describe('Step priority'),
  position: z.number().optional().describe('Step position in sequence'),
  wait_time: z.number().optional().describe('Wait time before this step'),
  wait_mode: WaitModeParam.optional().describe('Wait time unit'),
  note: z.string().nullable().optional().describe('Step note'),
});

export const EmailTemplateSchema = z.object({
  id: z.string().describe('Template ID'),
  name: z.string().optional().describe('Template name'),
  subject: z.string().optional().describe('Email subject line'),
  body_html: z.string().optional().describe('Email body HTML'),
  body_text: z.string().optional().describe('Email body plain text'),
  archived: z.boolean().optional().describe('Whether the template is archived'),
  created_at: z.string().optional().describe('Creation timestamp'),
  folder_id: z.string().optional().describe('Folder ID'),
  user_id: z.string().optional().describe('Owner user ID'),
});

export const EmailTemplateFolderSchema = z.object({
  id: z.string().describe('Folder ID'),
  name: z.string().optional().describe('Folder name'),
});

export const DealSchema = z.object({
  id: z.string().describe('Deal/opportunity ID'),
  name: z.string().nullable().optional().describe('Deal name'),
  amount: z.number().nullable().optional().describe('Deal amount'),
  closed_date: z.string().nullable().optional().describe('Expected close date'),
  account_id: z
    .string()
    .nullable()
    .optional()
    .describe('Associated account ID'),
  description: z.string().nullable().optional().describe('Deal description'),
  is_closed: z
    .boolean()
    .nullable()
    .optional()
    .describe('Whether the deal is closed'),
  is_won: z.boolean().nullable().optional().describe('Whether the deal is won'),
  stage_name: z.string().nullable().optional().describe('Current stage name'),
  opportunity_stage_id: z.string().nullable().optional().describe('Stage ID'),
  source: z.string().nullable().optional().describe('Deal source'),
  owner_id: z.string().nullable().optional().describe('Owner user ID'),
  created_at: z.string().optional().describe('Creation timestamp'),
  next_step: z.string().nullable().optional().describe('Next step description'),
  next_step_date: z.string().nullable().optional().describe('Next step date'),
  closed_lost_reason: z
    .string()
    .nullable()
    .optional()
    .describe('Reason for closed-lost'),
  closed_won_reason: z
    .string()
    .nullable()
    .optional()
    .describe('Reason for closed-won'),
  forecast_category: z
    .string()
    .nullable()
    .optional()
    .describe('Forecast category'),
  deal_probability: z
    .number()
    .nullable()
    .optional()
    .describe('Deal probability percentage'),
  probability: z
    .number()
    .nullable()
    .optional()
    .describe('Probability percentage'),
  opportunity_pipeline_id: z
    .string()
    .nullable()
    .optional()
    .describe('Pipeline ID'),
  currency: z
    .union([
      z.string(),
      z.object({
        name: z.string().optional(),
        iso_code: z.string().optional(),
        symbol: z.string().optional(),
      }),
    ])
    .nullable()
    .optional()
    .describe(
      'Currency info (object with name, iso_code, symbol in responses; string code in inputs)',
    ),
  num_contacts: z.number().optional().describe('Number of associated contacts'),
  typed_custom_fields: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Custom field values'),
});

export const DealStageSchema = z.object({
  id: z.string().describe('Stage ID'),
  name: z.string().optional().describe('Stage name'),
  display_order: z.number().optional().describe('Display order in pipeline'),
  forecast_category_cd: z
    .string()
    .optional()
    .describe('Forecast category code (Omitted, Pipeline, Best Case, Closed)'),
  is_won: z
    .boolean()
    .optional()
    .describe('Whether this stage represents a win'),
  is_closed: z
    .boolean()
    .optional()
    .describe('Whether this stage represents closure'),
  probability: z
    .number()
    .optional()
    .describe('Default probability for this stage'),
  description: z.string().optional().describe('Stage description'),
  opportunity_pipeline_id: z.string().optional().describe('Parent pipeline ID'),
  type: z
    .string()
    .optional()
    .describe('Stage type (Open, Closed/Won, Closed/Lost)'),
  is_editable: z
    .boolean()
    .optional()
    .describe('Whether this stage can be edited'),
});

export const DealPipelineSchema = z.object({
  id: z.string().describe('Pipeline ID'),
  title: z.string().optional().describe('Pipeline name'),
  team_id: z.string().optional().describe('Team ID'),
  source: z.string().optional().describe('Pipeline source'),
  default_pipeline: z
    .boolean()
    .optional()
    .describe('Whether this is the default pipeline'),
});

export const TaskSchema = z.object({
  id: z.string().describe('Task ID'),
  user_id: z.string().optional().describe('Assigned user ID'),
  type: z
    .string()
    .optional()
    .describe('Task type (action_item, call, linkedin, email)'),
  priority: z.string().optional().describe('Priority (high, medium, low)'),
  status: z.string().optional().describe('Status (scheduled, complete)'),
  note: z.string().optional().describe('Task note/description'),
  due_at: z.string().optional().describe('Due date timestamp'),
  completed_at: z.string().optional().describe('Completion timestamp'),
  created_at: z.string().optional().describe('Creation timestamp'),
  contact_id: z.string().optional().describe('Associated contact ID'),
  person_id: z.string().optional().describe('Associated person ID'),
  account_id: z.string().optional().describe('Associated account ID'),
  opportunity_id: z
    .string()
    .optional()
    .describe('Associated opportunity/deal ID'),
  subject: z.string().optional().describe('Task subject'),
  title: z.string().optional().describe('Task title'),
});

export const NoteSchema = z.object({
  id: z.string().describe('Note ID'),
  user_id: z.string().optional().describe('Author user ID'),
  content: z
    .string()
    .nullable()
    .optional()
    .describe('Note content (plain text or TipTap JSON)'),
  created_at: z.string().optional().describe('Creation timestamp'),
  updated_at: z.string().optional().describe('Last updated timestamp'),
  contact_id: z
    .string()
    .nullable()
    .optional()
    .describe('Associated contact ID (deprecated, use contact_ids)'),
  account_id: z
    .string()
    .nullable()
    .optional()
    .describe('Associated account ID (deprecated, use account_ids)'),
  opportunity_id: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Associated opportunity/deal ID (deprecated, use opportunity_ids)',
    ),
  contact_ids: z
    .array(z.string())
    .optional()
    .describe('Associated contact IDs'),
  account_ids: z
    .array(z.string())
    .optional()
    .describe('Associated account IDs'),
  opportunity_ids: z
    .array(z.string())
    .optional()
    .describe('Associated opportunity/deal IDs'),
  pinned_to_top: z.boolean().optional().describe('Whether note is pinned'),
});

export const ContactStageSchema = z.object({
  id: z.string().describe('Stage ID'),
  name: z.string().describe('Stage name'),
  display_name: z.string().describe('Display name'),
  display_order: z.number().describe('Display order'),
  category: z
    .enum(['in_progress', 'succeeded', 'failed'])
    .nullable()
    .describe('Stage category'),
  team_id: z.string().optional().describe('Team ID'),
  is_meeting_set: z
    .boolean()
    .nullable()
    .optional()
    .describe('Whether meeting is set'),
  ignore_trigger_override: z
    .boolean()
    .nullable()
    .optional()
    .describe('Whether to ignore trigger override'),
});

export const AccountStageSchema = z.object({
  id: z.string().describe('Stage ID'),
  name: z.string().describe('Stage name'),
  display_name: z.string().describe('Display name'),
  display_order: z.number().describe('Display order'),
  category: z.string().nullable().describe('Stage category'),
  default_exclude_for_leadgen: z
    .boolean()
    .describe('Whether excluded from lead generation by default'),
  team_id: z.string().optional().describe('Team ID'),
  is_meeting_set: z
    .boolean()
    .nullable()
    .optional()
    .describe('Whether meeting is set'),
});

export const FieldSchema = z
  .object({
    id: z.string().describe('Field ID (e.g. "opportunity.name")'),
    field_name: z
      .string()
      .describe('Dotted field path used in API filters and display'),
    label: z.string().describe('Human-readable label shown in UI'),
    type: z
      .string()
      .describe('Field type (text, number, date, picklist, etc.)'),
    modality: z
      .string()
      .nullable()
      .describe('"contact", "account", "opportunity", or null'),
    source: z
      .enum(['system', 'custom'])
      .describe('Whether this is a built-in or custom field'),
    picklist_values: z
      .array(
        z.object({
          value: z.string(),
          label: z.string().optional(),
        }),
      )
      .optional()
      .describe('Allowed values for picklist-type fields'),
  })
  .passthrough()
  .describe('A field definition (system or custom)');

export const FieldGroupSchema = z
  .object({
    id: z.string().describe('Group ID'),
    name: z.string().describe('Group name shown in UI'),
    modality: z.string().describe('"contact", "account", or "opportunity"'),
    fields: z.array(z.string()).describe('Field IDs in this group'),
  })
  .passthrough();

export const UserSchema = z.object({
  id: z.string().describe('User ID'),
  name: z.string().describe('Full name'),
  email: z.string().describe('Email address'),
  role: z.string().describe('User role'),
});

export const DeliverabilityScoreSchema = z
  .object({
    open_rate: z.number().optional().describe('Email open rate (0-1)'),
    click_rate: z.number().optional().describe('Link click rate (0-1)'),
    reply_rate: z.number().optional().describe('Reply rate (0-1)'),
    bounce_rate: z.number().optional().describe('Bounce rate (0-1)'),
    spam_block_rate: z.number().optional().describe('Spam block rate (0-1)'),
    opt_out_rate: z.number().optional().describe('Unsubscribe rate (0-1)'),
    total_sent: z
      .number()
      .optional()
      .describe('Total emails sent from this account'),
    total_opens: z.number().optional().describe('Total opens'),
    total_clicks: z.number().optional().describe('Total clicks'),
    total_replies: z.number().optional().describe('Total replies'),
    total_bounces: z.number().optional().describe('Total bounces'),
    total_spam_blocks: z.number().optional().describe('Total spam blocks'),
    total_opt_outs: z.number().optional().describe('Total unsubscribes'),
  })
  .passthrough();

export const EmailAccountSchema = z
  .object({
    id: z.string().describe('Email account ID'),
    email: z.string().describe('Email address'),
    type: z.string().describe('Account type'),
    active: z.boolean().optional().describe('Whether account is active'),
    default: z
      .boolean()
      .optional()
      .describe('Whether this is the default sending account'),
    aliases: z.array(z.string()).optional().describe('Email aliases'),
    provider_display_name: z
      .string()
      .optional()
      .describe('Provider name (Gmail, Outlook, etc.)'),
    email_daily_threshold: z.number().optional().describe('Max emails per day'),
    max_outbound_emails_per_hour: z
      .number()
      .optional()
      .describe('Max emails per hour'),
    seconds_delay_between_emails: z
      .number()
      .optional()
      .describe('Delay between sends (seconds)'),
    limits_editable: z
      .boolean()
      .optional()
      .describe('Whether sending limits can be changed'),
    revoked_at: z
      .string()
      .nullable()
      .optional()
      .describe('When account access was revoked'),
    inactive_reason: z
      .string()
      .nullable()
      .optional()
      .describe('Reason account is inactive'),
    last_synced_at: z
      .string()
      .optional()
      .describe('Last mailbox sync timestamp'),
    created_at: z.string().optional().describe('Account creation timestamp'),
    signature_html: z
      .string()
      .nullable()
      .optional()
      .describe('HTML email signature'),
    deliverability_score: DeliverabilityScoreSchema.optional().describe(
      'Deliverability metrics',
    ),
    is_free_domain: z
      .boolean()
      .optional()
      .describe('Whether email is on a free domain (Gmail, Yahoo, etc.)'),
    active_campaigns_count: z
      .number()
      .optional()
      .describe('Number of active sequences using this account'),
    mailwarming_status: z
      .string()
      .nullable()
      .optional()
      .describe('Email warmup status'),
    mailwarming_score: z
      .number()
      .nullable()
      .optional()
      .describe('Email warmup score'),
    true_warmup_enabled: z
      .boolean()
      .optional()
      .describe('Whether TrueWarmup is enabled'),
    true_warmup_status: z
      .string()
      .nullable()
      .optional()
      .describe('TrueWarmup status'),
    true_warmup_daily_limit: z
      .number()
      .nullable()
      .optional()
      .describe('TrueWarmup daily send limit'),
    true_warmup_progress: z
      .number()
      .nullable()
      .optional()
      .describe('TrueWarmup progress percentage'),
  })
  .passthrough();

export const SequenceScheduleSchema = z.object({
  id: z.string().describe('Schedule ID'),
  name: z.string().describe('Schedule name'),
  default: z
    .boolean()
    .optional()
    .describe('Whether this is the default schedule'),
  time_zone: z.string().describe('Time zone for the schedule'),
  schedule_hash: z
    .record(z.string(), z.array(z.array(z.number())))
    .optional()
    .describe('Send windows per day'),
  use_contacts_time_zone: z
    .boolean()
    .optional()
    .describe('Use contact time zones'),
  skip_holidays: z.boolean().optional().describe('Skip holidays'),
});

// ============================================================================
// Context Acquisition Schemas
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description: 'Get Apollo session context and user information',
  notes: 'Call FIRST before any other Apollo operations.',
  input: z.object({}),
  output: z.object({
    success: z.boolean().describe('Whether the request succeeded'),
    isLoggedIn: z.boolean().describe('Whether user is logged in'),
    currentUrl: z.string().describe('Current page URL'),
    userId: z.string().optional().describe('Current user ID'),
    teamId: z.string().optional().describe('Current team/organization ID'),
    isCore: z
      .boolean()
      .optional()
      .describe('Whether this is a core/internal account'),
    featureFlagCount: z
      .number()
      .optional()
      .describe('Number of feature flags configured'),
    assistantEnabled: z
      .boolean()
      .optional()
      .describe('Whether assistant is enabled'),
    error: z.string().optional().describe('Error message if request failed'),
  }),
};

// ============================================================================
// Search Schemas (People & Companies)
// ============================================================================

export const searchPeopleSchema = {
  name: 'searchPeople',
  description:
    'Search and filter people. Also use this to look up a specific person by name: pass q_person_name and q_organization_name in filters.',
  notes:
    'To look up a specific person: use filters { q_person_name: "Name", q_organization_name: "Company" } with perPage: 5. ALWAYS include q_organization_name to disambiguate; common names return many false matches. Results include full person details with embedded company data. NOTE: Results do NOT include technology stack data even when using technology filters; technology filters narrow results but the returned person/org objects omit which technologies matched. Use viewCompany() separately to verify a company\'s tech stack. Technology UIDs (currently_using_any_of_technology_uids) are validated automatically; invalid UIDs throw an error. Use searchFilterTags({ kind: "technology", query: "..." }) to find valid UIDs.',
  input: z.object({
    keyword: z.string().optional().describe('Search keyword (name, etc.)'),
    mode: ModeParam.optional().default('total'),
    page: z
      .number()
      .optional()
      .default(1)
      .describe('Results page number (default: 1)'),
    perPage: z
      .number()
      .optional()
      .default(25)
      .describe(
        'Results per page (max 25, higher values return empty results)',
      ),
    filters: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        `Search filters (all optional, pass as object keys). Call getFilterFields() for the full list of 382+ available filter keys.
- q_person_name: string: person name lookup (e.g. "Satya Nadella"). Pair with q_organization_name to disambiguate.
- person_titles: string[]: job titles (e.g. ["CIO", "Chief Information Officer"])
- person_seniorities: string[]: "owner" | "founder" | "c_suite" | "partner" | "vp" | "head" | "director" | "manager" | "senior" | "entry" | "intern"
- person_locations: string[]: locations (e.g. ["San Francisco, CA", "United States"])
- person_department_or_subdepartments: string[]: departments (e.g. ["engineering", "sales", "marketing"]). Call getFilterOptions() to see all 211 valid department values.
- q_organization_name: string: company name search
- organization_num_employees_ranges: string[]: employee count ranges as "min,max". Accepts arbitrary ranges (e.g. "500,2000") or standard UI buckets: "1,10" | "11,20" | "21,50" | "51,200" | "201,500" | "501,1000" | "1001,2000" | "2001,5000" | "5001,10000" | "10001," (10001+ employees). When the user specifies a custom range like "500 to 2000 employees", pass exactly ["500,2000"]; do NOT split into UI buckets.
- organization_locations: string[]: company HQ locations
- organization_ids: string[]: specific organization IDs. To filter by company domain, first call searchCompanies({ keyword: "domain.com" }) to resolve the domain to an organization_id, then pass it here. The field organization_domains does NOT exist and is silently ignored.
- organization_latest_funding_stage_cd: string[]: numeric string codes: "0"=Seed, "1"=Angel, "2"=Series A, "3"=Series B, "4"=Series C, "5"=Series D, "6"=Series E, "7"=Series F, "10"=Venture, "11"=PE, "12"=Other
- contact_email_status: string[]: "verified" | "guessed" | "unavailable" | "bounced"
- q_keywords: string: keyword search
- currently_using_any_of_technology_uids: string[]: technology UIDs (find IDs via searchFilterTags({ kind: "technology", query: "..." })). Validated automatically; invalid UIDs throw an error.
- organization_linkedin_industry_tag_ids: string[]: industry tag IDs (find IDs via searchFilterTags({ kind: "linkedin_industry", query: "..." }))`,
      ),
  }),
  output: z.object({
    people: z
      .array(PersonSchema)
      .optional()
      .describe('Net-new people (if mode is total or net-new)'),
    contacts: z
      .array(PersonSchema)
      .optional()
      .describe('Saved contacts (if mode is total or saved)'),
    pagination: PaginationSchema.optional().describe('Pagination metadata'),
  }),
};

export const searchCompaniesSchema = {
  name: 'searchCompanies',
  description: 'Search companies/organizations by keyword and filters',
  notes: '',
  input: z.object({
    keyword: z.string().optional().describe('Search keyword'),
    mode: ModeParam.optional().default('total'),
    page: z
      .number()
      .optional()
      .default(1)
      .describe('Results page number (default: 1)'),
    perPage: z
      .number()
      .optional()
      .default(25)
      .describe(
        'Results per page (max 25, higher values return empty results)',
      ),
    filters: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        `Search filters (all optional, pass as key-value pairs):
- q_organization_name: string: company name search
- organization_locations: string[]: e.g. ["United States", "California, US"]
- organization_not_locations: string[]: exclude locations
- organization_num_employees_ranges: string[]: e.g. ["1,10", "11,20", "21,50", "51,100", "101,200", "201,500", "501,1000", "1001,2000", "2001,5000", "5001,10000", "10001,"]
- organization_latest_funding_stage_cd: string[]: funding stage codes: "0"=Seed, "1"=Angel, "2"=Series A, "3"=Series B, "4"=Series C, "5"=Series D, "6"=Series E, "7"=Series F, "10"=Venture, "11"=PE, "12"=Other, "13"=Debt, "14"=Equity Crowdfunding, "15"=Convertible Note, "16"=M&A
- revenue_range: { min: number, max: number }: annual revenue in dollars
- total_funding_range: { min: number, max: number }: total funding in dollars
- organization_headcount_growth: { min: number, max: number }: e.g. { min: 0.1, max: 1.0 } for 10-100% growth
- organization_linkedin_industry_tag_ids: string[]: LinkedIn industry IDs (use getFilterOptions to discover)
- currently_using_any_of_technology_uids: string[]: technology UIDs (find IDs via searchFilterTags({ kind: "technology", query: "..." })). Validated automatically; invalid UIDs throw an error.
- not_currently_using_any_of_technology_uids: string[]: exclude technologies (validated automatically)
- organization_sic_codes: string[]: SIC codes
- organization_naics_codes: string[]: NAICS codes
- q_organization_keyword_tags: string[]: keyword tags
- organization_trading_status: string[]: e.g. ["public", "private"]
- q_lookalike_target_organization_ids: string[]: find companies similar to given org IDs
- q_organization_job_titles: string[]: companies with employees having these titles
- organization_founded_year_range: { min: number, max: number }: founded year range`,
      ),
  }),
  output: z.object({
    organizations: z
      .array(CompanySchema)
      .optional()
      .describe('Net-new organizations (if mode is total or net-new)'),
    accounts: z
      .array(CompanySchema)
      .optional()
      .describe('Saved accounts (if mode is total or saved)'),
    pagination: PaginationSchema.optional().describe('Pagination metadata'),
  }),
};

// ============================================================================
// Contacts Schemas (Select & CRUD)
// ============================================================================

export const selectPeopleSchema = {
  name: 'selectPeople',
  description: 'Collect multiple people IDs from search results',
  notes:
    'Returns person IDs from Apollo global database. To add to a sequence, first save them via addContactsToList(), then use the returned savedContactIds.',
  input: z.object({
    filters: z
      .record(z.string(), z.unknown())
      .optional()
      .default({})
      .describe(
        `Search filters (all optional, pass as object keys). Call getFilterFields() for the full list of 382+ available filter keys.
- q_person_name: string: person name lookup (e.g. "Satya Nadella"). Pair with q_organization_name to disambiguate.
- person_titles: string[]: job titles (e.g. ["CIO", "Chief Information Officer"])
- person_seniorities: string[]: "owner" | "founder" | "c_suite" | "partner" | "vp" | "head" | "director" | "manager" | "senior" | "entry" | "intern"
- person_locations: string[]: locations (e.g. ["San Francisco, CA", "United States"])
- person_department_or_subdepartments: string[]: departments (e.g. ["engineering", "sales", "marketing"]). Call getFilterOptions() to see all 211 valid department values.
- q_organization_name: string: company name search
- organization_num_employees_ranges: string[]: employee count ranges as "min,max". Accepts arbitrary ranges (e.g. "500,2000") or standard UI buckets: "1,10" | "11,20" | "21,50" | "51,200" | "201,500" | "501,1000" | "1001,2000" | "2001,5000" | "5001,10000" | "10001," (10001+ employees). When the user specifies a custom range like "500 to 2000 employees", pass exactly ["500,2000"]; do NOT split into UI buckets.
- organization_locations: string[]: company HQ locations
- organization_ids: string[]: specific organization IDs. To filter by company domain, first call searchCompanies({ keyword: "domain.com" }) to resolve the domain to an organization_id, then pass it here. The field organization_domains does NOT exist and is silently ignored.
- organization_latest_funding_stage_cd: string[]: numeric string codes: "0"=Seed, "1"=Angel, "2"=Series A, "3"=Series B, "4"=Series C, "5"=Series D, "6"=Series E, "7"=Series F, "10"=Venture, "11"=PE, "12"=Other
- contact_email_status: string[]: "verified" | "guessed" | "unavailable" | "bounced"
- q_keywords: string: keyword search
- currently_using_any_of_technology_uids: string[]: technology UIDs (find IDs via searchFilterTags({ kind: "technology", query: "..." })). Validated automatically; invalid UIDs throw an error.
- organization_linkedin_industry_tag_ids: string[]: industry tag IDs (find IDs via searchFilterTags({ kind: "linkedin_industry", query: "..." }))`,
      ),
    maxCount: z
      .number()
      .optional()
      .default(25)
      .describe('Maximum number of people to collect (default: 25)'),
    perPage: z
      .number()
      .optional()
      .default(25)
      .describe(
        'Results per page (max 25, higher values return empty results)',
      ),
  }),
  output: z.object({
    ids: z.array(z.string()).describe('Array of person IDs'),
    people: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          title: z.string(),
          company: z.string(),
        }),
      )
      .describe('Array of person objects with id, name, title, company'),
    totalCollected: z.number().describe('Total number of people collected'),
  }),
};

export const createContactSchema = {
  name: 'createContact',
  description: 'Create a new contact in Apollo',
  notes:
    'phone_number is accepted but may not save via this endpoint. Use updateContact after creation to set phone. Last names get auto-capitalized by Apollo.',
  input: z.object({
    first_name: z.string().describe('First name'),
    last_name: z.string().describe('Last name'),
    email: z.string().optional().describe('Email address'),
    title: z.string().optional().describe('Job title'),
    organization_name: z.string().optional().describe('Company name'),
    phone_number: z.string().optional().describe('Phone number'),
    linkedin_url: z
      .string()
      .optional()
      .describe(
        'LinkedIn profile URL (e.g. "https://www.linkedin.com/in/username")',
      ),
    city: z.string().optional().describe('City'),
    state: z.string().optional().describe('State'),
    country: z.string().optional().describe('Country'),
    label_names: z
      .array(z.string())
      .optional()
      .describe('List names to add contact to'),
    contact_stage_id: z.string().optional().describe('Contact stage ID'),
  }),
  output: z.object({
    contact: z
      .record(z.string(), z.unknown())
      .describe(
        'Created contact. Key fields: id, first_name, last_name, name, email, title, organization_name, contact_stage_id, city, state, country, created_at',
      ),
    labels: z
      .array(z.record(z.string(), z.unknown()))
      .describe('Associated labels'),
  }),
};

export const updateContactSchema = {
  name: 'updateContact',
  description: 'Update an existing contact in Apollo',
  notes: '',
  input: z.object({
    id: z.string().describe('Contact ID'),
    first_name: z.string().optional().describe('First name'),
    last_name: z.string().optional().describe('Last name'),
    email: z.string().optional().describe('Email address'),
    title: z.string().optional().describe('Job title'),
    organization_name: z.string().optional().describe('Company name'),
    phone_number: z.string().optional().describe('Phone number'),
    city: z.string().optional().describe('City'),
    state: z.string().optional().describe('State'),
    country: z.string().optional().describe('Country'),
    label_names: z.array(z.string()).optional().describe('List names'),
    contact_stage_id: z.string().optional().describe('Contact stage ID'),
  }),
  output: z.object({
    contact: z
      .record(z.string(), z.unknown())
      .describe(
        'Updated contact. Key fields: id, first_name, last_name, name, email, title, organization_name, contact_stage_id, city, state, country',
      ),
    labels: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe('Associated labels/lists'),
  }),
};

export const deleteContactSchema = {
  name: 'deleteContact',
  description: 'Delete a contact from Apollo',
  notes: '',
  input: z.object({
    id: z.string().describe('Contact ID'),
  }),
  output: z.object({
    success: z.literal(true).describe('Whether the deletion succeeded'),
  }),
};

export const updateContactStageSchema = {
  name: 'updateContactStage',
  description: "Update a contact's stage",
  notes: 'Use listContactStages() to get valid stage IDs.',
  input: z.object({
    id: z.string().describe('Contact ID'),
    contact_stage_id: z.string().describe('New contact stage ID'),
  }),
  output: z.object({
    contact: z
      .record(z.string(), z.unknown())
      .describe('Updated contact object'),
    labels: z.array(z.unknown()).describe('Contact labels/tags'),
  }),
};

export const listContactStagesSchema = {
  name: 'listContactStages',
  description: 'List all contact stages in Apollo',
  notes: '',
  input: z.object({}),
  output: z.object({
    contact_stages: z
      .array(ContactStageSchema)
      .describe('Array of contact stages'),
  }),
};

// ============================================================================
// Companies Schemas (View & CRUD)
// ============================================================================

export const selectCompaniesSchema = {
  name: 'selectCompanies',
  description: 'Collect multiple company IDs from search results',
  notes: '',
  input: z.object({
    filters: z
      .record(z.string(), z.unknown())
      .optional()
      .default({})
      .describe(
        'Search filters: same as searchCompanies filters (organization_locations, organization_num_employees_ranges, organization_latest_funding_stage_cd, revenue_range, currently_using_any_of_technology_uids, q_organization_keyword_tags, etc.). See searchCompanies for full list.',
      ),
    maxCount: z
      .number()
      .optional()
      .default(25)
      .describe('Maximum number of companies to collect (default: 25)'),
    perPage: z
      .number()
      .optional()
      .default(25)
      .describe('Results per page (default: 25)'),
  }),
  output: z.object({
    ids: z.array(z.string()).describe('Array of company IDs'),
    companies: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          website: z.string(),
          industry: z.string(),
        }),
      )
      .describe('Array of company objects with id, name, website, industry'),
    totalCollected: z.number().describe('Total number of companies collected'),
  }),
};

export const viewCompanySchema = {
  name: 'viewCompany',
  description:
    'Get detailed information for a single company/organization by ID or name search',
  notes:
    'Provide one of: organizationId (global org database), accountId (CRM account), or searchName (name search).',
  input: z.object({
    accountId: z
      .string()
      .optional()
      .describe('CRM account ID for direct lookup'),
    organizationId: z
      .string()
      .optional()
      .describe(
        'Organization ID for direct lookup (global org database, richer data)',
      ),
    searchName: z.string().optional().describe('Search for company by name'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the lookup succeeded'),
    company: CompanySchema.optional().describe('Company/organization details'),
    error: z.string().optional().describe('Error message if lookup failed'),
    accountId: z.string().optional().describe('Account ID used for lookup'),
    organizationId: z
      .string()
      .optional()
      .describe('Organization ID used for lookup'),
    searchName: z.string().optional().describe('Search name used'),
  }),
};

export const createAccountSchema = {
  name: 'createAccount',
  description: 'Create a new account in Apollo',
  notes:
    'Domain is truncated to root domain (subdomains stripped). phone_number, city, state, country, and industry may not save via this endpoint; use updateAccount after creation if needed.',
  input: z.object({
    name: z.string().describe('Account/company name'),
    domain: z.string().optional().describe('Company domain'),
    phone_number: z.string().optional().describe('Phone number'),
    industry: z.string().optional().describe('Industry'),
    city: z.string().optional().describe('City'),
    state: z.string().optional().describe('State'),
    country: z.string().optional().describe('Country'),
  }),
  output: z.object({
    account: z
      .record(z.string(), z.unknown())
      .describe(
        'Created account. Key fields: id, name, domain, account_stage_id, phone, created_at, owner_id',
      ),
  }),
};

export const updateAccountSchema = {
  name: 'updateAccount',
  description: 'Update an existing account in Apollo',
  notes: '',
  input: z.object({
    id: z.string().describe('Account ID'),
    name: z.string().optional().describe('Account/company name'),
    domain: z.string().optional().describe('Company domain'),
    phone_number: z.string().optional().describe('Phone number'),
    industry: z.string().optional().describe('Industry'),
    city: z.string().optional().describe('City'),
    state: z.string().optional().describe('State'),
    country: z.string().optional().describe('Country'),
  }),
  output: z.object({
    account: z
      .record(z.string(), z.unknown())
      .describe(
        'Updated account. Key fields: id, name, domain, account_stage_id, phone, owner_id',
      ),
    labels: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe('Associated labels/lists'),
  }),
};

export const deleteAccountSchema = {
  name: 'deleteAccount',
  description: 'Delete an account from Apollo',
  notes: '',
  input: z.object({
    id: z.string().describe('Account ID'),
  }),
  output: z.object({
    success: z.literal(true).describe('Whether the deletion succeeded'),
  }),
};

export const updateAccountStageSchema = {
  name: 'updateAccountStage',
  description: "Update an account's stage",
  notes: 'Use listAccountStages() to get valid stage IDs.',
  input: z.object({
    id: z.string().describe('Account ID'),
    account_stage_id: z.string().describe('New account stage ID'),
  }),
  output: z.object({
    account: z
      .record(z.string(), z.unknown())
      .describe('Updated account object'),
    labels: z.array(z.unknown()).describe('Account labels/tags'),
  }),
};

export const listAccountStagesSchema = {
  name: 'listAccountStages',
  description: 'List all account stages in Apollo',
  notes: '',
  input: z.object({}),
  output: z.object({
    account_stages: z
      .array(AccountStageSchema)
      .describe('Array of account stages'),
  }),
};

// ============================================================================
// Lists (Labels) Schemas
// ============================================================================

export const createListSchema = {
  name: 'createList',
  description: 'Create a new empty list in Apollo',
  notes:
    'Creates an empty list. Prefer using addContactsToList() or addCompaniesToList() directly - they auto-create the list if it does not exist.',
  input: z.object({
    name: z.string().describe('Name of the list'),
    modality: ModalityParam.optional().default('contacts'),
  }),
  output: z.object({
    id: z.string().describe('List ID'),
    name: z.string().describe('List name'),
    modality: ModalityParam.describe('List type'),
  }),
};

export const viewListsSchema = {
  name: 'viewLists',
  description: 'View all saved lists in Apollo',
  notes: '',
  input: z.object({
    modality: ModalityParam.optional().describe(
      'Filter by list type (omit for all types)',
    ),
    page: z.number().optional().default(1).describe('Page number (default: 1)'),
    perPage: z
      .number()
      .optional()
      .default(100)
      .describe('Results per page (default: 100)'),
  }),
  output: z.object({
    labels: z.array(LabelSchema).describe('Array of list objects'),
    pagination: PaginationSchema.optional().describe('Pagination metadata'),
  }),
};

export const addContactsToListSchema = {
  name: 'addContactsToList',
  description:
    'Add contacts/people to a list by name. Creates the list if it does not exist.',
  notes:
    'Saves people to your Apollo CRM and adds them to a list. Returns savedContactIds (the CRM contact IDs needed for addContactsToSequence()). Also returns listId for use with getContactsInList() and removeContactsFromList(). Use selectPeople() first to get person IDs. COSTS CREDITS: each contact saved consumes 1 Apollo credit. Throws with credit details if insufficient credits. Note: getContactsInList() may return empty for ~2 seconds after this call due to eventual consistency. For large batches (100+ contacts), this function processes in batches of 25 with a 3-second delay between batches to avoid Apollo 422 errors; expect ~3s per 25 contacts.',
  input: z.object({
    listName: z.string().describe('Name of the list to add contacts to'),
    contactIds: z
      .array(z.string())
      .describe('Array of person/contact IDs to add'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    addedCount: z.number().describe('Number of contacts added'),
    listName: z.string().describe('List name'),
    listId: z
      .string()
      .describe(
        'List ID: pass to getContactsInList() or removeContactsFromList()',
      ),
    contactIds: z.array(z.string()).describe('Input person/contact IDs'),
    savedContactIds: z
      .array(z.string())
      .describe(
        'CRM contact IDs returned by Apollo. Use these for addContactsToSequence().',
      ),
  }),
};

export const addCompaniesToListSchema = {
  name: 'addCompaniesToList',
  description:
    'Add companies/accounts to a list by name. Creates the list if it does not exist.',
  notes:
    'Also saves net-new companies to CRM. Use selectCompanies() first to get IDs. Returns savedAccountIds and listId for use with getAccountsInList() and removeCompaniesFromList(). Note: getAccountsInList() may return empty for ~2 seconds after this call due to eventual consistency.',
  input: z.object({
    listName: z.string().describe('Name of the list to add companies to'),
    companyIds: z
      .array(z.string())
      .describe('Array of company/organization IDs to add'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    addedCount: z.number().describe('Number of companies added'),
    listName: z.string().describe('List name'),
    listId: z
      .string()
      .describe(
        'List ID: pass to getAccountsInList() or removeCompaniesFromList()',
      ),
    companyIds: z.array(z.string()).describe('Input company IDs'),
    savedAccountIds: z
      .array(z.string())
      .describe(
        'CRM account IDs returned by Apollo. Use these for removeCompaniesFromList().',
      ),
  }),
};

export const updateListSchema = {
  name: 'updateList',
  description: 'Rename a list',
  notes: '',
  input: z.object({
    id: z.string().describe('List (label) ID'),
    name: z.string().describe('New name for the list'),
  }),
  output: z.object({
    id: z.string().describe('List ID'),
    name: z.string().describe('Updated list name'),
    modality: z.string().describe('List type (contacts or accounts)'),
  }),
};

export const deleteListSchema = {
  name: 'deleteList',
  description: 'Delete a list from Apollo',
  notes: '',
  input: z.object({
    id: z.string().describe('List (label) ID'),
  }),
  output: z.object({
    success: z.literal(true).describe('Whether the deletion succeeded'),
  }),
};

export const removeContactsFromListSchema = {
  name: 'removeContactsFromList',
  description: 'Remove contacts from a list',
  notes: '',
  input: z.object({
    listId: z
      .string()
      .describe('List ID (from viewLists or addContactsToList)'),
    contactIds: z.array(z.string()).describe('Array of contact IDs to remove'),
  }),
  output: z.object({
    success: z.literal(true).describe('Whether the removal succeeded'),
  }),
};

export const removeCompaniesFromListSchema = {
  name: 'removeCompaniesFromList',
  description: 'Remove companies/accounts from a list',
  notes: '',
  input: z.object({
    listId: z
      .string()
      .describe('List ID (from viewLists or addCompaniesToList)'),
    accountIds: z.array(z.string()).describe('Array of account IDs to remove'),
  }),
  output: z.object({
    success: z.literal(true).describe('Whether the removal succeeded'),
  }),
};

export const getContactsInListSchema = {
  name: 'getContactsInList',
  description: 'Get contacts in a list by list ID. Returns CRM contact IDs.',
  notes:
    'Use viewLists() to find the list ID. The returned contactIds can be passed to addContactsToSequence().',
  input: z.object({
    listId: z
      .string()
      .describe('List ID (from viewLists or addContactsToList)'),
    page: z.number().optional().default(1).describe('Page number (default: 1)'),
    perPage: z
      .number()
      .optional()
      .default(25)
      .describe('Results per page (default: 25)'),
  }),
  output: z.object({
    contacts: z
      .array(
        z.object({
          id: z.string().describe('CRM contact ID'),
          name: z.string().describe('Full name'),
          title: z.string().describe('Job title'),
          company: z.string().describe('Company name'),
          email: z.string().describe('Email address'),
        }),
      )
      .describe('Contacts in the list'),
    contactIds: z
      .array(z.string())
      .describe('Array of CRM contact IDs (pass to addContactsToSequence)'),
    pagination: PaginationSchema.optional().describe('Pagination metadata'),
  }),
};

export const getAccountsInListSchema = {
  name: 'getAccountsInList',
  description:
    'Get accounts/companies in a list by list ID. Returns CRM account IDs.',
  notes:
    'Use viewLists() to find the list ID. The returned accountIds can be passed to removeCompaniesFromList().',
  input: z.object({
    listId: z
      .string()
      .describe('List ID (from viewLists or addCompaniesToList)'),
    page: z.number().optional().default(1).describe('Page number (default: 1)'),
    perPage: z
      .number()
      .optional()
      .default(25)
      .describe('Results per page (default: 25)'),
  }),
  output: z.object({
    accounts: z
      .array(
        z.object({
          id: z.string().describe('CRM account ID'),
          name: z.string().describe('Company name'),
          domain: z.string().describe('Company domain'),
          industry: z.string().describe('Industry'),
        }),
      )
      .describe('Accounts in the list'),
    accountIds: z
      .array(z.string())
      .describe('Array of CRM account IDs (pass to removeCompaniesFromList)'),
    pagination: PaginationSchema.optional().describe('Pagination metadata'),
  }),
};

// ============================================================================
// Sequences (Campaigns) Schemas
// ============================================================================

export const searchSequencesSchema = {
  name: 'searchSequences',
  description:
    'Search sequences (emailer campaigns) with pagination and sorting',
  notes:
    'Default returns active and inactive sequences (not archived). Pass status="archived" to list archived sequences.',
  input: z.object({
    page: z.number().optional().default(1).describe('Page number (default: 1)'),
    perPage: z
      .number()
      .optional()
      .default(25)
      .describe('Results per page (default: 25)'),
    sortByField: z
      .string()
      .optional()
      .default('created_at')
      .describe('Field to sort by (default: created_at)'),
    sortAscending: z
      .boolean()
      .optional()
      .default(false)
      .describe('Sort ascending (default: false)'),
    status: z
      .enum(['active', 'inactive', 'archived', 'unarchived'])
      .optional()
      .describe(
        'Filter by sequence status. Default shows active and inactive (unarchived). Use "archived" to see archived sequences.',
      ),
  }),
  output: z.object({
    emailer_campaigns: z
      .array(SequenceSchema)
      .describe('Array of sequence objects'),
    pagination: PaginationSchema.optional().describe('Pagination metadata'),
  }),
};

export const viewSequenceSchema = {
  name: 'viewSequence',
  description: 'View a single sequence by ID with full step/template details',
  notes:
    'Returns sequence metadata, steps, touches, and templates. Use emailer_steps for step details, emailer_touches for touch points, and emailer_templates for email content. UI URL: https://app.apollo.io/#/sequences/{id}',
  input: z.object({
    id: z.string().describe('Sequence ID'),
  }),
  output: z.object({
    emailer_campaign: SequenceSchema.describe('Sequence details'),
    emailer_steps: z
      .array(SequenceStepSchema)
      .optional()
      .describe('All steps in the sequence'),
    emailer_touches: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe(
        'Touch points linking steps to templates. Each touch has id, emailer_step_id, emailer_template_id, and status.',
      ),
    emailer_templates: z
      .array(EmailTemplateSchema)
      .optional()
      .describe(
        'Email templates for each step. Contains subject, body_html, body_text with unresolved {{variable}} placeholders.',
      ),
  }),
};

export const createSequenceSchema = {
  name: 'createSequence',
  description: 'Create a new sequence',
  notes:
    'The sequence URL for viewing in Apollo is: https://app.apollo.io/#/sequences/{id}. After creating a sequence, add steps with addSequenceStep(). Default all steps to type "auto_email" unless the user explicitly requests other step types (call, linkedin_step_message, manual_email, action_item, etc.). If building a sequence similar to an existing one, prefer cloneSequence(); it preserves email threading configuration that cannot be set from scratch via addSequenceStep(). Creating a sequence does NOT activate it; NEVER auto-activate. Always confirm with the user before calling activateSequence().',
  input: z.object({
    name: z.string().describe('Sequence name'),
    permissions: SequencePermissionsParam.optional().default('team_can_use'),
    active: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether to activate immediately (default: false)'),
  }),
  output: z.object({
    emailer_campaign: SequenceSchema.describe('Created sequence'),
  }),
};

export const updateSequenceSchema = {
  name: 'updateSequence',
  description: 'Update an existing sequence',
  notes:
    'Updates sequence metadata. To activate a sequence for sending, use activateSequence() instead; setting active=true here does NOT start sending.',
  input: z.object({
    id: z.string().describe('Sequence ID'),
    name: z.string().optional().describe('New sequence name'),
    active: z.boolean().optional().describe('Activate or deactivate'),
    permissions: SequencePermissionsParam.optional().describe(
      'New permission level',
    ),
    maxEmailsPerDay: z.number().optional().describe('Max emails per day'),
    emailerScheduleId: z
      .string()
      .optional()
      .describe('Schedule ID to assign (from listSequenceSchedules)'),
  }),
  output: z.object({
    emailer_campaign: SequenceSchema.describe('Updated sequence'),
  }),
};

export const deleteSequenceSchema = {
  name: 'deleteSequence',
  description:
    'Archive a sequence by ID (Apollo does not support permanent deletion)',
  notes: '',
  input: z.object({
    id: z.string().describe('Sequence ID to delete'),
  }),
  output: z.object({
    success: z.literal(true).describe('Always true on success'),
  }),
};

export const unarchiveSequenceSchema = {
  name: 'unarchiveSequence',
  description: 'Restore an archived sequence back to active state',
  notes: '',
  input: z.object({
    id: z.string().describe('Sequence ID to restore'),
  }),
  output: z.object({
    emailer_campaign: SequenceSchema.describe('Restored sequence details'),
  }),
};

export const addSequenceStepSchema = {
  name: 'addSequenceStep',
  description: 'Add a step to a sequence',
  notes: `**Default to auto_email**: Unless the user explicitly asks for LinkedIn steps, phone calls, manual emails, or action items, always use type "auto_email" for every step. Most sequences are pure automated email campaigns.

For email steps, subject and bodyHtml are applied to the auto-created template after step creation. Step touches are automatically marked as reviewed so the sequence can be activated via activateSequence().

**Threading**: Set \`replyToThread: true\` on follow-up steps (steps 2+) to make them appear as replies in the same email thread as the first step. The first step should always be a new thread (omit replyToThread or set false). When using replyToThread, omit the subject; Apollo auto-prefixes "Re:" from the first step's subject.

If using template variables in subject/bodyHtml, you MUST call listTemplateVariables() first to get exact variable names. Do NOT guess; names like {{company_industry}} or {{day_of_week}} do not exist. The correct names are {{industry}}, {{now_weekday}}, {{sender_first_name}} (NOT {{sender_name}}), etc.`,
  input: z.object({
    sequenceId: z.string().describe('Sequence ID to add the step to'),
    type: SequenceStepTypeParam.describe('Step type'),
    priority: StepPriorityParam.optional().default('A'),
    position: z.number().optional().describe('Step position in the sequence'),
    waitTime: z
      .number()
      .optional()
      .default(1)
      .describe('Wait time before this step executes'),
    waitMode: WaitModeParam.optional().default('day'),
    subject: z
      .string()
      .optional()
      .describe(
        'Email subject line. Only set for the FIRST step. Omit for follow-up steps when using replyToThread: true.',
      ),
    bodyHtml: z
      .string()
      .optional()
      .describe('Email body HTML (for email step types)'),
    replyToThread: z
      .boolean()
      .optional()
      .describe(
        'Set to true for follow-up steps (steps 2+) to make them appear as replies in the same email thread. Omit or set false for the first step.',
      ),
  }),
  output: z.object({
    emailer_step: SequenceStepSchema.describe('Created step'),
    emailer_touch: z
      .record(z.string(), z.unknown())
      .describe('Touch point details'),
    emailer_template: z
      .record(z.string(), z.unknown())
      .describe('Template associated with step'),
    emailer_steps: z
      .array(SequenceStepSchema)
      .describe('All steps in the sequence'),
  }),
};

export const enableSequenceStepSchema = {
  name: 'enableSequenceStep',
  description: 'Turn on a sequence step (approve its touch so it sends emails)',
  notes:
    'Approves the touch for a step, enabling it to send. Use getSequenceStepTouches() or viewSequence() to find touch IDs. Each step has one or more touches (A/B variants); enable/disable them individually.',
  input: z.object({
    touchId: z.string().describe('Touch ID to enable (from emailer_touches)'),
  }),
  output: z.object({
    success: z.literal(true).describe('Always true on success'),
  }),
};

export const disableSequenceStepSchema = {
  name: 'disableSequenceStep',
  description:
    'Turn off a sequence step (abort its touch so it stops sending emails)',
  notes:
    'Aborts the touch for a step, preventing it from sending. The step remains in the sequence but is skipped. Use enableSequenceStep() to turn it back on.',
  input: z.object({
    touchId: z.string().describe('Touch ID to disable (from emailer_touches)'),
  }),
  output: z.object({
    success: z.literal(true).describe('Always true on success'),
  }),
};

export const deleteSequenceStepSchema = {
  name: 'deleteSequenceStep',
  description: 'Delete a sequence step by ID',
  notes:
    'Cannot delete the last step in a sequence; Apollo returns 422. Delete the sequence instead, or add another step first.',
  input: z.object({
    id: z.string().describe('Step ID to delete'),
  }),
  output: z.object({
    success: z.literal(true).describe('Always true on success'),
  }),
};

export const addContactsToSequenceSchema = {
  name: 'addContactsToSequence',
  description:
    'Enroll existing CRM contacts into a sequence for outreach. Does NOT save new people to CRM; use addContactsToList() first.',
  notes:
    'CRITICAL: Requires CRM contact IDs, NOT person IDs from selectPeople(). Passing person IDs will fail silently with skip reason "contact_not_found". Correct workflow: selectPeople() → addContactsToList() → use savedContactIds here. Or use getContactsInList().contactIds if contacts are already saved. Also requires a connected email account ID from listEmailAccounts(). For bulk enrollment where contacts may already be in other sequences, set sequenceActiveInOtherCampaigns: true; otherwise Apollo silently skips them. Always check the skipped_contact_ids map in the response and report skip reasons to the user. Common skip reasons: contact_not_found (wrong ID type, used person ID instead of contact ID), contacts_active_in_other_campaigns (set sequenceActiveInOtherCampaigns: true to override), contacts_finished_in_other_campaigns (set sequenceFinishedInOtherCampaigns: true to override, or use resetFinishedContacts()), contacts_without_email.',
  input: z.object({
    sequenceId: z.string().describe('Sequence ID to enroll contacts into'),
    contactIds: z
      .array(z.string())
      .describe(
        'CRM contact IDs (from addContactsToList().savedContactIds or getContactsInList().contactIds). NOT person IDs from selectPeople().',
      ),
    sendEmailFromEmailAccountId: z
      .string()
      .describe('Email account ID to send from (get from listEmailAccounts)'),
    sequenceActiveInOtherCampaigns: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Allow contacts currently active in other sequences (default: false).',
      ),
    sequenceFinishedInOtherCampaigns: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Allow contacts that finished another sequence to be enrolled (default: false). Set to true to override the contacts_finished_in_other_campaigns block. Alternative to resetFinishedContacts() when you want to re-enroll without deleting/recreating contacts.',
      ),
    sequenceUnverifiedEmail: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Allow contacts with unverified emails to be enrolled (default: false). Set to true to override the contacts_without_verified_email block.',
      ),
  }),
  output: z.object({
    contacts: z
      .array(z.record(z.string(), z.unknown()))
      .describe('Added contacts'),
    skipped_contact_ids: z
      .record(z.string(), z.string())
      .describe(
        'Map of skipped contact ID → reason. Common reasons: contact_not_found (passed person ID instead of CRM contact ID), contacts_active_in_other_campaigns, contacts_finished_in_other_campaigns, contacts_without_email',
      ),
    emailer_campaign: SequenceSchema.describe('Updated sequence'),
  }),
};

export const addListToSequenceSchema = {
  name: 'addListToSequence',
  description:
    'Add ALL contacts from a list to a sequence. Handles pagination automatically.',
  notes:
    'Fetches all contacts from the list (all pages) then adds them to the sequence in one call. Use viewLists() to find the list ID, and listEmailAccounts() for the email account ID. This only enrolls contacts; it does NOT activate the sequence. You MUST call activateSequence() separately to start sending. ALWAYS confirm with the user before activating a sequence; activation starts sending emails immediately. For bulk enrollment, set sequenceActiveInOtherCampaigns: true if contacts may already be in other sequences; otherwise they will be silently skipped. Always report skip counts and reasons to the user.',
  input: z.object({
    listId: z.string().describe('List ID (from viewLists or createList)'),
    sequenceId: z.string().describe('Sequence ID to add contacts to'),
    sendEmailFromEmailAccountId: z
      .string()
      .describe('Email account ID to send from (from listEmailAccounts)'),
    sequenceActiveInOtherCampaigns: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Allow contacts currently active in other sequences (default: false). Does NOT override contacts_finished_in_other_campaigns; those contacts cannot be re-added.',
      ),
  }),
  output: z.object({
    totalContactsInList: z
      .number()
      .describe('Total contacts found in the list'),
    addedCount: z
      .number()
      .describe('Number of contacts successfully added to sequence'),
    skippedCount: z.number().describe('Number of contacts skipped'),
    skippedContactIds: z
      .record(z.string(), z.string())
      .describe(
        'Map of skipped contact ID → reason. Common reasons: contacts_active_in_other_campaigns, contacts_finished_in_other_campaigns, contacts_without_email',
      ),
    emailer_campaign: SequenceSchema.describe('Updated sequence'),
  }),
};

export const resetFinishedContactsSchema = {
  name: 'resetFinishedContacts',
  description:
    'Reset contacts marked "finished" in a sequence so they can be re-enrolled in other sequences. Deletes and recreates each contact to clear the contacts_finished_in_other_campaigns block.',
  notes:
    'Use getSequenceContacts() with contactStatuses: ["finished"] first to identify which contacts are locked. This operation preserves the contact person_id and list membership but generates new contact IDs. The original contact data (name, email, title, company, LinkedIn URL) is preserved.',
  input: z.object({
    sequenceId: z
      .string()
      .describe('ID of the sequence whose finished contacts should be reset'),
    contactIds: z
      .array(z.string())
      .optional()
      .describe(
        'Specific contact IDs to reset. If omitted, resets ALL finished contacts in the sequence.',
      ),
  }),
  output: z.object({
    resetCount: z.number().describe('Number of contacts successfully reset'),
    skippedCount: z
      .number()
      .describe('Number of contacts skipped (not in finished status)'),
    contacts: z
      .array(
        z.object({
          oldId: z.string().describe('Original contact ID (now deleted)'),
          newId: z.string().describe('New contact ID after recreation'),
          name: z.string().describe('Contact name'),
          email: z.string().describe('Contact email'),
        }),
      )
      .describe('Array of reset contacts with old and new IDs'),
  }),
};

export const getSequenceContactsSchema = {
  name: 'getSequenceContacts',
  description: 'List contacts enrolled in a sequence',
  notes:
    'Use viewSequence() first to check contact_statuses counts. The status field shows each contact progression: active, paused, finished, bounced.',
  input: z.object({
    sequenceId: z.string().describe('Sequence ID'),
    page: z.number().optional().default(1).describe('Page number (default: 1)'),
    perPage: z
      .number()
      .optional()
      .default(25)
      .describe('Results per page (default: 25, max: 100)'),
    contactStatuses: z
      .array(
        z.enum([
          'active',
          'paused',
          'finished',
          'not_sent',
          'bounced',
          'spam_blocked',
        ]),
      )
      .optional()
      .describe(
        'Filter contacts by their enrollment status in this sequence. Multiple statuses can be combined.',
      ),
  }),
  output: z.object({
    contacts: z
      .array(
        z.object({
          id: z.string().describe('Contact ID'),
          name: z.string().describe('Full name'),
          email: z.string().describe('Email address'),
          title: z.string().describe('Job title'),
          company: z.string().describe('Company name'),
          status: z
            .string()
            .describe('Sequence status (active, paused, finished, bounced)'),
          inactiveReason: z.string().describe('Reason for inactive status'),
          currentStepPosition: z
            .number()
            .describe('Current step position in sequence'),
        }),
      )
      .describe('Array of contacts in the sequence'),
    contactIds: z.array(z.string()).describe('Array of contact IDs'),
    pagination: PaginationSchema.optional().describe('Pagination metadata'),
  }),
};

export const updateSequenceContactStatusSchema = {
  name: 'updateSequenceContactStatus',
  description:
    'Update the status of contacts in a sequence: pause, resume, or finish them',
  notes:
    'Status values: "paused" = stop receiving emails (reversible), "active" = resume sending, "finished" = permanently stop (cannot re-enroll in this sequence).',
  input: z.object({
    sequenceId: z.string().describe('Sequence ID'),
    contactIds: z.array(z.string()).describe('Array of contact IDs to update'),
    status: z
      .enum(['paused', 'active', 'finished'])
      .describe(
        'Target status. "paused" = temporarily stop emails, "active" = resume sending, "finished" = permanently end enrollment',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the operation succeeded'),
    contacts: z
      .array(
        z.object({
          id: z.string().describe('Contact ID'),
          name: z.string().describe('Full name'),
        }),
      )
      .describe('Updated contacts'),
  }),
};

export const updateSequenceStepSchema = {
  name: 'updateSequenceStep',
  description:
    'Update a sequence step: timing, metadata, and/or email content (subject/body)',
  notes:
    'Updates step timing, metadata, and optionally the email template content. To update email content, provide subject and/or bodyHtml; the step touch and template are resolved automatically. Apollo steps do not have an enable/disable toggle; to disable a step, delete it with deleteSequenceStep() and re-add later with addSequenceStep().',
  input: z.object({
    id: z.string().describe('Step ID'),
    waitTime: z
      .number()
      .optional()
      .describe(
        'Wait time before this step (defaults waitMode to "day" if omitted)',
      ),
    waitMode: WaitModeParam.optional().describe(
      'Wait time unit (defaults to "day")',
    ),
    note: z.string().optional().describe('Step note'),
    autoSkipInDays: z.number().optional().describe('Auto-skip after N days'),
    subject: z
      .string()
      .optional()
      .describe('Update the email subject line for this step'),
    bodyHtml: z
      .string()
      .optional()
      .describe('Update the email body HTML for this step'),
  }),
  output: z.object({
    emailer_step: SequenceStepSchema.describe('Updated step'),
    emailer_template: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Updated email template (only present when subject/bodyHtml provided)',
      ),
  }),
};

export const duplicateSequenceStepSchema = {
  name: 'duplicateSequenceStep',
  description:
    'Add an A/B test variant to a sequence step. Creates a second email version on the same step for split testing.',
  notes:
    'Apollo A/B testing works by adding multiple touches (email variants) to the same step. The new variant starts with empty content; use updateSequenceStep() to set subject/bodyHtml. To remove a variant, use deleteSequenceTouch() with the touch ID.',
  input: z.object({
    stepId: z.string().describe('Step ID to add an A/B variant to'),
    sequenceId: z.string().describe('Sequence ID the step belongs to'),
    subject: z
      .string()
      .optional()
      .describe('Email subject for the A/B variant'),
    bodyHtml: z
      .string()
      .optional()
      .describe('Email body HTML for the A/B variant'),
    copyOriginal: z
      .boolean()
      .optional()
      .describe(
        'If true, copies the original touch email content to the new variant as a starting point',
      ),
  }),
  output: z.object({
    touchId: z.string().describe('ID of the new A/B variant touch'),
    templateId: z.string().describe('ID of the new template'),
    stepId: z.string().describe('Step ID the variant belongs to'),
    subject: z.string().describe('Email subject'),
    bodyHtml: z.string().describe('Email body HTML'),
  }),
};

export const cloneSequenceSchema = {
  name: 'cloneSequence',
  description: 'Clone/duplicate a sequence',
  notes:
    'Clones sequence with all steps and templates. Clone starts as inactive. IMPORTANT: Schedule is NOT copied; the cloned sequence has emailerScheduleId: null. You MUST call listSequenceSchedules() to find a schedule, then updateSequence({ id, emailerScheduleId }) to assign it before activating. Without a schedule, the sequence cannot send emails.',
  input: z.object({
    id: z.string().describe('Sequence ID to clone'),
    name: z
      .string()
      .optional()
      .describe('Name for the cloned sequence (uses original name if omitted)'),
  }),
  output: z.object({
    emailer_campaign: SequenceSchema.describe('Cloned sequence'),
  }),
};

export const listSequenceSchedulesSchema = {
  name: 'listSequenceSchedules',
  description: 'List sending schedules',
  notes:
    'Returns available sending schedules. Assign to a sequence via updateSequence() with emailer_schedule_id.',
  input: z.object({}),
  output: z.object({
    emailer_schedules: z
      .array(SequenceScheduleSchema)
      .describe('Array of schedule objects'),
  }),
};

export const createSequenceScheduleSchema = {
  name: 'createSequenceSchedule',
  description: 'Create a new sending schedule',
  notes:
    'schedule_hash format: { monday: [[8,17]], tuesday: [[8,17]], ... } where numbers are 24-hour start/end. Days not present = no sending.',
  input: z.object({
    name: z.string().describe('Schedule name'),
    timeZone: z.string().describe('Time zone (e.g., "America/New_York")'),
    scheduleHash: z
      .record(z.string(), z.array(z.array(z.number())))
      .describe('Send windows per day: { monday: [[8,17]], ... }'),
    useContactsTimeZone: z
      .boolean()
      .optional()
      .describe('Use contact time zones instead of schedule time zone'),
    skipHolidays: z.boolean().optional().describe('Skip sending on holidays'),
  }),
  output: z.object({
    emailer_schedule: SequenceScheduleSchema.describe('Created schedule'),
  }),
};

export const updateSequenceScheduleSchema = {
  name: 'updateSequenceSchedule',
  description: 'Update an existing sending schedule',
  notes:
    'Fetches the current schedule and merges your changes. Only pass fields you want to change. schedule_hash format: { monday: [[8,17]], tuesday: [[8,17]], ... } where numbers are 24-hour start/end. Days not present = no sending.',
  input: z.object({
    id: z.string().describe('Schedule ID to update'),
    name: z.string().optional().describe('New schedule name'),
    timeZone: z
      .string()
      .optional()
      .describe('New time zone (e.g., "America/New_York")'),
    scheduleHash: z
      .record(z.string(), z.array(z.array(z.number())))
      .optional()
      .describe('New send windows per day: { monday: [[8,17]], ... }'),
    useContactsTimeZone: z
      .boolean()
      .optional()
      .describe('Use contact time zones instead of schedule time zone'),
    skipHolidays: z.boolean().optional().describe('Skip sending on holidays'),
  }),
  output: z.object({
    emailer_schedule: SequenceScheduleSchema.describe('Updated schedule'),
  }),
};

export const deleteSequenceScheduleSchema = {
  name: 'deleteSequenceSchedule',
  description: 'Delete a sending schedule',
  notes: '',
  input: z.object({
    id: z.string().describe('Schedule ID'),
  }),
  output: z.object({
    success: z.literal(true).describe('Whether the deletion succeeded'),
  }),
};

export const activateSequenceSchema = {
  name: 'activateSequence',
  description: 'Activate/approve a sequence to start sending emails',
  notes:
    'Setting active=true via updateSequence does NOT activate sending. Use this function instead. Requires at least one step and a schedule assigned. Also auto-approves all unapproved email steps so they start sending immediately. ALWAYS verify step content and threading with the user before activating; activation starts sending emails immediately and cannot be undone for already-sent messages.',
  input: z.object({
    sequenceId: z.string().describe('Sequence ID to activate'),
  }),
  output: z.object({
    emailer_campaign: SequenceSchema.describe('Activated sequence'),
  }),
};

export const searchEmailsSchema = {
  name: 'searchEmails',
  description: 'Search sent emails from sequences or standalone emails',
  notes:
    'Email statuses: scheduled (queued), completed (delivered), drafted (pending send), failed (send error), bounced, spam_blocked. Filter by status and/or sequence ID. Use sendEmailNow() to force-send scheduled/drafted/failed emails.',
  input: z.object({
    sequenceId: z
      .string()
      .optional()
      .describe('Filter to emails from a specific sequence'),
    statuses: z
      .array(
        z.enum([
          'scheduled',
          'completed',
          'drafted',
          'failed',
          'bounced',
          'spam_blocked',
        ]),
      )
      .optional()
      .describe(
        'Filter by email status. "completed" means delivered. "drafted" = pending review. "failed" = send error.',
      ),
    page: z.number().optional().describe('Page number (default 1)'),
    perPage: z.number().optional().describe('Results per page (default 25)'),
  }),
  output: z.object({
    emailer_messages: z
      .array(
        z
          .object({
            id: z.string(),
            emailer_campaign_id: z.string().nullable().optional(),
            contact_id: z.string().optional(),
            emailer_step_id: z.string().nullable().optional(),
            email_account_id: z.string().optional(),
            subject: z.string().nullable().optional(),
            body_text: z.string().optional(),
            status: z
              .string()
              .optional()
              .describe(
                'scheduled, completed, drafted, failed, bounced, spam_blocked',
              ),
            type: z
              .string()
              .optional()
              .describe(
                'outreach_manual_email (standalone) or outreach_automatic_email (sequence)',
              ),
            from_email: z.string().optional(),
            to_email: z.string().optional(),
            from_name: z.string().optional(),
            to_name: z.string().optional(),
            created_at: z.string().optional(),
            completed_at: z.string().nullable().optional(),
            failed_at: z.string().nullable().optional(),
            failure_reason: z.string().nullable().optional(),
            num_opens: z.number().optional(),
            num_clicks: z.number().optional(),
          })
          .passthrough(),
      )
      .describe('List of email messages'),
  }),
};

export const viewEmailSchema = {
  name: 'viewEmail',
  description: 'View a single email message by ID',
  notes:
    'Returns full email details including rendered body (all template variables like {{first_name}} are resolved to actual contact data), status, tracking timestamps, and nested contact info. Use this to verify email content after creating sequence steps. Get email IDs from searchEmails().',
  input: z.object({
    id: z.string().describe('Email message ID'),
  }),
  output: z.object({
    emailer_message: z
      .object({
        id: z.string(),
        emailer_campaign_id: z.string().nullable().optional(),
        contact_id: z.string().optional(),
        emailer_step_id: z.string().nullable().optional(),
        email_account_id: z.string().optional(),
        subject: z.string().nullable().optional(),
        body_text: z.string().optional(),
        body_html: z.string().optional(),
        status: z
          .string()
          .optional()
          .describe(
            'scheduled, completed, drafted, failed, bounced, spam_blocked',
          ),
        type: z
          .string()
          .optional()
          .describe(
            'outreach_manual_email (standalone) or outreach_automatic_email (sequence)',
          ),
        from_email: z.string().optional(),
        to_email: z.string().optional(),
        from_name: z.string().optional(),
        to_name: z.string().optional(),
        created_at: z.string().optional(),
        completed_at: z.string().nullable().optional(),
        failed_at: z.string().nullable().optional(),
        failure_reason: z.string().nullable().optional(),
        num_opens: z.number().optional(),
        num_clicks: z.number().optional(),
        replied: z.boolean().nullable().optional(),
      })
      .passthrough()
      .describe('Email message details with nested contact object'),
    attachments: z.array(z.unknown()).optional().describe('Email attachments'),
  }),
};

export const getEmailAnalyticsSchema = {
  name: 'getEmailAnalytics',
  description: 'Get email analytics and performance metrics',
  notes:
    'Returns aggregate email statistics (sent, delivered, opened, replied, bounced, clicked). Filter by sequence ID and/or date range.',
  input: z.object({
    sequenceIds: z
      .array(z.string())
      .optional()
      .describe('Filter to specific sequence IDs'),
    dateRange: z
      .object({
        min: z.string().describe('Start date ISO string'),
        max: z.string().describe('End date ISO string'),
      })
      .optional()
      .describe('Date range filter'),
  }),
  output: z.object({
    sent: z.number().describe('Total emails sent'),
    delivered: z.number().describe('Total emails delivered'),
    opened: z.number().describe('Total emails opened'),
    replied: z.number().describe('Total emails replied to'),
    bounced: z.number().describe('Total emails bounced'),
    clicked: z.number().describe('Total links clicked'),
    interested: z.number().describe('Total marked as interested'),
    unsubscribed: z.number().describe('Total unsubscribed'),
  }),
};

export const sendEmailNowSchema = {
  name: 'sendEmailNow',
  description:
    'Force send a scheduled, drafted, or failed email immediately, bypassing the batch queue',
  notes:
    'Works on emails with status "scheduled", "drafted", or "failed". Get email IDs from searchEmails() or createEmail(). Apollo re-queues the email with status "scheduled", then processes it to "completed" asynchronously. Apollo batch processing can delay emails 15+ minutes; this forces immediate re-queue.',
  input: z.object({
    id: z
      .string()
      .describe('Email message ID (from searchEmails or createEmail)'),
  }),
  output: z.object({
    emailer_message: z
      .object({
        id: z.string(),
        status: z
          .string()
          .describe(
            '"scheduled" (re-queued for send) or "completed" (already delivered)',
          ),
        from_email: z.string().optional(),
        to_email: z.string().optional(),
        subject: z.string().nullable().optional(),
        failure_reason: z.string().nullable().optional(),
      })
      .passthrough()
      .describe('Updated email message'),
  }),
};

export const createEmailSchema = {
  name: 'createEmail',
  description:
    'Create a one-off email draft to a contact (not tied to any sequence)',
  notes:
    'Creates a draft email with status "drafted". Call sendEmailNow() to send it immediately, or it stays as a draft. Requires a CRM contact ID (use addContactsToList() to convert person IDs). CC/BCC are passed as arrays of email addresses. The email account signature is auto-appended to the body.\n\nIf using template variables in subject/bodyHtml, you MUST call listTemplateVariables() first to get exact variable names. Do NOT guess; names like {{company_industry}} or {{day_of_week}} do not exist. The correct names are {{industry}}, {{now_weekday}}, etc.',
  input: z.object({
    contactId: z
      .string()
      .describe('CRM contact ID (from addContactsToList or getContactsInList)'),
    emailAccountId: z
      .string()
      .describe('Email account ID (from listEmailAccounts)'),
    subject: z.string().describe('Email subject line'),
    bodyHtml: z.string().describe('Email body as HTML'),
    ccEmails: z.array(z.string()).optional().describe('CC email addresses'),
    bccEmails: z.array(z.string()).optional().describe('BCC email addresses'),
  }),
  output: z.object({
    emailer_message: z
      .object({
        id: z.string(),
        status: z.string().describe('"drafted": call sendEmailNow() to send'),
        contact_id: z.string(),
        email_account_id: z.string(),
        subject: z.string().nullable(),
        body_html: z.string().nullable(),
        from_email: z.string(),
        to_email: z.string(),
        cc_emails: z.array(z.string()),
        bcc_emails: z.array(z.string()),
        created_at: z.string(),
      })
      .passthrough()
      .describe('Created draft email message'),
  }),
};

export const sendEmailSchema = {
  name: 'sendEmail',
  description:
    'Compose and send a one-off email to a contact immediately (not tied to any sequence)',
  notes:
    'Creates a draft and sends it immediately in one call. Shortcut for createEmail() + sendEmailNow(). Requires a CRM contact ID (use addContactsToList() to convert person IDs). CC/BCC are passed as arrays of email addresses.\n\nIf using template variables in subject/bodyHtml, you MUST call listTemplateVariables() first to get exact variable names. Do NOT guess; names like {{company_industry}} or {{day_of_week}} do not exist. The correct names are {{industry}}, {{now_weekday}}, etc.\n\nSkill hint: use the "sales-copy" skill for composing effective emails.',
  input: z.object({
    contactId: z
      .string()
      .describe('CRM contact ID (from addContactsToList or getContactsInList)'),
    emailAccountId: z
      .string()
      .describe('Email account ID (from listEmailAccounts)'),
    subject: z.string().describe('Email subject line'),
    bodyHtml: z.string().describe('Email body as HTML'),
    ccEmails: z.array(z.string()).optional().describe('CC email addresses'),
    bccEmails: z.array(z.string()).optional().describe('BCC email addresses'),
  }),
  output: z.object({
    emailer_message: z
      .object({
        id: z.string(),
        status: z
          .string()
          .describe(
            '"scheduled" or "completed"; Apollo processes the send asynchronously',
          ),
        contact_id: z.string(),
        email_account_id: z.string(),
        subject: z.string().nullable(),
        body_html: z.string().nullable(),
        from_email: z.string(),
        to_email: z.string(),
        cc_emails: z.array(z.string()),
        bcc_emails: z.array(z.string()),
        created_at: z.string(),
      })
      .passthrough()
      .describe('Sent email message'),
  }),
};

export const deactivateSequenceSchema = {
  name: 'deactivateSequence',
  description: 'Deactivate/pause a sequence to stop sending emails',
  notes:
    'Pauses the sequence. Contacts already scheduled will not be sent. Use activateSequence() to resume.',
  input: z.object({
    sequenceId: z.string().describe('Sequence ID to deactivate'),
  }),
  output: z.object({
    emailer_campaign: SequenceSchema.describe('Deactivated sequence'),
  }),
};

// ============================================================================
// Email Templates Schemas
// ============================================================================

export const searchEmailTemplatesSchema = {
  name: 'searchEmailTemplates',
  description: 'Search email templates with pagination',
  notes: '',
  input: z.object({
    page: z.number().optional().default(1).describe('Page number (default: 1)'),
    perPage: z
      .number()
      .optional()
      .default(25)
      .describe('Results per page (default: 25)'),
  }),
  output: z.object({
    emailer_templates: z
      .array(EmailTemplateSchema)
      .describe('Array of email template objects'),
    folders: z
      .array(EmailTemplateFolderSchema)
      .describe('Array of template folders'),
    pagination: PaginationSchema.optional().describe('Pagination metadata'),
  }),
};

export const createEmailTemplateSchema = {
  name: 'createEmailTemplate',
  description: 'Create a new email template',
  notes:
    'If using template variables in subject/bodyHtml, you MUST call listTemplateVariables() first to get exact variable names. Do NOT guess; names like {{company_industry}} or {{day_of_week}} do not exist. The correct names are {{industry}}, {{now_weekday}}, {{sender_first_name}} (NOT {{sender_name}}), etc.',
  input: z.object({
    name: z.string().describe('Template name'),
    subject: z.string().describe('Email subject line'),
    bodyHtml: z.string().describe('Email body HTML'),
  }),
  output: z.object({
    emailer_template: EmailTemplateSchema.describe('Created template'),
  }),
};

export const updateEmailTemplateSchema = {
  name: 'updateEmailTemplate',
  description: 'Update an existing email template',
  notes: '',
  input: z.object({
    id: z.string().describe('Template ID'),
    name: z.string().optional().describe('New template name'),
    subject: z.string().optional().describe('New email subject line'),
    bodyHtml: z.string().optional().describe('New email body HTML'),
  }),
  output: z.object({
    emailer_template: EmailTemplateSchema.describe('Updated template'),
  }),
};

export const deleteEmailTemplateSchema = {
  name: 'deleteEmailTemplate',
  description:
    'Archive an email template by ID (Apollo does not support permanent deletion)',
  notes: '',
  input: z.object({
    id: z.string().describe('Template ID to delete'),
  }),
  output: z.object({
    success: z.literal(true).describe('Always true on success'),
  }),
};

export const TemplateVariableSchema = z.object({
  variable: z.string().describe('Variable syntax, e.g. "{{first_name}}"'),
  category: z
    .string()
    .describe(
      'Category name, e.g. PERSON_PRIMARY_VARIABLES, SENDER_VARIABLES, CUSTOM_FIELDS',
    ),
  example: z.string().describe('Example value or description'),
});

export const listTemplateVariablesSchema = {
  name: 'listTemplateVariables',
  description:
    'List all available template variables for use in email templates and sequence steps',
  notes:
    'Returns built-in variables (contact, company, deal, sender, time, etc.) plus any custom fields. Use {{sender_first_name}} NOT {{sender_name}}. Supports conditionals like {{#if first_name}}...{{#endif}} and pipe operators like {{title >lowercase}}.',
  input: z.object({}),
  output: z.object({
    variables: z
      .array(TemplateVariableSchema)
      .describe(
        'All available template variables with categories and examples',
      ),
  }),
};

// ============================================================================
// Deals (Opportunities) Schemas
// ============================================================================

export const searchDealsSchema = {
  name: 'searchDeals',
  description: 'Search deals/opportunities with pagination and sorting',
  notes: '',
  input: z.object({
    page: z.number().optional().default(1).describe('Page number (default: 1)'),
    perPage: z
      .number()
      .optional()
      .default(25)
      .describe('Results per page (default: 25)'),
    sortByField: z.string().optional().describe('Field to sort by'),
    sortAscending: z
      .boolean()
      .optional()
      .describe('Sort ascending (default: descending)'),
  }),
  output: z.object({
    opportunities: z
      .array(DealSchema)
      .describe('Array of deal/opportunity objects'),
    pagination: PaginationSchema.optional().describe('Pagination metadata'),
  }),
};

export const viewDealSchema = {
  name: 'viewDeal',
  description: 'View a single deal/opportunity by ID',
  notes: '',
  input: z.object({
    id: z.string().describe('Deal/opportunity ID'),
  }),
  output: z.object({
    opportunity: DealSchema.describe('Deal/opportunity details'),
  }),
};

export const createDealSchema = {
  name: 'createDeal',
  description: 'Create a new deal/opportunity',
  notes: 'Use listDealStages() to get valid opportunity_stage_id values.',
  input: z.object({
    name: z.string().describe('Deal name'),
    opportunity_stage_id: z
      .string()
      .optional()
      .describe(
        'Stage ID for the deal - use listDealStages() to get valid values',
      ),
    amount: z.number().optional().describe('Deal amount'),
    account_id: z.string().optional().describe('Associated account ID'),
    owner_id: z.string().optional().describe('Owner user ID'),
    closed_date: z.string().optional().describe('Expected close date'),
    description: z.string().optional().describe('Deal description'),
    source: z.string().optional().describe('Deal source'),
  }),
  output: z.object({
    opportunity: DealSchema.describe('Created deal/opportunity'),
  }),
};

export const updateDealSchema = {
  name: 'updateDeal',
  description: 'Update an existing deal/opportunity',
  notes:
    'is_closed, is_won, stage_name, probability, and forecast_category are read-only; they are computed from the deal stage. To close/win a deal, set opportunity_stage_id to the Closed Won or Closed Lost stage ID (use listDealStages() to find them).',
  input: z.object({
    id: z.string().describe('Deal/opportunity ID to update'),
    name: z.string().optional().describe('Deal name'),
    amount: z.number().optional().describe('Deal amount'),
    closed_date: z.string().optional().describe('Expected close date'),
    account_id: z.string().optional().describe('Associated account ID'),
    description: z.string().optional().describe('Deal description'),
    opportunity_stage_id: z
      .string()
      .optional()
      .describe(
        'Stage ID: use listDealStages() to get valid values. Setting this also updates is_closed, is_won, stage_name, and probability.',
      ),
    source: z.string().optional().describe('Deal source'),
    owner_id: z.string().optional().describe('Owner user ID'),
    next_step: z.string().optional().describe('Next step description'),
    next_step_date: z.string().optional().describe('Next step date'),
    closed_lost_reason: z
      .string()
      .optional()
      .describe('Reason for closed-lost'),
    closed_won_reason: z.string().optional().describe('Reason for closed-won'),
    opportunity_pipeline_id: z.string().optional().describe('Pipeline ID'),
    currency: z.string().optional().describe('Currency code'),
  }),
  output: z.object({
    opportunity: DealSchema.describe('Updated deal/opportunity'),
  }),
};

export const deleteDealSchema = {
  name: 'deleteDeal',
  description: 'Permanently delete a deal/opportunity by ID',
  notes: '',
  input: z.object({
    id: z.string().describe('Deal/opportunity ID to delete'),
  }),
  output: z.object({
    success: z.literal(true).describe('Whether the deletion succeeded'),
  }),
};

// ============================================================================
// Stages & Pipelines Schemas
// ============================================================================

export const listDealStagesSchema = {
  name: 'listDealStages',
  description: 'List all deal/opportunity stages',
  notes: '',
  input: z.object({}),
  output: z.object({
    opportunity_stages: z
      .array(DealStageSchema)
      .describe('Array of deal stage objects'),
  }),
};

export const listDealPipelinesSchema = {
  name: 'listDealPipelines',
  description: 'List all deal/opportunity pipelines',
  notes: '',
  input: z.object({}),
  output: z.object({
    opportunity_pipelines: z
      .array(DealPipelineSchema)
      .describe('Array of deal pipeline objects'),
  }),
};

// ============================================================================
// Tasks Schemas
// ============================================================================

export const searchTasksSchema = {
  name: 'searchTasks',
  description: 'Search tasks with pagination, sorting, and filtering',
  notes: '',
  input: z.object({
    page: z.number().optional().default(1).describe('Page number (default: 1)'),
    perPage: z
      .number()
      .optional()
      .default(25)
      .describe('Results per page (default: 25)'),
    sortByField: z.string().optional().describe('Field to sort by'),
    sortAscending: z
      .boolean()
      .optional()
      .describe('Sort ascending (default: descending)'),
    userId: z
      .string()
      .optional()
      .describe('Filter by assigned user ID (get user IDs from listUsers())'),
    type: z
      .enum(['action_item', 'call', 'linkedin', 'email'])
      .optional()
      .describe('Filter by task type'),
    status: z
      .enum(['pending', 'scheduled', 'complete'])
      .optional()
      .describe('Filter by task status'),
    taskTypeCds: z
      .array(z.string())
      .optional()
      .describe(
        'Filter by task type codes (e.g. ["linkedin_step_message", "linkedin_step_connect"]). Use instead of type for sequence-specific LinkedIn step types.',
      ),
  }),
  output: z.object({
    tasks: z.array(TaskSchema).describe('Array of task objects'),
    pagination: PaginationSchema.optional().describe('Pagination metadata'),
  }),
};

export const createTaskSchema = {
  name: 'createTask',
  description: 'Create a new task',
  notes:
    'user_id is required - get it from getContext(). At least one of contact_ids, account_id, or opportunity_id is required.',
  input: z.object({
    type: z
      .enum(['action_item', 'call', 'linkedin', 'email'])
      .describe('Task type'),
    priority: z.enum(['high', 'medium', 'low']).describe('Task priority'),
    note: z.string().describe('Task note/description'),
    status: z.enum(['scheduled', 'complete']).describe('Task status'),
    user_id: z.string().describe('Assigned user ID (from getContext())'),
    contact_ids: z
      .array(z.string())
      .optional()
      .describe('Associated contact IDs'),
    account_id: z.string().optional().describe('Associated account ID'),
    opportunity_id: z
      .string()
      .optional()
      .describe('Associated opportunity/deal ID'),
    due_at: z.string().optional().describe('Due date timestamp'),
  }),
  output: z.object({
    task: TaskSchema.describe('Created task'),
  }),
};

export const updateTaskSchema = {
  name: 'updateTask',
  description: 'Update an existing task',
  notes:
    'To mark a task complete, use completeTask() instead. Status cannot be changed via updateTask.',
  input: z.object({
    id: z.string().describe('Task ID to update'),
    priority: z
      .enum(['high', 'medium', 'low'])
      .optional()
      .describe('Task priority'),
    note: z.string().optional().describe('Task note/description'),
    due_at: z.string().optional().describe('Due date timestamp'),
  }),
  output: z.object({
    task: TaskSchema.describe('Updated task'),
  }),
};

export const completeTaskSchema = {
  name: 'completeTask',
  description: 'Mark a task as complete',
  notes:
    'WARNING: Completing a LinkedIn manual task does NOT send the LinkedIn action. It only marks the task as done in Apollo. The user must manually perform the LinkedIn action first before calling completeTask. Completed tasks no longer appear in default searchTasks results. Tasks cannot be deleted in Apollo; only completed. Sequence-based tasks (those with an emailer_campaign_id) require a different API path; pass isSequenceTask: true for those.',
  input: z.object({
    id: z.string().describe('Task ID to complete'),
    isSequenceTask: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Set to true for tasks that belong to a sequence (have an emailer_campaign_id). Sequence tasks require PUT /api/v1/tasks/{id} with { status: "complete" } instead of POST /api/v1/tasks/{id}/complete. Check the task object for emailer_campaign_id to determine this.',
      ),
  }),
  output: z.object({
    task: TaskSchema.describe('Completed task'),
  }),
};

// ============================================================================
// Notes Schemas
// ============================================================================

export const createNoteSchema = {
  name: 'createNote',
  description: 'Create a note on a contact, account, or opportunity',
  notes: 'The body field in the request maps to content in the response.',
  input: z.object({
    body: z.string().describe('Note content'),
    contact_id: z.string().optional().describe('Associated contact ID'),
    account_id: z.string().optional().describe('Associated account ID'),
    opportunity_id: z
      .string()
      .optional()
      .describe('Associated opportunity/deal ID'),
  }),
  output: z.object({
    note: NoteSchema.describe('Created note'),
  }),
};

export const updateNoteSchema = {
  name: 'updateNote',
  description: 'Update an existing note',
  notes:
    'Only the note body can be updated. Associations (contact, account, opportunity) are set at creation time and cannot be changed.',
  input: z.object({
    id: z.string().describe('Note ID to update'),
    body: z.string().optional().describe('Updated note content'),
  }),
  output: z.object({
    note: NoteSchema.describe('Updated note'),
  }),
};

export const deleteNoteSchema = {
  name: 'deleteNote',
  description: 'Delete a note by ID',
  notes: '',
  input: z.object({
    id: z.string().describe('Note ID to delete'),
  }),
  output: z.object({
    success: z.literal(true).describe('Whether the deletion succeeded'),
  }),
};

// ============================================================================
// Custom Fields & Users Schemas
// ============================================================================

export const listFieldsSchema = {
  name: 'listFields',
  description:
    'List all available fields for an object type (contacts, accounts, or deals/opportunities). Returns both standard and custom fields.',
  notes:
    'Use modality to filter: "contact", "account", or "opportunity" (deals). Omit to get all fields. Returns field_groups showing how fields are organized in the UI.',
  input: z.object({
    modality: z
      .enum(['contact', 'account', 'opportunity'])
      .optional()
      .describe(
        'Filter by object type. "opportunity" = deals. Omit for all fields.',
      ),
  }),
  output: z.object({
    fields: z.array(FieldSchema).describe('Available fields'),
    field_groups: z
      .array(FieldGroupSchema)
      .describe('How fields are grouped in the UI'),
  }),
};

export const listUsersSchema = {
  name: 'listUsers',
  description: 'List users in the Apollo team',
  notes: '',
  input: z.object({
    page: z.number().optional().default(1).describe('Page number (default: 1)'),
    perPage: z
      .number()
      .optional()
      .default(25)
      .describe('Results per page (default: 25)'),
  }),
  output: z.object({
    users: z.array(UserSchema).describe('Array of users'),
    pagination: PaginationSchema.optional().describe('Pagination metadata'),
  }),
};

export const listEmailAccountsSchema = {
  name: 'listEmailAccounts',
  description: 'List email accounts connected to Apollo',
  notes: '',
  input: z.object({}),
  output: z.object({
    email_accounts: z
      .array(EmailAccountSchema)
      .describe('Array of email accounts'),
  }),
};

export const updateEmailAccountSchema = {
  name: 'updateEmailAccount',
  description:
    'Update email account settings (sending limits, signature, warmup)',
  notes:
    'Controls account-level sending limits per connected mailbox. The account-level email_daily_threshold is the global cap; it overrides sequence-level settings. Use listEmailAccounts() to get the email account ID.',
  input: z.object({
    id: z.string().describe('Email account ID (from listEmailAccounts)'),
    email_daily_threshold: z
      .number()
      .optional()
      .describe('Max emails sent per day from this mailbox'),
    max_outbound_emails_per_hour: z
      .number()
      .optional()
      .describe('Max outbound emails per hour'),
    seconds_delay_between_emails: z
      .number()
      .optional()
      .describe('Minimum seconds between individual emails'),
    signature_html: z
      .string()
      .optional()
      .describe('HTML email signature to set for this account'),
  }),
  output: z.object({
    email_account: EmailAccountSchema.describe('Updated email account'),
  }),
};

// ============================================================================
// Free Data Extraction Schemas
// ============================================================================

export const freeExportPeopleSearchSchema = {
  name: 'freeExportPeopleSearch',
  description:
    'Free export of people search results to CSV or JSON file. No credits consumed. Exports 30+ fields per person including seniority, department, headline, company website/industry/headcount, and more. Does NOT include emails or phones; those require exportPeopleSearch(). Saves file to ~/Downloads.',
  notes:
    'Free accounts: capped at 125 results (5 pages) per search; tell the user if this limit is hit. Paid accounts can go deeper. For large exports, call in batches: limit=100, then pass lastPage+1 as startPage on the next call. Repeat until exported < limit or you have enough.',
  input: z.object({
    company: z.string().optional().describe('Company name to search'),
    titles: z.array(z.string()).optional().describe('Job titles to filter'),
    keywords: z.string().optional().describe('Keyword search'),
    locations: z.array(z.string()).optional().describe('Locations to filter'),
    filters: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Same filters as searchPeople: person_titles, person_seniorities, person_locations, q_organization_name, organization_num_employees_ranges, etc.',
      ),
    mode: ModeParam.optional().default('total'),
    limit: z
      .number()
      .optional()
      .default(100)
      .describe(
        'Max results per batch. Keep at 100 or below to avoid rate limits.',
      ),
    startPage: z
      .number()
      .optional()
      .default(1)
      .describe(
        'Starting page number. Pass lastPage+1 from a previous call to continue exporting.',
      ),
    format: z
      .enum(['csv', 'json'])
      .optional()
      .default('csv')
      .describe('Export format: csv (spreadsheet) or json'),
  }),
  output: z.object({
    exported: z.number().describe('Number of records exported in this batch'),
    requested: z.number().describe('Number of records requested'),
    totalAvailable: z.number().describe('Total matching results in Apollo'),
    lastPage: z
      .number()
      .describe('Last page fetched. Pass lastPage+1 as startPage to continue.'),
    filename: z.string().describe('Saved filename'),
    fileRef: z
      .union([
        z.object({
          path: z.string().describe('Absolute path on user device'),
          name: z.string().describe('Filename'),
          contentType: z.string().describe('MIME type'),
          size: z.number().describe('File size in bytes'),
        }),
        z.object({
          key: z.string().describe('Cloud storage key'),
          name: z.string().describe('Filename'),
          contentType: z.string().describe('MIME type'),
          size: z.number().describe('File size in bytes'),
        }),
      ])
      .describe('File reference: check path for the saved file location'),
  }),
};

export const exportPeopleSearchSchema = {
  name: 'exportPeopleSearch',
  description:
    'Export people search results with revealed emails and phones to a file. COSTS CREDITS; each person revealed consumes 1 export credit. Saves file to ~/Downloads.',
  notes:
    "This is Apollo's paid export; it reveals masked emails (and optionally phones) which costs credits. Use getPlanDetails() first to check totalCredits and warn the user. Each newly revealed contact consumes 1 credit. Already-revealed contacts are free to re-export.",
  input: z.object({
    keyword: z.string().optional().describe('Search keyword'),
    mode: ModeParam.optional().default('total'),
    filters: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Same filters as searchPeople: person_titles, person_seniorities, person_locations, q_organization_name, organization_num_employees_ranges, etc.',
      ),
    maxResults: z
      .number()
      .optional()
      .default(25)
      .describe(
        'Maximum results to export. Each newly revealed result costs 1 export credit. No hard cap; auto-paginates in batches of 25.',
      ),
    format: z
      .enum(['csv', 'json'])
      .optional()
      .default('csv')
      .describe('Export format: csv (spreadsheet) or json'),
    includePhones: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Also reveal phone numbers (costs additional direct dial credits)',
      ),
  }),
  output: z.object({
    exported: z.number().describe('Number of records exported'),
    creditsUsed: z.number().describe('Number of export credits consumed'),
    filename: z.string().describe('Saved filename'),
    fileRef: z
      .union([
        z.object({
          path: z.string().describe('Absolute path on user device'),
          name: z.string().describe('Filename'),
          contentType: z.string().describe('MIME type'),
          size: z.number().describe('File size in bytes'),
        }),
        z.object({
          key: z.string().describe('Cloud storage key'),
          name: z.string().describe('Filename'),
          contentType: z.string().describe('MIME type'),
          size: z.number().describe('File size in bytes'),
        }),
      ])
      .describe('File reference: check path for the saved file location'),
  }),
};

// ============================================================================
// CSV Import/Export Schemas
// ============================================================================

export const importCsvToListSchema = {
  name: 'importCsvToList',
  description:
    'Import contacts from a CSV file into an Apollo list. Reads the file via the @vallum/files library, auto-detects column mappings, and imports rows as contacts into a new or existing list.',
  notes:
    'Requires a fileRef from the @vallum/files library; first save or load the CSV file to get a reference, then pass it here. Column mapping is auto-detected from CSV headers (First Name → person_first_name, etc.) but can be overridden. Creates the list if it does not exist. IMPORTANT: emailEnrichment defaults to true, which costs 1 credit per contact for Apollo waterfall enrichment. Before importing, TELL THE USER: "Email enrichment is enabled by default; this costs 1 Apollo credit per contact (N credits total for this import). Without enrichment, imported contacts will have no email addresses and can\'t be used in sequences. Would you like to proceed with enrichment, or import without it?" If the user declines, set emailEnrichment: false. After import with enrichment, wait for processing to complete (1-2 minutes) before creating sequences. ' +
    'DEDUP: Apollo automatically deduplicates imported contacts against existing CRM data. The actual number of contacts created may be less than the CSV row count; Apollo merges or skips rows it considers duplicates (matching on email, name+company, or LinkedIn URL). The rowCount in the response reflects CSV rows sent, not contacts created. To verify actual import count, call getContactsInList() after import completes.',
  input: z.object({
    fileRef: z
      .object({
        path: z.string().describe('Absolute path on user device'),
        name: z.string().describe('Filename'),
      })
      .optional()
      .describe('File reference from @vallum/files library. Use save() to store a CSV first, or load() for an existing file. Provide either fileRef or csvContent.'),
    csvContent: z
      .string()
      .optional()
      .describe(
        'Raw CSV content as a string. Alternative to fileRef; provide one or the other.',
      ),
    fileName: z
      .string()
      .optional()
      .describe(
        'Filename for the import (used when providing csvContent). Defaults to import.csv.',
      ),
    listName: z
      .string()
      .describe(
        'Name of the list to import into. Created automatically if it does not exist.',
      ),
    mapping: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Optional CSV header → Apollo field mapping. If omitted, auto-detected from CSV headers. Common Apollo fields: person_first_name, person_last_name, person_title, person_email, organization_name, corporate_phone, person_linkedin_url, person_place_state.',
      ),
    actionIfDuplicate: z
      .enum(['update', 'skip'])
      .optional()
      .default('update')
      .describe(
        "'update' overwrites existing contact fields, 'skip' leaves existing contacts unchanged (default: update)",
      ),
    emailEnrichment: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        'Enable Apollo waterfall email enrichment for imported contacts (default: true). Costs 1 credit per contact. Without enrichment, imported contacts will have no email addresses and cannot be used in sequences. Set to false if you already have emails in the CSV or the user declines the credit cost.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the import was initiated'),
    importId: z.string().describe('Import job ID for tracking progress'),
    fileName: z.string().describe('Name of the imported file'),
    rowCount: z.number().describe('Number of rows in the CSV'),
    listName: z.string().describe('Name of the target list'),
    listId: z.string().describe('ID of the target list'),
    mapping: z
      .record(z.string(), z.string())
      .describe('Final CSV header → Apollo field mapping used'),
    detectedColumns: z
      .array(
        z.object({
          csvHeader: z.string().describe('CSV column header'),
          apolloField: z.string().describe('Mapped Apollo field name'),
        }),
      )
      .describe('Columns detected in the CSV with their auto-mapped fields'),
  }),
};

export const listExportsSchema = {
  name: 'listExports',
  description:
    'List CSV export jobs in Apollo with their status, row count, and credits consumed. Shows export history.',
  notes: '',
  input: z.object({
    page: z.number().optional().default(1).describe('Page number (default: 1)'),
    perPage: z
      .number()
      .optional()
      .default(25)
      .describe('Results per page (default: 25)'),
  }),
  output: z.object({
    exports: z
      .array(
        z.object({
          id: z.string().describe('Export job ID'),
          type: z.string().describe('Export type (e.g. "contacts")'),
          progress: z.number().describe('Completion progress (0.0 to 1.0)'),
          rows: z.number().describe('Number of rows in export'),
          credits: z.number().describe('Credits consumed'),
          createdAt: z.string().describe('ISO 8601 creation timestamp'),
          status: z
            .enum(['completed', 'in_progress'])
            .describe('Derived status based on progress'),
        }),
      )
      .describe('Export jobs'),
    pagination: z.object({
      page: z.number(),
      perPage: z.number(),
      totalEntries: z.number(),
      totalPages: z.number(),
    }),
  }),
};

export const exportContactsToCsvSchema = {
  name: 'exportContactsToCsv',
  description:
    'Export saved contacts to a CSV file via Apollo native export. No credits consumed; exports contacts already in your CRM. Saves file to ~/Downloads automatically. Pass listId to export an entire list, or contactIds for specific contacts.',
  notes:
    'Preferred: pass listId from viewLists() to export an entire list in one call; no need to fetch individual contact IDs. Alternative: pass contactIds for specific contacts. Uses Apollo native csv_exports endpoint; always exports CSV. Saves file to ~/Downloads; check fileRef.path in the response.',
  input: z.object({
    listId: z
      .string()
      .optional()
      .describe(
        'List ID to export all contacts from (from viewLists). Preferred over contactIds; exports the entire list in one call.',
      ),
    contactIds: z
      .array(z.string())
      .optional()
      .describe(
        'Array of CRM contact IDs to export. Alternative to listId; use when exporting specific contacts.',
      ),
    includeGuessedEmails: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        'Include unverified/guessed emails in the export (default: true)',
      ),
  }),
  output: z.object({
    exported: z.number().describe('Number of contacts exported'),
    filename: z.string().describe('Saved filename'),
    fileRef: z
      .union([
        z.object({
          path: z.string().describe('Absolute path on user device'),
          name: z.string().describe('Filename'),
          contentType: z.string().describe('MIME type'),
          size: z.number().describe('File size in bytes'),
        }),
        z.object({
          key: z.string().describe('Cloud storage key'),
          name: z.string().describe('Filename'),
          contentType: z.string().describe('MIME type'),
          size: z.number().describe('File size in bytes'),
        }),
      ])
      .describe('File reference: check path for the saved file location'),
  }),
};

// ============================================================================
// Saved Searches Schemas
// ============================================================================

export const getSavedSearchesSchema = {
  name: 'getSavedSearches',
  description: 'Get saved searches (finder views) in Apollo',
  notes: '',
  input: z.object({
    page: z.number().optional().default(1).describe('Page number (default: 1)'),
    perPage: z
      .number()
      .optional()
      .default(50)
      .describe('Results per page (default: 50)'),
    sortByField: z
      .string()
      .optional()
      .default('updated_at')
      .describe('Field to sort by (default: updated_at)'),
    sortAscending: z
      .boolean()
      .optional()
      .default(false)
      .describe('Sort order (default: false)'),
  }),
  output: z.object({
    finderViews: z
      .array(FinderViewSchema)
      .describe('Array of saved search/view objects'),
    customViews: z
      .array(FinderViewSchema)
      .describe('Filtered custom (non-system) views'),
    systemViews: z.array(FinderViewSchema).describe('Filtered system views'),
    pagination: PaginationSchema.optional().describe('Pagination metadata'),
  }),
};

export const createSavedSearchSchema = {
  name: 'createSavedSearch',
  description: 'Create a saved search with filters for quick access later',
  notes:
    'Pass search filters as signals. Signal keys are the same filter keys used in searchPeople/selectPeople; call getFilterFields() to discover all valid keys, and getFilterOptions() for valid values. Common signal keys: person_titles (array of title strings), person_locations (array of location strings), person_seniorities (array), organization_latest_funding_stage_cd (array of numeric codes: "0"=Seed, "1"=Angel, "2"=Series A, etc.), organization_num_employees_ranges (array like ["1,10", "51,100"]), person_department_or_subdepartments (array), q_keywords (string).',
  input: z.object({
    name: z.string().describe('Name for the saved search'),
    modality: SavedSearchModalityParam.optional().default('people'),
    signals: z
      .record(z.string(), z.unknown())
      .optional()
      .default({})
      .describe(
        'Search filter signals: person_titles (array), person_locations (array), organization_latest_funding_stage_cd (array of numeric codes: "0"=Seed, "1"=Angel, "2"=Series A, "3"=Series B, "4"=Series C, "5"=Series D), organization_num_employees_ranges (array)',
      ),
  }),
  output: z.object({
    id: z.string().describe('Saved search ID'),
    name: z.string().describe('Saved search name'),
    modality: z.string().describe('Saved search type'),
    signals: z
      .record(z.string(), z.unknown())
      .describe('Applied filter signals'),
  }),
};

export const updateSavedSearchSchema = {
  name: 'updateSavedSearch',
  description: 'Update a saved search: rename or change filters',
  notes: '',
  input: z.object({
    id: z.string().describe('Saved search ID'),
    name: z.string().optional().describe('New name for the saved search'),
    signals: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Updated filter signals'),
  }),
  output: z.object({
    id: z.string().describe('Saved search ID'),
    name: z.string().describe('Updated saved search name'),
    modality: z.string().describe('Saved search type'),
    signals: z
      .record(z.string(), z.unknown())
      .describe('Applied filter signals'),
  }),
};

// ============================================================================
// Credit-Costing Operations (Email/Phone Unlock) Schemas
// ============================================================================

export const unlockEmailSchema = {
  name: 'unlockEmail',
  description:
    'Save a person to your CRM and reveal their email address. Free by default; no credits consumed. Returns whatever email Apollo already has. Set useWaterfall=true to run waterfall enrichment for harder-to-find emails (costs 1 credit).',
  notes:
    'Requires a PERSON ID from selectPeople/searchPeople, NOT a contact ID from getContactsInList/addContactsToList. Calling with a contact ID will silently fail (returns no email). Basic call is free and works on all plans. Waterfall enrichment (useWaterfall=true) costs 1 credit and uses 3rd-party providers to find harder-to-find emails. Also saves the person as a CRM contact. Pass listName to simultaneously add to a list.',
  input: z.object({
    personId: z
      .string()
      .describe(
        "Person ID from Apollo's 275M database (returned by selectPeople or searchPeople). Must NOT be a contact ID; contact IDs from CSV imports or getContactsInList will fail silently.",
      ),
    useWaterfall: z
      .boolean()
      .optional()
      .describe(
        'Run waterfall enrichment to find emails via 3rd-party providers. Costs 1 credit. Default: false.',
      ),
    listName: z
      .string()
      .optional()
      .describe(
        'Also add the person to this named list. Creates the list if it does not exist.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the unlock succeeded'),
    contact: UnlockedContactSchema.optional().describe(
      'Contact with revealed email',
    ),
    error: z.string().optional().describe('Error message if failed'),
  }),
};

export const unlockPhoneSchema = {
  name: 'unlockPhone',
  description:
    'Save a person to your CRM and reveal their phone number. Free by default; no credits consumed. Returns any phone numbers Apollo already has. Set useEnrichment=true to run direct dial enrichment for finding direct phone numbers (costs 8 credits).',
  notes:
    'Requires a PERSON ID from selectPeople/searchPeople, NOT a contact ID from getContactsInList/addContactsToList. Basic call is free and works on all plans. Direct dial enrichment (useEnrichment=true) costs 8 credits and uses 3rd-party providers to find direct/mobile numbers. Also saves the person as a CRM contact. Pass listName to simultaneously add to a list.',
  input: z.object({
    personId: z
      .string()
      .describe(
        "Person ID from Apollo's 275M database (returned by selectPeople or searchPeople). Must NOT be a contact ID; contact IDs from CSV imports or getContactsInList will fail silently.",
      ),
    useEnrichment: z
      .boolean()
      .optional()
      .describe(
        'Run direct dial enrichment to find phone numbers via 3rd-party providers. Costs 8 credits. Default: false.',
      ),
    listName: z
      .string()
      .optional()
      .describe(
        'Also add the person to this named list. Creates the list if it does not exist.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the unlock succeeded'),
    contact: UnlockedContactSchema.optional().describe(
      'Contact with revealed phone',
    ),
    error: z.string().optional().describe('Error message if failed'),
  }),
};

// ============================================================================
// Filter Discovery
// ============================================================================

export const FacetOptionSchema = z.object({
  value: z.string().describe('Internal value to use in filters'),
  displayName: z.string().describe('Human-readable label'),
  count: z
    .number()
    .optional()
    .describe('Number of matching records (may be 0)'),
  category: z
    .string()
    .optional()
    .describe('Grouping category (e.g., in_progress, succeeded, failed)'),
});

export const FacetGroupSchema = z.object({
  name: z
    .string()
    .describe('Facet group name (e.g., latest_funding_stage_facets)'),
  filterKey: z
    .string()
    .describe(
      'The filter parameter name to use in search (e.g., organization_latest_funding_stage_cd)',
    ),
  options: z
    .array(FacetOptionSchema)
    .describe('Available values for this filter'),
});

export const FilterFieldSchema = z.object({
  key: z.string().describe('Filter parameter name to pass in filters object'),
  label: z.string().describe('Human-readable label'),
});

export const getFilterOptionsSchema = {
  name: 'getFilterOptions',
  description:
    "Get all available filter facets with valid values. Returns every enumerated filter option: funding stages, seniority, departments, employee ranges, revenue ranges, trading status, intent scores, forecast categories, contact/account stages, email status, phone types/statuses, job functions, market segments, and more. Call this to discover what filter values are valid before using searchPeople/searchCompanies. For industry/technology filtering, use searchFilterTags() instead. To check which features the user's plan supports, use getPlanDetails().",
  input: z.object({}),
  output: z.object({
    success: z.boolean(),
    facets: z
      .array(FacetGroupSchema)
      .describe('All available filter facets with their valid values'),
    error: z.string().optional(),
  }),
};

export const getFilterFieldsSchema = {
  name: 'getFilterFields',
  description:
    'Get all valid filter parameter names with human-readable labels. Returns every filter key that can be passed in the filters object to searchPeople/searchCompanies/selectPeople/selectCompanies. Use getFilterOptions() to get valid VALUES for specific filters.',
  input: z.object({
    search: z
      .string()
      .optional()
      .describe(
        'Filter field names containing this text (case-insensitive). E.g., "organization" to see company filters, "person" for people filters.',
      ),
  }),
  output: z.object({
    success: z.boolean(),
    fields: z
      .array(FilterFieldSchema)
      .describe('Available filter field names and their labels'),
    totalCount: z.number().describe('Total number of available filter fields'),
    error: z.string().optional(),
  }),
};

export const FilterTagSchema = z.object({
  id: z
    .string()
    .describe(
      'Tag ID to pass directly in filters. For industries: use in organization_linkedin_industry_tag_ids. For technologies: use in currently_using_any_of_technology_uids.',
    ),
  name: z.string().describe('Human-readable tag name'),
  category: z
    .string()
    .optional()
    .describe('Tag category (e.g., "CMS", "Analytics" for technologies)'),
  numOrganizations: z
    .number()
    .describe('Number of companies matching this tag'),
});

export const searchFilterTagsSchema = {
  name: 'searchFilterTags',
  description:
    'Search for filter tags by name. Use kind="linkedin_industry" for industries (filter key: organization_linkedin_industry_tag_ids) or kind="technology" for technologies (filter key: currently_using_any_of_technology_uids). Type a partial name like "software", "react", or "salesforce" to find matching tags.',
  input: z.object({
    kind: z
      .enum(['linkedin_industry', 'technology'])
      .describe(
        'Tag type to search: "linkedin_industry" for industries, "technology" for tech stack',
      ),
    query: z
      .string()
      .describe(
        'Tag name to search for (e.g., "software", "react", "salesforce")',
      ),
  }),
  notes:
    "ALWAYS check the returned tags array before using IDs in search filters. If empty, the technology or industry does not exist in Apollo's database; tell the user and suggest alternatives. Apollo's search API silently ignores invalid filter UIDs with no error, which can produce misleading results.",
  output: z.object({
    success: z.boolean(),
    tags: z
      .array(FilterTagSchema)
      .describe('Matching tags with IDs for filtering'),
    error: z.string().optional(),
  }),
};

export const CreditInfoSchema = z.object({
  totalCredits: z
    .number()
    .describe(
      'Total credits available this billing cycle (base plan + bonus credits). Remaining = totalCredits - creditsUsed.',
    ),
  creditsUsed: z
    .number()
    .describe(
      'Credits consumed this billing cycle. Remaining = totalCredits - creditsUsed.',
    ),
  costPerEmailReveal: z
    .number()
    .describe('Credits consumed per email reveal or export (typically 1)'),
  costPerPhoneReveal: z
    .number()
    .describe('Credits consumed per phone number reveal (typically 8)'),
  aiCredits: z.number().describe('Available AI credits'),
  unlimitedLeads: z
    .boolean()
    .describe('Whether the plan has unlimited lead credits'),
});

export const PlanProductSchema = z.object({
  productId: z
    .string()
    .describe('Product identifier (e.g., "professional_unified_v4")'),
  planId: z
    .string()
    .describe('Plan identifier (e.g., "professional_unified_v4_monthly_1")'),
  isTrial: z.boolean().describe('Whether this is a trial'),
  startDate: z.string().optional().describe('Plan start date'),
  endDate: z.string().optional().describe('Plan end date (trial expiry)'),
});

export const getPlanDetailsSchema = {
  name: 'getPlanDetails',
  description:
    'Get the current account plan details including enabled features, credits, and limits. Call this to understand what the user can and cannot do before attempting operations. Returns all active feature IDs (e.g., can_access_sequences, can_access_advanced_filters, can_filter_search_by_intent_data) and numeric limits per feature.',
  input: z.object({}),
  output: z.object({
    success: z.boolean(),
    plan: z
      .object({
        status: z
          .string()
          .describe('Account status (e.g., "trial", "active", "canceled")'),
        product: PlanProductSchema.optional().describe(
          'Active plan/product info',
        ),
        credits: CreditInfoSchema.describe('Available credits by type'),
        seatsLimit: z.number().describe('Maximum seats allowed'),
        seatsUsed: z.number().describe('Currently used seats'),
        mailboxLimit: z.number().describe('Maximum email accounts'),
        enabledFeatures: z
          .array(z.string())
          .describe(
            'All feature IDs enabled on this plan (e.g., can_access_sequences, can_access_advanced_filters, can_filter_search_by_intent_data, can_access_website_visitors)',
          ),
        featureLimitations: z
          .record(
            z.string(),
            z.record(z.string(), z.union([z.string(), z.number()])),
          )
          .describe(
            'Numeric limits per feature (e.g., {can_access_rules_engine: {rules_engine_limit: 50}})',
          ),
      })
      .describe('Plan details'),
    error: z.string().optional(),
  }),
};

// ============================================================================
// Calls Schemas
// ============================================================================

const PhoneCallSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'Phone call record. Common properties: id, status, duration, direction, ' +
      'start_time, end_time, recording_url, contact_id, account_id, user_id, note',
  );

const CallsPaginationSchema = z.object({
  page: z.number().describe('Current page number'),
  perPage: z.number().describe('Results per page'),
  totalEntries: z.number().describe('Total matching records'),
  totalPages: z.number().describe('Total number of pages'),
});

export const searchCallsSchema = {
  name: 'searchCalls',
  description: 'Search and paginate phone calls from Apollo dialer history',
  notes: '',
  input: z.object({
    page: z
      .number()
      .optional()
      .default(1)
      .describe('Page number (1-indexed, default: 1)'),
    perPage: z
      .number()
      .optional()
      .default(25)
      .describe('Results per page (default: 25)'),
    sortByField: z
      .string()
      .optional()
      .default('start_time')
      .describe('Field to sort by (default: start_time)'),
    sortAscending: z
      .boolean()
      .optional()
      .default(false)
      .describe('Sort ascending (default: false, newest first)'),
  }),
  output: z.object({
    phoneCalls: z
      .array(PhoneCallSchema)
      .describe('Array of phone call records'),
    pagination: CallsPaginationSchema.describe('Pagination metadata'),
  }),
};

export const getCallSchema = {
  name: 'getCall',
  description:
    'Get a single phone call by ID with full details including recording URL',
  notes: '',
  input: z.object({
    id: z.string().describe('Phone call ID'),
  }),
  output: z.object({
    phoneCall: PhoneCallSchema.describe('Full phone call record'),
  }),
};

export const downloadRecordingSchema = {
  name: 'downloadRecording',
  description:
    "Download a call recording (.wav) to the user's device. Only works for calls that have a recording_url.",
  notes:
    'Requires the Northlight agent to be running (window.__vallum_files). ' +
    'Throws if the call has no recording_url.',
  input: z.object({
    callId: z.string().describe('Phone call ID whose recording to download'),
    filename: z
      .string()
      .optional()
      .describe(
        'Output filename (default: derived from recording URL or {callId}.wav)',
      ),
    path: z
      .string()
      .optional()
      .default('~/Downloads')
      .describe(
        "Destination directory on the user's device (default: ~/Downloads)",
      ),
  }),
  output: z.object({
    fileRef: z
      .object({
        path: z.string().describe("Absolute path on the user's device"),
        name: z.string().describe('Filename'),
        contentType: z.string().describe('MIME type'),
        size: z.number().describe('File size in bytes'),
      })
      .describe('Reference to the downloaded file'),
    filename: z.string().describe('Filename used for the downloaded recording'),
  }),
};

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  // Context
  getContextSchema,
  // Search
  searchPeopleSchema,
  searchCompaniesSchema,
  // Contacts
  selectPeopleSchema,
  createContactSchema,
  updateContactSchema,
  deleteContactSchema,
  updateContactStageSchema,
  listContactStagesSchema,
  // Companies
  selectCompaniesSchema,
  viewCompanySchema,
  createAccountSchema,
  updateAccountSchema,
  deleteAccountSchema,
  updateAccountStageSchema,
  listAccountStagesSchema,
  // Lists
  createListSchema,
  viewListsSchema,
  updateListSchema,
  addContactsToListSchema,
  addCompaniesToListSchema,
  deleteListSchema,
  removeContactsFromListSchema,
  removeCompaniesFromListSchema,
  getContactsInListSchema,
  getAccountsInListSchema,
  // Sequences
  searchSequencesSchema,
  viewSequenceSchema,
  createSequenceSchema,
  updateSequenceSchema,
  deleteSequenceSchema,
  unarchiveSequenceSchema,
  addSequenceStepSchema,
  enableSequenceStepSchema,
  disableSequenceStepSchema,
  deleteSequenceStepSchema,
  updateSequenceStepSchema,
  duplicateSequenceStepSchema,
  addContactsToSequenceSchema,
  addListToSequenceSchema,
  resetFinishedContactsSchema,
  getSequenceContactsSchema,
  updateSequenceContactStatusSchema,
  cloneSequenceSchema,
  listSequenceSchedulesSchema,
  createSequenceScheduleSchema,
  updateSequenceScheduleSchema,
  deleteSequenceScheduleSchema,
  activateSequenceSchema,
  deactivateSequenceSchema,
  searchEmailsSchema,
  viewEmailSchema,
  getEmailAnalyticsSchema,
  sendEmailNowSchema,
  createEmailSchema,
  sendEmailSchema,
  // Email Templates
  searchEmailTemplatesSchema,
  createEmailTemplateSchema,
  updateEmailTemplateSchema,
  deleteEmailTemplateSchema,
  listTemplateVariablesSchema,
  // Deals
  searchDealsSchema,
  viewDealSchema,
  createDealSchema,
  updateDealSchema,
  deleteDealSchema,
  listDealStagesSchema,
  listDealPipelinesSchema,
  // Tasks
  searchTasksSchema,
  createTaskSchema,
  updateTaskSchema,
  completeTaskSchema,
  // Notes
  createNoteSchema,
  updateNoteSchema,
  deleteNoteSchema,
  // Custom Fields & Users
  listFieldsSchema,
  listUsersSchema,
  listEmailAccountsSchema,
  updateEmailAccountSchema,
  // Free Data Extraction
  freeExportPeopleSearchSchema,
  // Credit-Costing Export
  exportPeopleSearchSchema,
  // CSV Import/Export
  importCsvToListSchema,
  listExportsSchema,
  exportContactsToCsvSchema,
  // Saved Searches
  getSavedSearchesSchema,
  createSavedSearchSchema,
  updateSavedSearchSchema,
  // Credit-Costing Operations
  unlockEmailSchema,
  unlockPhoneSchema,
  // Filter Discovery
  getFilterOptionsSchema,
  getFilterFieldsSchema,
  searchFilterTagsSchema,
  // Plan & Account
  getPlanDetailsSchema,
  // Calls
  searchCallsSchema,
  getCallSchema,
  downloadRecordingSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

// Shared types
export type ModeType = z.infer<typeof ModeParam>;
export type ModalityType = z.infer<typeof ModalityParam>;
export type Pagination = z.infer<typeof PaginationSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type Company = z.infer<typeof CompanySchema>;
export type Label = z.infer<typeof LabelSchema>;
export type FinderView = z.infer<typeof FinderViewSchema>;
export type LinkedInData = z.infer<typeof LinkedInDataSchema>;
export type UnlockedContact = z.infer<typeof UnlockedContactSchema>;
export type PhoneNumber = z.infer<typeof PhoneNumberSchema>;
export type ContactEmail = z.infer<typeof ContactEmailSchema>;
export type Sequence = z.infer<typeof SequenceSchema>;
export type SequenceStep = z.infer<typeof SequenceStepSchema>;
export type EmailTemplate = z.infer<typeof EmailTemplateSchema>;
export type EmailTemplateFolder = z.infer<typeof EmailTemplateFolderSchema>;
export type Deal = z.infer<typeof DealSchema>;
export type DealStage = z.infer<typeof DealStageSchema>;
export type DealPipeline = z.infer<typeof DealPipelineSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Note = z.infer<typeof NoteSchema>;
export type ContactStage = z.infer<typeof ContactStageSchema>;
export type AccountStage = z.infer<typeof AccountStageSchema>;
export type Field = z.infer<typeof FieldSchema>;
export type FieldGroup = z.infer<typeof FieldGroupSchema>;
export type User = z.infer<typeof UserSchema>;
export type EmailAccount = z.infer<typeof EmailAccountSchema>;
export type SequenceSchedule = z.infer<typeof SequenceScheduleSchema>;
export type FacetOption = z.infer<typeof FacetOptionSchema>;
export type FacetGroup = z.infer<typeof FacetGroupSchema>;
export type FilterField = z.infer<typeof FilterFieldSchema>;
export type FilterTag = z.infer<typeof FilterTagSchema>;
export type CreditInfo = z.infer<typeof CreditInfoSchema>;
export type PlanProduct = z.infer<typeof PlanProductSchema>;

// Input types
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type SearchPeopleInput = z.infer<typeof searchPeopleSchema.input>;
export type SelectPeopleInput = z.infer<typeof selectPeopleSchema.input>;
export type CreateListInput = z.infer<typeof createListSchema.input>;
export type AddContactsToListInput = z.infer<
  typeof addContactsToListSchema.input
>;
export type AddCompaniesToListInput = z.infer<
  typeof addCompaniesToListSchema.input
>;
export type ViewListsInput = z.infer<typeof viewListsSchema.input>;
export type SearchCompaniesInput = z.infer<typeof searchCompaniesSchema.input>;
export type SelectCompaniesInput = z.infer<typeof selectCompaniesSchema.input>;
export type ViewCompanyInput = z.infer<typeof viewCompanySchema.input>;
export type FreeExportPeopleSearchInput = z.infer<
  typeof freeExportPeopleSearchSchema.input
>;
export type ExportPeopleSearchInput = z.infer<
  typeof exportPeopleSearchSchema.input
>;
export type ImportCsvToListInput = z.infer<typeof importCsvToListSchema.input>;
export type ListExportsInput = z.infer<typeof listExportsSchema.input>;
export type ExportContactsToCsvInput = z.infer<
  typeof exportContactsToCsvSchema.input
>;
export type GetSavedSearchesInput = z.infer<
  typeof getSavedSearchesSchema.input
>;
export type CreateSavedSearchInput = z.infer<
  typeof createSavedSearchSchema.input
>;
export type UpdateSavedSearchInput = z.infer<
  typeof updateSavedSearchSchema.input
>;
export type UnlockEmailInput = z.infer<typeof unlockEmailSchema.input>;
export type UnlockPhoneInput = z.infer<typeof unlockPhoneSchema.input>;
export type SearchSequencesInput = z.infer<typeof searchSequencesSchema.input>;
export type ViewSequenceInput = z.infer<typeof viewSequenceSchema.input>;
export type CreateSequenceInput = z.infer<typeof createSequenceSchema.input>;
export type UpdateSequenceInput = z.infer<typeof updateSequenceSchema.input>;
export type DeleteSequenceInput = z.infer<typeof deleteSequenceSchema.input>;
export type UnarchiveSequenceInput = z.infer<
  typeof unarchiveSequenceSchema.input
>;
export type AddSequenceStepInput = z.infer<typeof addSequenceStepSchema.input>;
export type EnableSequenceStepInput = z.infer<
  typeof enableSequenceStepSchema.input
>;
export type DisableSequenceStepInput = z.infer<
  typeof disableSequenceStepSchema.input
>;
export type DeleteSequenceStepInput = z.infer<
  typeof deleteSequenceStepSchema.input
>;
export type UpdateSequenceStepInput = z.infer<
  typeof updateSequenceStepSchema.input
>;
export type DuplicateSequenceStepInput = z.infer<
  typeof duplicateSequenceStepSchema.input
>;
export type AddContactsToSequenceInput = z.infer<
  typeof addContactsToSequenceSchema.input
>;
export type AddListToSequenceInput = z.infer<
  typeof addListToSequenceSchema.input
>;
export type ResetFinishedContactsInput = z.infer<
  typeof resetFinishedContactsSchema.input
>;
export type GetSequenceContactsInput = z.infer<
  typeof getSequenceContactsSchema.input
>;
export type UpdateSequenceContactStatusInput = z.infer<
  typeof updateSequenceContactStatusSchema.input
>;
export type CloneSequenceInput = z.infer<typeof cloneSequenceSchema.input>;
export type ListSequenceSchedulesInput = z.infer<
  typeof listSequenceSchedulesSchema.input
>;
export type CreateSequenceScheduleInput = z.infer<
  typeof createSequenceScheduleSchema.input
>;
export type UpdateSequenceScheduleInput = z.infer<
  typeof updateSequenceScheduleSchema.input
>;
export type DeleteSequenceScheduleInput = z.infer<
  typeof deleteSequenceScheduleSchema.input
>;
export type ActivateSequenceInput = z.infer<
  typeof activateSequenceSchema.input
>;
export type DeactivateSequenceInput = z.infer<
  typeof deactivateSequenceSchema.input
>;
export type SearchEmailsInput = z.infer<typeof searchEmailsSchema.input>;
export type ViewEmailInput = z.infer<typeof viewEmailSchema.input>;
export type GetEmailAnalyticsInput = z.infer<
  typeof getEmailAnalyticsSchema.input
>;
export type SendEmailNowInput = z.infer<typeof sendEmailNowSchema.input>;
export type CreateEmailInput = z.infer<typeof createEmailSchema.input>;
export type SendEmailInput = z.infer<typeof sendEmailSchema.input>;
export type SearchEmailTemplatesInput = z.infer<
  typeof searchEmailTemplatesSchema.input
>;
export type CreateEmailTemplateInput = z.infer<
  typeof createEmailTemplateSchema.input
>;
export type UpdateEmailTemplateInput = z.infer<
  typeof updateEmailTemplateSchema.input
>;
export type DeleteEmailTemplateInput = z.infer<
  typeof deleteEmailTemplateSchema.input
>;
export type SearchDealsInput = z.infer<typeof searchDealsSchema.input>;
export type ViewDealInput = z.infer<typeof viewDealSchema.input>;
export type CreateDealInput = z.infer<typeof createDealSchema.input>;
export type UpdateDealInput = z.infer<typeof updateDealSchema.input>;
export type DeleteDealInput = z.infer<typeof deleteDealSchema.input>;
export type ListDealStagesInput = z.infer<typeof listDealStagesSchema.input>;
export type ListDealPipelinesInput = z.infer<
  typeof listDealPipelinesSchema.input
>;
export type SearchTasksInput = z.infer<typeof searchTasksSchema.input>;
export type CreateTaskInput = z.infer<typeof createTaskSchema.input>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema.input>;
export type CompleteTaskInput = z.infer<typeof completeTaskSchema.input>;
export type CreateNoteInput = z.infer<typeof createNoteSchema.input>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema.input>;
export type DeleteNoteInput = z.infer<typeof deleteNoteSchema.input>;
export type CreateContactInput = z.infer<typeof createContactSchema.input>;
export type UpdateContactInput = z.infer<typeof updateContactSchema.input>;
export type DeleteContactInput = z.infer<typeof deleteContactSchema.input>;
export type UpdateContactStageInput = z.infer<
  typeof updateContactStageSchema.input
>;
export type ListContactStagesInput = z.infer<
  typeof listContactStagesSchema.input
>;
export type CreateAccountInput = z.infer<typeof createAccountSchema.input>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema.input>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema.input>;
export type UpdateAccountStageInput = z.infer<
  typeof updateAccountStageSchema.input
>;
export type ListAccountStagesInput = z.infer<
  typeof listAccountStagesSchema.input
>;
export type ListFieldsInput = z.infer<typeof listFieldsSchema.input>;
export type ListUsersInput = z.infer<typeof listUsersSchema.input>;
export type ListEmailAccountsInput = z.infer<
  typeof listEmailAccountsSchema.input
>;
export type UpdateEmailAccountInput = z.infer<
  typeof updateEmailAccountSchema.input
>;
export type UpdateListInput = z.infer<typeof updateListSchema.input>;
export type DeleteListInput = z.infer<typeof deleteListSchema.input>;
export type RemoveContactsFromListInput = z.infer<
  typeof removeContactsFromListSchema.input
>;
export type RemoveCompaniesFromListInput = z.infer<
  typeof removeCompaniesFromListSchema.input
>;
export type GetContactsInListInput = z.infer<
  typeof getContactsInListSchema.input
>;
export type GetAccountsInListInput = z.infer<
  typeof getAccountsInListSchema.input
>;
export type GetFilterOptionsInput = z.infer<
  typeof getFilterOptionsSchema.input
>;
export type GetFilterFieldsInput = z.infer<typeof getFilterFieldsSchema.input>;
export type SearchFilterTagsInput = z.infer<
  typeof searchFilterTagsSchema.input
>;
export type GetPlanDetailsInput = z.infer<typeof getPlanDetailsSchema.input>;

// Output types
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type SearchPeopleOutput = z.infer<typeof searchPeopleSchema.output>;
export type SelectPeopleOutput = z.infer<typeof selectPeopleSchema.output>;
export type CreateListOutput = z.infer<typeof createListSchema.output>;
export type AddContactsToListOutput = z.infer<
  typeof addContactsToListSchema.output
>;
export type AddCompaniesToListOutput = z.infer<
  typeof addCompaniesToListSchema.output
>;
export type ViewListsOutput = z.infer<typeof viewListsSchema.output>;
export type SearchCompaniesOutput = z.infer<
  typeof searchCompaniesSchema.output
>;
export type SelectCompaniesOutput = z.infer<
  typeof selectCompaniesSchema.output
>;
export type ViewCompanyOutput = z.infer<typeof viewCompanySchema.output>;
export type FreeExportPeopleSearchOutput = z.infer<
  typeof freeExportPeopleSearchSchema.output
>;
export type ExportPeopleSearchOutput = z.infer<
  typeof exportPeopleSearchSchema.output
>;
export type ImportCsvToListOutput = z.infer<
  typeof importCsvToListSchema.output
>;
export type ListExportsOutput = z.infer<typeof listExportsSchema.output>;
export type ExportContactsToCsvOutput = z.infer<
  typeof exportContactsToCsvSchema.output
>;
export type GetSavedSearchesOutput = z.infer<
  typeof getSavedSearchesSchema.output
>;
export type CreateSavedSearchOutput = z.infer<
  typeof createSavedSearchSchema.output
>;
export type UpdateSavedSearchOutput = z.infer<
  typeof updateSavedSearchSchema.output
>;
export type UnlockEmailOutput = z.infer<typeof unlockEmailSchema.output>;
export type UnlockPhoneOutput = z.infer<typeof unlockPhoneSchema.output>;
export type SearchSequencesOutput = z.infer<
  typeof searchSequencesSchema.output
>;
export type ViewSequenceOutput = z.infer<typeof viewSequenceSchema.output>;
export type CreateSequenceOutput = z.infer<typeof createSequenceSchema.output>;
export type UpdateSequenceOutput = z.infer<typeof updateSequenceSchema.output>;
export type DeleteSequenceOutput = z.infer<typeof deleteSequenceSchema.output>;
export type UnarchiveSequenceOutput = z.infer<
  typeof unarchiveSequenceSchema.output
>;
export type AddSequenceStepOutput = z.infer<
  typeof addSequenceStepSchema.output
>;
export type EnableSequenceStepOutput = z.infer<
  typeof enableSequenceStepSchema.output
>;
export type DisableSequenceStepOutput = z.infer<
  typeof disableSequenceStepSchema.output
>;
export type DeleteSequenceStepOutput = z.infer<
  typeof deleteSequenceStepSchema.output
>;
export type UpdateSequenceStepOutput = z.infer<
  typeof updateSequenceStepSchema.output
>;
export type DuplicateSequenceStepOutput = z.infer<
  typeof duplicateSequenceStepSchema.output
>;
export type AddContactsToSequenceOutput = z.infer<
  typeof addContactsToSequenceSchema.output
>;
export type AddListToSequenceOutput = z.infer<
  typeof addListToSequenceSchema.output
>;
export type ResetFinishedContactsOutput = z.infer<
  typeof resetFinishedContactsSchema.output
>;
export type GetSequenceContactsOutput = z.infer<
  typeof getSequenceContactsSchema.output
>;
export type UpdateSequenceContactStatusOutput = z.infer<
  typeof updateSequenceContactStatusSchema.output
>;
export type CloneSequenceOutput = z.infer<typeof cloneSequenceSchema.output>;
export type ListSequenceSchedulesOutput = z.infer<
  typeof listSequenceSchedulesSchema.output
>;
export type CreateSequenceScheduleOutput = z.infer<
  typeof createSequenceScheduleSchema.output
>;
export type UpdateSequenceScheduleOutput = z.infer<
  typeof updateSequenceScheduleSchema.output
>;
export type DeleteSequenceScheduleOutput = z.infer<
  typeof deleteSequenceScheduleSchema.output
>;
export type ActivateSequenceOutput = z.infer<
  typeof activateSequenceSchema.output
>;
export type DeactivateSequenceOutput = z.infer<
  typeof deactivateSequenceSchema.output
>;
export type SearchEmailsOutput = z.infer<typeof searchEmailsSchema.output>;
export type ViewEmailOutput = z.infer<typeof viewEmailSchema.output>;
export type GetEmailAnalyticsOutput = z.infer<
  typeof getEmailAnalyticsSchema.output
>;
export type SendEmailNowOutput = z.infer<typeof sendEmailNowSchema.output>;
export type CreateEmailOutput = z.infer<typeof createEmailSchema.output>;
export type SendEmailOutput = z.infer<typeof sendEmailSchema.output>;
export type SearchEmailTemplatesOutput = z.infer<
  typeof searchEmailTemplatesSchema.output
>;
export type CreateEmailTemplateOutput = z.infer<
  typeof createEmailTemplateSchema.output
>;
export type UpdateEmailTemplateOutput = z.infer<
  typeof updateEmailTemplateSchema.output
>;
export type DeleteEmailTemplateOutput = z.infer<
  typeof deleteEmailTemplateSchema.output
>;
export type ListTemplateVariablesOutput = z.infer<
  typeof listTemplateVariablesSchema.output
>;
export type SearchDealsOutput = z.infer<typeof searchDealsSchema.output>;
export type ViewDealOutput = z.infer<typeof viewDealSchema.output>;
export type CreateDealOutput = z.infer<typeof createDealSchema.output>;
export type UpdateDealOutput = z.infer<typeof updateDealSchema.output>;
export type DeleteDealOutput = z.infer<typeof deleteDealSchema.output>;
export type ListDealStagesOutput = z.infer<typeof listDealStagesSchema.output>;
export type ListDealPipelinesOutput = z.infer<
  typeof listDealPipelinesSchema.output
>;
export type SearchTasksOutput = z.infer<typeof searchTasksSchema.output>;
export type CreateTaskOutput = z.infer<typeof createTaskSchema.output>;
export type UpdateTaskOutput = z.infer<typeof updateTaskSchema.output>;
export type CompleteTaskOutput = z.infer<typeof completeTaskSchema.output>;
export type CreateNoteOutput = z.infer<typeof createNoteSchema.output>;
export type UpdateNoteOutput = z.infer<typeof updateNoteSchema.output>;
export type DeleteNoteOutput = z.infer<typeof deleteNoteSchema.output>;
export type CreateContactOutput = z.infer<typeof createContactSchema.output>;
export type UpdateContactOutput = z.infer<typeof updateContactSchema.output>;
export type DeleteContactOutput = z.infer<typeof deleteContactSchema.output>;
export type UpdateContactStageOutput = z.infer<
  typeof updateContactStageSchema.output
>;
export type ListContactStagesOutput = z.infer<
  typeof listContactStagesSchema.output
>;
export type CreateAccountOutput = z.infer<typeof createAccountSchema.output>;
export type UpdateAccountOutput = z.infer<typeof updateAccountSchema.output>;
export type DeleteAccountOutput = z.infer<typeof deleteAccountSchema.output>;
export type UpdateAccountStageOutput = z.infer<
  typeof updateAccountStageSchema.output
>;
export type ListAccountStagesOutput = z.infer<
  typeof listAccountStagesSchema.output
>;
export type ListFieldsOutput = z.infer<typeof listFieldsSchema.output>;
export type ListUsersOutput = z.infer<typeof listUsersSchema.output>;
export type ListEmailAccountsOutput = z.infer<
  typeof listEmailAccountsSchema.output
>;
export type UpdateEmailAccountOutput = z.infer<
  typeof updateEmailAccountSchema.output
>;
export type UpdateListOutput = z.infer<typeof updateListSchema.output>;
export type DeleteListOutput = z.infer<typeof deleteListSchema.output>;
export type RemoveContactsFromListOutput = z.infer<
  typeof removeContactsFromListSchema.output
>;
export type RemoveCompaniesFromListOutput = z.infer<
  typeof removeCompaniesFromListSchema.output
>;
export type GetContactsInListOutput = z.infer<
  typeof getContactsInListSchema.output
>;
export type GetAccountsInListOutput = z.infer<
  typeof getAccountsInListSchema.output
>;
export type GetFilterOptionsOutput = z.infer<
  typeof getFilterOptionsSchema.output
>;
export type GetFilterFieldsOutput = z.infer<
  typeof getFilterFieldsSchema.output
>;
export type SearchFilterTagsOutput = z.infer<
  typeof searchFilterTagsSchema.output
>;
export type GetPlanDetailsOutput = z.infer<typeof getPlanDetailsSchema.output>;
export type SearchCallsInput = z.infer<typeof searchCallsSchema.input>;
export type SearchCallsOutput = z.infer<typeof searchCallsSchema.output>;
export type GetCallInput = z.infer<typeof getCallSchema.input>;
export type GetCallOutput = z.infer<typeof getCallSchema.output>;
export type DownloadRecordingInput = z.infer<
  typeof downloadRecordingSchema.input
>;
export type DownloadRecordingOutput = z.infer<
  typeof downloadRecordingSchema.output
>;
