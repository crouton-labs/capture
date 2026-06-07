/**
 * Superhuman Thread Operations
 *
 * List, read, archive, star, and mark read/unread operations on email threads.
 */

import type {
  ListDraftsInput,
  ListDraftsOutput,
  ListInboxFiltersOutput,
  ListInboxInput,
  ListInboxOutput,
  ListSplitInboxesOutput,
  MoveThreadInput,
  MoveThreadOutput,
  ReadEmailInput,
  ReadEmailOutput,
  DownloadAttachmentInput,
  DownloadAttachmentOutput,
  ArchiveEmailInput,
  ArchiveEmailOutput,
  UnarchiveEmailInput,
  UnarchiveEmailOutput,
  SetReminderInput,
  SetReminderOutput,
  CancelReminderInput,
  CancelReminderOutput,
  StarEmailInput,
  StarEmailOutput,
  UnstarEmailInput,
  UnstarEmailOutput,
  MarkReadInput,
  MarkReadOutput,
  MarkUnreadInput,
  MarkUnreadOutput,
  SearchEmailsInput,
  SearchEmailsOutput,
  SuperhumanThreadPresenter,
  SuperhumanCachedThreadPresenter,
  SuperhumanAccount,
} from '../schemas';
import { Unauthenticated, ContractDrift, NotFound, UpstreamError, Validation, throwForStatus } from '@vallum/_runtime';

/** Narrow union to SuperhumanThreadPresenter (has _threadModel) */
function isFullPresenter(
  p: SuperhumanThreadPresenter | SuperhumanCachedThreadPresenter,
): p is SuperhumanThreadPresenter {
  return '_threadModel' in p;
}

import type { FileRef } from '../../files/schemas';

declare const window: Window & {
  Account?: SuperhumanAccount;
  __vallum_files?: {
    write(
      name: string,
      data: string | ArrayBuffer | Uint8Array | Blob,
    ): Promise<FileRef>;
  };
};

/**
 * Extract thread info from a cache presenter.
 */
function extractThread(
  threadId: string,
  presenter: SuperhumanThreadPresenter,
): {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date: number | null;
  isUnread: boolean;
  isStarred: boolean;
  messageCount: number;
} | null {
  const model = presenter._threadModel;
  if (!model) return null;

  const subject = model.subject ? model.subject : '(no subject)';
  const messages = model.messages ? model.messages : [];
  const lastMessage =
    messages.length > 0 ? messages[messages.length - 1] : null;

  let from = 'Unknown';
  let snippet = '';
  let date: number | null = null;

  if (lastMessage) {
    const fromContact = lastMessage.from;
    if (fromContact) {
      from = fromContact.name
        ? fromContact.name
        : fromContact.email
          ? fromContact.email
          : 'Unknown';
    }
    snippet = lastMessage.snippet ? lastMessage.snippet : '';
    date =
      lastMessage.date instanceof Date
        ? lastMessage.date.getTime()
        : (lastMessage.date ?? null);
  }

  const isUnread = model.isUnread ? model.isUnread() : false;
  const isStarred = model.isStarred ? model.isStarred() : false;

  return {
    id: threadId,
    subject: subject.substring(0, 100),
    from,
    snippet: snippet.substring(0, 100),
    date,
    isUnread,
    isStarred,
    messageCount: messages.length,
  };
}

/**
 * List available inbox categories and split inboxes.
 */
export function listInboxFilters(): ListInboxFiltersOutput {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const listsCache = account.lists?.identityMap?.cache;
  if (!listsCache) {
    throw new ContractDrift(
      'Inbox lists not loaded. Open Superhuman and wait for inbox to load.',
    );
  }

  const filters: Array<{ id: string; threadCount: number }> = [];

  for (const [id, list] of Object.entries(listsCache)) {
    const sortedItems = list._sortedList?.sorted;
    const count = Array.isArray(sortedItems) ? sortedItems.length : 0;

    // Normalize split-inbox IDs to their matcher name (e.g. "split-inbox:vip" -> "vip")
    const matcher = list.matcher ? String(list.matcher) : '';
    const filterId = matcher.startsWith('split-inbox:')
      ? matcher.replace('split-inbox:', '')
      : id;

    // Skip internal entries (snippets, etc.)
    if (filterId.includes('snippet')) continue;

    filters.push({ id: filterId, threadCount: count });
  }

  return { account: email, filters };
}

/**
 * List email threads from inbox.
 * Uses Superhuman's internal thread cache and sorted lists.
 */
