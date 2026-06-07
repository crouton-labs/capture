import { z } from 'zod';

export const libraryDescription =
  'HubSpot CRM, Marketing, Sales, Service, Commerce, and Reporting operations';

export const libraryIcon = '/icons/libs/hubspot.png';
export const loginUrl = 'https://app.hubspot.com';

export const libraryNotes = `
## Workflow

1. Navigate to any HubSpot page (e.g., \`https://app.hubspot.com/myaccounts\`)
2. Call \`getContext()\`
   - If on wrong domain (e.g., app.hubspot.com instead of app-na2.hubspot.com), it auto-redirects and throws "NAVIGATING" error
   - **Call \`getContext()\` again after redirect completes**
3. Use csrf and portalId for all other operations

## CRITICAL: Property Access Pattern

All CRM objects (contacts, companies, deals, tickets, products, quotes) return properties as **top-level fields**, NOT nested under a \`properties\` key.

\`\`\`javascript
// ✅ CORRECT
const deal = await getDeal({ csrf, portalId, dealId });
console.log(deal.dealname, deal.amount, deal.dealstage);

const contact = await getContact({ csrf, portalId, contactId });
console.log(contact.firstname, contact.email);

// ❌ WRONG: properties is NOT a field
deal.properties.dealname    // undefined
contact.properties.email    // undefined
\`\`\`

This applies to all get/list/query functions: \`getContact\`, \`getDeal\`, \`listDeals\`, \`queryCrm\`, etc.

**Domain note:** HubSpot uses regional subdomains (app-na2, app-eu1, etc.). Target the portal's actual domain when possible, not just "hubspot.com".

## Pagination

HubSpot uses offset-based pagination: \`count\` (page size, default 25) and \`offset\` (starting position, default 0). Increment offset by count for each page.

## Plan Detection

Call \`getHubAccess()\` to check which hubs and tiers the user has access to before attempting hub-specific operations. Returns marketing, sales, service, content, operations, commerce with tier (free/starter/professional/enterprise) and trial status.

## Object Type IDs

- Contact: 0-1
- Company: 0-2
- Deal: 0-3
- Ticket: 0-5
- Product: 0-7
- Line Item: 0-8
- Quote: 0-14
- Task: 0-27

## Search Strategy

- **Find by name** → \`globalSearch()\`
- **Find related objects** → \`getAssociations()\` (contacts at a company, deals on a contact, etc.)
- **List all** → \`listContacts()\`, \`listCompanies()\`, \`listDeals()\`, \`listTickets()\`
- **Get single** → \`getContact()\`, \`getCompany()\`, \`getDeal()\`, \`getTicket()\`
- **Search with filters** → \`queryCrm()\` (any object type, SQL-like WHERE clause)

## Associations (Related Objects)

Use \`getAssociations()\` to find related objects between any CRM types (contacts↔companies, deals↔contacts, etc.). Returns full object details with properties, not just IDs.

Company associations are stored as HubSpot associations, NOT as contact properties. \`queryCrm()\` with \`associatedcompanyid\` will NOT work; use \`getAssociations()\` instead.

## Property Discovery

When creating or updating CRM objects, many properties use internal enum values rather than display labels. If you're unsure of a property name or valid value:
- \`getPropertyMappings({ objectType })\`: lists all available properties (including custom fields) with their internal names and display labels
- \`getPropertyOptions({ objectType, propertyName })\`: lists valid values for a specific enum property (e.g. industry, lifecyclestage, dealstage)

Always look up properties before guessing. Common pitfalls: \`industry\` needs \`COMPUTER_SOFTWARE\` not "Technology", \`lifecyclestage\` needs \`salesqualifiedlead\` not "SQL".

## Pipelines

Use \`listPipelines()\` to discover pipeline IDs and stage IDs before creating tickets or deals.

## Segments (Lists)

HubSpot calls these "segments" in the UI but "lists" in the API. Static segments support \`addToList()\` and \`removeFromList()\` for manual membership. Dynamic (active) segments auto-populate from filters.

## Sequences

Sequences require Sales Professional or higher. Email templates are used for sequence steps. Use \`createTemplate()\` to create templates, then reference template IDs in sequence steps.

## Datetime Handling

All date/time values are auto-converted to epoch milliseconds. You can pass dates in any format:
- ISO string: \`"2025-03-15T10:00:00Z"\`
- Date string: \`"2025-03-15"\`
- Epoch ms: \`"1710489600000"\`

This applies to all \`properties\` records (contacts, deals, companies, tickets) and engagement metadata (\`startTime\`, \`endTime\`).

## Ownership

When creating contacts, deals, companies, tickets, or tasks, set \`hubspot_owner_id\` to the current user so the record appears in their "My" views. \`getContext()\` returns \`userId\`; use that as the owner ID.
`;

// ============================================================================
// Rate Limits
// ============================================================================

export const rateLimits: Record<
  string,
  Array<{ window: 'MINUTE' | 'HOUR' | 'DAY'; maxCalls: number; message: string }>
> = {
  enrollContact: [
    { window: 'MINUTE', maxCalls: 20, message: 'HubSpot enrollment API limits' },
  ],
  createSequence: [
    { window: 'HOUR', maxCalls: 30, message: 'Avoid mass-sequence creation flags' },
  ],
  runReport: [
    { window: 'MINUTE', maxCalls: 5, message: 'Report queries are expensive; cap to protect tenant' },
  ],
};

// ============================================================================
// Common Parameters
// ============================================================================

const CsrfParam = z.string().describe('CSRF token from getContext()');
const PortalIdParam = z.string().describe('Portal ID from getContext()');

// ============================================================================
// Context
// ============================================================================

export const getAccountsSchema = {
  name: 'getAccounts',
  description:
    'List all HubSpot portals the current user has access to (the account picker list)',
  notes:
    'No parameters required. Returns every portal the logged-in user can switch to.',
  input: z.object({}),
  output: z.array(
    z
      .object({
        portalId: z.string().describe('Portal ID'),
        name: z.string().describe('Portal/account name'),
        hublet: z.string().describe('Regional cluster (e.g., "na2", "eu1")'),
        appDomain: z
          .string()
          .describe('Base URL for this portal (e.g., "app-na2.hubspot.com")'),
      })
      .passthrough(),
  ),
};
export type GetAccountsInput = z.infer<typeof getAccountsSchema.input>;
export type GetAccountsOutput = z.infer<typeof getAccountsSchema.output>;

export const getContextSchema = {
  name: 'getContext',
  description: 'Get CSRF token and portal context - call FIRST',
  notes: '',
  input: z
    .object({
      timeoutMs: z.number().default(10000),
    })
    .partial(),
  output: z
    .object({
      csrf: z.string(),
      portalId: z.string(),
      hublet: z.string(),
      appDomain: z.string(),
      userId: z.string().describe('Current user ID (for enrollment)'),
      userEmail: z.string().describe('Current user email'),
    })
    .passthrough(),
};
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// Search
// ============================================================================

export const globalSearchSchema = {
  name: 'globalSearch',
  description: 'Search across all HubSpot CRM objects by keyword',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    query: z.string(),
    types: z
      .array(
        z.enum([
          'CONTACT',
          'COMPANY',
          'DEAL',
          'TICKET',
          'NOTE',
          'CALL',
          'EMAIL',
          'MEETING',
          'TASK',
        ]),
      )
      .optional(),
    locale: z.string().optional(),
    offset: z.number().optional(),
    limit: z.number().optional(),
  }),
  output: z
    .object({
      sections: z.array(
        z
          .object({
            resultType: z.string(),
            results: z.array(
              z
                .object({
                  resultId: z.string(),
                  properties: z.record(z.string(), z.unknown()),
                })
                .passthrough(),
            ),
            total: z.number(),
          })
          .passthrough(),
      ),
      query: z.string(),
    })
    .passthrough(),
};
export type GlobalSearchInput = z.infer<typeof globalSearchSchema.input>;
export type GlobalSearchOutput = z.infer<typeof globalSearchSchema.output>;

// ============================================================================
// Contacts
// ============================================================================

export const listContactsSchema = {
  name: 'listContacts',
  description: 'List contacts with pagination',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    count: z.number().optional().default(25),
    offset: z.number().optional().default(0),
  }),
  output: z
    .object({
      total: z.number(),
      offset: z.number(),
      count: z.number(),
      contacts: z
        .array(z.record(z.string(), z.string()))
        .describe(
          'Contact records with properties as top-level fields. Access directly: contact.id, contact.firstname, contact.email (NOT contact.properties.firstname). Common properties: id, firstname, lastname, email, phone, jobtitle, lifecyclestage, createdate, lastmodifieddate',
        ),
    })
    .passthrough(),
};
export type ListContactsInput = z.infer<typeof listContactsSchema.input>;
export type ListContactsOutput = z.infer<typeof listContactsSchema.output>;

export const getContactSchema = {
  name: 'getContact',
  description: 'Get a contact by ID with all properties',
  notes:
    'Properties are returned as top-level fields (e.g., `contact.firstname`, `contact.email`), NOT nested under a `properties` key.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    contactId: z.string(),
  }),
  output: z
    .object({
      id: z.string(),
      objectTypeId: z.string(),
      firstname: z.string().optional().describe('First name'),
      lastname: z.string().optional().describe('Last name'),
      email: z.string().optional().describe('Email address'),
      phone: z.string().optional().describe('Phone number'),
      jobtitle: z.string().optional().describe('Job title'),
      company: z.string().optional().describe('Company name'),
      lifecyclestage: z.string().optional().describe('Lifecycle stage'),
      createdate: z.string().optional().describe('Creation date'),
      lastmodifieddate: z.string().optional().describe('Last modified date'),
    })
    .passthrough()
    .describe(
      'Contact with all properties as top-level fields. Access directly: contact.firstname, contact.email, etc.',
    ),
};
export type GetContactInput = z.infer<typeof getContactSchema.input>;
export type GetContactOutput = z.infer<typeof getContactSchema.output>;

export const createContactSchema = {
  name: 'createContact',
  description:
    'Create a new contact with optional associations and flexible properties',
  notes: `Common properties: \`firstname\`, \`lastname\`, \`phone\`, \`jobtitle\`, \`company\`, \`hubspot_owner_id\`, \`lifecyclestage\`. Supports custom fields; see Property Discovery in library notes.`,
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    email: z.string().describe('Contact email (required)'),
    properties: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Additional contact properties (firstname, lastname, phone, jobtitle, hubspot_owner_id, lifecyclestage, etc.). Supports custom fields.',
      ),
  }),
  output: z
    .object({
      objectId: z.number(),
      _rawResponse: z.unknown().optional(),
    })
    .passthrough(),
};
export type CreateContactInput = z.infer<typeof createContactSchema.input>;
export type CreateContactOutput = z.infer<typeof createContactSchema.output>;

export const updateContactSchema = {
  name: 'updateContact',
  description: 'Update contact properties',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    contactId: z.string(),
    properties: z.record(z.string(), z.string()),
  }),
  output: z
    .object({
      updated: z.literal(true),
      contactId: z.string(),
      properties: z.record(z.string(), z.string()),
    })
    .passthrough(),
};
export type UpdateContactInput = z.infer<typeof updateContactSchema.input>;
export type UpdateContactOutput = z.infer<typeof updateContactSchema.output>;

export const deleteContactSchema = {
  name: 'deleteContact',
  description: 'Delete a contact by ID',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    contactId: z.string(),
  }),
  output: z.void(),
};
export type DeleteContactInput = z.infer<typeof deleteContactSchema.input>;
export type DeleteContactOutput = z.infer<typeof deleteContactSchema.output>;

// ============================================================================
// Companies
// ============================================================================

export const listCompaniesSchema = {
  name: 'listCompanies',
  description: 'List companies with pagination',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    count: z.number().optional().default(25),
    offset: z.number().optional().default(0),
  }),
  output: z
    .object({
      total: z.number(),
      count: z.number(),
      companies: z
        .array(z.record(z.string(), z.string()))
        .describe(
          'Company records with properties as top-level fields. Access directly: company.id, company.name, company.domain (NOT company.properties.name). Common properties: id, name, domain, industry, phone, city, state, country, numberofemployees, annualrevenue, createdate',
        ),
    })
    .passthrough(),
};
export type ListCompaniesInput = z.infer<typeof listCompaniesSchema.input>;
export type ListCompaniesOutput = z.infer<typeof listCompaniesSchema.output>;

export const getCompanySchema = {
  name: 'getCompany',
  description: 'Get a company by ID with all properties',
  notes:
    'Properties are returned as top-level fields (e.g., `company.name`, `company.domain`), NOT nested under a `properties` key.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    companyId: z.string(),
  }),
  output: z
    .object({
      id: z.string(),
      name: z.string().optional().describe('Company name'),
      domain: z.string().optional().describe('Website domain'),
      industry: z.string().optional().describe('Industry'),
      phone: z.string().optional().describe('Phone number'),
      city: z.string().optional().describe('City'),
      state: z.string().optional().describe('State/Region'),
      country: z.string().optional().describe('Country'),
      numberofemployees: z.string().optional().describe('Number of employees'),
      annualrevenue: z.string().optional().describe('Annual revenue'),
      createdate: z.string().optional().describe('Creation date'),
    })
    .passthrough()
    .describe(
      'Company with all properties as top-level fields. Access directly: company.name, company.domain, etc.',
    ),
};
export type GetCompanyInput = z.infer<typeof getCompanySchema.input>;
export type GetCompanyOutput = z.infer<typeof getCompanySchema.output>;

export const updateCompanySchema = {
  name: 'updateCompany',
  description: 'Update company properties',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    companyId: z.string(),
    properties: z.record(z.string(), z.string()),
  }),
  output: z
    .object({
      updated: z.literal(true),
      companyId: z.string(),
      properties: z.record(z.string(), z.string()),
    })
    .passthrough(),
};
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema.input>;
export type UpdateCompanyOutput = z.infer<typeof updateCompanySchema.output>;

export const deleteCompanySchema = {
  name: 'deleteCompany',
  description: 'Archive/delete a company by ID',
  notes:
    'Archives the company (HubSpot soft-delete). The company will no longer appear in listCompanies or searches, but getCompany may still return it with null properties.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    companyId: z.string(),
  }),
  output: z
    .object({
      deleted: z.boolean(),
      status: z.number(),
    })
    .passthrough(),
};
export type DeleteCompanyInput = z.infer<typeof deleteCompanySchema.input>;
export type DeleteCompanyOutput = z.infer<typeof deleteCompanySchema.output>;

export const createCompanySchema = {
  name: 'createCompany',
  description: 'Create a new company with flexible properties',
  notes: `Common properties: \`domain\`, \`industry\`, \`phone\`, \`city\`, \`state\`, \`country\`, \`description\`, \`hubspot_owner_id\`, \`numberofemployees\`, \`annualrevenue\`. Supports custom fields; see Property Discovery in library notes.`,
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    name: z.string().describe('Company name (required)'),
    properties: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Additional company properties (domain, industry, phone, city, state, country, description, hubspot_owner_id, etc.). Supports custom fields.',
      ),
  }),
  output: z
    .object({
      objectId: z.number(),
      _rawResponse: z.unknown().optional(),
    })
    .passthrough(),
};
export type CreateCompanyInput = z.infer<typeof createCompanySchema.input>;
export type CreateCompanyOutput = z.infer<typeof createCompanySchema.output>;

// ============================================================================
// Associations
// ============================================================================

