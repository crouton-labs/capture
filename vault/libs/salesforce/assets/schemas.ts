import { z } from 'zod';

const AuraTokenParam = z.string().describe('Aura token from getContext()');
const AuraContextParam = z.string().describe('Aura context from getContext()');

const SObjectRecord = z
  .object({ Id: z.string().describe('Salesforce record ID') })
  .passthrough();

const SaveResult = z.object({
  id: z.string().describe('ID of the created/updated record'),
  record: SObjectRecord.describe('Full record as returned by Salesforce'),
});

const DeleteResult = z.object({
  deleted: z.literal(true),
  recordId: z.string().describe('ID of the deleted record'),
});

export const listAssetsSchema = {
  name: 'listAssets',
  description:
    'List customer-owned assets (Service Cloud) with pagination, sorting, searching, and list view filtering via the ListUi API',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 25)'),
    page: z
      .number()
      .optional()
      .describe(
        'Page number, zero-indexed (default 0). Converted to pageToken internally.',
      ),
    listViewApiName: z
      .string()
      .optional()
      .describe(
        'List view API name to filter by (default "AllAssets"). Standard views: "AllAssets", "__Recent".',
      ),
    sortBy: z
      .array(z.string())
      .optional()
      .describe(
        'Array of field paths to sort by, e.g. ["Asset.Name"]. Prefix with "-" for descending, e.g. ["-Asset.Name"]. Multiple fields supported for multi-column sort.',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe(
        'Search term to filter records within the list view (minimum 2 characters).',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Restrict output to specific fields (client-side filter). Use dot notation, e.g. ["Asset.Id", "Asset.Name", "Asset.SerialNumber"]. Id is always included. When omitted, default fields are returned: Name, SerialNumber, InstallDate, Account.Name, Contact.Name, Product2.Name.',
      ),
    pageToken: z
      .string()
      .optional()
      .describe(
        'Opaque token for cursor-based pagination. Use nextPageToken/previousPageToken from a previous response.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Additional fields to return if available, in Object.Field format (e.g. ["Asset.Status", "Asset.Price", "Asset.Quantity"]). Unlike fields, does not error if the field does not exist on the object.',
      ),
    where: z
      .string()
      .optional()
      .describe(
        'Serialized JSON filter for server-side filtering. Supports operators: eq, ne, like (SQL LIKE with %), in, nin, gt, gte, lt, lte. Logical combinators: and, or, not. Examples: \'{"Name":{"like":"Test%"}}\', \'{"Status":{"eq":"Purchased"}}\', \'{"IsCompetitorProduct":{"eq":true}}\', \'{"and":[{"Name":{"like":"A%"}},{"Status":{"ne":null}}]}\'.',
      ),
  }),
  output: z.object({
    count: z
      .number()
      .describe(
        'Number of records returned on this page (NOT total across all pages). Use nextPageToken to check for more.',
      ),
    assets: z.array(SObjectRecord).describe('Array of asset records'),
    nextPageToken: z
      .string()
      .nullable()
      .describe('Token for the next page, null if no more pages'),
    previousPageToken: z
      .string()
      .nullable()
      .describe('Token for the previous page, null if on first page'),
    currentPageToken: z
      .string()
      .nullable()
      .describe('Token for the current page'),
  }),
  notes: '',
};

export type ListAssetsInput = z.infer<typeof listAssetsSchema.input>;
export type ListAssetsOutput = z.infer<typeof listAssetsSchema.output>;

export const getAssetSchema = {
  name: 'getAsset',
  description: 'Get a single asset by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    assetId: z.string().describe('Salesforce Asset ID'),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type for field selection. FULL returns all fields (~35), COMPACT returns key fields (~18). Default: FULL',
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
        'Specific fields to fetch (e.g. ["Asset.Name", "Asset.AccountId"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format. Errors if a field does not exist.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["Asset.SerialNumber", "Asset.Status"]). Non-existent fields are silently omitted. Uses RecordUiController/getRecordWithFields when specified.',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["ChildAssets", "OpenActivities"]). Returns paginated child records for each relationship. Only works when fields or optionalFields are specified (uses RecordUiController/getRecordWithFields). Valid relationship names for Asset include: ActivityHistories, ChildAssets, OpenActivities, Tasks, Events, Notes, Attachments, CombinedAttachments, ContentDocumentLinks, AttachedContentDocuments, AttachedContentNotes',
      ),
  }),
  output: SObjectRecord,
  notes: '',
};

export type GetAssetInput = z.infer<typeof getAssetSchema.input>;
export type GetAssetOutput = z.infer<typeof getAssetSchema.output>;

export const createAssetSchema = {
  name: 'createAsset',
  description:
    'Create a new asset record. At least one of accountId or contactId is required by Salesforce.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    name: z.string().describe('Asset name (required)'),
    accountId: z
      .string()
      .optional()
      .describe('Account ID to associate the asset with'),
    contactId: z
      .string()
      .optional()
      .describe('Contact ID to associate the asset with'),
    product2Id: z
      .string()
      .optional()
      .describe('Product ID (Product2) to associate the asset with'),
    serialNumber: z.string().optional().describe('Serial number of the asset'),
    status: z
      .enum(['Purchased', 'Shipped', 'Installed', 'Registered', 'Obsolete'])
      .optional()
      .describe('Asset lifecycle status'),
    price: z.number().optional().describe('Price of the asset'),
    quantity: z.number().optional().describe('Quantity of the asset'),
    installDate: z
      .string()
      .optional()
      .describe('Installation date (YYYY-MM-DD format)'),
    purchaseDate: z
      .string()
      .optional()
      .describe('Purchase date (YYYY-MM-DD format)'),
    usageEndDate: z
      .string()
      .optional()
      .describe('Usage end date (YYYY-MM-DD format)'),
    isCompetitorProduct: z
      .boolean()
      .optional()
      .describe('Whether this is a competitor product'),
    description: z.string().optional().describe('Description of the asset'),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe('Allow saving even if a duplicate is detected (default false)'),
    fields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Additional asset fields beyond the named parameters'),
  }),
  output: SaveResult,
  notes: '',
};

export type CreateAssetInput = z.infer<typeof createAssetSchema.input>;
export type CreateAssetOutput = z.infer<typeof createAssetSchema.output>;

export const updateAssetSchema = {
  name: 'updateAsset',
  description: 'Update an existing asset',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    assetId: z.string().describe('Salesforce Asset ID'),
    fields: z
      .record(z.string(), z.unknown())
      .describe('Fields to update (at least one required)'),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe('Save even if duplicate rules match (default false)'),
    ifUnmodifiedSince: z
      .string()
      .optional()
      .describe(
        'Optimistic concurrency: only update if record unmodified since this HTTP-date (e.g. "Thu, 20 Feb 2026 20:58:05 GMT")',
      ),
  }),
  output: SaveResult,
  notes: '',
};

export type UpdateAssetInput = z.infer<typeof updateAssetSchema.input>;
export type UpdateAssetOutput = z.infer<typeof updateAssetSchema.output>;

export const deleteAssetSchema = {
  name: 'deleteAsset',
  description: 'Delete an asset by ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    assetId: z.string().describe('Salesforce Asset ID'),
  }),
  output: DeleteResult,
  notes: '',
};

export type DeleteAssetInput = z.infer<typeof deleteAssetSchema.input>;
export type DeleteAssetOutput = z.infer<typeof deleteAssetSchema.output>;

export const assetSchemas = [
  listAssetsSchema,
  getAssetSchema,
  createAssetSchema,
  updateAssetSchema,
  deleteAssetSchema,
];
