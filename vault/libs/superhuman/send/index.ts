/**
 * Superhuman Send Operations
 *
 * Send emails, replies, forwards, and scheduled sends.
 * Constructs OutgoingMessage payloads and POSTs to /~backend/messages/send.
 *
 * HOW THIS WORKS:
 * Superhuman's sendEmail() requires an OutgoingMessage class (webpack-internal).
 * We bypass the class by calling backend.sendEmail() with an object that has
 * a toJsonRequest() method returning the correct payload shape. The payload
 * is constructed from a draft model created via initializeDraft/createOrReplaceDraftAsync.
 *
 * ATTACHMENTS:
 * Uses the @vallum/files library to load file data into browser context, then
 * uploads via Superhuman's /~backend/v3/attachments.upload endpoint. The uploaded
 * attachment metadata is included in the OutgoingMessage payload.
 */

import type {
  SendEmailInput,
  SendEmailOutput,
  SendReplyInput,
  SendReplyOutput,
  ScheduleSendInput,
  ScheduleSendOutput,
  ScheduleReplyInput,
  ScheduleReplyOutput,
  CancelScheduledSendInput,
  CancelScheduledSendOutput,
  AttachmentInput,
  SuperhumanAccount,
  SuperhumanAliasEntry,
  SuperhumanDraftModel,
  SuperhumanCachedThreadPresenter,
} from '../schemas';
import { Unauthenticated, ContractDrift, NotFound, UpstreamError, Validation } from '@vallum/_runtime';

declare const window: Window & {
  Account?: SuperhumanAccount;
  __vallum_files?: {
    read(identifier: string | { path: string }): Promise<ArrayBuffer>;
  };
};

/** Generate a Superhuman ID in the format: base36_timestamp.uuid */
function generateSuperhumanId(): string {
  const ts = Math.max(Date.now(), Math.pow(36, 7));
  return `${ts.toString(36)}.${crypto.randomUUID()}`;
}

/** Uploaded attachment metadata for inclusion in OutgoingMessage */
interface UploadedAttachment {
  uuid: string;
  cid: string;
  name: string;
  type: string;
  inline: boolean;
  source: {
    type: string;
    thread_id: undefined;
    message_id: undefined;
    attachment_id: undefined;
    fixed_part_id: undefined;
    uuid: string;
    cid: undefined;
  };
}

/** Override the from address on a draft model using a Gmail "Send As" alias */
function overrideFrom(
  draftModel: SuperhumanDraftModel,
  fromEmail: string | undefined,
): void {
  if (!fromEmail) return;
  const fromClone = draftModel.from.clone();
  fromClone.email = fromEmail;
  const aliases = window.Account?.settings?._cache?.aliases?.list;
  if (aliases) {
    const alias = aliases.find(
      (a: SuperhumanAliasEntry) => a.sendAs?.sendAsEmail === fromEmail,
    );
    if (alias?.sendAs?.displayName) {
      fromClone.name = alias.sendAs.displayName;
    }
  }
  draftModel.from = fromClone;
}

/**
 * Load files via __vallum_files API and upload them to Superhuman's backend.
 * Returns attachment metadata ready for inclusion in the OutgoingMessage payload.
 */