export const getAssociationsSchema = {
  name: 'getAssociations',
  description:
    'Get associated objects with full details between any CRM types (contacts↔companies, deals↔contacts, etc.)',
  notes:
    'Use this to find related objects, e.g., contacts at a company, deals on a contact. Returns full object details (not just IDs). Use plural names: "contacts", "companies", "deals", "tickets". Smart property defaults per type if properties not specified.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z
      .string()
      .describe(
        'Source object type as plural name (e.g., "companies", "deals")',
      ),
    objectId: z
      .string()
      .describe('Source object ID: use the `id` field from list/get functions'),
    toObjectType: z
      .string()
      .describe('Target object type (e.g., "contacts", "deals")'),
    properties: z
      .array(z.string())
      .optional()
      .describe(
        'Properties to fetch on target objects. Defaults per type: contacts: firstname, lastname, email, jobtitle, phone, lifecyclestage, createdate; companies: name, domain, industry, city, phone, lifecyclestage, createdate; deals: dealname, amount, dealstage, closedate, pipeline, createdate; tickets: subject, content, hs_pipeline_stage, hs_ticket_priority, createdate',
      ),
    count: z.number().optional().describe('Page size (default 100)'),
    offset: z.number().optional().describe('Pagination offset (default 0)'),
  }),
  output: z
    .object({
      total: z.number().describe('Total number of associated objects'),
      hasMore: z.boolean().describe('Whether more results are available'),
      offset: z.number().describe('Offset for next page'),
      results: z
        .array(
          z
            .object({
              id: z.string().describe('The associated object ID'),
            })
            .passthrough(),
        )
        .describe(
          'Associated objects with properties as top-level fields (e.g., { id, firstname, lastname, email, ... })',
        ),
    })
    .passthrough(),
};
export type GetAssociationsInput = z.infer<typeof getAssociationsSchema.input>;
export type GetAssociationsOutput = z.infer<
  typeof getAssociationsSchema.output
>;

export const getAssociationLabelsSchema = {
  name: 'getAssociationLabels',
  description: 'Get available association type labels between two object types',
  notes:
    'Common defaults: contact↔company=1, deal→contact=3, deal→company=5, ticket→contact=16, ticket→company=26. Only call this if you need custom or non-standard association types.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z
      .string()
      .describe('Source object type (e.g., "companies", "deals")'),
    toObjectType: z.string().describe('Target object type (e.g., "contacts")'),
  }),
  output: z.array(
    z
      .object({
        category: z.string(),
        typeId: z.number(),
        label: z.string(),
      })
      .passthrough(),
  ),
};

export const createAssociationSchema = {
  name: 'createAssociation',
  description: 'Create an association between two objects',
  notes:
    'Common associationType values: contact↔company=1, deal→contact=3, deal→company=5, ticket→contact=16, ticket→company=26. Use getAssociationLabels() only for custom types. Param is objectType (not fromObjectType).',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z.string().describe('Source object type (e.g., "companies")'),
    objectId: z.string(),
    toObjectType: z.string().describe('Target object type (e.g., "contacts")'),
    toObjectId: z.string(),
    associationType: z
      .number()
      .describe('Association type ID from getAssociationLabels()'),
  }),
  output: z.void(),
};

export const deleteAssociationSchema = {
  name: 'deleteAssociation',
  description: 'Delete an association between two objects',
  notes:
    'Same associationType values as createAssociation: deal→contact=3, deal→company=5, etc.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z.string().describe('Source object type (e.g., "companies")'),
    objectId: z.string(),
    toObjectType: z.string().describe('Target object type (e.g., "contacts")'),
    toObjectId: z.string(),
    associationType: z.number().describe('Association type ID'),
  }),
  output: z.void(),
};

// ============================================================================
// Deals
// ============================================================================

export const listDealsSchema = {
  name: 'listDeals',
  description: 'List deals with pagination',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    count: z.number().optional().default(25),
    offset: z.number().optional().default(0),
  }),
  output: z
    .object({
      total: z.number(),
      offset: z.number(),
      count: z.number(),
      deals: z
        .array(z.record(z.string(), z.string()))
        .describe(
          'Deal records with properties as top-level fields. Access directly: deal.id, deal.dealname, deal.amount (NOT deal.properties.dealname). Common properties: id, dealname, amount, dealstage, pipeline, closedate, hubspot_owner_id, createdate',
        ),
    })
    .passthrough(),
};
export type ListDealsInput = z.infer<typeof listDealsSchema.input>;
export type ListDealsOutput = z.infer<typeof listDealsSchema.output>;

export const getDealSchema = {
  name: 'getDeal',
  description: 'Get a deal by ID with all properties',
  notes:
    'Properties are returned as top-level fields (e.g., `deal.dealname`, `deal.amount`), NOT nested under a `properties` key.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    dealId: z.string(),
  }),
  output: z
    .object({
      id: z.string(),
      objectTypeId: z.string(),
      dealname: z.string().optional().describe('Deal name'),
      amount: z.string().optional().describe('Deal amount'),
      dealstage: z.string().optional().describe('Deal stage ID'),
      pipeline: z.string().optional().describe('Pipeline ID'),
      closedate: z.string().optional().describe('Expected close date'),
      hubspot_owner_id: z.string().optional().describe('Owner user ID'),
      createdate: z.string().optional().describe('Creation date'),
    })
    .passthrough()
    .describe(
      'Deal with all properties as top-level fields. Access directly: deal.dealname, deal.amount, etc.',
    ),
};
export type GetDealInput = z.infer<typeof getDealSchema.input>;
export type GetDealOutput = z.infer<typeof getDealSchema.output>;

export const updateDealSchema = {
  name: 'updateDeal',
  description: 'Update deal properties',
  notes:
    'Date properties (closedate, createdate, etc.) are auto-converted to epoch ms. Pass dates in any format.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    dealId: z.string(),
    properties: z.record(z.string(), z.string()),
  }),
  output: z
    .object({
      updated: z.literal(true),
      dealId: z.string(),
      properties: z.record(z.string(), z.string()),
    })
    .passthrough(),
};
export type UpdateDealInput = z.infer<typeof updateDealSchema.input>;
export type UpdateDealOutput = z.infer<typeof updateDealSchema.output>;

export const deleteDealSchema = {
  name: 'deleteDeal',
  description: 'Delete a deal by ID',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    dealId: z.string(),
  }),
  output: z.void(),
};
export type DeleteDealInput = z.infer<typeof deleteDealSchema.input>;
export type DeleteDealOutput = z.infer<typeof deleteDealSchema.output>;

export const createDealSchema = {
  name: 'createDeal',
  description:
    'Create a new deal with optional contact/company associations and flexible properties',
  notes: `Always set \`hubspot_owner_id\` so the deal appears in someone's pipeline. Use \`getPropertyMappings({ objectType: "deals" })\` to discover all available properties including custom fields.

Common properties:
- \`hubspot_owner_id\` - Deal owner (user ID, not email). **Critical** - unassigned deals don't appear in pipelines.
- \`dealstage\` - Stage in pipeline (default: "appointmentscheduled")
- \`pipeline\` - Pipeline ID (default: "default")
- \`amount\` - Deal value
- \`closedate\` - Expected close date (any date format, auto-converted to epoch ms)
- \`description\` - Deal notes
- \`dealtype\` - Type (e.g., "newbusiness", "existingbusiness")`,
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    dealname: z.string().describe('Deal name (required)'),
    contactId: z
      .string()
      .optional()
      .describe('Contact ID to associate with the deal'),
    companyId: z
      .string()
      .optional()
      .describe('Company ID to associate with the deal'),
    properties: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Additional deal properties (hubspot_owner_id, amount, dealstage, closedate, etc.). Supports custom fields.',
      ),
  }),
  output: z
    .object({
      objectId: z.number(),
      _rawResponse: z.unknown().optional(),
    })
    .passthrough(),
};
export type CreateDealInput = z.infer<typeof createDealSchema.input>;
export type CreateDealOutput = z.infer<typeof createDealSchema.output>;

// ============================================================================
// Tickets
// ============================================================================

export const listTicketsSchema = {
  name: 'listTickets',
  description: 'List support tickets with pagination',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    count: z.number().optional().default(25),
    offset: z.number().optional().default(0),
  }),
  output: z
    .object({
      total: z.number(),
      offset: z.number(),
      count: z.number(),
      tickets: z
        .array(z.record(z.string(), z.string()))
        .describe(
          'Ticket records with properties as top-level fields. Access directly: ticket.id, ticket.subject (NOT ticket.properties.subject). Common properties: id, subject, content, hs_pipeline, hs_pipeline_stage, hs_ticket_priority, createdate',
        ),
    })
    .passthrough(),
};

export const getTicketSchema = {
  name: 'getTicket',
  description: 'Get a ticket by ID with all properties',
  notes:
    'Properties are returned as top-level fields (e.g., `ticket.subject`, `ticket.content`), NOT nested under a `properties` key.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    ticketId: z.string(),
  }),
  output: z
    .object({
      id: z.string(),
      objectTypeId: z.string(),
      subject: z.string().optional().describe('Ticket subject'),
      content: z.string().optional().describe('Ticket description/body'),
      hs_pipeline: z.string().optional().describe('Pipeline ID'),
      hs_pipeline_stage: z.string().optional().describe('Pipeline stage ID'),
      hs_ticket_priority: z
        .string()
        .optional()
        .describe('Priority (HIGH, MEDIUM, LOW)'),
      createdate: z.string().optional().describe('Creation date'),
    })
    .passthrough()
    .describe(
      'Ticket with all properties as top-level fields. Access directly: ticket.subject, ticket.content, etc.',
    ),
};

export const createTicketSchema = {
  name: 'createTicket',
  description:
    'Create a new support ticket with optional associations and flexible properties',
  notes: `Common properties: \`hs_pipeline\` (default "0"), \`hs_pipeline_stage\` (default "1"), \`hs_ticket_priority\` (HIGH/MEDIUM/LOW), \`content\`, \`hubspot_owner_id\`. Use listPipelines() for pipeline/stage IDs. Supports custom fields; see Property Discovery in library notes.`,
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    subject: z.string().describe('Ticket subject (required)'),
    contactId: z.string().optional().describe('Contact ID to associate'),
    companyId: z.string().optional().describe('Company ID to associate'),
    properties: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Additional ticket properties (hs_pipeline, hs_pipeline_stage, hs_ticket_priority, content, hubspot_owner_id, etc.). Supports custom fields.',
      ),
  }),
  output: z
    .object({
      objectId: z.number(),
      _rawResponse: z.unknown().optional(),
    })
    .passthrough(),
};
export type CreateTicketInput = z.infer<typeof createTicketSchema.input>;
export type CreateTicketOutput = z.infer<typeof createTicketSchema.output>;

export const updateTicketSchema = {
  name: 'updateTicket',
  description: 'Update ticket properties',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    ticketId: z.string(),
    properties: z.record(z.string(), z.string()),
  }),
  output: z
    .object({
      updated: z.literal(true),
      ticketId: z.string(),
      properties: z.record(z.string(), z.string()),
    })
    .passthrough(),
};

export const deleteTicketSchema = {
  name: 'deleteTicket',
  description: 'Delete a ticket by ID',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    ticketId: z.string(),
  }),
  output: z.void(),
};

// ============================================================================
// Engagements
// ============================================================================

export const listEngagementsSchema = {
  name: 'listEngagements',
  description: 'List engagements for a contact, company, or deal',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z.enum(['CONTACT', 'COMPANY', 'DEAL']),
    objectId: z.string(),
    engagementType: z
      .enum(['NOTE', 'EMAIL', 'INCOMING_EMAIL', 'CALL', 'MEETING', 'TASK'])
      .optional()
      .describe(
        'Filter by engagement type. INCOMING_EMAIL = inbound emails received from contacts. EMAIL = outbound emails sent to contacts.',
      ),
  }),
  output: z
    .object({
      total: z.number(),
      engagements: z.array(
        z
          .object({
            id: z.number(),
            type: z.string(),
            createdAt: z.string(),
            subject: z.string().optional(),
            body: z.string().optional(),
            status: z.string().optional(),
            durationMs: z.number().optional(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
};
export type ListEngagementsInput = z.infer<typeof listEngagementsSchema.input>;
export type ListEngagementsOutput = z.infer<
  typeof listEngagementsSchema.output
>;

export const createEngagementSchema = {
  name: 'createEngagement',
  description: 'Create an engagement (note, call, email, meeting, task)',
  notes:
    'Use engagementType NOTE to create notes (pass note text as content). For MEETING type, pass startTime/endTime in metadata (any date format, auto-converted to epoch ms). Defaults to now + 1 hour if omitted.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z.enum(['CONTACT', 'COMPANY', 'DEAL']),
    objectId: z.string(),
    engagementType: z.enum(['NOTE', 'EMAIL', 'CALL', 'MEETING', 'TASK']),
    content: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  output: z
    .object({
      engagementId: z.number(),
    })
    .passthrough(),
};
export type CreateEngagementInput = z.infer<
  typeof createEngagementSchema.input
>;
export type CreateEngagementOutput = z.infer<
  typeof createEngagementSchema.output
>;

export const updateEngagementSchema = {
  name: 'updateEngagement',
  description: 'Update an existing engagement',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    engagementId: z.string(),
    content: z.string(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  output: z.void(),
};
export type UpdateEngagementInput = z.infer<
  typeof updateEngagementSchema.input
>;
export type UpdateEngagementOutput = z.infer<
  typeof updateEngagementSchema.output
>;

export const deleteEngagementSchema = {
  name: 'deleteEngagement',
  description: 'Delete an engagement by ID',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    engagementId: z.string(),
  }),
  output: z.void(),
};
export type DeleteEngagementInput = z.infer<
  typeof deleteEngagementSchema.input
>;
export type DeleteEngagementOutput = z.infer<
  typeof deleteEngagementSchema.output
>;

// ============================================================================
// Activity & Property History
// ============================================================================

const ObjectTypeParam = z
  .enum(['CONTACT', 'COMPANY', 'DEAL', 'TICKET'])
  .describe('CRM object type');

export const getTimelineSchema = {
  name: 'getTimeline',
  description:
    'Get the activity timeline for a CRM record: includes property changes, deal stage changes, lifecycle stage changes, sequence events, engagements, and object creation events',
  notes:
    'Returns system-generated activity (property changes, stage moves, etc.) plus engagements. Use listEngagements if you only need notes/emails/calls. Paginate via startTimestamp (pass nextTimestamp from previous response).',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: ObjectTypeParam,
    objectId: z.string().describe('CRM object ID'),
    count: z.number().optional().describe('Max events to return (default 20)'),
    startTimestamp: z
      .number()
      .optional()
      .describe('Pagination cursor: use nextTimestamp from previous response'),
  }),
  output: z.object({
    events: z
      .array(
        z
          .object({
            timestamp: z.number().describe('Event timestamp in epoch ms'),
            type: z
              .string()
              .describe(
                'Event type: eventEngagement, eventLifecycleStage, dealstageChange, dealCreated, eventSequence, eventObjectCreated',
              ),
            id: z.string().describe('Unique event ID'),
          })
          .passthrough()
          .describe(
            'Event object. Additional fields vary by type: engagementType/subject/body (eventEngagement), value/source/changedBy (stage changes), sequenceId/state/sequenceName (eventSequence)',
          ),
      )
      .describe('Timeline events in reverse chronological order'),
    hasMore: z.boolean(),
    nextTimestamp: z
      .number()
      .optional()
      .describe('Pass as startTimestamp for next page'),
  }),
};
export type GetTimelineInput = z.infer<typeof getTimelineSchema.input>;
export type GetTimelineOutput = z.infer<typeof getTimelineSchema.output>;

export const getPropertyHistorySchema = {
  name: 'getPropertyHistory',
  description:
    'Get the full change history for properties on a CRM record: shows every value change with timestamp, source, and who made the change',
  notes:
    'Returns up to 45 versions per property for contacts, 20 for other objects. If properties array is omitted, returns history for all properties that have multiple versions.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: ObjectTypeParam,
    objectId: z.string().describe('CRM object ID'),
    properties: z
      .array(z.string())
      .optional()
      .describe(
        'Property names to get history for (e.g. ["lifecyclestage", "dealstage"]). Omit for all properties with changes.',
      ),
  }),
  output: z.object({
    objectId: z.string(),
    history: z
      .record(
        z.string(),
        z.object({
          currentValue: z.string().describe('Current property value'),
          versions: z.array(
            z.object({
              value: z.string().describe('Property value at this point'),
              timestamp: z
                .number()
                .describe('When the change occurred (epoch ms)'),
              source: z
                .string()
                .describe(
                  'Change source: CRM_UI, API, INTEGRATION, WORKFLOW, IMPORT, etc.',
                ),
              sourceId: z
                .string()
                .optional()
                .describe('Source identifier (e.g. userId:12345)'),
              updatedByUserId: z
                .number()
                .optional()
                .describe('HubSpot user ID who made the change'),
            }),
          ),
        }),
      )
      .describe(
        'Property history keyed by property name. Each entry has currentValue and versions array (newest first).',
      ),
  }),
};
export type GetPropertyHistoryInput = z.infer<
  typeof getPropertyHistorySchema.input
