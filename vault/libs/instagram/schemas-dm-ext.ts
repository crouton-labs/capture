import { z } from 'zod';

import { CsrfParam } from './schemas-common';

// ============================================================================
// getThreadInfo
// ============================================================================

export const ThreadMemberSchema = z.object({
  userId: z.string().describe('Participant numeric user ID'),
  username: z.string().describe('Participant username'),
  fullName: z.string().describe('Participant display name'),
  profilePicUrl: z.string().describe('Participant profile picture URL'),
  isVerified: z.boolean().describe('Whether participant is verified'),
  isAdmin: z
    .boolean()
    .describe(
      'Whether participant is a group admin (always false for 1:1 threads)',
    ),
});

export type ThreadMember = z.infer<typeof ThreadMemberSchema>;

export const getThreadInfoSchema = {
  name: 'getThreadInfo',
  description:
    'Get detailed metadata for a DM thread including member list, mute status, and admin info for group threads.',
  notes:
    'Use threadKey from getDirectInbox (the short numeric ID). Returns thread-level settings not available from getDirectThread.',
  input: z.object({
    threadKey: z
      .string()
      .describe('Thread key from getDirectInbox (short numeric ID)'),
    csrf: CsrfParam,
    minUqSeqId: z
      .number()
      .optional()
      .describe(
        'Minimum unique sequence ID for sync optimization (from inbox state)',
      ),
  }),
  output: z.object({
    threadKey: z.string().describe('Thread key'),
    threadFbid: z
      .string()
      .describe('Thread FBID (Meta cross-platform thread identifier)'),
    threadTitle: z
      .string()
      .describe('Thread title (participant name or group name)'),
    isGroup: z.boolean().describe('Whether this is a group thread'),
    isMuted: z.boolean().describe('Whether the thread is muted'),
    members: z
      .array(ThreadMemberSchema)
      .describe('Thread members with admin status'),
    adminUserIds: z
      .array(z.string())
      .describe('User IDs of group admins (empty for 1:1 threads)'),
    approvalRequiredForNewMembers: z
      .boolean()
      .describe('Whether new members need admin approval (group threads only)'),
    threadImageUrl: z
      .string()
      .nullable()
      .describe('Group thread image URL (null for 1:1 threads)'),
    folder: z
      .string()
      .nullable()
      .describe('Thread folder (e.g. PRIMARY, GENERAL)'),
    threadSubtype: z
      .string()
      .nullable()
      .describe('Thread subtype (e.g. IG_ONLY_ONE_TO_ONE, IG_ONLY_GROUP)'),
    reachabilityStatus: z
      .enum(['REACHABLE', 'UNREACHABLE'])
      .nullable()
      .describe('Whether the thread participants are reachable'),
    messagingFolderTag: z
      .enum(['INBOX', 'PENDING', 'SPAM'])
      .nullable()
      .describe('Messaging folder classification'),
    nicknames: z
      .array(z.string())
      .describe('Participant nicknames set in the thread (empty if none)'),
  }),
};

export type GetThreadInfoInput = z.infer<typeof getThreadInfoSchema.input>;
export type GetThreadInfoOutput = z.infer<typeof getThreadInfoSchema.output>;

// ============================================================================
// getMessageReactions
// ============================================================================

export const ReactionSenderSchema = z.object({
  fbid: z
    .string()
    .describe('Sender FBID (Meta cross-platform user identifier)'),
  username: z
    .string()
    .describe('Sender username (empty if not in thread participants)'),
  fullName: z
    .string()
    .describe('Sender display name (empty if not in thread participants)'),
  profilePicUrl: z
    .string()
    .describe(
      'Sender profile picture URL (empty if not in thread participants)',
    ),
});

export type ReactionSender = z.infer<typeof ReactionSenderSchema>;

export const MessageReactionSchema = z.object({
  emoji: z.string().describe('Reaction emoji character'),
  senderIds: z
    .array(z.string())
    .describe('FBIDs of users who reacted with this emoji'),
  senders: z
    .array(ReactionSenderSchema)
    .describe(
      'Detailed sender info for each reactor (username, profile pic from thread participants)',
    ),
  count: z.number().describe('Number of users who reacted with this emoji'),
});