export function listInbox(opts: ListInboxInput): ListInboxOutput {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const threadCache = account.threads.identityMap.cache;
  const limit = opts.limit ?? 20;
  const filter = opts.filter ?? 'inbox';

  // Try to use Superhuman's pre-sorted list for the requested filter
  const listsCache = account.lists?.identityMap?.cache;
  if (listsCache) {
    // Find the matching list; check both direct IDs and split-inbox matchers
    let list = listsCache[filter];
    if (!list) {
      // Search split-inbox entries by matcher suffix (e.g. "vip" matches "split-inbox:vip")
      for (const entry of Object.values(listsCache)) {
        const matcher = entry.matcher ? String(entry.matcher) : '';
        if (matcher === `split-inbox:${filter}`) {
          list = entry;
          break;
        }
      }
    }

    if (list) {
      const sortedList = list._sortedList;
      const sortedItems = sortedList?.sorted;
      if (Array.isArray(sortedItems) && sortedItems.length > 0) {
        // List is already sorted by Superhuman; just extract thread info
        const threads: ListInboxOutput['threads'] = [];
        for (const item of sortedItems) {
          if (threads.length >= limit) break;
          const threadId = item.id;
          const presenter = threadCache[threadId];
          if (!presenter) continue;
          if (!isFullPresenter(presenter)) continue;
          const thread = extractThread(threadId, presenter);
          if (thread) threads.push(thread);
        }
        return { account: email, threads };
      }
    }
  }

  // Fallback: scan full thread cache (handles case where lists aren't loaded)
  const threads: Array<{
    id: string;
    subject: string;
    from: string;
    snippet: string;
    date: number | null;
    isUnread: boolean;
    isStarred: boolean;
    messageCount: number;
  }> = [];

  for (const [threadId, presenter] of Object.entries(threadCache)) {
    if (!isFullPresenter(presenter)) continue;
    const model = presenter._threadModel;
    if (!model) continue;

    const isInInbox = model.isInInbox ? model.isInInbox() : true;
    const isDone = model.isDone ? model.isDone() : false;
    const isTrash = model.isTrash ? model.isTrash() : false;
    const isSpam = model.isSpam ? model.isSpam() : false;

    if (!isInInbox || isDone || isTrash || isSpam) continue;

    const thread = extractThread(threadId, presenter);
    if (thread) threads.push(thread);
  }

  threads.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));

  return {
    account: email,
    threads: threads.slice(0, limit),
  };
}

/**
 * List unsent email drafts.
 */
export function listDrafts(opts: ListDraftsInput): ListDraftsOutput {
  return listInbox({ filter: 'draft', limit: opts.limit ?? 20 });
}

/**
 * Read full details of an email thread.
 * Returns all messages with content, attachments, etc.
 */
export function readEmail(opts: ReadEmailInput): ReadEmailOutput {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const cache = account.threads.identityMap.cache;
  const { threadId } = opts;

  const presenter = cache[threadId];
  if (!presenter) {
    throw new NotFound(`Thread not found in cache: ${threadId}`);
  }
  if (!isFullPresenter(presenter)) {
    throw new ContractDrift(`Thread ${threadId} is not fully loaded`);
  }

  const model = presenter._threadModel;
  const subject = model.subject ? model.subject : '(no subject)';
  const messages = model.messages ? model.messages : [];

  // Extract all messages with full details
  const messageList = messages.map((msg) => {
    const from = msg.from
      ? {
          name: msg.from.name ?? null,
          email: msg.from.email ?? null,
        }
      : null;

    const to = msg.to
      ? msg.to.map((t) => ({
          name: t.name ?? null,
          email: t.email ?? null,
        }))
      : [];

    const cc = msg.cc
      ? msg.cc.map((c) => ({
          name: c.name ?? null,
          email: c.email ?? null,
        }))
      : [];

    return {
      id: msg.id ?? null,
      from,
      to,
      cc,
      date: msg.date instanceof Date ? msg.date.getTime() : (msg.date ?? null),
      snippet: msg.snippet ?? '',
      body: msg.body ?? '',
      isUnread: msg.isUnread ? msg.isUnread() : false,
      isDraft:
        msg._isDraft === true || (msg.id ? msg.id.startsWith('draft') : false),
      attachments: msg.attachments
        ? msg.attachments.map((a) => ({
            name: a.name ?? a.raw?.name ?? 'attachment',
            size: a.raw?.size ?? 0,
            mimeType: a.type ?? a.raw?.type ?? 'application/octet-stream',
            attachmentId: a.attachmentId ?? a.raw?.attachmentId ?? null,
            messageId: msg.id ?? null,
          }))
        : [],
    };
  });

  // Thread metadata
  const isUnread = model.isUnread ? model.isUnread() : false;
  const isStarred = model.isStarred ? model.isStarred() : false;
  const isDone = model.isDone ? model.isDone() : false;
  const labels = model.labels
    ? model.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? '')))
    : [];

  return {
    account: email,
    threadId,
    subject,
    messageCount: messages.length,
    isUnread,
    isStarred,
    isDone,
    labels,
    messages: messageList,
  };
}

