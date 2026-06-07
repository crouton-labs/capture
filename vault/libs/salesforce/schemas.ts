import { z } from 'zod';
import { contractSchemas } from './contracts/schemas';
import { orderSchemas } from './orders/schemas';
import { assetSchemas } from './assets/schemas';
import { pricebookSchemas } from './pricebooks/schemas';
import { knowledgeSchemas } from './knowledge/schemas';
import { emailTemplateSchemas } from './email-templates/schemas';
import { chatterSchemas } from './chatter/schemas';
import { fileSchemas } from './files/schemas';
import { approvalSchemas } from './approvals/schemas';
import { listViewSchemas } from './list-views/schemas';
import { relationshipSchemas } from './relationships/schemas';
import { duplicateSchemas } from './duplicates/schemas';
import { pipelineSchemas } from './pipeline/schemas';
import { fieldSchemas } from './fields/schemas';

export const libraryIcon = '/icons/libs/salesforce.ico';
export const loginUrl = 'https://welcome.salesforce.com/';

export const libraryDescription =
  'Salesforce CRM operations for accounts, contacts, opportunities, leads, cases, campaigns, products, tasks, events, notes, reports, dashboards, users, commerce, quick text, segments, schema metadata, flows, security, change data capture, contracts, orders, assets, pricebooks, knowledge articles, email templates, chatter/feed, files, approvals, campaign members, case comments, opportunity line items, opportunity contact roles, report execution, dashboard details, GraphQL queries, record merging, list views (saved record filter views), relationship/association management (related records, linking/unlinking, relationship types, account hierarchy, one-call associated record fetch), duplicate detection/management, pipeline/stage management (opportunity stages, sales processes, forecast categories, stage history, Lightning Path), custom field inspection (list custom fields, view field dependencies), object property discovery (flat field list with picklist values)';

export const libraryNotes = `
## Workflow

1. Discover the org URL: use \`cdpList\` with \`app="browser"\` to get a port and targetId, then use \`cdpScript\` to return ONLY the domain string (not the cookie array). Use this exact code: \`const {cookies} = await cdp.send('Storage.getCookies', {}); const sf = cookies.find(c => c.domain.includes('.lightning.force.com')); return sf?.domain;\`; this returns a single string like \`"myorg.lightning.force.com"\`. Do NOT return the full cookie list. Note: finding a cookie only tells you the domain; it does NOT mean the user is logged in. Sessions expire.
2. Navigate to \`https://<discovered-domain>/lightning/page/home\`
3. Call \`getContext()\` to get auth tokens. If \`getContext()\` throws a "login page" error, the user's session has expired; stop and tell the user to log in. Do NOT retry or re-navigate.
4. Use \`auraToken\` and \`auraContext\` from \`getContext()\` for all other operations

Salesforce orgs use unique subdomains like \`{orgname}.lightning.force.com\` that cannot be guessed. Do NOT attempt to construct Lightning URLs from org ID, instance, or company name; they will not resolve. If step 1 returns null (no cookie found), ask the user which Salesforce org to use.

## Object Types

- **Account** = Company record (no pipeline stage)
- **Contact** = Person record
- **Opportunity** = Deal/pipeline record (has \`StageName\` for pipeline stages like "Prospecting", "Closed Won")
- **Lead** = Unqualified prospect
- **Case** = Support ticket
- **Campaign** = Marketing campaign
- **Product** = Product/service in the catalog (API name: Product2)
- **Contract** = Agreement record (has Status, StartDate, ContractTerm)
- **Order** = Purchase order (has EffectiveDate, Status)
- **Asset** = Customer-owned product (Service Cloud)
- **Pricebook2** = Price list. **PricebookEntry** = product-pricebook-price association
- **Knowledge__kav** = Knowledge article (requires Knowledge feature)
- **EmailTemplate** = Email template
- **FeedItem** = Chatter post. **FeedComment** = comment on a Chatter post
- **ContentDocument** = File record (use \`linkNoteToRecord\` to attach to records)
- **ProcessInstanceWorkitem** = Pending approval action
- **CampaignMember** = Lead or Contact associated with a Campaign
- **CaseComment** = Comment on a Case
- **OpportunityLineItem** = Product on an Opportunity (requires PricebookEntry)
- **OpportunityContactRole** = Contact associated with an Opportunity in a specific role

When users ask about "companies by stage" or "pipeline stages", use Opportunities (\`listOpportunities\`), not Accounts. Accounts do not have stages.

## Pipeline & Stage Management

- **List available stages** -> \`listOpportunityStages()\` returns all stages with probability, forecast category, and closed/won flags
- **Sales processes (pipelines)** -> \`listSalesProcesses()\` lists all pipelines, each mapping to a record type with a subset of allowed stages
- **Sales process details** -> \`getSalesProcess(processId)\` shows which stages are allowed for a specific pipeline
- **Move opportunity to a stage** -> \`updateOpportunityStage(opportunityId, stageName)\` changes the stage (and optionally amount/close date)
- **Stage change history** -> \`getOpportunityHistory(opportunityId)\` returns each stage transition with timestamps
- **Forecast categories** -> \`listForecastCategories()\` returns categories (Pipeline, Best Case, Commit, Closed) and stage mappings
- **Lightning Path** -> \`getOpportunityStagePath(opportunityId)\` returns ordered stages with complete/current/incomplete status

## Search Strategy

- **Find by keyword across all objects** -> \`globalSearch()\` (minimum 2 characters)
- **Find within a specific object type** -> \`searchRecords()\` (minimum 2 characters)
- **List all records of a type** -> \`listAccounts()\`, \`listContacts()\`, \`listOpportunities()\`, \`listLeads()\`, \`listCases()\`, \`listCampaigns()\`, \`listProducts()\`, \`listTasks()\`, \`listEvents()\`
- **List any sObject type (including custom)** -> \`listRecords()\`
- **Get a single record by ID** -> typed getters (\`getAccount()\`, \`getContact()\`, etc.) or generic \`getRecord()\`
- **Advanced queries** -> \`executeGraphQL()\` accepts any Salesforce GraphQL query
- **Saved filters (list views)** -> \`listListViews()\` to discover available views, \`getListViewRecords()\` to run them, \`createListView()\` / \`updateListView()\` / \`deleteListView()\` to manage custom views

## Notes

Create a note with \`createNote()\`, then attach it to a record with \`linkNoteToRecord()\`.

Opportunity line items require a PricebookEntry. Add the product to a pricebook first via \`createPricebookEntry\`, then use its ID with \`addOpportunityLineItem\`.

Campaign members: \`addCampaignMember\` requires either \`leadId\` or \`contactId\` (not both).

Case comments: \`addCaseComment\` creates internal comments by default; set \`isPublished: true\` for customer-visible portal comments.

Approvals: \`submitForApproval\` and \`approveOrReject\` use speculative Aura descriptors; verify via CDP if they fail.

Report execution: \`runReport\` uses WaveAssetRecordHomeController and may not be available in all org versions.

## Relationships & Associations

Salesforce records are linked via lookup/master-detail fields (e.g., Contact.AccountId links a Contact to an Account). Simplest approach: use \`getAssociatedRecords(parentRecordId, "Contact")\` to fetch associated records in one call; it auto-discovers the relationship. For more control: use \`listRelationshipTypes()\` to discover lookup fields and child relationships, then \`getRelatedRecords()\` with a specific relatedListId. Use \`createRelationship()\` / \`removeRelationship()\` to link/unlink records. Use \`getAccountHierarchy()\` to traverse parent/child Account chains.

## Object Properties

Use \`getObjectProperties(objectApiName)\` to get a flat, scannable list of all fields on an object with their types, requirements, and picklist values inlined. This is the easiest way to discover what fields are available. For the raw metadata blob, use \`getObjectInfo()\` instead.

## Duplicate Detection

Use \`findDuplicates()\` to find potential duplicate records by providing identifying field values. Use \`listDuplicateRules()\` to see which duplicate rules are configured in the org. For merge operations, use \`getMergeCandidates()\` to find similar records and \`mergeRecords()\` to merge them.

## Custom Field Inspection

Use \`listCustomFields()\` to list custom fields (ending in \`__c\`) on any object. Use \`getFieldDependencies()\` to see which picklist fields control other picklist fields (dependent picklist mappings). These are read-only operations; field creation/update/deletion is not available from the browser context.

## Tasks and Events

Task and Event CRUD uses GraphQL mutations via the Aura endpoint (RecordUiController standard CRUD rejects Task/Event objects). Task deletion falls back to GraphQL if RecordUiController/deleteRecord rejects it.

- **createTask** / **updateTask** / **deleteTask**: full Task CRUD
- **logCall**: creates a completed Task with TaskSubtype="Call" (appears in Activity Timeline)
- **logEmail**: creates a completed Task with TaskSubtype="Email" (appears in Activity Timeline)
- **createEvent** / **updateEvent**: calendar event CRUD
- Task statuses: "Not Started", "In Progress", "Completed", "Waiting on someone else", "Deferred"
- Task priorities: "High", "Normal", "Low"
- WhoId = Contact or Lead ID, WhatId = Account/Opportunity/Case/etc. ID
`;

// ============================================================================
// Common Parameters
// ============================================================================

const AuraTokenParam = z.string().describe('Aura token from getContext()');
const AuraContextParam = z.string().describe('Aura context from getContext()');

// ============================================================================
// Shared Output Schemas
// ============================================================================

const SObjectRecord = z
  .object({
    Id: z.string().describe('Salesforce record ID'),
  })
  .passthrough();

const SaveResult = z.object({
  id: z.string().describe('ID of the created/updated record'),
  record: SObjectRecord.describe('Full record as returned by Salesforce'),
});

const DeleteResult = z.object({
  deleted: z.literal(true),
  recordId: z.string().describe('ID of the deleted record'),
});

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Extract authentication context from the current Salesforce Lightning page - call FIRST before any other operation',
  input: z.object({}),
  output: z.object({
    auraToken: z
      .string()
      .describe('Authentication token for Salesforce operations'),
    auraContext: z
      .string()
      .describe('Serialized context for Salesforce operations'),
    orgDomain: z
      .string()
      .describe('Organization domain name (e.g., yourorg.my.salesforce.com)'),
    instanceUrl: z
      .string()
      .describe(
        'Full instance URL origin (e.g., https://yourorg.my.salesforce.com)',
      ),
    lightningUrl: z
      .string()
      .describe(
        'Lightning Experience URL origin (e.g., https://yourorg.lightning.force.com)',
      ),
    setupOrgOrigin: z
      .string()
      .optional()
      .describe(
        'Setup domain URL origin (e.g., https://yourorg.my.salesforce-setup.com)',
      ),
    vfDomain: z
      .string()
      .optional()
      .describe('Visualforce domain (e.g., yourorg--c.vf.force.com)'),
    defaultServerDomain: z
      .string()
      .optional()
      .describe(
        'Backend server domain (e.g., usa842.sfdc-8tgtt5.salesforce.com)',
      ),
    isNetworksEnabled: z
      .boolean()
      .optional()
      .describe('Whether Experience Cloud (Communities/Networks) is enabled'),
    nonce: z.string().optional().describe('CSRF nonce from host config'),
  }),
  notes:
    'Must be on a Salesforce Lightning page (*.lightning.force.com). Throws if not on a Salesforce page or user is not logged in.',
};

// ============================================================================
// Accounts
// ============================================================================

export const listAccountsSchema = {
  name: 'listAccounts',
  description:
    'List accounts with pagination, sorting, searching, and list view filtering via the ListUi API',
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
        'List view API name to filter by (default "AllAccounts"). Standard views: "AllAccounts", "MyAccounts", "NewThisWeek", "RecentlyViewedAccounts", "__Recent".',
      ),
    sortBy: z
      .array(z.string())
      .optional()
      .describe(
        'Array of field paths to sort by, e.g. ["Account.Name"]. Prefix with "-" for descending, e.g. ["-Account.Name"].',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe(
        'Search term to filter records within the list view (minimum 2 characters)',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Restrict output to specific fields (client-side filter). Use dot notation, e.g. ["Account.Id", "Account.Name", "Account.Phone"]. Id is always included. When omitted, all default fields are returned.',
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
        'Additional fields to return if available, in Object.Field format (e.g. ["Account.Industry", "Account.Type", "Account.AnnualRevenue"]). Unlike fields, does not error if the field does not exist on the object.',
      ),
    where: z
      .string()
      .optional()
      .describe(
        'Serialized JSON filter for server-side filtering. Supports operators: eq, ne, like (SQL LIKE with %), in, nin, gt, gte, lt, lte (numeric fields only; date fields return 400). Logical combinators: and, or, not. Examples: \'{"Name":{"like":"A%"}}\', \'{"Name":{"eq":"Acme Corp"}}\', \'{"Name":{"in":["Amazon","Acme Corp"]}}\', \'{"or":[{"Name":{"like":"A%"}},{"Name":{"like":"B%"}}]}\', \'{"and":[{"Name":{"like":"A%"}},{"Website":{"ne":null}}]}\', \'{"AnnualRevenue":{"gt":1000000}}\'.',
      ),
  }),
  output: z.object({
    count: z
      .number()
      .describe(
        'Number of records returned on this page (NOT total across all pages). Use nextPageToken to check for more.',
      ),
    accounts: z.array(SObjectRecord).describe('Array of account records'),
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
};

export const getAccountSchema = {
  name: 'getAccount',
  description: 'Get a single account by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    accountId: z.string().describe('Salesforce Account ID'),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type for field selection. FULL returns all fields (~34), COMPACT returns key fields (~23) including PhotoUrl. Default: FULL',
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
        'Specific fields to fetch (e.g. ["Account.Name", "Account.Phone"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["Account.Industry", "Account.AnnualRevenue"]). Non-existent fields are silently omitted. Uses RecordUiController/getRecordWithFields when specified',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["Contacts", "Opportunities", "Cases"]). Returns paginated child records for each relationship. Only works when fields or optionalFields are specified (uses RecordUiController/getRecordWithFields). Valid relationship names for Account include: Contacts, Opportunities, Cases, OpenActivities, ActivityHistories, Notes, AccountPartnersFrom, AttachedContentDocuments, CombinedAttachments',
      ),
  }),
  output: SObjectRecord,
};

export const createAccountSchema = {
  name: 'createAccount',
  description: 'Create a new account',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    name: z.string().describe('Account name (required)'),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe(
        'When true, bypasses Salesforce duplicate rules and saves even if duplicates are detected. Defaults to false.',
      ),
    fields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Additional account fields. Known field names: Website, Type (Analyst|Competitor|Customer|Integrator|Investor|Partner|Press|Prospect|Reseller|Other), Description, Phone, Fax, Industry (Agriculture|Apparel|Banking|Biotechnology|Chemicals|Communications|Construction|Consulting|Education|Electronics|Energy|Engineering|Entertainment|Environmental|Finance|Food & Beverage|Government|Healthcare|Hospitality|Insurance|Machinery|Manufacturing|Media|Not For Profit|Recreation|Retail|Shipping|Technology|Telecommunications|Transportation|Utilities|Other), AccountSource (Advertisement|Employee Referral|External Referral|Partner|Public Relations|Seminar - Internal|Seminar - Partner|Trade Show|Web|Word of mouth|Other), AnnualRevenue, NumberOfEmployees, SicDesc, Jigsaw, ParentId, OwnerId, BillingStreet, BillingCity, BillingState, BillingStateCode, BillingPostalCode, BillingCountry, BillingCountryCode, BillingLatitude, BillingLongitude, BillingGeocodeAccuracy, ShippingStreet, ShippingCity, ShippingState, ShippingStateCode, ShippingPostalCode, ShippingCountry, ShippingCountryCode, ShippingLatitude, ShippingLongitude, ShippingGeocodeAccuracy.',
      ),
  }),
  output: SaveResult,
};

export const updateAccountSchema = {
  name: 'updateAccount',
  description: 'Update an existing account',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    accountId: z.string().describe('Salesforce Account ID'),
    fields: z
      .record(z.string(), z.unknown())
      .describe(
        'Fields to update, at least one required. Use Salesforce API field names (e.g. Name, Phone, Website, Industry, Description, BillingCity, BillingStateCode, BillingCountryCode, Type)',
      ),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe('Save even if duplicate rules match (default false)'),
    ifUnmodifiedSince: z
      .string()
      .optional()
      .describe(
        'Optimistic concurrency: only update if record unmodified since this HTTP-date (e.g. "Thu, 05 Feb 2026 06:30:55 GMT")',
      ),
  }),
  output: SaveResult,
};

export const deleteAccountSchema = {
  name: 'deleteAccount',
  description: 'Delete an account by ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    accountId: z.string().describe('Salesforce Account ID'),
  }),
  output: DeleteResult,
};

// ============================================================================
// Contacts
// ============================================================================

export const listContactsSchema = {
  name: 'listContacts',
  description:
    'List contacts with pagination, sorting, searching, and filtering',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 25)'),
    page: z
      .number()
      .optional()
      .describe(
        'Page number, zero-indexed (default 0). Uses token-based pagination internally.',
      ),
    pageToken: z
      .string()
      .optional()
      .describe(
        'Cursor token for pagination. Use nextPageToken/previousPageToken from a previous response. Takes precedence over page.',
      ),
    sortBy: z
      .array(z.string())
      .optional()
      .describe(
        'Array of field API names to sort by, using Object.Field format (e.g. ["Contact.Name", "-Contact.Email"]). Prefix with "-" for descending order. Server-validated: invalid field names will error.',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe(
        'Search term to filter results. Matches across Name and other text fields.',
      ),
    listViewApiName: z
      .string()
      .optional()
      .describe(
        'List view API name (default "AllContacts"). Use "MyContacts" for contacts owned by the current user, or a custom list view name.',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Fields to return in Object.Field format (e.g. ["Contact.Id", "Contact.Name", "Contact.Email"]). Defaults to Id, Name, Email, Phone, AccountId, Account.Name, Owner.Alias, OwnerId.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Additional fields to return if available, in Object.Field format (e.g. ["Contact.Fax", "Contact.MailingCity"]). Unlike fields, does not error if the field does not exist on the object.',
      ),
    where: z
      .string()
      .optional()
      .describe(
        'GraphQL-like filter string for server-side filtering. Single field per query. Operators: eq, ne, like (SQL LIKE with %), in, nin, gt, gte, lt, lte. Examples: \'{ Name: { like: "J%" } }\', \'{ Email: { eq: "user@example.com" } }\', \'{ Email: { ne: null } }\', \'{ Name: { in: ["Alice", "Bob"] } }\'.',
      ),
  }),
  output: z.object({
    count: z.number().describe('Number of contacts in the current page'),
    contacts: z.array(SObjectRecord).describe('Array of contact records'),
    nextPageToken: z
      .string()
      .nullable()
      .describe('Token for the next page, or null if no more pages'),
    previousPageToken: z
      .string()
      .nullable()
      .describe('Token for the previous page, or null if on first page'),
    currentPageToken: z
      .string()
      .nullable()
      .describe('Token for the current page'),
  }),
};

export const getContactSchema = {
  name: 'getContact',
  description: 'Get a single contact by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    contactId: z.string().describe('Salesforce Contact ID'),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type controlling which fields are returned. FULL returns all fields (~34), COMPACT returns a focused subset (~22). Defaults to FULL.',
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
        'Record type ID to filter fields by record type layout (e.g., "012000000000000AAA" for master record type)',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch (e.g. ["Contact.Name", "Contact.Email"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format. Errors if a field does not exist.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["Contact.MobilePhone", "Contact.Department"]). Non-existent fields are silently omitted. Uses RecordUiController/getRecordWithFields when specified.',
      ),
  }),
  output: SObjectRecord,
};

export type GetContactInput = z.infer<typeof getContactSchema.input>;

export const createContactSchema = {
  name: 'createContact',
  description: 'Create a new contact',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    lastName: z.string().describe('Contact last name (required)'),
    firstName: z.string().optional().describe('Contact first name'),
    email: z.string().optional().describe('Contact email address'),
    fields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Additional contact fields (Phone, Title, AccountId, MailingCity, etc.)',
      ),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe('Save even if duplicate rules match (default false)'),
    triggerOtherEmail: z
      .boolean()
      .optional()
      .describe(
        'Trigger workflow email notifications to non-owners (default true)',
      ),
    triggerUserEmail: z
      .boolean()
      .optional()
      .describe(
        'Trigger email notification to the record owner (default true)',
      ),
    useDefaultRule: z
      .boolean()
      .optional()
      .describe('Apply the default assignment rule when creating the record'),
    assignmentRuleId: z
      .string()
      .optional()
      .describe(
        'ID of a specific assignment rule to apply (alternative to useDefaultRule). Obtain IDs by querying the AssignmentRule sObject.',
      ),
    triggerAutoResponseEmail: z
      .boolean()
      .optional()
      .describe(
        'Trigger auto-response email rules when creating the record (applies to Lead and Case objects)',
      ),
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Record type ID to use for the new contact (for orgs with multiple contact record types)',
      ),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type controlling which fields are returned in the response (default FULL)',
      ),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE'])
      .optional()
      .describe(
        'Operation mode controlling which fields are returned in the response',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Additional fields to include in the response if available, in Object.Field format (e.g. ["Contact.Department", "Contact.Birthdate"]). Non-existent fields are silently omitted.',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include in the response (e.g. ["Contact.Opportunities"])',
      ),
  }),
  output: SaveResult,
};

export const updateContactSchema = {
  name: 'updateContact',
  description:
    'Update an existing contact. Pass field API names in PascalCase (e.g. FirstName, LastName, Email, Phone, Title, AccountId, MailingCity). Set a field to null to clear it.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    contactId: z.string().describe('Salesforce Contact ID'),
    fields: z
      .record(z.string(), z.unknown())
      .describe(
        'Fields to update in PascalCase API names (at least one required). Examples: FirstName, LastName, Email, Phone, Title, AccountId, MailingCity, Description. Set a value to null to clear it.',
      ),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe('Save even if duplicate rules match (default false)'),
    ifUnmodifiedSince: z
      .string()
      .optional()
      .describe(
        'Optimistic concurrency: only update if record unmodified since this HTTP-date (e.g. "Thu, 05 Feb 2026 06:30:55 GMT")',
      ),
    triggerOtherEmail: z
      .boolean()
      .optional()
      .describe('Fire workflow email notifications on update (default false)'),
    triggerUserEmail: z
      .boolean()
      .optional()
      .describe('Fire user email notifications on update (default false)'),
    useDefaultRule: z
      .boolean()
      .optional()
      .describe('Use default assignment rule when updating (default false)'),
    recordTypeId: z
      .string()
      .optional()
      .describe('Record type ID to apply for the response layout'),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe('Layout type for the returned record (default FULL)'),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE'])
      .optional()
      .describe('Mode for the returned record layout (default VIEW)'),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Additional fields to include in the response (e.g. ["Contact.MobilePhone", "Contact.Department"])',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationships to include in the response (e.g. ["Cases", "Opportunities"])',
      ),
  }),
  output: SaveResult,
};

export const deleteContactSchema = {
  name: 'deleteContact',
  description: 'Delete a contact by ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    contactId: z.string().describe('Salesforce Contact ID'),
  }),
  output: DeleteResult,
};

// ============================================================================
// Opportunities
// ============================================================================

export const listOpportunitiesSchema = {
  name: 'listOpportunities',
  description:
    'List opportunities with pagination, sorting, searching, and list view filtering via the ListUi API',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z
      .number()
      .optional()
      .describe('Results per page, 1-2000 (default 25)'),
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
        'List view API name to filter by (default "AllOpportunities"). Standard views: "AllOpportunities", "ClosingNextMonth", "ClosingThisMonth", "Default_Opportunity_Pipeline", "MyOpportunities", "NewThisWeek", "Won", "RecentlyViewedOpportunities", "__Recent".',
      ),
    sortBy: z
      .array(z.string())
      .optional()
      .describe(
        'Array of field paths to sort by, e.g. ["Opportunity.CloseDate"]. Prefix with "-" for descending, e.g. ["-Opportunity.CloseDate"].',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe(
        'Search term to filter records within the list view (minimum 2 characters)',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Fields to retrieve in dot notation, e.g. ["Opportunity.Id", "Opportunity.Name", "Opportunity.StageName"]. Defaults to Id, Name, Account.Name, AccountId, StageName, CloseDate, Owner.Alias, OwnerId. Note: the ListUi API always includes the list view\'s configured columns regardless of this parameter; these fields are additive, not restrictive.',
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
        'Additional fields to return if available, in Object.Field format (e.g. ["Opportunity.Amount", "Opportunity.Probability", "Opportunity.ForecastCategoryName"]). Unlike fields, does not error if the field does not exist on the object.',
      ),
    where: z
      .string()
      .optional()
      .describe(
        'Serialized JSON filter. Supports operators: eq, ne, like (SQL LIKE with %), in, nin, gt, gte, lt, lte. Logical combinators: and, or, not. Range operators (gt/gte/lt/lte) on date fields (YYYY-MM-DD values) are applied client-side after fetch since the Salesforce ListUi API does not support them natively; this means count may be less than pageSize. All other operators are sent server-side. Examples: \'{"StageName":{"eq":"Closed Won"}}\', \'{"CloseDate":{"gte":"2026-01-01"}}\', \'{"Amount":{"gt":50000}}\', \'{"or":[{"StageName":{"eq":"Prospecting"}},{"StageName":{"eq":"Qualification"}}]}\', \'{"StageName":{"eq":"Closed Won"},"CloseDate":{"gte":"2025-10-01"}}\'.',
      ),
  }),
  output: z.object({
    count: z
      .number()
      .describe(
        'Number of records returned on this page (NOT total across all pages). May be less than pageSize when date range filters are applied client-side. Use nextPageToken to check for more.',
      ),
    opportunities: z
      .array(SObjectRecord)
      .describe(
        'Array of opportunity records. Default fields always include Id, Name, StageName, CloseDate, AccountId, OwnerId, Amount (nullable), IsClosed, CreatedDate, LastModifiedDate, SystemModstamp, and Owner (nested object with Id, Alias, Name). Use optionalFields to request additional fields like Probability, ForecastCategoryName, Type, LeadSource.',
      ),
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
  notes:
    'Maximum 2000 records can be returned due to ListUi API limitations. For larger datasets, use date-range filters on the `where` parameter to partition the query (e.g., filter by CloseDate ranges).',
};

export const getOpportunitySchema = {
  name: 'getOpportunity',
  description: 'Get a single opportunity by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    opportunityId: z.string().describe('Salesforce Opportunity ID'),
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
        'Operation mode controlling which fields are returned in the response',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch (e.g. ["Opportunity.Name", "Opportunity.Amount"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format. Errors if a field does not exist.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["Opportunity.Type", "Opportunity.LeadSource"]). Non-existent fields are silently omitted. Uses RecordUiController/getRecordWithFields when specified.',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["OpportunityLineItems", "OpportunityContactRoles"]). Returns paginated child records for each relationship. Requires fields param (not just optionalFields). Uses RecordUiController/getRecordWithFields.',
      ),
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Salesforce Record Type ID (e.g. "012000000000000AAA"). Controls which record type layout is used for field selection. Useful in orgs with multiple record types.',
      ),
    pageSize: z
      .number()
      .optional()
      .describe(
        'Number of child records to return per child relationship. Default: 5. Only applies when childRelationships is specified.',
      ),
  }),
  output: SObjectRecord,
};

