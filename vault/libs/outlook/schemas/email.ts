import { z } from 'zod';
import {
  AuthParam,
  EmailSummarySchema,
  EmailContentSchema,
  AttachmentMetadataSchema,
} from './shared';

// ============================================================================
// listEmails
// ============================================================================

export const listEmailsSchema = {
  name: 'listEmails',
  description: 'List email messages from a folder (Inbox by default)',
  notes: '',
  input: z.object({
    auth: AuthParam,
    folderId: z
      .string()
      .optional()
      .default('inbox')
      .describe(
        'Folder to list emails from. Use "inbox", "drafts", "sentitems", "deleteditems", "junkemail", or a folder ID from listFolders.',
      ),
    offset: z
      .number()
      .optional()
      .default(0)
      .describe('Pagination offset (0-indexed)'),
    maxCount: z
      .number()
      .optional()
      .default(50)
      .describe('Maximum number of emails to return (max 200)'),
    unreadOnly: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'If true, only return unread emails. Shorthand for viewFilter="Unread". Ignored if viewFilter is set.',
      ),
    viewFilter: z
      .enum([
        'All',
        'Unread',
        'Flagged',
        'HasAttachment',
        'ToOrCcMe',
        'HasCalendarInvite',
        'Mentioned',
        'Pinned',
      ])
      .optional()
      .describe(
        'Filter emails by category. Overrides unreadOnly when set. "ToOrCcMe" = addressed to you, "HasCalendarInvite" = meeting invites, "Mentioned" = @mentions you.',
      ),
    sortField: z
      .enum([
        'DateTimeReceived',
        'DateTimeSent',
        'DateTimeCreated',
        'From',
        'Subject',
        'Size',
        'Importance',
        'Categories',
        'HasAttachments',
        'ItemClass',
        'ReceivedOrRenewTime',
      ])
      .optional()
      .describe(
        'Field to sort by. Default is DateTimeReceived (arrival date). ReceivedOrRenewTime is what Outlook uses for "Date" sort; it accounts for pinned/renewed items. ItemClass sorts by message type.',
      ),
    sortOrder: z
      .enum(['Ascending', 'Descending'])
      .optional()
      .describe('Sort direction. Default is Descending (newest first).'),
    focusedViewFilter: z
      .enum(['All', 'Focused', 'Other'])
      .optional()
      .describe(
        'Focused Inbox filter. "Focused" = important emails, "Other" = less important. Only applies to Inbox folder. Default is "All" (no filtering).',
      ),
    searchQuery: z
      .string()
      .optional()
      .describe(
        'Search keyword to filter emails within the folder. Performs a case-insensitive substring match across subject, body, and sender fields (OR logic). Example: "meeting" returns emails where "meeting" appears in the subject, body text, or sender name/address. Note: when searchQuery is set, viewFilter, unreadOnly, and focusedViewFilter are ignored (OWA limitation; filters and search cannot be combined). Use searchMail for full-text search with more options.',
      ),
  }),
  output: z.object({
    emails: z.array(EmailSummarySchema),
    totalCount: z
      .number()
      .describe(
        'Total number of emails in the folder matching the filter. Note: when offset exceeds the actual email count, OWA echoes back the offset value instead of the real total; use moreAvailable to detect the end of results, not totalCount.',
      ),
    moreAvailable: z
      .boolean()
      .describe('Whether more emails exist beyond this page'),
  }),
};

// ============================================================================
// getEmail
// ============================================================================

