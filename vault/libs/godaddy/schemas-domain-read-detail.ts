import { z } from 'zod';

// ============================================================================
// Shared entity shapes (this batch OWNS the read-side contact + export shapes)
// ============================================================================

export const DomainContactAddressSchema = z
  .object({
    address1: z.string().optional().describe('Street address line 1.'),
    address2: z.string().optional().describe('Street address line 2.'),
    city: z.string().optional().describe('City.'),
    state: z.string().optional().describe('State / province / region.'),
    postalCode: z.string().optional().describe('ZIP / postal code.'),
    country: z
      .string()
      .optional()
      .describe('ISO 3166-1 alpha-2 country code, e.g. "US".'),
  })
  .passthrough()
  .describe('Mailing address attached to a domain contact.');

export const DomainContactDetailSchema = z
  .object({
    nameFirst: z.string().optional().describe('Given name.'),
    nameLast: z.string().optional().describe('Family name.'),
    nameMiddle: z.string().optional().describe('Middle name, when present.'),
    organization: z
      .string()
      .optional()
      .describe('Company / organization, when the contact is an org.'),
    email: z.string().optional().describe('Contact email.'),
    phone: z.string().optional().describe('Phone in +CC.NNNNNNNN format.'),
    fax: z.string().optional().describe('Fax number, when present.'),
    jobTitle: z.string().optional().describe('Job title, when present.'),
    addressMailing:
      DomainContactAddressSchema.optional().describe('Postal address.'),
  })
  .passthrough()
  .describe('A WHOIS/registrar contact for a domain.');

export const DomainExportSchema = z
  .object({
    exportId: z
      .union([z.string(), z.number()])
      .describe(
        'Export job id (integer or string). Pass to getDomainExportStatus to poll progress.',
      ),
    name: z.string().optional().describe('Display name of the export job.'),
    format: z
      .string()
      .optional()
      .describe('Export file format. Values: CSV, XML.'),
    compression: z
      .string()
      .optional()
      .describe(
        'Compression applied to the export file. Values: NONE, GZ, ZIP.',
      ),
    createDate: z
      .string()
      .optional()
      .describe('When the export was requested (ISO timestamp).'),
    activeDate: z
      .string()
      .optional()
      .describe('When the export file became available (ISO timestamp).'),
    contentLength: z
      .number()
      .optional()
      .describe('Size of the export file in bytes.'),
    contentAuthorizationMode: z
      .string()
      .optional()
      .describe('Authorization mode for downloading the export.'),
  })
  .passthrough()
  .describe('A domain-portfolio export job.');

// ============================================================================
// getDomainContacts
// ============================================================================

export const getDomainContactsSchema = {
  name: 'getDomainContacts',
  description:
    "Get the registrant, admin, tech, and billing contacts for a domain in the authenticated user's GoDaddy portfolio. Throws if the domain is not owned by this account.",
  notes:
    "Only works for domains in this account's portfolio — throws NotFound for domains not owned here. When domain privacy/protection is enabled the values are the proxied/obscured contacts, not the underlying owner data.",
  input: z.object({
    domainName: z
      .string()
      .describe('Fully-qualified domain name, e.g. "example.com".'),
  }),
  output: z.object({
    domainName: z.string().describe('The domain queried.'),
    contacts: z
      .object({
        contactRegistrant: DomainContactDetailSchema.optional().describe(
          'Registrant (owner) contact.',
        ),
        contactAdmin: DomainContactDetailSchema.optional().describe(
          'Administrative contact.',
        ),
        contactTech:
          DomainContactDetailSchema.optional().describe('Technical contact.'),
        contactBilling:
          DomainContactDetailSchema.optional().describe('Billing contact.'),
      })
      .passthrough()
      .describe(
        'Contacts by role. Keys: contactRegistrant, contactAdmin, contactTech, contactBilling.',
      ),
  }),
};

// ============================================================================
// getDomainNameservers
// ============================================================================

