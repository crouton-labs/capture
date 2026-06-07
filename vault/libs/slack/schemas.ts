import { z } from 'zod';

export const libraryDescription = 'Slack operations via Web API';

export const libraryIcon = '/icons/libs/slack.png';
export const loginUrl = 'https://slack.com/signin';

export const libraryNotes = `
## Workflow

1. Create an executor targeting the Slack desktop app first: \`createExecutor({ url: "https://app.slack.com", app: "slack" })\`. If the desktop app is unavailable, fall back to \`createExecutor({ url: "https://app.slack.com" })\`.
2. Call \`getWorkspaces()\` to list available workspaces and get their URLs
3. Navigate to the desired workspace URL (e.g., \`https://app.slack.com/client/T01234567\`)
4. Call \`getContext()\` to get \`{ token, teamId, userId, teamName }\`
5. Call Slack functions with the context

## API Patterns

- **Base URL**: \`/api/{method}\` (relative path from Slack page)
- **Auth**: Token passed in request body
- **Pagination**: cursor-based with \`cursor\` and \`limit\` params. ALWAYS loop until \`response_metadata.next_cursor\` is empty; the API may return far fewer results than \`limit\` requests (sometimes 1 per page)

## Destructive Operations

**CRITICAL for AI agents**: Always confirm before send/delete/archive operations.
Show what will happen, get explicit user approval.
`;

export const crmTrackable: Record<string, { argFields?: readonly string[]; resultFields?: readonly string[] }> = {
  chatPostMessage: {
    argFields: ['channel', 'text'],
    resultFields: ['ok', 'channel', 'ts'],
  },
};

export const borgableFunctions: Record<string, { access: 'read' | 'write'; nonPassableArgs: readonly string[] }> = {
  resolveDmCounterpart: { access: 'read', nonPassableArgs: ['token'] },
};

// ============================================================================
// Rate Limits
// ============================================================================

export const rateLimits: Record<
  string,
  Array<{
    window: 'SECOND' | 'MINUTE' | 'HOUR' | 'DAY';
    maxCalls: number;
    message: string;
  }>
> = {
  chatPostMessage: [
    {
      window: 'SECOND',
      maxCalls: 1,
      message: 'Slack tier-1+ caps ~1 msg/sec per channel',
    },
    {
      window: 'MINUTE',
      maxCalls: 20,
      message: 'Bursty senders get throttled by Slack',
    },
    {
      window: 'HOUR',
      maxCalls: 600,
      message: 'Hourly safety cap to avoid workspace flags',
    },
  ],
  conversationsInvite: [
    {
      window: 'HOUR',
      maxCalls: 10,
      message: 'Invite floods trigger Slack anti-abuse',
    },
  ],
  conversationsInviteShared: [
    {
      window: 'HOUR',
      maxCalls: 10,
      message: 'Shared-channel invite floods flag the workspace',
    },
  ],
};

// ============================================================================
// Shared Parameter Schemas
// ============================================================================

export const TokenParam = z
  .string()
  .describe('Slack API token from getContext');

export const TeamIdParam = z
  .string()
  .describe('Workspace/team ID (e.g., T01234567)');

export const ChannelIdParam = z
  .string()
  .regex(/^[CGDW][A-Z0-9]+$/)
  .describe('Channel ID (C=public, G=private, D=DM, W=MPDM)');

export const UserIdParam = z
  .string()
  .regex(/^[UW][A-Z0-9]+$/)
  .describe('User ID (e.g., U01234567)');

export const TimestampParam = z
  .string()
  .regex(/^\d+\.\d+$/)
  .describe('Message timestamp (e.g., "1234567890.123456")');

export const CursorParam = z
  .string()
  .optional()
  .describe('Pagination cursor for next page');

export const LimitParam = z
  .number()
  .int()
  .min(1)
  .max(1000)
  .optional()
  .describe('Number of items to return (default varies by endpoint)');

// ============================================================================
// Shared Output Schemas
// ============================================================================

export const UserSchema = z.object({
  id: UserIdParam,
  name: z.string().describe('Username (without @)'),
  real_name: z.string().describe('Display name'),
  profile: z.object({
    email: z.string().optional().describe('Email address'),
    display_name: z.string().describe('Display name'),
    image_72: z.string().optional().describe('Avatar URL'),
  }),
  is_bot: z.boolean().optional(),
  deleted: z.boolean().optional(),
});

export const ChannelSchema = z.object({
  id: ChannelIdParam,
  name: z.string().describe('Channel name (without #)'),
  is_channel: z.boolean().optional(),
  is_private: z.boolean().optional(),
  is_member: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  topic: z.object({ value: z.string() }).optional(),
  purpose: z.object({ value: z.string() }).optional(),
  num_members: z.number().optional(),
});

export const MessageSchema = z.object({
  type: z.string(),
  user: UserIdParam.optional(),
  text: z.string(),
  ts: TimestampParam,
  thread_ts: TimestampParam.optional(),
  reply_count: z.number().optional(),
  reactions: z
    .array(
      z.object({
        name: z.string(),
        count: z.number(),
        users: z.array(UserIdParam),
      }),
    )
    .optional(),
  files: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
});

export const FileSchema = z.object({
  id: z.string().describe('File ID'),
  name: z.string().describe('Filename'),
  title: z.string().optional(),
  mimetype: z.string(),
  size: z.number().describe('File size in bytes'),
  url_private: z.string().optional().describe('Private download URL'),
  url_private_download: z.string().optional(),
  permalink: z.string().optional(),
  user: UserIdParam.optional(),
  created: z.number().optional(),
});

// ============================================================================
// Context Schema
// ============================================================================

export const SlackContextSchema = z.object({
  token: z.string().describe('Slack API token for requests'),
  teamId: TeamIdParam,
  userId: UserIdParam,
  teamName: z.string().describe('Workspace name'),
});

// ============================================================================
// Action Schemas - Auth
// ============================================================================

export const getWorkspacesSchema = {
  name: 'getWorkspaces',
  description: 'List available Slack workspaces the user is logged into',
  notes:
    'Works from ANY Slack page including the workspace picker. ' +
    'Call this first to get workspace URLs, then navigate to the desired workspace before calling getContext.',
  input: z.object({}),
  output: z.array(
    z.object({
      teamId: TeamIdParam,
      teamName: z.string().describe('Workspace name'),
      domain: z.string().describe('Workspace domain (e.g., "mycompany")'),
      url: z.string().describe('URL to navigate to for this workspace'),
      userId: UserIdParam.describe('Your user ID in this workspace'),
    }),
  ),
};
export type GetWorkspacesInput = z.infer<typeof getWorkspacesSchema.input>;
export type GetWorkspacesOutput = z.infer<typeof getWorkspacesSchema.output>;

