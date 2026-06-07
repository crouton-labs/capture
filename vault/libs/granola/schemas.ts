import { z } from 'zod';

export const libraryDescription =
  'Granola meeting notes operations via cookie-based API';

export const libraryIcon = '/icons/libs/granola.png';

export const libraryNotes = `
## Workflow

1. Create an attached executor: \`createExecutor({ app: "granola", mode: "attached", targetPattern: "file://.*Granola\\.app" })\`. If it fails, retry once (CDP detection can take a moment after app launch). Do NOT double-escape backslashes in the targetPattern.
2. Call \`getContext()\` to verify Granola context and get user ID
3. Call Granola functions (authenticated via cookies)

## Key Concepts

- **Documents**: Meeting notes with metadata, panels (sections), and transcripts
- **Panels**: Content sections containing HTML-formatted meeting notes
- **Transcripts**: Time-stamped audio segments from microphone or system audio
- **Folders**: Collections of documents with sharing and organization features
- **Sharing**: Documents can be private, workspace-visible, or shareable via link
- **Workspaces**: Collaborative spaces for teams
- **AI Chat**: Interact with AI about documents using streaming API

## Authentication

All API calls use cookie-based authentication (credentials: 'include').
No CSRF token required.

## API Endpoints

- Base API: https://api.granola.ai
- Streaming API: https://stream.api.granola.ai
`;

// ============================================================================
// Shared Params
// ============================================================================

export const DocumentIdParam = z.string().uuid().describe('Document UUID');

export const FolderIdParam = z.string().uuid().describe('Folder UUID');

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description: 'Verify Granola context and get current user ID',
  notes: 'Call FIRST before other Granola operations.',
  input: z.object({
    timeoutMs: z
      .number()
      .optional()
      .default(10000)
      .describe('Max wait time in milliseconds (default: 10000)'),
  }),
  output: z.object({
    userId: z.string().describe('Current user ID'),
  }),
};

// ============================================================================
// User
// ============================================================================

export const getUserInfoSchema = {
  name: 'getUserInfo',
  description: 'Get current user information (ID, email, name, avatar)',
  notes: '',
  input: z.object({}),
  output: z.object({
    id: z.string().describe('User ID'),
    email: z.string().describe('User email address'),
    name: z.string().optional().describe('User full name'),
    picture: z.string().optional().describe('User profile picture URL'),
  }),
};

// ============================================================================
// Workspaces
// ============================================================================

export const WorkspaceRoleSchema = z
  .enum(['owner', 'admin', 'member'])
  .describe('User role in workspace');

export const WorkspacePlanSchema = z
  .enum(['free', 'pro', 'enterprise'])
  .describe('Workspace plan type');

export const WorkspaceSchema = z.object({
  id: z.string().describe('Workspace ID'),
  slug: z.string().describe('Workspace URL slug'),
  displayName: z.string().describe('Workspace display name'),
  role: WorkspaceRoleSchema.describe('User role in this workspace'),
  planType: WorkspacePlanSchema.describe('Workspace subscription plan'),
});

export const getWorkspacesSchema = {
  name: 'getWorkspaces',
  description: 'Get all workspaces the user has access to',
  notes: '',
  input: z.object({}),
  output: z.object({
    workspaces: z
      .array(WorkspaceSchema)
      .describe('List of accessible workspaces'),
  }),
};

// ============================================================================
// Documents
// ============================================================================

export const SharingVisibilitySchema = z
  .enum(['private', 'workspace', 'public'])
  .describe('Document sharing visibility level');

export const DocumentMetadataSchema = z.object({
  title: z.string().describe('Document title'),
  created_at: z.string().describe('ISO timestamp when document was created'),
  creator_id: z.string().describe('ID of user who created the document'),
  updated_at: z
    .string()
    .describe('ISO timestamp when document was last updated'),
});

export const DocumentCreatorSchema = z.object({
  name: z.string().optional().describe('Creator full name'),
  email: z.string().optional().describe('Creator email address'),
});

export const AttendeeSchema = z
  .object({})
  .passthrough()
  .describe('Meeting attendee information');

export const DocumentDetailSchema = z.object({
  title: z.string().describe('Document title'),
  creator: DocumentCreatorSchema.optional().describe('Document creator info'),
  attendees: z.array(AttendeeSchema).optional().describe('Meeting attendees'),
  created_at: z.string().describe('ISO timestamp when document was created'),
  sharing_link_visibility: SharingVisibilitySchema.optional().describe(
    'Sharing visibility level',
  ),
});

