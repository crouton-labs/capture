import { z } from 'zod';

export const libraryDescription =
  'Linear issue tracker — issues, sub-issues, comments, attachments, labels, projects, cycles, users, and team management';

export const libraryIcon = '/icons/libs/linear.png';
export const loginUrl = 'https://linear.app';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://linear.app\`
2. Call \`getContext()\` to get viewer info, teams, and workflow states
3. Use \`teamId\` from getContext when creating issues
4. Use \`stateId\` from getContext to set issue status

## Auth Pattern

Linear is a local-first app. All API calls go through Linear's internal GraphQL client (extracted from React context). No tokens, headers, or CSRF needed; just be logged in at \`linear.app\`.

## Key Concepts

- **Team**: Issues belong to a team. Each team has its own workflow states, labels, cycles, and issue prefix (e.g. "ENG-123").
- **Identifier**: Human-readable issue ID like "ENG-123". Use this or the UUID to reference issues.
- **WorkflowState**: Status of an issue (Backlog, Todo, In Progress, Done, Canceled). Each team has its own set.
- **Priority**: Integer 0-4. 0 = No priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low.
- **Labels**: Tags applied to issues. Can be workspace-level (team=null) or team-level. Use \`listLabels()\` to find label UUIDs.
- **Project**: Cross-team initiative that groups related issues. Projects have a status (backlog, planned, started, paused, completed, canceled). Use \`listProjects()\` to find project UUIDs.
- **Cycle**: Time-boxed sprint within a team. Each team has its own cycles. Use \`listCycles()\` to find cycle UUIDs.
- **User**: Workspace member. Use \`listUsers()\` to find user UUIDs for assignment.
- **Sub-issue**: A child issue created with \`parentId\`. Use \`listSubIssues()\` to fetch children, or \`getIssue()\` which includes \`children\` in the response.
- **Attachment**: A link or external resource associated with an issue. Use \`createUrlAttachment()\` to attach any URL (Figma, Notion, GitHub, etc.).

## Cross-Team Rules

Issues, projects, cycles, and states are scoped to teams. When assigning a project or cycle to an issue, the project/cycle MUST belong to (or include) the issue's team. To move an issue to a different team's project:
1. Update the issue's \`teamId\` to the target team
2. Then set the \`projectId\` and/or \`cycleId\`

Or update \`teamId\`, \`projectId\`, and \`cycleId\` all in one \`updateIssue()\` call — Linear validates consistency of the final state.

## Label Behavior

- \`labelIds\` on create/update **REPLACES** all labels — it is not additive.
- \`addedLabelIds\` on update adds labels without removing existing ones.
- \`removedLabelIds\` on update removes specific labels without affecting others.
- To preserve existing labels when using \`labelIds\`, read them from \`getIssue()\` first.

## Pagination

Cursor-based using \`first\` (page size, max 50) and \`after\` (cursor from previous response's \`pageInfo.endCursor\`). Check \`pageInfo.hasNextPage\` to know if more results exist.

## Finding Things

- **Users** → \`listUsers()\` — get all workspace members with IDs
- **Labels** → \`listLabels()\` — workspace + team labels, filter by team
- **Projects** → \`listProjects()\` — all projects, filter by status
- **Cycles/Sprints** → \`listCycles({ teamId })\` — team's cycles with active flag
- **Issues** → \`listIssues()\` or \`searchIssues()\`
- **Sub-issues** → \`listSubIssues({ issueId })\` or \`getIssue()\` (includes \`children\` field)
- **Comments** → \`listComments({ issueId })\`
- **Attachments** → \`listAttachments({ issueId })\`
`;

// ============================================================================
// Shared Parameter Schemas
// ============================================================================

export const TeamIdParam = z
  .string()
  .describe('Team UUID (e.g. "a1b2c3d4-e5f6-7890-abcd-ef1234567890")');

export const IssueIdParam = z
  .string()
  .describe(
    'Issue UUID or human-readable identifier (e.g. "ENG-123" or UUID). Both work for get/update/delete.',
  );

export const StateIdParam = z
  .string()
  .describe('Workflow state UUID from getContext().teams[].states[]');

