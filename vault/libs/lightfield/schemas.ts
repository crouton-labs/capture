import { z } from 'zod';

export const libraryDescription =
  'Lightfield CRM operations via AI chat and direct API';

export const libraryIcon = '/icons/libs/lightfield.ico';
export const loginUrl = 'https://crm.lightfield.app';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://crm.lightfield.app\`
2. Call \`getContext()\` to confirm auth session
3. Use \`sendChat()\` for AI-driven CRM operations (create, search, update, action items)
4. Use direct API functions for programmatic CRUD when needed

## Key Concepts

- **AI Chat is the primary interface.** Lightfield's CRM operations happen through its AI chatbot via \`sendChat()\`. The function returns the full response including tool calls and results. You can instruct the AI with natural language for any CRM operation.
- **Draft workflow.** Create/update operations via chat go through a draft then approve flow. Always add "and approve it" to your message for single-step execution.
- **Thread context.** Pass the same \`threadId\` for multi-turn conversations. The AI remembers context within a thread.
- **Direct API for deletions.** The AI chatbot cannot delete records. Use \`deleteAccount()\`, \`deleteContact()\`, etc. for deletions.
- **Contact/Note updates require chat.** Direct GraphQL mutations for updating contacts and notes are auth-restricted. Use \`sendChat()\` with "and approve it" instead.

## Chat Capabilities

| Operation | Example Message |
|-----------|----------------|
| Search entities | "Find all contacts at Acme Corp" |
| Create account | "Create account Acme Corp with website acme.com and approve it" |
| Create contact | "Create contact John Doe as CTO at Acme Corp and approve" |
| Create opportunity | "Create opportunity Big Deal at Lead stage for Acme Corp and approve" |
| Update fields | "Change Acme Corp's name to Acme Corporation and approve" |
| Update contact | "Update John Doe's title to VP of Sales and approve" |
| Get CSV export | "List all accounts" (returns formatted table + CSV tool call) |

## Pagination

Offset-based for list endpoints. \`limit\` (page size, default 20), \`offset\` (start index, default 0).

## Entity Types

Accounts, Contacts, Opportunities, Tasks, Meetings, Notes.
`;

// ============================================================================
// Shared Schemas
// ============================================================================

const CrmFieldSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  type: z.string(),
  value: z.unknown(),
  system: z.boolean().optional(),
});

const PageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
  totalCount: z.number(),
});

const SortBySchema = z
  .object({
    key: z
      .string()
      .describe(
        'Field to sort by. Accounts support: name, createdAt, updatedAt. Contacts/Opportunities/Tasks/Notes support: createdAt, updatedAt (not name).',
      ),
    direction: z.enum(['ASC', 'DESC']).describe('Sort direction'),
  })
  .optional();

const SlateNodeSchema = z.object({
  type: z.string().describe('Node type, e.g. "paragraph"'),
  children: z.array(z.object({ text: z.string() })).describe('Text content'),
});

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Get authentication context from Lightfield session (user info, org)',
  notes: 'Call first. Requires user to be logged into crm.lightfield.app.',
  input: z.object({}),
  output: z.object({
    userId: z.string().describe('Lightfield user ID'),
    email: z.string().describe('User email address'),
    name: z.string().describe('User display name'),
  }),
};
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// Chat
// ============================================================================

const ToolCallSchema = z.object({
  toolCallId: z.string().describe('Unique tool call ID'),
  toolName: z
    .string()
    .describe(
      'Tool name: findEntities, createCrmAccountsV2, createCrmContactsV2, createCrmOpportunitiesV2, updateFieldValuesV2Account, acceptOrDismissDraft, getAccountsCsv',
    ),
  input: z.record(z.string(), z.unknown()).describe('Tool input parameters'),
  output: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .describe('Tool execution result'),
});

