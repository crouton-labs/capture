import { z } from 'zod';

// ============================================================================
// Shared entity shapes
// ============================================================================

export const DomainAvailabilitySchema = z
  .object({
    domain: z
      .string()
      .describe(
        'The fully-qualified domain that was checked, e.g. "example.com".',
      ),
    available: z
      .boolean()
      .optional()
      .describe(
        'True when the domain can be registered now. Absent when the upstream check was inconclusive.',
      ),
    definitive: z
      .boolean()
      .optional()
      .describe(
        'True when the availability answer is definitive rather than tentative.',
      ),
    period: z
      .number()
      .optional()
      .describe(
        'Registration period quoted by the availability response, in years.',
      ),
    premium: z
      .boolean()
      .optional()
      .describe(
        'True when the domain is a premium / aftermarket listing (priced well above the standard registration fee).',
      ),
    price: z
      .number()
      .optional()
      .describe(
        'Buy price shown for registering the domain, in account-currency micro-units. Divide by 1,000,000 for display. Absent when unavailable or not quoted.',
      ),
    renewalPrice: z
      .number()
      .optional()
      .describe(
        'Renewal price quoted for the domain, in account-currency micro-units. Divide by 1,000,000 for display.',
      ),
    currency: z
      .string()
      .optional()
      .describe('ISO currency code for `price`, e.g. "USD", when quoted.'),
  })
  .passthrough()
  .describe(
    'Availability and pricing for a single domain. Extra upstream fields are passed through as returned.',
  );

export const DomainSuggestionSchema = z
  .object({
    domain: z
      .string()
      .describe('A suggested fully-qualified domain related to the keyword.'),
    available: z
      .boolean()
      .optional()
      .describe('True when the suggested domain can be registered now.'),
    price: z
      .number()
      .optional()
      .describe(
        'Buy price for the suggested domain in account-currency micro-units, when quoted. Divide by 1,000,000 for display.',
      ),
    currency: z
      .string()
      .optional()
      .describe('ISO currency code for `price`, e.g. "USD", when quoted.'),
  })
  .passthrough()
  .describe(
    'A suggested fully-qualified domain. Availability and price are optional quote data when the backend includes them. Extra upstream fields are passed through.',
  );

export const TldPricingSchema = z
  .object({
    tld: z
      .string()
      .describe(
        'The TLD this pricing applies to, without the leading dot, e.g. "com".',
      ),
  })
  .passthrough()
  .describe(
    'Pricing for one TLD. Common keys: `NONE`, `BASIC`, `PREMIUM`, `PRO`; each key maps to a tier object with `price` and `renewalPrice` in account-currency micro-units. Divide by 1,000,000 for display. All upstream fields are passed through as returned.',
  );

export const ActivityEntrySchema = z
  .object({
    resourceId: z
      .string()
      .optional()
      .describe(
        'Id of the resource the action targeted (e.g. a domain or product id).',
      ),
    resourceType: z
      .string()
      .optional()
      .describe(
        'Type/category of the resource, e.g. "domain". Treat as opaque.',
      ),
    action: z
      .string()
      .optional()
      .describe('What happened, e.g. an action/event code. Treat as opaque.'),
    date: z
      .string()
      .optional()
      .describe('When the action occurred (ISO timestamp), when present.'),
    domainName: z
      .string()
      .optional()
      .describe('Domain the action related to, when applicable.'),
  })
  .passthrough()
  .describe(
    "One account audit-log / activity entry across the account's domains and products. Extra upstream fields are passed through as returned.",
  );

// ============================================================================
// checkDomainAvailability
// ============================================================================

export const checkDomainAvailabilitySchema = {
  name: 'checkDomainAvailability',
  description:
    'Check whether one or more fully-qualified domains are available to register, with the quoted buy price (micro-units) for each. Use before suggesting or registering a domain.',
  notes:
    'Open any `*.godaddy.com` page first. Checks whether each domain can be registered now (is unregistered and available to buy) — this discovers NEW domains, not the account\'s existing portfolio; use listDomains or searchDomains for domains the account already owns. Pass fully-qualified domains (name + TLD), e.g. "example.com". Any quoted `price` / `renewalPrice` values are account-currency micro-units; divide by 1,000,000 for display. Returns one result per input domain, in input order.',
  input: z.object({
    domains: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        'Fully-qualified domains to check, e.g. ["example.com", "example.io"].',
      ),
    checkType: z
      .enum(['FAST', 'FULL'])
      .optional()
      .describe(
        'Controls check thoroughness. FAST (default) is quick but may return definitive:false for some TLDs; FULL does a deeper registry lookup and always returns a definitive answer. Omit for default behavior.',
      ),
    forTransfer: z
      .boolean()
      .optional()
      .describe(
        'When true, checks whether the domain is eligible to be transferred (i.e. registered elsewhere and transferable), rather than whether it can be newly registered. Omit (default false) to check new-registration availability.',
      ),
  }),
  output: z.object({
    results: z
      .array(DomainAvailabilitySchema)
      .describe('One availability result per requested domain.'),
    total: z
      .number()
      .describe('Number of domains checked (equals results length).'),
  }),
};