export const UserIdParam = z
  .string()
  .describe('User UUID from listUsers() or getContext().viewer.id');

export const LabelIdParam = z
  .string()
  .describe('Issue label UUID from listLabels()');

// ============================================================================
// Shared Entity Schemas
// ============================================================================

export const UserSchema = z.object({
  id: UserIdParam,
  name: z.string().describe('User display name'),
  email: z.string().describe('User email'),
  displayName: z.string().describe('User display name (preferred)'),
});

export const UserDetailSchema = UserSchema.extend({
  active: z.boolean().describe('Whether the user account is active'),
  admin: z.boolean().describe('Whether the user is a workspace admin'),
  guest: z.boolean().describe('Whether the user is a guest'),
  avatarUrl: z.string().nullable().describe('User avatar URL or null'),
});

export const WorkflowStateSchema = z.object({
  id: StateIdParam,
  name: z.string().describe('State display name (e.g. "In Progress")'),
  type: z
    .string()
    .describe(
      'State category: "backlog", "unstarted", "started", "completed", or "canceled"',
    ),
  color: z.string().describe('Hex color code'),
  position: z.number().describe('Sort order within the team'),
});

export const TeamSchema = z.object({
  id: TeamIdParam,
  name: z.string().describe('Team display name'),
  key: z.string().describe('Team prefix for issue identifiers (e.g. "ENG")'),
  states: z
    .array(WorkflowStateSchema)
    .describe('Workflow states available for this team'),
});

export const LabelSchema = z.object({
  id: LabelIdParam,
  name: z.string().describe('Label name'),
  color: z.string().describe('Hex color code'),
});

export const LabelDetailSchema = LabelSchema.extend({
  description: z.string().nullable().describe('Label description or null'),
  isGroup: z
    .boolean()
    .describe('Whether this is a group label (parent of other labels)'),
  parent: z
    .object({ id: z.string(), name: z.string() })
    .nullable()
    .describe('Parent group label or null'),
  team: z
    .object({ id: z.string(), name: z.string() })
    .nullable()
    .describe('Team this label belongs to, or null for workspace-level labels'),
});

export const ProjectSchema = z.object({
  id: z.string().describe('Project UUID'),
  name: z.string().describe('Project name'),
  description: z.string().describe('Project description'),
  status: z
    .object({
      type: z
        .string()
        .describe(
          'Status type: "backlog", "planned", "started", "paused", "completed", or "canceled"',
        ),
    })
    .describe('Project status'),
  icon: z.string().nullable().describe('Project icon emoji or null'),
  color: z.string().describe('Project color as HEX string'),
  progress: z.number().describe('Completion progress (0-1)'),
  lead: z
    .object({ id: z.string(), name: z.string() })
    .nullable()
    .describe('Project lead or null'),
  startDate: z.string().nullable().describe('Start date (YYYY-MM-DD) or null'),
  targetDate: z
    .string()
    .nullable()
    .describe('Target date (YYYY-MM-DD) or null'),
  url: z.string().describe('Web URL for the project'),
  teams: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .describe('Teams associated with this project'),
});

export const CycleSchema = z.object({
  id: z.string().describe('Cycle UUID'),
  name: z.string().nullable().describe('Cycle name or null'),
  number: z.number().describe('Cycle number within the team'),
  startsAt: z.string().describe('Start date (ISO 8601)'),
  endsAt: z.string().describe('End date (ISO 8601)'),
  completedAt: z
    .string()
    .nullable()
    .describe('Completion date or null if not completed'),
  isActive: z.boolean().describe('Whether this is the currently active cycle'),
  isFuture: z.boolean().describe('Whether this cycle is in the future'),
  isPast: z.boolean().describe('Whether this cycle is in the past'),
  progress: z.number().describe('Completion progress (0-1)'),
  team: z.object({ id: z.string(), name: z.string() }).describe('Parent team'),
});

export const CycleSummarySchema = z.object({
  id: z.string().describe('Cycle UUID'),
  name: z.string().nullable().describe('Cycle name or null'),
  number: z.number().describe('Cycle number within the team'),
  startsAt: z.string().describe('Start date (ISO 8601)'),
  endsAt: z.string().describe('End date (ISO 8601)'),
});

