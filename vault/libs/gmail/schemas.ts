import { z } from 'zod';

export const libraryDescription =
  'Gmail operations via internal APIs (JSPB protocol)';

export const libraryIcon = '/icons/libs/gmail.ico';
export const loginUrl = 'https://mail.google.com';

export const libraryNotes = `
## BEFORE YOU DO ANYTHING

**ALWAYS confirm which Gmail account to use.** Users have multiple accounts (personal/work).
1. Call \`listAccounts()\` first
2. Ask the user: "Which Gmail account should I use?" and list the options
3. Only proceed after explicit confirmation. NEVER assume.

## Workflow

1. Navigate to \`https://mail.google.com\`
2. Call \`listAccounts()\` and confirm which account to use
3. Call \`getContext()\` to get \`{ xsrf, account, userId, email, globals }\`
4. Pass these to every subsequent function:
   - \`xsrf\` → the XSRF token for API authentication
   - \`account\` → the account number (0-indexed, from URL /u/{N}/)
   - \`globals\` → internal Gmail values (g2, g3, g9, g10) needed for the BTAI header

## Pagination

Gmail uses page-based pagination: \`count\` (page size) and \`page\` (0-indexed page number).

## Destructive Operations

**CRITICAL**: Always confirm before send/reply/forward/delete.
Show what will happen, get explicit user approval.

## Unsupported Operations

The following are NOT supported and will fail if attempted:
- Label management (create, apply, or remove labels)
- Starring or unstarring threads
- Downloading attachment content (only listing attachments is available)
- Deleting individual drafts

Do not attempt raw API calls for these; they will fail.

## Cross-Account Authentication

XSRF tokens are bound per-account. When switching between Gmail accounts, you must re-run \`getContext()\` after navigating to the target account to get fresh credentials. Passing account 0's XSRF with account 1's data will cause 400 errors.
`;

// ============================================================================
// Rate Limits
// ============================================================================

export const rateLimits: Record<
  string,
  Array<{ window: 'MINUTE' | 'HOUR' | 'DAY'; maxCalls: number; message: string }>
> = {
  sendEmail: [
    { window: 'MINUTE', maxCalls: 10, message: 'Gmail throttles >10 sends/min from web' },
    { window: 'DAY', maxCalls: 500, message: 'Gmail web caps at ~500/day for free, ~2000 Workspace' },
  ],
  replyEmail: [
    { window: 'MINUTE', maxCalls: 10, message: 'Same throttle as sendEmail' },
  ],
  forwardEmail: [
    { window: 'MINUTE', maxCalls: 10, message: 'Same throttle as sendEmail' },
  ],
};

export const crmTrackable: Record<string, { argFields?: readonly string[]; resultFields?: readonly string[] }> = {
  sendEmail: {
    argFields: ['to', 'subject', 'body'],
    resultFields: ['from', 'to', 'subject', 'threadId', 'messageId'],
  },
  replyEmail: {
    argFields: ['to', 'subject', 'body'],
    resultFields: ['from', 'to', 'subject', 'threadId', 'newMessageId'],
  },
};

export const borgableFunctions: Record<string, { access: 'read' | 'write'; nonPassableArgs: readonly string[] }> = {
  resolveContactByEmail: { access: 'read', nonPassableArgs: [] },
};

// ============================================================================
// Shared Parameter Schemas
// ============================================================================

export const XsrfParam = z.string().describe('XSRF token from getContext');

export const AccountParam = z
  .number()
  .int()
  .min(0)
  .describe('Account number from URL /u/{N}/ (0-indexed)');

export const ThreadIdParam = z
  .string()
  .regex(/^thread-(f|a:r)/)
  .describe('Thread ID (thread-f:... for received, thread-a:r... for sent)');

export const MessageIdParam = z
  .string()
  .regex(/^msg-(f|a:r)/)
  .describe('Message ID (msg-f:... for received, msg-a:r... for sent)');

// ============================================================================
// Shared Output Schemas
// ============================================================================

export const EmailAddressSchema = z.object({
  email: z.string().describe('Email address'),
  name: z.string().describe('Display name'),
});

