import { z } from 'zod';

// ============================================================================
// Shared entity shapes
// ============================================================================

export const DomainMailingAddressSchema = z
  .object({
    address1: z.string().describe('Street address line 1.'),
    address2: z
      .string()
      .optional()
      .describe('Street address line 2 (suite/unit), when applicable.'),
    city: z.string().describe('City.'),
    state: z
      .string()
      .describe('State / province. For US use the 2-letter code (e.g. "AZ").'),
    postalCode: z.string().describe('Postal / ZIP code.'),
    country: z
      .string()
      .describe('ISO 3166-1 alpha-2 country code (e.g. "US", "GB").'),
  })
  .describe('Postal mailing address for a domain contact.');

export const DomainContactSchema = z
  .object({
    nameFirst: z.string().describe('Contact first/given name.'),
    nameLast: z.string().describe('Contact last/family name.'),
    nameMiddle: z
      .string()
      .optional()
      .describe('Contact middle name, when applicable.'),
    organization: z
      .string()
      .optional()
      .describe('Organization / company name, when applicable.'),
    jobTitle: z
      .string()
      .optional()
      .describe('Contact job title, when applicable.'),
    email: z.string().describe('Contact email address.'),
    phone: z
      .string()
      .describe(
        'Contact phone in GoDaddy dotted E.164 format: "+<country>.<number>", e.g. "+1.4805551212".',
      ),
    fax: z
      .string()
      .optional()
      .describe(
        'Contact fax in the same dotted E.164 format, when applicable.',
      ),
    addressMailing: DomainMailingAddressSchema.describe(
      'Contact postal address.',
    ),
  })
  .passthrough()
  .describe(
    'A single ICANN domain contact (registrant, admin, tech, or billing).',
  );

export const DomainContactSetSchema = z
  .object({
    registrant: DomainContactSchema.optional().describe(
      'Registrant (owner) contact.',
    ),
    admin: DomainContactSchema.optional().describe('Administrative contact.'),
    tech: DomainContactSchema.optional().describe('Technical contact.'),
    billing: DomainContactSchema.optional().describe('Billing contact.'),
  })
  .describe(
    'Domain contact set. Supply only the contact roles you want to change; omitted roles are left untouched.',
  );

export const DomainForwardingConfigSchema = z
  .object({
    type: z
      .enum(['MASKED', 'REDIRECT_PERMANENT', 'REDIRECT_TEMPORARY'])
      .describe(
        'Forwarding type. MASKED = framed forward that keeps your domain in the address bar; REDIRECT_PERMANENT = 301 redirect; REDIRECT_TEMPORARY = 302 redirect.',
      ),
    destination: z
      .string()
      .describe(
        'Destination URL the domain (or subdomain) forwards to. Include the scheme, e.g. "https://example.org".',
      ),
    mask: z
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
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe(
            'Meta keywords for the masking frame. Accepts a space-separated string or an array of keyword strings.',
          ),
      })
      .optional()
      .describe('Masking metadata. Only used when type is MASKED.'),
  })
  .describe('Domain/subdomain forwarding configuration.');

// ============================================================================
// setDomainAutoRenew
// ============================================================================

export const setDomainAutoRenewSchema = {
  name: 'setDomainAutoRenew',
  description:
    'Turn auto-renew ON or OFF for one or more domains in the signed-in account. Does not renew or charge; only flips the auto-renew flag.',
  notes:
    'Operates on the signed-in account; do not pass any account id. No charge and reversible. To renew a domain (which DOES charge) use a renew function instead.',
  input: z.object({
    domainNames: z
      .array(z.string())
      .min(1)
      .describe('One or more domain names to update, e.g. ["example.com"].'),
    autoRenew: z
      .boolean()
      .describe('Desired auto-renew state: true = ON, false = OFF.'),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'When true, validate the change without applying it. Default false.',
      ),
  }),
  output: z.object({
    domainNames: z
      .array(z.string())
      .describe('Domains whose auto-renew state was set.'),
    autoRenew: z
      .boolean()
      .describe('The auto-renew state now applied to those domains.'),
    dryRun: z
      .boolean()
      .describe(
        'Whether this was a validation-only run (true) or actually applied (false).',
      ),
  }),
};