/**
 * Download an email attachment and save it to device storage.
 * Uses Superhuman's internal gmail.downloadAttachment() which calls the Gmail API.
 */
export async function downloadAttachment(
  opts: DownloadAttachmentInput,
): Promise<DownloadAttachmentOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const { messageId, attachmentId, filename } = opts;

  if (!messageId) {
    throw new Validation(
      'messageId is required. Get it from readEmail() attachment output.',
    );
  }
  if (!attachmentId) {
    throw new Validation(
      'attachmentId is required. Get it from readEmail() attachment output.',
    );
  }

  // Infer MIME type from filename extension
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    csv: 'text/csv',
    txt: 'text/plain',
    zip: 'application/zip',
  };
  const mimeType = mimeMap[ext] || 'application/octet-stream';

  // Find the threadId for this message from the cache
  const cache = account.threads.identityMap.cache;
  let threadId: string | null = null;
  for (const [tid, presenter] of Object.entries(cache)) {
    const model = (presenter as SuperhumanThreadPresenter)._threadModel;
    if (!model?.messages) continue;
    for (const msg of model.messages) {
      if (msg.id === messageId) {
        threadId = tid;
        break;
      }
    }
    if (threadId) break;
  }
  if (!threadId) {
    throw new NotFound(
      `Message ${messageId} not found in thread cache. Call readEmail() first to load it.`,
    );
  }

  // Download via Superhuman's internal Gmail API wrapper
  // Returns a Blob with the attachment content
  const blob: Blob = await account.gmail.downloadAttachment({
    threadId,
    messageId,
    id: attachmentId,
    type: mimeType,
  });

  if (!blob || blob.size === 0) {
    throw new UpstreamError('Download returned empty data. Attachment may not exist.');
  }

  // Save to device via files lib
  const filesApi = window.__vallum_files;
  if (!filesApi) {
    throw new UpstreamError(
      'Northlight files API not available. Cannot save attachment. ' +
        'Ensure the Northlight agent is running.',
    );
  }

  const fileRef = await filesApi.write(filename, blob);

  return {
    success: true,
    filename,
    path: fileRef.path,
    size: blob.size,
    mimeType: blob.type || mimeType,
  };
}

/**
 * Archive an email thread (remove from inbox).
 * Uses Gmail's changeLabels API to remove INBOX label.
 */
export async function archiveEmail(
  opts: ArchiveEmailInput,
): Promise<ArchiveEmailOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const provider = account.credential.provider;
  const cache = account.threads.identityMap.cache;
  const { threadId } = opts;

  const presenter = cache[threadId];
  if (!presenter) {
    throw new NotFound(`Thread not found in cache: ${threadId}`);
  }
  if (!isFullPresenter(presenter)) {
    throw new ContractDrift(`Thread ${threadId} is not fully loaded`);
  }

  const model = presenter._threadModel;
  const subject = model.subject ? model.subject : '(no subject)';

  // Gmail accounts only
  if (provider !== 'google') {
    throw new Validation(
      `Archive not supported for ${provider} accounts. Gmail accounts only.`,
    );
  }

  const gmail = account.gmail;
  const messages = model.messages ? model.messages : [];
  if (messages.length === 0) {
    throw new ContractDrift('No messages in thread');
  }

  // Archive by removing INBOX label from all messages
  const results: string[] = [];
  for (const msg of messages) {
    const msgId = msg.id;
    if (msgId) {
      // changeLabels(messageId, addLabelIds, removeLabelIds)
      await gmail.changeLabels(msgId, [], ['INBOX']);
      results.push(msgId);
    }
  }

  return {
    success: true,
    account: email,
    threadId,
    subject,
    messagesArchived: results.length,
  };
}

/**
 * Star an email thread.
 * Uses Gmail's changeLabels API to add STARRED label.
 */