export const MessageSummarySchema = z.object({
  threadId: ThreadIdParam,
  messageId: MessageIdParam,
  subject: z.string().describe('Email subject'),
  from: EmailAddressSchema,
  date: z.number().describe('Timestamp in milliseconds'),
  snippet: z.string().describe('Preview text'),
  labels: z.array(z.string()).optional().describe('Gmail labels'),
  unread: z.boolean().optional().describe('Whether message is unread'),
  messageCount: z
    .number()
    .optional()
    .describe('Number of messages in the thread'),
});

export const MessageContentSchema = z.object({
  messageId: MessageIdParam,
  from: EmailAddressSchema,
  to: z.array(EmailAddressSchema).describe('Recipients'),
  cc: z
    .array(EmailAddressSchema)
    .describe('CC recipients (empty array if none)'),
  subject: z.string().describe('Email subject'),
  body: z.string().describe('Plain text body'),
  bodyHtml: z.string().describe('HTML body'),
  date: z.number().describe('Timestamp in milliseconds'),
  snippet: z.string().optional().describe('Preview text'),
  labels: z.array(z.string()).optional().describe('Gmail labels'),
  attachmentCount: z.number().optional().describe('Number of attachments'),
});

export const AccountSchema = z.object({
  email: z.string().describe('Email address'),
  name: z.string().describe('Display name'),
  accountNumber: z
    .number()
    .nullable()
    .describe(
      'Account index (0-based). Null for signed-out accounts that have no /u/{N}/ slot.',
    ),
  userId: z.string().describe('Google Account ID (GAIA ID)'),
  isCurrent: z.boolean().describe('Whether this is the current account'),
});

export const AttachmentInputSchema = z.union([
  z.object({
    fileName: z
      .string()
      .describe('Filename with extension (e.g., "report.pdf")'),
    mimeType: z
      .string()
      .describe('MIME type (e.g., "application/pdf", "image/png")'),
    base64Data: z.string().describe('File content as base64-encoded string'),
  }),
  z.object({
    fileName: z
      .string()
      .describe('Filename with extension (e.g., "report.pdf")'),
    mimeType: z
      .string()
      .describe('MIME type (e.g., "application/pdf", "image/png")'),
    blobRef: z.string().describe('Blob reference from uploadAttachment'),
    attachmentId: z
      .string()
      .describe('Attachment ID from uploadAttachment (f_xxx format)'),
    size: z.number().describe('File size in bytes from uploadAttachment'),
  }),
]);

export const CcBccRecipientsSchema = z
  .array(z.string().email())
  .optional()
  .nullable()
  .describe('Email addresses for CC or BCC recipients');

// Schema that accepts either a single email string or array of emails
export const RecipientsSchema = z
  .union([z.string().email(), z.array(z.string().email())])
  .describe('Recipient email(s) - single email string or array of emails');

export const AttachmentResultSchema = z.object({
  fileName: z.string().describe('Uploaded filename'),
  size: z.number().describe('File size in bytes'),
});

// ============================================================================
// Context Schema
// ============================================================================

export const GmailGlobalsSchema = z.object({
  g2: z.number().describe('User ID'),
  g3: z.string().describe('Server version'),
  g9: z.string().describe('IK hash (used in BTAI header)'),
  g10: z.string().describe('Email address'),
});

export const GmailContextSchema = z.object({
  xsrf: z.string().describe('XSRF token for API requests'),
  account: z.number().describe('Account number (0-indexed)'),
  internalUserId: z
    .number()
    .describe(
      'Gmail-internal user ID (from GLOBALS). Not the same as the Google Account userId from listAccounts.',
    ),
  email: z.string().describe('Email address'),
  globals: GmailGlobalsSchema.describe('Gmail internal values for BTAI header'),
});

// ============================================================================
// Action Schemas
// ============================================================================

export const getContextSchema = {
  name: 'getContext',
  description: 'Extract Gmail authentication context from current session',
  notes:
    'Call FIRST before any Gmail operations. User must be on mail.google.com.',
  input: z.object({
    timeoutMs: z
      .number()
      .optional()
      .default(10000)
      .describe('Max wait time in milliseconds (default: 10000)'),
  }),
  output: GmailContextSchema,
};