export const getDocumentSetSchema = {
  name: 'getDocumentSet',
  description: 'Get all documents for the current user',
  notes:
    'Reads from local Granola store (documents are NOT synced to cloud API). ' +
    'MUST run in the existing Granola app tab via cdpScript, not a new executor tab. ' +
    'New tabs do not have the local store populated.',
  input: z.object({}),
  output: z.object({
    documents: z
      .record(z.string(), DocumentMetadataSchema)
      .describe('Map of document IDs to metadata'),
  }),
};

export const getDocumentMetadataSchema = {
  name: 'getDocumentMetadata',
  description:
    'Get detailed metadata for a specific document (creator, attendees, sharing)',
  notes: '',
  input: z.object({
    document_id: DocumentIdParam,
  }),
  output: DocumentDetailSchema,
};

export const DocumentSearchResultSchema = z.object({
  id: z.string().uuid().describe('Document UUID'),
  title: z.string().describe('Document title'),
  createdAt: z.string().describe('ISO timestamp when document was created'),
  updatedAt: z
    .string()
    .describe('ISO timestamp when document was last updated'),
});

export const searchDocumentsSchema = {
  name: 'searchDocuments',
  description: 'Search documents by title',
  notes: '',
  input: z.object({
    query: z.string().describe('Search query to match against document titles'),
  }),
  output: z.object({
    query: z.string().describe('The search query used'),
    results: z.array(DocumentSearchResultSchema).describe('Matching documents'),
    resultCount: z.number().describe('Number of matching results'),
    totalDocuments: z.number().describe('Total number of documents searched'),
  }),
};

export const deleteDocumentSchema = {
  name: 'deleteDocument',
  description: 'Permanently delete a document (recording/meeting notes)',
  notes:
    'This is irreversible. The document and all associated data (transcript, panels) will be permanently deleted.',
  input: z.object({
    document_id: DocumentIdParam,
  }),
  output: z.object({
    success: z.boolean().describe('Whether deletion succeeded'),
    documentId: z.string().uuid().describe('UUID of deleted document'),
  }),
};

// ============================================================================
// Panels
// ============================================================================

export const PanelSchema = z.object({
  id: z.string().uuid().describe('Panel UUID'),
  title: z
    .string()
    .optional()
    .describe('Panel section title (e.g. "Summary", "Action Items")'),
  content: z.string().optional().describe('Panel content as HTML string'),
  updated_at: z
    .string()
    .optional()
    .describe('ISO timestamp when panel was last updated'),
});

export const getDocumentPanelsSchema = {
  name: 'getDocumentPanels',
  description: 'Get document panels (notes sections as HTML content)',
  notes:
    'Reads from local Granola store (panels are NOT synced to cloud API). ' +
    'MUST run in the existing Granola app tab via cdpScript, not a new executor tab.',
  input: z.object({
    document_id: DocumentIdParam,
  }),
  output: z.array(PanelSchema),
};

// ============================================================================
// Transcripts
// ============================================================================

export const TranscriptSourceSchema = z
  .enum(['microphone', 'system'])
  .describe('Audio source: microphone or system audio');

export const TranscriptSegmentSchema = z.object({
  id: z.string().describe('Segment ID'),
  text: z.string().describe('Transcribed text'),
  source: TranscriptSourceSchema.optional().describe('Audio source'),
  is_final: z
    .boolean()
    .optional()
    .describe('Whether transcription is finalized'),
  start_timestamp: z
    .string()
    .optional()
    .describe('ISO timestamp when segment started'),
  end_timestamp: z
    .string()
    .optional()
    .describe('ISO timestamp when segment ended'),
});

export const getDocumentTranscriptSchema = {
  name: 'getDocumentTranscript',
  description:
    'Get document transcript segments (time-stamped text from recording)',
  notes: '',
  input: z.object({
    document_id: DocumentIdParam,
  }),
  output: z.array(TranscriptSegmentSchema),
};

export const getTranscriptionStatusSchema = {
  name: 'getTranscriptionStatus',
  description:
    'Get current transcription/recording status: whether a meeting is being recorded and which document it is',
  notes:
    'Reads from local Granola store. MUST run in the existing Granola app tab via cdpScript.',
  input: z.object({}),
  output: z.object({
    isRecording: z
      .boolean()
      .describe('Whether a meeting is currently being recorded'),
    documentId: z
      .string()
      .uuid()
      .nullable()
      .describe(
        'Document UUID of the active recording, or null if not recording',
      ),
    transcriptionState: z
      .string()
      .nullable()
      .describe(
        'Transcription state (e.g. "active", "idle"), or null if not recording',
      ),
    language: z
      .string()
      .nullable()
      .describe('Transcription language code (e.g. "en"), or null'),
    provider: z
      .string()
      .nullable()
      .describe('Transcription provider (e.g. "assembly-universal"), or null'),
  }),
};

