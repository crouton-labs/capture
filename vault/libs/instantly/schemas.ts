import { z } from 'zod';

export const libraryIcon = '/icons/libs/instantly.ico';
export const loginUrl = 'https://app.instantly.ai';

export const libraryDescription =
  'Instantly.ai email outreach and campaign management via internal APIs';
export const libraryVisibility = 'public' as const;

export const libraryNotes = `
## Workflow

1. Navigate to \`https://app.instantly.ai/app/campaigns\`
2. Call \`getContext()\` first to verify login and get auth tokens
3. Pass auth context to all subsequent function calls

## Campaign Setup Workflow

To fully set up a campaign for sending:
1. \`createCampaign\`: create a new campaign (starts as draft)
2. \`setCampaignSequence\`: add email steps with subject/body content
3. \`setCampaignAccounts\`: assign sending email accounts (inbox rotation)
4. \`setCampaignSchedule\`: configure sending days/hours/timezone
5. \`addLeads\`: add contacts to the campaign
6. \`launchCampaign\`: activate to start sending

## Email Workflows

### Sending & Replying
- **Send new email**: Use \`sendEmail\` to send via Unibox (not part of campaign)
- **Reply to email**: Use \`getEmailDetail\` to fetch the original email, then \`replyToEmail\` with \`replyToUuid\` set to the original email's ID
- **Mark read/unread**: Use \`markEmailRead\` with \`isUnread\` set to 0 (read) or 1 (unread)

### Account Management
- **Update signature/footer**: Use \`updateAccount\` with \`payload.signature\` (HTML) or \`payload.emailFooter\` (plain text)
- **Daily limits**: Set via \`updateAccount\` with \`dailyLimit\` parameter

## Template Variables

Use these placeholders in email subject and body:
- **Lead fields**: \`{{firstName}}\`, \`{{lastName}}\`, \`{{email}}\`, \`{{companyName}}\`, \`{{phone}}\`, \`{{website}}\`, \`{{location}}\`, \`{{linkedin}}\`, \`{{personalization}}\`
- **Custom variables**: Any key from lead's \`custom_variables\`, e.g. \`{{Industry}}\`
- **Default values**: \`{{firstName|there}}\` falls back to "there" if empty

## Auth Pattern

Auth requires the organization JWT from localStorage:
- \`orgAuth\` - JWT from localStorage.organizationAuth for X-Org-Auth header

The getContext() function extracts this and returns it.

## Features

- **Campaigns**: List, get, create, update, delete, launch, pause campaigns
- **Sequences**: Set email steps with subject/body/variants/delays on campaigns
- **Accounts**: Assign sending accounts, inbox rotation, warmup control, SMTP/IMAP testing, signature/footer updates
- **Scheduling**: Configure campaign sending schedule (days, hours, timezone)
- **Leads**: Add, list, search by email, update status, delete, move between campaigns
- **Tags**: List, create, delete custom tags
- **CRM Tasks**: List, create, update, delete tasks
- **Analytics**: Campaign analytics, revenue tracking
- **Unibox**: Unified inbox - list, send, reply, mark read/unread, email detail
- **Workspace**: List workspace members, get organization data
- **Lists**: List contact/lead lists, lead labels
`;

// ============================================================================
// Shared Output Schemas
// ============================================================================

export const UserSchema = z.object({
  id: z.string().describe('User ID'),
  email: z.string().describe('User email address'),
  firstName: z.string().optional().describe('First name'),
  lastName: z.string().optional().describe('Last name'),
  organizationId: z.string().optional().describe('Organization ID'),
});

export const OrganizationSchema = z.object({
  id: z.string().describe('Organization ID'),
  name: z.string().optional().describe('Organization name'),
});

export const AuthContextSchema = z.object({
  orgAuth: z.string().describe('Organization auth JWT for X-Org-Auth header'),
  organizationId: z.string().describe('Organization ID'),
});

export const CampaignSchema = z.object({
  id: z.string().describe('Campaign ID'),
  name: z.string().describe('Campaign name'),
  status: z
    .number()
    .describe('Campaign status (0=draft, 1=active, 2=paused, 3=completed)'),
  timestampCreated: z.string().optional().describe('Creation timestamp'),
});

export const LeadStatusEnum = z
  .enum([
    'Interested',
    'Not Interested',
    'Meeting Booked',
    'Meeting Completed',
    'Closed',
    'Out of Office',
    'Wrong Person',
  ])
  .describe('Lead interest status');

export const LeadSchema = z.object({
  id: z.string().describe('Lead ID'),
  email: z.string().describe('Lead email address'),
  firstName: z.string().optional().describe('First name'),
  lastName: z.string().optional().describe('Last name'),
  companyName: z.string().optional().describe('Company name'),
  companyDomain: z.string().optional().describe('Company domain'),
  status: z.number().describe('Lead status code'),
  interestStatus: z
    .number()
    .nullable()
    .describe('Interest status (1=Interested, -1=Not Interested, etc)'),
  timestampCreated: z.string().describe('Creation timestamp'),
  emailOpenCount: z.number().describe('Number of email opens'),
  emailReplyCount: z.number().describe('Number of email replies'),
  emailClickCount: z.number().describe('Number of email clicks'),
});

export const EmailAccountSchema = z.object({
  email: z.string().describe('Email address (unique identifier)'),
  firstName: z.string().optional().describe('Sender first name'),
  lastName: z.string().optional().describe('Sender last name'),
  status: z.string().describe('Account status (active/inactive)'),
  warmupStatus: z.string().optional().describe('Warmup status (active/paused)'),
  signature: z.string().optional().describe('Email signature (HTML)'),
  provider: z
    .string()
    .optional()
    .describe('Email provider (e.g. gmail, outlook)'),
  dailyLimit: z.number().optional().describe('Daily sending limit'),
  timestampCreated: z.string().optional().describe('Creation timestamp'),
});

export const CampaignAnalyticsSchema = z.object({
  campaignId: z.string().describe('Campaign ID'),
  sent: z.number().describe('Total emails sent'),
  delivered: z.number().describe('Total emails delivered'),
  opened: z.number().describe('Total unique opens'),
  clicked: z.number().describe('Total unique clicks'),
  replied: z.number().describe('Total replies received'),
  bounced: z.number().describe('Total bounces'),
  unsubscribed: z.number().describe('Total unsubscribes'),
  openRate: z.number().describe('Open rate percentage'),
  clickRate: z.number().describe('Click rate percentage'),
  replyRate: z.number().describe('Reply rate percentage'),
});

