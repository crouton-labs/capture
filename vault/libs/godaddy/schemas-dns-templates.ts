import { z } from 'zod';

// ============================================================================
// Shared entity shapes
// ============================================================================

const RECORD_TYPES = [
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
] as const;

const RECORD_TYPE_NOTE =
  'Record types: A, AAAA, CNAME, MX, NS, SOA, SRV, TXT, CAA, HTTPS, TLSA, SVCB. SRV requires priority, weight, port, service (e.g. "_sip"), and protocol (e.g. "_tcp"). CAA uses flags and tag.';

const recordFieldShape = {
  type: z.enum(RECORD_TYPES).describe('DNS record type.'),
  name: z
    .string()
    .describe(
      'Host/subdomain within the zone, e.g. "@" for the root, "www", or "_dmarc".',
    ),
  data: z
    .string()
    .describe(
      'Record value: IPv4 for A, IPv6 for AAAA, target hostname for CNAME/MX/NS, or text for TXT.',
    ),
  ttl: z
    .number()
    .optional()
    .describe('Time-to-live in seconds. Omit to use the template default.'),
  priority: z
    .number()
    .optional()
    .describe('Priority for MX and SRV records. Omitting defaults to 0.'),
  weight: z.number().optional().describe('Weight. Used by SRV records.'),
  port: z.number().optional().describe('Port. Used by SRV records.'),
  service: z
    .string()
    .optional()
    .describe('Service label, e.g. "_sip". Required for SRV records.'),
  protocol: z
    .string()
    .optional()
    .describe('Protocol label, e.g. "_tcp". Required for SRV records.'),
  flags: z.number().optional().describe('Flags. Used by CAA records.'),
  tag: z
    .enum(['issue', 'issuewild', 'iodef'])
    .optional()
    .describe(
      'Tag for CAA records. "issue" authorizes a CA to issue certificates, "issuewild" for wildcard certificates, "iodef" for violation reports.',
    ),
};

export const DnsTemplateRecordInputSchema = z
  .object(recordFieldShape)
  .passthrough()
  .describe(
    'A DNS record to store in a template. Do not set recordId on create; the server assigns it.',
  );

export const DnsTemplateRecordSchema = z
  .object({
    guid: z
      .string()
      .optional()
      .describe(
        'Server-assigned record identifier. Pass this as recordId when calling updateTemplateRecord or deleteTemplateRecord.',
      ),
    ...recordFieldShape,
    type: z
      .enum(RECORD_TYPES)
      .optional()
      .describe(
        'DNS record type. Not present in GET responses — the API uses `rtype` in returned records.',
      ),
    flags: z
      .union([z.string(), z.number()])
      .optional()
      .describe(
        'Flags. Used by CAA records. The API returns this as a string (e.g. "0").',
      ),
    rtype: z
      .string()
      .optional()
      .describe(
        'Record type as returned by the API GET responses (e.g. "A", "CNAME"). Same role as `type` in inputs.',
      ),
    matching_type: z
      .number()
      .optional()
      .describe(
        'Matching type for TLSA/HTTPS records. 0 for most record types.',
      ),
    selector: z
      .number()
      .optional()
      .describe('Selector for TLSA/HTTPS records. 0 for most record types.'),
    status: z
      .string()
      .optional()
      .describe(
        'Record status as returned by the API. Common value: "active".',
      ),
    usage: z
      .number()
      .optional()
      .describe('Usage field for TLSA/HTTPS records. 0 for most record types.'),
  })
  .passthrough()
  .describe('A DNS record stored in a template.');

export const DnsTemplateSummarySchema = z
  .object({
    templateId: z
      .union([z.string(), z.number()])
      .optional()
      .describe(
        'Server-assigned template id. Use with getDnsTemplate, updateDnsTemplate, deleteDnsTemplate, applyDnsTemplate, and the template-record functions.',
      ),
    templateName: z
      .string()
      .optional()
      .describe('Template display name as returned by the API.'),
    source: z
      .string()
      .optional()
      .describe('Template source, e.g. "customer" for user-created templates.'),
    type: z.string().optional().describe('Template type, e.g. "designed".'),
    transferIn: z
      .boolean()
      .optional()
      .describe(
        'Whether the template was created during a domain transfer-in.',
      ),
    records: z
      .null()
      .optional()
      .describe(
        'Always null in list responses. Use getDnsTemplate to retrieve the template records.',
      ),
  })
  .passthrough()
  .describe(
    'A saved DNS record template — a reusable set of DNS records that can be applied to a domain.',
  );

// ============================================================================
// listDnsTemplates
// ============================================================================

export const listDnsTemplatesSchema = {
  name: 'listDnsTemplates',
  description:
    "List the account's saved DNS record templates (reusable sets of DNS records).",
  notes: '',
  input: z.object({}),
  output: z.object({
    templates: z
      .array(DnsTemplateSummarySchema)
      .describe('Saved DNS templates. Empty when the account has none.'),
    total: z.number().describe('Number of templates returned.'),
  }),
};