export const getEmailSchema = {
  name: 'getEmail',
  description: 'Get full content of a single email by its item ID',
  notes: '',
  input: z.object({
    auth: AuthParam,
    itemId: z.string().describe('Immutable item ID from listEmails'),
    bodyType: z
      .enum(['HTML', 'Text', 'Best'])
      .optional()
      .describe(
        'Body content format. HTML returns rich HTML, Text returns plain text, Best returns HTML if available else Text. Default is HTML.',
      ),
    filterHtmlContent: z
      .boolean()
      .optional()
      .describe(
        'When true, strips potentially unsafe HTML content (scripts, forms, applets) from the body. Only applies when bodyType is HTML or Best.',
      ),
    addBlankTargetToLinks: z
      .boolean()
      .optional()
      .describe(
        'When true, adds target="_blank" to all links in the HTML body. Useful for safe link rendering.',
      ),
    blockExternalImages: z
      .boolean()
      .optional()
      .describe(
        'When true, blocks external image URLs in the HTML body. Useful for privacy or preventing tracking pixels.',
      ),
    includeMimeContent: z
      .boolean()
      .optional()
      .describe(
        'When true, includes the raw MIME content (base64-encoded) in the response. Useful for email forwarding or archival.',
      ),
    maximumBodySize: z
      .number()
      .optional()
      .describe(
        'Maximum body size in bytes. When set, the body is truncated to this size and isTruncated is set to true in the response. Useful for previews.',
      ),
    inlineImageUrlTemplate: z
      .string()
      .optional()
      .describe(
        'URL template for inline images. Use {ContentId} as placeholder for the image content ID. When set, inline image src attributes are rewritten to use this template.',
      ),
  }),
  output: EmailContentSchema.extend({
    mimeContent: z
      .object({
        characterSet: z.string().describe('Character set of the MIME content'),
        value: z.string().describe('Base64-encoded MIME content'),
      })
      .optional()
      .describe(
        'Raw MIME content, only present when includeMimeContent is true',
      ),
    isTruncated: z
      .boolean()
      .describe(
        'Whether the body was truncated due to maximumBodySize. Always present; false when body is not truncated.',
      ),
    attachments: z
      .array(AttachmentMetadataSchema)
      .describe(
        'Attachment metadata. Use getAttachment() with the attachmentId to download content. Empty array when hasAttachments is false.',
      ),
  }),
};

// ============================================================================
// sendEmail
// ============================================================================

export const sendEmailSchema = {
  name: 'sendEmail',
  description: 'Compose and send a new email',
  notes:
    '**Output format**: If presenting a draft to the user before sending, you MUST use the "message-draft" skill (useSkill("message-draft")) to render it as an editable UI card for approval. CC and BCC recipients live on the message-draft artifact (`data.cc`, `data.bcc`); set them there rather than only in the `sendEmail` call.',
  input: z.object({
    auth: AuthParam,
    to: z
      .array(z.string().email())
      .min(1)
      .describe('Recipient email addresses'),
    cc: z
      .array(z.string().email())
      .optional()
      .describe('CC recipient email addresses'),
    bcc: z
      .array(z.string().email())
      .optional()
      .describe('BCC recipient email addresses'),
    subject: z.string().describe('Email subject line'),
    body: z.string().describe('Email body as HTML or plain text'),
    bodyType: z
      .enum(['HTML', 'Text'])
      .optional()
      .describe(
        'Format of body content. Default is HTML. Use "Text" for plain text.',
      ),
    importance: z
      .enum(['Normal', 'High', 'Low'])
      .optional()
      .describe('Message importance/priority level. Default is Normal.'),
    sensitivity: z
      .enum(['Normal', 'Personal', 'Private', 'Confidential'])
      .optional()
      .describe(
        'Message sensitivity classification. Private and Confidential prevent recipients from forwarding, replying-all, or modifying contents in some clients.',
      ),
    isReadReceiptRequested: z
      .boolean()
      .optional()
      .describe(
        'Request a read receipt from recipients when they open the email',
      ),
    isDeliveryReceiptRequested: z
      .boolean()
      .optional()
      .describe(
        'Request a delivery receipt confirming the email reached the recipient mailbox',
      ),
    replyTo: z
      .array(z.string().email())
      .optional()
      .describe(
        'Reply-To email addresses. When set, replies go to these addresses instead of the sender.',
      ),
    categories: z
      .array(z.string())
      .optional()
      .describe(
        'Category labels to apply to the sent message (e.g., "Blue category", "Green category"). Categories must match existing categories in the mailbox.',
      ),
    attachments: z
      .array(
        z.object({
          name: z
            .string()
            .describe('Filename with extension (e.g., "report.pdf")'),
          contentType: z
            .string()
            .describe(
              'MIME type (e.g., "application/pdf", "image/png", "text/plain")',
            ),
          content: z.string().describe('Base64-encoded file content'),
          isInline: z
            .boolean()
            .optional()
            .describe(
              'Whether attachment is inline (embedded in HTML body via cid: reference). Default false.',
            ),
        }),
      )
      .optional()
      .describe(
        'File attachments to include with the email. Each attachment must have base64-encoded content. For inline images, set isInline to true and reference in the HTML body with cid:{name}.',
      ),
    saveAsDraft: z
      .boolean()
      .optional()
      .describe(
        'If true, save the email as a draft instead of sending immediately. Returns the draft item ID.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the email was sent successfully'),
    itemId: z
      .string()
      .describe(
        'Item ID of the draft when saveAsDraft is true. Empty string when sent immediately (OWA does not return the sent item ID).',
      ),
  }),
};

