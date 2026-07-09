import { z } from 'zod';

// ============================================================================
// Shared entity — DomainSummary (owned by this batch; reused by domain reads)
// ============================================================================

export const DomainSummarySchema = z
  .object({
    name: z
      .string()
      .describe(
        'Fully-qualified domain name (lowercased), e.g. "example.com". This is the resource id used by every other domain function.',
      ),
    status: z
      .string()
      .nullish()
      .describe(
        'Domain lifecycle status code. Common values: ACTIVE (registered & active), REDEMPTION (expired, in the redemption grace window), EXPIRED, PENDING_TRANSFER, TRANSFER_AWAY. Treat as opaque.',
      ),
    expirationDate: z
      .string()
      .nullish()
      .describe('Registration expiration timestamp (ISO 8601), when present.'),
    autoRenew: z
      .boolean()
      .nullish()
      .describe('Whether auto-renew is currently ON for this domain.'),
    registrarLock: z
      .boolean()
      .nullish()
      .describe(
        'Whether the registrar (transfer) lock is ON. A locked domain cannot be transferred to another registrar until it is unlocked.',
      ),
    nameservers: z
      .array(z.string())
      .describe(
        'Authoritative nameservers for the domain. Empty array when none are set or none were returned.',
      ),
    privacy: z
      .string()
      .nullish()
      .describe(
        'Privacy/WHOIS-protection level code. Common values: FULL (full privacy), BASIC (limited), OPEN (none / public WHOIS). Null when not applicable.',
      ),
    renewalPrice: z
      .object({
        listPrice: z
          .number()
          .nullish()
          .describe(
            'Renewal list price in micro-units of the account currency (divide by 1,000,000 for the major-unit amount).',
          ),
      })
      .passthrough()
      .nullish()
      .describe(
        'Renewal pricing for the domain, when renewal-price data is available.',
      ),
  })
  .describe(
    'Summary view of a registered domain in the account portfolio. Shared shape returned by listDomains, getDomain, and searchDomains.',
  );

// ============================================================================
// Enums surfaced to the consuming agent
// ============================================================================

/** Friendly lifecycle buckets accepted by listDomains/searchDomains `state`. */
const DomainStateBucket = z
  .enum(['ACTIVE', 'REDEMPTION', 'ALL', 'INACTIVE', 'ACTION_NEEDED'])
  .describe(
    'Lifecycle bucket to include. ACTIVE = registered & active, REDEMPTION = domains in the post-expiration redemption window, ALL = active + redemption, INACTIVE = registered but status-zero (inactive) domains, ACTION_NEEDED = domains requiring registrant action (RAA). Omit for the default portfolio view (active + redemption).',
  );

const DomainSort = z
  .object({
    by: z
      .enum([
        'name',
        'expiration',
        'registeredDate',
        'autoRenew',
        'lock',
        'estimatedValue',
        'privacy',
        'protectionPlan',
        'nameservers',
        'forwarding',
        'ownershipDate',
        'profileName',
        'renewalPrice',
        'registrationType',
      ])
      .optional()
      .describe(
        'Sort column. Default: name. Friendly values are mapped to GoDaddy sort columns: name→domainName, expiration→expirationDate, registeredDate→createDate. GoDaddy does not support sorting the domain portfolio by status. Other options: autoRenew, lock, estimatedValue, privacy, protectionPlan, nameservers, forwarding, ownershipDate, profileName, renewalPrice, registrationType.',
      ),
    direction: z
      .enum(['ascending', 'descending'])
      .optional()
      .describe('Sort direction. Default: ascending.'),
  })
  .describe('Sort order. Defaults to name ascending.');