export async function starEmail(
  opts: StarEmailInput,
): Promise<StarEmailOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const provider = account.credential.provider;
  const cache = account.threads.identityMap.cache;
  const { threadId } = opts;

  const presenter = cache[threadId];
  if (!presenter) {
    throw new NotFound(`Thread not found in cache: ${threadId}`);
  }
  if (!isFullPresenter(presenter)) {
    throw new ContractDrift(`Thread ${threadId} is not fully loaded`);
  }

  const model = presenter._threadModel;
  const subject = model.subject ? model.subject : '(no subject)';

  // Gmail accounts only
  if (provider !== 'google') {
    throw new Validation(
      `Star not supported for ${provider} accounts. Gmail accounts only.`,
    );
  }

  const gmail = account.gmail;
  const messages = model.messages ? model.messages : [];
  if (messages.length === 0) {
    throw new ContractDrift('No messages in thread');
  }

  // Star the first message in the thread (standard behavior)
  const msg = messages[0];
  const msgId = msg.id;

  if (!msgId) {
    throw new ContractDrift('Message has no ID');
  }

  // changeLabels(messageId, addLabelIds, removeLabelIds)
  await gmail.changeLabels(msgId, ['STARRED'], []);

  return {
    success: true,
    account: email,
    threadId,
    subject,
    action: 'starred',
  };
}

/**
 * Unstar an email thread.
 * Uses Gmail's changeLabels API to remove STARRED label.
 */
export async function unstarEmail(
  opts: UnstarEmailInput,
): Promise<UnstarEmailOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const provider = account.credential.provider;
  const cache = account.threads.identityMap.cache;
  const { threadId } = opts;

  const presenter = cache[threadId];
  if (!presenter) {
    throw new NotFound(`Thread not found in cache: ${threadId}`);
  }
  if (!isFullPresenter(presenter)) {
    throw new ContractDrift(`Thread ${threadId} is not fully loaded`);
  }

  const model = presenter._threadModel;
  const subject = model.subject ? model.subject : '(no subject)';

  // Gmail accounts only
  if (provider !== 'google') {
    throw new Validation(
      `Unstar not supported for ${provider} accounts. Gmail accounts only.`,
    );
  }

  const gmail = account.gmail;
  const messages = model.messages ? model.messages : [];
  if (messages.length === 0) {
    throw new ContractDrift('No messages in thread');
  }

  // Unstar the first message in the thread
  const msg = messages[0];
  const msgId = msg.id;

  if (!msgId) {
    throw new ContractDrift('Message has no ID');
  }

  // changeLabels(messageId, addLabelIds, removeLabelIds)
  await gmail.changeLabels(msgId, [], ['STARRED']);

  return {
    success: true,
    account: email,
    threadId,
    subject,
    action: 'unstarred',
  };
}

/**
 * Mark an email thread as read.
 * Uses Gmail's changeLabels API to remove UNREAD label.
 */
export async function markRead(opts: MarkReadInput): Promise<MarkReadOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const provider = account.credential.provider;
  const cache = account.threads.identityMap.cache;
  const { threadId } = opts;

  const presenter = cache[threadId];
  if (!presenter) {
    throw new NotFound(`Thread not found in cache: ${threadId}`);
  }
  if (!isFullPresenter(presenter)) {
    throw new ContractDrift(`Thread ${threadId} is not fully loaded`);
  }

  const model = presenter._threadModel;
  const subject = model.subject ? model.subject : '(no subject)';

  // Gmail accounts only
  if (provider !== 'google') {
    throw new Validation(
      `Mark read not supported for ${provider} accounts. Gmail accounts only.`,
    );
  }

  const gmail = account.gmail;
  const messages = model.messages ? model.messages : [];
  if (messages.length === 0) {
    throw new ContractDrift('No messages in thread');
  }

  // Remove UNREAD label from all messages
  const results: string[] = [];
  for (const msg of messages) {
    const msgId = msg.id;
    if (msgId) {
      await gmail.changeLabels(msgId, [], ['UNREAD']);
      results.push(msgId);
    }
  }

  return {
    success: true,
    account: email,
    threadId,
    subject,
    action: 'marked read',
    messagesModified: results.length,
  };
}

/**
 * Mark an email thread as unread.
 * Uses Gmail's changeLabels API to add UNREAD label.
 */
