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

export const listContractsSchema = {
  name: 'listContracts',
  description:
    'List contracts with page-based pagination and sorting. Uses the SelectableListDataProvider controller.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 25)'),
    page: z
      .number()
      .optional()
      .describe(
        'Page number, 0-indexed (default 0). Page 0 returns the first page, page 1 the second, etc.',
      ),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field name to sort by. Prefix with "-" for descending order (e.g. "-StartDate"). Sortable fields include ContractNumber, Status, StartDate, EndDate, ContractTerm, CreatedDate, LastModifiedDate.',
      ),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type controlling which fields are returned. FULL returns all fields (default). COMPACT returns a minimal set.',
      ),
    filterName: z
      .string()
      .optional()
      .describe(
        'List view API name to filter results (e.g. "Recent"). Defaults to the org\'s default list view for Contract.',
      ),
    enableRowActions: z
      .boolean()
      .optional()
      .describe(
        'When true, each contract record includes a rowActions array listing available actions (e.g. Edit, Delete). Default false.',
      ),
  }),
  output: z.object({
    totalCount: z.number().describe('Total number of contracts'),
    contracts: z.array(SObjectRecord).describe('Array of contract records'),
  }),
  notes:
    'Uses SelectableListDataProviderController/getItems because Contract is not supported by the ListUi API (postListRecordsByName returns 404/403). Page-based pagination with page number and pageSize; no token-based pagination. The fields returned depend on the layoutType and org configuration.',
};

export type ListContractsInput = z.infer<typeof listContractsSchema.input>;
export type ListContractsOutput = z.infer<typeof listContractsSchema.output>;

export const getContractSchema = {
  name: 'getContract',
  description:
    'Get a single contract by ID. Validates that the record is a Contract; rejects non-Contract record IDs with a descriptive error.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    contractId: z
      .string()
      .describe(
        'Salesforce Contract ID (must be a Contract record; passing other sObject IDs like Account or User will throw an error)',
      ),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type for field selection. FULL returns all fields including localized variants (e.g. CreatedDate__l, CreatedDate__f), COMPACT returns key fields only. Default: FULL',
      ),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE'])
      .optional()
      .describe(
        'Record mode. VIEW returns read-only data, EDIT returns data with recordLayout metadata for form rendering, CREATE returns a null template for new record creation. Default: VIEW',
      ),
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Record type ID to filter fields by record type layout (e.g., "012000000000000AAA" for master record type)',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch (e.g. ["Contract.Status", "Contract.StartDate"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format. Errors if a field does not exist.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["Contract.Description", "Contract.SpecialTerms"]). Non-existent fields are silently omitted. When used with fields, uses getRecordWithFields. When used alone, uses getRecordWithLayouts to include layout fields plus the optional extras.',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["ContractLineItems", "AttachedContentDocuments"]). Returns paginated child records with {count, currentPageToken, nextPageToken, records} structure. Requires the fields parameter (optionalFields alone is not sufficient; the API returns "Must provide either of fields or layoutTypes" otherwise).',
      ),
    pageSize: z
      .number()
      .optional()
      .describe(
        'Number of child records to return per child relationship. Default: 5. Only applies when childRelationships is specified.',
      ),
  }),
  output: SObjectRecord,
  notes:
    'The contractId is validated against the returned record type. Passing an Account, Contact, or other non-Contract ID will throw an error like "Record X is a Account, not a Contract." FULL layoutType includes localized suffix fields (__l for locale-formatted, __f for user-formatted) alongside raw values. childRelationships requires the fields parameter; passing only optionalFields with childRelationships will error. pageSize controls child relationship pagination (not the main record).',
};

export type GetContractInput = z.infer<typeof getContractSchema.input>;
export type GetContractOutput = z.infer<typeof getContractSchema.output>;

