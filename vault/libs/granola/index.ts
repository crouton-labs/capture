// Types from schemas - single source of truth
export type {
  SharingVisibilityType,
  TranscriptSourceType,
  DocumentMetadata,
  DocumentDetail,
  DocumentCreator,
  DocumentSearchResult,
  Attendee,
  Panel,
  TranscriptSegment,
  Workspace,
  Folder,
  DocumentAccessUser,
  AIChatOptions,
  GetContextInput,
  GetUserInfoInput,
  GetWorkspacesInput,
  GetDocumentSetInput,
  GetDocumentMetadataInput,
  GetDocumentPanelsInput,
  GetDocumentTranscriptInput,
  GetTranscriptionStatusInput,
  GetLiveTranscriptInput,
  SearchDocumentsInput,
  DeleteDocumentInput,
  GetFoldersInput,
  CreateFolderInput,
  DeleteFolderInput,
  MoveDocumentToFolderInput,
  ShareDocumentInput,
  RemoveUserAccessInput,
  GetUsersWithAccessInput,
  CreateShareLinkInput,
  AIChatInput,
  GetContextOutput,
  GetUserInfoOutput,
  GetWorkspacesOutput,
  GetDocumentSetOutput,
  GetDocumentMetadataOutput,
  GetDocumentPanelsOutput,
  GetDocumentTranscriptOutput,
  GetTranscriptionStatusOutput,
  GetLiveTranscriptOutput,
  SearchDocumentsOutput,
  DeleteDocumentOutput,
  GetFoldersOutput,
  CreateFolderOutput,
  DeleteFolderOutput,
  MoveDocumentToFolderOutput,
  ShareDocumentOutput,
  RemoveUserAccessOutput,
  GetUsersWithAccessOutput,
  CreateShareLinkOutput,
  AIChatOutput,
} from './schemas';

import { Validation, Unauthenticated, UpstreamError, throwForStatus } from '@vallum/_runtime';

import type {
  GetContextInput,
  GetDocumentMetadataInput,
  GetDocumentPanelsInput,
  GetDocumentTranscriptInput,
  GetLiveTranscriptInput,
  GetTranscriptionStatusInput,
  GetFoldersInput,
  CreateFolderInput,
  DeleteFolderInput,
  MoveDocumentToFolderInput,
  SearchDocumentsInput,
  DeleteDocumentInput,
  ShareDocumentInput,
  RemoveUserAccessInput,
  GetUsersWithAccessInput,
  CreateShareLinkInput,
  AIChatInput,
  GetContextOutput,
  GetDocumentSetOutput,
  GetDocumentMetadataOutput,
  GetDocumentPanelsOutput,
  GetDocumentTranscriptOutput,
  GetTranscriptionStatusOutput,
  GetLiveTranscriptOutput,
  GetUserInfoOutput,
  GetWorkspacesOutput,
  SearchDocumentsOutput,
  DeleteDocumentOutput,
  GetFoldersOutput,
  CreateFolderOutput,
  DeleteFolderOutput,
  MoveDocumentToFolderOutput,
  ShareDocumentOutput,
  RemoveUserAccessOutput,
  GetUsersWithAccessOutput,
  CreateShareLinkOutput,
  AIChatOutput,
} from './schemas';

// ============================================================================
// Constants
// ============================================================================

const API_BASE = 'https://api.granola.ai';
const STREAM_API_BASE = 'https://stream.api.granola.ai';

// ============================================================================
// Local Store Access
// ============================================================================

// Granola's Electron app stores data in a Zustand store on window.__GRANOLA__
// This is the primary source of truth for documents (not synced to cloud API)

interface GranolaPanel {
  id: string;
  document_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
  template_slug?: string;
}

interface TranscriptChunk {
  id: string;
  document_id: string;
  text: string;
  source?: 'microphone' | 'system';
  is_final?: boolean;
  start_timestamp?: string;
  end_timestamp?: string;
}

interface GranolaStoreShape {
  useStore: {
    getState: () => {
      transcribingDocumentId?: string | null;
      transcriptionState?: string | null;
      transcriptionInfo?: {
        language?: string;
        provider?: string;
      } | null;
    };
  };
  useCacheStore: {
    getState: () => {
      documents?: Record<
        string,
        {
          title: string;
          created_at: string;
          updated_at: string;
          creator_id: string;
          is_recording?: boolean;
          duration_secs?: number;
        }
      >;
      documentPanels?: Record<string, Record<string, GranolaPanel>>;
      transcripts?: Record<string, TranscriptChunk[]>;
    };
  };
}

