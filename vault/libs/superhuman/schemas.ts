import { z } from 'zod';

export const libraryDescription =
  'Superhuman email client - send, reply, schedule, and manage emails via Superhuman.';

export const libraryIcon = '/icons/libs/superhuman.png';

export const libraryNotes = `
## Workflow

1. Create an attached executor targeting the email UI (not background pages): \`createExecutor({ app: "superhuman", mode: "attached", targetPattern: "mail\\.superhuman\\.com/[^~]" })\`
2. Call \`getContext()\` to verify session
3. Use Superhuman functions for all email operations

## Sending Emails

- **\`sendEmail()\`**: Send a new email immediately (queued with ~20s undo window)
- **\`sendReply()\`**: Reply, reply-all, or forward on an existing thread
- **\`scheduleSend()\`**: Schedule a new email for future delivery (pass ISO date)
- **\`scheduleReply()\`**: Schedule a reply on an existing thread for future delivery. Defaults to \`abortOnReply: true\` (cancelled if recipient replies first). Set \`abortOnReply: false\` to send regardless.
- **\`cancelScheduledSend()\`**: Cancel a scheduled or in-flight send

For replies: the thread must be in the cache. Call \`listInbox()\` or \`readEmail()\` first to ensure it's loaded.

All send/schedule/draft functions accept an optional \`from\` parameter to send from a Gmail "Send As" alias.
Use \`listAliases()\` to see available aliases.

**Body is HTML.** Use \`<br>\` for line breaks, not \\n. Plain \\n characters are ignored and won't create newlines in the rendered email.

## Drafts

- **\`createDraft()\`**: Save a draft without sending
- **\`createReplyDraft()\`**: Save a reply draft on a thread
- **\`updateDraft()\`**: Modify an existing draft (change recipients, body, subject)
- **\`deleteDraft()\`**: Discard a draft
- Draft attachments are not yet supported via this library

## Attachments

**Sending**: sendEmail, sendReply, and scheduleSend all accept an optional \`attachments\` array.
Each attachment needs a \`filename\` and either a \`path\` (device file path) or \`key\` (cloud storage key).
Pass the device file path directly; the function loads and uploads the file internally.

**Downloading**: Call \`readEmail()\` to get attachment metadata (\`attachmentId\`, \`messageId\`, \`name\`).
Then call \`downloadAttachment({ messageId, attachmentId, filename })\`; it downloads the file and saves it
to the device. The returned \`path\` is the device file path where the attachment was saved.

## Search

- **\`searchEmails()\`**: Search emails using Gmail search operators. Supports \`from:\`, \`to:\`, \`subject:\`, \`has:attachment\`, \`after:YYYY/MM/DD\`, \`before:YYYY/MM/DD\`, \`is:unread\`, \`is:starred\`, \`label:\`, \`newer_than:2d\`, \`older_than:1y\`, etc.
- Returns threads matching the query with full metadata (subject, from, snippet, date, unread/starred status)
- Results from the thread cache are instant; threads not in cache are fetched from Gmail API

## Speed & Context Tips

Superhuman's thread cache is already populated with what the user is looking at:

- **\`listInboxFilters()\` first**: shows split inboxes and thread counts
- **\`listInbox({ filter })\`** reads from the in-memory cache (instant, no API calls)
- **\`readEmail()\`** also reads from cache (free for threads already in inbox)
- **When the user says "my inbox"**, start with \`listInboxFilters()\` then \`listInbox()\`
- **\`searchEmails()\`**: when looking for specific emails, use Gmail search operators
- **Draft messages appear inside threads**; \`readEmail()\` shows drafts with \`isDraft: true\`

## Reminders

- **\`setReminder()\`**: Set a remind-me timer on a thread (like pressing H in Superhuman). Archives the thread by default (\`markDone: true\`) and returns it to inbox when the reminder triggers.
- **\`cancelReminder()\`**: Cancel an active reminder on a thread. Set \`moveToInbox: true\` to move the thread back to inbox immediately.
- **\`unarchiveEmail()\`**: Move an archived thread back to inbox (reverse of archiveEmail).

## Split Inboxes

- **\`listSplitInboxes()\`**: List all split inboxes with thread counts and routing label IDs. Returns "important", "other", and any custom splits (VIP, Team, etc.).
- **\`moveThread()\`**: Move a thread to a different split inbox by changing its Gmail routing labels. Use \`listSplitInboxes()\` first to find the target slug.
- Only custom splits with dedicated Gmail labels can be targeted by \`moveThread()\`. Built-in query-based splits (Calendar, Shared, etc.) cannot be moved to directly.

## Requirements

- **Use attached executor**: \`createExecutor({ app: "superhuman", mode: "attached", targetPattern: "mail\\\\.superhuman\\\\.com/[^~]" })\`
- **Superhuman app must be running** (desktop app)
- The targetPattern excludes internal pages like \`~backend/build/background_page.html\`
- Only works with Google accounts (Gmail)
- Microsoft accounts not yet supported
`;

// ============================================================================
// Attachment Input Schema
// ============================================================================

export const AttachmentInputSchema = z.object({
  filename: z.string().describe('Filename with extension (e.g. "report.pdf")'),
  path: z
    .string()
    .optional()
    .describe('Device file path (e.g. "/Users/me/Downloads/report.pdf")'),
  key: z
    .string()
    .optional()
    .describe('Cloud storage key (from a previous file upload)'),
});

export type AttachmentInput = z.infer<typeof AttachmentInputSchema>;

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
  sendEmail: [
    {
      window: 'MINUTE',
      maxCalls: 10,
      message: 'Underlying Gmail/Outlook backend throttle',
    },
    { window: 'DAY', maxCalls: 500, message: 'Provider daily send cap' },
  ],
  sendReply: [
    { window: 'MINUTE', maxCalls: 10, message: 'Same throttle as sendEmail' },
  ],
  scheduleSend: [
    { window: 'MINUTE', maxCalls: 10, message: 'Same throttle as sendEmail' },
  ],
  scheduleReply: [
    { window: 'MINUTE', maxCalls: 10, message: 'Same throttle as sendEmail' },
  ],
};

// ============================================================================
// Context Schema
// ============================================================================

export const SuperhumanContextSchema = z.object({
  authenticated: z
    .boolean()
    .describe('Whether user has an active Superhuman session'),
  email: z.string().nullable().describe('User email address if authenticated'),
  provider: z
    .string()
    .nullable()
    .describe('Email provider: "google" or "microsoft"'),
  note: z.string().describe('Usage guidance about Gmail library preference'),
});

export const getContextSchema = {
  name: 'getContext',
  description: 'Check if user is on Superhuman and authenticated',
  notes:
    'Verifies Superhuman session by checking for Account global object. ' +
    'Call this first before any other Superhuman operations.',
  input: z.object({}),
  output: SuperhumanContextSchema,
};

// ============================================================================
// List Inbox Schema
// ============================================================================

