import { z } from 'zod';

export const libraryDescription =
  'WhatsApp Web: read chats, send messages, create groups, view participants, delete messages via page-internal module access';

export const libraryIcon = '/icons/libs/whatsapp.png';
export const loginUrl = 'https://web.whatsapp.com';

export const libraryNotes = `
## Workflow

1. Navigate to \`https://web.whatsapp.com\` (user must be logged in — QR already scanned)
2. Call \`getContext()\` to verify the session is ready and get \`{ meId, meLid, displayName }\`
3. Call read functions (\`listChats\`, \`searchContacts\`, \`getChatMessages\`) to find the right \`chatId\`
4. Call write functions (\`sendTextMessage\`, \`createGroupChat\`, \`deleteMessage\`) with an explicit \`chatId\`

## How It Works (no HTTP API)

WhatsApp Web uses an encrypted WebSocket; there is no REST API to call. This library drives the page's own internal JavaScript modules via \`window.require('WAWeb*')\`. All operations run in the React app's memory, so messages appear immediately in the UI and sync to phone.

## Key Concepts

- **chatId**: WhatsApp ID string ending in \`@c.us\` (1:1 chat) or \`@g.us\` (group). Example: \`17322086770@c.us\`. NEVER pass a LID (\`@lid\`) chatId — use the \`@c.us\` form. 1:1 chatId equals the contact's phone-number WID.
- **Phone numbers**: International digits, no \`+\`, no spaces. Example: US \`+1 (732) 208-6770\` → \`17322086770\`.
- **messageId**: A long string like \`true_17322086770@c.us_3EB0ABC123...\`. The \`true\` prefix means the message was sent by the current user and is revokable. Obtained from \`getChatMessages\` or the return value of \`sendTextMessage\`.
- **Groups**: Group chatIds look like \`120363164277280152@g.us\`. The numeric portion is the group's unique id. You cannot convert a group to a 1:1 or vice-versa.
- **Message history is lazy-loaded**: \`getChatMessages\` opens the chat and waits for WhatsApp to populate the in-memory message list. Asking for more messages than are currently loaded silently returns what is available.

## Safety Rules

- Every write function takes exactly ONE \`chatId\`. This library deliberately provides no bulk-send function — iterating over recipients must be done by the caller with full awareness of each target.
- \`deleteMessage\` only revokes messages the current user sent (messageIds starting with \`true_\`). Revoking someone else's message will fail.
- \`createGroupChat\` creates a real group and the invited participants see it immediately.

## Pagination

\`listChats\` and \`getChatMessages\` take a \`limit\` parameter. There is no cursor — results are ordered most-recent-first and truncated to the limit.
`;

// ============================================================================
// Rate Limits
// ============================================================================

export const rateLimits: Record<
  string,
  Array<{
    window: 'SECOND' | 'MINUTE' | 'HOUR' | 'DAY';
    maxCalls: number;
    message: string;
  }>
> = {
  sendTextMessage: [
    {
      window: 'SECOND',
      maxCalls: 1,
      message: 'Pace at ~1 msg/sec to look human',
    },
    {
      window: 'MINUTE',
      maxCalls: 5,
      message: 'Burst sends trigger WhatsApp anti-spam',
    },
    {
      window: 'HOUR',
      maxCalls: 60,
      message: 'Hourly cap to avoid rate-limit ban',
    },
    {
      window: 'DAY',
      maxCalls: 300,
      message: 'WhatsApp bans aggressive accounts within a day',
    },
  ],
  createGroupChat: [
    {
      window: 'HOUR',
      maxCalls: 3,
      message: 'Group-create bursts are a known abuse signal',
    },
    { window: 'DAY', maxCalls: 10, message: 'Daily group-create ceiling' },
  ],
};

// ============================================================================
// Shared sub-schemas
// ============================================================================

const ChatIdParam = z
  .string()
  .describe(
    'WhatsApp chat id. 1:1 chat: phone@c.us (e.g., "17322086770@c.us"). Group: numericId@g.us (e.g., "120363164277280152@g.us"). Obtain from listChats, searchContacts, or createGroupChat.',
  );