/**
 * Get the local Granola store if available.
 * Returns undefined if not in the Granola Electron app context.
 */
function getLocalStore(): GranolaStoreShape | undefined {
  return (window as unknown as { __GRANOLA__?: GranolaStoreShape }).__GRANOLA__;
}

// ============================================================================
// Context Acquisition
// ============================================================================

/**
 * Get user context for Granola API calls.
 * Call this FIRST before any other Granola operations.
 */
export async function getContext(
  opts: GetContextInput = { timeoutMs: 10000 },
): Promise<GetContextOutput> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const startTime = Date.now();

  // Wait for Granola app context to be available
  // Granola is an Electron app, so we check for app-specific indicators
  // Case-insensitive check since file:// URLs have "Granola" with capital G
  while (!window.location.href.toLowerCase().includes('granola')) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Validation(
        `Not in Granola app context. URL: ${window.location.href}`,
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Extract user ID from app context
  // Granola stores user context in window or local storage
  const userId =
    (window as unknown as { granolaUserId?: string }).granolaUserId ||
    localStorage.getItem('userId');

  if (!userId) {
    throw new Unauthenticated('Could not extract user ID from Granola app context.');
  }

  return { userId };
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function granolaFetch<T>(path: string, body: unknown): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    const truncated =
      text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    throwForStatus(response.status, truncated);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    const truncated =
      text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    throw new UpstreamError(`Granola returned non-JSON response: ${truncated}`);
  }
}

// ============================================================================
// User Info
// ============================================================================

/**
 * Get current user information.
 */
export async function getUserInfo(): Promise<GetUserInfoOutput> {
  const response = await granolaFetch<{
    id: string;
    email: string;
    user_metadata?: { name?: string; picture?: string };
  }>('/v1/get-user-info', {});

  return {
    id: response.id,
    email: response.email,
    name: response.user_metadata?.name,
    picture: response.user_metadata?.picture,
  };
}

// ============================================================================
// Workspaces
// ============================================================================

/**
 * Get all workspaces the user has access to.
 */
export async function getWorkspaces(): Promise<GetWorkspacesOutput> {
  const response = await granolaFetch<{
    workspaces: Array<{
      workspace: {
        workspace_id: string;
        slug: string;
        display_name: string;
      };
      role: string;
      plan_type: string;
    }>;
  }>('/v1/get-workspaces', {});

  return {
    workspaces: (response.workspaces || []).map((w) => ({
      id: w.workspace.workspace_id,
      slug: w.workspace.slug,
      displayName: w.workspace.display_name,
      role: w.role.toLowerCase() as 'owner' | 'admin' | 'member',
      planType: w.plan_type.toLowerCase() as 'free' | 'pro' | 'enterprise',
    })),
  };
}

// ============================================================================
// Documents
// ============================================================================

/**
 * Get all documents for the current user.
 * Returns a map of document IDs to metadata.
 * Reads from local Granola store (documents are stored locally, not synced to cloud API).
 */
export async function getDocumentSet(): Promise<GetDocumentSetOutput> {
  const store = getLocalStore();
  if (!store) {
    throw new Validation(
      'Granola store not available. Must run in existing Granola app tab, not a new executor tab. ' +
        'Use cdpScript to the existing Granola target instead of createExecutor.',
    );
  }

  const state = store.useCacheStore.getState();
  const documents = state.documents || {};

  return { documents };
}

/**
 * Get detailed metadata for a specific document.
 * Returns document details including creator, attendees, and sharing settings.
 */
export async function getDocumentMetadata(
  opts: GetDocumentMetadataInput,
): Promise<GetDocumentMetadataOutput> {
  return granolaFetch<GetDocumentMetadataOutput>('/v1/get-document-metadata', {
    document_id: opts.document_id,
  });
}

// ============================================================================
// Panels
// ============================================================================

/**
 * Get document panels (notes sections).
 * Returns array of panels containing the meeting notes as HTML content.
 * Reads from local Granola store (panels are stored locally, not synced to cloud API).
 */
