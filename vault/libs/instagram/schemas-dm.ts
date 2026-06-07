import { z } from 'zod';

import { CsrfParam } from './schemas-common';

// ============================================================================
// Direct Messages
// ============================================================================

export const ThreadParticipantSchema = z.object({
  userId: z.string().describe('Participant numeric user ID'),
  username: z.string().describe('Participant username'),
  fullName: z.string().describe('Participant display name'),
  profilePicUrl: z.string().describe('Participant profile picture URL'),
  isVerified: z.boolean().describe('Whether participant is verified'),
  interopMessagingFbid: z
    .string()
    .optional()
    .describe('Meta cross-platform FBID for messaging interop'),
  isRestricted: z
    .boolean()
    .optional()
    .describe('Whether the participant is restricted by the viewer'),
  isBlocking: z
    .boolean()
    .optional()
    .describe('Whether the viewer is blocking this participant'),
});

export type ThreadParticipant = z.infer<typeof ThreadParticipantSchema>;

export const InboxThreadSchema = z.object({
  threadId: z.string().describe('Thread ID (39-digit numeric string)'),
  threadKey: z
    .string()
    .describe('Thread key (short numeric ID, used by getDirectThread)'),
  threadTitle: z
    .string()
    .describe('Thread title (participant name for 1:1, group name for groups)'),
  participants: z
    .array(ThreadParticipantSchema)
    .describe('Thread participants (excluding authenticated user)'),
  lastMessageText: z.string().describe('Preview of the last message'),
  lastMessageTimestamp: z
    .number()
    .describe('Last message timestamp in milliseconds (Unix epoch)'),
  isGroup: z.boolean().describe('Whether this is a group thread'),
  hasOlderMessages: z
    .boolean()
    .describe('Whether the thread has more messages to load'),
  unreadCount: z.number().describe('Number of unread messages'),
  threadSubtype: z
    .string()
    .optional()
    .describe('Thread subtype (e.g. "IG_ONLY_ONE_TO_ONE", "IG_ONLY_GROUP")'),
  isPinned: z.boolean().optional().describe('Whether the thread is pinned'),
  isMuted: z.boolean().optional().describe('Whether the thread is muted'),
  folder: z
    .enum(['PRIMARY', 'GENERAL'])
    .optional()
    .describe('Instagram inbox folder classification'),
  systemFolder: z
    .enum(['INBOX', 'PENDING', 'SPAM'])
    .optional()
    .describe('System-level folder classification'),
  threadImageUrl: z
    .string()
    .nullable()
    .optional()
    .describe('Group thread image URL (null for 1:1 threads)'),
});

export type InboxThread = z.infer<typeof InboxThreadSchema>;

export const getDirectInboxSchema = {
  name: 'getDirectInbox',
  description:
    'List DM threads from the Instagram inbox with preview messages, participants, and unread counts.',
  notes:
    'Returns the most recent DM threads. Use threadKey from results to call getDirectThread for message history. Supports pagination via cursor, filtering by folder or read status, and configurable page size.',
  input: z.object({
    csrf: CsrfParam,
    limit: z
      .number()
      .min(1)
      .optional()
      .describe(
        'Maximum number of threads to return per page (default 20, minimum 1)',
      ),
    cursor: z
      .string()
      .optional()
      .describe(
        'Pagination cursor from a previous response to fetch the next page of threads',
      ),
    selectedFilter: z
      .enum(['unread', 'groups'])
      .optional()
      .describe(
        'Filter threads: "unread" returns only threads with unread messages, "groups" returns only group threads',
      ),
    folder: z
      .enum(['inbox', 'general'])
      .optional()
      .describe(
        'Inbox folder to fetch from: "inbox" (default, primary threads) or "general" (lower-priority threads). Pending message requests are not available through this endpoint.',
      ),
  }),
  output: z.object({
    threads: z
      .array(InboxThreadSchema)
      .describe('DM threads sorted by most recent activity'),
    totalCount: z.number().describe('Number of threads returned'),
    hasMore: z.boolean().describe('Whether more threads exist'),
    cursor: z
      .string()
      .nullable()
      .describe('Cursor for next page (JSON string), null if no more pages'),
    unseenCount: z
      .number()
      .optional()
      .describe('Number of unseen/unread threads in the inbox'),
    pendingRequestsTotal: z
      .number()
      .optional()
      .describe('Total number of pending message requests'),
  }),
};

export type GetDirectInboxInput = z.infer<typeof getDirectInboxSchema.input>;
export type GetDirectInboxOutput = z.infer<typeof getDirectInboxSchema.output>;

// ============================================================================
// Thread Messages
// ============================================================================

export const ThreadMessageSchema = z.object({
  messageId: z.string().describe('Message ID (mid.$ prefixed format)'),
  senderId: z
    .string()
    .describe(
      'Sender Instagram user ID (igid). Matches userId in participants for other users. For the authenticated user, this is their Instagram user ID (same as getContext().userId), NOT their Meta FBID.',
    ),
  timestamp: z
    .number()
    .describe('Message timestamp in milliseconds (Unix epoch)'),
  text: z
    .string()
    .nullable()
    .describe('Message text content (null for media-only messages)'),
  messageType: z
    .string()
    .describe(
      'Message type: text, media_share, reel_share, link, action_log, clip, voice_media, etc.',
    ),
});

export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

export const getDirectThreadSchema = {
  name: 'getDirectThread',
  description:
    'Get messages in a specific DM thread. Returns message history with sender, content, and timestamps.',
  notes:
    'Use threadKey from getDirectInbox (the short numeric ID, NOT the 39-digit threadId). Takes no csrf param; auth is read from browser cookies automatically. Supports pagination via cursor and configurable page size.',
  input: z.object({
    threadKey: z
      .string()
      .describe('Thread key from getDirectInbox (short numeric ID)'),
    limit: z
      .number()
      .min(1)
      .optional()
      .describe(
        'Maximum number of messages to return per page (default 20, minimum 1)',
      ),
    cursor: z
      .string()
      .optional()
      .describe(
        'Pagination cursor from a previous response to fetch older messages',
      ),
  }),
  output: z.object({
    threadId: z.string().describe('Thread ID (39-digit)'),
    threadTitle: z.string().describe('Thread title'),
    isGroup: z.boolean().describe('Whether this is a group thread'),
    participants: z
      .array(ThreadParticipantSchema)
      .describe('Thread participants (excluding the authenticated user)'),
    messages: z
      .array(ThreadMessageSchema)
      .describe('Messages sorted newest first'),
    totalCount: z.number().describe('Number of messages returned'),
    hasMore: z.boolean().describe('Whether more messages exist'),
    cursor: z
      .string()
      .nullable()
      .describe(
        'Cursor for older messages (may be non-null even when hasMore is false)',
      ),
  }),
};

export type GetDirectThreadInput = z.infer<typeof getDirectThreadSchema.input>;
export type GetDirectThreadOutput = z.infer<
  typeof getDirectThreadSchema.output
>;