export const createOpportunitySchema = {
  name: 'createOpportunity',
  description: 'Create a new opportunity',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    name: z.string().describe('Opportunity name (required)'),
    stageName: z
      .string()
      .describe('Pipeline stage (required, e.g. "Prospecting", "Closed Won")'),
    closeDate: z
      .string()
      .describe('Expected close date in YYYY-MM-DD format (required)'),
    amount: z
      .number()
      .optional()
      .describe('Opportunity amount in the org default currency'),
    probability: z
      .number()
      .optional()
      .describe(
        'Win probability percentage (0-100). May auto-populate based on Stage',
      ),
    description: z.string().optional().describe('Opportunity description text'),
    nextStep: z.string().optional().describe('Next step in the sales process'),
    accountId: z
      .string()
      .optional()
      .describe('Salesforce Account ID to associate with this opportunity'),
    forecastCategoryName: z
      .string()
      .optional()
      .describe(
        'Forecast category (e.g. "Pipeline", "Best Case", "Commit", "Omitted", "Closed"). May auto-populate based on Stage',
      ),
    ownerId: z
      .string()
      .optional()
      .describe(
        'Salesforce User ID for the opportunity owner. Defaults to the current user',
      ),
    type: z
      .string()
      .optional()
      .describe(
        'Opportunity type (e.g. "New Customer", "Existing Customer - Upgrade", "Existing Customer - Replacement")',
      ),
    leadSource: z
      .string()
      .optional()
      .describe(
        'Lead source for the opportunity (e.g. "Web", "Phone Inquiry", "Partner Referral", "Purchased List", "Other")',
      ),
    fields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Additional opportunity fields beyond the explicit parameters above (e.g. CampaignId, Pricebook2Id, custom fields)',
      ),
  }),
  output: SaveResult,
};

export type CreateOpportunityInput = z.infer<
  typeof createOpportunitySchema.input
>;

export const updateOpportunitySchema = {
  name: 'updateOpportunity',
  description: 'Update an existing opportunity',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    opportunityId: z.string().describe('Salesforce Opportunity ID'),
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
        'Optimistic concurrency: only update if record unmodified since this HTTP-date (e.g. "Thu, 05 Feb 2026 06:30:55 GMT")',
      ),
    triggerOtherEmail: z
      .boolean()
      .optional()
      .describe('Fire workflow email notifications on update (default false)'),
    triggerUserEmail: z
      .boolean()
      .optional()
      .describe('Fire user email notifications on update (default false)'),
    useDefaultRule: z
      .boolean()
      .optional()
      .describe('Use default assignment rule when updating (default false)'),
  }),
  output: SaveResult,
};

export const deleteOpportunitySchema = {
  name: 'deleteOpportunity',
  description: 'Delete an opportunity by ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    opportunityId: z.string().describe('Salesforce Opportunity ID'),
  }),
  output: DeleteResult,
};

// ============================================================================
// Leads
// ============================================================================

export const listLeadsSchema = {
  name: 'listLeads',
  description:
    'List leads with pagination, sorting, searching, and list view filtering via the ListUi API',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z
      .number()
      .min(1)
      .max(2000)
      .optional()
      .describe('Results per page, 1–2000 (default 25)'),
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
        'List view API name to filter by (default "AllOpenLeads"). Standard views: "AllOpenLeads", "MyUnreadLeads", "TodaysLeads", "RecentlyViewedLeads", "__Recent".',
      ),
    sortBy: z
      .array(z.string())
      .optional()
      .describe(
        'Array of field paths to sort by, e.g. ["Lead.Name"]. Prefix with "-" for descending, e.g. ["-Lead.CreatedDate"].',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe(
        'Search term to filter records within the list view (minimum 2 characters)',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Fields to request from the API, in Object.Field dot notation, e.g. ["Lead.Id", "Lead.Name", "Lead.Company"]. System fields (CreatedDate, LastModifiedDate, etc.) are always included. When omitted, defaults to Id, Name, Company, Email, Phone, Status, Owner.Alias, OwnerId.',
      ),
    pageToken: z
      .string()
      .optional()
      .describe(
        'Opaque token for cursor-based pagination (max offset 2000). Use nextPageToken/previousPageToken from a previous response. Accepts numeric string.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Additional fields to return if available, in Object.Field format (e.g. ["Lead.Industry", "Lead.LeadSource"]). Unlike fields, does not error if the field does not exist on the object.',
      ),
    where: z
      .string()
      .optional()
      .describe(
        'Serialized JSON filter for server-side filtering. Supports operators: eq, ne, like (SQL LIKE with %), in, nin, gt, gte, lt, lte. Logical combinators: and, or, not. Examples: \'{"Company":{"like":"A%"}}\', \'{"Status":{"eq":"Open - Not Contacted"}}\', \'{"and":[{"Company":{"like":"V%"}},{"Status":{"eq":"New"}}]}\'.',
      ),
  }),
  output: z.object({
    count: z
      .number()
      .describe(
        'Number of records returned on this page (NOT total across all pages). Use nextPageToken to check for more.',
      ),
    leads: z.array(SObjectRecord).describe('Array of lead records'),
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
};

export const getLeadSchema = {
  name: 'getLead',
  description: 'Get a single lead by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    leadId: z.string().describe('Salesforce Lead ID'),
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
        'Record mode. VIEW returns read-only data, EDIT returns data with recordLayout metadata for form rendering, CREATE returns a template for new record creation. Default: VIEW',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch (e.g. ["Lead.Name", "Lead.Email"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format. Errors if a field does not exist.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["Lead.Phone", "Lead.Website"]). Non-existent fields are silently omitted. Uses RecordUiController/getRecordWithFields when specified.',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["OpenActivities", "ActivityHistories", "CampaignMembers"]). Returns paginated child records for each relationship. Only works when fields or optionalFields are specified (uses RecordUiController/getRecordWithFields).',
      ),
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Record type ID to control which page layout is used (e.g. "012000000000000AAA" for Master). Only applies when using DetailController (i.e. when fields/optionalFields/childRelationships are NOT specified). Determines which layout fields are returned for orgs with multiple record types.',
      ),
  }),
  output: SObjectRecord,
};

export const createLeadSchema = {
  name: 'createLead',
  description: 'Create a new lead',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    lastName: z.string().describe('Lead last name (required)'),
    company: z.string().describe('Lead company name (required)'),
    fields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Additional lead fields (FirstName, Email, Phone, Title, Status, etc.)',
      ),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe('Save even if duplicate rules match (default false)'),
    triggerOtherEmail: z
      .boolean()
      .optional()
      .describe(
        'Trigger workflow email notifications to non-owners (default true)',
      ),
    triggerUserEmail: z
      .boolean()
      .optional()
      .describe(
        'Trigger email notification to the record owner (default true)',
      ),
    useDefaultRule: z
      .boolean()
      .optional()
      .describe('Apply the default assignment rule when creating the record'),
    assignmentRuleId: z
      .string()
      .optional()
      .describe(
        'ID of a specific assignment rule to apply (alternative to useDefaultRule). Obtain IDs by querying the AssignmentRule sObject.',
      ),
    triggerAutoResponseEmail: z
      .boolean()
      .optional()
      .describe('Trigger auto-response email rules when creating the record'),
  }),
  output: SaveResult,
};

export const updateLeadSchema = {
  name: 'updateLead',
  description:
    'Update an existing lead. Pass field API names in PascalCase (e.g. FirstName, LastName, Email, Phone, Company, Status, Title). Set a field to null to clear it.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    leadId: z.string().describe('Salesforce Lead ID'),
    fields: z
      .record(z.string(), z.unknown())
      .describe(
        'Fields to update in PascalCase API names (at least one required). Examples: FirstName, LastName, Email, Phone, Company, Status, Title, Description, Website, LeadSource, Industry. Set a value to null to clear it.',
      ),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe('Save even if duplicate rules match (default false)'),
    ifUnmodifiedSince: z
      .string()
      .optional()
      .describe(
        'Optimistic concurrency: only update if record unmodified since this HTTP-date (e.g. "Thu, 05 Feb 2026 06:30:55 GMT")',
      ),
    triggerOtherEmail: z
      .boolean()
      .optional()
      .describe('Fire workflow email notifications on update (default false)'),
    triggerUserEmail: z
      .boolean()
      .optional()
      .describe('Fire user email notifications on update (default false)'),
    useDefaultRule: z
      .boolean()
      .optional()
      .describe('Apply the default assignment rule when updating the record'),
    recordTypeId: z
      .string()
      .optional()
      .describe('Record type ID to apply for the response layout'),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe('Layout type for the returned record (default FULL)'),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE'])
      .optional()
      .describe('Mode for the returned record layout (default VIEW)'),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Additional fields to include in the response if available, in Object.Field format (e.g. ["Lead.MobilePhone", "Lead.Industry"]). Non-existent fields are silently omitted.',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include in the response (e.g. ["CampaignMembers", "OpenActivities"])',
      ),
  }),
  output: SaveResult,
};

export const deleteLeadSchema = {
  name: 'deleteLead',
  description: 'Delete a lead by ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    leadId: z.string().describe('Salesforce Lead ID'),
  }),
  output: DeleteResult,
};

// ============================================================================
// Cases
// ============================================================================

export const listCasesSchema = {
  name: 'listCases',
  description:
    'List cases with pagination, sorting, searching, and list view filtering via the ListUi API',
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
        'List view API name to filter by (default "__Recent"). Standard views: "MyCases", "AllOpenCases", "RecentlyViewedCases", "__Recent". Note: "where" filter requires a non-MRU view (use "AllOpenCases" or "MyCases" instead of "__Recent").',
      ),
    sortBy: z
      .array(z.string())
      .optional()
      .describe(
        'Array of field paths to sort by, e.g. ["CaseNumber"]. Prefix with "-" for descending, e.g. ["-CaseNumber"].',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe(
        'Search term to filter records within the list view (minimum 2 characters)',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Restrict output to specific fields (client-side filter). Use dot notation, e.g. ["Case.Id", "Case.CaseNumber", "Case.Subject", "Case.Status"]. Id is always included. When omitted, all default fields are returned.',
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
        'Additional fields to return if available, in Object.Field format (e.g. ["Case.IsEscalated", "Case.ClosedDate"]). Unlike fields, does not error if the field does not exist on the object.',
      ),
    where: z
      .string()
      .optional()
      .describe(
        'Serialized JSON filter for server-side filtering. NOT supported on MRU views ("__Recent"); use "AllOpenCases" or "MyCases" as listViewApiName. Supports operators: eq, ne, like (SQL LIKE with %), in, nin, gt, gte, lt, lte (numeric fields only; date fields return 400). Logical combinators: and, or, not. Examples: \'{"Subject":{"like":"Test%"}}\', \'{"Status":{"eq":"New"}}\', \'{"Priority":{"in":["High","Critical"]}}\', \'{"or":[{"Status":{"eq":"New"}},{"Status":{"eq":"Escalated"}}]}\'.',
      ),
  }),
  output: z.object({
    count: z
      .number()
      .describe(
        'Number of records returned on this page (NOT total across all pages). Use nextPageToken to check for more.',
      ),
    cases: z.array(SObjectRecord).describe('Array of case records'),
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
};

export const getCaseSchema = {
  name: 'getCase',
  description: 'Get a single case by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    caseId: z.string().describe('Salesforce Case ID'),
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
        'Record mode. VIEW returns read-only data, EDIT returns data with recordLayout metadata for form rendering, CREATE returns a template for new record creation. Default: VIEW',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch (e.g. ["Case.Subject", "Case.Status"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format. Errors if a field does not exist.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["Case.Origin", "Case.Description"]). Non-existent fields are silently omitted. Uses RecordUiController/getRecordWithFields when specified.',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["CaseComments", "OpenActivities", "ActivityHistories"]). Returns paginated child records for each relationship. Only works when fields or optionalFields are specified (uses RecordUiController/getRecordWithFields).',
      ),
  }),
  output: SObjectRecord,
};

export const createCaseSchema = {
  name: 'createCase',
  description: 'Create a new case',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    fields: z
      .record(z.string(), z.unknown())
      .describe(
        'Case fields (at least one required). Common: Subject, Status, Priority, ContactId, AccountId, Description, Origin, Type, OwnerId',
      ),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe('Save even if duplicate rules match (default false)'),
    triggerUserEmail: z
      .boolean()
      .optional()
      .describe(
        'Trigger email notification to the record owner (default true)',
      ),
    triggerOtherEmail: z
      .boolean()
      .optional()
      .describe(
        'Trigger workflow email notifications to non-owners (default false)',
      ),
    useDefaultRule: z
      .boolean()
      .optional()
      .describe(
        'Apply the default case assignment rule when creating the record',
      ),
    assignmentRuleId: z
      .string()
      .optional()
      .describe(
        'ID of a specific assignment rule to apply (alternative to useDefaultRule). Obtain IDs by querying the AssignmentRule sObject.',
      ),
    triggerAutoResponseEmail: z
      .boolean()
      .optional()
      .describe('Trigger auto-response email rules when creating the case'),
  }),
  output: SaveResult,
  notes:
    'Cases have no single required field at the API level, but most orgs require Subject at minimum via validation rules.',
};

export const updateCaseSchema = {
  name: 'updateCase',
  description: 'Update an existing case',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    caseId: z.string().describe('Salesforce Case ID'),
    fields: z
      .record(z.string(), z.unknown())
      .describe(
        'Fields to update, at least one required. Use Salesforce API field names (e.g. Subject, Status, Priority, Origin, Description, OwnerId, AccountId, ContactId)',
      ),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe('Save even if duplicate rules match (default false)'),
    ifUnmodifiedSince: z
      .string()
      .optional()
      .describe(
        'Optimistic concurrency: only update if record unmodified since this HTTP-date (e.g. "Thu, 05 Feb 2026 06:30:55 GMT")',
      ),
    triggerUserEmail: z
      .boolean()
      .optional()
      .describe(
        'Trigger email notification to the record owner (default true)',
      ),
    triggerOtherEmail: z
      .boolean()
      .optional()
      .describe(
        'Trigger workflow email notifications to non-owners (default false)',
      ),
    useDefaultRule: z
      .boolean()
      .optional()
      .describe(
        'Apply the default case assignment rule when updating the record',
      ),
    assignmentRuleId: z
      .string()
      .optional()
      .describe(
        'ID of a specific assignment rule to apply (alternative to useDefaultRule). Obtain IDs by querying the AssignmentRule sObject.',
      ),
    triggerAutoResponseEmail: z
      .boolean()
      .optional()
      .describe('Trigger auto-response email rules when updating the case'),
  }),
  output: SaveResult,
};

export const deleteCaseSchema = {
  name: 'deleteCase',
  description: 'Delete a case by ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    caseId: z.string().describe('Salesforce Case ID'),
  }),
  output: DeleteResult,
};

// ============================================================================
// Search
// ============================================================================

export const globalSearchSchema = {
  name: 'globalSearch',
  description:
    'Search across all Salesforce object types by keyword using autocomplete suggestions, returns results grouped by object type',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    query: z.string().describe('Search term (minimum 2 characters)'),
    entityName: z
      .string()
      .optional()
      .describe(
        'Scope results to a specific sObject type (e.g. "Lead", "Account"). When set, only records of that type are returned. Omit for cross-object search.',
      ),
    limit: z
      .number()
      .optional()
      .describe('Maximum record suggestions to return (default 200)'),
    maxQueries: z
      .number()
      .optional()
      .describe(
        'Maximum query/autocomplete suggestions to return (default 20). Set to 0 to suppress.',
      ),
    maxListViews: z
      .number()
      .optional()
      .describe(
        'Maximum list view suggestions to return (default 20). Set to 0 to suppress.',
      ),
  }),
  output: z.object({
    groups: z
      .array(
        z.object({
          entityType: z
            .string()
            .describe('Object type (e.g. "Account", "Contact")'),
          records: z.array(SObjectRecord).describe('Matching records'),
        }),
      )
      .describe('Results grouped by object type'),
    querySuggestions: z
      .array(z.string())
      .optional()
      .describe('Suggested search queries based on the term'),
    listViewSuggestions: z
      .array(
        z.object({
          id: z.string().describe('List view ID'),
          name: z.string().describe('List view name (e.g. "All Accounts")'),
          entityType: z.string().describe('Object type for the list view'),
        }),
      )
      .optional()
      .describe('Matching list views'),
  }),
  notes:
    'Query must be at least 2 characters. Uses Salesforce autocomplete/suggestions endpoint. Set maxQueries/maxListViews to 0 to suppress those suggestion types. Set entityName to scope results to a single sObject type.',
};

export const searchRecordsSchema = {
  name: 'searchRecords',
  description:
    'Search records within a specific sObject type by keyword using autocomplete suggestions',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    entityType: z
      .string()
      .describe(
        'sObject type to search (e.g. "Account", "Contact", "CustomObj__c")',
      ),
    query: z.string().describe('Search term (minimum 2 characters)'),
    limit: z
      .number()
      .optional()
      .describe(
        'Maximum results to return. The autocomplete API typically returns up to ~25 results; use this to cap the count lower (e.g. limit: 5). Omit for all available results.',
      ),
    maxQueries: z
      .number()
      .optional()
      .describe(
        'Maximum query/autocomplete suggestions requested from the server (default 20). Set to 0 to suppress and improve performance. These suggestions are not returned by this function but reducing them reduces server-side work.',
      ),
    maxTips: z
      .number()
      .optional()
      .describe(
        'Maximum tip suggestions requested from the server (default 20). Set to 0 to suppress and improve performance.',
      ),
    maxListViews: z
      .number()
      .optional()
      .describe(
        'Maximum list view suggestions requested from the server (default 20). Set to 0 to suppress and improve performance.',
      ),
    configurationName: z
      .string()
      .optional()
      .describe(
        'Search configuration context identifier (default "GLOBAL_SEARCH_BAR"). Other values include "SCOPED_RESULTS_SEARCH_BAR", "LOOKUP", "MODAL_SEARCH_BAR", "RELATED_LIST_SEARCH".',
      ),
  }),
  output: z
    .array(SObjectRecord)
    .describe('Matching records of the specified type'),
  notes:
    'Query must be at least 2 characters. Works for any standard or custom sObject type. Uses Salesforce autocomplete/suggestions endpoint. Set maxQueries/maxTips/maxListViews to 0 to suppress unused suggestion types and reduce server-side overhead.',
};

export const listRecordsSchema = {
  name: 'listRecords',
  description:
    'List records for any sObject type with pagination, including custom objects. Uses a list view to determine which records are shown; defaults to recently viewed records.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    entityType: z
      .string()
      .describe(
        'sObject type to list (e.g. "Account", "Contact", "Lead", "CustomObj__c")',
      ),
    listViewApiName: z
      .string()
      .optional()
      .describe(
        'List view API name to use (e.g. "AllAccounts", "AllContacts", "AllOpenLeads", "__Recent"). Defaults to "__Recent" which shows recently viewed records. Use entity-specific "All" views for complete listings.',
      ),
    pageSize: z.number().optional().describe('Results per page (default 25)'),
    page: z
      .number()
      .optional()
      .describe(
        'Page number, zero-indexed (default 0). Converted to pageToken internally. Use pageToken for precise control.',
      ),
    pageToken: z
      .string()
      .optional()
      .describe(
        'Pagination token from a previous response (nextPageToken or previousPageToken). Takes precedence over page.',
      ),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field API name to sort by. Prefix with "-" for descending order (e.g. "Name", "-CreatedDate", "Company")',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe('Search term to filter records within the list view'),
    where: z
      .string()
      .optional()
      .describe(
        'JSON object filter using Connect API syntax (e.g. \'{"Name":{"eq":"Acme"}}\'). Only works on non-MRU list views (not "__Recent"). Operators: eq, ne, like, in, gt, gte, lt, lte.',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific field API names to include in results, using "ObjectName.FieldName" format (e.g. ["Account.Name", "Account.Industry"]). Request fails if user lacks access to any specified field.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional field API names to include in results, using "ObjectName.FieldName" format (e.g. ["Account.Phone", "Account.Website"]). Unlike fields, request succeeds even if user lacks access; inaccessible fields are silently omitted.',
      ),
  }),
  output: z.object({
    count: z.number().describe('Total number of matching records'),
    records: z.array(SObjectRecord).describe('Array of records'),
    nextPageToken: z
      .string()
      .nullable()
      .describe('Token for the next page, or null if no more pages'),
    previousPageToken: z
      .string()
      .nullable()
      .describe('Token for the previous page, or null if on first page'),
    currentPageToken: z
      .string()
      .nullable()
      .describe('Token for the current page'),
  }),
};

export const getRecordSchema = {
  name: 'getRecord',
  description: 'Get a single record by ID for any sObject type',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    recordId: z
      .string()
      .optional()
      .describe(
        'Salesforce record ID (works for any sObject type). Required for VIEW, EDIT, and CLONE modes. Optional for CREATE mode when entityApiNameOrKeyPrefix is provided.',
      ),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type controlling which fields are returned. FULL returns all layout fields, COMPACT returns a focused subset. Defaults to FULL. Works with optionalFields to return layout fields plus extras via RecordUiController/getRecordWithLayouts. Ignored when explicit fields are specified.',
      ),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE', 'CLONE'])
      .optional()
      .describe(
        'Record mode context. VIEW returns standard read fields, EDIT returns editable fields with layout metadata, CREATE returns fields for new record template, CLONE returns record data with Id set to null (ready for cloning). Defaults to VIEW. Works with layoutType and optionalFields. Ignored when explicit fields are specified.',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch (e.g. ["Account.Name", "Account.Phone"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format. Errors if a field does not exist. Overrides layoutType-based field selection.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["Account.Industry", "Account.AnnualRevenue"]). Non-existent fields are silently omitted. When used without fields, returns all layout fields plus these extras via RecordUiController/getRecordWithLayouts. When used with fields, adds to the explicit field list via getRecordWithFields.',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["Contacts", "Opportunities"]). Returns paginated child records for each relationship. Only works when fields is specified (uses RecordUiController/getRecordWithFields).',
      ),
    pageSize: z
      .number()
      .optional()
      .describe(
        'Page size for child relationship results (default 5). Only applies when childRelationships is specified. Controls how many child records are returned per relationship.',
      ),
    pageToken: z
      .string()
      .optional()
      .describe(
        'Pagination cursor for child relationship results. Obtained from currentPageToken or nextPageToken in a previous response. Format: "page;pageSize;recordId;relName;fields;". Only applies when childRelationships is specified.',
      ),
    defaultFieldValues: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Default field values to prepopulate on the record. Only used with DetailController path (no explicit fields). Works in EDIT, CREATE, and CLONE modes. Field values are merged into the returned record and echoed in the response. Example: {"Phone": "555-1234", "Name": "New Account"}.',
      ),
    entityApiNameOrKeyPrefix: z
      .string()
      .optional()
      .describe(
        'sObject API name or key prefix (e.g. "Account", "Contact"). Required for CREATE mode when recordId is omitted to get a blank template record. Also used with CLONE mode to specify the target object type.',
      ),
  }),
  output: SObjectRecord,
};

// ============================================================================
// Tasks
// ============================================================================

export const listTasksSchema = {
  name: 'listTasks',
  description:
    'List tasks with pagination, sorting, and filtering. Uses the SelectableListDataProvider controller.',
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
        'Field name to sort by. Prefix with "-" for descending order (e.g. "-Subject"). Sortable fields include Subject, ActivityDate, Status, Priority, CreatedDate, LastModifiedDate.',
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
        'List view API name to filter results. Standard values: "__Recent" (recently viewed), "OpenTasks", "CompletedTasks", "DelegatedTasks", "OverdueTasks", "TodaysTasks", "RecurringTasks", "UnscheduledTasks". Defaults to the org\'s default list view for Task.',
      ),
    enableRowActions: z
      .boolean()
      .optional()
      .describe(
        'When true, each task record includes a rowActions array listing available actions (e.g. Edit, Delete). Default false.',
      ),
  }),
  output: z.object({
    totalCount: z.number().describe('Total number of tasks'),
    tasks: z.array(SObjectRecord).describe('Array of task records'),
  }),
  notes:
    'Uses SelectableListDataProviderController/getItems. Page-based pagination with page number and pageSize; no token-based pagination.',
};

export type ListTasksInput = z.infer<typeof listTasksSchema.input>;
export type ListTasksOutput = z.infer<typeof listTasksSchema.output>;

export const getTaskSchema = {
  name: 'getTask',
  description:
    'Get a single task by ID. Returns all layout-determined fields via DetailController. Task objects are not supported by RecordUiController, so field-level selection is not available.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    taskId: z.string().describe('Salesforce Task ID'),
    layoutType: z
      .enum(['FULL', 'COMPACT', 'SEARCH'])
      .optional()
      .describe(
        'Layout type for field selection. FULL returns all fields from the page layout including localized variants (__l, __f suffixes). COMPACT returns only compact layout fields (Subject, Status, Priority, etc.). SEARCH returns the search-optimized field set including IsClosed. Default: FULL',
      ),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE', 'CLONE', 'INLINE_EDIT'])
      .optional()
      .describe(
        'Record mode. VIEW returns read-only data, EDIT returns data with recordLayout metadata for form rendering, CREATE returns a null template for new record creation, CLONE returns record data with clone-related fields (CloneSourceId, IsArchived, IsClosed, IsDeleted, IsHighPriority, IsRecurrence, IsReminderSet), INLINE_EDIT returns fields optimized for inline editing. Default: VIEW',
      ),
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Record type ID to filter fields by record type layout (e.g., "012000000000000AAA" for master record type)',
      ),
  }),
  output: SObjectRecord,
  notes:
    'Uses DetailController (not RecordUiController) because Task is not supported in UI API for reads. Field-level selection (fields, optionalFields, childRelationships) is not available for Tasks. FULL layout returns all fields; COMPACT returns a subset; SEARCH returns a search-optimized set with IsClosed. CLONE mode returns additional boolean fields (IsArchived, IsClosed, etc.) useful for cloning workflows. For Task creation/update/delete, use createTask, updateTask, deleteTask.',
};

export type GetTaskInput = z.infer<typeof getTaskSchema.input>;
export type GetTaskOutput = z.infer<typeof getTaskSchema.output>;

export const createTaskSchema = {
  name: 'createTask',
  description:
    'Create a new task with subject, status, priority, due date, and related records',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    subject: z.string().describe('Task subject/title (required)'),
    status: z
      .enum([
        'Not Started',
        'In Progress',
        'Completed',
        'Waiting on someone else',
        'Deferred',
      ])
      .optional()
      .describe('Task status. Default: Not Started'),
    priority: z
      .enum(['High', 'Normal', 'Low'])
      .optional()
      .describe('Task priority. Default: Normal'),
    activityDate: z
      .string()
      .optional()
      .describe('Due date in YYYY-MM-DD format'),
    description: z.string().optional().describe('Task description/comments'),
    whoId: z
      .string()
      .optional()
      .describe(
        'ID of the related Contact or Lead (the "Name" relation on the task)',
      ),
    whatId: z
      .string()
      .optional()
      .describe(
        'ID of the related record such as Account, Opportunity, Case, etc. (the "Related To" relation)',
      ),
    ownerId: z
      .string()
      .optional()
      .describe(
        'User ID of the task owner/assignee (defaults to current user)',
      ),
    isReminderSet: z
      .boolean()
      .optional()
      .describe('Whether to set a reminder for this task'),
    reminderDateTime: z
      .string()
      .optional()
      .describe(
        'Reminder date/time in ISO 8601 format (e.g., "2025-03-01T09:00:00.000Z")',
      ),
    fields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Additional Task fields as key-value pairs. Common fields: CallType, CallDurationInSeconds, CallDisposition, RecurrenceInterval, RecurrenceType',
      ),
  }),
  output: SaveResult,
  notes:
    'Creates a Task via GraphQL mutation. Standard Task statuses: "Not Started", "In Progress", "Completed", "Waiting on someone else", "Deferred". Standard priorities: "High", "Normal", "Low". WhoId accepts Contact or Lead IDs. WhatId accepts Account, Opportunity, Case, Campaign, or custom object IDs.',
};

