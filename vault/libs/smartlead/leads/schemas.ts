import { z } from 'zod';

export const LeadStatusEnum = z.enum([
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'BOUNCED',
  'UNSUBSCRIBED',
]);

export const LeadCategoryEnum = z.enum([
  'Interested',
  'Not Interested',
  'Meeting Booked',
  'Out of Office',
  'Unsubscribe',
]);

export const LeadSchema = z.object({
  id: z.number().describe('Lead ID (numeric integer)'),
  email: z.string().describe('Lead email address'),
  first_name: z.string().nullable().optional().describe('Lead first name'),
  last_name: z.string().nullable().optional().describe('Lead last name'),
  company_name: z.string().nullable().optional().describe('Lead company name'),
  status: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Lead status in campaign: ACTIVE, PAUSED, COMPLETED, BOUNCED, UNSUBSCRIBED',
    ),
  category: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Lead intent category: Interested, Not Interested, Meeting Booked, Out of Office, Unsubscribe',
    ),
  created_at: z
    .string()
    .nullable()
    .optional()
    .describe('ISO timestamp when lead was added'),
  updated_at: z
    .string()
    .nullable()
    .optional()
    .describe('ISO timestamp when lead was last updated'),
  custom_fields: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Custom field key-value pairs'),
});

// ============================================================================
// addLeadsToCampaign
// ============================================================================

export const addLeadsToCampaignSchema = {
  name: 'addLeadsToCampaign',
  description:
    'Import leads into a campaign. Accepts any number of leads — auto-batches at 400 per request. Returns total leads added and any failures per batch.',
  notes:
    'SmartLead enforces a 400-lead maximum per API call. This function handles batching automatically — callers pass a flat array of any size.',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    apiKey: z
      .string()
      .describe(
        'API key from getContext(). Required for v1 API write operations.',
      ),
    campaignId: z.number().describe('Campaign ID to import leads into'),
    leads: z
      .array(
        z.object({
          email: z.string().describe('Lead email address (required)'),
          first_name: z.string().optional().describe('First name'),
          last_name: z.string().optional().describe('Last name'),
          company_name: z.string().optional().describe('Company name'),
          phone_number: z.string().optional().describe('Phone number'),
          website: z.string().optional().describe('Company website'),
          linkedin_profile: z
            .string()
            .optional()
            .describe('LinkedIn profile URL'),
          custom_fields: z
            .record(z.string(), z.string())
            .optional()
            .describe(
              'Custom field key-value pairs used in sequence personalization',
            ),
        }),
      )
      .describe(
        'Array of lead objects to import. Any size — batching handled internally.',
      ),
  }),
  output: z.object({
    total_added: z
      .number()
      .describe('Total leads successfully added across all batches'),
    batches: z.number().describe('Number of API batches sent'),
    results: z
      .array(
        z.object({
          ok: z.boolean(),
          message: z.string().nullable().optional(),
          total_leads: z.number().nullable().optional(),
        }),
      )
      .describe('Per-batch API responses'),
  }),
};

export type AddLeadsToCampaignInput = z.infer<
  typeof addLeadsToCampaignSchema.input
>;
export type AddLeadsToCampaignOutput = z.infer<
  typeof addLeadsToCampaignSchema.output
>;

// ============================================================================
// listCampaignLeads
// ============================================================================

export const listCampaignLeadsSchema = {
  name: 'listCampaignLeads',
  description:
    'List leads in a campaign with their current status. Auto-paginates to retrieve all leads. Supports optional filtering by status.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    campaignId: z.number().describe('Campaign ID'),
    status: LeadStatusEnum.optional().describe(
      'Filter by lead status: ACTIVE, PAUSED, COMPLETED, BOUNCED, UNSUBSCRIBED. Omit to return all leads.',
    ),
  }),
  output: z.object({
    leads: z.array(LeadSchema).describe('List of leads in the campaign'),
    total: z.number().describe('Total number of leads returned'),
  }),
};

export type ListCampaignLeadsInput = z.infer<
  typeof listCampaignLeadsSchema.input
>;
export type ListCampaignLeadsOutput = z.infer<
  typeof listCampaignLeadsSchema.output
>;

// ============================================================================
// updateLeadCategory
// ============================================================================

