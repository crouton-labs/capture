import { z } from 'zod';

const AuraTokenParam = z.string().describe('Aura token from getContext()');
const AuraContextParam = z.string().describe('Aura context from getContext()');

// ---------------------------------------------------------------------------
// Shared Output Types
// ---------------------------------------------------------------------------

const ListViewColumn = z.object({
  fieldApiName: z
    .string()
    .describe('API name of the field (e.g. "Name", "Email")'),
  label: z.string().describe('Display label of the column'),
  sortable: z.boolean().describe('Whether the column can be sorted'),
});

const ListViewFilterCondition = z.object({
  fieldApiName: z.string().describe('API name of the field being filtered'),
  operator: z
    .string()
    .describe(
      'Filter operator. Common values: "equals", "notEqual", "lessThan", "greaterThan", "lessOrEqual", "greaterOrEqual", "contains", "notContain", "startsWith", "includes", "excludes"',
    ),
  value: z
    .string()
    .nullable()
    .describe('Filter value. Null for operators like "equals null"'),
});

const ListViewOrderBy = z.object({
  fieldApiName: z.string().describe('API name of the field to sort by'),
  isAscending: z
    .boolean()
    .describe('True for ascending order, false for descending'),
});

const ListViewSummary = z.object({
  id: z.string().describe('18-character Salesforce List View ID'),
  apiName: z
    .string()
    .describe('API name of the list view (e.g. "AllAccounts", "MyContacts")'),
  label: z.string().describe('Display label of the list view'),
  listViewApiName: z.string().describe('API name used in URLs and API calls'),
});

const ListViewInfo = z.object({
  id: z.string().describe('18-character Salesforce List View ID'),
  apiName: z.string().describe('API name of the list view'),
  label: z.string().describe('Display label of the list view'),
  objectApiName: z
    .string()
    .describe('API name of the sObject (e.g. "Account", "Contact")'),
  columns: z
    .array(ListViewColumn)
    .describe('Columns displayed in the list view'),
  filteredByInfo: z
    .array(ListViewFilterCondition)
    .describe('Filter conditions applied to the list view'),
  filterLogic: z
    .string()
    .nullable()
    .describe(
      'Custom filter logic expression (e.g. "1 AND 2 OR 3"). Null when using default AND logic.',
    ),
  orderedByInfo: z.array(ListViewOrderBy).describe('Sort order configuration'),
  visibility: z
    .string()
    .describe(
      'Visibility scope: "Public" (all users), "Private" (owner only), or "Group" (specific groups)',
    ),
});

const SObjectRecord = z
  .object({ Id: z.string().describe('Salesforce record ID') })
  .passthrough();

// ---------------------------------------------------------------------------
// listListViews
// ---------------------------------------------------------------------------

export const listListViewsSchema = {
  name: 'listListViews',
  description:
    'List all list views available for a given sObject type (Account, Contact, Lead, Opportunity, etc.)',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    objectApiName: z
      .string()
      .describe(
        'sObject API name (e.g. "Account", "Contact", "Lead", "Opportunity", "Case", "Campaign", "Product2"). PascalCase.',
      ),
    pageSize: z
      .number()
      .optional()
      .describe('Number of list views to return per page (default 50)'),
    pageToken: z
      .string()
      .optional()
      .describe(
        'Page token for pagination (from nextPageToken of a previous response)',
      ),
    recentListsOnly: z
      .boolean()
      .optional()
      .describe(
        'When true, returns only recently used list views. Default false.',
      ),
    query: z
      .string()
      .optional()
      .describe('Search query to filter list views by name'),
  }),
  output: z.object({
    count: z.number().describe('Total number of list views available'),
    listViews: z
      .array(ListViewSummary)
      .describe('Array of list view summaries'),
    nextPageToken: z
      .string()
      .nullable()
      .describe('Token for the next page, null if no more pages'),
    currentPageToken: z
      .string()
      .nullable()
      .describe('Token for the current page'),
  }),
  notes: '',
};

export type ListListViewsInput = z.infer<typeof listListViewsSchema.input>;
export type ListListViewsOutput = z.infer<typeof listListViewsSchema.output>;

// ---------------------------------------------------------------------------
// getListView
// ---------------------------------------------------------------------------