const ChatSummarySchema = z.object({
  chatId: z.string().describe('WhatsApp id (@c.us or @g.us)'),
  name: z.string().describe('Chat display name (group title or contact name)'),
  isGroup: z.boolean(),
  unreadCount: z.number().describe('Count of unread messages for this chat'),
  lastMessageTimestamp: z
    .number()
    .nullable()
    .describe('Unix seconds of the most recent message, or null'),
  isArchived: z.boolean(),
  isMuted: z.boolean(),
  pinned: z.boolean(),
});

const MessageSchema = z.object({
  messageId: z
    .string()
    .describe(
      'Full message id string, e.g. "true_17322086770@c.us_3EB0ABC...". The "true_" prefix marks messages sent by the current user.',
    ),
  chatId: z.string(),
  body: z
    .string()
    .describe('Plain text content; empty string for media or system messages'),
  type: z
    .string()
    .describe(
      'Message type: "chat" (text), "image", "video", "audio", "document", "sticker", "ptt" (voice note), "location", "vcard", "revoked", etc.',
    ),
  fromMe: z.boolean().describe('true if the current user sent this message'),
  author: z
    .string()
    .nullable()
    .describe(
      'For group messages: the sender WID (e.g. "17322086770@c.us"). Null for 1:1 chats.',
    ),
  timestamp: z.number().describe('Unix seconds when the message was sent'),
  hasMedia: z.boolean(),
  isForwarded: z.boolean(),
  quotedMessageId: z
    .string()
    .nullable()
    .describe('If this message is a reply, the replied-to messageId'),
});

const ContactSchema = z.object({
  contactId: z
    .string()
    .describe(
      'Contact WID, typically phone@c.us. Use as chatId for 1:1 chats.',
    ),
  phone: z
    .string()
    .describe('International digits only, no + (e.g. "17322086770")'),
  name: z
    .string()
    .describe(
      'Display name: stored contact name if available, otherwise push name, otherwise phone',
    ),
  pushName: z
    .string()
    .describe('The name the contact set for themselves in WhatsApp'),
  isMe: z.boolean(),
  isBusiness: z.boolean(),
  isContact: z
    .boolean()
    .describe("true if saved in the user's address book (has a stored name)"),
});

const GroupParticipantSchema = z.object({
  participantId: z
    .string()
    .describe(
      'Participant WID — typically a @lid internally, but chatId (@c.us) is also provided when available',
    ),
  chatId: z
    .string()
    .nullable()
    .describe(
      'The participant\'s @c.us chatId (e.g. "17322086770@c.us"), usable for sendTextMessage. Null if the contact is not in the address book.',
    ),
  phone: z
    .string()
    .describe(
      'International phone number digits (e.g. "17322086770"). Empty string if not resolvable.',
    ),
  name: z
    .string()
    .describe(
      'Display name (stored contact name or push name). Empty string if unknown.',
    ),
  isAdmin: z.boolean(),
  isSuperAdmin: z.boolean(),
});

// ============================================================================
// Context
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description:
    'Verify WhatsApp Web session is ready and return the current user. Call FIRST before any other function. Throws if the QR code has not been scanned yet.',
  notes: '',
  input: z.object({}),
  output: z.object({
    meId: z
      .string()
      .describe('Current user phone WID, e.g. "18623246880@c.us"'),
    mePhone: z
      .string()
      .describe('Current user phone number (international digits, no +)'),
    meLid: z
      .string()
      .describe(
        'Current user\'s new-style LID, e.g. "90851577491586@lid". Used internally by WhatsApp; prefer meId for chatId usage.',
      ),
    displayName: z.string().describe("Current user's display name"),
    chatCount: z
      .number()
      .describe('Number of chats currently loaded in the client'),
    contactCount: z
      .number()
      .describe('Number of contacts in the client address book'),
  }),
};
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type GetContextOutput = z.infer<typeof getContextSchema.output>;

// ============================================================================
// Chats
// ============================================================================