// ============================================================================
// setDomainLock
// ============================================================================

export const setDomainLockSchema = {
  name: 'setDomainLock',
  description:
    'Enable or disable the registrar lock (transfer lock) on one or more domains. Locking blocks transfers away from GoDaddy; unlock before starting an outbound transfer.',
  notes:
    'Operates on the signed-in account; do not pass any account id. Registrar lock is distinct from DNSSEC and from privacy. Some TLDs do not support registrar lock.',
  input: z.object({
    domainNames: z
      .array(z.string())
      .min(1)
      .describe('One or more domain names to update.'),
    locked: z
      .boolean()
      .describe(
        'Desired lock state: true = locked (transfers blocked), false = unlocked.',
      ),
  }),
  output: z.object({
    domainNames: z
      .array(z.string())
      .describe('Domains whose lock state was set.'),
    locked: z
      .boolean()
      .describe('The registrar-lock state now applied to those domains.'),
  }),
};

// ============================================================================
// updateDomainNameservers
// ============================================================================

export const updateDomainNameserversSchema = {
  name: 'updateDomainNameservers',
  description:
    'Replace the authoritative nameservers for one or more domains. This points the domain at a new DNS provider.',
  notes:
    'DESTRUCTIVE: changing nameservers moves DNS authority away from the current provider and can break website hosting and email until the new nameservers serve equivalent records. Confirm with the user before applying. Most TLDs require at least 2 nameservers. Set dryRun=true to validate the change without applying it (default false).',
  input: z.object({
    domainNames: z
      .array(z.string())
      .min(1)
      .describe('One or more domain names to update.'),
    nameservers: z
      .array(z.string())
      .min(1)
      .describe(
        'Ordered list of fully-qualified nameserver hostnames, e.g. ["ns1.example.com","ns2.example.com"]. Most TLDs require 2 or more.',
      ),
    nameserverType: z
      .enum(['DEFAULT', 'HOSTING', 'FORWARDING', 'CUSTOM'])
      .optional()
      .describe(
        'Nameserver type sent to the API. DEFAULT = GoDaddy default nameservers; HOSTING = GoDaddy hosting nameservers; FORWARDING = GoDaddy forwarding nameservers; CUSTOM = user-supplied nameservers (default when omitted).',
      ),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'When true, validate the change without applying it. Default false.',
      ),
  }),
  output: z.object({
    domainNames: z
      .array(z.string())
      .describe('Domains targeted by the update.'),
    nameservers: z
      .array(z.string())
      .describe('The nameservers requested for those domains.'),
    dryRun: z
      .boolean()
      .describe(
        'Whether this was a validation-only run (true) or actually applied (false).',
      ),
  }),
};

// ============================================================================
// updateDomainContacts
// ============================================================================

export const updateDomainContactsSchema = {
  name: 'updateDomainContacts',
  description:
    'Update the registrant, admin, tech, and/or billing contacts on one or more domains. Supply only the contact roles you want to change.',
  notes:
    'Changing the registrant or its name/email/organization can trigger ICANN re-verification (a confirmation email) and may impose a 60-day transfer lock. Phone/fax use dotted E.164 format ("+1.4805551212"). country is ISO 3166-1 alpha-2. Set dryRun=true to validate the contact data without applying it (default false).',
  input: z.object({
    domainNames: z
      .array(z.string())
      .min(1)
      .describe('One or more domain names to update.'),
    contacts: DomainContactSetSchema.describe(
      'Contact roles to set. Provide at least one of registrant/admin/tech/billing.',
    ),
    localContacts: DomainContactSetSchema.optional().describe(
      'Localized contact data for domains that require non-ASCII WHOIS records (e.g. IDN domains). When omitted, falls back to contacts.',
    ),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'When true, validate the contacts without applying them. Default false.',
      ),
  }),
  output: z.object({
    domainNames: z
      .array(z.string())
      .describe('Domains targeted by the update.'),
    updatedRoles: z
      .array(z.enum(['registrant', 'admin', 'tech', 'billing']))
      .describe('Contact roles that were submitted in this update.'),
    dryRun: z
      .boolean()
      .describe(
        'Whether this was a validation-only run (true) or actually applied (false).',
      ),
  }),
};