/** Action codes accepted by checkDomainActionEligibility. */
export const DOMAIN_ACTIONS = [
  'ADD_DELEGATE_PERMISSION',
  'ADD_DOMAIN_TO_FOLDER',
  'ADULT_BLOCKS_RENEW',
  'APPLY_DNS_TEMPLATE',
  'ASSIGN_PROFILE',
  'AUCTION',
  'AUCTIONS_LIST_FOR_SALE',
  'AUTO_RENEW',
  'CANCELLATION',
  'CANCEL_DBP',
  'CANCEL_DNS_HOSTING',
  'CANCEL_DOP',
  'CANCEL_PROTECTION_PLAN',
  'CARTLESS_REDEMPTION',
  'CARTLESS_RENEWAL',
  'CHANGE_ACCOUNT',
  'CHANGE_REGISTRANT',
  'CIRA_AGREEMENT',
  'CONTACTS',
  'DBP_STANDALONE',
  'DELEGATE_ACTIVATE_DOMAIN',
  'DISABLE_AUTO_RENEW',
  'DISABLE_LOCKING',
  'DOMAIN_CONSOLIDATE',
  'DOMAIN_LISTING_SERVICE',
  'DOP',
  'DOP_STANDALONE',
  'DOWNGRADE_PROTECTION_PLAN',
  'DOWNGRADE_PROTECTION_PLAN_TO_BETTER',
  'DOWNGRADE_PROTECTION_PLAN_TO_DOPCLONE',
  'DOWNGRADE_PROTECTION_PLAN_TO_DOPL',
  'EMAIL_AUTH_CODE',
  'ENABLE_AUTO_RENEW',
  'ENABLE_LOCKING',
  'FORWARDING',
  'IMPORT_ZONE_FILE',
  'INITIATE_ACCOUNTCHANGE',
  'INIT_PUSH_TRANSFER',
  'LOCKING',
  'MANAGE_CASH_PARKING',
  'MANAGE_DNS',
  'MANAGE_DNSSEC',
  'MANAGE_HOSTS',
  'MANAGE_NAMESERVERS',
  'MANAGE_SECONDARY_DNS',
  'NEXUS_MANAGEMENT',
  'PREMIUM_LISTING',
  'PREPARE_FOR_TRANSFER_OUT',
  'PRIVACY',
  'PRIVACY_DOWNGRADE',
  'PRIVACY_UPGRADE',
  'PROFILE_ADD',
  'PROFILE_CHANGE',
  'PROFILE_REMOVE',
  'RANDOMIZE_DBPEMAIL',
  'REDEEM_AFTER_CANCEL',
  'REDEEM_WITH_PROTECTION',
  'REDEMPTION',
  'RENEWAL',
  'RNV',
  'SET_PRIVACY',
  'SET_PRIVACY_TO_BASIC',
  'SET_PRIVACY_TO_FULL',
  'SET_PRIVACY_TO_OPEN',
  'TRANSFER_OUT',
  'UPDATE_DBP_EMAIL_SETTINGS',
  'UPDATE_DNSSEC',
  'UPDATE_HOSTS',
  'UPDATE_REGISTRAR_CONTACTS',
  'UPGRADE_PROTECTION_PLAN',
  'XXX_MEMBERSHIP_MANAGEMENT',
] as const;

const EligibilityEntrySchema = z
  .object({
    allowedDomainNames: z
      .array(z.string())
      .describe('Domains (lowercased) for which the action IS allowed.'),
    notAllowedDomainNames: z
      .array(z.string())
      .describe('Domains (lowercased) for which the action is NOT allowed.'),
    allowedDomainDetails: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Allowed domains grouped by requirement/qualifier code; value carries the domainNames and any requirements for that group.',
      ),
    notAllowedDomainDetails: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Blocked domains grouped by reason code (e.g. NotAllowedForTLD); value carries the domainNames in that group.',
      ),
  })
  .describe('Per-action eligibility breakdown.');

// ============================================================================
// listDomains
// ============================================================================

