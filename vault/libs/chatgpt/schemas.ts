import { z } from 'zod';
import { FileRefSchema } from '../files/schemas';

export const libraryDescription =
  'ChatGPT project export and data management via internal APIs';
export const libraryVisibility = 'chat' as const;

export const libraryIcon = '/icons/libs/chatgpt.png';
export const loginUrl = 'https://chatgpt.com';

export const libraryNotes = `
## Workflow

1. Attach an executor to a **visible** chatgpt.com tab (\`mode: "attached"\`). The tab must be the active tab in its Edge window — but Edge does NOT need to be the foreground OS window.
2. Call \`getContext()\` to get \`{ token, ... }\`. This also installs the sentinel token interceptor.
3. **If you intend to use \`createConversation\` or \`sendMessage\`**, seed sentinel tokens first (see "Sentinel Tokens" below). Skip for read-only operations like \`listConversations\`, \`listProjects\`, \`exportProject\`.
4. Call ChatGPT functions with \`token\`.

## Key Concepts

- **Projects (Gizmos)**: Custom ChatGPT instances with instructions, files, and conversations. IDs start with \`g-p-\`.
- **Files**: Uploaded documents attached to projects. Downloaded via signed URLs from Estuary CDN.
- **Conversations**: Chat threads organized as message trees. Use \`listAllConversations()\` for the full sidebar list, or \`listConversations()\` for project-specific conversations.
- **Memories**: Stored context that persists across conversations, can be project-specific or global.
- **Token**: Bearer JWT obtained from \`/api/auth/session\`. Required for all API calls.

## File Download Flow

Files are downloaded in two steps:
1. Get signed download URL via \`/backend-api/files/download/{id}\`
2. Fetch actual content from the signed URL (Estuary CDN)
Some files may return "no longer available" (404) if deleted from OpenAI's storage.

## Pagination

- **Projects and project conversations**: Cursor-based. Pass the returned \`cursor\` to the next call. \`null\` means no more results.
- **All conversations** (\`listAllConversations\`): Offset-based. Use \`offset\` and \`limit\` params.

## Export

\`exportProject()\` is the main export function. It:
1. Gets project details (name, instructions, tools)
2. Downloads all files to the user's device
3. Lists all conversations
4. Saves a manifest JSON with everything

Files that fail to download (e.g., expired/deleted) are reported with their error in the manifest.

## File Attachments

\`createConversation\` and \`sendMessage\` accept an optional \`fileRefs\` array of \`FileReference\` objects. The library reads the bytes via \`__vallum_files.read\`, uploads them through ChatGPT's file API (\`/backend-api/files\` → Azure signed PUT → \`/backend-api/files/process_upload_stream\`), and attaches the resulting \`library_file_id\` to the message body. Obtain refs from the files library (\`files.download({ url, filename })\`, \`files.load({ fileRef: "/absolute/path" })\`) or other tools that produce file refs.

The upload pipeline is MIME-routed: \`image/*\` uses \`use_case: "multimodal"\` with \`index_for_retrieval: false\` (vision input, no RAG indexing); other types use \`use_case: "my_files"\` with \`index_for_retrieval: true\` (document RAG). The protocol is identical on free and paid plans — image upload is NOT gated by plan. The \`process_upload_stream\` response is labelled \`text/event-stream\` but is actually NDJSON: bare JSON objects separated by single \`\\n\`, with the completion signal in the \`event\` field (e.g. \`"event":"file.processing.completed"\`).

## Sentinel Tokens (writes only)

\`createConversation\` and \`sendMessage\` need anti-bot tokens (Cloudflare Turnstile + fingerprint PoW) that ChatGPT only mints when the **UI itself** submits a message. Focus, typing, or programmatic API calls don't trigger the mint. So before the first write per tab session, the agent must seed tokens via the UI:

\`\`\`js
// 1. getContext (already done in step 2 of the workflow) — installs the interceptor
// 2. Drive a one-character UI submit:
const composer = document.querySelector('#prompt-textarea');
composer.focus();
document.execCommand('insertText', false, '.');
await new Promise(r => setTimeout(r, 300));
document.querySelector('[data-testid="send-button"]').click();
// 3. Wait for the URL to update to /c/{id} and for tokens to be captured
const seedConvId = await new Promise((resolve) => {
  const start = Date.now();
  const t = setInterval(() => {
    const m = location.href.match(/\\/c\\/([0-9a-fA-F-]+)/);
    if (m && window.__vallum_chatgpt_sentinel) { clearInterval(t); resolve(m[1]); }
    else if (Date.now() - start > 20000) { clearInterval(t); resolve(null); }
  }, 250);
});
// 4. Hide the seed conversation
if (seedConvId) await deleteConversation({ token, conversationId: seedConvId });
// 5. Now createConversation / sendMessage work for ~8 minutes.
\`\`\`

After 8 minutes idle, repeat the seed before the next write.

\`[SENTINEL_REQUIRED]\` is thrown when no fresh tokens are cached — recover by running the seed flow above. Tokens are valid for 540s with a 30s safety margin.
`;

