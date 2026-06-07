import { z } from 'zod';
import { OutlookAuthSchema } from './shared';

// ============================================================================
// getContext
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Extract Outlook authentication context from the current browser session',
  notes:
    'Call FIRST before all Outlook operations. User must be on outlook.live.com, outlook.office.com, or outlook.cloud.microsoft. On personal accounts, reads MSAL v2 tokens from localStorage. On org accounts (encrypted MSAL cache), captures the Bearer token by briefly switching modules in the UI (this takes 1-2 seconds). When multiple accounts are signed in, call with no account first to see availableAccounts, then re-call with the desired account email. If the desired account is not the active session (error says "does not match active session"), use switchAccount() to switch first, then create a new executor (switchAccount navigates and invalidates the current target), then call getContext() again.',
  input: z.object({
    account: z
      .string()
      .optional()
      .describe(
        'Email address of the account to use. Required when multiple accounts are signed in. Call with no account first to see availableAccounts.',
      ),
  }),
  output: z.object({
    auth: OutlookAuthSchema,
    email: z.string().describe('User email address'),
    displayName: z.string().describe('User display name'),
    availableAccounts: z
      .array(
        z.object({
          email: z.string(),
          displayName: z.string(),
        }),
      )
      .describe(
        'All signed-in Outlook accounts. Use an email from this list as the account param.',
      ),
  }),
};

// ============================================================================
// switchAccount
// ============================================================================

export const switchAccountSchema = {
  name: 'switchAccount',
  description:
    'Switch the active Outlook account by navigating to a different account session',
  notes:
    "Navigates the browser to the target account's Outlook domain, which invalidates the current executor (the page navigates cross-origin). After calling switchAccount, close the current executor and create a new one before proceeding. Work/school accounts (e.g., user@company.com) use outlook.cloud.microsoft. Personal accounts (e.g., user@outlook.com, user@hotmail.com) use outlook.live.com. After switching, returns fresh auth context for the new account.",
  input: z.object({
    email: z
      .string()
      .describe(
        'Email address of the account to switch to. Must be already signed in to the browser.',
      ),
    accountType: z
      .enum(['work', 'personal'])
      .optional()
      .describe(
        'Account type. "work" = work/school account (outlook.cloud.microsoft), "personal" = personal Microsoft account (outlook.live.com). If omitted, inferred from the email domain: @outlook.com/@hotmail.com/@live.com = personal, everything else = work.',
      ),
  }),
  output: z.object({
    auth: OutlookAuthSchema,
    email: z.string().describe('Email of the now-active account'),
    displayName: z.string().describe('Display name of the now-active account'),
    availableAccounts: z
      .array(
        z.object({
          email: z.string(),
          displayName: z.string(),
        }),
      )
      .describe('All signed-in Outlook accounts after switching.'),
    domain: z
      .string()
      .describe(
        'The Outlook domain the browser navigated to (e.g., "outlook.cloud.microsoft" or "outlook.live.com")',
      ),
  }),
};

// ============================================================================
// Inferred Types
// ============================================================================

export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type SwitchAccountInput = z.infer<typeof switchAccountSchema.input>;
export type SwitchAccountOutput = z.infer<typeof switchAccountSchema.output>;
