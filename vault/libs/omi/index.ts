// Types from schemas - single source of truth
export type {
  ActionItem,
  StructuredData,
  TranscriptSegment,
  ConversationSummary,
  ConversationDetail,
  Folder,
  Memory,
  Person,
  ChatMessage,
  GetContextInput,
  GetContextOutput,
  ListConversationsInput,
  ListConversationsOutput,
  GetConversationInput,
  GetConversationOutput,
  SearchConversationsInput,
  SearchConversationsOutput,
  ListMemoriesInput,
  ListMemoriesOutput,
  ListActionItemsInput,
  ListActionItemsOutput,
  ListFoldersInput,
  ListFoldersOutput,
  ListPeopleInput,
  ListPeopleOutput,
  SendMessageInput,
  SendMessageOutput,
  GetMessagesInput,
  GetMessagesOutput,
} from './schemas';

import { Validation, ContractDrift, throwForStatus } from '@vallum/_runtime';

// ============================================================================
// Helpers
// ============================================================================

function getFirebaseToken(): Promise<{
  token: string;
  uid: string;
  email: string;
}> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('firebaseLocalStorageDb');
    req.onerror = () => reject(new Error('Failed to open Firebase IndexedDB'));
    req.onsuccess = () => {
      const db = req.result;
      const storeNames = Array.from(db.objectStoreNames);
      if (storeNames.length === 0) {
        reject(
          new Error('No object stores in Firebase IndexedDB. Not logged in?'),
        );
        return;
      }
      const tx = db.transaction(storeNames[0], 'readonly');
      const store = tx.objectStore(storeNames[0]);
      const getAll = store.getAll();
      getAll.onsuccess = () => {
        const items = getAll.result;
        if (items.length === 0) {
          reject(new Error('No Firebase auth entries. Not logged in to Omi.'));
          return;
        }
        const authUser = items[0]?.value;
        const token = authUser?.stsTokenManager?.accessToken;
        if (!token) {
          reject(new Error('Firebase token not found in IndexedDB'));
          return;
        }
        resolve({
          token,
          uid: authUser.uid ?? '',
          email: authUser.email ?? '',
        });
      };
      getAll.onerror = () =>
        reject(new Error('Failed to read Firebase auth entries'));
    };
  });
}

async function resolveToken(token?: string): Promise<string> {
  if (token) return token;
  const ctx = await getFirebaseToken();
  return ctx.token;
}