export const listAccountsSchema = {
  name: 'listAccounts',
  description: 'List all Gmail accounts in the current browser session',
  notes:
    'CALL THIS FIRST before any Gmail operation. Users often have multiple accounts (personal/work). ' +
    'You MUST list accounts and ask the user which one to use before proceeding. Never assume. ' +
    'Accounts with accountNumber: null are signed out; tell the user they need to sign in to that account first if they want to use it.',
  input: z.object({}),
  output: z.object({
    accounts: z.array(AccountSchema),
    currentAccountNumber: z.number().describe('Currently active account index'),
    totalAccounts: z.number().describe('Total number of accounts'),
  }),
};

export const listInboxSchema = {
  name: 'listInbox',
  description:
    'List email threads from Gmail inbox (one entry per thread, showing the latest message)',
  notes:
    'Returns one row per thread with a messageCount field. Use readEmail(threadId) to see all messages in a thread.',
  input: z.object({
    xsrf: XsrfParam,
    account: AccountParam,
    globals: GmailGlobalsSchema,
    count: z
      .number()
      .optional()
      .default(20)
      .describe('Number of messages (max: 2000)'),
    page: z
      .number()
      .optional()
      .default(0)
      .describe('Page number for pagination'),
    viewType: z
      .number()
      .optional()
      .default(49)
      .describe('Gmail view type (49=Primary, 6=Drafts, 12=Sent)'),
  }),
  output: z.object({
    messages: z.array(MessageSummarySchema),
    nextCursor: z.string().nullable().describe('Cursor for next page'),
    totalCount: z.number().describe('Number of messages returned'),
  }),
};

export const searchEmailsSchema = {
  name: 'searchEmails',
  description: 'Search Gmail using Gmail search query syntax',
  notes:
    'Returns one result per thread (not per message). Max 50 results per call. ' +
    'Use broad queries for best results (e.g. "santander" instead of "santander economic proposal"). ' +
    'Supports Gmail search operators: from:, to:, subject:, has:attachment, before:, after:, etc. ' +
    'Known limitation: scope "sent" may return empty results; use scope "all" with "from:<your-email>" as the query instead to search sent mail.',
  input: z.object({
    xsrf: XsrfParam,
    account: AccountParam,
    globals: GmailGlobalsSchema,
    query: z
      .string()
      .describe('Gmail search query (e.g., "from:user@example.com")'),
    scope: z
      .enum(['all', 'inbox', 'sent', 'drafts', 'trash'])
      .optional()
      .default('all')
      .describe('Folder scope: all (default), inbox, sent, drafts, or trash'),
    limit: z
      .number()
      .optional()
      .default(50)
      .describe('Max results to return (max 50)'),
  }),
  output: z.object({
    messages: z.array(MessageSummarySchema),
    totalCount: z.number().describe('Number of messages returned'),
  }),
};

export const readEmailSchema = {
  name: 'readEmail',
  description: 'Read full email content from a thread',
  notes:
    'Always call this before drafting a reply or replyEmail/createDraft on an existing thread: `messages[].cc` and `messages[].to` are the source of truth for who was on the conversation. `replyEmail` and `createDraft` do not auto-inherit those — you must decide reply vs reply-all and pass the chosen `cc` list yourself.',
  input: z.object({
    xsrf: XsrfParam,
    account: AccountParam,
    globals: GmailGlobalsSchema,
    threadId: ThreadIdParam,
  }),
  output: z.object({
    threadId: ThreadIdParam,
    messageCount: z.number().describe('Number of messages in thread'),
    messages: z.array(MessageContentSchema),
  }),
};

