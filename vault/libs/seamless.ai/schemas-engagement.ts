import { z } from 'zod';

// ============================================================================
// Shared types
// ============================================================================

const CampaignSchema = z.object({
  id: z.string().describe('Campaign ID'),
  name: z.string().describe('Campaign name'),
  status: z.string().describe('Campaign status'),
  createdAt: z.string().describe('ISO timestamp when campaign was created'),
  updatedAt: z
    .string()
    .describe('ISO timestamp when campaign was last updated'),
});

export type Campaign = z.infer<typeof CampaignSchema>;

const TaskCountsSchema = z.object({
  totalCount: z.number().describe('Total number of tasks'),
  statusCounts: z
    .object({
      DRAFT: z.number(),
      TODO: z.number(),
      QUEUED: z.number(),
      SCHEDULED: z.number(),
      STARTED: z.number(),
      RETRYING: z.number(),
      PAUSED: z.number(),
      COMPLETED: z.number(),
      PASTDUE: z.number(),
      ARCHIVED: z.number(),
      ERROR: z.number(),
      CANCELED: z.number(),
      SKIPPED: z.number(),
      DUE_TODAY: z.number(),
      DELETED: z.number(),
      ALL: z.number().optional(),
    })
    .describe('Count of tasks grouped by status'),
  taskTypeCounts: z
    .object({
      email: z.number(),
      'auto-email': z.number(),
      'manual-email': z.number(),
      bulkEmail: z.number(),
      call: z.number(),
      linkedIn: z.number(),
      'linkedin-message': z.number(),
      'linkedin-connect-request': z.number(),
      custom: z.number(),
      default: z.number(),
    })
    .describe('Count of tasks grouped by type'),
  isDueCount: z.number().describe('Number of tasks due now'),
  activeInCampaign: z.number().describe('Tasks active in campaigns'),
  totalInCampaign: z.number().describe('Total tasks in campaigns'),
});

export type TaskCounts = z.infer<typeof TaskCountsSchema>;

const ActivityStatsSchema = z.object({
  sentEmails: z.number().describe('Total sent emails'),
  scheduledEmails: z.number().describe('Scheduled emails'),
  receivedEmails: z.number().describe('Received emails'),
  openedEmails: z.number().describe('Opened emails'),
  bouncedEmails: z.number().describe('Bounced emails'),
  repliedEmails: z.number().describe('Replied emails'),
  totalCalls: z.number().describe('Total calls'),
  answeredCalls: z.number().describe('Answered calls'),
  receivedCalls: z.number().describe('Received calls'),
  callsWithPositiveSentiment: z
    .number()
    .describe('Calls with positive sentiment'),
  missedCalls: z.number().describe('Missed calls'),
  voicemails: z.number().describe('Voicemails'),
  unsubscribedEmails: z.number().describe('Unsubscribed emails'),
  emailsWithMissingVars: z
    .number()
    .describe('Emails with missing template variables'),
  pausedEmails: z.number().describe('Paused emails'),
  skippedEmails: z.number().describe('Skipped emails'),
  awaitingFollowup: z.number().describe('Activities awaiting follow-up'),
  numErrors: z.number().describe('Number of errors'),
  activeInCampaign: z.number().describe('Active in campaign'),
  totalEmails: z.number().describe('Total email count'),
  totalActivityThreadCount: z.number().describe('Total activity thread count'),
});

export type ActivityStats = z.infer<typeof ActivityStatsSchema>;

const TemplateFolderSchema = z.object({
  templateFolderId: z.number().describe('Folder ID'),
  folderPath: z
    .string()
    .describe('Folder name/path (e.g., Email, Call, LinkedIn Message)'),
  icon: z.string().describe('Icon name'),
  templatesCount: z.number().describe('Number of templates in this folder'),
});

export type TemplateFolder = z.infer<typeof TemplateFolderSchema>;

// ============================================================================
// listCampaigns
// ============================================================================

