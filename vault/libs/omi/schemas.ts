import { z } from 'zod';

export const libraryDescription =
  'Omi AI conversation transcripts, memories, tasks, and chat';

export const libraryIcon = '/icons/libs/omi.png';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://app.omi.me/conversations\` in Chrome
2. Call \`getContext()\` to extract Firebase auth token from the page
3. Pass the returned \`token\` to all subsequent function calls

## Key Concepts

- **Conversations**: Recorded audio sessions with transcripts, AI-generated summaries, action items, and categorization
- **Memories**: Facts Omi extracts from conversations (people, preferences, projects, places)
- **Action Items**: Tasks extracted from conversations or created manually
- **Folders**: System-generated categories (Work, Personal, etc.) that organize conversations
- **People**: Recognized speakers identified across conversations
- **Chat**: AI assistant that can answer questions about your conversations and memories

## Pagination

- Conversations: offset-based (\`limit\` + \`offset\`)
- Memories: offset-based (\`limit\` + \`offset\`)
- Action items: offset-based (\`limit\` + \`offset\`)
- Search: page-based (\`page\` + \`perPage\`)

## Authentication

Firebase Bearer token extracted from the page. Token refreshes automatically.
`;

// ============================================================================
// Shared Schemas
// ============================================================================

const ActionItemSchema = z
  .object({
    description: z.string().describe('Action item text'),
    completed: z.boolean().describe('Whether the action item is done'),
    created_at: z.string().describe('ISO datetime when created'),
    updated_at: z
      .string()
      .nullable()
      .describe('ISO datetime when last updated'),
    due_at: z.string().nullable().describe('ISO datetime when due'),
    completed_at: z.string().nullable().describe('ISO datetime when completed'),
    conversation_id: z
      .string()
      .nullable()
      .describe('Associated conversation ID'),
    is_locked: z
      .boolean()
      .optional()
      .describe('Whether the action item is locked'),
    exported: z
      .boolean()
      .optional()
      .describe('Whether exported to external tool'),
    export_date: z
      .string()
      .nullable()
      .optional()
      .describe('ISO datetime when exported'),
    export_platform: z
      .string()
      .nullable()
      .optional()
      .describe('Platform exported to'),
    sort_order: z.number().optional().describe('Sort position'),
    indent_level: z.number().optional().describe('Nesting level for subtasks'),
  })
  .passthrough();

const StructuredDataSchema = z.object({
  title: z.string().describe('AI-generated conversation title'),
  overview: z.string().describe('AI-generated conversation summary'),
  emoji: z.string().describe('Emoji representing the conversation topic'),
  category: z.string().describe('Auto-categorized: work, personal, etc.'),
  action_items: z.array(ActionItemSchema).describe('Extracted action items'),
  events: z
    .array(z.record(z.string(), z.unknown()))
    .describe('Extracted calendar events'),
});

const TranscriptSegmentSchema = z
  .object({
    id: z.string().describe('Segment UUID'),
    text: z.string().describe('Transcribed text content'),
    speaker: z.string().describe('Speaker label (e.g., SPEAKER_0)'),
    speaker_id: z.number().describe('Numeric speaker identifier'),
    is_user: z.boolean().describe('Whether this is the device owner speaking'),
    person_id: z
      .string()
      .nullable()
      .describe('Matched person UUID if identified'),
    start: z.number().describe('Start time in seconds'),
    end: z.number().describe('End time in seconds'),
  })
  .passthrough();