export const getDomainNameserversSchema = {
  name: 'getDomainNameservers',
  description:
    'Get the authoritative nameservers currently set for a single domain.',
  notes:
    'An empty list means the domain has no custom nameservers set (or is not in this account). Vanity/registered host records are managed separately.',
  input: z.object({
    domainName: z
      .string()
      .describe('Fully-qualified domain name, e.g. "example.com".'),
  }),
  output: z.object({
    domainName: z.string().describe('The domain queried.'),
    nameservers: z
      .array(z.string())
      .describe(
        'Authoritative nameserver hostnames, e.g. ["ns01.domaincontrol.com", "ns02.domaincontrol.com"].',
      ),
  }),
};

// ============================================================================
// getDomainForwarding
// ============================================================================

export const ForwardingRedirectSchema = z
  .object({
    fqdn: z
      .string()
      .describe(
        'Fully-qualified host being forwarded, e.g. "example.com" or "sub.example.com".',
      ),
    destination: z.string().describe('Destination URL the host forwards to.'),
    redirectType: z
      .enum(['REDIRECT_PERMANENT', 'REDIRECT_TEMPORARY', 'MASKED'])
      .describe(
        'Forwarding type. REDIRECT_PERMANENT = 301; REDIRECT_TEMPORARY = 302; MASKED = framed forward keeping the original domain in the address bar.',
      ),
    masking: z
      .object({
        title: z
          .string()
          .optional()
          .describe('Page <title> shown in the masking frame.'),
        description: z
          .string()
          .optional()
          .describe('Meta description for the masking frame.'),
        keywords: z
          .array(z.string())
          .optional()
          .describe('Meta keywords for the masking frame.'),
      })
      .passthrough()
      .optional()
      .describe(
        'SEO masking metadata. Only present when redirectType is MASKED.',
      ),
  })
  .passthrough()
  .describe('A single URL-forwarding rule for an apex domain or subdomain.');

export const getDomainForwardingSchema = {
  name: 'getDomainForwarding',
  description:
    'Get the URL-forwarding rules for a single domain (apex and optionally subdomains).',
  notes:
    'Returns all forwarding rules as a redirects array. Pass includeHosts: true to also retrieve subdomain forwarding records alongside the apex forwarding.',
  input: z.object({
    domainName: z
      .string()
      .describe('Fully-qualified domain name, e.g. "example.com".'),
    includeHosts: z
      .boolean()
      .optional()
      .describe(
        'When true, return subdomain forwarding rules in addition to the apex-domain rule. Default: false (apex only).',
      ),
    pageNumber: z
      .number()
      .optional()
      .describe(
        '1-indexed page number when paginating through many forwarding rules. Omit for the first page.',
      ),
    pageSize: z
      .number()
      .optional()
      .describe(
        'Number of forwarding rules to return per page. Omit to use the server default.',
      ),
  }),
  output: z.object({
    domainName: z.string().describe('The domain queried.'),
    redirects: z
      .array(ForwardingRedirectSchema)
      .describe(
        'Forwarding rules for the domain. Empty array when no forwarding is configured.',
      ),
    pagination: z
      .object({
        total: z
          .number()
          .describe('Total forwarding rules matching the query.'),
        next: z
          .string()
          .optional()
          .describe(
            'Cursor for the next page; empty string when on the last page.',
          ),
        previous: z
          .string()
          .optional()
          .describe(
            'Cursor for the previous page; empty string on the first page.',
          ),
      })
      .passthrough()
      .describe('Pagination metadata.'),
  }),
};

// ============================================================================
// getDomainPrivacy
// ============================================================================

export const getDomainPrivacySchema = {
  name: 'getDomainPrivacy',
  description:
    'Get the privacy email-masking settings for a domain: the proxy email local parts assigned to masked contacts and per-domain email forwarding configuration.',
  notes:
    "Throws NotFound if the domain is not in this account's portfolio. Returns empty arrays when domain privacy is not enabled.",
  input: z.object({
    domainName: z
      .string()
      .describe('Fully-qualified domain name, e.g. "example.com".'),
  }),
  output: z.object({
    domainName: z.string().describe('The domain queried.'),
    privacy: z
      .object({
        emailAddressLocalParts: z
          .array(z.string())
          .describe(
            'Local parts (before @) of the proxy email addresses assigned to masked contacts. Empty when privacy is not enabled.',
          ),
        emailForwardingSettingsDomains: z
          .array(z.object({}).passthrough())
          .describe(
            'Per-domain email forwarding configuration entries. Each entry includes domainName and forwarding destination. Empty when no forwarding is configured.',
          ),
      })
      .passthrough()
      .describe(
        'Privacy email-masking settings. Both arrays are empty when privacy is not enabled.',
      ),
  }),
};