export const listCampaignsSchema = {
  name: 'listCampaigns',
  description:
    'List all outreach campaigns with status and metrics. Returns campaigns sorted by creation date.',
  notes: 'Requires orgId from getContext().',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
    limit: z
      .number()
      .optional()
      .describe('Max campaigns to return (default 50, max 100)'),
    offset: z.number().optional().describe('Pagination offset (default 0)'),
    sortColumn: z
      .enum([
        'createdAt',
        'updatedAt',
        'name',
        'numContacts',
        'numActive',
        'numPaused',
        'numCompleted',
        'numSteps',
        'numEmails',
        'numReplies',
        'ownerName',
        'scheduleName',
        'startedAt',
      ])
      .optional()
      .describe('Column to sort by (default createdAt)'),
    sortOrder: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Sort direction (default desc)'),
    status: z
      .string()
      .optional()
      .describe(
        'Filter by status. Single value or pipe-delimited: "draft", "active", "paused", "completed", "archived". Example: "draft|active"',
      ),
    searchText: z
      .string()
      .optional()
      .describe('Filter campaigns by name (case-insensitive substring match)'),
  }),
  output: z.object({
    campaigns: z.array(CampaignSchema).describe('List of campaigns'),
    total: z.number().describe('Total number of campaigns'),
    archived: z.number().describe('Number of archived campaigns'),
    numErrors: z.number().describe('Number of campaign errors'),
  }),
};

export type ListCampaignsInput = z.infer<typeof listCampaignsSchema.input>;
export type ListCampaignsOutput = z.infer<typeof listCampaignsSchema.output>;

// ============================================================================
// listTasks
// ============================================================================

const TaskItemSchema = z.object({
  id: z
    .string()
    .describe('Numeric task ID (taskId from API). Use this for updateTask().'),
  name: z.string().optional().describe('Task name'),
  taskType: z
    .string()
    .describe(
      'Task type: email, auto-email, manual-email, bulkEmail, call, linkedIn, linkedin-message, linkedin-connect-request, custom',
    ),
  status: z
    .string()
    .describe(
      'Task status: DRAFT, TODO, QUEUED, SCHEDULED, STARTED, RETRYING, PAUSED, COMPLETED, PASTDUE, ARCHIVED, ERROR, CANCELED, SKIPPED, DELETED',
    ),
  description: z.string().optional().describe('Task description/notes'),
  priority: z
    .string()
    .optional()
    .describe('Priority label: none, low, medium, high'),
  subject: z
    .string()
    .optional()
    .describe('Task subject (e.g., email subject line)'),
  dueAt: z
    .string()
    .optional()
    .describe('Due date in ISO 8601 format (from API dueAt field)'),
  contactId: z.string().optional().describe('Linked contact numeric ID'),
  campaignId: z.string().optional().describe('Linked campaign ID'),
  createdAt: z
    .string()
    .optional()
    .describe('ISO timestamp when task was created'),
  updatedAt: z
    .string()
    .optional()
    .describe('ISO timestamp when task was last updated'),
});

export type TaskItem = z.infer<typeof TaskItemSchema>;

export const listTasksSchema = {
  name: 'listTasks',
  description:
    'List outreach tasks with name, description, priority, dueAt, and status. Use this before updateTask() to get taskId values, and after updateTask() to verify the write.',
  notes:
    'Requires orgId from getContext(). tasksCounts always returns all zeros (API limitation regardless of actual task count); use count for the real task total. Items include mutable fields (name, description, priority, dueAt) that updateTask() can modify.',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
    limit: z.number().optional().describe('Max tasks to return (default 50)'),
    offset: z.number().optional().describe('Pagination offset (default 0)'),
    sortColumn: z
      .enum(['createdAt', 'updatedAt'])
      .optional()
      .describe('Column to sort by (default createdAt)'),
    sortOrder: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Sort direction (default desc)'),
  }),
  output: z.object({
    items: z
      .array(TaskItemSchema)
      .describe(
        'Task items with mutable fields exposed (name, description, priority, dueAt). Use sortColumn=updatedAt to see recently modified tasks first.',
      ),
    count: z.number().describe('Total number of tasks matching the query'),
    tasksCounts: TaskCountsSchema.describe(
      'Aggregate task counts (always zero, known API limitation). Ignore these values; use count instead.',
    ),
  }),
};

export type ListTasksInput = z.infer<typeof listTasksSchema.input>;
export type ListTasksOutput = z.infer<typeof listTasksSchema.output>;

// ============================================================================
// listActivities
// ============================================================================

