import { z } from 'zod';

export const libraryDescription =
  'Otter.ai meeting transcription operations via internal APIs';

export const libraryIcon = '/icons/libs/otter.png';
export const loginUrl = 'https://otter.ai';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://otter.ai\`
2. Call \`getContext()\` to get \`{ csrf, userId, workspaceId }\`
3. Call Otter functions with csrf

## Key Concepts

- **Recordings (Speeches)**: Meeting transcriptions with audio, identified by \`otid\`
- **Channels (Groups)**: Shared spaces for team collaboration
- **AI Chat**: Ask questions across all recordings or within specific recording context
- **Thread Scopes**: user_session (global), speech (single recording), group (channel)
- **Write Operations**: Rename recordings (\`renameRecording\`) or permanently delete them (\`deleteRecording\`)
- **Personal Accounts**: \`workspaceId\` may be null. \`getWorkspace\` returns 404 for personal accounts.
`;

// ============================================================================
// Shared Params
// ============================================================================

export const CsrfParam = z
  .string()
  .describe('CSRF token from csrftoken cookie');

export const ClientVersionParam = z
  .string()
  .optional()
  .default('v3.101.1')
  .describe('Client version header (default: v3.101.1)');

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description: 'Get CSRF token and workspace context for Otter API calls',
  notes: 'Call FIRST before other Otter operations.',
  input: z.object({
    timeoutMs: z
      .number()
      .optional()
      .default(10000)
      .describe('Max wait time in milliseconds (default: 10000)'),
  }),
  output: z.object({
    csrf: z.string().describe('CSRF token for API requests'),
    userId: z.number().describe('Current user ID'),
    workspaceId: z
      .number()
      .nullable()
      .describe('Current workspace ID (null for personal accounts)'),
    workspaceName: z.string().describe('Workspace name'),
  }),
};

// ============================================================================
// Workspace & User
// ============================================================================

export const WorkspaceOwnerSchema = z.object({
  id: z.number().describe('Owner user ID'),
  name: z.string().optional().describe('Owner full name'),
  email: z.string().optional().describe('Owner email'),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});

export const WorkspaceDomainSchema = z.object({
  domain: z.string().describe('Domain name'),
  is_claimed: z.boolean().describe('Whether domain is claimed'),
  is_verified: z.boolean().describe('Whether domain is verified'),
  workspace_id: z.number().describe('Associated workspace ID'),
});

export const WorkspaceMemberSchema = z.object({
  id: z.number().describe('Membership ID'),
  member: z.object({
    id: z.number().describe('User ID'),
    name: z.string().optional().describe('Full name'),
    email: z.string().optional().describe('Email address'),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    avatar_url: z.string().optional().describe('Profile picture URL'),
  }),
  is_deleted: z.boolean().describe('Whether member is deleted'),
  is_pending: z.boolean().describe('Whether invite is pending'),
  workspace_id: z.number().describe('Workspace ID'),
  member_status: z.string().describe('joined team, deactivated, pending'),
  deactivated_at: z.string().nullable().describe('Deactivation timestamp'),
  license_status: z.string().describe('License status'),
  workspace_role: z.number().describe('1=Admin, 2=Member'),
  last_activity_time: z.string().optional().describe('Last activity timestamp'),
});

export const getWorkspaceSchema = {
  name: 'getWorkspace',
  description: 'Get full workspace details including all members (admin only)',
  notes: 'Returns 404 for personal accounts without a workspace.',
  input: z.object({
    csrf: CsrfParam,
  }),
  output: z.object({
    status: z.string().describe('Response status'),
    is_admin: z.boolean().describe('Whether current user is admin'),
    workspace: z.object({
      id: z.number().describe('Workspace ID'),
      name: z.string().describe('Workspace name'),
      members: z.array(WorkspaceMemberSchema).describe('All workspace members'),
    }),
    workspace_role: z.number().describe('Current user role: 1=Admin, 2=Member'),
  }),
};

// ============================================================================
// Recordings
// ============================================================================

export const RecordingOwnerSchema = z.object({
  id: z.number().describe('Owner user ID'),
  name: z.string().optional().describe('Full name'),
  email: z.string().optional().describe('Email address'),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  avatar_url: z.string().optional().describe('Profile picture URL'),
});

