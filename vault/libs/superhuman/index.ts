/**
 * Superhuman Library
 *
 * Premium email client wrapper around Gmail.
 * IMPORTANT: Prefer the Gmail library for email sending/composing.
 * Only use this library for Superhuman inbox management features.
 *
 * Implementation based on working automation scripts that use Superhuman's
 * internal Account object available in browser context.
 */

export type {
  AccountInfo,
  ArchiveEmailInput,
  ArchiveEmailOutput,
  UnarchiveEmailInput,
  UnarchiveEmailOutput,
  SetReminderInput,
  SetReminderOutput,
  CancelReminderInput,
  CancelReminderOutput,
  ListSplitInboxesOutput,
  MoveThreadInput,
  MoveThreadOutput,
  AskAIInput,
  AskAIOutput,
  CancelScheduledSendInput,
  CancelScheduledSendOutput,
  CreateDraftInput,
  CreateDraftOutput,
  CreateReplyDraftInput,
  CreateReplyDraftOutput,
  DeleteDraftInput,
  DeleteDraftOutput,
  DownloadAttachmentInput,
  DownloadAttachmentOutput,
  Snippet,
  EmailAttachment,
  EmailContact,
  EmailMessage,
  GetContextOutput,
  InboxThread,
  ListAccountsOutput,
  ListAliasesOutput,
  ListSnippetsInput,
  ListSnippetsOutput,
  ListDraftsInput,
  ListDraftsOutput,
  ListInboxFiltersOutput,
  ListInboxInput,
  ListInboxOutput,
  MarkReadInput,
  MarkReadOutput,
  MarkUnreadInput,
  MarkUnreadOutput,
  ReadEmailInput,
  ReadEmailOutput,
  ScheduleReplyInput,
  ScheduleReplyOutput,
  ScheduleSendInput,
  ScheduleSendOutput,
  SearchEmailsInput,
  SearchEmailsOutput,
  SendEmailInput,
  SendEmailOutput,
  SendReplyInput,
  SendReplyOutput,
  StarEmailInput,
  StarEmailOutput,
  SwitchAccountInput,
  SwitchAccountOutput,
  SuperhumanContext,
  UpdateDraftInput,
  UpdateDraftOutput,
  UnstarEmailInput,
  UnstarEmailOutput,
} from './schemas';

// Context operations
export { getContext } from './context';

// Thread operations
export {
  listInboxFilters,
  listSplitInboxes,
  listInbox,
  listDrafts,
  readEmail,
  downloadAttachment,
  archiveEmail,
  unarchiveEmail,
  setReminder,
  cancelReminder,
  moveThread,
  starEmail,
  unstarEmail,
  markRead,
  markUnread,
  searchEmails,
} from './threads';

// Draft operations
export {
  listSnippets,
  createDraft,
  createReplyDraft,
  updateDraft,
  deleteDraft,
} from './drafts';

// Account operations
export { listAccounts, listAliases, switchAccount } from './accounts';

// AI operations
export { askAI } from './ai';

// Send operations
export {
  sendEmail,
  sendReply,
  scheduleSend,
  scheduleReply,
  cancelScheduledSend,
} from './send';