export const createContractSchema = {
  name: 'createContract',
  description: 'Create a new contract associated with an account',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    accountId: z
      .string()
      .describe('Account ID to associate the contract with (required)'),
    status: z
      .string()
      .optional()
      .describe(
        'Contract status (defaults to "Draft"). Cannot be set to "Activated" on create; activation requires a separate step.',
      ),
    startDate: z
      .string()
      .optional()
      .describe('Contract start date in YYYY-MM-DD format'),
    contractTerm: z
      .number()
      .optional()
      .describe(
        'Number of months for the contract term. EndDate is calculated from StartDate + ContractTerm.',
      ),
    ownerId: z
      .string()
      .optional()
      .describe(
        'Salesforce User ID for the contract owner. Defaults to the current user.',
      ),
    ownerExpirationNotice: z
      .enum(['15', '30', '45', '60', '90', '120'])
      .optional()
      .describe(
        'Number of days before the contract end date that the owner receives a notification',
      ),
    description: z.string().optional().describe('Contract description text'),
    specialTerms: z
      .string()
      .optional()
      .describe('Special terms or conditions for the contract'),
    companySignedId: z
      .string()
      .optional()
      .describe(
        'Salesforce User ID of the person who signed the contract on behalf of the company',
      ),
    companySignedDate: z
      .string()
      .optional()
      .describe(
        'Date the contract was signed by the company representative in YYYY-MM-DD format',
      ),
    customerSignedId: z
      .string()
      .optional()
      .describe(
        'Salesforce Contact ID of the person who signed the contract on behalf of the customer',
      ),
    customerSignedDate: z
      .string()
      .optional()
      .describe('Date the customer signed the contract in YYYY-MM-DD format'),
    customerSignedTitle: z
      .string()
      .optional()
      .describe("Title of the customer's contract signer"),
    pricebook2Id: z
      .string()
      .optional()
      .describe('Salesforce Pricebook ID to associate with the contract'),
    billingStreet: z.string().optional().describe('Billing street address'),
    billingCity: z.string().optional().describe('Billing city'),
    billingState: z.string().optional().describe('Billing state or province'),
    billingPostalCode: z
      .string()
      .optional()
      .describe('Billing postal/ZIP code'),
    billingCountry: z.string().optional().describe('Billing country'),
    billingStateCode: z
      .string()
      .optional()
      .describe(
        'Billing state code (use instead of BillingState when State and Country Picklists are enabled)',
      ),
    billingCountryCode: z
      .string()
      .optional()
      .describe(
        'Billing country code (use instead of BillingCountry when State and Country Picklists are enabled)',
      ),
    shippingStreet: z.string().optional().describe('Shipping street address'),
    shippingCity: z.string().optional().describe('Shipping city'),
    shippingState: z.string().optional().describe('Shipping state or province'),
    shippingPostalCode: z
      .string()
      .optional()
      .describe('Shipping postal/ZIP code'),
    shippingCountry: z.string().optional().describe('Shipping country'),
    shippingStateCode: z
      .string()
      .optional()
      .describe(
        'Shipping state code (use instead of ShippingState when State and Country Picklists are enabled)',
      ),
    shippingCountryCode: z
      .string()
      .optional()
      .describe(
        'Shipping country code (use instead of ShippingCountry when State and Country Picklists are enabled)',
      ),
    fields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Additional contract fields beyond the explicit parameters above (e.g. custom fields). Use Salesforce API field names.',
      ),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe(
        'When true, bypasses Salesforce duplicate rules and saves even if duplicates are detected. Defaults to false.',
      ),
  }),
  output: SaveResult,
  notes: '',
};

export type CreateContractInput = z.infer<typeof createContractSchema.input>;
export type CreateContractOutput = z.infer<typeof createContractSchema.output>;

export const updateContractSchema = {
  name: 'updateContract',
  description: 'Update an existing contract',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    contractId: z.string().describe('Salesforce Contract ID'),
    fields: z
      .record(z.string(), z.unknown())
      .describe('Fields to update (at least one required)'),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe(
        'When true, bypasses Salesforce duplicate rules and saves even if duplicates are detected. Defaults to false.',
      ),
    ifUnmodifiedSince: z
      .string()
      .optional()
      .describe(
        'HTTP date string for optimistic concurrency control (e.g. "Thu, 19 Feb 2026 23:45:32 GMT"). If the record was modified after this timestamp, the update will fail with a conflict error. Use the LastModifiedDate from a previous getContract call.',
      ),
  }),
  output: SaveResult,
  notes:
    'Uses RecordUiController/ACTION$updateRecord. The ifUnmodifiedSince param is passed as clientOptions.ifUnmodifiedSince and provides optimistic locking; the save will fail if another user modified the record after the given timestamp.',
};

export type UpdateContractInput = z.infer<typeof updateContractSchema.input>;
export type UpdateContractOutput = z.infer<typeof updateContractSchema.output>;

export const deleteContractSchema = {
  name: 'deleteContract',
  description: 'Delete a contract by ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    contractId: z.string().describe('Salesforce Contract ID'),
  }),
  output: DeleteResult,
  notes: '',
};

export type DeleteContractInput = z.infer<typeof deleteContractSchema.input>;
export type DeleteContractOutput = z.infer<typeof deleteContractSchema.output>;

export const contractSchemas = [
  listContractsSchema,
  getContractSchema,
  createContractSchema,
  updateContractSchema,
  deleteContractSchema,
];