export const listDomainsSchema = {
  name: 'listDomains',
  description:
    "List the registered domains in the signed-in account's portfolio, each as a DomainSummary (status, expiration date, auto-renew, registrar lock, nameservers, privacy level, renewal price). Auto-paginates the full portfolio.",
  notes:
    'Operates on the signed-in session — takes no account id. Returns {domains:[], total:0} when the account owns no domains (not an error). `state` maps to backend domainState codes: ACTIVE→DCC_ACTIVE_REGISTERED_DOMAINS, REDEMPTION→REDEMPTION, ALL→both, INACTIVE→INACTIVE, ACTION_NEEDED→RAA_ACTION_NEEDED; omit for active+redemption (same as ALL). `folder` restricts to one folder id (from listFolders). `count` caps the returned list after fetching. All filter params are server-side and combined with AND; omit each for no restriction. For expiration filtering: minimumExpirationDays/maximumExpirationDays are integer days from today (negative = already expired). The nameservers param maps to the nameserverFilter API field.',
  input: z.object({
    state: DomainStateBucket.optional(),
    folder: z
      .string()
      .optional()
      .describe(
        'Folder id to restrict to (from listFolders). Omit for all folders.',
      ),
    sort: DomainSort.optional(),
    count: z
      .number()
      .optional()
      .describe(
        'Max domains to return. 0 is treated as no cap (same as omitting). Omit to return the entire portfolio (auto-paginated).',
      ),
    registrationTypes: z
      .array(
        z.enum([
          'NOT_SPECIFIED',
          'DOMAIN_NES',
          'ANNUAL_TERM_MONTHLY_PAYMENT',
          'LEASE_TO_OWN',
          'DOMAIN_BLOCK',
        ]),
      )
      .optional()
      .describe(
        'Filter by domain registration type. NOT_SPECIFIED and DOMAIN_NES = standard owned domains; ANNUAL_TERM_MONTHLY_PAYMENT = subscription-financed (bundled); LEASE_TO_OWN = leased domains; DOMAIN_BLOCK = blocked domain registrations. Multiple values are ORed.',
      ),
    isAutoRenewEnabled: z
      .boolean()
      .optional()
      .describe(
        'Filter by auto-renew state. true = auto-renew ON only, false = auto-renew OFF only. Omit for all.',
      ),
    isLocked: z
      .boolean()
      .optional()
      .describe(
        'Filter by registrar lock state. true = locked domains only, false = unlocked only. Omit for all.',
      ),
    privacyLevels: z
      .array(z.enum(['FULL', 'BASIC', 'OPEN']))
      .optional()
      .describe(
        'Filter by WHOIS privacy level. FULL = full privacy (Domain Privacy On), BASIC = limited/masked (Domain Privacy Limited), OPEN = no privacy (Domain Privacy Off). Multiple values are ORed.',
      ),
    protectionPlans: z
      .array(
        z.enum(['GOOD', 'DOPL', 'DOPCLONE', 'BETTER', 'BEST', 'NOTELIGIBLE']),
      )
      .optional()
      .describe(
        'Filter by protection plan tier. GOOD = None (no extra plan), DOPL = Full Protection, DOPCLONE = Ultimate Protection, BETTER = Full Privacy, BEST = Ultimate Security, NOTELIGIBLE = Non-Eligible. Multiple values are ORed.',
      ),
    tlds: z
      .array(z.string())
      .optional()
      .describe(
        'Filter to these TLD extensions, e.g. ["com", "net"]. Omit for all TLDs. Multiple values are ORed. The account\'s available TLDs can be fetched via the Extensions UI filter.',
      ),
    nameservers: z
      .array(z.string())
      .optional()
      .describe(
        'Filter to domains using these nameserver hostnames, e.g. ["ns1.example.com"]. Omit for all. The list of nameserver hostnames in use by the account can be found via the Nameservers UI filter.',
      ),
    minimumExpirationDays: z
      .number()
      .optional()
      .describe(
        'Lower bound on days until expiration (inclusive). Use negative values for already-expired domains (e.g. -400 = expired up to 400 days ago). Use 0 to include domains expiring today or later. Omit for no lower bound.',
      ),
    maximumExpirationDays: z
      .number()
      .optional()
      .describe(
        'Upper bound on days until expiration (inclusive). Use 0 to include only domains expiring today or already expired. Use 30 to include domains expiring within 30 days. Omit for no upper bound.',
      ),
    expiresStartDate: z
      .string()
      .optional()
      .describe(
        'Absolute start date for expiration range filter (ISO 8601 date string, e.g. "2024-01-01"). Filters domains whose expiration date is on or after this date. Use with expiresEndDate for a date range. Complements minimumExpirationDays/maximumExpirationDays — both may be sent together when using customDates.',
      ),
    expiresEndDate: z
      .string()
      .optional()
      .describe(
        'Absolute end date for expiration range filter (ISO 8601 date string, e.g. "2024-12-31"). Filters domains whose expiration date is on or before this date. Use with expiresStartDate for a date range. Complements minimumExpirationDays/maximumExpirationDays — both may be sent together when using customDates.',
      ),
    profileIds: z
      .array(z.string())
      .optional()
      .describe(
        'Filter to domains belonging to these profile ids (from listDomainProfiles). Omit for all profiles.',
      ),
    forwardingURL: z
      .string()
      .optional()
      .describe(
        'Filter to domains with a forwarding URL containing this string. Omit for all.',
      ),
    expiresOption: z
      .enum(['customDates', 'expireIn30', 'expired', 'expire18Ago'])
      .optional()
      .describe(
        'Expiration quick-select shorthand. expireIn30 = expiring within 30 days (sets min=0, max=30); expired = already expired in last 400 days (sets min=-400, max=0); expire18Ago = expired within last 18 days (sets min=-18, max=0); customDates = use minimumExpirationDays/maximumExpirationDays directly. Omit when not using a preset.',
      ),
    domainNamesFilter: z
      .object({
        names: z
          .array(z.string())
          .describe('List of fully-qualified domain names to match.'),
        type: z
          .enum(['INCLUDE', 'EXCLUDE'])
          .describe(
            'INCLUDE = return only the listed domains; EXCLUDE = return all domains except the listed ones.',
          ),
      })
      .optional()
      .describe(
        'Filter by an explicit set of domain names. type INCLUDE restricts results to only the listed domains (useful to fetch details for a known set). type EXCLUDE returns all domains except the listed ones. Mutually exclusive with domainNameContains — use one or the other.',
      ),
    domainNameContains: z
      .string()
      .optional()
      .describe(
        'Substring to match within domain names (server-side filter via domainNameContains). e.g. "shop" matches myshop.com and shopnow.net. Omit for all domains. Use searchDomains when you need just a substring match — this param combines substring filtering with all other listDomains filters.',
      ),
  }),
  output: z.object({
    domains: z
      .array(DomainSummarySchema)
      .describe('Matching domains. Empty when the account owns none.'),
    total: z
      .number()
      .describe(
        'Total domains matching the query (server-reported total when available, otherwise the number returned).',
      ),
  }),
};

