import { z } from 'zod';

// ============================================================================
// Shared entity schemas
// ============================================================================

export const EmailAccountSchema = z.object({
  id: z.number().describe('Email account ID (numeric integer)'),
  user_id: z.number().describe('Owner user ID'),
  created_at: z.string().describe('ISO timestamp when account was connected'),
  updated_at: z
    .string()
    .describe('ISO timestamp when account was last updated'),
  from_email: z.string().describe('Sending email address'),
  from_name: z
    .string()
    .nullable()
    .optional()
    .describe('Display name for the sender'),
  smtp_host: z.string().nullable().optional().describe('SMTP server hostname'),
  smtp_port: z.number().nullable().optional().describe('SMTP port number'),
  imap_host: z.string().nullable().optional().describe('IMAP server hostname'),
  imap_port: z.number().nullable().optional().describe('IMAP port number'),
  username: z.string().nullable().optional().describe('SMTP/IMAP username'),
  type: z
    .string()
    .nullable()
    .optional()
    .describe('Account type, e.g. "gmail", "outlook", "smtp"'),
  status: z
    .string()
    .nullable()
    .optional()
    .describe('Connection status: "connected" or "disconnected"'),
  warmup_enabled: z
    .boolean()
    .nullable()
    .optional()
    .describe('Whether warmup is currently enabled'),
  daily_limit: z
    .number()
    .nullable()
    .optional()
    .describe('Maximum emails to send per day'),
  reply_to_email: z
    .string()
    .nullable()
    .optional()
    .describe('Reply-to email address'),
  bcc_email: z.string().nullable().optional().describe('BCC email address'),
  message_per_day: z
    .number()
    .nullable()
    .optional()
    .describe('Current daily send count'),
  custom_tracking_domain: z
    .string()
    .nullable()
    .optional()
    .describe('Custom domain for tracking links'),
  client_id: z
    .number()
    .nullable()
    .optional()
    .describe('Client ID for agency use'),
});

// ============================================================================
// listEmailAccounts
// ============================================================================

export const listEmailAccountsSchema = {
  name: 'listEmailAccounts',
  description:
    'List all email accounts connected to the workspace. Returns email address, provider type, connection status, warmup status, and daily send limits. Auto-paginates to retrieve all accounts.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
  }),
  output: z.object({
    accounts: z.array(EmailAccountSchema).describe('List of email accounts'),
    total: z.number().describe('Total number of email accounts returned'),
  }),
};

export type ListEmailAccountsInput = z.infer<
  typeof listEmailAccountsSchema.input
>;
export type ListEmailAccountsOutput = z.infer<
  typeof listEmailAccountsSchema.output
>;

// ============================================================================
// getEmailAccount
// ============================================================================

export const getEmailAccountSchema = {
  name: 'getEmailAccount',
  description:
    'Get detailed information for a single email account by ID. Returns health score, sending stats, SMTP/IMAP configuration, and warmup settings.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    id: z.number().describe('Email account ID (numeric integer)'),
  }),
  output: EmailAccountSchema,
};

export type GetEmailAccountInput = z.infer<typeof getEmailAccountSchema.input>;
export type GetEmailAccountOutput = z.infer<
  typeof getEmailAccountSchema.output
>;

// ============================================================================
// createEmailAccount
// ============================================================================

export const createEmailAccountSchema = {
  name: 'createEmailAccount',
  description:
    'Connect a new email account for sending. Requires SMTP/IMAP credentials. Returns the newly created account ID and email address.',
  notes:
    'For Gmail and Outlook, use app-specific passwords for SMTP auth. IMAP is required for reply detection.',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    from_email: z.string().describe('Email address to send from'),
    from_name: z
      .string()
      .optional()
      .describe('Display name shown to recipients'),
    smtp_host: z
      .string()
      .describe('SMTP server hostname, e.g. "smtp.gmail.com"'),
    smtp_port: z.number().describe('SMTP port, e.g. 587 (TLS) or 465 (SSL)'),
    smtp_username: z
      .string()
      .describe('SMTP username (usually the email address)'),
    smtp_password: z
      .string()
      .describe('SMTP password or app-specific password'),
    imap_host: z
      .string()
      .optional()
      .describe('IMAP server hostname, e.g. "imap.gmail.com"'),
    imap_port: z.number().optional().describe('IMAP port, e.g. 993'),
    imap_username: z
      .string()
      .optional()
      .describe('IMAP username (usually the email address)'),
    imap_password: z
      .string()
      .optional()
      .describe('IMAP password or app-specific password'),
    daily_limit: z
      .number()
      .optional()
      .describe('Maximum emails to send per day. Defaults to account setting.'),
    reply_to_email: z
      .string()
      .optional()
      .describe('Reply-to email address. Defaults to from_email.'),
  }),
  output: z.object({
    id: z.number().describe('Newly created email account ID'),
    from_email: z.string().describe('Email address of the new account'),
  }),
};

export type CreateEmailAccountInput = z.infer<
  typeof createEmailAccountSchema.input
>;
export type CreateEmailAccountOutput = z.infer<
  typeof createEmailAccountSchema.output
>;