export const sendEmailSchema = {
  name: 'sendEmail',
  description: 'Send a new email with optional attachments, CC, and BCC',
  notes:
    '**Output format**: If presenting a draft to the user before sending, you MUST use the "message-draft" skill (useSkill("message-draft")) to render it as an editable UI card for approval. Use the "sales-copy" skill for composing effective emails. **CRM**: After sending, this email and its thread are logged to the CRM automatically, and every recipient is added as a contact keyed by email address — you do not need to record the message, the thread, or the contacts. Only the email identity is captured (no profile enrichment runs for email); contact names and all higher-level fields are left blank and must be filled in manually.',
  input: z.object({
    xsrf: XsrfParam,
    account: AccountParam,
    globals: GmailGlobalsSchema,
    to: RecipientsSchema.describe(
      'Recipient email(s) - single email or array of emails',
    ),
    subject: z.string().describe('Email subject'),
    body: z.string().describe('Email body (plain text, newlines become <br>)'),
    cc: CcBccRecipientsSchema.describe(
      'CC recipients (array of email addresses)',
    ),
    bcc: CcBccRecipientsSchema.describe(
      'BCC recipients (array of email addresses)',
    ),
    attachments: z
      .array(AttachmentInputSchema)
      .optional()
      .nullable()
      .describe(
        'Files to attach. Each item is either {fileName, mimeType, base64Data} for inline upload, or {fileName, mimeType, blobRef, attachmentId, size} from uploadAttachment',
      ),
    scheduleTime: z
      .number()
      .optional()
      .nullable()
      .describe('Schedule send timestamp (ms). Omit to send immediately.'),
  }),
  output: z.object({
    success: z.boolean(),
    from: z.string().describe('Sender email'),
    to: z.array(z.string()).describe('Recipient email(s)'),
    cc: z.array(z.string()).nullable().describe('CC recipients'),
    bcc: z.array(z.string()).nullable().describe('BCC recipients'),
    subject: z.string(),
    scheduled: z.boolean().describe('Whether email was scheduled'),
    scheduledFor: z.string().nullable().describe('ISO date if scheduled'),
    threadId: ThreadIdParam,
    messageId: MessageIdParam,
    attachments: z
      .array(AttachmentResultSchema)
      .nullable()
      .describe('Uploaded attachments'),
  }),
};

export const replyEmailSchema = {
  name: 'replyEmail',
  description:
    'Reply to an existing email thread with optional attachments, CC, and BCC',
  notes:
    '**Reply vs reply-all is your decision.** This function does NOT auto-include prior CC/BCC — both default to empty. Before drafting a reply, call `readEmail(threadId)` to see who was on the original `to`/`cc`, then choose: reply (just the original sender) or reply-all (include the prior CC, optionally adding the prior `to` minus yourself). Build the `cc` array explicitly from that choice. When the thread had CC participants and you are intentionally dropping them (private reply), surface that choice in the draft preview so the user can confirm. **Output format**: If presenting a draft to the user before sending, you MUST use the "message-draft" skill (useSkill("message-draft")) to render it as an editable UI card for approval. Use the "sales-copy" skill for composing effective replies. **CRM**: After sending, this reply and its thread are logged to the CRM automatically, and every recipient is added as a contact keyed by email address — you do not need to record the message, the thread, or the contacts. Only the email identity is captured (no profile enrichment runs for email); contact names and all higher-level fields are left blank and must be filled in manually.',
  input: z.object({
    xsrf: XsrfParam,
    account: AccountParam,
    globals: GmailGlobalsSchema,
    threadId: ThreadIdParam,
    originalMsgId: MessageIdParam.describe('Message ID being replied to'),
    to: RecipientsSchema.describe(
      'Recipient email(s) - single email or array of emails',
    ),
    subject: z.string().describe('Email subject (typically "Re: Original")'),
    body: z.string().describe('Reply body (plain text)'),
    cc: CcBccRecipientsSchema.describe(
      'CC recipients (array of email addresses). Not auto-inherited from the thread — pass the prior CC list explicitly to do reply-all. Leave unset for a private reply.',
    ),
    bcc: CcBccRecipientsSchema.describe(
      'BCC recipients (array of email addresses)',
    ),
    attachments: z
      .array(AttachmentInputSchema)
      .optional()
      .nullable()
      .describe(
        'Files to attach. Each item is either {fileName, mimeType, base64Data} for inline upload, or {fileName, mimeType, blobRef, attachmentId, size} from uploadAttachment',
      ),
  }),
  output: z.object({
    success: z.boolean(),
    from: z.string(),
    to: z.array(z.string()).describe('Recipient email(s)'),
    cc: z.array(z.string()).nullable().describe('CC recipients'),
    bcc: z.array(z.string()).nullable().describe('BCC recipients'),
    subject: z.string(),
    threadId: ThreadIdParam,
    originalMsgId: MessageIdParam,
    newMessageId: MessageIdParam,
    attachments: z
      .array(AttachmentResultSchema)
      .nullable()
      .describe('Uploaded attachments'),
  }),
};