export async function markUnread(
  opts: MarkUnreadInput,
): Promise<MarkUnreadOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const provider = account.credential.provider;
  const cache = account.threads.identityMap.cache;
  const { threadId } = opts;

  const presenter = cache[threadId];
  if (!presenter) {
    throw new NotFound(`Thread not found in cache: ${threadId}`);
  }
  if (!isFullPresenter(presenter)) {
    throw new ContractDrift(`Thread ${threadId} is not fully loaded`);
  }

  const model = presenter._threadModel;
  const subject = model.subject ? model.subject : '(no subject)';

  // Gmail accounts only
  if (provider !== 'google') {
    throw new Validation(
      `Mark unread not supported for ${provider} accounts. Gmail accounts only.`,
    );
  }

  const gmail = account.gmail;
  const messages = model.messages ? model.messages : [];
  if (messages.length === 0) {
    throw new ContractDrift('No messages in thread');
  }

  // Add UNREAD label to all messages
  const results: string[] = [];
  for (const msg of messages) {
    const msgId = msg.id;
    if (msgId) {
      await gmail.changeLabels(msgId, ['UNREAD'], []);
      results.push(msgId);
    }
  }

  return {
    success: true,
    account: email,
    threadId,
    subject,
    action: 'marked unread',
    messagesModified: results.length,
  };
}

/**
 * Unarchive an email thread (move back to inbox).
 * Uses Gmail's changeLabels API to add INBOX label.
 */
export async function unarchiveEmail(
  opts: UnarchiveEmailInput,
): Promise<UnarchiveEmailOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const provider = account.credential.provider;
  const cache = account.threads.identityMap.cache;
  const { threadId } = opts;

  const presenter = cache[threadId];
  if (!presenter) {
    throw new NotFound(`Thread not found in cache: ${threadId}`);
  }

  const threadPresenter = presenter as SuperhumanThreadPresenter;
  const model = threadPresenter._threadModel;
  const subject = model.subject ? model.subject : '(no subject)';

  // Gmail accounts only
  if (provider !== 'google') {
    throw new Validation(
      `Unarchive not supported for ${provider} accounts. Gmail accounts only.`,
    );
  }

  const gmail = account.gmail;
  const messages = model.messages ? model.messages : [];
  if (messages.length === 0) {
    throw new ContractDrift('No messages in thread');
  }

  // Unarchive by adding INBOX label to all messages
  const results: string[] = [];
  for (const msg of messages) {
    const msgId = msg.id;
    if (msgId) {
      // changeLabels(messageId, addLabelIds, removeLabelIds)
      await gmail.changeLabels(msgId, ['INBOX'], []);
      results.push(msgId);
    }
  }

  return {
    success: true,
    account: email,
    threadId,
    subject,
    messagesUnarchived: results.length,
  };
}

/**
 * Set a remind-me timer on an email thread.
 * Uses Superhuman's backend createReminder API.
 */
export async function setReminder(
  opts: SetReminderInput,
): Promise<SetReminderOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const provider = account.credential.provider;
  const cache = account.threads.identityMap.cache;
  const { threadId } = opts;

  const presenter = cache[threadId];
  if (!presenter) {
    throw new NotFound(`Thread not found in cache: ${threadId}`);
  }

  const threadPresenter = presenter as SuperhumanThreadPresenter;
  const model = threadPresenter._threadModel;
  const subject = model.subject ? model.subject : '(no subject)';

  // Gmail accounts only
  if (provider !== 'google') {
    throw new Validation(
      `Set reminder not supported for ${provider} accounts. Gmail accounts only.`,
    );
  }

  const messages = model.messages ? model.messages : [];
  if (messages.length === 0) {
    throw new ContractDrift('No messages in thread');
  }

  const reminderId = crypto.randomUUID();
  const triggerAt = new Date(opts.triggerAt).toISOString();
  const clientCreatedAt = new Date().toISOString();

  const reminderData = {
    reminderId,
    threadId,
    messageIds: messages.map((m) => m.id).filter(Boolean) as string[],
    keepOnReply: opts.keepOnReply ?? false,
    onDesktop: false,
    triggerAt,
    clientCreatedAt,
    source: 'AI',
  };

  const reminderObj = {
    attributes: reminderData,
    toJson: () => reminderData,
    getReminderId: () => reminderData.reminderId,
    getThreadId: () => reminderData.threadId,
  };

  const markDone = opts.markDone ?? true;
  // markDone and moveToInbox are mutually exclusive in Superhuman's API.
  // markDone: true archives the thread; the reminder system returns it to inbox when triggered.
  // moveToInbox: true moves it to inbox immediately (only useful when markDone is false).
  await account.backend.createReminder(reminderObj, {
    markDone,
    moveToInbox: !markDone,
  });

  return {
    success: true,
    account: email,
    threadId,
    subject,
    reminderId,
    triggerAt,
  };
}

/**
 * List all available split inboxes (Important, Other, and custom splits).
 * Reads from Superhuman's internal lists cache (no API calls).
 */