export const IssueSummarySchema = z.object({
  id: z.string().describe('Issue UUID'),
  identifier: z.string().describe('Human-readable ID (e.g. "ENG-123")'),
  title: z.string().describe('Issue title'),
  priority: z
    .number()
    .describe('Priority: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low'),
  state: z
    .object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
    })
    .describe('Current workflow state'),
  assignee: z
    .object({ id: z.string(), name: z.string() })
    .nullable()
    .describe('Assigned user or null'),
  labels: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .describe('Applied labels'),
  dueDate: z.string().nullable().describe('Due date as YYYY-MM-DD or null'),
  createdAt: z.string().describe('Creation timestamp (ISO 8601)'),
  updatedAt: z.string().describe('Last update timestamp (ISO 8601)'),
  url: z.string().describe('Web URL for the issue'),
});

export const IssueDetailSchema = IssueSummarySchema.extend({
  description: z.string().nullable().describe('Issue description (Markdown)'),
  team: z
    .object({ id: z.string(), name: z.string(), key: z.string() })
    .describe('Parent team'),
  creator: z
    .object({ id: z.string(), name: z.string() })
    .describe('User who created the issue'),
  project: z
    .object({ id: z.string(), name: z.string() })
    .nullable()
    .describe('Parent project or null'),
  cycle: CycleSummarySchema.nullable().describe('Current cycle/sprint or null'),
  estimate: z.number().nullable().describe('Point estimate or null'),
  completedAt: z.string().nullable().describe('Completion timestamp or null'),
  canceledAt: z.string().nullable().describe('Cancellation timestamp or null'),
  archivedAt: z.string().nullable().describe('Archive timestamp or null'),
  children: z
    .array(
      z.object({
        id: z.string(),
        identifier: z.string(),
        title: z.string(),
        state: z.object({ id: z.string(), name: z.string(), type: z.string() }),
      }),
    )
    .describe('Direct sub-issues of this issue'),
});

export const CommentSchema = z.object({
  id: z.string().describe('Comment UUID'),
  body: z.string().describe('Comment text (Markdown)'),
  createdAt: z.string().describe('Creation timestamp (ISO 8601)'),
  updatedAt: z.string().describe('Last update timestamp (ISO 8601)'),
  user: z
    .object({ id: z.string(), name: z.string() })
    .describe('Comment author'),
});

export const AttachmentSchema = z.object({
  id: z.string().describe('Attachment UUID'),
  title: z.string().describe('Attachment title'),
  url: z.string().describe('External URL this attachment links to'),
  subtitle: z.string().nullable().describe('Subtitle or description or null'),
  metadata: z
    .record(z.string(), z.unknown())
    .describe('Arbitrary metadata object'),
  createdAt: z.string().describe('Creation timestamp (ISO 8601)'),
  creator: z
    .object({ id: z.string(), name: z.string() })
    .nullable()
    .describe('User who created the attachment or null'),
});

// ============================================================================
// Pagination
// ============================================================================

const PageInfoSchema = z.object({
  hasNextPage: z.boolean().describe('Whether more results exist'),
  endCursor: z
    .string()
    .nullable()
    .describe('Cursor to pass as "after" for next page'),
});

// ============================================================================
// Function Schemas
// ============================================================================

// --- getContext ---

export const getContextSchema = {
  name: 'getContext',
  description:
    'Get Linear authentication context including the current user, all teams with their workflow states. Must be called first to obtain teamId and stateId values.',
  notes: '',
  input: z.object({}),
  output: z.object({
    viewer: UserSchema.describe('Current authenticated user'),
    teams: z.array(TeamSchema).describe('All teams with workflow states'),
  }),
};

export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// --- listTeams ---

export const listTeamsSchema = {
  name: 'listTeams',
  description:
    'List all teams in the workspace with their workflow states. Use getContext() instead if you also need viewer info.',
  notes: '',
  input: z.object({}),
  output: z.object({
    teams: z.array(TeamSchema).describe('All teams'),
  }),
};

