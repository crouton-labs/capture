import { z } from 'zod';

// ============================================================================
// Shared entity shapes (this batch OWNS DnsRecord)
// ============================================================================

export const DnsRecordSchema = z
  .object({
    type: z
      .enum([
        'A',
        'AAAA',
        'CNAME',
        'MX',
        'NS',
        'SOA',
        'SRV',
        'TXT',
        'CAA',
        'HTTPS',
        'TLSA',
        'SVCB',
      ])
      .describe('DNS record type.'),
    name: z
      .string()
      .describe(
        'Record host within the zone, relative to the domain. "@" is the apex; e.g. "www", "mail".',
      ),
    data: z
      .string()
      .describe(
        'Record value: an IPv4 (A), IPv6 (AAAA), target hostname (CNAME/NS/MX/SRV), or text payload (TXT/CAA).',
      ),
    ttl: z.number().describe('Time-to-live in seconds.'),
    priority: z
      .number()
      .optional()
      .describe('Priority — used by MX and SRV (lower wins).'),
    service: z.string().optional().describe('SRV: service label, e.g. "_sip".'),
    protocol: z
      .string()
      .optional()
      .describe('SRV: protocol label, e.g. "_tcp", "_udp".'),
    weight: z
      .number()
      .optional()
      .describe('SRV: relative weight among equal-priority targets.'),
    port: z.number().optional().describe('SRV: target port.'),
    flags: z.number().optional().describe('CAA: flags byte (e.g. 0).'),
    tag: z
      .string()
      .optional()
      .describe('CAA: property tag, e.g. "issue", "issuewild", "iodef".'),
  })
  .passthrough()
  .describe(
    'A single DNS record. Records are identified by (type, name). Type-specific fields beyond the common set (e.g. SOA mbox, HTTPS/SVCB params) pass through unchanged.',
  );

export const DnsZoneSchema = z
  .object({
    domain: z
      .string()
      .optional()
      .describe(
        "The zone's domain name (FQDN). Pass to getDnsRecords / exportZoneFile.",
      ),
    status: z.string().optional().describe('Zone status. Treat as opaque.'),
  })
  .passthrough()
  .describe(
    'A GoDaddy-hosted DNS zone. The domain name identifies the zone and is the key passed to getDnsRecords, searchDnsRecords, and exportZoneFile (commonly under `domain`).',
  );

// ============================================================================
// listDnsZones
// ============================================================================

export const listDnsZonesSchema = {
  name: 'listDnsZones',
  description:
    'List the domains that have GoDaddy-hosted DNS zones on this account.',
  notes:
    'Only domains whose DNS is hosted at GoDaddy (using GoDaddy nameservers) appear here; domains pointed at external nameservers are not listed. Returns an empty list when no zones are hosted.',
  input: z.object({
    count: z.number().optional().describe('Max zones to return. Omit for all.'),
  }),
  output: z.object({
    zones: z.array(DnsZoneSchema).describe('Hosted DNS zones.'),
    total: z.number().describe('Total zones available before truncation.'),
  }),
};

// ============================================================================
// getDnsRecords
// ============================================================================

export const getDnsRecordsSchema = {
  name: 'getDnsRecords',
  description:
    "Get the DNS records in a domain's zone, optionally filtered by record type and/or exact record name.",
  notes:
    'Record types: A, AAAA, CNAME, MX, NS, SOA, SRV, TXT, CAA, HTTPS, TLSA, SVCB. `type` matches one type exactly (case-insensitive); `types` filters multiple types server-side (more efficient for large zones); `name` matches the record host exactly ("@" for the apex). Records are identified by (type, name). The domain must use GoDaddy-hosted DNS.',
  input: z.object({
    domainName: z
      .string()
      .describe('The domain whose zone to read, e.g. "example.com".'),
    type: z
      .string()
      .optional()
      .describe(
        'Filter to one record type (e.g. "A", "MX", "TXT"). Omit for all types.',
      ),
    types: z
      .array(
        z.enum([
          'A',
          'AAAA',
          'CNAME',
          'MX',
          'NS',
          'SOA',
          'SRV',
          'TXT',
          'CAA',
          'HTTPS',
          'TLSA',
          'SVCB',
        ]),
      )
      .optional()
      .describe(
        'Filter to one or more record types server-side before fetching (e.g. ["A", "MX"]). More efficient than `type` for large zones. Omit for all types.',
      ),
    name: z
      .string()
      .optional()
      .describe(
        'Filter to records with this exact host name (e.g. "@", "www"). Omit for all names.',
      ),
    count: z
      .number()
      .optional()
      .describe('Max records to return after filtering. Omit for all.'),
  }),
  output: z.object({
    records: z.array(DnsRecordSchema).describe('Matching DNS records.'),
    total: z
      .number()
      .describe('Number of records matching the filters before truncation.'),
  }),
};