async function uploadAttachments(
  attachments: AttachmentInput[],
  draftMessageId: string,
  threadId: string,
): Promise<UploadedAttachment[]> {
  if (!attachments || attachments.length === 0) return [];

  const filesApi = window.__vallum_files;
  if (!filesApi) {
    throw new UpstreamError(
      'Northlight files API not available (__vallum_files). Cannot load attachment files. ' +
        'Ensure the Northlight agent is running.',
    );
  }

  const backend = window.Account!.backend;
  const results: UploadedAttachment[] = [];

  for (const att of attachments) {
    if (!att.path)
      throw new Error(`Attachment "${att.filename}" is missing a path.`);
    // Load file data via files lib
    const buffer: ArrayBuffer = await filesApi.read({ path: att.path });

    // Infer MIME type from filename extension
    const filename = att.filename;
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      csv: 'text/csv',
      txt: 'text/plain',
      html: 'text/html',
      json: 'application/json',
      zip: 'application/zip',
      mp4: 'video/mp4',
      mp3: 'audio/mpeg',
    };
    const contentType = mimeMap[ext || ''] || 'application/octet-stream';

    // Create Blob from ArrayBuffer
    const blob = new Blob([buffer], { type: contentType });

    // Generate UUID for this attachment
    const uuid = crypto.randomUUID();

    // Upload to Superhuman backend
    await backend.uploadAttachment({
      draftMessageId,
      threadId,
      uuid,
      blob,
    });

    results.push({
      uuid,
      cid: '',
      name: filename,
      type: contentType,
      inline: false,
      source: {
        type: 'upload',
        thread_id: undefined,
        message_id: undefined,
        attachment_id: undefined,
        fixed_part_id: undefined,
        uuid,
        cid: undefined,
      },
    });
  }

  return results;
}

/** Build the OutgoingMessage toJsonRequest() payload from a draft model */
function buildOutgoingPayload(
  draft: SuperhumanDraftModel & Record<string, unknown>,
  threadId: string,
  opts: {
    scheduledFor?: string | null;
    abortOnReply?: boolean;
    currentMessageIds?: string[];
    uploadedAttachments?: UploadedAttachment[];
  } = {},
): Record<string, unknown> {
  const superhumanId = generateSuperhumanId();
  const messageId = draft.id;
  const rfc822Id =
    typeof draft.getRfc822Id === 'function'
      ? draft.getRfc822Id()
      : draft.rfc822Id || '';
  const inReplyToRfc822Id =
    typeof draft.getInReplyToRfc822Id === 'function'
      ? draft.getInReplyToRfc822Id()
      : null;
  const inReplyTo =
    typeof draft.getInReplyTo === 'function' ? draft.getInReplyTo() : null;
  const references =
    typeof draft.getReferences === 'function' ? draft.getReferences() : [];
  const subject =
    typeof draft.getSubject === 'function'
      ? draft.getSubject()
      : draft.subject || '';

  // Contact extraction
  const extractContacts = (
    getter: string,
    fallback: Array<{ email?: string; name?: string }>,
  ): Array<{ email: string; name?: string }> => {
    if (typeof draft[getter] === 'function') {
      return (draft[getter] as () => Array<Record<string, unknown>>)().map(
        (c) =>
          typeof c['toMinimalJson'] === 'function'
            ? (c['toMinimalJson'] as () => { email: string; name?: string })()
            : {
                email: (c['email'] || c['emailAddress'] || '') as string,
                name: c['name'] as string | undefined,
              },
      );
    }
    return (fallback || []).map((c) => ({
      email: c.email ?? '',
      name: c.name,
    }));
  };

  const from =
    typeof draft.getFrom === 'function'
      ? typeof draft.getFrom().toMinimalJson === 'function'
        ? draft.getFrom().toMinimalJson()
        : { email: draft.getFrom().email, name: draft.getFrom().name }
      : { email: draft.from?.email, name: draft.from?.name };

  const to = extractContacts('getTo', draft.to);
  const cc = extractContacts('getCc', draft.cc);
  const bcc = extractContacts('getBcc', draft.bcc ?? []);

  // Build HTML body from draft body + quoted content
  let htmlBody =
    typeof draft.getBody === 'function' ? draft.getBody() : draft.body || '';

  // For replies, append quoted content if available
  if (typeof draft.getQuotedContent === 'function') {
    const quoted = draft.getQuotedContent();
    if (quoted) {
      htmlBody = htmlBody + quoted;
    }
  }

  // Attachments from draft model (forwarded emails, etc.)
  const draftAttachments =
    typeof draft.getAttachments === 'function'
      ? (draft.getAttachments as () => Array<Record<string, unknown>>)().map(
          (a) => {
            const source = (a['source'] as Record<string, unknown>) || {};
            return {
              uuid: a['uuid'],
              cid: a['cid'],
              name: a['name'] || a['filename'],
              type: a['type'] || a['mimeType'],
              inline: a['inline'] || false,
              source: {
                type: source['type'],
                thread_id: source['threadId'],
                message_id: source['messageId'],
                attachment_id: source['attachmentId'],
                fixed_part_id: source['fixedPartId'],
                uuid: source['uuid'],
                cid: source['cid'],
              },
            };
          },
        )
      : [];

  // Merge with any uploaded attachments from the files lib
  const attachments = [
    ...draftAttachments,
    ...(opts.uploadedAttachments || []),
  ];

  // Build headers
  const mailer = navigator.userAgent.match(/Superhuman\/([\d.]+)/)
    ? 'Superhuman Desktop'
    : 'Superhuman Web';
  const headers: Array<{ name: string; value: string }> = [
    { name: 'X-Mailer', value: mailer },
    { name: 'X-Superhuman-ID', value: superhumanId },
    { name: 'X-Superhuman-Draft-ID', value: messageId },
  ];

  if (threadId.startsWith('draft')) {
    headers.push({ name: 'X-Superhuman-Thread-ID', value: threadId });
  }
  if (inReplyToRfc822Id) {
    headers.push({ name: 'In-Reply-To', value: inReplyToRfc822Id });
  }
  if (references.length) {
    headers.push({ name: 'References', value: references.join(' ') });
  }

  return {
    headers,
    superhuman_id: superhumanId,
    rfc822_id: rfc822Id,
    thread_id: threadId,
    message_id: messageId,
    in_reply_to: inReplyTo,
    from,
    to,
    cc,
    bcc,
    subject,
    html_body: htmlBody,
    attachments,
    scheduled_for: opts.scheduledFor || null,
    abort_on_reply: opts.abortOnReply || false,
    current_message_ids: opts.currentMessageIds || null,
    mail_merge_recipients: [],
    reminder: null,
    sensitivity_label_id: undefined,
    sensitivity_tenant_id: undefined,
  };
}