// ============================================================================
// getDomainSuggestions
// ============================================================================

export const getDomainSuggestionsSchema = {
  name: 'getDomainSuggestions',
  description:
    'Get suggested fully-qualified domain names related to a keyword or seed term. Use to brainstorm registerable domains.',
  notes:
    'Open any `*.godaddy.com` page first. Pass a keyword or seed term (with or without a TLD). Suggestions come from the rendered GoDaddy domain search surface; returned domains are keyed by `domain`, and any quoted `price` values are account-currency micro-units.',
  input: z.object({
    keyword: z
      .string()
      .min(1)
      .describe(
        'Keyword or seed term to generate suggestions from, e.g. "coffee" or "mybrand.com".',
      ),
    limit: z
      .number()
      .optional()
      .describe('Maximum number of suggestions to return. Defaults to 10.'),
    tlds: z
      .array(z.string())
      .optional()
      .describe(
        'Restrict suggestions to these TLDs (without leading dot), e.g. ["com", "io", "ai"].',
      ),
    sources: z
      .array(z.enum(['CC_TLD', 'EXTENSION', 'KEYWORD_SPIN', 'PREMIUM']))
      .optional()
      .describe(
        'Suggestion source types to include. CC_TLD = country-code TLD variants, EXTENSION = TLD extension variants, KEYWORD_SPIN = keyword permutations, PREMIUM = premium/aftermarket domains. Omit for all sources.',
      ),
    lengthMin: z
      .number()
      .optional()
      .describe(
        'Minimum domain label length (characters before the TLD). Omit for no minimum.',
      ),
    lengthMax: z
      .number()
      .optional()
      .describe(
        'Maximum domain label length (characters before the TLD). Omit for no maximum.',
      ),
    country: z
      .string()
      .optional()
      .describe(
        'ISO 3166-1 alpha-2 country code (e.g. "US", "FR") to bias suggestions toward that market.',
      ),
    city: z
      .string()
      .optional()
      .describe(
        'City name to bias suggestions toward a locale (e.g. "Seattle"). Use with `country` for best effect.',
      ),
    waitMs: z
      .number()
      .optional()
      .describe(
        'Maximum milliseconds the backend should wait for all suggestion sources before returning. Lower values trade completeness for speed.',
      ),
  }),
  output: z.object({
    suggestions: z
      .array(DomainSuggestionSchema)
      .describe(
        'Suggested domains related to the keyword; availability and price are only present when quoted.',
      ),
    total: z.number().describe('Number of suggestions returned.'),
  }),
};

// ============================================================================
// getTldPricing
// ============================================================================

export const getTldPricingSchema = {
  name: 'getTldPricing',
  description:
    'Get quoted best-price tiers for one or more TLDs in account-currency micro-units. Use to compare TLD costs before registering or transferring.',
  notes:
    'Open the DCC control page first. Pass TLDs without the leading dot (e.g. "com", "io"); a leading dot is tolerated. Prices are returned in account-currency micro-units; divide by 1,000,000 for display. All TLDs in the batch must be valid and recognized by GoDaddy — a single unrecognized TLD causes the upstream API to return HTTP 500 and the entire call fails. Only pass TLDs you are confident GoDaddy supports (e.g. "com", "net", "org", "io", "ai").',
  input: z.object({
    tlds: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        'TLDs to price, without the leading dot, e.g. ["com", "io", "ai"].',
      ),
  }),
  output: z.object({
    currency: z
      .string()
      .optional()
      .describe('ISO currency code the prices are quoted in, e.g. "USD".'),
    pricing: z
      .array(TldPricingSchema)
      .describe('One pricing entry per quoted TLD.'),
  }),
};

// ============================================================================
// listAccountActivity
// ============================================================================