export type CreateTaskInput = z.infer<typeof createTaskSchema.input>;
export type CreateTaskOutput = z.infer<typeof createTaskSchema.output>;

export const updateTaskSchema = {
  name: 'updateTask',
  description:
    'Update an existing task fields (status, priority, subject, description, due date, etc.)',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    taskId: z.string().describe('Salesforce Task ID to update'),
    fields: z
      .record(z.string(), z.unknown())
      .describe(
        'Fields to update as key-value pairs. Common fields: Subject, Status ("Not Started", "In Progress", "Completed", "Waiting on someone else", "Deferred"), Priority ("High", "Normal", "Low"), ActivityDate (YYYY-MM-DD), Description, WhoId, WhatId, OwnerId, IsReminderSet, ReminderDateTime',
      ),
  }),
  output: SaveResult,
  notes:
    'Updates a Task via GraphQL mutation. Pass only the fields you want to change. Field names use Salesforce API names (PascalCase).',
};

export type UpdateTaskInput = z.infer<typeof updateTaskSchema.input>;
export type UpdateTaskOutput = z.infer<typeof updateTaskSchema.output>;

export const deleteTaskSchema = {
  name: 'deleteTask',
  description: 'Delete a task by ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    taskId: z.string().describe('Salesforce Task ID to delete'),
  }),
  output: DeleteResult,
  notes: '',
};

export type DeleteTaskInput = z.infer<typeof deleteTaskSchema.input>;
export type DeleteTaskOutput = z.infer<typeof deleteTaskSchema.output>;

export const createNoteSchema = {
  name: 'createNote',
  description: 'Create a ContentNote (rich text note) in Salesforce',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    title: z.string().describe('Note title (required)'),
    content: z.string().describe('Note body text (required)'),
    sharingPrivacy: z
      .enum(['N', 'P'])
      .optional()
      .describe(
        'Note privacy on records. N = Visible to Anyone With Record Access (default), P = Private on Records',
      ),
    ownerId: z
      .string()
      .optional()
      .describe(
        'Salesforce User ID to set as note owner (defaults to current user)',
      ),
    fields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Additional ContentNote fields'),
  }),
  output: z.object({
    id: z.string().describe('ID of the created ContentNote'),
    record: z
      .object({
        Id: z.string(),
        Title: z.string(),
        Content: z.string().describe('Base64-encoded rich text content'),
        LatestContentId: z.string().describe('Content version ID'),
        LatestPublishedVersionId: z
          .string()
          .describe('Published content version ID'),
      })
      .passthrough()
      .describe('Full ContentNote record with flattened field values'),
  }),
  notes:
    'Creates a Salesforce ContentNote. Content is stored as rich text; Salesforce may strip or escape HTML-special characters. To link the note to a record (Account, Contact, etc.), call linkNoteToRecord() with the returned ID.',
};

// ============================================================================
// Events
// ============================================================================

export const listEventsSchema = {
  name: 'listEvents',
  description: 'List events (meetings, calls) with pagination',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 25)'),
    page: z
      .number()
      .optional()
      .describe('Page number, zero-indexed (default 0)'),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field name to sort by, e.g. "StartDateTime", "Subject", "CreatedDate". Prefix with "-" for descending, e.g. "-StartDateTime".',
      ),
    filterName: z
      .string()
      .optional()
      .describe(
        'List view API name, e.g. "Recent", "__Recent". The SelectableListDataProvider controller may ignore this parameter and return all records regardless of filter value.',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe(
        'Server-side search/filter term. Passed to getItems but may not filter results for Event; the SelectableListDataProvider does not support search for all sObject types.',
      ),
    layoutType: z
      .enum(['FULL', 'COMPACT', 'SEARCH'])
      .optional()
      .describe(
        'Layout type for field selection. FULL returns all fields (~30) including Description, Attendees, ShowAs. COMPACT returns key fields (~15) including Subject, Location, StartDateTime. SEARCH returns list-optimized fields (~22) including Owner, Who, What. Default: FULL.',
      ),
    enableRowActions: z
      .boolean()
      .optional()
      .describe(
        'When true, each event includes an actions array with available row-level actions (e.g. Edit, Delete). Default: false.',
      ),
    useTimeout: z
      .boolean()
      .optional()
      .describe(
        'When true, the server applies a timeout to the list query. Useful for large datasets where the query may take a long time. Default: false.',
      ),
  }),
  output: z.object({
    totalCount: z.number().describe('Total number of events'),
    events: z
      .array(SObjectRecord)
      .describe(
        'Array of event records. Fields vary by layoutType: FULL includes Subject, Location, StartDateTime, EndDateTime, Description, Attendees, ShowAs, IsAllDayEvent, IsPrivate, Owner, Who, What, CreatedBy, LastModifiedBy, and formatted date variants (__f, __l suffixes) (~30 fields). COMPACT includes Subject, Location, StartDateTime, EndDateTime, Owner (~14 fields). SEARCH includes Subject, StartDateTime, Owner.Alias (~22 fields). When enableRowActions=true, each record also includes an actions array with objects containing label (e.g. "Edit", "Delete"), devNameOrId, url, icon, actionTypeEnum, and pageReference.',
      ),
  }),
  notes:
    'Uses SelectableListDataProviderController/getItems. For Event creation/update, use createEvent and updateEvent.',
};

export const getEventSchema = {
  name: 'getEvent',
  description: 'Get a single event by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    eventId: z.string().describe('Salesforce Event ID'),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type. FULL returns all fields from the page layout, COMPACT returns only the compact layout fields (Subject, Location, StartDateTime, EndDateTime, etc.). Default: FULL',
      ),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE'])
      .optional()
      .describe(
        'Record mode. VIEW returns read-only data, EDIT returns data with recordLayout metadata for form rendering, CREATE returns a template for new record creation. Default: VIEW',
      ),
  }),
  output: SObjectRecord,
};

export const createEventSchema = {
  name: 'createEvent',
  description:
    'Create a calendar event (meeting, appointment) with subject, start/end times, location, and related records',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    subject: z.string().describe('Event subject/title (required)'),
    startDateTime: z
      .string()
      .describe(
        'Event start date/time in ISO 8601 format (e.g., "2025-03-01T14:00:00.000Z"). Required.',
      ),
    endDateTime: z
      .string()
      .describe(
        'Event end date/time in ISO 8601 format (e.g., "2025-03-01T15:00:00.000Z"). Required.',
      ),
    location: z.string().optional().describe('Event location'),
    description: z.string().optional().describe('Event description/notes'),
    whoId: z
      .string()
      .optional()
      .describe(
        'ID of the related Contact or Lead (the "Name" relation on the event)',
      ),
    whatId: z
      .string()
      .optional()
      .describe(
        'ID of the related record such as Account, Opportunity, Case, etc. (the "Related To" relation)',
      ),
    ownerId: z
      .string()
      .optional()
      .describe('User ID of the event owner (defaults to current user)'),
    isAllDayEvent: z
      .boolean()
      .optional()
      .describe(
        'Whether this is an all-day event. When true, StartDateTime and EndDateTime should be date-only (YYYY-MM-DD).',
      ),
    showAs: z
      .enum(['Busy', 'OutOfOffice', 'Free'])
      .optional()
      .describe('Calendar availability display. Default: Busy'),
    isPrivate: z
      .boolean()
      .optional()
      .describe('Whether the event is private (only visible to the owner)'),
    isReminderSet: z
      .boolean()
      .optional()
      .describe('Whether to set a reminder for this event'),
    reminderDateTime: z
      .string()
      .optional()
      .describe('Reminder date/time in ISO 8601 format'),
    fields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Additional Event fields as key-value pairs. Common fields: RecurrenceInterval, RecurrenceType, IsRecurrence',
      ),
  }),
  output: SaveResult,
  notes:
    'Creates an Event via GraphQL mutation. ShowAs values: "Busy", "OutOfOffice", "Free". For all-day events, set isAllDayEvent=true and use date-only format for start/end. WhoId accepts Contact or Lead IDs. WhatId accepts Account, Opportunity, Case, or custom object IDs.',
};

export type CreateEventInput = z.infer<typeof createEventSchema.input>;
export type CreateEventOutput = z.infer<typeof createEventSchema.output>;

export const updateEventSchema = {
  name: 'updateEvent',
  description:
    "Update an existing event's fields (subject, times, location, etc.)",
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    eventId: z.string().describe('Salesforce Event ID to update'),
    fields: z
      .record(z.string(), z.unknown())
      .describe(
        'Fields to update as key-value pairs. Common fields: Subject, StartDateTime (ISO 8601), EndDateTime (ISO 8601), Location, Description, WhoId, WhatId, OwnerId, IsAllDayEvent, ShowAs ("Busy", "OutOfOffice", "Free"), IsPrivate, IsReminderSet, ReminderDateTime',
      ),
  }),
  output: SaveResult,
  notes:
    'Updates an Event via GraphQL mutation. Pass only the fields you want to change. Field names use Salesforce API names (PascalCase).',
};

export type UpdateEventInput = z.infer<typeof updateEventSchema.input>;
export type UpdateEventOutput = z.infer<typeof updateEventSchema.output>;

export const logCallSchema = {
  name: 'logCall',
  description:
    'Log a completed phone call activity linked to a contact, lead, or account',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    subject: z
      .string()
      .describe('Call subject (required, e.g., "Call with John Smith")'),
    description: z
      .string()
      .optional()
      .describe('Call notes/comments describing what was discussed'),
    whoId: z.string().optional().describe('ID of the related Contact or Lead'),
    whatId: z
      .string()
      .optional()
      .describe('ID of the related Account, Opportunity, Case, etc.'),
    activityDate: z
      .string()
      .optional()
      .describe('Date of the call in YYYY-MM-DD format (defaults to today)'),
    status: z
      .enum([
        'Not Started',
        'In Progress',
        'Completed',
        'Waiting on someone else',
        'Deferred',
      ])
      .optional()
      .describe(
        'Task status. Default: Completed (since calls are typically logged after they happen)',
      ),
    priority: z
      .enum(['High', 'Normal', 'Low'])
      .optional()
      .describe('Priority. Default: Normal'),
    callDurationInSeconds: z
      .number()
      .optional()
      .describe('Call duration in seconds'),
    callDisposition: z
      .string()
      .optional()
      .describe(
        'Call outcome/disposition (e.g., "Left Message", "Connected", "No Answer")',
      ),
    callType: z
      .enum(['Inbound', 'Outbound', 'Internal'])
      .optional()
      .describe('Whether the call was inbound, outbound, or internal'),
  }),
  output: SaveResult,
  notes:
    'Creates a Task record with TaskSubtype="Call". The logged call appears in the Activity Timeline on the related record. Status defaults to "Completed" since calls are typically logged after they occur.',
};

export type LogCallInput = z.infer<typeof logCallSchema.input>;
export type LogCallOutput = z.infer<typeof logCallSchema.output>;

export const logEmailSchema = {
  name: 'logEmail',
  description: 'Log an email activity linked to a contact, lead, or account',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    subject: z.string().describe('Email subject line (required)'),
    description: z.string().optional().describe('Email body text or summary'),
    whoId: z
      .string()
      .optional()
      .describe('ID of the related Contact or Lead (the email recipient)'),
    whatId: z
      .string()
      .optional()
      .describe('ID of the related Account, Opportunity, Case, etc.'),
    activityDate: z
      .string()
      .optional()
      .describe('Date of the email in YYYY-MM-DD format (defaults to today)'),
    status: z
      .enum([
        'Not Started',
        'In Progress',
        'Completed',
        'Waiting on someone else',
        'Deferred',
      ])
      .optional()
      .describe('Task status. Default: Completed'),
    priority: z
      .enum(['High', 'Normal', 'Low'])
      .optional()
      .describe('Priority. Default: Normal'),
  }),
  output: SaveResult,
  notes:
    'Creates a Task record with TaskSubtype="Email". The logged email appears in the Activity Timeline on the related record. Status defaults to "Completed" since emails are typically logged after being sent.',
};

export type LogEmailInput = z.infer<typeof logEmailSchema.input>;
export type LogEmailOutput = z.infer<typeof logEmailSchema.output>;

// ============================================================================
// ContentDocumentLink
// ============================================================================

export const linkNoteToRecordSchema = {
  name: 'linkNoteToRecord',
  description:
    'Link a ContentNote or file to a record (contact, account, opportunity, etc.)',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    contentDocumentId: z
      .string()
      .describe('ContentNote ID from createNote() result (the id field)'),
    linkedEntityId: z
      .string()
      .describe(
        'ID of the record to link to (Contact, Account, Opportunity, etc.)',
      ),
    shareType: z
      .enum(['V', 'C', 'I'])
      .optional()
      .describe(
        'Permission level: "V" for Viewer (default), "C" for Collaborator, "I" for Inferred. Availability depends on org sharing settings.',
      ),
    visibility: z
      .enum(['AllUsers', 'InternalUsers', 'SharedUsers'])
      .optional()
      .describe(
        'Visibility: "AllUsers" (default), "InternalUsers" (standard users only), or "SharedUsers"',
      ),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe(
        'Allow creating the link even if a duplicate detection rule matches. Defaults to false.',
      ),
  }),
  output: z.object({
    id: z.string().describe('ID of the created ContentDocumentLink'),
  }),
  notes:
    'Creates a ContentDocumentLink junction record. First create a note with createNote(), then pass its id as contentDocumentId. The linkedEntityId is any record ID (Lead, Account, Contact, Opportunity, Case, etc.). A note can be linked to multiple records. Attempting to link the same note to the same record twice will error.',
};

// ============================================================================
// Campaigns
// ============================================================================

export const listCampaignsSchema = {
  name: 'listCampaigns',
  description:
    'List campaigns with pagination, sorting, searching, and list view filtering via the ListUi API',
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
        'List view API name to filter by (default "AllActiveCampaigns"). Standard views: "AllActiveCampaigns", "AllCampaigns", "MyActiveCampaigns", "__Recent".',
      ),
    sortBy: z
      .array(z.string())
      .optional()
      .describe(
        'Array of field paths to sort by, e.g. ["Campaign.Name"]. Prefix with "-" for descending, e.g. ["-Campaign.Name"].',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe(
        'Search term to filter records within the list view (minimum 2 characters)',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Server-side field selection passed to the Salesforce ListUi SOQL query. Use dot notation, e.g. ["Campaign.Id", "Campaign.Name", "Campaign.Status"]. Id is always included. Invalid field names cause a Salesforce INVALID_FIELD SOQL error. When omitted, default fields are returned.',
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
        'Additional fields to return if available, in Object.Field format (e.g. ["Campaign.Description", "Campaign.ExpectedRevenue"]). Unlike fields, does not error if the field does not exist on the object.',
      ),
    where: z
      .string()
      .optional()
      .describe(
        "SOQL-like filter expression for server-side filtering. Syntax: {FieldName:{operator:'value'}}. Operators: eq, ne, gt, lt, gte, lte, like, in, nin. Example: \"{Type:{eq:'Email'}}\" or \"{Status:{in:['Planned','In Progress']}}\".",
      ),
  }),
  output: z.object({
    count: z
      .number()
      .describe(
        'Number of records returned on the current page (NOT the total matching count; this API does not expose total count). To determine if more records exist, check nextPageToken.',
      ),
    campaigns: z.array(SObjectRecord).describe('Array of campaign records'),
    nextPageToken: z
      .string()
      .nullable()
      .describe('Token for fetching the next page, null if no more pages'),
    previousPageToken: z
      .string()
      .nullable()
      .describe('Token for fetching the previous page, null if on first page'),
    currentPageToken: z
      .string()
      .nullable()
      .describe('Token representing the current page position'),
  }),
};

export const getCampaignSchema = {
  name: 'getCampaign',
  description: 'Get a single campaign by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    campaignId: z.string().describe('Salesforce Campaign ID'),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type for field selection. FULL returns all fields (~47), COMPACT returns key fields (~21). Default: FULL',
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
        'Specific fields to fetch (e.g. ["Campaign.Name", "Campaign.Status"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["Campaign.Description", "Campaign.ExpectedRevenue"]). Non-existent fields are silently omitted. Uses RecordUiController/getRecordWithFields when specified',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["CampaignMembers"]). Returns paginated child records for each relationship. Only works when fields or optionalFields are specified (uses RecordUiController/getRecordWithFields)',
      ),
  }),
  output: SObjectRecord,
};

export const createCampaignSchema = {
  name: 'createCampaign',
  description: 'Create a new campaign',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    name: z.string().describe('Campaign name (required)'),
    status: z
      .enum(['Planned', 'In Progress', 'Completed', 'Aborted'])
      .optional()
      .describe('Campaign status. Defaults to "Planned" if omitted'),
    type: z
      .enum([
        'Advertisement',
        'Email',
        'Telemarketing',
        'Banner Ads',
        'Seminar / Conference',
        'Public Relations',
        'Partners',
        'Referral Program',
        'Other',
      ])
      .optional()
      .describe('Campaign type'),
    isActive: z.boolean().optional().describe('Whether the campaign is active'),
    description: z.string().optional().describe('Campaign description'),
    startDate: z
      .string()
      .optional()
      .describe('Campaign start date in YYYY-MM-DD format'),
    endDate: z
      .string()
      .optional()
      .describe('Campaign end date in YYYY-MM-DD format'),
    expectedRevenue: z
      .number()
      .optional()
      .describe('Expected revenue from the campaign'),
    budgetedCost: z
      .number()
      .optional()
      .describe('Budgeted cost for the campaign'),
    actualCost: z.number().optional().describe('Actual cost of the campaign'),
    numberSent: z
      .number()
      .optional()
      .describe('Number of individuals sent/targeted'),
    expectedResponse: z
      .number()
      .optional()
      .describe('Expected response rate as a percentage (0-100)'),
    parentId: z
      .string()
      .optional()
      .describe('Parent Campaign ID for campaign hierarchy'),
    fields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Additional campaign fields beyond the explicit parameters above (e.g. custom fields)',
      ),
  }),
  output: SaveResult,
};

export type CreateCampaignInput = z.infer<typeof createCampaignSchema.input>;

export const updateCampaignSchema = {
  name: 'updateCampaign',
  description:
    'Update an existing campaign. Pass field API names in PascalCase (e.g. Name, Status, Type, IsActive, Description, StartDate, EndDate). Set a field to null to clear it.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    campaignId: z.string().describe('Salesforce Campaign ID'),
    fields: z
      .record(z.string(), z.unknown())
      .describe(
        'Fields to update in PascalCase API names (at least one required). Examples: Name, Status, Type, IsActive, Description, StartDate, EndDate, ExpectedRevenue, BudgetedCost, ActualCost, NumberSent, ExpectedResponse, ParentId, OwnerId. Set a value to null to clear it.',
      ),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe('Save even if duplicate rules match (default false)'),
    ifUnmodifiedSince: z
      .string()
      .optional()
      .describe(
        'Optimistic concurrency: only update if record unmodified since this HTTP-date (e.g. "Thu, 05 Feb 2026 06:30:55 GMT")',
      ),
    triggerOtherEmail: z
      .boolean()
      .optional()
      .describe('Fire workflow email notifications on update (default false)'),
    triggerUserEmail: z
      .boolean()
      .optional()
      .describe('Fire user email notifications on update (default false)'),
    useDefaultRule: z
      .boolean()
      .optional()
      .describe('Use default assignment rule when updating (default false)'),
    recordTypeId: z
      .string()
      .optional()
      .describe('Record type ID to apply for the response layout'),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe('Layout type for the returned record (default FULL)'),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE'])
      .optional()
      .describe('Mode for the returned record layout (default VIEW)'),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Additional fields to include in the response (e.g. ["Campaign.NumberOfLeads", "Campaign.NumberOfContacts"])',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationships to include in the response (e.g. ["CampaignMembers", "Opportunities"])',
      ),
  }),
  output: SaveResult,
};

export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema.input>;

export const deleteCampaignSchema = {
  name: 'deleteCampaign',
  description:
    'Delete a campaign by ID. The campaignId must be a valid Campaign record ID (prefix 701). Non-Campaign IDs will be rejected.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    campaignId: z
      .string()
      .describe('Salesforce Campaign ID (must start with 701)'),
  }),
  output: DeleteResult,
};

// ============================================================================
// Products
// ============================================================================

export const listProductsSchema = {
  name: 'listProducts',
  description:
    'List products with pagination, sorting, searching, and list view filtering via the ListUi API',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z
      .number()
      .optional()
      .describe('Results per page (default 25, range 1-2000).'),
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
        'List view API name to filter by (default "AllProducts"). Standard views: "AllProducts", "__Recent".',
      ),
    sortBy: z
      .array(z.string())
      .optional()
      .describe(
        'Array of field paths to sort by, e.g. ["Product2.Name"]. Prefix with "-" for descending, e.g. ["-Product2.Name"]. Supports multi-field sorting, e.g. ["Product2.IsActive", "-Product2.Name"].',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe(
        'Search term to filter records within the list view (minimum 2 characters)',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Restrict output to specific fields (client-side filter). Use dot notation, e.g. ["Product2.Id", "Product2.Name", "Product2.ProductCode"]. Id is always included. When omitted, all default fields are returned.',
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
        'Additional fields to return if available, in Object.Field format (e.g. ["Product2.Description", "Product2.StockKeepingUnit"]). Unlike fields, does not error if the field does not exist on the object.',
      ),
    where: z
      .string()
      .optional()
      .describe(
        'Serialized JSON filter for server-side filtering. Supports operators: eq, ne, like (SQL LIKE with %), in, nin, gt, gte, lt, lte (string/numeric fields only; datetime fields return 400). Logical combinators: and, or, not (lowercase only). Examples: \'{"Name":{"like":"Test%"}}\', \'{"IsActive":{"eq":true}}\', \'{"ProductCode":{"ne":null}}\', \'{"or":[{"Name":{"like":"Test%"}},{"Name":{"like":"PBE%"}}]}\', \'{"and":[{"Name":{"like":"Test%"}},{"IsActive":{"eq":true}}]}\', \'{"not":{"Name":{"like":"Test%"}}}\'.',
      ),
  }),
  output: z.object({
    count: z
      .number()
      .describe(
        'Number of records returned on this page (NOT total across all pages). Use nextPageToken to check for more.',
      ),
    products: z.array(SObjectRecord).describe('Array of product records'),
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
};

export const getProductSchema = {
  name: 'getProduct',
  description: 'Get a single product by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    productId: z.string().describe('Salesforce Product ID'),
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
        'Record mode. VIEW returns read-only data, EDIT returns data with recordLayout metadata for form rendering, CREATE returns a template for new record creation. Default: VIEW',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch (e.g. ["Product2.Name", "Product2.ProductCode"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format. Errors if a field does not exist.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["Product2.Family", "Product2.StockKeepingUnit"]). Non-existent fields are silently omitted. Uses RecordUiController/getRecordWithFields when specified.',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["PricebookEntries", "Assets"]). Returns paginated child records for each relationship. Requires fields or optionalFields. Uses RecordUiController/getRecordWithFields.',
      ),
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Salesforce Record Type ID (e.g. "012000000000000AAA"). Controls which record type layout is used for field selection. Useful in orgs with multiple record types.',
      ),
    pageSize: z
      .number()
      .optional()
      .describe(
        'Number of child records to return per child relationship. Default: 5. Only applies when childRelationships is specified.',
      ),
  }),
  output: SObjectRecord,
};
export type GetProductInput = z.infer<typeof getProductSchema.input>;
export type GetProductOutput = z.infer<typeof getProductSchema.output>;

export const createProductSchema = {
  name: 'createProduct',
  description: 'Create a new product',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    name: z.string().describe('Product name (required)'),
    productCode: z
      .string()
      .optional()
      .describe('Product code (e.g. "PROD-001")'),
    description: z.string().optional().describe('Product description text'),
    isActive: z
      .boolean()
      .optional()
      .describe('Whether the product is active (default false)'),
    family: z
      .string()
      .optional()
      .describe(
        'Product family picklist value (org-configurable, e.g. "None")',
      ),
    stockKeepingUnit: z.string().optional().describe('Product SKU identifier'),
    quantityUnitOfMeasure: z
      .string()
      .optional()
      .describe('Quantity unit of measure (e.g. "Each")'),
    displayUrl: z
      .string()
      .optional()
      .describe('External display URL for the product'),
    externalId: z
      .string()
      .optional()
      .describe('External system identifier for the product'),
    fields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Additional product fields. Known field names: Type (Base|Bundle|Set), ProductPurpose (Sell|Plan|Purchase|GiftWrap), ExternalDataSourceId, TaxPolicyId, CurrencyIsoCode (multi-currency orgs only), CanUseQuantitySchedule (boolean), CanUseRevenueSchedule (boolean), NumberOfQuantityInstallments (integer), QuantityInstallmentPeriod (Daily|Weekly|Monthly|Quarterly|Yearly), QuantityScheduleType (Divide|Repeat), NumberOfRevenueInstallments (integer), RevenueInstallmentPeriod (Daily|Weekly|Monthly|Quarterly|Yearly), RevenueScheduleType (Divide|Repeat).',
      ),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe('Save even if duplicate rules match (default false)'),
    triggerOtherEmail: z
      .boolean()
      .optional()
      .describe(
        'Trigger workflow email notifications to non-owners (default true)',
      ),
    triggerUserEmail: z
      .boolean()
      .optional()
      .describe(
        'Trigger email notification to the record owner (default true)',
      ),
    useDefaultRule: z
      .boolean()
      .optional()
      .describe('Apply the default assignment rule when creating the record'),
    assignmentRuleId: z
      .string()
      .optional()
      .describe(
        'ID of a specific assignment rule to apply (alternative to useDefaultRule). Obtain IDs by querying the AssignmentRule sObject.',
      ),
    triggerAutoResponseEmail: z
      .boolean()
      .optional()
      .describe('Trigger auto-response email rules when creating the record'),
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Record type ID to use for the new product (for orgs with multiple product record types)',
      ),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type controlling which fields are returned in the response (default FULL)',
      ),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE'])
      .optional()
      .describe(
        'Operation mode controlling which fields are returned in the response',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Additional fields to include in the response if available, in Object.Field format (e.g. ["Product2.CanUseQuantitySchedule", "Product2.CurrencyIsoCode"]). Non-existent fields are silently omitted.',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include in the response (e.g. ["Product2.PricebookEntries"])',
      ),
  }),
  output: SaveResult,
};

export const updateProductSchema = {
  name: 'updateProduct',
  description: 'Update an existing product',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    productId: z.string().describe('Salesforce Product ID'),
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
        'Optimistic concurrency: only update if record unmodified since this HTTP-date (e.g. "Thu, 05 Feb 2026 06:30:55 GMT")',
      ),
  }),
  output: SaveResult,
};

export const deleteProductSchema = {
  name: 'deleteProduct',
  description: 'Delete a product by ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    productId: z.string().describe('Salesforce Product ID'),
  }),
  output: DeleteResult,
};

// ============================================================================
// Users
// ============================================================================

