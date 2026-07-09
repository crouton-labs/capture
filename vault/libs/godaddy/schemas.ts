import { z } from 'zod';

// Split-module schema arrays (spread into allSchemas) + full re-export of each
// module's entity schemas and inferred types so consumers can import them.
import { domainReadCoreSchemas } from './schemas-domain-read-core';
import { domainReadDetailSchemas } from './schemas-domain-read-detail';
import { domainWriteSettingsSchemas } from './schemas-domain-write-settings';
import { domainWriteLifecycleSchemas } from './schemas-domain-write-lifecycle';
import { transfersSchemas } from './schemas-transfers';
import { foldersSchemas } from './schemas-folders';
import { profilesSchemas } from './schemas-profiles';
import { dnsReadSchemas } from './schemas-dns-read';
import { dnsWriteSchemas } from './schemas-dns-write';
import { nameserversVanitySchemas } from './schemas-nameservers-vanity';
import { dnssecSchemas } from './schemas-dnssec';
import { dnsTemplatesSchemas } from './schemas-dns-templates';
import { billingReadSchemas } from './schemas-billing-read';
import { billingWriteSchemas } from './schemas-billing-write';
import { sslSchemas } from './schemas-ssl';
import { accountProfileSchemas } from './schemas-account-profile';
import { accountSecuritySchemas } from './schemas-account-security';
import { accountDashboardSchemas } from './schemas-account-dashboard';
import { discoveryActivitySchemas } from './schemas-discovery-activity';

export * from './schemas-domain-read-core';
export * from './schemas-domain-read-detail';
export * from './schemas-domain-write-settings';
export * from './schemas-domain-write-lifecycle';
export * from './schemas-transfers';
export * from './schemas-folders';
export * from './schemas-profiles';
export * from './schemas-dns-read';
export * from './schemas-dns-write';
export * from './schemas-nameservers-vanity';
export * from './schemas-dnssec';
export * from './schemas-dns-templates';
export * from './schemas-billing-read';
export * from './schemas-billing-write';
export * from './schemas-ssl';
export * from './schemas-account-profile';
export * from './schemas-account-security';
export * from './schemas-account-dashboard';
export * from './schemas-discovery-activity';

export const libraryDescription =
  'GoDaddy account billing, renewals, and auto-renew operations.';

export const libraryIcon = '/icons/libs/godaddy.svg';

export const loginUrl = 'https://account.godaddy.com';

export const libraryNotes = `
## Workflow

1. Open the relevant GoDaddy host while signed in (renewals/billing live on \`account.godaddy.com\`; DCC auth, domains, and DNS live on \`dcc.godaddy.com\`).
2. Call \`getContext()\` FIRST — it confirms the session and resolves the account identity (\`customerId\` UUID, \`shopperId\`, email, market, currency, privateLabelId) used implicitly by every other call.
3. Read before you write: list/get/search the entity, then mutate. DCC domain-settings functions and DNS **record** write functions (createDnsRecord, createDnsRecords, updateDnsRecord, updateDnsRecords, deleteDnsRecord, deleteDnsRecords) accept \`dryRun\` so you can preview the effect before applying it. DNS hosting management (addDnsHosting, cancelDnsHosting) and commerce functions (renewDomain, renewDomains, setDomainPrivacy, consolidateDomainExpirations) do NOT support dryRun.

## Key Concepts

- **Context-implicit auth.** Auth is the signed-in session's cookies. Functions never take \`customerId\`/\`shopperId\`/\`market\` — they resolve from context. Pass only real arguments (domain names, record data, ids, filters).
- **GoDaddy origin prerequisite.** Session-bound reads should start from the host that serves the endpoint: account/billing on \`account.godaddy.com\`, DCC auth/domains/DNS on \`dcc.godaddy.com\`.
- **Scope.** Covers the whole GoDaddy account: domains (read, settings, lifecycle, transfers, folders, profiles), DNS (zones, records, vanity nameservers, DNSSEC, templates), billing/subscriptions, SSL certificates, account profile/security/dashboard, and domain discovery.
- **IDs.** \`customerId\` is the account UUID; \`shopperId\` is the numeric shopper id. Domains are keyed by domain name; subscriptions, folders, profiles, templates, and certificates by their own opaque ids.
- **dryRun.** Domain-settings and DNS **record** write functions (create/update/delete record) accept \`dryRun?: boolean\` (default \`false\`). \`true\` validates/previews without applying. DNS hosting management (addDnsHosting, cancelDnsHosting) and commerce functions (renew, privacy, consolidation) do NOT accept dryRun.
- **revision.** Billing/subscription writes use an optimistic-concurrency \`revision\` token. Read the subscription first to get its current revision; the write round-trips it (auto-renew toggles do this for you). A stale revision is rejected.
- **renewalPrice is micro-units.** Domain/subscription prices are integer micro-units — divide by 1,000,000 for the currency amount (e.g. \`12990000\` = 12.99).
- **Empty state is clean, never an error.** New or test-tier accounts may own zero domains, DNS zones, or certificates. Lists return an empty array with \`total: 0\` — empty is a valid result, not a failure.
- **⚠ Real charges.** Renewing domains or subscriptions, starting an inbound transfer, and adding privacy/protection products place real, billable orders. Confirm with the user before invoking any renew / transfer-in / add-privacy function. (Auto-renew toggles do NOT charge.)
- **SSL is read-only.** Only certificate list/search is available; issuing, reissuing, downloading, or revoking certificates is not exposed.
- **Pagination is automatic.** \`list*\`/\`search*\` functions page internally and accept an optional \`count\` to cap results (domains use cursor/marker paging, DNS uses page-number paging, subscriptions use offset paging — handled for you).
- **Enum codes live in function \`notes\`.** Domain states, action enums, DNS record types, and product-family keys are documented per-function; these values are not discoverable at runtime, so read the relevant function's \`notes\` before passing a code.
- **Pace account.godaddy.com.** The account/billing host is rate-sensitive; avoid bursting parallel calls against it. Writes there are eventually consistent — trust the write response over an immediate re-read.
`;

