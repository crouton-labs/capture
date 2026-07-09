import { z } from 'zod';

// ============================================================================
// DNS record INPUT shape (local to this batch — not cross-imported)
// ============================================================================

export const DnsRecordTypeEnum = z
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
  .describe('DNS record type.');

export const DnsRecordInputSchema = z
  .object({
    type: DnsRecordTypeEnum,
    name: z
      .string()
      .describe(
        'Host/subdomain relative to the zone. Use "@" for the zone apex (the bare domain), "www" for www.<domain>, "mail" for a mail host, etc.',
      ),
    data: z
      .string()
      .optional()
      .describe(
        'Record value/target. A → IPv4 address, AAAA → IPv6 address, CNAME/NS → hostname, MX → mail server hostname, TXT → text value, CAA → CA domain. Required for every type except SOA.',
      ),
    ttl: z
      .number()
      .optional()
      .describe(
        'Time-to-live in seconds (e.g. 600, 3600). Omit to use the zone default.',
      ),
    priority: z
      .number()
      .optional()
      .describe(
        'Required for MX and SRV; also the SvcPriority for HTTPS and SVCB. Lower number = higher priority.',
      ),
    service: z
      .string()
      .optional()
      .describe('SRV only: service name, e.g. "_sip".'),
    protocol: z
      .string()
      .optional()
      .describe('SRV/TLSA: protocol, e.g. "_tcp". Required for SRV and TLSA.'),
    weight: z
      .number()
      .optional()
      .describe('SRV only: relative weight among targets sharing a priority.'),
    port: z
      .number()
      .optional()
      .describe('SRV/TLSA: target port number. Required for SRV and TLSA.'),
    flags: z
      .number()
      .optional()
      .describe('CAA only: flags byte (typically 0).'),
    tag: z
      .string()
      .optional()
      .describe(
        'CAA only: property tag — one of "issue", "issuewild", "iodef".',
      ),
    parameters: z
      .string()
      .optional()
      .describe('HTTPS/SVCB only: SvcParams string, e.g. "alpn=h2 port=443".'),
    certificate_data: z
      .string()
      .optional()
      .describe(
        'TLSA only: hex-encoded certificate or public-key data (the actual cert bytes or their hash, depending on matching_type).',
      ),
    matching_type: z
      .number()
      .optional()
      .describe(
        'TLSA only: matching type — 0 = exact match (full cert/SPKI), 1 = SHA-256 hash, 2 = SHA-512 hash.',
      ),
    selector: z
      .number()
      .optional()
      .describe(
        'TLSA only: selector — 0 = full certificate DER, 1 = SubjectPublicKeyInfo (public key only).',
      ),
    guid: z
      .string()
      .optional()
      .describe(
        'Server-assigned record identifier. Omit when creating; pass when updating a specific existing record to target it precisely instead of relying on type+name matching.',
      ),
    mbox: z
      .string()
      .optional()
      .describe(
        'SOA only: responsible-party mailbox (email with @ written as a dot).',
      ),
    ns: z
      .string()
      .optional()
      .describe('SOA only: primary authoritative nameserver.'),
    serial: z.number().optional().describe('SOA only: zone serial number.'),
    refresh: z
      .number()
      .optional()
      .describe('SOA only: refresh interval in seconds.'),
    retry: z
      .number()
      .optional()
      .describe('SOA only: retry interval in seconds.'),
    expire: z
      .number()
      .optional()
      .describe('SOA only: expire interval in seconds.'),
    minimum: z
      .number()
      .optional()
      .describe('SOA only: minimum/negative-cache TTL in seconds.'),
  })
  .describe(
    "A DNS record to create or update. Required fields vary by type (see each function's notes).",
  );

export const DnsRecordKeySchema = z
  .object({
    type: DnsRecordTypeEnum,
    name: z
      .string()
      .describe(
        'Host/subdomain of the record to remove. Use "@" for the zone apex.',
      ),
  })
  .describe(
    'Identifies one DNS record by its type and name (the customer DNS zone has no opaque per-record id).',
  );

// ============================================================================
// Shared output shapes
// ============================================================================