export const listUsersSchema = {
  name: 'listUsers',
  description: 'List users in the Salesforce org with pagination',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 25)'),
    page: z
      .number()
      .optional()
      .describe(
        'Page number, 1-indexed (default 1). Page 1 is the first page.',
      ),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field API name to sort by (e.g. "Name", "Email", "CreatedDate", "LastModifiedDate"). Prefix with "-" for descending (e.g. "-Name")',
      ),
    filterName: z
      .string()
      .optional()
      .describe(
        'List view API name to filter by. Standard views: "AllUsers", "ActiveUsers", "__Recent".',
      ),
    layoutType: z
      .enum(['FULL', 'COMPACT', 'SEARCH'])
      .optional()
      .describe(
        'Layout type controlling which fields are returned. FULL returns all standard fields (~24). COMPACT returns key fields plus SmallPhotoUrl and IsActive (~13). SEARCH returns a subset with OutOfOfficeMessage and SmallPhotoUrl (~12). Default FULL.',
      ),
  }),
  output: z.object({
    totalCount: z.number().describe('Total number of users'),
    users: z
      .array(SObjectRecord)
      .describe(
        'Array of user records. FULL layout fields: Id, Name, FirstName, LastName, Email, Phone, MobilePhone, Title, CompanyName, AboutMe, City, Street, StateCode, StateCode__l, PostalCode, CountryCode, CountryCode__l, Manager, ManagerId, LastModifiedDate, LastModifiedById, CreatedDate, SystemModstamp, sobjectType. COMPACT layout fields: Id, Name, FirstName, LastName, Title, CompanyName, SmallPhotoUrl, IsActive, LastModifiedDate, LastModifiedById, CreatedDate, SystemModstamp, sobjectType. SEARCH layout fields: Id, Name, Email, Phone, Title, SmallPhotoUrl, OutOfOfficeMessage, LastModifiedDate, LastModifiedById, CreatedDate, SystemModstamp, sobjectType.',
      ),
  }),
};

export const getUserSchema = {
  name: 'getUser',
  description: 'Get a single user by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    userId: z.string().describe('Salesforce User ID'),
    layoutType: z
      .enum(['FULL', 'COMPACT', 'SEARCH'])
      .optional()
      .describe(
        'Layout type for field selection. FULL returns all standard fields (~30). COMPACT returns key fields plus SmallPhotoUrl and IsActive (~19). SEARCH returns a subset with OutOfOfficeMessage, Phone, and SmallPhotoUrl (~18). Default: FULL',
      ),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE', 'INLINE_EDIT', 'CLONE', 'DEFAULT'])
      .optional()
      .describe(
        'Record mode. VIEW returns read-only data with formatted display values. EDIT returns editable fields including Address components (City, Street, PostalCode, StateCode, CountryCode). CREATE returns a template with writable fields only (no Id or timestamps). INLINE_EDIT returns fields optimized for inline editing. CLONE returns fields pre-populated from the source record for cloning. DEFAULT returns server-default field set. Default: VIEW',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch (e.g. ["User.Name", "User.Email"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format. Errors if a field does not exist.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["User.Department", "User.AboutMe"]). Non-existent fields are silently omitted. Uses RecordUiController/getRecordWithFields when specified.',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["OwnedContentDocuments"]). Returns paginated child records for each relationship. Only works when fields or optionalFields are specified (uses RecordUiController/getRecordWithFields).',
      ),
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Record type ID to filter fields by record type layout (e.g. "012000000000000AAA" for master record type)',
      ),
    pageSize: z
      .number()
      .optional()
      .describe(
        'Number of child relationship records to return per relationship when childRelationships is specified. Only applies when using RecordUiController/getRecordWithFields (i.e. when fields or optionalFields are provided). Server default is 5.',
      ),
    pageToken: z
      .string()
      .optional()
      .describe(
        'Pagination cursor for child relationship results. Obtained from currentPageToken or nextPageToken in a previous response. Only applies when childRelationships is specified.',
      ),
    updateMru: z
      .boolean()
      .optional()
      .describe(
        'Whether viewing this record updates the "Most Recently Used" list. Set to false to avoid polluting the user\'s recent items when programmatically fetching records. Default: server default (typically true)',
      ),
    layoutTypes: z
      .array(z.enum(['FULL', 'COMPACT']))
      .optional()
      .describe(
        'Layout types for the RecordUiController path. Provides layout context when fetching with fields/optionalFields. Only used when fields or optionalFields are specified.',
      ),
    modes: z
      .array(
        z.enum(['VIEW', 'EDIT', 'CREATE', 'INLINE_EDIT', 'CLONE', 'DEFAULT']),
      )
      .optional()
      .describe(
        'Mode context array for the RecordUiController path. Provides mode context when fetching with fields/optionalFields. Only used when fields or optionalFields are specified.',
      ),
    defaultFieldValues: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Pre-populated field values for CREATE or EDIT mode (e.g. {"Title": "Manager"}). Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    navigationLocation: z
      .enum(['DETAIL', 'LIST', 'RELATED_LIST', 'LOOKUP'])
      .optional()
      .describe(
        'Context about where the user navigated from. Affects layout resolution. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    inContextOfComponent: z
      .string()
      .optional()
      .describe(
        'Salesforce Lightning component context for layout resolution (e.g. "force:detailPanel", "force:highlights"). Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    entityApiNameOrKeyPrefix: z
      .string()
      .optional()
      .describe(
        'Entity API name or key prefix (e.g. "User"). Provides entity context for the DetailController when loading CLONE or CREATE records. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    layoutOverride: z
      .string()
      .optional()
      .describe(
        'Layout override identifier. Overrides the default page layout for the record. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    changeRecordType: z
      .boolean()
      .optional()
      .describe(
        'Whether to allow record type change during CLONE or CREATE mode. When true, the returned layout includes record type selection metadata. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    record: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional()
      .describe(
        'Pre-loaded record object to pass to the DetailController, avoiding a redundant server fetch. The UI sends null when no cached record is available. When provided, the server merges the record data with the layout. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    offset: z
      .number()
      .optional()
      .describe(
        'Pagination offset for record layout data. The native UI sends 0. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    stencilOverride: z
      .string()
      .optional()
      .describe(
        'Override the stencil template used for rendering the record layout. Common values: "force:highlightsStencilDesktop" (used with COMPACT layout in highlights panel). Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    isCreateOrClone: z
      .boolean()
      .optional()
      .describe(
        'When true, indicates a create or clone operation. Combined with CLONE or CREATE mode, causes the server to return all writable fields instead of the standard layout field set. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    isCloneWithRelated: z
      .boolean()
      .optional()
      .describe(
        'When true, includes related child records in clone operations. Only meaningful when isCreateOrClone is true and mode is CLONE. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
  }),
  output: SObjectRecord,
};

export type GetUserInput = z.infer<typeof getUserSchema.input>;
export type GetUserOutput = z.infer<typeof getUserSchema.output>;

// ============================================================================
// Reports & Dashboards
// ============================================================================

export const listReportsSchema = {
  name: 'listReports',
  description:
    'List reports in the Salesforce org with pagination, filtering by view scope, folder, and sorting',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 20)'),
    page: z.number().optional().describe('Page number, 1-indexed (default 1)'),
    navScope: z
      .enum([
        'mru',
        'everything',
        'created',
        'mine',
        'organizationOwned',
        'favoriteItems',
        'userFolders',
        'userFoldersCreatedByMe',
        'userFoldersSharedWithMe',
      ])
      .optional()
      .describe(
        'Report view scope: mru = recently used, everything = all reports, created = created by me, mine = private reports, organizationOwned = public reports, favoriteItems = favorites, userFolders = all folders, userFoldersCreatedByMe = folders created by me, userFoldersSharedWithMe = shared folders (default everything)',
      ),
    orderBy: z
      .string()
      .optional()
      .describe(
        'Sort field name. Prefix with - for descending (e.g. -CreatedDate). Common values: Name, Description, FolderName, CreatedBy.Name, CreatedDate, LastModifiedBy.Name, LastModifiedDate, LastRunDate',
      ),
    folderId: z
      .string()
      .optional()
      .describe(
        'Filter reports by a specific folder ID (e.g. 00lal000007cAf3AAE)',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe(
        'Search term to filter reports by name (server-side filtering)',
      ),
  }),
  output: z.object({
    totalCount: z.number().describe('Total number of reports'),
    reports: z.array(SObjectRecord).describe('Array of report records'),
  }),
};

export const listDashboardsSchema = {
  name: 'listDashboards',
  description:
    'List dashboards in the Salesforce org with pagination, filtering by view scope, folder, and sorting',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 20)'),
    page: z
      .number()
      .optional()
      .describe('Page number, zero-indexed (default 0)'),
    navScope: z
      .enum([
        'mru',
        'everything',
        'created',
        'mine',
        'userFolders',
        'userFoldersSharedWithMe',
        'favoriteItems',
      ])
      .optional()
      .describe(
        'Dashboard view scope: mru = recently used, everything = all dashboards, created = created by me, mine = private dashboards, userFolders = all folders, userFoldersSharedWithMe = shared folders, favoriteItems = favorites (default everything)',
      ),
    orderBy: z
      .string()
      .optional()
      .describe(
        'Sort field name. Prefix with - for descending (e.g. "-CreatedDate"). Common values: Title, FolderName, CreatedBy.Name, CreatedDate',
      ),
    folderId: z
      .string()
      .optional()
      .describe(
        'Filter dashboards by a specific folder ID (e.g. 00lal000007c9YpAAI)',
      ),
  }),
  output: z.object({
    totalCount: z.number().describe('Total number of dashboards'),
    dashboards: z.array(SObjectRecord).describe('Array of dashboard records'),
  }),
};

// ============================================================================
// Commerce
// ============================================================================

const StrikethroughPricebook = z
  .object({
    Id: z.string().describe('Pricebook ID'),
    Name: z.string().describe('Pricebook name'),
    sobjectType: z.string().describe('Always "Pricebook2"'),
  })
  .passthrough();

const CommerceChannelRecord = z
  .object({
    Id: z.string().describe('Salesforce record ID'),
    Name: z.string().describe('Store/channel name'),
    Description: z.string().nullable().describe('Store description'),
    Country: z.string().describe('Country code (e.g. "US")'),
    Country__l: z
      .string()
      .describe('Localized country label (e.g. "United States")'),
    Country__f: z
      .string()
      .optional()
      .describe(
        'Formatted country label (detail view only, e.g. "United States")',
      ),
    DefaultLanguage: z
      .string()
      .describe('Default language code (e.g. "en_US")'),
    DefaultLanguage__l: z
      .string()
      .describe('Localized language label (e.g. "English")'),
    DefaultLanguage__f: z
      .string()
      .optional()
      .describe('Formatted language label (detail view only, e.g. "English")'),
    SupportedLanguages: z.string().describe('Supported language codes'),
    PricingStrategy: z
      .string()
      .describe('Pricing strategy code (e.g. "LowestPrice")'),
    PricingStrategy__l: z.string().describe('Localized pricing strategy label'),
    PricingStrategy__f: z
      .string()
      .optional()
      .describe(
        'Formatted pricing strategy label (detail view only, e.g. "Best Price")',
      ),
    SupportedShipToCountries: z
      .string()
      .describe('Supported shipping country codes'),
    StrikethroughPricebook: StrikethroughPricebook.nullable().describe(
      'Associated strikethrough pricebook, or null',
    ),
    StrikethroughPricebookId: z
      .string()
      .nullable()
      .describe('Strikethrough pricebook ID, or null'),
    CreatedDate: z.string().describe('ISO-8601 creation timestamp'),
    CreatedDate__l: z
      .string()
      .optional()
      .describe('Localized creation timestamp (e.g. "2/4/2026, 2:13 PM")'),
    CreatedDate__f: z
      .string()
      .optional()
      .describe(
        'Formatted creation timestamp (detail view only, e.g. "2/4/2026, 2:13 PM")',
      ),
    LastModifiedDate: z.string().describe('ISO-8601 last modified timestamp'),
    LastModifiedDate__l: z
      .string()
      .optional()
      .describe('Localized last modified timestamp (e.g. "2/4/2026, 2:14 PM")'),
    LastModifiedDate__f: z
      .string()
      .optional()
      .describe(
        'Formatted last modified timestamp (detail view only, e.g. "2/4/2026, 2:14 PM")',
      ),
    SystemModstamp: z
      .string()
      .describe('ISO-8601 system modification timestamp'),
    SystemModstamp__l: z
      .string()
      .optional()
      .describe(
        'Localized system modification timestamp (e.g. "2/4/2026, 2:14 PM")',
      ),
    SystemModstamp__f: z
      .string()
      .optional()
      .describe(
        'Formatted system modification timestamp (detail view only, e.g. "2/4/2026, 2:14 PM")',
      ),
    LastModifiedById: z
      .string()
      .describe('ID of user who last modified this record'),
    sobjectType: z.string().describe('Always "WebStore"'),
  })
  .passthrough();

export const listCommerceChannelsSchema = {
  name: 'listCommerceChannels',
  description: 'List all commerce channels (stores) in the org',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(2000)
      .optional()
      .describe('Results per page, integer 1-2000 (default 25)'),
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Page number, zero-indexed (default 0)'),
  }),
  output: z.object({
    totalCount: z.number().describe('Total number of commerce channels'),
    channels: z
      .array(CommerceChannelRecord)
      .describe('Array of commerce channel (WebStore) records'),
  }),
  notes:
    'Prerequisite: Navigate to any Salesforce Lightning page (*.lightning.force.com), then call getContext() to obtain auraToken and auraContext. Use the CDP cookie discovery workflow from libraryNotes to find the org URL if needed. Commerce Cloud must be enabled in the org. Returns store/channel configurations including WebStore records. pageSize over 2000 may cause Salesforce errors.',
};

export type ListCommerceChannelsInput = z.infer<
  typeof listCommerceChannelsSchema.input
>;
export type ListCommerceChannelsOutput = z.infer<
  typeof listCommerceChannelsSchema.output
>;

export const getCommerceChannelSchema = {
  name: 'getCommerceChannel',
  description: 'Get a single commerce channel (WebStore) by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    channelId: z
      .string()
      .describe('WebStore record ID from listCommerceChannels'),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type for field selection. FULL returns all fields (~27), COMPACT returns key fields (~13). Default: FULL',
      ),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE'])
      .optional()
      .describe(
        'Record mode. VIEW returns read-only data, EDIT returns data with recordLayout metadata for form rendering, CREATE returns a template with default field values. Default: VIEW',
      ),
  }),
  output: CommerceChannelRecord,
  notes:
    'Prerequisite: Navigate to any Salesforce Lightning page (*.lightning.force.com), then call getContext() to obtain auraToken and auraContext. Use the CDP cookie discovery workflow from libraryNotes to find the org URL if needed. Returns a single WebStore record with full detail including formatted/localized field variants (__l, __f suffixes). Requires Commerce Cloud to be enabled in the org.',
};

export type GetCommerceChannelInput = z.infer<
  typeof getCommerceChannelSchema.input
>;
export type GetCommerceChannelOutput = z.infer<
  typeof getCommerceChannelSchema.output
>;

export const listCommerceProductsSchema = {
  name: 'listCommerceProducts',
  description:
    'List products assigned to a specific commerce channel (store) with pagination',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    channelId: z
      .string()
      .describe(
        'WebStore record ID from listCommerceChannels; filters products to only those assigned to this store',
      ),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(2000)
      .optional()
      .describe('Results per page, integer between 1 and 2000 (default 25)'),
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Page number, zero-indexed non-negative integer (default 0)'),
  }),
  output: z.object({
    totalCount: z.number().describe('Total number of products in this store'),
    products: z
      .array(SObjectRecord)
      .describe(
        'Array of Product2 records with fields like Name, ProductCode, StockKeepingUnit, IsActive, ProductClass, Family, Description',
      ),
  }),
  notes:
    'Prerequisite: Navigate to any Salesforce Lightning page (*.lightning.force.com), then call getContext() to obtain auraToken and auraContext. Use the CDP cookie discovery workflow from libraryNotes to find the org URL if needed. Commerce Cloud must be enabled in the org. Returns only products assigned to the specified store (WebStore), not all org products. Use listCommerceChannels to get valid channelId values. Products use API name Product2 (not Product). pageSize must be an integer between 1 and 2000.',
};

export type ListCommerceProductsInput = z.infer<
  typeof listCommerceProductsSchema.input
>;
export type ListCommerceProductsOutput = z.infer<
  typeof listCommerceProductsSchema.output
>;

export const listProductCategoriesSchema = {
  name: 'listProductCategories',
  description: 'List product categories in a commerce channel with pagination',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    channelId: z
      .string()
      .describe(
        "WebStore record ID from listCommerceChannels; filters categories to only those in this store's catalog",
      ),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(2000)
      .optional()
      .describe('Results per page, integer between 1 and 2000 (default 25)'),
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Page number, zero-indexed non-negative integer (default 0)'),
  }),
  output: z.object({
    totalCount: z.number().describe('Total number of categories in this store'),
    categories: z
      .array(SObjectRecord)
      .describe(
        'Array of ProductCategory records with fields like Name, CatalogId, Catalog, ParentCategoryId, ParentCategory, IsNavigational, SortOrder, Description',
      ),
  }),
  notes:
    "Prerequisite: Navigate to any Salesforce Lightning page (*.lightning.force.com), then call getContext() to obtain auraToken and auraContext. Use the CDP cookie discovery workflow from libraryNotes to find the org URL if needed. Commerce Cloud must be enabled in the org. Returns only categories belonging to the specified store's catalog, not all org categories. Use listCommerceChannels to get valid channelId values. pageSize must be an integer between 1 and 2000.",
};

export type ListProductCategoriesInput = z.infer<
  typeof listProductCategoriesSchema.input
>;
export type ListProductCategoriesOutput = z.infer<
  typeof listProductCategoriesSchema.output
>;

export const listOrderSummariesSchema = {
  name: 'listOrderSummaries',
  description: 'List order summaries with pagination',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z
      .number()
      .optional()
      .describe('Results per page, integer between 1 and 2000 (default 25)'),
    page: z
      .number()
      .optional()
      .describe('Page number, zero-indexed (default 0)'),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field name to sort by, e.g. "OrderSummaryNumber", "CreatedDate", "TotalAmount", "Status", "OrderedDate". Prefix with "-" for descending order, e.g. "-CreatedDate".',
      ),
    filterName: z
      .string()
      .optional()
      .describe(
        'List view API name to filter results. Use "__Recent" for recently viewed records. Custom list view names are org-specific.',
      ),
    layoutType: z
      .enum(['FULL', 'COMPACT', 'SEARCH'])
      .optional()
      .describe(
        'Layout type for field selection. FULL returns all fields, COMPACT returns key fields, SEARCH returns list-optimized fields. Default: FULL.',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe('Search term to filter order summaries by keyword match.'),
    enableRowActions: z
      .boolean()
      .optional()
      .describe(
        'When true, each record includes an actions array with available row-level actions (e.g. "Edit", "Delete"). Default: false.',
      ),
    useTimeout: z
      .boolean()
      .optional()
      .describe(
        'When true, the server applies a timeout to the list query. Useful for large datasets. Default: false.',
      ),
  }),
  output: z.object({
    totalCount: z.number().describe('Total number of order summaries'),
    orderSummaries: z
      .array(SObjectRecord)
      .describe('Array of order summary records'),
  }),
  notes:
    'Prerequisite: Navigate to any Salesforce Lightning page (*.lightning.force.com), then call getContext() to obtain auraToken and auraContext. Use the CDP cookie discovery workflow from libraryNotes to find the org URL if needed. Requires Commerce Cloud (Order Management) to be enabled in the org. Returns OrderSummary records which represent the lifecycle of an order.',
};

export type ListOrderSummariesInput = z.infer<
  typeof listOrderSummariesSchema.input
>;
export type ListOrderSummariesOutput = z.infer<
  typeof listOrderSummariesSchema.output
>;