// ============================================================================
// Shared Params
// ============================================================================

export const TokenParam = z.string().describe('Bearer token from getContext()');

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description: 'Get authentication token and user info from ChatGPT session',
  notes: 'Call FIRST before other ChatGPT operations.',
  input: z.object({
    timeoutMs: z
      .number()
      .optional()
      .default(10000)
      .describe('Max wait time in milliseconds (default: 10000)'),
  }),
  output: z.object({
    token: z.string().describe('Bearer token for API requests'),
    userId: z.string().describe('User ID'),
    userName: z.string().describe('User display name'),
    userEmail: z.string().describe('User email address'),
  }),
};

// ============================================================================
// Projects
// ============================================================================

export const ProjectSummarySchema = z.object({
  id: z.string().describe('Gizmo/project ID (e.g., g-p-...)'),
  name: z.string().describe('Project name'),
  description: z.string().describe('Project description'),
  createdAt: z.string().describe('Creation timestamp (ISO)'),
  updatedAt: z.string().describe('Last update timestamp (ISO)'),
});

export const ProjectFileSchema = z.object({
  id: z.string().describe('File ID (e.g., file-xxx)'),
  name: z.string().describe('Filename with extension'),
  mimeType: z
    .string()
    .describe('MIME type (e.g., text/plain, application/pdf)'),
  size: z.number().describe('File size in bytes'),
});

export const ProjectToolSchema = z.object({
  type: z.string().describe('Tool type (e.g., code_interpreter, retrieval)'),
  id: z.string().describe('Tool identifier'),
});

export const listProjectsSchema = {
  name: 'listProjects',
  description: 'List all ChatGPT projects the user has created',
  notes: '',
  input: z.object({
    token: TokenParam,
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from previous response'),
  }),
  output: z.object({
    projects: z.array(ProjectSummarySchema).describe('List of projects'),
    cursor: z
      .string()
      .nullable()
      .describe('Cursor for next page, null if no more results'),
  }),
};

export const getProjectSchema = {
  name: 'getProject',
  description:
    'Get full project details including instructions, files, and tools',
  notes: '',
  input: z.object({
    token: TokenParam,
    gizmoId: z.string().describe('Gizmo/project ID (e.g., g-p-...)'),
  }),
  output: z.object({
    id: z.string().describe('Gizmo/project ID'),
    name: z.string().describe('Project name'),
    description: z.string().describe('Project description'),
    instructions: z
      .string()
      .describe('Full system instructions/prompt for the project'),
    files: z.array(ProjectFileSchema).describe('Files attached to the project'),
    tools: z.array(ProjectToolSchema).describe('Tools enabled for the project'),
    createdAt: z.string().describe('Creation timestamp'),
    updatedAt: z.string().describe('Last update timestamp'),
    numInteractions: z.number().describe('Total conversation count'),
  }),
};

// ============================================================================
// Files
// ============================================================================

export const downloadFileSchema = {
  name: 'downloadFile',
  description:
    'Download a file from a ChatGPT project and save to the user device',
  notes:
    'Some files may return 404 if deleted from OpenAI storage. Always pass `filename` from getProject().files[].name; without it, some files save with raw file IDs as names.',
  input: z.object({
    token: TokenParam,
    fileId: z.string().describe('File ID from getProject files array'),
    gizmoId: z.string().describe('Gizmo/project ID that owns the file'),
    filename: z
      .string()
      .optional()
      .describe('Override filename for saving (default: original name)'),
  }),
  output: z.object({
    fileName: z.string().describe('Name of the saved file'),
    mimeType: z.string().describe('MIME type of the file'),
    size: z.number().describe('File size in bytes'),
    fileRef: FileRefSchema.optional().describe(
      'File reference (present when Northlight files API is available)',
    ),
  }),
};

