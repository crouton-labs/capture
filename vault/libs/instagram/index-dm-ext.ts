/**
 * Instagram Library: DM Extensions
 *
 * getThreadInfo, getMessageReactions, sendMessage
 */

import { ContractDrift } from '@vallum/_runtime';
import { graphqlPrimary } from './helpers';
import type {
  GetThreadInfoInput,
  GetThreadInfoOutput,
  GetMessageReactionsInput,
  GetMessageReactionsOutput,
  SendMessageInput,
  SendMessageOutput,
  SendNewMessageInput,
  SendNewMessageOutput,
} from './schemas-dm-ext';

/**
 * Generate a 19-digit offline_threading_id matching the web client's format
 * (timestamp-based bigint concatenated with random digits).
 */
function generateOfflineThreadingId(): string {
  const ts = Date.now().toString();
  let rand = '';
  for (let i = 0; i < 19 - ts.length; i++) {
    rand += Math.floor(Math.random() * 10).toString();
  }
  return ts + rand;
}

interface IGDirectTextSendResponse {
  data?: {
    xig_direct_text_send_with_slide_messaging_response?: {
      message_id?: string;
      timestamp_ms?: string;
      id?: string;
      thread_id?: string;
      thread_fbid?: string;
    };
  };
  errors?: Array<{ message?: string; severity?: string }>;
}

// ============================================================================
// getThreadInfo
// ============================================================================

interface IGThreadInfoUser {
  id?: string;
  username?: string;
  full_name?: string;
  profile_pic_url?: string;
  is_verified?: boolean;
  interop_messaging_user_fbid?: string;
  ai_agent_type?: string | null;
  friendship_status?: {
    is_restricted?: boolean;
    blocking?: boolean;
  };
}

interface IGThreadInfoThread {
  thread_key?: string;
  thread_fbid?: string;
  thread_igid?: string;
  thread_title?: string;
  thread_subtype?: string;
  is_group?: boolean;
  is_muted?: boolean;
  folder?: string | null;
  messaging_folder_tag?: string | null;
  thread_image_url?: string | null;
  approval_required_for_new_members?: boolean;
  admin_user_ids?: Array<string | number>;
  reachability_status?: string | null;
  nicknames?: Array<{ participant_id?: string; nickname?: string }>;
  viewer_id?: string;
  instamadillo_cutover?: unknown;
  users?: IGThreadInfoUser[];
}

interface IGThreadInfoResponse {
  data?: {
    xdt_ig_direct_thread_info?: IGThreadInfoThread;
    get_slide_thread_nullable?: {
      as_ig_direct_thread?: IGThreadInfoThread;
    };
  };
}

export async function getThreadInfo(
  params: GetThreadInfoInput,
): Promise<GetThreadInfoOutput> {
  const variables: Record<string, unknown> = {
    thread_fbid: params.threadKey,
  };
  if (params.minUqSeqId !== undefined) {
    variables.min_uq_seq_id = params.minUqSeqId;
  }

  const data = await graphqlPrimary<IGThreadInfoResponse>(
    params.csrf,
    '33532752006368982',
    'IGDInboxHeaderOffMsysQuery',
    variables,
  );

  // Try both possible response paths
  const threadData =
    data?.data?.get_slide_thread_nullable?.as_ig_direct_thread ||
    data?.data?.xdt_ig_direct_thread_info;

  if (!threadData) {
    throw new ContractDrift(
      `getThreadInfo: Failed to parse thread info for thread ${params.threadKey}. Keys: ${JSON.stringify(Object.keys(data?.data || {}))}`,
    );
  }

  const adminIds = (threadData.admin_user_ids || []).map(String);
  const adminSet = new Set(adminIds);

  const members = (threadData.users || []).map((user) => ({
    userId: user.id || '',
    username: user.username || '',
    fullName: user.full_name || '',
    profilePicUrl: user.profile_pic_url || '',
    isVerified: Boolean(user.is_verified),
    isAdmin: adminSet.has(user.id || ''),
  }));

  const nicknames = (threadData.nicknames || [])
    .map((n) => n.nickname)
    .filter((n): n is string => typeof n === 'string');

  return {
    threadKey: threadData.thread_key || params.threadKey,
    threadFbid: threadData.thread_fbid || '',
    threadTitle:
      threadData.thread_title || members.map((m) => m.username).join(', '),
    isGroup: Boolean(threadData.is_group),
    isMuted: Boolean(threadData.is_muted),
    members,
    adminUserIds: adminIds,
    approvalRequiredForNewMembers: Boolean(
      threadData.approval_required_for_new_members,
    ),
    threadImageUrl: threadData.thread_image_url ?? null,
    folder: threadData.folder ?? null,
    threadSubtype: threadData.thread_subtype ?? null,
    reachabilityStatus:
      (threadData.reachability_status as 'REACHABLE' | 'UNREACHABLE') ?? null,
    messagingFolderTag:
      (threadData.messaging_folder_tag as 'INBOX' | 'PENDING' | 'SPAM') ?? null,
    nicknames,
  };
}