async function apiGet(
  path: string,
  token: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<Response> {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  const resp = await fetch(url.toString(), {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    credentials: 'include',
  });
  if (!resp.ok) {
    throwForStatus(resp.status);
  }
  return resp;
}

async function apiPost(
  path: string,
  token: string,
  body: Record<string, unknown>,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<Response> {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throwForStatus(resp.status);
  }
  return resp;
}

// ============================================================================
// Context
// ============================================================================

export async function getContext(): Promise<{
  token: string;
  uid: string;
  email: string;
}> {
  if (!window.location.hostname.includes('omi.me')) {
    throw new Validation(
      `Must be on app.omi.me. Current URL: ${window.location.href}`,
    );
  }
  return getFirebaseToken();
}

// ============================================================================
// Conversations
// ============================================================================

export async function listConversations(args: {
  token?: string;
  limit?: number;
  offset?: number;
  folderId?: string;
  starred?: boolean;
  startDate?: string;
  endDate?: string;
}): Promise<{
  conversations: Array<Record<string, unknown>>;
}> {
  const token = await resolveToken(args.token);
  const resp = await apiGet('/api/proxy/v1/conversations', token, {
    limit: args.limit ?? 20,
    offset: args.offset ?? 0,
    statuses: 'processing,completed',
    include_discarded: 'true',
    folder_id: args.folderId,
    starred: args.starred,
    start_date: args.startDate,
    end_date: args.endDate,
  });
  const data = await resp.json();
  return { conversations: Array.isArray(data) ? data : [] };
}

export async function getConversation(args: {
  token?: string;
  conversationId: string;
}): Promise<Record<string, unknown>> {
  const token = await resolveToken(args.token);
  const resp = await apiGet(
    `/api/proxy/v1/conversations/${args.conversationId}`,
    token,
  );
  return resp.json();
}

export async function searchConversations(args: {
  token?: string;
  query: string;
  page?: number;
  perPage?: number;
  startDate?: string;
  endDate?: string;
}): Promise<{
  items: Array<Record<string, unknown>>;
  totalPages: number;
  currentPage: number;
  perPage: number;
}> {
  const token = await resolveToken(args.token);
  const resp = await apiPost('/api/proxy/v1/conversations/search', token, {
    query: args.query,
    page: args.page ?? 1,
    per_page: args.perPage ?? 10,
    start_date: args.startDate,
    end_date: args.endDate,
  });
  const data = await resp.json();
  return {
    items: data.items ?? [],
    totalPages: data.total_pages ?? 0,
    currentPage: data.current_page ?? 1,
    perPage: data.per_page ?? 10,
  };
}

// ============================================================================
// Memories
// ============================================================================

export async function listMemories(args: {
  token?: string;
  limit?: number;
  offset?: number;
}): Promise<{ memories: Array<Record<string, unknown>> }> {
  const token = await resolveToken(args.token);
  const resp = await apiGet('/api/proxy/v3/memories', token, {
    limit: args.limit ?? 25,
    offset: args.offset ?? 0,
  });
  const data = await resp.json();
  return { memories: Array.isArray(data) ? data : [] };
}

// ============================================================================
// Action Items
// ============================================================================

export async function listActionItems(args: {
  token?: string;
  limit?: number;
  offset?: number;
}): Promise<{ actionItems: Array<Record<string, unknown>> }> {
  const token = await resolveToken(args.token);
  const resp = await apiGet('/api/proxy/v1/action-items', token, {
    limit: args.limit ?? 100,
    offset: args.offset ?? 0,
  });
  const data = await resp.json();
  return { actionItems: data.action_items ?? [] };
}

// ============================================================================
// Folders
// ============================================================================

export async function listFolders(args: {
  token?: string;
}): Promise<{ folders: Array<Record<string, unknown>> }> {
  const token = await resolveToken(args.token);
  const resp = await apiGet('/api/proxy/v1/folders', token);
  const data = await resp.json();
  return { folders: Array.isArray(data) ? data : [] };
}

// ============================================================================
// People
// ============================================================================

export async function listPeople(args: {
  token?: string;
}): Promise<{ people: Array<Record<string, unknown>> }> {
  const token = await resolveToken(args.token);
  const resp = await apiGet('/api/proxy/v1/users/people', token);
  const data = await resp.json();
  return { people: Array.isArray(data) ? data : [] };
}

// ============================================================================
// Chat
// ============================================================================

export async function sendMessage(args: {
  token?: string;
  text: string;
}): Promise<{ response: string; messageId?: string }> {
  const token = await resolveToken(args.token);
  const resp = await fetch('/api/proxy/v2/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    credentials: 'include',
    body: JSON.stringify({ text: args.text }),
  });

  if (!resp.ok) {
    throwForStatus(resp.status);
  }

  // Response is SSE stream with format:
  // "think: ..." lines (thinking/status)
  // "data: <token>" lines (content tokens, one per line)
  // "__CRLF__" in data = newline in content
  const reader = resp.body?.getReader();
  if (!reader) {
    throw new ContractDrift('No response body from Omi chat');
  }

  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const token = line.slice(6);
      if (token === '[DONE]') continue;
      fullText += token;
    }
  }

  // Replace __CRLF__ markers with actual newlines
  fullText = fullText.replace(/__CRLF__/g, '\n');

  return { response: fullText.trim() };
}

export async function getMessages(args: {
  token?: string;
}): Promise<{ messages: Array<Record<string, unknown>> }> {
  const token = await resolveToken(args.token);
  const resp = await apiGet('/api/proxy/v2/messages', token);
  const data = await resp.json();
  return { messages: Array.isArray(data) ? data : [] };
}