export const deleteEmailSchema = {
  name: 'deleteEmail',
  description: 'Delete an email thread (moves to trash)',
  notes: '',
  input: z.object({
    xsrf: XsrfParam,
    account: AccountParam,
    globals: GmailGlobalsSchema,
    threadId: ThreadIdParam,
    permanent: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, permanently delete (cannot be undone)'),
  }),
  output: z.object({
    success: z.boolean(),
    threadId: ThreadIdParam,
    messageIds: z.array(MessageIdParam).describe('Deleted message IDs'),
    messageCount: z.number(),
    permanent: z.boolean(),
  }),
};

export const listDraftsSchema = {
  name: 'listDrafts',
  description: 'List draft emails',
  notes:
    'Recipient (to) is always null in list response. Use readEmail(threadId) to get the actual recipient.',
  input: z.object({
    xsrf: XsrfParam,
    account: AccountParam,
    globals: GmailGlobalsSchema,
    count: z
      .number()
      .optional()
      .default(10)
      .describe('Number of drafts to list'),
  }),
  output: z.object({
    drafts: z.array(
      z.object({
        threadId: ThreadIdParam,
        messageId: MessageIdParam,
        subject: z.string(),
        to: z
          .null()
          .describe('Always null - use readEmail to get actual recipient'),
        date: z.number(),
        snippet: z.string(),
      }),
    ),
    totalCount: z.number(),
  }),
};

export const createDraftSchema = {
  name: 'createDraft',
  description:
    'Create a new draft email with optional attachments, CC, and BCC',
  notes:
    'When `threadId` is set (reply draft), CC/BCC are NOT auto-inherited from the prior thread — you must decide reply vs reply-all yourself. Call `readEmail(threadId)` first to see the original `to`/`cc`, then pass the desired `cc` list explicitly (reply-all = original `cc` plus original `to` minus yourself). When the thread had CCs and you are intentionally dropping them (private reply), surface that to the user. Skill hint: use the "sales-copy" skill for composing effective draft emails.',
  input: z.object({
    xsrf: XsrfParam,
    account: AccountParam,
    globals: GmailGlobalsSchema,
    to: RecipientsSchema.describe(
      'Recipient email(s) - single email or array of emails',
    ),
    subject: z.string().describe('Email subject'),
    body: z.string().describe('Draft body (plain text)'),
    cc: CcBccRecipientsSchema.describe(
      'CC recipients (array of email addresses). On a reply draft (threadId set), NOT auto-inherited — pass the prior thread CC explicitly to do reply-all; leave unset for a private reply.',
    ),
    bcc: CcBccRecipientsSchema.describe(
      'BCC recipients (array of email addresses)',
    ),
    attachments: z
      .array(AttachmentInputSchema)
      .optional()
      .nullable()
      .describe(
        'Files to attach. Each item is either {fileName, mimeType, base64Data} for inline upload, or {fileName, mimeType, blobRef, attachmentId, size} from uploadAttachment',
      ),
    threadId: ThreadIdParam.optional().describe('Thread ID for reply draft'),
  }),
  output: z.object({
    success: z.boolean(),
    mode: z.enum(['new', 'reply']).describe('Draft type'),
    from: z.string(),
    to: z.array(z.string()).describe('Recipient email(s)'),
    cc: z.array(z.string()).nullable().describe('CC recipients'),
    bcc: z.array(z.string()).nullable().describe('BCC recipients'),
    subject: z.string(),
    threadId: ThreadIdParam,
    draftId: MessageIdParam,
    inReplyTo: MessageIdParam.nullable(),
    attachments: z
      .array(AttachmentResultSchema)
      .nullable()
      .describe('Uploaded attachments'),
  }),
};