export const getListViewSchema = {
  name: 'getListView',
  description:
    'Get detailed metadata for a specific list view including columns, filters, sort order, and visibility',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    objectApiName: z
      .string()
      .describe(
        'sObject API name (e.g. "Account", "Contact"). Required to identify the list view.',
      ),
    listViewApiName: z
      .string()
      .describe(
        'API name of the list view (e.g. "AllAccounts", "MyContacts", "RecentlyViewed"). Use listListViews() to discover available names.',
      ),
  }),
  output: ListViewInfo,
  notes: '',
};

export type GetListViewInput = z.infer<typeof getListViewSchema.input>;
export type GetListViewOutput = z.infer<typeof getListViewSchema.output>;

// ---------------------------------------------------------------------------
// getListViewRecords
// ---------------------------------------------------------------------------

export const getListViewRecordsSchema = {
  name: 'getListViewRecords',
  description:
    "Get records that match a list view's filters, with support for pagination, sorting, and search within results",
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    objectApiName: z
      .string()
      .describe('sObject API name (e.g. "Account", "Contact")'),
    listViewApiName: z
      .string()
      .describe(
        'API name of the list view (e.g. "AllAccounts", "MyContacts"). Use listListViews() to discover available names.',
      ),
    pageSize: z
      .number()
      .optional()
      .describe('Number of records per page (default 25, max 2000)'),
    pageToken: z
      .string()
      .optional()
      .describe(
        'Page token for pagination (from nextPageToken of a previous response)',
      ),
    sortBy: z
      .array(z.string())
      .optional()
      .describe(
        'Fields to sort by. Prefix with "-" for descending (e.g. ["-CreatedDate", "Name"]).',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe('Search term to filter records within the list view'),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to return (e.g. ["Account.Name", "Account.Phone"]). By default, returns the list view\'s configured columns.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Additional optional fields to include if available. Non-existent fields are silently omitted.',
      ),
    where: z
      .string()
      .optional()
      .describe('Additional SOQL-like WHERE clause to further filter records'),
  }),
  output: z.object({
    count: z.number().describe('Total number of matching records'),
    records: z
      .array(SObjectRecord)
      .describe('Flattened records with field values at top level'),
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
      .describe('Token representing the current page position'),
  }),
  notes:
    'This function uses the same underlying API as listAccounts/listContacts etc. (postListRecordsByName) but accepts any list view name, not just default views. Use listListViews() to discover available list views for the object.',
};

export type GetListViewRecordsInput = z.infer<
  typeof getListViewRecordsSchema.input
>;
export type GetListViewRecordsOutput = z.infer<
  typeof getListViewRecordsSchema.output
>;

// ---------------------------------------------------------------------------
// createListView
// ---------------------------------------------------------------------------

export const createListViewSchema = {
  name: 'createListView',
  description:
    'Create a new custom list view for a given sObject type with specified filters and visibility. Default columns are auto-assigned by Salesforce.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    objectApiName: z
      .string()
      .describe('sObject API name (e.g. "Account", "Contact", "Lead")'),
    label: z.string().describe('Display name for the new list view'),
    listViewApiName: z
      .string()
      .describe(
        'Unique API name for the list view (e.g. "My_Hot_Leads", "Big_Accounts"). Must be alphanumeric with underscores, no spaces. Used in URLs and API calls.',
      ),
    filteredByInfo: z
      .array(
        z.object({
          fieldApiName: z
            .string()
            .describe('API name of the field to filter on'),
          operator: z
            .string()
            .describe(
              'Filter operator: "equals", "notEqual", "lessThan", "greaterThan", "lessOrEqual", "greaterOrEqual", "contains", "notContain", "startsWith", "includes", "excludes"',
            ),
          value: z
            .string()
            .nullable()
            .describe('Value to filter by. Null for "equals null" checks.'),
        }),
      )
      .optional()
      .describe(
        'Filter conditions for the list view. Omit for an unfiltered view.',
      ),
    filterLogic: z
      .string()
      .optional()
      .describe(
        'Custom filter logic expression (e.g. "1 AND (2 OR 3)"). Omit to use default AND logic between all conditions.',
      ),
    orderedByInfo: z
      .array(
        z.object({
          fieldApiName: z.string().describe('API name of the field to sort by'),
          isAscending: z
            .boolean()
            .describe('True for ascending, false for descending'),
        }),
      )
      .optional()
      .describe('Sort order for the list view'),
    visibility: z
      .enum(['Public', 'Private'])
      .optional()
      .describe(
        'Visibility of the list view. "Public" = visible to all users, "Private" = visible only to you. Default: "Private".',
      ),
  }),
  output: ListViewInfo,
  notes:
    'Only custom list views can be created. Standard system list views (like "All Accounts" or "Recently Viewed") cannot be created via API. Columns are auto-assigned by Salesforce based on the object type; use updateListView() after creation to customize columns if needed.',
};