// ============================================================================
// getDnsTemplate
// ============================================================================

export const getDnsTemplateSchema = {
  name: 'getDnsTemplate',
  description: 'Get one DNS template along with all of its DNS records.',
  notes: `All of the template's records are returned; pass count to cap how many. ${RECORD_TYPE_NOTE}`,
  input: z.object({
    templateId: z
      .union([z.string(), z.number()])
      .describe(
        'Id of the template (from listDnsTemplates). May be a number or string.',
      ),
    count: z
      .number()
      .optional()
      .describe('Max records to return. Omit to return all records.'),
  }),
  output: z.object({
    template: DnsTemplateSummarySchema.describe('The template metadata.'),
    records: z
      .array(DnsTemplateRecordSchema)
      .describe(
        "The template's DNS records. Empty when the template has none.",
      ),
    total: z.number().describe('Number of records returned.'),
  }),
};

// ============================================================================
// createDnsTemplate
// ============================================================================

export const createDnsTemplateSchema = {
  name: 'createDnsTemplate',
  description: 'Create a new DNS record template.',
  notes: RECORD_TYPE_NOTE,
  input: z.object({
    name: z.string().describe('Name for the new template.'),
    description: z
      .string()
      .optional()
      .describe('Optional human-readable description.'),
    records: z
      .array(DnsTemplateRecordInputSchema)
      .optional()
      .describe(
        'DNS records to add to the template. Records are added individually after creation. Can also be added later with addTemplateRecord.',
      ),
  }),
  output: z.object({
    template: z
      .object({
        templateId: z
          .union([z.string(), z.number()])
          .optional()
          .describe(
            'Server-assigned template id. Use with getDnsTemplate, updateDnsTemplate, deleteDnsTemplate, applyDnsTemplate, and the template-record functions.',
          ),
        templateName: z
          .string()
          .optional()
          .describe('Template name as passed on creation.'),
        name: z
          .string()
          .optional()
          .describe('Template name (alias for templateName).'),
        recordCount: z
          .number()
          .optional()
          .describe('Number of records added during creation.'),
      })
      .describe(
        'The created template. Only templateId, templateName, and recordCount are populated; use getDnsTemplate to read the full detail.',
      ),
  }),
};

// ============================================================================
// updateDnsTemplate
// ============================================================================

export const updateDnsTemplateSchema = {
  name: 'updateDnsTemplate',
  description: "Update a DNS template's name or replace its full record set.",
  notes: `Provide at least one field to change. When records is supplied it replaces all existing records on the template. ${RECORD_TYPE_NOTE}`,
  input: z.object({
    templateId: z
      .union([z.string(), z.number()])
      .describe('Id of the template to update (from listDnsTemplates).'),
    name: z.string().optional().describe('New template name.'),
    records: z
      .array(DnsTemplateRecordInputSchema)
      .optional()
      .describe(
        'Replacement record set. All existing records are deleted and replaced with these. Omit to leave records unchanged.',
      ),
  }),
  output: z.object({
    template: z
      .object({
        templateId: z
          .string()
          .describe('Template id (string form of the numeric id).'),
        id: z
          .number()
          .optional()
          .describe('Numeric template id as returned by the API.'),
        name: z.string().optional().describe('Template name after the update.'),
      })
      .describe('The updated template.'),
  }),
};

// ============================================================================
// deleteDnsTemplate
// ============================================================================

export const deleteDnsTemplateSchema = {
  name: 'deleteDnsTemplate',
  description: 'Delete a DNS template.',
  notes: '',
  input: z.object({
    templateId: z
      .union([z.string(), z.number()])
      .describe('Id of the template to delete (from listDnsTemplates).'),
  }),
  output: z.object({
    deleted: z.boolean().describe('True when the template was deleted.'),
    templateId: z
      .union([z.string(), z.number()])
      .describe('Id of the deleted template.'),
  }),
};

// ============================================================================
// applyDnsTemplate
// ============================================================================

