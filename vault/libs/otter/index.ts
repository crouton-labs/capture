// Types from schemas - single source of truth
export type {
  ThreadScopeType,
  Recording,
  RecordingDetail,
  Speaker,
  OutlineItem,
  ActionItem,
  SearchResult,
  AdvancedSearchResult,
  Channel,
  ChannelMember,
  WorkspaceMember,
  ChatSession,
  ChatMessage,
  ChatContextRef,
  GetContextInput,
  GetWorkspaceInput,
  ListRecordingsInput,
  GetRecordingInput,
  GetSpeakersInput,
  GetAbstractSummaryInput,
  GetActionItemsInput,
  QuickSearchInput,
  AdvancedSearchInput,
  ListChannelsInput,
  GetChannelInput,
  GetChannelMembersInput,
  GetChannelMessagesInput,
  MarkChannelVisitedInput,
  GetChatSessionsInput,
  GetChatMessageHistoryInput,
  PostChatMessageInput,
  RenameRecordingInput,
  DeleteRecordingInput,
  GetContextOutput,
  GetWorkspaceOutput,
  ListRecordingsOutput,
  GetRecordingOutput,
  GetSpeakersOutput,
  GetAbstractSummaryOutput,
  GetActionItemsOutput,
  QuickSearchOutput,
  AdvancedSearchOutput,
  ListChannelsOutput,
  GetChannelOutput,
  GetChannelMembersOutput,
  GetChannelMessagesOutput,
  GetChatSessionsOutput,
  GetChatMessageHistoryOutput,
  PostChatMessageOutput,
  RenameRecordingOutput,
  DeleteRecordingOutput,
} from './schemas';

import { Validation, Unauthenticated, ContractDrift, UpstreamError, throwForStatus } from '@vallum/_runtime';

import type {
  GetContextInput,
  GetWorkspaceInput,
  ListRecordingsInput,
  GetRecordingInput,
  GetSpeakersInput,
  GetAbstractSummaryInput,
  GetActionItemsInput,
  QuickSearchInput,
  AdvancedSearchInput,
  ListChannelsInput,
  GetChannelInput,
  GetChannelMembersInput,
  GetChannelMessagesInput,
  MarkChannelVisitedInput,
  GetChatSessionsInput,
  GetChatMessageHistoryInput,
  PostChatMessageInput,
  RenameRecordingInput,
  DeleteRecordingInput,
  GetWorkspaceOutput,
  ListRecordingsOutput,
  GetRecordingOutput,
  GetSpeakersOutput,
  GetAbstractSummaryOutput,
  GetActionItemsOutput,
  QuickSearchOutput,
  AdvancedSearchOutput,
  ListChannelsOutput,
  GetChannelOutput,
  GetChannelMembersOutput,
  GetChannelMessagesOutput,
  GetChatSessionsOutput,
  GetChatMessageHistoryOutput,
  PostChatMessageOutput,
  RenameRecordingOutput,
  DeleteRecordingOutput,
} from './schemas';

// ============================================================================
// Context Acquisition
// ============================================================================

export interface OtterContext {
  csrf: string;
  userId: number;
  workspaceId: number | null;
  workspaceName: string;
}

interface WorkspaceContextResponse {
  status: string;
  user?: {
    id: number;
    workspace?: {
      id: number;
      name: string;
    };
  };
}

/**
 * Get CSRF token and workspace context for Otter API calls.
 * Call this FIRST before any other Otter operations.
 */
