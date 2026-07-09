import { z } from 'zod';

// ============================================================================
// Shared entity shapes (billing-read)
// ============================================================================

export const SubscriptionSummarySchema = z
  .object({
    subscriptionId: z
      .string()
      .describe(
        'Opaque subscription id. Use with the renewals/auto-renew write functions.',
      ),
    productName: z
      .string()
      .optional()
      .describe('Display name of the product, when present.'),
    label: z
      .string()
      .optional()
      .describe(
        'User-facing label (e.g. the domain or subdomain the product is tied to).',
      ),
    productFamily: z
      .string()
      .optional()
      .describe(
        'Product family code (treat as opaque; discover via listProductFamilies).',
      ),
    productType: z
      .string()
      .optional()
      .describe('Finer product type within the family.'),
    status: z
      .string()
      .optional()
      .describe(
        'Subscription status code returned by the backend — treat as opaque; match it exactly when filtering.',
      ),
    autoRenew: z
      .boolean()
      .optional()
      .describe('Whether auto-renew is currently ON.'),
    expiresAt: z
      .string()
      .optional()
      .describe('Next expiry / renewal date (ISO string), when present.'),
    createdAt: z
      .string()
      .optional()
      .describe(
        'When the subscription was created (ISO string), when present.',
      ),
  })
  .passthrough()
  .describe(
    'A billing subscription as returned by the account subscriptions surface. Extra provider fields pass through.',
  );

export const EntitlementSchema = z
  .object({
    entitlementId: z
      .string()
      .optional()
      .describe('Opaque entitlement id, when present.'),
    uri: z
      .string()
      .optional()
      .describe('Relative URI path for this entitlement.'),
    status: z
      .string()
      .optional()
      .describe(
        'Entitlement status code — treat as opaque (e.g. "ACTIVE", "PENDING-PROVISION").',
      ),
    productFamily: z
      .string()
      .optional()
      .describe(
        'Product family code at the root level (treat as opaque; discover via listProductFamilies).',
      ),
    autoRenew: z
      .boolean()
      .optional()
      .describe('Whether auto-renew is currently ON for this entitlement.'),
    isThirdParty: z
      .boolean()
      .optional()
      .describe(
        'Whether this entitlement was provisioned by a third-party provider rather than GoDaddy directly.',
      ),
    isHardBundled: z
      .boolean()
      .optional()
      .describe('Whether this entitlement is part of a hard bundle.'),
    statusUpdatedAt: z
      .string()
      .optional()
      .describe(
        'ISO timestamp of the last status change for this entitlement.',
      ),
    source: z
      .string()
      .optional()
      .describe(
        'Provisioning source identifier (e.g. "LEGACY"). Treat as opaque.',
      ),
    subscriptionUri: z
      .string()
      .optional()
      .describe(
        'Relative URI of the billing subscription backing this entitlement, when present.',
      ),
    commonName: z
      .string()
      .optional()
      .describe(
        'User-facing label for the entitlement (e.g. business name or domain name), when present.',
      ),
    customerId: z
      .string()
      .optional()
      .describe('Customer UUID this entitlement belongs to.'),
    productKey: z
      .string()
      .optional()
      .describe('Opaque product key for this entitlement, when present.'),
    product: z
      .object({
        productFamily: z.string().optional(),
        productType: z.string().optional(),
        name: z.string().optional(),
        plan: z.string().optional(),
        description: z.string().optional(),
      })
      .passthrough()
      .optional()
      .describe(
        'Product detail object. Key fields: productFamily, productType, name (display name), plan, description. Full product metadata passes through.',
      ),
    suspendReasons: z
      .array(z.string())
      .optional()
      .describe(
        'Reasons the entitlement is suspended, when applicable (empty array when active).',
      ),
    metadata: z
      .object({
        createdAt: z.string().optional(),
        modifiedAt: z.string().optional(),
      })
      .passthrough()
      .optional()
      .describe('Entitlement metadata (createdAt, modifiedAt ISO timestamps).'),
  })
  .passthrough()
  .describe(
    'An active product entitlement (what the account is currently provisioned for). The product name and type are in the nested `product` object (product.name, product.productType). Extra provider fields pass through.',
  );

