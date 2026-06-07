/**
 * Instagram Library: Direct Messages
 *
 * getDirectInbox, getDirectThread
 */

import { getCookie, getAppId, graphqlPrimary } from './helpers';
import { Validation, ContractDrift, UpstreamError, throwForStatus } from '@vallum/_runtime';
import type {
  GetDirectInboxInput,
  GetDirectInboxOutput,
  GetDirectThreadInput,
  GetDirectThreadOutput,
} from './schemas';

// ============================================================================
// getDirectInbox
// ============================================================================

/** REST API folder number → schema string enum */
const FOLDER_MAP: Record<number, 'PRIMARY' | 'GENERAL'> = {
  0: 'PRIMARY',
  1: 'GENERAL',
};
/** REST API system_folder number → schema string enum */
const SYSTEM_FOLDER_MAP: Record<number, 'INBOX' | 'PENDING' | 'SPAM'> = {
  0: 'INBOX',
  1: 'PENDING',
  2: 'SPAM',
};

interface RESTInboxThread {
  thread_id?: string;
  thread_v2_id?: string;
  messaging_thread_key?: string | number;
  thread_title?: string;
  thread_type?: string;
  thread_subtype?: number | string;
  is_group?: boolean;
  is_pin?: boolean;
  muted?: boolean;
  folder?: number;
  system_folder?: number;
  marked_as_unread?: boolean;
  has_older?: boolean;
  last_activity_at?: number;
  users?: Array<{
    pk?: string;
    pk_id?: string;
    username?: string;
    full_name?: string;
    profile_pic_url?: string;
    is_verified?: boolean;
    interop_messaging_user_fbid?: string | number;
    friendship_status?: {
      is_restricted?: boolean;
      blocking?: boolean;
    };
  }>;
  items?: Array<{
    item_id?: string;
    message_id?: string;
    user_id?: string;
    timestamp?: number;
    item_type?: string;
    text?: string;
    is_sent_by_viewer?: boolean;
  }>;
  last_permanent_item?: {
    text?: string;
    timestamp?: number;
  };
}

interface RESTInboxResponse {
  status?: string;
  message?: string;
  inbox?: {
    threads?: RESTInboxThread[];
    has_older?: boolean;
    unseen_count?: number;
    prev_cursor?: {
      cursor_timestamp_seconds?: number | string;
      cursor_relevancy_score?: number | string;
      cursor_thread_v2_id?: string;
    };
  };
  pending_requests_total?: number;
}

/** Map schema folder values to REST API folder numbers */
const FOLDER_INPUT_MAP: Record<string, string> = {
  inbox: '',
  general: '1',
};

const VALID_SELECTED_FILTERS = new Set(['unread', 'groups']);