export const UniboxEmailSchema = z.object({
  id: z.string().describe('Email ID'),
  messageId: z.string().optional().describe('Message ID'),
  subject: z.string().optional().describe('Email subject'),
  snippet: z.string().optional().describe('Email preview snippet'),
  bodyPreview: z.string().optional().describe('Body preview text'),
  from: z.string().describe('Sender email address'),
  fromAddressJson: z
    .array(
      z.object({
        address: z.string(),
        name: z.string().optional(),
      }),
    )
    .optional()
    .describe('Sender address objects'),
  to: z.string().describe('Recipient email address'),
  isUnread: z.number().optional().describe('Unread status (0=read, 1=unread)'),
  isRead: z.boolean().optional().describe('Whether email has been read'),
  timestamp: z.string().describe('Email timestamp'),
  campaignId: z.string().optional().describe('Associated campaign ID'),
  leadId: z.string().optional().describe('Associated lead ID'),
  lead: z
    .object({
      email: z.string().optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
    })
    .optional()
    .describe('Lead information'),
  aiInterestValue: z.number().optional().describe('AI-detected interest value'),
});

export const TagSchema = z.object({
  id: z.string().describe('Tag ID'),
  label: z.string().describe('Tag label'),
  color: z.string().optional().describe('Tag color'),
  timestampCreated: z.string().optional().describe('Creation timestamp'),
});

export const TaskSchema = z.object({
  id: z.string().describe('Task ID'),
  lead: z.string().optional().describe('Lead email address'),
  leadId: z.string().optional().describe('Lead ID'),
  assignee: z.string().optional().describe('Assignee user ID'),
  description: z.string().optional().describe('Task description'),
  taskStatus: z.string().describe('Task status (Active or Completed)'),
  timestampDueDate: z.string().optional().describe('Due date timestamp'),
  timestampCreated: z.string().optional().describe('Creation timestamp'),
  timestampUpdated: z.string().optional().describe('Last update timestamp'),
});

export const CampaignEmailSchema = z.object({
  id: z.string().describe('Email step ID'),
  subject: z.string().optional().describe('Email subject line'),
  body: z.string().optional().describe('Email body content'),
  type: z.string().optional().describe('Email step type'),
  order: z.number().optional().describe('Step order in the sequence'),
});

export const WorkspaceMemberSchema = z.object({
  id: z.string().describe('Member ID'),
  email: z.string().describe('Member email address'),
  role: z.string().describe('Member role (e.g. owner, admin, member)'),
  firstName: z.string().optional().describe('First name'),
  lastName: z.string().optional().describe('Last name'),
  accepted: z.boolean().describe('Whether the member accepted the invite'),
});

// ============================================================================
// Context Schema
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Get Instantly session context, auth tokens, and user information',
  notes:
    'Call FIRST before any other Instantly operations. Must be on app.instantly.ai.',
  input: z.object({}),
  output: z.object({
    success: z.boolean().describe('Whether the request succeeded'),
    isLoggedIn: z.boolean().describe('Whether user is logged in'),
    currentUrl: z.string().describe('Current page URL'),
    userId: z.string().optional().describe('Current user ID'),
    organizationId: z.string().optional().describe('Current organization ID'),
    orgAuth: z
      .string()
      .optional()
      .describe('Organization auth JWT for X-Org-Auth header'),
    user: UserSchema.optional().describe('User details from API'),
    error: z.string().optional().describe('Error message if request failed'),
  }),
};

// ============================================================================
// Campaign Schemas
// ============================================================================

export const CampaignWithTagsSchema = z.object({
  id: z.string().describe('Campaign ID'),
  name: z.string().describe('Campaign name'),
  status: z
    .number()
    .describe('Campaign status (0=draft, 1=active, 2=paused, 3=completed)'),
  timestampCreated: z.string().optional().describe('Creation timestamp'),
  tags: z.array(TagSchema).optional().describe('Campaign tags'),
});

export const listCampaignsSchema = {
  name: 'listCampaigns',
  description: 'List all campaigns in the organization',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    search: z.string().optional().describe('Search query to filter campaigns'),
    status: z
      .number()
      .optional()
      .describe('Filter by status (0=draft, 1=active, 2=paused)'),
    limit: z
      .number()
      .optional()
      .default(50)
      .describe('Max campaigns to return'),
    skip: z
      .number()
      .optional()
      .default(0)
      .describe('Number of campaigns to skip'),
  }),
  output: z.object({
    campaigns: z.array(CampaignWithTagsSchema).describe('List of campaigns'),
  }),
};

export const SequenceVariantSchema = z.object({
  subject: z.string().describe('Email subject line'),
  body: z.string().describe('Email body (HTML)'),
});

export const SequenceStepSchema = z.object({
  type: z.string().describe('Step type (e.g. "email")'),
  delay: z.number().describe('Delay before sending (0 for first step)'),
  delayUnit: z.string().describe('Delay unit: days, hours, or minutes'),
  variants: z
    .array(SequenceVariantSchema)
    .describe('Email variants (A/B testing). First variant is primary.'),
});

export const CampaignScheduleSchema = z.object({
  name: z.string().optional().describe('Schedule name'),
  timezone: z.string().optional().describe('Timezone (e.g. "America/Chicago")'),
  days: z
    .record(z.string(), z.boolean())
    .optional()
    .describe('Days enabled: {"0":false,"1":true,...} where 0=Sunday'),
  startHour: z.string().optional().describe('Start hour (e.g. "09:00")'),
  endHour: z.string().optional().describe('End hour (e.g. "17:00")'),
});

export const getCampaignSchema = {
  name: 'getCampaign',
  description:
    'Get full details for a campaign including sequence steps, accounts, and schedule',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID to fetch'),
  }),
  output: z.object({
    id: z.string().describe('Campaign ID'),
    name: z.string().describe('Campaign name'),
    status: z
      .number()
      .describe('Campaign status (0=draft, 1=active, 2=paused)'),
    timestampCreated: z.string().optional().describe('Creation timestamp'),
    timestampUpdated: z.string().optional().describe('Last update timestamp'),
    sequences: z
      .array(
        z.object({
          steps: z
            .array(SequenceStepSchema)
            .describe('Email steps in the sequence'),
        }),
      )
      .optional()
      .describe('Email sequences configured on the campaign'),
    emailList: z
      .array(z.string())
      .optional()
      .describe('Assigned sending email accounts'),
    campaignSchedule: CampaignScheduleSchema.optional().describe(
      'Campaign sending schedule',
    ),
    dailyLimit: z
      .number()
      .optional()
      .describe('Max emails per day per account'),
    emailGap: z.number().optional().describe('Minutes between emails'),
    stopOnReply: z
      .boolean()
      .optional()
      .describe('Stop sequence when lead replies'),
    textOnly: z.boolean().optional().describe('Send plain text only'),
    linkTracking: z.boolean().optional().describe('Track link clicks'),
    openTracking: z.boolean().optional().describe('Track email opens'),
  }),
};