export const listActivitiesSchema = {
  name: 'listActivities',
  description:
    'List outreach activity feed with aggregate email and call statistics.',
  notes: 'Requires orgId from getContext().',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
    limit: z
      .number()
      .optional()
      .describe('Max activities to return (default 50)'),
    offset: z.number().optional().describe('Pagination offset (default 0)'),
    sortColumn: z
      .enum(['createdAt', 'updatedAt'])
      .optional()
      .describe('Column to sort by (default createdAt)'),
    sortOrder: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('Sort direction (default desc)'),
  }),
  output: z.object({
    activityData: z
      .array(z.record(z.string(), z.unknown()))
      .describe(
        'Activity feed items. Common properties: id (string), type (email|call|linkedIn|custom), subject, contactId, createdAt (ISO timestamp), status',
      ),
    activityStats: ActivityStatsSchema.describe(
      'Aggregate statistics for emails, calls, and other activities',
    ),
  }),
};

export type ListActivitiesInput = z.infer<typeof listActivitiesSchema.input>;
export type ListActivitiesOutput = z.infer<typeof listActivitiesSchema.output>;

// ============================================================================
// listTemplateFolders
// ============================================================================

export const listTemplateFoldersSchema = {
  name: 'listTemplateFolders',
  description:
    'List email template folder structure. Returns folders for organizing outreach templates by type (Email, Call, LinkedIn, etc.).',
  notes: 'Requires orgId from getContext().',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
  }),
  output: z.object({
    folders: z
      .array(TemplateFolderSchema)
      .describe('Template folders organized by outreach type'),
  }),
};

export type ListTemplateFoldersInput = z.infer<
  typeof listTemplateFoldersSchema.input
>;
export type ListTemplateFoldersOutput = z.infer<
  typeof listTemplateFoldersSchema.output
>;

// ============================================================================
// getCampaign
// ============================================================================

const CampaignDetailSchema = z.object({
  id: z.string().describe('Campaign numeric ID'),
  identifier: z
    .string()
    .describe('Campaign URL slug identifier (e.g., A17gHJuDleNepCSZ5vdJl)'),
  name: z.string().describe('Campaign name'),
  status: z
    .string()
    .describe('Campaign status: draft, active, paused, completed, archived'),
  createdAt: z.string().describe('ISO timestamp when campaign was created'),
  startedAt: z
    .string()
    .nullable()
    .optional()
    .describe('ISO timestamp when campaign was started, null if not started'),
  pausedAt: z
    .string()
    .nullable()
    .optional()
    .describe('ISO timestamp when campaign was paused, null if not paused'),
  completedAt: z
    .string()
    .nullable()
    .optional()
    .describe('ISO timestamp when campaign completed, null if not completed'),
  archivedAt: z
    .string()
    .nullable()
    .optional()
    .describe('ISO timestamp when campaign was archived, null if not archived'),
  deletedAt: z
    .string()
    .nullable()
    .optional()
    .describe('ISO timestamp when campaign was deleted, null if not deleted'),
  ownerName: z.string().describe('Name of the campaign owner'),
  userIdOwner: z.string().optional().describe('User ID of the campaign owner'),
  scheduleId: z
    .number()
    .optional()
    .describe('Schedule ID used by this campaign'),
  scheduleName: z.string().describe('Name of the campaign schedule'),
  scheduleData: z
    .object({
      days: z.record(z.string(), z.unknown()).describe('Schedule days config'),
      timezone: z.string().describe('Timezone for the schedule'),
    })
    .optional()
    .describe('Full schedule configuration with days and timezone'),
  numContacts: z.number().describe('Total contacts in this campaign'),
  numActive: z.number().describe('Active contacts'),
  numPaused: z.number().describe('Paused contacts'),
  numCompleted: z.number().nullable().optional().describe('Completed contacts'),
  numRemoved: z.number().optional().describe('Contacts removed from campaign'),
  numOptedOut: z.number().optional().describe('Contacts who opted out'),
  closedWon: z.number().optional().describe('Contacts marked as closed/won'),
  numSteps: z.number().describe('Number of campaign steps'),
  numDays: z
    .number()
    .nullable()
    .optional()
    .describe('Campaign duration in days'),
  numEmails: z.number().nullable().optional().describe('Total emails sent'),
  numOpens: z.number().nullable().optional().describe('Total email opens'),
  numReplies: z.number().nullable().optional().describe('Total email replies'),
  numBounces: z.number().nullable().optional().describe('Total email bounces'),
  numSent: z
    .number()
    .nullable()
    .optional()
    .describe('Total emails sent (alias for numEmails)'),
  numSkipped: z
    .number()
    .nullable()
    .optional()
    .describe('Contacts skipped in campaign'),
  numCalls: z.number().nullable().optional().describe('Total calls made'),
  numPositive: z
    .number()
    .nullable()
    .optional()
    .describe('Calls or contacts with positive sentiment'),
  numErrors: z.number().nullable().optional().describe('Number of errors'),
  numEmailsScheduledToday: z
    .number()
    .nullable()
    .optional()
    .describe('Emails scheduled to send today'),
  numEmailsSentToday: z
    .number()
    .nullable()
    .optional()
    .describe('Emails already sent today'),
  isPublic: z
    .boolean()
    .optional()
    .describe('Whether this campaign is shared/public within the org'),
  isTestCampaign: z
    .boolean()
    .optional()
    .describe('Whether this is a test campaign'),
  excludeHolidays: z
    .boolean()
    .optional()
    .describe('Whether to skip sending on holidays'),
  dailyEmailLimit: z
    .number()
    .nullable()
    .optional()
    .describe('Maximum emails per day, null if no limit set'),
  useDailyEmailLimit: z
    .boolean()
    .optional()
    .describe('Whether daily email limit is enforced'),
  removeUnsubscribedContacts: z
    .boolean()
    .optional()
    .describe('Whether to auto-remove contacts who unsubscribe'),
  externalProviderAccountIds: z
    .array(z.string())
    .nullable()
    .optional()
    .describe('Connected email account IDs used for sending in this campaign'),
  tagNames: z
    .array(z.string())
    .nullable()
    .optional()
    .describe('Names of tags applied to this campaign'),
  tagIds: z
    .array(z.string())
    .nullable()
    .optional()
    .describe('IDs of tags applied to this campaign'),
  notifyContactsAdded: z
    .boolean()
    .optional()
    .describe('Whether to notify when contacts are added to this campaign'),
  notifyContactsRemoved: z
    .boolean()
    .optional()
    .describe('Whether to notify when contacts are removed from this campaign'),
  notifyContactCompletedCampaign: z
    .boolean()
    .optional()
    .describe('Whether to notify when a contact completes the campaign'),
  notifyCampaignStatusChanged: z
    .boolean()
    .optional()
    .describe('Whether to notify when the campaign status changes'),
  notifyCampaignCompleted: z
    .boolean()
    .optional()
    .describe('Whether to notify when the entire campaign completes'),
  emailFooterId: z
    .string()
    .nullable()
    .optional()
    .describe('ID of the email footer applied to this campaign'),
  isFooterEnabled: z
    .boolean()
    .optional()
    .describe('Whether the email footer is enabled for this campaign'),
  selectedContactIds: z
    .array(z.string())
    .optional()
    .describe('IDs of contacts currently selected in this campaign'),
  steps: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe('Campaign step definitions (sequence of outreach actions)'),
  isSelectedCampaign: z
    .boolean()
    .optional()
    .describe(
      'Whether this campaign is currently selected/active in the UI context',
    ),
});