export const getLiveTranscriptSchema = {
  name: 'getLiveTranscript',
  description:
    'Get live transcript from a currently recording meeting (reads from local store, works during active recording)',
  notes:
    'Reads from local Granola store. MUST run in the existing Granola app tab via cdpScript. ' +
    'Call getTranscriptionStatus() first to get the active document_id. ' +
    'Segments where is_final=false are still being transcribed and may change.',
  input: z.object({
    document_id: DocumentIdParam.describe(
      'Document UUID of the active recording (from getTranscriptionStatus)',
    ),
    tail: z
      .number()
      .optional()
      .describe(
        'Only return the last N segments (useful for polling). Omit for full transcript.',
      ),
  }),
  output: z.object({
    segments: z
      .array(TranscriptSegmentSchema)
      .describe('Transcript segments, ordered by start_timestamp'),
    totalSegments: z
      .number()
      .describe('Total number of transcript segments available'),
    hasInProgress: z
      .boolean()
      .describe(
        'Whether the last segment is still being transcribed (is_final=false)',
      ),
  }),
};

// ============================================================================
// Folders
// ============================================================================

export const FolderVisibilitySchema = z
  .enum(['private', 'workspace', 'shared'])
  .describe('Folder visibility level');

export const FolderUserRoleSchema = z
  .enum(['owner', 'collaborator', 'viewer'])
  .describe('User role in folder');

export const FolderSchema = z.object({
  id: z.string().uuid().describe('Folder UUID'),
  title: z.string().describe('Folder title'),
  description: z.string().optional().describe('Folder description'),
  visibility: FolderVisibilitySchema.describe('Folder visibility level'),
  isShared: z.boolean().describe('Whether folder is shared with others'),
  userRole: FolderUserRoleSchema.describe('Current user role in this folder'),
  documentCount: z.number().describe('Number of documents in folder'),
  documentIds: z
    .array(z.string().uuid())
    .optional()
    .describe('List of document UUIDs in folder'),
  slackChannel: z.string().optional().describe('Connected Slack channel ID'),
});

export const getFoldersSchema = {
  name: 'getFolders',
  description: 'Get all document folders',
  notes: '',
  input: z.object({
    include_document_ids: z
      .boolean()
      .optional()
      .describe('Include list of document IDs in each folder (default: false)'),
  }),
  output: z.object({
    folders: z.array(FolderSchema).describe('List of folders'),
    counts: z
      .object({
        total: z.number().describe('Total number of folders'),
        private: z.number().describe('Number of private folders'),
        shared: z.number().describe('Number of shared folders'),
      })
      .describe('Folder count statistics'),
  }),
};

export const createFolderSchema = {
  name: 'createFolder',
  description: 'Create a new folder',
  notes: '',
  input: z.object({
    title: z.string().describe('Folder title'),
  }),
  output: z.object({
    folderId: z.string().uuid().describe('UUID of created folder'),
    folderTitle: z.string().describe('Title of created folder'),
  }),
};

export const deleteFolderSchema = {
  name: 'deleteFolder',
  description: 'Delete a folder (documents inside are not deleted)',
  notes: 'User must have owner role.',
  input: z.object({
    folder_id: FolderIdParam,
  }),
  output: z.object({
    success: z.boolean().describe('Whether deletion succeeded'),
    folderId: z.string().uuid().describe('UUID of deleted folder'),
  }),
};