export const RecordingSchema = z.object({
  otid: z.string().describe('Recording ID'),
  title: z.string().nullable().optional().describe('Recording title'),
  owner: RecordingOwnerSchema.optional().describe('Recording owner'),
  folder: z.string().nullable().optional().describe('Folder name'),
  summary: z.string().optional().describe('Full summary'),
  duration: z.number().optional().describe('Duration in seconds'),
  speakers: z.array(z.unknown()).optional().describe('Speaker objects'),
  created_at: z.number().optional().describe('Unix timestamp'),
  short_abstract_summary: z
    .string()
    .nullable()
    .optional()
    .describe('Brief summary'),
  speech_id: z.string().optional().describe('Internal speech ID'),
  start_time: z.number().optional().describe('Start time (unix)'),
  action_item_count: z.number().optional().describe('Number of action items'),
});

export const TranscriptSchema = z.object({
  transcript: z.string().describe('Transcript text'),
});

export const RecordingDetailSchema = z.object({
  otid: z.string().describe('Recording ID'),
  title: z.string().optional().describe('Recording title'),
  folder: z.string().optional().describe('Folder name'),
  shared: z.boolean().optional().describe('Whether shared'),
  source: z.string().optional().describe('zoom, upload, mobile, etc.'),
  summary: z.string().optional().describe('AI summary'),
  user_id: z.number().optional().describe('Owner user ID'),
  speakers: z.array(z.unknown()).optional().describe('Speaker objects'),
  is_public: z.boolean().optional().describe('Whether publicly accessible'),
  created_at: z.number().optional().describe('Unix timestamp'),
  end_offset: z.number().optional().describe('End offset in ms'),
  monologues: z.array(z.unknown()).optional().describe('Speaker segments'),
  paragraphs: z.array(z.unknown()).optional().describe('Paragraph breaks'),
  word_count: z.number().optional().describe('Total word count'),
  transcripts: z
    .array(TranscriptSchema)
    .optional()
    .describe('Transcript segments'),
  creator_name: z.string().optional().describe('Creator display name'),
  processing_status: z.string().optional().describe('Transcription status'),
  speech_length_sec: z.number().optional().describe('Length in seconds'),
});

export const listRecordingsSchema = {
  name: 'listRecordings',
  description: 'List recordings (home feed)',
  notes:
    'Returns paginated list. Check end_of_list to determine if more results exist.',
  input: z.object({
    csrf: CsrfParam,
    page_size: z
      .number()
      .optional()
      .default(50)
      .describe('Results per page (default: 50)'),
    funnel: z
      .string()
      .optional()
      .default('home_feed')
      .describe('Feed type (default: home_feed)'),
    source: z.string().optional().default('home').describe('Source context'),
  }),
  output: z.object({
    speeches: z.array(RecordingSchema).describe('List of recordings'),
    end_of_list: z.boolean().describe('Whether more results exist'),
  }),
};

export const getRecordingSchema = {
  name: 'getRecording',
  description: 'Get recording details and transcript',
  notes: 'Returns full transcript with speaker segments and metadata.',
  input: z.object({
    csrf: CsrfParam,
    otid: z.string().describe('Recording ID'),
    userid: z.number().optional().describe('User ID (optional)'),
  }),
  output: z.object({
    speech: RecordingDetailSchema.describe('Full recording details'),
    status: z.string().describe('Response status'),
  }),
};

// ============================================================================
// Speakers
// ============================================================================

export const SpeakerSchema = z.object({
  speaker_id: z.string().describe('Speaker identifier'),
  speaker_name: z.string().describe('Speaker display name'),
  is_identified: z.boolean().describe('Whether speaker is identified'),
});

export const getSpeakersSchema = {
  name: 'getSpeakers',
  description: 'Get speakers for a recording',
  notes:
    'Returns speaker list with identification status for each participant.',
  input: z.object({
    csrf: CsrfParam,
    otid: z.string().describe('Recording ID'),
    user_id: z.number().optional().describe('User ID (optional)'),
  }),
  output: z.object({
    speakers: z.array(SpeakerSchema).describe('List of speakers'),
  }),
};

// ============================================================================
// AI Features
// ============================================================================

export const OutlineItemSchema = z.object({
  text: z.string().describe('Outline item text'),
  title: z.string().describe('Outline item title'),
  children: z
    .array(
      z.object({
        text: z.string().optional(),
        title: z.string().optional(),
      }),
    )
    .optional()
    .describe('Nested outline items'),
});

