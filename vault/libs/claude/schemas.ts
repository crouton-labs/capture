import { z } from 'zod';

export const libraryDescription =
  'Claude.ai: read projects, docs, files, memory; create conversations and send messages with file attachments';
export const libraryVisibility = 'chat' as const;

export const libraryIcon = '/icons/libs/claude.ico';
export const loginUrl = 'https://claude.ai';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://claude.ai\`
2. Call \`getContext()\` to get \`{ orgId, userId, email, fullName }\`
3. Call functions with \`orgId\`

## Key Concepts

- **Organizations**: Each user belongs to an org. The \`orgId\` (UUID) is required for all API calls. Fetched from \`/api/bootstrap\` at session start.
- **Projects**: Containers for docs, files, conversations, and custom instructions. Each has a UUID.
- **Docs**: Text documents attached to a project (custom instructions, knowledge base).
- **Files**: Uploaded binary files (images, PDFs) attached to a project.
- **Conversations**: Chat threads within a project, paginated with offset-based pagination.
- **Memory**: A single text string of user preferences that persists across conversations.
- **Starter Projects**: Example projects created by Anthropic (\`is_starter_project: true\`). Usually not worth exporting.

## Auth

Cookie-based authentication via \`credentials: 'include'\`. No CSRF token needed.
All data endpoints live under \`claude.ai/api/\`.

## File Attachments

To send a file with a message, pass \`files: [{ path }]\` to \`createConversation\` or \`sendMessage\`. The file is uploaded into the conversation before completion runs. Pre-uploaded files can be reused by passing \`files: [{ fileId }]\`. Uploads are conversation-scoped: a conversation UUID is required, which is why \`createConversation\` handles create → upload → send in one call.

## Generated Output

Replies from \`sendMessage\` and \`createConversation\` include \`generatedFiles\` (files Claude wrote to its sandbox this turn, e.g., chart PNGs) and \`generatedSvgs\` (SVG widgets Claude rendered inline).

**Display first, save only with consent.** The library fetches each generated file as an inline preview but does NOT write to device:

1. Render \`generatedSvgs[].svg\` and each \`generatedFiles\` entry in the conversation — images via \`previewDataUrl\`, text/SVG/JSON via \`previewText\`. When \`previewOmitted\` is set (file too large or binary), show the filename / size / MIME metadata instead.
2. Ask the user whether to save each file to their device. Do not save without explicit consent.
3. If the user confirms, call \`downloadGeneratedFile\` with the file's \`sandboxPath\` to write it to disk. Only \`downloadGeneratedFile\` returns a populated \`fileRef\`.

## Pagination

Conversations use offset-based pagination: \`limit\` (page size) + \`offset\` (starting index).
Sessions use page-based: \`page\` + \`per_page\`.

## Valid URLs

| URL Pattern | Valid |
|-------------|-------|
| \`claude.ai/projects\` | Yes |
| \`claude.ai/project/{id}\` | Yes |
| \`claude.ai/settings\` | Yes |
| \`claude.ai/chat/{id}\` | Yes |
| \`claude.ai/login\` | No (not authenticated) |
`;

// ============================================================================
// Shared Params
// ============================================================================

export const OrgIdParam = z
  .string()
  .uuid()
  .describe('Organization ID from getContext()');

export const ProjectIdParam = z.string().uuid().describe('Project UUID');

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description: 'Get organization ID and user info from Claude.ai session',
  notes: 'Call FIRST before other Claude.ai operations.',
  input: z.object({
    timeoutMs: z
      .number()
      .optional()
      .default(10000)
      .describe('Max wait time in milliseconds (default: 10000)'),
  }),
  output: z.object({
    orgId: z.string().describe('Organization UUID for API requests'),
    userId: z.string().describe('User UUID'),
    email: z.string().describe('User email address'),
    fullName: z.string().describe('User display name'),
  }),
};

// ============================================================================
// Projects
// ============================================================================