export async function getDocumentPanels(
  opts: GetDocumentPanelsInput,
): Promise<GetDocumentPanelsOutput> {
  const store = getLocalStore();
  if (!store) {
    throw new Validation(
      'Granola store not available. Must run in existing Granola app tab, not a new executor tab. ' +
        'Use cdpScript to the existing Granola target instead of createExecutor.',
    );
  }

  const state = store.useCacheStore.getState();
  const allPanels = state.documentPanels || {};
  const docPanels = allPanels[opts.document_id];

  if (!docPanels) {
    return [];
  }

  return Object.values(docPanels)
    .filter((p) => !p.deleted_at)
    .map((p) => ({
      id: p.id,
      title: p.title,
      content: p.content,
      updated_at: p.updated_at,
    }));
}

// ============================================================================
// Transcripts
// ============================================================================

/**
 * Get document transcript segments.
 * Returns array of time-stamped transcript segments from the meeting recording.
 */
export async function getDocumentTranscript(
  opts: GetDocumentTranscriptInput,
): Promise<GetDocumentTranscriptOutput> {
  return granolaFetch<GetDocumentTranscriptOutput>(
    '/v1/get-document-transcript',
    {
      document_id: opts.document_id,
    },
  );
}

/**
 * Get current transcription/recording status.
 * Reads from local Granola store to check if a meeting is being recorded.
 */
export async function getTranscriptionStatus(
  _opts: GetTranscriptionStatusInput = {},
): Promise<GetTranscriptionStatusOutput> {
  const store = getLocalStore();
  if (!store) {
    throw new Validation(
      'Granola store not available. Must run in existing Granola app tab, not a new executor tab. ' +
        'Use cdpScript to the existing Granola target instead of createExecutor.',
    );
  }

  const state = store.useStore.getState();
  const docId = state.transcribingDocumentId ?? null;
  const isRecording = !!docId && state.transcriptionState === 'active';

  return {
    isRecording,
    documentId: docId,
    transcriptionState: state.transcriptionState ?? null,
    language: state.transcriptionInfo?.language ?? null,
    provider: state.transcriptionInfo?.provider ?? null,
  };
}

/**
 * Get live transcript from a currently recording meeting.
 * Reads transcript chunks from the local Granola store.
 */
export async function getLiveTranscript(
  opts: GetLiveTranscriptInput,
): Promise<GetLiveTranscriptOutput> {
  const store = getLocalStore();
  if (!store) {
    throw new Validation(
      'Granola store not available. Must run in existing Granola app tab, not a new executor tab. ' +
        'Use cdpScript to the existing Granola target instead of createExecutor.',
    );
  }

  const cacheState = store.useCacheStore.getState();
  const allTranscripts = cacheState.transcripts ?? {};
  const chunks = allTranscripts[opts.document_id];

  if (!chunks) {
    return {
      segments: [],
      totalSegments: 0,
      hasInProgress: false,
    };
  }

  const totalSegments = chunks.length;
  const selected =
    opts.tail && opts.tail > 0 ? chunks.slice(-opts.tail) : chunks;

  const segments = selected.map((c) => ({
    id: c.id,
    text: c.text,
    source: c.source as 'microphone' | 'system' | undefined,
    is_final: c.is_final,
    start_timestamp: c.start_timestamp,
    end_timestamp: c.end_timestamp,
  }));

  const lastChunk = chunks[chunks.length - 1];
  const hasInProgress = lastChunk ? lastChunk.is_final === false : false;

  return {
    segments,
    totalSegments,
    hasInProgress,
  };
}

// ============================================================================
// Folders
// ============================================================================

/**
 * Get all folders (document lists) for the user.
 */