/**
 * Send an email immediately via Superhuman.
 *
 * Creates a draft model internally (for proper rfc822Id/contact formatting),
 * constructs the OutgoingMessage payload, POSTs to the send endpoint,
 * then cleans up the transient draft.
 */
export async function sendEmail(
  opts: SendEmailInput,
): Promise<SendEmailOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;

  // Create a transient draft model for proper ID generation and formatting
  const operation = {
    watching: true,
    uniqueCallback: () => {},
    onUnwatch: () => {},
  };
  const presenter = account.threads.getNewDraftPresenter(operation);

  const toContacts = (addrs: string[]) =>
    addrs.map((a) => ({ email: a, name: a }));

  const draftModel = presenter.initializeDraft({
    to: toContacts(opts.to),
    cc: toContacts(opts.cc ?? []),
    bcc: toContacts(opts.bcc ?? []),
    subject: opts.subject,
    body: opts.body ?? '',
    action: 'new',
  });

  if (!draftModel) {
    throw new ContractDrift(
      'initializeDraft returned null. Internal API may have changed.',
    );
  }

  overrideFrom(draftModel, opts.from);

  const threadId = presenter.id;

  // Upload any attachments
  const uploadedAttachments = await uploadAttachments(
    opts.attachments ?? [],
    draftModel.id,
    threadId,
  );

  const outgoingPayload = buildOutgoingPayload(
    draftModel as SuperhumanDraftModel & Record<string, unknown>,
    threadId,
    { uploadedAttachments },
  );

  // Create a mock OutgoingMessage object with toJsonRequest/getters
  const outgoingMessage = {
    toJsonRequest: () => outgoingPayload,
    getSuperhumanId: () => outgoingPayload['superhuman_id'] as string,
    getThreadId: () => threadId,
    getMessageId: () => draftModel.id,
    getSubject: () => opts.subject,
  };

  try {
    await account.backend.sendEmail(outgoingMessage);
  } finally {
    // Clean up transient draft from memory
    presenter.deleteFromInMemory();
  }

  return {
    success: true,
    account: email,
    threadId,
    messageId: draftModel.id,
    subject: opts.subject,
  };
}

