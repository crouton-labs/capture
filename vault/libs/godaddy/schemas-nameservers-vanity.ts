import { z } from 'zod';

// ============================================================================
// Shared entity shapes
// ============================================================================

export const VanityHostSchema = z
  .object({
    hostName: z
      .string()
      .describe(
        'Fully-qualified host (glue) record name, e.g. "ns1.example.com". Must be a subdomain of the domain it belongs to.',
      ),
    ipAddresses: z
      .array(z.string())
      .describe(
        'IP addresses this host resolves to (IPv4 and/or IPv6). A glue record needs at least one.',
      ),
  })
  .passthrough()
  .describe(
    'A vanity host / glue record: an in-domain nameserver name registered at the registry so it can serve DNS for its own domain.',
  );

export const SecondaryDnsConfigSchema = z
  .object({
    masterIp: z
      .string()
      .optional()
      .describe(
        'Primary (master) nameserver IP the GoDaddy secondary servers transfer the zone from via AXFR.',
      ),
    masters: z
      .array(z.string())
      .optional()
      .describe(
        'Master nameserver IPs, when the provider reports more than one.',
      ),
    nameServers: z
      .array(z.string())
      .optional()
      .describe(
        'GoDaddy secondary (slave) nameserver hostnames to set as the domain authoritative NS.',
      ),
    status: z
      .string()
      .optional()
      .describe('Configuration status code. Treat as opaque.'),
  })
  .passthrough()
  .describe(
    'Secondary (slave) DNS configuration for a domain. Additional provider-specific fields may be present.',
  );

// ============================================================================
// listVanityHosts
// ============================================================================

export const listVanityHostsSchema = {
  name: 'listVanityHosts',
  description:
    'List the vanity hosts (registered glue records / in-domain nameservers) for a domain, each with the IP addresses it resolves to.',
  notes:
    'Returns an empty list (total 0) when the domain has no vanity hosts. Vanity hosts are glue records for nameservers that live under this same domain (e.g. ns1.example.com on example.com).',
  input: z.object({
    domainName: z
      .string()
      .describe('The domain whose vanity hosts to list, e.g. "example.com".'),
  }),
  output: z.object({
    hosts: z.array(VanityHostSchema).describe('The domain vanity hosts.'),
    total: z.number().describe('Number of vanity hosts returned.'),
  }),
};

// ============================================================================
// createVanityHost
// ============================================================================

export const createVanityHostSchema = {
  name: 'createVanityHost',
  description:
    'Register a new vanity host (glue record / in-domain nameserver) on a domain, mapping a host name to one or more IP addresses.',
  notes:
    'hostName must be a subdomain of domainName (glue records only register nameservers within the domain itself). Provide at least one IP address; mix IPv4 and IPv6 as needed.',
  input: z.object({
    domainName: z
      .string()
      .describe('The domain to add the vanity host to, e.g. "example.com".'),
    hostName: z
      .string()
      .describe(
        'Fully-qualified host name to register, e.g. "ns1.example.com".',
      ),
    ips: z
      .array(z.string())
      .min(1)
      .describe('IP addresses the host resolves to (IPv4 and/or IPv6).'),
  }),
  output: z.object({
    host: VanityHostSchema.describe('The registered vanity host.'),
  }),
};

// ============================================================================
// updateVanityHost
// ============================================================================

export const updateVanityHostSchema = {
  name: 'updateVanityHost',
  description:
    'Update the IP addresses of an existing vanity host (glue record) on a domain. Replaces the host IP set with the provided one.',
  notes:
    'The provided ips REPLACE the existing IP set for the host — include every IP the host should resolve to. Set dryRun: true to validate the change without committing it; default false.',
  input: z.object({
    domainName: z
      .string()
      .describe('The domain the vanity host belongs to, e.g. "example.com".'),
    hostName: z
      .string()
      .describe('The existing host name to update, e.g. "ns1.example.com".'),
    ips: z
      .array(z.string())
      .min(1)
      .describe('Full replacement set of IP addresses (IPv4 and/or IPv6).'),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'When true, validate the change without applying it. Default false.',
      ),
  }),
  output: z.object({
    host: VanityHostSchema.describe('The vanity host with its updated IP set.'),
    dryRun: z
      .boolean()
      .describe(
        'Whether this was a dry-run validation (true) or a committed change (false).',
      ),
  }),
};