>;
export type GetPropertyHistoryOutput = z.infer<
  typeof getPropertyHistorySchema.output
>;

// ============================================================================
// Property Mappings
// ============================================================================

export const getPropertyMappingsSchema = {
  name: 'getPropertyMappings',
  description:
    'Get all property definitions for an object type with internal/display label mappings',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z.enum(['contacts', 'companies', 'deals', 'tickets']),
  }),
  output: z
    .object({
      objectType: z.string(),
      properties: z.array(
        z
          .object({
            name: z.string(),
            label: z.string(),
            type: z.string(),
            fieldType: z.string(),
            groupName: z.string(),
            hidden: z.boolean(),
            hubspotDefined: z.boolean(),
            options: z
              .array(
                z
                  .object({
                    value: z.string(),
                    label: z.string(),
                    displayOrder: z.number(),
                    hidden: z.boolean(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      ),
      renamedOptions: z.array(
        z
          .object({
            propertyName: z.string(),
            propertyLabel: z.string(),
            value: z.string(),
            label: z.string(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
};
export type GetPropertyMappingsInput = z.infer<
  typeof getPropertyMappingsSchema.input
>;
export type GetPropertyMappingsOutput = z.infer<
  typeof getPropertyMappingsSchema.output
>;

export const getPropertyOptionsSchema = {
  name: 'getPropertyOptions',
  description:
    'Get internal/external name mappings for a specific property (e.g., lifecyclestage)',
  notes:
    'Call before queryCrm when filtering on enumeration fields. Users say "MQL" but API needs internal value like "marketingqualifiedlead". Options use `internal`/`external` keys (NOT `value`/`label`). Use `opt.internal` for API filters and `opt.external` to match user-facing names.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z
      .enum(['contacts', 'companies', 'deals', 'tickets'])
      .describe('CRM object type'),
    propertyName: z
      .string()
      .describe(
        'Internal property name (e.g., "lifecyclestage", "relationship_type__blank_for_customer_")',
      ),
  }),
  output: z
    .object({
      propertyName: z.string().describe('Internal property name'),
      propertyLabel: z.string().describe('Display label for the property'),
      objectType: z.string().describe('Object type queried'),
      type: z.string().describe('Property data type'),
      fieldType: z.string().describe('Field type (e.g., radio, select)'),
      options: z
        .array(
          z
            .object({
              internal: z.string().describe('Internal value used in API'),
              external: z.string().describe('Display label shown in UI'),
            })
            .passthrough(),
        )
        .describe('All option mappings for this property'),
      externalOptionsReferenceType: z
        .string()
        .optional()
        .describe(
          'External options reference type if applicable (e.g., PIPELINE_STAGE)',
        ),
    })
    .passthrough(),
};
export type GetPropertyOptionsInput = z.infer<
  typeof getPropertyOptionsSchema.input
>;
export type GetPropertyOptionsOutput = z.infer<
  typeof getPropertyOptionsSchema.output
>;

const PropertyOptionSchema = z.object({
  label: z.string().describe('Display label shown in UI'),
  value: z.string().describe('Internal value stored in HubSpot'),
  displayOrder: z.number().describe('Sort order in UI'),
  hidden: z.boolean().describe('Whether this option is hidden'),
});

const PropertyOutputSchema = z.object({
  name: z.string().describe('Internal property name'),
  label: z.string().describe('Display label'),
  type: z
    .string()
    .describe(
      'Property data type (string, number, enumeration, datetime, bool)',
    ),
  fieldType: z
    .string()
    .describe(
      'UI field type (text, textarea, number, select, radio, checkbox, booleancheckbox, date)',
    ),
  description: z.string().describe('Property description'),
  groupName: z.string().describe('Property group name'),
  formField: z.boolean().describe('Whether this property appears on forms'),
  hasUniqueValue: z
    .boolean()
    .describe('Whether values must be unique across contacts'),
  options: z
    .array(PropertyOptionSchema)
    .describe('Options for enumeration properties'),
});

const ObjectTypeWithProductsEnum = z.enum([
  'contacts',
  'companies',
  'deals',
  'tickets',
  'products',
  'line_items',
]);

export const createPropertySchema = {
  name: 'createProperty',
  description: 'Create a new custom property on a CRM object type',
  notes:
    'name must be lowercase letters, numbers, and underscores only (auto-derived from label if not provided). groupName defaults to the standard group for the object type if not specified. Enumeration types (select, radio, checkbox) require options. Boolean (booleancheckbox) auto-populates Yes/No options.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: ObjectTypeWithProductsEnum.describe(
      'CRM object type to add the property to',
    ),
    label: z.string().describe('Display label for the property'),
    name: z
      .string()
      .regex(
        /^[a-z0-9_]+$/,
        'Must be lowercase letters, numbers, and underscores only',
      )
      .optional()
      .describe(
        'Internal API name (lowercase, underscores). Auto-derived from label if omitted.',
      ),
    groupName: z
      .string()
      .optional()
      .describe(
        'Property group. Defaults to the standard group for the object type (contactinformation, companyinformation, dealinformation, ticketinformation). Override to place in a custom group.',
      ),
    type: z
      .enum(['string', 'number', 'enumeration', 'datetime', 'bool'])
      .default('string')
      .describe('Property data type'),
    fieldType: z
      .enum([
        'text',
        'textarea',
        'number',
        'select',
        'radio',
        'checkbox',
        'booleancheckbox',
        'date',
        'file',
        'calculation_equation',
      ])
      .default('text')
      .describe(
        'UI field type. text/textarea for strings, number for numbers, select/radio/checkbox for enumerations (require options), booleancheckbox for yes/no (options auto-populated), date for dates, file for file uploads, calculation_equation for calculated fields.',
      ),
    description: z.string().default('').describe('Optional description'),
    formField: z
      .boolean()
      .default(true)
      .describe('Whether this property appears on forms'),
    hasUniqueValue: z
      .boolean()
      .default(false)
      .describe('Whether values must be unique across records'),
    options: z
      .array(PropertyOptionSchema)
      .optional()
      .describe('Required for enumeration types (select, radio, checkbox)'),
  }),
  output: PropertyOutputSchema,
};
export type CreatePropertyInput = z.infer<typeof createPropertySchema.input>;
export type CreatePropertyOutput = z.infer<typeof createPropertySchema.output>;

export const updatePropertySchema = {
  name: 'updateProperty',
  description: 'Update an existing custom property on a CRM object type',
  notes:
    'Uses fetch-then-merge: fetches the current property definition and merges your changes. Only provided fields are updated. To update options on an enumeration property, pass the full replacement options array.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: ObjectTypeWithProductsEnum.describe('CRM object type'),
    propertyName: z
      .string()
      .describe('Internal property name to update (e.g., "my_property")'),
    label: z.string().optional().describe('New display label'),
    description: z.string().optional().describe('New description'),
    groupName: z.string().optional().describe('New property group'),
    formField: z.boolean().optional().describe('Whether to show on forms'),
    options: z
      .array(PropertyOptionSchema)
      .optional()
      .describe('Replacement options array for enumeration properties'),
  }),
  output: PropertyOutputSchema,
};
export type UpdatePropertyInput = z.infer<typeof updatePropertySchema.input>;
export type UpdatePropertyOutput = z.infer<typeof updatePropertySchema.output>;

export const deletePropertySchema = {
  name: 'deleteProperty',
  description: 'Delete (archive) a custom property from a CRM object type',
  notes:
    'HubSpot-defined (built-in) properties cannot be deleted. Only custom properties created by users or integrations can be archived. Deletion is permanent.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: ObjectTypeWithProductsEnum.describe('CRM object type'),
    propertyName: z
      .string()
      .describe('Internal property name to delete (e.g., "my_property")'),
  }),
  output: z.object({
    success: z.boolean(),
    propertyName: z.string().describe('Name of the deleted property'),
  }),
};
export type DeletePropertyInput = z.infer<typeof deletePropertySchema.input>;
export type DeletePropertyOutput = z.infer<typeof deletePropertySchema.output>;

// ============================================================================
// Flexible CRM Query
// ============================================================================

const FilterOperatorEnum = z.enum([
  'EQ', // Equals
  'NEQ', // Not equals
  'LT', // Less than
  'LTE', // Less than or equal
  'GT', // Greater than
  'GTE', // Greater than or equal
  'HAS_PROPERTY',
  'NOT_HAS_PROPERTY',
  'IN', // In list of values
  'NOT_IN',
]);

const CrmFilterSchema = z.object({
  property: z.string().describe('Property name to filter on'),
  operator: FilterOperatorEnum.describe('Comparison operator'),
  value: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      'Value to compare. String for most operators. For IN/NOT_IN, pass an array of strings (e.g. ["closedwon", "closedlost"]).',
    ),
  values: z
    .array(z.string())
    .optional()
    .describe(
      'Alias for value when passing an array (for IN/NOT_IN operators). Prefer using value with an array instead.',
    ),
});

export const queryCrmSchema = {
  name: 'queryCrm',
  description:
    'Search and filter CRM objects with property selection. Use this when you need to find objects matching specific criteria (e.g. deals over $10k, contacts by lifecycle stage).',
  notes:
    'Operators: EQ, NEQ, LT, LTE, GT, GTE, HAS_PROPERTY, NOT_HAS_PROPERTY, IN, NOT_IN. CONTAINS/CONTAINS_TOKEN are NOT supported; use the `query` parameter for substring/text search instead. When filtering on enumeration fields (lifecycle stage, deal stage), call getPropertyOptions() first to get internal values. Filter field name is `property` (NOT `propertyName`). Date filter values are auto-converted to epoch ms; pass any format (ISO, "YYYY-MM-DD", epoch). Example filter: `{ property: "dealstage", operator: "EQ", value: "qualifiedtobuy" }`. Date filter: `{ property: "createdate", operator: "GT", value: "2026-01-01" }`. For IN/NOT_IN: pass an array as `value`, e.g. `{ property: "dealstage", operator: "NOT_IN", value: ["closedwon", "closedlost"] }`. Association queries: use `num_associated_deals` property with GT/EQ operators to find contacts with/without deals. WARNING: Filtering by `email` (EQ) does NOT reliably filter results; HubSpot\'s GraphQL CRM search does not support exact-match filtering on the email property. To find a contact by email, use `globalSearch()` with the email address, or pass the email as the `query` parameter instead of a filter.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z
      .enum(['contacts', 'companies', 'deals', 'tickets'])
      .describe('CRM object type to query'),
    properties: z
      .array(z.string())
      .describe('Property names to return (e.g., ["name", "lifecyclestage"])'),
    filters: z.array(CrmFilterSchema).optional().describe('Filter conditions'),
    filterGroupsOperator: z
      .enum(['AND', 'OR'])
      .default('AND')
      .describe(
        'How to combine filters: AND (all must match) or OR (any can match)',
      ),
    query: z.string().optional().describe('Optional text search query'),
    sorts: z
      .array(
        z.object({
          property: z.string(),
          order: z.enum(['ASC', 'DESC']),
        }),
      )
      .optional()
      .describe('Sort order (defaults to createdate DESC)'),
    count: z.number().optional().default(100).describe('Max results to return'),
    offset: z.number().optional().default(0).describe('Pagination offset'),
  }),
  output: z
    .object({
      total: z.number().describe('Total matching records'),
      offset: z.number().describe('Current offset'),
      count: z.number().describe('Number of results returned'),
      results: z
        .array(
          z
            .object({
              id: z.string(),
            })
            .passthrough(),
        )
        .describe(
          'Array of objects with id and requested properties as top-level fields. Access properties directly: result.dealname, result.email, etc. (NOT result.properties.dealname).',
        ),
    })
    .passthrough(),
};
export type QueryCrmInput = z.infer<typeof queryCrmSchema.input>;
export type QueryCrmOutput = z.infer<typeof queryCrmSchema.output>;

const GenericObjectTypeParam = z
  .string()
  .describe(
    'Object type: standard names (contacts, companies, deals, tickets, products, quotes, tasks) or a raw objectTypeId for custom objects (e.g. "2-12345")',
  );

const GENERIC_CRUD_NOTES =
  'Use entity-specific functions (getContact, createDeal, etc.) for standard objects. Use this only for custom objects or object types without dedicated functions.';

export const getRecordSchema = {
  name: 'getRecord',
  description:
    'Get a single CRM record by object type and ID, works with any object type including custom objects',
  notes: GENERIC_CRUD_NOTES,
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: GenericObjectTypeParam,
    objectId: z.string().describe('CRM object ID'),
  }),
  output: z
    .object({
      id: z.string(),
      objectTypeId: z.string(),
    })
    .passthrough()
    .describe(
      'Record with all properties as top-level fields (same as getContact, getDeal, etc.)',
    ),
};
export type GetRecordInput = z.infer<typeof getRecordSchema.input>;
export type GetRecordOutput = z.infer<typeof getRecordSchema.output>;

export const createRecordSchema = {
  name: 'createRecord',
  description:
    'Create a CRM record of any object type including custom objects',
  notes:
    GENERIC_CRUD_NOTES +
    ' Does not support associations; use entity-specific create functions (createDeal, createTicket) when you need to associate with contacts or companies at creation time.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: GenericObjectTypeParam,
    properties: z
      .record(z.string(), z.string())
      .describe(
        'Property name-value pairs. Use getPropertyMappings() to discover available properties for the object type.',
      ),
  }),
  output: z.object({
    objectId: z.number().describe('ID of the created record'),
  }),
};
export type CreateRecordInput = z.infer<typeof createRecordSchema.input>;
export type CreateRecordOutput = z.infer<typeof createRecordSchema.output>;

export const updateRecordSchema = {
  name: 'updateRecord',
  description:
    'Update properties on a CRM record of any object type including custom objects',
  notes: GENERIC_CRUD_NOTES,
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: GenericObjectTypeParam,
    objectId: z.string().describe('CRM object ID'),
    properties: z
      .record(z.string(), z.string())
      .describe('Property name-value pairs to update'),
  }),
  output: z.void(),
};
export type UpdateRecordInput = z.infer<typeof updateRecordSchema.input>;

export const deleteRecordSchema = {
  name: 'deleteRecord',
  description:
    'Delete a CRM record of any object type including custom objects',
  notes: GENERIC_CRUD_NOTES,
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: GenericObjectTypeParam,
    objectId: z.string().describe('CRM object ID'),
  }),
  output: z.void(),
};
export type DeleteRecordInput = z.infer<typeof deleteRecordSchema.input>;

// ============================================================================
// Merge Operations
// ============================================================================

const MergeResultSchema = z
  .object({
    mergedObjectId: z
      .string()
      .describe('ID of the resulting merged object (same as primaryObjectId)'),
    primaryObjectId: z
      .string()
      .describe('ID of the primary object that was kept'),
    objectIdMerged: z
      .string()
      .describe('ID of the object that was merged and deleted'),
  })
  .passthrough();

export const mergeCompaniesSchema = {
  name: 'mergeCompanies',
  description:
    'Merge two companies into one - secondary company data moves to primary, secondary is deleted',
  notes:
    'DESTRUCTIVE: the secondary company is permanently deleted. Always confirm with the user which record to keep as primary before calling. Use findDuplicateCompanies first to identify candidates.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    primaryCompanyId: z
      .string()
      .describe('Company ID to keep (receives all merged data)'),
    companyIdToMerge: z
      .string()
      .describe('Company ID to merge into primary and delete'),
  }),
  output: MergeResultSchema,
};
export type MergeCompaniesInput = z.infer<typeof mergeCompaniesSchema.input>;
export type MergeCompaniesOutput = z.infer<typeof mergeCompaniesSchema.output>;

export const mergeContactsSchema = {
  name: 'mergeContacts',
  description:
    'Merge two contacts into one - secondary contact data moves to primary, secondary is deleted',
  notes:
    'DESTRUCTIVE: the secondary contact is permanently deleted. Always confirm with the user which record to keep as primary before calling. Use findDuplicateContacts first to identify candidates.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    primaryContactId: z
      .string()
      .describe('Contact ID to keep (receives all merged data)'),
    contactIdToMerge: z
      .string()
      .describe('Contact ID to merge into primary and delete'),
  }),
  output: MergeResultSchema,
};
export type MergeContactsInput = z.infer<typeof mergeContactsSchema.input>;
export type MergeContactsOutput = z.infer<typeof mergeContactsSchema.output>;