/**
 * Send a reply on an existing email thread.
 *
 * Uses Superhuman's createOrReplaceDraftAsync to build a reply model
 * (with quoted content, proper recipients, In-Reply-To/References headers),
 * then constructs and sends the OutgoingMessage.
 */
export async function sendReply(
  opts: SendReplyInput,
): Promise<SendReplyOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const cache = account.threads.identityMap.cache;
  const { threadId, body, action } = opts;

  // Find the thread presenter in cache
  const presenter = cache[threadId] as SuperhumanCachedThreadPresenter;
  if (!presenter) {
    throw new NotFound(
      `Thread not found in cache: ${threadId}. Use listInbox or readEmail first to load it.`,
    );
  }

  // Ensure content is loaded
  if (!presenter.renders || Object.keys(presenter.renders).length === 0) {
    await presenter.loadContentAsync();
  }

  // Get the last non-draft message to reply to
  const messages = presenter.metadata?.messages;
  if (!messages || messages.length === 0) {
    throw new NotFound(`Thread ${threadId} has no messages. Cannot reply.`);
  }
  const realMessages = messages.filter((m) => !m.id?.startsWith('draft'));
  if (realMessages.length === 0) {
    throw new NotFound(
      `Thread ${threadId} has no non-draft messages. Cannot reply.`,
    );
  }
  const lastMessage = realMessages[realMessages.length - 1];

  // Create reply draft model (builds quoted content, recipients, references)
  const draftModel = await presenter.createOrReplaceDraftAsync(
    lastMessage.id!,
    action,
  );

  if (!draftModel) {
    throw new ContractDrift(
      'createOrReplaceDraftAsync returned null. Internal API may have changed.',
    );
  }

  // Set body content
  if (body) {
    draftModel.body = body;
  }

  // Override recipients if provided
  if (opts.to) {
    draftModel.to.length = 0;
    for (const addr of opts.to) {
      draftModel.to.push({ email: addr, name: addr });
    }
  }
  if (opts.cc) {
    draftModel.cc.length = 0;
    for (const addr of opts.cc) {
      draftModel.cc.push({ email: addr, name: addr });
    }
  }
  if (opts.bcc && opts.bcc.length > 0) {
    if (!draftModel.bcc) draftModel.bcc = [];
    for (const addr of opts.bcc) {
      draftModel.bcc.push({ email: addr, name: addr });
    }
  }

  overrideFrom(draftModel, opts.from);

  // Get current message IDs for the thread
  const currentMessageIds = messages
    .map((m) => m.id)
    .filter((id): id is string => !!id && !id.startsWith('draft'));

  // Upload any attachments
  const uploadedAttachments = await uploadAttachments(
    opts.attachments ?? [],
    draftModel.id,
    threadId,
  );

  const outgoingPayload = buildOutgoingPayload(
    draftModel as SuperhumanDraftModel & Record<string, unknown>,
    threadId,
    {
      abortOnReply: false,
      currentMessageIds,
      uploadedAttachments,
    },
  );

  const outgoingMessage = {
    toJsonRequest: () => outgoingPayload,
    getSuperhumanId: () => outgoingPayload['superhuman_id'] as string,
    getThreadId: () => threadId,
    getMessageId: () => draftModel.id,
    getSubject: () =>
      typeof draftModel.getSubject === 'function'
        ? draftModel.getSubject()
        : '',
  };

  await account.backend.sendEmail(outgoingMessage);

  const subject =
    typeof draftModel.getSubject === 'function' ? draftModel.getSubject() : '';

  const toRecipients =
    typeof draftModel.getTo === 'function'
      ? draftModel
          .getTo()
          .map((t) => t.email ?? String(t))
          .join(', ')
      : '';

  return {
    success: true,
    account: email,
    threadId,
    messageId: draftModel.id,
    subject,
    to: toRecipients,
    action: action,
  };
}

/**
 * Schedule an email to be sent at a future time.
 *
 * Same as sendEmail but with scheduled_for set to an ISO date string.
 * Superhuman's backend holds the email and sends it at the specified time.
 */