export const sendDraftSchema = {
  name: 'sendDraft',
  description: 'Send an existing draft',
  notes: '',
  input: z.object({
    xsrf: XsrfParam,
    account: AccountParam,
    globals: GmailGlobalsSchema,
    threadId: ThreadIdParam,
    draftId: MessageIdParam.describe('Draft message ID to send'),
  }),
  output: z.object({
    success: z.boolean(),
    threadId: ThreadIdParam,
    messageId: MessageIdParam,
  }),
};

export const editDraftSchema = {
  name: 'editDraft',
  description: 'Edit an existing draft email',
  notes:
    'Only provided fields are updated; omitted fields keep current values. Attachments replace all existing ones when provided; re-upload any you want to keep.',
  input: z.object({
    xsrf: XsrfParam,
    account: AccountParam,
    globals: GmailGlobalsSchema,
    draftId: MessageIdParam.describe(
      'Draft message ID to edit (e.g., "msg-a:r123")',
    ),
    threadId: ThreadIdParam.optional().describe(
      'Thread ID (auto-detected if omitted)',
    ),
    to: RecipientsSchema.optional().describe(
      'New recipient email(s) - single email or array (keeps current if omitted)',
    ),
    subject: z
      .string()
      .optional()
      .describe('New subject line (keeps current if omitted)'),
    body: z
      .string()
      .optional()
      .describe('New body text (keeps current if omitted)'),
    cc: CcBccRecipientsSchema.describe(
      'CC recipients (array of email addresses, replaces existing)',
    ),
    bcc: CcBccRecipientsSchema.describe(
      'BCC recipients (array of email addresses, replaces existing)',
    ),
    attachments: z
      .array(AttachmentInputSchema)
      .optional()
      .nullable()
      .describe(
        'New attachments (replaces all existing attachments). Re-upload any existing attachments you want to keep.',
      ),
  }),
  output: z.object({
    success: z.boolean(),
    draftId: MessageIdParam,
    threadId: ThreadIdParam,
    to: z.array(z.string()).nullable().describe('Updated recipient(s)'),
    cc: z.array(z.string()).nullable().describe('CC recipients'),
    bcc: z.array(z.string()).nullable().describe('BCC recipients'),
    subject: z.string().describe('Updated subject'),
    attachments: z
      .array(AttachmentResultSchema)
      .nullable()
      .describe('Uploaded attachments'),
  }),
};

export const forwardEmailSchema = {
  name: 'forwardEmail',
  description:
    'Forward an email to another recipient with optional attachments, CC, and BCC',
  notes:
    '**Output format**: If presenting a draft to the user before sending, you MUST use the "message-draft" skill (useSkill("message-draft")) to render it as an editable UI card for approval. Use the "sales-copy" skill for composing the forwarding message.',
  input: z.object({
    xsrf: XsrfParam,
    account: AccountParam,
    globals: GmailGlobalsSchema,
    threadId: ThreadIdParam,
    originalMsgId: MessageIdParam.describe('Message ID to forward'),
    to: RecipientsSchema.describe(
      'Recipient email(s) - single email or array of emails',
    ),
    cc: CcBccRecipientsSchema.describe(
      'CC recipients (array of email addresses)',
    ),
    bcc: CcBccRecipientsSchema.describe(
      'BCC recipients (array of email addresses)',
    ),
    message: z
      .string()
      .optional()
      .describe('Personal message to include at top'),
    attachments: z
      .array(AttachmentInputSchema)
      .optional()
      .nullable()
      .describe(
        'Additional files to attach. Each item is either {fileName, mimeType, base64Data} for inline upload, or {fileName, mimeType, blobRef, attachmentId, size} from uploadAttachment',
      ),
    inThread: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        'If true, forward appears in same thread (default). If false, creates new thread.',
      ),
    wholeThread: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        'If true, forward all messages in thread (default). If false, forward single message.',
      ),
  }),
  output: z.object({
    success: z.boolean(),
    from: z.string().describe('Sender email'),
    to: z.array(z.string()).describe('Recipient email(s)'),
    cc: z.array(z.string()).nullable().describe('CC recipients'),
    bcc: z.array(z.string()).nullable().describe('BCC recipients'),
    subject: z.string().describe('Forward subject (prefixed with "Fwd: ")'),
    originalSubject: z.string().describe('Original email subject'),
    threadId: ThreadIdParam.describe('Thread ID of the forward'),
    originalMsgId: MessageIdParam.describe(
      'Original message that was forwarded',
    ),
    newMessageId: MessageIdParam.describe('New forward message ID'),
    inThread: z.boolean().describe('Whether forward is in same thread'),
    wholeThread: z.boolean().describe('Whether whole thread was forwarded'),
    messageCount: z.number().describe('Number of messages forwarded'),
    attachments: z
      .array(AttachmentResultSchema)
      .nullable()
      .describe('Uploaded attachments'),
  }),
};