export const ProjectSummarySchema = z.object({
  uuid: z.string().describe('Project UUID'),
  name: z.string().describe('Project name'),
  description: z.string().describe('Project description'),
  is_private: z.boolean().describe('Whether this is a private project'),
  is_starter_project: z
    .boolean()
    .describe('Whether this is an Anthropic example project'),
  created_at: z.string().describe('Creation timestamp (ISO)'),
  updated_at: z.string().describe('Last update timestamp (ISO)'),
  docs_count: z.number().describe('Number of text documents'),
  files_count: z.number().describe('Number of uploaded files'),
  archived_at: z
    .string()
    .nullable()
    .describe('Archival timestamp (ISO) or null if not archived'),
});

export const listProjectsSchema = {
  name: 'listProjects',
  description: 'List all projects in the Claude.ai organization',
  notes: '',
  input: z.object({
    orgId: OrgIdParam,
  }),
  output: z.object({
    projects: z.array(ProjectSummarySchema).describe('List of projects'),
  }),
};

export const getProjectSchema = {
  name: 'getProject',
  description: 'Get full details for a single project',
  notes: '',
  input: z.object({
    orgId: OrgIdParam,
    projectId: ProjectIdParam,
  }),
  output: z.object({
    uuid: z.string().describe('Project UUID'),
    name: z.string().describe('Project name'),
    description: z.string().describe('Project description'),
    is_private: z.boolean().describe('Whether this is a private project'),
    is_starter_project: z
      .boolean()
      .describe('Whether this is an Anthropic example project'),
    prompt_template: z
      .string()
      .describe('Custom instructions/prompt for the project'),
    created_at: z.string().describe('Creation timestamp'),
    updated_at: z.string().describe('Last update timestamp'),
    creator: z
      .object({
        uuid: z.string(),
        full_name: z.string(),
      })
      .describe('Creator info'),
    docs_count: z.number().describe('Number of text documents'),
    files_count: z.number().describe('Number of uploaded files'),
    permissions: z
      .array(z.string())
      .describe('User permissions on this project'),
  }),
};

// ============================================================================
// Project Docs
// ============================================================================

export const ProjectDocSchema = z.object({
  uuid: z.string().describe('Document UUID'),
  file_name: z.string().describe('Document filename'),
  content: z.string().describe('Full document text content'),
  content_length: z.number().describe('Character count of document content'),
  created_at: z.string().describe('Creation timestamp'),
});

export const ProjectDocDetailSchema = z.object({
  uuid: z.string().describe('Document UUID'),
  file_name: z.string().describe('Document filename'),
  content: z.string().describe('Full document text content'),
  created_at: z.string().describe('Creation timestamp'),
});

export const listProjectDocsSchema = {
  name: 'listProjectDocs',
  description:
    'List text documents in a project (custom instructions, knowledge base)',
  notes: '',
  input: z.object({
    orgId: OrgIdParam,
    projectId: ProjectIdParam,
  }),
  output: z.object({
    docs: z
      .array(ProjectDocSchema)
      .describe('Text documents attached to the project'),
  }),
};

export const getProjectDocSchema = {
  name: 'getProjectDoc',
  description: 'Get a single project document with its full text content',
  notes:
    'Use listProjectDocs() to get doc UUIDs and content_length first. Only fetch full content when needed to avoid loading large documents unnecessarily.',
  input: z.object({
    orgId: OrgIdParam,
    projectId: ProjectIdParam,
    docId: z.string().uuid().describe('Document UUID from listProjectDocs'),
  }),
  output: ProjectDocDetailSchema,
};

// ============================================================================
// Project Files
// ============================================================================

export const ProjectFileSchema = z.object({
  uuid: z.string().describe('File UUID'),
  file_name: z.string().describe('Filename with extension'),
  file_size: z.number().describe('File size in bytes'),
  file_type: z.string().describe('MIME type'),
  created_at: z.string().describe('Creation timestamp'),
});

