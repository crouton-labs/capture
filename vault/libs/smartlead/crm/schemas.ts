import { z } from 'zod';

// ============================================================================
// Shared entity schema
// ============================================================================

export const CrmLeadSchema = z.object({
  id: z.number().describe('Lead ID (numeric integer)'),
  email: z.string().describe('Lead email address'),
  first_name: z.string().nullable().optional().describe('Lead first name'),
  last_name: z.string().nullable().optional().describe('Lead last name'),
  company_name: z.string().nullable().optional().describe('Lead company name'),
  status: z
    .string()
    .nullable()
    .optional()
    .describe('Lead status: ACTIVE, PAUSED, COMPLETED, BOUNCED, UNSUBSCRIBED'),
  category: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Intent category: Interested, Not Interested, Meeting Booked, Out of Office, Unsubscribe',
    ),
  campaign_id: z
    .number()
    .nullable()
    .optional()
    .describe('Campaign ID this lead belongs to'),
  campaign_name: z
    .string()
    .nullable()
    .optional()
    .describe('Campaign name this lead belongs to'),
  created_at: z
    .string()
    .nullable()
    .optional()
    .describe('ISO timestamp when lead was created'),
  updated_at: z
    .string()
    .nullable()
    .optional()
    .describe('ISO timestamp when lead was last updated'),
});

// ============================================================================
// listAllLeads
// ============================================================================

export const listAllLeadsSchema = {
  name: 'listAllLeads',
  description:
    'List all leads across the entire account in the CRM view (not scoped to a single campaign). Returns lead name, email, status, category, and which campaign they belong to. Supports pagination via offset and limit.',
  notes: 'Requires Pro plan or above. Returns 403 on trial/base plans.',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    offset: z
      .number()
      .optional()
      .describe('Pagination offset (0-indexed). Defaults to 0.'),
    limit: z
      .number()
      .optional()
      .describe('Maximum leads to return per page. Defaults to 100.'),
  }),
  output: z.object({
    leads: z.array(CrmLeadSchema).describe('List of leads in the CRM'),
    total: z.number().describe('Total number of leads returned in this page'),
  }),
};

export type ListAllLeadsInput = z.infer<typeof listAllLeadsSchema.input>;
export type ListAllLeadsOutput = z.infer<typeof listAllLeadsSchema.output>;

// ============================================================================
// getLeadCountsByType
// ============================================================================

export const getLeadCountsByTypeSchema = {
  name: 'getLeadCountsByType',
  description:
    'Get counts of leads grouped by category/status across the entire account. Returns dashboard-level reporting: how many leads are Interested, Not Interested, Meeting Booked, etc.',
  notes: 'Requires Pro plan or above. Returns 403 on trial/base plans.',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
  }),
  output: z.object({
    counts: z
      .record(z.string(), z.number())
      .describe(
        'Map of category/status label to lead count. Keys include: Interested, Not Interested, Meeting Booked, Out of Office, Unsubscribe, and others.',
      ),
  }),
};

export type GetLeadCountsByTypeInput = z.infer<
  typeof getLeadCountsByTypeSchema.input
>;
export type GetLeadCountsByTypeOutput = z.infer<
  typeof getLeadCountsByTypeSchema.output
>;

// ============================================================================
// listLeadLists
// ============================================================================

export const CrmLeadListSchema = z.object({
  id: z.number().describe('Lead list ID'),
  name: z.string().describe('Lead list name'),
  count: z
    .number()
    .nullable()
    .optional()
    .describe('Number of leads in this list'),
  created_at: z
    .string()
    .nullable()
    .optional()
    .describe('ISO timestamp when list was created'),
  updated_at: z
    .string()
    .nullable()
    .optional()
    .describe('ISO timestamp when list was last updated'),
});

export const listLeadListsSchema = {
  name: 'listLeadLists',
  description:
    'List all saved lead lists in the CRM. Returns list IDs, names, and lead counts.',
  notes: 'Requires Pro plan or above. Returns 403 on trial/base plans.',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
  }),
  output: z.object({
    lists: z.array(CrmLeadListSchema).describe('Saved CRM lead lists'),
    total: z.number().describe('Total number of lists'),
  }),
};

export type ListLeadListsInput = z.infer<typeof listLeadListsSchema.input>;
export type ListLeadListsOutput = z.infer<typeof listLeadListsSchema.output>;

// ============================================================================
// Domain schemas array
// ============================================================================

export const crmSchemas = [
  listAllLeadsSchema,
  getLeadCountsByTypeSchema,
  listLeadListsSchema,
];
