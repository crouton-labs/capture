import { z } from 'zod';

// ============================================================================
// Shared shapes
// ============================================================================

export const LifecycleWriteResultSchema = z
  .object({
    orderId: z
      .string()
      .optional()
      .describe(
        'Order/receipt id when the operation produced a completed order.',
      ),
    basketId: z
      .string()
      .optional()
      .describe(
        'Cart/basket id when the operation staged items for checkout instead of charging immediately.',
      ),
    status: z
      .string()
      .optional()
      .describe(
        'Operation status reported by the backend, when present. Treat as opaque.',
      ),
    message: z
      .string()
      .optional()
      .describe(
        'Human-readable status/error message from the backend, when present.',
      ),
  })
  .passthrough()
  .describe(
    'Confirmation payload from a commerce/lifecycle write. Common keys: orderId, basketId, status, message. Some lifecycle writes stage a cart/basket for checkout instead of charging immediately; others return an order confirmation. Treat extra keys as opaque.',
  );

// ============================================================================
// setDomainPrivacy
// ============================================================================

export const setDomainPrivacySchema = {
  name: 'setDomainPrivacy',
  description:
    'Add, remove, upgrade, or downgrade WHOIS privacy / domain protection on one or more domains.',
  notes:
    'action values: "add" = add privacy (Domain Basic Privacy); "remove" = cancel privacy; "upgrade" = move to a higher protection-plan tier; "downgrade" = move to a lower tier. Protection-plan tiers, low→high: Basic, Full, Ultimate. ⚠ BILLING: "add" and "upgrade" incur a real charge — confirm the change and price with the user before calling with those actions; "remove" and "downgrade" do not add a charge. Verify the domains qualify first with checkDomainActionEligibility (actions SET_PRIVACY, PRIVACY_UPGRADE, PRIVACY_DOWNGRADE, CANCEL_DBP).',
  input: z.object({
    domainNames: z
      .array(z.string())
      .min(1)
      .describe(
        'Domains to change privacy/protection on. Each must be a domain in the signed-in account.',
      ),
    action: z
      .enum(['add', 'remove', 'upgrade', 'downgrade'])
      .describe(
        'Privacy/protection change to apply. "add" and "upgrade" incur a charge.',
      ),
  }),
  output: z.object({
    action: z
      .enum(['add', 'remove', 'upgrade', 'downgrade'])
      .describe('The action that was applied.'),
    domainNames: z
      .array(z.string())
      .describe('Domains the action was requested for.'),
    result: LifecycleWriteResultSchema.describe(
      'Backend confirmation of the privacy/protection change.',
    ),
  }),
};

// ============================================================================
// renewDomain
// ============================================================================

export const renewDomainSchema = {
  name: 'renewDomain',
  description: 'Renew a single domain for a number of additional years.',
  notes:
    '⚠ BILLING: renewing a domain incurs a real charge — confirm the term length and price with the user before calling. years is the number of additional registration years (typically 1–10, capped by the TLD maximum).',
  input: z.object({
    domainName: z
      .string()
      .describe(
        'Domain to renew, e.g. "example.com". Must be in the signed-in account.',
      ),
    years: z
      .number()
      .int()
      .min(1)
      .describe('Number of additional years to renew for.'),
    discountCode: z
      .string()
      .optional()
      .describe(
        'Promo or discount code to apply to the renewal (reduces the renewal price). Omit if no code is available.',
      ),
    isc: z
      .string()
      .optional()
      .describe(
        'Internal sale code for affiliate/partner attribution. Omit unless you have a valid ISC code for the renewal.',
      ),
  }),
  output: z.object({
    domainName: z.string().describe('Domain that was renewed.'),
    years: z.number().describe('Years requested.'),
    result: LifecycleWriteResultSchema.describe(
      'Backend confirmation of the renewal.',
    ),
  }),
};

// ============================================================================
// renewDomains
// ============================================================================

export const renewDomainsSchema = {
  name: 'renewDomains',
  description:
    'Renew multiple domains for the same number of additional years in one request.',
  notes:
    '⚠ BILLING: renewing domains incurs a real charge for every domain — confirm the list, term length, and total price with the user before calling. years applies to all domains in the batch.',
  input: z.object({
    domainNames: z
      .array(z.string())
      .min(1)
      .describe('Domains to renew. All renew for the same term.'),
    years: z
      .number()
      .int()
      .min(1)
      .describe('Number of additional years to renew each domain for.'),
    isc: z
      .string()
      .optional()
      .describe(
        'Internal sale code for affiliate/partner attribution. Omit unless you have a valid ISC code for the renewal.',
      ),
  }),
  output: z.object({
    domainNames: z.array(z.string()).describe('Domains that were renewed.'),
    years: z.number().describe('Years requested for each domain.'),
    result: LifecycleWriteResultSchema.describe(
      'Backend confirmation of the bulk renewal.',
    ),
  }),
};

// ============================================================================
// consolidateDomainExpirations
// ============================================================================

export const consolidateDomainExpirationsSchema = {
  name: 'consolidateDomainExpirations',
  description:
    'Align the expiration dates of multiple domains onto a single common date.',
  notes:
    'Consolidates the listed domains onto one expiration/renewal date so they renew together. ⚠ Extending terms to reach the target date may incur a real renewal charge — confirm the target date and affected domains with the user before calling. Use getDomainRenewalTerms or listDomains to inspect current expiration dates.',
  input: z.object({
    domainNames: z
      .array(z.string())
      .min(2)
      .describe('Domains whose expiration dates to align (at least two).'),
    targetDate: z
      .string()
      .describe(
        'Target expiration date (ISO 8601, e.g. "2027-12-31") to consolidate all domains onto. Required.',
      ),
    submitPartialSuccess: z
      .boolean()
      .optional()
      .describe(
        'When true, apply consolidation for eligible domains even if some in the list are ineligible. Default false (all-or-nothing).',
      ),
  }),
  output: z.object({
    domainNames: z
      .array(z.string())
      .describe('Domains included in the consolidation.'),
    targetDate: z.string().describe('Target date requested.'),
    result: LifecycleWriteResultSchema.describe(
      'Backend confirmation of the consolidation.',
    ),
  }),
};

// ============================================================================
// Registry + types
// ============================================================================

export const domainWriteLifecycleSchemas = [
  setDomainPrivacySchema,
  renewDomainSchema,
  renewDomainsSchema,
  consolidateDomainExpirationsSchema,
];

export type LifecycleWriteResult = z.infer<typeof LifecycleWriteResultSchema>;
export type SetDomainPrivacyOutput = z.infer<
  typeof setDomainPrivacySchema.output
>;
export type RenewDomainOutput = z.infer<typeof renewDomainSchema.output>;
export type RenewDomainsOutput = z.infer<typeof renewDomainsSchema.output>;
export type ConsolidateDomainExpirationsOutput = z.infer<
  typeof consolidateDomainExpirationsSchema.output
>;