export const ActionItemSchema = z.object({
  id: z.number().optional().describe('Action item ID'),
  text: z.string().optional().describe('Action item text'),
  uuid: z.string().optional().describe('Action item UUID'),
  completed: z.boolean().optional().describe('Whether completed'),
  assignee: z
    .object({
      id: z.number().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
    })
    .nullable()
    .optional()
    .describe('Assigned user'),
  creator: z
    .object({
      id: z.number().optional(),
      name: z.string().optional(),
    })
    .nullable()
    .optional()
    .describe('Creator of the action item'),
  order: z.number().optional().describe('Display order'),
  speech_otid: z.string().optional().describe('Parent recording OTID'),
  start_msec: z
    .number()
    .optional()
    .describe('Start position in recording (ms)'),
  created_at: z.string().optional().describe('Creation timestamp'),
  last_modified_at: z.string().optional().describe('Last modified timestamp'),
});

export const getAbstractSummarySchema = {
  name: 'getAbstractSummary',
  description: 'Get AI-generated summary for a recording',
  notes: 'May take time if summary not yet generated.',
  input: z.object({
    csrf: CsrfParam,
    otid: z.string().describe('Recording ID'),
  }),
  output: z.object({
    status: z.string().describe('Response status'),
    outline: z
      .array(OutlineItemSchema)
      .optional()
      .describe('Structured outline'),
    process_status: z.string().optional().describe('Processing status'),
    abstract_summary: z
      .object({
        items: z.array(z.unknown()).optional(),
        status: z.string().optional(),
        short_summary: z.string().optional().describe('Brief summary'),
      })
      .optional()
      .describe('Abstract summary object'),
  }),
};

export const getActionItemsSchema = {
  name: 'getActionItems',
  description: 'Get action items for a recording',
  notes: 'Returns AI-extracted action items with assignees and due dates.',
  input: z.object({
    csrf: CsrfParam,
    otid: z.string().describe('Recording ID'),
  }),
  output: z.object({
    status: z.string().describe('Response status'),
    process_status: z.string().optional().describe('Processing status'),
    speech_action_items: z
      .array(ActionItemSchema)
      .describe('List of action items'),
  }),
};

// ============================================================================
// Search
// ============================================================================

export const SearchResultSchema = z.object({
  id: z.string().optional().describe('Result ID'),
  name: z.string().optional().describe('Result name'),
  type: z.string().optional().describe('Result type'),
  start_time: z.number().optional().describe('Start timestamp'),
});

export const AdvancedSearchResultSchema = z.object({
  _score: z.number().optional().describe('Relevance score'),
  speech_id: z.string().optional().describe('Recording speech ID'),
  speech_otid: z.string().optional().describe('Recording OTID'),
  title: z.string().optional().describe('Recording title'),
  matched_title: z.string().optional().describe('Title with match highlights'),
  duration: z.number().optional().describe('Duration in seconds'),
  start_time: z.number().optional().describe('Start timestamp (unix)'),
  folder: z
    .object({
      title: z.string().optional(),
    })
    .optional()
    .describe('Folder info'),
});

export const quickSearchSchema = {
  name: 'quickSearch',
  description: 'Quick search for recordings (autocomplete-style)',
  notes:
    'Searches recording titles and metadata (autocomplete-style). Prefer this over advancedSearch for finding recordings by name.',
  input: z.object({
    csrf: CsrfParam,
    search_string: z.string().describe('Search query'),
  }),
  output: z.object({
    status: z.string().describe('Response status'),
    folders: z.array(z.unknown()).describe('Matching folders'),
    channels: z.array(z.unknown()).describe('Matching channels'),
    conversations: z
      .array(SearchResultSchema)
      .describe('Matching conversations'),
  }),
};

export const advancedSearchSchema = {
  name: 'advancedSearch',
  description: 'Advanced full-text search with relevance scoring',
  notes:
    'Full-text search across transcript content. This is equivalent to the main search bar in Otter. Use quickSearch instead for title/metadata matching only.',
  input: z.object({
    csrf: CsrfParam,
    query: z.string().describe('Search query'),
    size: z
      .number()
      .optional()
      .default(500)
      .describe('Max results (default: 500)'),
    relevance: z
      .boolean()
      .optional()
      .default(true)
      .describe('Enable relevance scoring'),
    session_id: z.string().optional().describe('Session ID for tracking'),
  }),
  output: z.object({
    status: z.string().optional().describe('Response status'),
    hits: z
      .array(AdvancedSearchResultSchema)
      .describe('Matching recordings sorted by relevance'),
  }),
};

// ============================================================================
// Channels (Groups)
// ============================================================================