export type CampaignDetail = z.infer<typeof CampaignDetailSchema>;

export const getCampaignSchema = {
  name: 'getCampaign',
  description:
    'Get detailed information about a single campaign including contact counts, email/call metrics, configuration, notification settings, and campaign steps. Uses a dedicated details endpoint for richer data than the list endpoint.',
  notes:
    'Requires orgId from getContext() and a campaignId (numeric) from listCampaigns(). If you already have the alphanumeric identifier (e.g., "nwGweAtxy9U3xhzIdMcqJ" from a previous getCampaign call), pass it as identifier to skip the intermediate list fetch.',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
    campaignId: z.string().describe('Campaign numeric ID from listCampaigns()'),
    identifier: z
      .string()
      .optional()
      .describe(
        'Campaign alphanumeric URL slug (e.g., "nwGweAtxy9U3xhzIdMcqJ"). If provided, skips the list fetch and calls the details endpoint directly (more efficient).',
      ),
  }),
  output: CampaignDetailSchema,
};

export type GetCampaignInput = z.infer<typeof getCampaignSchema.input>;
export type GetCampaignOutput = z.infer<typeof getCampaignSchema.output>;

// ============================================================================
// createCampaign
// ============================================================================

export const createCampaignSchema = {
  name: 'createCampaign',
  description:
    'Create a new outreach campaign. The campaign is created in draft status with a default schedule.',
  notes:
    'Requires orgId and userId from getContext(). Automatically uses the default "Normal Business Hours" schedule. The created campaign will have no steps initially; add steps via the Seamless.AI UI. Name deduplication: if a campaign with the same name already exists, Seamless.AI auto-appends "(1)", "(2)", etc., and the returned name may differ from the input. tagIds: Seamless.AI does not expose an endpoint to list valid campaign label IDs; only pass tagIds if you have obtained them from a previous listCampaigns/getCampaign call. Invalid tagIds cause a 500 error from the API.',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
    userId: z
      .string()
      .describe('User ID from getContext() (set as campaign owner)'),
    name: z
      .string()
      .describe(
        'Name for the new campaign. If the name already exists, Seamless.AI silently appends "(1)", "(2)", etc. Check the returned name to confirm what was created.',
      ),
    scheduleId: z
      .number()
      .optional()
      .describe(
        'Schedule ID for the campaign. Omit to auto-detect the default schedule.',
      ),
    tagIds: z
      .array(z.string())
      .optional()
      .describe(
        'Campaign label/tag IDs to assign. These are campaign-level labels (not contact list tags). WARNING: there is no function to list valid campaign label IDs; only use values obtained from getCampaign() or listCampaigns(). Invalid IDs cause a 500 API error.',
      ),
    externalProviderAccountIds: z
      .array(z.string())
      .optional()
      .describe(
        'Connected email account IDs to use for sending in this campaign (e.g., ["72106"]). Omit to skip email sender selection.',
      ),
    listIds: z
      .array(z.string())
      .optional()
      .describe(
        'Contact list IDs whose contacts will be added to the campaign on creation. Get IDs from listContactLists().',
      ),
    contactIds: z
      .array(z.string())
      .optional()
      .describe(
        'Specific contact IDs (numeric, from researchContact) to add to the campaign on creation.',
      ),
    isPublic: z
      .boolean()
      .optional()
      .describe(
        'Whether the campaign is visible to all org members (default false, private to owner).',
      ),
  }),
  output: z.object({
    id: z.string().describe('Created campaign numeric ID'),
    identifier: z.string().describe('Campaign URL slug identifier'),
    name: z
      .string()
      .describe(
        'Actual campaign name as created (may differ from input if name was deduplicated)',
      ),
    status: z.string().describe('Campaign status (draft)'),
    createdAt: z.string().describe('ISO timestamp when campaign was created'),
    isPublic: z
      .boolean()
      .describe('Whether the campaign is visible to all org members'),
    isTestCampaign: z
      .boolean()
      .describe(
        'Whether this is a test campaign (always false; the API does not support setting this on creation)',
      ),
  }),
};