export const getContextSchema = {
  name: 'getContext',
  description: 'Extract Slack authentication context from current session',
  notes:
    'Must be on a workspace page (/client/TEAM_ID). ' +
    'If on workspace picker, call getWorkspaces() first and navigate to the returned URL.',
  input: z.object({
    timeoutMs: z
      .number()
      .optional()
      .default(10000)
      .describe('Max wait time in milliseconds (default: 10000)'),
  }),
  output: SlackContextSchema,
};
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

export const authTestSchema = {
  name: 'authTest',
  description: 'Test authentication and get identity info',
  notes: '',
  input: z.object({
    token: TokenParam,
  }),
  output: z.object({
    ok: z.boolean(),
    url: z.string().describe('Workspace URL'),
    team: z.string().describe('Team name'),
    user: z.string().describe('Username'),
    team_id: TeamIdParam,
    user_id: UserIdParam,
  }),
};
export type AuthTestInput = z.infer<typeof authTestSchema.input>;
export type AuthTestOutput = z.infer<typeof authTestSchema.output>;

// ============================================================================
// Action Schemas - Chat
// ============================================================================

// TODO: Agent will fill in exact schemas from docs

export const chatPostMessageSchema = {
  name: 'chatPostMessage',
  description: 'Send a message to a channel',
  notes:
    '**DESTRUCTIVE**: Always confirm with user before sending. ' +
    'Supports text, blocks, and attachments. At least one of text, blocks, or attachments required. ' +
    '**Output format**: If presenting a draft to the user before sending, you MUST use the "message-draft" skill (useSkill("message-draft")) to render it as an editable UI card for approval. Use the "sales-copy" skill for composing effective messages. **CRM**: After sending, this message and its channel thread are logged to the CRM automatically — you do not need to record them. For 1:1 DM channels, the counterpart is captured as a contact automatically.',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    text: z
      .string()
      .optional()
      .describe('Message text (fallback for notifications if blocks used)'),
    blocks: z
      .array(z.unknown())
      .optional()
      .describe('Block Kit structured blocks'),
    attachments: z
      .array(z.unknown())
      .optional()
      .describe('Legacy structured attachments'),
    thread_ts: TimestampParam.optional().describe(
      'Parent message ts for threaded reply',
    ),
    reply_broadcast: z
      .boolean()
      .optional()
      .describe('Broadcast threaded reply to channel'),
    username: z.string().optional().describe('Override bot username'),
    icon_url: z.string().optional().describe('Override bot icon URL'),
    icon_emoji: z
      .string()
      .optional()
      .describe('Override bot icon emoji (e.g., :robot:)'),
    mrkdwn: z
      .boolean()
      .optional()
      .default(true)
      .describe('Enable Slack markup parsing'),
    parse: z.enum(['none', 'full']).optional().describe('Message parsing mode'),
    link_names: z.boolean().optional().describe('Find and link user groups'),
    unfurl_links: z
      .boolean()
      .optional()
      .describe('Enable unfurling of text-based content'),
    unfurl_media: z
      .boolean()
      .optional()
      .default(true)
      .describe('Enable unfurling of media content'),
    metadata: z.string().optional().describe('JSON-encoded event metadata'),
  }),
  output: z.object({
    ok: z.boolean(),
    channel: ChannelIdParam,
    ts: TimestampParam,
    message: MessageSchema,
  }),
};
export type ChatPostMessageInput = z.infer<typeof chatPostMessageSchema.input>;
export type ChatPostMessageOutput = z.infer<
  typeof chatPostMessageSchema.output
>;

export const chatUpdateSchema = {
  name: 'chatUpdate',
  description: 'Update an existing message',
  notes: '**DESTRUCTIVE**: Always confirm with user before updating.',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    ts: TimestampParam,
    text: z.string().describe('New message text'),
  }),
  output: z.object({
    ok: z.boolean(),
    channel: ChannelIdParam,
    ts: TimestampParam,
    text: z.string(),
  }),
};
export type ChatUpdateInput = z.infer<typeof chatUpdateSchema.input>;
export type ChatUpdateOutput = z.infer<typeof chatUpdateSchema.output>;

export const chatDeleteSchema = {
  name: 'chatDelete',
  description: 'Delete a message',
  notes: '**DESTRUCTIVE**: Always confirm with user before deleting.',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    ts: TimestampParam,
  }),
  output: z.object({
    ok: z.boolean(),
    channel: ChannelIdParam,
    ts: TimestampParam,
  }),
};
export type ChatDeleteInput = z.infer<typeof chatDeleteSchema.input>;
export type ChatDeleteOutput = z.infer<typeof chatDeleteSchema.output>;

export const chatGetPermalinkSchema = {
  name: 'chatGetPermalink',
  description: 'Get permalink URL for a message',
  notes: '',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    message_ts: TimestampParam,
  }),
  output: z.object({
    ok: z.boolean(),
    channel: ChannelIdParam,
    permalink: z.string().describe('Permalink URL'),
  }),
};
export type ChatGetPermalinkInput = z.infer<
  typeof chatGetPermalinkSchema.input
>;
export type ChatGetPermalinkOutput = z.infer<
  typeof chatGetPermalinkSchema.output
>;

// ============================================================================
// Action Schemas - Conversations
// ============================================================================

export const conversationsListSchema = {
  name: 'conversationsList',
  description:
    'List all channels. To find a channel by name, use searchChannels instead',
  notes:
    'Defaults to public_channel only. To include private channels, pass types: "public_channel,private_channel". IMPORTANT: Always paginate using next_cursor; the API may return as few as 1 result per page regardless of limit, especially when private_channel is included. Prefer searchChannels when looking for a specific channel.',
  input: z.object({
    token: TokenParam,
    types: z
      .string()
      .optional()
      .describe(
        'Comma-separated channel types to include. Defaults to public_channel only. Use "public_channel,private_channel" to include private channels.',
      ),
    cursor: CursorParam,
    limit: LimitParam.default(100),
    exclude_archived: z.boolean().optional().default(true),
  }),
  output: z.object({
    ok: z.boolean(),
    channels: z.array(ChannelSchema),
    response_metadata: z
      .object({ next_cursor: z.string().optional() })
      .optional(),
  }),
};
export type ConversationsListInput = z.infer<
  typeof conversationsListSchema.input
>;
export type ConversationsListOutput = z.infer<
  typeof conversationsListSchema.output
>;

export const conversationsHistorySchema = {
  name: 'conversationsHistory',
  description: 'Fetch message history from a channel',
  notes: '',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    cursor: CursorParam,
    limit: LimitParam.default(100),
    oldest: z
      .string()
      .optional()
      .describe('Only messages after this Unix timestamp'),
    latest: z
      .string()
      .optional()
      .describe('Only messages before this Unix timestamp'),
    inclusive: z.boolean().optional().default(true),
  }),
  output: z.object({
    ok: z.boolean(),
    messages: z.array(MessageSchema),
    has_more: z.boolean(),
    response_metadata: z
      .object({ next_cursor: z.string().optional() })
      .optional(),
  }),
};
export type ConversationsHistoryInput = z.infer<
  typeof conversationsHistorySchema.input