export const ChannelSchema = z.object({
  id: z.number().describe('Channel ID'),
  name: z.string().describe('Channel name'),
  is_public: z.boolean().optional().describe('Whether channel is public'),
  created_at: z.number().optional().describe('Creation timestamp'),
  is_deleted: z.boolean().optional().describe('Whether channel is deleted'),
  member_count: z.number().optional().describe('Number of members'),
  discoverability: z.string().optional().describe('Discoverability setting'),
  has_live_speech: z
    .boolean()
    .optional()
    .describe('Whether has live recording'),
  last_modified_at: z.number().optional().describe('Last modified timestamp'),
  latest_message_time: z
    .string()
    .optional()
    .describe('Latest message timestamp'),
});

export const ChannelMemberSchema = z.object({
  id: z.number().describe('Membership ID'),
  member: z
    .object({
      type: z.string().optional(),
      email: z.string().optional(),
      user_id: z.number().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      avatar_url: z.string().optional(),
    })
    .describe('Member details'),
  group_id: z.number().describe('Channel ID'),
  is_pending: z.boolean().optional().describe('Whether invite is pending'),
  has_autoshare_enabled: z.boolean().optional().describe('Auto-share setting'),
  from_external_workspace: z
    .boolean()
    .optional()
    .describe('External workspace member'),
});

export const listChannelsSchema = {
  name: 'listChannels',
  description: 'List all channels/groups',
  notes: 'Returns all channels the user has access to.',
  input: z.object({
    csrf: CsrfParam,
  }),
  output: z.object({
    groups: z.array(ChannelSchema).describe('List of channels'),
    status: z.string().describe('Response status'),
    last_load_ts: z.number().optional().describe('Last load timestamp'),
  }),
};

export const getChannelSchema = {
  name: 'getChannel',
  description: 'Get channel details',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    group_id: z.number().describe('Channel ID'),
  }),
  output: z.object({
    status: z.string().describe('Response status'),
    group: z
      .object({
        id: z.number().describe('Channel ID'),
        name: z.string().describe('Channel name'),
        created_at: z.string().optional().describe('Creation timestamp'),
        discoverability: z.string().optional().describe('private or public'),
        workspace_id: z.number().nullable().optional().describe('Workspace ID'),
        owner: z
          .object({
            id: z.number().optional(),
            name: z.string().optional(),
            email: z.string().optional(),
          })
          .optional()
          .describe('Channel owner'),
        can_delete: z.boolean().optional().describe('Can current user delete'),
        can_invite: z.boolean().optional().describe('Can current user invite'),
        can_post: z.boolean().optional().describe('Can current user post'),
      })
      .passthrough()
      .describe('Channel details'),
  }),
};

export const getChannelMembersSchema = {
  name: 'getChannelMembers',
  description: 'Get members of a channel',
  notes: 'Returns full member list with email and workspace affiliation.',
  input: z.object({
    csrf: CsrfParam,
    group_id: z.number().describe('Channel ID'),
  }),
  output: z.object({
    group: z.object({
      id: z.number().describe('Channel ID'),
      name: z.string().describe('Channel name'),
      members: z.array(ChannelMemberSchema).describe('Channel members'),
      has_non_workspace_members: z
        .boolean()
        .optional()
        .describe('Has external members'),
    }),
    status: z.string().describe('Response status'),
  }),
};

export const getChannelMessagesSchema = {
  name: 'getChannelMessages',
  description: 'Get recordings/messages in a channel',
  notes: '',
  input: z.object({
    csrf: CsrfParam,
    id: z.number().describe('Channel ID'),
    page_number: z.number().optional().default(1).describe('Page number'),
    include_deleted_msg: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include deleted'),
  }),
  output: z.object({
    meta: z
      .object({
        count: z.number().describe('Total message count'),
      })
      .describe('Response metadata'),
    data: z
      .array(z.unknown())
      .describe('Message/recording objects in channel (JSON:API format)'),
    links: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Pagination links'),
    included: z
      .array(z.unknown())
      .optional()
      .describe('Included related resources'),
  }),
};

export const markChannelVisitedSchema = {
  name: 'markChannelVisited',
  description: 'Mark channel as visited',
  notes: 'Updates last visited timestamp for the channel.',
  input: z.object({
    csrf: CsrfParam,
    group_id: z.number().describe('Channel ID'),
  }),
  output: z.void().describe('No return value on success'),
};

// ============================================================================
// Chat
// ============================================================================

export const ThreadScopeSchema = z
  .enum(['user_session', 'speech', 'group'])
  .describe(
    'user_session (global), speech (single recording), group (channel)',
  );