export type CreateCampaignInput = z.infer<typeof createCampaignSchema.input>;
export type CreateCampaignOutput = z.infer<typeof createCampaignSchema.output>;

// ============================================================================
// createTask
// ============================================================================

export const createTaskSchema = {
  name: 'createTask',
  description:
    'Create a new outreach task. Can be standalone or linked to a contact. Tasks linked to a contact (via contactId) appear in listTasks() and return a taskId.',
  notes:
    'Requires orgId from getContext(). Standalone tasks (no contactId) are accepted but not visible in listTasks(). When contactId is provided, userIdAssignee is required; use userId from getContext(). The API uses dueAt (not dueDate) for scheduling; dueDate is accepted as a legacy alias. Priority is numeric: 0=none, 1=low, 2=medium, 3=high.',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
    name: z.string().describe('Task name (required by API)'),
    taskType: z
      .enum([
        'email',
        'auto-email',
        'manual-email',
        'call',
        'linkedIn',
        'linkedin-message',
        'linkedin-connect-request',
        'custom',
      ])
      .describe('Type of outreach task'),
    status: z
      .enum(['DRAFT', 'TODO', 'SCHEDULED'])
      .optional()
      .describe('Initial task status (default TODO)'),
    subject: z
      .string()
      .optional()
      .describe('Task subject (e.g., email subject line)'),
    dueDate: z
      .string()
      .optional()
      .describe(
        'Legacy alias for dueAt. Due date in ISO 8601 format (e.g., 2026-03-15T00:00:00.000Z). Use dueAt instead.',
      ),
    dueAt: z
      .string()
      .optional()
      .describe(
        'Due date and time in ISO 8601 format (e.g., 2026-03-15T14:00:00.000Z). This is the correct API field; use this over dueDate.',
      ),
    description: z.string().optional().describe('Task description/notes'),
    priority: z
      .enum(['none', 'low', 'medium', 'high'])
      .optional()
      .describe(
        'Task priority level (default none). Internally mapped to integers: none=0, low=1, medium=2, high=3.',
      ),
    contactId: z
      .string()
      .optional()
      .describe(
        'Numeric contact ID to link this task to a saved contact (e.g., "5788427514"). Get IDs from listContacts() or researchContact(). When provided, userIdAssignee is required.',
      ),
    userIdAssignee: z
      .string()
      .optional()
      .describe(
        'User ID to assign the task to. Use userId from getContext(). Required when contactId is provided.',
      ),
    tagIds: z
      .array(z.string())
      .optional()
      .describe(
        'Task label/tag IDs to assign to this task. These are task-level labels, not contact list tags.',
      ),
    templateId: z
      .string()
      .optional()
      .describe(
        'Template ID to pre-populate task content. Get template IDs from listTemplates().',
      ),
    isAutomated: z
      .boolean()
      .optional()
      .describe(
        'Whether this task is automated (default false). Automated tasks are triggered by campaign sequences.',
      ),
    parentTaskId: z
      .string()
      .optional()
      .describe(
        'Parent task ID for nested tasks. Creates a subtask relationship.',
      ),
    campaignStepId: z
      .string()
      .optional()
      .describe(
        'Campaign step ID to link this task to a specific step in a campaign sequence.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the task was created successfully'),
    taskName: z.string().describe('The name passed to the create request'),
    taskId: z
      .string()
      .optional()
      .describe(
        'Numeric task ID returned when contactId was provided. Use this for updateTask() or other task operations.',
      ),
  }),
};