const ConversationSummarySchema = z
  .object({
    id: z.string().describe('Conversation UUID'),
    created_at: z.string().describe('ISO datetime when created'),
    started_at: z.string().describe('ISO datetime when recording started'),
    finished_at: z.string().describe('ISO datetime when recording ended'),
    structured: StructuredDataSchema.describe(
      'AI-generated summary and metadata',
    ),
    source: z
      .string()
      .optional()
      .describe('Recording source: omi, desktop, web'),
    language: z
      .string()
      .optional()
      .describe('Detected language code (e.g., en)'),
    status: z
      .string()
      .optional()
      .describe('Processing status: processing, completed'),
    discarded: z.boolean().describe('Whether conversation was discarded'),
    starred: z.boolean().optional().describe('Whether conversation is starred'),
    folder_id: z.string().nullable().optional().describe('Folder UUID'),
    visibility: z
      .string()
      .optional()
      .describe('Visibility setting: private, public'),
    geolocation: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional()
      .describe('Location data with latitude, longitude, address, etc.'),
    is_locked: z
      .boolean()
      .optional()
      .describe('Whether conversation is locked'),
    data_protection_level: z
      .string()
      .optional()
      .describe('Data protection level'),
  })
  .passthrough();

const ConversationDetailSchema = ConversationSummarySchema.extend({
  transcript_segments: z
    .array(TranscriptSegmentSchema)
    .describe('Full transcript segments'),
  apps_results: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe('Results from Omi apps'),
});

const FolderSchema = z
  .object({
    id: z.string().describe('Folder UUID'),
    name: z.string().describe('Folder display name'),
    description: z.string().describe('Folder description'),
    color: z.string().describe('Hex color code'),
    icon: z.string().describe('Emoji icon'),
    conversation_count: z
      .number()
      .describe('Number of conversations in folder'),
    is_system: z.boolean().describe('Whether folder is system-generated'),
    is_default: z
      .boolean()
      .optional()
      .describe('Whether this is the default folder'),
    category_mapping: z
      .string()
      .optional()
      .describe('Auto-categorization mapping'),
    created_at: z.string().optional().describe('ISO datetime when created'),
    updated_at: z
      .string()
      .optional()
      .describe('ISO datetime when last updated'),
    order: z.number().optional().describe('Display order'),
  })
  .passthrough();

const MemorySchema = z
  .object({
    id: z.string().describe('Memory UUID'),
    content: z.string().describe('Memory text content'),
    category: z.string().describe('Memory category: system, user, etc.'),
    visibility: z.string().describe('Visibility: private, public'),
    tags: z.array(z.string()).describe('Topic tags'),
    headline: z.string().nullable().describe('Optional headline'),
    created_at: z.string().describe('ISO datetime when created'),
    updated_at: z.string().describe('ISO datetime when last updated'),
    conversation_id: z
      .string()
      .nullable()
      .optional()
      .describe('Source conversation UUID'),
    reviewed: z
      .boolean()
      .optional()
      .describe('Whether memory has been reviewed'),
    user_review: z
      .string()
      .nullable()
      .optional()
      .describe('User review status'),
    manually_added: z
      .boolean()
      .optional()
      .describe('Whether memory was manually created'),
    edited: z
      .boolean()
      .optional()
      .describe('Whether memory was edited by user'),
  })
  .passthrough();

const PersonSchema = z
  .object({
    id: z.string().describe('Person UUID'),
    name: z.string().describe('Person display name'),
    created_at: z.string().describe('ISO datetime when first identified'),
    updated_at: z.string().describe('ISO datetime when last updated'),
    speech_samples: z
      .array(z.string())
      .optional()
      .describe('Audio sample IDs for voice recognition'),
    speech_samples_version: z
      .number()
      .optional()
      .describe('Version of speech samples'),
  })
  .passthrough();

const ChatMessageSchema = z
  .object({
    id: z.string().describe('Message UUID'),
    text: z.string().describe('Message text content'),
    created_at: z.string().describe('ISO datetime when sent'),
    sender: z.enum(['human', 'ai']).describe('Who sent the message'),
    type: z.string().describe('Message type: text, etc.'),
    memories_id: z
      .array(z.string())
      .optional()
      .describe('Referenced memory UUIDs'),
    memories: z
      .array(z.record(z.string(), z.unknown()))
      .optional()
      .describe('Referenced memory objects'),
    from_external_integration: z
      .boolean()
      .optional()
      .describe('Whether from external integration'),
    chat_session_id: z.string().optional().describe('Chat session UUID'),
  })
  .passthrough();

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Extract Firebase auth token from the Omi web app - call FIRST before any other function',
  notes: 'Must be on app.omi.me.',
  input: z.object({}),
  output: z.object({
    token: z.string().describe('Firebase Bearer token for API calls'),
    uid: z.string().describe('Firebase user ID'),
    email: z.string().describe('User email address'),
  }),
};