export type ListTeamsInput = z.infer<typeof listTeamsSchema.input>;
export type ListTeamsOutput = z.infer<typeof listTeamsSchema.output>;

// --- listUsers ---

export const listUsersSchema = {
  name: 'listUsers',
  description:
    'List all workspace members with their IDs, emails, and roles. Use to find user UUIDs for assigning issues.',
  notes: '',
  input: z.object({
    includeDisabled: z
      .boolean()
      .optional()
      .describe('Include disabled/suspended users (default false)'),
  }),
  output: z.object({
    users: z.array(UserDetailSchema).describe('All workspace members'),
  }),
};

export type ListUsersInput = z.infer<typeof listUsersSchema.input>;
export type ListUsersOutput = z.infer<typeof listUsersSchema.output>;

// --- listLabels ---

export const listLabelsSchema = {
  name: 'listLabels',
  description:
    'List all issue labels in the workspace. Returns both workspace-level labels (team=null) and team-level labels. Use to find label UUIDs before creating or updating issues.',
  notes:
    'Workspace-level labels (team=null) can be applied to issues in any team. Team-level labels can only be applied to issues in that team.',
  input: z.object({
    teamId: TeamIdParam.optional().describe(
      'Filter to only labels belonging to this team. Omit to get all labels (workspace + all teams).',
    ),
    first: z.number().optional().describe('Page size (max 100, default 100)'),
    after: z.string().optional().describe('Cursor for next page'),
  }),
  output: z.object({
    labels: z.array(LabelDetailSchema).describe('Issue labels'),
    pageInfo: PageInfoSchema,
  }),
};

export type ListLabelsInput = z.infer<typeof listLabelsSchema.input>;
export type ListLabelsOutput = z.infer<typeof listLabelsSchema.output>;

// --- listProjects ---

export const listProjectsSchema = {
  name: 'listProjects',
  description:
    'List all projects in the workspace with their status, progress, and associated teams. Use to find project UUIDs before assigning issues to projects.',
  notes:
    "A project can span multiple teams. When assigning an issue to a project, the issue's team must be one of the project's associated teams.",
  input: z.object({
    status: z
      .enum([
        'backlog',
        'planned',
        'started',
        'paused',
        'completed',
        'canceled',
      ])
      .optional()
      .describe('Filter by project status type'),
    first: z.number().optional().describe('Page size (max 50, default 50)'),
    after: z.string().optional().describe('Cursor for next page'),
  }),
  output: z.object({
    projects: z.array(ProjectSchema).describe('Projects'),
    pageInfo: PageInfoSchema,
  }),
};

export type ListProjectsInput = z.infer<typeof listProjectsSchema.input>;
export type ListProjectsOutput = z.infer<typeof listProjectsSchema.output>;

// --- listCycles ---

export const listCyclesSchema = {
  name: 'listCycles',
  description:
    'List all cycles (sprints) for a team, including which one is currently active. Use to find cycle UUIDs before assigning issues to a sprint.',
  notes:
    'Cycles belong to a single team. When assigning a cycle to an issue, the issue must be in the same team as the cycle.',
  input: z.object({
    teamId: TeamIdParam.describe('Team UUID — cycles are team-scoped'),
    first: z.number().optional().describe('Page size (max 50, default 50)'),
    after: z.string().optional().describe('Cursor for next page'),
  }),
  output: z.object({
    cycles: z.array(CycleSchema).describe('All cycles for this team'),
    pageInfo: PageInfoSchema,
  }),
};

export type ListCyclesInput = z.infer<typeof listCyclesSchema.input>;
export type ListCyclesOutput = z.infer<typeof listCyclesSchema.output>;

// --- listIssues ---