export const ChatContextRefSchema = z.object({
  title: z.string().optional().describe('Referenced recording title'),
  speech_id: z.string().optional().describe('Referenced recording ID'),
  timestamp: z.string().optional().describe('Timestamp in recording'),
});

export const ChatSessionSchema = z.object({
  thread_uuid: z.string().describe('Chat thread ID'),
  latest_message: z
    .object({
      text: z.string().optional().describe('Message text'),
      type: z.string().optional().describe('Message type'),
      finished: z.boolean().optional().describe('Whether response complete'),
      context_refs: z
        .array(ChatContextRefSchema)
        .optional()
        .describe('Referenced recordings'),
    })
    .optional()
    .describe('Latest message in thread'),
});

export const ChatMessageSchema = z.object({
  id: z.string().describe('Message ID'),
  role: z.string().describe('user or assistant'),
  blocks: z.array(z.unknown()).describe('Message content blocks'),
  created_at: z.string().optional().describe('Creation timestamp'),
  references: z
    .array(ChatContextRefSchema)
    .optional()
    .describe('Referenced recordings'),
});

export const getChatSessionsSchema = {
  name: 'getChatSessions',
  description: 'List recent chat sessions',
  notes: 'Returns chat history with latest message preview for each session.',
  input: z.object({
    csrf: CsrfParam,
    limit: z.number().optional().default(10).describe('Max sessions to return'),
  }),
  output: z.object({
    status: z.string().describe('Response status'),
    sessions: z.array(ChatSessionSchema).describe('Chat sessions'),
  }),
};

export const getChatMessageHistorySchema = {
  name: 'getChatMessageHistory',
  description: 'Get chat message history',
  notes:
    'Requires thread_uuid for user_session scope. Get thread_uuid from getChatSessions.',
  input: z.object({
    csrf: CsrfParam,
    thread_uuid: z
      .string()
      .optional()
      .describe('Chat thread UUID (required for user_session scope)'),
    thread_scope: z
      .string()
      .optional()
      .default('user_session')
      .describe('Thread scope: user_session, speech, or group'),
    page_size: z.number().optional().default(10).describe('Messages per page'),
  }),
  output: z.object({
    status: z.string().describe('Response status'),
    messages_history: z
      .object({
        total_count: z.number().optional().describe('Total message count'),
        last_load_message_uuid: z
          .string()
          .optional()
          .describe('UUID of last loaded message'),
        end_of_list: z
          .boolean()
          .optional()
          .describe('Whether all messages loaded'),
        messages: z.array(ChatMessageSchema).describe('Chat messages'),
      })
      .describe('Message history wrapper'),
  }),
};

export const postChatMessageSchema = {
  name: 'postChatMessage',
  description: 'Send a message to Otter AI chat',
  notes:
    'Sends user message and receives AI response. Use appropriate thread_scope for context.',
  input: z.object({
    csrf: CsrfParam,
    thread_uuid: z.string().describe('Chat thread ID'),
    thread_scope: ThreadScopeSchema.optional().default('user_session'),
    blocks: z.string().describe('JSON array of message blocks'),
    use_agentic_chat: z
      .boolean()
      .optional()
      .default(true)
      .describe('Enable agentic features'),
  }),
  output: z.object({
    uuid: z.string().optional().describe('Response UUID'),
    message_uuid: z.string().optional().describe('Message UUID'),
  }),
};

// ============================================================================
// Write Operations
// ============================================================================

export const renameRecordingSchema = {
  name: 'renameRecording',
  description: 'Rename a recording title',
  notes: 'Updates the recording title. Returns modification timestamp.',
  input: z.object({
    csrf: CsrfParam,
    otid: z.string().describe('Recording ID'),
    title: z.string().describe('New title'),
  }),
  output: z.object({
    status: z.string().describe('Response status'),
    modified_time: z.number().describe('Modification timestamp'),
  }),
};

export const deleteRecordingSchema = {
  name: 'deleteRecording',
  description: 'Permanently delete a recording',
  notes:
    'This is irreversible. The recording and its transcript will be permanently removed.',
  input: z.object({
    csrf: CsrfParam,
    otid: z.string().describe('Recording ID'),
  }),
  output: z.object({
    status: z.string().describe('Response status'),
    speech_ids: z.array(z.string()).describe('Deleted speech IDs'),
    otids: z.array(z.string()).describe('Deleted recording OTIDs'),
  }),
};

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  getContextSchema,
  getWorkspaceSchema,
  listRecordingsSchema,
  getRecordingSchema,
  getSpeakersSchema,
  getAbstractSummarySchema,
  getActionItemsSchema,
  quickSearchSchema,
  advancedSearchSchema,
  listChannelsSchema,
  getChannelSchema,
  getChannelMembersSchema,
  getChannelMessagesSchema,
  markChannelVisitedSchema,
  getChatSessionsSchema,
  getChatMessageHistorySchema,
  postChatMessageSchema,
  renameRecordingSchema,
  deleteRecordingSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