export const getProjectFileContentSchema = {
  name: 'getProjectFileContent',
  description: 'Get the text content of a file from a ChatGPT project',
  notes:
    'Only works reliably for text-based files (text/*, application/json, etc). Binary files will be returned as garbled text.',
  input: z.object({
    token: TokenParam,
    fileId: z.string().describe('File ID from getProject files array'),
    gizmoId: z.string().describe('Gizmo/project ID that owns the file'),
  }),
  output: z.object({
    fileName: z.string().describe('Name of the file'),
    mimeType: z.string().describe('MIME type of the file'),
    content: z.string().describe('Text content of the file'),
  }),
};

// ============================================================================
// Conversations
// ============================================================================

export const ConversationSummarySchema = z.object({
  id: z.string().describe('Conversation ID (UUID)'),
  title: z.string().describe('Conversation title'),
  createTime: z.string().describe('Creation timestamp'),
  updateTime: z.string().describe('Last update timestamp'),
  isArchived: z.boolean().describe('Whether conversation is archived'),
});

export const MessageSchema = z.object({
  id: z.string().describe('Message ID'),
  role: z.string().describe('Message author role: user, assistant, or tool'),
  content: z.string().describe('Message text content'),
  createTime: z.string().describe('Creation timestamp'),
});

export const AllConversationSummarySchema = z.object({
  id: z.string().describe('Conversation ID (UUID)'),
  title: z.string().describe('Conversation title'),
  createTime: z.string().describe('Creation timestamp'),
  updateTime: z.string().describe('Last update timestamp'),
  isArchived: z.boolean().describe('Whether conversation is archived'),
  gizmoId: z
    .string()
    .nullable()
    .describe(
      'Project/GPT ID if conversation belongs to a project, null for regular conversations',
    ),
  snippet: z.string().describe('Preview snippet of the conversation'),
});

export const listAllConversationsSchema = {
  name: 'listAllConversations',
  description:
    'List all conversations across ChatGPT ordered by most recently updated. Returns the sidebar conversation list.',
  notes:
    'Does NOT require a project/gizmo ID. Returns all conversations including regular chats and project conversations. Use offset-based pagination.',
  input: z.object({
    token: TokenParam,
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Pagination offset (default: 0)'),
    limit: z
      .number()
      .optional()
      .default(28)
      .describe('Max conversations to return (default: 28)'),
  }),
  output: z.object({
    conversations: z
      .array(AllConversationSummarySchema)
      .describe('List of conversations'),
    total: z.number().describe('Total number of conversations'),
    hasMore: z
      .boolean()
      .describe('Whether more conversations exist beyond current page'),
  }),
};

export const listConversationsSchema = {
  name: 'listConversations',
  description: 'List conversations for a ChatGPT project',
  notes: '',
  input: z.object({
    token: TokenParam,
    gizmoId: z.string().describe('Gizmo/project ID'),
    cursor: z
      .string()
      .optional()
      .describe('Pagination cursor from previous response'),
    limit: z.number().optional().describe('Max conversations to return'),
  }),
  output: z.object({
    conversations: z
      .array(ConversationSummarySchema)
      .describe('List of conversations'),
    cursor: z
      .string()
      .nullable()
      .describe('Cursor for next page, null if no more results'),
  }),
};

export const getConversationSchema = {
  name: 'getConversation',
  description: 'Get full conversation content with all messages in order',
  notes:
    'Messages are extracted from the message tree and returned in chronological order. System messages are excluded.',
  input: z.object({
    token: TokenParam,
    conversationId: z.string().describe('Conversation ID (UUID)'),
  }),
  output: z.object({
    id: z.string().describe('Conversation ID'),
    title: z.string().describe('Conversation title'),
    createTime: z.string().describe('Creation timestamp'),
    updateTime: z.string().describe('Last update timestamp'),
    messages: z
      .array(MessageSchema)
      .describe('Messages in chronological order'),
  }),
};