export const listIssuesSchema = {
  name: 'listIssues',
  description:
    'List issues with optional filters. Returns newest first by default.',
  notes: '',
  input: z.object({
    teamId: TeamIdParam.optional().describe('Filter by team UUID'),
    assigneeId: UserIdParam.optional().describe(
      'Filter by assignee UUID. Use getContext().viewer.id for "my issues".',
    ),
    stateType: z
      .enum(['backlog', 'unstarted', 'started', 'completed', 'canceled'])
      .optional()
      .describe('Filter by state category'),
    projectId: z.string().optional().describe('Filter by project UUID'),
    cycleId: z.string().optional().describe('Filter by cycle UUID'),
    labelId: z
      .string()
      .optional()
      .describe('Filter by label UUID (issues with this label)'),
    first: z.number().optional().describe('Page size (max 50, default 25)'),
    after: z
      .string()
      .optional()
      .describe(
        'Cursor for next page (from previous response pageInfo.endCursor)',
      ),
  }),
  output: z.object({
    issues: z.array(IssueSummarySchema).describe('Issues matching filters'),
    pageInfo: PageInfoSchema,
  }),
};

export type ListIssuesInput = z.infer<typeof listIssuesSchema.input>;
export type ListIssuesOutput = z.infer<typeof listIssuesSchema.output>;

// --- getIssue ---

export const getIssueSchema = {
  name: 'getIssue',
  description:
    'Get detailed information about a single issue by UUID or identifier (e.g. "ENG-123"). Includes sub-issues in the children field.',
  notes: '',
  input: z.object({
    issueId: IssueIdParam,
  }),
  output: z.object({
    issue: IssueDetailSchema.describe(
      'Full issue details including sub-issues',
    ),
  }),
};

export type GetIssueInput = z.infer<typeof getIssueSchema.input>;
export type GetIssueOutput = z.infer<typeof getIssueSchema.output>;

// --- createIssue ---

export const createIssueSchema = {
  name: 'createIssue',
  description:
    'Create a new issue in a team. Requires teamId from getContext().teams[].',
  notes:
    "Call getContext() first to obtain teamId and stateId values. Use listLabels() to find label UUIDs. Use listProjects()/listCycles() to find project/cycle UUIDs. The project and cycle must belong to (or include) the issue's team.",
  input: z.object({
    teamId: TeamIdParam,
    title: z.string().describe('Issue title'),
    description: z.string().optional().describe('Issue description (Markdown)'),
    stateId: StateIdParam.optional().describe(
      'Initial workflow state. Defaults to team default (usually Backlog or Triage).',
    ),
    assigneeId: UserIdParam.optional().describe(
      'User UUID to assign. Use listUsers() to find.',
    ),
    priority: z
      .number()
      .optional()
      .describe('Priority: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low'),
    labelIds: z
      .array(z.string())
      .optional()
      .describe('Array of label UUIDs to apply. Use listLabels() to find.'),
    projectId: z
      .string()
      .optional()
      .describe('Project UUID. Use listProjects() to find.'),
    cycleId: z
      .string()
      .optional()
      .describe('Cycle/sprint UUID. Use listCycles() to find.'),
    dueDate: z
      .string()
      .optional()
      .describe('Due date as YYYY-MM-DD (e.g. "2026-04-01")'),
    estimate: z.number().optional().describe('Point estimate'),
    parentId: z
      .string()
      .optional()
      .describe('Parent issue UUID (creates sub-issue)'),
  }),
  output: z.object({
    issue: IssueDetailSchema.describe('The newly created issue'),
  }),
};

export type CreateIssueInput = z.infer<typeof createIssueSchema.input>;
export type CreateIssueOutput = z.infer<typeof createIssueSchema.output>;

// --- updateIssue ---