export type CreateTaskInput = z.infer<typeof createTaskSchema.input>;
export type CreateTaskOutput = z.infer<typeof createTaskSchema.output>;

// ============================================================================
// updateTask
// ============================================================================

export const updateTaskSchema = {
  name: 'updateTask',
  description:
    'Update task properties: name, description, due date, or priority. Returns the updated field values read back from the API to confirm the write.',
  notes:
    'Requires orgId from getContext() and a taskId from listTasks(). The taskType field is required by the API for all updates; use the same taskType as the original task from listTasks(). Valid update fields (HAR-verified): name, description, dueAt, priority. After the PUT, the function reads the task back from listTasks() using sortColumn=updatedAt and returns the actual stored values. The single-task GET endpoint only returns {success: true} and cannot be used for verification.',
  input: z.object({
    orgId: z.string().describe('Organization ID from getContext()'),
    taskId: z
      .string()
      .describe(
        'Numeric task ID from listTasks() (e.g., "12345"). Must be a valid integer string.',
      ),
    taskType: z
      .enum([
        'email',
        'auto-email',
        'manual-email',
        'call',
        'linkedIn',
        'linkedin-message',
        'linkedin-connect-request',
        'custom',
      ])
      .describe(
        'Task type (required by API). Use the same taskType as the original task from listTasks().',
      ),
    name: z.string().optional().describe('Updated task name'),
    dueDate: z
      .string()
      .optional()
      .describe(
        'Legacy alias for dueAt. Use dueAt instead; this is mapped to dueAt in the API call.',
      ),
    dueAt: z
      .string()
      .optional()
      .describe(
        'Due date and time in ISO 8601 format (e.g., "2026-04-01T14:00:00.000Z"). This is the correct API field name, preferred over dueDate.',
      ),
    description: z.string().optional().describe('Updated task description'),
    priority: z
      .enum(['none', 'low', 'medium', 'high'])
      .optional()
      .describe(
        'Updated task priority. Mapped to integers internally: none=0, low=1, medium=2, high=3.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the update was successful'),
    taskId: z.string().describe('The task ID that was updated'),
    name: z
      .string()
      .optional()
      .describe('Task name as read back from API after update'),
    description: z
      .string()
      .optional()
      .describe('Task description as read back from API after update'),
    priority: z
      .string()
      .optional()
      .describe('Priority label read back from API: none, low, medium, high'),
    dueAt: z
      .string()
      .optional()
      .describe('Due date as read back from API after update (ISO 8601)'),
    updatedAt: z
      .string()
      .optional()
      .describe('ISO timestamp confirming the task was updated'),
  }),
};

export type UpdateTaskInput = z.infer<typeof updateTaskSchema.input>;
export type UpdateTaskOutput = z.infer<typeof updateTaskSchema.output>;

// ============================================================================
// allSchemas (for barrel import)
// ============================================================================

export const engagementSchemas = [
  listCampaignsSchema,
  listTasksSchema,
  listActivitiesSchema,
  listTemplateFoldersSchema,
  getCampaignSchema,
  createCampaignSchema,
  createTaskSchema,
  updateTaskSchema,
];