export function listSplitInboxes(): ListSplitInboxesOutput {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const listsCache = account.lists?.identityMap?.cache;

  const allSplits = account.getAllSplitInboxes();
  const splitInboxes: ListSplitInboxesOutput['splitInboxes'] = [];

  // Important
  const importantCount =
    listsCache?.['important']?._sortedList?.sorted?.length ?? 0;
  splitInboxes.push({
    id: 'important',
    name: 'Important',
    slug: 'important',
    type: 'important',
    enabled: true,
    threadCount: importantCount,
    routingLabelIds: ['IMPORTANT'],
  });

  // Other
  const otherCount = listsCache?.['other']?._sortedList?.sorted?.length ?? 0;
  splitInboxes.push({
    id: 'other',
    name: 'Other',
    slug: 'other',
    type: 'other',
    enabled: true,
    threadCount: otherCount,
    routingLabelIds: [],
  });

  // Custom splits
  for (const split of allSplits) {
    const json = split.toJson();
    const routingLabels = (json.labels || []).filter((l) => l.id !== 'INBOX');
    const listKey = 'split-inbox:' + split.id;
    const threadCount = listsCache?.[listKey]?._sortedList?.sorted?.length ?? 0;

    splitInboxes.push({
      id: split.id,
      name: split.getName(),
      slug: split.getSlug(),
      type: split.getType() !== '' ? split.getType() : 'custom',
      enabled: !split.isDisabled(),
      threadCount,
      routingLabelIds: Array.from(new Set(routingLabels.map((l) => l.id))),
    });
  }

  return { account: email, splitInboxes };
}

/**
 * Move an email thread to a different split inbox by changing Gmail routing labels.
 * Uses Superhuman's internal gmail.changeLabelsPerThread() API.
 */
export async function moveThread(
  opts: MoveThreadInput,
): Promise<MoveThreadOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const provider = account.credential.provider;

  if (provider !== 'google') {
    throw new Validation(
      `moveThread not supported for ${provider} accounts. Gmail accounts only.`,
    );
  }

  const cache = account.threads.identityMap.cache;
  const { threadId, target } = opts;

  const presenter = cache[threadId];
  if (!presenter) {
    throw new NotFound(`Thread not found in cache: ${threadId}`);
  }

  const threadPresenter = presenter as SuperhumanThreadPresenter;
  const model = threadPresenter._threadModel;
  const subject = model.subject ? model.subject : '(no subject)';

  // Build a map of all split routing labels across all custom splits
  const allSplits = account.getAllSplitInboxes();
  const allRoutingLabelIds = new Set<string>();
  const targetRoutingLabels: string[] = [];
  let targetName = target;

  for (const split of allSplits) {
    const json = split.toJson();
    const routingLabels = (json.labels || [])
      .filter((l) => l.id !== 'INBOX')
      .map((l) => l.id);
    routingLabels.forEach((id) => allRoutingLabelIds.add(id));

    if (split.getSlug() === target || split.id === target) {
      targetRoutingLabels.push(...routingLabels);
      targetName = split.getName();
    }
  }

  // Build label changes without filtering by cached state.
  // Gmail label API is idempotent; adding a label that exists or removing one that
  // doesn't is a no-op on the server. Skipping the cache check avoids bugs from stale
  // local labelIds (changeLabelsPerThread doesn't update the in-memory model).
  let addLabelIds: string[] = [];
  let removeLabelIds: string[] = [];

  if (target === 'important') {
    addLabelIds = ['IMPORTANT'];
    removeLabelIds = Array.from(allRoutingLabelIds);
    targetName = 'Important';
  } else if (target === 'other') {
    addLabelIds = [];
    removeLabelIds = ['IMPORTANT', ...Array.from(allRoutingLabelIds)];
    targetName = 'Other';
  } else {
    if (targetRoutingLabels.length === 0) {
      throw new Validation(
        `Split inbox "${target}" has no routing labels. Only splits with dedicated Gmail labels can be targeted. ` +
          'Built-in splits (Calendar, Shared, etc.) route by query and cannot be moved to directly.',
      );
    }
    addLabelIds = Array.from(new Set(targetRoutingLabels));
    removeLabelIds = [
      'IMPORTANT',
      ...Array.from(allRoutingLabelIds).filter(
        (id) => !targetRoutingLabels.includes(id),
      ),
    ];
  }

  // Deduplicate: don't add and remove the same label
  removeLabelIds = removeLabelIds.filter((id) => !addLabelIds.includes(id));

  await account.gmail.changeLabelsPerThread(
    threadId,
    addLabelIds,
    removeLabelIds,
  );

  return {
    success: true,
    account: email,
    threadId,
    subject,
    movedTo: targetName,
    labelsAdded: addLabelIds,
    labelsRemoved: removeLabelIds,
  };
}

