import { z } from 'zod';

// ============================================================================
// Shared entity — DNSSEC Delegation Signer (DS) record
// ============================================================================

export const DsRecordSchema = z
  .object({
    dsRecordId: z
      .union([z.string(), z.number()])
      .optional()
      .describe(
        'Opaque id of an existing DS record. Use with updateDsRecord / deleteDsRecord. Present on records returned by listDsRecords.',
      ),
    keyTag: z
      .union([z.number(), z.string()])
      .describe(
        'Key Tag (0–65535) identifying the DNSKEY this DS record references.',
      ),
    algorithm: z
      .union([z.number(), z.string()])
      .describe(
        'DNSSEC algorithm number. Common: 8 = RSA/SHA-256, 10 = RSA/SHA-512, 13 = ECDSA P-256/SHA-256, 14 = ECDSA P-384/SHA-384, 15 = Ed25519, 16 = Ed448.',
      ),
    digestType: z
      .union([z.number(), z.string()])
      .describe(
        'Digest algorithm. Common: 1 = SHA-1, 2 = SHA-256, 4 = SHA-384.',
      ),
    digest: z.string().describe('Hex-encoded digest of the referenced DNSKEY.'),
  })
  .passthrough()
  .describe(
    'A DNSSEC Delegation Signer (DS) record published at the registry for a domain.',
  );

// ============================================================================
// getDnssec
// ============================================================================

export const getDnssecSchema = {
  name: 'getDnssec',
  description:
    "Get a domain's DNSSEC status, including whether DNSSEC is enabled and any published DS records.",
  notes:
    "The domain must use GoDaddy's Managed DNS service (nameservers pointing to GoDaddy). Domains registered at GoDaddy but using external nameservers are not supported — a 404 error means the domain is not on GoDaddy Managed DNS.",
  input: z.object({
    domainName: z
      .string()
      .describe('The domain (FQDN) to read DNSSEC status for.'),
  }),
  output: z
    .object({
      domainName: z.string().describe('The domain the status applies to.'),
      enabled: z
        .boolean()
        .optional()
        .describe('Whether DNSSEC is currently enabled for the domain.'),
      status: z
        .string()
        .optional()
        .describe('DNSSEC status/state, when reported.'),
      dsRecord: z
        .array(DsRecordSchema)
        .optional()
        .describe(
          'Published DS records for the domain. Raw API field name is `dsRecord` (array).',
        ),
      dsRecords: z
        .array(DsRecordSchema)
        .optional()
        .describe(
          'Published DS records — present when the API returns them under this alternate key.',
        ),
      notifyEmail: z
        .string()
        .optional()
        .describe(
          'Email address registered to receive DNSSEC verification notifications.',
        ),
      signedDate: z
        .string()
        .optional()
        .describe(
          'ISO date-time when DNSSEC was last signed/activated for the domain.',
        ),
    })
    .passthrough(),
};

// ============================================================================
// enableDnssec
// ============================================================================

export const enableDnssecSchema = {
  name: 'enableDnssec',
  description: 'Enable DNSSEC for a domain.',
  notes:
    "The domain must use GoDaddy's Managed DNS service. Manage the published DS records separately with createDsRecord / updateDsRecord / deleteDsRecord. Reversible via disableDnssec.",
  input: z.object({
    domainName: z.string().describe('The domain (FQDN) to enable DNSSEC for.'),
    notifyEmail: z
      .string()
      .optional()
      .describe(
        'Email address to register for DNSSEC verification notifications. Optional.',
      ),
  }),
  output: z.object({
    domainName: z.string().describe('The domain DNSSEC was enabled for.'),
    enabled: z.boolean().describe('Always true on success.'),
  }),
};

// ============================================================================
// disableDnssec
// ============================================================================

export const disableDnssecSchema = {
  name: 'disableDnssec',
  description: 'Disable DNSSEC for a domain.',
  notes:
    "The domain must use GoDaddy's Managed DNS service. Disabling DNSSEC removes registry signing protection. Reversible via enableDnssec.",
  input: z.object({
    domainName: z.string().describe('The domain (FQDN) to disable DNSSEC for.'),
    notifyEmail: z
      .string()
      .optional()
      .describe(
        'Email address to register for DNSSEC verification notifications. Optional.',
      ),
  }),
  output: z.object({
    domainName: z.string().describe('The domain DNSSEC was disabled for.'),
    enabled: z.boolean().describe('Always false on success.'),
  }),
};