export const getOrderSummarySchema = {
  name: 'getOrderSummary',
  description: 'Get a single order summary by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    orderSummaryId: z
      .string()
      .describe(
        'Order Summary ID (must be an OrderSummary record ID, not another object type). The function validates the returned record type and throws if the ID belongs to a different object.',
      ),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type for field selection. FULL returns all fields, COMPACT returns key fields. Default: FULL',
      ),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE', 'INLINE_EDIT', 'CLONE', 'DEFAULT'])
      .optional()
      .describe(
        'Record mode context. VIEW returns standard read fields, EDIT returns editable fields with recordLayout metadata for form rendering, CREATE returns fields for new record template, INLINE_EDIT for inline editing context, CLONE for record cloning context (returns fewer clone-relevant fields), DEFAULT for default mode. Defaults to VIEW. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch (e.g. ["OrderSummary.Status", "OrderSummary.TotalAmount"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format. Errors if a field does not exist.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["OrderSummary.Description", "OrderSummary.BillingEmailAddress"]). Non-existent fields are silently omitted. Uses RecordUiController/getRecordWithFields when specified.',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["FulfillmentOrders", "OrderItemSummaries", "OrderPaymentSummaries"]). Returns paginated child records for each relationship. Only works when fields or optionalFields are specified (uses RecordUiController/getRecordWithFields). Valid relationship names for OrderSummary include: FulfillmentOrders, OrderItemSummaries, OrderDeliveryGroupSummaries, OrderPaymentSummaries, OrderAdjustmentGroupSummaries, Invoices, CreditMemos, Shipments, OrderItemAdjustmentLineItemSummaries, OrderItemTaxLineItemSummaries, OrderItemSummaryRelationships, OrderSummaryRoutingSchedules',
      ),
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Record type ID to filter fields by record type layout (e.g. "012000000000000AAA" for master record type). Passed to DetailController when using layoutType/mode, and to RecordUiController when using fields/optionalFields.',
      ),
    pageSize: z
      .number()
      .optional()
      .describe(
        'Number of child relationship records to return per relationship when childRelationships is specified. Only applies when using RecordUiController/getRecordWithFields (i.e. when fields or optionalFields are provided). Server default is 5.',
      ),
    pageToken: z
      .string()
      .optional()
      .describe(
        'Pagination cursor for child relationship results. Obtained from currentPageToken or nextPageToken in a previous response. Format: "page;pageSize;recordId;relName;fields;". Only applies when childRelationships is specified.',
      ),
    updateMru: z
      .boolean()
      .optional()
      .describe(
        'Whether viewing this record updates the "Most Recently Used" list. Set to false to avoid polluting the user\'s recent items when programmatically fetching records. Only applies to the DetailController path (when fields/optionalFields are not specified). Default: server default (typically true)',
      ),
    layoutTypes: z
      .array(z.enum(['FULL', 'COMPACT']))
      .optional()
      .describe(
        'Layout types for the RecordUiController path. Provides layout context when fetching with fields/optionalFields. Only used when fields or optionalFields are specified.',
      ),
    modes: z
      .array(
        z.enum(['VIEW', 'EDIT', 'CREATE', 'INLINE_EDIT', 'CLONE', 'DEFAULT']),
      )
      .optional()
      .describe(
        'Mode context array for the RecordUiController path. Provides mode context when fetching with fields/optionalFields. Only used when fields or optionalFields are specified.',
      ),
    defaultFieldValues: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Pre-populated field values for CREATE or EDIT mode (e.g. {"Description": "prefilled"}). Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    navigationLocation: z
      .enum(['DETAIL', 'LIST', 'RELATED_LIST', 'LOOKUP'])
      .optional()
      .describe(
        'Context about where the user navigated from. Affects layout resolution. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    inContextOfComponent: z
      .string()
      .optional()
      .describe(
        'Salesforce Lightning component context for layout resolution (e.g. "force:detailPanel", "force:highlights"). Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    entityApiNameOrKeyPrefix: z
      .string()
      .optional()
      .describe(
        'Entity API name or key prefix (e.g. "OrderSummary"). Provides entity context for the DetailController when loading CLONE or CREATE records. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    layoutOverride: z
      .string()
      .optional()
      .describe(
        'Layout override identifier. Overrides the default page layout for the record. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    changeRecordType: z
      .boolean()
      .optional()
      .describe(
        'Whether to allow record type change during CLONE or CREATE mode. When true, the returned layout includes record type selection metadata. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
  }),
  output: SObjectRecord,
  notes:
    'Prerequisite: Navigate to any Salesforce Lightning page (*.lightning.force.com), then call getContext() to obtain auraToken and auraContext. Requires Commerce Cloud (Order Management) to be enabled in the org. OrderSummary records are created automatically when orders are placed through a storefront or via the Create Order Summary Connect API action; they cannot be created directly via the UI API.',
};

export type GetOrderSummaryInput = z.infer<typeof getOrderSummarySchema.input>;
export type GetOrderSummaryOutput = z.infer<
  typeof getOrderSummarySchema.output
>;

export const listPromotionsSchema = {
  name: 'listPromotions',
  description:
    'List commerce promotions with pagination, sorting, searching, and list view filtering via the ListUi API',
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
        'List view API name to filter by (default "__Recent"). Use "__Recent" for recently viewed records.',
      ),
    sortBy: z
      .array(z.string())
      .optional()
      .describe(
        'Array of field paths to sort by, e.g. ["Promotion.Name"]. Prefix with "-" for descending, e.g. ["-Promotion.Name"]. Sortable fields include Name, Campaign.Name, CreatedBy.Alias, CreatedDate, LastModifiedDate.',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe(
        'Search term to filter records within the list view (minimum 2 characters)',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Restrict output to specific fields (client-side filter). Use dot notation, e.g. ["Promotion.Id", "Promotion.Name", "Promotion.Campaign.Name"]. Id is always included. When omitted, all default fields are returned.',
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
        'Additional fields to return if available, in Object.Field format (e.g. ["Promotion.Description", "Promotion.StartDate"]). Unlike fields, does not error if the field does not exist on the object.',
      ),
    where: z
      .string()
      .optional()
      .describe(
        'Serialized JSON filter for server-side filtering. Supports operators: eq, ne, like, in, nin, gt, gte, lt, lte. Logical combinators: and, or, not. Example: \'{"Name":{"like":"Summer%"}}\'.',
      ),
  }),
  output: z.object({
    count: z
      .number()
      .describe(
        'Number of records returned on this page (NOT total across all pages). Use nextPageToken to check for more.',
      ),
    promotions: z.array(SObjectRecord).describe('Array of promotion records'),
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
  notes:
    'Prerequisite: Navigate to any Salesforce Lightning page (*.lightning.force.com), then call getContext() to obtain auraToken and auraContext. Uses ListUiController/postListRecordsByName with the Promotion object. Available scopes from list views: "everything" (All promotions), "mine" (My promotions), "entity" (Queue owned promotions). sortBy uses "Promotion.FieldName" format with optional "-" prefix for descending.',
};

export type ListPromotionsInput = z.infer<typeof listPromotionsSchema.input>;
export type ListPromotionsOutput = z.infer<typeof listPromotionsSchema.output>;

export const getPromotionSchema = {
  name: 'getPromotion',
  description:
    'Get a single commerce promotion by ID. Validates that the record is a Promotion; rejects non-Promotion record IDs with a descriptive error.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    promotionId: z.string().describe('Promotion ID'),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type for field selection. FULL returns all fields (~47), COMPACT returns key fields (~15). Default: FULL',
      ),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE', 'INLINE_EDIT', 'CLONE', 'DEFAULT'])
      .optional()
      .describe(
        'Record mode context. VIEW returns standard read fields, EDIT returns editable fields with recordLayout metadata for form rendering, CREATE returns a blank template with default values (~26 fields, no Id field in response), INLINE_EDIT for inline editing context, CLONE for record cloning context (~36 fields), DEFAULT for server-default mode selection. Defaults to VIEW. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch (e.g. ["Promotion.Name", "Promotion.IsActive"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format. Errors if a field does not exist.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["Promotion.Description", "Promotion.Objective"]). Non-existent fields are silently omitted from the response. When used with fields, uses getRecordWithFields. When used alone (without fields or childRelationships), uses getRecordWithLayouts to include all layout fields plus the optional extras. Field names must use ObjectName.FieldName format.',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["PromotionQualifiers", "PromotionTargets", "PromotionCoupons"]). Returns paginated child records for each relationship. Uses RecordUiController/getRecordWithFields. Can be used standalone or combined with fields/optionalFields. Valid relationship names include: PromotionQualifiers, PromotionTargets, PromotionTiers, PromotionCoupons, PromotionMarketSegments, Histories, OrderAdjustmentGroups, OrderItemAdjustmentLineItems, Attachments, ContentDocumentLinks, Notes',
      ),
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Record type ID to control which page layout is used (e.g. "012000000000000AAA" for Master). Only applies when using DetailController (i.e. when fields/optionalFields/childRelationships are NOT specified). Determines which layout fields are returned for orgs with multiple record types.',
      ),
    pageSize: z
      .number()
      .optional()
      .describe(
        'Number of child records to return per child relationship. Default: 5. Only applies when childRelationships is specified (uses RecordUiController/getRecordWithFields).',
      ),
    pageToken: z
      .string()
      .optional()
      .describe(
        'Pagination cursor for child relationship results. Obtained from currentPageToken or nextPageToken in a previous response. Format: "page;pageSize;recordId;relName;fields;". Only applies when childRelationships is specified (uses RecordUiController/getRecordWithFields).',
      ),
    updateMru: z
      .boolean()
      .optional()
      .describe(
        'Whether viewing this record updates the "Most Recently Used" list. Set to false to avoid polluting the user\'s recent items when programmatically fetching records. Only applies to the DetailController path (when fields/optionalFields are not specified). Default: server default (typically true)',
      ),
    layoutTypes: z
      .array(z.enum(['FULL', 'COMPACT']))
      .optional()
      .describe(
        'Layout types for the RecordUiController path. Provides layout context when fetching with fields/optionalFields. Only used when fields or optionalFields are specified.',
      ),
    modes: z
      .array(
        z.enum(['VIEW', 'EDIT', 'CREATE', 'INLINE_EDIT', 'CLONE', 'DEFAULT']),
      )
      .optional()
      .describe(
        'Mode context array for the RecordUiController path. Provides mode context when fetching with fields/optionalFields. Only used when fields or optionalFields are specified.',
      ),
    defaultFieldValues: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Pre-populated field values for CREATE or EDIT mode (e.g. {"Name": "prefilled"}). Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    navigationLocation: z
      .enum(['DETAIL', 'LIST', 'RELATED_LIST', 'LOOKUP'])
      .optional()
      .describe(
        'Context about where the user navigated from. Affects layout resolution. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    inContextOfComponent: z
      .string()
      .optional()
      .describe(
        'Salesforce Lightning component context for layout resolution (e.g. "force:detailPanel", "force:highlights"). Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    entityApiNameOrKeyPrefix: z
      .string()
      .optional()
      .describe(
        'Entity API name or key prefix (e.g. "Promotion"). Provides entity context for the DetailController when loading CLONE or CREATE records. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    layoutOverride: z
      .string()
      .optional()
      .describe(
        'Layout override identifier. Overrides the default page layout for the record. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    changeRecordType: z
      .boolean()
      .optional()
      .describe(
        'Whether to allow record type change during CLONE or CREATE mode. When true, the returned layout includes record type selection metadata. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    formFactor: z
      .enum(['SMALL', 'MEDIUM', 'LARGE'])
      .optional()
      .describe(
        'Device form factor for layout resolution. LARGE for desktop, MEDIUM for tablet, SMALL for phone. Affects which page layout variant the server returns. Only used with DetailController path (when fields/optionalFields are not specified). Default: server auto-detects.',
      ),
    densityType: z
      .enum(['Comfy', 'Compact', 'Auto'])
      .optional()
      .describe(
        'Display density for layout rendering. Comfy uses more whitespace, Compact is denser. Affects field spacing and layout sections returned. Only used with DetailController path (when fields/optionalFields are not specified). Default: server default.',
      ),
    includeSystemFields: z
      .boolean()
      .optional()
      .describe(
        'Whether to include system fields (CreatedDate, LastModifiedDate, SystemModstamp, etc.) in the response. Only used with DetailController path (when fields/optionalFields are not specified). Default: server default.',
      ),
    includeRelationships: z
      .boolean()
      .optional()
      .describe(
        'Whether to include relationship data (e.g. Owner, Campaign lookups) in the response. Only used with DetailController path (when fields/optionalFields are not specified). Default: server default.',
      ),
    record: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional()
      .describe(
        'Pre-loaded record object to pass to the DetailController, avoiding a redundant server fetch. The UI sends null when no cached record is available. When provided, the server merges the record data with the layout. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    offset: z
      .number()
      .optional()
      .describe(
        'Pagination offset for record layout data. The native UI sends 0. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    stencilOverride: z
      .string()
      .optional()
      .describe(
        'Override the stencil template used for rendering the record layout. Common values: "force:highlightsStencilDesktop" (used with COMPACT layout in highlights panel). Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    isCreateOrClone: z
      .boolean()
      .optional()
      .describe(
        'When true, indicates a create or clone operation. Combined with CLONE or CREATE mode, causes the server to return all writable fields instead of the standard layout field set. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    isCloneWithRelated: z
      .boolean()
      .optional()
      .describe(
        'When true, includes related child records in clone operations. Only meaningful when isCreateOrClone is true and mode is CLONE. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
  }),
  output: SObjectRecord,
};

export type GetPromotionInput = z.infer<typeof getPromotionSchema.input>;
export type GetPromotionOutput = z.infer<typeof getPromotionSchema.output>;

// ============================================================================
// Quick Text
// ============================================================================

const QuickTextRecord = z
  .object({
    Id: z.string().describe('Salesforce record ID'),
    Name: z.string().describe('Quick text name'),
    Message: z.string().describe('Quick text message body'),
    Category: z
      .string()
      .nullable()
      .describe('Category label (e.g. "Greetings")'),
    Category__l: z.string().nullable().describe('Localized category label'),
    Category__f: z.string().nullable().describe('Formatted category label'),
    Channel: z.string().nullable().describe('Channel (e.g. "Email")'),
    Channel__l: z.string().nullable().describe('Localized channel label'),
    Channel__f: z.string().nullable().describe('Formatted channel label'),
    FolderId: z.string().nullable().describe('Folder ID'),
    Folder: z.string().nullable().describe('Folder name'),
    IsInsertable: z
      .boolean()
      .describe('Whether the quick text can be inserted'),
    CreatedDate: z.string().describe('ISO-8601 creation timestamp'),
    CreatedDate__l: z.string().describe('Localized creation timestamp'),
    CreatedDate__f: z.string().describe('Formatted creation timestamp'),
    LastModifiedDate: z.string().describe('ISO-8601 last modified timestamp'),
    LastModifiedDate__l: z
      .string()
      .describe('Localized last modified timestamp'),
    LastModifiedDate__f: z
      .string()
      .describe('Formatted last modified timestamp'),
    SystemModstamp: z
      .string()
      .describe('ISO-8601 system modification timestamp'),
    SystemModstamp__l: z
      .string()
      .describe('Localized system modification timestamp'),
    SystemModstamp__f: z
      .string()
      .describe('Formatted system modification timestamp'),
    LastModifiedById: z
      .string()
      .describe('ID of the user who last modified this record'),
    sobjectType: z.string().describe('Always "QuickText"'),
  })
  .passthrough();

export const listQuickTextSchema = {
  name: 'listQuickText',
  description: 'List quick text snippets with pagination',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(2000)
      .optional()
      .describe('Results per page, integer 1-2000 (default 25)'),
    page: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Page number, zero-indexed (default 0)'),
  }),
  output: z.object({
    totalCount: z.number().describe('Total number of quick text records'),
    quickTexts: z
      .array(QuickTextRecord)
      .describe('Array of quick text records'),
  }),
};

export type ListQuickTextInput = z.infer<typeof listQuickTextSchema.input>;
export type ListQuickTextOutput = z.infer<typeof listQuickTextSchema.output>;

const ChildRelationshipPage = z.object({
  count: z.number().describe('Total number of child records'),
  currentPageToken: z
    .string()
    .nullable()
    .describe('Token for the current page of results'),
  nextPageToken: z
    .string()
    .nullable()
    .describe(
      'Token for the next page, or null if no more pages. Pass as pageToken to fetch the next page.',
    ),
  previousPageToken: z
    .string()
    .nullable()
    .describe('Token for the previous page, or null if on first page'),
  records: z
    .array(z.record(z.string(), z.unknown()))
    .describe(
      'Flattened child records. Each record has Id plus the child object fields.',
    ),
});

const GetQuickTextOutput = z
  .object({
    Id: z.string().describe('Salesforce record ID'),
    Name: z.string().optional().describe('Quick text name'),
    Message: z.string().optional().describe('Quick text message body'),
    Category: z
      .string()
      .nullable()
      .optional()
      .describe('Category label (e.g. "Greetings")'),
    Category__l: z
      .string()
      .nullable()
      .optional()
      .describe('Localized category label'),
    Category__f: z
      .string()
      .nullable()
      .optional()
      .describe('Formatted category label'),
    Channel: z
      .string()
      .nullable()
      .optional()
      .describe('Channel (e.g. "Email")'),
    Channel__l: z
      .string()
      .nullable()
      .optional()
      .describe('Localized channel label'),
    Channel__f: z
      .string()
      .nullable()
      .optional()
      .describe('Formatted channel label'),
    FolderId: z.string().nullable().optional().describe('Folder ID'),
    Folder: z.string().nullable().optional().describe('Folder name'),
    IsInsertable: z
      .boolean()
      .optional()
      .describe('Whether the quick text can be inserted'),
    CreatedDate: z.string().optional().describe('ISO-8601 creation timestamp'),
    CreatedDate__l: z
      .string()
      .optional()
      .describe('Localized creation timestamp'),
    CreatedDate__f: z
      .string()
      .optional()
      .describe('Formatted creation timestamp'),
    LastModifiedDate: z
      .string()
      .optional()
      .describe('ISO-8601 last modified timestamp'),
    LastModifiedDate__l: z
      .string()
      .optional()
      .describe('Localized last modified timestamp'),
    LastModifiedDate__f: z
      .string()
      .optional()
      .describe('Formatted last modified timestamp'),
    SystemModstamp: z
      .string()
      .optional()
      .describe('ISO-8601 system modification timestamp'),
    SystemModstamp__l: z
      .string()
      .optional()
      .describe('Localized system modification timestamp'),
    SystemModstamp__f: z
      .string()
      .optional()
      .describe('Formatted system modification timestamp'),
    LastModifiedById: z
      .string()
      .optional()
      .describe('ID of the user who last modified this record'),
    sobjectType: z
      .string()
      .optional()
      .describe(
        'Always "QuickText". Present with DetailController path (default), absent with RecordUiController path.',
      ),
    childRelationships: z
      .record(z.string(), ChildRelationshipPage)
      .optional()
      .describe(
        'Child relationship data keyed by relationship name (e.g. "Histories"). Only present when childRelationships input parameter is specified. Each entry contains paginated child records with count and page tokens.',
      ),
  })
  .passthrough();

export const getQuickTextSchema = {
  name: 'getQuickText',
  description:
    'Get a single quick text snippet by ID. By default (no fields/optionalFields/childRelationships), uses DetailController which returns the full record with all standard fields and sobjectType. When fields, optionalFields, or childRelationships are specified, uses RecordUiController which returns only the requested fields plus Id.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    quickTextId: z.string().describe('Quick Text record ID'),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type controlling which fields are returned. FULL returns all fields (~23), COMPACT returns a focused subset (~13). Defaults to FULL.',
      ),
    mode: z
      .enum(['VIEW', 'EDIT', 'CREATE', 'INLINE_EDIT', 'CLONE'])
      .optional()
      .describe(
        'Record mode context. VIEW returns standard read fields, EDIT returns editable fields, CREATE returns fields for new record template, INLINE_EDIT for inline editing context, CLONE for record cloning context. Defaults to VIEW. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Record type ID to filter fields by record type layout (e.g., "012000000000000AAA" for master record type)',
      ),
    updateMru: z
      .boolean()
      .optional()
      .describe(
        'When true, updates the "Most Recently Used" list for this record. Affects the Recently Viewed list in Salesforce UI. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch (e.g. ["QuickText.Name", "QuickText.Message"]). Switches to RecordUiController/getRecordWithFields. Field names must use ObjectName.FieldName format. Errors if a field does not exist. Output will contain only these fields plus Id.',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["QuickText.Category", "QuickText.Channel"]). Non-existent fields are silently omitted. Switches to RecordUiController/getRecordWithFields.',
      ),
    layoutTypes: z
      .array(z.enum(['FULL', 'COMPACT']))
      .optional()
      .describe(
        'Layout types for the RecordUiController path. Provides layout context when fetching with fields/optionalFields. Only used when fields or optionalFields are specified.',
      ),
    modes: z
      .array(
        z.enum(['VIEW', 'EDIT', 'CREATE', 'INLINE_EDIT', 'CLONE', 'DEFAULT']),
      )
      .optional()
      .describe(
        'Mode context array for the RecordUiController path. Provides mode context when fetching with fields/optionalFields. Only used when fields or optionalFields are specified.',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["Histories", "Shares"]). Returns paginated child records in the childRelationships output field. Must be combined with fields or optionalFields (switches to RecordUiController path). Valid relationship names for QuickText: Histories, Shares.',
      ),
    pageSize: z
      .number()
      .optional()
      .describe(
        'Number of child records to return per child relationship page. Default: 5. Only applies when childRelationships is specified.',
      ),
    pageToken: z
      .string()
      .optional()
      .describe(
        'Pagination cursor for child relationship results. Obtained from nextPageToken in a previous response. Only applies when childRelationships is specified.',
      ),
    defaultFieldValues: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Pre-populated field values for CREATE or EDIT mode (e.g. {"Name": "prefilled"}). Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    navigationLocation: z
      .enum(['DETAIL', 'LIST', 'RELATED_LIST', 'LOOKUP'])
      .optional()
      .describe(
        'Context about where the user navigated from. Affects layout resolution. Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
    inContextOfComponent: z
      .string()
      .optional()
      .describe(
        'Salesforce Lightning component context for layout resolution (e.g. "force:detailPanel", "force:highlights"). Only used with DetailController path (when fields/optionalFields are not specified).',
      ),
  }),
  output: GetQuickTextOutput,
};

export type GetQuickTextInput = z.infer<typeof getQuickTextSchema.input>;
export type GetQuickTextOutput = z.infer<typeof getQuickTextSchema.output>;

export const createQuickTextSchema = {
  name: 'createQuickText',
  description: 'Create a new quick text snippet',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    name: z.string().describe('Quick text name (required)'),
    message: z.string().describe('Quick text message body (required)'),
    category: z
      .string()
      .optional()
      .describe(
        'Quick text category picklist value (e.g. "Greetings", "FAQ", "Closings"). Values are org-specific.',
      ),
    channel: z
      .string()
      .optional()
      .describe(
        'Semicolon-delimited list of channels where this quick text is available (e.g. "Email", "Email;Task", "Email;Event;Knowledge")',
      ),
    isInsertable: z
      .boolean()
      .optional()
      .describe(
        'Whether the quick text is insertable in the selected channels (maps to "Include in selected channels" checkbox)',
      ),
    folderId: z
      .string()
      .optional()
      .describe('Salesforce ID of the folder to assign this quick text to'),
    ownerId: z
      .string()
      .optional()
      .describe('Salesforce User ID to set as the owner of this quick text'),
    sourceType: z
      .enum(['EINSTEIN_GENERATED', 'USER_GENERATED', 'USER_EDITED'])
      .optional()
      .describe(
        'Source entity type indicating how the quick text was created. "EINSTEIN_GENERATED" = created by Einstein, "USER_GENERATED" = created by a user, "USER_EDITED" = Einstein-generated but edited by a user.',
      ),
    fields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Additional fields beyond the named parameters above'),
  }),
  output: SaveResult,
};

export type CreateQuickTextInput = z.infer<typeof createQuickTextSchema.input>;
export type CreateQuickTextOutput = z.infer<
  typeof createQuickTextSchema.output
>;

export const updateQuickTextSchema = {
  name: 'updateQuickText',
  description: 'Update an existing quick text snippet',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    quickTextId: z.string().describe('Quick Text record ID'),
    fields: z
      .record(z.string(), z.unknown())
      .describe(
        'Fields to update (at least one required). Common: Name, Message, Category, Channel, IsInsertable',
      ),
  }),
  output: SaveResult,
};

export type UpdateQuickTextInput = z.infer<typeof updateQuickTextSchema.input>;
export type UpdateQuickTextOutput = z.infer<
  typeof updateQuickTextSchema.output
>;

export const deleteQuickTextSchema = {
  name: 'deleteQuickText',
  description: 'Delete a quick text snippet by ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    quickTextId: z.string().describe('Quick Text record ID'),
  }),
  output: DeleteResult,
};

export type DeleteQuickTextInput = z.infer<typeof deleteQuickTextSchema.input>;
export type DeleteQuickTextOutput = z.infer<
  typeof deleteQuickTextSchema.output
>;

// ============================================================================
// Segments & Marketing
// ============================================================================

export const listSegmentsSchema = {
  name: 'listSegments',
  description:
    'List marketing segments (MarketSegment object) with pagination, sorting, and searching via the ListUi API.',
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
        'List view API name (default "__Recent"). Use "__Recent" for recently viewed segments.',
      ),
    sortBy: z
      .array(z.string())
      .optional()
      .describe(
        'Array of field paths to sort by, e.g. ["MarketSegment.Name"]. Prefix with "-" for descending, e.g. ["-MarketSegment.Name"].',
      ),
    searchTerm: z
      .string()
      .optional()
      .describe(
        'Search term to filter records within the list view (minimum 2 characters)',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Server-side field selection in dot notation, e.g. ["MarketSegment.Id", "MarketSegment.Name"]. Id is always included. When omitted, defaults to Id and Name.',
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
        'Additional fields to return if available, in Object.Field format (e.g. ["MarketSegment.Description"]). Does not error if the field does not exist.',
      ),
  }),
  output: z.object({
    count: z
      .number()
      .describe(
        'Number of records returned on the current page (NOT the total matching count). Check nextPageToken to determine if more records exist.',
      ),
    segments: z.array(SObjectRecord).describe('Array of segment records'),
    nextPageToken: z
      .string()
      .nullable()
      .describe('Token for fetching the next page, null if no more pages'),
    previousPageToken: z
      .string()
      .nullable()
      .describe('Token for fetching the previous page, null if on first page'),
    currentPageToken: z
      .string()
      .nullable()
      .describe('Token representing the current page position'),
  }),
  notes: 'Use segment IDs from this list with getSegment() for full details.',
};

export type ListSegmentsInput = z.infer<typeof listSegmentsSchema.input>;
export type ListSegmentsOutput = z.infer<typeof listSegmentsSchema.output>;

export const createSegmentSchema = {
  name: 'createSegment',
  description: 'Create a new marketing segment (MarketSegment object)',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    name: z.string().describe('Segment name (required)'),
    segmentOnId: z
      .string()
      .describe(
        'Data Model Object ID that this segment is built on (required)',
      ),
    description: z.string().optional().describe('Segment description'),
    publishType: z
      .string()
      .optional()
      .describe('Publish type picklist value (e.g. "BATCH", "STREAMING")'),
    publishScheduleInterval: z
      .string()
      .optional()
      .describe(
        'Publish schedule interval (e.g. "NO_REFRESH", "DAILY", "WEEKLY")',
      ),
    publishScheduleStartDateTime: z
      .string()
      .optional()
      .describe('Publish schedule start date/time in ISO 8601 format'),
    publishScheduleEndDate: z
      .string()
      .optional()
      .describe('Expiration date for the publish schedule (YYYY-MM-DD)'),
    isSeedSegment: z
      .boolean()
      .optional()
      .describe('Whether this is a seed segment. Defaults to false'),
    dataSpaceId: z.string().optional().describe('Data space ID reference'),
    dataGraphId: z.string().optional().describe('Data graph ID reference'),
    marketSegmentDefinitionId: z
      .string()
      .optional()
      .describe('Market segment definition ID reference'),
    lookbackPeriod: z
      .string()
      .optional()
      .describe('Lookback period string (e.g. "P30D" for 30 days)'),
    includeCriteria: z
      .string()
      .optional()
      .describe('Include criteria expression for segment membership'),
    excludeCriteria: z
      .string()
      .optional()
      .describe('Exclude criteria expression for segment membership'),
  }),
  output: SaveResult,
  notes: '',
};

export type CreateSegmentInput = z.infer<typeof createSegmentSchema.input>;
export type CreateSegmentOutput = z.infer<typeof createSegmentSchema.output>;

export const updateSegmentSchema = {
  name: 'updateSegment',
  description: 'Update fields on an existing marketing segment',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    segmentId: z.string().describe('MarketSegment record ID to update'),
    fields: z
      .record(z.string(), z.unknown())
      .describe(
        'Fields to update, at least one required. Use Salesforce API field names (e.g. Name, Description, PublishType, PublishScheduleInterval, IsSeedSegment, LookbackPeriod, IncludeCriteria, ExcludeCriteria)',
      ),
    ifUnmodifiedSince: z
      .string()
      .optional()
      .describe(
        'Optimistic concurrency: only update if record unmodified since this HTTP-date (e.g. "Thu, 05 Feb 2026 06:30:55 GMT")',
      ),
  }),
  output: SaveResult,
  notes:
    'Segments in COUNTING or PROCESSING state cannot be updated; wait until SegmentStatus is ACTIVE.',
};

export type UpdateSegmentInput = z.infer<typeof updateSegmentSchema.input>;
export type UpdateSegmentOutput = z.infer<typeof updateSegmentSchema.output>;

export const deleteSegmentSchema = {
  name: 'deleteSegment',
  description: 'Delete a marketing segment by ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    segmentId: z.string().describe('MarketSegment record ID to delete'),
  }),
  output: DeleteResult,
  notes: '',
};

export type DeleteSegmentInput = z.infer<typeof deleteSegmentSchema.input>;
export type DeleteSegmentOutput = z.infer<typeof deleteSegmentSchema.output>;

export const convertLeadSchema = {
  name: 'convertLead',
  description:
    'Convert a lead into an account, contact, and optionally an opportunity. Merges into existing records when accountId/contactId are provided; creates new records otherwise.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    leadId: z.string().describe('Lead ID to convert'),
    convertedStatus: z
      .string()
      .describe(
        'Lead status picklist value indicating conversion. Use getPicklistValues with objectApiName "Lead" and fieldApiName "Status" to discover valid values. Common value: "Qualified".',
      ),
    accountId: z
      .string()
      .optional()
      .describe(
        'Existing account ID to merge into. Mutually exclusive with newAccountRecord; if both are provided, accountId takes precedence. Omit both to let Salesforce create a new account from the lead.',
      ),
    contactId: z
      .string()
      .optional()
      .describe(
        'Existing contact ID to merge into. Mutually exclusive with newContactRecord; if both are provided, contactId takes precedence. Omit both to let Salesforce create a new contact from the lead.',
      ),
    opportunityName: z
      .string()
      .optional()
      .describe(
        'Name for the new opportunity. If omitted, Salesforce uses the lead company name. Set doNotCreateOpportunity=true to skip opportunity creation.',
      ),
    ownerId: z
      .string()
      .optional()
      .describe(
        'Record Owner ID for the converted records. Defaults to the lead owner.',
      ),
    doNotCreateOpportunity: z
      .boolean()
      .optional()
      .describe(
        'If true, skip opportunity creation during conversion. Defaults to false.',
      ),
    overwriteLeadSource: z
      .boolean()
      .optional()
      .describe(
        'If true, overwrite the LeadSource field on existing account/contact records. Defaults to false.',
      ),
    bypassAccountDedupeCheck: z
      .boolean()
      .optional()
      .describe(
        'If true, bypass duplicate detection for the account during conversion. Defaults to false.',
      ),
    bypassContactDedupeCheck: z
      .boolean()
      .optional()
      .describe(
        'If true, bypass duplicate detection for the contact during conversion. Defaults to false.',
      ),
    newAccountRecord: z
      .object({
        Name: z.string().describe('Account name'),
        IsPersonAccount: z
          .boolean()
          .optional()
          .describe('Whether to create a person account'),
      })
      .optional()
      .describe(
        'Account record fields for creation. If omitted, defaults are derived from the lead.',
      ),
    newContactRecord: z
      .object({
        Salutation: z.string().optional().describe('Contact salutation'),
        FirstName: z.string().optional().describe('Contact first name'),
        LastName: z.string().describe('Contact last name'),
      })
      .optional()
      .describe(
        'Contact record fields for creation. If omitted, defaults are derived from the lead.',
      ),
    newOpportunityRecord: z
      .object({
        Name: z.string().describe('Opportunity name'),
      })
      .optional()
      .describe(
        'Opportunity record fields for creation. If omitted, defaults are derived from the lead company name.',
      ),
  }),
  output: z.object({
    accountId: z.string().describe('Account ID (new or existing)'),
    contactId: z.string().describe('Contact ID (new or existing)'),
    opportunityId: z
      .string()
      .nullable()
      .describe('Opportunity ID if created, null otherwise'),
    isPersonAccount: z
      .boolean()
      .describe('Whether the resulting account is a person account'),
    hasError: z.boolean().describe('Whether the conversion encountered errors'),
  }),
};

export type ConvertLeadInput = z.infer<typeof convertLeadSchema.input>;
export type ConvertLeadOutput = z.infer<typeof convertLeadSchema.output>;

export const listConsentImportsSchema = {
  name: 'listConsentImports',
  description:
    'List communication subscription consent records. Uses the SelectableListDataProvider controller because CommSubscriptionConsent is not supported by the ListUi API.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z
      .number()
      .min(1)
      .optional()
      .describe('Results per page (default 25, max 200). Must be at least 1.'),
    page: z
      .number()
      .optional()
      .describe('Page number, zero-indexed (default 0)'),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field API name to sort by (e.g. "Name", "ConsentGiverId"). Accepts a single field name as a string.',
      ),
    layoutType: z
      .enum(['FULL', 'COMPACT', 'SEARCH'])
      .optional()
      .describe(
        'Layout type controlling which fields are returned. FULL returns all layout fields (default). COMPACT returns compact layout fields (fewer fields). SEARCH returns search-optimized fields.',
      ),
  }),
  output: z.object({
    totalCount: z.number().describe('Total number of consent import records'),
    imports: z
      .array(SObjectRecord)
      .describe(
        'Array of consent import records with consent giver, contact point, effective date, and consent captured info',
      ),
  }),
  notes:
    'Uses CommSubscriptionConsent as the entity. Object is not supported by ListUiController (postListRecordsByName), so uses SelectableListDataProviderController/getItems instead.',
};

export type ListConsentImportsInput = z.infer<
  typeof listConsentImportsSchema.input