// ============================================================================
// deleteVanityHost
// ============================================================================

export const deleteVanityHostSchema = {
  name: 'deleteVanityHost',
  description: 'Delete a vanity host (glue record) from a domain.',
  notes:
    'Removing a vanity host that is still referenced as an authoritative nameserver can break DNS resolution for any domain pointing at it. Confirm the host is no longer in use first. Set dryRun: true to validate the deletion without committing it; default false.',
  input: z.object({
    domainName: z
      .string()
      .describe('The domain the vanity host belongs to, e.g. "example.com".'),
    hostName: z
      .string()
      .describe('The host name to delete, e.g. "ns1.example.com".'),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'When true, validate the deletion without applying it. Default false.',
      ),
  }),
  output: z.object({
    deleted: z
      .boolean()
      .describe(
        'True when the host was deleted (or would be deleted when dryRun is true).',
      ),
    hostName: z.string().describe('The host name that was deleted.'),
    dryRun: z
      .boolean()
      .describe(
        'Whether this was a dry-run validation (true) or a committed deletion (false).',
      ),
  }),
};

// ============================================================================
// getSecondaryDns
// ============================================================================

export const getSecondaryDnsSchema = {
  name: 'getSecondaryDns',
  description:
    'Get the secondary (slave) DNS configuration for a domain — whether GoDaddy is acting as secondary DNS and, if so, the master it transfers from.',
  notes:
    'Returns configured: false with config: null when secondary DNS is not set up for the domain. Secondary DNS makes GoDaddy nameservers serve a zone whose authoritative master lives elsewhere.',
  input: z.object({
    domainName: z
      .string()
      .describe(
        'The domain whose secondary DNS configuration to read, e.g. "example.com".',
      ),
  }),
  output: z.object({
    configured: z
      .boolean()
      .describe(
        'Whether secondary DNS is currently configured for the domain.',
      ),
    config: SecondaryDnsConfigSchema.nullable().describe(
      'The secondary DNS configuration, or null when not configured.',
    ),
  }),
};

// ============================================================================
// updateSecondaryDns
// ============================================================================

export const updateSecondaryDnsSchema = {
  name: 'updateSecondaryDns',
  description:
    'Configure secondary (slave) DNS for a domain, pointing GoDaddy secondary nameservers at your primary master server for zone transfer.',
  notes:
    'masterIp is your primary nameserver IP that GoDaddy transfers the zone from (AXFR). Additional secondary-DNS settings can be supplied alongside masterIp. The domain must use GoDaddy nameservers for secondary DNS to take effect.',
  input: z
    .object({
      domainName: z
        .string()
        .describe(
          'The domain to configure secondary DNS for, e.g. "example.com".',
        ),
      masterIp: z
        .string()
        .describe(
          'Primary (master) nameserver IP that GoDaddy transfers the zone from via AXFR.',
        ),
    })
    .passthrough(),
  output: z.object({
    configured: z
      .boolean()
      .describe('True when the configuration was applied.'),
    config: SecondaryDnsConfigSchema.describe(
      'The secondary DNS configuration now in effect.',
    ),
  }),
};

// ============================================================================
// Registry + inferred output types
// ============================================================================

export const nameserversVanitySchemas = [
  listVanityHostsSchema,
  createVanityHostSchema,
  updateVanityHostSchema,
  deleteVanityHostSchema,
  getSecondaryDnsSchema,
  updateSecondaryDnsSchema,
];

export type VanityHost = z.infer<typeof VanityHostSchema>;
export type SecondaryDnsConfig = z.infer<typeof SecondaryDnsConfigSchema>;
export type ListVanityHostsOutput = z.infer<
  typeof listVanityHostsSchema.output
>;
export type CreateVanityHostOutput = z.infer<
  typeof createVanityHostSchema.output
>;
export type UpdateVanityHostOutput = z.infer<
  typeof updateVanityHostSchema.output
>;
export type DeleteVanityHostOutput = z.infer<
  typeof deleteVanityHostSchema.output
>;
export type GetSecondaryDnsOutput = z.infer<
  typeof getSecondaryDnsSchema.output
>;
export type UpdateSecondaryDnsOutput = z.infer<
  typeof updateSecondaryDnsSchema.output
>;