/**
 * Cancel an active remind-me timer on an email thread.
 * Uses Superhuman's backend cancelReminder API.
 */
export async function cancelReminder(
  opts: CancelReminderInput,
): Promise<CancelReminderOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const provider = account.credential.provider;
  const cache = account.threads.identityMap.cache;
  const { threadId } = opts;

  const presenter = cache[threadId] as SuperhumanThreadPresenter | undefined;
  if (!presenter) {
    throw new NotFound(`Thread not found in cache: ${threadId}`);
  }

  const model = presenter._threadModel;
  const subject = model.subject ? model.subject : '(no subject)';

  // Gmail accounts only
  if (provider !== 'google') {
    throw new Validation(
      `Cancel reminder not supported for ${provider} accounts. Gmail accounts only.`,
    );
  }

  // Use provided reminderId, or read from cache
  let reminderId = opts.reminderId;
  if (!reminderId) {
    const reminder = model.getReminder ? model.getReminder() : null;
    if (!reminder) {
      throw new NotFound(
        `Thread ${threadId} has no active reminder in cache, and no reminderId was provided. ` +
          'Pass the reminderId from setReminder() response.',
      );
    }
    reminderId = reminder.getReminderId();
  }

  const moveToInbox = opts.moveToInbox ?? true;

  await account.backend.cancelReminder({ reminderId, threadId, moveToInbox });

  return {
    success: true,
    account: email,
    threadId,
    subject,
    reminderId,
  };
}

/**
 * Map of Superhuman-style search shortcuts to Gmail search operators.
 * Keys are lowercase (matching is case-insensitive).
 */
const SEARCH_SHORTCUTS: Record<string, string> = {
  ':sent': 'in:sent',
  ':starred': 'is:starred',
  ':unread': 'is:unread',
  ':read': 'is:read',
  ':attachment': 'has:attachment',
  ':attachments': 'has:attachment',
  ':important': 'is:important',
  ':snoozed': 'in:snoozed',
  ':trash': 'in:trash',
  ':spam': 'in:spam',
  ':draft': 'in:drafts',
  ':drafts': 'in:drafts',
  ':scheduled': 'in:scheduled',
  ':all': 'in:all',
  ':inbox': 'in:inbox',
  ':done': '-in:inbox -in:drafts -in:trash -in:spam',
};

/**
 * Preprocess a search query to expand Superhuman-style shortcuts
 * (e.g. `:sent`, `:starred`) into their Gmail operator equivalents.
 * Regular Gmail operators are passed through unchanged.
 */
function expandSearchShortcuts(query: string): string {
  // Split on whitespace, preserving quoted strings
  // We replace standalone :shortcut tokens case-insensitively
  return query
    .split(/\s+/)
    .map((token) => {
      const lower = token.toLowerCase();
      if (lower in SEARCH_SHORTCUTS) {
        return SEARCH_SHORTCUTS[lower];
      }
      return token;
    })
    .join(' ');
}

/**
 * Search emails using Gmail search operators.
 * Uses Gmail Messages.list API via Superhuman's cached OAuth token,
 * then enriches results from the thread cache or Gmail Threads API.
 */