>;
export type ListConsentImportsOutput = z.infer<
  typeof listConsentImportsSchema.output
>;

export const listSubscriptionsSchema = {
  name: 'listSubscriptions',
  description:
    'List communication subscriptions for marketing consent management',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z
      .number()
      .min(1)
      .optional()
      .describe('Results per page (default 50, max 200). Must be at least 1.'),
    page: z
      .number()
      .optional()
      .describe(
        'Page number, zero-indexed (default 0). Converted to offset internally. Use offset for direct control.',
      ),
    offset: z
      .number()
      .optional()
      .describe(
        'Record offset for pagination (default 0). Takes precedence over page.',
      ),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field name to sort by. Prefix with "-" for descending. Sortable fields: "Name", "DataUsePurpose", "CreatedDate", "LastModifiedDate". Example: "Name" (ascending) or "-Name" (descending).',
      ),
    filterName: z
      .string()
      .optional()
      .describe(
        'List view developer name or ID (default "__Recent"). Use "__Recent" for recently viewed, or a list view ID (e.g. "00Bal...") for a specific view.',
      ),
    layoutType: z
      .enum(['LIST', 'SEARCH', 'COMPACT'])
      .optional()
      .describe(
        'Layout type controlling which fields are returned. LIST returns standard list view fields (default). SEARCH returns search-optimized fields. COMPACT returns compact layout fields.',
      ),
    getCount: z
      .boolean()
      .optional()
      .describe(
        'Whether to include totalCount in the response (default true). Set to false for faster queries when count is not needed.',
      ),
    enableRowActions: z
      .boolean()
      .optional()
      .describe(
        'Whether to include per-record quick action definitions in the response (default false). When true, each record includes available actions like edit, delete, and custom quick actions.',
      ),
    useTimeout: z
      .boolean()
      .optional()
      .describe(
        'Whether to apply a server-side timeout to the query (default false). Useful for large datasets to prevent long-running queries.',
      ),
  }),
  output: z.object({
    totalCount: z
      .number()
      .describe(
        'Total number of subscription records matching the current list view',
      ),
    subscriptions: z
      .array(SObjectRecord)
      .describe(
        'Array of subscription records. Fields include: Name, DataUsePurpose, DataUsePurposeId, OwnerId, CreatedDate, LastModifiedDate, LastModifiedById.',
      ),
    hasMoreData: z
      .boolean()
      .describe('Whether more records exist beyond the current page'),
    offset: z
      .number()
      .describe(
        'The offset after the last returned record (use as next offset)',
      ),
  }),
  notes:
    'Uses ListViewDataManagerController/getItems with CommSubscription entity. Returns record IDs in the response with field data extracted from the Aura context $Record global value provider.',
};

export type ListSubscriptionsInput = z.infer<
  typeof listSubscriptionsSchema.input
>;
export type ListSubscriptionsOutput = z.infer<
  typeof listSubscriptionsSchema.output
>;

// ============================================================================
// Schema & Metadata
// ============================================================================

export const listCustomObjectsSchema = {
  name: 'listCustomObjects',
  description:
    'List all standard and custom objects in the org via Object Manager',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 50)'),
    offset: z
      .number()
      .optional()
      .describe('Pagination offset, zero-indexed (default 0)'),
    searchTerm: z
      .string()
      .optional()
      .describe('Filter objects by label or API name (Quick Find search)'),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Sort field name. Prefix with "-" for descending. Values: label, QualifiedApiName, description, lastModifiedDate, DeploymentStatus (default "label")',
      ),
  }),
  output: z.object({
    hasMoreResults: z
      .boolean()
      .describe('Whether there are more results beyond this page'),
    objects: z
      .array(
        z.object({
          entityDurableId: z.string().describe('Durable entity ID'),
          label: z.string().describe('Display label of the object'),
          apiName: z.string().describe('API name of the object'),
          custom: z.boolean().describe('Whether this is a custom object'),
          deployed: z.boolean().describe('Whether the object is deployed'),
          entityType: z
            .string()
            .describe('Object type (e.g., "Standard Object", "Custom Object")'),
          queryable: z.boolean().describe('Whether the object is queryable'),
          dateFormat: z
            .string()
            .describe('Date format for the org (e.g., "M/d/yyyy")'),
        }),
      )
      .describe('Array of object records'),
  }),
  notes:
    'Must be called from a Salesforce Setup page (*.my.salesforce-setup.com). Navigate to the Object Manager page first, then call getContext() to capture the setup domain Aura token. The ObjectListController is only available on the setup domain.',
};

export type ListCustomObjectsInput = z.infer<
  typeof listCustomObjectsSchema.input
>;
export type ListCustomObjectsOutput = z.infer<
  typeof listCustomObjectsSchema.output
>;

export const getObjectInfoSchema = {
  name: 'getObjectInfo',
  description:
    'Get metadata for a specific sObject type including fields, record types, and permissions via RecordUiController',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    objectApiName: z
      .string()
      .describe('API name of the object (e.g., "Account", "CustomObj__c")'),
  }),
  output: z
    .object({
      apiName: z.string().describe('API name of the sObject'),
      label: z.string().describe('Singular display label'),
      labelPlural: z.string().describe('Plural display label'),
      keyPrefix: z.string().nullable().describe('3-character ID prefix'),
      custom: z.boolean().describe('Whether this is a custom object'),
      createable: z
        .boolean()
        .describe('Whether current user can create records'),
      updateable: z
        .boolean()
        .describe('Whether current user can update records'),
      deletable: z
        .boolean()
        .describe('Whether current user can delete records'),
      queryable: z.boolean().describe('Whether the object is queryable'),
      searchable: z.boolean().describe('Whether the object is searchable'),
      layoutable: z.boolean().describe('Whether the object supports layouts'),
      feedEnabled: z.boolean().describe('Whether Chatter feed is enabled'),
      mruEnabled: z
        .boolean()
        .describe('Whether most-recently-used tracking is on'),
      compactLayoutable: z
        .boolean()
        .describe('Whether compact layouts are supported'),
      searchLayoutable: z
        .boolean()
        .describe('Whether search layouts are supported'),
      defaultRecordTypeId: z
        .string()
        .nullable()
        .describe('Default record type ID'),
      eTag: z.string().describe('Entity tag for cache validation'),
      associateEntityType: z
        .string()
        .nullable()
        .describe('Associated entity type if applicable'),
      associateParentEntity: z
        .string()
        .nullable()
        .describe('Associated parent entity if applicable'),
      dependentFields: z
        .record(z.string(), z.record(z.string(), z.unknown()))
        .describe('Map of controlling field to dependent field relationships'),
      fields: z
        .record(
          z.string(),
          z
            .object({
              apiName: z.string(),
              label: z.string(),
              dataType: z
                .string()
                .describe(
                  'Field type (e.g., "String", "Picklist", "Reference", "Currency", "Boolean")',
                ),
              required: z.boolean(),
              createable: z.boolean(),
              updateable: z.boolean(),
              sortable: z.boolean(),
              filterable: z.boolean(),
              custom: z.boolean(),
              nameField: z.boolean(),
              reference: z.boolean(),
              length: z.number(),
              compound: z
                .boolean()
                .describe('Whether this is a compound field (e.g., Address)'),
              calculated: z
                .boolean()
                .describe('Whether this is a formula/calculated field'),
              unique: z
                .boolean()
                .describe('Whether the field has a unique constraint'),
              externalId: z
                .boolean()
                .describe('Whether this is an external ID field'),
              htmlFormatted: z
                .boolean()
                .describe('Whether the field contains HTML'),
              inlineHelpText: z
                .string()
                .nullable()
                .describe('Help text configured for the field'),
              relationshipName: z
                .string()
                .nullable()
                .describe(
                  'Relationship name for reference fields (e.g., "Owner")',
                ),
              referenceToInfos: z
                .array(
                  z
                    .object({
                      apiName: z
                        .string()
                        .describe('Referenced object API name'),
                    })
                    .passthrough(),
                )
                .describe('Objects this reference field points to'),
              precision: z.number().describe('Precision for number fields'),
              scale: z.number().describe('Scale for number fields'),
              digits: z.number().describe('Max digits for number fields'),
            })
            .passthrough(),
        )
        .describe('Map of field API name to field metadata'),
      recordTypeInfos: z
        .record(
          z.string(),
          z
            .object({
              recordTypeId: z.string(),
              name: z.string(),
              available: z.boolean(),
              master: z.boolean(),
              defaultRecordTypeMapping: z.boolean(),
            })
            .passthrough(),
        )
        .describe('Map of record type ID to record type info'),
      childRelationships: z
        .array(
          z
            .object({
              childObjectApiName: z.string(),
              fieldName: z.string(),
              relationshipName: z.string().nullable(),
              junctionIdListNames: z.array(z.string()),
              junctionReferenceTo: z.array(z.string()),
            })
            .passthrough(),
        )
        .describe('Child relationship metadata'),
      nameFields: z
        .array(z.string())
        .describe('Field names that represent the record name'),
      themeInfo: z
        .object({
          color: z.string().describe('Theme hex color'),
          iconUrl: z.string().describe('Icon URL'),
        })
        .passthrough()
        .describe('Visual theme information'),
    })
    .passthrough(),
};

export type GetObjectInfoInput = z.infer<typeof getObjectInfoSchema.input>;
export type GetObjectInfoOutput = z.infer<typeof getObjectInfoSchema.output>;

export const listObjectFieldsSchema = {
  name: 'listObjectFields',
  description:
    'List all fields and relationships for a specific object. Returns every field in one call (auto-paginates internally).',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    objectApiName: z
      .string()
      .describe('API name of the object (e.g., "Contact", "CustomObj__c")'),
    searchTerm: z
      .string()
      .optional()
      .describe('Filter fields by search term (matches label or API name)'),
    sortBy: z
      .enum([
        'Label',
        'QualifiedApiName',
        'DataType',
        'ControllingFieldDefinition.Label',
        'IsIndexed',
      ])
      .optional()
      .describe('Field to sort results by (default "Label")'),
    sortDirection: z
      .enum(['ascending', 'descending'])
      .optional()
      .describe('Sort direction (default "ascending")'),
  }),
  output: z.object({
    fields: z
      .array(
        z
          .object({
            label: z.string().describe('Field label (display name)'),
            apiName: z.string().describe('Field API name'),
            developerName: z.string().describe('Field developer name'),
            dataType: z
              .string()
              .describe(
                'Field data type (e.g., "Text(255)", "Lookup(User)", "Picklist")',
              ),
            indexed: z.boolean().describe('Whether the field is indexed'),
            fieldDurableId: z.string().describe('Durable ID of the field'),
            isSalesforce: z
              .boolean()
              .describe('Whether this is a standard Salesforce field'),
            isEntityParticle: z
              .boolean()
              .describe(
                'Whether this is an entity particle (sub-field of a compound field like Name)',
              ),
            entityLabel: z.string().describe('Label of the parent object'),
          })
          .passthrough(),
      )
      .describe(
        'Array of field records with Label, API Name, Data Type, and properties',
      ),
  }),
  notes:
    'Requires Setup access. Returns all fields from the Fields & Relationships tab in Object Manager. Auto-paginates internally; always returns the complete field list. Compound fields (e.g., Name) include their sub-fields (FirstName, LastName, Salutation) as separate records with isEntityParticle=true.',
};

export type ListObjectFieldsInput = z.infer<
  typeof listObjectFieldsSchema.input
>;
export type ListObjectFieldsOutput = z.infer<
  typeof listObjectFieldsSchema.output
>;

export const getPicklistValuesSchema = {
  name: 'getPicklistValues',
  description:
    'Get picklist values for a field (or all picklist fields) based on record type. ' +
    'When fieldApiName is provided, returns values for that single field. ' +
    'When omitted, returns all picklist fields for the object/record type.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    objectApiName: z.string().describe('API name of the object (e.g., "Lead")'),
    recordTypeId: z
      .string()
      .describe(
        'Record type ID (use "012000000000000AAA" for master record type)',
      ),
    fieldApiName: z
      .string()
      .optional()
      .describe(
        'API name of the picklist field (e.g., "Status", "Industry"). ' +
          'When omitted, returns all picklist fields for the object.',
      ),
  }),
  output: z.object({
    eTag: z
      .string()
      .optional()
      .describe('Cache ETag for the picklist values response'),
    picklistFieldValues: z
      .record(
        z.string(),
        z
          .object({
            controllerValues: z
              .record(z.string(), z.number())
              .describe(
                'Map of controlling field values to indices (for dependent picklists)',
              ),
            defaultValue: z
              .object({
                label: z.string().describe('Display label'),
                value: z.string().describe('API value'),
                validFor: z
                  .array(z.number())
                  .describe('Controller value indices this value is valid for'),
                attributes: z
                  .any()
                  .nullable()
                  .describe('Type-specific attributes'),
              })
              .nullable()
              .describe('Default picklist value, or null if none'),
            eTag: z.string().describe('Cache ETag for this specific field'),
            url: z.string().describe('REST API URL for this picklist field'),
            values: z
              .array(
                z
                  .object({
                    label: z.string().describe('Display label'),
                    value: z.string().describe('API value'),
                    validFor: z
                      .array(z.number())
                      .describe(
                        'Controller value indices this value is valid for (empty for independent picklists)',
                      ),
                    attributes: z
                      .unknown()
                      .nullable()
                      .describe(
                        'Type-specific attributes (e.g., converted flag for LeadStatus)',
                      ),
                  })
                  .passthrough(),
              )
              .describe('Array of picklist value entries'),
          })
          .passthrough(),
      )
      .describe(
        'Map of field API names to their picklist values. ' +
          'Single field when fieldApiName is provided, all fields when omitted.',
      ),
  }),
};

export type GetPicklistValuesInput = z.infer<
  typeof getPicklistValuesSchema.input
>;
export type GetPicklistValuesOutput = z.infer<
  typeof getPicklistValuesSchema.output
>;

export const listValidationRulesSchema = {
  name: 'listValidationRules',
  description:
    'List validation rules for a specific object. Auto-paginates internally; always returns the complete list.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    objectApiName: z
      .string()
      .describe('API name of the object (e.g., "Account")'),
    searchTerm: z
      .string()
      .optional()
      .describe('Filter rules by search term (matches rule name or fields)'),
    sortBy: z
      .enum([
        'ValidationName',
        'ErrorDisplayField',
        'ErrorMessage',
        'Active',
        'LastModifiedBy.Name',
      ])
      .optional()
      .describe('Field to sort results by (default "ValidationName")'),
    sortDirection: z
      .enum(['ascending', 'descending'])
      .optional()
      .describe('Sort direction (default "ascending")'),
  }),
  output: z.object({
    rules: z
      .array(
        z.object({
          id: z.string().describe('Validation rule record ID'),
          name: z.string().describe('Rule developer name'),
          errorLocation: z
            .string()
            .describe(
              'Where the error is displayed (e.g., "Top of Page" or "Account.FieldName")',
            ),
          errorMessage: z.string().describe('Validation error message'),
          active: z.boolean().describe('Whether the rule is active'),
          lastModifiedById: z
            .string()
            .describe('User ID of the person who last modified the rule'),
          lastModifiedByName: z
            .string()
            .describe('Display name of the user who last modified the rule'),
          lastModifiedDate: z
            .string()
            .describe('ISO 8601 date when the rule was last modified'),
        }),
      )
      .describe(
        'Array of validation rule records with ID, name, error location, error message, active status, modifier, and modification date',
      ),
  }),
  notes:
    'Must be called from a Salesforce Setup page (*.my.salesforce-setup.com). Navigate to the Object Manager page first, then call getContext() to capture the setup domain Aura token. Returns rules from the Validation Rules tab in Object Manager. Auto-paginates internally; always returns the complete list.',
};

export type ListValidationRulesInput = z.infer<
  typeof listValidationRulesSchema.input
>;
export type ListValidationRulesOutput = z.infer<
  typeof listValidationRulesSchema.output
>;

// ============================================================================
// Object Properties (convenience wrapper)
// ============================================================================

export const getObjectPropertiesSchema = {
  name: 'getObjectProperties',
  description:
    'Get a clean, flat property list for any Salesforce object type with picklist values inlined. Convenience wrapper around getObjectInfo for agent-friendly metadata discovery.',
  notes:
    'Returns field metadata as a flat array instead of a nested map. Picklist values are inlined so no separate getPicklistValues call is needed. For the raw, complete metadata blob, use getObjectInfo instead.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    objectApiName: z
      .string()
      .describe(
        'API name of the object (e.g., "Account", "Contact", "Lead", "Opportunity", "MarketSegment", or custom objects like "MyObject__c")',
      ),
  }),
  output: z.object({
    objectApiName: z.string().describe('API name of the object'),
    objectLabel: z.string().describe('Display label of the object'),
    properties: z
      .array(
        z.object({
          name: z
            .string()
            .describe('API name (e.g., "FirstName", "AccountId")'),
          label: z.string().describe('Display label'),
          type: z
            .string()
            .describe(
              'Data type (String, Phone, Email, Picklist, Reference, Currency, Boolean, etc.)',
            ),
          required: z.boolean(),
          updateable: z.boolean(),
          createable: z.boolean(),
          custom: z.boolean().describe('True for custom fields (__c suffix)'),
          sortable: z.boolean(),
          filterable: z.boolean(),
          relationshipName: z
            .string()
            .nullable()
            .describe(
              'Relationship name for lookup fields (e.g., "Owner", "Account")',
            ),
          referenceTo: z
            .array(z.string())
            .describe(
              'Target objects for lookup fields (e.g., ["Account"], ["User", "Group"])',
            ),
          length: z.number().nullable().describe('Max length for text fields'),
          inlineHelpText: z
            .string()
            .nullable()
            .describe('Help text configured for the field'),
          picklistValues: z
            .array(
              z.object({
                label: z.string(),
                value: z.string(),
              }),
            )
            .optional()
            .describe('Valid values for Picklist and MultiPicklist fields'),
        }),
      )
      .describe('Flat array of field metadata, one entry per field'),
    childRelationships: z
      .array(
        z.object({
          childObject: z
            .string()
            .describe('API name of the child object (e.g., "Contact")'),
          fieldName: z
            .string()
            .describe(
              'Lookup field on the child object that references this object',
            ),
          relationshipName: z
            .string()
            .describe('Relationship name for queries (e.g., "Contacts")'),
        }),
      )
      .describe('Child relationships where other objects reference this one'),
  }),
};

export type GetObjectPropertiesInput = z.infer<
  typeof getObjectPropertiesSchema.input
>;
export type GetObjectPropertiesOutput = z.infer<
  typeof getObjectPropertiesSchema.output
>;

// ============================================================================
// Flows
// ============================================================================

export const listFlowsSchema = {
  name: 'listFlows',
  description:
    'List flows (automation workflows) via the Setup ListViewDataManager. Uses FlowDefinitionView which is a Setup entity not supported by the standard ListUi API.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 25)'),
    page: z
      .number()
      .optional()
      .describe(
        'Page number, zero-indexed (default 0). Converted to offset internally. Use offset for direct control.',
      ),
    offset: z
      .number()
      .optional()
      .describe(
        'Record offset for pagination (default 0). Takes precedence over page.',
      ),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field name to sort by. Prefix with "-" for descending. Sortable fields: "Label", "ProcessType", "TriggerType", "IsActive", "IsTemplate", "ManageableState", "InstalledPackageName", "LastModifiedBy", "LastModifiedDate". Example: "Label" (ascending) or "-ProcessType" (descending).',
      ),
    listViewApiName: z
      .string()
      .optional()
      .describe(
        'List view developer name or ID (default "All_Flows"). Standard views: "All_Flows", "My_Flows", "RecentlyViewed", "__Recent".',
      ),
  }),
  output: z.object({
    totalCount: z
      .number()
      .describe('Total number of flows matching the current list view'),
    flows: z
      .array(SObjectRecord)
      .describe(
        'Array of flow records. Fields include: Label, ApiName, ProcessType (e.g. "AutoLaunchedFlow", "Flow", "CheckoutFlow"), TriggerType (e.g. "PlatformEvent", "Scheduled", "Segment"), IsActive, IsTemplate, IsOverridable, ManageableState, Builder, DurableId, ActiveVersionId, LatestVersionId, LastModifiedBy, LastModifiedDate, InstalledPackageName, NamespacePrefix, OverriddenBy, OverriddenById, OverriddenFlow, OverriddenFlowId, SourceTemplate, SourceTemplateId.',
      ),
    hasMoreData: z
      .boolean()
      .describe('Whether more records exist beyond the current page'),
    offset: z
      .number()
      .describe(
        'The offset after the last returned record (use as next offset)',
      ),
  }),
};

export type ListFlowsInput = z.infer<typeof listFlowsSchema.input>;
export type ListFlowsOutput = z.infer<typeof listFlowsSchema.output>;

export const activateFlowSchema = {
  name: 'activateFlow',
  description: 'Activate a flow version for production use',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    flowId: z.string().describe('Flow version ID to activate'),
  }),
  output: z.object({
    activated: z.literal(true),
    flowId: z.string().describe('ID of the activated flow version'),
  }),
};

export type ActivateFlowInput = z.infer<typeof activateFlowSchema.input>;
export type ActivateFlowOutput = z.infer<typeof activateFlowSchema.output>;

export const deactivateFlowSchema = {
  name: 'deactivateFlow',
  description: 'Deactivate an active flow version',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    flowId: z.string().describe('Flow version ID to deactivate'),
    builderType: z
      .string()
      .optional()
      .describe(
        'Flow builder type context. Defaults to "FlowBuilder". Examples: "FlowBuilder", "LightningFlowBuilder", "JourneyBuilder"',
      ),
    cancelOnDeactivate: z
      .boolean()
      .optional()
      .describe(
        'Whether to cancel running flow interviews when deactivating. Defaults to false, which lets in-progress interviews finish on the deactivated version.',
      ),
  }),
  output: z.object({
    deactivated: z.literal(true),
    flowId: z.string().describe('ID of the deactivated flow version'),
  }),
};

export type DeactivateFlowInput = z.infer<typeof deactivateFlowSchema.input>;
export type DeactivateFlowOutput = z.infer<typeof deactivateFlowSchema.output>;

// ============================================================================
// Security & Admin
// ============================================================================

export const getCompanyInfoSchema = {
  name: 'getCompanyInfo',
  description:
    'Get company information including org details, licenses, and usage stats. Queries the Organization sObject via GraphQL.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Organization sObject fields to return. If omitted, returns a default set of commonly useful fields. Available fields include: Name, Phone, Fax, PrimaryContact, Division, Street, City, State, PostalCode, Country, DefaultLocaleSidKey, LanguageLocaleKey, TimeZoneSidKey, FiscalYearStartMonth, OrganizationType, InstanceName, IsSandbox, IsReadOnly, TrialExpirationDate, NamespacePrefix, ComplianceBccEmail, SignupCountryIsoCode, MonthlyPageViewsEntitlement, MonthlyPageViewsUsed, NumKnowledgeService, ReceivesInfoEmails, ReceivesAdminInfoEmails, UsesStartDateAsFiscalYearName, WebToCaseDefaultOrigin, DefaultAccountAccess, DefaultContactAccess, DefaultOpportunityAccess, DefaultLeadAccess, DefaultCaseAccess, DefaultCalendarAccess, DefaultPricebookAccess, DefaultCampaignAccess, UiSkin, CreatedDate, CreatedById, LastModifiedDate, LastModifiedById',
      ),
  }),
  output: SObjectRecord,
  notes:
    'Returns Organization sObject fields via Salesforce GraphQL API. Does not require Setup access. The Organization object is read-only.',
};

export type GetCompanyInfoInput = z.infer<typeof getCompanyInfoSchema.input>;
export type GetCompanyInfoOutput = z.infer<typeof getCompanyInfoSchema.output>;

const SecuritySettingItem = z
  .object({
    label: z
      .enum(['Critical', 'Warning', 'Compliant'])
      .describe('Risk assessment label'),
    setting: z.string().describe('Setting display name'),
    group: z
      .string()
      .describe('Setting group (e.g. Session Settings, Password Policies)'),
    yourValue: z.string().describe('Current org value (display)'),
    yourValueRaw: z.string().describe('Current org value (raw)'),
    standardValue: z.string().describe('Baseline recommended value (display)'),
    standardValueRaw: z.string().describe('Baseline recommended value (raw)'),
    color: z.enum(['RED', 'YELLOW', 'GREEN']).describe('Risk color indicator'),
    durableId: z
      .string()
      .describe(
        'Stable identifier for the setting (e.g. SessionSettings.clickjackSetup)',
      ),
    urlRecord: z
      .object({
        urlSfx: z.string().describe('Lightning Experience URL path'),
        urlAloha: z.string().describe('Classic UI URL path'),
      })
      .describe('Links to the setting configuration page'),
  })
  .passthrough();

export const getSecurityHealthCheckSchema = {
  name: 'getSecurityHealthCheck',
  description:
    'Get the Security Health Check score and categorized security settings. Returns settings grouped by risk level (HIGH_RISK, MEDIUM_RISK, LOW_RISK, INFORMATIONAL) compared against the selected baseline.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    customBaselineId: z
      .string()
      .optional()
      .describe(
        'Custom baseline ID to compare against. Use "0" or omit for the Salesforce Baseline Standard. Get available baselines from the getCustomBaselines action.',
      ),
  }),
  output: z.object({
    score: z.number().describe('Overall security health score (0-100)'),
    totalScore: z.number().describe('Maximum possible score (typically 100)'),
    settings: z
      .object({
        HIGH_RISK_CATEGORY: z
          .array(SecuritySettingItem)
          .describe('High-risk security settings'),
        MEDIUM_RISK_CATEGORY: z
          .array(SecuritySettingItem)
          .describe('Medium-risk security settings'),
        LOW_RISK_CATEGORY: z
          .array(SecuritySettingItem)
          .describe('Low-risk security settings'),
        INFORMATIONAL_CATEGORY: z
          .array(SecuritySettingItem)
          .describe('Informational security settings'),
      })
      .describe('Security settings grouped by risk category'),
  }),
  notes:
    'Must execute on the setup domain (*.my.salesforce-setup.com), not the Lightning domain. Navigate to Setup > Security > Health Check first. Calls SecurityDashboardController via Aura. The customBaselineId param selects which baseline to compare against; "0" means Salesforce Baseline Standard.',
};

export type GetSecurityHealthCheckInput = z.infer<
  typeof getSecurityHealthCheckSchema.input
>;
export type GetSecurityHealthCheckOutput = z.infer<
  typeof getSecurityHealthCheckSchema.output
>;

// ============================================================================
// Record Utilities (Sales Core Extensions)
// ============================================================================