export async function scheduleSend(
  opts: ScheduleSendInput,
): Promise<ScheduleSendOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;

  // Create a transient draft model
  const operation = {
    watching: true,
    uniqueCallback: () => {},
    onUnwatch: () => {},
  };
  const presenter = account.threads.getNewDraftPresenter(operation);

  const toContacts = (addrs: string[]) =>
    addrs.map((a) => ({ email: a, name: a }));

  const draftModel = presenter.initializeDraft({
    to: toContacts(opts.to),
    cc: toContacts(opts.cc ?? []),
    bcc: toContacts(opts.bcc ?? []),
    subject: opts.subject,
    body: opts.body ?? '',
    action: 'new',
  });

  if (!draftModel) {
    throw new ContractDrift(
      'initializeDraft returned null. Internal API may have changed.',
    );
  }

  overrideFrom(draftModel, opts.from);

  const threadId = presenter.id;

  // Validate scheduledFor is a valid future ISO date
  const scheduledDate = new Date(opts.scheduledFor);
  if (isNaN(scheduledDate.getTime())) {
    presenter.deleteFromInMemory();
    throw new Validation(
      `Invalid scheduledFor date: "${opts.scheduledFor}". Must be a valid ISO 8601 date string.`,
    );
  }
  if (scheduledDate.getTime() <= Date.now()) {
    presenter.deleteFromInMemory();
    throw new Validation(
      `scheduledFor must be in the future. Got: ${opts.scheduledFor}`,
    );
  }

  // Upload any attachments
  const uploadedAttachments = await uploadAttachments(
    opts.attachments ?? [],
    draftModel.id,
    threadId,
  );

  const outgoingPayload = buildOutgoingPayload(
    draftModel as SuperhumanDraftModel & Record<string, unknown>,
    threadId,
    { scheduledFor: scheduledDate.toISOString(), uploadedAttachments },
  );

  const outgoingMessage = {
    toJsonRequest: () => outgoingPayload,
    getSuperhumanId: () => outgoingPayload['superhuman_id'] as string,
    getThreadId: () => threadId,
    getMessageId: () => draftModel.id,
    getSubject: () => opts.subject,
  };

  try {
    await account.backend.sendEmail(outgoingMessage);
  } finally {
    presenter.deleteFromInMemory();
  }

  return {
    success: true,
    account: email,
    threadId,
    messageId: draftModel.id,
    subject: opts.subject,
    scheduledFor: scheduledDate.toISOString(),
  };
}

/**
 * Schedule a reply on an existing email thread for future delivery.
 *
 * Combines sendReply logic (createOrReplaceDraftAsync for thread context,
 * quoted content, In-Reply-To/References headers) with scheduleSend logic
 * (scheduled_for in the OutgoingMessage payload).
 */