export const getCampaignStatusSchema = {
  name: 'getCampaignStatus',
  description: 'Get the current status of a campaign',
  notes: 'Status values: 0=draft, 1=active, 2=paused',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID to check'),
  }),
  output: z.object({
    campaignId: z.string().describe('Campaign ID'),
    status: z
      .number()
      .describe('Campaign status (0=draft, 1=active, 2=paused)'),
    statusLabel: z.string().describe('Human-readable status label'),
  }),
};

export const launchCampaignSchema = {
  name: 'launchCampaign',
  description: 'Launch/activate a campaign to start sending emails',
  notes: 'Changes status to 1 (active).',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID to launch'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the campaign was launched'),
    campaignId: z.string().describe('Campaign ID'),
    status: z.number().describe('New campaign status'),
    error: z.string().optional().describe('Error message if failed'),
  }),
};

export const pauseCampaignSchema = {
  name: 'pauseCampaign',
  description: 'Pause an active campaign',
  notes: 'Changes status to 2 (paused). Can be resumed by launching again.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID to pause'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the campaign was paused'),
    campaignId: z.string().describe('Campaign ID'),
    status: z.number().describe('New campaign status'),
    error: z.string().optional().describe('Error message if failed'),
  }),
};

export const createCampaignSchema = {
  name: 'createCampaign',
  description: 'Create a new campaign',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    name: z.string().describe('Campaign name'),
    schedule: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Campaign schedule configuration'),
  }),
  output: z.object({
    id: z.string().describe('Campaign ID'),
    name: z.string().describe('Campaign name'),
    status: z.number().describe('Campaign status (0=draft)'),
    timestampCreated: z.string().optional().describe('Creation timestamp'),
  }),
};

export const deleteCampaignSchema = {
  name: 'deleteCampaign',
  description: 'Delete a campaign',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the campaign was deleted'),
  }),
};

export const updateCampaignSchema = {
  name: 'updateCampaign',
  description:
    'Update campaign settings (name, limits, tracking). Use setCampaignSequence/setCampaignAccounts/setCampaignSchedule for sequence/account/schedule changes.',
  notes:
    'Known fields: name, daily_limit, email_gap, stop_on_reply, stop_on_auto_reply, text_only, link_tracking, open_tracking.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID to update'),
    fields: z
      .record(z.string(), z.unknown())
      .describe(
        'Fields to update (e.g. { name: "New Name", daily_limit: 50 })',
      ),
  }),
  output: z.object({
    id: z.string().describe('Campaign ID'),
    name: z.string().describe('Campaign name'),
    status: z.number().describe('Campaign status'),
    timestampCreated: z.string().optional().describe('Creation timestamp'),
    timestampUpdated: z.string().optional().describe('Last update timestamp'),
  }),
};

export const listCampaignEmailsSchema = {
  name: 'listCampaignEmails',
  description:
    'List the email steps in a campaign sequence with subject, body, and delay info',
  notes:
    'Reads from the campaign sequences field. Returns empty array if no sequence is configured.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID to get emails for'),
  }),
  output: z.object({
    emails: z
      .array(
        z.object({
          stepNumber: z.number().describe('Step position (1-based)'),
          subject: z.string().describe('Email subject line'),
          body: z.string().describe('Email body (HTML)'),
          delay: z.number().describe('Delay before this step (0 for first)'),
          delayUnit: z.string().describe('Delay unit (days, hours, minutes)'),
          variantCount: z
            .number()
            .describe('Number of A/B variants for this step'),
        }),
      )
      .describe('Email steps in the campaign sequence'),
  }),
};

export const setCampaignSequenceSchema = {
  name: 'setCampaignSequence',
  description: 'Create or replace the email sequence steps on a campaign',
  notes:
    'Overwrites all existing sequence steps. Each step has a subject, body (HTML), delay, and optional A/B variants. Skill hint: use the "sales-copy" skill for composing effective email sequences.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID to set sequence on'),
    steps: z
      .array(
        z.object({
          subject: z
            .string()
            .describe('Email subject line (supports {{variables}})'),
          body: z.string().describe('Email body HTML (supports {{variables}})'),
          delay: z
            .number()
            .optional()
            .default(0)
            .describe('Days to wait before sending (0 for first step)'),
          delayUnit: z
            .enum(['days', 'hours', 'minutes'])
            .optional()
            .default('days')
            .describe('Delay unit'),
          variants: z
            .array(
              z.object({
                subject: z.string().describe('Variant subject line'),
                body: z.string().describe('Variant body HTML'),
              }),
            )
            .optional()
            .describe(
              'Additional A/B test variants. The main subject/body is variant A.',
            ),
        }),
      )
      .describe('Email steps in order'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the sequence was set'),
    campaignId: z.string().describe('Campaign ID'),
    stepCount: z.number().describe('Number of steps configured'),
  }),
};

export const setCampaignAccountsSchema = {
  name: 'setCampaignAccounts',
  description: 'Assign sending email accounts to a campaign for inbox rotation',
  notes:
    'Use listAccounts() to get available email addresses. Overwrites any previously assigned accounts.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID'),
    emails: z
      .array(z.string())
      .describe('Email addresses of sending accounts to assign'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether accounts were assigned'),
    campaignId: z.string().describe('Campaign ID'),
    accountCount: z.number().describe('Number of accounts assigned'),
  }),
};

export const setCampaignScheduleSchema = {
  name: 'setCampaignSchedule',
  description: 'Configure when a campaign sends emails (days, hours, timezone)',
  notes:
    'Days are numbered 0-6 where 0=Sunday. Overwrites any existing schedule.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID'),
    timezone: z
      .string()
      .describe('Timezone (e.g. "America/Chicago", "America/New_York")'),
    days: z
      .record(z.string(), z.boolean())
      .describe(
        'Days to send: {"0":false,"1":true,"2":true,...} where 0=Sunday',
      ),
    fromTime: z.string().describe('Start time in 24h format (e.g. "09:00")'),
    toTime: z.string().describe('End time in 24h format (e.g. "17:00")'),
    scheduleName: z
      .string()
      .optional()
      .default('Default')
      .describe('Schedule name'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether schedule was set'),
    campaignId: z.string().describe('Campaign ID'),
  }),
};

