/**
 * Gmail Library
 *
 * Browser-executable Gmail operations via internal APIs (JSPB protocol).
 * Requires user to be logged into Gmail at mail.google.com.
 */

// Types from schemas
export type {
  EmailAddress,
  MessageSummary,
  MessageContent,
  Account,
  GmailGlobals,
  GmailContext,
  GetContextOutput,
  ListAccountsOutput,
  ListInboxOutput,
  SearchEmailsOutput,
  ReadEmailOutput,
  SendEmailOutput,
  ReplyEmailOutput,
  DeleteEmailOutput,
  ListDraftsOutput,
  CreateDraftOutput,
  SendDraftOutput,
  EditDraftOutput,
  ForwardEmailOutput,
  ListAttachmentsOutput,
  UploadAttachmentOutput,
  Attachment,
  AttachmentInput,
  AttachmentResult,
  UploadResult,
  ResolveContactByEmailOutput,
} from './schemas';

// Context operations
export { getContext, listAccounts } from './context';

// Message operations
export {
  listInbox,
  searchEmails,
  readEmail,
  sendEmail,
  replyEmail,
  forwardEmail,
  deleteEmail,
} from './messages';

// Draft operations
export { listDrafts, createDraft, sendDraft, editDraft } from './drafts';

// Attachment operations
export { listAttachments, uploadAttachment } from './attachments';

// Contact operations
export { resolveContactByEmail } from './contacts';