export async function getDirectInbox(
  params: GetDirectInboxInput,
): Promise<GetDirectInboxOutput> {
  if (params.limit !== undefined && params.limit < 1) {
    throw new Validation('getDirectInbox: limit must be >= 1. Got ' + params.limit);
  }

  if (params.folder !== undefined && !(params.folder in FOLDER_INPUT_MAP)) {
    throw new Validation(
      `getDirectInbox: invalid folder "${params.folder}". Must be one of: ${Object.keys(FOLDER_INPUT_MAP).join(', ')}`,
    );
  }

  if (
    params.selectedFilter !== undefined &&
    !VALID_SELECTED_FILTERS.has(params.selectedFilter)
  ) {
    throw new Validation(
      `getDirectInbox: invalid selectedFilter "${params.selectedFilter}". Must be one of: ${[...VALID_SELECTED_FILTERS].join(', ')}`,
    );
  }

  const origin = window.location.origin;
  const folderValue = params.folder ? FOLDER_INPUT_MAP[params.folder] : '';
  const qs = new URLSearchParams({
    persistentBadging: 'true',
    folder: folderValue,
    limit: String(params.limit ?? 20),
    thread_message_limit: '1',
  });
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.selectedFilter) qs.set('selected_filter', params.selectedFilter);

  const resp = await fetch(
    `${origin}/api/v1/direct_v2/inbox/?${qs.toString()}`,
    {
      method: 'GET',
      credentials: 'include',
      headers: {
        accept: '*/*',
        'x-csrftoken': params.csrf,
        'x-ig-app-id': getAppId(),
        'x-requested-with': 'XMLHttpRequest',
      },
    },
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => undefined);
    throwForStatus(resp.status, `Instagram API error: HTTP ${resp.status} ${resp.statusText}. Endpoint: /api/v1/direct_v2/inbox/. Body: ${text?.slice(0, 500)}`);
  }

  const data: RESTInboxResponse = await resp.json();
  if (data.status !== 'ok') {
    throw new UpstreamError(
      `Instagram inbox request failed: ${data.message ?? 'unknown error'}`,
    );
  }

  const inbox = data.inbox;
  if (!inbox) {
    throw new ContractDrift('Failed to parse DM inbox response: missing inbox field');
  }

  const rawThreads = inbox.threads || [];

  const threads = rawThreads.map((thread) => {
    const participants = (thread.users || []).map((user) => ({
      userId: user.pk || user.pk_id || '',
      username: user.username || '',
      fullName: user.full_name || '',
      profilePicUrl: user.profile_pic_url || '',
      isVerified: Boolean(user.is_verified),
      interopMessagingFbid:
        user.interop_messaging_user_fbid != null
          ? String(user.interop_messaging_user_fbid)
          : undefined,
      isRestricted: user.friendship_status?.is_restricted,
      isBlocking: user.friendship_status?.blocking,
    }));

    // Get last message preview from items or last_permanent_item
    const items = thread.items || [];
    const lastItem = items[0];
    const lastMessageText =
      lastItem?.text || thread.last_permanent_item?.text || '';
    // REST timestamps are in microseconds; convert to milliseconds
    const lastMessageTimestamp = lastItem?.timestamp
      ? Math.floor(lastItem.timestamp / 1000)
      : thread.last_activity_at
        ? Math.floor(thread.last_activity_at / 1000)
        : 0;

    // Map thread_subtype numbers to string names
    const subtypeMap: Record<number, string> = {
      1003: 'IG_ONLY_ONE_TO_ONE',
      1004: 'IG_ONLY_GROUP',
    };
    const threadSubtype =
      typeof thread.thread_subtype === 'number'
        ? subtypeMap[thread.thread_subtype] || String(thread.thread_subtype)
        : thread.thread_subtype;

    return {
      threadId: thread.thread_id || '',
      threadKey: String(thread.messaging_thread_key || ''),
      threadTitle:
        thread.thread_title || participants.map((p) => p.username).join(', '),
      participants,
      lastMessageText,
      lastMessageTimestamp,
      isGroup: Boolean(thread.is_group),
      hasOlderMessages: Boolean(thread.has_older) || items.length > 0,
      unreadCount: thread.marked_as_unread ? 1 : 0,
      threadSubtype,
      isPinned: thread.is_pin,
      isMuted: thread.muted,
      folder:
        thread.folder !== undefined ? FOLDER_MAP[thread.folder] : undefined,
      systemFolder:
        thread.system_folder !== undefined
          ? SYSTEM_FOLDER_MAP[thread.system_folder]
          : undefined,
      threadImageUrl: null as string | null,
    };
  });

  // Build pagination cursor from prev_cursor
  const prevCursor = inbox.prev_cursor;
  const cursorStr =
    prevCursor && inbox.has_older ? JSON.stringify(prevCursor) : null;

  return {
    threads,
    totalCount: threads.length,
    hasMore: Boolean(inbox.has_older),
    cursor: cursorStr,
    unseenCount: inbox.unseen_count,
    pendingRequestsTotal: data.pending_requests_total,
  };
}

// ============================================================================
// getDirectThread
// ============================================================================

