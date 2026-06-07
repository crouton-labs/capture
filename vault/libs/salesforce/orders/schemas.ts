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

export const listOrdersSchema = {
  name: 'listOrders',
  description:
    'List orders with pagination, sorting, and searching via the ListUi API',
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
    pageToken: z
      .string()
      .optional()
      .describe(
        'Opaque token for cursor-based pagination. Use nextPageToken/previousPageToken from a previous response.',
      ),
    sortBy: z
      .array(z.string())
      .optional()
      .describe(
        'Array of field paths to sort by, e.g. ["Order.OrderNumber"]. Prefix with "-" for descending, e.g. ["-Order.EffectiveDate"].',
      ),
    listViewApiName: z
      .string()
      .optional()
      .describe(
        'List view API name to filter orders (default "AllOrders"). Standard views: "AllOrders", "AllDraftOrders", "AllActivatedOrders", "__Recent".',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe(
        'Search term to filter records within the list view (minimum 2 characters)',
      ),
  }),
  output: z.object({
    count: z
      .number()
      .describe(
        'Number of records returned on this page (NOT total across all pages). Use nextPageToken to check for more.',
      ),
    orders: z.array(SObjectRecord).describe('Array of order records'),
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

export type ListOrdersInput = z.infer<typeof listOrdersSchema.input>;
export type ListOrdersOutput = z.infer<typeof listOrdersSchema.output>;

export const getOrderSchema = {
  name: 'getOrder',
  description: 'Get a single order by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    orderId: z.string().describe('Salesforce Order ID'),
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
        'Specific fields to fetch (e.g. ["Order.AccountId", "Order.Status"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format. Errors if a field does not exist.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["Order.Description", "Order.Type"]). Non-existent fields are silently omitted. Uses RecordUiController/getRecordWithFields when specified.',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["OrderItems", "OrderDeliveryGroups"]). Returns paginated child records for each relationship. Only works when fields or optionalFields are specified (uses RecordUiController/getRecordWithFields).',
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

export type GetOrderInput = z.infer<typeof getOrderSchema.input>;
export type GetOrderOutput = z.infer<typeof getOrderSchema.output>;

export const createOrderSchema = {
  name: 'createOrder',
  description: 'Create a new order',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    accountId: z
      .string()
      .describe('Account ID to associate the order with (required)'),
    effectiveDate: z
      .string()
      .describe('Order start date in YYYY-MM-DD format (required)'),
    status: z.enum(['Draft', 'Activated']).describe('Order status (required)'),
    type: z
      .string()
      .optional()
      .describe(
        'Order type (org-specific picklist, e.g. custom values defined in Setup)',
      ),
    endDate: z
      .string()
      .optional()
      .describe('Order end date in YYYY-MM-DD format'),
    description: z
      .string()
      .optional()
      .describe('Order description (max 32000 chars)'),
    contractId: z
      .string()
      .optional()
      .describe('Contract ID to associate with this order'),
    pricebook2Id: z
      .string()
      .optional()
      .describe('Price Book ID to associate with this order'),
    ownerId: z
      .string()
      .optional()
      .describe('Owner ID (User or Group). Defaults to current user'),
    customerAuthorizedById: z
      .string()
      .optional()
      .describe('Contact ID of the customer who authorized the order'),
    companyAuthorizedById: z
      .string()
      .optional()
      .describe(
        'User ID of the company representative who authorized the order',
      ),
    billingStreet: z
      .string()
      .optional()
      .describe('Billing street address (max 255 chars)'),
    billingCity: z.string().optional().describe('Billing city (max 40 chars)'),
    billingStateCode: z
      .string()
      .optional()
      .describe(
        'Billing state/province code (use when State and Country Picklists are enabled)',
      ),
    billingPostalCode: z
      .string()
      .optional()
      .describe('Billing zip/postal code (max 20 chars)'),
    billingCountryCode: z
      .string()
      .optional()
      .describe(
        'Billing country code, ISO 3166-1 alpha-2 (e.g. "US", "GB", "DE")',
      ),
    shippingStreet: z
      .string()
      .optional()
      .describe('Shipping street address (max 255 chars)'),
    shippingCity: z
      .string()
      .optional()
      .describe('Shipping city (max 40 chars)'),
    shippingStateCode: z
      .string()
      .optional()
      .describe(
        'Shipping state/province code (use when State and Country Picklists are enabled)',
      ),
    shippingPostalCode: z
      .string()
      .optional()
      .describe('Shipping zip/postal code (max 20 chars)'),
    shippingCountryCode: z
      .string()
      .optional()
      .describe(
        'Shipping country code, ISO 3166-1 alpha-2 (e.g. "US", "GB", "DE")',
      ),
    fields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Additional order fields beyond the named parameters. Known field names: BillingState, BillingCountry, BillingLatitude, BillingLongitude, BillingGeocodeAccuracy, ShippingState, ShippingCountry, ShippingLatitude, ShippingLongitude, ShippingGeocodeAccuracy.',
      ),
  }),
  output: SaveResult,
  notes: '',
};

export type CreateOrderInput = z.infer<typeof createOrderSchema.input>;
export type CreateOrderOutput = z.infer<typeof createOrderSchema.output>;

export const updateOrderSchema = {
  name: 'updateOrder',
  description: 'Update an existing order',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    orderId: z.string().describe('Salesforce Order ID'),
    fields: z
      .record(z.string(), z.unknown())
      .describe(
        'Fields to update, at least one required. Use Salesforce API field names (e.g. AccountId, Status, EffectiveDate, EndDate, Type, Description, OwnerId, ContractId, Pricebook2Id, CustomerAuthorizedById, CompanyAuthorizedById, BillingStreet, BillingCity, BillingStateCode, BillingPostalCode, BillingCountryCode, ShippingStreet, ShippingCity, ShippingStateCode, ShippingPostalCode, ShippingCountryCode)',
      ),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe('Save even if duplicate rules match (default false)'),
    ifUnmodifiedSince: z
      .string()
      .optional()
      .describe(
        'Optimistic concurrency: only update if record unmodified since this HTTP-date (e.g. "Thu, 20 Feb 2026 02:22:35 GMT")',
      ),
  }),
  output: SaveResult,
  notes: '',
};

export type UpdateOrderInput = z.infer<typeof updateOrderSchema.input>;
export type UpdateOrderOutput = z.infer<typeof updateOrderSchema.output>;

export const deleteOrderSchema = {
  name: 'deleteOrder',
  description: 'Delete an order by ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    orderId: z.string().describe('Salesforce Order ID'),
  }),
  output: DeleteResult,
  notes: '',
};

export type DeleteOrderInput = z.infer<typeof deleteOrderSchema.input>;
export type DeleteOrderOutput = z.infer<typeof deleteOrderSchema.output>;

export const orderSchemas = [
  listOrdersSchema,
  getOrderSchema,
  createOrderSchema,
  updateOrderSchema,
  deleteOrderSchema,
];