// ============================================================================
// listDsRecords
// ============================================================================

export const listDsRecordsSchema = {
  name: 'listDsRecords',
  description: "List a domain's DNSSEC Delegation Signer (DS) records.",
  notes:
    "The domain must use GoDaddy's Managed DNS service. Returns an empty list when the domain has no DS records. Each record carries a dsRecordId for use with updateDsRecord / deleteDsRecord.",
  input: z.object({
    domainName: z
      .string()
      .describe('The domain (FQDN) to list DS records for.'),
  }),
  output: z.object({
    dsRecords: z
      .array(DsRecordSchema)
      .describe("The domain's DS records (empty if none)."),
    total: z.number().describe('Number of DS records returned.'),
  }),
};

// ============================================================================
// createDsRecord
// ============================================================================

export const createDsRecordSchema = {
  name: 'createDsRecord',
  description: 'Add a DNSSEC Delegation Signer (DS) record to a domain.',
  notes:
    "The domain must use GoDaddy's Managed DNS service. algorithm: 8 = RSA/SHA-256, 10 = RSA/SHA-512, 13 = ECDSA P-256/SHA-256, 14 = ECDSA P-384/SHA-384, 15 = Ed25519, 16 = Ed448. digestType: 1 = SHA-1, 2 = SHA-256, 4 = SHA-384. keyTag is 0–65535. digest is the hex-encoded DNSKEY digest. Optionally supply DNSKEY record fields (flags, protocol, keyDataAlgorithm, publicKey) to provide the full key data alongside the DS record.",
  input: z.object({
    domainName: z
      .string()
      .describe('The domain (FQDN) to add the DS record to.'),
    keyTag: z
      .number()
      .int()
      .min(0)
      .max(65535)
      .describe('Key Tag (0–65535) identifying the referenced DNSKEY.'),
    algorithm: z
      .number()
      .int()
      .min(1)
      .max(255)
      .describe(
        'DNSSEC algorithm number. Supported values: 5 = RSA/SHA-1, 7 = RSASHA1-NSEC3-SHA1, 8 = RSA/SHA-256, 10 = RSA/SHA-512, 12 = ECC-GOST, 13 = ECDSA P-256/SHA-256, 14 = ECDSA P-384/SHA-384, 15 = Ed25519, 16 = Ed448. Use 13 for modern ECDSA keys.',
      ),
    digestType: z
      .number()
      .int()
      .min(1)
      .max(255)
      .describe(
        'Digest algorithm. Supported values: 1 = SHA-1, 2 = SHA-256, 3 = GOST R 34.11-94, 4 = SHA-384. Use 2 for SHA-256.',
      ),
    digest: z.string().describe('Hex-encoded digest of the referenced DNSKEY.'),
    maxSigLife: z
      .number()
      .int()
      .optional()
      .describe(
        'Maximum RRSIG signature lifetime in seconds. Optional; omit to use the registry default.',
      ),
    flags: z
      .number()
      .int()
      .optional()
      .describe(
        'DNSKEY flags. Common values: 256 = Zone Signing Key (ZSK), 257 = Key Signing Key (KSK). Optional; provide alongside publicKey.',
      ),
    protocol: z
      .number()
      .int()
      .optional()
      .describe(
        'DNSKEY protocol. Must be 3 for DNSSEC (RFC 4034). Optional; provide alongside publicKey.',
      ),
    keyDataAlgorithm: z
      .number()
      .int()
      .optional()
      .describe(
        'Algorithm of the accompanying publicKey. Uses the same codes as algorithm (e.g. 13 = ECDSA P-256/SHA-256). Optional; provide alongside publicKey.',
      ),
    publicKey: z
      .string()
      .optional()
      .describe(
        'Base64-encoded public key from the DNSKEY record. Optional; provide alongside flags, protocol, and keyDataAlgorithm.',
      ),
  }),
  output: z.object({
    dsRecord: DsRecordSchema.describe(
      'The created DS record. Includes dsRecordId when returned by the API.',
    ),
  }),
};

// ============================================================================
// updateDsRecord
// ============================================================================