export async function searchEmails(
  opts: SearchEmailsInput,
): Promise<SearchEmailsOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. ' +
        'Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);

  // Get OAuth access token from cached auth data
  const cred = account.backend._credential;
  if (!cred) {
    throw new Unauthenticated(
      'Cannot access Superhuman credentials. Backend API unavailable.',
    );
  }

  const authData = (
    cred as unknown as {
      _authData?: { accessToken?: string; expires?: number };
    }
  )._authData;
  if (!authData || !authData.accessToken) {
    throw new Unauthenticated(
      'No cached access token. The Superhuman session may need to be refreshed; ' +
        'interact with the app briefly, then retry.',
    );
  }

  // Check token expiry (with 60s buffer)
  if (authData.expires && authData.expires < Date.now() + 60000) {
    throw new Unauthenticated(
      'OAuth access token has expired. Interact with the Superhuman app to refresh it, then retry.',
    );
  }

  const accessToken = authData.accessToken;

  // Expand Superhuman-style shortcuts (:sent, :starred, etc.) to Gmail operators
  const expandedQuery = expandSearchShortcuts(opts.query);

  // Superhuman prefixes search queries to exclude drafts and chat messages
  const fullQuery = '-in:DRAFT -in:CHAT ' + expandedQuery;
  const encodedQuery = encodeURIComponent(fullQuery);

  // Step 1: Search for messages via Gmail Messages.list API
  const searchUrl =
    'https://content.googleapis.com/gmail/v1/users/me/messages' +
    '?q=' +
    encodedQuery +
    '&maxResults=' +
    limit;

  const searchController = new AbortController();
  const searchTimeout = setTimeout(() => searchController.abort(), 15000);

  let searchResp: Response;
  try {
    searchResp = await fetch(searchUrl, {
      headers: { Authorization: 'Bearer ' + accessToken },
      cache: 'no-store',
      signal: searchController.signal,
    });
  } finally {
    clearTimeout(searchTimeout);
  }

  if (!searchResp.ok) {
    throwForStatus(searchResp.status, await searchResp.text().catch(() => undefined));
  }

  const searchData = (await searchResp.json()) as {
    messages?: Array<{ id: string; threadId: string }>;
    nextPageToken?: string;
    resultSizeEstimate?: number;
  };

  const resultSizeEstimate = searchData.resultSizeEstimate ?? 0;

  if (!searchData.messages || searchData.messages.length === 0) {
    return {
      account: email,
      query: opts.query,
      resultSizeEstimate,
      threads: [],
    };
  }

  // Step 2: De-duplicate thread IDs (multiple messages can belong to same thread)
  const uniqueThreadIds: string[] = [];
  const seen = new Set<string>();
  for (const msg of searchData.messages) {
    if (!seen.has(msg.threadId)) {
      seen.add(msg.threadId);
      uniqueThreadIds.push(msg.threadId);
    }
  }

  // Step 3: Enrich each thread from cache if available, otherwise from Gmail API
  const threadCache = account.threads.identityMap.cache;
  const threads: SearchEmailsOutput['threads'] = [];

  for (const threadId of uniqueThreadIds) {
    if (threads.length >= limit) break;

    // Try cache first
    const presenter = threadCache[threadId];
    if (presenter) {
      const cached = extractThread(
        threadId,
        presenter as SuperhumanThreadPresenter,
      );
      if (cached) {
        threads.push(cached);
        continue;
      }
    }

    // Fetch from Gmail Threads API (metadata format for speed)
    try {
      const threadUrl =
        'https://content.googleapis.com/gmail/v1/users/me/threads/' +
        threadId +
        '?format=metadata' +
        '&metadataHeaders=Subject' +
        '&metadataHeaders=From' +
        '&metadataHeaders=Date' +
        '&metadataHeaders=To';

      const threadController = new AbortController();
      const threadTimeout = setTimeout(() => threadController.abort(), 10000);

      let threadResp: Response;
      try {
        threadResp = await fetch(threadUrl, {
          headers: { Authorization: 'Bearer ' + accessToken },
          cache: 'no-store',
          signal: threadController.signal,
        });
      } finally {
        clearTimeout(threadTimeout);
      }

      if (!threadResp.ok) continue;

      const threadData = (await threadResp.json()) as {
        id: string;
        messages?: Array<{
          id: string;
          snippet?: string;
          labelIds?: string[];
          payload?: {
            headers?: Array<{ name: string; value: string }>;
          };
        }>;
      };

      const messages = threadData.messages ?? [];
      const lastMessage =
        messages.length > 0 ? messages[messages.length - 1] : null;

      let subject = '(no subject)';
      let from = 'Unknown';
      let date: number | null = null;
      let snippet = '';

      if (lastMessage) {
        const headers: Record<string, string> = {};
        if (lastMessage.payload?.headers) {
          for (const h of lastMessage.payload.headers) {
            headers[h.name] = h.value;
          }
        }

        subject = headers.Subject ?? '(no subject)';
        from = headers.From ?? 'Unknown';
        snippet = lastMessage.snippet ?? '';

        if (headers.Date) {
          const parsed = new Date(headers.Date);
          date = isNaN(parsed.getTime()) ? null : parsed.getTime();
        }
      }

      const isUnread = messages.some(
        (m) => m.labelIds?.includes('UNREAD') ?? false,
      );
      const isStarred = messages.some(
        (m) => m.labelIds?.includes('STARRED') ?? false,
      );

      threads.push({
        id: threadId,
        subject: subject.substring(0, 100),
        from,
        snippet: snippet.substring(0, 100),
        date,
        isUnread,
        isStarred,
        messageCount: messages.length,
      });
    } catch {
      // Skip threads that fail to fetch; don't break the whole search
      continue;
    }
  }

  return {
    account: email,
    query: opts.query,
    resultSizeEstimate,
    threads,
  };
}