// ============================================================================
// replyToEmail
// ============================================================================

export const replyToEmailSchema = {
  name: 'replyToEmail',
  description: 'Reply to an existing email',
  notes:
    '**Output format**: If presenting a draft to the user before sending, you MUST use the "message-draft" skill (useSkill("message-draft")) to render it as an editable UI card for approval. CC and BCC recipients live on the message-draft artifact (`data.cc`, `data.bcc`); set them there rather than only in the `replyToEmail` call.',
  input: z.object({
    auth: AuthParam,
    itemId: z.string().describe('Item ID of the email to reply to'),
    body: z.string().describe('Reply body text (HTML supported)'),
    replyAll: z
      .boolean()
      .optional()
      .default(false)
      .describe('If true, reply to all recipients'),
    cc: z
      .array(z.string().email())
      .optional()
      .describe('CC recipient email addresses to add to the reply'),
    bcc: z
      .array(z.string().email())
      .optional()
      .describe('BCC recipient email addresses to add to the reply'),
    subject: z
      .string()
      .optional()
      .describe(
        'Override the default "Re: ..." subject line with a custom subject',
      ),
    importance: z
      .enum(['Normal', 'High', 'Low'])
      .optional()
      .describe('Message importance level. Default is Normal.'),
    sensitivity: z
      .enum(['Normal', 'Personal', 'Private', 'Confidential'])
      .optional()
      .describe(
        'Message sensitivity level. Private prevents recipients from forwarding. Confidential restricts distribution.',
      ),
    bodyType: z
      .enum(['HTML', 'Text'])
      .optional()
      .describe(
        'Format of reply body content. Default is HTML. Use "Text" for plain text.',
      ),
    isReadReceiptRequested: z
      .boolean()
      .optional()
      .describe(
        'Request a read receipt from recipients when they open the reply',
      ),
    isDeliveryReceiptRequested: z
      .boolean()
      .optional()
      .describe(
        'Request a delivery receipt confirming the reply reached the recipient mailbox',
      ),
    to: z
      .array(z.string().email())
      .optional()
      .describe(
        'Override the default reply recipient(s). By default the reply goes to the original sender (or all original recipients for replyAll). Use this to redirect the reply to different addresses.',
      ),
    categories: z
      .array(z.string())
      .optional()
      .describe(
        'Category labels to apply to the reply message (e.g., "Blue category", "Green category"). Categories must match existing categories in the mailbox.',
      ),
    replyTo: z
      .array(z.string().email())
      .optional()
      .describe(
        'Reply-To email addresses to set on the reply. When set, recipients who reply to your reply will send to these addresses instead of your sender address.',
      ),
    saveAsDraft: z
      .boolean()
      .optional()
      .describe(
        'If true, save the reply as a draft instead of sending immediately. Returns the draft item ID.',
      ),
    from: z
      .string()
      .email()
      .optional()
      .describe(
        'Send-as / delegate email address. Sets the From header to a different address than the authenticated user. The authenticated user must have SendAs or SendOnBehalf permission on the target mailbox. On consumer accounts (outlook.com), this is typically not available.',
      ),
    inReplyTo: z
      .string()
      .optional()
      .describe(
        'Override the In-Reply-To message ID header. By default, EWS sets this from the original message. Use this to manually control threading by referencing a specific Message-ID (e.g., "<unique-id@domain.com>").',
      ),
    disallowReactions: z
      .boolean()
      .optional()
      .describe(
        'When true, prevents recipients from adding emoji reactions to this reply. Sets the x-ms-reactions SMTP header via an EWS Extended Property. Recipients will see the reactions UI grayed out. Only effective on Microsoft 365 / Exchange Online recipients.',
      ),
    deferredSendTime: z
      .string()
      .optional()
      .describe(
        'Schedule the reply for future delivery. ISO 8601 datetime string (e.g., "2026-02-21T09:00:00Z"). Sets PidTagDeferredSendTime (0x3FEF) extended property. The message is saved in Drafts and sent automatically at the specified time by the server. Must be in the future. Uses the same mechanism as Outlook\'s "Schedule send" feature.',
      ),
    flagStatus: z
      .enum(['Flagged', 'Complete', 'NotFlagged'])
      .optional()
      .describe(
        'Flag the reply for follow-up. "Flagged" adds a flag, "Complete" marks as completed, "NotFlagged" removes the flag. When set, flagStartDate and flagDueDate can optionally specify the follow-up date range.',
      ),
    flagStartDate: z
      .string()
      .optional()
      .describe(
        'Start date for the follow-up flag. ISO 8601 date string (e.g., "2026-02-21T08:00:00Z"). Only used when flagStatus is "Flagged".',
      ),
    flagDueDate: z
      .string()
      .optional()
      .describe(
        'Due date for the follow-up flag. ISO 8601 date string (e.g., "2026-02-22T08:00:00Z"). Only used when flagStatus is "Flagged".',
      ),
    reminderIsSet: z
      .boolean()
      .optional()
      .describe(
        'When true, sets a reminder on the reply message. Use with reminderDueBy to specify when the reminder fires. Works independently of flagStatus.',
      ),
    reminderDueBy: z
      .string()
      .optional()
      .describe(
        'When the reminder should fire. ISO 8601 datetime string (e.g., "2026-02-22T09:00:00Z"). Only effective when reminderIsSet is true.',
      ),
    internetMessageId: z
      .string()
      .optional()
      .describe(
        'Set a custom Internet Message-ID header on the reply (e.g., "<custom-id@domain.com>"). By default the server generates this. Useful for systems that need deterministic message IDs for deduplication or tracking.',
      ),
    savedItemFolderId: z
      .string()
      .optional()
      .describe(
        'Folder ID where the sent copy is saved. By default, sent replies go to "sentitems". Use a well-known name ("inbox", "drafts", "sentitems", "deleteditems") or a folder ID from listFolders. Only applies when sending (not when saveAsDraft is true).',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether the reply was sent successfully'),
    itemId: z
      .string()
      .describe(
        'Item ID of the draft when saveAsDraft is true. Empty string when sent immediately (OWA does not return the sent item ID).',
      ),
  }),
};

// ============================================================================
// forwardEmail
// ============================================================================

export const forwardEmailSchema = {
  name: 'forwardEmail',
  description: 'Forward an existing email to new recipients',
  notes:
    '**Output format**: If presenting a draft to the user before sending, you MUST use the "message-draft" skill (useSkill("message-draft")) to render it as an editable UI card for approval. CC and BCC recipients live on the message-draft artifact (`data.cc`, `data.bcc`); set them there rather than only in the `forwardEmail` call.',
  input: z.object({
    auth: AuthParam,
    itemId: z.string().describe('Item ID of the email to forward'),
    to: z
      .array(z.string().email())
      .min(1)
      .describe('Recipient email addresses to forward to'),
    cc: z
      .array(z.string().email())
      .optional()
      .describe('CC recipient email addresses'),
    bcc: z
      .array(z.string().email())
      .optional()
      .describe('BCC recipient email addresses'),
    additionalBody: z
      .string()
      .optional()
      .describe(
        'Optional additional message text to include above the forwarded email (HTML supported)',
      ),
    subject: z
      .string()
      .optional()
      .describe(
        'Override the default "Fw: ..." subject line with a custom subject',
      ),
    importance: z
      .enum(['Normal', 'High', 'Low'])
      .optional()
      .describe('Message importance level. Default is Normal.'),
    bodyType: z
      .enum(['HTML', 'Text'])
      .optional()
      .describe(
        'Format of additionalBody content. Default is HTML. Use "Text" for plain text.',
      ),
    isReadReceiptRequested: z
      .boolean()
      .optional()
      .describe(
        'Request a read receipt from recipients when they open the email',
      ),
    isDeliveryReceiptRequested: z
      .boolean()
      .optional()
      .describe(
        'Request a delivery receipt confirming the email reached the recipient mailbox',
      ),
    saveAsDraft: z
      .boolean()
      .optional()
      .describe(
        'If true, save the forward as a draft instead of sending immediately. Returns the draft item ID.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether the email was forwarded successfully'),
    itemId: z
      .string()
      .describe(
        'Item ID of the draft when saveAsDraft is true. Empty string when sent immediately (OWA does not return the sent item ID).',
      ),
  }),
};

// ============================================================================
// moveEmail
// ============================================================================

export const moveEmailSchema = {
  name: 'moveEmail',
  description: 'Move one or more emails to a different folder',
  notes: '',
  input: z.object({
    auth: AuthParam,
    itemIds: z.array(z.string()).min(1).describe('Item IDs of emails to move'),
    destinationFolderId: z
      .string()
      .describe(
        'Destination folder ID or well-known name: inbox, drafts, sentitems, deleteditems, junkemail, archive. Use a raw folder ID from listFolders for custom folders.',
      ),
    returnNewItemIds: z
      .boolean()
      .optional()
      .describe(
        'When true, the response includes the new item IDs after the move (items get new IDs when moved). Default is true for same-mailbox moves. Cross-mailbox moves never return new IDs regardless of this flag.',
      ),
  }),
  output: z.object({
    success: z.boolean().describe('Whether all emails were moved successfully'),
    movedItemIds: z
      .array(z.string())
      .describe('Item IDs of the moved messages in the destination folder'),
  }),
};

// ============================================================================
// deleteEmail
// ============================================================================

export const deleteEmailSchema = {
  name: 'deleteEmail',
  description: 'Delete one or more emails',
  notes:
    'Default delete type is MoveToDeletedItems (recoverable). Use HardDelete for permanent deletion; cannot be undone.',
  input: z.object({
    auth: AuthParam,
    itemIds: z
      .array(z.string())
      .min(1)
      .describe('Item IDs of emails to delete'),
    deleteType: z
      .enum(['MoveToDeletedItems', 'SoftDelete', 'HardDelete'])
      .optional()
      .default('MoveToDeletedItems')
      .describe(
        'Delete behavior: MoveToDeletedItems (move to trash, default and safest), SoftDelete (bypass trash, recoverable from dumpster), HardDelete (permanent, unrecoverable)',
      ),
    suppressReadReceipts: z
      .boolean()
      .optional()
      .describe(
        'When true, suppresses read receipts for the deleted items. If the deleted email had requested a read receipt, it will not be sent. Default is false (read receipts are sent to the sender).',
      ),
    sendMeetingCancellations: z
      .enum(['SendToNone', 'SendOnlyToAll', 'SendToAllAndSaveCopy'])
      .optional()
      .describe(
        'Controls whether cancellation notices are sent when deleting calendar items. SendToNone = delete silently, SendOnlyToAll = notify all attendees, SendToAllAndSaveCopy = notify and save a copy in Sent Items. Only applies to calendar items; ignored for regular emails.',
      ),
    affectedTaskOccurrences: z
      .enum(['AllOccurrences', 'SpecifiedOccurrenceOnly'])
      .optional()
      .describe(
        'Controls whether deleting a task removes the master task and all recurrences (AllOccurrences) or only the specified occurrence (SpecifiedOccurrenceOnly). Only applies to task items; ignored for regular emails.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether all emails were deleted successfully'),
  }),
};

// ============================================================================
// markEmailRead
// ============================================================================

export const markEmailReadSchema = {
  name: 'markEmailRead',
  description: 'Mark one or more emails as read or unread',
  notes: '',
  input: z.object({
    auth: AuthParam,
    itemIds: z.array(z.string()).min(1).describe('Item IDs of emails to mark'),
    isRead: z
      .boolean()
      .describe('True to mark as read, false to mark as unread'),
    suppressReadReceipts: z
      .boolean()
      .optional()
      .describe(
        'When true, suppresses read receipt notifications to the sender when marking emails as read. Useful when the sender requested a read receipt but you do not want to send one. Default is false (read receipts are sent normally).',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether all emails were updated successfully'),
  }),
};

// ============================================================================
// flagEmail
// ============================================================================

export const flagEmailSchema = {
  name: 'flagEmail',
  description: 'Flag or unflag one or more emails',
  notes:
    'StartDate/DueDate are used with Flagged status to set follow-up date ranges (e.g., "Today", "This week", "Next week"). CompleteDate is used with Complete status. Do not combine CompleteDate with StartDate/DueDate; the API rejects that combination.',
  input: z.object({
    auth: AuthParam,
    itemIds: z
      .array(z.string())
      .min(1)
      .describe('Item IDs of emails to flag/unflag'),
    flagStatus: z
      .enum(['Flagged', 'Complete', 'NotFlagged'])
      .describe(
        'Flag status: Flagged (add flag), Complete (mark flag done), NotFlagged (remove flag)',
      ),
    startDate: z
      .string()
      .optional()
      .describe(
        'Start date for the flag follow-up task as an ISO 8601 datetime string (e.g., "2026-02-20T00:00:00-08:00"). Used with Flagged status. Typically set to the beginning of the follow-up period.',
      ),
    dueDate: z
      .string()
      .optional()
      .describe(
        'Due date for the flag follow-up task as an ISO 8601 datetime string (e.g., "2026-02-21T00:00:00-08:00"). Used with Flagged status. For "Today" both startDate and dueDate are the same day; for "This week" dueDate is end of the week.',
      ),
    completeDate: z
      .string()
      .optional()
      .describe(
        'Completion date as an ISO 8601 datetime string. Used with Complete status to record when the flag was completed. Do not combine with startDate/dueDate.',
      ),
  }),
  output: z.object({
    success: z
      .boolean()
      .describe('Whether all emails were updated successfully'),
  }),
};

// ============================================================================
// getConversation
// ============================================================================

export const getConversationSchema = {
  name: 'getConversation',
  description: 'Get all messages in a conversation thread by conversation ID',
  notes:
    'Use the conversationId from listEmails or getEmail to fetch the full thread. Returns messages sorted by date ascending (oldest first).',
  input: z.object({
    auth: AuthParam,
    conversationId: z
      .string()
      .describe(
        'Conversation thread ID from listEmails or getEmail (the conversationId field).',
      ),
    maxItems: z
      .number()
      .optional()
      .default(100)
      .describe(
        'Maximum number of messages to return per conversation (max 200).',
      ),
  }),
  output: z.object({
    conversationId: z.string().describe('The conversation ID that was queried'),
    messages: z
      .array(EmailSummarySchema)
      .describe('All messages in the conversation, sorted by date ascending'),
  }),
};

// ============================================================================
// getAttachment
// ============================================================================

export const getAttachmentSchema = {
  name: 'getAttachment',
  description:
    'Download the content of an email attachment by its attachment ID',
  notes:
    'Use the attachmentId from getEmail().attachments. Returns the full file content as base64.',
  input: z.object({
    auth: AuthParam,
    attachmentId: z
      .string()
      .describe('Attachment ID from getEmail().attachments[].attachmentId'),
  }),
  output: z.object({
    name: z.string().describe('Filename (e.g., "report.pdf")'),
    contentType: z.string().describe('MIME type (e.g., "application/pdf")'),
    content: z.string().describe('Base64-encoded file content'),
    size: z.number().describe('Content size in bytes'),
  }),
};

// ============================================================================
// Inferred Types
// ============================================================================

export type ListEmailsInput = z.infer<typeof listEmailsSchema.input>;
export type ListEmailsOutput = z.infer<typeof listEmailsSchema.output>;
export type GetEmailInput = z.infer<typeof getEmailSchema.input>;
export type GetEmailOutput = z.infer<typeof getEmailSchema.output>;
export type SendEmailInput = z.infer<typeof sendEmailSchema.input>;
export type SendEmailOutput = z.infer<typeof sendEmailSchema.output>;
export type ReplyToEmailInput = z.infer<typeof replyToEmailSchema.input>;
export type ReplyToEmailOutput = z.infer<typeof replyToEmailSchema.output>;
export type ForwardEmailInput = z.infer<typeof forwardEmailSchema.input>;
export type ForwardEmailOutput = z.infer<typeof forwardEmailSchema.output>;
export type MoveEmailInput = z.infer<typeof moveEmailSchema.input>;
export type MoveEmailOutput = z.infer<typeof moveEmailSchema.output>;
export type DeleteEmailInput = z.infer<typeof deleteEmailSchema.input>;
export type DeleteEmailOutput = z.infer<typeof deleteEmailSchema.output>;
export type MarkEmailReadInput = z.infer<typeof markEmailReadSchema.input>;
export type MarkEmailReadOutput = z.infer<typeof markEmailReadSchema.output>;
export type FlagEmailInput = z.infer<typeof flagEmailSchema.input>;
export type FlagEmailOutput = z.infer<typeof flagEmailSchema.output>;
export type GetConversationInput = z.infer<typeof getConversationSchema.input>;
export type GetConversationOutput = z.infer<
  typeof getConversationSchema.output
>;
export type GetAttachmentInput = z.infer<typeof getAttachmentSchema.input>;
export type GetAttachmentOutput = z.infer<typeof getAttachmentSchema.output>;
