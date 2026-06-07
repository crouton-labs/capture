import { z } from 'zod';

export const CampaignStatusEnum = z.enum([
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'DRAFTED',
  'STOPPED',
]);

export const CampaignSchema = z.object({
  id: z.number().describe('Campaign ID (numeric integer)'),
  user_id: z.number().describe('Owner user ID'),
  created_at: z.string().describe('ISO timestamp when campaign was created'),
  updated_at: z
    .string()
    .describe('ISO timestamp when campaign was last updated'),
  status: CampaignStatusEnum.describe(
    'Campaign status: ACTIVE, PAUSED, COMPLETED, DRAFTED, STOPPED',
  ),
  name: z.string().describe('Campaign name'),
  track_settings: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Comma-separated tracking flags, e.g. "DONT_TRACK_EMAIL_OPEN,DONT_TRACK_LINK_CLICK"',
    ),
  scheduler_cron_value: z
    .unknown()
    .nullable()
    .optional()
    .describe('Cron schedule value'),
  min_time_btwn_emails: z
    .number()
    .nullable()
    .optional()
    .describe('Minimum minutes between emails per lead'),
  max_leads_per_day: z
    .number()
    .nullable()
    .optional()
    .describe('Maximum leads contacted per day'),
  stop_lead_settings: z
    .string()
    .nullable()
    .optional()
    .describe('When to stop sending to a lead'),
  unsubscribe_text: z
    .string()
    .nullable()
    .optional()
    .describe('Unsubscribe link text'),
  client_id: z
    .number()
    .nullable()
    .optional()
    .describe('Client ID for agency use'),
  parent_campaign_id: z
    .number()
    .nullable()
    .optional()
    .describe('Parent campaign ID for sub-campaigns'),
  subsequence_scheduled_count: z
    .number()
    .optional()
    .describe('Number of scheduled subsequences'),
  subsequence_active_count: z
    .number()
    .optional()
    .describe('Number of active subsequences'),
  campaign_lead_stats: z
    .object({
      total: z.number().optional().describe('Total leads in campaign'),
      active: z.number().optional(),
      paused: z.number().optional(),
      bounced: z.number().optional(),
      unsubscribed: z.number().optional(),
      completed: z.number().optional(),
    })
    .optional()
    .describe('Lead counts by status'),
});

export const listCampaignsSchema = {
  name: 'listCampaigns',
  description:
    'List all email campaigns in the account. Returns campaign IDs, names, statuses, creation dates, and lead stats. Auto-paginates to retrieve all campaigns.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    status: z
      .enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'DRAFTED', 'STOPPED'])
      .optional()
      .describe(
        'Optional filter by campaign status. Omit to return all non-archived campaigns.',
      ),
  }),
  output: z.object({
    campaigns: z.array(CampaignSchema).describe('List of campaigns'),
    total: z.number().describe('Total number of campaigns returned'),
  }),
};

export type ListCampaignsInput = z.infer<typeof listCampaignsSchema.input>;
export type ListCampaignsOutput = z.infer<typeof listCampaignsSchema.output>;

export const createCampaignSchema = {
  name: 'createCampaign',
  description:
    'Create a new email campaign with a name and optional settings. Returns the newly created campaign ID.',
  notes:
    'The campaign is created in DRAFT status. Use addEmailAccountsToCampaign to assign senders, saveSequences to add email steps, and resumeCampaign to activate.',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    name: z.string().describe('Campaign name'),
    timezone: z
      .string()
      .optional()
      .describe(
        'Sending timezone as IANA timezone string, e.g. "America/New_York". Defaults to account timezone.',
      ),
    track_settings: z
      .array(
        z.enum([
          'DONT_TRACK_EMAIL_OPEN',
          'DONT_TRACK_LINK_CLICK',
          'DONT_TRACK_EMAIL_REPLY',
        ]),
      )
      .optional()
      .describe(
        'Tracking options to disable. Omit to enable all tracking (opens, clicks, replies).',
      ),
    stop_lead_settings: z
      .enum([
        'REPLY_TO_AN_EMAIL',
        'CLICK_ON_A_LINK',
        'OPEN_AN_EMAIL',
        'MARK_AS_INTERESTED',
      ])
      .optional()
      .describe('Stop sending to a lead when this event occurs.'),
    max_leads_per_day: z
      .number()
      .optional()
      .describe(
        'Maximum leads to contact per day. Defaults to account setting.',
      ),
  }),
  output: z.object({
    id: z.number().describe('Newly created campaign ID'),
    name: z.string().describe('Campaign name'),
    status: z.string().describe('Initial campaign status (DRAFTED)'),
  }),
};