// ============================================================================
// getMessageReactions
// ============================================================================

interface IGReactionsResponse {
  data?: {
    get_slide_message?: {
      reactions?: Array<{
        reaction?: string;
        sender_fbid?: string;
      }>;
      message_id?: string;
    };
    get_slide_thread_nullable?: {
      as_ig_direct_thread?: {
        users?: Array<{
          interop_messaging_user_fbid?: string;
          full_name?: string;
          profile_pic_url?: string;
          username?: string;
          id?: string;
        }>;
        thread_fbid?: string;
      };
    };
    xdt_viewer?: {
      user?: {
        interop_messaging_user_fbid?: string;
        full_name?: string;
        profile_pic_url?: string;
        username?: string;
        id?: string;
      };
    };
  };
}

export async function getMessageReactions(
  params: GetMessageReactionsInput,
): Promise<GetMessageReactionsOutput> {
  const data = await graphqlPrimary<IGReactionsResponse>(
    params.csrf,
    '26135705119358840',
    'IGDReactionsDialogOffMsysQuery',
    {
      message_id: params.messageId,
      thread_fbid: params.threadKey,
    },
  );

  const slideMessage = data?.data?.get_slide_message;
  if (!slideMessage) {
    throw new ContractDrift(
      `getMessageReactions: Unexpected response structure. Expected "get_slide_message" key. Got keys: ${JSON.stringify(Object.keys(data?.data || {}))}. Message: ${params.messageId}, Thread: ${params.threadKey}`,
    );
  }

  // Build user lookup from thread participants + viewer
  const userMap = new Map<
    string,
    { username: string; fullName: string; profilePicUrl: string }
  >();
  const viewer = data?.data?.xdt_viewer?.user;
  if (viewer?.interop_messaging_user_fbid) {
    userMap.set(viewer.interop_messaging_user_fbid, {
      username: viewer.username || '',
      fullName: viewer.full_name || '',
      profilePicUrl: viewer.profile_pic_url || '',
    });
  }
  const threadUsers =
    data?.data?.get_slide_thread_nullable?.as_ig_direct_thread?.users || [];
  for (const u of threadUsers) {
    if (u.interop_messaging_user_fbid) {
      userMap.set(u.interop_messaging_user_fbid, {
        username: u.username || '',
        fullName: u.full_name || '',
        profilePicUrl: u.profile_pic_url || '',
      });
    }
  }

  // Parse reactions from get_slide_message; group by emoji
  const rawReactions = slideMessage.reactions || [];
  const grouped = new Map<string, string[]>();
  for (const r of rawReactions) {
    if (!r.reaction || !r.sender_fbid) continue;
    const existing = grouped.get(r.reaction) || [];
    existing.push(r.sender_fbid);
    grouped.set(r.reaction, existing);
  }

  const reactions: Array<{
    emoji: string;
    senderIds: string[];
    senders: Array<{
      fbid: string;
      username: string;
      fullName: string;
      profilePicUrl: string;
    }>;
    count: number;
  }> = [];
  for (const [emoji, senderIds] of grouped) {
    reactions.push({
      emoji,
      senderIds,
      senders: senderIds.map((fbid) => {
        const info = userMap.get(fbid);
        return {
          fbid,
          username: info?.username || '',
          fullName: info?.fullName || '',
          profilePicUrl: info?.profilePicUrl || '',
        };
      }),
      count: senderIds.length,
    });
  }

  const totalCount = reactions.reduce((sum, r) => sum + r.count, 0);

  return {
    messageId: params.messageId,
    reactions,
    totalCount,
  };
}