// ============================================================================
// Lead Schemas
// ============================================================================

export const listLeadsSchema = {
  name: 'listLeads',
  description: 'List leads in a campaign with optional search filter',
  notes:
    'The API returns leads at the organization level. Use searchLeads with a query to find specific leads within a campaign.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID to get leads from'),
    search: z.string().optional().describe('Search term to filter leads'),
    limit: z.number().optional().default(50).describe('Max leads to return'),
    skip: z.number().optional().default(0).describe('Number of leads to skip'),
  }),
  output: z.object({
    leads: z.array(LeadSchema).describe('List of leads'),
  }),
};

export const addLeadsSchema = {
  name: 'addLeads',
  description: 'Add leads to a campaign',
  notes: 'Each lead must have an email. Other fields are optional.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID to add leads to'),
    leads: z
      .array(
        z.object({
          email: z.string().describe('Lead email address (required)'),
          first_name: z.string().optional().describe('First name'),
          last_name: z.string().optional().describe('Last name'),
          company_name: z.string().optional().describe('Company name'),
          phone: z.string().optional().describe('Phone number'),
          website: z.string().optional().describe('Website URL'),
          custom_variables: z
            .record(z.string(), z.string())
            .optional()
            .describe('Custom variables'),
        }),
      )
      .describe('Array of leads to add'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether leads were added'),
    leadsUploaded: z.number().describe('Number of leads uploaded'),
    alreadyInCampaign: z
      .number()
      .describe('Number of leads already in campaign'),
    inBlocklist: z.number().describe('Number of leads in blocklist'),
    invalidEmailCount: z.number().describe('Number of invalid emails'),
    duplicateEmailCount: z.number().describe('Number of duplicate emails'),
    remainingInPlan: z.number().describe('Remaining leads in plan'),
  }),
};

export const updateLeadStatusSchema = {
  name: 'updateLeadStatus',
  description: 'Update the interest status of a lead',
  notes:
    'Valid statuses: Interested, Not Interested, Meeting Booked, Meeting Completed, Closed, Out of Office, Wrong Person',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID'),
    email: z.string().describe('Lead email address'),
    status: LeadStatusEnum.describe('New interest status'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether status was updated'),
    message: z.string().optional().describe('Response message'),
  }),
};

export const deleteLeadSchema = {
  name: 'deleteLead',
  description: 'Delete leads from a campaign',
  notes: 'Leads are identified by email address.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID'),
    emails: z.array(z.string()).describe('Email addresses of leads to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether leads were deleted'),
    deletedCount: z.number().describe('Number of leads deleted'),
  }),
};

export const searchLeadsSchema = {
  name: 'searchLeads',
  description:
    'Search for leads across campaigns or within a specific campaign',
  notes:
    'Uses the list endpoint with search parameter. Provide campaignId to search within a campaign.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID to search in'),
    query: z.string().describe('Search query (matches email, name, company)'),
    limit: z.number().optional().default(50).describe('Max leads to return'),
    skip: z.number().optional().default(0).describe('Number of leads to skip'),
  }),
  output: z.object({
    leads: z.array(LeadSchema).describe('Matching leads'),
  }),
};

export const getLeadByEmailSchema = {
  name: 'getLeadByEmail',
  description: 'Look up a lead by email address across all campaigns',
  notes:
    'Returns all instances of the lead across campaigns (a lead can appear in multiple campaigns).',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    email: z.string().describe('Email address to look up'),
  }),
  output: z.object({
    leads: z.array(LeadSchema).describe('Lead records matching the email'),
  }),
};

// ============================================================================
// Tag Schemas
// ============================================================================

export const listTagsSchema = {
  name: 'listTags',
  description: 'List all custom tags in the organization',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
  }),
  output: z.object({
    tags: z.array(TagSchema).describe('List of tags'),
  }),
};

export const createTagSchema = {
  name: 'createTag',
  description: 'Create a new custom tag',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    label: z.string().describe('Tag label'),
  }),
  output: z.object({
    id: z.string().describe('Tag ID'),
    label: z.string().describe('Tag label'),
  }),
};

export const deleteTagSchema = {
  name: 'deleteTag',
  description: 'Delete a custom tag',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    tagId: z.string().describe('Tag ID to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the tag was deleted'),
  }),
};

// ============================================================================
// CRM Task Schemas
// ============================================================================

export const listTasksSchema = {
  name: 'listTasks',
  description: 'List CRM tasks in the organization',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    status: z
      .enum(['Active', 'Completed'])
      .optional()
      .describe('Filter by task status'),
    limit: z.number().optional().default(50).describe('Max tasks to return'),
    skip: z.number().optional().default(0).describe('Number of tasks to skip'),
  }),
  output: z.object({
    tasks: z.array(TaskSchema).describe('List of tasks'),
  }),
};

export const createTaskSchema = {
  name: 'createTask',
  description: 'Create a new CRM task',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    description: z.string().describe('Task description'),
    leadId: z.string().describe('Lead ID to associate the task with'),
    title: z.string().optional().describe('Task title'),
    timestampDueDate: z
      .string()
      .optional()
      .describe(
        'Due date timestamp (ISO format). Defaults to 7 days from now if omitted.',
      ),
  }),
  output: TaskSchema,
};

export const updateTaskSchema = {
  name: 'updateTask',
  description: 'Update a CRM task',
  notes:
    'Setting taskStatus to Completed uses a separate endpoint. Status changes cannot be reversed.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    taskId: z.string().describe('Task ID to update'),
    description: z.string().optional().describe('New task description'),
    taskStatus: z
      .enum(['Active', 'Completed'])
      .optional()
      .describe('New task status'),
    timestampDueDate: z
      .string()
      .optional()
      .describe('New due date timestamp (ISO format)'),
  }),
  output: TaskSchema,
};

export const deleteTaskSchema = {
  name: 'deleteTask',
  description: 'Delete a CRM task',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    taskId: z.string().describe('Task ID to delete'),
  }),
  output: TaskSchema,
};

// ============================================================================
// Account Schemas
// ============================================================================

export const listAccountsSchema = {
  name: 'listAccounts',
  description: 'List all email accounts in the organization',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    limit: z
      .number()
      .optional()
      .default(100)
      .describe('Max accounts to return'),
    skip: z
      .number()
      .optional()
      .default(0)
      .describe('Number of accounts to skip'),
  }),
  output: z.object({
    accounts: z.array(EmailAccountSchema).describe('List of email accounts'),
  }),
};