// Shared types
export type ThreadScopeType = z.infer<typeof ThreadScopeSchema>;

// Entity types
export type Recording = z.infer<typeof RecordingSchema>;
export type RecordingDetail = z.infer<typeof RecordingDetailSchema>;
export type Speaker = z.infer<typeof SpeakerSchema>;
export type OutlineItem = z.infer<typeof OutlineItemSchema>;
export type ActionItem = z.infer<typeof ActionItemSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type AdvancedSearchResult = z.infer<typeof AdvancedSearchResultSchema>;
export type Channel = z.infer<typeof ChannelSchema>;
export type ChannelMember = z.infer<typeof ChannelMemberSchema>;
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;
export type ChatSession = z.infer<typeof ChatSessionSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatContextRef = z.infer<typeof ChatContextRefSchema>;

// Input types
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetWorkspaceInput = z.infer<typeof getWorkspaceSchema.input>;
export type ListRecordingsInput = z.infer<typeof listRecordingsSchema.input>;
export type GetRecordingInput = z.infer<typeof getRecordingSchema.input>;
export type GetSpeakersInput = z.infer<typeof getSpeakersSchema.input>;
export type GetAbstractSummaryInput = z.infer<
  typeof getAbstractSummarySchema.input
>;
export type GetActionItemsInput = z.infer<typeof getActionItemsSchema.input>;
export type QuickSearchInput = z.infer<typeof quickSearchSchema.input>;
export type AdvancedSearchInput = z.infer<typeof advancedSearchSchema.input>;
export type ListChannelsInput = z.infer<typeof listChannelsSchema.input>;
export type GetChannelInput = z.infer<typeof getChannelSchema.input>;
export type GetChannelMembersInput = z.infer<
  typeof getChannelMembersSchema.input
>;
export type GetChannelMessagesInput = z.infer<
  typeof getChannelMessagesSchema.input
>;
export type MarkChannelVisitedInput = z.infer<
  typeof markChannelVisitedSchema.input
>;
export type GetChatSessionsInput = z.infer<typeof getChatSessionsSchema.input>;
export type GetChatMessageHistoryInput = z.infer<
  typeof getChatMessageHistorySchema.input
>;
export type PostChatMessageInput = z.infer<typeof postChatMessageSchema.input>;
export type RenameRecordingInput = z.infer<typeof renameRecordingSchema.input>;
export type DeleteRecordingInput = z.infer<typeof deleteRecordingSchema.input>;

// Output types
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type GetWorkspaceOutput = z.infer<typeof getWorkspaceSchema.output>;
export type ListRecordingsOutput = z.infer<typeof listRecordingsSchema.output>;
export type GetRecordingOutput = z.infer<typeof getRecordingSchema.output>;
export type GetSpeakersOutput = z.infer<typeof getSpeakersSchema.output>;
export type GetAbstractSummaryOutput = z.infer<
  typeof getAbstractSummarySchema.output
>;
export type GetActionItemsOutput = z.infer<typeof getActionItemsSchema.output>;
export type QuickSearchOutput = z.infer<typeof quickSearchSchema.output>;
export type AdvancedSearchOutput = z.infer<typeof advancedSearchSchema.output>;
export type ListChannelsOutput = z.infer<typeof listChannelsSchema.output>;
export type GetChannelOutput = z.infer<typeof getChannelSchema.output>;
export type GetChannelMembersOutput = z.infer<
  typeof getChannelMembersSchema.output
>;
export type GetChannelMessagesOutput = z.infer<
  typeof getChannelMessagesSchema.output
>;
export type GetChatSessionsOutput = z.infer<
  typeof getChatSessionsSchema.output
>;
export type GetChatMessageHistoryOutput = z.infer<
  typeof getChatMessageHistorySchema.output
>;
export type PostChatMessageOutput = z.infer<
  typeof postChatMessageSchema.output
>;
export type RenameRecordingOutput = z.infer<
  typeof renameRecordingSchema.output
>;
export type DeleteRecordingOutput = z.infer<
  typeof deleteRecordingSchema.output
>;