export const sendChatSchema = {
  name: 'sendChat',
  description:
    'Send a message to the Lightfield AI chatbot and get the full response including any CRM tool calls and their results',
  notes:
    'Primary interface for Lightfield CRM. The AI can search, create, update, and manage entities. Always say "and approve it" in your message for immediate execution. Delete is NOT supported via chat - use deleteAccount/deleteContact/etc. instead.',
  input: z.object({
    message: z.string().describe('Message to send to the AI chatbot'),
    threadId: z
      .string()
      .optional()
      .describe(
        'Thread ID for conversation continuity. Omit to start a new thread.',
      ),
    modelName: z
      .string()
      .optional()
      .default('sonnet_4_6')
      .describe(
        'AI model to use. Default: sonnet_4_6. Options: sonnet_4_6, opus_4_6',
      ),
  }),
  output: z.object({
    messageId: z.string().describe('Response message ID'),
    threadId: z.string().describe('Thread ID (use for follow-up messages)'),
    text: z.string().describe('AI text response'),
    toolCalls: z.array(ToolCallSchema).describe('Tool calls made by the AI'),
    finishReason: z.string().describe('Why the response ended: stop, etc.'),
  }),
};
export type SendChatInput = z.infer<typeof sendChatSchema.input>;
export type SendChatOutput = z.infer<typeof sendChatSchema.output>;

// ============================================================================
// Account Schemas
// ============================================================================

const CrmAccountSchema = z.object({
  id: z.string().describe('Account ID'),
  name: z.string().describe('Account name'),
  objectStatus: z.string().describe('Status: ACTIVE or TRASHED'),
  ownerUserId: z.string().optional().describe('Owner user ID'),
  createdAt: z.number().describe('Creation timestamp (epoch ms)'),
  updatedAt: z.number().describe('Last update timestamp (epoch ms)'),
  crmOpportunityCount: z
    .number()
    .optional()
    .describe('Number of associated opportunities'),
  crmOpportunityIds: z
    .array(z.string())
    .optional()
    .describe('Associated opportunity IDs'),
  crmFields: z
    .array(CrmFieldSchema)
    .optional()
    .describe('Custom and system fields with values'),
});

export const listAccountsSchema = {
  name: 'listAccounts',
  description: 'List CRM accounts with pagination, sorting, and filtering',
  notes: '',
  input: z.object({
    limit: z.number().optional().default(20).describe('Page size (default 20)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Start index (default 0)'),
    sortBy: z
      .array(SortBySchema)
      .optional()
      .default([{ key: 'name', direction: 'ASC' }])
      .describe('Sort criteria'),
    objectStatus: z
      .enum(['ACTIVE', 'TRASHED'])
      .optional()
      .default('ACTIVE')
      .describe('Filter by status'),
  }),
  output: z.object({
    accounts: z.array(CrmAccountSchema).describe('Account records'),
    pageInfo: PageInfoSchema.describe('Pagination info'),
  }),
};
export type ListAccountsInput = z.infer<typeof listAccountsSchema.input>;
export type ListAccountsOutput = z.infer<typeof listAccountsSchema.output>;

export const getAccountSchema = {
  name: 'getAccount',
  description: 'Get a single CRM account by ID',
  notes: '',
  input: z.object({
    id: z.string().describe('Account ID'),
  }),
  output: CrmAccountSchema,
};
export type GetAccountInput = z.infer<typeof getAccountSchema.input>;
export type GetAccountOutput = z.infer<typeof getAccountSchema.output>;

export const createAccountSchema = {
  name: 'createAccount',
  description: 'Create a new CRM account',
  notes: '',
  input: z.object({
    companyName: z.string().describe('Company/account name'),
  }),
  output: z.object({
    id: z.string().describe('Created account ID'),
    name: z.string().describe('Account name'),
    crmFields: z.array(CrmFieldSchema).optional().describe('Account fields'),
  }),
};
export type CreateAccountInput = z.infer<typeof createAccountSchema.input>;
export type CreateAccountOutput = z.infer<typeof createAccountSchema.output>;

export const updateAccountSchema = {
  name: 'updateAccount',
  description: 'Update a CRM account name',
  notes: 'For updating custom fields, use sendChat() with "and approve it".',
  input: z.object({
    id: z.string().describe('Account ID to update'),
    name: z.string().describe('New account name'),
  }),
  output: z.object({
    id: z.string().describe('Updated account ID'),
    name: z.string().describe('Updated account name'),
  }),
};
export type UpdateAccountInput = z.infer<typeof updateAccountSchema.input>;
export type UpdateAccountOutput = z.infer<typeof updateAccountSchema.output>;