export const getAccountStatusSchema = {
  name: 'getAccountStatus',
  description: 'Get detailed status for a specific email account',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    email: z.string().describe('Email address of the account'),
  }),
  output: z.object({
    email: z.string().describe('Email address'),
    status: z.string().describe('Account status (active/inactive)'),
    warmupStatus: z
      .string()
      .optional()
      .describe('Warmup status (active/paused)'),
    warmupEnabled: z.boolean().describe('Whether warmup is currently active'),
  }),
};

export const enableWarmupSchema = {
  name: 'enableWarmup',
  description: 'Enable email warmup for an account',
  notes:
    'Warmup gradually increases sending volume to build sender reputation.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    email: z.string().describe('Email address of the account'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether warmup was enabled'),
    email: z.string().describe('Email address'),
    error: z.string().optional().describe('Error message if failed'),
  }),
};

export const pauseWarmupSchema = {
  name: 'pauseWarmup',
  description: 'Pause email warmup for an account',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    email: z.string().describe('Email address of the account'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether warmup was paused'),
    email: z.string().describe('Email address'),
    error: z.string().optional().describe('Error message if failed'),
  }),
};

export const testSmtpConnectionSchema = {
  name: 'testSmtpConnection',
  description: 'Test SMTP connection for an email account',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    email: z.string().describe('Email address to test'),
    smtpHost: z.string().describe('SMTP server hostname (e.g. smtp.gmail.com)'),
    smtpPort: z.number().describe('SMTP server port (e.g. 587)'),
    smtpUsername: z.string().describe('SMTP username'),
    smtpPassword: z.string().describe('SMTP password'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the SMTP connection succeeded'),
    error: z.string().optional().describe('Error message if connection failed'),
  }),
};

export const testImapConnectionSchema = {
  name: 'testImapConnection',
  description: 'Test IMAP connection for an email account',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    email: z.string().describe('Email address to test'),
    imapHost: z.string().describe('IMAP server hostname (e.g. imap.gmail.com)'),
    imapPort: z.number().describe('IMAP server port (e.g. 993)'),
    imapUsername: z.string().describe('IMAP username'),
    imapPassword: z.string().describe('IMAP password'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the IMAP connection succeeded'),
    error: z.string().optional().describe('Error message if connection failed'),
    errorDetails: z.string().optional().describe('Detailed error information'),
  }),
};

// ============================================================================
// Analytics Schemas
// ============================================================================

export const getCampaignAnalyticsSchema = {
  name: 'getCampaignAnalytics',
  description: 'Get analytics for a specific campaign',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID'),
  }),
  output: CampaignAnalyticsSchema,
};

export const getAnalyticsSummarySchema = {
  name: 'getAnalyticsSummary',
  description: 'Get organization-wide analytics summary',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    startDate: z.string().optional().describe('Start date (ISO format)'),
    endDate: z.string().optional().describe('End date (ISO format)'),
  }),
  output: z.object({
    totalSent: z.number().describe('Total emails sent'),
    totalDelivered: z.number().describe('Total emails delivered'),
    totalOpened: z.number().describe('Total unique opens'),
    totalClicked: z.number().describe('Total unique clicks'),
    totalReplied: z.number().describe('Total replies'),
    totalBounced: z.number().describe('Total bounces'),
    revenue: z.number().optional().describe('Tracked revenue amount'),
    contactsUsed: z.number().optional().describe('Number of contacts used'),
    contactsRemaining: z
      .number()
      .optional()
      .describe('Contacts remaining in plan'),
  }),
};

export const StepInfoSchema = z.object({
  stepNumber: z.number().describe('Step number (1-based)'),
  subject: z.string().describe('Primary variant subject line'),
  variantCount: z.number().describe('Number of A/B variants for this step'),
  variantSubjects: z
    .array(z.string())
    .describe('Subject lines for all variants (A/B)'),
  delay: z.number().describe('Delay before this step (0 for first step)'),
  delayUnit: z.string().describe('Delay unit (days, hours, minutes)'),
});

export const getStepAnalyticsSchema = {
  name: 'getStepAnalytics',
  description:
    'Get per-step sequence analytics for a campaign, including lead engagement metrics and A/B variant info per step',
  notes:
    'Aggregates lead-level tracking data (opens, replies, clicks) and maps it against the campaign sequence structure. Variant-level breakdown is not available; Instantly does not expose which A/B variant was sent to each lead.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z.string().describe('Campaign ID to analyze'),
  }),
  output: z.object({
    campaignId: z.string().describe('Campaign ID'),
    campaignName: z.string().describe('Campaign name'),
    totalLeads: z.number().describe('Total leads in campaign'),
    activeLeads: z.number().describe('Leads with active status'),
    completedLeads: z.number().describe('Leads that completed the sequence'),
    bouncedLeads: z.number().describe('Leads that bounced'),
    leadsOpened: z
      .number()
      .describe('Unique leads who opened at least one email'),
    leadsReplied: z.number().describe('Unique leads who replied'),
    leadsClicked: z.number().describe('Unique leads who clicked a link'),
    openRate: z.number().describe('Open rate percentage'),
    replyRate: z.number().describe('Reply rate percentage'),
    clickRate: z.number().describe('Click rate percentage'),
    steps: z
      .array(StepInfoSchema)
      .describe('Sequence step details with variant info'),
  }),
};

export const getCrmStatsSchema = {
  name: 'getCrmStats',
  description:
    'Get CRM opportunity and revenue stats, optionally filtered by campaign and date range',
  notes:
    'Defaults to last 30 days if no date range provided. Omit campaignId for organization-wide stats.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    campaignId: z
      .string()
      .optional()
      .describe('Campaign ID to filter by (omit for org-wide stats)'),
    fromDate: z
      .string()
      .optional()
      .describe('Start date (ISO format, defaults to 30 days ago)'),
    toDate: z
      .string()
      .optional()
      .describe('End date (ISO format, defaults to end of today)'),
  }),
  output: z.object({
    opportunitiesWon: z.number().describe('Number of opportunities won'),
    cashCollected: z.number().describe('Total cash collected / revenue'),
    totalOpportunities: z.number().describe('Total number of opportunities'),
    totalOpportunitiesValue: z
      .number()
      .describe('Total value of all opportunities'),
  }),
};