export const getConversationBatchSchema = {
  name: 'getConversationBatch',
  description:
    'Get multiple conversations in parallel. More efficient than calling getConversation in a loop.',
  notes:
    'Uses Promise.allSettled internally. Failed conversations are returned with status "error" and an error message.',
  input: z.object({
    token: TokenParam,
    conversationIds: z
      .array(z.string())
      .describe('Array of conversation IDs to fetch'),
    concurrency: z
      .number()
      .optional()
      .describe('Max parallel requests (default 10)'),
  }),
  output: z.object({
    results: z
      .array(
        z.object({
          conversationId: z.string().describe('The requested conversation ID'),
          status: z.enum(['ok', 'error']).describe('Whether fetch succeeded'),
          conversation: getConversationSchema.output
            .optional()
            .describe('Conversation data (present when status is ok)'),
          error: z
            .string()
            .optional()
            .describe('Error message (present when status is error)'),
        }),
      )
      .describe('Results for each requested conversation'),
  }),
};

// ============================================================================
// Create Conversation
// ============================================================================

export const FileAttachmentRefSchema = FileRefSchema.describe(
  'FileRef ({ path, name, contentType, size }). Obtain from the files library save() or a tool that returns a file ref.',
);

export const createConversationSchema = {
  name: 'createConversation',
  description:
    "Send a message to ChatGPT by POSTing to the conversation API directly, optionally with file attachments. Streams the assistant's response and returns the conversation ID and full response text.",
  notes:
    "Requires sentinel tokens to be seeded first via the UI (see libraryNotes 'Sentinel Tokens'). Throws [SENTINEL_REQUIRED] if not. Uses whatever model the user has selected (localStorage; falls back to gpt-5-3). Blocks until generation finishes — can take 10-60s. The conversation is permanently saved to the user's account.",
  input: z.object({
    token: TokenParam,
    message: z.string().describe('The message to send'),
    fileRefs: z
      .array(FileAttachmentRefSchema)
      .optional()
      .describe('Files to attach to the message'),
  }),
  output: z.object({
    conversationId: z
      .string()
      .describe('Conversation ID (UUID) of the newly created conversation'),
    response: z.string().describe("Assistant's full response text"),
  }),
};

export const sendMessageSchema = {
  name: 'sendMessage',
  description:
    "Send a follow-up message in an existing ChatGPT conversation by POSTing to the conversation API directly, optionally with file attachments. Streams the assistant's response and returns the new response text.",
  notes:
    "Requires sentinel tokens to be seeded first via the UI (see libraryNotes 'Sentinel Tokens'). Throws [SENTINEL_REQUIRED] if not. Uses whatever model the user has selected (localStorage; falls back to gpt-5-3). Blocks until generation finishes — can take 10-60s.",
  input: z.object({
    token: TokenParam,
    conversationId: z
      .string()
      .describe('Conversation ID (UUID) of the existing conversation'),
    message: z.string().describe('The message to send'),
    fileRefs: z
      .array(FileAttachmentRefSchema)
      .optional()
      .describe('Files to attach to the message'),
  }),
  output: z.object({
    conversationId: z
      .string()
      .describe('Conversation ID (UUID) — same as input'),
    response: z.string().describe("Assistant's full response text"),
  }),
};

// ============================================================================
// Memories
// ============================================================================

export const MemorySchema = z.object({
  id: z.string().describe('Memory entry ID'),
  content: z.string().describe('Memory content text'),
  createdAt: z.string().describe('Creation timestamp'),
});

export const listMemoriesSchema = {
  name: 'listMemories',
  description: 'Get memories/context stored for a project or globally',
  notes:
    'Omit gizmoId to get global memories. Include gizmoId to get project-specific memories.',
  input: z.object({
    token: TokenParam,
    gizmoId: z
      .string()
      .optional()
      .describe('Gizmo/project ID to filter memories (omit for global)'),
  }),
  output: z.object({
    memories: z.array(MemorySchema).describe('List of memory entries'),
    maxTokens: z.number().describe('Maximum memory token limit'),
    usedTokens: z.number().describe('Currently used memory tokens'),
  }),
};

// ============================================================================
// Conversation Maintenance
// ============================================================================

export const deleteConversationSchema = {
  name: 'deleteConversation',
  description:
    'Hide a conversation from the sidebar (the same action ChatGPT performs when "deleting" a conversation).',
  notes:
    'Primary use: clean up the sentinel-seed conversation after harvesting tokens. Also works for any other conversation the user owns.',
  input: z.object({
    token: TokenParam,
    conversationId: z
      .string()
      .describe('Conversation ID (UUID) to hide from the sidebar'),
  }),
  output: z.object({
    success: z.boolean().describe('True if the server accepted the change'),
  }),
};

// ============================================================================
// Export
// ============================================================================