export const getRelatedListsSchema = {
  name: 'getRelatedLists',
  description:
    'Get related list metadata for a parent object type (e.g., which related lists appear on an Account page). Returns metadata like labels, object API names, and field mappings, not the actual records. Use with parentObjectApiName (e.g., "Account", "Contact", "Lead").',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    parentObjectApiName: z
      .string()
      .describe(
        'API name of the parent object (e.g., "Account", "Contact", "Opportunity", "Lead", "Case", "Campaign")',
      ),
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Record type ID to get related lists for. Defaults to "012000000000000AAA" (the master/default record type). Different record types may show different related lists.',
      ),
  }),
  output: z.object({
    relatedLists: z
      .array(
        z
          .object({
            label: z.string().describe('Related list display label'),
            objectApiName: z
              .string()
              .describe('API name of the related object'),
            relatedListId: z
              .string()
              .describe(
                'Identifier for this related list (e.g., "Contacts", "Opportunities", "Cases")',
              ),
            fieldApiName: z
              .string()
              .describe(
                'Field on the child object that references the parent (e.g., "AccountId")',
              ),
            parentFieldApiName: z
              .string()
              .describe('Field on the parent object (typically "Id")'),
            entityLabel: z
              .string()
              .describe('Singular entity label (e.g., "Contact")'),
            entityPluralLabel: z
              .string()
              .describe('Plural entity label (e.g., "Contacts")'),
            keyPrefix: z
              .string()
              .nullable()
              .describe(
                'Salesforce key prefix for the related object (e.g., "003" for Contact), null for virtual objects',
              ),
            relatedListInfoUrl: z
              .string()
              .nullable()
              .describe(
                'REST API URL for detailed related list info, null for non-UI-API objects',
              ),
            themeInfo: z
              .object({
                color: z
                  .string()
                  .describe('Hex color code for the related object icon'),
                iconUrl: z
                  .string()
                  .describe('URL to the related object icon image'),
              })
              .optional()
              .describe('Theme/styling info for the related object'),
            uiApiEnabledLayout: z
              .boolean()
              .describe(
                'Whether the UI API supports this related list layout (false for virtual objects like OpenActivity)',
              ),
          })
          .passthrough(),
      )
      .describe('Array of related list metadata'),
    eTag: z.string().optional().describe('ETag for cache validation'),
    parentObjectApiName: z
      .string()
      .optional()
      .describe('The parent object API name echoed back from the API'),
    parentRecordTypeId: z
      .string()
      .optional()
      .describe('The record type ID used for the query'),
  }),
};

export type GetRelatedListsInput = z.infer<typeof getRelatedListsSchema.input>;
export type GetRelatedListsOutput = z.infer<
  typeof getRelatedListsSchema.output
>;

export const getMergeCandidatesSchema = {
  name: 'getMergeCandidates',
  description:
    'Get merge candidates (potential duplicates) for a record. Searches by the record Name field to find similar records of the same object type. Use the optional term parameter to override the search query.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    recordId: z.string().describe('Record ID to find merge candidates for'),
    objectApiName: z
      .string()
      .describe('API name of the object (e.g., "Account", "Contact", "Lead")'),
    term: z
      .string()
      .optional()
      .describe(
        'Search term to find duplicates. Defaults to the record Name if omitted.',
      ),
    maxRecords: z
      .number()
      .optional()
      .describe('Maximum number of candidates to return. Defaults to 50.'),
    configurationName: z
      .enum([
        'MERGE_CANDIDATES',
        'INSTANT_RESULTS',
        'GLOBAL_SEARCH_BAR',
        'LOOKUP',
        'LOOKUP_SEARCH',
        'SEARCH_RESULTS',
        'DEFAULT',
        'GLOBAL_SEARCH',
        'RELATED_LIST',
      ])
      .optional()
      .describe(
        'Search configuration preset that controls the ranking algorithm. Defaults to MERGE_CANDIDATES. LOOKUP and INSTANT_RESULTS may produce different result ordering on some orgs.',
      ),
    maxQueries: z
      .number()
      .optional()
      .describe(
        'Maximum number of query suggestions to return alongside record candidates. Defaults to 0 (disabled). When > 0, the response includes querySuggestions with search refinement ideas like "accounts in United States" or "accounts created today".',
      ),
    maxTips: z
      .number()
      .optional()
      .describe(
        'Maximum number of tip suggestions to return. Defaults to 0 (disabled). Tip availability is org-dependent.',
      ),
    maxListViews: z
      .number()
      .optional()
      .describe(
        'Maximum number of list view suggestions to return alongside record candidates. Defaults to 0 (disabled). When > 0, the response includes listViewSuggestions with matching list views.',
      ),
    disableSpellCorrection: z
      .boolean()
      .optional()
      .describe(
        'Disable spell correction on the search term. Defaults to false. When true, the search engine will not attempt to correct typos in the term.',
      ),
    disableIntentQuery: z
      .boolean()
      .optional()
      .describe(
        'Disable intent/NLP query processing. Defaults to false. When true, the search engine treats the term as a literal keyword match without natural language interpretation.',
      ),
    searchSource: z
      .enum(['ASSISTANT_DIALOG', 'MERGE_CANDIDATES', 'GLOBAL_SEARCH_BAR'])
      .optional()
      .describe(
        'Search source context hint. Controls how the search engine ranks and processes results. Defaults to unset (server decides).',
      ),
  }),
  output: z.object({
    candidates: z
      .array(SObjectRecord)
      .describe(
        'Array of potential duplicate records (excludes the source record)',
      ),
    querySuggestions: z
      .array(z.object({ query: z.string() }))
      .optional()
      .describe(
        'Search query refinement suggestions. Only present when maxQueries > 0.',
      ),
    listViewSuggestions: z
      .array(
        z.object({
          id: z.string().describe('List view ID'),
          name: z.string().describe('List view name'),
        }),
      )
      .optional()
      .describe(
        'Matching list view suggestions. Only present when maxListViews > 0.',
      ),
  }),
};

export type GetMergeCandidatesInput = z.infer<
  typeof getMergeCandidatesSchema.input
>;
export type GetMergeCandidatesOutput = z.infer<
  typeof getMergeCandidatesSchema.output
>;

export const getActivitiesSchema = {
  name: 'getActivities',
  description:
    'Get the activity timeline for a record (emails, tasks, events, calls). By default returns activities within 2 months. Use selectedStartDateSeconds/selectedEndDateSeconds to filter by date range.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    recordId: z.string().describe('Record ID to get activities for'),
    selectedEntityFilters: z
      .array(z.enum(['email', 'event', 'listEmail', 'call', 'task']))
      .optional()
      .describe(
        'Activity types to include. Defaults to all types: ["email","event","listEmail","call","task"]',
      ),
    selectedStartDateSeconds: z
      .number()
      .optional()
      .describe(
        'Filter start as Unix timestamp in seconds. Must be used together with selectedEndDateSeconds. When omitted, defaults to ~2 months ago.',
      ),
    selectedEndDateSeconds: z
      .number()
      .optional()
      .describe(
        'Filter end as Unix timestamp in seconds. Must be used together with selectedStartDateSeconds. When omitted, defaults to ~2 months from now.',
      ),
    selectedOwnerFilter: z
      .enum(['Everything', 'Mine'])
      .optional()
      .describe(
        'Filter by owner. "Everything" = all activities, "Mine" = only current user activities.',
      ),
    pastActivitiesLimit: z
      .number()
      .optional()
      .describe('Max past activities to return per page. Defaults to 8.'),
    pageKey: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Pagination cursor from a previous response. Pass null or omit for the first page.',
      ),
    onlyInsights: z
      .boolean()
      .optional()
      .describe(
        'When true, return only activity insights. Requires the Activity Insights feature to be enabled in the org; throws "feature not enabled" if unavailable.',
      ),
    reverseOAView: z
      .boolean()
      .optional()
      .describe(
        'When true, sort upcoming/overdue activities with oldest dates first.',
      ),
    showThreadedView: z
      .boolean()
      .optional()
      .describe('When true, group emails into threaded conversations.'),
    showRelativeEmails: z
      .boolean()
      .optional()
      .describe('When true, show emails from related records.'),
    onlySdrActivities: z
      .boolean()
      .optional()
      .describe(
        'When true, show only SDR (Sales Development Rep) activities. Requires the SDR Activities feature to be enabled in the org; throws "feature not enabled" if unavailable.',
      ),
  }),
  output: z.object({
    openActivities: z
      .array(SObjectRecord)
      .describe('Array of upcoming/overdue activity records'),
    activityHistories: z
      .array(SObjectRecord)
      .describe(
        'Array of past activity records (emails, tasks, events, calls)',
      ),
    pageKey: z
      .string()
      .nullable()
      .describe(
        'Pagination cursor for fetching the next page, or null if no more pages',
      ),
    canShowMoreOpenActivities: z
      .boolean()
      .describe('Whether more upcoming activities are available'),
    canShowMoreActivityHistories: z
      .boolean()
      .describe('Whether more past activities are available'),
    selectedEntityFilters: z
      .array(z.string())
      .describe('The entity filters that were applied'),
    selectedOwnerFilter: z
      .string()
      .describe('The owner filter that was applied'),
  }),
};

export type GetActivitiesInput = z.infer<typeof getActivitiesSchema.input>;
export type GetActivitiesOutput = z.infer<typeof getActivitiesSchema.output>;

// ============================================================================
// Change Data Capture
// ============================================================================

const CDCEntityItem = z.object({
  id: z.string().describe('Object API name (e.g., "Account", "Contact")'),
  label: z
    .string()
    .describe('Human-readable label with API name (e.g., "Account (Account)")'),
});

export const listCDCEntitiesSchema = {
  name: 'listCDCEntities',
  description: 'List objects currently enabled for Change Data Capture',
  input: z.object({}),
  output: z.object({
    entities: z
      .array(CDCEntityItem)
      .describe('Array of objects currently enabled for CDC'),
    isUpdateable: z
      .boolean()
      .describe(
        'Whether the current user has permission to modify the CDC entity selection',
      ),
  }),
  notes:
    'Requires the browser to be on the Setup domain (Setup > Integrations > Change Data Capture page). Auto-captures Aura context from the current page; no auraToken/auraContext needed. Navigate to the CDC setup page first.',
};

export type ListCDCEntitiesInput = z.infer<typeof listCDCEntitiesSchema.input>;
export type ListCDCEntitiesOutput = z.infer<
  typeof listCDCEntitiesSchema.output
>;

export const enableCDCSchema = {
  name: 'enableCDC',
  description:
    'Set the Change Data Capture selection to exactly the specified objects (full replacement, not additive)',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    objectApiNames: z
      .array(z.string())
      .describe(
        'Complete list of object API names to enable for CDC (e.g., ["Account", "Contact"]). Objects not in this list will be removed. Pass an empty array to disable all CDC.',
      ),
  }),
  output: z.object({
    enabled: z
      .boolean()
      .describe('True if at least one object is now enabled for CDC'),
    objectApiNames: z
      .array(z.string())
      .describe(
        'Objects ACTUALLY enabled for CDC after the operation (verified read-back, not echoed input). May be fewer than requested if Salesforce silently rejected some objects.',
      ),
  }),
  notes:
    'Requires Setup access. REPLACES the entire CDC selection; any previously enabled objects not in objectApiNames will be removed. Use listCDCEntities first to see current selection, then include all desired objects. Use getAvailableCDCEntities to discover valid object names. The response reflects verified CDC state; compare objectApiNames in the response to your input to detect silently rejected objects.',
};

export type EnableCDCInput = z.infer<typeof enableCDCSchema.input>;
export type EnableCDCOutput = z.infer<typeof enableCDCSchema.output>;

export const getAvailableCDCEntitiesSchema = {
  name: 'getAvailableCDCEntities',
  description: 'Get all objects available for Change Data Capture subscription',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    maxResults: z
      .number()
      .optional()
      .describe('Maximum number of entities to return per page (default 50)'),
    offset: z
      .number()
      .optional()
      .describe('Offset for pagination, zero-indexed (default 0)'),
    keyword: z
      .string()
      .optional()
      .describe(
        'Filter entities by keyword (matches against entity label and API name)',
      ),
  }),
  output: z.object({
    entities: z
      .array(CDCEntityItem)
      .describe('Array of objects that can be enabled for CDC'),
    canLoadMore: z
      .boolean()
      .describe('Whether more entities are available beyond the current page'),
    hasReachedLimit: z
      .boolean()
      .describe('Whether the org has reached its CDC entity selection limit'),
  }),
  notes:
    'Lists objects eligible for CDC subscription from the Setup > Integrations > Change Data Capture page. Supports offset-based pagination via maxResults/offset and keyword filtering. Use canLoadMore to determine if more pages exist.',
};

export type GetAvailableCDCEntitiesInput = z.infer<
  typeof getAvailableCDCEntitiesSchema.input
>;
export type GetAvailableCDCEntitiesOutput = z.infer<
  typeof getAvailableCDCEntitiesSchema.output
>;

// ============================================================================
// Campaign Members
// ============================================================================

export const listCampaignMembersSchema = {
  name: 'listCampaignMembers',
  description:
    'List members of a specific campaign. Returns leads and contacts added to the campaign with their membership status.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    campaignId: z.string().describe('Salesforce Campaign ID (starts with 701)'),
    pageSize: z.number().optional().describe('Results per page (default 25)'),
    pageToken: z
      .string()
      .optional()
      .describe(
        'Cursor token for pagination. Use nextPageToken/previousPageToken from a previous response.',
      ),
    sortBy: z
      .array(z.string())
      .optional()
      .describe(
        'Array of field API names to sort by, e.g. ["CampaignMember.Status"]. Prefix with "-" for descending.',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific CampaignMember fields to return, e.g. ["CampaignMember.Id", "CampaignMember.Status"]. Uses "CampaignMember.FieldName" format. Defaults to common fields (Name, Status, Title, CompanyOrAccount, LeadOrContactId, Type, etc.).',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Additional fields to include if available. Uses "CampaignMember.FieldName" format.',
      ),
  }),
  output: z.object({
    count: z
      .number()
      .describe(
        'Number of records returned on this page (NOT total across all pages). Use nextPageToken to check for more.',
      ),
    members: z
      .array(SObjectRecord)
      .describe(
        'Array of CampaignMember records. Key fields: Id, Name, FirstName, LastName, Status, Title, CompanyOrAccount, LeadOrContactId (the lead/contact ID), Type ("Lead" or "Contact"), CreatedDate, LastModifiedDate.',
      ),
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
  notes:
    'Lists members of a specific campaign using the related list API. Requires campaignId. Members can be leads or contacts; check the Type field ("Lead" or "Contact") and LeadOrContactId to identify which record. Default fields: Name, FirstName, LastName, Status, Title, CompanyOrAccount, LeadOrContactId, Type, CreatedDate, LastModifiedDate.',
};

export type ListCampaignMembersInput = z.infer<
  typeof listCampaignMembersSchema.input
>;
export type ListCampaignMembersOutput = z.infer<
  typeof listCampaignMembersSchema.output
>;

export const addCampaignMemberSchema = {
  name: 'addCampaignMember',
  description: 'Add a lead or contact to a campaign as a CampaignMember',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    campaignId: z.string().describe('Salesforce Campaign ID'),
    leadId: z
      .string()
      .optional()
      .describe('Lead ID to add (provide either leadId or contactId)'),
    contactId: z
      .string()
      .optional()
      .describe('Contact ID to add (provide either leadId or contactId)'),
    status: z
      .string()
      .describe(
        'Member status; default picklist values are "Sent" and "Responded" but orgs can customize',
      ),
    fields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Additional CampaignMember fields beyond the explicit parameters above (e.g. custom fields)',
      ),
    allowSaveOnDuplicate: z
      .boolean()
      .optional()
      .describe(
        'When true, bypasses duplicate detection rules and saves the record even if duplicates are found (default false)',
      ),
  }),
  output: SaveResult,
  notes: 'Either leadId or contactId is required, not both.',
};

export type AddCampaignMemberInput = z.infer<
  typeof addCampaignMemberSchema.input
>;
export type AddCampaignMemberOutput = z.infer<
  typeof addCampaignMemberSchema.output
>;

export const removeCampaignMemberSchema = {
  name: 'removeCampaignMember',
  description: 'Remove a campaign member by CampaignMember ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    campaignMemberId: z.string().describe('Salesforce CampaignMember ID'),
  }),
  output: DeleteResult,
  notes:
    'The campaignMemberId is the CampaignMember record ID (starts with "00v"), not the Campaign or Contact/Lead ID. Use listCampaignMembers to find the CampaignMember ID for a given campaign.',
};

export type RemoveCampaignMemberInput = z.infer<
  typeof removeCampaignMemberSchema.input
>;
export type RemoveCampaignMemberOutput = z.infer<
  typeof removeCampaignMemberSchema.output
>;

// ============================================================================
// Case Comments
// ============================================================================

export const listCaseCommentsSchema = {
  name: 'listCaseComments',
  description:
    'List comments on a case. Returns up to 50 comments per page in newest-first order. Use pageToken for pagination.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    caseId: z.string().describe('Salesforce Case ID (starts with 500)'),
    pageToken: z
      .string()
      .optional()
      .describe(
        'Cursor token for pagination. Use nextPageToken/previousPageToken from a previous response.',
      ),
  }),
  output: z.object({
    count: z.number().describe('Total number of case comments on this case.'),
    comments: z
      .array(SObjectRecord)
      .describe(
        'Array of CaseComment records. Key fields: Id, CommentBody, IsPublished, CreatedDate, LastModifiedDate, CreatedBy (nested object with Id and Name), LastModifiedById, SystemModstamp.',
      ),
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
  notes:
    'Returns comments sorted newest-first with a fixed page size of 50 (Salesforce ignores custom pageSize and sortBy for CaseComments). CreatedBy is a nested object with Id and Name fields (not just a string ID).',
};

export type ListCaseCommentsInput = z.infer<
  typeof listCaseCommentsSchema.input
>;
export type ListCaseCommentsOutput = z.infer<
  typeof listCaseCommentsSchema.output
>;

export const addCaseCommentSchema = {
  name: 'addCaseComment',
  description: 'Add a comment to a case',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    caseId: z.string().describe('Salesforce Case ID'),
    body: z.string().describe('Comment body text'),
    richtextBody: z
      .string()
      .optional()
      .describe(
        'Rich-text (HTML) comment body. Supports HTML formatting tags like <b>, <i>, <p>, <ul>, <li>, etc. Max 131072 characters. Stored separately from the plain-text body field.',
      ),
    isPublished: z
      .boolean()
      .optional()
      .describe(
        'Whether the comment is visible to customers via portal (default false, internal only)',
      ),
  }),
  output: SaveResult,
  notes:
    'Creates an internal comment by default (isPublished: false). Set isPublished: true for customer-visible portal comments. Use richtextBody for HTML-formatted comments.',
};

export type AddCaseCommentInput = z.infer<typeof addCaseCommentSchema.input>;
export type AddCaseCommentOutput = z.infer<typeof addCaseCommentSchema.output>;

// ============================================================================
// Opportunity Line Items & Contact Roles
// ============================================================================

export const listOpportunityLineItemsSchema = {
  name: 'listOpportunityLineItems',
  description:
    'List opportunity line items (products on opportunities). Optionally filter to a specific opportunity.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    opportunityId: z
      .string()
      .optional()
      .describe(
        'Salesforce Opportunity ID (starts with 006) to filter results. When provided, only line items belonging to this opportunity are returned. When omitted, returns all recently viewed line items.',
      ),
    pageSize: z.number().optional().describe('Results per page (default 50)'),
    page: z
      .number()
      .optional()
      .describe('Page number, zero-indexed (default 0)'),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field name to sort results by. Prefix with "-" for descending order. Example: "Quantity" for ascending, "-TotalPrice" for descending. Must be a valid OpportunityLineItem field name.',
      ),
    filterName: z
      .string()
      .optional()
      .describe(
        'List view API name or ID to filter by (e.g. "__Recent"). Corresponds to saved list views for OpportunityLineItem.',
      ),
  }),
  output: z.object({
    totalCount: z
      .number()
      .describe(
        'Total number of opportunity line items in the list view (unfiltered server-side count). When opportunityId is provided, this count may be higher than the returned lineItems array because client-side filtering is applied after fetching.',
      ),
    lineItems: z
      .array(SObjectRecord)
      .describe(
        'Array of OpportunityLineItem records. Key fields: Id, Name, OpportunityId, Opportunity (nested with Id/Name/sobjectType), Product2Id, Product2 (nested with Id/Name/sobjectType), Quantity, UnitPrice, TotalPrice, ListPrice, ServiceDate, Description, ProductCode, CreatedDate, LastModifiedDate, CreatedBy (nested with Id/Name/sobjectType), LastModifiedBy (nested), CreatedById, LastModifiedById, SystemModstamp, sobjectType. Formatted display values available with __f suffix (e.g. TotalPrice__f, UnitPrice__f, ListPrice__f, CreatedDate__f, LastModifiedDate__f, ServiceDate__f).',
      ),
  }),
  notes:
    'Uses the SelectableListDataProvider (global list view) because OpportunityLineItem is not supported by the ListUi or RelatedListUi APIs. When opportunityId is provided, results are filtered client-side. For large orgs with many line items, provide opportunityId to narrow results. Default page size is 50.',
};

export type ListOpportunityLineItemsInput = z.infer<
  typeof listOpportunityLineItemsSchema.input
>;
export type ListOpportunityLineItemsOutput = z.infer<
  typeof listOpportunityLineItemsSchema.output
>;

export const addOpportunityLineItemSchema = {
  name: 'addOpportunityLineItem',
  description: 'Add a product to an opportunity as a line item',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    opportunityId: z.string().describe('Salesforce Opportunity ID'),
    pricebookEntryId: z
      .string()
      .describe(
        'PricebookEntry ID; use listPricebookEntries to find the product-pricebook-price combination',
      ),
    quantity: z.number().describe('Quantity of the product'),
    unitPrice: z.number().describe('Unit price for this line item'),
    serviceDate: z
      .string()
      .optional()
      .describe(
        'Date for the line item in YYYY-MM-DD format (e.g. delivery or service date)',
      ),
    description: z
      .string()
      .optional()
      .describe('Line description (max 255 characters)'),
    product2Id: z
      .string()
      .optional()
      .describe(
        'Product ID (Product2): direct product reference, usually set automatically from PricebookEntry',
      ),
    sortOrder: z
      .number()
      .optional()
      .describe('Sort order for display positioning of line items'),
    totalPrice: z
      .number()
      .optional()
      .describe(
        'Total price override, mutually exclusive with unitPrice (set one or the other, not both)',
      ),
  }),
  output: SaveResult,
  notes:
    'Requires a PricebookEntry; the product must be added to a pricebook first via createPricebookEntry. Set either unitPrice or totalPrice, not both.',
};

export type AddOpportunityLineItemInput = z.infer<
  typeof addOpportunityLineItemSchema.input
>;
export type AddOpportunityLineItemOutput = z.infer<
  typeof addOpportunityLineItemSchema.output
>;

export const removeOpportunityLineItemSchema = {
  name: 'removeOpportunityLineItem',
  description: 'Remove a line item from an opportunity by line item ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    lineItemId: z.string().describe('Salesforce OpportunityLineItem ID'),
  }),
  output: DeleteResult,
  notes: '',
};

export type RemoveOpportunityLineItemInput = z.infer<
  typeof removeOpportunityLineItemSchema.input
>;
export type RemoveOpportunityLineItemOutput = z.infer<
  typeof removeOpportunityLineItemSchema.output
>;

export const listOpportunityContactRolesSchema = {
  name: 'listOpportunityContactRoles',
  description: 'List opportunity contact roles with pagination and sorting',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 25)'),
    page: z
      .number()
      .optional()
      .describe('Page number, zero-indexed (default 0)'),
    sortBy: z
      .string()
      .optional()
      .describe(
        'Field name to sort by (e.g. "CreatedDate", "Role", "IsPrimary"). Prefix with "-" for descending (e.g. "-CreatedDate")',
      ),
  }),
  output: z.object({
    totalCount: z
      .number()
      .describe('Total number of opportunity contact roles'),
    contactRoles: z
      .array(
        z
          .object({
            Id: z.string().describe('OpportunityContactRole record ID'),
            Role: z
              .string()
              .nullable()
              .describe(
                'Role name (e.g. "Decision Maker", "Business User", "Executive Sponsor", "Evaluator", "Influencer", "Other", "Technical Buyer")',
              ),
            IsPrimary: z
              .boolean()
              .describe(
                'Whether this is the primary contact for the opportunity',
              ),
            OpportunityId: z.string().describe('Salesforce Opportunity ID'),
            Opportunity: z
              .object({
                Id: z.string(),
                Name: z.string(),
                sobjectType: z.string(),
              })
              .describe('Parent opportunity summary'),
            ContactId: z.string().describe('Salesforce Contact ID'),
            Contact: z
              .object({
                Id: z.string(),
                Name: z.string(),
                sobjectType: z.string(),
              })
              .describe('Associated contact summary'),
            CreatedDate: z.string().describe('ISO 8601 creation timestamp'),
            LastModifiedDate: z
              .string()
              .describe('ISO 8601 last-modified timestamp'),
            LastModifiedById: z
              .string()
              .describe('User ID of the last modifier'),
            SystemModstamp: z
              .string()
              .describe('ISO 8601 system modification timestamp'),
            sobjectType: z.string().describe('Always "OpportunityContactRole"'),
          })
          .passthrough(),
      )
      .describe('Array of OpportunityContactRole records'),
  }),
  notes:
    'Uses SelectableListDataProviderController/getItems. sortBy supports field names like CreatedDate, Role, IsPrimary, LastModifiedDate; prefix with "-" for descending.',
};

export type ListOpportunityContactRolesInput = z.infer<
  typeof listOpportunityContactRolesSchema.input
>;
export type ListOpportunityContactRolesOutput = z.infer<
  typeof listOpportunityContactRolesSchema.output
>;

export const addOpportunityContactRoleSchema = {
  name: 'addOpportunityContactRole',
  description: 'Associate a contact with an opportunity in a specific role',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    opportunityId: z.string().describe('Salesforce Opportunity ID'),
    contactId: z.string().describe('Salesforce Contact ID'),
    role: z
      .enum([
        'Business User',
        'Decision Maker',
        'Economic Buyer',
        'Economic Decision Maker',
        'Evaluator',
        'Executive Sponsor',
        'Influencer',
        'Technical Buyer',
        'Other',
      ])
      .optional()
      .describe('Role of the contact on the opportunity'),
    isPrimary: z
      .boolean()
      .optional()
      .describe(
        'Whether this contact is the primary contact for the opportunity (default false)',
      ),
  }),
  output: SaveResult,
  notes: '',
};

export type AddOpportunityContactRoleInput = z.infer<
  typeof addOpportunityContactRoleSchema.input
>;
export type AddOpportunityContactRoleOutput = z.infer<
  typeof addOpportunityContactRoleSchema.output
>;

export const removeOpportunityContactRoleSchema = {
  name: 'removeOpportunityContactRole',
  description: 'Remove a contact role from an opportunity by contact role ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    contactRoleId: z.string().describe('Salesforce OpportunityContactRole ID'),
  }),
  output: DeleteResult,
  notes:
    'The contactRoleId is the OpportunityContactRole record ID (starts with "00K"), not the Opportunity or Contact ID. Use listOpportunityContactRoles to find the ID.',
};

export type RemoveOpportunityContactRoleInput = z.infer<
  typeof removeOpportunityContactRoleSchema.input
>;
export type RemoveOpportunityContactRoleOutput = z.infer<
  typeof removeOpportunityContactRoleSchema.output
>;

// ============================================================================
// Report & Dashboard Details
// ============================================================================

