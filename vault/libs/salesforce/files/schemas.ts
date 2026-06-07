import { z } from 'zod';

const AuraTokenParam = z.string().describe('Aura token from getContext()');
const AuraContextParam = z.string().describe('Aura context from getContext()');

const SObjectRecord = z
  .object({ Id: z.string().describe('Salesforce record ID') })
  .passthrough();

const DeleteResult = z.object({
  deleted: z.literal(true),
  recordId: z.string().describe('ID of the deleted record'),
});

const RowActionOutput = z.object({
  name: z.string().describe('Action developer name (e.g. "DeleteFile")'),
  label: z.string().describe('Display label (e.g. "Delete")'),
  recordId: z.string().describe('ID of the associated record'),
  actionType: z.string().describe('Action type (e.g. "StandardButton")'),
});

const ContentDocumentFull = z
  .object({
    Id: z.string().describe('Salesforce ContentDocument ID'),
    Title: z.string().describe('File or note title'),
    Description: z
      .string()
      .nullable()
      .optional()
      .describe('File description (FULL layout only)'),
    CreatedDate: z.string().describe('ISO 8601 creation timestamp'),
    CreatedDate__f: z
      .string()
      .optional()
      .describe('Formatted creation date (FULL layout only)'),
    LastModifiedDate: z.string().describe('ISO 8601 last modified timestamp'),
    LastModifiedDate__f: z
      .string()
      .optional()
      .describe('Formatted last modified date (FULL layout only)'),
    LastModifiedById: z.string().describe('User ID of last modifier'),
    SystemModstamp: z.string().describe('System modification timestamp'),
    sobjectType: z.literal('ContentDocument'),
    Owner: z
      .object({
        Id: z.string(),
        Name: z.string(),
        sobjectType: z.literal('User'),
      })
      .optional()
      .describe('Owner user object (COMPACT layout only)'),
    OwnerId: z
      .string()
      .optional()
      .describe('Owner user ID (COMPACT layout only)'),
    ContentSizeLong: z
      .number()
      .optional()
      .describe('File size in bytes (COMPACT layout only)'),
    FileExtension: z
      .string()
      .optional()
      .describe('File extension (COMPACT layout only)'),
    actions: z
      .array(RowActionOutput)
      .optional()
      .describe('Row actions when enableRowActions=true'),
  })
  .passthrough();

export const listFilesSchema = {
  name: 'listFiles',
  description: 'List files (ContentDocument records) with pagination',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 25)'),
    page: z
      .number()
      .optional()
      .describe('Page number, 1-indexed (default 1). First page is 1.'),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field API name to sort results by (e.g. "Title", "LastModifiedDate", "CreatedDate", "Owner.Name"). Prefix with "-" for descending order (e.g. "-Title", "-LastModifiedDate").',
      ),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type controlling which fields are returned. FULL returns Title, Description, CreatedDate, LastModifiedDate, etc. COMPACT adds Owner, OwnerId, ContentSizeLong, FileExtension but omits Description and formatted date fields. Defaults to FULL.',
      ),
    filterName: z
      .string()
      .optional()
      .describe(
        'List view ID to filter results (e.g. a Salesforce list view ID like "00Bal00000P1q6yEAB"). Controls which predefined filter is applied.',
      ),
    enableRowActions: z
      .boolean()
      .optional()
      .describe(
        'When true, includes available row actions (e.g. Delete) with each record in the actions array. Defaults to false.',
      ),
  }),
  output: z.object({
    totalCount: z.number().describe('Total number of files'),
    files: z
      .array(ContentDocumentFull)
      .describe(
        'Array of ContentDocument records. FULL layout: Id, Title, Description, CreatedDate, CreatedDate__f, LastModifiedDate, LastModifiedDate__f, LastModifiedById, SystemModstamp, sobjectType. COMPACT layout: Id, Title, Owner (nested object with Id, Name, sobjectType), OwnerId, ContentSizeLong, FileExtension, CreatedDate, LastModifiedDate, LastModifiedById, SystemModstamp, sobjectType.',
      ),
  }),
  notes:
    'Uses SelectableListDataProviderController/getItems. sortBy supports field names like Title, LastModifiedDate, CreatedDate, Owner.Name; prefix with "-" for descending.',
};

export type ListFilesInput = z.infer<typeof listFilesSchema.input>;
export type ListFilesOutput = z.infer<typeof listFilesSchema.output>;

export const getFileSchema = {
  name: 'getFile',
  description: 'Get a single file (ContentDocument) by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    fileId: z.string().describe('Salesforce ContentDocument ID'),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type controlling which fields are returned. FULL returns all fields, COMPACT returns a focused subset. Defaults to FULL.',
      ),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE'])
      .optional()
      .describe(
        'Record mode context. VIEW returns standard read fields, EDIT returns editable fields, CREATE returns fields for new record template. Defaults to VIEW.',
      ),
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Record type ID to control which page layout is used (e.g. "012000000000000AAA" for master record type). Determines which layout fields are returned for orgs with multiple record types.',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch (e.g. ["ContentNote.Title", "ContentNote.CreatedDate"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format where ObjectName matches the actual sObject type (ContentNote for notes, ContentDocument for files). Errors if a field does not exist.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["ContentNote.Content", "ContentNote.LastModifiedDate"]). Non-existent fields are silently omitted. Uses RecordUiController/getRecordWithFields when specified.',
      ),
  }),
  output: SObjectRecord,
  notes: '',
};

export type GetFileInput = z.infer<typeof getFileSchema.input>;
export type GetFileOutput = z.infer<typeof getFileSchema.output>;

export const deleteFileSchema = {
  name: 'deleteFile',
  description: 'Delete a file (ContentDocument) by ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    fileId: z.string().describe('Salesforce ContentDocument ID'),
  }),
  output: DeleteResult,
  notes: '',
};

export type DeleteFileInput = z.infer<typeof deleteFileSchema.input>;
export type DeleteFileOutput = z.infer<typeof deleteFileSchema.output>;

export const fileSchemas = [listFilesSchema, getFileSchema, deleteFileSchema];