export const listChatsSchema = {
  name: 'listChats',
  description:
    "List the current user's chats, ordered by most recent message first. Returns both 1:1 and group chats by default.",
  notes: '',
  input: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(50)
      .describe('Max chats to return (default 50, max 500)'),
    includeGroups: z
      .boolean()
      .default(true)
      .describe('Include group chats in results'),
    includeIndividuals: z
      .boolean()
      .default(true)
      .describe('Include 1:1 chats in results'),
    onlyUnread: z
      .boolean()
      .default(false)
      .describe('If true, return only chats with unread messages'),
  }),
  output: z.object({
    chats: z.array(ChatSummarySchema),
  }),
};
export type ListChatsInput = z.infer<typeof listChatsSchema.input>;
export type ListChatsOutput = z.infer<typeof listChatsSchema.output>;

export const getChatSchema = {
  name: 'getChat',
  description:
    'Get detailed metadata for a single chat by chatId, including group metadata if it is a group.',
  notes: '',
  input: z.object({
    chatId: ChatIdParam,
  }),
  output: z.object({
    chatId: z.string(),
    name: z.string(),
    isGroup: z.boolean(),
    unreadCount: z.number(),
    isArchived: z.boolean(),
    isMuted: z.boolean(),
    pinned: z.boolean(),
    groupInfo: z
      .object({
        subject: z.string(),
        description: z.string().nullable(),
        createdAt: z
          .number()
          .nullable()
          .describe('Unix seconds when the group was created'),
        ownerId: z.string().nullable(),
        participantCount: z.number(),
        isAnnouncementOnly: z
          .boolean()
          .describe('Only admins can send messages'),
      })
      .nullable()
      .describe('Present only for group chats'),
  }),
};
export type GetChatInput = z.infer<typeof getChatSchema.input>;
export type GetChatOutput = z.infer<typeof getChatSchema.output>;

export const getChatMessagesSchema = {
  name: 'getChatMessages',
  description:
    'Read messages from a chat, newest last. Automatically opens the chat in the app to trigger message loading, so the chat becomes the active chat on screen.',
  notes:
    'Calling this opens the chat in the WhatsApp Web UI (same as clicking on it). If the chat has never been opened in the current session, only the most recent messages will be available; request a larger limit or call repeatedly to paginate further back.',
  input: z.object({
    chatId: ChatIdParam,
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(30)
      .describe('Max messages to return, most recent last (default 30)'),
  }),
  output: z.object({
    chatId: z.string(),
    chatName: z.string(),
    isGroup: z.boolean(),
    messages: z.array(MessageSchema).describe('Ordered oldest → newest'),
  }),
};
export type GetChatMessagesInput = z.infer<typeof getChatMessagesSchema.input>;
export type GetChatMessagesOutput = z.infer<
  typeof getChatMessagesSchema.output
>;

export const getGroupParticipantsSchema = {
  name: 'getGroupParticipants',
  description:
    'List every participant in a group chat, including admins. Fails if chatId is not a group.',
  notes: '',
  input: z.object({
    chatId: z
      .string()
      .describe(
        'Group chatId ending in @g.us (e.g. "120363164277280152@g.us")',
      ),
  }),
  output: z.object({
    chatId: z.string(),
    groupName: z.string(),
    ownerId: z.string().nullable(),
    participantCount: z.number(),
    participants: z.array(GroupParticipantSchema),
  }),
};
export type GetGroupParticipantsInput = z.infer<
  typeof getGroupParticipantsSchema.input
>;
export type GetGroupParticipantsOutput = z.infer<
  typeof getGroupParticipantsSchema.output
>;

// ============================================================================
// Contacts
// ============================================================================