export const getCreditsSchema = {
  name: 'getCredits',
  description: 'Get current Instantly credits balance',
  notes: 'Credits are used for various Instantly features.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
  }),
  output: z.object({
    credits: z.number().describe('Current credits balance'),
    creditsUsed: z.number().optional().describe('Credits used this period'),
    creditsTotal: z.number().optional().describe('Total credits in plan'),
  }),
};

// ============================================================================
// Unibox Schemas
// ============================================================================

export const getUnreadCountSchema = {
  name: 'getUnreadCount',
  description: 'Get count of unread emails in Unibox',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
  }),
  output: z.object({
    unreadCount: z.number().describe('Number of unread emails'),
  }),
};

export const listEmailsSchema = {
  name: 'listEmails',
  description: 'List emails from Unibox inbox',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    filter: z
      .enum(['all', 'unread', 'replied'])
      .optional()
      .default('all')
      .describe('Filter emails'),
    search: z.string().optional().describe('Search query to filter emails'),
    limit: z.number().optional().default(50).describe('Max emails to return'),
    skip: z.number().optional().default(0).describe('Number of emails to skip'),
  }),
  output: z.object({
    emails: z.array(UniboxEmailSchema).describe('List of emails'),
    totalCount: z.number().optional().describe('Total email count'),
  }),
};

export const EmailDetailSchema = z.object({
  id: z.string().describe('Email ID'),
  timestampCreated: z.string().optional().describe('Creation timestamp'),
  timestampEmail: z.string().optional().describe('Email sent timestamp'),
  messageId: z.string().optional().describe('Message ID'),
  subject: z.string().optional().describe('Email subject'),
  fromAddressEmail: z.string().describe('Sender email address'),
  toAddressEmailList: z
    .array(z.string())
    .optional()
    .describe('Recipient email addresses'),
  ccAddressEmailList: z
    .array(z.string())
    .optional()
    .describe('CC email addresses'),
  bccAddressEmailList: z
    .array(z.string())
    .optional()
    .describe('BCC email addresses'),
  fromAddressJson: z
    .array(
      z.object({
        address: z.string(),
        name: z.string().optional(),
      }),
    )
    .optional()
    .describe('Sender address objects'),
  toAddressJson: z
    .array(
      z.object({
        address: z.string(),
        name: z.string().optional(),
      }),
    )
    .optional()
    .describe('Recipient address objects'),
  body: z
    .object({
      html: z.string().describe('HTML email body'),
      text: z.string().optional().describe('Plain text email body'),
    })
    .optional()
    .describe('Email body content'),
  isUnread: z.number().describe('Unread status (0=read, 1=unread)'),
  campaignId: z.string().optional().describe('Associated campaign ID'),
  leadId: z.string().optional().describe('Associated lead ID'),
  threadId: z.string().optional().describe('Email thread ID'),
  inReplyToMsgId: z
    .string()
    .optional()
    .describe('Message ID this is replying to'),
});

export const getEmailDetailSchema = {
  name: 'getEmailDetail',
  description: 'Get full email detail including body by ID',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    emailId: z.string().describe('Email ID to fetch'),
  }),
  output: EmailDetailSchema,
};

export const sendEmailSchema = {
  name: 'sendEmail',
  description: 'Send a new email via Unibox (not part of a campaign)',
  notes:
    'Skill hint: use the "sales-copy" skill for composing effective emails.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    subject: z.string().describe('Email subject'),
    from: z.string().describe('Sender email address'),
    to: z.string().describe('Recipient email address'),
    body: z.string().describe('Email body (HTML)'),
    cc: z.string().optional().describe('CC email address'),
    bcc: z.string().optional().describe('BCC email address'),
  }),
  output: EmailDetailSchema,
};

export const replyToEmailSchema = {
  name: 'replyToEmail',
  description: 'Reply to an existing email thread',
  notes:
    'Use getEmailDetail to get the original email ID first. Skill hint: use the "sales-copy" skill for composing effective replies.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    subject: z.string().describe('Email subject'),
    from: z.string().describe('Sender email address'),
    to: z.string().describe('Recipient email address'),
    body: z.string().describe('Email body (HTML)'),
    replyToUuid: z.string().describe('Unibox email ID to reply to'),
    cc: z.string().optional().describe('CC email address'),
    bcc: z.string().optional().describe('BCC email address'),
  }),
  output: EmailDetailSchema,
};

export const markEmailReadSchema = {
  name: 'markEmailRead',
  description: 'Mark an email as read or unread',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    emailId: z.string().describe('Email ID to mark'),
    isUnread: z.number().describe('0 for read, 1 for unread'),
  }),
  output: EmailDetailSchema,
};

export const updateAccountSchema = {
  name: 'updateAccount',
  description:
    'Update email account settings (name, signature/footer, daily limit)',
  notes:
    'The signature field is HTML. This is how you modify the footer/signature of burner accounts.',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    email: z.string().describe('Email address of the account to update'),
    firstName: z.string().optional().describe('Sender first name'),
    lastName: z.string().optional().describe('Sender last name'),
    signature: z.string().optional().describe('Email signature (HTML)'),
    emailFooter: z.string().optional().describe('Email footer text'),
    dailyLimit: z.number().optional().describe('Daily email sending limit'),
  }),
  output: z.object({
    status: z.string().describe('Status of the update (e.g. "success")'),
  }),
};

export const moveLeadsSchema = {
  name: 'moveLeads',
  description: 'Move leads between campaigns',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    fromCampaignId: z.string().describe('Source campaign ID'),
    toCampaignId: z.string().describe('Destination campaign ID'),
    emails: z.array(z.string()).describe('Email addresses of leads to move'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the move succeeded'),
    totalLeadsToMove: z.number().describe('Number of leads requested to move'),
    existingLeadsCount: z
      .number()
      .describe('Number of leads already in destination'),
    totalLeadsMoved: z.number().describe('Number of leads actually moved'),
    ignoredLeadsCount: z.number().describe('Number of leads ignored'),
  }),
};

export const LeadLabelSchema = z.object({
  id: z.string().describe('Label ID'),
  name: z.string().describe('Label name'),
  color: z.string().optional().describe('Label color'),
  timestampCreated: z.string().optional().describe('Creation timestamp'),
});

export const listLeadLabelsSchema = {
  name: 'listLeadLabels',
  description: 'List lead labels in the organization',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    limit: z.number().optional().default(100).describe('Max labels to return'),
  }),
  output: z.object({
    labels: z.array(LeadLabelSchema).describe('List of lead labels'),
  }),
};