export const updateIssueSchema = {
  name: 'updateIssue',
  description:
    'Update an existing issue. Only provided fields are changed. Can move issues between teams.',
  notes:
    'labelIds REPLACES all labels. Use addedLabelIds/removedLabelIds to modify labels incrementally without replacing. To move an issue to a different team, set teamId — you can set projectId/cycleId in the same call if they belong to the new team.',
  input: z.object({
    issueId: IssueIdParam,
    title: z.string().optional().describe('New title'),
    description: z.string().optional().describe('New description (Markdown)'),
    stateId: StateIdParam.optional().describe('New workflow state UUID'),
    assigneeId: UserIdParam.optional().describe(
      'New assignee UUID. Pass null to unassign.',
    ),
    priority: z.number().optional().describe('New priority (0-4)'),
    labelIds: z
      .array(z.string())
      .optional()
      .describe('Replace ALL labels with these UUIDs'),
    addedLabelIds: z
      .array(z.string())
      .optional()
      .describe('Label UUIDs to ADD without removing existing labels'),
    removedLabelIds: z
      .array(z.string())
      .optional()
      .describe('Label UUIDs to REMOVE without affecting other labels'),
    projectId: z
      .string()
      .nullable()
      .optional()
      .describe('Move to project UUID, or null to remove from project'),
    cycleId: z
      .string()
      .nullable()
      .optional()
      .describe('Move to cycle/sprint UUID, or null to remove from cycle'),
    teamId: TeamIdParam.optional().describe(
      'Move issue to a different team. The issue identifier will change (e.g. SAL-6 → DEV-42).',
    ),
    dueDate: z
      .string()
      .nullable()
      .optional()
      .describe('New due date (YYYY-MM-DD) or null to clear'),
    estimate: z
      .number()
      .nullable()
      .optional()
      .describe('New point estimate or null to clear'),
  }),
  output: z.object({
    issue: IssueDetailSchema.describe('The updated issue'),
  }),
};

export type UpdateIssueInput = z.infer<typeof updateIssueSchema.input>;
export type UpdateIssueOutput = z.infer<typeof updateIssueSchema.output>;

// --- deleteIssue ---

export const deleteIssueSchema = {
  name: 'deleteIssue',
  description:
    'Permanently delete an issue. This is irreversible; prefer updating state to "Canceled" instead.',
  notes: '',
  input: z.object({
    issueId: IssueIdParam,
  }),
  output: z.object({
    success: z.boolean().describe('True if deleted successfully'),
  }),
};

export type DeleteIssueInput = z.infer<typeof deleteIssueSchema.input>;
export type DeleteIssueOutput = z.infer<typeof deleteIssueSchema.output>;

// --- searchIssues ---

export const searchIssuesSchema = {
  name: 'searchIssues',
  description: 'Search issues by text query across title and description.',
  notes: '',
  input: z.object({
    query: z.string().describe('Search text'),
    first: z.number().optional().describe('Max results (default 25, max 50)'),
  }),
  output: z.object({
    issues: z.array(IssueSummarySchema).describe('Matching issues'),
  }),
};

export type SearchIssuesInput = z.infer<typeof searchIssuesSchema.input>;
export type SearchIssuesOutput = z.infer<typeof searchIssuesSchema.output>;

// --- addComment ---

export const addCommentSchema = {
  name: 'addComment',
  description: 'Add a comment to an issue.',
  notes: '',
  input: z.object({
    issueId: IssueIdParam,
    body: z.string().describe('Comment text (Markdown)'),
  }),
  output: z.object({
    comment: CommentSchema,
  }),
};

export type AddCommentInput = z.infer<typeof addCommentSchema.input>;
export type AddCommentOutput = z.infer<typeof addCommentSchema.output>;

// --- listSubIssues ---

export const listSubIssuesSchema = {
  name: 'listSubIssues',
  description:
    'List the direct child (sub) issues of a parent issue. Use getIssue() if you only need a quick summary of children alongside other issue details.',
  notes: '',
  input: z.object({
    issueId: IssueIdParam.describe('Parent issue UUID or identifier'),
    first: z.number().optional().describe('Page size (max 50, default 50)'),
    after: z.string().optional().describe('Cursor for next page'),
  }),
  output: z.object({
    issues: z.array(IssueSummarySchema).describe('Child issues'),
    pageInfo: PageInfoSchema,
  }),
};

export type ListSubIssuesInput = z.infer<typeof listSubIssuesSchema.input>;
export type ListSubIssuesOutput = z.infer<typeof listSubIssuesSchema.output>;

// --- listComments ---

export const listCommentsSchema = {
  name: 'listComments',
  description: 'List all comments on an issue in chronological order.',
  notes: '',
  input: z.object({
    issueId: IssueIdParam,
    first: z.number().optional().describe('Page size (max 50, default 50)'),
    after: z.string().optional().describe('Cursor for next page'),
  }),
  output: z.object({
    comments: z.array(CommentSchema).describe('Comments on the issue'),
    pageInfo: PageInfoSchema,
  }),
};

