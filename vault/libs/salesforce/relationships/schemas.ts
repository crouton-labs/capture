import { z } from 'zod';

// ============================================================================
// Common Parameters
// ============================================================================

const AuraTokenParam = z.string().describe('Aura token from getContext()');
const AuraContextParam = z.string().describe('Aura context from getContext()');

const SObjectRecord = z
  .object({
    Id: z.string().describe('Salesforce record ID'),
  })
  .passthrough();

// ============================================================================
// getRelatedRecords
// ============================================================================

export const getRelatedRecordsSchema = {
  name: 'getRelatedRecords',
  description:
    'Get actual related records for a parent record (e.g., all Contacts for an Account, all Cases for a Contact). Use getRelatedLists first to discover available relatedListId values for an object type.',
  notes:
    'Call getRelatedLists with the parent object type to discover valid relatedListId values. Common relatedListIds: "Contacts" (Account->Contact), "Opportunities" (Account->Opportunity), "Cases" (Account/Contact->Case), "ChildAccounts" (Account->Account), "OpportunityContactRoles" (Opportunity->Contact roles). Field names must be prefixed with object name (e.g., "Contact.Name", "Contact.Email").',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    parentRecordId: z
      .string()
      .describe('ID of the parent record (e.g., an Account ID)'),
    relatedListId: z
      .string()
      .describe(
        'Related list identifier from getRelatedLists (e.g., "Contacts", "Opportunities", "Cases", "ChildAccounts")',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Fields to fetch, prefixed with object name (e.g., ["Contact.Name", "Contact.Email"]). If omitted, returns default fields.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g., ["Contact.Phone"]). Non-existent fields are silently omitted.',
      ),
    pageSize: z
      .number()
      .optional()
      .describe('Number of records per page. Default: 50, max: 2000'),
    pageToken: z
      .string()
      .optional()
      .describe(
        'Token for pagination; pass nextPageToken from a previous response to get the next page',
      ),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field API name to sort by (e.g., "Contact.Name"). Prefix with "-" for descending.',
      ),
  }),
  output: z.object({
    count: z.number().describe('Total number of related records'),
    records: z
      .array(SObjectRecord)
      .describe(
        'Related records with flattened fields. Common properties depend on the related object type (e.g., Contact: Name, Email, Phone; Opportunity: Name, StageName, Amount).',
      ),
    nextPageToken: z
      .string()
      .nullable()
      .describe('Token for next page, null if no more pages'),
    previousPageToken: z
      .string()
      .nullable()
      .describe('Token for previous page, null if on first page'),
    currentPageToken: z
      .string()
      .nullable()
      .describe('Token for the current page'),
  }),
};

export type GetRelatedRecordsInput = z.infer<
  typeof getRelatedRecordsSchema.input
>;
export type GetRelatedRecordsOutput = z.infer<
  typeof getRelatedRecordsSchema.output
>;

// ============================================================================
// createRelationship
// ============================================================================

export const createRelationshipSchema = {
  name: 'createRelationship',
  description:
    'Link two records by setting a lookup/relationship field on a record (e.g., associate a Contact with an Account by setting AccountId)',
  notes:
    'This updates a lookup field on the source record. Use listRelationshipTypes to discover valid relationship fields. Common examples: set Contact.AccountId to link a Contact to an Account, set Opportunity.AccountId to link an Opportunity to an Account, set Case.ContactId to link a Case to a Contact.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    recordId: z
      .string()
      .describe(
        'ID of the record to update (the record that has the lookup field)',
      ),
    relationshipField: z
      .string()
      .describe(
        'API name of the lookup field to set (e.g., "AccountId", "ContactId", "ParentId"). Use listRelationshipTypes to discover valid fields.',
      ),
    relatedRecordId: z
      .string()
      .describe(
        'ID of the record to link to (the target record that the lookup field will point to)',
      ),
  }),
  output: z.object({
    id: z.string().describe('ID of the updated record'),
    record: SObjectRecord.describe(
      'Updated record with the new relationship field value',
    ),
  }),
};