export const listProjectFilesSchema = {
  name: 'listProjectFiles',
  description: 'List uploaded files (images, PDFs) in a project',
  notes: '',
  input: z.object({
    orgId: OrgIdParam,
    projectId: ProjectIdParam,
  }),
  output: z.object({
    files: z
      .array(ProjectFileSchema)
      .describe('Uploaded files attached to the project'),
  }),
};

// ============================================================================
// Attach File Input (for createConversation / sendMessage)
// ============================================================================

export const AttachFileSchema = z.object({
  fileId: z
    .string()
    .uuid()
    .optional()
    .describe(
      'UUID of a file already uploaded to this conversation (from uploadFileToConversation.fileId). Provide this OR path.',
    ),
  path: z
    .string()
    .optional()
    .describe(
      'Absolute device path to upload (from getFileContent().fileRef.path or any prior saveToDevice). Provide this OR fileId.',
    ),
  name: z
    .string()
    .optional()
    .describe(
      'Filename to send (default: basename of path). Ignored when fileId is provided.',
    ),
  contentType: z
    .string()
    .optional()
    .describe(
      'MIME type (default: inferred from extension). Ignored when fileId is provided.',
    ),
});

// ============================================================================
// File Content
// ============================================================================

export const DeviceFileRefSchema = z.object({
  path: z.string().describe('Absolute path on user device'),
  name: z.string().describe('Filename'),
  contentType: z.string().describe('MIME type'),
  size: z.number().describe('File size in bytes'),
});

export const getFileContentSchema = {
  name: 'getFileContent',
  description:
    'Download a file from a Claude.ai project and save to the user device',
  notes:
    'Pass `filename` from listProjectFiles().file_name for proper naming on disk. Without it, the file may be saved with its UUID.',
  input: z.object({
    orgId: OrgIdParam,
    fileId: z.string().describe('File UUID from listProjectFiles'),
    filename: z
      .string()
      .optional()
      .describe('Override filename for saving (default: original name)'),
  }),
  output: z.object({
    fileName: z.string().describe('Name of the saved file'),
    mimeType: z.string().describe('MIME type of the file'),
    size: z.number().describe('File size in bytes'),
    fileRef: DeviceFileRefSchema.optional().describe(
      'Device file reference (present when Northlight files API is available)',
    ),
  }),
};

// ============================================================================
// Conversations
// ============================================================================

export const ConversationSummarySchema = z.object({
  uuid: z.string().describe('Conversation UUID'),
  name: z.string().describe('Conversation title'),
  created_at: z.string().describe('Creation timestamp'),
  updated_at: z.string().describe('Last update timestamp'),
});

export const listProjectConversationsSchema = {
  name: 'listProjectConversations',
  description: 'List conversations in a project with pagination',
  notes: '',
  input: z.object({
    orgId: OrgIdParam,
    projectId: ProjectIdParam,
    limit: z
      .number()
      .optional()
      .default(30)
      .describe('Max conversations per page (default: 30)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Offset for pagination (default: 0)'),
  }),
  output: z.object({
    conversations: z
      .array(ConversationSummarySchema)
      .describe('List of conversations'),
    total: z.number().describe('Total number of conversations'),
    hasMore: z.boolean().describe('Whether more conversations are available'),
  }),
};

// ============================================================================
// Conversations (All)
// ============================================================================

export const ConversationListItemSchema = z.object({
  uuid: z.string().describe('Conversation UUID'),
  name: z.string().describe('Conversation title'),
  model: z
    .string()
    .describe('Model used (e.g., "claude-opus-4-6", "claude-sonnet-4-6")'),
  created_at: z.string().describe('Creation timestamp (ISO)'),
  updated_at: z.string().describe('Last update timestamp (ISO)'),
  project_uuid: z
    .string()
    .describe('Project UUID this conversation belongs to (empty if none)'),
});