export const InboxThreadSchema = z.object({
  id: z.string().describe('Thread ID'),
  subject: z.string().describe('Email subject line'),
  from: z.string().describe('Sender name or email'),
  snippet: z.string().describe('Preview of message content'),
  date: z.number().nullable().describe('Timestamp (milliseconds)'),
  isUnread: z.boolean().describe('Whether thread is unread'),
  isStarred: z.boolean().describe('Whether thread is starred'),
  messageCount: z.number().describe('Number of messages in thread'),
});

export const listInboxSchema = {
  name: 'listInbox',
  description: 'List email threads from inbox by category',
  notes:
    'Returns threads from the specified inbox filter, sorted by date. ' +
    'Defaults to "inbox" (all mail). Use named splits like "important", "vip", "team" to narrow.',
  input: z.object({
    filter: z
      .string()
      .default('inbox')
      .describe(
        'Inbox category to list. Built-in: "inbox" (all), "important", "other", "sent", "starred", "done", "draft", "scheduled", "reminders", "unread". ' +
          'Split inboxes (custom): "vip", "team", "calendar", etc. Use listInboxFilters to discover available filters.',
      ),
    limit: z
      .number()
      .default(20)
      .describe('Maximum number of threads to return'),
  }),
  output: z.object({
    account: z.string().describe('Email account'),
    threads: z.array(InboxThreadSchema),
  }),
};

// ============================================================================
// Read Email Schema
// ============================================================================

export const EmailContactSchema = z.object({
  name: z.string().nullable().describe('Contact name'),
  email: z.string().nullable().describe('Email address'),
});

export const EmailAttachmentSchema = z.object({
  name: z.string().describe('Attachment filename'),
  size: z.number().describe('Size in bytes'),
  mimeType: z.string().describe('MIME type'),
  attachmentId: z
    .string()
    .nullable()
    .describe(
      'Gmail attachment ID. Pass to downloadAttachment() to download the file. Null for inline/embedded images.',
    ),
  messageId: z
    .string()
    .nullable()
    .describe(
      'Message ID containing this attachment. Needed for downloadAttachment().',
    ),
});

export const EmailMessageSchema = z.object({
  id: z.string().nullable().describe('Message ID'),
  from: EmailContactSchema.nullable().describe('Sender'),
  to: z.array(EmailContactSchema).describe('Recipients'),
  cc: z.array(EmailContactSchema).describe('CC recipients'),
  date: z.number().nullable().describe('Timestamp (milliseconds)'),
  snippet: z.string().describe('Message preview'),
  body: z.string().describe('Full message body'),
  isUnread: z.boolean().describe('Whether message is unread'),
  isDraft: z
    .boolean()
    .describe(
      'Whether this message is a draft. Draft message IDs start with "draft00".',
    ),
  attachments: z.array(EmailAttachmentSchema).describe('Message attachments'),
});

export const readEmailSchema = {
  name: 'readEmail',
  description: 'Read full details of an email thread',
  notes:
    'Returns all messages in the thread with full content. ' +
    "Uses Superhuman's thread cache. Gmail accounts only.",
  input: z.object({
    threadId: z.string().describe('Thread ID to read'),
  }),
  output: z.object({
    account: z.string().describe('Email account'),
    threadId: z.string().describe('Thread ID'),
    subject: z.string().describe('Thread subject'),
    messageCount: z.number().describe('Number of messages'),
    isUnread: z.boolean().describe('Whether thread is unread'),
    isStarred: z.boolean().describe('Whether thread is starred'),
    isDone: z.boolean().describe('Whether thread is archived'),
    labels: z.array(z.string()).describe('Gmail labels'),
    messages: z.array(EmailMessageSchema).describe('All messages in thread'),
  }),
};

// ============================================================================
// Download Attachment Schema
// ============================================================================

export const downloadAttachmentSchema = {
  name: 'downloadAttachment',
  description:
    'Download a file attachment from an email and save it to device storage',
  notes:
    'Get attachmentId and messageId from readEmail() output. ' +
    'Downloads the file and saves it to the device. ' +
    'Returns the device file path where the attachment was saved.',
  input: z.object({
    messageId: z
      .string()
      .describe('Message ID containing the attachment (from readEmail output)'),
    attachmentId: z
      .string()
      .describe('Attachment ID to download (from readEmail output)'),
    filename: z
      .string()
      .describe(
        'Filename to save as (from readEmail attachment name). Include extension.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the download succeeded'),
    filename: z.string().describe('Saved filename'),
    path: z.string().describe('Device file path where the file was saved'),
    size: z.number().describe('File size in bytes'),
    mimeType: z.string().describe('MIME type of the downloaded file'),
  }),
};

// ============================================================================
// Archive Email Schema
// ============================================================================