export const moveDocumentToFolderSchema = {
  name: 'moveDocumentToFolder',
  description:
    'Move a document into a folder. Optionally remove it from its current folder.',
  notes:
    'Use getFolders with include_document_ids=true to find which folder a document is currently in.',
  input: z.object({
    document_id: DocumentIdParam,
    target_folder_id: FolderIdParam.describe(
      'Folder UUID to move the document into',
    ),
    source_folder_id: FolderIdParam.optional().describe(
      'Folder UUID to remove the document from (omit to only add, not remove)',
    ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the move succeeded'),
    documentId: z.string().uuid().describe('Document UUID that was moved'),
    targetFolderId: z
      .string()
      .uuid()
      .describe('Folder UUID the document was added to'),
    removedFromFolderId: z
      .string()
      .uuid()
      .optional()
      .describe(
        'Folder UUID the document was removed from (if source_folder_id was provided)',
      ),
  }),
};

// ============================================================================
// Sharing
// ============================================================================

export const UserRoleSchema = z
  .enum(['owner', 'editor', 'viewer'])
  .describe('User access role');

export const DocumentAccessUserSchema = z.object({
  userId: z.string().describe('User ID'),
  email: z.string().describe('User email address'),
  name: z.string().optional().describe('User full name'),
  role: UserRoleSchema.describe('User access role for this document'),
  avatar: z.string().optional().describe('User avatar URL'),
});

export const shareDocumentSchema = {
  name: 'shareDocument',
  description: 'Share a document with users by email',
  notes: '',
  input: z.object({
    document_id: DocumentIdParam,
    emails: z
      .array(z.string().email())
      .describe('Email addresses to grant access'),
  }),
  output: z.object({
    documentId: z.string().uuid().describe('Document UUID'),
    addedEmails: z
      .array(z.string())
      .describe('Emails successfully granted access'),
    accessList: z
      .array(DocumentAccessUserSchema)
      .describe('Current list of users with access'),
  }),
};

export const removeUserAccessSchema = {
  name: 'removeUserAccess',
  description: 'Remove user access from a document',
  notes: 'Caller must have owner or admin role.',
  input: z.object({
    document_id: DocumentIdParam,
    emails: z
      .array(z.string().email())
      .describe('Email addresses to revoke access'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether removal succeeded'),
    documentId: z.string().uuid().describe('Document UUID'),
  }),
};

export const getUsersWithAccessSchema = {
  name: 'getUsersWithAccess',
  description: 'Get list of users with access to a document',
  notes: '',
  input: z.object({
    document_id: DocumentIdParam,
  }),
  output: z.object({
    users: z
      .array(DocumentAccessUserSchema)
      .describe('Users with document access'),
  }),
};

export const createShareLinkSchema = {
  name: 'createShareLink',
  description: 'Create a share link for a document',
  notes:
    'Document must have appropriate visibility settings. Use getDocumentMetadata() to check sharing_link_visibility.',
  input: z.object({
    document_id: DocumentIdParam,
    expiry: z
      .string()
      .or(z.null())
      .optional()
      .describe('Link expiry (not currently used)'),
  }),
  output: z.object({
    documentId: z.string().uuid().describe('Document UUID'),
    shareLink: z.string().url().describe('Shareable link URL'),
  }),
};

// ============================================================================
// AI Chat
// ============================================================================

export const AIChatModelSchema = z
  .enum([
    'gpt-4.1',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-5',
    'gpt-5-mini',
    'gpt-5-nano',
    'claude-4-sonnet',
  ])
  .describe('AI model to use for chat');

export const AIChatOptionsSchema = z.object({
  model: AIChatModelSchema.optional().describe(
    'AI model to use (default: claude-4-sonnet)',
  ),
  webSearch: z
    .boolean()
    .optional()
    .describe('Enable web search for context (default: false)'),
  deepdive: z
    .boolean()
    .optional()
    .describe('Enable deep analysis mode (default: false)'),
  transcripts: z
    .boolean()
    .optional()
    .describe('Include transcript data in context (default: true)'),
});

export const aiChatSchema = {
  name: 'aiChat',
  description: 'Chat with AI about documents',
  notes: '',
  input: z.object({
    prompt: z.string().describe('User prompt/question for the AI'),
    document_id: DocumentIdParam.optional().describe(
      'Optional document UUID for context',
    ),
    options: AIChatOptionsSchema.optional().describe(
      'Chat options and model selection',
    ),
  }),
  output: z.object({
    prompt: z.string().describe('The prompt sent to AI'),
    documentId: z
      .string()
      .uuid()
      .optional()
      .describe('Document UUID if provided'),
    response: z.string().describe('AI response text'),
    reasoning: z
      .string()
      .optional()
      .describe('AI reasoning/thought process if deepdive enabled'),
  }),
};

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  getContextSchema,
  getUserInfoSchema,
  getWorkspacesSchema,
  getDocumentSetSchema,
  getDocumentMetadataSchema,
  getDocumentPanelsSchema,
  getDocumentTranscriptSchema,
  getTranscriptionStatusSchema,
  getLiveTranscriptSchema,
  searchDocumentsSchema,
  deleteDocumentSchema,
  getFoldersSchema,
  createFolderSchema,
  deleteFolderSchema,
  moveDocumentToFolderSchema,
  shareDocumentSchema,
  removeUserAccessSchema,
  getUsersWithAccessSchema,
  createShareLinkSchema,
  aiChatSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

// Shared types
export type SharingVisibilityType = z.infer<typeof SharingVisibilitySchema>;
export type TranscriptSourceType = z.infer<typeof TranscriptSourceSchema>;
export type WorkspaceRoleType = z.infer<typeof WorkspaceRoleSchema>;
export type WorkspacePlanType = z.infer<typeof WorkspacePlanSchema>;
export type FolderVisibilityType = z.infer<typeof FolderVisibilitySchema>;
export type FolderUserRoleType = z.infer<typeof FolderUserRoleSchema>;
export type UserRoleType = z.infer<typeof UserRoleSchema>;
export type AIChatModelType = z.infer<typeof AIChatModelSchema>;

// Entity types
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;
export type DocumentDetail = z.infer<typeof DocumentDetailSchema>;
export type DocumentCreator = z.infer<typeof DocumentCreatorSchema>;
export type DocumentSearchResult = z.infer<typeof DocumentSearchResultSchema>;
export type Attendee = z.infer<typeof AttendeeSchema>;
export type Panel = z.infer<typeof PanelSchema>;
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type Folder = z.infer<typeof FolderSchema>;
export type DocumentAccessUser = z.infer<typeof DocumentAccessUserSchema>;
export type AIChatOptions = z.infer<typeof AIChatOptionsSchema>;

// Input types
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetUserInfoInput = z.infer<typeof getUserInfoSchema.input>;
export type GetWorkspacesInput = z.infer<typeof getWorkspacesSchema.input>;
export type GetDocumentSetInput = z.infer<typeof getDocumentSetSchema.input>;
export type GetDocumentMetadataInput = z.infer<
  typeof getDocumentMetadataSchema.input
>;
export type GetDocumentPanelsInput = z.infer<
  typeof getDocumentPanelsSchema.input
>;
export type GetDocumentTranscriptInput = z.infer<
  typeof getDocumentTranscriptSchema.input
>;
export type GetTranscriptionStatusInput = z.infer<
  typeof getTranscriptionStatusSchema.input
>;
export type GetLiveTranscriptInput = z.infer<
  typeof getLiveTranscriptSchema.input
>;
export type SearchDocumentsInput = z.infer<typeof searchDocumentsSchema.input>;
export type DeleteDocumentInput = z.infer<typeof deleteDocumentSchema.input>;
export type GetFoldersInput = z.infer<typeof getFoldersSchema.input>;
export type CreateFolderInput = z.infer<typeof createFolderSchema.input>;
export type DeleteFolderInput = z.infer<typeof deleteFolderSchema.input>;
export type MoveDocumentToFolderInput = z.infer<
  typeof moveDocumentToFolderSchema.input
>;
export type ShareDocumentInput = z.infer<typeof shareDocumentSchema.input>;
export type RemoveUserAccessInput = z.infer<
  typeof removeUserAccessSchema.input
>;
export type GetUsersWithAccessInput = z.infer<
  typeof getUsersWithAccessSchema.input
>;
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema.input>;
export type AIChatInput = z.infer<typeof aiChatSchema.input>;

// Output types
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type GetUserInfoOutput = z.infer<typeof getUserInfoSchema.output>;
export type GetWorkspacesOutput = z.infer<typeof getWorkspacesSchema.output>;
export type GetDocumentSetOutput = z.infer<typeof getDocumentSetSchema.output>;
export type GetDocumentMetadataOutput = z.infer<
  typeof getDocumentMetadataSchema.output
>;
export type GetDocumentPanelsOutput = z.infer<
  typeof getDocumentPanelsSchema.output
>;
export type GetDocumentTranscriptOutput = z.infer<
  typeof getDocumentTranscriptSchema.output
>;
export type GetTranscriptionStatusOutput = z.infer<
  typeof getTranscriptionStatusSchema.output
>;
export type GetLiveTranscriptOutput = z.infer<
  typeof getLiveTranscriptSchema.output
>;
export type SearchDocumentsOutput = z.infer<
  typeof searchDocumentsSchema.output
>;
export type GetFoldersOutput = z.infer<typeof getFoldersSchema.output>;
export type DeleteDocumentOutput = z.infer<typeof deleteDocumentSchema.output>;
export type CreateFolderOutput = z.infer<typeof createFolderSchema.output>;
export type DeleteFolderOutput = z.infer<typeof deleteFolderSchema.output>;
export type MoveDocumentToFolderOutput = z.infer<
  typeof moveDocumentToFolderSchema.output
>;
export type ShareDocumentOutput = z.infer<typeof shareDocumentSchema.output>;
export type RemoveUserAccessOutput = z.infer<
  typeof removeUserAccessSchema.output
>;
export type GetUsersWithAccessOutput = z.infer<
  typeof getUsersWithAccessSchema.output
>;
export type CreateShareLinkOutput = z.infer<
  typeof createShareLinkSchema.output
>;
export type AIChatOutput = z.infer<typeof aiChatSchema.output>;