export async function scheduleReply(
  opts: ScheduleReplyInput,
): Promise<ScheduleReplyOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;
  const cache = account.threads.identityMap.cache;
  const { threadId, body, action } = opts;

  // Validate scheduledFor
  const scheduledDate = new Date(opts.scheduledFor);
  if (isNaN(scheduledDate.getTime())) {
    throw new Validation(
      `Invalid scheduledFor date: "${opts.scheduledFor}". Must be a valid ISO 8601 date string.`,
    );
  }
  if (scheduledDate.getTime() <= Date.now()) {
    throw new Validation(
      `scheduledFor must be in the future. Got: ${opts.scheduledFor}`,
    );
  }

  // Find the thread presenter in cache
  const presenter = cache[threadId] as SuperhumanCachedThreadPresenter;
  if (!presenter) {
    throw new NotFound(
      `Thread not found in cache: ${threadId}. Use listInbox or readEmail first to load it.`,
    );
  }

  // Ensure content is loaded
  if (!presenter.renders || Object.keys(presenter.renders).length === 0) {
    await presenter.loadContentAsync();
  }

  // Get the last non-draft message to reply to
  const messages = presenter.metadata?.messages;
  if (!messages || messages.length === 0) {
    throw new NotFound(`Thread ${threadId} has no messages. Cannot reply.`);
  }
  const realMessages = messages.filter((m) => !m.id?.startsWith('draft'));
  if (realMessages.length === 0) {
    throw new NotFound(
      `Thread ${threadId} has no non-draft messages. Cannot reply.`,
    );
  }
  const lastMessage = realMessages[realMessages.length - 1];

  // Create reply draft model (builds quoted content, recipients, references)
  const draftModel = await presenter.createOrReplaceDraftAsync(
    lastMessage.id!,
    action,
  );

  if (!draftModel) {
    throw new ContractDrift(
      'createOrReplaceDraftAsync returned null. Internal API may have changed.',
    );
  }

  // Set body content
  if (body) {
    draftModel.body = body;
  }

  // Override recipients if provided
  if (opts.to) {
    draftModel.to.length = 0;
    for (const addr of opts.to) {
      draftModel.to.push({ email: addr, name: addr });
    }
  }
  if (opts.cc) {
    draftModel.cc.length = 0;
    for (const addr of opts.cc) {
      draftModel.cc.push({ email: addr, name: addr });
    }
  }
  if (opts.bcc && opts.bcc.length > 0) {
    if (!draftModel.bcc) draftModel.bcc = [];
    for (const addr of opts.bcc) {
      draftModel.bcc.push({ email: addr, name: addr });
    }
  }

  overrideFrom(draftModel, opts.from);

  // Get current message IDs for the thread
  const currentMessageIds = messages
    .map((m) => m.id)
    .filter((id): id is string => !!id && !id.startsWith('draft'));

  // Upload any attachments
  const uploadedAttachments = await uploadAttachments(
    opts.attachments ?? [],
    draftModel.id,
    threadId,
  );

  const abortOnReply = opts.abortOnReply ?? true;

  const outgoingPayload = buildOutgoingPayload(
    draftModel as SuperhumanDraftModel & Record<string, unknown>,
    threadId,
    {
      scheduledFor: scheduledDate.toISOString(),
      abortOnReply,
      currentMessageIds,
      uploadedAttachments,
    },
  );

  const outgoingMessage = {
    toJsonRequest: () => outgoingPayload,
    getSuperhumanId: () => outgoingPayload['superhuman_id'] as string,
    getThreadId: () => threadId,
    getMessageId: () => draftModel.id,
    getSubject: () =>
      typeof draftModel.getSubject === 'function'
        ? draftModel.getSubject()
        : '',
  };

  await account.backend.sendEmail(outgoingMessage);

  const subject =
    typeof draftModel.getSubject === 'function' ? draftModel.getSubject() : '';

  const toRecipients =
    typeof draftModel.getTo === 'function'
      ? draftModel
          .getTo()
          .map((t) => t.email ?? String(t))
          .join(', ')
      : '';

  return {
    success: true,
    account: email,
    threadId,
    messageId: draftModel.id,
    subject,
    to: toRecipients,
    action: action,
    scheduledFor: scheduledDate.toISOString(),
    abortOnReply,
  };
}

/**
 * Cancel a scheduled or in-flight email send.
 *
 * Superhuman delays sends by ~20 seconds. This cancels within that window
 * or cancels a scheduled (future) send.
 */
export async function cancelScheduledSend(
  opts: CancelScheduledSendInput,
): Promise<CancelScheduledSendOutput> {
  if (!window.Account) {
    throw new Unauthenticated(
      'Account object not found. User not logged into Superhuman. Navigate to mail.superhuman.com.',
    );
  }

  const account = window.Account;
  const email = account.emailAddress;

  await account.backend.cancelSendEmail({
    draft_message_id: opts.messageId,
    draft_thread_id: opts.threadId,
    superhuman_id: opts.superhumanId ?? '',
    rfc822_id: opts.rfc822Id ?? '',
    bypassOnlineCheck: false,
  });

  return {
    success: true,
    account: email,
    threadId: opts.threadId,
    messageId: opts.messageId,
  };
}