>;
export type ConversationsHistoryOutput = z.infer<
  typeof conversationsHistorySchema.output
>;

export const conversationsInfoSchema = {
  name: 'conversationsInfo',
  description: 'Get information about a channel',
  notes: '',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    include_num_members: z.boolean().optional().default(true),
  }),
  output: z.object({
    ok: z.boolean(),
    channel: ChannelSchema,
  }),
};
export type ConversationsInfoInput = z.infer<
  typeof conversationsInfoSchema.input
>;
export type ConversationsInfoOutput = z.infer<
  typeof conversationsInfoSchema.output
>;

export const conversationsMembersSchema = {
  name: 'conversationsMembers',
  description: 'List members of a channel',
  notes: '',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    cursor: CursorParam,
    limit: LimitParam.default(100),
  }),
  output: z.object({
    ok: z.boolean(),
    members: z.array(UserIdParam),
    response_metadata: z
      .object({ next_cursor: z.string().optional() })
      .optional(),
  }),
};
export type ConversationsMembersInput = z.infer<
  typeof conversationsMembersSchema.input
>;
export type ConversationsMembersOutput = z.infer<
  typeof conversationsMembersSchema.output
>;

export const conversationsRepliesSchema = {
  name: 'conversationsReplies',
  description: 'Get replies to a thread',
  notes: '',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    ts: TimestampParam.describe('Parent message timestamp'),
    cursor: CursorParam,
    limit: LimitParam.default(100),
  }),
  output: z.object({
    ok: z.boolean(),
    messages: z.array(MessageSchema),
    has_more: z.boolean(),
  }),
};
export type ConversationsRepliesInput = z.infer<
  typeof conversationsRepliesSchema.input
>;
export type ConversationsRepliesOutput = z.infer<
  typeof conversationsRepliesSchema.output
>;

export const conversationsCreateSchema = {
  name: 'conversationsCreate',
  description: 'Create a new channel',
  notes: '**DESTRUCTIVE**: Creates a new public or private channel.',
  input: z.object({
    token: TokenParam,
    name: z.string().describe('Channel name (lowercase, no spaces)'),
    is_private: z.boolean().optional().default(false),
  }),
  output: z.object({
    ok: z.boolean(),
    channel: ChannelSchema,
  }),
};
export type ConversationsCreateInput = z.infer<
  typeof conversationsCreateSchema.input
>;
export type ConversationsCreateOutput = z.infer<
  typeof conversationsCreateSchema.output
>;

export const conversationsArchiveSchema = {
  name: 'conversationsArchive',
  description: 'Archive a channel',
  notes: '**DESTRUCTIVE**: Archives the channel. Can be unarchived later.',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type ConversationsArchiveInput = z.infer<
  typeof conversationsArchiveSchema.input
>;
export type ConversationsArchiveOutput = z.infer<
  typeof conversationsArchiveSchema.output
>;

export const conversationsUnarchiveSchema = {
  name: 'conversationsUnarchive',
  description: 'Unarchive a channel',
  notes: '',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type ConversationsUnarchiveInput = z.infer<
  typeof conversationsUnarchiveSchema.input
>;
export type ConversationsUnarchiveOutput = z.infer<
  typeof conversationsUnarchiveSchema.output
>;

export const conversationsJoinSchema = {
  name: 'conversationsJoin',
  description: 'Join a public channel',
  notes: '',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
  }),
  output: z.object({
    ok: z.boolean(),
    channel: ChannelSchema,
  }),
};
export type ConversationsJoinInput = z.infer<
  typeof conversationsJoinSchema.input
>;
export type ConversationsJoinOutput = z.infer<
  typeof conversationsJoinSchema.output
>;

export const conversationsLeaveSchema = {
  name: 'conversationsLeave',
  description: 'Leave a channel',
  notes: '',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type ConversationsLeaveInput = z.infer<
  typeof conversationsLeaveSchema.input
>;
export type ConversationsLeaveOutput = z.infer<
  typeof conversationsLeaveSchema.output
>;

export const conversationsRenameSchema = {
  name: 'conversationsRename',
  description: 'Rename a channel',
  notes: '**DESTRUCTIVE**: Changes the channel name.',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    name: z.string().describe('New channel name'),
  }),
  output: z.object({
    ok: z.boolean(),
    channel: ChannelSchema,
  }),
};
export type ConversationsRenameInput = z.infer<
  typeof conversationsRenameSchema.input
>;
export type ConversationsRenameOutput = z.infer<
  typeof conversationsRenameSchema.output
>;

export const conversationsOpenSchema = {
  name: 'conversationsOpen',
  description: 'Open or resume a DM',
  notes:
    'Opens a direct message. Provide either `channel` (existing DM ID) OR `users` (to create/resume).',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam.optional().describe(
      'Existing IM/MPIM ID to resume',
    ),
    users: z
      .string()
      .optional()
      .describe('Comma-separated user IDs (1-8 users)'),
    return_im: z
      .boolean()
      .optional()
      .describe('Return full IM channel definition'),
    prevent_creation: z
      .boolean()
      .optional()
      .describe('Do not create if does not exist'),
  }),
  output: z.object({
    ok: z.boolean(),
    channel: ChannelSchema,
    no_op: z.boolean().optional().describe('No operation occurred'),
    already_open: z
      .boolean()
      .optional()
      .describe('Conversation was already open'),
  }),
};
export type ConversationsOpenInput = z.infer<
  typeof conversationsOpenSchema.input
>;
export type ConversationsOpenOutput = z.infer<
  typeof conversationsOpenSchema.output
>;

export const conversationsCloseSchema = {
  name: 'conversationsClose',
  description: 'Close a DM or MPDM',
  notes: '',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type ConversationsCloseInput = z.infer<
  typeof conversationsCloseSchema.input
>;
export type ConversationsCloseOutput = z.infer<
  typeof conversationsCloseSchema.output
>;

export const conversationsMarkSchema = {
  name: 'conversationsMark',
  description: 'Mark channel as read',
  notes: '',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    ts: TimestampParam,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type ConversationsMarkInput = z.infer<
  typeof conversationsMarkSchema.input
>;
export type ConversationsMarkOutput = z.infer<
  typeof conversationsMarkSchema.output
>;

export const conversationsSetPurposeSchema = {
  name: 'conversationsSetPurpose',
  description: 'Set channel purpose',
  notes: '**DESTRUCTIVE**: Updates the channel purpose/description.',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    purpose: z.string(),
  }),
  output: z.object({
    ok: z.boolean(),
    channel: ChannelSchema,
  }),
};
export type ConversationsSetPurposeInput = z.infer<
  typeof conversationsSetPurposeSchema.input