const RecordWriteResult = z.object({
  domainName: z.string().describe('The zone the write targeted.'),
  dryRun: z
    .boolean()
    .describe(
      'True when the call only validated the change without committing it.',
    ),
  recordCount: z.number().describe('How many records the write covered.'),
});

const DnsHostingResult = z.object({
  domainName: z.string().describe('The domain whose DNS hosting changed.'),
  dnsHostingEnabled: z
    .boolean()
    .describe(
      'DNS hosting state after the call: true after adding, false after cancelling.',
    ),
});

// ============================================================================
// Function schemas
// ============================================================================

const RECORD_TYPE_NOTE =
  'Record types: A, AAAA, CNAME, MX, NS, SOA, SRV, TXT, CAA, HTTPS, TLSA, SVCB. ' +
  'Required fields by type — A/AAAA/CNAME/NS/TXT: name+data; MX: name+data+priority; ' +
  'SRV: service+protocol+name+data+priority+weight+port; CAA: name+data+tag(+flags); ' +
  'HTTPS/SVCB: name+data(+priority+parameters); SOA: name+mbox+ns(+serial/refresh/retry/expire/minimum); ' +
  'TLSA: port+protocol+name+data(cert_usage)+selector+matching_type+certificate_data. ' +
  'Use "@" as the name for the zone apex.';

const ROUTING_WARNING =
  'DNS changes take effect for the live domain and can alter where the website and email route — ' +
  'a wrong A/CNAME/MX/TXT edit can take a site offline or break mail. Set dryRun: true first to validate, ' +
  'then re-run with dryRun omitted to commit. Only affects domains that use GoDaddy nameservers.';

export const createDnsRecordSchema = {
  name: 'createDnsRecord',
  description: "Create a single DNS record in a domain's zone.",
  notes: `${RECORD_TYPE_NOTE} ${ROUTING_WARNING}`,
  input: z.object({
    domainName: z
      .string()
      .describe('The domain whose zone to add the record to.'),
    record: DnsRecordInputSchema.describe('The record to add.'),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'When true, validate the change without committing it. Defaults to false.',
      ),
  }),
  output: RecordWriteResult,
};

export const createDnsRecordsSchema = {
  name: 'createDnsRecords',
  description: "Create multiple DNS records in a domain's zone in one call.",
  notes: `${RECORD_TYPE_NOTE} ${ROUTING_WARNING}`,
  input: z.object({
    domainName: z
      .string()
      .describe('The domain whose zone to add the records to.'),
    records: z
      .array(DnsRecordInputSchema)
      .min(1)
      .describe('The records to add (at least one).'),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'When true, validate the changes without committing them. Defaults to false.',
      ),
  }),
  output: RecordWriteResult,
};

export const updateDnsRecordSchema = {
  name: 'updateDnsRecord',
  description:
    'Update a single existing DNS record, matched by its type and name, with new values.',
  notes: `The existing record sharing this type+name is replaced with the supplied values, so pass the complete record (type, name, and every field it should keep). ${RECORD_TYPE_NOTE} ${ROUTING_WARNING}`,
  input: z.object({
    domainName: z
      .string()
      .describe('The domain whose zone contains the record.'),
    record: DnsRecordInputSchema.describe(
      "The record's desired final state; its type+name select which record to replace.",
    ),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'When true, validate the change without committing it. Defaults to false.',
      ),
  }),
  output: RecordWriteResult,
};

export const updateDnsRecordsSchema = {
  name: 'updateDnsRecords',
  description:
    'Update multiple existing DNS records, each matched by its type and name, in one call.',
  notes: `Each record is matched by type+name and replaced with the supplied values, so pass each record complete. ${RECORD_TYPE_NOTE} ${ROUTING_WARNING}`,
  input: z.object({
    domainName: z
      .string()
      .describe('The domain whose zone contains the records.'),
    records: z
      .array(DnsRecordInputSchema)
      .min(1)
      .describe("The records' desired final states (at least one)."),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'When true, validate the changes without committing them. Defaults to false.',
      ),
  }),
  output: RecordWriteResult,
};