export const ProductFamilySchema = z
  .object({
    productFamily: z
      .string()
      .describe(
        'Product family code (e.g. omniCommerceSoftware, omniPay). Codes are account-specific — call listProductFamilies to discover the full set.',
      ),
    name: z
      .string()
      .optional()
      .describe('Human-readable family name, when present.'),
  })
  .passthrough()
  .describe(
    'A product family the account owns. Extra provider fields pass through.',
  );

export const ProductSchema = z
  .object({
    subscriptionId: z
      .string()
      .optional()
      .describe('Opaque subscription id backing this product, when present.'),
    status: z
      .string()
      .optional()
      .describe(
        'Product/subscription status code — treat as opaque (e.g. "FREEMIUM", "ACTIVE").',
      ),
    label: z
      .string()
      .nullable()
      .optional()
      .describe(
        'User-facing label for the subscription slot (e.g. domain name), when set.',
      ),
    expiresAt: z
      .string()
      .optional()
      .describe('Next expiry / renewal date (ISO string), when present.'),
    createdAt: z
      .string()
      .optional()
      .describe(
        'When the subscription was created (ISO string), when present.',
      ),
    renewable: z
      .boolean()
      .optional()
      .describe('Whether this subscription can be renewed.'),
    upgradeable: z
      .boolean()
      .optional()
      .describe('Whether this subscription can be upgraded.'),
    renewAuto: z
      .boolean()
      .optional()
      .describe('Whether auto-renew is currently on for this subscription.'),
    paymentProfileId: z
      .number()
      .optional()
      .describe('Payment profile id (0 = none set).'),
    product: z
      .object({
        pfid: z.number().optional().describe('GoDaddy product type id.'),
        label: z
          .string()
          .optional()
          .describe(
            'Product display name (e.g. "GoDaddy Airo AI Builder Free Plan").',
          ),
        renewalPfid: z.number().optional().describe('Renewal product id.'),
        renewalPeriod: z.number().optional().describe('Renewal period count.'),
        renewalPeriodUnit: z
          .string()
          .optional()
          .describe('Renewal period unit (e.g. "MONTHLY", "ANNUAL").'),
        productGroupKey: z
          .string()
          .optional()
          .describe(
            'Product group key (e.g. "airo"). Use with listProducts productGroupKeys filter.',
          ),
        namespace: z
          .string()
          .optional()
          .describe('Internal product namespace (e.g. "airobuildr").'),
      })
      .passthrough()
      .optional()
      .describe(
        'Product definition. Key fields: label (display name), productGroupKey (group filter key), namespace.',
      ),
    billing: z
      .object({
        renewAt: z
          .string()
          .optional()
          .describe('Next renewal date (ISO string).'),
        status: z
          .string()
          .optional()
          .describe('Billing status code (e.g. "CURRENT"). Treat as opaque.'),
        commitment: z
          .string()
          .optional()
          .describe('Commitment type (e.g. "FREEMIUM", "MONTHLY").'),
      })
      .passthrough()
      .optional()
      .describe('Billing details for this subscription.'),
    nesSubscriptionId: z
      .string()
      .optional()
      .describe(
        'NES subscription id (format: namespace:customerId). Matches the subscriptionId format used by the renewals/auto-renew write functions.',
      ),
    externalId: z
      .string()
      .optional()
      .describe('External UUID for this subscription, when present.'),
  })
  .passthrough()
  .describe(
    'A unified "My Products" subscription entry (the flat product list shown on the products dashboard). The product display name is in `product.label`. Extra fields (renewOptions, addons, relations) pass through.',
  );

export const PaymentProfileSchema = z
  .object({
    paymentProfileId: z.string().describe('Opaque payment profile id.'),
    label: z
      .string()
      .optional()
      .describe('User-facing label for the payment method, when present.'),
    paymentType: z
      .string()
      .optional()
      .describe(
        'Payment method type — card, PayPal, or bank account. The populated detail object below (creditCard / paypal / bankAccount) indicates which.',
      ),
    isDefault: z
      .boolean()
      .optional()
      .describe('Whether this is the account default payment method.'),
    creditCard: z
      .object({})
      .passthrough()
      .optional()
      .describe(
        'Credit-card details when paymentType is a card. Common keys: type/brand, lastDigits/last4, expirationMonth, expirationYear, nameOnCard.',
      ),
    paypal: z
      .object({})
      .passthrough()
      .optional()
      .describe(
        'PayPal details when paymentType is PayPal. Common keys: email, payerId.',
      ),
    bankAccount: z
      .object({})
      .passthrough()
      .optional()
      .describe(
        'Bank-account details when paymentType is a bank account. Common keys: lastDigits, accountType, bankName.',
      ),
    billingAddress: z
      .object({})
      .passthrough()
      .optional()
      .describe(
        'Billing address. Common keys: firstName, lastName, address1, address2, city, state, postalCode, country.',
      ),
    createdAt: z
      .string()
      .optional()
      .describe('When the profile was added (ISO string), when present.'),
    updatedAt: z
      .string()
      .optional()
      .describe(
        'When the profile was last updated (ISO string), when present.',
      ),
  })
  .passthrough()
  .describe(
    'A saved payment method on the account. Sensitive card data is already masked by the provider. Extra fields pass through.',
  );