export const deleteAccountSchema = {
  name: 'deleteAccount',
  description: 'Delete a CRM account',
  notes: '',
  input: z.object({
    id: z.string().describe('Account ID to delete'),
  }),
  output: z.object({
    id: z.string().describe('Deleted account ID'),
  }),
};
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema.input>;
export type DeleteAccountOutput = z.infer<typeof deleteAccountSchema.output>;

// ============================================================================
// Contact Schemas
// ============================================================================

const CrmContactSchema = z.object({
  id: z.string().describe('Contact ID'),
  name: z.string().optional().describe('Full name'),
  objectStatus: z.string().describe('Status: ACTIVE or TRASHED'),
  ownerUserId: z.string().optional().describe('Owner user ID'),
  createdAt: z.number().describe('Creation timestamp (epoch ms)'),
  updatedAt: z.number().describe('Last update timestamp (epoch ms)'),
  crmFields: z
    .array(CrmFieldSchema)
    .optional()
    .describe(
      'Custom and system fields. Common keys: firstName, lastName, title, email',
    ),
});

export const listContactsSchema = {
  name: 'listContacts',
  description: 'List CRM contacts with pagination, sorting, and filtering',
  notes: '',
  input: z.object({
    limit: z.number().optional().default(20).describe('Page size (default 20)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Start index (default 0)'),
    sortBy: z
      .array(SortBySchema)
      .optional()
      .default([{ key: 'name', direction: 'ASC' }])
      .describe('Sort criteria'),
    objectStatus: z
      .enum(['ACTIVE', 'TRASHED'])
      .optional()
      .default('ACTIVE')
      .describe('Filter by status'),
  }),
  output: z.object({
    contacts: z.array(CrmContactSchema).describe('Contact records'),
    pageInfo: PageInfoSchema.describe('Pagination info'),
  }),
};
export type ListContactsInput = z.infer<typeof listContactsSchema.input>;
export type ListContactsOutput = z.infer<typeof listContactsSchema.output>;

export const getContactSchema = {
  name: 'getContact',
  description: 'Get a single CRM contact by ID',
  notes: '',
  input: z.object({
    id: z.string().describe('Contact ID'),
  }),
  output: CrmContactSchema,
};
export type GetContactInput = z.infer<typeof getContactSchema.input>;
export type GetContactOutput = z.infer<typeof getContactSchema.output>;

export const createContactSchema = {
  name: 'createContact',
  description: 'Create a new CRM contact',
  notes: '',
  input: z.object({
    firstName: z.string().describe('First name'),
    lastName: z.string().describe('Last name'),
    title: z.string().optional().describe('Job title'),
    crmAccountIds: z
      .array(z.string())
      .optional()
      .default([])
      .describe('Account IDs to associate with'),
  }),
  output: z.object({
    id: z.string().describe('Created contact ID'),
    crmFields: z.array(CrmFieldSchema).optional().describe('Contact fields'),
  }),
};
export type CreateContactInput = z.infer<typeof createContactSchema.input>;
export type CreateContactOutput = z.infer<typeof createContactSchema.output>;