// ============================================================================
// Duplicate Detection
// ============================================================================

const DuplicateMatchSchema = z
  .object({
    recordA: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .passthrough()
      .describe('First record in the duplicate pair'),
    recordB: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .passthrough()
      .describe('Second record in the duplicate pair'),
    confidence: z.number().describe('Confidence score 0-100'),
    matchReasons: z
      .array(z.string())
      .describe('Reasons for match (e.g., "exact_domain", "normalized_name")'),
  })
  .passthrough();

const FindDuplicatesOutputSchema = z
  .object({
    duplicates: z
      .array(DuplicateMatchSchema)
      .describe('Array of potential duplicate pairs'),
    totalRecordsScanned: z.number().describe('Total records analyzed'),
    matchesFound: z.number().describe('Number of duplicate pairs found'),
  })
  .passthrough();

export const findDuplicateCompaniesSchema = {
  name: 'findDuplicateCompanies',
  description:
    'Find potential duplicate companies using domain, name, and phone heuristics',
  notes:
    'ALWAYS present results to the user with confidence scores and match reasons before taking any merge action. Never auto-merge. If no matches found at the default threshold, retry with a lower threshold (e.g. 1); high-confidence matches may exist below the default cutoff. Show each duplicate pair with its confidence % and match reasons so the user can decide which record to keep.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    threshold: z
      .number()
      .optional()
      .default(60)
      .describe(
        'Minimum confidence score (0-100) to include. If no results, try lowering this; matches with high confidence (e.g. 90%) can exist below the default',
      ),
    maxRecords: z
      .number()
      .optional()
      .default(500)
      .describe('Maximum records to scan (default 500)'),
  }),
  output: FindDuplicatesOutputSchema,
};
export type FindDuplicateCompaniesInput = z.infer<
  typeof findDuplicateCompaniesSchema.input
>;
export type FindDuplicateCompaniesOutput = z.infer<
  typeof findDuplicateCompaniesSchema.output
>;

export const findDuplicateContactsSchema = {
  name: 'findDuplicateContacts',
  description:
    'Find potential duplicate contacts using email, name, and phone heuristics',
  notes:
    'ALWAYS present results to the user with confidence scores and match reasons before taking any merge action. Never auto-merge. If no matches found at the default threshold, retry with a lower threshold (e.g. 1); high-confidence matches may exist below the default cutoff. Show each duplicate pair with its confidence % and match reasons so the user can decide which record to keep.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    threshold: z
      .number()
      .optional()
      .default(60)
      .describe(
        'Minimum confidence score (0-100) to include. If no results, try lowering this; matches with high confidence (e.g. 90%) can exist below the default',
      ),
    maxRecords: z
      .number()
      .optional()
      .default(500)
      .describe('Maximum records to scan (default 500)'),
  }),
  output: FindDuplicatesOutputSchema,
};
export type FindDuplicateContactsInput = z.infer<
  typeof findDuplicateContactsSchema.input
>;
export type FindDuplicateContactsOutput = z.infer<
  typeof findDuplicateContactsSchema.output
>;

// ============================================================================
// Owners
// ============================================================================

export const listOwnersSchema = {
  name: 'listOwners',
  description: 'List all owners/users in the portal',
  notes:
    'Returns all portal users who can be assigned as owners. Use the `id` field (string) as `hubspot_owner_id` when creating or updating contacts, companies, deals, or tickets.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
  }),
  output: z.array(
    z
      .object({
        id: z.string(),
        email: z.string(),
        type: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        userId: z.number(),
        userIdIncludingInactive: z.number(),
        createdAt: z.string(),
        updatedAt: z.string(),
        archived: z.boolean(),
      })
      .passthrough(),
  ),
};

// ============================================================================
// Pipelines
// ============================================================================

export const listPipelinesSchema = {
  name: 'listPipelines',
  description: 'List all pipelines and their stages for deals or tickets',
  notes:
    'Use to discover pipeline IDs and stage IDs before creating deals or tickets. Pipeline and stage IDs are in the `id` field (NOT `stageId` or `pipelineId`). Use `stage.id` as the dealstage value in queryCrm filters.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z.enum(['deals', 'tickets']).describe('Pipeline type'),
  }),
  output: z
    .object({
      results: z.array(
        z
          .object({
            id: z.string(),
            label: z.string(),
            displayOrder: z.number(),
            archived: z.boolean(),
            stages: z.array(
              z
                .object({
                  id: z.string(),
                  label: z.string(),
                  displayOrder: z.number(),
                  archived: z.boolean(),
                  metadata: z
                    .object({
                      isClosed: z.string(),
                      probability: z.string(),
                    })
                    .passthrough(),
                })
                .passthrough(),
            ),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
};

export const getPipelineSchema = {
  name: 'getPipeline',
  description: 'Get a specific pipeline by ID with its stages',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z.enum(['deals', 'tickets']).describe('Pipeline type'),
    pipelineId: z.string(),
  }),
  output: z
    .object({
      id: z.string(),
      label: z.string(),
      displayOrder: z.number(),
      archived: z.boolean(),
      stages: z.array(
        z
          .object({
            id: z.string(),
            label: z.string(),
            displayOrder: z.number(),
            archived: z.boolean(),
            metadata: z
              .object({
                isClosed: z.string(),
                probability: z.string(),
              })
              .passthrough(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
};

export const createPipelineSchema = {
  name: 'createPipeline',
  description: 'Create a new pipeline for deals or tickets with initial stages',
  notes:
    'For deal pipelines, each stage requires metadata.probability (string "0.0" to "1.0"). For ticket pipelines, stages can optionally include metadata.ticketState ("OPEN" or "CLOSED").',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z.enum(['deals', 'tickets']).describe('Pipeline type'),
    label: z.string().describe('Pipeline name'),
    displayOrder: z
      .number()
      .optional()
      .describe('Display order among pipelines (default 0)'),
    stages: z
      .array(
        z.object({
          label: z.string().describe('Stage name'),
          displayOrder: z.number().describe('Stage order within pipeline'),
          metadata: z
            .object({
              probability: z
                .string()
                .optional()
                .describe(
                  'Win probability "0.0" to "1.0" (required for deal stages)',
                ),
              ticketState: z
                .string()
                .optional()
                .describe('Ticket state: "OPEN" or "CLOSED"'),
            })
            .describe('Stage metadata'),
        }),
      )
      .describe('Initial stages for the pipeline'),
  }),
  output: z
    .object({
      id: z.string(),
      label: z.string(),
      displayOrder: z.number(),
      archived: z.boolean(),
      stages: z.array(
        z
          .object({
            id: z.string(),
            label: z.string(),
            displayOrder: z.number(),
            archived: z.boolean(),
            metadata: z
              .object({
                isClosed: z.string(),
                probability: z.string(),
              })
              .passthrough(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
};

export const updatePipelineSchema = {
  name: 'updatePipeline',
  description: 'Update a pipeline label or display order',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z.enum(['deals', 'tickets']).describe('Pipeline type'),
    pipelineId: z.string().describe('Pipeline ID to update'),
    label: z.string().optional().describe('New pipeline name'),
    displayOrder: z.number().optional().describe('New display order'),
  }),
  output: z
    .object({
      id: z.string(),
      label: z.string(),
      displayOrder: z.number(),
      archived: z.boolean(),
      stages: z.array(
        z
          .object({
            id: z.string(),
            label: z.string(),
            displayOrder: z.number(),
            archived: z.boolean(),
            metadata: z
              .object({
                isClosed: z.string(),
                probability: z.string(),
              })
              .passthrough(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
};

export const deletePipelineSchema = {
  name: 'deletePipeline',
  description: 'Delete a pipeline',
  notes:
    'Set validateReferencesBeforeDelete to true to check for existing records first. The request will fail if records exist and validation is enabled; move or delete records first.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z.enum(['deals', 'tickets']).describe('Pipeline type'),
    pipelineId: z.string().describe('Pipeline ID to delete'),
    validateReferencesBeforeDelete: z
      .boolean()
      .optional()
      .describe('Check for existing records before deleting'),
  }),
  output: z.object({}),
};

export const createPipelineStageSchema = {
  name: 'createPipelineStage',
  description: 'Add a new stage to an existing pipeline',
  notes:
    'For deal pipelines, metadata.probability is required ("0.0" to "1.0"). Stage labels must be unique within the pipeline.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z.enum(['deals', 'tickets']).describe('Pipeline type'),
    pipelineId: z.string().describe('Pipeline ID to add stage to'),
    label: z.string().describe('Stage name (must be unique in this pipeline)'),
    displayOrder: z.number().describe('Stage order within pipeline'),
    metadata: z
      .object({
        probability: z
          .string()
          .optional()
          .describe(
            'Win probability "0.0" to "1.0" (required for deal stages)',
          ),
        ticketState: z
          .string()
          .optional()
          .describe('Ticket state: "OPEN" or "CLOSED"'),
      })
      .optional()
      .describe('Stage metadata'),
  }),
  output: z
    .object({
      id: z.string(),
      label: z.string(),
      displayOrder: z.number(),
      archived: z.boolean(),
      metadata: z
        .object({
          isClosed: z.string(),
          probability: z.string(),
        })
        .passthrough(),
    })
    .passthrough(),
};

export const updatePipelineStageSchema = {
  name: 'updatePipelineStage',
  description: 'Update a stage in a pipeline (label, order, or metadata)',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z.enum(['deals', 'tickets']).describe('Pipeline type'),
    pipelineId: z.string().describe('Pipeline ID containing the stage'),
    stageId: z.string().describe('Stage ID to update'),
    label: z.string().optional().describe('New stage name'),
    displayOrder: z.number().optional().describe('New display order'),
    metadata: z
      .object({
        probability: z
          .string()
          .optional()
          .describe('Win probability "0.0" to "1.0"'),
        ticketState: z
          .string()
          .optional()
          .describe('Ticket state: "OPEN" or "CLOSED"'),
      })
      .optional()
      .describe('Updated stage metadata'),
  }),
  output: z
    .object({
      id: z.string(),
      label: z.string(),
      displayOrder: z.number(),
      archived: z.boolean(),
      metadata: z
        .object({
          isClosed: z.string(),
          probability: z.string(),
        })
        .passthrough(),
    })
    .passthrough(),
};

export const deletePipelineStageSchema = {
  name: 'deletePipelineStage',
  description: 'Delete a stage from a pipeline',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectType: z.enum(['deals', 'tickets']).describe('Pipeline type'),
    pipelineId: z.string().describe('Pipeline ID containing the stage'),
    stageId: z.string().describe('Stage ID to delete'),
  }),
  output: z.object({}),
};

// ============================================================================
// CRM Tasks
// ============================================================================

export const listTasksSchema = {
  name: 'listTasks',
  description: 'List CRM tasks with optional status filter',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    count: z.number().optional().default(25),
    offset: z.number().optional().default(0),
    status: z
      .enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'DEFERRED'])
      .optional()
      .describe('Filter by task status'),
  }),
  output: z
    .object({
      total: z.number(),
      offset: z.number(),
      count: z.number(),
      tasks: z
        .array(z.record(z.string(), z.string()))
        .describe(
          'Task records. Common properties: hs_task_subject, hs_task_body, hs_task_status, hs_task_priority, hubspot_owner_id',
        ),
    })
    .passthrough(),
};

export const createTaskSchema = {
  name: 'createTask',
  description:
    'Create a CRM task, optionally associated with a contact, company, or deal',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    subject: z.string().describe('Task subject/title'),
    body: z.string().optional().describe('Task description'),
    ownerId: z.string().optional().describe('Owner ID to assign task to'),
    dueDate: z
      .string()
      .optional()
      .describe('Due date (any format: ISO string, date string, or epoch ms)'),
    priority: z
      .enum(['NONE', 'LOW', 'MEDIUM', 'HIGH'])
      .optional()
      .describe('Task priority'),
    objectType: z
      .enum(['CONTACT', 'COMPANY', 'DEAL'])
      .optional()
      .describe('Object type to associate with'),
    objectId: z.string().optional().describe('Object ID to associate with'),
  }),
  output: z
    .object({
      taskId: z.number(),
    })
    .passthrough(),
};

export const updateTaskSchema = {
  name: 'updateTask',
  description:
    'Update a CRM task. To mark a task as completed, set status to COMPLETED.',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    taskId: z.string(),
    subject: z.string().optional(),
    body: z.string().optional(),
    status: z
      .enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'DEFERRED'])
      .optional(),
    priority: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH']).optional(),
    dueDate: z.string().optional(),
    ownerId: z
      .string()
      .optional()
      .describe(
        'Reassign to a different owner; use listOwners() to find valid IDs',
      ),
  }),
  output: z.void(),
};

export const deleteTaskSchema = {
  name: 'deleteTask',
  description: 'Permanently delete a CRM task',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    taskId: z.string(),
  }),
  output: z.void(),
};

// ============================================================================
// Contact Lists
// ============================================================================

const ListObjectSchema = z
  .object({
    listId: z.number(),
    name: z.string(),
    listType: z.enum(['STATIC', 'DYNAMIC']),
    dynamic: z.boolean(),
    archived: z.boolean().optional(),
    createdAt: z.number().optional().describe('Creation timestamp in epoch ms'),
    updatedAt: z
      .number()
      .optional()
      .describe('Last updated timestamp in epoch ms'),
    authorId: z.number().optional().describe('User ID of the list creator'),
    metaData: z
      .object({
        size: z.number().describe('Number of contacts in the list'),
        processing: z.enum(['DONE', 'PROCESSING']),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const listListsSchema = {
  name: 'listLists',
  description: 'List all contact lists (segments) with pagination',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    count: z.number().optional().default(25),
    offset: z.number().optional().default(0),
  }),
  output: z
    .object({
      offset: z.number(),
      hasMore: z.boolean(),
      lists: z.array(ListObjectSchema),
    })
    .passthrough(),
};
export type ListListsInput = z.infer<typeof listListsSchema.input>;
export type ListListsOutput = z.infer<typeof listListsSchema.output>;

export const getListSchema = {
  name: 'getList',
  description: 'Get a specific contact list (segment) by ID',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    listId: z.number(),
  }),
  output: ListObjectSchema,
};
export type GetListInput = z.infer<typeof getListSchema.input>;
export type GetListOutput = z.infer<typeof getListSchema.output>;

export const getListContactsSchema = {
  name: 'getListContacts',
  description: 'Get contacts in a list (segment) with pagination',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    listId: z.number(),
    count: z.number().optional().default(25),
    offset: z.number().optional().default(0),
  }),
  output: z
    .object({
      listId: z.number(),
      contacts: z
        .array(z.record(z.string(), z.string()))
        .describe(
          'Contact records with properties as top-level fields. Access directly: contact.id, contact.email, contact.firstname (NOT contact.properties.firstname). Includes addedAt (epoch ms when added to list).',
        ),
      offset: z.number(),
      hasMore: z.boolean(),
    })
    .passthrough(),
};
export type GetListContactsInput = z.infer<typeof getListContactsSchema.input>;
export type GetListContactsOutput = z.infer<
  typeof getListContactsSchema.output
>;

export const createListSchema = {
  name: 'createList',
  description: 'Create a new contact list (segment)',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    name: z.string().describe('List name'),
    dynamic: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'true for active list (auto-updates from filters), false for static',
      ),
    filters: z
      .array(z.array(z.record(z.string(), z.unknown())))
      .optional()
      .describe(
        'Filter groups for dynamic lists. Each inner array is an AND group, outer array is OR. Each filter: {operator, property, value, type}',
      ),
  }),
  output: ListObjectSchema,
};
export type CreateListInput = z.infer<typeof createListSchema.input>;
export type CreateListOutput = z.infer<typeof createListSchema.output>;