export const CommerceSubscriptionSchema = z
  .object({
    id: z
      .string()
      .optional()
      .describe('Opaque commerce subscription id (Poynt subscription UUID).'),
    subscriptionId: z
      .string()
      .optional()
      .describe('Alias for id — present when the backend uses this key name.'),
    customerId: z
      .string()
      .optional()
      .describe('Customer UUID this subscription belongs to.'),
    businessId: z
      .string()
      .optional()
      .describe('Poynt business UUID associated with this subscription.'),
    storeId: z
      .string()
      .optional()
      .describe('Poynt store UUID associated with this subscription.'),
    entitlementId: z
      .string()
      .optional()
      .describe('Entitlement UUID backing this commerce subscription.'),
    subscriptionPlanRef: z
      .string()
      .optional()
      .describe(
        'Plan reference code (e.g. "goDaddyPaymentsBase"). Identifies the commerce plan tier.',
      ),
    status: z
      .string()
      .optional()
      .describe(
        'Commerce subscription status code (e.g. "ACTIVE"). Treat as opaque; match exactly when filtering.',
      ),
    type: z
      .string()
      .optional()
      .describe(
        'Subscription type code. Confirmed value: "GODADDY_ECOMM". Treat as opaque.',
      ),
    productName: z
      .string()
      .optional()
      .describe('Display name of the commerce product, when present.'),
    planName: z
      .string()
      .optional()
      .describe('Commerce plan name, when present.'),
    expiresAt: z
      .string()
      .optional()
      .describe('Next billing / expiry date (ISO string), when present.'),
    createdAt: z
      .string()
      .optional()
      .describe('When the subscription was created (ISO string).'),
    updatedAt: z
      .string()
      .optional()
      .describe('When the subscription was last updated (ISO string).'),
  })
  .passthrough()
  .describe(
    'A commerce/payments subscription (Commerce, POS, payments plans). Key fields: id, businessId, storeId, subscriptionPlanRef, type, status. Extra provider fields pass through.',
  );

// ============================================================================
// searchSubscriptions
// ============================================================================

export const searchSubscriptionsSchema = {
  name: 'searchSubscriptions',
  description:
    "Search the account's billing subscriptions by product name, with optional product-family and status filters. Returns matching subscriptions with their status, auto-renew state, and expiry date.",
  notes:
    "All arguments are optional; omit everything to list every subscription. `query` is a case-insensitive substring match on the product name/label. `productFamily` is an internal code (e.g. omniCommerceSoftware, omniPay) — discover the valid set via listProductFamilies. `status` is matched exactly (case-sensitive) against each subscription's status field — read that field on a returned subscription to learn the exact code rather than guessing. `count` truncates the result after filtering.",
  input: z.object({
    query: z
      .string()
      .optional()
      .describe(
        'Case-insensitive substring to match against the product name/label. Omit for no name filter.',
      ),
    productFamily: z
      .string()
      .optional()
      .describe(
        'Restrict to a single product family code. Omit for all families. Use productFamilies to pass multiple families.',
      ),
    productFamilies: z
      .array(z.string())
      .optional()
      .describe(
        'Restrict to these product family codes (server-side filter). When provided, takes precedence over productFamily. Discover valid codes via listProductFamilies.',
      ),
    excludes: z
      .array(z.enum(['CES', 'FREEMIUM']))
      .optional()
      .describe(
        'Subscription categories to exclude from results. CES excludes freemium subscriptions sourced from the Customer Entitlement Service; FREEMIUM excludes freemium-status subscriptions. Both values may be combined.',
      ),
    status: z
      .string()
      .optional()
      .describe(
        'Restrict to subscriptions whose status field exactly matches this code. Omit for all statuses.',
      ),
    count: z
      .number()
      .optional()
      .describe(
        'Max subscriptions to return after filtering. Omit for all matches.',
      ),
  }),
  output: z.object({
    subscriptions: z
      .array(SubscriptionSummarySchema)
      .describe('Matching subscriptions (empty array when none).'),
    total: z.number().describe('Number of subscriptions returned.'),
  }),
};