export const searchContactsSchema = {
  name: 'searchContacts',
  description:
    "Search the user's WhatsApp contacts by name or phone-number substring (case-insensitive). Returns up to `limit` matches ordered by relevance.",
  notes: '',
  input: z.object({
    query: z
      .string()
      .min(1)
      .describe(
        'Substring to match against contact name, push name, or phone number. Example: "matthew" or "17322".',
      ),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  output: z.object({
    query: z.string(),
    contacts: z.array(ContactSchema),
  }),
};
export type SearchContactsInput = z.infer<typeof searchContactsSchema.input>;
export type SearchContactsOutput = z.infer<typeof searchContactsSchema.output>;

export const checkNumberExistsSchema = {
  name: 'checkNumberExists',
  description:
    'Check whether a phone number is registered on WhatsApp. Returns the canonical chatId if so.',
  notes: '',
  input: z.object({
    phone: z
      .string()
      .describe(
        'International phone number, digits only, no + or spaces (e.g. "17322086770"). Country code REQUIRED.',
      ),
  }),
  output: z.object({
    phone: z.string(),
    exists: z.boolean(),
    chatId: z
      .string()
      .nullable()
      .describe('Canonical @c.us chatId if the number exists on WhatsApp'),
  }),
};
export type CheckNumberExistsInput = z.infer<
  typeof checkNumberExistsSchema.input
>;
export type CheckNumberExistsOutput = z.infer<
  typeof checkNumberExistsSchema.output
>;

// ============================================================================
// Send / Write
// ============================================================================

export const sendTextMessageSchema = {
  name: 'sendTextMessage',
  description:
    "Send a plain-text message to a single chat. The message appears immediately in the user's WhatsApp Web UI and syncs to phone. Exactly one chatId per call — caller must iterate for multiple recipients.",
  notes:
    'Returns the full messageId of the sent message so it can be deleted later with deleteMessage. The sent messageId starts with "true_".',
  input: z.object({
    chatId: ChatIdParam,
    text: z
      .string()
      .min(1)
      .describe('Message text. Supports emoji and newlines. Max ~65536 chars.'),
  }),
  output: z.object({
    chatId: z.string(),
    messageId: z
      .string()
      .describe('Full messageId of the sent message, begins with "true_"'),
    timestamp: z.number().describe('Unix seconds when sent'),
  }),
};
export type SendTextMessageInput = z.infer<typeof sendTextMessageSchema.input>;
export type SendTextMessageOutput = z.infer<
  typeof sendTextMessageSchema.output
>;

export const createGroupChatSchema = {
  name: 'createGroupChat',
  description:
    'Create a new WhatsApp group chat with the given name and initial participants. The invited participants are notified and see the group in their WhatsApp immediately.',
  notes:
    'Only contacts who are already on WhatsApp can be added. Returns the new group chatId which can be passed to sendTextMessage, getGroupParticipants, etc.',
  input: z.object({
    name: z
      .string()
      .min(1)
      .max(100)
      .describe('Group subject / title as it will appear in WhatsApp'),
    participantChatIds: z
      .array(z.string())
      .min(1)
      .max(1024)
      .describe(
        'Array of participant chatIds in "phone@c.us" form (e.g. ["17322086770@c.us", "19074068543@c.us"]). Must be existing contacts or valid WhatsApp numbers.',
      ),
  }),
  output: z.object({
    chatId: z.string().describe('New group chatId in @g.us form'),
    name: z.string(),
    participantCount: z.number(),
  }),
};
export type CreateGroupChatInput = z.infer<typeof createGroupChatSchema.input>;
export type CreateGroupChatOutput = z.infer<
  typeof createGroupChatSchema.output
>;

export const deleteMessageSchema = {
  name: 'deleteMessage',
  description:
    'Delete a message. Two modes: "Delete for Everyone" (revokes from all devices, only own messages, ~48h window) or "Delete for Me" (hides locally, works on any message, no time limit).',
  notes:
    'forEveryone=true (default): messageId must begin with "true_" (sent by current user). forEveryone=false: works on any message in the chat, but only removes it from the current user\'s view.',
  input: z.object({
    chatId: ChatIdParam,
    messageId: z
      .string()
      .describe(
        'Full messageId (from sendTextMessage return value or getChatMessages).',
      ),
    forEveryone: z
      .boolean()
      .default(true)
      .describe(
        'true = "Delete for Everyone" (revokes from all recipients, only own messages within ~48h). false = "Delete for Me" (hides locally, works on any message).',
      ),
  }),
  output: z.object({
    chatId: z.string(),
    messageId: z.string(),
    revoked: z.boolean(),
  }),
};
export type DeleteMessageInput = z.infer<typeof deleteMessageSchema.input>;
export type DeleteMessageOutput = z.infer<typeof deleteMessageSchema.output>;

// ============================================================================
// All Schemas
// ============================================================================

export const allSchemas = [
  getContextSchema,
  listChatsSchema,
  getChatSchema,
  getChatMessagesSchema,
  getGroupParticipantsSchema,
  searchContactsSchema,
  checkNumberExistsSchema,
  sendTextMessageSchema,
  createGroupChatSchema,
  deleteMessageSchema,
];