export type CreateRelationshipInput = z.infer<
  typeof createRelationshipSchema.input
>;
export type CreateRelationshipOutput = z.infer<
  typeof createRelationshipSchema.output
>;

// ============================================================================
// removeRelationship
// ============================================================================

export const removeRelationshipSchema = {
  name: 'removeRelationship',
  description:
    'Unlink two records by clearing a lookup/relationship field on a record (e.g., remove a Contact from an Account by clearing AccountId)',
  notes:
    'This sets a lookup field to null. Only works on non-required lookup fields. Master-detail fields and required lookups cannot be cleared. Use listRelationshipTypes to check if the field is updateable.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    recordId: z
      .string()
      .describe(
        'ID of the record to update (the record that has the lookup field)',
      ),
    relationshipField: z
      .string()
      .describe(
        'API name of the lookup field to clear (e.g., "AccountId", "ContactId", "ParentId")',
      ),
  }),
  output: z.object({
    id: z.string().describe('ID of the updated record'),
    record: SObjectRecord.describe(
      'Updated record with the relationship field cleared',
    ),
  }),
};

export type RemoveRelationshipInput = z.infer<
  typeof removeRelationshipSchema.input
>;
export type RemoveRelationshipOutput = z.infer<
  typeof removeRelationshipSchema.output
>;

// ============================================================================
// listRelationshipTypes
// ============================================================================

export const listRelationshipTypesSchema = {
  name: 'listRelationshipTypes',
  description:
    'List all relationship types (lookup and child relationships) for a Salesforce object type. Returns lookup fields (parent relationships) and child relationships.',
  notes: '',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    objectApiName: z
      .string()
      .describe(
        'API name of the object (e.g., "Account", "Contact", "Opportunity", "Lead", "Case", "Campaign", or custom objects like "MyObject__c")',
      ),
  }),
  output: z.object({
    objectApiName: z.string().describe('The object API name queried'),
    objectLabel: z.string().describe('Human-readable object label'),
    lookupFields: z
      .array(
        z.object({
          fieldApiName: z
            .string()
            .describe(
              'API name of the lookup field (e.g., "AccountId", "OwnerId", "ParentId")',
            ),
          label: z.string().describe('Field label (e.g., "Account Name")'),
          referenceTo: z
            .array(z.string())
            .describe(
              'Object types this field can reference (e.g., ["Account"], ["User", "Group"])',
            ),
          relationshipName: z
            .string()
            .nullable()
            .describe(
              'Relationship name for traversal (e.g., "Account", "Owner", "Parent"). Null for some system fields.',
            ),
          required: z
            .boolean()
            .describe(
              'Whether the field is required. Required lookup fields cannot be cleared with removeRelationship.',
            ),
          updateable: z
            .boolean()
            .describe(
              'Whether the field can be updated. False for read-only system fields like CreatedById.',
            ),
          createable: z
            .boolean()
            .describe('Whether the field can be set on create'),
        }),
      )
      .describe(
        'Lookup/master-detail fields on this object (parent relationships, where this object references another)',
      ),
    childRelationships: z
      .array(
        z.object({
          childObjectApiName: z
            .string()
            .describe(
              'API name of the child object (e.g., "Contact", "Opportunity")',
            ),
          fieldName: z
            .string()
            .describe(
              'Lookup field on the child object that references this object (e.g., "AccountId")',
            ),
          relationshipName: z
            .string()
            .describe(
              'Relationship name for queries (e.g., "Contacts", "Opportunities")',
            ),
        }),
      )
      .describe(
        'Child relationships on this object (other objects that reference this one)',
      ),
  }),
};

export type ListRelationshipTypesInput = z.infer<
  typeof listRelationshipTypesSchema.input
>;
export type ListRelationshipTypesOutput = z.infer<
  typeof listRelationshipTypesSchema.output
>;

// ============================================================================
// getAccountHierarchy
// ============================================================================