export const listConversationsSchema = {
  name: 'listConversations',
  description:
    'List all conversations in the organization, not limited to a specific project',
  notes:
    'Returns all conversations across all projects. Use listProjectConversations to filter by project.',
  input: z.object({
    orgId: OrgIdParam,
    limit: z
      .number()
      .optional()
      .default(50)
      .describe('Max conversations to return (default: 50)'),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Offset for pagination (default: 0)'),
  }),
  output: z.object({
    conversations: z
      .array(ConversationListItemSchema)
      .describe('List of conversations'),
    total: z.number().describe('Total number of conversations'),
    hasMore: z.boolean().describe('Whether more conversations are available'),
  }),
};

export const MessageContentBlockSchema = z.object({
  type: z
    .string()
    .describe('Content block type: "text", "tool_use", "tool_result"'),
  text: z
    .string()
    .optional()
    .describe('Text content (present for type="text")'),
});

export const ChatMessageSchema = z.object({
  uuid: z.string().describe('Message UUID'),
  role: z.string().nullable().describe('Message role: "human" or "assistant"'),
  parent_uuid: z
    .string()
    .nullable()
    .describe('Parent message UUID for threading'),
  created_at: z.string().describe('Creation timestamp (ISO)'),
  updated_at: z.string().describe('Last update timestamp (ISO)'),
  content: z
    .array(MessageContentBlockSchema)
    .describe('Array of content blocks'),
});

export const getConversationSchema = {
  name: 'getConversation',
  description: 'Get a single conversation with all its messages and content',
  notes:
    'Returns the full conversation tree. Messages are ordered chronologically. Each message has an array of content blocks (text, tool_use, etc.).',
  input: z.object({
    orgId: OrgIdParam,
    conversationId: z.string().uuid().describe('Conversation UUID'),
  }),
  output: z.object({
    uuid: z.string().describe('Conversation UUID'),
    name: z.string().describe('Conversation title'),
    model: z.string().describe('Model used'),
    summary: z.string().describe('Conversation summary (may be empty)'),
    created_at: z.string().describe('Creation timestamp (ISO)'),
    updated_at: z.string().describe('Last update timestamp (ISO)'),
    project_uuid: z.string().describe('Project UUID (empty if none)'),
    messages: z
      .array(ChatMessageSchema)
      .describe('All messages in the conversation'),
  }),
};