// ============================================================================
// listEntitlements
// ============================================================================

export const listEntitlementsSchema = {
  name: 'listEntitlements',
  description:
    "List the account's active product entitlements (what the account is currently provisioned for), optionally restricted to specific product families.",
  notes:
    'Entitlements describe provisioned access, distinct from billing subscriptions (use searchSubscriptions for renewal/billing state). When `productFamilies` is omitted the function auto-discovers the account\'s families and queries them all — pass explicit families to restrict scope. Family codes are opaque (e.g. omniCommerceSoftware, omniPay, security) — discover valid codes via listProductFamilies. Pass `includes: "third-party"` to include entitlements provisioned via third-party providers (omitted by default). The product name and type are in `product.name` and `product.productType` on each returned entitlement. `count` truncates the result.',
  input: z.object({
    productFamilies: z
      .array(z.string())
      .optional()
      .describe(
        'Restrict to these product family codes. Omit for all families.',
      ),
    includes: z
      .enum(['third-party'])
      .optional()
      .describe(
        'Pass "third-party" to include entitlements provisioned via third-party providers. Omit to return only directly-provisioned GoDaddy entitlements.',
      ),
    count: z
      .number()
      .optional()
      .describe('Max entitlements to return. Omit for all.'),
  }),
  output: z.object({
    entitlements: z
      .array(EntitlementSchema)
      .describe('Active entitlements (empty array when none).'),
    total: z
      .number()
      .optional()
      .describe(
        'Total entitlements matching the query before truncation, when reported by the backend.',
      ),
  }),
};

// ============================================================================
// listProductFamilies
// ============================================================================

export const listProductFamiliesSchema = {
  name: 'listProductFamilies',
  description:
    'List the product families the account owns. Use the returned family codes to filter searchSubscriptions and listEntitlements.',
  notes:
    'Family codes are opaque internal identifiers (examples seen: omniCommerceSoftware, omniPay). The exact set is account-specific — call this to discover the valid filter values rather than guessing. Pass `excludes: "ces"` to omit CES-sourced families (the UI default). Pass `includes: "third-party"` to include third-party-provisioned families; when passed, the response also includes a `thirdParty` breakdown.',
  input: z.object({
    excludes: z
      .enum(['ces'])
      .optional()
      .describe(
        'Exclude CES (Customer Entitlement Service) sourced product families. Pass "ces" to omit them. Omit to return all families including CES ones.',
      ),
    includes: z
      .enum(['third-party'])
      .optional()
      .describe(
        'Pass "third-party" to include third-party-provisioned families and get a `thirdParty` breakdown in the response. Omit to return only directly-provisioned GoDaddy families.',
      ),
  }),
  output: z.object({
    productFamilies: z
      .array(ProductFamilySchema)
      .describe('Owned product families (empty array when none).'),
    total: z.number().describe('Number of product families returned.'),
    totalSubscriptionCount: z
      .number()
      .optional()
      .describe(
        'Total number of subscriptions across all returned product families, as reported by the backend.',
      ),
    thirdParty: z
      .object({
        productFamilies: z
          .array(z.string())
          .describe(
            'Product family codes provisioned via third-party providers.',
          ),
        productsCount: z
          .number()
          .optional()
          .describe('Number of third-party-provisioned products.'),
      })
      .optional()
      .describe(
        'Third-party provisioning summary. Only present when `includes: "third-party"` is passed.',
      ),
  }),
};

// ============================================================================
// listProducts
// ============================================================================