export const updateListSchema = {
  name: 'updateList',
  description: 'Update a contact list name or filters',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    listId: z.number(),
    name: z.string().optional().describe('New list name'),
    filters: z
      .array(z.array(z.record(z.string(), z.unknown())))
      .optional()
      .describe('New filter groups (dynamic lists only)'),
  }),
  output: ListObjectSchema,
};
export type UpdateListInput = z.infer<typeof updateListSchema.input>;
export type UpdateListOutput = z.infer<typeof updateListSchema.output>;

export const deleteListSchema = {
  name: 'deleteList',
  description: 'Delete a contact list (segment)',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    listId: z.number(),
  }),
  output: z
    .object({
      deleted: z.literal(true),
    })
    .passthrough(),
};
export type DeleteListInput = z.infer<typeof deleteListSchema.input>;

export const addToListSchema = {
  name: 'addToList',
  description: 'Add contacts to a static list',
  notes:
    'Only works with static lists. Dynamic lists are auto-populated by filters.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    listId: z.number(),
    contactIds: z.array(z.number()).describe('Contact IDs to add'),
  }),
  output: z
    .object({
      updated: z.literal(true),
      listId: z.number(),
      addedCount: z.number(),
    })
    .passthrough(),
};
export type AddToListInput = z.infer<typeof addToListSchema.input>;

export const removeFromListSchema = {
  name: 'removeFromList',
  description: 'Remove contacts from a static list',
  notes: 'Only works with static lists.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    listId: z.number(),
    contactIds: z.array(z.number()).describe('Contact IDs to remove'),
  }),
  output: z
    .object({
      updated: z.literal(true),
      listId: z.number(),
      removedCount: z.number(),
    })
    .passthrough(),
};
export type RemoveFromListInput = z.infer<typeof removeFromListSchema.input>;

// ============================================================================
// Forms
// ============================================================================

export const listFormsSchema = {
  name: 'listForms',
  description: 'List all marketing forms',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    limit: z.number().optional().default(100),
    offset: z.number().optional().default(0),
  }),
  output: z.array(
    z.object({
      guid: z.string(),
      name: z.string(),
      formType: z.string(),
      createdAt: z.number(),
    }),
  ),
};

export const getFormSchema = {
  name: 'getForm',
  description: 'Get a specific form by ID',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    formId: z.string().describe('Form GUID'),
  }),
  output: z
    .object({
      guid: z.string(),
      name: z.string(),
      formType: z.string(),
      createdAt: z.number(),
    })
    .passthrough(),
};

export const getFormSubmissionsSchema = {
  name: 'getFormSubmissions',
  description: 'Get submissions for a specific form',
  notes:
    'Only works for standard forms. Meeting forms and system-generated forms do not support submission queries.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    formId: z.string().describe('Form GUID'),
    limit: z.number().optional().default(50).describe('Max 50 per page'),
    after: z.string().optional().describe('Cursor for pagination'),
  }),
  output: z.array(
    z
      .object({
        conversionId: z.string(),
        submittedAt: z.number(),
        values: z.array(
          z
            .object({
              name: z.string(),
              value: z.string(),
              objectTypeId: z.string().optional(),
            })
            .passthrough(),
        ),
        pageUrl: z.string().optional(),
      })
      .passthrough(),
  ),
};

// ============================================================================
// Workflows
// ============================================================================

export const listWorkflowsSchema = {
  name: 'listWorkflows',
  description:
    'List all automation workflows across all object types (contacts, tickets, deals, subscriptions, etc.)',
  notes:
    'Returns workflows as CRM objects. Use objectType to filter by target object (e.g., "0-1" for contacts, "0-5" for tickets). Use the flowId from results to call getWorkflow for full detail.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    limit: z.number().optional().default(100),
    objectType: z
      .string()
      .optional()
      .describe(
        'Filter by target object type ID. Common values: "0-1" (contacts), "0-2" (companies), "0-3" (deals), "0-5" (tickets). Omit to list all.',
      ),
  }),
  output: z.array(
    z
      .object({
        id: z.string().describe('CRM object ID for this workflow'),
        name: z.string(),
        flowId: z
          .string()
          .describe('Automation platform flow ID. Pass to getWorkflow.'),
        enabled: z.boolean(),
        status: z.string().describe('ON or OFF'),
        objectTypeId: z
          .string()
          .describe(
            'Target object type (e.g., "0-1" for contacts, "0-5" for tickets)',
          ),
        sourceApp: z.string().describe('Where the workflow was created'),
        createdAt: z.string(),
        updatedAt: z.string(),
      })
      .passthrough(),
  ),
};

export const getWorkflowSchema = {
  name: 'getWorkflow',
  description:
    'Get full workflow detail including actions, triggers, and enrollment criteria',
  notes:
    'Takes a flowId (from listWorkflows), not a CRM object ID. Returns the complete automation platform flow definition.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    flowId: z
      .string()
      .describe('The automation platform flow ID from listWorkflows'),
  }),
  output: z
    .object({
      flowId: z.number(),
      name: z.string(),
      isEnabled: z.boolean(),
      objectTypeId: z.string().describe('Target object type'),
      actions: z
        .record(z.string(), z.unknown())
        .describe(
          'Map of actionId → action object. Each has actionType (TASK, EMAIL, etc.), metadata, and connection to next action.',
        ),
    })
    .passthrough()
    .describe(
      'Full flow definition. Additional properties: flowType, enrollmentCriteria, triggers, shouldReenroll, createMetadata, updateMetadata, version, associatedLists.',
    ),
};

// ============================================================================
// Account & Plan Detection
// ============================================================================

export const getSubscriptionInfoSchema = {
  name: 'getSubscriptionInfo',
  description:
    'Get detailed subscription info: paid products, active trials, and free products',
  notes:
    'Returns raw subscription data. Use getHubAccess() for a simpler hub-level summary.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
  }),
  output: z
    .object({
      paidProducts: z.array(
        z
          .object({
            name: z.string(),
            productTier: z.enum(['STARTER', 'PROFESSIONAL', 'ENTERPRISE']),
            productApiName: z.string(),
            includedProductTypes: z.array(z.string()),
          })
          .passthrough(),
      ),
      trials: z.array(
        z
          .object({
            daysRemaining: z.number(),
            endsAt: z.number(),
            product: z
              .object({
                name: z.string(),
                type: z.string(),
                productTier: z.enum(['STARTER', 'PROFESSIONAL', 'ENTERPRISE']),
              })
              .passthrough(),
          })
          .passthrough(),
      ),
      freeProducts: z.array(
        z
          .object({
            name: z.string(),
            type: z.string(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
};

export const getHubAccessSchema = {
  name: 'getHubAccess',
  description:
    'Get a simple hub-level view of which features the user can access and at what tier',
  notes:
    'Call before attempting hub-specific operations. Returns which hubs (marketing, sales, service, content, operations, commerce) are available with tier (free/starter/professional/enterprise) and trial status.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
  }),
  output: z
    .object({
      marketing: z
        .object({
          tier: z.enum(['free', 'starter', 'professional', 'enterprise']),
          isTrial: z.boolean(),
          daysRemaining: z.number().optional(),
        })
        .passthrough()
        .optional(),
      sales: z
        .object({
          tier: z.enum(['free', 'starter', 'professional', 'enterprise']),
          isTrial: z.boolean(),
          daysRemaining: z.number().optional(),
        })
        .passthrough()
        .optional(),
      service: z
        .object({
          tier: z.enum(['free', 'starter', 'professional', 'enterprise']),
          isTrial: z.boolean(),
          daysRemaining: z.number().optional(),
        })
        .passthrough()
        .optional(),
      content: z
        .object({
          tier: z.enum(['free', 'starter', 'professional', 'enterprise']),
          isTrial: z.boolean(),
          daysRemaining: z.number().optional(),
        })
        .passthrough()
        .optional(),
      operations: z
        .object({
          tier: z.enum(['free', 'starter', 'professional', 'enterprise']),
          isTrial: z.boolean(),
          daysRemaining: z.number().optional(),
        })
        .passthrough()
        .optional(),
      commerce: z
        .object({
          tier: z.enum(['free', 'starter', 'professional', 'enterprise']),
          isTrial: z.boolean(),
          daysRemaining: z.number().optional(),
        })
        .passthrough()
        .optional(),
    })
    .passthrough(),
};

export const getFeatureFlagsSchema = {
  name: 'getFeatureFlags',
  description:
    'Check which premium features (Breeze agents, enrichment, intent, workflows) are enabled on this account. Only call when you need to verify whether a specific premium feature is available before attempting to use it.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
  }),
  output: z
    .object({
      features: z.array(
        z
          .object({
            name: z.string().describe('Feature type identifier'),
            enabled: z.boolean(),
          })
          .passthrough(),
      ),
      featureStates: z
        .record(z.string(), z.boolean())
        .describe('Granular sub-feature enablement states'),
    })
    .passthrough(),
};

export const getCreditUsageSchema = {
  name: 'getCreditUsage',
  description:
    'Check HubSpot credit balance and usage for the current billing period. Only call when the user asks about credits/usage or before performing credit-consuming operations like enrichment.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
  }),
  output: z
    .object({
      startDate: z.string().describe('Billing period start date (YYYY-MM-DD)'),
      endDate: z.string().describe('Billing period end date (YYYY-MM-DD)'),
      totalCredits: z.number(),
      creditsUsed: z.number(),
      creditsRemaining: z
        .number()
        .describe('Computed: totalCredits - creditsUsed'),
      isOverageEnabled: z.boolean(),
    })
    .passthrough(),
};

// ============================================================================
// Marketing Emails
// ============================================================================

export const listMarketingEmailsSchema = {
  name: 'listMarketingEmails',
  description:
    'List marketing emails. Excludes system-generated emails (ticket emails, optin emails, etc.) by default.',
  notes:
    'Valid state values: AUTOMATED, PUBLISHED, DRAFT, SCHEDULED, AUTOMATED_DRAFT. By default, excludes system emails (ticket notifications, optin, RSS children). Set includeSystemEmails: true to see all. Subcategory values: batch (marketing), automated (workflow), ticket_closed_kickback_email, ticket_opened_kickback_email, ticket_pipeline_automated, automated_for_ticket, automated_for_leadflow, blog_email_child, rss_to_email_child, optin_email, optin_followup_email, manage_preferences_email.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    limit: z.number().optional().default(10),
    offset: z.number().optional().default(0),
    state: z
      .string()
      .optional()
      .describe(
        'Filter by email state: AUTOMATED, PUBLISHED, DRAFT, SCHEDULED, AUTOMATED_DRAFT',
      ),
    includeSystemEmails: z
      .boolean()
      .optional()
      .describe(
        'Include system-generated emails (ticket emails, optin emails, etc.). Default false.',
      ),
  }),
  output: z.array(
    z
      .object({
        id: z.number(),
        name: z.string(),
        subject: z.string(),
        currentState: z
          .string()
          .describe('Email state: AUTOMATED, PUBLISHED, DRAFT, etc.'),
        emailType: z
          .string()
          .describe(
            'Email type: BATCH_EMAIL (marketing), AUTOMATED_EMAIL (workflow), TICKET_EMAIL (system)',
          ),
        subcategory: z
          .string()
          .describe(
            'Email subcategory: batch, automated, ticket_closed_kickback_email, etc.',
          ),
        archived: z.boolean(),
        created: z.number().describe('Creation timestamp in epoch ms'),
        authorName: z.string(),
        fromName: z.string().optional().describe('Sender display name'),
        replyTo: z.string().optional().describe('Reply-to email address'),
        publishedAt: z
          .number()
          .optional()
          .describe('Publish timestamp in epoch ms'),
        subscriptionName: z
          .string()
          .optional()
          .describe('Email subscription type name'),
        category: z.number().optional().describe('Email category ID'),
      })
      .passthrough(),
  ),
};

export const getMarketingEmailSchema = {
  name: 'getMarketingEmail',
  description:
    'Get detailed information about a single marketing email including content and metadata',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    emailId: z.number(),
  }),
  output: z
    .object({
      id: z.number(),
      name: z.string(),
      subject: z.string(),
      currentState: z
        .string()
        .describe('Email state: AUTOMATED, PUBLISHED, DRAFT, etc.'),
      emailType: z
        .string()
        .describe(
          'Email type: REGULAR, AB_EMAIL, AUTOMATED_EMAIL, TICKET_EMAIL, etc.',
        ),
      archived: z.boolean(),
      created: z.number().describe('Creation timestamp in epoch ms'),
      authorName: z.string(),
      fromName: z.string().optional().describe('Sender display name'),
      replyTo: z.string().optional().describe('Reply-to email address'),
      publishedAt: z
        .number()
        .optional()
        .describe('Publish timestamp in epoch ms'),
      publishedById: z.number().optional().describe('User ID who published'),
      primaryRichTextModuleHtml: z
        .string()
        .optional()
        .describe('HTML content of the email body'),
      templatePath: z
        .string()
        .optional()
        .describe('Template used for rendering'),
      subscriptionName: z
        .string()
        .optional()
        .describe('Email subscription type name'),
      category: z.number().optional().describe('Email category ID'),
      subcategory: z.string().optional().describe('Email subcategory'),
    })
    .passthrough(),
};

export const getEmailStatsSchema = {
  name: 'getEmailStats',
  description: 'Get performance statistics for a marketing email',
  notes:
    'Only works for sent marketing emails. Draft or automated/transactional emails return 404. Returns counters (absolute numbers) and ratios (percentages 0-100).',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    emailId: z.number(),
  }),
  output: z.object({
    emailId: z.number(),
    counters: z
      .object({
        sent: z.number(),
        delivered: z.number(),
        open: z.number().describe('Unique opens'),
        click: z.number().describe('Unique clicks'),
        unsubscribed: z.number(),
        spamreport: z.number(),
        reply: z.number(),
        selected: z.number().describe('Total recipients selected for send'),
        pending: z.number(),
        contactslost: z.number(),
        notsent: z.number(),
      })
      .passthrough(),
    ratios: z
      .object({
        openratio: z.number().describe('Open rate percentage (0-100)'),
        clickratio: z.number().describe('Click rate percentage (0-100)'),
        clickthroughratio: z
          .number()
          .describe('Click-through rate (clicks/opens) percentage'),
        deliveredratio: z.number().describe('Delivery rate percentage'),
        unsubscribedratio: z.number(),
        bounceratio: z.number(),
        replyratio: z.number(),
      })
      .passthrough(),
  }),
};

// ============================================================================
// Commerce (Products, Quotes, Line Items)
// ============================================================================

export const listProductsSchema = {
  name: 'listProducts',
  description: 'List products with pagination',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    count: z.number().optional().default(25),
    offset: z.number().optional().default(0),
  }),
  output: z
    .object({
      total: z.number(),
      offset: z.number(),
      count: z.number(),
      products: z
        .array(z.record(z.string(), z.string()))
        .describe(
          'Product records. Common properties: name, price, description, hs_sku, createdate',
        ),
    })
    .passthrough(),
};

export const getProductSchema = {
  name: 'getProduct',
  description: 'Get a product by ID with all properties',
  notes:
    'Properties are returned as top-level fields (e.g., `product.name`, `product.price`), NOT nested under a `properties` key.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    productId: z.string(),
  }),
  output: z
    .object({
      id: z.string(),
      objectTypeId: z.string(),
      name: z.string().optional().describe('Product name'),
      price: z.string().optional().describe('Product price'),
      description: z.string().optional().describe('Product description'),
      hs_sku: z.string().optional().describe('SKU identifier'),
      createdate: z.string().optional().describe('Creation date'),
    })
    .passthrough()
    .describe(
      'Product with all properties as top-level fields. Access directly: product.name, product.price, etc.',
    ),
};

export const createProductSchema = {
  name: 'createProduct',
  description: 'Create a new product in the product library',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    name: z.string().describe('Product name (required)'),
    price: z.string().optional().describe('Product price'),
    description: z.string().optional(),
    hs_sku: z.string().optional().describe('SKU identifier'),
  }),
  output: z
    .object({
      objectId: z.number(),
    })
    .passthrough(),
};

export const updateProductSchema = {
  name: 'updateProduct',
  description: 'Update product properties',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    productId: z.string(),
    properties: z.record(z.string(), z.string()),
  }),
  output: z
    .object({
      updated: z.literal(true),
      productId: z.string(),
      properties: z.record(z.string(), z.string()),
    })
    .passthrough(),
};