export const getConversationBatchSchema = {
  name: 'getConversationBatch',
  description:
    'Get multiple conversations in parallel. More efficient than calling getConversation in a loop.',
  notes:
    'Uses Promise.allSettled internally. Failed conversations are returned with status "error" and an error message.',
  input: z.object({
    orgId: OrgIdParam,
    conversationIds: z
      .array(z.string().uuid())
      .describe('Array of conversation UUIDs to fetch'),
    concurrency: z
      .number()
      .optional()
      .describe('Max parallel requests (default 10)'),
  }),
  output: z.object({
    results: z
      .array(
        z.object({
          conversationId: z
            .string()
            .describe('The requested conversation UUID'),
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
// Generated Output (files + SVGs Claude produced during a turn)
// ============================================================================

export const GeneratedFileSchema = z.object({
  name: z.string().describe('Filename as produced by Claude'),
  mimeType: z.string().describe('MIME type reported by Claude'),
  size: z
    .number()
    .describe('Bytes of the generated file (0 when the fetch failed)'),
  sandboxPath: z
    .string()
    .describe(
      'Path inside the Claude sandbox, e.g., /mnt/user-data/outputs/chart.png. Pass this to downloadGeneratedFile to save to device.',
    ),
  previewText: z
    .string()
    .optional()
    .describe(
      'Inline preview for textual files (text/*, application/json, application/xml, image/svg+xml). Display this in the conversation.',
    ),
  previewDataUrl: z
    .string()
    .optional()
    .describe(
      'Inline preview for images as a base64 data URL (e.g., data:image/png;base64,...). Render this in the conversation.',
    ),
  previewOmitted: z
    .string()
    .optional()
    .describe(
      'Reason the inline preview was omitted (file too large, or binary MIME type). When present, show the metadata and ask the user whether to save via downloadGeneratedFile.',
    ),
  fileRef: DeviceFileRefSchema.optional().describe(
    'Device file reference. Only populated by downloadGeneratedFile — never by sendMessage or createConversation.',
  ),
  error: z
    .string()
    .optional()
    .describe('Error message if the file could not be fetched'),
});

export const GeneratedSvgSchema = z.object({
  title: z.string().describe('Widget title supplied by Claude'),
  svg: z.string().describe('Raw SVG markup'),
});

export const downloadGeneratedFileSchema = {
  name: 'downloadGeneratedFile',
  description:
    'Save a file Claude produced in the conversation sandbox (e.g., a chart PNG generated during a reply) to the user device.',
  notes:
    'Only call this after the user has explicitly confirmed they want to save the file. sendMessage and createConversation do NOT auto-save — they return inline previews for display. Pass the sandboxPath from the generatedFiles entry.',
  input: z.object({
    orgId: OrgIdParam,
    conversationId: z.string().uuid().describe('Conversation UUID'),
    path: z
      .string()
      .describe(
        'Sandbox path from a local_resource block (e.g., /mnt/user-data/outputs/chart.png)',
      ),
    name: z
      .string()
      .optional()
      .describe('Filename to save as (default: basename of path)'),
  }),
  output: GeneratedFileSchema,
};

// ============================================================================
// Write: Create Conversation / Send Message
// ============================================================================

export const createConversationSchema = {
  name: 'createConversation',
  description:
    'Create a new Claude.ai conversation and send the first message. Blocks until Claude finishes responding, then returns the new conversation ID and assistant reply.',
  notes:
    'Uses Claude.ai internal completion API directly (no UI automation). Can be called from any page on claude.ai. Blocks until generation completes — typically 5-30 seconds. Pass files to attach documents/images to the first message. Any files Claude produces are returned as inline previews in generatedFiles — display them to the user and ask for consent before calling downloadGeneratedFile to save.',
  input: z.object({
    orgId: OrgIdParam,
    message: z.string().describe('The first user message to send'),
    files: z
      .array(AttachFileSchema)
      .optional()
      .describe(
        'Files to attach to the first message. Each item is { fileId } for an already-uploaded file or { path } to upload from device.',
      ),
  }),
  output: z.object({
    conversationId: z
      .string()
      .describe('UUID of the newly created conversation'),
    response: z.string().describe("Assistant's full response text"),
    generatedFiles: z
      .array(GeneratedFileSchema)
      .describe(
        'Files Claude produced in the sandbox during this turn (e.g., generated charts). Each entry carries an inline preview (previewText or previewDataUrl) for display; the library does NOT save them to device. Ask the user before calling downloadGeneratedFile.',
      ),
    generatedSvgs: z
      .array(GeneratedSvgSchema)
      .describe(
        'Inline SVG widgets Claude rendered during this turn (extracted from show_widget tool calls).',
      ),
  }),
};

export const sendMessageSchema = {
  name: 'sendMessage',
  description:
    'Send a follow-up message in an existing Claude.ai conversation. Blocks until Claude finishes responding, then returns the new assistant reply.',
  notes:
    'Uses Claude.ai internal completion API directly (no UI automation). Automatically resolves the parent message for threading by reading the current conversation state — caller does not need to pass it. Blocks until generation completes — typically 5-30 seconds. Pass files to attach documents/images to this turn. Any files Claude produces are returned as inline previews in generatedFiles — display them to the user and ask for consent before calling downloadGeneratedFile to save.',
  input: z.object({
    orgId: OrgIdParam,
    conversationId: z.string().uuid().describe('Existing conversation UUID'),
    message: z.string().describe('The message to send'),
    files: z
      .array(AttachFileSchema)
      .optional()
      .describe(
        'Files to attach to this message. Each item is { fileId } for an already-uploaded file or { path } to upload from device.',
      ),
  }),
  output: z.object({
    conversationId: z.string().describe('Conversation UUID (same as input)'),
    response: z.string().describe("Assistant's full response text"),
    generatedFiles: z
      .array(GeneratedFileSchema)
      .describe(
        'Files Claude produced in the sandbox during this turn (e.g., generated charts). Each entry carries an inline preview (previewText or previewDataUrl) for display; the library does NOT save them to device. Ask the user before calling downloadGeneratedFile.',
      ),
    generatedSvgs: z
      .array(GeneratedSvgSchema)
      .describe(
        'Inline SVG widgets Claude rendered during this turn (extracted from show_widget tool calls).',
      ),
  }),
};

// ============================================================================
// Upload File (conversation-scoped)
// ============================================================================

export const uploadFileToConversationSchema = {
  name: 'uploadFileToConversation',
  description:
    'Upload a local file into an existing Claude.ai conversation. Returns a fileId that can be attached to subsequent messages.',
  notes:
    'Uploads are conversation-scoped, so conversationId is required. Most callers do not need to call this directly — pass { path } in the files array of createConversation or sendMessage and the upload happens automatically. Use this function only when you want to pre-upload and reuse a fileId across multiple sends.',
  input: z.object({
    orgId: OrgIdParam,
    conversationId: z.string().uuid().describe('Existing conversation UUID'),
    path: z
      .string()
      .describe(
        'Absolute device path to the file (from getFileContent().fileRef.path or any prior saveToDevice)',
      ),
    name: z
      .string()
      .optional()
      .describe('Filename to send (default: basename of path)'),
    contentType: z
      .string()
      .optional()
      .describe('MIME type (default: inferred from extension)'),
  }),
  output: z.object({
    fileId: z
      .string()
      .describe('UUID of the uploaded file — pass to sendMessage files'),
    fileName: z.string().describe('Original filename as sent'),
    sanitizedName: z.string().describe('Filename as stored in the sandbox'),
    fileKind: z
      .string()
      .describe('Claude file classification (e.g., "document", "image")'),
    sizeBytes: z.number().describe('Uploaded file size in bytes'),
    sandboxPath: z
      .string()
      .describe(
        'Path within the Claude sandbox (e.g., /mnt/user-data/uploads/foo.pdf)',
      ),
    pageCount: z.number().optional().describe('Page count for PDF documents'),
  }),
};

// ============================================================================
// Project Members
// ============================================================================

export const ProjectMemberSchema = z.object({
  uuid: z.string().describe('User UUID'),
  full_name: z.string().describe('User display name'),
  email_address: z.string().describe('User email address'),
  role: z.string().describe('Role in the project (e.g., "user")'),
});

export const getProjectMembersSchema = {
  name: 'getProjectMembers',
  description: 'List members who have access to a project',
  notes: '',
  input: z.object({
    orgId: OrgIdParam,
    projectId: ProjectIdParam,
  }),
  output: z.object({
    members: z.array(ProjectMemberSchema).describe('Project members'),
  }),
};

// ============================================================================
// Memory
// ============================================================================

export const getMemorySchema = {
  name: 'getMemory',
  description:
    'Get memory text stored by Claude. Returns global memory by default, or project-scoped memory when projectId is provided. Project memory is auto-generated from past chats and structured with sections (Purpose & context, Current state, etc.)',
  notes:
    'Same endpoint, different scope: omit projectId for global memory, include it for project memory. Controls array contains user-pinned memory edits.',
  input: z.object({
    orgId: OrgIdParam,
    projectId: z
      .string()
      .uuid()
      .optional()
      .describe(
        'Project UUID. When provided, returns project-scoped memory instead of global memory.',
      ),
  }),
  output: z.object({
    memory: z.string().describe('Memory text content (may be empty string)'),
    controls: z
      .array(z.string())
      .describe(
        'User-pinned memory edits: things the user explicitly told Claude to remember or forget',
      ),
    updated_at: z
      .string()
      .nullable()
      .describe('Last update timestamp or null if never set'),
  }),
};

// ============================================================================
// Skills
// ============================================================================

export const SkillSchema = z.object({
  id: z.string().describe('Skill identifier'),
  name: z.string().describe('Skill display name'),
  description: z.string().describe('Skill description'),
  creator_type: z
    .string()
    .describe('Who created the skill (e.g., "anthropic")'),
  enabled: z.boolean().describe('Whether the skill is enabled'),
  is_public_provisioned: z.boolean().describe('Whether publicly provisioned'),
});

export const listSkillsSchema = {
  name: 'listSkills',
  description: 'List available Claude skills for the organization',
  notes: '',
  input: z.object({
    orgId: OrgIdParam,
  }),
  output: z.object({
    skills: z.array(SkillSchema).describe('Available skills'),
  }),
};

// ============================================================================
// Feature Settings
// ============================================================================

export const ForcedSettingSchema = z.object({
  feature: z.string().describe('Feature name'),
  forced_state: z.boolean().describe('Whether the feature is forced on or off'),
});

export const getFeatureSettingsSchema = {
  name: 'getFeatureSettings',
  description: 'Get feature flags and forced settings for the organization',
  notes: '',
  input: z.object({
    orgId: OrgIdParam,
  }),
  output: z.object({
    disabled_features: z
      .array(z.string())
      .describe('List of disabled feature names'),
    forced_settings: z
      .array(ForcedSettingSchema)
      .describe('Features with forced on/off state'),
  }),
};

// ============================================================================
// Sync Settings
// ============================================================================

export const SyncSettingSchema = z.object({
  type: z.string().describe('Integration type (gcal, gdrive, github, gmail)'),
  enabled: z.boolean().describe('Whether the integration is enabled'),
  config: z.unknown().nullable().describe('Integration-specific configuration'),
});

export const getSyncSettingsSchema = {
  name: 'getSyncSettings',
  description: 'Get integration settings (Gmail, Calendar, Drive, GitHub)',
  notes: '',
  input: z.object({
    orgId: OrgIdParam,
  }),
  output: z.object({
    integrations: z.array(SyncSettingSchema).describe('Integration settings'),
  }),
};

// ============================================================================
// Active Sessions
// ============================================================================

export const SessionUserAgentSchema = z.object({
  browser_family: z
    .string()
    .describe('Browser name (e.g., "Chrome", "Electron")'),
  browser_version: z.string().describe('Browser version'),
  os_family: z.string().describe('OS name (e.g., "Mac OS X")'),
  os_version: z.string().describe('OS version'),
  device_family: z.string().describe('Device type (e.g., "Mac")'),
});

export const SessionLocationSchema = z.object({
  country: z.string().describe('Country code (e.g., "US")'),
  region: z.string().describe('Region/state (e.g., "California")'),
  city: z.string().describe('City name'),
});

export const SessionSchema = z.object({
  created_at: z.string().describe('Session creation timestamp'),
  updated_at: z.string().describe('Last update timestamp'),
  expires_at: z.string().describe('Session expiration timestamp'),
  user_agent: SessionUserAgentSchema.describe('Parsed user agent info'),
  location_info: SessionLocationSchema.describe('Session location'),
  is_current: z.boolean().describe('Whether this is the current session'),
});

export const listActiveSessionsSchema = {
  name: 'listActiveSessions',
  description: 'List active login sessions for the current user',
  notes: '',
  input: z.object({}),
  output: z.object({
    sessions: z.array(SessionSchema).describe('Active sessions'),
    total: z.number().describe('Total number of sessions'),
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
    'Export all data from a Claude.ai project: instructions, docs, files, and conversation list. Downloads files to device and saves a manifest JSON.',
  notes:
    'This is the main export function. Downloads all project files to the user device and creates a JSON manifest with project metadata, docs, file status, and conversation list.',
  input: z.object({
    orgId: OrgIdParam,
    projectId: ProjectIdParam,
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
    docsFound: z.number().describe('Number of text documents found'),
    filesDownloaded: z
      .number()
      .describe('Number of files successfully downloaded'),
    filesFailed: z.number().describe('Number of files that failed to download'),
    conversationsFound: z.number().describe('Number of conversations found'),
    manifestFilename: z.string().describe('Name of the manifest JSON file'),
    manifestFileRef: DeviceFileRefSchema.optional().describe(
      'Device file reference for manifest (when Northlight files API available)',
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
  listProjectDocsSchema,
  getProjectDocSchema,
  listProjectFilesSchema,
  getFileContentSchema,
  listConversationsSchema,
  listProjectConversationsSchema,
  getConversationSchema,
  getConversationBatchSchema,
  createConversationSchema,
  sendMessageSchema,
  uploadFileToConversationSchema,
  downloadGeneratedFileSchema,
  getProjectMembersSchema,
  getMemorySchema,
  listSkillsSchema,
  getFeatureSettingsSchema,
  getSyncSettingsSchema,
  listActiveSessionsSchema,
  exportProjectSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

// Entity types
export type ProjectFile = z.infer<typeof ProjectFileSchema>;
export type ProjectDoc = z.infer<typeof ProjectDocSchema>;
export type Conversation = z.infer<typeof ConversationSummarySchema>;

// Output types
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type ListProjectsOutput = z.infer<typeof listProjectsSchema.output>;
export type GetProjectOutput = z.infer<typeof getProjectSchema.output>;
export type ListProjectDocsOutput = z.infer<
  typeof listProjectDocsSchema.output
>;
export type GetProjectDocOutput = z.infer<typeof getProjectDocSchema.output>;
export type ListProjectFilesOutput = z.infer<
  typeof listProjectFilesSchema.output
>;
export type GetFileContentOutput = z.infer<typeof getFileContentSchema.output>;
export type ListProjectConversationsOutput = z.infer<
  typeof listProjectConversationsSchema.output
>;
export type GetProjectMembersOutput = z.infer<
  typeof getProjectMembersSchema.output
>;
export type GetMemoryOutput = z.infer<typeof getMemorySchema.output>;
export type ListSkillsOutput = z.infer<typeof listSkillsSchema.output>;
export type GetFeatureSettingsOutput = z.infer<
  typeof getFeatureSettingsSchema.output
>;
export type GetSyncSettingsOutput = z.infer<
  typeof getSyncSettingsSchema.output
>;
export type ListActiveSessionsOutput = z.infer<
  typeof listActiveSessionsSchema.output
>;
export type ListConversationsOutput = z.infer<
  typeof listConversationsSchema.output
>;
export type GetConversationOutput = z.infer<
  typeof getConversationSchema.output
>;
export type GetConversationBatchOutput = z.infer<
  typeof getConversationBatchSchema.output
>;
export type CreateConversationInput = z.infer<
  typeof createConversationSchema.input
>;
export type CreateConversationOutput = z.infer<
  typeof createConversationSchema.output
>;
export type SendMessageInput = z.infer<typeof sendMessageSchema.input>;
export type SendMessageOutput = z.infer<typeof sendMessageSchema.output>;
export type AttachFile = z.infer<typeof AttachFileSchema>;
export type UploadFileToConversationInput = z.infer<
  typeof uploadFileToConversationSchema.input
>;
export type UploadFileToConversationOutput = z.infer<
  typeof uploadFileToConversationSchema.output
>;
export type GeneratedFile = z.infer<typeof GeneratedFileSchema>;
export type GeneratedSvg = z.infer<typeof GeneratedSvgSchema>;
export type DownloadGeneratedFileInput = z.infer<
  typeof downloadGeneratedFileSchema.input
>;
export type DownloadGeneratedFileOutput = z.infer<
  typeof downloadGeneratedFileSchema.output
>;
export type ExportProjectOutput = z.infer<typeof exportProjectSchema.output>;