export const deleteDnsRecordSchema = {
  name: 'deleteDnsRecord',
  description:
    "Delete a single DNS record from a domain's zone, identified by its type and name.",
  notes: `Removes every record sharing this type+name in the zone. ${ROUTING_WARNING}`,
  input: z.object({
    domainName: z
      .string()
      .describe('The domain whose zone contains the record.'),
    type: DnsRecordTypeEnum,
    name: z
      .string()
      .describe(
        'Host/subdomain of the record to delete. Use "@" for the zone apex.',
      ),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'When true, validate the deletion without committing it. Defaults to false.',
      ),
  }),
  output: RecordWriteResult,
};

export const deleteDnsRecordsSchema = {
  name: 'deleteDnsRecords',
  description:
    "Delete multiple DNS records from a domain's zone in one call, each identified by type and name.",
  notes: `Removes every record sharing each given type+name. ${ROUTING_WARNING}`,
  input: z.object({
    domainName: z
      .string()
      .describe('The domain whose zone contains the records.'),
    records: z
      .array(DnsRecordKeySchema)
      .min(1)
      .describe('The records to delete, each by type+name (at least one).'),
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'When true, validate the deletions without committing them. Defaults to false.',
      ),
  }),
  output: RecordWriteResult,
};

export const addDnsHostingSchema = {
  name: 'addDnsHosting',
  description:
    'Enable GoDaddy DNS hosting (a managed zone) for a domain so its DNS records can be managed here.',
  notes:
    'Use for a domain that does not yet have a GoDaddy-hosted zone — including a domain registered elsewhere but pointed at GoDaddy nameservers. Create/update/delete record functions require a hosted zone to exist first.',
  input: z.object({
    domainName: z.string().describe('The domain to enable DNS hosting for.'),
  }),
  output: DnsHostingResult,
};

export const cancelDnsHostingSchema = {
  name: 'cancelDnsHosting',
  description:
    'Cancel GoDaddy DNS hosting for one or more domains, removing their managed zones.',
  notes:
    'Tears down the GoDaddy-hosted zone and the records in it; the website and email that relied on those records stop resolving through GoDaddy. Irreversible without re-adding hosting and recreating the records. Does not support dryRun. Throws if the domain does not have GoDaddy DNS hosting enabled.',
  input: z.object({
    domainName: z.string().describe('The domain to cancel DNS hosting for.'),
    domainNames: z
      .array(z.string())
      .optional()
      .describe(
        'Additional domains to cancel in the same batch request. All domains in domainName + domainNames are cancelled together in one API call.',
      ),
  }),
  output: DnsHostingResult,
};

// ============================================================================
// Registry + inferred output types
// ============================================================================

export const dnsWriteSchemas = [
  createDnsRecordSchema,
  createDnsRecordsSchema,
  updateDnsRecordSchema,
  updateDnsRecordsSchema,
  deleteDnsRecordSchema,
  deleteDnsRecordsSchema,
  addDnsHostingSchema,
  cancelDnsHostingSchema,
];

export type DnsRecordInput = z.infer<typeof DnsRecordInputSchema>;
export type DnsRecordKey = z.infer<typeof DnsRecordKeySchema>;
export type CreateDnsRecordOutput = z.infer<
  typeof createDnsRecordSchema.output
>;
export type CreateDnsRecordsOutput = z.infer<
  typeof createDnsRecordsSchema.output
>;
export type UpdateDnsRecordOutput = z.infer<
  typeof updateDnsRecordSchema.output
>;
export type UpdateDnsRecordsOutput = z.infer<
  typeof updateDnsRecordsSchema.output
>;
export type DeleteDnsRecordOutput = z.infer<
  typeof deleteDnsRecordSchema.output
>;
export type DeleteDnsRecordsOutput = z.infer<
  typeof deleteDnsRecordsSchema.output
>;
export type AddDnsHostingOutput = z.infer<typeof addDnsHostingSchema.output>;
export type CancelDnsHostingOutput = z.infer<
  typeof cancelDnsHostingSchema.output
>;