export const deleteProductSchema = {
  name: 'deleteProduct',
  description: 'Delete a product by ID',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    productId: z.string(),
  }),
  output: z.void(),
};

export const listQuotesSchema = {
  name: 'listQuotes',
  description: 'List quotes with pagination',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    count: z.number().optional().default(25),
    offset: z.number().optional().default(0),
  }),
  output: z
    .object({
      total: z.number(),
      offset: z.number(),
      count: z.number(),
      quotes: z
        .array(z.record(z.string(), z.string()))
        .describe(
          'Quote records. Common properties: hs_title, hs_expiration_date, hs_status, hs_public_url_key',
        ),
    })
    .passthrough(),
};

export const getQuoteSchema = {
  name: 'getQuote',
  description: 'Get a quote by ID with all properties',
  notes:
    'Properties are returned as top-level fields (e.g., `quote.hs_title`, `quote.hs_status`), NOT nested under a `properties` key.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    quoteId: z.string(),
  }),
  output: z
    .object({
      id: z.string(),
      objectTypeId: z.string(),
      hs_title: z.string().optional().describe('Quote title'),
      hs_expiration_date: z.string().optional().describe('Expiration date'),
      hs_status: z.string().optional().describe('Quote status'),
      hs_public_url_key: z.string().optional().describe('Public URL key'),
      createdate: z.string().optional().describe('Creation date'),
    })
    .passthrough()
    .describe(
      'Quote with all properties as top-level fields. Access directly: quote.hs_title, quote.hs_status, etc.',
    ),
};

export const listLineItemsSchema = {
  name: 'listLineItems',
  description: 'List line items with pagination',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    count: z.number().optional().default(25),
    offset: z.number().optional().default(0),
  }),
  output: z
    .object({
      total: z.number(),
      offset: z.number(),
      count: z.number(),
      lineItems: z
        .array(z.record(z.string(), z.string()))
        .describe(
          'Line item records. Common properties: name, quantity, price, amount, hs_product_id',
        ),
    })
    .passthrough(),
};

// ============================================================================
// Imports
// ============================================================================

export const listImportsSchema = {
  name: 'listImports',
  description: 'List CRM data imports (read-only)',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    limit: z.number().optional().default(25),
    offset: z.number().optional().default(0),
  }),
  output: z
    .object({
      results: z.array(
        z
          .object({
            id: z.string(),
            importName: z.string(),
            createdAt: z.string(),
            updatedAt: z.string(),
            state: z.enum([
              'DONE',
              'STARTED',
              'PROCESSING',
              'FAILED',
              'CANCELED',
            ]),
            metadata: z
              .object({
                counters: z
                  .object({
                    TOTAL_ROWS: z.number(),
                    CREATED_OBJECTS: z.number(),
                    ERRORS: z.number(),
                  })
                  .passthrough(),
              })
              .passthrough(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
};

export const getImportSchema = {
  name: 'getImport',
  description: 'Get details of a specific import by ID (read-only)',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    importId: z.string(),
  }),
  output: z
    .object({
      id: z.string(),
      importName: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
      state: z.enum(['DONE', 'STARTED', 'PROCESSING', 'FAILED', 'CANCELED']),
      metadata: z
        .object({
          counters: z
            .object({
              TOTAL_ROWS: z.number(),
              CREATED_OBJECTS: z.number(),
              ERRORS: z.number(),
            })
            .passthrough(),
        })
        .passthrough(),
    })
    .passthrough(),
};

// ============================================================================
// Reporting (Dashboards)
// ============================================================================

export const listDashboardsSchema = {
  name: 'listDashboards',
  description: 'List all reporting dashboards',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
  }),
  output: z
    .object({
      offset: z.number(),
      limit: z.number(),
      total: z.number(),
      dashboards: z.array(
        z
          .object({
            id: z.string(),
            title: z.string(),
            description: z.string().optional(),
          })
          .passthrough(),
      ),
    })
    .passthrough(),
};

export const getDashboardSchema = {
  name: 'getDashboard',
  description: 'Get a specific dashboard by ID',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    dashboardId: z.string(),
  }),
  output: z
    .object({
      id: z.string(),
      title: z.string(),
      description: z.string().optional(),
    })
    .passthrough(),
};

const ReportSchema = z.object({
  id: z.string(),
  name: z.string(),
  chartType: z.string(),
  source: z.string(),
  reportKind: z.string(),
  dataType: z.string(),
  configType: z.string(),
  active: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastViewedAt: z
    .number()
    .nullable()
    .describe(
      'Timestamp (ms) of the last view, useful when sorting by LAST_VIEWED_AT',
    ),
  dashboardId: z.number().nullable(),
  dashboardName: z.string().nullable(),
  reportOwnerId: z.number(),
  reportOwnerName: z.string(),
  accessClassification: z
    .string()
    .describe('Access level: NONE, EVERYONE, PRIVATE, or SPECIFIC'),
  favorite: z.boolean(),
  template: z.string().nullable(),
  totalViews: z.number(),
});

export const listReportsSchema = {
  name: 'listReports',
  description:
    'List saved reports, optionally filtered by dashboard, owner, date range, or access classification',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    limit: z
      .number()
      .optional()
      .describe('Number of reports to return (default 100)'),
    offset: z.number().optional().describe('Pagination offset (default 0)'),
    search: z.string().optional().describe('Filter reports by name'),
    sort: z
      .string()
      .optional()
      .describe('Legacy sort field (use sortBy + sortOrder instead)'),
    dashboardId: z
      .string()
      .optional()
      .describe('Filter to reports belonging to a specific dashboard'),
    sortBy: z
      .enum([
        'NAME',
        'REPORT_OWNER_NAME',
        'ACCESS_CLASSIFICATION',
        'LAST_VIEWED_AT',
        'UPDATED_AT',
      ])
      .optional()
      .describe('Field to sort by'),
    sortOrder: z
      .enum(['ascending', 'descending'])
      .optional()
      .describe('Sort direction'),
    updatedAtStartDate: z
      .number()
      .optional()
      .describe(
        'Filter reports updated after this Unix timestamp (ms). Defaults to epoch (all time).',
      ),
    updatedAtEndDate: z
      .number()
      .optional()
      .describe(
        'Filter reports updated before this Unix timestamp (ms). Defaults to now.',
      ),
    favorite: z
      .boolean()
      .optional()
      .describe('When true, return only favorited reports'),
    inDashboard: z
      .boolean()
      .optional()
      .describe(
        'When true, return only reports on a dashboard; when false, only reports not on any dashboard',
      ),
    reportOwnerId: z
      .string()
      .optional()
      .describe('Filter to reports owned by this user ID'),
    accessClassification: z
      .enum(['EVERYONE', 'PRIVATE', 'SPECIFIC'])
      .optional()
      .describe(
        'Filter by access level: EVERYONE (shared with all), PRIVATE (owner only), SPECIFIC (specific users/teams)',
      ),
    customReports: z
      .boolean()
      .optional()
      .describe('When true, return only custom-built reports'),
    source: z
      .literal('REPORTING')
      .optional()
      .describe('API source constant; HubSpot UI always sends REPORTING'),
  }),
  output: z.object({
    offset: z.number(),
    limit: z.number(),
    total: z.number(),
    reports: z.array(ReportSchema),
  }),
};
export type ListReportsInput = z.infer<typeof listReportsSchema.input>;
export type ListReportsOutput = z.infer<typeof listReportsSchema.output>;

export const getReportSchema = {
  name: 'getReport',
  description: 'Get a specific report by ID, including its full config',
  notes:
    'Every call increments totalViews and updates lastViewedAt/lastViewedBy; HubSpot records a view on every fetch and this cannot be suppressed.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    reportId: z.string(),
  }),
  output: z
    .object({
      id: z.string(),
      name: z.string(),
      chartType: z.string(),
      config: z
        .object({
          template: z.string().optional(),
          dataType: z.string().optional(),
          configType: z.string().optional(),
          dimensions: z.array(z.string()).optional(),
          metrics: z.array(z.record(z.string(), z.unknown())).optional(),
          filters: z.record(z.string(), z.unknown()).optional(),
          frequency: z.string().optional(),
          objectTypeId: z.string().nullable().optional(),
        })
        .passthrough(),
    })
    .passthrough(),
};
export type GetReportInput = z.infer<typeof getReportSchema.input>;
export type GetReportOutput = z.infer<typeof getReportSchema.output>;

const DatasetHeaderValueSchema = z.object({
  columnType: z.string().describe('DIMENSION or METRIC'),
  field: z.string().describe('Property name'),
  label: z.string().describe('Human-readable label'),
  format: z
    .object({ type: z.string() })
    .passthrough()
    .describe(
      'Format metadata (type: number, datetime, currency, enumeration, etc.)',
    ),
  aggregationType: z.string().optional().describe('SUM, COUNT, AVG, etc.'),
  scripted: z.boolean().describe('Whether the property is scripted/calculated'),
  shouldExport: z
    .boolean()
    .describe('Whether this column is included in exports'),
  dataSensitivity: z.string().describe('Data sensitivity level (e.g. none)'),
});

export const runReportSchema = {
  name: 'runReport',
  description: 'Execute a report and return its data rows and column metadata',
  notes:
    'Pass reportId to execute a saved report, or config to execute a custom report configuration. If both provided, config takes precedence. The config object shape matches the config field from getReport(). Reports with chartType "CUSTOM" (e.g. deal forecast widgets, engagement stream widgets) are not supported by the async resolve endpoint and will return an error; use standard AGGREGATION, TIME_SERIES, or MULTI_CONFIG report types.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    reportId: z.string().optional().describe('ID of a saved report to execute'),
    config: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Raw report config object (from getReport().config)'),
    timeoutMs: z
      .number()
      .optional()
      .describe('Max wait time for async execution in ms (default 30000)'),
    reportOptions: z
      .object({
        fetchFromCache: z
          .boolean()
          .optional()
          .describe('Use cached report results when available'),
        updateCache: z
          .boolean()
          .optional()
          .describe('Update the cache after report execution'),
        isDrilldownRequest: z
          .boolean()
          .optional()
          .describe('Mark this as a drilldown query'),
        cacheExpirationInHours: z
          .number()
          .optional()
          .describe('Cache TTL in hours'),
        reportIdForBustingCache: z
          .number()
          .optional()
          .describe('Report ID used to bust a specific cached result'),
        limit: z
          .number()
          .optional()
          .describe('Maximum number of rows to return from the dataset'),
        offset: z
          .number()
          .optional()
          .describe('Row offset for paginating large datasets'),
      })
      .optional()
      .describe('Execution options for caching and pagination'),
    dashboardId: z
      .number()
      .optional()
      .describe(
        'Dashboard ID to apply dashboard-level filter context to the report',
      ),
    insightParams: z
      .object({
        insightOptions: z.array(
          z.object({
            insightType: z
              .enum([
                'LINEAR_TRENDLINE',
                'LOGARITHMIC_TRENDLINE',
                'FORECAST_TRENDLINE',
                'ANOMALY_DETECTION',
              ])
              .describe('Type of AI insight to compute alongside the dataset'),
          }),
        ),
      })
      .optional()
      .describe('Request AI-powered insights (trendlines, anomaly detection)'),
  }),
  output: z.object({
    data: z.array(z.record(z.string(), z.unknown())),
    header: z.record(z.string(), DatasetHeaderValueSchema),
    compareData: z.array(z.record(z.string(), z.unknown())).optional(),
    compareHeader: z.record(z.string(), DatasetHeaderValueSchema).optional(),
  }),
};
export type RunReportInput = z.infer<typeof runReportSchema.input>;
export type RunReportOutput = z.infer<typeof runReportSchema.output>;

export const createReportSchema = {
  name: 'createReport',
  description: 'Create a new saved report',
  notes: `Config defines the data: configType (AGGREGATION or TIME_SERIES), dataType (CRM_OBJECT), objectTypeId (0-1=contacts, 0-2=companies, 0-3=deals, 0-5=tickets), dimensions (property names to group by), metrics ([{property, metricType: COUNT|SUM|AVG|MIN|MAX}]), filters ({dateRange, custom}), sort ([{property, order: ASC|DESC}]). TIME_SERIES requires frequency (MONTH, WEEK, DAY, QUARTER, YEAR) and a dateRange filter with value: {rangeType, rollingDays} or {rangeType, startDate, endDate}. Description goes in displayParams, not top-level.`,
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    name: z.string().describe('Report name'),
    chartType: z
      .enum([
        'COLUMN',
        'BAR',
        'LINE',
        'AREA',
        'DONUT',
        'PIE',
        'TABLE',
        'NUMBER',
        'FUNNEL',
        'SCATTER',
        'COMBO',
      ])
      .optional()
      .describe('Chart visualization type (default: COLUMN)'),
    config: z
      .record(z.string(), z.unknown())
      .describe(
        'Report configuration object. Required fields: configType ("AGGREGATION" or "TIME_SERIES"), dataType ("CRM_OBJECT"), objectTypeId (e.g. "0-1" for contacts), dimensions (array of property names), metrics (array of {property, metricType}). Optional: filters ({dateRange: {property, rangeType, value: {rangeType, rollingDays}}, custom: []}), sort ([{property, order}]), frequency (required for TIME_SERIES: "MONTH", "WEEK", "DAY", "QUARTER", "YEAR"), compare ("PRIOR_PERIOD").',
      ),
    description: z
      .string()
      .optional()
      .describe('Report description (stored in displayParams)'),
    accessClassification: z
      .enum(['EVERYONE', 'PRIVATE', 'SPECIFIC_USERS_AND_TEAMS'])
      .optional()
      .describe('Who can see the report (default: EVERYONE)'),
    dashboardId: z
      .number()
      .optional()
      .describe('Dashboard ID to add the report to'),
  }),
  output: z
    .object({
      id: z.string(),
      name: z.string(),
      chartType: z.string(),
      config: z.record(z.string(), z.unknown()),
    })
    .passthrough(),
};
export type CreateReportInput = z.infer<typeof createReportSchema.input>;
export type CreateReportOutput = z.infer<typeof createReportSchema.output>;

export const updateReportSchema = {
  name: 'updateReport',
  description: 'Update an existing report (name, config, chart type, etc.)',
  notes:
    'Fetches the existing report first, then merges your changes. Only provide fields you want to change.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    reportId: z.string().describe('Report ID to update'),
    name: z.string().optional().describe('New report name'),
    chartType: z.string().optional().describe('New chart type'),
    description: z.string().optional().describe('New description'),
    config: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Updated report configuration'),
    dashboardId: z
      .number()
      .optional()
      .describe('Move report to a different dashboard'),
  }),
  output: z
    .object({
      id: z.string(),
      name: z.string(),
      chartType: z.string(),
      config: z.record(z.string(), z.unknown()),
    })
    .passthrough(),
};
export type UpdateReportInput = z.infer<typeof updateReportSchema.input>;
export type UpdateReportOutput = z.infer<typeof updateReportSchema.output>;

export const deleteReportSchema = {
  name: 'deleteReport',
  description: 'Delete a report by ID',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    reportId: z.string().describe('Report ID to delete'),
  }),
  output: z.object({
    success: z.literal(true),
  }),
};
export type DeleteReportInput = z.infer<typeof deleteReportSchema.input>;
export type DeleteReportOutput = z.infer<typeof deleteReportSchema.output>;

// ============================================================================
// Sales Tools (Snippets, Meeting Links, Sequences)
// ============================================================================

export const listSnippetsSchema = {
  name: 'listSnippets',
  description: 'List all saved text snippets for quick insertion',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
  }),
  output: z.array(
    z
      .object({
        id: z.number(),
        name: z.string(),
        shortcut: z.string(),
        body: z.string().describe('Plain text content of the snippet'),
        htmlBody: z.string().describe('HTML version of the snippet content'),
        folderId: z.number().nullable(),
        portalId: z.number(),
        createdBy: z.number(),
        modifiedBy: z.number(),
        createdAt: z.number().describe('Epoch ms'),
        modifiedAt: z.number().describe('Epoch ms'),
        deletedAt: z
          .number()
          .nullable()
          .describe('Epoch ms, null if not deleted'),
        deletedBy: z.number().nullable(),
      })
      .passthrough(),
  ),
};