// ============================================================================
// updateEmailAccount
// ============================================================================

export const updateEmailAccountSchema = {
  name: 'updateEmailAccount',
  description:
    'Update settings for an email account — display name, daily send limit, reply-to address, or other sending settings.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    id: z.number().describe('Email account ID to update'),
    from_name: z
      .string()
      .optional()
      .describe('New display name for the sender'),
    daily_limit: z
      .number()
      .optional()
      .describe('New maximum emails to send per day'),
    reply_to_email: z
      .string()
      .optional()
      .describe('New reply-to email address'),
    bcc_email: z
      .string()
      .optional()
      .describe('BCC email address for all outgoing emails'),
    custom_tracking_domain: z
      .string()
      .optional()
      .describe('Custom domain for tracking links'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the update was successful'),
    id: z.number().describe('Updated email account ID'),
  }),
};

export type UpdateEmailAccountInput = z.infer<
  typeof updateEmailAccountSchema.input
>;
export type UpdateEmailAccountOutput = z.infer<
  typeof updateEmailAccountSchema.output
>;

// ============================================================================
// deleteEmailAccount
// ============================================================================

export const deleteEmailAccountSchema = {
  name: 'deleteEmailAccount',
  description:
    'Disconnect and permanently remove an email account from the workspace. Irreversible — confirm with the user before calling.',
  notes:
    'Removing an account will also remove it from any campaigns it is assigned to.',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    id: z.number().describe('Email account ID to delete'),
  }),
  output: z.object({
    ok: z.boolean().describe('Whether the deletion was successful'),
  }),
};

export type DeleteEmailAccountInput = z.infer<
  typeof deleteEmailAccountSchema.input
>;
export type DeleteEmailAccountOutput = z.infer<
  typeof deleteEmailAccountSchema.output
>;

// ============================================================================
// getWarmupStatus
// ============================================================================

export const getWarmupStatusSchema = {
  name: 'getWarmupStatus',
  description:
    'Get warmup health for an email account — health score, warmup email volume, inbox placement rate, and spam placement rate. Use this to monitor account deliverability.',
  notes: '',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    id: z.number().describe('Email account ID'),
  }),
  output: z.object({
    email_account_id: z.number().describe('Email account ID'),
    warmup_enabled: z
      .boolean()
      .nullable()
      .optional()
      .describe('Whether warmup is currently active'),
    total_sent: z
      .number()
      .nullable()
      .optional()
      .describe('Total warmup emails sent'),
    total_spam: z
      .number()
      .nullable()
      .optional()
      .describe('Total warmup emails landed in spam'),
    health_score: z
      .number()
      .nullable()
      .optional()
      .describe('Warmup health score (0–100)'),
    inbox_percent: z
      .number()
      .nullable()
      .optional()
      .describe('Percentage of warmup emails landing in inbox'),
    spam_percent: z
      .number()
      .nullable()
      .optional()
      .describe('Percentage of warmup emails landing in spam'),
    sent_today: z
      .number()
      .nullable()
      .optional()
      .describe('Warmup emails sent today'),
    warmup_per_day: z
      .number()
      .nullable()
      .optional()
      .describe('Configured daily warmup email count'),
  }),
};

export type GetWarmupStatusInput = z.infer<typeof getWarmupStatusSchema.input>;
export type GetWarmupStatusOutput = z.infer<
  typeof getWarmupStatusSchema.output
>;

// ============================================================================
// updateWarmupSettings
// ============================================================================

export const updateWarmupSettingsSchema = {
  name: 'updateWarmupSettings',
  description:
    'Enable or disable warmup for an email account, or adjust warmup intensity and daily warmup email count.',
  notes:
    'Warmup gradually increases send volume to build sender reputation. Enable when first connecting a new email account.',
  input: z.object({
    token: z.string().describe('Bearer token from getContext()'),
    id: z.number().describe('Email account ID'),
    warmup_enabled: z
      .boolean()
      .optional()
      .describe('Enable or disable warmup for this account'),
    warmup_per_day: z
      .number()
      .optional()
      .describe('Number of warmup emails to send per day (typically 1–40)'),
    warmup_reply_rate_percent: z
      .number()
      .optional()
      .describe('Reply rate percentage for warmup emails (0–100)'),
    warmup_increase_per_day: z
      .number()
      .optional()
      .describe(
        'How many additional warmup emails to add per day as ramp-up progresses',
      ),
  }),
  output: z.object({
    ok: z
      .boolean()
      .describe('Whether the warmup settings were updated successfully'),
    id: z.number().describe('Email account ID'),
  }),
};

export type UpdateWarmupSettingsInput = z.infer<
  typeof updateWarmupSettingsSchema.input
>;
export type UpdateWarmupSettingsOutput = z.infer<
  typeof updateWarmupSettingsSchema.output
>;

// ============================================================================
// Domain schemas array
// ============================================================================

export const emailAccountSchemas = [
  listEmailAccountsSchema,
  getEmailAccountSchema,
  createEmailAccountSchema,
  updateEmailAccountSchema,
  deleteEmailAccountSchema,
  getWarmupStatusSchema,
  updateWarmupSettingsSchema,
];