// ============================================================================
// sendMessage
// ============================================================================

export async function sendMessage(
  params: SendMessageInput,
): Promise<SendMessageOutput> {
  const offlineThreadingId = generateOfflineThreadingId();

  const variables: Record<string, unknown> = {
    ig_thread_igid: params.threadKey,
    offline_threading_id: offlineThreadingId,
    recipient_igids: null,
    replied_to_client_context: params.replyToClientContext ?? null,
    replied_to_item_id: params.replyToItemId ?? null,
    reply_to_message_id: null,
    sampled: null,
    text: { sensitive_string_value: params.text },
    mentions: [],
    mentioned_user_ids: [],
    commands: null,
    forwarded_from_thread_id: null,
    is_forwarded_from_own_message: null,
    send_attribution: 'igd_web_chat_tab:in_thread',
  };

  const data = await graphqlPrimary<IGDirectTextSendResponse>(
    params.csrf,
    '27548200411446444',
    'IGDirectTextSendMutation',
    variables,
  );

  const result = data?.data?.xig_direct_text_send_with_slide_messaging_response;
  if (!result?.message_id) {
    const firstErr = data?.errors?.[0]?.message;
    const detail = firstErr
      ? firstErr
      : `Unexpected response. Keys: ${JSON.stringify(Object.keys(data?.data || {}))}`;
    throw new ContractDrift(
      `sendMessage: Instagram mutation returned no message_id. Thread: ${params.threadKey}. ${detail}`,
    );
  }

  return {
    success: true,
    messageId: result.message_id,
    clientContext: offlineThreadingId,
  };
}

// ============================================================================
// sendNewMessage
// ============================================================================

export async function sendNewMessage(
  params: SendNewMessageInput,
): Promise<SendNewMessageOutput> {
  const offlineThreadingId = generateOfflineThreadingId();

  const variables: Record<string, unknown> = {
    ig_thread_igid: null,
    offline_threading_id: offlineThreadingId,
    recipient_igids: [params.userId],
    replied_to_client_context: null,
    replied_to_item_id: null,
    reply_to_message_id: null,
    sampled: null,
    text: { sensitive_string_value: params.text },
    mentions: [],
    mentioned_user_ids: [],
    commands: null,
    forwarded_from_thread_id: null,
    is_forwarded_from_own_message: null,
    send_attribution: 'igd_web_chat_tab:new_message',
  };

  const data = await graphqlPrimary<IGDirectTextSendResponse>(
    params.csrf,
    '27548200411446444',
    'IGDirectTextSendMutation',
    variables,
  );

  const result = data?.data?.xig_direct_text_send_with_slide_messaging_response;
  if (!result?.message_id) {
    const firstErr = data?.errors?.[0]?.message;
    const detail = firstErr
      ? firstErr
      : `Unexpected response. Keys: ${JSON.stringify(Object.keys(data?.data || {}))}`;
    throw new ContractDrift(
      `sendNewMessage: Instagram mutation returned no message_id. User: ${params.userId}. ${detail}`,
    );
  }

  return {
    success: true,
    messageId: result.message_id,
    clientContext: offlineThreadingId,
  };
}