interface IGThreadResponse {
  data?: {
    get_slide_thread_nullable?: {
      as_ig_direct_thread?: {
        thread_id?: string;
        thread_fbid?: string;
        thread_key?: string;
        thread_title?: string;
        is_group?: boolean;
        last_activity_timestamp_ms?: number | string;
        users?: Array<{
          id?: string;
          username?: string;
          full_name?: string;
          profile_pic_url?: string;
          is_verified?: boolean;
        }>;
        slide_messages?: {
          edges?: Array<{
            node?: {
              message_id?: string;
              id?: string;
              sender_fbid?: string;
              timestamp_ms?: string;
              content?: {
                __typename?: string;
                text_body?: string;
              };
              content_type?: string;
              text_body?: string;
              __typename?: string;
              sender?: {
                igid?: string;
              };
            };
          }>;
          page_info?: {
            has_previous_page?: boolean;
            start_cursor?: string;
          };
        };
      };
    };
  };
}

export async function getDirectThread(
  params: GetDirectThreadInput,
): Promise<GetDirectThreadOutput> {
  const csrf = getCookie('csrftoken');
  if (!csrf) {
    throw new Validation(
      'getDirectThread: CSRF token not found in cookies. Are you logged into Instagram?',
    );
  }

  const variables: Record<string, unknown> = {
    thread_fbid: params.threadKey,
    min_uq_seq_id: null,
    __relay_internal__pv__IGDEnableOffMsysMessagesListQErelayprovider: true,
    __relay_internal__pv__IGDEnableOffMsysPinnedMessagesQErelayprovider: false,
    __relay_internal__pv__IGDInitialMessagePageCountrelayprovider:
      params.limit ?? 20,
    __relay_internal__pv__IGDEnableOffMsysComposerQErelayprovider: false,
  };
  if (params.cursor) {
    variables.before = params.cursor;
  }

  const data = await graphqlPrimary<IGThreadResponse>(
    csrf,
    '26455407970733868',
    'IGDThreadDetailMainViewContainerQuery',
    variables,
  );

  const threadData = data?.data?.get_slide_thread_nullable?.as_ig_direct_thread;
  if (!threadData) {
    throw new ContractDrift(
      `Failed to parse thread response for thread ${params.threadKey}. Keys: ${JSON.stringify(Object.keys(data?.data ?? {}))}`,
    );
  }

  const participants = (threadData.users || []).map((user) => ({
    userId: user.id || '',
    username: user.username || '',
    fullName: user.full_name || '',
    profilePicUrl: user.profile_pic_url || '',
    isVerified: Boolean(user.is_verified),
  }));

  const slideMessages = threadData.slide_messages;
  const msgEdges = slideMessages?.edges || [];
  const pageInfo = slideMessages?.page_info;

  const messages = msgEdges
    .map((edge) => {
      const msg = edge.node;
      if (!msg) return null;

      // Extract text from content object or direct text_body
      let text: string | null = null;
      if (msg.content?.text_body) {
        text = msg.content.text_body;
      } else if (msg.text_body) {
        text = msg.text_body;
      }

      // Determine message type from content_type (always present, uppercase like "TEXT")
      const messageType = msg.content_type
        ? msg.content_type.toLowerCase()
        : 'unknown';

      // Use sender.igid (Instagram user ID) which matches participant userId values.
      // Falls back to sender_fbid (Meta FBID) if igid is unavailable.
      const senderId = msg.sender?.igid || msg.sender_fbid || '';

      return {
        messageId: msg.message_id || msg.id || '',
        senderId,
        timestamp: Number(msg.timestamp_ms || 0),
        text,
        messageType,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  return {
    threadId: threadData.thread_id || params.threadKey,
    threadTitle:
      threadData.thread_title || participants.map((p) => p.username).join(', '),
    isGroup: Boolean(threadData.is_group),
    participants,
    messages,
    totalCount: messages.length,
    hasMore: Boolean(pageInfo?.has_previous_page),
    cursor: pageInfo?.start_cursor || null,
  };
}