// ============================================================================
// Conversations
// ============================================================================

export const listConversationsSchema = {
  name: 'listConversations',
  description:
    'List recorded conversations with pagination and optional filters',
  notes: '',
  input: z.object({
    token: z
      .string()
      .optional()
      .describe('Auth token from getContext(). Auto-resolved if omitted.'),
    limit: z
      .number()
      .optional()
      .default(20)
      .describe('Number of conversations to return (default: 20)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Offset for pagination (default: 0)'),
    folderId: z.string().optional().describe('Filter by folder UUID'),
    starred: z
      .boolean()
      .optional()
      .describe('Filter to starred conversations only'),
    startDate: z
      .string()
      .optional()
      .describe('Filter conversations after this ISO date'),
    endDate: z
      .string()
      .optional()
      .describe('Filter conversations before this ISO date'),
  }),
  output: z.object({
    conversations: z
      .array(ConversationSummarySchema)
      .describe('List of conversations'),
  }),
};

export const getConversationSchema = {
  name: 'getConversation',
  description:
    'Get a single conversation with full transcript, summary, and action items',
  notes: '',
  input: z.object({
    token: z
      .string()
      .optional()
      .describe('Auth token from getContext(). Auto-resolved if omitted.'),
    conversationId: z.string().describe('Conversation UUID'),
  }),
  output: ConversationDetailSchema,
};

export const searchConversationsSchema = {
  name: 'searchConversations',
  description:
    'Search conversations by keyword across transcripts and summaries',
  notes:
    'Search results return a subset of conversation fields (no transcript_segments, source, or status).',
  input: z.object({
    token: z
      .string()
      .optional()
      .describe('Auth token from getContext(). Auto-resolved if omitted.'),
    query: z.string().describe('Search query text'),
    page: z
      .number()
      .optional()
      .default(1)
      .describe('Page number (1-indexed, default: 1)'),
    perPage: z
      .number()
      .optional()
      .default(10)
      .describe('Results per page (default: 10)'),
    startDate: z
      .string()
      .optional()
      .describe('Filter conversations after this ISO date'),
    endDate: z
      .string()
      .optional()
      .describe('Filter conversations before this ISO date'),
  }),
  output: z.object({
    items: z
      .array(ConversationSummarySchema)
      .describe('Matching conversations'),
    totalPages: z.number().describe('Total number of pages'),
    currentPage: z.number().describe('Current page number'),
    perPage: z.number().describe('Results per page'),
  }),
};

// ============================================================================
// Memories
// ============================================================================

export const listMemoriesSchema = {
  name: 'listMemories',
  description: 'List facts and memories Omi has extracted from conversations',
  notes: '',
  input: z.object({
    token: z
      .string()
      .optional()
      .describe('Auth token from getContext(). Auto-resolved if omitted.'),
    limit: z
      .number()
      .optional()
      .default(25)
      .describe('Number of memories to return (default: 25)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Offset for pagination (default: 0)'),
  }),
  output: z.object({
    memories: z.array(MemorySchema).describe('List of memories'),
  }),
};

// ============================================================================
// Action Items (Tasks)
// ============================================================================

export const listActionItemsSchema = {
  name: 'listActionItems',
  description: 'List tasks and action items extracted from conversations',
  notes: '',
  input: z.object({
    token: z
      .string()
      .optional()
      .describe('Auth token from getContext(). Auto-resolved if omitted.'),
    limit: z
      .number()
      .optional()
      .default(100)
      .describe('Number of items to return (default: 100)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Offset for pagination (default: 0)'),
  }),
  output: z.object({
    actionItems: z
      .array(
        ActionItemSchema.extend({
          id: z.string().describe('Action item UUID'),
        }),
      )
      .describe('List of action items'),
  }),
};