export type CreateCampaignInput = z.infer<typeof createCampaignSchema.input>;
export type CreateCampaignOutput = z.infer<typeof createCampaignSchema.output>;

export const getCampaignSchema = {
  name: 'getCampaign',
  description:
    'Get full details for a single campaign by ID. Returns settings, schedule configuration, email account assignments, sequence summary, and sending stats.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    id: z.number().describe('Campaign ID'),
  }),
  output: CampaignSchema,
};

export type GetCampaignInput = z.infer<typeof getCampaignSchema.input>;
export type GetCampaignOutput = z.infer<typeof getCampaignSchema.output>;

export const deleteCampaignSchema = {
  name: 'deleteCampaign',
  description:
    'Permanently delete a campaign by ID. Irreversible — all leads, sequences, and analytics are removed.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    id: z.number().describe('Campaign ID to delete'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the deletion succeeded'),
  }),
};

export type DeleteCampaignInput = z.infer<typeof deleteCampaignSchema.input>;
export type DeleteCampaignOutput = z.infer<typeof deleteCampaignSchema.output>;

export const resumeCampaignSchema = {
  name: 'resumeCampaign',
  description:
    'Resume a paused campaign, continuing sends from where they left off.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    id: z.number().describe('Campaign ID to resume'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the resume succeeded'),
  }),
};

export type ResumeCampaignInput = z.infer<typeof resumeCampaignSchema.input>;
export type ResumeCampaignOutput = z.infer<typeof resumeCampaignSchema.output>;

export const getCampaignAnalyticsSchema = {
  name: 'getCampaignAnalytics',
  description:
    'Get performance metrics for a campaign: sent count, open rate, click rate, reply rate, bounce rate, and unsubscribe rate.',
  notes:
    'Some analytics endpoints are Pro+ only and return 403 on trial plans.',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    id: z.number().describe('Campaign ID'),
  }),
  output: z.object({
    sent: z.number().describe('Total emails sent'),
    open_count: z.number().describe('Total emails opened'),
    open_rate: z.number().describe('Open rate as a decimal (0–1)'),
    click_count: z.number().describe('Total link clicks'),
    click_rate: z.number().describe('Click rate as a decimal (0–1)'),
    reply_count: z.number().describe('Total replies received'),
    reply_rate: z.number().describe('Reply rate as a decimal (0–1)'),
    bounce_count: z.number().describe('Total bounces'),
    bounce_rate: z.number().describe('Bounce rate as a decimal (0–1)'),
    unsubscribe_count: z.number().describe('Total unsubscribes'),
    unsubscribe_rate: z
      .number()
      .describe('Unsubscribe rate as a decimal (0–1)'),
  }),
};

export type GetCampaignAnalyticsInput = z.infer<
  typeof getCampaignAnalyticsSchema.input
>;
export type GetCampaignAnalyticsOutput = z.infer<
  typeof getCampaignAnalyticsSchema.output
>;

export const pauseCampaignSchema = {
  name: 'pauseCampaign',
  description: 'Pause an active campaign, stopping all email sends.',
  notes:
    'Uses GraphQL mutation. The campaign can be resumed later with resumeCampaign.',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    id: z.number().describe('Campaign ID to pause'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the pause succeeded'),
  }),
};

export type PauseCampaignInput = z.infer<typeof pauseCampaignSchema.input>;
export type PauseCampaignOutput = z.infer<typeof pauseCampaignSchema.output>;

export const updateCampaignSchema = {
  name: 'updateCampaign',
  description:
    'Update campaign properties such as name, status, client assignment, or team member assignment.',
  notes:
    'Uses GraphQL mutation against SmartLead Hasura backend. Only include fields you want to change in the changes object.',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    id: z.number().describe('Campaign ID to update'),
    changes: z
      .object({
        name: z.string().optional().describe('New campaign name'),
        status: z
          .enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'DRAFTED', 'STOPPED'])
          .optional()
          .describe('New campaign status'),
        client_id: z
          .number()
          .optional()
          .describe('Client ID to assign the campaign to'),
        team_member_id: z
          .number()
          .optional()
          .describe('Team member ID to assign the campaign to'),
      })
      .describe('Fields to update. Only include fields you want to change.'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the update succeeded'),
  }),
};

export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema.input>;
export type UpdateCampaignOutput = z.infer<typeof updateCampaignSchema.output>;

export const campaignSchemas = [
  listCampaignsSchema,
  createCampaignSchema,
  getCampaignSchema,
  deleteCampaignSchema,
  resumeCampaignSchema,
  getCampaignAnalyticsSchema,
  pauseCampaignSchema,
  updateCampaignSchema,
];