>;
export type ConversationsSetPurposeOutput = z.infer<
  typeof conversationsSetPurposeSchema.output
>;

export const conversationsSetTopicSchema = {
  name: 'conversationsSetTopic',
  description: 'Set channel topic',
  notes: '**DESTRUCTIVE**: Updates the channel topic.',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    topic: z.string(),
  }),
  output: z.object({
    ok: z.boolean(),
    channel: ChannelSchema,
  }),
};
export type ConversationsSetTopicInput = z.infer<
  typeof conversationsSetTopicSchema.input
>;
export type ConversationsSetTopicOutput = z.infer<
  typeof conversationsSetTopicSchema.output
>;

export const conversationsInviteSchema = {
  name: 'conversationsInvite',
  description:
    'Invite workspace members to a channel. Adds 1-1000 existing workspace users to a public or private channel.',
  notes:
    '**DESTRUCTIVE**: Invites users to a channel. The calling user must be a member of the channel.',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    users: z
      .string()
      .describe(
        'Comma-separated list of user IDs to invite (e.g., "U01234567,U09876543"). Up to 1000.',
      ),
    force: z
      .boolean()
      .optional()
      .describe(
        'When true and multiple user IDs are provided, continue inviting valid ones while skipping invalid IDs. Defaults to false.',
      ),
  }),
  output: z.object({
    ok: z.boolean(),
    channel: ChannelSchema,
  }),
};
export type ConversationsInviteInput = z.infer<
  typeof conversationsInviteSchema.input
>;
export type ConversationsInviteOutput = z.infer<
  typeof conversationsInviteSchema.output
>;

export const conversationsInviteSharedSchema = {
  name: 'conversationsInviteShared',
  description:
    'Send a Slack Connect invitation to an external user by email. Creates an invite for someone outside the workspace to join a channel.',
  notes:
    '**DESTRUCTIVE**: Sends an external Slack Connect invitation email. Provide exactly one email address. The channel becomes a Slack Connect channel once accepted.',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    emails: z
      .string()
      .describe(
        'Email address to invite (e.g., "user@example.com"). One email per call.',
      ),
    external_limited: z
      .boolean()
      .optional()
      .describe(
        'Whether the invite is for an external limited member. Defaults to true. Set to false to get a shareable join URL back.',
      ),
  }),
  output: z.object({
    ok: z.boolean(),
    invite_id: z.string().describe('Invite ID (e.g., "I0APADPUL1K")'),
    is_legacy_shared_channel: z.boolean(),
    conf_code: z
      .string()
      .optional()
      .describe(
        'Confirmation code. Only returned when external_limited is false.',
      ),
    url: z
      .string()
      .optional()
      .describe(
        'Shareable join URL. Only returned when external_limited is false.',
      ),
  }),
};
export type ConversationsInviteSharedInput = z.infer<
  typeof conversationsInviteSharedSchema.input
>;
export type ConversationsInviteSharedOutput = z.infer<
  typeof conversationsInviteSharedSchema.output
>;

// ============================================================================
// Action Schemas - Users
// ============================================================================

export const usersListSchema = {
  name: 'usersList',
  description: 'List all users in the workspace',
  notes: '',
  input: z.object({
    token: TokenParam,
    cursor: CursorParam,
    limit: LimitParam.default(100),
    include_locale: z.boolean().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    members: z.array(UserSchema),
    response_metadata: z
      .object({ next_cursor: z.string().optional() })
      .optional(),
  }),
};
export type UsersListInput = z.infer<typeof usersListSchema.input>;
export type UsersListOutput = z.infer<typeof usersListSchema.output>;

export const usersInfoSchema = {
  name: 'usersInfo',
  description: 'Get information about a user',
  notes: '',
  input: z.object({
    token: TokenParam,
    user: UserIdParam,
  }),
  output: z.object({
    ok: z.boolean(),
    user: UserSchema,
  }),
};
export type UsersInfoInput = z.infer<typeof usersInfoSchema.input>;
export type UsersInfoOutput = z.infer<typeof usersInfoSchema.output>;

export const usersGetPresenceSchema = {
  name: 'usersGetPresence',
  description: 'Get presence status for a user',
  notes: '',
  input: z.object({
    token: TokenParam,
    user: UserIdParam,
  }),
  output: z.object({
    ok: z.boolean(),
    presence: z.enum(['active', 'away']),
    online: z.boolean().optional().describe('Has connected client'),
    auto_away: z
      .boolean()
      .optional()
      .describe('Auto-away after 10 min inactive'),
    manual_away: z.boolean().optional().describe('Manually set to away'),
    connection_count: z.number().optional().describe('Total connected clients'),
    last_activity: z
      .number()
      .optional()
      .describe('Unix timestamp of last activity'),
  }),
};
export type UsersGetPresenceInput = z.infer<
  typeof usersGetPresenceSchema.input
>;
export type UsersGetPresenceOutput = z.infer<
  typeof usersGetPresenceSchema.output
>;

export const usersProfileGetSchema = {
  name: 'usersProfileGet',
  description: 'Get user profile including custom status',
  notes: '',
  input: z.object({
    token: TokenParam,
    user: UserIdParam.optional().describe(
      'User ID (defaults to authenticated user)',
    ),
  }),
  output: z.object({
    ok: z.boolean(),
    profile: z.object({
      display_name: z.string(),
      email: z.string().optional(),
      status_text: z.string().optional(),
      status_emoji: z.string().optional(),
      status_expiration: z.number().optional(),
    }),
  }),
};
export type UsersProfileGetInput = z.infer<typeof usersProfileGetSchema.input>;
export type UsersProfileGetOutput = z.infer<
  typeof usersProfileGetSchema.output
>;

export const usersProfileSetSchema = {
  name: 'usersProfileSet',
  description: 'Set user profile or custom status',
  notes: '**DESTRUCTIVE**: Updates profile fields or custom status.',
  input: z.object({
    token: TokenParam,
    profile: z.string().describe('JSON-encoded profile object'),
  }),
  output: z.object({
    ok: z.boolean(),
    profile: z.object({
      display_name: z.string(),
      status_text: z.string().optional(),
      status_emoji: z.string().optional(),
    }),
  }),
};
export type UsersProfileSetInput = z.infer<typeof usersProfileSetSchema.input>;
export type UsersProfileSetOutput = z.infer<
  typeof usersProfileSetSchema.output
>;