export async function getContext(
  opts: GetContextInput = { timeoutMs: 10000 },
): Promise<OtterContext> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const startTime = Date.now();

  // Wait for page to be on Otter domain
  while (!window.location.hostname.includes('otter.ai')) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Validation(`Not on Otter domain. URL: ${window.location.href}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // Get CSRF from cookie
  const csrf = document.cookie
    .split('; ')
    .find((c) => c.startsWith('csrftoken='))
    ?.split('=')[1];

  if (!csrf) {
    throw new Unauthenticated(
      `CSRF token not found. User may not be logged in. URL: ${window.location.href}`,
    );
  }

  // Fetch workspace context
  const resp = await fetch('/forward/api/v1/user/workspace', {
    credentials: 'include',
    headers: {
      'x-csrftoken': csrf,
      'x-client-version': 'v3.101.1',
    },
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, body);
  }

  const data: WorkspaceContextResponse = await resp.json();

  const statusLower = (data.status || '').toLowerCase();
  if (statusLower !== 'success' && statusLower !== 'ok') {
    throw new UpstreamError(`Workspace context returned status: ${data.status}`);
  }

  const userId = data.user?.id;
  if (!userId) {
    throw new ContractDrift('Could not extract user ID from context.');
  }

  const workspaceId = data.user?.workspace?.id ?? null;
  const workspaceName = data.user?.workspace?.name ?? '';

  return {
    csrf,
    userId,
    workspaceId,
    workspaceName,
  };
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function otterFetch<T>(
  csrf: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'x-csrftoken': csrf,
      'x-client-version': 'v3.101.1',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    const truncated =
      body.length > 2000 ? body.slice(0, 2000) + '... [truncated]' : body;
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
    throw new UpstreamError(`Otter returned non-JSON response: ${truncated}`);
  }
}

async function otterFormPost<T>(
  csrf: string,
  path: string,
  formData: FormData,
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-csrftoken': csrf,
      'x-client-version': 'v3.101.1',
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    const truncated =
      body.length > 2000 ? body.slice(0, 2000) + '... [truncated]' : body;
    throwForStatus(response.status, truncated);
  }

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    const truncated =
      text.length > 2000 ? text.slice(0, 2000) + '... [truncated]' : text;
    throw new UpstreamError(`Otter returned non-JSON response: ${truncated}`);
  }
}

// ============================================================================
// Workspace
// ============================================================================

/**
 * Get full workspace details including all members (admin only).
 */
export async function getWorkspace(
  opts: GetWorkspaceInput,
): Promise<GetWorkspaceOutput> {
  return otterFetch(opts.csrf, '/forward/api/v1/workspace');
}

// ============================================================================
// Recordings
// ============================================================================

/**
 * List recordings (home feed).
 */
export async function listRecordings(
  opts: ListRecordingsInput,
): Promise<ListRecordingsOutput> {
  const params = new URLSearchParams({
    funnel: opts.funnel ?? 'home_feed',
    page_size: String(opts.page_size ?? 50),
    source: opts.source ?? 'home',
    speech_metadata: 'true',
    use_serializer: 'HomeFeedSpeechWithoutSharedGroupsSerializer',
  });
  return otterFetch(opts.csrf, `/forward/api/v1/available_speeches?${params}`);
}

/**
 * Get recording details and transcript.
 */
export async function getRecording(
  opts: GetRecordingInput,
): Promise<GetRecordingOutput> {
  const params = new URLSearchParams({ otid: opts.otid });
  if (opts.userid !== undefined) {
    params.set('userid', String(opts.userid));
  }
  return otterFetch(opts.csrf, `/forward/api/v1/speech?${params}`);
}

// ============================================================================
// Speakers
// ============================================================================

/**
 * Get speakers for a recording.
 */
export async function getSpeakers(
  opts: GetSpeakersInput,
): Promise<GetSpeakersOutput> {
  const params = new URLSearchParams({ otid: opts.otid });
  if (opts.user_id !== undefined) {
    params.set('user_id', String(opts.user_id));
  }
  return otterFetch(opts.csrf, `/forward/api/v1/speakers?${params}`);
}

// ============================================================================
// AI Features
// ============================================================================

/**
 * Get AI-generated summary for a recording.
 */
export async function getAbstractSummary(
  opts: GetAbstractSummaryInput,
): Promise<GetAbstractSummaryOutput> {
  const params = new URLSearchParams({ otid: opts.otid });
  return otterFetch(opts.csrf, `/forward/api/v1/abstract_summary?${params}`);
}

/**
 * Get action items for a recording.
 */
export async function getActionItems(
  opts: GetActionItemsInput,
): Promise<GetActionItemsOutput> {
  const params = new URLSearchParams({ otid: opts.otid });
  return otterFetch(opts.csrf, `/forward/api/v1/speech_action_items?${params}`);
}

// ============================================================================
// Search
// ============================================================================

/**
 * Quick search for recordings (autocomplete-style).
 */
export async function quickSearch(
  opts: QuickSearchInput,
): Promise<QuickSearchOutput> {
  const params = new URLSearchParams({ search_string: opts.search_string });
  return otterFetch(
    opts.csrf,
    `/forward/api/v1/get_best_search_matches?${params}`,
  );
}

/**
 * Advanced search with relevance scoring.
 */
export async function advancedSearch(
  opts: AdvancedSearchInput,
): Promise<AdvancedSearchOutput> {
  const params = new URLSearchParams({
    appid: 'otter-web',
    query: opts.query,
    relevance: String(opts.relevance ?? true),
    size: String(opts.size ?? 500),
  });
  if (opts.session_id) {
    params.set('session_id', opts.session_id);
  }
  return otterFetch(opts.csrf, `/forward/api/v1/advanced_search?${params}`);
}

// ============================================================================
// Channels (Groups)
// ============================================================================

/**
 * List all channels/groups.
 */
export async function listChannels(
  opts: ListChannelsInput,
): Promise<ListChannelsOutput> {
  const params = new URLSearchParams({
    use_optimized_group_list: 'true',
    use_optimized_serializer: 'true',
    simple_group: 'true',
  });
  return otterFetch(opts.csrf, `/forward/api/v1/list_groups?${params}`);
}

/**
 * Get channel details.
 */
export async function getChannel(
  opts: GetChannelInput,
): Promise<GetChannelOutput> {
  const params = new URLSearchParams({ group_id: String(opts.group_id) });
  return otterFetch(opts.csrf, `/forward/api/v1/get_group?${params}`);
}

/**
 * Get members of a channel.
 */
export async function getChannelMembers(
  opts: GetChannelMembersInput,
): Promise<GetChannelMembersOutput> {
  const params = new URLSearchParams({ group_id: String(opts.group_id) });
  return otterFetch(opts.csrf, `/forward/api/v1/get_group_members?${params}`);
}

/**
 * Get recordings/messages in a channel.
 */
export async function getChannelMessages(
  opts: GetChannelMessagesInput,
): Promise<GetChannelMessagesOutput> {
  const params = new URLSearchParams({
    id: String(opts.id),
    'page[number]': String(opts.page_number ?? 1),
    include_deleted_msg: String(opts.include_deleted_msg ?? false),
  });
  return otterFetch(
    opts.csrf,
    `/forward/api/v1/channels/relationships/messages?${params}`,
  );
}

/**
 * Mark channel as visited.
 */
export async function markChannelVisited(
  opts: MarkChannelVisitedInput,
): Promise<void> {
  const params = new URLSearchParams({ group_id: String(opts.group_id) });
  await otterFetch(opts.csrf, `/forward/api/v1/set_group_visit?${params}`, {
    method: 'POST',
  });
}

// ============================================================================
// Chat
// ============================================================================

/**
 * List recent chat sessions.
 */
export async function getChatSessions(
  opts: GetChatSessionsInput,
): Promise<GetChatSessionsOutput> {
  const params = new URLSearchParams({
    limit: String(opts.limit ?? 10),
  });
  return otterFetch(opts.csrf, `/forward/api/v1/chat_sessions?${params}`);
}

/**
 * Get chat message history.
 */
export async function getChatMessageHistory(
  opts: GetChatMessageHistoryInput,
): Promise<GetChatMessageHistoryOutput> {
  const params = new URLSearchParams({
    thread_scope: opts.thread_scope ?? 'user_session',
    page_size: String(opts.page_size ?? 10),
  });
  if (opts.thread_uuid) {
    params.set('thread_uuid', opts.thread_uuid);
  }
  return otterFetch(
    opts.csrf,
    `/forward/api/v1/list_chat_message_history?${params}`,
  );
}

/**
 * Send a message to Otter AI chat.
 * Uses multipart/form-data as required by the API.
 */
export async function postChatMessage(
  opts: PostChatMessageInput,
): Promise<PostChatMessageOutput> {
  const formData = new FormData();
  formData.append('thread_uuid', opts.thread_uuid);
  formData.append('thread_scope', opts.thread_scope ?? 'user_session');
  formData.append('blocks', opts.blocks);
  formData.append('use_agentic_chat', String(opts.use_agentic_chat ?? true));

  return otterFormPost(
    opts.csrf,
    '/forward/api/v1/chat_post_message',
    formData,
  );
}

// ============================================================================
// Write Operations
// ============================================================================

/**
 * Rename a recording title.
 */
export async function renameRecording(
  opts: RenameRecordingInput,
): Promise<RenameRecordingOutput> {
  const params = new URLSearchParams({
    otid: opts.otid,
    title: opts.title,
  });
  return otterFetch(opts.csrf, `/forward/api/v1/set_speech_title?${params}`, {
    method: 'POST',
  });
}

/**
 * Permanently delete a recording.
 */
export async function deleteRecording(
  opts: DeleteRecordingInput,
): Promise<DeleteRecordingOutput> {
  const params = new URLSearchParams({ otid: opts.otid });
  return otterFetch(opts.csrf, `/forward/api/v1/delete_speech?${params}`, {
    method: 'POST',
  });
}