export const archiveEmailSchema = {
  name: 'archiveEmail',
  description: 'Archive an email thread (remove from inbox)',
  notes:
    'Archives thread by removing INBOX label from all messages. ' +
    "Uses Gmail's changeLabels API. Gmail accounts only.",
  input: z.object({
    threadId: z.string().describe('Thread ID to archive'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether operation succeeded'),
    account: z.string().describe('Email account'),
    threadId: z.string().describe('Thread ID'),
    subject: z.string().describe('Thread subject'),
    messagesArchived: z.number().describe('Number of messages archived'),
  }),
};

// ============================================================================
// Unarchive Email Schema
// ============================================================================

export const unarchiveEmailSchema = {
  name: 'unarchiveEmail',
  description: 'Move an archived email thread back to inbox',
  notes:
    'Restores thread to inbox by adding INBOX label to all messages. ' +
    "Uses Gmail's changeLabels API. Gmail accounts only.",
  input: z.object({
    threadId: z.string().describe('Thread ID to move back to inbox'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether operation succeeded'),
    account: z.string().describe('Email account'),
    threadId: z.string().describe('Thread ID'),
    subject: z.string().describe('Thread subject'),
    messagesUnarchived: z
      .number()
      .describe('Number of messages moved to inbox'),
  }),
};

// ============================================================================
// Set Reminder Schema
// ============================================================================

export const setReminderSchema = {
  name: 'setReminder',
  description:
    'Set a remind-me timer on an email thread (Superhuman "H" key / Remind Me)',
  notes:
    'Archives the thread by default (markDone: true) and returns it to inbox when the reminder triggers. ' +
    'The thread must be in the cache; call listInbox() or readEmail() first.',
  input: z.object({
    threadId: z.string().describe('Thread ID to set reminder on'),
    triggerAt: z
      .string()
      .describe(
        'ISO date string for when the reminder should trigger (e.g. "2026-03-01T09:00:00Z")',
      ),
    markDone: z
      .boolean()
      .optional()
      .describe('Archive the thread after setting reminder (default: true)'),
    keepOnReply: z
      .boolean()
      .optional()
      .describe('Keep reminder active if recipient replies (default: false)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether operation succeeded'),
    account: z.string().describe('Email account'),
    threadId: z.string().describe('Thread ID'),
    subject: z.string().describe('Thread subject'),
    reminderId: z.string().describe('UUID of the created reminder'),
    triggerAt: z
      .string()
      .describe('ISO date string when reminder will trigger'),
  }),
};

// ============================================================================
// Cancel Reminder Schema
// ============================================================================

export const cancelReminderSchema = {
  name: 'cancelReminder',
  description: 'Cancel an active remind-me timer on an email thread',
  notes:
    'Pass the reminderId from setReminder() response, or omit to read it from the thread cache. Use moveToInbox: true to bring the thread back to inbox when cancelling.',
  input: z.object({
    threadId: z.string().describe('Thread ID to cancel reminder on'),
    reminderId: z
      .string()
      .optional()
      .describe(
        'Reminder UUID to cancel. Get from setReminder() response. If omitted, reads from thread cache.',
      ),
    moveToInbox: z
      .boolean()
      .optional()
      .describe('Move thread back to inbox when cancelling (default: true)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether operation succeeded'),
    account: z.string().describe('Email account'),
    threadId: z.string().describe('Thread ID'),
    subject: z.string().describe('Thread subject'),
    reminderId: z.string().describe('UUID of the cancelled reminder'),
  }),
};

// ============================================================================
// List Split Inboxes Schema
// ============================================================================

export const listSplitInboxesSchema = {
  name: 'listSplitInboxes',
  description:
    'List all available split inboxes (Important, Other, and custom splits)',
  notes: '',
  input: z.object({}),
  output: z.object({
    account: z.string().describe('Email account'),
    splitInboxes: z.array(
      z.object({
        id: z.string().describe('Internal split inbox ID'),
        name: z.string().describe('Display name of the split inbox'),
        slug: z
          .string()
          .describe('URL slug / identifier used as moveThread target'),
        type: z
          .string()
          .describe(
            'Split type: "important", "other", "vip", "team", "calendar", "news", "shared", or "custom"',
          ),
        enabled: z.boolean().describe('Whether the split inbox is active'),
        threadCount: z
          .number()
          .describe('Number of threads currently in this split'),
        routingLabelIds: z
          .array(z.string())
          .describe(
            'Gmail label IDs that route threads into this split (e.g. ["IMPORTANT"] or ["Label_8947794500643055315"])',
          ),
      }),
    ),
  }),
};

// ============================================================================
// Move Thread Schema
// ============================================================================

export const moveThreadSchema = {
  name: 'moveThread',
  description:
    'Move an email thread to a different split inbox (Important, Other, or custom split)',
  notes:
    'Use listSplitInboxes() to see available targets. Common targets: "important", "other", or a custom split slug like "call-#1-emails".',
  input: z.object({
    threadId: z.string().describe('Thread ID to move'),
    target: z
      .string()
      .describe(
        'Split inbox slug or "important" or "other". Get available values from listSplitInboxes().',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether operation succeeded'),
    account: z.string().describe('Email account'),
    threadId: z.string().describe('Thread ID'),
    subject: z.string().describe('Thread subject'),
    movedTo: z.string().describe('Name of the target split inbox'),
    labelsAdded: z
      .array(z.string())
      .describe('Gmail label IDs added to the thread'),
    labelsRemoved: z
      .array(z.string())
      .describe('Gmail label IDs removed from the thread'),
  }),
};

// ============================================================================
// Star Email Schema
// ============================================================================

export const starEmailSchema = {
  name: 'starEmail',
  description: 'Star an email thread',
  notes:
    "Adds STARRED label to thread. Uses Gmail's changeLabels API. Gmail accounts only.",
  input: z.object({
    threadId: z.string().describe('Thread ID to star'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether operation succeeded'),
    account: z.string().describe('Email account'),
    threadId: z.string().describe('Thread ID'),
    subject: z.string().describe('Thread subject'),
    action: z.string().describe('Action performed: "starred"'),
  }),
};

export const unstarEmailSchema = {
  name: 'unstarEmail',
  description: 'Unstar an email thread',
  notes:
    "Removes STARRED label from thread. Uses Gmail's changeLabels API. Gmail accounts only.",
  input: z.object({
    threadId: z.string().describe('Thread ID to unstar'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether operation succeeded'),
    account: z.string().describe('Email account'),
    threadId: z.string().describe('Thread ID'),
    subject: z.string().describe('Thread subject'),
    action: z.string().describe('Action performed: "unstarred"'),
  }),
};

// ============================================================================
// Mark Read Schema
// ============================================================================

export const markReadSchema = {
  name: 'markRead',
  description: 'Mark an email thread as read',
  notes:
    'Removes UNREAD label from all messages in thread. ' +
    "Uses Gmail's changeLabels API. Gmail accounts only.",
  input: z.object({
    threadId: z.string().describe('Thread ID to mark as read'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether operation succeeded'),
    account: z.string().describe('Email account'),
    threadId: z.string().describe('Thread ID'),
    subject: z.string().describe('Thread subject'),
    action: z.string().describe('Action performed: "marked read"'),
    messagesModified: z.number().describe('Number of messages modified'),
  }),
};

export const markUnreadSchema = {
  name: 'markUnread',
  description: 'Mark an email thread as unread',
  notes:
    'Adds UNREAD label to all messages in thread. ' +
    "Uses Gmail's changeLabels API. Gmail accounts only.",
  input: z.object({
    threadId: z.string().describe('Thread ID to mark as unread'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether operation succeeded'),
    account: z.string().describe('Email account'),
    threadId: z.string().describe('Thread ID'),
    subject: z.string().describe('Thread subject'),
    action: z.string().describe('Action performed: "marked unread"'),
    messagesModified: z.number().describe('Number of messages modified'),
  }),
};

// ============================================================================
// List Accounts Schema
// ============================================================================

export const AccountInfoSchema = z.object({
  email: z.string().describe('Email address'),
  name: z.string().describe('Display name'),
  provider: z.string().describe('Email provider: "google" or "microsoft"'),
  isActive: z
    .boolean()
    .describe('Whether this is the currently active account'),
});

export const listAccountsSchema = {
  name: 'listAccounts',
  description: 'List all Superhuman accounts available in the session',
  notes:
    'Returns all accounts configured in Superhuman. ' +
    'Use to let user choose which account to work with.',
  input: z.object({}),
  output: z.object({
    accounts: z.array(AccountInfoSchema),
    total: z.number().describe('Total number of accounts'),
  }),
};

// ============================================================================
// Switch Account Schema
// ============================================================================

export const switchAccountSchema = {
  name: 'switchAccount',
  description: 'Switch to a different Superhuman account',
  notes:
    'Switches the active account. Triggers a page reload. ' +
    'If requiresLogin is true, tell the user they need to sign in to that account in Superhuman before retrying.',
  input: z.object({
    email: z
      .string()
      .describe(
        'Email address to switch to. Must be one of the accounts from listAccounts.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the switch completed successfully'),
    previousAccount: z.string().describe('Email of the account before switch'),
    currentAccount: z.string().describe('Email of the account after switch'),
    requiresLogin: z
      .boolean()
      .describe(
        'If true, the account requires re-authentication. Tell the user to sign in to this account in Superhuman.',
      ),
  }),
};

// ============================================================================
// List Snippets Schema
// ============================================================================

export const SnippetSchema = z.object({
  id: z.string().describe('Snippet ID (format: draft00{hex})'),
  name: z.string().describe('Snippet name/title'),
  subject: z.string().describe('Email subject template'),
  body: z.string().describe('HTML body template'),
  snippet: z.string().describe('Plain text preview'),
  date: z.string().describe('ISO date'),
  threadId: z.string().describe('Parent thread ID'),
  from: z.string().describe('Sender address'),
  to: z.array(z.string()).optional().describe('To recipients'),
  cc: z.array(z.string()).optional().describe('CC recipients'),
});

export const listSnippetsSchema = {
  name: 'listSnippets',
  description: 'List Superhuman snippets (reusable email templates)',
  notes: 'Returns snippets/templates. ',
  input: z.object({
    limit: z
      .number()
      .default(25)
      .describe('Maximum number of snippets to return'),
    offset: z.number().default(0).describe('Pagination offset'),
  }),
  output: z.object({
    account: z.string().describe('Email account'),
    snippets: z.array(SnippetSchema),
    total: z.number().describe('Total number of snippets returned'),
  }),
};

// ============================================================================
// List Drafts Schema
// ============================================================================

export const listDraftsSchema = {
  name: 'listDrafts',
  description: 'List unsent email drafts',
  notes:
    'Returns actual email drafts (unsent messages), not snippets/templates.',
  input: z.object({
    limit: z
      .number()
      .default(20)
      .describe('Maximum number of drafts to return'),
  }),
  output: z.object({
    account: z.string().describe('Email account'),
    threads: z.array(InboxThreadSchema),
  }),
};

export type ListDraftsInput = z.infer<typeof listDraftsSchema.input>;
export type ListDraftsOutput = z.infer<typeof listDraftsSchema.output>;

// ============================================================================
// Create Draft Schema
// ============================================================================

export const createDraftSchema = {
  name: 'createDraft',
  description: 'Create a new email draft in Superhuman',
  notes:
    'Draft writes directly to Superhuman backend and syncs to Gmail. ' +
    'BCC recipients are set but not visible via readEmail (standard BCC behavior). ' +
    'Draft attachments are not yet supported; use sendEmail with attachments instead.',
  input: z.object({
    to: z.array(z.string()).default([]).describe('Recipient email addresses'),
    cc: z
      .array(z.string())
      .default([])
      .describe('CC recipient email addresses'),
    bcc: z
      .array(z.string())
      .default([])
      .describe('BCC recipient email addresses'),
    subject: z.string().default('').describe('Email subject'),
    body: z
      .string()
      .default('')
      .describe(
        'Email body as HTML. Use <br> for line breaks (\\n is ignored). Basic tags: p, strong, em, a, br, ul, ol, li.',
      ),
    from: z
      .string()
      .optional()
      .describe(
        'Send from a different email address (alias). Must be configured as a Gmail "Send As" alias. ' +
          'Omit to send from the default account address. Use listAliases to see available aliases.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether draft was created'),
    id: z.string().describe('Draft message ID (unique within the thread)'),
    threadId: z
      .string()
      .describe('Thread ID (use this with readEmail/listDrafts)'),
    account: z.string().describe('Email account'),
    subject: z.string().describe('Draft subject'),
  }),
};

// ============================================================================
// Create Reply Draft Schema
// ============================================================================

export const createReplyDraftSchema = {
  name: 'createReplyDraft',
  description: 'Create a reply draft on an existing email thread',
  notes:
    'Creates a reply, reply-all, or forward draft on the last message of the thread. ' +
    'Recipients are auto-populated for reply/reply-all; for forwards, pass to/cc/bcc to set recipients. ' +
    'Thread must be in the cache (use listInbox or readEmail first).',
  input: z.object({
    threadId: z.string().describe('Thread ID to reply to'),
    body: z
      .string()
      .default('')
      .describe(
        'Reply body as HTML. Use <br> for line breaks (\\n is ignored). Placed above quoted content.',
      ),
    action: z
      .enum(['reply-all', 'reply', 'forward'])
      .default('reply-all')
      .describe('Reply action type'),
    to: z
      .array(z.string())
      .optional()
      .describe(
        'Override To recipients (email addresses). If omitted, auto-populated from original message.',
      ),
    cc: z
      .array(z.string())
      .optional()
      .describe(
        'Override CC recipients (email addresses). If omitted, auto-populated from original message.',
      ),
    bcc: z
      .array(z.string())
      .optional()
      .describe('Add BCC recipients (email addresses).'),
    from: z
      .string()
      .optional()
      .describe(
        'Send from a different email address (alias). Must be configured as a Gmail "Send As" alias. ' +
          'Omit to send from the default account address. Use listAliases to see available aliases.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether reply draft was created'),
    draftId: z.string().describe('Draft ID'),
    threadId: z.string().describe('Original thread ID'),
    subject: z.string().describe('Draft subject (auto-generated Re:/Fwd:)'),
    to: z.string().describe('Auto-populated recipients'),
    action: z.string().describe('Action performed'),
    account: z.string().describe('Email account'),
  }),
};

// ============================================================================
// Delete Draft Schema
// ============================================================================

export const deleteDraftSchema = {
  name: 'deleteDraft',
  description: 'Delete (discard) a draft email message',
  notes:
    'Deletes a draft by writing a discardedAt timestamp to the backend. ' +
    'Works for both standalone drafts and reply drafts on existing threads. ' +
    'Get the threadId and draftId from readEmail (draft messages have isDraft: true) or listDrafts.',
  input: z.object({
    threadId: z
      .string()
      .describe(
        'Thread ID containing the draft. For standalone drafts, this is the draft thread ID (starts with "draft00"). For reply drafts, this is the regular thread ID.',
      ),
    draftId: z
      .string()
      .describe(
        'Draft message ID to delete (starts with "draft00"). Get this from readEmail messages where isDraft is true.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the draft was deleted'),
    threadId: z.string().describe('Thread ID'),
    draftId: z.string().describe('Deleted draft message ID'),
    account: z.string().describe('Email account'),
  }),
};

// ============================================================================
// Ask AI Schema
// ============================================================================

export const askAISchema = {
  name: 'askAI',
  description:
    'Send a prompt to Superhuman AI and get a response. Can answer questions about your inbox, emails, calendar, and more.',
  notes:
    "Calls Superhuman's AI assistant which has access to your full inbox. " +
    'Optionally pass a threadId to give the AI context about a specific email thread. ' +
    'Pass chatHistory from previous responses to continue a conversation.',
  input: z.object({
    query: z.string().describe('The question or prompt for the AI'),
    threadId: z
      .string()
      .optional()
      .describe(
        'Thread ID to provide as context (AI will see the thread content)',
      ),
    sessionId: z
      .string()
      .optional()
      .describe(
        'Session ID for continuing a conversation. Omit to start a new session.',
      ),
    chatHistory: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']).describe('Message role'),
          content: z.string().describe('Message content'),
        }),
      )
      .optional()
      .describe('Previous messages in the conversation for multi-turn chat'),
  }),
  output: z.object({
    response: z.string().describe('AI response with thinking tags stripped'),
    rawResponse: z
      .string()
      .describe('Full AI response including thinking tags'),
    sessionId: z
      .string()
      .describe('Session ID for continuing the conversation'),
    eventId: z.string().describe('Response event ID'),
    account: z.string().describe('Email account used'),
  }),
};

// ============================================================================
// List Inbox Filters Schema
// ============================================================================

export const InboxFilterSchema = z.object({
  id: z.string().describe('Filter ID to pass to listInbox'),
  threadCount: z.number().describe('Number of threads in this category'),
});

export const listInboxFiltersSchema = {
  name: 'listInboxFilters',
  description: 'List available inbox categories and split inboxes',
  notes:
    'Returns all inbox filters the user has configured. ' +
    'Pass the filter ID to listInbox to list threads from that category.',
  input: z.object({}),
  output: z.object({
    account: z.string().describe('Email account'),
    filters: z.array(InboxFilterSchema),
  }),
};

export type ListInboxFiltersOutput = z.infer<
  typeof listInboxFiltersSchema.output
>;

// ============================================================================
// Send Email Schema
// ============================================================================

export const sendEmailSchema = {
  name: 'sendEmail',
  description: 'Send an email immediately via Superhuman',
  notes:
    'Sends a new email. The email is queued with a ~20 second delay (Superhuman undo window). ' +
    'Use cancelScheduledSend within that window to undo.',
  input: z.object({
    to: z
      .array(z.string())
      .min(1)
      .describe('Recipient email addresses (at least one required)'),
    cc: z
      .array(z.string())
      .default([])
      .describe('CC recipient email addresses'),
    bcc: z
      .array(z.string())
      .default([])
      .describe('BCC recipient email addresses'),
    subject: z.string().describe('Email subject line'),
    body: z
      .string()
      .default('')
      .describe(
        'Email body as HTML. Use <br> for line breaks (\\n is ignored). Basic tags: p, strong, em, a, br, ul, ol, li.',
      ),
    attachments: z
      .array(AttachmentInputSchema)
      .optional()
      .describe(
        'File attachments. Each needs a filename and either a path (device file path) or key (cloud storage key). ' +
          'The function loads and uploads files internally before sending.',
      ),
    from: z
      .string()
      .optional()
      .describe(
        'Send from a different email address (alias). Must be configured as a Gmail "Send As" alias. ' +
          'Omit to send from the default account address. Use listAliases to see available aliases.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the email was queued for sending'),
    account: z.string().describe('Sender email account'),
    threadId: z.string().describe('Thread ID of the sent email'),
    messageId: z.string().describe('Message ID of the sent email'),
    subject: z.string().describe('Email subject'),
  }),
};

// ============================================================================
// Send Reply Schema
// ============================================================================

export const sendReplySchema = {
  name: 'sendReply',
  description: 'Send a reply on an existing email thread',
  notes:
    'Sends a reply, reply-all, or forward on an existing thread. ' +
    'Thread must be in the cache (use listInbox or readEmail first). ' +
    'Recipients are auto-populated for reply/reply-all; for forwards, pass to/cc/bcc.',
  input: z.object({
    threadId: z.string().describe('Thread ID to reply to'),
    body: z
      .string()
      .default('')
      .describe(
        'Reply body as HTML. Use <br> for line breaks (\\n is ignored). Placed above quoted content.',
      ),
    action: z
      .enum(['reply-all', 'reply', 'forward'])
      .default('reply-all')
      .describe('Reply action type'),
    to: z
      .array(z.string())
      .optional()
      .describe(
        'Override To recipients. If omitted, auto-populated from original message.',
      ),
    cc: z
      .array(z.string())
      .optional()
      .describe(
        'Override CC recipients. If omitted, auto-populated from original message.',
      ),
    bcc: z.array(z.string()).optional().describe('Add BCC recipients.'),
    attachments: z
      .array(AttachmentInputSchema)
      .optional()
      .describe(
        'File attachments. Each needs a filename and either a path (device file path) or key (cloud storage key). ' +
          'The function loads and uploads files internally before sending.',
      ),
    from: z
      .string()
      .optional()
      .describe(
        'Send from a different email address (alias). Must be configured as a Gmail "Send As" alias. ' +
          'Omit to send from the default account address. Use listAliases to see available aliases.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the reply was queued for sending'),
    account: z.string().describe('Sender email account'),
    threadId: z.string().describe('Thread ID'),
    messageId: z.string().describe('Message ID of the reply'),
    subject: z.string().describe('Reply subject (auto-generated Re:/Fwd:)'),
    to: z.string().describe('Recipients the reply was sent to'),
    action: z.string().describe('Action performed (reply, reply-all, forward)'),
  }),
};

// ============================================================================
// Schedule Send Schema
// ============================================================================

export const scheduleSendSchema = {
  name: 'scheduleSend',
  description: 'Schedule an email to be sent at a future time',
  notes:
    'Queues an email for delivery at the specified time. ' +
    'The scheduledFor must be a future ISO 8601 date string. ' +
    'Use cancelScheduledSend to cancel before it sends.',
  input: z.object({
    to: z
      .array(z.string())
      .min(1)
      .describe('Recipient email addresses (at least one required)'),
    cc: z
      .array(z.string())
      .default([])
      .describe('CC recipient email addresses'),
    bcc: z
      .array(z.string())
      .default([])
      .describe('BCC recipient email addresses'),
    subject: z.string().describe('Email subject line'),
    body: z
      .string()
      .default('')
      .describe(
        'Email body as HTML. Use <br> for line breaks (\\n is ignored).',
      ),
    scheduledFor: z
      .string()
      .describe(
        'ISO 8601 date string for when to send the email. Must be in the future. ' +
          'Example: "2026-02-23T09:00:00.000Z"',
      ),
    attachments: z
      .array(AttachmentInputSchema)
      .optional()
      .describe(
        'File attachments. Each needs a filename and either a path (device file path) or key (cloud storage key). ' +
          'The function loads and uploads files internally before sending.',
      ),
    from: z
      .string()
      .optional()
      .describe(
        'Send from a different email address (alias). Must be configured as a Gmail "Send As" alias. ' +
          'Omit to send from the default account address. Use listAliases to see available aliases.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the email was scheduled'),
    account: z.string().describe('Sender email account'),
    threadId: z.string().describe('Thread ID'),
    messageId: z.string().describe('Message ID'),
    subject: z.string().describe('Email subject'),
    scheduledFor: z.string().describe('ISO date when the email will be sent'),
  }),
};

// ============================================================================
// Schedule Reply Schema
// ============================================================================

export const scheduleReplySchema = {
  name: 'scheduleReply',
  description:
    'Schedule a reply on an existing email thread for future delivery',
  notes:
    'Combines reply logic (quoted content, In-Reply-To headers) with scheduled delivery. ' +
    'Thread must be in the cache (use listInbox or readEmail first). ' +
    'Recipients are auto-populated for reply/reply-all; for forwards, pass to/cc/bcc. ' +
    'By default (abortOnReply: true), the scheduled reply is cancelled if the recipient replies before the scheduled time. ' +
    'Set abortOnReply: false to send regardless. Use cancelScheduledSend to cancel manually.',
  input: z.object({
    threadId: z.string().describe('Thread ID to reply to'),
    body: z
      .string()
      .default('')
      .describe(
        'Reply body as HTML. Use <br> for line breaks (\\n is ignored). Placed above quoted content.',
      ),
    action: z
      .enum(['reply-all', 'reply', 'forward'])
      .default('reply-all')
      .describe('Reply action type'),
    scheduledFor: z
      .string()
      .describe(
        'ISO 8601 date string for when to send the reply. Must be in the future. ' +
          'Example: "2026-02-23T09:00:00.000Z"',
      ),
    abortOnReply: z
      .boolean()
      .default(true)
      .describe(
        'If true (default), the scheduled reply is automatically cancelled if the recipient replies before the scheduled time. ' +
          'Set to false to send the reply regardless of whether the recipient has already replied.',
      ),
    to: z
      .array(z.string())
      .optional()
      .describe(
        'Override To recipients. If omitted, auto-populated from original message.',
      ),
    cc: z
      .array(z.string())
      .optional()
      .describe(
        'Override CC recipients. If omitted, auto-populated from original message.',
      ),
    bcc: z.array(z.string()).optional().describe('Add BCC recipients.'),
    attachments: z
      .array(AttachmentInputSchema)
      .optional()
      .describe(
        'File attachments. Each needs a filename and either a path (device file) or key (cloud file).',
      ),
    from: z
      .string()
      .optional()
      .describe(
        'Send from a different email address (alias). Must be configured as a Gmail "Send As" alias. ' +
          'Omit to send from the default account address. Use listAliases to see available aliases.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the reply was scheduled'),
    account: z.string().describe('Sender email account'),
    threadId: z.string().describe('Thread ID'),
    messageId: z.string().describe('Message ID of the scheduled reply'),
    subject: z.string().describe('Reply subject (auto-generated Re:/Fwd:)'),
    to: z.string().describe('Recipients the reply will be sent to'),
    action: z.string().describe('Action performed (reply, reply-all, forward)'),
    scheduledFor: z.string().describe('ISO date when the reply will be sent'),
    abortOnReply: z
      .boolean()
      .describe(
        'Whether the reply will be cancelled if the recipient replies first',
      ),
  }),
};

// ============================================================================
// Update Draft Schema
// ============================================================================

export const updateDraftSchema = {
  name: 'updateDraft',
  description:
    'Update an existing draft email (change recipients, body, or subject)',
  notes:
    'Modifies an existing draft in-place. Pass only the fields you want to change. ' +
    'Get threadId and draftId from readEmail (draft messages have isDraft: true) or listDrafts. ' +
    'Works for both standalone drafts and reply drafts on existing threads.',
  input: z.object({
    threadId: z
      .string()
      .describe(
        'Thread ID containing the draft. For standalone drafts, starts with "draft00". For reply drafts, this is the regular thread ID.',
      ),
    draftId: z
      .string()
      .describe(
        'Draft message ID to update (starts with "draft00"). Get this from readEmail messages where isDraft is true.',
      ),
    to: z
      .array(z.string())
      .optional()
      .describe('New To recipients (replaces existing). Omit to keep current.'),
    cc: z
      .array(z.string())
      .optional()
      .describe('New CC recipients (replaces existing). Omit to keep current.'),
    bcc: z
      .array(z.string())
      .optional()
      .describe(
        'New BCC recipients (replaces existing). Omit to keep current.',
      ),
    subject: z
      .string()
      .optional()
      .describe('New subject line. Omit to keep current.'),
    body: z
      .string()
      .optional()
      .describe(
        'New body content as HTML. Use <br> for line breaks (\\n is ignored). Omit to keep current.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the draft was updated'),
    threadId: z.string().describe('Thread ID'),
    draftId: z.string().describe('Updated draft message ID'),
    account: z.string().describe('Email account'),
    subject: z.string().describe('Draft subject after update'),
  }),
};

// ============================================================================
// Cancel Scheduled Send Schema
// ============================================================================

export const cancelScheduledSendSchema = {
  name: 'cancelScheduledSend',
  description: 'Cancel a scheduled or in-flight email send',
  notes:
    'Cancels an email that was scheduled via scheduleSend or is still in the ~20 second ' +
    'undo window after sendEmail/sendReply. Pass the threadId and messageId from the send response.',
  input: z.object({
    threadId: z.string().describe('Thread ID from the send response'),
    messageId: z.string().describe('Message ID from the send response'),
    superhumanId: z
      .string()
      .optional()
      .describe('Superhuman ID (optional, for precise cancellation)'),
    rfc822Id: z.string().optional().describe('RFC822 message ID (optional)'),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the send was cancelled'),
    account: z.string().describe('Email account'),
    threadId: z.string().describe('Thread ID'),
    messageId: z.string().describe('Message ID'),
  }),
};

// ============================================================================
// List Aliases Schema
// ============================================================================

export const listAliasesSchema = {
  name: 'listAliases',
  description: 'List available "Send As" email aliases for the current account',
  notes:
    'Returns Gmail "Send As" aliases configured for this account. ' +
    'Use the sendAsEmail value as the "from" parameter in send/draft functions.',
  input: z.object({}),
  output: z.object({
    account: z.string().describe('Primary email account'),
    aliases: z.array(
      z.object({
        email: z.string().describe('Alias email address (use as "from" value)'),
        name: z.string().describe('Display name for the alias'),
        isDefault: z
          .boolean()
          .describe('Whether this is the default send-as address'),
        isPrimary: z
          .boolean()
          .describe('Whether this is the primary account address'),
      }),
    ),
  }),
};

// ============================================================================
// Search Emails Schema
// ============================================================================

export const searchEmailsSchema = {
  name: 'searchEmails',
  description:
    'Search emails using Superhuman shortcuts or Gmail search operators (from:, to:, subject:, has:attachment, after:, before:, etc.)',
  notes:
    "Uses the Gmail Messages.list API via Superhuman's cached OAuth token. " +
    'Supports Superhuman-style shortcuts and all Gmail search operators. ' +
    'Results include threads from cache with full metadata, and threads not in cache ' +
    'with metadata fetched from Gmail API. Call getContext() first to verify session.',
  input: z.object({
    query: z
      .string()
      .describe(
        'Search query. Supports Superhuman shortcuts (:sent, :starred, :unread, :read, :attachment, ' +
          ':important, :snoozed, :trash, :spam, :draft, :scheduled, :done, :inbox, :all) ' +
          'and all Gmail search operators (from:, to:, subject:, has:attachment, ' +
          'after:YYYY/MM/DD, before:YYYY/MM/DD, is:unread, is:starred, label:, in:, ' +
          'newer_than:2d, older_than:1y, filename:, etc.). ' +
          'Example: ":sent from:alice@example.com" or "subject:invoice after:2026/01/01"',
      ),
    limit: z
      .number()
      .default(20)
      .describe('Maximum number of threads to return (1-100)'),
  }),
  output: z.object({
    account: z.string().describe('Email account that was searched'),
    query: z.string().describe('The search query that was executed'),
    resultSizeEstimate: z
      .number()
      .describe('Estimated total number of matching results from Gmail'),
    threads: z.array(InboxThreadSchema).describe('Matching email threads'),
  }),
};

export type SearchEmailsInput = z.infer<typeof searchEmailsSchema.input>;
export type SearchEmailsOutput = z.infer<typeof searchEmailsSchema.output>;

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  getContextSchema,
  listInboxFiltersSchema,
  listInboxSchema,
  searchEmailsSchema,
  readEmailSchema,
  downloadAttachmentSchema,
  archiveEmailSchema,
  unarchiveEmailSchema,
  setReminderSchema,
  cancelReminderSchema,
  listSplitInboxesSchema,
  moveThreadSchema,
  starEmailSchema,
  unstarEmailSchema,
  markReadSchema,
  markUnreadSchema,
  listAccountsSchema,
  switchAccountSchema,
  listAliasesSchema,
  listSnippetsSchema,
  listDraftsSchema,
  createDraftSchema,
  createReplyDraftSchema,
  updateDraftSchema,
  deleteDraftSchema,
  askAISchema,
  sendEmailSchema,
  sendReplySchema,
  scheduleSendSchema,
  scheduleReplySchema,
  cancelScheduledSendSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

export type SuperhumanContext = z.infer<typeof SuperhumanContextSchema>;
export type InboxThread = z.infer<typeof InboxThreadSchema>;
export type EmailContact = z.infer<typeof EmailContactSchema>;
export type EmailAttachment = z.infer<typeof EmailAttachmentSchema>;
export type EmailMessage = z.infer<typeof EmailMessageSchema>;
export type AccountInfo = z.infer<typeof AccountInfoSchema>;
export type Snippet = z.infer<typeof SnippetSchema>;

export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type ListInboxInput = z.infer<typeof listInboxSchema.input>;
export type ListInboxOutput = z.infer<typeof listInboxSchema.output>;
export type ReadEmailInput = z.infer<typeof readEmailSchema.input>;
export type ReadEmailOutput = z.infer<typeof readEmailSchema.output>;
export type DownloadAttachmentInput = z.infer<
  typeof downloadAttachmentSchema.input
>;
export type DownloadAttachmentOutput = z.infer<
  typeof downloadAttachmentSchema.output
>;
export type ArchiveEmailInput = z.infer<typeof archiveEmailSchema.input>;
export type ArchiveEmailOutput = z.infer<typeof archiveEmailSchema.output>;
export type UnarchiveEmailInput = z.infer<typeof unarchiveEmailSchema.input>;
export type UnarchiveEmailOutput = z.infer<typeof unarchiveEmailSchema.output>;
export type SetReminderInput = z.infer<typeof setReminderSchema.input>;
export type SetReminderOutput = z.infer<typeof setReminderSchema.output>;
export type CancelReminderInput = z.infer<typeof cancelReminderSchema.input>;
export type CancelReminderOutput = z.infer<typeof cancelReminderSchema.output>;
export type ListSplitInboxesOutput = z.infer<
  typeof listSplitInboxesSchema.output
>;
export type MoveThreadInput = z.infer<typeof moveThreadSchema.input>;
export type MoveThreadOutput = z.infer<typeof moveThreadSchema.output>;
export type StarEmailInput = z.infer<typeof starEmailSchema.input>;
export type StarEmailOutput = z.infer<typeof starEmailSchema.output>;
export type UnstarEmailInput = z.infer<typeof unstarEmailSchema.input>;
export type UnstarEmailOutput = z.infer<typeof unstarEmailSchema.output>;
export type MarkReadInput = z.infer<typeof markReadSchema.input>;
export type MarkReadOutput = z.infer<typeof markReadSchema.output>;
export type MarkUnreadInput = z.infer<typeof markUnreadSchema.input>;
export type MarkUnreadOutput = z.infer<typeof markUnreadSchema.output>;
export type ListAccountsOutput = z.infer<typeof listAccountsSchema.output>;
export type SwitchAccountInput = z.infer<typeof switchAccountSchema.input>;
export type SwitchAccountOutput = z.infer<typeof switchAccountSchema.output>;
export type ListSnippetsInput = z.infer<typeof listSnippetsSchema.input>;
export type ListSnippetsOutput = z.infer<typeof listSnippetsSchema.output>;
export type CreateDraftInput = z.infer<typeof createDraftSchema.input>;
export type CreateDraftOutput = z.infer<typeof createDraftSchema.output>;
export type CreateReplyDraftInput = z.infer<
  typeof createReplyDraftSchema.input
>;
export type CreateReplyDraftOutput = z.infer<
  typeof createReplyDraftSchema.output
>;
export type DeleteDraftInput = z.infer<typeof deleteDraftSchema.input>;
export type DeleteDraftOutput = z.infer<typeof deleteDraftSchema.output>;
export type AskAIInput = z.infer<typeof askAISchema.input>;
export type AskAIOutput = z.infer<typeof askAISchema.output>;
export type SendEmailInput = z.infer<typeof sendEmailSchema.input>;
export type SendEmailOutput = z.infer<typeof sendEmailSchema.output>;
export type SendReplyInput = z.infer<typeof sendReplySchema.input>;
export type SendReplyOutput = z.infer<typeof sendReplySchema.output>;
export type ScheduleSendInput = z.infer<typeof scheduleSendSchema.input>;
export type ScheduleSendOutput = z.infer<typeof scheduleSendSchema.output>;
export type ScheduleReplyInput = z.infer<typeof scheduleReplySchema.input>;
export type ScheduleReplyOutput = z.infer<typeof scheduleReplySchema.output>;
export type UpdateDraftInput = z.infer<typeof updateDraftSchema.input>;
export type UpdateDraftOutput = z.infer<typeof updateDraftSchema.output>;
export type CancelScheduledSendInput = z.infer<
  typeof cancelScheduledSendSchema.input
>;
export type CancelScheduledSendOutput = z.infer<
  typeof cancelScheduledSendSchema.output
>;
export type ListAliasesOutput = z.infer<typeof listAliasesSchema.output>;

// ============================================================================
// Internal Type Definitions for Superhuman Internals
// ============================================================================

export interface SuperhumanContactModel {
  email: string;
  name?: string;
  clone: () => SuperhumanContactModel;
}

export interface SuperhumanDraftModel {
  id: string;
  threadId?: string;
  getLastSessionId: () => string | null;
  getSubject: () => string;
  getBody: () => string;
  setBody: (body: string) => void;
  getTo: () => Array<{ email: string; name?: string }>;
  getAction: () => string;
  json: () => Record<string, unknown>;
  from: SuperhumanContactModel;
  to: Array<{ email: string; name: string }>;
  cc: Array<{ email: string; name: string }>;
  bcc?: Array<{ email: string; name: string }>;
  body?: string;
}

export interface SuperhumanThreadPresenterForDraft {
  id: string;
  initializeDraft: (fields: {
    to?: Array<{ email: string; name: string }>;
    cc?: Array<{ email: string; name: string }>;
    bcc?: Array<{ email: string; name: string }>;
    subject?: string;
    body?: string;
    action?: string;
  }) => SuperhumanDraftModel;
  saveDraft: (draftModel: SuperhumanDraftModel) => Promise<void>;
  deleteFromInMemory: () => void;
  draftPresenter: () => SuperhumanThreadPresenterForDraft | null;
}

export interface SuperhumanOperation {
  watching: boolean;
  uniqueCallback: () => void;
  onUnwatch: (cb: () => void) => void;
}

export interface SuperhumanAliasEntry {
  sendAs?: {
    sendAsEmail?: string;
    displayName?: string;
    isDefault?: boolean;
    isPrimary?: boolean;
  };
}

export interface SuperhumanSplitInbox {
  id: string;
  getName: () => string;
  getSlug: () => string;
  getType: () => string;
  isDisabled: () => boolean;
  toJson: () => {
    labels?: Array<{ id: string; name?: string }>;
    matcher?: { query?: string };
  };
}

export interface SuperhumanAccount {
  emailAddress: string;
  accountList?: () => string[];
  getAllSplitInboxes: () => SuperhumanSplitInbox[];
  settings?: {
    _cache?: {
      aliases?: {
        list?: SuperhumanAliasEntry[];
      };
    };
  };
  switchAccount: (
    opts: { emailAddress: string } | { target: string; accountIndex?: number },
  ) => void;
  accountStore?: {
    _loginStore?: {
      getProvider: (email: string) => string | undefined;
      isLoggedIn: (email: string) => boolean;
    };
  };
  credential: {
    provider: 'google' | 'microsoft';
    getIDTokenAsync?: () => Promise<string>;
    user?: {
      providerId?: string;
    };
  };
  threads: {
    identityMap: {
      cache: Record<
        string,
        SuperhumanThreadPresenter | SuperhumanCachedThreadPresenter
      >;
    };
    getNewDraftPresenter: (
      operation: SuperhumanOperation,
    ) => SuperhumanThreadPresenterForDraft;
  };
  gmail: {
    changeLabels: (
      messageId: string,
      addLabels: string[],
      removeLabels: string[],
    ) => Promise<unknown>;
    changeLabelsPerThread: (
      threadId: string,
      addLabelIds: string[],
      removeLabelIds: string[],
    ) => Promise<unknown>;
    downloadAttachment: (opts: {
      threadId: string;
      messageId: string;
      id: string;
      type: string;
    }) => Promise<Blob>;
  };
  backend: {
    writeUserData: (opts: { path: string; value: unknown }) => Promise<unknown>;
    writeUserDataMessage: (
      writes: Array<{ path: string; value: unknown }>,
    ) => Promise<unknown>;
    _appToBackendDraft: (draft: Record<string, unknown>) => void;
    _credential?: {
      getIDTokenAsync: () => Promise<string>;
      getAccessTokenAsync: () => Promise<string>;
    };
    uploadAttachment: (opts: {
      draftMessageId: string;
      threadId: string;
      uuid: string;
      blob: Blob;
    }) => Promise<unknown>;
    sendEmail: (
      outgoingMessage: {
        toJsonRequest: () => Record<string, unknown>;
        getSuperhumanId: () => string;
        getThreadId: () => string;
        getMessageId: () => string;
      },
      reminder?: { toJson: () => Record<string, unknown> },
    ) => Promise<unknown>;
    cancelSendEmail: (opts: {
      draft_message_id: string;
      draft_thread_id: string;
      superhuman_id: string;
      rfc822_id: string;
      bypassOnlineCheck?: boolean;
    }) => Promise<unknown>;
    createReminder: (
      reminderObj: { toJson: () => Record<string, unknown> },
      opts: { markDone: boolean; moveToInbox: boolean },
    ) => Promise<unknown>;
    cancelReminder: (opts: {
      reminderId: string;
      threadId: string;
      moveToInbox: boolean;
    }) => Promise<unknown>;
  };
  user?: {
    _name?: string;
  };
  lists?: {
    identityMap?: {
      cache: Record<
        string,
        {
          matcher?: string | unknown;
          _sortedList?: {
            sorted?: Array<{ id: string; sort?: unknown; group?: unknown }>;
          };
        }
      >;
    };
  };
}

export interface SuperhumanCachedThreadPresenter {
  renders?: Record<string, unknown>;
  loadContentAsync: () => Promise<void>;
  metadata?: {
    messages?: Array<{ id?: string; [key: string]: unknown }>;
  };
  createOrReplaceDraftAsync: (
    messageId: string,
    action: string,
  ) => Promise<SuperhumanDraftModel | null>;
}

export interface SuperhumanThreadPresenter {
  _threadModel: {
    subject?: string;
    messages?: SuperhumanMessage[];
    labelIds?: string[];
    isInInbox?: () => boolean;
    isDone?: () => boolean;
    isTrash?: () => boolean;
    isSpam?: () => boolean;
    isUnread?: () => boolean;
    isStarred?: () => boolean;
    labels?: Array<{ name?: string } | string>;
    hasReminder?: () => boolean;
    getReminder?: () => {
      getReminderId: () => string;
      getThreadId: () => string;
    } | null;
  };
}

export interface SuperhumanMessage {
  id?: string;
  _isDraft?: boolean;
  from?: {
    name?: string;
    email?: string;
  };
  to?: Array<{
    name?: string;
    email?: string;
  }>;
  cc?: Array<{
    name?: string;
    email?: string;
  }>;
  date?: Date | number;
  snippet?: string;
  body?: string;
  isUnread?: () => boolean;
  attachments?: Array<{
    name?: string;
    type?: string;
    attachmentId?: string;
    inline?: boolean;
    raw?: {
      size?: number;
      name?: string;
      type?: string;
      attachmentId?: string;
      messageId?: string;
    };
  }>;
}

declare global {
  interface Window {
    Account?: SuperhumanAccount;
  }
}