// ============================================================================
// updateDomainForwarding
// ============================================================================

export const updateDomainForwardingSchema = {
  name: 'updateDomainForwarding',
  description:
    'Set or update URL forwarding for a domain, or for a specific subdomain of it. Forwarding sends visitors of the domain to another URL.',
  notes:
    'Requires the domain to be registered with GoDaddy (not merely DNS-hosted). Domains that are only DNS-hosted will return a 404. To forward a subdomain (e.g. blog.example.com), pass subdomain="blog"; omit subdomain to forward the apex domain. type values: MASKED, REDIRECT_PERMANENT (301), REDIRECT_TEMPORARY (302).',
  input: z.object({
    domainName: z.string().describe('The apex domain, e.g. "example.com".'),
    subdomain: z
      .string()
      .optional()
      .describe(
        'Subdomain label to forward (e.g. "blog" or "www"). Omit to forward the apex domain.',
      ),
    forwarding: DomainForwardingConfigSchema.describe(
      'The forwarding configuration to apply.',
    ),
  }),
  output: z.object({
    domainName: z.string().describe('The apex domain targeted.'),
    subdomain: z
      .string()
      .optional()
      .describe('The subdomain targeted, when forwarding a subdomain.'),
    forwarding: DomainForwardingConfigSchema.describe(
      'The forwarding configuration that was applied.',
    ),
  }),
};

// ============================================================================
// deleteDomainForwarding
// ============================================================================

export const deleteDomainForwardingSchema = {
  name: 'deleteDomainForwarding',
  description:
    'Remove URL forwarding from a domain, or from a specific subdomain of it.',
  notes:
    'To remove forwarding from a subdomain, pass subdomain (e.g. "blog"); omit subdomain to remove apex-domain forwarding. Throws NotFound (404) if the domain has no forwarding configured or is not in the account.',
  input: z.object({
    domainName: z.string().describe('The apex domain, e.g. "example.com".'),
    subdomain: z
      .string()
      .optional()
      .describe(
        'Subdomain label whose forwarding to remove. Omit to remove apex-domain forwarding.',
      ),
  }),
  output: z.object({
    domainName: z.string().describe('The apex domain targeted.'),
    subdomain: z
      .string()
      .optional()
      .describe('The subdomain targeted, when removing subdomain forwarding.'),
    deleted: z
      .boolean()
      .describe('True once the forwarding removal was accepted.'),
  }),
};

// ============================================================================
// Registry + inferred output types
// ============================================================================

export const domainWriteSettingsSchemas = [
  setDomainAutoRenewSchema,
  setDomainLockSchema,
  updateDomainNameserversSchema,
  updateDomainContactsSchema,
  updateDomainForwardingSchema,
  deleteDomainForwardingSchema,
];

export type DomainContact = z.infer<typeof DomainContactSchema>;
export type DomainContactSet = z.infer<typeof DomainContactSetSchema>;
export type DomainForwardingConfig = z.infer<
  typeof DomainForwardingConfigSchema
>;

export type SetDomainAutoRenewOutput = z.infer<
  typeof setDomainAutoRenewSchema.output
>;
export type SetDomainLockOutput = z.infer<typeof setDomainLockSchema.output>;
export type UpdateDomainNameserversOutput = z.infer<
  typeof updateDomainNameserversSchema.output
>;
export type UpdateDomainContactsOutput = z.infer<
  typeof updateDomainContactsSchema.output
>;
export type UpdateDomainForwardingOutput = z.infer<
  typeof updateDomainForwardingSchema.output
>;
export type DeleteDomainForwardingOutput = z.infer<
  typeof deleteDomainForwardingSchema.output
>;