export const updateDsRecordSchema = {
  name: 'updateDsRecord',
  description:
    'Update an existing DNSSEC Delegation Signer (DS) record on a domain.',
  notes:
    'Replaces the full DS record — supply all of keyTag, algorithm, digestType, and digest (read current values with listDsRecords first). Same enum codes and optional DNSKEY fields as createDsRecord.',
  input: z.object({
    domainName: z
      .string()
      .describe('The domain (FQDN) the DS record belongs to.'),
    dsRecordId: z
      .union([z.string(), z.number()])
      .describe('Id of the DS record to update (from listDsRecords).'),
    keyTag: z
      .number()
      .int()
      .min(0)
      .max(65535)
      .describe('Key Tag (0–65535) identifying the referenced DNSKEY.'),
    algorithm: z
      .number()
      .int()
      .min(1)
      .max(255)
      .describe(
        'DNSSEC algorithm number. Supported values: 5 = RSA/SHA-1, 7 = RSASHA1-NSEC3-SHA1, 8 = RSA/SHA-256, 10 = RSA/SHA-512, 12 = ECC-GOST, 13 = ECDSA P-256/SHA-256, 14 = ECDSA P-384/SHA-384, 15 = Ed25519, 16 = Ed448. Use 13 for modern ECDSA keys.',
      ),
    digestType: z
      .number()
      .int()
      .min(1)
      .max(255)
      .describe(
        'Digest algorithm. Supported values: 1 = SHA-1, 2 = SHA-256, 3 = GOST R 34.11-94, 4 = SHA-384. Use 2 for SHA-256.',
      ),
    digest: z.string().describe('Hex-encoded digest of the referenced DNSKEY.'),
    maxSigLife: z
      .number()
      .int()
      .optional()
      .describe(
        'Maximum RRSIG signature lifetime in seconds. Optional; omit to use the registry default.',
      ),
    flags: z
      .number()
      .int()
      .optional()
      .describe(
        'DNSKEY flags. Common values: 256 = Zone Signing Key (ZSK), 257 = Key Signing Key (KSK). Optional; provide alongside publicKey.',
      ),
    protocol: z
      .number()
      .int()
      .optional()
      .describe(
        'DNSKEY protocol. Must be 3 for DNSSEC (RFC 4034). Optional; provide alongside publicKey.',
      ),
    keyDataAlgorithm: z
      .number()
      .int()
      .optional()
      .describe(
        'Algorithm of the accompanying publicKey. Uses the same codes as algorithm (e.g. 13 = ECDSA P-256/SHA-256). Optional; provide alongside publicKey.',
      ),
    publicKey: z
      .string()
      .optional()
      .describe(
        'Base64-encoded public key from the DNSKEY record. Optional; provide alongside flags, protocol, and keyDataAlgorithm.',
      ),
  }),
  output: z.object({
    dsRecord: DsRecordSchema.describe('The updated DS record.'),
  }),
};

// ============================================================================
// deleteDsRecord
// ============================================================================

export const deleteDsRecordSchema = {
  name: 'deleteDsRecord',
  description: 'Delete a DNSSEC Delegation Signer (DS) record from a domain.',
  notes: '',
  input: z.object({
    domainName: z
      .string()
      .describe('The domain (FQDN) the DS record belongs to.'),
    dsRecordId: z
      .union([z.string(), z.number()])
      .describe('Id of the DS record to delete (from listDsRecords).'),
  }),
  output: z.object({
    dsRecordId: z
      .union([z.string(), z.number()])
      .describe('Id of the deleted DS record.'),
    deleted: z.boolean().describe('Always true on success.'),
  }),
};

// ============================================================================
// Registry + inferred output types
// ============================================================================

export const dnssecSchemas = [
  getDnssecSchema,
  enableDnssecSchema,
  disableDnssecSchema,
  listDsRecordsSchema,
  createDsRecordSchema,
  updateDsRecordSchema,
  deleteDsRecordSchema,
];

export type DsRecord = z.infer<typeof DsRecordSchema>;
export type GetDnssecOutput = z.infer<typeof getDnssecSchema.output>;
export type EnableDnssecOutput = z.infer<typeof enableDnssecSchema.output>;
export type DisableDnssecOutput = z.infer<typeof disableDnssecSchema.output>;
export type ListDsRecordsOutput = z.infer<typeof listDsRecordsSchema.output>;
export type CreateDsRecordOutput = z.infer<typeof createDsRecordSchema.output>;
export type UpdateDsRecordOutput = z.infer<typeof updateDsRecordSchema.output>;
export type DeleteDsRecordOutput = z.infer<typeof deleteDsRecordSchema.output>;