export async function getFolders(
  opts: GetFoldersInput = {},
): Promise<GetFoldersOutput> {
  const response = await granolaFetch<{
    lists: Record<
      string,
      {
        id: string;
        title: string;
        description?: string;
        visibility: string | null;
        is_shared: boolean;
        user_role: string | null;
        document_ids?: string[];
        slack_channel?: { name: string };
      }
    >;
  }>('/v1/get-document-lists-metadata', {
    include_document_ids: opts.include_document_ids ?? false,
    include_only_joined_lists: false,
  });

  const folders = Object.values(response.lists || {})
    .filter((f) => f.visibility != null && f.user_role != null)
    .map((f) => ({
      id: f.id,
      title: f.title,
      description: f.description,
      visibility: f.visibility!.toLowerCase() as
        | 'private'
        | 'workspace'
        | 'shared',
      isShared: f.is_shared,
      userRole: f.user_role!.toLowerCase() as
        | 'owner'
        | 'collaborator'
        | 'viewer',
      documentCount: f.document_ids?.length || 0,
      documentIds: f.document_ids,
      slackChannel: f.slack_channel?.name,
    }));

  const privateCount = folders.filter((f) => !f.isShared).length;
  const sharedCount = folders.filter((f) => f.isShared).length;

  return {
    folders,
    counts: {
      total: folders.length,
      private: privateCount,
      shared: sharedCount,
    },
  };
}

/**
 * Create a new folder (document list).
 */
export async function createFolder(
  opts: CreateFolderInput,
): Promise<CreateFolderOutput> {
  const id = crypto.randomUUID();
  const response = await granolaFetch<{ id: string; title: string }>(
    '/v1/create-document-list',
    {
      id,
      title: opts.title,
    },
  );

  return {
    folderId: response.id,
    folderTitle: response.title,
  };
}

/**
 * Delete a folder (document list).
 */
export async function deleteFolder(
  opts: DeleteFolderInput,
): Promise<DeleteFolderOutput> {
  await granolaFetch<void>('/v1/delete-document-list', {
    id: opts.folder_id, // API uses 'id' not 'document_list_id'
  });

  return {
    success: true,
    folderId: opts.folder_id,
  };
}

/**
 * Move a document into a folder, optionally removing it from its current folder.
 */
export async function moveDocumentToFolder(
  opts: MoveDocumentToFolderInput,
): Promise<MoveDocumentToFolderOutput> {
  // Remove from source folder first (if specified)
  if (opts.source_folder_id) {
    await granolaFetch<void>('/v1/remove-document-from-list', {
      document_id: opts.document_id,
      document_list_id: opts.source_folder_id,
    });
  }

  // Add to target folder
  await granolaFetch<void>('/v1/add-document-to-list', {
    document_id: opts.document_id,
    document_list_id: opts.target_folder_id,
  });

  return {
    success: true,
    documentId: opts.document_id,
    targetFolderId: opts.target_folder_id,
    removedFromFolderId: opts.source_folder_id,
  };
}

// ============================================================================
// Search
// ============================================================================

/**
 * Search documents by title.
 * Fetches all documents and filters client-side.
 */
export async function searchDocuments(
  opts: SearchDocumentsInput,
): Promise<SearchDocumentsOutput> {
  const { documents } = await getDocumentSet();
  const query = opts.query.toLowerCase();
  const totalDocuments = Object.keys(documents).length;

  const results = Object.entries(documents)
    .filter(([, doc]) => doc.title?.toLowerCase().includes(query))
    .map(([id, doc]) => ({
      id,
      title: doc.title,
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    }))
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

  return {
    query: opts.query,
    results,
    resultCount: results.length,
    totalDocuments,
  };
}

// ============================================================================
// Delete
// ============================================================================

/**
 * Permanently delete a document (recording/meeting notes).
 * Soft-deletes first, then hard-deletes.
 */
export async function deleteDocument(
  opts: DeleteDocumentInput,
): Promise<DeleteDocumentOutput> {
  // Step 1: Soft-delete (required before hard-delete)
  await granolaFetch<{ id: string }>('/v1/update-document', {
    id: opts.document_id,
    deleted_at: new Date().toISOString(),
  });

  // Step 2: Hard-delete
  await granolaFetch<{ success: boolean }>('/v1/hard-delete-document', {
    document_id: opts.document_id,
  });

  return {
    success: true,
    documentId: opts.document_id,
  };
}

// ============================================================================
// Sharing
// ============================================================================

/**
 * Share a document with users by email.
 */