export const listMeetingLinksSchema = {
  name: 'listMeetingLinks',
  description: 'List all meeting scheduling links',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
  }),
  output: z.array(
    z
      .object({
        id: z.number(),
        portalId: z.number(),
        slug: z.string(),
        link: z.string().describe('Full meeting booking URL'),
        name: z.string(),
        active: z.boolean(),
        type: z.string().describe('e.g. PERSONAL_LINK'),
        createdAt: z.number().describe('Epoch ms'),
        modifiedAt: z.number().describe('Epoch ms'),
        customParams: z
          .object({
            durations: z
              .array(z.number())
              .optional()
              .describe('Available durations in ms'),
            timezone: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  ),
};

export const getSequenceUsageSchema = {
  name: 'getSequenceUsage',
  description: 'Get current sequence usage vs limit',
  notes: 'Requires Sales Professional or higher.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
  }),
  output: z
    .object({
      limit: z.number(),
      currentUsage: z.number(),
    })
    .passthrough(),
};
export type SequenceUsageInput = z.infer<typeof getSequenceUsageSchema.input>;
export type SequenceUsageOutput = z.infer<typeof getSequenceUsageSchema.output>;

// ============================================================================
// Sequences
// ============================================================================

export const listSequencesSchema = {
  name: 'listSequences',
  description: 'List all sequences',
  notes: 'Requires Sales Professional or higher.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    offset: z.number().optional(),
    limit: z.number().optional(),
  }),
  output: z
    .object({
      results: z.array(
        z
          .object({
            contentId: z.string().describe('Sequence ID'),
            name: z.string(),
            description: z.string().nullable().describe('User-set description'),
            createdAt: z.number(),
            updatedAt: z.number(),
            lastUsedAt: z.number().nullable(),
            userId: z.number(),
            folderId: z.string().nullable(),
            private: z
              .boolean()
              .describe('Whether the sequence is private to the owner'),
            visibleToAll: z.boolean(),
          })
          .passthrough(),
      ),
      hasMore: z.boolean(),
      offset: z.number(),
      total: z.number().describe('Count of sequences returned'),
    })
    .passthrough(),
};
export type ListSequencesInput = z.infer<typeof listSequencesSchema.input>;
export type ListSequencesOutput = z.infer<typeof listSequencesSchema.output>;

export const getSequenceSchema = {
  name: 'getSequence',
  description: 'Get sequence details including steps',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    sequenceId: z.string(),
  }),
  output: z
    .object({
      id: z.string(),
      name: z.string(),
      portalId: z.number(),
      userId: z.number(),
      createdAt: z.number().describe('Epoch ms when the sequence was created'),
      updatedAt: z
        .number()
        .describe('Epoch ms when the sequence was last updated'),
      startingStepOrder: z.number(),
      folderId: z.number().nullable(),
      deletedAt: z
        .number()
        .nullable()
        .describe('Epoch ms if soft-deleted, null otherwise'),
      sendOnWeekdays: z.boolean(),
      loggedToCrm: z.boolean(),
      enableThreading: z.boolean(),
      unsubscribeLinkType: z.string().describe('e.g. "OFFICE_DEFAULT"'),
      fromAddress: z
        .string()
        .nullable()
        .describe('Sender email override, null for default'),
      inboxAddress: z.string().nullable(),
      timezone: z
        .string()
        .nullable()
        .describe('IANA timezone, null to use account default'),
      userPlatform: z.string().describe('e.g. "SEQUENCES"'),
      steps: z.array(
        z.object({
          action: z.string(),
          delay: z.number(),
          stepOrder: z.number(),
          actionMeta: z
            .object({
              templateMeta: z.object({
                id: z.string(),
              }),
            })
            .passthrough(),
        }),
      ),
      sequenceSettings: z
        .object({
          useThreadedFollowUps: z.boolean(),
          eligibleFollowUpDays: z.string(),
          sellingStrategy: z.string(),
          sendingStrategy: z.string(),
          sendWindowStartsAtMin: z.number(),
          sendWindowEndsAtMin: z.number(),
          timeZone: z.string(),
          taskCreationStrategy: z
            .string()
            .describe('e.g. "MANUAL", "CREATE_TASKS_FOR_OWNER"'),
          taskDefaultCreationMinutesFromMidnight: z.number(),
          taskReminderMinute: z.number(),
          individualTaskRemindersEnabled: z.boolean(),
          unenrollmentSettings: z
            .object({})
            .passthrough()
            .describe('Settings controlling auto-unenrollment triggers'),
        })
        .passthrough(),
      userView: z
        .object({})
        .passthrough()
        .describe('Creator user info: firstName, lastName, email, avatarUrl'),
      dynamic: z.boolean().optional(),
    })
    .passthrough(),
};
export type GetSequenceInput = z.infer<typeof getSequenceSchema.input>;
export type GetSequenceOutput = z.infer<typeof getSequenceSchema.output>;

export const createSequenceSchema = {
  name: 'createSequence',
  description: 'Create a new sequence',
  notes:
    'For multi-step sequences: create the sequence with the first step, then call addSequenceStep for each additional step. Each step needs a templateId from createTemplate(). HubSpot auto-adds a FINISH_ENROLLMENT step. Requires at least one step. Requires Sales Professional or higher.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    name: z.string(),
    steps: z
      .array(
        z.object({
          action: z
            .enum(['SEND_TEMPLATE', 'SCHEDULE_TASK'])
            .describe('Step action type'),
          delay: z
            .number()
            .optional()
            .describe('Delay in days before this step'),
          templateId: z.string().describe('Template ID for this step'),
        }),
      )
      .min(1)
      .describe(
        'At least one step required. For multi-step sequences, pass the first step here and use addSequenceStep for additional steps.',
      ),
    useThreadedFollowUps: z.boolean().optional(),
    eligibleFollowUpDays: z
      .enum(['BUSINESS_DAYS', 'EVERYDAY', 'WEEKDAYS_ONLY'])
      .optional()
      .describe(
        'BUSINESS_DAYS = Mon-Fri, EVERYDAY = all 7 days, WEEKDAYS_ONLY = Mon-Fri (alias)',
      ),
    sellingStrategy: z
      .enum(['LEAD_BASED', 'ACCOUNT_BASED'])
      .optional()
      .describe('Selling strategy'),
    sendingStrategy: z
      .enum(['TIME_RANGE', 'HUBSPOT_RECOMMENDED', 'MANUAL'])
      .optional()
      .describe('Send timing strategy'),
    sendWindowStartsAtMin: z
      .number()
      .optional()
      .describe('Send window start (minutes from midnight, e.g., 480 = 8am)'),
    sendWindowEndsAtMin: z
      .number()
      .optional()
      .describe('Send window end (minutes from midnight, e.g., 1020 = 5pm)'),
    timeZone: z.string().optional().describe('Time zone (e.g., "US/Eastern")'),
  }),
  output: z
    .object({
      id: z.string(),
      name: z.string(),
      steps: z.array(z.unknown()),
      sequenceSettings: z.unknown(),
    })
    .passthrough(),
};
export type CreateSequenceInput = z.infer<typeof createSequenceSchema.input>;
export type CreateSequenceOutput = z.infer<typeof createSequenceSchema.output>;

export const updateSequenceSchema = {
  name: 'updateSequence',
  description: 'Update a sequence',
  notes: 'Fetches current sequence, merges changes, and PUTs back.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    sequenceId: z.string(),
    name: z.string().optional(),
    steps: z
      .array(
        z.object({
          action: z.enum(['SEND_TEMPLATE', 'SCHEDULE_TASK']),
          delay: z.number().optional(),
          templateId: z.string(),
        }),
      )
      .optional(),
    sequenceSettings: z
      .object({
        useThreadedFollowUps: z.boolean().optional(),
        eligibleFollowUpDays: z
          .enum(['BUSINESS_DAYS', 'EVERYDAY', 'WEEKDAYS_ONLY'])
          .optional()
          .describe(
            'BUSINESS_DAYS = Mon-Fri, EVERYDAY = all 7 days, WEEKDAYS_ONLY = Mon-Fri (alias)',
          ),
        sellingStrategy: z.enum(['LEAD_BASED', 'ACCOUNT_BASED']).optional(),
        sendingStrategy: z
          .enum(['TIME_RANGE', 'HUBSPOT_RECOMMENDED', 'MANUAL'])
          .optional(),
        sendWindowStartsAtMin: z.number().optional(),
        sendWindowEndsAtMin: z.number().optional(),
        timeZone: z.string().optional(),
      })
      .optional(),
  }),
  output: getSequenceSchema.output,
};
export type UpdateSequenceInput = z.infer<typeof updateSequenceSchema.input>;
export type UpdateSequenceOutput = z.infer<typeof updateSequenceSchema.output>;

export const deleteSequenceSchema = {
  name: 'deleteSequence',
  description: 'Permanently delete a sequence',
  notes: 'Uses batch DELETE endpoint. This is irreversible.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    sequenceId: z.string(),
  }),
  output: z
    .object({
      deleted: z.boolean(),
    })
    .passthrough(),
};
export type DeleteSequenceInput = z.infer<typeof deleteSequenceSchema.input>;
export type DeleteSequenceOutput = z.infer<typeof deleteSequenceSchema.output>;

export const addSequenceStepSchema = {
  name: 'addSequenceStep',
  description:
    'Add a step to an existing sequence. For multi-step sequences: createSequence with the first step, then call addSequenceStep for each additional step.',
  notes:
    'Each step needs a templateId from createTemplate(). Steps are appended in order; call once per step. HubSpot builds internal step dependencies server-side when steps are added incrementally via PUT.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    sequenceId: z.string().describe('ID of the sequence to add a step to'),
    action: z
      .enum(['SEND_TEMPLATE', 'SCHEDULE_TASK'])
      .describe('Step action type'),
    delay: z
      .number()
      .optional()
      .describe(
        'Delay in days before this step executes (0 = immediate, default 0)',
      ),
    templateId: z
      .string()
      .describe('Template ID for this step (from createTemplate)'),
  }),
  output: z
    .object({
      id: z.string(),
      name: z.string(),
      steps: z.array(z.unknown()),
      sequenceSettings: z.unknown(),
    })
    .passthrough(),
};
export type AddSequenceStepInput = z.infer<typeof addSequenceStepSchema.input>;
export type AddSequenceStepOutput = z.infer<
  typeof addSequenceStepSchema.output
>;

export const listTemplatesSchema = {
  name: 'listTemplates',
  description: 'List email templates',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    limit: z.number().optional(),
    offset: z.number().optional(),
  }),
  output: z.array(
    z
      .object({
        id: z.string(),
        name: z.string(),
        subject: z.string(),
        body: z.string(),
        createdAt: z.number(),
      })
      .passthrough(),
  ),
};
export type ListTemplatesInput = z.infer<typeof listTemplatesSchema.input>;
export type ListTemplatesOutput = z.infer<typeof listTemplatesSchema.output>;

export const getTemplateSchema = {
  name: 'getTemplate',
  description: 'Get a single email template',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    templateId: z.string(),
  }),
  output: z
    .object({
      id: z.string(),
      name: z.string(),
      subject: z.string(),
      body: z.string(),
    })
    .passthrough(),
};
export type GetTemplateInput = z.infer<typeof getTemplateSchema.input>;
export type GetTemplateOutput = z.infer<typeof getTemplateSchema.output>;

export const createTemplateSchema = {
  name: 'createTemplate',
  description: 'Create an email template',
  notes:
    'Skill hint: use the "sales-copy" skill for composing effective email templates.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    name: z.string(),
    subject: z.string(),
    body: z.string(),
    folderId: z.string().optional().describe('Folder ID (null for root)'),
  }),
  output: z
    .object({
      id: z.string(),
      name: z.string(),
      subject: z.string(),
      body: z.string(),
      createdAt: z.number(),
    })
    .passthrough(),
};
export type CreateTemplateInput = z.infer<typeof createTemplateSchema.input>;
export type CreateTemplateOutput = z.infer<typeof createTemplateSchema.output>;

export const updateTemplateSchema = {
  name: 'updateTemplate',
  description: 'Update an email template',
  notes:
    'Skill hint: use the "sales-copy" skill for composing effective email template updates.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    templateId: z.string(),
    name: z.string().optional(),
    subject: z.string().optional(),
    body: z.string().optional(),
  }),
  output: z
    .object({
      id: z.string(),
      name: z.string(),
      subject: z.string(),
      body: z.string(),
    })
    .passthrough(),
};
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema.input>;
export type UpdateTemplateOutput = z.infer<typeof updateTemplateSchema.output>;

export const deleteTemplateSchema = {
  name: 'deleteTemplate',
  description: 'Delete an email template',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    templateId: z.string(),
  }),
  output: z.void(),
};
export type DeleteTemplateInput = z.infer<typeof deleteTemplateSchema.input>;
export type DeleteTemplateOutput = z.infer<typeof deleteTemplateSchema.output>;

export const enrollContactSchema = {
  name: 'enrollContact',
  description: 'Enroll a contact in a sequence',
  notes:
    'Requires a connected email inbox. The senderEmail must be a connected inbox address (get from getContext or check HubSpot settings). Limit: 1000 enrollments per inbox per day. Skill hint: use the "sales-copy" skill for enrollment strategy and timing.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    sequenceId: z.string().describe('Sequence ID to enroll into'),
    contactId: z.string().describe('Contact ID to enroll'),
    senderEmail: z
      .string()
      .describe('Connected inbox email address to send from'),
    userId: z.string().describe('User ID enrolling the contact'),
  }),
  output: z
    .object({
      id: z.string().describe('Enrollment ID'),
      toEmail: z.string().describe('Contact email enrolled'),
      enrolledAt: z.string().describe('Enrollment timestamp (UTC)'),
      updatedAt: z.string().describe('Last update timestamp (UTC)'),
    })
    .passthrough(),
};
export type EnrollContactInput = z.infer<typeof enrollContactSchema.input>;
export type EnrollContactOutput = z.infer<typeof enrollContactSchema.output>;

export const getEnrollmentStateSchema = {
  name: 'getEnrollmentState',
  description: 'Check if a contact is enrolled in any sequence',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    contactId: z.string().describe('Contact VID'),
  }),
  output: z
    .object({
      portalId: z.number().describe('Portal ID'),
      vid: z.number().describe('Contact VID'),
      sequenceEnrollmentId: z
        .number()
        .nullable()
        .describe('Enrollment ID if enrolled, null otherwise'),
      email: z
        .string()
        .nullable()
        .describe('Contact email if enrolled, null otherwise'),
      state: z
        .string()
        .nullable()
        .describe(
          'Enrollment state (e.g. ENROLLED, FINISHED) if enrolled, null otherwise',
        ),
      unresolvedDependencyTypes: z
        .array(z.string())
        .describe('Unresolved dependency types'),
      isEnrolled: z
        .boolean()
        .describe('Whether the contact is currently enrolled'),
    })
    .passthrough(),
};
export type GetEnrollmentStateInput = z.infer<
  typeof getEnrollmentStateSchema.input
>;
export type GetEnrollmentStateOutput = z.infer<
  typeof getEnrollmentStateSchema.output
>;

export const listEnrollmentsSchema = {
  name: 'listEnrollments',
  description:
    'List sequence enrollments with email activity metrics (sends, opens, clicks, replies, bounces)',
  notes:
    'Filter by sequenceId and/or status. Returns per-contact email engagement data.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    sequenceId: z.string().optional().describe('Filter by sequence ID'),
    status: z
      .enum(['EXECUTING', 'FINISHED', 'PAUSED', 'ERROR'])
      .optional()
      .describe('Filter by enrollment status'),
    limit: z.number().optional().describe('Max results (default 25)'),
    offset: z.number().optional(),
  }),
  output: z
    .object({
      results: z.array(
        z
          .object({
            enrollmentId: z.string(),
            contactId: z.string().nullable(),
            contactEmail: z.string().nullable(),
            contactName: z.string().nullable(),
            sequenceId: z.string().nullable(),
            enrolledBy: z.string().nullable().describe('User ID who enrolled'),
            enrolledAt: z.string().nullable().describe('Epoch ms timestamp'),
            endedAt: z
              .string()
              .nullable()
              .describe('Epoch ms timestamp when enrollment ended'),
            status: z
              .string()
              .nullable()
              .describe('EXECUTING, FINISHED, PAUSED, or ERROR'),
            lastAction: z
              .string()
              .nullable()
              .describe(
                'Last enrollment action (e.g. FINISH_ENROLLMENT, SEND_TEMPLATE)',
              ),
            emailsSent: z.number(),
            meetingsBooked: z.number(),
            dealsCreated: z.number(),
            noResponse: z
              .number()
              .describe('1 if contact never responded, 0 otherwise'),
            lastStepExecuted: z
              .number()
              .describe('Last step order executed (0-based)'),
            totalSteps: z.number(),
            errorCount: z.number(),
          })
          .passthrough(),
      ),
      total: z.number(),
      hasMore: z.boolean(),
      offset: z.number(),
    })
    .passthrough(),
};
export type ListEnrollmentsInput = z.infer<typeof listEnrollmentsSchema.input>;
export type ListEnrollmentsOutput = z.infer<
  typeof listEnrollmentsSchema.output
