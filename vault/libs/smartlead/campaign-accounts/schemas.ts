import { z } from 'zod';

export const CampaignEmailAccountSchema = z.object({
  id: z.number().describe('Email account ID'),
  email: z.string().describe('Email address of the account'),
  from_name: z
    .string()
    .nullable()
    .optional()
    .describe('Display name used as sender'),
  smtp_host: z.string().nullable().optional().describe('SMTP host'),
  status: z
    .string()
    .nullable()
    .optional()
    .describe('Account connection status'),
  warmup_enabled: z
    .boolean()
    .nullable()
    .optional()
    .describe('Whether warmup is enabled for this account'),
  daily_limit: z
    .number()
    .nullable()
    .optional()
    .describe('Daily send limit for this account'),
});

// ============================================================================
// listCampaignEmailAccounts
// ============================================================================

export const listCampaignEmailAccountsSchema = {
  name: 'listCampaignEmailAccounts',
  description:
    'List the email accounts currently assigned to send for a specific campaign.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    campaignId: z.number().describe('Campaign ID'),
  }),
  output: z.object({
    accounts: z
      .array(CampaignEmailAccountSchema)
      .describe('Email accounts assigned to this campaign'),
    total: z.number().describe('Total number of email accounts assigned'),
  }),
};

export type ListCampaignEmailAccountsInput = z.infer<
  typeof listCampaignEmailAccountsSchema.input
>;
export type ListCampaignEmailAccountsOutput = z.infer<
  typeof listCampaignEmailAccountsSchema.output
>;

// ============================================================================
// addEmailAccountsToCampaign
// ============================================================================

export const addEmailAccountsToCampaignSchema = {
  name: 'addEmailAccountsToCampaign',
  description:
    'Assign one or more email accounts to a campaign for sending. Accepts a list of email account IDs.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    campaignId: z.number().describe('Campaign ID to assign accounts to'),
    emailAccountIds: z
      .array(z.number())
      .describe('List of email account IDs to assign to the campaign'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the assignment succeeded'),
    message: z.string().nullable().optional().describe('API response message'),
  }),
};

export type AddEmailAccountsToCampaignInput = z.infer<
  typeof addEmailAccountsToCampaignSchema.input
>;
export type AddEmailAccountsToCampaignOutput = z.infer<
  typeof addEmailAccountsToCampaignSchema.output
>;

// ============================================================================
// removeEmailAccountFromCampaign
// ============================================================================

export const removeEmailAccountFromCampaignSchema = {
  name: 'removeEmailAccountFromCampaign',
  description:
    "Remove a specific email account from a campaign's sending pool. The account remains connected to the workspace.",
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    campaignId: z.number().describe('Campaign ID'),
    emailAccountId: z
      .number()
      .describe('Email account ID to remove from the campaign'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the removal succeeded'),
    message: z.string().nullable().optional().describe('API response message'),
  }),
};

export type RemoveEmailAccountFromCampaignInput = z.infer<
  typeof removeEmailAccountFromCampaignSchema.input
>;
export type RemoveEmailAccountFromCampaignOutput = z.infer<
  typeof removeEmailAccountFromCampaignSchema.output
>;

export const campaignAccountSchemas = [
  listCampaignEmailAccountsSchema,
  addEmailAccountsToCampaignSchema,
  removeEmailAccountFromCampaignSchema,
];