export async function shareDocument(
  opts: ShareDocumentInput,
): Promise<ShareDocumentOutput> {
  const shareResult = await granolaFetch<{ added_emails?: string[] }>(
    '/v1/add-users-to-document',
    {
      document_id: opts.document_id,
      emails: opts.emails,
      source: 'sharing_settings',
    },
  );

  const accessResponse = await getUsersWithAccess({
    document_id: opts.document_id,
  });

  return {
    documentId: opts.document_id,
    addedEmails: shareResult.added_emails || opts.emails,
    accessList: accessResponse.users,
  };
}

/**
 * Remove users' access to a document.
 */
export async function removeUserAccess(
  opts: RemoveUserAccessInput,
): Promise<RemoveUserAccessOutput> {
  await granolaFetch<void>('/v1/remove-users-from-document', {
    document_id: opts.document_id,
    emails: opts.emails,
  });

  return {
    success: true,
    documentId: opts.document_id,
  };
}

/**
 * Get list of users with access to a document.
 */
export async function getUsersWithAccess(
  opts: GetUsersWithAccessInput,
): Promise<GetUsersWithAccessOutput> {
  const response = await granolaFetch<{
    users: Array<{
      user_id: string;
      email: string;
      name?: string;
      role: string;
      avatar?: string;
    }>;
  }>('/v1/get-users-with-access', {
    document_id: opts.document_id,
  });

  return {
    users: (response.users || []).map((u) => ({
      userId: u.user_id,
      email: u.email,
      name: u.name,
      role: u.role.toLowerCase() as 'owner' | 'editor' | 'viewer',
      avatar: u.avatar,
    })),
  };
}

/**
 * Create a shareable link for a document.
 * Constructs the share URL using Granola's notes web app.
 */
export async function createShareLink(
  opts: CreateShareLinkInput,
): Promise<CreateShareLinkOutput> {
  const shareLink = `https://notes.granola.ai/d/${opts.document_id}`;

  return {
    documentId: opts.document_id,
    shareLink,
  };
}

// ============================================================================
// AI Chat
// ============================================================================

/**
 * Chat with AI about documents using streaming API.
 * Returns the complete response after streaming finishes.
 */
export async function aiChat(opts: AIChatInput): Promise<AIChatOutput> {
  const url = `${STREAM_API_BASE}/v1/chat-with-documents`;

  const requestBody = {
    chat_history: [
      {
        role: 'USER',
        text: opts.prompt,
        messageContext: {
          mode: 'all',
          currentViewContext: opts.document_id
            ? {
                view: 'global',
                newestMeeting: { id: opts.document_id },
                oldestMeeting: { id: opts.document_id },
                numTotalDocuments: 1,
              }
            : { view: 'global' },
          includeTranscripts: opts.options?.transcripts ?? true,
          additionalContext: {},
        },
      },
    ],
    document_ids: opts.document_id ? [opts.document_id] : [],
    chat_context: 'global',
    prompt_config: { model: opts.options?.model || 'auto' },
    exclude_transcripts: !(opts.options?.transcripts ?? true),
    transcripts: opts.options?.transcripts ?? true,
    deepdive: opts.options?.deepdive ?? false,
    web_search: opts.options?.webSearch ?? false,
    meeting_chat_date_range: {},
    num_total_documents: opts.document_id ? 1 : 0,
    user_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throwForStatus(response.status, body);
  }

  const text = await response.text();
  const chunks = text.split('-----CHUNK_BOUNDARY-----');

  let finalText = '';
  let reasoning = '';

  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    try {
      const parsed = JSON.parse(chunk);

      if (parsed.type === 'error') {
        throw new UpstreamError(parsed.error);
      }
      if (parsed.type === 'reasoning_delta') {
        reasoning += parsed.delta;
      }
      if (parsed.type === 'stream_completed' && parsed.responseText) {
        finalText = parsed.responseText;
      }
      if (parsed.type === 'outputs' && parsed.outputs) {
        for (const output of parsed.outputs) {
          if (output.type === 'text' && output.text) {
            finalText = output.text;
          }
          if (output.type === 'text_with_citations') {
            finalText =
              output.response_lines
                ?.map((l: { answer_text: string }) => l.answer_text)
                .join('\n') ||
              output.plain_text ||
              '';
          }
        }
      }
    } catch {
      // Skip malformed chunks
    }
  }

  return {
    prompt: opts.prompt,
    documentId: opts.document_id,
    response: finalText,
    reasoning: reasoning || undefined,
  };
}