export const applyDnsTemplateSchema = {
  name: 'applyDnsTemplate',
  description: "Apply a DNS template's records to a domain's DNS zone.",
  notes:
    "Writes the template's records into the domain's live DNS zone, which can change where the site and email route — review the template's records first. The domain must use GoDaddy DNS hosting and be owned by this account; applying to a non-owned domain returns a 422 error. By default replaces all non-system DNS records; set append: true to add template records without deleting existing ones.",
  input: z.object({
    templateId: z
      .union([z.string(), z.number()])
      .describe(
        'Id of the template to apply (from listDnsTemplates). May be a number or string.',
      ),
    domainName: z
      .string()
      .describe('Domain whose DNS zone the template should be applied to.'),
    domainNames: z
      .array(z.string())
      .optional()
      .describe(
        'Additional domains to apply the template to in the same call. Combined with domainName.',
      ),
    append: z
      .boolean()
      .optional()
      .describe(
        'When true, template records are added to the existing DNS zone without deleting current records. When false or omitted, all non-system records are deleted and replaced with the template records.',
      ),
  }),
  output: z.object({
    applied: z.boolean().describe('True when the template was applied.'),
    templateId: z
      .union([z.string(), z.number()])
      .describe('Id of the applied template.'),
    domainName: z.string().describe('Domain the template was applied to.'),
    domainNames: z
      .array(z.string())
      .optional()
      .describe('All domains the template was applied to.'),
  }),
};

// ============================================================================
// addTemplateRecord
// ============================================================================

export const addTemplateRecordSchema = {
  name: 'addTemplateRecord',
  description: 'Add a single DNS record to a template.',
  notes: RECORD_TYPE_NOTE,
  input: z.object({
    templateId: z
      .union([z.string(), z.number()])
      .describe(
        'Id of the template (from listDnsTemplates). May be a number or string.',
      ),
    record: DnsTemplateRecordInputSchema.describe('The DNS record to add.'),
  }),
  output: z.object({
    record: DnsTemplateRecordSchema.describe(
      'The added record with its server-assigned guid. Use guid as the recordId when calling updateTemplateRecord or deleteTemplateRecord.',
    ),
  }),
};

// ============================================================================
// updateTemplateRecord
// ============================================================================

export const updateTemplateRecordSchema = {
  name: 'updateTemplateRecord',
  description: 'Update a single DNS record in a template.',
  notes: `recordId comes from getDnsTemplate. ${RECORD_TYPE_NOTE}`,
  input: z.object({
    templateId: z
      .union([z.string(), z.number()])
      .describe(
        'Id of the template (from listDnsTemplates). May be a number or string.',
      ),
    recordId: z
      .string()
      .describe('Id of the record to update (from getDnsTemplate).'),
    record: DnsTemplateRecordInputSchema.describe('The new record values.'),
  }),
  output: z.object({
    record: DnsTemplateRecordSchema.describe('The updated record.'),
  }),
};

// ============================================================================
// deleteTemplateRecord
// ============================================================================

export const deleteTemplateRecordSchema = {
  name: 'deleteTemplateRecord',
  description: 'Delete a single DNS record from a template.',
  notes: 'recordId comes from getDnsTemplate.',
  input: z.object({
    templateId: z
      .union([z.string(), z.number()])
      .describe(
        'Id of the template (from listDnsTemplates). May be a number or string.',
      ),
    recordId: z
      .string()
      .describe('Id of the record to delete (from getDnsTemplate).'),
  }),
  output: z.object({
    deleted: z.boolean().describe('True when the record was deleted.'),
    templateId: z
      .union([z.string(), z.number()])
      .describe('Id of the template the record belonged to.'),
    recordId: z.string().describe('Id of the deleted record.'),
  }),
};

// ============================================================================
// Registry + types
// ============================================================================

export const dnsTemplatesSchemas = [
  listDnsTemplatesSchema,
  getDnsTemplateSchema,
  createDnsTemplateSchema,
  updateDnsTemplateSchema,
  deleteDnsTemplateSchema,
  applyDnsTemplateSchema,
  addTemplateRecordSchema,
  updateTemplateRecordSchema,
  deleteTemplateRecordSchema,
];

export type DnsTemplateSummary = z.infer<typeof DnsTemplateSummarySchema>;
export type DnsTemplateRecord = z.infer<typeof DnsTemplateRecordSchema>;
export type DnsTemplateRecordInput = z.infer<
  typeof DnsTemplateRecordInputSchema
>;

export type ListDnsTemplatesOutput = z.infer<
  typeof listDnsTemplatesSchema.output
>;
export type GetDnsTemplateOutput = z.infer<typeof getDnsTemplateSchema.output>;
export type CreateDnsTemplateOutput = z.infer<
  typeof createDnsTemplateSchema.output
>;
export type UpdateDnsTemplateOutput = z.infer<
  typeof updateDnsTemplateSchema.output
>;
export type DeleteDnsTemplateOutput = z.infer<
  typeof deleteDnsTemplateSchema.output
>;
export type ApplyDnsTemplateOutput = z.infer<
  typeof applyDnsTemplateSchema.output
>;
export type AddTemplateRecordOutput = z.infer<
  typeof addTemplateRecordSchema.output
>;
export type UpdateTemplateRecordOutput = z.infer<
  typeof updateTemplateRecordSchema.output
>;
export type DeleteTemplateRecordOutput = z.infer<
  typeof deleteTemplateRecordSchema.output
>;