export type MessageReaction = z.infer<typeof MessageReactionSchema>;

export const getMessageReactionsSchema = {
  name: 'getMessageReactions',
  description:
    'Get reactions on a specific DM message, grouped by emoji with reactor user IDs.',
  notes:
    'Requires both messageId (mid.$ format) and threadKey. Use getDirectThread to find message IDs. Returns sender FBIDs (Meta cross-platform IDs, not Instagram user IDs) and enriches with profile info from thread participants.',
  input: z.object({
    messageId: z
      .string()
      .describe('Message ID (mid.$ prefixed format from getDirectThread)'),
    threadKey: z.string().describe('Thread key (short numeric ID)'),
    csrf: CsrfParam,
  }),
  output: z.object({
    messageId: z.string().describe('The queried message ID'),
    reactions: z
      .array(MessageReactionSchema)
      .describe('Reactions grouped by emoji'),
    totalCount: z.number().describe('Total number of individual reactions'),
  }),
};

export type GetMessageReactionsInput = z.infer<
  typeof getMessageReactionsSchema.input
>;
export type GetMessageReactionsOutput = z.infer<
  typeof getMessageReactionsSchema.output
>;

// ============================================================================
// sendMessage
// ============================================================================

export const sendMessageSchema = {
  name: 'sendMessage',
  description:
    'Send a text message to a DM thread. Supports replying to a specific message and silent sends.',
  notes:
    'The threadKey input is the 19-digit threadFbid from getThreadInfo, NOT the 15-digit threadKey from getDirectInbox. Workflow: getDirectInbox (pick thread) → getThreadInfo (get threadFbid) → sendMessage. To reply to a specific message, pass replyToItemId (item_id from getDirectThread).',
  input: z.object({
    threadKey: z
      .string()
      .describe(
        'The 19-digit threadFbid from getThreadInfo (NOT the 15-digit threadKey from getDirectInbox)',
      ),
    text: z.string().describe('Message text to send'),
    csrf: CsrfParam,
    replyToItemId: z
      .string()
      .optional()
      .describe(
        'Item ID of the message to reply to (from getDirectThread item_id field, not the mid.$ message ID)',
      ),
    replyToClientContext: z
      .string()
      .optional()
      .describe(
        'Client context of the original message being replied to (must accompany replyToItemId)',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the message was sent successfully'),
    messageId: z
      .string()
      .describe(
        'Instagram message ID of the sent message (mid.$ prefixed format)',
      ),
    clientContext: z
      .string()
      .describe('Client-generated context ID for tracking the sent message'),
  }),
};

export type SendMessageInput = z.infer<typeof sendMessageSchema.input>;
export type SendMessageOutput = z.infer<typeof sendMessageSchema.output>;

// ============================================================================
// sendNewMessage
// ============================================================================

export const sendNewMessageSchema = {
  name: 'sendNewMessage',
  description:
    'Send a DM to a user by their user ID, creating a new thread if one does not already exist. Use this when you have a userId but no threadKey.',
  notes:
    'Get the userId from searchUsers or getUserProfile. If a thread already exists with this user, the message is sent to that thread. Returns the threadId of the created/existing thread.',
  input: z.object({
    userId: z
      .string()
      .describe(
        'Recipient user ID (numeric string from searchUsers or getUserProfile)',
      ),
    text: z.string().describe('Message text to send'),
    csrf: CsrfParam,
  }),
  output: z.object({
    success: z.boolean().describe('Whether the message was sent successfully'),
    messageId: z
      .string()
      .describe(
        'Instagram message ID of the sent message (mid.$ prefixed format)',
      ),
    clientContext: z
      .string()
      .describe('Client-generated context ID for tracking the sent message'),
  }),
};

export type SendNewMessageInput = z.infer<typeof sendNewMessageSchema.input>;
export type SendNewMessageOutput = z.infer<typeof sendNewMessageSchema.output>;