export const getAccountHierarchySchema = {
  name: 'getAccountHierarchy',
  description:
    'Get the parent/child account hierarchy for an account. Walks up the ParentId chain to find ancestors and retrieves child accounts.',
  notes:
    'Traverses Account.ParentId relationships upward to find the root (ultimate parent) account, and uses the ChildAccounts related list to find child accounts. Each ancestor/child includes Name, Type, Industry, and optionally Owner and NumberOfEmployees.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    accountId: z.string().describe('Account ID to get the hierarchy for'),
    maxDepth: z
      .number()
      .optional()
      .describe(
        'Maximum number of parent levels to traverse upward. Default: 5',
      ),
    includeChildren: z
      .boolean()
      .optional()
      .describe('Whether to include child accounts. Default: true'),
  }),
  output: z.object({
    account: SObjectRecord.describe(
      'The target account record with Name, ParentId, Type, Industry, Owner, NumberOfEmployees',
    ),
    ancestors: z
      .array(SObjectRecord)
      .describe(
        'Ancestor accounts from root to immediate parent. First element is the ultimate parent (root). Empty if account has no parent.',
      ),
    children: z
      .array(SObjectRecord)
      .describe(
        'Direct child accounts (accounts whose ParentId equals the target accountId). Empty if no children found or includeChildren=false.',
      ),
    rootAccountId: z
      .string()
      .describe(
        'ID of the ultimate parent (root) account. Equals accountId if the account has no parent.',
      ),
    hierarchyDepth: z
      .number()
      .describe(
        'Number of ancestor levels above the target account. 0 if the account is the root.',
      ),
  }),
};

export type GetAccountHierarchyInput = z.infer<
  typeof getAccountHierarchySchema.input
>;
export type GetAccountHierarchyOutput = z.infer<
  typeof getAccountHierarchySchema.output
>;

// ============================================================================
// getAssociatedRecords
// ============================================================================

export const getAssociatedRecordsSchema = {
  name: 'getAssociatedRecords',
  description:
    'Get associated records for a parent record by child object type. One-call convenience wrapper that auto-discovers the relationship. The Salesforce equivalent of HubSpot getAssociations.',
  notes:
    'Automatically resolves the parent object type and discovers the child relationship. Just provide parentRecordId and childObjectApiName. For direct control over relatedListId, use getRelatedRecords instead.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    parentRecordId: z
      .string()
      .describe('ID of the parent record (e.g., an Account ID like "001...")'),
    childObjectApiName: z
      .string()
      .describe(
        'API name of the child object to fetch (e.g., "Contact", "Opportunity", "Case")',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Fields to fetch, prefixed with object name (e.g., ["Contact.Name", "Contact.Email"]). If omitted, returns default fields.',
      ),
    pageSize: z
      .number()
      .optional()
      .describe('Number of records per page (default 50, max 2000)'),
    pageToken: z
      .string()
      .optional()
      .describe(
        'Token for pagination; pass nextPageToken from a previous response',
      ),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field API name to sort by (e.g., "Contact.Name"). Prefix with "-" for descending.',
      ),
  }),
  output: z.object({
    total: z.number().describe('Total number of associated records'),
    records: z
      .array(SObjectRecord)
      .describe('Associated records with flattened fields'),
    nextPageToken: z
      .string()
      .nullable()
      .describe('Token for next page, null if no more pages'),
    parentObjectApiName: z
      .string()
      .describe('Resolved API name of the parent object (e.g., "Account")'),
    childObjectApiName: z
      .string()
      .describe('Child object API name as requested'),
    relationshipName: z
      .string()
      .describe(
        'Discovered relatedListId used for the query (e.g., "Contacts")',
      ),
  }),
};

export type GetAssociatedRecordsInput = z.infer<
  typeof getAssociatedRecordsSchema.input
>;
export type GetAssociatedRecordsOutput = z.infer<
  typeof getAssociatedRecordsSchema.output
>;

// ============================================================================
// All schemas for this domain
// ============================================================================

export const relationshipSchemas = [
  getRelatedRecordsSchema,
  createRelationshipSchema,
  removeRelationshipSchema,
  listRelationshipTypesSchema,
  getAccountHierarchySchema,
  getAssociatedRecordsSchema,
];