// ============================================================================
// getDomainRenewalTerms
// ============================================================================

export const getDomainRenewalTermsSchema = {
  name: 'getDomainRenewalTerms',
  description:
    'Get the renewal pricing and eligibility terms for a single domain.',
  notes: '',
  input: z.object({
    domainName: z
      .string()
      .describe('Fully-qualified domain name, e.g. "example.com".'),
    domainStates: z
      .array(
        z.enum([
          'ACTIVE',
          'REDEMPTION',
          'INACTIVE',
          'DNS_HOSTING',
          'DNS_OFFSITE',
          'RAA_ACTION_NEEDED',
          'ADULT_BLOCK',
          'DCC_ACTIVE_EXCEPT_STATUS_ZERO',
          'DCC_ACTIVE_REGISTERED_DOMAINS',
          'DCC_REGISTERED_DOMAINS_EXCEPT_STATUS_ZERO',
          'DCC_TRANSFER',
        ]),
      )
      .optional()
      .describe(
        'Domain lifecycle states to include. Defaults to ["ACTIVE", "REDEMPTION"]. Valid values: ACTIVE (registered and active), REDEMPTION (expired, in redemption grace period), INACTIVE (not active), DNS_HOSTING (DNS-hosting only, no registration), DNS_OFFSITE (DNS managed off-GoDaddy), RAA_ACTION_NEEDED (requires registrant action), ADULT_BLOCK (blocked for adult content), DCC_ACTIVE_EXCEPT_STATUS_ZERO (active minus status-zero), DCC_ACTIVE_REGISTERED_DOMAINS (all active registered), DCC_REGISTERED_DOMAINS_EXCEPT_STATUS_ZERO (registered minus status-zero), DCC_TRANSFER (in transfer).',
      ),
  }),
  output: z.object({
    domainName: z.string().describe('The domain queried.'),
    renewalTerms: z
      .object({
        renewable: z
          .boolean()
          .optional()
          .describe('Whether the domain can currently be renewed.'),
        renewalPrice: z
          .union([z.number(), z.string()])
          .optional()
          .describe(
            'Renewal price as returned (minor currency units or a formatted string).',
          ),
        currency: z
          .string()
          .optional()
          .describe('Currency code for the price, when present.'),
        maxRenewalYears: z
          .number()
          .optional()
          .describe('Maximum number of years renewable at once.'),
        expirationDate: z
          .string()
          .optional()
          .describe('Current expiration date (ISO), when reported.'),
      })
      .passthrough()
      .describe('Renewal pricing and eligibility terms.'),
  }),
};

// ============================================================================
// listDomainExports
// ============================================================================

export const listDomainExportsSchema = {
  name: 'listDomainExports',
  description:
    'List the domain-portfolio CSV export jobs previously requested for the account, newest first.',
  notes:
    'Returns an empty list when no exports have ever been requested. Create new exports with exportDomains.',
  input: z.object({
    count: z
      .number()
      .optional()
      .describe('Max export jobs to return. Omit for all.'),
    sortColumn: z
      .enum(['CreateDate'])
      .optional()
      .describe('Column to sort results by. Default: CreateDate.'),
    sortDirection: z
      .enum(['ASC', 'DESC'])
      .optional()
      .describe(
        'Sort order. ASC = oldest first, DESC = newest first (default).',
      ),
  }),
  output: z.object({
    exports: z.array(DomainExportSchema).describe('Export jobs.'),
    total: z.number().describe('Total export jobs available.'),
  }),
};

// ============================================================================
// exportDomains
// ============================================================================

