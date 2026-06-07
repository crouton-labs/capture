import { z } from 'zod';

// Re-define shared params locally to avoid circular import with schemas.ts
const ApiKeyParam = z.string().describe('Hunter.io API key from getContext()');

const LeadSchema = z.object({
  id: z.number().describe('Lead ID'),
  email: z.string().describe('Email address'),
  first_name: z.string().nullable().describe('First name'),
  last_name: z.string().nullable().describe('Last name'),
  position: z.string().nullable().describe('Job title'),
  company: z.string().nullable().describe('Company name'),
  company_industry: z.string().nullable().describe('Company industry'),
  confidence_score: z.number().nullable().describe('Confidence score 0-100'),
  website: z.string().nullable().describe('Company website'),
  country_code: z
    .string()
    .nullable()
    .describe('ISO 2-letter country code for the lead'),
  company_size: z.string().nullable().describe('Company size range'),
  source: z.string().nullable().describe('Lead source'),
  linkedin_url: z.string().nullable().describe('LinkedIn profile URL'),
  phone_number: z.string().nullable().describe('Phone number'),
  twitter: z.string().nullable().describe('Twitter handle'),
  sync_status: z.string().nullable().describe('CRM sync status'),
  notes: z.string().nullable().describe('Notes about the lead'),
  sending_status: z.string().nullable().describe('Campaign sending status'),
  last_activity_at: z
    .string()
    .nullable()
    .describe('ISO 8601 timestamp of last activity'),
  last_contacted_at: z
    .string()
    .nullable()
    .describe('ISO 8601 timestamp of last contact'),
  verification: z
    .object({
      date: z.string().nullable().describe('Verification date'),
      status: z
        .enum([
          'valid',
          'invalid',
          'accept_all',
          'webmail',
          'disposable',
          'unknown',
        ])
        .nullable()
        .describe('Email verification status'),
    })
    .nullable()
    .describe('Email verification result'),
  leads_list_id: z
    .number()
    .nullable()
    .describe(
      'ID of the leads list this lead belongs to (returned as number here; /v2/leads returns a leads_list object instead)',
    ),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
});

// ============================================================================
// Lead Lists
// ============================================================================

export const LeadListSummarySchema = z.object({
  id: z.number().describe('Lead list ID'),
  name: z.string().describe('Lead list name'),
  leads_count: z.number().describe('Number of leads in this list'),
  created_at: z.string().describe('UTC creation timestamp'),
});

export const listLeadListsSchema = {
  name: 'listLeadLists',
  description:
    'List all lead lists with pagination, returning list name, lead count, and creation date',
  notes: '',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Results per page (default: 20)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Pagination offset (default: 0)'),
  }),
  output: z.object({
    data: z.object({
      leads_lists: z
        .array(LeadListSummarySchema)
        .describe('Array of lead lists'),
    }),
    meta: z.object({
      total: z.number().describe('Total number of lead lists'),
      params: z.object({
        limit: z.number().describe('Applied page size'),
        offset: z.number().describe('Applied offset'),
      }),
    }),
  }),
};

export const getLeadListSchema = {
  name: 'getLeadList',
  description:
    'Get a single lead list by ID, including its leads with pagination',
  notes: '',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
    id: z.number().describe('Lead list ID'),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Max leads to return (default: 20)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Leads pagination offset (default: 0)'),
  }),
  output: z.object({
    data: z
      .object({
        id: z.number().describe('Lead list ID'),
        name: z.string().describe('Lead list name'),
        leads_count: z.number().describe('Total leads in this list'),
        created_at: z.string().describe('UTC creation timestamp'),
        leads: z.array(LeadSchema).describe('Leads in this list'),
      })
      .describe('Lead list with embedded leads'),
    meta: z.object({
      params: z.object({
        limit: z.number().describe('Applied page size for leads'),
        offset: z.number().describe('Applied offset for leads'),
        leads_list_id: z.number().describe('Echoed lead list ID'),
      }),
    }),
  }),
};

export const createLeadListSchema = {
  name: 'createLeadList',
  description: 'Create a new lead list with the given name',
  notes: '',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
    name: z.string().describe('Name for the new lead list'),
    leads_list_folder_id: z
      .number()
      .optional()
      .describe(
        'ID of the folder to place the new list in. Obtain folder IDs from the Hunter.io UI or by inspecting the leads lists sidebar.',
      ),
  }),
  output: z.object({
    data: LeadListSummarySchema.describe('Created lead list'),
  }),
};

export const updateLeadListSchema = {
  name: 'updateLeadList',
  description: 'Rename an existing lead list',
  notes: 'Returns 204 No Content on success; the response has no body.',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
    id: z.number().describe('Lead list ID to update'),
    name: z.string().describe('New name for the lead list'),
  }),
  output: z.object({
    success: z.literal(true).describe('Always true on successful update'),
  }),
};

export const deleteLeadListSchema = {
  name: 'deleteLeadList',
  description: 'Delete a lead list by ID',
  notes:
    'Returns 204 No Content on success. Leads in the list are NOT deleted.',
  input: z.object({
    apiKey: ApiKeyParam,
    id: z.number().describe('Lead list ID to delete'),
  }),
  output: z.object({
    success: z.literal(true).describe('Always true on successful deletion'),
  }),
};