export const AttachmentSchema = z.object({
  messageId: MessageIdParam.describe('Message ID containing the attachment'),
  filename: z.string().describe('Attachment filename'),
  mimeType: z.string().describe('MIME type (e.g., "application/pdf")'),
  size: z.number().describe('File size in bytes'),
  url: z.string().describe('Download URL (requires Gmail session)'),
});

export const listAttachmentsSchema = {
  name: 'listAttachments',
  description: 'List attachments from an email thread',
  notes:
    'Download URLs require an active Gmail session; pass them to files.download({ url, filename }) to save.',
  input: z.object({
    xsrf: XsrfParam,
    account: AccountParam,
    globals: GmailGlobalsSchema,
    threadId: ThreadIdParam,
  }),
  output: z.object({
    threadId: ThreadIdParam,
    attachments: z.array(AttachmentSchema),
  }),
};

export const UploadResultSchema = z.object({
  blobRef: z.string().describe('Blob reference for email payload'),
  attachmentId: z.string().describe('Attachment ID (f_xxx format)'),
  fileName: z.string().describe('Uploaded filename'),
  mimeType: z.string().describe('MIME type'),
  size: z.number().describe('File size in bytes'),
});

export const uploadAttachmentSchema = {
  name: 'uploadAttachment',
  description: 'Upload a file to Gmail for attachment',
  notes:
    'Pre-uploads a file and returns blobRef + attachmentId. Pass the result directly as an attachment to sendEmail, replyEmail, forwardEmail, createDraft, or editDraft. To attach a file from the user\'s device, use the files library: call files.load({ fileRef: "/absolute/path" }) to get the file content as an ArrayBuffer, convert to base64, then pass to this function. Browser executors cannot access sandbox paths like /tmp/ — use real device paths (~/Downloads/) or pass base64 data directly.',
  input: z.object({
    account: AccountParam,
    messageId: z
      .string()
      .describe("Message ID to link attachment to, or 'new' for a new message"),
    fileName: z.string().describe('Filename with extension'),
    mimeType: z.string().describe('MIME type (e.g., "application/pdf")'),
    base64Data: z.string().describe('File content as base64-encoded string'),
  }),
  output: UploadResultSchema,
};

// ============================================================================
// Contact Schemas
// ============================================================================

export const ResolveContactByEmailOutputSchema = z.object({
  email: z.string().describe('The queried email address, echoed back'),
  name: z.string().nullable().describe('Display name if the contact is known; null for cold/unknown emails'),
  givenName: z.string().nullable().describe('First name if available; null otherwise'),
  avatarUrl: z.string().nullable().describe('Profile photo URL if available; null otherwise'),
  found: z.boolean().describe('True only when a display name was resolved'),
});