export const usersSetPresenceSchema = {
  name: 'usersSetPresence',
  description: 'Set user presence',
  notes: '**DESTRUCTIVE**: Manually sets presence to away or auto.',
  input: z.object({
    token: TokenParam,
    presence: z.enum(['auto', 'away']),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type UsersSetPresenceInput = z.infer<
  typeof usersSetPresenceSchema.input
>;
export type UsersSetPresenceOutput = z.infer<
  typeof usersSetPresenceSchema.output
>;

// ============================================================================
// Action Schemas - Search
// ============================================================================

export const searchChannelsSchema = {
  name: 'searchChannels',
  description: 'Search for channels by name',
  notes:
    'Fuzzy-matches channel names. Use this to find a channel by name instead of paginating conversationsList. Returns both public and private channels the user can access.',
  input: z.object({
    token: TokenParam,
    query: z.string().describe('Channel name or partial name to search for'),
    count: z
      .number()
      .int()
      .optional()
      .describe('Number of results to return (default: 20)'),
    page: z.number().int().optional().describe('Page number (default: 1)'),
  }),
  output: z.object({
    ok: z.boolean(),
    query: z.string(),
    module: z.string(),
    items: z.array(
      z.object({
        id: ChannelIdParam,
        name: z.string().describe('Channel name'),
        member_count: z.number().describe('Number of members'),
        is_member: z.boolean().describe('Whether the current user is a member'),
        purpose: z
          .object({ value: z.string() })
          .optional()
          .describe('Channel purpose/description'),
      }),
    ),
    pagination: z.object({
      total_count: z.number(),
      page: z.number(),
      per_page: z.number(),
      page_count: z.number(),
    }),
  }),
};
export type SearchChannelsInput = z.infer<typeof searchChannelsSchema.input>;
export type SearchChannelsOutput = z.infer<typeof searchChannelsSchema.output>;

export const searchPeopleSchema = {
  name: 'searchPeople',
  description: 'Search for people in the workspace by name',
  notes:
    'Fuzzy-matches user names. Returns rich profile data including email, title, and avatar.',
  input: z.object({
    token: TokenParam,
    query: z.string().describe('Person name or partial name to search for'),
    count: z
      .number()
      .int()
      .optional()
      .describe('Number of results to return (default: 20)'),
    page: z.number().int().optional().describe('Page number (default: 1)'),
  }),
  output: z.object({
    ok: z.boolean(),
    query: z.string(),
    module: z.string(),
    items: z.array(
      z.object({
        id: UserIdParam,
        username: z.string(),
        profile: z.object({
          real_name: z.string(),
          display_name: z.string(),
          email: z.string().optional(),
          title: z.string().optional(),
          image_72: z.string().optional(),
        }),
      }),
    ),
    pagination: z.object({
      total_count: z.number(),
      page: z.number(),
      per_page: z.number(),
      page_count: z.number(),
    }),
  }),
};
export type SearchPeopleInput = z.infer<typeof searchPeopleSchema.input>;
export type SearchPeopleOutput = z.infer<typeof searchPeopleSchema.output>;

export const searchMessagesSchema = {
  name: 'searchMessages',
  description: 'Search for messages',
  notes:
    'Searches messages using Slack search syntax. Supports from:, in:, has:, before:, after:, etc.',
  input: z.object({
    token: TokenParam,
    query: z.string().describe('Search query'),
    sort: z.enum(['score', 'timestamp']).optional().default('score'),
    sort_dir: z.enum(['asc', 'desc']).optional().default('desc'),
    count: z.number().optional().default(20),
    page: z.number().optional().default(1),
  }),
  output: z.object({
    ok: z.boolean(),
    query: z.string(),
    messages: z.object({
      total: z.number(),
      matches: z.array(MessageSchema),
    }),
  }),
};
export type SearchMessagesInput = z.infer<typeof searchMessagesSchema.input>;
export type SearchMessagesOutput = z.infer<typeof searchMessagesSchema.output>;

export const searchFilesSchema = {
  name: 'searchFiles',
  description: 'Search for files',
  notes: '',
  input: z.object({
    token: TokenParam,
    query: z.string(),
    sort: z.enum(['score', 'timestamp']).optional().default('score'),
    sort_dir: z.enum(['asc', 'desc']).optional().default('desc'),
    count: z.number().optional().default(20),
    page: z.number().optional().default(1),
  }),
  output: z.object({
    ok: z.boolean(),
    query: z.string(),
    files: z.object({
      total: z.number(),
      matches: z.array(FileSchema),
    }),
  }),
};
export type SearchFilesInput = z.infer<typeof searchFilesSchema.input>;
export type SearchFilesOutput = z.infer<typeof searchFilesSchema.output>;

export const searchAllSchema = {
  name: 'searchAll',
  description: 'Search messages and files',
  notes: '',
  input: z.object({
    token: TokenParam,
    query: z.string(),
    sort: z.enum(['score', 'timestamp']).optional().default('score'),
    sort_dir: z.enum(['asc', 'desc']).optional().default('desc'),
    count: z.number().optional().default(20),
    page: z.number().optional().default(1),
  }),
  output: z.object({
    ok: z.boolean(),
    query: z.string(),
    messages: z.object({ total: z.number(), matches: z.array(MessageSchema) }),
    files: z.object({ total: z.number(), matches: z.array(FileSchema) }),
  }),
};
export type SearchAllInput = z.infer<typeof searchAllSchema.input>;
export type SearchAllOutput = z.infer<typeof searchAllSchema.output>;

// ============================================================================
// Action Schemas - Files
// ============================================================================

export const filesListSchema = {
  name: 'filesList',
  description: 'List files',
  notes: '',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam.optional(),
    user: UserIdParam.optional(),
    types: z
      .string()
      .optional()
      .describe('Comma-separated: spaces, snippets, images, etc.'),
    count: z.number().optional().default(100),
    page: z.number().optional().default(1),
  }),
  output: z.object({
    ok: z.boolean(),
    files: z.array(FileSchema),
    paging: z.object({
      count: z.number(),
      total: z.number(),
      page: z.number(),
      pages: z.number(),
    }),
  }),
};
export type FilesListInput = z.infer<typeof filesListSchema.input>;
export type FilesListOutput = z.infer<typeof filesListSchema.output>;

export const filesInfoSchema = {
  name: 'filesInfo',
  description: 'Get file information',
  notes: '',
  input: z.object({
    token: TokenParam,
    file: z.string().describe('File ID'),
  }),
  output: z.object({
    ok: z.boolean(),
    file: FileSchema,
  }),
};
export type FilesInfoInput = z.infer<typeof filesInfoSchema.input>;
export type FilesInfoOutput = z.infer<typeof filesInfoSchema.output>;

export const filesUploadSchema = {
  name: 'filesUpload',
  description: 'Upload text content as a file',
  notes:
    'Only supports text content via the content parameter. For binary files (PDFs, images, etc.), use uploadFile instead. ' +
    '**DESTRUCTIVE**: Uploads file to Slack.',
  input: z.object({
    token: TokenParam,
    channels: z.string().optional().describe('Comma-separated channel IDs'),
    content: z.string().optional().describe('File content (for text files)'),
    file: z.string().optional().describe('File data (for binary upload)'),
    filename: z.string(),
    filetype: z.string().optional(),
    title: z.string().optional(),
    initial_comment: z.string().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    file: FileSchema,
  }),
};
export type FilesUploadInput = z.infer<typeof filesUploadSchema.input>;
export type FilesUploadOutput = z.infer<typeof filesUploadSchema.output>;

export const filesDeleteSchema = {
  name: 'filesDelete',
  description: 'Delete a file',
  notes: '**DESTRUCTIVE**: Permanently deletes the file.',
  input: z.object({
    token: TokenParam,
    file: z.string().describe('File ID'),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type FilesDeleteInput = z.infer<typeof filesDeleteSchema.input>;
export type FilesDeleteOutput = z.infer<typeof filesDeleteSchema.output>;

export const filesGetUploadURLExternalSchema = {
  name: 'filesGetUploadURLExternal',
  description: 'Get upload URL for external file upload',
  notes:
    'Low-level API. Prefer uploadFile for most use cases. ' +
    'First step of three-step external upload: get URL, PUT data to URL with correct Content-Type, then filesCompleteUploadExternal.',
  input: z.object({
    token: TokenParam,
    filename: z.string(),
    length: z.number().describe('File size in bytes'),
    alt_txt: z
      .string()
      .optional()
      .describe('Description of image for accessibility'),
    snippet_type: z
      .string()
      .optional()
      .describe('Syntax type of the snippet being uploaded'),
  }),
  output: z.object({
    ok: z.boolean(),
    upload_url: z.string(),
    file_id: z.string(),
  }),
};
export type FilesGetUploadURLExternalInput = z.infer<
  typeof filesGetUploadURLExternalSchema.input
>;
export type FilesGetUploadURLExternalOutput = z.infer<
  typeof filesGetUploadURLExternalSchema.output
>;

export const filesCompleteUploadExternalSchema = {
  name: 'filesCompleteUploadExternal',
  description: 'Complete external file upload',
  notes:
    'Low-level API. Prefer uploadFile for most use cases. ' +
    'Final step after uploading data to URL from filesGetUploadURLExternal.',
  input: z.object({
    token: TokenParam,
    files: z.string().describe('JSON array of {id, title} objects'),
    channel_id: ChannelIdParam.optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    files: z.array(FileSchema),
  }),
};
export type FilesCompleteUploadExternalInput = z.infer<
  typeof filesCompleteUploadExternalSchema.input
>;
export type FilesCompleteUploadExternalOutput = z.infer<
  typeof filesCompleteUploadExternalSchema.output
>;

export const uploadFileSchema = {
  name: 'uploadFile',
  description: 'Upload a binary file to Slack with correct type detection',
  notes:
    'Uploads binary file data to Slack via multipart form with proper MIME type and filetype handling. ' +
    'Use @vallum/files load() to read local files into an ArrayBuffer, then pass it as file_data. ' +
    'At runtime, file_data accepts ArrayBuffer, Uint8Array, or base64 string. ' +
    '**DESTRUCTIVE**: Uploads file to Slack.',
  input: z.object({
    token: TokenParam,
    file_data: z
      .string()
      .describe(
        'File content as base64 string. At runtime, also accepts ArrayBuffer or Uint8Array from @vallum/files load().',
      ),
    filename: z
      .string()
      .describe(
        'Filename with extension (e.g., "report.pdf"). Extension is used for type detection.',
      ),
    filetype: z
      .string()
      .optional()
      .describe(
        'Slack filetype (e.g., "pdf", "png", "csv"). Auto-detected from filename extension if omitted.',
      ),
    channel_id: ChannelIdParam.optional().describe(
      'Channel to share the file to',
    ),
    title: z
      .string()
      .optional()
      .describe('Display title. Defaults to filename without extension.'),
    initial_comment: z
      .string()
      .optional()
      .describe('Message posted with the file'),
  }),
  output: z.object({
    ok: z.boolean(),
    file: FileSchema,
  }),
};
export type UploadFileInput = z.infer<typeof uploadFileSchema.input>;
export type UploadFileOutput = z.infer<typeof uploadFileSchema.output>;

// ============================================================================
// Action Schemas - Reactions
// ============================================================================

export const reactionsAddSchema = {
  name: 'reactionsAdd',
  description: 'Add emoji reaction to message',
  notes: '**DESTRUCTIVE**: Adds reaction visible to all channel members.',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    timestamp: TimestampParam,
    name: z.string().describe('Emoji name (without colons)'),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type ReactionsAddInput = z.infer<typeof reactionsAddSchema.input>;
export type ReactionsAddOutput = z.infer<typeof reactionsAddSchema.output>;

export const reactionsGetSchema = {
  name: 'reactionsGet',
  description: 'Get reactions for a message',
  notes: '',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    timestamp: TimestampParam,
  }),
  output: z.object({
    ok: z.boolean(),
    message: MessageSchema,
  }),
};
export type ReactionsGetInput = z.infer<typeof reactionsGetSchema.input>;
export type ReactionsGetOutput = z.infer<typeof reactionsGetSchema.output>;

export const reactionsRemoveSchema = {
  name: 'reactionsRemove',
  description: 'Remove emoji reaction',
  notes: '**DESTRUCTIVE**: Removes your reaction from message.',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    timestamp: TimestampParam,
    name: z.string().describe('Emoji name (without colons)'),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type ReactionsRemoveInput = z.infer<typeof reactionsRemoveSchema.input>;
export type ReactionsRemoveOutput = z.infer<
  typeof reactionsRemoveSchema.output
>;

// ============================================================================
// Action Schemas - Pins
// ============================================================================

export const pinsAddSchema = {
  name: 'pinsAdd',
  description: 'Pin a message to channel',
  notes: '**DESTRUCTIVE**: Pins message, visible to all members.',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    timestamp: TimestampParam,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type PinsAddInput = z.infer<typeof pinsAddSchema.input>;
export type PinsAddOutput = z.infer<typeof pinsAddSchema.output>;

export const pinsListSchema = {
  name: 'pinsList',
  description: 'List pinned items in channel',
  notes: '',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
  }),
  output: z.object({
    ok: z.boolean(),
    items: z.array(
      z.object({
        type: z.string(),
        message: MessageSchema.optional(),
        file: FileSchema.optional(),
      }),
    ),
  }),
};
export type PinsListInput = z.infer<typeof pinsListSchema.input>;
export type PinsListOutput = z.infer<typeof pinsListSchema.output>;

export const pinsRemoveSchema = {
  name: 'pinsRemove',
  description: 'Unpin a message',
  notes: '**DESTRUCTIVE**: Removes pin from message.',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
    timestamp: TimestampParam,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type PinsRemoveInput = z.infer<typeof pinsRemoveSchema.input>;
export type PinsRemoveOutput = z.infer<typeof pinsRemoveSchema.output>;

// ============================================================================
// Action Schemas - Bookmarks
// ============================================================================

export const bookmarksAddSchema = {
  name: 'bookmarksAdd',
  description: 'Add bookmark to channel',
  notes: '**DESTRUCTIVE**: Adds bookmark visible to channel members.',
  input: z.object({
    token: TokenParam,
    channel_id: ChannelIdParam,
    title: z.string(),
    type: z.enum(['link', 'emoji']),
    link: z.string().optional().describe('URL to bookmark'),
    emoji: z.string().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    bookmark: z.object({
      id: z.string(),
      title: z.string(),
      link: z.string().optional(),
    }),
  }),
};
export type BookmarksAddInput = z.infer<typeof bookmarksAddSchema.input>;
export type BookmarksAddOutput = z.infer<typeof bookmarksAddSchema.output>;

export const bookmarksListSchema = {
  name: 'bookmarksList',
  description: 'List channel bookmarks',
  notes: '',
  input: z.object({
    token: TokenParam,
    channel_id: ChannelIdParam,
  }),
  output: z.object({
    ok: z.boolean(),
    bookmarks: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        link: z.string().optional(),
        type: z.string(),
      }),
    ),
  }),
};
export type BookmarksListInput = z.infer<typeof bookmarksListSchema.input>;
export type BookmarksListOutput = z.infer<typeof bookmarksListSchema.output>;

export const bookmarksEditSchema = {
  name: 'bookmarksEdit',
  description: 'Edit a bookmark',
  notes: '**DESTRUCTIVE**: Updates bookmark properties.',
  input: z.object({
    token: TokenParam,
    channel_id: ChannelIdParam,
    bookmark_id: z.string(),
    title: z.string().optional(),
    link: z.string().optional().describe('URL to bookmark'),
  }),
  output: z.object({
    ok: z.boolean(),
    bookmark: z.object({
      id: z.string(),
      title: z.string(),
      link: z.string().optional(),
    }),
  }),
};
export type BookmarksEditInput = z.infer<typeof bookmarksEditSchema.input>;
export type BookmarksEditOutput = z.infer<typeof bookmarksEditSchema.output>;

export const bookmarksRemoveSchema = {
  name: 'bookmarksRemove',
  description: 'Remove a bookmark',
  notes: '**DESTRUCTIVE**: Deletes bookmark from channel.',
  input: z.object({
    token: TokenParam,
    channel_id: ChannelIdParam,
    bookmark_id: z.string(),
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type BookmarksRemoveInput = z.infer<typeof bookmarksRemoveSchema.input>;
export type BookmarksRemoveOutput = z.infer<
  typeof bookmarksRemoveSchema.output
>;

// ============================================================================
// Action Schemas - DND
// ============================================================================

export const dndInfoSchema = {
  name: 'dndInfo',
  description: 'Get DND status',
  notes: '',
  input: z.object({
    token: TokenParam,
    user: UserIdParam.optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    dnd_enabled: z.boolean(),
    next_dnd_start_ts: z.number().optional(),
    next_dnd_end_ts: z.number().optional(),
    snooze_enabled: z.boolean().optional(),
    snooze_endtime: z.number().optional(),
  }),
};
export type DndInfoInput = z.infer<typeof dndInfoSchema.input>;
export type DndInfoOutput = z.infer<typeof dndInfoSchema.output>;

export const dndSetSnoozeSchema = {
  name: 'dndSetSnooze',
  description: 'Snooze notifications',
  notes: '**DESTRUCTIVE**: Enables snooze mode.',
  input: z.object({
    token: TokenParam,
    num_minutes: z.number().describe('Snooze duration in minutes'),
  }),
  output: z.object({
    ok: z.boolean(),
    snooze_enabled: z.boolean(),
    snooze_endtime: z.number(),
  }),
};
export type DndSetSnoozeInput = z.infer<typeof dndSetSnoozeSchema.input>;
export type DndSetSnoozeOutput = z.infer<typeof dndSetSnoozeSchema.output>;

export const dndEndSnoozeSchema = {
  name: 'dndEndSnooze',
  description: 'End snooze mode',
  notes: '',
  input: z.object({
    token: TokenParam,
  }),
  output: z.object({
    ok: z.boolean(),
    dnd_enabled: z.boolean(),
  }),
};
export type DndEndSnoozeInput = z.infer<typeof dndEndSnoozeSchema.input>;
export type DndEndSnoozeOutput = z.infer<typeof dndEndSnoozeSchema.output>;

export const dndEndDndSchema = {
  name: 'dndEndDnd',
  description: 'End DND session',
  notes: '',
  input: z.object({
    token: TokenParam,
  }),
  output: z.object({
    ok: z.boolean(),
  }),
};
export type DndEndDndInput = z.infer<typeof dndEndDndSchema.input>;
export type DndEndDndOutput = z.infer<typeof dndEndDndSchema.output>;

export const dndTeamInfoSchema = {
  name: 'dndTeamInfo',
  description: 'Get DND status for team members',
  notes: '',
  input: z.object({
    token: TokenParam,
    users: z.string().describe('Comma-separated user IDs'),
  }),
  output: z.object({
    ok: z.boolean(),
    users: z.record(
      z.string(),
      z.object({
        dnd_enabled: z.boolean(),
        next_dnd_start_ts: z.number().optional(),
        next_dnd_end_ts: z.number().optional(),
      }),
    ),
  }),
};
export type DndTeamInfoInput = z.infer<typeof dndTeamInfoSchema.input>;
export type DndTeamInfoOutput = z.infer<typeof dndTeamInfoSchema.output>;

// ============================================================================
// Action Schemas - Emoji & Team
// ============================================================================

export const emojiListSchema = {
  name: 'emojiList',
  description: 'List custom emoji',
  notes: '',
  input: z.object({
    token: TokenParam,
    cursor: CursorParam,
    limit: z
      .number()
      .optional()
      .describe('Max emojis to return (1-1000, recommended 100-200)'),
    include_categories: z
      .boolean()
      .optional()
      .describe('Include emoji categories'),
  }),
  output: z.object({
    ok: z.boolean(),
    emoji: z
      .record(z.string(), z.string())
      .describe('Map of emoji name to URL or alias:name'),
    cache_ts: z.string().optional(),
    response_metadata: z
      .object({ next_cursor: z.string().optional() })
      .optional(),
  }),
};
export type EmojiListInput = z.infer<typeof emojiListSchema.input>;
export type EmojiListOutput = z.infer<typeof emojiListSchema.output>;

export const teamInfoSchema = {
  name: 'teamInfo',
  description: 'Get workspace info',
  notes: '',
  input: z.object({
    token: TokenParam,
  }),
  output: z.object({
    ok: z.boolean(),
    team: z.object({
      id: TeamIdParam,
      name: z.string().describe('Workspace display name'),
      url: z.string().describe('Workspace URL (e.g. https://team.slack.com/)'),
      domain: z.string().describe('Workspace subdomain'),
      email_domain: z
        .string()
        .optional()
        .describe('Verified email domain for the workspace'),
      avatar_base_url: z.string().optional(),
      is_verified: z.boolean().optional(),
      icon: z
        .object({
          image_default: z.boolean().optional(),
          image_34: z.string().optional(),
          image_44: z.string().optional(),
          image_68: z.string().optional(),
          image_88: z.string().optional(),
          image_102: z.string().optional(),
          image_132: z.string().optional(),
          image_230: z.string().optional(),
        })
        .optional()
        .describe('Workspace icon in various sizes'),
    }),
  }),
};
export type TeamInfoInput = z.infer<typeof teamInfoSchema.input>;
export type TeamInfoOutput = z.infer<typeof teamInfoSchema.output>;

export const botsInfoSchema = {
  name: 'botsInfo',
  description: 'Get bot user info',
  notes: '',
  input: z.object({
    token: TokenParam,
    bot: z
      .string()
      .describe(
        'Bot ID (B-prefix from user.profile.bot_id, NOT the user ID with U-prefix)',
      ),
  }),
  output: z.object({
    ok: z.boolean(),
    bot: z.object({
      id: z.string(),
      name: z.string(),
      deleted: z.boolean(),
      app_id: z.string().optional(),
    }),
  }),
};
export type BotsInfoInput = z.infer<typeof botsInfoSchema.input>;
export type BotsInfoOutput = z.infer<typeof botsInfoSchema.output>;

// ============================================================================
// Action Schemas - Usergroups
// ============================================================================

export const usergroupsListSchema = {
  name: 'usergroupsList',
  description: 'List user groups',
  notes: '',
  input: z.object({
    token: TokenParam,
    include_count: z.boolean().optional(),
    include_disabled: z.boolean().optional(),
    include_users: z.boolean().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    usergroups: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        handle: z.string(),
        is_usergroup: z.boolean(),
        user_count: z.number().optional(),
        users: z.array(UserIdParam).optional(),
      }),
    ),
  }),
};
export type UsergroupsListInput = z.infer<typeof usergroupsListSchema.input>;
export type UsergroupsListOutput = z.infer<typeof usergroupsListSchema.output>;

export const usergroupsUsersListSchema = {
  name: 'usergroupsUsersList',
  description: 'List users in group',
  notes: '',
  input: z.object({
    token: TokenParam,
    usergroup: z.string(),
  }),
  output: z.object({
    ok: z.boolean(),
    users: z.array(UserIdParam),
  }),
};
export type UsergroupsUsersListInput = z.infer<
  typeof usergroupsUsersListSchema.input
>;
export type UsergroupsUsersListOutput = z.infer<
  typeof usergroupsUsersListSchema.output
>;

export const resolveDmCounterpartSchema = {
  name: 'resolveDmCounterpart',
  description: 'Resolve the other member of a 1:1 Slack DM channel (the non-self counterpart)',
  notes:
    'Returns { isDm:true, counterpartUserId } ONLY for a 1:1 DM: a D-prefixed channel with exactly two distinct members. Group DMs (mpim, G-prefixed), channels (C-prefixed), self-DMs, or member count != 2 return { isDm:false, counterpartUserId:null }. Composes conversationsMembers + authTest; does NOT rely on is_im channel metadata.',
  input: z.object({
    token: TokenParam,
    channel: ChannelIdParam,
  }),
  output: z.object({
    isDm: z.boolean().describe('True only for a 1:1 DM (exactly two distinct members)'),
    counterpartUserId: UserIdParam.nullable().describe('The non-self member; null when isDm is false'),
  }),
};
export type ResolveDmCounterpartInput = z.infer<typeof resolveDmCounterpartSchema.input>;
export type ResolveDmCounterpartOutput = z.infer<typeof resolveDmCounterpartSchema.output>;

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  // Auth
  getWorkspacesSchema,
  getContextSchema,
  authTestSchema,
  // Chat
  chatPostMessageSchema,
  chatUpdateSchema,
  chatDeleteSchema,
  chatGetPermalinkSchema,
  // Conversations
  conversationsListSchema,
  conversationsHistorySchema,
  conversationsInfoSchema,
  conversationsMembersSchema,
  conversationsRepliesSchema,
  conversationsCreateSchema,
  conversationsArchiveSchema,
  conversationsUnarchiveSchema,
  conversationsJoinSchema,
  conversationsLeaveSchema,
  conversationsRenameSchema,
  conversationsOpenSchema,
  conversationsCloseSchema,
  conversationsMarkSchema,
  conversationsSetPurposeSchema,
  conversationsSetTopicSchema,
  conversationsInviteSchema,
  conversationsInviteSharedSchema,
  // Users
  usersListSchema,
  usersInfoSchema,
  usersGetPresenceSchema,
  usersProfileGetSchema,
  usersProfileSetSchema,
  usersSetPresenceSchema,
  resolveDmCounterpartSchema,
  // Search
  searchChannelsSchema,
  searchPeopleSchema,
  searchMessagesSchema,
  searchFilesSchema,
  searchAllSchema,
  // Files
  filesListSchema,
  filesInfoSchema,
  filesUploadSchema,
  filesDeleteSchema,
  filesGetUploadURLExternalSchema,
  filesCompleteUploadExternalSchema,
  uploadFileSchema,
  // Reactions
  reactionsAddSchema,
  reactionsGetSchema,
  reactionsRemoveSchema,
  // Pins
  pinsAddSchema,
  pinsListSchema,
  pinsRemoveSchema,
  // Bookmarks
  bookmarksAddSchema,
  bookmarksListSchema,
  bookmarksEditSchema,
  bookmarksRemoveSchema,
  // DND
  dndInfoSchema,
  dndSetSnoozeSchema,
  dndEndSnoozeSchema,
  dndEndDndSchema,
  dndTeamInfoSchema,
  // Emoji & Team
  emojiListSchema,
  teamInfoSchema,
  botsInfoSchema,
  // Usergroups
  usergroupsListSchema,
  usergroupsUsersListSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

export type SlackContext = z.infer<typeof SlackContextSchema>;
export type User = z.infer<typeof UserSchema>;
export type Channel = z.infer<typeof ChannelSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type File = z.infer<typeof FileSchema>;