// ============================================================================
// searchDnsRecords
// ============================================================================

export const searchDnsRecordsSchema = {
  name: 'searchDnsRecords',
  description:
    "Search a domain's DNS records by type, host-name substring, and/or value substring.",
  notes:
    'Substring and case-insensitive: `name` matches the record host, `value` matches the record data; `type` matches exactly (client-side). `types` (array) filters server-side before fetching — prefer `types` over `type` for large zones. All filters optional — with none, returns every record. Record types: A, AAAA, CNAME, MX, NS, SOA, SRV, TXT, CAA, HTTPS, TLSA, SVCB. The domain must use GoDaddy-hosted DNS.',
  input: z.object({
    domainName: z
      .string()
      .describe('The domain whose zone to search, e.g. "example.com".'),
    type: z
      .string()
      .optional()
      .describe(
        'Restrict to one record type (e.g. "TXT") via client-side exact match. Omit for all types.',
      ),
    types: z
      .array(
        z.enum([
          'A',
          'AAAA',
          'CNAME',
          'MX',
          'NS',
          'SOA',
          'SRV',
          'TXT',
          'CAA',
          'HTTPS',
          'TLSA',
          'SVCB',
        ]),
      )
      .optional()
      .describe(
        'Restrict to one or more record types via server-side filtering (e.g. ["A", "MX"]). More efficient than `type` for large zones. Omit for all types.',
      ),
    name: z
      .string()
      .optional()
      .describe(
        'Match records whose host name contains this substring. Omit to ignore.',
      ),
    value: z
      .string()
      .optional()
      .describe(
        'Match records whose value/data contains this substring (e.g. an IP or "spf"). Omit to ignore.',
      ),
    count: z
      .number()
      .optional()
      .describe(
        'Max records to return after all filters are applied. Omit for all.',
      ),
  }),
  output: z.object({
    records: z.array(DnsRecordSchema).describe('Records matching the search.'),
    total: z.number().describe('Number of matching records before truncation.'),
  }),
};

// ============================================================================
// exportZoneFile
// ============================================================================

export const exportZoneFileSchema = {
  name: 'exportZoneFile',
  description:
    "Export a domain's full DNS zone as a BIND-format zone file (plain text).",
  notes:
    'Returns the zone in standard BIND text format, suitable for backup or import elsewhere. The domain must use GoDaddy-hosted DNS.',
  input: z.object({
    domainName: z
      .string()
      .describe('The domain whose zone file to export, e.g. "example.com".'),
  }),
  output: z.object({
    domainName: z.string().describe('The domain exported.'),
    zoneFile: z.string().describe('The zone in BIND text format.'),
  }),
};

// ============================================================================
// Registry + types
// ============================================================================

export const dnsReadSchemas = [
  listDnsZonesSchema,
  getDnsRecordsSchema,
  searchDnsRecordsSchema,
  exportZoneFileSchema,
];

export type DnsRecord = z.infer<typeof DnsRecordSchema>;
export type DnsZone = z.infer<typeof DnsZoneSchema>;
export type ListDnsZonesOutput = z.infer<typeof listDnsZonesSchema.output>;
export type GetDnsRecordsOutput = z.infer<typeof getDnsRecordsSchema.output>;
export type SearchDnsRecordsOutput = z.infer<
  typeof searchDnsRecordsSchema.output
>;
export type ExportZoneFileOutput = z.infer<typeof exportZoneFileSchema.output>;