export const listProductsSchema = {
  name: 'listProducts',
  description:
    'List the account\'s products as shown on the unified "My Products" dashboard — the flat product list with status, label, and renewal options.',
  notes:
    'This is the consolidated products view. For billing/renewal-specific filtering use searchSubscriptions. `count` truncates the result. Pass `includes` to embed addons, relations, and/or renewOptions on each product (the UI requests all three). Pass `productGroupKeys` to restrict to specific product groups (discover group keys via the productGroups internal endpoint — e.g. "airo"). Pass `sort` to sort results; "expiresAt" is the sort field used by the UI.',
  input: z.object({
    count: z
      .number()
      .optional()
      .describe('Max products to return. Omit for all.'),
    includes: z
      .array(z.enum(['addons', 'relations', 'renewOptions']))
      .optional()
      .describe(
        'Additional data to embed on each product item. "addons" includes bundled add-on subscriptions; "relations" includes related subscriptions; "renewOptions" includes renewal pricing options. The products UI requests all three by default.',
      ),
    productGroupKeys: z
      .array(z.string())
      .optional()
      .describe(
        'Restrict results to these product group keys (e.g. ["airo"]). Product group keys are internal identifiers that correspond to the product categories shown in the UI (Airo AI Builder = "airo"). Omit to return all product groups.',
      ),
    sort: z
      .string()
      .optional()
      .describe(
        'Field to sort products by. "expiresAt" sorts by expiry/renewal date ascending (used by the UI). Omit for default server ordering.',
      ),
  }),
  output: z.object({
    products: z
      .array(ProductSchema)
      .describe('Products on the account (empty array when none).'),
    total: z
      .number()
      .optional()
      .describe(
        'Total products before truncation, when reported by the backend.',
      ),
  }),
};

// ============================================================================
// listPaymentProfiles
// ============================================================================

export const listPaymentProfilesSchema = {
  name: 'listPaymentProfiles',
  description:
    'List the saved payment methods on the account, flagging the default. Card numbers are already masked by the provider.',
  notes: '',
  input: z.object({}),
  output: z.object({
    paymentProfiles: z
      .array(PaymentProfileSchema)
      .describe('Saved payment methods (empty array when none).'),
    total: z.number().describe('Number of payment profiles returned.'),
  }),
};

// ============================================================================
// getPaymentProfile
// ============================================================================

export const getPaymentProfileSchema = {
  name: 'getPaymentProfile',
  description: 'Get a single saved payment method by its payment profile id.',
  notes:
    'Pass a paymentProfileId from listPaymentProfiles. Throws not-found if no profile with that id exists on the account.',
  input: z.object({
    paymentProfileId: z
      .string()
      .describe('Payment profile id from listPaymentProfiles.'),
    source: z
      .enum(['MYA', 'CHECKOUT'])
      .optional()
      .describe(
        'Payment profile source context. "MYA" (default) = My Account billing surface; "CHECKOUT" = checkout-flow profiles. Profiles saved in one context may not appear in the other.',
      ),
    includes: z
      .array(z.enum(['backup', 'backupPaymentMethod', 'vaultedCards']))
      .optional()
      .describe(
        'Additional data to embed on the returned profile. "backup" / "backupPaymentMethod" include backup payment method details; "vaultedCards" includes vaulted card details. Omit for the default field set.',
      ),
  }),
  output: z.object({
    paymentProfile: PaymentProfileSchema.describe(
      'The matching payment method.',
    ),
  }),
};

// ============================================================================
// listCommerceSubscriptions
// ============================================================================