>;

export const getSequencePerformanceSchema = {
  name: 'getSequencePerformance',
  description:
    'Get aggregated performance metrics for a sequence (opens, clicks, replies, bounces, meetings)',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    sequenceId: z.string(),
  }),
  output: z
    .object({
      totalEnrollments: z.number(),
      emailsOpened: z.number(),
      emailsClicked: z.number(),
      emailsReplied: z.number(),
      emailsBounced: z.number(),
      uniqueContacts: z.number(),
      unsubscribes: z.number(),
      noResponse: z.number(),
      meetingsBooked: z.number(),
      currentlyExecuting: z
        .number()
        .describe('Enrollments currently in progress'),
    })
    .passthrough(),
};
export type GetSequencePerformanceInput = z.infer<
  typeof getSequencePerformanceSchema.input
>;
export type GetSequencePerformanceOutput = z.infer<
  typeof getSequencePerformanceSchema.output
>;

export const unenrollContactSchema = {
  name: 'unenrollContact',
  description: 'Remove a contact from an active sequence enrollment',
  notes:
    'Finds the active enrollment for the contact in the specified sequence and unenrolls them. Only works for EXECUTING enrollments.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    contactId: z.string().describe('Contact ID to unenroll'),
    sequenceId: z.string().describe('Sequence ID to unenroll from'),
  }),
  output: z
    .object({
      unenrolled: z.boolean(),
    })
    .passthrough(),
};
export type UnenrollContactInput = z.infer<typeof unenrollContactSchema.input>;
export type UnenrollContactOutput = z.infer<
  typeof unenrollContactSchema.output
>;

// ============================================================================
// Views
// ============================================================================

const ViewObjectSchema = z.object({
  id: z.number().describe('View ID'),
  name: z.string().describe('View name'),
  objectTypeId: z
    .string()
    .describe('Object type ID (e.g., 0-1 for contacts, 0-3 for deals)'),
  type: z
    .string()
    .describe('View type: DEFAULT (built-in) or STANDARD (user-created)'),
  private: z.boolean().describe('Whether the view is private to the creator'),
  columns: z
    .string()
    .describe(
      'JSON string of column definitions, e.g. \'[{"name":"email"},{"name":"phone"}]\'',
    ),
  filterGroups: z
    .string()
    .describe(
      'JSON string of advanced filter groups, e.g. \'[{"filters":[{"operator":"HAS_PROPERTY","property":"email","filterFamily":"PropertyValue"}]}]\'',
    ),
  quickFilters: z
    .string()
    .describe(
      'JSON string of quick filters, e.g. \'[{"operator":"IN","property":"hs_lead_status","values":["OPEN"]}]\'',
    ),
  viewColor: z.string().optional().describe('View color (e.g., view-color-1)'),
  ownerId: z.number().optional().describe('Owner user ID'),
  createdBy: z.number().optional().describe('Creator user ID'),
  createdTimestamp: z.number().optional().describe('Creation time (epoch ms)'),
  lastModifiedTimestamp: z
    .number()
    .optional()
    .describe('Last modified time (epoch ms)'),
});

export const listViewsSchema = {
  name: 'listViews',
  description:
    'List saved views (pinned tabs) for a CRM object type. Returns view names, columns, and filter configurations.',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectTypeId: z
      .string()
      .optional()
      .describe(
        'Object type ID: 0-1 (contacts), 0-2 (companies), 0-3 (deals), 0-5 (tickets). Defaults to 0-1.',
      ),
  }),
  output: z
    .object({
      views: z.array(ViewObjectSchema),
      total: z.number(),
      hasMore: z.boolean(),
    })
    .passthrough(),
};
export type ListViewsInput = z.infer<typeof listViewsSchema.input>;
export type ListViewsOutput = z.infer<typeof listViewsSchema.output>;

export const getViewSchema = {
  name: 'getView',
  description: 'Get a specific saved view by ID',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    viewId: z.number().describe('View ID'),
    objectTypeId: z
      .string()
      .optional()
      .describe('Object type ID (defaults to 0-1 for contacts)'),
  }),
  output: ViewObjectSchema,
};
export type GetViewInput = z.infer<typeof getViewSchema.input>;
export type GetViewOutput = z.infer<typeof getViewSchema.output>;

export const createViewSchema = {
  name: 'createView',
  description:
    'Create a new saved view with columns and filters for a CRM object type',
  notes:
    'columns, filterGroups, and quickFilters are JSON strings. Use quickFilters for simple property-based filters (e.g. lead status IN [OPEN]). Use filterGroups for advanced filters with filterFamily. Call getPropertyMappings() to discover available property names for filters.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    name: z.string().describe('View name'),
    objectTypeId: z
      .string()
      .optional()
      .describe('Object type ID (defaults to 0-1 for contacts)'),
    columns: z
      .string()
      .optional()
      .describe(
        'JSON string of columns to display, e.g. \'[{"name":"email"},{"name":"phone"},{"name":"hubspot_owner_id"}]\'. Defaults to email, phone, owner.',
      ),
    filterGroups: z
      .string()
      .optional()
      .describe(
        'JSON string of advanced filter groups. Each group has a filters array: \'[{"filters":[{"operator":"HAS_PROPERTY","property":"email","filterFamily":"PropertyValue"}]}]\'. Groups are OR\'d; filters within a group are AND\'d.',
      ),
    quickFilters: z
      .string()
      .optional()
      .describe(
        'JSON string of quick filters for simple property filtering: \'[{"operator":"IN","property":"hs_lead_status","values":["OPEN","IN_PROGRESS"]}]\'. Operators: IN, NOT_IN, HAS_PROPERTY, NOT_HAS_PROPERTY, EQ, NEQ, CONTAINS, NOT_CONTAINS, GT, GTE, LT, LTE, BETWEEN.',
      ),
    private: z
      .boolean()
      .optional()
      .describe(
        'If true, view is only visible to the creator. Defaults to false.',
      ),
    viewColor: z
      .string()
      .optional()
      .describe('View tab color: view-color-1 through view-color-16'),
  }),
  output: ViewObjectSchema,
};
export type CreateViewInput = z.infer<typeof createViewSchema.input>;
export type CreateViewOutput = z.infer<typeof createViewSchema.output>;

export const updateViewSchema = {
  name: 'updateView',
  description:
    'Update an existing saved view (name, columns, filters, or visibility)',
  notes:
    'Fetches the current view first, then merges your changes. Only provide fields you want to change.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    viewId: z.number().describe('View ID to update'),
    objectTypeId: z
      .string()
      .optional()
      .describe('Object type ID (defaults to 0-1 for contacts)'),
    name: z.string().optional().describe('New view name'),
    columns: z.string().optional().describe('New columns JSON string'),
    filterGroups: z
      .string()
      .optional()
      .describe('New advanced filter groups JSON string'),
    quickFilters: z
      .string()
      .optional()
      .describe('New quick filters JSON string'),
    private: z.boolean().optional().describe('New visibility setting'),
    viewColor: z.string().optional().describe('New view tab color'),
  }),
  output: ViewObjectSchema,
};
export type UpdateViewInput = z.infer<typeof updateViewSchema.input>;
export type UpdateViewOutput = z.infer<typeof updateViewSchema.output>;

export const deleteViewSchema = {
  name: 'deleteView',
  description: 'Delete a saved view by ID',
  notes:
    'Cannot delete DEFAULT views (like "All contacts"). Only STANDARD (user-created) views can be deleted.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    viewId: z.number().describe('View ID to delete'),
  }),
  output: z.object({
    deleted: z.literal(true),
  }),
};
export type DeleteViewInput = z.infer<typeof deleteViewSchema.input>;

// ============================================================================
// Pinned Properties
// ============================================================================

export const getPinnedPropertiesSchema = {
  name: 'getPinnedProperties',
  description:
    'Get the pinned (highlighted) properties shown on the record sidebar for a CRM object type. Pinned properties are usually the best indicator of which properties the user cares about most for that object type.',
  notes:
    'Returns both admin-defined and user-customized properties. The `adminDefined` flag indicates whether each property was set by an admin or customized by the current user.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectTypeId: z
      .string()
      .default('0-1')
      .describe(
        'CRM object type ID. Contacts=0-1, Companies=0-2, Deals=0-3, Tickets=0-5',
      ),
  }),
  output: z.object({
    objectTypeId: z.string().describe('The object type ID queried'),
    properties: z
      .array(
        z.object({
          propertyName: z
            .string()
            .describe(
              'Internal property name (e.g., "email", "hubspot_owner_id")',
            ),
          adminDefined: z
            .boolean()
            .describe(
              'Whether this property was pinned by an admin (true) or customized by the current user (false)',
            ),
        }),
      )
      .describe(
        'Ordered list of pinned properties shown on the record sidebar. These are usually the properties the user cares about most for this object type.',
      ),
    updatedAt: z
      .number()
      .describe('Last update timestamp (epoch ms). 0 if never customized.'),
  }),
};
export type GetPinnedPropertiesInput = z.infer<
  typeof getPinnedPropertiesSchema.input
>;
export type GetPinnedPropertiesOutput = z.infer<
  typeof getPinnedPropertiesSchema.output
>;

export const updatePinnedPropertiesSchema = {
  name: 'updatePinnedProperties',
  description:
    'Set the pinned (highlighted) properties shown on the record sidebar for a CRM object type. Replaces all current pinned properties with the provided list. Pinned properties are usually the best indicator of which properties the user cares about most for that object type.',
  notes:
    'This is a user-level customization; changes only affect the current user. Property names must be valid internal names (use `getPropertyMappings()` to discover available properties). Order of propertyNames determines display order on the sidebar. Admin-defined properties cannot be removed; if omitted from propertyNames they are automatically appended to the end.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectTypeId: z
      .string()
      .default('0-1')
      .describe(
        'CRM object type ID. Contacts=0-1, Companies=0-2, Deals=0-3, Tickets=0-5',
      ),
    propertyNames: z
      .array(z.string())
      .describe(
        'Ordered list of internal property names to pin on the sidebar (e.g., ["email", "phone", "hubspot_owner_id"]). Order determines display order.',
      ),
  }),
  output: z.object({
    updated: z.literal(true),
  }),
};
export type UpdatePinnedPropertiesInput = z.infer<
  typeof updatePinnedPropertiesSchema.input
>;
export type UpdatePinnedPropertiesOutput = z.infer<
  typeof updatePinnedPropertiesSchema.output
>;

export const resetPinnedPropertiesSchema = {
  name: 'resetPinnedProperties',
  description:
    'Reset pinned properties to admin defaults for a CRM object type, removing all user-level customizations. Pinned properties are usually the best indicator of which properties the user cares about most for that object type.',
  notes:
    'This removes any user-level customization and reverts to the admin-defined defaults. Only affects the current user.',
  input: z.object({
    csrf: CsrfParam,
    portalId: PortalIdParam,
    objectTypeId: z
      .string()
      .default('0-1')
      .describe(
        'CRM object type ID. Contacts=0-1, Companies=0-2, Deals=0-3, Tickets=0-5',
      ),
  }),
  output: z.object({
    reset: z.literal(true),
  }),
};
export type ResetPinnedPropertiesInput = z.infer<
  typeof resetPinnedPropertiesSchema.input
>;

// ============================================================================
// Export Schema List
// ============================================================================

export const allSchemas = [
  // Context
  getAccountsSchema,
  getContextSchema,
  // Search
  globalSearchSchema,
  // Contacts
  listContactsSchema,
  getContactSchema,
  createContactSchema,
  updateContactSchema,
  deleteContactSchema,
  // Companies
  listCompaniesSchema,
  getCompanySchema,
  createCompanySchema,
  updateCompanySchema,
  deleteCompanySchema,
  // Associations
  getAssociationsSchema,
  getAssociationLabelsSchema,
  createAssociationSchema,
  deleteAssociationSchema,
  // Deals
  listDealsSchema,
  getDealSchema,
  updateDealSchema,
  deleteDealSchema,
  createDealSchema,
  // Tickets
  listTicketsSchema,
  getTicketSchema,
  createTicketSchema,
  updateTicketSchema,
  deleteTicketSchema,
  // Engagements
  listEngagementsSchema,
  createEngagementSchema,
  updateEngagementSchema,
  deleteEngagementSchema,
  // Activity & Property History
  getTimelineSchema,
  getPropertyHistorySchema,
  // Properties
  getPropertyMappingsSchema,
  getPropertyOptionsSchema,
  createPropertySchema,
  updatePropertySchema,
  deletePropertySchema,
  // Query & Generic CRUD
  queryCrmSchema,
  getRecordSchema,
  createRecordSchema,
  updateRecordSchema,
  deleteRecordSchema,
  // Merge
  mergeCompaniesSchema,
  mergeContactsSchema,
  // Duplicates
  findDuplicateCompaniesSchema,
  findDuplicateContactsSchema,
  // Owners
  listOwnersSchema,
  // Pipelines
  listPipelinesSchema,
  getPipelineSchema,
  createPipelineSchema,
  updatePipelineSchema,
  deletePipelineSchema,
  createPipelineStageSchema,
  updatePipelineStageSchema,
  deletePipelineStageSchema,
  // Tasks
  listTasksSchema,
  createTaskSchema,
  updateTaskSchema,
  deleteTaskSchema,
  // Lists (Segments)
  listListsSchema,
  getListSchema,
  getListContactsSchema,
  createListSchema,
  updateListSchema,
  deleteListSchema,
  addToListSchema,
  removeFromListSchema,
  // Forms
  listFormsSchema,
  getFormSchema,
  getFormSubmissionsSchema,
  // Workflows
  listWorkflowsSchema,
  getWorkflowSchema,
  // Account & Plan Detection
  getSubscriptionInfoSchema,
  getHubAccessSchema,
  getFeatureFlagsSchema,
  getCreditUsageSchema,
  // Marketing Emails
  listMarketingEmailsSchema,
  getMarketingEmailSchema,
  getEmailStatsSchema,
  // Commerce
  listProductsSchema,
  getProductSchema,
  createProductSchema,
  updateProductSchema,
  deleteProductSchema,
  listQuotesSchema,
  getQuoteSchema,
  listLineItemsSchema,
  // Imports
  listImportsSchema,
  getImportSchema,
  // Reporting
  listDashboardsSchema,
  getDashboardSchema,
  listReportsSchema,
  getReportSchema,
  runReportSchema,
  createReportSchema,
  updateReportSchema,
  deleteReportSchema,
  // Sales Tools
  listSnippetsSchema,
  listMeetingLinksSchema,
  // Sequences
  listSequencesSchema,
  getSequenceSchema,
  createSequenceSchema,
  updateSequenceSchema,
  deleteSequenceSchema,
  addSequenceStepSchema,
  listTemplatesSchema,
  getTemplateSchema,
  createTemplateSchema,
  updateTemplateSchema,
  deleteTemplateSchema,
  enrollContactSchema,
  getEnrollmentStateSchema,
  getSequenceUsageSchema,
  listEnrollmentsSchema,
  getSequencePerformanceSchema,
  unenrollContactSchema,
  // Views
  listViewsSchema,
  getViewSchema,
  createViewSchema,
  updateViewSchema,
  deleteViewSchema,
  // Pinned Properties
  getPinnedPropertiesSchema,
  updatePinnedPropertiesSchema,
  resetPinnedPropertiesSchema,
];