export type ListCommentsInput = z.infer<typeof listCommentsSchema.input>;
export type ListCommentsOutput = z.infer<typeof listCommentsSchema.output>;

// --- updateComment ---

export const updateCommentSchema = {
  name: 'updateComment',
  description: 'Edit the body of an existing comment.',
  notes: '',
  input: z.object({
    commentId: z
      .string()
      .describe('Comment UUID from listComments() or addComment()'),
    body: z
      .string()
      .describe('New comment text (Markdown). Replaces existing content.'),
  }),
  output: z.object({
    comment: CommentSchema.describe('The updated comment'),
  }),
};

export type UpdateCommentInput = z.infer<typeof updateCommentSchema.input>;
export type UpdateCommentOutput = z.infer<typeof updateCommentSchema.output>;

// --- deleteComment ---

export const deleteCommentSchema = {
  name: 'deleteComment',
  description: 'Permanently delete a comment from an issue.',
  notes: '',
  input: z.object({
    commentId: z
      .string()
      .describe('Comment UUID from listComments() or addComment()'),
  }),
  output: z.object({
    success: z.boolean().describe('True if deleted successfully'),
  }),
};

export type DeleteCommentInput = z.infer<typeof deleteCommentSchema.input>;
export type DeleteCommentOutput = z.infer<typeof deleteCommentSchema.output>;

// --- listAttachments ---

export const listAttachmentsSchema = {
  name: 'listAttachments',
  description: 'List all attachments on an issue.',
  notes: '',
  input: z.object({
    issueId: IssueIdParam,
  }),
  output: z.object({
    attachments: z.array(AttachmentSchema).describe('Attachments on the issue'),
  }),
};

export type ListAttachmentsInput = z.infer<typeof listAttachmentsSchema.input>;
export type ListAttachmentsOutput = z.infer<
  typeof listAttachmentsSchema.output
>;

// --- createUrlAttachment ---

export const createUrlAttachmentSchema = {
  name: 'createUrlAttachment',
  description:
    'Attach an external URL to an issue (e.g. Figma design, Notion doc, GitHub PR, Google Doc). The URL is stored as a clickable attachment in the issue sidebar.',
  notes: '',
  input: z.object({
    issueId: IssueIdParam,
    title: z.string().describe('Display title for the attachment'),
    url: z.string().describe('External URL to link'),
    subtitle: z
      .string()
      .optional()
      .describe('Optional subtitle or description shown below the title'),
  }),
  output: z.object({
    attachment: AttachmentSchema.describe('The created attachment'),
  }),
};

export type CreateUrlAttachmentInput = z.infer<
  typeof createUrlAttachmentSchema.input
>;
export type CreateUrlAttachmentOutput = z.infer<
  typeof createUrlAttachmentSchema.output
>;

// --- deleteAttachment ---

export const deleteAttachmentSchema = {
  name: 'deleteAttachment',
  description: 'Delete an attachment from an issue.',
  notes: '',
  input: z.object({
    attachmentId: z
      .string()
      .describe(
        'Attachment UUID from listAttachments() or createUrlAttachment()',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('True if deleted successfully'),
  }),
};

export type DeleteAttachmentInput = z.infer<
  typeof deleteAttachmentSchema.input
>;
export type DeleteAttachmentOutput = z.infer<
  typeof deleteAttachmentSchema.output
>;

// ============================================================================
// All Schemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  listTeamsSchema,
  listUsersSchema,
  listLabelsSchema,
  listProjectsSchema,
  listCyclesSchema,
  listIssuesSchema,
  getIssueSchema,
  createIssueSchema,
  updateIssueSchema,
  deleteIssueSchema,
  searchIssuesSchema,
  addCommentSchema,
  listSubIssuesSchema,
  listCommentsSchema,
  updateCommentSchema,
  deleteCommentSchema,
  listAttachmentsSchema,
  createUrlAttachmentSchema,
  deleteAttachmentSchema,
];