// ============================================================================
// getDomain
// ============================================================================

export const getDomainSchema = {
  name: 'getDomain',
  description:
    'Get a single domain from the portfolio by name as a DomainSummary (status, expiration date, auto-renew, registrar lock, nameservers, privacy level, renewal price).',
  notes:
    'Searches active and redemption-window domains. Throws NotFound (404) when the domain is not found in either state. For richer detail (contacts, forwarding, nameservers, renewal terms) use the dedicated get* functions.',
  input: z.object({
    domainName: z
      .string()
      .describe('Fully-qualified domain name, e.g. "example.com".'),
  }),
  output: z.object({
    domain: DomainSummarySchema.describe('The matched domain.'),
  }),
};

// ============================================================================
// searchDomains
// ============================================================================

export const searchDomainsSchema = {
  name: 'searchDomains',
  description:
    'Search the account portfolio for owned domains whose name contains a substring, returning each match as a DomainSummary. Auto-paginates.',
  notes:
    'Substring match on the domain name. Optional `tld` further restricts to that extension (e.g. "com" or ".com"), matched by suffix. `state` maps to backend domainState codes (ACTIVE→DCC_ACTIVE_REGISTERED_DOMAINS, REDEMPTION→REDEMPTION, ALL→both; default active+redemption). Returns {domains:[], total:0} when nothing matches. This searches domains the account ALREADY OWNS — to check whether an unregistered domain is available to buy, use checkDomainAvailability instead.',
  input: z.object({
    query: z
      .string()
      .min(1)
      .describe(
        'Substring to match within domain names (e.g. "shop" matches myshop.com and shopnow.net).',
      ),
    tld: z
      .string()
      .optional()
      .describe(
        'Restrict to this TLD/extension, e.g. "com" or ".com". Omit for all.',
      ),
    state: DomainStateBucket.optional(),
    count: z
      .number()
      .optional()
      .describe('Max domains to return. Omit for all matches.'),
    sort: DomainSort.optional(),
    folder: z
      .string()
      .optional()
      .describe(
        'Folder id to restrict to (from listFolders). Omit for all folders.',
      ),
    registrationTypes: z
      .array(
        z.enum([
          'NOT_SPECIFIED',
          'DOMAIN_NES',
          'ANNUAL_TERM_MONTHLY_PAYMENT',
          'LEASE_TO_OWN',
        ]),
      )
      .optional()
      .describe(
        'Filter by domain registration type. NOT_SPECIFIED and DOMAIN_NES = standard owned domains; ANNUAL_TERM_MONTHLY_PAYMENT = subscription-financed (bundled); LEASE_TO_OWN = leased domains. Multiple values are ORed.',
      ),
    isAutoRenewEnabled: z
      .boolean()
      .optional()
      .describe(
        'Filter by auto-renew state. true = auto-renew ON only, false = auto-renew OFF only. Omit for all.',
      ),
    isLocked: z
      .boolean()
      .optional()
      .describe(
        'Filter by registrar lock state. true = locked domains only, false = unlocked only. Omit for all.',
      ),
    privacyLevels: z
      .array(z.enum(['FULL', 'BASIC', 'OPEN']))
      .optional()
      .describe(
        'Filter by WHOIS privacy level. FULL = full privacy, BASIC = limited/masked, OPEN = no privacy. Multiple values are ORed.',
      ),
    protectionPlans: z
      .array(
        z.enum(['GOOD', 'DOPL', 'DOPCLONE', 'BETTER', 'BEST', 'NOTELIGIBLE']),
      )
      .optional()
      .describe(
        'Filter by protection plan tier. GOOD = None, DOPL = Full Protection, DOPCLONE = Ultimate Protection, BETTER = Full Privacy, BEST = Ultimate Security, NOTELIGIBLE = Non-Eligible. Multiple values are ORed.',
      ),
    tlds: z
      .array(z.string())
      .optional()
      .describe(
        'Filter to these TLD extensions, e.g. ["com", "net"]. Multiple values are ORed. Omit for all.',
      ),
    nameservers: z
      .array(z.string())
      .optional()
      .describe(
        'Filter to domains using these nameserver hostnames. Omit for all.',
      ),
    minimumExpirationDays: z
      .number()
      .optional()
      .describe(
        'Lower bound on days until expiration. Negative values match already-expired domains. Omit for no lower bound.',
      ),
    maximumExpirationDays: z
      .number()
      .optional()
      .describe(
        'Upper bound on days until expiration. Use 30 for expiring-within-30-days. Omit for no upper bound.',
      ),
    profileIds: z
      .array(z.string())
      .optional()
      .describe(
        'Filter to domains belonging to these profile ids (from listDomainProfiles). Omit for all.',
      ),
    forwardingURL: z
      .string()
      .optional()
      .describe(
        'Filter to domains with a forwarding URL containing this string. Omit for all.',
      ),
    expiresOption: z
      .enum(['customDates', 'expireIn30', 'expired', 'expire18Ago'])
      .optional()
      .describe(
        'Expiration quick-select shorthand. expireIn30 = expiring within 30 days (sets min=0, max=30); expired = already expired in last 400 days (sets min=-400, max=0); expire18Ago = expired within last 18 days (sets min=-18, max=0); customDates = use minimumExpirationDays/maximumExpirationDays directly. Omit when not using a preset.',
      ),
  }),
  output: z.object({
    domains: z.array(DomainSummarySchema).describe('Matching domains.'),
    total: z
      .number()
      .describe(
        'Total matching domains (server-reported total when no tld filter is applied, otherwise the number returned).',
      ),
  }),
};