export const deleteContactSchema = {
  name: 'deleteContact',
  description: 'Delete a CRM contact',
  notes: '',
  input: z.object({
    id: z.string().describe('Contact ID to delete'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether deletion succeeded'),
  }),
};
export type DeleteContactInput = z.infer<typeof deleteContactSchema.input>;
export type DeleteContactOutput = z.infer<typeof deleteContactSchema.output>;

// ============================================================================
// Opportunity Schemas
// ============================================================================

const CrmOpportunitySchema = z.object({
  id: z.string().describe('Opportunity ID'),
  name: z.string().optional().describe('Opportunity name'),
  objectStatus: z.string().describe('Status: ACTIVE or TRASHED'),
  ownerUserId: z.string().optional().describe('Owner user ID'),
  createdAt: z.number().describe('Creation timestamp (epoch ms)'),
  updatedAt: z.number().describe('Last update timestamp (epoch ms)'),
  crmFields: z
    .array(CrmFieldSchema)
    .optional()
    .describe(
      'Custom and system fields. Common keys: crmOpportunityName, crmOpportunityStage, crmAccountId',
    ),
});

export const listOpportunitiesSchema = {
  name: 'listOpportunities',
  description:
    'List CRM opportunities/deals with pagination, sorting, and filtering',
  notes: '',
  input: z.object({
    limit: z.number().optional().default(20).describe('Page size (default 20)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Start index (default 0)'),
    sortBy: z
      .array(SortBySchema)
      .optional()
      .default([{ key: 'name', direction: 'ASC' }])
      .describe('Sort criteria'),
    objectStatus: z
      .enum(['ACTIVE', 'TRASHED'])
      .optional()
      .default('ACTIVE')
      .describe('Filter by status'),
  }),
  output: z.object({
    opportunities: z
      .array(CrmOpportunitySchema)
      .describe('Opportunity records'),
    pageInfo: PageInfoSchema.describe('Pagination info'),
  }),
};
export type ListOpportunitiesInput = z.infer<
  typeof listOpportunitiesSchema.input
>;
export type ListOpportunitiesOutput = z.infer<
  typeof listOpportunitiesSchema.output
>;

export const getOpportunitySchema = {
  name: 'getOpportunity',
  description: 'Get a single CRM opportunity by ID',
  notes: '',
  input: z.object({
    id: z.string().describe('Opportunity ID'),
  }),
  output: CrmOpportunitySchema,
};
export type GetOpportunityInput = z.infer<typeof getOpportunitySchema.input>;
export type GetOpportunityOutput = z.infer<typeof getOpportunitySchema.output>;

export const createOpportunitySchema = {
  name: 'createOpportunity',
  description: 'Create a new CRM opportunity/deal',
  notes: '',
  input: z.object({
    name: z.string().describe('Opportunity name'),
    stageId: z
      .string()
      .describe(
        'Stage ID (e.g. "lead", "qualified", "proposal", "negotiation", "won", "lost")',
      ),
    stageLabel: z
      .string()
      .describe(
        'Stage display label (e.g. "Lead", "Qualified", "Proposal", "Negotiation", "Won", "Lost")',
      ),
    crmAccountId: z.string().describe('Account ID to associate with'),
    crmContactIds: z
      .array(z.string())
      .optional()
      .default([])
      .describe('Contact IDs to associate with'),
  }),
  output: z.object({
    id: z.string().describe('Created opportunity ID'),
    crmFields: z
      .array(CrmFieldSchema)
      .optional()
      .describe('Opportunity fields'),
  }),
};
export type CreateOpportunityInput = z.infer<
  typeof createOpportunitySchema.input
>;
export type CreateOpportunityOutput = z.infer<
  typeof createOpportunitySchema.output
>;

export const deleteOpportunitySchema = {
  name: 'deleteOpportunity',
  description: 'Delete a CRM opportunity',
  notes: '',
  input: z.object({
    id: z.string().describe('Opportunity ID to delete'),
    crmAccountId: z.string().describe('Account ID the opportunity belongs to'),
  }),
  output: z.object({
    id: z.string().describe('Deleted opportunity ID'),
  }),
};
export type DeleteOpportunityInput = z.infer<
  typeof deleteOpportunitySchema.input
>;
export type DeleteOpportunityOutput = z.infer<
  typeof deleteOpportunitySchema.output
>;

// ============================================================================
// Task Schemas
// ============================================================================

const CrmTaskSchema = z.object({
  id: z.string().describe('Task ID'),
  title: z.string().describe('Task title'),
  status: z
    .string()
    .describe('Task status: TODO, IN_PROGRESS, COMPLETE, CANCELLED'),
  description: z
    .array(SlateNodeSchema)
    .optional()
    .describe('Rich text description in Slate format'),
  assignedToUserId: z.string().optional().describe('Assigned user ID'),
  crmAccountId: z.string().optional().describe('Associated account ID'),
  createdAt: z.number().describe('Creation timestamp (epoch ms)'),
  updatedAt: z.number().describe('Last update timestamp (epoch ms)'),
});

export const listTasksSchema = {
  name: 'listTasks',
  description: 'List CRM tasks with pagination, sorting, and filtering',
  notes: '',
  input: z.object({
    limit: z.number().optional().default(20).describe('Page size (default 20)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Start index (default 0)'),
    sortBy: z
      .array(SortBySchema)
      .optional()
      .default([{ key: 'createdAt', direction: 'DESC' }])
      .describe('Sort criteria'),
    objectStatus: z
      .enum(['ACTIVE', 'TRASHED'])
      .optional()
      .default('ACTIVE')
      .describe('Filter by status'),
  }),
  output: z.object({
    tasks: z.array(CrmTaskSchema).describe('Task records'),
    pageInfo: PageInfoSchema.describe('Pagination info'),
  }),
};
export type ListTasksInput = z.infer<typeof listTasksSchema.input>;
export type ListTasksOutput = z.infer<typeof listTasksSchema.output>;

export const getTaskSchema = {
  name: 'getTask',
  description: 'Get a single CRM task by ID',
  notes: '',
  input: z.object({
    id: z.string().describe('Task ID'),
  }),
  output: CrmTaskSchema,
};
export type GetTaskInput = z.infer<typeof getTaskSchema.input>;
export type GetTaskOutput = z.infer<typeof getTaskSchema.output>;

export const createTaskSchema = {
  name: 'createTask',
  description: 'Create a new CRM task',
  notes: '',
  input: z.object({
    title: z.string().describe('Task title'),
    description: z
      .string()
      .optional()
      .describe('Task description (plain text, converted to Slate format)'),
    status: z
      .enum(['TODO', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED'])
      .optional()
      .default('TODO')
      .describe('Task status'),
    assignedToUserId: z
      .string()
      .describe('User ID to assign the task to (use getContext().userId)'),
    crmAccountId: z
      .string()
      .optional()
      .describe('Account ID to associate with'),
  }),
  output: z.object({
    id: z.string().describe('Created task ID'),
    title: z.string().describe('Task title'),
    status: z.string().describe('Task status'),
  }),
};
export type CreateTaskInput = z.infer<typeof createTaskSchema.input>;
export type CreateTaskOutput = z.infer<typeof createTaskSchema.output>;

export const updateTaskSchema = {
  name: 'updateTask',
  description: 'Update a CRM task (title, status, description)',
  notes: '',
  input: z.object({
    id: z.string().describe('Task ID to update'),
    title: z.string().optional().describe('New title'),
    status: z
      .enum(['TODO', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED'])
      .optional()
      .describe('New status'),
    description: z
      .string()
      .optional()
      .describe('New description (plain text, converted to Slate format)'),
  }),
  output: z.object({
    id: z.string().describe('Updated task ID'),
    title: z.string().describe('Task title'),
    status: z.string().describe('Task status'),
  }),
};
export type UpdateTaskInput = z.infer<typeof updateTaskSchema.input>;
export type UpdateTaskOutput = z.infer<typeof updateTaskSchema.output>;

export const deleteTaskSchema = {
  name: 'deleteTask',
  description: 'Delete a CRM task',
  notes: '',
  input: z.object({
    id: z.string().describe('Task ID to delete'),
  }),
  output: z.object({
    id: z.string().describe('Deleted task ID'),
  }),
};
export type DeleteTaskInput = z.infer<typeof deleteTaskSchema.input>;
export type DeleteTaskOutput = z.infer<typeof deleteTaskSchema.output>;

// ============================================================================
// Note Schemas
// ============================================================================

const CrmNoteSchema = z.object({
  id: z.string().describe('Note ID'),
  title: z.string().describe('Note title'),
  content: z
    .array(SlateNodeSchema)
    .optional()
    .describe('Rich text content in Slate format'),
  createdAt: z.number().describe('Creation timestamp (epoch ms)'),
  updatedAt: z.number().describe('Last update timestamp (epoch ms)'),
});

export const listNotesSchema = {
  name: 'listNotes',
  description: 'List CRM notes with pagination, sorting, and filtering',
  notes: '',
  input: z.object({
    limit: z.number().optional().default(20).describe('Page size (default 20)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Start index (default 0)'),
    sortBy: z
      .array(SortBySchema)
      .optional()
      .default([{ key: 'createdAt', direction: 'DESC' }])
      .describe('Sort criteria'),
    objectStatus: z
      .enum(['ACTIVE', 'TRASHED'])
      .optional()
      .default('ACTIVE')
      .describe('Filter by status'),
  }),
  output: z.object({
    notes: z.array(CrmNoteSchema).describe('Note records'),
    pageInfo: PageInfoSchema.describe('Pagination info'),
  }),
};
export type ListNotesInput = z.infer<typeof listNotesSchema.input>;
export type ListNotesOutput = z.infer<typeof listNotesSchema.output>;

export const getNoteSchema = {
  name: 'getNote',
  description: 'Get a single CRM note by ID',
  notes: '',
  input: z.object({
    id: z.string().describe('Note ID'),
  }),
  output: CrmNoteSchema,
};
export type GetNoteInput = z.infer<typeof getNoteSchema.input>;
export type GetNoteOutput = z.infer<typeof getNoteSchema.output>;

export const createNoteSchema = {
  name: 'createNote',
  description: 'Create a new CRM note',
  notes: '',
  input: z.object({
    title: z.string().describe('Note title'),
    crmAccountId: z
      .string()
      .optional()
      .describe('Account ID to associate with'),
  }),
  output: z.object({
    id: z.string().describe('Created note ID'),
    title: z.string().describe('Note title'),
    content: z.array(SlateNodeSchema).optional().describe('Note content'),
  }),
};
export type CreateNoteInput = z.infer<typeof createNoteSchema.input>;
export type CreateNoteOutput = z.infer<typeof createNoteSchema.output>;

export const deleteNoteSchema = {
  name: 'deleteNote',
  description: 'Delete a CRM note',
  notes: '',
  input: z.object({
    id: z.string().describe('Note ID to delete'),
  }),
  output: z.object({
    id: z.string().describe('Deleted note ID'),
  }),
};
export type DeleteNoteInput = z.infer<typeof deleteNoteSchema.input>;
export type DeleteNoteOutput = z.infer<typeof deleteNoteSchema.output>;

// ============================================================================
// Meeting Schemas
// ============================================================================

const CrmMeetingSchema = z.object({
  id: z.string().describe('Meeting ID'),
  startDate: z.string().optional().describe('Start date/time'),
  endDate: z.string().optional().describe('End date/time'),
  updatedAt: z.number().describe('Last update timestamp (epoch ms)'),
});

export const listMeetingsSchema = {
  name: 'listMeetings',
  description: 'List CRM meetings with pagination, sorting, and filtering',
  notes: '',
  input: z.object({
    limit: z.number().optional().default(20).describe('Page size (default 20)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Start index (default 0)'),
    sortBy: z
      .array(SortBySchema)
      .optional()
      .default([{ key: 'createdAt', direction: 'DESC' }])
      .describe('Sort criteria'),
    objectStatus: z
      .enum(['ACTIVE', 'TRASHED'])
      .optional()
      .default('ACTIVE')
      .describe('Filter by status'),
  }),
  output: z.object({
    meetings: z.array(CrmMeetingSchema).describe('Meeting records'),
    pageInfo: PageInfoSchema.describe('Pagination info'),
  }),
};
export type ListMeetingsInput = z.infer<typeof listMeetingsSchema.input>;
export type ListMeetingsOutput = z.infer<typeof listMeetingsSchema.output>;

// ============================================================================
// All Schemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  sendChatSchema,
  // Accounts
  listAccountsSchema,
  getAccountSchema,
  createAccountSchema,
  updateAccountSchema,
  deleteAccountSchema,
  // Contacts
  listContactsSchema,
  getContactSchema,
  createContactSchema,
  deleteContactSchema,
  // Opportunities
  listOpportunitiesSchema,
  getOpportunitySchema,
  createOpportunitySchema,
  deleteOpportunitySchema,
  // Tasks
  listTasksSchema,
  getTaskSchema,
  createTaskSchema,
  updateTaskSchema,
  deleteTaskSchema,
  // Notes
  listNotesSchema,
  getNoteSchema,
  createNoteSchema,
  deleteNoteSchema,
  // Meetings
  listMeetingsSchema,
];