export const getReportSchema = {
  name: 'getReport',
  description:
    'Get a single report by ID. Returns report metadata including Name, Description, DeveloperName, FolderName, Format, OwnerId, and date fields by default. Uses RecordUiController/getRecordWithFields.',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    reportId: z.string().describe('Salesforce Report ID'),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch in Object.Field format (e.g. ["Report.Name", "Report.Description"]). Errors if a field does not exist on the object. When specified, only these fields plus Id are returned (no defaults).',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["Report.FolderName", "Report.DeveloperName"]). Non-existent fields are silently omitted. When specified, replaces the default field set. Available fields include: Name, Description, DeveloperName, FolderName, Format, OwnerId, CreatedById, LastModifiedById, CreatedDate, LastModifiedDate, LastRunDate, LastViewedDate, LastReferencedDate, NumSubscriptions, ReportTypeEnumOrId, ShowDetails, SortAsc, SortCol, TopRows, BooleanFilter, IsDeleted, and more.',
      ),
  }),
  output: z
    .object({
      Id: z.string().describe('Salesforce Report record ID'),
      Name: z.string().optional().describe('Report display name'),
      Description: z
        .string()
        .nullable()
        .optional()
        .describe('Report description text'),
      DeveloperName: z.string().optional().describe('API name of the report'),
      FolderName: z
        .string()
        .optional()
        .describe('Name of the folder containing the report'),
      Format: z
        .string()
        .optional()
        .describe('Report format (e.g. Summary, Tabular, Matrix)'),
      OwnerId: z
        .string()
        .optional()
        .describe('ID of the folder or user that owns the report'),
      CreatedById: z
        .string()
        .optional()
        .describe('ID of the user who created the report'),
      CreatedDate: z
        .string()
        .optional()
        .describe('ISO 8601 datetime when the report was created'),
      LastModifiedById: z
        .string()
        .optional()
        .describe('ID of the user who last modified the report'),
      LastModifiedDate: z
        .string()
        .optional()
        .describe('ISO 8601 datetime when the report was last modified'),
      LastRunDate: z
        .string()
        .nullable()
        .optional()
        .describe(
          'ISO 8601 datetime when the report was last run, or null if never run',
        ),
      LastViewedDate: z
        .string()
        .nullable()
        .optional()
        .describe('ISO 8601 datetime when the report was last viewed'),
      LastReferencedDate: z
        .string()
        .nullable()
        .optional()
        .describe('ISO 8601 datetime when the report was last referenced'),
    })
    .passthrough(),
  notes:
    'With no fields/optionalFields, returns 13 default fields plus Id: Name, Description, DeveloperName, FolderName, Format, LastRunDate, OwnerId, CreatedById, CreatedDate, LastModifiedById, LastModifiedDate, LastViewedDate, LastReferencedDate. Pass fields for strict field selection (errors on invalid fields) or optionalFields to customize (silently omits invalid fields). Date fields may be null for reports that have not been run/viewed.',
};

export type GetReportInput = z.infer<typeof getReportSchema.input>;
export type GetReportOutput = z.infer<typeof getReportSchema.output>;

export const runReportSchema = {
  name: 'runReport',
  description:
    'Load a report asset and return its configuration metadata (assetId, assetType, applied filters)',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    reportId: z.string().describe('Salesforce Report ID'),
    dynamicFilters: z
      .record(
        z.string(),
        z.object({
          column: z.string().describe('API name of the column to filter on'),
          durationValue: z
            .enum([
              'CUSTOM',
              'THIS_FISCAL_YEAR',
              'LAST_FISCAL_YEAR',
              'N_FISCAL_YEARS_AGO',
              'TWO_FISCAL_YEARS_AGO',
              'NEXT_FISCAL_YEAR',
              'CURRENT_AND_PREVIOUS_FISCAL_YEAR',
              'CURRENT_AND_PREVIOUS_TWO_FISCAL_YEARS',
              'CURRENT_AND_NEXT_FISCAL_YEAR',
              'THIS_FISCAL_QUARTER',
              'CURRENT_AND_NEXT_FISCAL_QUARTER',
              'CURRENT_AND_PREVIOUS_FISCAL_QUARTER',
              'NEXT_FISCAL_QUARTER',
              'LAST_FISCAL_QUARTER',
              'CURRENT_AND_NEXT_THREE_FISCAL_QUARTERS',
              'THIS_CALENDAR_YEAR',
              'LAST_CALENDAR_YEAR',
              'N_CALENDAR_YEARS_AGO',
              'TWO_CALENDAR_YEARS_AGO',
              'NEXT_CALENDAR_YEAR',
              'CURRENT_AND_PREVIOUS_CALENDAR_YEAR',
              'CURRENT_AND_PREVIOUS_TWO_CALENDAR_YEARS',
              'CURRENT_AND_NEXT_CALENDAR_YEAR',
              'THIS_CALENDAR_QUARTER',
              'CURRENT_AND_NEXT_CALENDAR_QUARTER',
              'CURRENT_AND_PREVIOUS_CALENDAR_QUARTER',
              'NEXT_CALENDAR_QUARTER',
              'LAST_CALENDAR_QUARTER',
              'CURRENT_AND_NEXT_THREE_CALENDAR_QUARTERS',
              'LAST_MONTH',
              'THIS_MONTH',
              'NEXT_MONTH',
              'CURRENT_AND_PREVIOUS_MONTH',
              'CURRENT_AND_NEXT_MONTH',
              'LAST_WEEK',
              'THIS_WEEK',
              'NEXT_WEEK',
              'YESTERDAY',
              'TODAY',
              'TOMORROW',
              'LAST_N_DAYS',
              'NEXT_N_DAYS',
            ])
            .describe(
              'Date range duration. Use CUSTOM with startDate/endDate for arbitrary ranges',
            ),
          startDate: z
            .string()
            .nullable()
            .optional()
            .describe(
              'Start date in YYYY-MM-DD format (required when durationValue is CUSTOM)',
            ),
          endDate: z
            .string()
            .nullable()
            .optional()
            .describe(
              'End date in YYYY-MM-DD format (required when durationValue is CUSTOM)',
            ),
        }),
      )
      .optional()
      .describe(
        'Dynamic filter overrides keyed by column API name. Applies date/range filters to the report without modifying its saved definition',
      ),
    reportFilters: z
      .string()
      .optional()
      .describe(
        'Serialized JSON string of report filter overrides. Passed through to the report viewer as-is',
      ),
  }),
  output: z
    .object({
      assetId: z.string().describe('Salesforce Report ID echoed back'),
      assetType: z
        .enum(['report'])
        .describe('Asset type (always "report" for reports)'),
      dynamicFilters: z
        .record(
          z.string(),
          z.object({
            column: z.string().describe('API name of the filtered column'),
            durationValue: z.string().describe('Date range duration applied'),
            startDate: z
              .string()
              .nullable()
              .optional()
              .describe('Start date when CUSTOM duration is used'),
            endDate: z
              .string()
              .nullable()
              .optional()
              .describe('End date when CUSTOM duration is used'),
          }),
        )
        .describe(
          'Applied dynamic filters echoed back from the server. Empty object if no filters were applied',
        ),
      reportFilters: z
        .string()
        .optional()
        .describe(
          'Serialized report filter overrides echoed back, only present when passed as input',
        ),
    })
    .describe('Report asset metadata from WaveAssetRecordHomeController'),
  notes:
    'NOTE: This function does NOT return report data rows. It only loads report metadata (assetId, filters, etc.). ' +
    'To get actual report data, use `listOpportunities` or `executeGraphQL` with appropriate filters instead. ' +
    'Initializes a report asset in the Wave Analytics viewer and returns its configuration metadata. ' +
    'Does NOT return report data rows; Salesforce Lightning Web Security (LWS) prevents direct access to the Analytics REST API from browser JS. ' +
    'Use dynamicFilters to apply date-range filters by column (e.g., {"LAST_ACTIVITY": {"column": "LAST_ACTIVITY", "durationValue": "THIS_FISCAL_YEAR"}}). ' +
    'The LAST_N_DAYS and NEXT_N_DAYS durations use startDate/endDate to specify the N-day window. ' +
    'The server does not validate the report ID; an invalid ID will still return a SUCCESS response.',
};

export type RunReportInput = z.infer<typeof runReportSchema.input>;
export type RunReportOutput = z.infer<typeof runReportSchema.output>;

export const getDashboardSchema = {
  name: 'getDashboard',
  description: 'Get a single dashboard by ID with all fields',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    dashboardId: z.string().describe('Salesforce Dashboard ID'),
    layoutType: z
      .enum(['FULL', 'COMPACT'])
      .optional()
      .describe(
        'Layout type for field selection. FULL returns standard fields (Title, FolderId, Folder). COMPACT returns different fields including DashboardResultRunningUser and DashboardResultRefreshedDate. Default: FULL',
      ),
  }),
  output: SObjectRecord,
  notes: '',
};

export type GetDashboardInput = z.infer<typeof getDashboardSchema.input>;
export type GetDashboardOutput = z.infer<typeof getDashboardSchema.output>;

export const listReportFoldersSchema = {
  name: 'listReportFolders',
  description:
    'List report folders with pagination, sorting, and scope filtering',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 20)'),
    page: z.number().optional().describe('Page number, 1-indexed (default 1)'),
    scope: z
      .enum([
        'userFolders',
        'userFoldersCreatedByMe',
        'userFoldersSharedWithMe',
      ])
      .optional()
      .describe(
        'Folder scope filter. userFolders = all accessible report folders (default), userFoldersCreatedByMe = folders created by current user, userFoldersSharedWithMe = folders shared with current user',
      ),
    orderBy: z
      .enum([
        'Name',
        '-Name',
        'CreatedBy.Name',
        '-CreatedBy.Name',
        'CreatedDate',
        '-CreatedDate',
        'LastModifiedBy.Name',
        '-LastModifiedBy.Name',
        'LastModifiedDate',
        '-LastModifiedDate',
      ])
      .optional()
      .describe(
        'Sort field. Prefix with - for descending. Default: null (server default order)',
      ),
    folderId: z
      .string()
      .optional()
      .describe('Target a specific folder by ID to navigate into it'),
    searchTerm: z
      .string()
      .optional()
      .describe(
        'Search/filter folders by name. Server-side substring match on folder names.',
      ),
    includeWritableFoldersOnly: z
      .boolean()
      .optional()
      .describe(
        'When true, only returns folders the current user can write to. WARNING: returns a reduced field set (only Id, Name, ParentId, sobjectType; no CreatedBy, LastModifiedBy, DeveloperName, Type, or dates). Default: false',
      ),
    userIsEntityCreator: z
      .boolean()
      .optional()
      .describe(
        'When true, filters to folders containing entities created by the current user. Default: false',
      ),
  }),
  output: z.object({
    totalCount: z
      .number()
      .describe('Total number of report folders matching the scope'),
    folders: z
      .array(
        z
          .object({
            Id: z.string().describe('Folder record ID'),
            Name: z.string().describe('Folder display name'),
            sobjectType: z.string().describe('Always "Folder"'),
            Type: z
              .string()
              .optional()
              .describe(
                'Folder type, e.g. "Report". Absent when includeWritableFoldersOnly=true',
              ),
            DeveloperName: z
              .string()
              .optional()
              .describe(
                'API name of the folder. Absent when includeWritableFoldersOnly=true',
              ),
            CreatedBy: z
              .object({
                Id: z.string(),
                Name: z.string(),
                sobjectType: z.string(),
              })
              .optional()
              .describe(
                'User who created the folder. Absent when includeWritableFoldersOnly=true',
              ),
            CreatedById: z
              .string()
              .optional()
              .describe(
                'ID of the creator. Absent when includeWritableFoldersOnly=true',
              ),
            CreatedDate: z
              .string()
              .optional()
              .describe(
                'ISO 8601 creation timestamp. Absent when includeWritableFoldersOnly=true',
              ),
            LastModifiedBy: z
              .object({
                Id: z.string(),
                Name: z.string(),
                sobjectType: z.string(),
              })
              .optional()
              .describe(
                'User who last modified the folder. Absent when includeWritableFoldersOnly=true',
              ),
            LastModifiedById: z
              .string()
              .optional()
              .describe(
                'ID of last modifier. Absent when includeWritableFoldersOnly=true',
              ),
            LastModifiedDate: z
              .string()
              .optional()
              .describe(
                'ISO 8601 last modified timestamp. Absent when includeWritableFoldersOnly=true',
              ),
            ParentId: z
              .string()
              .nullable()
              .optional()
              .describe(
                'Parent folder ID, null for top-level. Only present when includeWritableFoldersOnly=true',
              ),
          })
          .passthrough(),
      )
      .describe('Array of report Folder records'),
  }),
  notes:
    'Uses FolderHomeController.getRecords for server-side filtering by entity type. Page is 1-indexed (not 0-indexed). orderBy supports - prefix for descending sort. searchTerm filters by folder name. When includeWritableFoldersOnly=true, the response contains a reduced field set (Id, Name, ParentId, sobjectType only; no metadata fields like CreatedBy, LastModifiedBy, DeveloperName, Type, or dates).',
};

export type ListReportFoldersInput = z.infer<
  typeof listReportFoldersSchema.input
>;
export type ListReportFoldersOutput = z.infer<
  typeof listReportFoldersSchema.output
>;

export const listDashboardFoldersSchema = {
  name: 'listDashboardFolders',
  description:
    'List dashboard folders with pagination, sorting, and scope filtering',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    pageSize: z.number().optional().describe('Results per page (default 20)'),
    page: z.number().optional().describe('Page number, 1-indexed (default 1)'),
    scope: z
      .enum([
        'userFolders',
        'userFoldersCreatedByMe',
        'userFoldersSharedWithMe',
      ])
      .optional()
      .describe(
        'Folder scope filter. userFolders = all accessible folders, userFoldersCreatedByMe = only folders created by current user, userFoldersSharedWithMe = only folders shared with current user. Default: userFolders',
      ),
    orderBy: z
      .string()
      .optional()
      .describe(
        'Sort field name. Prefix with - for descending (e.g. "-CreatedDate"). Known values: Name, CreatedDate, -CreatedDate, CreatedBy.Name, LastModifiedDate, -LastModifiedDate, LastModifiedBy.Name. Default: null (server default)',
      ),
    folderId: z
      .string()
      .optional()
      .describe('Target a specific folder by ID to navigate into it'),
    includeWritableFoldersOnly: z
      .boolean()
      .optional()
      .describe(
        'When true, only returns folders the current user can write to. WARNING: returns a reduced field set (only Id, Name, ParentId, sobjectType; no CreatedBy, LastModifiedBy, DeveloperName, Type, or dates). Default: false',
      ),
  }),
  output: z.object({
    totalCount: z
      .number()
      .describe('Total number of dashboard folders matching the scope'),
    folders: z
      .array(
        z
          .object({
            Id: z.string().describe('Folder record ID'),
            Name: z.string().describe('Folder display name'),
            sobjectType: z.string().describe('Always "Folder"'),
            Type: z
              .string()
              .optional()
              .describe(
                'Folder type, e.g. "Dashboard". Absent when includeWritableFoldersOnly=true',
              ),
            DeveloperName: z
              .string()
              .optional()
              .describe(
                'API name of the folder. Absent when includeWritableFoldersOnly=true',
              ),
            CreatedBy: z
              .object({
                Id: z.string(),
                Name: z.string(),
                sobjectType: z.string(),
              })
              .optional()
              .describe(
                'User who created the folder. Absent when includeWritableFoldersOnly=true',
              ),
            CreatedById: z
              .string()
              .optional()
              .describe(
                'ID of the creator. Absent when includeWritableFoldersOnly=true',
              ),
            CreatedDate: z
              .string()
              .optional()
              .describe(
                'ISO 8601 creation timestamp. Absent when includeWritableFoldersOnly=true',
              ),
            LastModifiedBy: z
              .object({
                Id: z.string(),
                Name: z.string(),
                sobjectType: z.string(),
              })
              .optional()
              .describe(
                'User who last modified the folder. Absent when includeWritableFoldersOnly=true',
              ),
            LastModifiedById: z
              .string()
              .optional()
              .describe(
                'ID of last modifier. Absent when includeWritableFoldersOnly=true',
              ),
            LastModifiedDate: z
              .string()
              .optional()
              .describe(
                'ISO 8601 last modified timestamp. Absent when includeWritableFoldersOnly=true',
              ),
            ParentId: z
              .string()
              .nullable()
              .optional()
              .describe(
                'Parent folder ID, null for top-level. Only present when includeWritableFoldersOnly=true',
              ),
          })
          .passthrough(),
      )
      .describe('Array of dashboard Folder records'),
  }),
  notes:
    'Uses FolderHomeController.getRecords for server-side filtering by entity type. Page is 1-indexed (not 0-indexed). orderBy supports - prefix for descending sort. When includeWritableFoldersOnly=true, the response contains a reduced field set (Id, Name, ParentId, sobjectType only; no metadata fields like CreatedBy, LastModifiedBy, DeveloperName, Type, or dates).',
};

export type ListDashboardFoldersInput = z.infer<
  typeof listDashboardFoldersSchema.input
>;
export type ListDashboardFoldersOutput = z.infer<
  typeof listDashboardFoldersSchema.output
>;

// ============================================================================
// Record Utilities: Merge
// ============================================================================

export const mergeRecordsSchema = {
  name: 'mergeRecords',
  description: 'Merge duplicate records into a master record',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    masterRecordId: z
      .string()
      .describe('ID of the master record to merge into'),
    duplicateRecordIds: z
      .array(z.string())
      .describe('IDs of duplicate records to merge and delete'),
    objectApiName: z
      .string()
      .describe('API name of the object (e.g. "Account", "Contact", "Lead")'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the merge succeeded'),
  }),
  notes:
    'Uses speculative MergeController Aura descriptor. Verify via CDP if the merge fails.',
};

export type MergeRecordsInput = z.infer<typeof mergeRecordsSchema.input>;
export type MergeRecordsOutput = z.infer<typeof mergeRecordsSchema.output>;

// ============================================================================
// Segments: Get
// ============================================================================

export const getSegmentSchema = {
  name: 'getSegment',
  description: 'Get a single marketing segment record by ID',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    recordId: z
      .string()
      .describe(
        'Segment record ID. Must be an actual Segment record; the function validates the object type and throws if the ID belongs to a different object.',
      ),
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
        'Record mode. VIEW returns read-only data, EDIT returns data with recordLayout metadata for form rendering, CREATE returns a template for new record creation. Default: VIEW',
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        'Specific fields to fetch (e.g. ["MarketSegment.Name", "MarketSegment.SegmentStatus"]). Uses RecordUiController/getRecordWithFields when specified. Field names must use ObjectName.FieldName format',
      ),
    optionalFields: z
      .array(z.string())
      .optional()
      .describe(
        'Optional fields to include if available (e.g. ["MarketSegment.Description"]). Non-existent fields are silently omitted. Uses RecordUiController/getRecordWithFields when specified',
      ),
    childRelationships: z
      .array(z.string())
      .optional()
      .describe(
        'Child relationship names to include inline (e.g. ["Lead.CampaignMembers", "Opportunity.OpportunityLineItems"]). Format: ObjectApiName.RelationshipName. Returns paginated child records. Only works with the getRecordWithLayouts path; requires layoutTypes to be specified. Silently ignored on the DetailController path.',
      ),
    recordTypeId: z
      .string()
      .optional()
      .describe(
        'Record type ID to filter fields by record type layout (e.g., "012000000000000AAA" for master record type). Controls which page layout is used for field selection.',
      ),
    updateMru: z
      .boolean()
      .optional()
      .describe(
        'When true, adds the record to the Most Recently Used list. Observed in Salesforce Lightning UI record detail page loads. Only applies to the DetailController path (when fields/optionalFields/childRelationships are not specified).',
      ),
    defaultFieldValues: z
      .record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      )
      .optional()
      .describe(
        'Default field values to apply when rendering the record form. Typically used with mode CREATE to pre-populate fields. Only applies to the DetailController path.',
      ),
    layoutTypes: z
      .array(z.enum(['Full', 'Compact']))
      .optional()
      .describe(
        'Layout types for field selection via RecordUiController/getRecordWithLayouts. Full returns all layout fields (27+ fields), Compact returns key fields (8 fields). When specified without fields/optionalFields, uses the getRecordWithLayouts path which auto-selects fields based on layout. Can be combined with optionalFields for additional fields beyond the layout. Values are PascalCase: "Full", "Compact".',
      ),
    modes: z
      .array(z.enum(['View', 'Edit', 'Create']))
      .optional()
      .describe(
        'Record access modes when using RecordUiController/getRecordWithLayouts. Determines which fields are returned based on the layout for each mode. Requires layoutTypes to be specified. Values are PascalCase: "View", "Edit", "Create". Default: ["View"].',
      ),
    pageSize: z
      .number()
      .optional()
      .describe(
        'Number of child relationship records per page. Default is 5. Only applies when childRelationships is specified on the getRecordWithLayouts path (requires layoutTypes).',
      ),
  }),
  output: SObjectRecord,
  notes:
    'Use listSegments() to discover available segment IDs. Validates that the record is actually a MarketSegment; passing a non-Segment ID throws an error.',
};

export type GetSegmentInput = z.infer<typeof getSegmentSchema.input>;
export type GetSegmentOutput = z.infer<typeof getSegmentSchema.output>;

// ============================================================================
// Search: GraphQL
// ============================================================================

export const executeGraphQLSchema = {
  name: 'executeGraphQL',
  description: 'Execute a GraphQL query against the Salesforce GraphQL API',
  input: z.object({
    auraToken: AuraTokenParam,
    auraContext: AuraContextParam,
    query: z.string().describe('GraphQL query string'),
    variables: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Query variables'),
    operationName: z
      .string()
      .optional()
      .describe(
        'Name of the GraphQL operation to execute (useful when the query contains multiple operations)',
      ),
    extensions: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'GraphQL protocol extensions map (accepted per spec, currently unused by Salesforce)',
      ),
  }),
  output: z
    .object({
      data: z
        .record(z.string(), z.unknown())
        .describe('GraphQL response data; structure depends on the query'),
      errors: z
        .array(
          z.object({
            message: z.string(),
            locations: z
              .array(z.object({ line: z.number(), column: z.number() }))
              .optional(),
            paths: z.array(z.string()).optional(),
            extensions: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .describe('GraphQL errors (empty array when successful)'),
      extensions: z
        .record(z.string(), z.unknown())
        .describe('GraphQL protocol extensions'),
    })
    .describe('Standard GraphQL response with data, errors, and extensions'),
  notes:
    'Salesforce GraphQL API uses the `uiapi` namespace. All queries must be wrapped in `{ uiapi { ... } }`. ' +
    'Field values are wrapped in `{ value, displayValue }` objects. ' +
    'Example: `{ uiapi { query { Account { edges { node { Name { value } Id } } } } } }`. ' +
    'Supports variables for parameterized queries. ' +
    'Check the `errors` array; a non-empty array means the query had validation or execution errors even though the call succeeded.',
};

export type ExecuteGraphQLInput = z.infer<typeof executeGraphQLSchema.input>;
export type ExecuteGraphQLOutput = z.infer<typeof executeGraphQLSchema.output>;

// ============================================================================
// Export Schema List
// ============================================================================

export const allSchemas = [
  // Context
  getContextSchema,
  // Accounts
  listAccountsSchema,
  getAccountSchema,
  createAccountSchema,
  updateAccountSchema,
  deleteAccountSchema,
  // Contacts
  listContactsSchema,
  getContactSchema,
  createContactSchema,
  updateContactSchema,
  deleteContactSchema,
  // Opportunities
  listOpportunitiesSchema,
  getOpportunitySchema,
  createOpportunitySchema,
  updateOpportunitySchema,
  deleteOpportunitySchema,
  // Leads
  listLeadsSchema,
  getLeadSchema,
  createLeadSchema,
  updateLeadSchema,
  deleteLeadSchema,
  // Cases
  listCasesSchema,
  getCaseSchema,
  createCaseSchema,
  updateCaseSchema,
  deleteCaseSchema,
  // Campaigns
  listCampaignsSchema,
  getCampaignSchema,
  createCampaignSchema,
  updateCampaignSchema,
  deleteCampaignSchema,
  // Products
  listProductsSchema,
  getProductSchema,
  createProductSchema,
  updateProductSchema,
  deleteProductSchema,
  // Search
  globalSearchSchema,
  searchRecordsSchema,
  listRecordsSchema,
  getRecordSchema,
  // Tasks
  listTasksSchema,
  getTaskSchema,
  createTaskSchema,
  updateTaskSchema,
  deleteTaskSchema,
  // Notes
  createNoteSchema,
  // Events
  listEventsSchema,
  getEventSchema,
  createEventSchema,
  updateEventSchema,
  // Activities (Call & Email Logging)
  logCallSchema,
  logEmailSchema,
  // ContentDocumentLink
  linkNoteToRecordSchema,
  // Users (read-only)
  listUsersSchema,
  getUserSchema,
  // Reports & Dashboards (read-only)
  listReportsSchema,
  listDashboardsSchema,
  // Commerce
  listCommerceChannelsSchema,
  getCommerceChannelSchema,
  listCommerceProductsSchema,
  listProductCategoriesSchema,
  listOrderSummariesSchema,
  getOrderSummarySchema,
  listPromotionsSchema,
  getPromotionSchema,
  // Quick Text
  listQuickTextSchema,
  getQuickTextSchema,
  createQuickTextSchema,
  updateQuickTextSchema,
  deleteQuickTextSchema,
  // Segments & Marketing
  listSegmentsSchema,
  getSegmentSchema,
  createSegmentSchema,
  updateSegmentSchema,
  deleteSegmentSchema,
  convertLeadSchema,
  listConsentImportsSchema,
  listSubscriptionsSchema,
  // Schema & Metadata
  listCustomObjectsSchema,
  getObjectInfoSchema,
  listObjectFieldsSchema,
  getPicklistValuesSchema,
  listValidationRulesSchema,
  getObjectPropertiesSchema,
  // Flows
  listFlowsSchema,
  activateFlowSchema,
  deactivateFlowSchema,
  // Security & Admin
  getCompanyInfoSchema,
  getSecurityHealthCheckSchema,
  // Record Utilities (Sales Core Extensions)
  getRelatedListsSchema,
  getMergeCandidatesSchema,
  getActivitiesSchema,
  // Change Data Capture
  listCDCEntitiesSchema,
  enableCDCSchema,
  getAvailableCDCEntitiesSchema,
  // Contracts
  ...contractSchemas,
  // Orders
  ...orderSchemas,
  // Assets
  ...assetSchemas,
  // Pricebooks
  ...pricebookSchemas,
  // Knowledge
  ...knowledgeSchemas,
  // Email Templates
  ...emailTemplateSchemas,
  // Chatter
  ...chatterSchemas,
  // Files
  ...fileSchemas,
  // Approvals
  ...approvalSchemas,
  // Campaign Members
  listCampaignMembersSchema,
  addCampaignMemberSchema,
  removeCampaignMemberSchema,
  // Case Comments
  listCaseCommentsSchema,
  addCaseCommentSchema,
  // Opportunity Line Items & Contact Roles
  listOpportunityLineItemsSchema,
  addOpportunityLineItemSchema,
  removeOpportunityLineItemSchema,
  listOpportunityContactRolesSchema,
  addOpportunityContactRoleSchema,
  removeOpportunityContactRoleSchema,
  // Report & Dashboard Details
  getReportSchema,
  runReportSchema,
  getDashboardSchema,
  listReportFoldersSchema,
  listDashboardFoldersSchema,
  // Record Utilities: Merge
  mergeRecordsSchema,
  // (segment schemas already in Segments & Marketing section above)
  // Search: GraphQL
  executeGraphQLSchema,
  // List Views
  ...listViewSchemas,
  // Relationship & Association Management
  ...relationshipSchemas,
  // Duplicate Detection & Management
  ...duplicateSchemas,
  // Pipeline & Stage Management
  ...pipelineSchemas,
  // Custom Field & Picklist Management
  ...fieldSchemas,
];