// ============================================================================
// Folders
// ============================================================================

export const listFoldersSchema = {
  name: 'listFolders',
  description: 'List conversation folders (Work, Personal, etc.)',
  notes: '',
  input: z.object({
    token: z
      .string()
      .optional()
      .describe('Auth token from getContext(). Auto-resolved if omitted.'),
  }),
  output: z.object({
    folders: z.array(FolderSchema).describe('List of folders'),
  }),
};

// ============================================================================
// People
// ============================================================================

export const listPeopleSchema = {
  name: 'listPeople',
  description: 'List recognized speakers identified across conversations',
  notes: '',
  input: z.object({
    token: z
      .string()
      .optional()
      .describe('Auth token from getContext(). Auto-resolved if omitted.'),
  }),
  output: z.object({
    people: z.array(PersonSchema).describe('List of recognized people'),
  }),
};

// ============================================================================
// Chat
// ============================================================================

export const sendMessageSchema = {
  name: 'sendMessage',
  description:
    'Send a message to the Omi AI assistant and get a response about your conversations and memories',
  notes:
    'Returns the AI response as text. The AI has access to all your conversations, memories, and context.',
  input: z.object({
    token: z
      .string()
      .optional()
      .describe('Auth token from getContext(). Auto-resolved if omitted.'),
    text: z.string().describe('Message text to send to the AI'),
  }),
  output: z.object({
    response: z.string().describe('AI assistant response text'),
  }),
};

export const getMessagesSchema = {
  name: 'getMessages',
  description: 'Get chat message history with the Omi AI assistant',
  notes: '',
  input: z.object({
    token: z
      .string()
      .optional()
      .describe('Auth token from getContext(). Auto-resolved if omitted.'),
  }),
  output: z.object({
    messages: z.array(ChatMessageSchema).describe('Chat message history'),
  }),
};

// ============================================================================
// All Schemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  listConversationsSchema,
  getConversationSchema,
  searchConversationsSchema,
  listMemoriesSchema,
  listActionItemsSchema,
  listFoldersSchema,
  listPeopleSchema,
  sendMessageSchema,
  getMessagesSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

// Entity types
export type ActionItem = z.infer<typeof ActionItemSchema>;
export type StructuredData = z.infer<typeof StructuredDataSchema>;
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;
export type Folder = z.infer<typeof FolderSchema>;
export type Memory = z.infer<typeof MemorySchema>;
export type Person = z.infer<typeof PersonSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// Input types
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type ListConversationsInput = z.infer<
  typeof listConversationsSchema.input
>;
export type GetConversationInput = z.infer<typeof getConversationSchema.input>;
export type SearchConversationsInput = z.infer<
  typeof searchConversationsSchema.input
>;
export type ListMemoriesInput = z.infer<typeof listMemoriesSchema.input>;
export type ListActionItemsInput = z.infer<typeof listActionItemsSchema.input>;
export type ListFoldersInput = z.infer<typeof listFoldersSchema.input>;
export type ListPeopleInput = z.infer<typeof listPeopleSchema.input>;
export type SendMessageInput = z.infer<typeof sendMessageSchema.input>;
export type GetMessagesInput = z.infer<typeof getMessagesSchema.input>;

// Output types
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type ListConversationsOutput = z.infer<
  typeof listConversationsSchema.output
>;
export type GetConversationOutput = z.infer<
  typeof getConversationSchema.output
>;
export type SearchConversationsOutput = z.infer<
  typeof searchConversationsSchema.output
>;
export type ListMemoriesOutput = z.infer<typeof listMemoriesSchema.output>;
export type ListActionItemsOutput = z.infer<
  typeof listActionItemsSchema.output
>;
export type ListFoldersOutput = z.infer<typeof listFoldersSchema.output>;
export type ListPeopleOutput = z.infer<typeof listPeopleSchema.output>;
export type SendMessageOutput = z.infer<typeof sendMessageSchema.output>;
export type GetMessagesOutput = z.infer<typeof getMessagesSchema.output>;