export const updateLeadCategorySchema = {
  name: 'updateLeadCategory',
  description:
    'Update the intent/category label for a specific lead in a campaign. Used during inbox triage to classify replies.',
  notes:
    'Accepts human-readable category name. The function resolves it to the numeric category_id needed by the v1 API. Valid categories: Interested, Not Interested, Meeting Booked, Out of Office, Unsubscribe.',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    apiKey: z
      .string()
      .describe(
        'API key from getContext(). Required for v1 API write operations.',
      ),
    campaignId: z.number().describe('Campaign ID containing the lead'),
    leadId: z.number().describe('Lead ID to update'),
    category: LeadCategoryEnum.describe(
      'Intent label to assign: Interested, Not Interested, Meeting Booked, Out of Office, Unsubscribe',
    ),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the update succeeded'),
    message: z.string().nullable().optional().describe('API response message'),
  }),
};

export type UpdateLeadCategoryInput = z.infer<
  typeof updateLeadCategorySchema.input
>;
export type UpdateLeadCategoryOutput = z.infer<
  typeof updateLeadCategorySchema.output
>;

// ============================================================================
// pauseLead
// ============================================================================

export const pauseLeadSchema = {
  name: 'pauseLead',
  description:
    'Pause a specific lead within a campaign, stopping further emails to that lead. The lead remains in the campaign.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    apiKey: z
      .string()
      .describe(
        'API key from getContext(). Required for v1 API write operations.',
      ),
    campaignId: z.number().describe('Campaign ID containing the lead'),
    leadId: z.number().describe('Lead ID to pause'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the pause succeeded'),
    message: z.string().nullable().optional().describe('API response message'),
  }),
};

export type PauseLeadInput = z.infer<typeof pauseLeadSchema.input>;
export type PauseLeadOutput = z.infer<typeof pauseLeadSchema.output>;

// ============================================================================
// resumeLead
// ============================================================================

export const resumeLeadSchema = {
  name: 'resumeLead',
  description:
    'Resume a paused lead within a campaign, re-enabling email sends to that lead.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    apiKey: z
      .string()
      .describe(
        'API key from getContext(). Required for v1 API write operations.',
      ),
    campaignId: z.number().describe('Campaign ID containing the lead'),
    leadId: z.number().describe('Lead ID to resume'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the resume succeeded'),
    message: z.string().nullable().optional().describe('API response message'),
  }),
};

export type ResumeLeadInput = z.infer<typeof resumeLeadSchema.input>;
export type ResumeLeadOutput = z.infer<typeof resumeLeadSchema.output>;

// ============================================================================
// deleteLead
// ============================================================================

export const deleteLeadSchema = {
  name: 'deleteLead',
  description:
    'Remove a lead from a campaign. The lead will no longer receive emails from this campaign.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    apiKey: z
      .string()
      .describe(
        'API key from getContext(). Required for v1 API write operations.',
      ),
    campaignId: z.number().describe('Campaign ID containing the lead'),
    leadId: z
      .number()
      .describe(
        'Lead ID to delete. Use the email_lead.id from listCampaignLeads results (the nested ID), NOT the top-level mapping ID.',
      ),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the deletion succeeded'),
    message: z.string().nullable().optional().describe('API response message'),
  }),
};

export type DeleteLeadInput = z.infer<typeof deleteLeadSchema.input>;
export type DeleteLeadOutput = z.infer<typeof deleteLeadSchema.output>;

// ============================================================================
// exportLeads
// ============================================================================

export const exportLeadsSchema = {
  name: 'exportLeads',
  description:
    'Export all leads from a campaign as a structured list. Auto-paginates. Supports optional filtering by status for re-targeting workflows.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    campaignId: z.number().describe('Campaign ID to export leads from'),
    status: LeadStatusEnum.optional().describe(
      'Filter by lead status: ACTIVE, PAUSED, COMPLETED, BOUNCED, UNSUBSCRIBED. Omit to export all leads.',
    ),
  }),
  output: z.object({
    leads: z.array(LeadSchema).describe('Exported lead records'),
    total: z.number().describe('Total number of leads exported'),
  }),
};

export type ExportLeadsInput = z.infer<typeof exportLeadsSchema.input>;
export type ExportLeadsOutput = z.infer<typeof exportLeadsSchema.output>;

export const leadSchemas = [
  addLeadsToCampaignSchema,
  listCampaignLeadsSchema,
  updateLeadCategorySchema,
  pauseLeadSchema,
  resumeLeadSchema,
  deleteLeadSchema,
  exportLeadsSchema,
];