export const ListItemSchema = z.object({
  id: z.string().describe('List ID'),
  name: z.string().describe('List name'),
  count: z.number().optional().describe('Number of leads in the list'),
  timestampCreated: z.string().optional().describe('Creation timestamp'),
});

export const listListsSchema = {
  name: 'listLists',
  description: 'List contact/lead lists',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    search: z.string().optional().describe('Search query to filter lists'),
    limit: z.number().optional().default(20).describe('Max lists to return'),
    skip: z.number().optional().default(0).describe('Number of lists to skip'),
  }),
  output: z.object({
    lists: z.array(ListItemSchema).describe('List of lists'),
  }),
};

// ============================================================================
// Workspace / Organization Schemas
// ============================================================================

export const listWorkspaceMembersSchema = {
  name: 'listWorkspaceMembers',
  description: 'List all members of the current workspace',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
    limit: z.number().optional().default(100).describe('Max members to return'),
  }),
  output: z.object({
    members: z
      .array(WorkspaceMemberSchema)
      .describe('List of workspace members'),
  }),
};

export const getOrganizationDataSchema = {
  name: 'getOrganizationData',
  description: 'Get organization plan details, trial info, and feature flags',
  notes: '',
  input: z.object({
    auth: AuthContextSchema.describe('Auth context from getContext()'),
  }),
  output: z.object({
    data: z
      .record(z.string(), z.unknown())
      .describe('Organization data including plan, trial, and feature flags'),
  }),
};

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  getContextSchema,
  // Campaigns
  listCampaignsSchema,
  getCampaignSchema,
  getCampaignStatusSchema,
  launchCampaignSchema,
  pauseCampaignSchema,
  createCampaignSchema,
  deleteCampaignSchema,
  updateCampaignSchema,
  listCampaignEmailsSchema,
  setCampaignSequenceSchema,
  setCampaignAccountsSchema,
  setCampaignScheduleSchema,
  // Leads
  listLeadsSchema,
  addLeadsSchema,
  updateLeadStatusSchema,
  deleteLeadSchema,
  searchLeadsSchema,
  getLeadByEmailSchema,
  moveLeadsSchema,
  listLeadLabelsSchema,
  listListsSchema,
  // Tags
  listTagsSchema,
  createTagSchema,
  deleteTagSchema,
  // CRM Tasks
  listTasksSchema,
  createTaskSchema,
  updateTaskSchema,
  deleteTaskSchema,
  // Accounts
  listAccountsSchema,
  getAccountStatusSchema,
  enableWarmupSchema,
  pauseWarmupSchema,
  testSmtpConnectionSchema,
  testImapConnectionSchema,
  updateAccountSchema,
  // Analytics
  getCampaignAnalyticsSchema,
  getAnalyticsSummarySchema,
  getStepAnalyticsSchema,
  getCrmStatsSchema,
  getCreditsSchema,
  // Unibox
  getUnreadCountSchema,
  listEmailsSchema,
  getEmailDetailSchema,
  sendEmailSchema,
  replyToEmailSchema,
  markEmailReadSchema,
  // Workspace / Organization
  listWorkspaceMembersSchema,
  getOrganizationDataSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

// Shared types
export type User = z.infer<typeof UserSchema>;
export type Organization = z.infer<typeof OrganizationSchema>;
export type AuthContext = z.infer<typeof AuthContextSchema>;
export type Campaign = z.infer<typeof CampaignSchema>;
export type CampaignWithTags = z.infer<typeof CampaignWithTagsSchema>;
export type Lead = z.infer<typeof LeadSchema>;
export type LeadStatus = z.infer<typeof LeadStatusEnum>;
export type EmailAccount = z.infer<typeof EmailAccountSchema>;
export type CampaignAnalytics = z.infer<typeof CampaignAnalyticsSchema>;
export type UniboxEmail = z.infer<typeof UniboxEmailSchema>;
export type EmailDetail = z.infer<typeof EmailDetailSchema>;
export type Tag = z.infer<typeof TagSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type CampaignEmail = z.infer<typeof CampaignEmailSchema>;
export type SequenceVariant = z.infer<typeof SequenceVariantSchema>;
export type SequenceStep = z.infer<typeof SequenceStepSchema>;
export type CampaignSchedule = z.infer<typeof CampaignScheduleSchema>;
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;
export type LeadLabel = z.infer<typeof LeadLabelSchema>;
export type ListItem = z.infer<typeof ListItemSchema>;
export type StepInfo = z.infer<typeof StepInfoSchema>;

// Input types
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type ListCampaignsInput = z.infer<typeof listCampaignsSchema.input>;
export type GetCampaignInput = z.infer<typeof getCampaignSchema.input>;
export type GetCampaignStatusInput = z.infer<
  typeof getCampaignStatusSchema.input
>;
export type LaunchCampaignInput = z.infer<typeof launchCampaignSchema.input>;
export type PauseCampaignInput = z.infer<typeof pauseCampaignSchema.input>;
export type CreateCampaignInput = z.infer<typeof createCampaignSchema.input>;
export type DeleteCampaignInput = z.infer<typeof deleteCampaignSchema.input>;
export type ListLeadsInput = z.infer<typeof listLeadsSchema.input>;
export type AddLeadsInput = z.infer<typeof addLeadsSchema.input>;
export type UpdateLeadStatusInput = z.infer<
  typeof updateLeadStatusSchema.input
>;
export type DeleteLeadInput = z.infer<typeof deleteLeadSchema.input>;
export type SearchLeadsInput = z.infer<typeof searchLeadsSchema.input>;
export type MoveLeadsInput = z.infer<typeof moveLeadsSchema.input>;
export type ListLeadLabelsInput = z.infer<typeof listLeadLabelsSchema.input>;
export type ListListsInput = z.infer<typeof listListsSchema.input>;
export type ListTagsInput = z.infer<typeof listTagsSchema.input>;
export type CreateTagInput = z.infer<typeof createTagSchema.input>;
export type DeleteTagInput = z.infer<typeof deleteTagSchema.input>;
export type ListAccountsInput = z.infer<typeof listAccountsSchema.input>;
export type GetAccountStatusInput = z.infer<
  typeof getAccountStatusSchema.input
>;
export type EnableWarmupInput = z.infer<typeof enableWarmupSchema.input>;
export type PauseWarmupInput = z.infer<typeof pauseWarmupSchema.input>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema.input>;
export type GetCampaignAnalyticsInput = z.infer<
  typeof getCampaignAnalyticsSchema.input
>;
export type GetAnalyticsSummaryInput = z.infer<
  typeof getAnalyticsSummarySchema.input