export const resolveContactByEmailSchema = {
  name: 'resolveContactByEmail',
  description: 'Resolve a contact display name by email address (best-effort, known contacts only)',
  notes:
    "Best-effort name lookup via Gmail's \"To:\" autocomplete index (PeopleStack). Resolves names ONLY for the user's known people — Google Contacts, prior correspondents, and Workspace-directory colleagues. Cold/unknown emails return { found:false, name:null }. Requires being on mail.google.com. Computes the SAPISIDHASH auth header from document.cookie internally.",
  input: z.object({
    account: AccountParam,
    email: z.string().describe('The email address to resolve a name for'),
  }),
  output: ResolveContactByEmailOutputSchema,
};

export type ResolveContactByEmailOutput = z.infer<typeof resolveContactByEmailSchema.output>;

// ============================================================================
// All Schemas Export
// ============================================================================

export const allSchemas = [
  getContextSchema,
  listAccountsSchema,
  listInboxSchema,
  searchEmailsSchema,
  readEmailSchema,
  sendEmailSchema,
  replyEmailSchema,
  deleteEmailSchema,
  listDraftsSchema,
  createDraftSchema,
  sendDraftSchema,
  editDraftSchema,
  forwardEmailSchema,
  listAttachmentsSchema,
  uploadAttachmentSchema,
  resolveContactByEmailSchema,
];

// ============================================================================
// Inferred Types
// ============================================================================

// Shared types
export type EmailAddress = z.infer<typeof EmailAddressSchema>;
export type MessageSummary = z.infer<typeof MessageSummarySchema>;
export type MessageContent = z.infer<typeof MessageContentSchema>;
export type Account = z.infer<typeof AccountSchema>;
export type GmailGlobals = z.infer<typeof GmailGlobalsSchema>;
export type GmailContext = z.infer<typeof GmailContextSchema>;

// Input types
export type GetContextInput = z.infer<typeof getContextSchema.input>;
export type ListAccountsInput = z.infer<typeof listAccountsSchema.input>;
export type ListInboxInput = z.infer<typeof listInboxSchema.input>;
export type SearchEmailsInput = z.infer<typeof searchEmailsSchema.input>;
export type ReadEmailInput = z.infer<typeof readEmailSchema.input>;
export type SendEmailInput = z.infer<typeof sendEmailSchema.input>;
export type ReplyEmailInput = z.infer<typeof replyEmailSchema.input>;
export type DeleteEmailInput = z.infer<typeof deleteEmailSchema.input>;
export type ListDraftsInput = z.infer<typeof listDraftsSchema.input>;
export type CreateDraftInput = z.infer<typeof createDraftSchema.input>;
export type SendDraftInput = z.infer<typeof sendDraftSchema.input>;

// Output types
export type GetContextOutput = z.infer<typeof getContextSchema.output>;
export type ListAccountsOutput = z.infer<typeof listAccountsSchema.output>;
export type ListInboxOutput = z.infer<typeof listInboxSchema.output>;
export type SearchEmailsOutput = z.infer<typeof searchEmailsSchema.output>;
export type ReadEmailOutput = z.infer<typeof readEmailSchema.output>;
export type SendEmailOutput = z.infer<typeof sendEmailSchema.output>;
export type ReplyEmailOutput = z.infer<typeof replyEmailSchema.output>;
export type DeleteEmailOutput = z.infer<typeof deleteEmailSchema.output>;
export type ListDraftsOutput = z.infer<typeof listDraftsSchema.output>;
export type CreateDraftOutput = z.infer<typeof createDraftSchema.output>;
export type SendDraftOutput = z.infer<typeof sendDraftSchema.output>;
export type EditDraftOutput = z.infer<typeof editDraftSchema.output>;
export type ForwardEmailOutput = z.infer<typeof forwardEmailSchema.output>;
export type ListAttachmentsOutput = z.infer<
  typeof listAttachmentsSchema.output
>;
export type UploadAttachmentOutput = z.infer<
  typeof uploadAttachmentSchema.output
>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type AttachmentInput = z.infer<typeof AttachmentInputSchema>;
export type AttachmentResult = z.infer<typeof AttachmentResultSchema>;
export type UploadResult = z.infer<typeof UploadResultSchema>;
