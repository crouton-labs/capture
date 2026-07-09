import { z } from 'zod';

// ============================================================================
// Shared entity shapes
// ============================================================================

export const CertificateSummarySchema = z
  .record(z.string(), z.unknown())
  .describe(
    'A certificate row from the SSL dashboard. Commonly present fields: domain (common name), productType (cert type code), status (lifecycle status), subscriptionStartDate, subscriptionEndDate, subscriptionIsExpiring (boolean), subscriptionRenewLink (URL), certRenewLink (URL), actionUrl (status action URL), messageCount (unread MSSL messages).',
  );

export const SslCreditSchema = z
  .record(z.string(), z.unknown())
  .describe(
    'An available (purchased-but-unused) SSL credit/subscription that can be redeemed to issue a certificate. Carries the product/cert type and expiration details.',
  );

// ============================================================================
// listCertificates
// ============================================================================

export const listCertificatesSchema = {
  name: 'listCertificates',
  description:
    "List the account's SSL/TLS certificates, returning each certificate row plus any available (unused) SSL credits and the total certificate count. Use to see which certificates exist, their status, and when they expire.",
  notes:
    'Run from the GoDaddy SSL dashboard — navigate to https://certs.godaddy.com/cert (signed in) before calling; requests are authorized via session cookies from that page. Returns cleanly empty ({ certificates: [], credits: [], total: 0 }) when the account owns no certificates. `status` filtering is applied client-side after fetch.',
  input: z.object({
    domain: z
      .string()
      .optional()
      .describe(
        'Substring search on the certificate domain / common name. Not a prefix search — matches text anywhere in the domain.',
      ),
    productType: z
      .enum([
        'BV_SSL',
        'DV_SSL',
        'DV_WILDCARD_SSL',
        'EV_SSL',
        'OV_CS',
        'OV_DS',
        'OV_SSL',
        'OV_WILDCARD_SSL',
        'UCC_DV_SSL',
        'UCC_EV_SSL',
        'UCC_OV_SSL',
        'UCC_WILDCARD_DV_SSL',
        'UCC_WILDCARD_OV_SSL',
      ])
      .optional()
      .describe(
        'Restrict by certificate product type. BV_SSL=Basic SSL, DV_SSL=Standard SSL, DV_WILDCARD_SSL=Standard Wildcard, EV_SSL=Extended Validation, OV_CS=Code Signing, OV_DS=Driver Signing, OV_SSL=Deluxe SSL, OV_WILDCARD_SSL=Deluxe Wildcard, UCC_DV_SSL=Standard UCC, UCC_EV_SSL=Extended Validation UCC, UCC_OV_SSL=Deluxe UCC, UCC_WILDCARD_DV_SSL=Standard UCC Wildcard, UCC_WILDCARD_OV_SSL=Deluxe UCC Wildcard. Omit for all types.',
      ),
    status: z
      .string()
      .optional()
      .describe(
        'Client-side filter by certificate status. Known values: ISSUED, PENDING_VALIDATION, EXPIRED, REVOKED, CANCELED, DENIED, PENDING_REKEY, PENDING_REVOCATION, PROTECTED, SETUP_IN_PROGRESS, SSL_INSTALLED, SSL_NOT_INSTALLED, UNKNOWN, NEW_MESSAGES. Omit for all.',
      ),
    sortBy: z
      .enum([
        'CERTIFICATE_ID',
        'DOMAIN',
        'PRODUCT_TYPE',
        'VALID_START_DATE',
        'VALID_END_DATE',
        'RENEW_AVAILABLE',
        'SUBSCRIPTION_START_DATE',
        'SUBSCRIPTION_END_DATE',
      ])
      .optional()
      .describe(
        'Column to sort by. DOMAIN (default), PRODUCT_TYPE, VALID_START_DATE, VALID_END_DATE, RENEW_AVAILABLE, SUBSCRIPTION_START_DATE, SUBSCRIPTION_END_DATE, CERTIFICATE_ID.',
      ),
    sortDirection: z
      .enum(['ASC', 'DESC'])
      .optional()
      .describe('Sort direction. ASC (default) or DESC.'),
    page: z
      .number()
      .optional()
      .describe(
        'Page number to fetch (1-indexed). Omit to auto-paginate the full list.',
      ),
    pageSize: z
      .number()
      .min(1)
      .max(99)
      .optional()
      .describe(
        'Number of certificates per page (default 25, min 1, max 99). Use with `page` for manual pagination.',
      ),
    count: z
      .number()
      .optional()
      .describe(
        'Max certificates to return across all pages. Omit to auto-paginate the full list.',
      ),
  }),
  output: z.object({
    certificates: z
      .array(CertificateSummarySchema)
      .describe('Matching certificate rows.'),
    credits: z
      .array(SslCreditSchema)
      .describe('Available (purchased-but-unused) SSL credits on the account.'),
    total: z
      .number()
      .describe(
        'Total certificates matching the query (0 when the account owns none).',
      ),
  }),
};