>;
export type GetStepAnalyticsInput = z.infer<
  typeof getStepAnalyticsSchema.input
>;
export type GetCrmStatsInput = z.infer<typeof getCrmStatsSchema.input>;
export type GetCreditsInput = z.infer<typeof getCreditsSchema.input>;
export type GetUnreadCountInput = z.infer<typeof getUnreadCountSchema.input>;
export type ListEmailsInput = z.infer<typeof listEmailsSchema.input>;
export type GetEmailDetailInput = z.infer<typeof getEmailDetailSchema.input>;
export type SendEmailInput = z.infer<typeof sendEmailSchema.input>;
export type ReplyToEmailInput = z.infer<typeof replyToEmailSchema.input>;
export type MarkEmailReadInput = z.infer<typeof markEmailReadSchema.input>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema.input>;
export type ListCampaignEmailsInput = z.infer<
  typeof listCampaignEmailsSchema.input
>;
export type SetCampaignSequenceInput = z.infer<
  typeof setCampaignSequenceSchema.input
>;
export type SetCampaignAccountsInput = z.infer<
  typeof setCampaignAccountsSchema.input
>;
export type SetCampaignScheduleInput = z.infer<
  typeof setCampaignScheduleSchema.input
>;
export type GetLeadByEmailInput = z.infer<typeof getLeadByEmailSchema.input>;
export type ListTasksInput = z.infer<typeof listTasksSchema.input>;
export type CreateTaskInput = z.infer<typeof createTaskSchema.input>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema.input>;
export type DeleteTaskInput = z.infer<typeof deleteTaskSchema.input>;
export type TestSmtpConnectionInput = z.infer<
  typeof testSmtpConnectionSchema.input
>;
export type TestImapConnectionInput = z.infer<
  typeof testImapConnectionSchema.input
>;
export type ListWorkspaceMembersInput = z.infer<
  typeof listWorkspaceMembersSchema.input
>;
export type GetOrganizationDataInput = z.infer<
  typeof getOrganizationDataSchema.input
>;

// Output types
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type ListCampaignsOutput = z.infer<typeof listCampaignsSchema.output>;
export type GetCampaignOutput = z.infer<typeof getCampaignSchema.output>;
export type GetCampaignStatusOutput = z.infer<
  typeof getCampaignStatusSchema.output
>;
export type LaunchCampaignOutput = z.infer<typeof launchCampaignSchema.output>;
export type PauseCampaignOutput = z.infer<typeof pauseCampaignSchema.output>;
export type CreateCampaignOutput = z.infer<typeof createCampaignSchema.output>;
export type DeleteCampaignOutput = z.infer<typeof deleteCampaignSchema.output>;
export type ListLeadsOutput = z.infer<typeof listLeadsSchema.output>;
export type AddLeadsOutput = z.infer<typeof addLeadsSchema.output>;
export type UpdateLeadStatusOutput = z.infer<
  typeof updateLeadStatusSchema.output
>;
export type DeleteLeadOutput = z.infer<typeof deleteLeadSchema.output>;
export type SearchLeadsOutput = z.infer<typeof searchLeadsSchema.output>;
export type MoveLeadsOutput = z.infer<typeof moveLeadsSchema.output>;
export type ListLeadLabelsOutput = z.infer<typeof listLeadLabelsSchema.output>;
export type ListListsOutput = z.infer<typeof listListsSchema.output>;
export type ListTagsOutput = z.infer<typeof listTagsSchema.output>;
export type CreateTagOutput = z.infer<typeof createTagSchema.output>;
export type DeleteTagOutput = z.infer<typeof deleteTagSchema.output>;
export type ListAccountsOutput = z.infer<typeof listAccountsSchema.output>;
export type GetAccountStatusOutput = z.infer<
  typeof getAccountStatusSchema.output
>;
export type EnableWarmupOutput = z.infer<typeof enableWarmupSchema.output>;
export type PauseWarmupOutput = z.infer<typeof pauseWarmupSchema.output>;
export type UpdateAccountOutput = z.infer<typeof updateAccountSchema.output>;
export type GetCampaignAnalyticsOutput = z.infer<
  typeof getCampaignAnalyticsSchema.output
>;
export type GetAnalyticsSummaryOutput = z.infer<
  typeof getAnalyticsSummarySchema.output
>;
export type GetStepAnalyticsOutput = z.infer<
  typeof getStepAnalyticsSchema.output
>;
export type GetCrmStatsOutput = z.infer<typeof getCrmStatsSchema.output>;
export type GetCreditsOutput = z.infer<typeof getCreditsSchema.output>;
export type GetUnreadCountOutput = z.infer<typeof getUnreadCountSchema.output>;
export type ListEmailsOutput = z.infer<typeof listEmailsSchema.output>;
export type GetEmailDetailOutput = z.infer<typeof getEmailDetailSchema.output>;
export type SendEmailOutput = z.infer<typeof sendEmailSchema.output>;
export type ReplyToEmailOutput = z.infer<typeof replyToEmailSchema.output>;
export type MarkEmailReadOutput = z.infer<typeof markEmailReadSchema.output>;
export type UpdateCampaignOutput = z.infer<typeof updateCampaignSchema.output>;
export type ListCampaignEmailsOutput = z.infer<
  typeof listCampaignEmailsSchema.output
>;
export type SetCampaignSequenceOutput = z.infer<
  typeof setCampaignSequenceSchema.output
>;
export type SetCampaignAccountsOutput = z.infer<
  typeof setCampaignAccountsSchema.output
>;
export type SetCampaignScheduleOutput = z.infer<
  typeof setCampaignScheduleSchema.output
>;
export type GetLeadByEmailOutput = z.infer<typeof getLeadByEmailSchema.output>;
export type ListTasksOutput = z.infer<typeof listTasksSchema.output>;
export type CreateTaskOutput = z.infer<typeof createTaskSchema.output>;
export type UpdateTaskOutput = z.infer<typeof updateTaskSchema.output>;
export type DeleteTaskOutput = z.infer<typeof deleteTaskSchema.output>;
export type TestSmtpConnectionOutput = z.infer<
  typeof testSmtpConnectionSchema.output
>;
export type TestImapConnectionOutput = z.infer<
  typeof testImapConnectionSchema.output
>;
export type ListWorkspaceMembersOutput = z.infer<
  typeof listWorkspaceMembersSchema.output
>;
export type GetOrganizationDataOutput = z.infer<
  typeof getOrganizationDataSchema.output
>;