// ============================================================================
// checkDomainActionEligibility
// ============================================================================

export const checkDomainActionEligibilitySchema = {
  name: 'checkDomainActionEligibility',
  description:
    'Check whether a management action is allowed on one or more domains before attempting it — returns which domains are eligible and which are not, grouped by reason. Use to gate a write (auto-renew, lock, privacy, nameservers, transfer, renewal, etc.) instead of attempting it and handling failures.',
  notes:
    'Result is keyed by the requested action; domain names in the result are lowercased. The action is sent as a GoDaddy eligibility action code inside an actions array. notAllowedDomainDetails groups blocked domains by reason code (e.g. NotAllowedForTLD). Invalid `action`, `domainStates`, `privacyLevels`, and `registrationTypes` values are rejected client-side before the API call. The full set of valid `action` values is in the input schema enum (70 values). Common actions: ENABLE_AUTO_RENEW, DISABLE_AUTO_RENEW, RENEWAL, REDEMPTION, TRANSFER_OUT, CONTACTS, ENABLE_LOCKING, DISABLE_LOCKING, PRIVACY, SET_PRIVACY, PRIVACY_UPGRADE, PRIVACY_DOWNGRADE, MANAGE_DNS, MANAGE_NAMESERVERS, EMAIL_AUTH_CODE, CANCELLATION, CHANGE_REGISTRANT, CANCEL_PROTECTION_PLAN, UPDATE_DNSSEC.',
  input: z.object({
    domainNames: z
      .array(z.string())
      .min(1)
      .describe('Domains to check (FQDNs).'),
    action: z
      .enum(DOMAIN_ACTIONS)
      .describe('The action to test eligibility for.'),
    additionalActions: z
      .array(z.enum(DOMAIN_ACTIONS))
      .optional()
      .describe(
        'Additional actions to check eligibility for in the same request. The API accepts multiple actions at once; all results are returned keyed by action name in the eligibility map. E.g. ["UPGRADE_PROTECTION_PLAN", "DOWNGRADE_PROTECTION_PLAN"] alongside action="DOP_STANDALONE" checks all three in one call.',
      ),
    domainStates: z
      .array(z.enum(['ACTIVE', 'REDEMPTION']))
      .optional()
      .describe(
        'Lifecycle states to include. Default: both ACTIVE and REDEMPTION. Use ["ACTIVE"] to restrict to active-only, ["REDEMPTION"] to redemption-window-only.',
      ),
    folderIds: z
      .array(z.string())
      .optional()
      .describe(
        'Restrict the check to domains in these folder ids (from listFolders). Omit for all folders.',
      ),
    isAutoRenewEnabled: z
      .boolean()
      .optional()
      .describe(
        'Narrow to domains with auto-renew ON (true) or OFF (false). Omit for all.',
      ),
    isLocked: z
      .boolean()
      .optional()
      .describe(
        'Narrow to domains with registrar lock ON (true) or OFF (false). Omit for all.',
      ),
    privacyLevels: z
      .array(z.enum(['FULL', 'BASIC', 'OPEN']))
      .optional()
      .describe(
        'Narrow to domains with these privacy levels. FULL = full privacy, BASIC = limited/masked, OPEN = no privacy. Multiple values are ORed. Omit for all.',
      ),
    registrationTypes: z
      .array(
        z.enum([
          'NOT_SPECIFIED',
          'DOMAIN_NES',
          'ANNUAL_TERM_MONTHLY_PAYMENT',
          'LEASE_TO_OWN',
        ]),
      )
      .optional()
      .describe(
        'Narrow to domains with these registration types. NOT_SPECIFIED/DOMAIN_NES = standard owned, ANNUAL_TERM_MONTHLY_PAYMENT = subscription-financed, LEASE_TO_OWN = leased. Omit for all.',
      ),
    domainNameContains: z
      .string()
      .optional()
      .describe(
        'Narrow to domains whose name contains this substring. Omit for all.',
      ),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(2500)
      .optional()
      .describe(
        'Max domains to evaluate per request. Must be a positive integer between 1 and 2500. Default: 500. Reduce if the request times out.',
      ),
    tlds: z
      .array(z.string())
      .optional()
      .describe(
        'Narrow to domains with these TLD extensions, e.g. ["com", "net"]. Multiple values are ORed. Omit for all TLDs.',
      ),
    protectionPlans: z
      .array(
        z.enum(['GOOD', 'DOPL', 'DOPCLONE', 'BETTER', 'BEST', 'NOTELIGIBLE']),
      )
      .optional()
      .describe(
        'Narrow to domains with these protection plan tiers. GOOD = None, DOPL = Full Protection, DOPCLONE = Ultimate Protection, BETTER = Full Privacy, BEST = Ultimate Security, NOTELIGIBLE = Non-Eligible. Multiple values are ORed. Omit for all.',
      ),
    minimumExpirationDays: z
      .number()
      .optional()
      .describe(
        'Lower bound on days until expiration (inclusive). Negative values match already-expired domains. Omit for no lower bound.',
      ),
    maximumExpirationDays: z
      .number()
      .optional()
      .describe(
        'Upper bound on days until expiration (inclusive). Use 30 to match domains expiring within 30 days. Omit for no upper bound.',
      ),
    expiresOption: z
      .enum(['customDates', 'expireIn30', 'expired', 'expire18Ago'])
      .optional()
      .describe(
        'Expiration quick-select shorthand. expireIn30 = expiring within 30 days; expired = already expired in last 400 days; expire18Ago = expired within last 18 days; customDates = use minimumExpirationDays/maximumExpirationDays directly. Omit when not using a preset.',
      ),
    nameservers: z
      .array(z.string())
      .optional()
      .describe(
        'Narrow to domains using these nameserver hostnames, e.g. ["ns1.example.com"]. Omit for all.',
      ),
    forwardingURL: z
      .string()
      .optional()
      .describe(
        'Narrow to domains with a forwarding URL containing this string. Omit for all.',
      ),
    profileIds: z
      .array(z.string())
      .optional()
      .describe(
        'Narrow to domains belonging to these profile ids (from listDomainProfiles). Omit for all.',
      ),
  }),
  output: z.object({
    eligibility: z
      .record(z.string(), EligibilityEntrySchema)
      .describe(
        'Eligibility keyed by action name; the requested action appears as the key.',
      ),
  }),
};

// ============================================================================
// Registry + inferred output types
// ============================================================================

export const domainReadCoreSchemas = [
  listDomainsSchema,
  getDomainSchema,
  searchDomainsSchema,
  checkDomainActionEligibilitySchema,
];

export type DomainSummary = z.infer<typeof DomainSummarySchema>;
export type ListDomainsOutput = z.infer<typeof listDomainsSchema.output>;
export type GetDomainOutput = z.infer<typeof getDomainSchema.output>;
export type SearchDomainsOutput = z.infer<typeof searchDomainsSchema.output>;
export type CheckDomainActionEligibilityOutput = z.infer<
  typeof checkDomainActionEligibilitySchema.output
>;
