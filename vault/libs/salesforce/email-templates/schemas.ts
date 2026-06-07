import { z } from 'zod';

const AuraTokenParam = z.string().describe('Aura token from getContext()');
const AuraContextParam = z.string().describe('Aura context from getContext()');

const SObjectRecord = z
  .object({ Id: z.string().describe('Salesforce record ID') })
  .passthrough();

export const listEmailTemplatesSchema = {
  name: 'listEmailTemplates',
  description: 'List email templates with pagination',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 25)'),
    page: z.number().optional().describe('Page number, 1-indexed (default 1)'),
    scope: z
      .enum(['everything', 'mru'])
      .optional()
      .describe(
        'Query scope. "everything" returns all templates across all folders, "mru" returns most recently used. Default: everything',
      ),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field API name to sort results by (e.g. "Name", "LastModifiedDate", "CreatedDate"). Passed as orderBy to the FolderHome API.',
      ),
  }),
  output: z.object({
    totalCount: z.number().describe('Total number of email templates'),
    emailTemplates: z
      .array(SObjectRecord)
      .describe(
        'Array of EmailTemplate records with Id, Name, Subject, Description, HtmlValue, FolderId, FolderName, RelatedEntityType, TimesUsed, LastUsedDate, OwnerId, CreatedById, CreatedDate, LastModifiedById, LastModifiedDate, sobjectType, and nested CreatedBy/LastModifiedBy/Owner objects with Id, Name, and sobjectType.',
      ),
  }),
  notes:
    'Uses FolderHomeController/getRecords. Pagination is 1-indexed (first page is 1). Records include nested Owner, CreatedBy, and LastModifiedBy objects with Id, Name, and sobjectType fields. The scope param controls which templates are shown: "everything" for all templates, "mru" for recently used. Out-of-range pages return totalCount: 0 and an empty emailTemplates array.',
};

export type ListEmailTemplatesInput = z.infer<
  typeof listEmailTemplatesSchema.input
>;
export type ListEmailTemplatesOutput = z.infer<
  typeof listEmailTemplatesSchema.output
>;

export const getEmailTemplateSchema = {
  name: 'getEmailTemplate',
  description: 'Get a single email template by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    templateId: z.string().describe('Salesforce EmailTemplate ID'),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type for field selection. FULL returns all fields (~22), COMPACT returns key fields (~13). Default: FULL',
      ),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE'])
      .optional()
      .describe(
        'Record mode. VIEW returns read-only data, EDIT returns data with recordLayout metadata for form rendering, CREATE returns a template for new record creation. Default: VIEW',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch (e.g. ["EmailTemplate.Name", "EmailTemplate.Subject"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["EmailTemplate.Description", "EmailTemplate.TemplateType"]). Non-existent fields are silently omitted. Uses RecordUiController/getRecordWithFields when specified',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["ContentDocumentLinks"]). Returns paginated child records for each relationship. Only works when fields or optionalFields are specified (uses RecordUiController/getRecordWithFields)',
      ),
  }),
  output: SObjectRecord,
  notes: '',
};

export type GetEmailTemplateInput = z.infer<
  typeof getEmailTemplateSchema.input
>;
export type GetEmailTemplateOutput = z.infer<
  typeof getEmailTemplateSchema.output
>;

export const emailTemplateSchemas = [
  listEmailTemplatesSchema,
  getEmailTemplateSchema,
];
