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

export const listPricebooksSchema = {
  name: 'listPricebooks',
  description: 'List price books (Pricebook2) with pagination',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 25)'),
    page: z
      .number()
      .optional()
      .describe(
        'Page number, 1-indexed (default 0 which returns the first page same as 1). Page 2 returns the second page, etc.',
      ),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field name to sort by. Prefix with "-" for descending order. Sortable fields include Name, IsActive, Description, ValidFrom, ValidTo, CreatedDate, LastModifiedDate.',
      ),
    layoutType: z
      .enum(['FULL', 'COMPACT', 'SEARCH'])
      .optional()
      .describe(
        'Layout type controlling which fields are returned. FULL returns all fields including IsStandard, IsActive, Description, ValidFrom, ValidTo, CreatedBy, LastModifiedBy (default). COMPACT returns a minimal set (Id, Name, CreatedDate, LastModifiedDate, SystemModstamp). SEARCH returns an intermediate set (Id, Name, Description, IsActive, ValidFrom, ValidTo, LastModifiedDate, SystemModstamp) without related-object expansions.',
      ),
    filterName: z
      .string()
      .optional()
      .describe(
        'List view API name to filter results (e.g. "AllPriceBooks", "Recent"). Defaults to the org\'s default list view for Pricebook2. Available views vary by org configuration.',
      ),
    enableRowActions: z
      .boolean()
      .optional()
      .describe(
        'When true, each pricebook record includes a rowActions object listing available actions (e.g. Edit, Delete). Default false.',
      ),
  }),
  output: z.object({
    totalCount: z.number().describe('Total number of price books'),
    pricebooks: z
      .array(
        z
          .object({
            Id: z.string().describe('Salesforce record ID'),
            rowActions: z
              .array(
                z
                  .object({
                    label: z
                      .string()
                      .describe('Action label (e.g. "Edit", "Delete")'),
                    devNameOrId: z
                      .string()
                      .describe('Action developer name or ID'),
                    url: z.string().describe('Action URL path'),
                    isDisabled: z
                      .boolean()
                      .describe('Whether the action is disabled'),
                    associatedRecordId: z
                      .string()
                      .describe('Record ID this action applies to'),
                    actionTypeEnum: z
                      .string()
                      .describe('Action type (e.g. "StandardButton")'),
                  })
                  .passthrough(),
              )
              .optional()
              .describe(
                'Available row actions (e.g. Edit, Delete) when enableRowActions is true',
              ),
          })
          .passthrough(),
      )
      .describe('Array of Pricebook2 records'),
  }),
  notes: '',
};

export type ListPricebooksInput = z.infer<typeof listPricebooksSchema.input>;
export type ListPricebooksOutput = z.infer<typeof listPricebooksSchema.output>;

export const getPricebookSchema = {
  name: 'getPricebook',
  description: 'Get a single price book by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pricebookId: z.string().describe('Salesforce Pricebook2 ID'),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type for field selection. FULL returns all fields, COMPACT returns key fields. Default: FULL',
      ),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE'])
      .optional()
      .describe(
        'Operation mode controlling which fields are returned in the response. Default: VIEW',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch (e.g. ["Pricebook2.Name", "Pricebook2.IsActive"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format. Errors if a field does not exist.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["Pricebook2.Description", "Pricebook2.ValidFrom"]). Non-existent fields are silently omitted. Uses RecordUiController/getRecordWithFields when specified.',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["PricebookEntries", "BuyerGroupPricebooks", "Histories"]). Returns paginated child records for each relationship. Only works when fields or optionalFields are specified (uses RecordUiController/getRecordWithFields).',
      ),
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Record type ID to filter fields by record type layout (e.g. "012000000000000AAA" for master record type)',
      ),
  }),
  output: SObjectRecord,
  notes: '',
};

export type GetPricebookInput = z.infer<typeof getPricebookSchema.input>;
export type GetPricebookOutput = z.infer<typeof getPricebookSchema.output>;

export const listPricebookEntriesSchema = {
  name: 'listPricebookEntries',
  description:
    'List price book entries (PricebookEntry: product-pricebook-price associations) with pagination',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 25)'),
    page: z
      .number()
      .optional()
      .describe(
        'Page number, 1-indexed (default 0 which returns the first page same as 1). Page 2 returns the second page, etc.',
      ),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field name to sort by. Prefix with "-" for descending order. Sortable fields include Name, UnitPrice, CreatedDate, LastModifiedDate, IsActive, Pricebook2Id, Product2Id.',
      ),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type controlling which fields are returned. FULL returns all fields (default), COMPACT returns a minimal set (Id, Name, CreatedDate, LastModifiedDate).',
      ),
    filterName: z
      .string()
      .optional()
      .describe(
        'List view API name to filter results (e.g. "__Recent"). Available views vary by org configuration.',
      ),
  }),
  output: z.object({
    totalCount: z.number().describe('Total number of price book entries'),
    entries: z
      .array(SObjectRecord)
      .describe(
        'Array of PricebookEntry records with Pricebook2Id, Product2Id, UnitPrice, IsActive',
      ),
  }),
  notes: '',
};

export type ListPricebookEntriesInput = z.infer<
  typeof listPricebookEntriesSchema.input
>;
export type ListPricebookEntriesOutput = z.infer<
  typeof listPricebookEntriesSchema.output
>;

export const createPricebookEntrySchema = {
  name: 'createPricebookEntry',
  description:
    'Create a new price book entry linking a product to a price book at a given unit price',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pricebookId: z
      .string()
      .describe('Pricebook2 ID to associate the product with'),
    productId: z.string().describe('Product2 ID of the product to price'),
    unitPrice: z
      .number()
      .describe('Unit price for the product in this price book'),
    isActive: z
      .boolean()
      .optional()
      .describe('Whether the entry is active (default true)'),
    useStandardPrice: z
      .boolean()
      .optional()
      .describe(
        'Whether to use the standard price from the standard price book instead of a custom unit price (default false)',
      ),
    currencyIsoCode: z
      .string()
      .optional()
      .describe(
        'ISO 4217 currency code (e.g. USD, EUR). Only available in multi-currency orgs. Part of the uniqueness constraint: one entry per Pricebook2Id + Product2Id + CurrencyIsoCode. Defaults to the org default currency.',
      ),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe(
        'Allow saving even if a duplicate detection rule fires (default false)',
      ),
  }),
  output: SaveResult,
  notes:
    'A product must have a standard price book entry before it can be added to a custom price book. Create the standard price book entry first, then add to other price books. Each pricebook+product combination must be unique (per currency in multi-currency orgs).',
};

export type CreatePricebookEntryInput = z.infer<
  typeof createPricebookEntrySchema.input
>;
export type CreatePricebookEntryOutput = z.infer<
  typeof createPricebookEntrySchema.output
>;

export const pricebookSchemas = [
  listPricebooksSchema,
  getPricebookSchema,
  listPricebookEntriesSchema,
  createPricebookEntrySchema,
];