// ============================================================================
// Custom Attributes
// ============================================================================

export const CustomAttributeSchema = z.object({
  id: z.number().describe('Custom attribute ID'),
  label: z.string().describe('Display label for the attribute'),
  slug: z
    .string()
    .describe(
      'URL-friendly slug auto-generated from the label (e.g. "priority_level")',
    ),
});

export const listCustomAttributesSchema = {
  name: 'listCustomAttributes',
  description: 'List all custom lead attributes',
  notes: '',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
  }),
  output: z.object({
    data: z.object({
      leads_custom_attributes: z
        .array(CustomAttributeSchema)
        .describe('Array of custom attributes'),
    }),
    meta: z.object({
      total: z.number().describe('Total number of custom attributes'),
    }),
  }),
};

export const createCustomAttributeSchema = {
  name: 'createCustomAttribute',
  description:
    'Create a new custom lead attribute. The slug is auto-generated from the label.',
  notes:
    'The body field is "label" (not "name"). Label must be at least 2 characters.',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
    label: z
      .string()
      .describe('Display label for the attribute (min 2 characters)'),
    default_value: z
      .string()
      .optional()
      .describe(
        'Default value used in email templates when the attribute is missing for a recipient',
      ),
    description: z
      .string()
      .optional()
      .describe(
        'Human-readable description explaining what the attribute is for',
      ),
  }),
  output: z.object({
    data: CustomAttributeSchema.describe('Created custom attribute'),
  }),
};

export const updateCustomAttributeSchema = {
  name: 'updateCustomAttribute',
  description:
    'Update an existing custom lead attribute: rename it (label), change its default_value, or update its description. label is required.',
  notes: 'Returns 204 No Content on success; the response has no body.',
  input: z.object({
    apiKey: ApiKeyParam.optional().describe(
      'Hunter.io API key from getContext(). If omitted, extracted automatically from the page.',
    ),
    id: z.number().describe('Custom attribute ID to update'),
    label: z
      .string()
      .describe('New display label for the attribute (min 2 characters)'),
    default_value: z
      .string()
      .optional()
      .describe('Default value pre-filled for this attribute on new leads'),
    description: z
      .string()
      .optional()
      .describe('Description or notes about what this attribute is used for'),
  }),
  output: z.object({
    success: z.literal(true).describe('Always true on successful update'),
  }),
};

export const deleteCustomAttributeSchema = {
  name: 'deleteCustomAttribute',
  description: 'Delete a custom lead attribute by ID',
  notes: '',
  input: z.object({
    apiKey: ApiKeyParam,
    id: z.number().describe('Custom attribute ID to delete'),
  }),
  output: z.object({
    success: z.literal(true).describe('Always true on successful deletion'),
  }),
};

// ============================================================================
// All Schemas Export
// ============================================================================

export const listsAttrsSchemas = [
  listLeadListsSchema,
  getLeadListSchema,
  createLeadListSchema,
  updateLeadListSchema,
  deleteLeadListSchema,
  listCustomAttributesSchema,
  createCustomAttributeSchema,
  updateCustomAttributeSchema,
  deleteCustomAttributeSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

// Entity types
export type LeadListSummary = z.infer<typeof LeadListSummarySchema>;
export type CustomAttribute = z.infer<typeof CustomAttributeSchema>;

// Input types
export type ListLeadListsInput = z.infer<typeof listLeadListsSchema.input>;
export type GetLeadListInput = z.infer<typeof getLeadListSchema.input>;
export type CreateLeadListInput = z.infer<typeof createLeadListSchema.input>;
export type UpdateLeadListInput = z.infer<typeof updateLeadListSchema.input>;
export type DeleteLeadListInput = z.infer<typeof deleteLeadListSchema.input>;
export type ListCustomAttributesInput = z.infer<
  typeof listCustomAttributesSchema.input
>;
export type CreateCustomAttributeInput = z.infer<
  typeof createCustomAttributeSchema.input
>;
export type UpdateCustomAttributeInput = z.infer<
  typeof updateCustomAttributeSchema.input
>;
export type DeleteCustomAttributeInput = z.infer<
  typeof deleteCustomAttributeSchema.input
>;

// Output types
export type ListLeadListsOutput = z.infer<typeof listLeadListsSchema.output>;
export type GetLeadListOutput = z.infer<typeof getLeadListSchema.output>;
export type CreateLeadListOutput = z.infer<typeof createLeadListSchema.output>;
export type UpdateLeadListOutput = z.infer<typeof updateLeadListSchema.output>;
export type DeleteLeadListOutput = z.infer<typeof deleteLeadListSchema.output>;
export type ListCustomAttributesOutput = z.infer<
  typeof listCustomAttributesSchema.output
>;
export type CreateCustomAttributeOutput = z.infer<
  typeof createCustomAttributeSchema.output
>;
export type UpdateCustomAttributeOutput = z.infer<
  typeof updateCustomAttributeSchema.output
>;
export type DeleteCustomAttributeOutput = z.infer<
  typeof deleteCustomAttributeSchema.output
>;