// ============================================================================
// Shared params / shapes
// ============================================================================

export const SubscriptionSchema = z
  .object({
    subscriptionId: z
      .string()
      .describe(
        'Opaque subscription id. Use with getSubscription / setSubscriptionAutoRenew.',
      ),
    productName: z
      .string()
      .optional()
      .describe(
        'Display name / label of the product (also exposed as `title`).',
      ),
    productFamily: z
      .string()
      .optional()
      .describe('Product family key. Treat as opaque.'),
    productType: z
      .string()
      .optional()
      .describe('Finer product type within the family.'),
    status: z
      .string()
      .optional()
      .describe('Subscription status code. Treat as opaque.'),
    autoRenew: z
      .boolean()
      .optional()
      .describe('Whether auto-renew is currently ON.'),
    renewalDate: z
      .string()
      .optional()
      .describe('Next renewal date (ISO string), when present.'),
    revision: z
      .union([z.string(), z.number()])
      .optional()
      .describe(
        'Opaque token carried with the subscription; write functions handle it for you. Treat as opaque.',
      ),
    paymentProfileId: z
      .string()
      .optional()
      .describe('Payment method id used for renewal, when set.'),
    isDomainSubscription: z
      .boolean()
      .optional()
      .describe('Whether this subscription is domain-related.'),
    numberOfTerms: z
      .union([z.string(), z.number()])
      .optional()
      .describe('Renewal term count, when present.'),
    termType: z
      .string()
      .optional()
      .describe('Renewal term type, when present.'),
  })
  .describe(
    'A billing subscription projected from the renewals launch response.',
  );

// ============================================================================
// getContext
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Resolve the signed-in GoDaddy account identity: customerId (UUID), shopperId (numeric), email, fullName, market, currency, and privateLabelId. Confirms the session is authenticated.',
  notes: 'Call FIRST on an account.godaddy.com page.',
  input: z.object({}),
  output: z.object({
    customerId: z
      .string()
      .describe('Customer UUID — scopes subscription/billing reads.'),
    shopperId: z.string().describe('Numeric shopper id.'),
    email: z.string().optional().describe('Signed-in account email.'),
    market: z
      .string()
      .optional()
      .describe('Account market/locale, e.g. "en-US".'),
    currency: z.string().optional().describe('Account currency, e.g. "USD".'),
    privateLabelId: z
      .union([z.string(), z.number()])
      .optional()
      .describe('Private label id (plid); 1 for retail GoDaddy.'),
    fullName: z
      .string()
      .optional()
      .describe('Account holder name when available.'),
  }),
};

// ============================================================================
// listSubscriptions
// ============================================================================

const listRenewalsInputSchema = z.object({
  productFamilies: z
    .array(z.string())
    .optional()
    .describe('Restrict to these product family codes. Omit for all families.'),
  status: z
    .string()
    .optional()
    .describe(
      'Restrict to a status code (e.g. "ACTIVE", "FREEMIUM"). Omit for all.',
    ),
  autoRenew: z
    .boolean()
    .optional()
    .describe(
      'Filter by auto-renew state: true = auto-renew ON, false = auto-renew OFF. Omit for all.',
    ),
  count: z
    .number()
    .optional()
    .describe('Max subscriptions to return after filtering. Omit for all.'),
  search: z
    .string()
    .optional()
    .describe(
      'Case-insensitive text search across product name, domain common name, and TLD. Omit to return all.',
    ),
  expiresWithinDays: z
    .number()
    .optional()
    .describe(
      'Return only subscriptions expiring within this many days (daysToExpire <= N). Common values: 30, 90. Omit for all.',
    ),
  missingPayment: z
    .boolean()
    .optional()
    .describe(
      'When true, return only subscriptions with no payment profile attached. When false, return only those with a payment profile. Omit for all.',
    ),
});