export const listCommerceSubscriptionsSchema = {
  name: 'listCommerceSubscriptions',
  description:
    "List the account's commerce/payments subscriptions (Commerce, POS, and payment plans). Each subscription includes its Poynt businessId, storeId, subscriptionPlanRef, type, and status.",
  notes:
    'Distinct from searchSubscriptions: this covers the commerce/payments product line (GoDaddy Payments, online store, POS). Each item has an `id` field (not `subscriptionId`). `status` and `type` are server-side filter codes — read returned values before filtering. `count` caps results client-side. Use `page`+`pageSize` for pagination.',
  input: z.object({
    status: z
      .string()
      .optional()
      .describe(
        'Filter by status. Accepts a single code or comma-separated list (e.g. "ACTIVE,PENDING"). Confirmed values: "ACTIVE", "PENDING". Omit for all statuses.',
      ),
    type: z
      .string()
      .optional()
      .describe(
        'Filter by subscription type code (e.g. "GODADDY_ECOMM"). Server-validated; read the `type` field on returned subscriptions to discover valid values. Omit for all types.',
      ),
    businessId: z
      .string()
      .optional()
      .describe(
        "Filter to subscriptions for a specific Poynt business UUID. Obtain from a returned subscription's `businessId` field.",
      ),
    storeId: z
      .string()
      .optional()
      .describe(
        "Filter to subscriptions for a specific Poynt store UUID. Obtain from a returned subscription's `storeId` field.",
      ),
    entitlementId: z
      .string()
      .optional()
      .describe('Filter to the subscription backed by this entitlement UUID.'),
    subscriptionPlanRef: z
      .string()
      .optional()
      .describe(
        'Filter to subscriptions on this plan reference code (e.g. "goDaddyPaymentsBase"). Read `subscriptionPlanRef` on returned items to discover values.',
      ),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field to sort results by. Confirmed values: "createdAt", "updatedAt". Omit for default server ordering.',
      ),
    sortOrder: z
      .enum(['ASC', 'DESC'])
      .optional()
      .describe(
        'Sort direction. "ASC" = oldest first, "DESC" = newest first. Only meaningful when `sortBy` is set.',
      ),
    page: z
      .number()
      .optional()
      .describe(
        'Page number to fetch (1-indexed). Defaults to 1. Use with `pageSize` for pagination.',
      ),
    pageSize: z
      .number()
      .optional()
      .describe('Number of subscriptions per page. Defaults to 100.'),
    count: z
      .number()
      .optional()
      .describe(
        'Max subscriptions to return (client-side cap). Omit for the full page.',
      ),
  }),
  output: z.object({
    subscriptions: z
      .array(CommerceSubscriptionSchema)
      .describe('Commerce subscriptions (empty array when none).'),
    total: z
      .number()
      .optional()
      .describe(
        'Total commerce subscriptions before truncation, when reported by the backend.',
      ),
  }),
};

// ============================================================================
// getBillingSummary
// ============================================================================

export const getBillingSummarySchema = {
  name: 'getBillingSummary',
  description:
    'Get a high-level billing summary for the account: how many subscriptions exist, how many have auto-renew on vs off, and how many are expiring soon.',
  notes:
    '`expiringSoonCount` counts subscriptions with a renewal/expiry date within the next 30 days. `available` is false when the account has no renewals-managed subscriptions to summarize (the counts are then all zero) — this is a clean empty state, not an error.',
  input: z.object({}),
  output: z.object({
    available: z
      .boolean()
      .describe('Whether any subscription data was found to summarize.'),
    subscriptionCount: z
      .number()
      .describe('Total subscriptions on the account.'),
    autoRenewOnCount: z
      .number()
      .describe('Subscriptions with auto-renew currently ON.'),
    autoRenewOffCount: z
      .number()
      .describe('Subscriptions with auto-renew currently OFF.'),
    expiringSoonCount: z
      .number()
      .describe('Subscriptions expiring/renewing within the next 30 days.'),
    currency: z
      .string()
      .optional()
      .describe('Account billing currency (e.g. USD), when known.'),
  }),
};

// ============================================================================
// Registry + types
// ============================================================================

export const billingReadSchemas = [
  searchSubscriptionsSchema,
  listEntitlementsSchema,
  listProductFamiliesSchema,
  listProductsSchema,
  listPaymentProfilesSchema,
  getPaymentProfileSchema,
  listCommerceSubscriptionsSchema,
  getBillingSummarySchema,
];

export type SubscriptionSummary = z.infer<typeof SubscriptionSummarySchema>;
export type Entitlement = z.infer<typeof EntitlementSchema>;
export type ProductFamily = z.infer<typeof ProductFamilySchema>;
export type Product = z.infer<typeof ProductSchema>;
export type PaymentProfile = z.infer<typeof PaymentProfileSchema>;
export type CommerceSubscription = z.infer<typeof CommerceSubscriptionSchema>;

export type SearchSubscriptionsOutput = z.infer<
  typeof searchSubscriptionsSchema.output
>;
export type ListEntitlementsOutput = z.infer<
  typeof listEntitlementsSchema.output
>;
export type ListProductFamiliesOutput = z.infer<
  typeof listProductFamiliesSchema.output
>;
export type ListProductsOutput = z.infer<typeof listProductsSchema.output>;
export type ListPaymentProfilesOutput = z.infer<
  typeof listPaymentProfilesSchema.output
>;
export type GetPaymentProfileOutput = z.infer<
  typeof getPaymentProfileSchema.output
>;
export type ListCommerceSubscriptionsOutput = z.infer<
  typeof listCommerceSubscriptionsSchema.output
>;
export type GetBillingSummaryOutput = z.infer<
  typeof getBillingSummarySchema.output
>;