// ============================================================================
// searchCertificates
// ============================================================================

export const searchCertificatesSchema = {
  name: 'searchCertificates',
  description:
    "Search the account's SSL/TLS certificates by domain / common name, returning matching certificate rows, available SSL credits, and the matched total.",
  notes:
    'Run from the GoDaddy SSL dashboard — navigate to https://certs.godaddy.com/cert (signed in) before calling. The query performs a substring match against the certificate domain / common name. Omitting `query` returns the full list.',
  input: z.object({
    query: z
      .string()
      .optional()
      .describe(
        'Substring search on the certificate domain / common name. Omit to return all certificates.',
      ),
    status: z
      .string()
      .optional()
      .describe(
        'Client-side filter by certificate status. Known values: ISSUED, PENDING_VALIDATION, EXPIRED, REVOKED, CANCELED, DENIED, PENDING_REKEY, PENDING_REVOCATION, PROTECTED, SETUP_IN_PROGRESS, SSL_INSTALLED, SSL_NOT_INSTALLED, UNKNOWN, NEW_MESSAGES. Omit for all.',
      ),
    productType: z
      .enum([
        'BV_SSL',
        'DV_SSL',
        'DV_WILDCARD_SSL',
        'EV_SSL',
        'OV_CS',
        'OV_DS',
        'OV_SSL',
        'OV_WILDCARD_SSL',
        'UCC_DV_SSL',
        'UCC_EV_SSL',
        'UCC_OV_SSL',
        'UCC_WILDCARD_DV_SSL',
        'UCC_WILDCARD_OV_SSL',
      ])
      .optional()
      .describe(
        'Restrict by certificate product type. BV_SSL=Basic SSL, DV_SSL=Standard SSL, DV_WILDCARD_SSL=Standard Wildcard, EV_SSL=Extended Validation, OV_CS=Code Signing, OV_DS=Driver Signing, OV_SSL=Deluxe SSL, OV_WILDCARD_SSL=Deluxe Wildcard, UCC_DV_SSL=Standard UCC, UCC_EV_SSL=Extended Validation UCC, UCC_OV_SSL=Deluxe UCC, UCC_WILDCARD_DV_SSL=Standard UCC Wildcard, UCC_WILDCARD_OV_SSL=Deluxe UCC Wildcard. Omit for all types.',
      ),
    sortBy: z
      .enum([
        'CERTIFICATE_ID',
        'DOMAIN',
        'PRODUCT_TYPE',
        'VALID_START_DATE',
        'VALID_END_DATE',
        'RENEW_AVAILABLE',
        'SUBSCRIPTION_START_DATE',
        'SUBSCRIPTION_END_DATE',
      ])
      .optional()
      .describe(
        'Column to sort by. DOMAIN (default), PRODUCT_TYPE, VALID_START_DATE, VALID_END_DATE, RENEW_AVAILABLE, SUBSCRIPTION_START_DATE, SUBSCRIPTION_END_DATE, CERTIFICATE_ID.',
      ),
    sortDirection: z
      .enum(['ASC', 'DESC'])
      .optional()
      .describe('Sort direction. ASC (default) or DESC.'),
    count: z
      .number()
      .optional()
      .describe(
        'Max certificates to return. Omit to auto-paginate the full result set.',
      ),
  }),
  output: z.object({
    certificates: z
      .array(CertificateSummarySchema)
      .describe('Certificate rows matching the query.'),
    credits: z
      .array(SslCreditSchema)
      .describe('Available (purchased-but-unused) SSL credits on the account.'),
    total: z
      .number()
      .describe(
        'Total certificates matching the query (0 when nothing matches).',
      ),
  }),
};

// ============================================================================
// Registry + inferred output types
// ============================================================================

export const sslSchemas = [listCertificatesSchema, searchCertificatesSchema];

export type CertificateSummary = z.infer<typeof CertificateSummarySchema>;
export type SslCredit = z.infer<typeof SslCreditSchema>;
export type ListCertificatesOutput = z.infer<
  typeof listCertificatesSchema.output
>;
export type SearchCertificatesOutput = z.infer<
  typeof searchCertificatesSchema.output
>;