const listRenewalsOutputSchema = z.object({
  subscriptions: z
    .array(SubscriptionSchema)
    .describe('Matching subscriptions.'),
  total: z
    .number()
    .optional()
    .describe(
      'Total subscriptions matching the query before truncation, when reported.',
    ),
});

export const listSubscriptionsSchema = {
  name: 'listSubscriptions',
  description:
    "List the account's renewals/billing-managed subscriptions, each with its status, renewal date, auto-renew state, and the revision concurrency token. Use to see what renews and whether auto-renew is on.",
  notes:
    'Filters are optional; omit for the full list. productFamilies and status use internal codes (see SubscriptionSchema).',
  input: listRenewalsInputSchema,
  output: listRenewalsOutputSchema,
};

export const listRenewalsSchema = {
  name: 'listRenewals',
  description:
    "List the account's renewals/billing-managed subscriptions, each with its status, renewal date, auto-renew state, and the revision concurrency token. Use to see what renews and whether auto-renew is on.",
  notes:
    'Alias of listSubscriptions for renewal-focused tasks. Filters are optional; omit for the full list. productFamilies and status use internal codes (see SubscriptionSchema).',
  input: listRenewalsInputSchema,
  output: listRenewalsOutputSchema,
};

// ============================================================================
// getSubscription
// ============================================================================

export const getSubscriptionSchema = {
  name: 'getSubscription',
  description:
    'Get one subscription by id, including its current status, renewal date, and auto-renew state.',
  notes: '',
  input: z.object({
    subscriptionId: z
      .string()
      .describe('Subscription id from listSubscriptions.'),
  }),
  output: z.object({
    subscription: SubscriptionSchema.describe(
      'The subscription detail, including revision.',
    ),
  }),
};

// ============================================================================
// setSubscriptionAutoRenew
// ============================================================================

export const setSubscriptionAutoRenewSchema = {
  name: 'setSubscriptionAutoRenew',
  description:
    'Turn auto-renew ON or OFF for one or more subscriptions. No charge; reversible.',
  notes:
    'Does NOT renew or cancel anything and incurs no charge — it only flips the auto-renew flag. Pass the subscription ids and the desired state. For a charge-incurring renewal use a renew function (not this one).',
  input: z.object({
    subscriptionIds: z
      .array(z.string())
      .min(1)
      .describe(
        'One or more subscription ids to update. Format is "service:numericId" (e.g. "airobuildr:1510235589"). Obtain ids from listSubscriptions.',
      ),
    autoRenew: z
      .boolean()
      .describe('Desired auto-renew state: true = ON, false = OFF.'),
  }),
  output: z.object({
    updated: z
      .array(
        z.object({
          subscriptionId: z.string(),
          autoRenew: z.boolean().describe('The state now set.'),
        }),
      )
      .describe('Subscriptions whose auto-renew was changed.'),
  }),
};

// ============================================================================
// Registry + types
// ============================================================================

export const allSchemas = [
  getContextSchema,
  listSubscriptionsSchema,
  listRenewalsSchema,
  getSubscriptionSchema,
  setSubscriptionAutoRenewSchema,
  ...domainReadCoreSchemas,
  ...domainReadDetailSchemas,
  ...domainWriteSettingsSchemas,
  ...domainWriteLifecycleSchemas,
  ...transfersSchemas,
  ...foldersSchemas,
  ...profilesSchemas,
  ...dnsReadSchemas,
  ...dnsWriteSchemas,
  ...nameserversVanitySchemas,
  ...dnssecSchemas,
  ...dnsTemplatesSchemas,
  ...billingReadSchemas,
  ...billingWriteSchemas,
  ...sslSchemas,
  ...accountProfileSchemas,
  ...accountSecuritySchemas,
  ...accountDashboardSchemas,
  ...discoveryActivitySchemas,
];

export type Subscription = z.infer<typeof SubscriptionSchema>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type ListSubscriptionsOutput = z.infer<
  typeof listSubscriptionsSchema.output
>;
export type ListRenewalsOutput = z.infer<typeof listRenewalsSchema.output>;
export type GetSubscriptionOutput = z.infer<
  typeof getSubscriptionSchema.output
>;
export type SetSubscriptionAutoRenewOutput = z.infer<
  typeof setSubscriptionAutoRenewSchema.output
>;