export type CreateListViewInput = z.infer<typeof createListViewSchema.input>;
export type CreateListViewOutput = z.infer<typeof createListViewSchema.output>;

// ---------------------------------------------------------------------------
// updateListView
// ---------------------------------------------------------------------------

export const updateListViewSchema = {
  name: 'updateListView',
  description:
    "Update an existing custom list view's name, filters, sort order, or visibility",
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    objectApiName: z
      .string()
      .describe(
        'sObject API name (e.g. "Account", "Contact"). Must match the object the list view belongs to.',
      ),
    listViewApiName: z
      .string()
      .describe(
        'API name of the list view to update. Get from listListViews() or getListView().',
      ),
    label: z.string().optional().describe('New display name for the list view'),
    filteredByInfo: z
      .array(
        z.object({
          fieldApiName: z
            .string()
            .describe('API name of the field to filter on'),
          operator: z
            .string()
            .describe(
              'Filter operator: "equals", "notEqual", "lessThan", "greaterThan", "lessOrEqual", "greaterOrEqual", "contains", "notContain", "startsWith", "includes", "excludes"',
            ),
          value: z.string().nullable().describe('Value to filter by'),
        }),
      )
      .optional()
      .describe('New filter conditions. Replaces all existing filters.'),
    filterLogic: z
      .string()
      .optional()
      .describe(
        'New custom filter logic expression. Omit to keep existing logic.',
      ),
    orderedByInfo: z
      .array(
        z.object({
          fieldApiName: z.string().describe('API name of the field to sort by'),
          isAscending: z
            .boolean()
            .describe('True for ascending, false for descending'),
        }),
      )
      .optional()
      .describe('New sort order. Replaces existing sort configuration.'),
    visibility: z
      .enum(['Public', 'Private'])
      .optional()
      .describe('New visibility setting'),
  }),
  output: ListViewInfo,
  notes:
    'Only custom list views can be updated. Standard system list views (like "All Accounts" or "Recently Viewed") are read-only. At least one field besides auraToken/auraContext/objectApiName/listViewApiName must be provided.',
};

export type UpdateListViewInput = z.infer<typeof updateListViewSchema.input>;
export type UpdateListViewOutput = z.infer<typeof updateListViewSchema.output>;

// ---------------------------------------------------------------------------
// deleteListView
// ---------------------------------------------------------------------------

export const deleteListViewSchema = {
  name: 'deleteListView',
  description: 'Delete a custom list view by its object and API name',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    objectApiName: z
      .string()
      .describe(
        'sObject API name (e.g. "Account", "Contact"). Must match the object the list view belongs to.',
      ),
    listViewApiName: z
      .string()
      .describe(
        'API name of the list view to delete. Get from listListViews() or getListView().',
      ),
  }),
  output: z.object({
    deleted: z.literal(true),
    objectApiName: z
      .string()
      .describe('sObject API name of the deleted list view'),
    listViewApiName: z.string().describe('API name of the deleted list view'),
  }),
  notes:
    'Only custom list views can be deleted. Standard system list views (like "All Accounts" or "Recently Viewed") cannot be deleted.',
};

export type DeleteListViewInput = z.infer<typeof deleteListViewSchema.input>;
export type DeleteListViewOutput = z.infer<typeof deleteListViewSchema.output>;

// ---------------------------------------------------------------------------
// Export all schemas
// ---------------------------------------------------------------------------

export const listViewSchemas = [
  listListViewsSchema,
  getListViewSchema,
  getListViewRecordsSchema,
  createListViewSchema,
  updateListViewSchema,
  deleteListViewSchema,
];