export const exportDomainsSchema = {
  name: 'exportDomains',
  description:
    'Create a domain-portfolio export job. Returns the export id to poll with getDomainExportStatus.',
  notes:
    'Export jobs are asynchronous — the job completes quickly (often immediately). exportId is returned as an integer by the API. Column codes differ by exportType: FilteredDomainsExport accepts "_ALL" (all columns) or specific codes DOMAIN_NAME, AUTORENEW, EXPIRATION_DATE, NAMESERVERS, LOCK, PRIVACY, STATUS, TLD, RENEWALPRICE, FORWARDING_URL, FOLDER_MEMBERSHIPS (default: ["_ALL"]). TransferDomainsExport only accepts CREATE_DATE, DOMAIN_NAME, STATUS, TLD, TRANSFER_TYPE — "_ALL" is rejected with 422 for this type (default: all five codes).',
  input: z.object({
    exportType: z
      .enum(['FilteredDomainsExport', 'TransferDomainsExport'])
      .optional()
      .describe(
        'Type of export. FilteredDomainsExport (default): exports domains from the portfolio. TransferDomainsExport: exports pending transfer domains.',
      ),
    format: z
      .enum(['CSV', 'XML'])
      .optional()
      .describe('File format. Default: CSV.'),
    compression: z
      .enum(['NONE', 'GZ', 'ZIP'])
      .optional()
      .describe('Compression for the output file. Default: NONE.'),
    includeAuthCode: z
      .boolean()
      .optional()
      .describe('Include EPP auth codes in the export. Default: false.'),
    name: z
      .string()
      .optional()
      .describe(
        'Filename for the export (without extension). If omitted, server assigns a name.',
      ),
    columns: z
      .array(z.string())
      .optional()
      .describe(
        'Column codes to include. Omit to use type-specific defaults. For FilteredDomainsExport: "_ALL" (all columns, default) or any of DOMAIN_NAME, AUTORENEW, EXPIRATION_DATE, NAMESERVERS, LOCK, PRIVACY, STATUS, TLD, RENEWALPRICE, FORWARDING_URL, FOLDER_MEMBERSHIPS. For TransferDomainsExport: one or more of CREATE_DATE, DOMAIN_NAME, STATUS, TLD, TRANSFER_TYPE (default: all five) — "_ALL" is not valid for this type.',
      ),
  }),
  output: z.object({
    exportId: z
      .string()
      .describe(
        'Id of the created export job (returned as integer from API, coerced to string). Poll with getDomainExportStatus.',
      ),
  }),
};

// ============================================================================
// getDomainExportStatus
// ============================================================================

export const getDomainExportStatusSchema = {
  name: 'getDomainExportStatus',
  description: 'Get the metadata of a domain-portfolio export job.',
  notes:
    'exportId comes from exportDomains or listDomainExports. The job typically completes quickly. contentLength indicates the export file size in bytes when ready.',
  input: z.object({
    exportId: z
      .string()
      .describe('Export job id from exportDomains or listDomainExports.'),
  }),
  output: z.object({
    export: DomainExportSchema.describe(
      'The export job with its current status and download URL when ready.',
    ),
  }),
};

// ============================================================================
// Registry + types
// ============================================================================

export const domainReadDetailSchemas = [
  getDomainContactsSchema,
  getDomainNameserversSchema,
  getDomainForwardingSchema,
  getDomainPrivacySchema,
  getDomainRenewalTermsSchema,
  listDomainExportsSchema,
  exportDomainsSchema,
  getDomainExportStatusSchema,
];

export type DomainContactDetail = z.infer<typeof DomainContactDetailSchema>;
export type DomainContactAddress = z.infer<typeof DomainContactAddressSchema>;
export type DomainExport = z.infer<typeof DomainExportSchema>;
export type ForwardingRedirect = z.infer<typeof ForwardingRedirectSchema>;

export type GetDomainContactsOutput = z.infer<
  typeof getDomainContactsSchema.output
>;
export type GetDomainNameserversOutput = z.infer<
  typeof getDomainNameserversSchema.output
>;
export type GetDomainForwardingOutput = z.infer<
  typeof getDomainForwardingSchema.output
>;
export type GetDomainPrivacyOutput = z.infer<
  typeof getDomainPrivacySchema.output
>;
export type GetDomainRenewalTermsOutput = z.infer<
  typeof getDomainRenewalTermsSchema.output
>;
export type ListDomainExportsOutput = z.infer<
  typeof listDomainExportsSchema.output
>;
export type ExportDomainsOutput = z.infer<typeof exportDomainsSchema.output>;
export type GetDomainExportStatusOutput = z.infer<
  typeof getDomainExportStatusSchema.output
>;