export const listAccountActivitySchema = {
  name: 'listAccountActivity',
  description:
    "List recent account activity / audit-log entries across the account's domains and products (who changed what, when). Use to review the history of account actions.",
  notes:
    'Open the DCC control page first. Requires Domain Protection on at least one domain; accounts without it return an empty list. Newest entries first by default. `count` caps how many entries are returned; the full history is paged through internally.',
  input: z.object({
    count: z
      .number()
      .optional()
      .describe(
        'Maximum number of activity entries to return. Omit for the full available history.',
      ),
    dateSort: z
      .enum(['ASC', 'DESC'])
      .optional()
      .describe(
        'Sort direction for the date/time column. ASC = oldest first, DESC = newest first (default).',
      ),
    startDate: z
      .string()
      .optional()
      .describe(
        'Start of date range filter (ISO timestamp, e.g. "2026-01-01T00:00:00.000Z"). Use with endDate.',
      ),
    endDate: z
      .string()
      .optional()
      .describe(
        'End of date range filter (ISO timestamp, e.g. "2026-06-19T23:59:59.999Z"). Use with startDate.',
      ),
    userType: z
      .enum(['SHOPPER', 'DELEGATE', 'EMPLOYEE', 'UNKNOWN'])
      .optional()
      .describe(
        'Filter by user type. SHOPPER = account owner actions, DELEGATE = delegate user actions, EMPLOYEE = GoDaddy employee actions, UNKNOWN = unidentified user type. Omit for all.',
      ),
    activity: z
      .array(
        z.enum([
          'ADD_DELEGATE_PERMISSION',
          'ADD_DNS_RECORD',
          'ADD_SUBDOMAIN_FORWARDING',
          'APPLY_DNS_TEMPLATE',
          'ASSIGN_TO_FOLDER',
          'ASSIGN_TO_PROFILE',
          'CANCEL_DOMAIN',
          'CANCEL_DOP',
          'CHANGE_REGISTRANT',
          'DELETE_DNS_RECORD',
          'DELETE_DOMAIN_FORWARDING',
          'DELETE_SUBDOMAIN_FORWARDING',
          'DISABLE_AUTORENEW',
          'DISABLE_PRIVACY',
          'DISABLE_LOCK',
          'DOWNGRADE_DOP',
          'DOWNLOAD_DOMAIN_EXPORT',
          'EXPORT_DOMAIN_LIST',
          'IMPORT_ZONE_FILE',
          'LIST_FOR_SALE',
          'MANAGE_CASH_PARKING',
          'MANAGE_PROFILE',
          'PREPARE_TRANSFER',
          'PUSH_TRANSFER',
          'UPDATE_CONTACT',
          'UPDATE_DNS_RECORD',
          'UPDATE_DOMAIN_FORWARDING',
          'UPDATE_NAMESERVERS',
          'UPDATE_SUBDOMAIN_FORWARDING',
          'UNKNOWN',
        ]),
      )
      .optional()
      .describe(
        'Filter by one or more activity/action codes. Omit for all activity types. Multiple values are OR-combined.',
      ),
    statuses: z
      .array(z.enum(['SUCCEEDED', 'INITIATED', 'FAILED']))
      .optional()
      .describe(
        'Filter by activity status. SUCCEEDED = completed successfully, INITIATED = in-progress, FAILED = errored. Omit for all statuses.',
      ),
    changeValidated: z
      .array(z.enum(['YES', 'NO']))
      .optional()
      .describe(
        'Filter by whether the change was validated (e.g. via 2FA). YES = validated, NO = not validated. Omit for all.',
      ),
  }),
  output: z.object({
    activity: z
      .array(ActivityEntrySchema)
      .describe('Account activity entries, newest first.'),
    total: z
      .number()
      .optional()
      .describe(
        'Total activity entries available before truncation, when reported by the backend.',
      ),
  }),
};

// ============================================================================
// Registry + inferred output types
// ============================================================================

export const discoveryActivitySchemas = [
  checkDomainAvailabilitySchema,
  getDomainSuggestionsSchema,
  getTldPricingSchema,
  listAccountActivitySchema,
];

export type DomainAvailability = z.infer<typeof DomainAvailabilitySchema>;
export type DomainSuggestion = z.infer<typeof DomainSuggestionSchema>;
export type TldPricing = z.infer<typeof TldPricingSchema>;
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;

export type CheckDomainAvailabilityOutput = z.infer<
  typeof checkDomainAvailabilitySchema.output
>;
export type GetDomainSuggestionsOutput = z.infer<
  typeof getDomainSuggestionsSchema.output
>;
export type GetTldPricingOutput = z.infer<typeof getTldPricingSchema.output>;
export type ListAccountActivityOutput = z.infer<
  typeof listAccountActivitySchema.output
>;