export const ExportFileStatusSchema = z.object({
  name: z.string().describe('Filename'),
  mimeType: z.string().describe('MIME type'),
  size: z.number().describe('File size in bytes'),
  path: z.string().optional().describe('Device path where file was saved'),
  status: z
    .string()
    .describe('Download status: "downloaded" or "failed: {error message}"'),
});

export const exportProjectSchema = {
  name: 'exportProject',
  description:
    'Export all data from a ChatGPT project: instructions, files, and conversation list. Downloads files to device and saves a manifest JSON.',
  notes:
    'This is the main export function. Downloads all project files to the user device and creates a JSON manifest with project metadata, file status, and conversation list. Files that fail to download are reported in the manifest.',
  input: z.object({
    token: TokenParam,
    gizmoId: z.string().describe('Gizmo/project ID to export'),
    includeConversations: z
      .boolean()
      .optional()
      .default(true)
      .describe('Include conversation list in export (default: true)'),
    includeFiles: z
      .boolean()
      .optional()
      .default(true)
      .describe('Download project files (default: true)'),
  }),
  output: z.object({
    projectName: z.string().describe('Name of the exported project'),
    filesDownloaded: z
      .number()
      .describe('Number of files successfully downloaded'),
    filesFailed: z.number().describe('Number of files that failed to download'),
    conversationsFound: z.number().describe('Number of conversations found'),
    manifestFilename: z.string().describe('Name of the manifest JSON file'),
    manifestFileRef: FileRefSchema.optional().describe(
      'File reference for manifest (when Northlight files API available)',
    ),
    manifestContent: z
      .string()
      .optional()
      .describe(
        'Manifest JSON content as string (when Northlight files API unavailable)',
      ),
    files: z.array(ExportFileStatusSchema).describe('Per-file download status'),
  }),
};

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  getContextSchema,
  listProjectsSchema,
  getProjectSchema,
  downloadFileSchema,
  getProjectFileContentSchema,
  listAllConversationsSchema,
  listConversationsSchema,
  getConversationSchema,
  getConversationBatchSchema,
  createConversationSchema,
  sendMessageSchema,
  deleteConversationSchema,
  listMemoriesSchema,
  exportProjectSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

// Entity types
export type ProjectFile = z.infer<typeof ProjectFileSchema>;
export type Conversation = z.infer<typeof ConversationSummarySchema>;

// Input types
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type ListProjectsInput = z.infer<typeof listProjectsSchema.input>;
export type GetProjectInput = z.infer<typeof getProjectSchema.input>;
export type DownloadFileInput = z.infer<typeof downloadFileSchema.input>;
export type GetProjectFileContentInput = z.infer<
  typeof getProjectFileContentSchema.input
>;
export type ListAllConversationsInput = z.infer<
  typeof listAllConversationsSchema.input
>;
export type ListConversationsInput = z.infer<
  typeof listConversationsSchema.input
>;
export type GetConversationInput = z.infer<typeof getConversationSchema.input>;
export type GetConversationBatchInput = z.infer<
  typeof getConversationBatchSchema.input
>;
export type ListMemoriesInput = z.infer<typeof listMemoriesSchema.input>;
export type ExportProjectInput = z.infer<typeof exportProjectSchema.input>;
export type CreateConversationInput = z.infer<
  typeof createConversationSchema.input
>;
export type SendMessageInput = z.infer<typeof sendMessageSchema.input>;

// Output types
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type ListProjectsOutput = z.infer<typeof listProjectsSchema.output>;
export type GetProjectOutput = z.infer<typeof getProjectSchema.output>;
export type DownloadFileOutput = z.infer<typeof downloadFileSchema.output>;
export type GetProjectFileContentOutput = z.infer<
  typeof getProjectFileContentSchema.output
>;
export type ListAllConversationsOutput = z.infer<
  typeof listAllConversationsSchema.output
>;
export type ListConversationsOutput = z.infer<
  typeof listConversationsSchema.output
>;
export type GetConversationOutput = z.infer<
  typeof getConversationSchema.output
>;
export type ListMemoriesOutput = z.infer<typeof listMemoriesSchema.output>;
export type ExportProjectOutput = z.infer<typeof exportProjectSchema.output>;
export type CreateConversationOutput = z.infer<
  typeof createConversationSchema.output
>;
export type SendMessageOutput = z.infer<typeof sendMessageSchema.output>;
export type GetConversationBatchOutput = z.infer<
  typeof getConversationBatchSchema.output
>;
